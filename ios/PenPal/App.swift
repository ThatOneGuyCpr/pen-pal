import SwiftUI
import UserNotifications

@main
@MainActor
struct PenPalApp: App {
    @State private var store = Store()
    @Environment(\.scenePhase) private var scenePhase
    private let notifications = NotificationDelegate()

    init() {
        Appearance.apply()
        UNUserNotificationCenter.current().delegate = notifications
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .task { store.start() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { store.becameActive() }
        }
    }
}

struct RootView: View {
    @Environment(Store.self) private var store

    var body: some View {
        Group {
            switch store.phase {
            case .starting:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity).background(P.bg)
            case .needsFolder:
                ConnectView()
            case .ready:
                MainTabs()
            case .problem(let message):
                ProblemView(message: message)
            }
        }
        .font(F.sans(16))
        .foregroundStyle(P.ink)
        .preferredColorScheme(store.theme == "dark" ? .dark : store.theme == "light" ? .light : nil)
    }
}

struct MainTabs: View {
    @Environment(Store.self) private var store
    @State private var tab = 0
    @State private var journalsPath = NavigationPath()

    var body: some View {
        TabView(selection: $tab) {
            NavigationStack { DeskView(tab: $tab) }
                .tabItem { Label("Desk", systemImage: "tray") }.tag(0)
            NavigationStack(path: $journalsPath) { JournalsView() }
                .tabItem { Label("Journals", systemImage: "book.closed") }.tag(1)
            NavigationStack { PoemsView() }
                .tabItem { Label("Poems", systemImage: "pencil.line") }.tag(2)
            NavigationStack { SentView() }
                .tabItem { Label("Sent", systemImage: "envelope") }.tag(3)
            NavigationStack { SettingsView() }
                .tabItem { Label("Settings", systemImage: "gearshape") }.tag(4)
        }
        .tint(P.blue)
        .safeAreaInset(edge: .top, spacing: 0) { SyncNotices() }
        .overlay(alignment: .top) { Stripe().ignoresSafeArea(edges: .top) }
        .onAppear(perform: demo)
    }

    /// For the build's screenshots: open a given screen.
    private func demo() {
        let s = store.demoScreen
        if s == "journals" || s.hasPrefix("journal:") { tab = 1 }
        if s.hasPrefix("journal:") { journalsPath.append(JournalRoute(id: String(s.dropFirst(8)))) }
        if s == "poems" { tab = 2 }
        if s == "sent" { tab = 3 }
        if s == "settings" { tab = 4 }
    }
}

/// Notices about saving and syncing, pinned above every screen.
struct SyncNotices: View {
    @Environment(Store.self) private var store

    var body: some View {
        VStack(spacing: 0) {
            if let banner = store.banner {
                HStack(alignment: .top, spacing: 10) {
                    Text(banner).font(F.sans(14)).frame(maxWidth: .infinity, alignment: .leading)
                    Button { store.banner = nil } label: { Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)) }
                        .accessibilityLabel("Dismiss")
                        .frame(width: 44, height: 44)
                }
                .padding(.leading, 16)
                .background(P.redSoft)
            }
            if let lost = store.lost {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Changes made on this iPhone were replaced").font(F.sans(15, .semibold))
                    Text("Another device saved a version (\(lost.theirs.saved), \(lost.theirs.counts)) that does not include this iPhone's last save (\(lost.mine.saved), \(lost.mine.counts)). The one you don't keep goes to Backups on this iPhone.")
                        .font(F.sans(13.5)).foregroundStyle(P.ink2)
                    HStack {
                        Button("Keep this iPhone's") { store.keepMine() }.buttonStyle(PrimaryButtonStyle())
                        Button("Keep the other") { store.keepTheirs() }.buttonStyle(PrimaryButtonStyle(quiet: true))
                    }
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(P.blueSoft)
            }
            ForEach(store.conflicts) { c in
                VStack(alignment: .leading, spacing: 8) {
                    Text("Your iCloud folder has a second copy of your data").font(F.sans(15, .semibold))
                    Text("\(c.name): \(c.summary.map { $0.counts + ($0.saved.isEmpty ? "" : ", saved " + $0.saved) } ?? "Pen Pal cannot read it"). The one you don't keep goes to Backups on this iPhone.")
                        .font(F.sans(13.5)).foregroundStyle(P.ink2)
                    HStack {
                        Button("Keep the one in use") { store.resolveCopy(c.name, useCopy: false) }.buttonStyle(PrimaryButtonStyle())
                        if c.summary != nil {
                            Button("Use the copy") { store.resolveCopy(c.name, useCopy: true) }.buttonStyle(PrimaryButtonStyle(quiet: true))
                        }
                    }
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(P.blueSoft)
            }
        }
    }
}

struct ProblemView: View {
    @Environment(Store.self) private var store
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Stripe()
            Spacer().frame(height: 40)
            Text("Pen Pal can't open your data").font(F.serif(28)).padding(.horizontal, 24)
            Text(message).foregroundStyle(P.ink2).padding(.horizontal, 24)
            VStack(spacing: 8) {
                Button("Try again") { store.start() }.buttonStyle(PrimaryButtonStyle()).frame(maxWidth: .infinity)
                Button("Choose another folder") { store.forgetFolder() }.buttonStyle(PrimaryButtonStyle(quiet: true))
            }
            .padding(.horizontal, 24)
            Spacer()
        }
        .background(P.bg)
        .ignoresSafeArea(edges: .top)
    }
}
