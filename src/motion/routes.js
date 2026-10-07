/* Route code, loaded before it is needed.
 *
 * Every page is its own chunk. On a first visit React.lazy used to suspend
 * and show the "Loading..." fallback, and a view transition that started then
 * captured that fallback as the new page, so nothing could fly to it. Now:
 *
 *  - every route chunk is fetched while the browser is idle after the first
 *    page has painted, and a specific one as soon as a link to it is pressed
 *    or hovered;
 *  - the director (TransitionLocation) waits up to 300ms for a chunk that is
 *    still in flight before swapping pages;
 *  - a route whose chunk is already in mounts its component directly, not
 *    through React.lazy, so it never suspends at all. Which of the two a
 *    mount uses is fixed for that mount: switching component types later
 *    would remount the page and lose its state. */
import { createElement, lazy, useState } from 'react';

const registry = [];

/**
 * A lazily loaded page for the route `pattern` (a RegExp on the pathname).
 * Returns a component usable as a <Route element>.
 */
export function lazyRoute(pattern, loader) {
  const entry = { pattern, module: null, promise: null };
  entry.load = () => {
    entry.promise ||= loader().then((m) => { entry.module = m; return m; });
    return entry.promise;
  };
  registry.push(entry);
  const Lazy = lazy(entry.load);
  function RouteComponent(props) {
    const [direct] = useState(() => entry.module?.default || null);
    return createElement(direct || Lazy, props);
  }
  RouteComponent.displayName = `Route(${pattern})`;
  return RouteComponent;
}

const entriesFor = (pathname) => registry.filter((e) => e.pattern.test(pathname));

/** Starts loading the chunks for a pathname; resolves when they are in. */
export function preloadRoute(pathname) {
  return Promise.all(entriesFor(pathname).map((e) => e.load().catch(() => null)));
}

/** True when every chunk the pathname needs is already loaded. */
export const routeLoaded = (pathname) => entriesFor(pathname).every((e) => e.module);

let prefetching = false;

/** After first paint, fetch every route chunk in idle time, one at a time. */
export function prefetchRoutesWhenIdle() {
  if (prefetching || typeof window === 'undefined') return;
  prefetching = true;
  const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 2000));
  const queue = [...registry];
  const next = () => {
    const entry = queue.shift();
    if (!entry) return;
    entry.load().catch(() => null).finally(() => idle(next));
  };
  idle(next);
}

/* Intent: pressing or hovering an in-app link starts its chunk at once. */
function onIntent(e) {
  const a = e.target instanceof Element && e.target.closest('a[href]');
  if (!a || a.origin !== window.location.origin) return;
  preloadRoute(a.pathname);
}

export function installRouteIntent() {
  if (typeof document === 'undefined') return;
  document.addEventListener('pointerdown', onIntent, { capture: true, passive: true });
  document.addEventListener('pointerover', onIntent, { capture: true, passive: true });
}
