"use strict";
// Compatibility help (src/main/compat.js, migrate.js): pure rules plus the
// instance check with Modrinth and the file listing swapped for fakes.
// No network, no Electron, no npm packages.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");

const compat = require("../src/main/compat");
const migrate = require("../src/main/migrate");

test("fabricPredicateAllows: the forms Fabric mods actually use", () => {
  const cases = [
    [">=1.21", "1.21.4", true],
    [">=1.21.2", "1.21.1", false],
    ["~1.21.4", "1.21.5", true],
    ["~1.21.4", "1.22", false],
    ["1.21.x", "1.21.10", true],
    ["1.21.x", "1.20.6", false],
    ["1.x", "1.21", true],
    [["1.20.1", "1.20.4"], "1.20.4", true],
    [["1.20.1", "1.20.4"], "1.20.2", false],
    [">=1.21 <1.21.5", "1.21.5", false],
    [">=1.21 <1.21.5", "1.21.4", true],
    [">=1.21-", "1.21", true],
    ["<1.21.2-", "1.21.2", false],
    ["<1.21.2-", "1.21.1", true],
    ["1.21", "1.21", true],
    ["1.21", "1.21.1", false],
    ["*", "1.8.9", true],
    [">=1.20.5-alpha.24.14.a", "1.20.5", true],
    ["^1.21.4", "1.22", true],
    [">=26.1", "26.1.2", true],
    // the two-digit patch trap: 1.21.11 is newer than 1.21.2
    [">=1.21.11", "1.21.2", false],
    [">=1.21.2", "1.21.11", true],
  ];
  for (const [pred, mc, want] of cases) assert.equal(compat.fabricPredicateAllows(pred, mc), want, `${JSON.stringify(pred)} on ${mc}`);
});

test("fabricPredicateAllows: says nothing when it can't be sure", () => {
  assert.equal(compat.fabricPredicateAllows("some-string", "1.21"), null);
  assert.equal(compat.fabricPredicateAllows(">=1.21", "24w14a"), null); // snapshot instance
  assert.equal(compat.fabricPredicateAllows([], "1.21"), null);
  assert.equal(compat.fabricPredicateAllows([5], "1.21"), null);
  // one alternative unreadable, the other clearly no -> still unknown
  assert.equal(compat.fabricPredicateAllows(["weird", "1.20.1"], "1.21"), null);
  // a readable failing term settles its alternative even next to an unreadable one
  assert.equal(compat.fabricPredicateAllows("weird <1.20", "1.21"), false);
});

test("versionSatisfies: mod versions with build metadata and pre-releases", () => {
  assert.equal(compat.versionSatisfies("0.6.13", "0.6.13+mc1.21.4"), true);
  assert.equal(compat.versionSatisfies("0.6.13", "0.6.5+mc1.21.4"), false);
  assert.equal(compat.versionSatisfies(">=0.6.0 <0.7", "0.6.13+mc1.21.4"), true);
  assert.equal(compat.versionSatisfies("~0.6.0", "0.6.9"), true);
  assert.equal(compat.versionSatisfies(">=1.0.0-beta.2", "1.0.0-beta.10"), true);
  assert.equal(compat.versionSatisfies(">=1.0.0", "1.0.0-rc.1"), false);
  assert.equal(compat.versionSatisfies(">=0.5", "mc1.21-0.6"), null); // not a readable version
  assert.equal(compat.versionSatisfies("*", "${version}"), true); // "any" needs no reading
  assert.equal(compat.versionSatisfies(">=1", undefined), null);
  // To Fabric "v1.2.3" is a word, not the number 1.2.3: nothing is claimed
  // about it (this used to read as 1.2.3 and call ">=2" a certain failure).
  assert.equal(compat.versionSatisfies(">=2", "v1.2.3"), null);
  assert.equal(compat.versionSatisfies(">=v1.0", "1.2.3"), null);
  assert.equal(compat.versionSatisfies("*", "v1.2.3"), true);
  assert.deepEqual(compat.findDependencyProblems([{ file: "a.jar", modId: "a", depends: { b: ">=2" } }, { file: "b.jar", modId: "b", modVersion: "v1.2.3" }]), []);
});

test("compareMcVersionsDesc / summariseVersions: newest first, releases only", () => {
  assert.deepEqual(["1.20.1", "1.21.10", "1.21.2", "24w10a", "1.21"].sort(compat.compareMcVersionsDesc), ["1.21.10", "1.21.2", "1.21", "1.20.1", "24w10a"]);
  assert.equal(compat.summariseVersions(["1.21", "1.21.1", "1.21.3", "1.20.1", "1.19", "24w10a"]), "1.21.3, 1.21.1, 1.21, 1.20.1 +1 more");
  assert.equal(compat.summariseVersions(["1.21.1"]), "1.21.1");
});

test("versionsFromServerText: what servers put in their status", () => {
  assert.deepEqual(compat.versionsFromServerText("Velocity 1.7.2-1.21.4"), { list: null, min: "1.7.2", max: "1.21.4" });
  assert.deepEqual(compat.versionsFromServerText("Paper 1.21.4"), { list: ["1.21.4"], min: null, max: null });
  assert.deepEqual(compat.versionsFromServerText("BungeeCord 1.8.x-1.21.x"), { list: null, min: "1.8", max: "1.21.99" });
  assert.deepEqual(compat.versionsFromServerText("1.20.x"), { list: null, min: "1.20", max: "1.20.99" });
  assert.deepEqual(compat.versionsFromServerText("Requires MC 1.8 / 1.21"), { list: ["1.8", "1.21"], min: null, max: null });
  // a proxy's own version number is not a game version
  assert.equal(compat.versionsFromServerText("Velocity 3.3.0-SNAPSHOT"), null);
  assert.equal(compat.versionsFromServerText("Waterfall"), null);
  assert.equal(compat.versionsFromServerText(null), null);
});

test("versionsFromServerText: build numbers, open ends, two-part upper ends and colour codes", () => {
  // the number after the dash is the Forge build, not a Minecraft version
  assert.deepEqual(compat.versionsFromServerText("Mohist 1.20.1-47.3.5"), { list: ["1.20.1"], min: null, max: null });
  assert.equal(compat.serverAccepts(compat.versionsFromServerText("Mohist 1.20.1-47.3.5"), "1.21.4"), false);
  // "or newer" has no upper end
  const plus = compat.versionsFromServerText("1.20.4+");
  assert.deepEqual(plus, { list: null, min: "1.20.4", max: null });
  assert.equal(compat.serverAccepts(plus, "1.21.4"), true);
  assert.equal(compat.serverAccepts(plus, "1.20.4"), true);
  assert.equal(compat.serverAccepts(plus, "1.20.1"), false);
  assert.equal(compat.serverAccepts(plus, "24w10a"), null);
  // "up to 1.21" includes 1.21's patches
  const purpur = compat.versionsFromServerText("Purpur 1.20-1.21");
  assert.deepEqual(purpur, { list: null, min: "1.20", max: "1.21.99" });
  assert.equal(compat.serverAccepts(purpur, "1.21.4"), true);
  assert.equal(compat.serverAccepts(purpur, "1.22"), false);
  // colour codes are decoration
  assert.deepEqual(compat.versionsFromServerText("§a1.8 §7to §a1.21.4"), { list: null, min: "1.8", max: "1.21.4" });
  assert.deepEqual(compat.versionsFromServerText("§6Paper §f1.21.4"), { list: ["1.21.4"], min: null, max: null });
  // the year-numbered versions still read as versions
  assert.deepEqual(compat.versionsFromServerText("ViaVersion 1.8-26.1"), { list: null, min: "1.8", max: "26.1.99" });
});

test("serverAccepts: lists, ranges and 'no idea'", () => {
  assert.equal(compat.serverAccepts(["1.21.4"], "1.21.4"), true);
  assert.equal(compat.serverAccepts(["1.21.4"], "1.21.1"), false);
  assert.equal(compat.serverAccepts([], "1.21.1"), null);
  assert.equal(compat.serverAccepts(null, "1.21.1"), null);
  const range = compat.versionsFromServerText("BungeeCord 1.8.x-1.21.x");
  assert.equal(compat.serverAccepts(range, "1.21.11"), true);
  assert.equal(compat.serverAccepts(range, "1.7.10"), false);
  assert.equal(compat.serverAccepts(range, "24w10a"), null);
});

test("judgeMod: the jar's own word beats Modrinth's list", () => {
  const inst = { mcVersion: "1.21.4", loader: "fabric" };
  const fab = { fabric: true, quilt: false, forge: false, neoforge: false };
  // jar says no -> blocked, whatever Modrinth lists
  const blocked = compat.judgeMod({ descriptors: fab, mcDep: "~1.21.1" }, { game_versions: ["1.21.4"], loaders: ["fabric"] }, inst, ["fabric"], false);
  assert.equal(blocked, null); // ~1.21.1 allows 1.21.4 (same minor) - not blocked
  const really = compat.judgeMod({ descriptors: fab, mcDep: "1.21.1" }, { game_versions: ["1.21.4"], loaders: ["fabric"] }, inst, ["fabric"], false);
  assert.equal(really.severity, "blocked");
  assert.equal(really.reason, "wrong-mc");
  // jar says yes, Modrinth's list is just short -> nothing reported
  assert.equal(compat.judgeMod({ descriptors: fab, mcDep: ">=1.21" }, { game_versions: ["1.21", "1.21.1"], loaders: ["fabric"] }, inst, ["fabric"], false), null);
  // jar doesn't say, Modrinth lists other versions -> a warning only
  const warn = compat.judgeMod({ descriptors: fab, mcDep: null }, { game_versions: ["1.20.1"], loaders: ["fabric"] }, inst, ["fabric"], false);
  assert.equal(warn.severity, "warn");
  // nothing known at all -> nothing claimed
  assert.equal(compat.judgeMod({ descriptors: fab, mcDep: null }, null, inst, ["fabric"], false), null);
  assert.equal(compat.judgeMod({}, null, inst, ["fabric"], false), null);
});

test("judgeMod / wrongLoaderFamily: a Forge jar in a Fabric instance and the reverse", () => {
  const forgeJar = { fabric: false, quilt: false, forge: true, neoforge: false };
  const fabricJar = { fabric: true, quilt: false, forge: false, neoforge: false };
  const both = { fabric: true, quilt: false, forge: true, neoforge: true };
  assert.equal(compat.wrongLoaderFamily(forgeJar, "fabric", false), true);
  assert.equal(compat.wrongLoaderFamily(forgeJar, "quilt", false), true);
  assert.equal(compat.wrongLoaderFamily(fabricJar, "neoforge", false), true);
  assert.equal(compat.wrongLoaderFamily(fabricJar, "neoforge", true), false); // Connector installed
  assert.equal(compat.wrongLoaderFamily(both, "fabric", false), false);
  assert.equal(compat.wrongLoaderFamily(both, "forge", false), false);
  assert.equal(compat.wrongLoaderFamily(null, "fabric", false), false);
  assert.equal(compat.wrongLoaderFamily({ fabric: false, quilt: false, forge: false, neoforge: false }, "fabric", false), false); // a plain library jar
  const v = compat.judgeMod({ descriptors: forgeJar }, null, { mcVersion: "1.21.4", loader: "fabric" }, ["fabric"], false);
  assert.equal(v.reason, "wrong-loader");
  assert.equal(v.severity, "warn");
});

test("findDependencyProblems: wrong version, breaks, duplicates - and silence when unsure", () => {
  const mods = [
    { file: "iris.jar", modId: "iris", modVersion: "1.8.1", depends: { sodium: "0.6.5", minecraft: "1.21.1", "fabric-resource-loader-v0": "*", missingthing: ">=2" }, breaks: { optifabric: "*" } },
    { file: "sodium.jar", modId: "sodium", modVersion: "0.6.13+mc1.21.1", modifiedAt: 1 },
    { file: "opti.jar", modId: "optifabric", modVersion: "${version}" },
    { file: "sodium-copy.jar", modId: "sodium", modVersion: "0.6.13+mc1.21.1", modifiedAt: 5 },
  ];
  const got = compat.findDependencyProblems(mods);
  assert.deepEqual(got.map((p) => [p.kind, p.file, p.targetFile]), [
    // two copies of the same version: the newer file is the one named
    ["depends", "iris.jar", "sodium-copy.jar"],
    ["breaks", "iris.jar", "opti.jar"],
    ["duplicate", "sodium.jar", "sodium-copy.jar"],
  ]);
  // a second copy at the right version satisfies the demand
  const ok = compat.findDependencyProblems([mods[0], mods[1], { file: "s2.jar", modId: "sodium", modVersion: "0.6.5" }]);
  assert.equal(ok.some((p) => p.kind === "depends"), false);
  // an unreadable version is never called wrong
  assert.deepEqual(compat.findDependencyProblems([{ file: "a.jar", modId: "a", depends: { b: ">=2" } }, { file: "b.jar", modId: "b", modVersion: "beta-build" }]), []);
  // provided ids count
  assert.deepEqual(compat.findDependencyProblems([{ file: "a.jar", modId: "a", depends: { api: ">=2" } }, { file: "b.jar", modId: "b", modVersion: "2.1.0", provides: ["api"] }]), []);
  // a nested jar may be supplying it -> reported, but not as certain
  const maybe = compat.findDependencyProblems([
    { file: "a.jar", modId: "a", depends: { "cloth-config": ">=15" }, nested: ["META-INF/jars/cloth-config-fabric-15.0.jar"] },
    { file: "c.jar", modId: "cloth-config", modVersion: "11.0.0" },
  ]);
  assert.equal(maybe[0].certain, false);
});

test("findDependencyProblems: of two copies only the one Fabric loads is judged", () => {
  // The old copy asks for something that isn't met - but Fabric loads 2.0,
  // which is happy. This used to be a certain "won't start".
  const mods = [
    { file: "a-1.jar", modId: "a", modVersion: "1.0.0", modifiedAt: 9, depends: { lib: "<2" }, breaks: { other: "*" } },
    { file: "a-2.jar", modId: "a", modVersion: "2.0.0", modifiedAt: 1, depends: { lib: ">=2" } },
    { file: "lib.jar", modId: "lib", modVersion: "2.3.0" },
    { file: "other.jar", modId: "other", modVersion: "1.0.0" },
  ];
  const got = compat.findDependencyProblems(mods);
  assert.deepEqual(got.map((p) => [p.kind, p.file, p.targetFile]), [["duplicate", "a-1.jar", "a-2.jar"]]);
  // the higher VERSION is the one used, even though its file is older
  assert.equal(got[0].byVersion, true);
  assert.equal(got[0].used, "2.0.0");
  // when a version can't be read, which copy loads is a guess: reported, never as certain
  const unsure = compat.findDependencyProblems([
    { file: "a-old.jar", modId: "a", modVersion: "release-old", modifiedAt: 1, depends: { lib: "<2" } },
    { file: "a-new.jar", modId: "a", modVersion: "2.0.0", modifiedAt: 5, depends: { lib: ">=2" } },
    { file: "lib.jar", modId: "lib", modVersion: "2.3.0" },
  ]);
  const dep = unsure.find((p) => p.kind === "depends");
  assert.equal(dep.file, "a-old.jar");
  assert.equal(dep.certain, false);
  assert.equal(unsure.find((p) => p.kind === "duplicate").byVersion, false);
});

test("findDependencyProblems: a mod packed inside another counts like one in the folder", () => {
  const a = { file: "a.jar", modId: "a", modVersion: "1.0.0", depends: { b: ">=2" } };
  const rootB = { file: "b.jar", modId: "b", modVersion: "1.0.0" };
  // B 2.0 is packed inside C: Fabric loads that one, and A is satisfied.
  const c = { file: "c.jar", modId: "c", modVersion: "1.0.0", nestedMods: [{ id: "b", version: "2.0.0", provides: [] }] };
  assert.deepEqual(compat.findDependencyProblems([a, rootB, c]), []);
  // ... also when the packed mod only "provides" the id, or sits inside A itself
  assert.deepEqual(compat.findDependencyProblems([a, rootB, { ...c, nestedMods: [{ id: "bee", version: "2.0.0", provides: ["b"] }] }]), []);
  assert.deepEqual(compat.findDependencyProblems([{ ...a, nestedMods: [{ id: "b", version: "2.1.0" }] }, rootB]), []);
  // a packed copy that is ALSO too old: reported, against the newest copy there is
  const stillOld = compat.findDependencyProblems([a, rootB, { ...c, nestedMods: [{ id: "b", version: "1.5.0", provides: [] }] }]);
  assert.equal(stillOld.length, 1);
  assert.equal(stillOld[0].have, "1.5.0");
  assert.equal(stillOld[0].targetFile, "c.jar");
  assert.equal(stillOld[0].targetNested, true);
  assert.equal(stillOld[0].certain, true);
  // a packed copy whose version can't be read: nothing is claimed
  assert.deepEqual(compat.findDependencyProblems([a, rootB, { ...c, nestedMods: [{ id: "b", version: "${version}" }] }]), []);
  // a packed jar that couldn't be opened might hold anything: not certain
  const unread = compat.findDependencyProblems([a, rootB, { file: "d.jar", modId: "d", nestedUnread: true }]);
  assert.equal(unread.length, 1);
  assert.equal(unread[0].certain, false);
  // nothing packed anywhere: the plain case is still certain
  assert.equal(compat.findDependencyProblems([a, rootB])[0].certain, true);
});

test("findDependencyProblems: 'breaks' looks at the copy Fabric loads, packed ones included", () => {
  const a = { file: "a.jar", modId: "a", modVersion: "1.0.0", breaks: { b: "<2" } };
  const rootB = { file: "b.jar", modId: "b", modVersion: "1.0.0" };
  assert.equal(compat.findDependencyProblems([a, rootB])[0].kind, "breaks");
  // a newer B packed inside C is the one loaded - and A is fine with it
  const c = { file: "c.jar", modId: "c", nestedMods: [{ id: "b", version: "2.0.0" }] };
  assert.deepEqual(compat.findDependencyProblems([a, rootB, c]), []);
  // the other way round: the folder copy is fine, the packed (loaded) one clashes
  const hit = compat.findDependencyProblems([{ ...a, breaks: { b: ">=2" } }, rootB, c]);
  assert.deepEqual(hit.map((p) => [p.kind, p.targetFile, p.targetNested, p.have]), [["breaks", "c.jar", true, "2.0.0"]]);
  // one copy unreadable, one clashing: can't tell which loads -> not certain
  const mixed = compat.findDependencyProblems([a, rootB, { file: "c.jar", modId: "c", nestedMods: [{ id: "b", version: "nightly" }] }]);
  assert.equal(mixed.length, 1);
  assert.equal(mixed[0].certain, false);
});

test("findDependencyProblems: server-only mods, Quilt's own jars and non-Fabric loaders", () => {
  // Fabric skips a server-only mod on the client: its demands stop nothing,
  // it satisfies nothing, and it isn't a second copy of anything.
  const serverOnly = { file: "srv.jar", modId: "srv", modVersion: "1.0.0", environment: "server", depends: { lib: ">=9" }, breaks: { lib: "*" } };
  const lib = { file: "lib.jar", modId: "lib", modVersion: "1.0.0" };
  assert.deepEqual(compat.findDependencyProblems([serverOnly, lib]), []);
  assert.deepEqual(compat.findDependencyProblems([{ ...serverOnly, file: "srv2.jar" }, { ...serverOnly, environment: "*", depends: null, breaks: null }]), []);
  // the same jars with environment "*" or unset ARE judged
  assert.equal(compat.findDependencyProblems([{ ...serverOnly, environment: "*" }, lib]).length, 2);
  assert.equal(compat.findDependencyProblems([{ ...serverOnly, environment: undefined }, lib]).length, 2);
  // On Quilt a jar with a quilt.mod.json is read from that file, not fabric.mod.json
  const both = { file: "q.jar", modId: "q", modVersion: "1.0.0", descriptors: { fabric: true, quilt: true }, depends: { lib: ">=9" } };
  assert.deepEqual(compat.findDependencyProblems([both, lib], { loader: "quilt" }), []);
  assert.equal(compat.findDependencyProblems([both, lib], { loader: "fabric" }).length, 1);
  // Forge doesn't read fabric.mod.json at all - unless Connector is there. Duplicates always count.
  const dupe = { file: "lib-2.jar", modId: "lib", modVersion: "1.0.0" };
  const fabricMod = { file: "f.jar", modId: "f", modVersion: "1.0.0", depends: { lib: ">=9" } };
  assert.deepEqual(compat.findDependencyProblems([fabricMod, lib, dupe], { loader: "neoforge" }).map((p) => p.kind), ["duplicate"]);
  assert.deepEqual(compat.findDependencyProblems([fabricMod, lib, dupe], { loader: "neoforge", hasConnector: true }).map((p) => p.kind), ["depends", "duplicate"]);
});

test("judgeMod: server-only mods and Quilt's own jars aren't held to fabric.mod.json", () => {
  const fab = { fabric: true, quilt: false, forge: false, neoforge: false };
  const both = { fabric: true, quilt: true, forge: false, neoforge: false };
  const fabricInst = { mcVersion: "1.21.4", loader: "fabric" };
  const quiltInst = { mcVersion: "1.21.4", loader: "quilt" };
  assert.equal(compat.judgeMod({ descriptors: fab, mcDep: "1.20.1" }, null, fabricInst, ["fabric"], false).severity, "blocked");
  assert.equal(compat.judgeMod({ descriptors: fab, mcDep: "1.20.1", environment: "server" }, null, fabricInst, ["fabric"], false), null);
  assert.equal(compat.judgeMod({ descriptors: fab, mcDep: "1.20.1", environment: "client" }, null, fabricInst, ["fabric"], false).severity, "blocked");
  assert.equal(compat.judgeMod({ descriptors: both, mcDep: "1.20.1" }, null, quiltInst, ["quilt", "fabric"], false), null);
  assert.equal(compat.judgeMod({ descriptors: both, mcDep: "1.20.1" }, null, fabricInst, ["fabric"], false).severity, "blocked");
  assert.equal(compat.judgeMod({ descriptors: fab, mcDep: "1.20.1" }, null, quiltInst, ["quilt", "fabric"], false).severity, "blocked");
});

test("rankVersions: fits-everything first, the server first of all, loader builds respected", () => {
  const mods = [
    { title: "A", versions: new Set(["1.21.4", "1.21.1", "1.20.1"]) },
    { title: "B", versions: new Set(["1.21.1", "1.20.1"]) },
    { title: "C", versions: new Set(["1.21.4", "1.21.1"]) },
    { title: "Lost", versions: null },
  ];
  const plain = compat.rankVersions(mods, { current: "1.21.4" });
  assert.equal(plain[0].version, "1.21.1");
  assert.equal(plain[0].supported, 3);
  assert.equal(plain[0].total, 3); // the one that couldn't be looked up isn't counted
  const cur = plain.find((r) => r.current);
  assert.deepEqual(cur.missing, ["B"]);
  // the server only takes 1.20.1 -> that row leads even with fewer mods
  const srv = compat.rankVersions(mods, { current: "1.21.4", accepts: ["1.20.1"] });
  assert.equal(srv[0].version, "1.20.1");
  assert.equal(srv[0].server, true);
  assert.equal(srv[1].server, false);
  // a version the loader has no build for is never offered (the current one stays listed)
  const lv = compat.rankVersions(mods, { current: "1.21.4", loaderVersions: ["1.21.4", "1.20.1"] });
  assert.deepEqual(lv.map((r) => r.version).sort(), ["1.20.1", "1.21.4"]);
});

/* ---------------- checkInstance with fakes ---------------- */

function fakeInstance(id, extra = {}) {
  return { id, gameDir: path.join(os.tmpdir(), "reminth-compat-nope", id), mcVersion: "1.21.4", loader: "fabric", hud: false, performanceMods: false, ...extra };
}
const fab = { fabric: true, quilt: false, forge: false, neoforge: false };
function jar(file, extra = {}) {
  return { kind: "mod", file, valid: true, folder: false, enabled: true, size: 10, modifiedAt: 1, descriptors: fab, requires: [], ...extra };
}
function depsFor(mods, { found = {}, updates = {}, projects = [], managed = [], offline = false, override = false } = {}) {
  const calls = { hashes: 0, updates: 0 };
  return {
    calls,
    hasOverrideFile: async () => override,
    listAll: async () => ({ mod: mods, resourcepack: [], shader: [], datapack: [], worlds: [] }),
    managedNames: async () => new Set(managed),
    hashOf: async (item) => "h-" + item.file,
    modrinth: {
      getVersionsFromHashes: async () => {
        calls.hashes++;
        if (offline) throw new Error("fetch failed");
        return found;
      },
      checkForUpdates: async () => {
        calls.updates++;
        return updates;
      },
      getProjects: async (ids) => projects.filter((p) => ids.includes(p.id)),
      getProjectVersions: async () => [],
    },
  };
}

test("checkInstance: a mod built for another version gets a one-click swap", async () => {
  const mods = [jar("old.jar", { name: "Old Mod", mcDep: "1.21.1", modVersion: "1.0" }), jar("fine.jar", { name: "Fine", mcDep: ">=1.21" })];
  const deps = depsFor(mods, {
    found: { "h-old.jar": { id: "v1", project_id: "P1", version_number: "1.0", game_versions: ["1.21.1"], loaders: ["fabric"] } },
    updates: {
      "h-old.jar": { id: "v2", project_id: "P1", version_number: "1.4", files: [{ primary: true, url: "https://cdn.modrinth.com/x.jar", filename: "old-1.4.jar", size: 9, hashes: { sha1: "newhash" } }] },
    },
  });
  const r = await compat.checkInstance(fakeInstance("c1"), { force: true, deps });
  assert.equal(r.checked, 2);
  assert.equal(r.blocked, 1);
  assert.equal(r.issues.length, 1);
  const issue = r.issues[0];
  assert.equal(issue.file, "old.jar");
  assert.equal(issue.reason, "wrong-mc");
  assert.equal(issue.fix.type, "update");
  assert.equal(issue.fix.update.file, "old.jar");
  assert.equal(issue.fix.update.next.versionId, "v2");
  assert.equal(issue.fix.update.next.sha1, "newhash");
});

test("checkInstance: no matching build -> the only offer is to switch it off", async () => {
  const mods = [jar("old.jar", { mcDep: "1.20.1" })];
  const deps = depsFor(mods, { found: { "h-old.jar": { id: "v1", project_id: "P1", game_versions: ["1.20.1"], loaders: ["fabric"] } }, updates: {} });
  const r = await compat.checkInstance(fakeInstance("c2"), { force: true, deps });
  assert.equal(r.issues[0].fix.type, "disable");
});

test("checkInstance: offline still catches what the jar says itself, and isn't cached", async () => {
  const mods = [jar("old.jar", { mcDep: "<1.21" })];
  const deps = depsFor(mods, { offline: true });
  const inst = fakeInstance("c3");
  const r = await compat.checkInstance(inst, { deps });
  assert.equal(r.online, false);
  assert.equal(r.blocked, 1);
  await compat.checkInstance(inst, { deps });
  assert.equal(deps.calls.hashes, 2, "an offline result must be retried, not served from cache");
});

test("checkInstance: an unchanged folder is answered from cache; any change re-checks", async () => {
  const mods = [jar("a.jar", { mcDep: ">=1.21" })];
  const deps = depsFor(mods, { found: {} });
  const inst = fakeInstance("c4");
  await compat.checkInstance(inst, { deps });
  await compat.checkInstance(inst, { deps });
  assert.equal(deps.calls.hashes, 1);
  mods[0].modifiedAt = 2;
  await compat.checkInstance(inst, { deps });
  assert.equal(deps.calls.hashes, 2);
  await compat.checkInstance({ ...inst, mcVersion: "1.21.5" }, { deps });
  assert.equal(deps.calls.hashes, 3);
});

test("checkInstance: Fabric API missing is reported once, with who needs it", async () => {
  const mods = [jar("a.jar", { name: "Alpha", requires: ["fabric-api", "minecraft"] }), jar("b.jar", { name: "Beta", requires: ["fabric"] })];
  const r = await compat.checkInstance(fakeInstance("c5"), { force: true, deps: depsFor(mods) });
  const api = r.issues.filter((i) => i.reason === "missing-dep");
  assert.equal(api.length, 1);
  assert.equal(api[0].severity, "blocked");
  assert.deepEqual(api[0].neededBy, ["Alpha", "Beta"]);
  assert.equal(api[0].fix.type, "install");
  assert.equal(api[0].fix.projectId, "fabric-api");
  // present -> nothing
  const withApi = [...mods, jar("fabric-api-1.jar", { modId: "fabric-api" })];
  const r2 = await compat.checkInstance(fakeInstance("c5b"), { force: true, deps: depsFor(withApi) });
  assert.equal(r2.issues.length, 0);
  // Reminth brings it at launch when the HUD or the performance pack is on -> nothing
  const r3 = await compat.checkInstance(fakeInstance("c5c", { performanceMods: undefined }), { force: true, deps: depsFor(mods) });
  assert.equal(r3.issues.length, 0);
  const r3b = await compat.checkInstance(fakeInstance("c5d", { hud: true, performanceMods: false }), { force: true, deps: depsFor(mods) });
  assert.equal(r3b.issues.length, 0);
  // ... and with both switched off it really is missing
  const r3c = await compat.checkInstance(fakeInstance("c5e", { hud: false, performanceMods: false }), { force: true, deps: depsFor(mods) });
  assert.equal(r3c.blocked, 1);
  // a mod that "provides" the API, or one packed inside another mod, counts as having it
  const provided = [...mods, jar("forgified.jar", { modId: "ffapi", provides: ["fabric-api"] })];
  assert.equal((await compat.checkInstance(fakeInstance("c5f"), { force: true, deps: depsFor(provided) })).issues.length, 0);
  const packed = [...mods, jar("bundle.jar", { modId: "bundle", nestedMods: [{ id: "fabric-api", version: "0.100.0", provides: [] }] })];
  assert.equal((await compat.checkInstance(fakeInstance("c5g"), { force: true, deps: depsFor(packed) })).issues.length, 0);
  // a server-only mod's request for it stops nothing on the client
  const srv = [jar("srv.jar", { name: "Srv", requires: ["fabric-api"], environment: "server" })];
  assert.equal((await compat.checkInstance(fakeInstance("c5h"), { force: true, deps: depsFor(srv) })).issues.length, 0);
});

test("checkInstance: a dependency override file turns every jar-derived 'blocked' into a warning", async () => {
  const mods = [
    jar("old.jar", { name: "Old", modId: "old", mcDep: "1.20.1" }),
    jar("iris.jar", { name: "Iris", modId: "iris", depends: { sodium: "0.6.5" }, breaks: { opti: "*" } }),
    jar("sodium.jar", { name: "Sodium", modId: "sodium", modVersion: "0.6.13" }),
    jar("opti.jar", { name: "Opti", modId: "opti", modVersion: "1.0.0" }),
  ];
  const plain = await compat.checkInstance(fakeInstance("ov1"), { force: true, deps: depsFor(mods) });
  assert.deepEqual(plain.issues.map((i) => [i.reason, i.severity]).sort(), [["conflict", "blocked"], ["needs-version", "blocked"], ["wrong-mc", "blocked"]]);
  const over = await compat.checkInstance(fakeInstance("ov2"), { force: true, deps: depsFor(mods, { override: true }) });
  assert.equal(over.blocked, 0);
  assert.equal(over.warned, 3);
  for (const i of over.issues) assert.match(i.detail, / \(This instance has a dependency override file, so it may load anyway\.\)$/);
  // a missing Fabric API is read from the jars' "depends" too, so the file can drop it: a warning,
  // and its fix is still "Install" - never switching a working mod off
  const api = await compat.checkInstance(fakeInstance("ov3"), { force: true, deps: depsFor([jar("a.jar", { requires: ["fabric-api"] })], { override: true }) });
  assert.equal(api.blocked, 0);
  assert.deepEqual(api.issues.map((i) => [i.reason, i.severity, i.fix.type]), [["missing-dep", "warn", "install"]]);
  assert.match(api.issues[0].detail, /dependency override file/);
  // the real file on disk is what's looked for
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "reminth-override-"));
  await fsp.mkdir(path.join(root, "config"), { recursive: true });
  const d = depsFor([mods[0]]);
  delete d.hasOverrideFile;
  assert.equal((await compat.checkInstance({ ...fakeInstance("ov4"), gameDir: root }, { force: true, deps: d })).blocked, 1);
  await fsp.writeFile(path.join(root, "config", "fabric_loader_dependencies.json"), '{"version":1,"overrides":{}}');
  const withFile = await compat.checkInstance({ ...fakeInstance("ov4"), gameDir: root }, { deps: d });
  assert.equal(withFile.blocked, 0, "the file appearing must not be answered from the cache");
  assert.equal(withFile.warned, 1);
  await fsp.rm(root, { recursive: true, force: true });
});

test("checkInstance: the old copy of a mod, a packed copy and an unread jar never make a false 'blocked'", async () => {
  // old duplicate with a demand the loaded copy doesn't have
  const dupes = [
    jar("a-1.jar", { name: "A", modId: "a", modVersion: "1.0.0", modifiedAt: 9, depends: { lib: "<2" } }),
    jar("a-2.jar", { name: "A", modId: "a", modVersion: "2.0.0", modifiedAt: 1 }),
    jar("lib.jar", { name: "Lib", modId: "lib", modVersion: "2.3.0" }),
  ];
  const r1 = await compat.checkInstance(fakeInstance("d1"), { force: true, deps: depsFor(dupes) });
  assert.equal(r1.blocked, 0);
  assert.deepEqual(r1.issues.map((i) => [i.reason, i.file, i.severity]), [["duplicate", "a-1.jar", "warn"]]);
  assert.match(r1.issues[0].detail, /Only the higher version is used: a-2\.jar \(2\.0\.0\)\./);
  // a newer copy packed inside another mod satisfies the demand
  const packed = [
    jar("a.jar", { name: "A", modId: "a", depends: { b: ">=2" } }),
    jar("b.jar", { name: "B", modId: "b", modVersion: "1.0.0" }),
    jar("c.jar", { name: "C", modId: "c", nestedMods: [{ id: "b", version: "2.0.0", provides: [] }] }),
  ];
  assert.equal((await compat.checkInstance(fakeInstance("d2"), { force: true, deps: depsFor(packed) })).issues.length, 0);
  // a packed jar that couldn't be read: a warning, not a block
  const unread = [packed[0], packed[1], jar("c.jar", { name: "C", modId: "c", nestedUnread: true })];
  const r3 = await compat.checkInstance(fakeInstance("d3"), { force: true, deps: depsFor(unread) });
  assert.deepEqual(r3.issues.map((i) => [i.reason, i.severity]), [["needs-version", "warn"]]);
  // Reminth's own copy steps aside for the player's at launch: what it demands isn't judged
  const managed = [
    jar("sodium-reminth.jar", { modId: "sodium", modVersion: "0.5.0", depends: { lib: "<2" } }),
    jar("sodium-mine.jar", { name: "Sodium", modId: "sodium", modVersion: "0.6.0" }),
    jar("needs.jar", { name: "Needs", modId: "needs", depends: { sodium: ">=0.6" } }),
    jar("lib.jar", { name: "Lib", modId: "lib", modVersion: "2.3.0" }),
  ];
  const r4 = await compat.checkInstance(fakeInstance("d4"), { force: true, deps: depsFor(managed, { managed: ["sodium-reminth.jar"] }) });
  assert.equal(r4.issues.length, 0);
});

test("checkInstance: depends/breaks are Fabric's rules - not judged on Forge, nor for Quilt's own jars", async () => {
  const forge = { fabric: false, quilt: false, forge: true, neoforge: false };
  const both = { fabric: true, quilt: true, forge: false, neoforge: false };
  const onForge = [
    jar("multi.jar", { name: "Multi", modId: "multi", descriptors: { ...forge, fabric: true }, depends: { lib: ">=9" } }),
    jar("lib.jar", { name: "Lib", modId: "lib", modVersion: "1.0.0", descriptors: forge }),
  ];
  const r = await compat.checkInstance(fakeInstance("q1", { loader: "forge", mcVersion: "1.20.1" }), { force: true, deps: depsFor(onForge) });
  assert.equal(r.issues.length, 0);
  const onQuilt = [
    jar("q.jar", { name: "Q", modId: "q", descriptors: both, mcDep: "1.20.1", depends: { lib: ">=9" }, requires: ["fabric-api", "lib"] }),
    jar("lib.jar", { name: "Lib", modId: "lib", modVersion: "1.0.0" }),
  ];
  const rq = await compat.checkInstance(fakeInstance("q2", { loader: "quilt" }), { force: true, deps: depsFor(onQuilt) });
  assert.equal(rq.issues.length, 0);
  const rf = await compat.checkInstance(fakeInstance("q3", { loader: "fabric" }), { force: true, deps: depsFor(onQuilt) });
  assert.ok(rf.blocked >= 1);
});

test("checkInstance: Reminth's own jars are never reported, but count as installed", async () => {
  const mods = [
    jar("sodium-fabric-0.6.jar", { modId: "sodium", mcDep: "1.21.1", modVersion: "0.6.0" }), // would be "blocked" if it were the player's
    jar("user.jar", { name: "User Mod", modId: "user", depends: { sodium: ">=0.5" } }),
  ];
  const r = await compat.checkInstance(fakeInstance("c6"), { force: true, deps: depsFor(mods, { managed: ["sodium-fabric-0.6.jar"] }) });
  assert.equal(r.checked, 1);
  assert.equal(r.issues.length, 0);
});

test("checkInstance: a mod that needs a different build of another gets told exactly that", async () => {
  const mods = [
    jar("iris.jar", { name: "Iris", modId: "iris", depends: { sodium: "0.6.5" } }),
    jar("sodium.jar", { name: "Sodium", modId: "sodium", modVersion: "0.6.13+mc1.21.4" }),
  ];
  const found = {
    "h-iris.jar": { id: "vi", project_id: "IRIS", game_versions: ["1.21.4"], loaders: ["fabric"], dependencies: [{ project_id: "SOD", version_id: "sod065", dependency_type: "required" }] },
    "h-sodium.jar": { id: "vs", project_id: "SOD", game_versions: ["1.21.4"], loaders: ["fabric"] },
  };
  const r = await compat.checkInstance(fakeInstance("c7"), { force: true, deps: depsFor(mods, { found }) });
  const issue = r.issues.find((i) => i.reason === "needs-version");
  assert.ok(issue, "expected a needs-version issue");
  assert.equal(issue.file, "iris.jar");
  assert.equal(issue.severity, "blocked");
  assert.match(issue.detail, /Iris needs Sodium 0\.6\.5, but 0\.6\.13\+mc1\.21\.4 is installed/);
  assert.deepEqual(issue.fix, { type: "install", label: "Install the Sodium it needs", projectId: "SOD", versionId: "sod065", title: "Sodium" });
});

test("checkInstance: a mod Modrinth says is required but isn't there is a warning with an Install", async () => {
  const mods = [jar("a.jar", { name: "Alpha" })];
  const found = { "h-a.jar": { id: "va", project_id: "A", game_versions: ["1.21.4"], loaders: ["fabric"], dependencies: [{ project_id: "LIB", dependency_type: "required" }, { project_id: "OPT", dependency_type: "optional" }] } };
  const r = await compat.checkInstance(fakeInstance("c8"), { force: true, deps: depsFor(mods, { found, projects: [{ id: "LIB", slug: "lib", title: "Lib" }] }) });
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].reason, "missing-dep");
  assert.equal(r.issues[0].severity, "warn");
  assert.equal(r.issues[0].title, "Lib");
  assert.deepEqual(r.issues[0].fix, { type: "install", label: "Install Lib", projectId: "LIB", title: "Lib" });
});

test("checkInstance: a 'missing' mod that is really here under its id isn't reported", async () => {
  const dep = { project_id: "LIB", dependency_type: "required" };
  const found = { "h-a.jar": { id: "va", project_id: "A", game_versions: ["1.21.4"], loaders: ["fabric"], dependencies: [dep] } };
  const projects = [{ id: "LIB", slug: "cloth-config", title: "Cloth Config API" }];
  const a = jar("a.jar", { name: "Alpha" });
  const check = async (id, mods) => (await compat.checkInstance(fakeInstance(id), { force: true, deps: depsFor(mods, { found, projects }) })).issues;
  assert.equal((await check("m0", [a])).length, 1, "really missing -> reported");
  // a build Modrinth doesn't recognise, loaded under the same id (spelled either way)
  assert.equal((await check("m1", [a, jar("cloth.jar", { modId: "cloth_config" })])).length, 0);
  assert.equal((await check("m2", [a, jar("x.jar", { modId: "x", provides: ["cloth-config"] })])).length, 0);
  // packed inside another mod - read properly, or only guessable from the file name
  assert.equal((await check("m3", [a, jar("x.jar", { modId: "x", nestedMods: [{ id: "cloth-config", version: "15.0.0" }] })])).length, 0);
  assert.equal((await check("m4", [a, jar("x.jar", { modId: "x", nested: ["META-INF/jars/cloth-config-fabric-15.0.jar"] })])).length, 0);
  // a switched-off copy is NOT "already here"
  assert.equal((await check("m5", [a, jar("cloth.jar.disabled", { enabled: false, projectId: "LIB", modId: "cloth-config" })])).length, 1);
  // a loaded copy known by its project id still is
  assert.equal((await check("m6", [a, jar("cloth.jar", { projectId: "LIB" })])).length, 0);
});

test("checkInstance: vanilla, disabled mods and non-jars are left out", async () => {
  const mods = [jar("off.jar.disabled", { enabled: false, mcDep: "1.8" }), { ...jar("notes.txt"), valid: false }, { ...jar("folder"), folder: true }];
  const r = await compat.checkInstance(fakeInstance("c9"), { force: true, deps: depsFor(mods) });
  assert.equal(r.checked, 0);
  assert.equal(r.issues.length, 0);
  const v = await compat.checkInstance(fakeInstance("c9v", { loader: "vanilla" }), { force: true, deps: depsFor([jar("a.jar", { mcDep: "1.8" })]) });
  assert.equal(v.issues.length, 0);
});

test("checkInstance: Forge - a duplicate stops the game, a Fabric jar is flagged as not loading", async () => {
  const forge = { fabric: false, quilt: false, forge: true, neoforge: false };
  const mods = [
    jar("jei-1.jar", { modId: "jei", descriptors: forge, modifiedAt: 1 }),
    jar("jei-2.jar", { modId: "jei", descriptors: forge, modifiedAt: 9 }),
    jar("fabricmod.jar", { name: "Fab", descriptors: fab }),
  ];
  const r = await compat.checkInstance(fakeInstance("c10", { loader: "forge", mcVersion: "1.20.1" }), { force: true, deps: depsFor(mods) });
  const dup = r.issues.find((i) => i.reason === "duplicate");
  assert.equal(dup.file, "jei-1.jar"); // the older one
  assert.equal(dup.severity, "blocked");
  const wrong = r.issues.find((i) => i.reason === "wrong-loader");
  assert.equal(wrong.file, "fabricmod.jar");
});

/* ---------------- adviseVersions / projectSupport ---------------- */

test("adviseVersions: finds the version every mod (and the server) can use", async () => {
  const mods = [jar("a.jar", { name: "Alpha" }), jar("b.jar", { name: "Beta" }), jar("mine.jar", { name: "Homemade" })];
  const found = { "h-a.jar": { project_id: "A" }, "h-b.jar": { project_id: "B" } };
  const support = { A: ["1.21.4", "1.21.1", "1.20.1"], B: ["1.21.1", "1.20.1"] };
  const deps = depsFor(mods, { found });
  deps.modrinth.getProjectVersions = async (pid) => [{ game_versions: support[pid] }];
  const advice = await compat.adviseVersions(fakeInstance("a1"), { deps });
  assert.equal(advice.total, 2);
  assert.deepEqual(advice.unknown, ["Homemade"]);
  assert.equal(advice.best.version, "1.21.1");
  assert.deepEqual(advice.candidates.find((c) => c.current).missing, ["Beta"]);
  const withServer = await compat.adviseVersions(fakeInstance("a2"), { accepts: ["1.20.1"], deps });
  assert.equal(withServer.best.version, "1.20.1");
  assert.equal(withServer.best.server, true);
});

test("adviseVersions: one lookup failing doesn't sink the rest", async () => {
  const mods = [jar("a.jar", { name: "Alpha" }), jar("b.jar", { name: "Beta" })];
  const deps = depsFor(mods, { found: { "h-a.jar": { project_id: "A2" }, "h-b.jar": { project_id: "B2" } } });
  deps.modrinth.getProjectVersions = async (pid) => {
    if (pid === "B2") throw new Error("502");
    return [{ game_versions: ["1.21.4"] }];
  };
  const advice = await compat.adviseVersions(fakeInstance("a3"), { deps });
  assert.deepEqual(advice.failed, ["Beta"]);
  assert.equal(advice.total, 1);
  assert.equal(advice.best.version, "1.21.4");
});

test("adviseVersions / projectSupport: Modrinth not answering is said in its own words", async () => {
  const slow = new Error("Modrinth took too long to answer — check your connection and try again.");
  const mods = [jar("a.jar", { name: "Alpha" }), jar("b.jar", { name: "Beta" })];
  // the first request fails -> that error, untouched
  const d1 = depsFor(mods);
  d1.modrinth.getVersionsFromHashes = async () => { throw slow; };
  await assert.rejects(compat.adviseVersions(fakeInstance("t1"), { deps: d1 }), (err) => err === slow);
  // every per-mod lookup fails for that reason -> the error, not an empty "nothing fits"
  const d2 = depsFor(mods, { found: { "h-a.jar": { project_id: "TA" }, "h-b.jar": { project_id: "TB" } } });
  d2.modrinth.getProjectVersions = async () => { throw slow; };
  await assert.rejects(compat.adviseVersions(fakeInstance("t2"), { deps: d2 }), (err) => err === slow);
  await assert.rejects(compat.projectSupport({ mcVersion: "1.21.4", loader: "fabric" }, "X", { deps: d2 }), (err) => err === slow);
});

test("projectSupport: versions on this loader, the nearest one down, and other loaders", async () => {
  const deps = { modrinth: { getProjectVersions: async () => [
    { loaders: ["fabric"], game_versions: ["1.21.1", "1.21"] },
    { loaders: ["fabric"], game_versions: ["1.20.1", "24w10a"] },
    { loaders: ["neoforge"], game_versions: ["1.21.4"] },
  ] } };
  const s = await compat.projectSupport({ mcVersion: "1.21.4", loader: "fabric" }, "X", { deps });
  assert.deepEqual(s.here, ["1.21.1", "1.21", "1.20.1"]);
  assert.equal(s.nearest, "1.21.1");
  assert.deepEqual(s.otherLoaders, ["NeoForge"]);
  const none = await compat.projectSupport({ mcVersion: "1.21.4", loader: "forge" }, "X", { deps });
  assert.deepEqual(none.here, []);
  assert.equal(none.nearest, null);
});

/* ---------------- migrate.copyToVersion ---------------- */

test("copyToVersion: a new instance, settings carried, mods re-fetched, worlds and the original untouched", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "reminth-migrate-"));
  const from = path.join(root, "from");
  const to = path.join(root, "to");
  await fsp.mkdir(path.join(from, "saves", "World"), { recursive: true });
  await fsp.mkdir(path.join(from, "resourcepacks"), { recursive: true });
  await fsp.mkdir(path.join(from, "mods"), { recursive: true });
  await fsp.mkdir(path.join(from, ".reminth"), { recursive: true });
  await fsp.writeFile(path.join(from, "options.txt"), "fov:90");
  await fsp.writeFile(path.join(from, "resourcepacks", "pack.zip"), "zip");
  await fsp.writeFile(path.join(from, "mods", "a.jar"), "jar");
  await fsp.writeFile(path.join(from, ".reminth", "content.json"), "{}");
  await fsp.writeFile(path.join(from, "saves", "World", "level.dat"), "world");

  const manifest = { files: {} };
  const installs = [];
  const result = await migrate.copyToVersion(
    { id: "src", name: "Mine", loader: "fabric", hud: true, gameDir: from, mcVersion: "1.21.4" },
    { mcVersion: "1.21.1", name: null },
    {
      createInstance: async (fields) => {
        await fsp.mkdir(to, { recursive: true });
        return { id: "new", ...fields, gameDir: to };
      },
      listMods: async () => ({ mods: [{ projectId: "A", title: "Alpha" }, { projectId: "B", title: "Beta" }, { projectId: "DEP", title: "Dep" }, { projectId: null, title: "Lost" }], unknown: ["Homemade"] }),
      readManifest: async () => manifest,
      install: async (inst, req) => {
        installs.push(req.projectId);
        if (req.projectId === "B") throw new Error("Beta has no version for Minecraft 1.21.1 on Fabric.");
        manifest.files[req.projectId + ".jar"] = { projectId: req.projectId };
        if (req.projectId === "A") manifest.files["dep.jar"] = { projectId: "DEP" }; // came along as a dependency
      },
    },
    null
  );
  assert.equal(result.instance.name, "Mine 1.21.1");
  assert.equal(result.instance.loader, "fabric");
  assert.equal(result.instance.hud, true);
  assert.deepEqual(result.installed, ["Alpha", "Dep"]);
  assert.deepEqual(installs, ["A", "B"], "a mod already pulled in as a dependency isn't installed twice");
  assert.deepEqual(result.skipped, [{ title: "Beta", why: "No build for 1.21.1" }, { title: "Lost", why: "Couldn't be looked up" }]);
  assert.deepEqual(result.unknown, ["Homemade"]);
  assert.equal(await fsp.readFile(path.join(to, "options.txt"), "utf8"), "fov:90");
  assert.equal(fs.existsSync(path.join(to, "resourcepacks", "pack.zip")), true);
  assert.equal(fs.existsSync(path.join(to, "saves")), false, "worlds are never copied");
  assert.equal(fs.existsSync(path.join(to, "mods", "a.jar")), false, "old-version jars are never copied");
  assert.equal(fs.existsSync(path.join(to, ".reminth")), false);
  assert.equal(fs.existsSync(path.join(from, "saves", "World", "level.dat")), true);
  await fsp.rm(root, { recursive: true, force: true });
});

test("copyToVersion: if the mod list can't be read nothing is created", async () => {
  let created = false;
  await assert.rejects(
    migrate.copyToVersion(
      { id: "s", name: "Mine", loader: "fabric", gameDir: os.tmpdir(), mcVersion: "1.21.4" },
      { mcVersion: "1.21.1" },
      { createInstance: async () => { created = true; return {}; }, listMods: async () => { throw new Error("offline"); } },
      null
    ),
    /offline/
  );
  assert.equal(created, false);
});
