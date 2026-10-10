// GET /api/tools - the owner's tools for the account page (a script), only for the signed-in owner. Everyone else gets
// a plain 404, so the page's source shows nothing about them.
import { ownerOnly } from "../_lib.js";
import { OWNER_PANEL_JS } from "../_ownerPanel.js";

export async function onRequestGet({ request, env }) {
  const no = await ownerOnly(env, request);
  if (no) return no;
  return new Response(OWNER_PANEL_JS, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}
