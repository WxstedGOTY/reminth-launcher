"use strict";
/**
 * The signed-in player's own PvP tiers, for Home's "PvP tiers" card (the Night home page, 14 Oct 2026).
 *
 * The same three public tier lists ReminthHUD's Tier Tagger reads in game (hud/panel/.../TierTagger.java): MCTiers,
 * PvPTiers and SubTiers. All three answer GET <url><uuid> with {rankings: {mode: {tier 1-5, pos 0 = high / 1 = low,
 * retired}}}; a player who isn't on a list gets a 404. Only the player's Minecraft account id is sent (no name, no
 * token). Looked up at most once per 30 minutes (2 minutes after a failure).
 */

const SITES = [
  { title: "MCTiers", url: "https://mctiers.com/api/v2/profile/", dashed: true },
  { title: "PvPTiers", url: "https://pvptiers.com/api/profile/", dashed: false },
  { title: "SubTiers", url: "https://subtiers.net/api/v2/profile/", dashed: true },
];

// The lists' own names for their gamemodes (the keys differ a little from list to list).
const MODE_NAMES = {
  vanilla: "Vanilla",
  crystal: "Crystal",
  sword: "Sword",
  uhc: "UHC",
  pot: "Pot",
  nethop: "NethOP",
  neth_pot: "NethOP",
  nethpot: "NethOP",
  smp: "SMP",
  axe: "Axe",
  mace: "Mace",
  elytra: "Elytra",
  trident: "Trident",
  bed: "Bed",
  minecart: "Minecart",
  creeper: "Creeper",
  dia_smp: "Dia SMP",
  dia_crystal: "Dia Crystal",
  manhunt: "Manhunt",
  og_vanilla: "OG Vanilla",
  speed: "Speed",
  bow: "Bow",
  debuff: "DeBuff",
};

function modeName(key) {
  if (MODE_NAMES[key]) return MODE_NAMES[key];
  const s = String(key).replace(/_/g, " ");
  return s ? s[0].toUpperCase() + s.slice(1) : String(key);
}

/** "0123...cdef" or "0123-...-cdef" -> { dashed, plain }, or null for anything that isn't a Minecraft account id. */
function uuidForms(uuid) {
  const plain = String(uuid || "").replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(plain)) return null;
  const dashed = `${plain.slice(0, 8)}-${plain.slice(8, 12)}-${plain.slice(12, 16)}-${plain.slice(16, 20)}-${plain.slice(20)}`;
  return { plain, dashed };
}

/** One list's answer -> [{ mode, tier, high, retired }] (anything malformed is skipped). */
function parseRankings(body) {
  const out = [];
  const rk = body && typeof body === "object" ? body.rankings : null;
  if (!rk || typeof rk !== "object" || Array.isArray(rk)) return out;
  for (const [key, o] of Object.entries(rk)) {
    if (!o || typeof o !== "object") continue;
    const tier = Number(o.tier);
    if (!Number.isInteger(tier) || tier < 1 || tier > 5) continue;
    out.push({ mode: key.toLowerCase(), tier, high: Number(o.pos) === 0, retired: o.retired === true });
  }
  return out;
}

/** HT1 is the best (11), LT5 the lowest (2) - the same order as the Tier Tagger. */
const score = (r) => (6 - r.tier) * 2 + (r.high ? 1 : 0);

/**
 * Every list's ranks -> one rank per gamemode: the best one (a current tier beats a retired one of the same height),
 * with the lists that gave it; best first.
 * perSite: [{ site: "MCTiers", ranks: [...] }]
 */
function mergeRanks(perSite) {
  const byMode = new Map();
  for (const { site, ranks } of perSite) {
    for (const r of ranks || []) {
      const name = modeName(r.mode);
      const cur = byMode.get(name);
      const better = !cur || score(r) > cur.score || (score(r) === cur.score && cur.retired && !r.retired);
      if (better) byMode.set(name, { mode: r.mode, modeName: name, tier: r.tier, high: r.high, retired: r.retired, score: score(r), label: (r.high ? "HT" : "LT") + r.tier, sites: [site] });
      else if (score(r) === cur.score && r.retired === cur.retired && !cur.sites.includes(site)) cur.sites.push(site);
    }
  }
  return [...byMode.values()].sort((a, b) => b.score - a.score || Number(a.retired) - Number(b.retired) || a.modeName.localeCompare(b.modeName));
}

const FRESH_MS = 30 * 60 * 1000;
const RETRY_MS = 2 * 60 * 1000;
const cache = new Map(); // uuid -> { at, result, failed, pending }

async function fetchSite(site, ids, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetchImpl(site.url + (site.dashed ? ids.dashed : ids.plain), {
      signal: controller.signal,
      headers: { "User-Agent": "Spaceport (https://reminth.pages.dev)", Accept: "application/json" },
    });
    if (res.status === 200) return { site: site.title, reached: true, ranks: parseRankings(await res.json()) };
    if (res.status === 404) return { site: site.title, reached: true, ranks: [] }; // not on this list
    return { site: site.title, reached: false, ranks: [] };
  } catch {
    return { site: site.title, reached: false, ranks: [] };
  } finally {
    clearTimeout(timer);
  }
}

/** { reached, ranks } for this account id; reached = at least one list answered. */
async function playerTiers(uuid, { fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  const ids = uuidForms(uuid);
  if (!ids) return { reached: false, ranks: [], error: "Not signed in." };
  const hit = cache.get(ids.plain);
  if (hit && hit.pending) return hit.pending;
  if (hit && hit.result && now - hit.at < (hit.failed ? RETRY_MS : FRESH_MS)) return hit.result;
  const pending = (async () => {
    const answers = await Promise.all(SITES.map((s) => fetchSite(s, ids, fetchImpl)));
    const reached = answers.some((a) => a.reached);
    const result = { reached, ranks: mergeRanks(answers) };
    cache.set(ids.plain, { at: Date.now(), result, failed: !answers.every((a) => a.reached) });
    return result;
  })();
  cache.set(ids.plain, { ...(hit || {}), pending });
  try {
    return await pending;
  } catch {
    cache.delete(ids.plain);
    return { reached: false, ranks: [] };
  }
}

module.exports = { SITES, modeName, uuidForms, parseRankings, mergeRanks, playerTiers, _cache: cache };
