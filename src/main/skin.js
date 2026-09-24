"use strict";
/**
 * Fetches the signed-in player's actual Minecraft skin so the launcher can
 * show their face instead of a letter.
 *
 * Done in the main process on purpose: the renderer runs under a strict CSP
 * with connect-src 'none' (see index.html), so it never talks to the network
 * itself. It receives the finished PNG as a data: URL and crops the head out
 * of it on a canvas.
 *
 * Mojang's own endpoints only - no Crafatar, no third-party avatar service,
 * nothing that would tell someone else's server who is using Reminth.
 *
 * Mojang rate-limits the profile endpoint to roughly one request per profile
 * per minute, so results are cached in memory and on disk. The disk copy also
 * means a returning player sees their face instantly, and still sees it when
 * they're offline.
 */
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const paths = require("./paths");

const PROFILE_URL = "https://sessionserver.mojang.com/session/minecraft/profile/";
const SERVICES_PROFILE_URL = "https://api.minecraftservices.com/minecraft/profile";
const MEMORY_TTL_MS = 30 * 60 * 1000;
const MAX_SKIN_BYTES = 256 * 1024; // a 64x64 skin PNG is ~2-10KB; this is a sanity clamp

const memoryCache = new Map(); // uuid -> { at, skin }
const justChanged = new Set(); // uuids whose skin was changed through Reminth this session

function cacheFile(uuid) {
  return path.join(paths.SKIN_CACHE_DIR, `${uuid}.json`);
}

/**
 * Returns the signed-in player's skin.
 *
 *   { dataUrl, model, source }  - a real skin PNG
 *   { none: true, model }       - the account has no custom skin (Mojang
 *                                 serves no texture at all in that case, so
 *                                 the UI draws its own default figure)
 *   { error: "..." }            - couldn't find out (offline, rate limited)
 *
 * Never throws. Two independent sources are tried, because the public
 * session endpoint is rate-limited to about one request per profile per
 * minute and returns nothing for default-skin accounts: first that, then
 * the authenticated Minecraft Services profile using the token we already
 * hold from sign-in.
 */
async function getSkin(account) {
  const uuid = String((account && account.uuid) || "").replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(uuid)) return { error: "No account signed in." };

  const hit = memoryCache.get(uuid);
  if (hit && Date.now() - hit.at < MEMORY_TTL_MS) return { ...hit.skin, cached: true };

  const problems = [];
  // Right after a skin change the public session server can still hand out
  // the old skin for a minute; the authenticated profile is current at once.
  const order = justChanged.has(uuid)
    ? [() => fromServices(account), () => fromSessionServer(uuid)]
    : [() => fromSessionServer(uuid), () => fromServices(account)];
  justChanged.delete(uuid);
  for (const attempt of order) {
    try {
      const result = await attempt();
      if (result && result.dataUrl) {
        memoryCache.set(uuid, { at: Date.now(), skin: result });
        await writeCache(uuid, result);
        return { ...result, cached: false };
      }
      if (result && result.none) {
        memoryCache.set(uuid, { at: Date.now(), skin: result });
        return { ...result, cached: false };
      }
      if (result && result.error) problems.push(result.error);
    } catch (err) {
      problems.push(err.message);
    }
  }

  const stored = await readCache(uuid);
  if (stored) {
    memoryCache.set(uuid, { at: Date.now(), skin: stored });
    return { ...stored, cached: true };
  }
  return { error: problems[0] || "Couldn't reach Mojang for your skin." };
}

/** Public, unauthenticated, cached by Mojang - the cheap path. */
async function fromSessionServer(uuid) {
  const res = await fetch(PROFILE_URL + uuid);
  if (res.status === 429) return { error: "Mojang is rate-limiting skin lookups - try again shortly." };
  if (!res.ok) return { error: `Mojang returned ${res.status} for your profile.` };

  const profile = await res.json();
  const texturesProp = (profile.properties || []).find((p) => p.name === "textures");
  if (!texturesProp) return { none: true, model: defaultModelFor(uuid) };

  const decoded = JSON.parse(Buffer.from(texturesProp.value, "base64").toString("utf8"));
  const skin = decoded.textures && decoded.textures.SKIN;
  // No SKIN entry means the account is still on a default skin - that's not
  // an error, it's just nothing to download.
  if (!skin || typeof skin.url !== "string") return { none: true, model: defaultModelFor(uuid) };

  const model = skin.metadata && skin.metadata.model === "slim" ? "slim" : "classic";
  return downloadSkin(skin.url, model, profile.name, "session");
}

/** Authenticated, and the same API sign-in already used, so it's reliable. */
async function fromServices(account) {
  if (!account || !account.minecraftAccessToken) return null;
  const res = await fetch(SERVICES_PROFILE_URL, {
    headers: { Authorization: `Bearer ${account.minecraftAccessToken}` },
  });
  if (!res.ok) return { error: `Minecraft services returned ${res.status}.` };

  const profile = await res.json();
  const active = (profile.skins || []).find((s) => s.state === "ACTIVE") || (profile.skins || [])[0];
  if (!active || typeof active.url !== "string") {
    return { none: true, model: defaultModelFor(account.uuid) };
  }
  const model = String(active.variant || "").toUpperCase() === "SLIM" ? "slim" : "classic";
  return downloadSkin(active.url, model, profile.name, "services");
}

async function downloadSkin(url, model, name, source) {
  // Only ever fetch from Mojang's own texture host, whatever the profile says.
  //
  // Mojang hands these out as plain http:// URLs (verified against a live
  // profile - an https-only check here silently rejected every real skin), so
  // match either scheme but always fetch over https so the download itself is
  // still encrypted.
  if (!/^https?:\/\/textures\.minecraft\.net\//i.test(url)) {
    return { error: "Skin was hosted somewhere unexpected, so it wasn't downloaded." };
  }
  const secureUrl = url.replace(/^http:\/\//i, "https://");
  const res = await fetch(secureUrl);
  if (!res.ok) return { error: `Couldn't download the skin texture (${res.status}).` };
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length || buf.length > MAX_SKIN_BYTES) return { error: "Skin texture looked wrong, so it was skipped." };

  return {
    dataUrl: "data:image/png;base64," + buf.toString("base64"),
    model, // "slim" (Alex proportions) or "classic" (Steve proportions)
    name: typeof name === "string" ? name : null,
    source,
  };
}

/**
 * Which default body shape Mojang would use for an account with no custom
 * skin. It's decided by the UUID itself, so this needs no network call.
 */
function defaultModelFor(uuid) {
  const hex = String(uuid).replace(/-/g, "");
  if (hex.length < 32) return "classic";
  const parity =
    parseInt(hex[7], 16) ^ parseInt(hex[15], 16) ^ parseInt(hex[23], 16) ^ parseInt(hex[31], 16);
  return parity % 2 === 0 ? "classic" : "slim";
}

async function writeCache(uuid, skin) {
  try {
    await fsp.mkdir(paths.SKIN_CACHE_DIR, { recursive: true });
    await fsp.writeFile(cacheFile(uuid), JSON.stringify(skin), "utf8");
  } catch {
    // a cache that can't be written just means we re-fetch next time
  }
}

async function readCache(uuid) {
  try {
    const parsed = JSON.parse(await fsp.readFile(cacheFile(uuid), "utf8"));
    return parsed && typeof parsed.dataUrl === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* changing the skin / cape (Minecraft Services)                      */
/* ------------------------------------------------------------------ */

const SKINS_URL = "https://api.minecraftservices.com/minecraft/profile/skins";
const ACTIVE_CAPE_URL = "https://api.minecraftservices.com/minecraft/profile/capes/active";

/** Pure: width/height out of a PNG's IHDR, or null if it isn't a PNG. */
function pngSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Pure: Mojang only accepts 64x64 (modern) or 64x32 (legacy) skins. */
function validateSkinPng(buf) {
  const size = pngSize(buf);
  if (!size) return "That file isn't a PNG image.";
  if (buf.length > MAX_SKIN_BYTES) return "That image is too big to be a skin.";
  if (size.width !== 64 || (size.height !== 64 && size.height !== 32)) {
    return `Skins have to be 64×64 or 64×32 pixels - that one is ${size.width}×${size.height}.`;
  }
  return null;
}

async function servicesFetch(account, url, init = {}) {
  if (!account || !account.minecraftAccessToken) throw new Error("Sign in first.");
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${account.minecraftAccessToken}` },
  });
  if (res.status === 401) throw new Error("Your sign-in expired - sign out and back in, then try again.");
  if (res.status === 429) throw new Error("Mojang is rate-limiting skin changes. Wait a minute and try again.");
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body.errorMessage || body.error || "";
    } catch {
      // not JSON
    }
    throw new Error(`Minecraft services said no (${res.status})${detail ? `: ${detail}` : ""}.`);
  }
  return res.status === 204 ? null : res.json();
}

/** The account's full profile: skins + every cape it owns. Cape images are fetched as data URLs. */
async function getProfile(account) {
  const profile = await servicesFetch(account, SERVICES_PROFILE_URL);
  const capes = [];
  for (const cape of profile.capes || []) {
    let dataUrl = null;
    if (typeof cape.url === "string" && /^https?:\/\/textures\.minecraft\.net\//i.test(cape.url)) {
      try {
        const res = await fetch(cape.url.replace(/^http:\/\//i, "https://"));
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length <= MAX_SKIN_BYTES && pngSize(buf)) dataUrl = "data:image/png;base64," + buf.toString("base64");
        }
      } catch {
        // shown without a picture
      }
    }
    capes.push({
      id: String(cape.id),
      name: typeof cape.alias === "string" ? cape.alias : "Cape",
      active: cape.state === "ACTIVE",
      dataUrl,
    });
  }
  const active = (profile.skins || []).find((s) => s.state === "ACTIVE") || null;
  return {
    name: profile.name,
    variant: active && String(active.variant).toUpperCase() === "SLIM" ? "slim" : "classic",
    capes,
  };
}

/** Uploads a skin PNG to the signed-in account. */
async function uploadSkin(account, pngBuffer, variant) {
  const problem = validateSkinPng(pngBuffer);
  if (problem) throw new Error(problem);
  const form = new FormData();
  form.append("variant", variant === "slim" ? "slim" : "classic");
  form.append("file", new Blob([pngBuffer], { type: "image/png" }), "skin.png");
  await servicesFetch(account, SKINS_URL, { method: "POST", body: form });
  forget(account);
  return { ok: true };
}

/** capeId null = hide the cape. */
async function setCape(account, capeId) {
  if (capeId) {
    if (!/^[\w-]{1,64}$/.test(String(capeId))) throw new Error("Unknown cape.");
    await servicesFetch(account, ACTIVE_CAPE_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capeId: String(capeId) }),
    });
  } else {
    await servicesFetch(account, ACTIVE_CAPE_URL, { method: "DELETE" });
  }
  return { ok: true };
}

function forget(account) {
  const uuid = String((account && account.uuid) || "").replace(/-/g, "").toLowerCase();
  memoryCache.delete(uuid);
  justChanged.add(uuid);
}

/** Someone else's current skin, by username - for previewing/saving it. */
async function lookupByUsername(username) {
  const name = String(username || "").trim();
  if (!/^[A-Za-z0-9_]{2,16}$/.test(name)) return { error: "That isn't a valid Minecraft username." };
  const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`);
  if (res.status === 404 || res.status === 204) return { error: `No Minecraft account is called ${name}.` };
  if (!res.ok) return { error: `Mojang returned ${res.status}.` };
  const { id } = await res.json();
  const result = await fromSessionServer(String(id).toLowerCase());
  if (result && result.none) return { error: `${name} is using a default skin.` };
  return result || { error: "Couldn't load that skin." };
}

/**
 * Minecraft's own default skins (Steve, Alex and the other seven), read
 * straight out of the client jar already on this computer - nothing is
 * bundled with Reminth or downloaded for this.
 */
const DEFAULT_SKIN_NAMES = ["steve", "alex", "ari", "efe", "kai", "makena", "noor", "sunny", "zuri"];
let defaultSkinsCache = null;
async function defaultSkins(clientJarPath) {
  if (defaultSkinsCache) return defaultSkinsCache;
  const zipread = require("./zipread");
  const wanted = [];
  for (const n of DEFAULT_SKIN_NAMES) {
    wanted.push(`assets/minecraft/textures/entity/player/wide/${n}.png`, `assets/minecraft/textures/entity/player/slim/${n}.png`);
  }
  const found = await zipread.readEntries(clientJarPath, wanted);
  const out = [];
  for (const n of DEFAULT_SKIN_NAMES) {
    const wide = found[`assets/minecraft/textures/entity/player/wide/${n}.png`];
    const slim = found[`assets/minecraft/textures/entity/player/slim/${n}.png`];
    if (!wide && !slim) continue;
    out.push({
      id: n,
      name: n.charAt(0).toUpperCase() + n.slice(1),
      wide: wide ? "data:image/png;base64," + wide.toString("base64") : null,
      slim: slim ? "data:image/png;base64," + slim.toString("base64") : null,
    });
  }
  if (out.length) defaultSkinsCache = out;
  return out;
}

module.exports = {
  getSkin,
  getProfile,
  uploadSkin,
  setCape,
  lookupByUsername,
  defaultSkins,
  forget,
  validateSkinPng,
  pngSize,
};
