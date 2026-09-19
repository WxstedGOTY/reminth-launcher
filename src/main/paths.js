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
  JAVA_DIR: path.join(ROOT, "java"),
  ACCOUNTS_FILE: path.join(ROOT, "account.json"),
  // ReminthHUD jar(s) bundled with the Reminth app itself, at assets/mods/
  // in the repo. Ships with zero hosting required; see
  // config.REMINTHHUD_UPDATE_MANIFEST_URL for the future hosted-update path.
  REMINTHHUD_ASSET_DIR: path.join(__dirname, "..", "..", "assets", "mods"),
};
