"use strict";
// Home's stat icons in Minecraft's own pictures (src/main/mcTextures.js): read from a downloaded client jar, all six
// from the same one, cached; an old jar (before 1.13) or a broken file is skipped; no jar -> null (hand-drawn icons).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const mcTextures = require("../src/main/mcTextures");

function png(w, h) {
  const b = Buffer.alloc(80);
  b.writeUInt32BE(0x89504e47, 0);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

function fakeVersions() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-mctex-"));
  const versions = path.join(dir, "versions");
  for (const [v, at] of [["1.12.2", 3000], ["26.2", 2000], ["1.21.4", 1000]]) {
    fs.mkdirSync(path.join(versions, v), { recursive: true });
    const jar = path.join(versions, v, v + ".jar");
    fs.writeFileSync(jar, "jar");
    fs.utimesSync(jar, at, at);
  }
  return { dir, versions, cache: path.join(dir, "cache") };
}

// what each fake jar holds: 1.12.2 has only the old names, 26.2 everything (the pig under its 26.x name)
const T = "assets/minecraft/textures/";
const content = {
  "1.12.2": { [T + "items/diamond_sword.png"]: png(16, 16), [T + "entity/pig/pig.png"]: png(64, 32) },
  "26.2": {
    [T + "item/diamond_sword.png"]: png(16, 16),
    [T + "item/iron_pickaxe.png"]: png(16, 16),
    [T + "entity/skeleton/skeleton.png"]: png(64, 32),
    [T + "entity/pig/pig_temperate.png"]: png(64, 64),
    [T + "block/grass_block_top.png"]: png(16, 16),
    [T + "block/grass_block_side.png"]: png(16, 16),
  },
};

test("plausiblePng: real small PNGs only", () => {
  assert.equal(mcTextures.plausiblePng(png(16, 16)), true);
  assert.equal(mcTextures.plausiblePng(png(64, 32)), true);
  assert.equal(mcTextures.plausiblePng(png(8, 8)), false);
  assert.equal(mcTextures.plausiblePng(png(4096, 4096)), false);
  assert.equal(mcTextures.plausiblePng(Buffer.from("not a png at all, just some text here to be long enough......")), false);
  assert.equal(mcTextures.plausiblePng(null), false);
});

test("load: skips a jar from before 1.13, takes all six from one newer jar, then answers from the cache", async () => {
  const { versions, cache } = fakeVersions();
  const asked = [];
  const read = async (jar, names) => {
    const v = path.basename(jar, ".jar");
    asked.push(v);
    const have = content[v] || {};
    return Object.fromEntries(names.map((n) => [n, have[n]]));
  };
  const got = await mcTextures.load({ versionsDir: versions, cacheDir: cache, read });
  assert.deepEqual(asked, ["1.12.2", "26.2"], "newest download first; the old jar is skipped");
  assert.deepEqual(Object.keys(got).sort(), ["grassSide", "grassTop", "pickaxe", "pig", "skeleton", "sword"]);
  for (const url of Object.values(got)) assert.match(url, /^data:image\/png;base64,/);
  assert.equal(Buffer.from(got.pig.split(",")[1], "base64").readUInt32BE(20), 64, "the 26.x pig (64x64)");
  // second time: from the cache, no jar opened
  asked.length = 0;
  const again = await mcTextures.load({ versionsDir: versions, cacheDir: cache, read });
  assert.deepEqual(asked, []);
  assert.deepEqual(again, got);
});

test("load: no game downloaded, or only broken jars -> null", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-mctex-"));
  assert.equal(await mcTextures.load({ versionsDir: path.join(dir, "nothing"), cacheDir: path.join(dir, "c") }), null);
  const { versions, cache } = fakeVersions();
  const read = async () => {
    throw new Error("broken zip");
  };
  assert.equal(await mcTextures.load({ versionsDir: versions, cacheDir: cache, read }), null);
});
