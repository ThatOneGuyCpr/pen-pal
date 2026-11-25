import SwiftUI
import UniformTypeIdentifiers

/// First run: point Pen Pal at the folder in iCloud Drive that your PCs use.
struct ConnectView: View {
    @Environment(Store.self) private var store
    @State private var picking = false
    @State private var check: FolderCheck?
    @State private var working = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 10) {
                    Image(systemName: "envelope").font(.system(size: 38, weight: .regular)).foregroundStyle(P.blue)
                    Text("Pen Pal").font(F.serif(34))
                    Text("Your journals and submissions live in one file in iCloud Drive, the same one your PCs use. Point Pen Pal at it once.")
                        .foregroundStyle(P.ink2)
                }
                step(1, done: check?.error == nil && check != nil, title: "Choose the Pen Pal folder", text: "In Files, open iCloud Drive and pick the Pen Pal folder. New to Pen Pal? Pick or make any folder in iCloud Drive.")
                if let check {
                    VStack(alignment: .leading, spacing: 8) {
                        Label(check.display, systemImage: "icloud").font(F.sans(15, .semibold)).foregroundStyle(P.ink)
                        if let error = check.error {
                            Text(error).font(F.sans(13.5)).foregroundStyle(P.red)
                        } else if let s = check.summary {
                            Text("\(s.counts). Saved \(s.saved).").font(F.sans(13.5)).foregroundStyle(P.ink2)
                        } else {
                            Text("No Pen Pal data here yet. Pen Pal will start a new file.").font(F.sans(13.5)).foregroundStyle(P.ink2)
                        }
                        Button("Choose a different folder") { picking = true }.font(F.sans(14, .semibold)).foregroundStyle(P.blue)
                    }
                    .card(padding: 14)
                    .overlay(RoundedRectangle(cornerRadius: 18).stroke(P.blue, lineWidth: 1.5))
                    .padding(.leading, 38)
                }
                step(2, done: false, title: "Allow notifications", text: "So reading period reminders reach this iPhone. You can change it later.")
                Text("Running in LiveContainer? Turn on Fix File Picker & Local Notification for Pen Pal first: long-press the app, then Settings.")
                    .font(F.sans(13.5)).foregroundStyle(P.ink2)
                    .padding(12)
                    .background(P.graySoft, in: RoundedRectangle(cornerRadius: 12))
                VStack(spacing: 6) {
                    if let check, check.error == nil {
                        Button(check.summary == nil ? "Start Pen Pal here" : "Use this data") { use(check.url) }
                            .buttonStyle(PrimaryButtonStyle(wide: true)).disabled(working)
                    } else {
                        Button("Choose folder in Files") { picking = true }.buttonStyle(PrimaryButtonStyle(wide: true))
                    }
                }
                .frame(maxWidth: .infinity)
            }
            .padding(.horizontal, 24)
            .padding(.top, 64)
            .padding(.bottom, 28)
        }
        .background(P.bg)
        .overlay(alignment: .top) { Stripe().ignoresSafeArea(edges: .top) }
        .fileImporter(isPresented: $picking, allowedContentTypes: [.folder]) { result in
            if case .success(let url) = result { check = store.inspect(url) }
        }
    }

    private func step(_ n: Int, done: Bool, title: String, text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle().fill(done ? P.blue : P.graySoft).frame(width: 26, height: 26)
                if done { Image(systemName: "checkmark").font(.system(size: 12, weight: .bold)).foregroundStyle(P.onBlue) }
                else { Text("\(n)").font(F.mono(13)).foregroundStyle(P.ink2) }
            }
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(F.sans(16, .semibold))
                Text(text).font(F.sans(13.5)).foregroundStyle(P.muted)
            }
        }
    }

    private func use(_ url: URL) {
        working = true
        Task {
            if await store.reminders.status() == .notDetermined { _ = await store.reminders.requestPermission() }
            store.connect(url)
            working = false
        }
    }
}
