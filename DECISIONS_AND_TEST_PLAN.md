# Reminth: what to know, decide and test

**This is the one living hand-off file between the windows.** Every Claude Code session that finishes
work rewrites it (see `CLAUDE.md`). Desktop window: `git pull`, read this top to bottom, then work
section 4 in order and report PASS/FAIL per step.

- **Last updated:** 3 Oct 2026, by the cloud session, after prompt 2 (jobs C, D, E).
- **`main` is at:** `fb4c47f`. **`npm test`: 456 pass** on Linux.
- **Never run** in real Electron, against live Modrinth/GitHub, or with Minecraft: everything below
  marked NOT TESTED needs the desktop window.
- Rules: `CLAUDE_CODE_HANDOFF_10.md` sections 0-1 (blunt, `npm test` after every batch, no `innerHTML`,
  last CSS rule stays last, never delete a player's own mod, never install alpha/beta silently).

---

## 1. What changed since the last brief

| Job | What it does now | Files |
|---|---|---|
| C1 nested jars | The check reads the Minecraft requirement of mods packed inside other mods. Fabric loads the **highest version** of a mod id, so a multi-version bundle's 26.3 copy is what runs on 26.2 → the outer jar is "won't load" with a plain reason ("JEI contains MezzConfig, which needs Minecraft 26.3"). Only "blocked" when certain; ties stay warnings. | `compat.js` `findNestedMcProblems`, `content.js` (nested `name`/`mcDep`) |
| C2 game's own report | After any game exit within 30 min of start, Reminth reads the end (max 512 KB) of **that instance's** `logs/latest.log` (written by this launch, no links). Fabric's "incompatible mods" lines about the Minecraft version are saved to `.reminth/launch-report.json`; those files count as "won't load" until the file changes or the instance's version/loader changes. A later start that gets past loading mods deletes the report. The Mods tab re-checks and toasts. | `compat.js` `parseIncompatibleMods`/`mapReportToFiles`, `main.js` `noteLaunchReport` |
| C3/C4 | Both feed "Update mods to fit" (stable-only swap, or "No build yet" list). A packed mod's fix targets its outer file. | — |
| D | Panel "Switch to X" / "Fix all" are now **stable-only** (a beta/alpha from Modrinth's lookup is replaced by the newest release, or only "Switch off" is offered). The normal update list and per-mod update button show **Beta/Alpha** tags. | `compat.js`, `content.js` `checkUpdates` (`next.channel`), `features.js` |
| E | **Every** update path copies the old jar to `.reminth/replaced-mods/<time>/` first (newest 5 kept); a failed copy goes to `.reminth/replaced-mods.log` and the update continues. Mods tab: **"Restore replaced mods"** opens that folder. | `content.js` `applyUpdates`, `modsSync.js`, `main.js`, `features.js` |

Earlier work still waiting for real-world testing: performance profiles + `options.txt` seeding, the
Performance settings card, "Update mods to fit", the launcher-update button (see section 4).

---

## 2. Decisions the owner must make (recommendation first)

Answer by number. Closed ones are listed at the end so nobody asks again.

1. **Privacy text is out of date in two places** (the code window may not edit it):
   (a) `site/privacy.html` ~line 119 says copies of replaced mods are kept "when you press Update mods to
   fit" - now **every** update keeps one; (b) nothing mentions that after a failed start Reminth reads the
   instance's `logs/latest.log` and saves `.reminth/launch-report.json` (local only, nothing sent).
   **Recommend: fix both in the next privacy edit** (desktop window, then re-upload `site/` to Cloudflare).
2. **Tied versions stay a warning.** AnchorOptimizer's copies are `1.0.6+26.2` / `1.0.6+26.3`, which Fabric
   treats as equal, so which one loads can't be known → warning before the first start; the game's report
   makes it "won't load" after one failed start. **Recommend: keep** (your "false blocked is worst" rule).
3. **All replaced mod jars are copied**, including ones Reminth installed itself (the prompt said "files
   Reminth did not install"). **Recommend: keep** - the copy is cheap and "who installed it" is unreliable.
4. **New Forge/NeoForge instances start with the performance pack ON.** **Recommend: keep only if test 4.17
   passes**, otherwise flip `packOnByDefault` in `renderer.js` to off for Forge/NeoForge.
5. **Max FPS / Far view on an existing never-played instance** writes `options.txt` at its first Play.
   **Recommend: keep.**
6. **Wrong-loader mods count toward "Update mods to fit".** **Recommend: keep.**
7. **Six extra-mod slugs** (`dynamic-fps`, `badoptimizations`, `moreculling`, `distanthorizons`, `bobby`,
   `c2me-fabric`) unverified live. **Recommend: confirm in test 4.15.**
8. **Unsigned installer**: SmartScreen warns on manual downloads; nothing to do without paying for a
   certificate. Never write "verified/signed" anywhere.

Closed: panel fixes release-only (done, job D); every update keeps a copy (done, job E); privacy six-hour
check + replaced-mods line (added by desktop window in `deb2408`, now needs decision 1's correction);
Mods-tab delete text unchanged on purpose - it really uses the Recycle Bin.

---

## 3. Known weak spots (say them, don't hide them)

- No FPS number has ever been measured. No speed claims anywhere.
- The nested-jar rule was tested on **fake jars shaped like** the real ones, not the real ClientSideCrystals /
  AnchorOptimizer / JEI files. If a real bundle's outer jar has the same id and version as its newest packed
  copy, it shows as a warning until the first failed start (then the report catches it).
- The report parser was built from the three lines quoted from the owner's log; real Windows log formatting
  (CRLF, timestamps, tabs) is assumed, not seen.
- `options.txt` seeding unproven per version family (1.16, 1.20, 1.21, 1.21.11, 26.x).
- Safe mode still misses JVM errors that show a `javaw` dialog.
- The update path has never seen a real GitHub release.
- Whether the NSIS installer kills a running `javaw` is unknown → install-on-quit is skipped while a game runs.

---

## 4. Test plan for the desktop window (in order)

Don't touch the screen while the owner plays. Back up anything you are about to change. Report each step
PASS/FAIL with what you saw; stop and report on any FAIL that risks his files.

### Basics
1. `git pull`, `npm install` if needed, `npm test` → **456 pass**. Report any Windows-only failure verbatim.
2. `npm start`; watch DevTools console and `%APPDATA%\Reminth\main-errors.log` throughout.

### The case that failed last time (jobs C, D, E) - most important
3. Make a **fresh throwaway** Fabric 26.2 instance and copy in the 29 mods of the "Reminth" instance
   (never work on his real instance).
4. Before Play: the Mods panel should now list ClientSideCrystals and JEI as **won't load** with the new
   reasons ("…carries a copy for each Minecraft version…", "JEI contains MezzConfig…"). AnchorOptimizer may
   only be a warning (decision 2). Note exactly what each says.
5. Click **"Update mods to fit 26.2 (N)"**. Check: swapped jars are **release** builds; every replaced jar is in
   `.reminth\replaced-mods\<time>\`; nothing deleted without a copy; Reminth's own jars untouched.
6. Play. If the game still refuses: confirm `.reminth\launch-report.json` appears listing the named mods with
   the right jar (MezzConfig → the JEI jar), the Mods tab toast says "Minecraft named N mods…", and those
   mods are now "won't load". Click the button again → swapped, or listed under "No 26.2 build yet" →
   "Switch them off" → Play.
7. **Expected end state: the game reaches the title screen.** Then quit normally and confirm
   `launch-report.json` was deleted (a start that got past the mods clears it).
8. "Restore replaced mods" (Mods tab) opens `.reminth\replaced-mods`. Copy one jar back by hand → it shows in
   the list again.
9. Mods tab → Check for updates on an instance with a mod whose newest build is a beta: the list and the
   per-mod update button show a **Beta** tag. Panel "Switch to X" never offers a beta/alpha.

### Settings + launcher update
10. Settings → Performance: each GC option saves, priority switch saves, "Choose graphics card…" opens Windows
    Graphics settings and lists real `javaw.exe` paths; Copy works.
11. Memory card: "Automatic: X GB for <instance>"; move slider → "You picked…" + "Use automatic" works.
12. Version card in `npm start`: "Check for updates" → "Updates only work in the installed app."

### Profiles + options.txt (needs the real game)
13. For **1.16.5, 1.20.1, 1.21.1, 1.21.11, 26.x** (Fabric): new instance with **Max FPS**, Play to title,
    quit. `options.txt` keeps renderDistance 10, simulationDistance 8 (where it exists), particles 1,
    entityShadows false, biomeBlendRadius 1, entityDistanceScaling 0.75, enableVsync false, maxFps 260;
    nothing else oddly reset; `.reminth\options-seeded.json` exists.
14. **Far view** once on 26.x: renderDistance 16/20/24 by PC. Existing instance with its own `options.txt` →
    change profile → Play → file unchanged (diff it).
15. Suggested-mods window: rows load, no-build rows can't be ticked, C2ME asks twice, ticked mods install as
    normal mods. All six slugs resolve (decision 7).
16. Instance dialog: pack mod list per loader, "At the last Play" status, Restore (refused while running);
    Mods tab "Performance pack" label.
17. New **Forge 1.20.1** and **NeoForge 1.21.1** instance with the pack on → Play to title, no duplicate-id
    crash, check `reminth-performance-mods.log` (decision 4).

### Release (only after 3-17 pass)
18. Bump to 1.4.0, build, smoke-test the packaged app (Check for updates works or shows the error + manual
    link).
19. With a game running: "Restart and update" disabled ("Close Minecraft first"); quitting Reminth leaves the
    game running and installs nothing; the next quit without a game installs.
20. Owner creates the GitHub release (installer + `latest.yml` + `.blockmap`); an installed older copy finds it
    (10 s after start or via the button), shows download %, then "ready".
21. Fix the privacy text (decision 1) and re-upload `site/` to Cloudflare.

### Report back
22. PASS/FAIL per step, anything surprising, the owner's answers to section 2, then **update this file**
    (sections 1-4) before you stop.

---

## 5. Desktop window results (3 Oct 2026, Windows 11, real Electron + Minecraft)

- Step 1: `npm test` 456 pass on Windows. CRLF files and the CSS last rule intact.
- Steps 3-7 **PASS**: fresh throwaway Fabric 26.2 + the 29 mods. Panel now says 18 "won't load" (was 16): Client
  Side Crystals ("carries a copy for each Minecraft version...") and JEI ("contains MezzConfig...") are caught;
  Anchor Optimizer is a warning (decision 2). One click: "Updated 18 mods, and added Sodium"; 18 jars copied to
  `.reminth/replaced-mods/`. Play: 113 mods loaded, "Sound engine started" (title screen). No
  `launch-report.json` was needed. (The real "Reminth" instance was never touched.)
- Step 8: the "Restore replaced mods" button is present; not clicked (it opens Explorer).
- Step 9 **PASS**: update list shows Alpha (ScalableLux) and Beta (JEI, Simple Voice Chat, Client Side Crystals,
  Text Placeholder API) tags.
- Step 12 **PASS**: "Updates only work in the installed app." in a dev run.
- Step 17 **PASS** (decision 4 = keep): Forge 1.20.1 (6 pack mods) and NeoForge 1.21.1 (7 pack mods) reach the
  title screen, no duplicate-id crash.
- Profiles: seeding tested for real on 1.16.5, 1.20.1, 1.21.1, 1.21.5, 1.21.10, 1.21.11, 26.1, 26.3. **Bug found
  and fixed (commit 2dfbdc7):** from 1.21.11 on the graphics preset overwrote our values unless
  `graphicsPreset:"custom"` was in the file. On 1.16.5/1.20.1/1.21.1 the file is left intact but the game never
  rewrites it, so "values were used" is not proven there.
- Decision 1 (privacy) done by the desktop window. Decisions 2-7: owner agreed with the recommendations.
- Not done yet: steps 14-16, 18-20 (needs a second build and the GitHub release), site re-upload.
- Owner's follow-up list (small fixes + Discover detail page + Home hero) will come as prompt 3 / prompt 4.

