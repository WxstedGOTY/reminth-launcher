"use strict";
/**
 * Home: which instance the hero is about (src/renderer/pure.js), Play on the
 * "Jump back in" cards - server addresses, world folder names checked on the
 * main side (gameData), and whether a version can open a world directly
 * (minecraft.supportsWorldJoin, from the version's own arguments).
 * No network, no Electron.
 * Run with: node --test test/home-play.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "reminth-homeplay-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return "STUB_ELECTRON_HOMEPLAY";
  if (request === "extract-zip") return "STUB_EXTRACT_HOMEPLAY";
  return originalResolve.call(this, request, ...rest);
};
Module._cache.STUB_ELECTRON_HOMEPLAY = { id: "STUB_ELECTRON_HOMEPLAY", filename: "STUB_ELECTRON_HOMEPLAY", loaded: true, exports: { safeStorage: { isEncryptionAvailable: () => false } } };
Module._cache.STUB_EXTRACT_HOMEPLAY = { id: "STUB_EXTRACT_HOMEPLAY", filename: "STUB_EXTRACT_HOMEPLAY", loaded: true, exports: async () => {} };

const pure = require("../src/renderer/pure");
const gameData = require("../src/main/gameData");
const minecraft = require("../src/main/minecraft");

/* ---------------- the hero ---------------- */

test("heroInstance: the last played one, not the selected one", () => {
  const list = [
    { id: "a", lastPlayed: 100 },
    { id: "b", lastPlayed: 300 },
    { id: "c", lastPlayed: null },
  ];
  assert.equal(pure.heroInstance(list, "c").id, "b");
  assert.equal(pure.heroInstance(list, "a").id, "b");
});

test("heroInstance: ties keep the earlier one; never played -> the selected one, else the first", () => {
  assert.equal(pure.heroInstance([{ id: "a", lastPlayed: 5 }, { id: "b", lastPlayed: 5 }], "b").id, "a");
  const never = [{ id: "a" }, { id: "b", lastPlayed: 0 }, { id: "c", lastPlayed: "nope" }];
  assert.equal(pure.heroInstance(never, "c").id, "c");
  // the selected one was deleted: the first
  assert.equal(pure.heroInstance(never, "gone").id, "a");
});

test("markPlayed: the instance just started becomes the hero at once (before the list is read again)", () => {
  const list = [
    { id: "a", name: "A", lastPlayed: 1000 },
    { id: "b", name: "B", lastPlayed: 500 },
  ];
  assert.equal(pure.heroInstance(list, "a").id, "a");
  const after = pure.markPlayed(list, "b", 2000);
  assert.equal(pure.heroInstance(after, "a").id, "b");
  assert.deepEqual(after[1], { id: "b", name: "B", lastPlayed: 2000 });
  assert.equal(after[0], list[0], "the others are left as they were");
  assert.equal(list[1].lastPlayed, 500, "the old list isn't changed");
  // a newer value already there is kept; bad times and unknown ids change nothing
  assert.equal(pure.markPlayed(list, "a", 900)[0].lastPlayed, 1000);
  for (const bad of [NaN, 0, -5, "x", undefined]) assert.deepEqual(pure.markPlayed(list, "b", bad), list);
  assert.deepEqual(pure.markPlayed(list, "gone", 3000), list);
  assert.deepEqual(pure.markPlayed(null, "b", 3000), []);
});

test("heroInstance: bad input never throws", () => {
  assert.equal(pure.heroInstance(null, "x"), null);
  assert.equal(pure.heroInstance([], "x"), null);
  assert.equal(pure.heroInstance([null, 5, { name: "no id" }, { id: "ok" }], null).id, "ok");
  assert.equal(pure.heroInstance([{ id: "a", lastPlayed: -1 }, { id: "b", lastPlayed: Infinity }], "a").id, "a");
});

/* ---------------- server addresses ---------------- */

test("parseServerAddress: host, host:port, [IPv6], [IPv6]:port, bare IPv6", () => {
  const p = pure.parseServerAddress;
  assert.deepEqual(p("play.example.net"), { host: "play.example.net", port: 25565, ipv6: false });
  assert.deepEqual(p("  mc.example.org:25570 "), { host: "mc.example.org", port: 25570, ipv6: false });
  assert.deepEqual(p("127.0.0.1:1"), { host: "127.0.0.1", port: 1, ipv6: false });
  assert.deepEqual(p("[::1]"), { host: "::1", port: 25565, ipv6: true });
  assert.deepEqual(p("[2001:db8::7]:25566"), { host: "2001:db8::7", port: 25566, ipv6: true });
  assert.deepEqual(p("2001:db8::7"), { host: "2001:db8::7", port: 25565, ipv6: true });
  assert.deepEqual(p("host:"), { host: "host", port: 25565, ipv6: false });
  for (const bad of ["", "   ", null, undefined, "host:0", "host:65536", "host:abc", "ho st", "[nothex]:1", "[::1]:99999", "a/b", "[1.2.3.4]"]) {
    assert.equal(p(bad), null, String(bad));
  }
});

/* ---------------- world folder names (main side) ---------------- */

test("plainWorldFolderName: one plain name only", () => {
  const ok = gameData.plainWorldFolderName;
  for (const good of ["New World", "My World (2)", "Survival_1", "Ωmega"]) assert.equal(ok(good), true, good);
  for (const bad of ["", "..", ".", ".hidden", "a/b", "a\\b", "C:", "../etc", "trailing ", "trailing.", "tab\tname", "x".repeat(129), null, 5, {}]) {
    assert.equal(ok(bad), false, JSON.stringify(bad));
  }
});

test("worldFolderToOpen: only a real folder in THAT instance's saves", async () => {
  const inst = path.join(HOME, "inst");
  const other = path.join(HOME, "other");
  await fsp.mkdir(path.join(inst, "saves", "New World"), { recursive: true });
  await fsp.mkdir(path.join(other, "saves", "Elsewhere"), { recursive: true });
  await fsp.writeFile(path.join(inst, "saves", "a-file"), "x");
  assert.equal(await gameData.worldFolderToOpen(inst, "New World"), "New World");
  assert.equal(await gameData.worldFolderToOpen(inst, "Elsewhere"), null, "another instance's world");
  assert.equal(await gameData.worldFolderToOpen(inst, "a-file"), null, "not a folder");
  assert.equal(await gameData.worldFolderToOpen(inst, "missing"), null);
  assert.equal(await gameData.worldFolderToOpen(inst, "../other/saves/Elsewhere"), null);
  assert.equal(await gameData.worldFolderToOpen(null, "New World"), null);
  // a link in saves that points somewhere else is refused
  try {
    await fsp.symlink(path.join(other, "saves", "Elsewhere"), path.join(inst, "saves", "Linked"), "dir");
    assert.equal(await gameData.worldFolderToOpen(inst, "Linked"), null);
  } catch (err) {
    if (err.code !== "EPERM") throw err; // Windows without the right to make links: nothing to test
  }
});

/* ---------------- can this version open a world directly? ---------------- */

const QUICK_PLAY_GAME_ARGS = [
  "--username",
  "${auth_player_name}",
  { rules: [{ action: "allow", features: { is_quick_play_singleplayer: true } }], value: ["--quickPlaySingleplayer", "${quickPlaySingleplayer}"] },
  { rules: [{ action: "allow", features: { is_quick_play_multiplayer: true } }], value: ["--quickPlayMultiplayer", "${quickPlayMultiplayer}"] },
];

test("supportsWorldJoin: decided by the version's own arguments, never by number", () => {
  assert.equal(minecraft.supportsWorldJoin({ id: "1.20.1", arguments: { game: QUICK_PLAY_GAME_ARGS } }), true);
  assert.equal(minecraft.supportsWorldJoin({ id: "26.3", arguments: { game: ["--username", "x"] } }), false, "a new version without the feature: no");
  assert.equal(minecraft.supportsWorldJoin({ id: "1.12.2", minecraftArguments: "--username ${auth_player_name}" }), false);
  assert.equal(minecraft.supportsWorldJoin(null), false);
  // the argument only appears when the feature is switched on
  const sub = (s) => s.replace("${quickPlaySingleplayer}", "New World").replace("${auth_player_name}", "Steve");
  assert.deepEqual(minecraft.resolveArguments(QUICK_PLAY_GAME_ARGS, sub, { is_quick_play_singleplayer: true }), ["--username", "Steve", "--quickPlaySingleplayer", "New World"]);
  assert.deepEqual(minecraft.resolveArguments(QUICK_PLAY_GAME_ARGS, sub, {}), ["--username", "Steve"]);
});
