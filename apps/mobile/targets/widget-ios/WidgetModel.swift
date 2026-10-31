import Foundation
import UIKit

// The payload written by apps/mobile/src/platform/widget.ts (`buildWidgetPayload`) through the
// SmritiWidget native module, and the view rules ported from `widgetView` there. Keep the two in
// step: the Jest tests in apps/mobile/test/widget.test.ts pin the JS side.

struct WidgetPayload: Decodable {
  struct Plant: Decodable {
    let stage: String
    let health: String
  }

  struct Pet: Decodable {
    let species: String
    let name: String?
    let state: String
  }

  struct Snapshot: Decodable {
    let writtenAt: String
    let localDay: String
    let tz: String
    let locale: String
    let isUnder10: Bool
    let streak: Int
    let goalMetToday: Bool
    let goalProgress: Double
    let restDayToday: Bool
    let lastActivityDay: String?
    let plant: Plant
    let pet: Pet?
    let healthByMissedDays: [String: Int]
    let dueCards: Int
    let eveningHour: Int
    let quietEnd: String
  }

  struct Text: Decodable {
    let streak: String
    let watered: String
    let notYet: String
    let morning: String?
    let evening: String
    let restDay: String
    let stale: String
    let petLabel: String?
    let progress: String
    let progressNewDay: String
    let goalMet: String
    let review: String
    let reviewsWaiting: String
    let allCaughtUp: String
    let rescue: String
    let countdown: String
    let today: String
    let done: String
    let newDay: String
    let items: [String]
  }

  struct Images: Decodable {
    let plant: [String: String]
    let pet: String?
    let placeholder: String
  }

  struct Links: Decodable {
    let garden: String
    let rescue: String
    let pet: String
    let review: String
    let home: String
    let plan: String
    let items: [String]
  }

  let payloadVersion: Int
  let snapshot: Snapshot
  let goalMinutes: Int
  let text: Text
  let images: Images
  let links: Links
}

enum WidgetStore {
  static let payloadKey = "smriti.widget.payload"

  static func load() -> WidgetPayload? {
    guard
      let group = Bundle.main.object(forInfoDictionaryKey: "SmritiWidgetAppGroup") as? String,
      let json = UserDefaults(suiteName: group)?.string(forKey: payloadKey),
      let data = json.data(using: .utf8)
    else { return nil }
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase
    return try? decoder.decode(WidgetPayload.self, from: data)
  }
}

/// Seed-pack illustrations (Agnes, licence "owned") that the config plugin copies into the
/// extension's resources. No drawn art. Downscaled on load: widgets have a tight memory budget.
enum WidgetArt {
  static func image(_ name: String, maxPoints: CGFloat = 160) -> UIImage? {
    guard let url = Bundle.main.url(forResource: name, withExtension: "webp"),
          let image = UIImage(contentsOfFile: url.path) else { return nil }
    let scale = min(1, maxPoints * 3 / max(image.size.width, image.size.height))
    guard scale < 1 else { return image }
    let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
    return UIGraphicsImageRenderer(size: size).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
  }

  /// The image's alt text from illustrations.json, for VoiceOver.
  static func alt(_ name: String, locale: String) -> String {
    WidgetCatalog.alt[name]?[locale] ?? WidgetCatalog.alt[name]?["en"] ?? ""
  }
}

struct WidgetView {
  enum Line { case restDay, watered, evening, morning, notYet }

  let stale: Bool
  let newDay: Bool
  let health: String
  let plantImage: String
  let line: Line
  let lineText: String
  let lineLink: String
  let goalMet: Bool
  let progress: Double
  let progressText: String?
  let pillText: String
  let pillLink: String
  let planHeader: String
  let planRows: [(text: String, link: String)]
  let planDone: Bool
  let countdown: String?
}

enum WidgetRules {
  static let staleSeconds: TimeInterval = 72 * 3600
  static let healthOrder = ["thriving", "droopy", "dry", "wilted", "dormant"]

  static func calendar(_ tz: String) -> Calendar {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: tz) ?? .current
    return cal
  }

  static func localDay(_ date: Date, tz: String) -> String {
    let c = calendar(tz).dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
  }

  static func localMinutes(_ date: Date, tz: String) -> Int {
    let c = calendar(tz).dateComponents([.hour, .minute], from: date)
    return (c.hour ?? 0) * 60 + (c.minute ?? 0)
  }

  /// Whole days from `a` to `b` (both `yyyy-MM-dd`).
  static func daysBetween(_ a: String, _ b: String) -> Int {
    let f = DateFormatter()
    f.calendar = Calendar(identifier: .gregorian)
    f.timeZone = TimeZone(identifier: "UTC")
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd"
    guard let da = f.date(from: a), let db = f.date(from: b) else { return 0 }
    return Int((db.timeIntervalSince(da) / 86400).rounded())
  }

  static func parseInstant(_ iso: String) -> Date? {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
  }

  static func hhmm(_ value: String) -> Int {
    let parts = value.split(separator: ":").compactMap { Int($0) }
    return parts.count == 2 ? parts[0] * 60 + parts[1] : 0
  }

  static func rank(_ h: String) -> Int { healthOrder.firstIndex(of: h) ?? 0 }

  static func predictedHealth(_ s: WidgetPayload.Snapshot, today: String) -> String {
    guard let last = s.lastActivityDay, today > s.localDay else { return s.plant.health }
    let missed = max(0, daysBetween(last, today) - 1)
    var target = "thriving"
    for h in ["droopy", "dry", "wilted", "dormant"] {
      if let t = s.healthByMissedDays[h], missed >= t { target = h }
    }
    var health = rank(target) > rank(s.plant.health) ? target : s.plant.health
    if s.isUnder10 && rank(health) > rank("droopy") { health = "droopy" }
    return health
  }

  static func view(_ p: WidgetPayload, now: Date) -> WidgetView {
    let s = p.snapshot
    let today = localDay(now, tz: s.tz)
    let minutes = localMinutes(now, tz: s.tz)
    let written = parseInstant(s.writtenAt) ?? now
    let stale = now.timeIntervalSince(written) > staleSeconds
    let newDay = today > s.localDay
    let health = predictedHealth(s, today: today)
    let goalMet = !newDay && s.goalMetToday
    let restDay = !newDay && s.restDayToday

    let line: WidgetView.Line
    if restDay { line = .restDay }
    else if goalMet { line = .watered }
    else if minutes >= s.eveningHour * 60 { line = .evening }
    else if minutes >= hhmm(s.quietEnd) && minutes < 12 * 60 && p.text.morning != nil && !newDay { line = .morning }
    else { line = .notYet }

    let lineText: String
    if stale { lineText = p.text.stale }
    else {
      switch line {
      case .restDay: lineText = p.text.restDay
      case .watered: lineText = p.text.watered
      case .evening: lineText = p.text.evening
      case .morning: lineText = p.text.morning ?? p.text.notYet
      case .notYet: lineText = p.text.notYet
      }
    }
    let lineLink = (line == .evening && !s.isUnder10) ? p.links.rescue : p.links.garden

    let pill: (String, String)
    if stale { pill = (p.text.reviewsWaiting, p.links.review) }
    else if s.isUnder10 { pill = (p.text.review, p.links.review) }
    else if line == .evening { pill = (p.text.rescue, p.links.rescue) }
    else if s.dueCards > 0 && !newDay { pill = (p.text.review, p.links.review) }
    else { pill = (p.text.allCaughtUp, p.links.home) }

    let rows: [(text: String, link: String)] = (newDay || stale)
      ? []
      : p.text.items.enumerated().map { (i, t) in (t, i < p.links.items.count ? p.links.items[i] : p.links.plan) }

    return WidgetView(
      stale: stale,
      newDay: newDay,
      health: health,
      plantImage: p.images.plant[health] ?? p.images.placeholder,
      line: line,
      lineText: lineText,
      lineLink: lineLink,
      goalMet: goalMet,
      progress: newDay ? 0 : s.goalProgress,
      progressText: stale ? nil : (newDay ? p.text.progressNewDay : (goalMet ? p.text.goalMet : p.text.progress)),
      pillText: pill.0,
      pillLink: pill.1,
      planHeader: stale ? p.text.stale : (newDay ? p.text.newDay : p.text.today),
      planRows: rows,
      planDone: goalMet && !stale,
      countdown: stale ? nil : p.text.countdown
    )
  }

  /// Timeline entries (NTF-08): now, 12:00, the evening hour and the next midnight.
  static func timeline(_ p: WidgetPayload?, now: Date) -> [Date] {
    guard let p = p else { return [now] }
    let cal = calendar(p.snapshot.tz)
    let start = cal.startOfDay(for: now)
    let points = [12 * 60, p.snapshot.eveningHour * 60, 24 * 60].compactMap { cal.date(byAdding: .minute, value: $0, to: start) }
    return [now] + points.filter { $0 > now }
  }
}
