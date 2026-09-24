"use strict";
/**
 * Reads what the player has actually done, straight off disk: their worlds
 * (saves/<world>/level.dat), their saved servers (servers.dat) and their
 * vanilla statistics (saves/<world>/players/stats/<uuid>.json).
 *
 * Everything here is read-only and best-effort: a missing/corrupt file makes
 * that one entry disappear, never breaks the page. Nothing in this module
 * invents data - if Minecraft doesn't record something (e.g. when you last
 * joined a given server), Reminth shows nothing for it rather than guessing.
 *
 * Paths and field names were verified against a real Minecraft 26.2 instance
 * rather than assumed - notably the stats folder moved to
 * saves/<world>/players/stats/ (older versions used saves/<world>/stats/),
 * and both layouts are handled below.
 */
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const zlib = require("zlib");

/** Ceiling on how far a rolled-up .log.gz is allowed to expand when read. */
const MAX_DECOMPRESSED_LOG_BYTES = 64 * 1024 * 1024;

const paths = require("./paths");
const nbt = require("./nbt");

const TICKS_PER_SECOND = 20;
const MAX_WORLD_ICON_BYTES = 512 * 1024; // world icons are ~8KB; this is purely a sanity clamp

/* ------------------------------------------------------------------ */
/* worlds                                                             */
/* ------------------------------------------------------------------ */

/** Where each instance keeps things (every instance has its own game folder - see instances.js). */
const savesDir = (gameDir) => path.join(gameDir || paths.GAME_DIR, "saves");
const serversFile = (gameDir) => path.join(gameDir || paths.GAME_DIR, "servers.dat");
const logsDir = (gameDir) => path.join(gameDir || paths.GAME_DIR, "logs");

async function listWorlds(accountUuid, gameDir, instance) {
  let entries;
  try {
    entries = await fsp.readdir(savesDir(gameDir), { withFileTypes: true });
  } catch {
    return []; // no saves folder yet - fresh install, nothing played
  }

  const worlds = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(savesDir(gameDir), entry.name);
    const world = await readWorld(dir, entry.name, accountUuid);
    if (world) {
      if (instance) {
        world.instanceId = instance.id;
        world.instanceName = instance.name;
        world.id = `world:${instance.id}:${entry.name}`;
      }
      worlds.push(world);
    }
  }
  worlds.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  return worlds;
}

async function readWorld(dir, folderName, accountUuid) {
  let data;
  try {
    const raw = await fsp.readFile(path.join(dir, "level.dat"));
    data = nbt.parse(raw).Data || {};
  } catch {
    return null; // not a world folder, or level.dat is mid-write/corrupt
  }

  const stats = await readWorldStats(dir, accountUuid);
  return {
    type: "world",
    id: "world:" + folderName,
    folder: folderName,
    name: typeof data.LevelName === "string" && data.LevelName.trim() ? data.LevelName : folderName,
    lastPlayed: typeof data.LastPlayed === "number" ? data.LastPlayed : null,
    version: data.Version && typeof data.Version.Name === "string" ? data.Version.Name : null,
    gameMode: gameModeName(data.GameType),
    hardcore: data.hardcore === 1,
    playTimeTicks: stats ? stats.playTimeTicks : 0,
    icon: await readIconFile(path.join(dir, "icon.png")),
  };
}

function gameModeName(gameType) {
  return ["Survival", "Creative", "Adventure", "Spectator"][gameType] || null;
}

async function readIconFile(file) {
  try {
    const stat = await fsp.stat(file);
    if (stat.size > MAX_WORLD_ICON_BYTES) return null;
    const buf = await fsp.readFile(file);
    return "data:image/png;base64," + buf.toString("base64");
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* servers                                                            */
/* ------------------------------------------------------------------ */

async function listServers(gameDir, instance) {
  let root;
  try {
    root = nbt.parse(await fsp.readFile(serversFile(gameDir)));
  } catch {
    return [];
  }
  const list = Array.isArray(root.servers) ? root.servers : [];
  return list
    .filter((s) => s && typeof s.ip === "string")
    .map((s, i) => ({
      type: "server",
      id: "server:" + s.ip + ":" + i,
      name: typeof s.name === "string" && s.name.trim() ? s.name : s.ip,
      address: s.ip,
      // servers.dat stores the server's icon inline as base64 PNG.
      icon: typeof s.icon === "string" && s.icon.length ? "data:image/png;base64," + s.icon : null,
      lastPlayed: null, // filled in from the logs below when we can prove it
      instanceId: instance ? instance.id : null,
      instanceName: instance ? instance.name : null,
    }));
}

/**
 * Minecraft does not record when you last joined a given server anywhere on
 * disk, so the only honest source is the game's own logs. This scans them for
 * connection lines and returns { host: timestampMs }. If the log format ever
 * changes (or the player has only ever played singleplayer, as on a fresh
 * install) this simply finds nothing and every server shows no timestamp -
 * which is the intended outcome, not a failure.
 */
async function readServerJoinTimes(gameDir) {
  const joins = new Map();
  let files;
  try {
    files = await fsp.readdir(logsDir(gameDir));
  } catch {
    return joins;
  }

  // Newest first, and never read more than a handful - logs can pile up.
  const candidates = files
    .filter((f) => f === "latest.log" || /^\d{4}-\d{2}-\d{2}-\d+\.log(\.gz)?$/.test(f))
    .sort()
    .reverse()
    .slice(0, 12);

  for (const file of candidates) {
    let text;
    let fileDate;
    try {
      const full = path.join(logsDir(gameDir), file);
      const raw = await fsp.readFile(full);
      // Capped for the same reason as nbt.js: a synchronous gunzip with no
      // ceiling turns one crafted .log.gz into a hung, then dead, launcher.
      text = file.endsWith(".gz")
        ? zlib.gunzipSync(raw, { maxOutputLength: MAX_DECOMPRESSED_LOG_BYTES }).toString("utf8")
        : raw.toString("utf8");
      fileDate = dateFromLogName(file) || (await fsp.stat(full)).mtime;
    } catch {
      continue;
    }

    // e.g. "[14:35:30] [Render thread/INFO]: Connecting to donutsmp.net, 25565"
    const re = /\[(\d{2}):(\d{2}):(\d{2})\][^\n]*Connecting to ([^,\s]+)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const when = new Date(fileDate);
      when.setHours(Number(m[1]), Number(m[2]), Number(m[3]), 0);
      const host = m[4].toLowerCase();
      let ms = when.getTime();
      // A session that runs past midnight writes pre-midnight lines into a
      // file whose date is the next day, which would put the join in the
      // future and make the UI say "just now" forever. Pull those back a day.
      if (ms > Date.now()) ms -= 24 * 60 * 60 * 1000;
      if (ms > Date.now()) continue; // still ahead: the clock is wrong, skip it
      if (!joins.has(host) || joins.get(host) < ms) joins.set(host, ms);
    }
  }
  return joins;
}

function dateFromLogName(file) {
  const m = file.match(/^(\d{4})-(\d{2})-(\d{2})-\d+\.log/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/* ------------------------------------------------------------------ */
/* statistics                                                         */
/* ------------------------------------------------------------------ */

/** Mojang's API hands back undashed UUIDs; the files on disk are dashed. */
function normalizeUuid(uuid) {
  return String(uuid || "").replace(/-/g, "").toLowerCase();
}

async function readWorldStats(worldDir, accountUuid) {
  // 26.2 keeps these in players/stats/; older versions used stats/.
  for (const dir of [path.join(worldDir, "players", "stats"), path.join(worldDir, "stats")]) {
    let files;
    try {
      files = (await fsp.readdir(dir)).filter((f) => f.endsWith(".json"));
    } catch {
      continue;
    }
    if (!files.length) continue;

    const wanted = normalizeUuid(accountUuid);
    const match = files.find((f) => normalizeUuid(path.basename(f, ".json")) === wanted);
    // If we know who is signed in, only ever read THEIR stats file. Falling
    // back to "the only file present" meant that on a shared computer - or
    // before signing in - Reminth would show someone else's deaths and
    // playtime as yours. With no account known, a single unambiguous file is
    // still fine to read.
    const chosen = wanted ? match : files.length === 1 ? files[0] : null;
    if (!chosen) continue;

    try {
      const json = JSON.parse(await fsp.readFile(path.join(dir, chosen), "utf8"));
      const s = json.stats || {};
      const custom = s["minecraft:custom"] || {};
      return {
        playTimeTicks: custom["minecraft:play_time"] || custom["minecraft:play_one_minute"] || 0,
        custom,
        mined: s["minecraft:mined"] || {},
        killed: s["minecraft:killed"] || {},
        used: s["minecraft:used"] || {},
        crafted: s["minecraft:crafted"] || {},
        pickedUp: s["minecraft:picked_up"] || {},
        killedBy: s["minecraft:killed_by"] || {},
      };
    } catch {
      continue;
    }
  }
  return null;
}

function addInto(target, source) {
  for (const [k, v] of Object.entries(source || {})) {
    if (typeof v === "number") target[k] = (target[k] || 0) + v;
  }
}

function topEntries(map, limit) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, count]) => ({ id, count }));
}

function sumValues(map) {
  return Object.values(map).reduce((a, b) => a + b, 0);
}

/**
 * Aggregates the player's stats across every world in the instance. Returns
 * found:false when the player hasn't generated any stats yet (fresh install)
 * so the UI can show a real empty state instead of a wall of zeroes.
 */
async function playerStats(accountUuid, instances) {
  const sources = instances && instances.length ? instances : [{ id: null, name: null, gameDir: paths.GAME_DIR }];
  const worlds = [];
  for (const inst of sources) {
    for (const w of await listWorlds(accountUuid, inst.gameDir, inst.id ? inst : null)) {
      worlds.push({ ...w, _dir: path.join(savesDir(inst.gameDir), w.folder) });
    }
  }
  const custom = {};
  const mined = {};
  const killed = {};
  const used = {};
  const crafted = {};
  const pickedUp = {};
  const killedBy = {};
  const perWorld = [];
  let found = false;

  for (const world of worlds) {
    const stats = await readWorldStats(world._dir, accountUuid);
    if (!stats) continue;
    found = true;
    addInto(custom, stats.custom);
    addInto(mined, stats.mined);
    addInto(killed, stats.killed);
    addInto(used, stats.used);
    addInto(crafted, stats.crafted);
    addInto(pickedUp, stats.pickedUp);
    addInto(killedBy, stats.killedBy);
    // No icon here on purpose: each one is a base64 PNG and the statistics
    // page only draws bars, so shipping them would move megabytes over IPC
    // for nothing.
    perWorld.push({
      name: world.name,
      folder: world.instanceName && sources.length > 1 ? `${world.instanceName} / ${world.folder}` : world.folder,
      playTimeTicks: stats.playTimeTicks,
    });
  }

  const cm = (key) => custom["minecraft:" + key] || 0;
  return {
    found,
    worldCount: worlds.length,
    playTimeTicks: cm("play_time") || cm("play_one_minute"),
    deaths: cm("deaths"),
    mobKills: cm("mob_kills"),
    playerKills: cm("player_kills"),
    jumps: cm("jump"),
    damageDealt: cm("damage_dealt"),
    damageTaken: cm("damage_taken"),
    timeSinceDeath: cm("time_since_death"),
    itemsDropped: cm("drop"),
    // All distances are centimetres in the stats file.
    distances: {
      walk: cm("walk_one_cm"),
      sprint: cm("sprint_one_cm"),
      swim: cm("swim_one_cm"),
      fall: cm("fall_one_cm"),
      fly: cm("fly_one_cm"),
      boat: cm("boat_one_cm"),
      minecart: cm("minecart_one_cm"),
      horse: cm("horse_one_cm"),
      elytra: cm("aviate_one_cm"),
      crouch: cm("crouch_one_cm"),
    },
    totals: {
      mined: sumValues(mined),
      killed: sumValues(killed),
      used: sumValues(used),
      crafted: sumValues(crafted),
      pickedUp: sumValues(pickedUp),
    },
    top: {
      mined: topEntries(mined, 8),
      killed: topEntries(killed, 8),
      used: topEntries(used, 8),
      crafted: topEntries(crafted, 8),
      killedBy: topEntries(killedBy, 5),
    },
    perWorld: perWorld.sort((a, b) => b.playTimeTicks - a.playTimeTicks),
  };
}

/* ------------------------------------------------------------------ */
/* what the home screen needs                                         */
/* ------------------------------------------------------------------ */

/**
 * `instances`: [{ id, name, gameDir }]. Worlds and servers are gathered from
 * every one of them and tagged with the instance they belong to.
 */
async function recentActivity(accountUuid, limit = 5, instances) {
  const sources = instances && instances.length ? instances : [{ id: null, name: null, gameDir: paths.GAME_DIR }];
  const worlds = [];
  const servers = [];
  for (const inst of sources) {
    const tag = inst.id ? inst : null;
    const [w, s, joinTimes] = await Promise.all([
      listWorlds(accountUuid, inst.gameDir, tag),
      listServers(inst.gameDir, tag),
      readServerJoinTimes(inst.gameDir),
    ]);
    for (const server of s) {
      const host = String(server.address).split(":")[0].toLowerCase();
      if (joinTimes.has(host)) server.lastPlayed = joinTimes.get(host);
    }
    worlds.push(...w);
    servers.push(...s);
  }
  worlds.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));

  // Anything with a real timestamp sorts by it; entries Minecraft never
  // timestamped (servers you've saved but that aren't in the logs) trail
  // behind rather than being given a made-up date.
  const merged = [...worlds, ...servers].sort((a, b) => {
    if (a.lastPlayed && b.lastPlayed) return b.lastPlayed - a.lastPlayed;
    if (a.lastPlayed) return -1;
    if (b.lastPlayed) return 1;
    return a.name.localeCompare(b.name);
  });

  const totalPlayTimeTicks = worlds.reduce((sum, w) => sum + (w.playTimeTicks || 0), 0);
  const sortedServers = [...servers].sort((a, b) => {
    if (a.lastPlayed && b.lastPlayed) return b.lastPlayed - a.lastPlayed;
    if (a.lastPlayed) return -1;
    if (b.lastPlayed) return 1;
    return a.name.localeCompare(b.name);
  });
  return {
    recent: merged.slice(0, limit),
    // The full lists, separate from the capped "recent" one: pages that list
    // everything (Instance's worlds, Library's servers) shouldn't be limited
    // to whatever made the top-5 "recent" cut.
    worlds,
    servers: sortedServers,
    worldCount: worlds.length,
    serverCount: servers.length,
    totalPlayTimeTicks,
    totalPlayTimeSeconds: Math.round(totalPlayTimeTicks / TICKS_PER_SECOND),
  };
}

/**
 * Adds a server to an instance's multiplayer list (servers.dat), unless one
 * with the same address is already there. Returns { added }.
 */
async function addServer(gameDir, { name, address }) {
  const addr = String(address || "").trim();
  if (!/^[A-Za-z0-9.\-_:[\]]{1,255}$/.test(addr)) throw new Error("That server address doesn't look right.");
  let existing = [];
  try {
    const root = nbt.parse(await fsp.readFile(serversFile(gameDir)));
    existing = Array.isArray(root.servers) ? root.servers : [];
  } catch {
    // no list yet
  }
  if (existing.some((s) => s && String(s.ip).toLowerCase() === addr.toLowerCase())) return { added: false };
  // Keep only fields servers.dat actually stores; nbt.writeServersDat types them.
  const clean = existing
    .filter((s) => s && typeof s.ip === "string")
    .map((s) => {
      const out = {};
      for (const [k, v] of Object.entries(s)) {
        if (typeof v === "string" || (typeof v === "number" && Number.isInteger(v))) out[k] = v;
      }
      return out;
    });
  // No acceptTextures: absent means "ask me", which is what a fresh add should do.
  clean.push({ name: String(name || addr).slice(0, 64), ip: addr });
  await fsp.mkdir(gameDir, { recursive: true });
  const file = serversFile(gameDir);
  const tmp = file + ".reminth.tmp";
  await fsp.writeFile(tmp, nbt.writeServersDat(clean));
  await fsp.rename(tmp, file);
  return { added: true };
}

module.exports = { listWorlds, listServers, playerStats, recentActivity, addServer, TICKS_PER_SECOND };
