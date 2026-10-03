"use strict";
/**
 * Auto-update from this repo's GitHub Releases (electron-updater, "github"
 * provider - owner/repo come from package.json build.publish, which
 * electron-builder bakes into resources/app-update.yml at build time).
 *
 * Flow: check shortly after the window has loaded, and again every 6 hours
 * while Reminth stays open -> download in the background -> tell the
 * renderer "ready" -> the player clicks Restart, or it installs on the next
 * normal quit. Automatic checks are quiet: nothing new, offline, a release
 * with no latest.yml, GitHub rate limits - all of that only goes to
 * updater.log. Only a check the player asked for (Settings -> Check for
 * updates) answers "up to date" or says what went wrong.
 *
 * A running game is never interrupted: no automatic check or download
 * starts while one runs, "Restart and update" is refused, and installing on
 * quit is put off to the next quit with no game running.
 *
 * The installer is unsigned (no code-signing certificate). Nothing here
 * pretends otherwise.
 *
 * A release only counts if it has latest.yml (and Reminth-Setup.exe.blockmap
 * for differential downloads) uploaded next to the installer - both are
 * produced in dist/ by `npm run dist`.
 */
const fs = require("fs");
const path = require("path");

const FIRST_CHECK_DELAY_MS = 10 * 1000;
const RECHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const RELEASES_URL = "https://github.com/WxstedGOTY/reminth-launcher/releases/latest";

/** Pure: a plain sentence for an updater error (the raw one goes to the log). */
function friendlyUpdateError(err) {
  const m = String((err && (err.message || err.code)) || err || "");
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NETWORK_CHANGED|CONNECTION|TIMED_OUT|PROXY)|socket hang up|getaddrinfo|network/i.test(m)) {
    return "Couldn't check for updates - are you online?";
  }
  if (/\b403\b|rate limit/i.test(m)) return "GitHub is limiting requests right now - try again in an hour, or download it manually.";
  if (/\b404\b|latest\.yml|Cannot find .*\.yml|No published versions/i.test(m)) return "Couldn't find the update files on GitHub - download it manually instead.";
  if (/sha512 checksum mismatch|checksum/i.test(m)) return "The downloaded update didn't check out, so it wasn't kept - try again, or download it manually.";
  return "Couldn't check for updates - try again later, or download it manually.";
}

/**
 * The updater, with everything it touches passed in (tests use fakes):
 *   app            { isPackaged, getVersion(), on(event, fn) }
 *   loadUpdater()  -> electron-updater's autoUpdater (throws if it can't load)
 *   notify(channel, payload)   to the renderer
 *   isGameRunning() -> boolean
 *   log(line)
 *   timers         { setTimeout, setInterval, clearTimeout, clearInterval }
 */
function createUpdater({ app, loadUpdater, notify = () => {}, isGameRunning = () => false, log = () => {}, timers = global, firstDelayMs = FIRST_CHECK_DELAY_MS, recheckMs = RECHECK_EVERY_MS }) {
  let au = null;
  let started = false;
  let manual = false; // the check (and download) running now was asked for by the player
  let checking = null; // the in-flight checkForUpdates promise
  let lastPercent = -1;
  let current = { state: "idle", currentVersion: safeVersion() };
  const handles = [];

  function safeVersion() {
    try {
      return app.getVersion();
    } catch {
      return null;
    }
  }
  const set = (next, { tell = true } = {}) => {
    current = { currentVersion: safeVersion(), ...next };
    if (tell) {
      try {
        notify("update:status", { ...current, manual });
      } catch {
        // a closed window just doesn't get told
      }
    }
    return current;
  };
  const snapshot = () => ({ ...current });

  function wire() {
    au.autoDownload = true;
    au.autoInstallOnAppQuit = true;
    au.logger = null; // its default logger writes to the console only
    au.on("checking-for-update", () => {
      log(`checking (current ${safeVersion()})`);
      set({ state: "checking" }, { tell: manual });
    });
    au.on("update-not-available", (info) => {
      log(`up to date (latest ${info && info.version})`);
      set({ state: "up-to-date", version: (info && info.version) || safeVersion() }, { tell: manual });
      manual = false;
    });
    au.on("update-available", (info) => {
      log(`update available: ${info && info.version}, downloading`);
      lastPercent = 0;
      set({ state: "downloading", version: info && info.version, percent: 0 });
    });
    au.on("download-progress", (p) => {
      const percent = Math.max(0, Math.min(100, Math.floor(Number(p && p.percent) || 0)));
      if (percent === lastPercent || current.state !== "downloading") return;
      lastPercent = percent;
      set({ state: "downloading", version: current.version, percent });
    });
    au.on("update-downloaded", (info) => {
      log(`update downloaded: ${info && info.version}`);
      manual = false;
      set({ state: "ready", version: info && info.version });
    });
    au.on("error", (err) => {
      const raw = (err && err.message ? err.message : String(err)).split("\n")[0];
      log(`error: ${raw}`);
      if (current.state === "ready") return; // the update already in hand still installs
      if (manual) {
        set({ state: "error", message: friendlyUpdateError(err), url: RELEASES_URL });
      } else if (current.state === "downloading") {
        // An automatic download that failed: the bar goes away quietly.
        set({ state: "idle" });
      } else {
        set({ state: "idle" }, { tell: false });
      }
      manual = false;
    });
    // Installing on quit closes Reminth and runs the installer. Never with a
    // game running: it waits for a quit with no game open.
    app.on("before-quit", () => {
      const playing = isGameRunning();
      au.autoInstallOnAppQuit = !playing;
      if (playing && current.state === "ready") log("quit with a game running - update left for the next quit");
    });
  }

  /** Starts the automatic checks. Safe to call more than once. */
  function start() {
    if (started) return;
    started = true;
    if (!app.isPackaged) return; // a dev run (`npm start`) has no app-update.yml
    try {
      au = loadUpdater();
    } catch (err) {
      log(`electron-updater failed to load: ${err && err.message}`);
      au = null;
      return;
    }
    wire();
    handles.push(timers.setTimeout(() => autoCheck(), firstDelayMs));
    handles.push(timers.setInterval(() => autoCheck(), recheckMs));
  }

  /** The quiet check: skipped while a game runs, or when there's nothing to ask. */
  function autoCheck() {
    if (!au || checking || ["checking", "downloading", "ready"].includes(current.state)) return null;
    if (isGameRunning()) {
      log("automatic check skipped - a game is running");
      return null;
    }
    return runCheck(false);
  }

  function runCheck(byPlayer) {
    manual = byPlayer;
    checking = Promise.resolve()
      .then(() => au.checkForUpdates())
      .then(() => snapshot())
      .catch((err) => {
        log(`check failed: ${String((err && err.message) || err).split("\n")[0]}`);
        if (byPlayer && current.state !== "error") set({ state: "error", message: friendlyUpdateError(err), url: RELEASES_URL });
        else if (!byPlayer && current.state === "checking") set({ state: "idle" }, { tell: false });
        manual = false;
        return snapshot();
      })
      .finally(() => {
        checking = null;
      });
    return checking;
  }

  /** "Check for updates" in Settings. Always resolves with the state; never throws. */
  async function check() {
    if (!app.isPackaged) return { state: "dev", currentVersion: safeVersion(), message: "Updates only work in the installed app." };
    if (!au) return { state: "error", currentVersion: safeVersion(), message: "The updater couldn't start - download the new version manually.", url: RELEASES_URL };
    // Already on it, or already done: say where it is rather than start again.
    if (["downloading", "ready"].includes(current.state)) {
      manual = manual || current.state === "downloading";
      return snapshot();
    }
    if (checking) {
      manual = true;
      return checking;
    }
    manual = true;
    set({ state: "checking" });
    return runCheck(true);
  }

  /** The Restart button. Refused while a game runs; a no-op unless an update is ready. */
  function installNow() {
    if (isGameRunning()) return { ok: false, reason: "Close Minecraft first." };
    if (!au || current.state !== "ready") return { ok: false, reason: "No update is ready yet." };
    log("restarting to install");
    au.quitAndInstall();
    return { ok: true };
  }

  function stop() {
    for (const h of handles) {
      try {
        timers.clearTimeout(h);
        timers.clearInterval(h);
      } catch {
        // already gone
      }
    }
    handles.length = 0;
  }

  const getState = () => (app.isPackaged ? snapshot() : { state: "dev", currentVersion: safeVersion(), message: "Updates only work in the installed app." });
  return { start, check, autoCheck, installNow, getState, stop };
}

/* ---- the one updater main.js uses ---- */

let instance = null;

function logLine(line) {
  try {
    const paths = require("./paths");
    fs.mkdirSync(paths.ROOT, { recursive: true });
    fs.appendFileSync(path.join(paths.ROOT, "updater.log"), `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* logging must never break startup */
  }
}

function ensure(options = {}) {
  if (!instance) {
    const { app } = require("electron");
    instance = createUpdater({
      app,
      loadUpdater: () => require("electron-updater").autoUpdater,
      log: logLine,
      ...options,
    });
  }
  return instance;
}

/** `notify(channel, payload)` sends to the renderer; `isGameRunning()` asks main.js. */
function init({ notify, isGameRunning } = {}) {
  ensure({ notify, isGameRunning }).start();
}

async function check() {
  try {
    return await ensure().check();
  } catch (err) {
    logLine(`check threw: ${err && err.message}`);
    return { state: "error", message: friendlyUpdateError(err), url: RELEASES_URL };
  }
}

function installNow() {
  try {
    return ensure().installNow();
  } catch (err) {
    logLine(`install threw: ${err && err.message}`);
    return { ok: false, reason: "Couldn't start the update - download it manually." };
  }
}

function getState() {
  return instance ? instance.getState() : { state: "idle" };
}

module.exports = { init, check, installNow, getState, createUpdater, friendlyUpdateError, RELEASES_URL, RECHECK_EVERY_MS, FIRST_CHECK_DELAY_MS };
