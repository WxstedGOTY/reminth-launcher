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

  // Reminth's performance pack: mods that make the game run smoother without
  // changing how it plays or looks, put into an instance without the player
  // having to know they exist. Which instances get it: perfPackEnabled below.
  //
  // Source: Modrinth, release builds only (never alpha/beta), sha1-checked,
  // then checked against the instance by the jar's own metadata - see
  // minecraft.js:downloadPerformancePack. A mod with no stable build for the
  // instance's Minecraft version and loader is simply left out and logged in
  // <instance>/reminth-performance-mods.log. The same list works for every
  // Minecraft version: Modrinth is asked for that exact version and loader.
  //
  // Per entry:
  //   slug      Modrinth project slug (checked against Modrinth on 2026-10-03)
  //   label     the name players know it by
  //   ids       mod ids its jars carry (read out of the real jars, not guessed)
  //   conflicts mod ids that can't run next to it - when the player has one
  //             of those enabled, Reminth leaves this entry out
  //   loaders   which instance loaders get it
  //   github    the old GitHub Releases source, used only when Modrinth can't
  //             be reached and nothing was remembered from it (Fabric/Quilt)
  //
  // Reminth's copies step aside for the player's own: if the player has their
  // own copy (same mod id) or a conflicting mod, Reminth's isn't installed.
  // Only files Reminth wrote down in .reminth/managed-mods.json are ever
  // removed; mods the player installs are never touched, whatever they are
  // called (minecraft.js:tidyManagedMods).
  //
  // Deliberately NOT here: C2ME (alpha on every version; it hung "Preparing
  // world" for a real Reminth user), ModernFix-mVUS (a third-party fork),
  // Dynamic FPS (visibly slows the game when unfocused), BadOptimizations and
  // Ixeris (more invasive). Players can add any of them from Discover.
  BUNDLE_PERFORMANCE_MODS: true,
  PERFORMANCE_PACK: [
    // The renderer: the single biggest gain, and what meshes chunks faster
    // at high render distance.
    { slug: "sodium", label: "Sodium", ids: ["sodium"], conflicts: ["embeddium", "rubidium", "magnesium", "optifine", "optifabric", "vulkanmod"], loaders: ["fabric", "quilt", "neoforge"], github: { owner: "CaffeineMC", repo: "sodium" } },
    // Game logic: mostly helps singleplayer (the built-in server).
    { slug: "lithium", label: "Lithium", ids: ["lithium"], conflicts: ["radium", "canary"], loaders: ["fabric", "quilt", "neoforge"], github: { owner: "CaffeineMC", repo: "lithium" } },
    // Less memory used, so fewer garbage-collection hitches.
    { slug: "ferrite-core", label: "FerriteCore", ids: ["ferritecore"], conflicts: [], loaders: ["fabric", "quilt", "neoforge", "forge"] },
    // Draws text, HUD and entities in batches.
    { slug: "immediatelyfast", label: "ImmediatelyFast", ids: ["immediatelyfast"], conflicts: [], loaders: ["fabric", "quilt", "neoforge", "forge"] },
    // Skips entities and block entities hidden behind walls.
    { slug: "entityculling", label: "Entity Culling", ids: ["entityculling"], conflicts: [], loaders: ["fabric", "quilt", "neoforge", "forge"] },
    // Faster start-up and less memory. The official one has no Fabric builds;
    // the Fabric fork carries the same mod id, so a player who has it keeps it.
    { slug: "modernfix", label: "ModernFix", ids: ["modernfix"], conflicts: [], loaders: ["neoforge", "forge"] },
    // Lighting engine. Mostly helps singleplayer and world generation: on a
    // server, the server lights the chunks. Often only alphas exist for the
    // newest Minecraft - then it's simply left out.
    { slug: "scalablelux", label: "ScalableLux", ids: ["scalablelux"], conflicts: ["starlight", "phosphor", "moonrise"], loaders: ["fabric", "quilt", "neoforge"], github: { owner: "RelativityMC", repo: "ScalableLux" } },
    // Forge: the Sodium and Lithium ports (Forge 1.20.1 and older).
    { slug: "embeddium", label: "Embeddium", ids: ["embeddium", "rubidium"], conflicts: ["sodium", "magnesium", "optifine", "vulkanmod"], loaders: ["forge"] },
    { slug: "radium", label: "Radium", ids: ["radium"], conflicts: ["lithium", "canary"], loaders: ["forge"] },
  ],
  // The pack's GitHub fallback, in the shape minecraft.js:downloadPerformanceMods
  // reads. Only the three that publish GitHub Releases; Fabric/Quilt jars only.
  PERFORMANCE_MODS: [
    { owner: "CaffeineMC", repo: "sodium", label: "Sodium" },
    { owner: "CaffeineMC", repo: "lithium", label: "Lithium" },
    { owner: "RelativityMC", repo: "ScalableLux", label: "ScalableLux" },
  ],

  /**
   * The one rule for "does this instance get the performance pack", used by
   * minecraft.js, compat.js, mrpack.js and the renderer alike.
   *  - Fabric/Quilt: on unless the player switched it off.
   *  - Forge/NeoForge: off unless it was switched on. Forge refuses to start
   *    when two jars carry the same mod id, and existing Forge/NeoForge
   *    instances were set up without the pack - so it is only on where the
   *    player (or the create dialog, for a new instance) said so.
   *  - Vanilla: never (nothing loads mods).
   */
  perfPackEnabled(instance) {
    if (!instance || !module.exports.BUNDLE_PERFORMANCE_MODS) return false;
    const loader = instance.loader;
    if (loader === "fabric" || loader === "quilt") return instance.performanceMods !== false;
    if (loader === "forge" || loader === "neoforge") return instance.performanceMods === true;
    return false;
  },

  // Reminth's own mods, shipped inside the app as assets/mods/<filePrefix><version>.jar
  // (one jar per Minecraft version line; the one whose fabric.mod.json
  // "depends.minecraft" fits the instance is copied in at Play - see
  // minecraft.js installBundledMods). Fabric/Quilt only. Never part of the
  // performance pack, never "the player's".
  //   mod        the key in managed-mods.json
  //   flag       the instance field that switches it
  //   defaultOn  what an instance without that field gets: ReminthHUD is
  //              opt-in (hud === true); the home screen is on unless the
  //              player switched it off (homeScreen === false)
  BUNDLED_MODS: [
    { mod: "reminthhud", filePrefix: "reminthhud-", flag: "hud", label: "ReminthHUD", defaultOn: false },
    { mod: "reminthhome", filePrefix: "reminthhome-", flag: "homeScreen", label: "Reminth home screen", defaultOn: true },
  ],

  /** The BUNDLED_MODS entry for a managed-mods key, or null. */
  bundledMod(mod) {
    return module.exports.BUNDLED_MODS.find((e) => e.mod === mod) || null;
  },

  /** Does this instance want this bundled mod (before asking whether a build fits)? */
  bundledModWanted(entry, instance) {
    if (!entry || !instance || (instance.loader !== "fabric" && instance.loader !== "quilt")) return false;
    const value = instance[entry.flag];
    return entry.defaultOn ? value !== false : value === true;
  },

  // JVM heap ceiling. Overridable per machine; default is picked at runtime
  // from the player's actual RAM (see minecraft.js:computeDefaultMaxMemoryMb)
  // rather than a single hardcoded value that's wrong for half of players.
  MAX_MEMORY_MB: process.env.REMINTH_MAX_MEMORY_MB
    ? parseInt(process.env.REMINTH_MAX_MEMORY_MB, 10)
    : null,
};
