"use strict";
/**
 * Reads the HUD's lag spike log (<game folder>/.reminth/lag-spikes.log, written by SpikeLog.java: one line per
 * freeze of 250 ms or more) and says which fix fits (owner, 21 Oct 2026: "realize what's happening when it's
 * happening and recommend the right change"). Pure except readLog. Nothing here is sent anywhere.
 *
 * Line format (tab separated): "2026-10-21 21:40:02	412 ms	inventory (just opened)	narrator on"
 */
const fsp = require("fs").promises;
const path = require("path");

const LOG = path.join(".reminth", "lag-spikes.log");

/** Pure: log text -> [{ at, ms, doing, justOpened, narrator }], bad lines skipped. */
function parseLog(text) {
  const out = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\t(\d+) ms\t(playing|inventory|container|chat|menu)( \(just opened\))?\tnarrator (on|off)$/.exec(line);
    if (!m) continue;
    out.push({ at: m[1], ms: Number(m[2]), doing: m[3], justOpened: Boolean(m[4]), narrator: m[5] === "on" });
  }
  return out;
}

/**
 * Pure: the fixes that fit the spikes, most useful first: [{ id, title, why, count }].
 * Only spikes from the last `days` days (by the line's own date, against `now`) count, so an old problem that was
 * fixed stops showing.
 */
function advise(spikes, { now = new Date(), days = 7 } = {}) {
  const since = now.getTime() - days * 86400000;
  const recent = spikes.filter((s) => {
    const t = new Date(s.at.replace(" ", "T")).getTime();
    return Number.isFinite(t) && t >= since;
  });
  if (!recent.length) return [];
  const tips = [];
  const narr = recent.filter((s) => s.narrator);
  if (narr.length) {
    tips.push({
      id: "narrator",
      title: "Turn the Narrator off",
      why: `${narr.length} lag spike${narr.length === 1 ? "" : "s"} happened with the Narrator on - it reads every menu out loud, which freezes the game when one opens. Spaceport keeps it off unless you switched "Narrator" off in Spaceport Built-in Mods.`,
      count: narr.length,
    });
  }
  const opening = recent.filter((s) => s.justOpened && !s.narrator && (s.doing === "inventory" || s.doing === "container"));
  if (opening.length >= 3) {
    tips.push({
      id: "inventory",
      title: "Lag when opening your inventory",
      why: `${opening.length} spikes happened right as an inventory or chest opened. Mods that draw item tooltips or inventory extras are the usual cause - try switching those off one at a time.`,
      count: opening.length,
    });
  }
  const playing = recent.filter((s) => s.doing === "playing");
  if (playing.length >= 5) {
    tips.push({
      id: "render",
      title: "Lag spikes while playing",
      why: `${playing.length} spikes while playing. Lower the render distance (Boost FPS on the instance page does it) or give Minecraft more memory if it's below 4 GB.`,
      count: playing.length,
    });
  }
  return tips.sort((a, b) => b.count - a.count);
}

/** The spikes of one instance's game folder ([] when there is no log). Never throws. */
async function readLog(gameDir) {
  try {
    return parseLog(await fsp.readFile(path.join(gameDir, LOG), "utf8"));
  } catch {
    return [];
  }
}

module.exports = { parseLog, advise, readLog, LOG };
