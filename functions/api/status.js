// GET /api/status -> {accounts: true|false} - whether Reminth accounts are switched on (the database and the Discord
// app are set up). The app and the website use it to show "Continue with Discord" or "coming soon".
import { configured, json } from "../_lib.js";

export async function onRequestGet({ env }) {
  return json({ accounts: configured(env) });
}
