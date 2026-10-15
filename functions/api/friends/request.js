// POST /api/friends/request {code} -> the Friends card. Asks the account with that friend code to be friends; when they
// had already asked you, you're friends at once.
import { allowTry, configured, currentUser, json, notConfigured, now, sameOrigin } from "../../_lib.js";
import { FRIEND_LIMIT, friendsDb, friendsUser, friendsView, normalizeCode, pair, readBody } from "../../_friends.js";

export async function onRequestPost({ request, env }) {
  if (!configured(env)) return notConfigured();
  const u = await friendsUser(env, request, currentUser, sameOrigin, true);
  if (u.response) return u.response;
  const me = u.id;
  // 30 tries an hour: guessing codes gets nowhere
  if (!(await allowTry(env, "friend-request:" + me, 30, 3600))) return json({ error: "slow_down", message: "Too many tries. Wait a bit and try again." }, 429);
  const code = normalizeCode((await readBody(request)).code);
  if (!code) return json({ error: "bad_code", message: "That isn't a friend code. It looks like K7QX-2MPA." }, 400);
  const DB = await friendsDb(env);
  const them = await DB.prepare("SELECT account_id FROM friend_codes WHERE code = ?").bind(code).first();
  if (!them) return json({ error: "not_found", message: "No one has that friend code." }, 404);
  const other = them.account_id;
  if (other === me) return json({ error: "self", message: "That's your own code." }, 400);
  const [a, b] = pair(me, other);
  const row = await DB.prepare("SELECT status, requested_by FROM friends WHERE a = ? AND b = ?").bind(a, b).first();
  if (row && row.status === "friends") return json({ error: "already", message: "You're already friends." }, 409);
  if (row && row.requested_by === me) return json({ error: "already_asked", message: "You already asked. They need to accept." }, 409);
  if (row) {
    // they asked you first: asking back accepts
    await DB.prepare("UPDATE friends SET status = 'friends', created_at = ? WHERE a = ? AND b = ?").bind(now(), a, b).run();
  } else {
    const count = async (id) => (await DB.prepare("SELECT COUNT(*) AS n FROM friends WHERE a = ? OR b = ?").bind(id, id).first()).n;
    if ((await count(me)) >= FRIEND_LIMIT) return json({ error: "limit", message: `You can have up to ${FRIEND_LIMIT} friends and requests.` }, 409);
    if ((await count(other)) >= FRIEND_LIMIT) return json({ error: "their_limit", message: "They can't take more friend requests." }, 409);
    await DB.prepare("INSERT INTO friends (a, b, status, requested_by, created_at) VALUES (?, ?, 'pending', ?, ?)").bind(a, b, me, now()).run();
  }
  return json(await friendsView(env, me));
}
