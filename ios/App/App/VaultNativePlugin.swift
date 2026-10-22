// iPhone side of the "VaultNative" plugin (same API as the Android
// VaultNativePlugin.java; see src/mobile/native.ts).
//
// Storage: Application Support/vault — private to the app, excluded from
// iCloud/iTunes backup, protected by iOS Data Protection.
// Quick unlock: the wrapped vault key is kept in the iOS Keychain behind Face ID /
// Touch ID or the device passcode (this device only). The PIN layer uses a
// separate device-only Keychain AES key, like the Android Keystore "device" key.

import Capacitor
import CryptoKit
import Foundation
import LocalAuthentication
import PDFKit
import Security
import UIKit
import UniformTypeIdentifiers

@objc(VaultNativePlugin)
public class VaultNativePlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentInteractionControllerDelegate {
    public let identifier = "VaultNativePlugin"
    public let jsName = "VaultNative"
    public let pluginMethods: [CAPPluginMethod] = [
        "read", "writeAtomic", "remove", "stat", "list", "rename", "freeSpace",
        "writeExport", "writeExportBase64", "clearExports", "openFile", "renderPdf", "setSecure",
        "copySecret", "clearClipboard", "readClipboard", "takeSharedText", "purgeCaptures",
        "biometricStatus", "bioEncrypt", "bioDecrypt", "deviceEncrypt", "deviceDecrypt", "resetKey",
        "phoneCalendarStatus", "requestPhoneCalendar", "syncPhoneCalendar", "openPhoneCalendar"
    ].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }

    private static let safeName = try! NSRegularExpression(pattern: "^[A-Za-z0-9._-]{1,100}$")
    private static let bioAccount = "vaultlocks_bio"
    private static let deviceAccount = "vaultlocks_device"
    private static let service = "com.vaultlocks.app.quick"

    private var docController: UIDocumentInteractionController?
    private var secure = true
    private var privacyCover: UIView?
    private var lastCopied: String?

    override public func load() {
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(willResignActive), name: UIApplication.willResignActiveNotification, object: nil)
        nc.addObserver(self, selector: #selector(didBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    // ---------------------------------------------------------------- files --

    private func vaultDir() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        var dir = base.appendingPathComponent("vault", isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try? dir.setResourceValues(values)
        }
        return dir
    }

    private func exportDir() -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("exports", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func isSafe(_ name: String) -> Bool {
        !name.hasPrefix(".") && Self.safeName.firstMatch(in: name, range: NSRange(name.startIndex..., in: name)) != nil
    }

    private func name(_ call: CAPPluginCall, _ key: String = "name") -> String? {
        guard let n = call.getString(key), isSafe(n) else {
            call.reject("Invalid file name")
            return nil
        }
        return n
    }

    @objc func read(_ call: CAPPluginCall) {
        guard let n = name(call) else { return }
        let url = vaultDir().appendingPathComponent(n)
        guard FileManager.default.fileExists(atPath: url.path) else { return call.resolve([:]) }
        do {
            call.resolve(["data": try String(contentsOf: url, encoding: .utf8)])
        } catch {
            call.reject("Read failed")
        }
    }

    @objc func writeAtomic(_ call: CAPPluginCall) {
        guard let n = name(call), let data = call.getString("data") else { return call.reject("No data") }
        do {
            try Data(data.utf8).write(to: vaultDir().appendingPathComponent(n), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            call.resolve()
        } catch {
            call.reject("Write failed")
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let n = name(call) else { return }
        try? FileManager.default.removeItem(at: vaultDir().appendingPathComponent(n))
        call.resolve()
    }

    @objc func stat(_ call: CAPPluginCall) {
        guard let n = name(call) else { return }
        let url = vaultDir().appendingPathComponent(n)
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path) else {
            return call.resolve(["exists": false, "size": 0, "mtime": 0])
        }
        let size = (attrs[.size] as? NSNumber)?.intValue ?? 0
        let mtime = ((attrs[.modificationDate] as? Date) ?? Date()).timeIntervalSince1970 * 1000
        call.resolve(["exists": true, "size": size, "mtime": mtime])
    }

    @objc func list(_ call: CAPPluginCall) {
        let dir = vaultDir()
        let names = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        var files: [[String: Any]] = []
        for n in names where isSafe(n) {
            let attrs = try? FileManager.default.attributesOfItem(atPath: dir.appendingPathComponent(n).path)
            if (attrs?[.type] as? FileAttributeType) != .typeRegular { continue }
            files.append(["name": n, "size": (attrs?[.size] as? NSNumber)?.intValue ?? 0])
        }
        call.resolve(["files": files])
    }

    @objc func rename(_ call: CAPPluginCall) {
        guard let from = name(call, "from"), let to = name(call, "to") else { return }
        let src = vaultDir().appendingPathComponent(from)
        let dst = vaultDir().appendingPathComponent(to)
        do {
            if FileManager.default.fileExists(atPath: dst.path) {
                _ = try FileManager.default.replaceItemAt(dst, withItemAt: src)
            } else {
                try FileManager.default.moveItem(at: src, to: dst)
            }
            call.resolve()
        } catch {
            call.reject("Rename failed")
        }
    }

    @objc func freeSpace(_ call: CAPPluginCall) {
        let values = try? vaultDir().resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        call.resolve(["bytes": values?.volumeAvailableCapacityForImportantUsage ?? -1])
    }

    // ------------------------------------------------- exports & viewing --

    private func writeExportFile(_ name: String, _ data: Data) throws -> URL {
        let url = exportDir().appendingPathComponent(name)
        try data.write(to: url, options: [.atomic, .completeFileProtection])
        return url
    }

    @objc func writeExport(_ call: CAPPluginCall) {
        guard let n = name(call), let data = call.getString("data") else { return call.reject("No data") }
        do {
            call.resolve(["uri": try writeExportFile(n, Data(data.utf8)).absoluteString])
        } catch {
            call.reject("Write failed")
        }
    }

    @objc func writeExportBase64(_ call: CAPPluginCall) {
        guard let n = name(call), let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else { return call.reject("No data") }
        do {
            call.resolve(["uri": try writeExportFile(n, data).absoluteString])
        } catch {
            call.reject("Write failed")
        }
    }

    @objc func clearExports(_ call: CAPPluginCall) {
        try? FileManager.default.removeItem(at: exportDir())
        call.resolve()
    }

    /** Preview (Quick Look) with the system "Open in…" button; the copy lives in the private temp folder. */
    @objc func openFile(_ call: CAPPluginCall) {
        guard let n = name(call), let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else { return call.reject("No data") }
        do {
            let url = try writeExportFile(n, data)
            DispatchQueue.main.async {
                let dc = UIDocumentInteractionController(url: url)
                dc.delegate = self
                self.docController = dc
                if dc.presentPreview(animated: true) {
                    call.resolve()
                } else if let view = self.bridge?.viewController?.view, dc.presentOpenInMenu(from: view.bounds, in: view, animated: true) {
                    call.resolve()
                } else {
                    call.reject("No app can open this file", "NO_APP")
                }
            }
        } catch {
            call.reject("Could not open the file", "ERROR")
        }
    }

    public func documentInteractionControllerViewControllerForPreview(_ controller: UIDocumentInteractionController) -> UIViewController {
        bridge?.viewController ?? UIViewController()
    }

    @objc func renderPdf(_ call: CAPPluginCall) {
        guard let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else { return call.reject("No data") }
        let maxPages = max(1, min(60, call.getInt("maxPages") ?? 30))
        let width = CGFloat(max(320, min(2000, call.getInt("width") ?? 1200)))
        DispatchQueue.global(qos: .userInitiated).async {
            guard let doc = PDFDocument(data: data) else { return call.reject("This PDF could not be displayed", "PDF_ERROR") }
            if doc.isLocked { return call.reject("This PDF is password-protected", "PDF_LOCKED") }
            var pages: [String] = []
            for i in 0..<min(doc.pageCount, maxPages) {
                guard let page = doc.page(at: i) else { continue }
                let box = page.bounds(for: .mediaBox)
                let size = CGSize(width: width, height: max(1, width * box.height / max(1, box.width)))
                let img = page.thumbnail(of: size, for: .mediaBox)
                if let jpg = img.jpegData(compressionQuality: 0.85) {
                    pages.append("data:image/jpeg;base64," + jpg.base64EncodedString())
                }
            }
            call.resolve(["pages": pages, "total": doc.pageCount])
        }
    }

    /** iOS cannot block screenshots; we hide the content in the app switcher instead. */
    @objc func setSecure(_ call: CAPPluginCall) {
        secure = call.getBool("secure") ?? true
        call.resolve()
    }

    @objc private func willResignActive() {
        guard secure else { return }
        DispatchQueue.main.async {
            guard self.privacyCover == nil, let window = self.bridge?.viewController?.view.window else { return }
            let cover = UIVisualEffectView(effect: UIBlurEffect(style: .systemThickMaterial))
            cover.frame = window.bounds
            cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            window.addSubview(cover)
            self.privacyCover = cover
        }
    }

    @objc private func didBecomeActive() {
        DispatchQueue.main.async {
            self.privacyCover?.removeFromSuperview()
            self.privacyCover = nil
        }
    }

    // ------------------------------------------------------------ clipboard --

    @objc func copySecret(_ call: CAPPluginCall) {
        guard let text = call.getString("text") else { return call.reject("No text") }
        let seconds = Double(max(10, min(120, call.getInt("clearAfterSeconds") ?? 30)))
        DispatchQueue.main.async {
            // Local only (no Universal Clipboard to other devices) and expires automatically.
            UIPasteboard.general.setItems([[UTType.plainText.identifier: text]], options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(seconds)])
            self.lastCopied = text
            call.resolve()
        }
    }

    @objc func clearClipboard(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let last = self.lastCopied, UIPasteboard.general.hasStrings, UIPasteboard.general.string == last {
                UIPasteboard.general.items = []
            }
            self.lastCopied = nil
            call.resolve()
        }
    }

    @objc func readClipboard(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["text": UIPasteboard.general.string ?? ""])
        }
    }

    @objc func takeSharedText(_ call: CAPPluginCall) {
        call.resolve(["text": NSNull()])
    }

    /** Delete temporary photos the camera / photo picker left in the temp folder. */
    @objc func purgeCaptures(_ call: CAPPluginCall) {
        let tmp = FileManager.default.temporaryDirectory
        let exts: Set<String> = ["jpg", "jpeg", "png", "heic", "heif", "webp", "gif", "mov", "mp4"]
        if let items = try? FileManager.default.contentsOfDirectory(at: tmp, includingPropertiesForKeys: nil) {
            for url in items where exts.contains(url.pathExtension.lowercased()) {
                try? FileManager.default.removeItem(at: url)
            }
        }
        call.resolve()
    }

    // --------------------------------------------------------- quick unlock --

    @objc func biometricStatus(_ call: CAPPluginCall) {
        let ctx = LAContext()
        var err: NSError?
        let bio = ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &err)
        let any = LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
        call.resolve(["available": any, "biometric": bio, "deviceCredential": any])
    }

    private func baseQuery(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: Self.service, kSecAttrAccount as String: account]
    }

    private func deleteItem(_ account: String) {
        SecItemDelete(baseQuery(account) as CFDictionary)
    }

    /** Store the (already wrapped) key behind Face ID / Touch ID or the device passcode. */
    @objc func bioEncrypt(_ call: CAPPluginCall) {
        guard let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else { return call.reject("No data") }
        let ctx = LAContext()
        ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Turn on quick unlock for VaultLocks") { ok, error in
            if !ok {
                let code = (error as? LAError)?.code
                return call.reject("Canceled", code == .userCancel || code == .appCancel || code == .systemCancel ? "CANCELED" : "ERROR")
            }
            var acErr: Unmanaged<CFError>?
            guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, [.biometryCurrentSet, .or, .devicePasscode], &acErr) else {
                return call.reject("Quick unlock is not available", "UNAVAILABLE")
            }
            self.deleteItem(Self.bioAccount)
            var q = self.baseQuery(Self.bioAccount)
            q[kSecValueData as String] = data
            q[kSecAttrAccessControl as String] = access
            q[kSecUseAuthenticationContext as String] = ctx
            let status = SecItemAdd(q as CFDictionary, nil)
            if status == errSecSuccess {
                call.resolve(["iv": "keychain", "data": "keychain"])
            } else {
                call.reject("Quick unlock is not available", "UNAVAILABLE")
            }
        }
    }

    @objc func bioDecrypt(_ call: CAPPluginCall) {
        let mode = call.getString("mode") ?? "any"
        DispatchQueue.main.async {
            guard UIApplication.shared.applicationState == .active else {
                return call.reject("App is not in the foreground", "NOT_VISIBLE")
            }
            DispatchQueue.global(qos: .userInitiated).async {
                let ctx = LAContext()
                ctx.localizedFallbackTitle = "Use Passcode"
                ctx.localizedReason = mode == "credential" ? "Enter your passcode to unlock VaultLocks" : "Unlock VaultLocks"
                var q = self.baseQuery(Self.bioAccount)
                q[kSecReturnData as String] = true
                q[kSecMatchLimit as String] = kSecMatchLimitOne
                q[kSecUseAuthenticationContext as String] = ctx
                var out: CFTypeRef?
                let status = SecItemCopyMatching(q as CFDictionary, &out)
                switch status {
                case errSecSuccess:
                    guard let data = out as? Data else { return call.reject("Unlock failed", "ERROR") }
                    call.resolve(["data": data.base64EncodedString()])
                case errSecUserCanceled:
                    call.reject("Canceled", "CANCELED")
                case errSecItemNotFound:
                    // Face ID / Touch ID enrollment changed (or the passcode was removed): the item is gone.
                    call.reject("Quick unlock key missing", "INVALIDATED")
                default:
                    call.reject("Unlock failed", "ERROR")
                }
            }
        }
    }

    private func deviceKey(create: Bool) -> SymmetricKey? {
        var q = baseQuery(Self.deviceAccount)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        if SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data {
            return SymmetricKey(data: data)
        }
        guard create else { return nil }
        let key = SymmetricKey(size: .bits256)
        var add = baseQuery(Self.deviceAccount)
        add[kSecValueData as String] = key.withUnsafeBytes { Data($0) }
        add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess ? key : nil
    }

    @objc func deviceEncrypt(_ call: CAPPluginCall) {
        guard let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else { return call.reject("No data") }
        guard let key = deviceKey(create: true), let box = try? AES.GCM.seal(data, using: key) else {
            return call.reject("Device key unavailable", "UNAVAILABLE")
        }
        call.resolve(["iv": Data(box.nonce).base64EncodedString(), "data": (box.ciphertext + box.tag).base64EncodedString()])
    }

    @objc func deviceDecrypt(_ call: CAPPluginCall) {
        guard let ivB64 = call.getString("iv"), let b64 = call.getString("data"),
              let iv = Data(base64Encoded: ivB64), let blob = Data(base64Encoded: b64), blob.count >= 16 else { return call.reject("No data") }
        guard let key = deviceKey(create: false) else { return call.reject("Device key missing", "INVALIDATED") }
        do {
            let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: iv), ciphertext: blob.dropLast(16), tag: blob.suffix(16))
            call.resolve(["data": try AES.GCM.open(box, using: key).base64EncodedString()])
        } catch {
            call.reject("Decryption failed", "ERROR")
        }
    }

    // ------------------------------------------------ phone calendar widgets --

    @objc func phoneCalendarStatus(_ call: CAPPluginCall) {
        call.resolve(["granted": PhoneCalendar.shared.granted])
    }

    @objc func requestPhoneCalendar(_ call: CAPPluginCall) {
        if PhoneCalendar.shared.granted { return call.resolve(["granted": true]) }
        PhoneCalendar.shared.request { ok in call.resolve(["granted": ok]) }
    }

    @objc func syncPhoneCalendar(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        let items: [[String: Any]] = (call.getArray("items", JSObject.self) ?? []).map { $0 as [String: Any] }
        guard PhoneCalendar.shared.granted else {
            if on { call.reject("Allow calendar access for VaultLocks first", "NO_PERMISSION") } else { call.resolve() }
            return
        }
        DispatchQueue.global(qos: .utility).async {
            do {
                if on {
                    let (n, local) = try PhoneCalendar.shared.replace(items)
                    call.resolve(["count": n, "onDevice": local])
                } else {
                    try PhoneCalendar.shared.remove()
                    call.resolve(["count": 0])
                }
            } catch {
                call.reject("Could not update the phone calendar", "CALENDAR_FAILED")
            }
        }
    }

    @objc func openPhoneCalendar(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: "calshow:") else { return call.reject("No calendar app found", "NO_CALENDAR_APP") }
            UIApplication.shared.open(url) { ok in ok ? call.resolve() : call.reject("No calendar app found", "NO_CALENDAR_APP") }
        }
    }

    @objc func resetKey(_ call: CAPPluginCall) {
        let kind = call.getString("kind") ?? ""
        if kind == "biometric" { deleteItem(Self.bioAccount) } else if kind == "device" { deleteItem(Self.deviceAccount) }
        call.resolve()
    }
}

/** Bridge view controller that registers the app's own plugin. */
class VaultBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(VaultNativePlugin())
    }
}
