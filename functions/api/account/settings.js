// POST /api/account/settings {discordPull: true|false} - whether the owner's "add everyone to the Reminth Discord
// server" button may add this player. -> {user}
import { accountView, configured, currentUser, db, json, notConfigured, sameOrigin } from "../../_lib.js";

export async function onRequestPost({ request, env }) {
  if (!configured(env)) return notConfigured();
  const me = await currentUser(env, request);
  if (!me) return json({ error: "signed_out" }, 401);
  if (me.viaCookie && !sameOrigin(request)) return json({ error: "forbidden" }, 403);
  let body = {};
  try {
    body = await request.json();
  } catch {
    // no body
  }
  if (typeof body.discordPull !== "boolean") return json({ error: "bad_request" }, 400);
  await (await db(env)).prepare("UPDATE accounts SET discord_pull = ? WHERE id = ?").bind(body.discordPull ? 1 : 0, me.user.id).run();
  return json({ user: await accountView(env, me.user.id) });
}
