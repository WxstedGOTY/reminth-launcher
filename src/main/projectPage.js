"use strict";
/**
 * Everything the project page in Discover shows, in one answer:
 * { project, body, people, builds, fetchedAt }.
 *
 *  - project: only the fields the page uses, with every link already
 *    checked (https only) and every picture already limited to Modrinth's
 *    CDN / the avatar host - the page never decides that itself.
 *  - body: the description parsed here (renderer/markdown.js parse(), pure)
 *    into a tree of plain objects, so a huge description costs the main
 *    process a moment, never the window.
 *  - people: the team (or the organisation that owns the project).
 *  - builds: every version, small (number, channel, game versions, loaders,
 *    date, downloads); the newest MAX_CHANGELOGS also carry their changelog
 *    text (capped), parsed by the page only when a row is opened.
 *
 * One Modrinth request each for the project, its versions and its team, all
 * through modrinth.js (retries and rate-limit waits live there). Answers are
 * kept for CACHE_MS; a failure is never cached.
 */
const md = require("../renderer/markdown");

const CACHE_MS = 5 * 60 * 1000;
const CACHE_MAX = 30;
const MAX_CHANGELOGS = 50;
const MAX_CHANGELOG_CHARS = 20000;
const MAX_BUILDS = 3000;
const MAX_GALLERY = 40;

const cache = new Map(); // id or slug (lower case) -> { at, value }

const str = (v, max = 300) => (typeof v === "string" ? v.slice(0, max) : null);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const strList = (v, max = 400) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, max).map((x) => x.slice(0, 64)) : []);

/** Pure: the page's view of a Modrinth project (links checked, pictures limited). */
function shapeProject(p) {
  const links = [];
  const add = (kind, label, url) => {
    const href = md.safeLink(url);
    if (href) links.push({ kind, label, href });
  };
  add("source", "Source code", p.source_url);
  add("issues", "Report an issue", p.issues_url);
  add("wiki", "Wiki", p.wiki_url);
  add("discord", "Discord", p.discord_url);
  for (const d of Array.isArray(p.donation_urls) ? p.donation_urls.slice(0, 8) : []) {
    if (d && typeof d === "object") add("donate", `Donate${d.platform ? ` (${String(d.platform).slice(0, 40)})` : ""}`, d.url);
  }
  const slug = str(p.slug, 80);
  const type = str(p.project_type, 20) || "mod";
  const modrinthUrl = md.safeLink(`https://modrinth.com/${encodeURIComponent(type)}/${encodeURIComponent(slug || str(p.id, 20) || "")}`);
  const license = p.license && typeof p.license === "object" ? { id: str(p.license.id, 80), name: str(p.license.name, 120), url: md.safeLink(p.license.url) } : null;
  const gallery = (Array.isArray(p.gallery) ? p.gallery : [])
    .filter((g) => g && typeof g === "object")
    .sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || num(a.ordering) - num(b.ordering))
    .map((g) => ({ url: md.imageAllowed(g.url), full: md.imageAllowed(g.raw_url || g.url), link: md.safeLink(g.raw_url || g.url), title: str(g.title, 200), description: str(g.description, 600) }))
    .slice(0, MAX_GALLERY);
  return {
    id: str(p.id, 20),
    slug,
    type,
    title: str(p.title, 200) || slug || "Project",
    summary: str(p.description, 600),
    icon: md.imageAllowed(p.icon_url),
    downloads: num(p.downloads),
    followers: num(p.followers),
    updated: str(p.updated, 40),
    published: str(p.published, 40),
    categories: strList(p.categories, 30),
    clientSide: str(p.client_side, 20),
    serverSide: str(p.server_side, 20),
    loaders: strList(p.loaders, 40),
    gameVersions: strList(p.game_versions, 1000),
    license,
    links,
    modrinthUrl,
    gallery,
    teamId: str(p.team, 20),
    organizationId: str(p.organization, 20),
  };
}

/** Pure: one build, small. `withChangelog` keeps its (capped) changelog text. */
function shapeBuild(v, withChangelog) {
  const changelog = withChangelog && typeof v.changelog === "string" ? v.changelog.slice(0, MAX_CHANGELOG_CHARS) : null;
  return {
    id: str(v.id, 20),
    name: str(v.name, 200),
    number: str(v.version_number, 80),
    type: ["release", "beta", "alpha"].includes(v.version_type) ? v.version_type : "release",
    mc: strList(v.game_versions, 400),
    loaders: strList(v.loaders, 20),
    date: str(v.date_published, 40),
    downloads: num(v.downloads),
    ...(withChangelog ? { changelog, changelogCut: typeof v.changelog === "string" && v.changelog.length > MAX_CHANGELOG_CHARS } : {}),
  };
}

/** Pure: the people to credit - team members (owner first) or the organisation. */
function shapePeople(team, org) {
  if (org && typeof org === "object" && (org.name || org.slug)) {
    return [{ name: str(org.name || org.slug, 80), role: "Organisation", avatar: md.imageAllowed(org.icon_url), owner: true, url: md.safeLink(`https://modrinth.com/organization/${encodeURIComponent(str(org.slug, 80) || "")}`) }];
  }
  return (Array.isArray(team) ? team : [])
    .filter((m) => m && m.user && typeof m.user.username === "string" && m.accepted !== false)
    .sort((a, b) => Number(Boolean(b.is_owner)) - Number(Boolean(a.is_owner)) || num(a.ordering) - num(b.ordering))
    .slice(0, 12)
    .map((m) => ({
      name: str(m.user.username, 60),
      role: str(m.role, 60),
      avatar: md.imageAllowed(m.user.avatar_url),
      owner: Boolean(m.is_owner),
      url: md.safeLink(`https://modrinth.com/user/${encodeURIComponent(m.user.username)}`),
    }));
}

/**
 * The whole page for one project id or slug. deps (tests): { modrinth, now }.
 * Throws the Modrinth error when the project itself can't be read; the team
 * and the version list are best effort (the page says when they're missing).
 */
async function getProjectPage(idOrSlug, deps = {}) {
  // Modrinth ids are case-sensitive (base62: "AANobbMI"), so Modrinth is
  // asked with the id exactly as given; only the cache key is lower case.
  const asked = String(idOrSlug || "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(asked)) throw new Error("That project isn't valid.");
  const key = asked.toLowerCase();
  const now = deps.now || Date.now;
  const hit = cache.get(key);
  if (hit && now() - hit.at < CACHE_MS) return hit.value;
  const api = deps.modrinth || require("./modrinth");

  const [raw, versions] = await Promise.all([
    api.getProject(asked),
    Promise.resolve()
      .then(() => api.getProjectVersions(asked, {}))
      .catch(() => null),
  ]);
  if (!raw || typeof raw !== "object") throw new Error("Modrinth didn't send that project.");
  const project = shapeProject(raw);

  let people = [];
  try {
    if (project.organizationId && api.getOrganizations) {
      const orgs = await api.getOrganizations([project.organizationId]);
      people = shapePeople(null, Array.isArray(orgs) ? orgs[0] : null);
    }
    if (!people.length && project.teamId && api.getTeams) {
      const teams = await api.getTeams([project.teamId]);
      people = shapePeople(Array.isArray(teams) ? teams[0] : null, null);
    }
  } catch {
    people = []; // credited by name from the search result instead
  }

  const list = Array.isArray(versions) ? versions.filter((v) => v && typeof v === "object") : null;
  if (list) list.sort((a, b) => String(b.date_published || "").localeCompare(String(a.date_published || "")));
  const builds = list ? list.slice(0, MAX_BUILDS).map((v, i) => shapeBuild(v, i < MAX_CHANGELOGS)) : null;

  const value = { project, body: md.parse(typeof raw.body === "string" ? raw.body : ""), people, builds, fetchedAt: now() };
  cache.set(key, { at: now(), value });
  if (project.id) cache.set(project.id.toLowerCase(), { at: now(), value });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return value;
}

/** Forget what was kept (tests). */
function clearCache() {
  cache.clear();
}

module.exports = { getProjectPage, clearCache, shapeProject, shapeBuild, shapePeople, CACHE_MS };
