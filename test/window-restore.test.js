"use strict";
/**
 * The window after a game (src/main/windowRestore.js): Windows un-maximizes
 * Reminth's window for a fullscreen game, and "launch minimized" minimizes
 * it; once no game runs any more it goes back to how it was.
 * Run with: node --test test/window-restore.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { afterGame, fillsWorkArea } = require("../src/main/windowRestore");

const now = (o) => ({ isMaximized: false, isMinimized: false, anyGameRunning: false, boundsFillWorkArea: true, ...o });

test("afterGame: maximized before, not now, no game running -> maximize", () => {
  assert.equal(afterGame({ wasMaximized: true, minimizedByUs: false }, now({})), "maximize");
});

test("afterGame: never while a game runs (it would take the focus from the game)", () => {
  for (const isMinimized of [true, false]) {
    for (const minimizedByUs of [true, false]) {
      assert.equal(afterGame({ wasMaximized: true, minimizedByUs }, now({ isMinimized, anyGameRunning: true })), "wait");
    }
  }
});

test("afterGame: a window that wasn't maximized is never made maximized", () => {
  assert.equal(afterGame({ wasMaximized: false, minimizedByUs: false }, now({})), "none");
  assert.equal(afterGame({ wasMaximized: false, minimizedByUs: false }, now({ isMaximized: true })), "none");
  assert.equal(afterGame({ wasMaximized: false, minimizedByUs: true }, now({ isMinimized: true })), "restore");
});

test("afterGame: still maximized -> nothing to do", () => {
  assert.equal(afterGame({ wasMaximized: true, minimizedByUs: false }, now({ isMaximized: true })), "none");
});

test("afterGame: minimized by Reminth for the game -> back as it was, at the end of the game, not before", () => {
  assert.equal(afterGame({ wasMaximized: true, minimizedByUs: true }, now({ isMinimized: true })), "restore-maximize");
  assert.equal(afterGame({ wasMaximized: true, minimizedByUs: true }, now({ isMinimized: true, anyGameRunning: true })), "wait");
  // the player brought it back during the game, Windows left it small
  assert.equal(afterGame({ wasMaximized: true, minimizedByUs: true }, now({})), "maximize");
});

test("afterGame: minimized by the player -> left alone until they bring it back", () => {
  assert.equal(afterGame({ wasMaximized: true, minimizedByUs: false }, now({ isMinimized: true })), "wait");
});

test("afterGame: nothing remembered -> nothing", () => {
  assert.equal(afterGame(null, now({})), "none");
  assert.equal(afterGame({ wasMaximized: true }, null), "none");
});

/* ---- flagged maximized but shrunk (measured on Windows: IsZoomed TRUE, 800x552) ---- */

const WORK = { x: 0, y: 0, width: 1920, height: 1032 };

test("fillsWorkArea: a real maximized window (8 px over each side) fills it; 800x552 doesn't", () => {
  assert.equal(fillsWorkArea({ x: -8, y: -8, width: 1936, height: 1048 }, WORK), true);
  assert.equal(fillsWorkArea({ x: 0, y: 0, width: 1920, height: 1032 }, WORK), true, "no overhang is still full");
  assert.equal(fillsWorkArea({ x: -8, y: -8, width: 816, height: 568 }, WORK), false);
  assert.equal(fillsWorkArea({ x: 0, y: 0, width: 1320, height: 840 }, WORK), false);
  assert.equal(fillsWorkArea({ width: 1936, height: 900 }, WORK), false, "full width, short: not full");
  // within the tolerance (24 px around work area + 16)
  assert.equal(fillsWorkArea({ width: 1912, height: 1024 }, WORK), true);
  assert.equal(fillsWorkArea({ width: 1911, height: 1048 }, WORK), false);
  // can't tell: counted as full, so nothing is changed on a guess
  for (const bad of [null, {}, { width: NaN, height: 5 }, { width: 0, height: 0 }]) {
    assert.equal(fillsWorkArea(bad, WORK), true);
    assert.equal(fillsWorkArea({ width: 800, height: 552 }, bad), true);
  }
});

test("afterGame: flagged maximized but small -> repair; maximized and full -> nothing", () => {
  const before = { wasMaximized: true, minimizedByUs: false };
  assert.equal(afterGame(before, now({ isMaximized: true, boundsFillWorkArea: false })), "repair");
  assert.equal(afterGame(before, now({ isMaximized: true, boundsFillWorkArea: true })), "none");
});

test("afterGame: the repair only for a window that was maximized when the game started", () => {
  assert.equal(afterGame({ wasMaximized: false, minimizedByUs: false }, now({ isMaximized: true, boundsFillWorkArea: false })), "none");
  assert.equal(afterGame({ wasMaximized: false, minimizedByUs: false }, now({ isMaximized: false, boundsFillWorkArea: false })), "none");
});

test("afterGame: no repair while a game still runs", () => {
  assert.equal(afterGame({ wasMaximized: true, minimizedByUs: false }, now({ isMaximized: true, boundsFillWorkArea: false, anyGameRunning: true })), "wait");
});

test("afterGame: already repaired once -> nothing (it can't loop)", () => {
  assert.equal(afterGame({ wasMaximized: true, minimizedByUs: false, repaired: true }, now({ isMaximized: true, boundsFillWorkArea: false })), "none");
  assert.equal(afterGame({ wasMaximized: true, minimizedByUs: true, repaired: true }, now({ isMinimized: true })), "none");
});
