import { useState, useEffect } from 'react';
import { fetchGameAwards } from '../services/wikidata/awards';

/** Awards for one game, straight from Wikidata (localStorage-cached). */
export function useGameAwards(gameId) {
  /* One state object keyed by the game it describes. Keeping the id alongside
     the rows is what lets the reset happen during render instead of in an
     effect: without it, a game switch showed the previous game's awards for one
     frame, attributed to the new game. */
  const [state, setState] = useState({ id: gameId, awards: [], loading: true });

  if (state.id !== gameId) {
    setState({ id: gameId, awards: [], loading: true });
  }

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;

    /* Every write checks the id it is answering. A slow response for the
       previous game must not land on this one. */
    const apply = (patch) => {
      if (cancelled) return;
      setState(s => (s.id === gameId ? { ...s, ...patch } : s));
    };

    // onUpdate paints each cache tier (localStorage → Firestore → Wikidata) as
    // it resolves, so the UI shows the cached copy instantly and upgrades later.
    const onUpdate = (rows) => apply({ awards: rows, loading: false });
    fetchGameAwards(gameId, onUpdate)
      .then(rows => apply({ awards: rows }))
      .catch(err => { console.error('[awards] fetch failed:', err.message); })
      .finally(() => apply({ loading: false }));

    return () => { cancelled = true; };
  }, [gameId]);

  return { awards: state.awards, loading: state.loading };
}
