"use strict";
/**
 * How much memory Minecraft may be given on this machine.
 *
 * RAM is not a paid perk: every player gets whatever this PC can spare.
 * (There is no paid plan: Spaceport+ was removed, everything is free.)
 */
const os = require("os");

// Windows plus the launcher itself need roughly this much to stay usable.
const RESERVED_FOR_SYSTEM_MB = 2048;
// Hard ceiling regardless of how much RAM the machine has. It used to be
// 8 GB, which is plenty for vanilla and light mod lists but not for big
// modpacks - those ask for 10-12 GB, and the app promises RAM isn't held
// back beyond what the PC can spare. 16 GB covers them; past that a bigger
// heap only makes garbage-collection pauses longer. On most PCs the real
// limit is the line above anyway: total memory minus what Windows needs.
const MAX_USEFUL_RAM_MB = 16384;
const MIN_RAM_MB = 1024;

/** The most memory Minecraft may be given on this machine (512 MB steps). */
function ramCapMb(totalBytes = os.totalmem()) {
  const totalMb = totalBytes / (1024 * 1024);
  const spare = Math.floor((totalMb - RESERVED_FOR_SYSTEM_MB) / 512) * 512;
  return Math.max(MIN_RAM_MB, Math.min(MAX_USEFUL_RAM_MB, spare));
}

function summary() {
  return { ramCapMb: ramCapMb() };
}

module.exports = { ramCapMb, summary, MAX_USEFUL_RAM_MB, RESERVED_FOR_SYSTEM_MB };
