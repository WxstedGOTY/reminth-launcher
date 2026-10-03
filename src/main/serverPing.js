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
// The SRV lookup happens before the ping's own timer starts; without a limit
// of its own a dead DNS server held every row at "pinging" for ~10s+.
const SRV_TIMEOUT_MS = 2000;

/** Pure: a TCP port a socket can actually be opened on. */
function isValidPort(port) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

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

/**
 * Pure: "host", "host:port", "v6", "[v6]:port" -> { host, port }, or null when it
 * isn't an address. A port outside 1-65535 is not an address: handing one to
 * net.createConnection throws instead of failing the connection.
 */
function parseAddress(address) {
  const s = String(address || "").trim();
  // A bare IPv6 address ("::1", "2001:db8::1") is all colons, so neither
  // pattern below can read it - and its last group is not a port.
  if (net.isIPv6(s)) return { host: s, port: 25565, explicitPort: false };
  const m = s.match(/^\[([^\]]+)\](?::(\d+))?$/) || s.match(/^([^:]+)(?::(\d+))?$/);
  if (!m) return null;
  const port = m[2] ? Number(m[2]) : 25565;
  if (!isValidPort(port)) return null;
  return { host: m[1], port, explicitPort: Boolean(m[2]) };
}

/** The server's SRV record, or null - never throws, never takes longer than SRV_TIMEOUT_MS. */
async function lookupSrv(host) {
  const resolver = new dns.Resolver();
  let timer;
  try {
    const records = await Promise.race([
      resolver.resolveSrv(`_minecraft._tcp.${host}`),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("SRV lookup timed out")), SRV_TIMEOUT_MS);
      }),
    ]);
    return records && records[0] ? records[0] : null;
  } catch {
    // no SRV record - that's the common case
    resolver.cancel();
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function resolve(address) {
  const parsed = parseAddress(address);
  if (!parsed || !/^[A-Za-z0-9.\-_:]+$/.test(parsed.host)) throw new Error("Invalid address");
  if (!parsed.explicitPort && !net.isIP(parsed.host)) {
    const srv = await lookupSrv(parsed.host);
    // The record comes from someone else's DNS - only use one that's usable.
    if (srv && typeof srv.name === "string" && srv.name && isValidPort(srv.port)) {
      return { host: srv.name, port: srv.port, handshakeHost: parsed.host };
    }
  }
  return { host: parsed.host, port: parsed.port, handshakeHost: parsed.host };
}

/** Pure: the fields Reminth shows, out of a server's status JSON. */
function statusFromJson(json, latencyMs) {
  const v = json && json.version && typeof json.version === "object" ? json.version : null;
  const versionName = v && typeof v.name === "string" ? v.name.slice(0, 60) : null;
  return {
    online: true,
    latencyMs,
    playersOnline: json && json.players ? Number(json.players.online) || 0 : null,
    playersMax: json && json.players ? Number(json.players.max) || 0 : null,
    version: versionName,
    // What the server says it runs, for showing next to the listing.
    versionName,
    protocol: v && Number.isInteger(v.protocol) ? v.protocol : null,
  };
}

/**
 * Resolves { online, playersOnline, playersMax, latencyMs, version,
 * versionName, protocol } or { online: false, error } - never rejects.
 */
async function ping(address) {
  let target;
  try {
    target = await resolve(address);
  } catch (err) {
    return { online: false, error: err.message };
  }
  return new Promise((done) => {
    let socket = null;
    let buf = Buffer.alloc(0);
    let sentAt = 0;
    let settled = false;
    let timer = null;
    // The one way out: whichever of timeout / error / close / answer comes
    // first wins, and the socket and timer are always released.
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (socket) socket.destroy();
      done(result);
    };
    timer = setTimeout(() => finish({ online: false, error: "timed out" }), TIMEOUT_MS);
    try {
      // Throws synchronously on arguments it won't accept; inside a Promise
      // executor that would reject, and this function promises not to.
      socket = net.createConnection({ host: target.host, port: target.port });
    } catch (err) {
      return finish({ online: false, error: err.code || err.message });
    }
    socket.on("error", (err) => finish({ online: false, error: err.code || err.message }));
    // A server that accepts and then hangs up without answering is offline
    // for our purposes now, not after the full timeout.
    socket.on("end", () => finish({ online: false, error: "connection closed" }));
    socket.on("close", () => finish({ online: false, error: "connection closed" }));
    socket.on("connect", () => {
      const port = Buffer.alloc(2);
      port.writeUInt16BE(target.port);
      // protocol -1 = "just asking what you support"
      socket.write(packet(0x00, Buffer.concat([varint(-1), mcString(target.handshakeHost), port, varint(1)])));
      sentAt = Date.now();
      socket.write(packet(0x00, Buffer.alloc(0)));
    });
    socket.on("data", (chunk) => {
      if (settled) return;
      buf = Buffer.concat([buf, chunk]);
      if (buf.length > 1024 * 1024) return finish({ online: false, error: "response too large" });
      try {
        const len = readVarint(buf, 0);
        if (!len || buf.length < len[0] + len[1]) return;
        const body = buf.subarray(len[1], len[1] + len[0]);
        const id = readVarint(body, 0);
        if (!id || id[0] !== 0x00) return finish({ online: false, error: "unexpected reply" });
        const strLen = readVarint(body, id[1]);
        const json = JSON.parse(body.toString("utf8", id[1] + strLen[1], id[1] + strLen[1] + strLen[0]));
        finish(statusFromJson(json, Date.now() - sentAt));
      } catch (err) {
        finish({ online: false, error: err.message });
      }
    });
  });
}

module.exports = { ping, parseAddress, readVarint, isValidPort, statusFromJson };
