import SwiftUI

/// Log poems sent to a journal, with the same checks the Windows app runs before you send.
struct SendSheet: View {
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State var journalId: String
    @State private var picked: [String] = []
    @State private var sent = Date()
    @State private var fee = ""
    @State private var error = ""
    @State private var feeLoaded = false

    var body: some View {
        NavigationStack {
            Group {
                if journalId.isEmpty { picker } else { form }
            }
            .navigationTitle("Send poems")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                if !journalId.isEmpty {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Log it") { log() }.fontWeight(.semibold).disabled(picked.isEmpty)
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
        let f = store.sendForm(journalId)
        let check = store.sendCheck(journalId: journalId, poemIds: picked, sentDate: Store.day(sent), fee: fee)
        return Form {
            if let f {
                Section {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(f.journal.name).font(F.serif(20))
                        Text(f.journal.line).font(F.sans(13.5)).foregroundStyle(P.muted)
                    }
                    Button("Choose another journal") { journalId = ""; picked = [] }.font(F.sans(14))
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
                    Text(f.max.map { "Poems (\(picked.count) of up to \($0))" } ?? "Poems (\(picked.count))")
                }
                Section {
                    DatePicker("Date sent", selection: $sent, displayedComponents: .date)
                    LabeledContent("Fee paid") {
                        TextField("$0", text: $fee).multilineTextAlignment(.trailing).keyboardType(.decimalPad)
                    }
                }
                if let check, !(check.ok.isEmpty && check.warn.isEmpty) {
                    Section("Before you send") {
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

    private func log() {
        struct Draft: Encodable { let journalId: String; let poemIds: [String]; let sentDate: String; let feePaid: String }
        let text = store.change("logSubmission", jsonText(Draft(journalId: journalId, poemIds: picked, sentDate: Store.day(sent), feePaid: fee)))
        if let r = store.decode(SaveResult.self, text), r.error.isEmpty { dismiss() }
        else { error = store.decode(SaveResult.self, text)?.error ?? "Could not log it." }
    }
}
