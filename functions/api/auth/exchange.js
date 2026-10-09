// POST /api/auth/exchange  {code, nonce} -> {token, user}
// The app swaps the one-time code from reminth://auth/<code> for its own session. The nonce is the random value the
// app made when it started this sign-in (it never leaves the app before that), so a code from a link the player didn't
// start is refused.
import { accountView, configured, json, newSession, notConfigured, takeLoginCode } from "../../_lib.js";

export async function onRequestPost({ request, env }) {
  if (!configured(env)) return notConfigured();
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const userId = await takeLoginCode(env, body && body.code, body && body.nonce);
  if (!userId) return json({ error: "invalid_code", message: "That sign-in link has expired. Try again." }, 400);
  const user = await accountView(env, userId);
  if (!user) return json({ error: "invalid_code" }, 400);
  const token = await newSession(env, userId, "app");
  return json({ token, user });
}
