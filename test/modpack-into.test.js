"use strict";
/**
 * Modpacks: Cancel during an install (nothing is kept), and adding a pack to an EXISTING instance (same Minecraft
 * version and loader only; the player's files are never overwritten - on a clash the pack's copy goes to a backup
 * folder; the added mods are recorded as the player's own; everything added is undone on an error).
 * No network (fetch is a stub), no Electron. Run with: node --test test/modpack-into.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "reminth-packinto-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return "STUB_ELECTRON_PACKINTO";
  if (request === "extract-zip") return "STUB_EXTRACT_ZIP_PACKINTO";
  return originalResolve.call(this, request, ...rest);
};
Module._cache.STUB_ELECTRON_PACKINTO = {
  id: "STUB_ELECTRON_PACKINTO",
  filename: "STUB_ELECTRON_PACKINTO",
  loaded: true,
  exports: { safeStorage: { isEncryptionAvailable: () => false } },
};
// A small stand-in for extract-zip: unpacks the test zips (STORE only) with Reminth's own reader.
Module._cache.STUB_EXTRACT_ZIP_PACKINTO = {
  id: "STUB_EXTRACT_ZIP_PACKINTO",
  filename: "STUB_EXTRACT_ZIP_PACKINTO",
  loaded: true,
  exports: async (file, { dir }) => {
    const zip = await require("../src/main/zipread").openZip(file);
    try {
      for (const e of zip.list()) {
        if (e.name.endsWith("/")) continue;
        const to = path.join(dir, e.name);
        await fsp.mkdir(path.dirname(to), { recursive: true });
        await fsp.writeFile(to, await zip.read(e.name));
      }
    } finally {
      await zip.close();
    }
  },
};

const paths = require("../src/main/paths");
const content = require("../src/main/content");
const modrinth = require("../src/main/modrinth");
const mrpack = require("../src/main/mrpack");
const instances = require("../src/main/instances");
const { crc32 } = require("../src/main/zip");

assert.ok(paths.ROOT.startsWith(HOME), "tests must never touch the real Reminth folder");

const sha1 = (buf) => crypto.createHash("sha1").update(buf).digest("hex");
const exists = (p) => fsp.access(p).then(() => true, () => false);

function patch(t, obj, key, value) {
  const original = obj[key];
  t.after(() => (obj[key] = original));
  obj[key] = value;
}

/** A STORE-only zip as a Buffer. */
function rawZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const body = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
    const crc = crc32(body) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
const fabricJar = (id) => rawZip([{ name: "fabric.mod.json", data: JSON.stringify({ schemaVersion: 1, id, version: "1.0.0" }) }]);

/**
 * A fake Modrinth pack: `files` { "mods/x.jar": Buffer } downloaded from the CDN, `overrides` { "config/a.txt": text }.
 * Patches modrinth + fetch for the test. `slow` makes every file download hang until aborted.
 */
function fakePack(t, { id = "PACKX", mc = "1.21.1", loader = "fabric-loader", files = {}, overrides = {}, slow = false } = {}) {
  const fileList = Object.entries(files).map(([p, buf]) => ({ path: p, hashes: { sha1: sha1(buf) }, downloads: [`https://cdn.modrinth.com/data/${id}/${encodeURIComponent(p)}`] }));
  const index = { formatVersion: 1, game: "minecraft", dependencies: { minecraft: mc, [loader]: "0.16.0" }, files: fileList };
  const pack = rawZip([{ name: "modrinth.index.json", data: JSON.stringify(index) }, ...Object.entries(overrides).map(([p, d]) => ({ name: `overrides/${p}`, data: d }))]);
  const packUrl = `https://cdn.modrinth.com/data/${id}/versions/v1/pack.mrpack`;
  patch(t, modrinth, "getProject", async () => ({ id, title: "Test Pack", icon_url: null }));
  patch(t, modrinth, "getProjectVersions", async () => [
    {
      id: "v1",
      project_id: id,
      version_number: "1",
      version_type: "release",
      loaders: [loader === "fabric-loader" ? "fabric" : loader],
      game_versions: [mc],
      files: [{ primary: true, filename: "pack.mrpack", url: packUrl, size: pack.length, hashes: { sha1: sha1(pack) } }],
    },
  ]);
  const byUrl = new Map(fileList.map((f, i) => [f.downloads[0], Object.values(files)[i]]));
  patch(t, globalThis, "fetch", async (url, init = {}) => {
    const u = String(url);
    if (u === packUrl) return new Response(pack, { status: 200 });
    if (slow) {
      // never finishes on its own: only an abort ends it
      return new Promise((_, reject) => init.signal && init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    }
    if (byUrl.has(u)) return new Response(byUrl.get(u), { status: 200 });
    return new Response("nope", { status: 404 });
  });
}

test("packFitsInstance: same Minecraft version and loader only, with a plain reason otherwise", () => {
  const fit = mrpack.packFitsInstance;
  assert.deepEqual(fit({ loader: "fabric", mcVersion: "1.21.1" }, { loader: "fabric", mcVersion: "1.21.1" }), { ok: true, why: null });
  assert.match(fit({ loader: "fabric", mcVersion: "1.21.1" }, { loader: "fabric", mcVersion: "1.21.4" }).why, /Minecraft 1\.21\.1, this instance is on 1\.21\.4/);
  assert.match(fit({ loader: "forge", mcVersion: "1.20.1" }, { loader: "fabric", mcVersion: "1.20.1" }).why, /for Forge, this instance uses Fabric/);
  assert.equal(fit(null, {}).ok, false);
});

test("Cancel while a new-instance pack downloads: the download stops and the half-made instance folder is gone", async (t) => {
  fakePack(t, { id: "SLOWPACK", files: { "mods/a.jar": fabricJar("a"), "mods/b.jar": fabricJar("b") }, slow: true });
  const before = await instances.list();
  const controller = new AbortController();
  let madeDir = null;
  const run = mrpack.installModpack({ projectId: "SLOWPACK" }, (p) => {
    if (/files/.test(p.stage) || p.stage.startsWith("Downloading Test Pack")) return;
  }, { signal: controller.signal });
  // wait until the instance exists (the file downloads hang), then cancel
  for (let i = 0; i < 100; i++) {
    const now = await instances.list();
    const extra = now.find((x) => !before.some((b) => b.id === x.id));
    if (extra) {
      madeDir = extra.gameDir;
      break;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.ok(madeDir, "the instance was being made");
  controller.abort();
  await assert.rejects(run, (err) => err.code === "CANCELLED");
  assert.equal((await instances.list()).length, before.length, "no instance left");
  assert.equal(await exists(madeDir), false, "its folder is deleted");
});

test("into an existing instance: the player's files stay, the pack's copies go to a backup folder, the rest is added as the player's own", async (t) => {
  const inst = await instances.create({ name: "Mine", mcVersion: "1.21.1", loader: "fabric" });
  const mods = path.join(inst.gameDir, "mods");
  await fsp.mkdir(mods, { recursive: true });
  await fsp.mkdir(path.join(inst.gameDir, "config"), { recursive: true });
  const myOptions = fabricJar("sodium");
  await fsp.writeFile(path.join(mods, "sodium-mine.jar"), myOptions); // same mod id as the pack's sodium, other file name
  await fsp.writeFile(path.join(mods, "same-name.jar"), fabricJar("mine")); // same file name as one of the pack's
  await fsp.writeFile(path.join(inst.gameDir, "config", "keep.txt"), "player's settings");
  fakePack(t, {
    id: "GOODPACK",
    files: { "mods/sodium-pack.jar": fabricJar("sodium"), "mods/same-name.jar": fabricJar("packs-own"), "mods/new.jar": fabricJar("newmod") },
    overrides: { "config/keep.txt": "pack settings", "config/added.txt": "new file" },
  });
  const r = await mrpack.installModpackInto(inst, { projectId: "GOODPACK" });
  // the player's files are untouched
  assert.equal(await fsp.readFile(path.join(inst.gameDir, "config", "keep.txt"), "utf8"), "player's settings");
  assert.deepEqual(await fsp.readFile(path.join(mods, "sodium-mine.jar")), myOptions);
  // the new ones are added
  assert.equal(await exists(path.join(mods, "new.jar")), true);
  assert.equal(await fsp.readFile(path.join(inst.gameDir, "config", "added.txt"), "utf8"), "new file");
  // the clashing pack copies are in the backup folder, not in mods/
  assert.equal(await exists(path.join(mods, "sodium-pack.jar")), false, "a second copy of the same mod would stop the game");
  assert.ok(r.clashDir && r.clashDir.includes(path.join(".reminth", "modpack-clashes")));
  for (const rel of ["mods/sodium-pack.jar", "mods/same-name.jar", "config/keep.txt"]) {
    assert.equal(await exists(path.join(r.clashDir, ...rel.split("/"))), true, rel);
    assert.ok(r.clashes.includes(rel), rel);
  }
  assert.equal(await fsp.readFile(path.join(r.clashDir, "config", "keep.txt"), "utf8"), "pack settings");
  // the added mod is the player's own: listed by name, never in Reminth's managed list
  const manifest = await content.readManifest(inst.gameDir);
  assert.equal(manifest.files["mods/new.jar"].playerOwned, true);
  assert.equal(manifest.files["mods/same-name.jar"], undefined);
  assert.equal(await exists(path.join(inst.gameDir, ".reminth", "managed-mods.json")), false);
  assert.equal(r.added >= 2, true);
});

test("into an existing instance: a pack for another version is refused before anything is added", async (t) => {
  const inst = await instances.create({ name: "Other", mcVersion: "1.21.4", loader: "fabric" });
  fakePack(t, { id: "VERPACK", mc: "1.21.1", files: { "mods/x.jar": fabricJar("x") } });
  await assert.rejects(mrpack.installModpackInto(inst, { projectId: "VERPACK" }), /Minecraft 1\.21\.1, this instance is on 1\.21\.4/);
  assert.equal(await exists(path.join(inst.gameDir, "mods", "x.jar")), false);
});

test("into an existing instance: Cancel removes everything this run added and nothing of the player's", async (t) => {
  const inst = await instances.create({ name: "Cancel me", mcVersion: "1.21.1", loader: "fabric" });
  const mods = path.join(inst.gameDir, "mods");
  await fsp.mkdir(mods, { recursive: true });
  await fsp.writeFile(path.join(mods, "mine.jar"), fabricJar("mine"));
  fakePack(t, { id: "SLOWINTO", files: { "mods/p1.jar": fabricJar("p1"), "mods/p2.jar": fabricJar("p2") }, slow: true });
  const controller = new AbortController();
  const run = mrpack.installModpackInto(inst, { projectId: "SLOWINTO" }, null, { signal: controller.signal });
  await new Promise((r) => setTimeout(r, 200));
  controller.abort();
  await assert.rejects(run, (err) => err.code === "CANCELLED");
  assert.deepEqual((await fsp.readdir(mods)).sort(), ["mine.jar"]);
  assert.equal(await exists(path.join(inst.gameDir, ".reminth", "modpack-clashes")), false);
});
