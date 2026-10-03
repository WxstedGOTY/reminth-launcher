# Reminth: what to know, decide and test

**This is the one living hand-off file between the windows.** Every Claude Code session that finishes
work rewrites it (see `CLAUDE.md`). Desktop window: `git pull`, read this top to bottom, then work
section 4 in order and report PASS/FAIL per step.

- **Last updated:** 3 Oct 2026, by the cloud session, after **prompt 9** ("may not work" mods that crash
  the game: jobs A, B, C). Prompts 7 and 8 are done too. The desktop window set the version to **1.4.0**.
- **`main` is at:** `fcaa5a9` (plus this file's commit). **`npm test`: 536 pass** on Linux (519 before
  prompt 9).
- **Never run** in real Electron, against live Modrinth, or with Minecraft. The new page was clicked
  through in headless Chromium (1100 and 1400 px) with a fake main process whose answers were built by
  the REAL `projectPage.js` + `markdown.js` from fake Modrinth data. That proves the page code and the
  parser, not the real IPC, real Modrinth answers, real pictures loading, or `shell.openExternal`.
- Prompt 3's desktop tests (section 4, steps 26-41) have not been reported yet - they are still open.
- Rules: `CLAUDE_CODE_HANDOFF_10.md` sections 0-1. The cloud session did no version bump and no build.

---

## 1. What changed

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

## 2. Decisions the owner must make (recommendation first)

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
5. Still open from prompt 3 (unchanged): Home "Time played" is the hero instance's time (**keep**); no page
   fade on Skins (**keep if 33 shows it faster**); Mods-tab delete text says Recycle Bin (**keep**); world
   open on old versions just starts the instance (**keep**); shader install needing Iris refused while
   running (**keep**); unsigned installer (nothing to do).

Closed: privacy text for project-page pictures and links (made by the desktop window in `194863c`; re-upload
`site/` with the release); privacy text for copies + game report; tied versions stay warnings; all replaced jars copied;
Forge/NeoForge pack ON for new instances; profile on never-played instance writes options.txt;
wrong-loader mods count for "Update mods to fit"; six extra-mod slugs.

---

## 3. Known weak spots (say them, don't hide them)

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
1. `git pull`, `npm install` if needed, `npm test` → **536 pass**. Report any Windows-only failure verbatim.
   Check `styles.css` still ends with the `background-origin` rule and CRLF files are still CRLF.
2. `npm start`; keep DevTools console and `%APPDATA%\Reminth\main-errors.log` open throughout. Any red line = FAIL.

### Prompt 9 - "may not work" mods (test these first; a COPY of the "Reminth" instance, never the real one)
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
45. PASS/FAIL per step (M1-M12 and P1-P8 too), the Skins numbers, the owner's answers to section 2, then **update this file**.

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
