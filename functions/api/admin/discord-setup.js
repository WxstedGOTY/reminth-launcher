// POST /api/admin/discord-setup {part: "setup"|"messages", step} - owner only: one step of "Set up my server"
// (_setup.js) or of "Post the channel messages" (_texts.js). The account page calls it again with `next` until done.
import { json, ownerOnly } from "../../_lib.js";
import { setupStep, SETUP_STEPS } from "../../_setup.js";
import { postMessages } from "../../_texts.js";

export async function onRequestPost({ request, env }) {
  const no = await ownerOnly(env, request);
  if (no) return no;
  const missing = ["DISCORD_CLIENT_ID", "DISCORD_BOT_TOKEN", "DISCORD_GUILD_ID", "DISCORD_PUBLIC_KEY"].filter((k) => !env[k]);
  if (missing.length) return json({ error: "setup", missing }, 400);
  let body = {};
  try {
    body = await request.json();
  } catch {
    // no body
  }
  const step = Math.max(0, Number(body.step) || 0);
  if (body.part === "messages") return json(await postMessages(env, step));
  return json({ ...(await setupStep(env, Math.min(step, SETUP_STEPS.length - 1))), steps: SETUP_STEPS.length });
}
