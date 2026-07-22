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

  /// Real App Group probe — `UserDefaults(suiteName:)` is almost never nil even
  /// without the entitlement (it creates a process-local store), so diagnostics
  /// must use the shared container URL.
  private var containerURL: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: suiteName)
  }

  private var sharedDefaults: UserDefaults? {
    guard containerURL != nil else { return nil }
    return UserDefaults(suiteName: suiteName)
  }

  public func definition() -> ModuleDefinition {
    Name("AlfredSharedStorage")

    AsyncFunction("isAppGroupAvailable") { () -> Bool in
      self.containerURL != nil
    }

    /// Returns true when the write landed in the real shared container.
    AsyncFunction("setAuthToken") { (token: String?) -> Bool in
      guard let defaults = self.sharedDefaults else { return false }
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
      defaults.synchronize()
      return true
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

    AsyncFunction("setApiBaseUrl") { (url: String) -> Bool in
      guard let defaults = self.sharedDefaults else { return false }
      defaults.set(url, forKey: self.apiBaseURLKey)
      defaults.synchronize()
      return true
    }

    AsyncFunction("drainConfirmedActions") { () -> [[String: Any]] in
      guard let defaults = self.sharedDefaults else { return [] }
      let list = defaults.array(forKey: self.pendingActionsKey) as? [[String: Any]] ?? []
      defaults.removeObject(forKey: self.pendingActionsKey)
      defaults.synchronize()
      return list
    }

    AsyncFunction("takePendingHandoff") { () -> [String: Any]? in
      guard let defaults = self.sharedDefaults else { return nil }
      let value = defaults.dictionary(forKey: self.pendingHandoffKey)
      defaults.removeObject(forKey: self.pendingHandoffKey)
      defaults.synchronize()
      return value
    }

    AsyncFunction("peekPendingHandoff") { () -> [String: Any]? in
      self.sharedDefaults?.dictionary(forKey: self.pendingHandoffKey)
    }
  }
}
