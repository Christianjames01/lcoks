// "Show in the phone's calendar widgets" on iPhone: copies the next days' events and
// tasks into a "VaultLocks" calendar so the iPhone's own Calendar widgets (lock screen
// "Up Next", home screen) show them. Same items as Android (src/shared/phoneCalendar.ts).
// Prefers the on-device ("On My iPhone") source so nothing syncs to iCloud.

import EventKit
import Foundation
import UIKit

final class PhoneCalendar {
    static let shared = PhoneCalendar()
    private let store = EKEventStore()
    private let idKey = "vaultlocks.phoneCalendarId"
    private let title = "VaultLocks"

    var granted: Bool {
        let s = EKEventStore.authorizationStatus(for: .event)
        if #available(iOS 17.0, *) { return s == .fullAccess }
        return s == .authorized
    }

    func request(_ done: @escaping (Bool) -> Void) {
        let finish: (Bool, Error?) -> Void = { ok, _ in DispatchQueue.main.async { done(ok) } }
        if #available(iOS 17.0, *) { store.requestFullAccessToEvents(completion: finish) }
        else { store.requestAccess(to: .event, completion: finish) }
    }

    /// The on-device source if the iPhone has one (it is hidden while iCloud Calendars is on).
    private func source() -> (EKSource, Bool)? {
        if let local = store.sources.first(where: { $0.sourceType == .local }) { return (local, true) }
        if let def = store.defaultCalendarForNewEvents?.source { return (def, false) }
        return store.sources.first(where: { $0.sourceType == .calDAV }).map { ($0, false) }
    }

    private func calendar(create: Bool) throws -> EKCalendar? {
        if let id = UserDefaults.standard.string(forKey: idKey), let cal = store.calendar(withIdentifier: id) { return cal }
        if let cal = store.calendars(for: .event).first(where: { $0.title == title && $0.allowsContentModifications }) {
            UserDefaults.standard.set(cal.calendarIdentifier, forKey: idKey)
            return cal
        }
        guard create, let (src, _) = source() else { return nil }
        let cal = EKCalendar(for: .event, eventStore: store)
        cal.title = title
        cal.source = src
        cal.cgColor = UIColor(white: 0.56, alpha: 1).cgColor
        try store.saveCalendar(cal, commit: true)
        UserDefaults.standard.set(cal.calendarIdentifier, forKey: idKey)
        return cal
    }

    /// Replace everything in the VaultLocks calendar. Returns (count, onDeviceOnly).
    func replace(_ items: [[String: Any]]) throws -> (Int, Bool) {
        guard let cal = try calendar(create: true) else { return (-1, false) }
        let from = Date().addingTimeInterval(-400 * 86_400)
        let to = Date().addingTimeInterval(400 * 86_400)
        for e in store.events(matching: store.predicateForEvents(withStart: from, end: to, calendars: [cal])) {
            try store.remove(e, span: .thisEvent, commit: false)
        }
        var n = 0
        for it in items.prefix(300) {
            guard let start = it["start"] as? Double, let end = it["end"] as? Double else { continue }
            let e = EKEvent(eventStore: store)
            e.calendar = cal
            e.title = ((it["title"] as? String) ?? "VaultLocks").trimmingCharacters(in: .whitespaces)
            let allDay = (it["allDay"] as? Bool) == true
            e.isAllDay = allDay
            if allDay {
                // Sent as UTC midnight → use that calendar day in the phone's time zone.
                var utc = Calendar(identifier: .gregorian)
                utc.timeZone = TimeZone(identifier: "UTC")!
                let d = utc.dateComponents([.year, .month, .day], from: Date(timeIntervalSince1970: start / 1000))
                let local = Calendar.current.date(from: d) ?? Date(timeIntervalSince1970: start / 1000)
                e.startDate = local
                e.endDate = local
            } else {
                e.startDate = Date(timeIntervalSince1970: start / 1000)
                e.endDate = Date(timeIntervalSince1970: max(end, start + 60_000) / 1000)
            }
            // VaultLocks rings its own reminders: no alarms here.
            try store.save(e, span: .thisEvent, commit: false)
            n += 1
        }
        try store.commit()
        return (n, cal.source.sourceType == .local)
    }

    func remove() throws {
        guard let cal = try calendar(create: false) else { return }
        try store.removeCalendar(cal, commit: true)
        UserDefaults.standard.removeObject(forKey: idKey)
    }
}
