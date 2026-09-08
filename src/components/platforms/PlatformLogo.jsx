import { getPlatformLogoUrl, getPlatformBrandColor } from './platformLogoUtils';

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

  const parts = url.split('/');
  const filename = parts[parts.length - 1];
  const brandBg = getPlatformBrandColor(filename);
  const containerClass = className ? className : 'w-8 h-8 p-1.5';

  const logoContent = (
    <div
      className={`flex items-center justify-center shrink-0 overflow-hidden ${containerClass}`}
      style={{
        backgroundColor: brandBg,
        border: '1px solid rgba(255, 255, 255, 0.15)',
        ...style,
      }}
    >
      <img
        src={url}
        alt={platform.name || (typeof platform === 'string' ? platform : '')}
        className="w-full h-full object-contain block shrink-0"
        style={{
          filter: 'brightness(0) invert(1)', // Use a single color (white)
        }}
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