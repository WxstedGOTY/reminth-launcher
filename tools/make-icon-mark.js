// Makes the see-through Reminth icon (owner, 8 Oct 2026: "the icon has a background instead of having the icon only and
// the rest of the picture invisible"): assets/icons/source/reminth-mark.svg is the master SVG without its dark rounded
// square, its frame and the big haze behind the cube; from it, PNGs at every Windows icon size and assets/icons/reminth.ico
// (PNG-compressed entries, Windows Vista and newer), site/favicon.svg, site/favicon.png and site/apple-touch-icon.png.
// Run: node_modules/.bin/electron tools/make-icon-mark.js
"use strict";
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MASTER = path.join(ROOT, "assets", "icons", "source", "reminth-icon-master.svg");
const MARK = path.join(ROOT, "assets", "icons", "source", "reminth-mark.svg");
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

function markSvg() {
  let s = fs.readFileSync(MASTER, "utf8");
  const before = s.length;
  s = s.replace(/<rect width="512" height="512" rx="116" fill="url\(#bg\)"\/>\s*/, ""); // the dark tile
  s = s.replace(/<ellipse cx="256\.0" cy="262\.0" rx="250" ry="120"[^>]*filter="url\(#b44\)"\/>\s*/, ""); // the big haze
  s = s.replace(/<rect x="1\.5" y="1\.5" width="509" height="509"[^>]*\/>\s*/, ""); // the tile's frame
  if (s.length === before) throw new Error("the master SVG changed: nothing removed");
  // the cube reaches the edges, so no clipping to the old tile
  s = s.replace('<g clip-path="url(#tc)">', "<g>");
  return s;
}

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
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
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
    const svg = markSvg();
    fs.writeFileSync(MARK, svg);
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
    fs.writeFileSync(path.join(ROOT, "assets", "icons", "reminth.ico"), ico(pngs));
    fs.writeFileSync(path.join(ROOT, "assets", "icons", "source", "reminth-mark-1024.png"), await render(1024));
    fs.writeFileSync(path.join(ROOT, "site", "favicon.svg"), svg);
    fs.writeFileSync(path.join(ROOT, "site", "favicon.png"), await render(256));
    fs.writeFileSync(path.join(ROOT, "site", "apple-touch-icon.png"), await render(180));
    fs.writeFileSync(path.join(ROOT, "site", "logo.png"), await render(128));
    console.log("made mark, ico with", ICO_SIZES.join("/"), "and the site icons");
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
  app.quit();
});
