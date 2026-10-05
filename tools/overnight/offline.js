"use strict";
// "No internet" test: every fetch fails, then each already-installed combination is installed again (as Play does
// before every start) and launched. Reminth must start the game from what it has on disk.
// Usage: node offline.js loader@mc ...
const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");
const Module = require("module");
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { if (r === "electron") return "OF_ELECTRON"; return orig.call(this, r, ...a); };
Module._cache.OF_ELECTRON = { id: "OF_ELECTRON", filename: "OF_ELECTRON", loaded: true, exports: { app: { getPath: () => os.tmpdir(), isPackaged: false, getVersion: () => "1.4.8" }, safeStorage: { isEncryptionAvailable: () => false } } };
const REPO = "C:/Users/kolijos/Downloads/reminth-launcher";
const SP = __dirname;
const minecraft = require(path.join(REPO, "src/main/minecraft"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = (cmd) => cp.execFileSync("powershell", ["-NoProfile", "-Command", cmd], { encoding: "utf8" }).trim();

let blocked = 0;
const realFetch = globalThis.fetch;

async function one(loader, mc, seedGameDir) {
  const gameDir = path.join(SP, "offline-game", loader + "-" + mc);
  fs.mkdirSync(path.join(gameDir, "saves"), { recursive: true });
  const inst = { id: "zz-offline", name: "Offline", mcVersion: mc, loader, gameDir, hud: loader === "fabric" };
  const rec = { loader, mc, ok: false };
  // 1. online: install once (what a player did the last time they were online)
  globalThis.fetch = realFetch;
  try {
    await minecraft.ensureInstalled(inst, () => {});
  } catch (e) {
    rec.stage = "online-install";
    rec.error = String(e.message).slice(0, 200);
    return rec;
  }
  // 2. offline: everything fails to reach the network
  blocked = 0;
  globalThis.fetch = (...a) => { blocked++; return Promise.reject(new TypeError("fetch failed")); };
  let installResult;
  try {
    installResult = await minecraft.ensureInstalled(inst, () => {});
  } catch (e) {
    rec.stage = "offline-install";
    rec.error = String(e.message).slice(0, 250);
    rec.blocked = blocked;
    globalThis.fetch = realFetch;
    return rec;
  }
  rec.blocked = blocked;
  globalThis.fetch = realFetch; // the game itself does its own networking; only Reminth's own requests were blocked
  fs.writeFileSync(path.join(gameDir, "options.txt"), ["onboardAccessibility:false", "pauseOnLostFocus:false", "fullscreen:false", "maxFps:60", "narrator:0"].join("\n") + "\n");
  let crash = null;
  const settings = { maxMemoryMb: 3072, gc: "auto", processPriority: "normal", fullscreen: false, gameWidth: 854, gameHeight: 480, extraJvmArgs: "", appVersion: "1.4.8" };
  const account = { username: "Bench", uuid: "8d3f5b0e2c1a4b7f9e6d5c4b3a291807", minecraftAccessToken: "0", xuid: "0" };
  const launchedAt = Date.now() - 20000; // the process starts a little BEFORE launch() returns
  minecraft.launch(installResult, account, (c) => (crash = c), settings, { id: "zz-offline", gameDir }, {});
  let pid = "";
  let title = "";
  const limit = Date.now() + 180000;
  while (Date.now() < limit) {
    await sleep(4000);
    if (crash) break;
    try { pid = ps(`(Get-Process javaw,java -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like 'Minecraft*' -and $_.StartTime -gt (Get-Date).AddMilliseconds(-${Date.now() - launchedAt}) } | Select-Object -First 1).Id`); } catch { pid = ""; }
    if (pid) { try { title = ps(`(Get-Process -Id ${pid}).MainWindowTitle`); } catch {} if (title) break; }
  }
  if (pid && title) {
    await sleep(12000);
    let alive = false;
    try { alive = ps(`(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Id`) === String(pid); } catch {}
    rec.ok = alive;
    rec.stage = alive ? "ok" : "died-after-window";
    try { cp.execSync(`taskkill /pid ${pid} /t /f`, { stdio: "ignore" }); } catch {}
  } else rec.stage = crash ? "crashed" : "no-window";
  if (crash) rec.crash = JSON.stringify(crash).slice(0, 200);
  return rec;
}

(async () => {
  for (const c of process.argv.slice(2)) {
    const [loader, mc] = c.split("@");
    const r = await one(loader, mc);
    fs.appendFileSync(path.join(SP, "offline-results.jsonl"), JSON.stringify(r) + "\n");
    console.log(`${r.ok ? "OK  " : "FAIL"} ${c} ${r.stage} (network calls refused: ${r.blocked}) ${r.error || ""}`);
  }
  console.log("OFFLINEDONE");
})();
