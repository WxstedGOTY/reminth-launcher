"use strict";
/**
 * Tests for "Update mods to fit <version>" (src/main/modsSync.js): which mods
 * count, that only stable builds are ever chosen, the "no build" list, the
 * copy of the old jars, and content.applyUpdates' releaseOnly option for the
 * dependencies an update pulls in.
 * No network: Modrinth and the compatibility check are fakes.
 * Run with: node --test test/mods-sync.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "reminth-modssync-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return "STUB_ELECTRON_MODSSYNC";
  return originalResolve.call(this, request, ...rest);
};
Module._cache.STUB_ELECTRON_MODSSYNC = { id: "STUB_ELECTRON_MODSSYNC", filename: "STUB_ELECTRON_MODSSYNC", loaded: true, exports: { safeStorage: { isEncryptionAvailable: () => false } } };

const modsSync = require("../src/main/modsSync");
const content = require("../src/main/content");
const modrinth = require("../src/main/modrinth");

const issue = (over) => ({ file: "a.jar", title: "A", projectId: "PA", severity: "blocked", reason: "wrong-mc", ...over });
const ver = (over) => ({
  id: "v" + Math.random().toString(16).slice(2, 8),
  project_id: "PA",
  version_number: "1.0",
  version_type: "release",
  game_versions: ["26.3"],
  loaders: ["fabric"],
  date_published: "2026-09-01T00:00:00Z",
  files: [{ primary: true, url: "https://cdn.modrinth.com/data/x/a-2.jar", filename: "a-2.jar", size: 10, hashes: { sha1: "1".repeat(40) } }],
  ...over,
});
const INST = { id: "i1", mcVersion: "26.3", loader: "fabric", gameDir: path.join(HOME, "inst") };

/* ---------------- which mods count ---------------- */

test("syncCandidates: mods for another version that stop the game, and mods for another loader", () => {
  const issues = [
    issue({ file: "a.jar" }),
    issue({ file: "b.jar", severity: "warn" }), // "may not load" by Modrinth's list only
    issue({ file: "c.jar", reason: "wrong-loader", severity: "warn" }),
    issue({ file: "d.jar", reason: "missing-dep" }),
    issue({ file: "e.jar", reason: "duplicate" }),
    issue({ file: "f.jar", reason: "conflict" }),
    issue({ file: null, reason: "wrong-mc" }), // a missing mod has no file
  ];
  assert.deepEqual(
    modsSync.syncCandidates(issues).map((i) => i.file),
    ["a.jar", "c.jar"]
  );
  assert.deepEqual(modsSync.syncCandidates(undefined), []);
  assert.deepEqual(modsSync.syncCandidates([null]), []);
});

/* ---------------- release-only choice ---------------- */

test("pickStableBuild: newest release for exactly this version and loader - never a beta or alpha", () => {
  const list = [
    ver({ id: "alpha", version_type: "alpha", date_published: "2026-09-30T00:00:00Z" }),
    ver({ id: "beta", version_type: "beta", date_published: "2026-09-20T00:00:00Z" }),
    ver({ id: "old", date_published: "2026-08-01T00:00:00Z" }),
    ver({ id: "new", date_published: "2026-09-10T00:00:00Z" }),
    ver({ id: "other-mc", game_versions: ["26.2"], date_published: "2026-09-29T00:00:00Z" }),
    ver({ id: "other-loader", loaders: ["neoforge"], date_published: "2026-09-29T00:00:00Z" }),
  ];
  assert.equal(modsSync.pickStableBuild(list, "26.3", ["fabric"]).id, "new");
  assert.equal(modsSync.pickStableBuild(list.slice(0, 2), "26.3", ["fabric"]), null, "only betas/alphas = nothing");
  assert.equal(modsSync.pickStableBuild([], "26.3", ["fabric"]), null);
  assert.equal(modsSync.pickStableBuild(null, "26.3", ["fabric"]), null);
  // Quilt takes Fabric builds
  assert.equal(modsSync.pickStableBuild([ver({ id: "q" })], "26.3", ["quilt", "fabric"]).id, "q");
});

test("buildUpdate: the shape applyUpdates takes; null without a usable file", () => {
  const u = modsSync.buildUpdate(issue({ file: "a-1.jar", title: "Alpha Mod" }), ver({ id: "V1", version_number: "2.0" }));
  assert.deepEqual(u, {
    kind: "mod",
    world: null,
    file: "a-1.jar",
    enabled: true,
    projectId: "PA",
    title: "Alpha Mod",
    iconUrl: null,
    current: null,
    next: { versionId: "V1", versionNumber: "2.0", url: "https://cdn.modrinth.com/data/x/a-2.jar", sha1: "1".repeat(40), filename: "a-2.jar", size: 10 },
  });
  assert.equal(modsSync.buildUpdate(issue(), ver({ files: [] })), null);
  assert.equal(modsSync.buildUpdate(issue(), ver({ files: [{ url: "u", filename: "f.jar", hashes: {} }] })), null, "no sha1, no download");
});

/* ---------------- the plan ---------------- */

function fakeDeps(versionsByProject, { issues, online = true, fail = new Set() } = {}) {
  const asked = [];
  return {
    asked,
    check: async () => ({ online, issues }),
    loadersFor: () => ["fabric"],
    api: {
      async getProjectVersions(pid, opts) {
        asked.push([pid, opts]);
        if (fail.has(pid)) throw new Error("Modrinth couldn't be reached");
        return versionsByProject[pid] || [];
      },
    },
  };
}

test("planSync: stable builds become updates; no stable build goes to the 'no build' list untouched", async () => {
  const issues = [
    issue({ file: "a-1.jar", title: "A", projectId: "PA" }),
    issue({ file: "b-1.jar", title: "B", projectId: "PB" }),
    issue({ file: "c-1.jar", title: "C", projectId: null }),
    issue({ file: "d-1.jar", title: "D", projectId: "PD", reason: "missing-dep" }), // not this button's
    issue({ file: "e-1.jar", title: "E", projectId: "PE" }),
  ];
  const deps = fakeDeps(
    {
      PA: [ver({ id: "A2", project_id: "PA" })],
      PB: [ver({ id: "B2b", project_id: "PB", version_type: "beta" })], // beta only
      PE: [ver({ id: "E1", project_id: "PE", files: [{ primary: true, url: "u", filename: "e-1.jar", hashes: { sha1: "2".repeat(40) } }] })],
    },
    { issues }
  );
  const plan = await modsSync.planSync(INST, deps);
  assert.equal(plan.count, 4);
  assert.equal(plan.online, true);
  assert.deepEqual(
    plan.updates.map((u) => [u.file, u.next.versionId]),
    [["a-1.jar", "A2"]]
  );
  assert.deepEqual(
    plan.noBuild.map((n) => [n.file, n.why]),
    [
      ["b-1.jar", "No stable build for 26.3 yet"],
      ["c-1.jar", "Not on Modrinth, so Reminth can't look for another build"],
      ["e-1.jar", "The newest stable build for 26.3 is the one you have"],
    ]
  );
  assert.deepEqual(plan.unchecked, []);
  // asked for exactly this version and loader; "PD" never asked
  assert.deepEqual(deps.asked.map((a) => a[0]).sort(), ["PA", "PB", "PE"]);
  for (const [, opts] of deps.asked) assert.deepEqual(opts, { loaders: ["fabric"], gameVersions: ["26.3"] });
});

test("planSync: Modrinth failing for a mod puts it in 'unchecked', never in 'no build'", async () => {
  const deps = fakeDeps({}, { issues: [issue({ projectId: "PX" })], fail: new Set(["PX"]) });
  const plan = await modsSync.planSync(INST, deps);
  assert.deepEqual(plan.unchecked.map((u) => u.file), ["a.jar"]);
  assert.deepEqual(plan.noBuild, []);
  assert.equal(plan.online, false);
});

test("planSync: vanilla and nothing-wrong instances plan nothing; one project is asked once", async () => {
  const deps = fakeDeps({}, { issues: [] });
  assert.deepEqual((await modsSync.planSync({ ...INST, loader: "vanilla" }, deps)).updates, []);
  assert.equal(deps.asked.length, 0);
  const plan = await modsSync.planSync(INST, deps);
  assert.equal(plan.count, 0);
  const twice = fakeDeps({ PA: [ver({ id: "A2" })] }, { issues: [issue({ file: "a-1.jar" }), issue({ file: "a-1-copy.jar" })] });
  const p2 = await modsSync.planSync(INST, twice);
  assert.equal(twice.asked.length, 1);
  assert.equal(p2.updates.length, 2);
});

/* ---------------- applying: old jars copied first ---------------- */

test("applySync: copies the old jars aside, applies with releaseOnly, reports the rest", async () => {
  const gameDir = path.join(HOME, "apply");
  await fsp.mkdir(path.join(gameDir, "mods"), { recursive: true });
  await fsp.writeFile(path.join(gameDir, "mods", "a-1.jar"), "old A");
  await fsp.writeFile(path.join(gameDir, "mods", "b-1.jar"), "old B");
  const deps = fakeDeps({ PA: [ver({ id: "A2" })] }, { issues: [issue({ file: "a-1.jar", title: "A" }), issue({ file: "b-1.jar", title: "B", projectId: "PB" })] });
  const applied = [];
  const invalidated = [];
  deps.applyUpdates = async (inst, updates, _p, options) => {
    applied.push({ updates, options });
    // the copy must already exist when the real update would delete the old jar
    const dirs = await fsp.readdir(path.join(gameDir, modsSync.BACKUP_DIR));
    assert.equal(await fsp.readFile(path.join(gameDir, modsSync.BACKUP_DIR, dirs[0], "a-1.jar"), "utf8"), "old A");
    return { applied: ["A"], failed: [], added: ["Lib"], warnings: [] };
  };
  deps.invalidate = (id) => invalidated.push(id);
  const r = await modsSync.applySync({ ...INST, gameDir }, null, deps);
  assert.equal(applied.length, 1);
  assert.deepEqual(applied[0].options, { releaseOnly: true });
  assert.deepEqual(applied[0].updates.map((u) => u.file), ["a-1.jar"]);
  assert.deepEqual(r.applied, ["A"]);
  assert.deepEqual(r.added, ["Lib"]);
  assert.deepEqual(r.noBuild.map((n) => n.file), ["b-1.jar"]);
  assert.ok(r.backupDir && r.backupDir.startsWith(path.join(gameDir, modsSync.BACKUP_DIR)));
  // the mod with no build was not copied, not touched
  assert.deepEqual(await fsp.readdir(r.backupDir), ["a-1.jar"]);
  assert.equal(await fsp.readFile(path.join(gameDir, "mods", "b-1.jar"), "utf8"), "old B");
  assert.deepEqual(invalidated, ["i1"]);
});

test("applySync: nothing to update means no copy and no applyUpdates call", async () => {
  const deps = fakeDeps({}, { issues: [issue({ projectId: "PB" })] });
  deps.applyUpdates = async () => assert.fail("must not be called");
  deps.invalidate = () => {};
  const r = await modsSync.applySync({ ...INST, gameDir: path.join(HOME, "none") }, null, deps);
  assert.equal(r.backupDir, null);
  assert.equal(r.noBuild.length, 1);
});

test("backupJars: finds a switched-off copy, refuses paths, keeps only the newest five folders", async () => {
  const gameDir = path.join(HOME, "bk");
  await fsp.mkdir(path.join(gameDir, "mods"), { recursive: true });
  await fsp.writeFile(path.join(gameDir, "mods", "x.jar.disabled"), "x");
  await fsp.writeFile(path.join(HOME, "outside.jar"), "no");
  let dir = null;
  for (let i = 0; i < 7; i++) dir = await modsSync.backupJars(gameDir, ["x.jar", "../../outside.jar"], new Date(Date.UTC(2026, 9, 3, 10, i)));
  assert.deepEqual(await fsp.readdir(dir), ["x.jar.disabled"]);
  assert.equal((await fsp.readdir(path.join(gameDir, modsSync.BACKUP_DIR))).length, 5);
  assert.equal(await modsSync.backupJars(gameDir, ["missing.jar"]), null);
});

/* ---------------- content: releaseOnly for what an update pulls in ---------------- */

test("content.applyUpdates releaseOnly: a dependency with only a beta for this version is left out, with a note", async () => {
  const gameDir = path.join(HOME, "deps");
  await fsp.mkdir(path.join(gameDir, "mods"), { recursive: true });
  await fsp.writeFile(path.join(gameDir, "mods", "a-1.jar"), "old");
  const inst = { id: "d", mcVersion: "26.3", loader: "fabric", gameDir };
  const real = { ...modrinth };
  const realFetch = global.fetch;
  const newJar = Buffer.from("new A jar");
  const sha1 = require("crypto").createHash("sha1").update(newJar).digest("hex");
  // the download of the new A
  global.fetch = async () => new Response(newJar, { status: 200, headers: { "content-length": String(newJar.length) } });
  Object.assign(modrinth, {
    getVersionsFromHashes: async () => ({}),
    getVersions: async () => [{ id: "A2", project_id: "PA", dependencies: [{ project_id: "PL", dependency_type: "required" }] }],
    getProject: async (pid) => ({ id: pid, title: pid === "PL" ? "Lib" : pid }),
    getProjectVersions: async (pid) => (pid === "PL" ? [{ id: "L1b", project_id: "PL", version_type: "beta", game_versions: ["26.3"], loaders: ["fabric"], files: [{ primary: true, url: "https://cdn.modrinth.com/l.jar", filename: "l.jar", hashes: { sha1: "3".repeat(40) } }] }] : []),
  });
  try {
    const update = { kind: "mod", world: null, file: "a-1.jar", enabled: true, projectId: "PA", title: "A", next: { versionId: "A2", versionNumber: "2", url: "https://cdn.modrinth.com/a-2.jar", sha1, filename: "a-2.jar", size: newJar.length } };
    const r = await content.applyUpdates(inst, [update], null, { releaseOnly: true });
    assert.deepEqual(r.applied, ["A"]);
    assert.deepEqual(r.added, [], "the beta-only library was not added");
    assert.ok(r.warnings.some((w) => /Lib has no stable build for Minecraft 26\.3/.test(w)), r.warnings.join(" | "));
    assert.equal(fs.existsSync(path.join(gameDir, "mods", "l.jar")), false);
  } finally {
    Object.assign(modrinth, real);
    global.fetch = realFetch;
  }
});
