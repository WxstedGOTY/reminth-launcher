"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { HOSTS, CHIP_SCORE, rows, orderPaid, orderFree, CHECKED } = require("../src/renderer/hosts");

test("hosts: every host has an id, a name, an https link to its own site and a tier; ids are unique", () => {
  const ids = new Set();
  for (const h of HOSTS) {
    assert.match(h.id, /^[a-z0-9-]+$/);
    assert.ok(h.name && !ids.has(h.id), h.id);
    ids.add(h.id);
    assert.match(h.url, /^https:\/\//, h.id);
    assert.ok(h.tier === "free" || h.tier === "paid", h.id);
    assert.ok(Array.isArray(h.facts) && h.facts.length > 0, h.id);
  }
  assert.match(CHECKED, /^\d{4}-\d\d-\d\d$/);
});

test("hosts: a chip that is named must be one the order knows (no made-up or unranked chips)", () => {
  for (const h of HOSTS) if (h.chip) assert.ok(h.chip in CHIP_SCORE, `${h.id}: ${h.chip}`);
  for (const h of HOSTS.filter((x) => x.tier === "free")) assert.equal(h.chip, null, `${h.id} publishes no chip - never guessed`);
});

test("rows: 5 paid hosts, best published chip first; a 'mixed' host comes after a host with the same chip that promises it", () => {
  const { paid } = rows();
  assert.equal(paid.length, 5);
  assert.deepEqual(paid.map((h) => h.id), ["pebblehost", "sparked", "bisect", "shockbyte", "apex"]);
  assert.equal(paid[0].chipText, "Ryzen 9 9950X3D");
});

test("rows: free hosts by RAM, 'not published' last, and every free host says its processor is not published", () => {
  const { free } = rows();
  assert.deepEqual(free.map((h) => h.id), ["falix", "minefort", "minehut", "aternos"]);
  assert.ok(free.every((h) => h.chipText === "Processor not published"));
});

test("order: a paid host with no chip goes last; free hosts never appear in the paid row", () => {
  const list = [
    { id: "a", name: "A", tier: "paid", chip: null, facts: ["x"] },
    { id: "b", name: "B", tier: "paid", chip: "Ryzen 9 7950X", facts: ["x"] },
    { id: "c", name: "C", tier: "free", ramGb: 2, facts: ["x"] },
  ];
  assert.deepEqual(orderPaid(list).map((h) => h.id), ["b", "a"]);
  assert.deepEqual(orderFree(list).map((h) => h.id), ["c"]);
});
