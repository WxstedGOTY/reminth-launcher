// A pretend Discord API + Google for the local account test (tools/accounts-e2e.js). node tools/accounts-mock.js
// Discord: any code works; code "other" is the player "Other" (id 987), any other code "Tester <b>" (id 123456789).
// Google (under /google): any code is the player "Gina" (sub g-42).
// The guild route remembers who was added (201 the first time, 204 after); bot token "bot-test", guild "555".
// The bot's REST calls (tools/bot-e2e.js) are answered like Discord and recorded: GET /_test/log.
"use strict";
const http = require("http");
const members = new Set();
const revoked = [];
const log = [];
let rules = [];
let ruleId = 1;
// the owner's real server layout (10 Oct 2026), for "Set up my server"
const ALL = String((1n << 51n) - 1n & ~(1n << 3n)); // every permission except Administrator
const guildRoles = [
  { id: "555", name: "@everyone", permissions: ALL, position: 0 },
  { id: "r-mod", name: "Moderator", permissions: "8192", color: 1, position: 2 }, // he made one, with Manage Messages
  { id: "r-tickets", name: "Tickets", permissions: "8", position: 1, tags: { bot_id: "tk" } },
];
const C = (id, name, type, parent_id) => ({ id, name, type, parent_id: parent_id || null, permission_overwrites: [] });
const guildChannels = [
  C("c-rules", "rules", 0), C("c-modonly", "moderator-only", 0),
  C("cat-info", "Information", 4), C("c-ann", "📢｜annoucements", 0, "cat-info"), C("c-upd", "⚡｜updates", 0, "cat-info"), C("c-soc", "👥｜socials", 0, "cat-info"),
  C("c-give", "🎉｜giveaways", 0, "cat-info"), C("c-ev", "✳️｜events", 0, "cat-info"), C("c-boost", "💎｜boosts", 0, "cat-info"), C("c-faq", "⁉️｜faq", 0, "cat-info"),
  C("cat-comm", "Community", 4), C("c-gen", "💬｜general", 0, "cat-comm"), C("c-clips", "🎬｜clips", 0, "cat-comm"), C("c-sugg", "🌐｜suggestions", 0, "cat-comm"),
  C("c-cmd", "🤖｜commands", 0, "cat-comm"), C("c-offt", "💭｜off-topic", 0, "cat-comm"),
  C("cat-sup", "Support", 4), C("c-sup", "🎫｜support", 0, "cat-sup"), C("c-app", "🎫｜application", 0, "cat-sup"),
];
let onboarding = null;
const hooks = {}; // channel id -> [{id, token, name}]
const hookMsgs = {}; // message id -> body
let audit = []; // audit log entries the test adds
let newMembers = []; // members the test adds
const memberRoles = { m1: ["r-mod"], owner1: [] };
let releaseTag = "1.7.0";
const BOT_OWNER = "1";
const NOW = Date.now();
const MESSAGES = [
  { id: "m5", author: { id: "u2" }, timestamp: new Date(NOW - 60e3).toISOString() },
  { id: "m4", author: { id: "u3" }, timestamp: new Date(NOW - 120e3).toISOString() },
  { id: "m3", author: { id: "u2" }, timestamp: new Date(NOW - 180e3).toISOString(), pinned: true },
  { id: "m2", author: { id: "u2" }, timestamp: new Date(NOW - 240e3).toISOString() },
  { id: "m1", author: { id: "u2" }, timestamp: new Date(NOW - 20 * 86400e3).toISOString() },
];
http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      const send = (status, obj) => {
        res.statusCode = status;
        res.end(obj === undefined ? "" : JSON.stringify(obj));
      };
      const p = new URLSearchParams(body);
      // --- Discord
      if (req.method === "POST" && req.url === "/oauth2/token") {
        if (p.get("client_secret") !== "test-secret") return send(401, {});
        if (p.get("grant_type") === "refresh_token") {
          const rt = p.get("refresh_token") || "";
          if (!rt.startsWith("rt-") || revoked.includes(rt)) return send(400, { error: "invalid_grant" });
          const who = rt.split("-")[1];
          return send(200, { access_token: `at-${who}`, refresh_token: `rt-${who}-${Date.now()}`, scope: "identify guilds.join" });
        }
        if (!p.get("code")) return send(400, {});
        const who = p.get("code") === "other" ? "other" : "tester";
        return send(200, { access_token: `at-${who}`, refresh_token: `rt-${who}-0`, scope: "identify guilds.join", token_type: "Bearer" });
      }
      if (req.method === "POST" && req.url === "/oauth2/token/revoke") {
        revoked.push(p.get("token"));
        return send(200, {});
      }
      if (req.url === "/users/@me" && /^Bearer at-/.test(req.headers.authorization || "")) {
        const who = req.headers.authorization.includes("other")
          ? { id: "987", username: "other", global_name: "Other" }
          : { id: "123456789", username: "tester", global_name: "Tester <b>", avatar: "abc123" };
        return send(200, who);
      }
      const g = /^\/guilds\/(\d+)\/members\/(\d+)$/.exec(req.url.replace(/^\/v10/, ""));
      if (req.method === "PUT" && g) {
        if (req.headers.authorization !== "Bot bot-test") return send(401, { message: "401: Unauthorized", code: 0 });
        if (g[1] !== "555") return send(404, { message: "Unknown Guild", code: 10004 });
        const j = JSON.parse(body || "{}");
        if (!/^at-/.test(j.access_token || "")) return send(403, { message: "Missing Access", code: 50001 });
        if (members.has(g[2])) return send(204);
        members.add(g[2]);
        return send(201, { user: { id: g[2] } });
      }
      if (req.url === "/_test/state") return send(200, { members: [...members], revoked });
      if (req.url === "/_test/log") return send(200, log);
      // test controls: add audit log entries / new members, set the latest release, look at the server
      if (req.method === "POST" && req.url === "/_test/audit") {
        audit = audit.concat(JSON.parse(body));
        return send(200, {});
      }
      if (req.method === "POST" && req.url === "/_test/members") {
        newMembers = JSON.parse(body);
        return send(200, {});
      }
      if (req.method === "POST" && req.url === "/_test/release") {
        releaseTag = JSON.parse(body).tag;
        return send(200, {});
      }
      if (req.url === "/_test/guild") return send(200, { roles: guildRoles, channels: guildChannels, onboarding, hooks, hookMsgs, memberRoles });
      // --- GitHub (GITHUB_API)
      if (req.url === "/repos/WxstedGOTY/reminth-launcher/releases/latest")
        return send(200, { tag_name: releaseTag, body: ` Reminth ${releaseTag}\r\n- Accounts\r\n- Blue theme`, html_url: `https://github.com/x/releases/${releaseTag}` });
      // --- webhooks (no bot token needed; the token is in the address)
      const wurl = req.url.replace(/^\/v10/, "");
      let wm;
      if (req.method === "POST" && (wm = /^\/webhooks\/(wh-[\w-]+)\/(tok-[\w-]+)\?wait=true$/.exec(wurl))) {
        const id = "hm-" + Object.keys(hookMsgs).length;
        hookMsgs[id] = JSON.parse(body);
        log.push({ method: "POST", url: wurl, body: JSON.parse(body) });
        return send(200, { id });
      }
      if (req.method === "PATCH" && (wm = /^\/webhooks\/(wh-[\w-]+)\/(tok-[\w-]+)\/messages\/([\w-]+)$/.exec(wurl))) {
        if (!hookMsgs[wm[3]]) return send(404, { message: "Unknown Message" });
        hookMsgs[wm[3]] = JSON.parse(body);
        log.push({ method: "PATCH", url: wurl, body: JSON.parse(body) });
        return send(200, { id: wm[3] });
      }
      // --- the bot's REST calls
      const url = req.url.replace(/^\/v10/, "");
      const isBot = req.headers.authorization === "Bot bot-test";
      const rec = () => log.push({ method: req.method, url, body: body ? JSON.parse(body) : null, reason: req.headers["x-audit-log-reason"] || null });
      let m;
      if (req.method === "PATCH" && /^\/webhooks\/test-id\/[^/]+\/messages\/@original$/.test(url)) {
        rec();
        return send(200, {});
      }
      if (url.startsWith("/guilds/") || url.startsWith("/channels/") || url.startsWith("/users/@me/channels") || url.startsWith("/applications/")) {
        if (!isBot) return send(401, { message: "401: Unauthorized", code: 0 });
        if (req.method === "GET" && url === "/guilds/555")
          return send(200, { id: "555", owner_id: BOT_OWNER, verification_level: 0, explicit_content_filter: 0, roles: [{ id: "555", position: 0 }, { id: "r-mod", name: "Moderator", position: 5 }, { id: "r-admin", position: 10 }] });
        if (req.method === "GET" && url === "/guilds/555/auto-moderation/rules") return send(200, rules);
        if (req.method === "GET" && url === "/guilds/555/roles") return send(200, guildRoles);
        if (req.method === "GET" && url === "/guilds/555/channels") return send(200, guildChannels);
        if (req.method === "GET" && url.startsWith("/guilds/555/audit-logs")) {
          const after = new URL("http://x" + url).searchParams.get("after");
          return send(200, { audit_log_entries: audit.filter((e) => !after || BigInt(e.id) > BigInt(after)).reverse() });
        }
        if (req.method === "GET" && url.startsWith("/guilds/555/members?")) return send(200, newMembers);
        if (req.method === "GET" && (m = /^\/guilds\/555\/members\/(\w+)$/.exec(url))) return memberRoles[m[1]] ? send(200, { user: { id: m[1] }, roles: memberRoles[m[1]] }) : send(404, {});
        if (req.method === "GET" && (m = /^\/channels\/([\w-]+)\/webhooks$/.exec(url))) return send(200, hooks[m[1]] || []);
        rec();
        if (req.method === "POST" && url === "/guilds/555/roles") {
          const r = { ...JSON.parse(body), id: "role-" + guildRoles.length, position: 1 };
          guildRoles.push(r);
          return send(200, r);
        }
        if (req.method === "PATCH" && url === "/guilds/555/roles") {
          for (const p of JSON.parse(body)) {
            const r = guildRoles.find((x) => x.id === p.id);
            if (r) r.position = p.position;
          }
          return send(200, guildRoles);
        }
        if (req.method === "PATCH" && (m = /^\/guilds\/555\/roles\/([\w-]+)$/.exec(url))) {
          const r = guildRoles.find((x) => x.id === m[1]);
          if (!r) return send(404, {});
          Object.assign(r, JSON.parse(body));
          return send(200, r);
        }
        if (req.method === "PATCH" && (m = /^\/channels\/([\w-]+)$/.exec(url))) {
          const c = guildChannels.find((x) => x.id === m[1]);
          if (!c) return send(404, {});
          Object.assign(c, JSON.parse(body));
          return send(200, c);
        }
        if (req.method === "PUT" && url === "/guilds/555/onboarding") {
          const b = JSON.parse(body);
          // Discord's rule: 7 default channels, 5 of them where @everyone can write
          const canWrite = b.default_channel_ids.filter((id) => {
            const c = guildChannels.find((x) => x.id === id);
            const e = c && (c.permission_overwrites || []).find((o) => o.id === "555");
            return c && !(e && BigInt(e.deny) & (1n << 11n));
          });
          if (b.default_channel_ids.length < 7 || canWrite.length < 5) return send(400, { message: "Invalid Form Body", code: 50035, errors: { default_channel_ids: "needs 7, with 5 where everyone can chat" } });
          onboarding = b;
          return send(200, b);
        }
        if (req.method === "PATCH" && (m = /^\/guilds\/555\/members\/(\w+)$/.exec(url)) && memberRoles[m[1]]) {
          const b = JSON.parse(body);
          if (b.roles) memberRoles[m[1]] = b.roles;
          return send(200, {});
        }
        if (req.method === "PATCH" && url === "/guilds/555") return send(200, { id: "555" });
        if ((m = /^\/channels\/([\w-]+)\/webhooks$/.exec(url)) && req.method === "POST") {
          const h = { id: "wh-" + m[1], token: "tok-" + m[1], name: JSON.parse(body).name, channel_id: m[1] };
          (hooks[m[1]] = hooks[m[1]] || []).push(h);
          return send(200, h);
        }
        if (req.method === "POST" && url === "/guilds/555/auto-moderation/rules") {
          const b = JSON.parse(body);
          if (rules.some((r) => r.trigger_type === b.trigger_type && b.trigger_type !== 1)) return send(400, { message: "only one", code: 30035 });
          const r = { ...b, id: String(ruleId++) };
          rules.push(r);
          return send(200, r);
        }
        if ((m = /^\/guilds\/555\/auto-moderation\/rules\/(\d+)$/.exec(url))) {
          const r = rules.find((x) => x.id === m[1]);
          if (!r) return send(404, { message: "Unknown rule" });
          if (req.method === "DELETE") {
            rules = rules.filter((x) => x !== r);
            return send(204);
          }
          Object.assign(r, JSON.parse(body));
          return send(200, r);
        }
        if (/^\/guilds\/555\/bans\/\w+$/.test(url)) return req.method === "DELETE" && url.endsWith("/notbanned") ? send(404, { message: "Unknown Ban" }) : send(204);
        if (/^\/guilds\/555\/members\/\w+\/roles\/[\w-]+$/.test(url)) return send(204);
        if (req.method === "DELETE" && /^\/guilds\/555\/members\/\w+$/.test(url)) return send(204);
        if (req.method === "PATCH" && /^\/guilds\/555\/members\/\w+$/.test(url)) return send(200, {});
        if (req.method === "GET" && /^\/channels\/\w+\/messages\?limit=100$/.test(url)) return send(200, MESSAGES);
        if (/^\/channels\/\w+\/messages\/bulk-delete$/.test(url) || (req.method === "DELETE" && /^\/channels\/\w+\/messages\/\w+$/.test(url))) return send(204);
        if (req.method === "POST" && url === "/users/@me/channels") return send(200, { id: "dm-" + JSON.parse(body).recipient_id });
        if (req.method === "POST" && /^\/channels\/[\w-]+\/messages$/.test(url)) return send(200, { id: "posted" });
        if (req.method === "PUT" && url === "/applications/test-id/guilds/555/commands") return send(200, JSON.parse(body));
      }
      // --- Google
      if (req.method === "POST" && req.url === "/google/token") {
        if (p.get("client_secret") !== "g-secret" || !p.get("code")) return send(400, {});
        return send(200, { access_token: "gat-1", id_token: "x", token_type: "Bearer" });
      }
      if (req.url === "/google/userinfo" && req.headers.authorization === "Bearer gat-1")
        return send(200, { sub: "g-42", name: "Gina", picture: "https://lh3.googleusercontent.com/a/abc=s96-c" });
      send(404, {});
    });
  })
  .listen(8799, "127.0.0.1", () => console.log("mock discord/google on 8799"));
