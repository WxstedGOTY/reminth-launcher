"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { turnOnOnce, needsHud, MARKER } = require("../src/main/hudDefault");

const make = () => [
  { id: "a", loader: "fabric", hud: false },
  { id: "b", loader: "quilt", hud: false },
  { id: "c", loader: "fabric", hud: true },
  { id: "d", loader: "forge", hud: false }, // the HUD is a Fabric mod: never touched
  { id: "e", loader: "vanilla", hud: false },
];

test("needsHud: only Fabric/Quilt instances with the HUD off", () => {
  assert.deepEqual(make().map(needsHud), [true, true, false, false, false]);
  assert.equal(needsHud(null), false);
  assert.equal(needsHud({ loader: "fabric" }), false); // no value = not an explicit off
});

test("turnOnOnce: turns it on once, then a player's own 'off' stays off", async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "reminth-hud-"));
  try {
    const all = make();
    const update = async (id, patch) => Object.assign(all.find((i) => i.id === id), patch);
    assert.equal(await turnOnOnce({ dir, list: async () => all, update }), 2);
    assert.deepEqual(all.map((i) => i.hud), [true, true, true, false, false]);
    assert.ok(fs.existsSync(path.join(dir, MARKER)));
    // the player switches it off again later: the step never runs a second time
    all[0].hud = false;
    assert.equal(await turnOnOnce({ dir, list: async () => all, update }), 0);
    assert.equal(all[0].hud, false);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

test("turnOnOnce: a failure writes no marker (tried again next start) and never throws", async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "reminth-hud-"));
  try {
    const r = await turnOnOnce({ dir, list: async () => make(), update: async () => { throw new Error("disk"); } });
    assert.equal(r, 0);
    assert.equal(fs.existsSync(path.join(dir, MARKER)), false);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});
