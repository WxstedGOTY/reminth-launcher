"use strict";
/**
 * Mod loader metadata: which Minecraft versions each loader supports, and
 * which loader builds exist for a given Minecraft version.
 *
 *   Fabric    meta.fabricmc.net        (profile JSON, like the official Fabric installer)
 *   Quilt     meta.quiltmc.org         (profile JSON, same shape as Fabric's)
 *   Forge     maven.minecraftforge.net (installer jar - see forge.js)
 *   NeoForge  maven.neoforged.net      (installer jar - see forge.js)
 *
 * Everything here is read-only public metadata. Results are cached in memory
 * for 15 minutes so opening the version picker twice doesn't hit four
 * servers twice.
 */
const { fetchJson } = require("./downloader");

const LOADERS = ["vanilla", "fabric", "quilt", "forge", "neoforge"];
const LOADER_NAMES = { vanilla: "Vanilla", fabric: "Fabric", quilt: "Quilt", forge: "Forge", neoforge: "NeoForge" };

const FABRIC_META = "https://meta.fabricmc.net/v2";
const QUILT_META = "https://meta.quiltmc.org/v3";
const FORGE_MAVEN = "https://maven.minecraftforge.net";
const FORGE_PROMOS = "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";
const NEOFORGE_MAVEN = "https://maven.neoforged.net";
const NEOFORGE_API = `${NEOFORGE_MAVEN}/api/maven/versions/releases/net/neoforged`;

const TTL_MS = 15 * 60 * 1000;
const cache = new Map();
async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

/**
 * Pure: compares two loader version strings, newest first when used with
 * sort(). The numeric core ("0.30.1", "26.2.0.88", "47.4.0") is compared
 * number by number; on a tie, a release beats a pre-release
 * ("0.30.1" > "0.30.1-beta.4"), and pre-releases compare naturally
 * ("beta.10" > "beta.9").
 */
function compareVersions(a, b) {
  const split = (v) => {
    const m = String(v).match(/^(\d+(?:\.\d+)*)(.*)$/);
    return m ? { core: m[1].split(".").map(Number), rest: m[2] } : { core: [], rest: String(v) };
  };
  const x = split(a);
  const y = split(b);
  const len = Math.max(x.core.length, y.core.length);
  for (let i = 0; i < len; i++) {
    const d = (x.core[i] || 0) - (y.core[i] || 0);
    if (d) return d;
  }
  if (x.rest === y.rest) return 0;
  if (!x.rest) return 1;
  if (!y.rest) return -1;
  return x.rest.localeCompare(y.rest, "en", { numeric: true });
}

/** Pure: true for "0.30.1" / "26.2.0.88", false for "-beta", "-alpha", "-rc", "-pre". */
function isStableVersion(v) {
  return !/(alpha|beta|rc|pre|snapshot)/i.test(String(v));
}

/**
 * Pure: the Minecraft version a NeoForge build targets.
 *   20.4.237          -> 1.20.4
 *   21.0.167          -> 1.21
 *   21.10.5-beta      -> 1.21.10
 *   26.1.0.19-beta    -> 26.1
 *   26.1.2.40         -> 26.1.2
 *   26.1.0.0-alpha.1+snapshot-1 -> 26.1-snapshot-1
 *   0.25w14craftmine.3-beta     -> 25w14craftmine
 */
function neoforgeMcVersion(version) {
  const v = String(version);
  const [head, build] = v.split("+");
  const core = head.split("-")[0];
  const parts = core.split(".");
  if (parts[0] === "0" && parts.length >= 2 && /[a-z]/i.test(parts[1])) return parts[1];
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n)) || nums.length < 2) return null;
  let mc;
  if (nums[0] >= 25) {
    // Year-based: <year>.<drop>.<hotfix>.<build>
    mc = nums[2] ? `${nums[0]}.${nums[1]}.${nums[2]}` : `${nums[0]}.${nums[1]}`;
    if (build) mc += `-${build}`;
  } else {
    mc = nums[1] ? `1.${nums[0]}.${nums[1]}` : `1.${nums[0]}`;
  }
  return mc;
}

/** Pure: "1.20.1-47.4.0" -> "1.20.1"; "1.7.10-10.13.4.1614-1.7.10" -> "1.7.10". */
function forgeMcVersion(mavenVersion) {
  return String(mavenVersion).split("-")[0];
}

/** Pure: "1.20.1-47.4.0" -> "47.4.0"; "1.7.10-10.13.4.1614-1.7.10" -> "10.13.4.1614-1.7.10". */
function forgeShortVersion(mavenVersion, mc) {
  const v = String(mavenVersion);
  const prefix = `${mc || forgeMcVersion(v)}-`;
  return v.startsWith(prefix) ? v.slice(prefix.length) : v;
}

/**
 * Pure: finds the full maven version for a Forge build, given the short
 * version a modpack or the picker names ("47.4.0", or the full thing
 * already). Legacy builds carry a branch suffix ("-1.7.10") that packs omit.
 */
function matchForgeMavenVersion(all, mc, wanted) {
  const w = String(wanted || "");
  if (all.includes(w)) return w;
  const full = `${mc}-${w}`;
  if (all.includes(full)) return full;
  return all.find((v) => v.startsWith(`${full}-`)) || null;
}

/** Pure: Forge only ships an installer from Minecraft 1.6 on - older builds were jar mods. */
function forgeHasInstaller(mc) {
  return !/^1\.[0-5](\.|$|_)/.test(String(mc)) && String(mc) !== "1.1";
}

/* ------------------------------------------------------------------ */
/* Raw lists                                                           */
/* ------------------------------------------------------------------ */

function forgeMavenVersions() {
  return cached("forge:maven", async () => {
    const xml = await fetchText(`${FORGE_MAVEN}/net/minecraftforge/forge/maven-metadata.xml`);
    return [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
  });
}

function forgePromos() {
  return cached("forge:promos", async () => {
    try {
      return (await fetchJson(FORGE_PROMOS)).promos || {};
    } catch {
      return {}; // only used to pick a default - the version list still works without it
    }
  });
}

function neoforgeVersions() {
  return cached("neoforge:list", async () => (await fetchJson(`${NEOFORGE_API}/neoforge`)).versions || []);
}

/** NeoForge's 1.20.1 builds live under the old net.neoforged:forge coordinates. */
function neoforgeLegacyVersions() {
  return cached("neoforge:legacy", async () => {
    try {
      const list = (await fetchJson(`${NEOFORGE_API}/forge`)).versions || [];
      return list.filter((v) => v.startsWith("1.20.1-"));
    } catch {
      return [];
    }
  });
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * { fabric: [...mc], quilt: [...], forge: [...], neoforge: [...] } - the
 * Minecraft versions each loader has at least one build for. A loader whose
 * server is down comes back as null (unknown), not [] (unsupported), so the
 * picker can say so instead of greying everything out.
 */
async function supportedGameVersions() {
  const safe = (p) => p.catch(() => null);
  const [fabric, quilt, forge, neo, neoLegacy] = await Promise.all([
    safe(cached("fabric:game", () => fetchJson(`${FABRIC_META}/versions/game`))),
    safe(cached("quilt:game", () => fetchJson(`${QUILT_META}/versions/game`))),
    safe(forgeMavenVersions()),
    safe(neoforgeVersions()),
    safe(neoforgeLegacyVersions()),
  ]);
  return {
    fabric: fabric ? fabric.map((g) => g.version) : null,
    quilt: quilt ? quilt.map((g) => g.version) : null,
    forge: forge ? [...new Set(forge.map(forgeMcVersion))].filter(forgeHasInstaller) : null,
    neoforge: neo
      ? [...new Set([...neo.map(neoforgeMcVersion).filter(Boolean), ...((neoLegacy || []).length ? ["1.20.1"] : [])])]
      : null,
  };
}

/**
 * Builds of `loader` for Minecraft `mc`, newest first:
 * [{ id, label, stable, recommended }]. `id` is what gets stored on the
 * instance and handed to the installer.
 */
async function loaderVersions(loader, mc) {
  mc = String(mc);
  if (loader === "fabric") {
    const list = await fetchJson(`${FABRIC_META}/versions/loader/${encodeURIComponent(mc)}`);
    const out = (list || []).map((e) => ({ id: e.loader.version, label: e.loader.version, stable: Boolean(e.loader.stable) }));
    const rec = out.find((e) => e.stable);
    if (rec) rec.recommended = true;
    return out;
  }
  if (loader === "quilt") {
    const list = await cached(`quilt:loader:${mc}`, () => fetchJson(`${QUILT_META}/versions/loader/${encodeURIComponent(mc)}`));
    const ids = [...new Set((list || []).map((e) => e.loader.version))].sort((a, b) => compareVersions(b, a));
    const out = ids.map((id) => ({ id, label: id, stable: isStableVersion(id) }));
    const rec = out.find((e) => e.stable);
    if (rec) rec.recommended = true;
    return out;
  }
  if (loader === "forge") {
    const all = (await forgeMavenVersions()).filter((v) => forgeMcVersion(v) === mc);
    const promos = await forgePromos();
    const rec = promos[`${mc}-recommended`];
    const latest = promos[`${mc}-latest`];
    return all
      .map((v) => forgeShortVersion(v, mc))
      .sort((a, b) => compareVersions(b, a))
      .map((id) => ({
        id,
        label: id,
        stable: true,
        recommended: Boolean(rec) && (id === rec || id.startsWith(`${rec}-`)),
        latest: Boolean(latest) && (id === latest || id.startsWith(`${latest}-`)),
      }));
  }
  if (loader === "neoforge") {
    if (mc === "1.20.1") {
      const legacy = await neoforgeLegacyVersions();
      return legacy
        .map((v) => v.slice("1.20.1-".length))
        .sort((a, b) => compareVersions(b, a))
        .map((id, i) => ({ id, label: id, stable: true, recommended: i === 0 }));
    }
    const all = (await neoforgeVersions()).filter((v) => neoforgeMcVersion(v) === mc).sort((a, b) => compareVersions(b, a));
    const out = all.map((id) => ({ id, label: id, stable: isStableVersion(id) }));
    const rec = out.find((e) => e.stable) || out[0];
    if (rec) rec.recommended = true;
    return out;
  }
  return [];
}

/** The build to use when the instance doesn't pin one: recommended, else newest. */
async function defaultLoaderVersion(loader, mc) {
  const list = await loaderVersions(loader, mc);
  if (!list.length) {
    throw new Error(`${LOADER_NAMES[loader] || loader} doesn't have a build for Minecraft ${mc}.`);
  }
  return (list.find((e) => e.recommended) || list[0]).id;
}

/** Forge: the full maven version ("1.20.1-47.4.0") for an instance's stored build id. */
async function resolveForgeMavenVersion(mc, id) {
  const found = matchForgeMavenVersion(await forgeMavenVersions(), mc, id);
  if (!found) throw new Error(`Forge ${id} for Minecraft ${mc} doesn't exist on Forge's maven.`);
  return found;
}

/**
 * The installer jar URL for a Forge/NeoForge build, plus a stable key for
 * caching it. NeoForge 1.20.1 is the one build line under the old
 * "forge" artifact name.
 */
async function installerFor(loader, mc, id) {
  if (loader === "forge") {
    const v = await resolveForgeMavenVersion(mc, id);
    return { key: `forge-${v}`, version: v, url: `${FORGE_MAVEN}/net/minecraftforge/forge/${v}/forge-${v}-installer.jar` };
  }
  if (loader === "neoforge") {
    if (mc === "1.20.1") {
      const all = await neoforgeLegacyVersions();
      const v = all.includes(`1.20.1-${id}`) ? `1.20.1-${id}` : all.includes(id) ? id : null;
      if (!v) throw new Error(`NeoForge ${id} for Minecraft 1.20.1 doesn't exist.`);
      return { key: `neoforge-${v}`, version: v, url: `${NEOFORGE_MAVEN}/releases/net/neoforged/forge/${v}/forge-${v}-installer.jar` };
    }
    if (!/^[\w.+-]{1,64}$/.test(String(id))) throw new Error("Unusable NeoForge version.");
    return { key: `neoforge-${id}`, version: id, url: `${NEOFORGE_MAVEN}/releases/net/neoforged/neoforge/${id}/neoforge-${id}-installer.jar` };
  }
  throw new Error(`${loader} has no installer.`);
}

module.exports = {
  LOADERS,
  LOADER_NAMES,
  FABRIC_META,
  QUILT_META,
  supportedGameVersions,
  loaderVersions,
  defaultLoaderVersion,
  resolveForgeMavenVersion,
  installerFor,
  // pure, for tests
  compareVersions,
  isStableVersion,
  neoforgeMcVersion,
  forgeMcVersion,
  forgeShortVersion,
  matchForgeMavenVersion,
  forgeHasInstaller,
};
