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
 * Graphics preset/mode, clouds, mipmaps and the Vulkan backend are left out
 * on purpose: their keys or formats changed between versions.
 *
 * NOT tested against the real game here: whether every version family
 * (1.16, 1.20, 1.21, 26.x) keeps these values and resets nothing else must
 * be checked by starting the game once per family.
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
  const lines = [["version", String(worldVersion)]];
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

module.exports = {
  seedIfAbsent,
  markNoSeed,
  readWorldVersion,
  // pure, for tests
  buildOptions,
  farViewDistance,
  SEEDED_FILE,
};
