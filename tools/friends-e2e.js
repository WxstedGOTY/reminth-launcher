// End-to-end check of Friends (functions/api/friends/*) against a running server - a local `wrangler pages dev` with an
// empty test database (see the bottom). Three throwaway email accounts sign up as the launcher does (client "app").
// node tools/friends-e2e.js [baseUrl]
"use strict";
const assert = require("assert/strict");
const BASE = process.argv[2] || "http://127.0.0.1:8788";
const step = (name) => console.log("  ok -", name);

async function call(path, { method = "GET", token, body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.authorization = "Bearer " + token;
  if (body !== undefined) h["content-type"] = "application/json";
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null;
  try {
    data = await r.json();
  } catch {
    data = null;
  }
  return { status: r.status, data };
}

async function signUp(name) {
  const email = `${name.toLowerCase()}-${Date.now()}@test.dev`;
  const r = await call("/api/auth/email", { method: "POST", body: { client: "app", mode: "signup", email, password: "longenough1", name } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.token, /^[a-f0-9]{64}$/);
  return { token: r.data.token, id: r.data.user.id, name };
}

(async () => {
  console.log("friends e2e against", BASE);
  assert.equal((await call("/api/friends")).status, 401);
  assert.equal((await call("/api/friends/request", { method: "POST", body: { code: "AAAA-BBBB" } })).status, 401);
  step("signed out: nothing");

  const ana = await signUp("Ana");
  const ben = await signUp("Ben");
  const cy = await signUp("Cy");
  let r = await call("/api/friends", { token: ana.token });
  assert.equal(r.status, 200);
  assert.match(r.data.code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.deepEqual([r.data.friends, r.data.incoming, r.data.outgoing], [[], [], []]);
  const anaCode = r.data.code;
  assert.equal((await call("/api/friends", { token: ana.token })).data.code, anaCode, "the code stays the same");
  const benCode = (await call("/api/friends", { token: ben.token })).data.code;
  const cyCode = (await call("/api/friends", { token: cy.token })).data.code;
  assert.notEqual(anaCode, benCode);
  step("every account gets its own lasting friend code");

  assert.equal((await call("/api/friends/request", { method: "POST", token: ana.token, body: { code: "nope" } })).status, 400);
  assert.equal((await call("/api/friends/request", { method: "POST", token: ana.token, body: { code: "ZZZZ-ZZZZ" } })).status, 404);
  assert.equal((await call("/api/friends/request", { method: "POST", token: ana.token, body: { code: anaCode } })).data.error, "self");
  step("bad, unknown and own codes are refused");

  r = await call("/api/friends/request", { method: "POST", token: ana.token, body: { code: benCode.toLowerCase().replace("-", " ") } });
  assert.equal(r.status, 200);
  assert.equal(r.data.outgoing.length, 1);
  assert.equal(r.data.outgoing[0].name, "Ben");
  assert.equal((await call("/api/friends/request", { method: "POST", token: ana.token, body: { code: benCode } })).data.error, "already_asked");
  r = await call("/api/friends", { token: ben.token });
  assert.equal(r.data.incoming.length, 1);
  assert.equal(r.data.incoming[0].id, ana.id);
  step("a request shows as outgoing for Ana and incoming for Ben (code typed in any case/spacing)");

  // Ana can't answer her own request; Ben accepts
  assert.equal((await call("/api/friends/respond", { method: "POST", token: ana.token, body: { id: ben.id, accept: true } })).status, 404);
  r = await call("/api/friends/respond", { method: "POST", token: ben.token, body: { id: ana.id, accept: true } });
  assert.equal(r.status, 200);
  assert.equal(r.data.friends.length, 1);
  assert.equal(r.data.friends[0].name, "Ana");
  assert.equal(r.data.friends[0].status, "offline");
  assert.equal((await call("/api/friends/request", { method: "POST", token: ben.token, body: { code: anaCode } })).data.error, "already");
  step("only the asked one can accept; then both are friends");

  // presence
  r = await call("/api/friends/presence", { method: "POST", token: ana.token, body: { state: "playing", server: "DonutSMP.net", mcName: "AnaMC" } });
  assert.equal(r.status, 200);
  r = await call("/api/friends", { token: ben.token });
  assert.equal(r.data.friends[0].status, "playing");
  assert.equal(r.data.friends[0].server, "donutsmp.net");
  assert.equal(r.data.friends[0].mcName, "AnaMC");
  // Cy (not a friend) sees nothing of Ana
  r = await call("/api/friends", { token: cy.token });
  assert.equal(r.data.friends.length, 0);
  step("a friend sees what Ana plays and where; a stranger sees nothing");

  await call("/api/friends/presence", { method: "POST", token: ana.token, body: { state: "playing", server: "evil<script>.net", mcName: "x y" } });
  r = await call("/api/friends", { token: ben.token });
  assert.equal(r.data.friends[0].server, null);
  assert.equal(r.data.friends[0].mcName, null);
  step("odd server addresses and names aren't stored");

  await call("/api/friends/presence", { method: "POST", token: ana.token, body: { state: "online", appearOffline: true } });
  r = await call("/api/friends", { token: ben.token });
  assert.equal(r.data.friends[0].status, "offline");
  assert.equal(r.data.friends[0].lastSeen, null);
  assert.equal(r.data.friends[0].server, undefined);
  assert.equal((await call("/api/friends", { token: ana.token })).data.appearOffline, true);
  // a normal report (no appearOffline in it) keeps her hidden; only turning it off shows her
  await call("/api/friends/presence", { method: "POST", token: ana.token, body: { state: "online" } });
  assert.equal((await call("/api/friends", { token: ben.token })).data.friends[0].status, "offline");
  await call("/api/friends/presence", { method: "POST", token: ana.token, body: { state: "online", appearOffline: false } });
  assert.equal((await call("/api/friends", { token: ben.token })).data.friends[0].status, "online");
  step("Appear offline hides Ana completely; turning it off shows her again");

  r = await call("/api/friends/presence", { method: "POST", token: ana.token, body: { state: "online", list: false } });
  assert.deepEqual(r.data, { ok: true });
  step("presence can skip sending the list back");

  // asking back accepts at once
  await call("/api/friends/request", { method: "POST", token: cy.token, body: { code: anaCode } });
  r = await call("/api/friends/request", { method: "POST", token: ana.token, body: { code: cyCode } });
  assert.equal(r.status, 200);
  assert.equal(r.data.friends.length, 2);
  assert.equal(r.data.incoming.length, 0);
  step("asking someone who already asked you makes you friends at once");

  // decline and remove
  await call("/api/friends/request", { method: "POST", token: cy.token, body: { code: benCode } });
  r = await call("/api/friends/respond", { method: "POST", token: ben.token, body: { id: cy.id, accept: false } });
  assert.equal(r.data.incoming.length, 0);
  assert.equal((await call("/api/friends", { token: cy.token })).data.outgoing.length, 0);
  r = await call("/api/friends/remove", { method: "POST", token: ana.token, body: { id: ben.id } });
  assert.equal(r.data.friends.length, 1);
  assert.equal((await call("/api/friends", { token: ben.token })).data.friends.length, 0);
  step("declining and removing work for both sides");

  // cookie requests from another site can't change anything
  assert.equal((await call("/api/friends/remove", { method: "POST", body: { id: cy.id }, headers: { cookie: "rm_session=" + ana.token, origin: "https://evil.example" } })).status, 403);
  step("cross-site requests are refused");

  // deleting an account takes its friendships with it
  await call("/api/account/delete", { method: "POST", token: cy.token, body: { confirm: "DELETE" } });
  r = await call("/api/friends", { token: ana.token });
  assert.equal(r.data.friends.length, 0);
  assert.equal((await call("/api/friends/request", { method: "POST", token: ana.token, body: { code: cyCode } })).status, 404);
  step("a deleted account's friendships and code are gone");

  console.log("ALL PASSED");
})().catch((e) => {
  console.error("FAILED:", e && e.stack ? e.stack : e);
  process.exit(1);
});

// Local run (an empty test database each time):
//   npx wrangler@4 pages dev site --port 8788 --d1 DB=reminth-friends-test-<new name>
//   node tools/friends-e2e.js
