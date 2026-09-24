"use strict";
const path = require("path");
const os = require("os");

// Reminth is a fully standalone launcher: its own Microsoft/Xbox sign-in
// (msAuth.js), its own bundled Java (java.js), its own private game
// directory - no official Minecraft Launcher, no Modrinth App, no other
// third-party launcher required or referenced. Everything lives under
// %APPDATA%\Reminth, separate from the real .minecraft folder so Reminth
// never touches a player's existing vanilla installation.
const ROOT = path.join(os.homedir(), "AppData", "Roaming", "Reminth");
const INSTANCE_DIR = path.join(ROOT, "instance");

module.exports = {
  ROOT,
  INSTANCE_DIR,
  VERSIONS_DIR: path.join(INSTANCE_DIR, "versions"),
  LIBRARIES_DIR: path.join(INSTANCE_DIR, "libraries"),
  NATIVES_DIR: path.join(INSTANCE_DIR, "natives"),
  ASSETS_DIR: path.join(INSTANCE_DIR, "assets"),
  GAME_DIR: path.join(INSTANCE_DIR, "game"), // cwd Minecraft runs in - saves/, options.txt, logs/ live here
  // Fabric's KnotClient looks for a "mods" folder relative to the game's
  // working directory (cwd, which launch() sets to GAME_DIR) - NOT relative
  // to the instance root. MODS_DIR must be nested inside GAME_DIR or every
  // mod we download (Fabric API, ReminthHUD) would sit unused on disk and
  // never actually load into the running game.
  MODS_DIR: path.join(INSTANCE_DIR, "game", "mods"),
  // Same story as mods: Minecraft looks for resourcepacks/ relative to the
  // game's working directory, so it lives inside GAME_DIR too.
  RESOURCEPACKS_DIR: path.join(INSTANCE_DIR, "game", "resourcepacks"),
  // Read-only, for the Home and Player Statistics pages - see gameData.js.
  SAVES_DIR: path.join(INSTANCE_DIR, "game", "saves"),
  SERVERS_FILE: path.join(INSTANCE_DIR, "game", "servers.dat"),
  LOGS_DIR: path.join(INSTANCE_DIR, "game", "logs"),
  JAVA_DIR: path.join(ROOT, "java"),
  // Mojang's own Java runtimes (jre-legacy for 1.16 and older, java-runtime-*
  // for newer), one folder per component - see javaRuntime.js. JAVA_DIR above
  // is the original JDK 25 install and is still reused for Java 25 versions
  // so nobody re-downloads 200MB they already have.
  RUNTIMES_DIR: path.join(ROOT, "runtimes"),
  // Every instance except the original one lives here, one folder each
  // (that folder IS its game directory: mods/, saves/, logs/...). The
  // original "Reminth" instance keeps living at GAME_DIR above so nobody's
  // existing worlds move. See instances.js.
  INSTANCES_DIR: path.join(ROOT, "instances"),
  INSTANCES_FILE: path.join(ROOT, "instances.json"),
  // Permanent copies of every game log, per instance. Minecraft rolls and
  // (depending on version) prunes its own logs/ folder; these never get
  // deleted by Reminth. See logs.js.
  LOG_ARCHIVE_DIR: path.join(ROOT, "log-archive"),
  // The player's saved skins ("skins you've worn before") - see skinLibrary.js.
  SKIN_LIBRARY_DIR: path.join(ROOT, "skins"),
  // Streamer mode: rolling replay buffer segments (temporary, pruned
  // continuously) and where finished screenshots/clips are saved.
  REPLAY_BUFFER_DIR: path.join(ROOT, "replay-buffer"),
  CAPTURES_DIR: path.join(os.homedir(), "Videos", "Reminth"),
  ACCOUNTS_FILE: path.join(ROOT, "account.json"),
  SETTINGS_FILE: path.join(ROOT, "settings.json"),
  SKIN_CACHE_DIR: path.join(ROOT, "skin-cache"),
  // Local metadata cache of the Modrinth catalog (project summaries only -
  // never the actual mod jars), one JSON file per project type. See
  // src/main/catalogCache.js. Lives outside INSTANCE_DIR since it's
  // launcher state, not game state.
  CATALOG_CACHE_DIR: path.join(ROOT, "catalog-cache"),
  // ReminthHUD jar(s) bundled with the Reminth app itself, at assets/mods/
  // in the repo. Ships with zero hosting required; see
  // config.REMINTHHUD_UPDATE_MANIFEST_URL for the future hosted-update path.
  REMINTHHUD_ASSET_DIR: path.join(__dirname, "..", "..", "assets", "mods"),
};
