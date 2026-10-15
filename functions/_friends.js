// Friends (owner, 15 Oct 2026: "make the friends whole system work"). Shared by functions/api/friends/*.
//
// - Every account gets a friend code ("K7QX-2MPA"): you add someone by their code (Reminth account names aren't unique,
//   and a code can't be guessed from a name - nobody can spam requests at a player they only saw in game).
// - A request waits until the other one accepts; if they had already asked you, asking back makes you friends at once.
// - Presence: the launcher says every couple of minutes whether it's open, whether a game runs, the server it joined
//   and the Minecraft name it plays as. Only ACCEPTED friends ever see it; "Appear offline" hides all of it; streamer
//   mode's privacy sends no server. It's the last value only (no history), and it counts as offline after 5 minutes
//   without a word from the launcher.
// - Deleting an account (api/account/delete.js) removes its code, friendships, requests and presence.
import { db, json, now } from "./_lib.js";

export const FRIEND_LIMIT = 200; // friends + requests one account can have
export const ONLINE_SECONDS = 5 * 60; // a launcher that hasn't spoken for this long is offline
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L: read out loud without mistakes

let tablesReady = false;
export async function friendsDb(env) {
  const DB = await db(env);
  if (!tablesReady) {
    for (const sql of [
      `CREATE TABLE IF NOT EXISTS friend_codes (account_id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE)`,
      // one row per pair, a < b; status 'pending' (requested_by asked) or 'friends'
      `CREATE TABLE IF NOT EXISTS friends (
        a TEXT NOT NULL, b TEXT NOT NULL, status TEXT NOT NULL, requested_by TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY (a, b))`,
      `CREATE INDEX IF NOT EXISTS friends_b ON friends (b)`,
      `CREATE TABLE IF NOT EXISTS presence (
        account_id TEXT PRIMARY KEY, state TEXT NOT NULL, server TEXT, mc_name TEXT, hidden INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL)`,
    ]) {
      await DB.prepare(sql).run();
    }
    tablesReady = true;
  }
  return DB;
}

/** "k7qx 2mpa", "K7QX-2MPA" -> "K7QX2MPA", or null when it can't be a code. */
export function normalizeCode(input) {
  const c = String(input || "").toUpperCase().replace(/[\s-]+/g, "");
  return new RegExp(`^[${CODE_CHARS}]{8}$`).test(c) ? c : null;
}
export const showCode = (c) => (c ? c.slice(0, 4) + "-" + c.slice(4) : null);

function randomCode() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

/** This account's code, made the first time it's asked for. */
export async function codeOf(env, accountId) {
  const DB = await friendsDb(env);
  const row = await DB.prepare("SELECT code FROM friend_codes WHERE account_id = ?").bind(accountId).first();
  if (row) return row.code;
  for (let i = 0; i < 6; i++) {
    const code = randomCode();
    try {
      await DB.prepare("INSERT INTO friend_codes (account_id, code) VALUES (?, ?)").bind(accountId, code).run();
      return code;
    } catch {
      // taken (or made meanwhile by a second request): look again, then try another
      const again = await DB.prepare("SELECT code FROM friend_codes WHERE account_id = ?").bind(accountId).first();
      if (again) return again.code;
    }
  }
  throw new Error("couldn't make a friend code");
}

export const pair = (x, y) => (x < y ? [x, y] : [y, x]);

/** Presence as a friend sees it. */
export function presenceView(p, t = now()) {
  if (!p || p.hidden || t - p.updated_at > ONLINE_SECONDS || p.state === "offline") {
    return { status: "offline", lastSeen: p && !p.hidden ? p.updated_at * 1000 : null };
  }
  return {
    status: p.state === "playing" ? "playing" : "online",
    server: p.state === "playing" && p.server ? p.server : null,
    mcName: p.mc_name || null,
    lastSeen: p.updated_at * 1000,
  };
}

/** Everything the Friends card shows: { code, appearOffline, friends[], incoming[], outgoing[] }. */
export async function friendsView(env, me) {
  const DB = await friendsDb(env);
  const t = now();
  const rows =
    (
      await DB.prepare(
        `SELECT f.status, f.requested_by, f.created_at, acc.id, acc.name, acc.avatar_url,
                p.state, p.server, p.mc_name, p.hidden, p.updated_at
         FROM friends f
         JOIN accounts acc ON acc.id = CASE WHEN f.a = ?1 THEN f.b ELSE f.a END
         LEFT JOIN presence p ON p.account_id = acc.id
         WHERE f.a = ?1 OR f.b = ?1
         ORDER BY acc.name COLLATE NOCASE`
      )
        .bind(me)
        .all()
    ).results || [];
  const mine = await DB.prepare("SELECT hidden FROM presence WHERE account_id = ?").bind(me).first();
  const person = (r) => ({ id: r.id, name: r.name, avatarUrl: r.avatar_url || null });
  const friends = [];
  const incoming = [];
  const outgoing = [];
  for (const r of rows) {
    if (r.status === "friends") friends.push({ ...person(r), since: r.created_at * 1000, ...presenceView(r.updated_at ? r : null, t) });
    else if (r.requested_by === me) outgoing.push({ ...person(r), at: r.created_at * 1000 });
    else incoming.push({ ...person(r), at: r.created_at * 1000 });
  }
  // playing first, then online, then offline (by name inside each)
  const rank = { playing: 0, online: 1, offline: 2 };
  friends.sort((x, y) => rank[x.status] - rank[y.status] || x.name.localeCompare(y.name));
  return { code: showCode(await codeOf(env, me)), appearOffline: Boolean(mine && mine.hidden), friends, incoming, outgoing, limit: FRIEND_LIMIT };
}

/** The signed-in account for a friends request, or a Response to send back. Cookie requests that change something must
 *  come from the website itself. */
export async function friendsUser(env, request, currentUser, sameOrigin, changes) {
  const me = await currentUser(env, request);
  if (!me) return { response: json({ error: "signed_out" }, 401) };
  if (changes && me.viaCookie && !sameOrigin(request)) return { response: json({ error: "forbidden" }, 403) };
  return { id: me.user.id };
}

export async function readBody(request) {
  try {
    const b = await request.json();
    return b && typeof b === "object" ? b : {};
  } catch {
    return {};
  }
}

/** A server address as the launcher may share it: host[:port], letters/digits/dots/dashes, at most 80 characters. */
export function cleanServer(s) {
  const v = String(s || "").trim().toLowerCase();
  return /^[a-z0-9.-]{1,70}(:\d{1,5})?$/.test(v) && /[a-z0-9]/.test(v) ? v : null;
}
/** A Minecraft name: 3-16 letters, digits or _. */
export function cleanMcName(s) {
  const v = String(s || "").trim();
  return /^[A-Za-z0-9_]{3,16}$/.test(v) ? v : null;
}
