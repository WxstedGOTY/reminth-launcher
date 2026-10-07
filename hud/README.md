# ReminthHUD

The small in-game overlay Reminth puts into Fabric instances (Minecraft 26.2 and 26.3).
Client-side only, CC0.

## The Reminth panel (since 1.4.0, Minecraft 26.2)

ReminthHUD carries the **Reminth panel**: Reminth's own client features in a Lunar-style window. Reminth puts
ReminthHUD into every Fabric/Quilt instance (it is part of the launcher, hidden in Mod Menu as a library).

- Opened with **G** (Controls -> Reminth -> "Open the Reminth panel") or the title screen's **Discover** button.
- Top: MODS / SETTINGS, search, close. Left: categories (All, HUD, Visual, Mechanic, Chat, Utility), profiles
  (click to switch, pencil to rename or delete, "Save as new profile"), **Edit HUD layout** (drag to move, scroll to
  resize, right-click to reset). Cards: icon, name, OPTIONS + gear (the feature's own settings), ENABLED / DISABLED.
- The window is laid out on a virtual 640x370 screen and scaled to fit, so it looks the same at any GUI scale.
- Features (`client/panel/Features.java`): FPS, Ping, CPS, Keystrokes, Coordinates, Clock, Armor Status, Held Item
  Durability, Potion Effects (exact level and time left), Totem Counter, Zoom (hold C, scroll for more), Hurt Cam
  (the game's Damage Tilt), Low Fire, Toggle Sprint / Toggle Sneak (the game's own toggles). The full list is
  `docs/PANEL_FEATURES.md`.
- Settings: `config/reminthhud-panel.json` (profiles; per feature: on, place, size, options).
- Icons: `tools/icons.js` (our own vector drawings), rendered with `node_modules/.bin/electron hud/tools/render-icons.js`.

## What it shows

- **Top-right bar** (plain text, no background and no shadow, 75 % size, grey labels, bold light-grey values): `FPS 240 | GPU 16% | CPU 53% | LAT 0 ms`
  - **FPS**: the game's own frame counter.
  - **GPU**: the whole PC's GPU load, the same number as Task Manager (Windows'
    `\GPU Engine(*)\Utilization Percentage` counters, busiest engine). Read on a
    background thread once a second through `pdh.dll` with Java's foreign-function
    API, added up per GPU engine like Task Manager does. If this PC can't give it (not
    Windows, counters missing), the item is simply left out.
  - **CPU**: the whole PC's CPU load (mean of the last 3 seconds), Windows' "% Processor Time".
    Windows 11's Task Manager shows "% Processor Utility" instead, which scales with the clock
    speed, so the two can differ.
  - **LAT**: your latency to the server as the game knows it (the player list's
    number). 0 in singleplayer.
  - The bar moves down under the potion-effect icons when there are some.
- Coordinates are NOT shown (a player may need to hide them).
- **H** shows/hides the bar (rebindable in Controls).

## Config

`config/reminthhud.json` in the instance, written with everything on the first time:

```json
{ "fps": true, "gpu": true, "cpu": true, "lat": true, "jeiEarlyStart": true }
```

Set an item to `false` to hide it. Read once when the game starts.

## JEI early start

Just Enough Items (JEI) loads every recipe on the render thread - about 1.5 seconds with many mods - and
starts when the server's "recipes updated" packet arrives. On servers that never send it, JEI waits for the
first inventory screen, so the freeze lands when the player first presses E. If JEI is installed and hasn't
started 1.5 s after joining, ReminthHUD runs JEI's own `AFTER_RECIPES_UPDATED` event (found by name, no JEI
dependency) so the freeze happens while the world loads. `"jeiEarlyStart": false` turns it off.

## Building (on Windows, Java 25)

One source builds both jars. 26.3 uses `gradle.properties`; 26.2 is given on the
command line:

```
cd hud
gradlew build
gradlew build -Pminecraft_version=26.2 -Pfabric_api_version=0.159.0+26.2 -Pversion=1.1.0+26.2
```

Each build leaves `build/libs/reminthhud-<version>.jar`; copy both jars into the
launcher's `assets/mods/` (and remove the older ones). Reminth reads each jar's
`fabric.mod.json` and installs the one whose Minecraft range fits the instance.
