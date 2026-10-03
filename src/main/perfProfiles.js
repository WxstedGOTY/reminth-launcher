"use strict";
/**
 * Per-instance performance profiles: "balanced" (the default, also what an
 * instance without the field gets), "max-fps" and "far-view".
 *
 * What a profile changes:
 *  - a starting options.txt for a brand-new instance (gameOptions.js) -
 *    never for one that has its own settings;
 *  - far-view: the automatic memory of a modpack (main.js defaultMemoryFor),
 *    because long view distances hold more chunks in memory;
 *  - a list of extra mods the player MAY add. Nothing here is installed by
 *    itself: the player ticks what they want, and those become ordinary mods
 *    they can switch off or remove like any other.
 *
 * Slugs are Modrinth's, from PERF_PLAN.md's API check (2 Oct 2026). Each one
 * is looked up again for the instance before it's offered, so a slug that
 * stops existing shows as "not available" instead of failing an install.
 */

const PROFILE_IDS = ["balanced", "max-fps", "far-view"];
const DEFAULT_PROFILE = "balanced";

const MOD_LOADERS = ["fabric", "quilt", "forge", "neoforge"];
const FABRIC_LIKE = ["fabric", "quilt"];

const SERVER_RULES = "Some competitive servers don't allow mods that show terrain past the server's view distance - check a server's rules first.";

const PROFILES = {
  balanced: {
    id: "balanced",
    title: "Balanced",
    description: [
      "Reminth's performance pack and Java settings, with Minecraft's own video settings.",
      "Nothing about how the game looks or plays is changed.",
    ],
    extras: [],
  },
  "max-fps": {
    id: "max-fps",
    title: "Max FPS",
    description: [
      "A new instance starts with render distance 10, simulation distance 8, fewer particles, no entity shadows, V-Sync off and no frame cap. Things more than 8 chunks away stop growing and moving in singleplayer.",
      "Applied to new instances only; your existing settings are never changed.",
    ],
    extras: [
      {
        slug: "dynamic-fps",
        title: "Dynamic FPS",
        why: "Slows the game down while it's in the background or you're away, so your PC runs cooler and other apps stay quick. It doesn't raise in-game FPS.",
        loaders: MOD_LOADERS,
      },
      {
        slug: "badoptimizations",
        title: "BadOptimizations",
        why: "Small speed-ups to lighting, sky and entity code. Nothing looks different.",
        loaders: MOD_LOADERS,
      },
      {
        slug: "moreculling",
        title: "More Culling",
        why: "Skips drawing more hidden things (leaves, signs, item frames) on top of what the performance pack already skips.",
        loaders: MOD_LOADERS,
      },
    ],
  },
  "far-view": {
    id: "far-view",
    title: "Far view",
    description: [
      "A new instance starts with a longer render distance picked for this PC (16 to 24 chunks), simulation distance 8, and more memory. Things more than 8 chunks away stop growing and moving in singleplayer.",
      "Applied to new instances only; your existing settings are never changed.",
    ],
    extras: [
      {
        slug: "distanthorizons",
        title: "Distant Horizons",
        why: "Shows simplified far-away terrain past your render distance. Uses extra CPU, memory and disk while it builds that terrain.",
        warning: SERVER_RULES,
        loaders: MOD_LOADERS,
      },
      {
        slug: "bobby",
        title: "Bobby",
        why: "Keeps chunks a server sent you on disk and keeps showing them past the server's view distance. Only does something in multiplayer.",
        warning: SERVER_RULES,
        loaders: FABRIC_LIKE,
      },
      {
        slug: "c2me-fabric",
        title: "C2ME",
        why: "Generates and loads singleplayer chunks on several CPU cores at once.",
        experimental: true,
        warning: "Experimental (alpha). It can freeze world creation or damage a world. Back up your worlds first.",
        loaders: FABRIC_LIKE,
      },
    ],
  },
};

/** Pure: a profile id, or the default for anything else. */
function normaliseProfile(value) {
  return PROFILE_IDS.includes(value) ? value : DEFAULT_PROFILE;
}

/** Pure: what the renderer shows - [{ id, title, description: [line, line] }]. */
function list() {
  return PROFILE_IDS.map((id) => ({ id, title: PROFILES[id].title, description: [...PROFILES[id].description] }));
}

/** Pure: the extras offered to one instance (by its profile and loader). */
function extrasFor(instance) {
  const loader = instance && instance.loader;
  if (!MOD_LOADERS.includes(loader)) return [];
  return PROFILES[normaliseProfile(instance.perfProfile)].extras.filter((e) => e.loaders.includes(loader));
}

/** Pure: the most stable channel in a version list ("release" > "beta" > "alpha"), or null. */
function bestChannel(versions) {
  const types = new Set((Array.isArray(versions) ? versions : []).map((v) => v && v.version_type));
  for (const channel of ["release", "beta", "alpha"]) if (types.has(channel)) return channel;
  return null;
}

/**
 * The extras for one instance, each checked against Modrinth for its
 * Minecraft version and loader:
 * [{ slug, title, why, experimental, warning, available, channel, installed }]
 *  - available: true (a build exists), false (none, or no such project),
 *    null (Modrinth couldn't be asked - unknown, not "no").
 *  - channel: the most stable build type there is, so the page can say
 *    "beta" honestly; null when unknown.
 *  - installed: whether Reminth's content list already has that project in
 *    this instance; null when it couldn't be told.
 * deps: { modrinth, content } (the real ones by default; tests pass fakes).
 * Never throws.
 */
async function listExtras(instance, deps = {}) {
  const extras = extrasFor(instance);
  if (!extras.length) return [];
  const modrinth = deps.modrinth || require("./modrinth");
  const content = deps.content || require("./content");
  let projectIds = new Set();
  try {
    const manifest = await content.readManifest(instance.gameDir);
    projectIds = new Set(
      Object.values((manifest && manifest.files) || {})
        .filter((f) => f && f.projectId)
        .map((f) => f.projectId)
    );
  } catch {
    // nothing known installed - `installed` comes back false or null below
  }
  let loaders = [];
  try {
    loaders = content.loadersFor("mod", instance);
  } catch {
    loaders = [];
  }
  return Promise.all(
    extras.map(async (extra) => {
      const row = {
        slug: extra.slug,
        title: extra.title,
        why: extra.why,
        experimental: extra.experimental === true,
        warning: extra.warning || null,
        available: null,
        channel: null,
        installed: null,
      };
      try {
        const versions = await modrinth.getProjectVersions(extra.slug, { loaders, gameVersions: [instance.mcVersion] });
        const list = Array.isArray(versions) ? versions : [];
        row.available = list.length > 0;
        row.channel = bestChannel(list);
        const projectId = list.length ? list[0].project_id : null;
        row.installed = projectId ? projectIds.has(projectId) : false;
      } catch (err) {
        // A project that doesn't exist (any more) is "not available"; any
        // other failure (offline, rate limit) is "don't know".
        if (/\b404\b/.test(String((err && err.message) || ""))) {
          row.available = false;
          row.installed = false;
        }
      }
      return row;
    })
  );
}

module.exports = {
  PROFILE_IDS,
  DEFAULT_PROFILE,
  PROFILES,
  normaliseProfile,
  list,
  extrasFor,
  bestChannel,
  listExtras,
};
