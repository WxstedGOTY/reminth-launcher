New round. Three jobs: CI, auto-updater, ReminthHUD coverage. Read this whole
file first.

## Job 1: CI — GitHub Actions running tests on every push/PR

Add `.github/workflows/ci.yml`: on push and pull_request to `main`, checkout,
setup Node (match the version in `package.json`/`.nvmrc` if one exists,
otherwise use latest LTS), `npm ci`, `npm test`. Fail the workflow on any
test failure. Keep it to just that — don't add build/release steps here,
that's a separate concern from job 2. Confirm the workflow file is valid
YAML and push it so it actually runs once on this push; check (via `gh` or
the Actions tab) that it goes green before moving on.

## Job 2: auto-updater — wire `electron-updater` to GitHub Releases

The repo already publishes installers to GitHub Releases manually. Add
`electron-updater` as a dependency and wire it up properly:

1. In the main process, on app ready (or a reasonable delay after), call
   `autoUpdater.checkForUpdatesAndNotify()` or the manual
   check/download/install flow if you want more control over UI timing.
   Point it at this repo's GitHub Releases (electron-updater's `github`
   provider — needs `owner`/`repo` in `package.json`'s `build.publish`
   config, matching whatever `electron-builder` config already exists).
2. Add a small renderer-side UI touchpoint: something like a toast/banner
   "Update available — downloading" → "Update ready, restart to install"
   with a restart button that calls `autoUpdater.quitAndInstall()`. Doesn't
   need to be fancy, just visible and functional. Follow the existing UI's
   style (check how other toasts/banners are done in `renderer.js`/
   `features.js`/the CSS, don't invent a new pattern).
3. Confirm `electron-builder`'s NSIS config already supports differential
   updates (it does by default) — don't change installer settings unless
   something's actually broken.
4. This can't be fully tested locally (needs a real published release newer
   than the installed version), so: build it, confirm it doesn't crash on
   startup with no update available (test against the current latest
   release — should silently find nothing new), and document in
   `REMINTH_STATE.md` that full update-flow testing needs an actual new
   GitHub Release published after this one to verify against.

## Job 3: ReminthHUD coverage — Fabric/Quilt 26.3 is a real fix, Forge/NeoForge is not

I had someone check the HUD's source project directly. Facts, not guesses:

- It's a standard Fabric Loom project at `wxhud\wxhud\` (note: nested twice,
  `Downloads\wxhud\wxhud\`, not `Downloads\wxhud\`) — `build.gradle`,
  `gradle.properties`, `settings.gradle`, source under
  `src/main/java/com/wxsted/reminthhud/` and
  `src/client/java/com/wxsted/reminthhud/client/`.
- Currently pinned in `gradle.properties`: `minecraft_version=26.2`,
  `loader_version=0.19.5`, `loom_version=1.17-SNAPSHOT`,
  `fabric_api_version=0.159.0+26.2`. `fabric.mod.json` depends on
  `"minecraft": "~26.2"`.
- Fabric API `0.160.5+26.3` exists (confirmed on Modrinth/GitHub) — a build
  for MC 26.3 is available upstream, meaning a 26.3 rebuild is a real,
  tractable version bump, not a rewrite.

Do this:

1. Check https://fabricmc.net/develop for the current exact Fabric Loader
   and Fabric API version pins for MC 26.3 (don't trust the numbers above
   blindly, confirm live) and update `wxhud\wxhud\gradle.properties`:
   `minecraft_version=26.3`, `fabric_api_version` to the correct 26.3 build,
   `loader_version` if it changed. Update `fabric.mod.json`'s
   `"minecraft": "~26.3"` too (or a range covering both if that's cleaner —
   your call, but confirm whichever you pick actually builds).
2. Build it (`gradlew build` from `wxhud\wxhud\`) and confirm the jar
   produces with no compile errors. Existing Java code may or may not need
   changes for the new Fabric API/mappings — if it doesn't compile clean,
   fix what's actually broken, don't paper over it.
3. Decide the packaging: does the launcher need TWO ReminthHUD jars bundled
   (one per MC version) with the loader auto-picking based on the
   instance's `mcVersion`, or does one jar work across both via the
   `fabric.mod.json` version range? Check how `assets/mods/` and whatever
   installs the HUD into an instance currently decides which jar to use
   (grep the launcher's main/renderer code for `hud`/`reminthhud`) and wire
   it so the Quilt-26.3 instance actually gets a working HUD build. Right
   now `instances/*/hud` is `false` for the 26.3 instances — once a working
   26.3 build is bundled and wired in, flip that gate so Fabric/Quilt-26.3
   instances get `hud: true` like the 26.2 one, and confirm H still toggles
   it correctly (you can test this live the same way HUD-in-game was
   confirmed working earlier — Fabric 26.2 world, press H).
4. Forge and NeoForge: do NOT attempt this. They use a completely different
   modding API (`mods.toml`, different registration/mixin system) — this
   would mean writing a second, separate mod project from scratch, not a
   config change. Confirm this understanding is correct by briefly checking
   whether any Forge/NeoForge HUD attempt already exists anywhere in the
   repo (it shouldn't), and if none does, just write one paragraph in
   `REMINTH_STATE.md` scoping it as a real future project (separate repo/
   module, real time investment) rather than something to fix tonight. Do
   not write placeholder/stub Forge code "just in case" — leave it alone.

## Before you finish

Commit and push all three jobs (separate commits per job is fine and
probably clearer than one giant commit). Update `REMINTH_STATE.md`: CI
workflow status (green or not, and why if not), auto-updater wiring details
and what still needs a real new release to verify, and the full HUD
26.3 rebuild results (exact versions used, build success/failure, whether
it's wired into the Quilt-26.3 instance and confirmed working, and the
Forge/NeoForge scoping note).
