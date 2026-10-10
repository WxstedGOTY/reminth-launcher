// reminth-cron: a small Cloudflare Worker for the Reminth Discord bot.
//  - Every minute it wakes the bot's checks on the website (functions/_tick.js: mod log, anti-raid, new accounts,
//    release posts).
//  - Gateway (a Durable Object) keeps the bot connected to Discord all the time, so it shows as ONLINE. It only says
//    "I'm here" (no intents - it receives no messages or member events), heartbeats, and reconnects / resumes when
//    Discord asks or the connection drops. The every-minute run and a 30 second alarm bring it back if Cloudflare
//    ever stops it. Needs the secret DISCORD_BOT_TOKEN on this Worker (Cloudflare -> reminth-cron -> Settings).
// Cloudflare free plan: a Durable Object connected all day uses ~10,800 of the 13,000 GB-s per day.
import { DurableObject } from "cloudflare:workers";

const SITE = "https://reminth.pages.dev";
const ALARM_MS = 30000;

export class Gateway extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ws = null;
    this.seq = null;
    this.hb = null;
    this.lastAck = 0;
    this.connecting = false;
    this.lastError = null;
    this.connectedAt = 0;
  }

  gatewayBase() {
    return this.env.GATEWAY_URL || "wss://gateway.discord.gg";
  }

  async fetch(request) {
    await this.ensure();
    return Response.json(await this.status());
  }

  async alarm() {
    await this.ensure();
  }

  async status() {
    return {
      connected: Boolean(this.ws && this.ws.readyState === 1 && this.ready),
      since: this.connectedAt || null,
      lastAck: this.lastAck || null,
      lastError: this.lastError,
      hasToken: Boolean(this.env.DISCORD_BOT_TOKEN),
    };
  }

  /** Connected and healthy, or (re)connect. Also keeps the 30 s alarm going. */
  async ensure() {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + ALARM_MS);
    if (!this.env.DISCORD_BOT_TOKEN) {
      this.lastError = "no DISCORD_BOT_TOKEN on the reminth-cron Worker";
      return;
    }
    // a new token (after a refused one) starts everything fresh
    const fp = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(this.env.DISCORD_BOT_TOKEN)))).slice(0, 8).join(".");
    if ((await this.ctx.storage.get("token_fp")) !== fp) {
      await this.ctx.storage.delete(["stopped", "session_id", "resume_url", "seq"]);
      await this.ctx.storage.put("token_fp", fp);
    }
    if ((await this.ctx.storage.get("stopped")) === true) {
      this.lastError = "Discord refused the bot token - update DISCORD_BOT_TOKEN on the reminth-cron Worker";
      return;
    }
    const healthy = this.ws && this.ws.readyState === 1 && (!this.hbInterval || Date.now() - this.lastAck < this.hbInterval * 2.5 + 5000);
    if (healthy) return;
    await this.connect();
  }

  async connect() {
    if (this.connecting) return;
    this.connecting = true;
    try {
      this.drop();
      const resumeUrl = await this.ctx.storage.get("resume_url");
      const sessionId = await this.ctx.storage.get("session_id");
      const base = (sessionId && resumeUrl) || this.gatewayBase();
      const res = await fetch(base.replace(/^ws/, "http") + "/?v=10&encoding=json", { headers: { Upgrade: "websocket" } });
      const ws = res.webSocket;
      if (!ws) throw new Error(`gateway answered ${res.status}`);
      ws.accept();
      this.ws = ws;
      this.ready = false;
      ws.addEventListener("message", (e) => {
        try {
          this.onMessage(JSON.parse(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data)));
        } catch (err) {
          this.lastError = "bad message: " + err;
        }
      });
      ws.addEventListener("close", (e) => this.onClose(e.code, e.reason));
      ws.addEventListener("error", () => this.onClose(1006, "error"));
    } catch (e) {
      this.lastError = String((e && e.message) || e);
    } finally {
      this.connecting = false;
    }
  }

  drop() {
    if (this.hb) clearInterval(this.hb);
    this.hb = null;
    if (this.ws) {
      try {
        this.ws.close(4000, "reconnecting");
      } catch {
        // already closed
      }
    }
    this.ws = null;
    this.ready = false;
  }

  send(op, d) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ op, d }));
  }

  async onMessage(p) {
    if (p.s !== null && p.s !== undefined) {
      this.seq = p.s;
      await this.ctx.storage.put("seq", p.s);
    }
    if (p.op === 10) {
      // Hello: start heartbeating, then resume the old session or identify as a new one
      this.hbInterval = p.d.heartbeat_interval;
      this.lastAck = Date.now();
      if (this.hb) clearInterval(this.hb);
      this.hb = setInterval(() => this.send(1, this.seq), this.hbInterval);
      const sessionId = await this.ctx.storage.get("session_id");
      const seq = await this.ctx.storage.get("seq");
      if (sessionId && seq !== undefined) {
        this.send(6, { token: this.env.DISCORD_BOT_TOKEN, session_id: sessionId, seq });
      } else {
        this.send(2, {
          token: this.env.DISCORD_BOT_TOKEN,
          intents: 0, // nothing to listen to - it only needs to be there
          properties: { os: "linux", browser: "reminth", device: "reminth" },
          presence: { since: null, status: "online", afk: false, activities: [{ name: "reminth.pages.dev", type: 3 }] },
        });
      }
    } else if (p.op === 11) {
      this.lastAck = Date.now();
    } else if (p.op === 1) {
      this.send(1, this.seq);
    } else if (p.op === 0 && p.t === "READY") {
      await this.ctx.storage.put({ session_id: p.d.session_id, resume_url: p.d.resume_gateway_url });
      this.ready = true;
      this.connectedAt = Date.now();
      this.lastError = null;
    } else if (p.op === 0 && p.t === "RESUMED") {
      this.ready = true;
      this.connectedAt = this.connectedAt || Date.now();
      this.lastError = null;
    } else if (p.op === 7) {
      // Discord asks for a reconnect: resume on a fresh connection
      this.drop();
      await this.connect();
    } else if (p.op === 9) {
      // invalid session: start a new one (Discord asks for a short pause first)
      if (!p.d) await this.ctx.storage.delete(["session_id", "resume_url", "seq"]);
      this.drop();
      await new Promise((r) => setTimeout(r, 1000 + Math.random() * 4000));
      await this.connect();
    }
  }

  async onClose(code, reason) {
    if (this.hb) clearInterval(this.hb);
    this.hb = null;
    this.ws = null;
    this.ready = false;
    this.lastError = `closed ${code} ${reason || ""}`.trim();
    if (code === 4004) {
      // wrong token: stop until the Worker is updated with the right one
      await this.ctx.storage.put("stopped", true);
      return;
    }
    if ([4007, 4009].includes(code)) await this.ctx.storage.delete(["session_id", "resume_url", "seq"]);
    if (code === 4000 && reason === "reconnecting") return; // we closed it ourselves
    setTimeout(() => this.ensure().catch(() => {}), 3000);
  }
}

export default {
  async scheduled(event, env, ctx) {
    let gateway = null;
    try {
      const stub = env.GATEWAY.get(env.GATEWAY.idFromName("main"));
      gateway = await (await stub.fetch("https://gateway/ensure")).json();
    } catch (e) {
      gateway = { connected: false, lastError: String((e && e.message) || e) };
    }
    ctx.waitUntil(
      fetch(`${env.SITE_URL || SITE}/api/discord/tick`, { method: "POST", headers: { "user-agent": "reminth-cron", "content-type": "application/json" }, body: JSON.stringify({ gateway }) })
    );
  },
  async fetch() {
    return new Response("Reminth cron - nothing to see here.", { status: 200 });
  },
};
