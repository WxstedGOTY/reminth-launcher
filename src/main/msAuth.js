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

// No request in the sign-in chain may hang forever: a stalled connection used
// to leave Play (or the sign-in card) spinning with nothing to click.
const REQUEST_TIMEOUT_MS = 15000;
// Refresh this long before the Minecraft token really runs out, so a token
// can't expire between the check and the game using it.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
// Minecraft tokens last 24 hours. An expiry further away than this was
// worked out by a clock that was wrong (ahead) at the time, so it's not believed.
const MAX_TOKEN_LIFETIME_MS = 25 * 60 * 60 * 1000;

const EXPIRED_MESSAGE = "Your Microsoft sign-in has expired — sign in again.";

/**
 * fetch with a deadline. `service` names who we were talking to, so the
 * message a player sees says which side didn't answer. A timeout is tagged
 * NETWORK_TIMEOUT; every other failure (DNS, refused...) is passed through.
 */
async function request(url, init, service) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    if (err && (err.name === "TimeoutError" || err.name === "AbortError")) {
      const timeout = new Error(`Timed out reaching ${service} services — check your connection.`);
      timeout.code = "NETWORK_TIMEOUT";
      throw timeout;
    }
    throw err;
  }
}

/** Notes the HTTP status on an error, so a caller can tell a refusal from an outage. */
function withStatus(err, status) {
  err.status = status;
  return err;
}

/** Step 1: ask Microsoft for a device code + user code to show the player. */
async function requestDeviceCode() {
  const res = await request(MS_DEVICE_CODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: MS_CLIENT_ID, scope: SCOPE }),
  }, "Microsoft");
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
 *
 * The code is only good for expires_in seconds; past that Microsoft will
 * never say yes, so polling stops instead of running for as long as the app
 * is open. isCancelled lets the caller abandon the wait (sign-out, or a
 * newer sign-in) without another request being made.
 */
async function pollForMicrosoftToken(deviceCode, intervalSeconds, onPending, { expiresInSeconds, isCancelled } = {}) {
  const deadline = pollDeadline(Date.now(), expiresInSeconds);
  for (;;) {
    // Recomputed every iteration (not hoisted to a const before the loop) -
    // otherwise a "slow_down" response below has no effect: Microsoft asks
    // for a longer gap, we bump intervalSeconds, but a loop that already
    // captured the old value would just keep polling at the original rate
    // and get slow_down'd (or eventually rate-limited) again.
    const intervalMs = Math.max(intervalSeconds, 5) * 1000;
    await sleep(intervalMs);
    if (isCancelled && isCancelled()) throw new Error("Sign-in was cancelled.");
    if (Date.now() >= deadline) {
      throw new Error("That sign-in code expired before it was used — press Sign in to get a new one.");
    }
    const res = await request(MS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: MS_CLIENT_ID,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
      }),
    }, "Microsoft");
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
  const res = await request(XBL_AUTH_URL, {
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
  }, "Xbox");
  if (!res.ok) throw withStatus(new Error(`Xbox Live auth failed: ${res.status} ${await res.text()}`), res.status);
  return res.json(); // { Token, DisplayClaims: { xui: [{ uhs }] } }
}

/** Step 4: trade the Xbox Live token for an XSTS token scoped to Minecraft. */
async function authenticateWithXSTS(xblToken) {
  const res = await request(XSTS_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      Properties: { SandboxId: "RETAIL", UserTokens: [xblToken] },
      RelyingParty: "rp://api.minecraftservices.com/",
      TokenType: "JWT",
    }),
  }, "Xbox");
  const data = await res.json();
  if (!res.ok) {
    if (data.XErr === 2148916233) {
      throw new Error("This Microsoft account has no Xbox profile. Create one at xbox.com first.");
    }
    if (data.XErr === 2148916238) {
      throw new Error("This account is a child account and needs to be added to a Family by an adult first.");
    }
    const err = withStatus(new Error(`XSTS auth failed: ${res.status} ${JSON.stringify(data)}`), res.status);
    // An XErr code is Xbox saying something about the ACCOUNT (not allowed in
    // this country, needs an adult's consent...) - not that the sign-in is
    // dead. Marked, so refreshSession doesn't sign the player out over it.
    if (data && data.XErr !== undefined && data.XErr !== null) err.xerr = data.XErr;
    throw err;
  }
  return data; // { Token, DisplayClaims: { xui: [{ uhs }] } }
}

/** Step 5: trade the XSTS token for a Minecraft Services access token. */
async function loginWithXbox(xstsToken, userHash) {
  const res = await request(MC_LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identityToken: `XBL3.0 x=${userHash};${xstsToken}` }),
  }, "Minecraft");
  if (!res.ok) throw withStatus(new Error(`Minecraft login failed: ${res.status} ${await res.text()}`), res.status);
  return res.json(); // { access_token, expires_in, ... }
}

/** Step 6: verify the account actually owns Minecraft: Java Edition. */
async function verifyOwnership(mcAccessToken) {
  const res = await request(MC_ENTITLEMENT_URL, {
    headers: { Authorization: `Bearer ${mcAccessToken}` },
  }, "Minecraft");
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
  const res = await request(MC_PROFILE_URL, {
    headers: { Authorization: `Bearer ${mcAccessToken}` },
  }, "Minecraft");
  if (!res.ok) throw new Error(`Profile fetch failed: ${res.status} ${await res.text()}`);
  return res.json(); // { id, name, skins, capes }
}

/**
 * Full sign-in flow, orchestrated. Calls callbacks so the renderer UI can
 * show the device code, then a "waiting..." state, then success.
 */
async function signIn({ onCode, onWaiting, isCancelled }) {
  const dc = await requestDeviceCode();
  onCode({ userCode: dc.user_code, verificationUri: dc.verification_uri });

  const msToken = await pollForMicrosoftToken(dc.device_code, dc.interval, onWaiting, {
    expiresInSeconds: dc.expires_in,
    isCancelled,
  });

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
  const res = await request(MS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: MS_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: msRefreshToken,
      scope: SCOPE,
    }),
  }, "Microsoft");
  if (!res.ok) {
    // "invalid_grant" is Microsoft refusing the token itself (revoked,
    // password changed, unused for 90 days). Only that means "sign in
    // again" - a 5xx is their outage, and a 400 with some other error (or
    // an error page that isn't JSON at all) says nothing about the token,
    // which is still good.
    let detail = "";
    try {
      detail = String((await res.json()).error || "");
    } catch {
      // not JSON
    }
    const err = new Error(
      isRejectedStatus(res.status, detail)
        ? "Refresh token expired, please sign in again."
        : `Microsoft's sign-in service returned ${res.status}.`
    );
    if (isRejectedStatus(res.status, detail)) err.code = "AUTH_REJECTED";
    throw err;
  }
  const msToken = await res.json();

  let mc;
  try {
    const xbl = await authenticateWithXboxLive(msToken.access_token);
    const xsts = await authenticateWithXSTS(xbl.Token);
    const userHash = xsts.DisplayClaims.xui[0].uhs;
    mc = await loginWithXbox(xsts.Token, userHash);
  } catch (err) {
    // Xbox or Minecraft answering 401 to tokens made a moment ago: the
    // sign-in itself is no longer accepted, and refreshing again won't
    // change that. Anything else (403, 429, 5xx, no answer) is left as the
    // passing trouble it probably is.
    // (Not an XSTS answer that carries an XErr: that is about the account,
    // and keeps its own message.)
    if (err && isRejectedStatus(err.status, err.xerr !== undefined ? "XErr" : "", "chain")) err.code = "AUTH_REJECTED";
    throw err;
  }
  await verifyOwnership(mc.access_token);
  const profile = await fetchProfile(mc.access_token);

  return {
    minecraftAccessToken: mc.access_token,
    minecraftAccessTokenExpiresAt: Date.now() + mc.expires_in * 1000,
    // Microsoft doesn't have to send a new refresh token every time. The one
    // just used stays good then - saving "none" would make the account read
    // as expired at the next refresh.
    msRefreshToken: msToken.refresh_token || msRefreshToken,
    uuid: profile.id,
    username: profile.name,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ */
/* pure decisions (unit tested - see test/fixes-main.test.js)          */
/* ------------------------------------------------------------------ */

/** When a device code stops being worth polling for. Microsoft's default is 15 minutes. */
function pollDeadline(startedAt, expiresInSeconds) {
  const secs = Number(expiresInSeconds);
  return startedAt + (Number.isFinite(secs) && secs > 0 ? secs : 900) * 1000;
}

/**
 * Did the other side refuse the sign-in itself (as opposed to being down, or
 * answering badly for a moment)? A yes here signs the player out, so it has
 * to be an answer that can only mean that:
 *  - "token" (Microsoft's token endpoint): the OAuth error "invalid_grant".
 *    Not any 400/401 - a proxy's error page or a mangled reply has those
 *    statuses too, and would wipe an account that is perfectly good.
 *  - "chain" (the Xbox Live / XSTS / Minecraft login steps): a plain 401.
 *    Not a 401 from XSTS that comes with an XErr code (`errorCode` set):
 *    that is an account-level answer - no Xbox profile, a country Xbox
 *    isn't offered in, a child account - and signing in again won't change it.
 */
function isRejectedStatus(status, errorCode, step = "token") {
  if (step === "chain") return status === 401 && !errorCode;
  return errorCode === "invalid_grant";
}

/**
 * Is the saved Minecraft token still usable as-is? An account saved by an
 * older build may have no expiry recorded - that counts as "refresh it".
 */
function needsRefresh(account, now) {
  if (!account || !account.minecraftAccessToken) return true;
  const expiresAt = Number(account.minecraftAccessTokenExpiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return true;
  if (expiresAt - now > MAX_TOKEN_LIFETIME_MS) return true;
  return expiresAt - now < REFRESH_MARGIN_MS;
}

/**
 * What to do when a refresh failed.
 *  - Microsoft rejected the refresh token: the session is dead, say so.
 *  - anything else (offline, timeout, their outage) while the Minecraft
 *    token hasn't actually run out: carry on with it, it still works.
 *  - anything else with a token that HAS run out: can't be used online.
 * Returns { proceed, code, message }.
 */
function refreshFailure(account, err, now) {
  if (err && err.code === "AUTH_REJECTED") return { proceed: false, code: "AUTH_EXPIRED", message: EXPIRED_MESSAGE };
  const expiresAt = Number(account && account.minecraftAccessTokenExpiresAt);
  if (account && account.minecraftAccessToken && Number.isFinite(expiresAt) && expiresAt > now) {
    return { proceed: true, code: null, message: null };
  }
  return {
    proceed: false,
    code: "AUTH_UNREACHABLE",
    message: "Couldn't reach Microsoft to renew your sign-in — check your connection and try again.",
  };
}

/**
 * The signed-in account and every way it changes, in one place, so the races
 * between them have one answer. Takes its I/O as arguments (so it runs in
 * tests with no Electron and no network):
 *   signIn(callbacks) / refresh(refreshToken) -> account
 *   save(account) / clear()                   -> persist to disk
 *
 * Rules it enforces:
 *  - `generation` goes up on every sign-out and every time a sign-in lands.
 *    Work that started under an older generation is thrown away when it
 *    finishes, so a refresh (or a device-code flow) that completes after
 *    Sign out can't sign the player back in, and a refresh of the previous
 *    account can't overwrite the one just signed in.
 *  - one sign-in and one refresh at a time; extra callers share the result.
 *    (Two refreshes would both spend the same single-use refresh token.)
 *  - disk writes run one after another, so a clear can't be overtaken by a
 *    save that started before it.
 *  - a sign-in Microsoft has rejected for good is forgotten on the spot
 *    (memory and disk), exactly as if the player had signed out.
 */
function createSession({ signIn: doSignIn, refresh, save, clear, log = () => {}, now = Date.now }) {
  let account = null;
  let generation = 0;
  let signInFlight = null;
  let refreshFlight = null; // { generation, promise }
  let disk = Promise.resolve();

  const persist = (fn) => {
    const run = disk.then(fn);
    disk = run.catch(() => {});
    return run;
  };

  /** Loads the account saved by a previous run - never over a newer sign-in or sign-out. */
  function restore(saved) {
    if (generation === 0 && !account && saved) account = saved;
    return account;
  }

  function startSignIn(callbacks = {}) {
    if (signInFlight) return signInFlight;
    const started = generation;
    const run = (async () => {
      const signedIn = await doSignIn({ ...callbacks, isCancelled: () => started !== generation });
      if (started !== generation) throw new Error("Sign-in was cancelled.");
      const mine = ++generation;
      account = signedIn;
      try {
        await persist(() => (mine === generation ? save(signedIn) : undefined));
      } catch (err) {
        // The player IS signed in (in memory); failing the call here would
        // tell them they aren't. A failed write only costs a sign-in next start.
        log(`saving the new session failed: ${err && err.message ? err.message : String(err)}`);
      }
      return signedIn;
    })();
    signInFlight = run;
    const done = () => {
      if (signInFlight === run) signInFlight = null;
    };
    run.then(done, done);
    return run;
  }

  async function signOut() {
    generation++;
    account = null;
    signInFlight = null;
    refreshFlight = null;
    await persist(() => clear());
  }

  /** The account with a Minecraft token that's good to use right now. */
  async function fresh() {
    if (!account) throw new Error("Sign in first.");
    if (!needsRefresh(account, now())) return account;
    if (!refreshFlight || refreshFlight.generation !== generation) {
      const mine = generation;
      const using = account;
      const promise = (async () => {
        let next;
        try {
          next = await refresh(using.msRefreshToken);
        } catch (err) {
          // Leave a trace, so a "why won't it sign in" report has something to go on.
          log(`session refresh failed: ${err && err.message ? err.message : String(err)}`);
          if (mine !== generation) return null;
          const verdict = refreshFailure(using, err, now());
          if (verdict.proceed) return using;
          if (verdict.code === "AUTH_EXPIRED") {
            // The saved sign-in is dead for good. Keeping it - in memory and
            // on disk - left the app looking signed in (after a restart too)
            // until the next Play failed the same way. Same steps as Sign out.
            generation++;
            account = null;
            persist(() => clear()).catch((clearErr) => {
              log(`clearing the expired session failed: ${clearErr && clearErr.message ? clearErr.message : String(clearErr)}`);
            });
          }
          const failure = new Error(verdict.message);
          failure.code = verdict.code;
          throw failure;
        }
        if (mine !== generation) return null; // signed out (or someone else signed in) meanwhile
        account = next;
        try {
          await persist(() => (mine === generation ? save(next) : undefined));
        } catch (err) {
          // The new token is good in memory; a failed write only costs a refresh next start.
          log(`saving the refreshed session failed: ${err && err.message ? err.message : String(err)}`);
        }
        return next;
      })();
      const flight = { generation: mine, promise };
      refreshFlight = flight;
      const done = () => {
        if (refreshFlight === flight) refreshFlight = null;
      };
      promise.then(done, done);
    }
    const result = await refreshFlight.promise;
    if (result) return result;
    // Discarded: answer for whoever is signed in now (nobody, after a sign-out).
    return fresh();
  }

  return { current: () => account, restore, signIn: startSignIn, signOut, fresh };
}

module.exports = {
  signIn,
  refreshSession,
  createSession,
  // pure, for tests
  needsRefresh,
  refreshFailure,
  isRejectedStatus,
  pollDeadline,
  EXPIRED_MESSAGE,
  REQUEST_TIMEOUT_MS,
};
