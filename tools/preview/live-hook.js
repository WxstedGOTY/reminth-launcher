// The owner's LIVE preview (15 Oct 2026: "how can i see live each time i tell you to change something"). Loaded with
// `electron -r tools/preview/live-hook.js .` by tools/preview/live.cmd (the "Reminth Live Preview" desktop shortcut):
// - a normal, visible window titled "Reminth - LIVE PREVIEW", next to (never instead of) the installed Reminth: its own
//   Chromium profile, no single-instance lock, no reminth:// registration, its own Reminth data (USERPROFILE, set by
//   live.cmd - never the real %APPDATA%\Reminth);
// - a change under src/renderer reloads the window by itself; a change under src/main or assets restarts the preview.
const path = require("path");
const fs = require("fs");
const { app, BrowserWindow } = require("electron");

const dir = process.env.PREVIEW_PROFILE;
if (!dir) throw new Error("PREVIEW_PROFILE not set (start the preview with tools/preview/live.cmd)");
app.setPath("appData", path.join(dir, "appdata"));
app.setPath("userData", path.join(dir, "userdata"));
app.requestSingleInstanceLock = () => true;
app.setAsDefaultProtocolClient = () => true;

const TITLE = "Reminth - LIVE PREVIEW";
app.on("browser-window-created", (_e, win) => {
  win.setTitle(TITLE);
  win.on("page-title-updated", (e) => {
    e.preventDefault();
    win.setTitle(TITLE);
  });
});

// Look-only: when nobody is signed in to the preview, it pretends to be (owner: he opened it, saw only the sign-in card
// and thought nothing had changed). Every page then shows; Play and look-ups that need a real account just fail.
// Signing in for real in the preview still works and replaces this.
const LOOK_ONLY = `(() => {
  if (typeof state === "undefined" || typeof applyAccountUI !== "function") return;
  if (state.signedIn && !(typeof rmGateNeeded === "function" && rmGateNeeded())) return;
  state.rm = state.rm || {};
  state.rm.user = state.rm.user || { name: "Preview", id: "preview", offline: true };
  state.rm.checked = true;
  state.signedIn = true;
  state.username = state.username || "Preview";
  applyAccountUI();
  if (typeof loadRecent === "function") loadRecent();
})();`;
// Applied at once and then every 150ms for 10 seconds, so it's in place long before the loading screen fades (~2s) -
// applied only at 2.5s, the sign-in card flashed for a moment after the loading screen (owner, 16 Oct 2026). Later
// account checks that come back empty are covered by the repeats.
app.on("web-contents-created", (_e, wc) => {
  wc.on("did-finish-load", () => {
    const started = Date.now();
    const tick = () => {
      if (wc.isDestroyed()) return;
      wc.executeJavaScript(LOOK_ONLY).catch(() => {});
      if (Date.now() - started < 10000) setTimeout(tick, 150);
    };
    tick();
  });
});

const ROOT = path.join(__dirname, "..", "..");
let timer = null;
let restart = false;
function changed(kind) {
  if (kind === "main") restart = true;
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (restart) {
      app.relaunch();
      app.exit(0);
      return;
    }
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.webContents.reloadIgnoringCache();
      } catch {
        // a window that is closing
      }
    }
  }, 400);
}
const watch = (sub, kind) => {
  try {
    fs.watch(path.join(ROOT, sub), { recursive: true }, (_ev, file) => {
      if (file && !/\.(js|css|html|svg|png|json|ttf)$/i.test(file)) return;
      changed(kind);
    });
  } catch {
    // folder missing: nothing to watch
  }
};
watch("src/renderer", "renderer");
watch("src/main", "main");
watch("assets/icons", "main");
