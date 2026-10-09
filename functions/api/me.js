// GET /api/me -> {user} for a signed-in request (app: Authorization: Bearer; website: the session cookie), else 401.
import { accountView, configured, currentUser, json, notConfigured } from "../_lib.js";

export async function onRequestGet({ request, env }) {
  if (!configured(env)) return notConfigured();
  const me = await currentUser(env, request);
  if (!me) return json({ error: "signed_out" }, 401);
  return json({ user: await accountView(env, me.user.id) });
}
