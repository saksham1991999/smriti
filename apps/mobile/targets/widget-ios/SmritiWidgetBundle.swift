import SwiftUI
import WidgetKit

// The WidgetKit extension added by apps/mobile/plugins/widgets at prebuild. The app writes the
// payload (apps/mobile/src/platform/widget.ts) to the App Group and reloads the timelines; between
// writes, the timeline redraws at 12:00, the evening hour and midnight (NTF-08), so the plant line
// and the "new day" state change without the app running.

struct SmritiEntry: TimelineEntry {
  let date: Date
  let payload: WidgetPayload?
}

struct SmritiProvider: TimelineProvider {
  func placeholder(in context: Context) -> SmritiEntry {
    SmritiEntry(date: Date(), payload: nil)
  }

  func getSnapshot(in context: Context, completion: @escaping (SmritiEntry) -> Void) {
    completion(SmritiEntry(date: Date(), payload: WidgetStore.load()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<SmritiEntry>) -> Void) {
    let now = Date()
    let payload = WidgetStore.load()
    let entries = WidgetRules.timeline(payload, now: now).map { SmritiEntry(date: $0, payload: payload) }
    // With no payload, wait for the app to write one (it reloads the timelines).
    completion(Timeline(entries: entries, policy: payload == nil ? .never : .atEnd))
  }
}

enum WidgetKind {
  static let plant = "SmritiPlantWidget"
  static let today = "SmritiTodayWidget"
  static let plan = "SmritiPlanWidget"
}

struct SmritiPlantWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: WidgetKind.plant, provider: SmritiProvider()) { entry in
      PlantWidgetView(entry: entry).smritiWidgetBackground()
    }
    .configurationDisplayName(WidgetText.string("plant_name"))
    .description(WidgetText.string("plant_description"))
    .supportedFamilies([.systemSmall])
  }
}

struct SmritiTodayWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: WidgetKind.today, provider: SmritiProvider()) { entry in
      TodayWidgetView(entry: entry).smritiWidgetBackground()
    }
    .configurationDisplayName(WidgetText.string("today_name"))
    .description(WidgetText.string("today_description"))
    .supportedFamilies([.systemMedium])
  }
}

struct SmritiPlanWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: WidgetKind.plan, provider: SmritiProvider()) { entry in
      PlanWidgetView(entry: entry).smritiWidgetBackground()
    }
    .configurationDisplayName(WidgetText.string("plan_name"))
    .description(WidgetText.string("plan_description"))
    .supportedFamilies([.systemLarge])
  }
}

@main
struct SmritiWidgetBundle: WidgetBundle {
  var body: some Widget {
    SmritiPlantWidget()
    SmritiTodayWidget()
    SmritiPlanWidget()
  }
}
