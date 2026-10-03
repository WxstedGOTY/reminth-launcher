"use strict";
/**
 * Everything an instance holds besides worlds: mods, resource packs,
 * shader packs and data packs. Lists what's really on disk (and keeps
 * watching it), installs things from Modrinth (with their required
 * dependencies), and finds + applies updates for all four kinds at once.
 *
 * What Reminth installed is remembered in <gameDir>/.reminth/content.json
 * (project id, version, title, icon) so the lists can show real names and
 * icons and so installing the same thing twice replaces instead of piling
 * up copies. Files the player dropped in themselves are listed just the
 * same - Reminth never needs to have installed something to show it.
 */
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");

const modrinth = require("./modrinth");
const zipread = require("./zipread");
const paths = require("./paths");
const atomic = require("./atomic");

const KINDS = {
  mod: { folder: "mods", label: "Mods" },
  resourcepack: { folder: "resourcepacks", label: "Resource packs" },
  shader: { folder: "shaderpacks", label: "Shaders" },
  datapack: { folder: "datapacks", label: "Data packs" }, // per world: saves/<world>/datapacks
};

const MAX_ICON_BYTES = 128 * 1024;
const IRIS_ID = "YL57xq9U"; // Iris Shaders - loads shader packs on Fabric, Quilt and NeoForge
const OCULUS_ID = "GchcoXML"; // Oculus - the Iris port for Forge (and NeoForge 1.20.1)
const LOADER_TITLES = { fabric: "Fabric", quilt: "Quilt", forge: "Forge", neoforge: "NeoForge", vanilla: "vanilla" };

/** Pure: which shader-loading mods can work on this instance, in order of preference. */
function shaderModsFor(instance) {
  if (instance.loader === "fabric" || instance.loader === "quilt") return [IRIS_ID];
  if (instance.loader === "neoforge") return [IRIS_ID, OCULUS_ID];
  if (instance.loader === "forge") return [OCULUS_ID];
  return [];
}
// Modrinth's CDN is where project files live; modpacks may also point at
// the hosts the .mrpack spec allows (see mrpack.js).
const MODRINTH_FILE_HOST = /^cdn\.modrinth\.com$/i;

/* ------------------------------------------------------------------ */
/* small helpers                                                      */
/* ------------------------------------------------------------------ */

function within(base, rel) {
  const b = path.resolve(base);
  const full = path.resolve(b, rel);
  if (full !== b && !full.startsWith(b + path.sep)) throw new Error(`Refused a path outside the instance: ${rel}`);
  return full;
}

// Names Windows treats as devices whatever extension follows ("aux.jar" is
// still the AUX device there).
const RESERVED_NAME = /^(con|prn|aux|nul|com[\d¹²³]|lpt[\d¹²³])[ ]*(\..*)?$/i;
const MAX_FILE_NAME = 200;

/** Pure: a file name that's safe to write inside a folder (no separators, no reserved names). */
function safeFileName(name) {
  // Windows silently drops trailing dots and spaces when it creates a file,
  // so "mod.jar." would land on disk as "mod.jar" while the manifest still
  // tracked the name with the dot. Drop them here so both always agree.
  let base = path
    .basename(String(name || ""))
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/[. ]+$/, "")
    .trim();
  if (!base || base === "." || base === "..") throw new Error("Refused an unusable file name.");
  const reserved = base.match(RESERVED_NAME);
  if (reserved) {
    // A bare device name is never a real download; one with an extension
    // ("aux.jar", "con.zip") is just an unlucky name - make it writable.
    if (!reserved[2]) throw new Error("Refused an unusable file name.");
    base = "_" + base;
  }
  if (base.length > MAX_FILE_NAME) {
    // Cut the middle, not the end: without its .jar/.zip (and .disabled)
    // the game wouldn't load the file and the lists wouldn't recognise it.
    const ext = (base.match(/(\.[^.]{1,20})(\.disabled)?$/i) || [""])[0];
    let stem = base.slice(0, MAX_FILE_NAME - ext.length);
    if (/[\ud800-\udbff]$/.test(stem)) stem = stem.slice(0, -1); // don't split a surrogate pair
    base = (stem.replace(/[. ]+$/, "") || "_") + ext;
  }
  return base;
}

/** Same file? Windows paths differ only by case for one file; elsewhere case matters. */
function samePath(a, b) {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function exists(full) {
  try {
    await fsp.access(full);
    return true;
  } catch {
    return false;
  }
}

/**
 * Deletes one file, waiting out the short locks Windows takes on it. Never
 * recursive on purpose: the paths come from the manifest, and a damaged or
 * planted entry that names a folder must fail here, not empty that folder.
 */
async function removeFile(full) {
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.rm(full, { force: true });
      return;
    } catch (err) {
      if (attempt >= 4 || !["EBUSY", "EPERM", "EACCES"].includes(err && err.code)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
    }
  }
}

async function sha1File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha1");
    fs.createReadStream(file)
      .on("data", (d) => hash.update(d))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

function folderFor(gameDir, kind, world) {
  if (kind === "datapack") {
    if (!world) throw new Error("Pick a world for that data pack.");
    return within(path.join(gameDir, "saves"), path.join(safeFileName(world), "datapacks"));
  }
  const k = KINDS[kind];
  if (!k) throw new Error(`Unknown content type: ${kind}`);
  return path.join(gameDir, k.folder);
}

/* ------------------------------------------------------------------ */
/* tracking manifest                                                  */
/* ------------------------------------------------------------------ */

function manifestPath(gameDir) {
  return path.join(gameDir, ".reminth", "content.json");
}

/** Pure: text without a leading byte-order mark (Windows editors add one; JSON.parse refuses it). */
function stripBom(text) {
  return String(text).replace(/^\uFEFF/, "");
}

/** Pure: the manifest in a content.json's text, or null when the text isn't one. */
function parseManifest(text) {
  try {
    const parsed = JSON.parse(stripBom(text));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed.files && typeof parsed.files === "object" && !Array.isArray(parsed.files) ? parsed : { files: {} };
  } catch {
    return null;
  }
}

/**
 * The manifest for SHOWING things: any trouble reading it just means the
 * lists fall back to file names this time. Never write this one back - see
 * readManifestForUpdate.
 */
async function readManifest(gameDir) {
  try {
    return parseManifest(await fsp.readFile(manifestPath(gameDir), "utf8")) || { files: {} };
  } catch {
    return { files: {} };
  }
}

const MANIFEST_BUSY = ["EBUSY", "EPERM", "EACCES"];

/**
 * The manifest for CHANGING: what comes back is written straight back, so
 * "couldn't read it" must never be mistaken for "it's empty" - that wiped
 * every title, icon and project id the moment antivirus held the file for
 * a second. Only a file that truly isn't there is empty. A locked file is
 * waited for, then reported. A file that can't be parsed is moved aside
 * (content.json.corrupt-<time>) and the last good copy (.bak) used.
 */
async function readManifestForUpdate(gameDir) {
  const file = manifestPath(gameDir);
  let text = null;
  for (let attempt = 0; ; attempt++) {
    try {
      text = await fsp.readFile(file, "utf8");
      break;
    } catch (err) {
      if (err && err.code === "ENOENT") break;
      if (attempt < 4 && MANIFEST_BUSY.includes(err && err.code)) {
        await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)));
        continue;
      }
      throw new Error("Couldn't read this instance's content list - another program has it open. Try again in a moment.", { cause: err });
    }
  }
  if (text !== null) {
    const parsed = parseManifest(text);
    if (parsed) return parsed;
    await atomic.quarantine(file);
  }
  // Missing or just moved aside: the copy kept by the last good write, if any.
  try {
    return parseManifest(await fsp.readFile(`${file}.bak`, "utf8")) || { files: {} };
  } catch {
    return { files: {} };
  }
}

async function writeManifest(gameDir, manifest) {
  // backup: the same bytes are kept as content.json.bak, for the day the main file turns up damaged.
  await atomic.writeJsonAtomic(manifestPath(gameDir), manifest, { space: 2, backup: true });
}

/**
 * The only safe way to change the manifest: under a per-instance lock, read
 * what is on disk NOW, apply change(manifest), write it back. Holding a
 * copy across downloads and writing it at the end (how this used to work)
 * meant two installs running together each wrote back their own stale
 * copy, and the last one dropped everything the other had just recorded.
 * Returns whatever change() returns.
 */
async function updateManifest(gameDir, change) {
  const resolved = path.resolve(gameDir);
  const key = "content-manifest:" + (process.platform === "win32" ? resolved.toLowerCase() : resolved);
  return atomic.withLock(key, async () => {
    const manifest = await readManifestForUpdate(gameDir);
    const result = await change(manifest);
    await writeManifest(gameDir, manifest);
    return result;
  });
}

/** Key used in the manifest: the path relative to the game folder, forward slashes. */
function relKey(gameDir, full) {
  return path.relative(gameDir, full).split(path.sep).join("/");
}

/* ------------------------------------------------------------------ */
/* listing                                                            */
/* ------------------------------------------------------------------ */

const jarMetaCache = new Map(); // full path -> { size, mtimeMs, meta }

/**
 * Pure: the first [[mods]] entry of a Forge/NeoForge mods.toml, as
 * { id, name, version, description, icon }. Only the handful of keys the UI
 * shows - not a general TOML parser.
 */
function parseModsToml(text) {
  const src = String(text || "");
  const header = /^[ \t]*\[\[mods\]\][ \t]*$/m;
  const start = src.search(header);
  if (start < 0) return null;
  const head = src.slice(0, start);
  let block = src.slice(start).replace(header, "");
  const next = block.search(/^[ \t]*\[/m);
  if (next >= 0) block = block.slice(0, next);
  const get = (area, key) => {
    const lines = area.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(new RegExp("^\\s*" + key + "\\s*=\\s*(.*)$"));
      if (!m) continue;
      let v = m[1].trim();
      const triple = v.startsWith("'''") ? "'''" : v.startsWith('"""') ? '"""' : null;
      if (triple) {
        let body = v.slice(3);
        let j = i;
        while (!body.includes(triple) && j + 1 < lines.length) body += "\n" + lines[++j];
        return body.split(triple)[0].trim();
      }
      const q = v.match(/^"((?:[^"\\]|\\.)*)"|^'([^']*)'/);
      if (q) return q[1] !== undefined ? q[1].replace(/\\"/g, '"') : q[2];
      return null;
    }
    return null;
  };
  return {
    id: get(block, "modId"),
    name: get(block, "displayName"),
    version: get(block, "version"),
    description: get(block, "description"),
    icon: get(block, "logoFile") || get(head, "logoFile"),
    authors: get(block, "authors") || get(head, "authors"),
  };
}

/**
 * Pure: the first listed author from whatever shape the loader's metadata
 * uses - fabric's ["a", {name: "b"}], mcmod.info's authorList, a toml
 * "a, b and c" string, or quilt's contributor keys. Shown under the mod's
 * name in the instance content list.
 */
function firstAuthor(authors) {
  let first = null;
  if (Array.isArray(authors)) first = authors.find((a) => (typeof a === "string" && a.trim()) || (a && typeof a.name === "string"));
  else if (typeof authors === "string") first = authors.split(/,|\band\b|&/i)[0];
  if (first && typeof first === "object") first = first.name;
  return typeof first === "string" && first.trim() ? first.trim().slice(0, 60) : null;
}

/** Pure: Implementation-Version from a jar manifest (what Forge's ${file.jarVersion} means). */
function manifestVersion(text) {
  const m = String(text || "").replace(/\r?\n /g, "").match(/^Implementation-Version:\s*(.+?)\s*$/m);
  return m ? m[1] : null;
}

/**
 * Pure: a mod's JSON descriptor as an object, or null. Real fabric.mod.json
 * files often aren't strict JSON - a description with a raw line break or
 * tab inside the string, a trailing comma - and Fabric's own reader accepts
 * them. So when the strict parse fails, raw control characters become
 * spaces (outside a string they are only whitespace anyway) and trailing
 * commas are dropped, and it is tried once more.
 */
function parseLooseJson(text) {
  const src = stripBom(text);
  const object = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
  try {
    return object(JSON.parse(src));
  } catch {
    // fall through to the tolerant attempt
  }
  try {
    return object(JSON.parse(src.replace(/[\u0000-\u001f]/g, " ").replace(/,(\s*[}\]])/g, "$1")));
  } catch {
    return null;
  }
}

// Fabric API alone packs 50-odd modules inside its jar. The limit used to be
// 40, which made that one jar "not fully read" in nearly every instance.
const MAX_NESTED_JARS = 160;
const MAX_NESTED_JAR_BYTES = 8 * 1024 * 1024;
// All the nested jars of ONE outer jar together: each is held in memory
// while it is looked at, and 160 x 8 MB is more than a mod list should cost.
const MAX_NESTED_TOTAL_BYTES = 64 * 1024 * 1024;

/**
 * The mods bundled INSIDE a Fabric jar (its "jars" list), one level deep:
 * { mods: [{ id, name, version, provides, mcDep }], unread, unreadNames }. The
 * compatibility check needs these to know a dependency is already provided
 * by a jar-in-jar. `unread` is true when the answer may be incomplete (too
 * many, too big, or one that couldn't be opened), and `unreadNames` says
 * WHICH nested jars those were - so the check is only unsure about mods one
 * of them could be, not about everything in the instance. Never throws.
 */
async function readNestedMods(zip, nested) {
  const mods = [];
  const unreadNames = nested.slice(MAX_NESTED_JARS); // over the count limit
  let total = 0;
  for (const name of nested.slice(0, MAX_NESTED_JARS)) {
    try {
      // Whatever is left of the total allowance caps this read too: a jar
      // that would go over it is not read at all.
      const buf = await zip.read(name, { maxBytes: Math.min(MAX_NESTED_JAR_BYTES, MAX_NESTED_TOTAL_BYTES - total) });
      if (!buf) {
        unreadNames.push(name); // listed but not in the jar
        continue;
      }
      total += buf.length;
      const inner = await zipread.openZipBuffer(buf);
      const raw = await inner.read("fabric.mod.json");
      if (!raw) continue; // a plain library jar, not a mod
      const json = parseLooseJson(raw.toString("utf8"));
      if (!json || typeof json.id !== "string") {
        unreadNames.push(name);
        continue;
      }
      // Its own Minecraft requirement too: a packed jar that needs another
      // Minecraft version stops the game exactly like one in the folder
      // (compat.findNestedMcProblems decides whether Fabric would load it).
      const mc = json.depends && typeof json.depends === "object" && !Array.isArray(json.depends) ? json.depends.minecraft : undefined;
      const mcDep = typeof mc === "string" || (Array.isArray(mc) && mc.length && mc.every((d) => typeof d === "string")) ? mc : null;
      mods.push({
        id: json.id.slice(0, 80),
        name: typeof json.name === "string" ? json.name.slice(0, 80) : null,
        version: typeof json.version === "string" ? json.version.slice(0, 40) : null,
        provides: Array.isArray(json.provides) ? json.provides.filter((x) => typeof x === "string").slice(0, 32) : [],
        mcDep,
      });
    } catch {
      unreadNames.push(name);
    }
  }
  return { mods, unread: unreadNames.length > 0, unreadNames };
}

/** Name/version/icon out of a Fabric, Quilt, Forge or NeoForge mod jar. Never throws. */
async function readJarMeta(full, stat) {
  const cached = jarMetaCache.get(full);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.meta;
  let meta = null;
  try {
    const zip = await zipread.openZip(full);
    try {
      let json = null;
      const raw = (await zip.read("fabric.mod.json")) || (await zip.read("quilt.mod.json"));
      // A descriptor that can't be parsed leaves json null - the jar is then
      // still reported with its `descriptors` below, so the compatibility
      // check knows which loader it is for even without a name.
      if (raw) json = parseLooseJson(raw.toString("utf8"));
      // Which loaders this jar is written for, and what it says it needs -
      // the compatibility check (compat.js) uses these to tell the player a
      // mod won't load BEFORE the game refuses to start.
      const descriptors = {
        fabric: zip.has("fabric.mod.json"),
        quilt: zip.has("quilt.mod.json"),
        forge: zip.has("META-INF/mods.toml") || zip.has("mcmod.info"),
        neoforge: zip.has("META-INF/neoforge.mods.toml"),
      };
      let mcDep = null;
      let requires = [];
      let depends = null;
      let breaks = null;
      let provides = [];
      let nested = [];
      let environment = null; // fabric.mod.json "environment": where the mod runs
      let nestedMods = [];
      let nestedUnread = false;
      let nestedUnreadNames = []; // file names of the nested jars behind nestedUnread ("*": some that aren't even named here)
      // Only well-formed predicates are kept: { "sodium": ">=0.6.0" } or an
      // array of such strings. Anything else is dropped rather than guessed.
      const predicates = (obj) => {
        if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
        const out = {};
        for (const [id, pred] of Object.entries(obj).slice(0, 64)) {
          if (typeof pred === "string" || (Array.isArray(pred) && pred.length && pred.every((d) => typeof d === "string"))) out[id] = pred;
        }
        return out;
      };
      if (descriptors.fabric && json) {
        depends = predicates(json.depends);
        breaks = predicates(json.breaks);
        if (depends && depends.minecraft) mcDep = depends.minecraft;
        if (json.depends && typeof json.depends === "object" && !Array.isArray(json.depends)) requires = Object.keys(json.depends).slice(0, 64);
        if (Array.isArray(json.provides)) provides = json.provides.filter((x) => typeof x === "string").slice(0, 32);
        let unlisted = false; // more nested jars than the 200 names kept
        if (Array.isArray(json.jars)) {
          const listed = json.jars.map((j) => (j && typeof j.file === "string" ? j.file : null)).filter(Boolean);
          unlisted = listed.length > 200;
          nested = listed.slice(0, 200);
        }
        if (["client", "server", "*"].includes(json.environment)) environment = json.environment;
        if (nested.length) {
          const inside = await readNestedMods(zip, nested);
          nestedMods = inside.mods;
          nestedUnread = inside.unread || unlisted;
          nestedUnreadNames = unlisted ? [...inside.unreadNames, "*"] : inside.unreadNames;
        }
      }
      if (!json) {
        const toml = (await zip.read("META-INF/neoforge.mods.toml")) || (await zip.read("META-INF/mods.toml"));
        if (toml) {
          json = parseModsToml(toml.toString("utf8"));
          if (json && (!json.version || /\$\{/.test(json.version))) {
            json.version = manifestVersion(String((await zip.read("META-INF/MANIFEST.MF")) || "")) || null;
          }
        } else {
          // Forge 1.12.2 and older: mcmod.info, a JSON array (sometimes wrapped).
          const info = await zip.read("mcmod.info");
          if (info) {
            try {
              const parsed = JSON.parse(stripBom(info.toString("utf8")));
              const first = Array.isArray(parsed) ? parsed[0] : parsed && Array.isArray(parsed.modList) ? parsed.modList[0] : null;
              if (first) json = { id: first.modid, name: first.name, version: first.version, description: first.description, icon: first.logoFile, authors: first.authorList || first.authors };
            } catch {
              // malformed mcmod.info - list by file name
            }
          }
        }
        if (json && typeof json.icon === "string") json.icon = json.icon.replace(/^\/+/, "");
      }
      if (json && json.quilt_loader) {
        const q = json.quilt_loader;
        json = { id: q.id, name: q.metadata && q.metadata.name, version: q.version, icon: q.metadata && q.metadata.icon, description: q.metadata && q.metadata.description, authors: q.metadata && q.metadata.contributors ? Object.keys(q.metadata.contributors) : null };
      }
      if (json) {
        let iconPath = json.icon;
        if (iconPath && typeof iconPath === "object") {
          const sizes = Object.keys(iconPath).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
          iconPath = iconPath[String(sizes.find((s) => s >= 64) || sizes[sizes.length - 1])];
        }
        let icon = null;
        if (typeof iconPath === "string" && zip.has(iconPath)) {
          const buf = await zip.read(iconPath);
          if (buf && buf.length <= MAX_ICON_BYTES && buf.subarray(0, 4).toString("hex") === "89504e47") {
            icon = "data:image/png;base64," + buf.toString("base64");
          }
        }
        meta = {
          modId: typeof json.id === "string" ? json.id : null,
          name: typeof json.name === "string" ? json.name.slice(0, 80) : null,
          version: typeof json.version === "string" ? json.version.slice(0, 40) : null,
          description: typeof json.description === "string" ? json.description.slice(0, 200) : null,
          author: firstAuthor(json.authors),
          icon,
          descriptors,
          mcDep,
          requires,
          depends,
          breaks,
          provides,
          nested,
          environment,
          nestedMods,
          nestedUnread,
          nestedUnreadNames,
        };
      } else if (descriptors.fabric || descriptors.quilt || descriptors.forge || descriptors.neoforge) {
        meta = { modId: null, name: null, version: null, description: null, author: null, icon: null, descriptors, mcDep, requires, depends, breaks, provides, nested, environment, nestedMods, nestedUnread, nestedUnreadNames };
      }
    } finally {
      await zip.close();
    }
  } catch {
    meta = null; // not a zip / no metadata - still listed, just by file name
  }
  jarMetaCache.set(full, { size: stat.size, mtimeMs: stat.mtimeMs, meta });
  return meta;
}

/**
 * Everything in one kind's folder - not just the files the game will load.
 * A stray folder or .rar in mods/ is listed too, flagged, so "I put a file
 * there and it didn't show up" never happens; the flag explains that
 * Minecraft will ignore it.
 */
async function listFolder(gameDir, kind, world, manifest) {
  const dir = folderFor(gameDir, kind, world);
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    let stat;
    try {
      stat = await fsp.stat(full);
    } catch {
      continue;
    }
    const lower = entry.name.toLowerCase();
    const isDir = entry.isDirectory();
    const disabled = lower.endsWith(".disabled");
    const effective = disabled ? lower.slice(0, -".disabled".length) : lower;
    let valid;
    let problem = null;
    if (kind === "mod") {
      valid = !isDir && effective.endsWith(".jar");
      if (!valid) problem = isDir ? "Folder — Minecraft doesn't load folders from mods" : "Not a mod — Minecraft only loads .jar files";
    } else {
      // resource packs, shaders and data packs work as a .zip or unpacked folder
      valid = isDir || effective.endsWith(".zip");
      if (!valid) problem = "Not a pack — needs to be a .zip or a folder";
    }
    const tracked = manifest.files[relKey(gameDir, full.replace(/\.disabled$/i, ""))] || null;
    const item = {
      kind,
      world: world || null,
      file: entry.name,
      folder: isDir,
      size: isDir ? null : stat.size,
      addedAt: Math.round(stat.birthtimeMs || stat.mtimeMs),
      modifiedAt: Math.round(stat.mtimeMs),
      enabled: !disabled,
      valid,
      problem,
      title: tracked ? tracked.title : null,
      versionNumber: tracked ? tracked.versionNumber : null,
      iconUrl: tracked ? tracked.iconUrl : null,
      projectId: tracked ? tracked.projectId : null,
      icon: null,
      name: null,
      modVersion: null,
    };
    if (kind === "mod" && valid) {
      const meta = await readJarMeta(full, stat);
      if (meta) {
        item.name = meta.name;
        item.modVersion = meta.version;
        item.icon = meta.icon;
        item.modId = meta.modId;
        item.description = meta.description;
        item.author = meta.author || null;
        item.descriptors = meta.descriptors || null;
        item.mcDep = meta.mcDep || null;
        item.requires = meta.requires || [];
        item.depends = meta.depends || null;
        item.breaks = meta.breaks || null;
        item.provides = meta.provides || [];
        item.nested = meta.nested || [];
        item.environment = meta.environment || null;
        item.nestedMods = meta.nestedMods || [];
        item.nestedUnread = meta.nestedUnread === true;
        item.nestedUnreadNames = Array.isArray(meta.nestedUnreadNames) ? meta.nestedUnreadNames : [];
      }
    }
    out.push(item);
  }
  return out;
}

async function listWorldFolders(gameDir) {
  try {
    const entries = await fsp.readdir(path.join(gameDir, "saves"), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** { mod: [...], resourcepack: [...], shader: [...], datapack: [...], worlds: [...] } */
async function listAll(gameDir) {
  const manifest = await readManifest(gameDir);
  const worlds = await listWorldFolders(gameDir);
  const datapacks = [];
  for (const world of worlds) datapacks.push(...(await listFolder(gameDir, "datapack", world, manifest)));
  return {
    mod: await listFolder(gameDir, "mod", null, manifest),
    resourcepack: await listFolder(gameDir, "resourcepack", null, manifest),
    shader: await listFolder(gameDir, "shader", null, manifest),
    datapack: datapacks,
    worlds,
  };
}

/* ------------------------------------------------------------------ */
/* watching                                                           */
/* ------------------------------------------------------------------ */

let watchers = [];
let watchTimer = null;
// Bumped by every watchInstance()/unwatch(). A watchInstance call that was
// overtaken while it was still awaiting sees the number has moved on and
// backs out, instead of adding its watchers to the newer call's.
let watchGeneration = 0;

function closeWatchers(list) {
  for (const w of list) {
    try {
      w.close();
    } catch {
      // already closed
    }
  }
}

/**
 * Watches one instance's content folders and calls onChange() (debounced)
 * whenever something is added, removed or renamed - so the lists update the
 * moment a file lands, with no refresh needed. Calling again re-targets the
 * watch (e.g. when the player switches instance).
 */
async function watchInstance(gameDir, onChange) {
  unwatch();
  const generation = watchGeneration;
  const current = () => generation === watchGeneration;
  const fire = () => {
    if (!current()) return;
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => current() && onChange(), 250);
  };
  const opened = [];
  for (const folder of ["mods", "resourcepacks", "shaderpacks", "saves"]) {
    const dir = path.join(gameDir, folder);
    try {
      await fsp.mkdir(dir, { recursive: true });
      if (!current()) break; // re-targeted or stopped while we waited
      // recursive on the saves folder so a data pack dropped into
      // saves/<world>/datapacks is seen too (Windows supports this natively)
      const w = fs.watch(dir, { recursive: folder === "saves" }, fire);
      // A watched folder being deleted (the instance removed, a drive
      // unplugged) raises 'error' on the watcher; with nobody listening
      // that is an uncaught exception in the main process.
      w.on("error", () => {
        closeWatchers([w]);
        const at = watchers.indexOf(w);
        if (at >= 0) watchers.splice(at, 1);
      });
      opened.push(w);
    } catch {
      // a folder we can't watch just means that list refreshes on page open
    }
  }
  if (!current()) {
    closeWatchers(opened);
    return;
  }
  watchers = opened;
}

/** Stops watching (and drops any change notification still waiting to fire). */
function unwatch() {
  watchGeneration++;
  clearTimeout(watchTimer);
  closeWatchers(watchers);
  watchers = [];
}

/* ------------------------------------------------------------------ */
/* toggling / removing                                                */
/* ------------------------------------------------------------------ */

async function setEnabled(gameDir, { kind, world, file }, enabled) {
  const dir = folderFor(gameDir, kind, world);
  const current = within(dir, safeFileName(file));
  const isDisabled = /\.disabled$/i.test(current);
  if (enabled === !isDisabled) return { file };
  const target = enabled ? current.replace(/\.disabled$/i, "") : current + ".disabled";
  await fsp.rename(current, target);
  return { file: path.basename(target) };
}

/** Moves to the Recycle Bin (via the trash function main.js passes in), so a mis-click is undoable. */
async function remove(gameDir, { kind, world, file }, trash) {
  const dir = folderFor(gameDir, kind, world);
  const full = within(dir, safeFileName(file));
  await trash(full);
  await updateManifest(gameDir, (manifest) => {
    delete manifest.files[relKey(gameDir, full.replace(/\.disabled$/i, ""))];
  });
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* downloading                                                        */
/* ------------------------------------------------------------------ */

/**
 * Streams a Modrinth file to `dest` with progress, verifying its sha1
 * before it ever replaces anything on disk (temp file + rename).
 */
async function downloadVerified(url, dest, sha1, onBytes) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !MODRINTH_FILE_HOST.test(parsed.hostname)) {
    throw new Error(`Refused a download from ${parsed.hostname}`);
  }
  return downloadWithHash(parsed.href, dest, sha1, onBytes);
}

const DOWNLOAD_STALL_MS = 30000;

/**
 * Streams `url` to `dest` through a temp file, checking the sha1 before the
 * rename. Fails cleanly - temp file removed, connection closed, an Error
 * thrown - on every way a download goes wrong: the server stops sending
 * (no bytes for `stallMs`), the disk fills up, the folder disappears
 * mid-download, or the bytes don't match.
 */
async function downloadWithHash(url, dest, sha1, onBytes, { stallMs = DOWNLOAD_STALL_MS } = {}) {
  const controller = new AbortController();
  // One promise that rejects the moment the download can't go on (stalled,
  // or the file can't be written). Every wait below races against it, so
  // nothing can be left waiting on an event that will never come.
  let fail;
  const failed = new Promise((_, reject) => (fail = reject));
  failed.catch(() => {}); // observed through the races; never "unhandled"
  let stalled = false;
  let stallTimer = null;
  const alive = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stalled = true;
      controller.abort();
      fail(new Error("Download stalled."));
    }, stallMs);
  };
  let tmp = null;
  let out = null;
  let reader = null;
  try {
    alive();
    const res = await Promise.race([fetch(url, { headers: { "User-Agent": modrinth.USER_AGENT }, signal: controller.signal }), failed]);
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
    const total = Number(res.headers.get("content-length")) || 0;
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    // Random, not just the pid: two downloads of the same file at once (a
    // dependency two mods share) would otherwise write into one temp file.
    tmp = atomic.tmpName(dest, "part");
    out = fs.createWriteStream(tmp);
    // A write stream reports a full disk or a vanished folder as an 'error'
    // event. Unheard, that is an uncaught exception in the main process -
    // and waiting for 'drain' alone would then wait forever.
    out.on("error", fail);
    const hash = crypto.createHash("sha1");
    let received = 0;
    reader = res.body.getReader();
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), failed]);
      if (done) break;
      alive();
      hash.update(value);
      received += value.length;
      if (!out.write(value)) {
        const stream = out;
        await Promise.race([new Promise((resolve) => stream.once("drain", resolve)), failed]);
        alive(); // time spent waiting on a slow disk isn't the server stalling
      }
      onBytes && onBytes(received, total);
    }
    clearTimeout(stallTimer);
    await Promise.race([new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve()))), failed]);
    const actual = hash.digest("hex");
    if (sha1 && actual !== String(sha1).toLowerCase()) {
      throw new Error("Checksum mismatch - the download was corrupted or altered.");
    }
    // Windows refuses the rename while antivirus is still scanning the new file.
    await atomic.renameWithRetry(tmp, dest);
  } catch (err) {
    clearTimeout(stallTimer);
    controller.abort();
    if (reader) reader.cancel().catch(() => {});
    if (out) {
      // Wait for the handle to really close - Windows won't delete an open file.
      const stream = out;
      await new Promise((resolve) => {
        if (stream.closed) return resolve();
        stream.once("close", resolve);
        stream.destroy();
      });
    }
    if (tmp) await removeFile(tmp).catch(() => {});
    if (stalled) throw new Error("The download stalled - no data arrived for a while. Check your connection and try again.");
    throw err;
  } finally {
    clearTimeout(stallTimer);
  }
}

/* ------------------------------------------------------------------ */
/* installing                                                         */
/* ------------------------------------------------------------------ */

/**
 * Lower-cased names of the jars Reminth's performance pack put in mods/
 * (minecraft.js keeps that list in .reminth/managed-mods.json). Never throws.
 */
async function managedPerformanceJars(gameDir) {
  const out = new Set();
  try {
    const parsed = JSON.parse(await fsp.readFile(path.join(gameDir, ".reminth", "managed-mods.json"), "utf8"));
    for (const [name, info] of Object.entries((parsed && parsed.files) || {})) {
      const mod = info && typeof info.mod === "string" ? info.mod : "";
      if (mod && mod !== "fabric-api" && mod !== "reminthhud") out.add(name.toLowerCase());
    }
  } catch {
    // no list yet
  }
  return out;
}

/**
 * Modrinth project ids of the mod jars in an instance, looked up by sha1.
 * Never throws; `lookupFailed` on the returned Set says the answer is not
 * to be trusted as "nothing there" (Modrinth couldn't be asked).
 */
async function modProjectsOnDisk(gameDir) {
  const out = new Set();
  out.lookupFailed = false;
  const dir = path.join(gameDir, "mods");
  let names;
  try {
    names = (await fsp.readdir(dir)).filter((n) => /\.jar(\.disabled)?$/i.test(n));
  } catch {
    return out;
  }
  // Reminth's own performance-pack jars (Sodium and friends) don't count as
  // "the player already has this": they're whatever build Reminth picked,
  // and a mod that needs a particular Sodium must be able to bring its own.
  // When it does, Reminth's copy steps aside at the next launch. The Fabric
  // API Reminth manages does count - it is always the current one.
  const stepAside = await managedPerformanceJars(gameDir);
  names = names.filter((n) => !stepAside.has(n.toLowerCase()));
  const hashes = [];
  for (const n of names) {
    try {
      hashes.push(await sha1File(path.join(dir, n)));
    } catch {
      // unreadable - skip
    }
  }
  if (!hashes.length) return out;
  try {
    const found = await modrinth.getVersionsFromHashes(hashes, "sha1");
    for (const v of Object.values(found || {})) if (v && v.project_id) out.add(v.project_id);
  } catch {
    // offline: fall back to what the manifest knows
    out.lookupFailed = true;
  }
  return out;
}

/** Pure: which Modrinth loaders to ask for, per content kind and instance. */
function loadersFor(kind, instance) {
  if (kind === "mod") {
    // Quilt runs Fabric mods too; NeoForge 1.20.1 still runs Forge mods.
    if (instance.loader === "fabric") return ["fabric"];
    if (instance.loader === "quilt") return ["quilt", "fabric"];
    if (instance.loader === "forge") return ["forge"];
    if (instance.loader === "neoforge") return instance.mcVersion === "1.20.1" ? ["neoforge", "forge"] : ["neoforge"];
    return [];
  }
  if (kind === "resourcepack") return ["minecraft"];
  if (kind === "shader") return ["iris", "optifine"];
  if (kind === "datapack") return ["datapack"];
  return [];
}

/** Pure: Modrinth's project_type -> our kind. */
function kindForProjectType(projectType) {
  return { mod: "mod", resourcepack: "resourcepack", shader: "shader", datapack: "datapack" }[projectType] || null;
}

/** Pure: the version to install out of a list Modrinth returned newest-first - a release if there is one. */
function pickVersion(versions) {
  if (!Array.isArray(versions) || !versions.length) return null;
  return versions.find((v) => v.version_type === "release") || versions[0];
}

/** Pure: is this Modrinth version a build for the instance's Minecraft version and loader? */
function versionFitsInstance(version, kind, instance) {
  const games = Array.isArray(version.game_versions) ? version.game_versions : [];
  const loaders = Array.isArray(version.loaders) ? version.loaders : [];
  const wanted = loadersFor(kind, instance);
  if (games.length && !games.includes(instance.mcVersion)) return false;
  if (wanted.length && loaders.length && !loaders.some((l) => wanted.includes(l))) return false;
  return true;
}

function primaryFile(version) {
  const files = (version && version.files) || [];
  return files.find((f) => f.primary) || files[0] || null;
}

/**
 * The part of installing that install() and applyUpdates() share: put one
 * project's file into the instance, record it, and pull in whatever it
 * requires. `kind`/`world` are those of the request that started it (they
 * decide what counts as "already there"); report(stage, current, total).
 */
async function createInstaller(instance, kind, world, report, { releaseOnly = false } = {}) {
  const gameDir = instance.gameDir;
  const installed = [];
  const skipped = [];
  const warnings = []; // things the player should know about although the install went through
  const visited = new Set();

  // Every mod already on disk - Reminth-installed or dropped in by hand -
  // resolved to its Modrinth project by file hash, so a dependency that's
  // already there (Fabric API, most often) is never downloaded twice.
  const onDisk = kind === "mod" || kind === "shader" ? await modProjectsOnDisk(gameDir) : new Set();

  // The manifest is read fresh every time (another install may have just
  // changed it), and an entry only counts while its file is really there,
  // enabled or disabled: a dependency the player deleted by hand used to be
  // "already installed" forever and was never put back.
  const tracked = async (pid, matches) => {
    const { files } = await readManifest(gameDir);
    for (const [key, f] of Object.entries(files)) {
      if (!f || f.projectId !== pid || !matches(f)) continue;
      let full;
      try {
        full = within(gameDir, key);
      } catch {
        continue;
      }
      if ((await exists(full)) || (await exists(full + ".disabled"))) return true;
    }
    return false;
  };
  const haveTracked = (pid) => tracked(pid, () => true);
  const haveProject = async (pid) =>
    onDisk.has(pid) || tracked(pid, (f) => (f.kind === "mod" || f.kind === kind) && (kind !== "datapack" || f.world === world));

  /** Installs everything `version` lists as required that isn't here yet. */
  async function installRequired(version) {
    for (const dep of (version && version.dependencies) || []) {
      if (!dep || dep.dependency_type !== "required") continue;
      if (dep.project_id) {
        // When the author names the exact build they need (Iris does, for
        // Sodium), that build is the one to install - "the newest" is how a
        // dependency ends up the wrong version.
        await installOne(dep.project_id, "mod", null, dep.version_id || null, true);
        continue;
      }
      if (!dep.version_id) continue;
      // Some authors name only the exact version they need, with no project
      // id. Those used to be skipped without a word; ask Modrinth which
      // project the version belongs to and install that very version.
      let pinned;
      try {
        pinned = await modrinth.getVersion(dep.version_id);
      } catch (err) {
        // a version that was since deleted can't be installed by anyone
        if (/\b404\b/.test(String(err && err.message))) {
          skipped.push(dep.version_id);
          continue;
        }
        throw err;
      }
      if (!pinned || !pinned.project_id) {
        skipped.push(dep.version_id);
        continue;
      }
      await installOne(pinned.project_id, "mod", null, pinned.id, true, pinned);
    }
  }

  async function installOne(pid, k, w, vid, isDependency, knownVersion) {
    if (visited.has(pid + ":" + k)) return;
    visited.add(pid + ":" + k);
    if (isDependency && (await haveProject(pid))) {
      skipped.push(pid);
      return;
    }
    const project = await modrinth.getProject(pid);
    // Already there as a file Reminth didn't install (dropped in by hand, or
    // part of a modpack): don't add a second copy next to it.
    if (!isDependency && k === "mod" && onDisk.has(project.id) && !(await haveTracked(project.id))) {
      throw new Error(`${project.title} is already in this instance's mods folder.`);
    }
    // The check above is only as good as the lookup behind it. If Modrinth
    // couldn't be asked which projects the jars in mods/ are, "not found"
    // means nothing - and going ahead is how a second copy of a mod the
    // player already has ends up next to the first. (Something Reminth
    // installed itself is replaced in place, so that is still safe.)
    if (!isDependency && k === "mod" && onDisk.lookupFailed && !(await haveTracked(project.id))) {
      throw new Error("Couldn't check what's already installed — try again in a moment.");
    }
    let version;
    if (vid) {
      // A version the player picked in the version chooser (or one a
      // dependency pinned).
      // A pin that no longer exists (the author deleted that build) isn't
      // fatal for a dependency: the newest matching build is used instead.
      version = knownVersion || (await modrinth.getVersion(vid).catch((err) => (isDependency ? null : Promise.reject(err))));
      if (version && version.project_id !== project.id) {
        if (!isDependency) throw new Error(`That version doesn't belong to ${project.title}.`);
        version = null;
      }
      // A build another mod pinned is only used if it is actually for this
      // instance; a pin left over from another Minecraft version would put
      // in exactly the kind of mod that stops the game starting.
      if (isDependency && version && !versionFitsInstance(version, k, instance)) version = null;
    }
    if (!version && (!vid || isDependency)) {
      const versions = await modrinth.getProjectVersions(project.id, {
        loaders: loadersFor(k, instance),
        gameVersions: [instance.mcVersion],
      });
      version = pickVersion(versions);
    }
    // releaseOnly (the "update mods to fit" button): nothing the player didn't
    // pick themselves may be a beta or alpha - not even a build another mod
    // pinned. A dependency with no stable build is left out and said so.
    if (releaseOnly && version && version.version_type !== "release") {
      const versions = await modrinth.getProjectVersions(project.id, {
        loaders: loadersFor(k, instance),
        gameVersions: [instance.mcVersion],
      });
      version = (versions || []).find((v) => v && v.version_type === "release" && versionFitsInstance(v, k, instance)) || null;
      if (!version && isDependency) {
        warnings.push(`${project.title} has no stable build for Minecraft ${instance.mcVersion} yet, so it wasn't added - a mod that was updated needs it.`);
        skipped.push(project.title);
        return;
      }
    }
    if (!version) {
      if (isDependency) {
        skipped.push(project.title);
        return;
      }
      throw new Error(`${project.title} has no version for Minecraft ${instance.mcVersion}${k === "mod" ? ` on ${LOADER_TITLES[instance.loader] || instance.loader}` : ""}.`);
    }
    const file = primaryFile(version);
    if (!file) throw new Error(`${project.title} ${version.version_number} has no file to download.`);

    const dir = folderFor(gameDir, k, w);
    const dest = within(dir, safeFileName(file.filename));
    report(`Downloading ${project.title}`, 0, file.size || 1);
    // Was a file of this name here already (the same version picked again in
    // the chooser)? Then it isn't this install's to delete if it is refused.
    const hadDest = await exists(dest);
    // The new file is downloaded and checked first; the copy it replaces is
    // only touched once this one is in place.
    await downloadVerified(file.url, dest, file.hashes && file.hashes.sha1, (got, total) =>
      report(`Downloading ${project.title}`, got, total || file.size || 1)
    );

    // Last line of defence against a second copy: the same mod id already
    // loaded from another jar (one Modrinth doesn't know by hash - a
    // different build, or from another site). Two jars with one id stop the
    // game starting, so the new download goes away again.
    if (!isDependency && k === "mod") {
      const twin = await sameModIdJar(gameDir, dest, project.id);
      if (twin) {
        // Only what this install brought in goes away again. A jar that was
        // already there is a working mod with its own entry in the manifest.
        if (!hadDest) await removeFile(dest).catch(() => {});
        throw new Error(`${project.title} is already in this instance's mods folder (${twin}).`);
      }
    }

    // Recorded the moment it's on disk - not at the end of the whole
    // install - so a dependency that fails later can't leave this file
    // sitting in the folder with nothing tracking it.
    const replaced = await updateManifest(gameDir, (manifest) => {
      const old = [];
      for (const [key, entry] of Object.entries(manifest.files)) {
        if (entry && entry.projectId === project.id && entry.kind === k && (k !== "datapack" || entry.world === w)) {
          old.push(key);
          delete manifest.files[key];
        }
      }
      manifest.files[relKey(gameDir, dest)] = {
        kind: k,
        world: w || null,
        projectId: project.id,
        versionId: version.id,
        versionNumber: version.version_number,
        title: project.title,
        iconUrl: project.icon_url || null,
        sha1: file.hashes && file.hashes.sha1,
        installedAt: Date.now(),
      };
      return old;
    });
    installed.push({ title: project.title, file: path.basename(dest) });

    // Now remove the older copy of the same project Reminth installed
    // earlier - and a disabled twin of the new file, which would otherwise
    // sit next to it as a second copy of the same thing.
    const leftovers = [dest + ".disabled"];
    for (const key of replaced) {
      try {
        const oldFull = within(gameDir, key);
        leftovers.push(oldFull, oldFull + ".disabled");
      } catch {
        // an entry pointing outside the instance is never followed
      }
    }
    // An old file that won't go (the game is running and has it open) is
    // reported, not thrown: the new file is in place and recorded, and what
    // it requires still has to be installed below.
    try {
      await removeReplaced(leftovers, dest, project.title);
    } catch (err) {
      warnings.push(err.message);
    }

    if (k === "mod") await installRequired(version);
  }

  return { installed, skipped, warnings, haveProject, installOne, installRequired };
}

/**
 * File name of another ENABLED jar in mods/ that declares the same mod id
 * as the jar at `dest`, or null. Not counted: `dest` itself, the files
 * Reminth tracks for this same project (they are about to be replaced), and
 * Reminth's performance-pack jars (they step aside at launch). Never throws.
 */
async function sameModIdJar(gameDir, dest, projectId) {
  try {
    const mine = await readJarMeta(dest, await fsp.stat(dest));
    if (!mine || !mine.modId) return null;
    const dir = path.dirname(dest);
    const replacing = new Set();
    for (const [key, entry] of Object.entries((await readManifest(gameDir)).files)) {
      if (entry && entry.projectId === projectId && entry.kind === "mod") replacing.add(path.basename(key).toLowerCase());
    }
    const stepAside = await managedPerformanceJars(gameDir);
    for (const name of await fsp.readdir(dir)) {
      if (!/\.jar$/i.test(name)) continue; // a .disabled jar isn't loaded
      const full = path.join(dir, name);
      if (samePath(full, dest) || replacing.has(name.toLowerCase()) || stepAside.has(name.toLowerCase())) continue;
      try {
        const other = await readJarMeta(full, await fsp.stat(full));
        if (other && other.modId === mine.modId) return name;
      } catch {
        // vanished or unreadable - not a jar the game can load either
      }
    }
  } catch {
    // can't tell - don't block the install over it
  }
  return null;
}

/** Removes the files a newly installed one replaces. Two copies of a mod stop the game loading, so failing is an error. */
async function removeReplaced(files, keep, title) {
  for (const full of files) {
    if (samePath(full, keep)) continue;
    try {
      await removeFile(full);
    } catch {
      throw new Error(`${title} is installed, but its old file ${path.basename(full)} couldn't be removed - close Minecraft, delete that file by hand, and you're done.`);
    }
  }
}

/**
 * Installs a project (and, for mods, its required dependencies) into an
 * instance. `onProgress({ stage, current, total })`.
 * Returns { installed: [{ title, file }], skipped: [...], warnings: [text] } -
 * `warnings` being things that went wrong without failing the install (an
 * old file that couldn't be removed while the game is running).
 */
async function install(instance, { projectId, kind, world, versionId }, onProgress) {
  const report = (stage, current = 0, total = 1) => onProgress && onProgress({ stage, current, total });
  if (!KINDS[kind]) throw new Error("That kind of content can't be installed into an instance.");
  if (kind === "mod" && !loadersFor("mod", instance).length) {
    throw new Error("Mods need a mod loader - this instance is plain vanilla. Change it to Fabric, Quilt, Forge or NeoForge first.");
  }
  const gameDir = instance.gameDir;
  const { installed, skipped, warnings, haveProject, installOne } = await createInstaller(instance, kind, world, report);

  // Shader packs need a shader-loading mod (Iris, or Oculus on Forge);
  // install one in the same click if it isn't there.
  if (kind === "shader") {
    const candidates = shaderModsFor(instance);
    if (!candidates.length) {
      throw new Error("Shader packs need a mod loader - this instance is plain vanilla. Change it to Fabric, Quilt, Forge or NeoForge first.");
    }
    let has = false;
    for (const id of candidates) has = has || (await haveProject(id));
    if (!has) {
      // offline hash lookup failed? a jar called iris-*/oculus-* still counts
      try {
        has = (await fsp.readdir(path.join(gameDir, "mods"))).some((f) => /^(iris|oculus)[-_+]/i.test(f));
      } catch {
        has = false;
      }
    }
    for (const id of has ? [] : candidates) {
      const versions = await modrinth.getProjectVersions(id, { loaders: loadersFor("mod", instance), gameVersions: [instance.mcVersion] });
      const v = pickVersion(versions);
      if (!v) continue;
      report(`Installing ${id === IRIS_ID ? "Iris" : "Oculus"} (shaders need it)`);
      await installOne(id, "mod", null, v.id, true);
      has = true;
      break;
    }
    if (!has) {
      throw new Error(`Neither Iris nor Oculus has a build for Minecraft ${instance.mcVersion} on ${LOADER_TITLES[instance.loader]}, so shader packs can't run here.`);
    }
  }

  await installOne(projectId, kind, world, versionId, false);
  report("Done", 1, 1);
  return { installed, skipped, warnings };
}

/* ------------------------------------------------------------------ */
/* updates                                                            */
/* ------------------------------------------------------------------ */

/**
 * Checks every mod, resource pack, shader pack and data pack in the
 * instance against Modrinth by file hash - so it works for files the player
 * dropped in themselves too, as long as they came from Modrinth.
 * Returns [{ kind, world, file, title, iconUrl, current, next: { versionId, versionNumber, url, sha1, filename, size } }].
 */
async function checkUpdates(instance) {
  const gameDir = instance.gameDir;
  const all = await listAll(gameDir);
  const groups = [
    ["mod", all.mod],
    ["resourcepack", all.resourcepack],
    ["shader", all.shader],
    ["datapack", all.datapack],
  ];
  const results = [];
  for (const [kind, items] of groups) {
    const loaders = loadersFor(kind, instance);
    if (!loaders.length) continue;
    const files = items.filter((i) => i.valid && !i.folder);
    if (!files.length) continue;
    const byHash = new Map();
    for (const item of files) {
      const full = path.join(folderFor(gameDir, kind, item.world), item.file);
      try {
        byHash.set(await sha1File(full), item);
      } catch {
        // unreadable (locked by the running game?) - skip it this round
      }
    }
    if (!byHash.size) continue;
    let updates = {};
    try {
      updates = await modrinth.checkForUpdates([...byHash.keys()], {
        loaders,
        gameVersions: [instance.mcVersion],
        algorithm: "sha1",
      });
    } catch {
      continue;
    }
    const projectIds = new Set();
    for (const [hash, version] of Object.entries(updates || {})) {
      const item = byHash.get(hash);
      const file = primaryFile(version);
      if (!item || !file || !file.hashes || file.hashes.sha1 === hash) continue;
      projectIds.add(version.project_id);
      results.push({
        kind,
        world: item.world,
        file: item.file,
        enabled: item.enabled,
        projectId: version.project_id,
        title: item.title || item.name || item.file,
        iconUrl: item.iconUrl || null,
        current: item.versionNumber || item.modVersion || null,
        next: {
          versionId: version.id,
          versionNumber: version.version_number,
          url: file.url,
          sha1: file.hashes.sha1,
          filename: file.filename,
          size: file.size || 0,
          // "Update all" is the player's own choice, but a beta or alpha is
          // never silent: the list shows the channel next to the version.
          channel: ["release", "beta", "alpha"].includes(version.version_type) ? version.version_type : null,
        },
      });
    }
    // Real titles + icons for anything the manifest didn't know about.
    if (projectIds.size) {
      try {
        const projects = await modrinth.getProjects([...projectIds]);
        const byId = new Map(projects.map((p) => [p.id, p]));
        for (const r of results) {
          const p = byId.get(r.projectId);
          if (p) {
            r.title = p.title;
            r.iconUrl = p.icon_url || r.iconUrl;
          }
        }
      } catch {
        // file names are an acceptable fallback
      }
    }
  }
  return results;
}

/**
 * Applies a list of updates from checkUpdates. onProgress gets overall byte progress.
 * Returns { applied: [title], failed: [{ title, error, file }], added: [title], warnings: [text] } -
 * `added` being mods the new versions require that weren't installed yet,
 * `file` the name the update was for (null for a failure that isn't about
 * one file), and `warnings` notes about updates that did go through (an old
 * file that couldn't be removed).
 */
/**
 * A line in <instance>/.reminth/replaced-mods.log - only for a copy that
 * couldn't be kept. Never throws.
 */
async function logReplaced(gameDir, line) {
  try {
    await fsp.mkdir(path.join(gameDir, ".reminth"), { recursive: true });
    await fsp.appendFile(path.join(gameDir, ".reminth", "replaced-mods.log"), `${new Date().toISOString()} ${line}\n`);
  } catch {
    // logging must never get in the way of the update
  }
}

async function applyUpdates(instance, updates, onProgress, { releaseOnly = false } = {}) {
  const gameDir = instance.gameDir;
  // Every mod jar about to be replaced is copied to
  // .reminth/replaced-mods/<time>/ first (the newest 5 such folders are
  // kept), whichever button asked for the update. Best effort: a copy that
  // fails is written down and the update goes on.
  let backupDir = null;
  const modFiles = (updates || []).filter((u) => u && u.kind === "mod" && typeof u.file === "string").map((u) => u.file);
  if (modFiles.length) {
    try {
      backupDir = await require("./modsSync").backupJars(gameDir, modFiles, new Date(), {
        onError: (name, err) => logReplaced(gameDir, `couldn't keep a copy of ${name} before updating it: ${(err && err.message) || err}`),
      });
    } catch (err) {
      await logReplaced(gameDir, `couldn't keep copies before updating: ${(err && err.message) || err}`);
    }
  }
  const total = updates.reduce((sum, u) => sum + (u.next.size || 0), 0) || updates.length;
  let doneBytes = 0;
  const applied = [];
  const failed = [];
  const added = [];
  const warnings = [];
  const updatedMods = new Map(); // new version id -> { title, file }, to check what they require
  for (const u of updates) {
    try {
      const dir = folderFor(gameDir, u.kind, u.world);
      // The list this came from can be minutes old: the file may have been
      // enabled, disabled or removed since. Look at what is there now
      // (under both of its names) rather than trusting u.file / u.enabled -
      // otherwise the old jar is left behind next to the new one.
      const oldName = safeFileName(u.file).replace(/\.disabled$/i, "");
      if (!oldName) throw new Error("Refused an unusable file name.");
      const oldPlain = within(dir, oldName);
      const oldDisabled = oldPlain + ".disabled";
      const hasPlain = await exists(oldPlain);
      if (!hasPlain && !(await exists(oldDisabled))) throw new Error("That file isn't there any more - refresh the list.");
      const newName = safeFileName(u.next.filename).replace(/\.disabled$/i, "");
      if (!newName) throw new Error("Refused an unusable file name.");
      const newPlain = within(dir, newName);
      const dest = hasPlain ? newPlain : newPlain + ".disabled"; // keep a disabled mod disabled
      const base = doneBytes;
      await downloadVerified(u.next.url, dest, u.next.sha1, (got) =>
        onProgress && onProgress({ stage: `Updating ${u.title}`, current: base + got, total })
      );
      doneBytes += u.next.size || 1;
      // Recorded straight away, under the lock, on a freshly read manifest
      // (an install running alongside keeps its own entries).
      await updateManifest(gameDir, (manifest) => {
        delete manifest.files[relKey(gameDir, oldPlain)];
        manifest.files[relKey(gameDir, newPlain)] = {
          kind: u.kind,
          world: u.world || null,
          projectId: u.projectId,
          versionId: u.next.versionId,
          versionNumber: u.next.versionNumber,
          title: u.title,
          iconUrl: u.iconUrl,
          sha1: u.next.sha1,
          installedAt: Date.now(),
        };
      });
      // Only now, with the new file verified and in place, does the old
      // one go - both of its possible names, and the new file's twin.
      // If the old one won't go (the game has it open) the update still
      // happened - the new file is there and recorded - so it counts as
      // applied, with a note, and what it requires is still looked at below.
      try {
        await removeReplaced([oldPlain, oldDisabled, newPlain, newPlain + ".disabled"], dest, u.title);
      } catch (err) {
        warnings.push(err.message);
      }
      applied.push(u.title);
      if (u.kind === "mod" && u.next.versionId) updatedMods.set(String(u.next.versionId), { title: u.title, file: u.file });
    } catch (err) {
      failed.push({ title: u.title, error: err.message, file: typeof u.file === "string" ? u.file : null });
    }
  }

  // A new version can require a library the old one didn't. Without this
  // the update "works" and the game then refuses to start.
  if (updatedMods.size && loadersFor("mod", instance).length) {
    try {
      const versions = [];
      for (const part of chunk([...updatedMods.keys()], 100)) versions.push(...((await modrinth.getVersions(part)) || []));
      const needy = versions.filter((v) => v && (v.dependencies || []).some((d) => d && d.dependency_type === "required"));
      if (needy.length) {
        const installer = await createInstaller(
          instance,
          "mod",
          null,
          (stage, current = 0, of = 1) => onProgress && onProgress({ stage, current, total: of }),
          { releaseOnly }
        );
        for (const version of needy) {
          try {
            await installer.installRequired(version);
          } catch (err) {
            const from = updatedMods.get(version.id);
            failed.push({ title: `A mod ${(from && from.title) || "an update"} needs`, error: err.message, file: (from && from.file) || null });
          }
        }
        for (const item of installer.installed) added.push(item.title);
        warnings.push(...installer.warnings);
      }
    } catch (err) {
      failed.push({ title: "Mods the updates need", error: err.message, file: null });
    }
  }

  onProgress && onProgress({ stage: "Done", current: total, total });
  return { applied, failed, added, warnings, ...(backupDir ? { backupDir } : {}) };
}


/* ---- who made it: real Modrinth creator name + profile picture ---- */

const CREATORS_FILE = path.join(paths.ROOT, "creators-cache.json");
const CREATORS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // a week - avatars and owners rarely change
const NOT_ON_MODRINTH_TTL_MS = 24 * 60 * 60 * 1000; // re-ask once a day about files Modrinth didn't know
const sha1Cache = new Map(); // full path -> { size, mtimeMs, sha1 }
let creatorsDisk = null;

async function cachedSha1(full) {
  const stat = await fsp.stat(full);
  const hit = sha1Cache.get(full);
  if (hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs) return hit.sha1;
  const sha1 = await sha1File(full);
  sha1Cache.set(full, { size: stat.size, mtimeMs: stat.mtimeMs, sha1 });
  return sha1;
}

async function loadCreatorsDisk() {
  if (creatorsDisk) return creatorsDisk;
  try {
    const parsed = JSON.parse(await fsp.readFile(CREATORS_FILE, "utf8"));
    creatorsDisk = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    creatorsDisk = {};
  }
  return creatorsDisk;
}

async function saveCreatorsDisk() {
  try {
    // Entries whose owner lookup failed stay in memory for this session
    // (the title and icon are still good) but are never saved: on disk they
    // would be "this project has no author" for the next seven days.
    const keep = {};
    for (const [hash, entry] of Object.entries(creatorsDisk)) if (entry && !entry.ownerFailed) keep[hash] = entry;
    await atomic.writeJsonAtomic(CREATORS_FILE, keep);
  } catch {
    // cache only - losing it just means asking Modrinth again next time
  }
}

/** Pure: an https image URL we're willing to hand the renderer, else null. */
function httpsImage(url) {
  try {
    const u = new URL(String(url || ""));
    return u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/** Pure: the member shown as a project's creator - the owner, else the first listed. */
function pickOwner(members) {
  const list = (Array.isArray(members) ? members : []).filter((m) => m && m.user);
  return (
    list.find((m) => m.is_owner === true) ||
    list.find((m) => /^owner$/i.test(String(m.role || ""))) ||
    list.slice().sort((a, b) => (a.ordering ?? 0) - (b.ordering ?? 0))[0] ||
    null
  );
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/**
 * { "kind/world/file": { author, avatar, title, iconUrl, projectId } } for
 * every file in the instance Modrinth recognises (looked up by sha1, the
 * same way the Modrinth app does). Organisation-owned projects show the
 * organisation; everything else shows the project owner. Never throws -
 * offline or rate-limited just means fewer entries, and the list falls
 * back to the name read out of the jar.
 */
async function lookupCreators(gameDir) {
  const all = await listAll(gameDir);
  const disk = await loadCreatorsDisk();
  const now = Date.now();
  const byHash = new Map(); // sha1 -> [key, ...]
  for (const kind of ["mod", "resourcepack", "shader", "datapack"]) {
    for (const item of all[kind] || []) {
      if (!item.valid || item.folder) continue;
      try {
        const sha1 = await cachedSha1(path.join(folderFor(gameDir, kind, item.world), item.file));
        const key = `${kind}/${item.world || ""}/${item.file}`;
        if (!byHash.has(sha1)) byHash.set(sha1, []);
        byHash.get(sha1).push(key);
      } catch {
        // locked or vanished mid-read - skip it this time
      }
    }
  }

  const stale = [...byHash.keys()].filter((h) => {
    const c = disk[h];
    if (!c) return true;
    if (c.ownerFailed) return true; // last time the owner lookup failed - ask again
    if (!c.none && c.v !== 2) return true; // older cache entries lack categories / dependencies
    return now - c.at > (c.none ? NOT_ON_MODRINTH_TTL_MS : CREATORS_TTL_MS);
  });

  if (stale.length) {
    try {
      const versions = {};
      for (const part of chunk(stale, 200)) Object.assign(versions, (await modrinth.getVersionsFromHashes(part, "sha1")) || {});
      const projectIds = [...new Set(Object.values(versions).map((v) => v && v.project_id).filter(Boolean))];
      const projects = new Map();
      for (const part of chunk(projectIds, 100)) for (const p of (await modrinth.getProjects(part)) || []) projects.set(p.id, p);

      const teamIds = [...new Set([...projects.values()].filter((p) => !p.organization && p.team).map((p) => p.team))];
      const orgIds = [...new Set([...projects.values()].map((p) => p.organization).filter(Boolean))];
      const owners = new Map(); // team id -> member
      const failedLookups = new Set(); // team / organisation ids we couldn't ask about this round
      for (const part of chunk(teamIds, 100)) {
        try {
          for (const members of (await modrinth.getTeams(part)) || []) {
            const owner = pickOwner(members);
            const teamId = owner ? owner.team_id : Array.isArray(members) && members[0] && members[0].team_id;
            if (teamId && owner) owners.set(teamId, owner);
          }
        } catch {
          // no owners this round - names still come from the jar
          for (const id of part) failedLookups.add(id);
        }
      }
      const orgs = new Map();
      for (const part of chunk(orgIds, 100)) {
        try {
          for (const o of (await modrinth.getOrganizations(part)) || []) if (o && o.id) orgs.set(o.id, o);
        } catch {
          // no organisation names this round
          for (const id of part) failedLookups.add(id);
        }
      }

      for (const hash of stale) {
        const v = versions[hash];
        const p = v && projects.get(v.project_id);
        if (!p) {
          disk[hash] = { at: now, none: true };
          continue;
        }
        const org = p.organization && orgs.get(p.organization);
        const owner = owners.get(p.team);
        disk[hash] = {
          v: 2,
          at: now,
          projectId: p.id,
          slug: typeof p.slug === "string" ? p.slug.slice(0, 80) : null,
          categories: (Array.isArray(p.categories) ? p.categories : []).filter((c) => typeof c === "string").slice(0, 12),
          requires: (Array.isArray(v.dependencies) ? v.dependencies : [])
            .filter((d) => d && d.dependency_type === "required" && typeof d.project_id === "string")
            .map((d) => d.project_id)
            .slice(0, 30),
          title: typeof p.title === "string" ? p.title.slice(0, 80) : null,
          iconUrl: httpsImage(p.icon_url),
          author: org ? String(org.name || "").slice(0, 60) || null : owner ? String(owner.user.username || "").slice(0, 60) || null : null,
          avatar: org ? httpsImage(org.icon_url) : owner ? httpsImage(owner.user.avatar_url) : null,
        };
        // "Couldn't find out who owns it" is not "nobody owns it".
        if (failedLookups.has(p.organization || p.team)) disk[hash].ownerFailed = true;
      }
      await saveCreatorsDisk();
    } catch {
      // offline / rate-limited: use whatever's cached
    }
  }

  const out = {};
  for (const [hash, keys] of byHash) {
    const c = disk[hash];
    if (!c || c.none) continue;
    for (const key of keys) {
      out[key] = {
        author: c.author,
        avatar: c.avatar,
        title: c.title,
        iconUrl: c.iconUrl,
        projectId: c.projectId,
        slug: c.slug || null,
        categories: c.categories || [],
        requires: c.requires || [],
      };
    }
  }
  return out;
}

module.exports = {
  KINDS,
  listAll,
  watchInstance,
  unwatch,
  setEnabled,
  remove,
  install,
  checkUpdates,
  applyUpdates,
  lookupCreators,
  pickOwner,
  downloadWithHash,
  readManifest,
  writeManifest,
  updateManifest,
  within,
  sha1File,
  primaryFile,
  readJarMeta,
  // pure, for tests
  parseLooseJson,
  safeFileName,
  loadersFor,
  shaderModsFor,
  parseModsToml,
  manifestVersion,
  kindForProjectType,
  pickVersion,
  versionFitsInstance,
};
