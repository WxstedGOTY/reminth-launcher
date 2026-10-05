"use strict";

/**
 * Thin wrapper around Modrinth's public v2 API. This is the ONLY module in
 * Reminth that talks to api.modrinth.com - the renderer never gets direct
 * network access (connect-src stays 'none' in the CSP; see index.html). The
 * catalog/browse UI reaches this exclusively through ipcMain handlers in
 * main.js -> preload.js's contextBridge methods.
 *
 * No API key is required for read access (search, browse, project/version
 * detail, tags) - see https://docs.modrinth.com/api/. A distinct User-Agent
 * IS required; Modrinth's own docs warn generic client strings risk being
 * blocked.
 */

const BASE_URL = "https://api.modrinth.com/v2";
// The real app version, so Modrinth's logs (and anyone there debugging a
// misbehaving client) see which release made a request. A hard-coded number
// here went stale with the first release after it was typed.
function appVersion() {
  try {
    const v = require("../../package.json").version;
    return typeof v === "string" && /^[\w.+-]{1,32}$/.test(v) ? v : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
const USER_AGENT = `reminth-launcher/reminth/${appVersion()} (github.com/WxstedGOTY/reminth-launcher)`;

// Modrinth documents 300 req/min but a live community report observed 200 -
// never hardcode a limit, just track what the server actually tells us on
// each response and let callers back off when it gets low.
let rateLimit = { limit: null, remaining: null, resetSeconds: null };

function rateLimitStatus() {
  return { ...rateLimit };
}

function readRateLimitHeaders(res) {
  const limit = res.headers.get("x-ratelimit-limit");
  const remaining = res.headers.get("x-ratelimit-remaining");
  const reset = res.headers.get("x-ratelimit-reset");
  if (limit !== null) rateLimit.limit = Number(limit);
  if (remaining !== null) rateLimit.remaining = Number(remaining);
  if (reset !== null) rateLimit.resetSeconds = Number(reset);
}

const BASE_URL_V3 = "https://api.modrinth.com/v3";

/* ---- retrying ---- */

const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 20000; // per attempt - a hung connection must not hang an install forever
const BACKOFF_MS = [500, 1500]; // wait before attempt 2, then before attempt 3
const MAX_RATE_LIMIT_WAIT_MS = 10000;

let retryDelay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** For tests: swap the function that waits between attempts. Returns the previous one. */
function setRetryDelay(fn) {
  const previous = retryDelay;
  retryDelay = typeof fn === "function" ? fn : previous;
  return previous;
}

/**
 * Pure: how long a 429 response asks us to wait, in ms, capped (10s unless
 * the caller allows more) so the UI never sits for minutes.
 */
function rateLimitWaitMs(headers, maxWaitMs = MAX_RATE_LIMIT_WAIT_MS) {
  const seconds = (name) => {
    const raw = headers && headers.get(name);
    if (raw === null || raw === undefined || raw === "") return null;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
    const when = Date.parse(raw); // Retry-After may also be an HTTP date
    return Number.isFinite(when) ? (when - Date.now()) / 1000 : null;
  };
  let wait = seconds("retry-after");
  if (wait === null) wait = seconds("x-ratelimit-reset");
  if (wait === null) wait = 5;
  const cap = Number.isFinite(Number(maxWaitMs)) && Number(maxWaitMs) > 0 ? Number(maxWaitMs) : MAX_RATE_LIMIT_WAIT_MS;
  return Math.min(cap, Math.max(250, Math.round(wait * 1000)));
}

/** The error a caller sees once every attempt has failed without an answer. */
function unreachableError(err) {
  const timedOut = err && (err.name === "TimeoutError" || err.name === "AbortError");
  return new Error(timedOut ? "The catalog took too long to answer — check your connection and try again." : `Couldn't reach the catalog: ${(err && err.message) || err}`, { cause: err });
}

/**
 * The retry loop behind fetchWithRetry and request(). `consume(res)`, when
 * given, reads the response body INSIDE the attempt: the per-attempt timeout
 * covers the body as well as the headers, so a body that arrives too slowly
 * or is cut off has to count as a failed attempt and be retried like any
 * other network error - not escape as a raw "TimeoutError". Resolves with
 * { res, body } (body undefined without consume).
 */
async function attemptWithRetry(url, init, { attempts = MAX_ATTEMPTS, timeoutMs = REQUEST_TIMEOUT_MS, maxWaitMs = MAX_RATE_LIMIT_WAIT_MS } = {}, consume = null) {
  const backoff = (attempt) => BACKOFF_MS[attempt - 1] || BACKOFF_MS[BACKOFF_MS.length - 1];
  for (let attempt = 1; ; attempt++) {
    const last = attempt >= attempts;
    let res;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      if (last) throw unreachableError(err);
      await retryDelay(backoff(attempt));
      continue;
    }
    readRateLimitHeaders(res);
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && !last) {
      const waitMs = res.status === 429 ? rateLimitWaitMs(res.headers, maxWaitMs) : backoff(attempt);
      try {
        if (res.body) await res.body.cancel(); // free the connection before waiting
      } catch {
        // nothing to free
      }
      await retryDelay(waitMs);
      continue;
    }
    if (!consume) return { res, body: undefined };
    try {
      return { res, body: await consume(res) };
    } catch (err) {
      // An error answer (404, 400...) is final whatever happened to its
      // text; only a good answer whose body didn't arrive is worth asking for again.
      if (!res.ok) return { res, body: "" };
      if (last) throw unreachableError(err);
      await retryDelay(backoff(attempt));
    }
  }
}

/**
 * fetch() for Modrinth's API with the retry policy every caller should get:
 * up to 3 attempts; a 429 waits for as long as the server says (Retry-After,
 * else X-Ratelimit-Reset, capped at 10s - or at `maxWaitMs` for background
 * work that can afford to sit out a full rate-limit window); a 5xx or a
 * network error/timeout backs off 0.5s then 1.5s; any other 4xx is the
 * caller's mistake and comes straight back. Returns the last Response
 * (which may still be a 429/5xx - callers check res.ok as before) or throws
 * the last network error. The caller reads the body itself, so a body that
 * times out is NOT retried here - request() below does that.
 */
async function fetchWithRetry(url, init = {}, options = {}) {
  return (await attemptWithRetry(url, init, options)).res;
}

async function request(path, { method = "GET", body, query, base = BASE_URL, maxWaitMs } = {}) {
  const url = new URL(base + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, value);
    }
  }
  // Every call here is a lookup (the POSTs too), so repeating one is safe.
  const { res, body: answer } = await attemptWithRetry(
    url,
    {
      method,
      headers: {
        "User-Agent": USER_AGENT,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    },
    maxWaitMs ? { maxWaitMs } : {},
    (r) => (r.ok ? r.json() : r.text())
  );
  if (res.status === 429) {
    throw new Error(`Rate limit hit - resets in ${rateLimit.resetSeconds ?? "?"}s`);
  }
  if (!res.ok) {
    throw new Error(`Modrinth API ${method} ${path} failed: ${res.status} ${answer}`);
  }
  return answer;
}

/**
 * Facets are Modrinth's filter syntax: an array-of-arrays where inner arrays
 * are OR'd and outer arrays are AND'd, each entry "type:value" (or with
 * !=, >=, >, <=, < operators). Built here from a plain options object so
 * callers never have to hand-write facet JSON.
 *
 * https://docs.modrinth.com/api/operations/searchprojects/
 */
/** Pure: facet values come from the renderer - only plain tokens get through. */
const FACET_VALUE = /^[A-Za-z0-9._+\- ]{1,64}$/;
function cleanList(list) {
  return (Array.isArray(list) ? list : []).filter((v) => typeof v === "string" && FACET_VALUE.test(v)).slice(0, 30);
}

function buildFacets({ projectType, loaders, gameVersions, categories, environment, openSource } = {}) {
  const facets = [];
  if (projectType && FACET_VALUE.test(projectType)) facets.push([`project_type:${projectType}`]);
  const l = cleanList(loaders);
  if (l.length) facets.push(l.map((x) => `categories:${x}`));
  const g = cleanList(gameVersions);
  if (g.length) facets.push(g.map((v) => `versions:${v}`));
  // Categories are AND'd, not OR'd: ticking "Magic" and "Quests" means packs
  // that are both - the same way Modrinth's own site filters.
  for (const c of cleanList(categories)) facets.push([`categories:${c}`]);
  if (environment === "client") facets.push(["client_side:required", "client_side:optional"]);
  if (environment === "server") facets.push(["server_side:required", "server_side:optional"]);
  if (openSource === true) facets.push(["open_source:true"]);
  return facets.length ? facets : undefined;
}

/**
 * Live catalog search. `index` is Modrinth's sort mode: relevance | downloads
 * | follows | newest | updated. `limit` is capped at 100 by the API itself.
 */
const SEARCH_INDEXES = ["relevance", "downloads", "follows", "newest", "updated"];

async function searchProjects({
  query = "",
  projectType,
  loaders,
  gameVersions,
  categories,
  environment,
  openSource,
  index = "relevance",
  offset = 0,
  limit = 20,
} = {}, { maxWaitMs } = {}) {
  const facets = buildFacets({ projectType, loaders, gameVersions, categories, environment, openSource });
  return request("/search", {
    maxWaitMs,
    query: {
      query: String(query || "").slice(0, 200),
      index: SEARCH_INDEXES.includes(index) ? index : "relevance",
      offset: Math.max(0, Math.min(100000, Number(offset) || 0)),
      limit: Math.max(1, Math.min(Number(limit) || 20, 100)),
      ...(facets ? { facets: JSON.stringify(facets) } : {}),
    },
  });
  // -> { hits: [...], offset, limit, total_hits }
}

/**
 * Servers only exist in Modrinth's v3 search (it's the only place that
 * returns their address, live player count, ping and region). Filters are
 * v3's expression syntax, built here from whitelisted pieces only.
 */
const SERVER_INDEXES = {
  popular: "minecraft_java_server.verified_plays_2w",
  players: "minecraft_java_server.ping.data.players_online",
  newest: "newest",
  updated: "updated",
  follows: "follows",
};
async function searchServers({ query = "", categories, index = "popular", offset = 0, limit = 20 } = {}) {
  const parts = ['project_types = "minecraft_java_server"'];
  for (const c of cleanList(categories)) parts.push(`categories = "${c}"`);
  const url = new URL("https://api.modrinth.com/v3/search");
  url.searchParams.set("query", String(query || "").slice(0, 200));
  url.searchParams.set("new_filters", parts.join(" AND "));
  url.searchParams.set("index", SERVER_INDEXES[index] || SERVER_INDEXES.popular);
  url.searchParams.set("offset", String(Math.max(0, Math.min(100000, Number(offset) || 0))));
  url.searchParams.set("limit", String(Math.max(1, Math.min(Number(limit) || 20, 100))));
  const { res, body } = await attemptWithRetry(url, { headers: { "User-Agent": USER_AGENT } }, {}, (r) => (r.ok ? r.json() : r.text()));
  if (!res.ok) throw new Error(`Modrinth server search failed: ${res.status}`);
  // Trimmed to the fields the UI uses - v3 hits carry 100+ dependency ids each.
  return {
    total: body.total_hits || 0,
    hits: (body.hits || []).map((h) => {
      const java = h.minecraft_java_server || {};
      const ping = (java.ping && java.ping.data) || null;
      const content = java.content || {};
      const lat = ping && ping.latency ? Math.round((ping.latency.secs || 0) * 1000 + (ping.latency.nanos || 0) / 1e6) : null;
      return {
        id: h.project_id,
        slug: h.slug,
        title: h.name,
        description: h.summary,
        icon_url: h.icon_url,
        color: h.color,
        categories: h.display_categories && h.display_categories.length ? [...new Set(h.display_categories)] : h.categories || [],
        allCategories: h.categories || [],
        address: typeof java.address === "string" ? java.address : null,
        playersOnline: ping ? ping.players_online : null,
        playersMax: ping ? ping.players_max : null,
        modrinthPingMs: lat,
        online: Boolean(ping),
        plays2w: java.verified_plays_2w || 0,
        region: (h.minecraft_server && h.minecraft_server.region) || null,
        languages: (h.minecraft_server && h.minecraft_server.languages) || [],
        content: {
          kind: content.kind || "vanilla",
          projectId: content.project_id || null,
          versionId: content.version_id || null,
          projectName: content.project_name || null,
          supportedVersions: content.supported_game_versions || [],
          recommendedVersion: content.recommended_game_version || null,
        },
        gameVersions: (h.project_loader_fields && h.project_loader_fields.game_versions) || h.game_versions || [],
        packLoaders: (h.project_loader_fields && h.project_loader_fields.mrpack_loaders) || h.mrpack_loaders || [],
      };
    }),
  };
}

async function getVersion(versionId) {
  return request(`/version/${encodeURIComponent(versionId)}`);
}

/** Batch version lookup - one call for a known set of version ids instead of N. */
async function getVersions(ids) {
  return request("/versions", { query: { ids: JSON.stringify(ids) } });
}

async function getProject(idOrSlug) {
  return request(`/project/${encodeURIComponent(idOrSlug)}`);
}

/** Batch project lookup - one call for a known set of IDs instead of N. */
async function getProjects(ids) {
  return request("/projects", { query: { ids: JSON.stringify(ids) } });
}

/** Team members for many teams at once -> [[member, ...], ...]. v3 because
 *  only v3 says which member is the owner (is_owner). */
async function getTeams(ids) {
  return request("/teams", { query: { ids: JSON.stringify(ids) }, base: BASE_URL_V3 });
}

/** Organizations (a group that owns projects instead of one person) - v3 only. */
async function getOrganizations(ids) {
  return request("/organizations", { query: { ids: JSON.stringify(ids) }, base: BASE_URL_V3 });
}

async function getProjectVersions(idOrSlug, { loaders, gameVersions } = {}) {
  return request(`/project/${encodeURIComponent(idOrSlug)}/version`, {
    query: {
      ...(loaders?.length ? { loaders: JSON.stringify(loaders) } : {}),
      ...(gameVersions?.length ? { game_versions: JSON.stringify(gameVersions) } : {}),
    },
  });
}

/** One hop of a project's dependency graph (not the full transitive tree -
 *  Modrinth doesn't expose that in one call; see the dependency resolver). */
async function getProjectDependencies(idOrSlug) {
  return request(`/project/${encodeURIComponent(idOrSlug)}/dependencies`);
  // -> { projects: [...], versions: [...] }
}

/**
 * The load-bearing bulk endpoint for update-checking: many installed-file
 * hashes in, the latest COMPATIBLE version per hash out, scoped to the
 * instance's loader + game version. One call per instance, not one per mod.
 */
async function checkForUpdates(hashes, { loaders, gameVersions, algorithm = "sha512" } = {}) {
  return request("/version_files/update", {
    method: "POST",
    body: {
      hashes,
      algorithm,
      loaders: loaders?.length ? loaders : undefined,
      game_versions: gameVersions?.length ? gameVersions : undefined,
    },
  });
  // -> { [hash]: versionObject }
}

/** Resolve a batch of file hashes to their version objects (no update logic,
 *  just "what version is this file"). */
async function getVersionsFromHashes(hashes, algorithm = "sha512") {
  return request("/version_files", { method: "POST", body: { hashes, algorithm } });
}

/**
 * Taxonomy endpoints - category/loader/game_version/project_type. These
 * exist specifically so a client builds filter UIs dynamically instead of
 * hardcoding lists. Verified live to actually matter: /tag/project_type's
 * docs example is stale (shows 4 types), the live endpoint returns 7.
 */
async function getTags(type) {
  const known = ["category", "loader", "game_version", "license", "project_type"];
  if (!known.includes(type)) throw new Error(`Unknown Modrinth tag type: ${type}`);
  return request(`/tag/${type}`);
}

module.exports = {
  USER_AGENT,
  searchServers,
  getVersion,
  getVersions,
  buildFacets,
  searchProjects,
  getProject,
  getProjects,
  getProjectVersions,
  getProjectDependencies,
  checkForUpdates,
  getVersionsFromHashes,
  getTeams,
  getOrganizations,
  getTags,
  rateLimitStatus,
  fetchWithRetry,
  setRetryDelay,
  rateLimitWaitMs,
};
