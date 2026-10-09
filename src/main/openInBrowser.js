"use strict";
/**
 * Opens a web page in the player's browser AND lets that browser come to the front.
 *
 * Windows only lets the window the player is using hand the front to another program. When the browser is already
 * running (a new tab in an open window), the browser itself asks to come forward - and Windows refuses, so it only
 * blinks on the taskbar and the player waits in Reminth, confused. Right before opening, Reminth (still the window in
 * front, the player just clicked) calls AllowSetForegroundWindow(ASFW_ANY): "the next program may take the front".
 * That is the documented way (user32.dll, through koffi). Anything failing here just opens the page as before.
 */
const { shell } = require("electron");

let allowForeground; // undefined = not tried yet, null = not available
function letNextWindowComeForward() {
  if (process.platform !== "win32") return;
  if (allowForeground === undefined) {
    try {
      const koffi = require("koffi");
      allowForeground = koffi.load("user32.dll").func("bool __stdcall AllowSetForegroundWindow(uint32_t dwProcessId)");
    } catch {
      allowForeground = null;
    }
  }
  if (!allowForeground) return;
  try {
    allowForeground(0xffffffff); // ASFW_ANY
  } catch {
    // never stop the page from opening
  }
}

async function openInBrowser(url) {
  letNextWindowComeForward();
  await shell.openExternal(url);
}

module.exports = { openInBrowser, _test: { letNextWindowComeForward } };
