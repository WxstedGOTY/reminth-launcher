"use strict";
/**
 * Tests for performance profiles (perfProfiles.js), the starting options.txt
 * a brand-new instance may get (gameOptions.js), the `perfProfile` field on
 * instances, and the main-process IPC that serves them - main.js loaded
 * against a fake Electron.
 *
 * No network, no Electron, no Minecraft: client jars are zips built here and
 * Modrinth is a fake object. Everything on disk happens under a throwaway
 * HOME. Whether the game itself keeps the written values is NOT tested here
 * (that needs the real game, per version family).
 * Run with: node --test test/perf-profiles.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "reminth-perfprofiles-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

/* ---------------- a fake Electron, enough for main.js to load ---------------- */

const ipc = new Map();
let appReady;
const whenReady = new Promise((resolve) => (appReady = resolve));
const toRenderer = []; // [channel, payload] main.js sent
class FakeWebContents extends EventEmitter {
  send(channel, payload) {
    toRenderer.push([channel, payload]);
  }
  setWindowOpenHandler() {}
  getURL() {
    return "";
  }
}
class FakeWindow extends EventEmitter {
  constructor() {
    super();
    this.webContents = new FakeWebContents();
    FakeWindow.last = this; // main.js's window, for the window tests
  }
  loadFile() {
    setImmediate(() => this.webContents.emit("did-finish-load"));
    return Promise.resolve();
  }
  isDestroyed() {
    return false;
  }
  isMinimized() {
    return false;
  }
  isMaximized() {
    return false;
  }
  getBounds() {
    return { x: -8, y: -8, width: 1936, height: 1048 };
  }
  maximize() {}
  unmaximize() {}
  minimize() {}
  restore() {}
  show() {}
  focus() {}
  close() {}
}
const noop = () => {};
const fakeElectron = {
  app: { requestSingleInstanceLock: () => true, on: noop, quit: noop, whenReady: () => whenReady, getVersion: () => "0.0.0-test", disableHardwareAcceleration: noop },
  BrowserWindow: FakeWindow,
  ipcMain: { handle: (channel, fn) => ipc.set(channel, fn), on: noop },
  shell: { openExternal: noop, openPath: async () => "", trashItem: async () => {} },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }), getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1032 } }) },
  safeStorage: { isEncryptionAvailable: () => false },
  desktopCapturer: { getSources: async () => [] },
  globalShortcut: { register: () => true, unregisterAll: noop, unregister: noop },
  Notification: class {
    static isSupported() {
      return false;
    }
    show() {}
  },
};
const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return "STUB_ELECTRON_PERFPROFILES";
  return originalResolve.call(this, request, ...rest);
};
Module._cache.STUB_ELECTRON_PERFPROFILES = { id: "STUB_ELECTRON_PERFPROFILES", filename: "STUB_ELECTRON_PERFPROFILES", loaded: true, exports: fakeElectron };

const gameOptions = require("../src/main/gameOptions");
const perfProfiles = require("../src/main/perfProfiles");
const instances = require("../src/main/instances");
const zip = require("../src/main/zip");

// The main.js part below swaps these for fakes when this file loads (before
// any test runs), so the instance tests keep the real ones here.
const realInstances = { create: instances.create, update: instances.update };

let seq = 0;
/** A fresh, empty instance folder. */
async function freshDir() {
  const dir = path.join(HOME, "inst", `g${++seq}`);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}
/** A "client jar" whose version.json says `versionJson` (or none at all when null). */
async function clientJar(versionJson) {
  const src = path.join(HOME, "jarsrc", `j${++seq}`);
  await fsp.mkdir(path.join(src, "net"), { recursive: true });
  await fsp.writeFile(path.join(src, "net", "Main.class"), "x");
  if (versionJson !== null) await fsp.writeFile(path.join(src, "version.json"), typeof versionJson === "string" ? versionJson : JSON.stringify(versionJson));
  const out = path.join(HOME, "jars", `client${seq}.jar`);
  await fsp.mkdir(path.dirname(out), { recursive: true });
  await zip.buildZip(src, out);
  return out;
}
const read = (file) => fsp.readFile(file, "utf8");
const exists = (file) =>
  fsp.access(file).then(
    () => true,
    () => false
  );

/* ---------------- gameOptions: what gets written ---------------- */

const DATA_26 = 4700; // any 26.x-sized data version
const DATA_1_16_5 = 2586;
const DATA_1_18_1 = 2865;
const DATA_1_18_2 = 2975;
const DATA_1_15_2 = 2230;

test("buildOptions: balanced (or anything unknown) writes nothing", () => {
  for (const p of ["balanced", undefined, null, "", "MAX-FPS", "ultra"]) {
    assert.equal(gameOptions.buildOptions(p, { worldVersion: DATA_26 }), null, String(p));
  }
});

test("buildOptions: max-fps on a current version - exactly the agreed keys, version first", () => {
  assert.deepEqual(gameOptions.buildOptions("max-fps", { worldVersion: DATA_26 }), [
    ["version", String(DATA_26)],
    ["graphicsPreset", '"custom"'],
    ["renderDistance", "10"],
    ["simulationDistance", "8"],
    ["particles", "1"],
    ["entityShadows", "false"],
    ["biomeBlendRadius", "1"],
    ["entityDistanceScaling", "0.75"],
    ["enableVsync", "false"],
    ["maxFps", "260"],
  ]);
});

test("buildOptions: far-view on a current version", () => {
  assert.deepEqual(gameOptions.buildOptions("far-view", { worldVersion: DATA_26, totalMemMb: 8192, cpuCount: 4 }), [
    ["version", String(DATA_26)],
    ["graphicsPreset", '"custom"'],
    ["renderDistance", "16"],
    ["simulationDistance", "8"],
    ["biomeBlendRadius", "2"],
    ["entityDistanceScaling", "1.0"],
    ["prioritizeChunkUpdates", "0"],
  ]);
});

test("buildOptions: keys a version doesn't have are left out; older than 1.16 gets nothing", () => {
  const keys = (p, v) => (gameOptions.buildOptions(p, { worldVersion: v }) || []).map(([k]) => k);
  // 1.16/1.17: no simulation distance yet, no chunk-builder option
  assert.equal(keys("max-fps", DATA_1_16_5).includes("simulationDistance"), false);
  assert.equal(keys("far-view", DATA_1_16_5).includes("simulationDistance"), false);
  assert.equal(keys("far-view", DATA_1_16_5).includes("prioritizeChunkUpdates"), false);
  // 1.18.1: simulation distance yes, chunk builder not yet
  assert.equal(keys("far-view", DATA_1_18_1).includes("simulationDistance"), true);
  assert.equal(keys("far-view", DATA_1_18_1).includes("prioritizeChunkUpdates"), false);
  assert.equal(keys("far-view", DATA_1_18_2).includes("prioritizeChunkUpdates"), true);
  // too old, or no usable data version at all
  for (const v of [DATA_1_15_2, 0, -1, 2566.5, "4700", null, undefined, NaN]) {
    assert.equal(gameOptions.buildOptions("max-fps", { worldVersion: v }), null, String(v));
  }
});

test("buildOptions: graphicsPreset \"custom\" from 1.21.11 on (measured: otherwise the fancy preset overwrites our values); none before; snapshots in between get nothing", () => {
  const keys = (p, v) => (gameOptions.buildOptions(p, { worldVersion: v }) || []).map(([k]) => k);
  for (const p of ["max-fps", "far-view"]) {
    assert.equal(keys(p, 4556).includes("graphicsPreset"), false, "1.21.10 still has graphicsMode");
    assert.equal(keys(p, 4556).length > 1, true, "and gets its values");
    assert.equal(keys(p, 4671)[1], "graphicsPreset", "1.21.11: right after version");
    assert.equal(keys(p, 4786)[1], "graphicsPreset", "26.1");
    assert.equal(gameOptions.buildOptions(p, { worldVersion: 4600 }), null, "an unmeasured snapshot: nothing");
    assert.equal(gameOptions.buildOptions(p, { worldVersion: 4557 }), null);
    assert.equal(gameOptions.buildOptions(p, { worldVersion: 4670 }), null);
  }
});

test("farViewDistance: 16 by default, 20 and 24 only on bigger PCs (16 GB PCs report a bit less)", () => {
  assert.equal(gameOptions.farViewDistance(8192, 4), 16);
  assert.equal(gameOptions.farViewDistance(32768, 6), 16, "RAM alone isn't enough");
  assert.equal(gameOptions.farViewDistance(8192, 16), 16, "threads alone aren't enough");
  assert.equal(gameOptions.farViewDistance(16303, 8), 20, "a 16 GB PC as Windows reports it");
  assert.equal(gameOptions.farViewDistance(32000, 11), 20);
  assert.equal(gameOptions.farViewDistance(32542, 12), 24, "a 32 GB PC as Windows reports it");
  assert.equal(gameOptions.farViewDistance(undefined, undefined), 16);
});

/* ---------------- gameOptions.seedIfAbsent: when it may write ---------------- */

test("seedIfAbsent: a brand-new max-fps instance gets the file, and a note that it did", async () => {
  const gameDir = await freshDir();
  const jar = await clientJar({ id: "26.3", world_version: DATA_26 });
  assert.deepEqual(await gameOptions.seedIfAbsent({ gameDir, perfProfile: "max-fps", clientJar: jar, totalMemMb: 16000, cpuCount: 8 }), { written: true, reason: "written" });
  const text = await read(path.join(gameDir, "options.txt"));
  assert.equal(text, gameOptions.buildOptions("max-fps", { worldVersion: DATA_26 }).map(([k, v]) => `${k}:${v}`).join("\n") + "\n");
  assert.ok(text.startsWith(`version:${DATA_26}\n`));
  const note = JSON.parse(await read(path.join(gameDir, gameOptions.SEEDED_FILE)));
  assert.equal(note.written, true);
  assert.equal(note.profile, "max-fps");
  assert.equal(note.worldVersion, DATA_26);
  assert.ok(note.keys.includes("maxFps") && !note.keys.includes("version"));
  // never twice
  assert.deepEqual(await gameOptions.seedIfAbsent({ gameDir, perfProfile: "max-fps", clientJar: jar }), { written: false, reason: "options-exist" });
  // no temp files left behind
  assert.deepEqual((await fsp.readdir(gameDir)).sort(), [".reminth", "options.txt"]);
});

test("seedIfAbsent: far-view render distance follows the PC", async () => {
  const jar = await clientJar({ world_version: DATA_26 });
  const big = await freshDir();
  await gameOptions.seedIfAbsent({ gameDir: big, perfProfile: "far-view", clientJar: jar, totalMemMb: 32542, cpuCount: 16 });
  assert.match(await read(path.join(big, "options.txt")), /^renderDistance:24$/m);
  const small = await freshDir();
  await gameOptions.seedIfAbsent({ gameDir: small, perfProfile: "far-view", clientJar: jar, totalMemMb: 8000, cpuCount: 4 });
  assert.match(await read(path.join(small, "options.txt")), /^renderDistance:16$/m);
});

test("seedIfAbsent: the player's own options.txt is never touched", async () => {
  const gameDir = await freshDir();
  const jar = await clientJar({ world_version: DATA_26 });
  const mine = "version:4700\nrenderDistance:32\nfov:0.5\n";
  await fsp.writeFile(path.join(gameDir, "options.txt"), mine);
  for (const perfProfile of ["max-fps", "far-view"]) {
    assert.deepEqual(await gameOptions.seedIfAbsent({ gameDir, perfProfile, clientJar: jar }), { written: false, reason: "options-exist" });
  }
  assert.equal(await read(path.join(gameDir, "options.txt")), mine);
  assert.equal(await exists(path.join(gameDir, gameOptions.SEEDED_FILE)), false);
});

test("seedIfAbsent: balanced and unknown profiles write nothing", async () => {
  const jar = await clientJar({ world_version: DATA_26 });
  for (const perfProfile of ["balanced", undefined, "turbo"]) {
    const gameDir = await freshDir();
    assert.deepEqual(await gameOptions.seedIfAbsent({ gameDir, perfProfile, clientJar: jar }), { written: false, reason: "profile" });
    assert.deepEqual(await fsp.readdir(gameDir), []);
  }
});

test("seedIfAbsent: an instance that has been played (worlds or a log) is left alone", async () => {
  const jar = await clientJar({ world_version: DATA_26 });
  const withWorld = await freshDir();
  await fsp.mkdir(path.join(withWorld, "saves", "New World"), { recursive: true });
  assert.deepEqual(await gameOptions.seedIfAbsent({ gameDir: withWorld, perfProfile: "max-fps", clientJar: jar }), { written: false, reason: "has-worlds" });
  const withLog = await freshDir();
  await fsp.mkdir(path.join(withLog, "logs"), { recursive: true });
  await fsp.writeFile(path.join(withLog, "logs", "latest.log"), "[main/INFO]: Setting user: Steve\n");
  assert.deepEqual(await gameOptions.seedIfAbsent({ gameDir: withLog, perfProfile: "max-fps", clientJar: jar }), { written: false, reason: "played" });
  // an empty saves folder isn't a world
  const emptySaves = await freshDir();
  await fsp.mkdir(path.join(emptySaves, "saves"), { recursive: true });
  assert.equal((await gameOptions.seedIfAbsent({ gameDir: emptySaves, perfProfile: "max-fps", clientJar: jar })).written, true);
  for (const dir of [withWorld, withLog]) assert.equal(await exists(path.join(dir, "options.txt")), false);
});

test("seedIfAbsent: seeded once means never again, even if the player deletes options.txt", async () => {
  const gameDir = await freshDir();
  const jar = await clientJar({ world_version: DATA_26 });
  assert.equal((await gameOptions.seedIfAbsent({ gameDir, perfProfile: "far-view", clientJar: jar })).written, true);
  await fsp.rm(path.join(gameDir, "options.txt"));
  assert.deepEqual(await gameOptions.seedIfAbsent({ gameDir, perfProfile: "far-view", clientJar: jar }), { written: false, reason: "already-seeded" });
  assert.equal(await exists(path.join(gameDir, "options.txt")), false);
});

test("seedIfAbsent: no readable data version in the client jar - nothing written", async () => {
  const cases = [
    [await clientJar(null), "no version.json"],
    [await clientJar({ id: "1.21.4" }), "no world_version"],
    [await clientJar({ world_version: "4189" }), "world_version as text"],
    [await clientJar("{not json"), "broken json"],
    [path.join(HOME, "missing.jar"), "no jar"],
    [null, "no jar given"],
  ];
  for (const [jar, why] of cases) {
    const gameDir = await freshDir();
    assert.deepEqual(await gameOptions.seedIfAbsent({ gameDir, perfProfile: "max-fps", clientJar: jar }), { written: false, reason: "no-data-version" }, why);
    assert.deepEqual(await fsp.readdir(gameDir), [], why);
  }
  const old = await freshDir();
  assert.deepEqual(await gameOptions.seedIfAbsent({ gameDir: old, perfProfile: "max-fps", clientJar: await clientJar({ world_version: DATA_1_15_2 }) }), { written: false, reason: "version-too-old" });
});

test("seedIfAbsent / readWorldVersion never throw", async () => {
  for (const args of [undefined, null, {}, { gameDir: 5, perfProfile: "max-fps" }, { gameDir: "", perfProfile: "far-view" }]) {
    const out = await gameOptions.seedIfAbsent(args || undefined);
    assert.equal(out.written, false);
  }
  assert.equal(await gameOptions.readWorldVersion(path.join(HOME, "nope.jar")), null);
  assert.equal(await gameOptions.readWorldVersion(await clientJar({ world_version: 4189 })), 4189);
});

test("markNoSeed: modpack and copied instances never get a starting options.txt", async () => {
  const gameDir = await freshDir();
  const jar = await clientJar({ world_version: DATA_26 });
  assert.equal(await gameOptions.markNoSeed(gameDir, "modpack"), true);
  const note = JSON.parse(await read(path.join(gameDir, gameOptions.SEEDED_FILE)));
  assert.equal(note.written, false);
  assert.equal(note.reason, "modpack");
  assert.deepEqual(await gameOptions.seedIfAbsent({ gameDir, perfProfile: "max-fps", clientJar: jar }), { written: false, reason: "already-seeded" });
  assert.equal(await exists(path.join(gameDir, "options.txt")), false);
  // never throws, and a bad folder is just "no"
  assert.equal(await gameOptions.markNoSeed(undefined, "x"), false);
});

/* ---------------- perfProfiles ---------------- */

test("perfProfiles.list: three profiles, each with a title and two lines", () => {
  const list = perfProfiles.list();
  assert.deepEqual(
    list.map((p) => p.id),
    ["balanced", "max-fps", "far-view"]
  );
  for (const p of list) {
    assert.ok(p.title);
    assert.equal(p.description.length, 2);
  }
  // the honest sentences the UI relies on
  const far = list.find((p) => p.id === "far-view").description.join(" ");
  assert.match(far, /more than 8 chunks away stop growing and moving in singleplayer/);
  assert.match(far, /new instances only; your existing settings are never changed/);
  assert.match(list.find((p) => p.id === "max-fps").description.join(" "), /new instances only; your existing settings are never changed/);
});

test("perfProfiles.normaliseProfile: anything unknown is balanced", () => {
  assert.equal(perfProfiles.normaliseProfile("far-view"), "far-view");
  assert.equal(perfProfiles.normaliseProfile("max-fps"), "max-fps");
  for (const v of [undefined, null, "", "Max FPS", 3, {}]) assert.equal(perfProfiles.normaliseProfile(v), "balanced");
});

test("perfProfiles.extrasFor: by profile and loader; C2ME is experimental with the exact warning", () => {
  const slugs = (inst) => perfProfiles.extrasFor(inst).map((e) => e.slug);
  assert.deepEqual(slugs({ loader: "fabric" }), [], "balanced suggests nothing");
  assert.deepEqual(slugs({ loader: "vanilla", perfProfile: "max-fps" }), [], "vanilla can't load mods");
  assert.deepEqual(slugs({ loader: "fabric", perfProfile: "max-fps" }), ["dynamic-fps", "badoptimizations", "moreculling"]);
  assert.deepEqual(slugs({ loader: "quilt", perfProfile: "far-view" }), ["distanthorizons", "bobby", "c2me-fabric"]);
  assert.deepEqual(slugs({ loader: "neoforge", perfProfile: "far-view" }), ["distanthorizons"], "Bobby and C2ME are Fabric-only");
  assert.deepEqual(slugs({ loader: "forge", perfProfile: "far-view" }), ["distanthorizons"]);
  const all = perfProfiles.extrasFor({ loader: "fabric", perfProfile: "far-view" });
  const c2me = all.find((e) => e.slug === "c2me-fabric");
  assert.equal(c2me.experimental, true);
  assert.equal(c2me.warning, "Experimental (alpha). It can freeze world creation or damage a world. Back up your worlds first.");
  assert.match(all.find((e) => e.slug === "distanthorizons").warning, /servers don't allow/);
  // only C2ME is experimental
  for (const p of Object.values(perfProfiles.PROFILES)) for (const e of p.extras) assert.equal(e.experimental === true, e.slug === "c2me-fabric", e.slug);
});

test("perfProfiles.listExtras: availability, channel and 'installed' from Modrinth + the content list", async () => {
  const asked = [];
  const fakeModrinth = {
    async getProjectVersions(slug, opts) {
      asked.push([slug, opts]);
      if (slug === "dynamic-fps") return [{ project_id: "DFPS", version_type: "beta" }, { project_id: "DFPS", version_type: "release" }];
      if (slug === "badoptimizations") return [{ project_id: "BADO", version_type: "beta" }];
      if (slug === "moreculling") return [];
      throw new Error("unexpected");
    },
  };
  const fakeContent = {
    loadersFor: () => ["quilt", "fabric"],
    readManifest: async () => ({ files: { "mods/dynamic-fps.jar": { projectId: "DFPS" }, "mods/other.jar": { projectId: "ZZZ" } } }),
  };
  const inst = { id: "x", loader: "quilt", mcVersion: "1.21.4", perfProfile: "max-fps", gameDir: "/nowhere" };
  const rows = await perfProfiles.listExtras(inst, { modrinth: fakeModrinth, content: fakeContent });
  assert.deepEqual(
    rows.map((r) => [r.slug, r.available, r.channel, r.installed]),
    [
      ["dynamic-fps", true, "release", true],
      ["badoptimizations", true, "beta", false],
      ["moreculling", false, null, false],
    ]
  );
  for (const [, opts] of asked) assert.deepEqual(opts, { loaders: ["quilt", "fabric"], gameVersions: ["1.21.4"] });
  for (const r of rows) assert.ok(r.title && r.why && "warning" in r && r.experimental === false);
});

test("perfProfiles.listExtras: a missing project is 'not available', Modrinth down is 'don't know'", async () => {
  const fakeContent = { loadersFor: () => ["fabric"], readManifest: async () => ({ files: {} }) };
  const inst = { loader: "fabric", mcVersion: "26.3", perfProfile: "far-view", gameDir: "/nowhere" };
  const rows = await perfProfiles.listExtras(inst, {
    content: fakeContent,
    modrinth: {
      async getProjectVersions(slug) {
        if (slug === "bobby") throw new Error("Modrinth API GET /project/bobby/version failed: 404 Not Found");
        throw new Error("Modrinth couldn't be reached");
      },
    },
  });
  const by = Object.fromEntries(rows.map((r) => [r.slug, r]));
  assert.equal(by.bobby.available, false);
  assert.equal(by.distanthorizons.available, null);
  assert.equal(by.distanthorizons.installed, null);
  assert.equal(by["c2me-fabric"].experimental, true);
  // nothing to ask for balanced or vanilla
  assert.deepEqual(await perfProfiles.listExtras({ loader: "fabric" }, { content: fakeContent, modrinth: {} }), []);
});

/* ---------------- instances: the perfProfile field ---------------- */

test("instances.sanitizeInstance: perfProfile kept only when it's a known, non-default profile", () => {
  const base = { id: "a-1234", mcVersion: "1.21.4", loader: "fabric" };
  assert.equal("perfProfile" in instances.sanitizeInstance(base), false);
  assert.equal(instances.sanitizeInstance({ ...base, perfProfile: "max-fps" }).perfProfile, "max-fps");
  assert.equal(instances.sanitizeInstance({ ...base, perfProfile: "far-view" }).perfProfile, "far-view");
  for (const junk of ["balanced", "turbo", 1, null, { x: 1 }]) assert.equal("perfProfile" in instances.sanitizeInstance({ ...base, perfProfile: junk }), false, String(junk));
});

test("instances: create and update store the profile, in the registry and the folder's own copy", async () => {
  const made = await realInstances.create({ name: "Far", mcVersion: "1.21.4", loader: "vanilla", perfProfile: "far-view" });
  assert.equal(made.perfProfile, "far-view");
  const meta = () => JSON.parse(fs.readFileSync(path.join(made.gameDir, ".reminth", "instance.json"), "utf8"));
  assert.equal(meta().perfProfile, "far-view");
  assert.equal((await realInstances.update(made.id, { perfProfile: "max-fps" })).perfProfile, "max-fps");
  assert.equal(meta().perfProfile, "max-fps");
  const back = await realInstances.update(made.id, { perfProfile: "balanced" });
  assert.equal("perfProfile" in back, false);
  assert.equal("perfProfile" in meta(), false);
  const plain = await realInstances.create({ name: "Plain", mcVersion: "1.21.4", loader: "vanilla" });
  assert.equal("perfProfile" in plain, false);
  await instances.remove(made.id);
  await instances.remove(plain.id);
});

/* ---------------- main.js IPC, against the fake Electron ---------------- */

const store = require("../src/main/store");
const streamer = require("../src/main/streamer");
const updater = require("../src/main/updater");
const content = require("../src/main/content");
const logs = require("../src/main/logs");
const catalogCache = require("../src/main/catalogCache");
const minecraft = require("../src/main/minecraft");
const compat = require("../src/main/compat");
const migrate = require("../src/main/migrate");
const mrpack = require("../src/main/mrpack");

// Signed in (Play refuses otherwise), with a token far from expiry so
// nothing tries to refresh it.
store.loadAccount = async () => ({
  minecraftAccessToken: "mc-token",
  minecraftAccessTokenExpiresAt: Date.now() + 12 * 60 * 60 * 1000,
  msRefreshToken: "refresh-1",
  uuid: "u1",
  username: "Steve",
});
streamer.init = noop;
streamer.configure = () => ({ hotkeyProblems: [] });
streamer.gameStarted = noop;
streamer.gameStopped = noop;
streamer.shutdown = noop;
updater.init = noop;
content.watchInstance = async () => {};
logs.importInstanceLogs = async () => {};
catalogCache.getWarmStatus = () => ({ state: "done", updated_at: Date.now() });

let INSTANCE = { id: "i1", name: "Test", gameDir: path.join(HOME, "main-i1"), mcVersion: "1.21.4", loader: "vanilla", loaderVersion: null };
let updates = [];
let creates = [];
instances.list = async () => [INSTANCE];
instances.get = async () => INSTANCE;
instances.require = async () => INSTANCE;
instances.recordSession = async () => {};
instances.update = async (id, patch) => {
  updates.push(patch);
  return { ...INSTANCE, ...patch };
};
instances.create = async (fields) => {
  creates.push(fields);
  return { id: "made" + creates.length, ...fields, gameDir: path.join(HOME, "made", String(creates.length)) };
};
let install = null;
minecraft.ensureInstalled = () => install.promise;
let lastChild = null;
let lastLaunchOptions = null;
minecraft.launch = (_result, _account, _onCrash, _settings, _inst, options) => {
  lastLaunchOptions = options;
  const child = new EventEmitter();
  child.pid = 4242;
  child.kill = noop;
  lastChild = child;
  return child;
};

require("../src/main/main");
const call = (channel, ...args) => ipc.get(channel)({}, ...args);

test("main: perf:profiles, and create/update only pass known profiles", async () => {
  appReady();
  for (let i = 0; i < 400 && !(await call("auth:current")); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(await call("auth:current"), { username: "Steve" });
  assert.deepEqual(await call("perf:profiles"), perfProfiles.list());
  creates = [];
  await call("instances:create", { name: "A", mcVersion: "1.21.4", loader: "vanilla", perfProfile: "far-view" });
  await call("instances:create", { name: "B", mcVersion: "1.21.4", loader: "vanilla", perfProfile: "nonsense" });
  await call("instances:create", { name: "C", mcVersion: "1.21.4", loader: "vanilla" });
  assert.deepEqual(
    creates.map((c) => c.perfProfile),
    ["far-view", "balanced", "balanced"]
  );
  updates = [];
  await call("instances:update", "i1", { perfProfile: "max-fps" });
  await call("instances:update", "i1", { perfProfile: "nope", name: "Kept" });
  assert.deepEqual(updates, [{ perfProfile: "max-fps" }, { name: "Kept" }]);
});

test("main: app:info lists the performance pack per loader for the instance dialog", async () => {
  const config = require("../src/main/config");
  const info = await call("app:info");
  for (const loader of ["fabric", "quilt", "forge", "neoforge"]) {
    assert.deepEqual(
      info.performancePack[loader],
      config.PERFORMANCE_PACK.filter((e) => e.loaders.includes(loader)).map((e) => e.label),
      loader
    );
  }
  assert.ok(info.performancePack.fabric.includes("Sodium"));
  assert.ok(info.performancePack.forge.includes("Embeddium") && !info.performancePack.forge.includes("Sodium"));
  assert.equal("vanilla" in info.performancePack, false);
});

test("main: far-view instances get the modpack memory default", async () => {
  const total = os.totalmem();
  const entitlements = require("../src/main/entitlements");
  const want = (modpack) => minecraft.computeDefaultMaxMemoryMb(total, { modpack, modCount: 0, capMb: entitlements.ramCapMb() });
  const saved = INSTANCE;
  try {
    INSTANCE = { ...saved, perfProfile: "far-view" };
    assert.equal((await call("perf:info", "i1")).defaultMemoryMb, want(true));
    INSTANCE = { ...saved, perfProfile: "max-fps" };
    assert.equal((await call("perf:info", "i1")).defaultMemoryMb, want(false));
  } finally {
    INSTANCE = saved;
  }
});

test("main: perf:packStatus and perf:restorePack (refused while the game runs)", async () => {
  const seen = { status: [], reset: [], invalidated: [] };
  const real = { status: minecraft.performancePackStatus, reset: minecraft.resetPerformancePack, invalidate: compat.invalidate };
  minecraft.performancePackStatus = async (inst) => {
    seen.status.push(inst.id);
    return { enabled: true, loader: inst.loader, mods: [] };
  };
  minecraft.resetPerformancePack = async (inst) => {
    seen.reset.push(inst.id);
    return true;
  };
  compat.invalidate = (id) => seen.invalidated.push(id);
  try {
    assert.deepEqual(await call("perf:packStatus", "i1"), { enabled: true, loader: "vanilla", mods: [] });
    assert.deepEqual(await call("perf:restorePack", "i1"), { reset: true, status: { enabled: true, loader: "vanilla", mods: [] } });
    assert.deepEqual(seen.reset, ["i1"]);
    assert.deepEqual(seen.invalidated, ["i1"]);

    // While the game is starting/running: refused, nothing reset.
    let release;
    install = { promise: new Promise((resolve) => (release = resolve)) }; // an install that hasn't finished = "running"
    call("play:run", { instanceId: "i1" }).catch(() => {});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await call("instances:list"))[0].running, true);
    await assert.rejects(call("perf:restorePack", "i1"), /Close the game first/);
    assert.deepEqual(seen.reset, ["i1"], "not reset again");
    await call("play:stop", { instanceId: "i1" });
    assert.equal((await call("instances:list"))[0].running, false);
    release({ removedMods: [] }); // the stopped launch ends (cancelled) instead of hanging on
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    minecraft.performancePackStatus = real.status;
    minecraft.resetPerformancePack = real.reset;
    compat.invalidate = real.invalidate;
  }
});

test("main: copy-to-version keeps the profile and a switched-on pack, and never seeds the copy", async () => {
  const realCopy = migrate.copyToVersion;
  migrate.copyToVersion = async (source, request, tools) => ({
    instance: await tools.createInstance({ name: "Copy", mcVersion: request.mcVersion, loader: source.loader, hud: false }),
    installed: [],
    skipped: [],
    unknown: [],
  });
  const saved = INSTANCE;
  try {
    INSTANCE = { ...saved, perfProfile: "max-fps", performanceMods: true };
    creates = [];
    const result = await call("compat:copyToVersion", "i1", { mcVersion: "1.21.1" });
    assert.equal(creates[0].perfProfile, "max-fps");
    assert.equal(creates[0].performanceMods, true);
    const note = JSON.parse(await read(path.join(result.instance.gameDir, gameOptions.SEEDED_FILE)));
    assert.deepEqual([note.written, note.reason], [false, "copied"]);
    // the source with no profile and the default pack: nothing extra passed
    INSTANCE = saved;
    creates = [];
    await call("compat:copyToVersion", "i1", { mcVersion: "1.21.1" });
    assert.equal(creates[0].perfProfile, undefined);
    assert.equal("performanceMods" in creates[0], false);
  } finally {
    migrate.copyToVersion = realCopy;
    INSTANCE = saved;
  }
});

test("main: an installed modpack is marked so a profile never writes its options.txt", async () => {
  const realInstall = mrpack.installModpack;
  const gameDir = path.join(HOME, "pack-1");
  mrpack.installModpack = async () => ({ id: "pack-1", name: "Pack", gameDir, mcVersion: "1.21.1", loader: "fabric" });
  try {
    const inst = await call("modpack:install", { projectId: "abc" });
    assert.equal(inst.id, "pack-1");
    assert.equal(inst.running, false);
    const note = JSON.parse(await read(path.join(gameDir, gameOptions.SEEDED_FILE)));
    assert.equal(note.reason, "modpack");
  } finally {
    mrpack.installModpack = realInstall;
  }
});

test("main: perf:profileExtras serves the instance's suggestions", async () => {
  const saved = INSTANCE;
  INSTANCE = { ...saved, loader: "vanilla", perfProfile: "max-fps" };
  try {
    assert.deepEqual(await call("perf:profileExtras", "i1"), [], "vanilla: nothing to suggest, and Modrinth isn't asked");
  } finally {
    INSTANCE = saved;
  }
});

test("main: a start Fabric refused for the Minecraft version is remembered in .reminth/launch-report.json, and cleared by a good start", async () => {
  const zip = require("../src/main/zip");
  const gameDir = path.join(HOME, "refused");
  const src = path.join(HOME, "refused-src");
  await fsp.mkdir(src, { recursive: true });
  await fsp.writeFile(path.join(src, "fabric.mod.json"), JSON.stringify({ schemaVersion: 1, id: "clientsidecrystals", name: "Client Side Crystals", version: "26.3", depends: { minecraft: "26.3" } }));
  await fsp.mkdir(path.join(gameDir, "mods"), { recursive: true });
  await zip.buildZip(src, path.join(gameDir, "mods", "csc.jar"));
  const saved = INSTANCE;
  const reportFile = path.join(gameDir, ".reminth", "launch-report.json");
  const play = async (logText, expectReport) => {
    install = { promise: Promise.resolve({ removedMods: [] }) };
    await call("play:run", { instanceId: "i1" });
    await fsp.mkdir(path.join(gameDir, "logs"), { recursive: true });
    await fsp.writeFile(path.join(gameDir, "logs", "latest.log"), logText);
    lastChild.emit("exit", 1, null);
    // written (or removed) off the exit event, a moment later
    for (let i = 0; i < 200 && fs.existsSync(reportFile) !== expectReport; i++) await new Promise((r) => setTimeout(r, 10));
  };
  try {
    INSTANCE = { ...saved, gameDir, loader: "fabric", mcVersion: "26.2" };
    await play(
      "[main/INFO]: Loading Minecraft 26.2 with Fabric Loader 0.17\nSome of your mods are incompatible with the game or each other!\n\t - Mod 'Client Side Crystals' (clientsidecrystals) 26.3 requires version 26.3 of 'Minecraft', but only the wrong version is present: 26.2!\n",
      true
    );
    const report = JSON.parse(await fsp.readFile(path.join(gameDir, ".reminth", "launch-report.json"), "utf8"));
    assert.equal(report.mcVersion, "26.2");
    assert.equal(report.loader, "fabric");
    assert.deepEqual(report.mods.map((m) => [m.id, m.file]), [["clientsidecrystals", "csc.jar"]]);
    assert.ok(toRenderer.some(([c, p]) => c === "compat:changed" && p.instanceId === "i1" && p.refused === 1));
    // a later start that got past the mods clears it
    await play("[main/INFO]: Loading Minecraft 26.2\n[Render thread/INFO]: Setting user: Steve\n", false);
    assert.equal(fs.existsSync(reportFile), false);
  } finally {
    INSTANCE = saved;
  }
});

test("main: while an instance runs, MOD changes are refused; packs, shaders and data packs are not", async () => {
  const real = { setEnabled: content.setEnabled, remove: content.remove, install: content.install, removeInvalid: content.removeInvalid };
  const did = [];
  content.setEnabled = async (_dir, item) => did.push(["setEnabled", item.kind]);
  content.remove = async (_dir, item) => did.push(["remove", item.kind]);
  content.install = async (_inst, req, _p, opts) => did.push(["install", req.kind, opts.noModChanges]);
  content.removeInvalid = async (_dir, kind) => did.push(["removeInvalid", kind]);
  let release;
  try {
    // not running: everything goes through
    await call("content:setEnabled", "i1", { kind: "mod", file: "a.jar" }, false);
    await call("content:install", "i1", { kind: "mod", projectId: "x" });
    // running (an install in flight counts)
    install = { promise: new Promise((resolve) => (release = resolve)) };
    call("play:run", { instanceId: "i1" }).catch(() => {});
    await new Promise((resolve) => setImmediate(resolve));
    for (const [channel, args] of [
      ["content:setEnabled", [{ kind: "mod", file: "a.jar" }, true]],
      ["content:remove", [{ kind: "mod", file: "a.jar" }]],
      ["content:install", [{ kind: "mod", projectId: "x" }]],
      ["content:removeInvalid", ["mod"]],
    ]) {
      await assert.rejects(call(channel, "i1", ...args), /Close the game first - that instance is running\./, channel);
    }
    await call("content:setEnabled", "i1", { kind: "resourcepack", file: "p.zip" }, false);
    await call("content:remove", "i1", { kind: "shader", file: "s.zip" });
    await call("content:removeInvalid", "i1", "datapack");
    await call("content:install", "i1", { kind: "shader", projectId: "y" });
    assert.deepEqual(did, [
      ["setEnabled", "mod"],
      ["install", "mod", false],
      ["setEnabled", "resourcepack"],
      ["remove", "shader"],
      ["removeInvalid", "datapack"],
      ["install", "shader", true], // a shader pack may go in, but not the Iris it might need
    ]);
  } finally {
    await call("play:stop", { instanceId: "i1" });
    if (release) release({ removedMods: [] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    Object.assign(content, real);
  }
});

test("main: Play from a Home card opens the world only when it is a real world of that instance; IPv6 joins get brackets; last played is written at launch", async () => {
  const gameDir = path.join(HOME, "worlds-inst");
  await fsp.mkdir(path.join(gameDir, "saves", "New World"), { recursive: true });
  const saved = INSTANCE;
  const quickPlay = { arguments: { game: [{ rules: [{ action: "allow", features: { is_quick_play_singleplayer: true } }], value: ["--quickPlaySingleplayer", "${quickPlaySingleplayer}"] }] } };
  const launchWith = async (profile, options) => {
    install = { promise: Promise.resolve({ removedMods: [], profile }) };
    const r = await call("play:run", { instanceId: "i1", ...options });
    const opts = lastLaunchOptions;
    lastChild.emit("exit", 0, null);
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { r, opts };
  };
  try {
    INSTANCE = { ...saved, gameDir, loader: "vanilla", mcVersion: "1.21.4" };
    updates = [];
    let { r, opts } = await launchWith(quickPlay, { world: "New World" });
    assert.deepEqual(r, { launched: true, worldJoin: true });
    assert.equal(opts.world, "New World");
    assert.ok(updates.some((u) => typeof u.lastPlayed === "number" && Object.keys(u).length === 1), "last played stored when the game starts");
    // a name that isn't a world of this instance: it just starts
    for (const bad of ["../../etc", "Missing", ".hidden"]) {
      ({ r, opts } = await launchWith(quickPlay, { world: bad }));
      assert.deepEqual(r, { launched: true, worldJoin: false }, bad);
      assert.equal(opts.world, null, bad);
    }
    // a version without the feature: started, and told so
    ({ r, opts } = await launchWith({ arguments: { game: [] } }, { world: "New World" }));
    assert.deepEqual(r, { launched: true, worldJoin: false });
    // no world asked: the answer is as before
    ({ r } = await launchWith(quickPlay, {}));
    assert.deepEqual(r, { launched: true });
    // servers: an IPv6 address goes to the game in brackets; junk is dropped
    ({ opts } = await launchWith(quickPlay, { join: { host: "2001:db8::7", port: 25566 } }));
    assert.deepEqual(opts.join, { host: "[2001:db8::7]", port: 25566 });
    ({ opts } = await launchWith(quickPlay, { join: { host: "bad host;rm", port: 1 } }));
    assert.equal(opts.join, null);
  } finally {
    INSTANCE = saved;
  }
});

test("main: link:open opens only checked https links in the default browser", async () => {
  const opened = [];
  const real = fakeElectron.shell.openExternal;
  fakeElectron.shell.openExternal = async (url) => opened.push(url);
  try {
    assert.deepEqual(await call("link:open", "https://modrinth.com/mod/sodium"), { ok: true });
    await call("link:open", "/mod/iris");
    for (const bad of ["javascript:alert(1)", "file:///C:/Windows", "http://example.com", "//evil.example", "https://u:p@evil.example", "ms-settings:display", "", null, { href: "https://x.y" }]) {
      await assert.rejects(call("link:open", bad), /Only https links can be opened/, String(bad));
    }
    assert.deepEqual(opened, ["https://modrinth.com/mod/sodium", "https://modrinth.com/mod/iris"]);
  } finally {
    fakeElectron.shell.openExternal = real;
  }
});

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("main: play:started goes out only after last played is saved; a failed save still starts the game", async () => {
  const fakeUpdate = instances.update;
  let finishSave = null;
  instances.update = (id, patch) =>
    new Promise((resolve) => {
      finishSave = () => resolve({ ...INSTANCE, ...patch });
    });
  const startedSince = (from) => toRenderer.slice(from).filter(([c]) => c === "play:started");
  try {
    install = { promise: Promise.resolve({ removedMods: [] }) };
    let from = toRenderer.length;
    const launched = call("play:run", { instanceId: "i1" });
    for (let i = 0; i < 400 && !finishSave; i++) await tick(5);
    assert.ok(finishSave, "last played is being saved");
    await tick(30);
    assert.equal(startedSince(from).length, 0, "not before the save landed");
    finishSave();
    assert.deepEqual(await launched, { launched: true });
    const [started] = startedSince(from);
    assert.equal(started[1].instanceId, "i1");
    assert.equal(typeof started[1].startedAt, "number");
    lastChild.emit("exit", 0, null);
    await tick(20);
    // a save that fails: the game still starts and the page is still told
    instances.update = async () => {
      throw new Error("EPERM: disk says no");
    };
    from = toRenderer.length;
    assert.deepEqual(await call("play:run", { instanceId: "i1" }), { launched: true });
    assert.equal(startedSince(from).length, 1);
    lastChild.emit("exit", 0, null);
    await tick(20);
  } finally {
    instances.update = fakeUpdate;
  }
});

test("main: after a game the window goes back to maximized (never during the game, never if it wasn't)", async () => {
  const w = FakeWindow.last;
  const st = { max: true, min: false };
  const did = [];
  const realMethods = { isMaximized: w.isMaximized, isMinimized: w.isMinimized, maximize: w.maximize, restore: w.restore, minimize: w.minimize, unmaximize: w.unmaximize, getBounds: w.getBounds };
  Object.assign(w, {
    isMaximized: () => st.max,
    isMinimized: () => st.min,
    maximize: () => (did.push("maximize"), (st.max = true), (st.min = false)),
    restore: () => (did.push("restore"), (st.min = false)),
    minimize: () => (did.push("minimize"), (st.min = true)),
  });
  const play = async () => {
    install = { promise: Promise.resolve({ removedMods: [] }) };
    assert.deepEqual(await call("play:run", { instanceId: "i1" }), { launched: true });
  };
  const lastMaxState = () => [...toRenderer].reverse().find(([c]) => c === "window:maximized");
  const saved = await call("settings:get");
  try {
    // 1. "launch minimized" on: minimized for the game, Windows un-maximizes it meanwhile
    await call("settings:set", { launchMinimized: true });
    await play();
    assert.deepEqual(did, ["minimize"]);
    st.max = false;
    w.emit("focus");
    w.emit("restore");
    assert.deepEqual(did, ["minimize"], "nothing while the game runs");
    lastChild.emit("exit", 0, null);
    await tick(20);
    assert.deepEqual(did, ["minimize", "restore", "maximize"]);
    assert.deepEqual(lastMaxState(), ["window:maximized", true]);

    // 2. "launch minimized" off: the fullscreen game un-maximizes it; put back when the game ends
    await call("settings:set", { launchMinimized: false });
    did.length = 0;
    await play();
    st.max = false;
    assert.deepEqual(did, []);
    lastChild.emit("exit", 0, null);
    await tick(20);
    assert.deepEqual(did, ["maximize"]);

    // 3. not maximized when the game started: left as it is
    did.length = 0;
    st.max = false;
    await play();
    lastChild.emit("exit", 0, null);
    await tick(20);
    w.emit("focus");
    assert.deepEqual(did, []);
    assert.equal(st.max, false);

    // 4. the player minimized it themselves: put back only when they bring it back
    did.length = 0;
    st.max = true;
    await play();
    st.max = false;
    st.min = true;
    lastChild.emit("exit", 0, null);
    await tick(20);
    assert.deepEqual(did, []);
    st.min = false; // the player clicks it on the taskbar
    w.emit("restore");
    assert.deepEqual(did, ["maximize"]);
    w.emit("focus");
    assert.deepEqual(did, ["maximize"], "only once");

    // 5. measured on Windows: still FLAGGED maximized, but shrunk to 800x552 at game start
    const full = { x: -8, y: -8, width: 1936, height: 1048 };
    let rect = full;
    Object.assign(w, {
      getBounds: () => rect,
      unmaximize: () => (did.push("unmaximize"), (st.max = false), (rect = { x: 260, y: 96, width: 1320, height: 840 })),
      // like Windows: maximize() on a window already flagged maximized changes nothing
      maximize: () => {
        did.push("maximize");
        if (!st.max) rect = full;
        st.max = true;
        st.min = false;
      },
    });
    const logFile = path.join(require("../src/main/paths").ROOT, "main-errors.log");
    const logBefore = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
    await call("settings:set", { launchMinimized: false });
    did.length = 0;
    st.max = true;
    await play();
    rect = { x: -8, y: -8, width: 816, height: 568 }; // Windows shrinks it, IsZoomed stays TRUE
    w.emit("focus");
    assert.deepEqual(did, [], "not while the game runs");
    lastChild.emit("exit", 0, null);
    await tick(20);
    assert.deepEqual(did, ["unmaximize", "maximize"]);
    assert.deepEqual(rect, full);
    assert.deepEqual(lastMaxState(), ["window:maximized", true]);
    const logged = fs.readFileSync(logFile, "utf8").slice(logBefore.length);
    assert.match(logged, /window: After a game the window said maximized but was 816x568; repaired to 1936x1048\./);
    w.emit("focus");
    w.emit("restore");
    assert.deepEqual(did, ["unmaximize", "maximize"], "once per game end");

    // 6. maximized and full after the game: nothing
    did.length = 0;
    await play();
    lastChild.emit("exit", 0, null);
    await tick(20);
    assert.deepEqual(did, []);

    // 7. "launch minimized" on, and the window comes back small but flagged maximized
    await call("settings:set", { launchMinimized: true });
    did.length = 0;
    await play();
    rect = { x: -8, y: -8, width: 816, height: 568 };
    lastChild.emit("exit", 0, null);
    await tick(20);
    assert.deepEqual(did, ["minimize", "restore", "maximize", "unmaximize", "maximize"]);
    assert.deepEqual(rect, full);
  } finally {
    Object.assign(w, realMethods);
    await call("settings:set", { launchMinimized: saved.launchMinimized });
  }
});

test("main: Play's 'don't ask again' is stored per instance, checked, and dropped when the switched-on mods change", async () => {
  const compatMod = require("../src/main/compat");
  const realCheck = compatMod.checkInstance;
  const saved = INSTANCE;
  try {
    updates = [];
    assert.deepEqual(await call("compat:skipModWarning", "i1", "a".repeat(40)), { ok: true });
    assert.deepEqual(updates, [{ skipModWarning: "a".repeat(40) }]);
    for (const bad of ["../x", "A".repeat(40), 5, undefined, "a".repeat(41)]) {
      await assert.rejects(call("compat:skipModWarning", "i1", bad), /isn't valid/, String(bad));
    }
    await call("compat:skipModWarning", "i1", null);
    assert.deepEqual(updates[updates.length - 1], { skipModWarning: null });
    // the same mods: kept; other mods: forgotten
    INSTANCE = { ...saved, loader: "fabric", skipModWarning: "a".repeat(40) };
    compatMod.checkInstance = async () => ({ issues: [], modSet: "a".repeat(40) });
    updates = [];
    await call("compat:check", "i1", {});
    assert.deepEqual(updates, []);
    compatMod.checkInstance = async () => ({ issues: [], modSet: "c".repeat(40) });
    await call("compat:check", "i1", {});
    await tick(10);
    assert.deepEqual(updates, [{ skipModWarning: null }]);
  } finally {
    compatMod.checkInstance = realCheck;
    INSTANCE = saved;
  }
});

test("main: after a crash in play, the mod named by the crash report is remembered and the window told; a clean exit forgets it", async () => {
  const zipMod = require("../src/main/zip");
  const gameDir = path.join(HOME, "crash-inst");
  const src = path.join(HOME, "crash-src");
  await fsp.mkdir(src, { recursive: true });
  await fsp.writeFile(path.join(src, "fabric.mod.json"), JSON.stringify({ schemaVersion: 1, id: "appleskin", name: "AppleSkin", version: "3.0.10+mc26.3", entrypoints: { client: ["squeek.appleskin.client.AppleSkinClient"] } }));
  await fsp.mkdir(path.join(gameDir, "mods"), { recursive: true });
  await zipMod.buildZip(src, path.join(gameDir, "mods", "appleskin-fabric-mc26.3-3.0.10.jar"));
  const findingFile = path.join(gameDir, ".reminth", "crash-finding.json");
  const saved = INSTANCE;
  try {
    INSTANCE = { ...saved, gameDir, loader: "fabric", mcVersion: "26.2" };
    install = { promise: Promise.resolve({ removedMods: [] }) };
    await call("play:run", { instanceId: "i1" });
    await fsp.mkdir(path.join(gameDir, "crash-reports"), { recursive: true });
    await fsp.writeFile(
      path.join(gameDir, "crash-reports", "crash-2026-10-03_14.22.10-client.txt"),
      "---- Minecraft Crash Report ----\nDescription: Rendering overlay\n\njava.lang.NoSuchFieldError: Class x does not have member field 'GUI_TEXTURED'\n\tat knot//squeek.appleskin.client.HUDOverlayHandler.drawExhaustionOverlay(HUDOverlayHandler.java:96)\n"
    );
    const from = toRenderer.length;
    lastChild.emit("exit", 255, null);
    for (let i = 0; i < 200 && !fs.existsSync(findingFile); i++) await tick(10);
    const finding = JSON.parse(await fsp.readFile(findingFile, "utf8"));
    assert.deepEqual([finding.mod.file, finding.mod.name, finding.mcVersion, finding.loader, finding.how], ["appleskin-fabric-mc26.3-3.0.10.jar", "AppleSkin", "26.2", "fabric", "frame"]);
    assert.equal(finding.report, "crash-2026-10-03_14.22.10-client.txt");
    for (let i = 0; i < 100 && !toRenderer.slice(from).some(([c]) => c === "play:crashCulprit"); i++) await tick(10);
    assert.deepEqual(toRenderer.slice(from).find(([c]) => c === "play:crashCulprit")[1], { instanceId: "i1", file: "appleskin-fabric-mc26.3-3.0.10.jar", name: "AppleSkin" });
    // next session ends cleanly with no new report: forgotten
    await call("play:run", { instanceId: "i1" });
    await tick(5);
    lastChild.emit("exit", 0, null);
    for (let i = 0; i < 200 && fs.existsSync(findingFile); i++) await tick(10);
    assert.equal(fs.existsSync(findingFile), false);
  } finally {
    INSTANCE = saved;
  }
});

test("main: Undo after Reminth made an instance only while it was never played and has no world; never the main one", async () => {
  const realRemove = instances.remove;
  const removed = [];
  instances.remove = async (id) => removed.push(id);
  const saved = INSTANCE;
  const gameDir = path.join(HOME, "undo-inst");
  try {
    await fsp.mkdir(gameDir, { recursive: true });
    INSTANCE = { ...saved, id: "i1", gameDir, lastPlayed: 123 };
    await assert.rejects(call("instances:undoCreate", "i1"), /has been played or has a world/);
    INSTANCE = { ...saved, id: "i1", gameDir, lastPlayed: null };
    await fsp.mkdir(path.join(gameDir, "saves", "New World"), { recursive: true });
    await assert.rejects(call("instances:undoCreate", "i1"), /has been played or has a world/);
    await fsp.rm(path.join(gameDir, "saves"), { recursive: true, force: true });
    assert.deepEqual(await call("instances:undoCreate", "i1"), { ok: true });
    assert.deepEqual(removed, ["i1"]);
    INSTANCE = { ...saved, id: "reminth", gameDir, lastPlayed: null };
    await assert.rejects(call("instances:undoCreate", "reminth"), /main Reminth instance can't be deleted/);
    assert.deepEqual(removed, ["i1"]);
  } finally {
    instances.remove = realRemove;
    INSTANCE = saved;
  }
});
