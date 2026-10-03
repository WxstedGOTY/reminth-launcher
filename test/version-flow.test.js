"use strict";
/**
 * Prompt 11: "Pick a Minecraft version for my mods".
 *  - the pure rules in renderer/pure.js: which versions come first, the
 *    plain-word mod groups, which choice (switch this instance / make a new
 *    one) is allowed and recommended;
 *  - the main-process "switch this instance" operation (main/versionSwitch.js)
 *    with stubs for each step that can fail;
 *  - the "turned off by Reminth" reasons kept in content.json.
 * No network, no Electron.
 * Run with: node --test test/version-flow.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "reminth-versionflow-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return "STUB_ELECTRON_VERSIONFLOW";
  return originalResolve.call(this, request, ...rest);
};
Module._cache.STUB_ELECTRON_VERSIONFLOW = { id: "STUB_ELECTRON_VERSIONFLOW", filename: "STUB_ELECTRON_VERSIONFLOW", loaded: true, exports: { safeStorage: { isEncryptionAvailable: () => false } } };

const pure = require("../src/renderer/pure");

/* ---------------- job 1: the list and the groups ---------------- */

// 29 mods like the owner's instance: 26 known to Modrinth, 2 not from Modrinth, 1 lookup that failed.
const titles = Array.from({ length: 26 }, (_, i) => `Mod ${i + 1}`);
const advice = (candidates) => ({ total: 26, mods: titles.map((title, i) => ({ projectId: "P" + i, title })), unknown: ["Own Mod", "Old Jar"], failed: ["Flaky"], candidates });
const row = (version, missing = [], extra = {}) => ({ version, total: 26, supported: 26 - missing.length, missing, server: null, current: false, ...extra });

test("rankVersionRows: fewest mods without a build first, then the newest; the current version is never 'best'", () => {
  const { rows, best } = pure.rankVersionRows([
    row("1.21.4", ["Mod 1", "Mod 2", "Mod 3"]),
    row("26.2", [], { current: true }),
    row("1.21.1", []),
    row("26.1", ["Mod 1"]),
    row("1.20.1", []),
  ]);
  assert.deepEqual(rows.map((r) => r.version), ["26.2", "1.21.1", "1.20.1", "26.1", "1.21.4"]);
  assert.equal(best.version, "1.21.1");
  assert.equal(pure.bestLine(best, "switch"), "Best match: 1.21.1 — all 26 mods fit");
  // nothing perfect
  const partial = pure.rankVersionRows([row("26.3", ["A", "B"]), row("1.21.4", ["A", "B", "C"]), row("26.1", ["A", "B"])]);
  assert.deepEqual(partial.rows.map((r) => r.version), ["26.3", "26.1", "1.21.4"]);
  assert.equal(pure.bestLine(partial.best, "switch"), "Fits most: 26.3 — 2 mods have to be turned off");
  assert.equal(pure.bestLine(partial.best, "copy"), "Fits most: 26.3 — 2 mods have to be left out");
  assert.equal(pure.bestLine(pure.rankVersionRows([row("1.2", ["A"])]).best, "switch"), "Fits most: 1.2 — 1 mod has to be turned off");
  // none at all
  assert.deepEqual(pure.rankVersionRows([]), { rows: [], best: null });
  assert.deepEqual(pure.rankVersionRows([row("26.2", [], { current: true })]).best, null);
  assert.equal(pure.bestLine(null), null);
  // a server was checked: versions it takes come first, and "best" is one it takes
  const srv = pure.rankVersionRows([row("1.21.1", [], { server: false }), row("1.21.4", ["A"], { server: true })], { server: true });
  assert.deepEqual([srv.rows[0].version, srv.best.version], ["1.21.4", "1.21.4"]);
});

test("modGroups: every mod in one plain group, saying exactly what happens - per action", () => {
  const a = advice([]);
  const r = row("1.21.4", ["Mod 1", "Mod 2", "Mod 3"]);
  const sw = pure.modGroups(a, r, "switch");
  assert.deepEqual(sw.map((g) => [g.key, g.title, g.names.length]), [
    ["works", "Will work (23)", 23],
    ["nobuild", "No build for 1.21.4 (3)", 3],
    ["unknown", "Not from Modrinth, Reminth can't check these (2)", 2],
    ["failed", "Couldn't be checked just now (1)", 1],
  ]);
  assert.deepEqual(sw[1].names, ["Mod 1", "Mod 2", "Mod 3"]);
  assert.equal(sw[1].sentence, "They can't work with the rest on 1.21.4, so they will be turned off (you can turn them on again).");
  assert.match(sw[2].sentence, /^They will be kept as they are, unless the file itself says it can't run on 1\.21\.4/);
  const cp = pure.modGroups(a, r, "copy");
  assert.equal(cp[1].sentence, "They can't work with the rest on 1.21.4, so they will be left out of the copy.");
  assert.match(cp[2].sentence, /^They will be left out of the copy\./);
  // a perfect match: one group only
  assert.deepEqual(pure.modGroups({ mods: [{ title: "A" }], unknown: [], failed: [] }, row("1.21.1"), "switch").map((g) => g.key), ["works"]);
  assert.deepEqual(pure.modGroups(null, null, "switch"), []);
});

/* ---------------- job 2: which choice ---------------- */

test("versionChoices: switch for same/newer; only a new instance for an older version with worlds, a modpack, a running game", () => {
  const c = (o) => pure.versionChoices({ from: "26.2", to: "26.3", worlds: 2, ...o });
  assert.deepEqual([c({}).switch.allowed, c({}).recommended], [true, "switch"]);
  assert.deepEqual([c({ to: "26.2" }).switch.allowed, c({ to: "26.2" }).recommended], [true, "switch"]);
  const older = c({ to: "1.21.4" });
  assert.deepEqual([older.switch.allowed, older.recommended, older.copy.allowed], [false, "copy", true]);
  assert.match(older.switch.why, /saved in Minecraft 26\.2\. Opening them in the older 1\.21\.4 can damage them/);
  // older but no worlds: switching is fine
  assert.deepEqual([c({ to: "1.21.4", worlds: 0 }).switch.allowed, c({ to: "1.21.4", worlds: 0 }).recommended], [true, "switch"]);
  const pack = c({ modpack: true });
  assert.deepEqual([pack.switch.allowed, pack.recommended], [false, "copy"]);
  assert.match(pack.switch.why, /modpack/);
  const run = c({ running: true });
  assert.deepEqual([run.switch.allowed, run.recommended], [false, "copy"]);
  assert.match(run.switch.why, /^Close the game first/);
  assert.equal(pure.compareMc("1.21.10", "1.21.9"), 1);
  assert.equal(pure.compareMc("26.1", "1.21.11"), 1);
  assert.equal(pure.compareMc("24w14a", "1.21"), null);
});
