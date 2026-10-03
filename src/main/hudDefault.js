"use strict";
/**
 * ReminthHUD (the FPS | GPU | CPU | LAT bar) is on for every Fabric and Quilt
 * instance. Instances made before 1.4.4 mostly had it off, because the
 * switch used to default to off for them, so this turns it on ONCE for those.
 * It is a one-time step (a marker file in Reminth's data folder), so a player
 * who switches it off afterwards in the instance dialog keeps it off.
 */
const fs = require("fs");
const path = require("path");

const MARKER = "hud-on-by-default.json";

/** Pure: the instances this step turns the HUD on for. */
function needsHud(inst) {
  return Boolean(inst) && (inst.loader === "fabric" || inst.loader === "quilt") && inst.hud === false;
}

/**
 * deps: { dir (Reminth's data folder), list() -> instances, update(id, patch) }.
 * Returns how many instances were changed. Never throws; if anything fails
 * the marker isn't written, so it tries again at the next start.
 */
async function turnOnOnce({ dir, list, update }) {
  const marker = path.join(dir, MARKER);
  try {
    await fs.promises.access(marker);
    return 0; // already done
  } catch {
    // not done yet
  }
  let changed = 0;
  try {
    for (const inst of await list()) {
      if (!needsHud(inst)) continue;
      await update(inst.id, { hud: true });
      changed++;
    }
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(marker, JSON.stringify({ at: new Date().toISOString(), changed }, null, 2));
  } catch {
    // retried at the next start
  }
  return changed;
}

module.exports = { turnOnOnce, needsHud, MARKER };
