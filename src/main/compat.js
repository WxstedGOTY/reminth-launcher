"use strict";
/**
 * Compatibility help: the part of Reminth that stops "Incompatible mods
 * found!" from being something the player has to solve by trial and error.
 *
 *  - checkInstance():  looks at every enabled mod in an instance and says
 *    which ones will not load on its Minecraft version / loader, why, and
 *    what one click fixes it (swap to the right build, add what's missing,
 *    switch a duplicate off).
 *  - adviseVersions(): given the mods in an instance (and optionally the
 *    versions a server accepts), works out which Minecraft version fits the
 *    most of them, so nobody has to check each mod by hand.
 *  - projectSupport(): for one mod, which Minecraft versions it has builds
 *    for - shown when an install fails for lack of a matching build.
 *
 * Two sources of truth, in this order:
 *  1. The jar's own fabric.mod.json "depends.minecraft". This is exactly
 *     what Fabric enforces at startup, so when it can be read it wins.
 *  2. Modrinth's list of game versions for that exact file. Authors often
 *     don't tick newer versions a build still works on, so a mismatch here
 *     alone is only ever a warning, never "this will stop the game".
 *
 * Anything that can't be decided is left alone: a wrong "incompatible"
 * warning is the very thing this file exists to get rid of.
 */
const path = require("path");
const fsp = require("fs").promises;

const modrinth = require("./modrinth");
const content = require("./content");
const config = require("./config");

const LOADER_TITLES = { fabric: "Fabric", quilt: "Quilt", forge: "Forge", neoforge: "NeoForge", vanilla: "vanilla" };
// Slugs, not ids: Modrinth accepts either, and a slug can't be mistyped into
// some other project.
const FABRIC_API = "fabric-api";
const QUILT_API = "qsl";
// Ids a Fabric mod's "depends" can name that mean "the Fabric API".
const FABRIC_API_KEYS = new Set(["fabric-api", "fabric"]);
const FABRIC_API_PROVIDERS = new Set(["fabric-api", "fabric", "quilted_fabric_api", "qsl"]);

/* ------------------------------------------------------------------ */
/* versions (pure)                                                    */
/* ------------------------------------------------------------------ */

/**
 * Pure: a release version as numbers - "1.21.4" -> [1,21,4], "1.21" ->
 * [1,21,0], "26.1" -> [26,1,0]. Snapshots, pre-releases and anything else
 * return null: they are never guessed at.
 */
function parseMcVersion(v) {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(String(v || "").trim());
  return m ? [Number(m[1]), Number(m[2]), m[3] === undefined ? 0 : Number(m[3])] : null;
}

function compareTriples(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

/** Pure: newest-first comparison of two version ids; unparseable ones sort last. */
function compareMcVersionsDesc(a, b) {
  const pa = parseMcVersion(a);
  const pb = parseMcVersion(b);
  if (pa && pb) return compareTriples(pb, pa);
  if (pa) return -1;
  if (pb) return 1;
  return String(b).localeCompare(String(a));
}

/**
 * Pure: a version the way Fabric reads it - numbers separated by dots, an
 * optional "-prerelease", and "+build" ignored. "0.6.13+mc1.21.4" ->
 * { nums: [0,6,13], pre: null }; "1.21-" and "1.21-beta.3" are pre-releases
 * of 1.21. Returns null for anything else (Fabric only supports "equals"
 * on those, and nothing is guessed about them here). That includes a
 * leading "v": to Fabric "v1.2.3" is a plain string, not the number 1.2.3,
 * so comparing it as one would give verdicts Fabric never reaches.
 */
function parseVer(text) {
  const m = /^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]*))?(?:\+[0-9A-Za-z.+_-]*)?$/.exec(String(text || "").trim());
  if (!m) return null;
  return { nums: m[1].split(".").map(Number), pre: m[2] === undefined ? null : m[2] };
}

function comparePre(a, b) {
  const pa = a.split(".");
  const pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    const na = /^\d+$/.test(pa[i]);
    const nb = /^\d+$/.test(pb[i]);
    if (na && nb) {
      if (Number(pa[i]) !== Number(pb[i])) return Number(pa[i]) < Number(pb[i]) ? -1 : 1;
    } else if (na !== nb) return na ? -1 : 1;
    else if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/** Pure: -1 / 0 / 1. Missing trailing numbers count as 0; a pre-release is older than its release. */
function compareVer(a, b) {
  for (let i = 0; i < Math.max(a.nums.length, b.nums.length); i++) {
    const x = a.nums[i] || 0;
    const y = b.nums[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  if (a.pre === null && b.pre === null) return 0;
  if (a.pre === null) return 1;
  if (b.pre === null) return -1;
  return comparePre(a.pre, b.pre);
}

/**
 * Pure: does ONE term of a Fabric version predicate allow this version?
 * true / false, or null when the term isn't understood.
 */
function termAllows(term, ver) {
  const t = term.trim();
  if (!t || t === "*") return true;
  // 1.21.x, 1.21.*, 1.x
  const wild = /^(\d+(?:\.\d+)*)\.[xX*]$/.exec(t);
  if (wild) {
    const want = wild[1].split(".").map(Number);
    return want.every((n, i) => (ver.nums[i] || 0) === n);
  }
  const m = /^(>=|<=|>|<|=|~|\^)?\s*(.+)$/.exec(t);
  if (!m) return null;
  const op = m[1] || "=";
  const bound = parseVer(m[2].trim());
  if (!bound) return null;
  const c = compareVer(ver, bound);
  const same = (i) => (ver.nums[i] || 0) === (bound.nums[i] || 0);
  switch (op) {
    case ">=":
      return c >= 0;
    case "<=":
      return c <= 0;
    case ">":
      return c > 0;
    case "<":
      return c < 0;
    case "=":
      return c === 0;
    case "~":
      // same minor: ~1.21.4 is >=1.21.4 and <1.22
      return c >= 0 && same(0) && same(1);
    case "^":
      // same major: ^1.21.4 is >=1.21.4 and <2
      return c >= 0 && same(0);
    default:
      return null;
  }
}

/**
 * Pure: what Fabric decides for a version predicate against a version.
 * A string is terms separated by spaces, ALL of which must hold; an array is
 * alternatives, ANY of which may hold. Returns true / false, or null when
 * the version or any deciding part can't be read - in which case nothing is
 * claimed either way.
 */
function versionSatisfies(predicate, versionText) {
  const ver = parseVer(versionText);
  const alternatives = Array.isArray(predicate) ? predicate : [predicate];
  if (!alternatives.length) return null;
  // "*" means any version at all, even one that can't be read as numbers.
  if (!ver) return alternatives.some((a) => typeof a === "string" && a.trim() === "*") ? true : null;
  let sawUnknown = false;
  for (const alt of alternatives) {
    if (typeof alt !== "string") return null;
    const terms = alt.trim().split(/\s+/).filter(Boolean);
    let all = true;
    let unknown = false;
    for (const term of terms) {
      const r = termAllows(term, ver);
      if (r === null) unknown = true;
      else if (!r) all = false;
    }
    // A term that fails settles this alternative as "no" even if another
    // term in it couldn't be read; only an alternative that might still be
    // true leaves the answer open.
    if (!all) continue;
    if (unknown) sawUnknown = true;
    else return true;
  }
  return sawUnknown ? null : false;
}

/**
 * Pure: what Fabric decides for a mod's "depends.minecraft" on this
 * instance. Only plain releases are judged - on a snapshot nothing is
 * claimed.
 */
function fabricPredicateAllows(predicate, mcVersion) {
  if (!parseMcVersion(mcVersion)) return null;
  return versionSatisfies(predicate, mcVersion);
}

/** Pure: a Fabric predicate as words - ">=1.21.2 <1.21.5" -> "1.21.2 or newer, older than 1.21.5". */
function describePredicate(predicate) {
  const one = (alt) =>
    String(alt)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => {
        const m = /^(>=|<=|>|<|=|~|\^)?\s*(.+)$/.exec(t);
        if (!m) return t;
        const v = m[2];
        switch (m[1]) {
          case ">=":
            return `${v} or newer`;
          case "<=":
            return `${v} or older`;
          case ">":
            return `newer than ${v}`;
          case "<":
            return `older than ${v}`;
          case "~":
            return `${v} and its later patches`;
          case "^":
            return `${v} or newer`;
          default:
            return v;
        }
      })
      .join(", ");
  return (Array.isArray(predicate) ? predicate : [predicate]).map(one).join(" or ");
}

/**
 * Pure: a list of game versions as something short to read -
 * ["1.21","1.21.1","1.21.3","1.20.1"] -> "1.21.3, 1.21.1, 1.21, 1.20.1"
 * (newest first, releases only, at most `max` then "+N more").
 */
function summariseVersions(list, max = 4) {
  const releases = [...new Set((list || []).filter((v) => parseMcVersion(v)))].sort(compareMcVersionsDesc);
  if (!releases.length) return (list || []).slice(0, max).join(", ");
  if (releases.length <= max) return releases.join(", ");
  return `${releases.slice(0, max).join(", ")} +${releases.length - max} more`;
}

/**
 * Pure: the Minecraft versions a server says it takes, out of free text
 * like "Paper 1.21.4", "Velocity 1.7.2-1.21.4", "1.20.x", "1.20.4+" or
 * "Requires MC 1.8 / 1.21". Returns { list, min, max } with whichever the
 * text supports, or null when it names no version at all. `max: null` next
 * to a `min` means "that version or anything newer".
 */
function versionsFromServerText(text) {
  // Colour codes ("§a1.8") are decoration; left in, the "a" glued to the
  // number hides the version behind it.
  const s = String(text || "").replace(/§./g, "");
  // Only numbers that can be a Minecraft version: "Velocity 3.3.0" is the
  // proxy's own version, not a game version. The year-numbered scheme
  // (26.1 …) is only believed up to next year - "47.3.5" is a Forge build
  // number, not Minecraft from 2047.
  const newestYear = Math.max(26, new Date().getFullYear() % 100) + 1;
  const plausible = (v) => {
    if (/^1\.\d{1,2}(\.\d{1,2})?$/.test(v)) return true;
    const m = /^(\d{2})\.\d{1,2}(\.\d{1,2})?$/.exec(v);
    return Boolean(m) && Number(m[1]) >= 25 && Number(m[1]) <= newestYear;
  };
  // One version, possibly ending ".x": [whole, "1.21", "4" | "x" | undefined]
  const one = "(\\d+\\.\\d+)(?:\\.(\\d+|[xX*]))?";
  const exact = (patch) => patch !== undefined && /^\d+$/.test(patch);
  const lowest = (end) => (exact(end.patch) ? `${end.base}.${end.patch}` : end.base);
  // "up to 1.21" means 1.21 and its patches, the same as "1.21.x".
  const highest = (end) => (exact(end.patch) ? `${end.base}.${end.patch}` : `${end.base}.99`);
  const range = new RegExp(`${one}\\s*(?:-|–|—|to)\\s*${one}`, "i").exec(s);
  // Both ends have to be game versions: in "Mohist 1.20.1-47.3.5" the
  // second number is the Forge build, and the server takes 1.20.1 only.
  if (range && plausible(range[1]) && plausible(range[3])) {
    let lo = { base: range[1], patch: range[2] };
    let hi = { base: range[3], patch: range[4] };
    if (compareMcVersionsDesc(lowest(lo), lowest(hi)) < 0) [lo, hi] = [hi, lo];
    return { list: null, min: lowest(lo), max: highest(hi) };
  }
  // "1.20.4+": that version or newer, with no upper end.
  const orNewer = /(\d+\.\d+(?:\.\d+)?)\+(?![\w.])/.exec(s);
  if (orNewer && plausible(orNewer[1])) return { list: null, min: orNewer[1], max: null };
  const wild = /(\d+\.\d+)\.[xX*]/.exec(s);
  if (wild && plausible(wild[1])) return { list: null, min: wild[1], max: `${wild[1]}.99` };
  const all = (s.match(/\d+\.\d+(?:\.\d+)?/g) || []).filter(plausible);
  if (!all.length) return null;
  return { list: [...new Set(all)], min: null, max: null };
}

/**
 * Pure: can someone on `mcVersion` join a server that takes `accepts`?
 * `accepts` is an array of version ids, or the object versionsFromServerText
 * returns. true / false, or null when there is nothing to go on.
 */
function serverAccepts(accepts, mcVersion) {
  if (!accepts) return null;
  if (Array.isArray(accepts)) return accepts.length ? accepts.includes(mcVersion) : null;
  if (accepts.list && accepts.list.length) return accepts.list.includes(mcVersion);
  const mc = parseMcVersion(mcVersion);
  const lo = parseMcVersion(accepts.min);
  if (!mc || !lo) return null;
  // No upper end ("1.20.4+"): anything from `min` up.
  if (accepts.max === null || accepts.max === undefined) return compareTriples(mc, lo) >= 0;
  const hi = parseMcVersion(accepts.max);
  if (!hi) return null;
  return compareTriples(mc, lo) >= 0 && compareTriples(mc, hi) <= 0;
}

/* ------------------------------------------------------------------ */
/* judging one mod (pure)                                             */
/* ------------------------------------------------------------------ */

const isFabricLike = (loader) => loader === "fabric" || loader === "quilt";
const isForgeLike = (loader) => loader === "forge" || loader === "neoforge";

/**
 * Pure: is this jar written for a loader the instance doesn't run?
 * Only claimed when the jar plainly belongs to the other family and has
 * nothing for this one. `hasConnector` is true when a mod that runs Fabric
 * mods on NeoForge is installed, which makes Fabric jars fine there.
 */
function wrongLoaderFamily(descriptors, loader, hasConnector) {
  if (!descriptors) return false;
  const fabricSide = descriptors.fabric || descriptors.quilt;
  const forgeSide = descriptors.forge || descriptors.neoforge;
  if (isFabricLike(loader)) return Boolean(forgeSide && !fabricSide);
  if (isForgeLike(loader)) return Boolean(fabricSide && !forgeSide && !hasConnector);
  return false;
}

/**
 * Pure: does the loader hold this jar to what its fabric.mod.json demands?
 *  - not a server-only mod: Fabric skips those on the client altogether, so
 *    nothing they ask for can stop the game;
 *  - not, on Quilt, a jar that also has a quilt.mod.json: Quilt reads that
 *    file instead, and its demands aren't read here.
 */
function fabricRulesApply(item, loader) {
  const d = item && item.descriptors;
  if (!isFabricLike(loader) || !d || !d.fabric) return false;
  if (item.environment === "server") return false;
  if (loader === "quilt" && d.quilt) return false;
  return true;
}

/**
 * Pure: the verdict for one enabled mod jar.
 *   item      what content.listAll says about the file (descriptors, mcDep…)
 *   version   the Modrinth version this exact file is, or null
 *   instance  { mcVersion, loader }
 *   wanted    the Modrinth loader names that work here (content.loadersFor)
 * Returns null when there's nothing wrong (or nothing certain), else
 * { severity: "blocked" | "warn", reason, madeFor, detail }.
 */
function judgeMod(item, version, instance, wanted, hasConnector) {
  const loaderName = LOADER_TITLES[instance.loader] || instance.loader;
  if (wrongLoaderFamily(item.descriptors, instance.loader, hasConnector)) {
    const made = isFabricLike(instance.loader) ? "Forge/NeoForge" : "Fabric";
    return {
      severity: "warn",
      reason: "wrong-loader",
      madeFor: made,
      detail: `This is a ${made} mod. ${loaderName} won't load it, so it does nothing here.`,
    };
  }
  // What the jar itself demands - the same check Fabric runs at startup.
  // Not for a jar the loader never applies those demands to (see
  // fabricRulesApply).
  let local = null;
  if (fabricRulesApply(item, instance.loader) && item.mcDep) {
    local = fabricPredicateAllows(item.mcDep, instance.mcVersion);
  }
  if (local === false) {
    return {
      severity: "blocked",
      reason: "wrong-mc",
      madeFor: describePredicate(item.mcDep),
      detail: `Needs Minecraft ${describePredicate(item.mcDep)} — this instance is on ${instance.mcVersion}. ${loaderName} won't start with it switched on.`,
    };
  }
  if (!version) return null;
  const loaders = Array.isArray(version.loaders) ? version.loaders : [];
  if (wanted.length && loaders.length && !loaders.some((l) => wanted.includes(l)) && !hasConnector) {
    const made = loaders.map((l) => LOADER_TITLES[l] || l).join(", ");
    return {
      severity: "warn",
      reason: "wrong-loader",
      madeFor: made,
      detail: `This build is for ${made}, not ${loaderName}.`,
    };
  }
  const games = Array.isArray(version.game_versions) ? version.game_versions : [];
  if (!games.length || games.includes(instance.mcVersion)) return null;
  if (local === true) {
    // The jar says yes itself, and Modrinth's list being short (only older
    // versions) doesn't overrule that. But a build listed ONLY for newer
    // Minecraft versions was made against the newer game: its "range"
    // reaching back is often just loose, and code compiled for 26.3 asking
    // 26.2 for things it doesn't have crashes in play (AppleSkin's
    // NoSuchFieldError, 3 Oct 2026). That is worth a warning.
    if (!builtForNewerOnly(games, instance.mcVersion)) return null;
    return {
      severity: "warn",
      reason: "wrong-mc",
      madeFor: summariseVersions(games),
      listedElsewhere: true,
      detail: `This build is listed for Minecraft ${summariseVersions(games)}, not ${instance.mcVersion}. Its own file lets it load, but a build made for a newer Minecraft can crash the game in play.`,
    };
  }
  return {
    severity: "warn",
    reason: "wrong-mc",
    madeFor: summariseVersions(games),
    listedElsewhere: true,
    detail: `This build is listed for Minecraft ${summariseVersions(games)}, not ${instance.mcVersion}. It may not load.`,
  };
}

/** Pure: a fingerprint of the switched-on mod jars (name, size, time) - any change to the set changes it. */
function modSetOf(loaded) {
  const rows = (loaded || []).map((i) => [String(i.file).toLowerCase(), i.size || 0, i.modifiedAt || 0]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return require("crypto").createHash("sha1").update(JSON.stringify(rows)).digest("hex");
}

/**
 * Pure: is every release this build is listed for newer than `mcVersion`?
 * False when it lists no release that can be read, or the instance's
 * version can't be read (a snapshot): nothing is claimed then.
 */
function builtForNewerOnly(games, mcVersion) {
  const mine = parseMcVersion(mcVersion);
  const listed = (games || []).map(parseMcVersion).filter(Boolean);
  return Boolean(mine) && listed.length > 0 && listed.every((v) => compareTriples(v, mine) > 0);
}

/* ------------------------------------------------------------------ */
/* mods against each other (pure)                                     */
/* ------------------------------------------------------------------ */

// Things a Fabric mod can "depend" on that aren't mods in the folder.
const NOT_A_MOD = new Set(["minecraft", "java", "fabricloader", "fabric-loader", "quilt_loader", "quilt_base", "mixinextras"]);

/**
 * Pure: could a jar tucked inside another mod be supplying `id`? Mods can
 * carry other mods inside them, and the loader uses the newest copy it
 * finds anywhere - so when this is true, a version mismatch between two
 * visible jars is only "probably", not "certainly". A guess from file
 * names: what the packed mods really are comes from `nestedMods`, and this
 * is only ever one more reason to be unsure.
 */
function nestedMayProvide(id, mods) {
  const want = String(id).toLowerCase().replace(/[_-]/g, "");
  return mods.some((m) => (m.nested || []).some((file) => String(file).toLowerCase().replace(/[_-]/g, "").includes(want)));
}

/**
 * Pure: could a packed jar that COULDN'T be read be a copy of `id`? Only
 * those make an answer about `id` unsure - it used to be "any unread jar
 * anywhere", and since one big mod with more packed jars than were read is
 * in nearly every instance, nothing was ever certain. Judged by the unread
 * jar's file name, the same way as nestedMayProvide. An item that says it
 * has unread jars without naming them (or names "*": more than were even
 * listed) could be hiding anything.
 */
function unreadMayProvide(id, mods) {
  const want = String(id).toLowerCase().replace(/[_-]/g, "");
  return mods.some((m) => {
    if (!m || m.nestedUnread !== true) return false;
    if (!Array.isArray(m.nestedUnreadNames) || !m.nestedUnreadNames.length) return true;
    return m.nestedUnreadNames.some((file) => file === "*" || String(file).toLowerCase().replace(/[_-]/g, "").includes(want));
  });
}

/** The mods packed inside a jar that content.js could read: [{ id, version, provides }]. */
function nestedModsOf(item) {
  return Array.isArray(item && item.nestedMods) ? item.nestedMods.filter((n) => n && typeof n.id === "string" && n.id) : [];
}

/** An id the way two spellings of it compare equal: lower case, no "-" or "_". */
const squashId = (id) => String(id || "").toLowerCase().replace(/[-_]/g, "");

/**
 * Pure: what the enabled mods demand of each other, from their own
 * fabric.mod.json. `mods` are content.listAll items (modId, modVersion,
 * depends, breaks, provides, nested, nestedMods, nestedUnread,
 * nestedUnreadNames, environment, descriptors, file). `loader` / `hasConnector` say whose rules apply:
 * depends/breaks are Fabric's, so they're only judged where Fabric mods
 * load (Fabric, Quilt, or NeoForge with Connector); duplicates always are.
 * Returns [{ kind, file, id, targetFile, need, have, certain }]:
 *   "depends"   `file` needs mod `id` at a version `targetFile` isn't
 *               (targetNested: the copy is packed inside `targetFile`)
 *   "breaks"    `file` says it can't run next to `targetFile`
 *   "duplicate" `file` and `targetFile` are the same mod; `targetFile` is
 *               the one that gets used (`used` its version, `byVersion`
 *               true when it was picked for being the higher version,
 *               `passedOver` true when it is known that `file` isn't loaded)
 * This follows what Fabric does, not what the folder looks like:
 *  - of several copies of one mod Fabric loads ONE, the highest version. A
 *    copy it passes over makes no demands, so none are judged for it.
 *  - a mod packed inside another counts exactly like one in the folder: it
 *    can satisfy a "depends", and it can be the copy that gets loaded.
 *  - a server-only mod isn't loaded on the client at all.
 * `certain` is false whenever something that could change the answer
 * couldn't be read (a packed jar that might be the mod in question, a
 * version that isn't numbers).
 * A mod that needs something that isn't anywhere is NOT reported here.
 */
function findDependencyProblems(mods, { loader = "fabric", hasConnector = false } = {}) {
  const live = (mods || []).filter((m) => m && m.environment !== "server");
  const byTime = (a, b) => (b.modifiedAt || 0) - (a.modifiedAt || 0);
  const push = (map, key, value) => {
    if (!map.has(key)) map.set(key, []);
    if (!map.get(key).includes(value)) map.get(key).push(value);
  };

  // --- several copies of one mod: which one does the loader take?
  const copies = new Map(); // mod id -> [items]
  for (const m of live) if (m.modId) push(copies, String(m.modId).toLowerCase(), m);
  const passedOver = new Set(); // copies Fabric doesn't load
  const unsure = new Set(); // ids where it can't be told which copy loads
  const duplicates = [];
  for (const [id, list] of copies) {
    if (list.length < 2) continue;
    const ver = new Map(list.map((c) => [c, parseVer(c.modVersion)]));
    // The higher version wins; the file's date only settles a tie. When a
    // version can't be read as numbers there is nothing to compare, and the
    // date is the best guess left.
    const readable = list.every((c) => ver.get(c));
    const sorted = [...list].sort(readable ? (x, y) => compareVer(ver.get(y), ver.get(x)) || byTime(x, y) : byTime);
    if (!readable) unsure.add(id);
    for (const extra of sorted.slice(1)) {
      if (readable) passedOver.add(extra);
      duplicates.push({
        kind: "duplicate",
        file: extra.file,
        id: extra.modId,
        targetFile: sorted[0].file,
        need: null,
        have: extra.modVersion || null,
        used: sorted[0].modVersion || null,
        byVersion: readable && compareVer(ver.get(sorted[0]), ver.get(extra)) !== 0,
        passedOver: readable,
        certain: true,
      });
    }
  }

  const out = [];
  if (isFabricLike(loader) || hasConnector) {
    // --- everything that could be loaded under an id: jars in the folder
    // and the mods packed inside them.
    const candidates = new Map(); // id -> [{ item, file, version, nested }]
    for (const m of live) {
      const root = { item: m, file: m.file, version: m.modVersion, nested: false };
      if (m.modId) push(candidates, String(m.modId).toLowerCase(), root);
      for (const p of m.provides || []) push(candidates, String(p).toLowerCase(), root);
      for (const n of nestedModsOf(m)) {
        const inner = { item: m, file: m.file, version: n.version, nested: true };
        push(candidates, n.id.toLowerCase(), inner);
        for (const p of Array.isArray(n.provides) ? n.provides : []) if (typeof p === "string") push(candidates, p.toLowerCase(), inner);
      }
    }
    // A packed jar that couldn't be opened may hold a copy of the mod an
    // answer below is about - which would change that answer, and only that.
    const unread = (id) => unreadMayProvide(id, live);
    // The copy Fabric would load: the highest version, a jar in the folder
    // before a packed one when they're equal.
    const newest = (list) =>
      [...list].sort((x, y) => compareVer(parseVer(y.version), parseVer(x.version)) || Number(x.nested) - Number(y.nested) || byTime(x.item, y.item))[0];
    const copyUnsure = (list) => list.some((c) => !c.nested && c.item.modId && unsure.has(String(c.item.modId).toLowerCase()));

    for (const m of live) {
      if (passedOver.has(m)) continue;
      // On Quilt a jar with its own quilt.mod.json is read from that file.
      if (loader === "quilt" && m.descriptors && m.descriptors.quilt && m.descriptors.fabric) continue;
      const selfUnsure = Boolean(m.modId) && unsure.has(String(m.modId).toLowerCase());
      for (const [id, pred] of Object.entries(m.depends || {})) {
        const key = id.toLowerCase();
        if (NOT_A_MOD.has(key)) continue;
        // Other jars, and anything packed inside any jar - this one included.
        const list = (candidates.get(key) || []).filter((c) => c.nested || c.item !== m);
        if (!list.length) continue;
        // Satisfied if ANY copy fits; unknown if any can't be read.
        const results = list.map((c) => versionSatisfies(pred, c.version));
        if (results.some((r) => r === true) || results.some((r) => r === null)) continue;
        const target = newest(list);
        out.push({
          kind: "depends",
          file: m.file,
          id,
          targetFile: target.file,
          targetNested: target.nested,
          need: describePredicate(pred),
          have: target.version || null,
          certain: !unread(id) && !selfUnsure && !copyUnsure(list) && !nestedMayProvide(id, live),
        });
      }
      for (const [id, pred] of Object.entries(m.breaks || {})) {
        const key = id.toLowerCase();
        if (NOT_A_MOD.has(key)) continue;
        const list = (candidates.get(key) || []).filter((c) => c.item !== m);
        if (!list.length) continue;
        let target;
        let known = true;
        if (list.every((c) => parseVer(c.version))) {
          // Only the copy that gets loaded can clash.
          target = newest(list);
          if (versionSatisfies(pred, target.version) !== true) continue;
        } else {
          // Can't tell which copy loads: certain only if every one clashes.
          const hits = list.filter((c) => versionSatisfies(pred, c.version) === true);
          if (!hits.length) continue;
          target = hits.find((c) => !c.nested) || hits[0];
          known = hits.length === list.length;
        }
        out.push({
          kind: "breaks",
          file: m.file,
          id,
          targetFile: target.file,
          targetNested: target.nested,
          need: null,
          have: target.version || null,
          certain: known && !unread(id) && !selfUnsure,
        });
      }
    }
  }
  return [...out, ...duplicates];
}

/**
 * Pure: mods packed INSIDE other mods (jar-in-jar) whose own Minecraft
 * requirement this instance fails - when Fabric would really load them.
 *
 * Why this exists (a real instance, Fabric 26.2, October 2026): three mods
 * stopped the game and the old check saw none of them.
 *  - ClientSideCrystals-26.3.jar and AnchorOptimizer-26.3.jar are
 *    multi-version bundles. Their outer fabric.mod.json says
 *    ">=1.21 <=26.3" / ">=26.1 <=26.3" (26.2 passes that), but they carry
 *    one nested jar per Minecraft version under META-INF/jars/, each with
 *    the SAME mod id. Fabric doesn't pick the copy that fits: of several
 *    copies of one id it loads the highest version - the 26.3 one - and
 *    that one says it needs 26.3.
 *  - jei-26.3-fabric-*.jar carries MezzConfig, whose own fabric.mod.json
 *    needs exactly 26.3. Nothing else has MezzConfig, so it is loaded.
 *
 * The rule, per mod id that has at least one packed copy:
 *  1. Every loaded copy counts: jars in the folder and copies packed inside
 *     any of them.
 *  2. The copy Fabric loads is the highest version. If the highest version
 *     is shared by several copies (versions that only differ after a "+",
 *     like 1.0.6+26.3 and 1.0.6+26.2, ARE equal to Fabric) or a version
 *     can't be read, which copy loads can't be told.
 *  3. If that copy is a packed one and its "depends.minecraft" fails this
 *     version, the OUTER jar won't load: "blocked".
 *  4. A false "blocked" is the worst outcome, so it is "blocked" only when
 *     every copy that could be the one loaded fails, every requirement
 *     involved could be read, and no unreadable packed jar could be another
 *     copy. Anything less certain is a warning (and the game's own report
 *     after a failed start - parseIncompatibleMods - settles it then).
 * `skip`: files Fabric doesn't load at all (copies it passes over).
 * Returns [{ file, id, name, version, need, bundle, certain }] - `file` is
 * the outer jar, the only thing that can be swapped or switched off.
 */
function findNestedMcProblems(mods, { loader = "fabric", mcVersion, hasConnector = false, skip = new Set() } = {}) {
  if (!(isFabricLike(loader) || hasConnector) || !parseMcVersion(mcVersion)) return [];
  const live = (mods || []).filter((m) => m && m.environment !== "server" && !skip.has(m.file));
  const candidates = new Map(); // id -> [{ item, version, nested, mcDep, name }]
  const add = (id, c) => {
    const key = String(id).toLowerCase();
    if (!candidates.has(key)) candidates.set(key, []);
    candidates.get(key).push(c);
  };
  for (const m of live) {
    // On Quilt a jar with its own quilt.mod.json isn't read through fabric.mod.json at all.
    const fabricSide = fabricRulesApply(m, loader) && !(loader === "quilt" && m.descriptors && m.descriptors.quilt && m.descriptors.fabric);
    if (m.modId) add(m.modId, { item: m, version: m.modVersion, nested: false, mcDep: fabricSide ? m.mcDep || null : null, name: displayName(m) });
    if (!fabricSide) continue;
    for (const n of nestedModsOf(m)) add(n.id, { item: m, version: n.version, nested: true, mcDep: n.mcDep || null, name: n.name || n.id });
  }
  const verdict = (c) => (c.mcDep ? fabricPredicateAllows(c.mcDep, mcVersion) : true);
  const out = [];
  for (const [id, list] of candidates) {
    if (!list.some((c) => c.nested && c.mcDep)) continue;
    const parsed = list.map((c) => parseVer(c.version));
    const readable = parsed.every(Boolean);
    let top = list;
    if (readable) {
      const best = parsed.reduce((a, b) => (compareVer(a, b) >= 0 ? a : b));
      top = list.filter((c, i) => compareVer(parsed[i], best) === 0);
    }
    const failing = top.filter((c) => c.nested && verdict(c) === false);
    if (!failing.length) continue;
    const certain = top.every((c) => verdict(c) === false) && !unreadMayProvide(id, live);
    const seen = new Set();
    for (const c of failing) {
      if (seen.has(c.item.file)) continue;
      seen.add(c.item.file);
      out.push({
        file: c.item.file,
        id,
        name: c.name,
        version: c.version || null,
        need: describePredicate(c.mcDep),
        // several packed copies of one mod in one jar: a multi-version bundle
        bundle: list.filter((x) => x.nested && x.item === c.item).length > 1,
        certain,
      });
    }
  }
  return out;
}

/**
 * Pure: the mods Fabric itself named when it refused to start, out of a
 * game log. Fabric prints "Some of your mods are incompatible with the game
 * or each other!" and then lines like
 *   - Mod 'Anchor Optimizer' (client_side_anchors) 1.0.6+26.3 requires version 26.3 of 'Minecraft', but only the wrong version is present: 26.2!
 *   - Replace mod 'MezzConfig' (mezz_config) 0.6.6 with any version that is compatible with:
 *       - minecraft 26.2
 * Returns [{ id, name, version, why }], one per mod id (the "requires" line
 * wins over the "Replace" one). Nothing before the heading is looked at.
 */
const REPORT_HEADING = /Some of your mods are incompatible with the game or each other!|Incompatible mods found!/;
function parseIncompatibleMods(text) {
  const t = String(text || "");
  const at = t.search(REPORT_HEADING);
  if (at < 0) return [];
  const lines = t.slice(at, at + 64 * 1024).split(/\r?\n/);
  const out = new Map();
  const put = (id, name, version, why, strong) => {
    const key = id.toLowerCase();
    const prev = out.get(key);
    if (prev && (prev.strong || !strong)) return;
    out.set(key, { id, name, version, why: why.slice(0, 300), strong });
  };
  for (let i = 0; i < lines.length && i < 2000; i++) {
    const line = lines[i];
    const mod = /-\s+Mod '([^']{1,120})' \(([A-Za-z0-9_.-]{1,64})\) (\S{1,80}) (.{1,400}?)\s*$/.exec(line);
    if (mod) {
      put(mod[2], mod[1], mod[3], mod[4], true);
      continue;
    }
    const repl = /-\s+(Replace|Remove) mod '([^']{1,120})' \(([A-Za-z0-9_.-]{1,64})\) (\S{1,80})(?: with (.{1,300}?))?\s*$/.exec(line);
    if (repl) {
      let why = repl[1] === "Remove" ? "remove it" : `replace it with ${repl[5] || "another version"}`;
      // The deeper "- minecraft 26.2" lines under it belong to it.
      const indent = (line.match(/^\s*/) || [""])[0].length;
      while (i + 1 < lines.length && (lines[i + 1].match(/^\s*/) || [""])[0].length > indent && /^\s*-\s+(?!Mod '|Replace mod|Remove mod|Install mod)/.test(lines[i + 1])) {
        why += " " + lines[++i].trim().replace(/^-\s+/, "");
      }
      put(repl[3], repl[2], repl[4], why, false);
    }
  }
  return [...out.values()].map(({ id, name, version, why }) => ({ id, name, version, why }));
}

/** Pure: the entries of parseIncompatibleMods that are about the Minecraft version. */
function minecraftMismatches(entries) {
  return (entries || []).filter((e) => e && /\bminecraft\b/i.test(e.why || ""));
}

/**
 * Pure: which files the game's report is about. A mod id is matched to the
 * enabled jar that is it, or else to the jar it is packed inside (that outer
 * file is the only thing that can be swapped). `items` are content.listAll
 * mod items. Returns [{ id, name, version, why, file, size, mtimeMs, nestedIn }].
 */
function mapReportToFiles(entries, items) {
  const live = (items || []).filter((i) => i && i.valid && !i.folder && i.enabled);
  const out = [];
  const seen = new Set();
  for (const e of entries || []) {
    const id = String(e.id || "").toLowerCase();
    if (!id) continue;
    let hits = live.filter((i) => String(i.modId || "").toLowerCase() === id).map((i) => ({ item: i, nestedIn: null }));
    if (!hits.length) {
      hits = live.filter((i) => nestedModsOf(i).some((n) => n.id.toLowerCase() === id)).map((i) => ({ item: i, nestedIn: displayName(i) }));
    }
    for (const { item, nestedIn } of hits) {
      const key = `${item.file}|${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: e.id, name: e.name || e.id, version: e.version || null, why: e.why || "", file: item.file, size: item.size, mtimeMs: item.modifiedAt, nestedIn });
    }
  }
  return out;
}

const LAUNCH_REPORT_FILE = path.join(".reminth", "launch-report.json");

/** The last refused start's report for an instance, or null. Never throws. */
async function readLaunchReport(gameDir) {
  try {
    const parsed = JSON.parse(await fsp.readFile(path.join(gameDir, LAUNCH_REPORT_FILE), "utf8"));
    return parsed && Array.isArray(parsed.mods) ? parsed : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* checking an instance                                               */
/* ------------------------------------------------------------------ */

const hashCache = new Map(); // full path -> { size, mtimeMs, sha1 }

async function hashOf(full, item) {
  const hit = hashCache.get(full);
  if (hit && hit.size === item.size && hit.mtimeMs === item.modifiedAt) return hit.sha1;
  const sha1 = await content.sha1File(full);
  hashCache.set(full, { size: item.size, mtimeMs: item.modifiedAt, sha1 });
  if (hashCache.size > 4000) hashCache.delete(hashCache.keys().next().value);
  return sha1;
}

/** Jar names Reminth manages itself (HUD, performance pack): it swaps those at launch, so they're never reported. */
async function managedNames(gameDir) {
  try {
    const parsed = JSON.parse(await fsp.readFile(path.join(gameDir, ".reminth", "managed-mods.json"), "utf8"));
    return new Set(Object.keys((parsed && parsed.files) || {}).map((n) => n.toLowerCase()));
  } catch {
    return new Set();
  }
}

// Fabric reads this file at startup and lets the player rewrite or drop any
// mod's "depends" / "breaks" with it - so with it there, what a jar says
// about itself is no longer the last word.
const OVERRIDE_FILE = path.join("config", "fabric_loader_dependencies.json");
const OVERRIDE_NOTE = " (This instance has a dependency override file, so it may load anyway.)";
// "missing-dep" is only ever "blocked" for the Fabric API, and that verdict
// is read from the jars' own "depends" - which the file can drop like any other.
const OVERRIDABLE = new Set(["wrong-mc", "needs-version", "conflict", "missing-dep"]);

async function hasOverrideFile(gameDir) {
  try {
    return (await fsp.stat(path.join(gameDir, OVERRIDE_FILE))).isFile();
  } catch {
    return false;
  }
}

const loaderName = (loader) => LOADER_TITLES[loader] || loader;
const displayName = (item) => item.title || item.name || String(item.file || "").replace(/\.jar(\.disabled)?$/i, "");

const checkCache = new Map(); // instance id -> { key, at, result }
const HASH_CONCURRENCY = 4; // jars hashed at once by a full check
const CHECK_TTL_MS = 10 * 60 * 1000;

/** Forget what was worked out for an instance (or all of them) - after anything changes its mods. */
function invalidate(instanceId) {
  if (instanceId) checkCache.delete(instanceId);
  else checkCache.clear();
}

/**
 * Looks at every enabled mod in the instance. Returns
 * {
 *   mcVersion, loader, online,   online=false: Modrinth couldn't be reached,
 *                                so only what the jars say themselves was used
 *   partial,                     only with `localOnly`: true, and online=false
 *   checked,                     how many mods were looked at
 *   issues: [{
 *     file, title, iconUrl, severity, reason, madeFor, detail,
 *     neededBy,                  for a missing mod: who asked for it
 *     fix: null
 *        | { type: "update", label, update }   update = a content.applyUpdates entry
 *        | { type: "install", label, projectId, title }
 *        | { type: "disable", label }
 *   }],
 *   blocked, warned              counts
 * }
 * `deps` lets tests swap out Modrinth and the file listing.
 *
 * `localOnly` is the quick answer for the Play button: only what the jars
 * say themselves (wrong Minecraft version, wrong loader, Fabric API missing,
 * what the mods demand of each other, duplicates) - no file is hashed and
 * Modrinth isn't asked, so it takes a moment even on a big instance. Its
 * fixes are "switch off" / "install" only, and it is never cached.
 */
async function checkInstance(instance, { force = false, localOnly = false, deps = {} } = {}) {
  const api = deps.modrinth || modrinth;
  const listAll = deps.listAll || content.listAll;
  const gameDir = instance.gameDir;
  const loader = instance.loader;
  const base = { mcVersion: instance.mcVersion, loader, online: true, checked: 0, issues: [], blocked: 0, warned: 0 };
  if (loader === "vanilla") return base;

  const all = await listAll(gameDir);
  const managed = deps.managedNames ? await deps.managedNames(gameDir) : await managedNames(gameDir);
  // Everything the game will load, and the part of it that's the player's
  // own: Reminth's managed jars (HUD, performance pack, the Fabric API it
  // brings) are swapped to the right build at launch, so they're never
  // reported - but they do count as "installed" for what other mods need.
  const loaded = (all.mod || []).filter((i) => i.valid && !i.folder && i.enabled);
  const mods = loaded.filter((i) => !managed.has(String(i.file).toLowerCase()));
  // Which mods are switched on, as one fingerprint: a "don't ask again" for
  // this instance's Play warning holds only while this stays the same.
  base.modSet = modSetOf(loaded);
  // Reminth puts the Fabric API in by itself whenever the HUD or the
  // performance pack is on - the same rule minecraft.ensureInstalled uses
  // (config.perfPackEnabled).
  const perfPackOn = config.perfPackEnabled(instance);
  const apiComesAtLaunch = isFabricLike(loader) && (instance.hud === true || perfPackOn);
  const overridden = deps.hasOverrideFile ? await deps.hasOverrideFile(gameDir) : await hasOverrideFile(gameDir);
  // What the game itself refused at its last start (main.js writes it) -
  // only for the version and loader it was about.
  const rawReport = deps.readLaunchReport ? await deps.readLaunchReport(gameDir) : await readLaunchReport(gameDir);
  const launchReport = rawReport && rawReport.mcVersion === instance.mcVersion && rawReport.loader === loader ? rawReport.mods : [];
  // The mod the game last crashed in (main.js noteCrashReport) - for this
  // version and loader only, like the launch report.
  const rawCrash = deps.readCrashFinding ? await deps.readCrashFinding(gameDir) : await require("./crashReport").readFinding(gameDir);
  const crashFinding = rawCrash && rawCrash.mcVersion === instance.mcVersion && rawCrash.loader === loader ? rawCrash : null;
  // Which jars are Reminth's is part of the question: the same files with a
  // different managed list (after a launch tidied or disowned one) is a
  // different answer.
  const key = JSON.stringify([instance.mcVersion, loader, instance.hud === true, perfPackOn, overridden, loaded.map((i) => [i.file, i.size, i.modifiedAt]), [...managed].sort(), launchReport, crashFinding && crashFinding.mod]);
  const cached = checkCache.get(instance.id);
  if (!force && cached && cached.key === key && Date.now() - cached.at < CHECK_TTL_MS && cached.result.online) return cached.result;

  const wanted = content.loadersFor("mod", instance);
  const modsDir = path.join(gameDir, "mods");
  const result = localOnly ? { ...base, online: false, partial: true, checked: mods.length } : { ...base, checked: mods.length };
  if (!mods.length) return result;

  // --- which Modrinth version is each file? (one request for all of them)
  // (Reminth's own jars are looked up too - not to judge them, but so a
  // mod that needs a different build of one can be offered the right one.)
  const hashes = new Map(); // item -> sha1
  let found = {};
  if (!localOnly) {
    // Four at a time: one after another, a big instance's first check took
    // longer than Play is willing to wait for it.
    const sums = await mapLimit(loaded, HASH_CONCURRENCY, (item) => (deps.hashOf ? deps.hashOf(item) : hashOf(path.join(modsDir, item.file), item)));
    // (a failure - locked by the running game - leaves that jar judged by its own metadata only)
    loaded.forEach((item, i) => {
      if (sums[i]) hashes.set(item, sums[i]);
    });
    try {
      if (hashes.size) found = (await api.getVersionsFromHashes([...new Set(hashes.values())], "sha1")) || {};
    } catch {
      result.online = false;
    }
  }
  const versionOf = (item) => (hashes.has(item) ? found[hashes.get(item)] || null : null);
  const hasConnector = loaded.some((i) => /^(connector|sinytra_connector)$/i.test(i.modId || ""));

  // --- what the mods demand of each other. Worked out before anything is
  // judged, because it also says which copies of a doubled mod aren't loaded.
  const isManaged = (file) => managed.has(String(file).toLowerCase());
  // Where Reminth's jar and the player's are the same mod, Reminth's is
  // taken out at launch - so it is the player's copy that gets judged and
  // that everything else is judged against.
  const playerIds = new Set(mods.filter((i) => i.modId).map((i) => String(i.modId).toLowerCase()));
  const atLaunch = loaded.filter((i) => !(isManaged(i.file) && i.modId && playerIds.has(String(i.modId).toLowerCase())));
  const problems = findDependencyProblems(atLaunch, { loader, hasConnector });
  // A lower-version copy Fabric passes over isn't loaded, so what it says
  // about itself can't stop the game: "it's there twice" is all there is
  // to say about it.
  const passedOver = new Set(isFabricLike(loader) ? problems.filter((p) => p.kind === "duplicate" && p.passedOver).map((p) => p.file) : []);

  // --- judge each one
  const flagged = []; // { item, verdict }
  for (const item of mods) {
    if (passedOver.has(item.file)) continue;
    const verdict = judgeMod(item, versionOf(item), instance, wanted, hasConnector);
    if (verdict) flagged.push({ item, verdict });
  }

  // --- mods packed inside a jar that need another Minecraft version: the
  // outer jar won't load (findNestedMcProblems has the rule and why).
  const flaggedOf = (item) => flagged.find((f) => f.item === item);
  for (const p of findNestedMcProblems(atLaunch, { loader, mcVersion: instance.mcVersion, hasConnector, skip: passedOver })) {
    const item = mods.find((i) => i.file === p.file); // Reminth's own jars aren't reported
    if (!item) continue;
    const outer = displayName(item);
    const what = p.bundle
      ? `${outer} carries a copy for each Minecraft version, and Fabric loads the newest one (${p.version || "?"}), which needs Minecraft ${p.need}`
      : `${outer} contains ${p.name}, which needs Minecraft ${p.need}`;
    const verdict = {
      severity: p.certain ? "blocked" : "warn",
      reason: "wrong-mc",
      madeFor: p.need,
      detail: p.certain
        ? `${what} — this instance is on ${instance.mcVersion}. ${loaderName(loader)} won't start with it switched on.`
        : `${what}. Fabric may load that copy on ${instance.mcVersion}, so it may not start.`,
    };
    const had = flaggedOf(item);
    if (!had) flagged.push({ item, verdict });
    else if (had.verdict.severity !== "blocked" && verdict.severity === "blocked") had.verdict = verdict;
  }

  // --- what the game itself refused at its last start, as long as that
  // exact file (same size and time) is still there. No guessing involved.
  for (const r of launchReport || []) {
    if (!r || typeof r.file !== "string") continue;
    const item = mods.find((i) => i.file === r.file && i.size === r.size && i.modifiedAt === r.mtimeMs);
    if (!item) continue;
    const who = r.nestedIn ? `${displayName(item)} contains ${r.name || r.id}, and` : `${displayName(item)}`;
    const verdict = {
      severity: "blocked",
      reason: "wrong-mc",
      madeFor: null,
      fromGame: true,
      detail: `${who} stopped Minecraft from starting last time — the game said it ${String(r.why || "doesn't fit this version").replace(/!$/, "")}.`,
    };
    const had = flaggedOf(item);
    if (!had) flagged.push({ item, verdict });
    else had.verdict = { ...verdict, detail: had.verdict.severity === "blocked" ? had.verdict.detail : verdict.detail };
  }

  // --- for the ones on the wrong version, is there a build that fits?
  let replacements = {};
  const needFix = flagged.filter((f) => hashes.has(f.item) && versionOf(f.item));
  if (needFix.length && result.online) {
    try {
      replacements =
        (await api.checkForUpdates(
          needFix.map((f) => hashes.get(f.item)),
          { loaders: wanted, gameVersions: [instance.mcVersion], algorithm: "sha1" }
        )) || {};
    } catch {
      replacements = {};
    }
    // Only a STABLE build is switched to without the player picking the
    // file: Modrinth's update lookup ignores the channel, so a beta or alpha
    // it offers is swapped for the newest release for this exact version
    // and loader (the same choice as "Update mods to fit"), or dropped.
    const { pickStableBuild } = require("./modsSync");
    const unstable = Object.entries(replacements).filter(([, v]) => v && (v.version_type === "beta" || v.version_type === "alpha"));
    await mapLimit(unstable, 4, async ([hash, v]) => {
      try {
        const list = await api.getProjectVersions(v.project_id, { loaders: wanted, gameVersions: [instance.mcVersion] });
        replacements[hash] = pickStableBuild(list, instance.mcVersion, wanted);
      } catch {
        replacements[hash] = null;
      }
    });
  }

  for (const { item, verdict } of flagged) {
    const hash = hashes.get(item);
    const current = versionOf(item);
    const next = hash ? replacements[hash] : null;
    const file = next ? content.primaryFile(next) : null;
    let fix = { type: "disable", label: "Switch off" };
    if (next && file && file.hashes && file.hashes.sha1 && file.hashes.sha1 !== hash) {
      fix = {
        type: "update",
        label: `Switch to ${next.version_number}`,
        update: {
          kind: "mod",
          world: null,
          file: item.file,
          enabled: true,
          projectId: next.project_id,
          title: displayName(item),
          iconUrl: item.iconUrl || null,
          current: item.versionNumber || item.modVersion || (current && current.version_number) || null,
          next: {
            versionId: next.id,
            versionNumber: next.version_number,
            url: file.url,
            sha1: file.hashes.sha1,
            filename: file.filename,
            size: file.size || 0,
          },
        },
      };
    }
    result.issues.push({
      file: item.file,
      title: displayName(item),
      iconUrl: item.iconUrl || null,
      projectId: (current && current.project_id) || item.projectId || null,
      severity: verdict.severity,
      reason: verdict.reason,
      madeFor: verdict.madeFor,
      detail: verdict.detail,
      neededBy: null,
      fix,
      ...(verdict.fromGame ? { fromGame: true } : {}),
      ...(verdict.listedElsewhere ? { listedElsewhere: true } : {}),
    });
  }

  // --- the mod the game last crashed in, as long as that exact file (same
  // size and time) is still there: "Crashed the game", with its fix.
  const crashed = crashFinding && crashFinding.mod;
  const crashItem = crashed ? mods.find((i) => i.file === crashed.file && i.size === crashed.size && i.modifiedAt === crashed.mtimeMs) : null;
  if (crashItem) {
    const kind = /^(?:[\w$]+\.)*([\w$]+?(?:Error|Exception))\b/.exec(String(crashFinding.error || ""));
    const said = `${displayName(crashItem)} crashed the game last time${kind ? ` (${kind[1]})` : ""}.`;
    const issue = result.issues.find((x) => x.file === crashItem.file);
    if (issue) {
      issue.crashed = true;
      issue.detail = `${said} ${issue.detail}`;
    } else {
      result.issues.push({
        file: crashItem.file,
        title: displayName(crashItem),
        iconUrl: crashItem.iconUrl || null,
        projectId: crashItem.projectId || null,
        severity: "warn",
        reason: "crashed",
        madeFor: null,
        detail: said,
        neededBy: null,
        fix: { type: "disable", label: "Switch off" },
        crashed: true,
      });
    }
  }

  // Every mod id the game will have: the loaded jars, what they "provide",
  // and the mods packed inside them.
  const idsHere = new Set();
  for (const i of loaded) {
    if (i.environment === "server") continue;
    if (i.modId) idsHere.add(String(i.modId).toLowerCase());
    for (const p of i.provides || []) idsHere.add(String(p).toLowerCase());
    for (const n of nestedModsOf(i)) {
      idsHere.add(n.id.toLowerCase());
      for (const p of Array.isArray(n.provides) ? n.provides : []) idsHere.add(String(p).toLowerCase());
    }
  }
  const squashedHere = new Set([...idsHere].map(squashId));

  // --- Fabric API: the single most common "won't start" there is
  if (isFabricLike(loader)) {
    // Anything that brings the API counts: a jar that is it, one that
    // "provides" it, or a copy packed inside another mod.
    const hasApi = apiComesAtLaunch || [...FABRIC_API_PROVIDERS].some((id) => idsHere.has(id));
    // Only jars whose fabric.mod.json the loader actually goes by can ask.
    const askers = mods.filter((i) => fabricRulesApply(i, loader) && (i.requires || []).some((r) => FABRIC_API_KEYS.has(String(r).toLowerCase())));
    if (!hasApi && askers.length) {
      const api_ = loader === "quilt" ? { projectId: QUILT_API, title: "Quilted Fabric API" } : { projectId: FABRIC_API, title: "Fabric API" };
      result.issues.push({
        file: null,
        title: api_.title,
        iconUrl: null,
        projectId: api_.projectId,
        severity: "blocked",
        reason: "missing-dep",
        madeFor: null,
        detail: `${askers.length === 1 ? displayName(askers[0]) + " needs" : askers.length + " of your mods need"} ${api_.title}, and it isn't installed. The game won't start without it.`,
        neededBy: askers.slice(0, 12).map(displayName),
        fix: { type: "install", label: `Install ${api_.title}`, projectId: api_.projectId, title: api_.title },
      });
    }
  }

  // --- anything else Modrinth says a mod requires that isn't here
  if (result.online) {
    // "Already here" means LOADED: a switched-off copy doesn't satisfy
    // anything. (`found` only ever holds the loaded jars.)
    const here = new Set();
    for (const v of Object.values(found)) if (v && v.project_id) here.add(v.project_id);
    for (const i of loaded) if (i.projectId) here.add(i.projectId);
    const missing = new Map(); // project id -> [asker titles]
    for (const item of mods) {
      const v = versionOf(item);
      for (const dep of (v && v.dependencies) || []) {
        if (!dep || dep.dependency_type !== "required" || !dep.project_id || here.has(dep.project_id)) continue;
        if (!missing.has(dep.project_id)) missing.set(dep.project_id, []);
        missing.get(dep.project_id).push(displayName(item));
      }
    }
    if (missing.size) {
      let projects = [];
      try {
        projects = (await api.getProjects([...missing.keys()])) || [];
      } catch {
        projects = [];
      }
      const alreadyApi = result.issues.some((i) => i.reason === "missing-dep");
      for (const p of projects) {
        if (!p || !missing.has(p.id)) continue;
        // Fabric API was already reported above, from what the jars say.
        if (alreadyApi && (p.slug === FABRIC_API || p.slug === QUILT_API)) continue;
        // On Quilt the Fabric API is provided by its Quilt port.
        if (p.slug === FABRIC_API && (apiComesAtLaunch || [...FABRIC_API_PROVIDERS].some((id) => idsHere.has(id)))) continue;
        // Modrinth names projects, the game names mod ids. A loaded mod (or
        // one packed inside another) whose id is this project's slug IS it -
        // just not a file Modrinth recognises (a different build, a fork,
        // a bundled copy).
        if (p.slug && (squashedHere.has(squashId(p.slug)) || nestedMayProvide(p.slug, loaded))) continue;
        const askers = missing.get(p.id);
        result.issues.push({
          file: null,
          title: p.title,
          iconUrl: p.icon_url || null,
          projectId: p.id,
          severity: "warn",
          reason: "missing-dep",
          madeFor: null,
          detail: `${askers.length === 1 ? askers[0] + " needs" : askers.length + " of your mods need"} ${p.title}, and it isn't installed.`,
          neededBy: askers.slice(0, 12),
          fix: { type: "install", label: `Install ${p.title}`, projectId: p.id, title: p.title },
        });
      }
    }
  }

  // --- what the mods demand of each other (worked out above)
  const byFile = new Map(loaded.map((i) => [i.file, i]));
  const reported = (file, reason) => result.issues.some((x) => x.file === file && x.reason === reason);
  for (const p of problems) {
    const mod = byFile.get(p.file);
    const target = byFile.get(p.targetFile);
    if (!mod || !target) continue;
    if (p.kind === "duplicate") {
      // Reminth's own copy against the player's: Reminth's steps aside at
      // launch by itself, nothing for the player to do.
      if (isManaged(p.file) || isManaged(p.targetFile)) continue;
      if (reported(p.file, "duplicate")) continue;
      result.issues.push({
        file: mod.file,
        title: displayName(mod),
        iconUrl: mod.iconUrl || null,
        projectId: mod.projectId || null,
        severity: isForgeLike(loader) ? "blocked" : "warn",
        reason: "duplicate",
        madeFor: null,
        detail: `${displayName(mod)} is in the mods folder twice (${target.file} and ${mod.file}). ${
          isForgeLike(loader)
            ? "The game won't start with both."
            : p.byVersion
              ? `Only the higher version is used: ${target.file}${p.used ? ` (${p.used})` : ""}.`
              : `Only one of them is used — most likely ${target.file}.`
        }`,
        neededBy: null,
        fix: { type: "disable", label: "Switch off the older copy" },
      });
      continue;
    }
    // A demand made BY one of Reminth's own jars is Reminth's to sort out.
    if (isManaged(p.file)) continue;
    // A copy packed inside another mod has no file of its own to name.
    const theirName = p.targetNested ? `${p.id} (packed inside ${displayName(target)})` : displayName(target);
    if (p.kind === "breaks") {
      // The player's mod can't run next to one of Reminth's: Reminth's copy
      // is removed at launch, so there is nothing to report.
      if (isManaged(p.targetFile)) continue;
      if (reported(mod.file, "conflict")) continue;
      result.issues.push({
        file: mod.file,
        title: displayName(mod),
        iconUrl: mod.iconUrl || null,
        projectId: mod.projectId || null,
        severity: p.certain ? "blocked" : "warn",
        reason: "conflict",
        madeFor: null,
        detail: p.certain
          ? `${displayName(mod)} and ${theirName} can't be used together — ${loaderName(loader)} won't start with both switched on.`
          : `${displayName(mod)} says it can't be used with some versions of ${theirName}. Which copy of it the game picks couldn't be worked out, so this may or may not stop it.`,
        neededBy: null,
        fix: { type: "disable", label: `Switch off ${displayName(mod)}` },
      });
      continue;
    }
    // p.kind === "depends": needs another mod at a version it isn't.
    if (reported(mod.file, "needs-version")) continue;
    // If Modrinth knows exactly which build this mod wants, offer it.
    let fix = { type: "disable", label: `Switch off ${displayName(mod)}` };
    const mine = versionOf(mod);
    const theirs = p.targetNested ? null : versionOf(target);
    const pin = ((mine && mine.dependencies) || []).find(
      (d) => d && d.dependency_type === "required" && d.version_id && theirs && d.project_id === theirs.project_id
    );
    if (pin) {
      fix = { type: "install", label: `Install the ${displayName(target)} it needs`, projectId: pin.project_id, versionId: pin.version_id, title: displayName(target) };
    } else if (!p.targetNested && isManaged(p.targetFile) && theirs && theirs.project_id) {
      // Reminth's built-in copy is the wrong one: the player's own copy
      // (the newest for this version) replaces it, and Reminth's steps aside.
      fix = { type: "install", label: `Install your own ${displayName(target)}`, projectId: theirs.project_id, title: displayName(target) };
    }
    result.issues.push({
      file: mod.file,
      title: displayName(mod),
      iconUrl: mod.iconUrl || null,
      projectId: (mine && mine.project_id) || mod.projectId || null,
      severity: p.certain ? "blocked" : "warn",
      reason: "needs-version",
      madeFor: null,
      detail: `${displayName(mod)} needs ${theirName} ${p.need}, but ${p.have || "a different version"} is installed.${p.certain ? ` ${loaderName(loader)} won't start like this.` : ""}`,
      neededBy: null,
      fix,
    });
  }

  // With an override file in the instance, nothing a jar says about itself
  // is sure to stop the game - the file may have changed exactly that rule.
  if (overridden) {
    for (const issue of result.issues) {
      // What the game itself reported already went through that file.
      if (issue.severity !== "blocked" || !OVERRIDABLE.has(issue.reason) || issue.fromGame) continue;
      issue.severity = "warn";
      issue.detail += OVERRIDE_NOTE;
    }
  }

  const order = { blocked: 0, warn: 1 };
  result.issues.sort((a, b) => order[a.severity] - order[b.severity] || a.title.localeCompare(b.title));
  result.blocked = result.issues.filter((i) => i.severity === "blocked").length;
  result.warned = result.issues.length - result.blocked;
  // The quick answer is never kept: it would be handed out later as if it
  // were the whole one.
  if (!localOnly) checkCache.set(instance.id, { key, at: Date.now(), result });
  return result;
}

/* ------------------------------------------------------------------ */
/* which Minecraft version fits everything?                           */
/* ------------------------------------------------------------------ */

const supportCache = new Map(); // "project|loaders" -> { at, versions: Set }
const SUPPORT_TTL_MS = 15 * 60 * 1000;

/** Every release a project has a build for on these loaders. */
async function supportedReleases(projectId, loaders, api) {
  const key = projectId + "|" + loaders.join(",");
  const hit = supportCache.get(key);
  if (hit && Date.now() - hit.at < SUPPORT_TTL_MS) return hit.versions;
  const versions = await api.getProjectVersions(projectId, { loaders });
  const set = new Set();
  for (const v of versions || []) for (const g of v.game_versions || []) if (parseMcVersion(g)) set.add(g);
  supportCache.set(key, { at: Date.now(), versions: set });
  if (supportCache.size > 2000) supportCache.delete(supportCache.keys().next().value);
  return set;
}

/** Runs `fn` over `items`, at most `limit` at a time; a failure becomes `null` for that item. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i], i);
      } catch {
        out[i] = null;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Pure: turns "which releases each mod supports" into a ranked list.
 *   mods      [{ title, versions: Set | null }]  null = couldn't be looked up
 *   options   { accepts, loaderVersions, current, limit }
 * Each candidate: { version, supported, total, missing: [titles], server: true|false|null, current }.
 * Ranked: joinable by the server first (when one was given), then most mods
 * supported, then newest.
 */
function rankVersions(mods, { accepts = null, loaderVersions = null, current = null, limit = 10 } = {}) {
  const known = mods.filter((m) => m.versions);
  const pool = new Set();
  for (const m of known) for (const v of m.versions) pool.add(v);
  if (current && parseMcVersion(current)) pool.add(current);
  const loaderOk = loaderVersions ? new Set(loaderVersions) : null;
  const rows = [];
  for (const version of pool) {
    // A version the instance's loader has no build for can't be used at all.
    if (loaderOk && !loaderOk.has(version) && version !== current) continue;
    const missing = known.filter((m) => !m.versions.has(version)).map((m) => m.title);
    rows.push({
      version,
      supported: known.length - missing.length,
      total: known.length,
      missing,
      server: serverAccepts(accepts, version),
      current: version === current,
    });
  }
  rows.sort(
    (a, b) =>
      Number(b.server === true) - Number(a.server === true) ||
      b.supported - a.supported ||
      compareMcVersionsDesc(a.version, b.version)
  );
  const top = rows.slice(0, limit);
  const cur = rows.find((r) => r.current);
  if (cur && !top.includes(cur)) top.push(cur);
  return top;
}

/**
 * Works out which Minecraft version suits this instance's mods (and the
 * server, if `accepts` says what it takes).
 * Returns {
 *   loader, mcVersion, total, accepts,
 *   mods: [{ projectId, title }],        the mods that could be looked up
 *   unknown: [titles],                   not on Modrinth - can't be checked or moved
 *   failed: [titles],                    lookups that didn't answer
 *   candidates: [...rankVersions()],
 *   best: candidate | null               first one that fits everything (and the server)
 * }
 */
async function adviseVersions(instance, { accepts = null, loaderVersions = null, deps = {} } = {}) {
  const api = deps.modrinth || modrinth;
  const listAll = deps.listAll || content.listAll;
  const gameDir = instance.gameDir;
  const wanted = content.loadersFor("mod", instance);
  const all = await listAll(gameDir);
  const managed = deps.managedNames ? await deps.managedNames(gameDir) : await managedNames(gameDir);
  const jars = (all.mod || []).filter((i) => i.valid && !i.folder && i.enabled && !managed.has(String(i.file).toLowerCase()));
  const modsDir = path.join(gameDir, "mods");

  const hashes = new Map();
  for (const item of jars) {
    try {
      hashes.set(item, deps.hashOf ? await deps.hashOf(item) : await hashOf(path.join(modsDir, item.file), item));
    } catch {
      // unreadable - counted as unknown below
    }
  }
  let found = {};
  if (hashes.size) found = (await api.getVersionsFromHashes([...new Set(hashes.values())], "sha1")) || {};

  const projects = new Map(); // project id -> title
  const unknown = [];
  for (const item of jars) {
    const v = hashes.has(item) ? found[hashes.get(item)] : null;
    const pid = (v && v.project_id) || item.projectId || null;
    if (pid) {
      if (!projects.has(pid)) projects.set(pid, displayName(item));
    } else unknown.push(displayName(item));
  }

  const ids = [...projects.keys()];
  let firstFailure = null;
  const sets = wanted.length
    ? await mapLimit(ids, 5, (pid) =>
        supportedReleases(pid, wanted, api).catch((err) => {
          if (!firstFailure) firstFailure = err;
          throw err;
        })
      )
    : ids.map(() => null);
  // One mod that can't be looked up is listed as such. But when NOTHING
  // answered because Modrinth couldn't be reached, that is the thing to
  // say - in Modrinth's own words - not "no version fits your mods".
  if (ids.length && firstFailure && sets.every((set) => !set) && /^(Modrinth took too long|Couldn't reach Modrinth)/.test(String(firstFailure.message || ""))) {
    throw firstFailure;
  }
  const mods = ids.map((pid, i) => ({ projectId: pid, title: projects.get(pid), versions: sets[i] }));
  const failed = mods.filter((m) => !m.versions).map((m) => m.title);
  const candidates = rankVersions(mods, { accepts, loaderVersions, current: instance.mcVersion });
  const best = candidates.find((c) => c.supported === c.total && c.total > 0 && c.server !== false) || null;
  return {
    loader: instance.loader,
    mcVersion: instance.mcVersion,
    total: mods.length - failed.length,
    accepts: accepts || null,
    mods: mods.filter((m) => m.versions).map((m) => ({ projectId: m.projectId, title: m.title })),
    unknown,
    failed,
    candidates,
    best,
  };
}

/**
 * For one project: which releases it has builds for on this instance's
 * loader, and which other loaders it exists for at all. Shown when an
 * install fails because there's no build for the instance.
 * Returns { title, loader, mcVersion, here: [versions newest first], nearest, otherLoaders: [names] }.
 */
async function projectSupport(instance, projectId, { deps = {} } = {}) {
  const api = deps.modrinth || modrinth;
  const wanted = content.loadersFor("mod", instance);
  const versions = (await api.getProjectVersions(projectId, {})) || [];
  const here = new Set();
  const others = new Set();
  for (const v of versions) {
    const loaders = v.loaders || [];
    const fits = loaders.some((l) => wanted.includes(l));
    if (fits) {
      for (const g of v.game_versions || []) if (parseMcVersion(g)) here.add(g);
    } else if ((v.game_versions || []).includes(instance.mcVersion)) {
      for (const l of loaders) if (LOADER_TITLES[l] && l !== "vanilla") others.add(LOADER_TITLES[l]);
    }
  }
  const list = [...here].sort(compareMcVersionsDesc);
  const mc = parseMcVersion(instance.mcVersion);
  // The closest version to the instance's own, preferring the next one down
  // (worlds open on a newer version but not on an older one, and servers
  // more often take older clients).
  let nearest = null;
  if (mc && list.length) {
    nearest = list.find((v) => compareTriples(parseMcVersion(v), mc) < 0) || list[list.length - 1];
  }
  return { loader: instance.loader, mcVersion: instance.mcVersion, here: list, nearest, otherLoaders: [...others] };
}

/**
 * Will this jar load on the instance? Used right after Reminth downloads a
 * mod on its own (the performance pack), so it never leaves a file in mods/
 * that the loader will then refuse to start with.
 * Returns { ok: true | false | null, why }: null = no way to tell.
 */
async function jarFitsInstance(full, instance) {
  let stat;
  try {
    stat = await fsp.stat(full);
  } catch {
    return { ok: null, why: null };
  }
  const meta = await content.readJarMeta(full, stat);
  if (!meta || !meta.descriptors) return { ok: null, why: null };
  if (wrongLoaderFamily(meta.descriptors, instance.loader, false)) {
    return { ok: false, why: `it is a ${isFabricLike(instance.loader) ? "Forge/NeoForge" : "Fabric"} build` };
  }
  if (fabricRulesApply(meta, instance.loader) && meta.mcDep) {
    const allowed = fabricPredicateAllows(meta.mcDep, instance.mcVersion);
    if (allowed === false) return { ok: false, why: `it needs Minecraft ${describePredicate(meta.mcDep)}` };
    if (allowed === true) return { ok: true, why: null };
  }
  return { ok: null, why: null };
}

module.exports = {
  checkInstance,
  jarFitsInstance,
  adviseVersions,
  projectSupport,
  invalidate,
  // pure, for tests and the renderer's own copies of the same rules
  parseMcVersion,
  compareMcVersionsDesc,
  fabricPredicateAllows,
  versionSatisfies,
  findDependencyProblems,
  findNestedMcProblems,
  parseIncompatibleMods,
  minecraftMismatches,
  mapReportToFiles,
  readLaunchReport,
  LAUNCH_REPORT_FILE,
  managedNames,
  unreadMayProvide,
  fabricRulesApply,
  describePredicate,
  summariseVersions,
  versionsFromServerText,
  serverAccepts,
  wrongLoaderFamily,
  judgeMod,
  builtForNewerOnly,
  modSetOf,
  rankVersions,
  FABRIC_API,
  QUILT_API,
};
