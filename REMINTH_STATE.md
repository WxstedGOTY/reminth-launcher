# REMINTH_STATE — local Windows machine report

Written by local Claude Code, 2026-09-24. Round 3 (`CLAUDE_CODE_PROMPT_2.md`) plus
round 4 (`CLAUDE_CODE_PROMPT_3.md`: rebuild, NeoForge investigation, manual checklist).
Every claim is labelled VERIFIED (ran it, saw it), ASSUMED, or UNTESTED.
"User ran it live" means the user tested it personally on this machine and reported the result.

## Round 6 (`CLAUDE_CODE_PROMPT_4.md`, rewritten version): full audit and fixes

**This round replaces round 5's "not fixed" rows below.** The user approved the renderer swap (asked
directly this round: "Swap in matching copy").

### Prompt premise check

The prompt says `index.html` has exactly one `<script>` tag. It doesn't: lines 850-852 load
`renderer.js`, `skinview.js`, `features.js` (VERIFIED again this round). The symptoms were real
(empty Discover, dead Discover tab, blank Skins), but the cause was the stale `renderer.js`, not missing tags:
- duplicate top-level `const`s made the browser reject all of `features.js`;
- `renderer.js`'s `boot()` crashed on its first line (`$("appSideMods")` is null).
No script tags needed adding.

### What changed

| file | change |
|---|---|
| `src/renderer/renderer.js` | Replaced with the matching version from `Downloads\reminth-launcher-push\` (the file `features.js` was written against). Then re-applied our two changes: Home "time played" = sum of `playTimeMs` across all instances; signed-out gate (`switchPage` refuses all but Home; `applyAccountUI` toggles `#app.signed-out`). Plus Bug #4 below. |
| `src/main/main.js` | Bug #4: new `ipcMain.handle("window:isMaximized")`. The `ready-to-show` push from round 5 stays. |
| `src/main/preload.js` | Bug #4: exposes `isMaximized()`. |
| `src/renderer/styles.css` | (round 5) bigger toggle and trash in `.c-actions`; signed-out sidebar rule `!important`. |

### Part 1 audit (all by script or compiler over the current files, VERIFIED)

1. **Pages vs routing:** `.page` divs = home instance library discover skins hosting plus captures streamer
   stats settings. `PAGE_META` has exactly the same 11. Every `data-page` and `switchPage("…")` target is in `PAGE_META`.
   **No dead tabs.** (The old renderer was missing discover/plus/captures/streamer. Fixed by the swap.)
2. **Script tags vs files:** tags = renderer.js, skinview.js, features.js. Files in `src/renderer/` = the same
   three. **Nothing unloaded, no tag without a file.**
3. **ids:** JS reads 154 distinct ids via `$()`/`getElementById`/`querySelector("#…")`. **0 missing from
   index.html.** Dynamic ids checked by hand: `CONTENT_TABS` list/count/tab ids, the `wireTabs`/`fillGrid` targets, and
   `progressWrap|log|progressDismiss|progressStage|progressPct|progressFill` × suffix `""`/`"Out"`. All exist.
   HTML ids no JS reads: `railBrand`, `railNav` (styling hooks), `plusStatus`, `capturesLede` (static text),
   `accentPicker` (its buttons are wired via `.accent[data-accent]` → `applyAccent` + `saveSetting`). None of these is broken.
4. **Undefined functions:** `tsc --allowJs --checkJs` over the three renderer scripts in one shared scope:
   **0 "Cannot find name", 0 duplicate declarations.** `node --check` passes on all three.
   (Before the swap: 17 undefined names, 3 duplicate consts.)
5. **IPC:** 78 preload entries (77 + new `isMaximized`). Every `invoke` has an `ipcMain.handle`, every `send`
   has an `ipcMain.on`. Every `on(...)` listener has a main-side sender (`streamer:status`/`streamer:saved` come from
   `streamer.js` via `notifyUi`). Every `window.reminth.X` the renderer calls exists in preload. **No dead IPC.**
   Informational, not bugs:
   - `catalog:checkUpdates` is an orphan handler (the app uses `content:checkUpdates`).
   - `rec:*` handlers belong to `recorderPreload.js`.
   - Preload APIs nothing calls: `skinSetCape`, `skinLibrarySave`, `skinLibraryRename`, `hudBuilds`,
     `getCatalogProjectVersions`, `getCatalogDependencies`, `catalogWarmStatus`, `catalogWarmStart`.
     **Ambiguous** (unfinished feature or leftover). Not changed; see open questions.

### Runtime verification (VERIFIED, sandboxed dev run)

How: ran this repo's Electron (`node_modules/electron`) with `USERPROFILE`/`APPDATA` pointed at a scratch
sandbox holding only copies of `instances.json` and `settings.json` (checked for secrets first; no account file).
It never touched the real `%APPDATA%\Reminth` or the running installed app. Driven over the Chrome DevTools
protocol with `--remote-debugging-port`. Signed-in pages were reached by setting `state.signedIn = true`
renderer-side, because the sandbox has no tokens. After a forced page reload plus all the steps below, **0 uncaught
exceptions, 0 console errors or warnings, 0 log errors.**

| check | result |
|---|---|
| scripts loaded | `switchPage`, `activeInstance`, `selectInstance` = function; `CONTENT_TABS` = object; `SkinViewer` = function |
| Bug #0 / Discover tab | `switchPage("discover")` gives `discover active=true`. All 11 pages open, each with its own title |
| Home "Discover mods" | `#discoverGrid` has **8 cards** |
| Bug #1 Library | tiles: `Quilt 26.3 \| NeoForge 26.3 \| Forge 26.3 \| Reminth \| New instance` |
| Bug #2 switching | rail has **4 instance buttons**. `selectInstance("forge-26-3-ff87", true)` gives `activeId=forge-26-3-ff87`, hero `Forge 26.3`, Instance page open |
| Bug #3 counts | `sideInstances` = **4**. Instance page `instMods` = **0** on Forge (correct, it has no mods; was "—") |
| Bug #4 icon | after reload: icon `wc-max restore`, title `Restore`. Main reports `isMaximized=true` |
| Skins | 3D viewer renders: `#skinViewport` 338×426, 95 elements, 73 textured faces (CSS-3D, not canvas). "Your skins" shows the "Add a skin" tile. Default skins shows "Not available yet – Play once…", which is correct for the sandbox: it has no Minecraft files. With the real data dir these come from the downloaded game assets. That part is UNTESTED here |
| sign-out gate | signed out: sign-in card only; rail nav, rail instances, sidebar, top actions all `display:none`; `switchPage("library")` stays on `home` |
| heroPlaytime | `3m` (sum across instances) |
| bigger toggles/trash | scoped rule applies (knob computed 24×24; a `.switch` elsewhere stays 44×25). Rendered size not measured, because the mods list was on a hidden page |

`npm test`: 53/53. The other copy's `features.test.js` plus its `minecraft.test.js`, run against our source
from the scratchpad: 74/75. The one failure is its old 2 GB memory expectation, superseded on purpose in 45882dc.

### Build

New `dist\Reminth-Setup.exe` built 21:56 (exit 0). SHA-256 `d92fee22ca9c27bb2e3a2c3448f2bb96a55baa3cc3c8809bd3b09e2279a796c6`.
Built via `-c.directories.output=dist/build-round5` (the old `dist\win-unpacked` lock). The packaged `app.asar`
was checked for: `selectInstance`, no duplicate `MOD_COLOURS`, the signed-out guard, the heroPlaytime sum, the `isMaximized`
handler, preload and query, and the `.c-actions` sizes. All true. **Not installed**: the installed Reminth was running
(8 processes), and installing would have closed it.

### Retest (Forge / NeoForge boot, HUD in game)

**UNTESTED, needs a human.** Switching now works, so these are reachable. But launching the game and
pressing H in-game need someone at the real app. See the checklist below.

## Round 5 (`CLAUDE_CODE_PROMPT_4.md`): the renderer is the wrong version

### Bug #0: what's actually going on (VERIFIED, all checked, none guessed)

- **`features.js` *is* referenced.** `src/renderer/index.html:850-852` has
  `<script src="renderer.js">`, `<script src="skinview.js">`, `<script src="features.js">`. It has been in
  the repo since 8fedbcc, and the installed app's `app.asar` (my 20:25 build) has the same three tags.
  The cloud session's "exactly one script tag" premise doesn't hold for the pushed repo.
- **But `features.js` never runs.** `renderer.js` and `features.js` both declare the top-level
  `const MOD_COLOURS`, `const MANAGED_JAR`, `const DISCOVER_MODS` (renderer.js:1033/1039/1228,
  features.js:177/248/563). Classic scripts share one global lexical scope, so the browser rejects
  the whole second script at load with `SyntaxError: Identifier 'MOD_COLOURS' has already been declared`.
  Found with `tsc --allowJs --checkJs` over the three files: TS2451 on those three names.
- **`features.js` also calls 17 helpers the committed `renderer.js` doesn't define** (TS2304):
  `activeInstance` (18 calls), `selectInstance`, `loadInstances`, `instanceById`, `icon` (19), `button`,
  `openModal`, `confirmModal`, `makeDropdown`, `localGet`, `localSet`, `formatBytes`, `loaderLabel`,
  `sortItems`, `SORT_OPTIONS`, `currentPage`, `getVersions`. The only `activeInstance` in the repo is an
  async **main-process** function (`src/main/main.js:265`) that the renderer can't see.
- **The committed `renderer.js` is the version from before `features.js` was split out.** Its own header
  still says multiple instances are "labelled Soon". It uses 11 element ids that don't exist in the current
  `index.html` (`appSideMods skinBody instPacks hostTiles openModsFolder2 openPacksFolder tabFilesBtn
  newServerBtn linkServerBtn heroMods ramMax`). `$()` is `document.getElementById`, so these are
  null and throw a TypeError. The first line of `boot()` is `$("appSideMods").style.display = "none"`, so
  **`boot()` dies immediately**, and `switchPage` throws partway through every page change. Its
  `PAGE_META` also lacks discover/plus/captures/streamer (round 3's "Broken or weird #3").
- **The matching `renderer.js` exists on this machine**, in a second working copy:
  `C:\Users\kolijos\Downloads\reminth-launcher-push\` (a clone of GitHub at 446dbdf with uncommitted
  edits; it does *not* contain `fe297f7`/`39b1a4c` either). Its `src/renderer/renderer.js`
  (69,549 bytes, 11:08 today):
  - with the same `features.js` (byte-identical, 86,602 bytes) and `skinview.js`: **0 undefined names,
    0 duplicate declarations** under the same tsc check;
  - uses 150 element ids, **0 missing** from the current `index.html`;
  - defines `activeInstance`, `instanceById`, `loadInstances`, `selectInstance`, `renderRail`, and a real
    `renderLibraryInstances` (one tile per `state.instances` entry, click = `selectInstance(id, true)`,
    plus a "New instance" tile), and sets `sideInstances` from `state.instances.length`. It has the full `PAGE_META`.
  - Every other source file in that copy is identical to 8fedbcc, except `styles.css` (head-mods panel height,
    ours is newer) and tests (it has `test/features.test.js` plus `splitArgs`/`substituteTokens` tests, and
    an older memory test).
- So Bugs #1, #2 and #3 are what the old renderer looks like: hardcoded Library tile, no rail or
  instance switcher, and nothing ever sets `sideInstances`. The code that fixes them already exists
  in the matching renderer.

### What got fixed this round

| item | status |
|---|---|
| Bug #0 | Diagnosed (above). **Not fixed yet**: the fix is to replace `src/renderer/renderer.js` with the `reminth-launcher-push` copy, then re-apply our two renderer changes (heroPlaytime sum across instances, and the signed-out `switchPage` guard with the `#app.signed-out` toggle in `applyAccountUI`). My attempt to copy the file was **refused by the local permission guard**, so it's waiting on the user. |
| Bug #1 Library shows one tile | Not fixed. Fixed by the renderer swap (that version's `renderLibraryInstances` is data-driven). |
| Bug #2 no instance switcher | Confirmed: in the committed renderer there is none. Its rail has no instance buttons, and Library is one hardcoded tile. That's why Forge/NeoForge couldn't be reached. The matching renderer has two switchers (rail instance chips and Library tiles). Fixed by the swap. |
| Bug #3 sidebar Instances "—", Instance page Mods "—" | Not fixed. The committed renderer never writes `sideInstances`, and `boot()` dies before any stats load. The matching renderer sets `sideInstances`. The Mods count comes from `features.js`, which will run once it can load. Re-check after the swap. |
| Bug #4 maximize icon wrong | **Fixed in code** (`src/main/main.js`). `maximize()` on the still-hidden (`show:false`) window doesn't reliably emit `maximize` on Windows, so the icon never flipped. Now `ready-to-show` sends `window:maximized` with `win.isMaximized()` after `show()`. UNTESTED live. |
| Bigger toggles and trash icons | **Done** (`styles.css`, `.c-actions` only). Switch 54×30 (was a 44×25 at scale .9), knob 24px. Trash button 43px (was 32), icon 22px (was 16). Real sizes, not transforms, so the row makes room. UNTESTED visually. |
| `#app.signed-out .app-side` | Now `!important`, because the matching renderer's `switchPage` sets the sidebar's display inline. |

### Retest

**Not done.** The prompt says to retest only once #1/#2 are fixed, and they aren't until the renderer swap lands.
Launching Forge/NeoForge and pressing H also need someone clicking through the real app.

## Round 4: build

VERIFIED: a new `dist\Reminth-Setup.exe` was built at 2026-09-24 20:25 local time. Size 83,118,625 bytes,
SHA-256 `81e8f9e8c56b7f1d4cb4be6f55fb576e6d55764e7a60ebae4d4f71faf87fe34d`. Not installed; the user installs it.

What happened:
1. `npm run dist` failed twice with the same error:
   ```
   ⨯ remove C:\Users\kolijos\Downloads\reminth-launcher\dist\win-unpacked\resources\app.asar: The process cannot access the file because it is being used by another process.
   ⨯ C:\Users\kolijos\Downloads\reminth-launcher\node_modules\app-builder-bin\win\x64\app-builder.exe process failed ERR_ELECTRON_BUILDER_CANNOT_EXECUTE
   ```
2. VERIFIED with the Windows Restart Manager API: the process holding that file was
   `claude.exe` (Claude desktop app, PID 5304). It was not Reminth; every running
   `Reminth.exe` was the installed copy in `AppData\Local\Programs\Reminth`. I didn't kill it.
3. Workaround: `npx electron-builder --win nsis -c.directories.output=dist/build-round3`. The output was
   `exit=0` and ended with `building target=nsis file=dist\build-round3\Reminth-Setup.exe`, then `building block map`.
   Code signing was skipped (`no signing info identified`), same as before.
4. VERIFIED the packaged `app.asar` contains this round's code: the maximize-on-`ready-to-show` call, the
   `switchPage` signed-out guard, the `#app.signed-out` CSS, and the RAM clamp fix. All four checks returned true.
5. Copied `Reminth-Setup.exe` and `.blockmap` into `dist\`. The SHA-256 matches the build output.
   `dist\win-unpacked\` is stale (from 12:54). Its `app.asar` stays locked until the Claude desktop app lets go.
   `dist\` is gitignored, so none of this is committed.

## Round 4: the NeoForge mismatch, answered

**VERIFIED: the NeoForge instance has never been launched, or even installed, by Reminth on this
machine.** The test the user remembers as "NeoForge launched clean" was not `neoforge-26-3-0050`.
Evidence, all read from disk today:
- Every NeoForge/Forge launch goes through `forge.js`. That code first downloads the loader's installer to
  `%APPDATA%\Reminth\cache\loader-installers\<key>\installer.jar`, then unpacks libraries into
  `instance\libraries\`. **`cache\loader-installers\` does not exist**, and `instance\libraries\net\`
  has only `fabricmc`, `java`, `sf`. There is no `neoforged` and no `minecraftforge`.
- `instance\versions\_loader-profiles\` has only `fabric-26.2-0.19.5.json` (15:46) and
  `quilt-26.3-0.30.1.json` (16:52:29). No NeoForge or Forge profile.
- `launch-logs\` has only `reminth.txt` (Fabric 26.2, first line at 15:46:12) and
  `quilt-26-3-49e0.txt` (Quilt 26.3, 16:52:39).
- Timeline from folder timestamps: Forge instance created 16:48:19, NeoForge 16:50:46, then Quilt
  installed (16:52:29), launched (16:52:39) and wrote `options.txt` (16:53:25). Nothing NeoForge after it was created.
- No other NeoForge instance exists anywhere: `%APPDATA%\Reminth\instances\` has only the forge, neoforge and quilt
  folders. `ModrinthApp\profiles\` has `Fabric 26.2`, `cpvp`, `Shulker tool tip`, `Reminth`, `Reminth (1)`,
  `Reminth (2)`, `WxstedGOTY` (none NeoForge). No Prism install. `.minecraft\versions\` has no NeoForge version.

What disk can't tell (UNTESTED): whether Play was clicked on NeoForge at all. It could have been clicked
and failed before the installer download (loader version lookup or URL check), leaving no trace.
Or a different instance may have been selected when Play was pressed. The fresh NeoForge run in the
checklist below will settle it. If it fails, the error text is what's needed.

Side note (VERIFIED): the Minecraft running during this round was started by the **Modrinth App**
(`javaw.exe` from `ModrinthApp\meta\java_versions\zulu25…`), not Reminth.
When testing, check the window came from Reminth.

## Git

Round 3 is two commits on top of `d545dff`: one for the code fixes, one for this report.
Both are pushed as fast-forwards. No force-push. `git log`, `git status` and the
`HEAD == origin/main` check after the push are in the local session output, because
a file can't contain the hash of the commit that adds it.

State before this round (VERIFIED): `HEAD == origin/main == d545dff`, working tree clean
apart from the new untracked `CLAUDE_CODE_PROMPT_2.md` (committed this round).

## Environment

Unchanged from round 2 (VERIFIED then): Windows 10.0.22631.6199, Node v24.21.0,
Electron 33.4.11, one Reminth JDK at `%APPDATA%\Reminth\java\` (`JAVA_VERSION="25.0.4.1"`).

Instances on this machine (VERIFIED, from `%APPDATA%\Reminth\instances.json`):
| id | loader | MC | loader version | hud |
|---|---|---|---|---|
| reminth | fabric | 26.2 | 0.19.5 | true |
| forge-26-3-ff87 | forge | 26.3 | 66.0.3 | false |
| neoforge-26-3-0050 | neoforge | 26.3 | 26.3.0.16-beta | false |
| quilt-26-3-49e0 | quilt | 26.3 | 0.30.1 | false |

## What I asked for this round

```
Read CLAUDE_CODE_PROMPT_2.md and follow it
```
(`CLAUDE_CODE_PROMPT_2.md` is committed alongside this file.)

## What you did

Files changed:
- `src/renderer/renderer.js`: **Fix #1 (sign-out gating).** `switchPage` refuses every page
  except Home while `state.signedIn` is false. Every navigation path goes through it: rail buttons,
  `[data-page]` clicks, instance tiles, the account chip, and streamer-mode page switches in `features.js`.
  `applyAccountUI` (the existing gate that already swaps Home between `#signInHero` and
  `#homeMain`) now also toggles `#app.signed-out` and sends a signed-out user back to Home.
  No second mechanism: the existing sign-in card is the "sign in to continue" screen.
- `src/renderer/styles.css`: `#app.signed-out` hides everything in the rail except the logo, plus
  the top bar actions (Player Statistics, Host a server) and the right sidebar (Worlds, Servers,
  Instances counts). The window controls and account chip stay visible.
- `src/main/main.js`: **Fix #2 (open maximized).** `BrowserWindow` is created with `show: false`.
  On `ready-to-show` it calls `win.maximize()` then `win.show()`, so it never flashes windowed.
  The existing work-area-based width and height become the restore-down size. The existing
  `maximize` listener tells the renderer, so the title bar shows the restore icon.
- `CLAUDE_CODE_PROMPT_2.md`: committed so the cloud session can see this round's instructions.
- `REMINTH_STATE.md`: this file.

Commands:
| command | result |
|---|---|
| `npm test` | VERIFIED pass: `tests 53`, `pass 53`, `fail 0` |
| `node --check src/main/main.js`, `node --check src/renderer/renderer.js` | VERIFIED pass |
| Read `instances.json`, instance folders, `launch-logs/` | done, see test results |
| `git push origin main` | see session output |

## Test results

| test | status | evidence |
|---|---|---|
| Fresh device-code sign-in | VERIFIED pass | User ran it live: signed out, signed back in with the real device-code flow, worked |
| Multiplayer join, donutsmp.net, from the Quilt instance | VERIFIED pass | User ran it live. Confirms the full Mojang session-auth chain |
| Fabric launch | VERIFIED pass | User ran it live, launched clean |
| NeoForge launch | **Not a valid pass.** The user reported a pass, but disk shows `neoforge-26-3-0050` was never installed or launched | See "Round 4: the NeoForge mismatch, answered". Retest (checklist step 4) |
| Quilt launch | VERIFIED pass | User ran it live, launched clean. `launch-logs/quilt-26-3-49e0.txt` shows `Loading 4 mods` |
| Forge launch | UNTESTED | No Forge launch on record: `instances/forge-26-3-ff87/` has only empty `mods/resourcepacks/saves/shaderpacks`, and no `launch-logs` entry. Starting the game needs someone to click Play in the GUI, and the user was in a live multiplayer session this round, so I didn't touch the launcher |
| ReminthHUD on Quilt 26.3 | VERIFIED: **does not load** | The launch log's mod table lists only Minecraft 26.3, Quilt Loader 0.30.1, MixinExtras 0.5.4, and OpenJDK. No ReminthHUD. `instances/quilt-26-3-49e0/mods/` has 0 jars. Reasons, all VERIFIED from code and disk: instance has `hud=false`; the only bundled build (`assets/mods/reminthhud-1.0.0.jar`) has `fabric.mod.json` `"minecraft": "~26.2"`, so no 26.3 build exists |
| ReminthHUD on NeoForge 26.3 | VERIFIED: **cannot load, by design** | `minecraft.js`: `const wantsHud = instance.hud === true && (loader === "fabric" \|\| loader === "quilt");`. NeoForge and Forge are never given the HUD. The jar is Fabric-only (`fabric.mod.json`, no `mods.toml`) |
| ReminthHUD on Fabric 26.2 (original instance) | VERIFIED installed; rendering in game UNTESTED | `instance/game/mods/` contains `reminthhud-1.0.0.jar` and `fabric-api-0.161.0+26.2.jar` (16 jars total). Pressing H in game was not tested by me |
| Fix #1: sign-out hides instances, worlds, mods, servers | UNTESTED (code only) | Not run live. Signing out would have deleted the user's saved account mid-session |
| Fix #2: launcher opens maximized | UNTESTED (code only) | Not run live, because the installed Reminth and a `javaw` multiplayer session were running |
| Silent refresh on Play (`refreshSession`) | UNTESTED | |

## Broken or weird

1. **NeoForge result:** answered in round 4 (see above). The instance was never installed or launched by
   Reminth. The earlier "pass" can't have come from it.
2. **ReminthHUD only exists for Fabric/Quilt on MC 26.2.** The three test instances are all 26.3,
   and two of them are Forge-family, so none of them can show the HUD.
3. **Pages with no `PAGE_META` entry.** `index.html` has `#discover`, `#plus`, `#captures`,
   `#streamer` pages, and the rail and sidebar link to them. But `PAGE_META` in `renderer.js` has no entries for
   them, so `switchPage` returns early (`if (!PAGE_META[page]) return;`). This was already true before this round.
   ASSUMED: those pages can't be opened from the rail. The installed build may differ. Not fixed.
4. Stale files in `%APPDATA%\Reminth\instance\mods\` (`wxhud-1.0.0.jar`, `lithium-…`,
   `fabric-api-0.160.0…`). The real mods dir is `instance\game\mods\`. This folder is unused (ASSUMED) but confusing.
   `assets/mods/wxhud-1.0.0.jar` (the pre-rename HUD) is also still in the repo.
5. Still open: commits `fe297f7` / `39b1a4c` from the first handoff exist nowhere reachable.

## Open questions for the cloud session

1. ReminthHUD for 26.3, and for NeoForge/Forge at all: is a build planned, or is the HUD Fabric/Quilt-26.2 only for now?
2. `discover` / `plus` / `captures` / `streamer` missing from `PAGE_META`: intended, or a regression? It's a
   one-line-per-page fix, which also interacts with the new sign-out guard.
3. Should Settings stay reachable while signed out? It's gated along with everything else for now.

## Manual test checklist (user: run these by hand, in order, after installing the new build)

Install `dist\Reminth-Setup.exe` first. Close Reminth and the Modrinth App before starting,
so any Minecraft window you see definitely came from Reminth.

1. Open Reminth. It should open **already maximized**: filling the screen, with the restore icon
   (two squares) in the top-right. Restore it once to check it drops to a normal window.
2. Settings → **Sign out**. Only the "Sign in to play" card should show: no icons on the left rail
   except the logo, no instance list, no sidebar Worlds/Servers/Instances counts, no "Player Statistics"
   or "Host a server". Then **sign back in** and confirm all of it comes back.
3. Select the **Forge 26.3** instance (`forge-26-3-ff87`), press Play, and confirm the game reaches the title screen.
   If it crashes, copy the last ~30 lines of `%APPDATA%\Reminth\launch-logs\forge-26-3-ff87.txt`
   (or the error shown in Reminth) for next round.
4. Select the **NeoForge 26.3** instance (`neoforge-26-3-0050`) and press Play. Confirm it boots,
   then confirm `%APPDATA%\Reminth\launch-logs\neoforge-26-3-0050.txt` now exists. That proves which
   instance ran. If it fails, copy the exact error text.
5. Select the original **Reminth (Fabric 26.2)** instance, launch, join a world, press **H**, and confirm
   ReminthHUD draws on screen.

## What's left

- [x] Swap in the matching `renderer.js` and re-apply the heroPlaytime and signed-out changes (done round 6).
- [ ] Install the round 6 `dist\Reminth-Setup.exe`, then run the 5 manual tests above. To switch instance,
      use the rail chips on the left or Library → Instances. Also glance at: the Discover tab, Home
      "Discover mods" cards, Skins (3D preview and default skins), and the bigger toggles and trash icons in a mods list.
- [ ] Decide on the 8 unused preload APIs and the orphan `catalog:checkUpdates` handler.
- [ ] `Downloads\reminth-launcher-push\` is now redundant (its renderer is in the repo). Decide whether to delete it,
      so there's one working copy.
- [ ] ReminthHUD for 26.3 and for Forge/NeoForge: no build exists (see Broken or weird #2).
- [ ] Silent refresh on Play (`refreshSession`'s bare `catch {}` in `main.js`).
- [ ] Decide on the `PAGE_META` gap, `electron-updater`, and the `brace-expansion` lockfile pins.
- [ ] Once the Claude desktop app releases it, delete the stale `dist\win-unpacked\` so plain `npm run dist` works again.
