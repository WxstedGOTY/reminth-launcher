// Owner tools - only for the account signed in with the Discord id in ADMIN_DISCORD_ID.
// GET  /api/admin/discord           -> {setup: {...}, accounts, discord, allowed, inServer}
// POST /api/admin/discord {after}   -> adds up to 10 players (signed in with Discord, who allow it) to DISCORD_GUILD_ID
//                                      with the bot DISCORD_BOT_TOKEN: {added, already, failed, next, done, waitSeconds}
// The account page calls POST again with `next` until done. Discord's rule: the bot must be in the server with the
// "Create Invite" permission; Discord answers 201 (added) or 204 (was already in).
import { configured, currentUser, db, identitiesOf, isAdmin, json, notConfigured, now, sameOrigin, seal, unseal } from "../../_lib.js";

const BATCH = 10;

async function admin(env, request) {
  if (!configured(env)) return { res: notConfigured() };
  const me = await currentUser(env, request);
  if (!me) return { res: json({ error: "signed_out" }, 401) };
  if (!isAdmin(env, await identitiesOf(env, me.user.id))) return { res: json({ error: "forbidden" }, 403) };
  if (me.viaCookie && !sameOrigin(request)) return { res: json({ error: "forbidden" }, 403) };
  return { me };
}

const setup = (env) => ({ bot: Boolean(env.DISCORD_BOT_TOKEN), server: Boolean(env.DISCORD_GUILD_ID) });

export async function onRequestGet({ request, env }) {
  const { res } = await admin(env, request);
  if (res) return res;
  const DB = await db(env);
  const one = async (sql) => ((await DB.prepare(sql).first()) || {}).n || 0;
  return json({
    setup: setup(env),
    accounts: await one("SELECT COUNT(*) AS n FROM accounts"),
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
  const after = /^\d{1,25}$/.test(String(body.after || "")) ? String(body.after) : "";
  const api = env.DISCORD_API || "https://discord.com/api";
  const DB = await db(env);
  const rows =
    (
      await DB.prepare(
        `SELECT identities.subject, identities.secret FROM identities JOIN accounts ON accounts.id = identities.account_id
         WHERE provider = 'discord' AND secret IS NOT NULL AND discord_pull = 1 AND subject > ?
         ORDER BY subject LIMIT ?`
      )
        .bind(after, BATCH)
        .all()
    ).results || [];

  const out = { added: 0, already: 0, failed: 0, problems: [], next: after, done: false, waitSeconds: 0 };
  for (const row of rows) {
    // a fresh access token from the kept refresh token (Discord hands out a new refresh token each time - kept too)
    const refresh = await unseal(env, row.secret);
    let access = null;
    if (refresh) {
      const t = await fetch(`${api}/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: refresh }),
      });
      if (t.status === 429) return json({ ...out, waitSeconds: await retryAfter(t) });
      if (t.ok) {
        const tok = await t.json();
        access = tok.access_token;
        if (tok.refresh_token) await DB.prepare("UPDATE identities SET secret = ? WHERE provider = 'discord' AND subject = ?").bind(await seal(env, tok.refresh_token), row.subject).run();
      } else {
        // the player took Reminth's permission back in Discord: forget the dead token
        await DB.prepare("UPDATE identities SET secret = NULL WHERE provider = 'discord' AND subject = ?").bind(row.subject).run();
      }
    }
    if (!access) {
      out.failed++;
      out.next = row.subject;
      continue;
    }
    const r = await fetch(`${api}/guilds/${env.DISCORD_GUILD_ID}/members/${row.subject}`, {
      method: "PUT",
      headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ access_token: access }),
    });
    if (r.status === 429) return json({ ...out, waitSeconds: await retryAfter(r) });
    if (r.status === 201 || r.status === 204) {
      if (r.status === 201) out.added++;
      else out.already++;
      await DB.prepare("UPDATE identities SET guild_joined_at = COALESCE(guild_joined_at, ?) WHERE provider = 'discord' AND subject = ?").bind(now(), row.subject).run();
    } else {
      out.failed++;
      const why = await r.json().catch(() => ({}));
      if (out.problems.length < 3) out.problems.push(`${r.status} ${why.message || ""}`.trim());
      if (r.status === 401 || (r.status === 403 && why.code === 50013) || r.status === 404) {
        // the bot token, the server id or the bot's permission is wrong - stop instead of failing for everyone
        return json({ ...out, done: true, stop: true, next: after });
      }
    }
    out.next = row.subject;
  }
  out.done = rows.length < BATCH;
  return json(out);
}

async function retryAfter(r) {
  const b = await r.json().catch(() => ({}));
  return Math.min(60, Math.ceil(Number(b.retry_after || r.headers.get("retry-after") || 5)));
}
