"use strict";
/**
 * Minecraft's Server List Ping - the same thing the in-game multiplayer
 * screen does to show a server's player count and your ping to it. Done
 * from this machine so the latency shown is really *yours*, not a number
 * measured from somewhere else.
 *
 * https://minecraft.wiki/w/Java_Edition_protocol/Server_List_Ping
 */
const net = require("net");
const dns = require("dns").promises;

const TIMEOUT_MS = 3500;

function varint(n) {
  const out = [];
  let v = n >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return Buffer.from(out);
}

function packet(id, payload) {
  const body = Buffer.concat([varint(id), payload]);
  return Buffer.concat([varint(body.length), body]);
}

function mcString(s) {
  const b = Buffer.from(s, "utf8");
  return Buffer.concat([varint(b.length), b]);
}

/** Pure: reads a varint at `offset`; returns [value, bytesRead] or null if incomplete. */
function readVarint(buf, offset) {
  let value = 0;
  let shift = 0;
  for (let i = 0; i < 5; i++) {
    if (offset + i >= buf.length) return null;
    const b = buf[offset + i];
    value |= (b & 0x7f) << shift;
    if (!(b & 0x80)) return [value, i + 1];
    shift += 7;
  }
  throw new Error("varint too long");
}

/** Pure: "host", "host:port", "[v6]:port" -> { host, port }. */
function parseAddress(address) {
  const s = String(address || "").trim();
  const v6 = s.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (v6) return { host: v6[1], port: v6[2] ? Number(v6[2]) : 25565, explicitPort: Boolean(v6[2]) };
  const m = s.match(/^([^:]+)(?::(\d+))?$/);
  if (!m) return null;
  return { host: m[1], port: m[2] ? Number(m[2]) : 25565, explicitPort: Boolean(m[2]) };
}

async function resolve(address) {
  const parsed = parseAddress(address);
  if (!parsed || !/^[A-Za-z0-9.\-_:]+$/.test(parsed.host)) throw new Error("Bad server address.");
  if (!parsed.explicitPort && !net.isIP(parsed.host)) {
    try {
      const srv = await dns.resolveSrv(`_minecraft._tcp.${parsed.host}`);
      if (srv && srv[0]) return { host: srv[0].name, port: srv[0].port, handshakeHost: parsed.host };
    } catch {
      // no SRV record - that's the common case
    }
  }
  return { host: parsed.host, port: parsed.port, handshakeHost: parsed.host };
}

/** Resolves { online, playersOnline, playersMax, latencyMs, version } - never rejects. */
async function ping(address) {
  let target;
  try {
    target = await resolve(address);
  } catch (err) {
    return { online: false, error: err.message };
  }
  return new Promise((done) => {
    const socket = net.createConnection({ host: target.host, port: target.port });
    let buf = Buffer.alloc(0);
    let sentAt = 0;
    let status = null;
    const finish = (result) => {
      socket.destroy();
      done(result);
    };
    const timer = setTimeout(() => finish({ online: false, error: "timed out" }), TIMEOUT_MS);
    socket.on("error", (err) => {
      clearTimeout(timer);
      finish({ online: false, error: err.code || err.message });
    });
    socket.on("connect", () => {
      const port = Buffer.alloc(2);
      port.writeUInt16BE(target.port);
      // protocol -1 = "just asking what you support"
      socket.write(packet(0x00, Buffer.concat([varint(-1), mcString(target.handshakeHost), port, varint(1)])));
      sentAt = Date.now();
      socket.write(packet(0x00, Buffer.alloc(0)));
    });
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length > 1024 * 1024) {
        clearTimeout(timer);
        return finish({ online: false, error: "response too large" });
      }
      try {
        const len = readVarint(buf, 0);
        if (!len || buf.length < len[0] + len[1]) return;
        const body = buf.subarray(len[1], len[1] + len[0]);
        const id = readVarint(body, 0);
        if (!status && id && id[0] === 0x00) {
          const strLen = readVarint(body, id[1]);
          const json = JSON.parse(body.toString("utf8", id[1] + strLen[1], id[1] + strLen[1] + strLen[0]));
          const latency = Date.now() - sentAt;
          status = {
            online: true,
            latencyMs: latency,
            playersOnline: json.players ? Number(json.players.online) || 0 : null,
            playersMax: json.players ? Number(json.players.max) || 0 : null,
            version: json.version && typeof json.version.name === "string" ? json.version.name.slice(0, 60) : null,
          };
          clearTimeout(timer);
          finish(status);
        }
      } catch (err) {
        clearTimeout(timer);
        finish({ online: false, error: err.message });
      }
    });
  });
}

module.exports = { ping, parseAddress, readVarint };
