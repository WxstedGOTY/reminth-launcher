// "Set up my server" (Owner tools on the account page): sets up the owner's EXISTING Discord server (made by hand on
// 10 Oct 2026 - "Reminth Launcher"). Nothing is created that already exists; channels are found by their names.
//   check      - what was found (shown to the owner before anything changes)
//   commands   - the bot's slash commands
//   roles      - staff roles with exactly the owner's permissions, Member, Launcher Player, the onboarding roles
//   order      - role order, the Owner role for the server owner, @everyone without threads / external apps /
//                slash commands (commands only work in #commands; staff everywhere)
//   channels   - per channel: no threads, no external apps, read-only info channels (bots may still post), the mod
//                channel only for staff, Moderators may delete messages in Community channels only, 2 s slowmode
//                in #general
//   onboarding - region / interests / socials questions and the required rules question (gives Member)
//   bot        - mod log, Player role, updates + socials channels and roles, AutoMod, email verification
// The channel messages (rules, announcement, faq...) are posted separately by _texts.js, after the owner's OK.
// Every step can run again safely.
import { COMMANDS, dapi, getConfig, setConfig, setupAutomod } from "./_bot.js";

const B = (n) => 1n << BigInt(n);
export const PERM = {
  INVITE: B(0), KICK: B(1), BAN: B(2), ADMIN: B(3), MANAGE_CHANNELS: B(4), MANAGE_GUILD: B(5), ADD_REACTIONS: B(6), VIEW: B(10), SEND: B(11), MANAGE_MESSAGES: B(13),
  EMBED: B(14), ATTACH: B(15), HISTORY: B(16), MENTION_EVERYONE: B(17), APP_COMMANDS: B(31), MANAGE_THREADS: B(34), PUBLIC_THREADS: B(35), PRIVATE_THREADS: B(36),
  SEND_IN_THREADS: B(38), MODERATE: B(40), EXTERNAL_APPS: B(50),
};
const THREADS = PERM.PUBLIC_THREADS | PERM.PRIVATE_THREADS | PERM.SEND_IN_THREADS | PERM.MANAGE_THREADS;
const NEVER_FOR_EVERYONE = THREADS | PERM.EXTERNAL_APPS | PERM.APP_COMMANDS | PERM.MENTION_EVERYONE | PERM.MANAGE_MESSAGES;

// top to bottom; perms only for the staff roles (the rest have no permissions of their own)
export const ROLE_PLAN = [
  { name: "Owner", color: 0xe53935, hoist: true, perms: PERM.ADMIN },
  { name: "Co-Owner", color: 0xfb8c00, hoist: true, perms: PERM.ADMIN },
  { name: "Admin", color: 0xfdd835, hoist: true, perms: PERM.ADMIN },
  { name: "Moderator", color: 0x1e88e5, hoist: true, perms: PERM.KICK | PERM.BAN | PERM.MODERATE | PERM.APP_COMMANDS },
  { name: "Helper", color: 0x43a047, hoist: true, perms: PERM.MODERATE | PERM.APP_COMMANDS },
  { name: "Launcher Player", color: 0x22d3ee, hoist: true, perms: 0n },
  { name: "Member", color: 0, hoist: false, perms: 0n },
  { name: "Launcher Updates", perms: 0n },
  { name: "Announcements", perms: 0n },
  { name: "Giveaways & Events", perms: 0n },
  { name: "X (Twitter)", perms: 0n },
  { name: "YouTube", perms: 0n },
  { name: "TikTok", perms: 0n },
  { name: "Europe", perms: 0n },
  { name: "North America", perms: 0n },
  { name: "South America", perms: 0n },
  { name: "Asia", perms: 0n },
  { name: "Middle East", perms: 0n },
  { name: "Africa", perms: 0n },
  { name: "Oceania", perms: 0n },
];

// which channel is which job: by name, without emojis and separators ("📢｜annoucements" -> "annoucements")
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const JOBS = {
  rules: (n) => n === "rules",
  modlog: (n) => n.includes("moderatoronly") || n.includes("modlog") || n.includes("staffonly"),
  announcements: (n) => n.includes("annou"),
  updates: (n) => n === "updates",
  socials: (n) => n.includes("social"),
  giveaways: (n) => n.includes("giveaway"),
  events: (n) => n === "events",
  boosts: (n) => n.includes("boost"),
  faq: (n) => n === "faq",
  general: (n) => n === "general",
  clips: (n) => n.includes("clip"),
  suggestions: (n) => n.includes("suggest"),
  commands: (n) => n.includes("command"),
  support: (n) => n.includes("support"),
  application: (n) => n.includes("applic"),
  readfirst: (n) => n.includes("readfirst"),
};
const READ_ONLY = ["rules", "announcements", "updates", "socials", "giveaways", "events", "boosts", "faq", "support", "application", "readfirst"];
const COMMUNITY = ["general", "clips", "suggestions", "commands"];

export function findJobs(channels) {
  const out = {};
  for (const c of channels) {
    if (![0, 5, 15].includes(c.type)) continue; // text, announcement, forum
    for (const [job, test] of Object.entries(JOBS)) if (!out[job] && test(norm(c.name))) out[job] = c;
  }
  out.communityCategory = channels.find((c) => c.type === 4 && norm(c.name) === "community") || null;
  return out;
}

export const SETUP_STEPS = ["check", "commands", "roles", "order", "channels", "onboarding", "bot"];

const s = (x) => String(x);
const fakeId = (n) => String(((BigInt(Date.now()) - 1420070400000n) << 22n) + BigInt(n)); // new onboarding questions need ids

export async function setupStep(env, step) {
  const g = s(env.DISCORD_GUILD_ID);
  const name = SETUP_STEPS[step];
  if (!name) return { step, next: null, log: [] };
  const log = [];
  const retry = (r) => (r && r.status === 429 ? Math.min(60, Math.ceil(Number((r.data && r.data.retry_after) || 5))) : 0);
  const stop = (what, r) => ({ step, next: null, log, problem: `${what}: ${r.status}${r.data && r.data.message ? " " + r.data.message : ""}${r.data && r.data.errors ? " " + JSON.stringify(r.data.errors).slice(0, 300) : ""}` });
  const wait = (r) => ({ step, next: step, log, waitSeconds: retry(r) });
  const next = step + 1 < SETUP_STEPS.length ? step + 1 : null;

  const chansR = ["check", "channels", "onboarding", "bot"].includes(name) ? await dapi(env, "GET", `/guilds/${g}/channels`) : null;
  if (chansR && !chansR.ok) return stop("Reading the channels", chansR);
  const channels = chansR ? chansR.data || [] : [];
  const jobs = findJobs(channels);
  const rolesR = ["check", "roles", "order", "channels", "onboarding", "bot"].includes(name) ? await dapi(env, "GET", `/guilds/${g}/roles`) : null;
  if (rolesR && !rolesR.ok) return stop("Reading the roles", rolesR);
  const roles = rolesR ? rolesR.data || [] : [];
  const role = (n) => roles.find((r) => r.name === n);

  if (name === "check") {
    for (const job of Object.keys(JOBS)) log.push(`${jobs[job] ? "✓" : "✗"} ${job}: ${jobs[job] ? "#" + jobs[job].name : "not found"}`);
    log.push(`${jobs.communityCategory ? "✓" : "✗"} Community category`);
    const missingRoles = ROLE_PLAN.filter((r) => !role(r.name)).map((r) => r.name);
    log.push(missingRoles.length ? `Roles to make: ${missingRoles.join(", ")}` : "All roles are there");
    const chat = COMMUNITY.filter((j) => jobs[j]).length;
    if (chat < 5) log.push(`Note: Discord's onboarding needs 5 channels where members can write - there are ${chat} (${COMMUNITY.filter((j) => jobs[j]).map((j) => "#" + jobs[j].name).join(", ")}).`);
    return { step, next, log, jobs: Object.fromEntries(Object.entries(jobs).map(([k, v]) => [k, v ? v.name : null])) };
  }

  if (name === "commands") {
    const r = await dapi(env, "PUT", `/applications/${env.DISCORD_CLIENT_ID}/guilds/${g}/commands`, COMMANDS);
    if (retry(r)) return wait(r);
    if (!r.ok) return stop("Installing the commands", r);
    log.push(`${COMMANDS.length} slash commands installed`);
  }

  if (name === "roles") {
    let calls = 0;
    for (const plan of ROLE_PLAN) {
      const have = role(plan.name);
      if (have) {
        // staff roles get exactly the owner's permissions; the others keep none (in case something was added)
        if (BigInt(have.permissions) !== plan.perms) {
          if (calls >= 12) return { step, next: step, log };
          const r = await dapi(env, "PATCH", `/guilds/${g}/roles/${have.id}`, { permissions: s(plan.perms) }, "Reminth setup: permissions");
          calls++;
          if (retry(r)) return wait(r);
          if (!r.ok) return stop(`Changing the role ${plan.name}`, r);
          log.push(`Role ${plan.name}: permissions set`);
        }
        continue;
      }
      if (calls >= 12) return { step, next: step, log }; // the rest in the next call
      const r = await dapi(env, "POST", `/guilds/${g}/roles`, { name: plan.name, color: plan.color || 0, hoist: Boolean(plan.hoist), permissions: s(plan.perms), mentionable: false }, "Reminth setup");
      calls++;
      if (retry(r)) return wait(r);
      if (!r.ok) return stop(`Making the role ${plan.name}`, r);
      roles.push(r.data);
      log.push(`Role ${plan.name}: made`);
    }
    if (!log.length) log.push("All roles are there with the right permissions");
  }

  if (name === "order") {
    // our roles in order, right under the bot's own role; other roles (other bots) keep their places above ours
    const ours = ROLE_PLAN.map((p) => role(p.name)).filter(Boolean);
    const positions = ours.map((r, i) => ({ id: r.id, position: ours.length - i }));
    const r = await dapi(env, "PATCH", `/guilds/${g}/roles`, positions, "Reminth setup: role order");
    if (retry(r)) return wait(r);
    if (!r.ok) return stop("Ordering the roles (is the bot's role at the very top?)", r);
    log.push("Roles ordered: Owner, Co-Owner, Admin, Moderator, Helper, Launcher Player, Member, then the pick-your-own roles");
    // @everyone: no threads, no external apps, no slash commands outside #commands, no @everyone pings, no deleting
    const everyone = role("@everyone") || roles.find((x) => x.id === g);
    if (everyone) {
      const now = BigInt(everyone.permissions);
      const want = now & ~NEVER_FOR_EVERYONE;
      if (want !== now) {
        const e = await dapi(env, "PATCH", `/guilds/${g}/roles/${g}`, { permissions: s(want) }, "Reminth setup: @everyone");
        if (!e.ok) return stop("Changing @everyone", e);
      }
      log.push("@everyone: no threads, no external apps, slash commands only in #commands");
    }
    const guild = await dapi(env, "GET", `/guilds/${g}`);
    const owner = role("Owner");
    if (guild.ok && owner) {
      const a = await dapi(env, "PUT", `/guilds/${g}/members/${guild.data.owner_id}/roles/${owner.id}`, undefined, "Reminth setup: the server owner");
      log.push(a.ok ? "You have the Owner role" : `Couldn't give you the Owner role (${a.status})`);
    }
  }

  if (name === "channels") {
    const mod = role("Moderator");
    const helper = role("Helper");
    const botRoles = roles.filter((r) => r.tags && r.tags.bot_id).map((r) => r.id); // every bot may post in read-only channels
    const done = new Set(JSON.parse((await getConfig(env, "setup:channels_done")) || "[]"));
    const jobOf = (c) => Object.keys(JOBS).find((j) => jobs[j] && jobs[j].id === c.id);
    const work = channels.filter((c) => [0, 2, 4, 5, 13, 15].includes(c.type) && !done.has(c.id));
    let calls = 0;
    for (const c of work) {
      if (calls >= 10) return { step, next: step, log };
      const job = jobOf(c);
      const inCommunity = (jobs.communityCategory && (c.parent_id === jobs.communityCategory.id || c.id === jobs.communityCategory.id)) || COMMUNITY.includes(job);
      const ow = (c.permission_overwrites || []).map((o) => ({ id: o.id, type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny) }));
      const get = (id, type) => {
        let o = ow.find((x) => x.id === id);
        if (!o) ow.push((o = { id, type, allow: 0n, deny: 0n }));
        return o;
      };
      const allow = (o, bits) => {
        o.allow |= bits;
        o.deny &= ~bits;
      };
      const deny = (o, bits) => {
        o.deny |= bits;
        o.allow &= ~bits;
      };
      for (const o of ow) o.allow &= ~(THREADS | PERM.EXTERNAL_APPS); // nobody gets threads or external apps back here
      const every = get(g, 0);
      deny(every, THREADS | PERM.EXTERNAL_APPS);
      if (READ_ONLY.includes(job)) {
        deny(every, PERM.SEND);
        for (const id of botRoles) allow(get(id, 0), PERM.VIEW | PERM.SEND | PERM.EMBED | PERM.HISTORY);
      }
      if (job === "commands") allow(every, PERM.APP_COMMANDS);
      if (job === "modlog") {
        deny(every, PERM.VIEW);
        for (const r of [mod, helper]) if (r) allow(get(r.id, 0), PERM.VIEW | PERM.SEND | PERM.HISTORY);
        allow(get(s(env.DISCORD_CLIENT_ID), 1), PERM.VIEW | PERM.SEND | PERM.EMBED | PERM.HISTORY);
      }
      if (inCommunity && mod) allow(get(mod.id, 0), PERM.MANAGE_MESSAGES);
      const body = { permission_overwrites: ow.map((o) => ({ id: o.id, type: o.type, allow: s(o.allow), deny: s(o.deny) })) };
      if (job === "general") body.rate_limit_per_user = 2;
      const r = await dapi(env, "PATCH", `/channels/${c.id}`, body, "Reminth setup: permissions");
      calls++;
      if (retry(r)) return wait(r);
      if (!r.ok) return stop(`Changing #${c.name}`, r);
      done.add(c.id);
      await setConfig(env, "setup:channels_done", JSON.stringify([...done]));
      log.push(`${c.type === 4 ? "Category" : "#"}${c.name}: ${READ_ONLY.includes(job) ? "read-only" : job === "modlog" ? "staff only" : job === "commands" ? "commands allowed" : inCommunity ? "mods may delete messages" : "done"}${job === "general" ? ", 2 s slowmode" : ""}`);
    }
    await setConfig(env, "setup:channels_done", "[]"); // all done - a next setup goes through every channel again
    if (!log.length) log.push("All channels are set");
  }

  if (name === "onboarding") {
    const rid = (n) => (role(n) || {}).id;
    let n = 0;
    const opt = (title, emoji, roleName, description) => ({ id: fakeId(n++), title, description: description || null, emoji_name: emoji, role_ids: rid(roleName) ? [rid(roleName)] : [], channel_ids: [] });
    const prompts = [
      { id: fakeId(n++), type: 0, title: "🌍 Where are you from?", single_select: true, required: false, in_onboarding: true, options: [
        opt("Europe (EU)", "🇪🇺", "Europe"), opt("North America (NA)", "🗽", "North America"), opt("South America (SA)", "🌴", "South America"),
        opt("Asia (AS)", "🏯", "Asia"), opt("Middle East (ME)", "🏜️", "Middle East"), opt("Africa (AF)", "🦁", "Africa"), opt("Oceania (OC)", "🦘", "Oceania")] },
      { id: fakeId(n++), type: 0, title: "⭐ What are you interested in?", single_select: false, required: false, in_onboarding: true, options: [
        opt("Launcher Updates", "🚀", "Launcher Updates", "Get pinged when a new version of Reminth comes out"),
        opt("Announcements", "📢", "Announcements", "Get pinged for news"),
        opt("Giveaways & Events", "🎁", "Giveaways & Events", "Get pinged for giveaways and events")] },
      { id: fakeId(n++), type: 0, title: "📱 Which socials do you want to hear from?", single_select: false, required: false, in_onboarding: true, options: [
        opt("X (Twitter)", "🐦", "X (Twitter)"), opt("YouTube", "▶️", "YouTube"), opt("TikTok", "🎵", "TikTok")] },
      { id: fakeId(n++), type: 0, title: "📜 Do you accept the rules?", single_select: true, required: true, in_onboarding: true, options: [
        opt("I accept the rules", "✅", "Member", "Be respectful, no spam, no NSFW, no cheating, use the right channels. Full rules in #rules.")] },
    ];
    const visible = channels.filter((c) => [0, 5, 15].includes(c.type) && !(jobs.modlog && c.id === jobs.modlog.id)).map((c) => c.id);
    const r = await dapi(env, "PUT", `/guilds/${g}/onboarding`, { prompts, default_channel_ids: visible, enabled: true, mode: 0 }, "Reminth setup: onboarding");
    if (retry(r)) return wait(r);
    if (!r.ok) {
      // usually: Discord wants 7 default channels with 5 where everyone can write - keep going, say why
      log.push(`Onboarding NOT switched on: ${r.status} ${(r.data && r.data.message) || ""} ${r.data && r.data.errors ? JSON.stringify(r.data.errors).slice(0, 300) : ""}`.trim());
    } else {
      log.push("Onboarding on: region, interests, socials, rules (gives Member)");
    }
  }

  if (name === "bot") {
    const set = async (k, v, label) => {
      if (v) {
        await setConfig(env, k, v);
        log.push(`${label}: ✓`);
      } else log.push(`${label}: not found`);
    };
    await set("modlog_channel", jobs.modlog && jobs.modlog.id, "Mod log channel");
    await set("bugs_channel", jobs.modlog && jobs.modlog.id, "/bug reports channel");
    await set("updates_channel", jobs.updates && jobs.updates.id, "Updates channel (release posts)");
    await set("socials_channel", jobs.socials && jobs.socials.id, "Socials channel (YouTube posts)");
    await set("player_role", (role("Launcher Player") || {}).id, "Launcher Player role (/verify)");
    await set("updates_role", (role("Launcher Updates") || {}).id, "Launcher Updates role (pinged on releases)");
    await set("youtube_role", (role("YouTube") || {}).id, "YouTube role");
    const existing = await dapi(env, "GET", `/guilds/${g}/auto-moderation/rules`);
    if (existing.ok) {
      const a = await setupAutomod(env, g, false, "Reminth setup", existing.data || []);
      log.push(a.done.length ? `AutoMod on: ${a.done.join(", ")}` : "AutoMod: " + a.problems.join("; "));
    }
    const guild = await dapi(env, "GET", `/guilds/${g}`);
    if (guild.ok) {
      const body = {};
      if ((guild.data.verification_level || 0) < 1) body.verification_level = 1; // a verified email
      if ((guild.data.explicit_content_filter || 0) < 2) body.explicit_content_filter = 2;
      if (Object.keys(body).length) await dapi(env, "PATCH", `/guilds/${g}`, body, "Reminth setup");
      log.push("Members need a verified email; images are checked for explicit content");
    }
  }

  return { step, next, log };
}
