import { useState, useMemo, useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { ReviewCardSkeleton } from '../../components/ui/Skeleton';
import Checkbox from '../../components/ui/Checkbox';
import EmptyPlate from '../../components/ui/EmptyPlate';
import { statusColor } from '../../constants/stateColors';

const CATEGORY_MAP = {
    0: 'Main Game', 1: 'DLC', 2: 'Expansion', 3: 'Bundle',
    4: 'Standalone', 5: 'Mod', 6: 'Episode', 7: 'Season',
    8: 'Remake', 9: 'Remaster', 10: 'Expanded', 11: 'Port',
    12: 'Fork', 13: 'Pack', 14: 'Update'
};

/* Status is one of the sanctioned colour exceptions — same scale as GameDetail / useLibraryCards. */

const typeOf = (item) => {
    if (item.selectedMatchId === 'custom') return 'Custom';
    const match = item.igdbResults?.find(r => r.id.toString() === item.selectedMatchId);
    return match?.game_type !== undefined ? (CATEGORY_MAP[match.game_type] || 'Unknown') : null;
};

function CoverImage({ imageId, alt, size = 'cover_small_2x', className = '' }) {
    const [broken, setBroken] = useState(false);
    if (!imageId || broken) {
        return (
            <div className={`bg-white/[0.03] border border-white/10 flex items-center justify-center ${className}`}>
                <span className="lh-label text-white/50">None</span>
            </div>
        );
    }
    return (
        <img
            src={`https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg`}
            alt={alt}
            onError={() => setBroken(true)}
            className={`object-cover border border-white/10 ${className}`}
        />
    );
}

/* The one thing this screen exists to answer: what will this row DO to my library? */
function RowVerdict({ item }) {
    if (!item.isSelected) return <span className="lh-label text-white/50">Skip</span>;
    if (item.conflict) return <span className="lh-label text-[var(--warning)]">Overwrite</span>;
    if (item.selectedMatchId === 'custom') {
        return <span className="lh-label text-white/50">{item.igdbResults.length === 0 ? 'No Match' : 'Custom'}</span>;
    }
    return <span className="lh-label text-white">New</span>;
}

function FilterBtn({ active, onClick, children }) {
    return (
        <button
            onClick={onClick}
            className={`lh-label px-3 py-1.5 border transition-colors cursor-pointer whitespace-nowrap ${active
                ? 'bg-white text-black border-white'
                : 'border-white/20 text-white/50 hover:border-white/70 hover:text-white'
                }`}
        >
            {children}
        </button>
    );
}

// ─── Single row ───────────────────────────────────────────────────────────────
function ReviewRow({ item, index, isEditing, onToggleSelect, onEdit, getYear }) {
    const selectedMatch = item.selectedMatchId !== 'custom'
        ? item.igdbResults.find(r => r.id.toString() === item.selectedMatchId)
        : null;

    const displayName = selectedMatch?.name || item.originalName;
    const year = selectedMatch ? getYear(selectedMatch.first_release_date) : '—';
    const gameType = typeOf(item);
    // The diff: only worth showing when IGDB renamed the row.
    const renamed = selectedMatch && selectedMatch.name !== item.originalName;

    return (
        /* An unselected row used to be opacity-40, which drove its own text down to
           1.66:1 while every control in it stayed operable. The checkbox already
           carries the state, so the row is tinted instead of dimmed. WCAG 1.4.3. */
        <div
            className={`flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-3 border-t first:border-t-0 transition-colors ${isEditing ? 'bg-white/[0.06] border-white/25' : 'border-white/10 hover:bg-white/[0.02]'
                } ${!item.isSelected ? 'bg-white/[0.02]' : ''}`}
        >
            <label onClick={e => e.stopPropagation()} className="shrink-0 flex items-center">
                <Checkbox
                    checked={item.isSelected}
                    onChange={() => onToggleSelect(item.id)}
                    aria-label={`Import ${item.originalName || item.name}`}
                />
            </label>

            <span className="lh-label text-white/50 tabular-nums w-8 shrink-0 hidden sm:block">
                {String(index + 1).padStart(3, '0')}
            </span>

            <CoverImage
                imageId={selectedMatch?.cover?.image_id}
                alt={displayName}
                className="w-8 h-11 sm:w-9 sm:h-12 shrink-0"
            />

            {/* Name + the CSV row it came from */}
            <button
                onClick={() => onEdit(item.id)}
                className="min-w-0 flex-1 text-left cursor-pointer group"
            >
                <div className="text-sm text-white truncate group-hover:underline underline-offset-2" title={displayName}>
                    {displayName}
                </div>
                <div className="lh-label text-white/50 truncate mt-1" title={item.originalName}>
                    {renamed ? `CSV: ${item.originalName}` : `${year}${gameType ? ` · ${gameType}` : ''}`}
                    {/* Below sm the status column is hidden, and status is the one thing
                        this step exists to set: carry it in the sub-line there. */}
                    {item.mappedStatus && <span className="sm:hidden"> · <span>{item.mappedStatus}</span></span>}
                </div>
            </button>

            {/* Wide-screen metadata columns */}
            <div className="hidden xl:block w-12 shrink-0 lh-label text-white/60 tabular-nums">{year}</div>
            <div className="hidden xl:block w-24 shrink-0 lh-label text-white/60 truncate">{gameType || '—'}</div>

            <div className="hidden sm:flex items-center gap-2 w-24 shrink-0">
                <span
                    className="w-1.5 h-1.5 shrink-0"
                    style={{ background: statusColor(item.mappedStatus) }}
                />
                <span className="lh-label text-white/70 truncate">{item.mappedStatus}</span>
            </div>

            <div className="min-w-16 sm:w-20 shrink-0 text-right whitespace-nowrap">
                <RowVerdict item={item} />
            </div>
        </div>
    );
}

// ─── Sidebar match option ─────────────────────────────────────────────────────
function SidebarMatchItem({ game, isSelected, onSelect, getYear }) {
    return (
        <button
            onClick={() => onSelect(game.id.toString())}
            className={`w-full flex items-center gap-3 p-2 border-t first:border-t-0 border-white/10 text-left transition-colors cursor-pointer ${isSelected ? 'bg-white text-black' : 'hover:bg-white/[0.04]'
                }`}
        >
            <CoverImage imageId={game.cover?.image_id} alt={game.name} className="w-7 h-9 shrink-0" />
            <div className="min-w-0 flex-1">
                <div className="text-xs truncate" title={game.name}>{game.name}</div>
                <div className={`lh-label mt-1 truncate ${isSelected ? 'text-black/50' : 'text-white/50'}`}>
                    {getYear(game.first_release_date)}
                    {game.game_type !== undefined && ` · ${CATEGORY_MAP[game.game_type] || 'Game'}`}
                </div>
            </div>
        </button>
    );
}

// ─── Sidebar panel ────────────────────────────────────────────────────────────
function ReviewSidebar({ item, updateMatch, manualQueries, setManualQueries, handleManualSearch, isSearchingManual, getYear, onClose }) {
    const [filter, setFilter] = useState('all');
    /* Reset the filter when the wizard moves to a different item, adjusted
       during render rather than in an effect. An effect would paint the new
       item's rows through the old item's filter for one frame first. This is
       what react.dev calls "adjusting state when a prop changes". */
    const [filterFor, setFilterFor] = useState(item?.id);
    if (filterFor !== item?.id) {
        setFilterFor(item?.id);
        setFilter('all');
    }

    // Reset filter when item changes

    const availableCategories = useMemo(() => {
        if (!item) return [];
        const cats = new Set();
        item.igdbResults.forEach(r => cats.add(r.game_type?.toString() ?? '0'));
        return Array.from(cats).sort((a, b) => parseInt(a) - parseInt(b));
    }, [item]);

    const sortedResults = useMemo(() => {
        if (!item) return [];
        let results = [...item.igdbResults];
        if (filter !== 'all') {
            results = results.filter(r => (r.game_type?.toString() ?? '0') === filter);
        }
        return results.sort((a, b) => {
            if (item.selectedMatchId === a.id.toString()) return -1;
            if (item.selectedMatchId === b.id.toString()) return 1;
            return 0;
        });
    }, [item, filter]);

    if (!item) {
        return (
            <EmptyPlate title="No Row Selected" body="Click any title to change its IGDB match" />
        );
    }

    const isCustomSelected = item.selectedMatchId === 'custom';

    return (
        <div className="border border-white/15">
            {/* Header */}
            <div className="flex items-start justify-between gap-2 p-4 border-b border-white/15">
                <div className="min-w-0">
                    <div className="lh-label text-white/60 mb-1.5">Editing CSV Row</div>
                    <div className="lh-display text-base text-white break-words" title={item.originalName}>
                        {item.originalName}
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="shrink-0 w-6 h-6 flex items-center justify-center border border-white/15 text-white/60 hover:bg-white hover:text-black hover:border-white transition-colors cursor-pointer"
                    title="Close"
                >
                    <X size={12} />
                </button>
            </div>

            {/* Conflict warning — this row overwrites an existing library entry */}
            {item.conflict && (
                <div className="px-4 py-3 border-b border-white/15 bg-[var(--warning)]/[0.06]">
                    <div className="lh-label text-[var(--warning)] mb-1.5">Already in Library</div>
                    <p className="text-[11px] text-white/50 leading-relaxed">
                        Saving this row overwrites the existing entry. Deselect it in the table to keep what you have.
                    </p>
                </div>
            )}

            {/* Manual search */}
            <div className="flex border-b border-white/15">
                <div className="relative flex-1 min-w-0">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50 pointer-events-none" />
                    <input
                aria-label="Search IGDB"
                        type="text"
                        placeholder="Search IGDB"
                        className="w-full h-10 pl-9 pr-3 bg-black lh-label text-white outline-none placeholder:text-white/50"
                        value={manualQueries[item.id] || ''}
                        onChange={e => setManualQueries(p => ({ ...p, [item.id]: e.target.value }))}
                        onKeyDown={e => e.key === 'Enter' && handleManualSearch(item.id)}
                    />
                </div>
                <button
                    className="lh-label px-4 border-l border-white/15 text-white/60 hover:bg-white hover:text-black transition-colors cursor-pointer disabled:opacity-40"
                    /* aria-disabled: the search this button starts is what disables it,
                       and `disabled` would drop focus out of the row. WCAG 2.4.3. */
                    onClick={() => { if (!isSearchingManual[item.id]) handleManualSearch(item.id); }}
                    aria-disabled={!!isSearchingManual[item.id]}
                >
                    {isSearchingManual[item.id] ? '…' : 'Go'}
                </button>
            </div>

            <div className="p-4">
                <div className="flex items-center gap-3 mb-3">
                    <span className="lh-display text-sm text-white/80">Matches</span>
                    <div className="flex-1 h-px bg-white/15" />
                    <span className="lh-label text-white/60 tabular-nums">{item.igdbResults.length}</span>
                </div>

                {item.igdbResults.length > 0 && availableCategories.length > 1 && (
                    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar mb-3">
                        <FilterBtn active={filter === 'all'} onClick={() => setFilter('all')}>All</FilterBtn>
                        {availableCategories.map(catId => (
                            <FilterBtn key={catId} active={filter === catId} onClick={() => setFilter(catId)}>
                                {CATEGORY_MAP[parseInt(catId)] || 'Other'}
                            </FilterBtn>
                        ))}
                    </div>
                )}

                {item.igdbResults.length === 0 ? (
                    <div className="border border-white/15 text-center py-8 px-4">
                        <div className="lh-label text-white/60 leading-relaxed">No IGDB results — search above or keep as custom</div>
                    </div>
                ) : (
                    <div className="border border-white/15 max-h-80 overflow-y-auto custom-scrollbar">
                        {sortedResults.map(game => (
                            <SidebarMatchItem
                                key={game.id}
                                game={game}
                                isSelected={item.selectedMatchId === game.id.toString()}
                                onSelect={matchId => updateMatch(item.id, matchId)}
                                getYear={getYear}
                            />
                        ))}
                    </div>
                )}

                {/* Custom entry option */}
                <button
                    onClick={() => updateMatch(item.id, 'custom')}
                    className={`w-full mt-3 p-3 border text-left transition-colors cursor-pointer ${isCustomSelected
                        ? 'bg-white text-black border-white'
                        : 'border-white/20 hover:border-white/70'
                        }`}
                >
                    <div className="lh-label mb-1">Use CSV Data Only</div>
                    <div className={`text-[11px] ${isCustomSelected ? 'text-black/60' : 'text-white/60'}`}>
                        No IGDB link — saved as a custom entry
                    </div>
                </button>
            </div>
        </div>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function StepReviewV2({
    isFetchingApi, fetchProgress, skippedRows = 0,
    reviewItems, updateMatch,
    getYear, manualQueries, setManualQueries, handleManualSearch, isSearchingManual,
    toggleItemSelection, toggleAllSelection
}) {
    const [gridFilter, setGridFilter] = useState('all');
    const [typeFilter, setTypeFilter] = useState('all');
    const [editingItemId, setEditingItemId] = useState(null);
    const cbRef = useRef(null);

    const editingItem = useMemo(
        () => reviewItems.find(i => i.id === editingItemId) || null,
        [reviewItems, editingItemId]
    );

    const availableTypes = useMemo(() => {
        const types = new Set();
        reviewItems.forEach(item => {
            const t = typeOf(item);
            if (t) types.add(t);
        });
        return Array.from(types).sort();
    }, [reviewItems]);

    const filteredItems = useMemo(() => {
        let items = reviewItems;
        if (gridFilter === 'conflicts') items = items.filter(item => item.conflict);
        if (typeFilter !== 'all') items = items.filter(item => typeOf(item) === typeFilter);
        return items;
    }, [reviewItems, gridFilter, typeFilter]);

    const conflictItems = useMemo(() => reviewItems.filter(i => i.conflict), [reviewItems]);
    const hasConflictItems = conflictItems.length > 0;

    const allSelected = reviewItems.length > 0 && reviewItems.every(i => i.isSelected);
    const someSelected = reviewItems.some(i => i.isSelected);
    const selectedCount = reviewItems.filter(i => i.isSelected).length;

    // Tri-state select-all needs the DOM property; className can't express it.
    useEffect(() => {
        if (cbRef.current) cbRef.current.indeterminate = someSelected && !allSelected;
    }, [someSelected, allSelected]);

    const handleEditToggle = (itemId) => {
        // Both setState calls must happen in the handler, not inside an updater —
        // an updater runs during render, and setManualQueries belongs to the parent.
        const next = editingItemId === itemId ? null : itemId;
        setEditingItemId(next);
        // Pre-fill manual search with original name if not already set
        if (next && !manualQueries[next]) {
            const item = reviewItems.find(i => i.id === next);
            if (item) setManualQueries(p => ({ ...p, [next]: item.originalName }));
        }
    };

    // Selection IS consent to overwrite (see finalizeImport) — so deselecting is
    // the real "don't touch my library" control. One click for all conflicts.
    const deselectConflicts = () => {
        conflictItems.forEach(i => { if (i.isSelected) toggleItemSelection(i.id); });
    };

    return (
        <div>
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-3 sm:gap-4 mb-6">
                <label className="ios-cb-label">
                    <Checkbox ref={cbRef} checked={allSelected} onChange={e => toggleAllSelection(e.target.checked)} />
                    <span className="lh-label text-white/60">All</span>
                </label>

                <span className="lh-label text-white/60 tabular-nums">
                    <span className="text-white">{selectedCount}</span> / {reviewItems.length} To Import
                </span>

                {isFetchingApi && (
                    <span className="lh-label text-white/60 tabular-nums">
                        Fetching {fetchProgress.current} / {fetchProgress.total}
                    </span>
                )}

                {/* Account for rows the importer could not use, so the row count it was
                    given and the row count it produced never silently disagree. */}
                {skippedRows > 0 && (
                    <span className="lh-label text-[var(--warning)] tabular-nums">
                        {skippedRows} Skipped &middot; No Name
                    </span>
                )}

                <div className="flex-1" />

                {hasConflictItems && (
                    <>
                        <FilterBtn active={gridFilter === 'conflicts'} onClick={() => setGridFilter(gridFilter === 'conflicts' ? 'all' : 'conflicts')}>
                            {conflictItems.length} {conflictItems.length === 1 ? 'Conflict' : 'Conflicts'}
                        </FilterBtn>
                        <button
                            onClick={deselectConflicts}
                            className="lh-label px-3 py-1.5 border border-[var(--warning-border)] text-[var(--warning)] hover:bg-[var(--warning)] hover:text-black transition-colors cursor-pointer whitespace-nowrap"
                        >
                            Deselect Conflicts
                        </button>
                    </>
                )}
            </div>

            {/* Type filters */}
            {availableTypes.length > 1 && (
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar mb-6">
                    <span className="lh-label text-white/50 shrink-0 mr-1">Type</span>
                    <FilterBtn active={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>All</FilterBtn>
                    {availableTypes.map(type => (
                        <FilterBtn key={type} active={typeFilter === type} onClick={() => setTypeFilter(typeFilter === type ? 'all' : type)}>
                            {type}
                        </FilterBtn>
                    ))}
                </div>
            )}

            <div className="flex flex-col lg:flex-row gap-6 items-start">

                {/* Index table */}
                <div className="w-full lg:flex-1 min-w-0 order-2 lg:order-1">
                    {filteredItems.length === 0 && !isFetchingApi ? (
                        /* A header-only CSV reported "no rows match the current filter" with no
                           filter applied. The two cases are different facts. */
                        reviewItems.length === 0 ? (
                            <EmptyPlate title="No Rows To Review" body="That file had a header row and no data rows under it." />
                        ) : (
                            <EmptyPlate title="Nothing Here" body="No rows match the current filter." />
                        )
                    ) : (
                        <div className="border border-white/15">
                            {/* Column heads — the table reads as an index, not a list */}
                            <div className="hidden sm:flex items-center gap-4 px-4 py-2.5 border-b border-white/15 bg-white/[0.02]">
                                <span className="w-4 shrink-0" />
                                <span className="lh-label text-white/50 w-8 shrink-0">#</span>
                                <span className="lh-label text-white/50 w-9 shrink-0">Art</span>
                                <span className="lh-label text-white/50 flex-1 min-w-0">Title</span>
                                <span className="lh-label text-white/50 w-12 shrink-0 hidden xl:block">Year</span>
                                <span className="lh-label text-white/50 w-24 shrink-0 hidden xl:block">Type</span>
                                <span className="lh-label text-white/50 w-24 shrink-0">Status</span>
                                <span className="lh-label text-white/50 w-20 shrink-0 text-right">Action</span>
                            </div>

                            {filteredItems.map((item) => (
                                <ReviewRow
                                    key={item.id}
                                    item={item}
                                    index={reviewItems.indexOf(item)}
                                    isEditing={editingItemId === item.id}
                                    onToggleSelect={toggleItemSelection}
                                    onEdit={handleEditToggle}
                                    getYear={getYear}
                                />
                            ))}

                            {isFetchingApi && Array.from({ length: Math.min(8, Math.max(1, fetchProgress.total - fetchProgress.current)) }).map((_, i) => (
                                <ReviewCardSkeleton key={`skel-${i}`} />
                            ))}
                        </div>
                    )}
                </div>

                {/* Sidebar — inline on mobile only while editing, always a column on desktop */}
                <div className={`w-full lg:w-80 shrink-0 order-1 lg:order-2 lg:sticky lg:top-16 ${editingItem ? '' : 'hidden lg:block'}`}>
                    <ReviewSidebar
                        item={editingItem}
                        updateMatch={updateMatch}
                        manualQueries={manualQueries}
                        setManualQueries={setManualQueries}
                        handleManualSearch={handleManualSearch}
                        isSearchingManual={isSearchingManual}
                        getYear={getYear}
                        onClose={() => setEditingItemId(null)}
                    />
                </div>
            </div>
        </div>
    );
}
