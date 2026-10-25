// Quick add while locked (iPhone): the "Add expense" / "Add cash" Shortcuts actions
// (QuickAddIntents.swift) write one encrypted entry per file into the vault folder.
// Same format as Android's QuickAddCrypto.java and src/core/inbox.ts, which opens
// them on the next unlock:
//
//   ephemeral ECDH P-256 → HKDF-SHA256(salt = ephemeral public key, info) → AES-256-GCM(aad = info)
//
// Only the public key (inbox.pub) is ever read here, so nothing can be decrypted
// on this side. The only plain data read is inbox.meta (account names + currency).

import Foundation

enum QuickAddStore {
    private static let maxPending = 500

    struct Account: Hashable {
        let id: String
        let name: String
        let kind: String
    }

    enum Failure: Error {
        case notReady
        case tooMany
        case badAmount
        case writeFailed

        var message: String {
            switch self {
            case .notReady: return "Open VaultLocks and unlock it once to turn on quick add."
            case .tooMany: return "Too many entries are waiting. Unlock VaultLocks to add them."
            case .badAmount: return "Enter an amount greater than zero."
            case .writeFailed: return "Couldn't save. Please try again."
            }
        }
    }

    /** Same folder as VaultNativePlugin's vault storage. */
    static func vaultDir() -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("vault", isDirectory: true)
    }

    static var isReady: Bool {
        FileManager.default.fileExists(atPath: vaultDir().appendingPathComponent("inbox.pub").path)
    }

    /** Accounts and currency the vault left for the locked quick add (no balances unless the user allowed them). */
    static func meta() -> (accounts: [Account], currency: String) {
        let url = vaultDir().appendingPathComponent("inbox.meta")
        guard let data = try? Data(contentsOf: url), data.count < 64 * 1024,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return ([], "PHP") }
        let currency = (json["currency"] as? String).flatMap { $0.count == 3 ? $0 : nil } ?? "PHP"
        let accounts = (json["accounts"] as? [[String: Any]] ?? []).compactMap { a -> Account? in
            guard let id = a["id"] as? String, let name = a["name"] as? String else { return nil }
            return Account(id: id, name: name, kind: a["kind"] as? String ?? "other")
        }
        return (accounts, currency)
    }

    /** A sentence for Kloud, stored encrypted like any quick-add entry. */
    static func addVoice(_ text: String) throws {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { throw Failure.badAmount }
        let dir = vaultDir()
        let pubURL = dir.appendingPathComponent("inbox.pub")
        guard let pubText = try? String(contentsOf: pubURL, encoding: .utf8),
              let pub = Data(base64Encoded: pubText.trimmingCharacters(in: .whitespacesAndNewlines)), pub.count == 65
        else { throw Failure.notReady }
        let pending = ((try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []).filter { $0.hasPrefix("inbox-") && $0.hasSuffix(".box") }
        guard pending.count < maxPending else { throw Failure.tooMany }
        do {
            let box = try QuickAddCrypto.boxJSON(pubRaw: pub, plaintext: try QuickAddCrypto.voiceJSON(text: t))
            let target = dir.appendingPathComponent("inbox-\(UUID().uuidString.lowercased()).box")
            try box.write(to: target, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            throw Failure.writeFailed
        }
    }

    /** kind: "expense" | "income"; amount in minor units (centavos). */
    static func add(kind: String, amount: Int64, category: String, accountId: String?, note: String) throws {
        guard amount > 0, amount <= 100_000_000_000_000 else { throw Failure.badAmount }
        let dir = vaultDir()
        let pubURL = dir.appendingPathComponent("inbox.pub")
        guard let pubText = try? String(contentsOf: pubURL, encoding: .utf8),
              let pub = Data(base64Encoded: pubText.trimmingCharacters(in: .whitespacesAndNewlines)), pub.count == 65
        else { throw Failure.notReady }
        let pending = ((try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []).filter { $0.hasPrefix("inbox-") && $0.hasSuffix(".box") }
        guard pending.count < maxPending else { throw Failure.tooMany }

        do {
            let plain = try QuickAddCrypto.entryJSON(kind: kind, amount: amount, category: category, accountId: accountId, note: note)
            let box = try QuickAddCrypto.boxJSON(pubRaw: pub, plaintext: plain)
            let target = dir.appendingPathComponent("inbox-\(UUID().uuidString.lowercased()).box")
            // Readable while the phone is locked (after its first unlock), like the vault files.
            try box.write(to: target, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            throw Failure.writeFailed
        }
    }
}
