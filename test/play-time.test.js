"use strict";
/**
 * Prompt 12 job 1: Home's lifetime "Time played" (settings.json
 * totalPlayTimeMs) - seeded once from the instances, added to at every
 * session's end, never lowered, untouched by deleting an instance, and not
 * something a settings save from the page can change.
 * Run with: node --test test/play-time.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "reminth-playtime-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.APPDATA = path.join(HOME, "AppData", "Roaming");
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return "STUB_ELECTRON_PLAYTIME";
  return originalResolve.call(this, request, ...rest);
};
Module._cache.STUB_ELECTRON_PLAYTIME = { id: "STUB_ELECTRON_PLAYTIME", filename: "STUB_ELECTRON_PLAYTIME", loaded: true, exports: { safeStorage: { isEncryptionAvailable: () => false } } };

const store = require("../src/main/store");
const paths = require("../src/main/paths");
const instances = require("../src/main/instances");
const pure = require("../src/renderer/pure");

const onDisk = async () => JSON.parse(await fsp.readFile(paths.SETTINGS_FILE, "utf8"));
const H = 3600 * 1000;

test("cleanTotalPlayTime / seededTotal / addedTotal: junk is 'absent', never seeded twice, never lowered", () => {
  for (const bad of [undefined, null, -1, NaN, Infinity, "12", {}, 1e20]) assert.equal(store.cleanTotalPlayTime(bad), null, String(bad));
  assert.equal(store.cleanTotalPlayTime(12.7), 12);
  assert.equal(store.seededTotal(undefined, 5 * H), 5 * H);
  assert.equal(store.seededTotal("garbage", 5 * H), 5 * H, "junk counts as absent");
  assert.equal(store.seededTotal(9 * H, 5 * H), 9 * H, "already there: kept, even when the instances add up to less");
  assert.equal(store.addedTotal(9 * H, H), 10 * H);
  assert.equal(store.addedTotal(9 * H, -5), 9 * H, "a session that didn't run adds nothing");
  assert.equal(store.addedTotal(9 * H, NaN), 9 * H);
});

test("seedPlayTime: absent -> the instances' sum; present -> unchanged; junk -> treated as absent", async () => {
  await fsp.mkdir(path.dirname(paths.SETTINGS_FILE), { recursive: true });
  await fsp.writeFile(paths.SETTINGS_FILE, JSON.stringify({ accent: "rose" }));
  assert.equal(await store.seedPlayTime(async () => 7 * H), 7 * H);
  let s = await onDisk();
  assert.equal(s.totalPlayTimeMs, 7 * H);
  assert.equal(s.accent, "rose", "the rest of settings.json is kept");
  // a second start: never seeded again, whatever the instances say now
  assert.equal(await store.seedPlayTime(async () => 99 * H), 7 * H);
  assert.equal((await onDisk()).totalPlayTimeMs, 7 * H);
  // junk in the file: as if there were none
  await fsp.writeFile(paths.SETTINGS_FILE, JSON.stringify({ accent: "rose", totalPlayTimeMs: "lots" }));
  assert.equal(await store.seedPlayTime(async () => 3 * H), 3 * H);
});

test("addPlayTime: each finished session adds its time; with no counter yet it seeds from the instances (counting the session once)", async () => {
  await fsp.writeFile(paths.SETTINGS_FILE, JSON.stringify({ totalPlayTimeMs: 2 * H }));
  assert.equal(await store.addPlayTime(30 * 60 * 1000, async () => 0), 2.5 * H);
  // two games ending together both count (the settings lock)
  await Promise.all([store.addPlayTime(H, null), store.addPlayTime(H, null)]);
  assert.equal((await onDisk()).totalPlayTimeMs, 4.5 * H);
  assert.equal(await store.addPlayTime(0, null), null, "nothing ran: nothing written");
  // no counter yet: the instances' sum, which already holds this session
  await fsp.writeFile(paths.SETTINGS_FILE, JSON.stringify({}));
  assert.equal(await store.addPlayTime(H, async () => 6 * H), 6 * H);
});

test("the counter survives deleting an instance, and a settings save from the page can't change it", async () => {
  await fsp.writeFile(paths.SETTINGS_FILE, JSON.stringify({}));
  const a = await instances.create({ name: "A", mcVersion: "1.21.4", loader: "vanilla" });
  const b = await instances.create({ name: "B", mcVersion: "1.21.4", loader: "vanilla" });
  await instances.recordSession(a.id, 0, 2 * H);
  await instances.recordSession(b.id, 0, 3 * H);
  const sum = async () => (await instances.list()).reduce((t, i) => t + (i.playTimeMs || 0), 0);
  assert.equal(await store.seedPlayTime(sum), 5 * H);
  await instances.remove(b.id);
  assert.equal(await sum(), 2 * H, "the instances' sum shrank...");
  assert.equal((await store.loadSettings()).totalPlayTimeMs, 5 * H, "...the counter didn't");
  // settings:set from the page: the key is ignored, the counter kept
  const saved = await store.saveSettings({ totalPlayTimeMs: 1, accent: "violet" });
  assert.equal(saved.totalPlayTimeMs, 5 * H);
  assert.equal((await onDisk()).totalPlayTimeMs, 5 * H);
  assert.equal(saved.accent, "violet");
});

test("homePlayTime: the counter when there is one, else the instances' sum", () => {
  const list = [{ playTimeMs: H }, { playTimeMs: 2 * H }, { playTimeMs: "x" }, null];
  assert.equal(pure.homePlayTime({ totalPlayTimeMs: 10 * H }, list), 10 * H);
  assert.equal(pure.homePlayTime({ totalPlayTimeMs: 0 }, list), 0);
  assert.equal(pure.homePlayTime({}, list), 3 * H);
  assert.equal(pure.homePlayTime(null, null), 0);
  assert.equal(pure.homePlayTime({ totalPlayTimeMs: -4 }, list), 3 * H);
});
