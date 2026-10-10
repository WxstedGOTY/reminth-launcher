// POST /api/discord/interactions - where Discord sends every slash command, form and button of the Reminth bot.
// Set as "Interactions Endpoint URL" in the Discord developer portal (General Information). Requests that aren't
// signed by Discord (DISCORD_PUBLIC_KEY) are refused - Discord itself tests that when the address is saved.
import { configured, json } from "../../_lib.js";
import { handleInteraction, verifyDiscordRequest } from "../../_bot.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DISCORD_PUBLIC_KEY) return new Response("The Reminth bot isn't set up yet.", { status: 503 });
  const body = await request.text();
  const ok = await verifyDiscordRequest(env.DISCORD_PUBLIC_KEY, request.headers.get("x-signature-ed25519"), request.headers.get("x-signature-timestamp"), body);
  if (!ok) return new Response("Bad signature.", { status: 401 });
  let i;
  try {
    i = JSON.parse(body);
  } catch {
    return new Response("Bad request.", { status: 400 });
  }
  if (i.type === 1) return json({ type: 1 });
  if (!configured(env) || !env.DISCORD_BOT_TOKEN) return json({ type: 4, data: { content: "The bot isn't fully set up yet.", flags: 64 } });
  try {
    return json(await handleInteraction(env, i, { waitUntil: (p) => context.waitUntil(p) }));
  } catch (e) {
    console.error("bot command failed", i && i.data && i.data.name, e && e.stack);
    return json({ type: 4, data: { content: "Something went wrong on my side. Try again in a moment.", flags: 64 } });
  }
}
