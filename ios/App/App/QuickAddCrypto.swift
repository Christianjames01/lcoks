// Encrypts one quick-add entry to the vault's inbox public key — byte-for-byte the
// same format as src/core/inbox.ts (which decrypts it on the next unlock) and
// Android's QuickAddCrypto.java:
//
//   ephemeral ECDH P-256 → HKDF-SHA256(salt = ephemeral public key, info) → AES-256-GCM(aad = info)
//
// Foundation + CryptoKit only, so CI can compile it on a Mac and check it against
// the JS implementation (ios/tools/sealcheck, tests/iosInbox.test.ts).

import CryptoKit
import Foundation

enum QuickAddCrypto {
    static let info = Data("VaultLocks inbox v1".utf8)

    /** pubRaw: 65-byte uncompressed P-256 point (0x04 ‖ X ‖ Y). ct = ciphertext ‖ 16-byte tag (WebCrypto layout). */
    static func seal(pubRaw: Data, plaintext: Data) throws -> (epk: Data, iv: Data, ct: Data) {
        let recipient = try P256.KeyAgreement.PublicKey(x963Representation: pubRaw)
        let ephemeral = P256.KeyAgreement.PrivateKey()
        let epk = ephemeral.publicKey.x963Representation
        let shared = try ephemeral.sharedSecretFromKeyAgreement(with: recipient)
        let key = shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: epk, sharedInfo: info, outputByteCount: 32)
        let nonce = AES.GCM.Nonce()
        let box = try AES.GCM.seal(plaintext, using: key, nonce: nonce, authenticating: info)
        return (epk, nonce.withUnsafeBytes { Data($0) }, box.ciphertext + box.tag)
    }

    /** The entry inside a box (src/core/inbox.ts InboxEntry). kind: "expense" | "income"; amount in minor units. */
    static func entryJSON(kind: String, amount: Int64, category: String, accountId: String?, note: String, now: Date = Date()) throws -> Data {
        let day = DateFormatter()
        day.calendar = Calendar(identifier: .gregorian)
        day.locale = Locale(identifier: "en_US_POSIX")
        day.dateFormat = "yyyy-MM-dd"
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var entry: [String: Any] = [
            "t": String(note.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200)),
            "k": kind == "income" ? "income" : "expense",
            "a": amount,
            "c": category,
            "day": day.string(from: now),
            "at": iso.string(from: now)
        ]
        if let accountId { entry["acc"] = accountId }
        return try JSONSerialization.data(withJSONObject: entry)
    }

    /** The JSON stored in inbox-<uuid>.box. */
    static func boxJSON(pubRaw: Data, plaintext: Data) throws -> Data {
        let s = try seal(pubRaw: pubRaw, plaintext: plaintext)
        let box: [String: Any] = ["v": 1, "epk": s.epk.base64EncodedString(), "iv": s.iv.base64EncodedString(), "ct": s.ct.base64EncodedString()]
        return try JSONSerialization.data(withJSONObject: box)
    }
}
