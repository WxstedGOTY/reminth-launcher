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

  // Reminth installs exactly two mods: ReminthHUD, and the Fabric API it
  // needs to load at all. Nothing else.
  //
  // Earlier builds also auto-installed a performance pack (Sodium, Lithium,
  // ScalableLux). That's been removed on purpose: which mods run in a
  // player's game is the player's decision, not the launcher's - even when
  // the mods are good ones. minecraft.js:tidyManagedMods also deletes those
  // jars from instances that already have them, so nobody is left with mods
  // they never chose. Mods the player installs themselves are never touched.
  BUNDLE_PERFORMANCE_MODS: false,

  // JVM heap ceiling. Overridable per machine; default is picked at runtime
  // from the player's actual RAM (see minecraft.js:computeDefaultMaxMemoryMb)
  // rather than a single hardcoded value that's wrong for half of players.
  MAX_MEMORY_MB: process.env.REMINTH_MAX_MEMORY_MB
    ? parseInt(process.env.REMINTH_MAX_MEMORY_MB, 10)
    : null,
};
