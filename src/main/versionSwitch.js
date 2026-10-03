"use strict";
/**
 * "Switch this instance to <version>" - the other choice next to making a
 * new instance (migrate.copyToVersion). One operation, in the main process:
 *
 *   1. the instance isn't running, isn't a modpack, has mods, and an older
 *      version is never put over its worlds (a world saved in a newer
 *      Minecraft can be damaged by an older one);
 *   2. which of its mods have no stable build for the new version (the same
 *      answer the dialog showed - compat.adviseVersions with `target`) and
 *      which loader version goes with it. Either failing stops everything
 *      before anything has changed;
 *   3. .reminth/version-change.json notes the old and new version (atomic),
 *      so a run that fails half way can be finished ("Update mods to fit")
 *      or undone by hand;
 *   4. the instance itself: mcVersion and loaderVersion, through the
 *      registry's normal queue;
 *   5. the "Update mods to fit" swap (modsSync, stable builds only, every
 *      replaced jar copied to .reminth/replaced-mods first);
 *   6. every mod left without a build is switched OFF (renamed to
 *      .disabled - never deleted) with its reason remembered, so the Mods
 *      tab says "Turned off by Reminth: no version made for 1.21.4".
 *
 * After step 4 the instance IS on the new version; a failure in 5 or 6
 * comes back as `incomplete` (with the note kept), never half-written.
 * Returns { instance, updated: [titles], turnedOff: [{ file, title, why }],
 *           unknown: [titles], kept: [titles], failed: [{ title, error }], incomplete }.
 */
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const NOTE_FILE = path.join(".reminth", "version-change.json");

/** Pure: -1 / 0 / 1 for two release versions, null when either isn't one. */
function compareMc(a, b) {
  const p = (v) => {
    const m = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(String(v || ""));
    return m ? [Number(m[1]), Number(m[2]), Number(m[3] || 0)] : null;
  };
  const pa = p(a);
  const pb = p(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

/** How many worlds an instance has (folders in saves/ with a level.dat). Links aren't followed. */
async function countWorlds(gameDir) {
  let n = 0;
  try {
    for (const entry of await fsp.readdir(path.join(gameDir, "saves"), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        await fsp.access(path.join(gameDir, "saves", entry.name, "level.dat"));
        n++;
      } catch {
        // a folder without a world in it
      }
    }
  } catch {
    // no saves folder
  }
  return n;
}

function realDeps() {
  const atomic = require("./atomic");
  const content = require("./content");
  return {
    instances: require("./instances"),
    advise: (inst, target) => require("./compat").adviseVersions(inst, { target }),
    applySync: (inst, onProgress) => require("./modsSync").applySync(inst, onProgress),
    setEnabled: (gameDir, ref, on) => content.setEnabled(gameDir, ref, on),
    setOffReason: (gameDir, ref, reason) => content.setOffReason(gameDir, ref, reason),
    invalidate: (id) => require("./compat").invalidate(id),
    writeNote: (gameDir, note) => atomic.writeJsonAtomic(path.join(gameDir, NOTE_FILE), note, { space: 2 }),
    removeNote: (gameDir) => fsp.rm(path.join(gameDir, NOTE_FILE), { force: true }),
    countWorlds,
  };
}

/**
 * deps: { isRunning(id), resolveLoaderVersion(loader, mc, wanted), onProgress({ stage, current, total }) }
 * plus, for tests, any of realDeps()'s.
 */
async function switchVersion(id, mcVersion, deps = {}) {
  const d = { ...realDeps(), ...deps };
  const progress = (stage, current = 0, total = 1) => d.onProgress && d.onProgress({ stage, current, total });
  if (!d.instances.isValidVersionId(mcVersion)) throw new Error("Pick a Minecraft version first.");
  const before = await d.instances.require(id);
  const running = () => Boolean(d.isRunning && d.isRunning(id));

  // --- 1. allowed at all?
  if (running()) throw new Error("Close the game first - that instance is running.");
  if (before.modpack) throw new Error(`${before.name}'s mods belong to its modpack, so Reminth doesn't change them here. Make a new instance instead.`);
  if (before.loader === "vanilla") throw new Error(`${before.name} is a vanilla instance - it has no mods to update.`);
  if (before.mcVersion === mcVersion) throw new Error(`${before.name} is already on Minecraft ${mcVersion}.`);
  if (compareMc(mcVersion, before.mcVersion) === -1 && (await d.countWorlds(before.gameDir)) > 0) {
    throw new Error(`${before.name}'s worlds were saved in Minecraft ${before.mcVersion}, and the older ${mcVersion} can damage them. Make a new instance instead.`);
  }

  // --- 2. what has no build there, and the loader for it - nothing changed yet
  progress("Checking your mods", 0, 1);
  const advice = await d.advise(before, mcVersion);
  const target = (advice && advice.target) || { missing: [], failed: [], unknown: [] };
  const loaderVersion = await d.resolveLoaderVersion(before.loader, mcVersion, null);
  if (running()) throw new Error("Close the game first - that instance is running.");

  // --- 3. the note, for a run that stops half way
  const note = {
    from: { mcVersion: before.mcVersion, loaderVersion: before.loaderVersion || null },
    to: { mcVersion, loaderVersion },
    startedAt: new Date().toISOString(),
    state: "switching",
  };
  await d.writeNote(before.gameDir, note);

  // --- 4. the instance itself
  let inst;
  try {
    inst = await d.instances.update(id, { mcVersion, loaderVersion });
  } catch (err) {
    await Promise.resolve(d.removeNote(before.gameDir)).catch(() => {}); // nothing else happened
    throw err;
  }
  d.invalidate(id);

  const out = { instance: inst, updated: [], turnedOff: [], unknown: [], kept: [], failed: [], incomplete: null };
  try {
    // --- 5. the stable swap for every mod made for another version
    progress("Updating mods", 0, 1);
    const sync = await d.applySync(inst, d.onProgress);
    out.updated = [...(sync.applied || [])];
    out.failed = (sync.failed || []).map((f) => ({ title: f.title, error: f.error }));
    const failedFiles = new Set((sync.failed || []).map((f) => f.file).filter(Boolean));

    // --- 6. switch off what has no build for this version (never deleted)
    const off = new Map(); // file -> { title, why }
    for (const m of target.missing) {
      for (const file of m.files || []) off.set(file, { title: m.title, why: `no version made for ${mcVersion}` });
    }
    for (const nb of sync.noBuild || []) {
      if (off.has(nb.file)) continue;
      const why = /^No stable build/.test(nb.why || "")
        ? `no finished (stable) version made for ${mcVersion} yet`
        : `its own file says it can't run on ${mcVersion}`;
      off.set(nb.file, { title: nb.title, why });
    }
    // (A jar that was just swapped isn't in either list: it had a build. One whose
    // update failed is left on, as it was - its error is reported instead.)
    const list = [...off.entries()].filter(([file]) => !failedFiles.has(file));
    let n = 0;
    for (const [file, { title, why }] of list) {
      progress(`Turning off ${title}`, ++n, list.length);
      try {
        const r = await d.setEnabled(inst.gameDir, { kind: "mod", world: null, file }, false);
        await d.setOffReason(inst.gameDir, { kind: "mod", world: null, file: (r && r.file) || file + ".disabled" }, why);
        out.turnedOff.push({ file, title, why });
      } catch (err) {
        if (err && err.code === "ENOENT") continue; // already gone or already off
        out.failed.push({ title, error: `couldn't turn it off: ${err.message}` });
      }
    }
    out.unknown = [...(target.unknown || []).map((u) => u.title), ...(target.failed || []).map((m) => m.title), ...(sync.unchecked || []).map((u) => u.title)];
    const changed = new Set([...out.updated, ...out.turnedOff.map((t) => t.title), ...out.unknown]);
    out.kept = ((advice && advice.mods) || []).map((m) => m.title).filter((t) => !changed.has(t));
    await Promise.resolve(d.removeNote(inst.gameDir)).catch(() => {});
  } catch (err) {
    out.incomplete = `${inst.name} is now on Minecraft ${mcVersion}, but updating its mods stopped: ${err.message}. Press "Update mods to fit ${mcVersion}" on its page to finish.`;
    note.state = "mods-pending";
    note.error = String((err && err.message) || err).slice(0, 300);
    await Promise.resolve(d.writeNote(inst.gameDir, note)).catch(() => {});
  } finally {
    d.invalidate(id);
  }
  progress("Done", 1, 1);
  return out;
}

module.exports = { switchVersion, countWorlds, compareMc, NOTE_FILE };
