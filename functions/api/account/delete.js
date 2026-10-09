// POST /api/account/delete {confirm: "DELETE"} - deletes the account and every session of it, for good.
import { configured, cookie, currentUser, db, json, notConfigured, sameOrigin } from "../../_lib.js";

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
  await DB.batch([
    DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(me.user.id),
    DB.prepare("DELETE FROM login_codes WHERE user_id = ?").bind(me.user.id),
    DB.prepare("DELETE FROM users WHERE id = ?").bind(me.user.id),
  ]);
  return json({ ok: true }, 200, { "set-cookie": cookie("rm_session", "", 0) });
}
