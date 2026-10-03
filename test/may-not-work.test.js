"use strict";
/**
 * Prompt 9: mods that "may not work" - built for (listed for) another
 * Minecraft version - crashed the owner's game (AppleSkin built for 26.3 on
 * a 26.2 instance: NoSuchFieldError on the first HUD draw).
 *  - job A: the compatibility check marks them (listedElsewhere), and
 *    "Update mods to fit" swaps them too, stable builds only;
 *  - job B: the Play warning's pure rule (pure.js modWarning);
 *  - job C: the crash report parser and who it blames (crashReport.js).
 * Jars are real zips built here; Modrinth is a fake. No network.
 * Run with: node --test test/may-not-work.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "reminth-maynotwork-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return "STUB_ELECTRON_MAYNOTWORK";
  return originalResolve.call(this, request, ...rest);
};
Module._cache.STUB_ELECTRON_MAYNOTWORK = { id: "STUB_ELECTRON_MAYNOTWORK", filename: "STUB_ELECTRON_MAYNOTWORK", loaded: true, exports: { safeStorage: { isEncryptionAvailable: () => false } } };

const compat = require("../src/main/compat");
const modsSync = require("../src/main/modsSync");
const zip = require("../src/main/zip");

let seq = 0;
/** A Fabric jar with this fabric.mod.json and (optionally) extra files { name: text }. */
async function makeJar(out, json, files = {}) {
  const src = path.join(HOME, "src", `j${++seq}`);
  await fsp.mkdir(src, { recursive: true });
  await fsp.writeFile(path.join(src, "fabric.mod.json"), JSON.stringify({ schemaVersion: 1, ...json }));
  for (const [name, text] of Object.entries(files)) {
    await fsp.mkdir(path.dirname(path.join(src, name)), { recursive: true });
    await fsp.writeFile(path.join(src, name), text);
  }
  await fsp.mkdir(path.dirname(out), { recursive: true });
  await zip.buildZip(src, out);
  return out;
}

// AppleSkin as it was on the owner's PC: built for 26.3, its own range lets 26.2 load it.
const APPLESKIN_JSON = {
  id: "appleskin",
  name: "AppleSkin",
  version: "3.0.10+mc26.3",
  environment: "*",
  entrypoints: { main: ["squeek.appleskin.AppleSkin"], client: ["squeek.appleskin.client.AppleSkinClient"] },
  mixins: ["appleskin.mixins.json"],
  depends: { fabricloader: ">=0.15", minecraft: ">=1.21.9" },
};
const APPLESKIN_MIXINS = JSON.stringify({ required: true, package: "squeek.appleskin.mixin", client: ["HungerHudMixin"] });

async function instanceWith(id, mcVersion, builders) {
  const gameDir = path.join(HOME, "inst", id);
  await fsp.mkdir(path.join(gameDir, "mods"), { recursive: true });
  for (const [file, build] of Object.entries(builders)) await build(path.join(gameDir, "mods", file));
  return { id, gameDir, mcVersion, loader: "fabric", hud: false, performanceMods: false };
}

const sha = (c) => c.repeat(40);
const relFile = (name, c) => [{ primary: true, url: `https://cdn.modrinth.com/data/x/${name}`, filename: name, size: 5, hashes: { sha1: sha(c) } }];

function fakeModrinth({ found = {}, updates = {}, projectVersions = {} } = {}) {
  return {
    getVersionsFromHashes: async () => found,
    checkForUpdates: async () => updates,
    getProjects: async () => [],
    getProjectVersions: async (pid) => projectVersions[pid] || [],
  };
}
const checkDeps = (api) => ({
  hasOverrideFile: async () => false,
  managedNames: async () => new Set(),
  hashOf: async (item) => "h-" + item.file,
  readLaunchReport: async () => null,
  readCrashFinding: async () => null,
  modrinth: api,
});

/* ---------------- job A: the check marks them ---------------- */

test("judgeMod: a build listed only for a NEWER Minecraft is 'may not work' even when its own range allows this one", () => {
  const fab = { fabric: true, quilt: false, forge: false, neoforge: false };
  const inst = { mcVersion: "26.2", loader: "fabric" };
  const v = compat.judgeMod({ descriptors: fab, mcDep: ">=1.21.9" }, { game_versions: ["26.3"], loaders: ["fabric"] }, inst, ["fabric"], false);
  assert.equal(v.severity, "warn");
  assert.equal(v.reason, "wrong-mc");
  assert.equal(v.listedElsewhere, true);
  assert.match(v.detail, /listed for Minecraft 26\.3, not 26\.2/);
  // listed for older versions only and the jar says yes: still nothing (the rule from before)
  assert.equal(compat.judgeMod({ descriptors: fab, mcDep: ">=1.21" }, { game_versions: ["1.21", "1.21.1"], loaders: ["fabric"] }, { mcVersion: "1.21.4", loader: "fabric" }, ["fabric"], false), null);
  // listed for this version among others: nothing
  assert.equal(compat.judgeMod({ descriptors: fab, mcDep: ">=1.21.9" }, { game_versions: ["26.2", "26.3"], loaders: ["fabric"] }, inst, ["fabric"], false), null);
  // the jar doesn't say: the old "listed for" warning, now also marked
  assert.equal(compat.judgeMod({ descriptors: fab, mcDep: null }, { game_versions: ["1.20.1"], loaders: ["fabric"] }, inst, ["fabric"], false).listedElsewhere, true);
  // snapshots only, or a snapshot instance: nothing claimed
  assert.equal(compat.builtForNewerOnly(["26.3-snapshot-1"], "26.2"), false);
  assert.equal(compat.builtForNewerOnly(["26.3"], "26w14a"), false);
  assert.equal(compat.builtForNewerOnly(["1.21.11", "26.3"], "26.2"), false);
  assert.equal(compat.builtForNewerOnly(["26.3", "26.4"], "26.2"), true);
});

test("checkInstance: AppleSkin built for 26.3 on 26.2 -> 'may not work', fix = the stable 26.2 build", async () => {
  const inst = await instanceWith("appleskin-check", "26.2", {
    "appleskin-fabric-mc26.3-3.0.10.jar": (out) => makeJar(out, APPLESKIN_JSON, { "appleskin.mixins.json": APPLESKIN_MIXINS }),
  });
  const api = fakeModrinth({
    found: { "h-appleskin-fabric-mc26.3-3.0.10.jar": { id: "as263", project_id: "EsAfCjCV", version_number: "3.0.10+mc26.3", game_versions: ["26.3"], loaders: ["fabric"] } },
    updates: { "h-appleskin-fabric-mc26.3-3.0.10.jar": { id: "as262", project_id: "EsAfCjCV", version_number: "3.0.10+mc26.2", version_type: "release", files: relFile("appleskin-fabric-mc26.2-3.0.10.jar", "2") } },
  });
  const r = await compat.checkInstance(inst, { force: true, deps: checkDeps(api) });
  assert.equal(r.issues.length, 1);
  const i = r.issues[0];
  assert.deepEqual([i.title, i.severity, i.reason, i.listedElsewhere, i.madeFor], ["AppleSkin", "warn", "wrong-mc", true, "26.3"]);
  assert.equal(i.fix.type, "update");
  assert.equal(i.fix.label, "Switch to 3.0.10+mc26.2");
  assert.equal(r.blocked, 0);
  assert.equal(typeof r.modSet, "string");
  assert.match(r.modSet, /^[0-9a-f]{40}$/);
});

/* ---------------- job A: "Update mods to fit" counts and swaps them ---------------- */

const issue = (over) => ({ file: "a.jar", title: "A", projectId: "PA", severity: "blocked", reason: "wrong-mc", ...over });
const ver = (over) => ({
  id: "v" + Math.random().toString(16).slice(2, 8),
  project_id: "PA",
  version_number: "1.0",
  version_type: "release",
  game_versions: ["26.2"],
  loaders: ["fabric"],
  date_published: "2026-09-01T00:00:00Z",
  files: relFile("a-2.jar", "1"),
  ...over,
});

test("syncCandidates: 'may not work' mods listed for another version count; other warnings still don't", () => {
  const issues = [
    issue({ file: "blocked.jar" }),
    issue({ file: "appleskin.jar", severity: "warn", listedElsewhere: true }),
    issue({ file: "nested-maybe.jar", severity: "warn" }), // a "may load" nested copy: not this button's
    issue({ file: "missing.jar", severity: "warn", reason: "missing-dep", listedElsewhere: true }),
  ];
  assert.deepEqual(modsSync.syncCandidates(issues).map((i) => i.file), ["blocked.jar", "appleskin.jar"]);
});

test("planSync: AppleSkin swapped to its stable 26.2 build; one with only a beta is listed under 'no build', never removed", async () => {
  const issues = [
    issue({ file: "csc.jar", title: "Client Side Crystals", projectId: "PC" }),
    issue({ file: "appleskin-fabric-mc26.3-3.0.10.jar", title: "AppleSkin", projectId: "EsAfCjCV", severity: "warn", listedElsewhere: true }),
    issue({ file: "anchor.jar", title: "Anchor Optimizer", projectId: "PAO", severity: "warn", listedElsewhere: true }),
  ];
  const api = {
    getProjectVersions: async (pid) =>
      ({
        PC: [ver({ id: "C2", project_id: "PC", files: relFile("csc-26.2.jar", "3") })],
        EsAfCjCV: [
          ver({ id: "as262b", project_id: "EsAfCjCV", version_type: "beta", date_published: "2026-09-20", files: relFile("appleskin-beta.jar", "4") }),
          ver({ id: "as262", project_id: "EsAfCjCV", version_number: "3.0.10+mc26.2", files: relFile("appleskin-fabric-mc26.2-3.0.10.jar", "5") }),
        ],
        PAO: [ver({ id: "ao-b", project_id: "PAO", version_type: "beta", files: relFile("ao-beta.jar", "6") })],
      })[pid] || [],
  };
  const deps = { check: async () => ({ online: true, issues }), loadersFor: () => ["fabric"], api };
  const plan = await modsSync.planSync({ id: "i", mcVersion: "26.2", loader: "fabric" }, deps);
  assert.equal(plan.count, 3, "the button's number includes AppleSkin and Anchor Optimizer");
  assert.deepEqual(plan.updates.map((u) => [u.file, u.next.versionId]), [
    ["csc.jar", "C2"],
    ["appleskin-fabric-mc26.3-3.0.10.jar", "as262"],
  ]);
  assert.deepEqual(plan.noBuild.map((n) => [n.file, n.why]), [["anchor.jar", "No stable build for 26.2 yet"]]);
  // only some files (the Play warning's "Fix and play", a crash notice's "Fix it")
  const one = await modsSync.planSync({ id: "i", mcVersion: "26.2", loader: "fabric" }, deps, { files: ["appleskin-fabric-mc26.3-3.0.10.jar"] });
  assert.equal(one.count, 1);
  assert.deepEqual(one.updates.map((u) => u.next.versionId), ["as262"]);
});
