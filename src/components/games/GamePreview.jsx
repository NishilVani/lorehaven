import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, ImageOff, RotateCcw, ArrowRight } from 'lucide-react';
import { getGameById } from '../../services/igdb';
import { versionLabel, isCustom } from '../../services/duplicates';

const img = (id, size) => `https://images.igdb.com/igdb/image/upload/${size}/${id}.jpg`;

const yearOf = (entry, relation) => {
  const t = relation?.first_release_date ?? entry.first_release_date;
  if (t) return new Date(t * 1000).getUTCFullYear();
  return typeof entry.release_year === 'number' ? entry.release_year : null;
};

const fullDate = (unix) => new Date(unix * 1000).toLocaleDateString('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});

/* Images fade in once they have decoded, rather than painting in top to bottom
   over a grey box. Set on the element, not in state, so a strip of eight
   screenshots does not re-render the panel eight times. */
const reveal = (e) => { e.currentTarget.dataset.loaded = 'true'; };
const FADE = 'opacity-0 data-[loaded=true]:opacity-100 transition-opacity duration-200 ease-out motion-reduce:transition-none';

/* What tells the entries of a group apart, said as briefly as possible: the
   words left once the name they share is taken away ("Game of the Year
   Edition", "Complete Edition"). Where nothing is left, the kind or the year
   stands in, and two labels that still collide take the year. The first draft
   used the kind alone and put "Edition" on two buttons side by side. */
const bare = (w) => w.toLowerCase().replace(/[:,\-–—]+$/, '');
function shortLabels(group, relations, nameOf) {
  const words = group.members.map(m => nameOf(m).split(/\s+/).filter(Boolean));
  let shared = 0;
  while (words.every(w => w.length > shared && bare(w[shared]) === bare(words[0][shared]))) shared++;
  const labels = group.members.map((m, i) => {
    const rel = relations.get(String(m.id));
    const rest = words[i].slice(shared).join(' ').replace(/^[\s:,\-–—]+/, '').trim();
    return rest || versionLabel(m, rel) || String(yearOf(m, rel) || 'Original');
  });
  return labels.map((label, i) => {
    if (labels.filter(x => x === label).length < 2) return label;
    const m = group.members[i];
    return [label, yearOf(m, relations.get(String(m.id)))].filter(Boolean).join(', ');
  });
}

/**
 * What this entry is in relation to the others in its group, in words. The
 * preview exists to tell editions apart, so "Edition of Night Harbour" says
 * more than "Edition".
 */
function kindLine(member, group, relations, nameOf) {
  if (isCustom(member)) return 'Custom entry, not on IGDB';
  const id = String(member.id);
  const rel = relations.get(id) || {};
  const others = group.members.filter(m => m !== member);
  const has = (list, x) => (list || []).map(String).includes(String(x));
  const parent = others.find(m => String(m.id) === String(rel.version_parent));
  if (parent) return `Edition of ${nameOf(parent)}`;
  if (rel.version_parent != null) return 'Edition';
  for (const o of others) {
    const orel = relations.get(String(o.id)) || {};
    if (has(orel.remakes, id)) return `Remake of ${nameOf(o)}`;
    if (has(orel.remasters, id)) return `Remaster of ${nameOf(o)}`;
    if (has(orel.expanded_games, id)) return `Expanded version of ${nameOf(o)}`;
    if (has(orel.bundles, id)) return `Bundle containing ${nameOf(o)}`;
    if (has(rel.bundles, o.id)) return `Included in ${nameOf(o)}`;
  }
  return versionLabel(member, rel) || 'Main game';
}

/**
 * One game from a duplicate group, as IGDB has it: artwork, cover, what kind of
 * entry it is, release, studio, platforms, rating, summary and screenshots.
 *
 * Rendered in two containers by the page: docked beside the groups on wide
 * screens, and inside a Dialog (a right-hand panel, or a bottom sheet on a
 * phone) everywhere else. It owns its content, never its position.
 */
export default function GamePreview({ group, previewId, relations, nameOf, onSelect, onClose, headingId, headingRef }) {
  const member = group.members.find(m => String(m.id) === String(previewId)) || group.members[0];
  const id = String(member.id);
  const custom = isCustom(member);
  const relation = relations.get(id);
  const [results, setResults] = useState({});
  const [attempt, setAttempt] = useState(0);

  /* One request per game, remembered for the life of the panel, so flicking
     between the entries of a group costs nothing after the first look.
     getGameById is also cached for a week underneath. */
  useEffect(() => {
    if (custom || results[id]) return undefined;
    let live = true;
    getGameById(Number(member.id))
      .then(rows => { if (live) setResults(r => ({ ...r, [id]: { game: Array.isArray(rows) ? rows[0] || null : null } })); })
      .catch(() => { if (live) setResults(r => ({ ...r, [id]: { failed: true } })); });
    return () => { live = false; };
  }, [id, custom, member.id, results, attempt]);

  const result = results[id];
  const loading = !custom && !result;
  const failed = !!result?.failed;
  const game = result?.game || null;

  const retry = () => {
    setResults(r => Object.fromEntries(Object.entries(r).filter(([k]) => k !== id)));
    setAttempt(a => a + 1);
  };

  const title = game?.name || nameOf(member);
  const banner = game?.artworks?.[0]?.image_id || game?.screenshots?.[0]?.image_id || null;
  const cover = game?.cover?.image_id || member.cover_id || relation?.cover?.image_id || null;
  const companies = (role) => (game?.involved_companies || []).filter(c => c[role]).map(c => c.company?.name).filter(Boolean);
  const developers = companies('developer');
  const publishers = companies('publisher').filter(p => !developers.includes(p));
  const platforms = (game?.platforms || []).map(p => p.abbreviation || p.name).filter(Boolean);
  const genres = (game?.genres || []).map(g => g.name).filter(Boolean);
  const screenshots = (game?.screenshots || []).slice(0, 8);
  const rating = Number(game?.total_rating);

  const facts = game ? [
    ['Released', game.first_release_date ? fullDate(game.first_release_date) : null],
    ['Studio', developers.join(', ')],
    ['Publisher', publishers.join(', ')],
    ['Platforms', platforms.join(', ')],
    ['Genres', genres.join(', ')],
    ['IGDB Rating', Number.isFinite(rating) && rating > 0
      ? `${Math.round(rating)}${game.total_rating_count ? `, from ${game.total_rating_count} ratings` : ''}`
      : null],
  ] : [];

  return (
    /* flex-1 and min-h-0, not h-full: inside the phone sheet the panel has
       only a max-height, a percentage height resolves to nothing there, and
       the body would grow past the sheet instead of scrolling inside it. */
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/15 shrink-0">
        <p className="lh-label text-white/60 m-0">Preview</p>
        <button
          onClick={onClose}
          aria-label="Close preview"
          className="tap-block -m-1 p-1.5 flex text-white/60 hover:bg-white hover:text-black transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      {/* Every entry of the group, one press apart. Comparing two editions is
          the reason to open this, and closing and reopening it per entry would
          make that comparison a memory test. */}
      {group.members.length > 1 && (
        <div role="group" aria-label="Games in this group" className="flex flex-wrap gap-2 px-4 py-3 border-b border-white/15 shrink-0">
          {group.members.map((m, i) => {
            const on = String(m.id) === id;
            const rel = relations.get(String(m.id));
            const short = shortLabels(group, relations, nameOf)[i];
            return (
              <button
                key={String(m.id)}
                onClick={() => onSelect(m.id)}
                aria-pressed={on}
                /* Outlined when active, like the pressed Preview button: a white
                   fill on this page means "chosen to keep", and a white chip here
                   sat across from the white Keep chip and read as that. */
                className={`tap inline-flex items-center px-3 py-1.5 border cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black ${
                  on ? 'border-white text-white' : 'border-white/20 text-white/60 hover:border-white/70 hover:text-white'
                }`}
              >
                <span aria-hidden="true" className="lh-label">{short}</span>
                <span className="sr-only">{[nameOf(m), yearOf(m, rel), versionLabel(m, rel)].filter(Boolean).join(', ')}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Keyed by game, so switching entries starts from the top with fresh
          images rather than scrolling one game's screenshots under another's
          title. The swap itself is instant: it is a comparison, pressed again
          and again, and an animation per press would slow the eye down. */}
      <div key={id} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar overscroll-contain">
        {banner && (
          <div className="aspect-video bg-neutral-900 border-b border-white/10 overflow-hidden">
            <img src={img(banner, 't_screenshot_big')} alt="" onLoad={reveal} className={`w-full h-full object-cover ${FADE}`} />
          </div>
        )}

        <div className="px-4 pt-4 pb-6 flex flex-col gap-5">
          <div className="flex gap-4 min-w-0">
            <span className="w-20 h-[6.65rem] shrink-0 bg-neutral-900 border border-white/10 overflow-hidden flex items-center justify-center">
              {cover
                ? <img src={img(cover, 't_cover_big')} alt="" onLoad={reveal} className={`w-full h-full object-cover ${FADE}`} />
                : <ImageOff className="w-5 h-5 text-white/50" aria-hidden="true" />}
            </span>
            <div className="min-w-0 pt-0.5">
              {/* The title is the panel's heading and its accessible name, so a
                  screen reader moving by heading lands on the game, not on the
                  word "Preview". Focus arrives here when the panel opens. */}
              <h2 id={headingId} ref={headingRef} tabIndex={-1} className="lh-display text-[20px] leading-tight text-white m-0 break-words outline-none">{title}</h2>
              <p className="lh-label text-white/60 mt-2 mb-0 break-words">{kindLine(member, group, relations, nameOf)}</p>
            </div>
          </div>

          <div aria-live="polite">
            {loading && <p className="text-[13px] text-white/60 m-0">Loading {title} from IGDB.</p>}
            {failed && (
              <div className="border border-[var(--warning-border)] px-3 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <p className="text-[13px] text-white/80 m-0">IGDB did not send this game, so only its name and cover are shown.</p>
                <button
                  onClick={retry}
                  className="tap lh-label inline-flex items-center gap-2 px-3 py-2 border border-white/20 text-white/70 hover:border-white/70 hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  Try Again
                </button>
              </div>
            )}
            {custom && (
              <p className="text-[13px] text-white/60 m-0">
                You added this game by hand, so IGDB has nothing more on it. Its column holds everything you recorded.
              </p>
            )}
          </div>

          {game && (
            <>
              {/* The metadata table from DESIGN.md: muted label, white value,
                  1px rules. Rows with no value are left out rather than filled
                  with a dash, because a missing publisher is not a fact. */}
              <dl className="m-0 border-t border-white/10 text-[13px]">
                {facts.filter(([, v]) => v).map(([term, value]) => (
                  <div key={term} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 py-2 border-b border-white/10">
                    <dt className="lh-label text-white/60 pt-0.5">{term}</dt>
                    <dd className="m-0 text-white break-words">{value}</dd>
                  </div>
                ))}
              </dl>

              {game.summary && (
                <p className="text-[13px] leading-relaxed text-white/70 m-0 max-w-[65ch] whitespace-pre-line">{game.summary}</p>
              )}

              {screenshots.length > 0 && (
                <section aria-label={`Screenshots of ${title}`}>
                  <h3 className="lh-label text-white/60 m-0 mb-2">Screenshots</h3>
                  {/* Focusable, so a keyboard can scroll it sideways. */}
                  <ul
                    tabIndex={0}
                    className="flex gap-2 overflow-x-auto snap-x snap-mandatory m-0 p-0 pb-2 list-none custom-scrollbar focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
                  >
                    {screenshots.map((s, i) => (
                      <li key={s.image_id} className="snap-start shrink-0 w-[85%] aspect-video bg-neutral-900 border border-white/10 overflow-hidden">
                        <img
                          src={img(s.image_id, 't_screenshot_med')}
                          alt={`Screenshot ${i + 1} of ${screenshots.length}`}
                          loading="lazy"
                          onLoad={reveal}
                          className={`w-full h-full object-cover ${FADE}`}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <Link
                to={`/game/${member.id}`}
                className="self-start lh-label inline-flex items-center gap-2 px-4 py-2.5 border border-white/20 text-white/70 hover:bg-white hover:text-black hover:border-white transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
              >
                Open Game Page
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
