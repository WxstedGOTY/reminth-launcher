// Owner tools - only for the account signed in with the Discord id in ADMIN_DISCORD_ID.
// GET  /api/admin/discord           -> {setup: {...}, accounts, newThisWeek, signedInThisWeek, minecraft, discord, allowed, inServer}
// POST /api/admin/discord {after}   -> adds up to 10 players who signed in with Discord to DISCORD_GUILD_ID (_pull.js):
//                                      {added, already, failed, next, done, waitSeconds}
// The account page calls POST again with `next` until done.
import { db, json, ownerOnly } from "../../_lib.js";
import { pullBatch, pullSetup } from "../../_pull.js";

async function admin(env, request) {
  const no = await ownerOnly(env, request);
  return no ? { res: no } : {};
}

const setup = (env) => ({ ...pullSetup(env), bot_commands: Boolean(env.DISCORD_PUBLIC_KEY && env.DISCORD_BOT_TOKEN && env.DISCORD_GUILD_ID) });

export async function onRequestGet({ request, env }) {
  const { res } = await admin(env, request);
  if (res) return res;
  const DB = await db(env);
  const one = async (sql, ...args) => ((await DB.prepare(sql).bind(...args).first()) || {}).n || 0;
  const weekAgo = Math.floor(Date.now() / 1000) - 7 * 86400;
  return json({
    setup: setup(env),
    accounts: await one("SELECT COUNT(*) AS n FROM accounts"),
    newThisWeek: await one("SELECT COUNT(*) AS n FROM accounts WHERE created_at > ?", weekAgo),
    signedInThisWeek: await one("SELECT COUNT(*) AS n FROM accounts WHERE last_login > ?", weekAgo),
    minecraft: await one("SELECT COUNT(*) AS n FROM accounts WHERE mc_signed_in_at IS NOT NULL"),
    discord: await one("SELECT COUNT(*) AS n FROM identities WHERE provider = 'discord'"),
    allowed: await one(
      "SELECT COUNT(*) AS n FROM identities JOIN accounts ON accounts.id = identities.account_id WHERE provider = 'discord' AND secret IS NOT NULL AND discord_pull = 1"
    ),
    inServer: await one("SELECT COUNT(*) AS n FROM identities WHERE provider = 'discord' AND guild_joined_at IS NOT NULL"),
  });
}

export async function onRequestPost({ request, env }) {
  const { res } = await admin(env, request);
  if (res) return res;
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID) return json({ error: "setup", setup: setup(env) }, 400);
  let body = {};
  try {
    body = await request.json();
  } catch {
    // no body
  }
  return json(await pullBatch(env, body.after));
}
