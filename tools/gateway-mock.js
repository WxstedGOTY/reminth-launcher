// A pretend Discord gateway (WebSocket) for testing workers/cron's Gateway (the bot's always-on connection).
// node tools/gateway-mock.js  -> ws://127.0.0.1:8797
//   GET  /_ctl/log        what the bot sent (identify / resume / heartbeats) and what happened
//   POST /_ctl/reconnect  sends Discord's "please reconnect" (op 7) to the bot
//   POST /_ctl/drop       closes the connection like a network drop (1006-ish)
"use strict";
const http = require("http");
const crypto = require("crypto");

const events = [];
let current = null; // the bot's socket
let n = 0;

function frame(text) {
  const p = Buffer.from(text);
  const head = p.length < 126 ? Buffer.from([0x81, p.length]) : Buffer.from([0x81, 126, p.length >> 8, p.length & 255]);
  return Buffer.concat([head, p]);
}
const sendJson = (sock, o) => sock.write(frame(JSON.stringify(o)));

function readFrames(sock, onText) {
  let buf = Buffer.alloc(0);
  sock.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      const op = buf[0] & 15;
      let len = buf[1] & 127;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        off = 10;
      }
      const masked = buf[1] & 128;
      const mask = masked ? buf.slice(off, off + 4) : null;
      if (masked) off += 4;
      if (buf.length < off + len) return;
      let payload = buf.slice(off, off + len);
      if (mask) payload = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
      buf = buf.slice(off + len);
      if (op === 1) onText(payload.toString());
      else if (op === 8) {
        events.push({ t: "client-close", code: payload.length >= 2 ? payload.readUInt16BE(0) : null });
        sock.end();
      } else if (op === 9) sock.write(Buffer.from([0x8a, 0])); // pong
    }
  });
}

const server = http.createServer((req, res) => {
  if (req.url === "/_ctl/log") return res.end(JSON.stringify(events));
  if (req.method === "POST" && req.url === "/_ctl/reconnect" && current) {
    sendJson(current, { op: 7, d: null, s: null, t: null });
    return res.end("ok");
  }
  if (req.method === "POST" && req.url === "/_ctl/drop" && current) {
    current.destroy();
    current = null;
    return res.end("ok");
  }
  res.statusCode = 404;
  res.end();
});
server.on("upgrade", (req, sock) => {
  const accept = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const id = ++n;
  current = sock;
  let seq = 0;
  events.push({ t: "connect", id, url: req.url });
  sendJson(sock, { op: 10, d: { heartbeat_interval: 2000 }, s: null, t: null }); // short, so the test sees heartbeats
  readFrames(sock, (text) => {
    const p = JSON.parse(text);
    if (p.op === 1) {
      events.push({ t: "heartbeat", id, seq: p.d });
      sendJson(sock, { op: 11, d: null, s: null, t: null });
    } else if (p.op === 2) {
      events.push({ t: "identify", id, token: p.d.token, intents: p.d.intents, presence: p.d.presence });
      sendJson(sock, { op: 0, s: ++seq, t: "READY", d: { session_id: "sess-1", resume_gateway_url: "ws://127.0.0.1:8797/resume" } });
    } else if (p.op === 6) {
      events.push({ t: "resume", id, session_id: p.d.session_id, seq: p.d.seq });
      sendJson(sock, { op: 0, s: ++seq + 10, t: "RESUMED", d: {} });
    }
  });
  sock.on("error", () => {});
});
server.listen(8797, "127.0.0.1", () => console.log("mock gateway on 8797"));
