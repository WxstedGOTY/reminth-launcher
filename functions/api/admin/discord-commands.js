// POST /api/admin/discord-commands - owner only: installs (or updates) the bot's slash commands in the Reminth server.
// The account page's Owner tools has the button. Run again after a bot update adds commands.
import { json, ownerOnly } from "../../_lib.js";
import { COMMANDS, dapi } from "../../_bot.js";

export async function onRequestPost({ request, env }) {
  const no = await ownerOnly(env, request);
  if (no) return no;
  const missing = ["DISCORD_CLIENT_ID", "DISCORD_BOT_TOKEN", "DISCORD_GUILD_ID", "DISCORD_PUBLIC_KEY"].filter((k) => !env[k]);
  if (missing.length) return json({ error: "setup", missing }, 400);
  const r = await dapi(env, "PUT", `/applications/${env.DISCORD_CLIENT_ID}/guilds/${env.DISCORD_GUILD_ID}/commands`, COMMANDS);
  if (!r.ok) return json({ error: "discord", status: r.status, message: (r.data && r.data.message) || "" }, 502);
  return json({ ok: true, commands: COMMANDS.length });
}
