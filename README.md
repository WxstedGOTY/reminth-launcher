# Reminth Launcher

A custom Windows Minecraft launcher: sign in with your own Microsoft
account, it downloads vanilla Minecraft 26.2 + Fabric + ReminthHUD
automatically, and launches the game. No official Minecraft Launcher, no
Modrinth dependency, anywhere in the shipped product.

## Status

Confirmed working end-to-end on a real Windows PC, against real
Mojang/Fabric/Microsoft infrastructure: sign-in (Microsoft device-code flow
→ Xbox Live → XSTS → Minecraft Services), the full install pipeline (Java,
version manifest, Fabric merge, libraries, natives, assets, Fabric API,
ReminthHUD, optional performance mods), and an actual successful Minecraft
launch into a joinable world/server. 33/33 unit tests pass (`npm test`).

Two real bugs were found and fixed along the way, both worth knowing about
if you're touching `minecraft.js`:

- **Silent launch failures**: the game process used to be spawned with
  `stdio: "ignore"` and no error/exit handlers, so any crash was completely
  invisible — the launcher reported "launched: true" no matter what
  actually happened. Fixed: stdout/stderr now go to
  `%AppData%\Reminth\latest_log.txt`, and a crash within the first 15s
  surfaces in the UI.
- **Mojang's conditional argument objects**: `arguments.jvm`/`arguments.game`
  in Mojang's version JSON mix plain strings with rule-gated objects like
  `{rules: [...], value: "..."}` (macOS-only flags, `--demo`,
  `--width`/`--height`, `--quickPlay*`). These used to be concatenated
  unresolved, so one could reach `spawn()` unfiltered, get stringified to
  `"[object Object]"`, and get misread by Java as the main class to load.
  Fixed by `resolveArguments()`, which filters by OS/feature rules before
  anything reaches the spawned process.

## Setup

### 1. Azure app registration (required, free)

Every third-party Minecraft launcher needs its own Microsoft app ID — this
is what makes "Sign in with Microsoft" work, and it needs Microsoft's
approval to actually reach the Minecraft Services API (takes about a week;
until approved, sign-in completes through Microsoft/Xbox fine but the final
token exchange 403s with "Invalid app registration" — that's expected, not
a bug).

1. https://portal.azure.com → **Azure Active Directory** → **App
   registrations** → **New registration**
2. **Supported account types**: "Personal Microsoft accounts only"
3. Redirect URI: leave blank (not needed for device code flow)
4. Register, copy the **Application (client) ID**
5. Submit for Minecraft API access: https://aka.ms/mce-reviewappid
6. Put the client ID in `src/main/config.js` as `MS_CLIENT_ID`, or set env
   var `REMINTH_MS_CLIENT_ID`

No client secret needed — public client (device code) flow, same as
MultiMC/Prism.

### 2. Install & run

```
npm install
npm test    # pure-logic unit tests, node --test, zero extra packages
npm start
```

### 3. Package the Windows installer

```
npm run dist
```

Outputs an NSIS `.exe` installer to `dist/`. Unsigned for now (no code
signing cert) — first-run SmartScreen warning is expected until that's
addressed.

## Project layout

```
src/main/main.js        Electron entry point, IPC wiring
src/main/msAuth.js      Microsoft -> Xbox Live -> XSTS -> Minecraft auth (device code flow)
src/main/minecraft.js   Version resolution, download, Fabric merge, launch
src/main/java.js        Downloads a private JDK 25 (never touches system Java)
src/main/store.js       Encrypted-at-rest account/refresh-token storage (Electron safeStorage)
src/main/config.js      <-- fill in MS_CLIENT_ID and REMINTHHUD_UPDATE_MANIFEST_URL here
src/renderer/           UI (glassmorphism, charcoal + electric teal, per the brand doc)
```

## Known gaps (not blockers, just not done yet)

- **No auto-updater.** Every future fix needs a fresh manual download.
- **ReminthHUD has no update manifest yet** (`REMINTHHUD_UPDATE_MANIFEST_URL`
  is unset) — it ships as a static bundled jar; updating it means a new
  Reminth release, not a hot-update.
- **Sodium / ScalableLux** have no published Fabric build for Minecraft
  26.2 yet — that's upstream, not us. The installer already handles this
  gracefully (logs it, skips, doesn't fail the install).
- Only ever verified on one PC. Not yet tested on a genuinely clean
  machine with zero prior Java/Minecraft history.

## What this deliberately does NOT include

No targeting/aimbot, ESP, or packet-manipulation modules. Those were
scoped out from day one. This is a clean launcher + cosmetic HUD overlay
only.
