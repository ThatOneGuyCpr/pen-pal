import SwiftUI
import UIKit
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
    @State private var deskPath = NavigationPath()
    @State private var journalsPath = NavigationPath()
    @State private var sentPath = NavigationPath()
    @State private var poemsPath = NavigationPath()
    @State private var askUndo = false

    var body: some View {
        TabView(selection: $tab) {
            NavigationStack(path: $deskPath) { DeskView(tab: $tab) }
                .tabItem { Label("Desk", systemImage: "tray") }.tag(0)
            NavigationStack(path: $journalsPath) { JournalsView() }
                .tabItem { Label("Journals", systemImage: "book.closed") }.tag(1)
            NavigationStack(path: $poemsPath) { PoemsView() }
                .tabItem { Label("Poems", systemImage: "pencil.line") }.tag(2)
            NavigationStack(path: $sentPath) { SentView() }
                .tabItem { Label("Sent", systemImage: "envelope") }.tag(3)
            NavigationStack { SettingsView() }
                .tabItem { Label("Settings", systemImage: "gearshape") }.tag(4)
        }
        .tint(P.blue)
        .safeAreaInset(edge: .top, spacing: 0) { SyncNotices() }
        .overlay(alignment: .top) { Stripe().ignoresSafeArea(edges: .top) }
        .overlay(alignment: .bottom) { UndoBarView().padding(.bottom, 92) }
        .onReceive(NotificationCenter.default.publisher(for: .penPalShake)) { _ in
            if let h = store.history, !(h.undo.isEmpty && h.redo.isEmpty) { askUndo = true }
        }
        .alert(undoTitle, isPresented: $askUndo) {
            if let h = store.history, !h.undo.isEmpty { Button("Undo") { store.undo() } }
            if let h = store.history, !h.redo.isEmpty { Button("Redo") { store.redo() } }
            Button("Cancel", role: .cancel) {}
        }
        .onAppear(perform: demo)
    }

    private var undoTitle: String {
        guard let h = store.history else { return "Undo" }
        return h.undo.isEmpty ? "Redo: \(h.redo)" : "Undo: \(h.undo)"
    }

    /// For the build's screenshots: open a given screen.
    private func demo() {
        let s = store.demoScreen
        if s == "journals" || s.hasPrefix("journal:") { tab = 1 }
        if s.hasPrefix("journal:") { journalsPath.append(JournalRoute(id: String(s.dropFirst(8)))) }
        if s == "poems" || s.hasPrefix("poem:") { tab = 2 }
        if s.hasPrefix("poem:") { poemsPath.append(PoemRoute(id: String(s.dropFirst(5)))) }
        if s == "find" || s == "filters" || s == "quickadd" || s.hasPrefix("dir:") { tab = 1; journalsPath.append(FindRoute()) }
        if s.hasPrefix("dir:") { journalsPath.append(DirRoute(id: String(s.dropFirst(4)))) }
        if s == "sent" || s == "insights" || s.hasPrefix("editsub:") { tab = 3 }
        if s == "insights" { sentPath.append(InsightsRoute()) }
        if s == "budget" { deskPath.append(BudgetRoute()) }
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
                Button("Try again") { store.start() }.buttonStyle(PrimaryButtonStyle(wide: true))
                Button("Choose another folder") { store.forgetFolder() }.buttonStyle(PrimaryButtonStyle(quiet: true, wide: true))
            }
            .padding(.horizontal, 24)
            Spacer()
        }
        .background(P.bg)
        .ignoresSafeArea(edges: .top)
    }
}

/// The bar after a change: what happened, and Undo (or Redo after an undo). Shaking the phone also offers it.
struct UndoBarView: View {
    @Environment(Store.self) private var store

    var body: some View {
        if let bar = store.undoBar {
            HStack(spacing: 12) {
                Text(bar.text).font(F.sans(14.5)).lineLimit(2)
                Spacer(minLength: 4)
                Button(bar.redo ? "Redo" : "Undo") { bar.redo ? store.redo() : store.undo() }
                    .font(F.sans(15, .bold))
                    .frame(minWidth: 44, minHeight: 44)
            }
            .padding(.leading, 18).padding(.trailing, 8)
            .foregroundStyle(P.bg)
            .background(P.ink, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .padding(.horizontal, 16)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .animation(.snappy, value: bar)
        }
    }
}

extension Notification.Name {
    static let penPalShake = Notification.Name("penPalShake")
}

/// Shake to undo, as across iOS.
extension UIWindow {
    open override func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
        if motion == .motionShake { NotificationCenter.default.post(name: .penPalShake, object: nil) }
        super.motionEnded(motion, with: event)
    }
}
