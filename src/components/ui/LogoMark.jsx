/**
 * The LoreHaven mark: three cartridge spines on a shelf, the third pulled out.
 *
 * The artwork is the logo project's own export, cropped to the ink: the box is
 * the shape, with no field around it, so a height given here is the height the
 * mark draws at and the wordmark beside it can be matched to the pixel.
 *
 * Two deliberate departures from the source markup. The label notches are
 * knocked out with fill-rule="evenodd" rather than painted #000000, so the mark
 * is a single shape that inherits currentColor and inverts correctly on any
 * background instead of only on black. And nothing here sets a width: the
 * viewBox's 82:81 does, from whatever height it is given.
 * public/lorehaven-mark.svg keeps the padded black field, which is what a
 * favicon and an app icon want.
 */
export default function LogoMark({ className = '', title, ...props }) {
    return (
        <svg
            viewBox="0 0 82 81"
            className={className}
            fill="currentColor"
            fillRule="evenodd"
            role={title ? 'img' : undefined}
            aria-hidden={title ? undefined : 'true'}
            aria-label={title}
            {...props}
        >
            {title ? <title>{title}</title> : null}
            <path d="M8.63158 15.12H24.8158V71.28H8.63158V15.12ZM31.2895 15.12H47.4737V71.28H31.2895V15.12ZM53.9474 0H70.1316V56.16H53.9474V0ZM0 75.6H82V81H0V75.6ZM12.9474 21.6H20.5V34.56H12.9474V21.6ZM35.6053 21.6H43.1579V34.56H35.6053V21.6ZM58.2632 6.48H65.8158V19.44H58.2632V6.48Z" />
        </svg>
    );
}
