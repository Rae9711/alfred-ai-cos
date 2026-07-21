import Foundation
import ExpoModulesCore

public class AlfredSharedStorageModule: Module {
  private let suiteName = "group.com.haoruiwang.alfred"
  private let authTokenKey = "alfred.session_token"
  private let apiBaseURLKey = "alfred.api_base_url"
  private let pendingActionsKey = "alfred.pending_confirmed_actions"

  private var defaults: UserDefaults {
    UserDefaults(suiteName: suiteName) ?? .standard
  }

  public func definition() -> ModuleDefinition {
    Name("AlfredSharedStorage")

    AsyncFunction("setAuthToken") { (token: String?) in
      if let token, !token.isEmpty {
        self.defaults.set(token, forKey: self.authTokenKey)
      } else {
        self.defaults.removeObject(forKey: self.authTokenKey)
      }
    }

    AsyncFunction("getAuthToken") { () -> String? in
      self.defaults.string(forKey: self.authTokenKey)
    }

    AsyncFunction("setApiBaseUrl") { (url: String) in
      self.defaults.set(url, forKey: self.apiBaseURLKey)
    }

    AsyncFunction("drainConfirmedActions") { () -> [[String: Any]] in
      let list = self.defaults.array(forKey: self.pendingActionsKey) as? [[String: Any]] ?? []
      self.defaults.removeObject(forKey: self.pendingActionsKey)
      return list
    }
  }
}
