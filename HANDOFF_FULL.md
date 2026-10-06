# Reminth: the full hand-off (read this first)

Written 6 Oct 2026 by the desktop Claude Code window that did all the work from 3 to 6 Oct 2026, for the
new Claude Code chat that continues it. The old chat still exists (see section 0.3), but the owner lost it
from the Claude desktop app's list after a forced log-out, so the work continues in a new chat.

**This file is meant to be complete.** It holds every decision, request, result, release, open item and
working habit from the old chat, including the small ones. Where something is described in more detail
elsewhere, the file name is given. Nothing here is a guess: anything not seen working in the real game or
app is marked "not tested".

**This repo is public on GitHub.** Personal details about the owner (age, family, real name and so on) are
deliberately NOT in this file. They are in the local Claude memory for this folder (loaded automatically,
`MEMORY.md`) and in `local-notes/` (not committed, only on this PC).

---

## 0. Start here

### 0.1 Read in this order
1. This file, all of it.
2. `CLAUDE.md` (two short rules: update `DECISIONS_AND_TEST_PLAN.md` after every batch, commit and push it).
3. `CLAUDE_CODE_HANDOFF_10.md` sections 0-1 (the codebase rules; still valid) and section 8 (old roadmap).
4. `DECISIONS_AND_TEST_PLAN.md` top sections (newest first: 00000000000, 0000000000, ...). Long; skim the
   rest only when a topic comes up.
5. `YOUR_TESTS.md` (what only the owner can test).
6. Local only: `local-notes/CHAT_LOG.md` (every owner message and Claude's final answer to it, in order,
   3-6 Oct), `local-notes/CHAT_SUMMARIES.md` (the three automatic summaries of the old chat).

### 0.2 Who you are now
- There used to be **two** Claude Code windows: a **cloud window** (Firefox, claude.ai/code, wrote code from
  `CLOUD_PROMPT_N.md` files, could not run Electron or Minecraft) and the **desktop window** (this PC: tests,
  real Minecraft, builds installers, also wrote code). The owner's $100 Claude Code gift credit ran out on
  4 Oct night and the **cloud window was dropped**. From then on the desktop window did everything.
- **You are the desktop window now.** Do the code, the tests, the builds. No more prompts for another window
  unless the owner asks for that again.
- The rule from `CLAUDE.md` still applies: after every batch, rewrite the top of `DECISIONS_AND_TEST_PLAN.md`
  (what changed with file names, commit `main` is at, `npm test` count, decisions, weak spots, PASS/FAIL test
  plan), commit and push, and tell the owner.

### 0.3 The old chat
- Session id `1c102225-b723-4163-ac48-1ea5b830a0e6`, transcript
  `C:\Users\kolijos\.claude\projects\C--Users-kolijos-Downloads-reminth-launcher\1c102225-b723-4163-ac48-1ea5b830a0e6.jsonl`
  (115 MB). Reopen it in a terminal with
  `cd C:\Users\kolijos\Downloads\reminth-launcher` then `claude --resume 1c102225-b723-4163-ac48-1ea5b830a0e6`.
- The Claude desktop app's own list of Code chats was wiped at the re-login (its folder
  `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude-code-sessions\` was recreated
  on 6 Oct 08:06, empty). The old desktop window refused to hand-edit that private, undocumented list. The
  owner was told to ask Anthropic support (claude.ai, Help) to re-attach it, giving the session id.
- An even older chat in this folder: `30daea5e-...jsonl` (24-26 Sep 2026, the "CLAUDE_CODE_PROMPT_1..8" rounds,
  versions up to 1.1.1, report in `REMINTH_STATE.md`).
- **Never delete or move anything in `C:\Users\kolijos\.claude\`.**

### 0.4 State right now (6 Oct 2026)
- `main` is at `69a3d5c` (plus this hand-off commit), everything pushed, working tree clean.
- `npm test`: **643 pass, 0 fail**.
- `package.json` version **1.4.8**. **1.4.8 is NOT published.** The owner refuses to publish until he has
  tested everything and is happy ("im not releasing 1.4.8 if the stats thing isnt fixed", "lets not publish
  another release till we finish the uncovered part", "i wony publish the release yet until ... done").
- The newest installer is in `release-1.4.8\` (git-ignored): `Reminth-Setup.exe`, `Reminth-Setup.exe.blockmap`,
  `latest.yml`, built from `69a3d5c`. It is **installed on the owner's PC** (the old window ran it on 5 Oct
  ~21:15 when he asked "add it to my screen"). `release-1.4.7\` is an older, obsolete build: ignore it.
- The last GitHub release is **1.4.6** (4 Oct). Players on 1.4.6 will jump straight to 1.4.8.
- The owner's last messages were about losing the chat. His last real work request was the playstyle mod
  lists (done, section 9); he had not yet reported test results for that batch or the sign-in/pointer batch.

---

## 1. The owner and how to work with him

- GitHub `WxstedGOTY`, signs as Wxsted. Reminth is his project. Personal details: see the Claude memory.
- He wants **short, plain answers in few easy words**, an answer first, then a clear "what do I do now" list
  (numbered steps, with where to click and how long). Long technical explanations confuse him; he says so
  ("im confused", "u confused me idk what to send"). When confused, he needs the one next action.
- He is **not a programmer**. Never ask him to edit code. Give exact clicks, exact file names, exact text to
  paste. When a file or folder matters, open File Explorer on it for him (the old window did
  `explorer /select,<file>`).
- **Honesty matters more than looking finished.** Mark every claim "seen working in the real game/app" or
  "not tested". He noticed and asked when things were left unfinished ("i see some stuff you didnt complete").
  He wants things **finished**, not half done, and "no mistakes".
- He often works in bursts and leaves for hours ("work for at least 3 hours", "you got the whole night").
  Long autonomous stretches are fine and wanted then. Before he leaves he wants a short list of what he must
  do. When he comes back he wants: what was done (plain), what he must test (with times), already set up.
- He **uploads GitHub releases himself**. Never create a release. He says "published, check it" afterwards:
  then verify the public release (tag, three files, `latest.yml` identical, installer SHA-512 matches).
- He tests in his own real instance and real servers and reports by screenshot and short messages.
- He plays Minecraft on this PC (Fabric 26.2 instance called "Reminth", crystal/sword PvP, servers like
  DonutSMP (`donutsmp.net`) and PvPClub), also Counter-Strike, Roblox, uses Medal (recorder) and the NVIDIA app
  overlay. Sometimes his brother sits at the PC instead. A friend has an older Reminth and has AMD/Intel
  graphics; the friend will test 1.4.8 after release, and reported the sign-in problem too.
- Model/effort: he switched models during the chat (Sonnet 5.5 medium for testing, Opus 5.5 high for heavy
  work) and offered "opus 5.5 high effort" for the big nights. Pick what the job needs; say so if asked.
- Usage limits hit several times (weekly limit, session limit). After "I hit my usage limit... it has reset
  now. Please continue" just continue.
- He sometimes sends stray text (`]\` once, a mistake). Ignore it.
- Language: he writes fast with typos; read for intent. He calls things: "the other claude code window" (cloud
  window), "home screen/title screen" (the in-game Minecraft title screen mod), "the fps thing" (ReminthHUD
  bar), "skin changer/skins", "streamer mode", "library".

## 2. Standing rules (all from the owner or the earlier hand-offs; keep them)

1. **Never touch his screen while he plays** (no mouse/keyboard, no window focus stealing). Check first:
   is a `javaw` Minecraft window running? Is the PC idle (the old window used a "quiet gate" script that waited
   for 45-60 s without input)? His real game was running often (window title like
   `Minecraft* 26.2 - Multiplayer (3rd-party Server)`); never kill or touch it.
2. **Window-only screenshots** (PrintWindow of one window). Never capture the whole desktop (it happened once
   by mistake on 3 Oct and was deleted). PrintWindow returns blank/white pictures while his own game runs.
3. **Never print the `javaw` command line** or grep it for loose text: it contains the Minecraft access token.
   Only extract specific arguments like `--gameDir`.
4. No money spending (no domain, no code-signing certificate, no paid hosting).
5. Never enter passwords or credentials, never sign in for him. Test accounts are offline fakes (token "0").
6. Never create GitHub releases. He uploads.
7. Keep his name and contact on the legal pages (Terms/Privacy) unless he says otherwise ("dont remove
   anything yet").
8. Don't invent business or product facts.
9. Never delete a player's own mods, never overwrite a player's `options.txt`, never install alpha/beta
   silently, never leave a half-written settings/instances/account file (atomic writes via `atomic.js`).
10. Use throwaway instances / a fake home for tests. Back up `%APPDATA%\Reminth` before running unreleased
    code on real data (a backup from 3 Oct is in `C:\Users\kolijos\Downloads\reminth-data-backup-2026-10-03`).
11. Don't push if tests fail. Commit after each finished step.
12. Codebase rules (from `CLAUDE_CODE_HANDOFF_10.md` section 1): plain JS CommonJS, renderer classic scripts
    sharing globals, **no `innerHTML`** (use `el()`, `icon()`, `button()`, `textContent`), CRLF files
    (`src/renderer/styles.css`, `src/main/java.js`, `src/main/store.js`, `src/main/paths.js`, `site/*.html`, and
    others: check with `grep -c $'\r'` before editing; preserve the file's line endings), the last CSS rule
    `*, *::before, *::after { background-origin: border-box !important; }` stays last.
13. Commit message attribution: end commit messages with the Co-Authored-By line the session tells you to use.
14. When the owner said "dont interrupt me playing", the old window worked silently (low priority, no windows).

## 3. What Reminth is (product overview)

Reminth is an Electron Minecraft launcher for Windows (repo `C:\Users\kolijos\Downloads\reminth-launcher`,
GitHub `WxstedGOTY/reminth-launcher`, branch `main`). Website `https://reminth.pages.dev` (Cloudflare Pages,
source in `site/`). Free; nothing is for sale (`entitlements.hasPlus()` is false for everyone). Data on the PC:
`%APPDATA%\Reminth` (settings.json, instances.json, account.json encrypted, caches, logs, `instance\` = the main
"Reminth" instance, `instances\<id>` = others). Each instance folder has `.reminth/` bookkeeping.

### 3.1 Feature inventory (where it lives)
- **Sign-in**: Microsoft device-code flow (`src/main/msAuth.js`, IPC `auth:*` in `main.js`, UI `doSignIn` in
  `renderer.js`). 6 Oct changes: browser opens the Microsoft page by itself, "Open the Microsoft page" and
  "Copy code" buttons, the Sign in button stays pressable as "Get a new code" (restarts the flow;
  `auth:signIn` with `restart`), "Download game files without signing in" button removed.
- **Instances**: create/edit dialog (`openInstanceModal` in `renderer.js`), loaders vanilla/Fabric/Quilt/Forge/
  NeoForge, every Minecraft version Mojang lists (917 tested, incl. all snapshots, alphas, betas), right-click
  menu (Play, Open, Rename, Open folder, Verify files, Boost FPS..., **Set up for a playstyle...**, Move
  up/down/top/bottom, Delete; the main instance can't be deleted), drag to reorder, "Made for..." labels and
  Undo for instances Reminth makes, running-game adoption after a Reminth restart (`runningGames.js`).
- **Mods tab**: list, on/off, delete, updates (with Beta/Alpha tags), compatibility panel, "Update mods to fit
  <version>" button (swaps to stable builds, keeps copies in `.reminth/replaced-mods`), crash notice naming the
  mod, "Safe to delete" group with red "Delete all" (Recycle Bin), mods locked while the game runs.
- **Version picker**: "Pick a Minecraft version for my mods" (plain groups: will work / no build / turned off;
  switch this instance or make a new one; result screen). Fabric version-switch fix for mods like Iris whose
  own file claims a wider range than Modrinth lists (5 Oct).
- **Discover**: the catalog (Modrinth API, now worded "the catalog" in the UI), project pages (description
  renderer `markdown.js`, gallery, versions, links; images only from Modrinth CDN/GitHub avatars), install
  into one or several instances, **"Installed" only when the item is in every instance** (6 Oct), servers tab
  with ping.
- **Home**: hero = last-played instance, Play, stat cards (no coloured edge/glow, hover outline), lifetime
  Time played (separate counter), Jump-back-in cards with Play (worlds open directly on 1.20+, servers join).
- **Player Statistics**: singleplayer world stats + server stats collected by ReminthHUD (section 8),
  "Blocks placed" is an estimate (`gameData.estimatePlacedBlocks`), refreshes every 20 s while a game runs.
- **Skins**: 3D viewer (`skinview.js`), library, default skins; warmed up behind the loading screen.
- **Library**: clips and screenshots (old Instances/Worlds/Servers tabs and the separate Captures page were
  removed on 4 Oct). Top line "Are you a content creator? Check out streamer mode on the launcher!" with
  "streamer mode" in blue: opens a popup (Not now / Test it (30 seconds) / Turn this on); Test shows a small
  box near the bottom middle with "Revert changes" and a cross (the cross keeps it on); after Test or Turn on
  it goes to the streamer page; if already on, the link just goes to the page.
- **Streamer mode** (`streamer.js`, recorder window `src/recorder/`): replay buffer, clip/screenshot hotkeys,
  blur personal info. Rail broadcast button **only opens the page** (6 Oct; it used to toggle on every press);
  the switch on the page toggles. Page order: Hotkeys card first, then Streamer mode card.
- **Settings**: hardware acceleration (red "Keep this on." right under the name; turning it off asks first
  with a "slow and laggy" warning; orange note while off; restart applies), memory, Java/GC (auto/G1/ZGC),
  process priority, Check for updates, privacy/terms summaries, accent colours.
- **Loading screen** (`#bootSplash` in `index.html`, `loadingScreen()` in `renderer.js`, CSS `.boot-*`):
  1.8-3 s, glow, logo + "Reminth", bar that moves every frame (eases to 90 %, then runs to 100 %), builds the
  Skins page behind it (`window.reminthWarm` = `warmSkinsPage`).
- **Updates**: electron-updater from GitHub releases, per-user NSIS one-click install (no admin prompt since
  1.4.2; the one-time migration removed the old `C:\Program Files\Reminth` copy), silent `quitAndInstall(true,
  true)`, "Restart to install" bar, Settings "Check for updates", re-check every 6 h, blocked while a game runs.
- **reminth:// links** (`src/main/deepLink.js`, strict allow-list, page switch only): `skins`, `home`,
  `discover`, `instance/<id>`. Registered by the installer (`build.protocols`).
- **Performance**: performance pack from Modrinth (Sodium, Lithium, FerriteCore, ImmediatelyFast, Entity
  Culling, ScalableLux; stable only; on by default for Fabric/Quilt, opt-in for Forge/NeoForge), profiles
  Balanced / Max FPS / Far view (starting `options.txt` for new instances, `gameOptions.js`), "Boost FPS..."
  (shows changes, "Put my old settings back"), JVM flags per Java version, launcher animations off while a game
  runs and paused when the window is not in front.
- **Bundled mods** (`config.BUNDLED_MODS`, `assets/mods/`): ReminthHUD (flag `hud`) and the Reminth home
  screen (flag `homeScreen`, **forced** since 6 Oct: always installed on Fabric/Quilt, the switch is hidden,
  the jar is hidden from the mod list). Sections 6-7.
- **Playstyle setup** ("What is this instance for?"), new 6 Oct. Section 9.
- **Privacy/Terms**: `site/privacy.html` (Version 8, 5 Oct 2026, later edited 5 Oct for the home-screen bullet:
  "has a Discover button and a Skins button that ask Windows to open Reminth through the links
  reminth://discover and reminth://skins"), `site/terms.html`, in-app summaries in `src/renderer/index.html`.

## 4. Release history and how to release

| Version | When | What (short) |
|---|---|---|
| 1.1.1 | 24-26 Sep | earlier sessions (`REMINTH_STATE.md`), the friend's copy is old |
| 1.2.0, 1.3.0 | 3 Oct | built and pushed, never released (compat help, safer saves, perf pack from Modrinth, profiles) |
| **1.4.0** | 3 Oct, published | Update mods to fit, Check for updates, project pages, Safe to delete, mod lock, Play on cards, hero = last played |
| **1.4.1** | 3 Oct, published (tag `1.4.1` without "v") | AppleSkin crash fix (may-not-work mods), instance menu/reorder, version picker, lifetime Time played, stat boxes |
| **1.4.2** | 3 Oct, published | ping like Minecraft (Ping/Pong median), per-user silent updates, ReminthHUD 1.1.0 bar, Boost FPS, no launcher animation during play |
| **1.4.3** | 3 Oct, published | fix: launcher empty/dim while a game runs (animations off, not paused) |
| **1.4.4** | 4 Oct, published | HUD on for every Fabric/Quilt instance once, new plain bar look, JEI early start |
| **1.4.5** | 4 Oct, published | greyer bar, no shadow, no coordinates |
| **1.4.6** | 4 Oct, published (last public) | Reminth finds games still running after a restart; no second copy |
| 1.4.7 | 4 Oct | built, never released (HUD for 1.20.1/1.21.x/26.1.x) |
| **1.4.8** | not published | everything since 1.4.6, section 4.2 |

### 4.1 How a release is done
1. `npm test` green. Bump `package.json` + `package-lock.json` version if needed.
2. `npm run dist` (electron-builder NSIS) -> `dist\Reminth-Setup.exe`, `dist\Reminth-Setup.exe.blockmap`,
   `dist\latest.yml` (also a stray `Reminth Setup 1.0.0-dev.exe` may appear; ignore). Copy the three files into
   `release-<version>\` and open Explorer on it.
3. Smoke-test the packaged app if possible (`dist\win-unpacked\Reminth.exe` with a fake USERPROFILE and
   `--user-data-dir`, CDP port).
4. The owner: `github.com/WxstedGOTY/reminth-launcher/releases/new`, tag `v<version>` from `main`, title
   "Reminth <version>", drag all three files, wait for uploads, paste notes, "Set as the latest release" ticked,
   pre-release/draft unticked, Publish. (He once pressed "Generate release notes" by accident: harmless.)
5. Then verify publicly. His installed copy updates itself: open Reminth, wait ~1 min, "Restart to install" (or
   Settings -> Check for updates -> Restart and update), Minecraft closed.
6. Website changes need a manual upload: dash.cloudflare.com -> Workers & Pages -> project **reminth** ->
   Deployments -> Create deployment -> drag the whole `site` folder -> Deploy. Check
   `reminth.pages.dev/privacy.html`. **The site has changed since his last upload (privacy v8 + the 5 Oct
   home-screen bullet): it needs re-uploading with or before 1.4.8.**
7. The installer is unsigned: Windows SmartScreen "More info" -> "Run anyway" for manual installs.

### 4.2 What 1.4.8 contains (for its release notes)
Draft notes the owner was given on 4 Oct are now out of date (they mention server quick-join buttons, which were
removed). A complete list to build the notes from:
- New Minecraft title screen (Reminth home screen 1.0.3): night aurora panorama, dark rounded Singleplayer /
  Multiplayer, a third row **Discover | Connect Discord** (Discord says "Coming soon"), icon row Skins /
  Mods (if Mod Menu) / Realms / Options / Language / Quit, sharper icons, pointer fix after F11, works on
  1.20.1, 1.21-1.21.11, 26.1-26.3 (Fabric/Quilt), always on (another title-screen mod wins).
- FPS | GPU | CPU | LAT bar and the JEI fix on all those versions (ReminthHUD 1.3.1).
- Player Statistics include server stats (asked 5 s after joining, then every 30 s; never go down); Blocks
  placed is an estimate.
- Playstyle setup for new instances (Survival & SMP, Crystal PvP, Sword & Axe PvP, Creative & building +
  Performance tab), with ready-made settings and resource packs switched on.
- Every Minecraft version Mojang lists launches (917 tested), including all snapshots; fixes for Fabric API on
  1.14-1.19.1, NeoForge 1.20.6, 13w16a-13w23a, a first-launch native crash retry.
- Fabric version switch: mods like Iris that claim a wider range are updated when a proper build exists.
- Library = clips and screenshots; streamer-mode line with popup and 30-second test; rail streamer button only
  opens the page.
- Loading screen; Skins page prepared behind it.
- Discover: "Installed" only when in every instance; "Modrinth" removed from visible app text.
- Sign-in: the Microsoft page opens by itself, Copy code / Open page buttons, "Get a new code".
- Hardware acceleration warning; launcher animations paused when not in front.
- Privacy policy version 8.
- Many small fixes (audit 16: data safety, races, Greek/accented user names, clock problems).
- The owner asked "all that to go from 1.4.6 to 1.4.8?" Answer given: yes, one release; he could call it
  1.5.0 instead (would need a version bump and rebuild). **Undecided.**

## 5. Timeline of the old chat (3-6 Oct 2026), condensed but complete

Full wording: `local-notes/CHAT_LOG.md`. Commit-level detail: `git log`.

**3 Oct morning.** Owner: "Read CLAUDE_CODE_HANDOFF_10.md fully, then PERF_PLAN.md, and continue exactly as it
says. Start with section 5, step 1." Weekly limit hit, then "Try again". Step 1 (1.2.0 checked on Windows,
pushed `0812a53`), step 2a (perf pack from Modrinth; Sodium now installs on 26.3). Found: his "Reminth"
instance was 26.2 with 26.3 mods. He asked to use a cloud session to spend his $100 Claude Code credit -> the
two-window setup began (Firefox cloud window writes code from prompts, desktop tests). Model advice: cloud Opus
5.5 high, desktop Sonnet 5.5 medium. Rule: never both editing at once; pull first. Pushed handoff files.
Cloud did 6b/6c (profiles); desktop found the graphics-preset bug on 1.21.11+/26.x (writes
`graphicsPreset:"custom"`), docs to privacy/terms v6, 1.3.0 built (not released).

**3 Oct, prompts.** Owner asked for an "Update mods to fit" button and an in-launcher update button ->
`CLOUD_PROMPT_UPDATES.md` (jobs A, B). Then `CLOUD_PROMPT_2.md` (jobs C nested-jar detection + Fabric
incompatible-mods report parsing, D stable-only swaps, E keep copies of replaced jars). Owner's list while the
cloud worked -> `CLOUD_PROMPT_3.md`: rename "Needs a look" to **Safe to delete** + red Delete all with bin icon
(Recycle Bin, owner accepted), block mod changes in a running instance (mods only; packs/shaders allowed),
skin page lag (warm-up, timing marks), Play button on Home cards (opens the instance it was last played in),
hero shows last played instance. `CLOUD_PROMPT_4.md`: Play button moved into the card text strip + the full
mod detail page in Discover ("modrinth has descriptions... that should also happen here on every single mod";
off-site images shown as a placeholder). `CLOUD_PROMPT_5.md`: hero switch timing, window small after
fullscreen game. `CLOUD_PROMPT_6.md`: window "flagged maximized but small" repair. `CLOUD_PROMPT_7.md`: Check
for updates showed the feed version (1.1.1) instead of the running one. Owner was confused about prompt
numbering several times ("you only sent me 2 prompts"); answer with a table of prompt -> file -> status.

**3 Oct, 1.4.0 release.** Built `0e5d688`, rebuilt after prompt 7. Owner published (tag `v1.4.0`), checked
publicly. Cloudflare re-upload of `site` (Version 6) done by owner; old Netlify project `reminth-launcher`
deleted by owner; `netlify.toml` removed, helper scripts committed (`a118165`). Real update test 1.1.1 -> 1.4.0
worked silently, but the update moved the install to `C:\Program Files\Reminth`.

**3 Oct, 1.4.1.** Stat boxes: no coloured strip, world-card hover outline (`CLOUD_PROMPT_8.md`, Sonnet low).
Owner: "tried the play on a real server and it caused crash" -> AppleSkin built for 26.3 in a 26.2 instance
(may-not-work mods) -> `CLOUD_PROMPT_9.md` (fit button swaps them, Play warns, crash notice names the mod with a
Fix button). Owner: "stop creating me a million instances", wants right-click delete, moving instances, less
complex mod syncing -> `CLOUD_PROMPT_11.md` (version picker) and `CLOUD_PROMPT_10.md` (instance menu, reorder,
Undo for auto instances). Owner: Time played must be lifetime on the launcher, not per instance ->
`CLOUD_PROMPT_12.md` (+ picker fixes); desktop found a false "nothing you need to change" ->
`CLOUD_PROMPT_13.md`. 1.4.1 built, owner said "closed reminth deploy 1.4.1", published; his copy updated (a
Windows permission window appeared once, he clicked Yes). Told: delete the three extra instances "Reminth
26.1.2 / 26.1.1 / 26.2" via right-click (made by the old "make a copy" button).
Legal talk: lawyer/business registration only matter once money is involved; as a minor an adult must be the
legal owner for anything paid; his real name is on the public Terms/Privacy pages; he said "dont remove anything
yet".

**3 Oct afternoon/evening.** Owner: fix the ping (~80 ms vs ~30 elsewhere), "the minecraft home screen isnt an
idea, its coming", wants an FPS/GPU/CPU/LAT overlay like his NVIDIA screenshot -> `CLOUD_PROMPT_14.md` (ping) and
`15.md` (HUD), then he switched to Opus and asked the desktop to do it all itself: fix every glitch, FPS 200 vs
Modrinth 500 ("if you dont get 350 while im away dont stop working"), silent updates. Results (1.4.2): ping
Hypixel 439 -> 149 ms, CubeCraft 82 -> 40, DonutSMP 103 -> 42; per-user install; HUD 1.1.0; Boost FPS; FPS
comparison like-for-like showed Reminth = Modrinth (164 vs 164, 236 vs 223); the gap was his settings (render
distance 16 vs 8, shadows/clouds/biome blend, Xaero's Minimap ~15 %, Roblox/Medal running). His brother was at
the PC for a while. After installing 1.4.2 with Boost FPS: "never below 420, almost 600 fps, lag spikes don't
exist"; remaining: first inventory open stutter (JEI). 1.4.3: the launcher went dark/empty while a game ran
(paused fade-in animations) -> fixed. The "FPS N/A | GPU | CPU | LAT N/A" strip on his launcher is the NVIDIA
app's overlay, not ours.

**3-4 Oct night.** Overnight FPS round (owner: "run the overnight test im going to sleep... dont ask
questions"): his instance with Boost settings 835 avg, 1 % low 390, worst frame 8 ms; render distance 10 vs 12
+8 %; Nvidium no gain (not offered); More Culling + BadOptimizations no gain (not added); Reminth vs
Modrinth-style launch 769 vs 764 avg, 1 % lows 370 vs 310, worst frame 10 vs 19 ms. Estimates given: DonutSMP
standing still up to ~1150, walking 420-600, busy PvP 350-450, superflat 800-1150.

**4 Oct morning.** JEI: loads all recipes on the render thread (~1.2-1.5 s); on servers without the recipe
packet it waits for the first inventory. Fix = HUD 1.2.0 "JEI early start" (fires JEI's own
`AFTER_RECIPES_UPDATED` event 1.5 s after join; `"jeiEarlyStart": false` turns it off); "Show Tag Recipes" off
did not help. Owner confirmed the stutter is completely gone. 1.4.4 (owner first asked "should we really publish
1.4.4 for such small things?" -> advice: hold; then published). Bar restyled to his reference (small, no
background, grey labels, bold values) -> 1.4.5 (greyer, no shadow, no XYZ: "it could be a problem if someone
wanted to hide it"). He wants the NVIDIA overlay hidden while Reminth runs: **impossible without killing or
editing another program; dropped**; tried "Hardware acceleration off" (did not hide it). Bug: Reminth forgot a
running game after restart -> 1.4.6 (`runningGames.js`), owner confirmed fixed. Privacy v7 written (owner
uploaded the site). Install counts: GitHub shows downloads (33 total then, mostly his own updates); "who is
online" needs a server + privacy + consent; recommended Level 1 anonymous "count me" ping later, Level 2
friends-only presence; never a public list of everyone's names.

**4 Oct midday.** Roadmap stated by the owner: "the launcher building is finished once: this is fixed, we work a
little bit more on bugs and glitches to find each one possible, custom homescreen which i need much help
finishing and after that something HUGE: lunar client has a panel..." (a Lunar-style in-game feature panel),
then a public announcement, then legal and paid stuff. Research on version usage (Modrinth downloads): 1.20.1
16.8 %, 1.21.11 16.1 %, 1.21.1 14.3 %, 26.2 7.4 %, 1.21 6.3 %, 1.21.4 5.8 %, 1.21.10 4.1 %, 1.21.8 3.7 %,
26.1.x ~7 %, 26.3 1.0 %. Cloud did Audit 16 (`CLOUD_PROMPT_16.md`, many data-safety fixes). HUD built for
1.20.1, 1.21-1.21.11, 26.1.x (`hud-1.21/`). Home screen request: "like lunars one, aesthetic, animated like
freecam... find a perfect seed night time... blurred... buttons black, slightly rounded... bottom middle icons
like skin selector or the mods". He said the HTML mock-up was "really mid/bad" (it was a flat drawing).
`HOME_SCREEN_PLAN.md`, `CLOUD_PROMPT_17.md` (cloud: bundled-mod mechanism + reminth:// links). The Lunar panel
was postponed ("i want to spend real time on it").

**4 Oct afternoon (owner away 5 h).** Desktop built the home screen mod: scouted 12 seeds x up to 10 spots with
Iris + Sodium + Complementary Reimagined on his PC, picked seed 2024 viewpoint 8 (aurora over a snowy forest),
blur baked, six panorama faces, camera pitch -6. Ten jars (`home/`, `home-1.21/`). Built `release-1.4.7\` and
`release-1.4.8\`. Owner: "looks nice for the homescreen" ("it looks fire").

**4 Oct evening.** Launcher laggy -> hardware acceleration had been switched off (probably during earlier
debugging) -> on again; owner: "why is that even an option" -> warning added. Library -> clips and
screenshots + streamer line. Owner discovered stats never move on servers ("is there no database/backend?") ->
explained (only local world files) -> ReminthHUD 1.3.0 server stats. "im not releasing 1.4.8 if the stats
thing isnt fixed". Stat card glow removed.

**4-5 Oct night (owner asleep, "do everything you can... EVERY single snapshot, version... user friendly").**
All 917 versions launched through Reminth; fixes: Fabric API fallback to Modrinth for 1.14-1.19.1 (Fabric's
Maven has none or an empty 5 KB shell), NeoForge 1.20.6 duplicate logging libs, 13w16a-13w23a no
`--width/--height`, quiet retry after an early native crash (0xC0000005). Privacy v8, friendlier New instance
wording, animations paused when not in front.

**5 Oct day.** Not-covered list: 1 h play PASS (874 FPS avg, memory flat ~4.66 GB), top 12 Modrinth mods on
many versions PASS (Quilt 1.21.1 fails because of the mods: newest Iris vs Sodium vs Kotlin/loader), offline
start PASS (simulated), version switch with mods: Forge/NeoForge OK, Fabric problem with hand-installed
Sodium/Iris -> fixed (Iris 1.8.8 claims 1.21.x but only works on 1.21.1). Still fails by the mods' fault: on
1.21.1 the newest stable Sodium and Iris exclude each other (only an Iris beta would fix it; **owner decision,
not done**). `YOUR_TESTS.md` created. Owner (heading to class): yes to the home screen; friend tests after
publishing; no release until everything is done.

**5 Oct evening.** Owner found: Back from Singleplayer (Create World) showed the vanilla title screen -> fixed
with a second swap hook (STORE `@ModifyVariable` in `ScreenSwapMixin`) + a test mod (`tools/overnight/hometest`,
8 cases, all pass on 26.2/26.3) + Realms cloud icon, demo passthrough, multiplayer-disabled tooltip, 1.0.1 jar
upgrade. He plays only his Fabric 26.2 instance on his PvP server ("load that one instead").
Big feedback list (19:14) -> done: red "Keep this on." under the name; swap streamer cards; streamer popup with
30 s test and revert box; title screen third row Discover | Connect Discord instead of server shortcuts; stats
faster and never shrinking; placed estimate; background hidden by his pack `Crystal PvP LT3 Essentials v25.2.zip`
(it ships its own panorama). He also wanted the ping like Modrinth's (stable ~40 vs ours 80-400 spikes once in
20 min) and "try also getting it to 35ms": answered honestly that network ping is not controlled by the launcher;
not measured. "if you noted the word modrinth anywhere id like it removed since we arent doing any ads for them rn
and i will find a way we give them some credits for the ideas we took" -> removed from all visible app text and
error messages ("the catalog", "View original page"); kept on privacy/terms/settings privacy summary (they must
name the services). Loading screen idea: "a custom loading screen that loads for just 2/3 seconds and it loads
the whole app so when a tab is pressed... its already pre loaded".
Next list (19:57) -> done: Skins still slightly slow; loading screen "not looking so good, take an example of
modrinths... dont copy paste" + bar must move smoothly; streamer navigation; rail button toggling; Discover
installed-everywhere rule; home screen forced, no visible "reminth home screen" mod; the head on Connect
Discord (it was the **ukulib** mod's button, a dependency of BetterHurtCam and uku's Armor HUD, showing its
author's head; hidden by reflection); "the donutsmp thing not something we gotta do". Icons "too pixelic" ->
64 px with smooth scaling.
Then (20:32): sign-in sometimes can't be pressed or doesn't open the Microsoft page (friend too) -> fixed;
remove "download game files without signing in" -> removed; invisible pointer in F11 fullscreen -> `CursorFix`
in the home mod; he would like a custom Reminth cursor in game -> not built (risk of two pointers); he later
said "the pointer vanishing is really a common things in fullscreen games, once you finish building the cursor..."
(he may still expect a custom cursor: **ask/decide**).
Then (20:53): the playstyle setup request (section 9) -> built, installed on his PC.

**6 Oct.** Owner woke up logged out of Claude (he had ignored a "log out and in again to secure your account"
warning for ~2 weeks), the chat was gone from the desktop app; found it via terminal; asked to restore it in the
desktop app (not possible safely); then asked for this hand-off: "Rewrite a HUGE AND PERFECT handoff with every
possible thing we said in that chat even the not important things".

## 6. ReminthHUD (bundled mod, `hud/` and `hud-1.21/`)

- Current: **1.3.1**, ten jars in `assets/mods/`: `reminthhud-1.3.1+{1.20.1, 1.21-1.21.1, 1.21.4, 1.21.5,
  1.21.6-1.21.8, 1.21.9-1.21.10, 1.21.11, 26.1, 26.2, 26.3}.jar`.
- Shows one plain line top-right: `FPS | GPU % | CPU % | LAT ms` (75 % size, no background, no shadow, grey
  labels, light-grey bold values, no coordinates), H toggles, hides with F3, moves under potion icons.
  GPU via Windows PDH (`GpuCounter.java`: FFM on 26.x, JNA on older), CPU via `OperatingSystemMXBean`.
- JEI early start (`JeiEarlyStart.java`).
- Server stats (`ServerStats.java`, both copies): sends `ServerboundClientCommandPacket(REQUEST_STATS)` 100
  ticks (5 s) after joining a server, then every 600 ticks (30 s), reads `player.getStats()`, merges with the
  existing file keeping the larger value of every counter (same uuid), writes
  `.reminth/server-stats/<server-address>.json` ({stats, server, uuid, savedAt}). Singleplayer/LAN skipped
  (`-Dreminthhud.statsTest=true` to test in singleplayer; `-Dreminthhud.statsFirst/statsEvery` override).
  Off with `"serverStats": false`.
- Config `config/reminthhud.json`: `fps`, `gpu`, `cpu`, `lat`, `jeiEarlyStart`, `serverStats`.
- Launcher side: `gameData.readServerStats`, `playerStats` (latest file per server, account match),
  `totals.placed` from `estimatePlacedBlocks(used)` (item uses minus tools/armor/food/throwables/buckets/etc.;
  test `test/game-data-placed.test.js`). Owner's real DonutSMP data: mined 4920, used 11149, player_kills 2304,
  deaths 1848; PvPClub sent nothing. DonutSMP's own mined/placed leaderboards are plugin data, not vanilla stats.
- HUD is on by default once for existing Fabric/Quilt instances (`hudDefault.js`, marker
  `hud-on-by-default.json`); per-instance switch `hud`.
- Build (from PowerShell; quote every `-P` argument, PowerShell splits `26.3` otherwise):
  `hud`: `.\gradlew.bat build -q "-Pversion=1.3.1+26.3"`;
  26.2: `"-Pminecraft_version=26.2" "-Pfabric_api_version=0.159.0+26.2" "-Pversion=1.3.1+26.2"`;
  26.1: `"-Pminecraft_version=26.1" "-Pfabric_api_version=0.145.1+26.1" "-Pversion=1.3.1+26.1" "-Pmc_range=~26.1"`;
  older: `hud-1.21\build-all.ps1` (set `$version`), output `hud-1.21\build-all\`.
  Copy jars to `assets/mods/`, delete the old version's jars (the launcher picks by declared range).

## 7. Reminth home screen (bundled mod `reminthhome`, `home/` and `home-1.21/`)

- Current: **1.0.3**, ten jars `reminthhome-1.0.3+{1.20.1, 1.21-1.21.1, 1.21.4, 1.21.5, 1.21.6-1.21.8,
  1.21.9-1.21.10, 1.21.11, 26.1, 26.2, 26.3}.jar`. Forge/NeoForge don't get it.
- Shared code `home/src/common/java/com/wxsted/reminthhome/` (`ReminthTitleScreen`, `ReminthHomeClient`,
  `Links`, `CursorFix`), resources `home/src/main/resources` (icons 64x64 + `.png.mcmeta` blur, panorama).
  Version layers: `home/compat/A` (26.2), `B` (26.3), `C` (26.1.x); `home-1.21/compat/P..U` (1.20.1, 1.21.1,
  1.21.4/5, 1.21.6-8, 1.21.9-10, 1.21.11) for `Compat`, `RoundButton`, `Shade`, mixins.
- `ReminthTitleScreen extends TitleScreen`: super.init, build own widgets, keep Mojang's "Copyright" widget,
  clearWidgets; Shade gradient; Singleplayer, Multiplayer (tooltip when multiplayer is disabled); third row
  Discover (`reminth://discover`) | Connect Discord ("Coming soon" label on click; only if there is room);
  icon row Skins (`reminth://skins`, tooltip), Mods (Mod Menu), Realms (cloud, via reflection), Options,
  Language, Quit; `hideForeignCornerButtons()` moves the ukulib button off screen.
- Swap: `GuiMixin/ScreenSwapMixin` HEAD + STORE hooks on `Gui.setScreen` (26.2/26.3) or `Minecraft.setScreen`
  (26.1 and older); only the exact vanilla `TitleScreen` class is replaced (other title-screen mods win);
  demo keeps vanilla; on any failure the vanilla screen is used. Panorama pitch -6 (`PanoramaPitchMixin`).
  Config `config/reminthhome.json {"enabled": false}` turns it off; `-Dreminthhome.debug=true` logs swaps.
- `CursorFix`: registers Fabric API's end-tick event by reflection; after a window-mode change (F11) and every
  100 ticks while the mouse is not grabbed, sets GLFW cursor mode NORMAL and the standard arrow (GLFW also by
  reflection: not on every build's compile path). Logs once "Reminth pointer fix: pointer reset...". Seen
  running on 26.2 without errors; the real invisible-pointer bug was never reproduced.
- Launcher side: forced (`config.BUNDLED_MODS` entry `forced: true`; `bundledModWanted` returns true), the
  instance dialog's switch hidden (`paintHome` returns early), jar hidden from the mod list (filter in
  `loadContentNow`), managed jars regex `MANAGED_JAR`.
- Build: `home`: `.\gradlew.bat build -q "-Pversion=1.0.3+26.2"`; 26.3 `"-Pcompat=B" "-Pminecraft_version=26.3"
  "-Pversion=1.0.3+26.3"`; 26.1 `"-Pcompat=C" "-Pminecraft_version=26.1" "-Pversion=1.0.3+26.1" "-Pmc_range=~26.1"`;
  older `home-1.21\build-all.ps1` (`$version`). Icons: `java home\IconGen.java <dir>`.
- Tested: Back/Esc/Create World/resize test mod 8/8 on 26.2 and 26.3 (before the 1.0.2/1.0.3 changes; not re-run
  since); screenshots of the 1.0.2/1.0.3 row and icons on 26.2 only.
- Known: Minecraft's small Accessibility button and the 26.x Friends button are not on our screen; Realms
  envelope can draw over buttons; a resource pack with a panorama replaces ours.

## 8. Playstyle setup (new 6 Oct)

- `src/main/purposes.js` (data + helpers), IPC `purpose:list/items/finish` (`main.js`, `preload.js`), UI
  `openPurposeSetup` (`features.js`), CSS `.purpose-*`, instance menu item "Set up for a playstyle..." (`pure.js`
  `instanceMenuItems`, test `test/instance-menu.test.js`), tests `test/purposes.test.js`, checker
  `tools/overnight/check-purposes.js` (re-checks every slug on Modrinth; all 50 had 26.2 and 26.1 builds).
- Flow: after creating a Fabric/Quilt instance -> "What is <name> for?" -> four cards: Survival & SMP, Crystal PvP,
  Sword & Axe PvP, Creative & building -> two tabs (the playstyle, Performance) with "Recommended" (ticked when a
  release/beta build exists and it isn't installed) and "More - less important, not ticked" -> Add selected
  installs one by one (`installProject` with `quiet`), then `purpose:finish` writes ready-made configs (only when
  the file is missing) and queues resource packs; `applyPendingPacks` (called in `minecraft.js` right after the
  options seeding, with the client jar) switches them on in `options.txt` and lists packs that declare an old
  format in `incompatibleResourcePacks` (a compatible pack must NOT be listed there or the game drops it). Pack
  format of the game from the client jar's `version.json` (`pack_version.resource_major`, 88 on 26.2); from
  format 65 on packs need `min_format`/`max_format`.
- Lists (owner: "about 20-30 really important mods/resource packs... nothing that servers consider cheating...
  betterhurtcam and all the mods perfect settings"; "not hardcore, add a performance tab instead"): see
  `purposes.js`. Not offered on purpose: fullbright, x-ray, freecam, auto-totem, macros (ClickCrystals, CPvP
  Macros, Autototem), hitbox helpers (Better Crosshair Indicator), Inventory Totem. Crystal/anchor optimizers and
  minimaps carry "check the server rules" warnings; only one crystal optimizer is ticked (Marlow's).
  `crystal-pvp-lt3-essentials` (the owner's pack) left out: 75 MB and it replaces the background.
- Ready-made configs (from the owner's own working configs, except BetterHurtCam): betterhurtcam (enabled, 0.25,
  YAW_BASED), low_fire_reborn (-0.3), ukus-armor-hud, totemcounter (pop counter on), totemtweaks (popSize 0.3),
  clientsidecrystals, client_side_anchors, zoomify, appleskin.
- Tested for real: Crystal PvP list on 26.2 into a throwaway instance (24 items, 29 jars with dependencies), game
  started with all of them + the home screen, the 3 packs loaded. **Not tested:** the other playstyles in a game,
  other versions, while signed in. The owner hadn't reported on it yet.

## 9. Tools and testing techniques (how the old window worked)

- **Dev app over CDP** (no mouse/keyboard): `node_modules/.bin/electron . --user-data-dir=<fake> --remote-debugging-port=9228`
  with `USERPROFILE=<fake home>` so it doesn't touch real data; then a tiny Node CDP client (`cdpx.js`: `eval`,
  `shot`) against `http://127.0.0.1:<port>/json`. Renderer globals (`switchPage`, `state`, `openPurposeSetup`,
  `window.reminth.*`) are callable. Add `--disable-renderer-backgrounding --disable-background-timer-throttling
  --disable-backgrounding-occluded-windows` for long scripts. Single-instance lock: the dev app won't start while
  the owner's installed Reminth runs with the same user data (use a separate `--user-data-dir`). Kill leftovers
  with a separate `.ps1` file (`Get-Process -Name electron | Stop-Process -Force`); **never** with a command line
  that contains the text it searches for (the old window killed its own shell that way).
- **Game harness** (`home-test.js`; a reference copy (renamed `home-harness.js` so npm test skips it) and `cdpx.js` are in `local-notes/`, the originals were in the old
  chat's temp scratchpad, which may be gone, so paths inside need adjusting): uses
  `minecraft.ensureInstalled` + `minecraft.launch` with a fake offline account (`Bench`, token "0"), options
  `mods: "clean"|"user"`, `jar`, `exclude` (regex), `USER_GAME` env (copy mods/config/resourcepacks of any
  instance), `keysAfter` (e.g. `{F11}`), `lowpri`, `wait`, `shots`, `w/h`. Window captures with
  `tools/overnight/capwin.ps1` (PrintWindow). Bisecting mods with `exclude` found the ukulib head.
- Copies of the overnight scripts are in `tools/overnight/` (README there): `sweep.js`, `modsweep.js`, `offline.js`,
  `syncswitch.js`, `packmove.js`, `fa_check.js`, `capwin.ps1`, `hometest/` (title-screen test mod),
  `check-purposes.js`.
- **Editing pitfalls**: Bash heredocs and inline Python strings lost backslashes and turned `\n`/`\r` into real
  characters several times. Write scripts with the Write tool into the scratchpad, then run them; check CRLF
  after editing. PowerShell splits `-Pminecraft_version=26.3` at the dot unless quoted.
- Packaged app smoke test: `dist\win-unpacked\Reminth.exe` with fake USERPROFILE and `--user-data-dir` and a CDP
  port. A test that registers `reminth://` must remove `HKCU:\Software\Classes\reminth` afterwards if it didn't
  exist before.
- Modrinth API research: `https://api.modrinth.com/v2/project/<slug>` and
  `/version?game_versions=["26.2"]&loaders=["fabric"]`, search with facets; send a User-Agent.

## 10. Open items, decisions and untested things (the to-do list)

### 10.1 Waiting on the owner (tests)
1. The 5 Oct night batches and the 6 Oct playstyle batch are installed on his PC but not confirmed:
   loading screen (looks/smooth bar), Skins opening speed ("it still has that small problem with skins"),
   streamer rail button only opens the page, Discover Installed-in-every-instance rule, no "Reminth home screen"
   in the mod list, no ukulib head, sharp icons, sign-in (Microsoft page opens, Get a new code; the friend too),
   pointer after F11, playstyle setup for each playstyle.
2. Server stats on a real server with HUD 1.3.1 (faster, never shrinking; placed estimate).
3. 26.3 title screen: click Singleplayer/Multiplayer once himself.
4. Friend with AMD/Intel graphics after release.
5. Then publish 1.4.8 (or 1.5.0) himself and re-upload the website.

### 10.2 Decisions open (recommendation first)
- Release number: 1.4.8 (built) or 1.5.0 (rebuild). Either is fine.
- Custom in-game cursor: not built (two-pointer risk); he may still want it.
- Iris beta to pair with Sodium on 1.21.1: recommend no (no silent betas).
- "Modrinth" on legal pages: kept (must name services); he wants to credit Modrinth later.
- Faint backdrop behind the HUD bar for bright skies (H1): not requested since.
- Who is legally responsible for players' data before a public announcement: an adult (parent/guardian); his name
  stays on the pages for now.

### 10.3 Ideas / roadmap (owner's order)
1. Bugs and glitches, small wins (ongoing).
2. Lunar-style in-game feature panel (big; plan first; server-rule labels; write features from scratch; owner
   wants to spend real time on it).
3. Connect Discord (button exists, "Coming soon").
4. Public announcement.
5. Anonymous usage counts (Level 1) after legal basics; friends-only presence (Level 2) later.
6. Legal and paid stuff (Reminth+, hosting) only with an adult; lawyer for Terms §10 withdrawal/no-refund,
   §12 liability, Privacy §7; business registration; code signing; domain (`reminth.gg` wanted, ~$10/year
   `.com`) when he has money.
7. Credits to Modrinth somewhere.

### 10.4 Known weak spots / not tested
- Ping: occasional 80-400 ms spikes vs Modrinth app's steady ~40 on his PC; not measured side by side.
- Quilt 1.21.1 with the newest popular mods conflicts (mods' fault).
- The title-screen Back test mod was not re-run after 1.0.2/1.0.3; icons/rows only seen on 26.2.
- Restart-and-update while a game runs never tested with a real release.
- IPv6 server addresses untested.
- Replay buffer isn't cleared when the game stops; the rail can show half a button in streamer mode (old).
- NVIDIA/Medal/Discord/Steam overlays can't be hidden by Reminth (accepted).
- Forge/NeoForge have no HUD or home screen; 1.21.2/1.21.3 and versions before 1.20.1 have no HUD/home builds.
- Three test items from the 3 Oct delete test may still be in his Recycle Bin.

## 11. Files of record
- `HANDOFF_FULL.md` (this), `CLAUDE.md`, `DECISIONS_AND_TEST_PLAN.md`, `YOUR_TESTS.md`,
  `CLAUDE_CODE_HANDOFF_10.md`, `PERF_PLAN.md`, `HOME_SCREEN_PLAN.md`, `CLOUD_PROMPT_2..17.md` and
  `CLOUD_PROMPT_UPDATES.md` (all done; history of what was asked), `REMINTH_STATE.md` (Sep sessions),
  `README.md`, `hud/README.md`, `hud-1.21/README.md`, `home/README.md`, `home-1.21/README.md`,
  `tools/overnight/README.md`.
- Local only (git-ignored): `local-notes/` (chat log and summaries), `release-1.4.8\`, `dist\`, `_to_delete\`.
