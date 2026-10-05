"use strict";
// Launch sweep: installs each vanilla version through Reminth's own ensureInstalled(), launches it with
// launch(), waits for a game window, takes a window-only picture, and records ok/fail per version.
// Usage: node sweep.js <list-file> <results-file> [loader]
const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");

const REPO = "C:/Users/kolijos/Downloads/reminth-launcher";
const SP = __dirname;
const Module = require("module");
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) {
  if (r === "electron") return "SW_ELECTRON";
  return orig.call(this, r, ...a);
};
Module._cache.SW_ELECTRON = { id: "SW_ELECTRON", filename: "SW_ELECTRON", loaded: true, exports: { app: { getPath: () => os.tmpdir(), isPackaged: false, getVersion: () => "1.4.8" }, safeStorage: { isEncryptionAvailable: () => false } } };
const minecraft = require(path.join(REPO, "src/main/minecraft"));

const list = fs.readFileSync(process.argv[2], "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const resultsFile = process.argv[3];
const loader = process.argv[4] || "vanilla";
const full = process.argv[5] === "full"; // the way a real player has it: performance pack, HUD and home screen on
const done = new Set();
if (fs.existsSync(resultsFile)) for (const l of fs.readFileSync(resultsFile, "utf8").split(/\r?\n/)) if (l) try { done.add(JSON.parse(l).version); } catch {}

const ps = (cmd) => cp.execFileSync("powershell", ["-NoProfile", "-Command", cmd], { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function one(version) {
  // A fresh folder every time: an old game's folder can stay locked for a while (antivirus, a slow exit).
  const gameDir = path.join(SP, "sweep-game", String(Date.now()));
  try { fs.rmSync(path.join(SP, "sweep-game"), { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }); } catch {}
  fs.mkdirSync(gameDir, { recursive: true });
  fs.mkdirSync(path.join(gameDir, "saves"), { recursive: true });
  const t0 = Date.now();
  const rec = { version, loader, ok: false, stage: "install" };
  let crash = null;
  try {
    const inst = { id: "zz-sweep", name: "Sweep", mcVersion: version, loader, gameDir, ...(full ? { hud: true } : { performanceMods: false, hud: false, homeScreen: false }) };
    const installResult = await minecraft.ensureInstalled(inst, () => {});
    rec.installSec = Math.round((Date.now() - t0) / 1000);
    rec.stage = "launch";
    // windowed, small, no pause, quiet
    fs.writeFileSync(path.join(gameDir, "options.txt"), ["onboardAccessibility:false", "skipMultiplayerWarning:true", "pauseOnLostFocus:false", "fullscreen:false", "enableVsync:false", "maxFps:60", "narrator:0"].join("\n") + "\n");
    const settings = { maxMemoryMb: 3072, gc: "auto", processPriority: "normal", fullscreen: false, gameWidth: 854, gameHeight: 480, extraJvmArgs: "", appVersion: "1.4.8" };
    const account = { username: "Bench", uuid: "8d3f5b0e2c1a4b7f9e6d5c4b3a291807", minecraftAccessToken: "0", xuid: "0" };
    const child = minecraft.launch(installResult, account, (c) => (crash = c), settings, { id: "zz-sweep", gameDir }, {});
    rec.stage = "window";
    let pid = "";
    let title = "";
    const limit = Date.now() + (full ? 240000 : 150000);
    while (Date.now() < limit) {
      await sleep(3000);
      if (crash) break;
      try {
        pid = ps("(Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'java' -and ($_.CommandLine -like '*sweep-game*' -or $_.CommandLine -like '*rubydung*') } | Select-Object -First 1).ProcessId");
      } catch { pid = ""; }
      if (!pid) {
        if (Date.now() - t0 > 20000 && child && child.exitCode !== null && child.exitCode !== undefined) break;
        continue;
      }
      try { title = ps(`(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).MainWindowTitle`); } catch { title = ""; }
      if (title) break;
    }
    if (pid && title) {
      await sleep(9000); // let it reach the main menu
      let alive = false;
      try { alive = ps(`(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Id`) === String(pid); } catch {}
      if (alive) {
        try {
          cp.execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${path.join(SP, "capwin.ps1")}" -ProcessId ${pid} -Out "${path.join(SP, "sweep-shots", version.replace(/[^\w.-]/g, "_") + ".png")}"`, { stdio: "ignore" });
        } catch {}
        rec.ok = true;
        rec.title = title;
        rec.stage = "ok";
      } else rec.stage = "died-after-window";
    } else {
      rec.stage = crash ? "crashed" : pid ? "no-window" : "no-process";
    }
    if (pid) { try { cp.execSync(`taskkill /pid ${pid} /t /f`, { stdio: "ignore" }); } catch {} }
    if (crash) rec.crash = JSON.stringify(crash).slice(0, 300);
  } catch (err) {
    rec.error = String(err && err.message ? err.message : err).slice(0, 300);
  }
  if (!rec.ok) {
    try {
      const log = path.join(gameDir, "logs", "latest.log");
      if (fs.existsSync(log)) rec.logTail = fs.readFileSync(log, "utf8").split("\n").slice(-6).join(" | ").slice(0, 400);
    } catch {}
  }
  rec.totalSec = Math.round((Date.now() - t0) / 1000);
  return rec;
}

(async () => {
  fs.mkdirSync(path.join(SP, "sweep-shots"), { recursive: true });
  for (const v of list) {
    if (done.has(v)) continue;
    let rec = await one(v);
    // A dropped internet connection is not a launcher failure: wait, then try again (up to 6 times).
    for (let n = 0; n < 6 && !rec.ok && /fetch failed|ENOTFOUND|ETIMEDOUT|ECONNRESET/.test(rec.error || ""); n++) {
      await sleep(60000);
      rec = await one(v);
    }
    fs.appendFileSync(resultsFile, JSON.stringify(rec) + "\n");
    console.log(`${rec.ok ? "OK  " : "FAIL"} ${v} ${rec.stage} ${rec.totalSec}s ${rec.error || ""}`);
  }
  console.log("SWEEPDONE");
})();
