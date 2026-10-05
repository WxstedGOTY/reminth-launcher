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
  // listed for older versions only and the jar says yes: a SOFT hint - checkInstance drops it unless a proper
  // build for this version exists (the two tests below)
  const older = compat.judgeMod({ descriptors: fab, mcDep: ">=1.21" }, { game_versions: ["1.21", "1.21.1"], loaders: ["fabric"] }, { mcVersion: "1.21.4", loader: "fabric" }, ["fabric"], false);
  assert.equal(older.softOlder, true);
  assert.equal(older.listedElsewhere, true);
  assert.equal(older.severity, "warn");
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

/* ---------------- job B: the Play warning ---------------- */

const pure = require("../src/renderer/pure");

test("modWarning: blocked wins; 'may not work' (listed for another version) is asked; other warnings aren't", () => {
  const risky = { file: "appleskin.jar", title: "AppleSkin", severity: "warn", reason: "wrong-mc", listedElsewhere: true };
  const blocked = { file: "csc.jar", title: "Client Side Crystals", severity: "blocked", reason: "wrong-mc" };
  const other = { file: "x.jar", title: "X", severity: "warn", reason: "missing-dep" };
  const set = "a".repeat(40);
  assert.deepEqual(pure.modWarning({ issues: [risky, blocked, other], modSet: set }, null), { kind: "blocked", issues: [blocked] });
  assert.deepEqual(pure.modWarning({ issues: [risky, other], modSet: set }, null), { kind: "risky", issues: [risky] });
  assert.equal(pure.modWarning({ issues: [other], modSet: set }, null), null);
  assert.equal(pure.modWarning(null, null), null);
  // "Don't ask again": only for the same set of mods, and never for blocked ones
  assert.equal(pure.modWarning({ issues: [risky], modSet: set }, set), null);
  assert.equal(pure.modWarning({ issues: [risky], modSet: "b".repeat(40) }, set).kind, "risky", "the mods changed: asked again");
  assert.equal(pure.modWarning({ issues: [risky, blocked], modSet: set }, set).kind, "blocked");
  assert.equal(pure.modWarning({ issues: [risky] }, set).kind, "risky", "no fingerprint (an old answer): asked");
});

test("riskyText: the plain sentence with the names", () => {
  assert.equal(pure.riskyText([{ title: "AppleSkin" }]), "1 mod is built for another Minecraft version and may crash the game: AppleSkin.");
  assert.equal(pure.riskyText([{ title: "AppleSkin" }, { title: "JEI" }]), "2 mods are built for another Minecraft version and may crash the game: AppleSkin and JEI.");
  assert.equal(pure.riskyText([{ title: "A" }, { title: "B" }, { file: "c.jar" }]), "3 mods are built for another Minecraft version and may crash the game: A, B and c.jar.");
});

test("instances: the 'don't ask again' fingerprint is kept only when it is one", async () => {
  const instances = require("../src/main/instances");
  const made = await instances.create({ name: "Warn", mcVersion: "26.2", loader: "fabric" });
  let inst = await instances.update(made.id, { skipModWarning: "a".repeat(40) });
  assert.equal(inst.skipModWarning, "a".repeat(40));
  inst = await instances.update(made.id, { skipModWarning: "../../x" });
  assert.equal(inst.skipModWarning, undefined, "junk is dropped");
  inst = await instances.update(made.id, { skipModWarning: "b".repeat(40) });
  inst = await instances.update(made.id, { skipModWarning: null });
  assert.equal(inst.skipModWarning, undefined, "null forgets it");
  assert.equal((await instances.get(made.id)).skipModWarning, undefined);
});

/* ---------------- job C: which mod crashed the game ---------------- */

const crashReport = require("../src/main/crashReport");
const content = require("../src/main/content");

// The owner's real report (3 Oct 2026), shortened to its head: AppleSkin built
// for 26.3, on 26.2, connected to a Paper (Velocity) server, first HUD draw.
const APPLESKIN_REPORT = [
  "---- Minecraft Crash Report ----",
  "// Who set us up the TNT?",
  "",
  "Time: 2026-10-03 14:22:10",
  "Description: Rendering overlay",
  "",
  "java.lang.NoSuchFieldError: Class net.minecraft.client.renderer.RenderPipelines does not have member field 'com.mojang.blaze3d.pipeline.RenderPipeline GUI_TEXTURED'",
  "\tat knot//squeek.appleskin.client.HUDOverlayHandler.drawExhaustionOverlay(HUDOverlayHandler.java:96)",
  "\tat knot//squeek.appleskin.client.HUDOverlayHandler.onPreRender(HUDOverlayHandler.java:61)",
  "\tat knot//net.fabricmc.fabric.impl.client.rendering.hud.HudElementRegistryImpl.render(HudElementRegistryImpl.java:88)",
  "\tat knot//net.minecraft.client.gui.Gui.handler$zbm000$appleskin$onRenderHud(Gui.java:1203)",
  "\tat knot//net.minecraft.client.gui.Gui.render(Gui.java:172)",
  "\tat knot//net.minecraft.client.renderer.GameRenderer.render(GameRenderer.java:942)",
  "\tat java.base/java.lang.Thread.run(Thread.java:1583)",
  "",
  "",
  "A detailed walkthrough of the error, its code path and all known details is as follows:",
  "---------------------------------------------------------------------------------------",
  "",
  "-- Head --",
  "\tat knot//some.other.mod.Thing.run(Thing.java:1)",
  "-- System Details --",
  "\tServer brand: Paper (Velocity)",
  "\tType: Non-integrated multiplayer server",
  "\tFabric Mods: ",
  "\t\tappleskin: AppleSkin 3.0.10+mc26.3",
].join("\n");

const jarItem = (file, extra) => ({ kind: "mod", file, valid: true, folder: false, enabled: true, size: 10, modifiedAt: 1, ...extra });

test("parseCrashReport: the real AppleSkin crash - description, error, frames", () => {
  const r = crashReport.parseCrashReport(APPLESKIN_REPORT);
  assert.equal(r.description, "Rendering overlay");
  assert.match(r.error, /^java\.lang\.NoSuchFieldError: Class net\.minecraft\.client\.renderer\.RenderPipelines does not have member field/);
  assert.deepEqual(r.frames[0], { cls: "squeek.appleskin.client.HUDOverlayHandler", method: "drawExhaustionOverlay", modHint: null, mixinMod: null });
  assert.equal(r.frames[3].mixinMod, "appleskin");
  assert.equal(r.frames[6].cls, "java.lang.Thread");
  assert.equal(r.frames.length, 7, "nothing below the detailed walkthrough is read");
  assert.equal(crashReport.parseCrashReport("just a log file"), null);
});

test("findCulprit: AppleSkin, from its jar's own packages (read from a real jar by content.listAll)", async () => {
  const inst = await instanceWith("crash-appleskin", "26.2", {
    "appleskin-fabric-mc26.3-3.0.10.jar": (out) => makeJar(out, APPLESKIN_JSON, { "appleskin.mixins.json": APPLESKIN_MIXINS }),
    "fabric-api-0.120.jar": (out) => makeJar(out, { id: "fabric-api", name: "Fabric API", version: "0.120", entrypoints: { client: ["net.fabricmc.fabric.impl.client.FabricClient"] } }),
    "sodium.jar": (out) => makeJar(out, { id: "sodium", name: "Sodium", version: "0.7", entrypoints: { client: ["net.caffeinemc.mods.sodium.client.SodiumClientMod"] } }),
  });
  const items = (await content.listAll(inst.gameDir)).mod;
  const apple = items.find((i) => i.modId === "appleskin");
  assert.deepEqual(apple.packages.sort(), ["squeek.appleskin", "squeek.appleskin.client", "squeek.appleskin.mixin"]);
  const hit = crashReport.findCulprit(crashReport.parseCrashReport(APPLESKIN_REPORT), items);
  assert.equal(hit.item.file, "appleskin-fabric-mc26.3-3.0.10.jar");
  assert.equal(hit.how, "frame");
});

test("findCulprit: a Mixin error naming a mod", () => {
  const report = [
    "---- Minecraft Crash Report ----",
    "Description: Initializing game",
    "",
    "org.spongepowered.asm.mixin.injection.throwables.InjectionError: Critical injection failure: Callback method onRender in appleskin.mixins.json:HungerHudMixin from mod appleskin failed injection check, (0/1) succeeded. Scanned 0 target(s).",
    "\tat org.spongepowered.asm.mixin.injection.struct.InjectionInfo.postInject(InjectionInfo.java:468)",
    "\tat org.spongepowered.asm.mixin.transformer.MixinTargetContext.applyInjections(MixinTargetContext.java:1384)",
  ].join("\n");
  const parsed = crashReport.parseCrashReport(report);
  assert.deepEqual(parsed.mixinMods, ["appleskin"]);
  const items = [jarItem("appleskin.jar", { modId: "appleskin" }), jarItem("jei.jar", { modId: "jei", packages: ["mezz.jei"] })];
  const hit = crashReport.findCulprit(parsed, items);
  assert.deepEqual([hit.item.file, hit.how], ["appleskin.jar", "mixin"]);
});

test("findCulprit: a crash with no mod frames names nobody", () => {
  const report = [
    "---- Minecraft Crash Report ----",
    "Description: Unexpected error",
    "",
    "java.lang.OutOfMemoryError: Java heap space",
    "\tat java.base/java.util.Arrays.copyOf(Arrays.java:3537)",
    "\tat knot//net.minecraft.client.renderer.chunk.SectionRenderDispatcher.rebuild(SectionRenderDispatcher.java:220)",
    "\tat knot//net.fabricmc.fabric.impl.event.lifecycle.ClientTickEvents.tick(ClientTickEvents.java:30)",
  ].join("\n");
  const items = [jarItem("appleskin.jar", { modId: "appleskin", packages: ["squeek.appleskin"] }), jarItem("fabric-api.jar", { modId: "fabric-api", packages: ["net.fabricmc.fabric"] })];
  assert.equal(crashReport.findCulprit(crashReport.parseCrashReport(report), items), null, "Fabric API's frame is never blamed");
});

test("parseCrashReport: a cut-off file gives what is there, and names nobody without frames", () => {
  const cut = "---- Minecraft Crash Report ----\nDescription: Rendering overlay\n\njava.lang.NoSuchFieldEr";
  const r = crashReport.parseCrashReport(cut);
  assert.equal(r.description, "Rendering overlay");
  assert.equal(r.error, "java.lang.NoSuchFieldEr");
  assert.deepEqual(r.frames, []);
  assert.equal(crashReport.findCulprit(r, [jarItem("appleskin.jar", { modId: "appleskin", packages: ["squeek.appleskin"] })]), null);
  // cut in the middle of the frames: the frames that are there still count
  const half = APPLESKIN_REPORT.slice(0, APPLESKIN_REPORT.indexOf("onPreRender"));
  const hit = crashReport.findCulprit(crashReport.parseCrashReport(half), [jarItem("appleskin.jar", { modId: "appleskin", packages: ["squeek.appleskin"] })]);
  assert.equal(hit.item.file, "appleskin.jar");
});

test("findCulprit: never a guess - two mods in one package, Reminth's own jar, a switched-off copy", () => {
  const parsed = crashReport.parseCrashReport(APPLESKIN_REPORT);
  const two = [jarItem("a.jar", { modId: "a", packages: ["squeek.appleskin"] }), jarItem("b.jar", { modId: "b", packages: ["squeek.appleskin"] })];
  assert.equal(crashReport.findCulprit(parsed, two), null);
  // the longer package wins over a shorter shared one
  const nested = [jarItem("a.jar", { modId: "a", packages: ["squeek"] }), jarItem("b.jar", { modId: "b", packages: ["squeek.appleskin.client"] })];
  assert.equal(crashReport.findCulprit(parsed, nested).item.file, "b.jar");
  const mine = [jarItem("appleskin.jar", { modId: "appleskin", packages: ["squeek.appleskin"] })];
  assert.equal(crashReport.findCulprit(parsed, mine, { skipFiles: new Set(["appleskin.jar"]) }), null);
  assert.equal(crashReport.findCulprit(parsed, [jarItem("appleskin.jar", { modId: "appleskin", packages: ["squeek.appleskin"], enabled: false })]), null);
  // Forge / NeoForge frames name their mod
  const forge = "---- Minecraft Crash Report ----\nDescription: x\n\njava.lang.NullPointerException\n\tat TRANSFORMER/minecraft@1.20.1/net.minecraft.client.Minecraft.tick(Minecraft.java:1)\n\tat TRANSFORMER/jei@15.2/mezz.jei.Thing.go(Thing.java:2)\n";
  assert.equal(crashReport.findCulprit(crashReport.parseCrashReport(forge), [jarItem("jei.jar", { modId: "jei" })]).how, "forge");
});

test("latestReport: only the newest report written since the launch, in the instance's own folder, never a link, capped", async () => {
  const gameDir = path.join(HOME, "inst", "reports");
  const dir = path.join(gameDir, "crash-reports");
  await fsp.mkdir(dir, { recursive: true });
  const started = Date.now();
  const old = path.join(dir, "crash-2026-10-01_10.00.00-client.txt");
  await fsp.writeFile(old, "old");
  await fsp.utimes(old, new Date(started - 60000), new Date(started - 60000));
  assert.equal(await crashReport.latestReport(gameDir, started), null, "older than the launch");
  await fsp.writeFile(path.join(dir, "crash-2026-10-03_14.22.10-client.txt"), "x".repeat(crashReport.MAX_REPORT_BYTES + 100));
  await fsp.writeFile(path.join(dir, "notes.txt"), "not a report");
  const r = await crashReport.latestReport(gameDir, started);
  assert.equal(r.name, "crash-2026-10-03_14.22.10-client.txt");
  assert.equal(r.text.length, crashReport.MAX_REPORT_BYTES);
  // a link that is newer is skipped
  const outside = path.join(HOME, "outside.txt");
  await fsp.writeFile(outside, "secret");
  try {
    await fsp.symlink(outside, path.join(dir, "crash-2099-01-01_00.00.00-client.txt"));
    assert.equal((await crashReport.latestReport(gameDir, started)).name, "crash-2026-10-03_14.22.10-client.txt");
  } catch (err) {
    if (err.code !== "EPERM") throw err; // Windows without the right to make links
  }
  assert.equal(await crashReport.latestReport(path.join(HOME, "nope"), started), null);
});

test("checkInstance: the crashed mod is 'Crashed the game' while that exact file is there, with its fix", async () => {
  const inst = await instanceWith("crash-check", "26.2", {
    "appleskin-fabric-mc26.3-3.0.10.jar": (out) => makeJar(out, APPLESKIN_JSON, { "appleskin.mixins.json": APPLESKIN_MIXINS }),
    "other.jar": (out) => makeJar(out, { id: "other", name: "Other", version: "1", depends: { minecraft: ">=1.21" } }),
  });
  const items = (await content.listAll(inst.gameDir)).mod;
  const it = (f) => items.find((i) => i.file === f);
  const finding = (file, over = {}) => ({ mcVersion: "26.2", loader: "fabric", error: "java.lang.NoSuchFieldError: Class x", mod: { file, size: it(file).size, mtimeMs: it(file).modifiedAt, modId: "x", name: "x" }, ...over });
  const api = fakeModrinth({
    found: { "h-appleskin-fabric-mc26.3-3.0.10.jar": { id: "as263", project_id: "EsAfCjCV", game_versions: ["26.3"], loaders: ["fabric"] } },
    updates: { "h-appleskin-fabric-mc26.3-3.0.10.jar": { id: "as262", project_id: "EsAfCjCV", version_number: "3.0.10+mc26.2", version_type: "release", files: relFile("appleskin-fabric-mc26.2-3.0.10.jar", "2") } },
  });
  // AppleSkin: already "may not work" -> now also "crashed", same fix
  let r = await compat.checkInstance(inst, { force: true, deps: { ...checkDeps(api), readCrashFinding: async () => finding("appleskin-fabric-mc26.3-3.0.10.jar") } });
  let i = r.issues.find((x) => x.file === "appleskin-fabric-mc26.3-3.0.10.jar");
  assert.equal(i.crashed, true);
  assert.match(i.detail, /^AppleSkin crashed the game last time \(NoSuchFieldError\)\. This build is listed for Minecraft 26\.3/);
  assert.equal(i.fix.label, "Switch to 3.0.10+mc26.2");
  // a mod with nothing else wrong: its own row, switch-off fix
  r = await compat.checkInstance(inst, { force: true, deps: { ...checkDeps(api), readCrashFinding: async () => finding("other.jar") } });
  i = r.issues.find((x) => x.file === "other.jar");
  assert.deepEqual([i.reason, i.severity, i.crashed, i.fix.type], ["crashed", "warn", true, "disable"]);
  // the file changed (size differs), or another version / loader: forgotten
  for (const f of [finding("other.jar", { mod: { file: "other.jar", size: 1, mtimeMs: 1 } }), finding("other.jar", { mcVersion: "26.3" })]) {
    r = await compat.checkInstance(inst, { force: true, deps: { ...checkDeps(api), readCrashFinding: async () => f } });
    assert.equal(r.issues.some((x) => x.crashed), false);
  }
});

const IRIS_JSON = {
  id: "iris",
  name: "Iris",
  version: "1.8.8+mc1.21.1",
  environment: "client",
  entrypoints: { client: ["net.irisshaders.iris.fabric.IrisFabricMod"] },
  depends: { fabricloader: ">=0.15", minecraft: "1.21.x" },
};

test("checkInstance: Iris-style - the file says 1.21.x but Modrinth lists 1.21.1 only: reported when a 1.21.4 build exists", async () => {
  const inst = await instanceWith("iris-older-yes", "1.21.4", { "iris-fabric-1.8.8+mc1.21.1.jar": (out) => makeJar(out, IRIS_JSON) });
  const api = fakeModrinth({
    found: { "h-iris-fabric-1.8.8+mc1.21.1.jar": { id: "i1", project_id: "YL57xq9U", version_number: "1.8.8+mc1.21.1", game_versions: ["1.21", "1.21.1"], loaders: ["fabric"] } },
    updates: { "h-iris-fabric-1.8.8+mc1.21.1.jar": { id: "i2", project_id: "YL57xq9U", version_number: "1.8.8+mc1.21.4", version_type: "release", files: relFile("iris-fabric-1.8.8+mc1.21.4.jar", "4") } },
  });
  const r = await compat.checkInstance(inst, { force: true, deps: checkDeps(api) });
  assert.equal(r.issues.length, 1);
  const i = r.issues[0];
  assert.deepEqual([i.severity, i.reason, i.listedElsewhere], ["warn", "wrong-mc", true]);
  assert.equal(i.fix.type, "update");
  assert.equal(r.blocked, 0);
});

test("checkInstance: the same file with NO build for the new version is left alone (a loose range often works)", async () => {
  const inst = await instanceWith("iris-older-nobuild", "1.21.4", { "iris-fabric-1.8.8+mc1.21.1.jar": (out) => makeJar(out, IRIS_JSON) });
  const api = fakeModrinth({
    found: { "h-iris-fabric-1.8.8+mc1.21.1.jar": { id: "i1", project_id: "YL57xq9U", version_number: "1.8.8+mc1.21.1", game_versions: ["1.21", "1.21.1"], loaders: ["fabric"] } },
    updates: {},
  });
  const r = await compat.checkInstance(inst, { force: true, deps: checkDeps(api) });
  assert.equal(r.issues.length, 0);
});
