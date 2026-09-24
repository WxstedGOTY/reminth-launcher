"use strict";
/**
 * Instances: a Minecraft version + a loader (vanilla, Fabric, Quilt, Forge
 * or NeoForge) + its
 * own game folder (mods, packs, worlds, servers, logs, screenshots).
 *
 * The registry is one small JSON file (paths.INSTANCES_FILE). The original
 * "Reminth" instance always exists, can't be deleted, and keeps living at
 * paths.GAME_DIR so nobody's existing worlds or mods move. Every other
 * instance gets paths.INSTANCES_DIR/<id>/ as its game directory.
 *
 * Shared between all instances (so switching versions doesn't re-download
 * the same files twice): versions/, libraries/, assets/ under
 * paths.INSTANCE_DIR, and the Java runtimes.
 *
 * Worlds are deliberately NOT shared. Opening a world in an older version
 * than it was last saved in can corrupt it - one shared saves folder across
 * a 26.2 instance and a 1.8.9 instance is a way to lose a world, not a
 * feature.
 */
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");

const paths = require("./paths");
const config = require("./config");

const DEFAULT_ID = "reminth";
const LOADERS = ["vanilla", "fabric", "quilt", "forge", "neoforge"];
const COLOURS = ["cyan", "violet", "emerald", "amber", "rose", "sky"];

function defaultInstance() {
  return {
    id: DEFAULT_ID,
    name: "Reminth",
    mcVersion: config.MINECRAFT_VERSION,
    loader: "fabric",
    loaderVersion: config.FABRIC_LOADER_VERSION,
    // "managed": Reminth keeps ReminthHUD + Fabric API installed in this one
    // (and only this one) - see minecraft.js.
    managed: true,
    hud: true,
    color: "cyan",
    createdAt: 0,
    lastPlayed: null,
    playTimeMs: 0,
    modpack: null,
  };
}

/** Pure: a version id as Mojang writes them ("26.2", "1.8.9", "b1.7.3", "26.4-snapshot-1", "rd-132211"). */
function isValidVersionId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._+\- ]{0,63}$/.test(value);
}

/** Pure: only ever lets a known, well-formed set of fields through. */
function sanitizeInstance(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" && /^[a-z0-9-]{1,64}$/.test(raw.id) ? raw.id : null;
  if (!id) return null;
  if (!isValidVersionId(raw.mcVersion)) return null;
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 48) : "Instance";
  const loader = LOADERS.includes(raw.loader) ? raw.loader : "vanilla";
  const loaderVersion =
    loader !== "vanilla" && typeof raw.loaderVersion === "string" && /^[\w.+-]{1,64}$/.test(raw.loaderVersion)
      ? raw.loaderVersion
      : null;
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0);
  let modpack = null;
  if (raw.modpack && typeof raw.modpack === "object") {
    const str = (v, max = 120) => (typeof v === "string" ? v.slice(0, max) : null);
    modpack = {
      projectId: str(raw.modpack.projectId, 16),
      versionId: str(raw.modpack.versionId, 16),
      title: str(raw.modpack.title),
      versionNumber: str(raw.modpack.versionNumber, 64),
      iconUrl: str(raw.modpack.iconUrl, 400),
    };
  }
  return {
    id,
    name,
    mcVersion: raw.mcVersion,
    loader,
    loaderVersion,
    managed: id === DEFAULT_ID,
    // ReminthHUD: on by default for the original instance, opt-in for the
    // rest. Only ever installed where a HUD build for that version exists.
    hud: typeof raw.hud === "boolean" ? raw.hud : id === DEFAULT_ID,
    color: COLOURS.includes(raw.color) ? raw.color : "cyan",
    createdAt: num(raw.createdAt),
    lastPlayed: raw.lastPlayed ? num(raw.lastPlayed) : null,
    playTimeMs: num(raw.playTimeMs),
    modpack,
  };
}

let cache = null;

async function readAll() {
  if (cache) return cache;
  let list = [];
  try {
    const parsed = JSON.parse(await fsp.readFile(paths.INSTANCES_FILE, "utf8"));
    if (Array.isArray(parsed)) list = parsed.map(sanitizeInstance).filter(Boolean);
  } catch {
    // no file yet (first run of this version) - just the default instance
  }
  // The original instance always exists and always comes first. Its version
  // is allowed to be changed by the player like any other instance's.
  const existingDefault = list.find((i) => i.id === DEFAULT_ID);
  list = list.filter((i) => i.id !== DEFAULT_ID);
  list.unshift(existingDefault ? { ...existingDefault, managed: true } : defaultInstance());
  // de-duplicate ids, first one wins
  const seen = new Set();
  cache = list.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
  return cache;
}

async function writeAll(list) {
  cache = list;
  await fsp.mkdir(paths.ROOT, { recursive: true });
  const tmp = `${paths.INSTANCES_FILE}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(list, null, 2), "utf8");
  await fsp.rename(tmp, paths.INSTANCES_FILE);
}

async function list() {
  return (await readAll()).map((i) => ({ ...i, gameDir: gameDirFor(i) }));
}

async function get(id) {
  const found = (await readAll()).find((i) => i.id === id);
  return found ? { ...found, gameDir: gameDirFor(found) } : null;
}

/** Throws rather than guessing: every caller acts on real files. */
async function require_(id) {
  const inst = await get(id);
  if (!inst) throw new Error("That instance doesn't exist any more.");
  return inst;
}

function gameDirFor(inst) {
  if (inst.id === DEFAULT_ID) return paths.GAME_DIR;
  // ids are validated to [a-z0-9-], so this can't climb out of INSTANCES_DIR
  return path.join(paths.INSTANCES_DIR, inst.id);
}

function slugify(name) {
  const base = String(name || "instance")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return base || "instance";
}

async function create({ name, mcVersion, loader, loaderVersion, color, modpack, hud }) {
  if (!isValidVersionId(mcVersion)) throw new Error("Pick a Minecraft version first.");
  const all = await readAll();
  let id;
  do {
    id = `${slugify(name)}-${crypto.randomBytes(2).toString("hex")}`;
  } while (all.some((i) => i.id === id));
  const inst = sanitizeInstance({
    id,
    name: name || `Minecraft ${mcVersion}`,
    mcVersion,
    loader,
    loaderVersion,
    color: color || COLOURS[all.length % COLOURS.length],
    hud: hud === true,
    createdAt: Date.now(),
    modpack,
  });
  if (!inst) throw new Error("Couldn't create that instance - check the name and version.");
  await writeAll([...all, inst]);
  await fsp.mkdir(gameDirFor(inst), { recursive: true });
  return { ...inst, gameDir: gameDirFor(inst) };
}

async function update(id, patch) {
  const all = await readAll();
  const idx = all.findIndex((i) => i.id === id);
  if (idx < 0) throw new Error("That instance doesn't exist any more.");
  const current = all[idx];
  const allowed = {};
  for (const key of ["name", "mcVersion", "loader", "loaderVersion", "color", "lastPlayed", "playTimeMs", "modpack", "hud"]) {
    if (key in (patch || {})) allowed[key] = patch[key];
  }
  // Changing version or loader invalidates a pinned loader version.
  if (("mcVersion" in allowed && allowed.mcVersion !== current.mcVersion) || ("loader" in allowed && allowed.loader !== current.loader)) {
    if (!("loaderVersion" in allowed)) allowed.loaderVersion = null;
  }
  const next = sanitizeInstance({ ...current, ...allowed });
  if (!next) throw new Error("That change isn't valid.");
  const copy = [...all];
  copy[idx] = next;
  await writeAll(copy);
  return { ...next, gameDir: gameDirFor(next) };
}

async function remove(id) {
  if (id === DEFAULT_ID) throw new Error("The main Reminth instance can't be deleted.");
  const all = await readAll();
  const inst = all.find((i) => i.id === id);
  if (!inst) return { ok: true };
  await writeAll(all.filter((i) => i.id !== id));
  // Instance folders only ever live inside INSTANCES_DIR - double-check
  // before a recursive delete, however the id got here.
  const dir = path.resolve(gameDirFor(inst));
  if (dir.startsWith(path.resolve(paths.INSTANCES_DIR) + path.sep)) {
    await fsp.rm(dir, { recursive: true, force: true });
  }
  return { ok: true };
}

/** Adds a finished session's length to the instance's play time. */
async function recordSession(id, startedAt, endedAt) {
  const inst = (await readAll()).find((i) => i.id === id);
  if (!inst) return;
  const ms = Math.max(0, endedAt - startedAt);
  await update(id, { lastPlayed: endedAt, playTimeMs: (inst.playTimeMs || 0) + ms });
}

module.exports = {
  DEFAULT_ID,
  LOADERS,
  list,
  get,
  require: require_,
  create,
  update,
  remove,
  recordSession,
  gameDirFor,
  // pure, for tests
  sanitizeInstance,
  isValidVersionId,
  slugify,
};
