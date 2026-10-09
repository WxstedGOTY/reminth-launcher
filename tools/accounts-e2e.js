// End-to-end check of Reminth accounts against a running server (default: a local `wrangler pages dev` with a pretend
// Discord - see the comment at the bottom). node tools/accounts-e2e.js [baseUrl]
"use strict";
const assert = require("assert/strict");
const crypto = require("crypto");
const BASE = process.argv[2] || "http://127.0.0.1:8788";

const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
async function req(path, { method = "GET", body, headers = {}, useJar = true } = {}) {
  const h = { ...headers };
  if (useJar && jar.size) h.cookie = cookieHeader();
  if (body !== undefined) h["content-type"] = "application/json";
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) {
    const [kv] = c.split(";");
    const i = kv.indexOf("=");
    const k = kv.slice(0, i), v = kv.slice(i + 1);
    if (/Max-Age=0/i.test(c) || v === "") jar.delete(k);
    else jar.set(k, v);
  }
  return r;
}
const step = (name) => console.log("  ok -", name);

(async () => {
  console.log("accounts e2e against", BASE);
  assert.equal((await (await req("/api/status")).json()).accounts, true);
  step("status says accounts are on");

  // --- website: start -> Discord -> callback -> cookie session
  let r = await req("/api/auth/discord/start?client=web");
  assert.equal(r.status, 302);
  const disc = new URL(r.headers.get("location"));
  assert.equal(disc.hostname, "discord.com");
  assert.equal(disc.searchParams.get("scope"), "identify");
  const state = disc.searchParams.get("state");
  assert.ok(jar.has("rm_state"));
  step("start sends the browser to Discord with scope identify and a state cookie");

  r = await req(`/api/auth/discord/callback?code=c1&state=wrong`);
  assert.match(r.headers.get("location"), /error=expired/);
  step("a callback with the wrong state is refused");

  r = await req("/api/auth/discord/start?client=web");
  const state2 = new URL(r.headers.get("location")).searchParams.get("state");
  r = await req(`/api/auth/discord/callback?code=c1&state=${state2}`);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), "/account.html");
  assert.ok(jar.has("rm_session"));
  step("the website sign-in makes the account and a session cookie");

  r = await req("/api/me");
  let me = await r.json();
  assert.equal(r.status, 200);
  assert.equal(me.user.name, "Tester <b>");
  assert.match(me.user.avatarUrl, /cdn\.discordapp\.com\/avatars\/123456789\/abc123\.png/);
  step("/api/me knows the player (name, avatar)");

  r = await req("/api/auth/logout", { method: "POST", headers: { origin: "https://evil.example" } });
  assert.equal(r.status, 403);
  r = await req("/api/account/delete", { method: "POST", body: { confirm: "DELETE" }, headers: { origin: "https://evil.example" } });
  assert.equal(r.status, 403);
  step("another website can't sign you out or delete your account");

  r = await req("/api/auth/logout", { method: "POST" });
  assert.equal(r.status, 200);
  assert.equal((await req("/api/me")).status, 401);
  step("signing out ends the website session");

  // --- app: start with a nonce -> callback page with reminth://auth/<code> -> exchange with the nonce
  const nonce = crypto.randomBytes(16).toString("hex");
  assert.match((await req("/api/auth/discord/start?client=app")).headers.get("location"), /error=bad_request/);
  r = await req(`/api/auth/discord/start?client=app&nonce=${nonce}`);
  const state3 = new URL(r.headers.get("location")).searchParams.get("state");
  r = await req(`/api/auth/discord/callback?code=c2&state=${state3}`);
  const html = await r.text();
  const code = (/reminth:\/\/auth\/([a-f0-9]{32})/.exec(html) || [])[1];
  assert.ok(code, "the page hands the app a code");
  assert.ok(!html.includes("<b>Tester <b>"), "the name is escaped on the page");
  assert.ok(html.includes("Tester &lt;b&gt;"));
  step("the app sign-in ends on a page that opens reminth://auth/<code> (name escaped)");

  r = await req("/api/auth/exchange", { method: "POST", body: { code, nonce: crypto.randomBytes(16).toString("hex") }, useJar: false });
  assert.equal(r.status, 400);
  r = await req("/api/auth/exchange", { method: "POST", body: { code, nonce }, useJar: false });
  assert.equal(r.status, 400, "a code is used up even by a wrong try");
  step("a code with someone else's nonce is refused - and then gone");

  r = await req(`/api/auth/discord/start?client=app&nonce=${nonce}`);
  const state4 = new URL(r.headers.get("location")).searchParams.get("state");
  const code2 = /reminth:\/\/auth\/([a-f0-9]{32})/.exec(await (await req(`/api/auth/discord/callback?code=c3&state=${state4}`)).text())[1];
  r = await req("/api/auth/exchange", { method: "POST", body: { code: code2, nonce }, useJar: false });
  const got = await r.json();
  assert.equal(r.status, 200);
  assert.match(got.token, /^[a-f0-9]{64}$/);
  assert.equal(got.user.name, "Tester <b>");
  r = await req("/api/auth/exchange", { method: "POST", body: { code: code2, nonce }, useJar: false });
  assert.equal(r.status, 400);
  step("the app swaps its code (with its own nonce) for a token - once only");

  const bearer = { authorization: "Bearer " + got.token };
  r = await req("/api/me", { headers: bearer, useJar: false });
  me = await r.json();
  assert.equal(me.user.id, got.user.id);
  step("the app's token works on /api/me, and it's the same account as on the website");

  r = await req("/api/account/delete", { method: "POST", body: {}, headers: bearer, useJar: false });
  assert.equal(r.status, 400);
  r = await req("/api/account/delete", { method: "POST", body: { confirm: "DELETE" }, headers: bearer, useJar: false });
  assert.equal(r.status, 200);
  assert.equal((await req("/api/me", { headers: bearer, useJar: false })).status, 401);
  step("deleting needs a confirmation, then the account and its sessions are gone");

  assert.equal((await req("/api/me", { headers: { authorization: "Bearer " + "0".repeat(64) }, useJar: false })).status, 401);
  assert.equal((await req("/api/me", { headers: { authorization: "Bearer x' OR 1=1 --" }, useJar: false })).status, 401);
  step("made-up and malformed tokens get nowhere");

  console.log("ALL PASSED");
})().catch((e) => {
  console.error("FAILED:", e && e.message);
  process.exit(1);
});

// Local run:  node <mock discord on 8799> &
//   npx wrangler@4 pages dev site --port 8788 --d1 DB=reminth-test --binding DISCORD_CLIENT_ID=test-id \
//     --binding DISCORD_CLIENT_SECRET=test-secret --binding DISCORD_API=http://127.0.0.1:8799
