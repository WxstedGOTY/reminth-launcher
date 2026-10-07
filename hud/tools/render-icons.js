// Renders tools/icons.js to src/main/resources/assets/reminthhud/textures/gui/panel/<name>.png (128x128) plus a
// contact sheet (build/icons-sheet.png) to look at. Run: node_modules/.bin/electron hud/tools/render-icons.js
"use strict";
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const icons = { ...require("./icons"), ...require("./icons2") };

const OUT = path.join(__dirname, "..", "src", "main", "resources", "assets", "reminthhud", "textures", "gui", "panel");
const SIZE = 128;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ show: false, width: 400, height: 400, webPreferences: { offscreen: true } });
  await win.loadURL("about:blank");
  console.log("loaded");
  const names = Object.keys(icons);
  for (const name of names) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 96 96">${icons[name]}</svg>`;
    const b64 = await win.webContents.executeJavaScript(`new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => { const c = document.createElement('canvas'); c.width = ${SIZE}; c.height = ${SIZE};
        const g = c.getContext('2d'); g.drawImage(img, 0, 0, ${SIZE}, ${SIZE}); res(c.toDataURL('image/png').split(',')[1]); };
      img.onerror = () => rej(new Error('bad svg'));
      img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString("base64"))};
    })`);
    fs.writeFileSync(path.join(OUT, name + ".png"), Buffer.from(b64, "base64"));
    fs.writeFileSync(path.join(OUT, name + ".png.mcmeta"), '{ "texture": { "blur": true } }\n');
  }
  // contact sheet on Minecraft-grey tiles, to check the look
  const sheetNames = process.env.SHEET === "2" ? Object.keys(require("./icons2")) : names;
  const cells = sheetNames.map((n) => `<div style="display:inline-block;width:150px;margin:6px;text-align:center;font:12px Arial;color:#ddd">
    <div style="background:#3a3a3a;border:2px solid #5a5a5a;border-radius:10px;padding:14px"><img width="64" height="64" src="data:image/png;base64,${fs.readFileSync(path.join(OUT, n + ".png")).toString("base64")}"></div>${n}</div>`);
  const sheet = new BrowserWindow({ show: false, width: 1300, height: 1900, webPreferences: { offscreen: true } });
  await sheet.loadURL("data:text/html;base64," + Buffer.from(`<html><body style="margin:0;background:#161616;padding:10px">${cells.join("")}</body></html>`).toString("base64"));
  await new Promise((r) => setTimeout(r, 600));
  const shot = await sheet.webContents.capturePage();
  fs.mkdirSync(path.join(__dirname, "..", "build"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "..", "build", "icons-sheet.png"), shot.toPNG());
  console.log(`rendered ${names.length} icons`);
  app.quit();
});
