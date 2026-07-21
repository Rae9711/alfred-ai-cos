import Foundation

/// Shared App Group helpers used by the main app and the Alfred Keyboard extension.
enum AlfredAppGroup {
    static let suiteName = "group.com.haoruiwang.alfred"
    static let authTokenKey = "alfred.session_token"
    static let apiBaseURLKey = "alfred.api_base_url"
    static let pendingActionsKey = "alfred.pending_confirmed_actions"
    static let defaultAPIBaseURL = "https://alfredaitech.com"

    static var defaults: UserDefaults {
        UserDefaults(suiteName: suiteName) ?? .standard
    }

    static func setAuthToken(_ token: String?) {
        if let token, !token.isEmpty {
            defaults.set(token, forKey: authTokenKey)
        } else {
            defaults.removeObject(forKey: authTokenKey)
        }
    }

    static func authToken() -> String? {
        defaults.string(forKey: authTokenKey)
    }

    static func setAPIBaseURL(_ url: String) {
        defaults.set(url, forKey: apiBaseURLKey)
    }

    static func apiBaseURL() -> String {
        defaults.string(forKey: apiBaseURLKey) ?? defaultAPIBaseURL
    }

    /// Append a confirmed action for the main app to drain on foreground.
    static func enqueueConfirmedAction(_ json: [String: Any]) {
        var list = defaults.array(forKey: pendingActionsKey) as? [[String: Any]] ?? []
        list.append(json)
        defaults.set(list, forKey: pendingActionsKey)
    }

    static func drainConfirmedActions() -> [[String: Any]] {
        let list = defaults.array(forKey: pendingActionsKey) as? [[String: Any]] ?? []
        defaults.removeObject(forKey: pendingActionsKey)
        return list
    }
}
