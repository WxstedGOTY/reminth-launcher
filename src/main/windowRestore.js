"use strict";
/**
 * Putting Reminth's window back the way it was after a game.
 *
 * Windows un-maximizes a window when a fullscreen game takes over the
 * display, so Reminth came back at its small windowed size after a game.
 * main.js remembers the window's state when a game is launched and asks
 * afterGame() what to do when a game session ends and whenever the window
 * is focused or restored. Pure - no Electron here, so it can be tested.
 */

/**
 * before: { wasMaximized, minimizedByUs } - remembered at launch
 *   (minimizedByUs: Reminth minimized itself for the game - "launch minimized").
 * now: { isMaximized, isMinimized, anyGameRunning }.
 * Returns one of:
 *   "wait"             - not yet (a game still runs, or the player minimized
 *                        the window and hasn't brought it back): keep `before`
 *   "none"             - nothing to do: forget `before`
 *   "maximize"         - it was maximized and isn't now
 *   "restore"          - Reminth minimized itself for the game: bring it back, normal size
 *   "restore-maximize" - the same, back maximized
 */
function afterGame(before, now) {
  if (!before || !now) return "none";
  // Never touch the window while a game runs - it would take focus from the game.
  if (now.anyGameRunning) return "wait";
  if (now.isMinimized) {
    if (!before.minimizedByUs) return "wait"; // the player's own choice: fix it when they bring it back
    return before.wasMaximized ? "restore-maximize" : "restore";
  }
  if (before.wasMaximized && !now.isMaximized) return "maximize";
  return "none";
}

module.exports = { afterGame };
