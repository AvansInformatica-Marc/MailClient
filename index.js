import nodemailer from "nodemailer"
import Imap from "node-imap"
import { Cli } from "./cli.js"
import * as fs from "node:fs"
import { Base64Decode } from "base64-stream"

const { readln, println } = new Cli()

const connectImap = (options) => {
    return new Promise((resolve, reject) => {
        const imap = new Imap({
            user: options.auth.user,
            password: options.auth.pass,
            host: options.imap.host,
            port: options.imap.port,
            tls: options.imap.secure
        })
        
        imap.once("ready", () => {
            resolve(imap)
        })

        imap.once("error", (error) => {
            reject(error)
        })
        
        imap.connect()
    })
}

const fetchMessages = (imapFetch) => {
    return new Promise((resolve, reject) => {
        let messages = []
        let locks = 1

        imapFetch.on('message', (mail, seqno) => {
            locks++
            const message = { seqno }

            mail.on('body', (stream, info) => {
                if (info.which != 'TEXT' && !info.which.startsWith("HEADER")) {
                    stream.pipe(fs.createWriteStream('msg-' + seqno + '-body.txt'))
                } else { 
                    locks++
                    let buffer = ""

                    stream.on('data', (chunk) => {
                        buffer += chunk.toString('utf8')
                    })
    
                    stream.once('end', () => {
                        println(info.which)
                        if (info.which === 'TEXT') {
                            message.body = buffer
                        } else if(info.which.startsWith("HEADER")) {
                            message.parsedHeader = Imap.parseHeader(buffer)
                            message.headerBuffer = buffer
                        }
    
                        locks--
                        if (locks == 0) {
                            resolve(messages)
                        }
                    })
                }
            })

            mail.once('attributes', (attrs) => {
                message.attributes = attrs
            })

            mail.once('end', () => {
                messages.push(message)
                locks--
                if (locks == 0) {
                    resolve(messages)
                }
            })
        })

        imapFetch.once('error', (err) => {
            println('Fetch error: ' + err);
        })

        imapFetch.once('end', () => {
            locks--
            if (locks == 0) {
                resolve(messages)
            }
        })
    })
}

function toUpper(thing) { return thing && thing.toUpperCase ? thing.toUpperCase() : thing }

function findAttachmentParts(struct, attachments) {
  attachments = attachments ||  []
  struct.forEach((i) => {
    if (Array.isArray(i)) findAttachmentParts(i, attachments)
    else if (i.disposition && ['INLINE', 'ATTACHMENT'].indexOf(toUpper(i.disposition.type)) > -1) {
      attachments.push(i)
    }
  })
  return attachments
}

const writeAttachment = (attributes, imap, attachment) => {
    return new Promise((resolve, reject) => {
        const filename = attachment.params.name
        const encoding = toUpper(attachment.encoding)
        const imapFetch = imap.fetch(attributes.uid, { bodies: [attachment.partID] })
        let locks = 1

        imapFetch.on('message', (msg, seqno) => {
            locks++

            msg.on('body', (stream, info) => {
                locks++
                
                const writeStream = fs.createWriteStream(filename)

                writeStream.on('finish', () => { 
                    locks--
                    if (locks == 0) {
                        resolve()
                    }
                })

                if (encoding === 'BASE64') {
                    stream.pipe(new Base64Decode()).pipe(writeStream)
                } else {
                    stream.pipe(writeStream)
                }
            })

            msg.once('end', () => { 
                locks--
                if (locks == 0) {
                    resolve()
                }
            })
        })

        imapFetch.once('end', () => { 
            locks--
            if (locks == 0) {
                resolve()
            }
        })
    })
}

const openBox = (imap, boxName = 'INBOX') => {
    return new Promise((resolve, reject) => {
        imap.openBox(boxName, true, async (error, box) => {
            if (error) {
                reject(error)
            } else {
                resolve(box)
            }
        })
    })
}

const main = async () => {
    const hostOption = await readln("User (L)ocalhost, (G)mail or (C)ustom?")
    const options = {
        imap: {
            host: "",
            secure: false,
            port: 0
        },
        smtp: {
            host: "",
            secure: false,
            port: 0
        },
        auth: {
            user: "",
            pass: ""
        }
    }

    if (hostOption == "L") {
        options.imap = {
            host: "127.0.0.1",
            secure: false,
            port: 143
        }
        options.smtp = {
            host: "127.0.0.1",
            secure: false,
            port: 25
        }
    } else if (hostOption == "G") {
        options.imap = {
            host: "imap.gmail.com",
            secure: true,
            port: 993
        }
        options.smtp = {
            host: "smtp.gmail.com",
            secure: true,
            port: 465
        }
    } else {
        options.imap = {
            host: await readln("Enter IMAP host:"),
            secure: (await readln("Secure IMAP (yes/no):")) == "yes",
            port: parseInt(await readln("Enter IMAP port:"))
        }
        options.smtp = {
            host: await readln("Enter SMTP host:"),
            secure: (await readln("Secure SMTP (yes/no):")) == "yes",
            port: parseInt(await readln("Enter SMTP port:"))
        }
    }

    options.auth.user = await readln("Enter e-mailadress:")
    options.auth.pass = await readln("Enter password:")
    
    const command = await readln("Would you like to (R)ead or (S)end e-mail, or (Q)uit?")
    if (command == "R") {
        println("Fetching e-mails...")
        /** @type {Imap} */
        const imap = await connectImap(options)
        const box = await openBox(imap, 'INBOX')

        println(`Total ${box.messages.total} messages`)

        const mails = box.messages.total
        const sequenceStart = mails > 10 ? mails - 10 : 1
        console.log(`${sequenceStart}:${mails}`)

        const imapFetch = imap.seq.fetch(`${sequenceStart}:${mails}`, {
            bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)', "TEXT"],
            struct: true
        })

        /** @type {{[key: string]: any}[]} */
        const messages = await fetchMessages(imapFetch)

        for (const message of messages) {
            println(`--- MESSAGE ${message.seqno} ---`)
            println("Header:")
            println(message.headerBuffer)
            println("Body:")
            println(message.body)
            
            const attachments = findAttachmentParts(message.attributes.struct)
            println(`Attachments (${attachments.length}):`);
            for (const attachment of attachments) {
                println(`> Fetching attachment ${attachment.params.name}`)
                println(attachment.disposition.params["filename*"])
                await writeAttachment(message.attributes, imap, attachment)
            }
            println(`--- END MESSAGE ${message.seqno} ---`)
            println()
        }

        imap.end()
        main()
    } else if (command == "S") {
        println("Sending an e-mail.")

        const destinations = await readln("Enter destination (comma-separated list of e-mails):")

        const subject = await readln("Enter subject:")

        const bodyType = await readln("User (T)ext or (H)tml body?")

        println("Enter body, enter <<EOF>> to terminate body:")
        let body = ""
        while (true) {
            const line = await readln()
            if (line == "<<EOF>>") {
                break
            } else {
                body += line + "\r\n"
            }
        }

        const mail = {
            from: `"Test MailSender" <${options.mailAddress}>`,
            to: destinations,
            subject: subject
        }

        if (bodyType == "H") {
            mail.html = body
        } else {
            mail.text = body
        }

        const path = await readln("Add attachment (send a path or empty if no attachements):", true)

        if (path != null) {
            const filename = await readln("Add filename:")
            mail.attachments = [
                { 
                    filename,
                    content: fs.createReadStream(path)
                }
            ]
        }

        const transporter = nodemailer.createTransport({
            host: options.smtp.host,
            port: options.smtp.port,
            secure: options.smtp.secure,
            auth: options.auth,
        })
        
        await transporter.sendMail(mail)

        main();
    } else if (command != "Q") {
        main()
    }
}

main()