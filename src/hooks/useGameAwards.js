import { useState, useEffect } from 'react';
import { fetchGameAwards } from '../services/wikidata/awards';

/** Awards for one game, straight from Wikidata (localStorage-cached). */
export function useGameAwards(gameId) {
  const [awards, setAwards] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    setLoading(true);

    // onUpdate paints each cache tier (localStorage → Firestore → Wikidata) as
    // it resolves, so the UI shows the cached copy instantly and upgrades later.
    const onUpdate = (rows) => { if (!cancelled) { setAwards(rows); setLoading(false); } };
    fetchGameAwards(gameId, onUpdate)
      .then(rows => { if (!cancelled) setAwards(rows); })
      .catch(err => { console.error('[awards] fetch failed:', err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [gameId]);

  return { awards, loading };
}
