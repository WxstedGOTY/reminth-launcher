// GET /api/friends (app: Bearer; website: cookie) -> the Friends card: {code, appearOffline, friends[], incoming[], outgoing[]}
import { configured, currentUser, json, notConfigured, sameOrigin } from "../../_lib.js";
import { friendsUser, friendsView } from "../../_friends.js";

export async function onRequestGet({ request, env }) {
  if (!configured(env)) return notConfigured();
  const u = await friendsUser(env, request, currentUser, sameOrigin, false);
  if (u.response) return u.response;
  return json(await friendsView(env, u.id));
}
