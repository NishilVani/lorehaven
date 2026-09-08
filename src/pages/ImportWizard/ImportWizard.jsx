import { useState, useRef } from 'react';
import { toast } from '../../components/ui/Toast';
import { toDateInputValue } from '../../services/libraryFields';
import Papa from 'papaparse';
import { useNavigate } from 'react-router-dom';
import { searchGames } from '../../services/igdb';
import { getLibrary, saveManyToLibrary, addUserCustomPlatform, getUserCustomPlatforms, getUserOwnedPlatforms, setUserOwnedPlatforms } from '../../services/db';
import { POPULAR_HARDWARE, POPULAR_STORES, POPULAR_SUBSCRIPTIONS } from '../../constants/platformConstants';

import StepUpload from './StepUpload';
import StepSchemaV2 from './StepSchema';
import StepMappingV2 from './StepMapping';
import StepReviewV2 from './StepReview';
import WizardShell from './WizardShell';
import Dialog from '../../components/ui/Dialog';
import { statusColor } from '../../constants/stateColors';

/* IGDB's documented ceiling is 4 requests a second. This is the gap between
   request STARTS, so a slow request costs no extra wait at all. */
const MIN_REQUEST_INTERVAL_MS = 250;

export default function ImportWizardV2() {
    const navigate = useNavigate();
    const [step, setStep] = useState(1);
    const [csvHeaders, setCsvHeaders] = useState([]);
    const [csvData, setCsvData] = useState([]);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef(null);
    const [fileName, setFileName] = useState('');

    const [columnMap, setColumnMap] = useState({ name: '', status: '', priority: '', rating: '', notes: '', platform: '', completionDate: '' });
    const [uniqueCsvStatuses, setUniqueCsvStatuses] = useState([]);
    const [statusValueMap, setStatusValueMap] = useState({});
    const [uniqueCsvPriorities, setUniqueCsvPriorities] = useState([]);
    const [priorityValueMap, setPriorityValueMap] = useState({});
    const [uniqueCsvRatings, setUniqueCsvRatings] = useState([]);
    const [ratingValueMap, setRatingValueMap] = useState({});
    const [uniqueCsvPlatforms, setUniqueCsvPlatforms] = useState([]);
    const [platformValueMap, setPlatformValueMap] = useState({});

    const [isFetchingApi, setIsFetchingApi] = useState(false);
    const [fetchProgress, setFetchProgress] = useState({ current: 0, total: 0 });
    /* Rows with no name are unusable, but dropping them silently made the header
       ('165 Rows') and the result ('N Matched') disagree with nothing to explain the
       gap. Counted so the review step can account for every row it was given. */
    const [skippedRows, setSkippedRows] = useState(0);
    const [reviewItems, setReviewItems] = useState([]);
    const [manualQueries, setManualQueries] = useState({});
    const [isSearchingManual, setIsSearchingManual] = useState({});

    const abortFetchRef = useRef(false);
    const [showStopConfirm, setShowStopConfirm] = useState(false);
    const [showSaveConfirm, setShowSaveConfirm] = useState(false);

    const getYear = (timestamp) => {
        if (!timestamp) return '—';
        return new Date(timestamp * 1000).getFullYear();
    };

    const parsePlatformCell = (value) => {
        if (!value) return [];
        return String(value)
            .split(/[;,|/]/)
            .map((entry) => entry.trim())
            .filter(Boolean)
            .filter((entry, index, arr) => arr.findIndex((item) => item.toLowerCase() === entry.toLowerCase()) === index);
    };

    const parseResultsAndProceed = (results) => {
        const headers = results.meta.fields || [];
        setCsvHeaders(headers);
        setCsvData(results.data);

        const guessMap = { name: '', status: '', priority: '', rating: '', notes: '', platform: '', completionDate: '' };
        headers.forEach(field => {
            const lower = field.toLowerCase();
            if (lower.includes('name') || lower.includes('title')) guessMap.name = field;
            if (lower.includes('status') || lower.includes('state')) guessMap.status = field;
            if (lower.includes('priority')) guessMap.priority = field;
            if (lower.includes('platform') || lower.includes('system') || lower.includes('console')) guessMap.platform = field;
            if (lower.includes('date') && (lower.includes('finish') || lower.includes('beat') || lower.includes('complete'))) guessMap.completionDate = field;
            if (lower.includes('notes') || lower.includes('review') || lower.includes('comment')) guessMap.notes = field;
            // After notes: a "Review score" header is a rating, and order decides.
            if (lower.includes('rating') || lower.includes('score') || lower.includes('feel')) guessMap.rating = field;
        });

        setColumnMap(guessMap);
        setStep(2);
    };

    const processFiles = (fileList) => {
        if (!fileList || fileList.length === 0) return;
        const actualFile = fileList[0];
        if (!actualFile || !actualFile.name.toLowerCase().endsWith('.csv')) {
            toast('That file is not a CSV. Export as CSV and try again.', 'error');
            return;
        }
        setFileName(actualFile.name);
        Papa.parse(actualFile, {
            header: true,
            skipEmptyLines: true,
            complete: parseResultsAndProceed
        });
    };

    const handleFileUpload = (e) => {
        e.stopPropagation();
        processFiles(e.target.files);
    };

    const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); };
    const handleDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); };
    const handleDrop = (e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); processFiles(e.dataTransfer.files); };

    const proceedToValueMapping = () => {

        const autoMapStatus = (val) => {
            if (/complete|finish|beat/i.test(val)) return 'Beaten';
            if (/play|current/i.test(val)) return 'Playing';
            if (/drop|abandon|quit|hold/i.test(val)) return 'Dropped';
            if (/backlog|queue|wait/i.test(val) || /^to play$/i.test(val)) return 'Backlog';
            if (/wish|want/i.test(val)) return 'Wishlist';
            return null;
        };

        const autoMapPriority = (val) => {
            if (/high|must|next|p1/i.test(val)) return 'Next Up';
            if (/med|norm|try|soon|p2/i.test(val)) return 'Soon';
            if (/low|when|maybe|someday|p3/i.test(val)) return 'Maybe';
            return null;
        };

        const autoMapRating = (val) => {
            if (/masterpiece|perfect|amazing|10\/10|5\/5|5 star/i.test(val)) return 'Perfection';
            if (/good|great|8\/10|9\/10|4\/5|4 star/i.test(val)) return 'Go for it';
            if (/average|okay|mid|timepass|7\/10|6\/10|3\/5|3 star/i.test(val)) return 'Timepass';
            if (/bad|terrible|skip|awful|garbage|trash|1\/10|2\/10|1\/5|2\/5|1 star|2 star/i.test(val)) return 'Skip';
            return null;
        };

        if (columnMap.status) {
            const statuses = new Set();
            const autoMap = {};
            csvData.forEach(row => {
                const val = row[columnMap.status];
                if (val && val.trim() !== '') {
                    const str = val.trim();
                    statuses.add(str);
                    const match = autoMapStatus(str);
                    if (match) autoMap[str] = match;
                }
            });
            setUniqueCsvStatuses(Array.from(statuses));
            setStatusValueMap(autoMap);
        }

        if (columnMap.priority) {
            const priorities = new Set();
            const autoMap = {};
            csvData.forEach(row => {
                const val = row[columnMap.priority];
                if (val && val.trim() !== '') {
                    const str = val.trim();
                    priorities.add(str);
                    const match = autoMapPriority(str);
                    if (match) autoMap[str] = match;
                }
            });
            setUniqueCsvPriorities(Array.from(priorities));
            setPriorityValueMap(autoMap);
        }

        if (columnMap.rating) {
            const ratings = new Set();
            const autoMap = {};
            csvData.forEach(row => {
                const val = row[columnMap.rating];
                if (val && val.trim() !== '') {
                    const str = val.trim();
                    ratings.add(str);
                    const match = autoMapRating(str);
                    if (match) autoMap[str] = match;
                }
            });
            setUniqueCsvRatings(Array.from(ratings));
            setRatingValueMap(autoMap);
        }

        if (columnMap.platform) {
            const platformSet = new Set();
            csvData.forEach(row => {
                const val = row[columnMap.platform];
                if (!val) return;
                String(val).split(/[;,|/]/).map(s => s.trim()).filter(Boolean).forEach(p => platformSet.add(p));
            });
            const platforms = Array.from(platformSet);
            setUniqueCsvPlatforms(platforms);
            const autoMap = {};
            
            const localHw = [...POPULAR_HARDWARE];
            // Add a few hardcoded aliases to localHw for common variations
            localHw.push({ id: 6, name: 'PC', abbreviation: 'PC' });
            localHw.push({ id: 6, name: 'Windows', abbreviation: 'PC' });
            localHw.push({ id: 167, name: 'PS5', abbreviation: 'PS5' });
            localHw.push({ id: 48, name: 'PS4', abbreviation: 'PS4' });
            localHw.push({ id: 9, name: 'PS3', abbreviation: 'PS3' });
            localHw.push({ id: 130, name: 'Switch', abbreviation: 'Switch' });
            
            const customPlatforms = getUserCustomPlatforms().map(p => ({
                ...p,
                category: p.category || 'hardware'
            }));

            const combinedPlatforms = [
                ...POPULAR_STORES,
                ...POPULAR_SUBSCRIPTIONS,
                ...localHw,
                ...customPlatforms
            ];

            const stripStr = (s) => s ? s.replace(/[\W_]+/g, '').toLowerCase() : '';

            platforms.forEach(p => {
                const normalized = p.toLowerCase();
                const stripped = stripStr(p);
                
                // Tier 1: Exact Match
                let match = combinedPlatforms.find(cp => 
                    cp.name.toLowerCase() === normalized || 
                    (cp.abbreviation && cp.abbreviation.toLowerCase() === normalized)
                );
                
                // Tier 2: Alphanumeric Match
                if (!match) {
                    match = combinedPlatforms.find(cp => 
                        stripStr(cp.name) === stripped || 
                        (cp.abbreviation && stripStr(cp.abbreviation) === stripped)
                    );
                }

                // Tier 3: Contains Match (standalone word)
                if (!match) {
                    match = combinedPlatforms.find(cp => {
                        const nameWord = cp.name.toLowerCase();
                        const abbrevWord = cp.abbreviation ? cp.abbreviation.toLowerCase() : null;
                        
                        if (nameWord.length >= 3 && normalized.includes(nameWord)) return true;
                        if (abbrevWord && abbrevWord.length >= 3 && normalized.includes(abbrevWord)) return true;
                        return false;
                    });
                }

                // Tier 4: Reverse Contains (CSV is a substring of the official name, e.g. "Epic Games" -> "Epic Games Store", "Gamepass" -> "Xbox Game Pass")
                if (!match && normalized.length >= 4) {
                    match = combinedPlatforms.find(cp => {
                        const nameWord = cp.name.toLowerCase();
                        const strippedName = stripStr(cp.name);
                        
                        if (nameWord.includes(normalized)) return true;
                        if (strippedName.includes(stripped)) return true;
                        return false;
                    });
                }

                if (match) {
                    autoMap[p] = match;
                } else {
                    autoMap[p] = null;
                }
            });
            setPlatformValueMap(autoMap);
        }

        setStep(3);
    };

    const startApiFetchPhase = async () => {
        /* Nothing is written here. finalizeImport records each mapped platform per
           saved row after Confirm Save; writing them on the way to the review step
           made the confirm dialog decorative. */
        setStep(4);
        setIsFetchingApi(true);
        setReviewItems([]);
        setSkippedRows(0);
        setFetchProgress({ current: 0, total: csvData.length });
        abortFetchRef.current = false;
        const existingDb = getLibrary();
        let lastRequestAt = 0;

        for (let i = 0; i < csvData.length; i++) {
            if (abortFetchRef.current) break;
            const row = csvData[i];
            // Trim once, at the source: a whitespace-only name used to pass
            // `if (!rawName)` and land as a nameless library entry.
            const rawName = String(row[columnMap.name] ?? '').trim();
            setFetchProgress({ current: i + 1, total: csvData.length });
            if (!rawName) { setSkippedRows(n => n + 1); continue; }

            const rawStatus = columnMap.status ? row[columnMap.status] : '';
            const finalStatus = statusValueMap[rawStatus] || 'Backlog';
            const rawPriority = columnMap.priority ? row[columnMap.priority] : null;
            const finalPriority = rawPriority ? (priorityValueMap[rawPriority] || rawPriority) : null;
            const rawRating = columnMap.rating ? row[columnMap.rating] : null;
            const finalFeel = rawRating ? (ratingValueMap[rawRating] || null) : null;
            const rawPlatform = columnMap.platform ? row[columnMap.platform] : null;
            const mappedPlatforms = parsePlatformCell(rawPlatform).map(csvName => {
                const mapping = platformValueMap[csvName];
                if (mapping && !mapping.isCustomCategory) {
                    return { ...mapping };
                }
                const category = mapping?.category || 'hardware';
                return { name: csvName, category, abbreviation: null };
            });
            const rawCompletionDate = columnMap.completionDate ? row[columnMap.completionDate] : null;
            const rawNotes = columnMap.notes ? row[columnMap.notes] : '';

            /* Pace by when the previous request STARTED, not by sleeping a flat
               amount after it finished. The old code waited 600ms after every
               row no matter how long the request itself took, so importing the
               165-row sample this app ships spent 99 seconds doing nothing on
               top of the network time — and still only reached ~1.6 requests a
               second, well under IGDB's ceiling. Waiting out the remainder of a
               250ms window instead holds a steady 4/second and costs nothing at
               all when a request already took longer than that. Still strictly
               sequential, so CSV row order and the abort check are unchanged. */
            const sinceLast = Date.now() - lastRequestAt;
            if (sinceLast < MIN_REQUEST_INTERVAL_MS) {
                await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL_MS - sinceLast));
                if (abortFetchRef.current) break;
            }
            lastRequestAt = Date.now();
            const results = await searchGames(rawName);
            if (abortFetchRef.current) break;

            const selectedMatch = results.length > 0 ? (results.find(r => r.name.toLowerCase() === rawName.trim().toLowerCase()) || results[0]) : null;
            const conflict = selectedMatch ? existingDb.find(g => g.id === selectedMatch.id) : null;

            const newItem = {
                id: `import_${i}`,
                originalName: rawName,
                mappedStatus: finalStatus,
                mappedPriority: finalPriority,
                mappedFeel: finalFeel,
                mappedPlatforms,
                completionDate: rawCompletionDate,
                igdbResults: results,
                selectedMatchId: selectedMatch ? selectedMatch.id.toString() : 'custom',
                conflict: conflict || null,
                resolutionAction: conflict ? 'skip' : 'save',
                isSelected: true,
                notes: rawNotes
            };

            setReviewItems(prev => [...prev, newItem]);
        }

        setIsFetchingApi(false);
    };

    const handleDiscardItem = (itemId) => setReviewItems(prev => prev.filter(item => item.id !== itemId));

    const handleManualSearch = async (itemId) => {
        const query = manualQueries[itemId];
        if (!query) return;
        setIsSearchingManual(prev => ({ ...prev, [itemId]: true }));
        const results = await searchGames(query);
        const existingDb = getLibrary();
        setReviewItems(prev => prev.map(item => {
            if (item.id === itemId) {
                const selectedMatch = results.length > 0 ? (results.find(r => r.name.toLowerCase() === query.trim().toLowerCase()) || results[0]) : null;
                const conflict = selectedMatch ? existingDb.find(g => g.id === selectedMatch.id) : null;
                return { ...item, igdbResults: results, selectedMatchId: selectedMatch ? selectedMatch.id.toString() : 'custom', conflict: conflict || null, resolutionAction: conflict ? 'skip' : 'save', isSelected: true };
            }
            return item;
        }));
        setIsSearchingManual(prev => ({ ...prev, [itemId]: false }));
    };

    const toggleItemSelection = (itemId) => {
        setReviewItems(prev => prev.map(item =>
            item.id === itemId ? { ...item, isSelected: !item.isSelected } : item
        ));
    };

    const toggleAllSelection = (isSelected) => {
        setReviewItems(prev => prev.map(item => ({ ...item, isSelected })));
    };

    const updateMatch = (itemId, matchId) => {
        setReviewItems(prev => prev.map(item => {
            if (item.id === itemId) {
                const existingDb = getLibrary();
                const conflict = matchId !== 'custom' ? existingDb.find(g => g.id.toString() === matchId) : null;
                return { ...item, selectedMatchId: matchId, conflict: conflict || null, resolutionAction: conflict ? 'skip' : 'save' };
            }
            return item;
        }));
    };

    const toggleConflictOverride = (itemId, isChecked) => {
        setReviewItems(prev => prev.map(item =>
            item.id === itemId ? { ...item, resolutionAction: isChecked ? 'overwrite' : 'skip' } : item
        ));
    };

    const handleBulkOverride = (overwrite) => {
        setReviewItems(prev => prev.map(item =>
            item.conflict ? { ...item, resolutionAction: overwrite ? 'overwrite' : 'skip' } : item
        ));
    };

    const hasConflicts = reviewItems.some(item => item.conflict !== null);

    const finalizeImport = () => {
        const ownedPlatforms = getUserOwnedPlatforms();
        let updatedOwned = [...ownedPlatforms];
        /* Collected and written once. Saving per row read the whole library,
           scanned it, stringified it and wrote it back for every row, which is
           quadratic in the size of the import -- and before the sync coalescing
           it queued one whole-library Firestore write per row as well, which is
           what exhausted the write stream on a large import. */
        const toSave = [];

        reviewItems.forEach(item => {
            // Skip unselected items. For selected conflict items, treat selection as consent to overwrite.
            if (!item.isSelected) return;
            if (item.conflict && item.resolutionAction === 'skip') {
                // User selected this item — override the default skip
                item = { ...item, resolutionAction: 'overwrite' };
            }
            if (item.resolutionAction === 'skip') return;
            
            // Link platforms to user profile
            if (item.mappedPlatforms && Array.isArray(item.mappedPlatforms)) {
                item.mappedPlatforms.forEach(p => {
                    if (p.id && typeof p.id === 'number' && (!p.category || p.category === 'hardware')) {
                        // Official hardware
                        if (!updatedOwned.some(o => o.id === p.id)) {
                            updatedOwned.push({
                                id: p.id,
                                name: p.name,
                                abbreviation: p.abbreviation,
                                platform_logo_image_id: p.platform_logo_image_id
                            });
                        }
                    } else {
                        // Custom hardware, store, or subscription
                        addUserCustomPlatform(p);
                    }
                });
            }

            let gameDataToSave = null;
            if (item.selectedMatchId !== 'custom') {
                const match = item.igdbResults.find(r => r.id.toString() === item.selectedMatchId);
                if (match) {
                    gameDataToSave = { 
                        id: match.id, 
                        status: item.mappedStatus, 
                        feel: item.mappedFeel || null, 
                        priority: item.mappedPriority || null, 
                        user_platforms: item.mappedPlatforms || [], 
                        dateCompleted: toDateInputValue(item.completionDate) || null,   // never write a date the library cannot read back 
                        notes: item.notes || '',
                        cover_width: match.cover?.width || null,
                        cover_height: match.cover?.height || null,
                        is_custom: false 
                    };
                }
            } else {
                gameDataToSave = { 
                    id: `custom_${Date.now()}_${Math.random()}`, 
                    name: item.originalName, 
                    status: item.mappedStatus, 
                    feel: item.mappedFeel || null, 
                    priority: item.mappedPriority || null, 
                    user_platforms: item.mappedPlatforms || [], 
                    dateCompleted: toDateInputValue(item.completionDate) || null,   // never write a date the library cannot read back 
                    notes: item.notes || '',
                    is_custom: true 
                };
            }
            if (gameDataToSave) toSave.push(gameDataToSave);
        });

        saveManyToLibrary(toSave);

        if (updatedOwned.length !== ownedPlatforms.length) {
            setUserOwnedPlatforms(updatedOwned);
        }

        navigate('/library/backlog');
    };

    /* Status is one of the sanctioned colour exceptions — same scale as GameDetail / useLibraryCards. */
    const CATEGORY_MAP = {
        0: 'Main Game', 1: 'DLC', 2: 'Expansion', 3: 'Bundle',
        4: 'Standalone', 5: 'Mod', 6: 'Episode', 7: 'Season',
        8: 'Remake', 9: 'Remaster', 10: 'Expanded', 11: 'Port',
        12: 'Fork', 13: 'Pack', 14: 'Update'
    };

    const selectedItems = reviewItems.filter(i => i.isSelected);
    const saveStats = {
        total: selectedItems.length,
        igdb: selectedItems.filter(i => i.selectedMatchId !== 'custom').length,
        custom: selectedItems.filter(i => i.selectedMatchId === 'custom').length,
        conflicts: selectedItems.filter(i => i.conflict).length,
        byStatus: selectedItems.reduce((acc, item) => {
            const status = item.mappedStatus || 'Unknown';
            acc[status] = (acc[status] || 0) + 1;
            return acc;
        }, {}),
        byType: selectedItems.reduce((acc, item) => {
            let type = 'Custom';
            if (item.selectedMatchId !== 'custom') {
                const match = item.igdbResults?.find(r => r.id.toString() === item.selectedMatchId);
                type = match?.game_type !== undefined ? (CATEGORY_MAP[match.game_type] || 'Unknown') : 'Unknown';
            }
            acc[type] = (acc[type] || 0) + 1;
            return acc;
        }, {})
    };

    /* The required Game Name column can be pointed at a column of ratings, and the
       next step would then search IGDB for "10/10". Look at the column's first
       non-empty cell: a bare number or a fraction is not a title. */
    const nameSample = columnMap.name
        ? String((csvData.find(r => r[columnMap.name] && String(r[columnMap.name]).trim()) || {})[columnMap.name] ?? '').trim()
        : '';
    const nameProblem = /^\d+(\.\d+)?(\s*\/\s*\d+)?$/.test(nameSample)
        ? `That column holds ${nameSample}. Pick the column with the game titles.`
        : null;
    const canGoNext = () => {
        if (step === 2) return !!columnMap.name && !nameProblem;
        return true;
    };

    const handleNext = () => {
        if (step === 2) proceedToValueMapping();
        else if (step === 3) startApiFetchPhase();
        else if (step === 4) setShowSaveConfirm(true);
    };

    return (
        <WizardShell
            step={step}
            setStep={setStep}
            isFetchingApi={isFetchingApi}
            canGoNext={canGoNext()}
            onNext={handleNext}
            onStopFetching={() => setShowStopConfirm(true)}
            csvData={csvData}
            reviewItems={reviewItems}
            fileName={fileName}
        >
            {step === 1 && (
                <StepUpload
                    isDragging={isDragging}
                    handleDragOver={handleDragOver}
                    handleDragLeave={handleDragLeave}
                    handleDrop={handleDrop}
                    handleFileUpload={handleFileUpload}
                    fileInputRef={fileInputRef}
                    fileName={fileName}
                    parseResultsAndProceed={parseResultsAndProceed}
                />
            )}
            {step === 2 && (
                <StepSchemaV2
                    columnMap={columnMap}
                    setColumnMap={setColumnMap}
                    csvHeaders={csvHeaders}
                    csvData={csvData}
                    fileName={fileName}
                    nameProblem={nameProblem}
                />
            )}
            {step === 3 && (
                <StepMappingV2
                    uniqueCsvStatuses={uniqueCsvStatuses}
                    statusValueMap={statusValueMap}
                    setStatusValueMap={setStatusValueMap}
                    uniqueCsvPriorities={uniqueCsvPriorities}
                    priorityValueMap={priorityValueMap}
                    setPriorityValueMap={setPriorityValueMap}
                    uniqueCsvRatings={uniqueCsvRatings}
                    ratingValueMap={ratingValueMap}
                    setRatingValueMap={setRatingValueMap}
                    uniqueCsvPlatforms={uniqueCsvPlatforms}
                    platformValueMap={platformValueMap}
                    setPlatformValueMap={setPlatformValueMap}
                    csvData={csvData}
                    columnMap={columnMap}
                />
            )}
            {step === 4 && (
                <StepReviewV2
                    isFetchingApi={isFetchingApi}
                    skippedRows={skippedRows}
                    fetchProgress={fetchProgress}
                    hasConflicts={hasConflicts}
                    handleBulkOverride={handleBulkOverride}
                    reviewItems={reviewItems}
                    updateMatch={updateMatch}
                    toggleConflictOverride={toggleConflictOverride}
                    handleDiscardItem={handleDiscardItem}
                    getYear={getYear}
                    manualQueries={manualQueries}
                    setManualQueries={setManualQueries}
                    handleManualSearch={handleManualSearch}
                    isSearchingManual={isSearchingManual}
                    toggleItemSelection={toggleItemSelection}
                    toggleAllSelection={toggleAllSelection}
                />
            )}

            {/* Stop Fetching Confirmation Modal */}
            {showStopConfirm && (
                <Dialog
                    open={showStopConfirm}
                    onClose={() => setShowStopConfirm(false)}
                    labelledBy="stop-confirm-title"
                    z={9999}
                    panelClassName="w-full max-w-sm p-6"
                >
                        <div className="lh-label text-white/60 mb-2">Import — Fetch</div>
                        <h3 id="stop-confirm-title" className="lh-display text-xl text-white mb-4">Stop Fetching?</h3>
                        <p className="text-[13px] text-white/50 leading-relaxed mb-6">
                            Rows that haven't been fetched yet are discarded. You'll only review and import the{' '}
                            <span className="text-white tabular-nums">{fetchProgress.current}</span> processed so far.
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setShowStopConfirm(false)}
                                className="flex-1 h-10 border border-white/20 lh-label text-white/60 hover:bg-white hover:text-black hover:border-white transition-colors cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => {
                                    abortFetchRef.current = true;
                                    setShowStopConfirm(false);
                                }}
                                className="flex-1 h-10 border border-white/15 text-[var(--destructive)] hover:bg-[var(--destructive-hover)] hover:text-black lh-label transition-colors cursor-pointer"
                            >
                                Stop Fetching
                            </button>
                        </div>
                </Dialog>
            )}
            {/* Save Confirmation Modal — the manifest of what is about to be written */}
            {showSaveConfirm && (
                <Dialog
                    open={showSaveConfirm}
                    onClose={() => setShowSaveConfirm(false)}
                    labelledBy="save-confirm-title"
                    z={9999}
                    panelClassName="w-full max-w-md flex flex-col max-h-[90vh]"
                >

                        {/* Hero total */}
                        <div className="p-6 border-b border-white/15 shrink-0">
                            <div id="save-confirm-title" className="lh-label text-white/60 mb-2">Import — Manifest</div>
                            <div className="flex items-baseline gap-3">
                                <span className="lh-display text-5xl text-white tabular-nums leading-none">{saveStats.total}</span>
                                <span className="lh-label text-white/60">Games Written</span>
                            </div>
                            {saveStats.conflicts > 0 && (
                                <p className="lh-label text-white mt-3 leading-relaxed">
                                    {saveStats.conflicts} will overwrite {saveStats.conflicts === 1 ? 'an existing entry' : 'existing entries'}
                                </p>
                            )}
                        </div>

                        <div className="overflow-y-auto custom-scrollbar p-6 space-y-6">
                            {/* Source */}
                            <div>
                                <div className="flex items-center gap-3 mb-3">
                                    <span className="lh-display text-sm text-white/80">Source</span>
                                    <div className="flex-1 h-px bg-white/15" />
                                </div>
                                <div className="border border-white/15">
                                    {[['IGDB Linked', saveStats.igdb], ['Custom Entries', saveStats.custom]].map(([label, n]) => (
                                        <div key={label} className="flex items-center justify-between px-4 py-2.5 border-t first:border-t-0 border-white/10">
                                            <span className="lh-label text-white/50">{label}</span>
                                            <span className="lh-label text-white tabular-nums">{n}</span>
                                        </div>
                                    ))}
                                    {saveStats.conflicts > 0 && (
                                        <div className="flex items-center justify-between px-4 py-2.5 border-t border-white/10">
                                            <span className="lh-label text-white">Overwrites</span>
                                            <span className="lh-label text-white tabular-nums">{saveStats.conflicts}</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Status */}
                            {Object.keys(saveStats.byStatus).length > 0 && (
                                <div>
                                    <div className="flex items-center gap-3 mb-3">
                                        <span className="lh-display text-sm text-white/80">Status</span>
                                        <div className="flex-1 h-px bg-white/15" />
                                    </div>
                                    <div className="border border-white/15">
                                        {Object.entries(saveStats.byStatus)
                                            .sort((a, b) => b[1] - a[1])
                                            .map(([status, count]) => (
                                                <div key={status} className="flex items-center justify-between px-4 py-2.5 border-t first:border-t-0 border-white/10">
                                                    <span className="lh-label text-white/50 flex items-center gap-2">
                                                        <span className="w-1.5 h-1.5 shrink-0" style={{ background: statusColor(status) }} />
                                                        {status}
                                                    </span>
                                                    <span className="lh-label text-white tabular-nums">{count}</span>
                                                </div>
                                            ))}
                                    </div>
                                </div>
                            )}

                            {/* Type */}
                            {Object.keys(saveStats.byType).length > 0 && (
                                <div>
                                    <div className="flex items-center gap-3 mb-3">
                                        <span className="lh-display text-sm text-white/80">Game Type</span>
                                        <div className="flex-1 h-px bg-white/15" />
                                    </div>
                                    <div className="border border-white/15">
                                        {Object.entries(saveStats.byType)
                                            .sort((a, b) => b[1] - a[1])
                                            .map(([type, count]) => (
                                                <div key={type} className="flex items-center justify-between px-4 py-2.5 border-t first:border-t-0 border-white/10">
                                                    <span className="lh-label text-white/50">{type}</span>
                                                    <span className="lh-label text-white tabular-nums">{count}</span>
                                                </div>
                                            ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex gap-2 p-6 border-t border-white/15 shrink-0">
                            <button
                                onClick={() => setShowSaveConfirm(false)}
                                className="flex-1 h-10 border border-white/20 lh-label text-white/60 hover:bg-white hover:text-black hover:border-white transition-colors cursor-pointer"
                            >
                                Back to Review
                            </button>
                            <button
                                onClick={() => {
                                    setShowSaveConfirm(false);
                                    finalizeImport();
                                }}
                                className="flex-1 h-10 bg-white text-black hover:bg-neutral-200 lh-label transition-colors cursor-pointer"
                            >
                                Confirm Save
                            </button>
                        </div>
                </Dialog>
            )}
        </WizardShell>
    );
}
