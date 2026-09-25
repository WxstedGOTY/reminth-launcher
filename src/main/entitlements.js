"use strict";
/**
 * What the player's plan unlocks. Reminth+ perks live here so there's one
 * place to check them.
 *
 * RAM is NOT a paid perk: every player gets whatever this PC can spare.
 * Reminth+ is about hosting (see the Reminth+ page). There is no payment or
 * licence backend yet, so hasPlus() is false for everyone; when one exists
 * it must check a signed licence from a server, not a flag on disk -
 * settings.json is a text file anyone can edit.
 */
const os = require("os");

// Windows plus the launcher itself need roughly this much to stay usable.
const RESERVED_FOR_SYSTEM_MB = 2048;
// Hard ceiling regardless of how much RAM the machine has. Past 8GB a
// Minecraft heap stops helping and just makes GC pauses longer, and a
// player on a shared or lower-spec PC shouldn't have the slider (or an
// admin/default) hand the whole box to one game.
const MAX_USEFUL_RAM_MB = 8192;
const MIN_RAM_MB = 1024;

function hasPlus() {
  return false;
}

/** The most memory Minecraft may be given on this machine (512 MB steps). */
function ramCapMb(totalBytes = os.totalmem()) {
  const totalMb = totalBytes / (1024 * 1024);
  const spare = Math.floor((totalMb - RESERVED_FOR_SYSTEM_MB) / 512) * 512;
  return Math.max(MIN_RAM_MB, Math.min(MAX_USEFUL_RAM_MB, spare));
}

function summary() {
  return { plus: hasPlus(), ramCapMb: ramCapMb(), purchasable: false };
}

module.exports = { hasPlus, ramCapMb, summary, MAX_USEFUL_RAM_MB, RESERVED_FOR_SYSTEM_MB };
