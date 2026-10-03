"use strict";
/**
 * Tests for "Reminth is never the reason the game says Incompatible mods
 * found": checking the jars it downloads, stepping aside for the player's
 * own mods, starting an installed instance with no connection, and not
 * letting a modpack plant Reminth's own bookkeeping files.
 *
 * No network (global fetch is stubbed per test and restored), no Electron,
 * no npm packages. Everything on disk happens under a throwaway HOME.
 * Run with: node --test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");

// paths.js hangs everything off os.homedir() - point that at a temp folder
// BEFORE anything requires it, so no test can touch a real Reminth install.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "reminth-fixes2-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

// electron and extract-zip aren't installed where the tests run - stub them.
const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return "STUB_ELECTRON_FIXES2";
  if (request === "extract-zip") return "STUB_EXTRACT_ZIP_FIXES2";
  return originalResolve.call(this, request, ...rest);
};
Module._cache.STUB_ELECTRON_FIXES2 = {
  id: "STUB_ELECTRON_FIXES2",
  filename: "STUB_ELECTRON_FIXES2",
  loaded: true,
  exports: { safeStorage: { isEncryptionAvailable: () => false } },
};
Module._cache.STUB_EXTRACT_ZIP_FIXES2 = {
  id: "STUB_EXTRACT_ZIP_FIXES2",
  filename: "STUB_EXTRACT_ZIP_FIXES2",
  loaded: true,
  exports: async () => {},
};

const paths = require("../src/main/paths");
const config = require("../src/main/config");
const minecraft = require("../src/main/minecraft");
const loaders = require("../src/main/loaders");
const mrpack = require("../src/main/mrpack");
const skin = require("../src/main/skin");
const zip = require("../src/main/zip");

const tmpDir = (name) => fsp.mkdtemp(path.join(HOME, `${name}-`));
const exists = (p) => fsp.access(p).then(() => true, () => false);

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
const offline = async () => {
  throw new TypeError("fetch failed");
};

/** The bytes of a Fabric mod jar whose fabric.mod.json is `meta`. */
async function jarBytes(meta) {
  const src = await tmpDir("jarsrc");
  await fsp.writeFile(path.join(src, "fabric.mod.json"), JSON.stringify({ schemaVersion: 1, ...meta }));
  const out = path.join(await tmpDir("jarout"), "out.jar");
  await zip.buildZip(src, out);
  return fsp.readFile(out);
}

/** An instance folder with real jars in mods/: { "<file>": fabric.mod.json fields }. */
async function instanceWith(jars, { managed = null, tracked = null } = {}) {
  const gameDir = await tmpDir("game");
  const modsDir = path.join(gameDir, "mods");
  await fsp.mkdir(modsDir);
  for (const [file, meta] of Object.entries(jars)) await fsp.writeFile(path.join(modsDir, file), await jarBytes(meta));
  await fsp.mkdir(path.join(gameDir, ".reminth"));
  if (managed) await fsp.writeFile(path.join(gameDir, ".reminth", "managed-mods.json"), JSON.stringify({ version: 1, files: managed }));
  if (tracked) {
    const files = {};
    for (const f of tracked) files[`mods/${f}`] = { kind: "mod" };
    await fsp.writeFile(path.join(gameDir, ".reminth", "content.json"), JSON.stringify({ version: 1, files }));
  }
  return {
    gameDir,
    modsDir,
    list: async () => (await fsp.readdir(modsDir)).sort(),
    managed: async () => JSON.parse(await fsp.readFile(path.join(gameDir, ".reminth", "managed-mods.json"), "utf8")).files,
    log: () => fsp.readFile(path.join(gameDir, "reminth-performance-mods.log"), "utf8"),
  };
}

/** One item the way content.listAll(gameDir).mod returns it - only the fields the rules read. */
const mod = (file, modId, extra = {}) => ({
  file,
  enabled: true,
  valid: true,
  folder: false,
  modId,
  modVersion: "1.0.0",
  depends: null,
  breaks: null,
  provides: [],
  nested: [],
  mcDep: null,
  modifiedAt: 1,
  ...extra,
});
const NONE = new Set(); // content.json lists nothing
const OURS = {
  "sodium-fabric-0.6.5+mc1.21.1.jar": { mod: "sodium" },
  "lithium-fabric-0.14.3+mc1.21.1.jar": { mod: "lithium" },
  "fabric-api-0.110.0+1.21.1.jar": { mod: "fabric-api" },
  "reminthhud-1.0.0.jar": { mod: "reminthhud" },
};
const OUR_MODS = [
  mod("sodium-fabric-0.6.5+mc1.21.1.jar", "sodium", { modVersion: "0.6.5+mc1.21.1" }),
  mod("lithium-fabric-0.14.3+mc1.21.1.jar", "lithium", { modVersion: "0.14.3+mc1.21.1" }),
  mod("fabric-api-0.110.0+1.21.1.jar", "fabric-api", { modVersion: "0.110.0+1.21.1" }),
  mod("reminthhud-1.0.0.jar", "reminthhud"),
];
const removedFiles = (plan) => plan.remove.map((r) => r.file).sort();

/* ---------------- planStepAside (pure) ---------------- */

test("planStepAside: nothing to do when the player's mods don't touch Reminth's", () => {
  const mods = [...OUR_MODS, mod("iris-1.8.jar", "iris", { depends: { sodium: ">=0.6.0" } }), mod("jei.jar", "jei")];
  assert.deepEqual(minecraft.planStepAside({ mods, managed: OURS, tracked: NONE, mcVersion: "1.21.1" }), { disown: [], remove: [], lines: [] });
  assert.deepEqual(minecraft.planStepAside({ mods: [], managed: {}, tracked: NONE }), { disown: [], remove: [], lines: [] });
});

test("planStepAside: the player's own copy wins, whatever its file is called", () => {
  const mods = [...OUR_MODS, mod("my sodium build.jar", "sodium", { modVersion: "0.6.0" })];
  const plan = minecraft.planStepAside({ mods, managed: OURS, tracked: NONE, mcVersion: "1.21.1" });
  assert.deepEqual(plan.remove, [{ file: "sodium-fabric-0.6.5+mc1.21.1.jar", mod: "sodium", reason: "own", because: "my sodium build.jar" }]);
  assert.deepEqual(plan.lines, ["Left Sodium out: you have your own copy (my sodium build.jar)"]);
  assert.deepEqual(plan.disown, []);
  // a mod that stands in for it ("provides") counts as a copy too
  const fork = [...OUR_MODS, mod("embeddium.jar", "embeddium", { provides: ["sodium"] })];
  assert.deepEqual(removedFiles(minecraft.planStepAside({ mods: fork, managed: OURS, tracked: NONE })), ["sodium-fabric-0.6.5+mc1.21.1.jar"]);
});

test("planStepAside: a copy the player switched off doesn't count - Reminth keeps its own", () => {
  const mods = [...OUR_MODS, mod("sodium-old.jar.disabled", "sodium", { enabled: false })];
  assert.deepEqual(minecraft.planStepAside({ mods, managed: OURS, tracked: NONE, mcVersion: "1.21.1" }).remove, []);
  // nor does a folder, or a file Minecraft wouldn't load
  const junk = [...OUR_MODS, mod("sodium", "sodium", { folder: true }), mod("sodium.zip", "sodium", { valid: false })];
  assert.deepEqual(minecraft.planStepAside({ mods: junk, managed: OURS, tracked: NONE }).remove, []);
});

test("planStepAside: a player's copy for another Minecraft version isn't a copy to step aside for", () => {
  const mods = [...OUR_MODS, mod("sodium-fabric-0.5.8+mc1.20.1.jar", "sodium", { mcDep: "1.20.1" })];
  assert.deepEqual(minecraft.planStepAside({ mods, managed: OURS, tracked: NONE, mcVersion: "1.21.1" }).remove, []);
  // with a range that does accept this version, it is
  const fits = [...OUR_MODS, mod("sodium-custom.jar", "sodium", { mcDep: ">=1.21" })];
  assert.equal(minecraft.planStepAside({ mods: fits, managed: OURS, tracked: NONE, mcVersion: "1.21.1" }).remove.length, 1);
});

test("planStepAside: a player's mod that breaks one of Reminth's - Reminth's goes, the player's never does", () => {
  const mods = [...OUR_MODS, mod("optifabric.jar", "optifabric", { breaks: { sodium: "*" } })];
  const plan = minecraft.planStepAside({ mods, managed: OURS, tracked: NONE, mcVersion: "1.21.1" });
  assert.deepEqual(plan.remove, [{ file: "sodium-fabric-0.6.5+mc1.21.1.jar", mod: "sodium", reason: "broken-by", because: "optifabric.jar" }]);
  assert.deepEqual(plan.lines, ["Left Sodium out: optifabric.jar says it can't run next to it"]);
  // a "breaks" for versions Reminth's copy isn't doesn't apply
  const narrow = [...OUR_MODS, mod("picky.jar", "picky", { breaks: { sodium: "<0.6.0" } })];
  assert.deepEqual(minecraft.planStepAside({ mods: narrow, managed: OURS, tracked: NONE }).remove, []);
});

test("planStepAside: one of Reminth's that breaks a player's mod steps aside", () => {
  const mods = OUR_MODS.map((m) => (m.modId === "lithium" ? { ...m, breaks: { carpet: "*" } } : m)).concat(mod("fabric-carpet.jar", "carpet"));
  const plan = minecraft.planStepAside({ mods, managed: OURS, tracked: NONE, mcVersion: "1.21.1" });
  assert.deepEqual(plan.remove, [{ file: "lithium-fabric-0.14.3+mc1.21.1.jar", mod: "lithium", reason: "breaks", because: "fabric-carpet.jar" }]);
  assert.deepEqual(plan.lines, ["Left Lithium out: this build says it can't run next to fabric-carpet.jar"]);
});

test("planStepAside: one of Reminth's that needs another version of a player's mod steps aside", () => {
  const mods = OUR_MODS.filter((m) => m.modId !== "fabric-api")
    .map((m) => (m.modId === "sodium" ? { ...m, depends: { "fabric-api": ">=0.110.0", minecraft: "1.21.1" } } : m))
    .concat(mod("fabric-api-0.100.0+1.21.jar", "fabric-api", { modVersion: "0.100.0+1.21" }));
  const managed = { ...OURS };
  delete managed["fabric-api-0.110.0+1.21.1.jar"];
  const plan = minecraft.planStepAside({ mods, managed, tracked: NONE, mcVersion: "1.21.1" });
  assert.deepEqual(removedFiles(plan), ["sodium-fabric-0.6.5+mc1.21.1.jar"]);
  assert.equal(plan.remove[0].reason, "depends");
  assert.match(plan.lines[0], /^Left Sodium out: this build needs fabric-api .*fabric-api-0\.100\.0\+1\.21\.jar is 0\.100\.0\+1\.21$/);
  // a dependency that is satisfied, or simply absent from the folder, is not a problem
  const fine = OUR_MODS.map((m) => (m.modId === "sodium" ? { ...m, depends: { "fabric-api": ">=0.100.0", "some-lib": "*" } } : m));
  assert.deepEqual(minecraft.planStepAside({ mods: fine, managed: OURS, tracked: NONE }).remove, []);
});

test("planStepAside: a player's mod wanting a different Sodium is the player's to sort out - nothing is removed", () => {
  const mods = [...OUR_MODS, mod("sodium-extra.jar", "sodium-extra", { depends: { sodium: ">=0.7.0" } })];
  assert.deepEqual(minecraft.planStepAside({ mods, managed: OURS, tracked: NONE, mcVersion: "1.21.1" }).remove, []);
});

test("planStepAside: a file in both lists is the player's - forgotten by Reminth, never deleted", () => {
  const tracked = new Set(["sodium-fabric-0.6.5+mc1.21.1.jar"]);
  const plan = minecraft.planStepAside({ mods: OUR_MODS, managed: OURS, tracked, mcVersion: "1.21.1" });
  assert.deepEqual(plan.disown, ["sodium-fabric-0.6.5+mc1.21.1.jar"]);
  assert.deepEqual(plan.remove, []);
  assert.match(plan.lines[0], /sodium-fabric-0\.6\.5\+mc1\.21\.1\.jar is yours now/);
  // ...and from then on it is "the player's own copy": an older Reminth copy next to it goes
  const mods = [...OUR_MODS, mod("sodium-fabric-0.6.0+mc1.21.1.jar", "sodium", { modVersion: "0.6.0+mc1.21.1" })];
  const managed = { ...OURS, "sodium-fabric-0.6.0+mc1.21.1.jar": { mod: "sodium" } };
  const both = minecraft.planStepAside({ mods, managed, tracked, mcVersion: "1.21.1" });
  assert.deepEqual(removedFiles(both), ["sodium-fabric-0.6.0+mc1.21.1.jar"]);
  // names are compared the way Windows compares them
  const shouty = minecraft.planStepAside({ mods: OUR_MODS, managed: { "Sodium-Fabric.JAR": { mod: "sodium" } }, tracked: new Set(["sodium-fabric.jar"]) });
  assert.deepEqual(shouty.disown, ["Sodium-Fabric.JAR"]);
});

test("planStepAside: Fabric API - the player's own copy wins, otherwise it is left alone", () => {
  // their own, dropped in by hand under another name
  const byHand = [...OUR_MODS, mod("fabric-api-0.105.0+1.21.1.jar", "fabric-api", { modVersion: "0.105.0+1.21.1" })];
  const plan = minecraft.planStepAside({ mods: byHand, managed: OURS, tracked: NONE, mcVersion: "1.21.1" });
  assert.deepEqual(plan.remove, [{ file: "fabric-api-0.110.0+1.21.1.jar", mod: "fabric-api", reason: "own", because: "fabric-api-0.105.0+1.21.1.jar" }]);
  assert.deepEqual(plan.lines, ["Left Fabric API out: you have your own copy (fabric-api-0.105.0+1.21.1.jar)"]);
  // their own, installed through the mod browser
  const viaBrowser = minecraft.planStepAside({ mods: byHand, managed: OURS, tracked: new Set(["fabric-api-0.105.0+1.21.1.jar"]), mcVersion: "1.21.1" });
  assert.deepEqual(removedFiles(viaBrowser), ["fabric-api-0.110.0+1.21.1.jar"]);
  // a mod that breaks Fabric API, or Fabric API breaking something: not Reminth's call
  const clash = OUR_MODS.map((m) => (m.modId === "fabric-api" ? { ...m, breaks: { oldmod: "*" } } : m)).concat(
    mod("oldmod.jar", "oldmod", { breaks: { "fabric-api": "*", reminthhud: "*" } })
  );
  assert.deepEqual(minecraft.planStepAside({ mods: clash, managed: OURS, tracked: NONE }).remove, []);
  // and the HUD stays even if someone ships a mod with its id
  const hud = [...OUR_MODS, mod("fake.jar", "reminthhud")];
  assert.deepEqual(minecraft.planStepAside({ mods: hud, managed: OURS, tracked: NONE }).remove, []);
});

test("planStepAside: when content.json can't be read, nothing is changed", () => {
  const mods = [...OUR_MODS, mod("my-sodium.jar", "sodium")];
  assert.deepEqual(minecraft.planStepAside({ mods, managed: OURS, tracked: null }), { disown: [], remove: [], lines: [] });
  assert.equal(minecraft.planOwnCopies({ mods, managed: OURS, tracked: null }).size, 0);
});

test("planStepAside: only ever removes files from Reminth's own list", () => {
  const mods = [
    ...OUR_MODS.map((m) => (m.modId === "sodium" ? { ...m, breaks: { a: "*" }, depends: { b: ">=9" } } : m)),
    mod("a.jar", "a", { breaks: { lithium: "*", sodium: "*" } }),
    mod("b.jar", "b", { breaks: { a: "*" } }),
    mod("lithium-mine.jar", "lithium"),
    mod("fabric-api-mine.jar", "fabric-api"),
  ];
  const plan = minecraft.planStepAside({ mods, managed: OURS, tracked: NONE });
  const ours = new Set(Object.keys(OURS));
  assert.ok(plan.remove.length >= 3);
  for (const r of plan.remove) assert.ok(ours.has(r.file), `${r.file} is not Reminth's`);
  assert.equal(new Set(plan.remove.map((r) => r.file)).size, plan.remove.length, "each file listed once");
});

/* ---------------- planOwnCopies (pure) ---------------- */

test("planOwnCopies: finds the player's own copies before anything is downloaded", () => {
  const key = (m) => String(m.label || m.repo).toLowerCase();
  const first = key(config.PERFORMANCE_MODS[0]);
  const mods = [
    ...OUR_MODS,
    mod("mine.jar", first),
    mod("fabric-api-mine.jar", "fabric-api"),
    mod("off.jar.disabled", key(config.PERFORMANCE_MODS[1]), { enabled: false }),
  ];
  const own = minecraft.planOwnCopies({ mods, managed: OURS, tracked: NONE, mcVersion: "1.21.1" });
  assert.deepEqual([...own.entries()].sort(), [["fabric-api", "fabric-api-mine.jar"], [first, "mine.jar"]].sort());
  // Reminth's own copies are not "the player's"
  assert.equal(minecraft.planOwnCopies({ mods: OUR_MODS, managed: OURS, tracked: NONE }).size, 0);
  // unless the player installed that very file through the mod browser
  const tracked = new Set(["sodium-fabric-0.6.5+mc1.21.1.jar"]);
  assert.deepEqual([...minecraft.planOwnCopies({ mods: OUR_MODS, managed: OURS, tracked }).entries()], [["sodium", "sodium-fabric-0.6.5+mc1.21.1.jar"]]);
});

/* ---------------- stepAsideForPlayerMods (on disk) ---------------- */

test("stepAsideForPlayerMods: removes Reminth's copy, keeps the player's, and updates the manifest and this run's list", async () => {
  const inst = await instanceWith(
    {
      "sodium-fabric-0.6.5+mc1.21.1.jar": { id: "sodium", version: "0.6.5", depends: { minecraft: "1.21.1" } },
      "lithium-fabric-0.14.3+mc1.21.1.jar": { id: "lithium", version: "0.14.3" },
      "my-sodium.jar": { id: "sodium", version: "0.6.0", depends: { minecraft: ">=1.21" } },
      "nolithium.jar": { id: "nolithium", version: "1.0.0", breaks: { lithium: "*" } },
    },
    { managed: { "sodium-fabric-0.6.5+mc1.21.1.jar": { mod: "sodium" } } }
  );
  // Lithium was installed by this very run: not in the manifest yet.
  const installed = [
    { file: "sodium-fabric-0.6.5+mc1.21.1.jar", mod: "sodium", own: true },
    { file: "lithium-fabric-0.14.3+mc1.21.1.jar", mod: "lithium", own: true },
  ];
  const out = await minecraft.stepAsideForPlayerMods(inst.gameDir, installed, { mcVersion: "1.21.1" });
  assert.deepEqual(out.removed.sort(), ["lithium-fabric-0.14.3+mc1.21.1.jar", "sodium-fabric-0.6.5+mc1.21.1.jar"]);
  assert.deepEqual(await inst.list(), ["my-sodium.jar", "nolithium.jar"]);
  assert.deepEqual(await inst.managed(), {});
  assert.deepEqual(installed, []);
  assert.ok(out.lines.includes("Left Sodium out: you have your own copy (my-sodium.jar)"));
  assert.ok(out.lines.includes("Left Lithium out: nolithium.jar says it can't run next to it"));
  // the tidy that follows has nothing "fresh" to justify deleting anything else
  assert.deepEqual(await minecraft.tidyManagedMods(inst.modsDir, installed), []);
  assert.deepEqual(await inst.list(), ["my-sodium.jar", "nolithium.jar"]);
});

test("stepAsideForPlayerMods: a jar in both manifests becomes the player's and is not deleted", async () => {
  const inst = await instanceWith(
    { "sodium-fabric-0.6.5+mc1.21.1.jar": { id: "sodium", version: "0.6.5" } },
    { managed: { "sodium-fabric-0.6.5+mc1.21.1.jar": { mod: "sodium" } }, tracked: ["sodium-fabric-0.6.5+mc1.21.1.jar"] }
  );
  const installed = [{ file: "sodium-fabric-0.6.5+mc1.21.1.jar", mod: "sodium", own: true }];
  const out = await minecraft.stepAsideForPlayerMods(inst.gameDir, installed, { mcVersion: "1.21.1" });
  assert.deepEqual(out.removed, []);
  assert.deepEqual(await inst.list(), ["sodium-fabric-0.6.5+mc1.21.1.jar"]);
  assert.deepEqual(await inst.managed(), {});
  assert.deepEqual(installed, []);
  // switching the performance pack off later must not take the player's file with it
  assert.deepEqual(await minecraft.tidyManagedMods(inst.modsDir, installed, { dropPerf: true }), []);
  assert.deepEqual(await inst.list(), ["sodium-fabric-0.6.5+mc1.21.1.jar"]);
  // and next launch Reminth doesn't fetch its own
  assert.deepEqual([...(await minecraft.findPlayerCopies(inst.gameDir, "1.21.1")).keys()], ["sodium"]);
});

test("stepAsideForPlayerMods: a disabled player copy and unrelated mods change nothing", async () => {
  const inst = await instanceWith(
    {
      "sodium-fabric-0.6.5+mc1.21.1.jar": { id: "sodium", version: "0.6.5" },
      "my-sodium.jar.disabled": { id: "sodium", version: "0.6.0" },
      "jei.jar": { id: "jei", version: "1.0.0" },
    },
    { managed: { "sodium-fabric-0.6.5+mc1.21.1.jar": { mod: "sodium" } } }
  );
  const installed = [{ file: "sodium-fabric-0.6.5+mc1.21.1.jar", mod: "sodium", own: true }];
  const out = await minecraft.stepAsideForPlayerMods(inst.gameDir, installed, { mcVersion: "1.21.1" });
  assert.deepEqual(out, { removed: [], lines: [] });
  assert.equal((await inst.list()).length, 3);
  assert.deepEqual(await inst.managed(), { "sodium-fabric-0.6.5+mc1.21.1.jar": { mod: "sodium" } });
  assert.equal(installed.length, 1);
  assert.equal((await minecraft.findPlayerCopies(inst.gameDir, "1.21.1")).size, 0);
});

test("stepAsideForPlayerMods: an instance with nothing of Reminth's is left untouched", async () => {
  const inst = await instanceWith({ "sodium.jar": { id: "sodium", version: "1" }, "sodium-2.jar": { id: "sodium", version: "2" } });
  assert.deepEqual(await minecraft.stepAsideForPlayerMods(inst.gameDir, [], { mcVersion: "1.21.1" }), { removed: [], lines: [] });
  assert.equal((await inst.list()).length, 2);
  assert.equal(await exists(path.join(inst.gameDir, ".reminth", "managed-mods.json")), false);
});

/* ---------------- downloadPerformanceMods: every jar is checked ---------------- */

/** GitHub + asset downloads for the performance pack: one release per repo, built by `jarFor(repo)`. */
function githubStub(mcVersion, jarFor, seen = []) {
  return async (url) => {
    url = String(url);
    seen.push(url);
    const api = url.match(/^https:\/\/api\.github\.com\/repos\/[^/]+\/([^/]+)\/releases/);
    if (api) {
      const repo = api[1];
      const name = `${repo.toLowerCase()}-fabric-1.0.0+mc${mcVersion}.jar`;
      return new Response(
        JSON.stringify([{ tag_name: `mc${mcVersion}-1.0.0`, name: "", body: "", assets: [{ name, size: 1000, browser_download_url: `https://github.com/dl/${name}` }] }]),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    const dl = url.match(/^https:\/\/github\.com\/dl\/([^-]+)-/);
    if (dl) return new Response(await jarFor(dl[1]), { status: 200 });
    return new Response("nope", { status: 404 });
  };
}

test("downloadPerformanceMods: a jar that says it's for another Minecraft version is deleted again and logged", async () => {
  const inst = await instanceWith({});
  const [bad, ...good] = config.PERFORMANCE_MODS.map((m) => m.repo.toLowerCase());
  const jarFor = (repo) => jarBytes({ id: repo, version: "1.0.0", depends: { minecraft: repo === bad ? "1.20.1" : ">=1.21" } });
  const detail = [];
  const installed = await withFetch(githubStub("1.21.1", jarFor), () =>
    minecraft.downloadPerformanceMods(inst.modsDir, "1.21.1", null, detail, { loader: "fabric" })
  );
  assert.deepEqual(installed.sort(), good.map((r) => `${r}-fabric-1.0.0+mc1.21.1.jar`).sort());
  assert.deepEqual(await inst.list(), installed.slice().sort());
  assert.equal(detail.length, good.length);
  assert.ok(!detail.some((d) => d.file.startsWith(bad)));
  const log = await inst.log();
  assert.match(log, new RegExp(`Skipped ${config.PERFORMANCE_MODS[0].label}: the build GitHub offered is not for 1\\.21\\.1 \\(it needs Minecraft .*1\\.20\\.1.*\\)`));
  assert.match(log, new RegExp(`Installed ${config.PERFORMANCE_MODS[1].label}: `));
});

test("downloadPerformanceMods: a Forge build is refused on Fabric; a jar that says nothing is kept", async () => {
  const inst = await instanceWith({});
  const [forgeOne, silent] = config.PERFORMANCE_MODS.map((m) => m.repo.toLowerCase());
  const forgeJar = async () => {
    const src = await tmpDir("forgesrc");
    await fsp.mkdir(path.join(src, "META-INF"));
    await fsp.writeFile(path.join(src, "META-INF", "mods.toml"), 'modLoader="javafml"\n');
    const out = path.join(await tmpDir("forgeout"), "f.jar");
    await zip.buildZip(src, out);
    return fsp.readFile(out);
  };
  const jarFor = (repo) => (repo === forgeOne ? forgeJar() : repo === silent ? Buffer.from("not even a zip") : jarBytes({ id: repo, version: "1" }));
  const installed = await withFetch(githubStub("1.21.1", jarFor), () =>
    minecraft.downloadPerformanceMods(inst.modsDir, "1.21.1", null, null, { loader: "quilt" })
  );
  assert.ok(!installed.some((f) => f.startsWith(forgeOne)), "the Forge build must not count as installed");
  assert.ok(installed.some((f) => f.startsWith(silent)), "no way to tell = keep");
  assert.ok(!(await inst.list()).some((f) => f.startsWith(forgeOne)));
  assert.match(await inst.log(), /Skipped .*\(it is a Forge\/NeoForge build\)/);
});

test("downloadPerformanceMods: a wrong jar the player already had under that name is not deleted", async () => {
  const [first] = config.PERFORMANCE_MODS.map((m) => m.repo.toLowerCase());
  const name = `${first}-fabric-1.0.0+mc1.21.1.jar`;
  const inst = await instanceWith({ [name]: { id: first, version: "1.0.0", depends: { minecraft: "1.20.1" } } });
  const jarFor = (repo) => jarBytes({ id: repo, version: "1.0.0", depends: { minecraft: ">=1.21" } });
  const detail = [];
  const installed = await withFetch(githubStub("1.21.1", jarFor), () =>
    minecraft.downloadPerformanceMods(inst.modsDir, "1.21.1", null, detail, { loader: "fabric", isOurs: (f) => f !== name })
  );
  assert.ok(!installed.includes(name));
  assert.ok(!detail.some((d) => d.file === name), "never recorded as Reminth's");
  assert.ok((await inst.list()).includes(name), "the player's file stays");
  assert.match(await inst.log(), /was already in your mods folder, so it was left alone/);
});

test("downloadPerformanceMods: a mod the player has their own copy of is not looked up or downloaded", async () => {
  const inst = await instanceWith({});
  const keys = config.PERFORMANCE_MODS.map((m) => String(m.label || m.repo).toLowerCase());
  const seen = [];
  const jarFor = (repo) => jarBytes({ id: repo, version: "1.0.0" });
  const installed = await withFetch(githubStub("1.21.1", jarFor, seen), () =>
    minecraft.downloadPerformanceMods(inst.modsDir, "1.21.1", null, null, { loader: "fabric", skip: new Map([[keys[0], "my-own.jar"]]) })
  );
  assert.equal(installed.length, config.PERFORMANCE_MODS.length - 1);
  assert.ok(!seen.some((u) => u.toLowerCase().includes(`/${config.PERFORMANCE_MODS[0].repo.toLowerCase()}/`)), "no GitHub request for the skipped mod");
  assert.match(await inst.log(), new RegExp(`Left ${config.PERFORMANCE_MODS[0].label} out: you have your own copy \\(my-own\\.jar\\)`));
});

/* ---------------- loaders: an installed instance starts with no connection ---------------- */

const PROFILE_DIR = path.join(paths.VERSIONS_DIR, "_loader-profiles");
const INSTALLER_DIR = path.join(paths.ROOT, "cache", "loader-installers");
async function cachedProfile(name, json, mtime) {
  await fsp.mkdir(PROFILE_DIR, { recursive: true });
  const file = path.join(PROFILE_DIR, name);
  await fsp.writeFile(file, JSON.stringify(json));
  if (mtime) await fsp.utimes(file, mtime, mtime);
}
async function cachedInstaller(folder, bytes = "jar") {
  await fsp.mkdir(path.join(INSTALLER_DIR, folder), { recursive: true });
  await fsp.writeFile(path.join(INSTALLER_DIR, folder, "installer.jar"), bytes);
}

test("loaders: with no connection, an unpinned Fabric/Quilt instance uses the build it last started with", async () => {
  const profile = (mc) => ({ id: "x", inheritsFrom: mc, mainClass: "net.fabricmc.loader.impl.launch.knot.KnotClient", libraries: [] });
  await cachedProfile("fabric-1.21.1-0.16.5.json", profile("1.21.1"), new Date(2024, 0, 1));
  await cachedProfile("fabric-1.21.1-0.16.9.json", profile("1.21.1"), new Date(2024, 5, 1));
  await cachedProfile("fabric-1.21.10-0.17.0.json", profile("1.21.10"), new Date(2025, 0, 1));
  await cachedProfile("fabric-1.21-pre1-0.15.0.json", profile("1.21-pre1"), new Date(2025, 0, 1));
  await cachedProfile("fabric-1.21-0.15.11.json", profile("1.21"), new Date(2023, 0, 1));
  await cachedProfile("fabric-1.21.1-0.1.0.json", "half-written", new Date(2026, 0, 1));
  await cachedProfile("quilt-1.21.1-0.26.0.json", profile("1.21.1"));
  await withFetch(offline, async () => {
    assert.equal(await loaders.defaultLoaderVersion("fabric", "1.21.1"), "0.16.9");
    assert.deepEqual(await loaders.installedLoaderVersions("fabric", "1.21.1"), ["0.16.9", "0.16.5"]);
    assert.equal(await loaders.defaultLoaderVersion("fabric", "1.21"), "0.15.11", "a snapshot's profile isn't this version's");
    assert.equal(await loaders.defaultLoaderVersion("quilt", "1.21.1"), "0.26.0");
    // never installed here: the real (network) error still comes through
    await assert.rejects(loaders.defaultLoaderVersion("fabric", "1.19.2"), /fetch failed/);
    await assert.rejects(loaders.defaultLoaderVersion("quilt", "1.20.1"), /fetch failed/);
  });
});

test("loaders: with no connection, Forge and NeoForge resolve from the installers already downloaded", async () => {
  await cachedInstaller("forge-1.20.1-47.4.0");
  await cachedInstaller("forge-1.7.10-10.13.4.1614-1.7.10");
  await cachedInstaller("forge-1.19.2-43.3.0", ""); // an empty file is not a download
  await cachedInstaller("neoforge-21.1.77");
  await cachedInstaller("neoforge-1.20.1-47.1.106");
  await withFetch(offline, async () => {
    const forge = await loaders.installerFor("forge", "1.20.1", "47.4.0");
    assert.equal(forge.key, "forge-1.20.1-47.4.0");
    assert.match(forge.url, /forge-1\.20\.1-47\.4\.0-installer\.jar$/);
    assert.equal((await loaders.installerFor("forge", "1.7.10", "10.13.4.1614")).version, "1.7.10-10.13.4.1614-1.7.10");
    assert.equal(await loaders.defaultLoaderVersion("forge", "1.20.1"), "47.4.0");
    await assert.rejects(loaders.installerFor("forge", "1.20.1", "47.3.0"), /fetch failed/);
    await assert.rejects(loaders.installerFor("forge", "1.19.2", "43.3.0"), /fetch failed/);
    await assert.rejects(loaders.defaultLoaderVersion("forge", "1.19.2"), /fetch failed/);

    assert.equal(await loaders.defaultLoaderVersion("neoforge", "1.21.1"), "21.1.77");
    assert.equal((await loaders.installerFor("neoforge", "1.21.1", "21.1.77")).key, "neoforge-21.1.77");
    assert.equal(await loaders.defaultLoaderVersion("neoforge", "1.20.1"), "47.1.106");
    const legacy = await loaders.installerFor("neoforge", "1.20.1", "47.1.106");
    assert.equal(legacy.key, "neoforge-1.20.1-47.1.106");
    await assert.rejects(loaders.installerFor("neoforge", "1.20.1", "47.1.99"), /doesn't exist/);
    await assert.rejects(loaders.defaultLoaderVersion("neoforge", "1.20.4"), /fetch failed/);
  });
});

test("loaders: the maven list has a time limit, and one fetched earlier is still used when the server stops answering", async () => {
  const xml = "<metadata><versions><version>1.18.2-40.2.0</version><version>1.18.2-40.2.21</version></versions></metadata>";
  let signal = null;
  await withFetch(
    async (url, init) => {
      if (!String(url).endsWith("maven-metadata.xml")) return new Response("{}", { status: 200 });
      signal = init && init.signal;
      return new Response(xml, { status: 200 });
    },
    async () => assert.equal((await loaders.installerFor("forge", "1.18.2", "40.2.21")).version, "1.18.2-40.2.21")
  );
  assert.ok(signal instanceof AbortSignal, "the maven list request carries a time limit");
  const realNow = Date.now;
  Date.now = () => realNow() + 60 * 60 * 1000; // well past the 15 minute cache
  try {
    await withFetch(offline, async () => {
      assert.equal((await loaders.installerFor("forge", "1.18.2", "40.2.0")).version, "1.18.2-40.2.0");
    });
  } finally {
    Date.now = realNow;
  }
});

/* ---------------- mrpack: overrides can't plant Reminth's own files ---------------- */

test("mrpack copyTree: a pack's top-level .reminth folder is never copied, in any spelling", async () => {
  const src = await tmpDir("overrides");
  const dest = await tmpDir("packgame");
  const put = async (rel, text = "x") => {
    await fsp.mkdir(path.dirname(path.join(src, rel)), { recursive: true });
    await fsp.writeFile(path.join(src, rel), text);
  };
  await put(".reminth/content.json", '{"files":{"mods/evil.jar":{}}}');
  await put(".reminth/managed-mods.json", '{"files":{"jei.jar":{"mod":"sodium"}}}');
  await put(".ReMinth2/keep.txt");
  await put("config/.reminth/fine.txt");
  await put("config/sodium-options.json", "{}");
  await put("options.txt");
  await mrpack.copyTree(src, dest);
  assert.equal(await exists(path.join(dest, ".reminth")), false);
  assert.equal(await exists(path.join(dest, "options.txt")), true);
  assert.equal(await exists(path.join(dest, "config", "sodium-options.json")), true);
  assert.equal(await exists(path.join(dest, "config", ".reminth", "fine.txt")), true, "only the top-level folder is Reminth's");
  assert.equal(await exists(path.join(dest, ".ReMinth2", "keep.txt")), true, "a different name is just a folder");

  // other spellings of the same folder (as Windows sees them)
  for (const name of [".REMINTH", ".Reminth"]) {
    const s = await tmpDir("overrides");
    const d = await tmpDir("packgame");
    await fsp.mkdir(path.join(s, name));
    await fsp.writeFile(path.join(s, name, "content.json"), "{}");
    await fsp.writeFile(path.join(s, "a.txt"), "a");
    await mrpack.copyTree(s, d);
    assert.deepEqual(await fsp.readdir(d), ["a.txt"]);
  }
  // a missing overrides folder is fine
  await mrpack.copyTree(path.join(src, "nope"), dest);
});

/* ---------------- skin: requests give up instead of hanging ---------------- */

test("skin: lookups carry a time limit and a timeout reads like one", async () => {
  let signal = null;
  const timedOut = async (url, init) => {
    signal = init && init.signal;
    const err = new Error("The operation was aborted due to timeout");
    err.name = "TimeoutError";
    throw err;
  };
  await withFetch(timedOut, async () => {
    await assert.rejects(skin.lookupByUsername("Notch"), /Timed out reaching api\.mojang\.com/);
    assert.ok(signal instanceof AbortSignal);
    await assert.rejects(skin.getProfile({ minecraftAccessToken: "t" }), /Timed out reaching api\.minecraftservices\.com/);
  });
  // any other failure is passed on as it was
  await withFetch(offline, async () => {
    await assert.rejects(skin.lookupByUsername("Notch"), /fetch failed/);
  });
});
