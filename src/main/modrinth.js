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
const USER_AGENT = "reminth-launcher/reminth/1.1.0 (github.com/WxstedGOTY/reminth-launcher)";

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

async function request(path, { method = "GET", body, query } = {}) {
  const url = new URL(BASE_URL + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, value);
    }
  }
  const res = await fetch(url, {
    method,
    headers: {
      "User-Agent": USER_AGENT,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  readRateLimitHeaders(res);
  if (res.status === 429) {
    throw new Error(`Modrinth rate limit hit - resets in ${rateLimit.resetSeconds ?? "?"}s`);
  }
  if (!res.ok) {
    throw new Error(`Modrinth API ${method} ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
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
} = {}) {
  const facets = buildFacets({ projectType, loaders, gameVersions, categories, environment, openSource });
  return request("/search", {
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
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  readRateLimitHeaders(res);
  if (!res.ok) throw new Error(`Modrinth server search failed: ${res.status}`);
  const body = await res.json();
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

async function getProject(idOrSlug) {
  return request(`/project/${encodeURIComponent(idOrSlug)}`);
}

/** Batch project lookup - one call for a known set of IDs instead of N. */
async function getProjects(ids) {
  return request("/projects", { query: { ids: JSON.stringify(ids) } });
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
  buildFacets,
  searchProjects,
  getProject,
  getProjects,
  getProjectVersions,
  getProjectDependencies,
  checkForUpdates,
  getVersionsFromHashes,
  getTags,
  rateLimitStatus,
};
