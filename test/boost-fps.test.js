"use strict";
// "Boost FPS…" (gameOptions.js planBoost / applyBoost / undoBoost): only
// listed settings change, the file keeps everything else byte for byte,
// the old values are saved first and "put back" restores them.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");

const gameOptions = require("../src/main/gameOptions");
const zip = require("../src/main/zip");

const V26 = 4800; // a 26.x data version (has graphicsPreset)
const V1_21_1 = 3955; // graphicsMode era
const OWNER = [
  "version:4800",
  "ao:true",
  "biomeBlendRadius:2",
  "entityShadows:true",
  'graphicsPreset:"custom"',
  "maxFps:260",
  "enableVsync:false",
  "particles:1",
  'renderClouds:"true"',
  "renderDistance:16",
  "simulationDistance:12",
  "key_key.jump:key.keyboard.space",
  'resourcePacks:["vanilla","file/Small Totem.zip"]',
].join("\r\n") + "\r\n";

const byKey = (changes) => Object.fromEntries(changes.map((c) => [c.key, [c.from, c.to]]));

test("planBoost: the owner's settings -> render 12, sim 8, shadows/clouds/blend off; preset already custom", () => {
  const plan = gameOptions.planBoost(OWNER, { worldVersion: V26 });
  assert.deepEqual(byKey(plan), {
    renderDistance: ["16", "12"],
    simulationDistance: ["12", "8"],
    entityShadows: ["true", "false"],
    renderClouds: ['"true"', '"false"'],
    biomeBlendRadius: ["2", "0"],
  });
  assert.deepEqual(plan.map((c) => `${c.label}: ${c.fromText} -> ${c.toText}`), [
    "Render distance: 16 chunks -> 12 chunks",
    "Simulation distance: 12 chunks -> 8 chunks",
    "Entity shadows: on -> off",
    "Clouds: on -> off",
    "Biome blend: 2 -> off",
  ]);
});

test("planBoost: never raises anything, and an already-fast file has nothing to change", () => {
  const fast = "renderDistance:8\nsimulationDistance:5\nentityShadows:false\nrenderClouds:\"false\"\nbiomeBlendRadius:0\nparticles:2\nmaxFps:260\nenableVsync:false\ngraphicsPreset:\"custom\"\n";
  assert.deepEqual(gameOptions.planBoost(fast, { worldVersion: V26 }), []);
});

test("planBoost: a preset other than custom becomes custom (it would overwrite the values); a missing one is added", () => {
  const fancy = 'renderDistance:16\ngraphicsPreset:"fancy"\n';
  assert.deepEqual(byKey(gameOptions.planBoost(fancy, { worldVersion: V26 })).graphicsPreset, ['"fancy"', '"custom"']);
  const none = "renderDistance:16\n";
  assert.deepEqual(byKey(gameOptions.planBoost(none, { worldVersion: V26 })).graphicsPreset, [null, '"custom"']);
  // before the preset versions: no preset key at all
  assert.equal(byKey(gameOptions.planBoost(none, { worldVersion: V1_21_1 })).graphicsPreset, undefined);
});

test("planBoost: vsync, a frame cap and all particles are boosted; odd values and old versions are left alone", () => {
  const t = "enableVsync:true\nmaxFps:120\nparticles:0\nrenderClouds:fancy-ish\nrenderDistance:abc\n";
  assert.deepEqual(byKey(gameOptions.planBoost(t, { worldVersion: V1_21_1 })), {
    enableVsync: ["true", "false"],
    maxFps: ["120", "260"],
    particles: ["0", "1"],
  });
  // bare clouds value (pre-1.19 spelling) is written back bare
  assert.deepEqual(byKey(gameOptions.planBoost("renderClouds:fast\n", { worldVersion: 2860 })).renderClouds, ["fast", "false"]);
  assert.deepEqual(gameOptions.planBoost("renderDistance:16\n", { worldVersion: 2000 }), []); // older than 1.16
  assert.deepEqual(gameOptions.planBoost("renderDistance:16\n", { worldVersion: 4600 }), []); // 1.21.11 snapshots: unmeasured
  assert.deepEqual(gameOptions.planBoost("renderDistance:16\n", {}), []);
});

test("rewriteOptions: only the listed keys change, line endings and order kept", () => {
  const out = gameOptions.rewriteOptions(OWNER, [{ key: "renderDistance", to: "12" }, { key: "newKey", to: "x" }], (c) => c.to);
  assert.equal(out, OWNER.replace("renderDistance:16", "renderDistance:12") + "newKey:x\r\n");
  const removed = gameOptions.rewriteOptions("a:1\nb:2\n", [{ key: "a", from: null }], (c) => c.from);
  assert.equal(removed, "b:2\n");
  // a key written twice (the game reads the last): one line with the new value, where the first was
  const twice = gameOptions.rewriteOptions("renderDistance:16\nao:true\nrenderDistance:20\n", [{ key: "renderDistance", to: "12" }], (c) => c.to);
  assert.equal(twice, "renderDistance:12\nao:true\n");
  assert.equal(gameOptions.planBoost("renderDistance:8\nrenderDistance:20\n", { worldVersion: V1_21_1 })[0].from, "20");
});

async function instanceWith(text) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), "reminth-boost-"));
  const gameDir = path.join(home, "game");
  await fsp.mkdir(gameDir, { recursive: true });
  if (text !== null) await fsp.writeFile(path.join(gameDir, "options.txt"), text);
  const src = path.join(home, "jar");
  await fsp.mkdir(src, { recursive: true });
  await fsp.writeFile(path.join(src, "version.json"), JSON.stringify({ id: "26.2", world_version: V26 }));
  const clientJar = path.join(home, "26.2.jar");
  await zip.buildZip(src, clientJar);
  return { home, gameDir, clientJar };
}

test("applyBoost + undoBoost: saved first, applied, then put back exactly", async () => {
  const t = await instanceWith(OWNER);
  try {
    const plan = await gameOptions.boostPlan(t);
    assert.equal(plan.changes.length, 5);
    assert.equal(plan.canUndo, false);
    assert.deepEqual(await gameOptions.applyBoost(t), { changed: 5 });
    const boosted = await fsp.readFile(path.join(t.gameDir, "options.txt"), "utf8");
    assert.match(boosted, /^renderDistance:12\r$/m);
    assert.match(boosted, /^entityShadows:false\r$/m);
    assert.match(boosted, /^key_key\.jump:key\.keyboard\.space\r$/m); // untouched
    assert.equal((await gameOptions.boostPlan(t)).changes.length, 0);
    assert.equal((await gameOptions.boostPlan(t)).canUndo, true);
    assert.deepEqual(await gameOptions.undoBoost(t), { restored: 5 });
    assert.equal(await fsp.readFile(path.join(t.gameDir, "options.txt"), "utf8"), OWNER);
    assert.equal(fs.existsSync(path.join(t.gameDir, gameOptions.BOOST_FILE)), false);
  } finally {
    await fsp.rm(t.home, { recursive: true, force: true });
  }
});

test("undoBoost: a setting the player changed after the boost stays theirs", async () => {
  const t = await instanceWith(OWNER);
  try {
    await gameOptions.applyBoost(t);
    const file = path.join(t.gameDir, "options.txt");
    await fsp.writeFile(file, (await fsp.readFile(file, "utf8")).replace("renderDistance:12", "renderDistance:10"));
    assert.deepEqual(await gameOptions.undoBoost(t), { restored: 4 });
    const after = await fsp.readFile(file, "utf8");
    assert.match(after, /^renderDistance:10\r$/m);
    assert.match(after, /^simulationDistance:12\r$/m);
  } finally {
    await fsp.rm(t.home, { recursive: true, force: true });
  }
});

test("applyBoost twice: 'put back' still means the values from before the first boost", async () => {
  const t = await instanceWith(OWNER);
  try {
    await gameOptions.applyBoost(t);
    const file = path.join(t.gameDir, "options.txt");
    // the player turns shadows back on in the game, then boosts again
    await fsp.writeFile(file, (await fsp.readFile(file, "utf8")).replace("entityShadows:false", "entityShadows:true"));
    assert.deepEqual(await gameOptions.applyBoost(t), { changed: 1 });
    await gameOptions.undoBoost(t);
    assert.equal(await fsp.readFile(file, "utf8"), OWNER);
  } finally {
    await fsp.rm(t.home, { recursive: true, force: true });
  }
});

test("boostPlan: no options yet / no game files -> nothing to change, with the reason", async () => {
  const t = await instanceWith(null);
  try {
    assert.equal((await gameOptions.boostPlan(t)).reason, "no-options");
    await fsp.writeFile(path.join(t.gameDir, "options.txt"), OWNER);
    assert.equal((await gameOptions.boostPlan({ gameDir: t.gameDir, clientJar: null })).reason, "not-installed");
    assert.equal((await gameOptions.boostPlan({ gameDir: t.gameDir, clientJar: path.join(t.home, "missing.jar") })).reason, "not-installed");
  } finally {
    await fsp.rm(t.home, { recursive: true, force: true });
  }
});
