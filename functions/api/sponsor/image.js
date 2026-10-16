// GET /api/sponsor/image?v=<version> -> the sponsored slot's picture (only while it is on). The version changes with
// every save, so the picture can be cached for a day.
import { configured, json, now } from "../../_lib.js";
import { isLive, readSponsor } from "../../_sponsor.js";

export async function onRequestGet({ env }) {
  const missing = () => json({ error: "not_found" }, 404);
  if (!configured(env)) return missing();
  const row = await readSponsor(env);
  if (!isLive(row, now())) return missing();
  const bytes = Uint8Array.from(atob(row.image), (c) => c.charCodeAt(0));
  return new Response(bytes, {
    headers: { "content-type": row.image_type, "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" },
  });
}
