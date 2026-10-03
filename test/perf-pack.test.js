"use strict";
/**
 * Tests for the performance pack from Modrinth (minecraft.downloadPerformancePack
 * and friends): release builds only, the 48-hour soak, sha1 and jar checks,
 * dependencies, the cache, Modrinth being down, the player's own copies and
 * conflicting mods, the player's choices about Reminth's jars, and the status
 * the instance page shows.
 *
 * No network: Modrinth is a fake object passed in, downloads write jars built
 * here (or go through the real downloader against a stubbed global fetch).
 * Everything on disk happens under a throwaway HOME.
 * Run with: node --test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "reminth-perfpack-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return "STUB_ELECTRON_PERFPACK";
  if (request === "extract-zip") return "STUB_EXTRACT_ZIP_PERFPACK";
  return originalResolve.call(this, request, ...rest);
};
Module._cache.STUB_ELECTRON_PERFPACK = { id: "STUB_ELECTRON_PERFPACK", filename: "STUB_ELECTRON_PERFPACK", loaded: true, exports: { safeStorage: { isEncryptionAvailable: () => false } } };
Module._cache.STUB_EXTRACT_ZIP_PERFPACK = { id: "STUB_EXTRACT_ZIP_PERFPACK", filename: "STUB_EXTRACT_ZIP_PERFPACK", loaded: true, exports: async () => {} };

const config = require("../src/main/config");
const minecraft = require("../src/main/minecraft");
const zip = require("../src/main/zip");

const tmpDir = (name) => fsp.mkdtemp(path.join(HOME, `${name}-`));
const exists = (p) => fsp.access(p).then(() => true, () => false);
const sha1 = (buf) => crypto.createHash("sha1").update(buf).digest("hex");
const NOW = Date.parse("2026-10-03T12:00:00Z");
const HOUR = 60 * 60 * 1000;

/** The bytes of a Fabric mod jar whose fabric.mod.json is `meta`. */
async function jarBytes(meta) {
  const src = await tmpDir("jarsrc");
  await fsp.writeFile(path.join(src, "fabric.mod.json"), JSON.stringify({ schemaVersion: 1, ...meta }));
  const out = path.join(await tmpDir("jarout"), "out.jar");
  await zip.buildZip(src, out);
  return fsp.readFile(out);
}

/** The bytes of a NeoForge mod jar declaring `modId`. */
async function neoJarBytes(modId) {
  const src = await tmpDir("neosrc");
  await fsp.mkdir(path.join(src, "META-INF"));
  await fsp.writeFile(path.join(src, "META-INF", "neoforge.mods.toml"), `modLoader="javafml"\nloaderVersion="[1,)"\n[[mods]]\nmodId="${modId}"\nversion="1.0.0"\n`);
  const out = path.join(await tmpDir("neoout"), "out.jar");
  await zip.buildZip(src, out);
  return fsp.readFile(out);
}

/**
 * A fake Modrinth. `table`: slug or project id -> list of versions (see ver()).
 * `jars`: file name -> bytes, served by the fake download.
 */
function fakeModrinth({ down = false } = {}) {
  const table = {};
  const jars = {};
  const calls = [];
  return {
    table,
    jars,
    calls,
    down,
    api: {
      async getProjectVersions(project, query) {
        calls.push({ project, query });
        if (this._down()) throw new Error("Modrinth unreachable");
        return table[project] || [];
      },
      _down: () => false,
    },
    async download(url, dest, hash) {
      const name = decodeURIComponent(url.split("/").pop());
      const bytes = jars[name];
      if (!bytes) throw new Error("404");
      if (sha1(bytes) !== hash) throw new Error("Checksum mismatch");
      await fsp.writeFile(dest, bytes);
    },
  };
}

/** Registers one Modrinth version of `slug` (with real jar bytes) and returns the version object. */
async function ver(mr, slug, version, { type = "release", ageH = 200, mc = "1.21.1", loaders = ["fabric"], deps = [], bytes = null, meta = null, sha = null } = {}) {
  const filename = `${slug}-${version}.jar`;
  const content = bytes || (await jarBytes(meta || { id: (config.PERFORMANCE_PACK.find((e) => e.slug === slug) || { ids: [slug] }).ids[0], version, depends: { minecraft: mc } }));
  mr.jars[filename] = content;
  const v = {
    id: `${slug}@${version}`,
    project_id: `P-${slug}`,
    version_number: version,
    name: `${slug} ${version}`,
    version_type: type,
    game_versions: [mc],
    loaders,
    date_published: new Date(NOW - ageH * HOUR).toISOString(),
    files: [{ primary: true, filename, url: `https://cdn.modrinth.com/data/${slug}/${filename}`, hashes: { sha1: sha || sha1(content) } }],
    dependencies: deps,
  };
  (mr.table[slug] = mr.table[slug] || []).unshift(v); // newest first, as Modrinth answers
  return v;
}

/** An instance folder: { "<file>": fabric.mod.json fields } jars in mods/, optional manifest. */
async function instanceWith(jars = {}, { loader = "fabric", mcVersion = "1.21.1", manifest = null, extra = {} } = {}) {
  const gameDir = await tmpDir("game");
  const modsDir = path.join(gameDir, "mods");
  await fsp.mkdir(modsDir);
  await fsp.mkdir(path.join(gameDir, ".reminth"));
  for (const [file, meta] of Object.entries(jars)) await fsp.writeFile(path.join(modsDir, file), Buffer.isBuffer(meta) ? meta : await jarBytes(meta));
  if (manifest) await fsp.writeFile(path.join(gameDir, ".reminth", "managed-mods.json"), JSON.stringify({ version: 1, ...manifest }));
  const instance = { id: path.basename(gameDir), gameDir, loader, mcVersion, ...extra };
  return {
    instance,
    gameDir,
    modsDir,
    list: async () => (await fsp.readdir(modsDir)).sort(),
    manifest: () => minecraft.readManagedMods(gameDir),
    log: () => fsp.readFile(path.join(gameDir, "reminth-performance-mods.log"), "utf8"),
  };
}

/** Runs the pack with only the given slugs in config.PERFORMANCE_PACK (restored afterwards). */
async function withPack(slugs, fn) {
  const real = config.PERFORMANCE_PACK;
  config.PERFORMANCE_PACK = real.filter((e) => slugs.includes(e.slug));
  try {
    return await fn();
  } finally {
    config.PERFORMANCE_PACK = real;
  }
}

const run = (inst, mr, options = {}) =>
  minecraft.downloadPerformancePack(inst.instance, inst.modsDir, {
    ...options,
    deps: { api: mr.api, download: (u, d, h) => mr.download(u, d, h), now: NOW, cacheDir: path.join(inst.gameDir, "..", `cache-${path.basename(inst.gameDir)}`), ...(options.deps || {}) },
  });

/* ---------------- the rule ---------------- */

test("perfPackEnabled: Fabric/Quilt on unless switched off; Forge/NeoForge only when switched on; vanilla never", () => {
  const table = [
    ["fabric", undefined, true],
    ["fabric", true, true],
    ["fabric", false, false],
    ["quilt", undefined, true],
    ["quilt", false, false],
    ["forge", undefined, false],
    ["forge", true, true],
    ["forge", false, false],
    ["neoforge", undefined, false],
    ["neoforge", true, true],
    ["vanilla", true, false],
    ["vanilla", undefined, false],
  ];
  for (const [loader, performanceMods, want] of table) {
    assert.equal(config.perfPackEnabled({ loader, performanceMods }), want, `${loader} / ${performanceMods}`);
  }
  assert.equal(config.perfPackEnabled(null), false);
});

test("pack list: no alpha-only or third-party mods as silent defaults; every entry well-formed", () => {
  const slugs = config.PERFORMANCE_PACK.map((e) => e.slug);
  for (const banned of ["c2me-fabric", "modernfix-mvus", "dynamic-fps", "badoptimizations", "ixeris", "nvidium", "voxy"]) assert.ok(!slugs.includes(banned), banned);
  for (const e of config.PERFORMANCE_PACK) {
    assert.match(e.slug, /^[a-z0-9-]+$/);
    assert.ok(e.label && Array.isArray(e.ids) && e.ids.length && Array.isArray(e.conflicts) && Array.isArray(e.loaders) && e.loaders.length);
  }
  const forLoader = (l) => config.PERFORMANCE_PACK.filter((e) => e.loaders.includes(l)).map((e) => e.slug).sort();
  assert.deepEqual(forLoader("fabric"), ["entityculling", "ferrite-core", "immediatelyfast", "lithium", "scalablelux", "sodium"]);
  assert.deepEqual(forLoader("neoforge"), ["entityculling", "ferrite-core", "immediatelyfast", "lithium", "modernfix", "scalablelux", "sodium"]);
  assert.deepEqual(forLoader("forge"), ["embeddium", "entityculling", "ferrite-core", "immediatelyfast", "modernfix", "radium"]);
});

/* ---------------- picking a build ---------------- */

test("pickPackRelease: newest release at least 48h old; all new -> oldest of them only when nothing is installed", () => {
  const r = (v, ageH) => ({ version: v, publishedAt: NOW - ageH * HOUR });
  const list = [r("3", 5), r("2", 60), r("1", 500)];
  assert.equal(minecraft.pickPackRelease(list, { now: NOW }).pick.version, "2");
  const allNew = [r("3", 5), r("2", 20)];
  assert.equal(minecraft.pickPackRelease(allNew, { now: NOW }).pick.version, "2", "brand-new instance gets the oldest new one");
  const kept = minecraft.pickPackRelease(allNew, { now: NOW, hasManagedCopy: true });
  assert.equal(kept.pick, null);
  assert.equal(kept.why, "too-new");
  assert.equal(minecraft.pickPackRelease([], { now: NOW }).why, "none");
});

test("packReleaseFrom: alpha/beta, other versions, files off Modrinth's host or without sha1 are refused", () => {
  const base = { id: "a", project_id: "p", version_number: "1", version_type: "release", game_versions: ["1.21.1"], loaders: ["fabric"], date_published: new Date(NOW).toISOString(), files: [{ primary: true, filename: "x-1.jar", url: "https://cdn.modrinth.com/data/p/x-1.jar", hashes: { sha1: "a".repeat(40) } }], dependencies: [] };
  assert.ok(minecraft.packReleaseFrom(base, "1.21.1", ["fabric"]));
  assert.equal(minecraft.packReleaseFrom({ ...base, version_type: "beta" }, "1.21.1", ["fabric"]), null);
  assert.equal(minecraft.packReleaseFrom({ ...base, version_type: "alpha" }, "1.21.1", ["fabric"]), null);
  assert.equal(minecraft.packReleaseFrom(base, "1.21.10", ["fabric"]), null);
  assert.equal(minecraft.packReleaseFrom(base, "1.21.1", ["neoforge"]), null);
  assert.equal(minecraft.packReleaseFrom({ ...base, files: [{ ...base.files[0], url: "https://evil.example/x-1.jar" }] }, "1.21.1", ["fabric"]), null);
  assert.equal(minecraft.packReleaseFrom({ ...base, files: [{ ...base.files[0], hashes: {} }] }, "1.21.1", ["fabric"]), null);
  assert.equal(minecraft.packReleaseFrom({ ...base, files: [{ ...base.files[0], filename: "../x.jar" }] }, "1.21.1", ["fabric"]), null);
});

test("release only: an alpha newer than the release is never installed", async () => {
  const mr = fakeModrinth();
  await ver(mr, "sodium", "0.6.0");
  await ver(mr, "sodium", "0.7.0-alpha.1", { type: "alpha" });
  const inst = await instanceWith();
  const out = await withPack(["sodium"], () => run(inst, mr));
  assert.deepEqual(out.installed, ["sodium-0.6.0.jar"]);
  assert.deepEqual(await inst.list(), ["sodium-0.6.0.jar"]);
  assert.equal(out.states.sodium.state, "installed");
  assert.match(await inst.log(), /Installed Sodium: sodium-0\.6\.0\.jar \(release 0\.6\.0\)/);
});

test("only test builds for this version: nothing installed, said plainly", async () => {
  const mr = fakeModrinth();
  await ver(mr, "scalablelux", "0.3.0-alpha.1", { type: "alpha" });
  const inst = await instanceWith();
  const out = await withPack(["scalablelux"], () => run(inst, mr));
  assert.deepEqual(out.installed, []);
  assert.equal(out.states.scalablelux.state, "no-build");
  assert.match(await inst.log(), /No stable ScalableLux build for 1\.21\.1 yet \(only test builds\) - skipped/);
});

test("soak: a release under 48 hours old waits while Reminth's copy is installed", async () => {
  const mr = fakeModrinth();
  await ver(mr, "lithium", "0.2.0", { ageH: 10 });
  const old = await jarBytes({ id: "lithium", version: "0.1.0" });
  const inst = await instanceWith({ "lithium-0.1.0.jar": old }, { manifest: { files: { "lithium-0.1.0.jar": { mod: "lithium" } } } });
  const out = await withPack(["lithium"], () => run(inst, mr, { isOurs: () => true }));
  assert.deepEqual(out.installed, []);
  assert.deepEqual(await inst.list(), ["lithium-0.1.0.jar"], "the working copy stays");
  assert.equal(out.states.lithium.state, "installed");
  assert.match(await inst.log(), /less than 48 hours old/);
});

/* ---------------- download checks ---------------- */

test("hash mismatch: the download is refused and nothing lands in mods/", async () => {
  const mr = fakeModrinth();
  const v = await ver(mr, "sodium", "0.6.0", { sha: "0".repeat(40) });
  const inst = await instanceWith();
  const real = global.fetch;
  global.fetch = async (url) => (String(url) === v.files[0].url ? new Response(mr.jars[v.files[0].filename], { status: 200 }) : new Response("no", { status: 404 }));
  let out;
  try {
    // the real downloader: sha1 checked before the rename
    out = await withPack(["sodium"], () => minecraft.downloadPerformancePack(inst.instance, inst.modsDir, { deps: { api: mr.api, now: NOW, cacheDir: path.join(inst.gameDir, "c") } }));
  } finally {
    global.fetch = real;
  }
  assert.deepEqual(out.installed, []);
  assert.deepEqual(await inst.list(), [], "no jar and no leftover temp file");
  assert.equal(out.states.sodium.state, "failed");
  assert.match(await inst.log(), /Sodium failed to install \(Checksum mismatch/);
});

test("misfit jar: Modrinth says 1.21.1 but the jar says otherwise - deleted, and not fetched again", async () => {
  const mr = fakeModrinth();
  await ver(mr, "lithium", "0.1.0", { meta: { id: "lithium", version: "0.1.0", depends: { minecraft: "1.20.1" } } });
  const inst = await instanceWith();
  const first = await withPack(["lithium"], () => run(inst, mr));
  assert.deepEqual(first.installed, []);
  assert.deepEqual(await inst.list(), []);
  assert.equal(first.states.lithium.state, "no-build");
  assert.equal((await inst.manifest()).skipped.lithium.reason, "not-for-version");
  let downloads = 0;
  await withPack(["lithium"], () => run(inst, mr, { deps: { download: async () => downloads++ } }));
  assert.equal(downloads, 0, "the same file is not downloaded again");
});

/* ---------------- dependencies ---------------- */

test("dependencies: Fabric API counts as there on Fabric; a dependency with no stable build leaves the mod out", async () => {
  const mr = fakeModrinth();
  await ver(mr, "entityculling", "1.0.0", { deps: [{ project_id: "P7dR8mSH", dependency_type: "required" }] });
  await ver(mr, "immediatelyfast", "1.0.0", { deps: [{ project_id: "P-needed", dependency_type: "required" }] });
  mr.table["P-needed"] = [];
  await ver(mr, "needed", "2.0-beta", { type: "beta" });
  mr.table["P-needed"] = mr.table.needed;
  const inst = await instanceWith();
  const out = await withPack(["entityculling", "immediatelyfast"], () => run(inst, mr));
  assert.deepEqual(out.installed, ["entityculling-1.0.0.jar"]);
  assert.equal(out.states.immediatelyfast.state, "no-build");
  assert.match(await inst.log(), /Left ImmediatelyFast out: it needs a mod \(P-needed\), which has no stable build for 1\.21\.1/);
});

test("dependencies: a needed mod with a stable build is installed alongside, as Reminth's", async () => {
  const mr = fakeModrinth();
  await ver(mr, "immediatelyfast", "1.0.0", { deps: [{ project_id: "P-lib", dependency_type: "required" }, { project_id: "P-opt", dependency_type: "optional" }] });
  await ver(mr, "lib", "3.0", { meta: { id: "somelib", version: "3.0" } });
  mr.table["P-lib"] = mr.table.lib;
  const inst = await instanceWith();
  const detail = [];
  const out = await withPack(["immediatelyfast"], () => run(inst, mr, { detail }));
  assert.deepEqual(out.installed.sort(), ["immediatelyfast-1.0.0.jar", "lib-3.0.jar"]);
  assert.ok(detail.some((d) => d.file === "lib-3.0.jar" && d.mod === "dep-P-lib"), "recorded so Reminth can tidy it later");
});

test("dependencies: Fabric API is not there on NeoForge - a mod needing it is left out", async () => {
  const mr = fakeModrinth();
  await ver(mr, "entityculling", "1.0.0", { loaders: ["neoforge"], bytes: await neoJarBytes("entityculling"), deps: [{ project_id: "P7dR8mSH", dependency_type: "required" }] });
  const inst = await instanceWith({}, { loader: "neoforge", extra: { performanceMods: true } });
  const out = await withPack(["entityculling"], () => run(inst, mr));
  assert.deepEqual(out.installed, []);
  assert.equal(out.states.entityculling.state, "no-build");
});

/* ---------------- cache and outages ---------------- */

test("cache: a second launch inside six hours asks Modrinth nothing", async () => {
  const mr = fakeModrinth();
  await ver(mr, "sodium", "0.6.0");
  const inst = await instanceWith();
  const detail = [];
  await withPack(["sodium"], () => run(inst, mr, { detail }));
  // as ensureInstalled does after the download: write down what is Reminth's
  await minecraft.tidyManagedMods(inst.modsDir, detail.map((d) => ({ ...d, own: true })));
  assert.equal(mr.calls.length, 1);
  const again = await withPack(["sodium"], () => run(inst, mr));
  assert.equal(mr.calls.length, 1, "answered from the cache");
  assert.equal(again.states.sodium.state, "installed");
});

test("Modrinth down with a remembered answer: that answer is used however old it is", async () => {
  const mr = fakeModrinth();
  await ver(mr, "sodium", "0.6.0");
  const inst = await instanceWith();
  await withPack(["sodium"], () => run(inst, mr));
  await fsp.rm(path.join(inst.modsDir, "sodium-0.6.0.jar"));
  await fsp.writeFile(path.join(inst.gameDir, ".reminth", "managed-mods.json"), JSON.stringify({ version: 1, files: {} }));
  mr.api._down = () => true;
  const later = await withPack(["sodium"], () => run(inst, mr, { deps: { now: NOW + 3 * 24 * HOUR } }));
  assert.deepEqual(later.installed, ["sodium-0.6.0.jar"]);
});

test("Modrinth down, nothing remembered: nothing is deleted, the installed copy stays, Sodium falls back to GitHub", async () => {
  const mr = fakeModrinth();
  mr.api._down = () => true;
  const oldLithium = await jarBytes({ id: "lithium", version: "0.1.0" });
  const inst = await instanceWith({ "lithium-0.1.0.jar": oldLithium }, { manifest: { files: { "lithium-0.1.0.jar": { mod: "lithium" } } } });
  const sodiumJar = await jarBytes({ id: "sodium", version: "0.6.0", depends: { minecraft: ">=1.21" } });
  const seen = [];
  const real = global.fetch;
  global.fetch = async (url) => {
    url = String(url);
    seen.push(url);
    if (/api\.github\.com\/repos\/CaffeineMC\/sodium\/releases/.test(url)) {
      const name = "sodium-fabric-0.6.0+mc1.21.1.jar";
      return new Response(JSON.stringify([{ tag_name: "mc1.21.1-0.6.0", name: "", body: "", assets: [{ name, size: 1000, browser_download_url: `https://github.com/dl/${name}` }] }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (/github\.com\/dl\/sodium/.test(url)) return new Response(sodiumJar, { status: 200 });
    if (/api\.github\.com/.test(url)) return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    return new Response("no", { status: 404 });
  };
  let out;
  try {
    out = await withPack(["sodium", "lithium", "ferrite-core"], () => run(inst, mr, { isOurs: (f) => f !== "lithium-0.1.0.jar" || true }));
  } finally {
    global.fetch = real;
  }
  assert.ok((await inst.list()).includes("lithium-0.1.0.jar"), "the installed copy stays");
  assert.ok((await inst.list()).includes("sodium-fabric-0.6.0+mc1.21.1.jar"), "Sodium came from GitHub");
  assert.equal(out.states.lithium.state, "installed");
  assert.equal(out.states["ferrite-core"].state, "failed", "no GitHub source for FerriteCore");
  assert.match(await inst.log(), /trying GitHub/);
});

test("rate limit / slow Modrinth: the launch waits no longer than the budget", async () => {
  const mr = fakeModrinth();
  mr.api.getProjectVersions = () => new Promise(() => {}); // never answers
  const inst = await instanceWith();
  const t0 = Date.now();
  const out = await withPack(["ferrite-core", "immediatelyfast"], () => run(inst, mr, { deps: { budgetMs: 300 } }));
  assert.ok(Date.now() - t0 < 3000, "carried on");
  assert.equal(out.states["ferrite-core"].state, "failed");
});

/* ---------------- the player's own mods ---------------- */

const item = (file, modId, extra = {}) => ({ file, enabled: true, valid: true, folder: false, modId, modVersion: "1", depends: null, breaks: null, provides: [], nested: [], mcDep: null, ...extra });

test("planPackSkips: own copy by id, conflict by id, OptiFine by file name", () => {
  const plan = (mods) => minecraft.planPackSkips({ mods, managed: {}, tracked: new Set(), mcVersion: "1.21.1" });
  assert.deepEqual(plan([item("my-sodium.jar", "sodium")]).get("sodium"), { file: "my-sodium.jar", reason: "own" });
  assert.deepEqual(plan([item("ferrite.jar", "ferritecore")]).get("ferrite-core"), { file: "ferrite.jar", reason: "own" }, "the jar's real id, not the slug");
  assert.deepEqual(plan([item("emb.jar", "embeddium")]).get("sodium"), { file: "emb.jar", reason: "conflict" });
  assert.deepEqual(plan([item("star.jar", "starlight")]).get("scalablelux"), { file: "star.jar", reason: "conflict" });
  assert.deepEqual(plan([item("OptiFine_1.21.1_HD_U_J1.jar", null)]).get("sodium"), { file: "OptiFine_1.21.1_HD_U_J1.jar", reason: "conflict" });
  assert.equal(plan([item("emb.jar", "embeddium", { enabled: false })]).has("sodium"), false, "a switched-off mod doesn't load, so it doesn't clash");
  assert.equal(plan([item("jei.jar", "jei")]).size, 0);
});

test("own copy: the pack doesn't look the mod up or download it", async () => {
  const mr = fakeModrinth();
  await ver(mr, "sodium", "0.6.0");
  const inst = await instanceWith();
  const out = await withPack(["sodium"], () => run(inst, mr, { skip: new Map([["sodium", { file: "emb.jar", reason: "conflict" }]]) }));
  assert.equal(mr.calls.length, 0);
  assert.deepEqual(out.installed, []);
  assert.equal(out.states.sodium.state, "stepped-aside");
  assert.match(await inst.log(), /Left Sodium out: you have emb\.jar, which can't run next to it/);
});

test("Forge duplicate id: Reminth's jar goes when one of the player's carries the same mod id", () => {
  const managed = { "embeddium-0.3.31.jar": { mod: "embeddium" } };
  const mods = [item("embeddium-0.3.31.jar", "embeddium"), item("Rubidium-mc1.20.1.jar", "rubidium")];
  const plan = minecraft.planStepAside({ mods, managed, tracked: new Set(), mcVersion: "1.20.1" });
  assert.deepEqual(plan.remove.map((r) => [r.file, r.reason]), [["embeddium-0.3.31.jar", "own"]]);
  const opti = minecraft.planStepAside({ mods: [item("sodium-1.jar", "sodium"), item("OptiFine_HD.jar", null)], managed: { "sodium-1.jar": { mod: "sodium" } }, tracked: new Set() });
  assert.deepEqual(opti.remove.map((r) => [r.file, r.reason]), [["sodium-1.jar", "conflict"]]);
});

/* ---------------- the player's choices about Reminth's jars ---------------- */

test("disabled twin: Reminth's jar switched off is remembered and not downloaded again", async () => {
  const mr = fakeModrinth();
  await ver(mr, "lithium", "0.2.0");
  const jar = await jarBytes({ id: "lithium", version: "0.1.0" });
  const inst = await instanceWith({ "lithium-0.1.0.jar.disabled": jar }, { manifest: { files: { "lithium-0.1.0.jar": { mod: "lithium" } } } });
  const out = await withPack(["lithium"], () => run(inst, mr));
  assert.equal(mr.calls.length, 0, "not even looked up");
  assert.deepEqual(await inst.list(), ["lithium-0.1.0.jar.disabled"], "no second copy");
  assert.equal(out.states.lithium.state, "switched-off-by-you");
  assert.equal((await inst.manifest()).optedOut.lithium.by, "disabled");
});

test("deleted: a Reminth jar the player removed is not put back", async () => {
  const mr = fakeModrinth();
  await ver(mr, "lithium", "0.2.0");
  const inst = await instanceWith({}, { manifest: { files: { "lithium-0.1.0.jar": { mod: "lithium" } } } });
  const out = await withPack(["lithium"], () => run(inst, mr));
  assert.deepEqual(await inst.list(), []);
  assert.equal(out.states.lithium.state, "switched-off-by-you");
  assert.equal((await inst.manifest()).optedOut.lithium.by, "deleted");
});

test("re-enable: switching the jar back on makes it Reminth's to update again", async () => {
  const mr = fakeModrinth();
  await ver(mr, "lithium", "0.2.0");
  const jar = await jarBytes({ id: "lithium", version: "0.1.0" });
  const inst = await instanceWith({ "lithium-0.1.0.jar": jar }, { manifest: { files: {}, optedOut: { lithium: { by: "disabled", file: "lithium-0.1.0.jar", at: "x" } } } });
  const detail = [];
  const out = await withPack(["lithium"], () => run(inst, mr, { detail, isOurs: () => true }));
  assert.deepEqual(out.installed, ["lithium-0.2.0.jar"]);
  const m = await inst.manifest();
  assert.deepEqual(m.optedOut, {});
  assert.equal(m.files["lithium-0.1.0.jar"].mod, "lithium", "the old copy is Reminth's again, so the tidy replaces it");
});

test("reset and pack off->on: both clear what the player switched off", async () => {
  const inst = await instanceWith({}, { manifest: { files: {}, optedOut: { sodium: { by: "deleted", file: "s.jar", at: "x" } }, skipped: { lithium: { asset: "l.jar", reason: "not-for-version", because: null } } } });
  assert.equal(await minecraft.resetPerformancePack(inst.instance), true);
  const m = await inst.manifest();
  assert.deepEqual(m.optedOut, {});
  assert.deepEqual(m.skipped, {});
  assert.equal(await minecraft.resetPerformancePack(inst.instance), false, "nothing left to reset");

  const inst2 = await instanceWith({}, { manifest: { files: {}, optedOut: { sodium: { by: "deleted", file: "s.jar", at: "x" } } } });
  await minecraft.tidyManagedMods(inst2.modsDir, [], { dropPerf: true });
  assert.deepEqual((await inst2.manifest()).optedOut, {}, "switching the pack off forgets the choice");
});

test("adoption: an older Reminth's pack jar the player disabled is remembered as switched off", async () => {
  const inst = await instanceWith({ "lithium-fabric-0.26.2+mc26.3.jar.disabled": await jarBytes({ id: "lithium", version: "0.26.2" }), "sodium-fabric-0.6.0+mc26.3.jar": await jarBytes({ id: "sodium", version: "0.6.0" }) });
  const adopted = await minecraft.adoptLegacyManagedMods(inst.gameDir, { perf: true, usedBefore: true });
  assert.deepEqual(adopted, ["sodium-fabric-0.6.0+mc26.3.jar"]);
  const m = await inst.manifest();
  assert.equal(m.optedOut.lithium.by, "disabled");
  assert.equal(m.optedOut.sodium, undefined);
});

/* ---------------- status ---------------- */

test("status: off, pending, installed, and the states the last run recorded", async () => {
  const inst = await instanceWith({ "sodium-0.6.0.jar": { id: "sodium" } }, { manifest: { files: { "sodium-0.6.0.jar": { mod: "sodium" } }, optedOut: { lithium: { by: "disabled", file: "l.jar", at: "x" } } } });
  const off = await minecraft.performancePackStatus({ ...inst.instance, performanceMods: false });
  assert.equal(off.enabled, false);
  assert.ok(off.mods.every((m) => m.state === "off"));

  const before = await minecraft.performancePackStatus(inst.instance);
  const by = (s) => Object.fromEntries(s.mods.map((m) => [m.slug, m.state]));
  assert.equal(by(before).sodium, "installed", "found on disk before any run was recorded");
  assert.equal(by(before).lithium, "switched-off-by-you");
  assert.equal(by(before)["ferrite-core"], "pending");

  await minecraft.recordPackRun(inst.gameDir, {
    mcVersion: "1.21.1",
    loader: "fabric",
    states: {
      sodium: { state: "installed", file: "sodium-0.6.0.jar", version: "0.6.0", detail: null },
      "ferrite-core": { state: "installed", file: "ferrite.jar", version: "1", detail: null },
      immediatelyfast: { state: "no-build", file: null, version: null, detail: "x" },
      entityculling: { state: "installed", file: "ec.jar", version: "1", detail: null },
      scalablelux: { state: "failed", file: null, version: null, detail: "y" },
    },
    aside: ["ferrite.jar"],
    held: ["ec.jar"],
  });
  const after = by(await minecraft.performancePackStatus(inst.instance));
  assert.equal(after.sodium, "installed");
  assert.equal(after["ferrite-core"], "stepped-aside");
  assert.equal(after.entityculling, "held-back");
  assert.equal(after.immediatelyfast, "no-build");
  assert.equal(after.scalablelux, "failed");
  assert.equal(after.lithium, "switched-off-by-you");

  const moved = by(await minecraft.performancePackStatus({ ...inst.instance, mcVersion: "1.21.4" }));
  assert.equal(moved["ferrite-core"], "pending", "a run for another Minecraft version doesn't count");
  const neo = await minecraft.performancePackStatus({ ...inst.instance, loader: "neoforge" });
  assert.equal(neo.enabled, false, "existing NeoForge instance: off");
  assert.ok(neo.mods.some((m) => m.slug === "modernfix"));
  const broken = await minecraft.performancePackStatus({ loader: "fabric", mcVersion: "1.21.1", gameDir: path.join(HOME, "does-not-exist") });
  assert.ok(broken.mods.every((m) => m.state === "pending"), "never throws");
});
