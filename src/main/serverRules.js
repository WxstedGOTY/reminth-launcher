"use strict";
/**
 * Mods that big servers ban, so Reminth can warn before a player joins one of them with such a mod switched on.
 *
 * Why (7 Oct 2026): the owner nearly got banned on DonutSMP for Inventory Profiles Next. Researched the same day, and
 * only what the server's own rules (or its staff) say goes in here - every server names its source. A server that
 * isn't listed isn't "safe", it just isn't checked; a mod that isn't listed isn't "allowed" either.
 *
 * Kept small on purpose: categories a server bans, and which mods fall in each. To add a server, add it to SERVERS
 * with the categories its rules name and where they came from. To add a mod, add its mod id (fabric.mod.json "id",
 * lower case) to MOD_CATEGORIES.
 */
const fsp = require("fs/promises");
const path = require("path");

/** What each category means, in the words the warning uses. */
const CATEGORIES = {
  inventory: "inventory mods (sorting, moving or refilling items for you)",
  mouse: "mouse tweaks and scrollers",
  health: "health indicators",
  radar: "radar (players or mobs shown on a map)",
  minimap: "minimaps",
  freecam: "freecam",
  freelook: "freelook (turning the camera while you walk another way)",
  otherStatus: "showing other players' status",
  noChatReports: "turning off chat reporting",
  inventoryWalk: "walking with an inventory open",
  movement: "movement mods",
  crystalOptimizer: "crystal and anchor optimizers (crystals and anchors react before the server says so)",
};

/**
 * hosts: the address and every sub-domain of it (play.donutsmp.net, donutsmp.net:25565 ...).
 * banned: CATEGORIES keys the rules name. source/url: where that came from, shown to the player.
 */
const SERVERS = [
  {
    id: "donutsmp",
    name: "DonutSMP",
    hosts: ["donutsmp.net"],
    banned: ["inventory", "mouse", "health", "radar", "freecam", "movement", "inventoryWalk"],
    source: "DonutSMP's rules (the DonutSMP wiki's copy of its terms, checked September 2026)",
    url: "https://donutsmp.wiki/client-integrity-checks",
  },
  {
    id: "hypixel",
    name: "Hypixel",
    hosts: ["hypixel.net"],
    banned: ["minimap", "radar", "inventory", "mouse", "health"],
    source: "Hypixel's Allowed Modifications page and staff answers on the Hypixel forums",
    url: "https://support.hypixel.net/hc/en-us/articles/6472550754962",
  },
  {
    id: "mccisland",
    name: "MCC Island",
    hosts: ["mccisland.net"],
    banned: ["minimap", "radar", "otherStatus", "freelook", "noChatReports", "inventoryWalk"],
    source: "MCC's Approved Mods page",
    url: "https://mcchampionship.com/help/mods/",
  },
  {
    id: "mcpvp",
    name: "MCPVP",
    hosts: ["mcpvp.com", "mcpvp.club"],
    banned: ["crystalOptimizer"],
    source:
      "MCPVP's disallowed modifications list (crystal optimisers); with them on, accounts get banned there for \"Impossible Actions\" (seen 6 Oct 2026)",
    url: "https://mcpvp.com",
  },
  // A pretend server for trying both warnings safely (7 Oct 2026: the owner can't test on DonutSMP without risking a ban).
  // ".invalid" addresses never exist (RFC 2606), so even "Join anyway" can't connect anywhere.
  {
    id: "reminth-test",
    name: "Reminth ban-warning test",
    hosts: ["bantest.reminth.invalid"],
    banned: ["inventory", "mouse", "health", "radar", "minimap", "freecam", "freelook", "otherStatus", "noChatReports", "inventoryWalk", "movement", "crystalOptimizer"],
    source: "Reminth's own test entry - not a real server, this address leads nowhere",
    url: "https://github.com/WxstedGOTY/reminth-launcher",
  },
];

/** Mod id -> categories it falls in. "radarIfOn": Xaero's Minimap counts as radar only while its radar is switched on. */
const MOD_CATEGORIES = {
  inventoryprofilesnext: ["inventory"],
  inventorytweaks: ["inventory"],
  invtweaks: ["inventory"],
  mousetweaks: ["mouse"],
  mousewheelie: ["mouse", "inventory"],
  itemscroller: ["mouse", "inventory"],
  jade: ["health"],
  wthit: ["health"],
  waila: ["health"],
  hwyla: ["health"],
  neat: ["health"],
  xaerominimap: ["minimap", "radarIfOn"],
  xaerominimapfair: ["minimap"],
  journeymap: ["minimap", "radar"],
  voxelmap: ["minimap", "radar"],
  freecam: ["freecam"],
  freelook: ["freelook"],
  perspectivemod: ["freelook"],
  totemcounter: ["otherStatus"],
  nochatreports: ["noChatReports"],
  invmove: ["inventoryWalk", "movement"],
  // mod ids as their jars say (Client Side Crystals and Anchor Optimizer are bundles: the outer id counts)
  marlowcrystal: ["crystalOptimizer"],
  kindscrystaloptimizer: ["crystalOptimizer"],
  clientsidecrystals: ["crystalOptimizer"],
  clientsidecrystals_bundle: ["crystalOptimizer"],
  client_side_anchors: ["crystalOptimizer"],
  client_side_anchors_bundle: ["crystalOptimizer"],
  kinds_anchor_optimizer: ["crystalOptimizer"],
  crystaloptimizer: ["crystalOptimizer"],
};

/** Pure: the listed server an address belongs to, or null. "Play.DonutSMP.net:25565" -> DonutSMP. */
function serverFor(address) {
  let host = String(address || "").trim().toLowerCase();
  if (!host) return null;
  host = host.replace(/^\[([^\]]*)\](:\d+)?$/, "$1").replace(/:\d+$/, "").replace(/\.$/, "");
  return SERVERS.find((s) => s.hosts.some((h) => host === h || host.endsWith("." + h))) || null;
}

/** Xaero's Minimap's radar is on unless its settings say "display_radar = false" (Reminth writes that). */
async function xaeroRadarOn(gameDir) {
  try {
    const text = await fsp.readFile(path.join(gameDir, "config", "xaero", "minimap", "profiles", "default.cfg"), "utf8");
    const m = /^\s*display_radar\s*=\s*(\w+)/m.exec(text);
    return !(m && m[1].toLowerCase() === "false");
  } catch {
    return true; // its own default
  }
}

/** Pure: the categories of one mod (by its id), given whether Xaero's radar is on. */
function categoriesOf(modId, { radarOn = true } = {}) {
  const list = MOD_CATEGORIES[String(modId || "").toLowerCase()] || [];
  return list.flatMap((c) => (c === "radarIfOn" ? (radarOn ? ["radar"] : []) : [c]));
}

/**
 * Pure: for each listed server among `addresses` ([{ address, why }], why = "join" | "list" | "played"), the switched-on
 * mods its rules ban. mods: [{ file, title, modId, enabled }]. Returns
 * [{ server: { id, name, source, url }, why, mods: [{ file, title, categories: [labels] }] }], servers with none left out.
 */
function findBanned(mods, addresses, { radarOn = true } = {}) {
  const seen = new Map();
  for (const a of addresses || []) {
    const server = serverFor(a && a.address);
    if (!server) continue;
    const rank = { join: 0, played: 1, list: 2 };
    const prev = seen.get(server.id);
    if (!prev || (rank[a.why] ?? 3) < (rank[prev.why] ?? 3)) seen.set(server.id, { server, why: a.why });
  }
  const out = [];
  for (const { server, why } of seen.values()) {
    const hits = [];
    for (const m of mods || []) {
      if (!m || m.enabled === false || !m.modId) continue;
      const cats = categoriesOf(m.modId, { radarOn }).filter((c) => server.banned.includes(c));
      if (cats.length) hits.push({ file: m.file, title: m.title || m.modId, categories: [...new Set(cats)].map((c) => CATEGORIES[c]) });
    }
    if (hits.length) out.push({ server: { id: server.id, name: server.name, source: server.source, url: server.url }, why, mods: hits });
  }
  return out;
}

/**
 * The check before Play: the servers this instance is about to join (`join`), has in its server list, or has joined
 * before (the game's logs), and the mods switched on that their rules ban. `deps` for tests.
 */
async function checkInstance(inst, { join = null } = {}, deps = {}) {
  if (!inst || inst.loader === "vanilla") return [];
  const content = deps.content || require("./content");
  const gameData = deps.gameData || require("./gameData");
  const addresses = [];
  if (join && typeof join === "string") addresses.push({ address: join, why: "join" });
  else if (join && typeof join.address === "string") addresses.push({ address: join.address, why: "join" });
  try {
    for (const s of await gameData.listServers(inst.gameDir, inst)) addresses.push({ address: s.address, why: "list" });
  } catch {
    // no server list
  }
  try {
    const times = await gameData.readServerJoinTimes(inst.gameDir);
    for (const host of times instanceof Map ? times.keys() : Object.keys(times || {})) addresses.push({ address: host, why: "played" });
  } catch {
    // no logs
  }
  if (!addresses.some((a) => serverFor(a.address))) return [];
  const all = await content.listAll(inst.gameDir);
  const mods = ((all && all.mod) || []).map((m) => ({ file: m.file, title: m.title || m.name || null, modId: m.modId, enabled: m.enabled }));
  return findBanned(mods, addresses, { radarOn: await xaeroRadarOn(inst.gameDir) });
}

/**
 * Pure: what the home-screen mod reads (config/reminth-server-rules.json): for every listed server, the mods switched
 * on here that it bans, by mod id. The game asks before joining one of them. `accepted`: server ids the player already
 * said "Play anyway" for in Reminth - not asked again in the game.
 */
function gameRules(mods, { radarOn = true, accepted = [] } = {}) {
  const servers = [];
  for (const server of SERVERS) {
    const found = findBanned(mods, [{ address: server.hosts[0], why: "list" }], { radarOn });
    const hit = found[0];
    if (!hit) continue;
    const byFile = new Map((mods || []).map((m) => [m.file, m]));
    servers.push({
      id: server.id,
      name: server.name,
      hosts: server.hosts,
      source: server.source,
      accepted: accepted.includes(server.id),
      mods: hit.mods.map((m) => ({ id: String(byFile.get(m.file).modId).toLowerCase(), title: m.title, why: m.categories.join(", ") })),
    });
  }
  return { servers };
}

/** Writes that file for a Fabric/Quilt instance (an empty list when nothing applies, so an old one never lingers). */
async function writeGameFile(inst, { accepted = [] } = {}, deps = {}) {
  if (!inst || (inst.loader !== "fabric" && inst.loader !== "quilt")) return null;
  const content = deps.content || require("./content");
  const all = await content.listAll(inst.gameDir);
  const mods = ((all && all.mod) || []).map((m) => ({ file: m.file, title: m.title || m.name || null, modId: m.modId, enabled: m.enabled }));
  const data = gameRules(mods, { radarOn: await xaeroRadarOn(inst.gameDir), accepted });
  const dir = path.join(inst.gameDir, "config");
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, "reminth-server-rules.json"), JSON.stringify(data, null, 2) + "\n", "utf8");
  return data;
}

module.exports = {
  gameRules,
  writeGameFile, CATEGORIES, SERVERS, MOD_CATEGORIES, serverFor, categoriesOf, findBanned, checkInstance, xaeroRadarOn };
