# Auto Priority and Find Duplicates: design brief

Shaped with `/impeccable shape` on 2026-09-12 and confirmed by the owner. Planning
only; no code has been written. Both surfaces are Operate mode inside the
established Stark Editorial Brutalism world (DESIGN.md). No new colours.

## 1. Auto set priority

**Job.** Someone with a long Backlog or Wishlist that was never prioritised, or
whose priorities have gone stale, wants the shelf ordered in one pass instead of
judging 150 games one by one.

**Outcome.** Every eligible game in the current tab gets a priority from a rule
the user can read, after seeing exactly what will change.

### Scope

- Tabs: Playing, Backlog, Wishlist, Unreleased (the four with a `priority` sort in
  `TAB_CONFIG`, `src/pages/library/Library.jsx:101-111`). The action is not shown
  on Beaten (priority hidden) or Dropped (no priority sort on that shelf).
- Entry: library toolbar, right side, beside Pick For Me
  (`Library.jsx:1523-1548`). Label: "Auto Priority".

### Methods

Both methods produce a 0-100 score and map it through the same fixed bands:

| Score | Priority |
| :--- | :--- |
| 85 and up | Next Up |
| 75 to 84 | Soon |
| 65 to 74 | Maybe |
| Under 65 | Someday |

1. **By public rating.** IGDB `total_rating` straight into the bands.
2. **By your taste.** Resemblance to **Beaten** games the user has rated
   (`feel`), over genres, themes, studio and series, reusing the `buildTaste`
   similarity model in `src/services/pickNext.js:154-181`.
   - Perfection and Go for it pull a game up; Timepass is neutral; Skip pushes down.
   - Only Beaten games feed the model. Dropped games are ignored, rating or not.
   - Blend: **60% taste, 40% public rating**. A game with no public rating uses
     taste alone.
   - Available only when at least **5 Beaten games carry a rating**. Below that
     the option is disabled and names the gap: "Rate 3 more beaten games to use
     this".

Games with no score at all (custom entries, unrated unreleased games) are left
untouched and counted as skipped.

### Replace existing priorities

- Toggle, **off by default**.
- Off: only games with no priority get one.
- On: every eligible game is rescored. Unrecognised imported values (for example
  "Eventually") count as existing and are replaced only when on.

### Interaction and layout

- `Dialog` (bottom sheet on mobile).
- Top: method choice as two radio rows (`DialGroup`), then the Replace toggle
  (`Checkbox`).
- Beneath, a live preview:
  - a four-cell count strip in the priority colours (the "State row / cell" shape,
    colours only via `src/constants/stateColors.js`);
  - "N skipped, no rating";
  - a scrolling list of changes: cover, name, score, old priority -> new.
- Fixed bands can flood Next Up on a strong backlog; the count strip is where the
  user sees that before applying.
- Primary button: "Set 42 Priorities". Reads "Nothing to change" and is disabled
  at zero.
- Apply writes once through `saveManyToLibrary` (one commit, one cloud upload),
  then a toast with Undo restores each game's own prior value, `null` included
  (same approach as `mutateGame`, `Library.jsx:978-1009`).
- No per-row unticking in the preview.

### States and ranges

- Loading while ratings and taste profiles fetch (`getGamesByIds`,
  `getGamesProfile`, both cached).
- All games already prioritised with Replace off: "Every game here already has a
  priority. Turn on Replace to rescore them."
- No rated games in the tab: "No game here has a public rating yet."
- IGDB failure: error with retry.
- 0 to about 1,000 games per tab; the list scrolls inside the dialog.

## 2. Find duplicates

**Job.** A collector who has imported from several sources or added editions
over years wants a clean library without losing notes, ratings or platforms.

**Outcome.** Every suspected group is either merged into one game or dismissed as
not duplicates, and nothing the user recorded is lost unless they chose to drop
it.

### What counts

Two sections. Same IGDB id twice cannot occur (saves merge by `String(id)`,
`src/services/db.js:1093-1100`), so matches come from:

**Same game**
- Editions: IGDB `version_parent` points at another library game (GOTY, Complete,
  Definitive).
- Bundles: a library game is contained in a library bundle (IGDB `bundles`).
- Custom twins: a custom entry whose normalised name matches an IGDB entry.
- Name-only matches, labelled "Matched by name only", because IGDB has distinct
  games sharing a name (`STATUS.md:322`).

**Related versions** (quieter treatment; owning both is often deliberate)
- Remakes and remasters (IGDB `remakes`, `remasters`).

Never flagged: DLC and expansions. Ports are not counted.

### Surface

Dedicated page `/library/duplicates`, opened from the library toolbar and
scanning the whole library.

- Header counts: "7 groups: 5 same game, 2 related versions".
- Each group places its games side by side: cover, name, year, type label
  (Edition, Bundle, Remaster; reuse the `game_type` labels in
  `TransferDataModal.jsx:8-24`), status, rating, priority, platforms, notes
  excerpt.
- One column is marked Keep; the user can move the mark.
- **Default Keep:** the entry with more recorded user data; on a tie, the
  original (the IGDB parent or earlier release).
- Group actions: "Merge" (primary) and "Not duplicates" (secondary).
- Mobile: columns stack; Keep becomes a radio per game.

### Merge

- Platforms, stores and collection memberships union automatically.
- Status, rating, priority and completion date: a value present on only one
  entry carries over; where both hold a value, the field shows both and the user
  picks.
- **Notes:** when both have notes, both are kept, joined into the kept entry.
- The column being removed is labelled "Removed after merge" in `--destructive`.
- Order: save the kept entry with merged data, move collection memberships, then
  `removeFromLibrary` the other. Reuse the transfer logic in
  `TransferDataModal.jsx:79-131`; do not write a second merge.
- **Undo:** verify first whether re-saving an entry beats its own removal
  tombstone in `syncMerge.js`. If it does, Merge takes an Undo toast restoring
  both entries. If it does not, each Merge takes a `ConfirmDialog` naming the
  removed entry instead.

### Not duplicates

Stored on both entries so it syncs through the existing per-item merge; the group
never returns. A "Show dismissed" link restores dismissed groups.

### States and ranges

- Scanning: IGDB relations fetched in batches, cached.
- None found: "No duplicates in 312 games." plus a line naming what was checked.
- Partial: IGDB unavailable, so name and custom-twin matches still show, with a
  note that editions, bundles and remakes could not be checked, and a retry.
- Finished state once every group is resolved.
- Typically 0 to 50 groups of 2; up to about 5 in a group.

## Constraints for both

- Existing visual rules only: priority colours only via `stateColors.js`, 11px
  `.lh-label`, 24px target floor and 44px on touch (`.tap`, `.tap-block`).
- Detection, scoring and merge are pure functions with node tests written first
  (CONTRIBUTING.md TDD).
- Playwright specs stub `/api/**` and `/wdqs/**`; nothing reaches live IGDB.
- No script writes to production Firestore.
- IGDB fields to add: `version_parent`, `bundles`, `remakes`, `remasters` (the
  proxy allowlist restricts endpoints, not fields; `games` is already allowed).

## Decisions made while building

- **Entry point.** Both tools open from one Tools menu (wrench) at the end of the
  library's pill row, not as buttons beside Pick For Me. Two labelled buttons
  added a toolbar row at 1280px and on phones. Measured against the toolbar
  with the menu hidden (origin/main's toolbar): the same height at 375, 1024
  and 1280 on Backlog and Beaten; Backlog at exactly 768px gains a row.
- **Phones: wrench only, accepted by the owner (2026-09-13).** The word "Tools"
  shows at xl only. Showing it on phones cost Beaten a third toolbar row at
  375px (70px to 108px), so on a phone the trigger is the wrench with the
  accessible name "Library tools", the same icon-only treatment Pick For Me has
  there.
- **Auto Priority is a bottom sheet below sm**, centred dialog above.
- **Selection is inversion throughout.** Method rows, Keep chips and conflict
  choices invert when chosen; a square radio mark read as a checkbox beside the
  Replace checkbox. Status, priority and rating choices carry their scale's
  swatch.
- **Related versions** say "Keep Both" (or "Keep All") instead of "Not
  Duplicates", keep Merge outlined, and mark the other column "Removed If
  Merged" in grey rather than destructive red.
- **Undo on merge** was confirmed possible: re-saving a removed entry stamps it
  after its tombstone (`tests/db-write-path.test.mjs`), so Merge takes an Undo
  toast and no confirmation dialog.
- **Preview panel (added 2026-09-13).** Each game column has an outlined
  Preview button (never inverted: inversion on this page means "chosen to
  keep"). The panel shows the game from IGDB: artwork, cover, a relational kind
  line ("Edition of Night Harbour"), release, studio, publisher, platforms,
  genres, IGDB rating, summary, a screenshot strip and Open Game Page. Chips at
  the top switch between the group's entries without closing it, labelled by
  the words their names do not share. From 1440px it docks as a full-height
  rail on the window's right edge and the page re-centres in the space left, so
  the groups keep their width (the owner rejected a first version that docked
  inside the centred content column and squeezed them). From sm to 1440px it
  opens as a right-hand panel over the page; below sm it is a bottom sheet at
  90% height with a drag bar. Owner's choices:
  IGDB contents, docked beside the list, bottom sheet on phones.
