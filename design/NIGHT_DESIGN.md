# Reminth "Night" - the new look (owner, 14-15 Oct 2026)

**15 Oct 2026, owner: "black is our color here its not changeable at least for now".** No Blue/Orange/accent pickers
anywhere (sign-in and Settings); the page always applies Night (`renderer.js` boot) and the window icon is always the
Moonrise one (`main.js` `LOOK`). The Blue/Orange stylesheets and code stay in the repo for later; saved settings are
left as they are.

**Read this first if you are a Claude Code window working on Reminth's look.** It is the source of truth for the
Night design: what the owner asked, what is built, where it lives in the code, the rules, and what is left.

## 1. What the owner asked (his words, 14 Oct 2026, late evening)

1. Sent his design "Home · Night" (`design/home-night.png`, also `design/icon/in-launcher-moonrise.png`) and said:
   *"replace the dark page with the whole actual old orange style"*, then, asked which way: **"forget orange, use my
   new night/dark layout"**.
2. Sent his new icon: *"this is my new icon and logo generally for the whole app, save it to the folder somewhere
   easy for other claude windows to find and the home page too"* - the kit is `design/icon/` (from his
   `Downloads/reminth-moonrise-smooth.zip`: PNGs 16-1024, `reminth-moonrise.ico`, `reminth-moonrise-master.svg`,
   `reminth-moonrise-small.svg`).
3. *"design the whole app again, based on the layout you see now, rebuild the other tabs and settings and buttons and
   login and everything following the home screen type/color/vibe generally, ill tell you changes in the morning,
   put the creations in a file in reminth launcher folder for other claude code windows to find and build the code
   too"*.
4. *"dont ask me questions ... you do what i asked you and the other claude code window once your done will start
   building the code, dont rush do good job no mistakes"*.

## 2. Files

| File | What |
|---|---|
| `design/home-night.png` | The owner's Home design (1440x900). The reference for everything. |
| `design/icon/` | The owner's icon kit ("Moonrise"): the app icon from now on. |
| `design/screens/*.png` | How the built app looks (hidden preview, 15 Oct 2026). |
| `design/privacy-v13-draft.md` | Privacy text to put live **when 1.8.0 is published** (the PvP tiers card). |
| `assets/icons/reminth-night.ico` | = `design/icon/reminth-moonrise.ico`: the .exe, installer, uninstaller and window icon (`package.json` build, `main.js` themeIcon). |
| `assets/icons/source/reminth-mark-night.svg` | The see-through mark (the cube of the master SVG without tile, stars, hills): rail, loading screen, sign-in card, HUD mod card. |
| `src/renderer/index.html` | `#homeMain.nh` (the Night home), `#nightScene` + `#nightMoon` canvases in `.backdrop`, no theme or accent pickers (removed 15 Oct: black only). |
| `src/renderer/renderer.js` | "the Night home page" section: `PX_ICONS`/`pxIcon`, `PX_DIGITS`/`pxNumber`/`setPxStat`, `loadMyTiers`/`paintTiers`, What's new pop-up. Also `renderHero`, `paintHeroStats`, `openHeroPicker`, `showMenuBox`, Quick join (`quickInitials`, `quickTile`, `loadRecent`), `THEME_FILES`/`applyTheme`. |
| `src/renderer/scene.js` | Home's background (owner, 15 Oct: "just dark with clouds and those white stars ... without the trees and the plain biome, and the blocks ... the moon exactly like minecraft's"): a dark sky, twinkling white stars over the whole window, drifting blocky clouds, and the moon as a plain square with Minecraft's grey patches (own canvas `#nightMoon`). Animated at 30 fps only on Home with the window in front and no game running; still for prefers-reduced-motion. |
| `src/renderer/styles.css` | The Home layout at the end ("the Night home page" block) - every look gets it. |
| `src/renderer/night-extra.css` | The Night look itself (everything that isn't just a colour). |
| `src/renderer/styles-night.css` | **Made, never edit**: `node tools/night.js` = styles.css with every non-status colour grey + night-extra.css. |
| `src/renderer/styles-frost.css` | **Made, never edit**: `node tools/frost.js` (Blue). Run both tools after any styles.css edit. |
| `src/main/tiers.js` | The player's own PvP tiers from MCTiers / PvPTiers / SubTiers (IPC `tiers:mine`, preload `myTiers`). |
| `src/main/store.js` | `theme: "night"` default, `lookVersion: 2` (the one-time move of every player to Night), accent `night`. |
| `test/theme-night.test.js`, `test/tiers.test.js` | Fail if the made stylesheet is stale, the Home markup loses an id, or the tiers logic breaks. |
| `tools/preview/` | Hidden off-screen preview (never touches the owner's screen or data) - see its README. |

## 3. The look (tokens)

- **Background**: near-black `#08080a` (`--bg`); the pixel night scene behind every page (full on Home and the
  sign-in screen, 34% on other pages; the moon only on Home and sign-in).
- **Text**: `#f5f5f6` / `#d6d6da` / muted `#a3a3a9`.
- **Lines**: `rgba(255,255,255,.10)`; soft `.06`.
- **Cards**: `rgba(15,15,18,.82)` glass, 1px line, radius 12 (Home's side cards: 10), no drop shadow, no glow.
- **The one colour you press**: cream `#ece8de` (`--accent` for the Night accent "Moonlight"), ink `#111113`.
  A cream button that can't be pressed goes dark (so cream always means "press me").
- **PLAY**: 300x76, cream, 1px white rim, soft white glow (the only glow in the app), "PLAY" Inter 800 spaced .32em.
- **Labels**: 10-11px, weight 800, letter-spacing .17em, uppercase, `#a7a7ac` - "PVP TIERS", "QUICK JOIN", and every
  settings card title.
- **Headings**: Pixelify Sans (top bar page name 19px uppercase .1em; Home's REMINTH 27px .14em; page h1s), in the
  **regular** weight: the bold one closes the gap of C/c ("INSTANCE" read "INSTANOE") - the other window's fix in
  `night-extra.css` (15 Oct, 01:30). Home's REMINTH has no C and stays bold.
- **Numbers**: never in Pixelify (its 2 reads as 8, 5 as 8, 7 as 1). Home's stats use the drawn 5x7 pixel digits
  (`pxNumber`, 3 screen px per pixel); everything else uses Inter. Dialog titles are Inter for the same reason.
- **Rail**: solid `#0a0a0c`, icons `#c9c9ce`, the active one on a grey square with a 3px white bar on its left.
- **Top bar**: see-through over the sky, page name in pixel letters; buttons dark glass with a 1px line, radius 9.
- **Status colours stay**: green (online, Ready, checks), amber (warnings), pink-red (errors, Stop, Streamer live).
  Discord keeps its blurple. PvP tier chips keep the in-game Tier Tagger colours (`/* keep-colour */` lines).
- **Motion**: CSS transitions under 200 ms; no animated background (the scene is drawn once per resize).

## 4. Home (the owner's design, built)

Left: stats as pixel icon + pixel number (player kills = sword, deaths = skull, mob kills = mob face, blocks broken =
pickaxe, blocks placed = block), hover names them. Middle: PLAY (starts the shown instance), under it the picker
pill "Fabric 26.2 · Reminth ⌄" (menu: every instance, "Open <name>", "New instance"; the pick lasts until a game
starts), then "Last played … · … played". Stop / Update mods / progress / log appear under it when needed. Right:
PvP tiers (the signed-in player's real tiers, best per gamemode across the three lists; "No tiers yet…" or
"Couldn't reach…" otherwise) and **Friends - Soon** (Reminth has no friends system; the design's kxlo / nyxpvp /
v0idd were mock-ups, nothing fake is shown). Bottom: "Reminth <version> • What's new" (opens the list), Quick join
(the last 5 worlds/servers: servers as two-letter tiles - "pvp hub" → PH, "mcpvp.club" → MC, "mcpvp.com" → MP,
"donut" → DN - worlds as a block tile; click = play it), Discord.

## 5. Status (15 Oct 2026, night)

- **Seen working in the hidden preview** (real app code, fake signed-in state, screenshots in `design/screens/`):
  sign-in (both steps), Home, Discover, Library, Skins, Servers, Reminth+, Settings, Statistics, Instance, Streamer,
  the new-instance dialog, the PLAY picker menu, What's new, the Orange look with the new Home. No script errors
  on any page. `npm test` passes.
- **Tested for real on 15 Oct (code window, hidden test copy with a fake offline player)**: PLAY through a real
  launch (downloads, progress, Playing, Stop), Quick join joining a local test server, the PLAY picker, What's new,
  New instance, theme switching both ways, sign out, the tiers card reaching the tier sites. Details:
  DECISIONS_AND_TEST_PLAN.md section 0000000000000000000000000000000000000.
- **Not tested yet**: the installed 1.8.0; the window/taskbar and installer icon on Windows; the one-time move to
  Night on the owner's real settings; the tiers card with an account that has tiers.

## 6. Left to do (not done on purpose)

1. **Owner's changes in the morning** - he said he'll send changes. Ask nothing, apply them.
2. Build and hand over the 1.8.0 installer only when the owner wants to test/publish (version is already 1.8.0).
3. When 1.8.0 is published: privacy v13 (`design/privacy-v13-draft.md`), website texts, and the **website's icon /
   favicon** (`site/`) in the Moonrise style - the owner said "for the whole app"; the site was left alone because a
   push to `site/` goes live at once.
4. The in-game pieces (ReminthHUD G panel, the Reminth title screen mod) still use the old orange/blue mark.
5. A real Friends system (needs the Reminth account server) if the owner wants the card to be real.
