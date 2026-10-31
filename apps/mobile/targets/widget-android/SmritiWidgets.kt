package app.smriti.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.math.max
import kotlin.math.roundToInt
import __NAMESPACE__.R

// The Android app widgets added by apps/mobile/plugins/widgets at prebuild (me-money NTF-08 small
// plant, NTF-09 medium pet and today, NTF-10 large plan). The app writes the payload
// (apps/mobile/src/platform/widget.ts) to SharedPreferences through the SmritiWidget module; the
// rules below are a port of `widgetView` there. Every visible string comes prepared in the payload
// except the placeholder (generated string resources). Images are the seed-pack illustrations.
// java.time is avoided: minSdk is 24.

class WidgetPayload(json: JSONObject) {
  class Snapshot(o: JSONObject) {
    val writtenAt: String = o.getString("written_at")
    val localDay: String = o.getString("local_day")
    val tz: String = o.getString("tz")
    val locale: String = o.optString("locale", "en")
    val isUnder10: Boolean = o.optBoolean("is_under10", false)
    val goalMetToday: Boolean = o.optBoolean("goal_met_today", false)
    val goalProgress: Double = o.optDouble("goal_progress", 0.0)
    val restDayToday: Boolean = o.optBoolean("rest_day_today", false)
    val lastActivityDay: String? = if (o.isNull("last_activity_day")) null else o.optString("last_activity_day")
    val plantHealth: String = o.getJSONObject("plant").getString("health")
    val healthByMissedDays: Map<String, Int> = o.getJSONObject("health_by_missed_days").let { h ->
      h.keys().asSequence().associateWith { h.getInt(it) }
    }
    val dueCards: Int = o.optInt("due_cards", 0)
    val eveningHour: Int = o.optInt("evening_hour", 19)
    val quietEnd: String = o.optString("quiet_end", "07:00")
  }

  val snapshot = Snapshot(json.getJSONObject("snapshot"))
  private val text: JSONObject = json.getJSONObject("text")
  private val images: JSONObject = json.getJSONObject("images")
  private val links: JSONObject = json.getJSONObject("links")

  fun text(key: String): String = text.optString(key, "")
  fun textOrNull(key: String): String? = if (text.isNull(key)) null else text.optString(key)
  fun link(key: String): String = links.optString(key, "")
  val items: List<String> = text.optJSONArray("items").strings()
  val itemLinks: List<String> = links.optJSONArray("items").strings()
  val placeholderImage: String = images.optString("placeholder", "plant-seed")
  val petImage: String? = if (images.isNull("pet")) null else images.optString("pet")
  fun plantImage(health: String): String = images.getJSONObject("plant").optString(health, placeholderImage)

  companion object {
    private fun JSONArray?.strings(): List<String> =
      if (this == null) emptyList() else (0 until length()).map { getString(it) }
  }
}

data class WidgetRow(val text: String, val link: String)

data class WidgetView(
  val stale: Boolean,
  val newDay: Boolean,
  val health: String,
  val plantImage: String,
  val line: String,
  val lineText: String,
  val lineLink: String,
  val goalMet: Boolean,
  val progress: Double,
  val progressText: String?,
  val pillText: String,
  val pillLink: String,
  val planHeader: String,
  val planRows: List<WidgetRow>,
  val planDone: Boolean,
  val countdown: String?,
)

object WidgetStore {
  const val PREFS = "smriti_widget"
  const val KEY = "payload"

  fun load(context: Context): WidgetPayload? {
    val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return null
    return try {
      WidgetPayload(JSONObject(raw))
    } catch (e: Exception) {
      null
    }
  }
}

object WidgetRules {
  const val STALE_MS = 72L * 3600 * 1000
  private val HEALTH = listOf("thriving", "droopy", "dry", "wilted", "dormant")

  private fun rank(h: String) = max(0, HEALTH.indexOf(h))

  fun localDay(ms: Long, tz: String): String {
    val f = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    f.timeZone = TimeZone.getTimeZone(tz)
    return f.format(Date(ms))
  }

  fun localMinutes(ms: Long, tz: String): Int {
    val c = Calendar.getInstance(TimeZone.getTimeZone(tz))
    c.timeInMillis = ms
    return c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE)
  }

  fun daysBetween(a: String, b: String): Int {
    val f = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    f.timeZone = TimeZone.getTimeZone("UTC")
    val da = f.parse(a) ?: return 0
    val db = f.parse(b) ?: return 0
    return ((db.time - da.time) / 86_400_000.0).roundToInt()
  }

  fun parseInstant(iso: String): Long? {
    for (pattern in listOf("yyyy-MM-dd'T'HH:mm:ss.SSSX", "yyyy-MM-dd'T'HH:mm:ssX")) {
      try {
        val f = SimpleDateFormat(pattern, Locale.US)
        f.timeZone = TimeZone.getTimeZone("UTC")
        return f.parse(iso)?.time
      } catch (e: Exception) {
        // try the next pattern
      }
    }
    return null
  }

  fun hhmm(value: String): Int {
    val parts = value.split(":").mapNotNull { it.toIntOrNull() }
    return if (parts.size == 2) parts[0] * 60 + parts[1] else 0
  }

  fun predictedHealth(s: WidgetPayload.Snapshot, today: String): String {
    val last = s.lastActivityDay ?: return s.plantHealth
    if (today <= s.localDay) return s.plantHealth
    val missed = max(0, daysBetween(last, today) - 1)
    var target = "thriving"
    for (h in listOf("droopy", "dry", "wilted", "dormant")) {
      val t = s.healthByMissedDays[h]
      if (t != null && missed >= t) target = h
    }
    var health = if (rank(target) > rank(s.plantHealth)) target else s.plantHealth
    // Under-10s: the plant stops at droopy (learn §5.6).
    if (s.isUnder10 && rank(health) > rank("droopy")) health = "droopy"
    return health
  }

  fun view(p: WidgetPayload, nowMs: Long): WidgetView {
    val s = p.snapshot
    val today = localDay(nowMs, s.tz)
    val minutes = localMinutes(nowMs, s.tz)
    val written = parseInstant(s.writtenAt) ?: nowMs
    val stale = nowMs - written > STALE_MS
    val newDay = today > s.localDay
    val health = predictedHealth(s, today)
    val goalMet = !newDay && s.goalMetToday
    val restDay = !newDay && s.restDayToday
    val morning = p.textOrNull("morning")

    val line = when {
      restDay -> "rest_day"
      goalMet -> "watered"
      minutes >= s.eveningHour * 60 -> "evening"
      minutes >= hhmm(s.quietEnd) && minutes < 12 * 60 && morning != null && !newDay -> "morning"
      else -> "not_yet"
    }
    val lineText = if (stale) p.text("stale") else if (line == "morning") morning ?: p.text("not_yet") else p.text(line)
    val lineLink = if (line == "evening" && !s.isUnder10) p.link("rescue") else p.link("garden")

    val pill = when {
      stale -> p.text("reviews_waiting") to p.link("review")
      s.isUnder10 -> p.text("review") to p.link("review")
      line == "evening" -> p.text("rescue") to p.link("rescue")
      s.dueCards > 0 && !newDay -> p.text("review") to p.link("review")
      else -> p.text("all_caught_up") to p.link("home")
    }
    val rows = if (newDay || stale) emptyList() else p.items.mapIndexed { i, t -> WidgetRow(t, p.itemLinks.getOrNull(i) ?: p.link("plan")) }

    return WidgetView(
      stale = stale,
      newDay = newDay,
      health = health,
      plantImage = p.plantImage(health),
      line = line,
      lineText = lineText,
      lineLink = lineLink,
      goalMet = goalMet,
      progress = if (newDay) 0.0 else s.goalProgress,
      progressText = if (stale) null else if (newDay) p.text("progress_new_day") else if (goalMet) p.text("goal_met") else p.text("progress"),
      pillText = pill.first,
      pillLink = pill.second,
      planHeader = if (stale) p.text("stale") else if (newDay) p.text("new_day") else p.text("today"),
      planRows = rows,
      planDone = goalMet && !stale,
      countdown = if (stale) null else p.text("countdown"),
    )
  }
}

/** Shared drawing for the three sizes; each subclass fills its own layout. */
abstract class SmritiWidgetProvider : AppWidgetProvider() {
  abstract val layout: Int

  abstract fun bind(context: Context, views: RemoteViews, id: Int, p: WidgetPayload, v: WidgetView)

  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    val payload = WidgetStore.load(context)
    val now = System.currentTimeMillis()
    for (id in ids) manager.updateAppWidget(id, render(context, id, payload, now))
  }

  private fun render(context: Context, id: Int, payload: WidgetPayload?, now: Long): RemoteViews {
    val views = RemoteViews(context.packageName, layout)
    if (payload == null) {
      views.setViewVisibility(R.id.smriti_widget_content, View.GONE)
      views.setViewVisibility(R.id.smriti_widget_placeholder, View.VISIBLE)
      setArt(context, views, R.id.smriti_widget_placeholder_image, "plant-seed", null)
      context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { launch ->
        val pending = PendingIntent.getActivity(context, id * 16, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        views.setOnClickPendingIntent(R.id.smriti_widget_root, pending)
      }
      return views
    }
    views.setViewVisibility(R.id.smriti_widget_placeholder, View.GONE)
    views.setViewVisibility(R.id.smriti_widget_content, View.VISIBLE)
    val v = WidgetRules.view(payload, now)
    bindPlant(context, views, id, payload, v)
    bind(context, views, id, payload, v)
    return views
  }

  private fun bindPlant(context: Context, views: RemoteViews, id: Int, p: WidgetPayload, v: WidgetView) {
    setArt(context, views, R.id.smriti_widget_plant_image, v.plantImage, p.snapshot.locale)
    views.setTextViewText(R.id.smriti_widget_streak, p.text("streak"))
    views.setTextViewText(R.id.smriti_widget_line, v.lineText)
    views.setOnClickPendingIntent(R.id.smriti_widget_root, open(context, v.lineLink, id * 16 + 1))
  }

  protected fun setArt(context: Context, views: RemoteViews, viewId: Int, name: String, locale: String?) {
    val res = context.resources.getIdentifier("smriti_widget_" + name.replace('-', '_'), "drawable", context.packageName)
    if (res == 0) {
      views.setViewVisibility(viewId, View.INVISIBLE)
      return
    }
    views.setViewVisibility(viewId, View.VISIBLE)
    views.setImageViewResource(viewId, res)
    val alt = WidgetCatalog.alt[name]
    views.setContentDescription(viewId, alt?.get(locale ?: deviceLocale(context)) ?: alt?.get("en") ?: "")
  }

  protected fun open(context: Context, link: String, requestCode: Int): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(link))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun deviceLocale(context: Context): String {
    val lang = context.resources.configuration.locales[0]?.language ?: "en"
    return if (lang == "hi") "hi" else "en"
  }
}

/** NTF-08: the plant, the streak and one line. */
class SmritiPlantWidgetProvider : SmritiWidgetProvider() {
  override val layout = R.layout.smriti_widget_plant

  override fun bind(context: Context, views: RemoteViews, id: Int, p: WidgetPayload, v: WidgetView) = Unit
}

/** NTF-09: the plant, the pet, today's progress and one action. */
class SmritiTodayWidgetProvider : SmritiWidgetProvider() {
  override val layout = R.layout.smriti_widget_today

  override fun bind(context: Context, views: RemoteViews, id: Int, p: WidgetPayload, v: WidgetView) {
    val pet = p.petImage
    if (pet == null) {
      views.setViewVisibility(R.id.smriti_widget_pet, View.GONE)
    } else {
      views.setViewVisibility(R.id.smriti_widget_pet, View.VISIBLE)
      setArt(context, views, R.id.smriti_widget_pet_image, pet, p.snapshot.locale)
      views.setTextViewText(R.id.smriti_widget_pet_label, p.textOrNull("pet_label") ?: "")
      views.setOnClickPendingIntent(R.id.smriti_widget_pet, open(context, p.link("pet"), id * 16 + 2))
    }
    bindProgress(views, v)
    views.setTextViewText(R.id.smriti_widget_pill, v.pillText)
    views.setOnClickPendingIntent(R.id.smriti_widget_pill, open(context, v.pillLink, id * 16 + 3))
  }
}

/** NTF-10: countdown, today's plan (up to three rows) and one action. */
class SmritiPlanWidgetProvider : SmritiWidgetProvider() {
  override val layout = R.layout.smriti_widget_plan

  override fun bind(context: Context, views: RemoteViews, id: Int, p: WidgetPayload, v: WidgetView) {
    views.setViewVisibility(R.id.smriti_widget_countdown, if (v.countdown == null) View.GONE else View.VISIBLE)
    views.setTextViewText(R.id.smriti_widget_countdown, v.countdown ?: "")
    bindProgress(views, v)
    views.setTextViewText(R.id.smriti_widget_plan_header, v.planHeader)
    views.setViewVisibility(R.id.smriti_widget_plan_done, if (v.planDone) View.VISIBLE else View.GONE)
    views.setTextViewText(R.id.smriti_widget_plan_done, p.text("done"))
    val rowIds = intArrayOf(R.id.smriti_widget_row_1, R.id.smriti_widget_row_2, R.id.smriti_widget_row_3)
    rowIds.forEachIndexed { i, rowId ->
      val row = v.planRows.getOrNull(i)
      if (row == null) {
        views.setViewVisibility(rowId, View.GONE)
      } else {
        views.setViewVisibility(rowId, View.VISIBLE)
        views.setTextViewText(rowId, row.text)
        views.setOnClickPendingIntent(rowId, open(context, row.link, id * 16 + 4 + i))
      }
    }
    views.setTextViewText(R.id.smriti_widget_pill, v.pillText)
    views.setOnClickPendingIntent(R.id.smriti_widget_pill, open(context, v.pillLink, id * 16 + 8))
  }
}

private fun bindProgress(views: RemoteViews, v: WidgetView) {
  val text = v.progressText
  if (text == null) {
    views.setViewVisibility(R.id.smriti_widget_progress_text, View.GONE)
    views.setViewVisibility(R.id.smriti_widget_progress_bar, View.GONE)
    return
  }
  views.setViewVisibility(R.id.smriti_widget_progress_text, View.VISIBLE)
  views.setViewVisibility(R.id.smriti_widget_progress_bar, View.VISIBLE)
  views.setTextViewText(R.id.smriti_widget_progress_text, text)
  views.setProgressBar(R.id.smriti_widget_progress_bar, 100, (v.progress.coerceIn(0.0, 1.0) * 100).roundToInt(), false)
}
