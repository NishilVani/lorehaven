import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, MoreVertical,
  Gamepad2, List as ListIcon, Heart, Trophy, CircleMinus, X,
} from 'lucide-react';
import EmptyPlate from '../../components/ui/EmptyPlate';
import GameCard from '../../components/games/GameCard';
import DropdownMenu from '../../components/ui/DropdownMenu';
import { toast } from '../../components/ui/toastBus';
import { fetchCeremony, stripCeremonyPrefix, getCachedAwardGames, cacheAwardGames } from '../../services/wikidata/awards';
import { getGamesByIds } from '../../services/igdb';
import { getLibrary, saveToLibrary, removeFromLibrary } from '../../services/db';
import { statusColor } from '../../constants/stateColors';
import useConfirm from '../../hooks/useConfirm';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import useWikidataProgress from '../../hooks/useWikidataProgress';

const STATUSES = ['Wishlist', 'Backlog', 'Playing', 'Beaten', 'Dropped'];
// Same icon set GameCard's ⋯ menu uses, so both menus read identically
const STATUS_ICONS = {
  Playing: Gamepad2, Backlog: ListIcon, Wishlist: Heart, Beaten: Trophy, Dropped: CircleMinus,
};

const img = (id, size) => `https://images.igdb.com/igdb/image/upload/t_${size}/${id}.jpg`;
const normTitle = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const isGoty = (c) => /game of the year|best game(?!\s*(direction|design))/i.test(c);

const HATCH = 'repeating-linear-gradient(45deg,rgba(255,255,255,0.06) 0 8px,rgba(255,255,255,0.02) 8px 16px)';

/* ── Bits ──────────────────────────────────────────────────────────────── */

function Anchor({ game, className, children, ...rest }) {
  if (!game) return <div className={className} {...rest}>{children}</div>;
  if (game.id != null) return <Link to={`/game/${game.id}`} className={className} {...rest}>{children}</Link>;
  if (game.href) return <a href={game.href} target="_blank" rel="noopener noreferrer" className={className} {...rest}>{children}</a>;
  return <div className={className} {...rest}>{children}</div>;
}

/** Instant custom tooltip — native `title` waits ~1s before showing. */
/**
 * Reveals on focus-within as well as hover, so keyboard users get the label too
 * (WCAG 2.1.1 / 1.4.13). The wrapper carries the tooltip text as its own accessible
 * name — the poster inside is an image link whose target is this same label — so a
 * screen reader announces it without needing the visual layer at all.
 */
function Tip({ label, children, className = '' }) {
  return (
    <span className={`group/tip relative block ${className}`} title={label}>
      {children}
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-[60] opacity-0 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100 transition-opacity duration-100 whitespace-nowrap bg-black border border-white/40 px-2 py-1 lh-label text-white">
        {label}
      </span>
    </span>
  );
}

/** Hairline lead-in rule. Must be `block` — and must live OUTSIDE any
 *  .award-shine element, whose background-clip:text hides child backgrounds. */
const Rule = ({ w = 'w-7' }) => <span className={`${w} h-px bg-white/40 shrink-0 block`} />;

function Poster({ game, className = '', initialSize = 'text-5xl', sticker = true, stickerSize = 'md' }) {
  if (!game) return null;
  const color = statusColor(game.status);
  const s = stickerSize === 'sm'
    ? { pad: 'px-1.5 py-[3px] pl-2', font: 'text-[8px]', fold: 5, bottom: 'bottom-1.5' }
    : { pad: 'px-[9px] py-[5px] pl-[11px]', font: 'text-[10px]', fold: 8, bottom: 'bottom-3' };
  return (
    <div className={`relative shrink-0 aspect-[3/4] border border-white/30 overflow-hidden ${className}`} style={{ background: HATCH }}>
      {game.cover_id ? (
        <img src={img(game.cover_id, 'cover_big')} alt={game.name} loading="lazy" className="w-full h-full object-cover" />
      ) : (
        <span className={`lh-display absolute inset-0 flex items-center justify-center text-white/50 ${initialSize}`}>
          {(game.name || '?')[0]}
        </span>
      )}
      {game.id == null && <span className="lh-label absolute top-1 right-1 text-white/60 leading-none">NO IGDB</span>}
      {sticker && game.status && (
        <div className={`absolute ${s.bottom} -left-1 -rotate-6 origin-bottom-left z-[2]`}>
          <span className={`block text-black font-bold uppercase leading-none whitespace-nowrap ${s.pad} ${s.font}`}
            style={{ background: color, letterSpacing: '0.1em', clipPath: `polygon(0 0,100% 0,100% calc(100% - ${s.fold}px),calc(100% - ${s.fold}px) 100%,0 100%)` }}>
            {game.status}
          </span>
          <span className="absolute bottom-0 right-0" style={{ width: s.fold, height: s.fold, background: color, filter: 'brightness(0.55)', clipPath: 'polygon(0 0,100% 0,0 100%)' }} />
        </div>
      )}
    </div>
  );
}

/** A nominee: real GameCard (scaled by its container) + instant tooltip.
 *  Entries with no IGDB id can't use GameCard — it navigates/shelves by id. */
function NomineeCard({ game, width }) {
  const body = game.id == null ? (
    <Anchor game={game} className="group block">
      <Poster game={game} initialSize="text-2xl" stickerSize="sm" className="opacity-85 group-hover:opacity-100 transition-opacity" />
      <div className="lh-label text-white/50 mt-1.5 leading-[1.4] line-clamp-2">{game.name}</div>
    </Anchor>
  ) : (
    <GameCard game={{ id: game.id, name: game.name, cover_id: game.cover_id, dev: game.dev, release_year: game.release_year }} />
  );
  return (
    <Tip label={game.name} className={width ? 'shrink-0' : ''}>
      {width ? <span className="block" style={{ width }}>{body}</span> : body}
    </Tip>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */

/* Module-level on purpose. Declared inside the page's render it was a new component
   type every render, so shelving a winner remounted the ⋯ trigger and the menu had
   nothing to return focus to (phase 5 case 73b). */
function WinnerMenu({ game, opts }) {
  if (!opts.length) return null;
  return (
    <DropdownMenu options={opts} align="right">
      <button aria-label={game?.name ? `Options for ${game.name}` : 'Winner options'} className="p-1 text-white/60 hover:text-white transition-colors cursor-pointer shrink-0">
        <MoreVertical className="w-4 h-4" />
      </button>
    </DropdownMenu>
  );
}

export default function AwardCeremony() {
  const { awardQid } = useParams();
  const navigate = useNavigate();
  // The active year lives in the URL (?year=) so it's shareable and deep-linkable;
  // ?cat= deep-links a category. No year state — activeYear is derived below.
  const [searchParams, setSearchParams] = useSearchParams();
  const yearParam = searchParams.get('year');
  const catParam = searchParams.get('cat');

  /* The route param goes straight into a SPARQL query, so only a well-formed
     QID is allowed through. Checked during render and used to seed the three
     states below, rather than pushed into them from the top of the load effect
     — a bad id used to get a frame of the loading state first. The route is
     keyed by pathname, so a different id is a fresh mount and these
     initialisers run again. */
  const invalidQid = !/^Q\d+$/.test(awardQid || '');

  const [label, setLabel] = useState('');
  const [wins, setWins] = useState([]);
  const [noms, setNoms] = useState([]);
  /* Winners are on screen and the nominee query is still running. Distinct from
     `loading`, which means nothing is on screen at all. */
  const [nomsPending, setNomsPending] = useState(false);
  const [byId, setById] = useState({});
  const [loading, setLoading] = useState(() => !invalidQid);
  const [errorKind] = useState(() => (invalidQid ? 'invalid' : null));
  const [error, setError] = useState(() => (invalidQid ? 'Invalid award id' : null));
  /* Synchronous localStorage read, seeded here rather than by readLibrary()
     inside the load effect. */
  const [libraryMap, setLibraryMap] = useState(() => {
    const lib = {};
    getLibrary().forEach(g => { lib[String(g.id)] = g.status; });
    return lib;
  });
  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState(-1);
  const attempt = useWikidataProgress(loading);

  const [confirm, confirmProps] = useConfirm();
  const activeRef = useRef(null);
  const stripRef = useRef(null);

  /* Still needed: a card elsewhere in the app can change the library while this
     page is open, and the listener below re-reads it. Only the initial read
     moved to the useState initialiser above. */
  const readLibrary = useCallback(() => {
    const lib = {};
    getLibrary().forEach(g => { lib[String(g.id)] = g.status; });
    setLibraryMap(lib);
  }, []);

  useEffect(() => {
    let cancelled = false;
    /* No reset here: the route is keyed by pathname, so all eight already hold
       their initial true / null / null / [] / [] / {} / 0 / -1, and libraryMap
       is seeded by its useState initialiser. */

    if (invalidQid) return () => { cancelled = true; };

    (async () => {
      try {
        /* Paint on the first tier that answers — local, then the shared cache,
           then Wikidata — rather than holding the skeleton until the slowest one
           returns. Same reason as the awards index. */
        const paint = (d) => {
          if (cancelled || !d) return;
          /* Guarded: the winners-only paint carries no label when the ceremonies
             cache is cold, and an unconditional set would wipe the real title the
             seed tier already put on screen. */
          if (d.label) setLabel(d.label);
          /* `_seed` is the label-only tier-0 paint. Show the ceremony's real name
             immediately, but stay in the loading state — rendering its empty wins
             array would claim the ceremony has no winners. */
          if (d._seed) return;
          setWins(d.wins); setNoms(d.nominees || []);
          /* `_partial` is the winners-only paint: real winners, nominees still in
             flight. Every nominee block is written as `length > 0 &&`, so an empty
             array renders nothing rather than a false zero — but "nothing" and
             "none were nominated" look identical, and a category opened during
             this window would read as having had no other contenders. The flag is
             what lets those blocks say they are still waiting. */
          setNomsPending(!!d._partial);
          setLoading(false);
        };
        const { label: lbl, wins: wRows, nominees: nRows } = await fetchCeremony(awardQid, paint);
        if (cancelled) return;
        setLabel(lbl); setWins(wRows); setNoms(nRows || []); setNomsPending(false); setLoading(false);

        const ids = [...new Set([...wRows, ...(nRows || [])].map(w => w.igdbId).filter(Boolean))];
        if (ids.length) {
          /* The awards projection first, and it usually answers everything: one
             ceremony resolves to hundreds of games, and asking IGDB for all of
             them on every visit is what made a revisit as slow as a first visit.
             Covers paint from here with no request at all; only ids this cache
             has never seen go to the network. */
          const { byId, missing } = getCachedAwardGames(ids);
          if (Object.keys(byId).length && !cancelled) setById({ ...byId });
          if (missing.length) {
            const games = await getGamesByIds(missing.map(Number));
            if (cancelled) return;
            cacheAwardGames(games || []);
            const map = { ...byId };
            (games || []).forEach(g => { map[String(g.id)] = g; });
            setById(map);
          }
        }
      } catch (e) {
        if (!cancelled) { setError(e.message); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [awardQid]);

  // Keep winner stickers in sync when a card elsewhere changes the library
  useEffect(() => {
    window.addEventListener('moctale_lib_update', readLibrary);
    return () => window.removeEventListener('moctale_lib_update', readLibrary);
  }, [readLibrary]);


  /** ⋯ menu for a winner — mirrors GameCard's shelf actions. */
  const winnerMenu = (g) => {
    if (!g || g.id == null) return [];
    const entry = getLibrary().find(x => String(x.id) === String(g.id));
    const shelve = (status) => () => {
      saveToLibrary({
        ...(entry || {}), id: g.id, name: g.name, status, is_custom: false,
        cover_id: g.cover_id || null, release_year: g.release_year || null,
        cover_width: 264, cover_height: 374,
      });
      window.dispatchEvent(new Event('moctale_lib_update'));
      toast(entry ? `Moved to ${status}` : `Added to ${status}`);
    };
    const opts = STATUSES.filter(s => s !== entry?.status).map(s => {
      const Icon = STATUS_ICONS[s];
      return {
        label: `${entry ? 'Move to' : 'Add to'} ${s}`,
        icon: Icon ? () => <Icon className="w-2.5 h-2.5" /> : null,
        variant: s === 'Wishlist' && !entry ? 'accent' : 'default',
        onClick: shelve(s),
      };
    });
    if (entry) opts.push({
      label: 'Remove from Library', variant: 'danger', dividerAbove: true,
      icon: () => <X className="w-2.5 h-2.5" />,
      onClick: () => confirm(
        { eyebrow: 'Library', title: `Remove ${g.name}?`, body: 'Its status, rating, priority, notes and completion date go with it. There is no undo.', confirmLabel: 'Remove' },
        () => {
          removeFromLibrary(g.id);
          window.dispatchEvent(new Event('moctale_lib_update'));
          toast('Removed from Library');
        },
      ),
    });
    return opts;
  };

  const byYear = useMemo(() => {
    const toGame = (w) => {
      const g = w.igdbId ? byId[String(w.igdbId)] : null;
      // If IGDB ID present but not found in fetched IGDB data, treat as null/unresolved
      const id = (w.igdbId && g) ? Number(w.igdbId) : null;
      return {
        key: id != null ? `id:${id}` : `t:${normTitle(w.gameTitle)}`,
        id,
        name: g?.name || w.gameTitle,
        cover_id: g?.cover?.image_id || null,
        art_id: g?.artworks?.[0]?.image_id || g?.screenshots?.[0]?.image_id || null,
        status: id != null ? libraryMap[String(id)] : null,
        dev: g?.involved_companies?.find(ic => ic.developer)?.company?.name || null,
        release_year: g?.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null,
        href: id != null ? null : (w.site || (w.gameQid ? `https://www.wikidata.org/wiki/${w.gameQid}` : null)),
      };
    };

    const map = new Map();
    const bucket = (w, kind) => {
      const yr = w.year ?? 'Undated';
      if (!map.has(yr)) map.set(yr, { cats: new Map(), games: 0 });
      const slot = map.get(yr);
      if (w.isGame) slot.games++;
      if (!slot.cats.has(w.categoryQid)) {
        slot.cats.set(w.categoryQid, {
          qid: w.categoryQid, label: stripCeremonyPrefix(w.categoryLabel, label),
          winners: [], nominees: [], seen: new Set(),
        });
      }
      const c = slot.cats.get(w.categoryQid);
      const g = toGame(w);
      if (c.seen.has(g.key)) return;
      c.seen.add(g.key);
      (kind === 'win' ? c.winners : c.nominees).push(g);
    };
    wins.forEach(w => bucket(w, 'win'));
    noms.forEach(w => bucket(w, 'nom'));

    const out = new Map();
    for (const [yr, slot] of map) {
      // Ceremonies drag in unrelated awards via P361 (e.g. BAFTA Fellowship,
      // a film award, sits under the GAMES awards) — drop game-less years.
      if (slot.games === 0) continue;
      out.set(yr, [...slot.cats.values()].sort((a, b) =>
        (isGoty(b.label) - isGoty(a.label)) || a.label.localeCompare(b.label)));
    }
    return out;
  }, [wins, noms, byId, libraryMap, label]);

  const yearsList = useMemo(() => [...byYear.keys()].sort(
    (a, b) => (a === 'Undated' ? 1 : b === 'Undated' ? -1 : b - a)), [byYear]);

  // `??` does not catch NaN, so ?year=abc (and any year the ceremony lacks)
  // used to select nothing and render a blank field. Validate against the data.
  const requested = yearParam === null ? null : yearParam === 'Undated' ? 'Undated' : Number(yearParam);
  const activeYear = (requested !== null && byYear.has(requested)) ? requested : yearsList[0];
  const categories = byYear.get(activeYear) || [];
  const hero = categories[0];
  const rest = categories.slice(1);
  const heroWinner = hero?.winners[0];
  const detail = rest[Math.min(sel, Math.max(0, rest.length - 1))];

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [activeYear]);

  // Follow the ?cat deep-link — select/expand that category once its year loaded.
  // The hero category (index 0) is always shown, so only the rest need selecting.
  /* Apply the ?cat= deep link, during render. The key deliberately excludes the
     category array itself — that is a new array every render, and depending on
     it re-applied the link after every setSel, undoing the user's click. It
     includes the year's category count so the link still lands on the render
     where the data finally arrives. */
  const deepLinkKey = `${catParam}|${activeYear}|${(byYear.get(activeYear) || []).length}`;
  const [deepLinkFor, setDeepLinkFor] = useState(null);
  if (deepLinkFor !== deepLinkKey) {
    setDeepLinkFor(deepLinkKey);
    const r = (byYear.get(activeYear) || []).slice(1);
    if (catParam && r.length > 0) {
      const idx = r.findIndex(c => c.qid === catParam);
      if (idx >= 0) { setSel(idx); setOpen(idx); }
    }
  }

  const nudge = (d) => stripRef.current?.scrollBy({ left: d * 280, behavior: 'smooth' });
  const pickYear = (y) => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      p.set('year', String(y));
      p.delete('cat');           // a different year resets the category selection
      return p;
    }, { replace: false });    // a year is a place; Back should return to the one before
    setSel(0); setOpen(-1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const span = useMemo(() => {
    const ys = yearsList.filter(y => y !== 'Undated');
    if (!ys.length) return null;
    const lo = Math.min(...ys), hi = Math.max(...ys);
    return lo === hi ? String(lo) : `${lo}–${hi}`;
  }, [yearsList]);

  return (
    <div className="min-h-screen bg-black text-white pb-20 animate-in fade-in duration-500">
      <ConfirmDialog {...confirmProps} />

      <div className="content-container pt-2">
        <button onClick={() => navigate('/awards')} className="lh-label text-white/60 hover:text-white transition-colors cursor-pointer block py-2 -my-2">
          ← Awards
        </button>
        <div className="lh-label text-white/60 mt-7">
          Ceremony{span ? ` · ${span}` : ''}{yearsList.length ? ` · ${yearsList.length} Years` : ''}
        </div>
        <h1 className="lh-display text-white m-0 mt-2.5 break-words leading-[0.92]" style={{ fontSize: 'clamp(36px,6vw,72px)' }}>
          {label || (loading ? 'Loading' : 'Award')}
        </h1>
      </div>

      {error ? (
        <div className="content-container mt-8">
          {/* A malformed id was never sent anywhere, so reporting the source as
              unreachable blamed the wrong thing. */}
          <EmptyPlate
            title={errorKind === 'invalid' ? 'Not An Award Id' : 'Wikidata Unreachable'}
            body={errorKind === 'invalid'
              ? `${awardQid} is not a Wikidata QID. Award ids look like Q18642757.`
              : error}
          />
        </div>
      ) : loading ? (
        <div className="content-container mt-7">
          {attempt > 1 && (
            <div className="lh-label text-white/50 pb-3">Wikidata is throttling. Attempt {attempt} of 3.</div>
          )}
          <div className="border-y border-white/15 py-4 flex gap-7">
            {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-6 w-14 bg-white/10 animate-pulse" />)}
          </div>
          <div className="flex gap-11 py-12">
            <div className="w-[190px] aspect-[3/4] bg-white/[0.06] animate-pulse" />
            <div className="flex-1 space-y-4 pt-4">
              <div className="h-3 w-40 bg-white/10 animate-pulse" />
              <div className="h-14 w-2/3 bg-white/[0.06] animate-pulse" />
            </div>
          </div>
        </div>
      ) : yearsList.length === 0 ? (
        <div className="content-container mt-8">
          <EmptyPlate title="No Winners" body="Wikidata lists no game winners for this award" />
        </div>
      ) : (
        <>
          {/* Year strip — sticky BELOW the Tauri titlebar / mobile nav bar */}
          {/* --mobile-nav-offset tracks where the header's bottom edge is, which
              is not the height it reserves: on scroll-down the header slides away
              and this strip used to keep holding its place 56px lower. */}
          <div className="sticky z-50 bg-black border-y border-white/15 mt-7 top-[calc(var(--mobile-nav-offset,56px)+var(--titlebar-h,0px))] lg:top-[var(--titlebar-h,0px)] transition-[top] duration-300 ease-in-out motion-reduce:transition-none">
            <div className="content-container flex items-stretch">
              <button onClick={() => nudge(-1)} aria-label="Earlier years"
                className="hidden sm:flex items-center pr-3 text-white/50 hover:text-white transition-colors cursor-pointer shrink-0">
                <ChevronLeft className="w-5 h-5" />
              </button>
              {/* aria-current: the white underline is the only thing marking the active
                  year, and none of it reaches a screen reader. WCAG 4.1.2. */}
              <div ref={stripRef} role="group" aria-label="Ceremony year" className="lh-xscroll flex items-baseline gap-7 overflow-x-auto py-4 flex-1 [mask-image:linear-gradient(to_right,#000_calc(100%-40px),transparent)] lg:[mask-image:none]">
                {yearsList.map(y => (
                  <button key={y} ref={y === activeYear ? activeRef : null} onClick={() => pickYear(y)}
                    aria-current={y === activeYear ? 'true' : undefined}
                    className={`lh-display text-xl sm:text-2xl leading-none shrink-0 cursor-pointer border-b-2 pb-1.5 transition-colors ${
                      y === activeYear ? 'text-white border-white' : 'text-white/50 border-transparent hover:text-white'}`}>
                    {y}
                  </button>
                ))}
              </div>
              <button onClick={() => nudge(1)} aria-label="Later years"
                className="hidden sm:flex items-center pl-3 text-white/50 hover:text-white transition-colors cursor-pointer shrink-0">
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* ── Game of the Year hero ── */}
          {heroWinner && (
            <div key={`hero-${activeYear}`} className="relative border-b border-white/15 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
              {heroWinner.art_id ? (
                <img src={img(heroWinner.art_id, '1080p')} alt="" className="absolute inset-0 w-full h-full object-cover" />
              ) : (
                <div className="absolute inset-0" style={{ background: 'repeating-linear-gradient(-45deg,rgba(255,255,255,0.045) 0 10px,rgba(255,255,255,0.012) 10px 20px)' }} />
              )}
              <div className="absolute inset-0 bg-black/85" />

              {/* items-stretch: the poster grows to match the text+nominee column */}
              <div className="content-container relative flex items-stretch gap-5 lg:gap-11 py-8 lg:py-12">
                <Anchor game={heroWinner} className="shrink-0 block w-[118px] lg:w-[200px]">
                  <Poster game={heroWinner} className="h-full w-full max-lg:w-[118px]" initialSize="text-5xl" />
                </Anchor>

                <div className="min-w-0 flex-1 flex flex-col">
                  <div className="flex items-center gap-3">
                    <Rule />
                    <span className="lh-label award-shine">{hero.label}</span>
                  </div>
                  <div className="flex items-start gap-2 mt-3 lg:mt-4">
                    <Anchor game={heroWinner} className="block hover:opacity-80 transition-opacity min-w-0">
                      <span className="lh-display text-white leading-[0.95] break-words block" style={{ fontSize: 'clamp(28px,5vw,64px)' }}>
                        {heroWinner.name}
                      </span>
                    </Anchor>
                    <WinnerMenu game={heroWinner} opts={winnerMenu(heroWinner)} />
                  </div>
                  {heroWinner.dev && <div className="lh-label text-white/60 mt-2.5">{heroWinner.dev}</div>}

                  {/* Plain posters here, not GameCards: at this size the disc-box
                      chrome (spine + band + strip) squashes the art to nothing.
                      The name lives in the hover tooltip instead. */}
                  {hero.nominees.length === 0 && nomsPending && (
                    <div className="mt-5 lg:mt-7">
                      <div className="lh-label text-white/50 mb-2">Also Nominated</div>
                      <div className="lh-label text-white/60">Reading the field&hellip;</div>
                    </div>
                  )}

                  {hero.nominees.length > 0 && (
                    <div className="mt-5 lg:mt-7">
                      <div className="lh-label text-white/50 mb-2">Also Nominated</div>
                      <div className="lh-xscroll flex gap-2.5 overflow-x-auto pb-1">
                        {hero.nominees.slice(0, 12).map(n => (
                          <Tip key={n.key} label={n.name} className="shrink-0">
                            <Anchor game={n} className="block h-[104px] lg:h-[132px] aspect-[3/4] opacity-70 hover:opacity-100 transition-opacity">
                              <Poster game={n} className="h-full w-full" initialSize="text-lg" stickerSize="sm" />
                            </Anchor>
                          </Tip>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="content-container">
            {/* ── Desktop: index + detail ── */}
            <div className="hidden lg:grid" style={{ gridTemplateColumns: '300px 1fr' }}>
              <div className={`pr-4 ${rest.length ? 'border-r border-white/[0.12]' : ''}`}>
                <div className="lh-label text-white/50 py-4">{rest.length} More Categories</div>
                {rest.map((c, i) => {
                  const w = c.winners[0];
                  const on = i === Math.min(sel, rest.length - 1);
                  return (
                    <button key={c.qid} aria-current={sel === i ? 'true' : undefined}
                      onClick={() => {
                        setSel(i);
                        // A click supersedes the ?cat deep link; drop it so it cannot be re-applied.
                        setSearchParams(prev => { const p = new URLSearchParams(prev); p.delete('cat'); return p; }, { replace: true });
                      }}
                      className={`w-full text-left pl-3 pr-2 py-3 scroll-mt-20 border-t border-white/10 border-l-2 cursor-pointer transition-colors ${
                        on ? 'bg-white/[0.06] border-l-white' : 'border-l-transparent hover:bg-white/[0.04]'}`}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className={`lh-label leading-[1.5] ${on ? 'text-white' : 'text-white/60'}`}>{c.label}</span>
                        {c.nominees.length > 0 && <span className="lh-label text-white/50 shrink-0">+{c.nominees.length}</span>}
                      </div>
                      <div className="lh-display text-[13px] text-white/50 mt-1.5 truncate">{w?.name || '—'}</div>
                    </button>
                  );
                })}
              </div>

              {detail && (
                <div key={`${activeYear}-${detail.qid}`} className="pl-8 py-7 scroll-mt-20 animate-in fade-in duration-300 min-w-0">
                  <div className="flex items-baseline justify-between gap-4">
                    {/* must be a <span>: .award-shine is defined as
                        `.award-shine:not(div), .award-shine span`, so a div never shines.
                        !whitespace-normal overrides the rule's nowrap so long
                        category names wrap instead of overflowing. */}
                    <span className="lh-display award-shine text-[34px] leading-none block !whitespace-normal">{detail.label}</span>
                    <span className="lh-label text-white/50 shrink-0">{activeYear}</span>
                  </div>

                  <div className="flex gap-7 mt-6 items-start">
                    <Anchor game={detail.winners[0]} className="shrink-0 block w-[190px]">
                      <Poster game={detail.winners[0]} />
                    </Anchor>
                    <div className="pt-1.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2.5">
                        <Rule w="w-5" />
                        <span className="lh-label text-white/60">Winner</span>
                      </div>
                      <div className="flex items-start gap-2 mt-3">
                        <Anchor game={detail.winners[0]} className="block hover:opacity-80 transition-opacity min-w-0">
                          <span className="lh-display text-[30px] leading-[1.05] break-words">{detail.winners[0]?.name || 'No winner recorded'}</span>
                        </Anchor>
                        <WinnerMenu game={detail.winners[0]} opts={winnerMenu(detail.winners[0])} />
                      </div>
                      {detail.winners[0]?.dev && <div className="lh-label text-white/60 mt-3">{detail.winners[0].dev}</div>}
                    </div>
                  </div>

                  {detail.nominees.length === 0 && nomsPending && (
                    <>
                      <div className="lh-label text-white/50 mt-8 border-t border-white/[0.12] pt-4">Also Nominated</div>
                      <div className="lh-label text-white/60 mt-4">Reading the field&hellip;</div>
                    </>
                  )}

                  {detail.nominees.length > 0 && (
                    <>
                      <div className="lh-label text-white/50 mt-8 border-t border-white/[0.12] pt-4">Also Nominated</div>
                      <div className="grid grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 mt-4">
                        {detail.nominees.map(n => <NomineeCard key={n.key} game={n} />)}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* ── Mobile: accordion ── */}
            <div className="lg:hidden">
              <div className="lh-label text-white/50 py-3.5">{rest.length} More Categories</div>
              {rest.map((c, i) => {
                const w = c.winners[0];
                const on = open === i;
                return (
                  <div key={c.qid} className={`border-t border-white/10 transition-colors ${on ? 'bg-white/[0.03]' : ''}`}>
                    <button onClick={() => setOpen(on ? -1 : i)} aria-expanded={on} className="w-full text-left flex items-center justify-between gap-3.5 py-3.5 cursor-pointer">
                      <span className="min-w-0">
                        <span className="flex items-baseline gap-2.5">
                          <span className={`lh-label leading-[1.5] ${on ? 'award-shine' : 'text-white/55'}`}>{c.label}</span>
                          {c.nominees.length > 0 && <span className="lh-label text-white/50">+{c.nominees.length}</span>}
                        </span>
                        <span className="lh-display text-[15px] text-white block mt-1 truncate">{w?.name || '—'}</span>
                      </span>
                      {/* Tailwind v4 rotate-* sets the standalone `rotate` property,
                          so transition-all (not transition-transform) animates it */}
                      <span className={`text-base shrink-0 transition-all duration-300 ${on ? 'text-white rotate-45' : 'text-white/50'}`}>+</span>
                    </button>

                    {/* max-height:0 collapses the box but leaves its links in the tab
                        order — the panel has to be inert while closed. */}
                    <div inert={!on} className="overflow-hidden transition-all duration-400" style={{ maxHeight: on ? 900 : 0, opacity: on ? 1 : 0 }}>
                      <div className="pb-6 pt-1">
                        <div className="flex gap-4 items-start">
                          <Anchor game={w} className="shrink-0 block w-[104px]"><Poster game={w} initialSize="text-3xl" stickerSize="sm" /></Anchor>
                          <div className="min-w-0 pt-1 flex-1">
                            <div className="flex items-center gap-2">
                              <Rule w="w-4" />
                              <span className="lh-label text-white/60">Winner</span>
                            </div>
                            <div className="flex items-start gap-1.5 mt-2">
                              <Anchor game={w} className="block min-w-0"><span className="lh-display text-xl leading-[1.05] break-words">{w?.name || '—'}</span></Anchor>
                              <WinnerMenu game={w} opts={winnerMenu(w)} />
                            </div>
                            {w?.dev && <div className="lh-label text-white/60 mt-2">{w.dev}</div>}
                          </div>
                        </div>
                        {c.nominees.length > 0 && (
                          <>
                            <div className="lh-label text-white/50 mt-5 border-t border-white/[0.12] pt-3">Also Nominated</div>
                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 mt-3">
                              {c.nominees.map(n => <NomineeCard key={n.key} game={n} />)}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div className="border-t border-white/15" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
