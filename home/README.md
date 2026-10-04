# Reminth home screen (`reminthhome`)

The game's title screen, Reminth style: a night panorama that turns by itself (the game's own panorama
code, with our six pictures), near-black rounded buttons for Singleplayer and Multiplayer, up to two
saved-server shortcuts, and a row of icons at the bottom middle (Skins, Mods if Mod Menu is installed,
Options, Language, Quit).

Reminth installs it into every Fabric/Quilt instance (switch "Reminth home screen" in the instance
settings). Nothing here talks to the internet. **Skins** opens `reminth://skins`, which the Reminth
launcher answers by showing its Skins page (a skin can only be changed from the launcher).

## Safety

- It is the vanilla `TitleScreen` with other buttons (a subclass), so the logo, splash, version text and
  panorama are the game's own. A small mixin swaps exactly the vanilla `TitleScreen` for ours on
  `setScreen`; screens of other mods are left alone.
- If building our buttons or drawing the screen throws anything, one line goes to the log and the game
  carries on with the normal title screen (from then on for that session).
- `config/reminthhome.json` `{"enabled": false}` gives the normal title screen back (the six panorama
  pictures still come from this mod; remove the mod to get the vanilla ones too).
- Needs Fabric API (it loads the mod's pictures; Reminth installs it when missing); no network; the only thing it starts is the operating system's handler for
  the fixed link `reminth://skins`.

## Building (Windows, Java 25)

One source, three version families for 26.x (1.20.1 and 1.21.x are in `../home-1.21`, same code) (the few calls that differ live in `compat/<family>/`):

```
cd home
gradlew build                                                                      (A: 26.2)
gradlew build -Pcompat=B -Pminecraft_version=26.3 -Pversion=1.0.0+26.3             (B: 26.3)
gradlew build -Pcompat=C -Pminecraft_version=26.1 -Pversion=1.0.0+26.1 -Pmc_range="~26.1"  (C: 26.1, 26.1.1, 26.1.2)
```

Each build leaves `build/libs/reminthhome-<version>.jar`; copy it to the launcher's `assets/mods/`.
Reminth reads each jar's `fabric.mod.json` and installs the one whose Minecraft range fits.

## Pictures

`src/main/resources/assets/minecraft/textures/gui/title/background/panorama_0..5.png` are made on the
owner's PC with Minecraft + Iris + Complementary Reimagined, blurred lightly and brightened
(`tools` live outside the repo). Icons: `java IconGen.java <outDir>` draws them.
