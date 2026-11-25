import XCTest
@testable import PenPal

/// The rules run in JavaScriptCore on the phone exactly as in Node: every screen's JSON decodes.
@MainActor
final class BridgeTests: XCTestCase {
    static let doc = """
    {"rev":13,"saveId":"pc1","savedOn":"DESKTOP","savedAt":"2026-11-24T09:02:00","lineage":["pc0"],
     "poems":[{"id":"p1","title":"Salt","status":"ready"},{"id":"p2","title":"Ferry","status":"draft"}],
     "journals":[{"id":"pl","name":"Poet Lore","opens":"2025-04-01","closes":"2025-05-31","repeat":"yearly","extraWindows":[{"opens":"10-01","closes":"11-30"}],"notify":true,"replyDays":210,"pays":"yes","fee":0,"maxPoems":5,"simSubs":"yes"},
                 {"id":"rm","name":"Rust & Moth","opens":"2026-12-01","closes":"2026-12-20","repeat":"yearly","extraWindows":[{"opens":"06-01","closes":"06-20"},{"opens":"09-01","closes":"09-20"}],"notify":true,"replyDays":60}],
     "submissions":[{"id":"s1","journalId":"pl","poemIds":["p2"],"sentDate":"2026-05-01","status":"pending"}],
     "settings":{"theme":"dark","notifyDays":3}}
    """

    func testEveryScreenDecodes() throws {
        let b = Bridge()
        XCTAssertTrue(b.isReady, b.lastError ?? "")
        let meta = try XCTUnwrap(b.json(Meta.self, "load", Self.doc), b.lastError ?? "")
        XCTAssertEqual(meta.saveId, "pc1")
        let today = "2026-11-24"
        XCTAssertNotNil(b.json(Desk.self, "desk", today), b.lastError ?? "desk")
        let list = try XCTUnwrap(b.json(JournalList.self, "journals", today, "all", ""), b.lastError ?? "journals")
        XCTAssertEqual(list.items.map(\.name), ["Poet Lore", "Rust & Moth"])
        let rm = try XCTUnwrap(b.json(JDetail.self, "journal", "rm", today), b.lastError ?? "journal")
        XCTAssertEqual(rm.bars.count, 3)
        XCTAssertNotNil(b.json(DirList.self, "directory", "", today), b.lastError ?? "directory")
        XCTAssertNotNil(b.json([PoemRow].self, "poems", "", today), b.lastError ?? "poems")
        XCTAssertNotNil(b.json(PoemDetail.self, "poem", "p1", today), b.lastError ?? "poem")
        XCTAssertNotNil(b.json(Subs.self, "subs", today), b.lastError ?? "subs")
        XCTAssertNotNil(b.json([PickJournal].self, "journalPicker", today), b.lastError ?? "picker")
        XCTAssertNotNil(b.json(SendForm.self, "sendForm", "pl", today), b.lastError ?? "sendForm")
        XCTAssertNotNil(b.json(SendCheck.self, "sendCheck", #"{"journalId":"pl","poemIds":["p1"],"sentDate":"2026-11-24","feePaid":""}"#, today), b.lastError ?? "check")
        XCTAssertNotNil(b.json(DocSettings.self, "settings", today), b.lastError ?? "settings")
        XCTAssertNotNil(b.json(JForm.self, "blankJournal"), b.lastError ?? "blank")
        let plan = try XCTUnwrap(b.json([PlanItem].self, "reminderPlan", today, 60, "[]"), b.lastError ?? "plan")
        XCTAssertEqual(plan.map(\.title), ["Poet Lore closes in 3 days", "Rust & Moth opens in 3 days", "Rust & Moth closes in 3 days"])
        let summary = try XCTUnwrap(b.json(Summary.self, "summary", Self.doc))
        XCTAssertEqual(summary.counts, "2 journals, 2 poems, 1 submission")
    }

    func testSaveChain() throws {
        let b = Bridge()
        _ = b.json(Meta.self, "load", Self.doc)
        b.run("setNotify", "pl", false)
        let out = try XCTUnwrap(b.raw("stamp", Self.doc, "iPhone", "2026-11-24T10:00:00", "ip1"))
        let meta = try XCTUnwrap(b.json(Meta.self, "metaOf", out))
        XCTAssertEqual(meta.rev, 14)
        XCTAssertEqual(meta.lineage, ["pc0", "pc1"])
        XCTAssertTrue(try XCTUnwrap(b.run("buildsOn", out, "pc1")).toBool())
    }
}
