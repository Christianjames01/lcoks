// CI check (macOS): builds one quick-add box exactly like the iPhone app does, for
// tests/iosInbox.test.ts to open with the vault's own decryption code.
// Usage: sealcheck <inbox.pub base64> <kind> <amount minor units> <category> <account id or -> <note>

import Foundation

let args = CommandLine.arguments
guard args.count == 7, let pub = Data(base64Encoded: args[1]), let amount = Int64(args[3]) else {
    FileHandle.standardError.write(Data("usage: sealcheck <pub> <kind> <amount> <category> <account|-> <note>\n".utf8))
    exit(2)
}
let entry = try QuickAddCrypto.entryJSON(kind: args[2], amount: amount, category: args[4], accountId: args[5] == "-" ? nil : args[5], note: args[6])
let box = try QuickAddCrypto.boxJSON(pubRaw: pub, plaintext: entry)
FileHandle.standardOutput.write(box)
