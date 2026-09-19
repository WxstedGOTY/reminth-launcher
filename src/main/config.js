"use strict";

module.exports = {
  // Reminth's own Azure AD app registration - see msAuth.js. Submitted to
  // Microsoft's app-review queue (https://aka.ms/mce-reviewappid) so the
  // Minecraft Services API will accept it; until that clears, sign-in
  // completes through Microsoft/Xbox fine but the final Minecraft token
  // exchange 403s with "Invalid app registration" (a Microsoft-side
  // allowlist, not a bug in this code - see msAuth.js header).
  MS_CLIENT_ID: process.env.REMINTH_MS_CLIENT_ID || "910bc25c-9dbb-4f3e-a249-481f2977efa2",

  MINECRAFT_VERSION: "26.2",
  FABRIC_LOADER_VERSION: "0.19.5",

  MOJANG_VERSION_MANIFEST_URL: "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
  FABRIC_META_URL: "https://meta.fabricmc.net/v2",
  // Fabric API is a mandatory dependency of most Fabric mods (ReminthHUD
  // included). Pulled straight from Fabric's own Maven, the same official
  // channel Fabric loader itself comes from - no third-party mod host.
  FABRIC_MAVEN_URL: "https://maven.fabricmc.net",

  // Optional future path: once ReminthHUD has real hosting, point this at a
  // JSON manifest ({ version, url, sha256 }) and installReminthHud will
  // fetch + auto-update from it. Until then, Reminth bundles whatever jar
  // ships in assets/mods/ (see paths.js).
  REMINTHHUD_UPDATE_MANIFEST_URL: process.env.REMINTH_HUD_MANIFEST_URL || null,

  // Optional open-source Fabric perf mods, bundled alongside ReminthHUD for a
  // real FPS/stutter improvement (the launcher itself can't change FPS -
  // this is the only thing that actually does). Pulled straight from each
  // mod's own GitHub Releases, never Modrinth/CurseForge - Reminth doesn't
  // depend on either. Best-effort: if a mod hasn't published a build for
  // MINECRAFT_VERSION yet, ensureInstalled logs it and moves on rather than
  // failing the whole install (see minecraft.js:downloadPerformanceMods).
  BUNDLE_PERFORMANCE_MODS: process.env.REMINTH_NO_PERF_MODS ? false : true,
  PERFORMANCE_MODS: [
    { owner: "CaffeineMC", repo: "sodium", label: "Sodium" },
    { owner: "CaffeineMC", repo: "lithium", label: "Lithium" },
    // Starlight itself (PaperMC/Starlight) is server-side (Paper) only.
    // ScalableLux is its actual Fabric client port, same lighting-engine
    // rewrite. See https://github.com/RelativityMC/ScalableLux
    { owner: "RelativityMC", repo: "ScalableLux", label: "ScalableLux (Starlight's Fabric port)" },
  ],

  // JVM heap ceiling. Overridable per machine; default is picked at runtime
  // from the player's actual RAM (see minecraft.js:computeDefaultMaxMemoryMb)
  // rather than a single hardcoded value that's wrong for half of players.
  MAX_MEMORY_MB: process.env.REMINTH_MAX_MEMORY_MB
    ? parseInt(process.env.REMINTH_MAX_MEMORY_MB, 10)
    : null,
};
