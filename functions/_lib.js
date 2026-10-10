// Reminth accounts - shared server code (Cloudflare Pages Functions, deployed with the website from site/).
// Sign up and sign in are the same thing: "Continue with Discord / Google" makes the account the first time; email +
// password has a separate "Create account".
//
// Needs, in the Cloudflare Pages project "reminth" (Settings), set up by the owner:
//   D1 database binding   DB            (any D1 database; the tables are made here on first use). With only this,
//                                       email + password sign-in works.
//   Discord (optional)    DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET          (a Discord application, OAuth2)
//   Google (optional)     GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET            (a Google Cloud OAuth client, "Web")
//   Owner tools (optional) ADMIN_DISCORD_ID (the owner's Discord user id), DISCORD_BOT_TOKEN (the bot of the same
//                          Discord application), DISCORD_GUILD_ID (the owner's server) - the "add everyone who signed in
//                          with Discord to my server" button on the account page.
// Tests only: DISCORD_API, GOOGLE_API (stand-ins for the real APIs).
//
// What is stored: an account (name, picture link, when made / last signed in, whether the player allows being added to
// the Reminth Discord server); per sign-in method the Discord or Google user id, for email the address and a salted
// PBKDF2 hash of the password; for Discord the refresh token, AES-GCM encrypted, only so the owner's button can add the
// player to the server; sessions as SHA-256 hashes of random tokens; 2-minute codes for the app.

export const SITE = "https://reminth.pages.dev";
const SESSION_DAYS = 90;
const CODE_SECONDS = 120;
const STATE_SECONDS = 600;
export const PBKDF2_ITERATIONS = 100000; // the most Cloudflare Workers allow

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

/** A redirect to a page of this same site. */
export function go(path, headers = {}) {
  return new Response(null, { status: 302, headers: { location: path, "cache-control": "no-store", ...headers } });
}

export function discordOn(env) {
  return Boolean(env && env.DB && env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET);
}
export function googleOn(env) {
  return Boolean(env && env.DB && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}
/** The sign-in methods that are switched on. Email works as soon as the database is there. */
export function providers(env) {
  if (!env || !env.DB) return [];
  return [discordOn(env) && "discord", googleOn(env) && "google", "email"].filter(Boolean);
}
export function configured(env) {
  return Boolean(env && env.DB);
}

export function notConfigured() {
  return json({ error: "not_configured", message: "Reminth accounts aren't switched on yet." }, 503);
}

export function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return hex(a);
}
const hex = (a) => [...new Uint8Array(a)].map((b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s) => new Uint8Array((s.match(/../g) || []).map((h) => parseInt(h, 16)));

export async function sha256(text) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

export function cookies(request) {
  const out = {};
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        // a broken cookie is ignored
      }
    }
  }
  return out;
}

export function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export const now = () => Math.floor(Date.now() / 1000);

let tablesReady = false;
export async function db(env) {
  if (!tablesReady) {
    for (const sql of [
      `CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, avatar_url TEXT, discord_pull INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL, last_login INTEGER NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS identities (
        provider TEXT NOT NULL, subject TEXT NOT NULL, account_id TEXT NOT NULL, secret TEXT, guild_joined_at INTEGER,
        created_at INTEGER NOT NULL, PRIMARY KEY (provider, subject))`,
      `CREATE INDEX IF NOT EXISTS identities_account ON identities (account_id)`,
      `CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id)`,
      `CREATE TABLE IF NOT EXISTS login_codes (
        code_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, nonce_hash TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS tries (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL)`,
      // the Discord bot (_bot.js): its settings (/config) and saved warnings (/warn)
      `CREATE TABLE IF NOT EXISTS bot_config (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS warnings (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, mod_id TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS warnings_user ON warnings (user_id)`,
    ]) {
      try {
        await env.DB.prepare(sql).run();
      } catch (e) {
        throw new Error("D1 table setup failed: " + (e && e.message) + (e && e.cause ? " / " + e.cause : ""));
      }
    }
    await migrateOldUsers(env.DB);
    tablesReady = true;
  }
  return env.DB;
}

// The first version (1.7.0 test builds) had one "users" table with a Discord id per row. Copies those over once.
async function migrateOldUsers(DB) {
  const old = await DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'").first();
  if (!old) return;
  await DB.batch([
    DB.prepare(`INSERT OR IGNORE INTO accounts (id, name, avatar_url, created_at, last_login)
      SELECT id, name, CASE WHEN avatar IS NULL THEN NULL ELSE 'https://cdn.discordapp.com/avatars/' || discord_id || '/' || avatar || '.png?size=128' END,
      created_at, last_login FROM users`),
    DB.prepare(`INSERT OR IGNORE INTO identities (provider, subject, account_id, created_at)
      SELECT 'discord', discord_id, id, created_at FROM users`),
    DB.prepare("DROP TABLE users"),
  ]);
}

/** The public view of an account (what the app and the website show). */
export function publicUser(a, idents = [], env = null) {
  const out = {
    id: a.id,
    name: a.name,
    avatarUrl: a.avatar_url || null,
    providers: idents.map((i) => i.provider),
    provider: (idents[0] && idents[0].provider) || null,
    createdAt: a.created_at * 1000,
  };
  const email = idents.find((i) => i.provider === "email");
  if (email) out.email = email.subject;
  if (env && isAdmin(env, idents)) out.admin = true;
  return out;
}

export async function identitiesOf(env, accountId) {
  const DB = await db(env);
  const r = await DB.prepare("SELECT provider, subject, guild_joined_at FROM identities WHERE account_id = ? ORDER BY created_at").bind(accountId).all();
  return r.results || [];
}

export async function accountView(env, accountId) {
  const DB = await db(env);
  const a = await DB.prepare("SELECT * FROM accounts WHERE id = ?").bind(accountId).first();
  if (!a) return null;
  return publicUser(a, await identitiesOf(env, accountId), env);
}

export function isAdmin(env, idents) {
  return Boolean(env.ADMIN_DISCORD_ID && idents.some((i) => i.provider === "discord" && i.subject === String(env.ADMIN_DISCORD_ID)));
}

const ERR = (code, status = 400, message) => Object.assign(new Error(code), { code, status, userMessage: message });
export { ERR };

/**
 * Signs in with a provider identity: finds its account (and refreshes name / picture / secret) or makes one.
 * linkTo: an account id to attach a new identity to instead (the website's "Connect" buttons).
 * Returns the account id.
 */
export async function signInIdentity(env, { provider, subject, name, avatarUrl, secret }, linkTo = null) {
  const DB = await db(env);
  const t = now();
  name = String(name || "Player").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 64) || "Player";
  const found = await DB.prepare("SELECT * FROM identities WHERE provider = ? AND subject = ?").bind(provider, subject).first();
  if (found) {
    if (linkTo && found.account_id !== linkTo) throw ERR("already_linked", 409);
    const sets = [DB.prepare("UPDATE accounts SET last_login = ? WHERE id = ?").bind(t, found.account_id)];
    if (secret !== undefined) sets.push(DB.prepare("UPDATE identities SET secret = ? WHERE provider = ? AND subject = ?").bind(secret, provider, subject));
    // the picture follows the method the account was made with
    const first = await DB.prepare("SELECT provider FROM identities WHERE account_id = ? ORDER BY created_at LIMIT 1").bind(found.account_id).first();
    if (first && first.provider === provider && provider !== "email") sets.push(DB.prepare("UPDATE accounts SET avatar_url = ? WHERE id = ?").bind(avatarUrl || null, found.account_id));
    await DB.batch(sets);
    return found.account_id;
  }
  if (linkTo) {
    const has = await DB.prepare("SELECT 1 FROM identities WHERE account_id = ? AND provider = ?").bind(linkTo, provider).first();
    if (has) throw ERR("already_has", 409);
    await DB.prepare("INSERT INTO identities (provider, subject, account_id, secret, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(provider, subject, linkTo, secret === undefined ? null : secret, t)
      .run();
    await DB.prepare("UPDATE accounts SET avatar_url = COALESCE(avatar_url, ?) WHERE id = ?").bind(avatarUrl || null, linkTo).run();
    return linkTo;
  }
  const id = randomToken(12);
  await DB.batch([
    DB.prepare("INSERT INTO accounts (id, name, avatar_url, created_at, last_login) VALUES (?, ?, ?, ?, ?)").bind(id, name, avatarUrl || null, t, t),
    DB.prepare("INSERT INTO identities (provider, subject, account_id, secret, created_at) VALUES (?, ?, ?, ?, ?)").bind(
      provider,
      subject,
      id,
      secret === undefined ? null : secret,
      t
    ),
  ]);
  return id;
}

/** A new session: returns the token (only ever given to its owner). */
export async function newSession(env, userId, kind) {
  const DB = await db(env);
  const token = randomToken(32);
  await DB.prepare("INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(await sha256(token), userId, kind, now(), now() + SESSION_DAYS * 86400)
    .run();
  return token;
}
export const SESSION_SECONDS = SESSION_DAYS * 86400;

/** The session token of a request: the app sends "Authorization: Bearer", the website a cookie. */
export function requestToken(request) {
  const auth = request.headers.get("authorization") || "";
  if (/^Bearer [a-f0-9]{64}$/.test(auth)) return { token: auth.slice(7), viaCookie: false };
  const c = cookies(request).rm_session;
  if (c && /^[a-f0-9]{64}$/.test(c)) return { token: c, viaCookie: true };
  return null;
}

/** The signed-in account of a request, or null. */
export async function currentUser(env, request) {
  const t = requestToken(request);
  if (!t) return null;
  const DB = await db(env);
  const row = await DB.prepare(
    "SELECT accounts.*, sessions.token_hash AS th FROM sessions JOIN accounts ON accounts.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?"
  )
    .bind(await sha256(t.token), now())
    .first();
  return row ? { user: row, tokenHash: row.th, viaCookie: t.viaCookie } : null;
}

/** Cookie-signed requests that change something must come from the website itself (no cross-site forms). */
export function sameOrigin(request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function newLoginCode(env, userId, nonce) {
  const DB = await db(env);
  await DB.prepare("DELETE FROM login_codes WHERE expires_at < ?").bind(now()).run();
  const code = randomToken(16);
  await DB.prepare("INSERT INTO login_codes (code_hash, user_id, nonce_hash, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(code), userId, await sha256(nonce), now() + CODE_SECONDS)
    .run();
  return code;
}

/** Uses up a login code; it only works with the nonce the app made when it started the sign-in. */
export async function takeLoginCode(env, code, nonce) {
  if (!/^[a-f0-9]{32}$/.test(code || "") || !/^[a-f0-9]{32,64}$/.test(nonce || "")) return null;
  const DB = await db(env);
  const ch = await sha256(code);
  const row = await DB.prepare("SELECT * FROM login_codes WHERE code_hash = ?").bind(ch).first();
  await DB.prepare("DELETE FROM login_codes WHERE code_hash = ?").bind(ch).run();
  if (!row || row.expires_at < now() || row.nonce_hash !== (await sha256(nonce))) return null;
  return row.user_id;
}

/** Counts tries for a key (e.g. sign-ins per address); false once there were `max` in `windowSec`. */
export async function allowTry(env, key, max, windowSec) {
  const DB = await db(env);
  const t = now();
  const k = await sha256(key);
  const row = await DB.prepare("SELECT * FROM tries WHERE key = ?").bind(k).first();
  if (!row || row.reset_at <= t) {
    await DB.prepare("INSERT OR REPLACE INTO tries (key, count, reset_at) VALUES (?, 1, ?)").bind(k, t + windowSec).run();
    if (Math.random() < 0.05) await DB.prepare("DELETE FROM tries WHERE reset_at <= ?").bind(t).run();
    return true;
  }
  if (row.count >= max) return false;
  await DB.prepare("UPDATE tries SET count = count + 1 WHERE key = ?").bind(k).run();
  return true;
}

// --- passwords: PBKDF2-SHA256, stored as "pbkdf2$<iterations>$<salt hex>$<hash hex>"
export async function hashPassword(password, iterations = PBKDF2_ITERATIONS, saltHex = randomToken(16)) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unhex(saltHex), iterations }, key, 256);
  return `pbkdf2$${iterations}$${saltHex}$${hex(bits)}`;
}
export async function checkPassword(password, stored) {
  const [kind, it, salt, want] = String(stored || "").split("$");
  if (kind !== "pbkdf2" || !want) return false;
  const got = (await hashPassword(password, Number(it), salt)).split("$")[3];
  let diff = got.length ^ want.length;
  for (let i = 0; i < Math.min(got.length, want.length); i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

// --- Discord refresh tokens are kept encrypted (AES-GCM, key made from TOKEN_KEY or the Discord client secret)
async function tokenKey(env) {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("reminth-token-key:" + (env.TOKEN_KEY || env.DISCORD_CLIENT_SECRET || "")));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function seal(env, text) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await tokenKey(env), new TextEncoder().encode(text));
  return `v1.${hex(iv)}.${hex(ct)}`;
}
export async function unseal(env, sealed) {
  const [v, iv, ct] = String(sealed || "").split(".");
  if (v !== "v1" || !iv || !ct) return null;
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unhex(iv) }, await tokenKey(env), unhex(ct)));
  } catch {
    return null;
  }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export { STATE_SECONDS };
