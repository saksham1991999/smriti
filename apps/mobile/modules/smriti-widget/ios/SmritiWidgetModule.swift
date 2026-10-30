import ExpoModulesCore
import WidgetKit

/// Saves the widget payload (apps/mobile/src/platform/widget.ts) where the WidgetKit extension
/// reads it: the App Group named by the `SmritiWidgetAppGroup` Info.plist key, which the config
/// plugin (apps/mobile/plugins/widgets) sets to the same group as the app's entitlement.
public class SmritiWidgetModule: Module {
  static let payloadKey = "smriti.widget.payload"

  static func sharedDefaults() -> UserDefaults? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "SmritiWidgetAppGroup") as? String, !group.isEmpty else {
      return nil
    }
    return UserDefaults(suiteName: group)
  }

  public func definition() -> ModuleDefinition {
    Name("SmritiWidget")

    AsyncFunction("setPayload") { (json: String) in
      guard let defaults = Self.sharedDefaults() else { return }
      defaults.set(json, forKey: Self.payloadKey)
      WidgetCenter.shared.reloadAllTimelines()
    }

    AsyncFunction("clear") {
      guard let defaults = Self.sharedDefaults() else { return }
      defaults.removeObject(forKey: Self.payloadKey)
      WidgetCenter.shared.reloadAllTimelines()
    }
  }
}
