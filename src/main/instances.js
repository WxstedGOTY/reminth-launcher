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
const atomic = require("./atomic");

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
  const id = typeof raw.id === "string" && ID_PATTERN.test(raw.id) ? raw.id : null;
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
  const out = {
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
  // Reminth's performance pack (Sodium and friends): `false` means the
  // player switched it off for this instance. Absent (every instance made
  // before the switch existed) or true means on, so the key is only kept
  // when it was actually set.
  if (typeof raw.performanceMods === "boolean") out.performanceMods = raw.performanceMods;
  return out;
}

let cache = null;
let loading = null; // the in-flight first read, so two early callers share one load (and one recovery)

// Every change to the registry is read-change-write on one file; they take
// turns through this lock so two overlapping changes can't lose one.
const REGISTRY_LOCK = "instances:registry";
const mutate = (fn) => atomic.withLock(REGISTRY_LOCK, fn);

// A copy of each instance's own registry entry, kept inside its folder, so
// the registry can be rebuilt exactly if instances.json is ever lost.
const META_FILE = path.join(".reminth", "instance.json");
const ID_PATTERN = /^[a-z0-9-]{1,64}$/;

/** The original instance always exists and comes first; ids are unique, first one wins. */
function normalise(list) {
  // Its version is allowed to be changed by the player like any other instance's.
  const existingDefault = list.find((i) => i.id === DEFAULT_ID);
  const rest = list.filter((i) => i.id !== DEFAULT_ID);
  rest.unshift(existingDefault ? { ...existingDefault, managed: true } : defaultInstance());
  const seen = new Set();
  return rest.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
}

/**
 * Pure: JSON text without a leading byte-order mark. Editors on Windows
 * (Notepad, PowerShell's Out-File) add one, JSON.parse refuses it, and a
 * perfectly good file would then be treated as damaged.
 */
function stripBom(text) {
  return String(text).replace(/^\uFEFF/, "");
}

/** Pure: the instances in a registry file's text, or null if it isn't a registry. */
function parseRegistry(text) {
  try {
    const parsed = JSON.parse(stripBom(text));
    return Array.isArray(parsed) ? parsed.map(sanitizeInstance).filter(Boolean) : null;
  } catch {
    return null;
  }
}

/** The registry file's text; null only when it truly doesn't exist. Throws if it can't be read. */
async function readRegistryText() {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fsp.readFile(paths.INSTANCES_FILE, "utf8");
    } catch (err) {
      if (err && err.code === "ENOENT") return null;
      // Locked for a moment (antivirus, indexer)? Wait it out. Giving up
      // must be an error, never "no instances": the caller would go on to
      // write a registry without them.
      if (attempt >= 4 || !["EBUSY", "EPERM", "EACCES"].includes(err && err.code)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)));
    }
  }
}

/** Minecraft version of the most recently played world in an instance folder, if it says. */
async function guessMcVersion(dir) {
  try {
    const nbt = require("./nbt");
    const saves = path.join(dir, "saves");
    const worlds = [];
    for (const name of (await fsp.readdir(saves)).slice(0, 50)) {
      try {
        const file = path.join(saves, name, "level.dat");
        worlds.push({ file, mtimeMs: (await fsp.stat(file)).mtimeMs });
      } catch {
        // not a world folder
      }
    }
    worlds.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const world of worlds.slice(0, 5)) {
      try {
        const data = nbt.parse(await fsp.readFile(world.file)).Data || {};
        const name = data.Version && data.Version.Name;
        if (isValidVersionId(name)) return name;
      } catch {
        // unreadable level.dat - try the next world
      }
    }
  } catch {
    // no saves folder
  }
  return null;
}

/** Which loader the mods in an instance folder were built for (most common wins), else vanilla. */
async function guessLoader(dir) {
  const votes = { fabric: 0, quilt: 0, forge: 0, neoforge: 0 };
  try {
    const zipread = require("./zipread");
    const jars = (await fsp.readdir(path.join(dir, "mods"))).filter((n) => /\.jar(\.disabled)?$/i.test(n)).slice(0, 12);
    for (const jar of jars) {
      try {
        const zip = await zipread.openZip(path.join(dir, "mods", jar));
        try {
          if (zip.has("fabric.mod.json")) votes.fabric++;
          else if (zip.has("quilt.mod.json")) votes.quilt++;
          else if (zip.has("META-INF/neoforge.mods.toml")) votes.neoforge++;
          else if (zip.has("META-INF/mods.toml")) votes.forge++;
        } finally {
          await zip.close();
        }
      } catch {
        // not a readable jar
      }
    }
  } catch {
    // no mods folder
  }
  const [best, count] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  return count > 0 ? best : "vanilla";
}

// What a folder must hold (at least one of) to be taken for an instance
// that lost its registry entry. Without this, ANY folder under instances/
// was adopted - a "backups" folder the player made there became an instance,
// and deleting that instance in the launcher deleted the folder.
const GAME_LAYOUT = ["saves", "mods", "options.txt", "resourcepacks", "logs"];

/**
 * Registry entries for the folders actually present in INSTANCES_DIR -
 * used only when instances.json is missing or unreadable, so that worlds
 * and mods the player still has on disk don't silently drop out of the
 * launcher. A folder with its own instance.json comes back exactly as it
 * was. One without (made before that file existed) gets a best guess -
 * version from its newest world, loader from its mods - and "(recovered)"
 * in its name so the player knows to check it before playing.
 */
async function scanInstanceFolders() {
  let entries;
  try {
    entries = await fsp.readdir(paths.INSTANCES_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    const id = entry.name;
    // Only folders Reminth could have made itself: its ids are always [a-z0-9-].
    if (!entry.isDirectory() || id === DEFAULT_ID || !ID_PATTERN.test(id)) continue;
    const dir = path.join(paths.INSTANCES_DIR, id);
    let inst = null;
    try {
      inst = sanitizeInstance({ ...JSON.parse(stripBom(await fsp.readFile(path.join(dir, META_FILE), "utf8"))), id });
    } catch {
      inst = null;
    }
    if (!inst) {
      let names = [];
      try {
        names = await fsp.readdir(dir);
      } catch {
        continue;
      }
      // A folder Reminth marked as an instance (even if that note is now
      // damaged), or one that looks like a game folder. Anything else - an
      // empty folder, the player's own "backups" - is not Reminth's to
      // list, or to delete.
      let marked = false;
      try {
        marked = (await fsp.stat(path.join(dir, META_FILE))).isFile();
      } catch {
        marked = false;
      }
      if (!marked && !names.some((n) => GAME_LAYOUT.includes(n.toLowerCase()))) continue;
      let createdAt = 0;
      try {
        const stat = await fsp.stat(dir);
        createdAt = Math.round(stat.birthtimeMs || stat.mtimeMs || 0);
      } catch {
        createdAt = 0;
      }
      const label = id.replace(/-[0-9a-f]{4}$/, "").replace(/-+/g, " ").trim() || "Instance";
      inst = sanitizeInstance({
        id,
        name: `${label.slice(0, 36)} (recovered)`,
        mcVersion: (await guessMcVersion(dir)) || config.MINECRAFT_VERSION,
        loader: await guessLoader(dir),
        createdAt,
      });
    }
    if (inst) found.push(inst);
  }
  return found.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}

/** Best effort: remember an instance's entry inside its own folder (see META_FILE). */
async function writeMeta(inst) {
  // The original instance gets one too: its version and loader can be
  // changed like any other's, and a rebuild would otherwise put it back on
  // the built-in default.
  if (!inst) return;
  try {
    const dir = gameDirFor(inst);
    await fsp.access(dir); // never re-create a folder that's gone
    await atomic.writeJsonAtomic(path.join(dir, META_FILE), inst, { space: 2 });
  } catch {
    // only costs precision if the registry ever has to be rebuilt
  }
}

async function loadRegistry() {
  const text = await readRegistryText();
  const parsed = text === null ? null : parseRegistry(text);
  if (parsed) {
    const list = normalise(parsed);
    // Instances made before instance.json existed get theirs now.
    for (const inst of list) {
      try {
        await fsp.access(path.join(gameDirFor(inst), META_FILE));
      } catch {
        await writeMeta(inst);
      }
    }
    return list;
  }

  // No registry, or one that can't be read as a registry. This used to mean
  // "just the default instance" - and the next change then wrote that over
  // the file, so every other instance vanished from the launcher with its
  // folder left behind. Recover instead: the last good copy first, then
  // whatever folders are on disk that it doesn't mention.
  let recovered = [];
  try {
    recovered = parseRegistry(await fsp.readFile(`${paths.INSTANCES_FILE}.bak`, "utf8")) || [];
  } catch {
    recovered = [];
  }
  const known = new Set(recovered.map((i) => i.id));
  // The original instance lives outside INSTANCES_DIR, so the folder scan
  // never sees it: read its own instance.json for the version it was on.
  if (!known.has(DEFAULT_ID)) {
    try {
      const own = sanitizeInstance({ ...JSON.parse(stripBom(await fsp.readFile(path.join(paths.GAME_DIR, META_FILE), "utf8"))), id: DEFAULT_ID });
      if (own) {
        recovered.push(own);
        known.add(DEFAULT_ID);
      }
    } catch {
      // none yet - normalise() below adds the built-in default
    }
  }
  for (const inst of await scanInstanceFolders()) if (!known.has(inst.id)) recovered.push(inst);
  const list = normalise(recovered);
  // Keep the unreadable file for a look later rather than overwriting it.
  if (text !== null) await atomic.quarantine(paths.INSTANCES_FILE);
  if (text !== null || list.length > 1) {
    try {
      await atomic.writeJsonAtomic(paths.INSTANCES_FILE, list, { space: 2, backup: true });
    } catch {
      // still usable from memory; the next change writes it
    }
  }
  return list;
}

async function readAll() {
  if (cache) return cache;
  if (!loading) {
    loading = loadRegistry()
      .then((list) => (cache = list))
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

async function writeAll(list) {
  await atomic.writeJsonAtomic(paths.INSTANCES_FILE, list, { space: 2, backup: true });
  // Only once it's really on disk: a failed write must not leave the
  // launcher believing in a registry that was never saved.
  cache = list;
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

async function create({ name, mcVersion, loader, loaderVersion, color, modpack, hud, performanceMods }) {
  if (!isValidVersionId(mcVersion)) throw new Error("Pick a Minecraft version first.");
  return mutate(async () => {
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
      // Fabric/Quilt: on unless switched off (nothing stored). Forge/NeoForge:
      // off unless switched on - see config.perfPackEnabled.
      performanceMods: performanceMods === false ? false : performanceMods === true && (loader === "forge" || loader === "neoforge") ? true : undefined,
      createdAt: Date.now(),
      modpack,
    });
    if (!inst) throw new Error("Couldn't create that instance - check the name and version.");
    await writeAll([...all, inst]);
    await fsp.mkdir(gameDirFor(inst), { recursive: true });
    await writeMeta(inst);
    return { ...inst, gameDir: gameDirFor(inst) };
  });
}

async function update(id, patch) {
  return mutate(() => updateLocked(id, patch));
}

/** update() without taking the registry lock - for callers that already hold it. */
async function updateLocked(id, patch) {
  const all = await readAll();
  const idx = all.findIndex((i) => i.id === id);
  if (idx < 0) throw new Error("That instance doesn't exist any more.");
  const current = all[idx];
  const allowed = {};
  for (const key of ["name", "mcVersion", "loader", "loaderVersion", "color", "lastPlayed", "playTimeMs", "modpack", "hud", "performanceMods"]) {
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
  await writeMeta(next);
  return { ...next, gameDir: gameDirFor(next) };
}

async function remove(id) {
  if (id === DEFAULT_ID) throw new Error("The main Reminth instance can't be deleted.");
  return mutate(async () => {
    const all = await readAll();
    const inst = all.find((i) => i.id === id);
    if (!inst) return { ok: true };
    // Instance folders only ever live inside INSTANCES_DIR - double-check
    // before a recursive delete, however the id got here.
    const dir = path.resolve(gameDirFor(inst));
    if (dir.startsWith(path.resolve(paths.INSTANCES_DIR) + path.sep)) {
      // The folder goes first and the registry entry only once it's really
      // gone. The other way round, a folder Windows wouldn't let go of (the
      // game still running, an Explorer window open in it) was left on disk
      // with nothing in the launcher pointing at it any more. The retries
      // ride out the short locks antivirus and the indexer take.
      try {
        await fsp.rm(dir, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
      } catch {
        // Still in the registry, so it stays visible and can be deleted again.
        throw new Error(`Couldn't delete ${inst.name} — close Minecraft and any open folder windows, then try again.`);
      }
    }
    await writeAll(all.filter((i) => i.id !== id));
    return { ok: true };
  });
}

/** Adds a finished session's length to the instance's play time. */
async function recordSession(id, startedAt, endedAt) {
  // Read and add under the lock, so two sessions ending together both count.
  await mutate(async () => {
    const inst = (await readAll()).find((i) => i.id === id);
    if (!inst) return;
    const ms = Math.max(0, endedAt - startedAt);
    await updateLocked(id, { lastPlayed: endedAt, playTimeMs: (inst.playTimeMs || 0) + ms });
  });
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
