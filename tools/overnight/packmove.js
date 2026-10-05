"use strict";
// Does Reminth's own pack move cleanly when an instance changes version? (No player-added mods.)
// Usage: node packmove.js loader FROM TO [extraProjectSlug ...]   extra = mods added like Discover does, before the move
const fs = require("fs");
const path = require("path");
const os = require("os");
const Module = require("module");
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { if (r === "electron") return "PM_ELECTRON"; return orig.call(this, r, ...a); };
Module._cache.PM_ELECTRON = { id: "PM_ELECTRON", filename: "PM_ELECTRON", loaded: true, exports: { app: { getPath: () => os.tmpdir(), isPackaged: false, getVersion: () => "1.4.8" }, safeStorage: { isEncryptionAvailable: () => false } } };
const REPO = "C:/Users/kolijos/Downloads/reminth-launcher";
const minecraft = require(path.join(REPO, "src/main/minecraft"));
const content = require(path.join(REPO, "src/main/content"));
const modrinth = require(path.join(REPO, "src/main/modrinth"));
(async () => {
  const [loader, from, to, ...extras] = process.argv.slice(2);
  const gameDir = path.join(__dirname, "packmove-game", String(Date.now()));
  fs.mkdirSync(gameDir, { recursive: true });
  const inst = { id: "zz-pm", name: "PM", mcVersion: from, loader, gameDir, hud: loader === "fabric", lastPlayed: Date.now() };
  const list = () => fs.readdirSync(path.join(gameDir, "mods")).filter((f) => /\.jar/.test(f)).sort();
  await minecraft.ensureInstalled(inst, () => {});
  console.log("on", from, ":", list().join(", "));
  for (const slug of extras) {
    try {
      const p = await modrinth.getProject(slug);
      await content.install(inst, { projectId: p.id, kind: "mod" }, () => {}, {});
    } catch (e) { console.log("extra", slug, "->", String(e.message).slice(0, 100)); }
  }
  if (extras.length) console.log("with extras:", list().join(", "));
  inst.mcVersion = to;
  await minecraft.ensureInstalled(inst, () => {});
  const after = list();
  console.log("on", to, ":", after.join(", "));
  const byBase = {};
  for (const f of after) { const k = f.toLowerCase().split(/[-_+]\d|[-_]mc?\d|[-_]fabric|[-_]neoforge/)[0]; (byBase[k] = byBase[k] || []).push(f); }
  const dups = Object.entries(byBase).filter(([, v]) => v.length > 1);
  console.log(dups.length ? "DUPLICATES: " + JSON.stringify(dups) : "no duplicate mods");
})().catch((e) => console.log("ERR", e.message));
