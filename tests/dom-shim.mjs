/**
 * The smallest browser the service layer needs in order to be imported by Node.
 *
 * `src/services/*.js` is written for a browser: it reads localStorage, announces
 * changes with window events, and flushes pending writes when the document is
 * hidden. None of that is optional at import time -- db.js subscribes to
 * Firebase auth while the module is evaluating, and the first auth callback
 * dispatches a window event -- so a Node test importing discover.js throws
 * `window is not defined` from an async callback a moment AFTER the import
 * resolved, which reads as a passing import followed by an unexplained crash.
 *
 * Import this before any src/services module:
 *
 *   import './dom-shim.mjs';
 *   import { pickHero } from '../src/services/discover.js';
 *
 * ESM evaluates imports in source order, so the shim is installed before the
 * service module runs. Everything here is a no-op or an in-memory store: the
 * point is to let pure logic be imported and called, not to emulate a browser.
 * A test that needs stored state writes it through `localStorage` itself.
 *
 * One other rule comes with this. Node resolves relative imports literally
 * where Vite guesses the extension, so every relative import in the
 * `src/services` graph must be written with its `.js`. Adding an extensionless
 * one breaks these tests with `Cannot find module` rather than anything about
 * the code under test, which is worth recognising quickly.
 */

class MemoryStorage {
  #map = new Map();
  get length() { return this.#map.size; }
  key(i) { return [...this.#map.keys()][i] ?? null; }
  getItem(k) { return this.#map.has(String(k)) ? this.#map.get(String(k)) : null; }
  setItem(k, v) { this.#map.set(String(k), String(v)); }
  removeItem(k) { this.#map.delete(String(k)); }
  clear() { this.#map.clear(); }
}

globalThis.localStorage ??= new MemoryStorage();

globalThis.window ??= {
  localStorage: globalThis.localStorage,
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() { return true; },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  // Tauri's presence check. Absent here, so the app takes its browser path.
  __TAURI_INTERNALS__: undefined,
};

globalThis.document ??= {
  visibilityState: 'visible',
  addEventListener() {},
  removeEventListener() {},
};

export { MemoryStorage };
