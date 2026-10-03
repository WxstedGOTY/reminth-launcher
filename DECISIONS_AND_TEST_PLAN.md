# Reminth: what to know, decide and test

**This is the one living hand-off file between the windows.** Every Claude Code session that finishes
work rewrites it (see `CLAUDE.md`). Desktop window: `git pull`, read this top to bottom, then work
section 4 in order and report PASS/FAIL per step.

- **Last updated:** 3 Oct 2026, by the cloud session, after **prompt 6** (the window repair the real Win32
  state showed was needed). Prompts 4 and 5 are also done; nothing of 4-6 is tested on Windows yet.
- **`main` is at:** `cda41a3` (plus this file's commit). **`npm test`: 517 pass** on Linux (512 after
  prompt 5, 502 after prompt 4).
- **Never run** in real Electron, against live Modrinth, or with Minecraft. The new page was clicked
  through in headless Chromium (1100 and 1400 px) with a fake main process whose answers were built by
  the REAL `projectPage.js` + `markdown.js` from fake Modrinth data. That proves the page code and the
  parser, not the real IPC, real Modrinth answers, real pictures loading, or `shell.openExternal`.
- Prompt 3's desktop tests (section 4, steps 26-41) have not been reported yet - they are still open.
- Rules: `CLAUDE_CODE_HANDOFF_10.md` sections 0-1. No version bump, no build was done.

---

## 1. What changed

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
1. `git pull`, `npm install` if needed, `npm test` → **517 pass**. Report any Windows-only failure verbatim.
   Check `styles.css` still ends with the `background-origin` rule and CRLF files are still CRLF.
2. `npm start`; keep DevTools console and `%APPDATA%\Reminth\main-errors.log` open throughout. Any red line = FAIL.

### Prompt 5 - the two bugs (test these first)
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

### Report back
45. PASS/FAIL per step (P1-P8 too), the Skins numbers, the owner's answers to section 2, then **update this file**.

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
