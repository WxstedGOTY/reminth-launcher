// Owner tools - the sponsored box in the launcher. Only for the owner (ADMIN_DISCORD_ID); everyone else gets a 404.
// GET  /api/admin/sponsor                -> { sponsor: {name, address, startDay, endDay, image, live} | null }
// POST /api/admin/sponsor {name, address, startDay, endDay, image?}  -> saves it (no image = keep the saved picture)
// POST /api/admin/sponsor {remove: true} -> takes it down
import { json, now, ownerOnly } from "../../_lib.js";
import { checkSponsorInput, clearSponsor, isLive, readSponsor, saveSponsor } from "../../_sponsor.js";

const day = (sec) => new Date(sec * 1000).toISOString().slice(0, 10);

function view(row) {
  if (!row) return null;
  return {
    name: row.name,
    address: row.port === 25565 ? row.host : `${row.host.includes(":") ? `[${row.host}]` : row.host}:${row.port}`,
    startDay: day(row.starts_at),
    endDay: day(row.ends_at - 86400),
    image: `data:${row.image_type};base64,${row.image}`,
    live: isLive(row, now()),
  };
}

export async function onRequestGet({ request, env }) {
  const no = await ownerOnly(env, request);
  if (no) return no;
  return json({ sponsor: view(await readSponsor(env)) });
}

export async function onRequestPost({ request, env }) {
  const no = await ownerOnly(env, request);
  if (no) return no;
  let body = {};
  try {
    body = await request.json();
  } catch {
    // no body
  }
  if (body && body.remove === true) {
    await clearSponsor(env);
    return json({ sponsor: null });
  }
  const saved = await readSponsor(env);
  const keep = saved ? { type: saved.image_type, base64: saved.image } : null;
  const checked = checkSponsorInput(body, now(), keep);
  if (checked.error) return json(checked, 400);
  await saveSponsor(env, checked.row);
  return json({ sponsor: view(await readSponsor(env)) });
}
