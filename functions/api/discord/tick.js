// POST /api/discord/tick - the Reminth bot's every-minute check (_tick.js). Called by the reminth-cron Worker
// (workers/cron). Safe to call by anyone: it does its work at most once every 45 seconds.
import { json } from "../../_lib.js";
import { dapi, getConfig, setConfig } from "../../_bot.js";
import { tick } from "../../_tick.js";

export async function onRequestPost({ request, env }) {
  // ?force=1 skips the 45 second wait - only on a local test run (DISCORD_API points at a stand-in)
  const force = Boolean(env.DISCORD_API) && new URL(request.url).searchParams.get("force") === "1";
  // the reminth-cron Worker reports whether the bot's always-on connection is up (no secrets in it)
  let body = {};
  try {
    body = await request.json();
  } catch {
    // no body
  }
  if (body && body.gateway && typeof body.gateway === "object" && env.DB) {
    const g = body.gateway;
    await setConfig(env, "gateway:status", JSON.stringify({ connected: Boolean(g.connected), since: Number(g.since) || null, lastError: g.lastError ? String(g.lastError).slice(0, 200) : null, hasToken: Boolean(g.hasToken), at: Date.now() }));
  }
  const out = await tick(env, { force });
  let gateway = null;
  try {
    gateway = env.DB ? JSON.parse((await getConfig(env, "gateway:status")) || "null") : null;
  } catch {
    gateway = null;
  }
  // which bot settings exist (ids only, nothing secret) - to see whether "Set up my server" finished
  const has = async (k) => Boolean(env.DB && (await getConfig(env, k)));
  const settings = { modlog: await has("modlog_channel"), updates: await has("updates_channel"), updatesRole: await has("updates_role"), playerRole: await has("player_role"), socials: await has("socials_channel") };
  // which AutoMod rules are on (names only)
  if (env.DISCORD_BOT_TOKEN && env.DISCORD_GUILD_ID && new URL(request.url).searchParams.get("automod") === "1") {
    const r = await dapi(env, "GET", `/guilds/${env.DISCORD_GUILD_ID}/auto-moderation/rules`);
    settings.automod = r.ok ? (r.data || []).map((x) => `${x.enabled ? "on" : "off"}: ${x.name} (type ${x.trigger_type})`) : `error ${r.status}`;
  }
  return json({ ...out, gateway, settings });
}
