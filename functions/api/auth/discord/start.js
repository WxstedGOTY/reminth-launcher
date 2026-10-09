// GET /api/auth/discord/start?client=web|app[&nonce=<hex>]
// Sends the browser to Discord's "Authorize Reminth" page. The state (and, for the app, the app's nonce) waits in a
// short-lived HttpOnly cookie until Discord sends the browser back to /api/auth/discord/callback.
import { configured, cookie, randomToken, STATE_SECONDS, go } from "../../../_lib.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!configured(env)) return go("/account.html?error=not_configured");
  const client = url.searchParams.get("client") === "app" ? "app" : "web";
  const nonce = url.searchParams.get("nonce") || "";
  if (client === "app" && !/^[a-f0-9]{32,64}$/.test(nonce)) return go("/account.html?error=bad_request");
  const state = randomToken(16);
  const redirectUri = `${url.origin}/api/auth/discord/callback`;
  const discord = new URL("https://discord.com/oauth2/authorize");
  discord.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
  discord.searchParams.set("response_type", "code");
  discord.searchParams.set("redirect_uri", redirectUri);
  discord.searchParams.set("scope", "identify");
  discord.searchParams.set("state", state);
  discord.searchParams.set("prompt", "none");
  return new Response(null, {
    status: 302,
    headers: { location: discord.toString(), "set-cookie": cookie("rm_state", `${state}.${client}.${nonce}`, STATE_SECONDS), "cache-control": "no-store" },
  });
}
