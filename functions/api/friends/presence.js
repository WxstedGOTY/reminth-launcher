// POST /api/friends/presence {state: "online"|"playing"|"offline", server, mcName, appearOffline, list} -> the Friends
// card (or {ok} with list: false). The launcher says what it's doing every couple of minutes; only accepted friends see
// it. Written only when something changed or the last write is 2 minutes old (D1 writes are counted).
import { configured, currentUser, json, notConfigured, now, sameOrigin } from "../../_lib.js";
import { cleanMcName, cleanServer, friendsDb, friendsUser, friendsView, readBody } from "../../_friends.js";

export async function onRequestPost({ request, env }) {
  if (!configured(env)) return notConfigured();
  const u = await friendsUser(env, request, currentUser, sameOrigin, true);
  if (u.response) return u.response;
  const me = u.id;
  const body = await readBody(request);
  const state = ["online", "playing", "offline"].includes(body.state) ? body.state : "online";
  const server = state === "playing" ? cleanServer(body.server) : null;
  const mcName = cleanMcName(body.mcName);
  const DB = await friendsDb(env);
  const t = now();
  const old = await DB.prepare("SELECT state, server, mc_name, hidden, updated_at FROM presence WHERE account_id = ?").bind(me).first();
  // "Appear offline" is the player's choice: kept until they change it (the launcher's reports don't repeat it)
  const hidden = typeof body.appearOffline === "boolean" ? (body.appearOffline ? 1 : 0) : old ? old.hidden : 0;
  const same = old && old.state === state && (old.server || null) === server && (old.mc_name || null) === mcName && old.hidden === hidden;
  if (!same || t - old.updated_at >= 120) {
    await DB.prepare("INSERT OR REPLACE INTO presence (account_id, state, server, mc_name, hidden, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(me, state, server, mcName, hidden, t)
      .run();
  }
  if (body.list === false) return json({ ok: true });
  return json(await friendsView(env, me));
}
