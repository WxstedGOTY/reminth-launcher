// GET /api/auth/discord/callback?code&state - where Discord sends the browser back.
// Checks the state, swaps the code for the player's Discord id, name and avatar (scope "identify" only), makes or
// updates the Reminth account, then:
//   website: a session cookie and /account.html
//   app:     a 2-minute one-time code handed to the app through reminth://auth/<code>; the app swaps it (with the
//            nonce only it knows) at /api/auth/exchange. A code from someone else's link is useless to the app.
import { configured, cookie, cookies, newLoginCode, newSession, upsertDiscordUser, go } from "../../../_lib.js";

const page = (title, body) =>
  new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${title} - Reminth</title><link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;text-align:center;background:radial-gradient(60% 60% at 50% 40%,#2a0f08,#0c0909 70%);color:#fbf3ef;font-family:"Segoe UI",system-ui,Arial,sans-serif}
img{width:88px;filter:drop-shadow(0 0 22px rgba(255,74,28,.45))}h1{font-size:28px;margin:16px 0 8px}p{color:#b9a9a3;margin:0 0 22px;max-width:420px}
a.btn{display:inline-block;padding:12px 22px;border-radius:12px;background:linear-gradient(180deg,#ff7a4a,#ff4a1c);color:#1c0600;font-weight:600;text-decoration:none}</style></head>
<body><div><img src="/favicon.svg" alt=""><h1>${title}</h1>${body}</div></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "set-cookie": cookie("rm_state", "", 0) } }
  );

const fail = (why) => go(`/account.html?error=${why}`);

export async function onRequestGet({ request, env }) {
  if (!configured(env)) return fail("not_configured");
  const url = new URL(request.url);
  const [state, client, nonce] = (cookies(request).rm_state || "").split(".");
  if (url.searchParams.get("error")) return fail("cancelled");
  const code = url.searchParams.get("code");
  if (!state || !code || url.searchParams.get("state") !== state) return fail("expired");

  const api = env.DISCORD_API || "https://discord.com/api";
  const tokenRes = await fetch(`${api}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: `${url.origin}/api/auth/discord/callback`,
    }),
  });
  if (!tokenRes.ok) return fail("discord");
  const { access_token: accessToken } = await tokenRes.json();
  const meRes = await fetch(`${api}/users/@me`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!meRes.ok) return fail("discord");
  const discordUser = await meRes.json();
  if (!discordUser || !discordUser.id) return fail("discord");
  const user = await upsertDiscordUser(env, discordUser);

  if (client === "app") {
    const appCode = await newLoginCode(env, user.id, nonce || "");
    const link = `reminth://auth/${appCode}`;
    return page(
      "Back to Reminth",
      `<p>You're signed in as <b>${escapeHtml(user.name)}</b>. Your browser may ask to open Reminth - say yes.</p>
<a class="btn" href="${link}">Open Reminth</a>
<script>setTimeout(function(){location.href=${JSON.stringify(link)}},300)</script>`
    );
  }
  const token = await newSession(env, user.id, "web");
  return new Response(null, {
    status: 302,
    headers: { location: "/account.html", "cache-control": "no-store", "set-cookie": cookie("rm_session", token, 90 * 86400) },
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
