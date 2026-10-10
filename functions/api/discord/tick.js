// POST /api/discord/tick - the Reminth bot's every-minute check (_tick.js). Called by the reminth-cron Worker
// (workers/cron). Safe to call by anyone: it does its work at most once every 45 seconds.
import { json } from "../../_lib.js";
import { getConfig, setConfig } from "../../_bot.js";
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
  return json({ ...out, gateway });
}
