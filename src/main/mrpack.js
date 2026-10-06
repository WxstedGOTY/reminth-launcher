"use strict";
/**
 * Installs a Modrinth modpack (.mrpack) as a brand-new instance.
 *
 * A .mrpack is a zip holding modrinth.index.json (which Minecraft version,
 * which loader, and a list of files to download with their hashes) plus
 * "overrides" folders copied straight into the game folder. Spec:
 * https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack
 *
 * Everything in the index is someone else's data, so: every path must stay
 * inside the new instance's folder, every download must come from a host
 * the spec allows, and every file must match its sha1 before it's kept.
 * Packs for every loader Reminth runs are accepted: Fabric, Quilt, Forge,
 * NeoForge and plain vanilla.
 */
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");

const modrinth = require("./modrinth");
const content = require("./content");
const instances = require("./instances");
const zipread = require("./zipread");
const { runPool } = require("./downloader");
const config = require("./config");

// The hosts the .mrpack format allows file downloads from.
const ALLOWED_PACK_HOSTS = [/^cdn\.modrinth\.com$/i, /^github\.com$/i, /^raw\.githubusercontent\.com$/i, /^gitlab\.com$/i];

/** Pure: which Reminth loader a pack's dependencies map to, or an error message. */
function loaderFromDependencies(deps) {
  const d = deps || {};
  if (!d.minecraft) return { error: "This pack doesn't say which Minecraft version it's for." };
  const mcVersion = String(d.minecraft);
  if (d.neoforge) return { loader: "neoforge", loaderVersion: String(d.neoforge), mcVersion };
  if (d.forge) return { loader: "forge", loaderVersion: String(d.forge), mcVersion };
  if (d["quilt-loader"]) return { loader: "quilt", loaderVersion: String(d["quilt-loader"]), mcVersion };
  if (d["fabric-loader"]) return { loader: "fabric", loaderVersion: String(d["fabric-loader"]), mcVersion };
  return { loader: "vanilla", loaderVersion: null, mcVersion };
}

/** Pure: true if a zip entry name could write outside the extraction dir (absolute, drive letter, or a ".." segment). */
function isUnsafeEntryName(name) {
  const n = String(name || "").replace(/\\/g, "/");
  if (!n || n.startsWith("/") || /^[a-zA-Z]:/.test(n)) return true;
  return n.split("/").some((seg) => seg === "..");
}

/** Throws if the pack contains anything extract-zip could be tricked into writing outside its target dir. */
function assertNoUnsafeEntries(entryList) {
  const bad = entryList.filter((e) => e.isSymlink || isUnsafeEntryName(e.name));
  if (bad.length) {
    const sample = bad.slice(0, 5).map((e) => e.name).join(", ");
    throw new Error(`This pack contains unsafe archive entries (symlinks or paths that escape the pack): ${sample}. Refusing to install it.`);
  }
}

// How much a pack's own files (overrides) may unpack to. Real packs are a
// few hundred MB at the very most; without a ceiling a tiny crafted
// .mrpack that claims terabytes of zeros would fill the disk.
const MAX_UNPACKED_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_PACK_ENTRIES = 200000;

/** Throws if the archive would unpack to more than a pack reasonably holds. Sizes are the ones the archive declares. */
function assertReasonableSize(entryList) {
  if (entryList.length > MAX_PACK_ENTRIES) {
    throw new Error(`This pack holds ${entryList.length} files, more than any real modpack. Refusing to unpack it.`);
  }
  let total = 0;
  for (const e of entryList) total += Number(e.size) || 0;
  if (total > MAX_UNPACKED_BYTES) {
    throw new Error(`This pack would unpack to ${(total / 1024 ** 3).toFixed(1)} GB, more than the ${MAX_UNPACKED_BYTES / 1024 ** 3} GB limit. Refusing to unpack it.`);
  }
}

/** Pure: true if a pack file path lands in the instance's ".reminth" folder, however it is spelled. */
function isReminthPath(rel) {
  // Resolved the way the file system will: "./.reminth/x" and
  // "mods/../.reminth/x" are the same folder. Windows also treats
  // ".Reminth" and ".reminth. " as that folder (case, trailing dots/spaces).
  const first = path.posix.normalize(String(rel || "").replace(/\\/g, "/")).split("/").find((seg) => seg && seg !== ".");
  return /^\.reminth[. ]*$/i.test(first || "");
}

/**
 * Throws if any file the pack lists would be written into ".reminth". That
 * folder is Reminth's own bookkeeping (which files it may update or delete);
 * copyTree already keeps overrides out of it, and the download list must not
 * be a second way in.
 */
function assertNoReminthPaths(files) {
  const bad = (Array.isArray(files) ? files : []).find((f) => f && isReminthPath(f.path));
  if (bad) throw new Error(`This modpack tries to write into Reminth's own folder (${String(bad.path).slice(0, 80)}). Refusing to install it.`);
}

function assertPackUrl(url) {
  const parsed = new URL(String(url));
  if (parsed.protocol !== "https:" || !ALLOWED_PACK_HOSTS.some((re) => re.test(parsed.hostname))) {
    throw new Error(`The pack asked for a file from ${parsed.hostname}, which isn't an allowed host.`);
  }
  return parsed.href;
}

/**
 * Picks the pack version to install: `versionId` if given, otherwise the
 * newest release (or newest of anything, if the pack has no releases).
 */
async function resolveVersion(projectId, versionId) {
  if (versionId) return modrinth.getVersion(versionId);
  const versions = await modrinth.getProjectVersions(projectId, {});
  const pick = versions.find((v) => v.version_type === "release") || versions[0];
  if (!pick) throw new Error("This pack has no versions to install.");
  return pick;
}

/** An error that means "the player pressed Cancel" (code CANCELLED), not a failure. */
function cancelledError() {
  const err = new Error("Cancelled.");
  err.code = "CANCELLED";
  return err;
}
function throwIfCancelled(signal) {
  if (signal && signal.aborted) throw cancelledError();
}

/**
 * Pure: can a pack for `target` ({ loader, mcVersion }) go into this existing instance? A pack's mods are built
 * for exactly its Minecraft version and loader, so both must be the same. { ok, why }.
 */
function packFitsInstance(target, inst) {
  if (!target || !inst) return { ok: false, why: "Unknown pack or instance." };
  const names = { fabric: "Fabric", quilt: "Quilt", forge: "Forge", neoforge: "NeoForge", vanilla: "no mod loader" };
  if (target.loader !== inst.loader) {
    return { ok: false, why: `The pack is for ${names[target.loader] || target.loader}, this instance uses ${names[inst.loader] || inst.loader}.` };
  }
  if (String(target.mcVersion) !== String(inst.mcVersion)) {
    return { ok: false, why: `The pack is for Minecraft ${target.mcVersion}, this instance is on ${inst.mcVersion}.` };
  }
  return { ok: true, why: null };
}

/**
 * What a pack version is for, from its Modrinth listing (no download): { mcVersion, loader, title, versionNumber }.
 * Used to grey out the instances it can't go into; the pack's own index is checked again before anything is added.
 */
async function packTarget(projectId, versionId) {
  const project = await modrinth.getProject(projectId);
  const version = await resolveVersion(project.id, versionId);
  const loaders = Array.isArray(version.loaders) ? version.loaders : [];
  const loader = ["neoforge", "forge", "quilt", "fabric"].find((l) => loaders.includes(l)) || "vanilla";
  const games = Array.isArray(version.game_versions) ? version.game_versions : [];
  return { mcVersion: games.length === 1 ? games[0] : games[games.length - 1] || null, loader, title: project.title, versionNumber: version.version_number };
}

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Mod ids of the jars already in a mods folder (Reminth's own performance-pack copies left out: they step aside). */
async function existingModIds(gameDir) {
  const ids = new Map(); // modId -> file name
  const modsDir = path.join(gameDir, "mods");
  // Reminth's own performance-pack jars step aside for a copy the player brings (minecraft.js), so they are no
  // clash; Fabric API and Reminth's bundled mods stay, so a pack's copy of those goes aside instead.
  const managed = new Set();
  try {
    const parsed = JSON.parse(await fsp.readFile(path.join(gameDir, ".reminth", "managed-mods.json"), "utf8"));
    for (const [file, info] of Object.entries((parsed && parsed.files) || {})) {
      const mod = info && typeof info.mod === "string" ? info.mod : "";
      if (mod && mod !== "fabric-api" && !config.bundledMod(mod)) managed.add(file.toLowerCase());
    }
  } catch {
    // no list yet
  }
  let names = [];
  try {
    names = await fsp.readdir(modsDir);
  } catch {
    return ids;
  }
  for (const name of names) {
    if (!/\.jar$/i.test(name) || managed.has(name.toLowerCase())) continue;
    try {
      const full = path.join(modsDir, name);
      const meta = await content.readJarMeta(full, await fsp.stat(full));
      if (meta && meta.modId) ids.set(meta.modId, name);
    } catch {
      // unreadable jar: not a clash we can see
    }
  }
  return ids;
}

/**
 * Downloads and checks a pack (the .mrpack itself, its index). Returns { project, version, tmpDir, packPath, index,
 * target }; the caller removes tmpDir.
 */
async function fetchPack(projectId, versionId, report, signal) {
  report("Reading modpack", 0, 1);
  const project = await modrinth.getProject(projectId);
  const version = await resolveVersion(project.id, versionId);
  const packFile = (version.files || []).find((f) => f.primary) || (version.files || [])[0];
  if (!packFile || !/\.mrpack$/i.test(packFile.filename)) throw new Error("That version has no .mrpack file.");
  throwIfCancelled(signal);
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "reminth-pack-"));
  const packPath = path.join(tmpDir, "pack.mrpack");
  try {
    await content.downloadWithHash(
      assertPackUrl(packFile.url),
      packPath,
      packFile.hashes && packFile.hashes.sha1,
      (got, total) => report(`Downloading ${project.title}`, got, total || packFile.size || 1),
      { signal }
    );
    throwIfCancelled(signal);
    // strict: this archive is handed to extract-zip later, so the scan must
    // see exactly the entries that will be unpacked (see zipread.openZip).
    const zip = await zipread.openZip(packPath, { strict: true });
    let index;
    try {
      // extract-zip (GHSA-jmr9-qjv8-65gv / GHSA-7pqw-9j4j-h8q3) can be tricked
      // by a symlink entry into writing later entries outside extractDir, and
      // unpacks whatever size the archive holds - so the archive is scanned
      // and rejected here, before an instance is made or anything unpacked.
      // (extract-zip's reader stops at an entry that turns out bigger than
      // it declared, so the declared sizes are what can reach the disk.)
      const entryList = zip.list();
      assertNoUnsafeEntries(entryList);
      assertReasonableSize(entryList);
      const raw = await zip.read("modrinth.index.json");
      if (!raw) throw new Error("This file isn't a Modrinth modpack (no modrinth.index.json).");
      index = JSON.parse(raw.toString("utf8"));
    } finally {
      await zip.close();
    }
    if (index.game !== "minecraft") throw new Error("This pack isn't for Minecraft: Java Edition.");
    const target = loaderFromDependencies(index.dependencies);
    if (target.error) throw new Error(target.error);
    if (!instances.isValidVersionId(target.mcVersion)) throw new Error("The pack names an invalid Minecraft version.");
    // Checked before the instance exists or a single file is fetched.
    assertNoReminthPaths(index.files);
    return { project, version, tmpDir, packPath, index, target };
  } catch (err) {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

/** The pack's download list without client-unsupported files, each with its checked https URL. */
function packFiles(index) {
  const files = (index.files || []).filter((f) => !(f.env && f.env.client === "unsupported"));
  return files.map((f) => {
    const url = (f.downloads || [])
      .map((u) => {
        try {
          return assertPackUrl(u);
        } catch {
          return null;
        }
      })
      .find(Boolean);
    if (!url) throw new Error(`${f.path} has no download from an allowed host.`);
    if (!f.hashes || !/^[0-9a-f]{40}$/i.test(f.hashes.sha1 || "")) throw new Error(`${f.path} has no sha1 to check it against.`);
    return { path: String(f.path || ""), url, sha1: f.hashes.sha1 };
  });
}

/**
 * Downloads a pack and creates an instance from it.
 * onProgress({ stage, current, total }); opts.signal (AbortSignal) cancels: the download stops and the half-made
 * instance (folder included) is removed. Returns the new instance.
 */
async function installModpack({ projectId, versionId, name }, onProgress, { signal } = {}) {
  const report = (stage, current = 0, total = 1) => onProgress && onProgress({ stage, current, total });
  const { project, version, tmpDir, packPath, index, target } = await fetchPack(projectId, versionId, report, signal);
  let instance = null;
  try {
    throwIfCancelled(signal);
    instance = await instances.create({
      name: name || project.title,
      mcVersion: target.mcVersion,
      loader: target.loader,
      loaderVersion: target.loaderVersion,
      // The pack's author already chose its mods (often their own Sodium
      // fork or a different renderer): Reminth's performance pack isn't
      // added on top. The player can switch it on in the instance's settings.
      performanceMods: false,
      modpack: {
        projectId: project.id,
        versionId: version.id,
        title: project.title,
        versionNumber: version.version_number,
        iconUrl: project.icon_url || null,
      },
    });
    const gameDir = instance.gameDir;

    // 1. The file list.
    const files = packFiles(index);
    let done = 0;
    await runPool(files, 6, async (f) => {
      throwIfCancelled(signal);
      await content.downloadWithHash(f.url, content.within(gameDir, f.path), f.sha1, null, { signal });
      done++;
      report(`Downloading ${project.title} files`, done, files.length);
    });
    throwIfCancelled(signal);

    // 2. overrides/ then client-overrides/ (the second wins on conflicts, per spec).
    report("Copying pack settings", 0, 1);
    // (The archive was scanned for unsafe entries and size above.)
    const extractDir = path.join(tmpDir, "x");
    const extractZip = require("extract-zip");
    await extractZip(packPath, { dir: extractDir });
    for (const folder of ["overrides", "client-overrides"]) {
      throwIfCancelled(signal);
      await copyTree(path.join(extractDir, folder), gameDir);
    }

    // Remember what the pack installed so the instance's lists show real names.
    await content.updateManifest(gameDir, (manifest) => {
      for (const f of files) {
        const rel = f.path.split("\\").join("/");
        const kind = rel.startsWith("mods/") ? "mod" : rel.startsWith("resourcepacks/") ? "resourcepack" : rel.startsWith("shaderpacks/") ? "shader" : null;
        if (kind) manifest.files[rel] = { kind, world: null, projectId: null, versionId: null, versionNumber: null, title: null, iconUrl: null, sha1: f.sha1, installedAt: Date.now(), fromPack: project.id };
      }
    });

    report("Done", 1, 1);
    return instance;
  } catch (err) {
    // A half-installed pack is worse than none (and Cancel means "nothing"): remove the instance it made.
    if (instance) await instances.remove(instance.id).catch(() => {});
    throw signal && signal.aborted ? cancelledError() : err;
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Adds a pack's files to an EXISTING instance with the same Minecraft version and loader. Nothing of the player's is
 * overwritten: a file that is already there (or switched off as .disabled), or a mod whose id the instance already
 * has, keeps the player's copy and the pack's copy goes to .reminth/modpack-clashes/<pack>-<time>/ instead. The
 * added mods are recorded as the player's own (never in managed-mods.json), so Reminth never removes them. On an
 * error or Cancel every file this run added is removed again; nothing that was there before is touched.
 * Returns { instance, added, clashes: [paths], clashDir }.
 */
async function installModpackInto(inst, { projectId, versionId }, onProgress, { signal } = {}) {
  const report = (stage, current = 0, total = 1) => onProgress && onProgress({ stage, current, total });
  const { project, version, tmpDir, packPath, index, target } = await fetchPack(projectId, versionId, report, signal);
  const gameDir = inst.gameDir;
  const created = []; // every file this run wrote, to undo on error/cancel
  const clashes = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const clashDir = path.join(gameDir, ".reminth", "modpack-clashes", `${content.safeFileName(project.title || "modpack")}-${stamp}`);
  try {
    const fit = packFitsInstance(target, inst);
    if (!fit.ok) throw new Error(fit.why);
    const files = packFiles(index);
    const haveIds = await existingModIds(gameDir);
    let done = 0;
    await runPool(files, 6, async (f) => {
      throwIfCancelled(signal);
      const dest = content.within(gameDir, f.path);
      const taken = (await exists(dest)) || (await exists(dest + ".disabled"));
      const to = taken ? content.within(clashDir, f.path) : dest;
      await content.downloadWithHash(f.url, to, f.sha1, null, { signal });
      created.push(to);
      if (taken) clashes.push(f.path);
      else if (/^mods\/[^/]+\.jar$/i.test(f.path.split("\\").join("/"))) {
        // Same mod under another file name: two copies stop the game. The player's copy wins.
        try {
          const meta = await content.readJarMeta(dest, await fsp.stat(dest));
          if (meta && meta.modId && haveIds.has(meta.modId)) {
            const aside = content.within(clashDir, f.path);
            await fsp.mkdir(path.dirname(aside), { recursive: true });
            await fsp.rename(dest, aside);
            created[created.indexOf(dest)] = aside;
            clashes.push(f.path);
          }
        } catch {
          // can't read it: keep it, like any other mod the player adds
        }
      }
      done++;
      report(`Downloading ${project.title} files`, done, files.length);
    });
    throwIfCancelled(signal);

    report("Copying pack settings", 0, 1);
    const extractDir = path.join(tmpDir, "x");
    const extractZip = require("extract-zip");
    await extractZip(packPath, { dir: extractDir });
    for (const folder of ["overrides", "client-overrides"]) {
      throwIfCancelled(signal);
      await copyTree(path.join(extractDir, folder), gameDir, true, { keepExisting: true, clashRoot: clashDir, created, clashes });
    }

    // The added mods, packs and shaders are the player's own from now on: listed by name, never managed.
    const addedRel = new Set(created.map((p) => path.relative(gameDir, p).split(path.sep).join("/")).filter((r) => !r.startsWith(".reminth/")));
    await content.updateManifest(gameDir, (manifest) => {
      for (const f of files) {
        const rel = f.path.split("\\").join("/");
        if (!addedRel.has(rel)) continue;
        const kind = rel.startsWith("mods/") ? "mod" : rel.startsWith("resourcepacks/") ? "resourcepack" : rel.startsWith("shaderpacks/") ? "shader" : null;
        if (kind) manifest.files[rel] = { kind, world: null, projectId: null, versionId: null, versionNumber: null, title: null, iconUrl: null, sha1: f.sha1, installedAt: Date.now(), fromPack: project.id, playerOwned: true };
      }
    });
    report("Done", 1, 1);
    return { instance: inst, added: addedRel.size, clashes, clashDir: clashes.length ? clashDir : null, title: project.title, versionNumber: version.version_number };
  } catch (err) {
    // Undo: only what this run created. The player's own files were never written to.
    for (const p of created.reverse()) await fsp.rm(p, { force: true }).catch(() => {});
    await fsp.rm(clashDir, { recursive: true, force: true }).catch(() => {});
    throw signal && signal.aborted ? cancelledError() : err;
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Copies a pack's overrides folder into the game folder. A top-level
 * ".reminth" folder is never copied: that is where Reminth keeps its own
 * notes about which files it may update or delete (content.json,
 * managed-mods.json), and a pack must not be able to plant those.
 * With keepExisting (a pack added to an existing instance) a file that is already there is left alone and the
 * pack's copy goes under clashRoot instead; every file written is pushed to `created`.
 */
async function copyTree(src, destRoot, top = true, opts = {}, rel = "") {
  let entries;
  try {
    entries = await fsp.readdir(src, { withFileTypes: true });
  } catch {
    return; // pack has no such folder
  }
  for (const entry of entries) {
    // Any spelling: Windows treats ".Reminth" and ".reminth" as one folder,
    // and ignores trailing dots and spaces in a name.
    if (top && /^\.reminth[. ]*$/i.test(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = content.within(destRoot, entry.name);
    const relHere = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await fsp.mkdir(to, { recursive: true });
      await copyTree(from, to, false, opts, relHere);
    } else if (entry.isFile()) {
      let target = to;
      if (opts.keepExisting && (await exists(to))) {
        target = content.within(opts.clashRoot, relHere);
        if (opts.clashes) opts.clashes.push(relHere);
      }
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.copyFile(from, target, opts.keepExisting ? fs.constants.COPYFILE_EXCL : 0);
      if (opts.created) opts.created.push(target);
    }
  }
}

module.exports = {
  installModpack,
  installModpackInto,
  packFitsInstance,
  packTarget,
  loaderFromDependencies,
  resolveVersion,
  isUnsafeEntryName,
  assertNoUnsafeEntries,
  assertReasonableSize,
  MAX_UNPACKED_BYTES,
  copyTree,
  isReminthPath,
  assertNoReminthPaths,
};
