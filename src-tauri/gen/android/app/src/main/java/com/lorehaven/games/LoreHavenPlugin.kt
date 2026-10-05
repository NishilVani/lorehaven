package com.lorehaven.games

import android.app.Activity
import android.app.WallpaperManager
import android.content.Intent
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import androidx.activity.BackEventCompat
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

@InvokeArg
class WidgetArgs {
  var json: String = "{}"
}

@InvokeArg
class WallpaperArgs {
  var url: String = ""
  var target: String = "home"
}

@InvokeArg
class PinArgs {
  var kind: String = ""
}

@InvokeArg
class BarsArgs {
  var light: Boolean = false
}

@InvokeArg
class BackArgs {
  var enabled: Boolean = false
}

/**
 * The app's own Android features, reached from the web code through the
 * `native_call` app command (src-tauri/src/android_native.rs), which forwards
 * only the methods it names:
 *
 * - setWidgetData: what the home-screen widgets and the Quick Settings tile
 *   show (Widgets.kt). The web code owns the library, so it sends a small
 *   snapshot after every change; the widgets render it without the app.
 * - pinWidget / canPinWidgets: "Add to Home Screen" for each widget.
 * - setWallpaper: WallpaperManager. No permission prompt (SET_WALLPAPER is a
 *   normal permission).
 * - takeShared: text another app shared into LoreHaven, once.
 * - setBackIntercept / moveToBack: predictive back (see the callback below).
 * - setSystemBars: dark or light status and navigation bar icons, to match
 *   the page's theme (most are dark, a few are light).
 */
@TauriPlugin
class LoreHavenPlugin(private val activity: Activity) : Plugin(activity) {
  private var webView: WebView? = null
  private val main = Handler(Looper.getMainLooper())
  private var pendingShare: String? = null
  private var tauriBackDisabled = false

  /* Predictive back. Android plays its back-to-home preview only when no
     callback is enabled, so this one is enabled only while the page has
     something to go back from: an open menu, dialog or search, or history.
     The page says which through setBackIntercept, and gets the gesture as
     `lh:back` events -- progress for the peek, then commit or cancel. */
  private val backCallback = object : OnBackPressedCallback(false) {
    override fun handleOnBackStarted(backEvent: BackEventCompat) = send("start", backEvent.progress, backEvent.swipeEdge)
    override fun handleOnBackProgressed(backEvent: BackEventCompat) = send("progress", backEvent.progress, backEvent.swipeEdge)
    override fun handleOnBackCancelled() = send("cancel", 0f, 0)
    override fun handleOnBackPressed() = send("commit", 1f, 0)
  }

  init {
    (activity as? AppCompatActivity)?.onBackPressedDispatcher?.addCallback(activity, backCallback)
  }

  override fun load(webView: WebView) {
    this.webView = webView
    readShare(activity.intent)
  }

  override fun onNewIntent(intent: Intent) {
    readShare(intent)
  }

  private fun readShare(intent: Intent?) {
    if (intent?.action != Intent.ACTION_SEND || intent.type?.startsWith("text/") != true) return
    val text = listOfNotNull(
      intent.getStringExtra(Intent.EXTRA_SUBJECT),
      intent.getStringExtra(Intent.EXTRA_TEXT),
    ).joinToString("\n").trim()
    /* Consumed here, so a configuration change that recreates the activity
       from the same intent does not share it a second time. */
    intent.removeExtra(Intent.EXTRA_TEXT)
    intent.removeExtra(Intent.EXTRA_SUBJECT)
    if (text.isNotEmpty()) pendingShare = text.take(2000)
  }

  private fun send(phase: String, progress: Float, edge: Int) {
    val p = progress.coerceIn(0f, 1f)
    main.post {
      webView?.evaluateJavascript(
        "window.dispatchEvent(new CustomEvent('lh:back',{detail:{phase:'$phase',progress:$p,edge:$edge}}))",
        null,
      )
    }
  }

  /* Tauri's own back callback (AppPlugin) is always enabled, which would hide
     the system's back-to-home preview. Turned off only once a page that speaks
     setBackIntercept has loaded, so an older web bundle keeps the old
     behaviour. Reflection, because AppPlugin keeps no handle to it; if the
     field is ever renamed this does nothing and back still works. */
  private fun disableTauriBack() {
    if (tauriBackDisabled) return
    tauriBackDisabled = true
    try {
      val dispatcher = (activity as AppCompatActivity).onBackPressedDispatcher
      val field = dispatcher.javaClass.getDeclaredField("onBackPressedCallbacks")
      field.isAccessible = true
      for (cb in field.get(dispatcher) as Iterable<*>) {
        if (cb is OnBackPressedCallback && cb !== backCallback && cb.javaClass.name.startsWith("app.tauri.AppPlugin")) {
          cb.isEnabled = false
        }
      }
    } catch (_: Throwable) {
      /* Back still works through AppPlugin; only the home preview is lost. */
    }
  }

  @Command
  fun setBackIntercept(invoke: Invoke) {
    val args = invoke.parseArgs(BackArgs::class.java)
    main.post {
      disableTauriBack()
      backCallback.isEnabled = args.enabled
      invoke.resolve()
    }
  }

  @Command
  fun setSystemBars(invoke: Invoke) {
    val args = invoke.parseArgs(BarsArgs::class.java)
    main.post {
      val bars = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
      bars.isAppearanceLightStatusBars = args.light
      bars.isAppearanceLightNavigationBars = args.light
      invoke.resolve()
    }
  }

  @Command
  fun moveToBack(invoke: Invoke) {
    main.post {
      activity.moveTaskToBack(true)
      invoke.resolve()
    }
  }

  @Command
  fun takeShared(invoke: Invoke) {
    val text = pendingShare
    pendingShare = null
    invoke.resolve(JSObject().apply { put("text", text) })
  }

  @Command
  fun setWidgetData(invoke: Invoke) {
    val args = invoke.parseArgs(WidgetArgs::class.java)
    val context = activity.applicationContext
    thread(name = "lorehaven-widgets") {
      try {
        Widgets.save(context, args.json)
        invoke.resolve()
      } catch (e: Exception) {
        invoke.reject("Widget data not saved: ${e.message}")
      }
    }
  }

  @Command
  fun canPinWidgets(invoke: Invoke) {
    invoke.resolve(JSObject().apply { put("supported", Widgets.canPin(activity)) })
  }

  @Command
  fun pinWidget(invoke: Invoke) {
    val args = invoke.parseArgs(PinArgs::class.java)
    invoke.resolve(JSObject().apply { put("requested", Widgets.pin(activity, args.kind)) })
  }

  @Command
  fun setWallpaper(invoke: Invoke) {
    val args = invoke.parseArgs(WallpaperArgs::class.java)
    /* IGDB's image host only. The page sends a URL it built itself, but the
       command should not fetch arbitrary addresses on anyone's say-so. */
    if (!args.url.startsWith("https://images.igdb.com/")) {
      invoke.reject("Not an IGDB image")
      return
    }
    val which = when (args.target) {
      "lock" -> WallpaperManager.FLAG_LOCK
      "both" -> WallpaperManager.FLAG_SYSTEM or WallpaperManager.FLAG_LOCK
      else -> WallpaperManager.FLAG_SYSTEM
    }
    val context = activity.applicationContext
    thread(name = "lorehaven-wallpaper") {
      try {
        val conn = URL(args.url).openConnection() as HttpURLConnection
        conn.connectTimeout = 15_000
        conn.readTimeout = 30_000
        val bitmap = conn.inputStream.use { BitmapFactory.decodeStream(it) }
          ?: throw IllegalStateException("The image could not be read")
        val manager = WallpaperManager.getInstance(context)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
          manager.setBitmap(bitmap, null, true, which)
        } else {
          manager.setBitmap(bitmap)
        }
        invoke.resolve()
      } catch (e: Exception) {
        invoke.reject("Wallpaper not set: ${e.message}")
      }
    }
  }
}
