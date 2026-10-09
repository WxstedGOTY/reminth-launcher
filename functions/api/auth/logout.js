// POST /api/auth/logout - ends this session only (the app's and the website's sessions are separate).
import { configured, cookie, currentUser, db, json, notConfigured, sameOrigin } from "../../_lib.js";

export async function onRequestPost({ request, env }) {
  if (!configured(env)) return notConfigured();
  const clear = { "set-cookie": cookie("rm_session", "", 0) };
  const me = await currentUser(env, request);
  if (!me) return json({ ok: true }, 200, clear);
  if (me.viaCookie && !sameOrigin(request)) return json({ error: "forbidden" }, 403);
  await (await db(env)).prepare("DELETE FROM sessions WHERE token_hash = ?").bind(me.tokenHash).run();
  return json({ ok: true }, 200, clear);
}
