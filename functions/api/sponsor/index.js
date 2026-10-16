// GET /api/sponsor -> { sponsor: { name, host, port, image, until } } while the sponsored slot is on, else { sponsor: null }.
// Public: the launcher's Home asks it. Nothing about who asks is read or kept.
import { configured, json, now } from "../../_lib.js";
import { isLive, publicSponsor, readSponsor } from "../../_sponsor.js";

export async function onRequestGet({ env }) {
  if (!configured(env)) return json({ sponsor: null });
  const row = await readSponsor(env);
  return json({ sponsor: isLive(row, now()) ? publicSponsor(row) : null }, 200, { "cache-control": "public, max-age=300" });
}
