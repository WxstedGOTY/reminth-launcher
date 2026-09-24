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

/**
 * Downloads a pack and creates an instance from it.
 * onProgress({ stage, current, total }). Returns the new instance.
 */
async function installModpack({ projectId, versionId, name }, onProgress) {
  const report = (stage, current = 0, total = 1) => onProgress && onProgress({ stage, current, total });
  report("Reading modpack", 0, 1);
  const project = await modrinth.getProject(projectId);
  const version = await resolveVersion(project.id, versionId);
  const packFile = (version.files || []).find((f) => f.primary) || (version.files || [])[0];
  if (!packFile || !/\.mrpack$/i.test(packFile.filename)) throw new Error("That version has no .mrpack file.");

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "reminth-pack-"));
  const packPath = path.join(tmpDir, "pack.mrpack");
  let instance = null;
  try {
    await content.downloadWithHash(assertPackUrl(packFile.url), packPath, packFile.hashes && packFile.hashes.sha1, (got, total) =>
      report(`Downloading ${project.title}`, got, total || packFile.size || 1)
    );

    const zip = await zipread.openZip(packPath);
    let index;
    try {
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

    instance = await instances.create({
      name: name || project.title,
      mcVersion: target.mcVersion,
      loader: target.loader,
      loaderVersion: target.loaderVersion,
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
    const files = (index.files || []).filter((f) => !(f.env && f.env.client === "unsupported"));
    let done = 0;
    await runPool(files, 6, async (f) => {
      const dest = content.within(gameDir, String(f.path || ""));
      const url = (f.downloads || []).map((u) => {
        try {
          return assertPackUrl(u);
        } catch {
          return null;
        }
      }).find(Boolean);
      if (!url) throw new Error(`${f.path} has no download from an allowed host.`);
      if (!f.hashes || !/^[0-9a-f]{40}$/i.test(f.hashes.sha1 || "")) throw new Error(`${f.path} has no sha1 to check it against.`);
      await content.downloadWithHash(url, dest, f.hashes.sha1);
      done++;
      report(`Downloading ${project.title} files`, done, files.length);
    });

    // 2. overrides/ then client-overrides/ (the second wins on conflicts, per spec).
    report("Copying pack settings", 0, 1);
    const extractDir = path.join(tmpDir, "x");
    const extractZip = require("extract-zip"); // refuses entries that climb out of extractDir
    await extractZip(packPath, { dir: extractDir });
    for (const folder of ["overrides", "client-overrides"]) {
      await copyTree(path.join(extractDir, folder), gameDir);
    }

    // Remember what the pack installed so the instance's lists show real names.
    const manifest = await content.readManifest(gameDir);
    for (const f of files) {
      const rel = String(f.path).split("\\").join("/");
      const kind = rel.startsWith("mods/") ? "mod" : rel.startsWith("resourcepacks/") ? "resourcepack" : rel.startsWith("shaderpacks/") ? "shader" : null;
      if (kind) manifest.files[rel] = { kind, world: null, projectId: null, versionId: null, versionNumber: null, title: null, iconUrl: null, sha1: f.hashes.sha1, installedAt: Date.now(), fromPack: project.id };
    }
    await content.writeManifest(gameDir, manifest);

    report("Done", 1, 1);
    return instance;
  } catch (err) {
    // A half-installed pack is worse than none: remove the instance it made.
    if (instance) await instances.remove(instance.id).catch(() => {});
    throw err;
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
}

async function copyTree(src, destRoot) {
  let entries;
  try {
    entries = await fsp.readdir(src, { withFileTypes: true });
  } catch {
    return; // pack has no such folder
  }
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = content.within(destRoot, entry.name);
    if (entry.isDirectory()) {
      await fsp.mkdir(to, { recursive: true });
      await copyTree(from, to);
    } else if (entry.isFile()) {
      await fsp.mkdir(path.dirname(to), { recursive: true });
      await fsp.copyFile(from, to);
    }
  }
}

module.exports = { installModpack, loaderFromDependencies, resolveVersion };
