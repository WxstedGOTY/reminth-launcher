"use strict";
/**
 * Minecraft's own pictures for Home's stat icons (owner, 16 Oct 2026: "design the icons exactly how they are in
 * minecraft ... instead of a creeper head put pig"). Read from a client jar Reminth already downloaded for the player
 * (like the name font, main.js font:mcAscii) - never shipped with Reminth. Each is cached in %APPDATA%\Reminth\cache
 * once found. Until any game jar exists, the page draws its own hand-made icons.
 */
const fs = require("fs");
const path = require("path");
const zipread = require("./zipread");

const T = "assets/minecraft/textures/";
/** key -> the file in the jar, newest name first (the pig's file was renamed twice). Only 1.13+ names. */
const TEXTURES = {
  sword: [T + "item/diamond_sword.png"],
  pickaxe: [T + "item/iron_pickaxe.png"],
  skeleton: [T + "entity/skeleton/skeleton.png"],
  pig: [T + "entity/pig/pig_temperate.png", T + "entity/pig/temperate_pig.png", T + "entity/pig/pig.png"],
  grassTop: [T + "block/grass_block_top.png"],
  grassSide: [T + "block/grass_block_side.png"],
};
const KEYS = Object.keys(TEXTURES);

/** Pure: a small, real PNG of a sensible size (16x16 items/blocks, 64x32 or 64x64 mob skins)? */
function plausiblePng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 60 || buf.length > 256 * 1024) return false;
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.toString("latin1", 12, 16) !== "IHDR") return false;
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  return w >= 16 && h >= 16 && w <= 256 && h <= 256;
}

/** Client jars in `versionsDir`, the most recently downloaded first. */
async function clientJars(versionsDir) {
  const jars = [];
  let names = [];
  try {
    names = await fs.promises.readdir(versionsDir);
  } catch {
    return [];
  }
  for (const v of names) {
    const jar = path.join(versionsDir, v, v + ".jar");
    try {
      jars.push({ jar, at: (await fs.promises.stat(jar)).mtimeMs });
    } catch {
      // no client jar in this folder
    }
  }
  return jars.sort((a, b) => b.at - a.at).map((j) => j.jar);
}

/**
 * { sword, pickaxe, skeleton, pig, grassTop, grassSide } as data URLs, or null when no downloaded jar has all of them.
 * All six come from the same jar, so they match each other.
 */
async function load({ versionsDir, cacheDir, read = zipread.readEntries } = {}) {
  const cacheFile = (k) => path.join(cacheDir, `mc-tex-${k}.png`);
  const toUrls = (bufs) => Object.fromEntries(KEYS.map((k) => [k, "data:image/png;base64," + bufs[k].toString("base64")]));
  try {
    const cached = {};
    for (const k of KEYS) cached[k] = await fs.promises.readFile(cacheFile(k));
    if (KEYS.every((k) => plausiblePng(cached[k]))) return toUrls(cached);
  } catch {
    // not cached yet
  }
  const all = KEYS.flatMap((k) => TEXTURES[k]);
  for (const jar of (await clientJars(versionsDir)).slice(0, 8)) {
    try {
      const got = await read(jar, all);
      const bufs = {};
      for (const k of KEYS) bufs[k] = TEXTURES[k].map((n) => got[n]).find(plausiblePng) || null;
      if (!KEYS.every((k) => bufs[k])) continue; // too old (before 1.13) or not a full game jar
      await fs.promises.mkdir(cacheDir, { recursive: true }).catch(() => {});
      for (const k of KEYS) await fs.promises.writeFile(cacheFile(k), bufs[k]).catch(() => {});
      return toUrls(bufs);
    } catch {
      // an unreadable jar: try the next one
    }
  }
  return null;
}

module.exports = { load, plausiblePng, clientJars, TEXTURES };
