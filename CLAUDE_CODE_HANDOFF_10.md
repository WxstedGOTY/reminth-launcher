# Reminth — full handoff for Claude Code (3 Oct 2026)

You are continuing work on **Reminth**, an Electron Minecraft launcher for Windows.
Repo on this PC: `C:\Users\kolijos\Downloads\reminth-launcher` (GitHub `WxstedGOTY/reminth-launcher`, branch `main`).
Owner: Wxsted (Lefteris Psilopanagiotis, Greece). Contact address used everywhere: `reminthsupport@gmail.com`.

Read this whole file before touching anything. Then read `PERF_PLAN.md` (same folder) — it is the researched plan for the work that is in progress.

---

## 0. How the owner wants you to work

- Blunt, answer first, short. No praise, no padding. Real numbers and failure modes.
- **"0 mistakes"**: verify before claiming. Run `npm test` after every batch. Never say something works unless you ran it. Say plainly what you could not test.
- He is often away from the PC: don't stop to ask unless every path is irreversible. Make the sensible choice, say what you assumed, carry on.
- Never open with validation. If an idea is bad, say so first.
- At the end give a **plain list of every change**, simple words.
- No money can be spent (no domain, no code-signing certificate, no paid hosting).
- Do not touch his screen while Minecraft is open (he plays on this PC).
- Commit attribution lines for commits you make:
  `Co-Authored-By: Claude <noreply@anthropic.com>`

## 1. Hard rules of the codebase

- Electron app, plain JS, CommonJS, `"use strict"`, 2-space indent, comments explain WHY in plain words.
- Renderer (`src/renderer/`) is classic scripts sharing globals (`renderer.js`, `features.js`), **no bundler, NO `innerHTML` anywhere** — use `el()`, `icon()`, `button()`, `textContent`.
- Line endings: `src/renderer/styles.css`, `src/main/java.js`, `src/main/store.js`, `src/main/paths.js` and the three `site/*.html` files are **CRLF**. Everything else LF. Keep them.
- The last rule in `styles.css` must stay last: `*, *::before, *::after { background-origin: border-box !important; }` (it removes the thin lighter line inside gradient boxes — the owner's "blue box" bug).
- Tests: `npm test` (= `node --test`). No network, no Electron needed; tests stub what they need. **367 tests must pass** after you apply section 4. Never weaken a test to make it pass.
- Minimal, surgical diffs. Don't redesign. Don't rename exported functions others use (grep first).
- Reminth must **never delete a player's own mod**, never overwrite a player's `options.txt`, never install alpha/beta mods silently, never leave a half-written settings/instances/account file.
- App shows changes only after `build-dist.bat` → `dist\Reminth-Setup.exe`.

## 2. Folder layout

```
src/main/      main process (main.js, minecraft.js, content.js, compat.js, migrate.js, instances.js,
               store.js, atomic.js, modrinth.js, mrpack.js, zipread.js, zip.js, java.js, loaders.js,
               forge.js, downloader.js, msAuth.js, serverPing.js, streamer.js, skin*.js, logs.js,
               gameData.js, catalogCache.js, entitlements.js, config.js, paths.js, preload.js)
src/renderer/  index.html, renderer.js, features.js, styles.css, skinview.js
src/recorder/  recorder window for clips
site/          public website (index.html, privacy.html, terms.html, legal-base.css, logo/favicon, mods/*.webp)
test/          node:test files
assets/        icons, bundled HUD jars
publish.ps1 + run-publish.bat   commit → pull --rebase → npm test → push (logs to publish-log.txt)
run-tests.bat                   npm test → npm-test-latest.txt
build-dist.bat                  npm run dist
```

Data on the PC: `%APPDATA%\Reminth` (settings.json, instances.json, account.json (encrypted), caches, logs) and each instance folder with `.reminth/` bookkeeping (`content.json`, `managed-mods.json`, `instance.json`).

## 3. State of the repo right now

### 3a. Already in the folder (version 1.2.0), NOT yet built or pushed
53 files were written into the repo folder. In the cloud sandbox they passed 333 tests. **They have never been run on Windows.** First thing you do: see section 5, step 1.

What 1.2.0 contains (all done, reviewed three times by independent reviewers, findings fixed):

**Compatibility help (the owner's main complaint: "Incompatible mods", hours finding versions, server version mismatch)**
- `src/main/compat.js` (new): `checkInstance` (which enabled mods won't load and why, with a fix each: swap build / install missing mod / switch off), `adviseVersions` (which Minecraft version fits all mods + a server), `projectSupport`, `jarFitsInstance`, Fabric version-predicate logic checked against Fabric Loader's source, `findDependencyProblems` (depends/breaks/duplicates, nested jars, `fabric_loader_dependencies.json` override downgrades "blocked" to "warn"). A false "blocked" is the worst outcome — anything uncertain is a warning or silent.
- `src/main/migrate.js` (new): copy an instance to another Minecraft version (new instance, mods re-fetched, options/servers/resource packs/shaders/config carried, **never worlds**, original untouched).
- UI: compatibility panel on the Mods tab with per-issue fix + "Fix all"; Play gate "Minecraft won't start like this" (Fix and play / Play anyway / Cancel); "Which Minecraft version should I use?" advisor; server rows show accepted versions; no-build modal; Discover hints; picker marks instances that don't fit.
- IPC: `compat:check`, `compat:advise`, `compat:support`, `compat:serverVersions`, `compat:copyToVersion`, event `compat:progress`.

**Bugs fixed (audit + three review rounds)**
- Player's own mods never deleted; Reminth only deletes files listed in `.reminth/managed-mods.json`. One-time adoption of jars an older Reminth installed.
- Atomic writes (`src/main/atomic.js`: `writeFileAtomic`, `writeJsonAtomic`, `renameWithRetry`, `quarantine`, `withLock` — **not re-entrant**) for settings, account, instances, content manifest; `.bak` + quarantine of corrupt files; instance registry rebuild from folders.
- Downloads: temp file + hash/size check + rename, retries, stall timeout, sweep of stale `.part`/`.tmp`.
- `releaseMatchesVersion` boundary match (1.21.1 ≠ 1.21.10), pre-releases never installed, downloaded perf jars verified against the instance before being kept.
- Single-instance lock; auth generation/single-flight; token refresh only near expiry; expired sign-in really signs out; fetch timeouts everywhere.
- Instance delete vs watcher; offline launch of installed instances (Mojang/MS runtimes, loaders, asset index); server ping port/IPv6; `servers.dat` never wiped; logs dedupe.
- `running` claim identity: Stop during install really stops; Stop→quick Play can't double-launch.
- Zip reader: strict mode only for the `.mrpack` safety scan, lenient for mod jars; `.reminth` paths in packs refused; zip-bomb caps.
- Modrinth client: retry/backoff, body inside retry, friendly timeout text.
- Performance pack (Sodium/Lithium/ScalableLux from GitHub releases, Fabric/Quilt): steps aside for the player's own copy/conflicts, holds back when a player's mod pins a version (Iris↔Sodium), removes wrong-version managed jars, per-instance on/off switch (`instance.performanceMods`), off for modpack instances.
- Tokens never saved unencrypted. RAM ceiling 16 GB (`entitlements.js`).
- Renderer: 18 QA findings (focus trap in modals, double-click guards, wrong-instance installs — every install path captures its target at click time, off-screen picker, bulk bar on all tabs, raw fs errors hidden, skin delete confirm, etc.), ~15 layout glitches, "Hide personal info" really blurs name/addresses/paths/logs, honest wording for RAM and "Showing what fits".
- Website/legal: Privacy + Terms **Version 5 (2 Oct 2026)**, site moved to Cloudflare Pages `https://reminth.pages.dev`, no Google Fonts, fake Sign up/Sign in buttons removed, no hard-coded version, README rewritten. In-app summaries match.

### 3b. Delivered with this handoff — apply these first (performance step 1, done and tested: 367 pass)
Eight files sit next to this document and are also written into the repo by the previous assistant if the PC was reachable. **Check**: if `test/perf-jvm.test.js` exists in the repo, they are applied. If not, copy them in (names use `__` for `\`):

```
src__main__java.js            → src\main\java.js        (CRLF)
src__main__main.js            → src\main\main.js
src__main__minecraft.js       → src\main\minecraft.js
src__main__preload.js         → src\main\preload.js
src__main__store.js           → src\main\store.js       (CRLF)
test__fixes-main2.test.js     → test\fixes-main2.test.js
test__minecraft.test.js       → test\minecraft.test.js
test__perf-jvm.test.js        → test\perf-jvm.test.js   (new)
```

What they add:
- `minecraft.buildJvmFlags({ javaMajor, maxMemoryMb, totalMemMb, cpuCount, windowsBuild, gc, userArgs })` — version-gated flags replacing the old fixed Aikar server set:
  - Java 25+ and eligible (Windows build ≥ 17134, Xmx ≥ 4096, ≥ 4 threads): `-XX:+IgnoreUnrecognizedVMOptions -Xms{min(Xmx,2048)}M -Xmx -XX:+UseZGC -XX:+UseCompactObjectHeaders -XX:+AlwaysPreTouch -XX:+UseStringDeduplication -Dlog4j2.formatMsgNoLookups=true` (Mojang's own 26.x set).
  - Java 17–24, or 25+ not eligible: G1 with `G1NewSizePercent=20 G1ReservePercent=20 MaxGCPauseMillis=50 G1HeapRegionSize=32M UseStringDeduplication` (+CompactObjectHeaders on 25+).
  - Java 8–16: Java-8-safe G1 set.
  - Conflict rule: if the player's extra args (or the version JSON) name a collector, Reminth emits none of its collector flags (this fixed "Multiple garbage collectors selected" = game won't start).
- Safe-mode relaunch: `planSafeModeRetry` — if the JVM refuses its arguments within 8 s (known refusal strings in the launch log), relaunch **once** with minimal flags and send `play:safeMode { instanceId, reason }`. Gap: `javaw.exe` shows a dialog for some argument errors and doesn't exit until OK is clicked, so those cases still look like a crash.
- `defaultMaxMemoryMb(totalMemMb, { modpack, modCount, capMb })`: ≤ 8 GB PC → 3 GB; normal 2–6 GB; modpack or > 60 mods → min(8 GB, 60 % of RAM, cap).
- `os.setPriority(child.pid, ABOVE_NORMAL)` after spawn; setting `processPriority` ("above-normal" default | "normal"), forced normal while streamer mode is on.
- Settings `gc` ("auto" default | "g1" | "zgc") and `processPriority` in `store.js` (sanitised).
- IPC `perf:info(instanceId?)` → `{ totalMemMb, cpuCount, windowsBuild, ramCapMb, defaultMemoryMb }`; `perf:gpuHelp` → opens `ms-settings:display-advancedgraphics`, returns `{ javaPaths, opened }` (no registry writes — deliberate). Preload: `perfInfo`, `perfGpuHelp`, `onSafeMode`.
- **The renderer has NO UI for any of this yet** (no gc control, no priority switch, nobody listens to `play:safeMode`).

### 3c. NOT done — your work (section 6)
Three pieces were specified and started but **nothing usable was produced** (the assistant ran out of quota seconds in). Treat them as not started.

## 4. What the user must do / what is waiting on him

1. `build-dist.bat` → new installer. 2. `run-publish.bat` → tests + push. 3. Cloudflare dashboard → project `reminth` → new deployment → upload the `site` folder (direct upload; not connected to GitHub, so every site change needs a manual re-upload).
You have the PC: you can do 1 and 2 yourself (he asked for work to continue without him). Do **not** push if `npm test` fails. You cannot do 3 unless he is logged in to Cloudflare in a browser you can drive; if not, remind him.

## 5. Your order of work

**Step 1 — verify 1.2.0 on real Windows (nobody has yet).**
- `npm install` if `node_modules` is missing, then `npm test`. Expect 367 pass (333 if the 3b files aren't applied — apply them). Tests were only ever run on Linux; Windows-specific failures (paths, rename over open files, case-insensitive names, CRLF, real `electron`/`extract-zip` modules being present instead of stubs) are possible. Fix the code or the test honestly; tell the owner what failed.
- `npm start` and click through: Home, Discover (mods/packs/servers), an instance (all tabs), create/edit/delete instance, Settings, Skins, sign-in state. Watch the DevTools console and `%APPDATA%\Reminth\main-errors.log`. `main.js` was heavily changed and **has never run under real Electron** — only under a fake-Electron test harness.
- Launch a Fabric instance once (if he isn't playing): confirm the game starts, check `<instance>\reminth-performance-mods.log` and `.reminth\managed-mods.json`, confirm the JVM line in the launch log has exactly one collector flag.
- Only then build and publish.

**Step 2 — finish performance work (section 6).**
**Step 3 — update docs for it (section 7).**
**Step 4 — roadmap leftovers (section 8).**

## 6. Performance work to do (owner's request, verbatim intent)

"Start the lag-spike fixes for higher render distance, do everything you can for better FPS, I want to surpass other popular big launchers. Even if we can't outperform them, get FPS as high as possible by changing anything except something that can corrupt the launcher or anything bad/dangerous."

Read `PERF_PLAN.md` Part 3 — it has the evidence, the exact lists, and a "do not do" table. **No FPS number has ever been measured**; never claim a gain you didn't measure. If you can, measure (same seed, render distance 12 and 24, 1 % lows, frames over 50 ms) before/after.

### 6a. Performance pack 2.0 from Modrinth (files: `minecraft.js` pack code + `ensureInstalled`, `config.js`, `content.js`, `compat.js`, `mrpack.js`, `modrinth.js`; new `test/perf-pack.test.js`)
Keep every safety property of the existing pack code (adoption, step-aside, hold-back, misfit removal, tidy, `skipped` map, jar verification, logging). Do NOT change `launch`, `buildJvmFlags`, safe-mode or memory code.

1. Source = Modrinth, **release builds only**, sha1-verified, then `compat.jarFitsInstance`. Per entry: `modrinth.getProjectVersions(slug, { loaders: content.loadersFor("mod", instance), gameVersions: [mc] })`, keep `version_type === "release"`. Soak rule: prefer the newest release ≥ 48 h old; if all are newer, take the oldest of them only when no managed copy is installed. Required dependencies under the same rule (Fabric API is satisfied by the managed one); a dependency with no release → skip the mod and log why. Cache the choice per slug+mc+loader for 6 h in the launcher cache dir; use the cache when Modrinth is down; down + no cache → delete nothing, keep what's installed, and fall back to the existing GitHub path for the original three only.
2. `config.PERFORMANCE_PACK = [{ slug, label, ids, conflicts, loaders, github? }]`:
   - Fabric/Quilt: `sodium`, `lithium`, `ferrite-core`, `immediatelyfast`, `entityculling`, `scalablelux`.
   - NeoForge: `sodium`, `lithium`, `ferrite-core`, `immediatelyfast`, `entityculling`, `modernfix`, `scalablelux`.
   - Forge: `embeddium`, `radium`, `modernfix`, `ferrite-core`, `entityculling`, `immediatelyfast`.
   - NOT silent defaults: `modernfix-mvus` (third-party fork), `dynamic-fps`, `badoptimizations`, `ixeris`, `c2me-fabric` (alpha; it hung world creation for a real user).
   - Verify slugs against Modrinth before shipping. Derive mod ids from the downloaded jar's own metadata (`content.readJarMeta`) rather than hard-coding where unsure. `conflicts`: sodium ↔ embeddium/rubidium/magnesium/optifine/optifabric/vulkanmod; lithium ↔ radium/canary; scalablelux ↔ starlight/phosphor/moonrise; modernfix ↔ the mvus fork.
3. One pure rule used everywhere (`minecraft.js`, `compat.js`, `mrpack.js`, renderer): `config.perfPackEnabled(instance)` — Fabric/Quilt: `performanceMods !== false`; Forge/NeoForge: `performanceMods === true` (**off for every existing Forge/NeoForge instance** — a duplicate mod id crashes Forge; on only for new instances where the create dialog sets it); vanilla: false. Fabric API and ReminthHUD stay Fabric/Quilt only.
4. Respect the player's choices about Reminth's jars (present bug: disabling Reminth's Sodium renames it to `.jar.disabled`, and the next launch downloads a second copy): only `<name>.disabled` exists → `optedOut[mod] = { by: "disabled" }`, don't download; managed file gone and Reminth didn't remove it → `optedOut[mod] = { by: "deleted" }`. Cleared when the file is re-enabled, when the pack is switched off and on, or by a new exported `resetPerformancePack(instance)`.
5. Generalise step-aside/hold-back/misfit/tidy from the three fixed names to the config data. "Player has own enabled copy of the same id or any `conflicts` id → skip Reminth's." On Forge/NeoForge: before keeping a download, if any other enabled jar has the same mod id, delete the download.
6. Adoption stays for the legacy names only; new entries are never adopted by file name.
7. Export `performancePackStatus(instance)` → `{ enabled, loader, mods: [{ slug, label, state: "installed"|"pending"|"off"|"no-build"|"stepped-aside"|"held-back"|"switched-off-by-you"|"failed", file, version, detail }] }`, from the manifest plus a `lastRun` record written at the end of each `ensureInstalled`. Never throws.
8. In `ensureInstalled`, after the client jar exists: `try { await require("./gameOptions").seedIfAbsent({ gameDir, perfProfile: instance.perfProfile, clientJar, totalMemMb, cpuCount }); } catch {}`.
9. Network budget: ≤ 1 Modrinth request per entry per launch when not cached, concurrency 3, total wait capped ~12 s (then proceed with what's installed).
10. Fix stale comments in `config.js` (says "all stable releases", describes ScalableLux as the client stutter fix — it mainly helps singleplayer's integrated server).
11. Tests: release-only, soak, hash mismatch, misfit jar, dependency without release, cache hit, Modrinth down with/without cache, `perfPackEnabled` table, own copy by id and by conflict id, OptiFine present, Forge duplicate id, disabled twin, deleted file, re-enable, reset, status states. Then walk these 10 scenarios and state each outcome: new Fabric instance online / offline; old instance without manifest; fresh modpack instance; player installs own Sodium; pack off→on; Minecraft version change; Iris pinning an exact Sodium; rate limit/outage; two instances at once.

### 6b. Performance profiles, backend (files: `instances.js`, `main.js`, `preload.js`, new `gameOptions.js`, new `perfProfiles.js`, `test/perf-profiles.test.js`)
Stray partial files `src/main/gameOptions.js` / `perfProfiles.js` do not exist in the repo — write them fresh.

1. `instance.perfProfile`: "balanced" (default when absent) | "max-fps" | "far-view" — sanitise, create, update, per-instance meta.
2. `gameOptions.seedIfAbsent({ gameDir, perfProfile, clientJar, totalMemMb, cpuCount })` → `{ written, reason }`, never throws. Writes `options.txt` **only if all hold**: profile is max-fps or far-view; `options.txt` doesn't exist; no worlds in `saves`; no `logs/latest.log`; the client jar's `version.json` has a numeric `world_version` (written as the `version:` key — without it the game replaces the file with defaults). Only the keys below + `version`. Don't write a key unless its name and on-disk format for that Minecraft version are certain (`graphicsMode` became `graphicsPreset` on recent versions — if unsure, leave it out). Record `.reminth/options-seeded.json`.
   - max-fps: `renderDistance:10`, `simulationDistance:8`, `particles:1`, `entityShadows:false`, `biomeBlendRadius:1`, `entityDistanceScaling:0.75`, `enableVsync:false`, `maxFps:260`.
   - far-view: `renderDistance:16` (20 with ≥ 8 threads and ≥ 16 GB; 24 with ≥ 12 threads and ≥ 32 GB), `simulationDistance:8`, `biomeBlendRadius:2`, `entityDistanceScaling:1.0`, `prioritizeChunkUpdates:0`.
   - balanced: never writes anything.
   - **Must be tested by actually starting the game per version family** (1.16, 1.20, 1.21, 26.x): values took, nothing else reset.
3. `perfProfiles.js`: per profile a title, an honest 2-line description, and `extras` the player may add (**never silently installed**): max-fps → `dynamic-fps`, `badoptimizations`, `moreculling`; far-view → `distanthorizons` (warn: some competitive servers don't allow it), `bobby` (Fabric), `c2me-fabric` (`experimental: true`, warning "Experimental (alpha). It can freeze world creation or damage a world. Back up your worlds first."). Confirm each slug on Modrinth.
4. IPC + preload: `perf:profiles` (`perfProfiles()`), `perf:profileExtras(id)` (`perfProfileExtras`) → `[{ slug, title, why, experimental, warning, available: true|false|null, channel, installed }]`, `perf:packStatus(id)` (`perfPackStatus`), `perf:restorePack(id)` (`perfRestorePack`, refused while running). `instances:create/update` accept `perfProfile`. far-view instances get the modpack memory default. Copy-to-version carries `perfProfile`.

### 6c. Renderer UI (files: `features.js`, `renderer.js`, `styles.css` (CRLF), `index.html`)
- Settings → "Performance" card: Garbage collector (Automatic (recommended) / Classic (G1) / Low-pause (ZGC)) → `gc`; "Give Minecraft priority" switch → `processPriority`; "Choose graphics card…" → modal with 3 steps, calls `perfGpuHelp()`, lists `javaPaths` with Copy buttons, says plainly Reminth doesn't change the setting itself; memory helper shows the automatic default from `perfInfo()`.
- `onSafeMode` → toast + dismissible notice on that instance: "Minecraft refused the Java settings, so Reminth started it with basic ones. Reason: … Check Settings → Extra Java arguments."
- Instance create/edit: profile picker (three options, honest descriptions: max-fps and far-view "applied to new instances only; your existing settings are never changed"; far-view "things more than 8 chunks away stop growing and moving in singleplayer"); performance-pack switch for all four loaders with the per-loader mod list and "Stable builds only, from Modrinth. Reminth leaves a mod out when you have your own copy or one that conflicts." (existing Forge/NeoForge: off by default, say why); pack status list from `perfPackStatus` with plain state tags + "Restore" button; "Suggested for this profile" modal from `perfProfileExtras` — checkboxes unticked by default, experimental ones need a second confirm, installs via `installContent(instanceId, { projectId: slug, kind: "mod" })`.
- "What's new": one honest bullet about performance (no numbers you didn't measure). Max 7 bullets.
- Managed mods in the Mods tab labelled "Performance pack", tooltip "Kept up to date by Reminth. Switch it off here and Reminth leaves it off."
- Every async path: capture the target instance at click time, stale-result guard, try/catch → `toast(friendlyError(...))`, re-enable in `finally`, no double-submit.

### 6d. Things deliberately NOT to do (reasons in PERF_PLAN.md Tier 3)
No alpha/beta mods as silent defaults (C2ME, Nvidium, Voxy); no `-XX:+DisableExplicitGC`, large pages, Shenandoah, GraalVM, AppCDS, giant flag lists from guides; no rewriting an existing `options.txt` or `sodium-options.json`; no forcing Vulkan; no registry writes for GPU preference; no High/Realtime priority, power plan, Game Mode or Defender changes; no `no-chat-reports` or server-side mods by default; no pack added to imported modpacks; no bigger default heap "for performance".

## 7. Docs to update once section 6 ships

Facts change: the performance pack comes **from Modrinth** (GitHub only as fallback for three mods), has more mods, exists on NeoForge/Forge (new instances), Reminth can raise the game's process priority, may write a starting `options.txt` for a brand-new instance when the player picks a profile, and opens Windows' graphics settings on request. Update: `site/privacy.html` and `site/terms.html` (keep **Version 5** if the owner still hasn't uploaded the site; otherwise bump to 6 with a history line), the in-app Privacy & terms summaries in `src/renderer/index.html`, `site/index.html` wording about the pack, `README.md`. Every statement must be true of the code; don't weaken the consumer-rights wording (EU withdrawal tick-box / no-refund approach, Mojang disclaimer "NOT AN OFFICIAL MINECRAFT PRODUCT…", bans/"just a launcher" section). This is drafting help, not legal advice. Then remind the owner to re-upload `site` to Cloudflare.

## 8. Known open items / cannot do / wants to do

**Cannot do (no money or needs the owner):**
- Code-sign the installer (the updater installs unsigned builds; signing needs a paid certificate).
- Custom domain (wanted `reminth.gg`; ~$10/yr for a `.com` at Cloudflare when he can).
- Business registration/VAT with an accountant before taking any payment; a lawyer should read Terms §10 (withdrawal/no-refund), §12 (liability), Privacy §7 (under-15) and the "system sound is recorded" statement before payments start.
- Netlify: old site `reminth-launcher` (team wxstedgoty) ran out of free credits; website moved to Cloudflare. `netlify.toml` is still in the repo and the old Netlify project is still linked to GitHub — delete the Netlify project (owner) and then remove `netlify.toml` from the repo and from `publish.ps1`.

**Known weak spots to tell him about, not hide:**
- Nothing in 1.2.0 or the JVM work has run on Windows/Electron/real Minecraft yet.
- Safe mode misses JVM refusals that show a `javaw` dialog (see 3b). Possible fix: poll the launch log ~2 s after spawn and kill a JVM sitting on its dialog — untested, your call after testing.
- Replay buffer isn't cleared when the game stops (privacy text says exactly that).
- The rail's instance list scrolls and can show half a button when streamer mode adds its buttons.
- `forgePromos` caches a failed lookup for 15 min (only affects the "recommended" badge).
- Creating/editing an instance offline still fails (`resolveLoaderVersion` needs the loader's server).
- GitHub API: 60 requests/hour per IP shared by everyone on the network — one more reason to finish 6a.
- Three unused `*-clean.png` files committed under `assets/hosting`.

**Roadmap after performance (owner's list):**
1. More UI changes (he will say which; he cares about small visual glitches).
2. A custom home screen shown inside Minecraft when it launches.
3. In-game Reminth+ diamond badge — **idea only, do not build**.
4. Paid Reminth+/hosting later: needs checkout tick box, confirmation email, cancel button, legal review. Nothing is purchasable today; `entitlements.hasPlus()` is false for everyone.
5. Unresolved: server ping showed ~80 ms in Reminth vs ~30 ms elsewhere. `serverPing.js` measures TCP connect + handshake + status reply (one round trip more than a bare ping) and SRV lookup time may be included — check and either measure the same way other launchers do or explain it in the tooltip.

## 9. When you finish

- `npm test` green, app started and clicked through, game launched once.
- `build-dist.bat`, then `run-publish.bat` (update the commit message inside `publish.ps1` first — it currently says "Reminth 1.2.0: compatibility help, safer saves, bug-fix sweep"; bump `package.json` + `package-lock.json` to 1.3.0 when the performance work ships).
- Give the owner: what changed (plain list), what you tested and how, what you could not test, what he must do by hand (Cloudflare upload).
