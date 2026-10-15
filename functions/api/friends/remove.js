// POST /api/friends/remove {id} -> the Friends card. Removes a friend, or takes back a request you sent.
import { configured, currentUser, json, notConfigured, sameOrigin } from "../../_lib.js";
import { friendsDb, friendsUser, friendsView, pair, readBody } from "../../_friends.js";

export async function onRequestPost({ request, env }) {
  if (!configured(env)) return notConfigured();
  const u = await friendsUser(env, request, currentUser, sameOrigin, true);
  if (u.response) return u.response;
  const me = u.id;
  const body = await readBody(request);
  const other = typeof body.id === "string" ? body.id.slice(0, 64) : "";
  if (!other || other === me) return json({ error: "bad_id" }, 400);
  const DB = await friendsDb(env);
  const [a, b] = pair(me, other);
  await DB.prepare("DELETE FROM friends WHERE a = ? AND b = ?").bind(a, b).run();
  return json(await friendsView(env, me));
}
