import SwiftUI

/// Find journals: the directory that ships with Pen Pal (and updates itself), with filters,
/// saved searches, a poem to find homes for, and quick add from a guidelines link.
struct FindView: View {
    @Environment(Store.self) private var store
    @State private var query = ""
    @State private var opts: FindOpts?
    @State private var poemId = ""
    @State private var showFilters = false
    @State private var quickAdd = false
    @State private var askName = false
    @State private var newName = ""

    var body: some View {
        let o = opts ?? store.defaultFind
        let dir = store.directory(query, opts: o, poemId: poemId)
        let meta = store.findMeta
        List {
            Section {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(meta?.when ?? []) { w in
                            FilterChip(label: w.label, on: o.when == w.key) { update { $0.when = w.key } }
                        }
                    }
                    .padding(.horizontal, 16)
                }
                .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 4, trailing: 0))
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        FilterChip(label: "No fee", on: o.maxFee == 0) { update { $0.maxFee = $0.maxFee == 0 ? nil : 0 } }
                        FilterChip(label: "Simultaneous OK", on: o.sim) { update { $0.sim.toggle() } }
                        FilterChip(label: "Pays", on: o.pays) { update { $0.pays.toggle() } }
                        FilterChip(label: "Not sent to yet", on: o.notSent) { update { $0.notSent.toggle() } }
                    }
                    .padding(.horizontal, 16)
                }
                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 8, trailing: 0))
                if !poemId.isEmpty, let title = meta?.poems.first(where: { $0.id == poemId })?.title {
                    HStack {
                        Text("Only journals that could take “\(title)”").font(F.sans(14)).foregroundStyle(P.ink2)
                        Spacer()
                        Button("Clear") { poemId = "" }.font(F.sans(14, .semibold))
                    }
                }
            }
            .listRowBackground(Color.clear)

            if let saved = meta?.saved, !saved.isEmpty {
                Section(header: ListHeader("Saved searches")) {
                    ForEach(saved) { f in
                        Button {
                            opts = f.opts
                            query = f.opts.q
                        } label: {
                            Label(f.name, systemImage: "bookmark").font(F.sans(15, .semibold)).foregroundStyle(P.blue)
                        }
                        .swipeActions {
                            Button("Remove", role: .destructive) { store.change("removeFind", f.id) }
                        }
                    }
                    .listRowBackground(P.panel)
                }
            }

            Section {
                if let items = dir?.items, !items.isEmpty {
                    ForEach(items) { e in
                        NavigationLink(value: DirRoute(id: e.dirId, poemId: poemId)) { DirRowView(e: e) }
                            .listRowBackground(P.panel)
                    }
                } else {
                    Text("No journals match. Try fewer filters or other words.").font(F.sans(14)).foregroundStyle(P.muted)
                        .listRowBackground(P.panel)
                }
            } header: {
                if let dir { ListHeader("\(dir.items.count) of \(dir.total) journals") }
            } footer: {
                VStack(alignment: .leading, spacing: 10) {
                    if let dir { ListFooter("Checked by hand against each journal's own guidelines; this list was last updated \(dir.checked). Always confirm dates and fees on their site before you send.") }
                    if !store.directoryMessage.isEmpty { ListFooter(store.directoryMessage) }
                    ListFooter("Found one elsewhere, like Chill Subs? Copy its guidelines link and use Add from a link.")
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(P.bg)
        .searchable(text: $query, prompt: "Name, place, or kind of journal")
        .navigationTitle("Find journals")
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Menu {
                    Picker("Sort", selection: Binding(get: { o.sort }, set: { v in update { $0.sort = v } })) {
                        ForEach(meta?.sorts ?? []) { s in Text(s.label).tag(s.key) }
                    }
                } label: { Image(systemName: "arrow.up.arrow.down") }
                .accessibilityLabel("Sort")
                Button { showFilters = true } label: {
                    Image(systemName: (dir?.filters ?? 0) > 0 || !poemId.isEmpty ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                }
                .accessibilityLabel("Filters")
                Menu {
                    Button { quickAdd = true } label: { Label("Add from a link", systemImage: "link") }
                    Button { newName = query; askName = true } label: { Label("Save this search", systemImage: "bookmark") }
                    Button { store.checkDirectory(force: true) } label: { Label("Check for new journals", systemImage: "arrow.clockwise") }
                        .disabled(store.directoryChecking)
                } label: { Image(systemName: "ellipsis.circle") }
                .accessibilityLabel("More")
            }
        }
        .sheet(isPresented: $showFilters) {
            FiltersSheet(opts: Binding(get: { opts ?? store.defaultFind }, set: { opts = $0 }), poemId: $poemId)
        }
        .sheet(isPresented: $quickAdd) { QuickAddSheet() }
        .alert("Name this search", isPresented: $askName) {
            TextField("Name", text: $newName)
            Button("Save") {
                var s = o
                s.q = query
                store.change("saveFind", newName, jsonText(s))
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Saved searches are kept with your data, so your PCs have them too.")
        }
        .navigationDestination(for: DirRoute.self) { r in DirDetailView(dirId: r.id, poemId: r.poemId) }
        .onAppear {
            if store.demoScreen == "filters" { showFilters = true }
            if store.demoScreen == "quickadd" { quickAdd = true }
        }
    }

    private func update(_ change: (inout FindOpts) -> Void) {
        var o = opts ?? store.defaultFind
        change(&o)
        opts = o
    }
}

struct FilterChip: View {
    let label: String
    let on: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(label)
                .font(F.sans(14, .semibold))
                .padding(.horizontal, 13)
                .frame(minHeight: 36)
                .foregroundStyle(on ? P.onBlue : P.ink)
                .background(on ? P.blue : P.panel, in: Capsule())
                .overlay(Capsule().stroke(on ? Color.clear : P.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

struct DirRowView: View {
    let e: DirRow
    var body: some View {
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
            if !e.focus.isEmpty || !e.mineId.isEmpty {
                HStack(spacing: 6) {
                    if !e.mineId.isEmpty { Chip(text: e.changed ? "Yours · newer details" : "In my journals", tone: "blue") }
                    ForEach(e.focus.prefix(2), id: \.self) { f in Chip(text: f) }
                }
            }
        }
        .padding(.vertical, 4)
    }
}

/// Everything the filters button holds.
struct FiltersSheet: View {
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Binding var opts: FindOpts
    @Binding var poemId: String

    var body: some View {
        let meta = store.findMeta
        NavigationStack {
            Form {
                Section(header: ListHeader("When")) {
                    Picker("Reading period", selection: $opts.when) {
                        ForEach(meta?.when ?? []) { w in Text(w.label).tag(w.key) }
                    }
                    if opts.when == "soon" || opts.when == "closing" {
                        Stepper("Within \(opts.within) days", value: $opts.within, in: 1...365, step: opts.within < 30 ? 1 : 15)
                    }
                }
                Section(header: ListHeader("Fee and pay")) {
                    Toggle("No fee", isOn: Binding(get: { opts.maxFee == 0 }, set: { opts.maxFee = $0 ? 0 : nil })).tint(P.blue)
                    LabeledContent("Fee at most") {
                        TextField("Any", text: number($opts.maxFee)).multilineTextAlignment(.trailing).keyboardType(.decimalPad)
                    }
                    Toggle("Pays writers", isOn: $opts.pays).tint(P.blue)
                    LabeledContent("Pays at least, a poem") {
                        TextField("Any", text: number($opts.payMin)).multilineTextAlignment(.trailing).keyboardType(.decimalPad)
                    }
                }
                Section(header: ListHeader("Their rules")) {
                    Toggle("Takes simultaneous submissions", isOn: $opts.sim).tint(P.blue)
                    Toggle("Takes reprints", isOn: $opts.reprints).tint(P.blue)
                    Picker("Usually replies within", selection: $opts.maxReply) {
                        Text("Any time").tag(Int?.none)
                        Text("A month").tag(Int?.some(30))
                        Text("2 months").tag(Int?.some(60))
                        Text("3 months").tag(Int?.some(90))
                        Text("6 months").tag(Int?.some(180))
                    }
                    Picker("Print or online", selection: $opts.format) {
                        Text("Either").tag("")
                        Text("Print").tag("print")
                        Text("Online").tag("online")
                    }
                    Toggle("Not sent to yet", isOn: $opts.notSent).tint(P.blue)
                }
                Section {
                    ForEach(meta?.focus ?? []) { f in
                        Button {
                            if opts.focus.contains(f.key) { opts.focus.removeAll { $0 == f.key } } else { opts.focus.append(f.key) }
                        } label: {
                            HStack {
                                Text(f.label).foregroundStyle(P.ink)
                                Spacer()
                                if opts.focus.contains(f.key) { Image(systemName: "checkmark").foregroundStyle(P.blue) }
                            }
                        }
                    }
                } header: { ListHeader("Especially for") } footer: {
                    ListFooter("Every one you pick has to match. Reply times, pay and focus only count where a journal states them.")
                }
                Section {
                    Picker("Poem", selection: $poemId) {
                        Text("Any poem").tag("")
                        ForEach(meta?.poems ?? []) { p in Text(p.title).tag(p.id) }
                    }
                } header: { ListHeader("For a poem") } footer: {
                    ListFooter("Hides journals that already saw it, and ones that take no simultaneous submissions while it is out.")
                }
            }
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Reset") {
                        let sort = opts.sort
                        opts = FindOpts()
                        opts.when = "any"
                        opts.sort = sort
                        poemId = ""
                    }
                }
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.fontWeight(.semibold) }
            }
        }
    }

    private func number(_ value: Binding<Double?>) -> Binding<String> {
        Binding(get: {
            guard let v = value.wrappedValue else { return "" }
            return v == v.rounded() ? String(Int(v)) : String(v)
        }, set: { t in
            let clean = t.replacingOccurrences(of: "$", with: "").trimmingCharacters(in: .whitespaces)
            value.wrappedValue = clean.isEmpty ? nil : Double(clean)
        })
    }
}

/// One directory journal: its details, newer details for your copy, and what you can do.
struct DirDetailView: View {
    @Environment(Store.self) private var store
    let dirId: String
    var poemId = ""
    @State private var send: SendTarget?

    var body: some View {
        let e = store.dirEntry(dirId)
        List {
            if let e {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        if !e.focus.isEmpty || !e.tags.isEmpty { Kicker(text: (e.focus + e.tags).joined(separator: " · ")) }
                        Text(e.name).font(F.serif(26))
                        HStack {
                            Text(e.line).font(F.sans(14)).foregroundStyle(P.muted)
                            if !e.chip.isEmpty { Chip(text: e.chip, tone: e.tone) }
                        }
                        Text(e.note).font(F.sans(15)).foregroundStyle(P.ink2)
                    }
                    .padding(.vertical, 6)
                }
                .listRowBackground(P.panel)
                if !e.changes.isEmpty {
                    Section {
                        ForEach(e.changes) { c in
                            VStack(alignment: .leading, spacing: 3) {
                                Text(c.label).font(F.sans(13, .semibold)).foregroundStyle(P.muted)
                                Text("Yours: \(c.mine)").font(F.sans(14))
                                Text("Directory: \(c.theirs)").font(F.sans(14, .semibold))
                            }
                        }
                        HStack {
                            Button("Use these details") { store.change("takeDirChanges", dirId, store.today) }
                                .buttonStyle(PrimaryButtonStyle())
                            Button("Keep mine") { store.change("keepDirChanges", dirId, store.today) }
                                .buttonStyle(PrimaryButtonStyle(quiet: true))
                        }
                        .listRowSeparator(.hidden)
                    } header: { ListHeader("Newer details in the directory") } footer: {
                        ListFooter("Checked \(e.checked). Your copy stays as it is unless you take them.")
                    }
                    .listRowBackground(P.panel)
                }
                Section {
                    ForEach(e.facts) { f in
                        LabeledContent { Text(f.value).multilineTextAlignment(.trailing).foregroundStyle(P.ink) } label: { Text(f.label).foregroundStyle(P.muted) }
                    }
                } footer: {
                    ListFooter("Checked \(e.checked) against the journal's own guidelines. Details change; read them before you send.")
                }
                .listRowBackground(P.panel)
                Section {
                    if e.mineId.isEmpty {
                        Button("Add to my journals") { store.change("addFromDirectory", dirId, store.today) }
                            .buttonStyle(PrimaryButtonStyle(wide: true))
                        if !poemId.isEmpty {
                            Button("Add and send this poem") {
                                if let id = store.change("addFromDirectory", dirId, store.today), !id.isEmpty { send = SendTarget(id: id) }
                            }
                            .buttonStyle(PrimaryButtonStyle(quiet: true, wide: true))
                        }
                    } else {
                        if !e.history.isEmpty { Text(e.history).font(F.sans(14)).foregroundStyle(P.ink2) }
                        Button("Send poems") { send = SendTarget(id: e.mineId) }
                            .buttonStyle(PrimaryButtonStyle(wide: true))
                        NavigationLink("Open in my journals", value: JournalRoute(id: e.mineId))
                    }
                    if let url = URL(string: e.url), !e.url.isEmpty {
                        Link(destination: url) { Label("Their guidelines", systemImage: "safari") }
                    }
                }
                .listRowBackground(P.panel)
            }
        }
        .scrollContentBackground(.hidden)
        .background(P.bg)
        .navigationTitle(e?.name ?? "Journal")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $send) { t in SendSheet(journalId: t.id, poemId: poemId.isEmpty ? nil : poemId) }
    }
}

/// Quick add: paste a guidelines link (or the text), and Pen Pal fills in the journal form.
struct QuickAddSheet: View {
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var link = ""
    @State private var pasted = ""
    @State private var reading = false
    @State private var error = ""
    @State private var result: QuickForm?

    var body: some View {
        if let result {
            JournalEditView(form: result.form, note: result.found)
        } else {
            NavigationStack {
                Form {
                    Section {
                        TextField("https://", text: $link)
                            .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    } header: { ListHeader("Guidelines link") } footer: {
                        ListFooter("Pen Pal reads the page and fills in what it finds: reading period, fee, poems at a time, simultaneous submissions, pay, reprints and reply time. You check it all before saving.")
                    }
                    Section {
                        TextField("Or paste the guidelines text", text: $pasted, axis: .vertical).lineLimit(4...10)
                    }
                    if !error.isEmpty { Section { Text(error).foregroundStyle(P.red) } }
                }
                .navigationTitle("Add from a link")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        if reading { ProgressView() } else {
                            Button("Read it") { read() }.fontWeight(.semibold)
                                .disabled(link.trimmingCharacters(in: .whitespaces).isEmpty && pasted.trimmingCharacters(in: .whitespaces).isEmpty)
                        }
                    }
                }
            }
        }
    }

    private func read() {
        error = ""
        if !pasted.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            result = store.guidelinesForm(pasted: pasted, url: link)
            return
        }
        reading = true
        Task {
            do { result = try await store.readGuidelines(link) } catch {
                self.error = "\(error.localizedDescription) You can paste the guidelines text instead."
            }
            reading = false
        }
    }
}

struct SendTarget: Identifiable { let id: String }

/// Where can this poem go? A section for the poem screen.
struct PoemMatchesSection: View {
    @Environment(Store.self) private var store
    let poemId: String
    @State private var showAll = false
    @State private var send: SendTarget?

    var body: some View {
        if let m = store.poemMatches(poemId), !m.placed {
            Section {
                if m.items.isEmpty {
                    Text("Nothing in your journals or the directory is open for it right now.").font(F.sans(14)).foregroundStyle(P.muted)
                }
                ForEach(showAll ? m.items : Array(m.items.prefix(6))) { c in
                    HStack(alignment: .center, spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(c.name).font(F.sans(15, .semibold))
                            Text(c.line + (c.mineId.isEmpty ? "" : " · yours")).font(F.sans(13)).foregroundStyle(P.muted)
                            if !c.notes.isEmpty { Text(c.notes).font(F.sans(12.5)).foregroundStyle(P.ink2) }
                        }
                        Spacer()
                        if c.canSend {
                            Button(c.mineId.isEmpty ? "Add and send" : "Send") {
                                if !c.mineId.isEmpty { send = SendTarget(id: c.mineId) }
                                else if let id = store.change("addFromDirectory", c.dirId, store.today), !id.isEmpty { send = SendTarget(id: id) }
                            }
                            .buttonStyle(.borderless)
                            .font(F.sans(14, .semibold))
                            .foregroundStyle(P.blue)
                        }
                    }
                }
                if m.items.count > 6 && !showAll {
                    Button("Show all \(m.items.count)") { showAll = true }.font(F.sans(14, .semibold))
                }
            } header: { ListHeader("Where can it go?") } footer: {
                ListFooter((m.left.isEmpty ? "" : m.left + " ") + "Open now or opening within 30 days, from your journals and the directory.")
            }
            .sheet(item: $send) { t in SendSheet(journalId: t.id, poemId: poemId) }
        }
    }
}
