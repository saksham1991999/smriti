package app.smriti.widgetbridge

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Saves the widget payload (apps/mobile/src/platform/widget.ts) to SharedPreferences, where the
 * app widgets added by the config plugin (apps/mobile/targets/widget-android) read it, and asks
 * every widget of this app to redraw.
 */
class SmritiWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SmritiWidget")

    AsyncFunction("setPayload") { json: String ->
      val context = appContext.reactContext ?: return@AsyncFunction
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply()
      refresh(context)
    }

    AsyncFunction("clear") {
      val context = appContext.reactContext ?: return@AsyncFunction
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY).apply()
      refresh(context)
    }
  }

  companion object {
    const val PREFS = "smriti_widget"
    const val KEY = "payload"

    fun refresh(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      for (info in manager.installedProviders) {
        if (info.provider.packageName != context.packageName) continue
        val ids = manager.getAppWidgetIds(info.provider)
        if (ids.isEmpty()) continue
        val intent = Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
          .setComponent(info.provider)
          .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
        context.sendBroadcast(intent)
      }
    }
  }
}
