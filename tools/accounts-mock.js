// A pretend Discord API + Google for the local account test (tools/accounts-e2e.js). node tools/accounts-mock.js
// Discord: any code works; code "other" is the player "Other" (id 987), any other code "Tester <b>" (id 123456789).
// Google (under /google): any code is the player "Gina" (sub g-42).
// The guild route remembers who was added (201 the first time, 204 after); bot token "bot-test", guild "555".
"use strict";
const http = require("http");
const members = new Set();
const revoked = [];
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
      const g = /^\/guilds\/(\d+)\/members\/(\d+)$/.exec(req.url);
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
