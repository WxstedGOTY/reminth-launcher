// POST /api/account/delete {confirm: "DELETE"} - deletes the account, its sign-in methods and every session, for good.
// A kept Discord permission is handed back to Discord too (best effort).
import { configured, cookie, currentUser, db, json, notConfigured, sameOrigin, unseal } from "../../_lib.js";

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
  if (!body || body.confirm !== "DELETE") return json({ error: "confirm", message: 'Send {"confirm":"DELETE"}.' }, 400);
  const DB = await db(env);
  const id = me.user.id;
  const discord = await DB.prepare("SELECT secret FROM identities WHERE account_id = ? AND provider = 'discord'").bind(id).first();
  await DB.batch([
    DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
    DB.prepare("DELETE FROM login_codes WHERE user_id = ?").bind(id),
    DB.prepare("DELETE FROM identities WHERE account_id = ?").bind(id),
    DB.prepare("DELETE FROM accounts WHERE id = ?").bind(id),
  ]);
  const refresh = discord && discord.secret ? await unseal(env, discord.secret) : null;
  if (refresh && env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET) {
    await fetch(`${env.DISCORD_API || "https://discord.com/api"}/oauth2/token/revoke`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refresh, token_type_hint: "refresh_token", client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET }),
    }).catch(() => {});
  }
  return json({ ok: true }, 200, { "set-cookie": cookie("rm_session", "", 0) });
}
