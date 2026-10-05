package com.lorehaven.games

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
}
