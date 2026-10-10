// "Build my Discord server" (Owner tools on the account page): the Reminth bot sets up the whole server - roles,
// categories, channels with the right permissions, the welcome and rules messages, the server settings and icon, the
// mod log / bug channel / Player role, AutoMod, the #updates webhook and the slash commands.
//
// It runs in small steps (the page calls POST /api/admin/discord-build with {step} until done), because a Cloudflare
// request may only make a limited number of calls, and Discord limits how fast channels can be made. Every step can
// run again safely: things that already exist (same name) are kept and reused, messages are posted once.
import { COMMANDS, dapi, getConfig, setConfig, setupAutomod } from "./_bot.js";

const SITE = "https://reminth.pages.dev";
const BIT = { ADD_REACTIONS: 1n << 6n, VIEW_AUDIT_LOG: 1n << 7n, VIEW: 1n << 10n, SEND: 1n << 11n, MANAGE_MESSAGES: 1n << 13n, EMBED: 1n << 14n, ATTACH: 1n << 15n,
  HISTORY: 1n << 16n, MUTE: 1n << 22n, MOVE: 1n << 24n, MANAGE_NICKNAMES: 1n << 27n, MANAGE_WEBHOOKS: 1n << 29n, PUBLIC_THREADS: 1n << 35n, PRIVATE_THREADS: 1n << 36n,
  SEND_IN_THREADS: 1n << 38n, MODERATE: 1n << 40n, KICK: 1n << 1n, BAN: 1n << 2n };
const bits = (...b) => String(b.reduce((a, x) => a | x, 0n));

export const ROLES = [
  // made bottom-up: each new role lands just above @everyone, so the last one made ends up highest
  { key: "player", name: "Reminth Player", color: 0x22d3ee, hoist: true, permissions: "0" },
  { key: "mod", name: "Moderator", color: 0xff4a1c, hoist: true,
    permissions: bits(BIT.KICK, BIT.BAN, BIT.VIEW_AUDIT_LOG, BIT.MANAGE_MESSAGES, BIT.MUTE, BIT.MOVE, BIT.MANAGE_NICKNAMES, BIT.MODERATE) },
];

// kind: "readonly" (only mods and the bot write), "staff" (only mods and the bot see it), or normal
export const LAYOUT = [
  { category: "📌 Start here", channels: [
    { key: "welcome", name: "welcome", kind: "readonly", topic: "What Reminth is, how to get it, and how to get the Reminth Player role." },
    { key: "rules", name: "rules", kind: "readonly", topic: "Read these before you chat." },
    { key: "announcements", name: "announcements", kind: "readonly", topic: "News about Reminth." },
    { key: "updates", name: "updates", kind: "readonly", topic: "Every new Reminth version, posted automatically." },
  ] },
  { category: "💬 Community", channels: [
    { key: "general", name: "general", topic: "Talk about anything Minecraft and Reminth." },
    { key: "pvp", name: "pvp-talk", topic: "PvP, tiers (/tiers in game), duels and tips." },
    { key: "clips", name: "clips-and-screenshots", topic: "Show your best clips and screenshots." },
    { key: "offtopic", name: "off-topic", topic: "Everything else." },
  ] },
  { category: "🛠️ Help", channels: [
    { key: "help", name: "help", topic: "Stuck? Ask here. Try /help first for quick answers." },
    { key: "bugs", name: "bug-reports", kind: "readonly", topic: "Found a bug? Type /bug anywhere - your report lands here." },
    { key: "suggestions", name: "suggestions", topic: "Ideas for Reminth." },
  ] },
  { category: "🔊 Voice", channels: [
    { key: "vc_general", name: "General", voice: true },
    { key: "vc_pvp", name: "PvP", voice: true },
  ] },
  { category: "🔒 Staff", staff: true, channels: [
    { key: "modlog", name: "mod-log", kind: "staff", topic: "Everything the bot and AutoMod do." },
    { key: "staff", name: "staff-chat", kind: "staff", topic: "Mods only." },
  ] },
];

function overwrites(env, guildId, modRole, kind) {
  const bot = { id: String(env.DISCORD_CLIENT_ID), type: 1, allow: bits(BIT.VIEW, BIT.SEND, BIT.EMBED, BIT.HISTORY, BIT.MANAGE_WEBHOOKS), deny: "0" };
  const mod = modRole ? [{ id: modRole, type: 0, allow: bits(BIT.VIEW, BIT.SEND, BIT.EMBED, BIT.ATTACH, BIT.HISTORY), deny: "0" }] : [];
  if (kind === "staff") return [{ id: guildId, type: 0, allow: "0", deny: bits(BIT.VIEW) }, ...mod, bot];
  if (kind === "readonly")
    return [{ id: guildId, type: 0, allow: bits(BIT.VIEW, BIT.HISTORY, BIT.ADD_REACTIONS), deny: bits(BIT.SEND, BIT.PUBLIC_THREADS, BIT.PRIVATE_THREADS, BIT.SEND_IN_THREADS) }, ...mod, bot];
  return [];
}

const STEPS = ["commands", "roles", "categories", "channels", "messages", "settings", "bot"];
export const STEP_NAMES = STEPS;

/** Runs one step. -> {step, next (null when done), log[], waitSeconds, problem} */
export async function buildStep(env, step, origin) {
  const g = String(env.DISCORD_GUILD_ID);
  const name = STEPS[step];
  if (!name) return { step, next: null, log: [] };
  const log = [];
  const retry = (r) => (r && r.status === 429 ? Math.min(60, Math.ceil(Number((r.data && r.data.retry_after) || 5))) : 0);
  const fail = (what, r) => ({ step, next: null, log, problem: `${what}: ${r.status}${r.data && r.data.message ? " " + r.data.message : ""}` });
  const id = async (key) => getConfig(env, "build:" + key);

  if (name === "commands") {
    const r = await dapi(env, "PUT", `/applications/${env.DISCORD_CLIENT_ID}/guilds/${g}/commands`, COMMANDS);
    if (retry(r)) return { step, next: step, log, waitSeconds: retry(r) };
    if (!r.ok) return fail("Installing the commands", r);
    log.push(`${COMMANDS.length} slash commands installed`);
  }

  if (name === "roles") {
    const have = await dapi(env, "GET", `/guilds/${g}/roles`);
    if (!have.ok) return fail("Reading the roles", have);
    for (const role of ROLES) {
      const found = (have.data || []).find((r) => r.name === role.name);
      if (found) {
        await setConfig(env, "build:role_" + role.key, found.id);
        log.push(`Role ${role.name}: already there`);
        continue;
      }
      const r = await dapi(env, "POST", `/guilds/${g}/roles`, { name: role.name, color: role.color, hoist: role.hoist, permissions: role.permissions, mentionable: false }, "Reminth server builder");
      if (retry(r)) return { step, next: step, log, waitSeconds: retry(r) };
      if (!r.ok) return fail(`Making the role ${role.name}`, r);
      await setConfig(env, "build:role_" + role.key, r.data.id);
      log.push(`Role ${role.name}: made`);
    }
  }

  if (name === "categories" || name === "channels") {
    const have = await dapi(env, "GET", `/guilds/${g}/channels`);
    if (!have.ok) return fail("Reading the channels", have);
    const list = have.data || [];
    const mod = await id("role_mod");
    let made = 0;
    for (const cat of LAYOUT) {
      let catId = (list.find((c) => c.type === 4 && c.name === cat.category) || {}).id;
      if (name === "categories") {
        if (catId) {
          log.push(`Category ${cat.category}: already there`);
        } else {
          const r = await dapi(env, "POST", `/guilds/${g}/channels`, { name: cat.category, type: 4, permission_overwrites: cat.staff ? overwrites(env, g, mod, "staff") : [] }, "Reminth server builder");
          if (retry(r)) return { step, next: step, log, waitSeconds: retry(r) };
          if (!r.ok) return fail(`Making the category ${cat.category}`, r);
          catId = r.data.id;
          log.push(`Category ${cat.category}: made`);
        }
        await setConfig(env, "build:cat_" + cat.category, catId);
        continue;
      }
      catId = catId || (await id("cat_" + cat.category));
      for (const ch of cat.channels) {
        const type = ch.voice ? 2 : 0;
        const found = list.find((c) => c.type === type && c.name.toLowerCase() === ch.name.toLowerCase());
        if (found) {
          await setConfig(env, "build:ch_" + ch.key, found.id);
          continue;
        }
        if (made >= 6) return { step, next: step, log }; // the rest next time (keeps each request small)
        const body = { name: ch.name, type, parent_id: catId || undefined, permission_overwrites: overwrites(env, g, mod, ch.kind) };
        if (ch.topic) body.topic = ch.topic;
        const r = await dapi(env, "POST", `/guilds/${g}/channels`, body, "Reminth server builder");
        if (retry(r)) return { step, next: step, log, waitSeconds: retry(r) };
        if (!r.ok) return fail(`Making #${ch.name}`, r);
        await setConfig(env, "build:ch_" + ch.key, r.data.id);
        made++;
        log.push(`${ch.voice ? "Voice channel" : "#"}${ch.name}: made`);
      }
    }
    if (name === "channels" && !made) log.push("All channels are there");
  }

  if (name === "messages") {
    const ch = async (k) => id("ch_" + k);
    const [welcome, rules, help, general] = [await ch("welcome"), await ch("rules"), await ch("help"), await ch("general")];
    const player = await id("role_player");
    if (welcome && !(await getConfig(env, "build:msg_welcome"))) {
      const r = await dapi(env, "POST", `/channels/${welcome}/messages`, { embeds: [welcomeEmbed(rules, help, player)], allowed_mentions: { parse: [] } });
      if (retry(r)) return { step, next: step, log, waitSeconds: retry(r) };
      if (!r.ok) return fail("Posting the welcome message", r);
      await setConfig(env, "build:msg_welcome", r.data.id);
      log.push("Welcome message posted");
    }
    if (rules && !(await getConfig(env, "build:msg_rules"))) {
      const r = await dapi(env, "POST", `/channels/${rules}/messages`, { embeds: [rulesEmbed(help)], allowed_mentions: { parse: [] } });
      if (retry(r)) return { step, next: step, log, waitSeconds: retry(r) };
      if (!r.ok) return fail("Posting the rules", r);
      await setConfig(env, "build:msg_rules", r.data.id);
      log.push("Rules posted");
    }
    if (!log.length) log.push(general ? "Messages were already posted" : "No channels to post in");
  }

  if (name === "settings") {
    const body = { verification_level: 1, default_message_notifications: 1, explicit_content_filter: 2 };
    const general = await id("ch_general");
    if (general) body.system_channel_id = general;
    try {
      const icon = await fetch(`${origin || SITE}/favicon.png`);
      if (icon.ok) {
        const buf = new Uint8Array(await icon.arrayBuffer());
        if (buf.length < 900000) {
          let bin = "";
          for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          body.icon = "data:image/png;base64," + btoa(bin);
        }
      }
    } catch {
      // keep the server's own icon
    }
    const r = await dapi(env, "PATCH", `/guilds/${g}`, body, "Reminth server builder");
    if (retry(r)) return { step, next: step, log, waitSeconds: retry(r) };
    if (!r.ok) return fail("Changing the server settings", r);
    log.push("Server settings: members need a verified email, notifications for mentions only, image filter on" + (body.icon ? ", Reminth icon" : "") + (general ? ", join messages in #general" : ""));
  }

  if (name === "bot") {
    const [modlog, bugs, player, updates] = [await id("ch_modlog"), await id("ch_bugs"), await id("role_player"), await id("ch_updates")];
    if (modlog) await setConfig(env, "modlog_channel", modlog);
    if (bugs) await setConfig(env, "bugs_channel", bugs);
    if (player) await setConfig(env, "player_role", player);
    log.push("Bot set up: mod log, bug reports, Player role");
    const existing = await dapi(env, "GET", `/guilds/${g}/auto-moderation/rules`);
    if (existing.ok) {
      const a = await setupAutomod(env, g, false, "Reminth server builder", existing.data || []);
      log.push(a.done.length ? `AutoMod on: ${a.done.join(", ")}` : "AutoMod: " + a.problems.join("; "));
    } else {
      log.push("AutoMod: couldn't read the rules (" + existing.status + ")");
    }
    if (updates && !(await getConfig(env, "updates_webhook"))) {
      const r = await dapi(env, "POST", `/channels/${updates}/webhooks`, { name: "Reminth" }, "Reminth server builder: release posts");
      if (r.ok && r.data && r.data.id && r.data.token) {
        await setConfig(env, "updates_webhook", `https://discord.com/api/webhooks/${r.data.id}/${r.data.token}`);
        log.push("Webhook for #updates made");
      } else {
        log.push("Webhook for #updates: couldn't make it (" + r.status + ")");
      }
    }
  }

  const next = step + 1 < STEPS.length ? step + 1 : null;
  return { step, next, log };
}

function welcomeEmbed(rules, help, player) {
  const ch = (x, fallback) => (x ? `<#${x}>` : fallback);
  return {
    title: "Welcome to the Reminth server 👋",
    color: 0xff4a1c,
    description:
      "**Reminth** is a free Minecraft launcher for Windows - built for PvP and performance.\n\n" +
      "- Press **G** in game for the Reminth Mods Panel: about 145 built-in features (FPS, keystrokes, armor, potion timers, zoom, hit markers, combo counter, Tier Tagger...)\n" +
      "- Sodium, Lithium and more performance mods set up for you\n" +
      "- Checks your mods before the game starts, so no more \"incompatible mods\"\n" +
      "- Every version from 1.20.1 to 26.3",
    fields: [
      { name: "Get Reminth", value: `${SITE}` },
      { name: `Get the ${player ? `<@&${player}>` : "Reminth Player"} role`, value: "Sign in to Reminth with Discord, then type **/verify** here." },
      { name: "Before you chat", value: `Read ${ch(rules, "#rules")}.` },
      { name: "Need help?", value: `Ask in ${ch(help, "#help")} or try **/help**. Found a bug? Type **/bug**.` },
    ],
    footer: { text: "Reminth" },
  };
}

function rulesEmbed(help) {
  return {
    title: "Rules",
    color: 0xff4a1c,
    description: [
      "**1. Be respectful.** No harassment, hate speech, slurs or threats.",
      "**2. No spam.** No mass pings, flooding or advertising - invite links to other servers are blocked.",
      "**3. Keep it safe for everyone.** No NSFW, gore or shock content.",
      "**4. No cheats.** No hacked clients, cheat links, or selling or sharing accounts.",
      `**5. Use the right channel.** Questions in ${help ? `<#${help}>` : "#help"}, bugs with **/bug**.`,
      "**6. Follow Discord's rules.** [Terms of Service](https://discord.com/terms) and [Community Guidelines](https://discord.com/guidelines).",
      "**7. Mods have the final say.** If something's wrong, ask a Moderator.",
    ].join("\n\n"),
    footer: { text: "Breaking the rules can get you warned, timed out, kicked or banned." },
  };
}
