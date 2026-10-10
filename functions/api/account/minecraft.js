// POST /api/account/minecraft (app, Authorization: Bearer) -> {ok}: this account has signed in to Minecraft in the
// launcher. Stores only WHEN that first happened - no Minecraft name, no Microsoft data. Used for the owner's count.
import { configured, currentUser, db, json, notConfigured, now } from "../../_lib.js";

export async function onRequestPost({ request, env }) {
  if (!configured(env)) return notConfigured();
  const me = await currentUser(env, request);
  if (!me) return json({ error: "signed_out" }, 401);
  if (me.viaCookie) return json({ error: "app_only" }, 403); // only the launcher says this
  const DB = await db(env);
  await DB.prepare("UPDATE accounts SET mc_signed_in_at = ? WHERE id = ? AND mc_signed_in_at IS NULL").bind(now(), me.user.id).run();
  return json({ ok: true });
}
