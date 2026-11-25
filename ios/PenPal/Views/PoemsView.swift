import SwiftUI

struct PoemsView: View {
    @Environment(Store.self) private var store
    @State private var query = ""
    @State private var adding = false

    var body: some View {
        let poems = store.poems(query)
        List {
            if poems.isEmpty {
                Text(query.isEmpty ? "No poems yet. Add your titles: titles and notes only, never the poems themselves." : "No poems match.")
                    .font(F.sans(14)).foregroundStyle(P.muted).listRowBackground(P.panel)
            }
            ForEach(poems) { p in
                NavigationLink(value: PoemRoute(id: p.id)) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(p.title).font(F.sans(16, .semibold))
                        Text(p.label).font(F.sans(13.5)).foregroundStyle(p.state == "out" ? P.blue : P.muted)
                    }
                }
                .listRowBackground(P.panel)
            }
        }
        .scrollContentBackground(.hidden)
        .background(P.bg)
        .searchable(text: $query, prompt: "Search your poems")
        .navigationTitle("Poems")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { adding = true } label: { Image(systemName: "plus") }.accessibilityLabel("Add poems")
            }
        }
        .navigationDestination(for: PoemRoute.self) { r in PoemDetailView(id: r.id) }
        .sheet(isPresented: $adding) { AddPoemsSheet() }
    }
}

struct AddPoemsSheet: View {
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var ready = true

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("One title per line", text: $text, axis: .vertical).lineLimit(5...14)
                } footer: {
                    Text("Titles only. Pen Pal never keeps the poems themselves.")
                }
                Section {
                    Picker("They are", selection: $ready) {
                        Text("Ready to send").tag(true)
                        Text("Drafts").tag(false)
                    }
                }
            }
            .navigationTitle("Add poems")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        store.change("addTitles", text, ready ? "ready" : "draft")
                        dismiss()
                    }
                    .fontWeight(.semibold)
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}

struct PoemDetailView: View {
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    let id: String
    @State private var title = ""
    @State private var status = "draft"
    @State private var notes = ""
    @State private var loaded = false
    @State private var error = ""
    @State private var confirmDelete = false

    var body: some View {
        let p = store.poem(id)
        Form {
            if let p {
                Section {
                    TextField("Title", text: $title)
                    Picker("Status", selection: $status) {
                        Text("Draft").tag("draft")
                        Text("Ready to send").tag("ready")
                        Text("Published elsewhere").tag("published")
                    }
                } footer: {
                    Text(p.label)
                }
                Section("Notes") {
                    TextField("Revisions, where it fits, anything", text: $notes, axis: .vertical).lineLimit(3...8)
                }
                if !p.history.isEmpty {
                    Section("Where it's been") {
                        ForEach(p.history) { h in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(h.journal).font(F.sans(15, .semibold))
                                Text(h.line).font(F.sans(13)).foregroundStyle(P.muted)
                            }
                        }
                    }
                }
                if !error.isEmpty { Section { Text(error).foregroundStyle(P.red) } }
                Section {
                    Button("Remove this poem", role: .destructive) { confirmDelete = true }
                }
            }
        }
        .navigationTitle(p?.title ?? "Poem")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") {
                    struct Edit: Encodable { let id: String; let title: String; let status: String; let notes: String }
                    if let r = store.decode(SaveResult.self, store.change("savePoem", jsonText(Edit(id: id, title: title, status: status, notes: notes)))) {
                        error = r.error
                    }
                }
                .fontWeight(.semibold)
            }
        }
        .onAppear {
            guard !loaded, let p else { return }
            title = p.title; status = p.status; notes = p.notes; loaded = true
        }
        .confirmationDialog("Remove this poem?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Remove", role: .destructive) {
                store.change("removePoem", id)
                dismiss()
            }
        } message: {
            Text("It comes out of any submissions too.")
        }
    }
}
