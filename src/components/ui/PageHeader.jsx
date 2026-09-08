import { Link } from 'react-router-dom';

/**
 * One page header, in one place.
 *
 * Every page had grown its own, and they had drifted into the same three-part
 * shape: a back link, then an eyebrow, then the title. All three are the same
 * 11px uppercase grey, so a page opened with two identical-looking lines before
 * anything said what the page was — and the eyebrow almost always repeated
 * whatever sat either side of it.
 *
 * Measured on /explore/updates: the header rendered three consecutive 11px
 * lines — "← Explore", "Explore — Your Library", "0" — above an h1 reading
 * "Library Updates". The word Explore appeared twice before the title and the
 * count appeared before it too. /collections was the same shape without the
 * back link: "Library — Collections" above "Collections".
 *
 * So the eyebrow is gone. craft-floor bans it outright — the heading carries its
 * own weight — and where it held something real (a franchise's year span, a
 * collection's kind, a game's year and studio) that is metadata, which belongs
 * under the title with the count rather than above it dressed as a label.
 *
 * The count moved down for a second, separate reason. `.lh-label` is pinned at
 * 11px by an unlayered rule, so a count set beside a 60px display title is a
 * 5.5:1 pairing baseline-aligned to a face with deep descenders. Measured: the
 * count's box sat 8px above the h1's. That is the box model working correctly
 * and still reading as something dropped off the bottom of the title.
 *
 * The result is three bands with three different jobs: where you came from, what
 * this is, and what is in it.
 *
 * @param {object}  o
 * @param {object}  [o.back]     — { label, to } for a route, or { label, onClick }
 * @param {node}    o.title      — the page name; nothing above it
 * @param {string}  [o.count]    — "31 Titles", "23", "0 Shelves"
 * @param {string|string[]} [o.meta] — what the eyebrow used to carry, joined with ·
 * @param {node}    [o.actions]  — trailing controls, aligned to the title
 * @param {string}  [o.titleClassName] — size override; defaults to the 36/60 pair
 * @param {object}  [o.titleRef] — for pages that must move focus to the heading
 * @param {string}  [o.titleId]
 * @param {string}  [o.className] — spacing override for the <header>
 */
export default function PageHeader({
  back,
  title,
  count,
  meta,
  actions,
  titleClassName = 'text-4xl lg:text-6xl',
  titleRef,
  titleId,
  className = 'mb-8',
}) {
  const metaLine = [count, ...(Array.isArray(meta) ? meta : [meta])]
    .filter(Boolean)
    .join(' · ');

  const backClass =
    'lh-label text-white/60 hover:text-white focus-visible:text-white transition-colors cursor-pointer mb-4 inline-block py-2 -my-1 outline-none focus-visible:ring-1 focus-visible:ring-white';

  return (
    <header className={className}>
      {back && (back.to
        ? <Link to={back.to} className={backClass}>← {back.label}</Link>
        : (
          <button
            type="button"
            onClick={back.onClick}
            aria-label={back.ariaLabel || `Go back to ${back.label}`}
            className={backClass}
          >
            ← {back.label}
          </button>
        )
      )}

      <div className="flex items-end justify-between gap-4 flex-wrap">
        <h1
          ref={titleRef}
          id={titleId}
          tabIndex={titleRef ? -1 : undefined}
          className={`lh-display ${titleClassName} text-white m-0 break-words min-w-0 outline-none`}
        >
          {title}
        </h1>
        {actions}
      </div>

      {/* The count and whatever the eyebrow used to carry, on one line under the
          title where the size difference stops being a mismatch and becomes a
          caption. tabular-nums because these are almost always counts. */}
      {metaLine && (
        <div className="lh-label text-white/60 tabular-nums mt-3">{metaLine}</div>
      )}
    </header>
  );
}
