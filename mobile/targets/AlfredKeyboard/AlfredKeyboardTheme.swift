import UIKit

/// Visual tokens for the Alfred Keyboard extension — mirrors
/// `mobile/src/theme/theme.ts` / alfred-ui-system (warm cream paper).
enum AlfredKeyboardTheme {
    // MARK: - Colors (CSS :root / theme.ts)

    /// `#F8F5EF` — paper / background
    static let paper = UIColor(rgb: 0xF8F5EF)
    /// `#F5F2EC`
    static let paper2 = UIColor(rgb: 0xF5F2EC)
    /// `#ECE8DF`
    static let paper3 = UIColor(rgb: 0xECE8DF)
    /// `#FFFDF9` — surface / card
    static let surface = UIColor(rgb: 0xFFFDF9)
    /// `rgba(255,253,249,0.94)`
    static let glass = UIColor(rgb: 0xFFFDF9).withAlphaComponent(0.94)

    /// `#2F66C8` — accent blue / primary CTA
    static let accent = UIColor(rgb: 0x2F66C8)
    /// `#3F74D8`
    static let accentBright = UIColor(rgb: 0x3F74D8)
    /// `#EAF1FF`
    static let accentSoft = UIColor(rgb: 0xEAF1FF)
    /// `#17376D`
    static let accentInk = UIColor(rgb: 0x17376D)
    /// `#E8F0FF` — IconTile blue well
    static let accentWell = UIColor(rgb: 0xE8F0FF)

    /// `#625AE6` — soft purple for AI actions
    static let tonePurple = UIColor(rgb: 0x625AE6)
    /// `#EEEAFF` / pill.ai background
    static let purpleSoft = UIColor(rgb: 0xF3EFFF)
    /// `#E4DDFF`
    static let purpleHair = UIColor(rgb: 0xE4DDFF)

    /// `#0D1D3B` — primary ink
    static let ink = UIColor(rgb: 0x0D1D3B)
    /// `#77756F`
    static let inkMuted = UIColor(rgb: 0x77756F)
    /// `#8A867F`
    static let inkTertiary = UIColor(rgb: 0x8A867F)

    /// `rgba(157,147,127,0.13)` — hairline
    static let hair = UIColor(red: 157 / 255, green: 147 / 255, blue: 127 / 255, alpha: 0.13)
    /// `#E8E2D8`
    static let line = UIColor(rgb: 0xE8E2D8)

    /// Cream primary CTA fill (design-system gradient mid)
    static let creamButton = UIColor(rgb: 0xF0EBE3)
    /// `#26446F` — cream CTA label
    static let creamButtonInk = UIColor(rgb: 0x26446F)

    /// `#A84A36`
    static let warn = UIColor(rgb: 0xA84A36)
    /// `#F0DDD2`
    static let warnSoft = UIColor(rgb: 0xF0DDD2)
    /// `#3B9A61`
    static let success = UIColor(rgb: 0x3B9A61)
    /// `#E8F7EE`
    static let successSoft = UIColor(rgb: 0xE8F7EE)

    // MARK: - Radii / spacing

    static let radiusCard: CGFloat = 14
    static let radiusChip: CGFloat = 12
    static let radiusChrome: CGFloat = 10
    static let hairlineWidth: CGFloat = 1

    // MARK: - Typography

    /// Noto-like serif for section titles (New York / system serif → Georgia).
    static func titleFont(size: CGFloat, weight: UIFont.Weight = .semibold) -> UIFont {
        let base = UIFont.systemFont(ofSize: size, weight: weight)
        if let descriptor = base.fontDescriptor.withDesign(.serif) {
            return UIFont(descriptor: descriptor, size: size)
        }
        return UIFont(name: "Georgia-Bold", size: size)
            ?? UIFont(name: "Georgia", size: size)
            ?? base
    }

    /// Brand wordmark — Georgia.
    static func brandFont(size: CGFloat) -> UIFont {
        UIFont(name: "Georgia-BoldItalic", size: size)
            ?? UIFont(name: "Georgia-Bold", size: size)
            ?? UIFont(name: "Georgia", size: size)
            ?? titleFont(size: size, weight: .bold)
    }

    /// SF for body / chips / chrome.
    static func bodyFont(size: CGFloat, weight: UIFont.Weight = .regular) -> UIFont {
        .systemFont(ofSize: size, weight: weight)
    }

    // MARK: - Card chrome helper

    static func applyCardChrome(
        to view: UIView,
        fill: UIColor = surface,
        radius: CGFloat = radiusCard,
        bordered: Bool = true
    ) {
        view.backgroundColor = fill
        view.layer.cornerRadius = radius
        view.clipsToBounds = true
        if bordered {
            view.layer.borderWidth = hairlineWidth
            view.layer.borderColor = hair.cgColor
        } else {
            view.layer.borderWidth = 0
        }
    }
}

private extension UIColor {
    convenience init(rgb: UInt32, alpha: CGFloat = 1) {
        self.init(
            red: CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255,
            alpha: alpha
        )
    }
}
