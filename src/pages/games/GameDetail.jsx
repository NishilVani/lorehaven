import PageHeader from '../../components/ui/PageHeader';
import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import EmptyPlate from '../../components/ui/EmptyPlate';
import { useParams, useNavigate, Link } from 'react-router-dom';
import useSwipe from '../../hooks/useSwipe';
import { Play, Download, Share2, ThumbsUp, ThumbsDown, Bookmark, ArrowRightLeft, X } from 'lucide-react';
import { getGameById, getGamesByIds, getGamesProfile, getFranchisesByIds, getSeriesTimeline, getCollectionsByIds, getEventsByGameId } from '../../services/igdb';
import { buildTaste, eraBonus, isScenicArtwork } from '../../services/discover';
import { reasonsFor } from '../../services/pickNext';
import {
  getLibrary, getPrefs, saveToLibrary, removeFromLibrary, getUserOwnedPlatforms, getUserCustomPlatforms,
  getCollections, getCollectionsWithGame, addGameToCollection, removeGameFromCollection,
  getRecFeedbackIndex, setRecFeedback, saveFranchise, removeFranchise, isFranchiseSaved,
} from '../../services/db';
import { toDateInputValue, readNoteDraft, writeNoteDraft, clearNoteDraft } from '../../services/libraryFields';
import { downloadUrlAsFile, safeFilename } from '../../services/saveImage';
import { getShortPlatformName } from '../../components/platforms/platformLogoUtils';
import { toast } from '../../components/ui/toastBus';
import { announce } from '../../components/ui/useAnnounce';
import { Skeleton } from '../../components/ui/Skeleton';
import AwardsSection from '../../components/GameDetail/AwardsSection';
import TrackerBar from '../../components/GameDetail/TrackerBar';
import LeadBlock from '../../components/GameDetail/LeadBlock';
import { leadMode } from '../../components/GameDetail/leadMode';
import NotesEditor from '../../components/GameDetail/NotesEditor';
import MediaStrip from '../../components/GameDetail/MediaStrip';
import RelatedRow from '../../components/GameDetail/RelatedRow';
import { versionOf, familyOf, similarOf, timelineOf, releasesByPlatform, datesDiffer, linksOf } from '../../components/GameDetail/related';
import SeriesTimeline from '../../components/GameDetail/SeriesTimeline';
import FamilyBento from '../../components/GameDetail/FamilyBento';
import ExternalLink from '../../components/ui/ExternalLink';
import { SectionHeader, IndexRow, IndexLinks, TagLink } from '../../components/GameDetail/parts';
import TransferDataModal from '../../components/games/TransferDataModal';
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

/** The public score with the confidence behind it, or an honest refusal.
    Critics ride along in the caption when there are enough of them to mean
    something: IGDB fetched aggregated_rating all along and the page never said
    it, so a game the critics and the players split on read as one number. */
const CRITIC_FLOOR = 5;
function scoreRead(game) {
  const count = game.total_rating_count || 0;
  if (!count) return null;
  if (!game.total_rating || count < RATING_FLOOR) return { thin: true, count, floor: RATING_FLOOR };
  const crit = game.aggregated_rating_count >= CRITIC_FLOOR && game.aggregated_rating
    ? `Critics ${Math.round(game.aggregated_rating)} from ${game.aggregated_rating_count} reviews`
    : null;
  return { value: Math.round(game.total_rating), count, critics: crit };
}

/* How many hours, said three ways. `normal` is the figure; the others are the
   caption. `any` covers the game IGDB only measured one way. */
function lengthRead(ttb) {
  if (!ttb) return null;
  const h = (s) => Math.round(s / 3600);
  const normal = ttb.normally ? h(ttb.normally) : null;
  const rushed = ttb.hastily ? h(ttb.hastily) : null;
  const full = ttb.completely ? h(ttb.completely) : null;
  if (normal == null && rushed == null && full == null) return null;
  const range = [rushed != null && `${rushed}h rushed`, full != null && `${full}h to complete everything`]
    .filter(Boolean).join(' · ') || 'Main story, at a normal pace.';
  return { normal, any: normal ?? rushed ?? full, range };
}

/* "4 months ago". addedAt is stamped on first insert only, so entries older
   than the field have none and the line is absent rather than invented. */
function agoText(ms, now) {
  if (!ms) return null;
  const days = Math.floor((now - ms) / 86400000);
  if (days < 1) return 'Added today';
  if (days < 2) return 'Added yesterday';
  if (days < 45) return `Added ${days} days ago`;
  const months = Math.round(days / 30.4);
  if (months < 18) return `Added ${months} months ago`;
  return `Added ${Math.round(months / 12)} years ago`;
}

/* The live site, not wherever this build happens to be served from: a Tauri
   build lives at tauri://localhost and a link to that is a link to nothing. */
const SHARE_ORIGIN = 'https://lorehaven.app';

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
    /* Kept, unlike the equivalent resets on the other keyed routes. On paper it
       is redundant — the route is keyed by pathname, so a different game is a
       different instance and these already hold true / null / null — but taking
       it out made phase3-deep:305 flaky. That is the guard refusing to clear a
       completion date the field could never display; without these lines it
       passed two full runs and failed the third, and failed when run alone.
       With them it passes four times out of four, and on the pre-refactor tree.

       It is not the values. Restoring ANY ONE of the three fixes it,
       setLoadError(null) included, and that one writes null over null — a
       no-op except that React still schedules one render before bailing out.
       So what the page relies on is that extra render pass, not the state. That
       is a real render-timing dependency somewhere below here and it deserves
       its own investigation; deleting the line that happens to satisfy it is
       not that investigation. */
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- see above */
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
      score: scoreRead(game),
      length: lengthRead(game.game_time_to_beat),
      themeLinks: game.themes?.map(t => ({ id: t.id, label: t.name, to: `/games/theme/${t.id}` })) || [],
      perspectives: game.player_perspectives?.map(p => p.name).join(', ') || null,
      version: versionOf(game),
      family: familyOf(game),
      similar: similarOf(game),
      platformDates: releasesByPlatform(game),
      links: linksOf(game),
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

  /* ── The series — the franchise's games as a timeline, for the Family section ──
     getSeriesTimeline, not the franchise page's query: that one carries every
     edition and re-release IGDB files under the name. Only the first franchise: a game filed under
     three franchises gets the one IGDB lists first, and the header link. */
  const [franchiseGames, setFranchiseGames] = useState([]);
  const franchiseId = connections.franchises[0]?.id;
  useEffect(() => {
    if (!franchiseId) return;
    let cancelled = false;
    (async () => {
      const games = await getSeriesTimeline(franchiseId).catch(() => []);
      if (!cancelled) setFranchiseGames(games || []);
    })();
    return () => { cancelled = true; };
  }, [franchiseId]);

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
  /* The media reset this used to run on every `game` change is gone. Keyed by
     route, `game` only ever goes null -> loaded once per instance, and at that
     point all three still hold their initial 0 / false / false. */

  /* ── Library actions ── */
  const persist = useCallback((changes) => {
    const base = libEntry || {
      id: game.id,
      name: game.name,
      is_custom: false,
      cover_id: game.cover?.image_id || null,
      cover_width: game.cover?.width || null,
      cover_height: game.cover?.height || null,
      /* What the card menus write on an add, so a game shelved from this page
         shows its studio and year on the shelf before the next IGDB sync. */
      dev: derived.dev || null,
      release_year: derived.year || null,
      first_release_date: game.first_release_date || null,
      total_rating: game.total_rating || null,
    };
    const updated = { ...base, ...changes };
    saveToLibrary(updated);
    setLibEntry(updated);
    return updated;
  }, [libEntry, game, derived]);

  const handleStatus = (status) => {
    /* Choosing the status you are already on does nothing. It used to remove
       the game, which no other surface did: on a card, Remove is its own item at
       the end of the menu. Here it is too, at the end of More. */
    if (libEntry?.status === status) return;
    if (!libEntry) {
      persist({ status });
      toast(`Added to ${status}`);
      return;
    }
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

  /* null clears. Choosing the value already set leaves it set: the menus carry
     an explicit Clear item, as the card menus do. */
  const handlePriority = (priority) => {
    if (priority && libEntry?.priority === priority) return;
    const next = priority;
    persist({ priority: next });
    toast(next ? `Priority: ${next}` : 'Priority cleared');
  };

  const handleFeel = (feel) => {
    if (feel && libEntry?.feel === feel) return;
    const next = feel;
    persist({ feel: next });
    toast(next ? `Rated: ${next}` : 'Rating cleared');
  };

  const [confirm, confirmProps] = useConfirm();

  const handleRemove = () => confirm(
    { eyebrow: 'Library', title: `Remove ${game.name}?`, body: 'Its status, rating, priority, notes and completion date go with it. There is no undo.', confirmLabel: 'Remove' },
    () => {
      removeFromLibrary(game.id);
      setLibEntry(null);
      /* The notes go with the entry. Left in state they no longer matched a
         saved copy, so the draft effect wrote them out as an unsaved draft and
         every later visit announced one for a game that had no notes field. */
      setNotes('');
      clearNoteDraft(id);
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
  /* Both read localStorage synchronously and only need the id from the route,
     not the fetched game, so they are seeded here instead of waiting for the
     game to land. getCollectionsWithGame coerces with Number(), so the string
     from useParams behaves exactly as game.id did. */
  const [myCollections] = useState(getCollections);
  const [inCollections, setInCollections] = useState(
    () => new Set(getCollectionsWithGame(id).map(String)));
  /* Announced, not toasted. The collections menu stays open for the next pick
     and shows its own check marks; on a phone it opens upward from the docked
     bar, which is exactly where the toast stack rises, so a toast per pick
     covered the item you were about to tap next. */
  const toggleCollection = (col) => {
    const key = String(col.id);
    if (inCollections.has(key)) {
      removeGameFromCollection(col.id, game.id);
      setInCollections(prev => { const n = new Set(prev); n.delete(key); return n; });
      announce(`Removed from "${col.name}"`);
    } else {
      addGameToCollection(col.id, game.id);
      setInCollections(prev => new Set(prev).add(key));
      announce(`Added to "${col.name}"`);
    }
  };

  /* ── Completion date — Beaten only, shown in the Your Record figures ── */
  const completedInput = libEntry?.status === 'Beaten' && (
    <input
      id="completed-date-input"
      type="date"
      aria-label="Completion Date"
      value={libEntry.dateCompleted || ''}
      onChange={(e) => handleDate(e.target.value)}
      className="w-full bg-black border border-white/40 px-3 py-2.5 lh-label text-white [color-scheme:dark] focus:border-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white cursor-pointer"
    />
  );

  /* ── Tracker bar wiring ── */
  const [platformsOpen, setPlatformsOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  /* The bar docks to the bottom of the screen below lg, which is the corner
     toasts rise from. Lift the stack clear of it for as long as this page is
     mounted; Toast.jsx ignores the value at lg, where the bar is inline. */
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--toast-bottom', 'calc(4.5rem + env(safe-area-inset-bottom))');
    return () => root.style.removeProperty('--toast-bottom');
  }, []);

  const swatchIcon = (color) => <div className="w-2.5 h-2.5" style={{ backgroundColor: color }} />;

  const statusOptions = STATUSES.map(s => ({
    label: s.key,
    color: s.color,
    icon: swatchIcon(s.color),
    isActive: libEntry?.status === s.key,
    onClick: () => handleStatus(s.key),
  }));

  /* Priority while there is something left to decide, rating once it is done. */
  const isBeaten = libEntry?.status === 'Beaten';
  const secondSegment = !libEntry ? null : isBeaten ? {
    caption: 'Your Rating',
    value: libEntry.feel || 'Not rated',
    swatch: libEntry.feel ? feelColor(libEntry.feel) : null,
    ariaLabel: `Rating: ${libEntry.feel || 'not rated'}`,
    options: [
      ...FEELS.map(f => ({
        label: f.key, color: f.color, icon: swatchIcon(f.color),
        isActive: libEntry.feel === f.key, onClick: () => handleFeel(f.key),
      })),
      ...(libEntry.feel ? [{ label: 'Clear Rating', icon: X, dividerAbove: true, onClick: () => handleFeel(null) }] : []),
    ],
  } : {
    caption: 'Priority',
    value: libEntry.priority || 'Not set',
    swatch: libEntry.priority ? priorityColor(libEntry.priority) : null,
    ariaLabel: `Priority: ${libEntry.priority || 'not set'}`,
    options: [
      ...PRIORITIES.map(p => ({
        label: p.key, color: p.color, icon: swatchIcon(p.color),
        isActive: libEntry.priority === p.key, onClick: () => handlePriority(p.key),
      })),
      ...(libEntry.priority ? [{ label: 'Clear Priority', icon: X, dividerAbove: true, onClick: () => handlePriority(null) }] : []),
    ],
  };

  const ownedNames = (libEntry?.user_platforms || []).map(getShortPlatformName);
  const platformsLabel = ownedNames.length === 0
    ? 'Not marked'
    : ownedNames.length <= 2 ? ownedNames.join(', ') : `${ownedNames.slice(0, 2).join(', ')} +${ownedNames.length - 2}`;

  /* Absent with no collections, as the old block was: an empty menu offering to
     file a game into nothing is clutter, and Collections is one click away. */
  const collectionsSegment = myCollections.length > 0 ? {
    label: inCollections.size === 0 ? 'None' : inCollections.size === 1
      ? (myCollections.find(c => inCollections.has(String(c.id)))?.name || 'In 1')
      : `In ${inCollections.size}`,
    options: myCollections.map(c => ({
      label: c.name,
      isActive: inCollections.has(String(c.id)),
      onClick: () => toggleCollection(c),
    })),
  } : null;

  const [feedback, setFeedback] = useState(() => getRecFeedbackIndex().get(String(id)) || null);
  const giveFeedback = (verdict) => {
    const next = feedback === verdict ? null : verdict;
    setRecFeedback({ id: game.id, name: game.name, cover_id: game.cover?.image_id || null }, next);
    setFeedback(next);
    toast(next === 'interested' ? 'Marked Interested' : next === 'not_interested' ? 'Explore will stop suggesting it' : 'Feedback cleared');
  };

  const franchise = connections.franchises[0] || null;
  const timeline = game && franchise ? timelineOf(game, franchiseGames) : null;
  const [franchiseSaved, setFranchiseSaved] = useState(false);
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- reads storage once the franchise lands */
    if (franchise) setFranchiseSaved(isFranchiseSaved(franchise.id));
  }, [franchise]);
  const toggleFranchise = () => {
    if (franchiseSaved) {
      removeFranchise(franchise.id);
      setFranchiseSaved(false);
      toast(`Removed ${franchise.name} from Collections`);
    } else if (saveFranchise(franchise)) {
      setFranchiseSaved(true);
      toast(`Saved ${franchise.name} to Collections`);
    }
  };

  /* The system share sheet where there is one (phones, Safari), the clipboard
     everywhere else. Always the live site's address. */
  const shareGame = async () => {
    const url = `${SHARE_ORIGIN}/game/${game.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: game.name, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    } catch (err) {
      if (err?.name === 'AbortError') return;      // the sheet was dismissed
      toast('Could not copy the link', 'error');
    }
  };

  const moreOptions = [
    { label: 'Share Link', icon: Share2, onClick: shareGame },
    ...(franchise ? [{
      label: franchiseSaved ? 'Unsave Franchise' : 'Save Franchise',
      icon: Bookmark,
      onClick: toggleFranchise,
    }] : []),
    ...(!libEntry ? [
      { label: 'Interested', icon: ThumbsUp, isActive: feedback === 'interested', dividerAbove: true, onClick: () => giveFeedback('interested') },
      { label: 'Not Interested', icon: ThumbsDown, isActive: feedback === 'not_interested', onClick: () => giveFeedback('not_interested') },
    ] : []),
    ...(libEntry ? [
      { label: 'Transfer Data', icon: ArrowRightLeft, dividerAbove: true, onClick: () => setTransferOpen(true) },
      { label: 'Remove from Library', icon: X, variant: 'danger', dividerAbove: true, onClick: handleRemove },
    ] : []),
  ];

  /* ── Lead block inputs ── */
  const mode = game ? leadMode(libEntry, isUnreleased) : null;
  const priorityPeers = libEntry?.priority
    ? getLibrary().filter(e => e.priority === libEntry.priority && e.status !== 'Beaten' && e.status !== 'Dropped').length
    : 0;
  const releaseFigure = (() => {
    if (!game?.first_release_date) return { date: null };
    const when = new Date(game.first_release_date * 1000);
    const days = Math.ceil((when.getTime() - nowMs) / 86400000);
    /* When the platforms do not all land together, the caption says where it
       lands when, which is the thing someone waiting on one platform wants. */
    const split = datesDiffer(derived.platformDates || [])
      ? derived.platformDates.map(r => `${r.platform} ${r.human}`).join(' · ')
      : null;
    return {
      date: when.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }),
      detail: split || (days > 1 ? `In ${days} days.` : days === 1 ? 'Tomorrow.' : 'Today.'),
    };
  })();
  /* follows, falling back to hypes: IGDB counts both, and for a game that is
     not out yet they measure the same thing, people waiting on it. */
  const anticipation = (game?.follows || game?.hypes) ? {
    value: (game.follows || game.hypes).toLocaleString(),
    detail: 'People following it on IGDB.',
  } : null;
  const firstEvent = connections.events[0] || null;
  const shownAt = firstEvent ? {
    name: firstEvent.name,
    detail: [
      firstEvent.start_time && new Date(firstEvent.start_time * 1000).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      connections.events.length > 1 && `and ${connections.events.length - 1} more`,
    ].filter(Boolean).join(' · ') || 'An industry event.',
  } : null;

  const notesEditor = libEntry && (
    <NotesEditor
      value={notes}
      onChange={setNotes}
      dirty={notesDirty}
      onSave={handleSaveNotes}
      onCancel={() => setNotes(libEntry.notes || '')}
      review={isBeaten}
      placeholder={libEntry.status === 'Dropped' ? 'Why you stopped, in case you come back…' : undefined}
    />
  );

  const saveMedia = async (m) => {
    const { outcome, where } = await downloadUrlAsFile(img(m.id, '1080p'), `${safeFilename(game.name)} — ${m.id}.jpg`);
    if (outcome === 'saved') toast(where && where !== 'browser' ? `Saved to ${where}` : 'Image downloaded');
    else if (outcome === 'handoff') toast('Opened outside the app — save it from there');
    else toast('Download failed. Check your connection and try again', 'error');
  };

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
                {/* Save the plate on screen. Videos are YouTube's to keep. Same
                    helper as Wallpapers, so it lands in the same place on every host. */}
                {derived.media[mediaIdx]?.type === 'image' && (
                  <button
                    onClick={() => saveMedia(derived.media[mediaIdx])}
                    aria-label={`Save image ${mediaIdx + 1}`}
                    className="lh-label h-12 px-4 border-l border-white/15 text-white/60 hover:bg-white hover:text-black focus-visible:bg-white focus-visible:text-black focus-visible:outline-none transition-colors cursor-pointer flex items-center gap-2"
                  >
                    <Download aria-hidden="true" className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Save</span>
                  </button>
                )}
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
  const openMedia = (i) => { setMediaIdx(i); setVideoPlaying(false); setMediaModalOpen(true); };
  /* Notes follow the lead block where the lead is about something else; while
     playing or once done, the lead block carries them itself. */
  const notesSection = libEntry && (mode === 'plan' || mode === 'waiting');
  /* Franchise moved to The Family, where the rest of the series is shown. */
  const otherFranchises = connections.franchises.slice(1);
  const hasConnections = otherFranchises.length > 0 || connections.collections.length > 0 || connections.events.length > 0;

  return (
    /* pb clears the docked tracker bar below lg, so the last section is never
       stuck under it. 3.5rem is the bar's own height. */
    <div className="min-h-screen bg-black text-white animate-in fade-in duration-500 pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0">
      <ConfirmDialog {...confirmProps} />

      {hasHeroStage && (
        /* min-h floors the hero at 200px so the cover pulled up over its bottom
           edge never reaches the media button's glyph on a short viewport. */
        <section className="relative w-full h-[28vh] min-h-[200px] md:h-[44vh] border-b border-white/15 bg-neutral-900 overflow-hidden lg:-mt-8">
          {derived.heroId || heroMedia ? (
            <img src={img(derived.heroId || heroMedia.id, '1080p')} alt={game.name} className="w-full h-full object-cover block" />
          ) : (
            <div className="absolute inset-0 bg-neutral-900" aria-hidden="true" />
          )}
          {derived.media.length > 0 && (
            <button
              onClick={() => openMedia(0)}
              aria-label={`Open ${game.name} media`}
              /* z-20 so an interactive layer outranks the cover pulled up over the
                 hero's bottom-left, which is `relative z-10`. */
              className="group absolute inset-0 z-20 flex items-center justify-center cursor-pointer focus-visible:outline-none"
            >
              <span className="w-16 h-16 bg-black border border-white/50 flex items-center justify-center text-white group-hover:bg-white group-hover:text-black group-focus-visible:bg-white group-focus-visible:text-black transition-colors">
                <Play className="w-7 h-7 ml-0.5" fill="currentColor" />
              </span>
              {/* Right, not left: the cover sits on the hero's bottom-left, and cover
                  art is the one colour on the page a chrome label must not cover. */}
              <span className="absolute bottom-4 right-4 lh-label px-2 py-1 bg-black border border-white/25 text-white/70">Media · {derived.media.length}</span>
            </button>
          )}
        </section>
      )}

      <div className="content-container py-8">

        {/* ── Masthead: the poster beside the title, the way Explore's hero sets a
            game. The cover is pulled up over the hero so the two read as one
            plate; the title column starts below the art, so no type sits on it. */}
        <div className="flex gap-4 md:gap-8 items-start mb-8">
          {game.cover?.image_id && (
            <div className={`relative z-10 w-24 sm:w-32 lg:w-44 shrink-0 border border-white/20 bg-black ${hasHeroStage ? '-mt-20 md:-mt-28' : ''}`}>
              <img
                src={img(game.cover.image_id, 'cover_big')}
                alt={game.name}
                className="w-full aspect-[3/4] object-cover block"
              />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <PageHeader
              className="mb-0"
              back={{ label: 'Back', onClick: () => navigate(-1), ariaLabel: 'Go back to previous page' }}
              titleClassName="text-3xl sm:text-4xl md:text-5xl lg:text-6xl"
              title={game.name}
              meta={[derived.year || 'TBA', derived.dev, derived.genres]}
            />
            {/* What this is a version of: an edition, a remaster, an expansion.
                The page used to present Blood and Wine with nothing saying it
                needs The Witcher 3 to play. */}
            {derived.version && (
              <p className="text-sm text-white/70 mt-3 mb-0">
                {derived.version.prefix}{' '}
                <TagLink to={`/game/${derived.version.game.id}`}>{derived.version.game.name}</TagLink>
              </p>
            )}
          </div>
        </div>

        <TrackerBar
          status={libEntry?.status || null}
          statusColor={libEntry ? statusColor(libEntry.status) : null}
          statusOptions={statusOptions}
          onAddUnreleased={isUnreleased ? () => { persist({ status: 'Unreleased' }); toast('Added to library'); } : null}
          second={secondSegment}
          platformsLabel={platformsLabel}
          onOpenPlatforms={() => setPlatformsOpen(true)}
          collections={collectionsSegment}
          moreOptions={moreOptions}
        />

        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12 lg:items-start">

          {/* ── Main column: the answer for you, then the game itself ── */}
          <div className="min-w-0">
            <LeadBlock
              mode={mode}
              score={derived.score}
              length={derived.length}
              verdict={verdict}
              libEntry={libEntry}
              notes={notesEditor}
              completed={completedInput}
              priority={libEntry?.priority || null}
              priorityColor={libEntry?.priority ? priorityColor(libEntry.priority) : null}
              priorityPeers={priorityPeers}
              feel={libEntry?.feel || null}
              feelColor={libEntry?.feel ? feelColor(libEntry.feel) : null}
              addedText={agoText(libEntry?.addedAt, nowMs)}
              release={releaseFigure}
              anticipation={anticipation}
              shownAt={shownAt}
            />

            {notesSection && (
              <section className="mb-12" aria-labelledby="notes-heading">
                <SectionHeader id="notes-heading">Notes</SectionHeader>
                {notesEditor}
              </section>
            )}

            <MediaStrip media={derived.media} name={game.name} onOpen={openMedia} />

            {(game.summary || game.storyline || derived.themeLinks.length > 0) && (
              <section className="mb-12" aria-labelledby="overview-heading">
                <SectionHeader id="overview-heading">Overview</SectionHeader>
                {game.summary && (
                  <p className="text-[15px] leading-relaxed text-white/70 max-w-prose m-0">{game.summary}</p>
                )}
                {/* The storyline runs to several paragraphs and spoils some of
                    them, so it waits behind a disclosure rather than doubling
                    the Overview for everyone. */}
                {game.storyline && (
                  <details className="group mt-4 max-w-prose">
                    <summary className="lh-label text-white/60 hover:text-white cursor-pointer list-none py-2 -my-2 inline-flex items-center gap-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white">
                      <span className="group-open:hidden">Read the story</span>
                      <span className="hidden group-open:inline">Hide the story</span>
                    </summary>
                    <p className="text-[15px] leading-relaxed text-white/70 mt-3 mb-0 whitespace-pre-line">{game.storyline}</p>
                  </details>
                )}
                {(derived.themeLinks.length > 0 || derived.perspectives) && (
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 mt-5">
                    {derived.themeLinks.length > 0 && <span className="lh-label text-white/60">Themes</span>}
                    {derived.themeLinks.map(t => (
                      <span key={t.id} className="text-sm"><TagLink to={t.to}>{t.label}</TagLink></span>
                    ))}
                    {derived.perspectives && (
                      <span className="text-sm text-white/70">{derived.perspectives}</span>
                    )}
                  </div>
                )}
              </section>
            )}

            {(derived.family.length > 0 || franchise) && (
              <section className="mb-12" aria-labelledby="family-heading">
                <SectionHeader
                  id="family-heading"
                  /* One way to the franchise. The timeline heading is that link
                     when there is a timeline; without one, this is. */
                  aside={franchise && !timeline && (
                    <Link
                      to={`/franchise/${franchise.id}`}
                      className="lh-label text-white/60 hover:text-white focus-visible:text-white underline decoration-white/30 underline-offset-4 py-2 -my-2 shrink-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors"
                    >
                      Part of {franchise.name}
                    </Link>
                  )}
                >
                  The Family
                </SectionHeader>
                {/* Where it sits in the series, then what it is related to. */}
                {timeline && (
                  <div className={derived.family.length > 0 ? 'mb-8' : ''}>
                    <SeriesTimeline timeline={timeline} franchise={franchise} gameName={game.name} />
                  </div>
                )}
                <FamilyBento groups={derived.family} />
              </section>
            )}

            {/* Awards — standalone table: prominent year + ceremony, wins on the right */}
            <AwardsSection gameId={game.id} />

            {derived.similar.length > 0 && (
              <section className="mb-12" aria-labelledby="similar-heading">
                <SectionHeader id="similar-heading">Similar Games</SectionHeader>
                <RelatedRow groups={[{ label: 'Picked by IGDB', games: derived.similar }]} />
          
              </section>
            )}
          </div>

          {/* ── Reference column: the record of the game, for looking things up ── */}
          <div className="min-w-0">
            <section className="mb-12" aria-labelledby="details-heading">
              <SectionHeader id="details-heading">Details</SectionHeader>
              <div className="border border-white/15">
                <IndexRow label="Released" value={derived.released || 'TBA'} />
                {datesDiffer(derived.platformDates) && (
                  <IndexRow
                    label="By Platform"
                    value={
                      <span className="flex flex-col items-end gap-1">
                        {derived.platformDates.map(r => (
                          <span key={r.platform}><span className="text-white/60">{r.platform}</span> {r.human}</span>
                        ))}
                      </span>
                    }
                  />
                )}
                <IndexLinks label="Developer" items={derived.devLink} />
                <IndexLinks label="Publisher" items={derived.pubLink} />
                <IndexLinks label="Genres" items={derived.genreLinks} />
                <IndexLinks label="Platforms" items={derived.platformLinks} />
                <IndexLinks label="Modes" items={derived.modeLinks} />
                <IndexLinks label="Engine" items={derived.engineLinks} />
                {derived.links.length > 0 && (
                  <IndexRow
                    label="Links"
                    value={derived.links.map((l, i) => (
                      <span key={l.label}>
                        {i > 0 && <span className="text-white/50"> · </span>}
                        <ExternalLink
                          href={l.url}
                          className="text-white underline decoration-white/30 underline-offset-4 p-1 -m-1 hover:bg-white hover:text-black hover:decoration-transparent focus-visible:bg-white focus-visible:text-black focus-visible:decoration-transparent focus-visible:outline-none transition-colors"
                        >
                          {l.label}
                        </ExternalLink>
                      </span>
                    ))}
                  />
                )}
              </div>
            </section>

            {hasConnections && (
              <section className="mb-12" aria-labelledby="appears-heading">
                <SectionHeader id="appears-heading">Appears In</SectionHeader>
                <div className="border border-white/15">
                  {/* Only the franchises after the first; the first heads The Family. */}
                  <IndexLinks
                    label="Other Franchises"
                    items={otherFranchises.map(f => ({ id: f.id, label: f.name, to: `/franchise/${f.id}` }))}
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
        </div>
      </div>

      {/* Platforms: where it runs, where it is sold, and which of those are
          yours. A dialog rather than a section, because it is a control you set
          once, and the page used to render the whole area twice over. */}
      {platformsOpen && (
        <Dialog
          open
          onClose={() => setPlatformsOpen(false)}
          label={`Platforms for ${game.name}`}
          panelClassName="w-full max-w-lg max-h-[85dvh] flex flex-col"
          alignClassName="items-end sm:items-center justify-center"
          className="p-0 sm:p-4"
        >
          <header className="h-12 shrink-0 flex items-center border-b border-white/15 pl-4">
            <span className="lh-label text-white/70">Platforms</span>
            <div className="flex-1" />
            <button
              onClick={() => setPlatformsOpen(false)}
              className="lh-label h-12 px-4 border-l border-white/15 text-white/60 hover:bg-white hover:text-black focus-visible:bg-white focus-visible:text-black focus-visible:outline-none transition-colors cursor-pointer"
            >
              Done
            </button>
          </header>
          <div className="p-4 overflow-y-auto">
            <PlatformSection
              game={game}
              userPlatforms={userPlatforms}
              selectedKeys={selectedPlatKeys}
              onToggle={togglePlatform}
            />
          </div>
        </Dialog>
      )}

      {transferOpen && libEntry && (
        <TransferDataModal
          sourceGame={libEntry}
          onClose={() => setTransferOpen(false)}
          onComplete={() => {
            setTransferOpen(false);
            setLibEntry(getLibrary().find(g => String(g.id) === String(id)) || null);
            toast('Data transferred');
          }}
        />
      )}

      {mediaLightbox}
    </div>
  );
}
