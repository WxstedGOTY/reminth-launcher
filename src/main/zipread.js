"use strict";
/**
 * Reads individual files out of a .zip/.jar without unpacking the whole
 * thing - used for the default skins inside the game's own client jar,
 * fabric.mod.json + icons inside mod jars, and modrinth.index.json inside a
 * .mrpack. Zip64 and encrypted archives aren't supported (none of those
 * files are either).
 *
 * Every size is capped: a mod jar is a file the player (or anyone who
 * handed them a jar) controls, and a zip bomb must not be able to take the
 * launcher down by claiming a 4GB entry.
 */
const fs = require("fs");
const fsp = fs.promises;
const zlib = require("zlib");

const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

async function readCentralDirectory(fh, size) {
  // The end-of-central-directory record sits in the last 22 bytes + up to 64KB of comment.
  const tailLen = Math.min(size, 22 + 65535);
  const tail = Buffer.alloc(tailLen);
  await fh.read(tail, 0, tailLen, size - tailLen);
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip file.");
  const count = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  if (cdOffset + cdSize > size) throw new Error("Zip central directory is out of range.");
  const cd = Buffer.alloc(cdSize);
  await fh.read(cd, 0, cdSize, cdOffset);

  const entries = new Map();
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cd.length; n++) {
    if (cd.readUInt32LE(p) !== CEN_SIG) break;
    const method = cd.readUInt16LE(p + 10);
    const compSize = cd.readUInt32LE(p + 20);
    const rawSize = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const localOffset = cd.readUInt32LE(p + 42);
    const name = cd.toString("utf8", p + 46, p + 46 + nameLen);
    entries.set(name, { method, compSize, rawSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Opens a zip and returns { names(), read(name) -> Buffer|null, close() }. */
async function openZip(file) {
  const fh = await fsp.open(file, "r");
  try {
    const { size } = await fh.stat();
    const entries = await readCentralDirectory(fh, size);
    return {
      names: () => [...entries.keys()],
      has: (name) => entries.has(name),
      async read(name) {
        const e = entries.get(name);
        if (!e) return null;
        if (e.rawSize > MAX_ENTRY_BYTES || e.compSize > MAX_ENTRY_BYTES) throw new Error(`${name} is too large to read.`);
        const header = Buffer.alloc(30);
        await fh.read(header, 0, 30, e.localOffset);
        if (header.readUInt32LE(0) !== LOC_SIG) throw new Error("Corrupt zip entry.");
        const start = e.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
        const data = Buffer.alloc(e.compSize);
        await fh.read(data, 0, e.compSize, start);
        if (e.method === 0) return data;
        if (e.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
        throw new Error(`Unsupported zip compression (${e.method}).`);
      },
      close: () => fh.close(),
    };
  } catch (err) {
    await fh.close();
    throw err;
  }
}

/** Convenience: read a handful of entries and close. Missing entries come back null. */
async function readEntries(file, names) {
  const zip = await openZip(file);
  try {
    const out = {};
    for (const name of names) {
      try {
        out[name] = await zip.read(name);
      } catch {
        out[name] = null;
      }
    }
    return out;
  } finally {
    await zip.close();
  }
}

module.exports = { openZip, readEntries };
