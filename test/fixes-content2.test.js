"use strict";
/**
 * Regression tests for the second round of content / registry / account /
 * Modrinth fixes: the lenient jar reader, manifest reads that can't wipe
 * tracking, pack paths into .reminth, body timeouts, registry rebuilds,
 * tolerant mod descriptors, nested mods, account storage, temp-file sweeps.
 * No network (fetch is stubbed), no Electron, everything in temp folders.
 * Run with: node --test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");
const crypto = require("crypto");

// paths.js works everything out from the home folder when it is first
// loaded - point that at a throwaway folder before anything requires it.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "reminth-fixes2-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
test.after(() => fsp.rm(HOME, { recursive: true, force: true }));

// store.js pulls in electron for safeStorage - stub it. The fake
// "encryption" (a marker byte + reversed text) is switched on per test.
const safeStorage = {
  available: false,
  isEncryptionAvailable: () => safeStorage.available,
  encryptString: (text) => Buffer.concat([Buffer.from([0x01]), Buffer.from([...Buffer.from(text, "utf8")].reverse())]),
  decryptString: (buf) => {
    if (buf[0] !== 0x01) throw new Error("not ours");
    return Buffer.from([...buf.subarray(1)].reverse()).toString("utf8");
  },
};
const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return "STUB_ELECTRON_FIXES2";
  return originalResolve.call(this, request, ...rest);
};
Module._cache.STUB_ELECTRON_FIXES2 = { id: "STUB_ELECTRON_FIXES2", filename: "STUB_ELECTRON_FIXES2", loaded: true, exports: { safeStorage } };

const paths = require("../src/main/paths");
const atomic = require("../src/main/atomic");
const content = require("../src/main/content");
const modrinth = require("../src/main/modrinth");
const store = require("../src/main/store");
const zipread = require("../src/main/zipread");
const mrpack = require("../src/main/mrpack");
const { crc32 } = require("../src/main/zip");

assert.ok(paths.ROOT.startsWith(HOME), "tests must never touch the real Reminth folder");

const sha1 = (buf) => crypto.createHash("sha1").update(buf).digest("hex");
const tmpDir = (name) => fsp.mkdtemp(path.join(HOME, `${name}-`));
const exists = (p) => fsp.access(p).then(() => true, () => false);

/** Replaces obj[key] for the length of one test. */
const patched = new Map();
function patch(t, obj, key, value) {
  if (!patched.has(obj)) patched.set(obj, new Map());
  const originals = patched.get(obj);
  if (!originals.has(key)) {
    originals.set(key, obj[key]);
    t.after(() => {
      obj[key] = originals.get(key);
      originals.delete(key);
    });
  }
  obj[key] = value;
}

/**
 * A STORE-only zip as a Buffer. Unlike zip.js's buildZip this takes a plain
 * list, so the same name can appear twice - which real mod jars do.
 */
function rawZip(entries, { trailing = null } = {}) {
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
  return Buffer.concat([...locals, cd, eocd, ...(trailing ? [trailing] : [])]);
}

const fabricJson = (id, extra = {}) => JSON.stringify({ schemaVersion: 1, id, version: "1.0.0", name: id.toUpperCase(), ...extra });
const fabricJar = (id, extra) => rawZip([{ name: "fabric.mod.json", data: fabricJson(id, extra) }]);

async function jarMeta(file) {
  return content.readJarMeta(file, await fsp.stat(file));
}

/* ------------------------------------------------------------------ */
/* 1. zip reader: strict for packs, lenient for jars                  */
/* ------------------------------------------------------------------ */

test("zipread: a jar with repeated names and bytes after its end record still gives up its metadata", async () => {
  const dir = await tmpDir("jar-lenient");
  const file = path.join(dir, "real-world.jar");
  // Trailing bytes that even contain the end-record signature, as noise.
  const trailing = Buffer.concat([Buffer.from("signature block "), Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.alloc(40, 7)]);
  await fsp.writeFile(
    file,
    rawZip(
      [
        { name: "META-INF/", data: "" },
        { name: "LICENSE", data: "first" },
        { name: "fabric.mod.json", data: fabricJson("realmod", { depends: { minecraft: ">=1.20" } }) },
        { name: "LICENSE", data: "second" },
        { name: "META-INF/", data: "" },
      ],
      { trailing }
    )
  );

  // strict (the .mrpack scan) still refuses it - for the trailing bytes here
  await assert.rejects(zipread.openZip(file, { strict: true }), /Not a zip file/);

  const zip = await zipread.openZip(file);
  try {
    assert.deepEqual(zip.names(), ["META-INF/", "LICENSE", "fabric.mod.json"]);
    assert.equal(String(await zip.read("LICENSE")), "second", "the last entry of a repeated name wins");
  } finally {
    await zip.close();
  }

  const meta = await jarMeta(file);
  assert.equal(meta.modId, "realmod");
  assert.equal(meta.name, "REALMOD");
  assert.equal(meta.descriptors.fabric, true);
  assert.equal(meta.mcDep, ">=1.20");
});

test("zipread: strict mode refuses a repeated name on its own; lenient still refuses multi-part and non-zips", async () => {
  const dir = await tmpDir("zip-modes");
  const dup = path.join(dir, "dup.zip");
  await fsp.writeFile(dup, rawZip([{ name: "a", data: "1" }, { name: "a", data: "2" }]));
  await assert.rejects(zipread.openZip(dup, { strict: true }), /two entries named a/);
  const ok = await zipread.openZip(dup);
  await ok.close();

  const multi = rawZip([{ name: "a", data: "1" }]);
  multi.writeUInt16LE(1, multi.length - 22 + 4); // "this is disk 1"
  const multiPath = path.join(dir, "multi.zip");
  await fsp.writeFile(multiPath, multi);
  await assert.rejects(zipread.openZip(multiPath), /Multi-part/);
  await assert.rejects(zipread.openZip(multiPath, { strict: true }), /Multi-part/);

  const junk = path.join(dir, "junk.jar");
  await fsp.writeFile(junk, Buffer.alloc(500, 1));
  await assert.rejects(zipread.openZip(junk), /Not a zip file/);
  assert.equal(await jarMeta(junk), null, "listed by file name, as before");
});

test("zipread: openZipBuffer reads an archive held in memory, with a per-read size ceiling", async () => {
  const zip = await zipread.openZipBuffer(rawZip([{ name: "a.txt", data: "hello" }, { name: "big.bin", data: Buffer.alloc(2000) }]));
  assert.deepEqual(zip.names(), ["a.txt", "big.bin"]);
  assert.equal(String(await zip.read("a.txt")), "hello");
  assert.equal(await zip.read("missing"), null);
  await assert.rejects(zip.read("big.bin", { maxBytes: 1000 }), /too large/);
  assert.equal((await zip.read("big.bin")).length, 2000);
  await zip.close();
  await assert.rejects(zipread.openZipBuffer(Buffer.from("not a zip at all, just some text")), /Not a zip file/);
  await assert.rejects(zipread.openZipBuffer(Buffer.alloc(0)), /Not a zip file/);
});

/* ------------------------------------------------------------------ */
/* 2. the manifest can't be wiped by a read that failed               */
/* ------------------------------------------------------------------ */

const manifestFile = (gameDir) => path.join(gameDir, ".reminth", "content.json");
const entry = (title) => ({ kind: "mod", world: null, projectId: title.toUpperCase(), versionId: "v", versionNumber: "1", title, iconUrl: null, sha1: null, installedAt: 1 });

test("manifest: a briefly locked content.json is waited for, not replaced by an empty one", async (t) => {
  const gameDir = await tmpDir("manifest-busy");
  await content.updateManifest(gameDir, (m) => void (m.files["mods/a.jar"] = entry("a")));
  assert.equal(await exists(manifestFile(gameDir) + ".bak"), true, "a successful update keeps a .bak");

  const realRead = fsp.readFile;
  let failures = 2;
  patch(t, fsp, "readFile", async (file, ...rest) => {
    if (String(file) === manifestFile(gameDir) && failures-- > 0) throw Object.assign(new Error("EBUSY: locked"), { code: "EBUSY" });
    return realRead(file, ...rest);
  });
  await content.updateManifest(gameDir, (m) => void (m.files["mods/b.jar"] = entry("b")));
  assert.deepEqual(Object.keys((await content.readManifest(gameDir)).files).sort(), ["mods/a.jar", "mods/b.jar"]);

  // locked for good: a readable error, and nothing is written
  failures = Infinity;
  const before = await realRead(manifestFile(gameDir), "utf8");
  let ran = false;
  await assert.rejects(content.updateManifest(gameDir, () => void (ran = true)), /Couldn't read this instance's content list/);
  assert.equal(ran, false);
  assert.equal(await realRead(manifestFile(gameDir), "utf8"), before);
  // listing keeps working through it, just without the tracked names
  assert.deepEqual(await content.readManifest(gameDir), { files: {} });
});

test("manifest: a damaged content.json is moved aside and the .bak carries on; a BOM is not damage", async () => {
  const gameDir = await tmpDir("manifest-corrupt");
  await content.updateManifest(gameDir, (m) => void (m.files["mods/a.jar"] = entry("a")));
  await fsp.writeFile(manifestFile(gameDir), '{"files":{"mods/a.j');

  await content.updateManifest(gameDir, (m) => void (m.files["mods/b.jar"] = entry("b")));
  const files = (await content.readManifest(gameDir)).files;
  assert.deepEqual(Object.keys(files).sort(), ["mods/a.jar", "mods/b.jar"]);
  assert.equal(files["mods/a.jar"].title, "a");
  const aside = (await fsp.readdir(path.join(gameDir, ".reminth"))).filter((n) => n.startsWith("content.json.corrupt-"));
  assert.equal(aside.length, 1);

  // saved by an editor that adds a byte-order mark: still the same manifest
  await fsp.writeFile(manifestFile(gameDir), "﻿" + JSON.stringify({ files: { "mods/c.jar": entry("c") } }));
  assert.equal((await content.readManifest(gameDir)).files["mods/c.jar"].title, "c");
  await content.updateManifest(gameDir, (m) => void (m.files["mods/d.jar"] = entry("d")));
  assert.deepEqual(Object.keys((await content.readManifest(gameDir)).files).sort(), ["mods/c.jar", "mods/d.jar"]);
  assert.equal((await fsp.readdir(path.join(gameDir, ".reminth"))).filter((n) => n.includes("corrupt")).length, 1, "not quarantined again");

  // a first-ever update (no file at all) starts empty
  const fresh = await tmpDir("manifest-fresh");
  await content.updateManifest(fresh, (m) => assert.deepEqual(m, { files: {} }));
});

/* ------------------------------------------------------------------ */
/* 3. a pack can't write into .reminth through its file list          */
/* ------------------------------------------------------------------ */

test("mrpack: file paths into Reminth's own folder are recognised however they are spelled", () => {
  for (const bad of [".reminth/content.json", ".Reminth/managed-mods.json", ".reminth./x", ".REMINTH. /x", "./.reminth/x", "mods/../.reminth/x", ".reminth\\content.json", ".reminth"]) {
    assert.equal(mrpack.isReminthPath(bad), true, bad);
  }
  for (const fine of ["mods/a.jar", "config/.reminth/x", ".reminthx/y", "mods/.reminth", "", null]) {
    assert.equal(mrpack.isReminthPath(fine), false, String(fine));
  }
  assert.throws(() => mrpack.assertNoReminthPaths([{ path: "mods/a.jar" }, { path: ".reminth/content.json" }]), /This modpack tries to write into Reminth's own folder/);
  assert.doesNotThrow(() => mrpack.assertNoReminthPaths([{ path: "mods/a.jar" }, null]));
  assert.doesNotThrow(() => mrpack.assertNoReminthPaths(undefined));
});

test("mrpack: such a pack is refused before an instance is made or any of its files fetched", async (t) => {
  const instances = require("../src/main/instances");
  const planted = Buffer.from('{"files":{}}');
  const index = {
    formatVersion: 1,
    game: "minecraft",
    dependencies: { minecraft: "1.20.1", "fabric-loader": "0.15.0" },
    files: [{ path: ".Reminth/content.json", hashes: { sha1: sha1(planted) }, downloads: ["https://cdn.modrinth.com/data/X/planted.json"] }],
  };
  const pack = rawZip([{ name: "modrinth.index.json", data: JSON.stringify(index) }]);
  const packUrl = "https://cdn.modrinth.com/data/PACK/versions/v1/pack.mrpack";
  patch(t, modrinth, "getProject", async () => ({ id: "PACK", title: "Evil Pack", icon_url: null }));
  patch(t, modrinth, "getProjectVersions", async () => [
    { id: "v1", project_id: "PACK", version_number: "1", version_type: "release", files: [{ primary: true, filename: "pack.mrpack", url: packUrl, size: pack.length, hashes: { sha1: sha1(pack) } }] },
  ]);
  const fetched = [];
  patch(t, globalThis, "fetch", async (url) => {
    fetched.push(String(url));
    if (String(url) === packUrl) return new Response(pack, { status: 200 });
    return new Response(planted, { status: 200 });
  });
  const before = (await instances.list()).length;
  await assert.rejects(mrpack.installModpack({ projectId: "PACK" }), /This modpack tries to write into Reminth's own folder/);
  assert.deepEqual(fetched, [packUrl], "only the pack itself was downloaded");
  assert.equal((await instances.list()).length, before, "no instance was created");
});

/* ------------------------------------------------------------------ */
/* 4 + 7 + 16. Modrinth client                                        */
/* ------------------------------------------------------------------ */

/** A response whose body never arrives in time. */
const slowBody = (name = "TimeoutError") => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  body: null,
  json: async () => {
    throw new DOMException("The operation was aborted due to timeout", name);
  },
  text: async () => {
    throw new DOMException("The operation was aborted due to timeout", name);
  },
});

function scripted(t, script) {
  const waits = [];
  const previous = modrinth.setRetryDelay(async (ms) => void waits.push(ms));
  t.after(() => modrinth.setRetryDelay(previous));
  let calls = 0;
  patch(t, globalThis, "fetch", async () => {
    const step = script[Math.min(calls++, script.length - 1)];
    if (step instanceof Error) throw step;
    if (typeof step.json === "function") return step;
    return new Response(step.text !== undefined ? step.text : JSON.stringify(step.body || { ok: true }), { status: step.status, headers: step.headers || {} });
  });
  return { waits, calls: () => calls };
}

test("modrinth: a body that times out is retried like a network error, and ends in a friendly message", async (t) => {
  const s = scripted(t, [slowBody(), { status: 200, text: '{"id":"P","tit' }, { status: 200, body: { id: "P" } }]);
  assert.deepEqual(await modrinth.getProject("P"), { id: "P" }, "slow body, then a cut-off body, then the answer");
  assert.equal(s.calls(), 3);
  assert.deepEqual(s.waits, [500, 1500]);

  const never = scripted(t, [slowBody()]);
  await assert.rejects(modrinth.getProject("P"), (err) => {
    assert.equal(err.message, "Modrinth took too long to answer — check your connection and try again.");
    assert.doesNotMatch(err.message, /TimeoutError|aborted/);
    return true;
  });
  assert.equal(never.calls(), 3);

  // the headers timing out gets the same words
  scripted(t, [new DOMException("The operation was aborted due to timeout", "TimeoutError")]);
  await assert.rejects(modrinth.getProject("P"), /Modrinth took too long to answer/);
});

test("modrinth: a 404 is still final, keeps its status text, and survives an unreadable error body", async (t) => {
  const s = scripted(t, [{ status: 404, text: "not found" }]);
  await assert.rejects(modrinth.getVersion("gone"), (err) => /\b404\b/.test(err.message) && /failed: 404 not found/.test(err.message));
  assert.equal(s.calls(), 1);
  assert.deepEqual(s.waits, []);

  const noBody = scripted(t, [{ ...slowBody(), ok: false, status: 404 }]);
  await assert.rejects(modrinth.getVersion("gone"), /failed: 404/);
  assert.equal(noBody.calls(), 1);
});

test("modrinth: the rate-limit wait is capped at 10s unless the caller allows more; catalog warming allows a full window", async (t) => {
  const h = (obj) => new Headers(obj);
  assert.equal(modrinth.rateLimitWaitMs(h({ "x-ratelimit-reset": "42" })), 10000);
  assert.equal(modrinth.rateLimitWaitMs(h({ "x-ratelimit-reset": "42" }), 65000), 42000);
  assert.equal(modrinth.rateLimitWaitMs(h({ "retry-after": "600" }), 65000), 65000);
  assert.equal(modrinth.rateLimitWaitMs(h({ "retry-after": "600" }), "nonsense"), 10000);

  // an ordinary lookup: capped
  let s = scripted(t, [{ status: 429, headers: { "x-ratelimit-reset": "42" } }, { status: 200, body: { id: "P" } }]);
  await modrinth.getProject("P");
  assert.deepEqual(s.waits, [10000]);
  // fetchWithRetry takes the option directly
  s = scripted(t, [{ status: 429, headers: { "x-ratelimit-reset": "42" } }, { status: 200 }]);
  assert.equal((await modrinth.fetchWithRetry("https://api.modrinth.com/v2/x", {}, { maxWaitMs: 65000 })).status, 200);
  assert.deepEqual(s.waits, [42000]);

  // warming the catalog: sits the window out
  const catalogCache = require("../src/main/catalogCache");
  const hit = { project_id: "P1", slug: "p1", title: "P1", downloads: 5 };
  s = scripted(t, [{ status: 429, headers: { "x-ratelimit-reset": "42" } }, { status: 200, body: { hits: [hit], total_hits: 1 } }]);
  const status = await catalogCache.warmCatalog("mod", { targetCount: 100 });
  assert.equal(status.state, "done");
  assert.deepEqual(s.waits, [42000]);
});

test("modrinth: the User-Agent carries the real app version", () => {
  const { version } = require("../package.json");
  assert.ok(modrinth.USER_AGENT.includes(`/reminth/${version} `), modrinth.USER_AGENT);
});

/* ------------------------------------------------------------------ */
/* 5 + 14. instance registry                                          */
/* ------------------------------------------------------------------ */

async function freshInstances({ wipe = true } = {}) {
  if (wipe) {
    await fsp.rm(paths.INSTANCES_DIR, { recursive: true, force: true });
    await fsp.rm(paths.GAME_DIR, { recursive: true, force: true });
    for (const name of await fsp.readdir(paths.ROOT).catch(() => [])) {
      if (name.startsWith("instances.json")) await fsp.rm(path.join(paths.ROOT, name), { force: true });
    }
  }
  delete require.cache[require.resolve("../src/main/instances")];
  return require("../src/main/instances");
}
const dropRegistry = async () => {
  for (const name of await fsp.readdir(paths.ROOT)) if (name.startsWith("instances.json")) await fsp.rm(path.join(paths.ROOT, name));
};

test("instances: a registry saved with a byte-order mark is read, not treated as corrupt", async () => {
  let instances = await freshInstances();
  const made = await instances.create({ name: "Kept", mcVersion: "1.20.1", loader: "fabric" });
  const text = await fsp.readFile(paths.INSTANCES_FILE, "utf8");
  await fsp.rm(paths.INSTANCES_FILE + ".bak");
  await fsp.rm(path.join(made.gameDir, ".reminth"), { recursive: true }); // nothing to rebuild from
  await fsp.writeFile(paths.INSTANCES_FILE, "﻿" + text);

  instances = await freshInstances({ wipe: false });
  assert.deepEqual((await instances.list()).map((i) => i.name), ["Reminth", "Kept"]);
  assert.deepEqual((await fsp.readdir(paths.ROOT)).filter((n) => n.includes("corrupt")), []);
});

test("instances: a rebuild adopts only folders that are marked or look like a game folder", async () => {
  let instances = await freshInstances();
  const dir = (id) => path.join(paths.INSTANCES_DIR, id);
  await fsp.mkdir(path.join(dir("backups"), "2024-01-01"), { recursive: true }); // the player's own folder
  await fsp.writeFile(path.join(dir("backups"), "world.zip"), "x");
  await fsp.mkdir(path.join(dir("orphan-00aa"), "config"), { recursive: true }); // no game layout either
  await fsp.mkdir(path.join(dir("has-saves-0001"), "saves"), { recursive: true });
  await fsp.mkdir(path.join(dir("has-mods-0002"), "mods"), { recursive: true });
  await fsp.mkdir(dir("has-options-0003"), { recursive: true });
  await fsp.writeFile(path.join(dir("has-options-0003"), "options.txt"), "x");
  await fsp.mkdir(path.join(dir("has-packs-0004"), "resourcepacks"), { recursive: true });
  await fsp.mkdir(path.join(dir("has-logs-0005"), "logs"), { recursive: true });
  await fsp.mkdir(path.join(dir("marked-0006"), ".reminth"), { recursive: true });
  await fsp.writeFile(path.join(dir("marked-0006"), ".reminth", "instance.json"), "﻿" + JSON.stringify({ id: "x", name: "Marked", mcVersion: "1.19.2", loader: "forge" }));

  instances = await freshInstances({ wipe: false });
  const list = await instances.list();
  assert.deepEqual(
    list.map((i) => i.id).sort(),
    ["has-logs-0005", "has-mods-0002", "has-options-0003", "has-packs-0004", "has-saves-0001", "marked-0006", "reminth"]
  );
  const marked = list.find((i) => i.id === "marked-0006");
  assert.equal(marked.name, "Marked", "its own instance.json is used, byte-order mark and all");
  assert.equal(marked.mcVersion, "1.19.2");
  // and so the player's folder can't be deleted through the launcher
  assert.equal(await instances.get("backups"), null);
  assert.equal(await exists(path.join(dir("backups"), "world.zip")), true);
});

test("instances: the original instance keeps its version through a rebuild", async () => {
  let instances = await freshInstances();
  await fsp.mkdir(paths.GAME_DIR, { recursive: true });
  const builtIn = (await instances.get("reminth")).mcVersion;
  const other = builtIn === "1.20.1" ? "1.19.2" : "1.20.1";
  await instances.update("reminth", { mcVersion: other, loader: "vanilla" });
  const meta = JSON.parse(await fsp.readFile(path.join(paths.GAME_DIR, ".reminth", "instance.json"), "utf8"));
  assert.equal(meta.mcVersion, other);

  await dropRegistry(); // registry and its backup both lost
  instances = await freshInstances({ wipe: false });
  const main = await instances.get("reminth");
  assert.equal(main.mcVersion, other, "not reset to the built-in default");
  assert.equal(main.loader, "vanilla");
  assert.equal(main.managed, true);

  // made before the default instance had a metadata file: with a registry
  // on disk, it gets one on the next start
  await instances.update("reminth", { color: "violet" });
  await fsp.rm(path.join(paths.GAME_DIR, ".reminth"), { recursive: true });
  instances = await freshInstances({ wipe: false });
  await instances.list();
  assert.equal(JSON.parse(await fsp.readFile(path.join(paths.GAME_DIR, ".reminth", "instance.json"), "utf8")).mcVersion, other);
});

test("instances: performanceMods is kept only when set - absent means the performance pack is on", async () => {
  let instances = await freshInstances();
  const base = { id: "a-0001", name: "A", mcVersion: "1.20.1", loader: "fabric" };
  assert.equal("performanceMods" in instances.sanitizeInstance(base), false, "existing instances: on");
  assert.equal(instances.sanitizeInstance({ ...base, performanceMods: false }).performanceMods, false);
  assert.equal(instances.sanitizeInstance({ ...base, performanceMods: true }).performanceMods, true);
  assert.equal("performanceMods" in instances.sanitizeInstance({ ...base, performanceMods: "no" }), false, "only a real boolean");

  const on = await instances.create({ name: "On", mcVersion: "1.20.1", loader: "fabric" });
  assert.notEqual(on.performanceMods, false);
  const off = await instances.create({ name: "Off", mcVersion: "1.20.1", loader: "fabric", performanceMods: false });
  assert.equal(off.performanceMods, false);

  assert.equal((await instances.update(on.id, { performanceMods: false })).performanceMods, false);
  assert.equal((await instances.update(off.id, { performanceMods: true })).performanceMods, true);
  assert.equal((await instances.update(on.id, { name: "Renamed" })).performanceMods, false, "an unrelated change keeps it");
  const metaOf = async (inst) => JSON.parse(await fsp.readFile(path.join(inst.gameDir, ".reminth", "instance.json"), "utf8"));
  assert.equal((await metaOf(on)).performanceMods, false, "the per-instance copy has it too");

  // survives a restart, and a rebuild from the per-instance files
  instances = await freshInstances({ wipe: false });
  assert.equal((await instances.get(on.id)).performanceMods, false);
  await dropRegistry();
  instances = await freshInstances({ wipe: false });
  assert.equal((await instances.get(on.id)).performanceMods, false);
  assert.equal((await instances.get(off.id)).performanceMods, true);
});

/* ------------------------------------------------------------------ */
/* 6 + 13. mod descriptors                                            */
/* ------------------------------------------------------------------ */

test("jar meta: a fabric.mod.json with raw line breaks, tabs or a trailing comma is still read", async () => {
  assert.deepEqual(content.parseLooseJson('{"a":1}'), { a: 1 });
  assert.deepEqual(content.parseLooseJson('﻿{"a":1}'), { a: 1 });
  assert.deepEqual(content.parseLooseJson('{"d":"line one\nline\ttwo","list":[1,2,],}'), { d: "line one line two", list: [1, 2] });
  assert.equal(content.parseLooseJson("{nope"), null);
  assert.equal(content.parseLooseJson("[1,2]"), null, "a descriptor is an object");

  const dir = await tmpDir("jar-loose");
  const loose = path.join(dir, "loose.jar");
  await fsp.writeFile(
    loose,
    rawZip([{ name: "fabric.mod.json", data: '{\n\t"schemaVersion": 1,\n\t"id": "loosemod",\n\t"version": "2.0",\n\t"description": "First line\nsecond line",\n\t"depends": { "fabricloader": ">=0.15", },\n}' }])
  );
  const meta = await jarMeta(loose);
  assert.equal(meta.modId, "loosemod");
  assert.equal(meta.description, "First line second line");
  assert.deepEqual(meta.depends, { fabricloader: ">=0.15" });
  assert.equal(meta.descriptors.fabric, true);

  // beyond repair: no name, but the compatibility check still learns it is a Fabric mod
  const broken = path.join(dir, "broken.jar");
  await fsp.writeFile(broken, rawZip([{ name: "fabric.mod.json", data: '{"id": "x", "name": ' }]));
  const bare = await jarMeta(broken);
  assert.ok(bare, "not dropped to null");
  assert.equal(bare.modId, null);
  assert.deepEqual(bare.descriptors, { fabric: true, quilt: false, forge: false, neoforge: false });
  assert.deepEqual(bare.nestedMods, []);
});

test("jar meta: environment and the mods nested inside a jar are reported, one level deep, within limits", async () => {
  const gameDir = await tmpDir("jar-nested");
  const mods = path.join(gameDir, "mods");
  await fsp.mkdir(mods, { recursive: true });

  // a jar inside the nested jar must not be followed
  const deep = fabricJar("toodeep");
  const lib = rawZip([
    { name: "fabric.mod.json", data: fabricJson("lib", { version: "3.1.0", provides: ["oldlib", 7], jars: [{ file: "META-INF/jars/deep.jar" }] }) },
    { name: "META-INF/jars/deep.jar", data: deep },
  ]);
  const plainLibrary = rawZip([{ name: "com/example/A.class", data: "x" }]);
  const outer = rawZip([
    {
      name: "fabric.mod.json",
      data: fabricJson("outer", {
        environment: "client",
        jars: [{ file: "META-INF/jars/lib.jar" }, { file: "META-INF/jars/plain.jar" }],
      }),
    },
    { name: "META-INF/jars/lib.jar", data: lib },
    { name: "META-INF/jars/plain.jar", data: plainLibrary },
  ]);
  await fsp.writeFile(path.join(mods, "outer.jar"), outer);

  const meta = await jarMeta(path.join(mods, "outer.jar"));
  assert.equal(meta.environment, "client");
  // name and Minecraft requirement are recorded too (compat.findNestedMcProblems); this one has no requirement
  assert.deepEqual(meta.nestedMods, [{ id: "lib", name: "LIB", version: "3.1.0", provides: ["oldlib"], mcDep: null }]);
  assert.equal(meta.nestedUnread, false);
  assert.deepEqual(meta.nested, ["META-INF/jars/lib.jar", "META-INF/jars/plain.jar"]);

  // an unknown environment value is not passed on; a nested jar that is missing or not a zip sets the flag
  await fsp.writeFile(
    path.join(mods, "holes.jar"),
    rawZip([
      { name: "fabric.mod.json", data: fabricJson("holes", { environment: "moon", jars: [{ file: "gone.jar" }, { file: "bad.jar" }, { file: "ok.jar" }] }) },
      { name: "bad.jar", data: "this is not a jar" },
      { name: "ok.jar", data: fabricJar("okmod") },
    ])
  );
  const holes = await jarMeta(path.join(mods, "holes.jar"));
  assert.equal(holes.environment, null);
  assert.deepEqual(holes.nestedMods.map((m) => m.id), ["okmod"]);
  assert.equal(holes.nestedUnread, true);

  // more nested jars than are read: the first 160, and the flag
  const many = Array.from({ length: 162 }, (_, i) => ({ name: `j/${i}.jar`, data: fabricJar(`n${i}`) }));
  await fsp.writeFile(
    path.join(mods, "many.jar"),
    rawZip([{ name: "fabric.mod.json", data: fabricJson("many", { environment: "*", jars: many.map((m) => ({ file: m.name })) }) }, ...many])
  );
  const big = await jarMeta(path.join(mods, "many.jar"));
  assert.equal(big.environment, "*");
  assert.equal(big.nestedMods.length, 160);
  assert.equal(big.nestedUnread, true);
  assert.deepEqual(big.nestedUnreadNames, ["j/160.jar", "j/161.jar"], "which ones weren't read is said by name");

  // a nested jar over 8 MB is not read into memory
  await fsp.writeFile(
    path.join(mods, "heavy.jar"),
    rawZip([
      { name: "fabric.mod.json", data: fabricJson("heavy", { jars: [{ file: "huge.jar" }] }) },
      { name: "huge.jar", data: Buffer.alloc(8 * 1024 * 1024 + 1) },
    ])
  );
  const heavy = await jarMeta(path.join(mods, "heavy.jar"));
  assert.deepEqual(heavy.nestedMods, []);
  assert.equal(heavy.nestedUnread, true);

  // and the list items carry all three
  const item = (await content.listAll(gameDir)).mod.find((i) => i.file === "outer.jar");
  assert.equal(item.environment, "client");
  assert.deepEqual(item.nestedMods, [{ id: "lib", name: "LIB", version: "3.1.0", provides: ["oldlib"], mcDep: null }]);
  assert.equal(item.nestedUnread, false);
  // cached by path + size + mtime: the same object comes back
  assert.equal(await jarMeta(path.join(mods, "outer.jar")), meta);
});

/* ------------------------------------------------------------------ */
/* 8 + 9 + 15. installing and updating                                */
/* ------------------------------------------------------------------ */

/** A fake Modrinth: { PROJECT: { title, versions: [{ id, filename, body, dependencies }] } }. */
function fakeModrinth(t, projects) {
  const files = {};
  const versions = new Map();
  for (const [pid, p] of Object.entries(projects)) {
    p.versions = p.versions.map((v) => {
      const body = Buffer.isBuffer(v.body) ? v.body : Buffer.from(v.body || `${pid}:${v.id}`);
      const url = `https://cdn.modrinth.com/data/${pid}/${v.id}/${encodeURIComponent(v.filename)}`;
      files[url] = body;
      const full = { id: v.id, project_id: pid, version_number: v.id, version_type: "release", dependencies: v.dependencies || [], files: [{ primary: true, filename: v.filename, url, size: body.length, hashes: { sha1: sha1(body) } }] };
      versions.set(v.id, full);
      return full;
    });
  }
  patch(t, globalThis, "fetch", async (url) => {
    const href = String(url);
    if (!(href in files)) return new Response("nope", { status: 404 });
    return new Response(files[href], { status: 200, headers: { "content-length": String(files[href].length) } });
  });
  patch(t, modrinth, "getVersionsFromHashes", async () => ({}));
  patch(t, modrinth, "getProject", async (pid) => {
    if (!projects[pid]) throw new Error(`Modrinth API GET /project/${pid} failed: 404`);
    return { id: pid, title: projects[pid].title, icon_url: null };
  });
  patch(t, modrinth, "getProjectVersions", async (pid) => projects[pid].versions);
  patch(t, modrinth, "getVersion", async (vid) => versions.get(vid));
  patch(t, modrinth, "getVersions", async (ids) => ids.map((id) => versions.get(id)).filter(Boolean));
  return { version: (vid) => versions.get(vid) };
}

const fabricInstance = async () => ({ id: "t", loader: "fabric", mcVersion: "1.20.1", gameDir: await tmpDir("game") });
const required = (extra) => ({ dependency_type: "required", project_id: null, version_id: null, ...extra });

/** Makes deleting one file fail the way it does while the game has it open. */
function lockFile(t, full) {
  const realRm = fsp.rm;
  patch(t, fsp, "rm", async (target, opts) => {
    if (path.resolve(String(target)) === path.resolve(full)) throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
    return realRm(target, opts);
  });
}

test("install: an old jar that can't be removed is a warning - the new dependencies still get installed", async (t) => {
  const inst = await fabricInstance();
  const mods = path.join(inst.gameDir, "mods");
  fakeModrinth(t, { MAIN: { title: "Main", versions: [{ id: "m1", filename: "main-1.jar" }] } });
  const first = await content.install(inst, { projectId: "MAIN", kind: "mod" });
  assert.deepEqual(first.warnings, []);

  fakeModrinth(t, {
    MAIN: { title: "Main", versions: [{ id: "m2", filename: "main-2.jar", dependencies: [required({ project_id: "NEWLIB" })] }] },
    NEWLIB: { title: "New Lib", versions: [{ id: "n1", filename: "newlib-1.jar" }] },
  });
  lockFile(t, path.join(mods, "main-1.jar"));
  const result = await content.install(inst, { projectId: "MAIN", kind: "mod" });
  assert.deepEqual(result.installed.map((i) => i.file).sort(), ["main-2.jar", "newlib-1.jar"]);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Main is installed, but its old file main-1\.jar couldn't be removed/);
  assert.equal(await exists(path.join(mods, "newlib-1.jar")), true, "the dependency the new version needs is there");
  assert.deepEqual(Object.keys((await content.readManifest(inst.gameDir)).files).sort(), ["mods/main-2.jar", "mods/newlib-1.jar"]);
});

test("applyUpdates: a leftover old file counts as applied with a warning; failures name their file", async (t) => {
  const inst = await fabricInstance();
  const mods = path.join(inst.gameDir, "mods");
  fakeModrinth(t, { MAIN: { title: "Main", versions: [{ id: "m1", filename: "main-1.jar" }] } });
  await content.install(inst, { projectId: "MAIN", kind: "mod" });

  const api = fakeModrinth(t, {
    MAIN: { title: "Main", versions: [{ id: "m2", filename: "main-2.jar", dependencies: [required({ project_id: "NEWLIB" }), required({ project_id: "MISSING" })] }] },
    NEWLIB: { title: "New Lib", versions: [{ id: "n1", filename: "newlib-1.jar" }] },
  });
  const f = api.version("m2").files[0];
  const next = { versionId: "m2", versionNumber: "m2", url: f.url, sha1: f.hashes.sha1, filename: f.filename, size: f.size };
  lockFile(t, path.join(mods, "main-1.jar"));
  const result = await content.applyUpdates(inst, [
    { kind: "mod", world: null, file: "main-1.jar", enabled: true, projectId: "MAIN", title: "Main", iconUrl: null, next },
    { kind: "mod", world: null, file: "vanished.jar", enabled: true, projectId: "GONE", title: "Gone", iconUrl: null, next },
  ]);
  assert.deepEqual(result.applied, ["Main"], "the new file is in place, so the update happened");
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /old file main-1\.jar couldn't be removed/);
  assert.deepEqual(result.added, ["New Lib"], "what the new version requires was still installed");
  assert.deepEqual(
    result.failed.map((x) => [x.title, x.file]),
    [
      ["Gone", "vanished.jar"],
      ["A mod Main needs", "main-1.jar"],
    ]
  );
  for (const x of result.failed) assert.equal(typeof x.error, "string");
  assert.equal((await content.readManifest(inst.gameDir)).files["mods/main-2.jar"].versionId, "m2");
});

test("install: when Modrinth can't say what the jars in mods/ are, a new mod is not added blind", async (t) => {
  const inst = await fabricInstance();
  const mods = path.join(inst.gameDir, "mods");
  fakeModrinth(t, {
    MAIN: { title: "Main", versions: [{ id: "m1", filename: "main-1.jar" }] },
    OTHER: { title: "Other", versions: [{ id: "o1", filename: "other-1.jar", dependencies: [required({ project_id: "DEP" })] }] },
    DEP: { title: "Dep", versions: [{ id: "d1", filename: "dep-1.jar" }] },
  });
  await content.install(inst, { projectId: "MAIN", kind: "mod" }); // empty mods folder: nothing to look up

  patch(t, modrinth, "getVersionsFromHashes", async () => {
    throw new Error("Couldn't reach Modrinth: fetch failed");
  });
  await assert.rejects(content.install(inst, { projectId: "OTHER", kind: "mod" }), /Couldn't check what's already installed — try again in a moment\./);
  assert.deepEqual(await fsp.readdir(mods), ["main-1.jar"], "nothing was downloaded");

  // something Reminth installed itself is replaced in place, so that is still allowed
  const again = await content.install(inst, { projectId: "MAIN", kind: "mod" });
  assert.deepEqual(again.installed.map((i) => i.file), ["main-1.jar"]);

  // and once the lookup works again, so does the install (dependency included)
  modrinth.getVersionsFromHashes = async () => ({});
  const ok = await content.install(inst, { projectId: "OTHER", kind: "mod" });
  assert.deepEqual(ok.installed.map((i) => i.file).sort(), ["dep-1.jar", "other-1.jar"]);
});

test("install: a mod whose id is already loaded from another jar is not added a second time", async (t) => {
  const inst = await fabricInstance();
  const mods = path.join(inst.gameDir, "mods");
  await fsp.mkdir(path.join(inst.gameDir, ".reminth"), { recursive: true });
  await fsp.mkdir(mods, { recursive: true });
  // dropped in by hand, from somewhere Modrinth doesn't know by hash
  await fsp.writeFile(path.join(mods, "Sodium-custom-build.jar"), fabricJar("sodium", { version: "0.5.0-custom" }));
  fakeModrinth(t, {
    SOD: { title: "Sodium", versions: [{ id: "s1", filename: "sodium-0.6.0.jar", body: fabricJar("sodium", { version: "0.6.0" }) }] },
    LITH: { title: "Lithium", versions: [{ id: "l1", filename: "lithium-1.jar", body: fabricJar("lithium") }] },
  });

  await assert.rejects(content.install(inst, { projectId: "SOD", kind: "mod" }), (err) => {
    assert.equal(err.message, "Sodium is already in this instance's mods folder (Sodium-custom-build.jar).");
    return true;
  });
  assert.deepEqual(await fsp.readdir(mods), ["Sodium-custom-build.jar"], "the download was removed again");
  assert.deepEqual((await content.readManifest(inst.gameDir)).files, {}, "and never recorded");

  // a different mod is unaffected
  await content.install(inst, { projectId: "LITH", kind: "mod" });

  // a disabled copy isn't loaded, so it doesn't block
  await fsp.rename(path.join(mods, "Sodium-custom-build.jar"), path.join(mods, "Sodium-custom-build.jar.disabled"));
  const ok = await content.install(inst, { projectId: "SOD", kind: "mod" });
  assert.deepEqual(ok.installed.map((i) => i.file), ["sodium-0.6.0.jar"]);

  // a newer version of what Reminth installed replaces it - the old file is not "another jar"
  fakeModrinth(t, { SOD: { title: "Sodium", versions: [{ id: "s2", filename: "sodium-0.7.0.jar", body: fabricJar("sodium", { version: "0.7.0" }) }] } });
  const upgraded = await content.install(inst, { projectId: "SOD", kind: "mod" });
  assert.deepEqual(upgraded.installed.map((i) => i.file), ["sodium-0.7.0.jar"]);
  assert.deepEqual((await fsp.readdir(mods)).filter((n) => /^sodium/.test(n)), ["sodium-0.7.0.jar"]);

  // Reminth's own performance-pack copy steps aside at launch, so it doesn't block either
  const inst2 = await fabricInstance();
  const mods2 = path.join(inst2.gameDir, "mods");
  await fsp.mkdir(path.join(inst2.gameDir, ".reminth"), { recursive: true });
  await fsp.mkdir(mods2, { recursive: true });
  await fsp.writeFile(path.join(mods2, "sodium-managed.jar"), fabricJar("sodium", { version: "0.5.0" }));
  await fsp.writeFile(path.join(inst2.gameDir, ".reminth", "managed-mods.json"), JSON.stringify({ files: { "sodium-managed.jar": { mod: "sodium" } } }));
  const beside = await content.install(inst2, { projectId: "SOD", kind: "mod" });
  assert.deepEqual(beside.installed.map((i) => i.file), ["sodium-0.7.0.jar"]);
});

/* ------------------------------------------------------------------ */
/* 10 + 11. the account file                                          */
/* ------------------------------------------------------------------ */

const accountFiles = async () => (await fsp.readdir(paths.ROOT).catch(() => [])).filter((n) => n.startsWith("account.json")).sort();
async function clearAccountFiles() {
  for (const name of await accountFiles()) await fsp.rm(path.join(paths.ROOT, name), { force: true });
}

test("account: signing out removes the backup copies first, so a failure can't sign the player back in", async (t) => {
  await clearAccountFiles();
  safeStorage.available = true;
  t.after(() => (safeStorage.available = false));
  await store.saveAccount({ name: "Steve", refreshToken: "r1" });
  await fsp.writeFile(paths.ACCOUNTS_FILE + ".corrupt-123", "old copy");
  assert.deepEqual(await accountFiles(), ["account.json", "account.json.bak", "account.json.corrupt-123"]);

  // order: every copy before the main file
  const realRm = fsp.rm;
  const order = [];
  patch(t, fsp, "rm", async (target, opts) => {
    order.push(path.basename(String(target)));
    return realRm(target, opts);
  });
  await store.clearAccount();
  assert.equal(order[order.length - 1], "account.json");
  assert.deepEqual(order.slice(0, -1).sort(), ["account.json.bak", "account.json.corrupt-123"]);
  assert.deepEqual(await accountFiles(), []);
  assert.equal(await store.loadAccount(), null);

  // a backup locked for a moment is retried
  await store.saveAccount({ name: "Steve", refreshToken: "r2" });
  let failures = 2;
  fsp.rm = async (target, opts) => {
    if (String(target).endsWith(".bak") && failures-- > 0) throw Object.assign(new Error("EBUSY"), { code: "EBUSY" });
    return realRm(target, opts);
  };
  await store.clearAccount();
  assert.deepEqual(await accountFiles(), []);

  // a backup that will not go: sign-out fails loudly with the main file still
  // there - never "main file gone, backup left to be restored next start"
  await store.saveAccount({ name: "Steve", refreshToken: "r3" });
  fsp.rm = async (target, opts) => {
    if (String(target).endsWith(".bak")) throw Object.assign(new Error("EBUSY: locked"), { code: "EBUSY" });
    return realRm(target, opts);
  };
  await assert.rejects(store.clearAccount(), /EBUSY/);
  assert.deepEqual(await accountFiles(), ["account.json", "account.json.bak"]);
  fsp.rm = realRm;
  await store.clearAccount();
  assert.deepEqual(await accountFiles(), []);
});

test("account: without OS encryption nothing is written, and a readable copy from before is removed", async (t) => {
  await clearAccountFiles();
  await fsp.mkdir(paths.ROOT, { recursive: true });
  safeStorage.available = false;
  t.after(() => (safeStorage.available = false));

  assert.deepEqual(await store.saveAccount({ name: "Alex", refreshToken: "secret" }), { persisted: false });
  assert.deepEqual(await accountFiles(), [], "no token on disk in the clear");

  // left by an older version: plain JSON, with a plain backup
  await fsp.writeFile(paths.ACCOUNTS_FILE, JSON.stringify({ name: "Old", refreshToken: "plain" }));
  await fsp.writeFile(paths.ACCOUNTS_FILE + ".bak", JSON.stringify({ name: "Old", refreshToken: "plain" }));
  assert.deepEqual(await store.loadAccount(), { name: "Old", refreshToken: "plain" }, "still read, so nobody is signed out by the update");
  assert.deepEqual(await store.saveAccount({ name: "Old", refreshToken: "newer" }), { persisted: false });
  assert.deepEqual(await accountFiles(), []);

  // an encrypted file is left alone while the key store is away, and read again when it is back
  safeStorage.available = true;
  assert.deepEqual(await store.saveAccount({ name: "Steve", refreshToken: "r1" }), { persisted: true });
  assert.equal((await fsp.readFile(paths.ACCOUNTS_FILE))[0], 0x01, "stored encrypted");
  safeStorage.available = false;
  assert.deepEqual(await store.saveAccount({ name: "Steve", refreshToken: "r2" }), { persisted: false });
  assert.deepEqual(await accountFiles(), ["account.json", "account.json.bak"]);
  assert.equal(await store.loadAccount(), null);
  safeStorage.available = true;
  assert.deepEqual(await store.loadAccount(), { name: "Steve", refreshToken: "r1" });
  await store.clearAccount();

  // never throws when it can't persist, even with no folder to look in
  safeStorage.available = false;
  patch(t, fsp, "readFile", async () => {
    throw Object.assign(new Error("EIO"), { code: "EIO" });
  });
  assert.deepEqual(await store.saveAccount({ name: "Alex" }), { persisted: false });
});

test("settings: a settings.json saved with a byte-order mark is read, not moved aside", async () => {
  await fsp.mkdir(paths.ROOT, { recursive: true });
  for (const name of await fsp.readdir(paths.ROOT)) if (name.startsWith("settings.json")) await fsp.rm(path.join(paths.ROOT, name));
  await fsp.writeFile(paths.SETTINGS_FILE, "﻿" + JSON.stringify({ accent: "violet", fullscreen: true }));
  const loaded = await store.loadSettings();
  assert.equal(loaded.accent, "violet");
  assert.equal(loaded.fullscreen, true);
  assert.equal((await store.saveSettings({ accent: "amber" })).fullscreen, true, "the next save builds on it");
  assert.deepEqual((await fsp.readdir(paths.ROOT)).filter((n) => n.startsWith("settings.json.corrupt-")), []);
});

/* ------------------------------------------------------------------ */
/* 12. stale temp files                                               */
/* ------------------------------------------------------------------ */

test("atomic: temp files an interrupted write left behind are swept once they are old", async () => {
  const dir = await tmpDir("atomic-sweep");
  const file = path.join(dir, "a.json");
  const old = new Date(Date.now() - 11 * 60 * 1000);
  const stale = path.join(dir, "a.json.4242.0123456789ab.tmp");
  const staleBak = path.join(dir, "a.json.bak.4242.0123456789ab.tmp");
  const recent = path.join(dir, "a.json.4242.ba9876543210.tmp"); // another write, still in flight
  const otherFile = path.join(dir, "b.json.4242.0123456789ab.tmp"); // not ours to judge from here
  const lookalike = path.join(dir, "a.json.notes.tmp"); // not a name this module makes
  for (const f of [stale, staleBak, recent, otherFile, lookalike]) await fsp.writeFile(f, "half");
  for (const f of [stale, staleBak, otherFile, lookalike]) await fsp.utimes(f, old, old);

  await atomic.writeJsonAtomic(file, { a: 1 }, { backup: true });
  assert.deepEqual((await fsp.readdir(dir)).sort(), ["a.json", "a.json.4242.ba9876543210.tmp", "a.json.bak", "a.json.notes.tmp", "b.json.4242.0123456789ab.tmp"]);
  assert.deepEqual(JSON.parse(await fsp.readFile(file, "utf8")), { a: 1 });

  // never throws, whatever the folder looks like
  await atomic.sweepStaleTemps(path.join(dir, "no-such-folder", "x.json"));
});
