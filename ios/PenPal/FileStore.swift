import Foundation

struct StoreError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// The folder you picked (iCloud Drive › Pen Pal): tracker.json and reminders-sent.json, shared with your PCs.
/// Reads and writes go through NSFileCoordinator so iCloud never sees half a file, and a file that is
/// only in the cloud is downloaded first.
struct DataFolder: Equatable {
    let url: URL
    var file: URL { url.appendingPathComponent("tracker.json") }
    var sentFile: URL { url.appendingPathComponent("reminders-sent.json") }

    /// "iCloud Drive › Pen Pal" for a folder in iCloud Drive, else the folder's name.
    var displayName: String {
        let parts = url.standardizedFileURL.pathComponents
        if let i = parts.firstIndex(of: "com~apple~CloudDocs") {
            return (["iCloud Drive"] + parts[(i + 1)...]).joined(separator: " › ")
        }
        return url.lastPathComponent
    }

    private func placeholder(for target: URL) -> URL {
        target.deletingLastPathComponent().appendingPathComponent("." + target.lastPathComponent + ".icloud")
    }

    /// Ask iCloud for the file if only a placeholder is here, and wait a little for it.
    func ensureDownloaded(_ target: URL, wait: TimeInterval = 20) {
        let fm = FileManager.default
        try? fm.startDownloadingUbiquitousItem(at: target)
        if fm.fileExists(atPath: target.path) { return }
        guard fm.fileExists(atPath: placeholder(for: target).path) else { return }
        let until = Date().addingTimeInterval(wait)
        while !fm.fileExists(atPath: target.path) && Date() < until {
            Thread.sleep(forTimeInterval: 0.25)
        }
    }

    func exists(_ target: URL) -> Bool {
        let fm = FileManager.default
        return fm.fileExists(atPath: target.path) || fm.fileExists(atPath: placeholder(for: target).path)
    }

    /// The file's bytes, or nil when it is not there.
    func read(_ target: URL) throws -> Data? {
        ensureDownloaded(target)
        var result: Data?
        var inner: Error?
        var coordinatorError: NSError?
        NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: target, options: [], error: &coordinatorError) { url in
            do {
                if FileManager.default.fileExists(atPath: url.path) { result = try Data(contentsOf: url) }
            } catch { inner = error }
        }
        if let coordinatorError { throw coordinatorError }
        if let inner { throw inner }
        return result
    }

    func write(_ data: Data, to target: URL) throws {
        var inner: Error?
        var coordinatorError: NSError?
        NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: target, options: .forReplacing, error: &coordinatorError) { url in
            do { try data.write(to: url, options: .atomic) } catch { inner = error }
        }
        if let coordinatorError { throw coordinatorError }
        if let inner { throw inner }
    }

    func remove(_ target: URL) throws {
        var inner: Error?
        var coordinatorError: NSError?
        NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: target, options: .forDeleting, error: &coordinatorError) { url in
            do { try FileManager.default.removeItem(at: url) } catch { inner = error }
        }
        if let coordinatorError { throw coordinatorError }
        if let inner { throw inner }
    }

    /// Second copies a cloud service left beside tracker.json (tracker 2.json, tracker-LAPTOP.json, ...).
    func conflictCopies() -> [URL] {
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: url.path) else { return [] }
        var seen = Set<String>()
        var out: [URL] = []
        for raw in names {
            var name = raw
            if name.hasPrefix("."), name.hasSuffix(".icloud") { name = String(name.dropFirst().dropLast(7)) }
            let low = name.lowercased()
            guard low != "tracker.json", low.hasPrefix("tracker"), low.hasSuffix(".json"), low.count > 12, !seen.contains(low) else { continue }
            seen.insert(low)
            out.append(url.appendingPathComponent(name))
        }
        return out.sorted { $0.lastPathComponent < $1.lastPathComponent }
    }
}

/// Things that belong to this iPhone only: the last save made here, and backups.
enum Local {
    static var support: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("PenPal", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
    /// In Documents so you can see them in the Files app.
    static var backups: URL {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Backups", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
    static var lastSaved: URL { support.appendingPathComponent("last-saved.json") }

    static func stamp() -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyyMMdd-HHmmss"
        return f.string(from: Date())
    }

    /// One copy a day, the first save of the day; the latest 30 days are kept.
    static func dailyBackup(_ data: Data) {
        let day = String(stamp().prefix(8))
        let target = backups.appendingPathComponent("tracker-\(day).json")
        if !FileManager.default.fileExists(atPath: target.path) { try? data.write(to: target, options: .atomic) }
        let files = ((try? FileManager.default.contentsOfDirectory(atPath: backups.path)) ?? []).filter { $0.hasPrefix("tracker-") }.sorted()
        for old in files.dropLast(30) { try? FileManager.default.removeItem(at: backups.appendingPathComponent(old)) }
    }

    static func setAside(_ data: Data, as prefix: String) {
        try? data.write(to: backups.appendingPathComponent("\(prefix)-\(stamp()).json"), options: .atomic)
    }

    static var backupCount: Int {
        ((try? FileManager.default.contentsOfDirectory(atPath: backups.path)) ?? []).filter { $0.hasSuffix(".json") }.count
    }
}

/// Remembers the folder you picked across launches. On iOS a plain bookmark keeps the access the
/// folder picker gave; no iCloud entitlement is needed, so this works for sideloaded apps.
enum FolderAccess {
    private static let key = "dataFolderBookmark"

    static func remember(_ url: URL) throws {
        _ = url.startAccessingSecurityScopedResource()  // kept open while the app runs
        let data = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
        UserDefaults.standard.set(data, forKey: key)
    }

    static func restore() -> URL? {
        if let demo = ProcessInfo.processInfo.environment["PENPAL_FOLDER"], !demo.isEmpty {
            return URL(fileURLWithPath: demo, isDirectory: true)
        }
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        var stale = false
        guard let url = try? URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale) else { return nil }
        _ = url.startAccessingSecurityScopedResource()
        if stale, let fresh = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
            UserDefaults.standard.set(fresh, forKey: key)
        }
        return url
    }

    static func forget() { UserDefaults.standard.removeObject(forKey: key) }
}
