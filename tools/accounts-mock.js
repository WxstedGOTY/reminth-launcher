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
const guildRoles = [{ id: "r-mod", name: "Moderator", color: 1 }]; // the owner already made a "Moderator" role
const guildChannels = [{ id: "pre-general", name: "general", type: 0 }]; // and Discord's default #general
let rateLimited = false;
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
      // --- GitHub (GITHUB_API)
      if (req.url === "/repos/WxstedGOTY/reminth-launcher/releases/latest")
        return send(200, { tag_name: "1.7.0", body: " Reminth 1.7.0\r\n- Accounts\r\n- Blue theme", html_url: "https://github.com/x/releases/1.7.0" });
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
          return send(200, { id: "555", owner_id: BOT_OWNER, roles: [{ id: "555", position: 0 }, { id: "r-mod", position: 5 }, { id: "r-admin", position: 10 }] });
        if (req.method === "GET" && url === "/guilds/555/auto-moderation/rules") return send(200, rules);
        if (req.method === "GET" && url === "/guilds/555/roles") return send(200, [{ id: "555", name: "@everyone" }, ...guildRoles]);
        if (req.method === "GET" && url === "/guilds/555/channels") return send(200, guildChannels);
        rec();
        if (req.method === "POST" && url === "/guilds/555/roles") {
          const r = { ...JSON.parse(body), id: "role-" + guildRoles.length };
          guildRoles.push(r);
          return send(200, r);
        }
        if (req.method === "POST" && url === "/guilds/555/channels") {
          // Discord's channel-creation limit, once: the builder must wait and try again
          if (!rateLimited && guildChannels.length === 7) {
            rateLimited = true;
            return send(429, { message: "You are being rate limited.", retry_after: 1.2 });
          }
          const c = { ...JSON.parse(body), id: "ch-" + guildChannels.length };
          guildChannels.push(c);
          return send(200, c);
        }
        if (req.method === "PATCH" && url === "/guilds/555") return send(200, { id: "555" });
        if ((m = /^\/channels\/([\w-]+)\/webhooks$/.exec(url)) && req.method === "POST") return send(200, { id: "wh1", token: "whtoken", channel_id: m[1] });
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
