import { useEffect, useState } from 'react';

/**
 * Which retry the Wikidata query is on, for pages that would otherwise show an
 * unchanging skeleton.
 *
 * WDQS throttles bursts, so queries are serialized and retried. Even at the
 * reduced 8s timeout a bad run is ~27s, and a skeleton that never changes reads
 * as broken rather than busy. This turns it into "Attempt 2 of 3".
 *
 *   const attempt = useWikidataProgress(loading);
 *   useAnnounce(loading ? (attempt ? `Retrying Wikidata, attempt ${attempt}` : 'Querying Wikidata') : ...)
 *
 * Returns 0 while the first attempt is in flight, then 2, 3, … on each retry.
 */
export default function useWikidataProgress(active) {
  const [attempt, setAttempt] = useState(0);

  /* Reset from the event stream (`start`) rather than from the effect body: a
     setState there is a cascading render, and it also left a stale "attempt 3"
     showing for a moment when a failed load was retried. */
  useEffect(() => {
    if (!active) return;
    const onProgress = (e) => {
      const d = e.detail || {};
      setAttempt(d.start || d.done ? 0 : (d.attempt || 0));
    };
    window.addEventListener('moctale_wikidata_progress', onProgress);
    return () => window.removeEventListener('moctale_wikidata_progress', onProgress);
  }, [active]);

  return active ? attempt : 0;
}
