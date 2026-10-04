"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const gameData = require("../src/main/gameData");

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "reminth-sstats-"));
}
function put(gameDir, name, obj) {
  const dir = path.join(gameDir, ".reminth", "server-stats");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), typeof obj === "string" ? obj : JSON.stringify(obj));
}

test("readServerStats: reads the HUD's files, skips another account and broken files", async () => {
  const dir = tmp();
  const me = "bb96aed5-43ae-4312-a38b-128d3571c3a4";
  put(dir, "play.example.net.json", { server: "play.example.net", uuid: me, savedAt: 5, stats: { "minecraft:mined": { "minecraft:stone": 12 }, "minecraft:custom": { "minecraft:play_time": 100, "minecraft:deaths": 3 } } });
  put(dir, "other.json", { server: "other", uuid: "11111111-2222-3333-4444-555555555555", savedAt: 1, stats: { "minecraft:mined": { "minecraft:stone": 999 } } });
  put(dir, "broken.json", "{not json");
  const got = await gameData.readServerStats(dir, me.replace(/-/g, ""));
  assert.equal(got.length, 1);
  assert.equal(got[0].server, "play.example.net");
  assert.equal(got[0].stats.mined["minecraft:stone"], 12);
  assert.equal(got[0].stats.playTimeTicks, 100);
});

test("readServerStats: no folder is an empty list", async () => {
  assert.deepEqual(await gameData.readServerStats(tmp(), "abc"), []);
});

test("playerStats: server numbers are added to the world numbers; the same server in two instances counts once (the newest)", async () => {
  const a = tmp();
  const b = tmp();
  const me = "bb96aed5-43ae-4312-a38b-128d3571c3a4";
  const snap = (n, at) => ({ server: "s.example.net", uuid: me, savedAt: at, stats: { "minecraft:mined": { "minecraft:stone": n }, "minecraft:custom": { "minecraft:deaths": 2 } } });
  put(a, "s.example.net.json", snap(10, 1));
  put(b, "s.example.net.json", snap(50, 2));
  const s = await gameData.playerStats(me, [{ id: "a", name: "A", gameDir: a }, { id: "b", name: "B", gameDir: b }]);
  assert.equal(s.found, true);
  assert.equal(s.serverCount, 1);
  assert.equal(s.totals.mined, 50);
  assert.equal(s.deaths, 2);
});
