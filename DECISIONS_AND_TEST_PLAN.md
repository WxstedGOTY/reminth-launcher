# Reminth: what to know, decide and test

**This is the one living hand-off file between the windows.** Every Claude Code session that finishes
work rewrites it (see `CLAUDE.md`). Desktop window: `git pull`, read this top to bottom, then work
section 4 in order and report PASS/FAIL per step.

- **Last updated:** 3 Oct 2026 (evening), by the **desktop window**, which this time wrote the code itself
  (owner's request: no prompts): the server ping fix (was prompt 14), ReminthHUD's FPS/GPU/CPU/LAT bar (was
  prompt 15), updates without the Windows admin prompt, "Boost FPS…", and an FPS investigation measured in the
  real game. **CLOUD_PROMPT_14.md and CLOUD_PROMPT_15.md are done - don't send them.**
- **`main` is at:** see `git log` (this file's commit is the last of the batch). **`npm test`: 582 pass** on Windows.
- Prompts 10-13 were released in 1.4.1; their steps below that aren't marked PASS are still open.
- Rules: `CLAUDE_CODE_HANDOFF_10.md` sections 0-1. Version bumped to **1.4.2** in `package.json`; `dist/Reminth-Setup.exe` built (not uploaded) - section 4, R2 first.

---

## 1. What changed

### Desktop batch, 3 Oct evening (owner: "200 FPS in Reminth vs 500 in Modrinth", ping too high, update popup annoying)

**1. Server ping** (`src/main/serverPing.js`, `test/server-ping.test.js`, tooltip in `features.js paintPing`).
The number was the time the server took to build its status answer (MOTD, icon, players), not the round trip.
Now, like Minecraft's own server list: after the status answer, up to 3 Ping/Pong packets (8-byte payload, must
echo exactly), `process.hrtime`, median kept. A server that never answers a ping falls back to the status time
(`latencyKind: "status"`, tooltip says so); a vanilla server that hangs up after the first pong still counts it;
ping phase capped at 1.5 s inside the old 3.5 s timeout. Real servers, old vs new: hypixel.net 439 → 149 ms,
donutsmp.net 103 → 42, play.cubecraft.net 82 → 40, 2b2t.org 37 → 17.

**2. Updates without the admin prompt** (`package.json` build.nsis, `build/installer.nsh`, `updater.js`).
The UAC popup came from the "all users" install in `C:\Program Files\Reminth` (Windows must ask to write there).
Now: one-click NSIS, **per user** (`%LOCALAPPDATA%\Programs\reminth-launcher`), no admin rights ever, and
"Restart and update" runs `quitAndInstall(true, true)` (silent, Reminth reopens). `build/installer.nsh`
`customInstall`: if an HKLM "all users" Reminth exists in another folder, its own uninstaller is run once,
elevated (`/allusers /S /KEEP_APP_DATA`), so Windows asks **one last time** and the old copy and its public
shortcuts go. Player data is in `%APPDATA%\Reminth` and is not touched. The install-folder chooser is gone
(one-click has none). Checked: a test build installs silently with no prompt in 9 s, makes the desktop + Start
menu shortcuts and the HKCU uninstall entry, and its silent uninstall removes them. **Not checked: the removal of
the old Program Files copy** (needs someone to answer the Windows prompt) - section 4 R2.

**3. ReminthHUD 1.1.0** (`hud/`, jars in `assets/mods/`: `reminthhud-1.1.0+26.2.jar`, `…+26.3.jar`).
Top-right bar `FPS 208 | GPU 55 % | CPU 7 % | LAT 0 ms` (owner's screenshot), coordinates + facing on a line
under it (the old top-left box sat on top of Xaero's minimap). GPU = Windows `\GPU Engine(*)\Utilization
Percentage` via `pdh.dll` through `java.lang.foreign`, summed per engine (luid+phys+eng - this PC has 7 separate
"copy" engines), busiest engine, on one low-priority daemon thread; failure → the item is left out. CPU =
`OperatingSystemMXBean.getCpuLoad()` (= Windows "% Processor Time"; Win 11 Task Manager shows the clock-scaled
"% Processor Utility", so they can differ). LAT = `getPlayerInfo(uuid).getLatency()`. `config/reminthhud.json`
switches items off. Moves below potion icons. One source builds both jars (key type looked up by name:
`KEYBOARD` on 26.3, `KEYSYM` on 26.2; Minecraft range from Gradle: `gradlew build -Pminecraft_version=26.2
-Pfabric_api_version=0.159.0+26.2 -Pversion=1.1.0+26.2`). Seen in the real game (26.2, the owner's 32 mods):
loads with no warning, bar and coordinates line drawn as above, no FPS cost (paired runs 228/219 vs 215-221).
The HUD is **off** on the owner's main instance (`hud:false`) - he turns it on in the instance settings.

**4. "Boost FPS…"** (instance menu; `gameOptions.js planBoost/applyBoost/undoBoost`, IPC `perf:boostPlan/
boostApply/boostUndo`, `renderer.js boostFpsFlow`, `test/boost-fps.test.js`). Only on the player's click and
"Change them", never while the game runs. Lists every change from → to; on the owner's file: render distance
16 → 12, simulation 12 → 8, entity shadows off, clouds off, biome blend 2 → off (also: V-Sync off, a frame cap
→ unlimited, particles all → decreased, when set). Only keys already in options.txt change, in the game's own
spelling; `graphicsPreset` becomes `"custom"` from 1.21.11 (else the preset overwrites the values). Old values
saved first to `.reminth/options-before-boost.json`; "Put my old settings back" restores the ones still at the
boosted value. Max FPS profile text now points here.

**5. Launcher draws nothing while a game runs (1.4.3 fix: 1.4.2 had this wrong)**: `body.game-running` switches every CSS animation OFF (`animation: none`). In 1.4.2 it PAUSED them, which froze the page/dialog fade-ins at opacity 0 (or half way after Ctrl+R): the launcher looked empty or dim for as long as a game ran. Reported by the owner with screenshots. Originally: it pauses every CSS animation (a launcher
left visible next to a windowed game would otherwise redraw at the monitor's 239 Hz). Measured during play
before this: Reminth used 0 % CPU and 0 % GPU (its window was hidden), so this is a safety net, not a speed-up.

**FPS investigation (real game, owner's PC, 26.2).** A test-only mod (`reminthbench`, scratchpad only, not in
the repo) records every frame time; launched through Reminth's own `minecraft.launch()` with an offline test
account into a copy of the owner's world, window 1600x900, camera turning. Roblox (30-50 % GPU) and Medal's
recorder were running the whole time, so absolute numbers swing ±20 % between runs; only runs next to each
other are compared (paired with a baseline on both sides).
- **Same mods + same settings, Reminth's launch vs a Modrinth-style launch** (Zulu 25 + Modrinth's G1 flags,
  normal priority): 164 vs 164, 236 vs 223, and 201 vs 232 (neighbours). **Reminth's Java setup is not
  slower**, and had fewer frames over 50 ms (0 vs 4 in round 1). Keep ZGC: G1 gave +2 % average but 1 % lows
  85 vs ~100.
- **The 200-vs-500 gap is the instance, not the launcher**: Modrinth's profile runs render distance 8,
  simulation 8, no shadows/clouds/biome blend, 22 mods (no Xaero's Minimap, JEI…), no resource packs. In the
  same run pair, Modrinth's mods + settings through Reminth's launch: 241 vs 164 (+47 %).
- Indoor scene (the saved player stood inside a house, walls hid the world): Boost settings +14 % average,
  1 % lows 112 vs 58 (+91 %), worst frame 15 ms vs 198-280 ms in the baselines; no Xaero's Minimap +17 %;
  no resource packs +9 %; ReminthHUD no cost.
- **Outdoor scene** (spectator 30 blocks up, open view - where render distance really costs): running
  overnight on a quiet PC (base vs Boost 12/10, Nvidium beta, More Culling + BadOptimizations, Modrinth
  everything vs Reminth everything). Results go here when done.

### Prompt 13 ("Your mods already fit" was false for a real instance - blocks release 1.4.1)

Prompt 12 job 2 said "Your mods already fit Minecraft X - there is nothing you need to change." whenever Modrinth
had a build of every checked mod for X. On a Fabric 1.21.1 instance holding 26.2 mod files that told a newcomer
to do nothing while the Mods panel said "28 mods will stop Minecraft from starting". Now the picker separates
**(a) builds exist** from **(b) the installed files fit** (the compatibility result - the same data as the Mods
panel and the yellow button; blocked, "may not work" and "crashed the game" all count):

| (a) builds for the current version | (b) installed files | the picker says |
|---|---|---|
| all mods have one | no compatibility result yet | grey **"Checking your installed mods..."** - decided when it arrives, never the happy sentence |
| all mods have one | none blocked / may not work / crashed | green **"Your mods already fit Minecraft X - there is nothing you need to change."** |
| all mods have one | N files are for another version | amber **"Builds exist for Minecraft X for all your mods, but N of the files in this instance are made for another version. Press "Update mods to fit" to swap them."** + that button **inside the dialog** (the yellow button's own operation, progress and result toast; the line is then worked out again) |
| all mods have one | problems the button can't fix (it already left them) | amber, no button: "…but N mods in this instance won't load or may not work. The Mods tab says which, and what to do." |
| some mods have none | (anything) | today's best-match line and ranked list (the case the owner originally asked for) |

The "Other versions that also fit" list is shown as before in the first four rows (no "Best match" badge, no
pre-selected row). N in the amber line is the yellow button's own number. Only `openVersionAdvisor` and its
pure helpers changed. The prompt-12 test for the green sentence now passes clean file data (it was asserting
the sentence with no file data at all - the bug); tests: `pickerView`/`filesSummary` for all four (a)x(b)
combinations, no result yet, and blocked + may-not-work + crashed counts.

| Files | |
|---|---|
| `src/renderer/pure.js` | `filesSummary`, `pickerView` (states fits / files / checking / best) |
| `src/renderer/features.js` | `openVersionAdvisor`: reads/awaits the compatibility result, the amber line + in-dialog button, repaint |
| `src/renderer/styles.css` | `.adv-best.warn`, `.adv-best.neutral`, `.adv-fix` |
| `test/version-flow.test.js` | +1 test, 1 updated |

### Prompt 12 (Time played on Home + three fixes from the desktop test)

| Job | What it does now | Files |
|---|---|---|
| 1 - lifetime Time played | Home's **Time played** = every minute played through Reminth, on every instance, **deleted ones included** (the owner's correction to prompt 3). A counter `totalPlayTimeMs` in `settings.json` (finite, non-negative, max 200 years; junk = absent). **Seeded once** at start, before the page can show it, from the sum of the instances' recorded time - never seeded twice, never lowered, never recomputed. Each finished session adds its time right after the instance's own time is recorded (`finishSession` → `recordSession` → `store.addPlayTime`), same rules (a start that failed adds nothing; a crash in play counts; two games at once both count - the settings lock). Only `store.seedPlayTime/addPlayTime` change it; a settings save from the page ignores it. A failed write never touches the exit handling. Home shows it ("12h 6m") with the tooltip "All your time in Minecraft through Reminth, across every instance - including ones you deleted." and repaints when a game ends (`play:totalTime`). Last played on Home, the instance page and Player Statistics are unchanged. | `store.js`, `main.js`, `preload.js`, `renderer.js` (`paintHeroStats`), `pure.js` (`homePlayTime`), `test/play-time.test.js` (new) |
| 2 - nothing to change | When the instance's own version already fits every checked mod (and a checked server takes it), the picker's green line says **"Your mods already fit Minecraft 26.2 - there is nothing you need to change."** and only the other fitting versions follow under "Other versions that also fit" - no "Best match" badge, nothing pre-selected. With problems on the current version, unchanged. | `pure.js` (`pickerView`), `features.js` |
| 3 - complete promise | "Switch this instance" confirm step now shows an **exact preview** from the main process (`compat:previewSwitch` → `versionSwitch.previewSwitch`): the same advisor answer, the same compatibility check and swap plan against the new version, nothing changed. Preview and switch build their list with ONE function (`turnOffPlan`), so "Will be turned off (3)" with each mod and reason ("no version made for 1.21.10" / "its own file says it can't run on 1.21.10") is what the result screen shows. The Switch button waits for the preview; a failed preview says so with Try again. | `versionSwitch.js`, `main.js`, `preload.js`, `pure.js` (`previewGroups`), `features.js` |
| 4 - stale button | When "Update mods to fit" ends, the old answer is dropped and the button repainted at once (hidden), then painted from a fresh check. Mods the run couldn't fix (no stable build / not on Modrinth / failed) don't count again until the switched-on mods change, so the button hides when nothing it can fix is left. (I couldn't find a path that repainted an old answer after the fresh check; the "(2)" most likely WAS the two mods it couldn't fix - both causes are covered.) | `features.js` (`runModsSync`, `syncCount`), `pure.js` (`syncButtonCount`) |

### Prompt 10 ("stop creating me a million instances that I can't delete simply")

| Job | What it does now | Files |
|---|---|---|
| 1 - instance menu | **Right-click** (or the Menu key / Shift+F10 on a focused button) on a rail instance or a Library card, and the instance page's **⋮** button, open ONE menu (`openInstanceMenu`): Play, Open, Rename…, Open folder, Verify files, Move up / Move down / Move to top / Move to bottom, **Delete…** (red, last). The main "Reminth" instance's Delete is shown **off with the line "This is your main instance - it can't be deleted."**; a running instance can't be renamed or deleted ("Close the game first."). Stays inside the window, arrows/Home/End/Enter, Esc gives the focus back, closes on a click outside, scroll, blur or resize. **Rename…** = a name field (normal instances:update). **Delete…** says what goes: "<name> - 2 worlds, 1.4 GB. Everything inside it is deleted for good (worlds, mods, screenshots). There's no undo. Your other instances are not touched." (`instances:summary` in main: worlds = `saves/*/level.dat`, bytes with a 1.5 s cap → "about", links/junctions never followed). After deleting: the last played instance is selected, every list redrawn, "<name> deleted." The old static ⋮ dropdown is gone (its Open folder / Verify files / Delete are in the menu). | `renderer.js`, `pure.js` (`instanceMenuItems`, `summaryText`), `instances.js` (`summary`), `main.js` (`instances:summary`, one shared delete path), `preload.js`, `index.html`, `styles.css` |
| 2 - moving instances | **Drag** a rail instance: it dims, a thin line shows where it lands, Esc or dropping outside the rail cancels, a long rail scrolls by itself at its top/bottom edge; selection and running state never change. The menu's Move up/down/top/bottom do the same (the impossible ones are off). Saved by `instances:reorder` (atomic, registry lock, refused unless the ids are exactly the instances there are - the old order stays); the main instance may move too; new instances still go at the **end**. Library > Instances sorts by **"My order"** by default (the other sorts stay) and shows each instance's size on disk (worked out lazily while Library is open, kept for the session). | `renderer.js` (`railDrag*`, `moveInstance`, `saveInstanceOrder`, Library), `pure.js` (`moveIndex`, `moveItem`, `dropGapToIndex`), `instances.js` (`reorder`, `normalise` keeps the saved order), `main.js`, `preload.js`, `styles.css` |
| 3 - no surprise instances | **One question** before every instance the player didn't ask for in the New instance dialog (`confirmNewInstance`): "Reminth will make a new instance: <name> - Minecraft <v> <loader>. Your other instances are not changed." Create / Cancel - or, when an instance is already on that version and loader, **"Use <that>"** first and "Make a new one" second. Used by server Play's vanilla instance (both of its ways in - before, the "vanilla" choice after the mods question made one without asking). The version picker's new-instance card (prompt 11) shows the same sentence and offers "Use <instance>" there. **No two instances with the same name + version + loader**: " (2)", and the question says so (one rule in `pure.uniqueInstanceName`, used by `instances.create`). **madeFor** (cleaned, max 60 chars, text only): the server's name or "Copy of <instance>", shown under the instance name ("Made for Hypixel" / "Copy of Survival"). **Undo**: a toast button (~10 s) after the version picker made a new instance and its window was closed without playing; main deletes it only if never played and no world in `saves/`. | `renderer.js` (`confirmNewInstance`, `toastWithAction`, `offerUndoCreate`, madeFor line), `features.js` (server Play, picker), `pure.js` (`createSentence`, `reusableInstance`, `uniqueInstanceName`), `instances.js` (`madeFor`, `cleanMadeFor`, `undoAllowed`), `main.js` (`instances:undoCreate`, madeFor on copies), `index.html` (toast button), `styles.css` |

Tests: `test/instance-menu.test.js` (new, 8): menu items for a normal / main / running / first / last instance,
moves and drag gaps, summary text, the creation sentence and reuse, `cleanMadeFor` / `uniqueName` / `undoAllowed`,
`reorder` round trip through the registry file + refusals + new-at-the-end + the main instance moving, `summary` on a
temp folder (worlds, bytes, a junction not followed, the time cap), and an **audit of every `createInstance` /
`copyInstanceToVersion` call** in the renderer (each must be in the New instance dialog, the picker, or a function
that asks `confirmNewInstance`). `test/perf-profiles.test.js` (+1): `instances:undoCreate` on a fake Electron.
Clicked through in headless Chromium: right-click menus (rail, Library, ⋮), keyboard, Move to top, Shift+F10,
the delete numbers, drag with the line, "My order" with sizes, the question with and without an instance to use,
Undo and its call, "Made for".

### Prompt 11 ("I pick a version and some mods still don't fit… stop creating me a million instances")

| Job | What it does now | Files |
|---|---|---|
| 1 - say what happens first | The version list is ranked by the fewest mods without a build, then the newest (versions a checked server takes first). **Best 5** shown, "Show more versions" for the rest. A green line on top: "Best match: 1.21.1 — all 29 mods fit" or "Fits most: 1.21.4 — 3 mods have to be turned off". For the version picked (and again on the confirm step) every mod sits in one plain group: **Will work (N)**, **No build for <v> (N)** "They can't work with the rest on <v>, so they will be turned off (you can turn them on again)" / "…left out of the copy", **Not from Modrinth, Reminth can't check these (N)** "kept as they are, unless the file itself says it can't run on <v> — then it is turned off" / "left out of the copy", **Couldn't be checked just now (N)**. Lists of more than 6 names are collapsed. A one-line help text says what a "build" is. The advisor now counts **stable** versions only (a beta-only mod is "No build", because the switch never installs a beta). | `pure.js` (`rankVersionRows`, `bestLine`, `modGroups`, `compareMc`), `features.js` (`openVersionAdvisor`), `compat.js` (`supportedReleases` stableOnly for the advisor), `styles.css` |
| 2 - two clear choices | The confirm step has two radio cards: **"Switch this instance to <v>"** ("Your mods are updated to fit. Mods with no build for <v> are turned off (you can turn them on again). Your worlds stay. A backup of every replaced mod is kept.") and **"Keep this one as it is and make a new instance on <v>"** ("Nothing here changes. It uses more disk space; worlds are not copied."). Recommended: switch for the same or a newer version; a new instance is the only choice (with one plain sentence why) for an **older version while the instance has worlds**, a **modpack** instance, or a **running** game. The new-instance card says "Reminth will make a new instance: <name> — Minecraft <v> <loader>. Your other instances are not changed.", never repeats an existing name (" (2)"), and offers **"Use <instance>"** when one is already on that version and loader. A server that started the flow still joins afterwards in both cases. **Switch** runs in the main process (`compat:switchVersion` → `versionSwitch.js`): checks (running, modpack, vanilla, same version, older-over-worlds), which mods have no stable build there + the loader version (any failure: nothing changed), `.reminth/version-change.json` (atomic), the instance update (registry queue), the stable-only swap (modsSync, replaced-mods backup), every mod still without a build **renamed to .disabled** (never deleted) with its reason; a failure after the update comes back as "…is now on Minecraft <v>, but updating its mods stopped: … Press 'Update mods to fit <v>' to finish." with the note kept. | `versionSwitch.js` (new), `main.js`, `preload.js`, `compat.js` (`adviseVersions` `target`: files of the mods without a build), `content.js` (`setOffReason`), `pure.js` (`versionChoices`), `features.js` |
| 3 - result screen | Same window: "Done — <instance> is on Minecraft <v>." with **Updated (N)**, **Already fitting (N)**, **Turned off (N)** (each: name, the reason in plain words — "no version made for 26.3" / "no finished (stable) version made for 26.3 yet" / "its own file says it can't run on 26.3" — and **Find a replacement** (Discover's mod search with that name, this instance selected) + **Turn on anyway** (the game may not start)), **Not checked (N)**. One big **Play** (or "Play <server>"), a small Close. The Mods tab's Off group shows "Turned off by Reminth: <reason>" under those mods; the reason is kept in `.reminth/content.json` (`turnedOff`, atomic, locked) and dropped when the player turns the mod on or removes it. | `features.js`, `content.js` (`setEnabled`/`remove` clear it, `listAll` gives `offReason`), `styles.css` |
| 4 - plain words | Dialog: **"Pick a Minecraft version for my mods"**, with an intro line ("See what happens to each of your mods on another Minecraft version. Nothing changes until you confirm."). Buttons: **"Pick a version that fits my mods"** (Mods panel, the "no build" window, the "No build yet" window) and the Mods toolbar's **"Pick a version"** (was "Version check"). The "no build" window and the What's new line rewritten; "Reminth-managed" badge → "Added by Reminth". The Play question ("Minecraft won't start like this") adds one line naming mods with no version for this Minecraft **or anything newer**: "picking another version won't help them — they have to be turned off to play (Fix and play does that)". | `features.js`, `renderer.js` (What's new), `index.html`, `styles.css` |

Tests: `test/version-flow.test.js` (new, 9): ranking/best line (perfect, partial, none, server), the groups per
action, the choices (newer/older/same × worlds × modpack × running), `switchVersion` with stubs for each failure
point (no loader build, update fails, swap stops half way) checking that every file is still there, and the
turned-off reasons (set, cleared on enable/remove, on disk). Clicked through in headless Chromium with a fake main
process: list + best line + groups + "Show more", both choice cards for a newer and an older-with-worlds version,
the switch call, the result screen, "Turn on anyway", "Find a replacement" landing on Discover with the name, the
Off-group reason, the Play-gate line, the renamed buttons.

### Prompt 9 ("may not work" mods crash the game - AppleSkin for 26.3 on 26.2)

**Why the panel said "may not work" but nothing acted on it:** compat's `judgeMod` only warned "listed for
Minecraft X, not Y" when the jar's own `fabric.mod.json` didn't settle it. A build whose own range lets 26.2
load it but that Modrinth lists ONLY for newer versions (26.3) was let through - that is exactly the
AppleSkin crash (code compiled against 26.3 asks 26.2 for a field it doesn't have, on the first HUD draw).
Such a build is now a "may not work" warning too. The old rule stays for builds listed only for OLDER
versions with a range that reaches forward (the existing test is unchanged).

| Job | What it does now | Files |
|---|---|---|
| A - fit button | Every "listed for another Minecraft version" warning is marked (`listedElsewhere`) and counts for **"Update mods to fit 26.2 (N)"**, the edit notice and the one-click swap: same stable-only `planSync` path, same `.reminth/replaced-mods` copy, same "No 26.2 build yet" list (switch off / advisor / leave) when there is no stable build of exactly this version + loader - never deleted. The panel's "Fix all" already applied these mods' own (stable-filtered) "Switch to" fixes. Reminth's own jars still never reported or touched. `planSync`/`applySync`/`mods:sync` take an optional file list. | `compat.js` (`judgeMod`, `builtForNewerOnly`, `modSetOf`), `modsSync.js` (`syncCandidates`, `files` option), `main.js`, `preload.js`, `features.js` (`syncCount`, notice text) |
| B - Play warning | When there are no blocked mods but "may not work (built for another version)" ones, Play from **every** entry (instance page, Home hero, Home cards - all go through `compatBeforePlay`) shows **"These mods may crash the game"**: "N mods are built for another Minecraft version and may crash the game: <names>", the rows, a **"Don't ask again for this instance"** tick box, and Cancel / Play anyway / Fix and play. Play anyway remembers nothing. The tick (with Play anyway) stores the fingerprint of the switched-on mods (`skipModWarning`, instance registry, atomic write); `compat:check` drops it as soon as the mods differ. Fix and play = the fit swap for just those files; mods without a stable build are named and the dialog stays open (Play anyway / Cancel). Blocked mods keep "Minecraft won't start like this" and win when both kinds exist. | `pure.js` (`modWarning`, `riskyText`), `features.js` (`riskyBeforePlay`), `instances.js` (`skipModWarning`), `main.js` (`compat:skipModWarning`, clearing in `compat:check`), `preload.js`, `styles.css` (`.gate-skip`) |
| C - after a crash | On every game exit main.js reads the **newest crash report written since that launch**, only from `<instance>/crash-reports`, never through a link, first 512 KB, nothing in it used as a path. `crashReport.js` parses Description, the error line and the first stack frames (until "A detailed walkthrough") and names a mod only when exactly one matches: a frame in a package that mod's own code uses (content.js now reads `packages` from `fabric.mod.json` entrypoints + mixin configs' `package`), a Forge/NeoForge frame `TRANSFORMER/<modid>@…/`, a Mixin handler `handler$…$<modid>$…`, or a Mixin error "from mod <id>". Two mods tied, Fabric API / loader / one of Reminth's own jars on top, or no match → nothing is said. The finding goes to `.reminth/crash-finding.json` (atomic; ignored once that jar changes; a report already told isn't told again; a clean exit (code 0, no new report) forgets it). The panel shows the mod as **"Crashed the game"** with its fix; the window gets a toast and a dismissible notice on the instance page: "The game crashed in AppleSkin (appleskin-fabric-mc26.3-3.0.10.jar). It is built for Minecraft 26.3 and this instance is on 26.2." with **Fix it** (the stable swap for that one mod, when the check has a stable build) or **Switch it off**. | `crashReport.js` (new), `content.js` (`modPackages`, `packageOfClass`), `compat.js` (crash finding → issue, `managedNames` exported), `main.js` (`noteCrashReport` from the exit handler), `preload.js` (`onCrashCulprit`), `features.js` (`compatTag`, crash notice), `index.html` (`#instCrashNotice`) |

Tests: `test/may-not-work.test.js` (new, 15): AppleSkin-shaped real jar (outer jar listed for 26.3, range
`>=1.21.9` that 26.2 satisfies) through `checkInstance`, the fit plan (stable swap, beta-only → "no build",
only-some-files), the Play rule and sentence, the registry field, the parser on the real report + a Mixin
error + no mod frames + a cut-off file, ties / Fabric API / Reminth's jars / Forge frames, the report finder
(older, too big, a link), the "Crashed the game" issue. `test/perf-profiles.test.js` (+2, real main.js on a
fake Electron): the "don't ask again" IPC and its clearing; a crash report after a game exit → finding written
and `play:crashCulprit` sent, a clean exit forgets it. All existing tests unchanged.
Clicked through in headless Chromium with a fake main process: button count includes the "may not work" mods,
the Play dialog (text, tick, buttons, "don't ask again" honoured for the same mods and asked again when they
change), the crash toast + notice + "Crashed the game" tag, Fix it calls the one-file swap.

### Prompt 8 (Home stat cards)

The five Home stat cards (Mob kills, Player kills, Deaths, Blocks placed, Blocks broken) lost their thin
coloured strip on the left edge (`.stat::before`, drawn from `--sc`). Kept: numbers, labels, notes, size and
the soft corner glow (`.stat::after`). New: the same hover outline as the "Jump back in" cards - border colour
becomes accent at 28% on hover and on focus-within, `.16s`, no movement, no shadow, no scale. `.recent` itself
is untouched. `.stat`, `.s-*` and `--sc` are used nowhere else (searched CSS, HTML, all renderer JS: Player
Statistics page, streamer page and bar lists don't use them), so nothing needed scoping. Only
`src/renderer/styles.css` changed (LF in git; the last rule is still last). Checked in headless Chromium:
`::before` is gone, `::after` glow still there, transition `border-color 0.16s`, hover border = accent 28%.

### Prompt 7 (Settings > Check for updates showed the wrong number)

The packaged 1.4.0 said "You're on the latest version (1.1.1)": the up-to-date state carried the newest
version in GitHub's feed (the only published release is 1.1.1). Now it carries the **running** version
(`app.getVersion()`), whatever the feed says (newer → still "Downloading <new>…" as before; equal, older or
missing → "You're on the latest version (<running>)"). The feed's number is kept as `feedVersion` (not shown,
for diagnostics; the updater log still writes it). Settings now prefers `currentVersion`. Every other state
and message is unchanged.

| Files | |
|---|---|
| `src/main/updater.js` | `update-not-available` → `version: app.getVersion()`, `feedVersion` |
| `src/renderer/renderer.js` | the "up-to-date" Settings line prefers `currentVersion` |
| `test/updater.test.js` | +2 tests: feed equal / older / missing / no version → running version; feed newer → downloading the new one |

### Prompt 6 (window still small after a fullscreen game)

The desktop window measured it: at game **start** Windows shrinks Reminth's window to 800x552 but leaves it
flagged maximized (IsZoomed TRUE, `isMaximized()` true, title bar shows "restore"), so prompt 5's fix
never acted. Now, once no game runs (game end, or the window's focus/restore), a window that was maximized
when the game started, still says maximized, but doesn't fill its display's work area
(`screen.getDisplayMatching(bounds).workArea`; full = width and height at least work area + 16 - 24 px) is
**unmaximized then maximized**, then `window:maximized` true is sent. Once per game end (the snapshot is
dropped before anything runs, and `repaired` blocks a second go). Also applied after a "launch minimized"
window is restored, since that comes back flagged maximized too. One line goes to
`%APPDATA%\Reminth\main-errors.log`: `window: After a game the window said maximized but was 816x568;
repaired to 1936x1048.` (sizes are the outer rectangle, so 816x568 = the 800x552 client area).

| Files | |
|---|---|
| `src/main/windowRestore.js` | `fillsWorkArea(bounds, workArea)` (new, pure), `afterGame` takes `boundsFillWorkArea` + `repaired`, new action `"repair"` |
| `src/main/main.js` | `windowNow()`, `restoreWindowAfterGame()` runs the repair and logs it |
| `test/window-restore.test.js` | +5 tests (12 now): bounds rule, repair / full / not maximized / game running / already repaired |
| `test/perf-profiles.test.js` | fake window gets `getBounds`, fake screen `getDisplayMatching`; 3 more scenarios through the real main.js (repair + log line + only once; full = nothing; launch-minimized + small) |

### Prompt 5 (two bugs the desktop window found)

| Bug | Fix | Files |
|---|---|---|
| 1 Home hero stayed on the old instance after starting another | `startGame` now **awaits** saving `lastPlayed` (a failed save still starts the game) and only then sends `play:started` (now with `startedAt`); if the game already ended during the save, no `play:started` is sent. The page marks the instance played at once (`pure.markPlayed`), re-renders the hero, then still reloads the list. | `main.js`, `renderer.js` (`onPlayStarted`), `pure.js`, `test/home-play.test.js`, `test/perf-profiles.test.js` |
| 2 Window not maximized after a fullscreen game | At launch main.js remembers `{ wasMaximized, minimizedByUs }` (first game wins if several run). When the last game ends, and on the window's `focus`/`restore` events, `windowRestore.afterGame` decides: **wait** while any game runs; a self-minimized window ("launch minimized") is restored - maximized if it was; a window the player minimized is left alone until they bring it back, then maximized; a window that wasn't maximized is never touched. `window:maximized` is sent after. | `main.js`, `src/main/windowRestore.js` (new), `test/window-restore.test.js` (new, 7), `test/perf-profiles.test.js` |

### Prompt 4

| Step | What it does now | Files |
|---|---|---|
| Job 0 - Play on Home cards | The Play button sits inside the card's text strip (name/meta left, Play right), no longer floating over the picture. Meta capped at 2 lines; all cards the same height. | `renderer.js` (`recentCard`), `styles.css` |
| Description renderer | New pure module. Markdown + the HTML Modrinth authors use (headings, bold/italic/strike, code, quotes, lists + task lists, tables with alignment, `<details>`, `<center>`, `<br>`, `<img>`, `<a>`, `<iframe>`) → a tree of plain objects → DOM with `createElement`/`textContent` only (**no innerHTML anywhere**). Links: https only, no user:password, no backslashes, max 2048 chars; `/path` → modrinth.com; a link whose text shows another host gets "(real host)" next to it. Pictures: only `cdn.modrinth.com` and `avatars.githubusercontent.com`, everything else → **"Image hosted elsewhere"** box with an "Open in browser" link. YouTube/Vimeo embeds → a "Video" link card. Caps: 200 KB of text (then "Read the rest on Modrinth"), depth 8, 20 000 nodes, tables 200x20, 1000 list items, **120 ms** parse time. | `src/renderer/markdown.js` (new), `test/markdown.test.js` (new, 22 tests) |
| One IPC for the page | `catalog:projectPage` returns project + people + versions + the parsed description in one answer. Cached 5 min (by slug and id, 30 projects), failures never cached, ids checked. Team/organisation and the version list are best effort (page says when missing). Changelogs kept for the newest 50 builds (20 000 chars each). Goes through `modrinth.js` (its retries and rate-limit waits). **Fixed during testing:** Modrinth ids are case-sensitive; the first version lower-cased them before asking. `link:open` opens a link in the default browser after checking it again in the main process. | `src/main/projectPage.js` (new), `main.js`, `preload.js`, `test/project-page.test.js` (new, 9 tests), `test/perf-profiles.test.js` (+1) |
| Page rules | `fitsInstance` ("Fits your instance X (1.21.4 Fabric)." / "Only a beta build fits..." / "No build for 1.21.4 Forge yet." / vanilla needs a loader / modpacks install as their own instance), `collapseVersions` (300 versions → "1.21–1.21.11", "26.1–26.3", snapshots only counted), `buildConfirmText` (beta/alpha question naming the channel). | `src/renderer/pure.js` |
| The page | Click or Enter on a Discover result opens the page **inside Discover**. Header: icon, title, summary, people with avatars (owner first, or the organisation), downloads, followers, updated, client/server, categories, license (clickable when it has a URL), Install (same paths, same running-instance guard as the cards; mods also get the version chooser). Support card: fit line, loaders, Minecraft ranges. Tabs: **Description** (credit line "Description by the project's author, shown from Modrinth."), **Gallery**, **Versions** (30 at a time + "Show more"; changelog parsed when a row opens; per-row Install, off when the build doesn't fit the instance; beta/alpha ask first, naming the channel), **Links** (source, issues, wiki, Discord, donations, View on Modrinth). **Back / Esc / mouse Back button** return to the results with search, filters, page and scroll exactly as they were (the list is only hidden, never rebuilt). Skeleton while loading, error box with Retry, a late answer for a project you already left is dropped. | `features.js` (section 10 + `projectRow`), `index.html` (`#projectView`, `markdown.js` script), `styles.css` (`pv-*`, `md-*`, before the last rule) |
| Entry from installed mods | Mods/packs rows that Modrinth knows get **"Open project page"** in their ⋮ menu. Back then says "Back to <instance name>" and returns to the instance page. | `features.js` (`rowMenu`, `openProject`/`closeProject`) |

Not added: the suggested-mods window does not open project pages (it's a modal with its own tick list;
opening a page from inside it would need it to close and reopen with its ticks kept - not small).

---

**JEI first-inventory-open stutter (owner report, 4 Oct; fixed for him by switching JEI off).** Measured with the test mod opening the inventory by itself 3/8/15/25 s after joining, JEI 30.39 on vs off, owner's 32 mods, singleplayer: worst frame in the 4 s after opening = 52-59 ms with JEI, 35-50 ms without. So JEI costs about ONE extra 40-60 ms frame here, not the ~1 s the owner feels; the one-second hitch was NOT reproduced (the test has no server, no full real inventory). Nothing to fix from Reminth's side found. Next step if it matters: ask the owner whether the hitch also happens 30 s after joining (then it's not start-up work).


**JEI freeze - found and fixed in ReminthHUD 1.2.0 (4 Oct).** JEI loads all recipes on the RENDER thread ("Starting JEI took 1.2-1.6 s" in latest.log) and starts when the server's recipe-update packet arrives (JeiLifecycleEvents.AFTER_RECIPES_UPDATED, fired by JEI's own mixin). Servers that don't send it (probably DonutSMP) leave JEI waiting for the first AbstractContainerScreen (ClientLifecycleHandler's ScreenEvents.AfterInit fallback) = the first inventory open. `JeiEarlyStart.java` fires that same event 30 ticks after joining if no recipe update came (JEI reached by reflection, no dependency; `jeiEarlyStart:false` in config/reminthhud.json turns it off). Verified: singleplayer = JEI starts once by itself, the helper stays out; forced test run = helper fires, JEI starts ("started JEI early"). NOT verified on a real server: owner's first-inventory-open on DonutSMP is the test (step B5). JEI's "Show Tag Recipes" setting does NOT shorten the start-up (1.46-1.57 s off vs 1.54-1.60 s on).

**Unreleased (committed, not in 1.4.3):** ReminthHUD is switched on once for every Fabric/Quilt instance (`src/main/hudDefault.js`, marker `hud-on-by-default.json` in %APPDATA%\Reminth). Needs a release (1.4.4, built, together with HUD 1.2.0 and the JEI early start).

## 2. Decisions the owner must make (recommendation first)

D1. **No more install-folder chooser** (one-click per-user installer). It's the price of no admin prompt; every
   big launcher (Modrinth App, Discord, VS Code user setup) does the same. **Recommend: keep.**
D2. **Boost FPS changes 5 video settings on the owner's instance and can make the view shorter** (16 → 12
   chunks). It only happens on his click, after the list, with undo. **Recommend: keep 12** (servers usually
   send 8-12 chunks anyway); see the outdoor numbers in section 1 for 10 vs 12.
D3. **Not added to the performance pack: More Culling + BadOptimizations** unless the outdoor numbers in
   section 1 show a clear gain; they stay as Max-FPS "extras" the player ticks. **Recommend: follow the numbers.**
D4. **Xaero's Minimap costs the owner ~15 % FPS** in the indoor test. It's his mod; Reminth says nothing about
   it. **Recommend: tell him, change nothing.**
D5. **Privacy text: no new sentence.** The HUD reads Windows' own CPU/GPU counters inside the game and sends
   nothing; Boost FPS edits a local file.

P13-1. **The in-dialog "Update mods to fit" can open the usual "No <v> build yet" window on top of the picker** when
   some mods have no stable build (same as the yellow button). **Recommend: keep** - one behaviour everywhere.

P12-1. **The lifetime counter can't be changed from the page** (no reset button, a settings save ignores it).
   If the owner wants a "Reset" later, it's one store function. **Recommend: keep** (it's the "official" total).
P12-2. **The picker's confirm step waits for the exact preview before Switch can be pressed** (a few seconds on a
   big instance) - the price of the promise always matching the result. **Recommend: keep.**
P12-3. **Privacy text: no new sentence.** The counter is a number in settings.json on the PC; the preview uses the
   same Modrinth lookups already listed.

P10-1. **Undo is offered only after the version picker made a new instance and was closed without playing.**
   A server's instance is played straight away (Play sets "last played"), so Undo can never apply there - its
   menu has Delete. **Recommend: keep.**
P10-2. **Installing a modpack doesn't get the extra question**: the player pressed Install on a modpack, which is
   asking for a new instance. It does get " (2)" for a repeated name. **Recommend: keep.**
P10-3. **The ⋮ button on the instance page now opens the same menu as a right-click** (Play, Rename, Move…, Delete
   …); Verify files and Open folder moved into it. **Recommend: keep** (one menu everywhere).
P10-4. **Library's default sort is "My order"** for players who never picked one; anyone who chose another sort
   keeps it. **Recommend: keep.**

P11-1. **Switching turns off EVERY mod the dialog listed under "No build for <v>"** - also one whose own file
   claims it would still load (the dialog promised it, and those are the ones that crash later). **Recommend:
   keep**; "Turn on anyway" is one click per mod on the result screen and in the Mods tab.
P11-2. **The advisor now counts stable versions only.** A mod with only a beta for <v> is "No build for <v>" and
   gets turned off by a switch (it was "fits" before, then left out by the copy anyway). **Recommend: keep** -
   matches the "never a beta without asking" rule.
P11-3. **Switching to an OLDER version is allowed when the instance has no worlds** (the prompt only forbade it
   with worlds); the main process counts `saves/*/level.dat` again before changing anything. **Recommend: keep.**
P11-4. **The Mods toolbar keeps a "Pick a version" button** (renamed from "Version check") next to the panel's
   button: it's the only way in when the panel isn't showing (no problems). **Recommend: keep.**
P11-6. **A switch that stopped half way is finished with "Update mods to fit"**, not undone automatically.
   `.reminth/version-change.json` keeps the old version and loader version for a manual undo; there is no
   "Undo switch" button. **Recommend: keep for now**; add one later if testers hit it.

P9-1. **A build listed only for NEWER Minecraft versions is now "may not work" even when its own file says it
   fits** (this is what makes AppleSkin show up and get swapped). It can also flag a mod that really works
   (a loose range that happens to be right). It is only a warning plus a stable swap - never blocked, never
   removed. **Recommend: keep** - the crash showed the jar's own range can't be trusted in that direction.
P9-2. **"Don't ask again" is stored only when ticked AND Play anyway is pressed** (Cancel or Fix and play
   with the tick ignore it - after a fix the mods are different anyway). **Recommend: keep.**
P9-3. **The quick check can't see these warnings.** When the full check hasn't answered within 2.5 s at
   Play (a big instance's first check), the jar-only quick check decides, and it doesn't know what Modrinth
   lists - so the "may crash" question is skipped that one time. Blocked mods are still caught. **Recommend:
   keep** (Play is never held up longer); the panel and button show them as soon as the full check ends.
P9-4. **Privacy text: no new sentence needed.** Crash reports and mod files are read on the PC only;
   nothing new is sent anywhere (the Modrinth lookups are the ones already listed).

0. **New: with "launch minimized" on, Reminth now comes back on screen when the game ends** (prompt 5
   asked for this: "restore it to what it was when the game ends"). Before, it stayed minimized in the
   taskbar. **Recommend: keep** - it's what the prompt asked; if the owner dislikes the window popping up
   after quitting a game, the one place to change is `windowRestore.afterGame` (return "wait" for the
   `minimizedByUs` case).

2. **Description parsing happens in the main process** (prompt said "renderer"): a huge description costs
   the main process up to 120 ms once per 5 minutes per project, never the window. **Recommend: keep.**
3. **Relative links (`/mod/sodium`) go to modrinth.com** (that's where Modrinth itself sends them).
   **Recommend: keep.**
4. **Per-version Install is off when that build doesn't fit the instance Discover shows** (instead of
   offering to install a wrong-version jar). **Recommend: keep.**
5. Still open from prompt 3 (unchanged): no page
   fade on Skins (**keep if 33 shows it faster**); Mods-tab delete text says Recycle Bin (**keep**); world
   open on old versions just starts the instance (**keep**); shader install needing Iris refused while
   running (**keep**); unsigned installer (nothing to do).

Closed: Home "Time played" = the lifetime total across every instance (owner, prompt 12); prompt 11's "send prompt 10 next" (done); privacy text for project-page pictures and links (made by the desktop window in `194863c`; re-upload
`site/` with the release); privacy text for copies + game report; tied versions stay warnings; all replaced jars copied;
Forge/NeoForge pack ON for new instances; profile on never-played instance writes options.txt;
wrong-loader mods count for "Update mods to fit"; six extra-mod slugs.

---

## 3. Known weak spots (say them, don't hide them)

- **Desktop batch (3 Oct evening):** the migration away from `C:\Program Files\Reminth` has not run for real
  (R2). If the owner says No to the one Windows prompt, the old copy and its public shortcut stay, and starting
  Reminth from that shortcut runs the old version, which updates itself again (asks again). Pinned taskbar
  icons point at the old path and break once it's removed - pin again.
- Boost FPS's dialog was never clicked in Electron (only unit tests on real files and the owner's real
  options.txt read-only). The HUD on 26.3 was compiled but not run in a game.
- FPS numbers were taken with Roblox and Medal running; no clean-PC number exists. The 350 FPS target was not
  measured on the owner's real setup (fullscreen, his server).

- **Prompt 12 never ran in Electron.** The counter was tested on a throwaway settings.json and through main.js on
  a fake Electron (a session's end adds to it and tells the page); the picker parts in headless Chromium.
- The lifetime counter starts from the instances' recorded time on first start: time from instances deleted
  BEFORE this version can't be recovered (it was never stored anywhere else).
- The confirm step's preview asks Modrinth again; the switch a moment later asks too. If Modrinth's answer changes
  in between (a mod releases a build that minute), the two can differ - the result screen always shows what
  really happened.

- **Prompt 11 never ran in Electron or against real Modrinth.** `switchVersion` was tested with stubs for
  Modrinth, the loader lookup and the registry, on real files; the dialog with a fake main process.
- The switch asks Modrinth twice (the advisor lookup for the target, then the swap's own check). Both are cached
  for minutes, but on a slow connection a 29-mod switch can take a while - not timed.
- "Turn on anyway" on the result screen assumes the file is `<name>.disabled` (what the switch just made); if
  the player renamed it meanwhile it says the file isn't there.
- **Prompt 10 never ran in Electron.** Drag and drop was driven with a mouse in headless Chromium (3 instances);
  30 instances and the edge auto-scroll were not tried. Right-click on Windows (and the Menu key on a real
  keyboard) not tried.
- The delete question's numbers come from a walk of the folder capped at 1.5 s - a huge instance says "about".
- Undo deletes for good (like Delete); it is only offered for an instance that was never played and has no world.

- **Prompt 9 never met a real crash or real Modrinth.** The crash parser was tested on the report text from
  the prompt (head only) and made-up Mixin / Forge shapes; real reports from other mods may name nobody
  (by design: no match → nothing said). Mods whose code isn't in an entrypoint or mixin package (pure
  libraries, Kotlin objects, some Forge mods - Forge jars aren't read for packages, only Forge frames that
  name their mod) can't be named.
- AppleSkin's real `fabric.mod.json` range wasn't checked (no network here). If it declares a range that
  EXCLUDES 26.2 it was already "won't load" (blocked) and the old button handled it; the prompt says the panel
  showed "may not work", which this covers either way.
- A game that crashes and is restarted within 2 s of the report could see the same report twice - handled by
  remembering the report name in the finding.

- **The window repair (prompt 6) has never run on Windows.** It follows the measured state exactly and the
  repair the desktop window did by hand (unmaximize + maximize), but if Windows reports the small window's
  bounds differently from `GetWindowRect` the size check could miss it - the log line shows whether it ran.
  On a second monitor the work area of the monitor the window is on is used. `win.restore()`/`maximize()` after a game may bring
  Reminth to the front - intended, untested.
- The window snapshot is taken when the game process is spawned. If Windows changed the window before
  that (it shouldn't - the game has no window yet), the snapshot would be wrong.

- **Nothing of prompt 4 has met real Modrinth.** Real descriptions use HTML in ways the tests may not cover
  (nested tables, `<p align>`, odd entity use). Worst case is ugly text, never script: the parser can only
  produce the node types listed above.
- A description that is one giant table or thousands of images: capped, but the page has not been timed
  on a slow PC.
- Version list: up to 3000 builds are sent in one answer (~a few hundred KB for the biggest projects like
  Fabric API); not measured.
- Back to an instance page restores its scroll right away, but the mod list reloads, so the position can
  be off by a little.
- The "Fits your instance" line uses the instance Discover is showing; per-row Install fixes the target at
  the click.
- From before: no FPS number ever measured; Skins speed-up unmeasured; world-direct-open and IPv6 joins
  never tried in a real game; "Last played" written at launch; safe mode misses `javaw` dialogs; the update
  path has never seen a real release.

---

## 4. Test plan for the desktop window (in order)

Don't touch the screen while the owner plays. Use throwaway instances. Report PASS/FAIL per step with what
you saw; stop and report on any FAIL that risks his files.

### Basics
1. `git pull`, `npm install` if needed, `npm test` → **564 pass**. Report any Windows-only failure verbatim.
   Check `styles.css` still ends with the `background-origin` rule and CRLF files are still CRLF.
2. `npm start`; keep DevTools console and `%APPDATA%\Reminth\main-errors.log` open throughout. Any red line = FAIL.

### Desktop batch, 3 Oct evening (ping, HUD, Boost FPS, updates) - test with 1.4.2
B1. Discover → Servers: the ping badges are lower than before (hypixel ~150, cubecraft ~40 here) and agree within
    a few ms with Minecraft's own multiplayer list for the same server. Hover: "…measured the way Minecraft's own
    server list does".
B2. Instance settings → ReminthHUD on → Play: top-right bar `FPS | GPU % | CPU % | LAT ms`, coordinates line under
    it, nothing over a minimap. GPU roughly matches Task Manager's GPU column. LAT 0 in singleplayer, a real number
    on a server. **H** hides/shows. A potion effect: the bar moves below the icons. `config/reminthhud.json`
    with `"gpu": false` → the GPU item is gone and the bar closes up. F3 open → the HUD hides (F3 shows the
    same). A server with `reducedDebugInfo` → no coordinates line. Same on a 26.3 instance.
B3. Right-click an instance → **Boost FPS…** → the list of from → to; Cancel changes nothing; **Change them** →
    toast; options.txt shows the new values, everything else identical; `.reminth/options-before-boost.json`
    exists. Open again → "already has the fast settings" + **Put my old settings back** → the old values return.
    With the game running: the entry is greyed out with "Close the game first."
B4. While a game runs, the launcher's looping animations (Plus page, progress shimmer) stand still; they move
    again after the game closes.

B5. **JEI (switched ON) on DonutSMP (or another server): join, then open the inventory for the first time** - no freeze. `logs/latest.log` has "ReminthHUD: started JEI early" about 1.5 s after joining, and "Starting JEI took" appears BEFORE the first E. In singleplayer JEI starts by itself and the helper line is absent.

### Release 1.4.2
R1. **Done by the desktop window:** `npm test` (582), bump to 1.4.2, `npm run dist`, check `dist/latest.yml` has no `isAdminRightsRequired`.
R2. **The migration, on the owner's PC, before uploading:** close Reminth, run `dist\Reminth-Setup.exe` by hand →
    a small "Installing" box (no wizard), then Windows asks ONCE (that's the old copy being removed) → Yes →
    Reminth opens from `%LOCALAPPDATA%\Programs\reminth-launcher`; `C:\Program Files\Reminth` is gone; one
    "Reminth" on the desktop and in Start; instances, worlds, sign-in, settings all still there.
R3. Upload the release (installer + `latest.yml` + `.blockmap`).
R4. When 1.4.3 exists: Settings → Check for updates → download → **Restart and update** → no Windows prompt, no
    installer window, Reminth reopens on 1.4.3.

### Prompt 13 (test these first - it blocks 1.4.1)
W1. A throwaway **Fabric 1.21.1** instance holding the mod files of a 26.2 instance (copy its `mods` folder). Open
    its Mods tab (the panel says "N mods will stop Minecraft from starting"; the yellow button shows a number).
    Open **"Pick a version that fits my mods"** → briefly "Checking your installed mods..." (grey) if the check
    hasn't run yet, then the **amber** line "Builds exist for Minecraft 1.21.1 for all your mods, but N of the files
    in this instance are made for another version. Press "Update mods to fit" to swap them." with an
    "Update mods to fit 1.21.1" button inside the dialog. N equals the yellow button's number. The list below is
    titled "Other versions that also fit", no "Best match" badge, no row selected. **The green sentence is NOT shown.**
W2. Press the button inside the dialog → progress, the usual result toast ("Updated N mods…"), and the amber line
    turns into the **green** "Your mods already fit Minecraft 1.21.1 - there is nothing you need to change." The
    yellow button and the Mods panel behind it agree (hidden / no red panel). Mods with no stable build (if any)
    are listed in the "No 1.21.1 build yet" window and the line stays amber without a button.
W3. A **26.2 instance holding 26.2 files** (e.g. the Reminth copy after M2): the green sentence, no amber line.
W4. An instance where some mod has **no build for its own version**: the best-match line and the ranked list as
    before prompt 12 (green "Best match: …" or "Fits most: …").
W5. An instance with a mod that crashed the game last time (M9's finding present): the green sentence is NOT shown.

### Prompt 12 (test these first)
T1. Note Home's **Time played** before installing this build, and the sum of every instance page's time. After the
    update, Home shows that sum (or more), with the tooltip "All your time in Minecraft through Reminth…".
    `%APPDATA%\Reminth\settings.json` has `totalPlayTimeMs`.
T2. Play any instance for ~2 minutes and quit → Home's Time played grows by ~2 minutes without restarting Reminth.
T3. Delete a throwaway instance that has play time → Home's Time played does NOT go down. Restart Reminth → still
    the same (never recomputed).
T4. Two instances running at once for a few minutes, quit both → both sessions are added.
T5. The instance page's own time and Player Statistics show what they showed before (unchanged).
T6. Version picker on an instance whose mods all fit its version (e.g. the Reminth copy on 26.2 after M2): the green
    line says "Your mods already fit Minecraft 26.2 - there is nothing you need to change.", the list is titled
    "Other versions that also fit", no "Best match" tag, no row picked.
T7. Picker → a version where some mods' own files refuse it (e.g. 1.21.10 with Client Side Crystals) → Next →
    "Checking each mod's own file…" then "Will be turned off (N)" naming each with its reason; the Switch button is
    off until that list is there. Switch → the result screen's Turned off list has the SAME N mods and reasons.
T8. "Update mods to fit (N)" on an instance where some mods have no stable build → after the run the button is
    hidden (or shows only what it can still fix), never the old number. Turn a mod on/off → it counts again.

### Prompt 10 - instance menu, moving, no surprise instances
I1. **Right-click** an instance in the rail → the menu opens next to the pointer, inside the window: Play, Open,
    Rename…, Open folder, Verify files, Move up/down/top/bottom, Delete… (red, last). Arrow keys move, Esc closes
    and the rail button has the focus again. Same menu from a **Library > Instances** card and from the instance
    page's **⋮** button. Tab to a rail button and press **Shift+F10** (or the Menu key) → the same menu.
I2. Right-click the main **"Reminth"** instance → Delete… is greyed out with "This is your main instance - it
    can't be deleted." (shown, not hidden). With the game running on an instance: Rename and Delete are off.
I3. Make a throwaway instance, play it once (create a world), quit. Right-click → Delete… → the question says
    "<name> - 1 world, <size>. Everything inside it is deleted for good…". Compare the size with Explorer's
    Properties of the instance folder (roughly equal). Delete → "<name> deleted.", the last played instance is
    selected, the rail/Library/Home no longer show it, the folder is gone.
I4. **Drag** the bottom rail instance to the top: it dims, a line shows the drop place; drop → it's at the top.
    Drag one and press **Esc** → nothing moves; drag one off the rail and let go → nothing moves. Move up / Move
    to bottom from the menu work; the first/last ones' impossible moves are off.
I5. **Restart Reminth** → the order is the same. Library > Instances shows "My order" (same order) and each
    instance's size. Make a new instance → it appears at the **bottom**.
I6. Discover → Servers → Play a server whose version none of your instances has → the question "Make an
    instance for <server>?" with "Reminth will make a new instance: <server> - Minecraft <v> vanilla. Your other
    instances are not changed." → Create → it is made and joins. Its page shows "Made for <server>". Do it again
    for the same server → it now just joins on that instance (no second one).
I7. With a modded instance active, a server whose version none has → choose "New vanilla <v> instance" → the
    same question appears (before: it made one without asking).
I8. Version picker → pick a version → "Keep this one… make a new instance" → make it → Close the result window
    (don't Play) → a toast "<name> was made." with **Undo** → Undo → "<name> removed.", the instance and its
    folder are gone. Make another, wait 10 s → the toast is gone; the instance stays and shows "Copy of <name>".
I9. New instance dialog with a name that already exists on the same version and loader → it is made as
    "<name> (2)".
I10. One instance only: the menu still opens (all Moves off, Delete off for "Reminth"). Many instances (make ~15
    quick throwaways): the rail scrolls; dragging near its top/bottom edge scrolls it.

### Prompt 11 - "Pick a Minecraft version for my mods" (a throwaway COPY of "Reminth", Fabric 26.2, 29 mods)
V1. Mods tab → **"Pick a version that fits my mods"** (panel) or **"Pick a version"** (toolbar) → the dialog is
    titled "Pick a Minecraft version for my mods", with the intro line and the one-line "build" help. Within a few
    seconds: a green "Best match…" or "Fits most…" line, at most 5 versions, "Show more versions" if there are more.
V2. Pick versions one by one: under the list the groups change (Will work / No build for <v> / Not from Modrinth /
    Couldn't be checked) with names; long lists are collapsed. Write down which mods are listed under "No build".
V3. Pick a **newer** version (e.g. 26.3) → Next → two cards; **"Switch this instance to 26.3"** is selected and
    marked Recommended; the groups are shown again with "will be turned off".
V4. Switch → progress → result screen "Done — <copy> is on Minecraft 26.3." Updated / Already fitting / Turned
    off (each with its reason and two buttons) / Not checked. The Turned-off list = the V2 "No build" list.
    `<instance>\.reminth\replaced-mods\<time>\` holds the replaced jars; nothing missing from `mods\` (turned-off
    ones end in `.disabled`); no `.reminth\version-change.json` left.
V5. Big **Play** → the game starts on 26.3 and reaches the title screen.
V6. Back on the Mods tab: the turned-off mods are in the **Off** group with "Turned off by Reminth: no version made
    for 26.3". Turn one on → the line disappears; turn it off by hand → no line.
V7. On the result screen (do V4 again on another copy): **Find a replacement** → Discover, Mods tab, the mod's name
    in the search box, "Showing what fits" = this instance. **Turn on anyway** → the file loses `.disabled`.
V8. In a copy that has worlds, pick an **older** version (e.g. 1.21.4) → Next → the switch card is greyed out with
    "Your worlds were saved in Minecraft 26.2. Opening them in the older 1.21.4 can damage them…"; only the
    new-instance card can be picked (Recommended).
V9. Make a new instance → the card says "Reminth will make a new instance: <name> - Minecraft <v> Fabric. Your
    other instances are not changed." → it is made, worlds are not copied, its name doesn't repeat an existing
    one, its page shows "Copy of <original>". Open the dialog again on the original, same version → the
    new-instance card now offers **"Use <that instance>"**, and using it makes no new instance.
V10. While the instance's game is running: the switch card is greyed out with "Close the game first…".
V11. A modpack instance: the switch card is greyed out ("Its mods belong to the modpack…").
V12. Play with a mod that has no version for 26.2 or anything newer (an old 1.20.1-only jar): "Minecraft won't
    start like this" shows the extra line "<mod> has no version for Minecraft 26.2 or anything newer, so picking
    another version won't help it — it has to be turned off to play".
V13. Pull the network cable on the Switch click (or while it runs): either "Nothing was changed: …" (before the
    instance moved) or the result screen's "…is now on Minecraft <v>, but updating its mods stopped…" with
    `version-change.json` present; "Update mods to fit <v>" then finishes it. No file deleted in either case.

### Prompt 9 - "may not work" mods (a COPY of the "Reminth" instance, never the real one)
M1. Copy the owner's "Reminth" instance (Fabric 26.2 + AppleSkin `appleskin-fabric-mc26.3-3.0.10.jar` and the
    other 26.3 mods) to a throwaway instance. Its Mods tab: AppleSkin shows **May not work** ("listed for
    Minecraft 26.3, not 26.2…"). The button reads **"Update mods to fit 26.2 (N)"** and N includes AppleSkin
    (and the other "may not work" ones that are listed for another version) - note N before/after vs. the
    old 18.
M2. Press the button → AppleSkin is now the **26.2 build** (file name `…mc26.2…`), the old jar is in
    `.reminth/replaced-mods/<time>/`; anything with no stable 26.2 build is in the "No 26.2 build yet" window,
    nothing deleted. Panel no longer lists AppleSkin.
M3. **Play + join the same server as before** (Home "Jump back in" server card) → in-game, HUD draws, **no
    crash** for 2-3 minutes. (This is the main PASS/FAIL of prompt 9.)
M4. Put the 26.3 AppleSkin jar back (from replaced-mods) in a second copy. Press Play from the **instance
    page**, then from the **Home hero**, then from a **Home card**: each shows **"These mods may crash the
    game"** with "N mods are built for another Minecraft version and may crash the game: AppleSkin…",
    Cancel / Play anyway / Fix and play. Cancel → nothing starts.
M5. Play anyway (no tick) → game starts; quit; Play again → the question comes back.
M6. Tick "Don't ask again for this instance" + Play anyway → game starts; quit; Play → **no** question.
    Switch any mod off or on → Play → the question is back. (`instances.json` has `skipModWarning` while it
    holds.)
M7. Fix and play → AppleSkin swapped to 26.2, game starts.
M8. With one blocked mod (a jar that needs 26.3 in its own range) AND AppleSkin 26.3: Play shows the old
    **"Minecraft won't start like this"** question, not the new one.
M9. **After a crash**: in a throwaway instance keep AppleSkin 26.3, tick "Don't ask again", Play anyway, join
    a server → the game crashes like on 3 Oct. Back in Reminth: a toast and a notice on the instance page
    "The game crashed in AppleSkin (appleskin-fabric-mc26.3-3.0.10.jar). It is built for Minecraft 26.3 and
    this instance is on 26.2." with **Fix it**; the Mods panel shows AppleSkin as **"Crashed the game"**.
    `<instance>\.reminth\crash-finding.json` exists. Fix it → swapped to the 26.2 build, notice gone.
M10. A crash with no mod to blame (e.g. start a world, then end `javaw.exe` from Task Manager → no report;
    or any crash report whose stack shows only Minecraft/Fabric frames) → **no** notice, no toast naming a mod.
M11. Close the game normally after M9's fix → `crash-finding.json` is deleted.
M12. Forge/NeoForge instance: a normal Play and quit → no notice, nothing in `main-errors.log`.

### Prompt 5 - the two bugs
P1. Home shows instance A as hero. Start instance **B** from its page → as soon as the game window appears
    (and certainly within 2 s), Home's hero shows **B** (name, Last played). No manual refresh.
P2. Same with "launch minimized" ON: Reminth minimizes; open it from the taskbar during the game → hero is B.
P3. **(prompt 6 - the main one)** Reminth maximized on the 1920x1080 display, "launch minimized" OFF, game
    set to **Start in fullscreen** → play, quit the game → Reminth's window is **1920x1032 again** (fills the
    screen above the taskbar; measure it the same way as before), title-bar icon shows "restore" (two
    squares), and `%APPDATA%\Reminth\main-errors.log` has one new `window: After a game the window said
    maximized but was ...; repaired to ...` line. Play and quit a second time → same, again one line.
P4. Same with "launch minimized" ON → when the game ends Reminth comes back on screen **maximized at full
    size** (1920x1032), not 800x552.
P5. During the game Reminth never pops up, resizes or takes focus (alt-tab around a bit).
P6. Reminth NOT maximized (restore it to a window) → play fullscreen → quit → it stays a normal window
    of the same size, and no `window:` line is logged.
P7. "launch minimized" OFF, minimize Reminth yourself during the game, quit the game → it stays minimized;
    click it on the taskbar → it comes back maximized.
P8. Two instances running at once: Reminth is only put back after the **second** one closes.

### Prompt 4 - Job 0
3. Home → "Jump back in": Play sits at the right of each card's text strip, never over the picture or the
   name; long names/addresses end in "…"; all cards the same height. Check at the smallest window (1100 px).

### Prompt 4 - project page (select a Fabric 1.21.x instance in Discover's "Showing what fits")
4. Discover → Mods → search "fabric api", go to page 2 of results, scroll down a bit, click **Fabric API**'s
   text (not Install) → the page opens: icon, title, summary, people with avatars, downloads, followers,
   "Updated …", Client/Server tag, license. **Fits your instance … (1.21.x Fabric)** in green.
5. Click **Back to results** → same search text, same filters, page 2, same scroll position, the card has
   the focus. Open it again and press **Esc** → same. Open again and press the **mouse Back button** → same.
6. **Sodium**: Description tab shows images (from cdn.modrinth.com), headings, lists; the credit line
   "Description by the project's author, shown from Modrinth." is at the top. Versions tab: release/beta
   tags, "Show more", open a row → changelog appears.
7. **Iris**: Gallery tab shows pictures; Links tab lists source/issues/Discord etc.
8. **Entity Culling**: Minecraft ranges read like "1.21–1.21.x" (not 300 chips); loaders listed.
9. Pick a **Forge** instance in "Showing what fits" while Sodium's page is open → the line changes to
   "No build for 1.20.1 Forge yet." (or similar) without leaving the page.
10. A **modpack** (e.g. Fabulously Optimized): line says "Installs as a new instance of its own."; Install
    opens the modpack install flow (cancel it).
11. A **shader** (Complementary) on a Fabric instance: fit line works; Install goes through the normal
    shader path (Iris question if missing). On a vanilla instance the line says shaders need a loader.
12. A **resource pack** (e.g. Faithful): fit line and Install work.
13. **Install this version**: on Sodium's Versions tab pick a **beta** (or alpha) row → a dialog names the
    channel ("…is a beta build…") → Cancel installs nothing; Install the beta installs that exact version.
    A release row installs without a question. Rows for other Minecraft versions have Install greyed out.
14. With the instance **running**: the page's Install shows it unavailable the same way the cards do.
15. **Description with images and tables**: find a mod whose page has a table (many do - e.g. "Distant
    Horizons" or "Create Fabric") → table drawn with borders, scrolls sideways if wide, no page overflow.
16. **A link opens the default browser**: click a link in a description and one on the Links tab → it
    opens in Edge/Chrome/etc, never inside Reminth; Reminth's window doesn't navigate.
17. **Non-Modrinth image**: find a description with an imgur/GitHub-hosted picture (many older mods; check a
    few) → the box "Image hosted elsewhere" with "Open in browser" shows instead of the picture. In DevTools
    → Network, no request goes to that host.
18. Unplug network / turn Wi-Fi off → open a project not opened in the last 5 minutes → error box with
    **Retry**; reconnect → Retry loads it.
19. Click a result and immediately Back, then another result quickly → the page shows the second project,
    never the first one popping in late.
20. Keyboard: Tab to a result card (focus ring visible) → **Enter** opens it.
21. Instance page → Mods → ⋮ on a mod installed from Modrinth → **Open project page** → page opens, button
    says "Back to <instance>" → it returns to the instance page.
22. Window at **1100 px** wide: header, support card, version rows and gallery fit without sideways scroll.
23. Open 10 different pages quickly → no lag in the window; DevTools Performance: no long task over
    ~100 ms from the page itself.
24. If the owner accepts decision 1, edit the privacy text (app + `site/privacy.html`) exactly as written.
25. Report PASS/FAIL P1-P8 and 3-24.

### Still open from prompt 3 (not yet reported)
26. In a throwaway instance put a folder with a few files, an empty folder and a `.rar` in `mods/`, and a
    `.txt` in `resourcepacks/`. The Mods tab shows **"Safe to delete"** with **Delete all**; names fully
    visible.
27. Delete all → the confirmation lists every item with size / file count → confirm → they are in the
    **Windows Recycle Bin** (restore one to prove it); real jars untouched.
28. Lock one item (open a file inside the folder in another program) → toast "Moved N of M; 1 is in use".
29. Same on the Resource packs tab (only the .txt goes).
30. Start an instance. On its Mods tab: switches/bins/Delete all/bulk bar/"Browse content" are off, the line
    "Close Minecraft to change mods." shows. Resource packs tab still works.
31. Discover → Install on a mod → the "which instance?" panel shows the running instance as "Game running".
32. Quit the game → everything is enabled again without a restart.
33. Skins: restart Reminth, wait 10 s on Home, then DevTools → Console:
    `performance.getEntriesByType("measure").filter(m=>m.name.startsWith("skins:")).map(m=>[m.name,Math.round(m.duration)])`
    → note the numbers. Open/leave Skins 5 times: no rebuild flicker; report whether the lag is gone.
34. Play instance A, quit; select instance B in the rail → Home still shows **A**. Play B from its page →
    Home switches to B as soon as the game starts.
35. Home cards: **Play** on a world card of a 1.20+ instance → the game opens straight into that world;
    pre-1.20 → title screen + toast.
36. Play on a server card → joins the server (IPv6 `[address]:port` if you can).
37. While a card's instance runs, its Play button is off.
38. Profiles: Far view on 26.x (render distance 16/20/24 by PC); an existing instance's own `options.txt`
    stays unchanged after a profile change + Play.
39. Suggested-mods window: rows load, no-build rows can't be ticked, C2ME asks twice.
40. Instance dialog: pack list per loader, "At the last Play" status, Restore (refused while running).
41. Settings → Performance card and the memory helper.

### Release (only after the above pass)
42. Bump to 1.4.0, build, smoke-test the packaged app (open one project page in the packaged app too -
    `markdown.js` must be in the package).
43. With a game running: "Restart and update" disabled; quitting Reminth leaves the game running.
44. Owner creates the GitHub release (installer + `latest.yml` + `.blockmap`); an older installed copy finds
    it. Re-upload `site/` if the privacy text changed.

### Prompt 8 (Home)
H1. Home: the five stat cards have no coloured line on the left edge; the soft coloured glow in each card's
    top-right corner is still there; text and card size unchanged.
H2. Hover each card (and Tab-focus into one if it can be focused): the border turns a soft cyan/accent, with
    a short fade, exactly like the world/server cards below; nothing moves, no shadow appears.

### Prompt 7 (packaged app only - "Check for updates" says "Updates only work in the installed app." in a dev run)
U1. Installed 1.4.0 (or newer), GitHub's newest release older or equal → Settings → **Check for updates** →
    "You're on the latest version (**1.4.0**)" - the running version, never 1.1.1.
U2. After the 1.4.0 release is published: an installed 1.3.x copy → Check for updates → "Downloading 1.4.0…"
    then "1.4.0 is ready." (unchanged behaviour).

### Report back
45. PASS/FAIL per step (W1-W5, T1-T8, I1-I10, V1-V13, M1-M12 and P1-P8 too), the Skins numbers, the owner's answers to section 2, then **update this file**.

---

## 5. Desktop window results so far (3 Oct 2026, Windows 11, real Electron + Minecraft)

- `npm test` 456 pass on Windows (before prompt 3). CRLF files and the CSS last rule intact.
- Prompt 2 case **PASS**: fresh Fabric 26.2 + the owner's 29 mods; panel caught 18 "won't load" (Client Side
  Crystals and JEI included; Anchor Optimizer a warning); one click updated 18, added Sodium, copied 18 jars to
  `.reminth/replaced-mods/`; the game reached the title screen with 113 mods. Real "Reminth" instance untouched.
- Beta/Alpha tags in the update list **PASS**; dev-run "Updates only work in the installed app." **PASS**.
- Forge 1.20.1 (6 pack mods) and NeoForge 1.21.1 (7) reach the title screen **PASS**.
- `options.txt` seeding tested on 1.16.5, 1.20.1, 1.21.1, 1.21.5, 1.21.10, 1.21.11, 26.1, 26.3; fix in
  `2dfbdc7` (`graphicsPreset:"custom"` from 1.21.11 on).
- Not done yet: profile steps above, release steps, site re-upload.
