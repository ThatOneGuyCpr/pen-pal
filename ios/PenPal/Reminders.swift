import Foundation
import UserNotifications

/// Reading-period reminders as notifications scheduled on this iPhone. What is due when comes from
/// logic.js (windowAlerts, through the bridge's reminderPlan). They are scheduled ahead, so they arrive
/// with the app closed; no push and no background refresh are needed. The record of reminders already
/// shown (reminders-sent.json) is shared with the PCs, so a reminder a PC showed is not scheduled here.
@MainActor
final class Reminders {
    private let center = UNUserNotificationCenter.current()
    private let prefix = "pp:"
    private let firedKey = "remindersFiredNow"

    var enabled: Bool {
        get { UserDefaults.standard.object(forKey: "remindOnThisIPhone") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "remindOnThisIPhone") }
    }

    func status() async -> UNAuthorizationStatus {
        await center.notificationSettings().authorizationStatus
    }

    func requestPermission() async -> Bool {
        (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
    }

    /// Keys shown already: on a PC (reminders-sent.json), or fired right away here.
    func alreadyShown(in folder: DataFolder) -> [String] {
        var keys = Set(readSent(folder).keys)
        let fired = (UserDefaults.standard.dictionary(forKey: firedKey) as? [String: String]) ?? [:]
        keys.formUnion(fired.keys)
        return Array(keys)
    }

    private func readSent(_ folder: DataFolder) -> [String: String] {
        guard let data = try? folder.read(folder.sentFile),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return obj.compactMapValues { $0 as? String }
    }

    func schedule(_ plan: [PlanItem], folder: DataFolder) {
        Task { await reschedule(plan, folder: folder) }
    }

    private func reschedule(_ plan: [PlanItem], folder: DataFolder) async {
        await recordDelivered(folder)
        let pending = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(prefix) }
        center.removePendingNotificationRequests(withIdentifiers: pending)
        let permission = await status()
        guard enabled, permission == .authorized || permission == .provisional else { return }
        let skip = Set(alreadyShown(in: folder))
        var fired = (UserDefaults.standard.dictionary(forKey: firedKey) as? [String: String]) ?? [:]
        let now = Date()
        for item in plan.prefix(50) where !skip.contains(item.key) {
            let parts = item.fire.split(separator: "-").compactMap { Int($0) }
            guard parts.count == 3 else { continue }
            var when = DateComponents()
            when.year = parts[0]; when.month = parts[1]; when.day = parts[2]; when.hour = 9; when.minute = 0
            guard let fireDate = Calendar.current.date(from: when) else { continue }
            let content = UNMutableNotificationContent()
            content.title = item.title
            content.body = item.body
            content.sound = .default
            content.threadIdentifier = "reading-periods"
            content.userInfo = ["key": item.key, "date": item.date]
            let trigger: UNNotificationTrigger
            if fireDate > now {
                trigger = UNCalendarNotificationTrigger(dateMatching: when, repeats: false)
            } else {
                trigger = UNTimeIntervalNotificationTrigger(timeInterval: 3, repeats: false)  // due today and past 9 AM
                fired[item.key] = item.date
            }
            try? await center.add(UNNotificationRequest(identifier: prefix + item.key, content: content, trigger: trigger))
        }
        let today = Store.day(now)
        UserDefaults.standard.set(fired.filter { $0.value >= today }, forKey: firedKey)
    }

    /// Notifications this iPhone showed go into the shared record, so your PCs don't show them again.
    private func recordDelivered(_ folder: DataFolder) async {
        let delivered = await center.deliveredNotifications().filter { $0.request.identifier.hasPrefix(prefix) }
        guard !delivered.isEmpty else { return }
        var sent = readSent(folder)
        var changed = false
        for n in delivered {
            let key = String(n.request.identifier.dropFirst(prefix.count))
            let date = (n.request.content.userInfo["date"] as? String) ?? String(key.split(separator: ":").last ?? "")
            if sent[key] == nil { sent[key] = date; changed = true }
        }
        guard changed, let data = try? JSONSerialization.data(withJSONObject: sent, options: [.prettyPrinted, .sortedKeys]) else { return }
        try? folder.write(data, to: folder.sentFile)
    }

    func sendTest() async -> String? {
        if await status() == .notDetermined { _ = await requestPermission() }
        let permission = await status()
        guard permission == .authorized || permission == .provisional else { return "Notifications are off for Pen Pal. Turn them on in the iPhone's Settings, Notifications." }
        let content = UNMutableNotificationContent()
        content.title = "Pen Pal notifications are on"
        content.body = "Reminders look like this, a few days before a reading period opens or closes."
        content.sound = .default
        try? await center.add(UNNotificationRequest(identifier: "test-\(UUID().uuidString)", content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: 2, repeats: false)))
        return nil
    }
}

/// Show reminders even while Pen Pal is open.
final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }
}
