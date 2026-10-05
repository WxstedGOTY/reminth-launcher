"use strict";
// Player-added mods test. For each "loader@mcVersion": take the N most downloaded Modrinth mods that fit,
// install them through content.install() (what Discover's Install button does, dependencies included),
// start the game and see whether it stays up. Usage: node modsweep.js <results> <N> loader@mc ...
const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");
const Module = require("module");
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { if (r === "electron") return "MS_ELECTRON"; return orig.call(this, r, ...a); };
Module._cache.MS_ELECTRON = { id: "MS_ELECTRON", filename: "MS_ELECTRON", loaded: true, exports: { app: { getPath: () => os.tmpdir(), isPackaged: false, getVersion: () => "1.4.8" }, safeStorage: { isEncryptionAvailable: () => false } } };
const REPO = "C:/Users/kolijos/Downloads/reminth-launcher";
const SP = __dirname;
const minecraft = require(path.join(REPO, "src/main/minecraft"));
const content = require(path.join(REPO, "src/main/content"));
const modrinth = require(path.join(REPO, "src/main/modrinth"));

const resultsFile = process.argv[2];
const N = Number(process.argv[3]) || 12;
const combos = process.argv.slice(4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = (cmd) => cp.execFileSync("powershell", ["-NoProfile", "-Command", cmd], { encoding: "utf8" }).trim();

async function oneCombo(loader, mc) {
  const rec = { loader, mc, ok: false, stage: "search", mods: [] };
  const gameDir = path.join(SP, "modsweep-game", String(Date.now()));
  fs.mkdirSync(path.join(gameDir, "saves"), { recursive: true });
  try {
    const search = await modrinth.searchProjects({ projectType: "mod", loaders: [loader], gameVersions: [mc], index: "downloads", limit: N });
    const hits = (search.hits || []).slice(0, N);
    rec.wanted = hits.map((h) => h.slug);
    const inst = { id: "zz-modsweep", name: "ModSweep", mcVersion: mc, loader, gameDir, hud: loader === "fabric" };
    rec.stage = "install-game";
    const installResult = await minecraft.ensureInstalled(inst, () => {});
    rec.stage = "install-mods";
    rec.failedInstall = [];
    for (const h of hits) {
      try {
        const r = await content.install(inst, { projectId: h.project_id, kind: "mod" }, () => {}, {});
        for (const i of r.installed || []) rec.mods.push(i.file);
      } catch (e) {
        rec.failedInstall.push(h.slug + ": " + String(e.message).slice(0, 100));
      }
    }
    rec.stage = "launch";
    fs.writeFileSync(path.join(gameDir, "options.txt"), ["onboardAccessibility:false", "skipMultiplayerWarning:true", "pauseOnLostFocus:false", "fullscreen:false", "maxFps:60", "narrator:0"].join("\n") + "\n");
    let crash = null;
    const settings = { maxMemoryMb: 4096, gc: "auto", processPriority: "normal", fullscreen: false, gameWidth: 854, gameHeight: 480, extraJvmArgs: "", appVersion: "1.4.8" };
    const account = { username: "Bench", uuid: "8d3f5b0e2c1a4b7f9e6d5c4b3a291807", minecraftAccessToken: "0", xuid: "0" };
    const child = minecraft.launch(installResult, account, (c) => (crash = c), settings, { id: "zz-modsweep", gameDir }, {});
    const launchedAt = Date.now() - 20000; // the process starts a little BEFORE launch() returns
    const limit = Date.now() + 300000;
    let pid = "";
    let title = "";
    while (Date.now() < limit) {
      await sleep(4000);
      if (crash) break;
      // the game process = the Java process that owns a Minecraft window opened since the launch
      try { pid = ps(`(Get-Process javaw,java -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like 'Minecraft*' -and $_.StartTime -gt (Get-Date).AddMilliseconds(-${Date.now() - launchedAt}) } | Select-Object -First 1).Id`); } catch { pid = ""; }
      if (!pid) continue;
      try { title = ps(`(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).MainWindowTitle`); } catch { title = ""; }
      if (title) break;
    }
    if (pid && title) {
      await sleep(25000); // mods take longer to finish loading
      let alive = false;
      try { alive = ps(`(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Id`) === String(pid); } catch {}
      if (alive) {
        try { cp.execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${path.join(SP, "capwin.ps1")}" -ProcessId ${pid} -Out "${path.join(SP, "modsweep-shots", `${loader}-${mc}.png`)}"`, { stdio: "ignore" }); } catch {}
        rec.ok = true;
        rec.stage = "ok";
      } else rec.stage = "died-after-window";
    } else rec.stage = crash ? "crashed" : "no-window";
    if (pid) { try { cp.execSync(`taskkill /pid ${pid} /t /f`, { stdio: "ignore" }); } catch {} }
    if (crash) rec.crash = JSON.stringify(crash).slice(0, 200);
    if (!rec.ok) {
      const crashDir = path.join(gameDir, "crash-reports");
      if (fs.existsSync(crashDir)) {
        const f = fs.readdirSync(crashDir).sort().pop();
        if (f) rec.crashReport = fs.readFileSync(path.join(crashDir, f), "utf8").split("\n").slice(0, 14).join(" | ").slice(0, 900);
      }
      const log = path.join(gameDir, "logs", "latest.log");
      if (!rec.crashReport && fs.existsSync(log)) rec.logTail = fs.readFileSync(log, "utf8").split("\n").slice(-8).join(" | ").slice(0, 600);
    }
  } catch (e) {
    rec.error = String(e && e.message ? e.message : e).slice(0, 300);
  }
  return rec;
}

(async () => {
  fs.mkdirSync(path.join(SP, "modsweep-shots"), { recursive: true });
  for (const c of combos) {
    const [loader, mc] = c.split("@");
    const rec = await oneCombo(loader, mc);
    fs.appendFileSync(resultsFile, JSON.stringify(rec) + "\n");
    console.log(`${rec.ok ? "OK  " : "FAIL"} ${c} stage=${rec.stage} mods=${rec.mods.length} installFailures=${(rec.failedInstall || []).length} ${rec.error || ""}`);
  }
  console.log("MODSWEEPDONE");
})();
