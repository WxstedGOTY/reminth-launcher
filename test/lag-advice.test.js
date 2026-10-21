"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseLog, advise, readLog, LOG } = require("../src/main/lagAdvice");

const now = new Date("2026-10-21T22:00:00");
const line = (ms, doing, narrator = "off", day = "2026-10-21") => `${day} 21:40:02\t${ms} ms\t${doing}\tnarrator ${narrator}`;

test("parseLog: reads SpikeLog.java's lines, skips anything else", () => {
  const s = parseLog([line(412, "inventory (just opened)", "on"), "garbage", line(300, "playing"), ""].join("\r\n"));
  assert.deepEqual(s, [
    { at: "2026-10-21 21:40:02", ms: 412, doing: "inventory", justOpened: true, narrator: true },
    { at: "2026-10-21 21:40:02", ms: 300, doing: "playing", justOpened: false, narrator: false },
  ]);
});

test("advise: Narrator spikes -> turn the Narrator off, first", () => {
  const tips = advise(parseLog([line(400, "inventory (just opened)", "on"), line(380, "chat (just opened)", "on")].join("\n")), { now });
  assert.equal(tips[0].id, "narrator");
  assert.equal(tips[0].count, 2);
});

test("advise: 3+ inventory-opening spikes without the Narrator -> the inventory tip; few spikes -> nothing", () => {
  const three = Array(3).fill(line(300, "container (just opened)")).join("\n");
  assert.deepEqual(advise(parseLog(three), { now }).map((t) => t.id), ["inventory"]);
  assert.deepEqual(advise(parseLog(line(300, "inventory (just opened)")), { now }), []);
});

test("advise: 5+ spikes while playing -> render distance tip; old spikes (over 7 days) don't count", () => {
  const five = Array(5).fill(line(500, "playing")).join("\n");
  assert.deepEqual(advise(parseLog(five), { now }).map((t) => t.id), ["render"]);
  const old = Array(5).fill(line(500, "playing", "off", "2026-10-01")).join("\n");
  assert.deepEqual(advise(parseLog(old), { now }), []);
});

test("readLog: no file -> []; a file -> its spikes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spaceport-lag-"));
  try {
    assert.deepEqual(await readLog(dir), []);
    fs.mkdirSync(path.join(dir, ".reminth"));
    fs.writeFileSync(path.join(dir, LOG), line(260, "menu") + "\n");
    assert.equal((await readLog(dir)).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
