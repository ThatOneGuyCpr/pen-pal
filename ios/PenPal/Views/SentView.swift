import SwiftUI

struct SentView: View {
    @Environment(Store.self) private var store
    @State private var open: SubRow?
    @State private var send: SendTarget?

    var body: some View {
        let subs = store.subs
        List {
            Section(header: ListHeader("Waiting")) {
                if subs?.pending.isEmpty ?? true {
                    Text("Nothing out right now.").font(F.sans(14)).foregroundStyle(P.muted).listRowBackground(P.panel)
                }
                ForEach(subs?.pending ?? []) { s in row(s) }
            }
            if let done = subs?.done, !done.isEmpty {
                Section(header: ListHeader("Answered")) {
                    ForEach(done) { s in row(s) }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(P.bg)
        .navigationTitle("Sent")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { send = SendTarget(id: "") } label: { Image(systemName: "plus") }.accessibilityLabel("Log a submission")
            }
        }
        .sheet(item: $open) { s in SubSheet(sub: s) }
        .sheet(item: $send) { t in SendSheet(journalId: t.id) }
    }

    private func row(_ s: SubRow) -> some View {
        Button { open = s } label: {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text(s.journal).font(F.sans(16, .semibold)).foregroundStyle(P.ink)
                    Text(s.titles).font(F.sans(14)).foregroundStyle(P.ink2)
                    Text(s.line).font(F.sans(13)).foregroundStyle(P.muted)
                }
                Spacer()
                if s.status != "pending" { Chip(text: s.statusLabel, tone: s.status == "accepted" ? "blue" : "gray") }
            }
        }
        .listRowBackground(P.panel)
    }
}

/// Record an answer for one submission.
struct SubSheet: View {
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    let sub: SubRow
    @State private var alerts: [String] = []
    @State private var confirmDelete = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(sub.titles).font(F.sans(16, .semibold))
                    Text(sub.line).foregroundStyle(P.muted)
                }
                Section(header: ListHeader("Their answer")) {
                    answer("Accepted", "accepted")
                    answer("Declined", "rejected")
                    answer("I withdrew it", "withdrawn")
                    answer("Still waiting", "pending")
                }
                if sub.status == "pending" && sub.poems.filter({ !$0.withdrawn }).count > 1 {
                    Section {
                        ForEach(sub.poems.filter { !$0.withdrawn }) { p in
                            Button("Withdraw \"\(p.title)\" only") {
                                store.change("withdraw", sub.id, p.id, store.today)
                                dismiss()
                            }
                        }
                    } header: { ListHeader("One poem at a time") } footer: { ListFooter("For when one poem was taken elsewhere. The rest stay with them.") }
                }
                Section {
                    Button("Remove this submission", role: .destructive) { confirmDelete = true }
                }
            }
            .navigationTitle(sub.journal)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .alert("Withdraw it elsewhere", isPresented: Binding(get: { !alerts.isEmpty }, set: { if !$0 { alerts = []; dismiss() } })) {
                Button("OK") {}
            } message: {
                Text(alerts.joined(separator: "\n"))
            }
            .confirmationDialog("Remove this submission?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Remove", role: .destructive) { store.change("removeSub", sub.id); dismiss() }
            }
        }
    }

    private func answer(_ label: String, _ status: String) -> some View {
        Button {
            let lines = store.decode([String].self, store.change("setSubStatus", sub.id, status, store.today)) ?? []
            if lines.isEmpty { dismiss() } else { alerts = lines }
        } label: {
            HStack {
                Text(label).foregroundStyle(P.ink)
                Spacer()
                if sub.status == status { Image(systemName: "checkmark").foregroundStyle(P.blue) }
            }
        }
    }
}
