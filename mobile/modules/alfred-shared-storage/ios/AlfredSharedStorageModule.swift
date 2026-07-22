import Foundation
import ExpoModulesCore

public class AlfredSharedStorageModule: Module {
  private let suiteName = "group.com.haoruiwang.alfred"
  private let authTokenKey = "alfred.session_token"
  private let authTokenUpdatedAtKey = "alfred.session_token_updated_at"
  private let apiBaseURLKey = "alfred.api_base_url"
  private let pendingActionsKey = "alfred.pending_confirmed_actions"
  private let keyboardLastSeenKey = "alfred.keyboard_last_seen"
  private let pendingHandoffKey = "alfred.pending_conversation_handoff"

  /// `nil` when App Group suite cannot be opened — never fall back to `.standard`.
  private var sharedDefaults: UserDefaults? {
    UserDefaults(suiteName: suiteName)
  }

  public func definition() -> ModuleDefinition {
    Name("AlfredSharedStorage")

    AsyncFunction("isAppGroupAvailable") { () -> Bool in
      self.sharedDefaults != nil
    }

    AsyncFunction("setAuthToken") { (token: String?) in
      guard let defaults = self.sharedDefaults else { return }
      if let token, !token.isEmpty {
        defaults.set(token, forKey: self.authTokenKey)
        defaults.set(
          ISO8601DateFormatter().string(from: Date()),
          forKey: self.authTokenUpdatedAtKey
        )
      } else {
        defaults.removeObject(forKey: self.authTokenKey)
        defaults.removeObject(forKey: self.authTokenUpdatedAtKey)
      }
    }

    AsyncFunction("getAuthToken") { () -> String? in
      self.sharedDefaults?.string(forKey: self.authTokenKey)
    }

    AsyncFunction("getAuthTokenUpdatedAt") { () -> String? in
      self.sharedDefaults?.string(forKey: self.authTokenUpdatedAtKey)
    }

    AsyncFunction("getKeyboardLastSeen") { () -> String? in
      self.sharedDefaults?.string(forKey: self.keyboardLastSeenKey)
    }

    AsyncFunction("setApiBaseUrl") { (url: String) in
      self.sharedDefaults?.set(url, forKey: self.apiBaseURLKey)
    }

    AsyncFunction("drainConfirmedActions") { () -> [[String: Any]] in
      guard let defaults = self.sharedDefaults else { return [] }
      let list = defaults.array(forKey: self.pendingActionsKey) as? [[String: Any]] ?? []
      defaults.removeObject(forKey: self.pendingActionsKey)
      return list
    }

    AsyncFunction("takePendingHandoff") { () -> [String: Any]? in
      guard let defaults = self.sharedDefaults else { return nil }
      let value = defaults.dictionary(forKey: self.pendingHandoffKey)
      defaults.removeObject(forKey: self.pendingHandoffKey)
      return value
    }

    AsyncFunction("peekPendingHandoff") { () -> [String: Any]? in
      self.sharedDefaults?.dictionary(forKey: self.pendingHandoffKey)
    }
  }
}
