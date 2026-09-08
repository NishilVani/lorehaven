# Every issue fixed on `fix/deep-qa-2026-09-05`

One row per commit, in the order they landed. **Problem** is what was wrong,
**Change** is what was edited, **Effect** is what a user sees or can now do that
they could not before. Every row was gated before it was committed; the gate is
named in the commit body.

Source of truth: `git log main..fix/deep-qa-2026-09-05`. Findings ids (`FIX-nn`)
refer to `qa/2026-09-05-deep/phase20.md`.

---

## 1. The swallow family — a failed index used to look like an empty one

The single largest defect in the run. `igdb.js` answered a broken, unreachable or
rate-limited index with the same value it uses for "no results": `[]`, `null` or
`0`. Fourteen routes therefore told the user their shelf was empty when nothing
had been asked or answered, and offered no way to retry.

| # | Problem | Change | Effect |
|---|---|---|---|
| 20 | 45 credential guards and 45 catch blocks in the IGDB layer returned an empty result, so a broken index rendered as an ordinary empty shelf on 14 routes. The error banner had been mounted at the app root the whole time and nothing ever reached it. | One helper dispatches the banner's own event from every guard and catch. Return values unchanged, so no caller sees a rejection. | With the index down, six routes that showed nothing now show the banner with a working Retry. |
| 21 | A 4xx or 5xx whose body was not an array passed every `Array.isArray` check as an empty result, and IGDB's real error body (an array of `{title,status,cause}`) passed both error detectors and reached pages as if it were rows. | The shared fetch wrapper announces any non-OK response; the two error detectors recognise the real error shape. | An IGDB outage or a bad query is reported as a failure instead of being drawn as content. |
| 23 | Schedule, events, event detail, franchise, collection detail and the collections feed each drew their *empty-state* copy when IGDB failed. On a 401 a community collection kept Save and Clone live, and Clone wrote a permanent empty shelf. | Nine fetchers rethrow; each page catches into `loadError` and renders one shared plate whose Try again remounts the route. | Six routes now say the index did not answer and offer a retry, instead of claiming there is nothing there. |
| 24 | The category count returned `0` on a credential miss, so every category page printed `0 GAMES` above a full grid. | The count throws; the page's existing catch sets it to null and the meta line hides it. | A count that could not be fetched is absent rather than wrong. |
| 25 | Once the fetchers threw, a failed schedule request skipped `setHasMore`, so the sentinel refetched a 500 forever: ~340 requests in six seconds, with the plate flickering. | The catch stops paging; the error is cleared only on a fresh load, not an append. | Two requests per failed load, and the failure message stays still. |
| 26 | On `/wallpapers` an IGDB error object returned silently, so the page drew "No Plates Match" and dimmed the one escape, blaming the user's filters for a rejected query. A failed reload also kept the previous plates on screen. | The non-array branch records the error; plates are cleared at the start of every load. | A failed wallpaper load reads as a failure, and stale art no longer sits under a failure toast. |
| 27 | A stale token or a rate-limit burst raised the error banner for a failure the app then repaired. | The shared wrapper replays once: on 401 it re-authenticates, on 429 it backs off a second. Only a second failure throws. | Transient failures self-heal without the user seeing anything. |
| 37 | With `?cat=` in the URL, clicking a category changed nothing: the deep-link effect depended on an array rebuilt every render, so it re-applied itself and snapped the selection back. | The effect reads the memoised map; a click drops `cat` from the URL. | The category you click on an awards ceremony stays selected. |
| 110 | The game detail page was the seventh route in this cluster and the six-route fix missed it: a credential miss, an IGDB error body and a thrown request all returned null, and the page reads null as "this entry does not exist in the index". A 401 told the user their game had been removed from IGDB, under a plate whose only control is Go Back. | The fetcher throws on all three, and the page carries a failure branch with the shared plate. | An outage on a game page says the index did not answer and offers a retry. |

---

## 2. Data the app destroyed on its own

| # | Problem | Change | Effect |
|---|---|---|---|
| 93 | Two getters healed values on read and wrote the result back without checking the transformation kept anything: an unreadable completion date was normalised to `null` and written as `null` the moment the app opened, and a franchise saved before its name arrived was stored nameless and deleted on the next read. | The date is written only when the normaliser produced a value; a platform list that lost rows is used but not written back; `saveFranchise` refuses a nameless entry and the page disables Save until the name exists. | Opening a game no longer deletes its completion date. The Save button on an unnamed franchise is visibly unavailable instead of lying. |
| 94 | The import wizard wrote the spreadsheet cell verbatim, producing exactly the unreadable values the read side used to destroy. | Both write paths normalise; a cell that is not a date is not written. | Nothing unreadable reaches storage. A real date survives the import. |
| 28 | Reaching the review step wrote every unmapped CSV platform to the profile as a permanent custom platform, before anything was confirmed, with no way to undo it. | The early write is deleted; the confirmed save already records each platform. | The Confirm Save dialog is no longer decorative: cancelling leaves the profile untouched. |
| 12 | Transfer added the target platform to each game but never removed the source, while the dialog said "migrated". | The source link is filtered out before the target is added. | Transfer moves a platform instead of silently duplicating it on every game. |
| 9 | The live-sync unsubscribe was discarded, so every sign-out left a listener running against the signed-out user's data; the refusal overwrote the sign-out's clean state. | Keep the unsubscribe and drop the listener on auth change. | Signing out no longer leaves "Live sync was refused" on screen, and listeners stop accumulating. |
| 78 | Library hydration replaced every custom entry's developer and release year with "Unknown", so a stored 2021 became an "Unknown Year" heading while the card showed nothing. | Stored values are kept; the placeholders apply only when nothing is stored. | A custom entry groups under its real year and shows its developer. |

---

## 3. Screens with no heading, no exit, or a placeholder as a title

| # | Problem | Change | Effect |
|---|---|---|---|
| 98 | The router had no catch-all, so an unknown address matched nothing: the shell painted and the main region was empty. The game and collection not-found plates were bare centred text pinned to the top above hundreds of pixels of black, and the rail lit nothing on a collection detail route. | A not-found route, last in the list, printing the address that failed; both plates use the shared framed plate; nav items can name their section's other prefixes. | A mistyped URL gets a real screen with a heading and a way back, and the rail says which section you are in. |
| 100 | A franchise page whose name never arrived kept its loading placeholder as the page title, presenting itself as a real, saveable franchise named with it. A malformed award id was reported as Wikidata being unreachable although nothing was ever requested. | Three distinct states: loading, loaded-and-empty, failed. A malformed id says it is not a QID and shows the shape of a real one. | The heading always says which of the three situations you are in. |
| 102 | While the taxonomy name was in flight the category page title was a single space, so the route had an empty `h1`. | Says Loading, or Category Unavailable when the index failed. | No blank heading. |
| 41 | An unknown explore section's only title was a styled div, so the route had no heading at all. | The same element is the `h1`. | The screen has a heading. |
| 59 | A shelf that is nothing but its empty-state message had that message in a styled div. | It is an `h2`. | Screen readers and the document outline see the message. |
| 66 | The Event Unavailable plate carried the app's only sentence-case error line. | Set in the product's label style. | One voice across every error screen. |

---

## 4. Thirteen hand-rolled empty states became one component

| # | Problem | Change | Effect |
|---|---|---|---|
| 96 | Five hand-rolled rectangles, each a thin band of centred grey type above several hundred pixels of empty page; several named a control they did not contain. The collections plate was gated on the create form being closed, so opening the form deleted the page's only instructions. | The shared plate, with an icon, a sentence saying what the screen is for, and the control inside it. The plate stays up while the form is open. | New Collection and Search IGDB are inside the plate that names them; pressing Create on an empty name no longer leaves less on screen than before. |
| 97 | Eleven more copies of the same rectangle across schedule, events, explore, awards, wallpapers, import and collections. | All render through the shared plate. No copy changed. | Every empty and failed state in the product has one shape, and its title is a real heading. |
| 99 | The search overlay answered every empty tab with one grey slab reading NO GAMES FOUND, four of them, none repeating what was searched for. The import review said "no rows match the current filter" for a header-only CSV where no filter was applied. | Each state names the term and suggests a next step; the header-only case says the file had no data rows. | An empty search tells you what it searched for. |
| 106 | The new collections plate put a New Collection button inside it while the section header already had one, so the screen carried two controls with the same accessible name. I introduced that; it is the thing the work order argues against elsewhere. | The plate's control reads Create your first collection. | Voice control and a screen reader can tell the two apart. |

---

## 5. Keyboard and focus

| # | Problem | Change | Effect |
|---|---|---|---|
| 95 | Activating a menu item that re-rendered or removed its trigger dropped focus to the document body. From there the Undo for a shelf move was 35 Tab presses away and was removed from the page after 6.4 seconds, so the undo for a real data change was not reachable by keyboard. | The restore is scheduled from the click, which survives the component being unmounted; it re-queries the trigger, and falls back to the nearest surviving container. The awards winner menu was declared inside render, so it is module-level now. The mobile drawer closes on Escape and returns focus to the hamburger. | After moving a card by keyboard, Tab continues from the grid that changed, and Undo is reachable. Escape closes the drawer on every platform. |
| 19 | Dialogs focus their initial control programmatically, which matches `:focus` but not `:focus-visible`, and every state was a `focus-visible:` variant, so Cancel received focus with no visible indicator. | `focus:` twins beside each `focus-visible:` state. | You can see which control a confirm dialog opened onto, which is the whole point of it landing on Cancel. |
| 64 | The library search input declared `focus:ring-0`, so keyboard focus showed only a border alpha change. | A 2px ring on focus-visible. | The focused search field is visible. |
| 49 | The mobile drawer scrim is a bare div with an onClick, and iOS Safari only synthesises a click on such an element when it has `cursor: pointer`. | Added it. | Tapping outside the drawer closes it on iPhone. |

---

## 6. Layout that hid or cut content

| # | Problem | Change | Effect |
|---|---|---|---|
| 101 | At 280px the header's left block could not shrink, so the account control sat outside the viewport on every route, and the document was narrower than the viewport so it could not be scrolled to. | The wordmark truncates; the right block holds its size. | The account menu is reachable at the narrowest supported width. |
| 103 | An overflowing label was a max-content flex row at rest, and `text-overflow` only applies to a block container, so any label too long for its box was cut mid-word with nothing to say so. The category platform menu ran 360px off-screen at 375. | A block with an ellipsis at rest; the two-copy flex row arrives with the hover animation. | Every clipped label in the product ends in an ellipsis instead of mid-word. |
| 15 | The same defect on the vertical card spine, where the hover marquee does not exist on touch and is off under reduced motion, leaving 73% of a long title unreachable. | The same block-at-rest treatment, plus the full title in a tooltip. | A long game title on a card ends in an ellipsis and can be read on hover. |
| 8 | Every game card rendered with no title at all on WebKit, while the node was present and in the accessibility tree, so no assertion could see it. Three nested boxes each resolved to zero width. | A definite width at every level. | Card titles are visible in Safari. |
| 91 | The menu height estimate was 8% short, so a 13-row month menu was judged to fit below its trigger, skipped the scrollable branch, and ran past the fold with overflow hidden. The 264px width was 70% of a phone screen. | Round the estimate up; clamp position and width to the viewport. | The month menu is scrollable and inside the screen; no menu is wider than the phone it is on. |
| 81 | At 375 the events row meta and its countdown badge shared one line and overflowed by 55px, so the "N yours" figure the row exists to show was truncated away. | The badge drops below the meta on phones. | The library-crossover count is readable on a phone. |
| 76 | Portrait filmstrip frames measured 32px wide beside 100px landscapes. | Each strip floors its frames at its own base. | Portrait plates are selectable. |
| 5 | The Game of the Year poster resolved to 2px at every desktop width, so the ceremony's headline award had no art. | A width instead of a shrink-to-fit auto. | The headline poster is visible on desktop. |
| 16 | The display-name editor's input was 100% of its row, pushing Save and Cancel to a second line at every width, and opening it moved the page down by up to 52px. | Constrained width, and a minimum height on the heading slot. | Editing your name does not shove the page. |
| 68 | The two-card Your Data grid stretched the shorter card to about 180px of empty border. | Align to the start. | No empty box. |
| 69 | A Discover shelf showed six cards in a grid that lands five columns at 1440, marooning one card above a full-width band of black. | Five per shelf; See All still carries the rest. | Shelves are full rows. |
| 11 | The sticky year strip covered 29 of the 34px of the category heading you had just scrolled to. | Scroll margin on the index and the detail pane. | Clicking a category shows it. |
| 104 | The profile's scrolling charts hid 35% of the plot at 414px and 60% at 280px with a zero-width scrollbar and no treatment on the cut edge, and the hidden side is where a well-liked library's dots land. | A thin scrollbar and a right-edge fade that lifts at the end. | You can tell there is more chart, and reach it. |
| 65 | A long single-word collection name could not break, so the clamp cut it with no ellipsis; an empty cover slot painted bare black, indistinguishable from a cover that failed to load. | Break words, add a tooltip, paint empty slots. | Tile titles are readable at 280px and an empty shelf looks empty rather than broken. |
| 88 | At 375 the import review's Overwrite verdict overhung its cell and painted across the card border, and the status column was hidden, so the one thing the step exists to set was invisible on the last screen before the write. | The verdict cell no longer clips; the status joins the sub-line below `sm`. | You can see what each row will do, and to which shelf, before you save. |

---

## 7. Counts, labels and copy that described something else

| # | Problem | Change | Effect |
|---|---|---|---|
| 39 | With a no-hit search the awards masthead read "42 Ceremonies" directly above "No Ceremonies Match". | The count follows the filtered list. | The count matches what is on screen. |
| 58 | The category masthead's year range was built from the chart's full domain while the count beside it was filtered, so a "25+" chip sat next to "Pre-1980 to Now". | The meta shows the selected span. | The two halves of the masthead agree. |
| 13 | An unknown category's twelve zero counts drew a full confident axis around an empty plot, with a count printed beside it. | No chart unless some bucket is positive and the page has not failed. | No histogram of nothing. |
| 83 | Load More appended the next page without de-duplicating the overlap, so the same event rendered twice two thousand pixels apart and the header counted 26 entries over 25 things. | Merge by id. | The list and its count are right. |
| 71 | An active priority or rating row read "Set" although clicking it clears the value, and its accessible name said nothing about clearing. | Active rows read Clear, and are named for it. | The label says what the click does, which voice control depends on. |
| 79 | A card with no developer and no type drew an empty grey band identical to a neighbour reading MAIN GAME, and an undated card left an empty footer slot. Both read as rendering failures. | Custom Entry and TBA. | Nothing looks broken. |
| 67 | A display-size dash rendered as a solid white bar on the profile and a display-size ellipsis as three heavy dots, both reading as loading placeholders rather than "no data". | Words instead. | You can tell the difference between loading and nothing to show. |
| 57 | The wallpapers masthead read "0 Plates, hover a plate to select it" above an empty page. | The hint appears only when plates exist. | No instruction for something that is not there. |
| 43 | A no-hit search on the Subscriptions tab removed the suggestions section entirely, leaving 180px of black and nothing to say the search found nothing. | The no-results line renders on every tab. | An empty search says so. |
| 45 | Creating a collection with an empty or whitespace-only name, or saving a rename to one, was a silent no-op. | Both paths say what is missing. | Pressing Create tells you why nothing happened. |
| 33 | The review filter read "1 Conflicts" and the manifest "1 OVERWRITE EXISTING ENTRIES". | Singular and plural follow the count; the manifest says what it will overwrite. | The confirm screen reads as written English. |

---

## 8. Import wizard

| # | Problem | Change | Effect |
|---|---|---|---|
| 90 | Continue was armed as soon as any column was mapped to Game Name, so the Rating column could be chosen and the next step searched IGDB for "10/10". | The column's first cell is checked; a bare number or fraction blocks Continue with the reason printed. | You cannot start an import that will search for scores. |
| 89 | A broken CSV put five lines of raw text in a sample cell styled exactly like a legitimate sample, and nothing else on screen differed from a clean import. | A sample containing a line break says the column did not parse. | A malformed file is visible before the import runs. |
| 30 | The column guesser never mapped a "Rating (Feel)" header, so the rating was parked under Ignored Columns on every import. | One more guess, after notes so a review score is not mistaken for notes. | Seven of seven columns map. |
| 29 | A name of three spaces passed the empty check and produced a review row whose title read the bare string "CSV:" and a saved entry no named row had produced. The skipped counter also accumulated across fetches. | Trim at the source; reset the counter with the rows. | No phantom entry, and the skipped count is right. |
| 32 | Under the Conflicts filter a row renumbered itself to its position in the view rather than the CSV row it came from. | Index against the full list. | The row number points at the spreadsheet line. |
| 31 | The wizard used a native alert for a rejected file. | A toast, saying what to do next. | One feedback channel. |
| 35 | The unresolved-count badge on an inactive mapping tab measured 2.48:1. | Drop the extra opacity, as the shell already does. | The counts are legible. |
| 7 | Every disabled step chip rendered at full opacity in the same colour as an enabled one, so mid-fetch a user hunting for an exit saw four clickable-looking chips that were not. | Dim only chips that are neither jumpable nor active. | You can see which steps you can go to. |

---

## 9. Time, and the schedule

| # | Problem | Change | Effect |
|---|---|---|---|
| 82 | The month window was built from local midnight while IGDB dates are UTC instants, so in Los Angeles the January filter opened eight hours late, dropped games dated at UTC midnight on the 1st out of their own month, and labelled the survivors December 31. | Both the query bounds and the day labels use UTC, as do the year readouts across the app. | A month filter shows that month, in every timezone. |
| 50 | A 2500px root margin kept the infinite-scroll sentinel intersecting before the user had scrolled at all, so the schedule fetched every page on load. | 600px. | One page loads until you scroll. |
| 36 | Picking a ceremony year replaced the history entry, so Back left the ceremony entirely. | Push instead. | Back goes back one year, not out. |
| 38 | `?year=abc` produced `NaN`, which `??` does not replace, and `?year=1800` a year the ceremony lacks; both rendered a blank field under a strip with no current year. | Validate against the data and fall back to the newest. | A bad year in a shared link still shows a ceremony. |

---

## 10. Contrast, motion and finish

| # | Problem | Change | Effect |
|---|---|---|---|
| 6 | With the confirm phrase empty, Cancel and Clear Library measured the same contrast, colour, border and box: only `aria-disabled` differed, and that paints nothing. | Dim the locked button, using the idiom the wallpapers screen already uses. | You can see which button is armed before typing the phrase. |
| 86 | The dialog panel was black on a black page behind a 75% black scrim, which cannot darken black, so a 1px border was the entire depth cue and the page stayed plainly legible behind a destructive confirm. | A near-black panel with a deep shadow. | A confirm dialog reads as being in front. |
| 18 | The platforms screen carried its own confirm dialog: sentence-case title, a header X the house dialog has no equivalent for, and Delete marked by label colour alone with the same grey border as Cancel. | The house ConfirmDialog, with its danger variant and focus on Cancel. | Delete and Cancel are different shapes, not just different coloured words. |
| 60 | The category Clear control sat among five bordered pills with no border and no fill, so it read as a caption rather than the control that undoes them. | The same resting border as the pills, without a fill. | Clear looks like a control. |
| 72 | The only hover feedback on a state row was the label brightening, while a destructive button 200px below fills red. | A 5% white ground on hover. | Rows respond to the pointer. |
| 92 | The only sign that a library group heading collapses was a 6px plus or minus glyph at low alpha. | A 16px chevron at the heading's own alpha, rotating on collapse. | You can tell the heading is a control. |
| 73 | The Picking Next beat on Discover ran 1.4 seconds, 2.8 times the project's own 500ms ceiling. | One 300ms constant shared by the timer and the bar. | The pick is quick. |
| 75 | 74 elements animated at Tailwind's 150ms default, the one duration not on the project's motion scale. | The theme default is 200ms; three one-offs move to their nearest step. | Motion is consistent. |
| 74 | The label style sets its line height equal to its font size, so an 11px line box could not hold a 15px glyph and the wallpaper caption lost 2px top and bottom. | A companion class that sets a real line height, used by the captions and the toast. | Descenders are not shaved. |
| 80 | The same defect on platform pills: every name lost its descenders, so "Jugg" read as "Juaa". | A tight line height on the name. | Platform names read correctly. |
| 61 | The toast was the only sentence-case string in an uppercase product. | The label style. | One voice. |
| 14 | The toast was top-anchored and parked itself on the header's action buttons at desktop, and covered the back link and half the page title at 375. Three phases had specified three different top offsets, one of them an undefined custom property. | One anchor, bottom-right. | The toast never covers a control. |
| 62 | The wallpaper select toggle was invisible until hover, so on a phone it had no resting affordance at all. | Visible on coarse pointers. | You can select a plate by touch. |
| 85 | The floating selection bar stayed at full opacity underneath the register's own footer, so two overlapping bars offered the same download. | The bar yields while the register is open. | One download control. |
| 40 | At 375 the ceremony year strip showed five of twelve years with nothing to say it scrolls, and the back link was an 11px-tall line box. | A fade on the cut edge and a 24px hit area. | You can tell the strip scrolls, and hit the back link. |
| 54 | A misplaced brace left the `h1` rule outside its layer, so the heading font never applied to `h1` elements. | Moved the brace. | Page titles use the heading face. |

---

## 11. Routing, navigation and shell

| # | Problem | Change | Effect |
|---|---|---|---|
| 46, 48 | `/library/bogus-shelf` served the Backlog grid while the URL kept the bad value, so a mistyped or stale link looked like a real shelf. The first attempt did not hold, because the URL-sync effect wrote the bad path straight back. | Redirect, and hold the sync while it happens. | A bad shelf URL lands on Backlog. |
| 84 | The library rebuilt its URL from scratch on every sync, deleting the shell's `search=true`, so the search overlay could not be deep-linked and did not survive a reload. | Rewrite only the four params the shelf owns. | A shared search link works. |
| 44 | Manage Platforms had no back control, where the collection and franchise pages both have one; at 375 the sidebar is behind the hamburger, so the browser gesture was the only way out. | A Your Data back control. | There is a way back. |
| 42 | A stores search rendered rows with duplicate React keys, because two results can share an id. | Key by the platform key the rest of the page uses. | Rows cannot reorder or disappear. |
| 47 | The logo component strips a trailing "Store" from every name, so a user-typed "X Store" and "X" became two controls announced identically. | Strip only official entries. | A custom storefront keeps the name you typed. |
| 51 | An email/password account has no photo, so all three avatar sites fell back to an external avatar service, which rendered a broken-image glyph offline and in the desktop shell. | The first letter of the name or email. | No broken image, and no third-party request. |
| 10 | The profile subscribed to the sync store without reading it first, so the four events in the first 418ms were lost and the only sync line in the app said "Connecting" for the whole session. | Read on subscribe. | The line reaches "Synced just now". |
| 17 | Saving the display name with Enter saved it and immediately re-opened the field. | Prevent the default on Enter and Escape. | Enter saves. |
| 56 | The desktop shell opened at 800x600, below the width the rail and shelf strip are designed for, so a fresh install launched in the phone layout. | 1280x800, minimum unchanged. | A new install opens in the desktop layout. |
| 55 | The Tauri API package was a dev dependency although the app imports it at runtime, so a production install could not build. | Moved to dependencies. | `npm ci --omit=dev` builds. |
| 52 | A layout Sidebar component was imported nowhere. | Deleted. | Less to maintain. |
| 70 | An unused handler in Feedback, and a component declared inside the page's render, which is a new component type every render and remounts every card. | Deleted; the grid is module-level. | Feedback cards keep their state. |

---

## 12. The test harness itself

These do not change the product. They are here because four of them were the
reason earlier results could not be trusted.

| # | Problem | Change | Effect |
|---|---|---|---|
| 77 | Five copies of the console-noise filter had drifted and matched only Chromium's spelling of a blocked request, so Firefox and WebKit reported product errors that were the filter: nine of fifteen cross-browser failures. Phase 2 was also never isolated from production Firestore. | One filter in the fixtures with all three spellings; the offline helper aborts Firestore; the sharded runner moves to `scripts/` with npm scripts. | Cross-browser results mean something. |
| 4, 22 | The seeded library mapped id 472 to Half-Life 2; live, that id is Skyrim, and three of four cover ids belonged to other games, so every case that walked from a seeded card into a live page was testing a different game than its assertion named. | Names and covers match the ids. | Assertions test what they say. |
| 1, 2, 3 | The render gates opened nothing on Windows (the drive letter became the URL host), all seven Python checks failed without running, and every skip path exited 0, so a skipped gate counted as a pass. | `pathToFileURL`, a `python` fallback, and exit 2 for a skip. | The quality gates run, and a gate that did not run cannot report a pass. |
| 63 | The live-region gate accepted only one word, so `/browse` announcing "23 genres" was reported as announcing nothing. | Accept the taxonomy's own names. | The gate measures the product, not its own vocabulary. |
| 87 | `page.mouse.wheel` throws on Mobile Safari, so infinite scroll had never been exercised on iOS at all. | Scroll with `scrollBy`. | Three paging cases now run on iOS. |
| 53 | ESLint reported 545 problems, most of them from vendored skill folders, generated Android sources and gitignored probes, so real findings drowned. | Ignore those trees; give the config and scripts node globals. | The report is about the product. |
| 34 | A commit claimed six spec sites followed new copy when its own guard had refused and only one was updated. | All six updated. | The claim is now true. |
| 112 | Three cases decided desktop or phone from the viewport width, but WebKit lays out 1268px inside a 1280px window because of its scrollbar, so the desktop breakpoint was off there and every desktop assertion in the suite had been measured against a scrollbar real Chrome does have. | Ask `window.matchMedia`. | The breakpoint the test checks is the one the page is using. |

---

## 14. The credential the clients carried

| # | Problem | Change | Effect |
|---|---|---|---|
| 115 | Three files were committed and then added to `.gitignore`, which does nothing to a file git already tracks: the signing keystore twice, and a config file holding the same IGDB credential as the world-readable Firestore document. | Untracked, kept on disk. | The leak stops growing. It is still in history, which is free to purge while there is no remote. |
| 116 | Every client read the IGDB id and secret from Firestore, exchanged them with Twitch, and called IGDB itself. The secret was in that document, in git history, and in every shipped binary. A browser cannot keep a secret, so no rule could fix it. | A proxy holds the credential and the token and forwards requests. Cloudflare Workers, free plan, no billing account. | The secret exists in one place nobody can read it from. |
| 117 | The same proxy is what makes a website possible at all: IGDB sends no CORS headers and Wikidata refuses browser origins, so a static host could not have called either. The dev proxy had hidden that. | Both go through the proxy, in development too. | The site can be hosted anywhere static. |

---

## 13. Aligning the suite with the fixes

The run deliberately wrote roughly a hundred cases that assert the defect, so that
fixing one turns the suite red. Forty-nine did, and each was rewritten to assert
the fixed behaviour. No case was deleted, and none was weakened to pass.

| # | Group | What the cases had pinned |
|---|---|---|
| 111 | The swallowed failures | Eight cases asserting that a broken index reads as an empty result, with no retry, and that Save and Clone stay live on a failed community collection. |
| 105 | Headings | Six cases asserting headless error screens and a placeholder as a page title. |
| 106 | Collections | Eight cases: the old plate copy, the silent rename, and five that could not run at all while two controls shared one name. |
| 107 | Platforms | Five cases: no no-results state, duplicate React keys, a confirm focusing its close control, Transfer copying rather than moving, and the toast covering its own button. |
| 108 | Library and state rows | Eight cases: the unknown-shelf URL, the destroyed custom year, the year click with no history entry, Enter re-opening the name editor, and two that drove a state row by a name it no longer has once active. |
| 109 | Card footer and shared plate | Two cases following an undated card now reading TBA, and the import plate now being the shared component. |

`tests/phase7-mobile.spec.ts` fails under a desktop project by design: it is
restricted by the CLI invocation, never by a `test.skip`, and its own header says
so. Run it with `--project="Mobile Chrome"` or `--project="Mobile Safari"`.

---

## Where the suite stands

Measured on this branch, not asserted:

| Run | Result |
|---|---|
| `--project=chromium` (whole suite) | 455 passed, 2 skipped, 11 failed |
| `tests/phase7-mobile.spec.ts --project="Mobile Chrome"` | 47 passed |

The eleven failures are every case in `tests/phase7-mobile.spec.ts`, which is
restricted to the mobile projects by the CLI invocation and fails under a desktop
project by design; its own header says so, and it passes in its own project. That
is the state the branch started in, not something these changes caused.

---

## Still open

These were found and specified but not fixed, because each needs a decision that
is not mine to make. They are described in full in `qa/2026-09-05-deep/phase20.md`.

**Security. Two of four are now closed; the two that remain are yours.**

Closed, deployed and verified against the live project: the three collections that
allowed read and write to anyone are gone from the rules and now return 403 to an
anonymous client, and the `config` wildcard is narrowed to the single document the
app reads, so `config/some-other-doc` returns 403 where it used to be readable.
The shared awards cache keeps its open read and write, because gating it on auth
would leave the cache cold for the signed-out visitors it exists for and the
payload is public Wikidata content, but writes are now constrained to the document
ids the app actually uses, so nobody can create unbounded documents under names
nothing will ever read.

**Still open, and neither is a rules change.**

*The IGDB client secret.* Closed. The client no longer holds a credential of any
kind: `functions/proxy.js` does the Twitch exchange, holds the token and forwards
requests, and the app asks it for game data. The boot read of the credential
document, the token exchange, 43 guards and 46 header pairs are gone.

It is deployed, as the Cloudflare Worker `lorehaven-proxy` on
`lorehaven-proxy.nishilvani.workers.dev`, whose free plan needs no billing
account. The credential was rotated in the Twitch console first, so the pair that
was world-readable through Firestore and is in this repository's history is dead:
Twitch answers it with 403.

Verified against the deployed Worker, not against the editor. `POST /api/games`
returns real IGDB data with no credential from the caller, `POST /api/users`
returns 404 because the allowlist refuses an endpoint the app never calls, and
`POST /wdqs/sparql` returns Wikidata under the user agent its policy asks for.
Then the case a static host presents and the dev server used to hide: the real
production build, served with nothing proxying in front of it, renders 33
catalogue cards over 3 requests to the Worker, 0 failed, 0 same-origin `/api` or
`/wdqs`, 0 direct calls to Twitch, IGDB or Wikidata, 0 credential-shaped storage
keys, 0 console errors. `qa/2026-09-05-deep/worker-e2e.mjs` is the check.

Development goes to the same Worker through `.env.development`, so no machine
here holds the credential either, and `serve.js` no longer reads
`datbase_config.json`. That file and `config/igdb` are now unreferenced and can
be deleted outright.

Cloud Functions was reconsidered and stays rejected: a Hosting rewrite cannot
proxy an external URL, so an endpoint there means Cloud Functions or Cloud Run,
both of which need the Blaze plan and a billing account. Oracle Cloud was
reconsidered too, and rejected because it reclaims Always Free compute whose
95th-percentile CPU stays under 20% over 7 days, which is exactly what a
stateless forwarder looks like.

*The signing key is in git history.* `release.keystore` and a database config file
are tracked, so untracking them does not purge them; the key needs rotating and
the history needs rewriting or the repository treating as burned.

**Product decisions.** Eighteen items, including whether the import wizard's
conflict-resolution control means anything (four handlers are unreachable),
whether "Transfer games" copies or moves, whether a game detail page should be
able to add to a collection on a phone at all (it cannot today), whether the
Android release build has the same LAN dev-server dependency the debug build
does, and whether 127 controls under 32px should be enlarged.

**One follow-up from this run.** The screen-reader summary on a failed category
load still reads "0 of 0 games" although the visible count is now hidden.
