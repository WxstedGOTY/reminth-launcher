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

  // Reminth ships a default performance pack on every Fabric/Quilt instance:
  // players shouldn't have to know Sodium/Lithium exist to get a smooth
  // game. Each entry is fetched straight from the project's own GitHub
  // Releases (see minecraft.js:downloadPerformanceMods /
  // fetchLatestGithubAssetForVersion) - never Modrinth/CurseForge, so
  // Reminth has no runtime dependency on either. A missing build for the
  // current MINECRAFT_VERSION, or any network/parse failure, is logged and
  // skipped per-mod rather than failing the whole install.
  //
  // Per-instance opt-out lives on the instance itself (instance.performanceMods
  // === false); when a player turns it off, minecraft.js:tidyManagedMods
  // removes these same jars via LEGACY_AUTO_INSTALLED so nobody is left with
  // mods they didn't choose. Mods the player installs themselves are never
  // touched - this only ever manages the jars Reminth itself put there.
  BUNDLE_PERFORMANCE_MODS: true,
  PERFORMANCE_MODS: [
    { owner: "CaffeineMC", repo: "sodium", label: "Sodium" },
    { owner: "CaffeineMC", repo: "lithium", label: "Lithium" },
    // Starlight rewrite of the lighting engine, ported to Fabric - this is
    // the one that actually kills the "new chunks loading = stutter" spike,
    // not Sodium/Lithium (those don't touch lighting).
    { owner: "RelativityMC", repo: "ScalableLux", label: "ScalableLux" },
    // Parallelizes chunk generation/loading across threads - targets the
    // "just opened N chunks of render distance" case specifically.
    { owner: "RelativityMC", repo: "C2ME-fabric", label: "C2ME" },
    // Smaller in-memory block/fluid state representation - less RAM, fewer
    // and shorter GC pauses on top of the G1 tuning below.
    { owner: "malte0811", repo: "FerriteCore", label: "FerriteCore" },
  ],

  // JVM heap ceiling. Overridable per machine; default is picked at runtime
  // from the player's actual RAM (see minecraft.js:computeDefaultMaxMemoryMb)
  // rather than a single hardcoded value that's wrong for half of players.
  MAX_MEMORY_MB: process.env.REMINTH_MAX_MEMORY_MB
    ? parseInt(process.env.REMINTH_MAX_MEMORY_MB, 10)
    : null,
};
