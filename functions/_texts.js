// The channel messages of the Reminth Discord server (approved texts: discord/texts.md). Posted through a webhook
// called "Reminth" with the Reminth logo, one message per channel. Owner tools -> "Post the channel messages".
// Messages are NEVER edited (owner, 15 Oct 2026: no "(edited)" on any of them, always new messages):
//  - rules, faq, socials, #read-first: the old message is deleted and the same info posted again as a new one;
//  - #announcements and #updates (`keep`): old messages stay; a new message is posted only when the text changed.
import { dapi, getConfig, setConfig } from "./_bot.js";
import { findJobs } from "./_setup.js";

const SITE = "https://reminth.pages.dev";
// The version the #announcements text is about. Change it together with that text on each release.
export const RELEASE = "1.8.0";
const RED = 0xe53935;
const ch = (jobs, j, fallback) => (jobs[j] ? `<#${jobs[j].id}>` : fallback);

export function messages(jobs) {
  return [
    {
      job: "rules",
      embeds: [
        {
          title: "Server Rules",
          color: RED,
          description: [
            "**1.** Be respectful. No harassment, hate speech, slurs or threats.",
            "**2.** No spam. No flooding, mass pings or self-promotion. Invite links to other servers are blocked.",
            "**3.** Keep it clean. No NSFW, gore or shock content, including in names and profile pictures.",
            "**4.** No cheating. No hacked clients, cheat links, or selling and sharing accounts.",
            `**5.** Use the right channel. Questions go to a ticket in ${ch(jobs, "support", "#support")}, bot commands go to ${ch(jobs, "commands", "#commands")}.`,
            "**6.** No impersonation of staff, Reminth or anyone else.",
            "**7.** Follow Discord's [Terms of Service](https://discord.com/terms) and [Community Guidelines](https://discord.com/guidelines).",
            `**8.** Staff decisions are final. If you think a decision was wrong, open a ticket in ${ch(jobs, "support", "#support")}.`,
          ].join("\n\n"),
          footer: { text: "Breaking the rules can lead to a warning, a timeout, a kick or a ban, depending on how serious it is." },
        },
      ],
    },
    {
      job: "announcements",
      keep: true,
      release: RELEASE,
      embeds: [
        {
          title: "Welcome to the Reminth Launcher server",
          color: RED,
          description:
            "Reminth is a free Minecraft launcher for Windows, built for PvP and performance. This is its home on Discord: news, support, and the people who use it.\n\n" +
            `**Reminth ${RELEASE} is out now: the Night update**\n` +
            "- **A whole new look:** black and white under a pixel night sky, with the new Reminth icon.\n" +
            "- **A new Home:** one big PLAY, your stats, your own PvP tiers and Quick join for your last worlds and servers.\n" +
            "- **Every page redone** in the same style.\n\n" +
            "**What you get with Reminth**\n" +
            "- Press **G** in game for the Reminth Mods Panel: over 240 built-in features like FPS, keystrokes, armor status, potion timers, zoom, a custom crosshair and on-screen text for streamers\n" +
            "- Sodium, Lithium and other performance mods set up for you on Fabric and Quilt\n" +
            "- Your mods are checked before the game starts, so you don't wait two minutes for an \"incompatible mods\" screen\n" +
            "- Every version from 1.20.1 to 26.3\n\n" +
            `**Download:** ${SITE}`,
        },
      ],
    },
    {
      job: "updates",
      keep: true,
      embeds: [
        {
          title: "Reminth updates",
          color: RED,
          description:
            "Every new version of Reminth is posted here automatically, the moment it's released, with a list of what changed.\n\n" +
            "Reminth updates itself, so you don't have to download anything again. Just restart the launcher when it tells you an update is ready.\n\n" +
            "Want a ping for every new version? Pick **🚀 Launcher Updates** in **Channels & Roles** at the top of the channel list.",
        },
      ],
    },
    {
      job: "socials",
      embeds: [
        {
          title: "Follow Reminth",
          color: RED,
          description:
            "News, clips and sneak peeks of what's coming next.\n\n" +
            "**X (Twitter):** https://x.com/reminthsupport\n\n" +
            "More platforms are coming soon. Pick their roles in **Channels & Roles** to get pinged when we post.",
        },
      ],
    },
    {
      job: "faq",
      embeds: [
        {
          title: "Frequently asked questions",
          color: RED,
          description: [
            "**What is Reminth?**\nA free Minecraft: Java Edition launcher for Windows 10 and 11. It sets up Minecraft, mod loaders and Java for you, comes with performance mods and its own in-game panel with over 240 features.",
            "**Is it free?**\nYes.",
            "**Does Reminth see my Microsoft password?**\nNo. You sign in on Microsoft's own page (microsoft.com/link). Reminth never sees your password.",
            "**Which Minecraft versions and mod loaders does it support?**\nFabric, Quilt, Forge and NeoForge. The Reminth Mods Panel works on every version from 1.20.1 to 26.3.",
            "**Does it work on Mac or Linux?**\nNot yet. Reminth is Windows only for now.",
            "**How do I open the Reminth Mods Panel?**\nPress **G** in game. You can change the key in Minecraft's Controls settings.",
            "**What is the Tier Tagger?**\nIt shows players' PvP tiers from MCTiers, PvPTiers and SubTiers next to their names. It's on by default and you can change it in the panel under Visual. Type `/tiers <name>` in game to see all of a player's tiers.",
            "**Can I get banned for using Reminth?**\nReminth's own features only show information about you or change how the game looks. Every server has its own rules though, and Reminth gives you a heads-up when a server's rules ban one of your mods. You're responsible for following the rules of the servers you play on.",
            "**Do I need a Reminth account?**\nYes. Reminth asks you to make one the first time you open it. It's free, and you can use Discord or email. The same account works on the website.",
            `**How do I get the Launcher Player role?**\nSign in to Reminth with Discord, then type \`/verify\` in ${ch(jobs, "commands", "#commands")}.`,
            "**How do I update Reminth?**\nYou don't need to. Reminth updates itself and tells you when a new version is ready.",
            `**I found a bug or need help.**\nOpen a ticket in ${ch(jobs, "support", "#support")} and we'll help you there.`,
          ].join("\n\n"),
        },
      ],
    },
    {
      job: "readfirst",
      embeds: [
        {
          title: "Support & Applications",
          color: RED,
          description: [
            `**🎫 Need help?**\nOpen a support ticket and a member of the team will help you as soon as possible. Check ${ch(jobs, "faq", "#faq")} first, your question might already be answered there.`,
            "When you open a ticket, tell us:\n- What happened, and what you expected to happen\n- Your Minecraft version and mod loader\n- A screenshot, if you can",
            "**📝 Want to join the team?**\nWe're looking for people who want to help the Reminth community grow, keep the server a good place and help other players. Answer honestly and in your own words. Applications copied from somewhere else are declined.",
            "Pick what you need below.",
          ].join("\n\n"),
        },
      ],
    },
  ];
}


/** A short fingerprint of a message's content, to tell whether it changed since it was posted. */
export function fingerprint(body) {
  let h = 0x811c9dc5;
  for (const c of JSON.stringify(body)) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return "f" + h.toString(36);
}

/**
 * What to do with one channel's message. saved = "webhookId:messageId:fingerprint" of the last post (before 15 Oct
 * 2026 it was "webhookId:messageId" or "webhookId:messageId:<release>"). ->
 *  "post"    post a new message (nothing posted yet, or a keep-message whose text changed - the old one stays)
 *  "skip"    a keep-message whose text hasn't changed: it is already there, unedited
 *  "adopt"   a keep-message saved the old way and not about a new release: treat it as up to date (no post)
 *  "replace" delete the old message, then post the same info as a new one
 */
export function savedPlan(saved, m, print) {
  const [hookId, msgId, third] = (saved || "").split(":");
  if (!saved || !msgId) return { action: "post" };
  if (!m.keep) return { action: "replace", hookId, msgId };
  if (third === print) return { action: "skip" };
  if (third && third.startsWith("f")) return { action: "post" };
  // saved before fingerprints: only a new release is worth a new post
  return m.release && third !== m.release ? { action: "post" } : { action: "adopt", hookId, msgId };
}

/** Posts one channel's message per call. -> {done, log[], next} */
export async function postMessages(env, index = 0) {
  const g = String(env.DISCORD_GUILD_ID);
  const chans = await dapi(env, "GET", `/guilds/${g}/channels`);
  if (!chans.ok) return { done: true, log: [], problem: `Reading the channels: ${chans.status}` };
  const jobs = findJobs(chans.data || []);
  const list = messages(jobs);
  const m = list[index];
  if (!m) return { done: true, log: [] };
  const next = index + 1 < list.length ? index + 1 : null;
  const channel = jobs[m.job];
  if (!channel) return { next, log: [`#${m.job}: channel not found - skipped`] };
  const body = { username: "Reminth", avatar_url: `${SITE}/favicon.png`, embeds: m.embeds, allowed_mentions: { parse: [] } };
  const print = fingerprint(body);
  const key = `msg:${m.job}`;
  const plan = savedPlan(await getConfig(env, key), m, print);
  if (plan.action === "skip") return { next, log: [`#${channel.name}: no change - the message stays as it is`] };
  if (plan.action === "adopt") {
    await setConfig(env, key, `${plan.hookId}:${plan.msgId}:${print}`);
    return { next, log: [`#${channel.name}: no change - the message stays as it is`] };
  }
  // the "Reminth" webhook of this channel (made once, reused)
  const hooks = await dapi(env, "GET", `/channels/${channel.id}/webhooks`);
  let hook = hooks.ok ? (hooks.data || []).find((h) => h.name === "Reminth" && h.token) : null;
  if (!hook) {
    const r = await dapi(env, "POST", `/channels/${channel.id}/webhooks`, { name: "Reminth" }, "Reminth: channel messages");
    if (!r.ok) return { next: null, log: [], problem: `Making the webhook in #${channel.name}: ${r.status}${r.data && r.data.message ? " " + r.data.message : ""}` };
    hook = r.data;
  }
  if (plan.action === "replace") {
    // the webhook's own message; one from an older webhook is deleted by the bot (404 = already gone)
    const d =
      plan.hookId === hook.id
        ? await dapi(env, "DELETE", `/webhooks/${hook.id}/${hook.token}/messages/${plan.msgId}`)
        : await dapi(env, "DELETE", `/channels/${channel.id}/messages/${plan.msgId}`, undefined, "Reminth: channel message posted again");
    if (d.status === 429) return { next: index, log: [], waitSeconds: Math.ceil(Number((d.data && d.data.retry_after) || 5)) };
    if (!d.ok && d.status !== 404) return { next: null, log: [], problem: `Deleting the old message in #${channel.name}: ${d.status}${d.data && d.data.message ? " " + d.data.message : ""}` };
    // gone: forget it, so a retry after a failed post below just posts
    await setConfig(env, key, "");
  }
  const r = await dapi(env, "POST", `/webhooks/${hook.id}/${hook.token}?wait=true`, body);
  if (r.status === 429) return { next: index, log: [], waitSeconds: Math.ceil(Number((r.data && r.data.retry_after) || 5)) };
  if (!r.ok) return { next: null, log: [], problem: `Posting in #${channel.name}: ${r.status}${r.data && r.data.message ? " " + r.data.message : ""}` };
  await setConfig(env, key, `${hook.id}:${r.data.id}:${print}`);
  const what = plan.action === "replace" ? "old message deleted, the same info posted as a new message" : m.keep ? "new message posted (the old ones stay)" : "message posted";
  return { next, log: [`#${channel.name}: ${what}`] };
}
