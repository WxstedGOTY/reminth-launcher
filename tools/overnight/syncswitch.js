"use strict";
// Version change with mod syncing, on a throwaway folder (never Reminth's instance list):
// install popular mods for FROM, move the instance to TO, run "Update mods to fit" (modsSync.applySync), launch.
// Usage: node syncswitch.js loader FROM TO [N]
const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");
const Module = require("module");
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { if (r === "electron") return "SS_ELECTRON"; return orig.call(this, r, ...a); };
Module._cache.SS_ELECTRON = { id: "SS_ELECTRON", filename: "SS_ELECTRON", loaders: [], loaded: true, exports: { app: { getPath: () => os.tmpdir(), isPackaged: false, getVersion: () => "1.4.8" }, safeStorage: { isEncryptionAvailable: () => false } } };
const REPO = "C:/Users/kolijos/Downloads/reminth-launcher";
const SP = __dirname;
const minecraft = require(path.join(REPO, "src/main/minecraft"));
const content = require(path.join(REPO, "src/main/content"));
const modrinth = require(path.join(REPO, "src/main/modrinth"));
const modsSync = require(path.join(REPO, "src/main/modsSync"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = (cmd) => cp.execFileSync("powershell", ["-NoProfile", "-Command", cmd], { encoding: "utf8" }).trim();

(async () => {
  const [loader, from, to, nArg] = process.argv.slice(2);
  const N = Number(nArg) || 10;
  const gameDir = path.join(SP, "syncswitch-game", String(Date.now()));
  fs.mkdirSync(path.join(gameDir, "saves"), { recursive: true });
  const inst = { id: "zz-sync", name: "SyncSwitch", mcVersion: from, loader, gameDir, hud: loader === "fabric" };
  fs.mkdirSync(path.join(gameDir, "mods"), { recursive: true });
  // the realistic order: the player adds mods from Discover first, Reminth's first start comes after
  const search = await modrinth.searchProjects({ projectType: "mod", loaders: [loader], gameVersions: [from], index: "downloads", limit: N });
  for (const h of search.hits.slice(0, N)) {
    try { await content.install(inst, { projectId: h.project_id, kind: "mod" }, () => {}, {}); } catch {}
  }
  await minecraft.ensureInstalled(inst, () => {});
  const before = fs.readdirSync(path.join(gameDir, "mods")).filter((f) => f.endsWith(".jar"));
  console.log(`installed for ${from}: ${before.length} jars`);
  // the instance moves to the new version (what the switch does first), then the mods are brought along
  inst.mcVersion = to;
  inst.loaderVersion = undefined;
  const plan = await modsSync.planSync(inst, {}).catch((e) => ({ error: e.message }));
  console.log("plan:", JSON.stringify(plan).slice(0, 300));
  const res = await modsSync.applySync(inst, () => {}, {}, {});
  console.log("sync result:", JSON.stringify(res).slice(0, 500));
  const after = fs.readdirSync(path.join(gameDir, "mods")).filter((f) => f.endsWith(".jar"));
  console.log(`after sync: ${after.length} jars`);
  const installResult = await minecraft.ensureInstalled(inst, () => {});
  fs.writeFileSync(path.join(gameDir, "options.txt"), ["onboardAccessibility:false", "pauseOnLostFocus:false", "fullscreen:false", "maxFps:60", "narrator:0"].join("\n") + "\n");
  let crash = null;
  const launchedAt = Date.now() - 20000;
  minecraft.launch(installResult, { username: "Bench", uuid: "8d3f5b0e2c1a4b7f9e6d5c4b3a291807", minecraftAccessToken: "0", xuid: "0" }, (c) => (crash = c), { maxMemoryMb: 4096, gc: "auto", processPriority: "normal", fullscreen: false, gameWidth: 854, gameHeight: 480, extraJvmArgs: "", appVersion: "1.4.8" }, { id: "zz-sync", gameDir }, {});
  let pid = "";
  let title = "";
  const limit = Date.now() + 240000;
  while (Date.now() < limit) {
    await sleep(4000);
    if (crash) break;
    try { pid = ps(`(Get-Process javaw,java -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like 'Minecraft*' -and $_.StartTime -gt (Get-Date).AddMilliseconds(-${Date.now() - launchedAt}) } | Select-Object -First 1).Id`); } catch { pid = ""; }
    if (pid) { try { title = ps(`(Get-Process -Id ${pid}).MainWindowTitle`); } catch {} if (title) break; }
  }
  let ok = false;
  if (pid && title) {
    await sleep(25000);
    try { ok = ps(`(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Id`) === String(pid); } catch {}
    try { cp.execSync(`taskkill /pid ${pid} /t /f`, { stdio: "ignore" }); } catch {}
  }
  console.log(ok ? `OK   ${loader} ${from} -> ${to}: game started with the synced mods` : `FAIL ${loader} ${from} -> ${to}: ${crash ? JSON.stringify(crash).slice(0, 150) : "no window"}`);
  if (!ok) {
    const d = path.join(gameDir, "crash-reports");
    if (fs.existsSync(d)) { const f = fs.readdirSync(d).sort().pop(); if (f) console.log(fs.readFileSync(path.join(d, f), "utf8").split("\n").slice(0, 14).join("\n")); }
  }
})().catch((e) => console.log("ERR", e.message));
