// electron shot-html.js <file.html> <out.png> <w> <h> : renders a local page off-screen and saves a picture.
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const [html, out, w, h] = process.argv.slice(-4);
app.setPath("userData", path.join(path.dirname(out), "shot-profile"));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: Number(w), height: Number(h), webPreferences: { offscreen: true } });
  await win.loadFile(html);
  await new Promise((r) => setTimeout(r, 1200));
  fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG());
  app.quit();
});
