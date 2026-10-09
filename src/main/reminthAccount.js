"use strict";
/**
 * Reminth accounts in the launcher (the server is functions/ on the website, Cloudflare Pages).
 * Separate from the Microsoft sign-in that plays Minecraft: a Reminth account is Reminth's own (Discord, Google or
 * email + password), shared with the website. When accounts are switched on, the launcher asks for one first.
 *
 * Email: emailSignIn() posts straight to <api>/api/auth/email (client "app") and gets the session token back.
 * Discord / Google: startSignIn(provider) makes a random nonce (kept only in memory) and opens the browser on
 *   <api>/api/auth/<provider>/start?client=app&nonce=<nonce>
 * After Discord / Google, the page opens reminth://auth/<code>; main.js hands the code to completeSignIn(), which swaps it
 * together with the nonce at /api/auth/exchange. A reminth://auth link the player didn't start here (no nonce
 * waiting, or older than 10 minutes) is ignored - a link from a web page can't sign anyone into someone else's account.
 *
 * The session token is kept encrypted with Windows' own key store (safeStorage, like account.json). If that isn't
 * available it lives in memory only for this run.
 */
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const { safeStorage } = require("electron");
const paths = require("./paths");
const atomic = require("./atomic");
const config = require("./config");

const FILE = path.join(paths.ROOT, "reminth-account.bin");
const PENDING_MS = 10 * 60 * 1000;
const PROVIDERS = ["discord", "google", "email"];

let pending = null; // { nonce, at }
let memoryToken = null;
let cached = null; // { user, at }

const api = () => config.REMINTH_API_URL.replace(/\/+$/, "");

async function readToken() {
  if (memoryToken) return memoryToken;
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const t = safeStorage.decryptString(await fsp.readFile(FILE));
    return /^[a-f0-9]{64}$/.test(t) ? t : null;
  } catch {
    return null;
  }
}

async function writeToken(token) {
  memoryToken = token;
  if (!token) {
    await fsp.rm(FILE, { force: true }).catch(() => {});
    return;
  }
  if (safeStorage.isEncryptionAvailable()) await atomic.writeFileAtomic(FILE, safeStorage.encryptString(token));
}

async function call(pathname, { method = "GET", token, body, timeoutMs = 10000 } = {}) {
  const headers = {};
  if (token) headers.authorization = "Bearer " + token;
  if (body !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(api() + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  let data = null;
  try {
    data = await r.json();
  } catch {
    data = null;
  }
  return { status: r.status, data };
}

/** Whether accounts are switched on on the server ({ accounts, providers }), or { accounts: false, offline: true }. */
async function status() {
  try {
    const r = await call("/api/status", { timeoutMs: 6000 });
    const providers = r.data && Array.isArray(r.data.providers) ? r.data.providers.filter((p) => PROVIDERS.includes(p)) : [];
    return { accounts: Boolean(r.data && r.data.accounts), providers };
  } catch {
    return { accounts: false, offline: true };
  }
}

/** The signed-in Reminth account: { user } / { user: null } / { user, offline: true } (last known, no internet). */
async function get({ fresh = false } = {}) {
  const token = await readToken();
  if (!token) return { user: null };
  if (!fresh && cached && Date.now() - cached.at < 5 * 60 * 1000) return { user: cached.user };
  try {
    const r = await call("/api/me", { token });
    if (r.status === 401) {
      await writeToken(null);
      cached = null;
      return { user: null };
    }
    if (r.status === 200 && r.data && r.data.user) {
      cached = { user: r.data.user, at: Date.now() };
      return { user: r.data.user };
    }
  } catch {
    // offline - keep the account
  }
  return cached ? { user: cached.user, offline: true } : { user: { name: "Signed in", offline: true }, offline: true };
}

/** The address to open in the browser to sign in with Discord or Google (a new nonce each time). */
function startSignIn(provider = "discord") {
  if (provider !== "discord" && provider !== "google") throw new Error("unknown sign-in method");
  const nonce = crypto.randomBytes(24).toString("hex");
  pending = { nonce, at: Date.now() };
  return `${api()}/api/auth/${provider}/start?client=app&nonce=${nonce}`;
}

/** Email + password, without a browser: { user } or { error, message }. mode "signup" also needs a name. */
async function emailSignIn({ mode, email, password, name } = {}) {
  const body = { client: "app", mode: mode === "signup" ? "signup" : "signin", email: String(email || "").slice(0, 254), password: String(password || "").slice(0, 200) };
  if (body.mode === "signup") body.name = String(name || "").slice(0, 32);
  try {
    const r = await call("/api/auth/email", { method: "POST", body, timeoutMs: 15000 });
    if (r.status !== 200 || !r.data || !/^[a-f0-9]{64}$/.test(r.data.token || "")) {
      return { error: (r.data && r.data.error) || "failed", message: (r.data && r.data.message) || "That didn't work. Try again." };
    }
    await writeToken(r.data.token);
    cached = { user: r.data.user, at: Date.now() };
    return { user: r.data.user };
  } catch {
    return { error: "offline", message: "Can't reach Reminth right now. Check your internet and try again." };
  }
}

/** reminth://auth/<code> came in: { user } when it was ours and worked, else { error }. */
async function completeSignIn(code) {
  const p = pending;
  if (!p || Date.now() - p.at > PENDING_MS) return { error: "not_started" };
  if (!/^[a-f0-9]{32}$/.test(String(code || ""))) return { error: "bad_code" };
  pending = null; // one try per sign-in
  try {
    const r = await call("/api/auth/exchange", { method: "POST", body: { code, nonce: p.nonce } });
    if (r.status !== 200 || !r.data || !/^[a-f0-9]{64}$/.test(r.data.token || "")) {
      return { error: (r.data && r.data.error) || "failed", message: r.data && r.data.message };
    }
    await writeToken(r.data.token);
    cached = { user: r.data.user, at: Date.now() };
    return { user: r.data.user };
  } catch {
    return { error: "offline" };
  }
}

async function signOut() {
  const token = await readToken();
  if (token) await call("/api/auth/logout", { method: "POST", token, timeoutMs: 6000 }).catch(() => {});
  await writeToken(null);
  cached = null;
  pending = null;
  return { user: null };
}

module.exports = { status, get, startSignIn, emailSignIn, completeSignIn, signOut, _test: { setPending: (p) => (pending = p), FILE } };
