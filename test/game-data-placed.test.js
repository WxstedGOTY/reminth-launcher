const test = require("node:test");
const assert = require("node:assert");
const { estimatePlacedBlocks } = require("../src/main/gameData");

test("estimatePlacedBlocks counts blocks, not tools, food or throwables", () => {
  const used = {
    "minecraft:cobblestone": 100,
    "minecraft:oak_planks": 20,
    "minecraft:diamond_pickaxe": 5000,
    "minecraft:golden_apple": 30,
    "minecraft:ender_pearl": 12,
    "minecraft:bow": 40,
    "minecraft:cooked_beef": 9,
    "minecraft:water_bucket": 7,
  };
  assert.strictEqual(estimatePlacedBlocks(used), 120);
  assert.strictEqual(estimatePlacedBlocks(null), 0);
});
