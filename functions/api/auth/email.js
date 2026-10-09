// POST /api/auth/email {mode: "signup"|"signin", email, password, name?, client: "web"|"app"}
//   web: sets the session cookie -> {user}      app: -> {token, user} (the app calls this itself, no browser)
// Passwords: at least 8 characters, stored only as a salted PBKDF2 hash. Tries are limited per address and per
// network. There is no email check or "forgot password" yet (Reminth sends no emails).
import { accountView, allowTry, checkPassword, configured, cookie, db, hashPassword, json, newSession, notConfigured, sameOrigin, SESSION_SECONDS, signInIdentity } from "../../_lib.js";

const EMAIL = /^[^\s@<>()"',;:\\]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const say = (error, message, status = 400) => json({ error, message }, status);

export async function onRequestPost({ request, env }) {
  if (!configured(env)) return notConfigured();
  let b;
  try {
    b = await request.json();
  } catch {
    return say("bad_request", "Something went wrong. Try again.");
  }
  const client = b && b.client === "app" ? "app" : "web";
  if (client === "web" && !sameOrigin(request)) return json({ error: "forbidden" }, 403);
  const mode = b && b.mode === "signup" ? "signup" : "signin";
  const email = String((b && b.email) || "").trim().toLowerCase();
  const password = String((b && b.password) || "");
  if (email.length > 254 || !EMAIL.test(email)) return say("bad_email", "That doesn't look like an email address.");
  if (password.length < 8) return say("short_password", "The password needs at least 8 characters.");
  if (password.length > 200) return say("long_password", "That password is too long (200 characters at most).");

  const ip = request.headers.get("cf-connecting-ip") || "local";
  if (!(await allowTry(env, "ip:" + ip, 30, 900)) || !(await allowTry(env, "email:" + email, 10, 900)))
    return say("slow_down", "Too many tries. Wait 15 minutes and try again.", 429);

  const DB = await db(env);
  let accountId;
  if (mode === "signup") {
    const name = String((b && b.name) || "").replace(/[\u0000-\u001f]/g, "").trim();
    if (name.length < 2 || name.length > 32) return say("bad_name", "Pick a gamer tag with 2 to 32 characters.");
    const taken = await DB.prepare("SELECT 1 FROM identities WHERE provider = 'email' AND subject = ?").bind(email).first();
    if (taken) return say("email_taken", "There's already an account with that email. Sign in instead.", 409);
    try {
      accountId = await signInIdentity(env, { provider: "email", subject: email, name, secret: await hashPassword(password) });
    } catch (e) {
      if (e.code) return say("email_taken", "There's already an account with that email. Sign in instead.", 409);
      throw e;
    }
  } else {
    const row = await DB.prepare("SELECT * FROM identities WHERE provider = 'email' AND subject = ?").bind(email).first();
    // the same answer (and about the same time) whether or not the address has an account
    const ok = await checkPassword(password, row ? row.secret : "pbkdf2$100000$00000000000000000000000000000000$00");
    if (!row || !ok) return say("wrong", "Wrong email or password.", 401);
    accountId = row.account_id;
    await DB.prepare("UPDATE accounts SET last_login = strftime('%s','now') WHERE id = ?").bind(accountId).run();
  }

  const user = await accountView(env, accountId);
  const token = await newSession(env, accountId, client);
  if (client === "app") return json({ token, user });
  return json({ user }, 200, { "set-cookie": cookie("rm_session", token, SESSION_SECONDS) });
}
