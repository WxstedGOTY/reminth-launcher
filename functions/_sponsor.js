// The sponsored box in the launcher (owner, 16 Oct 2026: "build it"). Shared by functions/api/sponsor/* and
// functions/api/admin/sponsor.js.
//
// One slot: a Minecraft server that paid (or that the owner wants to show for free) - its name, address and a picture,
// shown on Home under Friends with "Sponsored" on it, from a start day to an end day. The owner sets it on the account
// page (owner tools). The launcher asks GET /api/sponsor now and then and shows it; nothing about the player is sent or
// saved for it - no clicks, no views, no ids (many players are children: no tracking, ever).
import { db } from "./_lib.js";

export const MAX_IMAGE_BYTES = 450 * 1024; // the owner page shrinks the picture to 1320x600 webp first (~60-150 KB)
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const DAY = 86400;

let tableReady = false;
export async function sponsorDb(env) {
  const DB = await db(env);
  if (!tableReady) {
    // id is always 1: there is one slot
    await DB.prepare(
      `CREATE TABLE IF NOT EXISTS sponsor (
        id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL,
        image_type TEXT NOT NULL, image TEXT NOT NULL, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL)`
    ).run();
    tableReady = true;
  }
  return DB;
}

/** Pure: "play.example.net", "play.example.net:25570", "[::1]:25565" -> { host, port } or null. */
export function parseAddress(input) {
  const text = String(input || "").trim();
  if (!text || text.length > 260) return null;
  let host = text;
  let port = 25565;
  const v6 = /^\[([0-9A-Fa-f:.]{2,45})\](?::(\d{1,5}))?$/.exec(text);
  if (v6) {
    host = v6[1];
    if (v6[2]) port = Number(v6[2]);
  } else {
    const m = /^([A-Za-z0-9.\-_]{1,255}?)(?::(\d{1,5}))?$/.exec(text);
    if (!m) return null;
    host = m[1].toLowerCase();
    if (m[2]) port = Number(m[2]);
    if (!/[A-Za-z0-9]/.test(host) || host.startsWith(".") || host.endsWith(".") || host.includes("..")) return null;
  }
  if (!(port > 0 && port < 65536)) return null;
  return { host, port };
}

/** Pure: "2026-10-20" -> seconds at 00:00 UTC that day, or null. */
export function parseDay(input) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(input || ""));
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  return Math.floor(t / 1000);
}

/** Pure: "data:image/webp;base64,..." -> { type, base64, bytes } or null (only png/jpeg/webp, at most MAX_IMAGE_BYTES). */
export function parseImage(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataUrl || ""));
  if (!m || !IMAGE_TYPES.includes(m[1])) return null;
  const base64 = m[2];
  const bytes = Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  if (bytes < 64 || bytes > MAX_IMAGE_BYTES) return null;
  // the first bytes must really be that kind of picture
  const head = atob(base64.slice(0, 24));
  const code = (i) => head.charCodeAt(i);
  const ok =
    m[1] === "image/png" ? head.startsWith("\x89PNG") :
    m[1] === "image/jpeg" ? code(0) === 0xff && code(1) === 0xd8 :
    head.startsWith("RIFF") && head.slice(8, 12) === "WEBP";
  return ok ? { type: m[1], base64, bytes } : null;
}

/**
 * Pure: what the owner page sent -> { row } to save, or { error, message }. The end day is included: a slot "from
 * 20 to 26 October" shows until 27 October 00:00 UTC.
 */
export function checkSponsorInput(body, nowSec, keepImage = null) {
  const b = body && typeof body === "object" ? body : {};
  const name = String(b.name || "").replace(/\s+/g, " ").trim();
  if (!name || name.length > 40) return { error: "name", message: "Give the server a name (up to 40 letters)." };
  const addr = parseAddress(b.address);
  if (!addr) return { error: "address", message: "That isn't a server address. It looks like play.example.net or play.example.net:25565." };
  const start = parseDay(b.startDay);
  const end = parseDay(b.endDay);
  if (start === null || end === null) return { error: "days", message: "Pick a first and a last day." };
  if (end < start) return { error: "days", message: "The last day is before the first day." };
  if (end + DAY <= nowSec) return { error: "days", message: "The last day is already over." };
  if (end - start > 366 * DAY) return { error: "days", message: "At most one year at a time." };
  let image = null;
  if (b.image) {
    image = parseImage(b.image);
    if (!image) return { error: "image", message: "The picture must be a PNG, JPG or WebP under 450 KB." };
  } else if (keepImage) {
    image = keepImage;
  } else {
    return { error: "image", message: "Add a picture." };
  }
  return {
    row: { name, host: addr.host, port: addr.port, image_type: image.type, image: image.base64, starts_at: start, ends_at: end + DAY, updated_at: nowSec },
  };
}

/** Pure: is the saved slot showing at `nowSec`? */
export function isLive(row, nowSec) {
  return Boolean(row && row.starts_at <= nowSec && nowSec < row.ends_at);
}

/** Pure: what the launcher gets for a live slot (no picture bytes: the picture has its own address, cached by version). */
export function publicSponsor(row) {
  return { name: row.name, host: row.host, port: row.port, image: `/api/sponsor/image?v=${row.updated_at}`, until: row.ends_at };
}

export async function readSponsor(env) {
  const DB = await sponsorDb(env);
  return (await DB.prepare("SELECT * FROM sponsor WHERE id = 1").first()) || null;
}

export async function saveSponsor(env, row) {
  const DB = await sponsorDb(env);
  await DB.prepare(
    `INSERT OR REPLACE INTO sponsor (id, name, host, port, image_type, image, starts_at, ends_at, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(row.name, row.host, row.port, row.image_type, row.image, row.starts_at, row.ends_at, row.updated_at)
    .run();
}

export async function clearSponsor(env) {
  const DB = await sponsorDb(env);
  await DB.prepare("DELETE FROM sponsor WHERE id = 1").run();
}
