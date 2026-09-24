"use strict";
/**
 * Minimal NBT reader - just enough to read Minecraft's level.dat and
 * servers.dat. Deliberately dependency-free (zlib is built into Node) so
 * Reminth doesn't take on an npm package for ~150 lines of binary parsing.
 *
 * Only reading is implemented. Reminth never writes to a player's world
 * files - it just looks at them to show worlds, servers and stats.
 *
 * Format reference: the tag ids below are Notch's original spec, unchanged
 * since 2011. level.dat is gzipped; servers.dat is stored uncompressed
 * (verified against a real 26.2 instance, not assumed).
 */
const zlib = require("zlib");

/** Ceiling on how far a compressed NBT file is allowed to expand. See parse(). */
const MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024;

const TAG_END = 0;
const TAG_BYTE = 1;
const TAG_SHORT = 2;
const TAG_INT = 3;
const TAG_LONG = 4;
const TAG_FLOAT = 5;
const TAG_DOUBLE = 6;
const TAG_BYTE_ARRAY = 7;
const TAG_STRING = 8;
const TAG_LIST = 9;
const TAG_COMPOUND = 10;
const TAG_INT_ARRAY = 11;
const TAG_LONG_ARRAY = 12;

class Reader {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
  }
  need(n) {
    if (this.pos + n > this.buf.length) {
      throw new Error(`NBT: truncated (wanted ${n} bytes at ${this.pos}/${this.buf.length})`);
    }
  }
  byte() { this.need(1); return this.buf.readInt8(this.pos++); }
  short() { this.need(2); const v = this.buf.readInt16BE(this.pos); this.pos += 2; return v; }
  ushort() { this.need(2); const v = this.buf.readUInt16BE(this.pos); this.pos += 2; return v; }
  int() { this.need(4); const v = this.buf.readInt32BE(this.pos); this.pos += 4; return v; }
  // Longs come back as JS numbers. Every long Reminth actually reads
  // (LastPlayed, a millisecond timestamp) is far inside Number.MAX_SAFE_INTEGER,
  // and a BigInt here would just have to be converted back for Date().
  long() { this.need(8); const v = Number(this.buf.readBigInt64BE(this.pos)); this.pos += 8; return v; }
  float() { this.need(4); const v = this.buf.readFloatBE(this.pos); this.pos += 4; return v; }
  double() { this.need(8); const v = this.buf.readDoubleBE(this.pos); this.pos += 8; return v; }
  string() {
    const len = this.ushort();
    this.need(len);
    // NBT strings are modified UTF-8. Plain UTF-8 decoding is correct for
    // everything except embedded nulls and astral-plane characters, neither
    // of which appear in world names or server addresses in practice.
    const s = this.buf.toString("utf8", this.pos, this.pos + len);
    this.pos += len;
    return s;
  }
}

function readPayload(r, type) {
  switch (type) {
    case TAG_BYTE: return r.byte();
    case TAG_SHORT: return r.short();
    case TAG_INT: return r.int();
    case TAG_LONG: return r.long();
    case TAG_FLOAT: return r.float();
    case TAG_DOUBLE: return r.double();
    case TAG_BYTE_ARRAY: {
      const len = r.int();
      // A negative length would rewind the cursor and let the parser loop
      // over the same bytes forever, hanging the main process.
      if (len < 0) throw new Error(`NBT: negative byte-array length (${len})`);
      r.need(len);
      const out = r.buf.subarray(r.pos, r.pos + len);
      r.pos += len;
      return out;
    }
    case TAG_STRING: return r.string();
    case TAG_LIST: {
      const itemType = r.byte();
      const len = r.int();
      if (len <= 0) return [];
      // A list of TAG_End has no payload to read; Minecraft writes empty
      // lists this way. Anything claiming a length here is malformed, and
      // reading it would throw on an unknown tag type.
      if (itemType === TAG_END) return [];
      const out = [];
      for (let i = 0; i < len; i++) out.push(readPayload(r, itemType));
      return out;
    }
    case TAG_COMPOUND: {
      const out = {};
      for (;;) {
        const t = r.byte();
        if (t === TAG_END) break;
        const name = r.string();
        out[name] = readPayload(r, t);
      }
      return out;
    }
    case TAG_INT_ARRAY: {
      const len = r.int();
      if (len < 0) throw new Error(`NBT: negative int-array length (${len})`);
      const out = new Array(len);
      for (let i = 0; i < len; i++) out[i] = r.int();
      return out;
    }
    case TAG_LONG_ARRAY: {
      const len = r.int();
      if (len < 0) throw new Error(`NBT: negative long-array length (${len})`);
      const out = new Array(len);
      for (let i = 0; i < len; i++) out[i] = r.long();
      return out;
    }
    default:
      throw new Error(`NBT: unknown tag type ${type} at ${r.pos}`);
  }
}

/**
 * Parses an NBT buffer, transparently gunzipping it first if needed.
 * Returns the root compound's payload ({} shaped), or throws.
 */
function parse(buffer) {
  let buf = buffer;
  // These are decompressed synchronously on the main thread, and the input
  // is a file on disk that the player may well have downloaded with a world
  // from the internet. A few hundred KB of crafted gzip can expand to many
  // gigabytes; without a cap that's the whole launcher hung and then OOM,
  // and a surrounding try/catch can't rescue it. 64MB is far past anything
  // a real level.dat or servers.dat needs.
  const decompressOptions = { maxOutputLength: MAX_DECOMPRESSED_BYTES };
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    buf = zlib.gunzipSync(buf, decompressOptions); // level.dat
  } else if (buf.length >= 2 && buf[0] === 0x78) {
    buf = zlib.inflateSync(buf, decompressOptions); // zlib-deflated NBT, rare but legal
  }
  const r = new Reader(buf);
  const type = r.byte();
  if (type !== TAG_COMPOUND) throw new Error(`NBT: root is tag ${type}, expected compound`);
  r.string(); // root name, always empty in practice
  return readPayload(r, TAG_COMPOUND);
}

/**
 * Writes servers.dat - the only NBT file Reminth ever writes. Each entry
 * keeps its string fields (name, ip, icon) and its flag bytes
 * (acceptTextures, hidden, preventsChatReports...); anything else isn't a
 * field Minecraft stores per server. Uncompressed, like the game writes it.
 */
function writeServersDat(servers) {
  const parts = [];
  const byte = (v) => { const b = Buffer.alloc(1); b.writeInt8(v); parts.push(b); };
  const int = (v) => { const b = Buffer.alloc(4); b.writeInt32BE(v); parts.push(b); };
  const str = (v) => {
    const body = Buffer.from(String(v), "utf8");
    if (body.length > 65535) throw new Error("NBT: string too long");
    const len = Buffer.alloc(2);
    len.writeUInt16BE(body.length);
    parts.push(len, body);
  };
  byte(TAG_COMPOUND); str(""); // root
  byte(TAG_LIST); str("servers");
  const list = (servers || []).filter((s) => s && typeof s.ip === "string");
  byte(list.length ? TAG_COMPOUND : TAG_END);
  int(list.length);
  for (const server of list) {
    for (const [key, value] of Object.entries(server)) {
      if (typeof value === "string") { byte(TAG_STRING); str(key); str(value); }
      else if (typeof value === "number" && Number.isInteger(value) && value >= -128 && value <= 127) { byte(TAG_BYTE); str(key); byte(value); }
    }
    byte(TAG_END);
  }
  byte(TAG_END); // end root
  return Buffer.concat(parts);
}

module.exports = { parse, writeServersDat };
