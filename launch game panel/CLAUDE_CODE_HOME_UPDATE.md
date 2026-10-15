# Home update — new background, panel fix, server grid (owner, 15 Oct 2026)

Made by a Claude design session (cloud). **Nothing in the code was changed.** This file plus the assets in this folder
are everything the Claude Code window needs to build it. Look at `home-mockup-top.png` and `home-mockup-scrolled.png`
first: they are the target (real assets, real sizes, at the owner's window size 1916×1069).

Follow the repo rules as always (`CLAUDE.md`, `design/NIGHT_DESIGN.md`): edit `styles.css` / `night-extra.css`, then run
`node tools/night.js` **and** `node tools/frost.js`; never hand-edit `styles-night.css`. Rewrite `DECISIONS_AND_TEST_PLAN.md`
when done, and update `design/NIGHT_DESIGN.md` (sections 2 and 4) so they describe the new Home.

## What the owner asked (his words, trimmed)

1. "It has random 3D models on the left and right below the box for no reason, remove these." "The background has some
   dots that represent stars... too randomly placed and blurry, fix that." "The file should be named new background reminth."
2. "Remove the PvP tiers box for now and make the Friends thing fill all the space that is left on the right side."
3. "The panel at the top is great but the way and spot it's placed looks really ugly." "Put REMINTH and 'Your Minecraft,
   your way' a bit more up so they don't fall right on the panel."
4. In the empty space under PLAY: servers, each with a preview image, its icon below on the left, the name and IP next
   to the icon, and a small Join button at the right end just below the image. Hovering the preview zooms into it a
   little. Same size and shape for all; 3 per row. The page scrolls, so **12 servers in 4 rows of 3**.
5. They appear with an animation every time Home is opened (his screen recording of Lunar's news grid — measured below).
6. (Second round) "Instead of a plain PLAY button make it LAUNCH GAME and below a text that says Launch Reminth." "Add the
   official icons to EACH ONE." The preview pictures now each show something that belongs to that server (see the table).
7. (Third round) The empty left column gets **the player's own 3D skin** (section 3b). "The last servers played are buried
   down" → owner: put them **inside the launch panel**: the recent tiles sit in the panel, right under LAUNCH GAME (3c).

## Files in this folder

| File | What it is | Where it goes |
|---|---|---|
| `new background reminth.webp` | The new page background: 3840×2160 near-black night sky, crisp stars spread evenly (Poisson-disc), a faint cool haze top-right, **no 3D models**. 75 KB. | `assets/img/new background reminth.webp` (keep the owner's name; quote the url in CSS) |
| `new background reminth.png` | Lossless master of the same picture (5 MB). Don't ship it. | keep here |
| `servers/<id>.webp` | 12 original preview pictures, 1320×600 (2.2:1), 35–110 KB each. No server logos or text in them. | `assets/img/servers/<id>.webp` |
| `servers/icons/<id>.png` | Each server's **official icon** (64×64, the icon the server itself sends in its status reply — taken on 15 Oct 2026). | `assets/img/servers/icons/<id>.png` |
| `home-mockup-top.png`, `home-mockup-scrolled.png` | The target layout, top and scrolled to the end. | `design/home-v2-top.png`, `design/home-v2-scrolled.png` |
| `reminth-launch-panel@2x.*` | The launch panel art (unchanged). Already in the app as `assets/img/launch-panel.webp`. | — |

## 1. Background (fixes the side models AND the blurry dots)

Both problems come from one line: `.backdrop::before` uses `assets/img/launch-panel.webp` as the **whole launcher
background** (owner asked for that earlier on 15 Oct). Cover-scaling a 4.25:1 banner to a 16:9 window blows it up ~1.7×:
the astronaut and the rocket become the giant blurry models at the sides, and the panel's little stars become the big
blurry dots. There is no other star code (checked `styles*.css`, `index.html`, `renderer.js`).

- In `styles.css` (the "Night home page" block): `.backdrop::before { background: url("../../assets/img/new background reminth.webp") center / cover no-repeat; }`
  Keep the existing opacity rules (1 on Home and the sign-in screen, .3 behind the other pages).
- The picture is 4K, so it is only ever scaled **down** (sharp at 100/125/150 % Windows scaling). Don't add blur or filters.
- `.backdrop` is outside the scrolling `.pages`, so the sky stays put while Home scrolls (correct — don't move it).
- Update the NIGHT_DESIGN.md row that says the panel picture is the whole background.

## 2. Header up, PvP tiers out, Friends fills the right side

- Home's title: `body[data-page="home"] #app:not(.signed-out) .topbar-title { margin-top: 14px; }` (was 30px). REMINTH then
  sits at ~y 26 and the tagline ends ~y 66, well clear of the panel top (104).
- PvP tiers: owner said "for now", so **hide, don't delete**: give `#nhTiers` the `hidden` attribute and skip
  `loadMyTiers()` on Home while it's hidden (no point calling three tier sites for a hidden card). Keep the code and
  `src/main/tiers.js`. `test/theme-night.test.js` checks Home ids — keep the id so it passes, or update the test.
- Friends (`.nh-friends`) becomes the whole right column: same width as today (264px), from the panel's top edge down to
  just above the Discord button. Move the Discord link (`.nh-discord`) out of `.nh-foot` into the bottom of `.nh-side`.
  Remove the `@media (max-height: 760px) { .nh-friends { display: none } }` rule — the card now just gets shorter.

## 3. Layout: three columns, the middle one scrolls

The current layout pins everything to one screen (`.nh { height: 100% }`, `grid-template-rows: 1fr auto`) and the panel is
placed with a margin hack (`.nh-center { margin: -16px 300px 0 200px }`, `height: clamp(230px, 30vh, 340px)`), which is
why the picture gets cropped (planet and moon cut off) and the panel looks off. Replace it with:

```
.nh                 grid: [stats 200px] [center 1fr] [side 264px], column-gap 24px,
                    padding 104px 40px 40px 48px, height: auto (min-height 100%), align-items: start
  .nh-left (new)    column 1, position: sticky; top: 104px; height: calc(100vh - 104px - 26px);
                    flex column, space-between: top group = .nh-stats + .nh-me (your skin, 3b);
                    .nh-version (Reminth 1.8.0 • What's new) at the bottom
  .nh-center        column 2: .nh-panel (LAUNCH GAME + recent tiles inside it, 3c), .nh-row (picker), .nh-meta, then SERVERS
  .nh-side          column 3, position: sticky; top: 104px; height: calc(100vh - 104px - 26px);
                    flex column, gap 12px: .nh-friends { flex: 1 } then .nh-discord
```

- `#home.page { height: 100% }` → `min-height: 100%`; `.pages` already scrolls (`overflow-y: auto`). Keep the scrollbar
  hidden on Home or use the thin Night one — owner hasn't said; the mockups have it hidden.
- The top bar floats over `.pages` on Home, so scrolled cards would slide under REMINTH and the top buttons. Fade them
  out under it: on Home only, `.pages { mask-image: linear-gradient(to bottom, transparent 0 70px, #000 100px); }`
  (+ `-webkit-mask-image`). At scroll 0 nothing is masked (the panel starts at 104px).
- Scroll Home back to the top every time Home is opened (in `playPageEnter` when `page === "home"`: `$("pages").scrollTop = 0`),
  otherwise the entry animation plays off-screen.
- Nothing sits under the server grid any more (Quick join moved up, 3c); the page ends 40px under the last row.
- Smaller windows: ≤1180px → stats 170px, side 228px (as today). ≤1100px of **center** width → servers 2 per row.
  ≤940px → today's one-column fallback (stats + side in a row on top, center below, servers 2 per row, side not sticky).

## 3b. Your character in the left column

The empty space under the stats shows **the signed-in player's own skin**, standing in 3D, idling — reuse the Skins page's
viewer. It's `src/renderer/skinview.js` (`window.SkinViewer`, plain CSS 3D, no WebGL), already used in `features.js`:

```js
const homeSkin = new SkinViewer($("nhSkinView"), { scale: 10, yaw: -24, pitch: -6 }); // idle anim + drag-to-spin on
const t = currentSkinTexture();               // { dataUrl, model } — same as the Skins page (features.js)
homeSkin.setSkin(t.dataUrl, t.model);         // not signed in → fallbackSkinTexture(), "classic"
// cape: the active one from window.reminth.skinProfile() → homeSkin.setCape(dataUrl), like loadSkinProfileNow()
```

Markup, in the bottom group of `.nh-left` (see Position):
```html
<button class="nh-me" id="nhMe" type="button" aria-label="Your character — open Skins">
  <span class="nh-me-tag" id="nhMeName"></span>       <!-- the player's real Minecraft name, above the head -->
  <div class="nh-me-view" id="nhSkinView"></div>
  <span class="nh-me-sub">Change skin</span>
</button>
```
- Size (owner: "make it bigger"): viewer box **200×340**, the full column width. Scale **10** (10 screen px per skin
  pixel → the 32-px-tall model is ~320px tall). The viewer already draws its own soft floor shadow (`.sv-shadow`).
- **Position (owner: "more down, closer to the What's new"):** the character sits at the **bottom** of the left column,
  right above the "Reminth 1.8.0 • What's new" line, 22px between "Change skin" and that line. Pure CSS, no measuring:
  `.nh-left` stays a sticky flex column with `justify-content: space-between`; its two children are `.nh-stats` (top)
  and a bottom group `.nh-left-bottom { display: flex; flex-direction: column; gap: 22px; }` holding `.nh-me` then
  `.nh-version`. The column stays put while the middle scrolls.
- **Name above the head** (owner: "put a username above the head, the player's real one that updates when changed" —
  then: "bigger username and no box around it, with the actual Minecraft font"):
  - **No box.** White text with Minecraft's own text shadow (a copy offset 1 font-pixel right and down in a quarter of
    the colour: `#3F3F3F` under white), centred, 14px above the head. Size: **3 screen px per font pixel** (letters ~21px
    tall; "Preview" comes out 117×27). Scale by `devicePixelRatio` too so it stays crisp at 125/150 % Windows scaling.
  - **The real Minecraft font, without shipping Mojang's files:** the font is the game's own bitmap
    `assets/minecraft/textures/font/ascii.png` (128×128 = 16×16 glyphs of 8×8 px). Don't bundle it in the app (it's a game
    asset; Minecraft's EULA doesn't let you redistribute it). Read it at runtime from the client jar Reminth has already
    downloaded (`%APPDATA%/Reminth/instance/versions/<version>/<version>.jar`, any recent version) with the existing
    `src/main/zipread.js`, cache the PNG in Reminth's data folder, and hand it to the window over IPC (e.g.
    `window.reminth.mcFontAscii()` → `data:image/png;base64,…`).
  - Drawing it (a `<canvas>` in `.nh-me-tag`): glyph for character `c` is the 8×8 cell at column `c % 16`, row
    `floor(c / 16)`; its width = last column that has any opaque pixel + 1; advance = width + 1; space = 4. Draw the shadow
    pass, then the white pass, nearest-neighbour (`imageSmoothingEnabled = false`). Minecraft names are only `A–Z a–z 0–9 _`,
    all in that sheet, and its digits read fine (unlike Pixelify's).
  - Fallback before any game jar exists (fresh install, never played): Inter 800 18px white with a 2px `#3F3F3F` shadow;
    switch to the real font as soon as the jar is there.
  - Text = `state.username` (the Minecraft profile name). Paint it in one `paintHomeName()` called from every place that
    changes it today: `doSignIn`, `doSignOut`, `signedOutByBackend`, `window.reminth.onAccountRestored`, and `boot()`
    (all in `renderer.js`). Signed out → hide the tag.
  - **Renames:** `refreshSession()` in `src/main/msAuth.js` already re-reads the profile (`profile.name`) every time the
    Minecraft token is refreshed, but nothing tells the window when that name differs. In main, when a refresh returns a
    `username` different from the saved one, send the same `account:restored`-style event the renderer already handles
    (`onAccountRestored({ username })`), so the nametag, the top-bar account chip and the Skins page all switch to the new
    name without a restart. Also refresh once when Reminth starts (it already does via `currentAccount()` / restore).
  - Streamer mode: if streamer mode hides the username elsewhere (`state.privacy`), hide/blur the nametag the same way.
- "Change skin" (18px under the feet): 12px, cream, underlined (Night link style). The whole
  block is one button → `switchPage("skins")`. Drag still spins the model (the viewer handles pointer events; make the click
  open Skins only if the pointer didn't drag).
- **It must follow the account skin.** `window.onAccountSkin` is one global hook owned by the Skins page — don't overwrite
  it; call a small `paintHomeSkin()` from inside it (and on sign-in/out) so Home and Skins always show the same skin.
  Only rebuild when the skin really changed (same `model|dataUrl` key trick the Skins page uses).
- **Performance (Reminth is an FPS client):** `homeSkin.pause()` whenever Home isn't the page shown (the `reminth:page`
  event, same as Skins), when the window isn't in front (`body.unfocused`), and while a game runs (`body.game-running`);
  `resume()` when back. No animation frames otherwise.
- Short windows: the left column (window height − 130px) must fit stats (~250) + ≥24px air + character block (~392) +
  22 + version (~23). Under ~840px window height use scale 8 and a 170×272 box; under ~770px hide `.nh-me`; under 940px
  wide (one-column layout) hide it too — the stats stay. The character must never overlap the stats.
- Entrance: it fades up with the stats (`#home.entering .nh-me { animation: m-from-left .46s var(--m-ease) both; animation-delay: 380ms }`).

## 3c. Recent servers and worlds inside the launch panel (Quick join moved up)

The owner's last servers and worlds were at the very bottom of a now-scrolling page. Owner's call: put them **inside the
launch panel, under LAUNCH GAME** — starting fresh and rejoining live in one place. See `home-mockup-top.png`.

- **LAUNCH GAME does not move** — it stays in the exact centre of the panel. The tiles hang just under it:
  wrap the button in `.nh-panel-col { position: relative; display: grid; place-items: center; }` and put the tile row in
  it as `position: absolute; top: calc(100% + 12px); left: 50%; transform: translateX(-50%); white-space: nowrap;` —
  12px under the button's bottom edge, centred on it. Nothing else in the panel shifts.
- The tile row = the existing Quick join row (`#quickJoin`, filled by `loadRecent` → `quickTile`, max 6, servers with their
  own servers.dat icon, worlds with their picture). Same click behaviour, same tooltips — no logic changes.
- Its backing so it reads on the art: `padding: 6px 8px; border-radius: 14px; background: rgba(8,8,10,.55);
  border: 1px solid rgba(255,255,255,.12); backdrop-filter: blur(6px)`. Tiles 46–48px with 10–12px gaps. No label inside
  the panel (the tooltip names each tile).
- Nothing recent → the row is `hidden`; the button is where it always is.
- **Short panels:** under the centred button the row needs half the button (38) + 12 gap + ~62 row + ~14 air = ~126px,
  so the panel must be ≥ ~252px tall, i.e. the middle column ≥ ~1070px (windows narrower than ~1740px — the middle column
  is the window width minus ~670px — and the one-column layout fall below that). Then the row moves out to just under the picker, as a
  centred "Jump back in" row (label `.nh-label`, letter-spacing .3em, `#9a9aa0`; 22px under the meta line, SERVERS 30px under it).
  Easiest: give the panel a container (`.nh-center { container-type: inline-size; }`) and have `loadRecent` fill two
  rows (`#quickJoin` in the panel, `#quickJoinBelow` under the picker); `@container (max-width: 1070px)` hides the panel
  one and shows the lower one, the opposite above. No resize JS.
- The tiles are disabled while that instance installs/runs exactly as today (`paintRecentPlayButtons`).
- `.nh-foot` is now empty (version → `.nh-left`, Discord → `.nh-side`, recent tiles → the panel): remove it and its CSS.
- With the row in the panel, SERVERS sits just 8px under the meta line (owner asked twice to bring the servers closer to "Last played …") and at 1916×1069 the first row of cards ends at ~y 765,
  with the second row already peeking in.

## 4. The launch panel: never cropped

- `.nh-center` loses the margin hack; it's a normal grid column now (`min-width: 0`).
- `.nh-panel { width: 100%; height: auto; aspect-ratio: 2704 / 636; }` — the same shape as the picture, so `object-fit: cover`
  shows all of it (planet, astronaut, rocket, moon, satellite). At 1916px wide the panel is 1248×294.
- Keep its look: 22px radius, 2px `#8a8d95` outline, the button in the middle, the `m-panel` / `m-art` entrance.

### The button: LAUNCH GAME + "Launch Reminth" (replaces the plain PLAY)

```html
<button class="nh-play" id="playBtn">
  <span class="nh-play-title"><svg class="i"><use href="#i-play"/></svg><b>Launch game</b></span>
  <span class="nh-play-sub">Launch Reminth</span>
</button>
```
- Size 300×76, same cream / rim / soft glow as today. Column layout: `flex-direction: column; gap: 6px`.
- Title: Inter 800, 19px, letter-spacing .22em, uppercase ("LAUNCH GAME"), play triangle 14px before it, gap 12px.
- Line under it: Inter 600, 12px, letter-spacing .02em, normal case, opacity .62 — the words "Launch Reminth", exactly.
- **Gotcha:** `paintPlayButtons()` does `btn.querySelector("span").textContent = ... "Play"`. With the new markup that would
  wipe the title. Point it at the title text instead (`btn.querySelector(".nh-play-title b")`), make the idle text
  "Launch game" for `playBtn` only (the instance page's `instPlayBtn` keeps "Play"), and hide `.nh-play-sub` while the
  button shows progress or "Playing" (the progress text needs the room). `.nh-play.progressing` font rules apply to the title.
- The `m-pop` entrance and hover lift stay as they are.

## 5. The SERVERS section

Above the grid: a label `SERVERS` (`.nh-label` style: 10px, 800, .17em, uppercase, `#a7a7ac`), **8px** under the meta line (30px under the lower "Jump back in" row when it is shown on narrow windows),
**10px** above the grid. Grid: `grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px;` (cards are ~403px wide at 1916).

### The 12 servers (in this order — row by row)

| # | Name | Address (Join + ping) | Picture | What the picture shows |
|---|---|---|---|---|
| 1 | Hypixel | `mc.hypixel.net` | `hypixel.webp` | Bed Wars: a bed inside its wool + end-stone defense, dug open; red bridge, attackers, diamond island |
| 2 | DonutSMP | `donutsmp.net` | `donutsmp.webp` | a giant blue-iced donut monument on a spawn plaza with market stalls |
| 3 | PvPHQ | `pvphq.com` | `pvphq.webp` | a ranked duel, swords locked, orange/silver ring, a gold trophy behind |
| 4 | PvP Club | `mcpvp.club` | `pvpclub.webp` | a packed sandstone colosseum, red & white banners, free-for-all |
| 5 | PvP Hub | `play.pvphub.me` | `pvphub.webp` | a pink crystal blast on obsidian at dusk |
| 6 | Lifesteal | `lifesteal.net` | `lifesteal.webp` | a warrior raising a burning stolen heart over a crimson field |
| 7 | Minemen Club | `minemen.club` | `minemen-club.webp` | practice arena with magenta trim: splash healing potions, heal swirl, dummies |
| 8 | MCPVP | `mcpvp.com` | `mcpvp.webp` | a mace slam on a tropical beach |
| 9 | PikaNetwork | `play.pika-network.net` | `pikanetwork.webp` | a sky island with gold & gem generator blocks, yellow lightning striking nearby |
| 10 | 2b2t | `2b2t.org` | `2b2t.webp` | burnt anarchy wasteland: lava casts, craters, a lit nether-style portal |
| 11 | ManaCube | `play.manacube.com` | `manacube.webp` | a parkour path to a glowing gate, floating mana crystals |
| 12 | JartexNetwork | `jartexnetwork.com` | `jartexnetwork.webp` | a fortress wall blown open by a TNT cannon, gold & teal banners |

Addresses: PvP Club, PvP Hub, MCPVP and DonutSMP are exactly what's in the owner's own `servers.dat`. All 12 were checked
online on 15 Oct 2026 and answered a status ping (that's also where the bundled icons come from).
The owner picked 1–6; 7–12 are English PvP/survival servers chosen for player count (between ~800 and ~3,800 online that day).
Put the list in one place (e.g. `HOME_SERVERS` in `renderer.js`, or `pure.js` if you want a test on it).

### One card (markup)

```html
<article class="nh-srv" style="--i:0">
  <div class="nh-srv-pic"><img src="../../assets/img/servers/hypixel.webp" alt="" draggable="false" decoding="async"></div>
  <div class="nh-srv-info">
    <span class="nh-srv-ico"><!-- server's own icon <img>, or two-letter tile --></span>
    <span class="nh-srv-txt"><b class="nh-srv-name">Hypixel</b><span class="nh-srv-ip">mc.hypixel.net<em class="nh-srv-on" hidden></em></span></span>
    <button class="nh-srv-join" type="button" aria-label="Join Hypixel">Join</button>
  </div>
</article>
```

Build the 12 cards **once** (when Home is first drawn). Later pings only change the icon and the online text in place —
never rebuild the cards, or the entrance animation replays and the hover state flickers.

### Card look

- Card: radius 12px, 1px `rgba(255,255,255,.1)` line, background `rgba(12,12,15,.82)`, `overflow: hidden`.
  Hover anywhere on the card: line goes `rgba(255,255,255,.2)`.
- Picture: `aspect-ratio: 1320 / 600` (2.2:1, a bit wider than the Hypixel reference), fills the card width.
- Info row: `padding: 12px 14px 13px; display: flex; align-items: center; gap: 12px`.
  - Icon 40×40, radius 8px, 1px `rgba(255,255,255,.14)` line, `image-rendering: pixelated` (server icons are 64×64).
  - Name: Inter 14.5px, 750, `#fff`, one line with ellipsis.
  - Under it, the address: Inter 12px `#a3a3a9`; after it, **only when a ping answered**, a green dot + `23,245 online`
    (`#9ee6b8`, dot `#4ade80`). Use `toLocaleString()`. No ping answer → no number at all (Night rule: no fake data).
  - Join: the cream "press me" button, small: height 30px, padding 0 14px, radius 8px, `var(--cream)` on `#111113`,
    Inter 800 11.5px, letter-spacing .12em, uppercase "JOIN", 1px `rgba(255,255,255,.5)` line. It's a real `<button>`.

### Icons and player counts (live, from the server itself)

- `src/main/serverPing.js` `statusFromJson()` doesn't return the server's icon yet. Add
  `favicon: typeof json.favicon === "string" && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(json.favicon) && json.favicon.length < 65536 ? json.favicon : null`.
  Add a test for it (a good one passes, a non-PNG / oversized / missing one gives `null`).
- When Home opens: `window.reminth.pingServers(addresses)` for the 12 (existing IPC `servers:ping`), at most once a
  minute, never while a game is running (the client is for FPS). Put each answer into its card: icon + "N online".
- Every card shows its server's **official icon from the first frame**: the bundled copy in
  `assets/img/servers/icons/<id>.png`. When a ping answers with a favicon, swap the card's icon to it (servers change
  their icon for seasons/events) and remember it (localStorage key like `reminth.homeServerIcons`; data URLs are 4–12 KB),
  so next launch shows the newest one instantly. Don't remember counts.
- If both are missing (a server added later without a bundled icon): the two-letter tile Quick join already uses
  (`quickInitials()` + `QUICK_TINTS`).

### Join

Same path Quick join uses (`quickTile` in `renderer.js`):
```js
const inst = heroInstance();                       // the instance PLAY would start (the picker pill)
const join = window.ReminthPure.parseServerAddress(address);
if (!inst || !join) return;
if (state.running.has(inst.id) || state.installing.has(inst.id)) return;
runPlay({ instanceId: inst.id, join: { host: join.host, port: join.port } });
```
Disable all Join buttons while that instance is installing or running (repaint them where `paintPlayButtons()` /
`paintRecentPlayButtons()` run). Nothing else on the card is clickable.

### Hover zoom on the picture — exact steps

1. `.nh-srv-pic { position: relative; overflow: hidden; aspect-ratio: 1320 / 600; isolation: isolate; }`
   — `isolation` (or `transform: translateZ(0)`) keeps Chromium clipping the scaled picture to the card's rounded top
   corners during the transition; without it the corners flash square for a frame.
2. `.nh-srv-pic img { display: block; width: 100%; height: 100%; object-fit: cover; transform: scale(1);
   transition: transform .45s var(--m-ease), filter .45s ease; }` (`--m-ease` = `cubic-bezier(.2,.8,.2,1)` from motion.css).
3. Zoom when the pointer is **on the picture** (owner: "when the cursor stands on the image preview"), and when the Join
   button has keyboard focus: `.nh-srv-pic:hover img, .nh-srv:has(.nh-srv-join:focus-visible) img { transform: scale(1.06); filter: brightness(1.06); }`
   Only transform and filter move — no layout work.
4. `will-change: transform` only inside the hover rule, not on all 12 images (12 permanent GPU layers for nothing).
5. Put the transition in `motion.css` and add `.nh-srv-pic img` to the `prefers-reduced-motion` block (no zoom there).
   Hover still works under `body.unfocused` / `body.game-running` (it's a transition, not a decorative loop).
6. Load the bottom two rows lazily (`loading="lazy"` on cards 7–12); the top six load right away.

### Entrance animation — every time Home is opened (measured from the owner's recording)

The recording is Lunar Client's "Latest News" grid, 30 fps; measured frame by frame:
- Each card fades in from **opacity 0** while sliding **up ~32px** to its place. No scale, no blur.
- One card takes **~450–500ms**, with a strong ease-out: most of the move happens in the first ~200ms, then it settles slowly.
- Cards start **one after another in reading order** (left → right, then the next row), **~60ms apart**.
- The section heading is already there when the first card starts.

Build it like the rest of Home's entrance (`motion.css`, `#home.entering`, `renderer.js` `playPageEnter`):

```css
#home.entering .nh-srv { animation: m-srv-in .48s var(--m-ease) both; animation-delay: calc(440ms + var(--i, 0) * 60ms); }
@keyframes m-srv-in { from { opacity: 0; transform: translateY(32px); } to { opacity: 1; transform: none; } }
```

- `--i` = the card's index 0–11 (set it when the cards are built; reading order).
- Order on open: panel (60ms) → LAUNCH GAME pops (260ms) → picker + meta (340ms) → recent tiles in the panel (380ms, they
  already cascade via `.nh-tile` / `m-row`) and your skin (380ms) → server cards from **440ms**.
- **Gotcha:** `playPageEnter` removes `.entering` after **1100ms**. The 12th card starts at 440 + 11×60 = 1100ms and ends
  at ~1580ms, so the class would be pulled before the last cards even start. Raise that timeout to **1700ms**.
- It must replay on every open of Home (that's what `.entering` does) and must not replay when a ping updates a card.
- Add `#home .nh-srv` and `#home .nh-me` to the `prefers-reduced-motion` list (the skin viewer's idle animation: pass `animate: false` then).

## 6. Tests and docs

- `npm test` must pass: update `test/theme-night.test.js` for the moved/hidden Home parts; add the `statusFromJson`
  favicon test.
- Check by eye in `tools/preview/` at 1280×720, 1916×1069 and 2560×1440: panel never cropped, side columns stay put
  while the middle scrolls, cards fade under the top bar, background sharp.
- `DECISIONS_AND_TEST_PLAN.md` test plan should include: your skin on Home matches the Skins page, updates after a skin
  change, opens Skins on click, spins on drag, and stops animating while a game runs; the recent tiles show inside
  the panel under LAUNCH GAME, join on click, and move under the picker on a narrow window; LAUNCH GAME shows "Launch Reminth" under it, and shows progress
  text (no sub line) while installing / "Playing" while running; Home entrance (cards cascade in, every time); hover zoom
  (corners stay round); Join on two servers (e.g. DonutSMP and PvP Club) from the picked instance; a server that
  doesn't answer (pull the network) → initials, no count; Join disabled while the instance runs; small window layout;
  the new background at 100/125/150 % scaling.

## Notes for the owner (decisions made in the design session, change any of them)

- `new background reminth` is the **page background** picture (the owner let the design session choose which file gets the name).
- The side columns stay pinned while the middle scrolls (stats + version on the left, Friends + Discord on the right).
- The character in the mockups is a stand-in drawn by the design session; the real one is the player's own skin from the
  existing skin viewer.
- Player counts under each server are live from the server; nothing shows when a server doesn't answer.
- The 6 extra servers (Minemen Club, MCPVP, PikaNetwork, 2b2t, ManaCube, JartexNetwork) can be swapped by editing the list
  and dropping a 1320×600 picture in `assets/img/servers/`.
