package com.lorehaven.games

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    /* The app is dark in every theme, so the bars always get light icons.
       The default (SystemBarStyle.auto) follows the phone's light or dark mode,
       and on a phone in light mode drew dark icons on the black page: the
       clock and battery were invisible. */
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
    )
    super.onCreate(savedInstanceState)
  }

  /* Adopt the new intent before the plugins see it. After Android has ended
     the process but kept the task, a notification tap or a share recreates
     this activity from the task's original launcher intent and hands the new
     one over here, before any plugin has loaded: it reached nobody, so the
     tap opened Explore instead of its game. Plugins that load afterwards read
     activity.intent, which is now the one that was tapped. */
  override fun onNewIntent(intent: Intent) {
    setIntent(intent)
    super.onNewIntent(intent)
  }
}
