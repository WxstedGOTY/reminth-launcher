"use strict";
/**
 * A starting options.txt for a brand-new instance whose player picked the
 * "Max FPS" or "Far view" performance profile.
 *
 * The player's own settings are theirs. This module only ever CREATES the
 * file, and only when everything below says the instance has never been
 * played:
 *  - the profile is max-fps or far-view (balanced never writes anything);
 *  - options.txt doesn't exist (and the write itself refuses to replace one);
 *  - there are no worlds in saves/ and no logs/latest.log;
 *  - Reminth hasn't seeded (or been told not to seed) this folder before
 *    (.reminth/options-seeded.json);
 *  - the client jar's version.json has a numeric world_version. It goes in
 *    as the `version:` key - without it Minecraft treats the file as from an
 *    unknown old version and replaces it with defaults.
 *
 * Only keys whose name and on-disk format are certain for that Minecraft
 * version are written. Anything older than 1.16 gets nothing at all.
 * Clouds, mipmaps, the graphics mode and the Vulkan backend are left out on
 * purpose: their keys or formats changed between versions. The one
 * exception is `graphicsPreset:"custom"` from 1.21.11 on - without it the
 * game's "fancy" preset overwrites our values (see DATA_FIRST_PRESET).
 *
 * Tested against the real game on Windows (2026-10-03): 1.16.5, 1.20.1,
 * 1.21.1 started with the file and left it as written (these versions don't
 * rewrite it on exit, so "the game used the values" is not proven by a
 * rewrite there); 26.3 rewrote the whole file and kept every value, with the
 * preset line, and reset nothing else.
 */
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const atomic = require("./atomic");

const OPTIONS_FILE = "options.txt";
const SEEDED_FILE = path.join(".reminth", "options-seeded.json");

// Minecraft data versions (version.json world_version) where a key first
// exists. 1.16 is the oldest version this module writes for at all.
const DATA_1_16 = 2566;
const DATA_1_18 = 2860; // simulationDistance
const DATA_1_18_2 = 2975; // prioritizeChunkUpdates ("Chunk Builder")
// Graphics presets. Measured with the real game on 2026-10-03: 1.21.10 (data
// 4556) still writes `graphicsMode`; 1.21.11 (4671) and 26.x write
// `graphicsPreset:"fancy"`. From the preset versions on, the preset OWNS
// render distance, simulation distance, particles, entity shadows, biome
// blend, entity distance and chunk builder: a file without a preset gets
// "fancy" and every one of our values is overwritten at start (26.3 kept only
// maxFps and vsync). `graphicsPreset:"custom"` keeps them - also measured.
const DATA_LAST_GRAPHICS_MODE = 4556; // 1.21.10
const DATA_FIRST_PRESET = 4671; // 1.21.11

/**
 * Pure: the render distance for "Far view" from what Node can see of this
 * PC (Reminth doesn't know the graphics card). A "16 GB" PC reports a bit
 * less than 16384 MB because of reserved memory, hence the lower bounds.
 */
function farViewDistance(totalMemMb, cpuCount) {
  const mem = Number(totalMemMb) || 0;
  const cpus = Number(cpuCount) || 0;
  if (cpus >= 12 && mem >= 30 * 1024) return 24;
  if (cpus >= 8 && mem >= 15 * 1024) return 20;
  return 16;
}

/**
 * Pure: [[key, value]] for one profile and Minecraft data version, or null
 * when nothing should be written. `version` always comes first.
 */
function buildOptions(perfProfile, { worldVersion, totalMemMb, cpuCount } = {}) {
  if (perfProfile !== "max-fps" && perfProfile !== "far-view") return null;
  if (!Number.isInteger(worldVersion) || worldVersion < DATA_1_16) return null;
  // Snapshots between 1.21.10 and 1.21.11: not measured, so nothing is written.
  if (worldVersion > DATA_LAST_GRAPHICS_MODE && worldVersion < DATA_FIRST_PRESET) return null;
  const lines = [["version", String(worldVersion)]];
  if (worldVersion >= DATA_FIRST_PRESET) lines.push(["graphicsPreset", '"custom"']);
  if (perfProfile === "max-fps") {
    lines.push(["renderDistance", "10"]);
    if (worldVersion >= DATA_1_18) lines.push(["simulationDistance", "8"]);
    lines.push(
      ["particles", "1"],
      ["entityShadows", "false"],
      ["biomeBlendRadius", "1"],
      ["entityDistanceScaling", "0.75"],
      ["enableVsync", "false"],
      // 260 is the top of the slider: "Unlimited".
      ["maxFps", "260"]
    );
  } else {
    lines.push(["renderDistance", String(farViewDistance(totalMemMb, cpuCount))]);
    if (worldVersion >= DATA_1_18) lines.push(["simulationDistance", "8"]);
    lines.push(["biomeBlendRadius", "2"], ["entityDistanceScaling", "1.0"]);
    if (worldVersion >= DATA_1_18_2) lines.push(["prioritizeChunkUpdates", "0"]);
  }
  return lines;
}

/** The client jar's data version, or null when it can't be read. */
async function readWorldVersion(clientJar) {
  try {
    const { "version.json": raw } = await require("./zipread").readEntries(clientJar, ["version.json"]);
    if (!raw) return null;
    const value = JSON.parse(raw.toString("utf8").replace(/^\uFEFF/, "")).world_version;
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

async function exists(file) {
  try {
    await fsp.lstat(file);
    return true;
  } catch (err) {
    // Anything but "not there" (locked, no access) counts as there: when in
    // doubt, don't write.
    return !(err && err.code === "ENOENT");
  }
}

/** Is there anything in saves/ that could be a world? Unreadable counts as yes. */
async function hasWorlds(gameDir) {
  try {
    const entries = await fsp.readdir(path.join(gameDir, "saves"), { withFileTypes: true });
    return entries.some((e) => e.isDirectory());
  } catch (err) {
    return !(err && err.code === "ENOENT");
  }
}

/**
 * Creates `file` with `text` without ever replacing an existing file: the
 * text goes to a temp file first, then is hard-linked into place (fails if
 * the name is taken, so a file the game wrote meanwhile wins). Where hard
 * links aren't possible, an exclusive create does the same job.
 */
async function createNew(file, text) {
  const tmp = atomic.tmpName(file);
  try {
    await fsp.writeFile(tmp, text, "utf8");
    try {
      await fsp.link(tmp, file);
    } catch (err) {
      if (err && err.code === "EEXIST") throw err;
      await fsp.writeFile(file, text, { encoding: "utf8", flag: "wx" });
    }
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => {});
  }
}

/**
 * Writes the starting options.txt when every rule at the top of this file
 * holds. Returns { written, reason }. Never throws.
 */
async function seedIfAbsent({ gameDir, perfProfile, clientJar, totalMemMb, cpuCount } = {}) {
  try {
    if (perfProfile !== "max-fps" && perfProfile !== "far-view") return { written: false, reason: "profile" };
    if (typeof gameDir !== "string" || !gameDir) return { written: false, reason: "no-folder" };
    const target = path.join(gameDir, OPTIONS_FILE);
    if (await exists(target)) return { written: false, reason: "options-exist" };
    if (await exists(path.join(gameDir, SEEDED_FILE))) return { written: false, reason: "already-seeded" };
    if (await hasWorlds(gameDir)) return { written: false, reason: "has-worlds" };
    if (await exists(path.join(gameDir, "logs", "latest.log"))) return { written: false, reason: "played" };
    const worldVersion = typeof clientJar === "string" && clientJar ? await readWorldVersion(clientJar) : null;
    if (!worldVersion) return { written: false, reason: "no-data-version" };
    const lines = buildOptions(perfProfile, { worldVersion, totalMemMb, cpuCount });
    if (!lines) return { written: false, reason: "version-too-old" };
    try {
      await createNew(target, lines.map(([k, v]) => `${k}:${v}`).join("\n") + "\n");
    } catch (err) {
      return { written: false, reason: err && err.code === "EEXIST" ? "options-exist" : "write-failed" };
    }
    try {
      await atomic.writeJsonAtomic(
        path.join(gameDir, SEEDED_FILE),
        { written: true, profile: perfProfile, worldVersion, keys: lines.slice(1).map(([k]) => k), at: new Date().toISOString() },
        { space: 2 }
      );
    } catch {
      // options.txt exists now, which already stops a second write
    }
    return { written: true, reason: "written" };
  } catch {
    return { written: false, reason: "error" };
  }
}

/**
 * Tells seedIfAbsent never to write in this folder: modpack instances (the
 * pack's own files own the settings) and copies of another instance (its
 * settings were carried over, or deliberately weren't). Never throws.
 */
async function markNoSeed(gameDir, reason) {
  try {
    if (typeof gameDir !== "string" || !gameDir) return false;
    const file = path.join(gameDir, SEEDED_FILE);
    if (await exists(file)) return true;
    await atomic.writeJsonAtomic(file, { written: false, reason: String(reason || "skipped").slice(0, 40), at: new Date().toISOString() }, { space: 2 });
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * "Boost FPS": the Max FPS settings for an instance that already has   *
 * its own options.txt - only when the player presses the button and    *
 * confirms the list of changes. The old values are saved first and     *
 * "Put my old settings back" restores them.                            *
 * ------------------------------------------------------------------ */

const BOOST_FILE = path.join(".reminth", "options-before-boost.json");
// Measured with the real game (26.2, the owner's 32 mods, 2026-10-03; see
// DECISIONS_AND_TEST_PLAN.md): render distance is by far the biggest cost,
// then shadows, clouds and biome blend. Servers usually send 8-12 chunks anyway.
const BOOST_RENDER_DISTANCE = 12;
const BOOST_SIMULATION_DISTANCE = 8;

/** Pure: options.txt text -> Map of key -> raw value (the text after the first ":"). */
function parseOptions(text) {
  const map = new Map();
  for (const line of String(text || "").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) map.set(line.slice(0, i), line.slice(i + 1));
  }
  return map;
}

const PARTICLES = { 0: "all", 1: "decreased", 2: "minimal" };

/**
 * Pure: what "Boost FPS" would change in this options.txt, for a game whose
 * data version is `worldVersion`: [{ key, label, from, to, fromText, toText }].
 * Only keys already in the file are changed, keeping the format the game
 * wrote them in (a value spelled some other way is skipped, not guessed).
 * The one key that may be added is graphicsPreset (see DATA_FIRST_PRESET).
 * An empty list means there's nothing to boost.
 */
function planBoost(text, { worldVersion } = {}) {
  if (!Number.isInteger(worldVersion) || worldVersion < DATA_1_16) return [];
  if (worldVersion > DATA_LAST_GRAPHICS_MODE && worldVersion < DATA_FIRST_PRESET) return [];
  const opts = parseOptions(text);
  const changes = [];
  const change = (key, label, to, fromText, toText) => {
    if (!opts.has(key) || opts.get(key) === to) return;
    changes.push({ key, label, from: opts.get(key), to, fromText, toText });
  };
  const num = (key) => (opts.has(key) && /^-?\d+(\.\d+)?$/.test(opts.get(key)) ? Number(opts.get(key)) : null);

  const rd = num("renderDistance");
  if (rd !== null && rd > BOOST_RENDER_DISTANCE) {
    change("renderDistance", "Render distance", String(BOOST_RENDER_DISTANCE), `${rd} chunks`, `${BOOST_RENDER_DISTANCE} chunks`);
  }
  const sim = num("simulationDistance");
  if (worldVersion >= DATA_1_18 && sim !== null && sim > BOOST_SIMULATION_DISTANCE) {
    change("simulationDistance", "Simulation distance", String(BOOST_SIMULATION_DISTANCE), `${sim} chunks`, `${BOOST_SIMULATION_DISTANCE} chunks`);
  }
  if (opts.get("entityShadows") === "true") change("entityShadows", "Entity shadows", "false", "on", "off");
  // "true"/"fast" in quotes from 1.19, bare before that: written back the same way.
  const clouds = opts.get("renderClouds");
  if (clouds !== undefined && /^"?(true|fast)"?$/.test(clouds)) {
    change("renderClouds", "Clouds", clouds.startsWith('"') ? '"false"' : "false", "on", "off");
  }
  const blend = num("biomeBlendRadius");
  if (blend !== null && blend > 0) change("biomeBlendRadius", "Biome blend", "0", String(blend), "off");
  if (num("particles") === 0) change("particles", "Particles", "1", PARTICLES[0], PARTICLES[1]);
  if (opts.get("enableVsync") === "true") change("enableVsync", "V-Sync", "false", "on", "off");
  const maxFps = num("maxFps");
  if (maxFps !== null && maxFps < 260) change("maxFps", "Max framerate", "260", String(maxFps), "unlimited");
  // From 1.21.11 a preset owns the values above; "custom" keeps ours (see DATA_FIRST_PRESET).
  if (changes.length && worldVersion >= DATA_FIRST_PRESET && opts.get("graphicsPreset") !== '"custom"') {
    const was = opts.has("graphicsPreset") ? opts.get("graphicsPreset") : null;
    changes.push({ key: "graphicsPreset", label: "Graphics preset", from: was, to: '"custom"', fromText: was === null ? "none" : was.replace(/"/g, ""), toText: "custom" });
  }
  return changes;
}

/** Pure: `text` with each change's key set to `value(change)` (null removes the line); every other line untouched. */
function rewriteOptions(text, changes, value) {
  const eol = /\r\n/.test(String(text)) ? "\r\n" : "\n";
  const lines = String(text || "").split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const byKey = new Map(changes.map((c) => [c.key, c]));
  const done = new Set();
  const out = [];
  for (const line of lines) {
    const i = line.indexOf(":");
    const key = i > 0 ? line.slice(0, i) : null;
    if (key && byKey.has(key)) {
      // A key written twice: the game reads the last one, so the new value
      // goes where the first one was and the repeats go.
      if (!done.has(key)) {
        done.add(key);
        const v = value(byKey.get(key));
        if (v !== null) out.push(`${key}:${v}`);
      }
      continue;
    }
    out.push(line);
  }
  for (const c of changes) {
    if (done.has(c.key)) continue;
    const v = value(c);
    if (v !== null) out.push(`${c.key}:${v}`);
  }
  return out.join(eol) + eol;
}

/** What "Boost FPS" would change for this instance, and whether there's a boost to undo. Never throws. */
async function boostPlan({ gameDir, clientJar } = {}) {
  try {
    const canUndo = await exists(path.join(gameDir, BOOST_FILE));
    const text = await fsp.readFile(path.join(gameDir, OPTIONS_FILE), "utf8").catch(() => null);
    if (text === null) return { changes: [], canUndo, reason: "no-options" };
    const worldVersion = clientJar ? await readWorldVersion(clientJar) : null;
    if (!worldVersion) return { changes: [], canUndo, reason: "not-installed" };
    return { changes: planBoost(text, { worldVersion }), canUndo, reason: null };
  } catch {
    return { changes: [], canUndo: false, reason: "error" };
  }
}

/**
 * Applies the plan. The caller makes sure the game isn't running (it
 * rewrites options.txt when it closes). The old values are saved BEFORE
 * options.txt is touched; a second boost keeps the first saved values, so
 * "put back" always means "as before Reminth changed anything".
 */
async function applyBoost({ gameDir, clientJar } = {}) {
  const file = path.join(gameDir, OPTIONS_FILE);
  const text = await fsp.readFile(file, "utf8");
  const worldVersion = await readWorldVersion(clientJar);
  const changes = planBoost(text, { worldVersion });
  if (!changes.length) return { changed: 0 };
  const saved = path.join(gameDir, BOOST_FILE);
  let before = [];
  try {
    before = JSON.parse(await fsp.readFile(saved, "utf8")).changes || [];
  } catch {
    before = [];
  }
  const keep = new Map(before.filter((c) => c && typeof c.key === "string").map((c) => [c.key, c]));
  for (const c of changes) {
    if (keep.has(c.key)) keep.set(c.key, { ...keep.get(c.key), to: c.to });
    else keep.set(c.key, { key: c.key, from: c.from, to: c.to });
  }
  await atomic.writeJsonAtomic(saved, { at: new Date().toISOString(), changes: [...keep.values()] }, { space: 2 });
  await atomic.writeFileAtomic(file, rewriteOptions(text, changes, (c) => c.to), { encoding: "utf8" });
  return { changed: changes.length };
}

/**
 * Puts back the values from before the boost - only for settings still at
 * the boosted value; anything the player changed since stays theirs.
 */
async function undoBoost({ gameDir } = {}) {
  const saved = path.join(gameDir, BOOST_FILE);
  const record = JSON.parse(await fsp.readFile(saved, "utf8"));
  const file = path.join(gameDir, OPTIONS_FILE);
  const text = await fsp.readFile(file, "utf8");
  const opts = parseOptions(text);
  const back = (Array.isArray(record.changes) ? record.changes : []).filter(
    (c) =>
      c &&
      typeof c.key === "string" &&
      /^[A-Za-z0-9_]+$/.test(c.key) &&
      (c.from === null || (typeof c.from === "string" && !/[\r\n]/.test(c.from))) &&
      opts.get(c.key) === c.to
  );
  if (back.length) await atomic.writeFileAtomic(file, rewriteOptions(text, back, (c) => c.from), { encoding: "utf8" });
  await fsp.rm(saved, { force: true });
  return { restored: back.length };
}

module.exports = {
  seedIfAbsent,
  markNoSeed,
  readWorldVersion,
  boostPlan,
  applyBoost,
  undoBoost,
  // pure, for tests
  buildOptions,
  planBoost,
  rewriteOptions,
  parseOptions,
  BOOST_FILE,
  farViewDistance,
  SEEDED_FILE,
};
