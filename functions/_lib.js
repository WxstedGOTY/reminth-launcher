// Reminth accounts - shared server code (Cloudflare Pages Functions, deployed with the website from site/).
// Sign up and sign in are the same thing: "Continue with Discord". The first time makes the account.
//
// Needs, in the Cloudflare Pages project "reminth" (Settings), set up by the owner:
//   D1 database binding   DB                     (any D1 database; the tables are made here on first use)
//   Variables (secrets)   DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET   (a Discord application, OAuth2)
// Optional: DISCORD_API (tests only - a stand-in for https://discord.com/api).
//
// What is stored (and nothing else): the Discord user id, name and avatar id, when the account was made and last
// signed in; sessions as SHA-256 hashes of random tokens (the tokens themselves are never stored); one-minute codes
// for the app. No email, no password, no Discord access token (it is used once and dropped).

export const SITE = "https://reminth.pages.dev";
const SESSION_DAYS = 90;
const CODE_SECONDS = 120;
const STATE_SECONDS = 600;

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

/** A redirect to a page of this same site. */
export function go(path) {
  return new Response(null, { status: 302, headers: { location: path, "cache-control": "no-store" } });
}

export function configured(env) {
  return Boolean(env && env.DB && env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET);
}

export function notConfigured() {
  return json({ error: "not_configured", message: "Reminth accounts aren't switched on yet." }, 503);
}

export function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function cookies(request) {
  const out = {};
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

const now = () => Math.floor(Date.now() / 1000);

let tablesReady = false;
export async function db(env) {
  if (!tablesReady) {
    for (const st of [
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, discord_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL, avatar TEXT,
        created_at INTEGER NOT NULL, last_login INTEGER NOT NULL)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS login_codes (
        code_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, nonce_hash TEXT NOT NULL, expires_at INTEGER NOT NULL)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id)`),
    ]) {
      try {
        await st.run();
      } catch (e) {
        throw new Error("D1 table setup failed: " + (e && e.message) + (e && e.cause ? " / " + e.cause : ""));
      }
    }
    tablesReady = true;
  }
  return env.DB;
}

/** The public view of an account (what the app and the website show). */
export function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    avatarUrl: u.avatar ? `https://cdn.discordapp.com/avatars/${u.discord_id}/${u.avatar}.png?size=128` : null,
    provider: "discord",
    createdAt: u.created_at * 1000,
  };
}

/** Makes the account the first time, updates its name and avatar later. Returns the row. */
export async function upsertDiscordUser(env, d) {
  const DB = await db(env);
  const name = String(d.global_name || d.username || "Player").slice(0, 64);
  const avatar = d.avatar && /^[a-z0-9_]{1,64}$/i.test(d.avatar) ? d.avatar : null;
  const existing = await DB.prepare("SELECT * FROM users WHERE discord_id = ?").bind(String(d.id)).first();
  if (existing) {
    await DB.prepare("UPDATE users SET name = ?, avatar = ?, last_login = ? WHERE id = ?").bind(name, avatar, now(), existing.id).run();
    return { ...existing, name, avatar };
  }
  const id = randomToken(12);
  const t = now();
  await DB.prepare("INSERT INTO users (id, discord_id, name, avatar, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, String(d.id), name, avatar, t, t)
    .run();
  return { id, discord_id: String(d.id), name, avatar, created_at: t, last_login: t };
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

/** The session token of a request: the app sends "Authorization: Bearer", the website a cookie. */
export function requestToken(request) {
  const auth = request.headers.get("authorization") || "";
  if (/^Bearer [a-f0-9]{64}$/.test(auth)) return { token: auth.slice(7), viaCookie: false };
  const c = cookies(request).rm_session;
  if (c && /^[a-f0-9]{64}$/.test(c)) return { token: c, viaCookie: true };
  return null;
}

/** The signed-in user of a request, or null. */
export async function currentUser(env, request) {
  const t = requestToken(request);
  if (!t) return null;
  const DB = await db(env);
  const row = await DB.prepare(
    "SELECT users.*, sessions.token_hash AS th FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?"
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

export { STATE_SECONDS };
