// The "Continue with Discord / Google" sign-in methods. Each one: where the browser goes to approve Reminth, how the
// code it sends back becomes the player's id, name and picture.
import { discordOn, googleOn, seal } from "./_lib.js";

export const OAUTH = {
  discord: {
    on: discordOn,
    authorizeUrl: () => "https://discord.com/oauth2/authorize",
    // identify: the Discord id, name and picture. guilds.join: lets the owner's bot add the player to the Reminth
    // Discord server (Discord shows "Join servers for you" on its approve page; players can turn it off on the account
    // page). No email, no messages, no server list.
    scope: "identify guilds.join",
    extraParams: { prompt: "none" },
    clientId: (env) => env.DISCORD_CLIENT_ID,
    async identify(env, code, redirectUri) {
      const api = env.DISCORD_API || "https://discord.com/api";
      const tokenRes = await fetch(`${api}/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env.DISCORD_CLIENT_ID,
          client_secret: env.DISCORD_CLIENT_SECRET,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!tokenRes.ok) return null;
      const tok = await tokenRes.json();
      const meRes = await fetch(`${api}/users/@me`, { headers: { authorization: `Bearer ${tok.access_token}` } });
      if (!meRes.ok) return null;
      const d = await meRes.json();
      if (!d || !/^\d{1,25}$/.test(String(d.id || ""))) return null;
      const avatar = d.avatar && /^[a-z0-9_]{1,64}$/i.test(d.avatar) ? d.avatar : null;
      const canJoin = tok.refresh_token && String(tok.scope || "").split(" ").includes("guilds.join");
      return {
        provider: "discord",
        subject: String(d.id),
        name: d.global_name || d.username,
        avatarUrl: avatar ? `https://cdn.discordapp.com/avatars/${d.id}/${avatar}.png?size=128` : null,
        secret: canJoin ? await seal(env, tok.refresh_token) : undefined,
      };
    },
  },
  google: {
    on: googleOn,
    authorizeUrl: (env) => (env.GOOGLE_API ? `${env.GOOGLE_API}/auth` : "https://accounts.google.com/o/oauth2/v2/auth"),
    // openid + profile: the Google id, name and picture. No email, no Drive, nothing else.
    scope: "openid profile",
    extraParams: { prompt: "select_account" },
    clientId: (env) => env.GOOGLE_CLIENT_ID,
    async identify(env, code, redirectUri) {
      const tokenUrl = env.GOOGLE_API ? `${env.GOOGLE_API}/token` : "https://oauth2.googleapis.com/token";
      const infoUrl = env.GOOGLE_API ? `${env.GOOGLE_API}/userinfo` : "https://openidconnect.googleapis.com/v1/userinfo";
      const tokenRes = await fetch(tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!tokenRes.ok) return null;
      const tok = await tokenRes.json();
      const meRes = await fetch(infoUrl, { headers: { authorization: `Bearer ${tok.access_token}` } });
      if (!meRes.ok) return null;
      const g = await meRes.json();
      if (!g || !/^[0-9A-Za-z_-]{1,64}$/.test(String(g.sub || ""))) return null;
      const pic = typeof g.picture === "string" && /^https:\/\/lh3\.googleusercontent\.com\/[\w\-./=~%]+$/.test(g.picture) ? g.picture : null;
      return { provider: "google", subject: String(g.sub), name: g.name || g.given_name, avatarUrl: pic };
    },
  },
};
