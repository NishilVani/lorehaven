/* Which lead block a game gets: see LeadBlock.jsx for what each mode answers. */
export function leadMode(libEntry, isUnreleased) {
  if (isUnreleased) return 'waiting';
  if (!libEntry) return 'decide';
  if (libEntry.status === 'Playing') return 'playing';
  if (libEntry.status === 'Beaten' || libEntry.status === 'Dropped') return 'record';
  return 'plan';
}
