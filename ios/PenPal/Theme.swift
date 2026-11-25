import SwiftUI
import UIKit

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: 1)
    }
}

extension Color {
    /// One color for light mode, one for dark, the same pairs as the Windows app's style.css.
    init(light: UInt32, dark: UInt32) {
        self = Color(UIColor { traits in UIColor(hex: traits.userInterfaceStyle == .dark ? dark : light) })
    }
}

/// Pen Pal's palette.
enum P {
    static let bg = Color(light: 0xf3f4f5, dark: 0x12171d)
    static let panel = Color(light: 0xffffff, dark: 0x1b232c)
    static let ink = Color(light: 0x16202b, dark: 0xe8ecef)
    static let ink2 = Color(light: 0x3a4650, dark: 0xc7cfd5)
    static let muted = Color(light: 0x56616b, dark: 0x9aa5ae)
    static let line = Color(light: 0xdde1e4, dark: 0x2d3742)
    static let red = Color(light: 0xb8322a, dark: 0xf08a7e)
    static let redSoft = Color(light: 0xf7e4e1, dark: 0x3a2421)
    static let blue = Color(light: 0x234e8c, dark: 0x93b4e8)
    static let blueSoft = Color(light: 0xe2e9f3, dark: 0x1e2c40)
    static let onBlue = Color(light: 0xffffff, dark: 0x0f1a2a)
    static let graySoft = Color(light: 0xe9edef, dark: 0x242d37)
}

/// Pen Pal's type: Young Serif for headings, Public Sans for text, IBM Plex Mono for small labels.
enum F {
    static func serif(_ size: CGFloat) -> Font { .custom("YoungSerif-Regular", size: size, relativeTo: .title) }
    static func sans(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        let name: String
        switch weight {
        case .medium: name = "PublicSansThin-Medium"
        case .semibold: name = "PublicSansThin-SemiBold"
        case .bold, .heavy, .black: name = "PublicSansThin-Bold"
        default: name = "PublicSansThin-Regular"
        }
        return .custom(name, size: size, relativeTo: .body)
    }
    static func mono(_ size: CGFloat) -> Font { .custom("IBMPlexMono-Regular", size: size, relativeTo: .caption) }
}

enum Appearance {
    /// Navigation titles in Young Serif, like the mockup.
    static func apply() {
        let big = UIFont(name: "YoungSerif-Regular", size: 34) ?? .systemFont(ofSize: 34, weight: .bold)
        let small = UIFont(name: "PublicSansThin-SemiBold", size: 17) ?? .systemFont(ofSize: 17, weight: .semibold)
        let standard = UINavigationBarAppearance()
        standard.configureWithDefaultBackground()
        standard.largeTitleTextAttributes = [.font: big]
        standard.titleTextAttributes = [.font: small]
        let edge = UINavigationBarAppearance()
        edge.configureWithTransparentBackground()
        edge.largeTitleTextAttributes = [.font: big]
        edge.titleTextAttributes = [.font: small]
        UINavigationBar.appearance().standardAppearance = standard
        UINavigationBar.appearance().compactAppearance = standard
        UINavigationBar.appearance().scrollEdgeAppearance = edge
    }
}

/// The airmail stripe along the top edge.
struct Stripe: View {
    var body: some View {
        Canvas { context, size in
            context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(P.bg))
            let h = size.height
            let red = Color(UIColor(hex: 0xc2453c))
            let blue = Color(UIColor(hex: 0x3a64a8))
            var x: CGFloat = -h - 36
            var i = 0
            while x < size.width + h {
                var p = Path()
                p.move(to: CGPoint(x: x, y: h))
                p.addLine(to: CGPoint(x: x + h, y: 0))
                p.addLine(to: CGPoint(x: x + h + 12, y: 0))
                p.addLine(to: CGPoint(x: x + 12, y: h))
                p.closeSubpath()
                context.fill(p, with: .color(i % 2 == 0 ? red : blue))
                x += 18
                i += 1
            }
        }
        .frame(height: 6)
        .accessibilityHidden(true)
    }
}

struct Chip: View {
    let text: String
    var tone: String = "gray"
    var body: some View {
        Text(text)
            .font(F.sans(12.5, .semibold))
            .padding(.horizontal, 9)
            .padding(.vertical, 4)
            .foregroundStyle(tone == "red" ? P.red : tone == "blue" ? P.blue : P.ink2)
            .background(tone == "red" ? P.redSoft : tone == "blue" ? P.blueSoft : P.graySoft, in: Capsule())
    }
}

struct Kicker: View {
    let text: String
    var color: Color = P.muted
    var body: some View {
        Text(text.uppercased()).font(F.mono(12)).tracking(1).foregroundStyle(color)
    }
}

struct SectionLabel: View {
    let text: String
    var body: some View {
        Text(text).font(F.sans(13, .semibold)).foregroundStyle(P.muted).padding(.horizontal, 4)
    }
}

struct CardBackground: ViewModifier {
    var padding: CGFloat = 16
    func body(content: Content) -> some View {
        content.padding(padding).frame(maxWidth: .infinity, alignment: .leading).background(P.panel, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

extension View {
    func card(padding: CGFloat = 16) -> some View { modifier(CardBackground(padding: padding)) }
}

/// Section headings and footnotes in lists, at iOS's usual small sizes in Pen Pal's type.
struct ListHeader: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View { Text(text).font(F.sans(13, .semibold)).foregroundStyle(P.muted).textCase(nil) }
}

struct ListFooter: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View { Text(text).font(F.sans(13)).foregroundStyle(P.muted) }
}

struct PrimaryButtonStyle: ButtonStyle {
    var quiet = false
    var wide = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(F.sans(15, .semibold))
            .frame(maxWidth: wide ? .infinity : nil)
            .frame(minHeight: 44)
            .padding(.horizontal, 18)
            .foregroundStyle(quiet ? P.blue : P.onBlue)
            .background(quiet ? P.blueSoft : P.blue, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}

/// The reminder bell on a journal.
struct BellButton: View {
    let on: Bool
    let name: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: on ? "bell.fill" : "bell")
                .font(.system(size: 17, weight: .medium))
                .frame(width: 44, height: 44)
                .foregroundStyle(on ? P.blue : P.muted)
                .background(on ? P.blueSoft : Color.clear, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(on ? "Reminders on for \(name)" : "Remind me about \(name)")
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}
