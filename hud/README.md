# WxHUD

A minimal Fabric client mod for Minecraft 26.2. Adds a toggleable overlay
(FPS, coordinates, facing direction) in the top-left of the screen.

- Toggle key: **H** (rebindable in Options > Controls > Key Binds > WxHUD)
- Client-side only — no effect on servers, safe to use anywhere

This was scaffolded from the official Fabric example mod template and
verified against the current (26.1.2/26.2) Fabric API docs, but it has
**not been compiled** — the build environment that generated it has no
network access to Fabric's/Mojang's Maven repos. Building it locally
(step 4 below) is the real first-compile check. If it doesn't build
clean, feed the exact error to Claude Code — these are almost always a
one-line fix (an import path or a renamed method).

## Setup

1. **Install JDK 25.** Minecraft 26.x requires it (up from Java 21).
   Get the Microsoft Build of OpenJDK 25, or any JDK 25 distro.
   Check with: `java -version`

2. **Install IntelliJ IDEA** (Community edition is free) — the standard
   IDE for Fabric dev, has the best Gradle/Loom support.

3. **Open this folder** in IntelliJ as a Gradle project. Let it sync —
   first sync downloads Minecraft + Fabric API + mappings, takes a
   few minutes.

4. **Run it.** Either:
   - IntelliJ: open the Gradle tab > Tasks > fabric > `runClient`
   - Terminal: `./gradlew runClient` (Linux/Mac) or `gradlew.bat runClient` (Windows)

   This launches a real dev instance of Minecraft with the mod loaded.
   Join any world or server and press **H**.

## Project layout

- `src/main/java/com/wxsted/wxhud/WxHud.java` — main entrypoint (runs everywhere)
- `src/client/java/com/wxsted/wxhud/client/WxHudClient.java` — client entrypoint,
  where the actual HUD rendering and keybind logic lives
- `src/main/resources/fabric.mod.json` — mod metadata Fabric Loader reads
- `gradle.properties` — Minecraft/Fabric/loader version pins

## Extending it

The render logic is one method, `WxHudClient#render`. Add more lines to
the `lines` array to show more info (ping, biome, light level, whatever).
Everything else (background box, positioning) already scales with the
array length.

## Publishing

Once it builds and runs clean, `./gradlew build` produces a jar in
`build/libs/`. That jar is what you'd upload to Modrinth/CurseForge.
