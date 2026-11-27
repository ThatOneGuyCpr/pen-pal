import SwiftUI

/// Add or edit a journal. Every rule (dates, windows, fee parsing) is applied by logic.js when it saves.
struct JournalEditView: View {
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State var form: JForm
    /// Shown above the form, e.g. what quick add found on a guidelines page.
    var note = ""
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
                if !note.isEmpty {
                    Section { Text(note).font(F.sans(14)).foregroundStyle(P.ink2) }
                }
                Section {
                    TextField("Name", text: $form.name)
                    TextField("Submission page (optional)", text: $form.url)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                }
                Section(header: ListHeader("Reading period")) {
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
                Section(header: ListHeader("What they want")) {
                    LabeledContent("Fee") { TextField("Free, or $3", text: $form.fee).multilineTextAlignment(.trailing).keyboardType(.decimalPad) }
                    LabeledContent("Poems at a time") { TextField("Up to", text: $form.maxPoems).multilineTextAlignment(.trailing).keyboardType(.numberPad) }
                    LabeledContent("Usual reply (days)") { TextField("Days", text: $form.replyDays).multilineTextAlignment(.trailing).keyboardType(.numberPad) }
                    yesNo("Simultaneous submissions", $form.simSubs)
                    yesNo("Pays", $form.pays)
                    yesNo("Takes reprints", $form.reprints)
                }
                Section(header: ListHeader("Notes")) {
                    TextField("Anything worth remembering", text: $form.notes, axis: .vertical).lineLimit(3...8)
                }
                if !error.isEmpty {
                    Section { Text(error).foregroundStyle(P.red) }
                }
                if !form.id.isEmpty {
                    Section {
                        Button("Remove this journal", role: .destructive) { confirmDelete = true }
                    } footer: {
                        ListFooter("Its submissions are removed with it.")
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
