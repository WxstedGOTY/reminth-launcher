// POST /api/admin/discord-build {step} - owner only: one step of "Build my Discord server" (_build.js).
// GET  /api/admin/discord-build        - owner only: the #updates webhook address the builder made (for GitHub).
import { configured, currentUser, identitiesOf, isAdmin, json, notConfigured, sameOrigin } from "../../_lib.js";
import { buildStep, STEP_NAMES } from "../../_build.js";
import { getConfig } from "../../_bot.js";

async function owner(env, request) {
  if (!configured(env)) return notConfigured();
  const me = await currentUser(env, request);
  if (!me) return json({ error: "signed_out" }, 401);
  if (!isAdmin(env, await identitiesOf(env, me.user.id))) return json({ error: "forbidden" }, 403);
  if (me.viaCookie && !sameOrigin(request)) return json({ error: "forbidden" }, 403);
  const missing = ["DISCORD_CLIENT_ID", "DISCORD_BOT_TOKEN", "DISCORD_GUILD_ID", "DISCORD_PUBLIC_KEY"].filter((k) => !env[k]);
  if (missing.length) return json({ error: "setup", missing }, 400);
  return null;
}

export async function onRequestPost({ request, env }) {
  const no = await owner(env, request);
  if (no) return no;
  let body = {};
  try {
    body = await request.json();
  } catch {
    // no body
  }
  const step = Math.max(0, Math.min(STEP_NAMES.length - 1, Number(body.step) || 0));
  return json({ ...(await buildStep(env, step, new URL(request.url).origin)), steps: STEP_NAMES.length });
}

export async function onRequestGet({ request, env }) {
  const no = await owner(env, request);
  if (no) return no;
  return json({ webhook: await getConfig(env, "updates_webhook") });
}
