"use strict";
/**
 * The sponsored box on Home (owner, 16 Oct 2026). The owner sets one Minecraft server on the website (owner tools);
 * this asks the website for it - at most every 30 minutes - and hands the page { name, host, port, image (a data URL),
 * until } or null. The picture comes only from Reminth's own website and is checked to be a real PNG/JPEG/WebP before
 * the page sees it, so the page never loads anything from elsewhere.
 * Nothing about the player is sent: a plain GET with no account, no id, no clicks or views counted.
 */
const config = require("./config");

const REFRESH_MS = 30 * 60 * 1000;
const MAX_IMAGE_BYTES = 600 * 1024;
const IMAGE_PATH = /^\/api\/sponsor\/image\?v=\d{1,12}$/;

const api = () => config.REMINTH_API_URL.replace(/\/+$/, "");

/** Pure: the website's answer -> { name, host, port, imagePath, until } or null when anything is off. */
function cleanSponsor(data, nowMs = Date.now()) {
  const s = data && data.sponsor;
  if (!s || typeof s !== "object") return null;
  const name = typeof s.name === "string" ? s.name.replace(/\s+/g, " ").trim() : "";
  if (!name || name.length > 40) return null;
  const host = typeof s.host === "string" ? s.host : "";
  const hostOk = /^[A-Za-z0-9.\-_]{1,255}$/.test(host) || (/^[0-9A-Fa-f:.]{2,45}$/.test(host) && host.includes(":"));
  if (!hostOk) return null;
  const port = Number(s.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (typeof s.image !== "string" || !IMAGE_PATH.test(s.image)) return null;
  const until = Number(s.until);
  if (!Number.isFinite(until) || until * 1000 <= nowMs) return null;
  return { name, host, port, imagePath: s.image, until };
}

/** Pure: is this a real PNG / JPEG / WebP? Its type, or null. */
function imageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString("latin1", 1, 4) === "PNG") return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** The address a player types in Minecraft for it: host, host:port, [v6]:port. */
function addressOf(s) {
  const host = s.host.includes(":") ? `[${s.host}]` : s.host;
  return s.port === 25565 ? host : `${host}:${s.port}`;
}

let cache = null; // { at, value }
let inFlight = null;

async function load(fetchImpl) {
  const r = await fetchImpl(api() + "/api/sponsor", { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("sponsor " + r.status);
  const s = cleanSponsor(await r.json());
  if (!s) return null;
  // the same picture as last time: no new download
  if (cache && cache.value && cache.value.imagePath === s.imagePath) return { ...cache.value, ...s, image: cache.value.image };
  const ir = await fetchImpl(api() + s.imagePath, { signal: AbortSignal.timeout(15000) });
  if (!ir.ok) throw new Error("sponsor image " + ir.status);
  const buf = Buffer.from(await ir.arrayBuffer());
  const type = buf.length <= MAX_IMAGE_BYTES ? imageType(buf) : null;
  if (!type) return null;
  return { ...s, image: `data:${type};base64,${buf.toString("base64")}` };
}

/**
 * The slot for the page: { name, host, port, address, image, until } or null. Asks the website at most every 30
 * minutes; offline or a failed answer keeps the last one (until its end), never an error.
 */
async function get({ fetchImpl = fetch, nowMs = Date.now() } = {}) {
  if (!cache || nowMs - cache.at >= REFRESH_MS) {
    if (!inFlight) {
      inFlight = load(fetchImpl)
        .then((value) => (cache = { at: Date.now(), value }))
        .catch(() => {
          // no internet / the website is down: try again in 5 minutes, keep showing what there was
          cache = { at: Date.now() - REFRESH_MS + 5 * 60 * 1000, value: cache ? cache.value : null };
        })
        .finally(() => (inFlight = null));
    }
    await inFlight;
  }
  const v = cache && cache.value;
  if (!v || v.until * 1000 <= nowMs) return null;
  return { name: v.name, host: v.host, port: v.port, address: addressOf(v), image: v.image, until: v.until };
}

/** Tests only. */
function _reset() {
  cache = null;
  inFlight = null;
}

module.exports = { get, cleanSponsor, imageType, addressOf, REFRESH_MS, _reset };
