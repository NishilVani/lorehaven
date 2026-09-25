/* No imports, on purpose: scripts/vite-ota-bootstrap.mjs inlines this file
   into index.html, where the OTA bootstrap runs before any module can load.
   compat.js re-exports it, so the compatibility gate and the bootstrap
   compare versions with the same code. */

/**
 * Numeric semver compare. PURE.
 * Segments compare as numbers: "0.10.0" is newer than "0.9.0", which a string
 * compare gets backwards.
 * @returns {-1|0|1}
 */
export const compareVersions = (a, b) => {
    const parse = (v) => String(v ?? '').replace(/^v/, '').split('.')
        .map(n => { const i = parseInt(n, 10); return Number.isFinite(i) ? i : 0; });
    const x = parse(a), y = parse(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const d = (x[i] || 0) - (y[i] || 0);
        if (d !== 0) return d > 0 ? 1 : -1;
    }
    return 0;
};
