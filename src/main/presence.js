"use strict";
/**
 * Friends presence (owner, 15 Oct 2026: "make the friends whole system work"). Tells the Reminth server what this
 * launcher is doing - every 2 minutes, at once when a game starts or stops, and "offline" when Reminth quits - and hands
 * the Friends card that comes back to the window. The server shows it only to accepted friends
 * (functions/_friends.js); "Appear offline" there hides all of it.
 *
 * What it sends: the state ("online" in the launcher, "playing" while a game runs), the Minecraft name it plays as, and
 * - while a game runs - the server that game joined, read from the game's own log ("Connecting to <host>, <port>").
 * Streamer mode's privacy sends no server.
 */
const fsp = require("fs").promises;
const path = require("path");

const EVERY_MS = 2 * 60 * 1000;
const LOG_TAIL = 256 * 1024;

/** Pure: the server the game last connected to in this log text ("host" or "host:port"), or null. */
function serverFromLog(text) {
  const re = /Connecting to ([^,\s]+), (\d{1,5})/g;
  let last = null;
  let m;
  while ((m = re.exec(String(text || "")))) {
    // voice chat mods log "Connecting to voice chat server: ..." - not a Minecraft server
    const lineStart = text.lastIndexOf("\n", m.index) + 1;
    if (/voice/i.test(text.slice(lineStart, m.index + m[0].length))) continue;
    last = m;
  }
  if (!last) return null;
  const host = last[1].toLowerCase();
  if (!/^[a-z0-9.-]{1,70}$/.test(host)) return null;
  return last[2] === "25565" ? host : `${host}:${last[2]}`;
}

/** The server a running game joined, from <gameDir>/logs/latest.log - only a log written since the game started. */
async function serverOfGame(gameDir, startedAt) {
  const file = path.join(gameDir, "logs", "latest.log");
  let fh;
  try {
    const st = await fsp.stat(file);
    if (startedAt && st.mtimeMs < startedAt - 60 * 1000) return null; // an old log: this game hasn't written yet
    fh = await fsp.open(file, "r");
    const len = Math.min(st.size, LOG_TAIL);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, st.size - len);
    return serverFromLog(buf.toString("utf8"));
  } catch {
    return null;
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

/**
 * deps: { account (reminthAccount), games() -> [{ gameDir, startedAt }], mcName() -> string|null,
 *         privacy() -> bool, onList(card) }
 */
function createPresence(deps) {
  let timer = null;
  let busy = false;
  let again = false;

  async function report() {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      const games = deps.games();
      let server = null;
      if (games.length && !deps.privacy()) {
        // the game that started last is the one being played
        const g = [...games].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0];
        server = await serverOfGame(g.gameDir, g.startedAt);
      }
      const card = await deps.account.friendsPresence({ state: games.length ? "playing" : "online", server, mcName: deps.mcName() || null });
      if (card && !card.error) deps.onList(card);
    } catch {
      // offline or signed out: the next round tries again
    } finally {
      busy = false;
      if (again) {
        again = false;
        report();
      }
    }
  }

  return {
    start() {
      if (timer) return;
      report();
      timer = setInterval(report, EVERY_MS);
      if (timer.unref) timer.unref();
    },
    /** Something changed (a game started or stopped, a sign-in): say so now. */
    poke() {
      if (timer) report();
    },
    /** Reminth is quitting: "offline", best effort, never longer than 2 seconds. */
    async stop() {
      clearInterval(timer);
      timer = null;
      await Promise.race([deps.account.friendsPresence({ state: "offline", list: false }).catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
    },
  };
}

module.exports = { createPresence, serverFromLog, serverOfGame };
