"use strict";
/**
 * Prompt 10: the instance right-click menu, moving instances, and instances
 * Reminth makes by itself (confirm first, reuse, madeFor, Undo).
 *  - pure rules (renderer/pure.js, main/instances.js);
 *  - instances.reorder / summary / create (no duplicate names, madeFor, new
 *    ones at the end) on a throwaway HOME;
 *  - the IPC on a fake Electron is in test/perf-profiles.test.js.
 * Run with: node --test test/instance-menu.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "reminth-instmenu-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.APPDATA = path.join(HOME, "AppData", "Roaming");
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return "STUB_ELECTRON_INSTMENU";
  return originalResolve.call(this, request, ...rest);
};
Module._cache.STUB_ELECTRON_INSTMENU = { id: "STUB_ELECTRON_INSTMENU", filename: "STUB_ELECTRON_INSTMENU", loaded: true, exports: { safeStorage: { isEncryptionAvailable: () => false } } };

const pure = require("../src/renderer/pure");
const instances = require("../src/main/instances");
const paths = require("../src/main/paths");

/* ---------------- the menu ---------------- */

test("instanceMenuItems: order, the main instance's Delete shown but off, a running one can't be renamed or deleted", () => {
  const ids = (items) => items.map((i) => i.id);
  const normal = pure.instanceMenuItems({ name: "Survival" }, { index: 1, count: 3 });
  assert.deepEqual(ids(normal), ["play", "open", "rename", "folder", "verify", "boost", "up", "down", "top", "bottom", "delete"]);
  assert.equal(normal.find((i) => i.id === "delete").disabled, false);
  assert.equal(normal.find((i) => i.id === "delete").danger, true);
  const main = pure.instanceMenuItems({ name: "Reminth" }, { isMain: true, index: 0, count: 1 });
  const del = main.find((i) => i.id === "delete");
  assert.deepEqual([del.disabled, del.why], [true, "This is your main instance - it can't be deleted."]);
  // only one instance: no moving at all, the menu still has everything
  assert.deepEqual(main.filter((i) => ["up", "down", "top", "bottom"].includes(i.id)).map((i) => i.disabled), [true, true, true, true]);
  const running = pure.instanceMenuItems({ name: "Survival" }, { running: true, index: 0, count: 3 });
  for (const id of ["play", "rename", "boost", "delete"]) assert.equal(running.find((i) => i.id === id).disabled, true, id);
  assert.equal(running.find((i) => i.id === "rename").why, "Close the game first.");
  // first / last can't go further that way
  const firstOf3 = pure.instanceMenuItems({}, { index: 0, count: 3 });
  assert.deepEqual(firstOf3.filter((i) => ["up", "down", "top", "bottom"].includes(i.id)).map((i) => i.disabled), [true, false, true, false]);
  const lastOf3 = pure.instanceMenuItems({}, { index: 2, count: 3 });
  assert.deepEqual(lastOf3.filter((i) => ["up", "down", "top", "bottom"].includes(i.id)).map((i) => i.disabled), [false, true, false, true]);
});

test("moveIndex / moveItem / dropGapToIndex: top, bottom, up, down, and a drag's drop gap", () => {
  const l = ["a", "b", "c", "d"];
  assert.deepEqual(pure.moveItem(l, 3, pure.moveIndex(3, 4, "top")), ["d", "a", "b", "c"]);
  assert.deepEqual(pure.moveItem(l, 0, pure.moveIndex(0, 4, "bottom")), ["b", "c", "d", "a"]);
  assert.deepEqual(pure.moveItem(l, 2, pure.moveIndex(2, 4, "up")), ["a", "c", "b", "d"]);
  assert.deepEqual(pure.moveItem(l, 1, pure.moveIndex(1, 4, "down")), ["a", "c", "b", "d"]);
  assert.deepEqual(pure.moveItem(l, 0, pure.moveIndex(0, 4, "up")), l, "the first can't go up");
  // dragging "a" into the gap before "d" (gap 3) -> after "c"
  assert.deepEqual(pure.moveItem(l, 0, pure.dropGapToIndex(0, 3)), ["b", "c", "a", "d"]);
  // dragging "d" into the gap before "a" (gap 0) -> first
  assert.deepEqual(pure.moveItem(l, 3, pure.dropGapToIndex(3, 0)), ["d", "a", "b", "c"]);
  // into the gap after the last (gap 4)
  assert.deepEqual(pure.moveItem(l, 1, pure.dropGapToIndex(1, 4)), ["a", "c", "d", "b"]);
  assert.deepEqual(l, ["a", "b", "c", "d"], "the list itself is never changed");
});

test("summaryText: worlds and size, 'about' when the count stopped early", () => {
  assert.equal(pure.summaryText({ worlds: 2, bytes: 1.4 * 1024 ** 3 }), "2 worlds, 1.4 GB");
  assert.equal(pure.summaryText({ worlds: 1, bytes: 830 * 1024 * 1024, capped: true }), "1 world, about 830 MB");
  assert.equal(pure.summaryText({ worlds: 0, bytes: 2048 }), "no worlds, 2 KB");
});

/* ---------------- making instances by itself ---------------- */

test("createSentence / reusableInstance: the one confirmation, and an instance to use instead", () => {
  assert.equal(pure.createSentence({ name: "Hypixel", mcVersion: "1.21.4", loader: "vanilla" }), "Reminth will make a new instance: Hypixel - Minecraft 1.21.4 vanilla. Your other instances are not changed.");
  const list = [
    { id: "a", mcVersion: "1.21.4", loader: "fabric" },
    { id: "b", mcVersion: "1.21.4", loader: "vanilla" },
    { id: "c", mcVersion: "1.21.4", loader: "vanilla" },
  ];
  assert.equal(pure.reusableInstance(list, { mcVersion: "1.21.4", loader: "vanilla" }).id, "b");
  assert.equal(pure.reusableInstance(list, { mcVersion: "1.21.4", loader: "fabric", excludeId: "a" }), null);
  assert.equal(pure.reusableInstance(list, { mcVersion: "26.2", loader: "vanilla" }), null);
});

test("cleanMadeFor / uniqueName / undoAllowed", () => {
  assert.equal(instances.cleanMadeFor("For Hypixel"), "For Hypixel");
  assert.equal(instances.cleanMadeFor("  <b>Copy</b>\nof\tSurvival  "), "b Copy /b of Survival");
  assert.equal(instances.cleanMadeFor("x".repeat(80)).length, 60);
  for (const bad of [null, 5, "", "   ", {}]) assert.equal(instances.cleanMadeFor(bad), null);
  const all = [{ name: "Hypixel", mcVersion: "1.21.4", loader: "vanilla" }, { name: "Hypixel (2)", mcVersion: "1.21.4", loader: "vanilla" }, { name: "Other", mcVersion: "26.2", loader: "fabric" }];
  assert.equal(instances.uniqueName("Hypixel", all, "1.21.4", "vanilla"), "Hypixel (3)");
  assert.equal(instances.uniqueName("hypixel ", all, "1.21.4", "vanilla"), "hypixel (3)");
  assert.equal(instances.uniqueName("Hypixel", all, "1.21.4", "fabric"), "Hypixel", "another loader is another instance");
  assert.equal(instances.uniqueName("Other", all, "26.2", "fabric"), "Other (2)");
  // Undo: never played, and no world the player made
  assert.equal(instances.undoAllowed({ lastPlayed: null, worldNames: [] }), true);
  assert.equal(instances.undoAllowed({ lastPlayed: 123, worldNames: [] }), false);
  assert.equal(instances.undoAllowed({ lastPlayed: null, worldNames: ["New World"] }), false);
  assert.equal(instances.undoAllowed({ lastPlayed: null, worldNames: ["Carried"], carried: ["Carried"] }), true);
});

test("instances: new ones go at the END, names never repeat, madeFor kept; reorder saved and checked; the main one may move", async () => {
  const a = await instances.create({ name: "Hypixel", mcVersion: "1.21.4", loader: "vanilla", madeFor: "For Hypixel" });
  const b = await instances.create({ name: "Hypixel", mcVersion: "1.21.4", loader: "vanilla" });
  assert.equal(b.name, "Hypixel (2)");
  assert.equal(a.madeFor, "For Hypixel");
  let ids = (await instances.list()).map((i) => i.id);
  assert.deepEqual(ids, ["reminth", a.id, b.id]);
  // the player's order, main instance included
  await instances.reorder([b.id, a.id, "reminth"]);
  // a fresh read from disk (what a restart sees)
  const onDisk = JSON.parse(await fsp.readFile(paths.INSTANCES_FILE, "utf8")).map((i) => i.id);
  assert.deepEqual(onDisk, [b.id, a.id, "reminth"]);
  // a new one still goes at the end
  const c = await instances.create({ name: "New", mcVersion: "26.2", loader: "fabric" });
  ids = (await instances.list()).map((i) => i.id);
  assert.deepEqual(ids, [b.id, a.id, "reminth", c.id]);
  // refused: a missing one, an unknown one, a double - and the order stays
  for (const bad of [[b.id, a.id, "reminth"], [b.id, a.id, "reminth", c.id, "ghost"], [b.id, b.id, "reminth", c.id], "nope"]) {
    await assert.rejects(instances.reorder(bad), /doesn't match your instances/);
  }
  assert.deepEqual((await instances.list()).map((i) => i.id), [b.id, a.id, "reminth", c.id]);
});

test("summary: worlds and bytes, links not followed, stops at the time limit", async () => {
  const made = await instances.create({ name: "Sized", mcVersion: "26.2", loader: "fabric" });
  const dir = made.gameDir;
  await fsp.mkdir(path.join(dir, "saves", "W1"), { recursive: true });
  await fsp.writeFile(path.join(dir, "saves", "W1", "level.dat"), Buffer.alloc(1000));
  await fsp.mkdir(path.join(dir, "saves", "not a world"), { recursive: true });
  await fsp.mkdir(path.join(dir, "mods"), { recursive: true });
  await fsp.writeFile(path.join(dir, "mods", "a.jar"), Buffer.alloc(5000));
  // a big folder outside, linked in: never counted
  const outside = path.join(HOME, "outside");
  await fsp.mkdir(outside, { recursive: true });
  await fsp.writeFile(path.join(outside, "big.bin"), Buffer.alloc(200000));
  let linked = true;
  try {
    await fsp.symlink(outside, path.join(dir, "linked"), "junction");
  } catch {
    linked = false; // no right to make links here
  }
  const s = await instances.summary(made.id);
  assert.equal(s.worlds, 1);
  assert.equal(s.capped, false);
  assert.ok(s.bytes >= 6000 && s.bytes < 100000, `bytes ${s.bytes}${linked ? " (link not followed)" : ""}`);
  // a clock that has already run out: stops straight away, "about"
  let t = 0;
  const capped = await instances.summary(made.id, { timeMs: 5, now: () => (t += 10) });
  assert.equal(capped.capped, true);
});

test("every place that makes an instance asks first (an audit of the renderer's calls)", () => {
  // createInstance / copyInstanceToVersion may only be called from:
  //  - the New instance dialog (the player asked for exactly that), or
  //  - a function that goes through confirmNewInstance (the one question), or
  //  - the version picker, whose new-instance card IS that question (it shows
  //    createSentence and "Use <instance>" before the button that makes it).
  const allowed = {
    openInstanceModal: "the New instance dialog",
    openVersionAdvisor: "the version picker's confirm card",
  };
  const sources = ["renderer.js", "features.js"].map((f) => [f, fs.readFileSync(path.join(__dirname, "..", "src", "renderer", f), "utf8")]);
  let calls = 0;
  for (const [file, text] of sources) {
    for (const m of text.matchAll(/window\.reminth\.(createInstance|copyInstanceToVersion)\(/g)) {
      calls++;
      // the function this call is in: the nearest top-level "function name(" before it
      const before = text.slice(0, m.index);
      const fns = [...before.matchAll(/^(?:async )?function (\w+)\(/gm)];
      const fn = fns.length ? fns[fns.length - 1] : null;
      assert.ok(fn, `${file}: a ${m[1]} call outside any function`);
      const body = text.slice(fn.index, m.index);
      const ok = allowed[fn[1]] || /confirmNewInstance\(/.test(body);
      assert.ok(ok, `${file}: ${fn[1]}() calls ${m[1]} without asking first (confirmNewInstance)`);
      if (fn[1] === "openVersionAdvisor") assert.match(text.slice(fn.index), /createSentence|Reminth will make a new instance/, "the picker's card says what will be made");
    }
  }
  assert.ok(calls >= 3, `found ${calls} creation calls - the audit is looking at the wrong files`);
});
