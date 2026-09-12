import { getPlatformLogoUrl, getBrandSwatch, inkFilter } from './platformLogoUtils';

import { Tooltip } from '../ui/Tooltip';
export { Tooltip };
// ─────────────────────────────────────────────
// LogoCard
//
// A simple card displaying the logo image as is without canvas operations,
// keying, or caching.
// ─────────────────────────────────────────────
export function LogoCard({ src, alt, className = "", style = {} }) {
  return (
    <Tooltip text={alt}>
      <div
        className={`inline-flex items-center justify-center overflow-hidden transition-colors duration-200 ${className}`}
        style={{
          background: "#000000",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          ...style,
        }}
      >
        <img
          src={src}
          alt={alt}
          style={{
            height: "100%",
            width: "auto",
            objectFit: "contain",
            display: "block",
          }}
        />
      </div>
    </Tooltip>
  );
}

// Stub for compatibility
export function LogoCardTailwind({ src, alt, brandColor, className = "" }) {
  return <LogoCard src={src} alt={alt} brandColor={brandColor} className={className} />;
}


/**
 * A platform's mark at menu-row size, in its own brand colour.
 *
 * Same treatment as the platform group headings in the library, which is the
 * point: platform marks are a fourth sanctioned colour source in this app
 * alongside cover art and the three state scales, and a monochrome version in
 * filter menus would have been the inconsistent thing rather than the pure one.
 *
 * Tooltip off. Every caller renders it beside the platform's name, so there is
 * nothing for a tooltip to add, and the menus it appears in are portalled.
 */
export function PlatformGlyph({ platform, className = 'w-4 h-4' }) {
  return <PlatformLogo platform={platform} className={`${className} shrink-0`} disableTooltip />;
}

export function PlatformLogo({ platform, className = '', style = {}, disableTooltip = false }) {
  const url = getPlatformLogoUrl(platform);
  if (!url) return null;

  const swatch = getBrandSwatch(url);
  const containerClass = className ? className : 'w-8 h-8 p-1.5';

  const logoContent = (
    <div
      className={`flex items-center justify-center shrink-0 overflow-hidden ${containerClass}`}
      style={{
        backgroundColor: swatch.fill,
        border: '1px solid rgba(255, 255, 255, 0.15)',
        ...style,
      }}
    >
      <img
        src={url}
        alt={platform.name || (typeof platform === 'string' ? platform : '')}
        className="w-full h-full object-contain block shrink-0"
        /* The glyph takes the swatch's ink: white on dark fills, black on light
           ones such as Linux yellow, where a white glyph would vanish. */
        style={{ filter: inkFilter(swatch.ink) }}
      />
    </div>
  );

  if (disableTooltip) {
    return logoContent;
  }

  return (
    <Tooltip text={platform.name || (typeof platform === 'string' ? platform : '')}>
      {logoContent}
    </Tooltip>
  );
}
