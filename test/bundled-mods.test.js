"use strict";
/**
 * Prompt 17, job 1: Reminth's bundled mods as one mechanism with two entries
 * (config.BUNDLED_MODS): ReminthHUD (opt-in, `hud`) and the Reminth home
 * screen (on unless switched off, `homeScreen`). Fake jars are written into
 * a temp "assets/mods" folder; no network, no Electron.
 * Run with: node --test test/bundled-mods.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "reminth-bundled-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return "STUB_ELECTRON_BUNDLED";
  return originalResolve.call(this, request, ...rest);
};
Module._cache.STUB_ELECTRON_BUNDLED = { id: "STUB_ELECTRON_BUNDLED", filename: "STUB_ELECTRON_BUNDLED", loaded: true, exports: { safeStorage: { isEncryptionAvailable: () => false } } };

const paths = require("../src/main/paths");
const config = require("../src/main/config");
const minecraft = require("../src/main/minecraft");
const instances = require("../src/main/instances");
const zip = require("../src/main/zip");

let seq = 0;
/** A fresh, empty "assets/mods" folder that the bundled-build lookup reads. */
async function assetsDir() {
  const dir = path.join(HOME, "assets", `a${++seq}`, "mods");
  await fsp.mkdir(dir, { recursive: true });
  paths.REMINTHHUD_ASSET_DIR = dir;
  return dir;
}
/** A fake mod jar: just a fabric.mod.json with this id, version and depends. */
async function fakeJar(dir, name, { id, version, depends }) {
  const src = path.join(HOME, "jarsrc", `j${++seq}`);
  await fsp.mkdir(src, { recursive: true });
  await fsp.writeFile(path.join(src, "fabric.mod.json"), JSON.stringify({ schemaVersion: 1, id, version, depends }));
  await zip.buildZip(src, path.join(dir, name));
}
async function gameFolder() {
  const gameDir = path.join(HOME, "games", `g${++seq}`);
  await fsp.mkdir(path.join(gameDir, "mods"), { recursive: true });
  return { gameDir, modsDir: path.join(gameDir, "mods"), list: async () => (await fsp.readdir(path.join(gameDir, "mods"))).sort() };
}
const inst = (over = {}) => ({ id: "x-1234", loader: "fabric", mcVersion: "26.2", hud: false, ...over });

/** What ensureInstalled does with the bundled mods, start to finish: copy what fits, then tidy. */
async function playOnce(instance, modsDir) {
  const bundled = await minecraft.bundledModsFor(instance, instance.mcVersion);
  const installed = (await minecraft.installBundledMods(bundled, modsDir)).map((e) => ({ ...e, own: true }));
  const removed = await minecraft.tidyManagedMods(modsDir, installed, { dropHud: !config.bundledModWanted(config.bundledMod("reminthhud"), instance), dropBundled: minecraft.bundledModsToDrop(instance) });
  return { installed: installed.map((e) => e.file), removed };
}

test("bundled mods: the registry has exactly ReminthHUD and the home screen", () => {
  assert.deepEqual(
    config.BUNDLED_MODS.map((e) => [e.mod, e.filePrefix, e.flag, e.label]),
    [
      ["reminthhud", "reminthhud-", "hud", "ReminthHUD"],
      ["reminthhome", "reminthhome-", "homeScreen", "Reminth home screen"],
    ]
  );
});

test("bundled mods: who wants which (HUD opt-in, home screen on unless switched off, Fabric/Quilt only)", () => {
  const hud = config.bundledMod("reminthhud");
  const home = config.bundledMod("reminthhome");
  assert.equal(config.bundledModWanted(hud, inst({ hud: true })), true);
  assert.equal(config.bundledModWanted(hud, inst({ hud: false })), false);
  assert.equal(config.bundledModWanted(hud, inst({ hud: undefined })), false);
  assert.equal(config.bundledModWanted(home, inst({})), true, "a missing value counts as on");
  assert.equal(config.bundledModWanted(home, inst({ homeScreen: true })), true);
  assert.equal(config.bundledModWanted(home, inst({ homeScreen: false })), true, "the home screen is forced: the old switch no longer turns it off");
  assert.equal(config.bundledModWanted(home, inst({ loader: "quilt" })), true);
  for (const loader of ["vanilla", "forge", "neoforge"]) {
    assert.equal(config.bundledModWanted(home, inst({ loader })), false, loader);
    assert.equal(config.bundledModWanted(hud, inst({ loader, hud: true })), false, loader);
  }
});

test("bundled mods: the build is picked by its declared Minecraft range, for both mods (newest that fits wins)", async () => {
  const dir = await assetsDir();
  await fakeJar(dir, "reminthhud-1.2.2+1.21.1.jar", { id: "reminthhud", version: "1.2.2+1.21.1", depends: { minecraft: "~1.21.1", "fabric-api": "*" } });
  await fakeJar(dir, "reminthhud-1.2.2+26.2.jar", { id: "reminthhud", version: "1.2.2+26.2", depends: { minecraft: "~26.2", "fabric-api": "*" } });
  await fakeJar(dir, "reminthhome-1.0.0+26.2.jar", { id: "reminthhome", version: "1.0.0+26.2", depends: { minecraft: "~26.2" } });
  await fakeJar(dir, "reminthhome-1.1.0+26.2.jar", { id: "reminthhome", version: "1.1.0+26.2", depends: { minecraft: "~26.2", fabric: "*" } });
  await fakeJar(dir, "reminthhome-1.0.0+1.21.1.jar", { id: "reminthhome", version: "1.0.0+1.21.1", depends: { minecraft: ">=1.21.1 <1.21.2" } });

  assert.equal(path.basename((await minecraft.findBundledModFor("reminthhud", "26.2")).file), "reminthhud-1.2.2+26.2.jar");
  assert.equal(path.basename((await minecraft.findBundledModFor("reminthhud", "1.21.1")).file), "reminthhud-1.2.2+1.21.1.jar");
  assert.equal(path.basename((await minecraft.findReminthHudFor("26.2")).file), "reminthhud-1.2.2+26.2.jar");
  const home = await minecraft.findBundledModFor("reminthhome", "26.2");
  assert.equal(path.basename(home.file), "reminthhome-1.1.0+26.2.jar");
  assert.equal(home.needsFabricApi, true);
  assert.equal((await minecraft.findBundledModFor("reminthhome", "1.21.1")).needsFabricApi, false);
  assert.equal(await minecraft.findBundledModFor("reminthhome", "26.3"), null);
  assert.equal(await minecraft.findBundledModFor("reminthhud", "1.20.1"), null);
  // The HUD list never contains a home jar and the other way round.
  assert.ok((await minecraft.bundledReminthHudBuilds()).every((b) => /^reminthhud-/.test(path.basename(b.file))));
  assert.ok((await minecraft.bundledModBuilds("reminthhome")).every((b) => /^reminthhome-/.test(path.basename(b.file))));
  assert.deepEqual(await minecraft.bundledModBuilds("sodium"), [], "only Reminth's own mods are bundled");
});

test("bundled mods: no home-screen jar at all (today's assets/mods) is a quiet no-op", async () => {
  const dir = await assetsDir();
  await fakeJar(dir, "reminthhud-1.2.2+26.2.jar", { id: "reminthhud", version: "1.2.2+26.2", depends: { minecraft: "~26.2" } });
  const { modsDir, list } = await gameFolder();
  const run = await playOnce(inst({ hud: false }), modsDir);
  assert.deepEqual(run, { installed: [], removed: [] });
  assert.deepEqual(await list(), []);
  assert.deepEqual(await minecraft.bundledModsFor(inst({ hud: false }), "26.2"), []);
});

test("bundled mods: the home screen is copied in on Play, removed when switched off, untouched when no build fits", async () => {
  const dir = await assetsDir();
  await fakeJar(dir, "reminthhome-1.0.0+26.2.jar", { id: "reminthhome", version: "1.0.0+26.2", depends: { minecraft: "~26.2" } });
  const { gameDir, modsDir, list } = await gameFolder();
  await fsp.writeFile(path.join(modsDir, "players-own-mod.jar"), "mine");

  // on (a missing value): copied in and recorded as Reminth's own
  assert.deepEqual((await playOnce(inst(), modsDir)).installed, ["reminthhome-1.0.0+26.2.jar"]);
  assert.deepEqual(await list(), ["players-own-mod.jar", "reminthhome-1.0.0+26.2.jar"]);
  const managed = JSON.parse(await fsp.readFile(path.join(gameDir, ".reminth", "managed-mods.json"), "utf8"));
  assert.deepEqual(managed.files["reminthhome-1.0.0+26.2.jar"], { mod: "reminthhome" });

  // the instance moves to a version with no build: the copy that's there stays, nothing is said
  const moved = await playOnce(inst({ mcVersion: "26.3" }), modsDir);
  assert.deepEqual(moved, { installed: [], removed: [] });
  assert.deepEqual(await list(), ["players-own-mod.jar", "reminthhome-1.0.0+26.2.jar"]);

  // the old "off" value in an instance no longer removes it: the home screen is part of the launcher
  const off = await playOnce(inst({ homeScreen: false }), modsDir);
  assert.deepEqual(off.removed, []);
  assert.deepEqual(await list(), ["players-own-mod.jar", "reminthhome-1.0.0+26.2.jar"]);
  await fsp.rm(path.join(modsDir, "reminthhome-1.0.0+26.2.jar"), { force: true }); // so the Forge check below starts clean

  // and a Forge instance never has it
  assert.deepEqual(minecraft.bundledModsToDrop(inst({ loader: "forge" })), ["reminthhome"]);
  assert.deepEqual(minecraft.bundledModsToDrop(inst()), []);
});

test("bundled mods: the home screen and the HUD are each switched on their own", async () => {
  const dir = await assetsDir();
  await fakeJar(dir, "reminthhud-1.2.2+26.2.jar", { id: "reminthhud", version: "1.2.2+26.2", depends: { minecraft: "~26.2" } });
  await fakeJar(dir, "reminthhome-1.0.0+26.2.jar", { id: "reminthhome", version: "1.0.0+26.2", depends: { minecraft: "~26.2" } });
  const { modsDir, list } = await gameFolder();
  await playOnce(inst({ hud: true }), modsDir);
  assert.deepEqual(await list(), ["reminthhome-1.0.0+26.2.jar", "reminthhud-1.2.2+26.2.jar"]);
  await playOnce(inst({ hud: false }), modsDir);
  assert.deepEqual(await list(), ["reminthhome-1.0.0+26.2.jar"]);
  await playOnce(inst({ hud: true, homeScreen: false }), modsDir);
  assert.deepEqual(await list(), ["reminthhome-1.0.0+26.2.jar", "reminthhud-1.2.2+26.2.jar"], "the home screen stays whatever the old switch says");
});

test("bundled mods: the home screen is never a performance-pack mod and never steps aside for the player's copy", () => {
  assert.equal(minecraft.managedModFromName("reminthhome-1.0.0+26.2.jar"), "reminthhome");
  assert.equal(minecraft.managedModFromName("reminthhud-1.2.2+26.2.jar"), "reminthhud");
  assert.equal(minecraft.managedModLabel("reminthhome"), "Reminth home screen");
  assert.equal(minecraft.managedModLabel("reminthhud"), "ReminthHUD");
  // A jar of the player's carrying the same mod id: like the HUD, Reminth's copy stays.
  const mods = [
    { file: "reminthhome-1.0.0+26.2.jar", modId: "reminthhome", enabled: true, valid: true },
    { file: "my-reminthhome-fork.jar", modId: "reminthhome", enabled: true, valid: true },
  ];
  const plan = minecraft.planStepAside({ mods, managed: { "reminthhome-1.0.0+26.2.jar": { mod: "reminthhome" } }, tracked: new Set(), mcVersion: "26.2" });
  assert.deepEqual(plan.remove, []);
});

test("bundled mods: switching the performance pack off never takes the home screen with it", async () => {
  const { modsDir, list } = await gameFolder();
  await fsp.writeFile(path.join(modsDir, "reminthhome-1.0.0+26.2.jar"), "x");
  await fsp.writeFile(path.join(modsDir, "sodium-fabric-0.6.1.jar"), "x");
  await minecraft.tidyManagedMods(modsDir, [
    { file: "reminthhome-1.0.0+26.2.jar", mod: "reminthhome", own: true },
    { file: "sodium-fabric-0.6.1.jar", mod: "sodium", own: true },
  ]);
  const removed = await minecraft.tidyManagedMods(modsDir, [], { dropHud: true, dropPerf: true });
  assert.deepEqual(removed, ["sodium-fabric-0.6.1.jar"]);
  assert.deepEqual(await list(), ["reminthhome-1.0.0+26.2.jar"]);
});

test("instances: homeScreen is kept only as a real true/false; missing stays missing (= on)", () => {
  const base = { id: "a-1234", name: "A", mcVersion: "26.2", loader: "fabric" };
  assert.equal("homeScreen" in instances.sanitizeInstance(base), false);
  assert.equal(instances.sanitizeInstance({ ...base, homeScreen: false }).homeScreen, false);
  assert.equal(instances.sanitizeInstance({ ...base, homeScreen: true }).homeScreen, true);
  assert.equal("homeScreen" in instances.sanitizeInstance({ ...base, homeScreen: "no" }), false);
});

test("instances: create and update keep the player's explicit false; a missing value counts as on", async () => {
  const made = await instances.create({ name: "Home test", mcVersion: "26.2", loader: "fabric" });
  assert.equal("homeScreen" in made, false);
  assert.equal(config.bundledModWanted(config.bundledMod("reminthhome"), made), true);
  const off = await instances.update(made.id, { homeScreen: false });
  assert.equal(off.homeScreen, false);
  // an unrelated change (a rename) keeps the "no"
  const renamed = await instances.update(made.id, { name: "Home test 2" });
  assert.equal(renamed.homeScreen, false);
  assert.equal(config.bundledModWanted(config.bundledMod("reminthhome"), renamed), true, "forced: an old false does not switch it off");
  const madeOff = await instances.create({ name: "Home off", mcVersion: "26.2", loader: "fabric", homeScreen: false });
  assert.equal(madeOff.homeScreen, false);
  const back = await instances.update(made.id, { homeScreen: true });
  assert.equal(back.homeScreen, true);
});
