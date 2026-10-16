// End-to-end check of the sponsored box (functions/api/sponsor/*, functions/api/admin/sponsor.js) and the launcher's
// side (src/main/sponsor.js) against a local server with a pretend Discord - see the bottom. The owner signs in with
// Discord (the mock's player 123456789 = ADMIN_DISCORD_ID); someone else signs up with email.
// node tools/sponsor-e2e.js [baseUrl]
"use strict";
const assert = require("assert/strict");
const BASE = process.argv[2] || "http://127.0.0.1:8788";
const step = (name) => console.log("  ok -", name);

const jar = new Map();
async function req(path, { method = "GET", body, token, useJar = true } = {}) {
  const h = {};
  if (useJar && jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  if (token) h.authorization = "Bearer " + token;
  if (body !== undefined) h["content-type"] = "application/json";
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) {
    const [kv] = c.split(";");
    const i = kv.indexOf("=");
    jar.set(kv.slice(0, i), kv.slice(i + 1));
  }
  return r;
}
const data = async (r) => r.json().catch(() => null);

// a tiny real WebP header + filler (the server checks the first bytes, not the whole picture)
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(3000, 7)]);
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

(async () => {
  console.log("sponsor e2e against", BASE);
  let r = await req("/api/sponsor", { useJar: false });
  assert.equal(r.status, 200);
  assert.deepEqual(await data(r), { sponsor: null });
  assert.equal((await req("/api/sponsor/image?v=1", { useJar: false })).status, 404);
  step("nothing set: the launcher gets null, no picture");

  // someone who isn't the owner
  const email = `x-${Date.now()}@test.dev`;
  r = await req("/api/auth/email", { method: "POST", useJar: false, body: { client: "app", mode: "signup", email, password: "longenough1", name: "Xavi" } });
  const token = (await data(r)).token;
  assert.equal((await req("/api/admin/sponsor", { token, useJar: false })).status, 404);
  assert.equal((await req("/api/admin/sponsor", { method: "POST", token, useJar: false, body: { remove: true } })).status, 404);
  step("not the owner: 404, can't see or change it");

  // the owner, signed in on the website with Discord
  r = await req("/api/auth/discord/start?client=web");
  const state = new URL(r.headers.get("location")).searchParams.get("state");
  r = await req(`/api/auth/discord/callback?code=c1&state=${state}`);
  assert.ok(jar.has("rm_session"), "owner signed in");
  r = await req("/api/admin/sponsor");
  assert.equal(r.status, 200);
  assert.deepEqual(await data(r), { sponsor: null });
  const good = { name: "Example SMP", address: "play.example.net:25570", startDay: day(0), endDay: day(6), image: "data:image/webp;base64," + WEBP.toString("base64") };
  r = await req("/api/admin/sponsor", { method: "POST", body: { ...good, address: "not a server" } });
  assert.equal(r.status, 400);
  assert.match((await data(r)).message, /server address/);
  r = await req("/api/admin/sponsor", { method: "POST", body: { ...good, image: "data:image/png;base64," + WEBP.toString("base64") } });
  assert.equal(r.status, 400, "says png, is webp");
  step("the owner page: bad address and fake picture refused with a plain message");

  r = await req("/api/admin/sponsor", { method: "POST", body: good });
  assert.equal(r.status, 200);
  let s = (await data(r)).sponsor;
  assert.equal(s.live, true);
  assert.equal(s.address, "play.example.net:25570");
  assert.equal(s.endDay, day(6));
  r = await req("/api/sponsor", { useJar: false });
  const pub = (await data(r)).sponsor;
  assert.equal(pub.name, "Example SMP");
  assert.equal(pub.port, 25570);
  assert.equal(r.headers.get("cache-control"), "public, max-age=300");
  r = await req(pub.image, { useJar: false });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "image/webp");
  assert.equal(Buffer.from(await r.arrayBuffer()).equals(WEBP), true);
  step("saved: live for everyone, the picture comes back byte for byte");

  // the launcher's own code against this server
  process.env.REMINTH_API_URL = BASE;
  const sponsor = require("../src/main/sponsor");
  const ls = await sponsor.get();
  assert.equal(ls.name, "Example SMP");
  assert.equal(ls.address, "play.example.net:25570");
  assert.match(ls.image, /^data:image\/webp;base64,/);
  step("the launcher (src/main/sponsor.js) gets it with the picture as a checked data URL");

  // change only the name: the picture stays
  r = await req("/api/admin/sponsor", { method: "POST", body: { ...good, name: "Example SMP 2", image: undefined } });
  assert.equal((await data(r)).sponsor.name, "Example SMP 2");
  assert.match((await data(await req("/api/admin/sponsor"))).sponsor.image, /^data:image\/webp/);
  step("saving without a new picture keeps the old one");

  // starts next week: saved, not shown yet
  r = await req("/api/admin/sponsor", { method: "POST", body: { ...good, startDay: day(7), endDay: day(9) } });
  assert.equal((await data(r)).sponsor.live, false);
  assert.deepEqual(await data(await req("/api/sponsor", { useJar: false })), { sponsor: null });
  step("a slot that starts later isn't shown yet");

  r = await req("/api/admin/sponsor", { method: "POST", body: { remove: true } });
  assert.deepEqual(await data(r), { sponsor: null });
  assert.deepEqual(await data(await req("/api/sponsor", { useJar: false })), { sponsor: null });
  step("taken down: gone");

  r = await req("/api/tools");
  assert.match(await r.text(), /Sponsored box in the launcher/);
  step("the owner tools script has the sponsored box section");
  console.log("ALL PASSED");
})().catch((e) => {
  console.error("FAILED:", e && e.stack ? e.stack : e);
  process.exit(1);
});

// Local run (a new test database each time):  node tools/accounts-mock.js &
//   npx wrangler@4 pages dev site --port 8788 --d1 DB=reminth-sponsor-test-<new name> --binding DISCORD_CLIENT_ID=test-id \
//     --binding DISCORD_CLIENT_SECRET=test-secret --binding DISCORD_API=http://127.0.0.1:8799 --binding ADMIN_DISCORD_ID=123456789
//   node tools/sponsor-e2e.js
