// POST /api/friends/respond {id, accept: true|false} -> the Friends card. Accepts or declines a request someone sent you.
import { configured, currentUser, json, notConfigured, now, sameOrigin } from "../../_lib.js";
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
  const row = await DB.prepare("SELECT status, requested_by FROM friends WHERE a = ? AND b = ?").bind(a, b).first();
  // only a request THEY sent can be answered here
  if (!row || row.status !== "pending" || row.requested_by === me) return json({ error: "no_request", message: "That request isn't there any more." }, 404);
  if (body.accept === true) await DB.prepare("UPDATE friends SET status = 'friends', created_at = ? WHERE a = ? AND b = ?").bind(now(), a, b).run();
  else await DB.prepare("DELETE FROM friends WHERE a = ? AND b = ?").bind(a, b).run();
  return json(await friendsView(env, me));
}
