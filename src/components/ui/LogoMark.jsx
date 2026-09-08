/**
 * The LoreHaven mark: three cartridge spines on a shelf, the third pulled out.
 *
 * From the "4c / The Shelf" variant of the LoreHaven logo design project.
 *
 * Two deliberate departures from the source markup. The label notches are
 * knocked out with fill-rule="evenodd" rather than painted #000000, so the mark
 * is a single shape that inherits currentColor and inverts correctly on any
 * background instead of only on black. And the viewBox is cropped to the
 * artwork's real bounds rather than the 100x100 field it was drawn in, so the
 * mark fills whatever box it is given -- w-5 h-5 renders a 20px mark, not a
 * 15px mark floating in 20px of padding. public/lorehaven-mark.svg keeps the
 * padded field, which is what a favicon wants.
 */
export default function LogoMark({ className = '', title, ...props }) {
    return (
        <svg
            viewBox="12 20 76 75"
            className={className}
            fill="currentColor"
            fillRule="evenodd"
            role={title ? 'img' : undefined}
            aria-hidden={title ? undefined : 'true'}
            aria-label={title}
            {...props}
        >
            {title ? <title>{title}</title> : null}
            <path d="M20 34 H35 V86 H20 Z M41 34 H56 V86 H41 Z M62 20 H77 V72 H62 Z M12 90 H88 V95 H12 Z M24 40 H31 V52 H24 Z M45 40 H52 V52 H45 Z M66 26 H73 V38 H66 Z" />
        </svg>
    );
}
