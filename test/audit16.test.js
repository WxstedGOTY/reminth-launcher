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
