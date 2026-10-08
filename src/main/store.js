"use strict";
/**
 * Persists the signed-in account (mainly the MS refresh token) to disk
 * so players don't have to sign in every single launch. Encrypted with
 * Electron's OS-backed safeStorage (DPAPI on Windows) when available.
 */
const fs = require("fs");
const fsp = fs.promises;
const { safeStorage } = require("electron");
const path = require("path");
const paths = require("./paths");
const atomic = require("./atomic");

const BUSY_CODES = ["EBUSY", "EPERM", "EACCES"];

/** Deletes one file, waiting out the short locks Windows (antivirus, the indexer) takes on it. */
async function removeWithRetry(file) {
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.rm(file, { force: true });
      return;
    } catch (err) {
      if (attempt >= 5 || !BUSY_CODES.includes(err && err.code)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)));
    }
  }
}

/** Pure: JSON text without a leading byte-order mark (Windows editors add one; JSON.parse refuses it). */
function stripBom(text) {
  return String(text).replace(/^\uFEFF/, "");
}

/** Removes account.json / account.json.bak if they hold the account as readable text. Never throws. */
async function removePlaintextAccount() {
  for (const file of [`${paths.ACCOUNTS_FILE}.bak`, paths.ACCOUNTS_FILE]) {
    try {
      const raw = await fsp.readFile(file);
      if (!isLikelyEncrypted(raw)) await removeWithRetry(file);
    } catch {
      // not there, or locked right now - the next save tries again
    }
  }
}

/**
 * Saves the account, encrypted. Returns { persisted }.
 *
 * When the OS key store isn't available the account is NOT written at all:
 * the file would hold the Microsoft refresh token as readable text, which is
 * exactly what the privacy policy says never happens. The player stays
 * signed in for this session (the account lives in memory in main.js) and
 * signs in again next start. That branch never throws - a sign-in must not
 * fail because there was nothing safe to write.
 */
async function saveAccount(account) {
  if (!safeStorage.isEncryptionAvailable()) {
    // A readable copy left by an older version goes too.
    await removePlaintextAccount();
    return { persisted: false };
  }
  const data = safeStorage.encryptString(JSON.stringify(account));
  // Temp file + rename: a crash mid-write used to leave a truncated
  // account.json, which reads as "nobody signed in". The same bytes are
  // kept as account.json.bak in case the file is ever damaged anyway.
  await atomic.writeFileAtomic(paths.ACCOUNTS_FILE, data, { backup: true });
  return { persisted: true };
}

/**
 * What a stored account file holds: { account }, { corrupt: true } when the
 * bytes can't be an account, or { undecided: true } when it's an encrypted
 * file and the OS key store isn't available right now - that one says
 * nothing about the file, so it must never be treated as damaged.
 */
function decodeAccount(raw) {
  let text;
  if (isLikelyEncrypted(raw)) {
    if (!safeStorage.isEncryptionAvailable()) return { undecided: true };
    try {
      text = safeStorage.decryptString(raw);
    } catch {
      return { corrupt: true };
    }
  } else {
    text = raw.toString("utf8");
  }
  try {
    const parsed = JSON.parse(stripBom(text));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return { account: parsed };
  } catch {
    // falls through to corrupt
  }
  return { corrupt: true };
}

/**
 * An account that was read from a file holding it as readable text (written
 * by an older version) is saved again straight away: saveAccount encrypts
 * it, or - when the OS key store isn't available - removes the readable
 * file. It used to stay on disk as text until the next sign-in or token
 * refresh happened to rewrite it. Either way the account that was read is
 * still the one returned, so nobody is signed out for this session.
 */
async function resaveIfPlaintext(raw, account) {
  if (!account || isLikelyEncrypted(raw)) return;
  try {
    await saveAccount(account);
  } catch {
    // couldn't be rewritten right now - the next save tries again
  }
}

async function loadAccountBackup() {
  try {
    const raw = await fsp.readFile(`${paths.ACCOUNTS_FILE}.bak`);
    const account = decodeAccount(raw).account || null;
    await resaveIfPlaintext(raw, account);
    return account;
  } catch {
    return null;
  }
}

async function loadAccount() {
  let raw;
  try {
    raw = await fsp.readFile(paths.ACCOUNTS_FILE);
  } catch (err) {
    // Gone (first run, or moved aside below on an earlier start): the
    // backup, if there is one. Any other error says nothing about the file.
    return err && err.code === "ENOENT" ? loadAccountBackup() : null;
  }
  const main = decodeAccount(raw);
  if (main.account) {
    await resaveIfPlaintext(raw, main.account);
    return main.account;
  }
  if (main.undecided) return null;
  // Unreadable: keep it as account.json.corrupt-<time> rather than letting
  // the next sign-in overwrite the evidence, and fall back to the backup.
  await atomic.quarantine(paths.ACCOUNTS_FILE);
  return loadAccountBackup();
}

function isLikelyEncrypted(buf) {
  // Plain JSON always starts with "{" (0x7b) - after a UTF-8 byte-order
  // mark, if an editor added one; DPAPI/keychain blobs don't.
  const start = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0;
  return buf.length > start && buf[start] !== 0x7b;
}

async function clearAccount() {
  // The copies go FIRST and account.json last. loadAccount falls back to
  // account.json.bak when the main file is missing, so the old order
  // (main file, then backup) meant a backup that couldn't be deleted - or
  // the app closing between the two - signed the player back in on the
  // next start. This way, whatever goes wrong part-way, either everything
  // is gone or the main file is still there and sign-out visibly failed.
  const dir = path.dirname(paths.ACCOUNTS_FILE);
  const base = path.basename(paths.ACCOUNTS_FILE);
  let names = [];
  try {
    names = await fsp.readdir(dir);
  } catch {
    // no folder yet - nothing to clear
  }
  // Signing out must not leave the token behind in the backup, in a copy
  // that was moved aside, or in a half-written temp file.
  const copies = names.filter((name) => name === `${base}.bak` || name.startsWith(`${base}.corrupt-`) || (name.startsWith(`${base}.`) && name.endsWith(".tmp")));
  for (const name of copies) await removeWithRetry(path.join(dir, name));
  await removeWithRetry(paths.ACCOUNTS_FILE);
}

// ---- app settings (RAM override, launch-minimized, etc.) ----
// Deliberately separate from account.json (never encrypted - nothing
// sensitive lives here) and defaulted in code rather than on disk, so a
// missing/corrupt file just falls back cleanly instead of breaking launch.
const DEFAULT_SETTINGS = {
  maxMemoryMb: null, // null = auto (see minecraft.js:computeDefaultMaxMemoryMb)
  // Garbage collector: "auto" lets Reminth pick per Java version and PC
  // (see minecraft.js:buildJvmFlags); "g1" and "zgc" are the off switches
  // for that choice.
  gc: "auto",
  // "above-normal" asks Windows to favour the game a little over background
  // apps; "normal" leaves it alone. Always normal while streamer mode is on.
  processPriority: "above-normal",
  launchMinimized: true, // most launchers get out of the way once the game starts
  hardwareAcceleration: true, // only takes effect on next app start - see main.js
  accent: "ember", // UI accent colour (renderer only). "ember" = the Reminth brand orange of the app icon.
  // false until the player picks an accent themselves. Settings saved before the brand colour existed hold the old
  // default, "cyan"; while this is false, "cyan" is read as "ember" (see settingsFrom), so everyone gets the brand
  // colour once and a later deliberate pick of cyan sticks.
  accentChosen: false,
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
/** The lifetime play-time counter's ceiling: 200 years of playing - anything above is junk. */
const MAX_TOTAL_PLAY_MS = 200 * 365 * 24 * 3600 * 1000;

/** Pure: a stored lifetime counter, or null when it isn't one (absent, negative, not a number, too big). */
function cleanTotalPlayTime(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_TOTAL_PLAY_MS) return null;
  return Math.floor(value);
}

/** Pure: the counter after the one-time seeding - never seeded twice, never lowered. */
function seededTotal(current, instancesSum) {
  const now = cleanTotalPlayTime(current);
  if (now !== null) return now;
  return cleanTotalPlayTime(Math.max(0, Number(instancesSum) || 0)) || 0;
}

/** Pure: the counter after one session of `ms` (nothing for a session that didn't run). */
function addedTotal(current, ms) {
  const now = cleanTotalPlayTime(current) || 0;
  const add = Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0;
  return Math.min(MAX_TOTAL_PLAY_MS, now + add);
}

function sanitizeSettings(partial, { strict = false, counters = false } = {}) {
  const clean = {};
  if (!partial || typeof partial !== "object") return clean;

  // The lifetime "Time played" counter is only ever read from the file here;
  // it changes through seedPlayTime / addPlayTime, never through a settings
  // save from the page.
  if (counters) {
    const total = cleanTotalPlayTime(partial.totalPlayTimeMs);
    if (total !== null) clean.totalPlayTimeMs = total;
  }

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

  for (const key of ["launchMinimized", "hardwareAcceleration", "fullscreen", "streamerMode", "accentChosen"]) {
    if (typeof partial[key] === "boolean") clean[key] = partial[key];
  }

  // One of a fixed list each. Anything else (a typo in settings.json, a
  // value from a newer Reminth) falls back to the default instead of
  // reaching the launch code as something it doesn't know.
  const choices = { gc: ["auto", "g1", "zgc"], processPriority: ["above-normal", "normal"] };
  for (const [key, allowed] of Object.entries(choices)) {
    if (!(key in partial)) continue;
    clean[key] = allowed.includes(partial[key]) ? partial[key] : DEFAULT_SETTINGS[key];
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

function parseSettingsText(text) {
  try {
    const parsed = JSON.parse(stripBom(text));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The settings object on disk, or null when there isn't one yet.
 *
 * A settings.json that exists but can't be parsed is moved aside as
 * settings.json.corrupt-<time> and the last good copy (settings.json.bak)
 * is used instead. It used to be read as "no settings", and the next save
 * then wrote defaults over the player's real file for good.
 *
 * Throws when the file can't be read at all (locked, no permission): that
 * isn't "no settings" either, and saveSettings must not overwrite it.
 */
async function readSettingsFile() {
  let text = null;
  try {
    text = await fsp.readFile(paths.SETTINGS_FILE, "utf8");
  } catch (err) {
    if (!err || err.code !== "ENOENT") throw err;
  }
  if (text !== null) {
    const parsed = parseSettingsText(text);
    if (parsed) return parsed;
    await atomic.quarantine(paths.SETTINGS_FILE);
  }
  try {
    return parseSettingsText(await fsp.readFile(`${paths.SETTINGS_FILE}.bak`, "utf8"));
  } catch {
    return null;
  }
}

function settingsFrom(parsed) {
  if (!parsed) return { ...DEFAULT_SETTINGS };
  const clean = sanitizeSettings(parsed, { counters: true });
  // Old files carry the old default accent: show the brand orange until the player picks one themselves.
  if (clean.accentChosen !== true && (clean.accent === undefined || clean.accent === "cyan")) clean.accent = DEFAULT_SETTINGS.accent;
  return { ...DEFAULT_SETTINGS, ...clean, streamer: sanitizeStreamer(parsed.streamer) };
}

async function loadSettings() {
  try {
    return settingsFrom(await readSettingsFile());
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveSettings(partial) {
  // One save at a time: this is read-change-write, and two overlapping
  // saves each used to write back their own stale copy, losing the other's
  // change.
  return atomic.withLock("store:settings", async () => {
    const current = settingsFrom(await readSettingsFile());
    const input = partial && typeof partial === "object" ? { ...partial, _currentStreamer: current.streamer } : partial;
    const next = { ...current, ...sanitizeSettings(input, { strict: true }) };
    await atomic.writeJsonAtomic(paths.SETTINGS_FILE, next, { space: 2, backup: true });
    return next;
  });
}

/**
 * Home's lifetime "Time played" (settings.json totalPlayTimeMs): all the time
 * played through Reminth, across every instance - it doesn't shrink when an
 * instance is deleted, which a sum of the instances would.
 *
 * seedPlayTime(sumOfInstances): once, when there's no counter yet (or only
 * junk), it starts from what the instances have recorded so far. A counter
 * already there is never recomputed or lowered.
 */
async function seedPlayTime(sumOfInstances) {
  return atomic.withLock("store:settings", async () => {
    const parsed = await readSettingsFile();
    if (parsed && cleanTotalPlayTime(parsed.totalPlayTimeMs) !== null) return parsed.totalPlayTimeMs;
    const sum = typeof sumOfInstances === "function" ? await sumOfInstances() : sumOfInstances;
    const current = settingsFrom(parsed);
    const total = seededTotal(null, sum);
    await atomic.writeJsonAtomic(paths.SETTINGS_FILE, { ...current, totalPlayTimeMs: total }, { space: 2, backup: true });
    return total;
  });
}

/**
 * One finished session's time onto the counter (same lock as every settings
 * write). No counter yet: it's seeded first from `sumOfInstances` - which
 * already includes this session, recorded just before - so it isn't added twice.
 */
async function addPlayTime(ms, sumOfInstances) {
  if (!(Number.isFinite(ms) && ms > 0)) return null;
  return atomic.withLock("store:settings", async () => {
    const parsed = await readSettingsFile();
    const current = settingsFrom(parsed);
    let total;
    if (parsed && cleanTotalPlayTime(parsed.totalPlayTimeMs) !== null) total = addedTotal(parsed.totalPlayTimeMs, ms);
    else total = seededTotal(null, typeof sumOfInstances === "function" ? await sumOfInstances() : sumOfInstances || ms);
    await atomic.writeJsonAtomic(paths.SETTINGS_FILE, { ...current, totalPlayTimeMs: total }, { space: 2, backup: true });
    return total;
  });
}

module.exports = {
  seedPlayTime,
  addPlayTime,
  cleanTotalPlayTime,
  seededTotal,
  addedTotal,
  saveAccount,
  loadAccount,
  clearAccount,
  loadSettings,
  saveSettings,
  sanitizeSettings,
  sanitizeStreamer,
  DEFAULT_SETTINGS,
};
