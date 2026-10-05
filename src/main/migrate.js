"use strict";
/**
 * "Make a copy of this instance on another Minecraft version": the fix for
 * "my mods / my server need a different version" that doesn't make the
 * player rebuild their mod list by hand.
 *
 * A NEW instance is made - the original is never changed, so its worlds
 * (which a different version could damage) stay exactly as they are. The
 * copy gets the same loader, every mod that has a build for the new
 * version (with whatever those builds need), and the player's settings,
 * server list, resource packs and shader packs. Worlds are not copied.
 */
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const content = require("./content");
const compat = require("./compat");

// Small things that make the copy feel like the same game. Never worlds,
// never mods (those are re-fetched for the new version), never .reminth
// (Reminth's own bookkeeping for the OLD instance).
const CARRY_FILES = ["options.txt", "optionsof.txt", "servers.dat"];
const CARRY_FOLDERS = ["resourcepacks", "shaderpacks", "config"];

async function carryOver(fromDir, toDir) {
  for (const name of CARRY_FILES) {
    try {
      await fsp.copyFile(path.join(fromDir, name), path.join(toDir, name));
    } catch {
      // not there - nothing to carry
    }
  }
  for (const name of CARRY_FOLDERS) {
    try {
      await fsp.cp(path.join(fromDir, name), path.join(toDir, name), { recursive: true, force: false, errorOnExist: false });
    } catch {
      // not there, or partly unreadable - the copy still works without it
    }
  }
}

/**
 * source:  the instance to copy ({ id, name, loader, hud, performanceMods, gameDir, mcVersion })
 * request: { mcVersion, name }
 * tools:   { createInstance(fields) -> instance with gameDir,
 *            listMods(instance) -> { mods: [{ projectId, title }], unknown: [titles] },
 *            install(instance, { projectId, kind }, onProgress),
 *            readManifest(gameDir) }       (the last three default to the real ones)
 * onProgress({ stage, current, total })
 * Returns { instance, installed: [titles], skipped: [{ title, why }], unknown: [titles] }.
 */
async function copyToVersion(source, { mcVersion, name }, tools, onProgress) {
  const report = (stage, current = 0, total = 1) => onProgress && onProgress({ stage, current, total });
  const listMods =
    tools.listMods ||
    (async (inst) => {
      const advice = await compat.adviseVersions(inst, {});
      return { mods: [...advice.mods, ...advice.failed.map((title) => ({ projectId: null, title }))], unknown: advice.unknown };
    });
  const install = tools.install || content.install;
  const readManifest = tools.readManifest || content.readManifest;

  report("Looking at your mods");
  // Worked out BEFORE anything is created: if The catalog can't be reached the
  // player gets an error, not an empty instance.
  const { mods, unknown } = source.loader === "vanilla" ? { mods: [], unknown: [] } : await listMods(source);

  report("Making the new instance");
  const instance = await tools.createInstance({
    name: String(name || `${source.name} ${mcVersion}`).slice(0, 48),
    mcVersion,
    loader: source.loader,
    hud: source.hud === true,
    // A copy of an instance with the performance pack switched off must not
    // quietly get the pack back (on is the default, so only "off" is passed).
    ...(source.performanceMods === false ? { performanceMods: false } : {}),
  });
  await carryOver(source.gameDir, instance.gameDir);

  const installed = [];
  const skipped = [];
  let done = 0;
  for (const mod of mods) {
    done++;
    if (!mod.projectId) {
      skipped.push({ title: mod.title, why: "Couldn't be looked up" });
      continue;
    }
    report(`Adding ${mod.title}`, done, mods.length);
    try {
      // Already brought in as something an earlier mod needed.
      const manifest = await readManifest(instance.gameDir);
      if (Object.values(manifest.files || {}).some((f) => f && f.projectId === mod.projectId)) {
        installed.push(mod.title);
        continue;
      }
      await install(instance, { projectId: mod.projectId, kind: "mod" }, null);
      installed.push(mod.title);
    } catch (err) {
      const msg = String((err && err.message) || err);
      skipped.push({ title: mod.title, why: /has no version for/i.test(msg) ? `No build for ${mcVersion}` : msg.slice(0, 160) });
    }
  }
  report("Done", 1, 1);
  compat.invalidate(instance.id);
  return { instance, installed, skipped, unknown };
}

module.exports = { copyToVersion, carryOver, CARRY_FILES, CARRY_FOLDERS };
