// GET /api/status -> {accounts: true|false, providers: ["discord", "google", "email"]} - whether Reminth accounts are
// switched on (the database is set up) and which sign-in methods are. The app and the website show those buttons.
import { configured, json, providers } from "../_lib.js";

export async function onRequestGet({ env }) {
  return json({ accounts: configured(env), providers: providers(env) });
}
