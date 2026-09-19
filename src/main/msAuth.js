"use strict";
/**
 * Reminth's own sign-in - Microsoft -> Xbox Live -> XSTS -> Minecraft
 * Services authentication. Reminth is fully standalone: no official
 * Minecraft Launcher, no Modrinth App, no other third-party launcher
 * required. This is the same device-code flow every independent
 * Minecraft launcher uses (Prism Launcher, HeliosLauncher, etc).
 *
 * Status: the flow works end-to-end through XSTS. The final step
 * (login_with_xbox against api.minecraftservices.com) currently 403s
 * with "Invalid app registration" because Mojang allowlists which Azure
 * app registrations may call the Minecraft API, and new registrations
 * need a one-time review. That's a Microsoft-side approval queue, not a
 * bug here - submitted via https://aka.ms/mce-reviewappid (per
 * HeliosLauncher's own docs on this exact process:
 * https://github.com/dscalzi/HeliosLauncher/blob/master/docs/MicrosoftAuth.md).
 * Once approved (Microsoft says allow up to 24h after approval for it to
 * take effect), this file needs no changes at all.
 *
 * Each user signs in with THEIR OWN Microsoft account and it only works
 * if that account owns a copy of Minecraft: Java Edition. This module
 * never stores or has access to anyone's password - it's the OAuth
 * "device code" flow, so the user types a code into microsoft.com/link
 * themselves.
 *
 * Requires an Azure AD app registration (free) that Reminth owns:
 *   1. https://portal.azure.com -> Azure Active Directory -> App registrations -> New registration
 *   2. Name: "Reminth", Supported account types: "Personal Microsoft accounts only"
 *   3. No redirect URI needed for device code flow.
 *   4. Copy the "Application (client) ID" into config.js as MS_CLIENT_ID.
 *   5. That's it - no client secret needed, this is a public client flow.
 */

// Node 18+ (and Electron's bundled Node) ships a global fetch - no npm package needed.
const { MS_CLIENT_ID } = require("./config");

const MS_DEVICE_CODE_URL =
  "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
const MS_TOKEN_URL =
  "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const XBL_AUTH_URL = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_AUTH_URL = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN_URL =
  "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_ENTITLEMENT_URL =
  "https://api.minecraftservices.com/entitlements/mcstore";
const MC_PROFILE_URL = "https://api.minecraftservices.com/minecraft/profile";

const SCOPE = "XboxLive.signin offline_access";

/** Step 1: ask Microsoft for a device code + user code to show the player. */
async function requestDeviceCode() {
  const res = await fetch(MS_DEVICE_CODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: MS_CLIENT_ID, scope: SCOPE }),
  });
  if (!res.ok) {
    throw new Error(`Device code request failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
  // -> { device_code, user_code, verification_uri, expires_in, interval, message }
}

/**
 * Step 2: poll the token endpoint until the player finishes signing in
 * at microsoft.com/link (or verification_uri) with the user_code.
 * onPending is called once per poll so the UI can keep showing the code.
 */
async function pollForMicrosoftToken(deviceCode, intervalSeconds, onPending) {
  for (;;) {
    // Recomputed every iteration (not hoisted to a const before the loop) -
    // otherwise a "slow_down" response below has no effect: Microsoft asks
    // for a longer gap, we bump intervalSeconds, but a loop that already
    // captured the old value would just keep polling at the original rate
    // and get slow_down'd (or eventually rate-limited) again.
    const intervalMs = Math.max(intervalSeconds, 5) * 1000;
    await sleep(intervalMs);
    const res = await fetch(MS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: MS_CLIENT_ID,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
      }),
    });
    const data = await res.json();
    if (res.ok) return data; // { access_token, refresh_token, expires_in, ... }
    if (data.error === "authorization_pending") {
      onPending && onPending();
      continue;
    }
    if (data.error === "slow_down") {
      intervalSeconds += 5;
      continue;
    }
    throw new Error(`Microsoft sign-in failed: ${data.error_description || data.error}`);
  }
}

/** Step 3: trade the Microsoft token for an Xbox Live user token. */
async function authenticateWithXboxLive(msAccessToken) {
  const res = await fetch(XBL_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      Properties: {
        AuthMethod: "RPS",
        SiteName: "user.auth.xboxlive.com",
        RpsTicket: `d=${msAccessToken}`,
      },
      RelyingParty: "http://auth.xboxlive.com",
      TokenType: "JWT",
    }),
  });
  if (!res.ok) throw new Error(`Xbox Live auth failed: ${res.status} ${await res.text()}`);
  return res.json(); // { Token, DisplayClaims: { xui: [{ uhs }] } }
}

/** Step 4: trade the Xbox Live token for an XSTS token scoped to Minecraft. */
async function authenticateWithXSTS(xblToken) {
  const res = await fetch(XSTS_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      Properties: { SandboxId: "RETAIL", UserTokens: [xblToken] },
      RelyingParty: "rp://api.minecraftservices.com/",
      TokenType: "JWT",
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    if (data.XErr === 2148916233) {
      throw new Error("This Microsoft account has no Xbox profile. Create one at xbox.com first.");
    }
    if (data.XErr === 2148916238) {
      throw new Error("This account is a child account and needs to be added to a Family by an adult first.");
    }
    throw new Error(`XSTS auth failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return data; // { Token, DisplayClaims: { xui: [{ uhs }] } }
}

/** Step 5: trade the XSTS token for a Minecraft Services access token. */
async function loginWithXbox(xstsToken, userHash) {
  const res = await fetch(MC_LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identityToken: `XBL3.0 x=${userHash};${xstsToken}` }),
  });
  if (!res.ok) throw new Error(`Minecraft login failed: ${res.status} ${await res.text()}`);
  return res.json(); // { access_token, expires_in, ... }
}

/** Step 6: verify the account actually owns Minecraft: Java Edition. */
async function verifyOwnership(mcAccessToken) {
  const res = await fetch(MC_ENTITLEMENT_URL, {
    headers: { Authorization: `Bearer ${mcAccessToken}` },
  });
  if (!res.ok) throw new Error(`Entitlement check failed: ${res.status}`);
  const data = await res.json();
  const owns = Array.isArray(data.items) && data.items.length > 0;
  if (!owns) {
    throw new Error(
      "This Microsoft account doesn't own Minecraft: Java Edition. Buy it at minecraft.net first."
    );
  }
}

/** Step 7: fetch the player's profile (uuid + username + skin). */
async function fetchProfile(mcAccessToken) {
  const res = await fetch(MC_PROFILE_URL, {
    headers: { Authorization: `Bearer ${mcAccessToken}` },
  });
  if (!res.ok) throw new Error(`Profile fetch failed: ${res.status} ${await res.text()}`);
  return res.json(); // { id, name, skins, capes }
}

/**
 * Full sign-in flow, orchestrated. Calls callbacks so the renderer UI can
 * show the device code, then a "waiting..." state, then success.
 */
async function signIn({ onCode, onWaiting }) {
  const dc = await requestDeviceCode();
  onCode({ userCode: dc.user_code, verificationUri: dc.verification_uri });

  const msToken = await pollForMicrosoftToken(dc.device_code, dc.interval, onWaiting);

  const xbl = await authenticateWithXboxLive(msToken.access_token);
  const xsts = await authenticateWithXSTS(xbl.Token);
  const userHash = xsts.DisplayClaims.xui[0].uhs;

  const mc = await loginWithXbox(xsts.Token, userHash);
  await verifyOwnership(mc.access_token);
  const profile = await fetchProfile(mc.access_token);

  return {
    minecraftAccessToken: mc.access_token,
    minecraftAccessTokenExpiresAt: Date.now() + mc.expires_in * 1000,
    msRefreshToken: msToken.refresh_token, // save this (encrypted) to skip sign-in next time
    uuid: profile.id,
    username: profile.name,
  };
}

/** Refresh a session using the saved MS refresh token, no user interaction needed. */
async function refreshSession(msRefreshToken) {
  const res = await fetch(MS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: MS_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: msRefreshToken,
      scope: SCOPE,
    }),
  });
  if (!res.ok) throw new Error("Refresh token expired, please sign in again.");
  const msToken = await res.json();

  const xbl = await authenticateWithXboxLive(msToken.access_token);
  const xsts = await authenticateWithXSTS(xbl.Token);
  const userHash = xsts.DisplayClaims.xui[0].uhs;
  const mc = await loginWithXbox(xsts.Token, userHash);
  await verifyOwnership(mc.access_token);
  const profile = await fetchProfile(mc.access_token);

  return {
    minecraftAccessToken: mc.access_token,
    minecraftAccessTokenExpiresAt: Date.now() + mc.expires_in * 1000,
    msRefreshToken: msToken.refresh_token,
    uuid: profile.id,
    username: profile.name,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { signIn, refreshSession };
