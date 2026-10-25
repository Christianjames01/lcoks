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
import Vision
import Speech
import AVFoundation

@objc(VaultNativePlugin)
public class VaultNativePlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentInteractionControllerDelegate {
    public let identifier = "VaultNativePlugin"
    public let jsName = "VaultNative"
    public let pluginMethods: [CAPPluginMethod] = [
        "read", "writeAtomic", "remove", "stat", "list", "rename", "freeSpace",
        "writeExport", "writeExportBase64", "clearExports", "openFile", "renderPdf", "setSecure",
        "copySecret", "clearClipboard", "readClipboard", "takeSharedText", "purgeCaptures",
        "biometricStatus", "bioEncrypt", "bioDecrypt", "deviceEncrypt", "deviceDecrypt", "resetKey",
        "phoneCalendarStatus", "requestPhoneCalendar", "syncPhoneCalendar", "openPhoneCalendar",
        "recognizeText", "kloudStatus", "kloudRequestMic", "kloudListen", "kloudStop", "kloudSpeak", "setKloudOnKnock"
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

    /**
     * Camera scan: the text in a photo (base64 JPEG), read with Vision on the
     * phone. The image only lives in memory; lines come back top to bottom.
     */
    @objc func recognizeText(_ call: CAPPluginCall) {
        guard let b64 = call.getString("data"), let bytes = Data(base64Encoded: b64, options: .ignoreUnknownCharacters),
              let image = UIImage(data: bytes), let cg = image.cgImage else {
            call.reject("Could not read the photo.")
            return
        }
        let request = VNRecognizeTextRequest { req, err in
            if err != nil {
                call.reject("Could not read text in the photo.")
                return
            }
            let found = (req.results as? [VNRecognizedTextObservation]) ?? []
            // Vision's boxes start bottom-left: higher y = nearer the top.
            let sorted = found.sorted { a, b in
                abs(a.boundingBox.midY - b.boundingBox.midY) > a.boundingBox.height / 2
                    ? a.boundingBox.midY > b.boundingBox.midY
                    : a.boundingBox.minX < b.boundingBox.minX
            }
            call.resolve(["lines": sorted.compactMap { $0.topCandidates(1).first?.string }])
        }
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try VNImageRequestHandler(cgImage: cg, orientation: VaultNativePlugin.orientation(image.imageOrientation)).perform([request])
            } catch {
                call.reject("Could not read text in the photo.")
            }
        }
    }

    private static func orientation(_ o: UIImage.Orientation) -> CGImagePropertyOrientation {
        switch o {
        case .up: return .up
        case .down: return .down
        case .left: return .left
        case .right: return .right
        case .upMirrored: return .upMirrored
        case .downMirrored: return .downMirrored
        case .leftMirrored: return .leftMirrored
        case .rightMirrored: return .rightMirrored
        @unknown default: return .up
        }
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

// MARK: - Kloud (voice assistant)

/**
 * Kloud's ears and voice on iPhone: Apple's speech recognition (on the device
 * when the language model is there, so nothing leaves the phone) and Apple's
 * text-to-speech. The app (src/shared/kloud.ts) decides what to do and say.
 */
final class KloudEars: NSObject {
    static let shared = KloudEars()
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var heard = ""
    private var finished = true
    private var silence: Timer?
    private var limit: Timer?
    private var done: ((String?, String?) -> Void)?
    private var lastLevel = Date.distantPast
    let voice = AVSpeechSynthesizer()

    var micGranted: Bool {
        AVAudioSession.sharedInstance().recordPermission == .granted && SFSpeechRecognizer.authorizationStatus() == .authorized
    }

    /** Listen until a short silence; done(text, nil) or done(nil, message). onEvent gets partial text and loudness. */
    func listen(onEvent: @escaping ([String: Any]) -> Void, done: @escaping (String?, String?) -> Void) {
        stop(deliver: false)
        guard let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer(), recognizer.isAvailable else {
            done(nil, "Speech recognition isn't available right now.")
            return
        }
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .defaultToSpeaker])
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            done(nil, "The microphone is busy. Try again in a moment.")
            return
        }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
        request = req
        heard = ""
        finished = false
        self.done = done
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            req.append(buffer)
            guard let self, let data = buffer.floatChannelData?[0] else { return }
            let n = Int(buffer.frameLength)
            var sum: Float = 0
            for i in 0..<n { sum += data[i] * data[i] }
            let rms = n > 0 ? sqrt(sum / Float(n)) : 0
            let db = 20 * log10(max(rms, 0.000_01)) + 60 // about 0…60
            let now = Date()
            if now.timeIntervalSince(self.lastLevel) > 0.08 {
                self.lastLevel = now
                DispatchQueue.main.async { onEvent(["level": Double(db / 5)]) }
            }
        }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            stop(deliver: false)
            done(nil, "Couldn't start the microphone. Try again.")
            return
        }
        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self, !self.finished else { return }
                if let result {
                    self.heard = result.bestTranscription.formattedString
                    onEvent(["partial": self.heard])
                    self.armSilence()
                    if result.isFinal { self.stop(deliver: true) }
                }
                if error != nil { self.stop(deliver: true) }
            }
        }
        limit = Timer.scheduledTimer(withTimeInterval: 12, repeats: false) { [weak self] _ in self?.stop(deliver: true) }
    }

    private func armSilence() {
        silence?.invalidate()
        silence = Timer.scheduledTimer(withTimeInterval: 1.6, repeats: false) { [weak self] _ in self?.stop(deliver: true) }
    }

    /** Stop listening; deliver what was heard (or "didn't catch that"). */
    func stop(deliver: Bool) {
        silence?.invalidate()
        limit?.invalidate()
        silence = nil
        limit = nil
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        let wasFinished = finished
        finished = true
        let cb = done
        done = nil
        guard deliver, !wasFinished, let cb else { return }
        let text = heard.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { cb(nil, "I didn't catch that. Try again.") } else { cb(text, nil) }
    }

    func speak(_ text: String) {
        voice.stopSpeaking(at: .immediate)
        guard !text.isEmpty else { return }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        let u = AVSpeechUtterance(string: text)
        u.voice = AVSpeechSynthesisVoice(language: Locale.current.identifier.replacingOccurrences(of: "_", with: "-")) ?? AVSpeechSynthesisVoice(language: "en-US")
        u.pitchMultiplier = 0.95
        voice.speak(u)
    }
}

extension VaultNativePlugin {
    @objc func kloudStatus(_ call: CAPPluginCall) {
        let r = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer()
        call.resolve([
            "available": r?.isAvailable ?? false,
            "onDevice": r?.supportsOnDeviceRecognition ?? false,
            "mic": KloudEars.shared.micGranted,
            "onKnock": false
        ])
    }

    @objc func kloudRequestMic(_ call: CAPPluginCall) {
        SFSpeechRecognizer.requestAuthorization { _ in
            AVAudioSession.sharedInstance().requestRecordPermission { _ in
                DispatchQueue.main.async { self.kloudStatus(call) }
            }
        }
    }

    @objc func kloudListen(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard KloudEars.shared.micGranted else {
                call.reject("Allow the microphone and speech recognition for Kloud first", "NO_PERMISSION")
                return
            }
            KloudEars.shared.listen(onEvent: { [weak self] e in
                self?.notifyListeners("kloud", data: e)
            }, done: { text, error in
                if let text { call.resolve(["text": text]) } else { call.reject(error ?? "I didn't catch that.", "KLOUD") }
            })
        }
    }

    @objc func kloudStop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { KloudEars.shared.stop(deliver: true) }
        call.resolve()
    }

    @objc func kloudSpeak(_ call: CAPPluginCall) {
        let text = call.getString("text") ?? ""
        DispatchQueue.main.async { KloudEars.shared.speak(text) }
        call.resolve()
    }

    /** iPhone has no back-tap pop-up of its own (Back Tap runs the "Ask Kloud" shortcut instead). */
    @objc func setKloudOnKnock(_ call: CAPPluginCall) {
        call.resolve()
    }
}
