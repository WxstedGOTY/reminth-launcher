// GET /api/me -> {user} for a signed-in request (app: Authorization: Bearer; website: the session cookie), else 401.
import { configured, currentUser, json, notConfigured, publicUser } from "../_lib.js";

export async function onRequestGet({ request, env }) {
  if (!configured(env)) return notConfigured();
  const me = await currentUser(env, request);
  if (!me) return json({ error: "signed_out" }, 401);
  return json({ user: publicUser(me.user) });
}
