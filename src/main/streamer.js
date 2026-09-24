"use strict";
/**
 * Streamer mode: hotkey screenshots of the game window, and a Medal-style
 * replay buffer - while Minecraft runs, the last N seconds (30s to 30 min,
 * the player's choice) are always recorded, and the clip hotkey saves them.
 *
 * Only the Minecraft window is captured, never the whole desktop, so a
 * Discord DM popping up on another monitor doesn't end up in a clip. The
 * optional audio is the system mix (what you hear), which is how every
 * replay tool works on Windows.
 *
 * The recording itself happens in a hidden window (src/recorder) using
 * Chromium's own encoder, as a rolling set of short WebM segments on disk
 * (paths.REPLAY_BUFFER_DIR). Old segments are deleted as new ones arrive,
 * so disk use stays at roughly the chosen clip length. A clip is those
 * segments joined into one file by webm.js - no ffmpeg shipped.
 */
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { BrowserWindow, desktopCapturer, globalShortcut, ipcMain, Notification, shell } = require("electron");

const paths = require("./paths");
const webm = require("./webm");

const SEGMENT_MS = 10000;
const BITRATES = { low: 3500000, medium: 6000000, high: 10000000 };

let config = null; // settings.streamer
let enabled = false;
let gameCount = 0;
let recorderWin = null;
let recording = false;
let findTimer = null;
let segments = []; // { n, file, startMs, endMs|null }
let writeQueues = new Map(); // n -> Promise
let notifyUi = () => {};
let lastError = null;

function captureDirs() {
  return {
    clips: path.join(paths.CAPTURES_DIR, "Clips"),
    screenshots: path.join(paths.CAPTURES_DIR, "Screenshots"),
  };
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function status() {
  return {
    enabled,
    recording,
    gameRunning: gameCount > 0,
    bufferedSeconds: bufferedSeconds(),
    error: lastError,
    capturesDir: paths.CAPTURES_DIR,
  };
}

function bufferedSeconds() {
  const closed = segments.filter((s) => s.endMs);
  const open = segments.find((s) => !s.endMs);
  if (!segments.length) return 0;
  const first = segments[0].startMs;
  const last = open ? Date.now() : closed.length ? closed[closed.length - 1].endMs : first;
  return Math.max(0, Math.round((last - first) / 1000));
}

function pushStatus() {
  notifyUi("streamer:status", status());
}

/* ------------------------------------------------------------------ */
/* setup                                                              */
/* ------------------------------------------------------------------ */

function init({ notify }) {
  notifyUi = notify;
  ipcMain.on("rec:segment-begin", (e, { seg, startMs }) => {
    if (!isRecorder(e)) return;
    segments.push({ n: seg, file: path.join(paths.REPLAY_BUFFER_DIR, `seg-${seg}.webm`), startMs, endMs: null });
    prune();
  });
  ipcMain.on("rec:chunk", (e, { seg, data }) => {
    if (!isRecorder(e)) return;
    const s = segments.find((x) => x.n === seg);
    if (!s || !data) return;
    const prev = writeQueues.get(seg) || Promise.resolve();
    const next = prev.then(() => fsp.appendFile(s.file, Buffer.from(data))).catch(() => {});
    writeQueues.set(seg, next);
  });
  ipcMain.on("rec:segment-end", (e, { seg, endMs }) => {
    if (!isRecorder(e)) return;
    const s = segments.find((x) => x.n === seg);
    if (s) s.endMs = endMs;
    pushStatus();
  });
  ipcMain.on("rec:state", (e, { running, error }) => {
    if (!isRecorder(e)) return;
    recording = Boolean(running);
    lastError = error || null;
    pushStatus();
  });
}

function isRecorder(event) {
  return recorderWin && !recorderWin.isDestroyed() && event.sender === recorderWin.webContents;
}

function configure(settings) {
  const nextEnabled = Boolean(settings.streamerMode);
  const nextConfig = settings.streamer;
  const qualityChanged =
    config && (config.fps !== nextConfig.fps || config.quality !== nextConfig.quality || config.audio !== nextConfig.audio);
  config = nextConfig;
  const hotkeyProblems = registerHotkeys(nextEnabled);
  if (nextEnabled !== enabled) {
    enabled = nextEnabled;
    if (enabled && gameCount > 0) startRecorder();
    if (!enabled) stopRecorder();
  } else if (enabled && recording && qualityChanged) {
    stopRecorder().then(() => startRecorder());
  }
  prune();
  pushStatus();
  return { hotkeyProblems };
}

function registerHotkeys(on) {
  globalShortcut.unregisterAll();
  const problems = [];
  if (!on || !config) return problems;
  const bind = (key, fn, label) => {
    if (!key) return;
    try {
      if (!globalShortcut.register(key, fn)) problems.push(`${label} (${key}) is already used by another app`);
    } catch {
      problems.push(`${label} (${key}) isn't a valid key`);
    }
  };
  bind(config.screenshotKey, () => takeScreenshot().catch(() => {}), "Screenshot");
  bind(config.clipKey, () => saveClip().catch(() => {}), "Clip");
  return problems;
}

/* ------------------------------------------------------------------ */
/* game lifecycle                                                      */
/* ------------------------------------------------------------------ */

function gameStarted() {
  gameCount++;
  if (enabled) startRecorder();
  pushStatus();
}

function gameStopped() {
  gameCount = Math.max(0, gameCount - 1);
  if (gameCount === 0) stopRecorder();
  pushStatus();
}

async function findGameSource() {
  const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 0, height: 0 } });
  return sources.find((s) => /^Minecraft/i.test(s.name) && !/launcher/i.test(s.name)) || null;
}

async function startRecorder() {
  if (recording || findTimer || !enabled) return;
  // The game window only appears a few seconds after the process starts.
  const tryFind = async () => {
    findTimer = null;
    if (!enabled || gameCount === 0) return;
    let source = null;
    try {
      source = await findGameSource();
    } catch {
      source = null;
    }
    if (!source) {
      findTimer = setTimeout(tryFind, 3000);
      return;
    }
    await fsp.mkdir(paths.REPLAY_BUFFER_DIR, { recursive: true });
    await clearBuffer();
    if (!recorderWin || recorderWin.isDestroyed()) {
      recorderWin = new BrowserWindow({
        show: false,
        width: 320,
        height: 240,
        webPreferences: {
          preload: path.join(__dirname, "recorderPreload.js"),
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
        },
      });
      await recorderWin.loadFile(path.join(__dirname, "..", "recorder", "recorder.html"));
    }
    recorderWin.webContents.send("rec:start", {
      sourceId: source.id,
      fps: config.fps,
      videoBitsPerSecond: BITRATES[config.quality] || BITRATES.high,
      audio: Boolean(config.audio),
      segmentMs: SEGMENT_MS,
      maxWidth: 1920,
      maxHeight: 1080,
    });
  };
  await tryFind();
}

async function stopRecorder() {
  clearTimeout(findTimer);
  findTimer = null;
  if (recorderWin && !recorderWin.isDestroyed()) {
    recorderWin.webContents.send("rec:stop");
    await new Promise((r) => setTimeout(r, 800)); // let the last segment flush
  }
  recording = false;
  pushStatus();
}

async function clearBuffer() {
  segments = [];
  writeQueues = new Map();
  try {
    for (const f of await fsp.readdir(paths.REPLAY_BUFFER_DIR)) {
      if (/^seg-\d+\.webm$/.test(f)) await fsp.rm(path.join(paths.REPLAY_BUFFER_DIR, f), { force: true });
    }
  } catch {
    // nothing to clear
  }
}

/** Deletes segments that are older than any clip could need. */
function prune() {
  if (!config) return;
  const keepFrom = Date.now() - (config.clipSeconds * 1000 + SEGMENT_MS * 2);
  const drop = segments.filter((s) => s.endMs && s.endMs < keepFrom);
  segments = segments.filter((s) => !drop.includes(s));
  for (const s of drop) {
    const q = writeQueues.get(s.n) || Promise.resolve();
    writeQueues.delete(s.n);
    q.then(() => fsp.rm(s.file, { force: true })).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* captures                                                           */
/* ------------------------------------------------------------------ */

function toast(title, body) {
  notifyUi("streamer:saved", { title, body });
  if (config && config.notify && Notification.isSupported()) {
    new Notification({ title, body, silent: true }).show();
  }
}

async function takeScreenshot() {
  const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 3840, height: 2160 } });
  const game = sources.find((s) => /^Minecraft/i.test(s.name) && !/launcher/i.test(s.name));
  if (!game || game.thumbnail.isEmpty()) {
    toast("No screenshot taken", "Minecraft isn't running (or its window is minimized).");
    return { error: "Minecraft isn't running." };
  }
  const dir = captureDirs().screenshots;
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, `Reminth-${stamp()}.png`);
  await fsp.writeFile(file, game.thumbnail.toPNG());
  toast("Screenshot saved", path.basename(file));
  return { file };
}

let clipping = false;
async function saveClip() {
  if (clipping) return { error: "Already saving a clip." };
  if (!segments.length) {
    toast("No clip saved", enabled ? "Nothing's been recorded yet - the buffer starts when Minecraft opens." : "Turn on streamer mode first.");
    return { error: "Nothing recorded yet." };
  }
  clipping = true;
  const requestedAt = Date.now();
  try {
    // Close the segment being written right now so the clip reaches "now".
    const open = segments.find((s) => !s.endMs);
    if (open && recorderWin && !recorderWin.isDestroyed()) {
      recorderWin.webContents.send("rec:rotate");
      const deadline = Date.now() + 4000;
      while (!open.endMs && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    }
    const closed = segments.filter((s) => s.endMs).sort((a, b) => a.startMs - b.startMs);
    await Promise.all(closed.map((s) => writeQueues.get(s.n) || Promise.resolve()));
    const dir = captureDirs().clips;
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, `Reminth-clip-${stamp(new Date(requestedAt))}.webm`);
    const { durationMs } = await webm.joinSegments(closed, requestedAt - config.clipSeconds * 1000, file);
    const secs = Math.round(durationMs / 1000);
    toast("Clip saved", `Last ${secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`} · ${path.basename(file)}`);
    return { file, durationMs };
  } catch (err) {
    toast("Clip failed", err.message);
    return { error: err.message };
  } finally {
    clipping = false;
  }
}

/** Every capture: Reminth's clips and screenshots, plus each instance's own F2 screenshots. */
async function listCaptures(instanceList) {
  const out = [];
  const dirs = captureDirs();
  const scan = async (dir, type, source, instanceName) => {
    let names;
    try {
      names = await fsp.readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (type === "clip" ? !/\.webm$/i.test(name) : !/\.png$/i.test(name)) continue;
      const full = path.join(dir, name);
      try {
        const st = await fsp.stat(full);
        out.push({ path: full, url: require("url").pathToFileURL(full).href, type, source, instanceName: instanceName || null, name, size: st.size, date: Math.round(st.mtimeMs) });
      } catch {
        // vanished
      }
    }
  };
  await scan(dirs.clips, "clip", "reminth");
  await scan(dirs.screenshots, "screenshot", "reminth");
  for (const inst of instanceList || []) await scan(path.join(inst.gameDir, "screenshots"), "screenshot", "game", inst.name);
  return out.sort((a, b) => b.date - a.date);
}

/** Only files inside a capture folder may be opened/deleted through here. */
function assertCapturePath(file, instanceList) {
  const full = path.resolve(String(file || ""));
  const roots = [paths.CAPTURES_DIR, ...(instanceList || []).map((i) => path.join(i.gameDir, "screenshots"))].map((r) => path.resolve(r) + path.sep);
  if (!roots.some((r) => full.startsWith(r)) || !/\.(png|webm)$/i.test(full)) throw new Error("That isn't one of your captures.");
  return full;
}

async function openCapture(file, instanceList, how) {
  const full = assertCapturePath(file, instanceList);
  if (how === "folder") shell.showItemInFolder(full);
  else {
    const err = await shell.openPath(full);
    if (err) throw new Error(err);
  }
  return { ok: true };
}

async function deleteCapture(file, instanceList) {
  const full = assertCapturePath(file, instanceList);
  await shell.trashItem(full);
  return { ok: true };
}

function shutdown() {
  globalShortcut.unregisterAll();
  clearTimeout(findTimer);
}

module.exports = {
  init,
  configure,
  status,
  gameStarted,
  gameStopped,
  takeScreenshot,
  saveClip,
  listCaptures,
  openCapture,
  deleteCapture,
  assertCapturePath,
  shutdown,
  CLIP_SECONDS: [30, 60, 120, 300, 600, 900, 1800],
};
