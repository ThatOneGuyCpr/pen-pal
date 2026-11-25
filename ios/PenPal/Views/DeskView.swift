import SwiftUI

struct DeskView: View {
    @Environment(Store.self) private var store
    @Binding var tab: Int
    @State private var send: SendTarget?

    var body: some View {
        ScrollView {
            if let d = store.desk {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 6) {
                        Kicker(text: d.dateLabel)
                        if !store.syncLine.isEmpty || store.folder != nil {
                            Label(store.syncLine.isEmpty ? "Up to date with \(store.folder?.displayName ?? "your folder")" : store.syncLine, systemImage: "checkmark.icloud")
                                .font(F.sans(13.5)).foregroundStyle(P.muted)
                        }
                    }
                    .padding(.horizontal, 4)

                    if d.empty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Start here").font(F.serif(21))
                            Text("Add the journals you send to (from the directory or by hand) and your poem titles. Pen Pal does the remembering.")
                                .font(F.sans(14.5)).foregroundStyle(P.ink2)
                            HStack {
                                Button("Find journals") { tab = 1 }.buttonStyle(PrimaryButtonStyle())
                                Button("Add poems") { tab = 2 }.buttonStyle(PrimaryButtonStyle(quiet: true))
                            }
                        }
                        .card()
                    }

                    if !d.needs.isEmpty {
                        section("Needs you") {
                            VStack(spacing: 0) {
                                ForEach(Array(d.needs.enumerated()), id: \.element.id) { i, n in
                                    if i > 0 { Divider().overlay(P.line) }
                                    NeedRow(need: n)
                                }
                            }
                            .card(padding: 0)
                        }
                    }

                    if !d.closing.isEmpty {
                        section("Closing soon") {
                            VStack(spacing: 10) {
                                ForEach(d.closing) { c in
                                    VStack(alignment: .leading, spacing: 12) {
                                        HStack(alignment: .top) {
                                            VStack(alignment: .leading, spacing: 4) {
                                                Text(c.name).font(F.serif(21))
                                                Text(c.detail).font(F.sans(13.5)).foregroundStyle(P.muted)
                                            }
                                            Spacer()
                                            Chip(text: c.chip, tone: c.tone)
                                        }
                                        HStack(spacing: 8) {
                                            Button("Send poems") { send = SendTarget(id: c.id) }
                                                .buttonStyle(PrimaryButtonStyle(wide: true))
                                            BellButton(on: c.notify, name: c.name) { store.change("setNotify", c.id, !c.notify) }
                                        }
                                    }
                                    .card()
                                }
                            }
                        }
                    }

                    if !d.opening.isEmpty { journalRows("Opening soon", d.opening) }
                    if !d.open.isEmpty { journalRows("Open now", d.open) }

                    section("Waiting to hear") {
                        if d.waiting.isEmpty {
                            Text("Nothing out right now. When you send poems, Pen Pal counts the wait and tells you when a follow-up makes sense.")
                                .font(F.sans(13.5)).foregroundStyle(P.muted).card()
                        } else {
                            VStack(spacing: 0) {
                                ForEach(Array(d.waiting.enumerated()), id: \.element.id) { i, w in
                                    if i > 0 { Divider().overlay(P.line) }
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(w.journal).font(F.sans(16, .semibold))
                                        Text(w.titles).font(F.sans(14)).foregroundStyle(P.ink2)
                                        Text(w.line).font(F.sans(13)).foregroundStyle(P.muted)
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, 16).padding(.vertical, 12)
                                }
                            }
                            .card(padding: 0)
                        }
                    }

                    HStack {
                        Text(d.fees.label + ": ").foregroundStyle(P.muted) + Text(d.fees.spent).font(F.sans(13.5, .semibold))
                        Spacer()
                        if !d.fees.budget.isEmpty {
                            Text(d.fees.left).foregroundStyle(d.fees.over ? P.red : P.muted)
                        }
                    }
                    .font(F.sans(13.5))
                    .padding(.horizontal, 4)
                }
                .padding(16)
            }
        }
        .background(P.bg)
        .navigationTitle("Desk")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { send = SendTarget(id: "") } label: { Image(systemName: "plus") }
                    .accessibilityLabel("Log a submission")
            }
        }
        .navigationDestination(for: JournalRoute.self) { r in JournalDetailView(id: r.id) }
        .sheet(item: $send) { t in SendSheet(journalId: t.id) }
        .onAppear {
            if store.demoScreen.hasPrefix("send:") { send = SendTarget(id: String(store.demoScreen.dropFirst(5))); store.demoScreen = "" }
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: title)
            content()
        }
    }

    private func journalRows(_ title: String, _ cards: [JCard]) -> some View {
        section(title) {
            VStack(spacing: 0) {
                ForEach(Array(cards.enumerated()), id: \.element.id) { i, c in
                    if i > 0 { Divider().overlay(P.line) }
                    NavigationLink(value: JournalRoute(id: c.id)) {
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(c.name).font(F.sans(16, .semibold)).foregroundStyle(P.ink)
                                Text(c.detail).font(F.sans(13.5)).foregroundStyle(P.muted).multilineTextAlignment(.leading)
                            }
                            Spacer()
                            if !c.chip.isEmpty { Chip(text: c.chip, tone: c.tone) }
                            Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(P.muted)
                        }
                        .padding(.horizontal, 16).padding(.vertical, 12)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .card(padding: 0)
        }
    }
}

struct NeedRow: View {
    @Environment(Store.self) private var store
    let need: Need

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Chip(text: need.label, tone: need.kind == "withdraw" ? "red" : need.kind == "followup" ? "blue" : "gray")
            Text(need.text).font(F.sans(14.5)).foregroundStyle(P.ink2)
            HStack(spacing: 8) {
                switch need.kind {
                case "withdraw":
                    Button("Mark withdrawn") { store.change("withdraw", need.subId, need.poemId, store.today) }.buttonStyle(PrimaryButtonStyle())
                case "followup":
                    Button("I followed up") { store.change("markQueried", need.subId, store.today) }.buttonStyle(PrimaryButtonStyle())
                    Button("Snooze a month") { store.change("snooze", need.subId, store.today) }.buttonStyle(PrimaryButtonStyle(quiet: true))
                default:
                    EmptyView()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
    }
}
