import { useState, useCallback } from 'react';
import { getLibrary, saveToLibrary } from '../../services/db';
import { toast } from '../ui/toastBus';
import { statusBadge as makeStatusBadge, statusColor } from '../../constants/stateColors';
import { PRIORITY_MENU } from '../../constants/stateColors';

/**
 * useLibraryCards — library status badge + wishlist/priority menu for GameCard.
 * Used by Schedule and EventDetail, which render IGDB games that may or may
 * not already be shelved.
 *
 * Returns { libraryMap, statusBadge(game), menuOptions(game) }.
 */

export function useLibraryCards() {
  /* Seeded lazily rather than through a mount effect: getLibrary() is a
     synchronous localStorage read, so going via an effect only bought a first
     render with an empty map and a visible flash of unbadged cards. */
  const [libraryMap, setLibraryMap] = useState(() => {
    const map = {};
    getLibrary().forEach(g => { map[String(g.id)] = g; });
    return map;
  });

  const statusBadge = useCallback((game) => {
    const status = libraryMap[String(game.id)]?.status;
    if (!status) return null;
    return makeStatusBadge(status);
  }, [libraryMap]);

  const menuOptions = useCallback((game) => {
    const entry = libraryMap[String(game.id)];

    if (!entry) {
      return [{
        label: 'Add to Wishlist',
        color: statusColor('Wishlist'),
        variant: 'accent',
        onClick: () => {
          const data = {
            id: game.id,
            name: game.name,
            status: 'Wishlist',
            is_custom: false,
            /* The cover ID, not just its dimensions. This wrote width and height
               and dropped the id itself, so every game added through here landed
               with no poster on disk — the Library page never noticed because it
               re-fetches covers from IGDB on render, but anything reading the
               stored entry (Pick Next) had nothing to show. */
            cover_id: game.cover_id || game.cover?.image_id || null,
            cover_width: game.cover_width || 264,
            cover_height: game.cover_height || 374,
          };
          saveToLibrary(data);
          setLibraryMap(prev => ({ ...prev, [String(game.id)]: data }));
          toast('Added to Wishlist');
        },
      }];
    }

    const setPriority = (priority) => {
      const updated = { ...entry, priority };
      saveToLibrary(updated);
      setLibraryMap(prev => ({ ...prev, [String(game.id)]: updated }));
      toast(priority ? `Priority: ${priority}` : 'Priority cleared');
    };

    return [
      ...PRIORITY_MENU.map(p => ({
        label: p.label,
        color: p.color,
        icon: () => <div className="w-2.5 h-2.5" style={{ backgroundColor: p.color }} />,
        onClick: () => setPriority(p.label),
      })),
      { label: 'Clear Priority', dividerAbove: true, onClick: () => setPriority(null) },
    ];
  }, [libraryMap]);

  return { libraryMap, statusBadge, menuOptions };
}
