import PageHeader from '../../components/ui/PageHeader';
import EmptyPlate from '../../components/ui/EmptyPlate';
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Search, X, Laptop, Store, CreditCard, Link2, Link2Off } from 'lucide-react';
import Heading from '../../components/ui/Heading';
import { toast } from '../../components/ui/toastBus';
import { PlatformLogo } from '../../components/platforms/PlatformLogo';
import PlatformPill from '../../components/platforms/PlatformPill';
import {
  getUserOwnedPlatforms,
  setUserOwnedPlatforms,
  getUserCustomPlatforms,
  addUserCustomPlatform,
  removeUserCustomPlatform,
  getLibrary,
  saveLibrary
} from '../../services/db';
import { searchPlatforms, searchExternalGameSources, getGamesByIds } from '../../services/igdb';
import { POPULAR_HARDWARE, POPULAR_STORES, POPULAR_SUBSCRIPTIONS } from '../../constants/platformConstants';
import Dialog from '../../components/ui/Dialog';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import useAnnounce from '../../components/ui/useAnnounce';



const TABS = [
  { id: 'hardware', label: 'Hardware', icon: Laptop },
  { id: 'stores', label: 'Stores', icon: Store },
  { id: 'subscriptions', label: 'Subscriptions', icon: CreditCard }
];

const getPlatformKey = (platform) => {
  if (!platform) return '';
  if (platform.id !== undefined && platform.id !== null && platform.id !== '') return `id:${platform.id}`;
  return `name:${String(platform.name || '').trim().toLowerCase()}`;
};

export default function ManagePlatforms() {
  const navigate = useNavigate();

  // Active tab state
  const [activeTab, setActiveTab] = useState('hardware');

  // Local state synced with db.js
  const [ownedPlatforms, setOwnedPlatforms] = useState([]);
  const [customPlatforms, setCustomPlatforms] = useState([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);



  // Link/Transfer utility state
  const [transferModal, setTransferModal] = useState({ isOpen: false, sourcePlatform: null, step: 'select' });
  const [, setTransferTargetId] = useState('');
  const [selectedTarget, setSelectedTarget] = useState(null);
  const [targetSearchQuery, setTargetSearchQuery] = useState('');
  const [targetSearchResults, setTargetSearchResults] = useState({
    igdbPlatforms: [],
    customPlatforms: [],
    igdbStores: [],
    customStores: [],
    hardcodedSubscriptions: [],
    customSubscriptions: []
  });
  const [searchingTarget, setSearchingTarget] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // { affectedGames: [{id, name}], targetPlatform, updatedCount }
  const [transferData, setTransferData] = useState(null);

  const [actionConfirmModal, setActionConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
    variant: 'danger',
    onConfirm: null
  });

  const closeTransferModal = () => {
    setTransferModal({ isOpen: false, sourcePlatform: null, step: 'select' });
    setTransferTargetId('');
    setSelectedTarget(null);
    setTargetSearchQuery('');
    setTransferData(null);
    setLoadingPreview(false);
  };

  const searchInputRef = useRef(null);
  const searchTimeoutRef = useRef(null);
  const targetSearchTimeoutRef = useRef(null);

  // Load platforms on mount
  useEffect(() => {
    setOwnedPlatforms(getUserOwnedPlatforms());
    setCustomPlatforms(getUserCustomPlatforms());
  }, []);

  // Debounced search for targets in transfer modal
  useEffect(() => {
    const q = targetSearchQuery.trim().toLowerCase();
    const sourcePlatform = transferModal.sourcePlatform;
    if (!sourcePlatform) return;
    const sourceKey = getPlatformKey(sourcePlatform);

    // 1. Filter local custom categories
    const customPlats = customPlatforms
      .filter(p => p.category === 'hardware' || !p.category)
      .filter(p => getPlatformKey(p) !== sourceKey)
      .filter(p => !q || p.name.toLowerCase().includes(q));

    // 2. Filter local stores (official vs custom)
    const storeMap = new Map();
    POPULAR_STORES.forEach(p => storeMap.set(p.name.toLowerCase(), p));
    
    const trueCustomStores = [];
    customPlatforms
      .filter(p => p.category === 'store')
      .forEach(p => {
        if (p.linkedIgdbId || POPULAR_STORES.some(ps => ps.name === p.name)) {
          storeMap.set(p.name.toLowerCase(), p);
        } else {
          trueCustomStores.push(p);
        }
      });
      
    const officialStoresList = Array.from(storeMap.values())
      .filter(p => getPlatformKey(p) !== sourceKey)
      .filter(p => !q || p.name.toLowerCase().includes(q));
      
    const customStoresList = trueCustomStores
      .filter(p => getPlatformKey(p) !== sourceKey)
      .filter(p => !q || p.name.toLowerCase().includes(q));

    // 3. Filter local subscriptions (official vs custom)
    const subMap = new Map();
    POPULAR_SUBSCRIPTIONS.forEach(p => subMap.set(p.name.toLowerCase(), p));
    
    const trueCustomSubs = [];
    customPlatforms
      .filter(p => p.category === 'subscription')
      .forEach(p => {
        if (p.linkedIgdbId || POPULAR_SUBSCRIPTIONS.some(ps => ps.name === p.name)) {
          subMap.set(p.name.toLowerCase(), p);
        } else {
          trueCustomSubs.push(p);
        }
      });
      
    const officialSubsList = Array.from(subMap.values())
      .filter(p => getPlatformKey(p) !== sourceKey)
      .filter(p => !q || p.name.toLowerCase().includes(q));
      
    const customSubsList = trueCustomSubs
      .filter(p => getPlatformKey(p) !== sourceKey)
      .filter(p => !q || p.name.toLowerCase().includes(q));

    // 4. Filter local owned platforms & popular hardware
    const localHwMap = new Map();
    ownedPlatforms.forEach(p => localHwMap.set(getPlatformKey(p), p));
    POPULAR_HARDWARE.forEach(p => localHwMap.set(getPlatformKey(p), p));
    const localHwList = Array.from(localHwMap.values())
      .filter(p => getPlatformKey(p) !== sourceKey)
      .filter(p => !q || p.name.toLowerCase().includes(q) || (p.abbreviation && p.abbreviation.toLowerCase().includes(q)));

    // Set initial local results
    setTargetSearchResults({
      igdbPlatforms: localHwList,
      customPlatforms: customPlats,
      igdbStores: officialStoresList,
      customStores: customStoresList,
      hardcodedSubscriptions: officialSubsList,
      customSubscriptions: customSubsList
    });

    if (!q) {
      setSearchingTarget(false);
      return;
    }

    if (targetSearchTimeoutRef.current) {
      clearTimeout(targetSearchTimeoutRef.current);
    }

    setSearchingTarget(true);
    targetSearchTimeoutRef.current = setTimeout(async () => {
      try {
        const [apiPlatforms, apiStores] = await Promise.all([
          searchPlatforms(targetSearchQuery),
          searchExternalGameSources(targetSearchQuery)
        ]);

        // Normalize searched platforms
        const remotePlats = apiPlatforms
          .map(p => ({
            id: p.id,
            name: p.name,
            abbreviation: p.abbreviation,
            platform_logo_image_id: p.platform_logo_image_id || p.platform_logo?.image_id
          }))
          .filter(p => getPlatformKey(p) !== sourceKey)
          .filter(p => !localHwList.some(lh => getPlatformKey(lh) === getPlatformKey(p)));

        // Normalize searched storefronts (stores)
        const remoteStores = apiStores
          .map(s => ({
            id: s.id,
            name: s.name,
            category: 'store'
          }))
          .filter(s => getPlatformKey(s) !== sourceKey)
          .filter(s => !officialStoresList.some(ls => getPlatformKey(ls) === getPlatformKey(s)));

        setTargetSearchResults(prev => ({
          ...prev,
          igdbPlatforms: [...localHwList, ...remotePlats],
          igdbStores: [...officialStoresList, ...remoteStores]
        }));
      } catch (err) {
        console.error('Failed to search target sources:', err);
      } finally {
        setSearchingTarget(false);
      }
    }, 300);

    return () => {
      if (targetSearchTimeoutRef.current) clearTimeout(targetSearchTimeoutRef.current);
    };
  }, [targetSearchQuery, transferModal.sourcePlatform, customPlatforms, ownedPlatforms]);

  // Handle searching IGDB platforms/stores
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    setSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const q = searchQuery.toLowerCase();
        
        if (activeTab === 'hardware') {
          const localHw = POPULAR_HARDWARE.filter(p => p.name.toLowerCase().includes(q) || (p.abbreviation && p.abbreviation.toLowerCase().includes(q)));
          const results = await searchPlatforms(searchQuery);
          const merged = [...localHw];
          results.forEach(r => {
            if (!merged.some(m => m.id === r.id || m.name.toLowerCase() === r.name.toLowerCase())) {
              merged.push(r);
            }
          });
          setSearchResults(merged);
        } else if (activeTab === 'stores') {
          const localStores = POPULAR_STORES.filter(p => p.name.toLowerCase().includes(q));
          const results = await searchExternalGameSources(searchQuery);
          const formattedResults = results.map(s => ({ id: s.id, name: s.name, category: 'store' }));
          const merged = [...localStores];
          formattedResults.forEach(r => {
            if (!merged.some(m => m.name.toLowerCase() === r.name.toLowerCase())) {
              merged.push(r);
            }
          });
          setSearchResults(merged);
        } else if (activeTab === 'subscriptions') {
          const localSubs = POPULAR_SUBSCRIPTIONS.filter(p => p.name.toLowerCase().includes(q));
          setSearchResults(localSubs);
        }
      } catch (err) {
        console.error('Failed to search platforms:', err);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery, activeTab]);

  // Toggle popular hardware platforms
  const handleTogglePopular = (plat) => {
    const isOwned = ownedPlatforms.some(p => p.id === plat.id);
    if (isOwned) {
      setActionConfirmModal({
        isOpen: true,
        title: 'Remove Platform',
        message: `Are you sure you want to remove "${plat.abbreviation || plat.name}" from your owned hardware?`,
        confirmText: 'Remove',
        variant: 'danger',
        onConfirm: () => {
          const updated = ownedPlatforms.filter(p => p.id !== plat.id);
          setOwnedPlatforms(updated);
          setUserOwnedPlatforms(updated);
          toast(`Removed ${plat.abbreviation || plat.name} from owned hardware`);
          setActionConfirmModal(prev => ({ ...prev, isOpen: false }));
        }
      });
    } else {
      const updated = [...ownedPlatforms, {
        id: plat.id,
        name: plat.name,
        abbreviation: plat.abbreviation,
        platform_logo_image_id: plat.platform_logo_image_id
      }];
      toast(`Added ${plat.abbreviation || plat.name} to owned hardware`);
      setOwnedPlatforms(updated);
      setUserOwnedPlatforms(updated);
    }
  };

  // Toggle popular store/subscription custom entries
  const handleTogglePopularCustom = (plat) => {
    const exists = customPlatforms.some(
      p => p.name.toLowerCase() === plat.name.toLowerCase() && p.category === plat.category
    );
    if (exists) {
      const match = customPlatforms.find(
        p => p.name.toLowerCase() === plat.name.toLowerCase() && p.category === plat.category
      );
      setActionConfirmModal({
        isOpen: true,
        title: `Remove ${plat.category === 'store' ? 'Store' : 'Subscription'}`,
        message: `Are you sure you want to remove "${plat.name}" from your configured list?`,
        confirmText: 'Remove',
        variant: 'danger',
        onConfirm: () => {
          const updated = removeUserCustomPlatform(match || plat);
          setCustomPlatforms(updated);
          toast(`Removed ${plat.name} from configured list`);
          setActionConfirmModal(prev => ({ ...prev, isOpen: false }));
        }
      });
    } else {
      const updated = addUserCustomPlatform(plat);
      setCustomPlatforms(updated);
      toast(`Added ${plat.name} to configured list`);
    }
  };

  // Add a searched item
  const handleAddSearchedItem = (plat) => {
    if (activeTab === 'hardware') {
      if (ownedPlatforms.some(p => p.id === plat.id)) {
        toast(`${plat.abbreviation || plat.name} is already in your list`);
        return;
      }
      const updated = [
        ...ownedPlatforms,
        {
          id: plat.id,
          name: plat.name,
          abbreviation: plat.abbreviation,
          platform_logo: plat.platform_logo,
          platform_logo_image_id: plat.platform_logo_image_id || plat.platform_logo?.image_id
        }
      ];
      setOwnedPlatforms(updated);
      setUserOwnedPlatforms(updated);
      toast(`Added ${plat.abbreviation || plat.name} to owned hardware`);
    } else if (activeTab === 'stores') {
      const exists = customPlatforms.some(p => p.name.toLowerCase() === plat.name.toLowerCase() && p.category === 'store');
      if (exists) {
        toast(`"${plat.name}" is already in your list`);
        return;
      }
      const updated = addUserCustomPlatform({ name: plat.name, category: 'store', linkedIgdbId: plat.id || 'igdb' });
      setCustomPlatforms(updated);
      toast(`Added ${plat.name} to your stores`);
    } else if (activeTab === 'subscriptions') {
      const exists = customPlatforms.some(p => p.name.toLowerCase() === plat.name.toLowerCase() && p.category === 'subscription');
      if (exists) {
        toast(`"${plat.name}" is already in your list`);
        return;
      }
      const updated = addUserCustomPlatform({ name: plat.name, category: 'subscription', linkedIgdbId: plat.linkedIgdbId || 'igdb' });
      setCustomPlatforms(updated);
      toast(`Added ${plat.name} to your subscriptions`);
    }
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleCreateCustom = (name) => {
    const category = activeTab === 'hardware' ? 'hardware' : activeTab === 'stores' ? 'store' : 'subscription';
    const typeStr = category === 'store' ? 'Store' : category === 'subscription' ? 'Subscription' : 'Platform';

    const currentInCategory = customPlatforms.filter(p => p.category === category || (!p.category && category === 'hardware'));
    if (currentInCategory.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      toast(`"${name}" is already in your list`);
      return;
    }

    setActionConfirmModal({
      isOpen: true,
      title: `Create Custom ${typeStr}`,
      message: `Are you sure you want to create a custom ${typeStr.toLowerCase()} named "${name}"?`,
      confirmText: 'Create',
      variant: 'primary',
      onConfirm: () => {
        const updated = addUserCustomPlatform({
          name,
          category,
          linkedIgdbId: null,
          linkedIgdbName: null
        });
        setCustomPlatforms(updated);
        toast(`Created custom entry "${name}"`);
        setActionConfirmModal(prev => ({ ...prev, isOpen: false }));
        setSearchQuery('');
        setSearchResults([]);
      }
    });
  };

  // Remove custom item
  const handleRemoveCustom = (plat) => {
    const typeStr = plat.category === 'store' ? 'Store' : plat.category === 'subscription' ? 'Subscription' : 'Platform';
    setActionConfirmModal({
      isOpen: true,
      title: `Delete Custom ${typeStr}`,
      message: `Are you sure you want to permanently delete "${plat.name}"? This will remove it from your profile.`,
      confirmText: 'Delete',
      variant: 'danger',
      onConfirm: () => {
        const updated = removeUserCustomPlatform(plat);
        setCustomPlatforms(updated);
        toast(`Removed "${plat.name}"`);
        setActionConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };



  // STEP 1 → 2: find affected games and show preview (no writes yet)
  const handlePreview = async () => {
    const { sourcePlatform } = transferModal;
    if (!sourcePlatform || !selectedTarget) return;

    setLoadingPreview(true);
    try {
      const sourceKey = getPlatformKey(sourcePlatform);
      const library = getLibrary();
      const affected = library.filter(g => Array.isArray(g.user_platforms) && g.user_platforms.some(p => getPlatformKey(p) === sourceKey));

      let mappedGames = affected.map(g => ({
        id: g.id,
        name: g.name || `Game #${g.id}`,
        isCustom: g.is_custom || String(g.id).startsWith('custom_')
      }));

      const officialIdsToFetch = mappedGames
        .filter(g => !g.isCustom)
        .map(g => g.id);

      if (officialIdsToFetch.length > 0) {
        try {
          const igdbGames = await getGamesByIds(officialIdsToFetch);
          const nameMap = new Map(igdbGames.map(ig => [ig.id.toString(), ig.name]));
          mappedGames = mappedGames.map(g => {
            const fetchedName = nameMap.get(g.id.toString());
            if (fetchedName) {
              return { ...g, name: fetchedName };
            }
            return g;
          });
        } catch (err) {
          console.error('Failed to fetch game names for preview:', err);
        }
      }

      const { group, ...cleanTarget } = selectedTarget;
      setTransferData({ affectedGames: mappedGames, targetPlatform: cleanTarget });
      setTransferModal(prev => ({ ...prev, step: 'preview' }));
    } finally {
      setLoadingPreview(false);
    }
  };

  // STEP 2 → 3: user confirmed — write to localStorage
  const handleTransferExecute = () => {
    const { sourcePlatform } = transferModal;
    const { affectedGames, targetPlatform } = transferData;

    const targetKey = getPlatformKey(targetPlatform);
    const affectedIds = new Set(affectedGames.map(g => String(g.id)));

    const library = getLibrary();
    const updatedLibrary = library.map(game => {
      if (!affectedIds.has(String(game.id))) return game;
      // Move, not copy: drop the source link before adding the target. Every
      // account that used Transfer held both platforms on every moved game.
      let newPlatforms = (game.user_platforms || []).filter(p => getPlatformKey(p) !== getPlatformKey(sourcePlatform));
      const hasTarget = newPlatforms.some(p => getPlatformKey(p) === targetKey);
      if (!hasTarget) newPlatforms.push(targetPlatform);
      return { ...game, user_platforms: newPlatforms };
    });

    saveLibrary(updatedLibrary);

    // Link target platform to the user profile if it's not already added
    if ((targetPlatform.category === 'hardware' || !targetPlatform.category) && typeof targetPlatform.id === 'number') {
      if (!ownedPlatforms.some(p => p.id === targetPlatform.id)) {
        const updated = [...ownedPlatforms, {
          id: targetPlatform.id,
          name: targetPlatform.name,
          abbreviation: targetPlatform.abbreviation,
          platform_logo: targetPlatform.platform_logo,
          platform_logo_image_id: targetPlatform.platform_logo_image_id || targetPlatform.platform_logo?.image_id
        }];
        setOwnedPlatforms(updated);
        setUserOwnedPlatforms(updated);
      }
    } else {
      const updatedCustom = addUserCustomPlatform(targetPlatform);
      setCustomPlatforms(updatedCustom);
    }

    setTransferData(prev => ({ ...prev, updatedCount: affectedGames.length }));
    setTransferModal(prev => ({ ...prev, step: 'confirm-delete' }));
  };

  // STEP 3a: delete custom source entry then close
  const handleTransferDelete = () => {
    const { sourcePlatform, isOfficial } = transferModal;
    const { affectedGames, updatedCount } = transferData;

    // 1. Remove the platform from the profile
    if (isOfficial) {
      const updated = ownedPlatforms.filter(p => p.id !== sourcePlatform.id);
      setOwnedPlatforms(updated);
      setUserOwnedPlatforms(updated);
    } else {
      const updatedCustom = removeUserCustomPlatform(sourcePlatform);
      setCustomPlatforms(updatedCustom);
    }

    // 2. Unlink the deleted sourcePlatform from all games in the library
    const sourceKey = getPlatformKey(sourcePlatform);
    const affectedIds = new Set(affectedGames.map(g => String(g.id)));
    const library = getLibrary();
    const updatedLibrary = library.map(game => {
      if (!affectedIds.has(String(game.id))) return game;
      let newPlatforms = (game.user_platforms || []).filter(p => getPlatformKey(p) !== sourceKey);
      return { ...game, user_platforms: newPlatforms };
    });
    saveLibrary(updatedLibrary);

    toast(`Transferred ${updatedCount} game${updatedCount !== 1 ? 's' : ''} and deleted "${sourcePlatform.name}"`);
    closeTransferModal();
  };

  // STEP 3b: keep source entry, just close
  const handleTransferClose = () => {
    const { updatedCount, targetPlatform } = transferData;
    toast(`Transferred ${updatedCount} game${updatedCount !== 1 ? 's' : ''} to "${targetPlatform.name}"`);
    closeTransferModal();
  };


  // Filter custom lists
  const customHardwareList = customPlatforms.filter(p => p.category === 'hardware' || !p.category);
  const customStoresList = customPlatforms.filter(p => p.category === 'store');
  const customSubscriptionsList = customPlatforms.filter(p => p.category === 'subscription');

  // The platform search swapped its results with no announcement. 4.1.3.
  useAnnounce(searching ? 'Searching platforms'
    : searchQuery.trim() ? `${searchResults.length} ${searchResults.length === 1 ? 'platform' : 'platforms'} found` : null);

  return (
    <div className="min-h-screen antialiased pt-8 pb-16 bg-black text-white">
      <div className="content-container">

        <PageHeader
          back={{ label: 'Your Data', onClick: () => navigate('/profile') }}
          className="mb-3 mt-2"
          titleClassName="text-[32px] lg:text-[56px]"
          title="Manage Platforms"
          count={`${ownedPlatforms.length + customPlatforms.length} Configured`}
        />
        <p className="text-[13px] text-white/60 font-medium mb-6">
          Configure your consoles, storefronts, and subscriptions.
        </p>

        {/* Tabs — horizontal index strip */}
        <div className="flex overflow-x-auto no-scrollbar border border-white/15 mb-8">
          {TABS.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  setSearchQuery('');
                  setSearchResults([]);
                }}
                aria-pressed={activeTab === tab.id}
                className={`lh-label px-4 py-2.5 whitespace-nowrap border-r border-white/10 transition-colors cursor-pointer ${isActive
                  ? 'bg-white text-black'
                  : 'text-white/50 hover:text-white'
                  }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab Panels */}
        <div className="flex flex-col lg:flex-row gap-8 items-start animate-in fade-in duration-200">
          
          {/* Sidebar (Search & Suggestions) */}
          <div className="w-full lg:w-80 shrink-0 p-5 rounded-none border border-white/15 bg-black  space-y-6">
            
            {/* Search Bar */}
            <div className="space-y-3 relative">
              <span className="lh-label text-white/60 block">
                {activeTab === 'hardware' ? 'Search Consoles' : activeTab === 'stores' ? 'Search Storefronts' : 'Search Subscriptions'}
              </span>
              <div className="relative">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                aria-label={activeTab === 'hardware' ? 'Search consoles' : activeTab === 'stores' ? 'Search storefronts' : 'Search subscriptions'}
                  ref={searchInputRef}
                  type="text"
                  placeholder={activeTab === 'hardware' ? "e.g. PlayStation 3..." : activeTab === 'stores' ? "e.g. Steam, GOG..." : "e.g. Xbox Game Pass..."}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-10 pl-10 pr-9 bg-black border border-white/40 focus:border-white/70 rounded-none text-xs text-white outline-none transition-colors placeholder:text-white/50"
                />
                {searchQuery && (
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setSearchResults([]);
                    }}
                    aria-label="Clear search" className="absolute right-3.5 top-1/2 -translate-y-1/2 p-2 -m-2 text-gray-400 hover:text-white cursor-pointer"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Suggestions or Search Results */}
            {!searchQuery.trim() ? (
              <div className="space-y-3">
                <span className="lh-label text-white/60 block">
                  {"Suggested Platforms"}
                </span>
                <div className="flex flex-wrap gap-2">
                  {(() => {
                    let suggestions = [];
                    if (activeTab === 'hardware') {
                      suggestions = POPULAR_HARDWARE.filter(p => !ownedPlatforms.some(o => o.id === p.id));
                    } else if (activeTab === 'stores') {
                      suggestions = POPULAR_STORES.filter(p => !customStoresList.some(o => o.name.toLowerCase() === p.name.toLowerCase()));
                    } else if (activeTab === 'subscriptions') {
                      suggestions = POPULAR_SUBSCRIPTIONS.filter(p => !customSubscriptionsList.some(o => o.name.toLowerCase() === p.name.toLowerCase()));
                    }
                    if (suggestions.length === 0) {
                      return <div className="text-xs text-gray-400 italic">No suggestions available.</div>;
                    }
                    return suggestions.map(plat => (
                      <PlatformPill 
                        key={plat.id || plat.name} 
                        platform={plat} 
                        onClick={() => activeTab === 'hardware' ? handleTogglePopular(plat) : handleTogglePopularCustom(plat)}
                      />
                    ));
                  })()}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <button
                  onClick={() => handleCreateCustom(searchQuery)}
                  className="w-full text-left p-3 rounded-none border border-dashed border-white/20 hover:border-white/40 hover:bg-black transition-all group flex items-center justify-between cursor-pointer"
                >
                  <span className="text-xs font-semibold text-gray-300 group-hover:text-white truncate">
                    Create Custom "{searchQuery}"
                  </span>
                  <Plus size={14} className="text-gray-400 group-hover:text-white shrink-0 ml-2" />
                </button>
                
                {searching ? (
                  <div className="p-4 text-center text-xs text-gray-400 font-bold">{"Searching..."}</div>
                ) : searchResults.length === 0 ? (
                  <div className="p-4 text-center text-xs text-gray-400 font-bold">
                    {activeTab === 'subscriptions' ? 'No subscriptions match that search' : activeTab === 'stores' ? 'No storefronts found on IGDB' : 'No platforms found on IGDB'}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {searchResults.map((plat) => (
                      <PlatformPill 
                        key={getPlatformKey(plat)} 
                        platform={plat} 
                        isFullWidth
                        className="!bg-black hover:!bg-black"
                        onClick={() => handleAddSearchedItem(plat)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Main Content Area (Your Platforms) */}
          <div className="flex-1 p-6 rounded-none border border-white/15 bg-black  space-y-6">
            <div>
              <Heading as="h2" className="text-[22px] lg:text-[28px] font-semibold text-white mb-1">
                {activeTab === 'hardware' ? 'Your Consoles' : activeTab === 'stores' ? 'Your Storefronts' : 'Your Subscriptions'}
              </Heading>
              <p className="text-xs text-gray-400">
                {activeTab === 'hardware' ? 'Physical consoles or systems from the IGDB catalog or custom labels.' : 
                 activeTab === 'stores' ? 'Storefronts where you purchase or own games.' : 
                 'Subscription catalogs where you rent or access games.'}
              </p>
            </div>

            <div className="space-y-3">
              {(() => {
                let official = [];
                let custom = [];
                
                if (activeTab === 'hardware') {
                  official = [...ownedPlatforms].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                  custom = [...customHardwareList].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                } else if (activeTab === 'stores') {
                  const allStores = [...customStoresList].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                  official = allStores.filter(p => p.linkedIgdbId || POPULAR_STORES.some(ps => ps.name === p.name));
                  custom = allStores.filter(p => !p.linkedIgdbId && !POPULAR_STORES.some(ps => ps.name === p.name));
                } else if (activeTab === 'subscriptions') {
                  const allSubs = [...customSubscriptionsList].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                  official = allSubs.filter(p => p.linkedIgdbId || POPULAR_SUBSCRIPTIONS.some(ps => ps.name === p.name));
                  custom = allSubs.filter(p => !p.linkedIgdbId && !POPULAR_SUBSCRIPTIONS.some(ps => ps.name === p.name));
                }

                if (official.length === 0 && custom.length === 0) {
                  return (
                    <EmptyPlate
                      icon={Plus}
                      title="No entries added yet"
                      body="Search above, or pick one of the suggestions."
                    />
                  );
                }

                return (
                  <div className="space-y-6">
                    {official.length > 0 && (
                      <div className="flex flex-wrap gap-3">
                        {official.map(plat => (
                          <PlatformPill 
                            key={`official-${plat.id || plat.name}`} 
                            platform={plat}
                            subtitle="Official"
                          >
                            <div className="ml-1.5 flex items-center gap-1 shrink-0">
                              <button
                                onClick={(e) => { e.stopPropagation(); setTransferModal({ isOpen: true, sourcePlatform: plat, step: 'select', isOfficial: true }); }}
                                className="flex items-center justify-center w-6 h-6 hover:bg-black text-gray-400 hover:text-white transition-colors cursor-pointer"
                                title="Transfer games"
                              >
                                <Link2 size={13} />
                              </button>
                              <button
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  if (activeTab === 'hardware') {
                                    setActionConfirmModal({
                                      isOpen: true,
                                      title: 'Remove Platform',
                                      message: `Are you sure you want to remove "${plat.abbreviation || plat.name}" from your owned hardware?`,
                                      confirmText: 'Remove',
                                      variant: 'danger',
                                      onConfirm: () => {
                                        const updated = ownedPlatforms.filter(p => p.id !== plat.id);
                                        setOwnedPlatforms(updated);
                                        setUserOwnedPlatforms(updated);
                                        toast(`Removed ${plat.abbreviation || plat.name}`);
                                        setActionConfirmModal(prev => ({ ...prev, isOpen: false }));
                                      }
                                    });
                                  } else {
                                    handleTogglePopularCustom(plat);
                                  }
                                }}
                                className="flex items-center justify-center w-6 h-6 text-[var(--destructive)] hover:bg-[var(--destructive-hover)] hover:text-black transition-colors cursor-pointer"
                                title="Delete"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </PlatformPill>
                        ))}
                      </div>
                    )}

                    {official.length > 0 && custom.length > 0 && (
                      <div className="border-t border-white/15 w-full"></div>
                    )}

                    {custom.length > 0 && (
                      <div className="flex flex-wrap gap-3">
                        {custom.map(plat => (
                          <PlatformPill 
                            key={`custom-${plat.name}`} 
                            platform={plat}
                            subtitle={plat.linkedIgdbId ? `Linked: ${plat.linkedIgdbName}` : 'Custom'}
                          >
                            <div className="ml-1.5 flex items-center gap-1 shrink-0">
                              <button
                                onClick={(e) => { e.stopPropagation(); setTransferModal({ isOpen: true, sourcePlatform: plat, step: 'select' }); }}
                                className="flex items-center justify-center w-6 h-6 hover:bg-black text-gray-400 hover:text-white transition-colors cursor-pointer"
                                title="Transfer games"
                              >
                                <Link2 size={13} />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleRemoveCustom(plat); }}
                                className="flex items-center justify-center w-6 h-6 text-[var(--destructive)] hover:bg-[var(--destructive-hover)] hover:text-black transition-colors cursor-pointer"
                                title="Delete"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </PlatformPill>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>


        {/* Transfer Modal */}
        {transferModal.isOpen && (
          <Dialog
            open
            onClose={closeTransferModal}
            labelledBy="transfer-modal-title"
            z={50}
            panelClassName="w-full max-w-md flex flex-col p-6"
          >
              {/* Header */}
              <div className="flex items-center justify-between mb-5">
                <Heading as="h3" id="transfer-modal-title" className="text-sm font-bold text-white tracking-tight">
                  {transferModal.step === 'select' && 'Transfer Access Data'}
                  {transferModal.step === 'preview' && 'Preview Transfer'}
                  {transferModal.step === 'confirm-delete' && 'Transfer Complete'}
                </Heading>
                <button onClick={closeTransferModal} aria-label="Close" className="w-6 h-6 rounded-none flex items-center justify-center bg-black border border-white/15 text-gray-400 hover:text-white cursor-pointer transition-colors">
                  <X size={12} />
                </button>
              </div>

              {/* ── STEP 1: Select Target ─────────────────────────────── */}
              {transferModal.step === 'select' && (
                <div className="flex flex-col gap-4 min-h-0 max-h-[80vh]">
                  <p className="text-xs text-gray-400 leading-relaxed shrink-0">
                    {"Choose a target to migrate all games linked to "}
                    <span className="text-white font-semibold">"{transferModal.sourcePlatform?.name}"</span>.
                  </p>

                  <div className="flex flex-col gap-2 flex-1 min-h-0">
                    <label className="lh-label text-white/60 block shrink-0">{"Target"}</label>

                    {!selectedTarget ? (
                      <div className="flex-1 min-h-0 flex flex-col gap-2">
                        {/* Search Input */}
                        <div className="relative shrink-0">
                          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                          <input
                aria-label="Search platforms, stores and subscriptions"
                            type="text"
                            placeholder="Search platforms, stores, subscriptions..."
                            value={targetSearchQuery}
                            onChange={(e) => setTargetSearchQuery(e.target.value)}
                            className="w-full h-10 pl-10 pr-9 bg-black border border-white/40 focus:border-white/70 rounded-none text-xs text-white outline-none transition-colors placeholder:text-white/50"
                          />
                          {targetSearchQuery && (
                            <button
                              onClick={() => setTargetSearchQuery('')}
                              aria-label="Clear search" className="absolute right-3.5 top-1/2 -translate-y-1/2 p-2 -m-2 text-gray-400 hover:text-white cursor-pointer"
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>

                        {/* Search Results List */}
                        <div className="flex-1 min-h-0 overflow-y-auto pr-3 flex flex-col gap-4 max-h-60 custom-scrollbar">
                          {(() => {
                            const q = targetSearchQuery.trim().toLowerCase();

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

                            const flatResults = [
                              ...targetSearchResults.igdbPlatforms.map(item => ({ ...item, typeLabel: 'Platform', displayCategory: 'hardware' })),
                              ...targetSearchResults.customPlatforms.map(item => ({ ...item, typeLabel: 'Custom Platform', displayCategory: 'hardware' })),
                              ...targetSearchResults.igdbStores.map(item => ({ ...item, typeLabel: 'Store', displayCategory: 'store' })),
                              ...targetSearchResults.customStores.map(item => ({ ...item, typeLabel: 'Custom Store', displayCategory: 'store' })),
                              ...targetSearchResults.hardcodedSubscriptions.map(item => ({ ...item, typeLabel: 'Subscription', displayCategory: 'subscription' })),
                              ...targetSearchResults.customSubscriptions.map(item => ({ ...item, typeLabel: 'Custom Subscription', displayCategory: 'subscription' }))
                            ];

                            flatResults.sort((a, b) => {
                              const scoreA = getMatchScore(a);
                              const scoreB = getMatchScore(b);
                              if (scoreB !== scoreA) {
                                return scoreB - scoreA;
                              }
                              return a.name.localeCompare(b.name);
                            });

                            if (flatResults.length === 0 && !searchingTarget) {
                              return (
                                <div className="text-center py-6 text-xs text-gray-400 font-semibold italic">
                                  {"No matches found"}
                                </div>
                              );
                            }

                            return (
                              <div className="flex flex-col gap-2">
                                {flatResults.map(item => {
                                  const key = getPlatformKey(item);
                                  const displayItem = { ...item, category: item.category || item.displayCategory };
                                  return (
                                    <PlatformPill
                                      key={`${key}-${item.typeLabel}`}
                                      platform={displayItem}
                                      subtitle={item.typeLabel}
                                      isFullWidth
                                      onClick={() => {
                                        setSelectedTarget(displayItem);
                                        setTransferTargetId(key);
                                      }}
                                    />
                                  );
                                })}
                              </div>
                            );
                          })()}

                          {searchingTarget && (
                            <div className="flex flex-col gap-1 mt-2">
                              {Array.from({ length: 3 }).map((_, i) => (
                                <div
                                  key={`target-skeleton-${i}`}
                                  className="flex items-center gap-2.5 p-2.5 rounded-none border border-white/15 bg-black"
                                >
                                  <div className="w-7 h-5 bg-black animate-pulse shrink-0" />
                                  <div className="min-w-0 flex-1 space-y-1.5">
                                    <div className="h-3 w-1/2 bg-black animate-pulse" />
                                    <div className="h-2.5 w-1/4 bg-black animate-pulse" />
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      /* Selected Target Preview */
                      <div className="p-4 rounded-none bg-black border border-white/15 flex items-center justify-between ">
                        <div className="flex items-center gap-3 min-w-0">
                          <PlatformLogo platform={selectedTarget} className="h-7 w-auto shrink-0 bg-black p-0.5" />
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-white truncate">{selectedTarget.name}</p>
                            <p className="text-[10px] text-gray-400 capitalize">
                              {selectedTarget.category || 'Platform'}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setSelectedTarget(null);
                            setTransferTargetId('');
                          }}
                          className="text-[10px] font-bold text-gray-400 hover:text-white px-3 py-1.5 rounded-none bg-black hover:bg-black border border-white/15 hover:border-white/20 transition-all cursor-pointer"
                        >
                          {"Change"}
                        </button>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={handlePreview}
                    disabled={!selectedTarget || loadingPreview}
                    className="w-full h-10 bg-white text-black hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white transition-colors lh-label rounded-none cursor-pointer flex items-center justify-center shrink-0"
                  >
                    {loadingPreview ? 'Loading Preview...' : 'Preview Transfer'}
                  </button>
                </div>
              )}

              {/* ── STEP 2: Preview ───────────────────────────────────── */}
              {transferModal.step === 'preview' && transferData && (
                <div className="flex flex-col gap-4">
                  <div className="p-4 rounded-none bg-black border border-white/15 flex flex-col gap-3">
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-black text-white">{transferData.affectedGames.length}</span>
                      <span className="text-xs text-gray-400">
                        {transferData.affectedGames.length === 1 ? "game will be updated" : "games will be updated"}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      <span className="text-white font-semibold">"{transferModal.sourcePlatform?.name}"</span>
                      {' '}→{' '}
                      <span className="text-white font-semibold">"{transferData.targetPlatform?.name}"</span>
                    </p>
                    {transferData.affectedGames.length > 0 && (
                      <div className="h-32 overflow-y-auto border-t border-white/15 w-full custom-scrollbar pr-1 mt-1 pt-1">
                        {transferData.affectedGames.map(g => (
                          <p key={g.id} className="text-xs text-gray-300 truncate py-1 w-full block" title={g.name}>
                            {g.name}
                          </p>
                        ))}
                      </div>
                    )}
                    {transferData.affectedGames.length === 0 && (
                      <p className="text-xs text-gray-400 italic">{"No games are currently linked to this entry."}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setTransferModal(prev => ({ ...prev, step: 'select' }))}
                      className="flex-1 h-10 bg-black border border-white/15 text-gray-300 hover:bg-black hover:text-white hover:border-white/20 transition-colors lh-label rounded-none cursor-pointer flex items-center justify-center"
                    >
                      {"Cancel"}
                    </button>
                    <button
                      onClick={handleTransferExecute}
                      className="flex-1 h-10 bg-white text-black hover:bg-gray-200 transition-colors lh-label rounded-none cursor-pointer flex items-center justify-center"
                    >
                      {"Confirm Transfer"}
                    </button>
                  </div>
                </div>
              )}

              {/* ── STEP 3: Confirm Delete ────────────────────────────── */}
              {transferModal.step === 'confirm-delete' && transferData && (
                <div className="flex flex-col gap-4">
                  <div className="p-4 rounded-none bg-black border border-white/15 flex flex-col gap-2">
                    <p className="text-sm text-white font-semibold">
                      {transferData.updatedCount === 1 ? "1 game updated" : `${transferData.updatedCount} games updated`}
                    </p>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      {"All games have been migrated to "}
                      <span className="text-white font-semibold">"{transferData.targetPlatform?.name}"</span>.
                    </p>
                    <p className="text-xs text-gray-400 mt-1 pt-2 border-t border-white/15">
                      {transferModal.isOfficial ? "Do you want to unlink and remove " : "Do you want to permanently delete "}
                      <span className="text-gray-300 font-medium">"{transferModal.sourcePlatform?.name}"</span>{' '}
                      {"from your profile?"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleTransferClose}
                      className="flex-1 h-10 bg-black border border-white/15 text-gray-300 hover:bg-black hover:text-white hover:border-white/20 transition-colors lh-label rounded-none cursor-pointer flex items-center justify-center"
                    >
                      {"Close"}
                    </button>
                    <button
                      onClick={handleTransferDelete}
                      className="flex-1 h-10 border border-white/15 text-[var(--destructive)] hover:bg-[var(--destructive-hover)] hover:text-black transition-colors lh-label rounded-none cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      {transferModal.isOfficial ? <Link2Off size={12} /> : <Trash2 size={12} />}
                      {transferModal.isOfficial ? "Unlink & Remove" : "Delete"}
                    </button>
                  </div>
                </div>
              )}
          </Dialog>
        )}

        {/* The house confirm: eyebrow, danger variant for destructive actions, no
           header X, focus lands on Cancel. The hand-rolled twin marked Delete by
           label colour alone and had drifted from ConfirmDialog in title face,
           eyebrow and border. */}
        <ConfirmDialog
          open={actionConfirmModal.isOpen}
          onClose={() => setActionConfirmModal(prev => ({ ...prev, isOpen: false }))}
          eyebrow="Platforms"
          title={actionConfirmModal.title}
          body={actionConfirmModal.message}
          confirmLabel={actionConfirmModal.confirmText}
          destructive={actionConfirmModal.variant === 'danger'}
          onConfirm={() => actionConfirmModal.onConfirm?.()}
        />
      </div>
    </div>
  );
}
