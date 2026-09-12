/**
 * Every brand fill carries readable ink.
 *
 * The game page fills a platform, store or subscription you own with its brand
 * colour and sets the label and glyph in that swatch's ink. A fill added without
 * measuring would ship an unreadable label, so every pair is checked here.
 *
 * Run: node tests/brand-palette.test.mjs
 */
import assert from 'node:assert/strict';
import {
  BRAND_SWATCHES, FALLBACK_SWATCH, getBrandSwatch, getPlatformBrandColor, inverseInk, inkFilter,
} from '../src/components/platforms/platformLogoUtils.js';

const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

for (const [key, swatch] of Object.entries({ ...BRAND_SWATCHES, fallback: FALLBACK_SWATCH })) {
  assert.match(swatch.fill, /^#[0-9a-f]{6}$/, `${key}: fill is a lowercase 6-digit hex`);
  assert.ok(swatch.ink === '#ffffff' || swatch.ink === '#000000', `${key}: ink is white or black`);
  const ratio = contrast(swatch.ink, swatch.fill);
  assert.ok(ratio >= 4.5, `${key}: ink on fill is ${ratio.toFixed(2)}:1, needs 4.5:1`);
}

/* Black ink is the exception: it is used only where white fails. */
for (const [key, swatch] of Object.entries(BRAND_SWATCHES)) {
  if (swatch.ink === '#000000') {
    assert.ok(contrast('#ffffff', swatch.fill) < 4.5, `${key}: white passes on this fill, so ink should be white`);
  }
}

assert.equal(getBrandSwatch('/platform-icons/steam.svg'), BRAND_SWATCHES.steam, 'resolves a logo URL');
assert.equal(getBrandSwatch('/platform-icons/Windows 11.svg'), BRAND_SWATCHES['windows 11'], 'resolves a file name with a space');
assert.equal(getBrandSwatch('itch'), BRAND_SWATCHES.itch, 'resolves a bare key');
assert.equal(getBrandSwatch('/platform-icons/other/game-console.svg'), FALLBACK_SWATCH, 'unknown marks fall back');
assert.equal(getBrandSwatch(null), FALLBACK_SWATCH, 'no key falls back');
assert.equal(getPlatformBrandColor('xbox.svg'), '#107c10', 'getPlatformBrandColor still returns the fill');
assert.equal(inverseInk('#ffffff'), '#000000');
assert.equal(inverseInk('#000000'), '#ffffff');
assert.equal(inkFilter('#ffffff'), 'brightness(0) invert(1)');
assert.equal(inkFilter('#000000'), 'brightness(0)');

console.log(`brand-palette: ${Object.keys(BRAND_SWATCHES).length} swatches, every ink passes 4.5:1`);
