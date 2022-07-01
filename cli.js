import { createInterface } from "node:readline"

const rl = createInterface({
    input: process.stdin,
    output: process.stdout
})

export class Cli {
    println(text = "") {
        console.log(text)
    }

    readln(text = null, returnNullForEmptyLines = false) {
        if (text) {
            console.log(text)
        }
        
        return new Promise((resolve, reject) => {
            rl.once("line", (line) => {
                if (line == "" && returnNullForEmptyLines) {
                    resolve(null)
                } else {
                    resolve(line)
                }
            })
        })
    }
}