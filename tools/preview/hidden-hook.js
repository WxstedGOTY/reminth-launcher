// Loaded with `electron -r hidden-hook.js .` for previews while the owner's real Reminth and Minecraft are open:
// - its own Chromium profile and its own lock (never talks to the installed Reminth),
// - the window opens off-screen, without focus and without a taskbar button, at PREVIEW_W x PREVIEW_H.
const path = require("path");
const { app, BrowserWindow } = require("electron");

const dir = process.env.PREVIEW_PROFILE;
if (!dir) throw new Error("PREVIEW_PROFILE not set");
app.setPath("appData", path.join(dir, "appdata"));
app.setPath("userData", path.join(dir, "userdata"));
app.requestSingleInstanceLock = () => true;
app.setAsDefaultProtocolClient = () => true;

const W = Number(process.env.PREVIEW_W) || 1440;
const H = Number(process.env.PREVIEW_H) || 900;
const place = (win) => {
  try {
    win.setSkipTaskbar(true);
    win.setMinimumSize(400, 300);
    win.setBounds({ x: -6000, y: 40, width: W, height: H });
  } catch {}
};
BrowserWindow.prototype.show = function () {
  place(this);
  this.showInactive();
};
BrowserWindow.prototype.focus = function () {};
BrowserWindow.prototype.maximize = function () {
  place(this);
};
BrowserWindow.prototype.isMaximized = function () {
  return false;
};

// Resize on request: write "<w> <h>" into <PREVIEW_PROFILE>/size.txt; the window (still off-screen) follows.
const fs = require("fs");
let lastSize = "";
setInterval(() => {
  let txt = "";
  try {
    txt = fs.readFileSync(path.join(dir, "size.txt"), "utf8").trim();
  } catch {
    return;
  }
  if (!txt || txt === lastSize) return;
  lastSize = txt;
  const [w, h] = txt.split(/\s+/).map(Number);
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.setMinimumSize(400, 300);
      win.setBounds({ x: -6000, y: 40, width: w, height: h });
    } catch {}
  }
}, 500);
