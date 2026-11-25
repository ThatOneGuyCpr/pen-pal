import Foundation
import Observation
import UIKit

struct LostNotice: Equatable {
    var mine: Summary
    var theirs: Summary
}

struct ConflictNotice: Identifiable, Equatable {
    var name: String
    var summary: Summary?
    var id: String { name }
}

struct FolderCheck: Equatable {
    var url: URL
    var display: String
    var summary: Summary?   // nil: no Pen Pal data there yet
    var error: String?
}

/// The app's state. The document lives in the bridge; `version` goes up whenever it changes,
/// and every screen reads it, so SwiftUI redraws.
@MainActor
@Observable
final class Store {
    enum Phase: Equatable { case starting, needsFolder, ready, problem(String) }

    var phase: Phase = .starting
    var version = 0
    var syncLine = ""
    var banner: String?
    var lost: LostNotice?
    var conflicts: [ConflictNotice] = []
    var theme = "system"
    var undoBar: UndoBar?
    var demoScreen = ProcessInfo.processInfo.environment["PENPAL_SCREEN"] ?? ""

    let bridge = Bridge()
    let reminders = Reminders()
    private(set) var folder: DataFolder?
    @ObservationIgnored private var base = Meta.empty
    @ObservationIgnored private var timer: Timer?

    var machine: String { UIDevice.current.name }

    var today: String { Store.day(Date()) }

    static func day(_ date: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    private var nowISO: String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        return f.string(from: Date())
    }

    private var clock: String {
        let f = DateFormatter()
        f.dateFormat = "h:mm a"
        return f.string(from: Date())
    }

    private func newId() -> String { String(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(16)) }

    // MARK: - opening

    func start() {
        if demoScreen == "connect" { phase = .needsFolder; return }
        guard let url = FolderAccess.restore() else { phase = .needsFolder; return }
        open(DataFolder(url: url))
    }

    /// Look at a folder before using it (the first-run screen and Settings use this).
    func inspect(_ url: URL) -> FolderCheck {
        _ = url.startAccessingSecurityScopedResource()
        let f = DataFolder(url: url)
        do {
            guard let data = try f.read(f.file) else { return FolderCheck(url: url, display: f.displayName, summary: nil, error: nil) }
            guard let text = String(data: data, encoding: .utf8), let s = bridge.json(Summary.self, "summary", text) else {
                return FolderCheck(url: url, display: f.displayName, summary: nil, error: "There is a tracker.json here that Pen Pal cannot read.")
            }
            return FolderCheck(url: url, display: f.displayName, summary: s, error: nil)
        } catch {
            return FolderCheck(url: url, display: f.displayName, summary: nil, error: "Pen Pal cannot open that folder: \(error.localizedDescription)")
        }
    }

    /// Use a folder: the data already in it, or a fresh file when it has none.
    func connect(_ url: URL) {
        do {
            try FolderAccess.remember(url)
        } catch {
            phase = .problem("Pen Pal could not keep access to that folder: \(error.localizedDescription)")
            return
        }
        try? FileManager.default.removeItem(at: Local.lastSaved)  // nothing of this iPhone's can be missing from a folder it just picked
        let f = DataFolder(url: url)
        if !f.exists(f.file) {
            bridge.run("fresh")
            folder = f
            base = .empty
            save(rereadFirst: false)
        }
        open(f)
    }

    func forgetFolder() {
        FolderAccess.forget()
        folder = nil
        timer?.invalidate()
        phase = .needsFolder
    }

    func open(_ f: DataFolder) {
        folder = f
        do {
            guard let data = try f.read(f.file) else {
                phase = .problem("Pen Pal keeps your data in \(f.displayName), but tracker.json is not there. If it syncs from iCloud, give it a moment, then try again.")
                return
            }
            try load(data)
            phase = .ready
            checkNotices(current: data)
            startTimer()
            afterChange()
        } catch {
            phase = .problem("Pen Pal could not read your data: \(error.localizedDescription)")
        }
    }

    private func load(_ data: Data) throws {
        guard let text = String(data: data, encoding: .utf8), let meta = bridge.json(Meta.self, "load", text) else {
            throw StoreError(message: bridge.lastError ?? "That file is not Pen Pal data.")
        }
        base = meta
        theme = settings?.theme ?? "system"
        version += 1
    }

    private func startTimer() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
    }

    func becameActive() {
        switch phase {
        case .ready:
            refresh()
            afterChange()
        case .problem:
            start()
        default:
            break
        }
    }

    // MARK: - staying in step with the other devices

    /// Has the file changed underneath us (your PC saved)? Then show its version.
    func refresh() {
        guard phase == .ready, let f = folder, let data = try? f.read(f.file),
              let text = String(data: data, encoding: .utf8), let meta = bridge.json(Meta.self, "metaOf", text) else { return }
        if meta.saveId != base.saveId || meta.rev != base.rev {
            if (try? load(data)) != nil {
                syncLine = "Updated with changes saved \(meta.savedOn.isEmpty ? "elsewhere" : "on " + meta.savedOn)"
            }
        }
        checkNotices(current: data)
    }

    private func checkNotices(current: Data) {
        guard let f = folder, let currentText = String(data: current, encoding: .utf8) else { return }
        var newLost: LostNotice?
        if let mine = try? Data(contentsOf: Local.lastSaved), let mineText = String(data: mine, encoding: .utf8),
           let mineMeta = bridge.json(Meta.self, "metaOf", mineText), !mineMeta.saveId.isEmpty,
           let builds = bridge.run("buildsOn", currentText, mineMeta.saveId), !builds.toBool(),
           let a = bridge.json(Summary.self, "summary", mineText), let b = bridge.json(Summary.self, "summary", currentText) {
            newLost = LostNotice(mine: a, theirs: b)
        }
        if newLost != lost { lost = newLost }
        var copies: [ConflictNotice] = []
        for url in f.conflictCopies() {
            var summary: Summary?
            if let d = try? f.read(url), let text = String(data: d, encoding: .utf8) {
                summary = bridge.json(Summary.self, "summary", text)
            }
            copies.append(ConflictNotice(name: url.lastPathComponent, summary: summary))
        }
        if copies != conflicts { conflicts = copies }
    }

    /// What each change is called in the Undo bar.
    private static let labels: [String: String] = [
        "setNotify": "Changed a reminder bell", "logSubmission": "Logged a submission", "saveSub": "Edited a submission",
        "setSubStatus": "Recorded an answer", "withdraw": "Marked a poem withdrawn", "markQueried": "Noted your follow-up",
        "snooze": "Snoozed a follow-up", "saveJournal": "Saved a journal", "removeJournal": "Removed a journal",
        "addFromDirectory": "Added a journal", "savePoem": "Saved a poem", "addTitles": "Added poems", "removePoem": "Removed a poem",
        "removeSub": "Removed a submission", "setSetting": "Changed a setting", "saveBudget": "Changed the fee budget",
    ]

    /// Change the document: catch up with the file first, apply the change in logic.js, then save.
    /// A change that changes nothing is not saved and leaves nothing to undo.
    @discardableResult
    func change(_ name: String, _ args: Any...) -> String? {
        refresh()
        let label = Store.labels[name] ?? "Changed something"
        let before = bridge.raw("json")
        bridge.run("checkpoint", label)
        guard let value = bridge.invoke(name, args) else {
            let error = bridge.lastError ?? "unknown error"
            bridge.run("dropCheckpoint")
            banner = "That did not work: \(error)"
            return nil
        }
        let text = value.isString ? value.toString() : nil
        if bridge.raw("json") == before {
            bridge.run("dropCheckpoint")
            return text
        }
        if save(rereadFirst: true) { showUndo(UndoBar(text: label, redo: false)) }
        return text
    }

    var history: HistoryInfo? { _ = version; return bridge.json(HistoryInfo.self, "history") }

    func undo() { step("undo") }
    func redo() { step("redo") }

    private func step(_ name: String) {
        refresh()  // if another device saved meanwhile, history starts over and there is nothing to undo
        guard let text = bridge.raw(name), text != "null", let result = decode(UndoResult.self, text) else {
            undoBar = nil
            return
        }
        if save(rereadFirst: true) {
            showUndo(UndoBar(text: (name == "undo" ? "Undid: " : "Redid: ") + result.label, redo: name == "undo"))
        }
    }

    private func showUndo(_ bar: UndoBar) {
        undoBar = bar
        let id = bar.id
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 6_000_000_000)
            if self.undoBar?.id == id { self.undoBar = nil }
        }
    }

    /// Write the document as a save on top of the file as it is now. True when it was written.
    @discardableResult
    private func save(rereadFirst: Bool) -> Bool {
        guard let f = folder else { return false }
        do {
            var baseText = "{}"
            if let current = try f.read(f.file), let text = String(data: current, encoding: .utf8) {
                guard let meta = bridge.json(Meta.self, "metaOf", text) else { throw StoreError(message: "The file in iCloud is not Pen Pal data.") }
                if rereadFirst && (meta.saveId != base.saveId || meta.rev != base.rev) {
                    // Your PC saved in the moment between catching up and saving. Its version wins; say so.
                    try load(current)
                    banner = "Another device saved at the same moment, so that last change was not saved. Please make it again."
                    return false
                }
                baseText = text
            }
            guard let out = bridge.raw("stamp", baseText, machine, nowISO, newId()), let data = out.data(using: .utf8) else {
                throw StoreError(message: bridge.lastError ?? "Could not prepare the save.")
            }
            try f.write(data, to: f.file)
            try? data.write(to: Local.lastSaved, options: .atomic)
            Local.dailyBackup(data)
            if let meta = bridge.json(Meta.self, "meta") { base = meta }
            syncLine = "Saved \(clock)"
            theme = settings?.theme ?? theme
            version += 1
            afterChange()
            return true
        } catch {
            banner = "Not saved: \(error.localizedDescription)"
            return false
        }
    }

    private func afterChange() {
        guard let f = folder else { return }
        let skip = reminders.alreadyShown(in: f)
        let plan = bridge.json([PlanItem].self, "reminderPlan", today, 60, jsonText(skip)) ?? []
        reminders.schedule(plan, folder: f)
    }

    // MARK: - when two devices disagree (nothing is deleted; what you don't keep goes to Backups)

    func keepMine() {
        guard let f = folder, let mine = try? Data(contentsOf: Local.lastSaved), let mineText = String(data: mine, encoding: .utf8) else { lost = nil; return }
        do {
            let current = try f.read(f.file) ?? Data("{}".utf8)
            let currentText = String(data: current, encoding: .utf8) ?? "{}"
            guard let out = bridge.raw("adopt", mineText, currentText, machine, nowISO, newId()), let data = out.data(using: .utf8) else {
                throw StoreError(message: bridge.lastError ?? "Could not prepare the save.")
            }
            Local.setAside(current, as: "replaced")
            try f.write(data, to: f.file)
            try? data.write(to: Local.lastSaved, options: .atomic)
            if let meta = bridge.json(Meta.self, "meta") { base = meta }
            lost = nil
            version += 1
            syncLine = "This iPhone's version is back"
            afterChange()
        } catch {
            banner = "Could not put it back: \(error.localizedDescription)"
        }
    }

    func keepTheirs() {
        if let mine = try? Data(contentsOf: Local.lastSaved) { Local.setAside(mine, as: "set-aside-mine") }
        try? FileManager.default.removeItem(at: Local.lastSaved)
        lost = nil
    }

    func resolveCopy(_ name: String, useCopy: Bool) {
        guard let f = folder else { return }
        let url = f.url.appendingPathComponent(name)
        do {
            let copy = try f.read(url) ?? Data()
            if useCopy, let copyText = String(data: copy, encoding: .utf8) {
                let current = try f.read(f.file) ?? Data("{}".utf8)
                let currentText = String(data: current, encoding: .utf8) ?? "{}"
                guard let out = bridge.raw("adopt", copyText, currentText, machine, nowISO, newId()), let data = out.data(using: .utf8) else {
                    throw StoreError(message: bridge.lastError ?? "Could not prepare the save.")
                }
                Local.setAside(current, as: "replaced")
                try f.write(data, to: f.file)
                try? data.write(to: Local.lastSaved, options: .atomic)
                if let meta = bridge.json(Meta.self, "meta") { base = meta }
                version += 1
            }
            Local.setAside(copy, as: "second-copy")
            try f.remove(url)
            conflicts.removeAll { $0.name == name }
            afterChange()
        } catch {
            banner = "Could not do that: \(error.localizedDescription)"
        }
    }

    // MARK: - what the screens read (each touches `version`, so it redraws after a change)

    var settings: DocSettings? { _ = version; return bridge.json(DocSettings.self, "settings", today) }
    var desk: Desk? { _ = version; return bridge.json(Desk.self, "desk", today) }
    func journals(filter: String, query: String) -> JournalList? { _ = version; return bridge.json(JournalList.self, "journals", today, filter, query) }
    func journal(_ id: String) -> JDetail? { _ = version; return bridge.json(JDetail.self, "journal", id, today) }
    func directory(_ query: String) -> DirList? { _ = version; return bridge.json(DirList.self, "directory", query, today) }
    func poems(_ query: String) -> [PoemRow] { _ = version; return bridge.json([PoemRow].self, "poems", query, today) ?? [] }
    func poem(_ id: String) -> PoemDetail? { _ = version; return bridge.json(PoemDetail.self, "poem", id, today) }
    var subs: Subs? { _ = version; return bridge.json(Subs.self, "subs", today) }
    var journalPicker: [PickJournal] { _ = version; return bridge.json([PickJournal].self, "journalPicker", today) ?? [] }
    func sendForm(_ journalId: String, subId: String = "") -> SendForm? { _ = version; return bridge.json(SendForm.self, "sendForm", journalId, today, subId) }
    func subForm(_ id: String) -> SubForm? { bridge.json(SubForm.self, "subForm", id) }
    func budget(_ ym: String) -> BudgetModel? { _ = version; return bridge.json(BudgetModel.self, "budget", ym, today) }
    var insights: Insights? { _ = version; return bridge.json(Insights.self, "insights") }
    var blankJournal: JForm? { bridge.json(JForm.self, "blankJournal") }
    var plan: [PlanItem] { _ = version; return bridge.json([PlanItem].self, "reminderPlan", today, 60, "[]") ?? [] }

    func sendCheck(id: String = "", journalId: String, poemIds: [String], sentDate: String, fee: String) -> SendCheck? {
        struct Draft: Encodable { let id: String; let journalId: String; let poemIds: [String]; let sentDate: String; let feePaid: String }
        return bridge.json(SendCheck.self, "sendCheck", jsonText(Draft(id: id, journalId: journalId, poemIds: poemIds, sentDate: sentDate, feePaid: fee)), today)
    }

    static func date(_ ymd: String) -> Date? {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: ymd)
    }

    func decode<T: Decodable>(_ type: T.Type, _ text: String?) -> T? {
        guard let text, let data = text.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }
}
