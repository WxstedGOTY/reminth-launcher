// GET /api/auth/<discord|google>/callback?code&state - where Discord / Google send the browser back.
// Checks the state, swaps the code for the player's id, name and picture, makes or updates the Reminth account, then:
//   website: a session cookie and /account.html (or, for "Connect", adds the method to the signed-in account)
//   app:     a 2-minute one-time code handed to the app through reminth://auth/<code>; the app swaps it (with the
//            nonce only it knows) at /api/auth/exchange. A code from someone else's link is useless to the app.
import { cookie, cookies, currentUser, escapeHtml, newLoginCode, newSession, signInIdentity, SESSION_SECONDS, go, db } from "../../../_lib.js";
import { OAUTH } from "../../../_oauth.js";

const clearState = cookie("rm_state", "", 0);

const page = (title, body) =>
  new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${title} - Reminth</title><link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;text-align:center;background:radial-gradient(60% 60% at 50% 40%,#2a0f08,#0c0909 70%);color:#fbf3ef;font-family:"Segoe UI",system-ui,Arial,sans-serif}
img{width:88px;filter:drop-shadow(0 0 22px rgba(255,74,28,.45))}h1{font-size:30px;margin:22px 0 8px}p{color:#b9a9a3;margin:0 auto 22px;max-width:440px;line-height:1.5}.small{font-size:13px;margin-top:18px}
a.btn{display:inline-block;padding:12px 22px;border-radius:12px;background:linear-gradient(180deg,#ff7a4a,#ff4a1c);color:#1c0600;font-weight:600;text-decoration:none}</style></head>
<body><div><img src="/favicon.svg" alt=""><h1>${title}</h1>${body}</div></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "set-cookie": clearState } }
  );

const fail = (why) => go(`/account.html?error=${why}`, { "set-cookie": clearState });

export async function onRequestGet({ request, env, params }) {
  const p = OAUTH[params.provider];
  if (!p) return fail("bad_request");
  if (!p.on(env)) return fail("not_configured");
  const url = new URL(request.url);
  const [state, client, nonce, provider, link] = (cookies(request).rm_state || "").split(".");
  if (url.searchParams.get("error")) return fail("cancelled");
  const code = url.searchParams.get("code");
  if (!state || !code || url.searchParams.get("state") !== state || provider !== params.provider) return fail("expired");

  const who = await p.identify(env, code, `${url.origin}/api/auth/${params.provider}/callback`);
  if (!who) return fail("provider");

  let linkTo = null;
  if (client === "web" && link === "1") {
    const me = await currentUser(env, request);
    if (!me || !me.viaCookie) return fail("expired");
    linkTo = me.user.id;
  }
  let accountId;
  try {
    accountId = await signInIdentity(env, who, linkTo);
  } catch (e) {
    if (e.code) return fail(e.code);
    throw e;
  }

  if (client === "app") {
    const appCode = await newLoginCode(env, accountId, nonce || "");
    const name = (await (await db(env)).prepare("SELECT name FROM accounts WHERE id = ?").bind(accountId).first()).name;
    const appLink = `reminth://auth/${appCode}`;
    return page(
      "Sign-in complete",
      `<p>You're signed in to Reminth as <b>${escapeHtml(name)}</b>.<br>If your browser asks to open Reminth, click <b>Open</b>.</p>
<p><b style="color:#fbf3ef">You can close this tab now and go back to Reminth.</b></p>
<a class="btn" href="${appLink}">Open Reminth</a>
<p class="small">Reminth didn't switch over? Press the button above.</p>
<script>setTimeout(function(){location.href=${JSON.stringify(appLink)}},300)</script>`
    );
  }
  if (linkTo) return go(`/account.html?linked=${params.provider}`, { "set-cookie": clearState });
  const token = await newSession(env, accountId, "web");
  const h = new Headers({ location: "/account.html?welcome=1", "cache-control": "no-store" });
  h.append("set-cookie", clearState);
  h.append("set-cookie", cookie("rm_session", token, SESSION_SECONDS));
  return new Response(null, { status: 302, headers: h });
}
