package com.lorehaven.games

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * Quick Settings tile: Pick For Me. One tap opens the library's Pick For Me
 * dialog (lorehaven://shortcut/pick, the same link as the launcher shortcut).
 * The subtitle names the game at the top of Up Next, from the widget snapshot,
 * so the tile says something useful before it is tapped.
 */
class PickTileService : TileService() {
  override fun onStartListening() {
    val tile = qsTile ?: return
    tile.state = Tile.STATE_INACTIVE
    tile.label = getString(R.string.tile_pick_label)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val next = Widgets.read(this).optJSONArray("upNext")?.optJSONObject(0)?.optString("name")
      tile.subtitle = if (next.isNullOrBlank()) getString(R.string.tile_pick_subtitle) else next
    }
    tile.updateTile()
  }

  @SuppressLint("StartActivityAndCollapseDeprecated")
  override fun onClick() {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("lorehaven://shortcut/pick"), this, MainActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startActivityAndCollapse(
        PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE),
      )
    } else {
      @Suppress("DEPRECATION")
      startActivityAndCollapse(intent)
    }
  }
}
