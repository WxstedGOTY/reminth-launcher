New round. Real bugs found by the cloud session driving the actual installed app
just now — not guesses, verified on disk and in the running UI. Read this whole
file first.

## Bug #0 (check this FIRST, it may explain everything else): is features.js
## even loaded?

`src/renderer/index.html` has exactly one `<script>` tag:
```
<script src="renderer.js"></script>
```
There is no `<script src="features.js">` and no `<script src="skinview.js">`
anywhere in it. But `features.js`'s own header comment says "Loaded after
renderer.js" and it's full of real functionality (mods/resource
packs/shaders/data packs UI, Discover, Logs viewer, Skins, Streamer mode).
It also calls two functions — `activeInstance()` and `selectInstance()` — that
are not defined anywhere in `renderer.js` or `features.js` itself.

Figure out what's actually going on:
- Is `features.js` genuinely not loaded (dead file), and everything the user
  sees working (mods tab, etc.) is actually handled by code inside
  `renderer.js` itself? If so `features.js` may be legacy/abandoned — confirm,
  and decide whether to delete it or wire it in.
- Or is it loaded some other way I'm not seeing (dynamically injected,
  string-templated into index.html at build time, etc.)? Check for that
  before assuming it's dead.
- Either way, `activeInstance` / `selectInstance` being called with no
  definition anywhere is worth chasing down — if that code path is ever hit
  live, it throws. Find where (if anywhere) those are actually defined, or
  confirm the calling code is unreachable dead code too.

Report exactly what you find — this may be a big deal or a total non-issue,
don't guess, check it for real.

## Bug #1: Library page only ever shows one instance

`src/renderer/renderer.js`, `renderLibraryInstances()` (around line 991) is
hardcoded: it always renders exactly one tile labeled `"Reminth · Fabric"` and
never reads the actual instance list. Verified live: `instances.json` on this
machine has 4 real instances (Fabric, Forge, NeoForge, Quilt), but the
Library → Instances tab shows only the one hardcoded tile. The function's own
comment says "There is exactly one instance today" — that's no longer true,
multi-instance support exists elsewhere in the app (instance creation, the
per-instance folders, `instances.json`), this rendering function just never
got updated.

Fix it: render one tile per entry in the real instance list (however
`state.instances` or equivalent is exposed — check how `renderLibrary`/home
code reads instances elsewhere), each one clickable to make that instance
active and jump to its Instance page. Keep the "Add instance" tile.

## Bug #2: no way found to switch which instance is active

Related to #1 — with the Library grid hardcoded to one tile, there was no
other button, dropdown, or picker anywhere in the UI (home page, instance
page, sidebar) that switches the active instance to Forge/NeoForge/Quilt.
Confirm whether one exists somewhere not checked yet, or whether instance
switching is currently only possible by whatever mechanism created these
instances in the first place. If there's truly no switcher, that's the reason
Forge/NeoForge were never actually tested live tonight — not that anyone
forgot, there was no way to get to them. This needs a real fix, not a
workaround: users need to switch between their instances from the UI.

## Bug #3: sidebar "Instances" count always shows "—"

Home page right sidebar shows Worlds and Servers counts correctly (6, 5 seen
live) but Instances always renders as an em-dash instead of the real count
(4, currently). Same on the Instance detail page's "Mods" stat — shows "—"
instead of a number. Find where these get their value and fix whatever's
returning nothing.

## Bug #4: maximize/restore title-bar icon shows the wrong state

Confirmed live: the launcher now genuinely opens maximized (screen-filling,
correct — this is last round's fix working). But the icon in the custom
title bar shows the "maximize" icon (single square) instead of the "restore"
icon (two overlapping squares) while the window IS actually maximized.
Clicking it does correctly restore to windowed size, so the click behavior is
right — only the icon/visual state is wrong. Find the maximize-state listener
mentioned in last round's report (`src/main/main.js`'s `maximize` event) and
check why the renderer's icon isn't updating to match on the initial
programmatic `win.maximize()` call specifically (it may only listen for
user-triggered maximize, not the one done in code before `show()`).

## Small ask, low priority: bigger toggle switches and trash icons

In the instance mods list, the on/off toggle switches and the trash/delete
icons should be about 35% bigger than they currently are. Everything else
in that row stays the same size.

## Then, only once #1/#2 are actually fixed: retest

With a real way to switch instances, launch Forge and NeoForge for real this
time and confirm both boot. Press H on the Fabric 26.2 instance to confirm
ReminthHUD renders. Update `REMINTH_STATE.md` with real results, not "user
reports."

## Before you finish

Commit and push. Update `REMINTH_STATE.md` with everything above — what
bug #0 turned out to be, whether #1-#4 got fixed, and the retest results if
you got that far.
