// GET /api/auth/<discord|google>/start?client=web|app[&nonce=<hex>][&link=1]
// Sends the browser to the provider's "Allow Reminth" page. The state (for the app also the app's nonce; for "link"
// the wish to add this method to the signed-in website account) waits in a short-lived HttpOnly cookie until the
// provider sends the browser back to /api/auth/<provider>/callback.
import { cookie, randomToken, STATE_SECONDS, go } from "../../../_lib.js";
import { OAUTH } from "../../../_oauth.js";

export async function onRequestGet({ request, env, params }) {
  const url = new URL(request.url);
  const p = OAUTH[params.provider];
  if (!p) return go("/account.html?error=bad_request");
  if (!p.on(env)) return go("/account.html?error=not_configured");
  const client = url.searchParams.get("client") === "app" ? "app" : "web";
  const nonce = url.searchParams.get("nonce") || "";
  if (client === "app" && !/^[a-f0-9]{32,64}$/.test(nonce)) return go("/account.html?error=bad_request");
  const link = client === "web" && url.searchParams.get("link") === "1" ? "1" : "";
  const state = randomToken(16);
  const auth = new URL(p.authorizeUrl(env));
  auth.searchParams.set("client_id", p.clientId(env));
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("redirect_uri", `${url.origin}/api/auth/${params.provider}/callback`);
  auth.searchParams.set("scope", p.scope);
  auth.searchParams.set("state", state);
  for (const [k, v] of Object.entries(p.extraParams)) auth.searchParams.set(k, v);
  return go(auth.toString(), { "set-cookie": cookie("rm_state", [state, client, nonce, params.provider, link].join("."), STATE_SECONDS) });
}
