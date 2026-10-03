/* Saving a remote image to the device, on every host the app runs in.
   Moved out of Wallpapers so the game page media viewer saves the same way. */
import { openExternal } from './openExternal';

/* Filenames keep the game's actual name. The old rule was
   `replace(/[^a-zA-Z0-9]/g, '_')`, which is not a sanitiser — it is an ASCII
   filter. Every non-Latin title came out as underscores: ペルソナ5 saved as
   "_____", Sid Meier's Civilisation VI as "Sid_Meier_s_Civilization_VI". Strip
   only what a filesystem actually refuses, keep every letter in every script.
   NFC first so composed and decomposed accents produce the same file. */
export function safeFilename(name) {
  const cleaned = Array.from(String(name || '').normalize('NFC'))
    // Control characters, by code point rather than a regex class — the class
    // form is exactly what no-control-regex exists to catch.
    .filter((ch) => { const c = ch.codePointAt(0); return c > 0x1f && c !== 0x7f; })
    .join('')
    // Windows reserves these outright.
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    // Trailing dots and spaces are silently dropped by Windows, so drop them here.
    .replace(/[. ]+$/, '')
    .slice(0, 80);
  return cleaned || 'wallpaper';
}

const isTauri = () => !!window.__TAURI_INTERNALS__;
const isAndroid = () => /android/i.test(navigator.userAgent);

/** The album plates land in, under the device's shared Pictures directory. */
const GALLERY_ALBUM = 'LoreHaven';

/**
 * Writes bytes into the phone's shared picture library — the `Pictures` a file
 * manager shows and a gallery indexes — and returns once the file is visible.
 *
 * This cannot be done with @tauri-apps/plugin-fs. Every `BaseDirectory` that
 * plugin exposes on Android resolves through `getExternalFilesDir()`, so
 * `BaseDirectory.Picture` is not `/storage/emulated/0/Pictures` but
 * `/storage/emulated/0/Android/data/com.lorehaven.games/files/Pictures` —
 * app-private, hidden from the gallery, and unreachable in most file managers.
 * The write succeeds and the file is, for practical purposes, gone.
 *
 * Shared storage on Android 10+ is MediaStore, a database rather than a
 * directory you may open, so it needs the Android-specific plugin.
 */
async function saveToAndroidGallery(bytes, filename) {
  const afs = await import('tauri-plugin-android-fs-api');
  let uri;
  try {
    /* Created pending, so the gallery cannot index a half-written file; the
       relative path creates the album directory if it is not there yet, and a
       duplicate name gets a sequence number rather than overwriting. */
    uri = await afs.createNewPublicImageFile(
      afs.PublicImageDir.Pictures,
      `${GALLERY_ALBUM}/${filename}`,
      'image/jpeg',
      { isPending: true },
    );
    await afs.writeFile(uri, bytes);
    await afs.setPublicFilePending(uri, false);
    await afs.scanPublicFile(uri);
  } catch (err) {
    /* A pending row with no bytes behind it would sit in the library forever
       as a broken thumbnail. */
    if (uri != null) await afs.removeFile(uri).catch(() => {});
    throw err;
  }
  /* Logged rather than shown: report where the file actually landed, so a
     device test produces evidence instead of an echo of this code's intent. */
  let resolved = `Pictures/${GALLERY_ALBUM}`;
  try { resolved = afs.getFsPath(uri) || resolved; } catch { /* a nicety */ }
  console.info('[wallpapers] saved', filename, 'to', resolved);
}

/**
 * → { outcome: 'saved' | 'handoff' | 'failed', where? }. `where` names the
 * directory a save landed in, so the toast can say it out loud — on a phone
 * "downloaded" is useless if you cannot find the file afterwards.
 *
 * The anchor-download trick is a BROWSER feature. Android's WebView implements
 * no download manager unless the host app registers a DownloadListener, and
 * Tauri does not, so `link.download` + `click()` is a no-op there — and, because
 * a no-op throws nothing, this function used to return 'saved' and the UI
 * cheerfully reported "Wallpaper downloaded" while nothing had been written.
 * A silent failure is bad; one that claims success is worse.
 *
 * The fetch itself is fine on Android: images.igdb.com answers with
 * `Access-Control-Allow-Origin: *`, verified. It is only the save that has no
 * implementation, so under Tauri the whole blob path is skipped rather than
 * performed and thrown away.
 *
 * Three destinations, one per host: the shared picture library on Android (see
 * `saveToAndroidGallery`), the user's Pictures or Downloads directory on
 * desktop, and the browser's own download path on the web.
 */
export async function downloadUrlAsFile(url, filename) {
  if (isTauri()) {
    /* Fetch through the Tauri HTTP client, not the webview's. The capability
       already allows images.igdb.com, and a native request sidesteps whatever
       the webview would do with the response. */
    try {
      const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
      const res = await tauriFetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());

      /* Android keeps shared storage in MediaStore, which the file-system
         plugin cannot reach at all. Note there is no plugin-fs fallback here:
         it would "succeed" into app-private storage, which is exactly the
         silent non-delivery this branch exists to avoid. A handoff is honest;
         a file the user cannot find is not. */
      if (isAndroid()) {
        await saveToAndroidGallery(bytes, filename);
        return { outcome: 'saved', where: `Pictures/${GALLERY_ALBUM}` };
      }

      /* Desktop. Pictures first, Downloads second: a wallpaper is a picture,
         and the picture directory is the one an image browser looks at.
         Downloads is the fallback because it is what the button is named
         after. */
      const [fs, path] = await Promise.all([
        import('@tauri-apps/plugin-fs'),
        import('@tauri-apps/api/path'),
      ]);
      const targets = [
        { baseDir: fs.BaseDirectory.Picture, resolve: path.pictureDir, label: 'Pictures' },
        { baseDir: fs.BaseDirectory.Download, resolve: path.downloadDir, label: 'Downloads' },
      ];
      for (const t of targets) {
        try {
          await fs.writeFile(filename, bytes, { baseDir: t.baseDir });
          let dir = t.label;
          try { dir = await t.resolve(); } catch { /* naming it is a nicety */ }
          console.info('[wallpapers] saved', filename, 'to', dir);
          return { outcome: 'saved', where: t.label };
        } catch (err) {
          console.warn(`[wallpapers] could not write to ${t.label}:`, err);
        }
      }
      throw new Error('no writable directory');
    } catch (err) {
      /* The handoff stays as the floor. If the file system refuses — a
         permission this build does not carry, a directory Android will not give
         us — opening the plate in the system browser still gets the user their
         wallpaper, which is the point. */
      console.warn('[wallpapers] native save failed, handing off to the system:', err);
      try {
        await openExternal(url);
        return { outcome: 'handoff' };
      } catch (err2) {
        console.error('[wallpapers] could not hand the plate to the system:', url, err2);
        return { outcome: 'failed' };
      }
    }
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
    return { outcome: 'saved', where: 'browser' };
  } catch (err) {
    console.warn('[wallpapers] blob download failed, opening in a tab instead:', url, err);
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.target = '_blank';
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return { outcome: 'handoff' };
    } catch (fallbackErr) {
      console.error('[wallpapers] download failed entirely:', url, fallbackErr);
      return { outcome: 'failed' };
    }
  }
}

