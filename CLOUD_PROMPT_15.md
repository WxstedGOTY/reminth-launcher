# Prompt 15 for the code-writing window: ReminthHUD gets the FPS / GPU / CPU / LAT bar

> **DONE - don't send.** The desktop window implemented this itself on 3 Oct 2026 (evening); see DECISIONS_AND_TEST_PLAN.md section 1.

Model: Opus 5.5, effort high (Java 25, Windows system calls, no way to run it in the cloud). Send when the desktop window is idle. The desktop window compiles and tests it.

---

```
Read CLAUDE.md and CLAUDE_CODE_HANDOFF_10.md sections 0-1 (the rules). Pull main first. The source of the
in-game overlay mod now lives in the repo in hud/ (a Fabric/Loom project, Minecraft 26.3, Java 25, Mojang
mappings, CC0). Read hud/src/client/java/com/wxsted/reminthhud/client/ReminthHudClient.java (the whole mod is
that file + ReminthHud.java). You almost certainly cannot compile or run it (no Fabric/Mojang Maven, no
Windows): write it carefully, keep it SMALL, and say plainly what you could not check. The desktop window will
run `gradlew build` on Windows, fix any mapping-name mistakes, and test it in the real game. Do NOT touch
anything outside hud/ except DECISIONS_AND_TEST_PLAN.md (update it as CLAUDE.md says). Commit, push to main.

=== WHAT THE OWNER WANTS ===
A compact status bar like the one in the owner's screenshot, top-RIGHT of the screen, one horizontal line:
    FPS 78  |  GPU 16 %  |  CPU 53 %  |  LAT 0 ms
Dim grey labels (about 60 % white), bright white bold-looking values, thin vertical separators, small text, no
big box (a very faint rounded backdrop at most). It stays toggleable with the existing key (H) together with
the rest of the HUD. The existing top-left box keeps XYZ and Facing; FPS moves out of it into the bar.
 - FPS: Minecraft.getInstance().getFps() (as today).
 - CPU %: whole-PC CPU load. com.sun.management.OperatingSystemMXBean#getCpuLoad() (0.0-1.0; negative means
   "not available yet" -> show "--"); sample about once a second, smooth lightly (mean of the last 3 samples).
 - GPU %: whole-PC GPU load, the figure Task Manager shows. Windows only. Use the Windows Performance Counters
   (PDH) through Java's Foreign Function & Memory API (java.lang.foreign, final in Java 22+, no extra library,
   no JNI, no process spawning): pdh.dll PdhOpenQueryW, PdhAddEnglishCounterW with the wildcard counter
   "\GPU Engine(*)\Utilization Percentage", PdhCollectQueryData once a second, PdhGetFormattedCounterArrayW
   (PDH_FMT_DOUBLE) to read every instance. Task Manager's GPU number = for each ENGINE TYPE (engtype_3D,
   engtype_Compute, engtype_VideoDecode ...) add the utilisation of all processes, then take the largest of
   those sums (cap at 100). Instance names look like "pid_1234_luid_0x..._phys_0_eng_0_engtype_3D": parse the
   engtype from the text after "engtype_". Handle PDH_MORE_DATA (call once with a null buffer to get the size).
   All native calls on ONE background daemon thread; the render thread only reads a volatile int. Never block
   or throw into the game: any failure (non-Windows, counter missing, old Windows, FFI denied, GPU counters
   unsupported) -> the GPU item is simply NOT drawn (and the bar closes up), logged once at INFO. Close the
   query when the client stops. Java 25 may need --enable-native-access for the mod's module; the launcher already
   passes --enable-native-access=ALL-UNNAMED for Mojang's version arguments, but make the code tolerant if a
   restricted-method warning is printed (it must not crash).
 - LAT: the player's latency to the server as the game knows it: Minecraft#getConnection()
   .getPlayerInfo(player.getUUID()).getLatency() (Mojang names - verify against the 26.3 sources; if the
   method names differ, isolate them in ONE small helper so the desktop window can fix them in one place).
   In singleplayer this is 0 -> show "0 ms" exactly like the screenshot. If no connection/player info -> "-- ms".
Show/hide each item with a tiny config file: .minecraft-instance's config/reminthhud.json
({"fps":true,"gpu":true,"cpu":true,"lat":true,"coords":true}), read once at startup with a hand-written
tolerant parser or Gson (Minecraft ships Gson), written with defaults if missing; no UI for it yet.

=== RULES ===
 - Client-side only, no network access, no files other than that config, nothing logged except one INFO line
   per feature that had to be disabled.
 - Rendering code must be cheap: build the strings once a second (when the numbers change), not every frame;
   cache the text width.
 - Do not change fabric.mod.json "environment", the mod id, the key binding, or the version scheme
   (gradle.properties version=1.0.0+26.3; the desktop window builds a second jar for 26.2 by changing
   minecraft_version/fabric_api_version/version and the "minecraft" dependency range).
 - Add short comments in plain words saying WHY (e.g. why the max over engine types).
 - Update hud/README.md (it is out of date: it says WxHUD / 26.2 / not compiled) to describe what the mod
   shows, the config file, and how the desktop window builds and installs it
   (cd hud; gradlew build -> build/libs -> assets/mods/ in the launcher; two jars: 26.2 and 26.3).
 - Update fabric.mod.json "description" to mention FPS, GPU, CPU and latency.

When done: push, update DECISIONS_AND_TEST_PLAN.md (what changed, decisions with recommendations, a numbered
PASS/FAIL plan for the desktop window: build on Windows; in game the bar shows four values; GPU and CPU move
when the game is busy and agree roughly with Task Manager; LAT 0 in singleplayer and a real number on a server;
H hides/shows it; the GPU item disappears cleanly when the counter is unavailable; config toggles), and tell me
(a) what you could not compile or test, (b) every file you touched.
```
