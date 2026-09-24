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

/** Pure: a file name that's safe to write inside a folder (no separators, no reserved names). */
function safeFileName(name) {
  const base = path.basename(String(name || "")).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
  if (!base || base === "." || base === ".." || /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(base)) {
    throw new Error("Refused an unusable file name.");
  }
  return base.slice(0, 200);
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

async function readManifest(gameDir) {
  try {
    const parsed = JSON.parse(await fsp.readFile(manifestPath(gameDir), "utf8"));
    return parsed && typeof parsed.files === "object" ? parsed : { files: {} };
  } catch {
    return { files: {} };
  }
}

async function writeManifest(gameDir, manifest) {
  const file = manifestPath(gameDir);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(manifest, null, 2));
  await fsp.rename(tmp, file);
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
  };
}

/** Pure: Implementation-Version from a jar manifest (what Forge's ${file.jarVersion} means). */
function manifestVersion(text) {
  const m = String(text || "").replace(/\r?\n /g, "").match(/^Implementation-Version:\s*(.+?)\s*$/m);
  return m ? m[1] : null;
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
      if (raw) json = JSON.parse(raw.toString("utf8").replace(/^﻿/, ""));
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
              const parsed = JSON.parse(info.toString("utf8").replace(/^﻿/, ""));
              const first = Array.isArray(parsed) ? parsed[0] : parsed && Array.isArray(parsed.modList) ? parsed.modList[0] : null;
              if (first) json = { id: first.modid, name: first.name, version: first.version, description: first.description, icon: first.logoFile };
            } catch {
              // malformed mcmod.info - list by file name
            }
          }
        }
        if (json && typeof json.icon === "string") json.icon = json.icon.replace(/^\/+/, "");
      }
      if (json && json.quilt_loader) {
        const q = json.quilt_loader;
        json = { id: q.id, name: q.metadata && q.metadata.name, version: q.version, icon: q.metadata && q.metadata.icon, description: q.metadata && q.metadata.description };
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
          icon,
        };
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

/**
 * Watches one instance's content folders and calls onChange() (debounced)
 * whenever something is added, removed or renamed - so the lists update the
 * moment a file lands, with no refresh needed. Calling again re-targets the
 * watch (e.g. when the player switches instance).
 */
async function watchInstance(gameDir, onChange) {
  unwatch();
  const fire = () => {
    clearTimeout(watchTimer);
    watchTimer = setTimeout(onChange, 250);
  };
  for (const folder of ["mods", "resourcepacks", "shaderpacks", "saves"]) {
    const dir = path.join(gameDir, folder);
    try {
      await fsp.mkdir(dir, { recursive: true });
      // recursive on the saves folder so a data pack dropped into
      // saves/<world>/datapacks is seen too (Windows supports this natively)
      watchers.push(fs.watch(dir, { recursive: folder === "saves" }, fire));
    } catch {
      // a folder we can't watch just means that list refreshes on page open
    }
  }
}

function unwatch() {
  for (const w of watchers) {
    try {
      w.close();
    } catch {
      // already closed
    }
  }
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
  const manifest = await readManifest(gameDir);
  delete manifest.files[relKey(gameDir, full.replace(/\.disabled$/i, ""))];
  await writeManifest(gameDir, manifest);
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

async function downloadWithHash(url, dest, sha1, onBytes) {
  const res = await fetch(url, { headers: { "User-Agent": modrinth.USER_AGENT } });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const total = Number(res.headers.get("content-length")) || 0;
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.part`;
  const out = fs.createWriteStream(tmp);
  const hash = crypto.createHash("sha1");
  let received = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      received += value.length;
      if (!out.write(value)) await new Promise((r) => out.once("drain", r));
      onBytes && onBytes(received, total);
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    const actual = hash.digest("hex");
    if (sha1 && actual !== String(sha1).toLowerCase()) {
      throw new Error("Checksum mismatch - the download was corrupted or altered.");
    }
    await fsp.rename(tmp, dest);
  } catch (err) {
    out.destroy();
    await fsp.rm(tmp, { force: true });
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* installing                                                         */
/* ------------------------------------------------------------------ */

/** Modrinth project ids of the mod jars in an instance, looked up by sha1. Never throws. */
async function modProjectsOnDisk(gameDir) {
  const out = new Set();
  const dir = path.join(gameDir, "mods");
  let names;
  try {
    names = (await fsp.readdir(dir)).filter((n) => /\.jar(\.disabled)?$/i.test(n));
  } catch {
    return out;
  }
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

function primaryFile(version) {
  const files = (version && version.files) || [];
  return files.find((f) => f.primary) || files[0] || null;
}

/**
 * Installs a project (and, for mods, its required dependencies) into an
 * instance. `onProgress({ stage, current, total })`.
 * Returns { installed: [{ title, file }], skipped: [...] }.
 */
async function install(instance, { projectId, kind, world, versionId }, onProgress) {
  const report = (stage, current = 0, total = 1) => onProgress && onProgress({ stage, current, total });
  if (!KINDS[kind]) throw new Error("That kind of content can't be installed into an instance.");
  if (kind === "mod" && !loadersFor("mod", instance).length) {
    throw new Error("Mods need a mod loader - this instance is plain vanilla. Change it to Fabric, Quilt, Forge or NeoForge first.");
  }
  const gameDir = instance.gameDir;
  const manifest = await readManifest(gameDir);
  const installed = [];
  const skipped = [];
  const visited = new Set();

  // Every mod already on disk - Reminth-installed or dropped in by hand -
  // resolved to its Modrinth project by file hash, so a dependency that's
  // already there (Fabric API, most often) is never downloaded twice.
  const onDisk = kind === "mod" || kind === "shader" ? await modProjectsOnDisk(gameDir) : new Set();
  const haveTracked = (pid) => Object.values(manifest.files).some((f) => f.projectId === pid);
  const haveProject = (pid) =>
    onDisk.has(pid) ||
    Object.values(manifest.files).some((f) => f.projectId === pid && (f.kind === "mod" || f.kind === kind) && (kind !== "datapack" || f.world === world));

  // Shader packs need a shader-loading mod (Iris, or Oculus on Forge);
  // install one in the same click if it isn't there.
  if (kind === "shader") {
    const candidates = shaderModsFor(instance);
    if (!candidates.length) {
      throw new Error("Shader packs need a mod loader - this instance is plain vanilla. Change it to Fabric, Quilt, Forge or NeoForge first.");
    }
    let has = candidates.some((id) => haveProject(id));
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
  await writeManifest(gameDir, manifest);
  report("Done", 1, 1);
  return { installed, skipped };

  async function installOne(pid, k, w, vid, isDependency) {
    if (visited.has(pid + ":" + k)) return;
    visited.add(pid + ":" + k);
    if (isDependency && haveProject(pid)) {
      skipped.push(pid);
      return;
    }
    const project = await modrinth.getProject(pid);
    // Already there as a file Reminth didn't install (dropped in by hand, or
    // part of a modpack): don't add a second copy next to it.
    if (!isDependency && k === "mod" && onDisk.has(project.id) && !haveTracked(project.id)) {
      throw new Error(`${project.title} is already in this instance's mods folder.`);
    }
    let version;
    if (vid) {
      // A version the player picked in the version chooser.
      version = await modrinth.getVersion(vid);
      if (version && version.project_id !== project.id) throw new Error(`That version doesn't belong to ${project.title}.`);
    } else {
      const versions = await modrinth.getProjectVersions(project.id, {
        loaders: loadersFor(k, instance),
        gameVersions: [instance.mcVersion],
      });
      version = pickVersion(versions);
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
    await downloadVerified(file.url, dest, file.hashes && file.hashes.sha1, (got, total) =>
      report(`Downloading ${project.title}`, got, total || file.size || 1)
    );

    // Replace an older copy of the same project Reminth installed earlier.
    for (const [key, entry] of Object.entries(manifest.files)) {
      if (entry.projectId === project.id && entry.kind === k && (k !== "datapack" || entry.world === w)) {
        const oldFull = within(gameDir, key);
        if (oldFull !== dest) {
          await fsp.rm(oldFull, { force: true });
          await fsp.rm(oldFull + ".disabled", { force: true });
        }
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
    installed.push({ title: project.title, file: path.basename(dest) });

    if (k === "mod") {
      for (const dep of version.dependencies || []) {
        if (dep.dependency_type !== "required" || !dep.project_id) continue;
        await installOne(dep.project_id, "mod", null, null, true);
      }
    }
  }
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

/** Applies a list of updates from checkUpdates. onProgress gets overall byte progress. */
async function applyUpdates(instance, updates, onProgress) {
  const gameDir = instance.gameDir;
  const manifest = await readManifest(gameDir);
  const total = updates.reduce((sum, u) => sum + (u.next.size || 0), 0) || updates.length;
  let doneBytes = 0;
  const applied = [];
  const failed = [];
  for (const u of updates) {
    try {
      const dir = folderFor(gameDir, u.kind, u.world);
      const oldFull = within(dir, safeFileName(u.file));
      let newName = safeFileName(u.next.filename);
      if (!u.enabled) newName += ".disabled"; // keep a disabled mod disabled
      const dest = within(dir, newName);
      const base = doneBytes;
      await downloadVerified(u.next.url, dest, u.next.sha1, (got) =>
        onProgress && onProgress({ stage: `Updating ${u.title}`, current: base + got, total })
      );
      doneBytes += u.next.size || 1;
      if (oldFull !== dest) await fsp.rm(oldFull, { force: true });
      delete manifest.files[relKey(gameDir, oldFull.replace(/\.disabled$/i, ""))];
      manifest.files[relKey(gameDir, dest.replace(/\.disabled$/i, ""))] = {
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
      applied.push(u.title);
    } catch (err) {
      failed.push({ title: u.title, error: err.message });
    }
  }
  await writeManifest(gameDir, manifest);
  onProgress && onProgress({ stage: "Done", current: total, total });
  return { applied, failed };
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
  downloadWithHash,
  readManifest,
  writeManifest,
  within,
  // pure, for tests
  safeFileName,
  loadersFor,
  shaderModsFor,
  parseModsToml,
  manifestVersion,
  kindForProjectType,
  pickVersion,
};
