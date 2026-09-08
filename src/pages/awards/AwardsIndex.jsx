import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Search, X, RefreshCw } from 'lucide-react';
import { fetchCeremonies, clearAwardsCache } from '../../services/wikidata/awards';
import useAnnounce from '../../components/ui/useAnnounce';
import useWikidataProgress from '../../hooks/useWikidataProgress';
import EmptyPlate from '../../components/ui/EmptyPlate';
import PageHeader from '../../components/ui/PageHeader';

export default function AwardsIndex() {
  const [ceremonies, setCeremonies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const attempt = useWikidataProgress(loading);

  /* Paint on the FIRST tier that answers, not on the last. fetchCeremonies walks
     localStorage → shared Firestore → Wikidata and calls onUpdate at each step, so
     a returning user sees the list immediately and a cold browser sees it as soon
     as the shared cache answers — instead of a skeleton for the 27.5s the Wikidata
     aggregate takes. Later tiers upgrade the list in place. */
  const load = () => {
    setLoading(true);
    setError(null);
    let painted = false;
    const paint = (rows) => {
      if (!rows) return;
      painted = true;
      setCeremonies(rows);
      setLoading(false);          // we have something real on screen
      setError(null);
    };
    fetchCeremonies(paint)
      .then(paint)
      .catch(e => { if (!painted) setError(e.message); })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? ceremonies.filter(c => c.label.toLowerCase().includes(q)) : ceremonies;
  }, [ceremonies, query]);

  // Loading, failure and result count all changed silently before. WCAG 4.1.3.
  useAnnounce(loading ? (attempt > 1 ? `Wikidata is throttling, attempt ${attempt} of 3` : 'Querying Wikidata') : error ? `Wikidata unreachable. ${error}`
    : `${filtered.length} ${filtered.length === 1 ? 'ceremony' : 'ceremonies'}`);

  return (
    <div className="min-h-screen bg-black text-white pb-16 animate-in fade-in duration-500">
      <div className="content-container py-4">

        {/* Don't assert a count we do not have yet. With nothing painted this
            read "0 Ceremonies" while the body said "Querying Wikidata…" — the
            page contradicting itself as you waited. */}
        <PageHeader
          className="mb-6"
          title="Awards"
          count={filtered.length > 0
            ? `${filtered.length} ${filtered.length === 1 ? 'Ceremony' : 'Ceremonies'}`
            : loading ? 'Loading' : 'No Ceremonies'}
          meta="Sourced from Wikidata"
        />

        {/* Search + refresh */}
        <div className="flex gap-2 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/60" />
            <input
                aria-label="Search ceremonies"
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="SEARCH CEREMONIES"
              className="w-full h-10 pl-10 pr-9 bg-black border border-white/40 focus:border-white/70 lh-label text-white placeholder:text-white/50 outline-none transition-colors"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 p-2 -m-2 text-white/60 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            onClick={() => { clearAwardsCache(); load(); }}
            className="lh-label flex items-center gap-1.5 px-3 border border-white/20 text-white/60 hover:bg-white hover:text-black transition-colors cursor-pointer shrink-0"
          >
            <RefreshCw className="w-3 h-3" />
            Reload
          </button>
        </div>

        {loading ? (
          /* Say which attempt we are on. A skeleton that never changes reads as
             broken; the retry budget is bounded but still ~27s at worst. */
          <div className="border border-white/15 text-center py-12">
            <div className="lh-label text-white/60">Querying Wikidata…</div>
            {attempt > 1 && (
              <div className="lh-label text-white/50 mt-2">
                Wikidata is throttling. Attempt {attempt} of 3.
              </div>
            )}
          </div>
        ) : error ? (
          <EmptyPlate title="Wikidata Unreachable" body={error} />
        ) : filtered.length === 0 ? (
          <EmptyPlate title="No ceremonies match" body="No ceremony name contains that text." />
        ) : (
          <div className="border border-white/15">
            {filtered.map((c, i) => (
              <Link
                key={c.qid}
                to={`/awards/${c.qid}`}
                className={`group flex items-center justify-between gap-4 w-full px-4 py-3 transition-colors ${i > 0 ? 'border-t border-white/10' : ''} text-white/60 hover:bg-white hover:text-black`}
              >
                <span className="flex items-baseline gap-3 min-w-0">
                  <span className="lh-label tabular-nums w-6 shrink-0">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="lh-display text-base truncate">{c.label}</span>
                </span>
                <span className="lh-label tabular-nums shrink-0">
                  {c.games} {c.games === 1 ? 'Game' : 'Games'}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
