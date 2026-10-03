# Reminth Launcher

An independent Minecraft: Java Edition launcher for Windows. Sign in with
your own Microsoft account, pick a version and a mod loader, press Play:
Reminth downloads the game, the loader and the right Java for you, and keeps
each setup in its own instance.

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG
OR MICROSOFT. You need your own Minecraft: Java Edition licence.

## What it does

- **Instances**: any Minecraft version, with Fabric, Quilt, Forge, NeoForge
  or no loader. Each instance has its own mods, worlds, packs and logs.
- **Sign-in**: Microsoft device-code flow (Microsoft → Xbox Live → XSTS →
  Minecraft Services). Tokens are stored with Electron safeStorage (Windows
  DPAPI).
- **Java**: Mojang's own runtime for each version, installed privately
  (Microsoft's OpenJDK as a fallback). System Java is never touched.
- **Discover**: browse and install mods, modpacks (`.mrpack`), resource
  packs, data packs and shaders from Modrinth; see and install updates;
  browse and ping servers.
- **Compatibility check**: before the game starts, Reminth works out which
  mods won't load on the instance's version/loader and why, offers a
  one-click fix ("Fix and play"), and can suggest the Minecraft version that
  fits all the mods (and a server), making a copy of the instance on that
  version. Copies never include worlds.
- **Performance pack** (`config.PERFORMANCE_PACK`): fetched from Modrinth,
  release builds only, at least 48 h old, sha1-checked, then checked against
  the instance by the jar's own metadata. Fabric/Quilt: Sodium, Lithium,
  FerriteCore, ImmediatelyFast, Entity Culling, ScalableLux (plus Fabric API
  from Fabric's Maven). NeoForge adds ModernFix; Forge gets Embeddium, Radium,
  ModernFix, FerriteCore, Entity Culling, ImmediatelyFast. One rule,
  `config.perfPackEnabled`: Fabric/Quilt on unless `performanceMods: false`;
  Forge/NeoForge only with `performanceMods: true`; vanilla never; imported
  modpacks never. The player's own copy of a mod, or a conflicting mod, always
  wins; a pack jar the player disabled or deleted is not put back (Restore
  resets). GitHub is only a fallback for Sodium/Lithium/ScalableLux when
  Modrinth is down and nothing is cached.
- **Performance profiles**: Balanced / Max FPS / Far view per instance. Max FPS
  and Far view write a starting `options.txt` for a brand-new instance only
  (never over an existing file; `graphicsPreset:"custom"` from 1.21.11 on).
  Java flags are chosen per Java version (`buildJvmFlags`), Minecraft runs at
  above-normal priority (setting), and Settings can open Windows' graphics page.
- **ReminthHUD**: Reminth's own HUD mod, per-instance switch, bundled in
  `assets/mods/`.
- **Skins and capes**: view, change, keep a library of skins.
- **Logs**: game logs and crash reports per instance, archived.
- **Streamer mode**: screenshots and a replay buffer ("save the last N
  seconds") of the Minecraft window.
- **Auto-update**: electron-updater against this repo's GitHub releases;
  downloads in the background, installs on restart/quit.

No telemetry, analytics or crash reporting. No cheats of any kind.
Reminth+ and server hosting are previews only; nothing is sold.

## Run, test, build

```
npm install
npm start          # run the launcher (Electron)
npm test           # node --test, a few hundred pure-logic tests, no extra packages
build-dist.bat     # builds the installer -> dist\Reminth-Setup.exe
```

The build is electron-builder (NSIS target); `npm run dist` is the
underlying script. The installer is not code-signed, so SmartScreen warns
on first run.

Sign-in uses the Azure app registration in `src/main/config.js`
(`MS_CLIENT_ID`, overridable with `REMINTH_MS_CLIENT_ID`).

## Publishing

- **App**: bump `version` in `package.json`, build, and attach
  `Reminth-Setup.exe`, its `.blockmap` and `latest.yml` to a new GitHub
  release. Installed launchers update themselves from the latest release,
  and the website's download button points at
  `releases/latest/download/Reminth-Setup.exe`.
- **Website**: the `site/` folder, uploaded by hand to Cloudflare Pages
  (https://reminth.pages.dev). It is static and must not load anything from
  a third party. `site/privacy.html` and `site/terms.html` are the legal
  texts; the in-app summaries (Settings) must say the same thing. When the
  app's behaviour changes, update them and bump their version.

## Layout

```
src/main/        Electron main process
  main.js          entry point, IPC, launch flow
  msAuth.js        Microsoft/Xbox/Minecraft sign-in     store.js   account + settings on disk
  minecraft.js     install + launch                     java.js    Java runtimes
  loaders.js forge.js   loader metadata and installs    downloader.js  verified downloads
  instances.js     instance list and folders            migrate.js copy an instance to another version
  modrinth.js content.js mrpack.js catalogCache.js      Discover, installs, updates, modpacks
  compat.js        mod compatibility check and version advice
  skin.js skinLibrary.js   skins and capes              logs.js gameData.js nbt.js   logs, worlds, stats
  serverPing.js    server list ping                     streamer.js webm.js   screenshots and clips
  updater.js       auto-update                          entitlements.js   RAM cap, Reminth+ stub
  paths.js config.js atomic.js zip.js zipread.js preload.js
src/renderer/    UI (index.html, renderer.js, features.js, styles.css, skinview.js)
site/            public website and legal pages
test/            node --test suites
assets/          icons and the bundled ReminthHUD jars (not in every checkout)
REMINTH_STATE.md working notes and history
```

## Where data lives

Everything is on the player's PC, under `%APPDATA%\Reminth`:

- `account.json` (encrypted sign-in tokens), `settings.json`, `instances.json`
- `instance\` (the original instance and the shared game files) and
  `instances\<id>\` (every other instance: `mods`, `saves`, `logs`, …);
  each has a `.reminth\` folder recording what Reminth installed there
- `java\`, `runtimes\` (Java), `skins\`, `skin-cache\`, `catalog-cache\`,
  `creators-cache.json`
- `updater.log`, `auth.log`, `main-errors.log`, `launch-logs\` (last game
  output per instance), `log-archive\`
- `replay-buffer\` (temporary); clips and screenshots go to `Videos\Reminth`

Reminth never touches the official `.minecraft` folder.
