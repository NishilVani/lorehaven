/* The twelve-month axis shared by the profile's all-years chart and the year
 * page's month chart. Its own module rather than living in parts.jsx: these are
 * not components, and exporting a function alongside components turns off fast
 * refresh for the whole file (react-refresh/only-export-components).
 */

/**
 * The type for a row of twelve month ticks under a chart.
 *
 * Deliberately NOT `.lh-label`. Twelve three-letter months at its 0.18em track
 * measure 311px and the card they sit in is 309px wide at 375px — measured, two
 * labels clipped — and because the class is declared outside every cascade layer
 * its size cannot be pulled back by a utility. The only way down is to not use
 * it, so family, weight, size and tracking are set here instead. That is the
 * escape hatch DESIGN.md documents, and tight tracking is what an axis tick
 * wants anyway; the wide track is for nav and metadata, which arrive one at a
 * time rather than twelve abreast.
 *
 * 10px on the narrowest screens is a deliberate exception to the one-size label
 * rule, argued rather than picked off a ramp: at 11px twelve do not fit even in
 * the wider of the two charts. It returns to the standard 11px from `sm` up.
 */
export const MONTH_TICK = 'font-sans font-medium text-[10px] sm:text-[11px] leading-none uppercase tracking-[0.02em] text-white/60 whitespace-nowrap';

/** The column gap shared by a month chart and its tick row. They must match or
 *  a label stops sitting under the column it names. */
export const MONTH_GAP = 'gap-0.5 sm:gap-2';

/** The tick cell. Always full width and always in the flow, so every bar keeps
 *  a tick under it whether or not that tick is showing its name. */
export const MONTH_TICK_CELL = `flex-1 min-w-0 text-center ${MONTH_TICK}`;

/**
 * Whether tick `i` shows its name at this width, as a class on the name itself.
 *
 * Measured at 320px: the profile's month card gives each of twelve columns
 * 19.3px and "Mar" is 22px, so six of them clipped. Three-letter names simply do
 * not fit twelve abreast in 254px at any size a person can read. So below `sm`
 * the axis is labelled by quarter — Jan, Apr, Jul, Oct — each with four columns
 * of room to sit in. Thinning a crowded axis is ordinary, and it beats going
 * back to "J F M", which reads as an initial rather than a month.
 *
 * `sr-only`, not `invisible`: `visibility: hidden` takes a node out of the
 * accessibility tree too, which would have left a screen reader on a phone
 * hearing four months out of twelve. This hides the name from the eye and keeps
 * it for the ear. It is on the name rather than the cell because `sr-only` is
 * absolutely positioned — on the cell it would drop out of the flex row and take
 * the alignment with it.
 */
export const monthNameClass = (i) => (i % 3 === 0 ? '' : 'sr-only sm:not-sr-only');
