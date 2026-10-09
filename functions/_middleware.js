// Every /api request: an unexpected error is written to the log (Cloudflare -> the project -> Functions -> logs) and
// the visitor gets a short JSON answer instead of Cloudflare's error page.
export async function onRequest(context) {
  try {
    return await context.next();
  } catch (e) {
    console.error("reminth api error:", e && e.stack ? e.stack : String(e));
    return new Response(JSON.stringify({ error: "server", message: "Something went wrong on Reminth's side. Try again." }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
}
