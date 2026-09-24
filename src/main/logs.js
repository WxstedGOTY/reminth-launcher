"use strict";
/**
 * Game logs, per instance, kept forever.
 *
 * Minecraft writes logs/latest.log while it runs and, the next time it
 * starts, rolls that into logs/YYYY-MM-DD-N.log.gz. Crash reports land in
 * crash-reports/. Reminth copies every rolled log and crash report into
 * its own archive (paths.LOG_ARCHIVE_DIR/<instance>/) the moment it sees
 * one, and never deletes anything from it - so a log from months ago is
 * still there after the game folder has been cleaned, a mod wiped the logs
 * folder, or the player reinstalled.
 *
 * Each line is sorted into one of five buckets so the important ones can
 * be pulled out of a 40,000-line log in one click:
 *   important - bans, kicks, disconnects, mutes, crashes: the lines you'd
 *               screenshot for an unban/appeal ticket
 *   error     - [ERROR]/[FATAL] lines and stack traces
 *   warn      - [WARN] lines
 *   chat      - [CHAT] lines
 *   info      - everything else
 */
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");

const paths = require("./paths");

const MAX_LOG_BYTES = 48 * 1024 * 1024; // decompressed ceiling for one log
const CAT = { info: 0, chat: 1, warn: 2, error: 3, important: 4 };

const IMPORTANT = [
  /\bbanned\b/i,
  /\bban(?:ned)? (?:from|on|for)\b/i,
  /\byou are (?:banned|blacklisted|temporarily banned|suspended)\b/i,
  /\bblacklist(?:ed)?\b/i,
  /\bkicked\b/i,
  /\byou (?:have been|were) (?:kicked|muted|banned|removed)\b/i,
  /\bmuted\b/i,
  /\bappeal\b/i,
  /\bdisconnect(?:ed|ing)?\b.*\b(?:reason|from|by|server|kicked|ban)/i,
  /\blost connection\b/i,
  /\bconnection (?:lost|refused|reset|closed|timed out)\b/i,
  /\bfailed to (?:connect|log ?in|verify username)\b/i,
  /\binternal exception\b/i,
  /\bmultiplayer\.disconnect\./i,
  /\bdisconnect\.[a-z_.]+/i,
  /---- Minecraft Crash Report ----/,
  /\bGame crashed\b/i,
  /\bThis crash report has been saved\b/i,
];

/** Pure: which bucket one log line belongs in. `prev` is the previous line's bucket (for stack-trace continuation lines). */
function classify(line, prev = CAT.info) {
  if (!line) return prev === CAT.important || prev === CAT.error ? prev : CAT.info;
  const header = line.match(/^\[[^\]]*\] \[[^\]]*\/(INFO|WARN|ERROR|FATAL|DEBUG|TRACE)\]/);
  // Continuation lines of a multi-line entry (stack traces, crash report bodies).
  if (!header && !line.startsWith("[")) {
    if (/^\s+at |^Caused by:|^\s*\.\.\. \d+ more|Exception|Error:/.test(line)) return Math.max(prev, CAT.error);
    return prev;
  }
  if (IMPORTANT.some((re) => re.test(line))) return CAT.important;
  const level = header ? header[1] : null;
  if (level === "ERROR" || level === "FATAL") return CAT.error;
  if (level === "WARN") return CAT.warn;
  if (/\[CHAT\]/.test(line)) return CAT.chat;
  return CAT.info;
}

/** Pure: splits + classifies a whole log. Returns { lines, cats, counts }. */
function analyse(text) {
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const cats = new Array(lines.length);
  const counts = { info: 0, chat: 0, warn: 0, error: 0, important: 0 };
  const names = ["info", "chat", "warn", "error", "important"];
  let prev = CAT.info;
  for (let i = 0; i < lines.length; i++) {
    const c = classify(lines[i], prev);
    cats[i] = c;
    counts[names[c]]++;
    prev = c;
  }
  return { lines, cats, counts };
}

function archiveDir(instanceId) {
  return path.join(paths.LOG_ARCHIVE_DIR, instanceId);
}

async function readIndex(dir) {
  try {
    return JSON.parse(await fsp.readFile(path.join(dir, "index.json"), "utf8"));
  } catch {
    return { files: {} };
  }
}

async function writeIndex(dir, index) {
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, "index.json");
  await fsp.writeFile(`${file}.tmp`, JSON.stringify(index));
  await fsp.rename(`${file}.tmp`, file);
}

async function readText(file) {
  const raw = await fsp.readFile(file);
  if (file.endsWith(".gz")) return zlib.gunzipSync(raw, { maxOutputLength: MAX_LOG_BYTES }).toString("utf8");
  if (raw.length > MAX_LOG_BYTES) return raw.subarray(raw.length - MAX_LOG_BYTES).toString("utf8");
  return raw.toString("utf8");
}

/** Pure: "2026-09-23-2.log.gz" -> Date (local midnight) or null. */
function dateFromName(name) {
  const m = name.match(/^(\d{4})-(\d{2})-(\d{2})-(\d+)\.log(\.gz)?$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() + Number(m[4]); // +n keeps same-day order
  const c = name.match(/^crash-(\d{4})-(\d{2})-(\d{2})_(\d{2})\.(\d{2})\.(\d{2})/);
  if (c) return new Date(Number(c[1]), Number(c[2]) - 1, Number(c[3]), Number(c[4]), Number(c[5]), Number(c[6])).getTime();
  return null;
}

/**
 * Copies anything new from the instance's logs/ and crash-reports/ into
 * the permanent archive. Safe to call any time; cheap when there's nothing new.
 */
async function importInstanceLogs(instance) {
  const dir = archiveDir(instance.id);
  const index = await readIndex(dir);
  let changed = false;
  const sources = [
    [path.join(instance.gameDir, "logs"), (n) => /^\d{4}-\d{2}-\d{2}-\d+\.log\.gz$/.test(n), "log"],
    [path.join(instance.gameDir, "crash-reports"), (n) => /^crash-.*\.txt$/.test(n), "crash"],
  ];
  for (const [src, match, kind] of sources) {
    let names;
    try {
      names = await fsp.readdir(src);
    } catch {
      continue;
    }
    for (const name of names.filter(match)) {
      const full = path.join(src, name);
      let stat;
      try {
        stat = await fsp.stat(full);
      } catch {
        continue;
      }
      const existing = index.files[name];
      if (existing && existing.size === stat.size) continue;
      // Same file name, different contents (e.g. the game folder was reset
      // and dates repeat) - keep both rather than overwrite history.
      const storeName = existing ? name.replace(/(\.log\.gz|\.txt)$/, `-${Date.now()}$1`) : name;
      await fsp.mkdir(dir, { recursive: true });
      await fsp.copyFile(full, path.join(dir, storeName));
      let counts = null;
      try {
        counts = analyse(await readText(full)).counts;
      } catch {
        counts = null;
      }
      index.files[storeName] = {
        size: stat.size,
        kind,
        date: dateFromName(name) || Math.round(stat.mtimeMs),
        counts,
      };
      changed = true;
    }
  }
  if (changed) await writeIndex(dir, index);
  return changed;
}

/** Newest first: the live latest.log (if any), then every archived log and crash report. */
async function listLogs(instance) {
  await importInstanceLogs(instance).catch(() => {});
  const dir = archiveDir(instance.id);
  const index = await readIndex(dir);
  const out = Object.entries(index.files).map(([name, info]) => ({
    id: "archive:" + name,
    name,
    kind: info.kind,
    date: info.date,
    size: info.size,
    counts: info.counts,
    live: false,
  }));
  const latest = path.join(instance.gameDir, "logs", "latest.log");
  try {
    const stat = await fsp.stat(latest);
    let counts = null;
    try {
      counts = analyse(await readText(latest)).counts;
    } catch {
      counts = null;
    }
    out.push({ id: "live:latest.log", name: "latest.log", kind: "log", date: Math.round(stat.mtimeMs), size: stat.size, counts, live: true });
  } catch {
    // never launched
  }
  return out.sort((a, b) => b.date - a.date);
}

/** Returns { name, lines, cats, counts } for one log from listLogs(). */
async function readLog(instance, id) {
  let file;
  if (id === "live:latest.log") {
    file = path.join(instance.gameDir, "logs", "latest.log");
  } else if (typeof id === "string" && id.startsWith("archive:")) {
    const name = path.basename(id.slice("archive:".length));
    if (!/^[\w.\-]+$/.test(name) || name === "index.json") throw new Error("Unknown log.");
    file = path.join(archiveDir(instance.id), name);
  } else {
    throw new Error("Unknown log.");
  }
  const text = await readText(file);
  const result = analyse(text);
  return { name: path.basename(file), ...result, sha1: crypto.createHash("sha1").update(text).digest("hex").slice(0, 12) };
}

module.exports = { classify, analyse, importInstanceLogs, listLogs, readLog, dateFromName, CAT };
