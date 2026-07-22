import Foundation

/// Shared App Group helpers used by the main app and the Alfred Keyboard extension.
/// Never silently fall back to `.standard` — suite failure must be detectable.
enum AlfredAppGroup {
    static let suiteName = "group.com.haoruiwang.alfred"
    static let authTokenKey = "alfred.session_token"
    static let authTokenUpdatedAtKey = "alfred.session_token_updated_at"
    static let apiBaseURLKey = "alfred.api_base_url"
    static let pendingActionsKey = "alfred.pending_confirmed_actions"
    static let keyboardLastSeenKey = "alfred.keyboard_last_seen"
    static let pendingHandoffKey = "alfred.pending_conversation_handoff"
    static let defaultAPIBaseURL = "https://alfredaitech.com"

    /// `nil` when the App Group suite cannot be opened (entitlements / provisioning).
    static var sharedDefaults: UserDefaults? {
        UserDefaults(suiteName: suiteName)
    }

    static var isAvailable: Bool {
        sharedDefaults != nil
    }

    static func markKeyboardSeen() {
        sharedDefaults?.set(ISO8601DateFormatter().string(from: Date()), forKey: keyboardLastSeenKey)
    }

    static func setAuthToken(_ token: String?) {
        guard let defaults = sharedDefaults else { return }
        if let token, !token.isEmpty {
            defaults.set(token, forKey: authTokenKey)
            defaults.set(ISO8601DateFormatter().string(from: Date()), forKey: authTokenUpdatedAtKey)
        } else {
            defaults.removeObject(forKey: authTokenKey)
            defaults.removeObject(forKey: authTokenUpdatedAtKey)
        }
    }

    static func authToken() -> String? {
        sharedDefaults?.string(forKey: authTokenKey)
    }

    static func authTokenUpdatedAt() -> String? {
        sharedDefaults?.string(forKey: authTokenUpdatedAtKey)
    }

    static func setAPIBaseURL(_ url: String) {
        sharedDefaults?.set(url, forKey: apiBaseURLKey)
    }

    static func apiBaseURL() -> String {
        sharedDefaults?.string(forKey: apiBaseURLKey) ?? defaultAPIBaseURL
    }

    /// Append a confirmed action for the main app to drain on foreground.
    static func enqueueConfirmedAction(_ json: [String: Any]) {
        guard let defaults = sharedDefaults else { return }
        var list = defaults.array(forKey: pendingActionsKey) as? [[String: Any]] ?? []
        list.append(json)
        defaults.set(list, forKey: pendingActionsKey)
    }

    static func drainConfirmedActions() -> [[String: Any]] {
        guard let defaults = sharedDefaults else { return [] }
        let list = defaults.array(forKey: pendingActionsKey) as? [[String: Any]] ?? []
        defaults.removeObject(forKey: pendingActionsKey)
        return list
    }

    /// Handoff parse/analyze session so main app can open Import / conversation.
    static func setPendingHandoff(_ json: [String: Any]?) {
        guard let defaults = sharedDefaults else { return }
        if let json {
            defaults.set(json, forKey: pendingHandoffKey)
        } else {
            defaults.removeObject(forKey: pendingHandoffKey)
        }
    }

    static func takePendingHandoff() -> [String: Any]? {
        guard let defaults = sharedDefaults else { return nil }
        let value = defaults.dictionary(forKey: pendingHandoffKey)
        defaults.removeObject(forKey: pendingHandoffKey)
        return value
    }
}
