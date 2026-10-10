// POST /api/discord/tick - the Reminth bot's every-minute check (_tick.js). Called by the reminth-cron Worker
// (workers/cron). Safe to call by anyone: it does its work at most once every 45 seconds.
import { json } from "../../_lib.js";
import { tick } from "../../_tick.js";

export async function onRequestPost({ request, env }) {
  // ?force=1 skips the 45 second wait - only on a local test run (DISCORD_API points at a stand-in)
  const force = Boolean(env.DISCORD_API) && new URL(request.url).searchParams.get("force") === "1";
  return json(await tick(env, { force }));
}
