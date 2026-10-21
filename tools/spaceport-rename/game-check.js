"use strict";
// Rename check (16 Oct 2026): install a version through the launcher's own minecraft.js the way a player has it (HUD +
// home screen + performance pack), start it with a pretend offline player, let the HUD's test switch open the G panel,
// take a picture of that one window, read the log. Run with USERPROFILE pointing at a scratch home (never the owner's
// data). Usage: node check.js <version> [panelAtSeconds]
const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");

const REPO = "C:/Users/kolijos/Downloads/reminth-launcher";
const SP = path.join(process.env.TEMP || os.tmpdir(), "spaceport-game-check"); // games and pictures go here, not in the repo
fs.mkdirSync(SP, { recursive: true });
const Module = require("module");
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) {
  if (r === "electron") return "RC_ELECTRON";
  return orig.call(this, r, ...a);
};
Module._cache.RC_ELECTRON = { id: "RC_ELECTRON", filename: "RC_ELECTRON", loaded: true, exports: { app: { getPath: () => os.tmpdir(), isPackaged: false, getVersion: () => "1.8.0" }, safeStorage: { isEncryptionAvailable: () => false } } };
if (/^C:[\/]Users[\/]kolijos$/i.test(os.homedir())) throw new Error("set USERPROFILE to a scratch home first (never the owner's real one): " + os.homedir());
const minecraft = require(path.join(REPO, "src/main/minecraft"));
const ps = (cmd) => cp.execFileSync("powershell", ["-NoProfile", "-Command", cmd], { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const version = process.argv[2];
  const panelAt = Number(process.argv[3] || 55);
  const gameDir = path.join(SP, "game-" + version.replace(/[^\w.-]/g, "_"));
  fs.rmSync(gameDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(gameDir, "saves"), { recursive: true });
  const inst = { id: "zz-rename", name: "Rename check", mcVersion: version, loader: "fabric", gameDir, hud: true, homeScreen: true };
  const t0 = Date.now();
  const installResult = await minecraft.ensureInstalled(inst, () => {});
  console.log("installed in", Math.round((Date.now() - t0) / 1000), "s; mods:", fs.readdirSync(path.join(gameDir, "mods")).filter((f) => /reminth/.test(f)).join(", "));
  fs.writeFileSync(path.join(gameDir, "options.txt"), ["onboardAccessibility:false", "skipMultiplayerWarning:true", "pauseOnLostFocus:false", "fullscreen:false", "enableVsync:false", "maxFps:60", "narrator:0"].join("\n") + "\n");
  const settings = { maxMemoryMb: 3072, gc: "auto", processPriority: "normal", fullscreen: false, gameWidth: 1280, gameHeight: 720, extraJvmArgs: `-Dreminthhud.testOpenPanel=${panelAt}`, appVersion: "1.8.0" };
  const account = { username: "Bench", uuid: "8d3f5b0e2c1a4b7f9e6d5c4b3a291807", minecraftAccessToken: "0", xuid: "0" };
  let crash = null;
  const launchedAt = Date.now();
  minecraft.launch(installResult, account, (c) => (crash = c), settings, { id: "zz-rename", gameDir }, {});
  let pid = "";
  const until = Date.now() + 240000;
  while (Date.now() < until && !crash) {
    await sleep(3000);
    try {
      pid = ps(`(Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'java' -and $_.CommandLine -like '*${path.basename(gameDir)}*' } | Select-Object -First 1).ProcessId`);
    } catch {
      pid = "";
    }
    if (pid && ps(`(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).MainWindowTitle`)) break;
  }
  if (!pid) {
    console.log("NO GAME WINDOW", crash ? JSON.stringify(crash).slice(0, 300) : "");
    process.exit(1);
  }
  const shot = (name) => {
    try {
      cp.execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${REPO}/tools/overnight/capwin.ps1" -ProcessId ${pid} -Out "${path.join(SP, name)}"`, { stdio: "ignore" });
    } catch {}
  };
  await sleep(12000);
  shot(`title-${version}.png`);
  // the panel opens at panelAt seconds of JVM uptime; wait past it
  await sleep(Math.max(0, panelAt * 1000 - (Date.now() - launchedAt)) + 20000);
  shot(`panel-${version}.png`);
  const log = fs.readFileSync(path.join(gameDir, "logs", "latest.log"), "utf8");
  const lines = log.split(/\r?\n/);
  console.log("log: errors", lines.filter((l) => /\/ERROR\]|Exception/.test(l)).slice(0, 8).join("\n   "));
  console.log("log: our mods", lines.filter((l) => /reminth|Spaceport/i.test(l)).slice(0, 12).join("\n   "));
  try {
    cp.execSync(`taskkill /pid ${pid} /t /f`, { stdio: "ignore" });
  } catch {}
  console.log("DONE", version);
})().catch((e) => {
  console.error("FAILED", e && e.stack);
  process.exit(1);
});
