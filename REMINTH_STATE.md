# REMINTH_STATE — local Windows machine report

Written by local Claude Code, 2026-09-24. Round 3 (`CLAUDE_CODE_PROMPT_2.md`) plus
round 4 (`CLAUDE_CODE_PROMPT_3.md`: rebuild, NeoForge investigation, manual checklist).
Every claim is labelled VERIFIED (ran it, saw it), ASSUMED, or UNTESTED.
"User ran it live" means the user tested it personally on this machine and reported the result.

## Round 10 (`CLAUDE_CODE_PROMPT_8.md`): final cleanup

Commits: `acef3ac` (job 3) · `1405ae1` (job 4) · `384033a` (job 5, version 1.1.1) · plus this report.
Jobs 1 and 2 needed no code change (see each). `npm test`: **89/89** (53 before, +36 from `features.test.js`).

### Job 1: Forge 26.3 and NeoForge 26.3 launch (VERIFIED, both pass to the fully loaded first screen)

How: a harness (`scratchpad/launch-harness.js`) runs the launcher's **own** `minecraft.ensureInstalled()` and
`minecraft.launch()` for the real instance entries, with `USERPROFILE`/`APPDATA` pointed at the scratch sandbox
(it refuses to run if `os.homedir()` isn't the sandbox). Real Mojang, Forge, NeoForge and Adoptium downloads.
The account is a **fake offline identity** (`SandboxTester`, access token `"0"`), never the user's session.
Offline tokens are fine for singleplayer and menus, but can't reach online services.

| | NeoForge `neoforge-26-3-0050` | Forge `forge-26-3-ff87` |
|---|---|---|
| Loader | NeoForge 26.3.0.16-beta on MC 26.3 | Forge 66.0.3 on MC 26.3 (MCP 20260918.230105) |
| Install | fresh sandbox, 75 s: loader installer, Java (java-runtime-epsilon 25.0.1), client jar, libraries, "Patching Minecraft", assets. No errors | 17 s (shared files already present). No errors |
| Main class | `net.neoforged.fml.startup.Client` | `net.minecraftforge.bootstrap.ForgeBootstrap` |
| Process | pid 35416 alive, ~1.2 GB, window **"Minecraft NeoForge\* 26.3"** | pid 10676 alive, ~1.2 GB, window **"Minecraft\* Forge 26.3"** |
| Log | `NeoForge mod loading, version 26.3.0.16-beta, for MC 26.3` → `Setting user: SandboxTester` → `Sound engine started` → all texture atlases `Created` → `Loaded 0 entity animations` | `Forge mod loading, version 66.0.3, for MC 26.3` → `Setting user: SandboxTester` → `Sound engine started` → `Created: 2048x2048x4 minecraft:textures/atlas/blocks.png-atlas` |
| Crash | none; no `crash-reports/` | none; no `crash-reports/` |
| Screen (window screenshot) | fully rendered "Welcome to Minecraft!" first-launch screen (Narrator / Accessibility / Continue). It is shown only after loading completes, directly before the title screen | the same, rendered |

Expected errors, not failures (caused by the fake offline account): `Failed to fetch user properties …
InvalidCredentialsException: Status: 401` (path `/player/attributes`) and `Failed to fetch Realms feature flags …
Failed to parse into SignedJWT: 0`. With a real signed-in account these calls succeed.
**Not tested:** creating/joining a world, and anything online. The harness stops at the loaded first screen. Both games were
closed afterwards (only the sandbox PIDs).
This also answers round 4's NeoForge question: the loader works. The earlier "pass" simply never came from this instance.

### Job 2: `PAGE_META` (no change needed; the prompt's premise is out of date)

Fresh check: `PAGE_META` in `renderer.js` has **all 11** pages, including `discover`, `plus`, `captures`, `streamer`.
They have been there since the round 6 renderer swap (the missing entries were a property of the old stale renderer), and
round 6's live check opened all 11. None are stubs:
- `discover`: `pageHooks.discover`, catalog browsing and install (round 9 picker).
- `plus`: an info page. Its purchase button already uses the existing Soon pattern (`btn … is-soon` + `<em class="soon">Soon</em>`).
- `captures`: `loadCaptures`/`renderCaptures`, `pageHooks.captures`, `streamer:captures` IPC, capture/clip/folder buttons.
- `streamer`: hotkeys, clip lengths, buffer disk, fps/quality, toggles; `applyStreamerUi`/`saveStreamer`, `pageHooks.streamer`.
  Captures and Streamer rail buttons only show while Streamer mode is on (`#railStreamer`), by design.
So every page got a real entry; none needed the "Soon" treatment.

### Job 3: silent refresh logging (`acef3ac`)

`freshAccount()` in `main.js` swallowed `msAuth.refreshSession` errors with a bare `catch {}`. Behaviour is unchanged (it still
carries on with the cached session), but the error is now written to **`%APPDATA%\Reminth\auth.log`** as one timestamped line:
`2026-…Z session refresh failed: <message>`. Why not `minecraft.js`'s log: `minecraft.js` has no append-style error log. Its
`launch-logs\<id>.txt` is reopened with `"w"` on every launch, so an entry there would be wiped by the next Play. The existing
append pattern is `updater.js`'s `updater.log`, so `auth.log` matches that. Because this is auth, the line is **scrubbed**
first: JWTs (`eyJ….….…`), `M.C…` refresh tokens and any 40+ character opaque blob become `<REDACTED>`. Checked against
samples: a normal `invalid_grant` message stays readable, and an embedded JWT and an `M.C534_…` token are redacted. The file resets past 256 KB.

### Job 4: cleanup

| item | result |
|---|---|
| `assets/mods/wxhud-1.0.0.jar` | **Deleted** (`1405ae1`). Nothing loads it: `bundledReminthHudBuilds()` reads only `reminthhud-*.jar`. The only other mention is `test/zip.test.js`, which writes its *own* fake `wxhud-1.0.0.jar` into a temp dir |
| `%APPDATA%\Reminth\instance\mods\` (singular) | **Contents deleted**: `fabric-api-0.160.0+26.2.jar`, `lithium-0.25.3+mc26.2-api.jar`, `wxhud-1.0.0.jar`. Nothing reads it: `paths.MODS_DIR` = `instance\game\mods`, and per-instance mods are `<gameDir>\mods` (`minecraft.js:132`, `content.js`). The real `instance\game\mods` is untouched (16 jars incl. ReminthHUD). The empty folder was left, as asked |
| `Downloads\reminth-launcher-push\` | **Safe for the user to delete by hand** (not deleted by me). Every file under `src/` was diffed with line endings ignored. Each line present only in that copy is one the repo deliberately superseded: the old maximize listener and `heroPlaytime` (renderer.js), the old memory default (minecraft.js), the removed `catalog:checkUpdates` handler and the old refresh `catch` (main.js), the pre-rename/pre-picker `skinTile`/`installProject`/`side.appendChild` lines (features.js), and the old smaller toggle/head-mods/hover CSS. The **only** file unique to it was `test/features.test.js`. It passes 36/36 against this repo and is now committed here (`1405ae1`) |
| `brace-expansion` | **There is no pin** to remove: `package.json` has no `overrides`/`resolutions`. The "pin" in earlier notes was the lockfile keeping 1.1.18 / 2.1.4 / 5.0.9 (npm latest: 1.1.21 / 2.1.7 / 5.0.12) after the round 1 merge. `npm audit` does **not** flag `brace-expansion` at any of those versions, so nothing to change. (No comment was added to `package.json`: JSON has no comments, and there's no pin to explain.) |

**Found by `npm audit`, not fixed (needs a decision):** 14 advisories (13 high, 1 critical).
- Almost all are **build-time** (`electron-builder` 25 chain: `tar` critical, `node-gyp`, `cacache`…). The fix is `electron-builder` 26 (major).
- `electron` 33.4.11: several highs (ASAR integrity bypass <35.7.5, among others). The fix is a major Electron upgrade (44.x).
- **`extract-zip` 2.0.1 is the one that matters most. It's a runtime dependency with no fixed release** (2.0.1 is the latest,
  last published 2023). GHSA-jmr9-qjv8-65gv and GHSA-7pqw-9j4j-h8q3: symlink entries can write outside the target dir.
  `src/main/mrpack.js:133` uses it to unpack **modpacks downloaded from Modrinth**, which is untrusted input. `java.js:141` and
  `minecraft.js:857` use it on Adoptium/Mojang archives (lower risk). On Windows, creating a symlink needs Developer Mode or admin,
  which limits exploitation, but it isn't zero. Recommended next step: pre-scan each `.mrpack` with the repo's own
  `zipread.js` and refuse symlink or `..` entries before extracting, or replace `extract-zip` for `mrpack.js`.

### Job 5: release 1.1.1 (built; **upload is the user's**)

- `package.json`/`package-lock.json`: `1.1.0 → 1.1.1` (`npm version patch --no-git-tag-version`), committed `384033a`.
- `npm run dist` (plain; the old `win-unpacked` lock is gone): exit 0. `dist\latest.yml` = `version: 1.1.1`, and its sha512 and
  `size: 83434240` VERIFIED to match `dist\Reminth-Setup.exe`.
- There's no `gh` CLI and no `GH_TOKEN` on this machine. The user chose to upload by hand. Steps:
  1. GitHub → Releases → **Draft a new release**. Tag **`v1.1.1`** on `main`, title `Reminth v1.1.1`, **Set as the latest release**.
  2. Upload **all three** from `dist\`: `Reminth-Setup.exe`, `Reminth-Setup.exe.blockmap`, `latest.yml` (names unchanged).
  3. Publish. (The site's download button uses `releases/latest/download/Reminth-Setup.exe`, so it switches to 1.1.1 automatically.)
- **Still needs a human to watch (UNTESTED):** open an installed **1.1.0 build that contains the updater**. That's any
  installer from round 7 onward (2026-09-24 22:26 or later); the original v1.1.0 release has no updater and will never self-update.
  Within ~10 s the bottom bar should show "Update available (Reminth 1.1.1), downloading…", then "…is ready" with
  **Restart to install**. Clicking it should relaunch as 1.1.1. `%APPDATA%\Reminth\updater.log` records each step.

## Round 9 (`CLAUDE_CODE_PROMPT_7.md`): skin rename, dead handler, mod version picker

Commits: `d3e681a` (job 2) · `aef4266` (job 1) · `4e19a5a` (job 3) · plus this report.
All live tests ran in the isolated sandbox dev app (repo Electron, `USERPROFILE` pointed at a scratch
home, driven over Chrome DevTools). They never touched the real `%APPDATA%\Reminth`. `npm test` 53/53.
The compiler check over the three renderer scripts: 0 undefined names, 0 duplicate declarations.

### Job 2: `catalog:checkUpdates` (**removed**)

Fresh search over `src` and `test` for `catalog:checkUpdates|checkForUpdates|catalogCheckUpdates`:
- `main.js:484`: the handler itself. **Deleted.**
- No preload entry and no renderer caller (preload never exposed it; the renderer uses
  `checkUpdates` → `content:checkUpdates`).
- `modrinth.checkForUpdates`: **kept**, because it has a live caller: `content.js:685` (inside
  `content.checkUpdates`, which backs `content:checkUpdates`).
- `updater.js:63 autoUpdater.checkForUpdates()` is electron-updater's own method, unrelated.

### Job 1: skin rename (VERIFIED live)

`features.js`: `skinTile` takes `onRename`. The tile-actions strip now has **Rename** (`#i-edit`) and
**Forget this skin** (`#i-trash`), same button style. The trash keeps its rose hover (now class
`danger`), and the pencil hovers neutral. `renameSkinModal(s)` uses the existing `openModal` with a `.field` text
input (same markup as the instance dialog's Name field), capped at 40 characters to match `skinLibrary.rename`.
Enter saves, a blank name is refused (the dialog stays open), and it calls `window.reminth.skinLibraryRename(s.id, name)` then
`loadSkinLibrary()`. The "Editing skin" modal is untouched.

Live: saved a generated 64×64 skin "Test Skin". Tile actions = `["Rename", "Forget this skin"]`. Rename
opened pre-filled with "Test Skin", fully selected. Blank kept it open. Typed "Blue Steve (renamed)" + Enter
closed it and the tile label updated. Switched Home → Skins: still "Blue Steve (renamed)". **Killed and
relaunched the app**: `skinLibrary()` returned `2692e69f Blue Steve (renamed)`.

### Job 3: mod version picker + dependency preview (VERIFIED live)

Fast path unchanged: Discover's **Install** and Home's **+** still call `installProject` with no version. Tested:
no modal, 1.6 s.

New, optional path:
- Discover mod rows: a small **chevron** button ("Choose version…") beside Install.
- Home "Discover mods" cards: **right-click** the + (tooltip says so).

Both open `chooseModVersion`, a wide `openModal` in the same shape as `installModpackFlow`:
- Version list from `getCatalogProjectVersions(projectId, { loaders, gameVersions: [mcVersion] })`. `modLoadersFor()`
  mirrors `content.js loadersFor("mod")` exactly: fabric→`[fabric]`, quilt→`[quilt, fabric]`, forge→`[forge]`,
  neoforge→`[neoforge]` (+forge on 1.20.1). So it lists only what `content.install` would accept.
- Each row: version number, MC versions, loaders, relative publish date, release/beta/alpha tag. It preselects
  and tags **Default** = `content.js pickVersion` (newest release, else newest). So Install without touching anything
  gives what the plain click gives.
- Dependency preview for the **selected** version, from that version's own `dependencies` (accurate per version).
  Names come from `getCatalogDependencies`' `projects`, which is Modrinth's union across all versions, so it isn't
  used for the list itself; missing names are looked up once. Each dep shows Required/Optional/Bundled/Incompatible
  and "Already installed" / "Will be installed too" / "Not installed (optional)".
- Install sends `versionId` through `installContent` to `content.install`, which **already accepted `versionId`**.
  The only main-process change is a guard in `content.js` rejecting a `versionId` whose `project_id` isn't that project.

Live, on the sandbox Fabric 26.2 instance:
| test | result |
|---|---|
| Quick install Mod Menu (plain path) | no modal; `modmenu-20.0.3.jar` (= default), plus required deps `fabric-api-0.161.0+26.2.jar`, `placeholder-api-3.1.0-beta.1+26.2.jar` |
| Picker, Zoomify | list: `[x] 2.16.3+26.2 Default release`, `[ ] 2.16.2+26.2 release`, `[ ] 2.16.1+26.2 release`. Deps for 2.16.3: Fabric API Required, Already installed · Fabric Language Kotlin Required, Will be installed too · YACL Required, Will be installed too · Mod Menu Optional, Already installed |
| Picked the non-default **2.16.2+26.2**, clicked Install | heading switched to "What 2.16.2+26.2 needs". On disk: **`zoomify-2.16.2+26.2.jar`** (not 2.16.3), plus `fabric-language-kotlin-1.14.1+kotlin.2.4.20.jar` and `yet_another_config_lib_v3-3.9.7+26.2-fabric.jar`, which is exactly what the preview promised |
| Chevron on a real Discover row | row shows `Install/Installed` + `Choose version…`; chevron opens the picker |
| Escape out of picker | modal closed, **nothing installed** (mod count unchanged) |
| Right-click Home "Sodium" card | opens "Install Sodium" picker |
| Quilt 26.3 filter | loaders `[quilt, fabric]`; Mod Menu has 2 versions for 26.3, default `21.0.0`, all list 26.3 |

Note: the chevron also works on a mod that's already installed. That's a way to change its version (`content.install`
replaces Reminth's earlier copy of the same project). It's intentional and harmless, but the modal still says "Install".

**Installer not rebuilt this round.** The user had just closed Reminth, probably to run the round 8
`dist\Reminth-Setup.exe`, and overwriting that file mid-install could break it. These three changes need one more
`npm run dist` + install to reach the installed app.

## Round 8 (`CLAUDE_CODE_PROMPT_6.md`): Quilt 26.3 HUD crash fix deployed

Cause (from the prompt, user-observed): Quilt Loader 0.30.1 exposes fabric-loader compat **0.19.3**, so
round 7's jar (`"fabricloader": ">=0.19.5"`) stopped Minecraft from starting:
"ReminthHUD requires at least version 0.19.5 or any newer version of fabricloader, but only a different version is present: 0.19.3."
The source fix (`"fabricloader": "*"`) had already been saved in `wxhud\wxhud\src\main\resources\fabric.mod.json` (22:47).

| step | result |
|---|---|
| 1. Rebuild | VERIFIED. `gradlew build` gave `BUILD SUCCESSFUL`. `build\libs\reminthhud-1.0.0+26.3.jar` is 9,118 bytes, 22:50:09 (newer than the 22:47 source edit). SHA-256 `5701ab654ac31bb15056abdd1ddae714812d1e2854c49f14f14c91859ac5659a` |
| 2. Fix inside the jar | VERIFIED. Unzipped `fabric.mod.json`: `"version": "1.0.0+26.3"`, `"fabricloader": "*"`, `"minecraft": "~26.3"` |
| 3a. `reminth-launcher\assets\mods\reminthhud-1.0.0+26.3.jar` | VERIFIED updated (same SHA-256; `"fabricloader": "*"`). Committed in `89e6cf2` |
| 3b. `%APPDATA%\Reminth\instances\quilt-26-3-49e0\mods\reminthhud-1.0.0+26.3.jar` | VERIFIED updated (same SHA-256; `"fabricloader": "*"`). Before copying I checked that the running `javaw` was **not** this instance: its `--gameDir` was `…\Reminth\instance\game`, `--version reminth-26.2` (Fabric 26.2) |
| 4. Live retest (Quilt 26.3 boot + H, Fabric 26.2 relaunch) | **UNTESTED.** Needs the user in game. Also blocked on step 5, see below |
| 5. Installer | Rebuilt: `dist\Reminth-Setup.exe`, 22:51, SHA-256 `863d564e6117d821944aa56d059d18e02d51c38c502500d6d61b8135419b012d` (built to `dist\build-round8\`, exit 0, no errors). Its bundled 26.3 jar was checked: `"fabricloader": "*"`. **Not installed.** The user chose to install it themselves, because Reminth was running with a Fabric 26.2 game open |

**Important, and it contradicts the prompt's "step 3 is what actually matters":** the in-place copy (3b) does
**not** survive pressing Play in the currently installed app. `src/main/minecraft.js:148-149` rewrites the HUD
jar into the instance's `mods` folder from the app's **bundled** copy on every install/launch:
```
hudJar = path.basename(hudBuild.file);
await fsp.writeFile(path.join(modsDir, hudJar), await fsp.readFile(hudBuild.file));
```
And the installed app (`AppData\Local\Programs\Reminth\resources\app.asar`, from the 22:26 build) still bundles
`\assets\mods\reminthhud-1.0.0+26.3.jar` with `"fabricloader": ">=0.19.5"` (VERIFIED by extracting it).
So Play on Quilt 26.3 **before reinstalling** puts the broken jar back and crashes again. **Install the 22:51
`dist\Reminth-Setup.exe` first, then retest.**

Retest to do (user), in this order:
1. Close Minecraft and Reminth, then run `dist\Reminth-Setup.exe`.
2. Quilt 26.3 → Play. There should be no "Minecraft failed to launch" dialog, and it should reach the title screen.
   Enter a world and press H: the HUD toggles. Afterwards `instances\quilt-26-3-49e0\mods\reminthhud-1.0.0+26.3.jar`
   should still say `"fabricloader": "*"`.
3. Fabric 26.2 → Play once. It should still boot and H should still work. It uses the untouched `reminthhud-1.0.0.jar`.

Side note: the 26.2 jar still declares `"fabricloader": ">=0.19.5"`. That's fine on Fabric 26.2 (loader 0.19.5).
But a **Quilt 26.2** instance would hit the same crash. There's no such instance today. If one gets created, the 26.2 jar needs the same
`"*"` rebuild, which would mean building the wxhud project at `minecraft_version=26.2` again.

## Round 7 (`CLAUDE_CODE_PROMPT_5.md`): CI, auto-updater, ReminthHUD 26.3

Commits: `52635d9` CI · `51836e5` auto-updater · `dc344b9` HUD 26.3 jar · plus this report.

### Job 1: CI (VERIFIED green)

- `.github/workflows/ci.yml`: on push and pull_request to `main`, runs `windows-latest` (Windows-only app;
  some tests use Windows paths), `actions/checkout@v4`, `actions/setup-node@v4` with `node-version: lts/*`
  (no `.nvmrc`/`engines` pin exists) and npm cache, `npm ci` with `ELECTRON_SKIP_BINARY_DOWNLOAD=1`
  (tests stub `electron`), then `npm test`. No build or release steps.
- Checked the YAML with `js-yaml` locally. Parsed; triggers push/PR on `main`.
- Run for 52635d9: **completed success**, https://github.com/WxstedGOTY/reminth-launcher/actions/runs/36047378995.
  Every step succeeded, including `Run npm ci` and `Run npm test` (read from the Actions jobs API).
- Run for 51836e5 (auto-updater commit): **completed success** (run id 36047715152).

### Job 2: auto-updater

Wiring:
- `package.json`: `electron-updater ^6.8.9` in `dependencies`. `build.publish = [{ provider: "github",
  owner: "WxstedGOTY", repo: "reminth-launcher" }]`. No other installer settings touched. NSIS keeps
  electron-builder's default blockmap, so differential downloads are on (build output has `Reminth-Setup.exe.blockmap`).
- `src/main/updater.js`: new. Packaged builds only (`app.isPackaged`; a dev run has no `app-update.yml`).
  One check 10 s after the window's first load, `autoDownload` on, `autoInstallOnAppQuit` on. Events go to
  `%APPDATA%\Reminth\updater.log`. `update-available` sends `update:status {state:"downloading"}` and
  `update-downloaded` sends `{state:"ready"}`. Errors are logged only, with no UI.
- `src/main/main.js`: `updater.init({ notify: send })` in the existing `did-finish-load` hook, plus
  `ipcMain.on("update:install")` calling `autoUpdater.quitAndInstall()`.
- `src/main/preload.js`: `onUpdateStatus`, `installUpdate`.
- UI (`index.html`/`renderer.js`/`styles.css`): `#updateBar` reuses the existing `.toast` styling and the existing
  `.btn primary sm`. It stays up and takes clicks (the normal toast auto-hides after 3.6 s and ignores clicks, so
  it can't carry a button). Text: "Update available (Reminth X), downloading…", then "Reminth X is ready. It
  installs when you restart." with a **Restart to install** button.

Build output (VERIFIED): `win-unpacked/resources/app-update.yml` =
`owner: WxstedGOTY / repo: reminth-launcher / provider: github`. `latest.yml` written next to the
installer (`version: 1.1.0`). `electron-updater` is inside `app.asar` (212 entries).

No-update startup test (VERIFIED): ran the **packaged** `win-unpacked\Reminth.exe` in the isolated sandbox
home against the live GitHub latest release. `updater.log`:
```
2026-09-24T19:22:01.907Z checking (current 1.1.0)
2026-09-24T19:22:02.922Z error: Cannot find latest.yml in the latest release artifacts (https://github.com/WxstedGOTY/reminth-launcher/releases/download/Reminth_v1.1.0/latest.yml): HttpError: 404 
2026-09-24T19:22:02.922Z check failed: Cannot find latest.yml in the latest release artifacts (https://github.com/WxstedGOTY/reminth-launcher/releases/download/Reminth_v1.1.0/latest.yml): HttpError: 404 
```
The app kept running (4 processes after the check). `#updateBar` stayed hidden, with no renderer errors, and `features.js` was loaded.
The 404 is expected: release `Reminth_v1.1.0` only has `Reminth-Setup.exe`, no `latest.yml`, so it's silent
"nothing to do". Bar appearance was checked by showing it renderer-side only: 467×52, 74 px from the bottom,
`pointer-events: auto`, no overlap with the normal toast.

**Needs a real new release to verify end to end (UNTESTED):** download, the ready bar, and Restart to install.
How:
1. Bump `version` in `package.json` (e.g. 1.1.1) and run `npm run dist`.
2. Create a GitHub Release (marked latest) and upload **all three** from `dist\`: `Reminth-Setup.exe`,
   `Reminth-Setup.exe.blockmap`, `latest.yml`. Without `latest.yml` the updater sees nothing (the 404 above).
3. Open an installed 1.1.0 build that includes this updater. That means installing today's `dist\Reminth-Setup.exe`
   first, because the currently installed build predates the updater. Within ~10 s the bar should say downloading,
   then ready. Click Restart.
Note: installers built before this round don't contain the updater, so they will never self-update. The first
updater-enabled build has to be installed by hand once.

### Job 3: ReminthHUD 26.3

Versions, confirmed live on 2026-09-24 from the same sources fabricmc.net/develop reads:
- `meta.fabricmc.net/v2/versions/game`: 26.3 stable.
- `meta.fabricmc.net/v2/versions/loader/26.3`: newest stable loader `0.19.5` (unchanged).
- Modrinth `fabric-api` for 26.3: newest `0.161.0+26.3` (release, 2026-09-18). The prompt's `0.160.5+26.3` is older.
- Loom kept at `1.17-SNAPSHOT`. It builds 26.3 fine, so no reason to move to 1.18.

Changes in `Downloads\wxhud\wxhud\` (**not a git repo**; originals backed up to the session scratchpad):
- `gradle.properties`: `minecraft_version=26.3`, `fabric_api_version=0.161.0+26.3`, `version=1.0.0+26.3`
  (distinct jar name so it can sit beside the 26.2 `reminthhud-1.0.0.jar`). `loader_version=0.19.5` unchanged.
- `src/main/resources/fabric.mod.json`: `"minecraft": "~26.3"`.
- `src/client/java/com/wxsted/reminthhud/client/ReminthHudClient.java`: **real API break, fixed.** First build failed:
  ```
  ReminthHudClient.java:32: error: cannot find symbol
  					InputConstants.Type.KEYSYM,
    symbol:   variable KEYSYM
    location: class Type
  ```
  `javap` on Loom's 26.3 client jar: `InputConstants$Type` is now `KEYBOARD, MOUSE` (26.2 had
  `KEYSYM, SCANCODE, MOUSE`). The `KeyMapping(String, Type, int, Category)` constructor and `InputConstants.KEY_H`
  are unchanged. Changed `KEYSYM` to `KEYBOARD`. Second build: `BUILD SUCCESSFUL`, no warnings or errors printed.
- Output `build/libs/reminthhud-1.0.0+26.3.jar` (9,124 bytes). Contents checked: `fabric.mod.json` version
  `1.0.0+26.3`, `"minecraft": "~26.3"`, class file major version 69 (Java 25). The compiled client class references
  `KEYBOARD`, not `KEYSYM`.

Packaging decision: **two jars, not one range.** Each jar is compiled against one Minecraft version's code (26.3
already broke a 26.2 API), so a `~26.2 || ~26.3` range on a single jar would be an untested runtime guess.
The launcher already supports this. `bundledReminthHudBuilds()` reads every `assets/mods/reminthhud-*.jar`'s own
`fabric.mod.json` range, and `findReminthHudFor(mc)` picks the match. Checked against our source in the sandbox:
`26.2`/`26.2.1` gets `reminthhud-1.0.0.jar`, `26.3`/`26.3.1` gets `reminthhud-1.0.0+26.3.jar`, and `26.4`/`26.1.2` get none.
Both jars are inside the new build's `app.asar`.

Gate: new instances already default the HUD on when `hud:supports(mcVersion)` finds a build (the create/edit
dialog's ReminthHUD switch). So new 26.3 Fabric/Quilt instances get it automatically. The existing
`quilt-26-3-49e0` had been saved with `hud:false`, because no 26.3 build existed when it was created. I flipped it
through the launcher's own `instances.update(id, { hud: true })` (validated write; `instances.json` backed up first).
Now: reminth fabric 26.2 hud=true · forge 26.3 hud=false · neoforge 26.3 hud=false · **quilt 26.3 hud=true**.
There's no Fabric 26.3 instance on this machine.

In-game (UNTESTED, needs a human): the currently installed Reminth predates this jar. After installing the new
`dist\Reminth-Setup.exe`, pressing Play on Quilt 26.3 should put `reminthhud-1.0.0+26.3.jar` and Fabric API 26.3 into
`instances\quilt-26-3-49e0\mods\`, and H should toggle the overlay. Also re-check H on Fabric 26.2 (same 26.2 jar as before).

**Forge / NeoForge: out of scope, on purpose.** I checked both `reminth-launcher` and `wxhud` for `mods.toml`,
`neoforge.mods.toml`, `@Mod(`, `net.neoforged` and `net.minecraftforge`: nothing. All three jars in `assets/mods`
carry only `fabric.mod.json`. A Forge/NeoForge ReminthHUD would be a **separate mod project**: its own Gradle
setup (ForgeGradle / NeoGradle or ModDevGradle), its own `mods.toml` metadata, its own event-bus registration
for the key mapping and the HUD render layer. Realistically that means another module or repo, with its own build
per Minecraft version and its own testing, so it's measured in days, not a config change. The launcher side is
already shaped for it (it would need a second jar-metadata reader for `mods.toml` and dropping the
`loader === "fabric" || loader === "quilt"` gate). No stub code was written.

### Build

`dist\Reminth-Setup.exe` rebuilt 22:26 with the updater and both HUD jars. SHA-256
`668c5340c171f65d1bf0d67514fa93b03fb6ed44a264e7667b740047cb361b6f`. `dist\latest.yml` and `.blockmap` sit alongside.
`npm test` 53/53. Not installed, because the installed Reminth was running.

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

Current as of round 10 (2026-09-25). This replaces the older lists above.

- [ ] **Publish v1.1.1**: GitHub release tag `v1.1.1`, marked latest, with `Reminth-Setup.exe`,
      `Reminth-Setup.exe.blockmap` and `latest.yml` from `dist\` (round 10, Job 5).
- [ ] **Watch the auto-update happen**: open an installed updater-enabled 1.1.0 build (any installer from round 7 on),
      see the bar go downloading → ready, click Restart to install, confirm it comes back as 1.1.1. Needs a human.
- [ ] **Decide on `extract-zip`** (unpacks untrusted Modrinth modpacks, no fixed release exists). Suggested: refuse
      symlink/`..` entries via `zipread.js` before extracting in `mrpack.js` (round 10, Job 4).
- [ ] Decide on the major upgrades `npm audit` wants: `electron-builder` 26 (build-time chain incl. critical `tar`)
      and `electron` 44.
- [ ] In-game checks still owed to a human: ReminthHUD **H** on Quilt 26.3 and Fabric 26.2 with the fixed jar
      (round 8). Forge/NeoForge in a real world with a real account (round 10 stopped at the loaded first screen, offline).
- [ ] Delete `Downloads\reminth-launcher-push\` by hand. Everything in it is now in this repo (round 10, Job 4).
- [ ] Future project: a Forge/NeoForge ReminthHUD as a separate mod (round 7, Job 3).
- [ ] Unused preload APIs, keep or remove: `skinSetCape`, `hudBuilds`, `catalogWarmStatus`, `catalogWarmStart`
      (`skinLibrarySave` is used by tests).
- [x] Forge 26.3 and NeoForge 26.3 launch (round 10) · `PAGE_META` complete (round 6, re-checked round 10) ·
      refresh errors logged (round 10) · `wxhud-1.0.0.jar` and stale `instance\mods` removed (round 10) ·
      plain `npm run dist` works again · skin rename + version picker shipped in the 1.1.1 build.
