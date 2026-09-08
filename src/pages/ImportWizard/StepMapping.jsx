import EmptyPlate from '../../components/ui/EmptyPlate';
import { useState, useEffect, useRef, useCallback, useMemo, useId } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import { searchPlatforms, searchExternalGameSources } from '../../services/igdb';
import { POPULAR_HARDWARE, POPULAR_STORES, POPULAR_SUBSCRIPTIONS } from '../../constants/platformConstants';
import { PlatformPill } from '../../components/platforms/PlatformPill';
import { getUserCustomPlatforms } from '../../services/db';
import DropdownMenu from '../../components/ui/DropdownMenu';
import { statusColor } from '../../constants/stateColors';

/* Unreleased is a real shelf and belongs in the mapping targets. Without it a CSV
   value like "Not Released Yet" had nowhere to go, fell through to Backlog, and was
   then auto-migrated to Unreleased on the next library hydrate — so the user picked
   nothing, saw Backlog, and later found it had moved on its own. */
const MOCTALE_STATUSES = ['Wishlist', 'Backlog', 'Playing', 'Beaten', 'Dropped', 'Unreleased'];
const MOCTALE_PRIORITIES = ['Someday', 'Maybe', 'Soon', 'Next Up'];
const MOCTALE_FEELS = ['Perfection', 'Go for it', 'Timepass', 'Skip'];

/* Status is one of the sanctioned colour exceptions — same scale as GameDetail / useLibraryCards. */

const StatusDot = ({ status }) => (
    <span className="w-1.5 h-1.5 shrink-0" style={{ background: statusColor(status) }} />
);

// --- Portal Dropdown ---
function PortalDropdown({ anchorRef, results, onSelect, visible, highlightedIndex, setHighlightedIndex, renderTop, listId }) {
    const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

    useEffect(() => {
        if (!visible || !anchorRef.current) return;
        const update = () => {
            const r = anchorRef.current?.getBoundingClientRect();
            if (r) setPos({ top: r.bottom + 4, left: r.left, width: r.width });
        };
        update();
        window.addEventListener('scroll', update, true);
        window.addEventListener('resize', update);
        return () => {
            window.removeEventListener('scroll', update, true);
            window.removeEventListener('resize', update);
        };
    }, [visible, anchorRef]);

    if (!visible) return null;

    return createPortal(
        <div
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
            className="bg-black border border-white/25"
            onMouseDown={(e) => e.preventDefault()} // Prevent input blur when interacting with dropdown
        >
            <div className="custom-scrollbar max-h-64 overflow-y-auto">
                {renderTop && (
                    <div className="px-3 py-2.5 border-b border-white/15">
                        {renderTop}
                    </div>
                )}
                {/* Real listbox semantics: the arrow keys already worked, but nothing
                    about the list, the option count or the highlighted row reached a
                    screen reader. WAI-ARIA combobox pattern. */}
                <div role="listbox" id={listId}>
                {results.length > 0 ? (
                    results.map((res, idx) => {
                        const displayItem = { ...res, category: res.category || res.displayCategory };
                        return (
                            <div
                                key={`${res.id || res.name}-${res.typeLabel || ''}`}
                                id={`${listId}-opt-${idx}`}
                                role="option"
                                aria-selected={highlightedIndex === idx}
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    onSelect(res);
                                }}
                                onMouseEnter={() => setHighlightedIndex(idx)}
                                className="cursor-pointer"
                            >
                                <PlatformPill
                                    platform={displayItem}
                                    subtitle={res.typeLabel}
                                    isSelected={highlightedIndex === idx}
                                    isFullWidth
                                    className="pointer-events-none !border-x-0 !border-t-0 !border-b !border-white/10"
                                />
                            </div>
                        );
                    })
                ) : (
                    <div className="lh-label text-white/60 px-3 py-4 text-center">
                        No matches found
                    </div>
                )}
                </div>
            </div>
        </div>,
        document.body
    );
}

/* Shared row chrome — CSV value on the left, target on the right. */
function RowShell({ csvVal, count, children }) {
    return (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-4 py-3 border-t first:border-t-0 border-white/10">
            <div className="min-w-0 flex-1 flex items-baseline gap-3">
                <span className="text-sm text-white truncate font-mono" title={csvVal}>"{csvVal}"</span>
                {count > 0 && (
                    <span className="lh-label text-white/50 tabular-nums shrink-0">{count} {count === 1 ? 'Row' : 'Rows'}</span>
                )}
            </div>
            {children}
        </div>
    );
}

function MapRow({ csvVal, count, value, onChange, options, placeholder, isStatus }) {
    return (
        <RowShell csvVal={csvVal} count={count}>
            <DropdownMenu
                options={[
                    { label: placeholder, onClick: () => onChange(null), isActive: !value },
                    ...options.map(opt => ({
                        label: isStatus ? (
                            <span className="flex items-center gap-2">
                                <StatusDot status={opt} />
                                {opt}
                            </span>
                        ) : opt,
                        onClick: () => onChange(opt),
                        isActive: value === opt
                    }))
                ]}
                align="left"
            >
                {/* Must be a real <button>: DropdownMenu puts its aria-haspopup /
                    aria-expanded on this child and relies on it being focusable. As a
                    <div> the whole Status/Priority/Rating mapping step was mouse-only. */}
                <button
                    type="button"
                    aria-label={`${placeholder}: ${value || 'not set'}`}
                    className={`flex items-center justify-between gap-2 w-full sm:w-52 h-9 px-3 border transition-colors cursor-pointer focus-visible:outline-none focus-visible:border-white focus-visible:ring-1 focus-visible:ring-white ${value ? 'border-white/40 text-white' : 'border-white/20 text-white/60'
                        } hover:border-white/70`}>
                    <span className="lh-label truncate flex items-center gap-2">
                        {isStatus && value && <StatusDot status={value} />}
                        {value || placeholder}
                    </span>
                    <span className="lh-label text-white/50 shrink-0">▾</span>
                </button>
            </DropdownMenu>
        </RowShell>
    );
}

function PlatformMapRow({ csvVal, count, mapping, onChange }) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const listId = useId();
    const inputRef = useRef(null);
    const debounceRef = useRef(null);

    const runSearch = useCallback(async (val) => {
        if (val.length < 2) {
            setResults([]);
            setOpen(false);
            return;
        }
        setLoading(true);
        const q = val.toLowerCase();

        const getMatchScore = (item) => {
            if (!q) return 0;
            const name = item.name.toLowerCase();
            const abbrev = item.abbreviation ? item.abbreviation.toLowerCase() : '';

            if (name === q) return 100;
            if (abbrev === q) return 95;
            if (name.startsWith(q)) return 80;
            if (abbrev.startsWith(q)) return 75;

            const index = name.indexOf(q);
            if (index !== -1) {
                return Math.max(30, 50 - index);
            }

            if (abbrev && abbrev.includes(q)) return 20;
            return 0;
        };

        // Local search first
        const localHw = POPULAR_HARDWARE.filter(p => p.name.toLowerCase().includes(q) || (p.abbreviation && p.abbreviation.toLowerCase().includes(q)));
        const localStores = POPULAR_STORES.filter(p => p.name.toLowerCase().includes(q));
        const localSubs = POPULAR_SUBSCRIPTIONS.filter(p => p.name.toLowerCase().includes(q));

        const localHwList = localHw.map(item => ({ ...item, typeLabel: 'Platform', displayCategory: 'hardware' }));
        const localStoresList = localStores.map(item => ({ ...item, typeLabel: 'Store', displayCategory: 'store' }));
        const localSubsList = localSubs.map(item => ({ ...item, typeLabel: 'Subscription', displayCategory: 'subscription' }));

        const isAlreadyLocal = (name) => {
            const cleanName = (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            return [...localHwList, ...localStoresList, ...localSubsList].some(
                p => (p.name || '').toLowerCase().replace(/[^a-z0-9]/g, '') === cleanName
            );
        };

        const customPlats = getUserCustomPlatforms().filter(p => p.name.toLowerCase().includes(q));
        const customHardware = customPlats.filter(p => (p.category === 'hardware' || !p.category) && !isAlreadyLocal(p.name)).map(item => ({ ...item, typeLabel: 'Custom Platform', displayCategory: 'hardware' }));
        const customStores = customPlats.filter(p => p.category === 'store' && !isAlreadyLocal(p.name)).map(item => ({ ...item, typeLabel: 'Custom Store', displayCategory: 'store' }));
        const customSubscriptions = customPlats.filter(p => p.category === 'subscription' && !isAlreadyLocal(p.name)).map(item => ({ ...item, typeLabel: 'Custom Subscription', displayCategory: 'subscription' }));

        let combined = [...localHwList, ...localStoresList, ...localSubsList, ...customHardware, ...customStores, ...customSubscriptions];

        combined.sort((a, b) => {
            const scoreA = getMatchScore(a);
            const scoreB = getMatchScore(b);
            if (scoreB !== scoreA) {
                return scoreB - scoreA;
            }
            return a.name.localeCompare(b.name);
        });

        setResults(combined.slice(0, 15));
        setHighlightedIndex(0);
        setOpen(true);

        // Remote search
        try {
            const [apiPlats, apiStores] = await Promise.all([
                searchPlatforms(val),
                searchExternalGameSources(val)
            ]);

            const getNormalizedKey = (p) => (p.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

            const remotePlats = apiPlats.map(p => ({
                id: p.id, name: p.name, abbreviation: p.abbreviation, platform_logo_image_id: p.platform_logo_image_id || p.platform_logo?.image_id,
                typeLabel: 'Platform', displayCategory: 'hardware'
            })).filter(p => !combined.some(c => getNormalizedKey(c) === getNormalizedKey(p)));

            const remoteStores = apiStores.map(s => ({
                id: s.id, name: s.name, category: 'store',
                typeLabel: 'Store', displayCategory: 'store'
            })).filter(s => !combined.some(c => getNormalizedKey(c) === getNormalizedKey(s)) && !remotePlats.some(rp => getNormalizedKey(rp) === getNormalizedKey(s)));

            combined = [...combined, ...remotePlats, ...remoteStores];

            combined.sort((a, b) => {
                const scoreA = getMatchScore(a);
                const scoreB = getMatchScore(b);
                if (scoreB !== scoreA) {
                    return scoreB - scoreA;
                }
                return a.name.localeCompare(b.name);
            });

            setResults(combined.slice(0, 15));
        } catch (e) {
            console.error(e);
        }

        setLoading(false);
    }, []);

    const handleInput = (val) => {
        setQuery(val);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => runSearch(val), 400);
    };

    // Don't let a pending debounce fire after unmount
    useEffect(() => () => clearTimeout(debounceRef.current), []);

    const handleKeyDown = (e) => {
        if (!open || results.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlightedIndex(prev => (prev + 1) % results.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlightedIndex(prev => (prev - 1 + results.length) % results.length);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            onChange(results[highlightedIndex]);
            setOpen(false);
        } else if (e.key === 'Escape') {
            setOpen(false);
        }
    };

    const isActuallyMapped = !!mapping;

    const setCustom = (category) => {
        onChange({ isCustomCategory: true, category, name: csvVal });
        setOpen(false);
    };

    return (
        <RowShell csvVal={csvVal} count={count}>
            <div className="relative w-full sm:w-96 shrink-0">
                {isActuallyMapped ? (
                    <PlatformPill platform={mapping} showType={true} isFullWidth>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onChange(null);
                                setQuery('');
                            }}
                            className="ml-2 -mr-1 p-1 text-white/60 hover:text-white transition-colors cursor-pointer shrink-0"
                            title="Remove mapping"
                        >
                            <X size={13} />
                        </button>
                    </PlatformPill>
                ) : (
                    <>
                        <div className="relative flex items-center w-full h-10 bg-black border border-white/20 focus-within:border-white/70 transition-colors">
                            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50 pointer-events-none" />
                            <input
                aria-label="Search IGDB"
                                ref={inputRef}
                                type="text"
                                role="combobox"
                                aria-expanded={open}
                                aria-controls={listId}
                                aria-autocomplete="list"
                                aria-activedescendant={open && results.length > 0 ? `${listId}-opt-${highlightedIndex}` : undefined}
                                value={query}
                                onChange={(e) => handleInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder={`Search "${csvVal}"`}
                                className="w-full h-full pl-9 pr-8 bg-transparent lh-label text-white outline-none placeholder:text-white/50"
                                onFocus={() => {
                                    setOpen(true);
                                    if (query.length >= 2 && results.length === 0) runSearch(query);
                                }}
                                onBlur={() => {
                                    // Need a small timeout to allow clicking dropdown items
                                    setTimeout(() => setOpen(false), 200);
                                }}
                            />
                            {(query || loading) && (
                                <button
                                    onClick={() => {
                                        setQuery('');
                                        setResults([]);
                                        inputRef.current?.focus();
                                    }}
                                    aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 p-2 -m-2 text-white/50 hover:text-white cursor-pointer"
                                >
                                    <X size={13} />
                                </button>
                            )}
                        </div>
                        <PortalDropdown
                            anchorRef={inputRef}
                            listId={listId}
                            visible={open}
                            results={results}
                            highlightedIndex={highlightedIndex}
                            setHighlightedIndex={setHighlightedIndex}
                            onSelect={(item) => {
                                onChange(item);
                                setOpen(false);
                            }}
                            renderTop={
                                <div className="flex items-center justify-between gap-2">
                                    <span className="lh-label text-white/60 shrink-0">Save as Custom</span>
                                    <div className="flex items-center">
                                        {[['hardware', 'HW'], ['store', 'Store'], ['subscription', 'Sub']].map(([cat, label]) => (
                                            <button
                                                key={cat}
                                                /* preventDefault keeps the field focused so the
                                                   dropdown stays open; the action lives on click so
                                                   Enter/Space reach it too. WCAG 2.1.1. */
                                                onMouseDown={(e) => e.preventDefault()}
                                                onClick={() => setCustom(cat)}
                                                className="lh-label px-2.5 py-1.5 border border-white/20 -ml-px text-white/60 hover:bg-white hover:text-black hover:border-white transition-colors cursor-pointer"
                                            >
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            }
                        />
                    </>
                )}
            </div>
        </RowShell>
    );
}

export default function StepMappingV2({
    uniqueCsvStatuses, statusValueMap, setStatusValueMap,
    uniqueCsvPriorities, priorityValueMap, setPriorityValueMap,
    uniqueCsvRatings, ratingValueMap, setRatingValueMap,
    uniqueCsvPlatforms, platformValueMap, setPlatformValueMap,
    csvData = [], columnMap = {}
}) {
    const [tab, setTab] = useState('Status');

    /* How many CSV rows each distinct value covers — turns an abstract list into
       "this decision affects 412 games". Mirrors the parse in ImportWizard. */
    const counts = useMemo(() => {
        const c = { Status: {}, Priority: {}, Rating: {}, Platforms: {} };
        const bump = (bucket, key) => { c[bucket][key] = (c[bucket][key] || 0) + 1; };
        const simple = [['Status', columnMap.status], ['Priority', columnMap.priority], ['Rating', columnMap.rating]];

        csvData.forEach(row => {
            simple.forEach(([bucket, col]) => {
                if (!col) return;
                const v = row[col];
                if (v && String(v).trim()) bump(bucket, String(v).trim());
            });
            const pcol = columnMap.platform;
            if (pcol && row[pcol]) {
                String(row[pcol])
                    .split(/[;,|/]/)
                    .map(s => s.trim())
                    .filter(Boolean)
                    .filter((e, i, arr) => arr.findIndex(x => x.toLowerCase() === e.toLowerCase()) === i)
                    .forEach(p => bump('Platforms', p));
            }
        });
        return c;
    }, [csvData, columnMap]);

    const categories = [
        { label: 'Status', data: uniqueCsvStatuses, map: statusValueMap },
        { label: 'Priority', data: uniqueCsvPriorities, map: priorityValueMap },
        { label: 'Rating', data: uniqueCsvRatings, map: ratingValueMap },
        { label: 'Platforms', data: uniqueCsvPlatforms, map: platformValueMap },
    ];

    const validCategories = categories.filter(item => item.data?.length > 0);

    // Nothing to translate — only a name column was mapped.
    if (validCategories.length === 0) {
        return (
            <EmptyPlate title="Nothing to Translate" body="No status, priority, rating or platform columns were mapped" />
        );
    }

    const active = validCategories.find(c => c.label === tab) || validCategories[0];
    const activeCounts = counts[active.label] || {};

    return (
        <div>
            {/* Category strip — unresolved count per category, so you can't miss one */}
            <div className="flex overflow-x-auto no-scrollbar border border-white/15 mb-8">
                {validCategories.map(c => {
                    const isActive = active.label === c.label;
                    const unresolved = c.data.filter(v => !c.map[v]).length;
                    return (
                        <button
                            key={c.label}
                            onClick={() => setTab(c.label)}
                            className={`flex items-baseline gap-1.5 px-4 py-2.5 whitespace-nowrap border-r last:border-r-0 border-white/10 transition-colors cursor-pointer ${isActive ? 'bg-white text-black' : 'text-white/50 hover:text-white'
                                }`}
                        >
                            <span className="lh-label">{c.label}</span>
                            <span className="lh-label tabular-nums">
                                {unresolved ? `${unresolved}!` : c.data.length}
                            </span>
                        </button>
                    );
                })}
            </div>

            <div className="flex items-center gap-3 mb-4">
                <h2 className="lh-display text-[22px] lg:text-[28px] text-white/80 m-0">
                    {active.label === 'Platforms' ? 'CSV Value → Platform' : `CSV Value → ${active.label}`}
                </h2>
                <div className="flex-1 h-px bg-white/15" />
                <span className="lh-label text-white/60 tabular-nums">
                    {active.data.filter(v => active.map[v]).length} / {active.data.length} Resolved
                </span>
            </div>

            <div className="border border-white/15">
                {active.label === 'Status' && uniqueCsvStatuses.map(val => (
                    <MapRow
                        key={val} csvVal={val} count={activeCounts[val]} value={statusValueMap[val]}
                        onChange={(v) => setStatusValueMap(p => ({ ...p, [val]: v }))}
                        options={MOCTALE_STATUSES} placeholder="→ Backlog"
                        isStatus={true}
                    />
                ))}
                {active.label === 'Priority' && uniqueCsvPriorities.map(val => (
                    <MapRow
                        key={val} csvVal={val} count={activeCounts[val]} value={priorityValueMap[val]}
                        onChange={(v) => setPriorityValueMap(p => ({ ...p, [val]: v }))}
                        options={MOCTALE_PRIORITIES} placeholder="→ None"
                    />
                ))}
                {active.label === 'Rating' && uniqueCsvRatings.map(val => (
                    <MapRow
                        key={val} csvVal={val} count={activeCounts[val]} value={ratingValueMap[val]}
                        onChange={(v) => setRatingValueMap(p => ({ ...p, [val]: v }))}
                        options={MOCTALE_FEELS} placeholder="→ None"
                    />
                ))}
                {active.label === 'Platforms' && uniqueCsvPlatforms.map(val => (
                    <PlatformMapRow
                        key={val} csvVal={val} count={activeCounts[val]} mapping={platformValueMap[val]}
                        onChange={(v) => setPlatformValueMap(p => ({ ...p, [val]: v }))}
                    />
                ))}
            </div>

            <p className="lh-label text-white/50 mt-4 leading-relaxed">
                {/* Mirrors the real fallbacks in ImportWizard.startApiFetchPhase */}
                {{
                    Status: 'Unresolved values fall back to Backlog',
                    Priority: 'Unresolved values are kept verbatim from the CSV',
                    Rating: 'Unresolved values are left empty',
                    Platforms: 'Unresolved values are saved as custom hardware',
                }[active.label]}
            </p>
        </div>
    );
}
