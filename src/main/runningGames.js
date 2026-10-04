"use strict";
/**
 * Finding games Reminth started earlier.
 *
 * The game is launched detached, so it keeps running when Reminth is closed,
 * restarted or updated - but Reminth's list of running games lives in
 * memory. A fresh Reminth used to think nothing was running and let Play
 * start a second copy on the same worlds. This finds the Java processes that
 * run an instance's folder (the `--gameDir` the launch gave them), so the
 * list can be filled in again.
 *
 * The command line of a game holds the account's access token. It is parsed
 * in memory for `--gameDir` only: never logged, never stored, never returned.
 */
const path = require("path");
const { execFile } = require("child_process");

/** Pure: the folder after `--gameDir` in a command line (quoted or not), or null. */
function parseGameDir(commandLine) {
  const text = String(commandLine || "");
  const m = text.match(/--gameDir(?:\s+|=)(?:"([^"]+)"|(\S+))/);
  if (!m) return null;
  return m[1] || m[2] || null;
}

/** Pure: a folder name for comparing (Windows paths ignore case and a trailing slash). */
function normalizeDir(dir) {
  if (typeof dir !== "string" || !dir) return "";
  return path.resolve(dir).replace(/[\\/]+$/, "").toLowerCase();
}

/**
 * Pure: for each instance, the process that runs its folder.
 * processes: [{ pid, gameDir, startedAt }]; instances: [{ id, gameDir }].
 * Returns Map(instance id -> { pid, startedAt }). The oldest process wins.
 */
function matchInstances(processes, instances) {
  const byDir = new Map();
  for (const p of Array.isArray(processes) ? processes : []) {
    const key = normalizeDir(p && p.gameDir);
    if (!key || !Number.isInteger(p.pid) || p.pid <= 0) continue;
    const have = byDir.get(key);
    if (!have || (p.startedAt || Infinity) < (have.startedAt || Infinity)) byDir.set(key, { pid: p.pid, startedAt: p.startedAt || null });
  }
  const out = new Map();
  for (const inst of Array.isArray(instances) ? instances : []) {
    const found = inst && byDir.get(normalizeDir(inst.gameDir));
    if (found) out.set(inst.id, found);
  }
  return out;
}

// Windows PowerShell writes its output in the console's old code page, and
// Node reads it as UTF-8: a game folder under C:\Users\Γιώργος (or José,
// Zoë…) came back garbled, never matched, and the running game wasn't found.
// UTF-8 output first, so every user name comes through as it is.
const SCRIPT =
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; " +
  "Get-CimInstance Win32_Process -Filter \"Name='javaw.exe' or Name='java.exe'\" | " +
  "Select-Object ProcessId, CommandLine, @{n='Started';e={([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds()}} | " +
  "ConvertTo-Json -Compress";

/**
 * Every Java process with a --gameDir: [{ pid, gameDir, startedAt }].
 * Resolves [] on any failure (not Windows, PowerShell missing or slow): the
 * caller then simply sees nothing running, as before.
 */
function listGameProcesses({ run = execFile, timeoutMs = 8000 } = {}) {
  if (process.platform !== "win32") return Promise.resolve([]);
  return new Promise((resolve) => {
    try {
      run(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", SCRIPT],
        { windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
        (err, stdout) => {
          if (err) return resolve([]);
          try {
            const text = String(stdout || "").trim();
            if (!text) return resolve([]);
            const parsed = JSON.parse(text);
            const rows = Array.isArray(parsed) ? parsed : [parsed];
            resolve(
              rows
                .map((r) => ({ pid: Number(r && r.ProcessId), gameDir: parseGameDir(r && r.CommandLine), startedAt: Number(r && r.Started) || null }))
                .filter((r) => Number.isInteger(r.pid) && r.gameDir)
            );
          } catch {
            resolve([]);
          }
        }
      );
    } catch {
      resolve([]);
    }
  });
}

/** Is a process with this id still there? (signal 0 only asks) */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return Boolean(err && err.code === "EPERM"); // exists, just not ours to signal
  }
}

/**
 * Calls onGone once when `pid` is no longer running. Returns a function that
 * stops watching. `alive` and `timers` are for tests.
 */
function watchUntilGone(pid, onGone, { alive = isAlive, intervalMs = 2000, timers = { setInterval, clearInterval } } = {}) {
  let done = false;
  const handle = timers.setInterval(() => {
    if (done || alive(pid)) return;
    done = true;
    timers.clearInterval(handle);
    onGone();
  }, intervalMs);
  if (handle && typeof handle.unref === "function") handle.unref();
  return () => {
    done = true;
    timers.clearInterval(handle);
  };
}

module.exports = { parseGameDir, normalizeDir, matchInstances, listGameProcesses, isAlive, watchUntilGone, SCRIPT };
