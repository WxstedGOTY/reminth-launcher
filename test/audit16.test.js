"use strict";
/**
 * Audit 16: bugs a player on a normal Windows PC could hit, one test each.
 * No network, no Electron, everything in temp folders.
 * Run with: node --test test/audit16.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "reminth-audit16-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return "STUB_ELECTRON_AUDIT16";
  return originalResolve.call(this, request, ...rest);
};
Module._cache.STUB_ELECTRON_AUDIT16 = { id: "STUB_ELECTRON_AUDIT16", filename: "STUB_ELECTRON_AUDIT16", loaded: true, exports: {
    safeStorage: { isEncryptionAvailable: () => false },
    // streamer.js: one fake Minecraft window whose picture is the bytes in `shot`.
    desktopCapturer: { getSources: async () => [{ id: "w1", name: "Minecraft 1.21.4", thumbnail: { isEmpty: () => false, toPNG: () => Buffer.from(electronFake.shot) } }] },
    globalShortcut: { register: () => true, unregisterAll: () => {} },
    Notification: { isSupported: () => false },
    BrowserWindow: function () {},
    ipcMain: { on: () => {}, handle: () => {} },
    shell: {},
  },
};
const electronFake = { shot: "one" };

const content = require("../src/main/content");

let n = 0;
async function gameFolder(mods) {
  const gameDir = path.join(HOME, `game-${++n}`);
  await fsp.mkdir(path.join(gameDir, "mods"), { recursive: true });
  for (const [name, text] of Object.entries(mods)) await fsp.writeFile(path.join(gameDir, "mods", name), text);
  return gameDir;
}

test("Audit 16: turning a mod on or off never overwrites another file with the same name", async () => {
  // The player turned off sodium.jar, then dropped a newer sodium.jar in.
  const gameDir = await gameFolder({ "sodium.jar": "NEW", "sodium.jar.disabled": "OLD" });
  const mods = path.join(gameDir, "mods");
  await assert.rejects(content.setEnabled(gameDir, { kind: "mod", world: null, file: "sodium.jar.disabled" }, true), /already a file called sodium\.jar/);
  await assert.rejects(content.setEnabled(gameDir, { kind: "mod", world: null, file: "sodium.jar" }, false), /already a file called sodium\.jar\.disabled/);
  assert.equal(await fsp.readFile(path.join(mods, "sodium.jar"), "utf8"), "NEW");
  assert.equal(await fsp.readFile(path.join(mods, "sodium.jar.disabled"), "utf8"), "OLD");
  // with no clash it still works both ways
  const other = await gameFolder({ "lithium.jar": "L" });
  assert.deepEqual(await content.setEnabled(other, { kind: "mod", world: null, file: "lithium.jar" }, false), { file: "lithium.jar.disabled" });
  assert.deepEqual(await content.setEnabled(other, { kind: "mod", world: null, file: "lithium.jar.disabled" }, true), { file: "lithium.jar" });
  assert.equal(await fsp.readFile(path.join(other, "mods", "lithium.jar"), "utf8"), "L");
});

test("Audit 16: two screenshots in the same second are both kept (the second one used to replace the first)", async () => {
  const paths = require("../src/main/paths");
  const streamer = require("../src/main/streamer");
  const realNow = Date.now;
  Date.now = () => new Date(2026, 9, 4, 12, 0, 0, 100).getTime(); // the hotkey pressed twice in one second
  const RealDate = global.Date;
  global.Date = class extends RealDate {
    constructor(...a) {
      super(...(a.length ? a : [Date.now()]));
    }
  };
  global.Date.now = Date.now;
  try {
    electronFake.shot = "first";
    const [a, b] = await Promise.all([streamer.takeScreenshot(), (async () => {
      electronFake.shot = "second";
      return streamer.takeScreenshot();
    })()]);
    assert.ok(a.file && b.file, "both saved");
    assert.notEqual(a.file, b.file);
    const dir = path.join(paths.CAPTURES_DIR, "Screenshots");
    const names = (await fsp.readdir(dir)).sort();
    assert.equal(names.length, 2, names.join(", "));
    assert.deepEqual(names, ["Reminth-2026-10-04_12-00-00-2.png", "Reminth-2026-10-04_12-00-00.png"]);
  } finally {
    global.Date = RealDate;
    Date.now = realNow;
  }
});

test("Audit 16: two servers added at once both end up in servers.dat", async () => {
  const gameData = require("../src/main/gameData");
  const nbt = require("../src/main/nbt");
  const gameDir = await gameFolder({});
  await fsp.writeFile(path.join(gameDir, "servers.dat"), nbt.writeServersDat([{ name: "Mine", ip: "mine.example.net" }]));
  const results = await Promise.all([
    gameData.addServer(gameDir, { name: "A", address: "a.example.net" }),
    gameData.addServer(gameDir, { name: "B", address: "b.example.net" }),
  ]);
  assert.deepEqual(results, [{ added: true }, { added: true }]);
  const ips = nbt.parse(await fsp.readFile(path.join(gameDir, "servers.dat"))).servers.map((s) => s.ip).sort();
  assert.deepEqual(ips, ["a.example.net", "b.example.net", "mine.example.net"]);
});

test("Audit 16: a token saved while the PC clock ran ahead is renewed once the clock is right again", () => {
  const msAuth = require("../src/main/msAuth");
  const NOW = Date.UTC(2026, 9, 4, 12);
  const HOUR = 60 * 60 * 1000;
  const acc = (expiresAt) => ({ minecraftAccessToken: "t", minecraftAccessTokenExpiresAt: expiresAt, msRefreshToken: "r" });
  // Saved when the clock said three days later: Minecraft tokens last 24 hours, so this one is long dead.
  assert.equal(msAuth.needsRefresh(acc(NOW + 3 * 24 * HOUR), NOW), true);
  // A normal token with most of its day left is still used as it is.
  assert.equal(msAuth.needsRefresh(acc(NOW + 23 * HOUR), NOW), false);
});

test("Audit 16: with the PC clock behind, the copy of the jars an update just replaced isn't pruned straight away", async () => {
  const modsSync = require("../src/main/modsSync");
  const gameDir = await gameFolder({ "x.jar": "old build" });
  for (let i = 0; i < 6; i++) await modsSync.backupJars(gameDir, ["x.jar"], new Date(Date.UTC(2026, 9, 3, 10, i)));
  // The clock now says 2015 (a flat CMOS battery): this copy's name sorts first.
  const dir = await modsSync.backupJars(gameDir, ["x.jar"], new Date(Date.UTC(2015, 0, 1)));
  assert.equal(await fsp.readFile(path.join(dir, "x.jar"), "utf8"), "old build");
  // still five kept in all
  assert.equal((await fsp.readdir(path.dirname(dir))).length, 5);
});

test("Audit 16: with the PC clock behind, a damaged file that was just set aside isn't pruned straight away", async () => {
  const atomic = require("../src/main/atomic");
  const dir = await gameFolder({});
  const file = path.join(dir, "instances.json");
  // two earlier set-aside copies, made when the clock was right
  await fsp.writeFile(`${file}.corrupt-1790000000000`, "a");
  await fsp.writeFile(`${file}.corrupt-1790000000001`, "b");
  await fsp.writeFile(file, "{ damaged");
  const realNow = Date.now;
  Date.now = () => 1420070400000; // 2015
  let moved;
  try {
    moved = await atomic.quarantine(file);
  } finally {
    Date.now = realNow;
  }
  assert.equal(await fsp.readFile(moved, "utf8"), "{ damaged");
  assert.equal((await fsp.readdir(dir)).filter((n) => n.includes(".corrupt-")).length, 2);
});

test("Audit 16: on a screen smaller than 1000x660 (1080p at 175 % scaling) the window fits on it", () => {
  const { windowSizes } = require("../src/main/windowRestore");
  // 1920x1080 at 175 %: 1097 x 590 usable
  const small = windowSizes({ width: 1097, height: 590 });
  assert.ok(small.minWidth <= 1097 && small.minHeight <= 590, JSON.stringify(small));
  assert.ok(small.width <= 1097 && small.height <= 590, JSON.stringify(small));
  // a normal 1080p screen at 100 %: as before
  assert.deepEqual(windowSizes({ width: 1920, height: 1032 }), { width: 1320, height: 840, minWidth: 1000, minHeight: 660 });
  assert.deepEqual(windowSizes({ width: 1280, height: 680 }), { width: 1088, height: 660, minWidth: 1000, minHeight: 660 });
});

test("uiZoom: normal size from 1280x760 up (the default window too); smaller windows scaled just enough, never below 0.75", () => {
  const { uiZoom } = require("../src/main/windowRestore");
  const wa = { width: 1920, height: 1032 };
  assert.equal(uiZoom(wa, wa), 1); // maximized
  assert.equal(uiZoom({ width: 1320, height: 840 }, wa), 1); // the default window: was 0.69 ("everything so small")
  assert.equal(uiZoom({ width: 1280, height: 760 }, wa), 1);
  assert.equal(uiZoom({ width: 3000, height: 2000 }, wa), 1);
  // smaller: the narrower side decides, so nothing is cut off
  assert.equal(uiZoom({ width: 1024, height: 760 }, wa), 0.8);
  assert.equal(uiZoom({ width: 1280, height: 684 }, wa), 0.9);
  assert.equal(uiZoom({ width: 1000, height: 660 }, wa), 0.781);
  assert.equal(uiZoom({ width: 300, height: 200 }, wa), 0.75);
  assert.equal(uiZoom(null, wa), 1);
});
