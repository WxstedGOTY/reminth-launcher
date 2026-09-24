New round. Two parts: a full systematic audit (do this first, it's the main
job this round), then the specific confirmed bugs below as a starting list —
not the full scope. Read this whole file first.

## Part 1: full audit, not spot-checks

I can't click through the running app myself from here, so this round needs
you to do a systematic pass through the CODE that finds dead buttons/tabs the
same way the bugs below were found — by cross-referencing, not guessing.
Concretely:

1. List every page id in `index.html` (every element the rail/sidebar links
   point at — home, discover, library, instance, skins, plus, captures,
   streamer, settings, whatever else exists) and check each one actually has
   a working entry in `PAGE_META` (or whatever routes pages) in `renderer.js`.
   Anything missing = a dead tab, exactly like the Discover tab bug below.
2. List every `<script>` tag `index.html` actually loads, and cross-check it
   against every `.js` file in `src/renderer/`. Any file that exists but
   isn't loaded is either dead code or a real bug — same class of issue as
   Bug #0 below. Don't stop at features.js/skinview.js if there's a third one.
3. Grep `index.html` for every `id=` that JS code (`renderer.js`, `features.js`
   once it's loaded) reads via `$(...)`/`getElementById`/`querySelector`, and
   flag any id referenced in JS that doesn't exist in the HTML, or vice versa
   — either one means something silently does nothing.
4. Grep for every function called anywhere in `src/renderer/*.js` and confirm
   it's defined somewhere reachable (the same way `activeInstance`/
   `selectInstance` turned up undefined below). A `ReferenceError` waiting to
   happen on some code path is a bug even if nobody's hit it live yet.
5. Check `src/main/preload.js`'s exposed IPC channel names against
   `ipcMain.handle`/`ipcMain.on` registrations in `src/main/*.js` — any
   channel the renderer can call that has no matching main-process handler is
   a dead button too (click does nothing, or throws).

Fix everything you find from steps 1-5, not just log it. If something is
ambiguous (intentionally unfinished vs. broken), say so in the report instead
of guessing, but default to fixing anything that's clearly just wired wrong.

## Part 2: confirmed bugs already found live (fix these regardless)

Live-tested on this machine just now, after installing the newest build:
- Home page "Discover mods" section: header renders, zero cards under it.
  Always empty.
- Left rail "Discover" tab (compass icon): clicking it does nothing at all —
  stays on Home. Completely dead.
- Skin Selector page: opens, but "Your skins" and "Default skins" are both
  empty, and there's no 3D avatar/skin preview rendered anywhere on the page.
  Totally blank apart from headers and the "Load"/"Edit skin" buttons.

All three trace to the same root cause below. This isn't "maybe check if
this file loads" anymore — it's confirmed the app is missing real,
user-visible functionality right now. Treat Bug #0 as the main fix this
round, not a side investigation.

## Bug #0 (fix this FIRST, it explains the above): features.js and
## skinview.js are not loaded

`src/renderer/index.html` has exactly one `<script>` tag:
```
<script src="renderer.js"></script>
```
There is no `<script src="features.js">` and no `<script src="skinview.js">`
anywhere in it. `features.js`'s own header comment confirms it owns exactly
the broken stuff: "2. Home 'Discover mods' cards ... 5. Skins". `skinview.js`
is the 3D skin preview renderer — also never loaded, which is why the Skin
Selector page is blank. `features.js` also calls two functions —
`activeInstance()` and `selectInstance()` — that are not defined anywhere in
`renderer.js` or `features.js` itself.

This is no longer a "maybe" — the missing `<script>` tags line up exactly
with the three confirmed-broken symptoms above. Most likely fix: add
```
<script src="features.js"></script>
<script src="skinview.js"></script>
```
before the closing `</body>` (after `renderer.js`, matching features.js's own
"Loaded after renderer.js" comment), then actually run the app and confirm
Discover mods populates, the Discover tab opens, and the Skin Selector shows
a real 3D preview and skin list. If adding the script tags alone doesn't
fully fix it, that's where `activeInstance`/`selectInstance` being undefined
becomes relevant — chase those down too, they may need to be defined
somewhere (probably reading `state.instances` similar to other functions in
renderer.js) rather than assumed to exist.

Do not just report findings this round — fix it, reinstall-test it yourself
as far as you can without live human clicking, and only leave for the manual
checklist what genuinely needs a human (Forge/NeoForge boot, HUD in-game).

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

Commit and push. Update `REMINTH_STATE.md` with everything above — the full
audit results from Part 1 (every dead page/button/handler found and fixed,
not just counted), what bug #0 turned out to be, whether #1-#4 got fixed, and
the retest results if you got that far. If this round runs long, that's fine
— this is meant to be the thorough pass, not a quick patch.
