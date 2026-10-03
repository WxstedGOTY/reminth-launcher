# Reminth: what you need to know, decide, and test (3 Oct 2026)

Written by the cloud Claude Code session after it shipped performance profiles + UI (6b/6c), the
"Update mods to fit" button and the launcher-update button. Everything is on `main` up to
`4c181b1`. `npm test`: **442 pass** (Linux). Nothing below has run in real Electron, against live
Modrinth/GitHub, or with Minecraft.

---

## 1. What exists now (short)

| Area | What it does | Main files |
|---|---|---|
| Performance profiles | Balanced / Max FPS / Far view per instance. Max FPS/Far view write a starting `options.txt` **only** into a never-played instance (no options.txt, no worlds, no `logs/latest.log`, never seeded before, not a modpack or copy). Far view gets the modpack memory default. Optional extra mods are offered, never auto-installed. | `gameOptions.js`, `perfProfiles.js`, `instances.js` |
| Performance UI | Settings → Performance (GC choice, priority switch, graphics-card help), memory "Automatic: X GB", safe-mode notice, profile picker + pack switch/status/Restore in the instance dialog, "Performance pack" label in Mods tab | `features.js` §8, `renderer.js` |
| Update mods to fit | Amber button next to Play when enabled mods are built for another version (and block start) or another loader. Swaps them to the newest **stable** build for that exact version+loader. No-build mods are listed, never deleted (switch off / find version / leave). Old jars are copied to `<instance>\.reminth\replaced-mods\<time>\` first (newest 5 kept). | `modsSync.js`, `content.js` (releaseOnly), `features.js` §9 |
| Launcher updates | Settings "Check for updates" with clear states + "Download it manually" link on error. Auto-check 10 s after start and every 6 h, quiet unless something downloads. Never interrupts a game: no auto-check, no Restart, no install-on-quit while one runs. | `updater.js`, `main.js`, `renderer.js` |

---

## 2. Decisions you need to make

Each one has my recommendation first. Reply with the number + yes/no (or "other: …").

1. **The Mods-panel fixes ("Switch to X", "Fix all") can install beta/alpha builds.** They use Modrinth's
   update lookup, which ignores the release channel. The new button doesn't have this problem.
   **Recommend: yes, make the panel release-only too** (reuse `modsSync.pickStableBuild`, ~30 lines,
   with tests). Breaks your own rule "never install alpha/beta silently" until fixed.

2. **Normal mod updates delete the old jar permanently** (not Recycle Bin, no copy). Only the new button
   keeps a copy. **Recommend: yes, send every replaced jar (Update all, per-mod update, panel fixes) through
   the same `.reminth/replaced-mods` copy.** Cheap, and a bad update becomes undoable.

3. **New Forge/NeoForge instances start with the performance pack ON** in the create dialog (existing ones
   stay off, as the handoff said). **Recommend: keep, but only after test 4.6 below passes on Forge 1.20.1
   and NeoForge 1.21.1.** If it fails, flip the default to off (one line in `packOnByDefault`, renderer.js).

4. **Picking Max FPS/Far view on an existing but never-played instance** writes the starting `options.txt`
   at its first Play. **Recommend: keep** (it is effectively new). Say no if you want "new instances only" literally.

5. **The sync button also counts mods built for the wrong loader** (a Forge mod in a Fabric instance). They
   don't stop the game; they just do nothing. **Recommend: keep** (swapping to the right loader's build is
   what the player wants).

6. **Privacy policy: two small facts aren't written down yet.** (a) the launcher re-checks GitHub for
   updates every 6 hours while open; (b) the sync button keeps copies of replaced mod jars in the instance's
   `.reminth\replaced-mods` folder. **Recommend: add one line each in the next privacy version.** Not urgent
   (both local/same server as before), but your rule is "every statement true of the code".

7. **Extra-mod slugs** (`dynamic-fps`, `badoptimizations`, `moreculling`, `distanthorizons`, `bobby`,
   `c2me-fabric`) were not re-checked live (Modrinth was blocked in the cloud). A wrong slug only shows as
   "No build", nothing breaks. **Recommend: just confirm them in step 15 of the test plan.**

8. **Unsigned installer.** Every update will trigger Windows SmartScreen "unknown publisher" for people who
   download manually; auto-update installs silently. Nothing to decide until you can pay for a certificate;
   just don't promise "verified" anywhere.

Already decided, no action: Max FPS does not change process priority (priority is already "above normal"
by default); C2ME stays experimental behind a second confirm; balanced never writes `options.txt`.

---

## 3. Known weak spots (don't hide these)

- No FPS number has been measured. Don't claim gains anywhere.
- `options.txt` seeding is unproven per version family (1.16, 1.20, 1.21.x, 26.x). Commit `2dfbdc7`
  adjusted it for 1.21.11/26.x, still needs a real launch each.
- Safe mode still misses JVM errors that pop up a `javaw` dialog (from the earlier handoff).
- The update path has never seen a real release: first real test is 1.3.0 → 1.4.0.
- Whether the NSIS installer kills a running `javaw` is unknown, so install-on-quit is simply skipped while
  a game runs (update installs on the next quit without a game).

---

## 4. For the desktop Claude Code window: test plan, in order

Rules from `CLAUDE_CODE_HANDOFF_10.md` §0–1 apply. Don't touch the owner's screen while he plays.
Report each step as PASS/FAIL with what you saw. Stop and report on any FAIL that risks his files.

### 4.1 Basics
1. `git pull`, `npm install` if needed, `npm test` → expect **442 pass** on Windows. Report any failure
   verbatim (paths, CRLF, rename-over-open-file are the likely ones).
2. `npm start`. Watch DevTools console and `%APPDATA%\Reminth\main-errors.log` the whole time.

### 4.2 Settings
3. Settings → Performance: switch GC to each option (setting saves, note text changes), toggle priority,
   "Choose graphics card…" opens Windows Graphics settings and lists real `javaw.exe` paths; Copy works.
4. Memory card: "Automatic: X GB for <instance>"; move the slider → "You picked…" + "Use automatic";
   click it → back to automatic.
5. Version card: "Check for updates" in `npm start` must say **"Updates only work in the installed app."**

### 4.3 Update mods to fit (his "Reminth" instance: 26.2 with 26.3 mods, perfect case)
6. **Back up that instance's `mods` folder first** (copy it somewhere outside the instance).
7. Amber "Update mods to fit 26.2 (N)" shows on the instance page and Home. Count matches the compat panel's
   "won't load" mods for wrong version.
8. Click once. Expect: busy label, then a toast "Updated X mods…", then the "No 26.2 build yet" window if
   any. Check: new jars are **release** builds (compare with Modrinth), old jars are in
   `.reminth\replaced-mods\<time>\`, Reminth's own jars (Sodium etc. from the pack, HUD, Fabric API) untouched.
9. "Switch them off" → those files become `.jar.disabled`; button disappears when nothing blocks.
10. Edit the instance → change version → Save → the one-time notice appears with the same button; X dismisses it.
11. Play → game starts. Button must be hidden while running/installing.

### 4.4 Profiles + options.txt (the part that most needs a real game)
12. For each of **1.16.5, 1.20.1, 1.21.1, 1.21.11, 26.x** (Fabric): create a new instance with **Max FPS**,
    Play once to the title screen, quit. Check `options.txt`: our keys kept their values
    (renderDistance 10, simulationDistance 8 where it exists, particles 1, entityShadows false,
    biomeBlendRadius 1, entityDistanceScaling 0.75, enableVsync false, maxFps 260), and the rest is
    Minecraft's normal defaults (nothing reset weirdly, language/controls fine).
    `.reminth\options-seeded.json` exists.
13. Same once with **Far view** on 26.x: renderDistance 16/20/24 depending on the PC.
14. Existing instance with its own `options.txt` → switch profile → Play → file **unchanged** (diff it).
15. Suggested-mods window after picking a profile: rows load, no-build rows can't be ticked, C2ME asks a
    second time, ticked mods install as normal mods. Confirm all six slugs resolve (decision 7).

### 4.5 Performance pack UI
16. Instance dialog shows the pack mod list per loader, "At the last Play" status after a Play,
    Restore works (refused while the game runs). Mods tab shows the "Performance pack" label.

### 4.6 Forge/NeoForge pack (decision 3)
17. New **Forge 1.20.1** and **NeoForge 1.21.1** instance with the pack on → Play to title screen.
    Check `reminth-performance-mods.log`, no duplicate mod id crash. If either fails: report, and flip the
    create-dialog default to off for Forge/NeoForge.

### 4.7 Launcher update (needs two builds)
18. Bump to 1.4.0 only after 4.1–4.6 pass. Build. Smoke-test the packaged app (Settings → Check for updates
    → "You're on the latest version" once 1.4.0 is published, or an error + "Download it manually" link
    that opens the releases page in the browser).
19. With a game running: "Restart and update" disabled with "Close Minecraft first"; quitting Reminth with
    the game open must **not** close the game and must not install; next quit without a game installs.
20. Owner creates the GitHub release (installer + `latest.yml` + `.blockmap`). Then an installed 1.3.0
    should pick it up within 10 s of start (or via the button), show download %, then "ready".

### 4.8 Then
21. Re-upload `site/` to Cloudflare if any site text changed (decision 6).
22. Report back: PASS/FAIL per step, anything surprising, and which decisions the owner answered.
