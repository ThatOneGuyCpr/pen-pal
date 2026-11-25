import SwiftUI

/// Add or edit a journal. Every rule (dates, windows, fee parsing) is applied by logic.js when it saves.
struct JournalEditView: View {
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State var form: JForm
    @State private var error = ""
    @State private var confirmDelete = false

    private var hasDates: Binding<Bool> {
        Binding(get: { !form.opens.isEmpty || !form.closes.isEmpty },
                set: { on in
                    if on {
                        form.opens = store.today
                        form.closes = Store.day(Calendar.current.date(byAdding: .month, value: 2, to: Date()) ?? Date())
                    } else { form.opens = ""; form.closes = "" }
                })
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $form.name)
                    TextField("Submission page (optional)", text: $form.url)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                }
                Section("Reading period") {
                    Toggle("Open all year", isOn: $form.always)
                    if !form.always {
                        Toggle("Has reading dates", isOn: hasDates)
                        if hasDates.wrappedValue {
                            DatePicker("Opens", selection: dateBinding(\.opens), displayedComponents: .date)
                            DatePicker("Closes", selection: dateBinding(\.closes), displayedComponents: .date)
                            Toggle("Same dates every year", isOn: $form.yearly)
                            if form.yearly {
                                TextField("Other windows, like Jun 1 to Jun 20; Sep 1 to Sep 20", text: $form.extra, axis: .vertical)
                            }
                        }
                        Toggle("Remind me before it opens and closes", isOn: $form.notify)
                    }
                }
                Section("What they want") {
                    LabeledContent("Fee") { TextField("Free, or $3", text: $form.fee).multilineTextAlignment(.trailing).keyboardType(.decimalPad) }
                    LabeledContent("Poems at a time") { TextField("Up to", text: $form.maxPoems).multilineTextAlignment(.trailing).keyboardType(.numberPad) }
                    LabeledContent("Usual reply (days)") { TextField("Days", text: $form.replyDays).multilineTextAlignment(.trailing).keyboardType(.numberPad) }
                    yesNo("Simultaneous submissions", $form.simSubs)
                    yesNo("Pays", $form.pays)
                    yesNo("Takes reprints", $form.reprints)
                }
                Section("Notes") {
                    TextField("Anything worth remembering", text: $form.notes, axis: .vertical).lineLimit(3...8)
                }
                if !error.isEmpty {
                    Section { Text(error).foregroundStyle(P.red) }
                }
                if !form.id.isEmpty {
                    Section {
                        Button("Remove this journal", role: .destructive) { confirmDelete = true }
                    } footer: {
                        Text("Its submissions are removed with it.")
                    }
                }
            }
            .navigationTitle(form.id.isEmpty ? "Add a journal" : "Edit journal")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { save() }.fontWeight(.semibold) }
            }
            .confirmationDialog("Remove \(form.name)?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Remove", role: .destructive) {
                    store.change("removeJournal", form.id)
                    dismiss()
                }
            }
        }
    }

    private func yesNo(_ label: String, _ value: Binding<String>) -> some View {
        Picker(label, selection: value) {
            Text("Yes").tag("yes")
            Text("No").tag("no")
            Text("Not noted").tag("unknown")
        }
    }

    private func dateBinding(_ key: WritableKeyPath<JForm, String>) -> Binding<Date> {
        Binding(get: {
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.dateFormat = "yyyy-MM-dd"
            return f.date(from: form[keyPath: key]) ?? Date()
        }, set: { form[keyPath: key] = Store.day($0) })
    }

    private func save() {
        guard let r = store.decode(SaveResult.self, store.change("saveJournal", jsonText(form))) else {
            error = "Could not save."
            return
        }
        if r.error.isEmpty { dismiss() } else { error = r.error }
    }
}

/// The journal directory that ships with Pen Pal.
struct FindView: View {
    @Environment(Store.self) private var store
    @State private var query = ""

    var body: some View {
        let dir = store.directory(query)
        List {
            Section {
                ForEach(dir?.items ?? []) { e in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(e.name).font(F.sans(16, .semibold))
                                Text(e.line).font(F.sans(13.5)).foregroundStyle(P.muted)
                            }
                            Spacer()
                            if !e.chip.isEmpty { Chip(text: e.chip, tone: e.tone) }
                        }
                        if !e.facts.isEmpty { Text(e.facts).font(F.sans(13)).foregroundStyle(P.ink2) }
                        if !e.note.isEmpty { Text(e.note).font(F.sans(13.5)).foregroundStyle(P.ink2).lineLimit(3) }
                        if e.mineId.isEmpty {
                            Button("Add to my journals") { store.change("addFromDirectory", e.dirId, store.today) }
                                .buttonStyle(PrimaryButtonStyle(quiet: true))
                        } else {
                            NavigationLink(value: JournalRoute(id: e.mineId)) {
                                Label("In my journals", systemImage: "checkmark").font(F.sans(14, .semibold)).foregroundStyle(P.blue)
                            }
                        }
                    }
                    .padding(.vertical, 4)
                    .listRowBackground(P.panel)
                }
            } footer: {
                if let dir { Text("\(dir.total) journals, checked by hand on \(dir.checked). Always confirm dates and fees on their site before you send.") }
            }
        }
        .scrollContentBackground(.hidden)
        .background(P.bg)
        .searchable(text: $query, prompt: "Search the directory")
        .navigationTitle("Find journals")
    }
}
