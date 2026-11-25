import XCTest
@testable import PenPal

/// The iPhone and a PC sharing one tracker.json in a folder, as through iCloud Drive.
@MainActor
final class StoreTests: XCTestCase {
    var dir: URL!

    override func setUp() async throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("penpal-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Data(BridgeTests.doc.utf8).write(to: dir.appendingPathComponent("tracker.json"))
        try? FileManager.default.removeItem(at: Local.lastSaved)
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: dir)
        try? FileManager.default.removeItem(at: Local.lastSaved)
    }

    private func file() throws -> [String: Any] {
        let data = try Data(contentsOf: dir.appendingPathComponent("tracker.json"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    /// What the PC does: a save of its own on top of `base` (or on top of an older version).
    private func pcSaves(on base: [String: Any], id: String, change: (inout [String: Any]) -> Void) throws {
        var doc = base
        change(&doc)
        let lineage = (base["lineage"] as? [String] ?? []) + [(base["saveId"] as? String ?? "")]
        doc["lineage"] = lineage
        doc["saveId"] = id
        doc["savedOn"] = "DESKTOP"
        doc["rev"] = (base["rev"] as? Int ?? 0) + 1
        try JSONSerialization.data(withJSONObject: doc).write(to: dir.appendingPathComponent("tracker.json"))
    }

    func testSavesOnTopOfTheFileAndPicksUpThePC() throws {
        let store = Store()
        store.open(DataFolder(url: dir))
        XCTAssertEqual(store.phase, .ready)
        store.change("setNotify", "rm", false)
        var doc = try file()
        XCTAssertEqual(doc["rev"] as? Int, 14)
        XCTAssertEqual((doc["lineage"] as? [String])?.last, "pc1")
        XCTAssertNotNil(store.journal("rm").map { !$0.notify })
        // the PC saves on top of the iPhone's save: picked up, nothing lost
        try pcSaves(on: doc, id: "pc2") { d in d["poems"] = [] }
        store.refresh()
        XCTAssertEqual(store.poems("").count, 0)
        XCTAssertNil(store.lost)
        doc = try file()
        XCTAssertEqual(doc["saveId"] as? String, "pc2")
    }

    func testAReplacedSaveIsCaughtAndCanBePutBack() throws {
        let store = Store()
        store.open(DataFolder(url: dir))
        let before = try file()
        store.change("setNotify", "rm", false)              // the iPhone saves...
        try pcSaves(on: before, id: "pc2") { d in d["poems"] = [] }  // ...but iCloud keeps the PC's, made without it
        store.refresh()
        XCTAssertNotNil(store.lost)
        store.keepMine()
        XCTAssertNil(store.lost)
        let doc = try file()
        XCTAssertTrue((doc["lineage"] as? [String] ?? []).contains("pc2"))  // on top of the PC's, so the PC reloads it
        let rm = (doc["journals"] as? [[String: Any]])?.first { $0["id"] as? String == "rm" }
        XCTAssertEqual(rm?["notify"] as? Bool, false)
    }

    func testSecondCopiesAreFlagged() throws {
        try Data(BridgeTests.doc.utf8).write(to: dir.appendingPathComponent("tracker 2.json"))
        let store = Store()
        store.open(DataFolder(url: dir))
        XCTAssertEqual(store.conflicts.map(\.name), ["tracker 2.json"])
        store.resolveCopy("tracker 2.json", useCopy: false)
        XCTAssertTrue(store.conflicts.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: dir.appendingPathComponent("tracker 2.json").path))
    }

    func testAMissingFileIsAProblemNotAFreshStart() throws {
        try FileManager.default.removeItem(at: dir.appendingPathComponent("tracker.json"))
        let store = Store()
        store.open(DataFolder(url: dir))
        if case .problem = store.phase {} else { XCTFail("expected a problem, got \(store.phase)") }
        XCTAssertFalse(FileManager.default.fileExists(atPath: dir.appendingPathComponent("tracker.json").path))
    }
}
