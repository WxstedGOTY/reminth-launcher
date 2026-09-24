"use strict";
/**
 * Auto-update from this repo's GitHub Releases (electron-updater, "github"
 * provider - owner/repo come from package.json build.publish, which
 * electron-builder bakes into resources/app-update.yml at build time).
 *
 * Flow: check once shortly after the window has loaded -> download in the
 * background -> tell the renderer "ready" -> the player clicks Restart, or
 * it installs on the next normal quit. Everything else (offline, a release
 * with no latest.yml, GitHub rate limits) is logged and otherwise silent:
 * a launcher that nags about its own updater is worse than no updater.
 *
 * A release only counts if it has latest.yml (and Reminth-Setup.exe.blockmap
 * for differential downloads) uploaded next to the installer - both are
 * produced in dist/ by `npm run dist`.
 */
const { app } = require("electron");
const fs = require("fs");
const path = require("path");
const paths = require("./paths");

const LOG_FILE = path.join(paths.ROOT, "updater.log");
const FIRST_CHECK_DELAY_MS = 10 * 1000;

function log(line) {
  try {
    fs.mkdirSync(paths.ROOT, { recursive: true });
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* logging must never break startup */
  }
}

let autoUpdater = null;

/** `notify(channel, payload)` sends to the renderer (main.js's send). */
function init({ notify }) {
  // A dev run (`npm start`) has no app-update.yml, so there's nothing to check.
  if (!app.isPackaged) return;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (err) {
    log(`electron-updater failed to load: ${err.message}`);
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null; // its default logger writes to the console only

  autoUpdater.on("checking-for-update", () => log(`checking (current ${app.getVersion()})`));
  autoUpdater.on("update-not-available", (info) => log(`up to date (latest ${info && info.version})`));
  autoUpdater.on("update-available", (info) => {
    log(`update available: ${info.version}, downloading`);
    notify("update:status", { state: "downloading", version: info.version });
  });
  autoUpdater.on("update-downloaded", (info) => {
    log(`update downloaded: ${info.version}`);
    notify("update:status", { state: "ready", version: info.version });
  });
  autoUpdater.on("error", (err) => log(`error: ${(err && err.message ? err.message : String(err)).split("\n")[0]}`));

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => log(`check failed: ${err.message.split("\n")[0]}`));
  }, FIRST_CHECK_DELAY_MS);
}

/** The renderer's Restart button. No-op unless an update has downloaded. */
function installNow() {
  if (!autoUpdater) return;
  log("restarting to install");
  autoUpdater.quitAndInstall();
}

module.exports = { init, installNow };
