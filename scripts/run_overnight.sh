#!/usr/bin/env bash
#
# Deep QA orchestrator for LoreHaven.
#
# Ten phases, each a fresh claude session with its own context window. Phases
# talk to each other through STATUS.md and files in the run directory, never
# through conversation history. Treat it as a CI pipeline, not a conversation.
#
# Launch it yourself from a persistent shell. A chat session cannot reliably
# start a background process that outlives it:
#
#   nohup ./scripts/run_overnight.sh > /dev/null 2>&1 &
#
# Kill switch, from any shell:  touch qa/STOP
#
# Re-running is safe and is how you resume: a phase whose findings file already
# exists is skipped, so relaunching picks up exactly where it stopped.
#
# Flags:  --only N | --from N | --to N | --dry-run

set -u
cd "$(dirname "$0")/.."

FROM=1; TO=21; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --only) FROM="$2"; TO="$2"; shift 2 ;;
    --from) FROM="$2"; shift 2 ;;
    --to)   TO="$2";   shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

RUN="${RUN:-qa/$(date +%Y-%m-%d)-deep}"
mkdir -p "$RUN"
LOG="$RUN/orchestrator.log"
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

# Android tooling lives here; the emulator and sdkmanager are not on PATH.
export ANDROID_HOME="${ANDROID_HOME:-C:/Users/Nishil/AppData/Local/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

# --- Limits ------------------------------------------------------------------
# Two different limits, handled two different ways.
#
# The 5-hour rolling limit is a PAUSE, not a stop: the run sleeps and retries the
# same phase until it clears. That is the whole point of running overnight.
#
# The weekly 60 percent rule is a real stop. Claude Code does not expose weekly
# usage to a script, so the dollar figure below is only a coarse safety net, set
# far above any plausible spend: a runaway guard, not a budget. It is not a
# reading of the real weekly
# percentage and must never be reported as one.
WEEKLY_BUDGET_USD="${WEEKLY_BUDGET_USD:-2500}"
STOP_FRACTION=0.60
LIMIT_WAIT_MIN="${LIMIT_WAIT_MIN:-15}"
MAX_LIMIT_WAITS="${MAX_LIMIT_WAITS:-32}"      # 32 x 15min = 8 hours of patience
SPENT_FILE="qa/.spent_usd"
WEEK="$(date +%G-W%V)"

read_spent() {
  if [ -f "$SPENT_FILE" ]; then
    read -r w s < "$SPENT_FILE"
    if [ "$w" = "$WEEK" ]; then echo "$s"; return; fi
  fi
  echo 0                      # new week, or first run: start the tally over
}
SPENT="$(read_spent)"
CEILING="$(node -e "process.stdout.write(($WEEKLY_BUDGET_USD*$STOP_FRACTION).toFixed(2))")"

phase_cost() {              # never fatal: no cost parsed means no cost added
  node -e '
    const fs = require("fs");
    try {
      const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      process.stdout.write(String(j.total_cost_usd ?? j.cost_usd ?? 0));
    } catch { process.stdout.write("0"); }
  ' "$1" 2>/dev/null || echo 0
}

# Deliberately narrow. "quota" and "rate limit" appear in ordinary output and a
# false pause costs hours; these phrases are Claude's own.
mentions_limit() {
  grep -qiE "usage limit|5-hour limit|five-hour limit|limit reached|limit will reset|out of credit" "$1"
}

# --- Prompts -----------------------------------------------------------------
preamble() {
cat <<PREAMBLE
You are one phase of an unattended deep QA run on LoreHaven, a Tauri desktop and
Android app for tracking a game library. Nobody is awake. Read CLAUDE.md, then
STATUS.md, before anything else.

Run directory: $RUN
Write your findings to $RUN/phase$1.md and update STATUS.md before you exit.
Both are required. A phase that produces neither is retried once, then the run
moves on without it.

THE REPORT SHAPE IS FIXED. Every phase's findings file has exactly these three
sections, in this order, and the user reads them as a set:

  ## Tested
  What you actually exercised. Name the route, the control, and the interaction.
  A control you did not touch is not listed here. Be specific: "Library > sort
  dropdown > 'Release year' option, clicked, list reordered" not "sort works".

  ## Not working
  Every defect, ranked by severity. Each one carries: the route, the control,
  what you did, what you expected, what happened, and the evidence (file:line,
  screenshot path, console error, or repro steps). No defect without evidence.

  ## The fix
  For every entry under "Not working", the specific fix: the file, the line, and
  the change. Not "add validation" but the actual edit you would make. If you are
  not sure of the fix, say what you would investigate first and why.

DO NOT APPLY FIXES. This run specifies fixes, it does not make them. Write no
source edits at all except where a phase explicitly authorises test-harness
files. Never run git add, git commit, git checkout, git reset or git clean. The
working tree has unfinished human work in it: src/index.css,
src/components/games/PickNextDialog.jsx, src-tauri/Cargo.toml, CLAUDE.md and
.gitignore are modified and are not yours to touch, stage or revert.

Depth is the point of this run. The user asked for every button, screen, feature
and page tested to its roots. A route that merely renders is NOT tested. For each
control you must actually drive it and assert the state changed: click it, type
in it, open it, submit it, cancel it, and check the empty case, the long-text
case, and the error case. Clicking a button and not checking what it did is not
a test. If a control cannot be reached or driven, that is itself a finding.

Other rules:
- Redirect every gate, build and long command to a file, then tail it. Never run
  one bare. A Gradle or Cargo build prints thousands of lines.
  Example: npx playwright test > "$RUN/pw.log" 2>&1; tail -20 "$RUN/pw.log"
- Production Firestore is read-only. Do not write data. Do not run any script
  that calls setDoc, updateDoc, deleteDoc or writeBatch against production.
- Cleanup you want performed goes in $RUN/cleanup.md for a human. Never run it.
- Stop and exit if qa/STOP exists, or if you would need to write production data.

Environment notes, already verified, do not re-derive:
- Windows. python3 is a Store alias stub that fails; use python, or the
  python3 || python fallback pattern from package.json:23.
- ANDROID_HOME=$ANDROID_HOME . emulator and sdkmanager are NOT on PATH; call
  them by full path. adb is on PATH.
- node_modules/axe-core/axe.min.js exists. Playwright browsers are cached.
- A previous run already fixed playwright.config.ts and wrote tests/smoke.spec.ts.
  Build on that harness, do not start it over.
- Earlier gate sweep findings are in qa/2026-09-05/phase1.md. Read it once for
  context; do not re-run those gates or re-derive those findings.
PREAMBLE
}

phase_prompt() {
case "$1" in
1) cat <<'P1'
PHASE 1 of 10 - INVENTORY AND HARNESS. This is the map every later phase works
from, so it must be complete rather than quick.

You may write to tests/, playwright.config.ts and the run directory. Nothing else.

Enumerate, by reading the source rather than by guessing:
- Every route in src/App.jsx. There are 26 Route elements; account for all of
  them, including redirects and any :param routes and what a valid param is.
- For each route, every interactive control the page renders: buttons, links,
  inputs, selects, checkboxes, toggles, dialogs, menus, drag handles, tabs,
  context menus, keyboard shortcuts. Include controls rendered inside loops and
  inside components under src/components. grep counts at least 244 raw control
  elements in JSX, so a list of 30 means you stopped early.
- For each control: what it is supposed to do, and what state proves it worked.

Confirm the harness runs: the dev server, the projects in playwright.config.ts,
and tests/smoke.spec.ts. Fix anything broken in the harness. Note which routes
need seeded state (a signed-in user, a non-empty library) to be testable at all,
and how a later phase should get that WITHOUT writing production data.

Deliver in phase1.md, using the three fixed sections. Additionally write
$RUN/inventory.md: a table of route, control, expected behaviour, and which
later phase owns it. Later phases read inventory.md as their worklist, so an
omission here is a hole in the whole run.
P1
;;
2) cat <<'P2'
PHASE 2 of 10 - DEEP TEST: library, browse, category.

These are the core of the app. Read $RUN/inventory.md and test every control it
lists for these routes, driving each one and asserting the resulting state.

Cover at minimum: the library grid and list views, every sort option and that it
actually reorders, every filter and that it actually filters, search including
no-match and special characters, grouping, the empty library state, a very long
game title, pagination or infinite scroll, selecting a game, and every control
inside browse and category including taxonomy navigation.

Use Playwright against the dev server. Screenshot anything visually wrong and put
the path in the finding. Capture console errors; a clean-looking page with a
React key warning or an unhandled rejection is a finding.

Deliver in phase2.md using the three fixed sections.
P2
;;
3) cat <<'P3'
PHASE 3 of 10 - DEEP TEST: games, GameDetail, discover.

Read $RUN/inventory.md. Test every control for these routes.

Cover at minimum: opening a game's detail from several entry points, every tab
and section within GameDetail, every action button (status changes, ratings,
notes, platform assignment, removal confirmations), the PickNext dialog and each
of its controls, external links, image loading and the broken-image case, a game
with missing or partial metadata, and everything on discover.

Note: src/components/games/PickNextDialog.jsx has uncommitted human edits. Test
it as it currently stands, and do not edit it.

Deliver in phase3.md using the three fixed sections.
P3
;;
4) cat <<'P4'
PHASE 4 of 10 - DEEP TEST: collections, franchises, platforms.

Read $RUN/inventory.md. Test every control for these routes.

Cover at minimum: creating, renaming, reordering and deleting a collection and
every confirmation dialog involved; adding and removing games; the empty
collection state; franchise grouping and navigation; the platform manager
including custom platforms, the platform picker, and every control in
ManagePlatforms.

Destructive controls need care: verify the confirm dialog appears and that
Cancel genuinely cancels. Per CLAUDE.md a destructive action must use the danger
variant everywhere, including its confirm button, so check that too. Do not
confirm any deletion against production data.

Deliver in phase4.md using the three fixed sections.
P4
;;
5) cat <<'P5'
PHASE 5 of 10 - DEEP TEST: events, schedule, awards.

Read $RUN/inventory.md. Test every control for these routes.

Cover at minimum: the events list and detail, date handling including timezone
edges and an event with no date, the schedule view and its navigation controls,
the awards pages, and the award_cache path. Awards read from a public Firestore
collection: reading is fine, writing is not.

Deliver in phase5.md using the three fixed sections.
P5
;;
6) cat <<'P6'
PHASE 6 of 10 - DEEP TEST: profile, wallpapers, ImportWizard.

Read $RUN/inventory.md. Test every control for these routes.

Cover at minimum: every control on the profile page including its stats, the
wallpapers gallery and selection, and every step of ImportWizard - file picking,
a valid CSV, a malformed CSV, an empty file, a very large file, the mapping
step, the back and cancel paths, and what happens on an interrupted import.
ImportWizard is the highest-risk surface in the app because it writes data:
exercise it to the point just before it commits, and do not let it write to
production. If you cannot test it without writing, say so as a finding and
describe the fixture that would make it testable.

Note: the profile page is the branch's work in progress (feature/my-profile-page)
so defects here are especially wanted.

Deliver in phase6.md using the three fixed sections.
P6
;;
7) cat <<'P7'
PHASE 7 of 10 - ANDROID. Two layers, both required. The long phase; take the
time it needs.

LAYER A - browser simulation. Run the whole suite from phases 2 to 6 against
mobile viewports (Pixel 5 and iPhone 12 projects) and record what differs from
desktop. Per a known lesson on this project, desktop-only checks have reported
zero violations while mobile had violations on every page, so treat mobile as a
separate result set and never infer it from desktop. Check touch target sizes
against the 24px WCAG floor and the 44px recommendation, horizontal overflow at
280/320/414px, and the mobile tab strip.

LAYER B - a real emulator. Prefer the Tauri path: npm run tauri android dev.
That needs an AVD, and there is none: $ANDROID_HOME/system-images is empty and
emulator -list-avds returns nothing. So first install a system image with
sdkmanager under $ANDROID_HOME/cmdline-tools (prefer
"system-images;android-35;google_apis;x86_64"; both SDK licenses are already
accepted on disk), then create an AVD named lorehaven_qa with avdmanager, boot it
in the BACKGROUND with -no-window -no-audio -no-snapshot -gpu swiftshader_indirect,
and poll adb shell getprop sys.boot_completed until it returns 1, up to 10
minutes. Then run the tauri android command and let it build; it is a first-ever
Gradle plus Rust cross-compile and will be slow.

Once the app is on the emulator: navigate the main screens, capture screenshots
with adb exec-out screencap -p into the run directory, capture adb logcat -d and
search it for FATAL, AndroidRuntime and any LoreHaven stack trace, and check
launch, rotate and back-button behaviour.

Hardware acceleration may be unavailable. If the emulator will not start, capture
the exact error, record it, and finish Layer A properly rather than fighting it.
Say plainly in the first line of the file how far the real-device layer got.

Deliver in phase7.md using the three fixed sections, with Layer A and Layer B
results kept separate.
P7
;;
8) cat <<'P8'
PHASE 8 of 10 - PC: the Tauri desktop shell.

Playwright tests the web UI; it says nothing about whether the desktop app runs.
Confirm the shell builds and launches on this machine.

A previous attempt failed with a Windows file-lock error ("file is used by
another program") and cost the user a reboot. Before building, check for and stop
any running LoreHaven or app.exe process, and check nothing holds
src-tauri/target. If a build still dies on a lock, stop, record it as a finding
with the exact locked path, and do not retry in a loop or kill processes you
cannot identify.

Build with npm run tauri build -- --debug, redirected. If it succeeds, launch the
binary, let it settle, screenshot it, exercise the window controls and any native
menu, then close it. Also check what the desktop shell does differently from the
browser: file system access, the shell plugin, the http plugin, and deep links.

Deliver in phase8.md using the three fixed sections.
P8
;;
9) cat <<'P9'
PHASE 9 of 10 - FIX SPECIFICATION. Read-only. Write no source edits and make no
commits. This phase specifies fixes; a human applies them.

Read phase1.md through phase8.md and qa/2026-09-05/phase1.md. For every defect
found across the whole run, produce the fix.

Each fix carries: the defect it closes, the file and line, the exact change
(show the before and after where it is small enough), the risk of the change,
and how to verify it afterwards - the specific gate or test that proves it.
Group the fixes so a human can work through them in one sitting: the one-line
ones first, then the real changes, then the ones needing a decision.

Where two defects share a root cause, say so and give one fix, not two. That
matters more than volume: a guard in a shared function beats a guard in every
caller.

Deliver in phase9.md. It may be long; completeness beats brevity here.
P9
;;
10) cat <<'P10'
PHASE 10 of 10 - THE REPORT. Read-only. This is the document the user actually
reads, so write it for them, not for yourself.

Read every phase file in this run directory plus qa/2026-09-05/phase1.md.

Write $RUN/REPORT.md with:
- A short honest opening: what this run covered and what it did not. If a phase
  failed or the emulator never booted, that belongs in the opening, not buried.
- ## Tested - the full coverage picture as a table: route, controls exercised,
  with a column for whether that control was visually judged (phases 11 and
  15 to 19) or only DOM-asserted (phases 2 to 6),
  controls NOT exercised and why. The gaps matter as much as the coverage.
- ## Not working - every defect from every phase, merged and ranked by severity,
  deduplicated, each with its evidence and the phase it came from.
- ## The fix - the specification from phase 9, ordered so a human can work top
  to bottom.
- A closing section on what the run could not establish and what would be needed
  to establish it.

Then rewrite STATUS.md as a one-screen summary pointing at REPORT.md.

Do not pad. A defect count is not a quality score, and a phase that proved
nothing gets named as one. If coverage came out thinner than "every button on
every screen", say so plainly and say which screens are still dark.
P10
;;
11) cat <<'P11'
PHASE 11 of 21 - VISUAL SWEEP. The run has asserted the DOM for ten phases and
looked at almost nothing. This phase looks.

Screenshots that are written and never opened prove nothing. For EVERY route in
the inventory:

1. Capture it at 1440, 414, 375 and 280 wide, in BOTH light and dark, into the
   run directory's shots/ folder. Name them route-width-theme.png.
2. OPEN each one with the Read tool and describe what is actually on it. If you
   did not open it, you may not cite it.
3. Then interact and look again: open each dialog, dropdown and overlay the
   route has, and screenshot THAT. The resting state is the state least likely
   to be broken.

Report what no DOM assertion can catch: text clipped mid-word, an element
overlapping or escaping its container, misalignment, a control invisible against
its background, a broken or stretched image, a layout that collapses, a skeleton
that never clears, an empty state rendering as a bare band, a chart drawn with
bars on a page that says zero.

Two known starting points, both found by a human opening a file during this run:
- A 190-character card title clips mid-word with no ellipsis, while the DOM test
  passed because the accessible name was complete (shots/library-long-title.png).
- The category density chart draws twelve bars directly above the text "0 GAMES",
  and phase 2 described axis labels that are not visible in the render. Determine
  whether they are absent or merely invisible against the background; an
  invisible label is a contrast defect, not a missing feature
  (shots/category-failure-says-empty.png).

Deliver in phase11.md using the three fixed sections. Every visual finding cites
a screenshot you opened.
P11
;;
12) cat <<'P12'
PHASE 12 of 21 - CROSS-BROWSER. Phases 2 to 6 ran on chromium and Mobile Chrome
only, and said so. Close that.

Run the existing deep specs on firefox, webkit and Mobile Safari. Phase 1
established that webkit on Windows hangs its worker past a certain number of
browser contexts, and that a beforeEach skip still builds a context - so shard
the work and use per-project testIgnore at collection time rather than skipping
inside tests. Watch for the 300s force-kill signature; if it returns, that is a
finding, not something to work around silently.

Respect IGDB's rate limit of roughly 4 requests a second. Prefer the stubbed
cases for the wide matrix and run live cases narrowly.

You may write to tests/ and playwright.config.ts. Nothing else.

Deliver in phase12.md using the three fixed sections, with a per-engine matrix.
A defect that reproduces on one engine only is more interesting than one that
reproduces everywhere; say which is which.
P12
;;
13) cat <<'P13'
PHASE 13 of 21 - THE SIGNED-IN PATH, VIA THE EMULATOR. This is the largest hole
in the run: every mutation tested so far was tested signed out, so the Firestore
mirror of all of it is unexercised.

Do NOT solve this by signing in to production. Solve it structurally, which is
also the guardrail this project has been missing: stand up the Firebase
emulator, point the app at it, and write freely to something that is not
production.

- firebase.json has no emulators block; add one for auth and firestore. That
  file and any emulator seed data are yours to write.
- firestore.rules is NOT yours to change. Load the existing rules into the
  emulator unmodified - testing against the real rules is the point.
- Wire the app to the emulator through an env-gated connectFirestoreEmulator and
  connectAuthEmulator path. If src/services/firebase.js must change to allow
  that, describe the change in phase13.md and put it in cleanup.md rather than
  editing it, unless a test-only override is possible without touching it.

Then test what has never been tested: sign in, and drive every mutation the
earlier phases could only drive locally - shelf changes, ratings, notes,
collection create and rename and delete, transfers, platform edits, the import
commit. For each, assert the write actually landed and re-reads correctly, and
that a sign-out and sign-in round-trips it.

Also test the paths that only exist when signed in: the legacy /users/{uid}
migration, the backups collection, and what happens when a write is denied by
the rules.

Deliver in phase13.md using the three fixed sections. If the emulator cannot be
made to work, say so in the first line and list exactly what blocked it.
P13
;;
14) cat <<'P14'
PHASE 14 of 21 - MOTION, GESTURE AND INPUT. Everything earlier phases named as
untested because it needs real pointer streams or a media query.

- prefers-reduced-motion: PickNext's cuts:false path, Discover's skipped
  "Picking Next" beat, the media track's instant-jump branch, MarqueeText, and
  the transitions tokens/motion.json defines. Per CLAUDE.md motion must be
  tokenized and reduced-motion respected; verify both, and verify no animation
  exceeds the 500ms ceiling.
- Touch: swipe through the media lightbox (useSwipe, GameDetail.jsx:735),
  long-press lift on a card, and drag-to-shelf on desktop. Use real pointer
  event sequences, not click().
- Keyboard: traverse every route with Tab only and record the focus order and
  any trap. Verify the DropdownMenu focus bug from phase 5
  (DropdownMenu.jsx:196) across every menu in the app, not just awards - phase 5
  found it in one place and asserted it is app-wide, so prove or disprove that.
- Verify focus is never obscured by the sticky header (WCAG 2.4.11) and that
  every target meets 24x24 (WCAG 2.5.8).

Screenshot the states you judge, and open them.

Deliver in phase14.md using the three fixed sections.
P14
;;
15) cat <<'P15'
PHASE 15 of 21 - VISUAL REDO of phase 2: library, browse, category.

Phase 2 drove these controls and asserted the DOM, and it took no
screenshots that anyone opened. The user has asked for those phases to be redone
with the visual layer they were missing. This is not a repeat of phase 2's
DOM assertions and not a repeat of phase 11's route-level resting-state sweep.
It is control-level, interaction-state, looked-at.

Read phase2.md first. Its Tested section is your worklist. Do not re-derive
its DOM findings; you are adding what it could not see.

For every control in that worklist, and specifically for the shelf tabs and strip, every sort and filter and group option, the search layer open and typed-into, the empty-library and empty-shelf plates, the 190-character title card, and every browse and category control:

1. Screenshot the state BEFORE the interaction, then drive the control, then
   screenshot AFTER. Both at 1440 wide and at 375 wide. Dark theme is required
   for every pair because it is the app's default; capture light theme for each
   route's resting state and for any control whose dark render looked wrong.
   Name files p15-route-control-state-width-theme.png in shots/.
2. OPEN every screenshot with the Read tool and write one line describing what
   is on it. A screenshot you did not open does not exist for the purposes of
   this report. Prefer fewer screenshots you judged over many you did not.
3. Judge what a DOM assertion cannot: text clipped mid-word, an element
   overlapping or escaping its container, misalignment, a control invisible
   against its background, a broken or stretched image, a dialog that opens
   off-screen or under the header, a hover or focus ring that does not show, an
   empty state rendering as a bare band, a chart or count that contradicts the
   text beside it, a transition that left the previous state visible.
4. For each defect phase 2 reported, look at it. Confirm whether the render
   matches the description, and say so either way. Phase 2 described chart axis
   labels that were not in the render; that class of mismatch is what this step
   catches.

One thing to look for on every screen: phase 9 proved that a stray h1, in
index.css:251 drops the font-family, weight, uppercase and colour from every
bare h1 and h2 in the product, so headings render in the body font. Note where
that is visible and screenshot one clear example per route.

You may write to tests/ only, for the spec that drives and captures. No source
edits. No production writes.

Deliver in phase15.md using the three fixed sections. In Tested, list each
control with the screenshot pairs you opened. In Not working, visual defects
only, each citing an opened screenshot. In The fix, the file and the change.
P15
;;
16) cat <<'P16'
PHASE 16 of 21 - VISUAL REDO of phase 3: games, GameDetail, discover.

Phase 3 drove these controls and asserted the DOM, and it took no
screenshots that anyone opened. The user has asked for those phases to be redone
with the visual layer they were missing. This is not a repeat of phase 3's
DOM assertions and not a repeat of phase 11's route-level resting-state sweep.
It is control-level, interaction-state, looked-at.

Read phase3.md first. Its Tested section is your worklist. Do not re-derive
its DOM findings; you are adding what it could not see.

For every control in that worklist, and specifically for GameDetail from several entry points with every tab and section, every action button and its confirm, the PickNext dialog in each of its states, the media lightbox, the broken-cover case, and everything on discover:

1. Screenshot the state BEFORE the interaction, then drive the control, then
   screenshot AFTER. Both at 1440 wide and at 375 wide. Dark theme is required
   for every pair because it is the app's default; capture light theme for each
   route's resting state and for any control whose dark render looked wrong.
   Name files p16-route-control-state-width-theme.png in shots/.
2. OPEN every screenshot with the Read tool and write one line describing what
   is on it. A screenshot you did not open does not exist for the purposes of
   this report. Prefer fewer screenshots you judged over many you did not.
3. Judge what a DOM assertion cannot: text clipped mid-word, an element
   overlapping or escaping its container, misalignment, a control invisible
   against its background, a broken or stretched image, a dialog that opens
   off-screen or under the header, a hover or focus ring that does not show, an
   empty state rendering as a bare band, a chart or count that contradicts the
   text beside it, a transition that left the previous state visible.
4. For each defect phase 3 reported, look at it. Confirm whether the render
   matches the description, and say so either way. Phase 2 described chart axis
   labels that were not in the render; that class of mismatch is what this step
   catches.

One thing to look for on every screen: phase 9 proved that a stray h1, in
index.css:251 drops the font-family, weight, uppercase and colour from every
bare h1 and h2 in the product, so headings render in the body font. Note where
that is visible and screenshot one clear example per route.

You may write to tests/ only, for the spec that drives and captures. No source
edits. No production writes.

Deliver in phase16.md using the three fixed sections. In Tested, list each
control with the screenshot pairs you opened. In Not working, visual defects
only, each citing an opened screenshot. In The fix, the file and the change.
P16
;;
17) cat <<'P17'
PHASE 17 of 21 - VISUAL REDO of phase 4: collections, franchises, platforms.

Phase 4 drove these controls and asserted the DOM, and it took no
screenshots that anyone opened. The user has asked for those phases to be redone
with the visual layer they were missing. This is not a repeat of phase 4's
DOM assertions and not a repeat of phase 11's route-level resting-state sweep.
It is control-level, interaction-state, looked-at.

Read phase4.md first. Its Tested section is your worklist. Do not re-derive
its DOM findings; you are adding what it could not see.

For every control in that worklist, and specifically for create, rename, reorder and delete flows with each confirm dialog open, the empty collection, franchise pages, and every ManagePlatforms control including the transfer dialog:

1. Screenshot the state BEFORE the interaction, then drive the control, then
   screenshot AFTER. Both at 1440 wide and at 375 wide. Dark theme is required
   for every pair because it is the app's default; capture light theme for each
   route's resting state and for any control whose dark render looked wrong.
   Name files p17-route-control-state-width-theme.png in shots/.
2. OPEN every screenshot with the Read tool and write one line describing what
   is on it. A screenshot you did not open does not exist for the purposes of
   this report. Prefer fewer screenshots you judged over many you did not.
3. Judge what a DOM assertion cannot: text clipped mid-word, an element
   overlapping or escaping its container, misalignment, a control invisible
   against its background, a broken or stretched image, a dialog that opens
   off-screen or under the header, a hover or focus ring that does not show, an
   empty state rendering as a bare band, a chart or count that contradicts the
   text beside it, a transition that left the previous state visible.
4. For each defect phase 4 reported, look at it. Confirm whether the render
   matches the description, and say so either way. Phase 2 described chart axis
   labels that were not in the render; that class of mismatch is what this step
   catches.

One thing to look for on every screen: phase 9 proved that a stray h1, in
index.css:251 drops the font-family, weight, uppercase and colour from every
bare h1 and h2 in the product, so headings render in the body font. Note where
that is visible and screenshot one clear example per route.

You may write to tests/ only, for the spec that drives and captures. No source
edits. No production writes.

Deliver in phase17.md using the three fixed sections. In Tested, list each
control with the screenshot pairs you opened. In Not working, visual defects
only, each citing an opened screenshot. In The fix, the file and the change.
P17
;;
18) cat <<'P18'
PHASE 18 of 21 - VISUAL REDO of phase 5: events, schedule, awards.

Phase 5 drove these controls and asserted the DOM, and it took no
screenshots that anyone opened. The user has asked for those phases to be redone
with the visual layer they were missing. This is not a repeat of phase 5's
DOM assertions and not a repeat of phase 11's route-level resting-state sweep.
It is control-level, interaction-state, looked-at.

Read phase5.md first. Its Tested section is your worklist. Do not re-derive
its DOM findings; you are adding what it could not see.

For every control in that worklist, and specifically for the schedule toolbar and each filter, the events list and Load More, event detail, the awards index and a ceremony page with its category and year controls, and every overflow menu open:

1. Screenshot the state BEFORE the interaction, then drive the control, then
   screenshot AFTER. Both at 1440 wide and at 375 wide. Dark theme is required
   for every pair because it is the app's default; capture light theme for each
   route's resting state and for any control whose dark render looked wrong.
   Name files p18-route-control-state-width-theme.png in shots/.
2. OPEN every screenshot with the Read tool and write one line describing what
   is on it. A screenshot you did not open does not exist for the purposes of
   this report. Prefer fewer screenshots you judged over many you did not.
3. Judge what a DOM assertion cannot: text clipped mid-word, an element
   overlapping or escaping its container, misalignment, a control invisible
   against its background, a broken or stretched image, a dialog that opens
   off-screen or under the header, a hover or focus ring that does not show, an
   empty state rendering as a bare band, a chart or count that contradicts the
   text beside it, a transition that left the previous state visible.
4. For each defect phase 5 reported, look at it. Confirm whether the render
   matches the description, and say so either way. Phase 2 described chart axis
   labels that were not in the render; that class of mismatch is what this step
   catches.

One thing to look for on every screen: phase 9 proved that a stray h1, in
index.css:251 drops the font-family, weight, uppercase and colour from every
bare h1 and h2 in the product, so headings render in the body font. Note where
that is visible and screenshot one clear example per route.

You may write to tests/ only, for the spec that drives and captures. No source
edits. No production writes.

Deliver in phase18.md using the three fixed sections. In Tested, list each
control with the screenshot pairs you opened. In Not working, visual defects
only, each citing an opened screenshot. In The fix, the file and the change.
P18
;;
19) cat <<'P19'
PHASE 19 of 21 - VISUAL REDO of phase 6: profile, wallpapers, ImportWizard.

Phase 6 drove these controls and asserted the DOM, and it took no
screenshots that anyone opened. The user has asked for those phases to be redone
with the visual layer they were missing. This is not a repeat of phase 6's
DOM assertions and not a repeat of phase 11's route-level resting-state sweep.
It is control-level, interaction-state, looked-at.

Read phase6.md first. Its Tested section is your worklist. Do not re-derive
its DOM findings; you are adding what it could not see.

For every control in that worklist, and specifically for the profile page and its display-name editor mid-edit, the wallpapers gallery and a selected plate, and every step of ImportWizard: file picked, the mapping step, the review step with a conflict row, and the confirm dialog:

1. Screenshot the state BEFORE the interaction, then drive the control, then
   screenshot AFTER. Both at 1440 wide and at 375 wide. Dark theme is required
   for every pair because it is the app's default; capture light theme for each
   route's resting state and for any control whose dark render looked wrong.
   Name files p19-route-control-state-width-theme.png in shots/.
2. OPEN every screenshot with the Read tool and write one line describing what
   is on it. A screenshot you did not open does not exist for the purposes of
   this report. Prefer fewer screenshots you judged over many you did not.
3. Judge what a DOM assertion cannot: text clipped mid-word, an element
   overlapping or escaping its container, misalignment, a control invisible
   against its background, a broken or stretched image, a dialog that opens
   off-screen or under the header, a hover or focus ring that does not show, an
   empty state rendering as a bare band, a chart or count that contradicts the
   text beside it, a transition that left the previous state visible.
4. For each defect phase 6 reported, look at it. Confirm whether the render
   matches the description, and say so either way. Phase 2 described chart axis
   labels that were not in the render; that class of mismatch is what this step
   catches.

One thing to look for on every screen: phase 9 proved that a stray h1, in
index.css:251 drops the font-family, weight, uppercase and colour from every
bare h1 and h2 in the product, so headings render in the body font. Note where
that is visible and screenshot one clear example per route.

You may write to tests/ only, for the spec that drives and captures. No source
edits. No production writes.

Deliver in phase19.md using the three fixed sections. In Tested, list each
control with the screenshot pairs you opened. In Not working, visual defects
only, each citing an opened screenshot. In The fix, the file and the change.
P19
;;
20) cat <<'P20'
PHASE 20 of 21 - FIX SPECIFICATION, WHOLE RUN. Read-only. Write no source edits
and make no commits.

This supersedes phase 9, which only saw phases 1 to 8. Read every phase file in
the run directory, phase0a and phase0b included, and produce the complete fix
specification for the entire run.

Each fix carries: the defect it closes, the file and line, the exact change
(before and after where small enough), the risk, and the specific gate or test
that proves it afterwards.

Consolidation matters more than volume. Known root-cause clusters to merge
rather than list one by one:
- A failed network request rendered as "there is no data", on at least nine
  surfaces. One fix at the fetch or error boundary, not nine at the plates.
- Focus dropped to body after a menu action, asserted to be app-wide from one
  file.
- Data silently destroyed on read or save: the custom entry's release year, the
  unparseable completion date, the unloaded franchise. Determine whether these
  share a shape.

Order the output so a human can work top to bottom: one-line fixes, then real
changes, then the ones needing a decision.

Deliver in phase15.md.
P20
;;
21) cat <<'P21'
PHASE 21 of 21 - THE REPORT. Read-only. This supersedes the phase 10 REPORT.md
entirely; rewrite that file, do not append to it.

Read every phase file in the run directory, phase0a and phase0b included.

REPORT.md gets:
- An honest opening: what this run covered and what it did not. Failed phases,
  and anything the Firebase emulator or the Android emulator could not do,
  belong here rather than buried.
- ## Tested - the full coverage picture as a table: route, controls exercised,
  with a column for whether that control was visually judged (phases 11 and
  15 to 19) or only DOM-asserted (phases 2 to 6),
  controls NOT exercised and why. Include which browser engines and which
  viewports each result came from, because several findings this run were engine
  or width specific. The gaps matter as much as the coverage.
- ## Not working - every defect from every phase, merged, deduplicated, ranked
  by severity, each with its evidence and originating phase. Mark which ones a
  DOM assertion found and which needed someone to look at a screenshot.
- ## The fix - phase 20's specification, ordered for a human to work top down.
- A closing section: what the run could not establish, and what would be needed
  to establish it.

Then rewrite STATUS.md as a one-screen summary pointing at REPORT.md.

Do not pad and do not inflate. A defect count is not a quality score. If coverage
is still thinner than "every button on every screen", name the screens that are
still dark.
P21
;;
esac
}

# --- Run ---------------------------------------------------------------------
say "run $RUN | phases $FROM-$TO | week $WEEK | spent \$$SPENT (coarse net: \$$CEILING)"

FAILED=""
for n in $(seq "$FROM" "$TO"); do
  if [ -f qa/STOP ]; then say "STOP file present, halting before phase $n"; break; fi

  # Resume support: a phase that already produced findings is not redone.
  if [ -s "$RUN/phase${n}.md" ]; then say "phase $n already complete, skipping"; continue; fi

  OVER="$(node -e "process.stdout.write($SPENT >= $CEILING ? '1' : '0')")"
  if [ "$OVER" = "1" ]; then
    say "coarse budget net tripped at \$$SPENT of \$$CEILING, halting before phase $n"
    break
  fi

  PROMPT="$(preamble "$n")

$(phase_prompt "$n")"

  if [ "$DRY" = "1" ]; then say "--- dry run, phase $n prompt ---"; echo "$PROMPT"; continue; fi

  attempt=1; waits=0
  while true; do
    OUT="$RUN/phase${n}.attempt${attempt}.json"
    say "phase $n, attempt $attempt"

    # < /dev/null matters: without a stdin redirect, claude --print waits on a
    # TTY that nohup does not provide, then exits with an empty log.
    claude --print --output-format json \
           --dangerously-skip-permissions \
           --model opus \
           "$PROMPT" < /dev/null > "$OUT" 2>&1

    COST="$(phase_cost "$OUT")"
    SPENT="$(node -e "process.stdout.write(($SPENT + $COST).toFixed(2))")"
    printf '%s %s\n' "$WEEK" "$SPENT" > "$SPENT_FILE"
    say "phase $n cost \$$COST, run total \$$SPENT"

    # The 5-hour limit is a pause, not a stop. Wait it out and retry the SAME
    # phase without consuming an attempt.
    if mentions_limit "$OUT"; then
      waits=$((waits + 1))
      if [ "$waits" -gt "$MAX_LIMIT_WAITS" ]; then
        say "limit still present after $MAX_LIMIT_WAITS waits, giving up on phase $n"
        break
      fi
      cp "$OUT" "$RUN/phase${n}.limited.${waits}.json" 2>/dev/null
      say "usage limit on phase $n: sleeping ${LIMIT_WAIT_MIN}m then resuming (wait $waits/$MAX_LIMIT_WAITS)"
      sleep $((LIMIT_WAIT_MIN * 60))
      continue
    fi

    if [ -s "$RUN/phase${n}.md" ]; then say "phase $n ok"; break; fi

    say "phase $n produced no findings file"
    attempt=$((attempt + 1))
    if [ "$attempt" -gt 2 ]; then break; fi
    sleep 5
  done

  # A dead phase does not kill the night. The phases are independent; record it
  # and move on, which is what the final report needs anyway.
  if [ ! -s "$RUN/phase${n}.md" ]; then
    say "phase $n failed, continuing to the next phase"
    FAILED="$FAILED $n"
    printf 'Phase %s produced no findings. See phase%s.attempt*.json\n' "$n" "$n" \
      > "$RUN/phase${n}.FAILED"
  fi

  sleep 5
done

[ -n "$FAILED" ] && say "phases that failed:$FAILED"
say "run finished. read $RUN/REPORT.md, then STATUS.md"
