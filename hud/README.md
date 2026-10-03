# ReminthHUD

The small in-game overlay Reminth puts into Fabric instances (Minecraft 26.2 and 26.3).
Client-side only, CC0.

## What it shows

- **Top-right bar:** `FPS 240 | GPU 16 % | CPU 53 % | LAT 0 ms`
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
- **Under the bar:** coordinates and the direction you're facing. Everything stays in the
  top-right corner because minimap mods (Xaero's, JourneyMap) use the top-left.
- **H** shows/hides everything (rebindable in Controls).

## Config

`config/reminthhud.json` in the instance, written with everything on the first time:

```json
{ "fps": true, "gpu": true, "cpu": true, "lat": true, "coords": true }
```

Set an item to `false` to hide it. Read once when the game starts.

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
