import SwiftUI

/// Log poems sent to a journal, or edit a logged submission, with the same checks the Windows app
/// runs before you send. When editing, the submission's own poems and fee are not counted against it.
struct SendSheet: View {
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    private let editing: SubForm?
    @State private var journalId: String
    @State private var picked: [String]
    @State private var sent: Date
    @State private var fee: String
    @State private var notes: String
    @State private var answered: Date
    @State private var error = ""
    @State private var feeLoaded: Bool

    init(journalId: String, editing: SubForm? = nil) {
        self.editing = editing
        _journalId = State(initialValue: editing?.journalId ?? journalId)
        _picked = State(initialValue: editing?.poemIds ?? [])
        _sent = State(initialValue: editing.flatMap { Store.date($0.sentDate) } ?? Date())
        _fee = State(initialValue: editing?.feePaid ?? "")
        _notes = State(initialValue: editing?.notes ?? "")
        _answered = State(initialValue: editing.flatMap { Store.date($0.responseDate) } ?? Date())
        _feeLoaded = State(initialValue: editing != nil)
    }

    private var isAnswered: Bool { editing.map { $0.status != "pending" } ?? false }

    var body: some View {
        NavigationStack {
            Group {
                if journalId.isEmpty { picker } else { form }
            }
            .navigationTitle(editing == nil ? "Send poems" : "Edit submission")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                if !journalId.isEmpty {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(editing == nil ? "Log it" : "Save") { save() }.fontWeight(.semibold).disabled(picked.isEmpty)
                    }
                }
            }
        }
    }

    private var picker: some View {
        List {
            let journals = store.journalPicker
            if journals.isEmpty {
                Text("Add a journal first, in Journals.").foregroundStyle(P.muted)
            }
            ForEach(journals) { j in
                Button { journalId = j.id } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(j.name).font(F.sans(16, .semibold)).foregroundStyle(P.ink)
                        Text(j.line).font(F.sans(13.5)).foregroundStyle(P.muted)
                    }
                }
            }
        }
    }

    private var form: some View {
        let f = store.sendForm(journalId, subId: editing?.id ?? "")
        let check = store.sendCheck(id: editing?.id ?? "", journalId: journalId, poemIds: picked, sentDate: Store.day(sent), fee: fee)
        return Form {
            if let f {
                Section {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(f.journal.name).font(F.serif(20))
                        Text(f.journal.line).font(F.sans(13.5)).foregroundStyle(P.muted)
                    }
                    Button("Choose another journal") { journalId = ""; if editing == nil { picked = [] } }.font(F.sans(14))
                }
                Section {
                    if f.poems.isEmpty { Text("Add poem titles first, in Poems.").foregroundStyle(P.muted) }
                    ForEach(f.poems) { p in
                        Toggle(isOn: Binding(get: { picked.contains(p.id) }, set: { on in
                            if on { picked.append(p.id) } else { picked.removeAll { $0 == p.id } }
                        })) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(p.title)
                                Text(p.label).font(F.sans(13)).foregroundStyle(P.muted)
                            }
                        }
                        .disabled(p.blocked)
                        .tint(P.blue)
                    }
                } header: {
                    ListHeader(f.max.map { "Poems (\(picked.count) of up to \($0))" } ?? "Poems (\(picked.count))")
                }
                Section {
                    DatePicker("Date sent", selection: $sent, displayedComponents: .date)
                    if isAnswered {
                        DatePicker("Answered on", selection: $answered, displayedComponents: .date)
                    }
                    LabeledContent("Fee paid") {
                        TextField("$0", text: $fee).multilineTextAlignment(.trailing).keyboardType(.decimalPad)
                    }
                    TextField("Notes (optional)", text: $notes, axis: .vertical).lineLimit(1...5)
                }
                if let check, !(check.ok.isEmpty && check.warn.isEmpty) {
                    Section(header: ListHeader("Before you send")) {
                        ForEach(check.ok, id: \.self) { line in
                            Label { Text(line).font(F.sans(14)) } icon: { Image(systemName: "checkmark").foregroundStyle(P.blue) }
                        }
                        ForEach(check.warn, id: \.self) { line in
                            Label { Text(line).font(F.sans(14)) } icon: { Image(systemName: "exclamationmark.triangle").foregroundStyle(P.red) }
                        }
                    }
                }
                if !error.isEmpty { Section { Text(error).foregroundStyle(P.red) } }
            }
        }
        .onAppear {
            if !feeLoaded, let f { fee = f.fee == "0" ? "" : f.fee; feeLoaded = true }
        }
    }

    private func save() {
        let text: String?
        if var e = editing {
            e.journalId = journalId
            e.poemIds = picked
            e.sentDate = Store.day(sent)
            e.feePaid = fee
            e.notes = notes
            e.responseDate = isAnswered ? Store.day(answered) : e.responseDate
            text = store.change("saveSub", jsonText(e))
        } else {
            struct Draft: Encodable { let journalId: String; let poemIds: [String]; let sentDate: String; let feePaid: String; let notes: String }
            text = store.change("logSubmission", jsonText(Draft(journalId: journalId, poemIds: picked, sentDate: Store.day(sent), feePaid: fee, notes: notes)))
        }
        if let r = store.decode(SaveResult.self, text), r.error.isEmpty { dismiss() }
        else { error = store.decode(SaveResult.self, text)?.error ?? "Could not save it." }
    }
}
