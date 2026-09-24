# REMINTH_STATE — local Windows machine report

Written by local Claude Code, 2026-09-24 (round 3, from `CLAUDE_CODE_PROMPT_2.md`).
Every claim is labelled VERIFIED (ran it, saw it), ASSUMED, or UNTESTED.
"User ran it live" means the user tested it personally on this machine and reported the result.

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
| NeoForge launch | VERIFIED pass (user report). See conflicting evidence below | User ran it live, launched clean |
| Quilt launch | VERIFIED pass | User ran it live, launched clean. `launch-logs/quilt-26-3-49e0.txt` shows `Loading 4 mods` |
| Forge launch | UNTESTED | No Forge launch on record: `instances/forge-26-3-ff87/` has only empty `mods/resourcepacks/saves/shaderpacks`, and no `launch-logs` entry. Starting the game needs someone to click Play in the GUI, and the user was in a live multiplayer session this round, so I didn't touch the launcher |
| ReminthHUD on Quilt 26.3 | VERIFIED: **does not load** | The launch log's mod table lists only Minecraft 26.3, Quilt Loader 0.30.1, MixinExtras 0.5.4, and OpenJDK. No ReminthHUD. `instances/quilt-26-3-49e0/mods/` has 0 jars. Reasons, all VERIFIED from code and disk: instance has `hud=false`; the only bundled build (`assets/mods/reminthhud-1.0.0.jar`) has `fabric.mod.json` `"minecraft": "~26.2"`, so no 26.3 build exists |
| ReminthHUD on NeoForge 26.3 | VERIFIED: **cannot load, by design** | `minecraft.js`: `const wantsHud = instance.hud === true && (loader === "fabric" \|\| loader === "quilt");`. NeoForge and Forge are never given the HUD. The jar is Fabric-only (`fabric.mod.json`, no `mods.toml`) |
| ReminthHUD on Fabric 26.2 (original instance) | VERIFIED installed; rendering in game UNTESTED | `instance/game/mods/` contains `reminthhud-1.0.0.jar` and `fabric-api-0.161.0+26.2.jar` (16 jars total). Pressing H in game was not tested by me |
| Fix #1: sign-out hides instances, worlds, mods, servers | UNTESTED (code only) | Not run live. Signing out would have deleted the user's saved account mid-session |
| Fix #2: launcher opens maximized | UNTESTED (code only) | Not run live, because the installed Reminth and a `javaw` multiplayer session were running |
| Silent refresh on Play (`refreshSession`) | UNTESTED | |

## Broken or weird

1. **The NeoForge result conflicts with the files on disk.** `instances/neoforge-26-3-0050/`
   contains only empty `mods`, `resourcepacks`, `saves`, `shaderpacks`. It has no `options.txt`, `logs/`
   or `config/`, and there is no `launch-logs/neoforge-26-3-0050.txt`. The Quilt instance, which did boot,
   has all of those. Minecraft writes `options.txt` in its game dir on first start. ASSUMED explanation: the
   NeoForge test ran from a different instance, folder or build than the one registered here.
   Worth a re-check before relying on it.
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

## What's left

- [ ] Rebuild (`npm run dist`), install, and confirm the launcher **opens maximized**.
- [ ] Sign out in the new build and confirm only the sign-in card is visible: no rail instances,
      Library, Discover or sidebar counts. Then sign back in and confirm everything returns.
- [ ] **Forge**: launch `forge-26-3-ff87`, confirm it boots. Send the last 30 log lines if it crashes.
- [ ] Re-check **NeoForge** (see Broken or weird #1).
- [ ] **ReminthHUD**: press H in-game on the Fabric 26.2 instance to confirm it renders.
      Decide on 26.3 and Forge-family builds.
- [ ] Silent refresh on Play (`refreshSession`'s bare `catch {}` in `main.js`).
- [ ] Decide on the `PAGE_META` gap, `electron-updater`, and the `brace-expansion` lockfile pins.
