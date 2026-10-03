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

/**
 * Finds the end-of-central-directory record in the last bytes of an archive
 * and returns { count, cdSize, cdOffset }.
 *
 * strict (the .mrpack safety scan): only a record whose comment runs exactly
 * to the end of the file is the real one. The signature bytes can also
 * appear INSIDE the comment: taking whichever comes last would let a crafted
 * archive show this reader a harmless fake directory hidden in its comment
 * while the real unzipper (yauzl, which applies this same rule) extracts
 * something else entirely.
 *
 * lenient (mod jars, which nothing here unpacks): real jars sometimes carry
 * extra bytes after the record (a signature block, padding from a build
 * tool). Java still loads them, so the launcher has to be able to read their
 * metadata too. Walk backwards and take the first record whose directory
 * really is where it says: in front of the record, and starting with a
 * central-entry signature.
 */
async function findDirectory(read, size, strict) {
  // The record sits in the last 22 bytes + up to 64KB of comment.
  const tailLen = Math.min(size, 22 + 65535);
  const tail = await read(tailLen, size - tailLen);
  const tailStart = size - tailLen;
  let refusal = null; // why a record that looked real was turned down
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) !== EOCD_SIG) continue;
    const end = i + 22 + tail.readUInt16LE(i + 20);
    if (strict ? end !== tail.length : end > tail.length) continue;
    const count = tail.readUInt16LE(i + 10);
    const cdSize = tail.readUInt32LE(i + 12);
    const cdOffset = tail.readUInt32LE(i + 16);
    // These values mean "the real numbers are in the zip64 record". A reader
    // that understands zip64 would follow it to a different directory than
    // the one parsed here, so refuse rather than disagree with it. Same for
    // multi-disk archives.
    let problem = null;
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) problem = "Zip64 archives aren't supported.";
    else if (tail.readUInt16LE(i + 4) !== 0 || tail.readUInt16LE(i + 6) !== 0 || tail.readUInt16LE(i + 8) !== count) problem = "Multi-part zip archives aren't supported.";
    else if (cdOffset + cdSize > size) problem = "Zip central directory is out of range.";
    if (strict) {
      if (problem) throw new Error(problem);
      return { count, cdSize, cdOffset };
    }
    if (!problem) {
      if (cdOffset + cdSize > tailStart + i) continue; // the directory can't overlap its own end record
      if (count === 0 && cdSize === 0) return { count, cdSize, cdOffset };
      if (cdSize >= 46 && (await read(4, cdOffset)).readUInt32LE(0) === CEN_SIG) return { count, cdSize, cdOffset };
      continue; // signature bytes that happen to sit in the trailing data
    }
    if (!refusal) refusal = problem;
  }
  throw new Error(refusal || "Not a zip file.");
}

async function readCentralDirectory(read, size, strict) {
  const { count, cdSize, cdOffset } = await findDirectory(read, size, strict);
  const cd = await read(cdSize, cdOffset);

  const entries = new Map();
  let p = 0;
  for (let n = 0; n < count; n++) {
    // Every entry the header promises must really be there - stopping early
    // would mean checking fewer entries than an unzipper goes on to extract.
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== CEN_SIG) throw new Error("Zip central directory is corrupt.");
    const method = cd.readUInt16LE(p + 10);
    const compSize = cd.readUInt32LE(p + 20);
    const rawSize = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const externalAttrs = cd.readUInt32LE(p + 38);
    const localOffset = cd.readUInt32LE(p + 42);
    if (p + 46 + nameLen > cd.length) throw new Error("Zip central directory is corrupt.");
    const name = cd.toString("utf8", p + 46, p + 46 + nameLen);
    // A Map keeps only the last entry of a name, which would hide an earlier
    // one (say, a symlink) from anyone checking this list before extracting -
    // so the safety scan refuses. Real mod jars do repeat names (two
    // "LICENSE", two "META-INF/"); for those the last one wins, the same
    // entry Java's own zip reader ends up with.
    if (strict && entries.has(name)) throw new Error(`Zip has two entries named ${name.slice(0, 80)}.`);
    entries.set(name, { method, compSize, rawSize, localOffset, externalAttrs });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** The { names, has, list, read, close } object over anything that can hand back `len` bytes at `pos`. */
function zipOver(read, entries, close) {
  return {
    names: () => [...entries.keys()],
    has: (name) => entries.has(name),
    // { name, isSymlink, size }[] - the unix file-mode bits live in the top 16
    // bits of the central-directory "external attributes" field (only
    // meaningful when the entry was made on a unix-like host, "version
    // made by" high byte 3; non-unix entries never set the symlink bit).
    list: () =>
      [...entries.entries()].map(([name, e]) => ({
        name,
        isSymlink: ((e.externalAttrs >>> 16) & 0xf000) === 0xa000,
        size: e.rawSize, // uncompressed size the archive declares
      })),
    // maxBytes: a tighter ceiling than the general one, for callers that
    // keep what they read in memory (jars nested inside a mod jar).
    async read(name, { maxBytes = MAX_ENTRY_BYTES } = {}) {
      const e = entries.get(name);
      if (!e) return null;
      const cap = Math.min(MAX_ENTRY_BYTES, maxBytes);
      if (e.rawSize > cap || e.compSize > cap) throw new Error(`${name} is too large to read.`);
      const header = await read(30, e.localOffset);
      if (header.length < 30 || header.readUInt32LE(0) !== LOC_SIG) throw new Error("Corrupt zip entry.");
      const start = e.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
      const data = await read(e.compSize, start);
      if (data.length !== e.compSize) throw new Error("Corrupt zip entry.");
      if (e.method === 0) return data;
      if (e.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: cap });
      throw new Error(`Unsupported zip compression (${e.method}).`);
    },
    close,
  };
}

/**
 * Opens a zip and returns { names(), has(name), list(), read(name) -> Buffer|null, close() }.
 *
 * { strict: true } is for an archive that is about to be UNPACKED by
 * another library (a .mrpack): the end record must finish exactly at the end
 * of the file and no name may appear twice, so what is checked here is
 * exactly what gets extracted. The default is lenient, for reading metadata
 * out of mod jars: trailing bytes are tolerated and a repeated name keeps
 * its last entry. Zip64 and multi-part archives are refused either way.
 */
async function openZip(file, { strict = false } = {}) {
  const fh = await fsp.open(file, "r");
  try {
    const { size } = await fh.stat();
    const read = async (len, pos) => {
      const buf = Buffer.alloc(len);
      const { bytesRead } = await fh.read(buf, 0, len, pos);
      return bytesRead === len ? buf : buf.subarray(0, bytesRead);
    };
    const entries = await readCentralDirectory(read, size, strict);
    return zipOver(read, entries, () => fh.close());
  } catch (err) {
    await fh.close();
    throw err;
  }
}

/** openZip for an archive already in memory (a jar nested inside a mod jar). Always lenient. */
async function openZipBuffer(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const read = async (len, pos) => buf.subarray(Math.max(0, pos), Math.max(0, pos) + len);
  const entries = await readCentralDirectory(read, buf.length, false);
  return zipOver(read, entries, async () => {});
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

module.exports = { openZip, openZipBuffer, readEntries };
