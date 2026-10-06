"use strict";
/**
 * Tests for what the compatibility check used to miss on a real instance
 * (Fabric 26.2 with mods built for 26.3), October 2026:
 *  - multi-version bundles (ClientSideCrystals, AnchorOptimizer): a fitting
 *    outer jar with one nested jar per Minecraft version, same mod id;
 *  - a config library packed inside JEI (MezzConfig) that needs 26.3;
 *  - the game's own "incompatible mods" report, parsed and remembered;
 *  - the panel's fixes switching only to stable builds (job D).
 * Jars are real zips built here; Modrinth is a fake. No network.
 * Run with: node --test test/compat-nested.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "reminth-compatnested-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return "STUB_ELECTRON_COMPATNESTED";
  return originalResolve.call(this, request, ...rest);
};
Module._cache.STUB_ELECTRON_COMPATNESTED = { id: "STUB_ELECTRON_COMPATNESTED", filename: "STUB_ELECTRON_COMPATNESTED", loaded: true, exports: { safeStorage: { isEncryptionAvailable: () => false } } };

const compat = require("../src/main/compat");
const content = require("../src/main/content");
const zip = require("../src/main/zip");

let seq = 0;
/** A Fabric jar: its fabric.mod.json, plus nested jars (each itself built with makeJar). */
async function makeJar(out, json, nested = []) {
  const src = path.join(HOME, "src", `j${++seq}`);
  await fsp.mkdir(path.join(src, "META-INF", "jars"), { recursive: true });
  const jars = [];
  for (const n of nested) {
    const name = `META-INF/jars/${path.basename(n)}`;
    await fsp.copyFile(n, path.join(src, name));
    jars.push({ file: name });
  }
  await fsp.writeFile(path.join(src, "fabric.mod.json"), JSON.stringify({ schemaVersion: 1, ...json, ...(jars.length ? { jars } : {}) }));
  await fsp.mkdir(path.dirname(out), { recursive: true });
  await zip.buildZip(src, out);
  return out;
}
const inner = (name, json) => makeJar(path.join(HOME, "inner", `${++seq}-${name}`), json);

/** An instance folder with these jars (file name -> builder) in mods/. */
async function instanceWith(id, mcVersion, builders) {
  const gameDir = path.join(HOME, "inst", id);
  await fsp.mkdir(path.join(gameDir, "mods"), { recursive: true });
  for (const [file, build] of Object.entries(builders)) await build(path.join(gameDir, "mods", file));
  return { id, gameDir, mcVersion, loader: "fabric", hud: false, performanceMods: false };
}

function deps(extra = {}) {
  const calls = { projectVersions: [] };
  return {
    calls,
    hasOverrideFile: async () => false,
    managedNames: async () => new Set(),
    hashOf: async (item) => "h-" + item.file,
    readLaunchReport: async () => null,
    modrinth: {
      getVersionsFromHashes: async () => extra.found || {},
      checkForUpdates: async () => extra.updates || {},
      getProjects: async () => [],
      getProjectVersions: async (pid, opts) => {
        calls.projectVersions.push([pid, opts]);
        return (extra.projectVersions || {})[pid] || [];
      },
    },
    ...extra.deps,
  };
}

// The two real shapes.
async function crystalsBundle(out) {
  const v = (mc) => inner(`csc-${mc}.jar`, { id: "clientsidecrystals", name: "Client Side Crystals", version: mc, depends: { minecraft: mc } });
  return makeJar(out, { id: "clientsidecrystals_bundle", name: "Client Side Crystals", version: "26.3", depends: { minecraft: ">=1.21 <=26.3", clientsidecrystals: "*" } }, [
    await v("1.21.11"),
    await v("26.1"),
    await v("26.2"),
    await v("26.3"),
  ]);
}
async function jeiWithMezz(out) {
  return makeJar(out, { id: "jei", name: "JEI", version: "26.3.0.1", depends: { minecraft: ">=26.2", mezz_config: ">=0.6.3 <1.0.0" } }, [
    await inner("mezz.jar", { id: "mezz_config", name: "MezzConfig", version: "0.6.6", depends: { minecraft: "26.3" } }),
  ]);
}

/* ---------------- what content reads ---------------- */

test("readJarMeta: nested jars carry their name and Minecraft requirement", async () => {
  const inst = await instanceWith("meta", "26.2", { "jei.jar": jeiWithMezz });
  const all = await content.listAll(inst.gameDir);
  const jei = all.mod.find((m) => m.file === "jei.jar");
  assert.deepEqual(jei.nestedMods, [{ id: "mezz_config", name: "MezzConfig", version: "0.6.6", provides: [], mcDep: "26.3" }]);
});

/* ---------------- the rule (pure) ---------------- */

test("findNestedMcProblems: a bundle with a copy for this version loads that copy (seen in the real game, 7 Oct 2026)", async () => {
  const inst = await instanceWith("bundle", "26.2", { "ClientSideCrystals-26.3.jar": crystalsBundle });
  const mods = (await content.listAll(inst.gameDir)).mod;
  // the real ClientSideCrystals-26.3.jar started on 26.2 with its 26.2 copy, and the 1.21.X-26.X one on 1.21.11
  for (const mc of ["26.2", "26.3", "1.21.11", "26.1"]) assert.deepEqual(compat.findNestedMcProblems(mods, { loader: "fabric", mcVersion: mc }), [], mc);
  // no copy for 1.21.10 (the outer jar's range allows it): it won't load
  const p = compat.findNestedMcProblems(mods, { loader: "fabric", mcVersion: "1.21.10" });
  assert.ok(p.length >= 1);
  assert.ok(p.every((x) => x.file === "ClientSideCrystals-26.3.jar" && x.id === "clientsidecrystals" && x.bundle && x.certain));
});

test("findNestedMcProblems: copies whose versions only differ after '+' are a tie - a warning, never 'blocked'", () => {
  const anchor = {
    file: "AnchorOptimizer-26.3.jar",
    modId: "client_side_anchors_bundle",
    modVersion: "1.0.6+26.3",
    mcDep: ">=26.1 <=26.3",
    descriptors: { fabric: true },
    depends: { client_side_anchors: "*" },
    nestedMods: ["26.1", "26.2", "26.3"].map((mc) => ({ id: "client_side_anchors", name: "Anchor Optimizer", version: `1.0.6+${mc}`, provides: [], mcDep: mc })),
  };
  const p = compat.findNestedMcProblems([anchor], { loader: "fabric", mcVersion: "26.2" });
  assert.equal(p.length, 1);
  assert.equal(p[0].certain, false, "1.0.6+26.2 and 1.0.6+26.3 are the same version to Fabric");
});

test("findNestedMcProblems: a packed library that needs 26.3 blocks its outer mod - unless a newer fitting copy is loaded", async () => {
  const inst = await instanceWith("jei", "26.2", { "jei-26.3-fabric.jar": jeiWithMezz });
  const mods = (await content.listAll(inst.gameDir)).mod;
  const p = compat.findNestedMcProblems(mods, { loader: "fabric", mcVersion: "26.2" });
  assert.deepEqual(
    p.map((x) => [x.file, x.id, x.name, x.need, x.bundle, x.certain]),
    [["jei-26.3-fabric.jar", "mezz_config", "MezzConfig", "26.3", false, true]]
  );
  // a newer MezzConfig in the folder that fits is the one Fabric loads
  const own = { file: "mezz-0.7.jar", modId: "mezz_config", modVersion: "0.7.0", mcDep: "26.2", descriptors: { fabric: true } };
  assert.deepEqual(compat.findNestedMcProblems([...mods, own], { loader: "fabric", mcVersion: "26.2" }), []);
  // ...an equal-version one that fits makes it uncertain
  const tie = { ...own, modVersion: "0.6.6" };
  assert.equal(compat.findNestedMcProblems([...mods, tie], { loader: "fabric", mcVersion: "26.2" })[0].certain, false);
  // a jar Fabric passes over (skip) carries nothing
  assert.deepEqual(compat.findNestedMcProblems(mods, { loader: "fabric", mcVersion: "26.2", skip: new Set(["jei-26.3-fabric.jar"]) }), []);
  // Forge/NeoForge don't read fabric.mod.json; a snapshot is never judged
  assert.deepEqual(compat.findNestedMcProblems(mods, { loader: "neoforge", mcVersion: "26.2" }), []);
  assert.deepEqual(compat.findNestedMcProblems(mods, { loader: "fabric", mcVersion: "26.3-snapshot-1" }), []);
});

test("findNestedMcProblems: packed copies nothing needs are left out by Fabric (BetterHurtCam 1.5.5 on 1.20.1 started fine)", () => {
  const bhc = {
    file: "betterhurtcam-1.5.5.jar",
    modId: "betterhurtcam",
    modVersion: "1.5.5",
    descriptors: { fabric: true },
    depends: { fabricloader: ">=0.13", ukulib: ">=0.3.0" },
    nestedMods: [
      { id: "betterhurtcam-mc118", version: "1.5.5", mcDep: "1.18.x" },
      { id: "betterhurtcam-mc1194", version: "1.5.5", mcDep: "1.19.4" },
      { id: "betterhurtcam-mc120", version: "1.5.5", mcDep: ">=1.20" },
    ],
  };
  assert.deepEqual(compat.findNestedMcProblems([bhc], { loader: "fabric", mcVersion: "1.20.1" }), []);
  // ...but a mod that needs one of them makes it count
  const fan = { file: "fan.jar", modId: "fan", modVersion: "1", descriptors: { fabric: true }, depends: { "betterhurtcam-mc118": "*" } };
  assert.equal(compat.findNestedMcProblems([bhc, fan], { loader: "fabric", mcVersion: "1.20.1" })[0].id, "betterhurtcam-mc118");
});

test("findNestedMcProblems: an unreadable packed jar that could be another copy keeps it a warning", () => {
  const jei = { file: "jei.jar", modId: "jei", modVersion: "1", descriptors: { fabric: true }, depends: { mezz_config: "*" }, nestedMods: [{ id: "mezz_config", version: "0.6.6", mcDep: "26.3" }] };
  const other = { file: "x.jar", modId: "x", modVersion: "1", descriptors: { fabric: true }, nestedUnread: true, nestedUnreadNames: ["META-INF/jars/mezz_config-0.8.jar"] };
  assert.equal(compat.findNestedMcProblems([jei, other], { loader: "fabric", mcVersion: "26.2" })[0].certain, false);
});

/* ---------------- in the full check, and for the button ---------------- */

test("checkInstance: a packed library for another version is 'won't load'; a bundle without a copy for this version too", async () => {
  const inst = await instanceWith("full", "26.2", { "ClientSideCrystals-26.3.jar": crystalsBundle, "jei-26.3-fabric.jar": jeiWithMezz });
  const r = await compat.checkInstance(inst, { force: true, deps: deps() });
  const by = Object.fromEntries(r.issues.map((i) => [i.file, i]));
  assert.equal(by["jei-26.3-fabric.jar"].severity, "blocked");
  assert.equal(by["jei-26.3-fabric.jar"].reason, "wrong-mc");
  assert.match(by["jei-26.3-fabric.jar"].detail, /^JEI contains MezzConfig, which needs Minecraft 26\.3 — this instance is on 26\.2\./);
  // the bundle has a 26.2 copy: fine
  assert.ok(!by["ClientSideCrystals-26.3.jar"] || by["ClientSideCrystals-26.3.jar"].reason !== "wrong-mc");
  // ...and "Update mods to fit" picks up only the one that really won't load
  const { syncCandidates } = require("../src/main/modsSync");
  assert.deepEqual(syncCandidates(r.issues).map((i) => i.file).sort(), ["jei-26.3-fabric.jar"]);

  const old = await instanceWith("full-12110", "1.21.10", { "ClientSideCrystals-26.3.jar": crystalsBundle });
  const r2 = await compat.checkInstance(old, { force: true, deps: deps() });
  const csc = r2.issues.find((i) => i.file === "ClientSideCrystals-26.3.jar");
  assert.equal(csc.severity, "blocked");
  assert.match(csc.detail, /carries a copy for several Minecraft versions, but none of them is for 1\.21\.10/);
});

/* ---------------- the game's own report ---------------- */

const REAL_LOG = [
  "[12:00:01] [main/INFO]: Loading Minecraft 26.2 with Fabric Loader 0.17.2",
  "[12:00:02] [main/ERROR]: Incompatible mods found!",
  "net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!",
  "A potential solution has been determined, this may resolve your problem:",
  "\t - Replace mod 'MezzConfig' (mezz_config) 0.6.6 with any version that is compatible with:",
  "\t\t - minecraft 26.2",
  "More details:",
  "\t - Mod 'Anchor Optimizer' (client_side_anchors) 1.0.6+26.3 requires version 26.3 of 'Minecraft', but only the wrong version is present: 26.2!",
  "\t - Mod 'Client Side Crystals' (clientsidecrystals) 26.3 requires version 26.3 of 'Minecraft', but only the wrong version is present: 26.2!",
  "\t - Mod 'MezzConfig' (mezz_config) 0.6.6 requires version 26.3 of 'Minecraft', but only the wrong version is present: 26.2!",
  "\t - Mod 'Needy' (needy) 1.0 requires any version of 'fabric-api', which is missing!",
  "\tat net.fabricmc.loader.impl.FormattedException.ofLocalized(FormattedException.java:51)",
].join("\r\n");

test("parseIncompatibleMods: the three real lines, the 'Replace mod' form, and nothing before the heading", () => {
  const all = compat.parseIncompatibleMods(REAL_LOG);
  assert.deepEqual(
    all.map((e) => [e.id, e.name, e.version]),
    [
      ["mezz_config", "MezzConfig", "0.6.6"],
      ["client_side_anchors", "Anchor Optimizer", "1.0.6+26.3"],
      ["clientsidecrystals", "Client Side Crystals", "26.3"],
      ["needy", "Needy", "1.0"],
    ]
  );
  assert.equal(all[0].why, "requires version 26.3 of 'Minecraft', but only the wrong version is present: 26.2!", "the 'requires' line wins");
  // only the Replace form
  const replaceOnly = compat.parseIncompatibleMods(
    "Some of your mods are incompatible with the game or each other!\n\t - Replace mod 'MezzConfig' (mezz_config) 0.6.6 with any version that is compatible with:\n\t\t - minecraft 26.2\n"
  );
  assert.deepEqual(replaceOnly, [{ id: "mezz_config", name: "MezzConfig", version: "0.6.6", why: "replace it with any version that is compatible with: minecraft 26.2" }]);
  // only the Minecraft ones are remembered as "won't load here"
  assert.deepEqual(
    compat.minecraftMismatches(all).map((e) => e.id),
    ["mezz_config", "client_side_anchors", "clientsidecrystals"]
  );
  // no heading: a chat line that looks like it is ignored
  assert.deepEqual(compat.parseIncompatibleMods("[CHAT] <bob> - Mod 'X' (x) 1 requires version 26.3 of 'Minecraft'"), []);
  assert.deepEqual(compat.parseIncompatibleMods(undefined), []);
});

test("mapReportToFiles: a mod id to its jar, a packed one to the outer jar; switched-off jars don't count", () => {
  const items = [
    { file: "AnchorOptimizer-26.3.jar", modId: "client_side_anchors_bundle", valid: true, enabled: true, size: 5, modifiedAt: 7, nestedMods: [{ id: "client_side_anchors", version: "1.0.6+26.3" }] },
    { file: "jei.jar", modId: "jei", name: "JEI", valid: true, enabled: true, size: 9, modifiedAt: 8, nestedMods: [{ id: "mezz_config", version: "0.6.6" }] },
    { file: "csc.jar", modId: "clientsidecrystals", valid: true, enabled: true, size: 3, modifiedAt: 2 },
    { file: "off.jar.disabled", modId: "clientsidecrystals", valid: true, enabled: false, size: 3, modifiedAt: 2 },
  ];
  const r = compat.mapReportToFiles(compat.minecraftMismatches(compat.parseIncompatibleMods(REAL_LOG)), items);
  assert.deepEqual(
    r.map((x) => [x.id, x.file, x.nestedIn, x.size, x.mtimeMs]),
    [
      ["mezz_config", "jei.jar", "JEI", 9, 8],
      ["client_side_anchors", "AnchorOptimizer-26.3.jar", "AnchorOptimizer-26.3", 5, 7],
      ["clientsidecrystals", "csc.jar", null, 3, 2],
    ]
  );
});

test("checkInstance: the game's report makes a mod 'won't load' until that exact file changes, and only for that version", async () => {
  const inst = await instanceWith("report", "26.2", {
    "AnchorOptimizer-26.3.jar": (out) => makeJar(out, { id: "client_side_anchors", name: "Anchor Optimizer", version: "1.0.6+26.3", depends: { minecraft: ">=26.1 <=26.3" } }),
  });
  const item = (await content.listAll(inst.gameDir)).mod[0];
  const report = { mcVersion: "26.2", loader: "fabric", mods: [{ id: "client_side_anchors", name: "Anchor Optimizer", why: "requires version 26.3 of 'Minecraft', but only the wrong version is present: 26.2!", file: item.file, size: item.size, mtimeMs: item.modifiedAt, nestedIn: null }] };
  const d = deps({ deps: { readLaunchReport: async () => report, hasOverrideFile: async () => true } });
  let r = await compat.checkInstance(inst, { force: true, deps: d });
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].severity, "blocked", "the game's own word isn't softened by an override file");
  assert.match(r.issues[0].detail, /stopped Minecraft from starting last time — the game said it requires version 26\.3 of 'Minecraft', but only the wrong version is present: 26\.2\.$/);
  // another version of the instance: the report doesn't apply
  r = await compat.checkInstance({ ...inst, id: "report-b", mcVersion: "26.3" }, { force: true, deps: d });
  assert.deepEqual(r.issues, []);
  // the file changed (a new build): forgotten
  await fsp.appendFile(path.join(inst.gameDir, "mods", item.file), "x");
  r = await compat.checkInstance({ ...inst, id: "report-c" }, { force: true, deps: d });
  assert.deepEqual(r.issues, []);
});

test("readLaunchReport: missing or broken file is null", async () => {
  const dir = path.join(HOME, "lr");
  assert.equal(await compat.readLaunchReport(dir), null);
  await fsp.mkdir(path.join(dir, ".reminth"), { recursive: true });
  await fsp.writeFile(path.join(dir, compat.LAUNCH_REPORT_FILE), "{nope");
  assert.equal(await compat.readLaunchReport(dir), null);
});

/* ---------------- job D: the panel's fixes are stable-only ---------------- */

test("checkInstance: a beta offered by Modrinth's update lookup is swapped for the newest release, or dropped", async () => {
  const fab = { fabric: true, quilt: false, forge: false, neoforge: false };
  const jar = (file, extra) => ({ kind: "mod", file, valid: true, folder: false, enabled: true, size: 10, modifiedAt: 1, descriptors: fab, requires: [], ...extra });
  const mods = [jar("a.jar", { name: "A", mcDep: "26.3", modVersion: "1" }), jar("b.jar", { name: "B", mcDep: "26.3", modVersion: "1" })];
  const file = (n) => [{ primary: true, url: `https://cdn.modrinth.com/${n}.jar`, filename: `${n}.jar`, size: 1, hashes: { sha1: n.padEnd(40, "0") } }];
  const d = deps({
    found: { "h-a.jar": { id: "a1", project_id: "PA", game_versions: ["26.3"], loaders: ["fabric"] }, "h-b.jar": { id: "b1", project_id: "PB", game_versions: ["26.3"], loaders: ["fabric"] } },
    updates: {
      "h-a.jar": { id: "a-beta", project_id: "PA", version_number: "2.0-beta", version_type: "beta", files: file("abeta") },
      "h-b.jar": { id: "b-alpha", project_id: "PB", version_number: "3.0-alpha", version_type: "alpha", files: file("balpha") },
    },
    projectVersions: {
      PA: [
        { id: "a-beta", project_id: "PA", version_number: "2.0-beta", version_type: "beta", game_versions: ["26.2"], loaders: ["fabric"], date_published: "2026-09-02", files: file("abeta") },
        { id: "a-rel", project_id: "PA", version_number: "1.9", version_type: "release", game_versions: ["26.2"], loaders: ["fabric"], date_published: "2026-08-01", files: file("arel") },
      ],
      PB: [{ id: "b-alpha", project_id: "PB", version_type: "alpha", game_versions: ["26.2"], loaders: ["fabric"], files: file("balpha") }],
    },
    deps: { listAll: async () => ({ mod: mods, resourcepack: [], shader: [], datapack: [], worlds: [] }) },
  });
  const r = await compat.checkInstance({ id: "stable", gameDir: path.join(HOME, "none"), mcVersion: "26.2", loader: "fabric", hud: false, performanceMods: false }, { force: true, deps: d });
  const by = Object.fromEntries(r.issues.map((i) => [i.file, i]));
  assert.equal(by["a.jar"].fix.type, "update");
  assert.equal(by["a.jar"].fix.update.next.versionId, "a-rel", "the release, not the newer beta");
  assert.equal(by["b.jar"].fix.type, "disable", "only an alpha exists: no automatic swap");
  assert.deepEqual(d.calls.projectVersions.map((c) => [c[0], c[1].gameVersions]).sort(), [["PA", ["26.2"]], ["PB", ["26.2"]]]);
});

test("content.checkUpdates: each update says its channel, so the list can tag a beta or alpha", async () => {
  const modrinth = require("../src/main/modrinth");
  const inst = await instanceWith("channels", "26.2", {
    "a.jar": (out) => makeJar(out, { id: "a", version: "1" }),
    "b.jar": (out) => makeJar(out, { id: "b", version: "1" }),
  });
  const real = { ...modrinth };
  const v = (id, type) => ({ id, project_id: "P" + id, version_number: "2", version_type: type, files: [{ primary: true, url: "https://cdn.modrinth.com/" + id, filename: id + ".jar", hashes: { sha1: id.padEnd(40, "f") } }] });
  Object.assign(modrinth, {
    getVersionsFromHashes: async () => ({}),
    getProjects: async () => [],
    checkForUpdates: async (hashes) => Object.fromEntries(hashes.map((h, i) => [h, v(i ? "bb" : "aa", i ? "release" : "beta")])),
  });
  try {
    const ups = await content.checkUpdates(inst);
    assert.deepEqual(ups.map((u) => u.next.channel).sort(), ["beta", "release"]);
  } finally {
    Object.assign(modrinth, real);
  }
});
