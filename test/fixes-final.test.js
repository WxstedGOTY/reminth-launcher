"use strict";
/**
 * Tests for the last round of review fixes:
 *  1. one of Reminth's jars built for another Minecraft version is removed
 *     when this launch brings no replacement
 *  2. a copy of a doubled mod that isn't loaded is only ever "a duplicate"
 *  3. nested jars: a higher limit, a total cap, and "not read" by name
 *  4. the quick (local-only) check for the Play button, parallel hashing
 *  5. a newer Sodium doesn't replace the one a player's mod pins
 *  6. the twin guard doesn't delete a jar that was there before
 *  7. c2me / ferritecore / starlight from an older Reminth are taken over
 *  8. an XSTS answer with an XErr doesn't sign the player out
 *  9. a readable account.json is rewritten the moment it is read
 * 10. a GitHub error is an error, not "no build yet"
 * 11. the check's cache knows which jars are Reminth's
 * 12. an override file also softens "Fabric API missing"
 * 13. pre-releases are never installed silently
 * 14. a modpack's instance doesn't get the performance pack on top
 *
 * No network (fetch is stubbed per test and restored), no Electron, no npm
 * packages. Everything on disk happens under a throwaway HOME.
 * Run with: node --test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "reminth-final-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

// electron (safeStorage) and extract-zip aren't installed where tests run.
// The fake "encryption" is a marker byte + the text reversed.
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
  if (request === "electron") return "STUB_ELECTRON_FINAL";
  if (request === "extract-zip") return "STUB_EXTRACT_ZIP_FINAL";
  return originalResolve.call(this, request, ...rest);
};
Module._cache.STUB_ELECTRON_FINAL = { id: "STUB_ELECTRON_FINAL", filename: "STUB_ELECTRON_FINAL", loaded: true, exports: { safeStorage } };
Module._cache.STUB_EXTRACT_ZIP_FINAL = { id: "STUB_EXTRACT_ZIP_FINAL", filename: "STUB_EXTRACT_ZIP_FINAL", loaded: true, exports: async () => {} };

const paths = require("../src/main/paths");
const config = require("../src/main/config");
const minecraft = require("../src/main/minecraft");
const compat = require("../src/main/compat");
const content = require("../src/main/content");
const modrinth = require("../src/main/modrinth");
const msAuth = require("../src/main/msAuth");
const store = require("../src/main/store");
const mrpack = require("../src/main/mrpack");
const instances = require("../src/main/instances");
const { crc32 } = require("../src/main/zip");

assert.ok(paths.ROOT.startsWith(HOME), "tests must never touch the real Reminth folder");

const sha1 = (buf) => crypto.createHash("sha1").update(buf).digest("hex");
const tmpDir = (name) => fsp.mkdtemp(path.join(HOME, `${name}-`));
const exists = (p) => fsp.access(p).then(() => true, () => false);

/** Replaces obj[key] for the length of one test. */
function patch(t, obj, key, value) {
  const original = obj[key];
  t.after(() => (obj[key] = original));
  obj[key] = value;
}

/** Replaces global fetch for the duration of `fn`, always restoring it. */
async function withFetch(stub, fn) {
  const real = global.fetch;
  global.fetch = stub;
  try {
    return await fn();
  } finally {
    global.fetch = real;
  }
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

const fabricJson = (id, extra = {}) => JSON.stringify({ schemaVersion: 1, id, version: "1.0.0", ...extra });
const fabricJar = (id, extra) => rawZip([{ name: "fabric.mod.json", data: fabricJson(id, extra) }]);

/**
 * An instance folder with real jars in mods/: { "<file>": Buffer }.
 * `managed` writes Reminth's manifest ({ "<file>": { mod } }); `tracked`
 * lists what content.json says the player installed through the mod browser.
 */
async function instanceWith(jars, { managed = null, tracked = null } = {}) {
  const gameDir = await tmpDir("game");
  const modsDir = path.join(gameDir, "mods");
  await fsp.mkdir(modsDir);
  for (const [file, bytes] of Object.entries(jars)) await fsp.writeFile(path.join(modsDir, file), bytes);
  await fsp.mkdir(path.join(gameDir, ".reminth"));
  const manifestFile = path.join(gameDir, ".reminth", "managed-mods.json");
  if (managed) await fsp.writeFile(manifestFile, JSON.stringify({ version: 1, files: managed }));
  if (tracked) {
    const files = {};
    for (const f of tracked) files[`mods/${f}`] = { kind: "mod" };
    await fsp.writeFile(path.join(gameDir, ".reminth", "content.json"), JSON.stringify({ version: 1, files }));
  }
  return {
    gameDir,
    modsDir,
    list: async () => (await fsp.readdir(modsDir)).sort(),
    manifest: async () => JSON.parse(await fsp.readFile(manifestFile, "utf8")),
    log: () => fsp.readFile(path.join(gameDir, "reminth-performance-mods.log"), "utf8"),
  };
}

/**
 * A fetch that plays GitHub. `releasesFor(repo)` gives that repo's release
 * list (repo lower-cased); a download URL https://github.com/dl/<file> is
 * answered with `jarFor(file)`.
 */
function github(releasesFor, jarFor) {
  const state = { api: [], downloads: [] };
  state.fetch = async (url) => {
    url = String(url);
    const api = url.match(/^https:\/\/api\.github\.com\/repos\/[^/]+\/([^/]+)\/releases/);
    if (api) {
      state.api.push(api[1].toLowerCase());
      const answer = releasesFor(api[1].toLowerCase());
      return answer instanceof Response ? answer : new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
    }
    const dl = url.match(/^https:\/\/github\.com\/dl\/(.+)$/);
    if (dl) {
      state.downloads.push(dl[1]);
      return new Response(await jarFor(dl[1]), { status: 200 });
    }
    return new Response("nope", { status: 404 });
  };
  return state;
}
const release = (tag, file, extra = {}) => ({ tag_name: tag, name: "", body: "", assets: [{ name: file, size: 1000, browser_download_url: `https://github.com/dl/${file}` }], ...extra });

/* ---------------- 1. Reminth's jars for another Minecraft version ---------------- */

test("misfits: a managed jar built for the old Minecraft version goes when this launch brought no replacement", async () => {
  const inst = await instanceWith(
    {
      "sodium-fabric-0.6.0+mc1.21.1.jar": fabricJar("sodium", { depends: { minecraft: "1.21.1" } }),
      "fabric-api-0.99.0+1.21.1.jar": fabricJar("fabric-api", { depends: { minecraft: ">=1.21 <1.21.2" } }),
      // says nothing about Minecraft: no way to tell, so it stays
      "lithium-fabric-0.13.0.jar": fabricJar("lithium"),
      // can't be read at all: no way to tell either
      "scalablelux-0.1.0.jar": Buffer.from("this is not a jar"),
      // replaced this very run: not looked at
      "reminthhud-1.0.jar": fabricJar("reminthhud", { depends: { minecraft: "1.21.1" } }),
      // Reminth's on paper, but the player installed that very file through the mod browser
      "c2me-fabric-0.3.jar": fabricJar("c2me", { depends: { minecraft: "1.21.1" } }),
      // the player's own, for the old version: theirs to sort out (the compatibility check says so)
      "jei-1.0.jar": fabricJar("jei", { depends: { minecraft: "1.21.1" } }),
    },
    {
      managed: {
        "sodium-fabric-0.6.0+mc1.21.1.jar": { mod: "sodium" },
        "fabric-api-0.99.0+1.21.1.jar": { mod: "fabric-api" },
        "lithium-fabric-0.13.0.jar": { mod: "lithium" },
        "scalablelux-0.1.0.jar": { mod: "scalablelux" },
        "reminthhud-1.0.jar": { mod: "reminthhud" },
        "c2me-fabric-0.3.jar": { mod: "c2me" },
      },
      tracked: ["c2me-fabric-0.3.jar"],
    }
  );
  // The instance was moved to 1.21.4 and nothing could be downloaded for it.
  const installed = [{ file: "reminthhud-1.0.jar", mod: "reminthhud", own: true }];
  const out = await minecraft.removeMisfitManagedMods(inst.gameDir, installed, { mcVersion: "1.21.4", loader: "fabric" });
  assert.deepEqual(out.removed.sort(), ["fabric-api-0.99.0+1.21.1.jar", "sodium-fabric-0.6.0+mc1.21.1.jar"]);
  assert.deepEqual(out.lines.sort(), [
    "Removed fabric-api-0.99.0+1.21.1.jar: it is built for another Minecraft version",
    "Removed sodium-fabric-0.6.0+mc1.21.1.jar: it is built for another Minecraft version",
  ]);
  assert.deepEqual(await inst.list(), ["c2me-fabric-0.3.jar", "jei-1.0.jar", "lithium-fabric-0.13.0.jar", "reminthhud-1.0.jar", "scalablelux-0.1.0.jar"]);
  assert.deepEqual(Object.keys((await inst.manifest()).files).sort(), ["c2me-fabric-0.3.jar", "lithium-fabric-0.13.0.jar", "reminthhud-1.0.jar", "scalablelux-0.1.0.jar"]);

  // On the version they were built for, nothing is touched.
  const same = await instanceWith({ "sodium-fabric-0.6.0+mc1.21.1.jar": fabricJar("sodium", { depends: { minecraft: "1.21.1" } }) }, { managed: { "sodium-fabric-0.6.0+mc1.21.1.jar": { mod: "sodium" } } });
  assert.deepEqual(await minecraft.removeMisfitManagedMods(same.gameDir, [], { mcVersion: "1.21.1", loader: "fabric" }), { removed: [], lines: [] });
  assert.deepEqual(await same.list(), ["sodium-fabric-0.6.0+mc1.21.1.jar"]);

  // content.json unreadable: whose jar is whose can't be told, so nothing goes.
  const unsure = await instanceWith({ "sodium-old.jar": fabricJar("sodium", { depends: { minecraft: "1.21.1" } }) }, { managed: { "sodium-old.jar": { mod: "sodium" } } });
  await fsp.writeFile(path.join(unsure.gameDir, ".reminth", "content.json"), "{ not json");
  assert.deepEqual((await minecraft.removeMisfitManagedMods(unsure.gameDir, [], { mcVersion: "1.21.4", loader: "fabric" })).removed, []);
});

/* ---------------- 2. a copy that isn't loaded is only a duplicate ---------------- */

const fab = { fabric: true, quilt: false, forge: false, neoforge: false };
const fakeInstance = (id, extra = {}) => ({ id, gameDir: path.join(HOME, "nope", id), mcVersion: "1.21.4", loader: "fabric", hud: false, performanceMods: false, ...extra });
const jar = (file, extra = {}) => ({ kind: "mod", file, valid: true, folder: false, enabled: true, size: 10, modifiedAt: 1, descriptors: fab, requires: [], ...extra });
function depsFor(mods, { managed = [], override = false, found = {}, hashDelay = 0 } = {}) {
  const calls = { hashes: 0, hashed: 0, updates: 0, running: 0, peak: 0 };
  return {
    calls,
    hasOverrideFile: async () => override,
    listAll: async () => ({ mod: mods, resourcepack: [], shader: [], datapack: [], worlds: [] }),
    managedNames: async () => new Set(managed),
    hashOf: async (item) => {
      calls.hashed++;
      calls.running++;
      calls.peak = Math.max(calls.peak, calls.running);
      if (hashDelay) await new Promise((resolve) => setTimeout(resolve, hashDelay));
      calls.running--;
      return "h-" + item.file;
    },
    modrinth: {
      getVersionsFromHashes: async () => {
        calls.hashes++;
        return found;
      },
      checkForUpdates: async () => {
        calls.updates++;
        return {};
      },
      getProjects: async () => [],
      getProjectVersions: async () => [],
    },
  };
}

test("checkInstance: the older copy of a doubled mod is 'a duplicate' and nothing more", async () => {
  const mods = [
    // left behind from the old version: Fabric loads a-2, so what a-1 says about itself stops nothing
    jar("a-1.jar", { name: "A", modId: "a", modVersion: "1.0.0", mcDep: "1.20.1" }),
    jar("a-2.jar", { name: "A", modId: "a", modVersion: "2.0.0", mcDep: ">=1.21" }),
  ];
  const found = { "h-a-1.jar": { project_id: "P", game_versions: ["1.20.1"], loaders: ["forge"], dependencies: [] } };
  const r = await compat.checkInstance(fakeInstance("dup1"), { force: true, deps: depsFor(mods, { found }) });
  assert.deepEqual(r.issues.map((i) => [i.file, i.reason, i.severity]), [["a-1.jar", "duplicate", "warn"]]);
  assert.equal(r.blocked, 0);

  // the copy that IS loaded is judged as ever
  const wrongWinner = [jar("b-1.jar", { name: "B", modId: "b", modVersion: "1.0.0" }), jar("b-2.jar", { name: "B", modId: "b", modVersion: "2.0.0", mcDep: "1.20.1" })];
  const r2 = await compat.checkInstance(fakeInstance("dup2"), { force: true, deps: depsFor(wrongWinner) });
  assert.deepEqual(r2.issues.map((i) => [i.file, i.reason, i.severity]).sort(), [["b-1.jar", "duplicate", "warn"], ["b-2.jar", "wrong-mc", "blocked"]]);

  // versions that can't be compared: which copy loads isn't known, so both are still judged
  const unknown = [jar("c-x.jar", { name: "C", modId: "c", modVersion: "nightly", mcDep: "1.20.1", modifiedAt: 1 }), jar("c-y.jar", { name: "C", modId: "c", modVersion: "2.0.0", modifiedAt: 5 })];
  const r3 = await compat.checkInstance(fakeInstance("dup3"), { force: true, deps: depsFor(unknown) });
  assert.deepEqual(r3.issues.map((i) => [i.file, i.reason]).sort(), [["c-x.jar", "duplicate"], ["c-x.jar", "wrong-mc"]]);
});

/* ---------------- 3. nested jars ---------------- */

test("nested jars: Fabric API's fifty-odd modules are all read, and what isn't read is named", async () => {
  const dir = await tmpDir("nested");
  const modules = Array.from({ length: 55 }, (_, i) => ({ name: `META-INF/jars/fabric-module-${i}-v1.jar`, data: fabricJar(`fabric-module-${i}-v1`) }));
  const api = path.join(dir, "fabric-api.jar");
  await fsp.writeFile(api, rawZip([{ name: "fabric.mod.json", data: fabricJson("fabric-api", { jars: modules.map((m) => ({ file: m.name })) }) }, ...modules]));
  const meta = await content.readJarMeta(api, await fsp.stat(api));
  assert.equal(meta.nestedMods.length, 55);
  assert.equal(meta.nestedUnread, false);
  assert.deepEqual(meta.nestedUnreadNames, []);

  const holes = path.join(dir, "holes.jar");
  await fsp.writeFile(
    holes,
    rawZip([
      { name: "fabric.mod.json", data: fabricJson("holes", { jars: [{ file: "jars/gone.jar" }, { file: "jars/bad.jar" }, { file: "jars/ok.jar" }] }) },
      { name: "jars/bad.jar", data: "this is not a jar" },
      { name: "jars/ok.jar", data: fabricJar("okmod") },
    ])
  );
  const h = await content.readJarMeta(holes, await fsp.stat(holes));
  assert.deepEqual(h.nestedMods.map((m) => m.id), ["okmod"]);
  assert.equal(h.nestedUnread, true);
  assert.deepEqual(h.nestedUnreadNames, ["jars/gone.jar", "jars/bad.jar"]);
});

test("nested jars: no more than 64 MB of them is read out of one jar", async () => {
  const dir = await tmpDir("nested-total");
  // Eight plain library jars of just under 8 MB each (64 MB less a little), then two mods.
  const filler = rawZip([{ name: "lib/big.bin", data: Buffer.alloc(8 * 1024 * 1024 - 300) }]);
  const fillers = Array.from({ length: 8 }, (_, i) => ({ name: `jars/lib-${i}.jar`, data: filler }));
  const small = fabricJar("small"); // fits in what's left of the allowance
  const late = rawZip([{ name: "fabric.mod.json", data: fabricJson("late") }, { name: "pad.bin", data: Buffer.alloc(4096) }]); // doesn't
  const names = [...fillers.map((f) => f.name), "jars/small.jar", "jars/late.jar"];
  const outer = path.join(dir, "fat.jar");
  await fsp.writeFile(
    outer,
    rawZip([{ name: "fabric.mod.json", data: fabricJson("fat", { jars: names.map((file) => ({ file })) }) }, ...fillers, { name: "jars/small.jar", data: small }, { name: "jars/late.jar", data: late }])
  );
  const meta = await content.readJarMeta(outer, await fsp.stat(outer));
  assert.deepEqual(meta.nestedMods.map((m) => m.id), ["small"]);
  assert.equal(meta.nestedUnread, true);
  assert.deepEqual(meta.nestedUnreadNames, ["jars/late.jar"]);
});

test("findDependencyProblems: an unread packed jar only makes the answers it could change unsure", () => {
  const a = { file: "a.jar", modId: "a", modVersion: "1.0.0", depends: { sodium: ">=0.7" }, breaks: { opti: "*" } };
  const sodium = { file: "sodium.jar", modId: "sodium", modVersion: "0.6.0" };
  const opti = { file: "opti.jar", modId: "opti", modVersion: "1.0.0" };
  const certain = (mods) => Object.fromEntries(compat.findDependencyProblems(mods).map((p) => [p.kind, p.certain]));

  // an unread jar that has nothing to do with either: both stay certain (it used to make everything unsure)
  const unrelated = { file: "big.jar", modId: "big", nestedUnread: true, nestedUnreadNames: ["META-INF/jars/some-library-2.0.jar"] };
  assert.deepEqual(certain([a, sodium, opti, unrelated]), { depends: true, breaks: true });
  // one that could be a newer Sodium: only the answer about Sodium is unsure
  const maybeSodium = { file: "big.jar", modId: "big", nestedUnread: true, nestedUnreadNames: ["META-INF/jars/Sodium_Fabric-0.7.1.jar"] };
  assert.deepEqual(certain([a, sodium, opti, maybeSodium]), { depends: false, breaks: true });
  const maybeOpti = { file: "big.jar", modId: "big", nestedUnread: true, nestedUnreadNames: ["jars/opti-2.jar"] };
  assert.deepEqual(certain([a, sodium, opti, maybeOpti]), { depends: true, breaks: false });
  // unread jars that aren't named (an older listing, or more than were listed): anything could be in there
  assert.deepEqual(certain([a, sodium, opti, { file: "big.jar", modId: "big", nestedUnread: true }]), { depends: false, breaks: false });
  assert.deepEqual(certain([a, sodium, opti, { file: "big.jar", modId: "big", nestedUnread: true, nestedUnreadNames: ["*"] }]), { depends: false, breaks: false });
  // names without the flag mean nothing
  assert.deepEqual(certain([a, sodium, opti, { file: "big.jar", modId: "big", nestedUnread: false, nestedUnreadNames: ["sodium.jar"] }]), { depends: true, breaks: true });

  assert.equal(compat.unreadMayProvide("fabric-rendering-v1", [{ nestedUnread: true, nestedUnreadNames: ["META-INF/jars/fabric_rendering_v1-3.0.jar"] }]), true);
  assert.equal(compat.unreadMayProvide("sodium", []), false);
});

test("checkInstance: with a fully read Fabric API in the instance, a wrong Sodium is 'blocked' again", async () => {
  const mods = [
    jar("iris.jar", { name: "Iris", modId: "iris", depends: { sodium: "0.6.5" } }),
    jar("sodium.jar", { name: "Sodium", modId: "sodium", modVersion: "0.6.13" }),
    // 55 modules, 3 of which couldn't be opened - none of them anything like Sodium
    jar("fabric-api.jar", { name: "Fabric API", modId: "fabric-api", nestedUnread: true, nestedUnreadNames: ["META-INF/jars/fabric-a-1.jar", "META-INF/jars/fabric-b-1.jar", "META-INF/jars/fabric-c-1.jar"] }),
  ];
  const r = await compat.checkInstance(fakeInstance("n1"), { force: true, deps: depsFor(mods) });
  assert.deepEqual(r.issues.map((i) => [i.reason, i.severity]), [["needs-version", "blocked"]]);
});

/* ---------------- 4. the quick check, and hashing four at a time ---------------- */

test("checkInstance: localOnly answers from the jars alone - no hashing, no Modrinth - and is never cached", async () => {
  const mods = [
    jar("old.jar", { name: "Old", modId: "old", mcDep: "1.20.1" }),
    jar("forge.jar", { name: "Forgey", modId: "forgey", descriptors: { fabric: false, quilt: false, forge: true, neoforge: false } }),
    jar("needs-api.jar", { name: "NeedsApi", modId: "needsapi", requires: ["fabric-api"] }),
    jar("iris.jar", { name: "Iris", modId: "iris", depends: { sodium: "0.6.5" }, breaks: { opti: "*" } }),
    jar("sodium.jar", { name: "Sodium", modId: "sodium", modVersion: "0.6.13" }),
    jar("opti.jar", { name: "Opti", modId: "opti", modVersion: "1.0.0" }),
    jar("dup-1.jar", { name: "Dup", modId: "dup", modVersion: "1.0.0" }),
    jar("dup-2.jar", { name: "Dup", modId: "dup", modVersion: "2.0.0" }),
  ];
  const deps = depsFor(mods, { hashDelay: 5 });
  const quick = await compat.checkInstance(fakeInstance("q1"), { localOnly: true, deps });
  assert.equal(quick.online, false);
  assert.equal(quick.partial, true);
  assert.deepEqual(deps.calls, { hashes: 0, hashed: 0, updates: 0, running: 0, peak: 0 });
  assert.deepEqual(
    quick.issues.map((i) => [i.reason, i.severity, i.file]).sort(),
    [
      ["conflict", "blocked", "iris.jar"],
      ["duplicate", "warn", "dup-1.jar"],
      ["missing-dep", "blocked", null],
      ["needs-version", "blocked", "iris.jar"],
      ["wrong-loader", "warn", "forge.jar"],
      ["wrong-mc", "blocked", "old.jar"],
    ].sort()
  );
  assert.equal(quick.blocked, 4);
  assert.ok(quick.issues.every((i) => i.fix && i.fix.type !== "update"), "no fix that would need Modrinth");

  // The full check afterwards really runs (the quick answer wasn't kept), four hashes at a time.
  const full = await compat.checkInstance(fakeInstance("q1"), { deps });
  assert.equal(full.online, true);
  assert.equal(full.partial, undefined);
  assert.equal(deps.calls.hashed, 8);
  assert.equal(deps.calls.peak, 4);
  assert.equal(deps.calls.hashes, 1);
  // what stops the game is the same in both
  const blockedOf = (r) => r.issues.filter((i) => i.severity === "blocked").map((i) => `${i.file}|${i.reason}|${i.title}`).sort();
  assert.deepEqual(blockedOf(quick), blockedOf(full));
  // and once the full answer is there, the quick question gets it
  assert.equal(await compat.checkInstance(fakeInstance("q1"), { localOnly: true, deps }), full);
  assert.equal(deps.calls.hashed, 8);
});

test("checkInstance: a jar that can't be hashed is still judged by what it says itself", async () => {
  const mods = [jar("old.jar", { name: "Old", modId: "old", mcDep: "1.20.1" }), jar("fine.jar", { name: "Fine", modId: "fine" })];
  const deps = depsFor(mods);
  deps.hashOf = async (item) => {
    if (item.file === "old.jar") throw Object.assign(new Error("EBUSY"), { code: "EBUSY" });
    return "h-" + item.file;
  };
  const r = await compat.checkInstance(fakeInstance("q2"), { force: true, deps });
  assert.deepEqual(r.issues.map((i) => [i.file, i.reason, i.severity, i.fix.type]), [["old.jar", "wrong-mc", "blocked", "disable"]]);
});

/* ---------------- 5. a player's mod that pins one of Reminth's ---------------- */

test("planHoldBack: a newer build is given up only when a player's mod needs the installed one and not the new one", () => {
  const mods = [
    jar("sodium-old.jar", { modId: "sodium", modVersion: "0.6.0" }),
    jar("sodium-new.jar", { modId: "sodium", modVersion: "0.6.5" }),
    jar("lithium-old.jar", { modId: "lithium", modVersion: "0.13.0" }),
    jar("lithium-new.jar", { modId: "lithium", modVersion: "0.14.0" }),
    jar("iris.jar", { modId: "iris", depends: { sodium: "0.6.0", lithium: ">=0.13" } }),
  ];
  const managed = { "sodium-old.jar": { mod: "sodium" }, "lithium-old.jar": { mod: "lithium" } };
  const installed = [
    { file: "sodium-new.jar", mod: "sodium", own: true },
    { file: "lithium-new.jar", mod: "lithium", own: true },
  ];
  const plan = (over = {}) => minecraft.planHoldBack({ mods, managed, tracked: new Set(), installed, ...over });
  assert.deepEqual(plan(), [{ file: "sodium-new.jar", mod: "sodium", keep: "sodium-old.jar", blocker: "iris.jar", need: "0.6.0" }]);

  // nothing to hold back to: a first install, or the old copy was already no good for that mod
  assert.deepEqual(plan({ managed: {} }), []);
  assert.deepEqual(plan({ mods: mods.map((m) => (m.file === "sodium-old.jar" ? { ...m, modVersion: "0.5.0" } : m)) }), []);
  // a version that can't be read is not a reason
  assert.deepEqual(plan({ mods: mods.map((m) => (m.file === "sodium-new.jar" ? { ...m, modVersion: "nightly" } : m)) }), []);
  // the mod that pins it is switched off, or is one of Reminth's own
  assert.deepEqual(plan({ mods: mods.map((m) => (m.file === "iris.jar" ? { ...m, enabled: false } : m)) }), []);
  assert.deepEqual(plan({ managed: { ...managed, "iris.jar": { mod: "scalablelux" } } }), []);
  // whose jar is whose can't be told
  assert.deepEqual(plan({ tracked: null }), []);
  // a file the player already had under the new name isn't Reminth's to give up
  assert.deepEqual(plan({ installed: [{ file: "sodium-new.jar", mod: "sodium", own: false }] }), []);
  // Fabric API and the HUD are never held back
  assert.deepEqual(minecraft.planHoldBack({ mods: [jar("fabric-api-1.jar", { modId: "fabric-api", modVersion: "1.0.0" }), jar("fabric-api-2.jar", { modId: "fabric-api", modVersion: "2.0.0" }), jar("x.jar", { modId: "x", depends: { "fabric-api": "1.0.0" } })], managed: { "fabric-api-1.jar": { mod: "fabric-api" } }, tracked: new Set(), installed: [{ file: "fabric-api-2.jar", mod: "fabric-api", own: true }] }), []);
});

test("hold back: Iris pins Sodium - a newer Sodium is not installed over the one that works, and isn't fetched again", async () => {
  const MC = "1.21.6";
  const sodium = config.PERFORMANCE_MODS.find((m) => m.label === "Sodium");
  assert.ok(sodium, "Sodium is in the performance pack");
  const oldFile = `sodium-fabric-0.6.0+mc${MC}.jar`;
  const newFile = `sodium-fabric-0.6.5+mc${MC}.jar`;
  const inst = await instanceWith(
    {
      [oldFile]: fabricJar("sodium", { version: "0.6.0" }),
      "iris.jar": fabricJar("iris", { depends: { sodium: "0.6.0" } }),
    },
    { managed: { [oldFile]: { mod: "sodium" } } }
  );
  const gh = github(
    (repo) => (repo === "sodium" ? [release(`mc${MC}-0.6.5`, newFile)] : []),
    () => fabricJar("sodium", { version: "0.6.5" })
  );
  const run = async () => {
    const detail = [];
    await withFetch(gh.fetch, () => minecraft.downloadPerformanceMods(inst.modsDir, MC, null, detail, { loader: "fabric" }));
    const installed = detail.map((d) => ({ ...d, own: true }));
    const held = await minecraft.holdBackForPlayerMods(inst.gameDir, installed, { mcVersion: MC });
    const tidied = await minecraft.tidyManagedMods(inst.modsDir, installed);
    return { installed, held, tidied };
  };

  const first = await run();
  assert.deepEqual(gh.downloads, [newFile]);
  assert.deepEqual(first.held.removed, [newFile]);
  assert.match(first.held.lines[0], /^Kept Sodium as it is \(sodium-fabric-0\.6\.0\+mc1\.21\.6\.jar\): iris\.jar needs version 0\.6\.0, so the newer sodium-fabric-0\.6\.5\+mc1\.21\.6\.jar was not installed$/);
  assert.deepEqual(first.installed, [], "taken off this run's list, so the tidy doesn't treat it as the fresh copy");
  assert.deepEqual(first.tidied, []);
  assert.deepEqual(await inst.list(), ["iris.jar", oldFile], "the working setup is untouched");
  const manifest = await inst.manifest();
  assert.deepEqual(manifest.files, { [oldFile]: { mod: "sodium" } });
  assert.equal(manifest.skipped.sodium.asset, newFile);
  assert.equal(manifest.skipped.sodium.reason, "held back for iris.jar");
  assert.deepEqual(manifest.skipped.sodium.because, [{ file: "iris.jar", size: (await fsp.stat(path.join(inst.modsDir, "iris.jar"))).size }]);

  // The next launch doesn't download that build again...
  const second = await run();
  assert.deepEqual(gh.downloads, [newFile], "no second download");
  assert.deepEqual(second.held.removed, []);
  assert.deepEqual(await inst.list(), ["iris.jar", oldFile]);
  assert.match(await inst.log(), /Kept Sodium as it is again without downloading sodium-fabric-0\.6\.5\+mc1\.21\.6\.jar: iris\.jar still needs the version that is installed/);

  // ...until the mod that pinned it changes: an Iris that takes the new Sodium lets it in.
  await fsp.writeFile(path.join(inst.modsDir, "iris.jar"), fabricJar("iris", { version: "2.0.0", depends: { sodium: ">=0.6.5" } }));
  const third = await run();
  assert.deepEqual(gh.downloads, [newFile, newFile]);
  assert.deepEqual(third.held.removed, []);
  assert.deepEqual(third.tidied, [oldFile]);
  assert.deepEqual(await inst.list(), ["iris.jar", newFile]);
  assert.equal("skipped" in (await inst.manifest()), false);
});

/* ---------------- 6. the twin guard and a jar that was already there ---------------- */

function fakeModrinth(t, projects) {
  const files = {};
  const versions = new Map();
  for (const [pid, p] of Object.entries(projects)) {
    p.versions = p.versions.map((v) => {
      const url = `https://cdn.modrinth.com/data/${pid}/${v.id}/${encodeURIComponent(v.filename)}`;
      files[url] = v.body;
      const full = { id: v.id, project_id: pid, version_number: v.id, version_type: "release", dependencies: [], files: [{ primary: true, filename: v.filename, url, size: v.body.length, hashes: { sha1: sha1(v.body) } }] };
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
  patch(t, modrinth, "getProject", async (pid) => ({ id: pid, title: projects[pid].title, icon_url: null }));
  patch(t, modrinth, "getProjectVersions", async (pid) => projects[pid].versions);
  patch(t, modrinth, "getVersion", async (vid) => versions.get(vid));
  patch(t, modrinth, "getVersions", async (ids) => ids.map((id) => versions.get(id)).filter(Boolean));
}

test("install: picking the version that is already installed never deletes it, even next to a second copy", async (t) => {
  const inst = { id: "twin", loader: "fabric", mcVersion: "1.20.1", gameDir: await tmpDir("game") };
  const mods = path.join(inst.gameDir, "mods");
  await fsp.mkdir(mods, { recursive: true });
  const body = fabricJar("sodium", { version: "0.6.0" });
  fakeModrinth(t, { SOD: { title: "Sodium", versions: [{ id: "s1", filename: "sodium-0.6.0.jar", body }] } });
  await content.install(inst, { projectId: "SOD", kind: "mod" });
  const before = (await content.readManifest(inst.gameDir)).files;
  assert.deepEqual(Object.keys(before), ["mods/sodium-0.6.0.jar"]);

  // A second copy of the same mod turns up by hand, then the same version is picked again in the chooser.
  await fsp.writeFile(path.join(mods, "Sodium-custom-build.jar"), fabricJar("sodium", { version: "0.5.0-custom" }));
  await assert.rejects(content.install(inst, { projectId: "SOD", kind: "mod", versionId: "s1" }), /Sodium is already in this instance's mods folder \(Sodium-custom-build\.jar\)\./);
  assert.deepEqual((await fsp.readdir(mods)).sort(), ["Sodium-custom-build.jar", "sodium-0.6.0.jar"], "the jar that was there is still there");
  assert.deepEqual(await fsp.readFile(path.join(mods, "sodium-0.6.0.jar")), body);
  assert.deepEqual((await content.readManifest(inst.gameDir)).files, before, "and its entry still points at a real file");
});

/* ---------------- 7. mods an older Reminth installed and this one doesn't ---------------- */

test("adoption: c2me / ferritecore / starlight left by an older Reminth are taken over, then tidied away", async () => {
  const jars = {
    "c2me-fabric-mc1.21.1-0.3.jar": fabricJar("c2me"),
    "ferritecore-7.0.0-fabric.jar": fabricJar("ferritecore"),
    "starlight-1.1.3+fabric.jar": fabricJar("starlight"),
    "sodium-fabric-0.5.0.jar": fabricJar("sodium"),
    "ferritecore-extras-1.0.jar": fabricJar("ferritecore-extras"), // another mod: its name only starts the same
  };
  const inst = await instanceWith(jars, { tracked: ["starlight-1.1.3+fabric.jar"] }); // the player chose Starlight themselves
  const adopted = await minecraft.adoptLegacyManagedMods(inst.gameDir, { usedBefore: true });
  assert.deepEqual(adopted.sort(), ["c2me-fabric-mc1.21.1-0.3.jar", "ferritecore-7.0.0-fabric.jar", "sodium-fabric-0.5.0.jar"]);
  const removed = await minecraft.tidyManagedMods(inst.modsDir, []);
  assert.deepEqual(removed.sort(), ["c2me-fabric-mc1.21.1-0.3.jar", "ferritecore-7.0.0-fabric.jar"]);
  assert.deepEqual(await inst.list(), ["ferritecore-extras-1.0.jar", "sodium-fabric-0.5.0.jar", "starlight-1.1.3+fabric.jar"]);
  assert.deepEqual((await inst.manifest()).files, { "sodium-fabric-0.5.0.jar": { mod: "sodium" } });

  // A brand-new instance (a modpack that ships C2ME): nothing is taken over, nothing removed.
  const fresh = await instanceWith(jars);
  assert.deepEqual(await minecraft.adoptLegacyManagedMods(fresh.gameDir, { usedBefore: false }), []);
  assert.deepEqual(await minecraft.tidyManagedMods(fresh.modsDir, []), []);
  assert.equal((await fresh.list()).length, 5);
});

/* ---------------- 8. XSTS answers about the account ---------------- */

test("refreshSession: an XSTS 401 with an XErr is about the account - it doesn't sign the player out", async () => {
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const routes = (xsts) => ({
    "oauth2/v2.0/token": () => json({ access_token: "ms", refresh_token: "r2" }),
    "user.auth.xboxlive.com": () => json({ Token: "xbl", DisplayClaims: { xui: [{ uhs: "hash" }] } }),
    "xsts.auth.xboxlive.com": xsts,
  });
  const failure = async (xsts) => {
    try {
      await withFetch(async (url) => {
        for (const [fragment, reply] of Object.entries(routes(xsts))) if (String(url).includes(fragment)) return reply();
        throw new Error("unexpected request: " + url);
      }, () => msAuth.refreshSession("refresh-old"));
    } catch (err) {
      return err;
    }
    return null;
  };
  // Xbox Live isn't offered in this country: nothing a new sign-in would change.
  const region = await failure(() => json({ Identity: "0", XErr: 2148916235, Message: "", Redirect: "https://start.ui.xboxlive.com/CountryBlocked" }, 401));
  assert.equal(region.code, undefined);
  assert.match(region.message, /XSTS auth failed: 401 .*2148916235/, "its own message is kept");
  // an unknown code is treated the same way
  assert.equal((await failure(() => json({ XErr: 2148916299 }, 401))).code, undefined);
  // the two with a sentence of their own
  assert.match((await failure(() => json({ XErr: 2148916238 }, 401))).message, /child account/);
  // a bare 401 is still the sign-in being refused
  assert.equal((await failure(() => json({}, 401))).code, "AUTH_REJECTED");

  assert.equal(msAuth.isRejectedStatus(401, "", "chain"), true);
  assert.equal(msAuth.isRejectedStatus(401, "XErr", "chain"), false);
  assert.equal(msAuth.isRejectedStatus(400, "invalid_grant"), true);
});

/* ---------------- 9. a readable account.json ---------------- */

test("account: a readable account.json from an older version is rewritten encrypted the moment it is read", async (t) => {
  t.after(() => (safeStorage.available = false));
  await fsp.mkdir(paths.ROOT, { recursive: true });
  const old = { name: "Old", refreshToken: "plain-secret" };
  const onDisk = async () => (await fsp.readdir(paths.ROOT)).filter((n) => n.startsWith("account.json")).sort();
  const clear = async () => Promise.all((await onDisk()).map((n) => fsp.rm(path.join(paths.ROOT, n), { force: true })));

  // The key store is there: same account, now encrypted - and no readable copy left in the backup.
  await clear();
  safeStorage.available = true;
  await fsp.writeFile(paths.ACCOUNTS_FILE, JSON.stringify(old));
  await fsp.writeFile(paths.ACCOUNTS_FILE + ".bak", JSON.stringify(old));
  assert.deepEqual(await store.loadAccount(), old);
  for (const name of await onDisk()) {
    const raw = await fsp.readFile(path.join(paths.ROOT, name));
    assert.equal(raw[0], 0x01, `${name} is encrypted`);
    assert.ok(!raw.includes("plain-secret"), `${name} no longer holds the token as text`);
  }
  assert.deepEqual(await onDisk(), ["account.json", "account.json.bak"]);
  assert.deepEqual(await store.loadAccount(), old, "and it still reads back");

  // No key store: the readable file is removed, and the account is still handed over for this session.
  await clear();
  safeStorage.available = false;
  await fsp.writeFile(paths.ACCOUNTS_FILE, JSON.stringify(old));
  await fsp.writeFile(paths.ACCOUNTS_FILE + ".bak", JSON.stringify(old));
  assert.deepEqual(await store.loadAccount(), old);
  assert.deepEqual(await onDisk(), []);

  // Only a readable backup is left (the main file is gone): the same.
  safeStorage.available = true;
  await fsp.writeFile(paths.ACCOUNTS_FILE + ".bak", JSON.stringify(old));
  assert.deepEqual(await store.loadAccount(), old);
  assert.equal((await fsp.readFile(paths.ACCOUNTS_FILE))[0], 0x01);
  assert.equal((await fsp.readFile(paths.ACCOUNTS_FILE + ".bak"))[0], 0x01);
  await clear();
});

/* ---------------- 10 + 13. what GitHub answers ---------------- */

test("github: a 403 without the rate-limit header, a 429 or a 5xx is a failure - not 'no build yet'", async () => {
  const ask = (res) => withFetch(async () => res(), () => minecraft.fetchLatestGithubAssetForVersion("Err", "Repo", "1.19.4"));
  await assert.rejects(ask(() => new Response("{}", { status: 403 })), /GitHub answered 403/);
  await assert.rejects(ask(() => new Response("slow down", { status: 429 })), /GitHub answered 429/);
  await assert.rejects(ask(() => new Response("oops", { status: 502 })), /GitHub answered 502/);
  await assert.rejects(ask(() => new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } })), /rate limit/);
  assert.equal(await exists(path.join(paths.ROOT, "cache", "github-releases", "Err-Repo-1.19.4.json")), false, "none of it is remembered");

  // ...and the log says so, mod by mod.
  const inst = await instanceWith({});
  const gh = github(() => new Response("oops", { status: 500 }), () => Buffer.alloc(0));
  assert.deepEqual(await withFetch(gh.fetch, () => minecraft.downloadPerformanceMods(inst.modsDir, "1.19.4", null, null, { loader: "fabric" })), []);
  const log = await inst.log();
  for (const mod of config.PERFORMANCE_MODS) assert.match(log, new RegExp(`${mod.label} failed to install \\(GitHub answered 500\\) - skipped`));
  assert.doesNotMatch(log, /No .* build for/);
});

test("isPreRelease: flagged by GitHub, or named alpha / beta / rc / pre in the tag or title", () => {
  const pre = (r, mc) => minecraft.isPreRelease(r, mc);
  assert.equal(pre({ tag_name: "mc1.21.1-0.6.0", name: "Sodium 0.6.0 for Minecraft 1.21.1" }), false);
  assert.equal(pre({ tag_name: "0.2.1", name: "" }), false);
  assert.equal(pre({ tag_name: "mc1.21.1-0.6.0", prerelease: true }), true);
  assert.equal(pre({ tag_name: "mc1.21.1-0.6.0", draft: true }), true);
  for (const tag of ["0.4.1-beta.1", "0.4.1-BETA", "mc1.21-0.6.0-beta2", "v1.0.0-rc1", "1.0.0-RC.2", "0.7.0-alpha", "1.0-pre3", "2.0.0-prerelease", "1.0.0-pre-release.1", "0.5.0-snapshot"]) {
    assert.equal(pre({ tag_name: tag }), true, tag);
  }
  assert.equal(pre({ tag_name: "1.0.0", name: "Lithium 1.0.0 Beta" }), true);
  // a word that only contains one of them is not a marker
  for (const tag of ["1.0.0-source", "arc-1.0.0", "1.0.0-prepared", "alphabet-1.0", "1.0.0+release"]) assert.equal(pre({ tag_name: tag }), false, tag);
  // on a pre-release of Minecraft itself, "pre" is the game's, not the mod's
  assert.equal(pre({ tag_name: "mc1.21.2-pre1-0.6.0" }, "1.21.2-pre1"), false);
  assert.equal(pre({ tag_name: "mc1.21.2-pre1-0.6.0-beta.1" }, "1.21.2-pre1"), true);
  assert.equal(pre(null), false);
});

test("github: a pre-release is passed over for the newest finished build, and never installed when it is all there is", async () => {
  const MC = "1.19.3";
  const jarFor = (file) => fabricJar(file.split("-")[0], { depends: { minecraft: MC } });
  // Sodium: a beta on top of a finished build. Lithium: only a beta, and one GitHub flags.
  // ScalableLux: nothing at all for this version.
  const gh = github(
    (repo) =>
      repo === "sodium"
        ? [release(`mc${MC}-0.7.0-beta.1`, `sodium-fabric-0.7.0-beta.1+mc${MC}.jar`), release(`mc${MC}-0.6.0`, `sodium-fabric-0.6.0+mc${MC}.jar`)]
        : repo === "lithium"
          ? [release(`mc${MC}-0.15.0-rc1`, `lithium-fabric-0.15.0-rc1+mc${MC}.jar`), release(`mc${MC}-0.14.9`, `lithium-fabric-0.14.9+mc${MC}.jar`, { prerelease: true }), release("mc1.18.2-0.10.0", "lithium-fabric-0.10.0+mc1.18.2.jar")]
          : [release("mc1.18.2-0.1.0", "scalablelux-fabric-0.1.0+mc1.18.2.jar")],
    jarFor
  );
  const inst = await instanceWith({});
  const installed = await withFetch(gh.fetch, () => minecraft.downloadPerformanceMods(inst.modsDir, MC, null, null, { loader: "fabric" }));
  assert.deepEqual(installed, [`sodium-fabric-0.6.0+mc${MC}.jar`]);
  assert.deepEqual(gh.downloads, [`sodium-fabric-0.6.0+mc${MC}.jar`], "no pre-release was even downloaded");
  assert.deepEqual(await inst.list(), [`sodium-fabric-0.6.0+mc${MC}.jar`]);
  let log = await inst.log();
  assert.match(log, /No stable Lithium build for 1\.19\.3 yet - skipped/);
  assert.match(log, /No ScalableLux build for 1\.19\.3 yet - skipped/);
  assert.doesNotMatch(log, /No stable ScalableLux/);

  // Answered from the remembered reply (no request), the log still says why.
  const offline = async () => {
    throw new TypeError("fetch failed");
  };
  await withFetch(offline, () => minecraft.downloadPerformanceMods(inst.modsDir, MC, null, null, { loader: "fabric" }));
  log = await inst.log();
  assert.match(log, /No stable Lithium build for 1\.19\.3 yet - skipped/);
  assert.match(log, /No ScalableLux build for 1\.19\.3 yet - skipped/);

  const info = {};
  assert.equal(await withFetch(offline, () => minecraft.fetchLatestGithubAssetForVersion("CaffeineMC", "lithium", MC, info)), null);
  assert.deepEqual(info, { onlyPrerelease: true });
});

/* ---------------- 11. the check's cache and Reminth's own jars ---------------- */

test("checkInstance: a change in which jars are Reminth's is never answered from the cache", async () => {
  const mods = [jar("sodium-old.jar", { name: "Sodium", modId: "sodium", mcDep: "1.20.1" }), jar("fine.jar", { name: "Fine", modId: "fine" })];
  const asManaged = await compat.checkInstance(fakeInstance("k1"), { deps: depsFor(mods, { managed: ["sodium-old.jar"] }) });
  assert.equal(asManaged.issues.length, 0, "Reminth's own jar isn't reported");
  // The same file, no longer Reminth's (it was disowned at launch): now it is the player's to hear about.
  const asPlayers = await compat.checkInstance(fakeInstance("k1"), { deps: depsFor(mods) });
  assert.deepEqual(asPlayers.issues.map((i) => [i.file, i.reason, i.severity]), [["sodium-old.jar", "wrong-mc", "blocked"]]);
  // unchanged: the cache does answer
  assert.equal(await compat.checkInstance(fakeInstance("k1"), { deps: depsFor(mods) }), asPlayers);
  compat.invalidate("k1");
  assert.notEqual(await compat.checkInstance(fakeInstance("k1"), { deps: depsFor(mods) }), asPlayers);
});

/* ---------------- 12. the override file and the Fabric API ---------------- */

test("checkInstance: with a dependency override file, 'Fabric API missing' is a warning too", async () => {
  const mods = [jar("a.jar", { name: "A", requires: ["fabric-api"] })];
  const plain = await compat.checkInstance(fakeInstance("o1"), { force: true, deps: depsFor(mods) });
  assert.deepEqual(plain.issues.map((i) => [i.reason, i.severity]), [["missing-dep", "blocked"]]);
  const over = await compat.checkInstance(fakeInstance("o2"), { force: true, deps: depsFor(mods, { override: true }) });
  assert.deepEqual(over.issues.map((i) => [i.reason, i.severity, i.fix.type]), [["missing-dep", "warn", "install"]]);
  assert.match(over.issues[0].detail, / \(This instance has a dependency override file, so it may load anyway\.\)$/);
  assert.equal(over.blocked, 0);
  // the quick check for Play agrees
  const quick = await compat.checkInstance(fakeInstance("o3"), { localOnly: true, deps: depsFor(mods, { override: true }) });
  assert.equal(quick.blocked, 0);
});

/* ---------------- 14. modpacks ---------------- */

test("modpack: the instance it creates has the performance pack switched off - the pack's author already chose", async (t) => {
  const index = { formatVersion: 1, game: "minecraft", dependencies: { minecraft: "1.20.1", "fabric-loader": "0.15.0" }, files: [] };
  const pack = rawZip([{ name: "modrinth.index.json", data: JSON.stringify(index) }]);
  const packUrl = "https://cdn.modrinth.com/data/PACKFINAL/versions/v1/pack.mrpack";
  patch(t, modrinth, "getProject", async () => ({ id: "PACKFINAL", title: "Curated Pack", icon_url: null }));
  patch(t, modrinth, "getProjectVersions", async () => [
    { id: "v1", project_id: "PACKFINAL", version_number: "1", version_type: "release", files: [{ primary: true, filename: "pack.mrpack", url: packUrl, size: pack.length, hashes: { sha1: sha1(pack) } }] },
  ]);
  patch(t, globalThis, "fetch", async (url) => (String(url) === packUrl ? new Response(pack, { status: 200 }) : new Response("nope", { status: 404 })));

  const made = await mrpack.installModpack({ projectId: "PACKFINAL" });
  assert.equal(made.performanceMods, false);
  assert.equal(made.modpack.projectId, "PACKFINAL");
  const stored = (await instances.list()).find((i) => i.id === made.id);
  assert.equal(stored.performanceMods, false, "and it is saved that way");
  // the player can switch it on in the instance's settings
  assert.equal((await instances.update(made.id, { performanceMods: true })).performanceMods, true);
  // an instance made by hand still gets the pack unless it is switched off
  assert.notEqual((await instances.create({ name: "By hand", mcVersion: "1.20.1", loader: "fabric" })).performanceMods, false);
});
