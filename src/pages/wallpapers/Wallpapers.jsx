/* ── DIRECTION CONTRACT ──────────────────────────────────────────────────────
   Built from the approved comp: Wallpapers-Redesign-Final.dc.html
   (claude.ai/design project c2480981-7138-4ac6-bb1b-ecff9d43c0d7).

   THESIS: plates are chosen in bulk, so the page is a selection surface, not a
   feed with a cart bolted on. It refuses the masonry-plus-floating-button
   arrangement: art is laid in justified rows at true aspect, marking is a
   checkbox on the plate, and the register only appears once something is in it.
   OWN-WORLD: DESIGN.md unchanged — #000000 ground, white type, hairline
   white/15 rules, rounded-none, no shadow, inversion as the only elevation,
   .lh-label 11px/0.18em, .lh-display. The one added material is the sanctioned
   sheet-surface rgba(8,8,8,0.97), for the register panel and sheets.
   STORY: you scan rows of plates, optionally banded by game with a select-all
   on each band; you mark what you want; a white bar reports the count and
   offers Review or Download; the register holds the marks until you spend them.
   FIRST VIEWPORT: masthead, then the sticky narrowing bar (search, three
   dropdowns, Stream / By Game), then the first game band and its justified row
   of plates. The selection bar is absent until a plate is marked.
   FORM: justified-row selection gallery. Comp-directed; surface seed a40180c9.
   FINISH: unreviewed and undocumented is unfinished; this build ends with the
   finish review, the verdict, and DESIGN.md.
   ────────────────────────────────────────────────────────────────────────── */

import EmptyPlate from '../../components/ui/EmptyPlate';
import PageHeader from '../../components/ui/PageHeader';
import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { getLibrary } from '../../services/db';
import { getGamesForWallpapers } from '../../services/igdb';
import { toast } from '../../components/ui/toastBus';
import MarqueeText from '../../components/ui/MarqueeText';
import DropdownMenu from '../../components/ui/DropdownMenu';
import { Skeleton } from '../../components/ui/Skeleton';
import useSwipe from '../../hooks/useSwipe';
import useZoomPan from '../../hooks/useZoomPan';
import Dialog from '../../components/ui/Dialog';
import { useFocusTrap } from '../../components/ui/useFocusTrap';
import {
  Download,
  X,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Search,
  Loader2,
  ListPlus,
  MoreVertical,
  ExternalLink,
  Copy,
  RefreshCw,
  Info
} from 'lucide-react';
import useAnnounce from '../../components/ui/useAnnounce';

/* The one sanctioned off-black (DESIGN.md → "The one sanctioned off-black"): a
   sheet slides over a full-bleed #000000 page with no shadow to separate it, so
   an identical black would erase the boundary. */
const SHEET_SURFACE = 'rgba(8,8,8,0.97)';
const HAIRLINE = 'rgba(255,255,255,0.15)';

/* Above the mobile header, which is z-130, and below the plate viewer at z-150.
   At 120 the header painted over the expanded sheet — its top edge and hairline
   disappeared behind an app bar that the backdrop could not dim either, so a
   modal read as though it had slid underneath the chrome. Measured at 390x844:
   header bottom 56, sheet top 51. */
const REGISTER_Z = 140;

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* Filenames keep the game's actual name. The old rule was
   `replace(/[^a-zA-Z0-9]/g, '_')`, which is not a sanitiser — it is an ASCII
   filter. Every non-Latin title came out as underscores: ペルソナ5 saved as
   "_____", Sid Meier's Civilisation VI as "Sid_Meier_s_Civilization_VI". Strip
   only what a filesystem actually refuses, keep every letter in every script.
   NFC first so composed and decomposed accents produce the same file. */
function safeFilename(name) {
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
 * Hands a URL to the host OS. Inside Tauri that is the shell plugin, which is
 * already permitted for `^https?://.+` in src-tauri/capabilities/default.json;
 * on the web it is an ordinary new tab.
 *
 * `window.open` is not a substitute. A Tauri webview has no popup handling, so
 * on Android it silently does nothing at all.
 */
async function openExternally(url) {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
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
async function downloadUrlAsFile(url, filename) {
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
        await openExternally(url);
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

/* t_720p, not t_screenshot_med: the rows lay every plate at its TRUE aspect,
   and the *_med / *_big presets crop to 16:9 — a 1080x1920 portrait plate would
   come back letterboxed landscape and the justified row would be built from a
   lie. t_720p is the smallest IGDB preset that preserves aspect. */
const tileUrl = (wp) => `https://images.igdb.com/igdb/image/upload/t_720p/${wp.imageId}.jpg`;
const plateUrl = (wp) => `https://images.igdb.com/igdb/image/upload/t_1080p/${wp.imageId}.jpg`;
const plateFile = (wp) => `${safeFilename(wp.gameName)} — ${wp.type} — ${wp.imageId}.jpg`;
const typeLabel = (wp) => (wp.type === 'artwork' ? 'Artwork' : 'Screenshot');
const metaOf = (wp) => `${typeLabel(wp)} — ${wp.width} × ${wp.height}`;

/**
 * Justified rows, the comp's algorithm verbatim.
 *
 * Fill a row until the height needed to make it span W drops to the target,
 * then commit. Every plate keeps its true aspect; the row, not the plate, is
 * what gets squared off. The last row is capped at the target rather than
 * stretched, so four leftover plates do not become a billboard.
 */
function justify(items, W, gap, target) {
  const rows = [];
  let cur = [], arSum = 0;
  const flush = (h) => {
    if (!cur.length) return;
    rows.push({
      key: cur[0].id,
      h: Math.round(h),
      tiles: cur.map(it => ({ ...it, tw: Math.floor(it.ar * h), th: Math.round(h) })),
    });
    cur = []; arSum = 0;
  };
  items.forEach(it => {
    cur.push(it); arSum += it.ar;
    const h = (W - gap * (cur.length - 1)) / arSum;
    if (h <= target) flush(h);
  });
  if (cur.length) flush(Math.min(target, (W - gap * (cur.length - 1)) / arSum));
  return rows;
}

const readWide = () => (typeof window === 'undefined' ? true : window.innerWidth >= 1024);

/* ── Narrowing dropdown — chip that names its own current value ──
   Inverted while narrowed, and the label becomes the chosen row, so the bar
   states what the printing is showing without a separate count.

   The menu is the app's DropdownMenu rather than a panel of our own. Ours was
   absolutely positioned inside the mobile chip rail, and that rail is
   overflow-x-auto — a scroll container clips BOTH axes, so on a phone the menu
   opened inside the clip and tapping a chip looked like it did nothing.
   DropdownMenu portals to the body and positions against its trigger, so no
   ancestor can clip it; it also gives the rows menuitemradio semantics, which a
   hand-rolled list of buttons never had. */
function FilterDropdown({ base, rows, value, allValue, onPick, compact }) {
  const on = value !== allValue;
  const cur = rows.find(r => r.v === value);
  const options = rows.map(r => ({
    label: r.label,
    isActive: value === r.v,
    icon: value === r.v ? Check : undefined,
    onClick: () => onPick(r.v),
  }));
  return (
    <DropdownMenu options={options} align="left" menuWidth={compact ? 170 : 190}>
      <button
        aria-label={`${base}${on && cur ? `, ${cur.label}` : ''}`}
        className={`lh-label h-8 ${compact ? 'pl-2.5 pr-2 gap-1' : 'pl-3 pr-2.5 gap-1.5'} flex items-center whitespace-nowrap border transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white ${
          on ? 'bg-white text-black border-white' : 'border-white/15 text-white/60 hover:border-white/60 hover:text-white'
        }`}
      >
        {on && cur ? cur.label : base}
        <ChevronDown className="w-3 h-3 shrink-0" aria-hidden="true" />
      </button>
    </DropdownMenu>
  );
}

/* ── A plate in the grid ──
   Selected reads three ways at once (ring, dimmed art, filled check), so the
   state never rests on colour alone — and the ramp here is monochrome anyway. */
const Tile = memo(function Tile({
  wp, sel, selectMode, wide, onOpen, onToggle,
}) {
  /* Long press starts a selection on touch, the way a photos app does. The
     click that follows the press has to be swallowed or the plate opens
     full-screen on top of the selection it just made. */
  const lpTimer = useRef(null);
  const lpFired = useRef(false);

  const pressStart = useCallback(() => {
    if (wide) return;                       // a mouse has the corner check
    clearTimeout(lpTimer.current);
    lpTimer.current = setTimeout(() => { lpFired.current = true; onToggle(wp); }, 450);
  }, [wide, onToggle, wp]);
  const pressEnd = useCallback(() => clearTimeout(lpTimer.current), []);
  useEffect(() => () => clearTimeout(lpTimer.current), []);

  const activate = useCallback(() => {
    if (lpFired.current) { lpFired.current = false; return; }
    if (selectMode) onToggle(wp); else onOpen(wp);
  }, [selectMode, onToggle, onOpen, wp]);

  return (
    /* A plain wrapper. This carried role="button" and tabIndex={0} with the
       select control nested inside it — one interactive element inside another,
       which axe reports as nested-interactive and 4.1.2 forbids: the inner
       button's role and pressed state are not reliably exposed, and the outer
       label swallows it. Two actions cannot share one control, so the plate's
       own action became a real sibling <button> below.

       Invisible to the gate until now for a mundane reason: the feed draws from
       the library and the gate seeded none, so this route rendered an empty
       print room on every run and axe found nothing to complain about. Forty
       plates, forty violations, for as long as the page has existed. */
    <div
      className="group relative overflow-hidden bg-neutral-900 shrink-0 select-none"
      style={{ width: wp.tw, height: wp.th, boxShadow: sel ? 'inset 0 0 0 2px #ffffff' : 'none' }}
    >
      <img
        src={tileUrl(wp)}
        alt={`${wp.gameName} ${wp.type}`}
        className="w-full h-full object-cover block"
        style={{ opacity: sel ? 0.55 : 1 }}
        loading="lazy"
        decoding="async"
        draggable={false}
      />

      {/* Caption on hover. A pointer can ask a plate what it is without
          committing to opening it; a finger cannot, which is why the mobile
          viewer carries the same two lines in its chrome. */}
      <div className="hidden lg:flex absolute inset-0 items-end p-2.5 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-black/75 to-transparent to-45% pointer-events-none">
        <div className="min-w-0">
          <div className="lh-label lh-multiline text-white truncate">{wp.gameName}</div>
          <div className="lh-label lh-multiline text-white/70 truncate mt-1">{typeLabel(wp)} · {wp.width}×{wp.height}</div>
        </div>
      </div>

      {/* The plate's own action. Covers the tile so the whole thing is still one
          click, but as a real button: it gets Enter and Space for free, which is
          why the wrapper's hand-rolled onKeyDown — and its guard against the
          nested control's key events bubbling up — are both gone. */}
      <button
        type="button"
        className="absolute inset-0 w-full h-full cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white"
        aria-label={selectMode
          ? `${sel ? 'Deselect' : 'Select'} ${wp.gameName} ${wp.type}`
          : `Open ${wp.gameName} ${wp.type}`}
        onClick={activate}
        onPointerDown={pressStart}
        onPointerUp={pressEnd}
        onPointerLeave={pressEnd}
        onPointerCancel={pressEnd}
      />

      {/* Always mounted, so a keyboard reaches it without a long press it
          cannot perform. 24px, not the comp's 22 — 2.5.8 sets the floor.
          z-10 to sit above the full-bleed action button rather than under it. */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(wp); }}
        aria-pressed={sel}
        aria-label={`${sel ? 'Deselect' : 'Select'} ${wp.gameName} ${wp.type}`}
        className={`absolute top-1.5 left-1.5 z-10 w-6 h-6 flex items-center justify-center border-[1.5px] transition-opacity cursor-pointer outline-none focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-white ${
          sel ? 'border-white bg-white text-black' : 'border-white/80 bg-black/35 text-transparent'
        } ${sel || selectMode ? 'opacity-100' : 'opacity-0 pointer-coarse:opacity-100 lg:group-hover:opacity-100'}`}
      >
        {sel && <Check className="w-3.5 h-3.5" strokeWidth={3} aria-hidden="true" />}
      </button>
    </div>
  );
});

/* ── The justified rows of the feed ── */
function Rows({ rows, gap, sel, selectMode, wide, onOpen, onToggle }) {
  return (
    <div className="flex flex-col" style={{ gap }}>
      {rows.map(row => (
        <div key={row.key} className="flex" style={{ gap }}>
          {row.tiles.map(t => (
            <Tile
              key={t.id}
              wp={t}
              sel={sel.has(t.id)}
              selectMode={selectMode}
              wide={wide}
              onOpen={onOpen}
              onToggle={onToggle}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function Wallpapers() {
  // Filters and Settings
  const [libraryGames, setLibraryGames] = useState([]);
  const [wallpapers, setWallpapers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [aspectRatio, setAspectRatio] = useState('all'); // 'all' | 'pc' | 'mobile'
  const [sourceMode, setSourceMode] = useState('both'); // 'both' | 'library' | 'similar'
  const [typeFilter, setTypeFilter] = useState('all'); // 'all' | 'artwork' | 'screenshot'
  // Survives the toast, so a failed load never masquerades as an empty filter result.
  const [loadError, setLoadError] = useState(null);

  const isNarrowed = searchQuery.trim() !== ''
    || aspectRatio !== 'all' || sourceMode !== 'both' || typeFilter !== 'all';

  // Pagination and Infinite Scroll State
  const [visibleCount, setVisibleCount] = useState(40);
  const sentinelRef = useRef(null);

  /* Justified rows need a real measured width — a row is only correct if it
     spans exactly the box it sits in.

     The grid is held in state through a callback ref, and the measuring effect
     is keyed on that element. Keyed instead on [loading, loadError,
     libraryGames.length] it missed every remount those three do not cause: the
     grid unmounts whenever a filter matches nothing and comes back when the
     filter is cleared, so the ResizeObserver stayed bound to a detached node and
     gridW held its old value. Measured: narrow the window while "No Plates
     Match" is showing, then clear the filter — container 896px, rows still laid
     out to 1074px, 178px of overflow. */
  const [gridEl, setGridEl] = useState(null);
  const gridRef = useCallback((node) => setGridEl(node), []);
  const [gridW, setGridW] = useState(0);
  const [wide, setWide] = useState(readWide);
  useEffect(() => {
    const measure = () => {
      setWide(readWide());
      if (gridEl) setGridW(gridEl.getBoundingClientRect().width);
    };
    measure();
    window.addEventListener('resize', measure);
    let ro;
    if (typeof ResizeObserver !== 'undefined' && gridEl) {
      ro = new ResizeObserver(measure);
      ro.observe(gridEl);
    }
    return () => { window.removeEventListener('resize', measure); ro?.disconnect(); };
  }, [gridEl]);

  const gap = wide ? 4 : 2;
  const rowTarget = wide ? 190 : 160;

  /* The register. Still `moctale_download_bucket` on disk: the shape is the
     same list of plates it always was, and renaming the key would have thrown
     away every queue already sitting in a browser. */
  const [selected, setSelected] = useState(() => {
    const saved = localStorage.getItem('moctale_download_bucket');
    return saved ? JSON.parse(saved) : [];
  });
  const selectedIds = useMemo(() => new Set(selected.map(item => item.id)), [selected]);
  const selectMode = selected.length > 0;

  const [panelOpen, setPanelOpen] = useState(false);   // desktop register
  const [sheetOpen, setSheetOpen] = useState(false);   // mobile register
  const [sheetFull, setSheetFull] = useState(false);
  /* Mobile search rides on top of the chip rail rather than beside it, the way
     Library's does: the rail is already a scroller and a field in it would be
     something you had to scroll to find. */
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef(null);

  // Viewer state, shared by the two viewers — only one is mounted at a width.
  const [activePreviewIndex, setActivePreviewIndex] = useState(-1);
  const [previewSource, setPreviewSource] = useState('gallery'); // 'gallery' | 'selection'
  const [previewDevice, setPreviewDevice] = useState('none');    // 'none' | 'desktop' | 'mobile'
  // Declared up here because the zoom gesture below hides it on the way in.
  const [chromeShown, setChromeShown] = useState(true);
  /* Continuous zoom, driven by the gestures people already have: pinch on a
     touchscreen, ctrl+scroll or a trackpad pinch on a desktop (the browser
     reports both as the same wheel event). The chrome gets out of the way on
     the way in and comes back on the way out — you zoom to inspect the picture,
     not the toolbar. */
  const plateImgRef = useRef(null);
  const {
    containerRef: zoomAreaRef,
    zoomed,
    gesturing: zoomGesturing,
    reset: resetZoom,
    consumeClick: consumeZoomClick,
    bind: zoomBind,
    style: zoomStyle,
  } = useZoomPan({
    max: 4,
    tapScale: 2.5,
    contentRef: plateImgRef,
    onDoubleTap: (zoomIn) => setChromeShown(!zoomIn),
  });
  const [infoOpen, setInfoOpen] = useState(false);
  const previewRef = useRef(null);

  // Sync the register with localStorage
  useEffect(() => {
    localStorage.setItem('moctale_download_bucket', JSON.stringify(selected));
  }, [selected]);

  /* Only the hand-rolled viewer needs this. Every sheet and panel goes through
     Dialog, whose focus trap locks scroll itself. */
  useEffect(() => {
    if (activePreviewIndex >= 0) {
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    } else {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
  }, [activePreviewIndex]);

  // Load Library Games and Fetch Wallpapers
  const fetchAllData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    // A failed reload used to keep the previous plates on screen under a toast.
    setWallpapers([]);
    const lib = getLibrary();
    setLibraryGames(lib);

    if (lib.length === 0) {
      setLoading(false);
      return;
    }

    const libraryIds = lib.map(g => Number(g.id)).filter(id => !isNaN(id) && id > 0);
    if (libraryIds.length === 0) {
      setLoading(false);
      return;
    }

    try {
      /* Through the shared service, like every other IGDB caller.
         This page used to hold its own credential flow -- client id and secret
         out of localStorage, its own Twitch exchange, its own Client-ID and
         Bearer headers, its own rewrite to api.igdb.com for the Tauri shell --
         which is why the proxy migration missed it and why the desktop build
         reported "url not allowed on the configured scope". Nothing here holds
         a credential now, and the request is rate limited and cached with the
         rest. */
      const gamesData = await getGamesForWallpapers(libraryIds, true);
      /* The "IGDB returned an error object rather than rows" branch that used to
         be here is gone with the raw fetch: igdbGames already recognises an IGDB
         error body, announces it on moctale_api_error for the banner, and hands
         back an empty array. The empty-result check further down then reports it
         to this page, which is the same message by a shorter road. */

      let parsedWallpapers = [];
      let allSimilarIds = new Set();

      gamesData.forEach(game => {
        const gameId = game.id;
        const gameName = game.name;

        if (game.similar_games) {
          game.similar_games.forEach(simId => {
            if (!libraryIds.includes(Number(simId))) {
              allSimilarIds.add(Number(simId));
            }
          });
        }

        if (game.artworks) {
          game.artworks.forEach(art => {
            parsedWallpapers.push({
              id: `art_${art.image_id}`,
              gameId,
              gameName,
              type: 'artwork',
              imageId: art.image_id,
              width: art.width || 1920,
              height: art.height || 1080,
              aspect: (art.width && art.height) ? art.width / art.height : 16 / 9,
              source: 'library'
            });
          });
        }

        if (game.screenshots) {
          game.screenshots.forEach(sc => {
            parsedWallpapers.push({
              id: `sc_${sc.image_id}`,
              gameId,
              gameName,
              type: 'screenshot',
              imageId: sc.image_id,
              width: sc.width || 1920,
              height: sc.height || 1080,
              aspect: (sc.width && sc.height) ? sc.width / sc.height : 16 / 9,
              source: 'library'
            });
          });
        }
      });

      // Always fetch similar games wallpapers on mount to combine in pool
      if (allSimilarIds.size > 0) {
        const similarIdsArray = Array.from(allSimilarIds).slice(0, 40); // Limit to top 40 similar games to keep performance optimal
        const simGamesData = await getGamesForWallpapers(similarIdsArray);

        if (Array.isArray(simGamesData)) {
          simGamesData.forEach(game => {
            const gameId = game.id;
            const gameName = game.name;

            if (game.artworks) {
              game.artworks.forEach(art => {
                parsedWallpapers.push({
                  id: `art_${art.image_id}`,
                  gameId,
                  gameName,
                  type: 'artwork',
                  imageId: art.image_id,
                  width: art.width || 1920,
                  height: art.height || 1080,
                  aspect: (art.width && art.height) ? art.width / art.height : 16 / 9,
                  source: 'similar'
                });
              });
            }

            if (game.screenshots) {
              game.screenshots.forEach(sc => {
                parsedWallpapers.push({
                  id: `sc_${sc.image_id}`,
                  gameId,
                  gameName,
                  type: 'screenshot',
                  imageId: sc.image_id,
                  width: sc.width || 1920,
                  height: sc.height || 1080,
                  aspect: (sc.width && sc.height) ? sc.width / sc.height : 16 / 9,
                  source: 'similar'
                });
              });
            }
          });
        }
      }

      /* A failed request does not always throw. Missing credentials and a
         rejected query both come back as an empty result, so the catch below
         never fires and the page fell through to "No Plates Match" — telling
         someone with no API keys to try another aspect. Caught by rendering it:
         a shelf with games in it always has some artwork behind it, so nothing
         parsed means the source did not answer, not that the filters are wrong. */
      if (parsedWallpapers.length === 0) {
        setLoadError('No plates came back from IGDB');
        setWallpapers([]);
        return;
      }

      const shuffledWallpapers = shuffleArray(parsedWallpapers);
      setWallpapers(shuffledWallpapers);
    } catch (err) {
      console.error('Failed to fetch wallpapers:', err);
      /* Held in state, not just toasted. A toast expires in six seconds and the
         page underneath then read "No Plates Match — try another aspect, source
         or search", which blames the user's filters for a network failure and
         offers no way back. The error has to outlive the toast. */
      setLoadError(err?.message || 'The request did not complete');
      toast('Could not load wallpapers', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  /* One flat, shuffled feed. Grouping by game is gone: what you are choosing is
     a plate, not a game, and banding a paged feed turned the gallery into a
     list of headings — 40 loaded plates spread over 200 games gave bands of
     one. */
  const filteredWallpapers = useMemo(() => {
    const out = wallpapers.filter(wp => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        if (!wp.gameName.toLowerCase().includes(query)) return false;
      }

      // 2. Suggestion Mode Filter
      if (sourceMode === 'library') {
        if (wp.source !== 'library') return false;
      } else if (sourceMode === 'similar') {
        if (wp.source !== 'similar') return false;
      }

      // 3. Aspect Ratio Filter
      if (aspectRatio === 'pc') {
        if (wp.width <= wp.height) return false; // Portrait/square not wide
      } else if (aspectRatio === 'mobile') {
        if (wp.width >= wp.height) return false; // Landscape/square not portrait
      }

      // 4. Image Type Filter
      if (typeFilter !== 'all') {
        if (wp.type !== typeFilter) return false;
      }

      return true;
    });
    return out;
  }, [wallpapers, searchQuery, sourceMode, aspectRatio, typeFilter]);

  const displayedWallpapers = useMemo(
    () => filteredWallpapers.slice(0, visibleCount),
    [filteredWallpapers, visibleCount]
  );

  /* Bands, or one unnamed band holding the whole stream. Grouping runs over the
     page that has loaded, not the whole result — so a band grows as you scroll
     rather than the page stalling until every plate of every game is in hand. */
  const rows = useMemo(() => {
    if (!gridW) return [];
    return justify(displayedWallpapers.map(wp => ({ ...wp, ar: wp.aspect })), gridW, gap, rowTarget);
  }, [displayedWallpapers, gridW, gap, rowTarget]);

  // Reset pagination on filter change
  useEffect(() => {
    setVisibleCount(40);
  }, [searchQuery, aspectRatio, sourceMode, typeFilter]);

  // Infinite Scroll observer
  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisibleCount(prev => Math.min(prev + 40, filteredWallpapers.length));
      }
    }, { rootMargin: '1000px' });
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [filteredWallpapers.length, visibleCount]);

  // Keep the viewer index in range when the register shrinks under it
  useEffect(() => {
    if (previewSource === 'selection' && activePreviewIndex >= 0) {
      if (selected.length === 0) setActivePreviewIndex(-1);
      else if (activePreviewIndex >= selected.length) setActivePreviewIndex(selected.length - 1);
    }
  }, [selected, previewSource, activePreviewIndex]);

  const previewPool = previewSource === 'selection' ? selected : filteredWallpapers;
  const active = activePreviewIndex >= 0 && activePreviewIndex < previewPool.length
    ? previewPool[activePreviewIndex]
    : null;
  const activeSelected = active ? selectedIds.has(active.id) : false;

  /* One navigator for the arrows, the filmstrip, the swipe and the keys. */
  const [previewDir, setPreviewDir] = useState(1);
  const goWallpaper = useCallback((step) => {
    const pool = previewSource === 'selection' ? selected : filteredWallpapers;
    if (pool.length === 0) return;
    setPreviewDir(step);
    resetZoom();
    setActivePreviewIndex(prev => (prev + step + pool.length) % pool.length);
  }, [previewSource, selected, filteredWallpapers, resetZoom]);

  const jumpTo = useCallback((idx) => { resetZoom(); setActivePreviewIndex(idx); }, [resetZoom]);

  /* ── The paging track ──
     Three panes mounted side by side with the strip parked one pane to the
     left, so the current plate is centred and its neighbours are already there.
     The plate then moves WITH the finger from the first pixel of the drag,
     rather than sitting still until the gesture commits and cutting to the next
     image. This is the game page's media gallery, same mechanism and the same
     reasons — see GameDetail's `mediaTrackRef`.

     The transform is written straight to the node, never through state: a React
     render per pointermove is what makes a drag cost frames, and a transform is
     presentation, so it belongs on the element. */
  const trackRef = useRef(null);
  const TRACK_REST = 'translate3d(-100%, 0, 0)';
  const TRACK_GLIDE = 'transform 260ms cubic-bezier(0.23, 1, 0.32, 1)';
  const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const settleTrack = useCallback((el) => {
    el.style.transition = TRACK_GLIDE;
    el.style.transform = TRACK_REST;
  }, []);

  /* Carries the strip the rest of the way, then changes the index. It must not
     reset the offset itself — snapping back to rest before React has swapped
     the panes flashes the plate you just swiped away. The layout effect below
     owns the reset. */
  const slideTo = useCallback((step) => {
    const el = trackRef.current;
    if (!el) return;
    if (reduceMotion()) { goWallpaper(step); return; }
    const done = () => { el.removeEventListener('transitionend', done); goWallpaper(step); };
    el.addEventListener('transitionend', done);
    el.style.transition = TRACK_GLIDE;
    el.style.transform = `translate3d(${step > 0 ? '-200%' : '0%'}, 0, 0)`;
  }, [goWallpaper]);

  /* Re-centre in the same paint the panes change in. useLayoutEffect, not
     useEffect: this lands after the DOM update and before the browser draws, so
     the frame where the old plate sits under the new offset never ships. Covers
     filmstrip jumps too, which move the index with no animation at all. */
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    el.style.transition = 'none';
    el.style.transform = TRACK_REST;
    void el.offsetHeight;               // land the jump before transitions resume
    el.style.transition = '';
  }, [activePreviewIndex, active]);

  /* A committed swipe ends in a click on most browsers, and the stage answers
     clicks — so without this a swipe would also toggle the chrome it had just
     paged under. */
  const swallowClickRef = useRef(false);
  const rawPreviewSwipe = useSwipe({
    axis: 'x',
    enabled: activePreviewIndex >= 0 && !zoomed && previewPool.length > 1,
    onSwipe: (dir) => { swallowClickRef.current = true; slideTo(dir === 'left' ? 1 : -1); },
    onCancel: () => { swallowClickRef.current = true; const el = trackRef.current; if (el) settleTrack(el); },
    onMove: (dx, dragging) => {
      const el = trackRef.current;
      if (!el || reduceMotion()) return;
      if (!dragging) return;            // commit and cancel own the release
      el.style.transition = 'none';
      el.style.transform = `translate3d(calc(-100% + ${dx}px), 0, 0)`;
    },
  });
  const previewSwipe = {
    ...rawPreviewSwipe,
    onPointerDown: (e) => { swallowClickRef.current = false; rawPreviewSwipe.onPointerDown?.(e); },
  };

  /* ── The mobile viewer's own gestures ──
     A photos app answers three things on one surface: tap toggles the chrome,
     sideways pages, a downward drag throws the picture away with the picture
     following your finger. useSwipe locks to one axis per gesture, so the two
     directions are two hooks on the same element — whichever axis the gesture
     is not releases itself on the first real movement. touchAction is set by
     hand for the same reason: neither hook's own default is right when both
     axes are live. The plate element itself is declared with the zoom hook
     above — the dismiss painter and the zoom transform address the same img. */

  const paintDismiss = useCallback((dy, dragging) => {
    const el = plateImgRef.current;
    if (!el) return;
    if (!dragging) {
      el.style.transition = 'transform 220ms cubic-bezier(0.16, 1, 0.3, 1), opacity 220ms ease';
      el.style.transform = '';
      el.style.opacity = '';
      return;
    }
    // Upward travel is damped: the gesture means "down", so up should resist.
    const travel = dy > 0 ? dy : dy * 0.25;
    el.style.transition = 'none';
    el.style.transform = `translate3d(0, ${travel}px, 0) scale(${Math.max(0.86, 1 - Math.abs(travel) / 1400)})`;
    el.style.opacity = String(Math.max(0.4, 1 - Math.max(0, dy) / 520));
  }, []);

  /* The chrome comes back whenever the plate changes, so paging never leaves
     you on an unlabelled picture with no way out but a guess. Adjusted during
     render rather than in an effect — an effect here cascades a render on every
     swipe. */
  const [chromeFor, setChromeFor] = useState(activePreviewIndex);
  if (chromeFor !== activePreviewIndex) {
    setChromeFor(activePreviewIndex);
    setChromeShown(true);
  }

  const rawDismissSwipe = useSwipe({
    axis: 'y',
    threshold: 110,
    enabled: activePreviewIndex >= 0 && !zoomed,
    onMove: paintDismiss,
    onCancel: () => { swallowClickRef.current = true; paintDismiss(0, false); },
    onSwipe: (dir) => {
      swallowClickRef.current = true;
      if (dir !== 'down') return paintDismiss(0, false);   // a flick up is not a dismissal
      setActivePreviewIndex(-1);
    },
  });

  useEffect(() => {
    if (activePreviewIndex < 0) return;
    const onKey = (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); goWallpaper(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goWallpaper(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activePreviewIndex, goWallpaper]);

  /* Exactly one viewer is mounted at a time (see the render gates below), so
     this ref always points at the live one.

     `modal` is the load-bearing argument. The mobile viewer is inset-0 and
     covers the app, so it is genuinely modal. The desktop lightbox is not: it
     starts at the 220px rail and deliberately leaves global navigation on
     screen, and a trap there inerts everything outside the dialog — which,
     because the lightbox is rendered inside #root rather than portalled out of
     it, meant inerting the lightbox along with the page. Measured: opening a
     plate at 1440px set [inert] on div#root, and both the sidebar links and the
     lightbox's own Close button had an inert ancestor. Nothing on the screen
     could be clicked. Pairing modal:false with no aria-modal is what
     Dialog.jsx's own contract asks for when the page stays reachable. */
  useFocusTrap({
    active: !!active,
    containerRef: previewRef,
    onClose: () => setActivePreviewIndex(-1),
    lockScroll: false,
    modal: !wide,
  });

  // ── Register actions ──
  const toggleSelect = useCallback((wp) => {
    setSelected(prev => prev.some(item => item.id === wp.id)
      ? prev.filter(item => item.id !== wp.id)
      : [...prev, wp]);
  }, []);

  const clearSelection = useCallback(() => {
    setSelected([]);
    setPanelOpen(false);
    setSheetOpen(false);
  }, []);

  const queueAllFromGame = useCallback((gameName) => {
    const gameWps = wallpapers.filter(wp => wp.gameName === gameName);
    setSelected(prev => {
      const prevIds = new Set(prev.map(item => item.id));
      const toAdd = gameWps.filter(wp => !prevIds.has(wp.id));
      if (toAdd.length > 0) {
        toast(`Selected ${toAdd.length} plates from ${gameName}`);
        return [...prev, ...toAdd];
      }
      toast('Every plate from this game is already selected');
      return prev;
    });
  }, [wallpapers]);

  const clearNarrowing = useCallback(() => {
    setSearchQuery('');
    setAspectRatio('all');
    setSourceMode('both');
    setTypeFilter('all');
  }, []);

  /* A batch runs one at a time and can be stopped. It used to fan out N
     setTimeouts, which had three problems: nothing cleared them when the page
     unmounted, so leaving mid-batch kept firing downloads at a dead component;
     nothing stopped a second click stacking a second batch on top of the first;
     and the toast claimed "initiated" before a single request had been made, so
     a batch that failed entirely still read as success. */
  const [batchProgress, setBatchProgress] = useState(null);   // { done, total } | null
  const batchCancelled = useRef(false);
  useEffect(() => () => { batchCancelled.current = true; }, []);

  const downloadSelection = useCallback(async () => {
    if (batchProgress || selected.length === 0) return;   // no double-fire
    const queue = [...selected];
    batchCancelled.current = false;
    setBatchProgress({ done: 0, total: queue.length });

    let saved = 0, tabbed = 0, failed = 0;
    for (let i = 0; i < queue.length; i++) {
      if (batchCancelled.current) break;
      const { outcome } = await downloadUrlAsFile(plateUrl(queue[i]), plateFile(queue[i]));
      if (outcome === 'saved') saved++;
      else if (outcome === 'handoff') tabbed++;
      else failed++;

      /* A handoff opens the plate somewhere else. One is helpful; a queue of
         them would fire an intent per item and bury the app under browser tabs,
         so the batch stops at the first one rather than carrying on. It only
         happens when the native save is unavailable, and then it is the batch
         that cannot work, not this one plate. */
      if (outcome === 'handoff' && queue.length > 1) {
        setBatchProgress(null);
        toast('The selection cannot be saved in one go on this device — plates open one at a time instead', 'error');
        return;
      }
      setBatchProgress({ done: i + 1, total: queue.length });
      // Browsers throttle rapid successive downloads; this paces them.
      if (i < queue.length - 1) await new Promise(r => setTimeout(r, 400));
    }
    if (batchCancelled.current) return;
    setBatchProgress(null);

    /* Says what happened, not what was attempted. */
    const parts = [];
    if (saved) parts.push(`${saved} downloaded`);
    if (tabbed) parts.push(`${tabbed} opened outside the app`);
    if (failed) parts.push(`${failed} failed`);
    toast(parts.join(', ') || 'Nothing to download', failed && !saved && !tabbed ? 'error' : 'info');
  }, [selected, batchProgress]);

  const downloadSingle = useCallback(async (wp) => {
    const { outcome, where } = await downloadUrlAsFile(plateUrl(wp), plateFile(wp));
    if (outcome === 'saved') toast(where && where !== 'browser' ? `Saved to ${where}` : 'Wallpaper downloaded');
    /* Named for what actually happens rather than for the mechanism: inside the
       app the plate opens in the system browser, which owns the only download
       manager available to a webview. */
    else if (outcome === 'handoff') toast('Opened outside the app — save it from there');
    else toast('Download failed. Check your connection and try again', 'error');
  }, []);

  const openFromGrid = useCallback((wp) => {
    const idx = filteredWallpapers.findIndex(f => f.id === wp.id);
    if (idx < 0) return;
    setPreviewSource('gallery');
    setInfoOpen(false);
    resetZoom();
    setPreviewDevice('none');
    setActivePreviewIndex(idx);
  }, [filteredWallpapers, resetZoom]);

  /* Opening from the register closes it rather than stacking a viewer over it:
     two live focus traps listening on document in capture phase fight over
     every Tab and force focus back to the lower one. Where the plate is still
     in the current narrowing the viewer pages the gallery, exactly as the comp
     does; where the narrowing has since hidden it, the viewer pages the
     register instead, so the control is never dead. */
  const openFromRegister = useCallback((wp) => {
    const idx = filteredWallpapers.findIndex(f => f.id === wp.id);
    setPanelOpen(false);
    setSheetOpen(false);
    setInfoOpen(false);
    resetZoom();
    setPreviewDevice('none');
    if (idx >= 0) {
      setPreviewSource('gallery');
      setActivePreviewIndex(idx);
    } else {
      setPreviewSource('selection');
      setActivePreviewIndex(selected.findIndex(s => s.id === wp.id));
    }
  }, [filteredWallpapers, selected, resetZoom]);

  // Filtering the grid changed the count silently. 4.1.3.
  useAnnounce(loading ? 'Loading wallpapers'
    : `${filteredWallpapers.length} ${filteredWallpapers.length === 1 ? 'wallpaper' : 'wallpapers'}`);

  const n = filteredWallpapers.length;
  const selN = selected.length;

  const dropdowns = [
    {
      base: 'Aspect', value: aspectRatio, allValue: 'all', set: setAspectRatio, key: 'aspect',
      rows: [{ v: 'all', label: 'All sizes' }, { v: 'pc', label: 'Wide' }, { v: 'mobile', label: 'Portrait' }],
    },
    {
      base: 'Type', value: typeFilter, allValue: 'all', set: setTypeFilter, key: 'type',
      rows: [{ v: 'all', label: 'All types' }, { v: 'artwork', label: 'Artwork' }, { v: 'screenshot', label: 'Screens' }],
    },
    {
      base: 'Source', value: sourceMode, allValue: 'both', set: setSourceMode, key: 'source',
      rows: [{ v: 'both', label: 'All sources' }, { v: 'library', label: 'Library' }, { v: 'similar', label: 'Similar' }],
    },
  ];

  const renderDropdowns = (compact) => dropdowns.map(d => (
    <FilterDropdown
      key={d.key}
      base={d.base}
      rows={d.rows}
      value={d.value}
      allValue={d.allValue}
      compact={compact}
      onPick={d.set}
    />
  ));

  const reloadButton = (
    <button
      /* aria-disabled, not disabled: the click is what sets `loading`, and a
         disabled element drops focus to <body>. WCAG 2.4.3. */
      onClick={() => { if (!loading) fetchAllData(); }}
      aria-disabled={loading}
      aria-label="Reload wallpapers"
      title="Reload wallpapers"
      className="w-8 h-8 shrink-0 flex items-center justify-center border border-white/15 text-white/60 hover:border-white/60 hover:text-white aria-disabled:opacity-40 transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white"
    >
      <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
    </button>
  );

  const fields = active ? [
    { k: 'Register', v: String(activePreviewIndex + 1).padStart(3, '0') },
    { k: 'Type', v: typeLabel(active) },
    { k: 'Dimensions', v: `${active.width} × ${active.height}` },
    { k: 'Aspect', v: active.width > active.height ? 'Wide' : 'Portrait' },
    { k: 'Source', v: active.source === 'library' ? 'Your library' : 'Similar games' },
  ] : [];

  const related = active
    ? filteredWallpapers.filter(w => w.gameName === active.gameName && w.id !== active.id).slice(0, 6)
    : [];

  /* The strip is windowed. Rendering every plate of a 600-plate narrowing put
     600 images in a horizontal scroller nobody was going to reach the end of. */
  const filmFrom = Math.max(0, activePreviewIndex - 40);
  const film = previewPool.slice(filmFrom, activePreviewIndex + 41);

  /* The strip scrolls the current frame to its middle. Without this the active
     frame stayed wherever the last render left it — usually the far edge, or
     off-screen entirely once you had paged a few times — so the one thumbnail
     that says where you are was the hardest to see. `nearest` on the block axis
     so a horizontal strip never drags the page vertically. */
  const filmActiveRef = useRef(null);
  useEffect(() => {
    const el = filmActiveRef.current;
    if (!el) return;
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
  }, [activePreviewIndex, active]);

  const remaining = filteredWallpapers.length - displayedWallpapers.length;

  const gridBody = (
    <>
      <div ref={gridRef} className="-mx-4 sm:-mx-5 md:-mx-6 lg:mx-0">
        <Rows
          rows={rows}
          gap={gap}
          sel={selectedIds}
          selectMode={selectMode}
          wide={wide}
          onOpen={openFromGrid}
          onToggle={toggleSelect}
        />
      </div>

      {/* Says how much is left, rather than spinning. Nothing is loading here:
          the plates are already in hand and this only raises visibleCount, which
          is synchronous — so a spinner claimed work that was never happening and,
          because it only disappears at the very end of a 500-plate feed, read as
          a load that had hung. It is still the scroll sentinel. */}
      {remaining > 0 && (
        <div ref={sentinelRef} className="w-full flex justify-center py-8">
          <span className="lh-label text-white/60 tabular-nums">
            {remaining} More {remaining === 1 ? 'Plate' : 'Plates'}
          </span>
        </div>
      )}
    </>
  );

  return (
    <div
      className="min-h-screen bg-black text-white animate-in fade-in duration-500"
      /* Clears the selection bar, which floats over the last row: 52px of bar
         plus its 1rem inset plus a gap. */
      style={{ paddingBottom: 'calc(6.5rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <div className="content-container py-4">

        {/* ── Masthead ──
             The comp draws 26/40; both are off the ramp DESIGN.md documents, so
             these are the nearest declared steps — title-sm-wide (28) and
             title-base-wide (36). The comp owns the composition, the token layer
             owns the type scale. */}
        <PageHeader
          className="mb-4 lg:mb-4 [@media(max-height:560px)]:mb-2"
          titleClassName="text-[28px] lg:text-[36px] [@media(max-height:560px)]:text-2xl leading-none"
          title="Wallpapers"
          count={`${n} ${n === 1 ? 'Plate' : 'Plates'}`}
          meta={wide && n > 0 ? 'Hover a plate to select it' : undefined}
        />

        {libraryGames.length === 0 ? (
          <div className="mt-4">
            <EmptyPlate title="The Print Room Is Bare" body="Shelve games in your library to draw their plates" />
          </div>
        ) : (
          <>
            {/* ── Narrowing bar — sticky, the page's whole control surface ── */}
            <div
              /* z-[60], not z-20: DropdownMenu pins its trigger wrapper at
                 z-index 50, so a plate menu painted straight over this bar as
                 the page scrolled under it.

                 Pinned at the header's FULL height and translated up by however
                 much of it is currently hidden — Library's strip does exactly
                 this and documents why. Keying `top` off --mobile-nav-offset
                 instead made the bar jump the whole 56px in one frame while the
                 header was still 300ms into translating away, so a band of
                 scrolling cover art showed through the gap between them. Same
                 300ms and curve as the header, so the two edges travel together;
                 and transform composites, where animating `top` relayouts on
                 every scroll direction change. */
              className="sticky z-[60] bg-black -mx-4 sm:-mx-5 md:-mx-6 lg:mx-0 px-4 sm:px-5 md:px-6 lg:px-0 py-3 border-b border-white/10 mb-5 lg:mb-5 transition-transform duration-300 ease-in-out motion-reduce:transition-none"
              style={{
                top: 'calc(var(--mobile-nav-h, 0px) + env(safe-area-inset-top, 0px) + var(--titlebar-h, 0px))',
                transform: 'translateY(calc(var(--mobile-nav-offset, 0px) - var(--mobile-nav-h, 0px) - env(safe-area-inset-top, 0px)))',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Desktop: search first, then the three dropdowns, then the view
                  toggle pushed right. */}
              <div className="hidden lg:flex items-center gap-4">
                <div className="relative w-60 shrink-0">
                  <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/60 pointer-events-none" aria-hidden="true" />
                  <input
                    aria-label="Search by game"
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="SEARCH BY GAME"
                    className="w-full h-8 pl-6 pr-8 bg-transparent border-0 border-b border-white/25 focus:border-white lh-label text-white placeholder:text-white/60 outline-none transition-colors"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      aria-label="Clear search"
                      className="absolute right-0 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-white/60 hover:text-white cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-white"
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
                {renderDropdowns(false)}
                {reloadButton}
              </div>

              {/* Mobile: two layers in one grid cell — the chip rail, and the
                  search field that slides over it. Both keep their box, so
                  opening search never changes the bar's height. `inert` on the
                  hidden layer, because opacity alone leaves it tabbable. */}
              <div className="lg:hidden grid grid-cols-1">
                <div
                  className={`col-start-1 row-start-1 flex items-center gap-1.5 overflow-x-auto no-scrollbar transition-all duration-300 ease-in-out ${
                    isSearchOpen ? 'opacity-0 pointer-events-none -translate-y-1' : 'opacity-100 translate-y-0'
                  }`}
                  inert={isSearchOpen}
                >
                  {renderDropdowns(true)}
                  {reloadButton}
                  <span className="flex-1 min-w-2" />
                  <button
                    onClick={() => { setIsSearchOpen(true); requestAnimationFrame(() => searchInputRef.current?.focus()); }}
                    aria-label="Search by game"
                    aria-expanded={isSearchOpen}
                    className={`w-8 h-8 shrink-0 sticky right-0 flex items-center justify-center border transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white ${
                      searchQuery ? 'bg-white text-black border-white' : 'bg-black border-white/15 text-white/60 hover:border-white/60 hover:text-white'
                    }`}
                  >
                    <Search className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>

                <div
                  className={`col-start-1 row-start-1 flex items-center gap-1.5 transition-all duration-300 ease-in-out ${
                    isSearchOpen ? 'opacity-100 translate-y-0' : 'opacity-0 pointer-events-none translate-y-1'
                  }`}
                  inert={!isSearchOpen}
                >
                  <div className="relative flex-1 min-w-0">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/60 pointer-events-none" aria-hidden="true" />
                    <input
                      ref={searchInputRef}
                      aria-label="Search by game"
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="SEARCH BY GAME"
                      className="w-full h-8 pl-9 pr-3 bg-black border border-white/40 focus:border-white lh-label text-white placeholder:text-white/60 outline-none transition-colors"
                    />
                  </div>
                  <button
                    onClick={() => { setIsSearchOpen(false); setSearchQuery(''); }}
                    aria-label="Close search"
                    className="w-8 h-8 shrink-0 flex items-center justify-center border border-white/15 text-white/60 hover:border-white/60 hover:text-white transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white"
                  >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>

            {loading ? (
              <div className="-mx-4 sm:-mx-5 md:-mx-6 lg:mx-0 flex flex-col" style={{ gap }}>
                {[[1.6, 1.2, 1.5], [1.8, 0.6], [1.3, 1.7, 1.4]].map((row, i) => (
                  <div key={i} className="flex" style={{ gap }}>
                    {row.map((ar, j) => (
                      <Skeleton key={j} style={{ height: rowTarget, flex: ar }} />
                    ))}
                  </div>
                ))}
              </div>
            ) : loadError ? (
              /* Checked BEFORE the empty-filter state. A failed request leaves
                 zero wallpapers, which is indistinguishable from a filter that
                 matched nothing — so the page used to tell someone whose network
                 had dropped to try another aspect. */
              <div className="border border-white/15 text-center px-6 py-16">
                <div className="lh-display text-xl text-white mb-2">The Presses Stopped</div>
                {/* The 'credentials' variant of this message is gone with the
                    credentials themselves: nothing sets that state any more, so
                    keeping a branch that says "the IGDB keys did not arrive"
                    would only mislead whoever reads it next. */}
                <p className="lh-label text-white/60 max-w-sm mx-auto mb-6">
                  Wallpapers could not be loaded from IGDB. Your library and selection are untouched.
                </p>
                <button
                  onClick={() => fetchAllData()}
                  className="lh-label inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] border border-white text-white hover:bg-white hover:text-black transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-white"
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  Try Again
                </button>
              </div>
            ) : n === 0 ? (
              <div className="border border-white/15 text-center px-6 py-16">
                <div className="lh-display text-xl text-white mb-2">No Plates Match</div>
                <p className="lh-label text-white/60 mb-6">Nothing in the archive answers this narrowing</p>
                <button
                  onClick={clearNarrowing}
                  aria-disabled={!isNarrowed}
                  className="lh-label inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] border border-white text-white hover:bg-white hover:text-black aria-disabled:opacity-40 transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-white"
                >
                  Show All Plates
                </button>
              </div>
            ) : gridBody}
          </>
        )}
      </div>

      {/* ── Selection bar ──
          Absent until something is marked, so the page carries no permanent
          chrome for a mode nobody has entered. */}
      {/* Not while the register is open: its own footer offers the same actions. */}
      {selN > 0 && activePreviewIndex < 0 && !panelOpen && !sheetOpen && (
        <div
          className="fixed z-40 bg-white text-black flex items-stretch h-13 bottom-4 left-4 right-4 lg:left-auto lg:right-auto lg:bottom-5 lg:translate-x-[-50%] lg:w-auto"
          style={{
            height: 52,
            bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))',
            ...(wide ? { left: 'calc(220px + (100% - 220px) / 2)', right: 'auto' } : null),
            boxShadow: '0 0 0 1px rgba(255,255,255,0.2)',
          }}
          role="region"
          aria-label="Selection"
        >
          <button
            onClick={clearSelection}
            aria-label="Clear selection"
            className="w-12 lg:w-13 flex items-center justify-center border-r border-black/15 hover:bg-black hover:text-white transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-black"
            style={{ width: 52 }}
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
          <span className="lh-label font-bold flex items-center px-3.5 lg:px-5 tabular-nums flex-1 lg:flex-none whitespace-nowrap">
            {selN} Selected
          </span>
          <button
            onClick={() => (wide ? setPanelOpen(true) : (setSheetOpen(true), setSheetFull(false)))}
            className="lh-label flex items-center gap-2 px-3.5 lg:px-5 border-l border-black/15 hover:bg-black hover:text-white transition-colors cursor-pointer whitespace-nowrap outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-black"
          >
            Review
            <ChevronRight className="hidden lg:block w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            onClick={downloadSelection}
            aria-disabled={!!batchProgress}
            aria-busy={!!batchProgress}
            className="lh-label font-bold flex items-center gap-2 px-3.5 lg:px-5 border-l border-black/15 hover:bg-black hover:text-white transition-colors cursor-pointer whitespace-nowrap outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-black"
          >
            {batchProgress
              ? <Loader2 className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              : <Download className="w-3.5 h-3.5" aria-hidden="true" />}
            <span className="tabular-nums">
              {batchProgress
                ? `${batchProgress.done} / ${batchProgress.total}`
                : (wide ? `Download ${selN}` : selN)}
            </span>
          </button>
        </div>
      )}

      {/* ── Register — desktop side panel ── */}
      <Dialog
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        label={`Selection — ${selN}`}
        z={REGISTER_Z}
        alignClassName="items-stretch justify-end"
        className="p-0 lg:pl-[220px]"
        panelClassName="w-[380px] max-w-full h-full flex flex-col animate-in fade-in duration-200"
        panelStyle={{ background: SHEET_SURFACE, border: 'none', borderLeft: `1px solid ${HAIRLINE}` }}
      >
        <div className="px-6 pt-5 pb-4 border-b border-white/15 flex items-center justify-between gap-4 shrink-0">
          <h2 className="lh-display text-lg text-white m-0 truncate">Selection — {selN}</h2>
          <button
            onClick={() => setPanelOpen(false)}
            aria-label="Close selection"
            className="w-11 h-11 -mr-2.5 shrink-0 flex items-center justify-center text-white/60 hover:text-white transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar">
          {selN === 0 ? (
            <div className="text-center px-6 py-16">
              <div className="lh-display text-base text-white mb-2">Nothing Selected</div>
              <p className="lh-label text-white/60 leading-relaxed">Hover a plate and mark its corner check to hold it here</p>
            </div>
          ) : selected.map(wp => (
            <div key={wp.id} className="flex items-center gap-3 px-6 py-3 border-b border-white/10">
              <button
                onClick={() => openFromRegister(wp)}
                aria-label={`Open ${wp.gameName} ${wp.type}`}
                className="w-24 h-[54px] shrink-0 overflow-hidden bg-neutral-900 border border-white/15 hover:border-white transition-colors cursor-pointer p-0 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white"
              >
                <img src={tileUrl(wp)} alt="" className="w-full h-full object-cover block" loading="lazy" decoding="async" draggable={false} />
              </button>
              <div className="flex-1 min-w-0 overflow-hidden">
                <MarqueeText text={wp.gameName} className="lh-label text-white" />
                <div className="mt-1.5">
                  <MarqueeText text={metaOf(wp)} className="lh-label text-white/60" />
                </div>
              </div>
              <button
                onClick={() => toggleSelect(wp)}
                aria-label={`Remove ${wp.gameName} ${wp.type} from the selection`}
                className="w-11 h-11 shrink-0 flex items-center justify-center text-white/60 hover:bg-white hover:text-black transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>

        {selN > 0 && <RegisterFooter
          count={selN}
          batchProgress={batchProgress}
          onDownload={downloadSelection}
          onClear={clearSelection}
        />}
      </Dialog>

      {/* ── Register — mobile sheet, half height or nearly full ── */}
      <Dialog
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        label={`Selection — ${selN}`}
        z={REGISTER_Z}
        alignClassName="items-end"
        className="p-0"
        panelClassName="w-full max-w-none flex flex-col animate-in slide-in-from-bottom-4 motion-reduce:animate-none"
        panelStyle={{
          background: SHEET_SURFACE,
          border: 'none',
          borderTop: `1px solid ${HAIRLINE}`,
          /* 94%, but never past the status bar: on a notched phone 6% of the
             viewport is inside the inset, which would put the grip and the
             title under the system clock. */
          height: sheetFull ? 'min(94%, calc(100% - env(safe-area-inset-top, 0px) - 12px))' : '58%',
          /* Height, not transform, and measured rather than assumed: with 24
             plates held, both directions ran a 16.7ms median with a single
             66ms frame at the React commit — the animation itself holds 60fps,
             and that first frame costs the same whatever property moves.
             transform would push the pinned Download/Clear footer off-screen
             while collapsed, which is the one thing this sheet may not do. */
          transition: 'height 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div className="shrink-0">
          <div className="flex justify-center pt-3 pb-1" aria-hidden="true">
            <div className="w-10 h-0.5 bg-white/40" />
          </div>
          <div className="px-5 pt-2 pb-3.5 border-b border-white/15 flex items-center justify-between gap-2">
            <h2 className="lh-display text-lg text-white m-0 truncate">Selection — {selN}</h2>
            <div className="flex shrink-0">
              <button
                onClick={() => setSheetFull(f => !f)}
                aria-expanded={sheetFull}
                aria-label={sheetFull ? 'Collapse selection' : 'Expand selection'}
                className="w-11 h-11 flex items-center justify-center text-white/60 hover:text-white transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white"
              >
                {sheetFull
                  ? <ChevronDown className="w-4.5 h-4.5" aria-hidden="true" />
                  : <ChevronUp className="w-4.5 h-4.5" aria-hidden="true" />}
              </button>
              <button
                onClick={() => setSheetOpen(false)}
                aria-label="Close selection"
                className="w-11 h-11 -mr-2.5 flex items-center justify-center text-white/60 hover:text-white transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar p-4">
          {selN === 0 ? (
            <div className="text-center py-12">
              <div className="lh-display text-base text-white mb-2">Nothing Selected</div>
              <p className="lh-label text-white/60 leading-relaxed">Press and hold a plate to start a selection</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {selected.map(wp => (
                <div key={wp.id} className="relative min-w-0">
                  <button
                    onClick={() => openFromRegister(wp)}
                    aria-label={`Open ${wp.gameName} ${wp.type}`}
                    className="block w-full aspect-[16/10] overflow-hidden bg-neutral-900 border border-white/15 p-0 cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white"
                  >
                    <img src={tileUrl(wp)} alt="" className="w-full h-full object-cover block" loading="lazy" decoding="async" draggable={false} />
                  </button>
                  <button
                    onClick={() => toggleSelect(wp)}
                    aria-label={`Remove ${wp.gameName} ${wp.type} from the selection`}
                    className="absolute top-0 right-0 w-7 h-7 bg-black border-b border-l border-white/20 flex items-center justify-center text-white/70 hover:bg-white hover:text-black transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white"
                  >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  <div className="pt-1.5 overflow-hidden">
                    <MarqueeText text={wp.gameName} className="lh-label text-white" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {selN > 0 && <RegisterFooter
          count={selN}
          batchProgress={batchProgress}
          onDownload={downloadSelection}
          onClear={clearSelection}
          safeArea
        />}
      </Dialog>

      {/* ── Mobile viewer ──
          The plate owns the screen; the chrome fades on a tap. Portalled to
          <body> because nested in the page it inherited the route's own fade
          wrapper as a stacking context, and the mobile header at z-130 painted
          straight over the top. */}
      {active && !wide && createPortal(
        <div
          ref={previewRef}
          role="dialog"
          aria-modal="true"
          aria-label="Wallpaper preview"
          className="fixed inset-0 z-[150] bg-black select-none overscroll-contain"
        >
          <div
            ref={zoomAreaRef}
            className="absolute inset-0 flex items-center justify-center overflow-hidden"
            /* touchAction none, by hand and after any spread. useSwipe ships
               'pan-y' for a horizontal gesture, which hands every vertical drag
               to the browser; a pinch needs both axes AND the second pointer,
               so nothing here may be left to the default. */
            style={{ touchAction: 'none' }}
            /* Zoom is offered the pointer stream first. While it is pinching, or
               while the plate is already zoomed and the finger is panning it,
               paging and swipe-to-dismiss must not also run — otherwise
               inspecting a corner throws the picture away. */
            onPointerDown={(e) => {
              zoomBind.onPointerDown(e);
              if (zoomed || e.currentTarget.hasPointerCapture?.(e.pointerId)) {
                previewSwipe.onPointerCancel?.(e); rawDismissSwipe.onPointerCancel?.(e);
                return;
              }
              previewSwipe.onPointerDown?.(e); rawDismissSwipe.onPointerDown?.(e);
            }}
            onPointerMove={(e) => {
              zoomBind.onPointerMove(e);
              if (zoomGesturing) {
                previewSwipe.onPointerCancel?.(e); rawDismissSwipe.onPointerCancel?.(e);
                return;
              }
              previewSwipe.onPointerMove?.(e); rawDismissSwipe.onPointerMove?.(e);
            }}
            onPointerUp={(e) => {
              const busy = zoomGesturing;
              zoomBind.onPointerUp(e);
              if (busy) { previewSwipe.onPointerCancel?.(e); rawDismissSwipe.onPointerCancel?.(e); return; }
              previewSwipe.onPointerUp?.(e); rawDismissSwipe.onPointerUp?.(e);
            }}
            onPointerCancel={(e) => {
              zoomBind.onPointerCancel(e);
              previewSwipe.onPointerCancel?.(e); rawDismissSwipe.onPointerCancel?.(e);
            }}
            onClick={() => {
              if (swallowClickRef.current) { swallowClickRef.current = false; return; }
              if (consumeZoomClick()) return;   // the tap that ended a pinch or a pan
              setChromeShown(v => !v);
            }}
          >
            {/* The track. Neighbours are mounted either side and the whole
                strip moves, so a drag shows the next plate arriving rather than
                nothing happening until release. No enter animation here — the
                glide IS the transition, and a keyed remount would fight it. */}
            <div
              ref={trackRef}
              className="absolute inset-0 flex"
              style={{ transform: 'translate3d(-100%, 0, 0)' }}
            >
              {[-1, 0, 1].map(off => {
                const len = previewPool.length;
                // Wraps, because paging does: at the last plate the next pane is
                // the first, and a blank pane there would read as the end.
                const wp = len ? previewPool[(activePreviewIndex + off + len) % len] : null;
                const isCurrent = off === 0;
                return (
                  /* Keyed by ABSOLUTE index, not by offset. Keyed by offset,
                     React kept the same three <img> nodes forever and only
                     swapped their src — and an <img> goes on painting its old
                     bitmap until the new src decodes. Two quick swipes onto
                     plates that were not cached yet put the previous picture in
                     the centre pane, which then popped to the right one on load.
                     Measured: centre node reused, complete=false, naturalWidth
                     1565 — the element still holding the last image's pixels.
                     Absolute keys make React reuse the node for the plate that
                     genuinely carries over and build a fresh one for a plate it
                     has not rendered, so a pane can be empty but never wrong. */
                  <div key={activePreviewIndex + off} className="w-full h-full shrink-0 flex items-center justify-center">
                    {wp && (
                      <img
                        ref={isCurrent ? plateImgRef : undefined}
                        src={plateUrl(wp)}
                        alt={isCurrent ? `${wp.gameName} — ${wp.type}` : ''}
                        aria-hidden={!isCurrent}
                        draggable={false}
                        className="max-w-full max-h-full object-contain select-none motion-reduce:transition-none"
                        style={isCurrent ? zoomStyle : undefined}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Solid, not a scrim. The safe-area padding used to sit on this
              outer div while the gradient lived on the inner one, so the strip
              under the status bar was painted with nothing at all and the plate
              showed straight through the notification area; the gradient's own
              ends (90% and 92%) were see-through besides. index.html sets
              viewport-fit=cover, so this element genuinely owns those strips and
              has to paint them. Flat black with a hairline is also what the rest
              of the app does — DESIGN.md has no scrims, gradients or blur. */}
          <div
            className={`absolute inset-x-0 top-0 z-10 bg-black border-b border-white/15 transition-opacity duration-200 ${chromeShown ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            inert={!chromeShown}
            style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
          >
            <div className="pb-2 pt-2 px-2 flex items-center gap-1">
              {/* The mark sits with the name it marks. It was a fourth cell in
                  the bottom dock, four taps away from the thing it applied to
                  and competing with Save for the same thumb. */}
              <button
                onClick={() => toggleSelect(active)}
                aria-pressed={activeSelected}
                aria-label={`${activeSelected ? 'Deselect' : 'Select'} ${active.gameName} ${active.type}`}
                className="w-11 h-11 shrink-0 flex items-center justify-center cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white"
              >
                <span className={`w-5 h-5 flex items-center justify-center border-[1.5px] transition-colors ${
                  activeSelected ? 'border-white bg-white text-black' : 'border-white/70'
                }`}>
                  {activeSelected && <Check className="w-3 h-3" strokeWidth={3} aria-hidden="true" />}
                </span>
              </button>
              <div className="min-w-0 flex-1">
                <div className="lh-label text-white truncate">{active.gameName}</div>
                <div className="lh-label text-white/60 tabular-nums truncate mt-1">{metaOf(active)}</div>
              </div>
              <div className="lh-label text-white/60 tabular-nums shrink-0 px-2">
                {activePreviewIndex + 1} / {previewPool.length}
              </div>
              <button
                onClick={() => setActivePreviewIndex(-1)}
                aria-label="Close preview"
                className="w-11 h-11 shrink-0 flex items-center justify-center text-white cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Same fix at the bottom: the home-indicator strip was unpainted, so
              the dock read as transparent over a zoomed plate. */}
          <div
            className={`absolute inset-x-0 bottom-0 z-10 bg-black border-t border-white/15 transition-opacity duration-200 ${chromeShown ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            inert={!chromeShown}
            style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
          >
            <div className="pt-2">
              {/* The strip is how you get from one plate to a plate ten away
                  without ten swipes. */}
              <div className="flex items-center gap-[3px] px-2 pb-2 overflow-x-auto no-scrollbar">
                {film.map((it, i) => {
                  const idx = filmFrom + i;
                  const on = idx === activePreviewIndex;
                  return (
                    <button
                      key={it.id}
                      ref={on ? filmActiveRef : undefined}
                      onClick={() => jumpTo(idx)}
                      aria-label={`Plate ${idx + 1}, ${it.gameName}`}
                      aria-current={on}
                      className="h-11 shrink-0 overflow-hidden p-0 bg-neutral-900 cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white"
                      style={{
                        width: Math.max(44, Math.round(44 * it.aspect)),   // same floor, compact strip
                        opacity: on ? 1 : 0.45,
                        boxShadow: on ? 'inset 0 0 0 2px #ffffff' : 'none',
                      }}
                    >
                      <img src={tileUrl(it)} alt="" className="w-full h-full object-cover block" loading="lazy" decoding="async" draggable={false} />
                    </button>
                  );
                })}
              </div>
              <div className="flex items-stretch justify-around px-2 pb-2">
                <ViewerAction icon={Download} label="Save" onClick={() => downloadSingle(active)} />
                <ViewerAction icon={Info} label="Info" on={infoOpen} pressed={infoOpen} onClick={() => setInfoOpen(o => !o)} />
              </div>
            </div>
          </div>

          {/* Info sheet over the viewer */}
          {infoOpen && (
            <div className="absolute inset-0 z-20 flex items-end">
              <div className="absolute inset-0 bg-black/60" onClick={() => setInfoOpen(false)} aria-hidden="true" />
              <div
                className="relative w-full max-h-[70%] flex flex-col animate-in slide-in-from-bottom-4 motion-reduce:animate-none"
                style={{ background: SHEET_SURFACE, borderTop: `1px solid ${HAIRLINE}` }}
              >
                <div className="flex justify-center pt-3 pb-1 shrink-0" aria-hidden="true">
                  <div className="w-10 h-0.5 bg-white/40" />
                </div>
                <div className="flex-1 overflow-y-auto no-scrollbar px-5 pt-2 pb-5">
                  <div className="flex items-start justify-between gap-3 mb-3.5">
                    <div className="lh-display text-lg text-white">{active.gameName}</div>
                    <PlateMenu wp={active} onSearch={setSearchQuery} onSelectGame={queueAllFromGame} onDownload={downloadSingle} />
                  </div>
                  <FieldsTable fields={fields} />
                  {related.length > 0 && (
                    <>
                      <div className="lh-label text-white/60 mt-5 mb-2.5">More from this game</div>
                      <div className="grid grid-cols-3 gap-1">
                        {related.map(r => (
                          <button
                            key={r.id}
                            onClick={() => {
                              const i = previewPool.findIndex(p => p.id === r.id);
                              if (i >= 0) { setInfoOpen(false); jumpTo(i); }
                            }}
                            aria-label={`Open ${r.gameName} ${r.type}`}
                            className="aspect-[16/10] overflow-hidden bg-neutral-900 p-0 border border-white/10 hover:border-white transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white"
                          >
                            <img src={tileUrl(r)} alt="" className="w-full h-full object-cover block" loading="lazy" decoding="async" draggable={false} />
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>,
        document.body
      )}

      {/* ── Desktop lightbox ── */}
      {active && wide && createPortal(
        <div
          ref={previewRef}
          role="dialog"
          /* No aria-modal. The rail stays on screen and stays operable, so
             promising a modal would describe behaviour this dialog does not
             have — and claiming it is what made the trap inert the page. */
          aria-label="Wallpaper preview"
          /* Full width, over the rail — the plate gets the whole window.
             z-10000 is the app's existing COVER layer, not a number picked here:
             the rail is 220px of opaque black at z-[9999], so anything reaching
             into its strip from underneath gets its left edge sliced off, which
             is exactly what the game media lightbox did at 3000 before it moved
             to 10000. 9999 would tie, and equal z in one stacking context
             resolves by DOM order, which is luck rather than a decision.

             `top` still clears --titlebar-h: inside the desktop app that band is
             the window's own toolbar, and covering it would take the close and
             minimise buttons with it.

             Portalled to <body> for the same reason the phone viewer is: nested
             in the page it inherits the route's own fade wrapper as a stacking
             context, so the z here would be scoped inside that wrapper and the
             rail would still win. Measured before portalling — the plate's title
             was sliced off at x=220 by the rail sitting on top of it, which is
             the CLIPPED case scripts/verify_layers.mjs exists to catch. */
          className="flex fixed left-0 right-0 bottom-0 z-[10000] flex-col bg-black select-none"
          style={{
            top: 'calc(var(--mobile-nav-h, 0px) + var(--titlebar-h, 0px) + env(safe-area-inset-top, 0px))',
            height: 'calc(100vh - (var(--mobile-nav-h, 0px) + var(--titlebar-h, 0px) + env(safe-area-inset-top, 0px)))'
          }}
        >
          {/* Top bar */}
          <div className="h-14 shrink-0 border-b border-white/10 flex items-center justify-between gap-4 pl-6 pr-4">
            {/* The mark sits with the name it marks, the same as the phone.
                It was a bare check icon in the control cluster on the right,
                where an icon alone cannot say whether it is a state or an
                action — and it read as neither next to Download and Close. */}
            <div className="min-w-0 flex items-center gap-3">
              <button
                onClick={() => toggleSelect(active)}
                aria-pressed={activeSelected}
                aria-label={`${activeSelected ? 'Deselect' : 'Select'} ${active.gameName} ${active.type}`}
                className="w-10 h-10 -ml-2.5 shrink-0 flex items-center justify-center cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white group/mark"
              >
                <span className={`w-5 h-5 flex items-center justify-center border-[1.5px] transition-colors ${
                  activeSelected ? 'border-white bg-white text-black' : 'border-white/70 group-hover/mark:border-white'
                }`}>
                  {activeSelected && <Check className="w-3 h-3" strokeWidth={3} aria-hidden="true" />}
                </span>
              </button>
              <span className="lh-label text-white/60 tabular-nums shrink-0">
                {activePreviewIndex + 1} / {previewPool.length}
              </span>
              <span className="lh-display text-[15px] text-white truncate max-w-[360px]">{active.gameName}</span>
              <span className="lh-label text-white/60 tabular-nums shrink-0">{metaOf(active)}</span>
            </div>

            <div className="flex items-center shrink-0">
              <div className="flex border border-white/15 mr-3">
                {[{ v: 'none', label: 'Original' }, { v: 'desktop', label: 'Desktop' }, { v: 'mobile', label: 'Mobile' }].map((o, i) => (
                  <button
                    key={o.v}
                    onClick={() => { setPreviewDevice(o.v); resetZoom(); }}
                    aria-pressed={previewDevice === o.v}
                    className={`lh-label px-3 h-[34px] flex items-center whitespace-nowrap transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white ${
                      i < 2 ? 'border-r border-white/15' : ''
                    } ${previewDevice === o.v ? 'bg-white text-black font-bold' : 'text-white/60 hover:text-white'}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => downloadSingle(active)}
                aria-label="Download this plate"
                className="w-10 h-10 flex items-center justify-center text-white/60 hover:bg-white hover:text-black transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                onClick={() => setInfoOpen(o => !o)}
                aria-pressed={infoOpen}
                aria-label="Plate details"
                className={`w-10 h-10 flex items-center justify-center transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white ${
                  infoOpen ? 'bg-white text-black' : 'text-white/60 hover:bg-white hover:text-black'
                }`}
              >
                <Info className="w-4 h-4" aria-hidden="true" />
              </button>
              <PlateMenu wp={active} onSearch={setSearchQuery} onSelectGame={queueAllFromGame} onDownload={downloadSingle} />
              <button
                onClick={() => setActivePreviewIndex(-1)}
                aria-label="Close preview"
                className="w-10 h-10 ml-1 flex items-center justify-center text-white/60 hover:bg-white hover:text-black transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white"
              >
                <X className="w-[18px] h-[18px]" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Stage + info */}
          <div className="flex-1 flex min-h-0">
            <div
              ref={zoomAreaRef}
              className="flex-1 min-w-0 relative flex items-center justify-center overflow-hidden p-6"
              /* Only while zoomed: at rest the stage must leave pointer
                 behaviour alone so text selection and the steppers behave. */
              style={previewDevice === 'none' && zoomed ? { touchAction: 'none' } : undefined}
              {...(previewDevice === 'none' ? zoomBind : null)}
            >
              {previewDevice === 'none' && (
                /* Keyed on the image so React remounts it and the enter
                   animation replays; without the key it is the same element
                   with a new src and nothing moves. */
                <img
                  key={active.imageId}
                  draggable={false}
                  src={plateUrl(active)}
                  alt=""
                  ref={plateImgRef}
                  className={`max-w-full max-h-full object-contain select-none motion-reduce:transition-none ${previewDir > 0 ? 'wp-enter-right' : 'wp-enter-left'}`}
                  style={{ ...zoomStyle, cursor: zoomed ? (zoomGesturing ? 'grabbing' : 'grab') : 'default' }}
                />
              )}

              {previewDevice === 'desktop' && (
                <div className="flex flex-col items-center select-none max-h-full">
                  <div className="relative aspect-video w-[620px] max-w-full bg-black border border-white/70 overflow-hidden">
                    <img draggable={false} src={plateUrl(active)} alt="" className="w-full h-full object-cover select-none" />
                    <div className="absolute bottom-0 left-0 right-0 h-4 bg-black border-t border-white/30 flex items-center gap-1.5 px-2">
                      <div className="w-1.5 h-1.5 bg-white/50" />
                      <div className="w-10 h-1 bg-white/30" />
                    </div>
                  </div>
                  <div className="w-12 h-8 border-x border-b border-white/40" />
                  <div className="w-36 h-px bg-white/40" />
                </div>
              )}

              {previewDevice === 'mobile' && (
                <div className="relative w-[225px] aspect-[9/19.5] max-h-full border border-white/70 bg-black overflow-hidden">
                  <div className="absolute top-2 left-1/2 -translate-x-1/2 w-14 h-3 bg-black border border-white/30 z-20" />
                  <img draggable={false} src={plateUrl(active)} alt="" className="w-full h-full object-cover select-none" />
                  <div className="absolute inset-0 z-10 flex flex-col justify-between p-3 pointer-events-none text-white">
                    <div className="flex justify-between items-center lh-label">
                      <span>9:41</span>
                      <div className="w-2.5 h-2 bg-white/80" />
                    </div>
                    <div className="self-center w-20 h-0.5 bg-white/80" />
                  </div>
                </div>
              )}

              <button
                onClick={() => goWallpaper(-1)}
                aria-label="Previous wallpaper"
                className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center border border-white/20 bg-black/55 text-white hover:bg-white hover:text-black transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white"
              >
                <ChevronLeft className="w-[18px] h-[18px]" aria-hidden="true" />
              </button>
              <button
                onClick={() => goWallpaper(1)}
                aria-label="Next wallpaper"
                className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center border border-white/20 bg-black/55 text-white hover:bg-white hover:text-black transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white"
              >
                <ChevronRight className="w-[18px] h-[18px]" aria-hidden="true" />
              </button>
            </div>

            {infoOpen && (
              <div className="w-80 shrink-0 border-l border-white/15 overflow-y-auto no-scrollbar" style={{ background: SHEET_SURFACE }}>
                <div className="p-6">
                  <div className="lh-label text-white/60 mb-3">Plate</div>
                  <div className="lh-display text-xl text-white mb-5">{active.gameName}</div>
                  <FieldsTable fields={fields} />
                  {related.length > 0 && (
                    <>
                      <div className="lh-label text-white/60 mt-6 mb-3">More from this game</div>
                      <div className="grid grid-cols-3 gap-1">
                        {related.map(r => (
                          <button
                            key={r.id}
                            onClick={() => {
                              const i = previewPool.findIndex(p => p.id === r.id);
                              if (i >= 0) jumpTo(i);
                            }}
                            aria-label={`Open ${r.gameName} ${r.type}`}
                            className="aspect-[16/10] overflow-hidden bg-neutral-900 p-0 border border-white/10 hover:border-white transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white"
                          >
                            <img src={tileUrl(r)} alt="" className="w-full h-full object-cover block" loading="lazy" decoding="async" draggable={false} />
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Filmstrip */}
          <div className="h-[76px] shrink-0 border-t border-white/10 flex items-center gap-1 px-3 overflow-x-auto no-scrollbar">
            {film.map((it, i) => {
              const idx = filmFrom + i;
              const on = idx === activePreviewIndex;
              return (
                <button
                  key={it.id}
                  ref={on ? filmActiveRef : undefined}
                  onClick={() => jumpTo(idx)}
                  aria-label={`Plate ${idx + 1}, ${it.gameName}`}
                  aria-current={on}
                  className="h-14 shrink-0 overflow-hidden p-0 bg-neutral-900 cursor-pointer hover:opacity-100 transition-opacity outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white"
                  style={{
                    // A portrait plate measured 32px beside 100px landscapes. Floor it.
                    width: Math.max(56, Math.round(56 * it.aspect)),
                    opacity: on ? 1 : 0.45,
                    boxShadow: on ? 'inset 0 0 0 2px #ffffff' : 'none',
                  }}
                >
                  <img src={tileUrl(it)} alt="" className="w-full h-full object-cover block" loading="lazy" decoding="async" draggable={false} />
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

/* Download the lot, or drop it. The rule above the buttons is the batch
   walking — a twenty-plate run takes eight seconds and used to report nothing
   at all until it finished. */
function RegisterFooter({ count, batchProgress, onDownload, onClear, safeArea }) {
  return (
    <div
      className="border-t border-white/15 shrink-0"
      style={safeArea ? { paddingBottom: 'env(safe-area-inset-bottom, 0px)' } : undefined}
    >
      {batchProgress && (
        <div className="h-0.5 bg-white/15" aria-hidden="true">
          <div
            className="h-full bg-white transition-[width] duration-200"
            style={{ width: `${(batchProgress.done / batchProgress.total) * 100}%` }}
          />
        </div>
      )}
      <div className="flex">
        <button
          onClick={onDownload}
          aria-disabled={!!batchProgress}
          aria-busy={!!batchProgress}
          className="lh-label flex-[2] min-h-[56px] bg-white text-black hover:bg-black hover:text-white transition-colors cursor-pointer flex items-center justify-center gap-2 aria-disabled:cursor-wait outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-black aria-disabled:focus-visible:ring-white"
        >
          {batchProgress
            ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            : <Download className="w-4 h-4" aria-hidden="true" />}
          <span className="tabular-nums">
            {batchProgress ? `Saving — ${batchProgress.done} / ${batchProgress.total}` : `Download All — ${count}`}
          </span>
        </button>
        <button
          onClick={onClear}
          className="lh-label flex-1 min-h-[56px] border-l border-white/15 text-white/60 hover:bg-white hover:text-black transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

function FieldsTable({ fields }) {
  return (
    <div>
      {fields.map(f => (
        <div key={f.k} className="flex justify-between gap-4 py-2.5 border-t border-white/10">
          <span className="lh-label text-white/60">{f.k}</span>
          <span className="lh-label text-white tabular-nums text-right">{f.v}</span>
        </div>
      ))}
    </div>
  );
}

function ViewerAction({ icon: Icon, label, on, pressed, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={pressed}
      className={`flex-1 min-h-[52px] flex flex-col items-center justify-center gap-1.5 cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white ${
        on ? 'text-white' : 'text-white/60'
      }`}
    >
      <Icon className="w-[18px] h-[18px]" aria-hidden="true" />
      <span className="lh-label">{label}</span>
    </button>
  );
}

/* Everything the plate can do that is not one of the four the viewer names.
   The comp has no such menu; these are existing routes and actions the page
   has always carried, given the comp's own icon-cell shape rather than
   dropped on the floor. */
function PlateMenu({ wp, onSearch, onSelectGame, onDownload }) {
  const navigate = useNavigate();

  const copyImageUrl = useCallback(() => {
    navigator.clipboard.writeText(plateUrl(wp))
      .then(() => toast('Copied image link to clipboard'))
      .catch(() => toast('Failed to copy link'));
  }, [wp]);

  const options = useMemo(() => [
    { label: 'View Game', icon: ExternalLink, onClick: () => navigate(`/game/${wp.gameId}`) },
    { label: 'Only this game', icon: Search, onClick: () => onSearch(wp.gameName) },
    { label: 'Select all from game', icon: ListPlus, onClick: () => onSelectGame(wp.gameName) },
    { label: 'Copy image link', icon: Copy, onClick: copyImageUrl },
    { label: 'Download image', icon: Download, onClick: () => onDownload(wp), dividerAbove: true },
  ], [wp, navigate, onSearch, onSelectGame, onDownload, copyImageUrl]);

  return (
    <DropdownMenu options={options} align="right" menuWidth={220} fullHeight>
      <button
        aria-label={`More options for ${wp.gameName}`}
        className="w-10 h-10 flex items-center justify-center text-white/60 hover:bg-white hover:text-black transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white"
      >
        <MoreVertical className="w-4 h-4" aria-hidden="true" />
      </button>
    </DropdownMenu>
  );
}
