"use strict";
/**
 * "Safe to delete" -> Delete all (content.invalidItems / invalidDetails /
 * removeInvalid) and which changes a running game blocks (touchesMods).
 * Real folders under a throwaway HOME; the Recycle Bin is a fake that
 * records what it was given. No network, no Electron.
 * Run with: node --test test/content-cleanup.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "reminth-cleanup-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return "STUB_ELECTRON_CLEANUP";
  return originalResolve.call(this, request, ...rest);
};
Module._cache.STUB_ELECTRON_CLEANUP = { id: "STUB_ELECTRON_CLEANUP", filename: "STUB_ELECTRON_CLEANUP", loaded: true, exports: { safeStorage: { isEncryptionAvailable: () => false } } };

const content = require("../src/main/content");
const zip = require("../src/main/zip");

async function realJar(out) {
  const src = path.join(HOME, "jarsrc", path.basename(out));
  await fsp.mkdir(src, { recursive: true });
  await fsp.writeFile(path.join(src, "fabric.mod.json"), JSON.stringify({ schemaVersion: 1, id: "real", version: "1" }));
  await zip.buildZip(src, out);
}

/** An instance with a real mod, a switched-off mod, a folder with files, a stray file; and packs. */
async function messyInstance(name) {
  const gameDir = path.join(HOME, name);
  const mods = path.join(gameDir, "mods");
  await fsp.mkdir(path.join(mods, "New folder", "deep"), { recursive: true });
  await fsp.writeFile(path.join(mods, "New folder", "a.txt"), "a");
  await fsp.writeFile(path.join(mods, "New folder", "deep", "b.txt"), "b");
  await fsp.mkdir(path.join(mods, "empty"), { recursive: true });
  await fsp.writeFile(path.join(mods, "archive.rar"), "xyz");
  await realJar(path.join(mods, "real.jar"));
  await realJar(path.join(mods, "off.jar.disabled"));
  const packs = path.join(gameDir, "resourcepacks");
  await fsp.mkdir(path.join(packs, "Unpacked pack"), { recursive: true });
  await fsp.writeFile(path.join(packs, "pack.zip"), "zip");
  await fsp.writeFile(path.join(packs, "readme.txt"), "hi");
  return gameDir;
}

function fakeTrash({ failOn = [] } = {}) {
  const got = [];
  const trash = async (full) => {
    if (failOn.some((f) => full.endsWith(f))) throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
    got.push(full);
    await fsp.rm(full, { recursive: true, force: true }); // stands in for "moved to the Recycle Bin"
  };
  return { got, trash };
}

test("invalidItems: folders and non-.jar files in mods; non-.zip files in packs; never a real mod or pack", async () => {
  const gameDir = await messyInstance("pure");
  const all = await content.listAll(gameDir);
  assert.deepEqual(content.invalidItems(all, "mod").map((i) => i.file).sort(), ["New folder", "archive.rar", "empty"]);
  assert.deepEqual(content.invalidItems(all, "resourcepack").map((i) => i.file), ["readme.txt"]);
  assert.deepEqual(content.invalidItems(all, "shader"), []);
  assert.deepEqual(content.invalidItems(all, "nonsense"), []);
  assert.deepEqual(content.invalidItems(null, "mod"), []);
  // fake data: valid items are never picked, whatever else they look like
  const fake = { mod: [{ file: "x.jar", valid: true }, { file: "y", valid: false }, { file: "z.jar", valid: undefined }] };
  assert.deepEqual(content.invalidItems(fake, "mod").map((i) => i.file), ["y"]);
});

test("invalidDetails: size for files, file count for folders (all levels)", async () => {
  const gameDir = await messyInstance("details");
  const d = Object.fromEntries((await content.invalidDetails(gameDir, "mod")).map((x) => [x.file, x]));
  assert.deepEqual([d["New folder"].folder, d["New folder"].files, d["New folder"].more], [true, 2, false]);
  assert.deepEqual([d.empty.files, d.empty.more], [0, false]);
  assert.deepEqual([d["archive.rar"].folder, d["archive.rar"].size], [false, 3]);
});

test("removeInvalid: re-reads the folder and moves only what is invalid there - the real mods stay", async () => {
  const gameDir = await messyInstance("remove");
  const { got, trash } = fakeTrash();
  const r = await content.removeInvalid(gameDir, "mod", trash);
  assert.equal(r.total, 3);
  assert.deepEqual(r.moved.sort(), ["New folder", "archive.rar", "empty"]);
  assert.deepEqual(r.failed, []);
  for (const full of got) assert.ok(full.startsWith(path.join(gameDir, "mods") + path.sep), full);
  assert.deepEqual((await fsp.readdir(path.join(gameDir, "mods"))).sort(), ["off.jar.disabled", "real.jar"]);
  // packs: only the stray file
  const p = await content.removeInvalid(gameDir, "resourcepack", trash);
  assert.deepEqual(p.moved, ["readme.txt"]);
  assert.deepEqual((await fsp.readdir(path.join(gameDir, "resourcepacks"))).sort(), ["Unpacked pack", "pack.zip"]);
  await assert.rejects(content.removeInvalid(gameDir, "../mods", trash), /can't be cleaned up/);
});

test("removeInvalid: one locked item is reported, the rest still go", async () => {
  const gameDir = await messyInstance("locked");
  const { trash } = fakeTrash({ failOn: ["archive.rar"] });
  const r = await content.removeInvalid(gameDir, "mod", trash);
  assert.equal(r.total, 3);
  assert.equal(r.moved.length, 2);
  assert.deepEqual(r.failed.map((f) => f.file), ["archive.rar"]);
  assert.match(r.failed[0].error, /EBUSY/);
});

test("touchesMods: only mods are locked while the game runs", () => {
  assert.equal(content.touchesMods("mod"), true);
  for (const k of ["resourcepack", "shader", "datapack", undefined, "x"]) assert.equal(content.touchesMods(k), false, String(k));
});
