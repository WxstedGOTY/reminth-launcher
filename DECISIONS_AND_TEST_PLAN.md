# Reminth: what to know, decide and test

**This is the one living hand-off file between the windows.** Every Claude Code session that finishes
work rewrites it (see `CLAUDE.md`). Desktop window: `git pull`, read this top to bottom, then work
section 4 in order and report PASS/FAIL per step.

- **Last updated:** 3 Oct 2026, by the cloud session, after prompt 3 (jobs 1, 2, 3, 4, 6). Prompt 4 (mod
  detail page) has NOT been started.
- **`main` is at:** `75603c0` (plus this file's commit). **`npm test`: 470 pass** on Linux.
- **Never run** in real Electron, against live Modrinth/GitHub, or with Minecraft. The UI was clicked
  through in headless Chromium with a fake main process (all buttons, IPC payloads, screenshots) - that
  proves the page code, not the real IPC.
- Rules: `CLAUDE_CODE_HANDOFF_10.md` sections 0-1.

---

## 1. What changed in prompt 3

| Job | What it does now | Files |
|---|---|---|
| 1 Safe to delete | "Needs a look" is now **"Safe to delete"** on every content tab. Red **Delete all** in its heading: a confirmation lists every item with its size or a folder's file count (capped "1000+"), says they go to the Recycle Bin, warns when a folder isn't empty. The MAIN process re-reads the folder and moves only what is invalid there (`content:removeInvalid`, `shell.trashItem`, max 200, partial failures reported). Italic names no longer lose their last letter. | `content.js` (`invalidItems`, `invalidDetails`, `removeInvalid`), `main.js`, `preload.js`, `features.js`, `styles.css` |
| 2 Running = mods locked | Main process: `content:setEnabled`, `content:remove`, `content:removeInvalid`, `content:install` refuse **mod** changes while that instance runs ("Close the game first - that instance is running."); packs/shaders/data packs stay allowed; a shader install may not add Iris then. Screen: switches, bins, single updates, Delete all, bulk bar, "Browse content" off with "Close Minecraft to change mods."; Discover's "which instance?" panel shows a running instance as unavailable for mods; Open folder gets the line as a hint. Everything comes back by itself when the game exits. | `content.js` (`touchesMods`), `main.js`, `features.js`, `renderer.js`, `styles.css` |
| 3 Skins page lag | **Not measured here.** Found: the viewer is CSS 3D (not WebGL) and every skin TILE is its own 3D model; opening the page rebuilt all tiles and the big model every time. Now: rebuild only when the skins changed; idle warm-up 4 s after start (signed in); loaders start after the first painted frame; images `decode()`d; the big viewer's frame loop pauses off-page; no entrance fade on the Skins page (it flattens every 3D model while it runs). Marks: `skins:viewer`, `skins:texture`, `skins:profile`, `skins:library`, `skins:defaults`, `skins:warm`, mark `skins:open`. | `features.js`, `skinview.js`, `styles.css` |
| 4 Play on Home cards | Each "Jump back in" card has **Play**, starting the card's own instance. Servers: host / host:port / [IPv6]:port / bare IPv6 (IPv6 now goes to the game in brackets - before it was silently dropped). Worlds: opened directly when the version's own arguments have quick play for singleplayer (`minecraft.supportsWorldJoin`), otherwise the instance just starts and tooltip + toast say so. World folder name checked on the main side (plain name, real folder in THAT instance's saves). The only change inside `launch()`: `${quickPlaySingleplayer}` + the `is_quick_play_singleplayer` feature. | `renderer.js`, `pure.js` (new), `gameData.js`, `minecraft.js`, `main.js`, `preload.js`, `index.html`, `styles.css` |
| 6 Hero = last played | The Home hero (tags, text, Time played, Last played, Play/Stop, Instance, "Update mods to fit") is about the instance with the newest `lastPlayed` (never played → the selected one). Clicking the rail no longer changes Home. `lastPlayed` is now written when the game **starts**. The Home progress bar follows the run that put it up. | `renderer.js`, `pure.js`, `features.js`, `main.js` |

---

## 2. Decisions the owner must make (recommendation first)

1. **Home "Time played" now shows the hero instance's time, not the lifetime total of all instances.** The
   old code said "lifetime total across every instance" on purpose; prompt 3 says the hero's Time played is
   about the hero instance. **Recommend: keep (as the prompt says)**; the Statistics page still has totals.
2. **No page fade when opening Skins** (the other pages still fade in). It's the one visible change made for
   speed; the 3D models look the same. **Recommend: keep if 4.11 shows Skins opening faster; otherwise
   restore it** (one CSS line in `styles.css`: `#skins.page { animation: none; }`).
3. **Mods-tab delete text unchanged** (prompt asked "deleted for good"): delete really moves the file to the
   Recycle Bin, so that text would be false. **Recommend: keep unchanged.**
4. **Opening a world from Home on a Minecraft version without quick play** just starts the instance (title
   screen). **Recommend: keep** - opening it any other way would mean writing to the game's files.
5. **A shader-pack install into a running instance that needs Iris/Oculus is refused** with a plain message
   (the pack alone is allowed). **Recommend: keep.**
6. **Unsigned installer** (still open from before): SmartScreen warns on manual downloads; nothing to do
   without paying for a certificate. Never write "verified/signed" anywhere.

Closed: privacy text for copies + game report (done by the desktop window); tied versions stay warnings;
all replaced jars copied; Forge/NeoForge pack ON for new instances (4.17 passed); profile on never-played
instance writes options.txt; wrong-loader mods count for "Update mods to fit"; six extra-mod slugs
(confirm in 4.20 if not yet done).

---

## 3. Known weak spots (say them, don't hide them)

- No FPS number has ever been measured; the Skins speed-up is unmeasured too (4.11 measures it).
- Opening a world directly: the argument comes from Mojang's own version file, but no world has ever been
  opened this way in a real game. Same for IPv6 server joins (bracket form assumed from Minecraft's own
  address format).
- "Last played" is now written at launch: an instance that crashes at start still becomes Home's hero.
- `options.txt` seeding: on 1.16.5/1.20.1/1.21.1 the game never rewrites the file, so "values were used"
  isn't proven there (desktop results below).
- Safe mode still misses JVM errors that show a `javaw` dialog; the update path has never seen a real GitHub
  release; whether the NSIS installer kills a running `javaw` is unknown.

---

## 4. Test plan for the desktop window (in order)

Don't touch the screen while the owner plays. Use throwaway instances. Report PASS/FAIL per step with what
you saw; stop and report on any FAIL that risks his files.

### Basics
1. `git pull`, `npm install` if needed, `npm test` → **470 pass**. Report any Windows-only failure verbatim.
2. `npm start`; watch DevTools console and `%APPDATA%\Reminth\main-errors.log` throughout.

### Job 1 - Safe to delete
3. In a throwaway instance put a folder with a few files, an empty folder and a `.rar` in `mods/`, and a
   `.txt` in `resourcepacks/`. The Mods tab shows **"Safe to delete"** with **Delete all**; names are fully
   visible (no cut-off last letter).
4. Delete all → the confirmation lists every item with size / file count and the "folders contain files"
   line → confirm → they are in the **Windows Recycle Bin** (restore one to prove it); real jars untouched.
5. Lock one item (open a file inside the folder in another program) → toast "Moved N of M; 1 is in use".
6. Same on the Resource packs tab (only the .txt goes).

### Job 2 - running game locks mods
7. Start an instance. On its Mods tab: switches/bins/Delete all/bulk bar/"Browse content" are off, the line
   "Close Minecraft to change mods." shows, Open folder has the hint. Resource packs tab still works (switch a
   pack off and on).
8. Discover → Install on a mod → the "which instance?" panel shows the running instance as "Game running".
9. Quit the game → everything is enabled again without a restart.

### Job 3 - Skins page (measure)
10. Restart Reminth, wait 10 s on Home, then DevTools → Console:
    `performance.getEntriesByType("measure").filter(m=>m.name.startsWith("skins:")).map(m=>[m.name,Math.round(m.duration)])`
    → note the numbers (warm-up happened in idle time).
11. Open Skins with the Performance panel recording: compare the page-switch frame with the old build if you
    can (owner's report: it "lags for a moment"). Open/leave Skins 5 times: no rebuild flicker; the big model
    animates only while visible. Report whether the lag is gone (decision 2).

### Jobs 4 + 6 - Home
12. Play instance A, quit; select instance B in the rail → Home still shows **A** (name, tags, Time played,
    Last played). Play B from its page → Home switches to B as soon as the game starts.
13. Home cards: **Play** on a world card of a 1.20+ instance → the game opens straight into that world.
    On a world card of a pre-1.20 instance → the instance starts at the title screen and the toast says "this
    Minecraft version can't open a world directly" (tooltip says the same).
14. Play on a server card → joins the server. If you can, an IPv6 server (`[address]:port`).
15. While a card's instance runs, its Play button is off; the hero's Instance button opens the hero instance.

### Still open from before
16. Profiles: Far view on 26.x (render distance 16/20/24 by PC); an existing instance with its own
    `options.txt` → change profile → Play → file unchanged.
17. Suggested-mods window: rows load, no-build rows can't be ticked, C2ME asks twice; all six slugs resolve.
18. Instance dialog: pack list per loader, "At the last Play" status, Restore (refused while running).
19. Settings → Performance card and the memory helper (GC options, priority switch, graphics-card help).

### Release (only after the above pass)
20. Bump to 1.4.0, build, smoke-test the packaged app.
21. With a game running: "Restart and update" disabled; quitting Reminth leaves the game running and
    installs nothing; the next quit without a game installs.
22. Owner creates the GitHub release (installer + `latest.yml` + `.blockmap`); an installed older copy finds
    it, shows download %, then "ready". Re-upload `site/` to Cloudflare if site text changed.

### Report back
23. PASS/FAIL per step, the Skins numbers, the owner's answers to section 2, then **update this file**.

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
