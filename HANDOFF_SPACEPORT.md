# Spaceport Launcher: the hand-off for the next Claude (written 21 Oct 2026)

**Read this file first, all of it.** It replaces `HANDOFF_FULL.md` as the starting point (that one is the complete history
of 3-6 Oct 2026 and is still true for the old parts; it says "Reminth" everywhere - the launcher has been renamed).
After this file read, in this order: `CLAUDE.md`, `OWNER_TODO_SPACEPORT.md`, the newest sections at the top of
`DECISIONS_AND_TEST_PLAN.md`, `design/NIGHT_DESIGN.md` (the look), `tools/spaceport-rename/README.md` (tools).
Your memory folder (`MEMORY.md`) is loaded automatically and has the owner's working style.

---

## 0. THE OWNER'S OWN PLAN FILE - READ IT RIGHT AFTER THIS ONE

On 21 Oct 2026 the owner was typing his plan for "the new start of Spaceport Launcher" (what he wants to happen, how
we continue, and the prompt for you) in a VS Code file. **That file is the task list. Do it, don't make your own.**
- **THE FILE (exact path, no file extension, saved 21 Oct 19:57):**
  **`C:\Users\kolijos\Downloads\reminth-launcher - Copy\discord\claude prompt, how we will continue the`**
  Read it with the Read tool (plain text). It sits in a different folder than the repo (`reminth-launcher - Copy`, an old
  copy of the project). If he wants it in the repo, copy it to `SPACEPORT_PLAN.md` (never delete the original).
- (If that path is gone: `SPACEPORT_PLAN.md` in the repo root, then the search below.)
- If it isn't there: look for newly saved `.md`/`.txt` files in `Downloads\reminth-launcher` and
  `Downloads\spaceport-experiment` (`find ... -mmin -2000`), also VS Code's unsaved backups are only a last resort
  (`%APPDATA%\Code\Backups\*\untitled\` - read them only if he says so). If you still can't find it, ask him in ONE short
  line to paste it or tell you the file name. He may also paste the text straight into the chat.
- Any "claude prompt" he mentions is the same plan/prompt: it takes priority over this file's suggestions.
- Read it fully, then say back in a few plain lines what you understood and in which order you'll do it (he is often away:
  start with the clear parts, ask only about irreversible ones - see section 6).

**21 Oct 2026 (evening) update:** the owner's question round is done - his answers are written at the END of his plan
file (above). Batch 1 is built (Spaceport+ removed, HUD can't be hidden, G panel = "Spaceport Built-in Mods", Tier Tagger
look-ups faster): see the top of `DECISIONS_AND_TEST_PLAN.md`. Batch 2 (same night): Narrator off by default, lag spike log, skin retry, Business box,
research in `design/RESEARCH_21_OCT.md`. He OK'd pushing to `main` (only when nothing in site/functions/workers changes -
that deploys the website); no releases. Model rule: tell him before each batch to use Opus 5.5 (UI, design,
hard bugs) or Sonnet 5.5 (simple code, renames, text).

**RULE (owner, 21 Oct 2026, late): do NOT design UI/pages yourself.** He rejected my Host a server cards ("terrible", reverted).
What he wants there: in the launcher ONE button that opens HIS WEBSITE on a page where the player chooses a host (5 free + 5
paid, ordered by published chip - data ready in `src/renderer/hosts.js`, research in `design/RESEARCH_21_OCT.md`). He will
explain/design it on **22 Oct** - when he asks to "remake" it, FIRST remind him he said not to design it myself, then ask him
how he wants it. Website pages only go on the branch `spaceport-website` (main deploys the live site).

**THE ORDER OF WORK (owner, 22 Oct 2026) - do the categories in this order, finish one before the next:**
1. **The launcher app UI** (his Claude Design files / his instructions; do NOT design it myself).
2. **The website** (UI, text, privacy policy, team page, downloads for every OS, search name/icon).
3. **The server / hosting systems** ("Select your host" page exists as v1 on the branch; linking a host with an API key, start/stop, whitelist, ban list, MOTD, friends see the server - plan in `design/HOSTING_PLAN.md`).
4. **The in-game side:** better in-game UI, bug fixes, more mods for the G panel ("G panel" is just his shortcut name; players see "Spaceport Built-in Mods").
5. **A final review before publishing** (and then the GitHub clean start - ask first).

**WHERE WE ARE (22 Oct 2026, night):** category 1 (launcher look) is DONE (owner: "the ui is fully complete"). Now **category 2, the website**, on the branch `spaceport-website` (worktree `Downloadsspaceport-website-wt`, NOT live): new homepage `site/index.html` + `home.css` + `home.js` built from his own words (black top bar 2.4 cm with logo + name, his picture `site/img/hero.jpg` 20 cm, logo + name + "Download" + blue Windows/macOS/Linux buttons in the middle, fade on scroll). Every round is listed in `design/OWNER_DESIGN_NOTES.md` (section "Category 2"). Next: whatever he says comes below the picture. Show changes by opening `site/index.html` in his browser (Start-Process). He gives exact instructions; he does not want recommendations unless he asks ("dont recommend me").

**WHERE WE ARE (22 Oct 2026, late night - he continues 23 Oct):** still **category 2, the website** - he says it has "SO much stuff left, we aren't even close to finished". The homepage top part is built from his two mockups (`design/spaceport-page-mockup.png` is the one he wants): black bar with logo + name, Sign in / Sign up (unknown avatar) + red EXPLORE top right (UI only, no code behind them - his words), see-through menu strip on the picture (News/Staff/Download/Support/Socials), full-screen picture, opening animation, Windows/macOS/Linux buttons. Exact list of rounds 1-14: `design/OWNER_DESIGN_NOTES.md` "Category 2"; what's left: top of `DECISIONS_AND_TEST_PLAN.md`. How to show him: save, `Start-Process` on `Downloads\spaceport-website-wt\site\index.html`, say "press F5". How I checked without his screen: Edge headless screenshots (`msedge --headless --screenshot --window-size=W,H --virtual-time-budget=3000 file:///...`); his screenshots are in `Pictures\Screenshots` (newest first).

**His UI instructions for category 1 are collected in `design/OWNER_DESIGN_NOTES.md` (running list) - read and extend it.**

## 1. The 60-second picture

- **Spaceport Launcher** (until 16 Oct 2026 called **Reminth**) is an Electron Minecraft launcher for Windows, built
  with the owner (GitHub `WxstedGOTY`, signs as Wxsted). Repo: `C:\Users\kolijos\Downloads\reminth-launcher`
  (GitHub `WxstedGOTY/reminth-launcher`, branch `main`). Plain JS (CommonJS), no bundler, no `innerHTML` anywhere.
- **Nothing is released.** The last public release is **1.8.0** (15 Oct, the Night look); `package.json` still says 1.8.0.
  Everything since is on `main` but unreleased and uninstalled. **The owner decided (17 Oct): no more GitHub releases
  for now. The first Spaceport release will be the FIRST release ever - "GitHub starts from zero" - once he has fixed
  everything he wants.** He is writing "a long list" of what he wants for this "new start of Spaceport Launcher"
  (hundreds of UI changes, bugs, add-ons). **Do that list; don't invent your own roadmap.**
- `main` is at `1f360bc`, pushed, clean. `npm test`: **712 pass, 0 fail**. A second branch `spaceport-website`
  (`726272f`, pushed, tested, worktree `C:\Users\kolijos\Downloads\spaceport-website-wt`) holds the renamed website +
  server + bot + privacy v14 / terms v9. **site/ and functions/ go live the moment they reach `main`** (GitHub workflow
  "Website to Cloudflare"), so that branch waits for the first release. The live site (reminth.pages.dev) still says Reminth.
- He is on a **weekly usage limit**; he continues the work on **Wednesday 22 Oct 2026**. When he is low on limit he
  wants: nothing left broken or half done, and a note of what to do.

## 2. The owner and how to work with him (also in memory `owner-and-working-style`)

- 14, from Greece, **not a programmer**. Wants **short plain answers in few easy words**, an answer first, then a clear
  numbered "what do I do now". When confused give ONE next action. He types fast with typos: read for intent; stray
  text like `kkkkkk` is a stray keypress - ignore it.
- **Do what he asks, directly.** Example: he said "just open me what im asking for" - so open the file in VS Code
  (`code -r <folder> <file>`; VS Code is at `C:\Users\kolijos\AppData\Local\Programs\Microsoft VS Code\bin\code`)
  instead of explaining how. He often says "dont ask me to do anything" / "dont ask questions" while away: pick the
  sensible option, say what you assumed, keep going. But for **irreversible / outward-facing** things (GitHub history,
  releases, spending, accounts) always ask first.
- **Honesty over looking finished**: mark every claim "seen working in a real game/app" or "not tested". Report outcomes
  faithfully (he noticed unfinished things before).
- He **uploads GitHub releases himself**. Never create a release. Always hand him the release text with an installer.
- He checks every UI change in the **"Reminth Live Preview" desktop shortcut** (`tools/preview/live.cmd`, now titled
  "Spaceport - LIVE PREVIEW", own data in `Downloads\reminth-live-preview`, auto-reloads when `src/renderer` changes,
  restarts when `src/main` changes). After a change: save, tell him "look at the preview" and what to look at.
- He plays Minecraft on this PC (Fabric 26.2 "Reminth"/"Spaceport" instance, PvP servers). **Never touch his screen
  or kill his game; check `tasklist` for `javaw.exe` before any real test game** (it gets a window). Window-only
  screenshots (PrintWindow), never the whole desktop. Never print the `javaw` command line (contains the access token).
- **No money**: no domain, code-signing, paid hosting without him + a parent. A parent/guardian must be the legal party
  for anything paid (Sponsored box payments, Plus). His real name is on the legal pages - keep it.
- Never enter passwords/credentials, never sign in for him. Test accounts are offline fakes ("Bench", token "0").
- **Computer-use / browser-click tools were NOT available** in the last session (no `mcp__computer-use__*`); he asked
  me to click Cloudflare for him and I could not. If they exist in your session, you still need his login. The
  Railway MCP was connected earlier (disconnected at the end).
- Commit attribution: end commit messages with the Co-Authored-By line the session gives you.
- Some PowerShell/Bash commands were denied by the auto-mode classifier (listing windows by title, `Get-Process`
  window titles). Use another route (Glob/Grep/Read, `tasklist`) rather than fighting it.

## 3. What exists (the product) - short map

Full inventory: `HANDOFF_FULL.md` section 3. Key places:
- `src/main/` engine (`main.js` IPC + window + launch, `minecraft.js` install/launch, `content.js`/`modsSync.js` mods,
  `instances.js`, `store.js` settings, `msAuth.js`, `reminthAccount.js` (the site's account API), `presence.js` (Friends),
  `sponsor.js` (Sponsored box), `mcTextures.js` (Minecraft's own icons), `runningGames.js`, `windowRestore.js`,
  `updater.js`, `paths.js`, `config.js` ...).
- `src/renderer/` the window: `index.html`, `renderer.js` (Home, Play, Friends, Sponsored box, Host a server, Settings),
  `features.js` (Discover, mods, instances, skins, streamer), `pure.js`, `skinview.js`, `styles.css`,
  `night-extra.css`, `motion.css`; **`styles-night.css` and `styles-frost.css` are MADE** - after any `styles.css` or
  `night-extra.css` edit run `node tools/night.js && node tools/frost.js` (a test fails if they are stale).
- `hud/` + `hud-1.21/` = the in-game mod **Spaceport HUD** (FPS bar + the G panel, 270 features); `home/` + `home-1.21/`
  = **Spaceport home screen** (title screen). 10 jars each in `assets/mods/` (HUD 1.6.1, home 1.0.10). Gradle builds;
  `tools/spaceport-rename/build-mods.ps1` builds all 20.
- `site/` the website, `functions/` Cloudflare Pages functions (accounts, Friends, Sponsored box, Discord bot,
  owner tools), `workers/cron` (bot's every-minute check), `discord/texts.md`, D1 database.
- Look: **Night** (black/white, cream = the one thing you press, Pixelify Sans headings in the REGULAR weight - bold
  closes the C - Inter for numbers, drawn pixel digits on Home). Black only: no theme/accent pickers (owner's rule).

## 4. What was built since 1.8.0 (all on `main`, unreleased)

Details + test plans: `DECISIONS_AND_TEST_PLAN.md` (newest first). In short:
1. **Home v2** (15 Oct): new night sky background (`assets/img/new background reminth.webp`), launch panel never
   cropped, LAUNCH GAME, your skin (3D viewer, centred, waves hello with the hand UP next to the head) + Minecraft-font
   name, recent servers/worlds in the panel, 12 live server cards (counts via `servers:ping`), motion/animations.
2. **Home layout fixes (16 Oct):** side columns `height: 100vh - 144px` so nothing jumps at the end of scroll; the
   character's top lines up exactly with the servers' top (`alignHomeCharacter` lifts it on big windows); Discord
   card in Discord blurple with the real logo, 70px tall, 16px from the bottom.
3. **Friends** (15 Oct): friend codes, requests, presence every 2 min, Join, Appear offline (`functions/_friends.js`,
   `src/main/presence.js`, renderer "friends"). Tested with two hidden launchers against a local server; **not against
   the live server.**
4. **Sponsored box** (16 Oct): the empty ad slot under Friends shows ONE Minecraft server the owner sets on the website
   (account page -> Owner tools -> "Sponsored box"): name, address, picture, first/last day; always labelled
   "SPONSORED"; no tracking. Parts: `functions/_sponsor.js`, `functions/api/sponsor/*`, `functions/api/admin/sponsor.js`,
   `src/main/sponsor.js`, renderer `loadSponsor`, `tools/sponsor-e2e.js`. A parent must take any money. (The owner
   asked about "ads like YouTube": explained Google ads are not allowed in PC apps, need 18+, track kids. Servers pay
   instead. No real sponsor yet.)
5. **Minecraft's own stat icons** (16 Oct): diamond sword, skeleton skull (3D), PIG head (replaced the creeper), iron
   pickaxe, grass block (3D), read from a downloaded game jar (`mcTextures.js`, never shipped), hand-drawn fallback.
6. **Launch clean-up** (16 Oct): no Stop button anywhere; `sweepRunning` (5 s) ends a session whose process vanished or
   whose game window was closed but Java hangs; the page re-checks "Playing" (`syncRunning`); Reminth **stays open** when
   the game starts (`launchMinimized` default false + one-time move `stayOpenVersion`); a window Windows shrank goes to
   the middle (`windowRestore.centeredBounds`). Not tested with a real fullscreen game.
7. **Host a server** (17 Oct): real page replacing the "coming soon" mockup: free **Aternos** steps matching the
   instance, Open Aternos, address box -> Add to my servers / Join. (Research: no free hosting of our own - it costs
   money per server; partners won't take a 0-player launcher. Later ideas: affiliate programs ScalaCube 50% first
   payment / StickyPiston 10% / Apex via Daisycon, **exaroton's public API** to start/stop a player's own server and edit
   whitelist/settings in the launcher, BisectHosting partner program once there are real numbers. Owner chose "only
   Aternos for now".)
8. **THE RENAME** (16-17 Oct): section 5 below.

## 5. The rename (important - do not undo)

- Every name a player sees: **Spaceport Launcher** (formal spots: window title, installer, shortcuts, page titles, link
  previews, "Welcome to ...", "<name> <version>") / **Spaceport** (sentences, product names: Spaceport account,
  Spaceport+, Spaceport HUD, Spaceport home screen, Spaceport Mods Panel, SPACEPORT MODS PANEL). Home's big title:
  SPACEPORT, regular pixel weight. Home's version line: "Spaceport <version>" (the long name doesn't fit next to What's new).
- **Hidden names stay "reminth" on purpose** (changing them loses players' data, sign-ins or shortcuts; **nobody
  except the owner and one friend has ever had the app, so the owner may now allow cleaning them - ASK**):
  `%APPDATA%\Reminth` (all data), `%APPDATA%\reminth-launcher` (Chromium profile with the key for saved sign-ins; pinned in
  `main.js` for the installed app, a `--user-data-dir` given on purpose wins), `package.json` name/`appId`
  `com.reminth.launcher`, the program file **`Reminth.exe`** (`build.executableName`), `reminth://` links, mod ids / class
  names / config files (`reminthhud.json`) / jar prefixes, localStorage keys, log lines, the API address
  `reminth.pages.dev`, the repo name in `publish` / `updater.js`. `Videos\Reminth` clips folder: new players get
  `Videos\Spaceport Launcher`, existing keeps the old (`paths.capturesDir`). The main instance named exactly "Reminth" is
  renamed to "Spaceport" once (`instances.normalise`).
- Installer: `Spaceport-Launcher-Setup.exe`, `latest.yml`. A test build was made and started with test folders (sign-in
  card says Spaceport; real folders untouched). **An in-place update of an installed Reminth was NOT tested.**
- Website/bot/privacy v14/terms v9: on branch `spaceport-website`. The bot finds AutoMod rules ("Reminth: x") and
  the channel webhook made under the old name and renames them (`OUR_RULE`, `ruleKind`). New `site/og.png` (Night look).
- The in-app privacy summary says **v14** while the live website says v13: harmless until the first release.
- Kept unchanged: email `reminthsupport@gmail.com`, X `x.com/reminthsupport`.
- Tools to redo/extend a rename safely (string literals only): `tools/spaceport-rename/` (README there).

## 6. Decisions still open (recommendation first)

1. **Starting GitHub "from zero"** (his words). IRREVERSIBLE and ends updates for any installed Reminth - ASK first.
   Recommended: same repo, new clean history (one first commit of the current code), he deletes the old releases by hand
   (GitHub -> Releases), rename the repo to `spaceport-launcher` (update `package.json publish`, `updater.js`,
   website download links together). Alternative: a brand-new repo. Don't force-push or delete anything without a clear yes.
2. First release number: **1.0.0** (a fresh start). Earlier recommendation was 2.0.0; superseded by "start from 0".
3. Hosting: site stays on **Cloudflare** until a move to **Railway** (paid) - no new Cloudflare project, no Discord/Google
   redirect changes (the old plan, steps B-D, was cancelled). The Railway move needs a plan: `functions/` are Cloudflare
   Pages Functions + D1 (SQLite); Railway runs normal servers, so code changes. A parent pays.
4. Optional for him: rename the app in the Discord developer page and Google consent screen (names only).
5. "Spaceport+" page still promises "a server included when Spaceport Hosting launches" - rewrite when he decides.
6. Clean the hidden names (section 5)? Only if he says yes.

## 7. Working recipes that cost me time (use them)

- **Look at the UI without touching his screen:** `tools/preview/README.md`. From PowerShell use
  `System.Diagnostics.ProcessStartInfo` with `-r ./tools/preview/hidden-hook.js . --remote-debugging-port=9333`, env
  `USERPROFILE`/`PREVIEW_PROFILE`/`PREVIEW_W`/`PREVIEW_H` (a Bash `run_in_background` start failed to open the port).
  Then `node tools/preview/cdp.js 9333 eval "$(cat tools/preview/fake-home.js)"` (fake signed-in state),
  `... shot out.png "switchPage('home'); await ..."`, `node tools/preview/cdp-console.js 9333 5` for script errors.
  Hidden windows don't draw frames: animations/`requestAnimationFrame` don't run there (step them by hand).
  Stop with a `Get-CimInstance Win32_Process` filter on `hidden-hook` (never a command line containing the text it searches).
- **Tests:** `npm test` (712). Website/server e2e need a local server: `node tools/accounts-mock.js` +
  `npx wrangler@4 pages dev site --port 8788 --d1 DB=<new name each run> --binding ...` (the exact bindings are at the
  bottom of `tools/accounts-e2e.js`, `bot-e2e.js`, `sponsor-e2e.js`, `friends-e2e.js`), then `node tools/<x>-e2e.js`.
  Restart BOTH after each run (the mock remembers state). The old "bot e2e second run edits" step was fixed.
- **Real game test:** `node tools/spaceport-rename/game-check.js <version> [seconds]` with `USERPROFILE` set to a scratch
  home (see its README). Only when no `javaw` runs. Tested 26.2 and 1.21.11.
- **Edit pitfalls:** Git Bash eats backslashes/`$` in inline `node -e` -> write scripts with the Write tool. Many files are
  CRLF (`styles.css`, `store.js`, `paths.js`, `functions/_bot.js`, `_texts.js`, tests...) - check with a Node
  `\r\n` count (the shell `grep -c $'\r'` lied), keep them. The last CSS rule in `styles.css` must stay last.
- **Website work:** only on a branch/worktree; pushing `site/**` or `functions/**` to `main` deploys to production.
- **Hand-off rule (CLAUDE.md):** after every batch rewrite the top of `DECISIONS_AND_TEST_PLAN.md` (what changed, commit,
  test count, decisions, weak spots, PASS/FAIL plan), commit and push it, tell the owner.

## 8. Known weak spots / not tested for real

Friends against the live server and with real accounts; JOIN from the Sponsored box / Host a server page into a real
server; the "Playing" safety net (`sweepRunning`) with a real hung Java; the window-centring with a real fullscreen game;
Spaceport home screen on 26.3 (title screen) by hand; in-place update from the old installer; the Cloudflare/Discord/Google
side of the rename (nothing was changed there); Quilt 1.21.1 with the newest mods (mods' fault); ping spikes vs Modrinth's app
(never measured side by side).

## 9. The owner's experiment copy

On 21 Oct he asked for a safe copy to read/edit while his limit resets: `C:\Users\kolijos\Downloads\spaceport-experiment`
(a `git clone` of this repo, **remote removed** - cannot push, own `node_modules`). `START MY COPY.cmd` runs it with its own
data (`Downloads\spaceport-experiment-data`, port 9441); `READ ME FIRST.txt`; read-only combined files in
`READ-ONLY (nothing runs from here)\` (JS / CSS / HTML, for colour in VS Code); `.vscode/settings.json` forces colours.
It also contains two files he or another program added: `robloxstudio.exe` and `spaceport-experiment.code-workspace`.
**When he returns he may ask you to bring his edits into the real project:** compare with
`git -C ..\spaceport-experiment status` / `git diff` (it's a normal git repo), review, then port the good changes by hand
or `git diff | git apply`; run the tests. Don't copy over `.vscode`, the read-only folder or the READ ME.

## 10. Where everything is written

- This file; `CLAUDE.md` (short rules, points here); `OWNER_TODO_SPACEPORT.md` (what he does / decides);
  `DECISIONS_AND_TEST_PLAN.md` (living log, newest first); `design/NIGHT_DESIGN.md` (look, tokens, Home v2);
  `design/privacy-v14-draft.md` (now applied on the branch); `HANDOFF_FULL.md` (old complete history);
  `CLAUDE_CODE_HANDOFF_10.md` sections 0-1 (codebase rules: no innerHTML, CRLF, never delete a player's mods, atomic writes);
  `tools/preview/README.md`, `tools/spaceport-rename/README.md`, `tools/overnight/README.md` (older test scripts);
  memory: `MEMORY.md` index (`spaceport-rename`, `owner-and-working-style`, `friends-system`, ...).
- Local only (git-ignored): `local-notes/` (old chat logs), `release-*\`, `dist\` (a test installer from 17 Oct is in `dist\`).
