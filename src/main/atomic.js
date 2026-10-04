"use strict";
/**
 * Crash-safe file writes and a tiny per-key lock, shared by everything that
 * keeps state in a JSON file (settings, the account, the instance registry,
 * content manifests, caches).
 *
 * Why: a plain writeFile truncates the file first, so a crash or power cut
 * mid-write leaves an empty/half file behind - and the next start reads that
 * as "no settings", writes defaults over it, and the real data is gone.
 * Writing to a temp file and renaming it over the target means the target
 * is always either the old version or the new one, never half of either.
 *
 * Why the lock: "read the file, change one thing, write it back" from two
 * callers at once loses whichever change was written first. withLock makes
 * them take turns.
 */
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");

// On Windows a rename over an existing file fails with one of these while
// anything (antivirus, the search indexer, another handle of ours) has the
// target open. It nearly always clears within a few hundred milliseconds.
const BUSY_CODES = new Set(["EBUSY", "EPERM", "EACCES"]);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A temp name next to `file` that no other write (this process or another) will pick. */
function tmpName(file, ext = "tmp") {
  return `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.${ext}`;
}

/** fs.rename, retried a few times while the target is briefly locked. */
async function renameWithRetry(from, to, { retries = 6, delayMs = 60 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (err) {
      if (attempt >= retries || !BUSY_CODES.has(err && err.code)) throw err;
      await wait(delayMs * (attempt + 1));
    }
  }
}

const STALE_TMP_MS = 10 * 60 * 1000;

/**
 * Removes temp files earlier writes of `file` left behind (the app was
 * killed between writing the temp file and renaming it). Only names this
 * module makes - `<name>.<pid>.<12 hex>.tmp` - and only ones older than ten
 * minutes, so a write still in flight (ours or another window's) is never
 * touched. Best effort, never throws.
 */
async function sweepStaleTemps(file, { olderThanMs = STALE_TMP_MS } = {}) {
  try {
    const dir = path.dirname(file);
    const prefix = `${path.basename(file)}.`;
    const now = Date.now();
    for (const name of await fsp.readdir(dir)) {
      if (!name.startsWith(prefix) || !/^\d+\.[0-9a-f]{12}\.tmp$/.test(name.slice(prefix.length))) continue;
      const full = path.join(dir, name);
      try {
        if (now - (await fsp.stat(full)).mtimeMs > olderThanMs) await fsp.unlink(full);
      } catch {
        // gone already, or locked - try again on a later write
      }
    }
  } catch {
    // housekeeping only
  }
}

/**
 * Writes `data` (string or Buffer) to `file` via a temp file + rename.
 * The temp file is removed if anything fails. With { backup: true } the
 * same bytes are also kept as `<file>.bak` (best effort) so a file that
 * later turns up corrupt has a last-known-good copy to fall back on.
 */
async function writeFileAtomic(file, data, { encoding, backup = false, mkdir = true } = {}) {
  if (mkdir) await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = tmpName(file);
  try {
    await fsp.writeFile(tmp, data, encoding);
    await renameWithRetry(tmp, file);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  await sweepStaleTemps(file);
  if (backup) {
    try {
      await writeFileAtomic(`${file}.bak`, data, { encoding, mkdir: false });
    } catch {
      // the real file is written; a missing backup only matters if that one is later damaged
    }
  }
}

/** JSON.stringify + writeFileAtomic. `space` is passed to JSON.stringify. */
async function writeJsonAtomic(file, value, { space, backup = false, mkdir = true } = {}) {
  await writeFileAtomic(file, JSON.stringify(value, null, space), { encoding: "utf8", backup, mkdir });
}

/**
 * Moves an unreadable file aside as `<file>.corrupt-<timestamp>` instead of
 * letting defaults be written over it, keeping only the newest `keep` such
 * copies. Returns the new path, or null if it couldn't be moved. Never throws.
 */
async function quarantine(file, { keep = 2 } = {}) {
  const target = `${file}.corrupt-${Date.now()}`;
  let moved = null;
  try {
    await renameWithRetry(file, target);
    moved = target;
  } catch {
    try {
      // can't move it (locked?) - at least keep a copy before it gets replaced
      await fsp.copyFile(file, target);
      moved = target;
    } catch {
      moved = null;
    }
  }
  try {
    const dir = path.dirname(file);
    const prefix = `${path.basename(file)}.corrupt-`;
    const old = (await fsp.readdir(dir))
      // The copy just made always stays, even when a clock that is behind makes it look the oldest.
      .filter((n) => n.startsWith(prefix) && /^\d+$/.test(n.slice(prefix.length)) && n !== path.basename(target))
      .sort((a, b) => Number(b.slice(prefix.length)) - Number(a.slice(prefix.length)));
    for (const name of old.slice(Math.max(1, keep) - (moved ? 1 : 0))) await fsp.rm(path.join(dir, name), { force: true });
  } catch {
    // pruning is housekeeping only
  }
  return moved;
}

const locks = new Map(); // key -> promise that settles when the last queued job is done

/**
 * Runs fn() after every earlier withLock(key, ...) call has finished, and
 * resolves/rejects with its result. One failing job doesn't block the ones
 * queued behind it. NOT re-entrant: calling withLock with the same key from
 * inside fn waits on itself forever.
 */
function withLock(key, fn) {
  const previous = locks.get(key) || Promise.resolve();
  const run = previous.then(() => fn());
  const tail = run.then(
    () => {},
    () => {}
  );
  locks.set(key, tail);
  tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return run;
}

module.exports = { writeFileAtomic, writeJsonAtomic, renameWithRetry, quarantine, withLock, tmpName, sweepStaleTemps };
