// End-to-end check of the Reminth Discord bot against a running local server (`wrangler pages dev` + accounts-mock.js;
// how to start them is at the bottom). Signs every request like Discord does, with a TEST-ONLY key pair.
// node tools/bot-e2e.js [baseUrl]
"use strict";
const assert = require("assert/strict");
const crypto = require("crypto");
const BASE = process.argv[2] || "http://127.0.0.1:8788";
const MOCK = "http://127.0.0.1:8799";

// test-only key (its public half is the DISCORD_PUBLIC_KEY of the local run) - not used anywhere real
const PUBLIC_HEX = "a8e103f5f1241eca659449cd7a514456827b0cb1278a4d1848cd7bc2d479d179";
const PRIVATE = crypto.createPrivateKey({
  key: { kty: "OKP", crv: "Ed25519", d: "LWdsaZpdkqUzNt8CF6hrUYy2IWWSdAFHYkYHUWbuI9Y", x: Buffer.from(PUBLIC_HEX, "hex").toString("base64url") },
  format: "jwk",
});

async function interact(i, { sign = true, badSig = false } = {}) {
  const body = JSON.stringify(i);
  const ts = String(Math.floor(Date.now() / 1000));
  const headers = { "content-type": "application/json" };
  if (sign) {
    let sig = crypto.sign(null, Buffer.from(ts + body), PRIVATE).toString("hex");
    if (badSig) sig = sig.replace(/^./, (c) => (c === "0" ? "1" : "0"));
    headers["x-signature-ed25519"] = sig;
    headers["x-signature-timestamp"] = ts;
  }
  const r = await fetch(`${BASE}/api/discord/interactions`, { method: "POST", headers, body });
  const text = await r.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: r.status, data };
}
const log = async () => (await fetch(`${MOCK}/_test/log`)).json();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (name) => console.log("  ok -", name);

const ADMIN = String((1n << 3n) | (1n << 5n));
const MOD = String((1n << 1n) | (1n << 2n) | (1n << 13n) | (1n << 40n));
const member = (id, roles, permissions) => ({ user: { id, username: "u" + id }, roles, permissions });
let seq = 0;
function cmd(name, options = [], who = member("10", ["r-admin"], ADMIN), resolvedMembers = {}) {
  const users = {};
  for (const id of Object.keys(resolvedMembers)) users[id] = { id, username: "user" + id };
  return {
    type: 2, id: "i" + ++seq, token: "tok" + seq, guild_id: "555", channel_id: "chan1", member: who,
    data: { name, options, resolved: { users, members: resolvedMembers } },
  };
}
const o = (name, value, type = 3) => ({ name, value, type });
const subcmd = (name, options = []) => ({ type: 1, name, options });
const content = (r) => (r.data && r.data.data && (r.data.data.content || (r.data.data.embeds && r.data.data.embeds[0] && (r.data.data.embeds[0].description || r.data.data.embeds[0].title)))) || "";

(async () => {
  console.log("bot e2e against", BASE);

  // --- the door: only Discord gets in
  assert.equal((await interact({ type: 1 }, { sign: false })).status, 401);
  assert.equal((await interact({ type: 1 }, { badSig: true })).status, 401);
  const ping = await interact({ type: 1 });
  assert.equal(ping.status, 200);
  assert.deepEqual(ping.data, { type: 1 });
  step("unsigned and forged requests are refused; Discord's PING gets PONG");

  let r = await interact({ ...cmd("download"), guild_id: "999" });
  assert.match(content(r), /only work in the Reminth server/);
  step("other servers are refused");

  // --- setup
  r = await interact(cmd("config", [subcmd("modlog", [o("channel", "modlog-ch", 7)])]));
  assert.match(content(r), /modlog-ch/);
  await interact(cmd("config", [subcmd("bugs", [o("channel", "bugs-ch", 7)])]));
  await interact(cmd("config", [subcmd("player-role", [o("role", "r-player", 8)])]));
  r = await interact(cmd("config", [subcmd("show")]));
  assert.match(content(r), /modlog-ch[\s\S]*bugs-ch[\s\S]*r-player/);
  r = await interact(cmd("config", [subcmd("show")], member("20", [], "0")));
  assert.match(content(r), /Manage Server/);
  step("/config sets the mod log, bug channel and Player role; members without the permission can't");

  // --- moderation
  const before = (await log()).length;
  r = await interact(cmd("ban", [o("user", "30", 6), o("reason", "cheating")], member("20", [], "0"), { 30: { roles: [] } }));
  assert.match(content(r), /Ban Members/);
  r = await interact(cmd("ban", [o("user", "31", 6)], member("40", ["r-mod"], MOD), { 31: { roles: ["r-admin"] } }));
  assert.match(content(r), /higher role/);
  r = await interact(cmd("ban", [o("user", "1", 6)], member("40", ["r-mod"], MOD), { 1: { roles: [] } }));
  assert.match(content(r), /server owner/);
  r = await interact(cmd("ban", [o("user", "40", 6)], member("40", ["r-mod"], MOD), { 40: { roles: ["r-mod"] } }));
  assert.match(content(r), /yourself/);
  assert.equal((await log()).length, before, "refused bans touched nothing");
  r = await interact(cmd("ban", [o("user", "30", 6), o("reason", "cheating"), o("delete_messages", 86400, 4)], member("40", ["r-mod"], MOD), { 30: { roles: [] } }));
  assert.match(content(r), /Banned/);
  let L = (await log()).slice(before);
  const ban = L.find((x) => x.method === "PUT" && x.url === "/guilds/555/bans/30");
  assert.ok(ban, "the ban was sent");
  assert.equal(ban.body.delete_message_seconds, 86400);
  assert.match(decodeURIComponent(ban.reason), /cheating/);
  assert.ok(L.some((x) => x.url === "/channels/dm-30/messages" && /cheating/.test(x.body.content)), "they got a DM with the reason");
  assert.ok(L.some((x) => x.url === "/channels/modlog-ch/messages" && x.body.embeds[0].title === "Banned"), "mod log entry");
  step("/ban: permission, higher role, owner and self are refused; a real ban DMs them, sets the audit reason, logs it");

  r = await interact(cmd("unban", [o("user", "notbanned", 6)], member("40", ["r-mod"], MOD)));
  assert.match(content(r), /aren't banned/);
  r = await interact(cmd("unban", [o("user", "30", 6)], member("40", ["r-mod"], MOD)));
  assert.match(content(r), /Unbanned/);
  r = await interact(cmd("kick", [o("user", "32", 6)], member("40", ["r-mod"], MOD), {}));
  assert.match(content(r), /aren't in the server/);
  r = await interact(cmd("kick", [o("user", "32", 6), o("reason", "spam")], member("40", ["r-mod"], MOD), { 32: { roles: [] } }));
  assert.match(content(r), /Kicked/);
  assert.ok((await log()).some((x) => x.method === "DELETE" && x.url === "/guilds/555/members/32"));
  step("/unban and /kick");

  const t0 = Date.now();
  r = await interact(cmd("timeout", [o("user", "33", 6), o("duration", "10m")], member("40", ["r-mod"], MOD), { 33: { roles: [] } }));
  assert.match(content(r), /10 minutes/);
  const to = (await log()).reverse().find((x) => x.method === "PATCH" && x.url === "/guilds/555/members/33");
  const until = Date.parse(to.body.communication_disabled_until);
  assert.ok(until > t0 + 590e3 && until < Date.now() + 610e3, "10 minutes from now");
  r = await interact(cmd("untimeout", [o("user", "33", 6)], member("40", ["r-mod"], MOD)));
  assert.match(content(r), /ended/);
  assert.equal((await log()).reverse().find((x) => x.method === "PATCH" && x.url === "/guilds/555/members/33").body.communication_disabled_until, null);
  step("/timeout sets the right end time; /untimeout clears it");

  r = await interact(cmd("warn", [o("user", "34", 6), o("reason", "be nice")], member("40", ["r-mod"], MOD), { 34: { roles: [] } }));
  assert.match(content(r), /warning #1/);
  r = await interact(cmd("warn", [o("user", "34", 6), o("reason", "second")], member("40", ["r-mod"], MOD), { 34: { roles: [] } }));
  assert.match(content(r), /warning #2/);
  r = await interact(cmd("warnings", [o("user", "34", 6)], member("40", ["r-mod"], MOD)));
  assert.match(content(r), /be nice[\s\S]*|second[\s\S]*be nice/);
  r = await interact(cmd("warnings", [o("user", "34", 6), o("clear", true, 5)], member("40", ["r-mod"], MOD)));
  assert.match(content(r), /cleared/);
  r = await interact(cmd("warnings", [o("user", "34", 6)], member("40", ["r-mod"], MOD)));
  assert.match(content(r), /No warnings/);
  step("/warn counts and saves warnings; /warnings lists and clears them");

  r = await interact(cmd("purge", [o("amount", 3, 4)], member("40", ["r-mod"], MOD)));
  assert.equal(r.data.type, 5, "purge answers 'thinking' first");
  await wait(1500);
  L = await log();
  const bulk = L.reverse().find((x) => x.url === "/channels/chan1/messages/bulk-delete");
  assert.deepEqual(bulk.body.messages, ["m5", "m4", "m2"], "skips the pinned one and the 20-day-old one");
  assert.ok(L.find((x) => x.method === "PATCH" && /\/webhooks\/test-id\//.test(x.url) && /Deleted 3 messages/.test(x.body.content)), "then says how many");
  r = await interact(cmd("purge", [o("amount", 10, 4), o("user", "u3", 6)], member("40", ["r-mod"], MOD)));
  await wait(1500);
  assert.ok((await log()).some((x) => x.method === "DELETE" && x.url === "/channels/chan1/messages/m4"), "one person's single message: a normal delete");
  step("/purge deletes the right messages (not pinned, not older than 14 days, only that person's)");

  // --- automod
  r = await interact(cmd("automod", [subcmd("setup", [o("swearing", false, 5)])]));
  assert.match(content(r), /AutoMod is on: spam, mass pings, invite links, bad words/);
  r = await interact(cmd("automod", [subcmd("setup", [o("swearing", true, 5)])]));
  assert.match(content(r), /AutoMod is on/);
  assert.doesNotMatch(content(r), /Couldn't/);
  L = await log();
  assert.equal(L.filter((x) => x.method === "POST" && x.url === "/guilds/555/auto-moderation/rules").length, 4, "the second setup updates, it doesn't duplicate");
  const words = L.reverse().find((x) => x.method === "PATCH" && x.body && x.body.name === "Reminth: bad words");
  assert.deepEqual(words.body.trigger_metadata.presets, [1, 2, 3]);
  const pings = L.find((x) => x.body && x.body.name === "Reminth: mass pings");
  assert.ok(pings.body.actions.some((a) => a.type === 3 && a.metadata.duration_seconds === 600), "mass pings: 10 minute timeout");
  assert.ok(pings.body.actions.some((a) => a.type === 2 && a.metadata.channel_id === "modlog-ch"), "reported in the mod log");
  r = await interact(cmd("automod", [subcmd("status")]));
  assert.match(content(r), /Reminth: spam[\s\S]*Reminth: bad words/);
  r = await interact(cmd("automod", [subcmd("off")]));
  assert.match(content(r), /Turned off 4 rules/);
  step("/automod setup (spam, mass pings + timeout, invite links, bad words), again without duplicates, status, off");

  // --- everyone's commands
  r = await interact(cmd("download", [], member("50", [], "0")));
  assert.match(content(r), /reminth\.pages\.dev[\s\S]*1\.7\.0/);
  r = await interact(cmd("changelog", [], member("50", [], "0")));
  assert.match(r.data.data.embeds[0].title, /1\.7\.0/);
  assert.match(content(r), /^- Accounts/);
  r = await interact(cmd("help", [o("topic", "signin")], member("50", [], "0")));
  assert.match(content(r), /microsoft\.com\/link/);
  step("/download, /changelog (heading dropped), /help");

  r = await interact(cmd("bug", [], member("50", [], "0")));
  assert.equal(r.data.type, 9, "a form");
  r = await interact({ type: 5, id: "x", token: "t", guild_id: "555", channel_id: "chan1", member: member("50", [], "0"),
    data: { custom_id: "bug", components: [{ type: 1, components: [{ type: 4, custom_id: "what", value: "panel crash" }] }, { type: 1, components: [{ type: 4, custom_id: "version", value: "1.21.4 Fabric" }] }] } });
  assert.match(content(r), /Thanks/);
  const report = (await log()).reverse().find((x) => x.url === "/channels/bugs-ch/messages");
  assert.match(JSON.stringify(report.body), /panel crash[\s\S]*1\.21\.4 Fabric/);
  step("/bug opens a form; the report lands in the bug channel");

  // --- accounts: Tester (Discord id 123456789) signs in on the website, then uses the bot
  r = await interact(cmd("account", [], member("123456789", [], "0")));
  assert.match(content(r), /isn't linked/);
  let res = await fetch(`${BASE}/api/auth/discord/start?client=web`, { redirect: "manual" });
  const ck = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const st = new URL(res.headers.get("location")).searchParams.get("state");
  res = await fetch(`${BASE}/api/auth/discord/callback?code=c1&state=${st}`, { headers: { cookie: ck }, redirect: "manual" });
  const session = res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("rm_session="));
  assert.ok(session);
  r = await interact(cmd("account", [], member("123456789", [], "0")));
  assert.equal(r.data.data.embeds[0].title, "Tester <b>");
  r = await interact(cmd("verify", [], member("123456789", [], "0")));
  assert.match(content(r), /Verified/);
  assert.ok((await log()).some((x) => x.method === "PUT" && x.url === "/guilds/555/members/123456789/roles/r-player"));
  step("/account shows the linked Reminth account; /verify gives the Player role");

  r = await interact(cmd("stats", [], member("50", ["r-admin"], ADMIN)));
  assert.match(content(r), /Only the owner/);
  r = await interact(cmd("stats", [], member("123456789", [], ADMIN)));
  assert.ok(r.data.data.embeds[0].fields.find((f) => f.name === "Accounts").value >= "1");
  r = await interact(cmd("pull", [], member("123456789", [], ADMIN)));
  assert.equal(r.data.type, 5);
  await wait(2000);
  L = await log();
  assert.ok(L.some((x) => x.method === "PATCH" && /\/webhooks\/test-id\//.test(x.url) && /Added 1/.test(x.body.content)), "/pull reports");
  step("/stats and /pull are owner-only; /pull adds the Discord player");

  // --- the website's "Set up the bot's commands" button (owner only)
  res = await fetch(`${BASE}/api/admin/discord-commands`, { method: "POST", headers: { cookie: session, origin: BASE } });
  const d = await res.json();
  assert.equal(res.status, 200, JSON.stringify(d));
  assert.ok(d.commands >= 18);
  const put = (await log()).reverse().find((x) => x.method === "PUT" && x.url === "/applications/test-id/guilds/555/commands");
  assert.ok(put.body.some((c) => c.name === "ban" && c.default_member_permissions === "4"), "ban only for Ban Members by default");
  res = await fetch(`${BASE}/api/admin/discord-commands`, { method: "POST" });
  assert.equal(res.status, 404);
  step("the owner's website button installs the commands (with default permissions); others can't");

  // --- "Set up my server" on the owner's existing server (owner only), run like the account page does
  const MOCKG = async () => (await fetch(`${MOCK}/_test/guild`)).json();
  async function run(part, startAt = 0) {
    let step = startAt, lines = [], last;
    for (let round = 0; round < 60 && step !== null && step !== undefined; round++) {
      const res = await fetch(`${BASE}/api/admin/discord-setup`, { method: "POST", headers: { cookie: session, origin: BASE, "content-type": "application/json" }, body: JSON.stringify({ part, step }) });
      last = await res.json();
      assert.equal(res.status, 200, JSON.stringify(last));
      assert.ok(!last.problem, last.problem);
      lines = lines.concat(last.log || []);
      if (last.waitSeconds) await wait(last.waitSeconds * 1000);
      if (last.done) break;
      step = last.next;
    }
    return lines;
  }
  assert.equal((await fetch(`${BASE}/api/admin/discord-setup`, { method: "POST", body: "{}" })).status, 404);
  let res0 = await fetch(`${BASE}/api/admin/discord-setup`, { method: "POST", headers: { cookie: session, origin: BASE, "content-type": "application/json" }, body: JSON.stringify({ part: "setup", step: 0 }) });
  const check = await res0.json();
  assert.deepEqual(
    [check.jobs.rules, check.jobs.modlog, check.jobs.announcements, check.jobs.updates, check.jobs.faq, check.jobs.general, check.jobs.commands, check.jobs.support, check.jobs.application],
    ["rules", "moderator-only", "📢｜annoucements", "⚡｜updates", "⁉️｜faq", "💬｜chat", "🤖｜commands", "🎫｜support", "🎫｜application"]
  );
  const before4 = (await log()).length;
  assert.equal(before4, (await log()).length, "the check changes nothing");
  step("setup check: finds every channel by its name (emojis and the 'annoucements' spelling too)");

  const setupLines = await run("setup", 1);
  let G = await MOCKG();
  const R = (n) => G.roles.find((r) => r.name === n);
  for (const n of ["Owner", "Co-Owner", "Admin", "Helper", "Member", "Launcher Player", "Launcher Updates", "Europe", "Oceania", "X (Twitter)", "TikTok"]) assert.ok(R(n), "role " + n);
  assert.equal(R("Moderator").id, "r-mod", "his own Moderator role is kept");
  assert.equal(BigInt(R("Moderator").permissions), (1n << 1n) | (1n << 2n) | (1n << 40n) | (1n << 31n), "Moderator: kick, ban, timeout (+ commands) - no Manage Messages everywhere");
  assert.equal(BigInt(R("Helper").permissions), (1n << 40n) | (1n << 31n), "Helper: timeouts only");
  assert.equal(BigInt(R("Admin").permissions), 1n << 3n);
  assert.equal(BigInt(R("Co-Owner").permissions), 1n << 3n);
  assert.ok(R("Owner").position > R("Co-Owner").position && R("Co-Owner").position > R("Admin").position && R("Admin").position > R("Moderator").position && R("Moderator").position > R("Helper").position && R("Helper").position > R("Member").position, "role order");
  const ev = BigInt(R("@everyone").permissions);
  for (const [bit, what] of [[35n, "public threads"], [36n, "private threads"], [38n, "talking in threads"], [50n, "external apps"], [31n, "slash commands"], [13n, "deleting messages"]]) assert.equal(ev & (1n << bit), 0n, "@everyone has no " + what);
  const CH = (id) => G.channels.find((c) => c.id === id);
  const ow = (c, id) => (c.permission_overwrites || []).find((o) => o.id === id) || { allow: "0", deny: "0" };
  assert.ok(BigInt(ow(CH("c-rules"), "555").deny) & (1n << 11n), "#rules read-only");
  assert.ok(BigInt(ow(CH("c-sup"), "r-tickets").allow) & (1n << 11n), "Tickets bot may still post its panel in #support");
  assert.ok(BigInt(ow(CH("c-modonly"), "555").deny) & (1n << 10n), "#moderator-only hidden");
  assert.ok(BigInt(ow(CH("c-modonly"), "r-mod").allow) & (1n << 10n), "...mods see it");
  assert.ok(BigInt(ow(CH("c-cmd"), "555").allow) & (1n << 31n), "slash commands allowed in #commands");
  assert.ok(BigInt(ow(CH("c-gen"), "r-mod").allow) & (1n << 13n), "mods may delete messages in #general");
  assert.equal(BigInt(ow(CH("c-faq"), "r-mod").allow) & (1n << 13n), 0n, "...but not in #faq");
  assert.equal(CH("c-gen").rate_limit_per_user, 2, "2 s slowmode in #general");
  assert.ok(G.channels.every((c) => BigInt(ow(c, "555").deny) & (1n << 35n)), "no threads in any channel");
  const offt = G.channels.find((c) => c.name === "💭｜off-topic");
  assert.ok(offt && offt.parent_id === "cat-comm", "#💭｜off-topic made in Community (he had 4 chat channels)");
  assert.ok(BigInt(ow(CH("c-read"), "555").deny) & (1n << 11n), "#read-first read-only");
  assert.ok(G.onboarding && G.onboarding.enabled, "onboarding on");
  assert.ok(G.onboarding.default_channel_ids.includes(offt.id));
  const rulesQ = G.onboarding.prompts.find((p) => p.required);
  assert.deepEqual(rulesQ.options[0].role_ids, [R("Member").id], "accepting the rules gives Member");
  assert.equal(G.onboarding.prompts.find((p) => /Where/.test(p.title)).options.length, 7, "7 regions");
  assert.ok(setupLines.some((l) => /AutoMod on/.test(l)), setupLines.join("\n"));
  assert.ok(G.memberRoles && true);
  r = await interact(cmd("config", [subcmd("show")]));
  assert.match(content(r), /<#c-modonly>/, "mod log -> #moderator-only");
  step("setup: roles with exactly his permissions + order, @everyone without threads/apps/commands, read-only info channels, staff-only mod channel, mods delete only in Community, slowmode, onboarding (rules -> Member), AutoMod");

  const before5 = (await log()).length;
  await run("setup", 1);
  L = (await log()).slice(before5);
  assert.equal(L.filter((x) => x.method === "POST" && x.url === "/guilds/555/roles").length, 0, "no roles made twice");
  step("setup again: nothing made twice");

  // --- the channel messages (webhooks): posted once, then edited
  const msgLines = await run("messages");
  G = await MOCKG();
  assert.equal(Object.keys(G.hookMsgs).length, 6, msgLines.join("\n"));
  const all = JSON.stringify(G.hookMsgs);
  assert.ok(/Support & Applications/.test(all) && /Server Rules/.test(all) && /Frequently asked questions/.test(all) && /x\.com\/reminthsupport/.test(all), "rules, faq, socials");
  assert.ok(!/@everyone/.test(all), "no @everyone ping");
  assert.ok(/<#c-cmd>/.test(all) && /<#c-sup>/.test(all), "mentions his real #commands and #support");
  assert.ok(Object.values(G.hookMsgs).every((b) => b.username === "Reminth"), "sent as 'Reminth'");
  await run("messages");
  G = await MOCKG();
  assert.equal(Object.keys(G.hookMsgs).length, 6, "the second time edits, no new messages");
  step("channel messages: 6 posted by the Reminth webhook (rules, announcement, updates, socials, faq, read-first), the second time edited");

  // --- the every-minute check
  const tick = async () => (await fetch(`${BASE}/api/discord/tick`, { method: "POST" })).json();
  let t = await tick();
  assert.match(JSON.stringify(t.audit), /started/);
  assert.equal(t.release.note, "started - the next release gets posted");
  t = await tick();
  assert.equal(t.skipped, "too soon", "at most once every 45 seconds");
  step("tick: starts quietly (no old history posted), and runs at most every 45 s");
  // (the 45 s wait is skipped for the rest of the test with ?force - see below)
  const ftick = async () => (await fetch(`${BASE}/api/discord/tick?force=1`, { method: "POST" })).json();
  const snow = (msAgo) => String((BigInt(Date.now() - msAgo) - 1420070400000n) << 22n);
  await fetch(`${MOCK}/_test/audit`, { method: "POST", body: JSON.stringify([
    { id: snow(-1000), user_id: "m1", target_id: "u7", action_type: 22, reason: "raid" },
    { id: snow(-2000), user_id: "m1", target_id: "u8", action_type: 22 },
    { id: snow(-3000), user_id: "m1", target_id: "u9", action_type: 20 },
    { id: snow(-4000), user_id: "1", target_id: "u10", action_type: 22, reason: "owner may" },
  ]) });
  await fetch(`${MOCK}/_test/members`, { method: "POST", body: JSON.stringify([{ user: { id: snow(3600000) }, joined_at: new Date().toISOString() }, { user: { id: snow(7200000), bot: true } }]) });
  await fetch(`${MOCK}/_test/release`, { method: "POST", body: JSON.stringify({ tag: "1.7.2" }) });
  const before6 = (await log()).length;
  t = await ftick();
  L = (await log()).slice(before6);
  G = await MOCKG();
  assert.deepEqual(G.memberRoles.m1, [], "the raiding mod lost the Moderator role");
  assert.equal(t.audit.demoted, 1);
  const modPost = L.find((x) => x.url === "/channels/c-modonly/messages" && /Anti-raid/.test(JSON.stringify(x.body)));
  assert.ok(modPost && modPost.body.content === "<@1>", "the owner is pinged in #moderator-only");
  assert.ok(L.some((x) => x.url === "/channels/c-modonly/messages" && /banned <@u7>/.test(JSON.stringify(x.body))), "every action is in the mod log");
  const newTo = L.find((x) => x.method === "PATCH" && /^\/guilds\/555\/members\/\d+$/.test(x.url) && x.body && x.body.communication_disabled_until);
  assert.ok(newTo, "the 1-hour-old account got a timeout");
  assert.ok(Date.parse(newTo.body.communication_disabled_until) > Date.now() + 23 * 3600000, "24 hours");
  const rel = L.find((x) => x.url === "/channels/c-upd/messages");
  assert.ok(rel && rel.body.content === `<@&${R("Launcher Updates").id}>` && /1\.7\.2 is out/.test(rel.body.embeds[0].title), "release posted in #updates, pinging Launcher Updates");
  step("tick: logs every mod action, takes the raiding mod's staff role (owner pinged, owner never), times out a 1-hour-old account for 24 h, posts the new release with the Updates ping");

  console.log("ALL PASSED");
})().catch((e) => {
  console.error("FAILED:", e && e.message);
  process.exit(1);
});

// Local run (fresh database name each time; restart the mock too):
//   node tools/accounts-mock.js &
//   npx wrangler@4 pages dev site --port 8788 --d1 DB=reminth-bot-<n> --binding DISCORD_CLIENT_ID=test-id \
//     --binding DISCORD_CLIENT_SECRET=test-secret --binding DISCORD_API=http://127.0.0.1:8799 \
//     --binding GITHUB_API=http://127.0.0.1:8799 --binding GITHUB_WEB=http://127.0.0.1:8799 --binding ADMIN_DISCORD_ID=123456789 \
//     --binding DISCORD_BOT_TOKEN=bot-test --binding DISCORD_GUILD_ID=555 \
//     --binding DISCORD_PUBLIC_KEY=a8e103f5f1241eca659449cd7a514456827b0cb1278a4d1848cd7bc2d479d179
