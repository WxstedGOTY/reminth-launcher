# Reminth: what to know, decide and test

**This is the one living hand-off file between the windows.** Every Claude Code session that finishes
work rewrites it (see `CLAUDE.md`). Desktop window: `git pull`, read this top to bottom, then work
section 4 in order (it starts with prompt 17, then Audit 16) and report PASS/FAIL per step.

- **10 Oct 2026 (later): Reminth 1.7.1 (Tier Tagger) PUBLISHED - assets checked (latest.yml 1.7.1, sha512 matches).**
- **10 Oct 2026: 1.7.0 PUBLISHED. The Discord bot is built (section 00000000000000000000000000000); the owner switches it on with `OWNER_TODO.md` Part E.**
- **9 Oct 2026 (evening): 1.7.0 rebuilt (accounts required, Discord/Google/email, Discord server pull, blue default), NOT
  installed, NOT published. The owner's exact steps are in `OWNER_TODO.md` (steps 1-9: Discord app + bot, Google client,
  D1, Cloudflare variables, rerun workflow, test website, install, publish, later the server pull).** Sections
  0000000000000000000000000000 and 000000000000000000000000000.
- **NEXT after that (owner, 9 Oct 2026): marketing.** 1.6.1 is published; the website is live at https://reminth.pages.dev (auto-deployed to
  Cloudflare from `site/`), Google Search Console verified and sitemap submitted. Remind the owner marketing is left; other
  changes come from him.
- **New chat: read `HANDOFF_FULL.md` first.** **Last updated:** 8 Oct 2026 (night), desktop window: newest section below is 00000000000000000000000000 (1.6.1: brand colours, see-through icon, website). Before it 0000000000000000000000000 (1.6.0). Before it 000000000000000000000000 (fullscreen pointer, 1.21 HUD missing, window size, quiet Play). Before it 00000000000000000000000 (the panel on every version).
- **`main` is at:** this file's commit. **`npm test`: 679 pass** (10 Oct) (Windows, 8 Oct, after merging `claude/stoic-lovelace-y9p76z`: new app icon + orange brand colour; `main.js` setAppUserModelId guarded for the tests). Newest installer: `release-1.6.0\` (20:47; not installed, not published; `release-2.0.0*` folders are outdated).
- **Version:** `package.json` says **1.7.0** (installer `release-1.7.0\`) - **published 9 Oct 2026**.
- Prompts 10-13 were released in 1.4.1; steps below not marked PASS are still open. Release steps: section 4, R2 first.
- Rules: `CLAUDE_CODE_HANDOFF_10.md` sections 0-1.

---

## 000000000000000000000000000000. Tier Tagger in the G panel, Reminth 1.7.1 (10 Oct 2026) - desktop window

**Owner:** "a tier tagger that reaches every tier tracking website for your opponents' tier on any PvP gamemode".

**Research (10 Oct):** MCTiers (mctiers.com) - official v2 API, used by the official TierTagger mod, but the DOMAIN
DOES NOT RESOLVE right now (NXDOMAIN, also via 1.1.1.1). PvPTiers (pvptiers.com) - no official API, its own website's
`/api/profile/<uuid without dashes>` works. SubTiers (subtiers.net) - `/api/v2/profile/<uuid>` works. OuterTiers -
domain gone. Arise / Central TierList / mctiers.it - websites only, no API found. All three APIs: `{rankings: {mode:
{tier 1-5, pos 0 high / 1 low, retired}}}`.

**Done:** `hud/panel/java/.../panel/TierTagger.java` (Visual, ON by default - the owner's call; privacy v11 says so): options tier list (all = best / one),
gamemode (best or Crystal/Sword/UHC/Pot/NethPot/SMP/Axe/Mace/Elytra), above heads, tab list, show gamemode, show
retired. Shared mixins in `hud/panel/java/.../mixin/` (both builds): `TierNameMixin` (Player.getDisplayName, only
AbstractClientPlayer - singleplayer's server players untouched) and `TierTabMixin` (PlayerTabOverlay.getNameForDisplay)
- same names 1.20.1-26.3 (checked with javap in every version). `/tiers <name>` (Fabric client command built with plain
Brigadier because ClientCommandManager was renamed ClientCommands). Cache 30 min per player per list, 2 min after a
failure, 6 requests at once, offline-mode (v3) UUIDs never looked up. GameProfile id/name read by reflection (class up
to 1.21.8, record after). Test switch `-Dreminthhud.testTier=<s>`. ReminthHUD **1.5.0** for all 10 jars in
`assets/mods` (same ranges as 1.4.0). Privacy v11 (section 5). Launcher **1.7.1** (What's new), installer `release-1.7.1\`.
- **Tested in real games (hidden window):** 1.21.11 - both mixins applied, own name "HT1 Crystal | Bench" with a ranked
  account id, `/tiers michaelcycle00` -> PvPTiers HT1 Crystal / HT1 Sword / LT2 Pot (retired), MCTiers unreachable,
  SubTiers not ranked; 26.3 - both mixins applied, decorate -> "HT1 Crystal | X", same `/tiers`. All 10 jars compile;
  1.20/1.21 jars carry the remapped targets (method_5476, method_1918).
- **Not tested:** other players' nametags and the tab list on a real server (singleplayer has neither); 1.20.1 and
  26.1/26.2 in a game (same shared code).

---

## 00000000000000000000000000000. The Reminth Discord bot (10 Oct 2026) - desktop window

**Owner:** a full custom bot while he builds the server: ban, kick, timeouts, auto-moderation, purge, release posts in an
updates channel, "and more".

**Done** (no new hosting - Discord sends slash commands to the website):
- `functions/_bot.js` (commands + handlers), `functions/api/discord/interactions.js` (Ed25519-checked with
  `DISCORD_PUBLIC_KEY`; PING/PONG; slow work deferred with `waitUntil`), `functions/api/admin/discord-commands.js`
  (owner button "Set up the bot's commands" on the account page -> guild commands), `functions/_pull.js` (the server
  pull, shared by the website button and /pull; gives the Player role). Tables `bot_config`, `warnings`.
- Commands: /ban /unban /kick /timeout /untimeout /warn /warnings /purge (Discord default permissions + checked again;
  role hierarchy, owner and self refused; DM with the reason; audit-log reason; #mod-log embed), /automod setup|status|off
  (Discord's native AutoMod: spam, mention spam + 10 min timeout, invite-link regex, presets slurs/sexual [+profanity]),
  /config modlog|bugs|player-role|show, /download /changelog /help /bug (modal) /account /verify, owner-only /pull /stats.
- Release posts: `.github/workflows/discord-release.yml` + `tools/release-to-discord.js` (secret
  `DISCORD_UPDATES_WEBHOOK`; also runnable by hand for a tag).
- **Tested:** `tools/bot-e2e.js` 14 steps (signed with a test-only key) against `wrangler pages dev` +
  `tools/accounts-mock.js` (now also a pretend Discord REST API) - all pass; `tools/accounts-e2e.js` still 21/21.
- **Not tested for real:** real Discord (needs the owner's Part E in `OWNER_TODO.md`), the GitHub webhook post.
  Not possible this way (needs an always-on bot, ~$5/month): XP levels, custom welcome messages, message logs.

---

## 0000000000000000000000000000. Reminth accounts for everyone: required step, Discord/Google/email, Discord server pull, blue default (9 Oct 2026, evening) - desktop window

**Owner:** the Reminth account at the top of Home instead of the Minecraft account; a required first step ("you also
gotta connect Discord or Google or email"); Discord sign-ins must be pullable into his future Discord server with a
button; official Discord/Google icons; email as its own button that opens a panel; "gamer tag" instead of name; the
Blue/Orange pick on that first screen, blue by default; a better-looking step tracker; simple exact steps for him.

**Done:**
- **Server** (`functions/`): one account with several sign-in ways. Tables `accounts`, `identities(provider, subject,
  account_id, secret, guild_joined_at)`, `sessions`, `login_codes`, `tries` (made on first use; an old 1.7.0-test
  `users` table is copied over once and dropped - untested, no live data existed). `_oauth.js` = Discord (scope
  `identify guilds.join`, refresh token kept AES-GCM encrypted, key from `TOKEN_KEY` or the Discord client secret) and
  Google (`openid profile`). Routes `/api/auth/[provider]/start|callback` (`?link=1` = "Connect" on the website),
  `/api/auth/email` (signup/signin, PBKDF2-SHA256 100k, 8+ chars, 10 tries/15 min per address, 30 per network),
  `/api/account/settings` (discordPull opt-out), `/api/admin/discord` (owner only: `ADMIN_DISCORD_ID`; GET numbers, POST
  adds 10 per call to `DISCORD_GUILD_ID` with `DISCORD_BOT_TOKEN`, handles 429 waits, stops on a wrong token/server/
  permission). Delete also revokes the Discord token. `/api/status` -> `{accounts, providers}`.
- **Website** `site/account.html`: Discord/Google/email buttons (email opens a panel), connected ways + Connect, the
  Discord-server checkbox, Owner tools box. Privacy v10, Terms v8.
- **App:** `#rmGate` (Home): step 1 Reminth account (Discord / Google via browser + `reminth://auth`, email straight from
  main via `reminthAccount.emailSignIn`), Pick your look (Blue/Orange), then step 2 Microsoft (`#mcSteps`). The whole
  app waits behind it like the Microsoft gate (`rmGateNeeded()` in `applyAccountUI`/`switchPage`) - only when the
  server says accounts are on; offline or off = no gate. Top bar chip = Reminth account ("Playing as <MC name>").
  Theme default `frost` (store.js); an unchosen accent follows the theme; `index.html` loads `styles-frost.css` first.
  CSP allows `lh3.googleusercontent.com`. Invalid `font: ... inherit` shorthands fixed (app + website).
- **Tested:** `tools/accounts-e2e.js` 21 steps against `wrangler pages dev` + `tools/accounts-mock.js` (pretend
  Discord/Google/guild) - all pass; app in isolated test copies: email sign-up, Discord through a real second-instance
  `reminth://auth` link, the gate, both steps, top bar, fresh install is blue; `npm test` 679.
- **Not tested for real:** real Discord, real Google, the real bot adding people (needs the owner's setup);
  PBKDF2 100k on Cloudflare's free CPU limit (10 ms) - if email sign-in fails live with "exceeded CPU", lower
  `PBKDF2_ITERATIONS` (stored per hash, old hashes keep working).

- **Owner setup + test (9 Oct, evening):** D1 bound, Discord app + variables set - live `/api/status` says
  `{"accounts":true,"providers":["discord","email"]}`; a live email sign-up/delete worked (PBKDF2 within the CPU limit).
  Owner: C1 (website Discord) PASS, C2 (installed app, Discord) PASS. His changes, done after that:
  `src/main/openInBrowser.js` (AllowSetForegroundWindow(ASFW_ANY) through **koffi** - new dependency, only its
  win32_x64 build is packed - before every browser open, so a running Firefox comes to the front instead of blinking);
  callback page "Sign-in complete - you can close this tab"; website `?welcome=1` green message; the Discord-server
  checkbox and `/api/account/settings` removed (consent = Discord's Authorize page; leave the server / deauthorize in
  Discord); "Open the browser again" on the app's waiting view. Owner retest: browser comes forward PASS,
  sign-in complete PASS. 1.7.0 PUBLISHED by the owner (GitHub tag 1.7.0; assets checked: latest.yml 1.7.0, sha512 matches release-1.7.0\).

### Decisions for the owner
1. (Recommended: keep) Account required when accounts are on. Fallback: none blocks if the server is down.
2. No "forgot password" for email yet (needs an email service, e.g. Resend - costs nothing at small size, needs a domain).

### PASS/FAIL for the owner - see OWNER_TODO.md steps 6 and 7

---

## 000000000000000000000000000. 1.7.0: Reminth accounts, Orange/Blue theme, taskbar fix (9 Oct 2026) - desktop window

**Owner (away 6 h, "it's all on you"):** Reminth accounts with real sign-in (Discord) in the app and on the website;
a blue version of the style and icon, picked in Settings (orange/blue changes the whole app); the pinned taskbar icon
opened a second taskbar button; a deep bug check of everything; leave the steps to publish.

**Done:**
- **Taskbar:** 1.6.0 added `app.setAppUserModelId("com.reminth.launcher")`; a taskbar pin made earlier (pinning the
  running window) carries no id, so the window got its own button. The installed app no longer sets it (dev runs only).
- **Theme** (Settings -> Theme: Orange / Blue): `tools/frost.js` makes `src/renderer/styles-frost.css` and
  `assets/icons/source/reminth-mark-frost.svg` from the orange ones (warm hues -> cyan/sky, dark warm greys -> navy;
  green/amber/the error pink-red and lines with `data-accent` kept). `test/theme-frost.test.js` fails if they drift
  (run `node tools/frost.js` after editing styles.css). The renderer swaps the stylesheet link `#themeCss` and the logo
  images; main sets the window icon (`reminth-frost.ico`, made by `tools/make-icon-mark.js`). Setting `theme` (store.js).
  Picking a theme sets the accent to the theme's (ember / cyan). Checked in pictures; survives a restart.
- **Reminth accounts:** server = Cloudflare Pages Functions in `functions/` (deployed with `site/` by
  `.github/workflows/cloudflare.yml`) + a D1 database (binding `DB`; tables made on first use). Discord OAuth
  (scope `identify` only). Endpoints: `/api/status`, `/api/auth/discord/start|callback`, `/api/auth/exchange`,
  `/api/me`, `/api/auth/logout`, `/api/account/delete`. Sessions stored as SHA-256 hashes, 90 days; website cookie
  `rm_session` (HttpOnly, Secure, Lax), sign-in state cookie `rm_state`; cookie POSTs need same origin. App sign-in:
  `reminthAccount.startSignIn()` opens the browser with a random nonce; the callback page opens `reminth://auth/<code>`
  (deepLink.js allows exactly 32 hex); `completeSignIn` swaps it with the nonce at `/api/auth/exchange` (2-minute,
  single use; a link the app didn't start is ignored). Token stored encrypted (`reminth-account.bin`, safeStorage).
  UI: Settings -> Account (second row). Website: `site/account.html` (+ "Sign in" in the header; on phones next to the
  logo). Privacy v9, Terms v7. **Tested:** `tools/accounts-e2e.js` (13 steps incl. forged state, foreign nonce,
  reused code, other-site logout/delete, made-up tokens) against `wrangler pages dev` with a pretend Discord - all pass;
  the app's whole sign-in through a real `reminth://auth` link (second instance) in an isolated test copy - signed in,
  sign-out, a stray link ignored. Live: `/api/status` says `{"accounts":false}` until the owner's setup.
  **Not tested:** real Discord (needs the owner's Discord app).
- **Bug check:** every page in both themes clicked through in a test copy with all console/network errors recorded -
  none; no HTML injection points in the renderer; the owner's real error log only has the known "window said maximized
  but was 816x568; repaired" (handled every time); CI was red once (the theme test loaded store.js without the
  Electron stand-in) - fixed, green; website menu on phones (items pushed off screen) - fixed.
- Dev runs are isolated with `USERPROFILE=<fake home>` + `--user-data-dir` (never the owner's data).

### PASS/FAIL for the owner - see OWNER_TODO.md section 4

---

## 00000000000000000000000000. 1.6.1: brand colours everywhere, see-through icon, website (8 Oct 2026, night) - desktop window

**Owner after 1.6.0 went live:** buttons were orange but backgrounds and everything else still blue ("so ugly"); the icon
has a dark background instead of only the cube; and update the website's icon and style ("generally everything").

**Done:**
- **Launcher colours** (`styles.css`, via a mapping script): navy surfaces/lines -> warm charcoal, cyan/sky/violet/purple
  glows, tags and badges -> the brand oranges; status colours (emerald, amber, rose) kept; lines with `data-accent` (the
  accent picker and per-accent variables) left alone. Window background `#0c0909`; content-group colours warmed.
  Checked in pictures: Home, Discover, Settings, sign-in.
- **See-through icon**: `tools/make-icon-mark.js` makes `assets/icons/source/reminth-mark.svg` (the master without its
  dark tile, frame and big haze) and from it `reminth.ico` (16-256 px), the site icons. The app shows the mark with no box
  round it (rail, sign-in). Note: the .ico's small sizes are now rendered from the SVG (the delivered hand-tuned ones had
  the tile); they looked fine at 16/24/32 in a preview.
- **Website** (`site/`): same palette, the mark instead of the old embedded logo pictures (page 200 KB -> 68 KB),
  `favicon.svg`/png/apple-touch, a "New in Reminth 1.6.0" section of six cards, nav link "What's new". **On branch
  `site-update` only** - `pages.yml` deploys `site/**` from main, so it goes live when the owner says (merge
  `site-update` into main).
- Version **1.6.1**; `npm test` 667. A stray `assets/mods/reminthhome-1.0.7+26.2.jar` (untracked, appeared 22:13 while
  this session waited for the usage limit) was moved to the scratchpad - the new jar-range test caught it.
- Dev runs of the launcher are now isolated with `USERPROFILE=<fake home>` + `--user-data-dir` (paths.js uses
  os.homedir()), so they never read or record the owner's data.

**Publish 1.6.1** (owner): tag `1.6.1`, the three files in `release-1.6.1\`. Description:
> ## Reminth 1.6.1
> - The whole launcher in the new Reminth colours - no more blue backgrounds.
> - The Reminth icon is just the cube now (no dark box), on the taskbar, desktop and in the app.

---

## 0000000000000000000000000. Reminth 1.6.0 (was going to be 2.0.0) (8 Oct 2026, evening) - desktop window

The owner tested section 000000000000000000000000 (all PASS: fullscreen pointer, 1.21 panel and zoom, window size,
quiet Play, ban heads-up). Version bumped to **2.0.0** (`package.json`, `package-lock.json`); the What's new list
(`renderer.js` CHANGELOG) rewritten for everything since the last published release (v1.4.6). Installer:
`release-2.0.0\` (Reminth-Setup.exe, .blockmap, latest.yml version 2.0.0). Installed here. `npm test` 666 pass.

**For the owner to publish** (GitHub release v1.6.0, upload the three files in `release-1.6.0\`), description:

> ## Reminth 1.6.0
> - **Reminth Mods Panel** - press **G** in game: about 145 of Reminth's own features (FPS, keystrokes, armor,
>   potion timers, zoom, hit marker, chat timestamps and more), profiles, and a HUD layout editor. On every version
>   from 1.20.1 to 26.3.
> - **New title screen** - Discover opens the panel; tips on the title and loading screens.
> - **Pixel pointer** at your Windows pointer's size; in full screen Reminth draws it itself so it never vanishes.
> - **Pick what an instance is for** (PvP, survival and more) and get a matching set of mods and packs.
> - **Server rules heads-up** when a server bans one of your mods - nothing is turned off for you.
> - Player Statistics include your numbers from servers; the Library keeps your clips and screenshots.
> - Every Minecraft version Mojang lists launches, snapshots too.

---

## 000000000000000000000000. Fullscreen pointer, 1.21 HUD fix, window size, quiet Play (8 Oct 2026, evening) - desktop window

**Owner's results:** cursor shape right (PASS) but it vanishes in full screen; on 1.21 neither G nor C did anything;
the launcher in a window looked "hella ugly", everything tiny; the strip that flashes under "Welcome back" on Play is ugly.

**Fixed:**
- **Fullscreen Pointer** (new panel card, Utility, ON): in full screen, while a menu is open, ReminthHUD hides Windows'
  pointer and draws the pixel arrow itself at the mouse (`panel/SoftCursor.java`, `V.isFullscreen`, `V.osPointer`: GLFW
  input mode HIDDEN/NORMAL, SDL_HideCursor/ShowCursor on 26.3). Size = the home mod's Windows pointer size
  (`reminth.cursorPixel` system property). Home screen **1.0.8**: its pointer reset stays away while the property
  `reminth.softCursor` is set. On this PC Windows kept showing its pointer in full screen (GetCursorInfo flags 1), so
  the cause on the owner's PC is unknown - this works whatever it is. Tested: log "Reminth fullscreen pointer: drawn by
  Reminth" after F11 on 26.2; the arrow drawn in a window-only picture (test switch `-Dreminthhud.testSoftCursor=true`).
- **1.21 got no ReminthHUD at all**: a quick test build that only accepted "1.21.1" had been copied over the
  1.21-1.21.1 jar. All seven 1.20/1.21 jars rebuilt with `build-all.ps1`; new test `test/bundled-jar-ranges.test.js`:
  every bundled jar must be picked for both ends of the versions in its file name.
- **Window size**: `windowRestore.uiZoom` zoomed by the whole screen (default 1320x840 window = 69 %). Now 1 from
  1280x760 up, smaller windows only as needed, never below 0.75. Checked in a picture: default window at normal size.
- **Quiet Play** (`renderer.js` runPlay, QUIET_START_MS 3000): the progress strip/log in the hero stay hidden for 3 s;
  only a launch still busy then (downloads) shows them; errors show at once.

**Mistakes made (cleaned up):** one cursor test captured part of the desktop (deleted; window-only rule); a dev run of
the launcher read the real data and its replay buffer recorded ~15 s of the screen (3 segments deleted). Notes in memory.

**Installed** on this PC (8 Oct, 19:0x; installed jars checked byte for byte).

**Then (owner: "I don't care about MCPVP's rules, don't turn them off for players, just a small warning"):**
- His crystal/anchor optimizers were already back on (all five on in his PvP instance) - nothing changed there.
- **Ban warnings are now a heads-up only.** Launcher (`features.js` serverRulesBeforePlay): no popup, no "Turn them off"
  - one small toast naming the server and its banned mods (once per set of mods), and Play goes on. In game (home screen
  **1.0.9**, `ServerRulesGuard`): never stops a join any more; one grey "[Reminth] Heads-up: <server>'s rules ban ..."
  chat line after joining (first join per run; not again when the launcher already warned). `Compat.say` per family
  (26.x `sendSystemMessage`, 1.20/1.21 the chat box). Nothing is ever turned off for the player. The `serverRules:turnOff`
  IPC still exists but nothing calls it. Smoke-tested: 1.0.9 loads on 26.2 and 1.21.11; the chat line itself not seen
  in a game (needs a real server).

### PASS/FAIL for the owner
1. 26.2: F11 to full screen, open a menu (Esc or inventory): the pixel pointer is visible. PASS/FAIL
2. 1.21 instance: G opens the panel; hold C to zoom. PASS/FAIL
3. Launcher in a normal window: normal size. Press Play: nothing flashes under "Welcome back". PASS/FAIL

---

## 00000000000000000000000. The Reminth panel on every version (8 Oct 2026, evening) - desktop window

**ReminthHUD 1.4.0 (with the panel, G) now for every version Reminth supports:** 1.20.1, 1.21-1.21.1, 1.21.4, 1.21.5,
1.21.6-1.21.8, 1.21.9-1.21.10, 1.21.11, 26.1, 26.2, 26.3 (all 1.3.1 jars gone from `assets/mods`).

**How it is built (for the next session):**
- The panel's code and icons live ONCE in `hud/panel/java` and `hud/panel/resources` (moved there from `hud/src`);
  both `hud` (26.x) and `hud-1.21` (1.20/1.21, remapping Loom) build from them.
- Everything that differs between versions goes through four per-version classes in `compat/<family>/.../panel/`:
  `Gfx` (drawing: text, fills, icons, scissor, tooltips), `BaseScreen` (screen drawing + mouse/keys -> plain
  `draw/click/drag/release/scroll/key/typed`), `V` (open screen, keys, HUD hook, F3, day time, chat line, ids, clock,
  food values, ping packet, effect rows, tooltips, Controls screen) and `Settings` (the game-setting cards).
  Families: `hud` A=26.2, B=26.3, C=26.1; `hud-1.21` E=1.20.1, A=1.21-1.21.1, **F=1.21.4-1.21.5 (new)**, B=1.21.6-1.21.8,
  C=1.21.9-1.21.10, D=1.21.11.
- `hud-1.21/tools/gen-compat.py` writes Gfx/BaseScreen/V for the 1.20/1.21 families, `hud-1.21/tools/gen-mixins.py`
  their hooks (zoom FOV, zoom scroll, low fire, ping answer, attack, chat timestamps, effect icons), and
  `hud/tools/gensettings.py` writes every family's `Settings.java` from `hud/panel/settings.txt` - a card is kept only
  where that version's own `Options` has the setting with the right type (checked with javap): 69 cards on 26.2/26.1/
  1.21.11, 68 on 26.3 (no Raw Mouse Input), 64 on 1.21.10, 63 on 1.21.8, 61 on 1.21.4/1.21.5, 57 on 1.21.1, 54 on 1.20.1.
  So the panel shows 146 features on 26.2, 145 on 26.3, 134 on 1.21.1, 131 on 1.20.1.
- On 1.20/1.21 the game is renamed at runtime: no reflection by name there (Loom rewrites the hooks' targets at build
  time - checked in the jar).
- `hud-1.21/build-all.ps1` builds all seven 1.20/1.21 jars (use it: passing `>=`/`<=` ranges through `Start-Process`
  makes cmd treat them as file redirection).

**Bugs found and fixed on the way:** on 26.3 Backspace/Enter/Esc in the panel's search and rename boxes did nothing (26.3's
key numbers are different - now the game's own constants, per build); 1.20.1/1.21.1 cut off part of the card list (their
clip box ignores the panel's scaling - applied by hand); the rename box is now drawn by the panel itself (same on every
version); the 1.21.10 outline call has another name (outlines are four lines now).

**Tested in the game (screenshots):** the panel open on 1.20.1, 1.21.1, 1.21.4, 1.21.5, 1.21.8, 1.21.10, 1.21.11, 26.1, 26.2,
26.3 (every jar); HUD displays in a
world on 1.21.1, 1.21.11, 26.2, 26.3; potion level/time on the effect icons and chat timestamps on 1.21.1 and 26.2;
G opens the panel on 26.2. **Not tested:** in a world on 1.20.1, 1.21.4-1.21.10 and 26.1 (panel only); zoom/low fire/ping/hit marker
on the 1.20/1.21 versions.

**Test tool notes:** test games are now pushed behind every window without being activated (`offwin.ps1`, harness option
`offscreen`), so they never cover the owner's game and still draw (a minimized or off-screen window gives old frames);
`-Dreminthhud.testOpenPanel=<seconds of game uptime>` opens the panel by itself (26.3's SDL window ignores posted keys).

**Not installed yet:** the owner is playing (MCPVP) through Reminth; installing closes Reminth. Installer gets built;
install it when he's done (built 8 Oct 17:13, `release-1.4.8\`).

### PASS/FAIL for the owner
1. Any 1.21.x Fabric instance (e.g. 1.21.11): press G - the panel opens; it looks like on 26.2. PASS/FAIL
2. In that instance: switch on Coordinates and FPS; they show; press F7 - hidden; F7 again - back. PASS/FAIL
3. Hold C (Zoom) in that instance - the view zooms; scroll while holding - more zoom. PASS/FAIL

---

## 0000000000000000000000. Owner tested batch 3; cursor size, combo and hearts fixes (8 Oct 2026, afternoon) - desktop window

**Owner's results (section 000000000000000000000's list):** 1 PASS (146 features), 2 PASS, 3 PASS (nothing overlaps),
4 PASS (F7), 5 PASS (timestamps), 6 PASS (durability tooltip), 7 unclear (he has music off in the game; he said move on).

**Fixed after his notes:**
- **Pixel cursor was twice the Windows size** (home screen mod **1.0.7**, all 10 jars): Windows draws its pointer in a
  32x32 box at 100% display scaling, 48 at 150%, 64 at 200%, 96 at 300%, 128 at 400% (Raymond Chen, The Old New Thing,
  19 Aug 2021), times the pointer size chosen in Windows (`HKCU\Control Panel\Cursors` `CursorBaseSize`, 32 = normal).
  Measured on the owner's PC: 1920x1080, 96 DPI, CursorBaseSize 32, `SM_CXCURSOR` 32, the Windows arrow drawn 11x19 px.
  `PixelCursor.pixelSize()` = that box / 32 (display scale from GLFW `glfwGetMonitorContentScale` or SDL
  `SDL_GetDisplayContentScale`; the base size by `reg query`); our arrow is now 12x19 there (it was 24x38). Log line
  "Reminth pixel cursor: 1.0 screen px per pixel" seen in the game on 26.2.
- **Combo Counter** only counts a critical hit or a fully charged hit (charge above 0.9 - the game's own "strong
  attack" rule); spam clicks don't count. A hit counts only when the mob gets newly hurt (its hurt time jumps back up).
- **Damage Taken / Lowest Health** count hearts the way the game draws them (health and absorption rounded up to half
  hearts, like `Gui`): no more "-0.0", nothing shown when your hearts didn't go down; quick drops add up; shown as
  "-1.5 ❤". Seen in the game (layout editor samples).

**Potion Effects now draws on the game's own effect icons** (owner: "replace the old potion system"): the level
(II, IV... - level I only with an option) top-right on the icon and the time left at its bottom (m:ss up to 99:59, then
hours; red in the last 10 s), no separate list any more. `Features.PotionEffects.drawOnIcons` +
`mixin/EffectIconMixin` (after `extractEffects`, on `Hud` in 26.2+ and `Gui` in 26.1), same places the game uses.
Tested on 26.2 with real effects (Speed III infinite, Strength II, Fire Resistance; screenshots).

**Panel on all 26.x (ReminthHUD 1.4.0+26.1, +26.2, +26.3 in `assets/mods`, the 1.3.1 26.1/26.3 jars removed):**
`hud/compat/<family>/.../panel/V.java` holds the few calls that differ (A: 26.2 and 26.3 - `mc.gui.screen()`,
`Hud.getMobEffectSprite`; C: 26.1 - `mc.screen`, `Gui.getMobEffectSprite`); `-Pcompat=C` for the 26.1 build.
26.3 has no Raw Mouse Input setting (SDL3): that card only exists where the game has it (145 features on 26.3, 146
elsewhere). **Tested in the game:** 26.3 world with HUD displays + the panel open; 26.1 panel open on the title screen
(world not tested on 26.1). My test tool can't press keys or click on 26.3 (SDL ignores posted window messages) and
couldn't click on 26.1 this time, so the panel was opened by a test-only switch: `-Dreminthhud.testOpenPanel=<ticks>`.

**Owner's crystal question (answered in chat):** his PvP instance has Marlow's and Kinds' Crystal Optimizer, Client
Side Crystals and both anchor optimizers turned off (`.jar.disabled`) - the ban warnings for MCPVP (which banned him
for "Impossible Actions" with them on 6 Oct). Those mods are what made crystals break instantly on his screen; without
them every crystal waits for the server, which is the normal speed. Nothing in Reminth's panel slows crystals.

**Next:** done - see section 00000000000000000000000 (the panel on every version).

---

## 000000000000000000000. Panel batch 3: 146 features, HUD displays never pile up (8 Oct 2026, night) - desktop window

**What changed (ReminthHUD 1.4.0+26.2, `hud/`):**
- `panel/Features3.java` (new): 35 features picked from the owner's ChatGPT list - only ones that show your own state,
  change looks, or are the game's own settings. **HUD:** Attack Cooldown bar (option: quiet click when ready), Bow Draw,
  Crossbow Loaded, Shield Up, Offhand Item, Fall Distance, Held Food, Right Tool, Lowest Health, Low Health / Hunger
  Alert (flashing, sound), Food Stock, Day / Night Timer, Sleep Cue, Nether Coordinates, Frame Time + 1% low, Damage
  Taken, Combo Counter. **Visual:** Hit Marker (cross/dot/ring; other colours for a critical hit and a kill; optional
  sound), Brightness, GUI Scale. **Utility:** Hide HUD Key (F7, ON), Break Reminder, Durability in Tooltips (ON), Food
  Values in Tooltips, ten sound volume cards (master, music, jukebox, weather, blocks, hostile, friendly, players,
  ambient, voice). **Chat:** Chat Timestamps.
- `mixin/AttackMixin.java` (notices your own attacks for the hit marker and combo - changes nothing about them) and
  `mixin/ChatTimestampMixin.java`; both in `reminthhud.mixins.json`. Tooltips through Fabric's `ItemTooltipCallback`.
- **Bug fixed - displays piled on top of each other** (seen in the game: Nether Coordinates over Lowest Health, Frame
  Time over Xaero's minimap): `Panel.drawHud` now moves a display that is still at its default place down (or up) to
  the nearest free space; Xaero's minimap corner and the hotbar/hearts/hunger area are kept free. A display the player
  moved stays where they put it. The layout editor uses the drawn place (`Module.drawX/drawY`).
- Left out on purpose: Comfort preset (the separate No View Bobbing / FOV / Distortion / Darkness / Hurt Cam cards
  already do it - two switches for one setting would fight); ping jitter/min-max (not done yet).
- 36 new icons (`hud/tools/icons3.js`, 153 in all; the Sleep Cue one is `bedcue` - `sleep` is Background FPS's).

**Tested in the game (26.2, screenshots):** world with 22 displays on - all stacked, nothing overlapping; chat message
got `[01:27]` in front; F7 hid every Reminth display; panel shows **146** features (HUD 53, Visual 23, Performance 13,
Mechanic 11, Chat 17, Utility 29); Chat category page; HUD layout editor with every new display's sample. **Not tested
for real:** hit marker/combo on a real mob, bow/crossbow/shield, the low-health alert and its sound, break reminder,
tooltips, the volume cards one by one, GUI scale.

**Next:** installer built and installed (8 Oct 01:41; the installed copy carries this HUD jar - checked byte for byte); the owner tries 26.2; then the port to 26.3 (SDL), 26.1 and 1.21.

### PASS/FAIL for the owner (26.2, 10 minutes, single player)
1. Press G: the panel says 146 features. PASS/FAIL
2. HUD tab: switch on Attack Cooldown, Combo Counter and Damage Taken; in Visual switch on Hit Marker. Hit a mob: a
   white cross at the crosshair (orange when you crit by falling onto it, red when it dies); combo counts up. PASS/FAIL
3. Switch on 10 or more HUD displays: none of them overlap each other, the minimap or the hearts. PASS/FAIL
4. Press F7: all Reminth displays go away; F7 again: back. PASS/FAIL
5. Chat category: switch on Chat Timestamps; new chat messages start with the time. PASS/FAIL
6. Hover a damaged sword in your inventory: "Durability: 1000 / 1561" under the name. PASS/FAIL
7. Utility: move Music Volume to 0; it stays 0 after a restart; switching the card off puts it back. PASS/FAIL

---

## 00000000000000000000. Pixel cursor + the night plan (8 Oct 2026, night) - desktop window

**Owner (asleep, 7-8 Oct night):** a pixel cursor in Minecraft (not the launcher) first, tested; then the features from
his ChatGPT list (`local-notes/chatgpt-features.txt`, 270 lines, git-ignored) - only the best ones that really work;
make 26.2 perfect before porting the panel to the other versions. Defaults: a few useful features on; anything some
servers ban is OFF with a warning. Then (owner) UI changes and publish **2.0.0** (agreed).

**Done: pixel cursor (home screen mod 1.0.6, all 10 jars):** `PixelCursor` - pixel arrow, pointing hand and text beam
(black outline, white, grey shade; 2-4 screen px per pixel by screen height). 26.x and 1.21.10+ switch cursors
themselves: `CursorTypeMixin` (compat A, B, C, T, U) gives the game's switch our pixel ones; 1.20-1.21.8 have no switch
(empty stand-in mixin in P-S), CursorFix sets the arrow at start and after every window-mode change. **Minecraft 26.3 runs
on SDL3, not GLFW**: there the cursor is made with SDL (`SDL_CreateSurfaceFrom` + `SDL_CreateColorCursor`), the switch is
`select()` without a window, and the vanishing-pointer fix uses `SDL_ShowCursor` (the old GLFW calls did nothing on 26.3).
`config/reminthhome.json` `"pixelCursor": false` turns it off. **Tested in the game** (screenshots with the real pointer):
26.2 hand over a button, arrow on 1.21.11, 1.20.1, 26.3 (SDL), and after F11 to fullscreen on 26.2.

**Next (in this order):** batch 3 of panel features from the ChatGPT list (attack cooldown, bow draw, crossbow loaded,
shield up, offhand, fall distance, held food, right tool, lowest health, low health/hunger alert, food stock, day/night
timer, sleep cue, nether coordinates, frame time / 1% low, damage taken, combo counter, hit + crit + kill marker with
sound, hide-HUD key, break reminder, durability and food tooltips, chat timestamps, sound volume cards, brightness, GUI
scale, comfort preset; ping jitter/min-max as Ping options) on 26.2, tested; installer; then the port to 26.3/26.1/1.21
only after the owner says 26.2 is right.

---

## 0000000000000000000. Panel batch 2: 111 features, real ping, G tips (7 Oct 2026, late night) - desktop window

**Owner's asks:** title "REMINTH MODS PANEL" without the R icon; ping always 0 - fix; tell players about G (title screen
and loading screens); 50+ features per tab ("hundreds" for the big ones).

**What changed (ReminthHUD 1.4.0+26.2)**
- Header "REMINTH MODS PANEL"; categories now All, HUD, Visual, **Performance** (new), Mechanic, Chat, Utility.
- **Ping:** `PingMeter` sends the game's own ping request every 2 s (the one F3's network chart sends) and times the
  answer (`mixin/PongMixin`); the player list's number (0 on many proxied servers) only as a fallback.
- **Tips** (`Tips.java`, Fabric screen events): title screen top line "Fun fact: press G in game to open the Reminth
  Mods Panel - N features"; a rotating "Fun fact" at the bottom of the connecting / world-loading / saving screens. The
  key shown is the player's real binding. Seen in the game (title and "Connecting to the server...").
- **85 new features (111 total):** `Features2` - 26 HUD displays (biome, day, world time, health, food/saturation, armor
  points, memory, server address, session time, speed, light, chunk, facing, block info, moon, weather, date, players
  online, XP, death point, elytra, inventory full, low durability warning, item counter, packs, compass strip),
  Snaplook (hold V), and 58 of the game's own settings as cards (`OptionFeature`: on = the value set in the card,
  off = the value from before, remembered in the profile; written to options.txt at once). Left out on purpose:
  the game's "toggle attack/use" (keeps attacking for you). Counts: HUD 36, Visual 20, Chat 16, Utility 15,
  Performance 13, Mechanic 12 - short of the owner's 50+ per tab; more batches to come (real features only).
- 89 new icons (`hud/tools/icons2.js`).
- Test harness: the "owner is playing" check now only blocks while a Minecraft window is in a world or on a server
  (the owner keeps Lunar open at its menu).

**Tested in the game (26.2):** title tip; panel header and Performance tab; FPS Limit card switched on -> options.txt
maxFps changed (restore value kept); loading-screen fun fact. **Not tested:** ping on a real server (needs the owner's
account), most of the 85 new cards one by one (they share OptionFeature / TextHud, which were tested).

---

## 000000000000000000. The Reminth panel, step 2 (7 Oct 2026, night) - desktop window

**State:** `npm test` **664 pass**; ReminthHUD 1.4.0+26.2 and home screen 1.0.5 (all 10) in `assets/mods`. Installer
rebuilt and installed after this (see the chat). Not published.

**Owner's decisions (7 Oct):** the 101-feature list is OK; Discover becomes the panel; the panel is not a separate,
visible mod but part of Reminth's HUD system that can't be turned off; default key G (changeable in Controls, e.g. F6);
Minecraft-grey / white look; icons that show what each feature does; category tabs on the left; a search box.

**What changed**
- `hud/` (ReminthHUD 1.4.0, 26.2 only so far): `client/panel/` - `Panel` (keys G and C, profiles in
  `config/reminthhud-panel.json`, HUD drawing), `PanelScreen` (window, MODS/SETTINGS, search, categories, profiles,
  cards with OPTIONS + gear and ENABLED/DISABLED, laid out on a virtual 640x370 screen and scaled so it looks the same at
  any GUI scale), `ModuleScreen` (switches, sliders, colour swatches, choices), `HudEditorScreen` (drag, scroll to
  resize, right-click to reset, centre snapping, sample values), `Features` (the 15), `TextHud`, `Opt`, `Draw`.
  Mixins: `CameraFovMixin` (zoom), `MouseScrollMixin` (scroll to zoom), `FireOverlayMixin` (low fire). Icons: our own
  vectors in `hud/tools/icons.js`, rendered by `hud/tools/render-icons.js` (29 icons, 128 px).
- ReminthHUD is now `forced` (config.BUNDLED_MODS): in every Fabric/Quilt instance, Mod Menu shows it as a library. The
  instance's HUD switch only shows/hides the top-right FPS/GPU/CPU bar: `minecraft.writeHudBar` writes `"bar"` into
  `config/reminthhud.json` at every launch (older HUD builds get their four items switched off and back).
- Home screen 1.0.5: Discover opens the panel (found by name; falls back to Reminth's Discover page). Also fixed: the
  26.3 home jar had silently not been rebuilt since 1.0.4 (26.3 has no public `Window.isFullscreen`; now per version).

**Tested in the game (26.2, fake profile, never while the owner played):** G opens the panel; three cards a row at GUI
scale 3; ENABLED/DISABLED saves; FPS options (switches, slider, swatches); Edit HUD layout with sample potion effects
(level + time, icons), armor and held-item durability; Zoom (hold C) zooms; Hurt Cam set Damage Tilt to 25%; title
screen Discover opens the panel. Screenshots: `local-notes/panel-screens/` (not in git).
**Not tested yet:** Low Fire (needs being on fire), typing in the search box, rename/delete profile, Toggle Sprint/Sneak
in play, the panel on 26.1/26.3 and 1.21 (not built there yet - step 3).

**Test plan (owner)**
1. Play a Fabric 26.2 instance, press G: the panel opens; switch Keystrokes on - it shows top-right. PASS/FAIL.
2. OPTIONS on FPS: change the colour; EDIT HUD LAYOUT: drag FPS somewhere, scroll on it to resize, DONE. PASS/FAIL.
3. Hold C: zoom; scroll while holding: more zoom. PASS/FAIL.
4. Title screen Discover: the panel opens. PASS/FAIL.
5. Type in Search ("arm"): only Armor Status left. PASS/FAIL.

---

## 00000000000000000. No cheat-like mods, window scaling, panel feature list (7 Oct 2026, evening) - desktop window

**State:** `main` at `0fbb818` (+ this file); `npm test` **663 pass**. Installer being rebuilt into `release-1.4.8\`.

**Found in the owner's logs (read-only):** DonutSMP kicked him at 15:12 on 7 Oct ("cheat mod ... Inventory Profile! ...
join with this again you will be banned") - before the ban warning was installed. MCPVP (mcpvp.com) banned him at 20:26
on 6 Oct for "Impossible Actions"; that instance had Marlow's + Kind's crystal optimizers, Anchor Optimizer + Kind's anchor
optimizer and Client Side Crystals on.

**What changed**
- Lists (`purposes.js`): nothing that can be seen as a cheat, ticked or not - crystal/anchor optimizers, Client Side
  Crystals, Mouse Tweaks, Inventory Profiles Next and Jade are gone (players can still add them from Discover). Owner:
  "no hacks ... only optimization mods".
- Ban warnings (`serverRules.js`): MCPVP added (crystal and anchor optimizers); a pretend server
  `bantest.reminth.invalid` (can never exist) for testing; checked in the game: warning, Back, Join anyway -> "Unknown host".
- Window: the maximize button is always one square; a smaller window shows the same layout scaled down (page zoom =
  window size / screen work area, 0.5-1; `windowRestore.uiZoom`). Checked in the app at maximized and 1320x839.
- Panel: `docs/PANEL_FEATURES.md` - 101 researched features (HUD / Visual / Mechanic / Chat / Utility) with difficulty and
  server-rule risk, a "left out on purpose" list and the first 15 for 26.2. **Waiting for the owner's OK before building.**

**Decisions for the owner**
1. The panel feature list (`docs/PANEL_FEATURES.md`) - OK, or what to change. Recommendation: OK as is; the first batch is
   the 15 listed at the end.
2. The title screen "Discover" button will open the new panel (as asked) - Reminth's Discover page then stays reachable
   from the launcher only. Recommendation: yes.

**Test plan (owner)**
1. Install the new `release-1.4.8\Reminth-Setup.exe` (close Reminth first). PASS/FAIL.
2. Restore Reminth to a smaller window: same layout, just smaller; the window button is one square. PASS/FAIL.
3. New instance -> Fabric -> Crystal PvP: no crystal/anchor optimizers, no Client Side Crystals; Survival: no Mouse
   Tweaks, Inventory Profiles Next or Jade. PASS/FAIL.

---

## 0000000000000000. Ban safety, title screen fixes, home screen 1.0.4 (7 Oct 2026, afternoon) - desktop window

**State:** `main` at `2f3fada` (+ this file); `npm test` **661 pass**. Installer rebuilt in `release-1.4.8\`, not installed
(Reminth was open on the owner's PC), not published.

**Why:** the owner nearly got banned on DonutSMP for Inventory Profiles Next (a ticked playstyle mod).

**Research (7 Oct, sources in `src/main/serverRules.js`; official pages are behind Cloudflare, so search results quoting
them and staff answers were used):**
- DonutSMP (wiki copy of its terms, checked Sept 2026): bans inventory modifications, health indicators, radar/ESP/freecam,
  movement mods, auto-place, macros, **mouse tweaks and scrollers**.
- Hypixel: bans every minimap, Mouse Tweaks, inventory tweaks, player health indicators, automation.
- MCC Island: bans minimaps, other players' statuses, freelook, No Chat Reports, inventory walk.
- The two big DonutSMP modpacks on Modrinth (40k+ downloads) use Shulker Box Tooltip, AppleSkin, Zoomify, TotemCounter,
  crystal optimizers, armor HUD - and no Mouse Tweaks, Inventory Profiles Next, Jade or minimap.

**What changed**
- Lists (`purposes.js`): Mouse Tweaks, Inventory Profiles Next and Jade are never ticked (in "More", with "banned on ...
  you can get banned"). Xaero's Minimap stays ticked (owner's wish) but comes with its **radar and cave view off**
  (`config/xaero/minimap/profiles/default.cfg`; checked in the game: kept, rest filled in; same file on every version).
- `src/main/serverRules.js` (new): servers (DonutSMP, Hypixel, MCC Island: hosts, banned categories, source) and which mod
  ids fall in each category; Xaero's minimap counts as radar unless its radar is off.
- **Before Play** (`serverRulesBeforePlay` in `features.js`, `renderer.js` runPlay, IPC `serverRules:check/turnOff`): if the
  instance joins, lists (servers.dat) or has played on (game logs) such a server and a banned mod is on: "These mods can
  get you banned" with each mod, the reason and the source. **Turn them off and play** (switched off, never deleted, reason
  kept), **Play anyway** (remembered until the list changes), Cancel. Seen working in the app.
- **In the game** (home screen mod 1.0.4, `ServerRulesGuard` + `ConnectGuardMixin` per version family): every way of
  joining goes through `ConnectScreen.startConnecting`; for such a server it asks first ("Join anyway" / "Back"). Reminth
  writes the list at each launch (`config/reminth-server-rules.json`); "Play anyway" in Reminth is passed on so the game
  doesn't ask twice. Seen working on 26.2, 1.21.11 and 1.20.1 (both buttons on 26.2).
- Title screen (home 1.0.4): the icon row no longer sits on the copyright line (also when Mod Menu moves the line, 1.20-1.21);
  Realms' news/invite icons no longer drawn on Connect Discord (they appear with a real account at the old Realms
  button's corner); the Realms icon and the F11 pointer fix now also work on 1.20-1.21 (they were looked up by name,
  which only works on 26.x - the pointer fix logged "switched off" there).

**Not tested:** the Realms icons with a real account (the test account has no Realms); clicking the Realms icon (a test
window was made full screen while the owner used the PC, so game tests were stopped); the Play button end-to-end with
the rules file (the fake account is signed out at start-up; the same function was run on the instance folders instead).

**Test plan (owner)**
1. Close Reminth, run `release-1.4.8\Reminth-Setup.exe`. PASS/FAIL.
2. **Never test on DonutSMP itself** (a second join with those mods can mean a ban). Use the pretend server instead
   (added 7 Oct: `bantest.reminth.invalid`, an address that can never exist, so nothing can ever connect): in the game,
   Multiplayer -> Add Server -> address `bantest.reminth.invalid` -> Join, with Mouse Tweaks / Inventory Profiles Next /
   Jade switched on: the game asks first ("These mods can get you banned on Reminth ban-warning test"). Back returns;
   Join anyway only gives "unknown host". PASS/FAIL.
3. Close the game, press Play in Reminth: the "These mods can get you banned" window lists the test server (and DonutSMP,
   since it is in the list) with the mods. "Turn them off and play" -> they show as off in Content, with the reason. PASS/FAIL.
4. Title screen: nothing on Connect Discord; the icon row and the copyright line don't touch. PASS/FAIL.
5. Fullscreen (F11) and back: the mouse pointer stays visible in menus. PASS/FAIL.

---

## 000000000000000. Playstyle lists: tested in the real game, and fixed (7 Oct 2026) - desktop window

**State:** `main` at `171a6f3` (+ this file); `npm test` **655 pass** (Windows). Installer rebuilt in `release-1.4.8\` and
installed on the owner's PC (7 Oct, 15:05). **Not published** - the owner publishes after testing.

**What the owner asked (6 Oct night):** icons next to each mod/pack like Discover; everything important ticked (no
explosion particles, crystal and anchor optimizers, Client Side Crystals, low fire, small shield/totem/tools, Xaero's maps
in Survival); one mod per job; no cheats (macros, auto-totem); then test it myself until it works.

**What changed**
- Lists (`src/main/purposes.js`): Client Side Crystals, Marlow's Crystal Optimizer, Anchor Optimizer, Xaero's Minimap +
  World Map ticked; second mods for the same job removed (Kind's optimizers, Totem Tweaks, Mini Totem, Small Totem Pop
  Animation, short-sword packs, Low Shield pack, Crystal Vanilla Tweaks, Cull Leaves, ClientSort, Mouse Wheelie, **CPS+** -
  Clean Keystrokes already counts clicks per second, and CPS+ sat on top of the minimap); Controlling added. 52 items, all
  with 26.2 builds (`tools/overnight/check-purposes.js`).
- Icons left of every name in the list (`features.js`, `.extra-icon`); seen in the app: 20 of 20 loaded.
- Picking several cards: anything recommended in any picked card is never shown unticked under another card's "More".
- Inventory Profiles Next gets ready-made settings: its auto-refill icon no longer sits on every hotbar slot (seen in the
  game before/after). Ready-made settings can now be in a sub-folder of `config/`.
- **Mod builds** (`content.js` `pickVersion`, `modsSync.js`, version dialog): when an author uploads one build per Minecraft
  version in one go, the one named for the exact version is taken (CPS+ "+mc1.21" is tagged up to 1.21.11 but only runs on
  1.21 - that broke 1.21.11 and 1.21.1).
- **Compatibility check** (`compat.js`), each found by a real game failing or a false alarm:
  - A multi-version bundle loads the copy for this version (proved: Client Side Crystals' 26.3 bundle started on 26.2);
    packed copies nothing needs are skipped (BetterHurtCam on 1.20.1). No more false "won't load".
  - A too-old Fabric API for a mod is now "won't start" (it was only a warning, because Fabric API's own packed modules
    looked like maybe another copy).
  - A library a jar requires that is missing altogether is "won't start" with an Install button (Status Effect Bars
    needs Cloth Config; its Modrinth page doesn't say so).
- **After a playstyle install** (`main.js` `turnOffWhatWontLoad`): missing libraries are added by themselves; anything
  from that install that would still stop the game (and mods that need it) is switched off - never deleted - with the
  reason; the message says what was added or switched off.

**Tested for real (fake profile, the game started by Reminth's launch code, never while the owner played):**
- All four cards together: 26.2 (137 mods), 1.21.11 (136), 1.21.1 (134), 1.20.1 (133) - all reach the title screen with
  the packs on; 26.2 and 1.21.1 also **joined a survival world**: clean HUD (minimap left, keystrokes right, hearts, hunger).
- Each card alone on 1.21.11, 26.2, 1.21.1 and 1.20.1 (16 runs): all reach the title screen.
- 1.21.2 (an odd version where many mods are mis-tagged): the install switches off what can't run there (YACL, Zoomify,
  Clean Keystrokes, CPS+), says so, and the game starts.
- Not tested: the owner's own account and servers; Quilt; 26.3 snapshots.

**Known weak spots**
- 1.21.2 / 1.21.3 instances lose a few mods (Modrinth tags are wrong there); it says which.
- Enchantment Descriptions shows a "needs Bookshelf" warning on 1.21.11 although it starts fine (Modrinth's list).

**Test plan (owner)**
1. New instance -> Fabric 26.2 (or 1.21.11) -> Continue -> pick Crystal PvP + Survival -> Finish: icons next to every
   name; Client Side Crystals, both optimizers, Xaero's maps, Small Shield & Totem, Small Tools, No Explosion Particles,
   Low Fire ticked. PASS/FAIL.
2. Add selected -> message says how many were added (and anything added/turned off) -> Play -> the game starts, packs on.
   PASS/FAIL.
3. In a world: minimap top-left, keystrokes top-right, nothing on top of each other, no arrows on the hotbar slots. PASS/FAIL.
4. Join a crystal server you play on: crystals and anchors feel instant. PASS/FAIL.

---

## 000000000000000. New app icon and brand colour (8 Oct 2026) - cloud window

**State:** this commit on branch `claude/stoic-lovelace-y9p76z` (on top of `main` `93925bd`); `npm test` **667 pass** (Linux).
Not built, not in any installer. **Desktop window: `git fetch origin claude/stoic-lovelace-y9p76z`, merge into `main`, build, and do the
tests below.** Version number untouched.

**Delivered files:** only `reminth.ico`, `reminth.icns` and the master SVG arrived (no `assets/icons/` folder, no `linux/hicolor`,
no transparent mark, no 1024 master file; the 1024 PNG is the picture the owner pasted, saved losslessly). Used exactly as given, nothing resampled.

**What changed**
- `assets/icons/` (new): `reminth.ico`, `reminth.icns`, `source/reminth-icon-master.svg`, `source/reminth-icon-master-1024.png`, README.
  Old `assets/icon.ico` and `assets/icon.png` removed (nothing references them any more).
- Windows window/taskbar icon: `main.js` uses `reminth.ico` (was a PNG). `app.setAppUserModelId("com.reminth.launcher")` added (same id
  electron-builder puts on the installed shortcuts) so a dev run groups and shows our icon too.
- Installer: `package.json` `build.win.icon` -> the new .ico; `build.nsis.installerIcon`, `uninstallerIcon`, `installerHeaderIcon` set. The
  one-click installer has no sidebar picture, so there is nothing to add there. `.icns` and the 1024 PNG are excluded from the package.
- In-app logo (loading screen, left rail, sign-in card, ReminthHUD card in the mod list): the SVG (sharp at any size).
- Website: `site/favicon.png` (128), `logo.png` (64), new `apple-touch-icon.png` (180) and `favicon.svg`, all rendered from the SVG; the three
  data-URI pictures in `site/index.html` replaced; `privacy.html` / `terms.html` link them. **The site needs re-uploading to Cloudflare.**
- Brand colour (`styles.css`): `--brand-*` palette from the SVG at the top of `:root`; default accent is now the crack orange `#ff4a1c`
  (new "Ember" swatch first in Settings; Cyan stays a choice via `[data-accent="cyan"]`). Hero/selection glows that were hard-coded cyan follow the
  accent; the background glows use the brand colours. **Errors are a cool pink-red** (`--rose` #fb7185 -> #ff5c8a, and the orange "error" log chip is
  now rose), clearly apart from the orange. Loader/release tags keep their own colours.
- `store.js`: default accent "ember"; new setting `accentChosen`. Settings saved before this (accent "cyan" = the old default) show Ember once; a pick
  made in Settings afterwards (even cyan) sticks. Test in `test/fixes-content.test.js`.

**Seen in headless Chromium only** (loading screen + main window with the real CSS): logo and orange accent render. **Not seen** in Electron or Windows.

**Test (desktop window):**
1. `npm run dist`, install: the .exe in Explorer, the Desktop and Start Menu shortcuts, the taskbar button and the window all show the new cube. PASS/FAIL.
   (Windows may keep the old picture: delete `%LOCALAPPDATA%\IconCache.db`, restart Explorer; or unpin and pin again.)
2. `npm start` (dev run): the taskbar shows the Reminth cube, not Electron's atom. PASS/FAIL.
3. The installer window and the uninstaller entry (Settings > Apps) show the new icon. PASS/FAIL.
4. Start Reminth: loading screen, left rail and sign-in card show the new logo; buttons/tabs/progress bars are orange; Settings > accent: Ember is
   selected, picking Cyan then restarting keeps Cyan. PASS/FAIL.
5. Make an error happen (a failed install, delete menu item): it is pink-red, never orange. PASS/FAIL.
6. Owner: is the orange everywhere too strong? Tell me which screens to tone down (it is one variable, `--accent`).

---

## 00000000000000. Playstyle card pictures (6 Oct 2026, night) - cloud window

**State:** this commit (on branch `claude/stoic-lovelace-y9p76z`, on top of `main` `1bf6e81`); `npm test` **650 pass** (Linux).
Not in any installer yet. **Desktop window: `git fetch origin claude/stoic-lovelace-y9p76z` and merge it into `main` first.**

**What changed**
- `assets/playstyles/{crystal,sword,survival,performance}.jpg`: the owner's four pictures, resized to **1280 x 600** (32:15),
  100-125 KB each. The old pictures (none were committed) are replaced. README updated.
- Cards re-shaped to the pictures (`features.js` `choosePlaystyle`, `styles.css` `.style-*`, `.playstyle-modal`): 2 x 2 grid,
  each picture box has the picture's exact 32:15 shape (no crop, no stretch), the description sits under the picture.
  The pictures already have the name drawn in them, so the card's written title only shows when a picture is missing
  (gradient fallback). The dialog is as wide as the cards need and the cards shrink on short windows, so both rows fit
  with no scrolling and no empty bands at the sides.
- Shorter card descriptions (`purposes.js` list + renderer fallback) so they fit on one line.
- `styles.css`: the `background-origin: border-box` rule had ended up in the middle of the file (later batches appended
  after it); moved back to the very end, as the codebase rule says.

**Checked:** headless Chromium with the real `styles.css` at 1920x1080, 1366x768 and 1100x700: boxes 557x261 / 343x161 /
270x127 (ratio 2.133 = the pictures'), no scrollbar, pictures sharp. **Not checked:** the real Electron app.

**Test (desktop window / owner):**
1. New instance -> Fabric 26.2 -> Continue: four cards in a 2 x 2 grid, each picture fills its box exactly, no text over
   the picture except the one drawn in it, descriptions under. PASS/FAIL.
2. Click two cards: both glow with a tick; Finish works. PASS/FAIL.
3. Make the Reminth window small (Restore Down, drag to the smallest size): the cards shrink, nothing scrolls or is cut. PASS/FAIL.

---

## 0000000000000. Playstyle picture cards and better lists (6 Oct 2026, late) - desktop window

**State:** code commits `031aeb5` (stacked dialogs fix) and `d129267`; `npm test` **650 pass**. Installer rebuilt in
`release-1.4.8\`. Not published.

**What changed**
- Fix (`styles.css`): a dialog opened from another one appeared in a row under it, half off screen; now on top, the one
  below dimmed (`.modal-root > .modal { grid-area: 1 / 1; position: relative }`).
- Playstyle step (`features.js` `choosePlaystyle`, `renderer.js` create flow, `styles.css` `.style-*`,
  `.playstyle-modal`): "Personalize your experience so we can match your vibe"; three big picture cards **PvP, Survival,
  Performance**; several can be picked; a picked card gets a glowing light-blue outline and a tick; nothing happens until
  **Finish** (disabled until one is picked) or **Skip** (plain instance). The New instance window is hidden while the
  cards show and comes back if the cards are closed with the X (nothing created). The box is 980 px wide and at least as
  tall as the New instance window. Pictures: `assets/playstyles/{pvp,survival,performance}.jpg` (README there; the owner
  makes them with Claude Design); without them each card shows a coloured gradient.
- Mod list (`openPurposeSetup(id, goals[])`): one tab per picked playstyle, Performance only when picked; the menu item
  asks with the same cards.
- Lists (`purposes.js`, re-researched on Modrinth, all 64 items have 26.2 builds): Performance is now its own card (+ Cull
  Leaves, Krypton, Debugify); PvP + Status Effect Bars, Small Shield & Totem and Small Tools packs (recommended), Kind's
  Crystal Optimizer, CritTweaks, Mini Totem, Small Totem Pop Animation (more); Survival + Status Effect Bars, Enchantment
  Descriptions (recommended), JEI, Inventory Profiles Next, Mouse Wheelie, Continuity, AmbientSounds, Not Enough
  Animations (more). Nothing removed.
- Answered: mods are always the newest build for the instance's exact Minecraft version (stable first).

**Test plan (owner)**
1. New instance -> Fabric -> Continue: only the card box shows; pick two cards -> both glow; Finish -> the mod list with a
   tab per card. 2. X on the card box -> the New instance window comes back, nothing made. 3. Skip -> plain instance.
4. Right-click an instance -> Set up for a playstyle... -> same cards.

---

## 000000000000. Loading-screen warm-up, PvP/Survival create flow, modpack Cancel and "add to existing" (6 Oct 2026, evening) - desktop window

**State:** `main` at this commit (code commits `9e2f32d`, `b7e59e5`, `0b96998`, after merging
`origin/claude/stoic-lovelace-y9p76z` = `c76d22f`). `npm test`: **649 pass, 0 fail**. Installer rebuilt in `release-1.4.8\`
(20:31). Version still 1.4.8, **not published**.

**What changed**
1. Merge `c76d22f` (from a cloud branch): playstyle lists are **PvP** (crystal + sword/axe merged) and **Survival**; Creative
   dropped (`src/main/purposes.js`, `test/purposes.test.js`). Survival's title is now "Survival".
2. Loading screen warm-up (`src/renderer/features.js` `prewarmPages` / `stopPrewarm`, `src/renderer/renderer.js`
   `loadingScreen`): while the splash is up (signed in only), Skins, Settings, Library, Stats, Streamer and Discover are each
   shown once for real (2-4 frames; Discover waits up to 1.5 s for its first list), then the page that was showing comes
   back before the splash fades. Stops at once when the splash ends or a reminth:// link switches the page.
   Measured on a test profile (signed in with a fake account), first open of each page, worst frame in the 600 ms after the
   click (3 runs each):
   | Page | Before | After (real boot path) |
   |---|---|---|
   | Skins | 143-157 ms | 26-40 ms (repeat opens: 21-24 ms) |
   | Discover | 91-105 ms | 24-51 ms |
   | Settings | 38-52 ms | 13-27 ms |
   | Library | 7-38 ms | 6-12 ms |
   | Stats / Streamer | 4-5 ms | 4-10 ms |
   Not measured: the owner's real account and skin library (heavier than the test profile).
3. Create flow (`renderer.js` `openInstanceModal`, `features.js` `choosePlaystyle` / `openPurposeSetup`): for Fabric/Quilt the
   button says **Continue** (Create instance for other loaders, updates when the loader changes). Continue asks PvP / Survival
   / None ("A choice only adds some helpful mods and resource packs, which you can untick on the next screen. None adds
   nothing."). Cancel creates nothing and the New instance dialog stays. A choice creates the instance and opens that
   playstyle's mod list (tabs: the playstyle + Performance); None creates it plain. The old goal grid is gone. The instance
   menu's "Set up for a playstyle..." asks PvP or Survival. Seen working in the real app (test profile).
4. Modpacks (`src/main/mrpack.js`, `src/main/content.js` `downloadWithHash({ signal })`, `src/main/main.js`
   `modpack:install` (token, `intoInstanceId`) / `modpack:cancel` / `modpack:target`, `preload.js`, `features.js`
   `installModpackFlow`, test `test/modpack-into.test.js`):
   - **Cancel works during the install**: stops the download, removes the half-made instance and its folder (new instance),
     or every file this run added (existing instance). Seen working in the real app with Fabulously Optimized, cancelled both
     while the .mrpack downloaded and while its files downloaded.
   - **Add to an existing instance**: the install dialog lists New instance + every instance; only the ones with the pack's
     Minecraft version and loader (and not running) can be picked, the rest are greyed with the reason. Nothing of the
     player's is overwritten: a file already there (or its .disabled twin), or a mod with the same mod id, keeps the player's
     copy and the pack's copy goes to `<instance>\.reminth\modpack-clashes\<pack>-<time>\`. Added files are recorded in
     content.json with `playerOwned: true` and never in managed-mods.json, so Reminth never removes them. Blocked while the
     instance runs or its mods are being changed (`syncing`, which also blocks Play during the install). Seen working:
     Fabulously Optimized into a 26.2 test instance, 88 files added, 13 clashes kept as the player's; the game then reached the
     title screen with 173 mods.

**Mistake to own:** the last real-game test (20:28) started a Minecraft window while the owner's own game was running
(multiplayer since 20:25). The pack's crash helper then opened a "crashed" window (caused by the test closing the game);
it was closed. Rule for next time: check `Get-Process javaw` window titles before every launch, not only at the start.

**Decisions (recommendation first)**
- Privacy page: say that adding a modpack to an existing instance keeps the pack's clashing files in
  `.reminth\modpack-clashes` (recommend yes, one sentence, with the next website upload).
- Merging a pack into an instance that already has other mods can still make the game fail if the pack's mods need newer
  versions of the player's kept mods. Recommend: leave as is (the player's files win, as asked) and rely on the existing
  "Update mods to fit" / crash notice.

**Weak spots / not tested**
- Warm-up numbers are from a test profile; the owner must feel Skins himself.
- Not tested: a modpack added while signed in on his real data; a pack whose overrides include worlds (saves); Quilt packs.

**Test plan for the owner (PASS/FAIL), with the installer in `release-1.4.8\`**
1. Install, start Reminth: loading screen 2-3 s, then click Skins, Discover, Settings: each opens with no hitch.
2. New instance, Fabric: button says Continue (Forge: Create instance). Continue -> PvP / Survival / None. Cancel -> nothing
   made. PvP -> instance made and the PvP mod list opens. None -> plain instance.
3. Instance menu -> Set up for a playstyle... -> PvP / Survival.
4. Discover -> a modpack -> Install: New instance or one of your instances (wrong version/loader greyed with the reason).
   Press Install, then Cancel while it downloads: nothing is left.
5. Add a modpack to a test instance with the same version: your files stay; the toast says how many were kept.

---

## 00000000000. "What is this instance for?" (6 Oct 2026) - desktop window

New: `src/main/purposes.js` (data + helpers), `purpose:*` IPC, `openPurposeSetup` in features.js, "Set up for a playstyle..." in the instance menu, `tools/overnight/check-purposes.js` (re-checks every slug on Modrinth). After a new Fabric/Quilt instance is created: pick Survival & SMP / Crystal PvP / Sword & Axe PvP / Creative; two tabs (the playstyle, Performance), important ones ticked, a "More" list unticked; Add selected installs them (with dependencies), writes ready-made config files (never over an existing file) and switches the resource packs on at the next Play (options.txt; packs that declare an old pack format are also accepted as incompatible, otherwise the game drops them). 50 slugs, all with a build for 26.2 and 26.1 on 6 Oct 2026. Left out on purpose: anything servers call cheating (fullbright, freecam, auto-totem, macros, hitbox helpers). Crystal optimizers and minimaps carry a "check the server rules" warning.
Tested for real: Crystal PvP list installed 24 items into a throwaway instance on 26.2 (29 jars with dependencies), the game started with all of them plus the home screen, the 3 resource packs load. Not tested: the other three playstyles in a real game, other Minecraft versions (items without a build show "No build for ..."), installing while signed in.
Test plan: (1) make a new Fabric instance: the playstyle dialog opens; (2) pick Crystal PvP, press Add selected, press Play: mods load, no crash, Options > Resource Packs shows the three packs on; (3) same for Sword & Axe PvP and Survival; (4) instance menu > Set up for a playstyle... works on an old instance; (5) tell me any mod you would not want there.

---

## 0000000000. Sign-in and pointer batch (5 Oct 2026, night) - desktop window

Changed: Sign in (`renderer.js doSignIn`, `main.js auth:signIn`): the Microsoft page now opens by itself when the code appears, the code panel has "Open the Microsoft page" and "Copy code" buttons, and the Sign in button stays pressable ("Get a new code") - before, a second press shared the first, still-waiting sign-in and the button was disabled for up to 15 minutes. "Download game files without signing in" removed. New in mod 1.0.3: `CursorFix.java` resets the game's mouse pointer to the normal arrow after F11/window-mode changes and now and then while a menu is open (all by name/reflection, one copy for every version). Seen in a real 26.2 game: it runs and logs once, no errors; the real invisible pointer bug was NOT reproduced here, so it is untested. 26.3 and old versions compile but were not run for this.
Test plan: (1) Sign in with Microsoft: browser opens with the code page, code copies, a second press gives a new code and the old one stops; (2) have the friend try sign-in; (3) in game press F11 a few times and open menus: the pointer must stay visible; if it ever vanishes, tell me what you did just before.

---

## 000000000. Second feedback batch (5 Oct 2026, night) - desktop window

Changed: loading screen redesigned (glow, wordmark, bar that moves every frame, 1.8-3 s); the rail broadcast button only OPENS the streamer page (the switch on the page toggles); Test it / Turn this on go to the streamer page; Discover shows Installed only when the item is in EVERY instance (`installedProjectIds`, uses `presence`); the home screen is forced (`forced: true` in `config.BUNDLED_MODS`, the create/edit switch is hidden, the jar is hidden from the mod list); title-screen mod 1.0.3: the head on the buttons was the ukulib mod's button (found by removing mods one by one; it also shows on the plain game), now moved off screen by reflection; icons redrawn at 64 px with smooth scaling (`blur` mcmeta). Tests: 633 pass. Not tested for real: Discover Installed rule with several instances, the loading screen with a signed-in account, the icons on versions other than 26.2.
Test plan: (1) start Reminth: new loading screen, bar moves smoothly, Skins opens fast; (2) press the broadcast icon in the left bar: only opens the page; (3) Discover: a mod in one of two instances says Install, in both says Installed; (4) the instance's mod list has no "Reminth home screen"; (5) in game: no head on the title screen, icons smooth; (6) 26.3 and 1.21.1 title screen once.

---

## 00000000. Owner feedback batch (5 Oct 2026, night) - desktop window

**Changed (all uncommitted before this commit, tested with `npm test`: 633 pass):**
- Settings: "Keep this on." in red right under Hardware acceleration (`index.html`, `styles.css`). Streamer settings page: Hotkeys card first, Streamer mode card second.
- Library's blue "streamer mode" link now opens a popup (Not now / Test it (30 seconds) / Turn this on) instead of leaving the page; Test turns it on and shows a small box near the bottom middle with "Revert changes" and a cross (`features.js`: `openStreamerOffer`, `startStreamerTest`). Checked in the real app (isolated profile): popup, test box, revert, cross, mode stays on after the box closes.
- Loading screen (`#bootSplash`, `renderer.js loadingScreen`): 1.2 to 3 seconds, builds the skin viewer and both skin grids before it goes away (before: 4 s after start, in the background). Checked: gone after about 3 s.
- Title screen mod **1.0.2**: the two saved-server shortcuts are gone; third row = **Discover** (opens Reminth Discover through `reminth://discover`, new allowed link) and **Connect Discord** (shows "Coming soon" when clicked; no Discord feature exists yet). Seen in a real 26.2 game. Privacy page text updated (the mod no longer reads the server list). Not re-run: the 8-case Back test on 26.2/26.3 and all other versions (only the 26.2 picture), see test list.
- Stats: ReminthHUD **1.3.1** asks the server 5 s after joining and then every 30 s (was 10 s / 90 s) and keeps the larger value of every counter, so a lobby or another world can no longer make saved numbers go down. Home "Blocks placed" now uses an estimate (`gameData.estimatePlacedBlocks`: item uses minus tools, food, throwables, buckets...; minecraft has no real placed counter). DonutSMP's own mined/placed numbers are plugin data and are not in the vanilla stats; kills and deaths are, which is why only those showed.
- The word "Modrinth" removed from visible app text and error messages (now "the catalog", "View original page"). Left on purpose: the privacy page, terms page and the Settings privacy summary (they must name the services the launcher talks to), and code/API names.
- All 20 bundled jars rebuilt (home 1.0.2, HUD 1.3.1). `release-1.4.8\` holds the new installer.

**Not done / honest limits:**
- Ping: network ping to a server is not something the launcher controls; the launcher already starts the game with low-pause GC settings. 400 ms spikes once in 20+ minutes are most likely a stall on the PC (disk, antivirus, other programs) or the route; I did not measure it and promise no number (35 ms). Needs a test with the in-game ping next to the Modrinth app on the same server.
- The panorama background is hidden on the owner's instance by the resource pack `Crystal PvP LT3 Essentials v25.2.zip` (a pack beats a mod). Disabling that pack shows ours.

**Test plan for the other window (PASS/FAIL):**
1. Install `release-1.4.8\Reminth-Setup.exe`, open Settings: red "Keep this on." under the name.
2. Streamer settings page: Hotkeys card above Streamer mode.
3. Library, click the blue words: popup; Test it shows the small box; Revert undoes; the cross keeps it on.
4. Press Play on the 26.2 instance: title screen has Discover | Connect Discord under Multiplayer; Discover brings Reminth to Discover; Connect Discord says "Coming soon"; Back from Singleplayer/Options still returns to this screen.
5. Same on 26.3 and one old version (1.21.1).
6. Play on DonutSMP 2 minutes: Player Statistics shows kills/deaths/mined within about 40 s of the next refresh; blocks placed is an estimate.
7. Reminth start: loading screen under 3 seconds, then Skins opens instantly.

---

## 0000000. Title screen bug found by the owner, and the audit after it (5 Oct 2026, evening)

**Bug:** with no saved worlds, Singleplayer opens the Create World screen; Back/Cancel then showed Minecraft's normal title screen. Cause: when a screen is closed with nothing to show and no world is open, the game builds
`new TitleScreen()` INSIDE `setScreen`, after my swap had already looked at the argument. Fix: a second hook (`@ModifyVariable ... at STORE`) in `ScreenSwapMixin`, all four copies.
**Verified in the real game:** a throwaway test mod (`tools/overnight/hometest`) runs 8 ways back to the title screen (Back from Singleplayer, Options, Language, Multiplayer, Create World cancel via `setScreen(null)` and via a new `TitleScreen`,
`setScreen(null)` with no world, 5 window resizes) and requires OUR screen with exactly one set of buttons: **26.2 and 26.3 all 8 PASS** (clean, with the owner's 29 mods, and with the full Reminth pack); the OLD jar fails 4 of them (so the test sees the bug).
Other versions (26.1.2, 1.20.1, 1.21.1, 1.21.4, 1.21.5, 1.21.8, 1.21.10, 1.21.11): a debug line (`-Dreminthhome.debug=true` logs every swap) shows the second swap after Singleplayer + Escape on every one.
**Also found and fixed in the audit:** (1) Realms had no button at all on our screen - a Realms icon (cloud) is in the row now; (2) the demo version keeps the game's own title screen; (3) multiplayer disabled for an account now explains why on hover.
Known and left: vanilla's small Accessibility and Friends (26.x) buttons are not on our screen (Options -> Accessibility Settings has the first); an unread Realms notification envelope can draw over the buttons (it is the game's own overlay).
Jars are **1.0.1** (10 of them, bundled). A player's old 1.0.0 jar is replaced by 1.0.1 on the next Play (tested through Reminth's own install).
**The owner's real instance (`%APPDATA%\Reminth\instance\game`) had NO home-screen jar at 20:36** (old 1.2.2 HUD only): the installed Reminth was still the old version. He must install `release-1.4.8` and press Play once to get it.

---

## 000000. The "not covered" list, worked through (5 Oct 2026, daytime, desktop window)

Scripts: `tools/overnight/` (README there). What was done on this PC, with real games:
- **Playing for an hour: PASS.** Fabric 26.2 with the owner's own 29 mods and the HUD, flying over fresh terrain for 3653 s: average 874 FPS, 1% low 430,
  one frame over 50 ms (69 ms) in the whole hour, 1204 garbage collections (65 s in total, none long), memory flat at about 4.66 GB for the whole hour, clean exit. Not tested: 3+ hours.
- **Player-added mods: PASS.** The 12 most downloaded Modrinth mods (plus their dependencies), installed the way Discover does, then started: Fabric 1.21.1, 26.2, 1.20.1, 1.19.4, 1.18.2;
  Forge 1.20.1, 1.19.2, 1.16.5, 1.12.2; NeoForge 1.21.1, 1.20.4, 26.2: all started. **Quilt 1.21.1 did not**: Quilt reports real mod conflicts there
  (the newest stable Iris is older than what the newest Sodium wants, and the newest Fabric Language Kotlin needs a newer Fabric loader than Quilt provides). That is the mods, not Reminth;
  the Mods tab's compatibility check is the place that should say it. Quilt is rare, so I left it.
- **Starting with no internet: PASS.** Every network request refused, then install + start from what was already on disk: vanilla 1.21.1, Fabric 1.21.1 (HUD + pack), Forge 1.20.1,
  NeoForge 1.21.1, Fabric 1.18.2 all started. (Simulated inside the test, not by cutting the PC's real connection.)
- **Version change with mod syncing: PASS after one fix.** Forge 1.19.2 -> 1.20.1 and NeoForge 1.21.1 -> 1.21.4 moved every mod. On Fabric my first test did things in an order a player cannot reach (it
  installed Sodium by hand on top of Reminth's own Sodium) and left two copies; in the realistic order (the player adds mods in Discover, Reminth's first start, then the switch) there were no duplicates.
  The REAL gap that test showed: **Iris 1.8.8 says "1.21.x" in its own file but only works on 1.21.1**, so after a switch to 1.21.4 nothing flagged it and the game stopped. Fixed (`compat.js judgeMod`/`checkInstance`):
  a mod whose file says yes but whose Modrinth listing names only OLDER versions is now updated when Modrinth has a proper STABLE build for the new version, and left alone (no warning at all) when it has none.
  3 new tests. Real games after the fix: Fabric 1.21.1 -> 1.21.4 OK, 1.19.4 -> 1.20.1 OK, 26.2 -> 26.3 OK (with the top 10 mods, Iris included).
  **Still fails, and is the mods' fault:** Fabric 1.20.1 -> 1.21.1 with BOTH Iris and Sodium by hand: the newest STABLE Sodium (0.8.13) says "breaks Iris below 1.8.13" and the newest stable Iris is 1.8.8 (which wants Sodium 0.6.x),
  so no stable pair exists on 1.21.1; the mods folder is clean and the Mods tab already warns about this pair. Making Reminth pick a matching pair (it would need to use Iris's beta) is a bigger decision for the owner.
- **Joining a real server: NOT done** (needs the owner: my test account is offline; a local test server needs the owner to accept Mojang's EULA). **Other graphics cards: NOT done** (needs someone with AMD/Intel).

---

## 00000. The overnight run (5 Oct 2026, desktop window): EVERY Minecraft version launched; five real bugs found and fixed

Installer rebuilt: **`release-1.4.8\` has everything below** (nothing is published). `npm test`: 630 pass.

**The sweep.** A script installed each Minecraft version through Reminth's own `ensureInstalled()` + `launch()`, waited for the game window and took a
window-only picture (`sweep-shots` in the scratchpad, not in the repo). **All 917 versions Mojang lists were launched at least once**: 103 releases
(1.0 to 26.3), 26 betas, 35 alphas and pre-classic (rd-*, c0.*, inf-*), and all 753 snapshots (April Fools versions included).
- **Result: every one of the 917 started in at least one run.** 14 snapshots failed in the first pass (below); each one started after its fix or on a second try, and I re-ran exactly those afterwards. The whole list was not re-run on the very last code, only the versions each fix touched.
- **Fabric with Reminth's full performance pack + HUD + home screen, 48 releases (1.14 to 26.3): 48 OK** (after the fix below; 3 crashed before it).
- **Forge 12 versions (1.7.10 to 1.21.8): 12 OK. NeoForge 9 (1.20.4 to 26.3): 9 OK** (1.20.6 crashed before the fix). **Quilt 5 (1.19.4 to 26.2): 5 OK.**
- "OK" = the game window opened and was still alive about 10 seconds later, and a picture shows the main menu (a few show Mojang's loading screen because the
  picture was taken a bit early). It does NOT prove a version is playable for hours.
- The first run lost the internet for a few minutes ("fetch failed" on ~100 versions); those were run again. Not a launcher problem.

**Bugs found by it, all fixed (each with tests):**
1. **Fabric API was missing or empty on Minecraft 1.14 to 1.19.1.** Fabric's Maven has no Fabric API for most of those versions and only a 5 KB empty shell for
   1.18.2, 1.19 and 1.19.1, so any mod that needs Fabric API crashed at start (Entity Culling from the performance pack did on 1.18.2/1.19/1.19.1).
   Now: Maven first, and when its file is missing or tiny, Modrinth's real jar (sha1 checked, Modrinth's own host only); old empty shells are removed.
2. **NeoForge 1.20.6 did not start.** NeoForge writes library names with an "@jar" suffix, so Reminth thought vanilla's log4j/slf4j were different
   libraries and put both on the classpath. `libraryKey` ignores "@jar" now, and the classpath never lists a file twice.
3. **The 2013 snapshots 13w16a to 13w23a (10 versions) did not start**: they do not know --width/--height. Not sent for those.
4. **A flaky native crash right after a fresh install** (Windows 0xC0000005 within ~5 s) hit 5 snapshots of the 1.18 cycle in the first pass; 3 started on a
   plain second try and 2 started in a later run. Reminth now starts the game once more, quietly, after such an early crash (once per Play, same settings).
5. (Not a bug of the sweep, found beside it) the privacy policy said the HUD "stores nothing"; it now saves server stats: privacy v8.
Also tonight: friendlier New instance wording (Loader -> "Mods: pick a loader", plain notes for each loader, HUD text no longer says coordinates), Reminth stops its
decorative animations while it is not the window in front (an idle installed Reminth used 7 to 10% of a CPU core; I could not measure the gain on my
empty test profile), Library/streamer/hardware-acceleration changes (section 000), server statistics (section 0000), stat cards without the glow.
**Not covered by any sweep:** playing for a long time, joining a real server, mods the player added, Forge mods, starting with no internet at all, GPUs other than the owner's RTX 2060 SUPER.
**To publish:** upload the 3 files in `release-1.4.8\` as v1.4.8 (description text is in the chat history; add "works on every Minecraft version Mojang has ever listed, including all snapshots").

---

## 0000. Server statistics (5 Oct 2026, desktop window) - the owner's "my stats never go up on servers" bug

Cause: the Statistics page only read stat files inside local WORLDS (`saves/*/players/stats`). A server keeps your stats on the server, so crystal/sword
PvP never counted. All files on the owner's PC are singleplayer worlds, newest 26 Sep. Not a regression.
Fix: **ReminthHUD 1.3.0** (`ServerStats.java`, same file in `hud/` and `hud-1.21/`) asks the server for the player's own statistics (the packet the
Statistics screen sends, `REQUEST_STATS`) about 10 s after joining and every 90 s, and saves the answer to `<instance>/.reminth/server-stats/<server>.json`
(world-stats layout + server, uuid, savedAt). Launcher: `gameData.readServerStats` + `playerStats` add these to the totals (the same server in two instances
counts once, newest snapshot; another account's file is skipped); Stats page says "Across N worlds and M servers" and has a footnote.
Off switch: `"serverStats": false` in `config/reminthhud.json`. Singleplayer/LAN are skipped (the world file already counts). Local file only, nothing is sent.
**Seen working in the real game on all ten HUD versions** (1.20.1, 1.21.1, 1.21.4, 1.21.5, 1.21.8, 1.21.10, 1.21.11, 26.1.2, 26.2, 26.3): a test switch makes the HUD
ask the built-in server too, and a file with the server's numbers appeared every time (26.2 with the owner's real world: blocks mined etc.). 3 new tests (624 pass).
**NOT tested:** a real remote server (no server was joined). Servers that keep no normal Minecraft stats (some minigame networks, custom worlds) will
answer with nothing or zeros - then no file is written. Needs the HUD to be on for the instance (it is on by default for Fabric/Quilt; Forge has no HUD, so no server stats there).
The 1.4.8 installer was rebuilt with all this (release-1.4.8 updated). Stat cards no longer have the coloured glow.
**Owner test:** play 5+ minutes on a crystal PvP server, break some blocks, wait ~2 minutes, open Player Statistics -> Refresh: "Across ... and 1 server" and blocks mined has gone up.

---

## 000. UI batch, 5 Oct 2026 (desktop window): Library = clips and screenshots, streamer-mode line, hardware-acceleration warning

Not in any built installer yet (release-1.4.8 was built before it). `npm test`: 621 pass. Checked in the real app (isolated profile):
- **Library** is now the clips and screenshots page (it was the captures page, which only existed with streamer mode on). The old
  Instances/Worlds/Servers tabs are gone from it (instances are on the left rail). Without streamer mode it lists in-game F2 screenshots
  and old captures; the Screenshot/Save clip buttons and the recording bar only show with streamer mode on.
- Top of Library: "Are you a content creator? Check out **streamer mode** on the launcher!" (blue link) -> opens the Streamer settings
  panel, which now has a "Streamer mode" on/off switch at the top (before, the panel was unreachable with the mode off).
- Settings -> Hardware acceleration: the text says to keep it on; turning it OFF asks first ("will feel slow and laggy"); a red
  note shows while it is off. Cause of the owner's lag on 4 Oct: this setting was off.
- Not tested: clicking through with real clips; the rail with streamer mode on (Captures button removed, Streamer settings stays).

---

## 00. Desktop window, 4 Oct 2026 evening: 1.4.7 and 1.4.8 built, links tested, home-screen mod on ten versions

**Two installers are ready, in different folders (git-ignored, on the owner's PC):**
- `release-1.4.7\` = the FPS bar on every version + JEI fix + prompt-17 code. **No home screen** in it.
- `release-1.4.8\` (also in `dist\`) = 1.4.7 **plus the home screen**. Each folder has `Reminth-Setup.exe`,
  `Reminth-Setup.exe.blockmap`, `latest.yml` - upload all three of ONE folder to the GitHub release.
  Recommended: skip 1.4.7 and publish 1.4.8 (players on 1.4.6 update straight to it) after looking at
  `home/previews/title-1280x720.jpg` (decision H3). `npm test`: **621 pass** (Windows). Installer is 155 MB (113 MB before; the
  ten home jars carry the pictures, 4 MB each).

- **`reminth://` links, tested on the packaged app** (`win-unpacked`, own profile; signed-in state forced because a
  signed-out Reminth deliberately stays on Home): `reminth://skins` while running -> Skins PASS; `home` -> Home PASS;
  `instance/reminth` -> instance page PASS; `play/zz`, `../../x`, `skins?x=1`, `REMINTH://home`, unknown
  instance, `delete/reminth` -> ignored PASS. The packaged app writes the scheme under HKCU (no admin) PASS (I
  removed my test key each time). The Skins icon in the game was tested up to Windows: with a temporary harmless
  handler registered (removed again) a real click on it delivered `reminth://skins/` (Windows adds the slash; the
  parser accepts one trailing slash). NOT tested: the NSIS installer writing the scheme; a link when Reminth is fully
  closed (code read: boot waits for the sign-in state); a link while a game runs.
- **Home screen mod = `home/` (26.1, 26.2, 26.3) + `home-1.21/` (1.20.1, 1.21-1.21.1, 1.21.4, 1.21.5,
  1.21.6-1.21.8, 1.21.9-1.21.10, 1.21.11); ten jars in `assets/mods` (`reminthhome-1.0.0+...`).** Pictures were
  made on this PC (Minecraft 26.2 + Iris 1.11.4 + Sodium + Complementary Reimagined; 12 seeds x up to 10
  viewpoints, I looked at the results myself). Chosen: **seed 2024, viewpoint 8** (aurora over a snowy taiga),
  blurred lightly, brightened, 6-bit dithered to keep the jars small. Kept as alternatives: seed 424242 vp 1
  (aurora over snow peaks), seed 271828 vp 4 (aurora + campfire). `home/previews/*.jpg` are real in-game shots.
  What it does: a subclass of the vanilla `TitleScreen` (logo, splash, version and Mojang's copyright line stay),
  dark rounded Singleplayer/Multiplayer buttons, up to 2 saved-server shortcuts, bottom-middle icons (Skins ->
  `reminth://skins`, Mods only if Mod Menu is installed, Options, Language, Quit), the panorama camera looks
  slightly UP (vanilla looks down and cuts the sky). Any exception -> vanilla title screen from then on.
  `config/reminthhome.json {"enabled":false}` -> vanilla buttons. Needs Fabric API (declared; Reminth installs it).
- **Tested in the REAL game** (harness: Reminth's own `launch()`, window-only captures):
  - 26.2 clean at GUI scale 1, 4 and auto; windows 854x480, 1280x720, 1920x1080; with the owner's 118 mods (the
    Mod Menu cube icon appears, no crash); config off -> vanilla buttons; corrupt `servers.dat` -> no shortcuts, no
    crash; clicks that worked: Options, Language, Mods (Mod Menu), Multiplayer list, Singleplayer (opens Create
    World, as vanilla does with no worlds), quick-join (reaches "Unknown host" for a fake server).
  - Leaving a world returns to OUR title screen (26.2 with Iris + Sodium installed).
  - Every other version: 26.1.2, 26.3, 1.20.1, 1.21.1, 1.21.4, 1.21.5, 1.21.8, 1.21.10, 1.21.11 each started to the
    title screen with ours showing (buttons, icons, picture, copyright line, sky visible) and one icon click
    (Options or Language) opened the right screen.
  - **1.21.6, 1.21.7, 1.21.9 and 26.1.1 were started with the jar and the matching Fabric API installed by
    Reminth itself** (the whole real path, no hand-copied files): ours showed on all four. So every version
    from the list was seen: 1.20.1, 1.21.1, 1.21.4-1.21.11, 26.1.1, 26.1.2, 26.2, 26.3.
  - Reminth's own install path (`ensureInstalled`) puts the right jar + Fabric API into a 26.2 / 26.3 / 26.1.2
    instance and nothing when the switch is off; the packaged app answers "build available" for exactly the
    versions of the HUD and "no" for 1.21.2, 1.21.3, 1.19.4, 1.8.9.
  - **Not fully verified:** on 26.3 two scripted clicks landed on Singleplayer instead of the button aimed at (the
    game window opened with the real mouse hovering there; looks like my PostMessage clicks, not the mod). Click
    through once for real on 26.3.
  - **NOT tested at all:** the Skins icon (opens the installed Reminth); controller/narrator; resource packs
    that replace the panorama; Quick Play launch; fullscreen toggle; Forge/NeoForge/Quilt (not built).
- One thing I noticed: the owner's mod set shows a small extra avatar-like icon above the icon row - another mod
  (not ours) adds it to the title screen.

### Decisions for the owner (recommendation first)
- **H3: publish 1.4.8 (with the home screen)** after looking at `home/previews/title-1280x720.jpg`. Recommended:
  yes, default ON (the switch stays). If you dislike something (picture, buttons, layout), it is one file each;
  1.4.7 stays available as the version without it.
- **H4: the picture.** Recommended: the aurora one (seed 2024). Other candidates in
  `home/previews/other-pictures-considered.jpg` (top = seed 424242, middle = seed 271828, bottom = chosen).
- Quick-join shows the FIRST two servers of the game's list, not "last played" (the game stores no play time).

### PASS/FAIL for the owner (5 minutes)
1. Install 1.4.8, start Reminth, Play the Reminth instance (26.2): the title screen is the aurora one with dark
   rounded buttons and icons at the bottom. PASS/FAIL.
2. Click Singleplayer, Multiplayer, Options (gear), Language (globe): each opens the right screen and Esc/Back
   returns to OUR title screen. PASS/FAIL.
3. Click the person icon (Skins): Reminth comes to the front on its Skins page. PASS/FAIL.
4. Instance settings -> turn "Reminth home screen" off, Play: the normal Minecraft title screen. PASS/FAIL.
5. With Mod Menu installed: the cube icon opens the mod list; without it, no cube. PASS/FAIL.
6. Open a world and leave it ("Save and Quit to Title"): our title screen again. PASS/FAIL.

---

## 0. Prompt 17 (cloud window, 4 Oct 2026): the launcher side of the Reminth home screen

This is `HOME_SCREEN_PLAN.md` section 6. Nothing here builds the game mod: that is `home/`, the desktop window's
job. No version bump, no build. I did not touch `hud/`, `hud-1.21/`, `assets/mods/*.jar` or the privacy/terms text.
**`npm test`: 621 pass** (Linux): 603 before, plus 10 in `test/bundled-mods.test.js`, 7 in
`test/deep-link.test.js` and 1 in `test/perf-profiles.test.js`.

**Not tested for real (no Electron, Windows or Minecraft here):**
- the installer writing the scheme to the registry;
- Windows starting Reminth from `reminth://…`, and the real `second-instance` argv;
- `flashFrame` and focus rules in a real window;
- a real game loading a `reminthhome` jar (none exists yet);
- the dialog in real Electron.

What I did test: the node tests below, plus headless Chromium driving the real renderer with a fake preload. That
covered the home switch, the save payload, and a link arriving before startup finished (it lands on Skins after
boot). It also covered instance and bad links: bad links do nothing.

### Job 1: bundled mods are one mechanism (ReminthHUD + `reminthhome`)
- **`src/main/config.js`**: `BUNDLED_MODS` lists both mods:
  - `{ mod: "reminthhud", filePrefix: "reminthhud-", flag: "hud", label: "ReminthHUD", defaultOn: false }`;
  - `{ mod: "reminthhome", filePrefix: "reminthhome-", flag: "homeScreen", label: "Reminth home screen", defaultOn: true }`.

  Two helpers go with it: `bundledMod(key)` and `bundledModWanted(entry, instance)`, which is Fabric/Quilt only.
  For the HUD the switch must be `hud === true`; the home screen is on unless `homeScreen === false`.
- **`src/main/minecraft.js`**:
  - `bundledModBuilds(mod)` and `findBundledModFor(mod, mc)` replace the HUD-only scan. A build is picked by its
    `fabric.mod.json` `depends.minecraft`, and the newest one that fits wins.
  - `findReminthHudFor` and `bundledReminthHudBuilds` still exist and give the same answers.
  - `ensureInstalled` runs the steps in order:
    1. `bundledModsFor`: what's wanted and fits;
    2. `installBundledMods`: the same `installBundledJar` copy as before, noted as Reminth's own;
    3. `tidyManagedMods(… dropBundled: bundledModsToDrop(instance))`: removes the home screen when it's switched
       off, or on a Forge, NeoForge or vanilla instance.
  - Wanted but no build for this version: the copy that's there stays and nothing is said, which is the HUD's rule.
  - The HUD keeps its exact old conditions, including Fabric API whenever the HUD is on. The home screen brings
    Fabric API only if its jar's `depends` names `fabric-api`/`fabric`.
  - `isPerformanceMod`, `planStepAside`, `managedModFromName`, `managedModLabel` and the legacy adoption now treat
    every bundled mod as "Reminth's own, not the pack". So the home screen never steps aside for a player's jar with
    the same id (as the HUD), and switching the pack off never removes it.
  - With **no `reminthhome-*.jar` in `assets/mods` (today), all of this is a quiet no-op.**
- **`src/main/content.js`**: the "performance pack jars" list leaves out every bundled mod.
- **`src/main/instances.js`**: a new `homeScreen` field, sanitized like `performanceMods`: only a real `true`/`false`
  is stored, and a missing value means on. It's in `create()` and in the `update()` whitelist. No migration.
- **`src/main/main.js`**:
  - `instances:create` and `instances:update` accept `homeScreen` (anything that isn't a boolean is dropped);
  - new IPC `bundled:supports(mod, mc)` (`hud:supports` is unchanged);
  - "Reminth home screen" is added to `app:info.managedMods`.
- **`src/main/preload.js`**: `bundledSupports(mod, mc)`.
- **`src/renderer/renderer.js`**: the instance dialog has a **"Reminth home screen"** switch next to ReminthHUD.
  - With no build it says "No Reminth home screen build for <version> yet — it's built per version." and is
    disabled.
  - It sends `homeScreen` **only when the player used the switch while a build exists**. Unlike the HUD switch, a
    save never writes `false` just because there's no build yet. Otherwise every instance saved today would lose the
    home screen for good.
- **`src/renderer/features.js`**: the Mods tab's "Added by Reminth" badge and the "your own mods" count know
  `reminthhome-*.jar`.
- Tests are in **`test/bundled-mods.test.js`** (10), with fake jars in a temp assets folder:
  - the build is picked by its range, for both mods;
  - it's installed when on, removed when off, and left alone when no build fits;
  - no jar at all means nothing happens;
  - the HUD and the home screen switch independently;
  - the home screen is never a pack mod and never steps aside;
  - the explicit `false` is kept through create, update and rename;
  - a missing value counts as on.

  All the existing HUD tests pass unchanged.

### Job 2: `reminth://` links
- **`package.json`**: `build.protocols: [{ name: "Reminth", schemes: ["reminth"] }]`. The NSIS install is per-user
  (`perMachine: false`), so the scheme goes under HKCU with no admin prompt.
- **`src/main/deepLink.js`** (new, pure):
  - `parseDeepLink(argvOrString, { knownIds })` returns `{ page: "skins" }`, `{ page: "home" }`,
    `{ page: "instance", id }` or `null`.
  - It is a strict allow-list:
    - the scheme must be exactly `reminth://`, lower case;
    - the host must be `skins`, `home` or `instance/<id>`, where the id is `[a-z0-9-]{1,40}` and **exists**;
    - one trailing `/` is allowed;
    - the only characters allowed are `a-z0-9/-`, so no query, fragment, `%`, `.`, `..`, `\`, `@`, `:`, spaces or
      control characters get through;
    - at most 120 characters, and exactly one `reminth:` argument in argv.
  - `createDeepLinkHandler({ listIds, bringForward, showPage })` is the only thing a link can reach.
- **`src/main/main.js`**:
  - **First start:** `process.argv` is parsed. The window opens by itself, and the page is switched once it has
    loaded.
  - **Already running:** a `reminth:` argument in the `second-instance` argv goes to the handler. A good link brings
    the window forward. **While a game runs (or is starting) it never takes the screen: only the taskbar button
    flashes** (`flashFrame`), and the page still switches. See decision P17-1. A bad link does nothing at all, not
    even showing the window.
  - A plain second start (the shortcut) still restores and focuses, as before.
  - `app.setAsDefaultProtocolClient("reminth")` runs for the packaged app only.
- **`src/main/preload.js`**: `onDeepLink`.
- **`src/renderer/pure.js`**: `deepLinkTarget(link, ids)` checks the link again and returns only a page switch.
- **`src/renderer/renderer.js`**: `boot()` now settles a `booted` promise. A link waits for it, then goes through
  `switchPage`, or `selectInstance(id, true)` for an instance link. Signed out, `switchPage` keeps Home, as for every
  other route.
- Tests are in **`test/deep-link.test.js`** (7) and **`test/perf-profiles.test.js`** (1):
  - the good links;
  - about 50 bad links: other schemes, case tricks, `play`/`install`/`delete`, extra path, query, `..`, `%`,
    controls, 100,000 characters;
  - argv noise: the exe path with Greek letters, `--some-flag`, `--user-data-dir=`, `.`, `--inspect`;
  - two links, or a bad one next to a good one, mean nothing;
  - the handler calls only `bringForward`/`showPage`, and nothing at all for a bad link;
  - main.js's real `second-instance` wiring: bad link → no window calls and nothing sent; good link → show/focus
    plus `deeplink:open`; during a game → only `flashFrame`;
  - the installer config.

**Privacy text: sentences for the desktop window to add** (I didn't edit it; the owner's name stays as it is):
1. "Reminth registers the `reminth://` link type on your PC, so the game's title screen can open Reminth's Skins page.
   A `reminth://` link can only choose which page Reminth shows. It can't start a game, install, delete, download,
   sign you out or send anything."
2. "Reminth home screen: a mod made by Reminth that Reminth copies into your Fabric and Quilt instances (you can
   switch it off per instance in Edit). Like ReminthHUD, it comes inside the Reminth app; nothing is downloaded for
   it." The mod itself (desktop window) may need more sentences: for example, it reads the instance's own
   `servers.dat` for the quick-join shortcuts.

### Other commits on `main` since Audit 16 (desktop window, described in their own commit messages)
- `c582945`: the update lock is now set before the first await, and the mod toggle rename is retried (Audit 16
  suspect (b) 5, now fixed).
- `a2c6c2a`: ReminthHUD for 1.20.1 and 1.21.x from one source.
- `867e159`: `HOME_SCREEN_PLAN.md` and this prompt.

---

## 0b. Audit 16 (cloud window, 4 Oct 2026): bug and glitch audit, no features, no version bump, no build

I read all of `src/main/*.js` and `src/renderer/*` looking for what a player on a normal Windows PC would hit. I also
checked the UI in headless Chromium at 1000x660 (the smallest window size), 1100x700 and 1097x577 (1080p at 175 %).
Each fix has a test that fails without the fix. `npm test`: **602 pass** (Linux). I did **not** touch `hud/`,
`hud-1.21/`, `assets/mods/`, the privacy or terms text, or the version.

**Not tested for real (I can't run Electron, Minecraft or Windows here):** PowerShell's real output on a Greek or
accented user name; real Windows rename and antivirus behaviour; the real window on a scaled screen; the real
Microsoft token refresh. The checks in (c) below cover these.

### (a) Bugs fixed (file:line, what a player saw, the test)

1. **`src/main/runningGames.js:58`**: on a PC whose Windows user name has Greek or accented letters
   (`C:\Users\Γιώργος`), Reminth didn't find a game that was still running after a restart. Pressing Play then
   started a second copy on the same worlds. Cause: PowerShell answered in the OEM code page, so the game folder
   never matched. Fix: PowerShell is now told to answer in UTF-8.
   Test: `test/running-games.test.js` "Audit 16: PowerShell is told to answer in UTF-8…".
2. **`src/main/main.js:749` (`content:applyUpdates`)**: while "Update" (a mod update from the Mods tab or the compat
   panel) was replacing jars, Play could start and write Reminth's own jars into the same `mods/`, and a second
   update could run on top. Play then failed with "file in use", or the game started on a half-swapped mods folder.
   Fix: this update now uses the same per-instance lock as "Update mods to fit".
   Test: `test/perf-profiles.test.js` "Audit 16: Play and 'Update mods to fit' wait for a running mod update".
3. **`src/main/main.js:590-595` (delete and Undo)**: an instance could be deleted while its mods were being
   updated, while its game files were installing, or while a copy was being made from it. The delete ran under the
   writer, so the player got random "couldn't delete" errors, or a half-deleted folder that the writer then filled
   again. Fix: deleting is refused with a plain sentence while any of these runs.
   Test: `test/perf-profiles.test.js` "Audit 16: an instance can't be deleted while it is being updated or installed".
4. **`src/main/main.js:557-559` (`instances:update`)**: changing an instance's version or loader while its mods were
   being updated left it on the new version with mods picked for the old one. Fix: a version or loader change
   waits for the update (a rename still works).
   Test: `test/perf-profiles.test.js` "Audit 16: an instance's version can't be changed while its mods…".
5. **`src/main/content.js:778-783` (turning a mod on or off)**: Windows' rename replaces a file that already has the
   target name. Example: the player turned off `sodium.jar`, then dropped a newer `sodium.jar` into the folder.
   Turning the old one back on **silently deleted the newer jar**, and the other way round too. That is the
   player's own file lost. Fix: the switch is refused with "There is already a file called sodium.jar in that
   folder - remove or rename one of the two first."
   Test: `test/audit16.test.js` "turning a mod on or off never overwrites another file with the same name".
6. **`src/main/streamer.js:304-317` (screenshot hotkey)**: screenshot names are to the second, so pressing the hotkey
   twice within a second kept only the last picture. Fix: the file is created with `wx`, and the second one gets
   `-2`. Test: `test/audit16.test.js` "two screenshots in the same second are both kept".
7. **`src/main/gameData.js:426` (add a server to the multiplayer list)**: two adds at once (two quick clicks on two
   servers) both started from the old `servers.dat`, so the second dropped the first. Both still said "added".
   Fix: adds to one list run one at a time. Test: `test/audit16.test.js` "two servers added at once…".
8. **`src/main/msAuth.js:59,365` (wrong clock)**: the Minecraft token's expiry is saved as now + 24 h. If the PC
   clock was days ahead at sign-in and then got corrected, the dead token looked valid for days. The game
   started, but every server refused the login ("Invalid session"). Fix: an expiry more than 25 h away is
   renewed. Test: `test/audit16.test.js` "a token saved while the PC clock ran ahead is renewed…".
9. **`src/main/modsSync.js:212-215` (wrong clock)**: the copies of replaced jars (`.reminth/replaced-mods`) are
   pruned to the newest five by name, and the name is the date. With the clock behind (a flat CMOS battery), the
   copy just made sorted first and was **deleted right after being written**, so "Restore replaced mods" had
   nothing to give back. Fix: the new copy is never the one pruned.
   Test: `test/audit16.test.js` "with the PC clock behind, the copy of the jars an update just replaced…".
10. **`src/main/atomic.js:126-133` (wrong clock)**: the same problem for the copy of a damaged `instances.json` or
    `settings.json` (`.corrupt-<time>`). With the clock behind, the only copy of the damaged file was pruned at
    once. Fix: same as 9. Test: `test/audit16.test.js` "a damaged file that was just set aside isn't pruned".
11. **`src/main/windowRestore.js:66` + `src/main/main.js:118` (screen scaling)**: the window's minimum size was
    fixed at 1000x660. At 1920x1080 with 175 % scaling (or 1366x768 at 125 %), the usable screen is about
    1097x590, so the window could not fit, and its bottom (the Settings button) hung under the taskbar. Fix: the
    minimum is now the smaller of 1000x660 and the screen; normal screens get exactly the sizes they had before.
    I checked in Chromium that the page itself still works at 1097x577: the instance list in the rail scrolls.
    Test: `test/audit16.test.js` "on a screen smaller than 1000x660… the window fits on it". (Before the fix the
    test failed because `windowSizes` didn't exist; the old inline formula gave min 1000x660 whatever the screen.)

### (b) Suspected, NOT fixed, most likely first

1. **Captures go to `%USERPROFILE%\Videos\Reminth`, not the real Videos folder** (`paths.js` CAPTURES_DIR). With
   OneDrive Backup on (the default on many new PCs), Videos is `%USERPROFILE%\OneDrive\Videos`. Captures still
   save, just not where Explorer's "Videos" shows them. Not changed: moving it would hide existing captures from
   the list. **Decision A16-D1.**
2. **Reminth's data folder is `homedir\AppData\Roaming\Reminth`, not `%APPDATA%`** (`paths.js` ROOT). It's only
   different on PCs where IT has redirected AppData (school or work PCs). Changing it would move every player's
   data. **Decision A16-D2.**
3. **Adding a server while the game is running** (`servers:add` is allowed then): Minecraft rewrites
   `servers.dat` from its own copy when its multiplayer screen saves, so the added server can vanish. I'm not
   sure exactly when vanilla saves. Test step A16-9 settles it; if it does vanish, refuse the add while the game
   runs (one line).
4. **The Discover "Installed" badges can be stale after an install** (`features.js` `loadPresence`). A second call
   while one is running gets the first one's answer, which may have read the instance before the install
   finished. It corrects itself on the next Discover visit. Not fixed: the renderer has no node test harness, and
   the rule is a test for every fix.
5. **(Fixed by the desktop window in `c582945`.)** **Turning a mod on or off when antivirus is scanning the jar**: `content.setEnabled` uses a plain rename, with
   no EBUSY/EPERM retry like the downloads have. The player gets "That file is in use — close Minecraft and try
   again." and a second click works. One-line fix (`atomic.renameWithRetry`) if check A16-6 shows it.
6. **Very long Java command line**: the classpath is passed on the command line with no `@argfile`. Windows'
   limit is 32,767 characters. A Forge or NeoForge instance with a very long user name could get close; I
   couldn't measure a real one. A16-10 measures it.
7. **The main process doesn't stop a mod being installed, turned on or off, or removed in an instance while its
   mods are being updated.** The page already refuses these, so only a stale page could do it. Worst case: one
   install fails, or the "replaced" bookkeeping drops a copy.
8. **`logs.importInstanceLogs` can run twice at once for one instance** (start-up import, the end of a session,
   the Logs tab). Both write `index.json` through the same `.tmp` name, so one can fail with ENOENT/EPERM. It's
   retried on the next look and nothing is lost: both work from the same sources.
9. **A clip saved within one second of the previous clip replaces it** (`webm.joinSegments` opens with `"w"`). A
   second clip waits for the first, so this only happens when joining took under a second, and the clip it
   replaces is near-identical.
10. **`catalogCache.warmCatalog`**: if the very first status write fails (disk full), that category is never
    warmed again in this session (`warming` isn't cleared). Discover still works live.
11. **The in-memory caches** (`versions:list` 15 min, loader lists, compat 2 min, skins) believe a clock that
    jumped backwards during a session until Reminth restarts. Only the age check is affected.
12. **The HUD jar cache copy** (`minecraft.js` around line 408) and **the skin cache** (`skin.js:192`) aren't
    written atomically. Both repair themselves (a size check, or a re-fetch).
13. **Only one "copy to another version" at a time across all instances** (`copyInFlight` is global). By design.

Checked and fine (no change):
- every download (stall timeout, `.part`, size and hash checked before the rename);
- every fetch has a timeout;
- no `innerHTML`, and no `shell: true` or exec anywhere;
- links: https only (`markdown.safeLink`, `openExternally`), and there's a CSP;
- mrpack paths;
- the stale-answer guards in the content, worlds/servers and logs loaders;
- every modal button re-enables after an error;
- the 1.4.2 trap: no CSS animation with a `forwards` fill or an `opacity:0` start that needs it to finish;
- no element wider than the window at 1000x660 or 1100x700.

### (c) Windows checks for these fixes (PASS/FAIL each)

A16-1. **Greek user name:** on a Windows account whose name has Greek or accented letters (a throwaway local
       account is fine), start a game from Reminth, close Reminth, then reopen it. The instance shows "Running"
       within about 6 s, and Play says it's already running.
A16-2. **Update + Play:** in a throwaway instance, start "Update" for a few mods from the Mods tab, and press Play
       while it runs. You get "Its mods are being updated - wait a moment…", and Play works once it's done.
A16-3. **Delete while busy:** while an instance's mods are updating, choose Delete for it. You get "That instance
       is busy…" and nothing is deleted. Delete works once the update ends.
A16-4. **Version change while busy:** while an update runs, open the instance's edit dialog, change the version, and
       save. You get the "wait a moment" sentence. A rename alone saves.
A16-5. **Same-named mod:** in a throwaway instance, put `test.jar` and `test.jar.disabled` (two different files) in
       `mods/`. Toggle either one in the Mods tab. You get "There is already a file called…", and both files are
       unchanged (check their sizes in Explorer).
A16-6. **Toggle right after a download** (antivirus on): install a mod and toggle it off at once. Note whether a
       "file in use" toast appears (this is suspect (b) 5; report it, it isn't a FAIL).
A16-7. **Two quick screenshots:** with streamer mode on and a game running, press the screenshot hotkey twice
       quickly. Two files appear, one ending in `-2.png`.
A16-8. **Two quick server adds:** in Discover → Servers, click "Add to server list" on two servers quickly for the
       same instance (game closed). Open Minecraft's Multiplayer list: both are there, with the old entries intact.
A16-9. **Server add while running (suspect (b) 3):** with the game open on the multiplayer screen, add a server from
       Reminth, then press Refresh or leave and come back in game. Report whether it stays.
A16-10. **Long command line (suspect (b) 6):** launch a Forge or NeoForge instance and copy the command line from
        Task Manager (Details → Command line column). Report its length.
A16-11. **Small scaled screen:** set Windows to 1920x1080 at 175 % (or a 1366x768 screen at 125 %), then start
        Reminth. The whole window is on screen: the Settings button at the bottom left is visible above the
        taskbar. Restore Down, then Maximize again: still fits. Back at 100 %: same size as before.
A16-12. **Wrong clock (optional):** set the clock 3 days ahead and sign in again. Set the clock back to automatic,
        then restart Reminth and press Play, joining a server. It joins, with no "Invalid session" (the token was
        renewed). `main-errors.log` stays clean.
A16-13. **"Restore replaced mods" still works** after "Update mods to fit" (normal clock): the newest folder in
        `.reminth\replaced-mods` holds the old jars, and at most five folders are kept.

---

## 1. What changed

### Desktop batch, 3 Oct evening (owner: "200 FPS in Reminth vs 500 in Modrinth", ping too high, update popup annoying)

**1. Server ping** (`src/main/serverPing.js`, `test/server-ping.test.js`, tooltip in `features.js paintPing`).
The number was the time the server took to build its status answer (MOTD, icon, players), not the round trip.
Now, like Minecraft's own server list: after the status answer, up to 3 Ping/Pong packets (8-byte payload, must
echo exactly), `process.hrtime`, median kept. A server that never answers a ping falls back to the status time
(`latencyKind: "status"`, tooltip says so); a vanilla server that hangs up after the first pong still counts it;
ping phase capped at 1.5 s inside the old 3.5 s timeout. Real servers, old vs new: hypixel.net 439 → 149 ms,
donutsmp.net 103 → 42, play.cubecraft.net 82 → 40, 2b2t.org 37 → 17.

**2. Updates without the admin prompt** (`package.json` build.nsis, `build/installer.nsh`, `updater.js`).
The UAC popup came from the "all users" install in `C:\Program Files\Reminth` (Windows must ask to write there).
Now: one-click NSIS, **per user** (`%LOCALAPPDATA%\Programs\reminth-launcher`), no admin rights ever, and
"Restart and update" runs `quitAndInstall(true, true)` (silent, Reminth reopens). `build/installer.nsh`
`customInstall`: if an HKLM "all users" Reminth exists in another folder, its own uninstaller is run once,
elevated (`/allusers /S /KEEP_APP_DATA`), so Windows asks **one last time** and the old copy and its public
shortcuts go. Player data is in `%APPDATA%\Reminth` and is not touched. The install-folder chooser is gone
(one-click has none). Checked: a test build installs silently with no prompt in 9 s, makes the desktop + Start
menu shortcuts and the HKCU uninstall entry, and its silent uninstall removes them. **Not checked: the removal of
the old Program Files copy** (needs someone to answer the Windows prompt) - section 4 R2.

**3. ReminthHUD 1.1.0** (`hud/`, jars in `assets/mods/`: `reminthhud-1.1.0+26.2.jar`, `…+26.3.jar`).
Top-right bar `FPS 208 | GPU 55 % | CPU 7 % | LAT 0 ms` (owner's screenshot), coordinates + facing on a line
under it (the old top-left box sat on top of Xaero's minimap). GPU = Windows `\GPU Engine(*)\Utilization
Percentage` via `pdh.dll` through `java.lang.foreign`, summed per engine (luid+phys+eng - this PC has 7 separate
"copy" engines), busiest engine, on one low-priority daemon thread; failure → the item is left out. CPU =
`OperatingSystemMXBean.getCpuLoad()` (= Windows "% Processor Time"; Win 11 Task Manager shows the clock-scaled
"% Processor Utility", so they can differ). LAT = `getPlayerInfo(uuid).getLatency()`. `config/reminthhud.json`
switches items off. Moves below potion icons. One source builds both jars (key type looked up by name:
`KEYBOARD` on 26.3, `KEYSYM` on 26.2; Minecraft range from Gradle: `gradlew build -Pminecraft_version=26.2
-Pfabric_api_version=0.159.0+26.2 -Pversion=1.1.0+26.2`). Seen in the real game (26.2, the owner's 32 mods):
loads with no warning, bar and coordinates line drawn as above, no FPS cost (paired runs 228/219 vs 215-221).
The HUD is **off** on the owner's main instance (`hud:false`) - he turns it on in the instance settings.

**4. "Boost FPS…"** (instance menu; `gameOptions.js planBoost/applyBoost/undoBoost`, IPC `perf:boostPlan/
boostApply/boostUndo`, `renderer.js boostFpsFlow`, `test/boost-fps.test.js`). Only on the player's click and
"Change them", never while the game runs. Lists every change from → to; on the owner's file: render distance
16 → 12, simulation 12 → 8, entity shadows off, clouds off, biome blend 2 → off (also: V-Sync off, a frame cap
→ unlimited, particles all → decreased, when set). Only keys already in options.txt change, in the game's own
spelling; `graphicsPreset` becomes `"custom"` from 1.21.11 (else the preset overwrites the values). Old values
saved first to `.reminth/options-before-boost.json`; "Put my old settings back" restores the ones still at the
boosted value. Max FPS profile text now points here.

**5. Launcher draws nothing while a game runs (1.4.3 fix: 1.4.2 had this wrong)**: `body.game-running` switches every CSS animation OFF (`animation: none`). In 1.4.2 it PAUSED them, which froze the page/dialog fade-ins at opacity 0 (or half way after Ctrl+R): the launcher looked empty or dim for as long as a game ran. Reported by the owner with screenshots. Originally: it pauses every CSS animation (a launcher
left visible next to a windowed game would otherwise redraw at the monitor's 239 Hz). Measured during play
before this: Reminth used 0 % CPU and 0 % GPU (its window was hidden), so this is a safety net, not a speed-up.

**FPS investigation (real game, owner's PC, 26.2).** A test-only mod (`reminthbench`, scratchpad only, not in
the repo) records every frame time; launched through Reminth's own `minecraft.launch()` with an offline test
account into a copy of the owner's world, window 1600x900, camera turning. Roblox (30-50 % GPU) and Medal's
recorder were running the whole time, so absolute numbers swing ±20 % between runs; only runs next to each
other are compared (paired with a baseline on both sides).
- **Same mods + same settings, Reminth's launch vs a Modrinth-style launch** (Zulu 25 + Modrinth's G1 flags,
  normal priority): 164 vs 164, 236 vs 223, and 201 vs 232 (neighbours). **Reminth's Java setup is not
  slower**, and had fewer frames over 50 ms (0 vs 4 in round 1). Keep ZGC: G1 gave +2 % average but 1 % lows
  85 vs ~100.
- **The 200-vs-500 gap is the instance, not the launcher**: Modrinth's profile runs render distance 8,
  simulation 8, no shadows/clouds/biome blend, 22 mods (no Xaero's Minimap, JEI…), no resource packs. In the
  same run pair, Modrinth's mods + settings through Reminth's launch: 241 vs 164 (+47 %).
- Indoor scene (the saved player stood inside a house, walls hid the world): Boost settings +14 % average,
  1 % lows 112 vs 58 (+91 %), worst frame 15 ms vs 198-280 ms in the baselines; no Xaero's Minimap +17 %;
  no resource packs +9 %; ReminthHUD no cost.
- **Outdoor scene** (spectator 30 blocks up, open view - where render distance really costs): running
  overnight on a quiet PC (base vs Boost 12/10, Nvidium beta, More Culling + BadOptimizations, Modrinth
  everything vs Reminth everything). Results go here when done.

### Prompt 13 ("Your mods already fit" was false for a real instance - blocks release 1.4.1)

Prompt 12 job 2 said "Your mods already fit Minecraft X - there is nothing you need to change." whenever Modrinth
had a build of every checked mod for X. On a Fabric 1.21.1 instance holding 26.2 mod files that told a newcomer
to do nothing while the Mods panel said "28 mods will stop Minecraft from starting". Now the picker separates
**(a) builds exist** from **(b) the installed files fit** (the compatibility result - the same data as the Mods
panel and the yellow button; blocked, "may not work" and "crashed the game" all count):

| (a) builds for the current version | (b) installed files | the picker says |
|---|---|---|
| all mods have one | no compatibility result yet | grey **"Checking your installed mods..."** - decided when it arrives, never the happy sentence |
| all mods have one | none blocked / may not work / crashed | green **"Your mods already fit Minecraft X - there is nothing you need to change."** |
| all mods have one | N files are for another version | amber **"Builds exist for Minecraft X for all your mods, but N of the files in this instance are made for another version. Press "Update mods to fit" to swap them."** + that button **inside the dialog** (the yellow button's own operation, progress and result toast; the line is then worked out again) |
| all mods have one | problems the button can't fix (it already left them) | amber, no button: "…but N mods in this instance won't load or may not work. The Mods tab says which, and what to do." |
| some mods have none | (anything) | today's best-match line and ranked list (the case the owner originally asked for) |

The "Other versions that also fit" list is shown as before in the first four rows (no "Best match" badge, no
pre-selected row). N in the amber line is the yellow button's own number. Only `openVersionAdvisor` and its
pure helpers changed. The prompt-12 test for the green sentence now passes clean file data (it was asserting
the sentence with no file data at all - the bug); tests: `pickerView`/`filesSummary` for all four (a)x(b)
combinations, no result yet, and blocked + may-not-work + crashed counts.

| Files | |
|---|---|
| `src/renderer/pure.js` | `filesSummary`, `pickerView` (states fits / files / checking / best) |
| `src/renderer/features.js` | `openVersionAdvisor`: reads/awaits the compatibility result, the amber line + in-dialog button, repaint |
| `src/renderer/styles.css` | `.adv-best.warn`, `.adv-best.neutral`, `.adv-fix` |
| `test/version-flow.test.js` | +1 test, 1 updated |

### Prompt 12 (Time played on Home + three fixes from the desktop test)

| Job | What it does now | Files |
|---|---|---|
| 1 - lifetime Time played | Home's **Time played** = every minute played through Reminth, on every instance, **deleted ones included** (the owner's correction to prompt 3). A counter `totalPlayTimeMs` in `settings.json` (finite, non-negative, max 200 years; junk = absent). **Seeded once** at start, before the page can show it, from the sum of the instances' recorded time - never seeded twice, never lowered, never recomputed. Each finished session adds its time right after the instance's own time is recorded (`finishSession` → `recordSession` → `store.addPlayTime`), same rules (a start that failed adds nothing; a crash in play counts; two games at once both count - the settings lock). Only `store.seedPlayTime/addPlayTime` change it; a settings save from the page ignores it. A failed write never touches the exit handling. Home shows it ("12h 6m") with the tooltip "All your time in Minecraft through Reminth, across every instance - including ones you deleted." and repaints when a game ends (`play:totalTime`). Last played on Home, the instance page and Player Statistics are unchanged. | `store.js`, `main.js`, `preload.js`, `renderer.js` (`paintHeroStats`), `pure.js` (`homePlayTime`), `test/play-time.test.js` (new) |
| 2 - nothing to change | When the instance's own version already fits every checked mod (and a checked server takes it), the picker's green line says **"Your mods already fit Minecraft 26.2 - there is nothing you need to change."** and only the other fitting versions follow under "Other versions that also fit" - no "Best match" badge, nothing pre-selected. With problems on the current version, unchanged. | `pure.js` (`pickerView`), `features.js` |
| 3 - complete promise | "Switch this instance" confirm step now shows an **exact preview** from the main process (`compat:previewSwitch` → `versionSwitch.previewSwitch`): the same advisor answer, the same compatibility check and swap plan against the new version, nothing changed. Preview and switch build their list with ONE function (`turnOffPlan`), so "Will be turned off (3)" with each mod and reason ("no version made for 1.21.10" / "its own file says it can't run on 1.21.10") is what the result screen shows. The Switch button waits for the preview; a failed preview says so with Try again. | `versionSwitch.js`, `main.js`, `preload.js`, `pure.js` (`previewGroups`), `features.js` |
| 4 - stale button | When "Update mods to fit" ends, the old answer is dropped and the button repainted at once (hidden), then painted from a fresh check. Mods the run couldn't fix (no stable build / not on Modrinth / failed) don't count again until the switched-on mods change, so the button hides when nothing it can fix is left. (I couldn't find a path that repainted an old answer after the fresh check; the "(2)" most likely WAS the two mods it couldn't fix - both causes are covered.) | `features.js` (`runModsSync`, `syncCount`), `pure.js` (`syncButtonCount`) |

### Prompt 10 ("stop creating me a million instances that I can't delete simply")

| Job | What it does now | Files |
|---|---|---|
| 1 - instance menu | **Right-click** (or the Menu key / Shift+F10 on a focused button) on a rail instance or a Library card, and the instance page's **⋮** button, open ONE menu (`openInstanceMenu`): Play, Open, Rename…, Open folder, Verify files, Move up / Move down / Move to top / Move to bottom, **Delete…** (red, last). The main "Reminth" instance's Delete is shown **off with the line "This is your main instance - it can't be deleted."**; a running instance can't be renamed or deleted ("Close the game first."). Stays inside the window, arrows/Home/End/Enter, Esc gives the focus back, closes on a click outside, scroll, blur or resize. **Rename…** = a name field (normal instances:update). **Delete…** says what goes: "<name> - 2 worlds, 1.4 GB. Everything inside it is deleted for good (worlds, mods, screenshots). There's no undo. Your other instances are not touched." (`instances:summary` in main: worlds = `saves/*/level.dat`, bytes with a 1.5 s cap → "about", links/junctions never followed). After deleting: the last played instance is selected, every list redrawn, "<name> deleted." The old static ⋮ dropdown is gone (its Open folder / Verify files / Delete are in the menu). | `renderer.js`, `pure.js` (`instanceMenuItems`, `summaryText`), `instances.js` (`summary`), `main.js` (`instances:summary`, one shared delete path), `preload.js`, `index.html`, `styles.css` |
| 2 - moving instances | **Drag** a rail instance: it dims, a thin line shows where it lands, Esc or dropping outside the rail cancels, a long rail scrolls by itself at its top/bottom edge; selection and running state never change. The menu's Move up/down/top/bottom do the same (the impossible ones are off). Saved by `instances:reorder` (atomic, registry lock, refused unless the ids are exactly the instances there are - the old order stays); the main instance may move too; new instances still go at the **end**. Library > Instances sorts by **"My order"** by default (the other sorts stay) and shows each instance's size on disk (worked out lazily while Library is open, kept for the session). | `renderer.js` (`railDrag*`, `moveInstance`, `saveInstanceOrder`, Library), `pure.js` (`moveIndex`, `moveItem`, `dropGapToIndex`), `instances.js` (`reorder`, `normalise` keeps the saved order), `main.js`, `preload.js`, `styles.css` |
| 3 - no surprise instances | **One question** before every instance the player didn't ask for in the New instance dialog (`confirmNewInstance`): "Reminth will make a new instance: <name> - Minecraft <v> <loader>. Your other instances are not changed." Create / Cancel - or, when an instance is already on that version and loader, **"Use <that>"** first and "Make a new one" second. Used by server Play's vanilla instance (both of its ways in - before, the "vanilla" choice after the mods question made one without asking). The version picker's new-instance card (prompt 11) shows the same sentence and offers "Use <instance>" there. **No two instances with the same name + version + loader**: " (2)", and the question says so (one rule in `pure.uniqueInstanceName`, used by `instances.create`). **madeFor** (cleaned, max 60 chars, text only): the server's name or "Copy of <instance>", shown under the instance name ("Made for Hypixel" / "Copy of Survival"). **Undo**: a toast button (~10 s) after the version picker made a new instance and its window was closed without playing; main deletes it only if never played and no world in `saves/`. | `renderer.js` (`confirmNewInstance`, `toastWithAction`, `offerUndoCreate`, madeFor line), `features.js` (server Play, picker), `pure.js` (`createSentence`, `reusableInstance`, `uniqueInstanceName`), `instances.js` (`madeFor`, `cleanMadeFor`, `undoAllowed`), `main.js` (`instances:undoCreate`, madeFor on copies), `index.html` (toast button), `styles.css` |

Tests: `test/instance-menu.test.js` (new, 8): menu items for a normal / main / running / first / last instance,
moves and drag gaps, summary text, the creation sentence and reuse, `cleanMadeFor` / `uniqueName` / `undoAllowed`,
`reorder` round trip through the registry file + refusals + new-at-the-end + the main instance moving, `summary` on a
temp folder (worlds, bytes, a junction not followed, the time cap), and an **audit of every `createInstance` /
`copyInstanceToVersion` call** in the renderer (each must be in the New instance dialog, the picker, or a function
that asks `confirmNewInstance`). `test/perf-profiles.test.js` (+1): `instances:undoCreate` on a fake Electron.
Clicked through in headless Chromium: right-click menus (rail, Library, ⋮), keyboard, Move to top, Shift+F10,
the delete numbers, drag with the line, "My order" with sizes, the question with and without an instance to use,
Undo and its call, "Made for".

### Prompt 11 ("I pick a version and some mods still don't fit… stop creating me a million instances")

| Job | What it does now | Files |
|---|---|---|
| 1 - say what happens first | The version list is ranked by the fewest mods without a build, then the newest (versions a checked server takes first). **Best 5** shown, "Show more versions" for the rest. A green line on top: "Best match: 1.21.1 — all 29 mods fit" or "Fits most: 1.21.4 — 3 mods have to be turned off". For the version picked (and again on the confirm step) every mod sits in one plain group: **Will work (N)**, **No build for <v> (N)** "They can't work with the rest on <v>, so they will be turned off (you can turn them on again)" / "…left out of the copy", **Not from Modrinth, Reminth can't check these (N)** "kept as they are, unless the file itself says it can't run on <v> — then it is turned off" / "left out of the copy", **Couldn't be checked just now (N)**. Lists of more than 6 names are collapsed. A one-line help text says what a "build" is. The advisor now counts **stable** versions only (a beta-only mod is "No build", because the switch never installs a beta). | `pure.js` (`rankVersionRows`, `bestLine`, `modGroups`, `compareMc`), `features.js` (`openVersionAdvisor`), `compat.js` (`supportedReleases` stableOnly for the advisor), `styles.css` |
| 2 - two clear choices | The confirm step has two radio cards: **"Switch this instance to <v>"** ("Your mods are updated to fit. Mods with no build for <v> are turned off (you can turn them on again). Your worlds stay. A backup of every replaced mod is kept.") and **"Keep this one as it is and make a new instance on <v>"** ("Nothing here changes. It uses more disk space; worlds are not copied."). Recommended: switch for the same or a newer version; a new instance is the only choice (with one plain sentence why) for an **older version while the instance has worlds**, a **modpack** instance, or a **running** game. The new-instance card says "Reminth will make a new instance: <name> — Minecraft <v> <loader>. Your other instances are not changed.", never repeats an existing name (" (2)"), and offers **"Use <instance>"** when one is already on that version and loader. A server that started the flow still joins afterwards in both cases. **Switch** runs in the main process (`compat:switchVersion` → `versionSwitch.js`): checks (running, modpack, vanilla, same version, older-over-worlds), which mods have no stable build there + the loader version (any failure: nothing changed), `.reminth/version-change.json` (atomic), the instance update (registry queue), the stable-only swap (modsSync, replaced-mods backup), every mod still without a build **renamed to .disabled** (never deleted) with its reason; a failure after the update comes back as "…is now on Minecraft <v>, but updating its mods stopped: … Press 'Update mods to fit <v>' to finish." with the note kept. | `versionSwitch.js` (new), `main.js`, `preload.js`, `compat.js` (`adviseVersions` `target`: files of the mods without a build), `content.js` (`setOffReason`), `pure.js` (`versionChoices`), `features.js` |
| 3 - result screen | Same window: "Done — <instance> is on Minecraft <v>." with **Updated (N)**, **Already fitting (N)**, **Turned off (N)** (each: name, the reason in plain words — "no version made for 26.3" / "no finished (stable) version made for 26.3 yet" / "its own file says it can't run on 26.3" — and **Find a replacement** (Discover's mod search with that name, this instance selected) + **Turn on anyway** (the game may not start)), **Not checked (N)**. One big **Play** (or "Play <server>"), a small Close. The Mods tab's Off group shows "Turned off by Reminth: <reason>" under those mods; the reason is kept in `.reminth/content.json` (`turnedOff`, atomic, locked) and dropped when the player turns the mod on or removes it. | `features.js`, `content.js` (`setEnabled`/`remove` clear it, `listAll` gives `offReason`), `styles.css` |
| 4 - plain words | Dialog: **"Pick a Minecraft version for my mods"**, with an intro line ("See what happens to each of your mods on another Minecraft version. Nothing changes until you confirm."). Buttons: **"Pick a version that fits my mods"** (Mods panel, the "no build" window, the "No build yet" window) and the Mods toolbar's **"Pick a version"** (was "Version check"). The "no build" window and the What's new line rewritten; "Reminth-managed" badge → "Added by Reminth". The Play question ("Minecraft won't start like this") adds one line naming mods with no version for this Minecraft **or anything newer**: "picking another version won't help them — they have to be turned off to play (Fix and play does that)". | `features.js`, `renderer.js` (What's new), `index.html`, `styles.css` |

Tests: `test/version-flow.test.js` (new, 9): ranking/best line (perfect, partial, none, server), the groups per
action, the choices (newer/older/same × worlds × modpack × running), `switchVersion` with stubs for each failure
point (no loader build, update fails, swap stops half way) checking that every file is still there, and the
turned-off reasons (set, cleared on enable/remove, on disk). Clicked through in headless Chromium with a fake main
process: list + best line + groups + "Show more", both choice cards for a newer and an older-with-worlds version,
the switch call, the result screen, "Turn on anyway", "Find a replacement" landing on Discover with the name, the
Off-group reason, the Play-gate line, the renamed buttons.

### Prompt 9 ("may not work" mods crash the game - AppleSkin for 26.3 on 26.2)

**Why the panel said "may not work" but nothing acted on it:** compat's `judgeMod` only warned "listed for
Minecraft X, not Y" when the jar's own `fabric.mod.json` didn't settle it. A build whose own range lets 26.2
load it but that Modrinth lists ONLY for newer versions (26.3) was let through - that is exactly the
AppleSkin crash (code compiled against 26.3 asks 26.2 for a field it doesn't have, on the first HUD draw).
Such a build is now a "may not work" warning too. The old rule stays for builds listed only for OLDER
versions with a range that reaches forward (the existing test is unchanged).

| Job | What it does now | Files |
|---|---|---|
| A - fit button | Every "listed for another Minecraft version" warning is marked (`listedElsewhere`) and counts for **"Update mods to fit 26.2 (N)"**, the edit notice and the one-click swap: same stable-only `planSync` path, same `.reminth/replaced-mods` copy, same "No 26.2 build yet" list (switch off / advisor / leave) when there is no stable build of exactly this version + loader - never deleted. The panel's "Fix all" already applied these mods' own (stable-filtered) "Switch to" fixes. Reminth's own jars still never reported or touched. `planSync`/`applySync`/`mods:sync` take an optional file list. | `compat.js` (`judgeMod`, `builtForNewerOnly`, `modSetOf`), `modsSync.js` (`syncCandidates`, `files` option), `main.js`, `preload.js`, `features.js` (`syncCount`, notice text) |
| B - Play warning | When there are no blocked mods but "may not work (built for another version)" ones, Play from **every** entry (instance page, Home hero, Home cards - all go through `compatBeforePlay`) shows **"These mods may crash the game"**: "N mods are built for another Minecraft version and may crash the game: <names>", the rows, a **"Don't ask again for this instance"** tick box, and Cancel / Play anyway / Fix and play. Play anyway remembers nothing. The tick (with Play anyway) stores the fingerprint of the switched-on mods (`skipModWarning`, instance registry, atomic write); `compat:check` drops it as soon as the mods differ. Fix and play = the fit swap for just those files; mods without a stable build are named and the dialog stays open (Play anyway / Cancel). Blocked mods keep "Minecraft won't start like this" and win when both kinds exist. | `pure.js` (`modWarning`, `riskyText`), `features.js` (`riskyBeforePlay`), `instances.js` (`skipModWarning`), `main.js` (`compat:skipModWarning`, clearing in `compat:check`), `preload.js`, `styles.css` (`.gate-skip`) |
| C - after a crash | On every game exit main.js reads the **newest crash report written since that launch**, only from `<instance>/crash-reports`, never through a link, first 512 KB, nothing in it used as a path. `crashReport.js` parses Description, the error line and the first stack frames (until "A detailed walkthrough") and names a mod only when exactly one matches: a frame in a package that mod's own code uses (content.js now reads `packages` from `fabric.mod.json` entrypoints + mixin configs' `package`), a Forge/NeoForge frame `TRANSFORMER/<modid>@…/`, a Mixin handler `handler$…$<modid>$…`, or a Mixin error "from mod <id>". Two mods tied, Fabric API / loader / one of Reminth's own jars on top, or no match → nothing is said. The finding goes to `.reminth/crash-finding.json` (atomic; ignored once that jar changes; a report already told isn't told again; a clean exit (code 0, no new report) forgets it). The panel shows the mod as **"Crashed the game"** with its fix; the window gets a toast and a dismissible notice on the instance page: "The game crashed in AppleSkin (appleskin-fabric-mc26.3-3.0.10.jar). It is built for Minecraft 26.3 and this instance is on 26.2." with **Fix it** (the stable swap for that one mod, when the check has a stable build) or **Switch it off**. | `crashReport.js` (new), `content.js` (`modPackages`, `packageOfClass`), `compat.js` (crash finding → issue, `managedNames` exported), `main.js` (`noteCrashReport` from the exit handler), `preload.js` (`onCrashCulprit`), `features.js` (`compatTag`, crash notice), `index.html` (`#instCrashNotice`) |

Tests: `test/may-not-work.test.js` (new, 15): AppleSkin-shaped real jar (outer jar listed for 26.3, range
`>=1.21.9` that 26.2 satisfies) through `checkInstance`, the fit plan (stable swap, beta-only → "no build",
only-some-files), the Play rule and sentence, the registry field, the parser on the real report + a Mixin
error + no mod frames + a cut-off file, ties / Fabric API / Reminth's jars / Forge frames, the report finder
(older, too big, a link), the "Crashed the game" issue. `test/perf-profiles.test.js` (+2, real main.js on a
fake Electron): the "don't ask again" IPC and its clearing; a crash report after a game exit → finding written
and `play:crashCulprit` sent, a clean exit forgets it. All existing tests unchanged.
Clicked through in headless Chromium with a fake main process: button count includes the "may not work" mods,
the Play dialog (text, tick, buttons, "don't ask again" honoured for the same mods and asked again when they
change), the crash toast + notice + "Crashed the game" tag, Fix it calls the one-file swap.

### Prompt 8 (Home stat cards)

The five Home stat cards (Mob kills, Player kills, Deaths, Blocks placed, Blocks broken) lost their thin
coloured strip on the left edge (`.stat::before`, drawn from `--sc`). Kept: numbers, labels, notes, size and
the soft corner glow (`.stat::after`). New: the same hover outline as the "Jump back in" cards - border colour
becomes accent at 28% on hover and on focus-within, `.16s`, no movement, no shadow, no scale. `.recent` itself
is untouched. `.stat`, `.s-*` and `--sc` are used nowhere else (searched CSS, HTML, all renderer JS: Player
Statistics page, streamer page and bar lists don't use them), so nothing needed scoping. Only
`src/renderer/styles.css` changed (LF in git; the last rule is still last). Checked in headless Chromium:
`::before` is gone, `::after` glow still there, transition `border-color 0.16s`, hover border = accent 28%.

### Prompt 7 (Settings > Check for updates showed the wrong number)

The packaged 1.4.0 said "You're on the latest version (1.1.1)": the up-to-date state carried the newest
version in GitHub's feed (the only published release is 1.1.1). Now it carries the **running** version
(`app.getVersion()`), whatever the feed says (newer → still "Downloading <new>…" as before; equal, older or
missing → "You're on the latest version (<running>)"). The feed's number is kept as `feedVersion` (not shown,
for diagnostics; the updater log still writes it). Settings now prefers `currentVersion`. Every other state
and message is unchanged.

| Files | |
|---|---|
| `src/main/updater.js` | `update-not-available` → `version: app.getVersion()`, `feedVersion` |
| `src/renderer/renderer.js` | the "up-to-date" Settings line prefers `currentVersion` |
| `test/updater.test.js` | +2 tests: feed equal / older / missing / no version → running version; feed newer → downloading the new one |

### Prompt 6 (window still small after a fullscreen game)

The desktop window measured it: at game **start** Windows shrinks Reminth's window to 800x552 but leaves it
flagged maximized (IsZoomed TRUE, `isMaximized()` true, title bar shows "restore"), so prompt 5's fix
never acted. Now, once no game runs (game end, or the window's focus/restore), a window that was maximized
when the game started, still says maximized, but doesn't fill its display's work area
(`screen.getDisplayMatching(bounds).workArea`; full = width and height at least work area + 16 - 24 px) is
**unmaximized then maximized**, then `window:maximized` true is sent. Once per game end (the snapshot is
dropped before anything runs, and `repaired` blocks a second go). Also applied after a "launch minimized"
window is restored, since that comes back flagged maximized too. One line goes to
`%APPDATA%\Reminth\main-errors.log`: `window: After a game the window said maximized but was 816x568;
repaired to 1936x1048.` (sizes are the outer rectangle, so 816x568 = the 800x552 client area).

| Files | |
|---|---|
| `src/main/windowRestore.js` | `fillsWorkArea(bounds, workArea)` (new, pure), `afterGame` takes `boundsFillWorkArea` + `repaired`, new action `"repair"` |
| `src/main/main.js` | `windowNow()`, `restoreWindowAfterGame()` runs the repair and logs it |
| `test/window-restore.test.js` | +5 tests (12 now): bounds rule, repair / full / not maximized / game running / already repaired |
| `test/perf-profiles.test.js` | fake window gets `getBounds`, fake screen `getDisplayMatching`; 3 more scenarios through the real main.js (repair + log line + only once; full = nothing; launch-minimized + small) |

### Prompt 5 (two bugs the desktop window found)

| Bug | Fix | Files |
|---|---|---|
| 1 Home hero stayed on the old instance after starting another | `startGame` now **awaits** saving `lastPlayed` (a failed save still starts the game) and only then sends `play:started` (now with `startedAt`); if the game already ended during the save, no `play:started` is sent. The page marks the instance played at once (`pure.markPlayed`), re-renders the hero, then still reloads the list. | `main.js`, `renderer.js` (`onPlayStarted`), `pure.js`, `test/home-play.test.js`, `test/perf-profiles.test.js` |
| 2 Window not maximized after a fullscreen game | At launch main.js remembers `{ wasMaximized, minimizedByUs }` (first game wins if several run). When the last game ends, and on the window's `focus`/`restore` events, `windowRestore.afterGame` decides: **wait** while any game runs; a self-minimized window ("launch minimized") is restored - maximized if it was; a window the player minimized is left alone until they bring it back, then maximized; a window that wasn't maximized is never touched. `window:maximized` is sent after. | `main.js`, `src/main/windowRestore.js` (new), `test/window-restore.test.js` (new, 7), `test/perf-profiles.test.js` |

### Prompt 4

| Step | What it does now | Files |
|---|---|---|
| Job 0 - Play on Home cards | The Play button sits inside the card's text strip (name/meta left, Play right), no longer floating over the picture. Meta capped at 2 lines; all cards the same height. | `renderer.js` (`recentCard`), `styles.css` |
| Description renderer | New pure module. Markdown + the HTML Modrinth authors use (headings, bold/italic/strike, code, quotes, lists + task lists, tables with alignment, `<details>`, `<center>`, `<br>`, `<img>`, `<a>`, `<iframe>`) → a tree of plain objects → DOM with `createElement`/`textContent` only (**no innerHTML anywhere**). Links: https only, no user:password, no backslashes, max 2048 chars; `/path` → modrinth.com; a link whose text shows another host gets "(real host)" next to it. Pictures: only `cdn.modrinth.com` and `avatars.githubusercontent.com`, everything else → **"Image hosted elsewhere"** box with an "Open in browser" link. YouTube/Vimeo embeds → a "Video" link card. Caps: 200 KB of text (then "Read the rest on Modrinth"), depth 8, 20 000 nodes, tables 200x20, 1000 list items, **120 ms** parse time. | `src/renderer/markdown.js` (new), `test/markdown.test.js` (new, 22 tests) |
| One IPC for the page | `catalog:projectPage` returns project + people + versions + the parsed description in one answer. Cached 5 min (by slug and id, 30 projects), failures never cached, ids checked. Team/organisation and the version list are best effort (page says when missing). Changelogs kept for the newest 50 builds (20 000 chars each). Goes through `modrinth.js` (its retries and rate-limit waits). **Fixed during testing:** Modrinth ids are case-sensitive; the first version lower-cased them before asking. `link:open` opens a link in the default browser after checking it again in the main process. | `src/main/projectPage.js` (new), `main.js`, `preload.js`, `test/project-page.test.js` (new, 9 tests), `test/perf-profiles.test.js` (+1) |
| Page rules | `fitsInstance` ("Fits your instance X (1.21.4 Fabric)." / "Only a beta build fits..." / "No build for 1.21.4 Forge yet." / vanilla needs a loader / modpacks install as their own instance), `collapseVersions` (300 versions → "1.21–1.21.11", "26.1–26.3", snapshots only counted), `buildConfirmText` (beta/alpha question naming the channel). | `src/renderer/pure.js` |
| The page | Click or Enter on a Discover result opens the page **inside Discover**. Header: icon, title, summary, people with avatars (owner first, or the organisation), downloads, followers, updated, client/server, categories, license (clickable when it has a URL), Install (same paths, same running-instance guard as the cards; mods also get the version chooser). Support card: fit line, loaders, Minecraft ranges. Tabs: **Description** (credit line "Description by the project's author, shown from Modrinth."), **Gallery**, **Versions** (30 at a time + "Show more"; changelog parsed when a row opens; per-row Install, off when the build doesn't fit the instance; beta/alpha ask first, naming the channel), **Links** (source, issues, wiki, Discord, donations, View on Modrinth). **Back / Esc / mouse Back button** return to the results with search, filters, page and scroll exactly as they were (the list is only hidden, never rebuilt). Skeleton while loading, error box with Retry, a late answer for a project you already left is dropped. | `features.js` (section 10 + `projectRow`), `index.html` (`#projectView`, `markdown.js` script), `styles.css` (`pv-*`, `md-*`, before the last rule) |
| Entry from installed mods | Mods/packs rows that Modrinth knows get **"Open project page"** in their ⋮ menu. Back then says "Back to <instance name>" and returns to the instance page. | `features.js` (`rowMenu`, `openProject`/`closeProject`) |

Not added: the suggested-mods window does not open project pages (it's a modal with its own tick list;
opening a page from inside it would need it to close and reopen with its ticks kept - not small).

---

**JEI first-inventory-open stutter (owner report, 4 Oct; fixed for him by switching JEI off).** Measured with the test mod opening the inventory by itself 3/8/15/25 s after joining, JEI 30.39 on vs off, owner's 32 mods, singleplayer: worst frame in the 4 s after opening = 52-59 ms with JEI, 35-50 ms without. So JEI costs about ONE extra 40-60 ms frame here, not the ~1 s the owner feels; the one-second hitch was NOT reproduced (the test has no server, no full real inventory). Nothing to fix from Reminth's side found. Next step if it matters: ask the owner whether the hitch also happens 30 s after joining (then it's not start-up work).


**JEI freeze - found and fixed in ReminthHUD 1.2.0+ (4 Oct).** JEI loads all recipes on the RENDER thread ("Starting JEI took 1.2-1.6 s" in latest.log) and starts when the server's recipe-update packet arrives (JeiLifecycleEvents.AFTER_RECIPES_UPDATED, fired by JEI's own mixin). Servers that don't send it (probably DonutSMP) leave JEI waiting for the first AbstractContainerScreen (ClientLifecycleHandler's ScreenEvents.AfterInit fallback) = the first inventory open. `JeiEarlyStart.java` fires that same event 30 ticks after joining if no recipe update came (JEI reached by reflection, no dependency; `jeiEarlyStart:false` in config/reminthhud.json turns it off). Verified: singleplayer = JEI starts once by itself, the helper stays out; forced test run = helper fires, JEI starts ("started JEI early"). NOT verified on a real server: owner's first-inventory-open on DonutSMP is the test (step B5). JEI's "Show Tag Recipes" setting does NOT shorten the start-up (1.46-1.57 s off vs 1.54-1.60 s on).

**HUD 1.2.2 (4 Oct, owner feedback on 1.2.1): NO coordinates/facing at all (a player may need to hide them; the `coords` option is gone), greys instead of white (labels A8A8A8, values E4E4E4), and NO drop shadow (the shadow at 0.75 scale made letters look black-and-white). The NVIDIA/other overlay is not ours and cannot be hidden by Reminth - the owner turns it off in the NVIDIA app. Earlier look (1.2.1, reference picture):** plain text, NO background, 75 % size (pose scale), light-grey labels, bold white values, thin `|` separators, coordinates + facing as a second line in the same style, all top-right. Seen in the real game (26.2).


**Games that outlive Reminth (owner bug, 4 Oct; fixed in 1.4.6).** The game is launched detached and keeps running when Reminth closes/restarts/updates, but `running` in main.js is memory only: a fresh Reminth said 'not running' and Play started a SECOND copy on the same worlds. `src/main/runningGames.js` lists Java processes (PowerShell Get-CimInstance, ~1 s), reads only `--gameDir` from the command line (it holds the access token: never logged/stored/returned), matches instances by folder, and `adoptProcess` (main.js) puts the game back in `running` (Stop, the mods lock and play time work; time counts from the process's own start when it ends). Done once at start-up (`adoptRunningGames`, after the page loaded); a Play pressed in the first second waits for it (`adoptionDone`) and a game found replaces a Play that is only just starting. Verified: 591 tests incl. a real javaw found by folder; isolated Electron started AFTER a stand-in game -> instance shows running within 6 s, back to not running when the process ends. NOT covered: a game started outside Reminth by hand with the same folder is adopted too (intended).


**Privacy policy v7 (4 Oct, written by the desktop window).** `site/privacy.html` + the in-app summary (`index.html`) now describe: the running-Java scan (only pid / start time / --gameDir; the token in the command line is never read), ReminthHUD and `config/reminthhud.json`, `hud-on-by-default.json`, Boost FPS and `.reminth\options-before-boost.json`, the early JEI start, and the installer moving to `%LOCALAPPDATA%\Programs/reminth-launcher`. The owner's name/country in the policy were NOT touched (his instruction). **The `site/` folder must be re-uploaded to Cloudflare for the website to show v7.** Terms stay at v6 (no change needed).


**ReminthHUD for Minecraft 1.21.1 (4 Oct, `hud-1.21/`, jar `assets/mods/reminthhud-1.2.2+1.21.1.jar`; NOT yet in a release).** Same bar and same JEI early start as the 26.x mod, ported to the older obfuscated game: Loom remapping plugin + Mojang mappings, `GuiGraphics`/`HudRenderCallback`, Java 21. The GPU number uses JNA (shipped with Minecraft) because Java's foreign-function API is only a preview feature on Java 21. Seen in the real game (1.21.1, Fabric API 0.116.17): `FPS 872 | GPU 22% | CPU 2% | LAT 0 ms` top-right, no errors from the mod; with JEI 19.51 the early-start event exists and fired in the forced test. One folder = one Minecraft version; 1.21.4 and others still to do (each needs its own port). Reminth picks the jar by the `minecraft` range: 1.21.1 -> this one, 1.21/1.21.4/1.20.1 -> none.


**ReminthHUD on 1.20.1 and 1.21.x (4 Oct, `hud-1.21/`, build with `hud-1.21/build-all.ps1`).** One shared source plus a tiny `compat/<A..E>/` layer per game-code family (A = 1.21-1.21.5 PoseStack + text key category; B = 1.21.6-1.21.8 Matrix3x2fStack; C = 1.21.9-1.21.10 key-category object (ResourceLocation); D = 1.21.11 Identifier; E = 1.20.1, Java 17). Every jar was started in the REAL game through Reminth's own launch(), fake offline account, throwaway world, 1600x900 window: 1.20.1, 1.21, 1.21.1, 1.21.4, 1.21.5, 1.21.6, 1.21.8, 1.21.9, 1.21.10, 1.21.11 all load the mod and reach a world with no error naming the mod; pictures of the bar were taken on 1.20.1, 1.21, 1.21.1, 1.21.4, 1.21.8, 1.21.10 and 1.21.11 (FPS/GPU/CPU/LAT drawn top right; GPU works on Java 17 and 21 through JNA). JEI's early start fired in the game on 1.20.1, 1.21.1 and 1.21.11 (JEI has no Fabric build for 1.21.4/1.21.8, so nothing to fix there). Ranges the jars declare: 1.20.1 | 1.21-1.21.1 | 1.21.4 | 1.21.5 | 1.21.6-1.21.8 | 1.21.9-1.21.10 | 1.21.11 (26.2 / 26.3 as before). Weak spot: the grey labels are hard to read against a bright sky (no shadow, as the owner asked); an optional faint backdrop is an owner decision (H1).

**Unreleased (committed, not in 1.4.3):** ReminthHUD is switched on once for every Fabric/Quilt instance (`src/main/hudDefault.js`, marker `hud-on-by-default.json` in %APPDATA%\Reminth). Needs a release (1.4.4, built, together with HUD 1.2.0 and the JEI early start).

## 2. Decisions the owner must make (recommendation first)

P17-1. **A `reminth://skins` link that comes while a game runs only flashes Reminth's taskbar button.** The prompt said
   never to take focus from a running game, so that's what it does. But the Skins button is pressed *in the game*,
   on its title screen, so a game is always running then. As built, the player sees the taskbar flash and has to
   Alt-Tab. **Recommend: for a link, bring Reminth to the front even while a game runs** (the player just asked for
   it, and the game is on its title screen, not in a world). It's a one-line change in `main.js`
   `bringForward`. Decide after P17-3 below.
P17-2. **The home screen is ON by default for modpack instances too** (plan section 8.1 says every Fabric/Quilt
   instance). A modpack may bring its own title-screen mod (FancyMenu and the like), and two title screens can clash.
   **Recommend: default OFF for instances made from a modpack** (a missing value = off when `instance.modpack` is set).
   It's one line in `config.bundledModWanted`, plus a test.
P17-3. **The ReminthHUD switch still writes `hud: false` when the dialog is saved on a version with no HUD build**
   (old behaviour, kept exactly as the prompt asked). Example: edit a 1.20.1 instance that had the HUD on and save →
   the HUD is off for good, even after a build for it ships. The home switch doesn't do this. **Recommend: make the
   HUD behave like the home switch** (send `hud` only when the switch could be used). It's small; it's a separate
   change.
P17-4. **Privacy text:** the two sentences in section 0 (Prompt 17). **Recommend: add them before the first release
   that registers `reminth://`** (the next one, since the scheme is in `package.json` now).

A16-D1. **Captures folder on OneDrive PCs.** Reminth saves clips and screenshots in `%USERPROFILE%\Videos\Reminth`,
   even when Windows' Videos folder is really `OneDrive\Videos`. **Recommend: leave it for now.** If players ask
   "where are my clips", change it then, and keep listing the old folder too so no capture disappears from the
   Captures page.
A16-D2. **Data folder on PCs with redirected AppData** (school or work PCs). **Recommend: leave it.** Moving every
   player's data for a rare case isn't worth the risk.

D1. **No more install-folder chooser** (one-click per-user installer). It's the price of no admin prompt; every
   big launcher (Modrinth App, Discord, VS Code user setup) does the same. **Recommend: keep.**
D2. **Boost FPS changes 5 video settings on the owner's instance and can make the view shorter** (16 → 12
   chunks). It only happens on his click, after the list, with undo. **Recommend: keep 12** (servers usually
   send 8-12 chunks anyway); see the outdoor numbers in section 1 for 10 vs 12.
D3. **Not added to the performance pack: More Culling + BadOptimizations** unless the outdoor numbers in
   section 1 show a clear gain; they stay as Max-FPS "extras" the player ticks. **Recommend: follow the numbers.**
D4. **Xaero's Minimap costs the owner ~15 % FPS** in the indoor test. It's his mod; Reminth says nothing about
   it. **Recommend: tell him, change nothing.**
D5. **Privacy text: no new sentence.** The HUD reads Windows' own CPU/GPU counters inside the game and sends
   nothing; Boost FPS edits a local file.

P13-1. **The in-dialog "Update mods to fit" can open the usual "No <v> build yet" window on top of the picker** when
   some mods have no stable build (same as the yellow button). **Recommend: keep** - one behaviour everywhere.

P12-1. **The lifetime counter can't be changed from the page** (no reset button, a settings save ignores it).
   If the owner wants a "Reset" later, it's one store function. **Recommend: keep** (it's the "official" total).
P12-2. **The picker's confirm step waits for the exact preview before Switch can be pressed** (a few seconds on a
   big instance) - the price of the promise always matching the result. **Recommend: keep.**
P12-3. **Privacy text: no new sentence.** The counter is a number in settings.json on the PC; the preview uses the
   same Modrinth lookups already listed.

P10-1. **Undo is offered only after the version picker made a new instance and was closed without playing.**
   A server's instance is played straight away (Play sets "last played"), so Undo can never apply there - its
   menu has Delete. **Recommend: keep.**
P10-2. **Installing a modpack doesn't get the extra question**: the player pressed Install on a modpack, which is
   asking for a new instance. It does get " (2)" for a repeated name. **Recommend: keep.**
P10-3. **The ⋮ button on the instance page now opens the same menu as a right-click** (Play, Rename, Move…, Delete
   …); Verify files and Open folder moved into it. **Recommend: keep** (one menu everywhere).
P10-4. **Library's default sort is "My order"** for players who never picked one; anyone who chose another sort
   keeps it. **Recommend: keep.**

P11-1. **Switching turns off EVERY mod the dialog listed under "No build for <v>"** - also one whose own file
   claims it would still load (the dialog promised it, and those are the ones that crash later). **Recommend:
   keep**; "Turn on anyway" is one click per mod on the result screen and in the Mods tab.
P11-2. **The advisor now counts stable versions only.** A mod with only a beta for <v> is "No build for <v>" and
   gets turned off by a switch (it was "fits" before, then left out by the copy anyway). **Recommend: keep** -
   matches the "never a beta without asking" rule.
P11-3. **Switching to an OLDER version is allowed when the instance has no worlds** (the prompt only forbade it
   with worlds); the main process counts `saves/*/level.dat` again before changing anything. **Recommend: keep.**
P11-4. **The Mods toolbar keeps a "Pick a version" button** (renamed from "Version check") next to the panel's
   button: it's the only way in when the panel isn't showing (no problems). **Recommend: keep.**
P11-6. **A switch that stopped half way is finished with "Update mods to fit"**, not undone automatically.
   `.reminth/version-change.json` keeps the old version and loader version for a manual undo; there is no
   "Undo switch" button. **Recommend: keep for now**; add one later if testers hit it.

P9-1. **A build listed only for NEWER Minecraft versions is now "may not work" even when its own file says it
   fits** (this is what makes AppleSkin show up and get swapped). It can also flag a mod that really works
   (a loose range that happens to be right). It is only a warning plus a stable swap - never blocked, never
   removed. **Recommend: keep** - the crash showed the jar's own range can't be trusted in that direction.
P9-2. **"Don't ask again" is stored only when ticked AND Play anyway is pressed** (Cancel or Fix and play
   with the tick ignore it - after a fix the mods are different anyway). **Recommend: keep.**
P9-3. **The quick check can't see these warnings.** When the full check hasn't answered within 2.5 s at
   Play (a big instance's first check), the jar-only quick check decides, and it doesn't know what Modrinth
   lists - so the "may crash" question is skipped that one time. Blocked mods are still caught. **Recommend:
   keep** (Play is never held up longer); the panel and button show them as soon as the full check ends.
P9-4. **Privacy text: no new sentence needed.** Crash reports and mod files are read on the PC only;
   nothing new is sent anywhere (the Modrinth lookups are the ones already listed).

0. **New: with "launch minimized" on, Reminth now comes back on screen when the game ends** (prompt 5
   asked for this: "restore it to what it was when the game ends"). Before, it stayed minimized in the
   taskbar. **Recommend: keep** - it's what the prompt asked; if the owner dislikes the window popping up
   after quitting a game, the one place to change is `windowRestore.afterGame` (return "wait" for the
   `minimizedByUs` case).

2. **Description parsing happens in the main process** (prompt said "renderer"): a huge description costs
   the main process up to 120 ms once per 5 minutes per project, never the window. **Recommend: keep.**
3. **Relative links (`/mod/sodium`) go to modrinth.com** (that's where Modrinth itself sends them).
   **Recommend: keep.**
4. **Per-version Install is off when that build doesn't fit the instance Discover shows** (instead of
   offering to install a wrong-version jar). **Recommend: keep.**
5. Still open from prompt 3 (unchanged): no page
   fade on Skins (**keep if 33 shows it faster**); Mods-tab delete text says Recycle Bin (**keep**); world
   open on old versions just starts the instance (**keep**); shader install needing Iris refused while
   running (**keep**); unsigned installer (nothing to do).

Closed: Home "Time played" = the lifetime total across every instance (owner, prompt 12); prompt 11's "send prompt 10 next" (done); privacy text for project-page pictures and links (made by the desktop window in `194863c`; re-upload
`site/` with the release); privacy text for copies + game report; tied versions stay warnings; all replaced jars copied;
Forge/NeoForge pack ON for new instances; profile on never-played instance writes options.txt;
wrong-loader mods count for "Update mods to fit"; six extra-mod slugs.

---

## 3. Known weak spots (say them, don't hide them)

- **Prompt 17:**
  - Nothing of it ran in real Electron or on Windows.
  - The real `second-instance` argv on Windows is assumed to contain the link as its own argument (Electron's
    documented behaviour). Chromium adds its own switches, and the parser ignores those.
  - If another program claimed `reminth://` (a dev build, or an old install in Program Files), Windows may start
    that one instead.
  - The compatibility check doesn't know the home screen can bring Fabric API (only the HUD and the pack count). If
    the home jar needs Fabric API on an instance with the HUD and the pack off, the check may still say a player's
    mod is "missing Fabric API". The next Play installs it anyway.
  - A bundled jar is recognised by its file prefix and its `fabric.mod.json` range only. Its mod id isn't checked.
  - The home switch sits in the left half of its own row in the dialog (the grid is two columns). Fine in Chromium
    at 1100 px; not seen in Electron.
  - A link while signed out just shows Home (the sign-in card). That's intended: a link never gets round the
    sign-in.

- **Audit 16:** the suspected but unfixed problems are in section 0b (b), most likely first. The new screen-size rule
  (fix 11) is untested on a real scaled screen; a frameless window as big as the whole work area may open looking
  maximized (that's what the old 85 % rule avoided). It opens maximized anyway, so it should look the same.
- **Desktop batch (3 Oct evening):** the migration away from `C:\Program Files\Reminth` has not run for real
  (R2). If the owner says No to the one Windows prompt, the old copy and its public shortcut stay, and starting
  Reminth from that shortcut runs the old version, which updates itself again (asks again). Pinned taskbar
  icons point at the old path and break once it's removed - pin again.
- Boost FPS's dialog was never clicked in Electron (only unit tests on real files and the owner's real
  options.txt read-only). The HUD on 26.3 was compiled but not run in a game.
- FPS numbers were taken with Roblox and Medal running; no clean-PC number exists. The 350 FPS target was not
  measured on the owner's real setup (fullscreen, his server).

- **Prompt 12 never ran in Electron.** The counter was tested on a throwaway settings.json and through main.js on
  a fake Electron (a session's end adds to it and tells the page); the picker parts in headless Chromium.
- The lifetime counter starts from the instances' recorded time on first start: time from instances deleted
  BEFORE this version can't be recovered (it was never stored anywhere else).
- The confirm step's preview asks Modrinth again; the switch a moment later asks too. If Modrinth's answer changes
  in between (a mod releases a build that minute), the two can differ - the result screen always shows what
  really happened.

- **Prompt 11 never ran in Electron or against real Modrinth.** `switchVersion` was tested with stubs for
  Modrinth, the loader lookup and the registry, on real files; the dialog with a fake main process.
- The switch asks Modrinth twice (the advisor lookup for the target, then the swap's own check). Both are cached
  for minutes, but on a slow connection a 29-mod switch can take a while - not timed.
- "Turn on anyway" on the result screen assumes the file is `<name>.disabled` (what the switch just made); if
  the player renamed it meanwhile it says the file isn't there.
- **Prompt 10 never ran in Electron.** Drag and drop was driven with a mouse in headless Chromium (3 instances);
  30 instances and the edge auto-scroll were not tried. Right-click on Windows (and the Menu key on a real
  keyboard) not tried.
- The delete question's numbers come from a walk of the folder capped at 1.5 s - a huge instance says "about".
- Undo deletes for good (like Delete); it is only offered for an instance that was never played and has no world.

- **Prompt 9 never met a real crash or real Modrinth.** The crash parser was tested on the report text from
  the prompt (head only) and made-up Mixin / Forge shapes; real reports from other mods may name nobody
  (by design: no match → nothing said). Mods whose code isn't in an entrypoint or mixin package (pure
  libraries, Kotlin objects, some Forge mods - Forge jars aren't read for packages, only Forge frames that
  name their mod) can't be named.
- AppleSkin's real `fabric.mod.json` range wasn't checked (no network here). If it declares a range that
  EXCLUDES 26.2 it was already "won't load" (blocked) and the old button handled it; the prompt says the panel
  showed "may not work", which this covers either way.
- A game that crashes and is restarted within 2 s of the report could see the same report twice - handled by
  remembering the report name in the finding.

- **The window repair (prompt 6) has never run on Windows.** It follows the measured state exactly and the
  repair the desktop window did by hand (unmaximize + maximize), but if Windows reports the small window's
  bounds differently from `GetWindowRect` the size check could miss it - the log line shows whether it ran.
  On a second monitor the work area of the monitor the window is on is used. `win.restore()`/`maximize()` after a game may bring
  Reminth to the front - intended, untested.
- The window snapshot is taken when the game process is spawned. If Windows changed the window before
  that (it shouldn't - the game has no window yet), the snapshot would be wrong.

- **Nothing of prompt 4 has met real Modrinth.** Real descriptions use HTML in ways the tests may not cover
  (nested tables, `<p align>`, odd entity use). Worst case is ugly text, never script: the parser can only
  produce the node types listed above.
- A description that is one giant table or thousands of images: capped, but the page has not been timed
  on a slow PC.
- Version list: up to 3000 builds are sent in one answer (~a few hundred KB for the biggest projects like
  Fabric API); not measured.
- Back to an instance page restores its scroll right away, but the mod list reloads, so the position can
  be off by a little.
- The "Fits your instance" line uses the instance Discover is showing; per-row Install fixes the target at
  the click.
- From before: no FPS number ever measured; Skins speed-up unmeasured; world-direct-open and IPv6 joins
  never tried in a real game; "Last played" written at launch; safe mode misses `javaw` dialogs; the update
  path has never seen a real release.

---

## 4. Test plan for the desktop window (in order)

### Prompt 17 first (do these before the Audit 16 list below)
P17-1. **HUD unchanged:** on the installed 1.4.x, on an instance with the HUD on, press Play. `mods/` gets the same
       `reminthhud-*.jar` as before, and `reminth-performance-mods.log` and the Mods tab look as before. Switch the
       HUD off and press Play: the jar is gone. Switch it on again: back. A Fabric instance with the HUD off and the
       pack off still gets no Fabric API.
P17-2. **No home jar = no change:** with today's `assets/mods` (no `reminthhome-*`), Play a Fabric 26.2 instance.
       Nothing new is in `mods/`, there are no new log lines and no errors. The instance dialog shows "Reminth home
       screen", disabled, with "No Reminth home screen build for 26.2 yet".
P17-3. **Fake home jar:** make a copy of any small Fabric jar for 26.2 whose `fabric.mod.json` says
       `"depends": { "minecraft": "~26.2" }`, and name it `assets/mods/reminthhome-0.0.1+26.2.jar`. Run `npm start`.
       1. The dialog's switch for a 26.2 instance is enabled and ON.
       2. Play: `mods/reminthhome-0.0.1+26.2.jar` is there, `.reminth/managed-mods.json` lists it as
          `{ "mod": "reminthhome" }`, and the Mods tab shows it with "Added by Reminth".
       3. Switch it off, save, and press Play: the jar is gone from `mods/`, and the HUD and the pack are untouched.
       4. Switch it on: it's back.
       5. A 1.21.1 instance: the switch is disabled ("No … build for 1.21.1 yet"), and Play adds nothing.

       Remove the fake jar afterwards.
P17-4. **Links, packaged app** (built and installed per-user):
       1. With Reminth closed, run `start reminth://skins` in cmd. Reminth opens on Skins.
       2. With it already running on Home, run the same command. It comes to the front on Skins.
       3. `start reminth://instance/<an instance id>` opens that instance's page. You can read the id from its
          folder name under `%APPDATA%\Reminth\instances`.
       4. `start reminth://home` opens Home.
       5. `start reminth://../../x`, `start reminth://play/anything`, `start "" "reminth://skins?x=1"` and
          `start REMINTH://skins` do **nothing**: no window comes up, no page changes, no game starts.
P17-5. **Link during a game:** start a game, go to its title screen, and run `start reminth://skins` from cmd. Report
       what you see: by design, only the taskbar button flashes. Then Alt-Tab: Reminth is on Skins. This settles
       decision P17-1.
P17-6. **Registry, no admin:** after the per-user install, `reg query HKCU\Software\Classes\reminth` shows
       `URL Protocol` and a `shell\open\command` pointing at the installed `Reminth.exe` with `"%1"`. No admin
       prompt came up during the install. `HKLM\Software\Classes\reminth` doesn't exist.
P17-7. **Dev run doesn't claim the scheme:** `npm start`, then check that the HKCU `reminth` key still points at the
       installed exe, not at electron.exe.

**Then Audit 16:** do section 0b (c), A16-1 to A16-13, after Basics below. A16-5, A16-8 and A16-13 protect
player files, so they matter most.

Don't touch the screen while the owner plays. Use throwaway instances. Report PASS/FAIL per step with what
you saw; stop and report on any FAIL that risks his files.

### Basics
1. `git pull`, `npm install` if needed, `npm test` → **621 pass**. Report any Windows-only failure verbatim.
   Check `styles.css` still ends with the `background-origin` rule and CRLF files are still CRLF.
2. `npm start`; keep DevTools console and `%APPDATA%\Reminth\main-errors.log` open throughout. Any red line = FAIL.

### Desktop batch, 3 Oct evening (ping, HUD, Boost FPS, updates) - test with 1.4.2
B1. Discover → Servers: the ping badges are lower than before (hypixel ~150, cubecraft ~40 here) and agree within
    a few ms with Minecraft's own multiplayer list for the same server. Hover: "…measured the way Minecraft's own
    server list does".
B2. Instance settings → ReminthHUD on → Play: top-right bar `FPS | GPU % | CPU % | LAT ms`, coordinates line under
    it, nothing over a minimap. GPU roughly matches Task Manager's GPU column. LAT 0 in singleplayer, a real number
    on a server. **H** hides/shows. A potion effect: the bar moves below the icons. `config/reminthhud.json`
    with `"gpu": false` → the GPU item is gone and the bar closes up. F3 open → the HUD hides (F3 shows the
    same). A server with `reducedDebugInfo` → no coordinates line. Same on a 26.3 instance.
B3. Right-click an instance → **Boost FPS…** → the list of from → to; Cancel changes nothing; **Change them** →
    toast; options.txt shows the new values, everything else identical; `.reminth/options-before-boost.json`
    exists. Open again → "already has the fast settings" + **Put my old settings back** → the old values return.
    With the game running: the entry is greyed out with "Close the game first."
B4. While a game runs, the launcher's looping animations (Plus page, progress shimmer) stand still; they move
    again after the game closes.

B6. **Start a game from Reminth, close Reminth (or let it update), open Reminth again while the game still runs**: the instance shows Running within a few seconds, Play is off / says it's already running, Stop works, and playing time is added once when the game closes. Pressing Play right after opening Reminth never starts a second copy.
B5. **JEI (switched ON) on DonutSMP (or another server): join, then open the inventory for the first time** - no freeze. `logs/latest.log` has "ReminthHUD: started JEI early" about 1.5 s after joining, and "Starting JEI took" appears BEFORE the first E. In singleplayer JEI starts by itself and the helper line is absent.

### Release 1.4.2
R1. **Done by the desktop window:** `npm test` (582), bump to 1.4.2, `npm run dist`, check `dist/latest.yml` has no `isAdminRightsRequired`.
R2. **The migration, on the owner's PC, before uploading:** close Reminth, run `dist\Reminth-Setup.exe` by hand →
    a small "Installing" box (no wizard), then Windows asks ONCE (that's the old copy being removed) → Yes →
    Reminth opens from `%LOCALAPPDATA%\Programs\reminth-launcher`; `C:\Program Files\Reminth` is gone; one
    "Reminth" on the desktop and in Start; instances, worlds, sign-in, settings all still there.
R3. Upload the release (installer + `latest.yml` + `.blockmap`).
R4. When 1.4.3 exists: Settings → Check for updates → download → **Restart and update** → no Windows prompt, no
    installer window, Reminth reopens on 1.4.3.

### Prompt 13 (test these first - it blocks 1.4.1)
W1. A throwaway **Fabric 1.21.1** instance holding the mod files of a 26.2 instance (copy its `mods` folder). Open
    its Mods tab (the panel says "N mods will stop Minecraft from starting"; the yellow button shows a number).
    Open **"Pick a version that fits my mods"** → briefly "Checking your installed mods..." (grey) if the check
    hasn't run yet, then the **amber** line "Builds exist for Minecraft 1.21.1 for all your mods, but N of the files
    in this instance are made for another version. Press "Update mods to fit" to swap them." with an
    "Update mods to fit 1.21.1" button inside the dialog. N equals the yellow button's number. The list below is
    titled "Other versions that also fit", no "Best match" badge, no row selected. **The green sentence is NOT shown.**
W2. Press the button inside the dialog → progress, the usual result toast ("Updated N mods…"), and the amber line
    turns into the **green** "Your mods already fit Minecraft 1.21.1 - there is nothing you need to change." The
    yellow button and the Mods panel behind it agree (hidden / no red panel). Mods with no stable build (if any)
    are listed in the "No 1.21.1 build yet" window and the line stays amber without a button.
W3. A **26.2 instance holding 26.2 files** (e.g. the Reminth copy after M2): the green sentence, no amber line.
W4. An instance where some mod has **no build for its own version**: the best-match line and the ranked list as
    before prompt 12 (green "Best match: …" or "Fits most: …").
W5. An instance with a mod that crashed the game last time (M9's finding present): the green sentence is NOT shown.

### Prompt 12 (test these first)
T1. Note Home's **Time played** before installing this build, and the sum of every instance page's time. After the
    update, Home shows that sum (or more), with the tooltip "All your time in Minecraft through Reminth…".
    `%APPDATA%\Reminth\settings.json` has `totalPlayTimeMs`.
T2. Play any instance for ~2 minutes and quit → Home's Time played grows by ~2 minutes without restarting Reminth.
T3. Delete a throwaway instance that has play time → Home's Time played does NOT go down. Restart Reminth → still
    the same (never recomputed).
T4. Two instances running at once for a few minutes, quit both → both sessions are added.
T5. The instance page's own time and Player Statistics show what they showed before (unchanged).
T6. Version picker on an instance whose mods all fit its version (e.g. the Reminth copy on 26.2 after M2): the green
    line says "Your mods already fit Minecraft 26.2 - there is nothing you need to change.", the list is titled
    "Other versions that also fit", no "Best match" tag, no row picked.
T7. Picker → a version where some mods' own files refuse it (e.g. 1.21.10 with Client Side Crystals) → Next →
    "Checking each mod's own file…" then "Will be turned off (N)" naming each with its reason; the Switch button is
    off until that list is there. Switch → the result screen's Turned off list has the SAME N mods and reasons.
T8. "Update mods to fit (N)" on an instance where some mods have no stable build → after the run the button is
    hidden (or shows only what it can still fix), never the old number. Turn a mod on/off → it counts again.

### Prompt 10 - instance menu, moving, no surprise instances
I1. **Right-click** an instance in the rail → the menu opens next to the pointer, inside the window: Play, Open,
    Rename…, Open folder, Verify files, Move up/down/top/bottom, Delete… (red, last). Arrow keys move, Esc closes
    and the rail button has the focus again. Same menu from a **Library > Instances** card and from the instance
    page's **⋮** button. Tab to a rail button and press **Shift+F10** (or the Menu key) → the same menu.
I2. Right-click the main **"Reminth"** instance → Delete… is greyed out with "This is your main instance - it
    can't be deleted." (shown, not hidden). With the game running on an instance: Rename and Delete are off.
I3. Make a throwaway instance, play it once (create a world), quit. Right-click → Delete… → the question says
    "<name> - 1 world, <size>. Everything inside it is deleted for good…". Compare the size with Explorer's
    Properties of the instance folder (roughly equal). Delete → "<name> deleted.", the last played instance is
    selected, the rail/Library/Home no longer show it, the folder is gone.
I4. **Drag** the bottom rail instance to the top: it dims, a line shows the drop place; drop → it's at the top.
    Drag one and press **Esc** → nothing moves; drag one off the rail and let go → nothing moves. Move up / Move
    to bottom from the menu work; the first/last ones' impossible moves are off.
I5. **Restart Reminth** → the order is the same. Library > Instances shows "My order" (same order) and each
    instance's size. Make a new instance → it appears at the **bottom**.
I6. Discover → Servers → Play a server whose version none of your instances has → the question "Make an
    instance for <server>?" with "Reminth will make a new instance: <server> - Minecraft <v> vanilla. Your other
    instances are not changed." → Create → it is made and joins. Its page shows "Made for <server>". Do it again
    for the same server → it now just joins on that instance (no second one).
I7. With a modded instance active, a server whose version none has → choose "New vanilla <v> instance" → the
    same question appears (before: it made one without asking).
I8. Version picker → pick a version → "Keep this one… make a new instance" → make it → Close the result window
    (don't Play) → a toast "<name> was made." with **Undo** → Undo → "<name> removed.", the instance and its
    folder are gone. Make another, wait 10 s → the toast is gone; the instance stays and shows "Copy of <name>".
I9. New instance dialog with a name that already exists on the same version and loader → it is made as
    "<name> (2)".
I10. One instance only: the menu still opens (all Moves off, Delete off for "Reminth"). Many instances (make ~15
    quick throwaways): the rail scrolls; dragging near its top/bottom edge scrolls it.

### Prompt 11 - "Pick a Minecraft version for my mods" (a throwaway COPY of "Reminth", Fabric 26.2, 29 mods)
V1. Mods tab → **"Pick a version that fits my mods"** (panel) or **"Pick a version"** (toolbar) → the dialog is
    titled "Pick a Minecraft version for my mods", with the intro line and the one-line "build" help. Within a few
    seconds: a green "Best match…" or "Fits most…" line, at most 5 versions, "Show more versions" if there are more.
V2. Pick versions one by one: under the list the groups change (Will work / No build for <v> / Not from Modrinth /
    Couldn't be checked) with names; long lists are collapsed. Write down which mods are listed under "No build".
V3. Pick a **newer** version (e.g. 26.3) → Next → two cards; **"Switch this instance to 26.3"** is selected and
    marked Recommended; the groups are shown again with "will be turned off".
V4. Switch → progress → result screen "Done — <copy> is on Minecraft 26.3." Updated / Already fitting / Turned
    off (each with its reason and two buttons) / Not checked. The Turned-off list = the V2 "No build" list.
    `<instance>\.reminth\replaced-mods\<time>\` holds the replaced jars; nothing missing from `mods\` (turned-off
    ones end in `.disabled`); no `.reminth\version-change.json` left.
V5. Big **Play** → the game starts on 26.3 and reaches the title screen.
V6. Back on the Mods tab: the turned-off mods are in the **Off** group with "Turned off by Reminth: no version made
    for 26.3". Turn one on → the line disappears; turn it off by hand → no line.
V7. On the result screen (do V4 again on another copy): **Find a replacement** → Discover, Mods tab, the mod's name
    in the search box, "Showing what fits" = this instance. **Turn on anyway** → the file loses `.disabled`.
V8. In a copy that has worlds, pick an **older** version (e.g. 1.21.4) → Next → the switch card is greyed out with
    "Your worlds were saved in Minecraft 26.2. Opening them in the older 1.21.4 can damage them…"; only the
    new-instance card can be picked (Recommended).
V9. Make a new instance → the card says "Reminth will make a new instance: <name> - Minecraft <v> Fabric. Your
    other instances are not changed." → it is made, worlds are not copied, its name doesn't repeat an existing
    one, its page shows "Copy of <original>". Open the dialog again on the original, same version → the
    new-instance card now offers **"Use <that instance>"**, and using it makes no new instance.
V10. While the instance's game is running: the switch card is greyed out with "Close the game first…".
V11. A modpack instance: the switch card is greyed out ("Its mods belong to the modpack…").
V12. Play with a mod that has no version for 26.2 or anything newer (an old 1.20.1-only jar): "Minecraft won't
    start like this" shows the extra line "<mod> has no version for Minecraft 26.2 or anything newer, so picking
    another version won't help it — it has to be turned off to play".
V13. Pull the network cable on the Switch click (or while it runs): either "Nothing was changed: …" (before the
    instance moved) or the result screen's "…is now on Minecraft <v>, but updating its mods stopped…" with
    `version-change.json` present; "Update mods to fit <v>" then finishes it. No file deleted in either case.

### Prompt 9 - "may not work" mods (a COPY of the "Reminth" instance, never the real one)
M1. Copy the owner's "Reminth" instance (Fabric 26.2 + AppleSkin `appleskin-fabric-mc26.3-3.0.10.jar` and the
    other 26.3 mods) to a throwaway instance. Its Mods tab: AppleSkin shows **May not work** ("listed for
    Minecraft 26.3, not 26.2…"). The button reads **"Update mods to fit 26.2 (N)"** and N includes AppleSkin
    (and the other "may not work" ones that are listed for another version) - note N before/after vs. the
    old 18.
M2. Press the button → AppleSkin is now the **26.2 build** (file name `…mc26.2…`), the old jar is in
    `.reminth/replaced-mods/<time>/`; anything with no stable 26.2 build is in the "No 26.2 build yet" window,
    nothing deleted. Panel no longer lists AppleSkin.
M3. **Play + join the same server as before** (Home "Jump back in" server card) → in-game, HUD draws, **no
    crash** for 2-3 minutes. (This is the main PASS/FAIL of prompt 9.)
M4. Put the 26.3 AppleSkin jar back (from replaced-mods) in a second copy. Press Play from the **instance
    page**, then from the **Home hero**, then from a **Home card**: each shows **"These mods may crash the
    game"** with "N mods are built for another Minecraft version and may crash the game: AppleSkin…",
    Cancel / Play anyway / Fix and play. Cancel → nothing starts.
M5. Play anyway (no tick) → game starts; quit; Play again → the question comes back.
M6. Tick "Don't ask again for this instance" + Play anyway → game starts; quit; Play → **no** question.
    Switch any mod off or on → Play → the question is back. (`instances.json` has `skipModWarning` while it
    holds.)
M7. Fix and play → AppleSkin swapped to 26.2, game starts.
M8. With one blocked mod (a jar that needs 26.3 in its own range) AND AppleSkin 26.3: Play shows the old
    **"Minecraft won't start like this"** question, not the new one.
M9. **After a crash**: in a throwaway instance keep AppleSkin 26.3, tick "Don't ask again", Play anyway, join
    a server → the game crashes like on 3 Oct. Back in Reminth: a toast and a notice on the instance page
    "The game crashed in AppleSkin (appleskin-fabric-mc26.3-3.0.10.jar). It is built for Minecraft 26.3 and
    this instance is on 26.2." with **Fix it**; the Mods panel shows AppleSkin as **"Crashed the game"**.
    `<instance>\.reminth\crash-finding.json` exists. Fix it → swapped to the 26.2 build, notice gone.
M10. A crash with no mod to blame (e.g. start a world, then end `javaw.exe` from Task Manager → no report;
    or any crash report whose stack shows only Minecraft/Fabric frames) → **no** notice, no toast naming a mod.
M11. Close the game normally after M9's fix → `crash-finding.json` is deleted.
M12. Forge/NeoForge instance: a normal Play and quit → no notice, nothing in `main-errors.log`.

### Prompt 5 - the two bugs
P1. Home shows instance A as hero. Start instance **B** from its page → as soon as the game window appears
    (and certainly within 2 s), Home's hero shows **B** (name, Last played). No manual refresh.
P2. Same with "launch minimized" ON: Reminth minimizes; open it from the taskbar during the game → hero is B.
P3. **(prompt 6 - the main one)** Reminth maximized on the 1920x1080 display, "launch minimized" OFF, game
    set to **Start in fullscreen** → play, quit the game → Reminth's window is **1920x1032 again** (fills the
    screen above the taskbar; measure it the same way as before), title-bar icon shows "restore" (two
    squares), and `%APPDATA%\Reminth\main-errors.log` has one new `window: After a game the window said
    maximized but was ...; repaired to ...` line. Play and quit a second time → same, again one line.
P4. Same with "launch minimized" ON → when the game ends Reminth comes back on screen **maximized at full
    size** (1920x1032), not 800x552.
P5. During the game Reminth never pops up, resizes or takes focus (alt-tab around a bit).
P6. Reminth NOT maximized (restore it to a window) → play fullscreen → quit → it stays a normal window
    of the same size, and no `window:` line is logged.
P7. "launch minimized" OFF, minimize Reminth yourself during the game, quit the game → it stays minimized;
    click it on the taskbar → it comes back maximized.
P8. Two instances running at once: Reminth is only put back after the **second** one closes.

### Prompt 4 - Job 0
3. Home → "Jump back in": Play sits at the right of each card's text strip, never over the picture or the
   name; long names/addresses end in "…"; all cards the same height. Check at the smallest window (1100 px).

### Prompt 4 - project page (select a Fabric 1.21.x instance in Discover's "Showing what fits")
4. Discover → Mods → search "fabric api", go to page 2 of results, scroll down a bit, click **Fabric API**'s
   text (not Install) → the page opens: icon, title, summary, people with avatars, downloads, followers,
   "Updated …", Client/Server tag, license. **Fits your instance … (1.21.x Fabric)** in green.
5. Click **Back to results** → same search text, same filters, page 2, same scroll position, the card has
   the focus. Open it again and press **Esc** → same. Open again and press the **mouse Back button** → same.
6. **Sodium**: Description tab shows images (from cdn.modrinth.com), headings, lists; the credit line
   "Description by the project's author, shown from Modrinth." is at the top. Versions tab: release/beta
   tags, "Show more", open a row → changelog appears.
7. **Iris**: Gallery tab shows pictures; Links tab lists source/issues/Discord etc.
8. **Entity Culling**: Minecraft ranges read like "1.21–1.21.x" (not 300 chips); loaders listed.
9. Pick a **Forge** instance in "Showing what fits" while Sodium's page is open → the line changes to
   "No build for 1.20.1 Forge yet." (or similar) without leaving the page.
10. A **modpack** (e.g. Fabulously Optimized): line says "Installs as a new instance of its own."; Install
    opens the modpack install flow (cancel it).
11. A **shader** (Complementary) on a Fabric instance: fit line works; Install goes through the normal
    shader path (Iris question if missing). On a vanilla instance the line says shaders need a loader.
12. A **resource pack** (e.g. Faithful): fit line and Install work.
13. **Install this version**: on Sodium's Versions tab pick a **beta** (or alpha) row → a dialog names the
    channel ("…is a beta build…") → Cancel installs nothing; Install the beta installs that exact version.
    A release row installs without a question. Rows for other Minecraft versions have Install greyed out.
14. With the instance **running**: the page's Install shows it unavailable the same way the cards do.
15. **Description with images and tables**: find a mod whose page has a table (many do - e.g. "Distant
    Horizons" or "Create Fabric") → table drawn with borders, scrolls sideways if wide, no page overflow.
16. **A link opens the default browser**: click a link in a description and one on the Links tab → it
    opens in Edge/Chrome/etc, never inside Reminth; Reminth's window doesn't navigate.
17. **Non-Modrinth image**: find a description with an imgur/GitHub-hosted picture (many older mods; check a
    few) → the box "Image hosted elsewhere" with "Open in browser" shows instead of the picture. In DevTools
    → Network, no request goes to that host.
18. Unplug network / turn Wi-Fi off → open a project not opened in the last 5 minutes → error box with
    **Retry**; reconnect → Retry loads it.
19. Click a result and immediately Back, then another result quickly → the page shows the second project,
    never the first one popping in late.
20. Keyboard: Tab to a result card (focus ring visible) → **Enter** opens it.
21. Instance page → Mods → ⋮ on a mod installed from Modrinth → **Open project page** → page opens, button
    says "Back to <instance>" → it returns to the instance page.
22. Window at **1100 px** wide: header, support card, version rows and gallery fit without sideways scroll.
23. Open 10 different pages quickly → no lag in the window; DevTools Performance: no long task over
    ~100 ms from the page itself.
24. If the owner accepts decision 1, edit the privacy text (app + `site/privacy.html`) exactly as written.
25. Report PASS/FAIL P1-P8 and 3-24.

### Still open from prompt 3 (not yet reported)
26. In a throwaway instance put a folder with a few files, an empty folder and a `.rar` in `mods/`, and a
    `.txt` in `resourcepacks/`. The Mods tab shows **"Safe to delete"** with **Delete all**; names fully
    visible.
27. Delete all → the confirmation lists every item with size / file count → confirm → they are in the
    **Windows Recycle Bin** (restore one to prove it); real jars untouched.
28. Lock one item (open a file inside the folder in another program) → toast "Moved N of M; 1 is in use".
29. Same on the Resource packs tab (only the .txt goes).
30. Start an instance. On its Mods tab: switches/bins/Delete all/bulk bar/"Browse content" are off, the line
    "Close Minecraft to change mods." shows. Resource packs tab still works.
31. Discover → Install on a mod → the "which instance?" panel shows the running instance as "Game running".
32. Quit the game → everything is enabled again without a restart.
33. Skins: restart Reminth, wait 10 s on Home, then DevTools → Console:
    `performance.getEntriesByType("measure").filter(m=>m.name.startsWith("skins:")).map(m=>[m.name,Math.round(m.duration)])`
    → note the numbers. Open/leave Skins 5 times: no rebuild flicker; report whether the lag is gone.
34. Play instance A, quit; select instance B in the rail → Home still shows **A**. Play B from its page →
    Home switches to B as soon as the game starts.
35. Home cards: **Play** on a world card of a 1.20+ instance → the game opens straight into that world;
    pre-1.20 → title screen + toast.
36. Play on a server card → joins the server (IPv6 `[address]:port` if you can).
37. While a card's instance runs, its Play button is off.
38. Profiles: Far view on 26.x (render distance 16/20/24 by PC); an existing instance's own `options.txt`
    stays unchanged after a profile change + Play.
39. Suggested-mods window: rows load, no-build rows can't be ticked, C2ME asks twice.
40. Instance dialog: pack list per loader, "At the last Play" status, Restore (refused while running).
41. Settings → Performance card and the memory helper.

### Release (only after the above pass)
42. Bump to 1.4.0, build, smoke-test the packaged app (open one project page in the packaged app too -
    `markdown.js` must be in the package).
43. With a game running: "Restart and update" disabled; quitting Reminth leaves the game running.
44. Owner creates the GitHub release (installer + `latest.yml` + `.blockmap`); an older installed copy finds
    it. Re-upload `site/` if the privacy text changed.

### Prompt 8 (Home)
H1. Home: the five stat cards have no coloured line on the left edge; the soft coloured glow in each card's
    top-right corner is still there; text and card size unchanged.
H2. Hover each card (and Tab-focus into one if it can be focused): the border turns a soft cyan/accent, with
    a short fade, exactly like the world/server cards below; nothing moves, no shadow appears.

### Prompt 7 (packaged app only - "Check for updates" says "Updates only work in the installed app." in a dev run)
U1. Installed 1.4.0 (or newer), GitHub's newest release older or equal → Settings → **Check for updates** →
    "You're on the latest version (**1.4.0**)" - the running version, never 1.1.1.
U2. After the 1.4.0 release is published: an installed 1.3.x copy → Check for updates → "Downloading 1.4.0…"
    then "1.4.0 is ready." (unchanged behaviour).

### Report back
45. PASS/FAIL per step (W1-W5, T1-T8, I1-I10, V1-V13, M1-M12 and P1-P8 too), the Skins numbers, the owner's answers to section 2, then **update this file**.

---

## 5. Desktop window results so far (3 Oct 2026, Windows 11, real Electron + Minecraft)

- `npm test` 456 pass on Windows (before prompt 3). CRLF files and the CSS last rule intact.
- Prompt 2 case **PASS**: fresh Fabric 26.2 + the owner's 29 mods; panel caught 18 "won't load" (Client Side
  Crystals and JEI included; Anchor Optimizer a warning); one click updated 18, added Sodium, copied 18 jars to
  `.reminth/replaced-mods/`; the game reached the title screen with 113 mods. Real "Reminth" instance untouched.
- Beta/Alpha tags in the update list **PASS**; dev-run "Updates only work in the installed app." **PASS**.
- Forge 1.20.1 (6 pack mods) and NeoForge 1.21.1 (7) reach the title screen **PASS**.
- `options.txt` seeding tested on 1.16.5, 1.20.1, 1.21.1, 1.21.5, 1.21.10, 1.21.11, 26.1, 26.3; fix in
  `2dfbdc7` (`graphicsPreset:"custom"` from 1.21.11 on).
- Not done yet: profile steps above, release steps, site re-upload.
