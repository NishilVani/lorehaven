import { useState, useMemo } from 'react';
import { Search, X, Filter, ArrowUpDown, Grid, Gamepad2 } from 'lucide-react';
import DropdownMenu from '../ui/DropdownMenu';

/**
 * useGameGridControls — search / filter / sort / group for a fetched game list.
 * Used by CollectionDetail and FranchisePage (games mapped with
 * {id, name, first_release_date, release_year, total_rating, game_type}).
 *
 * Returns { toolbar, groups, visibleCount } — render toolbar, then map groups.
 */

const SORTS = [
  { value: 'year-asc', label: 'Release (Old)' },
  { value: 'year-desc', label: 'Release (New)' },
  { value: 'alpha', label: 'A → Z' },
  { value: 'alpha-desc', label: 'Z → A' },
  { value: 'rating-desc', label: 'Public Rating' },
];

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'library', label: 'In Library' },
  { value: 'not-library', label: 'Not in Library' },
  { value: 'type:main', label: 'Main Games' },
  { value: 'type:other', label: 'DLCs & Others' },
];

const GROUPS = [
  { value: 'none', label: 'None' },
  { value: 'year', label: 'Release Year' },
  { value: 'decade', label: 'Decade' },
  { value: 'status', label: 'Library Status' },
];

export function useGameGridControls(games, libraryMap = {}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [platform, setPlatform] = useState('all');
  const [sort, setSort] = useState('year-asc');
  const [group, setGroup] = useState('none');

  /* Platform names present in the current game set */
  const platformOptions = useMemo(() => {
    const names = new Set();
    games.forEach(g => (g.platforms || []).forEach(p => p.name && names.add(p.name)));
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [games]);

  const groups = useMemo(() => {
    let list = [...games];
    const q = query.trim().toLowerCase();
    if (q) list = list.filter(g => g.name?.toLowerCase().includes(q));

    if (filter === 'library') list = list.filter(g => libraryMap[String(g.id)]);
    else if (filter === 'not-library') list = list.filter(g => !libraryMap[String(g.id)]);
    else if (filter === 'type:main') list = list.filter(g => g.game_type === 0 || g.game_type == null);
    else if (filter === 'type:other') list = list.filter(g => g.game_type != null && g.game_type !== 0);

    if (platform !== 'all') list = list.filter(g => (g.platforms || []).some(p => p.name === platform));

    list.sort((a, b) => {
      switch (sort) {
        case 'alpha': return (a.name || '').localeCompare(b.name || '');
        case 'alpha-desc': return (b.name || '').localeCompare(a.name || '');
        case 'year-desc': return (b.first_release_date || 0) - (a.first_release_date || 0);
        case 'rating-desc': return (b.total_rating || 0) - (a.total_rating || 0);
        case 'year-asc':
        default: return (a.first_release_date || Infinity) - (b.first_release_date || Infinity);
      }
    });

    if (group === 'none') return [{ label: null, games: list }];

    // Map preserves insertion order, so groups follow the active sort order
    const m = new Map();
    list.forEach(g => {
      let key;
      if (group === 'year') key = g.release_year || 'TBA';
      else if (group === 'decade') key = g.release_year ? `${Math.floor(g.release_year / 10) * 10}s` : 'TBA';
      else key = libraryMap[String(g.id)] || 'Not in Library';
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(g);
    });
    return [...m.entries()].map(([label, gs]) => ({ label: String(label), games: gs }));
  }, [games, libraryMap, query, filter, platform, sort, group]);

  const trigger = (Icon, label) => (
    <button className="flex shrink-0 items-center gap-2 h-8 px-3 border border-white/20 hover:border-white/70 transition-colors lh-label text-white/60 hover:text-white cursor-pointer select-none">
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );

  /* The axis prefix is not decoration: a pill that shows only its current value
     is ambiguous the moment two axes can hold the same one. Library had two
     adjacent pills both reading "PRIORITY" by default. Matches the `Completed ·
     New` convention already used in the option labels. */
  const dropdown = (options, value, setValue, Icon, axis) => (
    <DropdownMenu
      options={options.map(o => ({
        label: o.label,
        onClick: () => setValue(o.value),
        isActive: value === o.value,
      }))}
      align="left"
    >
      {trigger(Icon, `${axis} · ${options.find(o => o.value === value)?.label ?? ''}`)}
    </DropdownMenu>
  );

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2 mb-8">
      <div className="relative flex-1 min-w-[180px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/60" />
        <input
                aria-label="Search titles"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="SEARCH TITLES"
          className="w-full h-8 pl-9 pr-8 bg-black border border-white/40 focus:border-white/70 lh-label text-white placeholder:text-white/50 outline-none transition-colors"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 p-2 -m-2 text-white/60 hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {dropdown(FILTERS, filter, setFilter, Filter, 'Filter')}
      {platformOptions.length > 0 && dropdown(
        [{ value: 'all', label: 'All Platforms' }, ...platformOptions.map(p => ({ value: p, label: p }))],
        platform, setPlatform, Gamepad2, 'Platform',
      )}
      {dropdown(SORTS, sort, setSort, ArrowUpDown, 'Sort')}
      {dropdown(GROUPS, group, setGroup, Grid, 'Group')}
    </div>
  );

  return {
    toolbar,
    groups,
    visibleCount: groups.reduce((n, g) => n + g.games.length, 0),
  };
}
