// Moving a game's place in collections to another library entry.
//
// Transfer Data did this inline, and Find Duplicates' merge needs the same step
// with a way back. One implementation, so a transfer and a merge cannot keep a
// game's collections differently.

import { getCollectionsWithGame, addGameToCollection, removeGameFromCollection } from './db.js';

/** Put `toId` wherever `fromId` was. Returns what moved, for restoreCollections. */
export const moveCollections = (fromId, toId) => {
  const moved = [];
  for (const collectionId of getCollectionsWithGame(fromId)) {
    /* Remembered per collection: undo must take out only the entries this move
       added, never a game that was already in the collection on its own. */
    const hadTarget = getCollectionsWithGame(toId).includes(collectionId);
    removeGameFromCollection(collectionId, fromId);
    addGameToCollection(collectionId, toId);
    moved.push({ collectionId, fromId, toId, hadTarget });
  }
  return moved;
};

export const restoreCollections = (moved) => {
  for (const m of moved || []) {
    addGameToCollection(m.collectionId, m.fromId);
    if (!m.hadTarget) removeGameFromCollection(m.collectionId, m.toId);
  }
};
