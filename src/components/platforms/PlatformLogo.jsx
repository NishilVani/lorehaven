
// ─────────────────────────────────────────────
// Short Platform Name Resolver
// ─────────────────────────────────────────────
export function getShortPlatformName(platform) {
  if (!platform) return '';
  const pName = typeof platform === 'string'
    ? platform
    : (platform.abbreviation || platform.name || '');
  let name = String(pName).trim();

  // Strip parentheses if they exist and return the main part
  // e.g. "PC (Microsoft Windows)" -> "PC"
  const parenMatch = name.match(/^([^(]+)\s*\(/);
  if (parenMatch) {
    name = parenMatch[1].trim();
  }

  if (name.toLowerCase() === 'nintendo switch') return 'Switch';

  // Official storefronts read better without the word (Epic Games Store -> Epic
  // Games), but a user-typed custom name ending in Store must stay as typed, or
  // "X" and "X Store" become two controls with one accessible name.
  const isCustom = typeof platform !== 'string' && /^custom_/.test(String(platform.id || ''));
  if (!isCustom && name.toLowerCase() !== 'app store') {
    name = name.replace(/\s+store$/i, '').trim();
  }

  return name;
}

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

// ─────────────────────────────────────────────
// Platform Logo URL Resolver & Render Component
// ─────────────────────────────────────────────

export function getPlatformLogoUrl(platform) {
  if (!platform) return null;

  const pName = typeof platform === 'string' ? platform : (platform.name || '');
  const name = String(pName).toLowerCase().trim();
  const id = typeof platform === 'object' ? platform.id : null;

  const mappings = [
    { keys: ['steam deck'], file: 'steamdeck.svg' },
    { keys: ['steam'], file: 'steam.svg' },
    { keys: ['playstation 5', 'ps5'], file: 'playstation5.svg' },
    { keys: ['playstation 4', 'ps4'], file: 'playstation4.svg' },
    { keys: ['playstation 3', 'ps3'], file: 'playstation3.svg' },
    { keys: ['playstation 2', 'ps2'], file: 'playstation2.svg' },
    { keys: ['playstation portable', 'psp'], file: 'playstationportable.svg' },
    { keys: ['playstation vita', 'ps vita', 'vita'], file: 'playstationvita.svg' },
    { keys: ['playstation', 'ps', 'playstation store', 'playstation plus'], file: 'playstation.svg' },
    { keys: ['xbox series', 'xbox one', 'xbox 360', 'xbox game pass', 'pc game pass', 'xbox', 'microsoft store'], file: 'xbox.svg' },
    { keys: ['nintendo switch', 'nintendo eshop', 'nintendo switch online', 'switch'], file: 'nintendo-switch.svg' },
    { keys: ['pc', 'windows'], file: 'Windows 11.svg' },
    { keys: ['apple arcade'], file: 'applearcade.svg' },
    { keys: ['mac', 'macos', 'macintosh', 'apple'], file: 'apple.svg' },
    { keys: ['app store'], file: 'appstore.svg' },
    { keys: ['google play store', 'google play pass', 'google play', 'android'], file: 'google-play.svg' },
    { keys: ['ios', 'iphone', 'ipad'], file: 'ios.svg' },
    { keys: ['linux'], file: 'linux.svg' },
    { keys: ['meta quest', 'meta'], file: 'meta.svg' },
    { keys: ['oculus quest', 'oculus rift', 'oculus'], file: 'oculus.svg' },
    { keys: ['stadia', 'google stadia'], file: 'stadia.svg' },
    { keys: ['epic games store', 'epic games', 'epic'], file: 'epicgames.svg' },
    { keys: ['gog.com', 'gog', 'good old games'], file: 'gogdotcom.svg' },
    { keys: ['ubisoft connect', 'ubisoft'], file: 'ubisoft.svg' },
    { keys: ['ea play', 'ea app', 'origin', 'electronic arts'], file: 'ea.svg' },
  ];

  for (const map of mappings) {
    if (map.keys.some(k => name === k || name.includes(k))) {
      return `/platform-icons/${map.file}`;
    }
  }

  const idMappings = {
    6: 'Windows 11.svg',     // PC
    167: 'playstation5.svg', // PS5
    48: 'playstation4.svg',  // PS4
    9: 'playstation3.svg',   // PS3
    8: 'playstation2.svg',   // PS2
    7: 'playstation.svg',    // PS1
    169: 'xbox.svg',         // Xbox Series X|S
    49: 'xbox.svg',          // Xbox One
    12: 'xbox.svg',          // Xbox 360
    11: 'xbox.svg',          // Xbox
    130: 'nintendo-switch.svg', // Nintendo Switch
    34: 'google-play.svg',   // Android
    39: 'ios.svg',           // iOS
  };

  if (id && idMappings[id]) {
    return `/platform-icons/${idMappings[id]}`;
  }

  /* Nothing branded for this one. Pick a neutral shape by what the platform IS,
     never by a hash of its name.
   *
   * The hash is what this used to do -- a "stable random" pick from six icons,
   * two of which are branded. It put an XBOX console next to Wii and next to
   * Commodore C64, and a Windows desktop next to the NES. Measured on a single
   * RPG genre menu, 15 of 24 rows were on that fallback, so the majority of
   * platforms shown carried an icon that was either meaningless or another
   * company's. Variety is not worth being wrong.
   *
   * Two buckets, because that is the honest amount of information available: it
   * ran on a computer, or it ran on a console. The row's label names the
   * platform either way, so the glyph is never the only carrier. */
  const HOME_COMPUTER = [
    'dos', 'amiga', 'commodore', 'msx', 'atari st', 'zx spectrum', 'amstrad',
    'sharp x', 'pc-98', 'pc-88', 'apple ii', 'acorn', 'bbc micro', 'trs-80',
  ];
  const isComputer = HOME_COMPUTER.some(k => name.includes(k));
  return `/platform-icons/other/${isComputer ? 'computer-pc-desktop-solid.svg' : 'game-console.svg'}`;
}

export function getPlatformBrandColor(filename) {
  if (!filename) return '#18181b';
  const name = filename.replace('.svg', '').toLowerCase();

  const BRAND_COLORS = {
    steam: '#171a21',
    steamdeck: '#1b2838',
    playstation5: '#003087',
    playstation4: '#003087',
    playstation3: '#003087',
    playstation2: '#003087',
    playstation: '#003087',
    xbox: '#107c10',
    'nintendo-switch': '#e60012',
    'windows 11': '#0078d4',
    apple: '#1a1a1a',
    applearcade: '#1a1a1a',
    appstore: '#007aff',
    'google-play': '#1a1a1a',
    ios: '#000000',
    linux: '#1f1f1f',
    meta: '#0081fb',
    oculus: '#000000',
    stadia: '#ff5c35',
    epicgames: '#1f1f1f',
    gogdotcom: '#1c0c24',
    ubisoft: '#0a0a0a',
    ea: '#1f1f1f',
  };

  return BRAND_COLORS[name] || '#18181b';
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