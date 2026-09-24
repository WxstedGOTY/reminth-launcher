"use strict";
/**
 * Persists the signed-in account (mainly the MS refresh token) to disk
 * so players don't have to sign in every single launch. Encrypted with
 * Electron's OS-backed safeStorage (DPAPI on Windows) when available.
 */
const fs = require("fs");
const fsp = fs.promises;
const { safeStorage } = require("electron");
const paths = require("./paths");

async function saveAccount(account) {
  await fsp.mkdir(paths.ROOT, { recursive: true });
  const json = JSON.stringify(account);
  if (safeStorage.isEncryptionAvailable()) {
    const enc = safeStorage.encryptString(json);
    await fsp.writeFile(paths.ACCOUNTS_FILE, enc);
  } else {
    await fsp.writeFile(paths.ACCOUNTS_FILE, json, "utf8");
  }
}

async function loadAccount() {
  try {
    const raw = await fsp.readFile(paths.ACCOUNTS_FILE);
    if (safeStorage.isEncryptionAvailable() && isLikelyEncrypted(raw)) {
      return JSON.parse(safeStorage.decryptString(raw));
    }
    return JSON.parse(raw.toString("utf8"));
  } catch {
    return null;
  }
}

function isLikelyEncrypted(buf) {
  // Plain JSON always starts with "{" (0x7b); DPAPI/keychain blobs don't.
  return buf.length > 0 && buf[0] !== 0x7b;
}

async function clearAccount() {
  await fsp.rm(paths.ACCOUNTS_FILE, { force: true });
}

// ---- app settings (RAM override, launch-minimized, etc.) ----
// Deliberately separate from account.json (never encrypted - nothing
// sensitive lives here) and defaulted in code rather than on disk, so a
// missing/corrupt file just falls back cleanly instead of breaking launch.
const DEFAULT_SETTINGS = {
  maxMemoryMb: null, // null = auto (see minecraft.js:computeDefaultMaxMemoryMb)
  launchMinimized: true, // most launchers get out of the way once the game starts
  hardwareAcceleration: true, // only takes effect on next app start - see main.js
  accent: "cyan", // UI accent colour (renderer only)
  // Game window. null width/height = let Minecraft use its own last-used size.
  gameWidth: null,
  gameHeight: null,
  fullscreen: false,
  // Appended verbatim to the JVM command line. Power-user escape hatch;
  // empty by default and never required.
  extraJvmArgs: "",
  // Which instance Play / Home / the Instance page act on (see instances.js).
  activeInstance: "reminth",
  // Streamer mode: the switch lives on the sidebar, not in Settings.
  streamerMode: false,
  streamer: {
    screenshotKey: "F8",
    clipKey: "F9",
    clipSeconds: 60, // how far back a clip reaches
    fps: 60,
    quality: "high",
    audio: true,
    hidePersonalInfo: true,
    notify: true,
  },
};

const CLIP_SECONDS = [30, 60, 120, 300, 600, 900, 1800];
// Electron accelerator syntax, limited to keys that make sense as a hotkey
// while a game has focus.
const ACCELERATOR = /^((CommandOrControl|Control|Ctrl|Alt|Shift|Super)\+){0,3}(F([1-9]|1[0-9]|2[0-4])|[A-Z0-9]|Insert|Home|End|PageUp|PageDown|PrintScreen|Pause|Scrolllock|num[0-9]|numadd|numsub|nummult|numdiv|numdec)$/;

function sanitizeStreamer(raw, current) {
  const base = { ...DEFAULT_SETTINGS.streamer, ...(current || {}) };
  if (!raw || typeof raw !== "object") return base;
  const out = { ...base };
  for (const key of ["screenshotKey", "clipKey"]) {
    if (typeof raw[key] === "string" && (raw[key] === "" || ACCELERATOR.test(raw[key]))) out[key] = raw[key];
  }
  if (CLIP_SECONDS.includes(Number(raw.clipSeconds))) out.clipSeconds = Number(raw.clipSeconds);
  if ([30, 60].includes(Number(raw.fps))) out.fps = Number(raw.fps);
  if (["low", "medium", "high"].includes(raw.quality)) out.quality = raw.quality;
  for (const key of ["audio", "hidePersonalInfo", "notify"]) {
    if (typeof raw[key] === "boolean") out[key] = raw[key];
  }
  if (out.screenshotKey && out.screenshotKey === out.clipKey) out.clipKey = base.clipKey === out.screenshotKey ? "" : base.clipKey;
  return out;
}

/**
 * JVM flags that don't configure the game so much as hand the JVM something
 * else to execute: an agent jar, a native agent library, a replacement boot
 * classpath, a shell command to run when the VM hits an error, or a file to
 * read more arguments out of. extraJvmArgs is appended verbatim to the java
 * command line, so without this list "whoever can write a setting" and
 * "whoever can run code on this machine next launch" are the same person.
 */
const DANGEROUS_JVM_FLAGS = [
  /-javaagent[:=]/i,
  /-agentpath[:=]/i,
  /-agentlib[:=]/i,
  /-Xbootclasspath/i,
  /-XX:On[A-Za-z]*Error=/i,
  /(^|\s)@/, // @argfile
];

/**
 * Settings reach this module from two places that are only as trustworthy as
 * whatever last wrote to them: the renderer over IPC, and settings.json on
 * disk. Both get filtered here - unknown keys dropped, every known key
 * range/type checked - so a bad value can't reach the launch command line.
 *
 * strict throws on a rejected JVM argument (the IPC path, where the player
 * should be told why their setting didn't stick); non-strict just drops it
 * (the disk path, where throwing would mean the app won't start at all).
 */
function sanitizeSettings(partial, { strict = false } = {}) {
  const clean = {};
  if (!partial || typeof partial !== "object") return clean;

  const clamp = (value, min, max) => {
    if (value === null) return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return undefined; // "" / NaN / an object -> ignore the key
    return Math.min(max, Math.max(min, Math.round(n)));
  };

  const numbers = { maxMemoryMb: [512, 65536], gameWidth: [320, 16384], gameHeight: [240, 16384] };
  for (const [key, [min, max]] of Object.entries(numbers)) {
    if (!(key in partial)) continue;
    const value = clamp(partial[key], min, max);
    if (value !== undefined) clean[key] = value;
  }

  for (const key of ["launchMinimized", "hardwareAcceleration", "fullscreen", "streamerMode"]) {
    if (typeof partial[key] === "boolean") clean[key] = partial[key];
  }

  if (typeof partial.accent === "string" && /^[a-z-]{1,16}$/.test(partial.accent)) {
    clean.accent = partial.accent;
  }

  if (typeof partial.activeInstance === "string" && /^[a-z0-9-]{1,64}$/.test(partial.activeInstance)) {
    clean.activeInstance = partial.activeInstance;
  }
  if (partial.streamer && typeof partial.streamer === "object") {
    clean.streamer = sanitizeStreamer(partial.streamer, partial._currentStreamer);
  }

  if (typeof partial.extraJvmArgs === "string") {
    const args = partial.extraJvmArgs.slice(0, 1024);
    // Memory is set by the RAM slider (capped at what this PC can spare); a second -Xmx in
    // here would silently override it.
    if (/(^|\s)-Xm[xs]/i.test(args)) {
      if (strict) throw new Error("Set memory with the RAM slider above, not with -Xmx/-Xms here.");
    } else if (DANGEROUS_JVM_FLAGS.some((re) => re.test(args))) {
      if (strict) {
        throw new Error(
          "Those JVM arguments aren't allowed: agent, bootclasspath, on-error and @argfile flags can run code outside the game."
        );
      }
    } else {
      clean.extraJvmArgs = args;
    }
  }

  return clean;
}

async function loadSettings() {
  try {
    const raw = await fsp.readFile(paths.SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const clean = sanitizeSettings(parsed);
    return { ...DEFAULT_SETTINGS, ...clean, streamer: sanitizeStreamer(parsed && parsed.streamer) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveSettings(partial) {
  const current = await loadSettings();
  const input = partial && typeof partial === "object" ? { ...partial, _currentStreamer: current.streamer } : partial;
  const next = { ...current, ...sanitizeSettings(input, { strict: true }) };
  await fsp.mkdir(paths.ROOT, { recursive: true });
  await fsp.writeFile(paths.SETTINGS_FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}

module.exports = {
  saveAccount,
  loadAccount,
  clearAccount,
  loadSettings,
  saveSettings,
  sanitizeSettings,
  sanitizeStreamer,
  DEFAULT_SETTINGS,
};
