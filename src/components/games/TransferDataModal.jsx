import { useState, useEffect, useRef } from 'react';
import { searchGames } from '../../services/igdb';
import { getLibrary, saveToLibrary, removeFromLibrary, getCollectionsWithGame, removeGameFromCollection, addGameToCollection } from '../../services/db';
import Checkbox from '../ui/Checkbox';
import Dialog from '../ui/Dialog';
import { X, Search, ImageOff, ArrowRight } from 'lucide-react';

const IGDB_CATEGORIES = {
  0: "Main Game",
  1: "DLC Addon",
  2: "Expansion",
  3: "Bundle",
  4: "Standalone Expansion",
  5: "Mod",
  6: "Episode",
  7: "Season",
  8: "Remake",
  9: "Remaster",
  10: "Expanded Game",
  11: "Port",
  12: "Fork",
  13: "Pack",
  14: "Update"
};

export default function TransferDataModal({ sourceGame, onClose, onComplete }) {
  const [step, setStep] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [targetGame, setTargetGame] = useState(null);

  const [selectedData, setSelectedData] = useState({
    status: true,
    platforms: true,
    feel: true,
    date: true,
    notes: true
  });

  const [removeOriginal, setRemoveOriginal] = useState(true);
  const [updateCollections, setUpdateCollections] = useState(true);

  const [isTargetInLibrary, setIsTargetInLibrary] = useState(false);
  const searchInputRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (searchQuery.trim().length > 2) {
        setIsSearching(true);
        const results = await searchGames(searchQuery);
        setSearchResults(results.filter(g => g.id.toString() !== sourceGame.id.toString()));
        setIsSearching(false);
      } else {
        setSearchResults([]);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery, sourceGame.id]);

  useEffect(() => {
    if (step === 1 && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [step]);

  const handleSelectTarget = (game) => {
    setTargetGame(game);
    const lib = getLibrary();
    const exists = lib.some(g => g.id.toString() === game.id.toString());
    setIsTargetInLibrary(exists);
    setStep(2);
  };

  const toggleSelection = (key) => {
    setSelectedData(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleConfirmTransfer = () => {
    const lib = getLibrary();
    const fullSourceGame = lib.find(g => g.id.toString() === sourceGame.id.toString()) || sourceGame;

    let newGameData = {
      id: targetGame.id,
      name: targetGame.name,
      is_custom: false,
    };

    const existingTarget = lib.find(g => g.id.toString() === targetGame.id.toString());
    if (existingTarget) {
      newGameData = { ...existingTarget };
    } else {
      newGameData.cover_id = targetGame.cover?.image_id;
      newGameData.release_year = targetGame.first_release_date
        ? new Date(targetGame.first_release_date * 1000).getUTCFullYear()
        : 'Unknown Year';
    }

    if (selectedData.status) newGameData.status = fullSourceGame.status;
    if (selectedData.platforms) {
      newGameData.user_platforms = fullSourceGame.user_platforms;
      newGameData.user_stores = fullSourceGame.user_stores;
    }
    if (selectedData.feel) {
      newGameData.feel = fullSourceGame.feel;
      newGameData.priority = fullSourceGame.priority;
    }
    if (selectedData.date) {
      newGameData.dateCompleted = fullSourceGame.dateCompleted;
      newGameData.user_time_to_beat = fullSourceGame.user_time_to_beat;
    }
    if (selectedData.notes) {
      newGameData.notes = fullSourceGame.notes;
    }

    saveToLibrary(newGameData);

    if (updateCollections) {
      const collections = getCollectionsWithGame(fullSourceGame.id);
      collections.forEach(colId => {
        removeGameFromCollection(colId, fullSourceGame.id);
        addGameToCollection(colId, newGameData.id);
      });
    }

    if (removeOriginal) {
      removeFromLibrary(fullSourceGame.id);
    }

    onComplete();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      labelledBy="transfer-data-title"
      z={3000}
      backdropClassName="bg-black/80"
      panelClassName="w-full max-w-lg flex flex-col max-h-[90vh] overflow-hidden"
    >

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/20">
          <h2 id="transfer-data-title" className="lh-display text-base text-white m-0">Transfer Data</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer p-1 text-white/60 hover:bg-white hover:text-black transition-colors flex"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto custom-scrollbar flex-1 flex flex-col">
          {step === 1 ? (
            <div className="flex flex-col gap-4 h-full">
              <p className="text-sm text-white/60">
                Transferring data from <span className="text-white font-bold">{sourceGame.name}</span>. Search for the target game below.
              </p>
              <div className="relative flex items-center">
                <Search className="w-4 h-4 absolute left-3 text-white/60" />
                <input
                aria-label="Search IGDB for target game"
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="SEARCH IGDB FOR TARGET GAME"
                  className="w-full h-10 bg-black border border-white/40 pl-10 pr-9 lh-label text-white placeholder:text-white/50 focus:border-white/70 outline-none transition-colors"
                />
                {isSearching && (
                  <span className="lh-label text-white/60 absolute right-3 top-1/2 -translate-y-1/2">…</span>
                )}
              </div>

              <div className="flex-1 overflow-y-auto min-h-[200px]">
                {searchResults.length > 0 ? (
                  <div className="border border-white/15 flex flex-col">
                    {searchResults.map(game => (
                      <button
                        key={game.id}
                        onClick={() => handleSelectTarget(game)}
                        className="flex items-center gap-3 p-2 border-t first:border-t-0 border-white/10 text-left group cursor-pointer hover:bg-white transition-colors"
                      >
                        <div className="w-12 h-16 bg-neutral-900 border border-white/15 overflow-hidden shrink-0">
                          {game.cover?.image_id ? (
                            <img
                              src={`https://images.igdb.com/igdb/image/upload/t_cover_small/${game.cover.image_id}.jpg`}
                              alt={game.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-neutral-700">
                              <ImageOff className="w-5 h-5" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-bold text-white group-hover:text-black truncate transition-colors">{game.name}</h4>
                          <p className="lh-label text-white/60 group-hover:text-black/60 truncate mt-1 transition-colors">
                            {game.first_release_date ? new Date(game.first_release_date * 1000).getUTCFullYear() : 'Unknown Year'}
                            {game.game_type !== undefined && IGDB_CATEGORIES[game.game_type] && ` • ${IGDB_CATEGORIES[game.game_type]}`}
                            {game.involved_companies?.find(c => c.developer)?.company?.name && ` • ${game.involved_companies.find(c => c.developer).company.name}`}
                          </p>
                        </div>
                        <ArrowRight className="w-4 h-4 text-white/50 group-hover:text-black transition-colors mx-2 shrink-0" />
                      </button>
                    ))}
                  </div>
                ) : searchQuery.length > 2 && !isSearching ? (
                  <div className="lh-label text-white/60 text-center py-8 border border-white/15">No games found</div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-5 animate-in fade-in duration-300">
              <div className="flex items-center gap-4 border border-white/15 p-4">
                <div className="flex-1 min-w-0 text-right">
                  <p className="lh-label text-white/60 mb-1">From</p>
                  <p className="text-sm font-bold text-white truncate">{sourceGame.name}</p>
                </div>
                <ArrowRight className="w-5 h-5 text-white/50 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="lh-label text-white/60 mb-1">To</p>
                  <p className="text-sm font-bold text-white truncate">{targetGame.name}</p>
                </div>
              </div>

              {isTargetInLibrary && (
                <div className="border border-[var(--destructive-border)] p-3 text-[var(--destructive)]">
                  <p className="text-xs leading-tight">
                    <strong>Warning:</strong> The target game is already in your library. Selected data will overwrite its current values.
                  </p>
                </div>
              )}

              <div>
                <h3 className="lh-label text-white/60 mb-3">Select Data to Transfer</h3>
                <div className="grid grid-cols-2 gap-2">
                  <CheckboxItem label="Status" checked={selectedData.status} onChange={() => toggleSelection('status')} />
                  <CheckboxItem label="Platforms & Stores" checked={selectedData.platforms} onChange={() => toggleSelection('platforms')} />
                  <CheckboxItem label="Feel & Priority" checked={selectedData.feel} onChange={() => toggleSelection('feel')} />
                  <CheckboxItem label="Completion Date" checked={selectedData.date} onChange={() => toggleSelection('date')} />
                  <CheckboxItem label="Notes" checked={selectedData.notes} onChange={() => toggleSelection('notes')} />
                </div>
              </div>

              <div className="h-px bg-white/15" />

              <div className="flex flex-col gap-2">
                <CheckboxItem
                  label="Remove original game"
                  subtitle="Removes the source game from your library."
                  checked={removeOriginal}
                  onChange={() => setRemoveOriginal(!removeOriginal)}
                  isDanger={removeOriginal}
                />
                <CheckboxItem
                  label="Update in Collections"
                  subtitle="Replaces the original game with the new game in all collections."
                  checked={updateCollections}
                  onChange={() => setUpdateCollections(!updateCollections)}
                />
              </div>

            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/20 flex justify-between">
          {step === 2 ? (
            <button
              onClick={() => setStep(1)}
              className="lh-label px-4 py-2.5 text-white/60 hover:text-white transition-colors cursor-pointer"
            >
              ← Back
            </button>
          ) : <div />}

          <div className="flex">
            <button
              onClick={onClose}
              className="lh-label px-4 py-2.5 border border-white/20 text-white/60 hover:bg-white hover:text-black transition-colors cursor-pointer"
            >
              Cancel
            </button>
            {step === 2 && (
              <button
                onClick={handleConfirmTransfer}
                className="lh-label px-5 py-2.5 border border-l-0 border-white bg-white text-black hover:bg-white/70 transition-colors cursor-pointer"
              >
                Confirm Transfer
              </button>
            )}
          </div>
        </div>
    </Dialog>
  );
}

function CheckboxItem({ label, subtitle, checked, onChange, isDanger }) {
  return (
    <label className={`flex items-start gap-3 p-3 border transition-colors cursor-pointer select-none ${
      checked
        ? (isDanger ? 'border-[var(--destructive-border)]' : 'border-white/60')
        : 'border-white/15 hover:border-white/40'
    }`}>
      <div className="mt-0.5 flex items-center justify-center">
        <Checkbox
          checked={checked}
          onChange={onChange}
          className={isDanger && checked ? '[--wiz-accent:var(--destructive)]' : ''}
        />
      </div>
      <div className="flex flex-col min-w-0">
        <span className={`lh-label truncate ${checked ? (isDanger ? 'text-[var(--destructive)]' : 'text-white') : 'text-white/50'}`}>{label}</span>
        {subtitle && <span className="text-[11px] text-white/60 mt-1 leading-tight">{subtitle}</span>}
      </div>
    </label>
  );
}
