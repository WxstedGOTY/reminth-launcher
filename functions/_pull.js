// Adding players who signed in with Discord to the Reminth server (the owner's button on the website, and /pull).
// Discord's rule: the bot must be in the server with "Create Invite"; to give the Player role on the way in it also
// needs "Manage Roles" and its role above the Player role. Discord answers 201 (added) or 204 (was already in).
import { db, now, seal, unseal } from "./_lib.js";

const BATCH = 10;
const api = (env) => env.DISCORD_API || "https://discord.com/api/v10";
const oauthApi = (env) => env.DISCORD_API || "https://discord.com/api";

export const pullSetup = (env) => ({ bot: Boolean(env.DISCORD_BOT_TOKEN), server: Boolean(env.DISCORD_GUILD_ID) });

/** Adds up to 10 players after `after` (a Discord id). {added, already, failed, problems, next, done, stop, waitSeconds} */
export async function pullBatch(env, after = "") {
  after = /^\d{1,25}$/.test(String(after || "")) ? String(after) : "";
  const DB = await db(env);
  const roleRow = await DB.prepare("SELECT value FROM bot_config WHERE key = 'player_role'").first();
  const role = roleRow && /^\d{1,25}$/.test(roleRow.value) ? roleRow.value : null;
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
  const bot = { authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "content-type": "application/json" };
  const out = { added: 0, already: 0, failed: 0, problems: [], next: after, done: false, waitSeconds: 0 };
  for (const row of rows) {
    // a fresh access token from the kept refresh token (Discord hands out a new refresh token each time - kept too)
    const refresh = await unseal(env, row.secret);
    let access = null;
    if (refresh) {
      const t = await fetch(`${oauthApi(env)}/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: refresh }),
      });
      if (t.status === 429) return { ...out, waitSeconds: await retryAfter(t) };
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
    const r = await fetch(`${api(env)}/guilds/${env.DISCORD_GUILD_ID}/members/${row.subject}`, {
      method: "PUT",
      headers: bot,
      body: JSON.stringify(role ? { access_token: access, roles: [role] } : { access_token: access }),
    });
    if (r.status === 429) return { ...out, waitSeconds: await retryAfter(r) };
    if (r.status === 201 || r.status === 204) {
      if (r.status === 201) out.added++;
      else {
        out.already++;
        // already in the server: still give the Player role (best effort)
        if (role) await fetch(`${api(env)}/guilds/${env.DISCORD_GUILD_ID}/members/${row.subject}/roles/${role}`, { method: "PUT", headers: bot }).catch(() => {});
      }
      await DB.prepare("UPDATE identities SET guild_joined_at = COALESCE(guild_joined_at, ?) WHERE provider = 'discord' AND subject = ?").bind(now(), row.subject).run();
    } else {
      out.failed++;
      const why = await r.json().catch(() => ({}));
      if (out.problems.length < 3) out.problems.push(`${r.status} ${why.message || ""}`.trim());
      if (r.status === 401 || (r.status === 403 && why.code === 50013) || r.status === 404) {
        // the bot token, the server id or the bot's permission is wrong - stop instead of failing for everyone
        return { ...out, done: true, stop: true, next: after };
      }
    }
    out.next = row.subject;
  }
  out.done = rows.length < BATCH;
  return out;
}

async function retryAfter(r) {
  const b = await r.json().catch(() => ({}));
  return Math.min(60, Math.ceil(Number(b.retry_after || r.headers.get("retry-after") || 5)));
}
