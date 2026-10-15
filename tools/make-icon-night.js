// Makes the Night icon see-through (owner, 15 Oct 2026: "my app in my task bar has a background, it normally
// shouldn't"): assets/icons/reminth-night.ico is drawn from assets/icons/source/reminth-mark-night.svg - the Moonrise
// cube without its dark tile, stars and hills - at every Windows icon size, PNG-compressed entries (Windows Vista and
// newer). It is the .exe's, the installer's and the window's icon (package.json build, main.js themeIcon).
// Run: node_modules/.bin/electron tools/make-icon-night.js
"use strict";
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MARK = path.join(ROOT, "assets", "icons", "source", "reminth-mark-night.svg");
const OUT = path.join(ROOT, "assets", "icons", "reminth-night.ico");
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

/** An .ico with PNG entries: 6-byte header, a 16-byte entry per picture, then the PNGs. */
function ico(pngs) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([head, ...entries, ...pngs.map((p) => p.data)]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try {
    const svg = fs.readFileSync(MARK, "utf8");
    const win = new BrowserWindow({ show: false, width: 300, height: 300, webPreferences: { offscreen: true } });
    await win.loadURL("about:blank");
    const render = async (size) => {
      const b64 = await win.webContents.executeJavaScript(`new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => { const c = document.createElement('canvas'); c.width = ${size}; c.height = ${size};
          const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, ${size}, ${size});
          res(c.toDataURL('image/png').split(',')[1]); };
        img.onerror = () => rej(new Error('bad svg'));
        img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString("base64"))};
      })`);
      return Buffer.from(b64, "base64");
    };
    const pngs = [];
    for (const size of ICO_SIZES) pngs.push({ size, data: await render(size) });
    fs.writeFileSync(OUT, ico(pngs));
    fs.writeFileSync(path.join(ROOT, "assets", "icons", "source", "reminth-mark-night-256.png"), pngs[pngs.length - 1].data);
    console.log("made", path.relative(ROOT, OUT), "with", ICO_SIZES.join("/"));
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
  app.quit();
});
