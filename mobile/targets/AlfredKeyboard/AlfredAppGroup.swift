import Foundation

/// Shared App Group helpers used by the Alfred Keyboard extension.
/// Never silently fall back to `.standard` — suite failure must be detectable.
///
/// Important: `UserDefaults(suiteName:)` is almost never `nil` even without the
/// App Group entitlement (it creates a process-local store). Availability must
/// be checked via `FileManager.containerURL(forSecurityApplicationGroupIdentifier:)`.
enum AlfredAppGroup {
    static let suiteName = "group.com.haoruiwang.alfred"
    static let authTokenKey = "alfred.session_token"
    static let authTokenUpdatedAtKey = "alfred.session_token_updated_at"
    static let apiBaseURLKey = "alfred.api_base_url"
    static let pendingActionsKey = "alfred.pending_confirmed_actions"
    static let keyboardLastSeenKey = "alfred.keyboard_last_seen"
    static let pendingHandoffKey = "alfred.pending_conversation_handoff"
    static let chatSelfNameKey = "alfred.chat_self_name"
    static let defaultAPIBaseURL = "https://alfredaitech.com"

    static var containerURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: suiteName)
    }

    /// `nil` when the App Group container cannot be opened (entitlements / provisioning).
    static var sharedDefaults: UserDefaults? {
        guard containerURL != nil else { return nil }
        return UserDefaults(suiteName: suiteName)
    }

    static var isAvailable: Bool {
        containerURL != nil
    }

    static func markKeyboardSeen() {
        guard let defaults = sharedDefaults else { return }
        defaults.set(ISO8601DateFormatter().string(from: Date()), forKey: keyboardLastSeenKey)
        defaults.synchronize()
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
        defaults.synchronize()
    }

    static func authToken() -> String? {
        sharedDefaults?.string(forKey: authTokenKey)
    }

    static func authTokenUpdatedAt() -> String? {
        sharedDefaults?.string(forKey: authTokenUpdatedAtKey)
    }

    static func setAPIBaseURL(_ url: String) {
        guard let defaults = sharedDefaults else { return }
        defaults.set(url, forKey: apiBaseURLKey)
        defaults.synchronize()
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
        defaults.synchronize()
    }

    static func drainConfirmedActions() -> [[String: Any]] {
        guard let defaults = sharedDefaults else { return [] }
        let list = defaults.array(forKey: pendingActionsKey) as? [[String: Any]] ?? []
        defaults.removeObject(forKey: pendingActionsKey)
        defaults.synchronize()
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
        defaults.synchronize()
    }

    static func takePendingHandoff() -> [String: Any]? {
        guard let defaults = sharedDefaults else { return nil }
        let value = defaults.dictionary(forKey: pendingHandoffKey)
        defaults.removeObject(forKey: pendingHandoffKey)
        defaults.synchronize()
        return value
    }

    static func setChatSelfName(_ name: String?) {
        guard let defaults = sharedDefaults else { return }
        if let name, !name.isEmpty {
            defaults.set(name, forKey: chatSelfNameKey)
        } else {
            defaults.removeObject(forKey: chatSelfNameKey)
        }
        defaults.synchronize()
    }

    static func chatSelfName() -> String? {
        sharedDefaults?.string(forKey: chatSelfNameKey)
    }
}
