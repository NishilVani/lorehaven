/* The bits of an import review that are not components: the statuses a person
   may choose, IGDB's game types in words, and number formatting.

   Their own file because the review is a component module, and a module that
   exports both components and constants loses fast refresh. */

/* Unreleased is left out: the library moves games onto and off that shelf from
   IGDB's release dates, so choosing it by hand would not hold. */
export const STATUSES = ['Playing', 'Backlog', 'Wishlist', 'Beaten', 'Dropped'];

export const TYPE_LABEL = { 1: 'DLC', 2: 'Expansion', 3: 'Bundle', 4: 'Standalone Expansion', 8: 'Remake', 9: 'Remaster', 10: 'Expanded', 11: 'Port' };

export const nf = new Intl.NumberFormat('en-GB');
export const plural = (n, one, many) => `${nf.format(n)} ${n === 1 ? one : many}`;
