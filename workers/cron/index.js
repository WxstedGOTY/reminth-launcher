// reminth-cron: a tiny Cloudflare Worker that wakes the Reminth bot up once a minute (the bot itself only runs when
// Discord or the website calls it). All the work is in functions/_tick.js on the website.
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(fetch("https://reminth.pages.dev/api/discord/tick", { method: "POST", headers: { "user-agent": "reminth-cron" } }));
  },
  async fetch() {
    return new Response("Reminth cron - nothing to see here.", { status: 200 });
  },
};
