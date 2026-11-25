import SwiftUI
import UniformTypeIdentifiers
import UserNotifications

struct SettingsView: View {
    @Environment(Store.self) private var store
    @State private var picking = false
    @State private var check: FolderCheck?
    @State private var remindHere = true
    @State private var permission: UNAuthorizationStatus = .notDetermined
    @State private var testResult = ""

    var body: some View {
        let s = store.settings
        Form {
            Section {
                LabeledContent {
                    Button("Change") { picking = true }
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(store.folder?.displayName ?? "No folder")
                        Text(store.syncLine.isEmpty ? "Up to date" : store.syncLine).font(F.sans(13)).foregroundStyle(P.muted)
                    }
                }
                LabeledContent("Backups on this iPhone", value: "\(Local.backupCount)")
                NavigationLink("Fee budget", value: BudgetRoute())
            } header: { ListHeader("Your data") } footer: {
                ListFooter("Shared with your PCs through iCloud Drive. If two devices change things before iCloud catches up, Pen Pal asks which to keep. Backups are in the Files app, under Pen Pal.")
            }

            Section {
                Toggle("Remind me on this iPhone", isOn: $remindHere)
                    .tint(P.blue)
                    .onChange(of: remindHere) { _, on in
                        store.reminders.enabled = on
                        Task {
                            if on, await store.reminders.status() == .notDetermined { _ = await store.reminders.requestPermission() }
                            permission = await store.reminders.status()
                            store.becameActive()
                        }
                    }
                if let s {
                    Stepper(value: Binding(get: { s.notifyDays }, set: { store.change("setSetting", "notifyDays", "\($0)") }), in: 0...30) {
                        LabeledContent("How far ahead", value: s.notifyDays == 0 ? "On the day" : "\(s.notifyDays) day\(s.notifyDays == 1 ? "" : "s"), 9 AM")
                    }
                }
                let plan = store.plan
                if !plan.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Coming up").font(F.sans(13, .semibold)).foregroundStyle(P.muted)
                        ForEach(plan.prefix(5)) { p in
                            Text(p.title + " (" + shortDay(p.fire) + ")").font(F.sans(14))
                        }
                    }
                }
                Button("Send a test notification") {
                    Task { testResult = await store.reminders.sendTest() ?? "Sent. It should appear in a moment." }
                }
                if !testResult.isEmpty { Text(testResult).font(F.sans(13)).foregroundStyle(P.muted) }
            } header: { ListHeader("Reading period reminders") } footer: {
                if permission == .denied {
                    ListFooter("Notifications are off for Pen Pal. Turn them on in the iPhone's Settings, Notifications. In LiveContainer, also turn on Fix File Picker & Local Notification for Pen Pal.")
                } else {
                    ListFooter("Ring the bell on a journal to get these. Your PCs remind you too; if you get both, turn one off.")
                }
            }

            if let s {
                Section(header: ListHeader("Appearance")) {
                    Picker("Theme", selection: Binding(get: { s.theme }, set: { store.change("setSetting", "theme", "\"\($0)\"") })) {
                        Text("Match iPhone").tag("system")
                        Text("Light").tag("light")
                        Text("Dark").tag("dark")
                    }
                    .pickerStyle(.segmented)
                }
            }

            Section {
                Text("Pen Pal for iPhone \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""). Titles and notes only; your poems stay in your own files.")
                    .font(F.sans(13)).foregroundStyle(P.muted)
                Link("Pen Pal on GitHub", destination: URL(string: "https://github.com/ThatOneGuyCpr/pen-pal")!)
            }
        }
        .scrollContentBackground(.hidden)
        .background(P.bg)
        .navigationTitle("Settings")
        .navigationDestination(for: BudgetRoute.self) { _ in BudgetView() }
        .fileImporter(isPresented: $picking, allowedContentTypes: [.folder]) { result in
            if case .success(let url) = result { check = store.inspect(url) }
        }
        .confirmationDialog(confirmTitle, isPresented: Binding(get: { check != nil }, set: { if !$0 { check = nil } }), titleVisibility: .visible) {
            if let c = check, c.error == nil {
                Button(c.summary == nil ? "Start a new file there" : "Use that data") { store.connect(c.url); check = nil }
            }
            Button("Cancel", role: .cancel) { check = nil }
        } message: {
            Text(confirmMessage)
        }
        .task {
            remindHere = store.reminders.enabled
            permission = await store.reminders.status()
        }
    }

    private var confirmTitle: String { check?.display ?? "" }
    private var confirmMessage: String {
        guard let c = check else { return "" }
        if let e = c.error { return e }
        if let s = c.summary { return "This folder has Pen Pal data: \(s.counts), saved \(s.saved). Pen Pal will use it from now on." }
        return "No Pen Pal data here. Pen Pal will start a new, empty file. The data in your current folder stays where it is."
    }

    private func shortDay(_ d: String) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        guard let date = f.date(from: d) else { return d }
        let out = DateFormatter()
        out.dateFormat = "MMM d"
        return out.string(from: date)
    }
}
