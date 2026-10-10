// The channel messages of the Reminth Discord server (approved texts: discord/texts.md). Posted through a webhook
// called "Reminth" with the Reminth logo, one message per channel. Posting again EDITS the message that is already
// there (so a fixed typo doesn't make a second message). Owner tools -> "Post the channel messages".
import { dapi, getConfig, setConfig } from "./_bot.js";
import { findJobs } from "./_setup.js";

const SITE = "https://reminth.pages.dev";
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
      embeds: [
        {
          title: "Welcome to the Reminth Launcher server",
          color: RED,
          description:
            "Reminth is a free Minecraft launcher for Windows, built for PvP and performance. This is its home on Discord: news, support, and the people who use it.\n\n" +
            "**Reminth 1.7.1 is out now**\n" +
            "- **Tier Tagger:** see players' PvP tiers from MCTiers, PvPTiers and SubTiers above their heads and in the tab list, in every gamemode. Type `/tiers <name>` in game for all of a player's tiers.\n" +
            "- **Reminth accounts:** sign in with Discord or email. The same account works on the website.\n" +
            "- **Pick your look:** the whole launcher in blue or orange.\n\n" +
            "**What you get with Reminth**\n" +
            "- Press **G** in game for the Reminth Mods Panel: about 145 built-in features like FPS, keystrokes, armor status, potion timers, zoom, hit markers and a combo counter\n" +
            "- Sodium, Lithium and other performance mods set up for you on Fabric and Quilt\n" +
            "- Your mods are checked before the game starts, so you don't wait two minutes for an \"incompatible mods\" screen\n" +
            "- Every version from 1.20.1 to 26.3\n\n" +
            `**Download:** ${SITE}`,
        },
      ],
    },
    {
      job: "updates",
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
            "**What is Reminth?**\nA free Minecraft: Java Edition launcher for Windows 10 and 11. It sets up Minecraft, mod loaders and Java for you, comes with performance mods and its own in-game panel with about 145 features.",
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
  ];
}

/** Posts (or edits) one message per call. -> {done, log[], next} */
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
  // the "Reminth" webhook of this channel (made once, reused)
  const hooks = await dapi(env, "GET", `/channels/${channel.id}/webhooks`);
  let hook = hooks.ok ? (hooks.data || []).find((h) => h.name === "Reminth" && h.token) : null;
  if (!hook) {
    const r = await dapi(env, "POST", `/channels/${channel.id}/webhooks`, { name: "Reminth" }, "Reminth: channel messages");
    if (!r.ok) return { next: null, log: [], problem: `Making the webhook in #${channel.name}: ${r.status}${r.data && r.data.message ? " " + r.data.message : ""}` };
    hook = r.data;
  }
  const body = { username: "Reminth", avatar_url: `${SITE}/favicon.png`, embeds: m.embeds, allowed_mentions: { parse: [] } };
  const key = `msg:${m.job}`;
  const saved = await getConfig(env, key);
  const [hookId, msgId] = (saved || "").split(":");
  if (saved && hookId === hook.id) {
    const e = await dapi(env, "PATCH", `/webhooks/${hook.id}/${hook.token}/messages/${msgId}`, body);
    if (e.ok) return { next, log: [`#${channel.name}: message updated`] };
    // deleted by hand - post it again below
  }
  const r = await dapi(env, "POST", `/webhooks/${hook.id}/${hook.token}?wait=true`, body);
  if (r.status === 429) return { next: index, log: [], waitSeconds: Math.ceil(Number((r.data && r.data.retry_after) || 5)) };
  if (!r.ok) return { next: null, log: [], problem: `Posting in #${channel.name}: ${r.status}${r.data && r.data.message ? " " + r.data.message : ""}` };
  await setConfig(env, key, `${hook.id}:${r.data.id}`);
  return { next, log: [`#${channel.name}: message posted`] };
}
