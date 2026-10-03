"use strict";
/**
 * The window after a game (src/main/windowRestore.js): Windows un-maximizes
 * Reminth's window for a fullscreen game, and "launch minimized" minimizes
 * it; once no game runs any more it goes back to how it was.
 * Run with: node --test test/window-restore.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { afterGame } = require("../src/main/windowRestore");

const now = (o) => ({ isMaximized: false, isMinimized: false, anyGameRunning: false, ...o });

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
