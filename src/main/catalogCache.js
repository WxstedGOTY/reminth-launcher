"use strict";

/**
 * Local cache of the Modrinth catalog. Metadata only - names, authors,
 * download counts, icon URLs, descriptions - never the actual mod jars
 * (those only get fetched on install, through the download manager's own
 * checksum-verified path, not this module).
 *
 * Storage: plain JSON files under paths.CATALOG_CACHE_DIR, one per project
 * type, read into memory and written back atomically (temp file + rename,
 * same crash-safe pattern used for installs elsewhere in this app).
 *
 * This was originally better-sqlite3, but that's a native module requiring
 * a C++ compiler toolchain (Visual Studio Build Tools on Windows) to build
 * from source when no prebuilt binary matches the local Node/Electron ABI -
 * confirmed as a real, immediate blocker on a clean Windows install, not a
 * hypothetical one. At this scale (low thousands of rows per type, not
 * millions) a JSON file plus in-memory array filtering is genuinely fine
 * performance-wise and needs zero extra dependencies, zero compile step,
 * and zero electron-rebuild/ABI risk on anyone's machine, ever.
 */

const fs = require("fs");
const path = require("path");
const paths = require("./paths");
const modrinth = require("./modrinth");

const memCache = new Map(); // projectType -> array of project records
let statusCache = null; // { [projectType]: { cached_count, target_count, state, error, updated_at } }

function ensureDir() {
  fs.mkdirSync(paths.CATALOG_CACHE_DIR, { recursive: true });
}

function projectsFile(projectType) {
  return path.join(paths.CATALOG_CACHE_DIR, `${projectType}.json`);
}

function statusFile() {
  return path.join(paths.CATALOG_CACHE_DIR, "status.json");
}

/** Write via a temp file + rename, so a crash mid-write never leaves a
 *  truncated/corrupt cache file behind. */
function writeJsonAtomic(file, data) {
  ensureDir();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function loadProjects(projectType) {
  if (memCache.has(projectType)) return memCache.get(projectType);
  const rows = readJson(projectsFile(projectType), []);
  memCache.set(projectType, rows);
  return rows;
}

function loadStatus() {
  if (statusCache) return statusCache;
  statusCache = readJson(statusFile(), {});
  return statusCache;
}

function saveStatus() {
  writeJsonAtomic(statusFile(), statusCache);
}

function upsertProjects(projectType, hits) {
  const existing = loadProjects(projectType);
  const byId = new Map(existing.map((p) => [p.id, p]));
  const now = Date.now();
  for (const hit of hits) {
    byId.set(hit.project_id, {
      id: hit.project_id,
      slug: hit.slug || null,
      project_type: projectType,
      title: hit.title,
      author: hit.author || null,
      description: hit.description || null,
      downloads: hit.downloads || 0,
      follows: hit.follows || 0,
      icon_url: hit.icon_url || null,
      categories: hit.categories || [],
      date_created: hit.date_created || null,
      date_modified: hit.date_modified || null,
      fetched_at: now,
    });
  }
  const merged = [...byId.values()];
  memCache.set(projectType, merged);
  writeJsonAtomic(projectsFile(projectType), merged);
}

/** Read from the local cache - instant, no network. */
function getCached({ projectType, query = "", sort = "downloads", offset = 0, limit = 50 } = {}) {
  let rows = loadProjects(projectType);
  const q = query.trim().toLowerCase();
  if (q) {
    rows = rows.filter(
      (r) =>
        r.title?.toLowerCase().includes(q) ||
        r.author?.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q)
    );
  }
  const sortKey = sort === "follows" ? "follows" : sort === "newest" ? "date_created" : "downloads";
  rows = [...rows].sort((a, b) => (b[sortKey] > a[sortKey] ? 1 : b[sortKey] < a[sortKey] ? -1 : 0));
  return { hits: rows.slice(offset, offset + limit), total: rows.length };
}

/**
 * Look up specific cached projects by their Modrinth slug. Used by the UI
 * to put a project's real icon on a card it already knows the name of (the
 * Discover grid on Home, the Fabric API card) instead of a letter mark,
 * without a network call or a search that might match the wrong thing.
 *
 * Returns { slug: record } and simply omits anything not cached yet - a
 * caller gets a partial answer rather than an error while the first
 * warm-up is still running.
 */
function getBySlugs(projectType, slugs) {
  const wanted = new Set((Array.isArray(slugs) ? slugs : []).map((s) => String(s).toLowerCase()));
  const found = {};
  if (!wanted.size) return found;
  for (const row of loadProjects(projectType)) {
    const slug = String(row.slug || "").toLowerCase();
    if (wanted.has(slug)) found[slug] = row;
  }
  return found;
}

function getWarmStatus(projectType) {
  const status = loadStatus();
  return (
    status[projectType] || {
      project_type: projectType,
      cached_count: 0,
      target_count: 0,
      state: "idle",
      error: null,
      updated_at: 0,
    }
  );
}

function setWarmStatus(projectType, patch) {
  const status = loadStatus();
  const next = { ...getWarmStatus(projectType), ...patch, updated_at: Date.now() };
  status[projectType] = next;
  saveStatus();
  return next;
}

let warming = new Set();

// Single-stream pacing between requests within one category's warm run.
// 350ms -> ~2.85 req/sec -> ~171 req/min, with margin under the more
// conservative of Modrinth's two observed limits (200-300/min) even across
// a long run (10,000 projects/type is 100 requests, ~35s at this pacing).
const REQUEST_PACING_MS = 350;

/** One page fetch, with a single retry on a 429 rather than letting a
 *  mid-run rate-limit hit kill the whole category. Backs off for whatever
 *  Modrinth's reset header says (modrinth.js already parses it into
 *  rateLimitStatus()), or 5s if that header wasn't present. */
async function fetchPageWithRetry({ projectType, offset, limit }, attempt = 1) {
  try {
    return await modrinth.searchProjects({ projectType, index: "downloads", offset, limit });
  } catch (err) {
    if (attempt < 3 && /rate limit/i.test(err.message)) {
      const waitMs = (modrinth.rateLimitStatus().resetSeconds || 5) * 1000 + 500;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return fetchPageWithRetry({ projectType, offset, limit }, attempt + 1);
    }
    throw err;
  }
}

/**
 * Pull the top `targetCount` projects of `projectType` sorted by downloads
 * from the live API, 100 at a time (Modrinth's per-page max), and store
 * them locally. A type with fewer than `targetCount` real projects (e.g.
 * shaders, ~900 total) just stops early when a page comes back short or
 * empty - not an error.
 *
 * Safe to call repeatedly: it's a full resync each time (upsert, not
 * append), meant to be re-run periodically (e.g. on launch, if the last
 * warm is more than a day old) rather than kept running continuously.
 *
 * Only paces itself against Modrinth's limit - it assumes it's the only
 * warm running at a time. Callers must not run multiple categories
 * concurrently (see warmAllCachesIfStale in main.js), since two paced
 * streams running on top of each other multiplies the actual request rate
 * with no shared budget between them.
 */
async function warmCatalog(projectType, { targetCount = 1000, pageSize = 100, onProgress } = {}) {
  if (warming.has(projectType)) return getWarmStatus(projectType); // already running
  warming.add(projectType);
  setWarmStatus(projectType, { state: "running", target_count: targetCount, cached_count: 0, error: null });
  try {
    let fetched = 0;
    for (let offset = 0; offset < targetCount; offset += pageSize) {
      const limit = Math.min(pageSize, targetCount - offset);
      const page = await fetchPageWithRetry({ projectType, offset, limit });
      if (!page.hits.length) break; // fewer than targetCount exist for this type - not an error
      upsertProjects(projectType, page.hits);
      fetched += page.hits.length;
      const status = setWarmStatus(projectType, { cached_count: fetched });
      onProgress?.(status);
      if (page.hits.length < limit) break; // reached the end of what Modrinth has
      await new Promise((resolve) => setTimeout(resolve, REQUEST_PACING_MS));
    }
    const finalStatus = setWarmStatus(projectType, { state: "done" });
    onProgress?.(finalStatus);
    return finalStatus;
  } catch (err) {
    const errorStatus = setWarmStatus(projectType, { state: "error", error: err.message });
    onProgress?.(errorStatus);
    throw err;
  } finally {
    warming.delete(projectType);
  }
}

module.exports = {
  getCached,
  getBySlugs,
  getWarmStatus,
  warmCatalog,
};
