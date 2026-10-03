"use strict";
/**
 * Putting Reminth's window back the way it was after a game.
 *
 * Windows changes Reminth's window when a fullscreen game takes over the
 * display. Two ways have been seen or assumed:
 *  - the window is un-maximized;
 *  - (measured on Windows 11, 1920x1080) the window stays FLAGGED maximized
 *    (IsZoomed, win.isMaximized() true, title bar shows "restore") but is
 *    shrunk to 800x552 - it no longer fills the work area.
 * main.js remembers the window's state when a game is launched and asks
 * afterGame() what to do when a game session ends and whenever the window
 * is focused or restored. Pure - no Electron here, so it can be tested.
 */

/**
 * Does a maximized window's rectangle fill the display's work area?
 * A maximized frameless window on Windows sticks out about 8 px on each
 * side (rect (-8,-8)-(1928,1040) on a 1920x1032 work area), so it is
 * "full" when its width and height are within `tolerance` px of the work
 * area + 16. Bad input counts as full (nothing is changed on a guess).
 */
function fillsWorkArea(bounds, workArea, tolerance = 24) {
  const ok = (r) => r && Number.isFinite(r.width) && Number.isFinite(r.height) && r.width > 0 && r.height > 0;
  if (!ok(bounds) || !ok(workArea)) return true;
  return bounds.width >= workArea.width + 16 - tolerance && bounds.height >= workArea.height + 16 - tolerance;
}

/**
 * before: { wasMaximized, minimizedByUs, repaired } - remembered at launch
 *   (minimizedByUs: Reminth minimized itself for the game - "launch minimized";
 *    repaired: the repair below already ran for this game end).
 * now: { isMaximized, isMinimized, anyGameRunning, boundsFillWorkArea }.
 * Returns one of:
 *   "wait"             - not yet (a game still runs, or the player minimized
 *                        the window and hasn't brought it back): keep `before`
 *   "none"             - nothing to do: forget `before`
 *   "maximize"         - it was maximized and isn't now
 *   "repair"           - it says it is maximized but is smaller than the
 *                        screen: un-maximize, then maximize
 *   "restore"          - Reminth minimized itself for the game: bring it back, normal size
 *   "restore-maximize" - the same, back maximized
 */
function afterGame(before, now) {
  if (!before || !now) return "none";
  // Never touch the window while a game runs - it would take focus from the game.
  if (now.anyGameRunning) return "wait";
  if (before.repaired) return "none"; // once per game end - it can't loop
  if (now.isMinimized) {
    if (!before.minimizedByUs) return "wait"; // the player's own choice: fix it when they bring it back
    return before.wasMaximized ? "restore-maximize" : "restore";
  }
  if (!before.wasMaximized) return "none";
  if (!now.isMaximized) return "maximize";
  if (now.boundsFillWorkArea === false) return "repair";
  return "none";
}

module.exports = { afterGame, fillsWorkArea };
