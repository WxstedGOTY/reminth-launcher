"use strict";
/**
 * After a game crashed: which mod did it?
 *
 * Minecraft writes crash-reports/crash-<time>-client.txt when it crashes.
 * Its top part is all that's needed here:
 *
 *   ---- Minecraft Crash Report ----
 *   ...
 *   Description: Rendering overlay
 *
 *   java.lang.NoSuchFieldError: Class ...RenderPipelines does not have member field '... GUI_TEXTURED'
 *   	at knot//squeek.appleskin.client.HUDOverlayHandler.drawExhaustionOverlay(HUDOverlayHandler.java:96)
 *   	at knot//...
 *
 *   A detailed walkthrough of the error, its code path and all known details is as follows:
 *
 * The first stack frames are matched against the instance's mods: a frame
 * whose class is in a package one mod's own code uses (content.js reads
 * those from fabric.mod.json's entrypoints and mixin configs), a Forge/
 * NeoForge frame that names its mod ("TRANSFORMER/appleskin@3.0.10/..."),
 * a Mixin-merged method that carries its mod id, or a Mixin error that says
 * "from mod <id>". Never a guess: two mods matching equally, a frame of
 * Fabric API or of one of Reminth's own jars on top, or no match at all
 * means nobody is named.
 *
 * Only the instance's own crash-reports folder is read, only the newest
 * report written since the launch, never through a link, at most 512 KB.
 * Nothing in the report is ever used as a path.
 */
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const MAX_REPORT_BYTES = 512 * 1024;
const MAX_FRAMES = 60;
const MAX_HEAD_LINES = 400;
const FINDING_FILE = path.join(".reminth", "crash-finding.json");

// Mods a crash is never pinned on: the loader's own and Fabric API (its event
// code sits in almost every stack, between the game and the mod that broke).
const NEVER_BLAMED = /^(minecraft|java|fabricloader|fabric-loader|quilt_loader|quilt_base|mixinextras|forge|neoforge|fabric|fabric-api|fabric-[a-z0-9-]+-v\d+|fabric-api-base|qsl|quilted_fabric_api)$/i;

/** Pure: one "at ..." line -> { cls, method, modHint, mixinMod } or null. */
function parseFrame(line) {
  const m = /^\s*at\s+(.+?)\s*$/.exec(line);
  if (!m) return null;
  let raw = m[1];
  let modHint = null;
  // Forge / NeoForge: "TRANSFORMER/appleskin@3.0.10/squeek.appleskin..."
  const forge = /^[A-Za-z_]+\/([a-z0-9_.-]{1,64})@[^/\s]*\//.exec(raw);
  if (forge) {
    modHint = forge[1];
    raw = raw.slice(forge[0].length);
  }
  // Fabric's class loader ("knot//"), the app loader ("app//"), a JDK module ("java.base/").
  raw = raw.replace(/^[\w.$-]+\/\//, "");
  const paren = raw.indexOf("(");
  const head = paren >= 0 ? raw.slice(0, paren) : raw;
  const slash = head.lastIndexOf("/");
  const qualified = slash >= 0 ? head.slice(slash + 1) : head;
  const dot = qualified.lastIndexOf(".");
  if (dot <= 0) return null;
  const cls = qualified.slice(0, dot);
  const method = qualified.slice(dot + 1);
  if (!/^[\w$.]+$/.test(cls)) return null;
  // A Mixin handler merged into a game class: "handler$zbm000$appleskin$onRenderHud".
  const mixin = /^(?:handler|redirect|modify\w*|wrap\w*|localvar|constant)\$[0-9a-z]+\$([a-z0-9_]{2,64})\$/.exec(method);
  return { cls, method, modHint, mixinMod: mixin ? mixin[1] : null };
}

/**
 * Pure: the parts of a crash report that say what crashed. Returns
 * { description, error, frames: [parseFrame...], mixinMods: [ids] }, or
 * null when this isn't a Minecraft crash report. A cut-off report gives
 * whatever is there (maybe no frames at all).
 */
function parseCrashReport(text) {
  const t = String(text || "").slice(0, MAX_REPORT_BYTES);
  if (!/---- Minecraft Crash Report ----/.test(t)) return null;
  const lines = t.split(/\r?\n/);
  const descAt = lines.findIndex((l) => /^Description: /.test(l));
  const description = descAt >= 0 ? lines[descAt].slice("Description: ".length).trim().slice(0, 200) : null;
  // The stack trace right after the description, up to the long details.
  const start = descAt >= 0 ? descAt + 1 : 0;
  let error = null;
  const frames = [];
  const mixinMods = new Set();
  for (let i = start; i < lines.length && i < start + MAX_HEAD_LINES; i++) {
    const line = lines[i];
    if (/^A detailed walkthrough of the error/.test(line) || /^-- Head --/.test(line)) break;
    if (!line.trim()) continue;
    for (const re of [/\bfrom mod ([a-z0-9_.-]{2,64})\b/g, /\bMixin apply for mod ([a-z0-9_.-]{2,64}) failed\b/g]) {
      for (const hit of line.matchAll(re)) mixinMods.add(hit[1]);
    }
    const frame = parseFrame(line);
    if (frame) {
      if (frames.length < MAX_FRAMES) frames.push(frame);
      continue;
    }
    if (!error && !/^\s/.test(line)) error = line.trim().slice(0, 300);
  }
  return { description, error, frames, mixinMods: [...mixinMods] };
}

/**
 * Pure: which ONE of the instance's mods the report is about, or null.
 * items: content.listAll mod items; skipFiles: Reminth's own jar names (lower case).
 * Returns { item, how: "mixin" | "frame" | "forge" }.
 */
function findCulprit(parsed, items, { skipFiles = new Set() } = {}) {
  if (!parsed) return null;
  const live = (items || []).filter((i) => i && i.valid && !i.folder && i.enabled);
  const blamed = (item) => !NEVER_BLAMED.test(String(item.modId || "")) && !skipFiles.has(String(item.file).toLowerCase());
  const byId = (id) => {
    const hits = live.filter((i) => String(i.modId || "").toLowerCase() === String(id).toLowerCase());
    return hits.length === 1 ? hits[0] : null;
  };
  // A Mixin error that names exactly one mod.
  if (parsed.mixinMods.length === 1) {
    const item = byId(parsed.mixinMods[0]);
    if (item && blamed(item)) return { item, how: "mixin" };
  }
  // The first frame that belongs to a mod decides - or nobody, if that one
  // can't be told apart or is a mod a crash is never pinned on.
  for (const f of parsed.frames.slice(0, 40)) {
    const id = f.modHint || f.mixinMod;
    if (id) {
      if (NEVER_BLAMED.test(id)) continue; // the loader's own frames
      const item = byId(id);
      if (!item) continue; // not a jar in mods/ (a loader module, a library)
      return blamed(item) ? { item, how: f.modHint ? "forge" : "mixin" } : null;
    }
    let best = 0;
    let hits = [];
    for (const item of live) {
      for (const pkg of Array.isArray(item.packages) ? item.packages : []) {
        if (f.cls !== pkg && !f.cls.startsWith(pkg + ".")) continue;
        if (pkg.length > best) {
          best = pkg.length;
          hits = [item];
        } else if (pkg.length === best && !hits.includes(item)) hits.push(item);
      }
    }
    if (!hits.length) continue;
    if (hits.length > 1) return null; // two mods share that package: unsure
    return blamed(hits[0]) ? { item: hits[0], how: "frame" } : null;
  }
  return null;
}

/**
 * The newest crash report the game wrote since `startedAt` in this
 * instance's own crash-reports folder: { name, text } (the first 512 KB),
 * or null. Links and anything that resolves outside the folder are skipped.
 */
async function latestReport(gameDir, startedAt) {
  try {
    const dir = path.join(gameDir, "crash-reports");
    const real = await fsp.realpath(dir);
    let best = null;
    for (const name of await fsp.readdir(real)) {
      if (!/^crash-[\w.-]{1,120}\.txt$/.test(name)) continue;
      const full = path.join(real, name);
      let st;
      try {
        st = await fsp.lstat(full);
      } catch {
        continue;
      }
      if (!st.isFile() || st.mtimeMs < (startedAt || 0) - 2000) continue;
      if (!best || st.mtimeMs > best.mtimeMs) best = { name, full, mtimeMs: st.mtimeMs, size: st.size };
    }
    if (!best) return null;
    const resolved = await fsp.realpath(best.full);
    if (path.dirname(resolved) !== real) return null;
    const fh = await fsp.open(resolved, "r");
    try {
      const len = Math.min(best.size, MAX_REPORT_BYTES);
      const buf = Buffer.alloc(len);
      const { bytesRead } = await fh.read(buf, 0, len, 0);
      return { name: best.name, text: buf.toString("utf8", 0, bytesRead) };
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

/** The last crash finding for an instance, or null. Never throws. */
async function readFinding(gameDir) {
  try {
    const parsed = JSON.parse(await fsp.readFile(path.join(gameDir, FINDING_FILE), "utf8"));
    return parsed && parsed.mod && typeof parsed.mod.file === "string" ? parsed : null;
  } catch {
    return null;
  }
}

module.exports = { parseCrashReport, parseFrame, findCulprit, latestReport, readFinding, FINDING_FILE, MAX_REPORT_BYTES };
