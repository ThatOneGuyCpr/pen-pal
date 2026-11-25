import SwiftUI

struct JournalsView: View {
    @Environment(Store.self) private var store
    @State private var query = ""
    @State private var filter = "all"
    @State private var adding: JForm?

    private let filters: [(String, String)] = [("all", "All"), ("open", "Open now"), ("bells", "Bells on"), ("pays", "Pays")]

    var body: some View {
        let list = store.journals(filter: filter, query: query)
        List {
            Section {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(filters, id: \.0) { f in
                            Button(f.1) { filter = f.0 }
                                .font(F.sans(13.5, .semibold))
                                .padding(.horizontal, 14).frame(minHeight: 36)
                                .foregroundStyle(filter == f.0 ? P.onBlue : P.ink2)
                                .background(filter == f.0 ? P.blue : P.panel, in: Capsule())
                                .overlay(Capsule().stroke(filter == f.0 ? P.blue : P.line))
                                .buttonStyle(.borderless)
                                .accessibilityAddTraits(filter == f.0 ? .isSelected : [])
                        }
                    }
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
            Section {
                if let items = list?.items, !items.isEmpty {
                    ForEach(items) { j in
                        NavigationLink(value: JournalRoute(id: j.id)) {
                            HStack(spacing: 10) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(j.name).font(F.sans(16, .semibold))
                                    Text(j.line).font(F.sans(13.5)).foregroundStyle(P.muted)
                                    if !j.chip.isEmpty || j.pays {
                                        HStack(spacing: 6) {
                                            if !j.chip.isEmpty { Chip(text: j.chip, tone: j.tone) }
                                            if j.pays { Chip(text: "Pays") }
                                        }
                                    }
                                }
                                Spacer()
                                if !j.always {
                                    BellButton(on: j.notify, name: j.name) { store.change("setNotify", j.id, !j.notify) }
                                }
                            }
                        }
                        .listRowBackground(P.panel)
                    }
                } else {
                    Text(list?.count == 0 ? "No journals yet. Find some in the directory, or add one by hand." : "No journals match.")
                        .font(F.sans(14)).foregroundStyle(P.muted)
                        .listRowBackground(P.panel)
                }
            }
            Section {
                NavigationLink(value: FindRoute()) {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Find more journals").font(F.sans(16, .semibold))
                            if let d = store.directory("") { Text("\(d.total) in the directory, checked \(d.checked)").font(F.sans(13.5)).foregroundStyle(P.muted) }
                        }
                    } icon: { Image(systemName: "magnifyingglass").foregroundStyle(P.blue) }
                }
                .listRowBackground(P.panel)
            }
        }
        .scrollContentBackground(.hidden)
        .background(P.bg)
        .searchable(text: $query, prompt: "Search your journals")
        .navigationTitle("My journals")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { adding = store.blankJournal } label: { Image(systemName: "plus") }.accessibilityLabel("Add a journal")
            }
        }
        .navigationDestination(for: JournalRoute.self) { r in JournalDetailView(id: r.id) }
        .navigationDestination(for: FindRoute.self) { _ in FindView() }
        .sheet(item: Binding(get: { adding.map { EditTarget(form: $0) } }, set: { adding = $0?.form })) { t in
            JournalEditView(form: t.form)
        }
    }
}

struct EditTarget: Identifiable {
    var form: JForm
    var id: String { form.id.isEmpty ? "new" : form.id }
}

struct JournalDetailView: View {
    @Environment(Store.self) private var store
    @Environment(\.openURL) private var openURL
    let id: String
    @State private var editing: JForm?
    @State private var send: SendTarget?

    var body: some View {
        ScrollView {
            if let j = store.journal(id) {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(j.name).font(F.serif(32))
                        HStack(spacing: 6) {
                            Chip(text: j.chip.isEmpty ? j.line : j.chip, tone: j.tone)
                            if let fee = j.facts.first(where: { $0.label == "Fee" }), fee.value == "Free" { Chip(text: "Free to send") }
                        }
                    }
                    .padding(.horizontal, 4)

                    if j.hasDates {
                        VStack(alignment: .leading, spacing: 10) {
                            Text(j.periodsTitle).font(F.sans(13, .semibold)).foregroundStyle(P.muted)
                            YearBar(bars: j.bars, today: j.todayPos)
                                .accessibilityElement()
                                .accessibilityLabel("Reading periods: \(j.periodsText) Today is marked in red.")
                            HStack {
                                ForEach(["Jan", "Apr", "Jul", "Oct", "Dec"], id: \.self) { m in
                                    Text(m).font(F.mono(11)).foregroundStyle(P.muted)
                                    if m != "Dec" { Spacer() }
                                }
                            }
                            .accessibilityHidden(true)
                            Text(j.periodsText).font(F.sans(13.5)).foregroundStyle(P.ink2)
                        }
                        .card()
                    } else if j.always {
                        Text("Open all year.").font(F.sans(14)).foregroundStyle(P.ink2).card()
                    } else {
                        Text("No reading dates yet. Add them with Edit so Pen Pal can remind you.").font(F.sans(14)).foregroundStyle(P.muted).card()
                    }

                    if !j.always {
                        Toggle(isOn: Binding(get: { j.notify }, set: { store.change("setNotify", j.id, $0) })) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Remind me").font(F.sans(16, .semibold))
                                Text(j.notify ? (j.remindText.isEmpty ? "Before it opens and closes" : j.remindText + ", on this iPhone") : "A notification a few days before it opens and closes")
                                    .font(F.sans(13.5)).foregroundStyle(P.muted)
                            }
                        }
                        .tint(P.blue)
                        .card(padding: 14)
                    }

                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 0), GridItem(.flexible(), spacing: 0)], spacing: 0) {
                        ForEach(j.facts, id: \.self) { f in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(f.label).font(F.sans(13)).foregroundStyle(P.muted)
                                Text(f.value).font(F.sans(15, .semibold))
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 14).padding(.vertical, 12)
                        }
                    }
                    .background(P.panel, in: RoundedRectangle(cornerRadius: 18, style: .continuous))

                    if !j.notes.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Your notes").font(F.sans(13, .semibold)).foregroundStyle(P.muted)
                            Text(j.notes).font(F.sans(15)).foregroundStyle(P.ink2)
                        }
                        .card()
                    }

                    if !j.subs.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            SectionLabel(text: "What you've sent")
                            VStack(alignment: .leading, spacing: 10) {
                                ForEach(j.subs) { s in
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(s.titles).font(F.sans(15, .semibold))
                                        Text(s.line).font(F.sans(13)).foregroundStyle(P.muted)
                                    }
                                }
                            }
                            .card()
                        }
                    }

                    VStack(spacing: 8) {
                        Button(j.open ? "Send poems" : "Log poems for it") { send = SendTarget(id: j.id) }
                            .buttonStyle(PrimaryButtonStyle(wide: true))
                        if let url = URL(string: j.url), !j.url.isEmpty {
                            Button("Open their submission page") { openURL(url) }
                                .buttonStyle(PrimaryButtonStyle(quiet: true, wide: true))
                        }
                    }
                }
                .padding(16)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) { Button("Edit") { editing = j.form } }
                }
            } else {
                Text("This journal was removed.").foregroundStyle(P.muted).padding(40)
            }
        }
        .background(P.bg)
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: Binding(get: { editing.map { EditTarget(form: $0) } }, set: { editing = $0?.form })) { t in
            JournalEditView(form: t.form)
        }
        .sheet(item: $send) { t in SendSheet(journalId: t.id) }
    }
}

struct YearBar: View {
    let bars: [Bar]
    let today: Double

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 8).fill(P.graySoft)
                ForEach(bars, id: \.self) { b in
                    RoundedRectangle(cornerRadius: 4).fill(P.blue)
                        .frame(width: max(3, w * b.width))
                        .offset(x: w * b.start)
                }
                Rectangle().fill(P.red).frame(width: 2, height: 38).offset(x: w * today - 1)
            }
        }
        .frame(height: 30)
    }
}
