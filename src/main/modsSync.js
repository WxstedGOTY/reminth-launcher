"use strict";
/**
 * "Update mods to fit <version>": one click that swaps every enabled mod
 * that won't load on the instance's Minecraft version or loader - or is only
 * listed for another Minecraft version ("may not work") - to the newest
 * STABLE build made for exactly that version and loader.
 *
 * What it never does:
 *  - pick a beta or alpha. The compatibility panel's own "Switch to" fix
 *    comes from Modrinth's update lookup, which ignores the channel, so it
 *    isn't used here; builds are chosen with pickStableBuild instead, and
 *    the dependencies an update pulls in go through applyUpdates with
 *    releaseOnly.
 *  - touch a mod that has no stable build. Those come back in `noBuild` and
 *    the player decides (switch off, or find another Minecraft version).
 *  - touch Reminth's own jars (performance pack, HUD, Fabric API): compat
 *    never reports them, and they are swapped at launch anyway.
 *  - lose the player's jar: content.applyUpdates copies each old file to
 *    <instance>/.reminth/replaced-mods/<time>/ before replacing it (every
 *    update path does), so going back to the old version is a copy back.
 */
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const BACKUP_DIR = path.join(".reminth", "replaced-mods");
const BACKUPS_KEPT = 5;
const LOOKUP_CONCURRENCY = 4;

/**
 * Pure: the compat issues this button is about - enabled mods built for
 * another Minecraft version (when that stops the game, or when the build is
 * only LISTED for another version - "may not work", which can crash the game
 * in play) or another loader (they do nothing there). Not missing
 * dependencies, duplicates or clashes: a newer build doesn't fix those, and
 * the panel has its own fixes for them. A "may not work" mod is only ever
 * swapped for a stable build of exactly this version (planSync); without
 * one it is listed in noBuild and left as it is.
 */
function syncCandidates(issues) {
  return (Array.isArray(issues) ? issues : []).filter(
    (i) => i && i.file && ((i.reason === "wrong-mc" && (i.severity === "blocked" || i.listedElsewhere === true)) || i.reason === "wrong-loader")
  );
}

/** Pure: does a Modrinth version list this Minecraft version and one of these loaders? */
function versionFits(version, mcVersion, loaders) {
  const games = Array.isArray(version.game_versions) ? version.game_versions : [];
  const vl = Array.isArray(version.loaders) ? version.loaders : [];
  return games.includes(mcVersion) && (!loaders.length || vl.some((l) => loaders.includes(l)));
}

/**
 * Pure: the newest release build of a project for exactly this Minecraft
 * version and loader, or null. Never a beta or alpha, whatever else exists.
 */
function pickStableBuild(versions, mcVersion, loaders) {
  const fits = (Array.isArray(versions) ? versions : []).filter(
    (v) => v && v.version_type === "release" && versionFits(v, mcVersion, loaders || [])
  );
  fits.sort((a, b) => String(b.date_published || "").localeCompare(String(a.date_published || "")));
  return fits[0] || null;
}

/** Pure: the primary file of a version (the one Modrinth marks, else the first). */
function primaryFile(version) {
  const files = (version && version.files) || [];
  return files.find((f) => f && f.primary) || files[0] || null;
}

/** Pure: an entry content.applyUpdates understands, replacing `issue.file` with `version`. */
function buildUpdate(issue, version) {
  const file = primaryFile(version);
  if (!file || !file.url || !file.hashes || !file.hashes.sha1 || !file.filename) return null;
  return {
    kind: "mod",
    world: null,
    file: issue.file,
    enabled: true,
    projectId: version.project_id,
    title: issue.title,
    iconUrl: issue.iconUrl || null,
    current: null,
    next: {
      versionId: version.id,
      versionNumber: version.version_number,
      url: file.url,
      sha1: file.hashes.sha1,
      filename: file.filename,
      size: file.size || 0,
    },
  };
}

const sameName = (a, b) => String(a || "").replace(/\.disabled$/i, "").toLowerCase() === String(b || "").replace(/\.disabled$/i, "").toLowerCase();

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Works out what the button would do for an instance. Returns
 * { online, mcVersion, loader, count,
 *   updates:   [applyUpdates entries],
 *   noBuild:   [{ file, title, why }]   - no stable build: left alone,
 *   unchecked: [{ file, title }] }      - Modrinth couldn't be asked about it
 * deps (tests): { check(instance), api: { getProjectVersions }, loadersFor(kind, instance) }.
 * options.files: only these mod files (the Play warning's "Fix and play",
 * a crash notice's "Fix it"); the same rules otherwise.
 */
async function planSync(instance, deps = {}, options = {}) {
  const compat = deps.check ? null : require("./compat");
  const content = deps.loadersFor ? null : require("./content");
  const api = deps.api || require("./modrinth");
  const loadersFor = deps.loadersFor || content.loadersFor;
  const out = { online: true, mcVersion: instance.mcVersion, loader: instance.loader, count: 0, updates: [], noBuild: [], unchecked: [] };
  if (!instance || instance.loader === "vanilla") return out;
  const check = deps.check ? await deps.check(instance) : await compat.checkInstance(instance, { force: true });
  const only = Array.isArray(options.files) ? new Set(options.files.map(String)) : null;
  const candidates = syncCandidates(check && check.issues).filter((i) => !only || only.has(i.file));
  out.count = candidates.length;
  out.online = Boolean(check && check.online !== false);
  if (!candidates.length) return out;
  const loaders = loadersFor("mod", instance);
  // One project can show up twice (two copies of a mod): looked up once.
  const lookups = new Map();
  const lookup = (projectId) => {
    if (!lookups.has(projectId)) lookups.set(projectId, Promise.resolve().then(() => api.getProjectVersions(projectId, { loaders, gameVersions: [instance.mcVersion] })));
    return lookups.get(projectId);
  };
  await mapLimit(candidates, LOOKUP_CONCURRENCY, async (issue) => {
    const row = { file: issue.file, title: issue.title };
    if (!issue.projectId) {
      out.noBuild.push({ ...row, why: "Not on Modrinth, so Reminth can't look for another build" });
      return;
    }
    let versions;
    try {
      versions = await lookup(issue.projectId);
    } catch {
      out.unchecked.push(row);
      return;
    }
    const best = pickStableBuild(versions, instance.mcVersion, loaders);
    const update = best ? buildUpdate(issue, best) : null;
    if (!update) {
      out.noBuild.push({ ...row, why: `No stable build for ${instance.mcVersion} yet` });
    } else if (sameName(update.next.filename, issue.file)) {
      // Modrinth lists this very file for the version, but the jar itself
      // says otherwise - a newer copy of the same file won't change that.
      out.noBuild.push({ ...row, why: `The newest stable build for ${instance.mcVersion} is the one you have` });
    } else {
      out.updates.push(update);
    }
  });
  if (out.unchecked.length) out.online = false;
  // In the order the player sees them in the panel.
  const order = new Map(candidates.map((c, i) => [c.file, i]));
  for (const list of [out.updates, out.noBuild, out.unchecked]) list.sort((a, b) => order.get(a.file) - order.get(b.file));
  return out;
}

/** Pure: a folder name for this moment that sorts by time and is safe on Windows. */
function backupStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

/**
 * Copies the jars about to be replaced into .reminth/replaced-mods/<time>/
 * and keeps only the newest few of those folders. Returns the folder (or
 * null when nothing was copied). Best effort, one file at a time: a copy
 * that fails is handed to `onError(name, err)` and the rest go on - an
 * update is never held up by its backup. (listAll only reads mods/ and
 * the pack folders, so nothing in here is ever taken for a mod.)
 */
async function backupJars(gameDir, files, now = new Date(), { onError } = {}) {
  const modsDir = path.join(gameDir, "mods");
  const root = path.join(gameDir, BACKUP_DIR);
  const dir = path.join(root, backupStamp(now));
  let copied = 0;
  for (const name of files) {
    const base = path.basename(String(name || ""));
    if (!base || base !== String(name)) continue; // only plain names inside mods/
    for (const candidate of [base, base.replace(/\.disabled$/i, ""), base.replace(/\.disabled$/i, "") + ".disabled"]) {
      const from = path.join(modsDir, candidate);
      try {
        await fsp.access(from);
      } catch {
        continue;
      }
      try {
        await fsp.mkdir(dir, { recursive: true });
        await fsp.copyFile(from, path.join(dir, candidate));
        copied++;
      } catch (err) {
        if (onError) onError(candidate, err);
      }
      break;
    }
  }
  if (!copied) return null;
  try {
    // The copy just made always stays: with the PC clock behind, its name
    // sorts as the oldest and it used to be the one pruned.
    const old = (await fsp.readdir(root)).filter((name) => name !== path.basename(dir)).sort();
    for (const name of old.slice(0, Math.max(0, old.length - (BACKUPS_KEPT - 1)))) {
      await fsp.rm(path.join(root, name), { recursive: true, force: true });
    }
  } catch {
    // tidying old copies is housekeeping only
  }
  return dir;
}

/**
 * The button: plan, copy the old jars aside, apply the stable builds.
 * Returns { applied, failed, added, warnings, noBuild, unchecked, online, count, backupDir }.
 * deps (tests): planSync's, plus { applyUpdates, invalidate }. options: planSync's.
 */
async function applySync(instance, onProgress, deps = {}, options = {}) {
  const plan = await planSync(instance, deps, options);
  const result = { applied: [], failed: [], added: [], warnings: [], noBuild: plan.noBuild, unchecked: plan.unchecked, online: plan.online, count: plan.count, backupDir: null };
  if (plan.updates.length) {
    // content.applyUpdates keeps a copy of every jar it replaces (backupJars).
    const applyUpdates = deps.applyUpdates || require("./content").applyUpdates;
    const r = await applyUpdates(instance, plan.updates, onProgress, { releaseOnly: true });
    result.backupDir = r.backupDir || null;
    result.applied = r.applied || [];
    result.failed = r.failed || [];
    result.added = r.added || [];
    result.warnings = r.warnings || [];
  }
  const invalidate = deps.invalidate || require("./compat").invalidate;
  invalidate(instance.id);
  return result;
}

module.exports = {
  planSync,
  applySync,
  backupJars,
  // pure, for tests
  syncCandidates,
  pickStableBuild,
  buildUpdate,
  backupStamp,
  BACKUP_DIR,
};
