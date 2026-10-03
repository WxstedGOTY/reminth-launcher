"use strict";
/**
 * Prompt 11: "Pick a Minecraft version for my mods".
 *  - the pure rules in renderer/pure.js: which versions come first, the
 *    plain-word mod groups, which choice (switch this instance / make a new
 *    one) is allowed and recommended;
 *  - the main-process "switch this instance" operation (main/versionSwitch.js)
 *    with stubs for each step that can fail;
 *  - the "turned off by Reminth" reasons kept in content.json.
 * No network, no Electron.
 * Run with: node --test test/version-flow.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "reminth-versionflow-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return "STUB_ELECTRON_VERSIONFLOW";
  return originalResolve.call(this, request, ...rest);
};
Module._cache.STUB_ELECTRON_VERSIONFLOW = { id: "STUB_ELECTRON_VERSIONFLOW", filename: "STUB_ELECTRON_VERSIONFLOW", loaded: true, exports: { safeStorage: { isEncryptionAvailable: () => false } } };

const pure = require("../src/renderer/pure");

/* ---------------- job 1: the list and the groups ---------------- */

// 29 mods like the owner's instance: 26 known to Modrinth, 2 not from Modrinth, 1 lookup that failed.
const titles = Array.from({ length: 26 }, (_, i) => `Mod ${i + 1}`);
const advice = (candidates) => ({ total: 26, mods: titles.map((title, i) => ({ projectId: "P" + i, title })), unknown: ["Own Mod", "Old Jar"], failed: ["Flaky"], candidates });
const row = (version, missing = [], extra = {}) => ({ version, total: 26, supported: 26 - missing.length, missing, server: null, current: false, ...extra });

test("rankVersionRows: fewest mods without a build first, then the newest; the current version is never 'best'", () => {
  const { rows, best } = pure.rankVersionRows([
    row("1.21.4", ["Mod 1", "Mod 2", "Mod 3"]),
    row("26.2", [], { current: true }),
    row("1.21.1", []),
    row("26.1", ["Mod 1"]),
    row("1.20.1", []),
  ]);
  assert.deepEqual(rows.map((r) => r.version), ["26.2", "1.21.1", "1.20.1", "26.1", "1.21.4"]);
  assert.equal(best.version, "1.21.1");
  assert.equal(pure.bestLine(best, "switch"), "Best match: 1.21.1 — all 26 mods fit");
  // nothing perfect
  const partial = pure.rankVersionRows([row("26.3", ["A", "B"]), row("1.21.4", ["A", "B", "C"]), row("26.1", ["A", "B"])]);
  assert.deepEqual(partial.rows.map((r) => r.version), ["26.3", "26.1", "1.21.4"]);
  assert.equal(pure.bestLine(partial.best, "switch"), "Fits most: 26.3 — 2 mods have to be turned off");
  assert.equal(pure.bestLine(partial.best, "copy"), "Fits most: 26.3 — 2 mods have to be left out");
  assert.equal(pure.bestLine(pure.rankVersionRows([row("1.2", ["A"])]).best, "switch"), "Fits most: 1.2 — 1 mod has to be turned off");
  // none at all
  assert.deepEqual(pure.rankVersionRows([]), { rows: [], best: null });
  assert.deepEqual(pure.rankVersionRows([row("26.2", [], { current: true })]).best, null);
  assert.equal(pure.bestLine(null), null);
  // a server was checked: versions it takes come first, and "best" is one it takes
  const srv = pure.rankVersionRows([row("1.21.1", [], { server: false }), row("1.21.4", ["A"], { server: true })], { server: true });
  assert.deepEqual([srv.rows[0].version, srv.best.version], ["1.21.4", "1.21.4"]);
});

test("modGroups: every mod in one plain group, saying exactly what happens - per action", () => {
  const a = advice([]);
  const r = row("1.21.4", ["Mod 1", "Mod 2", "Mod 3"]);
  const sw = pure.modGroups(a, r, "switch");
  assert.deepEqual(sw.map((g) => [g.key, g.title, g.names.length]), [
    ["works", "Will work (23)", 23],
    ["nobuild", "No build for 1.21.4 (3)", 3],
    ["unknown", "Not from Modrinth, Reminth can't check these (2)", 2],
    ["failed", "Couldn't be checked just now (1)", 1],
  ]);
  assert.deepEqual(sw[1].names, ["Mod 1", "Mod 2", "Mod 3"]);
  assert.equal(sw[1].sentence, "They can't work with the rest on 1.21.4, so they will be turned off (you can turn them on again).");
  assert.match(sw[2].sentence, /^They will be kept as they are, unless the file itself says it can't run on 1\.21\.4/);
  const cp = pure.modGroups(a, r, "copy");
  assert.equal(cp[1].sentence, "They can't work with the rest on 1.21.4, so they will be left out of the copy.");
  assert.match(cp[2].sentence, /^They will be left out of the copy\./);
  // a perfect match: one group only
  assert.deepEqual(pure.modGroups({ mods: [{ title: "A" }], unknown: [], failed: [] }, row("1.21.1"), "switch").map((g) => g.key), ["works"]);
  assert.deepEqual(pure.modGroups(null, null, "switch"), []);
});

/* ---------------- job 2: which choice ---------------- */

test("versionChoices: switch for same/newer; only a new instance for an older version with worlds, a modpack, a running game", () => {
  const c = (o) => pure.versionChoices({ from: "26.2", to: "26.3", worlds: 2, ...o });
  assert.deepEqual([c({}).switch.allowed, c({}).recommended], [true, "switch"]);
  assert.deepEqual([c({ to: "26.2" }).switch.allowed, c({ to: "26.2" }).recommended], [true, "switch"]);
  const older = c({ to: "1.21.4" });
  assert.deepEqual([older.switch.allowed, older.recommended, older.copy.allowed], [false, "copy", true]);
  assert.match(older.switch.why, /saved in Minecraft 26\.2\. Opening them in the older 1\.21\.4 can damage them/);
  // older but no worlds: switching is fine
  assert.deepEqual([c({ to: "1.21.4", worlds: 0 }).switch.allowed, c({ to: "1.21.4", worlds: 0 }).recommended], [true, "switch"]);
  const pack = c({ modpack: true });
  assert.deepEqual([pack.switch.allowed, pack.recommended], [false, "copy"]);
  assert.match(pack.switch.why, /modpack/);
  const run = c({ running: true });
  assert.deepEqual([run.switch.allowed, run.recommended], [false, "copy"]);
  assert.match(run.switch.why, /^Close the game first/);
  assert.equal(pure.compareMc("1.21.10", "1.21.9"), 1);
  assert.equal(pure.compareMc("26.1", "1.21.11"), 1);
  assert.equal(pure.compareMc("24w14a", "1.21"), null);
});

/* ---------------- job 2: "switch this instance" in the main process ---------------- */

const versionSwitch = require("../src/main/versionSwitch");
const content = require("../src/main/content");

let seq = 0;
/** A throwaway instance folder with these files in mods/ (and worlds in saves/). */
async function folder({ mods = [], worlds = 0 } = {}) {
  const gameDir = path.join(HOME, "inst", `s${++seq}`);
  await fsp.mkdir(path.join(gameDir, "mods"), { recursive: true });
  for (const f of mods) await fsp.writeFile(path.join(gameDir, "mods", f), "jar " + f);
  for (let i = 0; i < worlds; i++) {
    await fsp.mkdir(path.join(gameDir, "saves", `World ${i}`), { recursive: true });
    await fsp.writeFile(path.join(gameDir, "saves", `World ${i}`, "level.dat"), "x");
  }
  return gameDir;
}
const filesIn = async (gameDir) => (await fsp.readdir(path.join(gameDir, "mods"))).sort();
const noteOf = async (gameDir) => {
  try {
    return JSON.parse(await fsp.readFile(path.join(gameDir, versionSwitch.NOTE_FILE), "utf8"));
  } catch {
    return null;
  }
};

function fakeDeps(gameDir, over = {}) {
  const calls = { update: [], applySync: 0, resolve: [] };
  let inst = { id: "i1", name: "Reminth copy", mcVersion: "26.2", loader: "fabric", loaderVersion: "0.17.0", modpack: null, gameDir, ...over.inst };
  return {
    calls,
    deps: {
      instances: {
        isValidVersionId: (v) => /^[\w.-]{1,32}$/.test(String(v || "")),
        require: async () => ({ ...inst }),
        update: over.update || (async (id, patch) => (calls.update.push(patch), (inst = { ...inst, ...patch }), { ...inst })),
      },
      isRunning: over.isRunning || (() => false),
      resolveLoaderVersion: over.resolveLoaderVersion || (async (loader, mc) => (calls.resolve.push([loader, mc]), "0.17.2")),
      advise: async () => ({
        mods: [{ title: "AppleSkin" }, { title: "Old Mod" }, { title: "Sodium" }, { title: "Anchor" }],
        target: { version: "26.3", missing: [{ projectId: "PO", title: "Old Mod", files: ["old-mod.jar"] }], failed: [], unknown: [{ title: "Own Mod", file: "own.jar" }] },
      }),
      applySync:
        over.applySync ||
        (async () => {
          calls.applySync++;
          return { applied: ["AppleSkin"], failed: [], noBuild: [{ file: "anchor.jar", title: "Anchor", why: "No stable build for 26.3 yet" }], unchecked: [] };
        }),
      invalidate: () => {},
    },
  };
}

test("switchVersion: the instance moves, the stable swap runs, mods with no build are switched OFF with their reason - nothing deleted", async () => {
  const gameDir = await folder({ mods: ["appleskin.jar", "old-mod.jar", "sodium.jar", "anchor.jar", "own.jar"] });
  const f = fakeDeps(gameDir);
  const r = await versionSwitch.switchVersion("i1", "26.3", f.deps);
  assert.deepEqual(f.calls.update, [{ mcVersion: "26.3", loaderVersion: "0.17.2" }]);
  assert.deepEqual(f.calls.resolve, [["fabric", "26.3"]]);
  assert.equal(r.instance.mcVersion, "26.3");
  assert.deepEqual(r.updated, ["AppleSkin"]);
  assert.deepEqual(r.turnedOff.map((t) => [t.file, t.why]), [
    ["old-mod.jar", "no version made for 26.3"],
    ["anchor.jar", "no finished (stable) version made for 26.3 yet"],
  ]);
  assert.deepEqual(r.unknown, ["Own Mod"]);
  assert.deepEqual(r.kept, ["Sodium"]);
  assert.equal(r.incomplete, null);
  // switched off by renaming - every file is still there
  assert.deepEqual(await filesIn(gameDir), ["anchor.jar.disabled", "appleskin.jar", "old-mod.jar.disabled", "own.jar", "sodium.jar"]);
  // the Mods tab can say why
  const listed = (await content.listAll(gameDir)).mod;
  assert.equal(listed.find((i) => i.file === "old-mod.jar.disabled").offReason, "no version made for 26.3");
  assert.equal(listed.find((i) => i.file === "sodium.jar").offReason, null);
  assert.equal(await noteOf(gameDir), null, "the note is gone after a finished run");
});

test("switchVersion: no loader build for the version -> stops before anything changed", async () => {
  const gameDir = await folder({ mods: ["a.jar"] });
  const f = fakeDeps(gameDir, {
    resolveLoaderVersion: async () => {
      throw new Error("Fabric doesn't have a build for Minecraft 26.9 yet.");
    },
  });
  await assert.rejects(versionSwitch.switchVersion("i1", "26.9", f.deps), /doesn't have a build for Minecraft 26\.9/);
  assert.deepEqual(f.calls.update, []);
  assert.equal(f.calls.applySync, 0);
  assert.equal(await noteOf(gameDir), null);
  assert.deepEqual(await filesIn(gameDir), ["a.jar"]);
});

test("switchVersion: the instance update failing -> nothing else happened, the note is removed", async () => {
  const gameDir = await folder({ mods: ["old-mod.jar"] });
  const f = fakeDeps(gameDir, {
    update: async () => {
      throw new Error("EPERM: the registry is locked");
    },
  });
  await assert.rejects(versionSwitch.switchVersion("i1", "26.3", f.deps), /EPERM/);
  assert.equal(f.calls.applySync, 0);
  assert.equal(await noteOf(gameDir), null);
  assert.deepEqual(await filesIn(gameDir), ["old-mod.jar"]);
});

test("switchVersion: the mod swap stopping half way -> on the new version, said plainly, the note kept, nothing deleted", async () => {
  const gameDir = await folder({ mods: ["old-mod.jar", "b.jar"] });
  const f = fakeDeps(gameDir, {
    applySync: async () => {
      throw new Error("Modrinth couldn't be reached");
    },
  });
  const r = await versionSwitch.switchVersion("i1", "26.3", f.deps);
  assert.equal(r.instance.mcVersion, "26.3");
  assert.match(r.incomplete, /^Reminth copy is now on Minecraft 26\.3, but updating its mods stopped: Modrinth couldn't be reached\. Press "Update mods to fit 26\.3"/);
  const note = await noteOf(gameDir);
  assert.deepEqual([note.state, note.from.mcVersion, note.from.loaderVersion, note.to.mcVersion], ["mods-pending", "26.2", "0.17.0", "26.3"]);
  assert.deepEqual(await filesIn(gameDir), ["b.jar", "old-mod.jar"]);
});

test("switchVersion: refused for a running game, a modpack, the same version, and an older version over worlds", async () => {
  const gameDir = await folder({ mods: ["a.jar"], worlds: 1 });
  await assert.rejects(versionSwitch.switchVersion("i1", "26.3", fakeDeps(gameDir, { isRunning: () => true }).deps), /^Error: Close the game first/);
  await assert.rejects(versionSwitch.switchVersion("i1", "26.3", fakeDeps(gameDir, { inst: { modpack: { projectId: "x" } } }).deps), /belong to its modpack/);
  await assert.rejects(versionSwitch.switchVersion("i1", "26.2", fakeDeps(gameDir).deps), /already on Minecraft 26\.2/);
  const older = fakeDeps(gameDir);
  await assert.rejects(versionSwitch.switchVersion("i1", "1.21.4", older.deps), /worlds were saved in Minecraft 26\.2/);
  assert.deepEqual(older.calls.update, []);
  // older is fine without worlds
  const empty = await folder({ mods: ["a.jar"] });
  const ok = fakeDeps(empty);
  await versionSwitch.switchVersion("i1", "1.21.4", ok.deps);
  assert.deepEqual(ok.calls.update, [{ mcVersion: "1.21.4", loaderVersion: "0.17.2" }]);
  assert.equal(await versionSwitch.countWorlds(gameDir), 1);
});

/* ---------------- job 3: "turned off by Reminth" reasons ---------------- */

test("turned-off reasons: set, cleared when turned on or removed, kept on disk across a restart", async () => {
  const gameDir = await folder({ mods: ["x.jar.disabled", "y.jar.disabled"] });
  await content.setOffReason(gameDir, { kind: "mod", world: null, file: "x.jar.disabled" }, "no version made for 1.21.4");
  await content.setOffReason(gameDir, { kind: "mod", world: null, file: "y.jar" }, "no version made for 1.21.4");
  // on disk (what a restart reads): content.json's turnedOff
  const onDisk = JSON.parse(await fsp.readFile(path.join(gameDir, ".reminth", "content.json"), "utf8"));
  assert.deepEqual(Object.keys(onDisk.turnedOff).sort(), ["mods/x.jar", "mods/y.jar"]);
  let listed = (await content.listAll(gameDir)).mod;
  assert.equal(listed.find((i) => i.file === "x.jar.disabled").offReason, "no version made for 1.21.4");
  // turned on by the player: forgotten, and turning it off again by hand says nothing
  await content.setEnabled(gameDir, { kind: "mod", world: null, file: "x.jar.disabled" }, true);
  await content.setEnabled(gameDir, { kind: "mod", world: null, file: "x.jar" }, false);
  listed = (await content.listAll(gameDir)).mod;
  assert.equal(listed.find((i) => i.file === "x.jar.disabled").offReason, null);
  // removed (to the Recycle Bin): forgotten
  await content.remove(gameDir, { kind: "mod", world: null, file: "y.jar.disabled" }, async (full) => fsp.rename(full, full + ".trashed"));
  const after = JSON.parse(await fsp.readFile(path.join(gameDir, ".reminth", "content.json"), "utf8"));
  assert.deepEqual(after.turnedOff, {});
});

test("pickerView: the current version already fits -> 'nothing to change', other fitting versions listed plainly, no best", () => {
  // the real case: on 26.2, all 32 mods fit 26.2; 26.1.2 fits too
  const r = (version, missing = [], extra = {}) => ({ version, total: 32, supported: 32 - missing.length, missing, server: null, current: false, ...extra });
  const v = pure.pickerView([r("26.2", [], { current: true }), r("26.1.2"), r("26.1"), r("1.21.11", ["JEI"])]);
  assert.equal(v.currentFits, true);
  assert.equal(v.headline, "Your mods already fit Minecraft 26.2 - there is nothing you need to change.");
  assert.equal(v.listTitle, "Other versions that also fit");
  assert.deepEqual(v.rows.map((x) => x.version), ["26.1.2", "26.1"], "only the others that fit - no current, no problem versions");
  assert.equal(v.best, null, "no Best match, nothing picked");
  // the current version has problems: today's list
  const w = pure.pickerView([r("26.2", ["JEI"], { current: true }), r("26.1.2")]);
  assert.deepEqual([w.currentFits, w.best.version, w.headline], [false, "26.1.2", null]);
  // a checked server that doesn't take the current version: it doesn't "fit"
  const s = pure.pickerView([r("26.2", [], { current: true, server: false }), r("1.21.4", [], { server: true })], { server: true });
  assert.deepEqual([s.currentFits, s.best.version], [false, "1.21.4"]);
  // no mods checked at all: nothing claimed
  assert.equal(pure.pickerView([{ version: "26.2", total: 0, supported: 0, missing: [], current: true }]).currentFits, false);
});

test("previewSwitch: the confirm step's 'will be turned off' list is exactly what the switch turns off - a jar whose own file refuses the version included", async () => {
  const compat = require("../src/main/compat");
  const modsSync = require("../src/main/modsSync");
  const zip = require("../src/main/zip");
  // Client Side Crystals: Modrinth lists this very file for 1.21.10, but its own
  // fabric.mod.json says >=1.21.11 - so no other build can fix it there.
  const gameDir = await folder({ mods: [] });
  const src = path.join(HOME, "csc-src");
  await fsp.mkdir(src, { recursive: true });
  await fsp.writeFile(path.join(src, "fabric.mod.json"), JSON.stringify({ schemaVersion: 1, id: "clientsidecrystals", name: "Client Side Crystals", version: "1.0", depends: { minecraft: ">=1.21.11" } }));
  await zip.buildZip(src, path.join(gameDir, "mods", "csc-1.0.jar"));
  await fsp.writeFile(path.join(gameDir, "mods", "jei.jar"), "not really a jar");
  const listed = { id: "csc1", project_id: "PCSC", version_number: "1.0", version_type: "release", game_versions: ["1.21.10", "1.21.11"], loaders: ["fabric"], date_published: "2026-09-01", files: [{ primary: true, url: "https://cdn.modrinth.com/x/csc-1.0.jar", filename: "csc-1.0.jar", size: 1, hashes: { sha1: "c".repeat(40) } }] };
  const checkDeps = {
    hasOverrideFile: async () => false,
    managedNames: async () => new Set(),
    hashOf: async (item) => "h-" + item.file,
    readLaunchReport: async () => null,
    readCrashFinding: async () => null,
    modrinth: { getVersionsFromHashes: async () => ({ "h-csc-1.0.jar": listed }), checkForUpdates: async () => ({}), getProjects: async () => [], getProjectVersions: async () => [listed] },
  };
  const syncDeps = { check: (inst) => compat.checkInstance(inst, { force: true, deps: checkDeps }), loadersFor: () => ["fabric"], api: { getProjectVersions: async () => [listed] } };
  // the advisor: Modrinth HAS a build of CSC for 1.21.10; JEI has none
  const advise = async () => ({
    mods: [{ title: "Client Side Crystals" }, { title: "Just Enough Items" }],
    target: { version: "1.21.10", missing: [{ projectId: "PJEI", title: "Just Enough Items", files: ["jei.jar"] }], failed: [], unknown: [] },
  });
  const base = fakeDeps(gameDir, { inst: { mcVersion: "26.2", loader: "fabric" } });
  const deps = { ...base.deps, advise, planSync: (inst) => modsSync.planSync(inst, syncDeps), applySync: (inst) => modsSync.applySync(inst, null, { ...syncDeps, applyUpdates: async () => ({ applied: [], failed: [] }), invalidate: () => {} }) };

  const preview = await versionSwitch.previewSwitch("i1", "1.21.10", deps);
  assert.deepEqual(preview.turnedOff.map((t) => [t.title, t.why]), [
    ["Just Enough Items", "no version made for 1.21.10"],
    ["Client Side Crystals", "its own file says it can't run on 1.21.10"],
  ]);
  const groups = pure.previewGroups(preview, "1.21.10");
  const off = groups.find((g) => g.key === "nobuild");
  assert.equal(off.title, "Will be turned off (2)");
  assert.deepEqual(off.names, ["Just Enough Items - no version made for 1.21.10", "Client Side Crystals - its own file says it can't run on 1.21.10"]);
  // nothing changed by the preview
  assert.deepEqual(base.calls.update, []);
  assert.deepEqual(await filesIn(gameDir), ["csc-1.0.jar", "jei.jar"]);

  // the switch itself: the same two, the same reasons
  const done = await versionSwitch.switchVersion("i1", "1.21.10", deps);
  assert.deepEqual(done.turnedOff.map((t) => [t.title, t.why]), preview.turnedOff.map((t) => [t.title, t.why]));
  assert.deepEqual(await filesIn(gameDir), ["csc-1.0.jar.disabled", "jei.jar.disabled"]);
});
