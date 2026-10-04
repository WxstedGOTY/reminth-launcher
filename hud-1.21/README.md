# ReminthHUD for Minecraft 1.21.x

The same bar as `../hud` (FPS | GPU | CPU | LAT, plain small grey text, top-right, `H` toggles it,
`config/reminthhud.json` picks the items, JEI starts right after joining), written for the older
(obfuscated, Java 21) Minecraft versions. One folder builds ONE Minecraft version.

Differences from `../hud` (26.x):
- Built with Loom's remapping plugin and Mojang's mappings; `GuiGraphics` / `HudRenderCallback`.
- The GPU number is read through JNA (Minecraft ships it) instead of Java's foreign-function API,
  which is only a preview feature on Java 21.

Build (Windows, any Java 21+): `gradlew build` -> `build/libs/reminthhud-<version>.jar`, copy it into
the launcher's `assets/mods/`. Currently: **1.21.1** (`gradle.properties`: `minecraft_version`,
`fabric_api_version`, `version`). Reminth installs the jar whose `minecraft` range fits the instance.
