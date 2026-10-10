// The Reminth Discord bot - slash commands answered by the website (Discord sends each command to
// /api/discord/interactions; nothing runs in between, so it costs nothing and needs no server of its own).
//
// Needs (Cloudflare Pages project "reminth" -> Settings -> Variables), on top of the accounts ones:
//   DISCORD_PUBLIC_KEY   the Discord app's "Public Key" (General Information) - checks every request really is Discord
//   DISCORD_BOT_TOKEN    the app's bot token (secret)
//   DISCORD_GUILD_ID     the Reminth server's id
//   ADMIN_DISCORD_ID     the owner's Discord user id (/pull, /stats, the website's Owner tools)
// Channels and the Player role are picked inside Discord with /config (kept in the database).
// Tests only: DISCORD_API (a stand-in for https://discord.com/api), GITHUB_API.
import { accountView, db, identitiesOf, isAdmin, now } from "./_lib.js";
import { pullBatch, pullSetup } from "./_pull.js";

export const botApi = (env) => env.DISCORD_API || "https://discord.com/api/v10";
const GITHUB_REPO = "WxstedGOTY/reminth-launcher";
const SITE = "https://reminth.pages.dev";
const COLOR = 0xff4a1c;
const GREEN = 0x34d399;
const RED = 0xff5c8a;

// Discord permission bits (as strings for the command definitions, BigInt for checks)
const P = { KICK: 1n << 1n, BAN: 1n << 2n, ADMIN: 1n << 3n, MANAGE_GUILD: 1n << 5n, MANAGE_MESSAGES: 1n << 13n, MODERATE: 1n << 40n };

// ---------- talking to Discord ----------

/** A Discord REST call as the bot. Returns { status, data }. reason goes into the server's audit log. */
export async function dapi(env, method, path, body, reason) {
  const headers = { authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "user-agent": "ReminthBot (https://reminth.pages.dev, 1)" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (reason) headers["x-audit-log-reason"] = encodeURIComponent(String(reason).slice(0, 400));
  const r = await fetch(botApi(env) + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null;
  try {
    data = r.status === 204 ? null : await r.json();
  } catch {
    data = null;
  }
  return { status: r.status, ok: r.ok, data };
}

/** Checks that a request really comes from Discord (Ed25519 over timestamp + body). */
export async function verifyDiscordRequest(publicKeyHex, signatureHex, timestamp, body) {
  if (!/^[a-f0-9]{64}$/i.test(publicKeyHex || "") || !/^[a-f0-9]{128}$/i.test(signatureHex || "") || !/^\d{1,20}$/.test(timestamp || "")) return false;
  const bytes = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));
  try {
    const key = await crypto.subtle.importKey("raw", bytes(publicKeyHex), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, bytes(signatureHex), new TextEncoder().encode(timestamp + body));
  } catch {
    return false;
  }
}

// ---------- answers ----------
const EPHEMERAL = 64;
const say = (content, ephemeral = true) => ({ type: 4, data: { content, flags: ephemeral ? EPHEMERAL : 0, allowed_mentions: { parse: [] } } });
const sayEmbed = (embed, ephemeral = true) => ({ type: 4, data: { embeds: [embed], flags: ephemeral ? EPHEMERAL : 0, allowed_mentions: { parse: [] } } });
const DEFER = { type: 5, data: { flags: EPHEMERAL } };

/** Finishes a deferred answer ("Reminth is thinking..."). */
async function followUp(env, i, data) {
  await fetch(`${botApi(env)}/webhooks/${env.DISCORD_CLIENT_ID}/${i.token}/messages/@original`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ allowed_mentions: { parse: [] }, ...data }),
  }).catch(() => {});
}

// ---------- settings kept in the database (/config) ----------
export async function getConfig(env, key) {
  const row = await (await db(env)).prepare("SELECT value FROM bot_config WHERE key = ?").bind(key).first();
  return row ? row.value : null;
}
export async function setConfig(env, key, value) {
  await (await db(env)).prepare("INSERT OR REPLACE INTO bot_config (key, value) VALUES (?, ?)").bind(key, value).run();
}

async function modLog(env, embed) {
  const ch = await getConfig(env, "modlog_channel");
  if (ch) await dapi(env, "POST", `/channels/${ch}/messages`, { embeds: [{ timestamp: new Date().toISOString(), ...embed }], allowed_mentions: { parse: [] } });
}

/** Tells someone privately why (best effort - many people block DMs from servers). */
async function dm(env, userId, text) {
  const ch = await dapi(env, "POST", "/users/@me/channels", { recipient_id: userId });
  if (!ch.ok || !ch.data || !ch.data.id) return false;
  return (await dapi(env, "POST", `/channels/${ch.data.id}/messages`, { content: text, allowed_mentions: { parse: [] } })).ok;
}

// ---------- helpers for commands ----------
const opt = (i, name) => {
  const all = (i.data && i.data.options) || [];
  const flat = all.length && all[0].options && (all[0].type === 1 || all[0].type === 2) ? all[0].options : all;
  const o = (flat || []).find((x) => x.name === name);
  return o ? o.value : undefined;
};
const sub = (i) => {
  const o = (i.data && i.data.options) || [];
  return o.length && o[0].type === 1 ? o[0].name : null;
};
const invoker = (i) => (i.member && i.member.user) || i.user || {};
const perms = (i) => {
  try {
    return BigInt((i.member && i.member.permissions) || "0");
  } catch {
    return 0n;
  }
};
const has = (i, bit) => (perms(i) & P.ADMIN) === P.ADMIN || (perms(i) & bit) === bit;
const tag = (u) => (u ? `${u.global_name || u.username} (${u.id})` : "someone");
const userOf = (i, id) => (i.data.resolved && i.data.resolved.users && i.data.resolved.users[id]) || { id, username: id };
const clip = (s, n) => (String(s || "").length > n ? String(s).slice(0, n - 1) + "…" : String(s || ""));

/** Can the person running the command act on this member? null = yes, else the reason why not. */
async function canActOn(env, i, targetId) {
  const me = invoker(i);
  if (targetId === me.id) return "You can't do that to yourself.";
  if (targetId === env.DISCORD_CLIENT_ID) return "Nice try. 🙂";
  const g = await dapi(env, "GET", `/guilds/${i.guild_id}`);
  if (!g.ok || !g.data) return "Couldn't read the server right now - try again.";
  if (targetId === g.data.owner_id) return "You can't do that to the server owner.";
  if (me.id === g.data.owner_id) return null;
  const pos = {};
  for (const r of g.data.roles || []) pos[r.id] = r.position;
  const top = (roles) => Math.max(0, ...(roles || []).map((r) => pos[r] || 0));
  const target = i.data.resolved && i.data.resolved.members && i.data.resolved.members[targetId];
  if (target && top(target.roles) >= top(i.member.roles)) return "They have the same or a higher role than you.";
  return null;
}

const DURATIONS = { "60s": 60, "5m": 300, "10m": 600, "1h": 3600, "1d": 86400, "1w": 604800 };
const DURATION_NAMES = { "60s": "60 seconds", "5m": "5 minutes", "10m": "10 minutes", "1h": "1 hour", "1d": "1 day", "1w": "1 week" };

// ---------- the commands ----------
const u = (name, description, required = true) => ({ type: 6, name, description, required });
const s = (name, description, required = false, extra = {}) => ({ type: 3, name, description, required, ...extra });
const reasonOpt = s("reason", "Why (shown in the mod log and sent to them)", false, { max_length: 400 });
const durationChoices = Object.keys(DURATIONS).map((k) => ({ name: DURATION_NAMES[k], value: k }));
const HELP_TOPICS = {
  signin: {
    title: "Signing in with Microsoft",
    text: "Reminth shows a short code and opens **microsoft.com/link**. Enter the code there and sign in with the Microsoft account that owns Minecraft: Java Edition. Your password only ever goes to Microsoft. If the code runs out, press **Get a new code**.",
  },
  account: {
    title: "Your Reminth account",
    text: `Reminth asks for a Reminth account the first time you open it - Discord or email. The same account works on the website: ${SITE}/account (sign out, connect another way, delete it). Signed in with Discord? Use **/verify** here for the Reminth Player role.`,
  },
  mods: {
    title: "Mods that won't load",
    text: "Reminth checks your mods before the game starts, tells you which ones won't load and why, and can fix them in one click. It can also work out which Minecraft version fits all your mods. Still stuck? Use **/bug** and say which mods.",
  },
  performance: {
    title: "Performance mods",
    text: "On Fabric and Quilt instances Reminth adds Sodium, Lithium, FerriteCore, ImmediatelyFast, Entity Culling and ScalableLux for you (plus Fabric API), stable builds from Modrinth only. It leaves out any that clash with your mods, and you can switch the pack off per instance.",
  },
  panel: {
    title: "The Reminth Mods Panel",
    text: "Press **G** in Minecraft (1.20.1 to 26.3) for about 145 of Reminth's own features - FPS, keystrokes, armor status, potion timers, zoom, hit markers, chat timestamps, a combo counter and more - with profiles and a HUD layout editor.",
  },
  install: {
    title: "Installing Reminth",
    text: `Download it from ${SITE} (Windows 10/11, needs Minecraft: Java Edition), run the installer, sign in and press Play. Reminth sets up Minecraft, Fabric and Java by itself. Updates install themselves.`,
  },
};

export const COMMANDS = [
  { name: "ban", description: "Ban someone from the server", default_member_permissions: String(P.BAN), dm_permission: false,
    options: [u("user", "Who"), reasonOpt, { type: 4, name: "delete_messages", description: "Also delete their messages from the last...", required: false,
      choices: [{ name: "Nothing", value: 0 }, { name: "1 hour", value: 3600 }, { name: "1 day", value: 86400 }, { name: "7 days", value: 604800 }] }] },
  { name: "unban", description: "Take a ban back", default_member_permissions: String(P.BAN), dm_permission: false, options: [u("user", "Who (paste their user id)"), reasonOpt] },
  { name: "kick", description: "Kick someone (they can join again with an invite)", default_member_permissions: String(P.KICK), dm_permission: false, options: [u("user", "Who"), reasonOpt] },
  { name: "timeout", description: "Mute someone for a while", default_member_permissions: String(P.MODERATE), dm_permission: false,
    options: [u("user", "Who"), s("duration", "How long", true, { choices: durationChoices }), reasonOpt] },
  { name: "untimeout", description: "End someone's timeout", default_member_permissions: String(P.MODERATE), dm_permission: false, options: [u("user", "Who")] },
  { name: "warn", description: "Give someone a warning (saved, and sent to them)", default_member_permissions: String(P.MODERATE), dm_permission: false,
    options: [u("user", "Who"), s("reason", "Why", true, { max_length: 400 })] },
  { name: "warnings", description: "See (or clear) someone's warnings", default_member_permissions: String(P.MODERATE), dm_permission: false,
    options: [u("user", "Who"), { type: 5, name: "clear", description: "Delete all their warnings", required: false }] },
  { name: "purge", description: "Delete recent messages in this channel", default_member_permissions: String(P.MANAGE_MESSAGES), dm_permission: false,
    options: [{ type: 4, name: "amount", description: "How many (1-100)", required: true, min_value: 1, max_value: 100 }, u("user", "Only this person's messages", false)] },
  { name: "automod", description: "Discord's automatic moderation for this server", default_member_permissions: String(P.MANAGE_GUILD), dm_permission: false,
    options: [
      { type: 1, name: "setup", description: "Turn on: spam, mass pings (10 min timeout), invite links, slurs", options: [{ type: 5, name: "swearing", description: "Also block swear words", required: false }] },
      { type: 1, name: "status", description: "Show what's on" },
      { type: 1, name: "off", description: "Turn Reminth's rules off" },
    ] },
  { name: "config", description: "Set the bot up", default_member_permissions: String(P.MANAGE_GUILD), dm_permission: false,
    options: [
      { type: 1, name: "modlog", description: "Where the mod log goes", options: [{ type: 7, name: "channel", description: "Channel", required: true, channel_types: [0] }] },
      { type: 1, name: "bugs", description: "Where /bug reports go", options: [{ type: 7, name: "channel", description: "Channel", required: true, channel_types: [0, 15] }] },
      { type: 1, name: "player-role", description: "The role for people with a Reminth account", options: [{ type: 8, name: "role", description: "Role", required: true }] },
      { type: 1, name: "show", description: "Show the bot's settings" },
    ] },
  { name: "download", description: "Get Reminth" },
  { name: "changelog", description: "What's new in the latest Reminth" },
  { name: "help", description: "Answers to common questions", options: [s("topic", "What about", true, { choices: Object.keys(HELP_TOPICS).map((k) => ({ name: HELP_TOPICS[k].title, value: k })) })] },
  { name: "bug", description: "Report a bug in Reminth" },
  { name: "account", description: "Your Reminth account (only you see this)" },
  { name: "verify", description: "Get the Reminth Player role (needs a Reminth account with this Discord)" },
  { name: "pull", description: "Owner: add everyone who signed in to Reminth with Discord", default_member_permissions: String(P.ADMIN), dm_permission: false },
  { name: "stats", description: "Owner: Reminth account numbers", default_member_permissions: String(P.ADMIN), dm_permission: false },
];

/** Turns on (or updates) Reminth's AutoMod rules. `existing`: the server's current rules. Used by /automod and the server builder. */
export async function setupAutomod(env, g, swearing, by, existing) {
  const log = await getConfig(env, "modlog_channel");
  const ours = existing.filter((r) => String(r.name).startsWith("Reminth: "));
  const alert = log ? [{ type: 2, metadata: { channel_id: log } }] : [];
  const block = (msg) => ({ type: 1, metadata: { custom_message: msg } });
  const rules = [
    { name: "Reminth: spam", event_type: 1, trigger_type: 3, actions: [block("That looked like spam, so it was blocked."), ...alert] },
    { name: "Reminth: mass pings", event_type: 1, trigger_type: 5, trigger_metadata: { mention_total_limit: 5, mention_raid_protection_enabled: true },
      actions: [block("Too many pings in one message."), { type: 3, metadata: { duration_seconds: 600 } }, ...alert] },
    { name: "Reminth: invite links", event_type: 1, trigger_type: 1,
      trigger_metadata: { regex_patterns: ["(?:discord\\.gg|discord(?:app)?\\.com/invite)/[a-z0-9-]+"] },
      actions: [block("Invite links to other servers aren't allowed here."), ...alert] },
    { name: "Reminth: bad words", event_type: 1, trigger_type: 4, trigger_metadata: { presets: swearing ? [1, 2, 3] : [2, 3] },
      actions: [block("That message was blocked by the server's filter."), ...alert] },
  ];
  const done = [];
  const problems = [];
  for (const rule of rules) {
    const have = ours.find((r) => r.name === rule.name) || ([3, 4, 5].includes(rule.trigger_type) && existing.find((r) => r.trigger_type === rule.trigger_type));
    const r = have
      ? await dapi(env, "PATCH", `/guilds/${g}/auto-moderation/rules/${have.id}`, { name: rule.name, actions: rule.actions, enabled: true, ...(rule.trigger_metadata ? { trigger_metadata: rule.trigger_metadata } : {}) }, `automod setup by ${by}`)
      : await dapi(env, "POST", `/guilds/${g}/auto-moderation/rules`, { ...rule, enabled: true }, `automod setup by ${by}`);
    if (r.ok) done.push(rule.name.slice(9));
    else problems.push(`${rule.name.slice(9)}: ${(r.data && r.data.message) || r.status}`);
  }
  return { done, problems, log };
}

const HANDLERS = {
  async ban(env, i) {
    if (!has(i, P.BAN)) return say("You need the Ban Members permission.");
    const id = opt(i, "user");
    const why = await canActOn(env, i, id);
    if (why) return say(why);
    const reason = opt(i, "reason") || "No reason given";
    const target = userOf(i, id);
    await dm(env, id, `You were banned from the Reminth Discord server. Reason: ${reason}`);
    const r = await dapi(env, "PUT", `/guilds/${i.guild_id}/bans/${id}`, { delete_message_seconds: Number(opt(i, "delete_messages") || 0) }, `${tag(invoker(i))}: ${reason}`);
    if (!r.ok) return say(botError(r, "ban"));
    await modLog(env, { title: "Banned", color: RED, fields: [{ name: "Who", value: tag(target) }, { name: "By", value: tag(invoker(i)) }, { name: "Reason", value: clip(reason, 1000) }] });
    return say(`Banned **${clip(target.global_name || target.username, 64)}**.`);
  },
  async unban(env, i) {
    if (!has(i, P.BAN)) return say("You need the Ban Members permission.");
    const id = opt(i, "user");
    const reason = opt(i, "reason") || "No reason given";
    const r = await dapi(env, "DELETE", `/guilds/${i.guild_id}/bans/${id}`, undefined, `${tag(invoker(i))}: ${reason}`);
    if (r.status === 404) return say("They aren't banned.");
    if (!r.ok) return say(botError(r, "unban"));
    await modLog(env, { title: "Unbanned", color: GREEN, fields: [{ name: "Who", value: tag(userOf(i, id)) }, { name: "By", value: tag(invoker(i)) }, { name: "Reason", value: clip(reason, 1000) }] });
    return say("Unbanned.");
  },
  async kick(env, i) {
    if (!has(i, P.KICK)) return say("You need the Kick Members permission.");
    const id = opt(i, "user");
    if (!(i.data.resolved && i.data.resolved.members && i.data.resolved.members[id])) return say("They aren't in the server.");
    const why = await canActOn(env, i, id);
    if (why) return say(why);
    const reason = opt(i, "reason") || "No reason given";
    await dm(env, id, `You were kicked from the Reminth Discord server. Reason: ${reason}`);
    const r = await dapi(env, "DELETE", `/guilds/${i.guild_id}/members/${id}`, undefined, `${tag(invoker(i))}: ${reason}`);
    if (!r.ok) return say(botError(r, "kick"));
    await modLog(env, { title: "Kicked", color: RED, fields: [{ name: "Who", value: tag(userOf(i, id)) }, { name: "By", value: tag(invoker(i)) }, { name: "Reason", value: clip(reason, 1000) }] });
    return say("Kicked.");
  },
  async timeout(env, i) {
    if (!has(i, P.MODERATE)) return say("You need the Timeout Members permission.");
    const id = opt(i, "user");
    if (!(i.data.resolved && i.data.resolved.members && i.data.resolved.members[id])) return say("They aren't in the server.");
    const why = await canActOn(env, i, id);
    if (why) return say(why);
    const d = opt(i, "duration");
    const secs = DURATIONS[d];
    if (!secs) return say("Pick a duration from the list.");
    const reason = opt(i, "reason") || "No reason given";
    const until = new Date(Date.now() + secs * 1000).toISOString();
    const r = await dapi(env, "PATCH", `/guilds/${i.guild_id}/members/${id}`, { communication_disabled_until: until }, `${tag(invoker(i))}: ${reason}`);
    if (!r.ok) return say(botError(r, "time out"));
    await dm(env, id, `You were timed out in the Reminth Discord server for ${DURATION_NAMES[d]}. Reason: ${reason}`);
    await modLog(env, { title: `Timed out (${DURATION_NAMES[d]})`, color: RED, fields: [{ name: "Who", value: tag(userOf(i, id)) }, { name: "By", value: tag(invoker(i)) }, { name: "Reason", value: clip(reason, 1000) }] });
    return say(`Timed out for ${DURATION_NAMES[d]}.`);
  },
  async untimeout(env, i) {
    if (!has(i, P.MODERATE)) return say("You need the Timeout Members permission.");
    const id = opt(i, "user");
    const r = await dapi(env, "PATCH", `/guilds/${i.guild_id}/members/${id}`, { communication_disabled_until: null }, `${tag(invoker(i))}: timeout ended`);
    if (!r.ok) return say(botError(r, "end the timeout"));
    await modLog(env, { title: "Timeout ended", color: GREEN, fields: [{ name: "Who", value: tag(userOf(i, id)) }, { name: "By", value: tag(invoker(i)) }] });
    return say("Timeout ended.");
  },
  async warn(env, i) {
    if (!has(i, P.MODERATE)) return say("You need the Timeout Members permission.");
    const id = opt(i, "user");
    const why = await canActOn(env, i, id);
    if (why) return say(why);
    const reason = clip(opt(i, "reason"), 400);
    const DB = await db(env);
    await DB.prepare("INSERT INTO warnings (user_id, mod_id, reason, created_at) VALUES (?, ?, ?, ?)").bind(id, invoker(i).id, reason, now()).run();
    const n = ((await DB.prepare("SELECT COUNT(*) AS n FROM warnings WHERE user_id = ?").bind(id).first()) || {}).n || 1;
    const told = await dm(env, id, `You got a warning in the Reminth Discord server: ${reason}`);
    await modLog(env, { title: `Warning #${n}`, color: 0xfbbf24, fields: [{ name: "Who", value: tag(userOf(i, id)) }, { name: "By", value: tag(invoker(i)) }, { name: "Reason", value: reason }] });
    return say(`Warned. That's warning #${n} for them.${told ? "" : " (Their DMs are closed, so they weren't told.)"}`);
  },
  async warnings(env, i) {
    if (!has(i, P.MODERATE)) return say("You need the Timeout Members permission.");
    const id = opt(i, "user");
    const DB = await db(env);
    if (opt(i, "clear")) {
      await DB.prepare("DELETE FROM warnings WHERE user_id = ?").bind(id).run();
      await modLog(env, { title: "Warnings cleared", color: GREEN, fields: [{ name: "Who", value: tag(userOf(i, id)) }, { name: "By", value: tag(invoker(i)) }] });
      return say("Their warnings are cleared.");
    }
    const rows = (await DB.prepare("SELECT * FROM warnings WHERE user_id = ? ORDER BY created_at DESC LIMIT 15").bind(id).all()).results || [];
    if (!rows.length) return say("No warnings.");
    return sayEmbed({ title: `Warnings - ${clip(tag(userOf(i, id)), 200)}`, color: 0xfbbf24,
      description: rows.map((w, n) => `**${n + 1}.** <t:${w.created_at}:d> by <@${w.mod_id}>: ${clip(w.reason, 150)}`).join("\n") });
  },
  async purge(env, i, ctx) {
    if (!has(i, P.MANAGE_MESSAGES)) return say("You need the Manage Messages permission.");
    const amount = Math.max(1, Math.min(100, Number(opt(i, "amount")) || 0));
    const only = opt(i, "user");
    ctx.waitUntil(
      (async () => {
        const list = await dapi(env, "GET", `/channels/${i.channel_id}/messages?limit=100`);
        if (!list.ok || !Array.isArray(list.data)) return followUp(env, i, { content: botError(list, "read this channel") });
        const twoWeeks = Date.now() - 14 * 86400 * 1000 + 60000; // Discord only bulk-deletes messages younger than 14 days
        const pick = list.data.filter((m) => (!only || (m.author && m.author.id === only)) && !m.pinned && Date.parse(m.timestamp) > twoWeeks).slice(0, amount);
        let r = { ok: true };
        if (pick.length === 1) r = await dapi(env, "DELETE", `/channels/${i.channel_id}/messages/${pick[0].id}`, undefined, `purge by ${tag(invoker(i))}`);
        else if (pick.length > 1) r = await dapi(env, "POST", `/channels/${i.channel_id}/messages/bulk-delete`, { messages: pick.map((m) => m.id) }, `purge by ${tag(invoker(i))}`);
        if (!r.ok) return followUp(env, i, { content: botError(r, "delete messages") });
        await modLog(env, { title: `Purged ${pick.length} message${pick.length === 1 ? "" : "s"}`, color: RED,
          fields: [{ name: "Channel", value: `<#${i.channel_id}>` }, { name: "By", value: tag(invoker(i)) }, ...(only ? [{ name: "Only from", value: tag(userOf(i, only)) }] : [])] });
        await followUp(env, i, { content: pick.length ? `Deleted ${pick.length} message${pick.length === 1 ? "" : "s"}.` + (pick.length < amount ? " (Messages older than 14 days and pinned ones are skipped.)" : "") : "Nothing to delete (messages older than 14 days and pinned ones are skipped)." });
      })()
    );
    return DEFER;
  },
  async automod(env, i) {
    if (!has(i, P.MANAGE_GUILD)) return say("You need the Manage Server permission.");
    const g = i.guild_id;
    const existing = await dapi(env, "GET", `/guilds/${g}/auto-moderation/rules`);
    if (!existing.ok) return say(botError(existing, "read AutoMod"));
    const ours = (existing.data || []).filter((r) => String(r.name).startsWith("Reminth: "));
    const mode = sub(i);
    if (mode === "status") {
      if (!(existing.data || []).length) return say("AutoMod is off. Turn it on with `/automod setup`.");
      return say((existing.data || []).map((r) => `${r.enabled ? "🟢" : "⚪"} ${r.name}`).join("\n"));
    }
    if (mode === "off") {
      for (const r of ours) await dapi(env, "DELETE", `/guilds/${g}/auto-moderation/rules/${r.id}`, undefined, `automod off by ${tag(invoker(i))}`);
      return say(ours.length ? `Turned off ${ours.length} rule${ours.length === 1 ? "" : "s"}.` : "None of Reminth's rules were on.");
    }
    // setup
    const out = await setupAutomod(env, g, Boolean(opt(i, "swearing")), tag(invoker(i)), existing.data || []);
    return say(
      (out.done.length ? `AutoMod is on: ${out.done.join(", ")}.` : "") +
        (out.problems.length ? `\nCouldn't set: ${out.problems.join("; ")}` : "") +
        (out.log ? "" : "\nTip: `/config modlog` first, then run this again, so blocked messages are reported there.")
    );
  },
  async config(env, i) {
    if (!has(i, P.MANAGE_GUILD)) return say("You need the Manage Server permission.");
    const mode = sub(i);
    if (mode === "modlog") {
      await setConfig(env, "modlog_channel", opt(i, "channel"));
      return say(`Mod log goes to <#${opt(i, "channel")}>. Make sure I can see and post there.`);
    }
    if (mode === "bugs") {
      await setConfig(env, "bugs_channel", opt(i, "channel"));
      return say(`Bug reports go to <#${opt(i, "channel")}>.`);
    }
    if (mode === "player-role") {
      await setConfig(env, "player_role", opt(i, "role"));
      return say(`Reminth players get <@&${opt(i, "role")}>. My own role must be **above** it in Server Settings -> Roles, or I can't give it.`);
    }
    const [m, b, r] = [await getConfig(env, "modlog_channel"), await getConfig(env, "bugs_channel"), await getConfig(env, "player_role")];
    return say(`Mod log: ${m ? `<#${m}>` : "not set"}\nBug reports: ${b ? `<#${b}>` : "not set"}\nPlayer role: ${r ? `<@&${r}>` : "not set"}\nRelease posts: a GitHub webhook (not set here)`);
  },
  async download(env) {
    const rel = await latestRelease(env);
    return sayEmbed({ title: "Get Reminth", url: SITE, color: COLOR,
      description: `Free Minecraft launcher for Windows 10/11 - press G in game for the Reminth Mods Panel, performance mods set up for you, mods checked before you play.\n\n**Download:** ${SITE}${rel ? `\nLatest version: **${rel.tag}**` : ""}\nAlready have it? Reminth updates itself.` }, false);
  },
  async changelog(env) {
    const rel = await latestRelease(env);
    if (!rel) return say(`Couldn't reach GitHub right now. The latest changes are at ${SITE}.`);
    return sayEmbed({ title: `What's new in Reminth ${rel.tag}`, url: rel.url, color: COLOR, description: clip(rel.body.replace(/\r\n/g, "\n").replace(/^\s*#*\s*Reminth\s+v?[\d.]+\s*\n+/i, "").trim(), 3500) || "No notes." }, false);
  },
  async help(env, i) {
    const t = HELP_TOPICS[opt(i, "topic")];
    if (!t) return say("Pick a topic from the list.");
    return sayEmbed({ title: t.title, color: COLOR, description: t.text, footer: { text: "Still stuck? /bug" } });
  },
  async bug() {
    const row = (c) => ({ type: 1, components: [c] });
    return {
      type: 9,
      data: {
        custom_id: "bug",
        title: "Report a bug in Reminth",
        components: [
          row({ type: 4, custom_id: "what", label: "What happened?", style: 2, required: true, max_length: 1000, placeholder: "The game crashes when I open the G panel on 1.21.4" }),
          row({ type: 4, custom_id: "steps", label: "How can we make it happen again?", style: 2, required: false, max_length: 1000 }),
          row({ type: 4, custom_id: "version", label: "Minecraft version and loader (if it's in game)", style: 1, required: false, max_length: 100, placeholder: "1.21.4 Fabric" }),
        ],
      },
    };
  },
  async account(env, i) {
    const me = invoker(i);
    const row = await (await db(env)).prepare("SELECT account_id FROM identities WHERE provider = 'discord' AND subject = ?").bind(String(me.id)).first();
    if (!row) return say(`This Discord isn't linked to a Reminth account yet. Sign in with Discord in Reminth, or at ${SITE}/account.`);
    const a = await accountView(env, row.account_id);
    const names = { discord: "Discord", google: "Google", email: "email" };
    return sayEmbed({ title: a.name, color: COLOR, thumbnail: a.avatarUrl ? { url: a.avatarUrl } : undefined,
      fields: [{ name: "Signs in with", value: a.providers.map((p) => names[p] || p).join(", "), inline: true }, { name: "Member since", value: `<t:${Math.floor(a.createdAt / 1000)}:D>`, inline: true }],
      footer: { text: `Manage it at ${SITE.replace("https://", "")}/account` } });
  },
  async verify(env, i) {
    const me = invoker(i);
    const row = await (await db(env)).prepare("SELECT account_id FROM identities WHERE provider = 'discord' AND subject = ?").bind(String(me.id)).first();
    if (!row) return say(`No Reminth account with this Discord yet. Sign in with Discord in Reminth (or at ${SITE}/account), then run /verify again.`);
    const role = await getConfig(env, "player_role");
    if (!role) return say("You have a Reminth account ✅ (the server hasn't set up the Player role yet).");
    const r = await dapi(env, "PUT", `/guilds/${i.guild_id}/members/${me.id}/roles/${role}`, undefined, "Reminth account verified");
    if (!r.ok) return say(botError(r, "give you the role"));
    return say(`Verified ✅ You have <@&${role}> now.`);
  },
  async pull(env, i, ctx) {
    if (!(await ownerOnly(env, i))) return say("Only the owner can use this.");
    const setup = pullSetup(env);
    if (!setup.bot || !setup.server) return say("The bot token or the server id isn't set in Cloudflare yet.");
    ctx.waitUntil(
      (async () => {
        let after = "", added = 0, already = 0, failed = 0;
        for (let round = 0; round < 6; round++) {
          const b = await pullBatch(env, after);
          added += b.added; already += b.already; failed += b.failed; after = b.next;
          if (b.stop) return followUp(env, i, { content: `Stopped: check the bot's permissions (Create Invite, Manage Roles). ${b.problems.join(" / ")}` });
          if (b.done || b.waitSeconds) break;
        }
        await followUp(env, i, { content: `Added ${added} - already in ${already} - couldn't add ${failed}. Run /pull again any time for new players.` });
      })()
    );
    return DEFER;
  },
  async stats(env, i) {
    if (!(await ownerOnly(env, i))) return say("Only the owner can use this.");
    const DB = await db(env);
    const one = async (sql) => ((await DB.prepare(sql).first()) || {}).n || 0;
    const day = now() - 86400;
    return sayEmbed({ title: "Reminth accounts", color: COLOR, fields: [
      { name: "Accounts", value: String(await one("SELECT COUNT(*) AS n FROM accounts")), inline: true },
      { name: "New today", value: String(await one(`SELECT COUNT(*) AS n FROM accounts WHERE created_at > ${day}`)), inline: true },
      { name: "Active today", value: String(await one(`SELECT COUNT(*) AS n FROM accounts WHERE last_login > ${day}`)), inline: true },
      { name: "With Discord", value: String(await one("SELECT COUNT(*) AS n FROM identities WHERE provider = 'discord'")), inline: true },
      { name: "With email", value: String(await one("SELECT COUNT(*) AS n FROM identities WHERE provider = 'email'")), inline: true },
      { name: "Added to the server", value: String(await one("SELECT COUNT(*) AS n FROM identities WHERE provider = 'discord' AND guild_joined_at IS NOT NULL")), inline: true },
    ] });
  },
};

async function ownerOnly(env, i) {
  return Boolean(env.ADMIN_DISCORD_ID && invoker(i).id === String(env.ADMIN_DISCORD_ID));
}

function botError(r, what) {
  if (r.status === 403) return `I'm not allowed to ${what}. Give my role that permission, and drag my role above theirs in Server Settings -> Roles.`;
  if (r.status === 404) return `Couldn't ${what}: not found.`;
  if (r.status === 429) return "Discord says slow down - try again in a few seconds.";
  return `Couldn't ${what} (${r.status}${r.data && r.data.message ? ": " + r.data.message : ""}).`;
}

/**
 * The newest Reminth release from GitHub's public releases feed (github.com/.../releases.atom). The GitHub API refuses
 * Cloudflare's shared addresses after a few calls an hour (403), the feed doesn't. -> {tag, title, body (plain text), url, published} or null
 */
export async function fetchLatestRelease(env) {
  const r = await fetch(`${env.GITHUB_WEB || "https://github.com"}/${GITHUB_REPO}/releases.atom`, { headers: { "user-agent": "ReminthBot", accept: "application/atom+xml" } });
  if (!r.ok) return null;
  const xml = await r.text();
  const entry = (/<entry>([\s\S]*?)<\/entry>/.exec(xml) || [])[1];
  if (!entry) return null;
  const pick = (re) => (re.exec(entry) || [])[1] || "";
  const url = pick(/<link[^>]*href="([^"]+)"/);
  const tag = decodeURIComponent((/\/releases\/tag\/([^"/?#]+)/.exec(url) || [])[1] || "");
  const unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  const html = unescape(pick(/<content[^>]*>([\s\S]*?)<\/content>/));
  const body = unescape(
    html
      .replace(/<li>\s*/gi, "- ")
      .replace(/<\/(li|p|h\d)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/\n\s*\n(?=- )/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { tag: tag.slice(0, 30), title: unescape(pick(/<title>([^<]*)<\/title>/)), body, url: url || SITE, published: pick(/<updated>([^<]+)<\/updated>/) };
}

let releaseCache = null;
async function latestRelease(env) {
  if (releaseCache && Date.now() - releaseCache.at < 10 * 60 * 1000) return releaseCache.rel;
  try {
    const rel = await fetchLatestRelease(env);
    if (rel && rel.tag) releaseCache = { rel, at: Date.now() };
    return rel;
  } catch {
    return null;
  }
}

async function bugSubmitted(env, i) {
  const values = {};
  for (const row of i.data.components || []) for (const c of row.components || []) values[c.custom_id] = c.value;
  const ch = await getConfig(env, "bugs_channel");
  if (!ch) return say("Thanks! (Bug reports aren't set up on this server yet - tell a mod.)");
  const me = invoker(i);
  const fields = [{ name: "What happened", value: clip(values.what, 1000) || "-" }];
  if (values.steps) fields.push({ name: "How to make it happen", value: clip(values.steps, 1000) });
  if (values.version) fields.push({ name: "Minecraft / loader", value: clip(values.version, 100), inline: true });
  fields.push({ name: "From", value: `<@${me.id}>`, inline: true });
  const r = await dapi(env, "POST", `/channels/${ch}/messages`, { embeds: [{ title: "Bug report", color: RED, fields, timestamp: new Date().toISOString() }], allowed_mentions: { parse: [] } });
  if (!r.ok) return say("Thanks - but I couldn't post it (I can't write in the bug channel). Tell a mod.");
  return say("Thanks! Your report is in. 🛠️");
}

/** Everything Discord sends. Returns the answer (Discord waits 3 seconds at most - slow work is deferred). */
export async function handleInteraction(env, i, ctx) {
  if (i.type === 1) return { type: 1 }; // Discord checking the address
  if (!i.guild_id) return say("Use me in the Reminth server.");
  if (env.DISCORD_GUILD_ID && i.guild_id !== String(env.DISCORD_GUILD_ID)) return say("I only work in the Reminth server.");
  if (i.type === 2) {
    const h = HANDLERS[i.data && i.data.name];
    if (!h) return say("I don't know that command (the commands may need setting up again on the website).");
    return h(env, i, ctx);
  }
  if (i.type === 5 && i.data && i.data.custom_id === "bug") return bugSubmitted(env, i);
  return say("That didn't work. Try again.");
}

export { isAdmin, identitiesOf };
