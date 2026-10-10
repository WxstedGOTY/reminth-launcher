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
  const st = await (await req("/api/status")).json();
  assert.equal(st.accounts, true);
  assert.deepEqual(st.providers, ["discord", "google", "email"]);
  step("status says accounts are on, with Discord, Google and email");

  // --- website: start -> Discord -> callback -> cookie session
  let r = await req("/api/auth/discord/start?client=web");
  assert.equal(r.status, 302);
  const disc = new URL(r.headers.get("location"));
  assert.equal(disc.hostname, "discord.com");
  assert.equal(disc.searchParams.get("scope"), "identify guilds.join");
  const state = disc.searchParams.get("state");
  assert.ok(jar.has("rm_state"));
  step("start sends the browser to Discord (identify + guilds.join) with a state cookie");

  r = await req(`/api/auth/discord/callback?code=c1&state=wrong`);
  assert.match(r.headers.get("location"), /error=expired/);
  step("a callback with the wrong state is refused");

  r = await req("/api/auth/discord/start?client=web");
  const state2 = new URL(r.headers.get("location")).searchParams.get("state");
  r = await req(`/api/auth/discord/callback?code=c1&state=${state2}`);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), "/account.html?welcome=1");
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
  assert.ok(html.includes("Sign-in complete") && html.includes("close this tab"), "the page says it's done");
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

  // --- Google (website), then connecting Discord to that same account
  jar.clear();
  r = await req("/api/auth/google/start?client=web");
  const gUrl = new URL(r.headers.get("location"));
  assert.equal(gUrl.searchParams.get("scope"), "openid profile");
  r = await req(`/api/auth/discord/callback?code=g1&state=${gUrl.searchParams.get("state")}`);
  assert.match(r.headers.get("location"), /error=expired/, "a Google state can't finish a Discord sign-in");
  r = await req("/api/auth/google/start?client=web");
  r = await req(`/api/auth/google/callback?code=g1&state=${new URL(r.headers.get("location")).searchParams.get("state")}`);
  assert.equal(r.headers.get("location"), "/account.html?welcome=1");
  me = (await (await req("/api/me")).json()).user;
  assert.equal(me.name, "Gina");
  assert.deepEqual(me.providers, ["google"]);
  assert.match(me.avatarUrl, /^https:\/\/lh3\.googleusercontent\.com\//);
  const gina = me.id;
  step("Google sign-in makes its own account (name, picture)");

  r = await req("/api/auth/discord/start?client=web&link=1");
  r = await req(`/api/auth/discord/callback?code=c9&state=${new URL(r.headers.get("location")).searchParams.get("state")}`);
  assert.match(r.headers.get("location"), /error=already_linked/, "Tester's Discord belongs to Tester's account");
  r = await req("/api/auth/discord/start?client=web&link=1");
  r = await req(`/api/auth/discord/callback?code=other&state=${new URL(r.headers.get("location")).searchParams.get("state")}`);
  assert.match(r.headers.get("location"), /linked=discord/);
  me = (await (await req("/api/me")).json()).user;
  assert.equal(me.id, gina);
  assert.deepEqual(me.providers, ["google", "discord"]);
  assert.equal(me.admin, undefined);
  step("Connect: Discord added to the Google account; someone else's Discord is refused");
  const ginaJar = new Map(jar);

  // --- email + password
  const origin = { origin: BASE };
  const email = (b, extra = {}) => req("/api/auth/email", { method: "POST", body: { client: "web", ...b }, headers: { ...origin, ...extra }, useJar: false });
  assert.equal((await email({ mode: "signup", email: "nope", password: "longenough", name: "Em" })).status, 400);
  assert.equal((await email({ mode: "signup", email: "em@test.dev", password: "short", name: "Em" })).status, 400);
  assert.equal((await email({ mode: "signup", email: "em@test.dev", password: "longenough", name: "E" })).status, 400);
  assert.equal((await email({ mode: "signup", email: "em@test.dev", password: "longenough", name: "Em" }, { origin: "https://evil.example" })).status, 403);
  r = await email({ mode: "signup", email: "Em@Test.dev", password: "longenough", name: "Em" });
  assert.equal(r.status, 200);
  assert.ok((r.headers.getSetCookie() || []).some((c) => /^rm_session=[a-f0-9]{64};.*HttpOnly/.test(c)));
  const em = (await r.json()).user;
  assert.equal(em.email, "em@test.dev");
  assert.equal((await email({ mode: "signup", email: "em@test.dev", password: "otherpass1", name: "Em2" })).status, 409);
  assert.equal((await email({ mode: "signin", email: "em@test.dev", password: "wrongpass1" })).status, 401);
  assert.equal((await email({ mode: "signin", email: "nobody@test.dev", password: "wrongpass1" })).status, 401);
  r = await email({ mode: "signin", client: "app", email: "EM@test.dev", password: "longenough" });
  const emApp = await r.json();
  assert.equal(r.status, 200);
  assert.equal(emApp.user.id, em.id);
  assert.match(emApp.token, /^[a-f0-9]{64}$/);
  step("email: checks, sign up (web cookie), taken address, wrong password, app sign-in gets a token");

  let limited = false;
  for (let i = 0; i < 12 && !limited; i++) limited = (await email({ mode: "signin", email: "em@test.dev", password: "wrongpass" + i })).status === 429;
  assert.ok(limited, "too many wrong passwords get slowed down");
  step("email: many wrong passwords in a row -> 'too many tries'");

  // --- owner tools: the Discord pull
  assert.equal((await req("/api/admin/discord")).status, 404, "for others the owner's addresses don't exist");
  assert.equal((await req("/api/tools")).status, 404);
  assert.equal((await (await req("/api/me")).json()).user.extra, undefined, "others' accounts never point at the tools");
  const adminH = { authorization: "Bearer " + got.token };
  let s = await (await req("/api/admin/discord", { headers: adminH, useJar: false })).json();
  assert.equal(s.setup.bot, true);
  assert.equal(s.setup.server, true);
  assert.equal(s.allowed, 2);
  assert.equal(s.inServer, 0);
  assert.equal(s.minecraft, 0);
  assert.ok(s.accounts >= 2 && s.newThisWeek === s.accounts && s.signedInThisWeek >= 1);
  // the launcher says "signed in to Minecraft": only with the app's token, counted once
  assert.equal((await req("/api/account/minecraft", { method: "POST", body: {}, useJar: false })).status, 401);
  assert.equal((await req("/api/account/minecraft", { method: "POST", body: {} })).status, 403, "the website's cookie can't");
  assert.equal((await req("/api/account/minecraft", { method: "POST", body: {}, headers: adminH, useJar: false })).status, 200);
  assert.equal((await req("/api/account/minecraft", { method: "POST", body: {}, headers: adminH, useJar: false })).status, 200);
  s = await (await req("/api/admin/discord", { headers: adminH, useJar: false })).json();
  assert.equal(s.minecraft, 1);
  assert.match(await (await req("/api/tools", { headers: adminH, useJar: false })).text(), /Signed in to Minecraft/);
  step("Minecraft sign-ins: the app can say yes (once counted), the owner sees the numbers");
  const ownerMe = (await (await req("/api/me", { headers: adminH, useJar: false })).json()).user;
  assert.equal(ownerMe.admin, true);
  assert.equal(ownerMe.extra, "/api/tools");
  const tools = await req("/api/tools", { headers: adminH, useJar: false });
  assert.equal(tools.status, 200);
  assert.match(tools.headers.get("content-type"), /javascript/);
  assert.match(await tools.text(), /Add everyone to my Discord server/);
  const page = await (await fetch(BASE + "/account")).text();
  assert.doesNotMatch(page, /owner|Owner|admin|Add everyone|Set up my server/, "the public page shows nothing of the owner's tools");
  r = await req("/api/admin/discord", { method: "POST", body: {}, headers: adminH, useJar: false });
  let pull = await r.json();
  assert.equal(pull.added, 2);
  assert.equal(pull.done, true);
  pull = await (await req("/api/admin/discord", { method: "POST", body: {}, headers: adminH, useJar: false })).json();
  assert.equal(pull.already, 2);
  s = await (await req("/api/admin/discord", { headers: adminH, useJar: false })).json();
  assert.equal(s.inServer, 2);
  step("owner button: only the owner; adds both Discord players to the server, then 'already in'");

  jar.clear();
  for (const [k, v] of ginaJar) jar.set(k, v);

  r = await req("/api/account/delete", { method: "POST", body: { confirm: "DELETE" } });
  assert.equal(r.status, 200);
  const mock = await (await fetch("http://127.0.0.1:8799/_test/state")).json();
  assert.ok(mock.revoked.some((t) => /^rt-other-/.test(t)), "deleting hands the Discord permission back");
  step("deleting an account with Discord hands its Discord permission back");

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

// Local run:  node tools/accounts-mock.js &
//   npx wrangler@4 pages dev site --port 8788 --d1 DB=reminth-test-<new name each run> --binding DISCORD_CLIENT_ID=test-id \
//     --binding DISCORD_CLIENT_SECRET=test-secret --binding DISCORD_API=http://127.0.0.1:8799 \
//     --binding GOOGLE_CLIENT_ID=g-id --binding GOOGLE_CLIENT_SECRET=g-secret --binding GOOGLE_API=http://127.0.0.1:8799/google \
//     --binding ADMIN_DISCORD_ID=123456789 --binding DISCORD_BOT_TOKEN=bot-test --binding DISCORD_GUILD_ID=555
// (the mock remembers who it added to the server - restart it too between runs)
