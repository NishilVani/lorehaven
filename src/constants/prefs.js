/* The stops on the two recommendation dials.
 *
 * Here rather than beside the control because both the preferences dialog and
 * the profile's taste band render them, and a second copy is how "Modern" comes
 * to mean 5-15 years in one place and something else in the other. Kept out of
 * the component file so fast refresh keeps working on the control.
 *
 * Named stops rather than a continuous slider. The stored value is a float and
 * the store accepts anything in range, but a slider with no units invites
 * fiddling with a number nobody can feel the difference in. Three stops are a
 * decision; a slider is a chore.
 */

export const TASTE = [
  { value: -1, label: 'My Favourites', hint: 'More like the games you rated highly.' },
  { value: 0, label: 'Balanced', hint: 'No lean either way.' },
  { value: 1, label: 'Something New', hint: 'Deliberately unlike what you have been finishing.' },
];

export const ERA = [
  { value: 'any', label: 'Any Era', hint: 'Release date is ignored.' },
  { value: 'new', label: 'Recent', hint: 'Released in the last 5 years.' },
  { value: 'neutral', label: 'Modern', hint: 'Roughly 5 to 15 years old.' },
  { value: 'old', label: 'Classic', hint: 'Older than 15 years.' },
];
