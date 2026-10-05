package com.lorehaven.games

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.service.quicksettings.TileService
import android.view.View
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

/**
 * Home-screen widgets: Now Playing, Up Next and Releasing Soon.
 *
 * The web code owns the library, so it sends a snapshot after every change
 * (services/native/widgets.js builds it) and this file renders it with plain
 * RemoteViews, which every launcher back to Android 7 understands. Shape:
 *
 *   { "playing": [row], "upNext": [row], "soon": [row] }
 *   row = { "id": 1942, "name": "...", "line": "...", "cover": "co1wyy",
 *           "release": 1767225600 }   // release: Releasing Soon only
 *
 * Releasing Soon works its countdown out here, at render time, so "In 3 days"
 * stays right on days the app is not opened. Covers are IGDB's 90x128 cover
 * size, fetched once into the app's files and reused.
 */
object Widgets {
  private const val PREFS = "lorehaven_native"
  private const val KEY = "widgets"
  private const val ROWS = 3

  /* optString turns a JSON null into the four letters "null", which passed
     the cover-id check and was fetched as null.jpg. */
  private fun JSONObject.text(key: String): String = if (isNull(key)) "" else optString(key)

  /** Asks the launcher to add one of the widgets (Android 8+, and only where
      the launcher supports it). Android shows its own confirmation. */
  fun pin(context: Context, key: String): Boolean {
    val kind = Kind.values().firstOrNull { it.key == key } ?: return false
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
    val manager = AppWidgetManager.getInstance(context)
    if (!manager.isRequestPinAppWidgetSupported) return false
    return manager.requestPinAppWidget(ComponentName(context, kind.provider), null, null)
  }

  fun canPin(context: Context): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && AppWidgetManager.getInstance(context).isRequestPinAppWidgetSupported

  fun save(context: Context, json: String) {
    val data = JSONObject(json)
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, data.toString()).apply()
    fetchCovers(context, data)
    refreshAll(context)
  }

  fun read(context: Context): JSONObject = try {
    JSONObject(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: "{}")
  } catch (_: Exception) {
    JSONObject()
  }

  fun refreshAll(context: Context) {
    val manager = AppWidgetManager.getInstance(context)
    for (kind in Kind.values()) {
      val ids = manager.getAppWidgetIds(ComponentName(context, kind.provider))
      for (id in ids) manager.updateAppWidget(id, render(context, kind, id))
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      TileService.requestListeningState(context, ComponentName(context, PickTileService::class.java))
    }
  }

  private fun coverFile(context: Context, cover: String) = File(File(context.filesDir, "widget-covers"), "$cover.jpg")

  private fun fetchCovers(context: Context, data: JSONObject) {
    val dir = File(context.filesDir, "widget-covers").apply { mkdirs() }
    val wanted = mutableSetOf<String>()
    for (kind in Kind.values()) {
      val rows = data.optJSONArray(kind.key) ?: continue
      for (i in 0 until minOf(rows.length(), ROWS)) {
        val cover = rows.optJSONObject(i)?.text("cover").orEmpty()
        if (cover.matches(Regex("^[a-z0-9]{1,40}$"))) wanted.add(cover)
      }
    }
    for (cover in wanted) {
      val file = coverFile(context, cover)
      if (file.exists()) continue
      try {
        val conn = URL("https://images.igdb.com/igdb/image/upload/t_cover_small/$cover.jpg").openConnection() as HttpURLConnection
        conn.connectTimeout = 10_000
        conn.readTimeout = 15_000
        conn.inputStream.use { input -> file.outputStream().use { input.copyTo(it) } }
      } catch (_: Exception) {
        file.delete()
      }
    }
    /* Keep the folder to what the widgets show now. */
    dir.listFiles()?.forEach { if (it.nameWithoutExtension !in wanted) it.delete() }
  }

  /** Opens one of the app's own lorehaven:// links (services/native/links.js). */
  private fun open(context: Context, link: String, request: Int): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(link), context, MainActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(context, request, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun countdown(release: Long): String? {
    if (release <= 0) return null
    val now = System.currentTimeMillis()
    /* Release dates are calendar days in UTC, as IGDB stores them. */
    val days = TimeUnit.MILLISECONDS.toDays(release * 1000 - (now - now % 86_400_000L))
    return when {
      days < 0 -> "Out now"
      days == 0L -> "Out today"
      days == 1L -> "Out tomorrow"
      else -> "In $days days"
    }
  }

  fun render(context: Context, kind: Kind, widgetId: Int): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.widget_shelf)
    val rows: JSONArray = read(context).optJSONArray(kind.key) ?: JSONArray()
    views.setTextViewText(R.id.widget_title, context.getString(kind.title))
    views.setOnClickPendingIntent(R.id.widget_header, open(context, kind.headerLink, widgetId * 10))

    val rowIds = intArrayOf(R.id.row1, R.id.row2, R.id.row3)
    val coverIds = intArrayOf(R.id.cover1, R.id.cover2, R.id.cover3)
    val nameIds = intArrayOf(R.id.name1, R.id.name2, R.id.name3)
    val lineIds = intArrayOf(R.id.line1, R.id.line2, R.id.line3)
    val shown = minOf(rows.length(), ROWS)
    for (i in 0 until ROWS) {
      val row = if (i < shown) rows.optJSONObject(i) else null
      val id = row?.optLong("id") ?: 0L
      if (row == null || id <= 0) {
        views.setViewVisibility(rowIds[i], View.GONE)
        continue
      }
      views.setViewVisibility(rowIds[i], View.VISIBLE)
      views.setTextViewText(nameIds[i], row.text("name"))
      val line = countdown(row.optLong("release")) ?: row.text("line")
      views.setTextViewText(lineIds[i], line)
      views.setViewVisibility(lineIds[i], if (line.isNullOrBlank()) View.GONE else View.VISIBLE)
      val cover = row.text("cover")
      val file = if (cover.isNotEmpty()) coverFile(context, cover) else null
      val bitmap = if (file?.exists() == true) BitmapFactory.decodeFile(file.path) else null
      if (bitmap != null) views.setImageViewBitmap(coverIds[i], bitmap)
      else views.setImageViewResource(coverIds[i], R.drawable.widget_cover_blank)
      views.setOnClickPendingIntent(rowIds[i], open(context, "lorehaven://game/$id", widgetId * 10 + i + 1))
    }
    views.setViewVisibility(R.id.widget_empty, if (shown == 0) View.VISIBLE else View.GONE)
    views.setTextViewText(R.id.widget_empty, context.getString(kind.empty))
    return views
  }

  enum class Kind(
    val key: String,
    val provider: Class<out AppWidgetProvider>,
    val title: Int,
    val empty: Int,
    val headerLink: String,
  ) {
    PLAYING("playing", NowPlayingWidget::class.java, R.string.widget_playing_title, R.string.widget_playing_empty, "lorehaven://shortcut/playing"),
    UP_NEXT("upNext", UpNextWidget::class.java, R.string.widget_upnext_title, R.string.widget_upnext_empty, "lorehaven://shortcut/backlog"),
    SOON("soon", ReleasingSoonWidget::class.java, R.string.widget_soon_title, R.string.widget_soon_empty, "lorehaven://shortcut/schedule"),
  }
}

abstract class ShelfWidget(private val kind: Widgets.Kind) : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) manager.updateAppWidget(id, Widgets.render(context, kind, id))
  }
}

class NowPlayingWidget : ShelfWidget(Widgets.Kind.PLAYING)
class UpNextWidget : ShelfWidget(Widgets.Kind.UP_NEXT)
class ReleasingSoonWidget : ShelfWidget(Widgets.Kind.SOON)
