import Foundation

// Shapes returned by bridge.js. Each screen decodes what it shows; the document itself stays in JavaScript.

struct Meta: Decodable, Equatable {
    var rev: Int
    var saveId: String
    var savedOn: String
    var savedAt: String
    var lineage: [String]
    static let empty = Meta(rev: 0, saveId: "", savedOn: "", savedAt: "", lineage: [])
}

struct Summary: Decodable, Equatable {
    var journals: Int
    var poems: Int
    var submissions: Int
    var saved: String
    var counts: String
}

struct Desk: Decodable {
    var dateLabel: String
    var needs: [Need]
    var closing: [JCard]
    var opening: [JCard]
    var open: [JCard]
    var waiting: [Waiting]
    var fees: Fees
    var empty: Bool
    var noPoems: Bool
}

struct Need: Decodable, Identifiable {
    var id: String
    var kind: String
    var label: String
    var text: String
    var subId: String
    var poemId: String
}

struct JCard: Decodable, Identifiable {
    var id: String
    var name: String
    var detail: String
    var chip: String
    var tone: String
    var notify: Bool
}

struct Waiting: Decodable, Identifiable {
    var subId: String
    var journal: String
    var titles: String
    var line: String
    var id: String { subId }
}

struct Fees: Decodable {
    var label: String
    var spent: String
    var budget: String
    var left: String
    var over: Bool
}

struct JournalList: Decodable {
    var items: [JRow]
    var count: Int
}

struct JRow: Decodable, Identifiable {
    var id: String
    var name: String
    var line: String
    var chip: String
    var tone: String
    var pays: Bool
    var notify: Bool
    var always: Bool
}

struct JDetail: Decodable {
    var id: String
    var name: String
    var url: String
    var notes: String
    var notify: Bool
    var always: Bool
    var line: String
    var chip: String
    var tone: String
    var hasDates: Bool
    var bars: [Bar]
    var todayPos: Double
    var periodsTitle: String
    var periodsText: String
    var facts: [Fact]
    var remindText: String
    var subs: [JSub]
    var form: JForm
    var open: Bool
}

struct Bar: Decodable, Hashable {
    var start: Double
    var width: Double
}

struct Fact: Decodable, Hashable {
    var label: String
    var value: String
}

struct JSub: Decodable, Identifiable {
    var id: String
    var titles: String
    var line: String
}

struct JForm: Codable, Equatable {
    var id: String
    var name: String
    var url: String
    var opens: String
    var closes: String
    var yearly: Bool
    var always: Bool
    var notify: Bool
    var replyDays: String
    var pays: String
    var reprints: String
    var fee: String
    var maxPoems: String
    var simSubs: String
    var notes: String
    var extra: String
}

struct SaveResult: Decodable {
    var id: String
    var error: String
}

struct DirList: Decodable {
    var checked: String
    var total: Int
    var items: [DirRow]
}

struct DirRow: Decodable, Identifiable {
    var dirId: String
    var name: String
    var line: String
    var chip: String
    var tone: String
    var facts: String
    var note: String
    var mineId: String
    var url: String
    var id: String { dirId }
}

struct PoemRow: Decodable, Identifiable {
    var id: String
    var title: String
    var notes: String
    var state: String
    var label: String
}

struct PoemDetail: Decodable {
    var id: String
    var title: String
    var status: String
    var notes: String
    var state: String
    var label: String
    var history: [PoemHistory]
}

struct PoemHistory: Decodable, Identifiable {
    var id: String
    var journal: String
    var line: String
}

struct PickJournal: Decodable, Identifiable, Hashable {
    var id: String
    var name: String
    var line: String
}

struct SendForm: Decodable {
    var journal: PickJournal
    var poems: [SendPoem]
    var max: Int?
    var fee: String
}

struct SendPoem: Decodable, Identifiable {
    var id: String
    var title: String
    var state: String
    var label: String
    var blocked: Bool
}

struct SendCheck: Decodable {
    var ok: [String]
    var warn: [String]
}

struct Subs: Decodable {
    var pending: [SubRow]
    var done: [SubRow]
}

struct SubRow: Decodable, Identifiable {
    var id: String
    var journal: String
    var journalId: String
    var titles: String
    var status: String
    var statusLabel: String
    var line: String
    var poems: [SubPoem]
}

struct SubPoem: Decodable, Identifiable {
    var id: String
    var title: String
    var withdrawn: Bool
}

struct DocSettings: Decodable {
    var theme: String
    var notifyDays: Int
    var deskDays: Int
    var followUpDays: Int
    var budget: Double?
}

struct PlanItem: Decodable, Identifiable {
    var key: String
    var title: String
    var body: String
    var fire: String
    var date: String
    var journalId: String
    var id: String { key }
}

/// Navigation targets.
struct JournalRoute: Hashable { let id: String }
struct PoemRoute: Hashable { let id: String }
struct FindRoute: Hashable {}
struct SendTarget: Identifiable { let id: String }  // a journal id, or "" to pick one first
