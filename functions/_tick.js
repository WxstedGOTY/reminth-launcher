// The Reminth bot's every-minute check (a tiny Cloudflare Worker, workers/cron, calls POST /api/discord/tick).
// The bot only answers commands, so anything that has to notice what happens in the server runs here:
//   1. Mod log + anti-raid: reads the server's audit log, posts every moderation action to the mod log channel, and
//      takes all staff roles away from anyone (except the owner) who in 5 minutes bans/kicks 3+ people, deletes 2+
//      channels or roles, or deletes 15+ messages of other people.
//   2. New accounts: members whose Discord account is less than 1 day old get a 24 hour timeout (needs the
//      "Server Members Intent" switch in the Discord developer portal).
//   3. Releases: a new GitHub release of Reminth is posted in the updates channel, pinging the Launcher Updates role.
//   4. YouTube: a new video on the configured channel is posted in the socials channel, pinging the YouTube role.
// Anyone may call the address; it does its work at most once every 45 seconds.
import { dapi, getConfig, setConfig } from "./_bot.js";

const GITHUB_REPO = "WxstedGOTY/reminth-launcher";
const SITE = "https://reminth.pages.dev";
const WINDOW_MS = 5 * 60 * 1000;
export const LIMITS = { banKick: 3, chanRole: 2, messages: 15 };
const STAFF_ROLE_NAMES = ["Co-Owner", "Admin", "Moderator", "Helper"];

const DISCORD_EPOCH = 1420070400000n;
const snowflakeTime = (id) => Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
const snowflakeAt = (ms) => String((BigInt(Math.floor(ms)) - DISCORD_EPOCH) << 22n);

export async function tick(env, { force = false } = {}) {
  if (!env.DB || !env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID) return { skipped: "the bot isn't set up" };
  const last = Number((await getConfig(env, "tick:last")) || 0);
  if (!force && Date.now() - last < 45000) return { skipped: "too soon" };
  await setConfig(env, "tick:last", String(Date.now()));
  const out = {};
  for (const [name, fn] of [["audit", auditLog], ["newAccounts", newAccounts], ["release", release], ["youtube", youtube]]) {
    try {
      out[name] = await fn(env);
    } catch (e) {
      out[name] = { error: String((e && e.message) || e).slice(0, 200) };
    }
  }
  return out;
}

async function modLog(env, embeds, content, users = []) {
  const ch = await getConfig(env, "modlog_channel");
  if (!ch || (!embeds.length && !content)) return;
  for (let i = 0; i < Math.max(1, embeds.length); i += 10) {
    await dapi(env, "POST", `/channels/${ch}/messages`, { content: i === 0 ? content : undefined, embeds: embeds.slice(i, i + 10), allowed_mentions: { users } });
  }
}

// ---------- 1. mod log + anti-raid ----------
const ACTIONS = {
  1: ["⚙️", "changed the server settings"],
  10: ["➕", "made a channel"],
  12: ["🗑️", "deleted a channel"],
  20: ["👢", "kicked"],
  21: ["🧹", "pruned members"],
  22: ["🔨", "banned"],
  23: ["🕊️", "unbanned"],
  24: ["✏️", "changed a member"],
  25: ["🎭", "changed the roles of"],
  30: ["➕", "made a role"],
  31: ["✏️", "changed a role"],
  32: ["🗑️", "deleted a role"],
  50: ["🔗", "made a webhook"],
  52: ["🗑️", "deleted a webhook"],
  72: ["🗑️", "deleted messages of"],
  73: ["🧹", "bulk-deleted messages"],
};

function describe(e) {
  const [icon, verb] = ACTIONS[e.action_type];
  const target = e.target_id && [20, 22, 23, 24, 25, 72].includes(e.action_type) ? ` <@${e.target_id}>` : "";
  let extra = "";
  if (e.action_type === 24) {
    const to = (e.changes || []).find((c) => c.key === "communication_disabled_until");
    if (to) extra = to.new_value ? ` - timed out until <t:${Math.floor(Date.parse(to.new_value) / 1000)}:f>` : " - timeout ended";
    else return null; // nickname changes and the like aren't moderation
  }
  if (e.action_type === 25) {
    const add = (e.changes || []).find((c) => c.key === "$add");
    const rem = (e.changes || []).find((c) => c.key === "$remove");
    extra = [add && ` +${add.new_value.map((r) => r.name).join(", +")}`, rem && ` -${rem.new_value.map((r) => r.name).join(", -")}`].filter(Boolean).join("");
  }
  if ([72, 73].includes(e.action_type) && e.options) extra = ` (${e.options.count} message${e.options.count === "1" ? "" : "s"}${e.options.channel_id ? ` in <#${e.options.channel_id}>` : ""})`;
  if ([10, 12].includes(e.action_type)) {
    const n = (e.changes || []).find((c) => c.key === "name");
    if (n) extra = ` #${n.new_value || n.old_value}`;
  }
  if ([30, 31, 32].includes(e.action_type)) {
    const n = (e.changes || []).find((c) => c.key === "name");
    if (n) extra = ` @${n.new_value || n.old_value}`;
  }
  return `${icon} <@${e.user_id}> ${verb}${target}${extra}${e.reason ? ` - "${String(e.reason).slice(0, 200)}"` : ""} <t:${Math.floor(snowflakeTime(e.id) / 1000)}:R>`;
}

async function auditLog(env) {
  const g = String(env.DISCORD_GUILD_ID);
  const after = await getConfig(env, "tick:audit_after");
  const r = await dapi(env, "GET", `/guilds/${g}/audit-logs?limit=100${after ? `&after=${after}` : ""}`);
  if (r.status === 404) {
    // which servers is the bot really in? (ids only - to tell a wrong server id from a bot that isn't in the server)
    const mine = await dapi(env, "GET", "/users/@me/guilds");
    const ids = mine.ok ? (mine.data || []).map((x) => x.id) : [];
    return { error: "audit log: 404 - the bot isn't in that server", serverIdSet: g, serverIdLooksRight: /^\d{17,20}$/.test(g), botIsInServers: ids };
  }
  if (!r.ok) return { error: `audit log: ${r.status}` };
  const entries = ((r.data && r.data.audit_log_entries) || []).slice().sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  if (!after) {
    // the first run: old history isn't posted, everything from now on is
    await setConfig(env, "tick:audit_after", entries.length ? entries[entries.length - 1].id : snowflakeAt(Date.now()));
    return { new: 0, note: "started - from now on every action is logged" };
  }
  if (!entries.length) return { new: 0 };
  await setConfig(env, "tick:audit_after", entries[entries.length - 1].id);

  const botId = String(env.DISCORD_CLIENT_ID);
  const lines = [];
  // recent counts per person (kept between runs)
  let recent = {};
  try {
    recent = JSON.parse((await getConfig(env, "tick:raid")) || "{}");
  } catch {
    recent = {};
  }
  const now = Date.now();
  for (const e of entries) {
    if (!e.user_id || e.user_id === botId || !ACTIONS[e.action_type]) continue;
    const line = describe(e);
    if (line) lines.push(line);
    const kind = [20, 21, 22].includes(e.action_type) ? "banKick" : [12, 32].includes(e.action_type) ? "chanRole" : [72, 73].includes(e.action_type) ? "messages" : null;
    if (!kind) continue;
    const n = kind === "messages" ? Number((e.options && e.options.count) || 1) : 1;
    (recent[e.user_id] = recent[e.user_id] || []).push({ t: snowflakeTime(e.id), k: kind, n });
  }
  for (const id of Object.keys(recent)) {
    recent[id] = recent[id].filter((x) => now - x.t < WINDOW_MS);
    if (!recent[id].length) delete recent[id];
  }

  // anyone over a limit loses their staff roles
  const demoted = [];
  const guild = await dapi(env, "GET", `/guilds/${g}`);
  const ownerId = guild.ok && guild.data ? guild.data.owner_id : null;
  for (const [id, list] of Object.entries(recent)) {
    const sum = (k) => list.filter((x) => x.k === k).reduce((a, x) => a + x.n, 0);
    const over = Object.keys(LIMITS).find((k) => sum(k) >= LIMITS[k]);
    if (!over || id === ownerId || id === botId) continue;
    const staffIds = new Set((guild.data.roles || []).filter((x) => STAFF_ROLE_NAMES.includes(x.name)).map((x) => x.id));
    const m = await dapi(env, "GET", `/guilds/${g}/members/${id}`);
    if (!m.ok) continue;
    const keep = (m.data.roles || []).filter((x) => !staffIds.has(x));
    if (keep.length === (m.data.roles || []).length) continue; // no staff role (left already, or not staff)
    const why = over === "banKick" ? `${sum("banKick")} bans/kicks` : over === "chanRole" ? `${sum("chanRole")} deleted channels/roles` : `${sum("messages")} deleted messages`;
    const res = await dapi(env, "PATCH", `/guilds/${g}/members/${id}`, { roles: keep }, `Anti-raid: ${why} in 5 minutes`);
    demoted.push({ id, why, ok: res.ok });
    delete recent[id];
  }
  await setConfig(env, "tick:raid", JSON.stringify(recent));

  const embeds = [];
  for (let i = 0; i < lines.length; i += 15) embeds.push({ title: i === 0 ? "Mod log" : undefined, color: 0x5865f2, description: lines.slice(i, i + 15).join("\n") });
  for (const d of demoted)
    embeds.unshift({ title: "🚨 Anti-raid", color: 0xff3b3b, description: d.ok ? `<@${d.id}> lost all staff roles: ${d.why} in 5 minutes.` : `<@${d.id}> went over the limit (${d.why}) but I couldn't take their roles - is my role above theirs?` });
  await modLog(env, embeds, demoted.length && ownerId ? `<@${ownerId}>` : undefined, demoted.length && ownerId ? [ownerId] : []);
  return { new: entries.length, logged: lines.length, demoted: demoted.length };
}

// ---------- 2. new accounts ----------
async function newAccounts(env) {
  const g = String(env.DISCORD_GUILD_ID);
  // members are listed by user id, and a user id says when the account was made: everything after this id is < 1 day old
  const r = await dapi(env, "GET", `/guilds/${g}/members?limit=1000&after=${snowflakeAt(Date.now() - 86400000)}`);
  if (r.status === 403 || r.status === 400) return { error: "turn on Server Members Intent (developer portal -> Bot)" };
  if (!r.ok) return { error: `members: ${r.status}` };
  let done = [];
  try {
    done = JSON.parse((await getConfig(env, "tick:newacc")) || "[]");
  } catch {
    done = [];
  }
  const lines = [];
  for (const m of r.data || []) {
    const id = m.user && m.user.id;
    if (!id || m.user.bot || done.includes(id)) continue;
    if (m.communication_disabled_until && Date.parse(m.communication_disabled_until) > Date.now()) {
      done.push(id);
      continue;
    }
    const until = new Date(Date.now() + 86400000).toISOString();
    const res = await dapi(env, "PATCH", `/guilds/${g}/members/${id}`, { communication_disabled_until: until }, "New account (less than 1 day old): 24 hour timeout");
    done.push(id);
    lines.push(res.ok ? `⏳ <@${id}> - account made <t:${Math.floor(snowflakeTime(id) / 1000)}:R>, timed out for 24 hours` : `⚠️ <@${id}> - new account, but I couldn't time them out (${res.status})`);
  }
  await setConfig(env, "tick:newacc", JSON.stringify(done.slice(-500)));
  if (lines.length) await modLog(env, [{ title: "New accounts", color: 0xfbbf24, description: lines.join("\n") }]);
  return { timedOut: lines.length };
}

// ---------- 3. GitHub releases ----------
async function release(env) {
  const ch = await getConfig(env, "updates_channel");
  if (!ch) return { skipped: "no updates channel" };
  const r = await fetch(`${env.GITHUB_API || "https://api.github.com"}/repos/${GITHUB_REPO}/releases/latest`, { headers: { "user-agent": "ReminthBot", accept: "application/vnd.github+json" } });
  if (!r.ok) return { error: `github: ${r.status}` };
  const rel = await r.json();
  const tag = String(rel.tag_name || "");
  const seen = await getConfig(env, "tick:release");
  if (!tag || tag === seen) return { tag };
  await setConfig(env, "tick:release", tag);
  if (!seen) return { tag, note: "started - the next release gets posted" };
  const role = await getConfig(env, "updates_role");
  const notes = String(rel.body || "").replace(/\r\n/g, "\n").replace(/^\s*#*\s*Reminth\s+v?[\d.]+\s*\n+/i, "").trim().slice(0, 3500);
  const res = await dapi(env, "POST", `/channels/${ch}/messages`, {
    content: role ? `<@&${role}>` : undefined,
    embeds: [{ title: `Reminth ${tag} is out`, url: SITE, color: 0xff4a1c, description: `${notes}\n\n**Download:** ${SITE}\nAlready have Reminth? It updates by itself.`, timestamp: rel.published_at || undefined }],
    allowed_mentions: { roles: role ? [role] : [] },
  });
  return { tag, posted: res.ok };
}

// ---------- 4. YouTube ----------
async function youtube(env) {
  const channelId = await getConfig(env, "youtube_channel");
  const ch = await getConfig(env, "socials_channel");
  if (!channelId || !ch) return { skipped: "no YouTube channel set" };
  const r = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, { headers: { "user-agent": "ReminthBot" } });
  if (!r.ok) return { error: `youtube: ${r.status}` };
  const xml = await r.text();
  const id = (/<yt:videoId>([\w-]{6,20})<\/yt:videoId>/.exec(xml) || [])[1];
  const title = ((/<entry>[\s\S]*?<title>([^<]*)<\/title>/.exec(xml) || [])[1] || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  if (!id) return { videos: 0 };
  const seen = await getConfig(env, "tick:youtube");
  if (id === seen) return { latest: id };
  await setConfig(env, "tick:youtube", id);
  if (!seen) return { latest: id, note: "started" };
  const role = await getConfig(env, "youtube_role");
  const res = await dapi(env, "POST", `/channels/${ch}/messages`, {
    content: `${role ? `<@&${role}> ` : ""}New video: **${title.slice(0, 200)}**\nhttps://www.youtube.com/watch?v=${id}`,
    allowed_mentions: { roles: role ? [role] : [] },
  });
  return { latest: id, posted: res.ok };
}
