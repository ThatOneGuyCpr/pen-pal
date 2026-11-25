import SwiftUI

/// The monthly fee budget, one month at a time, like the Windows Budget page.
struct BudgetView: View {
    @Environment(Store.self) private var store
    @State private var month = ""
    @State private var amount = ""
    @State private var warn = 80

    private var ym: String { month.isEmpty ? String(store.today.prefix(7)) : month }

    var body: some View {
        ScrollView {
            if let b = store.budget(ym) {
                VStack(alignment: .leading, spacing: 16) {
                    HStack {
                        Button { month = b.prev } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }
                            .accessibilityLabel("Previous month")
                        Spacer()
                        Text(b.name).font(F.serif(22))
                        Spacer()
                        Button { month = b.next } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }
                            .accessibilityLabel("Next month")
                    }
                    if ym != b.thisMonth {
                        Button("Back to this month") { month = b.thisMonth }.font(F.sans(14, .semibold)).frame(maxWidth: .infinity)
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        Text("Spent on fees").font(F.sans(13, .semibold)).foregroundStyle(P.muted)
                        Text(b.spent).font(F.serif(40))
                        if b.budget.isEmpty {
                            Text("No budget for \(b.name). Set one below and Pen Pal warns you before a fee goes over.")
                                .font(F.sans(14)).foregroundStyle(P.ink2)
                        } else {
                            Meter(spent: b.spentFrac, planned: b.plannedFrac, warn: b.warnFrac)
                                .accessibilityElement()
                                .accessibilityLabel("\(b.spent) spent\(b.planned.isEmpty ? "" : ", \(b.planned) planned") of a \(b.budget) budget")
                            HStack {
                                Text("$0")
                                Spacer()
                                Text("Heads-up at \(b.warnAt)")
                                Spacer()
                                Text(b.budget)
                            }
                            .font(F.sans(12.5)).foregroundStyle(P.muted)
                            Text(b.left + (b.planned.isEmpty ? "." : ". Planned entries: \(b.planned)\(b.countPlanned ? ", counted." : ", not counted.")"))
                                .font(F.sans(14.5, .semibold)).foregroundStyle(b.over ? P.red : P.ink2)
                        }
                    }
                    .card()

                    VStack(alignment: .leading, spacing: 10) {
                        HStack(alignment: .firstTextBaseline) {
                            Text("\(String(b.year)) by month").font(F.sans(15, .semibold))
                            Spacer()
                            Text(b.yearLine).font(F.sans(12.5)).foregroundStyle(P.muted)
                        }
                        YearChart(months: b.months, selected: ym) { month = $0 }
                        Text("Tap a month to open it. The dashed line is that month's budget.")
                            .font(F.sans(12.5)).foregroundStyle(P.muted)
                    }
                    .card()

                    VStack(alignment: .leading, spacing: 12) {
                        Text("Monthly budget").font(F.serif(20))
                        HStack {
                            Text("$").foregroundStyle(P.muted)
                            TextField("No budget", text: $amount).keyboardType(.decimalPad)
                        }
                        .padding(.horizontal, 12).frame(minHeight: 44)
                        .background(P.graySoft, in: RoundedRectangle(cornerRadius: 10))
                        Text(b.applies).font(F.sans(12.5)).foregroundStyle(P.muted)
                        Stepper("Heads-up at \(warn)% of it", value: $warn, in: 10...100, step: 5)
                        Toggle("Count planned contest entries", isOn: Binding(get: { b.countPlanned }, set: { store.change("setSetting", "countPlanned", $0 ? "true" : "false") }))
                            .tint(P.blue)
                        HStack(spacing: 8) {
                            Button("Save budget") { store.change("saveBudget", ym, amount, warn) }.buttonStyle(PrimaryButtonStyle(wide: true))
                            if !b.budget.isEmpty {
                                Button("Remove") { store.change("saveBudget", ym, "", warn) }.buttonStyle(PrimaryButtonStyle(quiet: true))
                            }
                        }
                    }
                    .card()

                    VStack(alignment: .leading, spacing: 8) {
                        SectionLabel(text: "Fees in \(b.name)")
                        VStack(spacing: 0) {
                            if b.items.isEmpty {
                                Text("No fees recorded.").font(F.sans(14)).foregroundStyle(P.muted)
                                    .frame(maxWidth: .infinity, alignment: .leading).padding(16)
                            }
                            ForEach(Array(b.items.enumerated()), id: \.offset) { i, item in
                                if i > 0 { Divider().overlay(P.line) }
                                HStack(alignment: .top) {
                                    Text(item.date).font(F.mono(12.5)).foregroundStyle(P.muted).frame(width: 52, alignment: .leading)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(item.name).font(F.sans(15, .semibold))
                                        Text(item.what).font(F.sans(13)).foregroundStyle(P.muted)
                                    }
                                    Spacer()
                                    Text(item.amount).font(F.sans(15, .semibold)).foregroundStyle(item.planned ? P.blue : P.ink)
                                }
                                .padding(.horizontal, 16).padding(.vertical, 11)
                            }
                        }
                        .background(P.panel, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    }
                }
                .padding(16)
                .task(id: ym) { amount = b.budgetValue; warn = b.warnPct }
            }
        }
        .background(P.bg)
        .navigationTitle("Fee budget")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Spent (solid), planned (lighter) and the heads-up mark, against the month's budget.
struct Meter: View {
    let spent: Double
    let planned: Double
    let warn: Double

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            ZStack(alignment: .leading) {
                Capsule().fill(P.graySoft)
                HStack(spacing: 2) {
                    if spent > 0 { Capsule().fill(P.blue).frame(width: max(6, w * spent)) }
                    if planned > 0 { Capsule().fill(P.blue.opacity(0.4)).frame(width: max(4, w * min(planned, 1 - spent))) }
                }
                Rectangle().fill(P.ink2).frame(width: 2, height: 22).offset(x: w * warn - 1)
            }
        }
        .frame(height: 14)
    }
}

/// Twelve months of fees; each bar opens its month.
struct YearChart: View {
    let months: [BudgetMonth]
    let selected: String
    let pick: (String) -> Void
    private let plot: CGFloat = 120

    var body: some View {
        HStack(alignment: .bottom, spacing: 3) {
            ForEach(months) { m in
                Button { pick(m.month) } label: {
                    VStack(spacing: 4) {
                        Text(m.total > 0 ? m.text : " ")
                            .font(F.sans(9.5, .semibold))
                            .foregroundStyle(m.over ? P.red : P.muted)
                            .lineLimit(1).minimumScaleFactor(0.7)
                        ZStack(alignment: .bottom) {
                            Color.clear.frame(height: plot)
                            VStack(spacing: 2) {
                                if m.planned > 0 { RoundedRectangle(cornerRadius: 3).fill(P.blue.opacity(0.4)).frame(height: max(3, plot * m.height * m.planned / max(m.total, 0.01))) }
                                if m.spent > 0 { RoundedRectangle(cornerRadius: 3).fill(P.blue).frame(height: max(3, plot * m.height * m.spent / max(m.total, 0.01))) }
                            }
                            .padding(.horizontal, 3)
                            if let cap = m.cap {
                                DashedLine().stroke(P.ink2, style: StrokeStyle(lineWidth: 1.5, dash: [3, 2]))
                                    .frame(height: 1.5)
                                    .offset(y: -plot * cap)
                            }
                        }
                        Text(m.label).font(F.mono(10.5)).foregroundStyle(m.month == selected ? P.ink : P.muted)
                    }
                    .padding(.vertical, 4)
                    .background(m.month == selected ? P.blueSoft : Color.clear, in: RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(m.label): \(m.text)\(m.budget.map { " of a $\(Int($0)) budget" } ?? "")")
                .accessibilityAddTraits(m.month == selected ? .isSelected : [])
            }
        }
    }
}

struct DashedLine: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: rect.minX, y: rect.midY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        return p
    }
}

/// How it is going: the same figures as the Windows Insights page.
struct InsightsView: View {
    @Environment(Store.self) private var store

    var body: some View {
        ScrollView {
            if let i = store.insights {
                VStack(alignment: .leading, spacing: 16) {
                    if i.empty {
                        Text("Charts fill in as you log submissions and record answers.")
                            .font(F.sans(14.5)).foregroundStyle(P.muted).card()
                    } else {
                        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                            ForEach(i.tiles, id: \.self) { t in
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(t.value).font(F.serif(26)).lineLimit(1).minimumScaleFactor(0.6)
                                    Text(t.label).font(F.sans(12.5)).foregroundStyle(P.muted)
                                }
                                .card(padding: 14)
                            }
                        }
                        Text(i.counts).font(F.sans(13.5)).foregroundStyle(P.ink2).padding(.horizontal, 4)
                        chart("How long each journal takes to answer", "Median days from sending to an answer. With only a few answers, a rough guide.", i.timed, empty: "No answers with both dates yet.")
                        chart("Acceptance by journal", "Accepted, out of the submissions that got a yes or a no.", i.answered, empty: "Nothing answered yet.")
                        chart("How long answers take overall", "Answered submissions in each range.", i.buckets, empty: "No answers with dates yet.")
                    }
                }
                .padding(16)
            }
        }
        .background(P.bg)
        .navigationTitle("Insights")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func chart(_ title: String, _ hint: String, _ rows: [BarRow], empty: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(F.sans(15, .semibold))
            Text(hint).font(F.sans(12.5)).foregroundStyle(P.muted)
            if rows.isEmpty {
                Text(empty).font(F.sans(13.5)).foregroundStyle(P.muted)
            }
            ForEach(rows, id: \.self) { r in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(r.label).font(F.sans(14, .semibold))
                        if !r.sub.isEmpty { Text(r.sub).font(F.sans(12)).foregroundStyle(P.muted) }
                        Spacer()
                        Text(r.text).font(F.sans(13.5, .semibold)).foregroundStyle(P.ink2)
                    }
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(P.graySoft)
                            Capsule().fill(P.blue).frame(width: max(4, geo.size.width * r.frac))
                        }
                    }
                    .frame(height: 8)
                }
                .accessibilityElement(children: .combine)
            }
        }
        .card()
    }
}
