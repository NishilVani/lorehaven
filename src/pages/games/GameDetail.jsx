import PageHeader from '../../components/ui/PageHeader';
import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import EmptyPlate from '../../components/ui/EmptyPlate';
import { useParams, useNavigate, Link } from 'react-router-dom';
import useSwipe from '../../hooks/useSwipe';
import { Play } from 'lucide-react';
import { getGameById, getGamesByIds, getGamesProfile, getFranchisesByIds, getCollectionsByIds, getEventsByGameId } from '../../services/igdb';
import { buildTaste, eraBonus, isScenicArtwork } from '../../services/discover';
import { reasonsFor } from '../../services/pickNext';
import {
  getLibrary, getPrefs, saveToLibrary, removeFromLibrary, getUserOwnedPlatforms, getUserCustomPlatforms,
  getCollections, getCollectionsWithGame, addGameToCollection, removeGameFromCollection,
} from '../../services/db';
import { toDateInputValue, readNoteDraft, writeNoteDraft, clearNoteDraft } from '../../services/libraryFields';
import { getShortPlatformName } from '../../components/platforms/platformLogoUtils';
import { toast } from '../../components/ui/toastBus';
import { Skeleton } from '../../components/ui/Skeleton';
import AwardsSection from '../../components/GameDetail/AwardsSection';
import Dialog from '../../components/ui/Dialog';
import { statusColor, priorityColor, PRIORITIES as PRIORITY_KEYS, feelColor, FEELS as FEEL_KEYS } from '../../constants/stateColors';
import useConfirm from '../../hooks/useConfirm';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import PlatformSection from '../../components/games/PlatformSection';
import { platKey, normalizePlat } from '../../services/platformMatch';

/* ── Colored state scales — the sanctioned color exception (status / priority / rating) ── */
const STATUSES = ['Playing', 'Backlog', 'Wishlist', 'Beaten', 'Dropped']
  .map(key => ({ key, color: statusColor(key) }));

const PRIORITIES = PRIORITY_KEYS.map(key => ({ key, color: priorityColor(key) }));

const FEELS = FEEL_KEYS.map(key => ({ key, color: feelColor(key) }));

const img = (id, size) => `https://images.igdb.com/igdb/image/upload/t_${size}/${id}.jpg`;

/* Pick the most scenic wide image for the hero: artworks and screenshots compete,
   transparent and non-scenic artwork is excluded, closest-to-16:9 (then sharpest) wins.
   The type test used to name 5 and 6 and let 7 through, which is the same hole
   the Explore hero had: "Game logo (color)" is as much a wordmark as the white
   and black ones. isScenicArtwork allows the four scenic types instead of
   listing the bad ones, so a new logo variant is excluded by default. */
const pickHeroImage = (game) => {
  const candidates = [
    ...(game.artworks || []).filter(a => !a.alpha_channel && isScenicArtwork(a)),
    ...(game.screenshots || []),
  ].filter(c => c.image_id);
  if (candidates.length === 0) return null;
  const TARGET = 16 / 9;
  const score = (c) => {
    const w = c.width || 1280;
    const h = c.height || 720;
    return -Math.abs(w / h - TARGET) + Math.min(w, 3840) / 100000;
  };
  return candidates.reduce((best, c) => (score(c) > score(best) ? c : best)).image_id;
};

/* Below this many ratings the score is noise, and IGDB blends critic and user
   scores so a handful of either can swing it twenty points. The page used to
   print `78 / 100` from four votes in the same type it printed it from forty
   thousand — a confident number the data does not support, which is the same
   failure as a chart drawing a zero for a bucket it never managed to count. */
const RATING_FLOOR = 30;

/* Below this many shelved games with IGDB profiles there is no taste model worth
   the name — a handful of entries makes every theme look like a favourite. The
   page says it has too little to go on rather than asserting a fit it cannot
   support. */
const TASTE_FLOOR = 10;

/** The public score with the confidence behind it, or an honest refusal. */
function ratingRead(game) {
  const count = game.total_rating_count || 0;
  if (game.total_rating && count >= RATING_FLOOR) {
    return `${Math.round(game.total_rating)} / 100 · ${count.toLocaleString()} ratings`;
  }
  if (count > 0) return `Too few ratings to say · ${count}`;
  return null;
}

/* ── Small editorial primitives ── */
function SectionHeader({ children }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <h2 className="lh-display text-[22px] lg:text-[28px] text-white/80 m-0">{children}</h2>
      <div className="flex-1 h-px bg-white/15" />
    </div>
  );
}

function IndexRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-6 px-3 py-2.5 border-t first:border-t-0 border-white/10">
      <span className="lh-label text-white/60 shrink-0">{label}</span>
      <span className="text-sm text-white text-right min-w-0">{value}</span>
    </div>
  );
}

/* Index row whose values link out — genres, companies, franchises, events… */
function IndexLinks({ label, items }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="flex items-baseline justify-between gap-6 px-3 py-2.5 border-t first:border-t-0 border-white/10">
      <span className="lh-label text-white/60 shrink-0">{label}</span>
      <span className="text-sm text-right min-w-0">
        {items.map((it, i) => (
          <span key={`${it.id ?? it.label}-${i}`}>
            {i > 0 && <span className="text-white/50"> · </span>}
            {/* p-1 -m-1 lifts the hit box from 18px to 26px in BOTH axes (WCAG 2.5.8)
                without moving the row: padding on an inline box grows the target and
                the hover fill, and the negative margin cancels the layout effect. The
                same trick is used on the Back button and Discover's See-All links.
                Both axes are needed — short platform abbreviations like "PC" were
                18px WIDE, so vertical padding alone still failed. */}
            <Link
              to={it.to}
              className="text-white underline decoration-white/30 underline-offset-4 p-1 -m-1 hover:bg-white hover:text-black hover:decoration-transparent focus-visible:bg-white focus-visible:text-black focus-visible:decoration-transparent focus-visible:outline-none transition-colors"
            >
              {it.label}
            </Link>
          </span>
        ))}
      </span>
    </div>
  );
}

/* Mobile: one colored selector cell in a horizontal strip */
/* `group` matters: this same cell renders the status, priority AND rating strips, so
   a hardcoded "Set status to" announced "Set status to Perfection" on the rating row. */
/* `activeLabel` overrides the name when the cell is already set, because the
   status cells stop being "set X" once they are active — they remove the game. */
function StripCell({ label, color, active, onClick, group = 'status', activeLabel }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      aria-label={active && activeLabel ? `${label} — ${activeLabel}` : `Set ${group} to ${label}`}
      /* Each cell draws its own right and bottom rule; the container draws only top
         and left. That way the 1px grid stays exact however the row wraps, with no
         doubled edge and no missing divider between rows. */
      className="flex items-center gap-2 px-3.5 py-2.5 border-r border-b border-white/15 whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white focus-visible:z-10"
      style={active ? { backgroundColor: color, color: '#000000' } : {}}
    >
      <span className="w-2 h-2 shrink-0 pointer-events-none" style={{ backgroundColor: active ? '#000000' : color }} />
      <span className={`lh-label pointer-events-none ${active ? '' : 'text-white/60'}`}>{label}</span>
    </button>
  );
}

/* Mobile: compact label/value fact next to the poster */
function Fact({ label, value }) {
  if (!value) return null;
  return (
    <div>
      <div className="lh-label text-white/60">{label}</div>
      <div className="text-sm text-white mt-0.5">{value}</div>
    </div>
  );
}

/* One colored selector row — used by status, priority and rating stacks */
function StateRow({ label, color, active, onClick, group = 'status', activeLabel }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      aria-label={active && activeLabel ? `${label} — ${activeLabel}` : `Set ${group} to ${label}`}
      className="flex items-center justify-between w-full px-3 py-2.5 border-t first:border-t-0 border-white/10 hover:bg-white/5 transition-colors cursor-pointer group focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white focus-visible:z-10"
      style={active ? { backgroundColor: color, color: '#000000' } : {}}
    >
      <span className="flex items-center gap-2.5 pointer-events-none">
        <span className="w-2 h-2 shrink-0" style={{ backgroundColor: active ? '#000000' : color }} />
        <span className={`lh-label ${active ? '' : 'text-white/60 group-hover:text-white group-focus-visible:text-white transition-colors'}`}>{label}</span>
      </span>
      {/* The slot says what a click does. On an active status row that is
          "Remove"; on an active priority or rating row it is "Clear", because
          re-clicking those clears the value. The row previously read "Playing | Set" while its
          accessible name read "Remove ... from library", which is both an affordance
          lie and a WCAG 2.5.3 Label-in-Name failure (voice control saying "click
          Playing" could not reach it). */}
      {active && <span className="lh-label pointer-events-none">{group === 'status' ? 'Remove' : 'Clear'}</span>}
    </button>
  );
}

export default function GameDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [libEntry, setLibEntry] = useState(null);
  const [notes, setNotes] = useState('');
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setGame(null);
    setLoadError(null);
    (async () => {
      let data;
      try {
        data = await getGameById(id);
      } catch (err) {
        // A failed lookup is not an unknown id, and the page used to say it was.
        if (cancelled) return;
        setLoadError(err);
        setLoading(false);
        return;
      }
      if (cancelled) return;
      setGame(data?.[0] || null);
      const entry = getLibrary().find(g => String(g.id) === String(id)) || null;
      setLibEntry(entry);
      /* An unsaved draft outranks the saved copy, because it is the newer of the
         two and it is the one the user was in the middle of writing. */
      const draft = readNoteDraft(id);
      setNotes(draft ?? (entry?.notes || ''));
      if (draft != null) toast('Restored an unsaved draft of your notes', 'info');
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  /* Date.now() is impure and cannot be called during render. The released/unreleased
     boundary only has to hold for the life of this page, so the clock is read once
     on mount and every comparison is made against that fixed instant. */
  const [nowMs] = useState(() => Date.now());
  const isUnreleased = game?.first_release_date ? game.first_release_date * 1000 > nowMs : !game?.first_release_date;

  const derived = useMemo(() => {
    if (!game) return {};
    const devCo = game.involved_companies?.find(c => c.developer)?.company || null;
    const pubCo = game.involved_companies?.find(c => c.publisher)?.company || null;
    const heroId = pickHeroImage(game);
    const year = game.first_release_date ? new Date(game.first_release_date * 1000).getFullYear() : null;
    const released = game.first_release_date
      ? new Date(game.first_release_date * 1000).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })
      : null;
    const ttb = game.game_time_to_beat || {};
    const hours = (s) => `${Math.round(s / 3600)}h`;
    const ttbAll = [
      ttb.hastily && `${hours(ttb.hastily)} Rushed`,
      ttb.normally && `${hours(ttb.normally)} Normal`,
      ttb.completely && `${hours(ttb.completely)} Complete`,
    ].filter(Boolean).join(' · ') || null;
    const companyLink = (co) => co ? [{ id: co.id, label: co.name, to: `/games/company/${co.id}` }] : [];
    return {
      dev: devCo?.name || null, heroId, year, released, ttbAll,
      genres: game.genres?.map(g => g.name).join(', ') || null,
      devLink: companyLink(devCo),
      pubLink: companyLink(pubCo),
      genreLinks: game.genres?.map(g => ({ id: g.id, label: g.name, to: `/games/genre/${g.id}` })) || [],
      platformLinks: game.platforms?.map(p => ({ id: p.id, label: p.abbreviation || p.name, to: `/games/platform/${p.id}` })) || [],
      modeLinks: game.game_modes?.map(m => ({ id: m.id, label: m.name, to: `/games/mode/${m.id}` })) || [],
      engineLinks: game.game_engines?.map(e => ({ id: e.id, label: e.name, to: `/games/engine/${e.id}` })) || [],
      rating: ratingRead(game),
      media: [
        ...(game.videos?.filter(v => v.video_id).slice(0, 6) || []).map(v => ({ type: 'video', id: v.video_id, name: v.name })),
        ...(game.screenshots?.slice(0, 12) || []).map(s => ({ type: 'image', id: s.image_id })),
        // Artwork & concept art — everything except transparent logo plates
        ...(game.artworks?.filter(a => !a.alpha_channel).slice(0, 10) || []).map(a => ({ type: 'image', id: a.image_id })),
      ],
    };
  }, [game]);

  /* ── Shelf context — how this game sits against what you already own ──
     A library entry stores only id, name and cover, so "you already have three
     by this studio" is not a local read: the studio and franchise of your own
     games live in IGDB. getGamesByIds carries exactly what is needed — studios,
     franchises and time-to-beat — for many ids in one request, and keeps its own
     persistent cache that the Library page has usually already warmed.

     Deferred by a tick rather than called from the effect body: three effects in
     this file already trip the project's cascading-render lint and a fourth is
     not the way to pay that down. */
  const [shelf, setShelf] = useState(null);
  useEffect(() => {
    if (!game?.id) return;
    let alive = true;
    const t = setTimeout(async () => {
      const lib = getLibrary().filter(e => !e.is_custom && !String(e.id).startsWith('custom_'));
      const ids = lib.map(e => e.id);
      /* Two shapes, two calls, both cached. getGamesByIds carries studios,
         franchises and time-to-beat; getGamesProfile carries the theme and mode
         IDS that buildTaste keys on, which the first one does not return. */
      const [profiles, taste] = ids.length
        ? await Promise.all([
            getGamesByIds(ids).catch(() => []),
            getGamesProfile(ids).catch(() => []),
          ])
        : [[], []];
      if (alive) setShelf({ lib, profiles, taste });
    }, 0);
    return () => { alive = false; clearTimeout(t); };
  }, [game?.id]);

  /* ── Connections — franchise / collections / events ── */
  const [connections, setConnections] = useState({ franchises: [], collections: [], events: [] });
  useEffect(() => {
    if (!game) return;
    let cancelled = false;
    (async () => {
      const [franchises, collections, events] = await Promise.all([
        game.franchises?.length ? getFranchisesByIds(game.franchises).catch(() => []) : [],
        game.collections?.length ? getCollectionsByIds(game.collections).catch(() => []) : [],
        getEventsByGameId(game.id).catch(() => []),
      ]);
      if (!cancelled) {
        setConnections({
          franchises: franchises || [],
          collections: collections || [],
          events: (events || []).slice(0, 4),
        });
      }
    })();
    return () => { cancelled = true; };
  }, [game]);

  /* ── The read and the cost ──────────────────────────────────────────────
     The two questions anyone actually brings to this page: what do I already
     own of this game's neighbours, and what will it cost me against the games
     already queued ahead of it. Both are answered from the shelf context above.

     Every line here is counted from your own library or IGDB's own numbers.
     Where there is nothing true to say, the line is absent rather than hedged. */
  const verdict = useMemo(() => {
    if (!game || !shelf) return null;
    const { lib, profiles, taste } = shelf;
    const byId = new Map(profiles.map(pr => [String(pr.id), pr]));
    const others = lib.filter(e => String(e.id) !== String(game.id));

    const tally = (arr) => {
      const beaten = arr.filter(e => e.status === 'Beaten').length;
      const unplayed = arr.filter(e => e.status === 'Backlog' || e.status === 'Wishlist').length;
      const parts = [];
      if (beaten) parts.push(`${beaten} beaten`);
      if (unplayed) parts.push(`${unplayed} unplayed`);
      return parts.join(', ');
    };

    /* Studio and franchise are matched by NAME. getGameById returns company and
       franchise names without ids, and getGamesByIds returns the same shape, so
       names are the only key both sides share. */
    const studio = derived?.dev || null;
    const sameStudio = studio ? others.filter(e => {
      const pr = byId.get(String(e.id));
      return (pr?.involved_companies || []).some(c => c.developer && c.company?.name === studio);
    }) : [];

    const fNames = new Set(connections.franchises.map(f => f.name).filter(Boolean));
    const sameFranchise = fNames.size ? others.filter(e => {
      const pr = byId.get(String(e.id));
      return (pr?.franchises || []).some(f => fNames.has(f.name));
    }) : [];

    const neighbours = [];
    if (lib.length === 0) {
      /* Nothing shelved yet. "Nothing else by Rockstar North on your shelves" is
         true and useless on day one — it reads as a reproach rather than a fact.
         The rating and length lines still stand on their own. */
    } else if (sameStudio.length) {
      neighbours.push(`${sameStudio.length} more by ${studio}${tally(sameStudio) ? ` — ${tally(sameStudio)}` : ''}`);
    } else if (studio) {
      neighbours.push(`Nothing else by ${studio} on your shelves`);
    }
    if (lib.length && sameFranchise.length) {
      neighbours.push(`${sameFranchise.length} more from this franchise${tally(sameFranchise) ? ` — ${tally(sameFranchise)}` : ''}`);
    }

    /* The cost, against the games actually competing with it — Next Up and Soon,
       not the whole library. Comparing a 40-hour game to a shelf of 300 says
       nothing; comparing it to the four you meant to play next says everything. */
    const hrs = (sec) => Math.round(sec / 3600);
    const mine = game.game_time_to_beat?.normally ? hrs(game.game_time_to_beat.normally) : null;
    const queue = others
      .filter(e => e.priority === 'Next Up' || e.priority === 'Soon')
      .map(e => byId.get(String(e.id))?.game_time_to_beat?.normally)
      .filter(Boolean)
      .map(hrs)
      .sort((a, b) => a - b);

    let against = null;
    /* Three is the floor for saying anything comparative. Below that "longer
       than anything queued" is a statement about one or two games, dressed up
       as a statement about your backlog. */
    if (mine && queue.length >= 3) {
      const median = queue[Math.floor(queue.length / 2)];
      if (mine > queue[queue.length - 1]) against = 'Longer than anything queued ahead of it';
      else if (mine < queue[0]) against = 'Shorter than anything queued ahead of it';
      else against = `About ${median}h a game, typically`;
    }

    /* ── Taste, in the app's own words ──────────────────────────────────
       buildTaste and reasonsFor are the same functions Pick For Me and Explore
       use, called with the same shapes, so the three surfaces cannot disagree
       about what you like or phrase it differently. The scoring mirrors
       pickNext's: themes and modes normalised against your most-played, studio
       weighted highest, franchise a flat hit.

       No composite score is rendered. The number these terms feed is a RANKING
       signal — meaningful only against the other games scored in the same pass
       — so dressing it up as "87% match" would be inventing a precision the
       model does not have. Reasons, or nothing. */
    const contributing = taste.filter(pr => byId.has(String(pr.id)));
    let fit;
    if (contributing.length < TASTE_FLOOR) {
      fit = { thin: true };
    } else {
      const model = buildTaste(contributing, new Map(lib.map(e => [String(e.id), e])));
      const norm = (counts) => {
        const max = Math.max(1, ...Object.values(counts));
        return (id) => (counts[id] || 0) / max;
      };
      const tW = norm(model.themes), mW = norm(model.modes), cW = norm(model.companies);
      const topFranchises = new Set(Object.entries(model.franchises)
        .sort((a, z) => z[1] - a[1]).slice(0, 12).map(([k]) => Number(k)));
      const themeSim = (game.themes || []).reduce((acc, x) => acc + tW(x.id), 0);
      const modeSim = (game.game_modes || []).reduce((acc, x) => acc + mW(x.id), 0);
      const studioW = Math.max(0, ...(game.involved_companies || []).map(c => cW(c.company?.id)), 0);
      const franchiseHit = (game.franchises || []).some(f => topFranchises.has(f.id ?? f)) ? 1 : 0;
      const prefs = getPrefs();
      const parts = {
        themeSim, studio: studioW, franchiseHit,
        sim: themeSim * 2 + modeSim * 0.5 + studioW * 4 + franchiseHit * 5,
        /* Held below reasonsFor's threshold on purpose. It would otherwise emit
           "Very well reviewed", which is not a taste reason and would sit
           directly above the Rated row saying the same thing with a number
           behind it. Pick For Me has no Rated row, so it keeps that reason. */
        rating: 0,
        eraHit: eraBonus({ first_release_date: game.first_release_date }, prefs.releaseEra) > 0,
      };
      fit = { reasons: reasonsFor(parts, prefs) };
    }

    return { neighbours, mine, against, fit, empty: lib.length === 0 };
  }, [game, shelf, derived, connections]);

  /* ── Media — one stage, one thumbnail strip ── */
  const stripRef = useRef(null);
  const [mediaIdx, setMediaIdx] = useState(0);
  const [mediaModalOpen, setMediaModalOpen] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  useEffect(() => { setMediaIdx(0); setVideoPlaying(false); setMediaModalOpen(false); }, [game]);

  /* ── Library actions ── */
  const persist = useCallback((changes) => {
    const base = libEntry || {
      id: game.id,
      name: game.name,
      is_custom: false,
      cover_id: game.cover?.image_id || null,
      cover_width: game.cover?.width || null,
      cover_height: game.cover?.height || null,
    };
    const updated = { ...base, ...changes };
    saveToLibrary(updated);
    setLibEntry(updated);
    return updated;
  }, [libEntry, game]);

  const handleStatus = (status) => {
    /* Re-clicking the status you are already on removes the game, matching the
       Unreleased row below and the toggle-off that priority and rating already
       have. handleRemove confirms first — this destroys notes, rating, priority
       and the completion date with no undo. */
    if (libEntry?.status === status) return handleRemove();
    /* Beaten keeps its priority; leaving Beaten still drops the completion date.
       v1 cleared the priority here, and GameCard had already decided otherwise —
       it suppresses the planning badge on a finished game while keeping the
       value, and says so at GameCard.jsx:356: "The data is kept, not cleared, so
       moving the game back to Backlog restores the priority intact." Only this
       path ever cleared it, so the two disagreed and this one won.

       What that cost: the priority is what you thought BEFORE playing and the
       feel is what you thought after, so the pair is the only thing in the
       library that can say whether your anticipation predicts your enjoyment —
       and it was being destroyed at the exact moment the second half arrived.
       2 of 66 Beaten entries still carry one, both from before this path
       existed. Nothing reads priority on a Beaten game: the shelf offers no
       priority sort or group (Library.jsx:108) and the card suppresses the
       badge, so keeping it is invisible until something asks for it. */
    persist(status === 'Beaten' ? { status } : { status, dateCompleted: null });
    toast(`Moved to ${status}`);
  };

  const handleDate = (dateCompleted) => {
    /* Refuse to clear a date the field never managed to show.
       The input renders '' for any value it cannot parse, and an empty input
       reports '' on change — so before the stored value was normalised, opening
       this field on an ISO timestamp and touching it wrote null over a real
       date. The normaliser in db.js means that should no longer happen, but this
       is the guard that makes the loss impossible rather than unlikely: a clear
       only counts when there was something on screen to clear. */
    if (!dateCompleted && libEntry?.dateCompleted && !toDateInputValue(libEntry.dateCompleted)) {
      toast('That completion date is in a format this field cannot show, so it was left alone', 'info');
      return;
    }
    persist({ dateCompleted: dateCompleted || null });
    toast(dateCompleted ? 'Completion date updated' : 'Completion date cleared');
  };

  const notesDirty = notes !== (libEntry?.notes || '');
  /* Keep the draft on disk while it differs from what is saved.
     A navigation guard was the obvious fix and it is not available: useBlocker
     needs a data router and this app mounts the component <BrowserRouter>, so it
     throws. Persisting is the better answer anyway — a blocker only catches the
     exits it is attached to, and this text was reachable by four others. The tab
     can close, the process can die, and App.jsx remounts every route except
     /import when a sync lands, which no blocker would ever see. Nothing to
     dismiss, and nothing lost. */
  useEffect(() => {
    if (loading) return;
    if (notesDirty) writeNoteDraft(id, notes);
    else clearNoteDraft(id);
  }, [notes, notesDirty, id, loading]);

  const handleSaveNotes = () => {
    persist({ notes });
    clearNoteDraft(id);
    toast(libEntry?.status === 'Beaten' ? 'Review saved' : 'Notes saved');
  };

  const handlePriority = (priority) => {
    const next = libEntry?.priority === priority ? null : priority;
    persist({ priority: next });
    toast(next ? `Priority: ${next}` : 'Priority cleared');
  };

  const handleFeel = (feel) => {
    const next = libEntry?.feel === feel ? null : feel;
    persist({ feel: next });
    toast(next ? `Rated: ${next}` : 'Rating cleared');
  };

  const [confirm, confirmProps] = useConfirm();

  const handleRemove = () => confirm(
    { eyebrow: 'Library', title: `Remove ${game.name}?`, body: 'Its status, rating, priority, notes and completion date go with it. There is no undo.', confirmLabel: 'Remove' },
    () => {
      removeFromLibrary(game.id);
      setLibEntry(null);
      toast('Removed from library');
    },
  );

  /* ── Per-game platform links (user_platforms) ── */
  const selectedPlatKeys = useMemo(
    () => new Set((libEntry?.user_platforms || []).map(platKey)),
    [libEntry]
  );

  /* Every platform the user has, in one list: configured hardware, their stores
     and subscriptions, and anything already linked on this entry. Splitting it
     against the game is platformMatch's job, not this page's. */
  const userPlatforms = useMemo(() => {
    const seen = new Set();
    return [
      ...getUserOwnedPlatforms(),
      ...getUserCustomPlatforms(),
      ...(libEntry?.user_platforms || []),
    ].map(normalizePlat).filter(p => {
      const k = platKey(p);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [libEntry]);

  const togglePlatform = (plat) => {
    const k = platKey(plat);
    const current = libEntry?.user_platforms || [];
    const next = selectedPlatKeys.has(k)
      ? current.filter(p => platKey(p) !== k)
      : [...current, normalizePlat(plat)];

    if (!libEntry) {
      const status = isUnreleased ? 'Unreleased' : 'Backlog';
      persist({ status, user_platforms: next });
      toast(`Added to ${status} and linked ${getShortPlatformName(plat)}`);
    } else {
      persist({ user_platforms: next });
      toast(selectedPlatKeys.has(k) ? `Unlinked ${getShortPlatformName(plat)}` : `Linked ${getShortPlatformName(plat)}`);
    }
  };

  /* ── Custom collections — toggle this game in/out ── */
  const [myCollections, setMyCollections] = useState([]);
  const [inCollections, setInCollections] = useState(new Set());
  useEffect(() => {
    if (!game) return;
    setMyCollections(getCollections());
    setInCollections(new Set(getCollectionsWithGame(game.id).map(String)));
  }, [game]);

  const toggleCollection = (col) => {
    const key = String(col.id);
    if (inCollections.has(key)) {
      removeGameFromCollection(col.id, game.id);
      setInCollections(prev => { const n = new Set(prev); n.delete(key); return n; });
      toast(`Removed from "${col.name}"`);
    } else {
      addGameToCollection(col.id, game.id);
      setInCollections(prev => new Set(prev).add(key));
      toast(`Added to "${col.name}"`);
    }
  };

  /* ── Completion date — Beaten only (rendered in rail + mobile controls) ── */
  const completedBlock = libEntry?.status === 'Beaten' && (
    <div>
      <label htmlFor="completed-date-input" className="lh-label text-white/60 mb-2 block">Completed On</label>
      <input
        id="completed-date-input"
        type="date"
        aria-label="Completion Date"
        value={libEntry.dateCompleted || ''}
        onChange={(e) => handleDate(e.target.value)}
        className="w-full bg-black border border-white/40 px-3 py-2.5 lh-label text-white [color-scheme:dark] focus:border-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white cursor-pointer"
      />
    </div>
  );

  const collectionsBlock = myCollections.length > 0 && (
    <div>
      <div className="lh-label text-white/60 mb-2">Collections</div>
      <div className="border border-white/15 flex flex-col">
        {myCollections.map((c, i) => {
          const active = inCollections.has(String(c.id));
          return (
            <button
              key={`${c.id}-${i}`}
              onClick={() => toggleCollection(c)}
              aria-label={`${active ? 'Remove from' : 'Add to'} collection ${c.name}`}
              className={`flex items-center justify-between gap-2 w-full px-3 py-2.5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white focus-visible:z-10 ${i > 0 ? 'border-t border-white/10' : ''} ${active ? 'bg-white text-black' : 'text-white/60 hover:text-white'
                }`}
            >
              <span className="lh-label truncate pointer-events-none">{c.name}</span>
              {active && <span className="lh-label shrink-0 pointer-events-none">Added</span>}
            </button>
          );
        })}
      </div>
    </div>
  );

  /* Media lightbox — top-level. Previously nested inside collectionsBlock, which
     gated it behind `myCollections.length > 0` AND the desktop-only right rail,
     so it never opened for users without collections or on mobile. */
  /* Lightbox navigation. Clamped rather than wrapping: the header shows "3 / 12",
     so jumping from the last item back to the first contradicts what the counter
     just told you. */
  const mediaCount = derived.media?.length ?? 0;
  const goMedia = useCallback((step) => {
    setVideoPlaying(false);
    setMediaIdx(i => Math.max(0, Math.min(mediaCount - 1, i + step)));
  }, [mediaCount]);

  /* Track movement is written straight to the node, never through state.
     Rendering this page per pointermove is the same mistake that made the
     library drag cost a 57ms frame; a transform is presentation, so it belongs
     on the element. */
  const mediaTrackRef = useRef(null);
  const REST = 'translate3d(-100%, 0, 0)';
  const GLIDE = 'transform 300ms cubic-bezier(0.23, 1, 0.32, 1)';
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const settleTrack = useCallback((el) => {
    el.style.transition = GLIDE;
    el.style.transform = REST;
  }, [GLIDE, REST]);

  /* Commit carries the strip the rest of the way and then only changes the
     index. It must NOT reset the offset itself.
     Resetting here synchronously flashed the previous image for a frame: the
     transform snapped back to rest while React had not yet swapped the panes,
     so rest still pointed at the item you had just swiped away. The reset
     belongs after the panes change and before the browser paints — see the
     layout effect below. */
  const slideTo = useCallback((step) => {
    const el = mediaTrackRef.current;
    if (!el) return;
    if (!derived.media?.[mediaIdx + step]) return settleTrack(el);   // at an end
    if (reduceMotion()) { goMedia(step); return; }

    const done = () => {
      el.removeEventListener('transitionend', done);
      goMedia(step);
    };
    el.addEventListener('transitionend', done);
    el.style.transition = GLIDE;
    el.style.transform = `translate3d(${step > 0 ? '-200%' : '0%'}, 0, 0)`;
  }, [derived.media, mediaIdx, goMedia, settleTrack, GLIDE]);

  /* Re-centre the strip the instant the panes change, in the same paint.
     useLayoutEffect, not useEffect: this runs after the DOM update and before
     the browser draws, so the frame where the old content sits under the new
     offset never reaches the screen. Covers thumbnail clicks too, which change
     the index without any animation. */
  useLayoutEffect(() => {
    const el = mediaTrackRef.current;
    if (!el) return;
    el.style.transition = 'none';
    el.style.transform = REST;
    void el.offsetHeight;                // land the jump before transitions resume
    el.style.transition = '';
  }, [mediaIdx, REST]);

  /* Keep the active thumbnail centred in the rail.
     Without this the rail never moved at all, so swiping past the fourth or
     fifth item left the highlight off-screen and the strip stopped saying where
     you were. scrollTo clamps itself, which is what makes the first and last
     items sit off-centre — correct, since there is nothing beyond them to
     scroll to. Instant on open, animated afterwards: the first position is not
     a change, and animating it would look like the rail was still loading. */
  const railSettled = useRef(false);
  useEffect(() => {
    const rail = stripRef.current;
    const active = rail?.children[mediaIdx];
    if (!rail || !active) return;
    const left = active.offsetLeft - (rail.clientWidth - active.clientWidth) / 2;
    const instant = !railSettled.current
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    rail.scrollTo({ left, behavior: instant ? 'auto' : 'smooth' });
    railSettled.current = true;
  }, [mediaIdx, mediaModalOpen]);

  // Reopening starts a fresh gallery, so the next centring should not animate.
  useEffect(() => { if (!mediaModalOpen) railSettled.current = false; }, [mediaModalOpen]);

  const mediaSwipe = useSwipe({
    axis: 'x',
    enabled: mediaCount > 1,
    onSwipe: (dir) => slideTo(dir === 'left' ? 1 : -1),
    onCancel: () => { const el = mediaTrackRef.current; if (el) settleTrack(el); },
    onMove: (dx, dragging) => {
      const el = mediaTrackRef.current;
      if (!el || reduceMotion()) return;
      if (!dragging) return;             // commit and cancel own the release
      /* Damped, not blocked, when there is nothing to move to. Real things slow
         down at a limit; they do not hit an invisible wall. */
      const atEnd = !derived.media?.[mediaIdx + (dx < 0 ? 1 : -1)];
      el.style.transition = 'none';
      el.style.transform = `translate3d(calc(-100% + ${atEnd ? dx * 0.2 : dx}px), 0, 0)`;
    },
  });

  /* The keyboard equivalent, which did not exist either — the thumbnail strip
     was the only way through the gallery. A gesture that is the sole route to
     something is a gesture that excludes everyone who cannot make it. */
  useEffect(() => {
    if (!mediaModalOpen) return;
    const onKey = (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); goMedia(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goMedia(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mediaModalOpen, goMedia]);

  const mediaLightbox = mediaModalOpen && derived.media.length > 0 && (() => {
    return (
          <Dialog
            open
            onClose={() => { setMediaModalOpen(false); setVideoPlaying(false); }}
            label={`${game.name} media`}
            /* 10000, not 3000, and not 9999 either. The nav rail is z-[9999] and
               220px of opaque black, so at 3000 this full-bleed lightbox opened
               UNDERNEATH it — the left of every screenshot was cut off, and the
               backdrop dimmed everything except the one element still lit.
               9999 would tie, and equal z in one stacking context resolves by DOM
               order, which is luck rather than a decision. The skip link in
               App.jsx sits at 10000 for exactly this reason and records why.
               Desktop only: below lg the rail is translated off-screen, which is
               why this only ever showed up on a wide window. */
            z={10000}
            className="p-3 md:p-8"
            backdropClassName="bg-black/90"
            panelClassName="w-full max-w-6xl max-h-full flex flex-col overflow-hidden"
          >
              <header className="h-12 shrink-0 flex items-center border-b border-white/15 px-4">
                <span className="lh-label text-white/70">Media</span>
                <span className="lh-label text-white/60 tabular-nums ml-3">{Math.min(mediaIdx, derived.media.length - 1) + 1} / {derived.media.length}</span>
                <div className="flex-1" />
                <button onClick={() => { setMediaModalOpen(false); setVideoPlaying(false); }} className="lh-label h-12 -mr-4 px-4 border-l border-white/15 text-white/60 hover:bg-white hover:text-black focus-visible:bg-white focus-visible:text-black focus-visible:outline-none transition-colors cursor-pointer">Close</button>
              </header>
              <div
                className="relative bg-neutral-950 aspect-video max-h-[calc(100vh-12rem)] overflow-hidden"
                {...mediaSwipe}
              >
                {/* A real track: the neighbours are mounted either side of the
                    current item and the whole strip moves. The previous version
                    translated one pane as a hint and then snapped it back on
                    release, so the item you swiped away returned to centre and
                    the next one replaced it in place — it read as a glitch
                    rather than as movement, because nothing ever went anywhere.
                    Base offset is one pane width; drag and commit both work
                    against that. */}
                <div
                  ref={mediaTrackRef}
                  className="absolute inset-0 flex"
                  style={{ transform: 'translate3d(-100%, 0, 0)' }}
                >
                  {[-1, 0, 1].map(off => {
                    const m = derived.media[mediaIdx + off];
                    const isCurrent = off === 0;
                    return (
                      <div key={mediaIdx + off} className="relative w-full h-full shrink-0">
                        {!m ? null : m.type === 'video' ? (
                          /* Only the current pane may hold an iframe. A
                             neighbour that autoplays is a neighbour you can
                             hear before you can see. */
                          isCurrent && videoPlaying ? (
                            <iframe src={`https://www.youtube.com/embed/${m.id}?autoplay=1`} title={m.name || 'Video'} allow="autoplay; encrypted-media; fullscreen" allowFullScreen className="absolute inset-0 w-full h-full block" />
                          ) : (
                            <button
                              onClick={() => isCurrent && setVideoPlaying(true)}
                              tabIndex={isCurrent ? 0 : -1}
                              aria-hidden={!isCurrent}
                              className="group absolute inset-0 w-full h-full cursor-pointer"
                            >
                              <img src={`https://img.youtube.com/vi/${m.id}/hqdefault.jpg`} alt={m.name || 'Video'} className="w-full h-full object-cover block" />
                              <span className="absolute inset-0 flex items-center justify-center"><span className="w-16 h-16 bg-black border border-white/50 flex items-center justify-center text-white group-hover:bg-white group-hover:text-black transition-colors"><Play className="w-7 h-7 ml-0.5" fill="currentColor" /></span></span>
                            </button>
                          )
                        ) : (
                          /* draggable={false} is load-bearing, not tidiness: an
                             image drag fires dragstart, which cancels the whole
                             pointer stream and kills the swipe mid-gesture. */
                          <img
                            src={img(m.id, '1080p')}
                            alt={isCurrent ? game.name : ''}
                            aria-hidden={!isCurrent}
                            draggable={false}
                            className="absolute inset-0 w-full h-full object-contain block"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div ref={stripRef} className="flex overflow-x-auto no-scrollbar snap-x border-t border-white/15">
                {derived.media.map((m, i) => (
                  <button key={`${m.type}-${m.id}-${i}`} onClick={() => { setMediaIdx(i); setVideoPlaying(false); }} aria-label={`View ${m.type === 'video' ? 'video' : 'image'} ${i + 1}`} className={`relative h-14 md:h-16 aspect-video shrink-0 snap-center border-r border-white/15 last:border-r-0 bg-neutral-900 cursor-pointer transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white ${i === mediaIdx ? 'opacity-100' : 'opacity-45 hover:opacity-100 focus-visible:opacity-100'}`}>
                    <img src={m.type === 'video' ? `https://img.youtube.com/vi/${m.id}/mqdefault.jpg` : img(m.id, 'screenshot_med')} alt="" className="w-full h-full object-cover block pointer-events-none" />
                    {m.type === 'video' && <span className="absolute inset-0 flex items-center justify-center pointer-events-none"><span className="w-6 h-6 bg-black/80 border border-white/40 flex items-center justify-center text-white"><Play className="w-3 h-3" fill="currentColor" /></span></span>}
                    {i === mediaIdx && <span className="absolute inset-0 border-2 border-white pointer-events-none" />}
                  </button>
                ))}
              </div>
          </Dialog>
    );
  })();

  /* ── Action rail (rendered on desktop aside + inline on mobile) ── */
  const rail = game && (
    <div className="flex flex-col gap-5">
      {/* Framed cover */}
      {game.cover?.image_id && (
        <div className="border border-white/20 bg-black">
          <img
            src={img(game.cover.image_id, 'cover_big')}
            alt={game.name}
            className="w-full aspect-[3/4] object-cover block"
          />
        </div>
      )}

      {/* Status */}
      <div>
        <div className="lh-label text-white/60 mb-2">Status</div>
        <div className="border border-white/15 flex flex-col">
          {isUnreleased ? (
            <StateRow
              label="Unreleased"
              color={statusColor('Unreleased')}
              active={!!libEntry}
              onClick={() => libEntry ? handleRemove() : (persist({ status: 'Unreleased' }), toast('Added to library'))}
            />
          ) : (
            STATUSES.map(s => (
              <StateRow
                key={s.key}
                label={s.key}
                color={s.color}
                active={libEntry?.status === s.key}
                activeLabel={`remove ${game.name} from library`}
                onClick={() => handleStatus(s.key)}
              />
            ))
          )}
        </div>
      </div>

      {/* Priority — everything except Beaten */}
      {libEntry && libEntry.status !== 'Beaten' && (
        <div>
          <div className="lh-label text-white/60 mb-2">Priority</div>
          <div className="border border-white/15 flex flex-col">
            {PRIORITIES.map(p => (
              <StateRow
                group="priority"
                activeLabel={`clear priority for ${game.name}`}
                key={p.key}
                label={p.key}
                color={p.color}
                active={libEntry?.priority === p.key}
                onClick={() => handlePriority(p.key)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Rating — Beaten only */}
      {libEntry?.status === 'Beaten' && (
        <div>
          <div className="lh-label text-white/60 mb-2">Rating</div>
          <div className="border border-white/15 flex flex-col">
            {FEELS.map(f => (
              <StateRow
                group="rating"
                activeLabel={`clear rating for ${game.name}`}
                key={f.key}
                label={f.key}
                color={f.color}
                active={libEntry?.feel === f.key}
                onClick={() => handleFeel(f.key)}
              />
            ))}
          </div>
        </div>
      )}

      {completedBlock}

      <PlatformSection
        game={game}
        userPlatforms={userPlatforms}
        selectedKeys={selectedPlatKeys}
        onToggle={togglePlatform}
      />

      {collectionsBlock}

      {libEntry && (
        <button
          onClick={handleRemove}
          className="lh-label w-full px-3 py-2.5 border border-white/15 text-[var(--destructive)] hover:bg-[var(--destructive-hover)] hover:text-black focus-visible:bg-[var(--destructive-hover)] focus-visible:text-black focus-visible:outline-none transition-colors cursor-pointer text-left"
        >
          Remove from Library
        </button>
      )}
    </div>
  );

  /* ── Loading skeleton ── */
  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white">
        <Skeleton className="w-full h-[32vh] md:h-[44vh] border-b border-white/15" />
        <div className="content-container py-8">
          <Skeleton className="h-3 w-32 mb-4" />
          <Skeleton className="h-12 w-2/3 mb-8" />
          <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12">
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
            <Skeleton className="hidden lg:block h-96" />
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="content-container py-4">
        <EmptyPlate failed title="The index did not answer" body="LoreHaven could not reach IGDB. Nothing here is missing; it has not loaded yet." />
      </div>
    );
  }

  if (!game) {
    return (
      <div className="content-container py-4">
        <EmptyPlate
          title="Not Found"
          body="This entry does not exist in the index"
          action={<button onClick={() => navigate(-1)} className="lh-label mt-2 px-4 h-9 border border-white/20 text-white/60 hover:bg-white hover:text-black hover:border-white focus:bg-white focus:text-black focus-visible:outline-none transition-colors cursor-pointer">Go Back</button>}
        />
      </div>
    );
  }

  const heroMedia = derived.media?.find(m => m.type === 'image') || null;
  const hasHeroStage = Boolean(derived.heroId || heroMedia || derived.media?.length);

  return (
    <div className="min-h-screen bg-black text-white animate-in fade-in duration-500">
      <ConfirmDialog {...confirmProps} />


      {hasHeroStage && (
        /* min-h floors the hero at 200px: the mobile cover block below is pulled up a
           FIXED 48px over this section, so on a short viewport (landscape, small
           webview) a 24vh hero shrinks until that band covers the media button's
           glyph. Measured at 740x360: the hero was 86px and the glyph's centre hit
           the cover block, not the button. */
        <section className="relative w-full h-[24vh] min-h-[200px] md:h-[44vh] border-b border-white/15 bg-neutral-900 overflow-hidden lg:-mt-8">
          {derived.heroId || heroMedia ? (
            <img src={img(derived.heroId || heroMedia.id, '1080p')} alt={game.name} className="w-full h-full object-cover block" />
          ) : (
            <div className="absolute inset-0 bg-neutral-900" aria-hidden="true" />
          )}
          {derived.media.length > 0 && (
            <button
              onClick={() => { setMediaIdx(0); setVideoPlaying(false); setMediaModalOpen(true); }}
              aria-label={`Open ${game.name} media`}
              /* z-20 so an interactive layer outranks a decorative one: the mobile
                 cover block below is `relative z-10` and this section creates no
                 stacking context, so without it the block hit-tests above the
                 button and eats every tap in the hero's bottom 48px. */
              className="group absolute inset-0 z-20 flex items-center justify-center cursor-pointer focus-visible:outline-none"
            >
              <span className="w-16 h-16 bg-black border border-white/50 flex items-center justify-center text-white group-hover:bg-white group-hover:text-black group-focus-visible:bg-white group-focus-visible:text-black transition-colors">
                <Play className="w-7 h-7 ml-0.5" fill="currentColor" />
              </span>
              {/* right-4, not left-4. The mobile cover block is pulled up -mt-20 over
                  the hero's bottom-left, so a left-anchored chip landed ON the poster —
                  measured 91x21px of overlap at 375px, covering 83% of the cover's
                  width across its top band. The product's whole thesis is that cover
                  art is the only colour against black; a chrome label sitting on it is
                  the one place that must not break. The poster is left-anchored, so
                  the right edge is free at every width. */}
              <span className="absolute bottom-4 right-4 lh-label px-2 py-1 bg-black border border-white/25 text-white/70">Media · {derived.media.length}</span>
            </button>
          )}
        </section>
      )}

      <div className="content-container py-8">

        {/* ── Mobile: poster overlaps the hero, quick facts alongside ── */}
        {game.cover?.image_id && (
          <div className={`lg:hidden flex gap-4 items-stretch relative z-10 mb-8 ${hasHeroStage ? '-mt-20' : ''}`}>
            <div className="w-28 shrink-0 border border-white/20 bg-black self-start">
              <img
                src={img(game.cover.image_id, 'cover_big')}
                alt={game.name}
                className="w-full aspect-[3/4] object-cover block"
              />
            </div>
            {/* pt reserves the hero band (80px pull − 32px page padding) so text never sits on the image */}
            <div className={`flex-1 min-w-0 flex flex-col justify-end gap-2.5 pb-1 ${hasHeroStage ? 'pt-12' : ''}`}>
              {/* Released only. The public rating moved into Before You Decide,
                  which on a phone renders a few hundred pixels below this — the
                  same number twice on one screen, once as a caption and once as
                  evidence. Evidence wins. */}
              <Fact label="Released" value={derived.released || 'TBA'} />
              
            </div>
          </div>
        )}

        {/* ── Title block — typography as architecture ── */}
        <PageHeader
          back={{ label: 'Back', onClick: () => navigate(-1), ariaLabel: 'Go back to previous page' }}
          titleClassName="text-4xl md:text-6xl lg:text-7xl"
          title={game.name}
          meta={[derived.year, derived.dev, derived.genres]}
        />

        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12 lg:items-start">

          {/* ── Left column ── */}
          <div className="min-w-0">

            {/* ── Before you decide ────────────────────────────────────────
                The case, above the decision. This page used to open with the
                status strip — the control came before any reason to touch it —
                and filed the two facts that actually decide the question, length
                and rating, as rows 8 and 9 of a nine-row metadata table below
                the fold.

                Everything here is counted: the rating carries its own sample
                size, the length is IGDB's, and the shelf lines are read off your
                own library. A line with nothing true to say is absent, never
                hedged. Hidden once a game is beaten — there is nothing left to
                decide, and the page goes back to being a record. */}
            {libEntry?.status !== 'Beaten'
              && (derived.rating || derived.ttbAll || verdict?.fit || verdict?.neighbours?.length) && (
              <section className="mb-10">
                <SectionHeader>Before You Decide</SectionHeader>
                <div className="border border-white/15">
                  {/* Taste first: whether this is for someone who plays what you
                      play is the question underneath the other two. The words are
                      reasonsFor's, verbatim, so this page, Pick For Me and Explore
                      cannot phrase your taste three different ways. */}
                  {verdict?.fit?.thin && (
                    <IndexRow label="Your Taste" value="Not enough on your shelves yet to compare" />
                  )}
                  {(verdict?.fit?.reasons || []).map((r, i) => (
                    <IndexRow key={r} label={i === 0 ? 'Your Taste' : ''} value={r} />
                  ))}
                  {verdict?.fit && !verdict.fit.thin && verdict.fit.reasons.length === 0 && (
                    /* An honest negative. A page that can only ever argue for
                       adding a game is a storefront. */
                    <IndexRow label="Your Taste" value="Nothing here matches what you usually play" />
                  )}
                  <IndexRow label="Rated" value={derived.rating} />
                  <IndexRow label="Length" value={derived.ttbAll} />
                  <IndexRow label="Your Queue" value={verdict?.against} />
                  {(verdict?.neighbours || []).map((line, i) => (
                    <IndexRow key={line} label={i === 0 ? 'Your Shelf' : ''} value={line} />
                  ))}
                </div>
              </section>
            )}

            {/* Summary — magazine body */}
            {game.summary && (
              <section className="mb-10">
                <SectionHeader>Overview</SectionHeader>
                <p className="text-[15px] leading-relaxed text-white/70 max-w-prose">
                  {game.summary}
                </p>
              </section>
            )}

            {/* ── Mobile controls — states as horizontal strips ── */}
            <div className="lg:hidden mb-10 space-y-5">

              {/* Status strip */}
              <div>
                <div className="lh-label text-white/60 mb-2">Status</div>
                <div className="flex flex-wrap sm:flex-nowrap sm:overflow-x-auto sm:no-scrollbar border-t border-l border-white/15">
                  {isUnreleased ? (
                    <StripCell
                      label="Unreleased"
                      color={statusColor('Unreleased')}
                      active={!!libEntry}
                      onClick={() => libEntry ? handleRemove() : (persist({ status: 'Unreleased' }), toast('Added to library'))}
                    />
                  ) : (
                    STATUSES.map(s => (
                      <StripCell
                        key={s.key}
                        label={s.key}
                        color={s.color}
                        active={libEntry?.status === s.key}
                        activeLabel={`remove ${game.name} from library`}
                        onClick={() => handleStatus(s.key)}
                      />
                    ))
                  )}
                </div>
              </div>

              {/* Priority strip — everything except Beaten */}
              {libEntry && libEntry.status !== 'Beaten' && (
                <div>
                  <div className="lh-label text-white/60 mb-2">Priority</div>
                  <div className="flex flex-wrap sm:flex-nowrap sm:overflow-x-auto sm:no-scrollbar border-t border-l border-white/15">
                    {PRIORITIES.map(p => (
                      <StripCell
                        group="priority"
                        activeLabel={`clear priority for ${game.name}`}
                        key={p.key}
                        label={p.key}
                        color={p.color}
                        active={libEntry?.priority === p.key}
                        onClick={() => handlePriority(p.key)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Rating strip — Beaten only */}
              {libEntry?.status === 'Beaten' && (
                <div>
                  <div className="lh-label text-white/60 mb-2">Rating</div>
                  <div className="flex flex-wrap sm:flex-nowrap sm:overflow-x-auto sm:no-scrollbar border-t border-l border-white/15">
                    {FEELS.map(f => (
                      <StripCell
                        group="rating"
                        activeLabel={`clear rating for ${game.name}`}
                        key={f.key}
                        label={f.key}
                        color={f.color}
                        active={libEntry?.feel === f.key}
                        onClick={() => handleFeel(f.key)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {completedBlock}

              <PlatformSection
                game={game}
                userPlatforms={userPlatforms}
                selectedKeys={selectedPlatKeys}
                onToggle={togglePlatform}
              />

              {libEntry && (
                <button
                  onClick={handleRemove}
                  className="lh-label w-full px-3 py-2.5 border border-white/15 text-[var(--destructive)] hover:bg-[var(--destructive-hover)] hover:text-black transition-colors cursor-pointer text-left"
                >
                  Remove from Library
                </button>
              )}
            </div>

            {/* Notes / Review — personal marginalia on the library entry */}
            {libEntry && (
              <section className="mb-10">
                <SectionHeader>{libEntry.status === 'Beaten' ? 'Review' : 'Notes'}</SectionHeader>
                <textarea
                  id="game-user-notes"
                  aria-label={libEntry.status === 'Beaten' ? 'Review notes' : 'Personal game notes'}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={1000}
                  placeholder={libEntry.status === 'Beaten'
                    ? 'Write your review…'
                    : 'Where you left off, things to remember…'}
                  className="w-full min-h-28 bg-black border border-white/40 p-3 text-[15px] leading-relaxed text-white/80 placeholder:text-white/50 focus:border-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white outline-none resize-y block"
                />
                <div className="flex items-center justify-between mt-2">
                  {/* --warning, not text-amber-400. Approaching the limit is the
                      "recoverable problem worth looking at" role the token exists
                      for, and a Tailwind amber is that role in disguise — it drifts
                      the moment the token moves. Measured 14.56:1 on black. */}
                  <span className={`lh-label tabular-nums ${notes.length >= 950 ? 'text-[var(--warning)] font-bold' : 'text-white/60'}`}>
                    {notes.length}/1000
                  </span>
                  {notesDirty && (
                    <div className="flex">
                      <button
                        onClick={() => setNotes(libEntry.notes || '')}
                        className="lh-label px-3 py-2 border border-white/15 text-white/60 hover:text-white focus-visible:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveNotes}
                        className="lh-label px-3 py-2 border border-l-0 border-white/15 bg-white text-black hover:bg-white/70 focus-visible:bg-white/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors cursor-pointer"
                      >
                        Save
                      </button>
                    </div>
                  )}
                </div>
              </section>
            )}


            {/* Index — metadata as a bordered table; entries link to their category pages */}
            <section className="mb-10">
              <SectionHeader>Index</SectionHeader>
              <div className="border border-white/15">
                <IndexRow label="Released" value={derived.released || 'TBA'} />
                <IndexLinks label="Developer" items={derived.devLink} />
                <IndexLinks label="Publisher" items={derived.pubLink} />
                <IndexLinks label="Genres" items={derived.genreLinks} />
                <IndexLinks label="Platforms" items={derived.platformLinks} />
                <IndexLinks label="Modes" items={derived.modeLinks} />
                <IndexLinks label="Engine" items={derived.engineLinks} />
              </div>
            </section>

            {/* Awards — standalone table: prominent year + ceremony, wins on the right */}
            <AwardsSection gameId={game.id} />

            {/* Appears In — franchise, collections, events */}
            {(connections.franchises.length > 0 || connections.collections.length > 0 || connections.events.length > 0) && (
              <section className="mb-10">
                <SectionHeader>Appears In</SectionHeader>
                <div className="border border-white/15">
                  <IndexLinks
                    label="Franchise"
                    items={connections.franchises.map(f => ({ id: f.id, label: f.name, to: `/franchise/${f.id}` }))}
                  />
                  <IndexLinks
                    label="Collections"
                    items={connections.collections.map(c => ({ id: c.id, label: c.name, to: `/collection/igdb/${c.id}` }))}
                  />
                  <IndexLinks
                    label="Events"
                    items={connections.events.map(e => ({ id: e.id, label: e.name, to: `/event/${e.id}` }))}
                  />
                </div>
              </section>
            )}

          </div>

          {/* ── Right rail (desktop) ── */}
          <aside className="hidden lg:block lg:sticky lg:top-8">
            {rail}
          </aside>
        </div>
      </div>

      {mediaLightbox}
    </div>
  );
}
