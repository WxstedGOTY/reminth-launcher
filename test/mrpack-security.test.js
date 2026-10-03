"use strict";
// mrpack.js must refuse to hand extract-zip an archive it could be tricked
// into writing outside its target dir (GHSA-jmr9-qjv8-65gv / GHSA-7pqw-9j4j-h8q3:
// unpatched symlink-based path traversal). These tests build tiny hand-rolled
// zips (no network, no Electron, no third-party zip lib) to check the
// pre-extraction scan in isolation.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");

const { crc32 } = require("../src/main/zip");
const zipread = require("../src/main/zipread");
const { isUnsafeEntryName, assertNoUnsafeEntries } = require("../src/main/mrpack");

const S_IFLNK = 0xa000; // unix symlink mode bit, packed into the top 16 bits of "external attributes"

/** Same layout as zip.js's buildZip, but lets each entry set an arbitrary name/data/unix mode. */
async function buildRawZip(outPath, entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  const { time, date } = { time: 0, date: 0x21 }; // fixed, contents don't matter for this test

  for (const { name, data, unixMode } of entries) {
    const buf = data || Buffer.alloc(0);
    const crc = crc32(buf);
    const nameBuf = Buffer.from(name, "utf8");

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(buf.length, 18);
    localHeader.writeUInt32LE(buf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    parts.push(localHeader, nameBuf, buf);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE((3 << 8) | 20, 4); // version made by: unix (host 3) so the mode bits are meaningful
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(buf.length, 20);
    centralHeader.writeUInt32LE(buf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(((unixMode || 0) << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([centralHeader, nameBuf]));

    offset += localHeader.length + nameBuf.length + buf.length;
  }

  const centralBuf = Buffer.concat(central);
  const centralStart = offset;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);

  await fsp.writeFile(outPath, Buffer.concat([...parts, centralBuf, eocd]));
}

test("isUnsafeEntryName: pure traversal checks", () => {
  assert.equal(isUnsafeEntryName("overrides/mods/foo.jar"), false);
  assert.equal(isUnsafeEntryName("modrinth.index.json"), false);
  assert.equal(isUnsafeEntryName("../evil.txt"), true);
  assert.equal(isUnsafeEntryName("overrides/../../evil.txt"), true);
  assert.equal(isUnsafeEntryName("/etc/passwd"), true);
  assert.equal(isUnsafeEntryName("C:\\Windows\\evil.dll"), true);
  assert.equal(isUnsafeEntryName("overrides\\mods\\..\\..\\evil.jar"), true);
});

test("assertNoUnsafeEntries: rejects a symlink entry from a real zip's central directory", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "mrpack-sec-"));
  try {
    const zipPath = path.join(dir, "evil.mrpack");
    await buildRawZip(zipPath, [
      { name: "modrinth.index.json", data: Buffer.from('{"formatVersion":1}') },
      // a symlink entry named "overrides/link" pointing at "../../../../" - the
      // exact shape of GHSA-jmr9-qjv8-65gv: a later entry written "through"
      // this link lands outside extractDir once extract-zip follows it.
      { name: "overrides/link", data: Buffer.from("../../../../"), unixMode: S_IFLNK | 0o777 },
    ]);

    const zip = await zipread.openZip(zipPath, { strict: true });
    let list;
    try {
      list = zip.list();
    } finally {
      await zip.close();
    }
    const link = list.find((e) => e.name === "overrides/link");
    assert.ok(link, "the symlink entry should be present in the central directory listing");
    assert.equal(link.isSymlink, true);

    assert.throws(() => assertNoUnsafeEntries(list), /unsafe archive entries/);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test("assertNoUnsafeEntries: a clean pack with only ordinary files passes", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "mrpack-sec-clean-"));
  try {
    const zipPath = path.join(dir, "clean.mrpack");
    await buildRawZip(zipPath, [
      { name: "modrinth.index.json", data: Buffer.from('{"formatVersion":1}') },
      { name: "overrides/mods/foo.jar", data: Buffer.from([0x50, 0x4b, 3, 4]) },
      { name: "overrides/config/foo.toml", data: Buffer.from("enabled=true") },
    ]);

    const zip = await zipread.openZip(zipPath, { strict: true });
    let list;
    try {
      list = zip.list();
    } finally {
      await zip.close();
    }
    assert.equal(list.some((e) => e.isSymlink), false);
    assert.doesNotThrow(() => assertNoUnsafeEntries(list));
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

/* ---- a fake directory hidden in the zip comment; duplicate names; zip bombs ---- */

const { assertReasonableSize, MAX_UNPACKED_BYTES } = require("../src/main/mrpack");

async function listOf(zipPath) {
  const zip = await zipread.openZip(zipPath, { strict: true });
  try {
    return zip.list();
  } finally {
    await zip.close();
  }
}

test("zipread: a fake end-of-directory record hidden in the zip comment is not believed", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "mrpack-sec-eocd-"));
  try {
    // What a real unzipper (yauzl/extract-zip) sees: a pack with a symlink in it.
    const evilPath = path.join(dir, "evil.zip");
    await buildRawZip(evilPath, [
      { name: "modrinth.index.json", data: Buffer.from('{"formatVersion":1}') },
      { name: "overrides/link", data: Buffer.from("../../../../"), unixMode: S_IFLNK | 0o777 },
    ]);
    // What the attacker wants the pre-scan to see instead: a harmless pack.
    const decoyPath = path.join(dir, "decoy.zip");
    await buildRawZip(decoyPath, [{ name: "modrinth.index.json", data: Buffer.from('{"formatVersion":1}') }]);

    const evil = await fsp.readFile(evilPath);
    const decoy = await fsp.readFile(decoyPath);
    // The decoy's central directory + end record are tucked into the real
    // archive's comment, re-pointed so they parse when read from there, and
    // followed by a few more comment bytes: the fake record is then the
    // LAST signature in the file, but its (empty) comment doesn't reach the
    // end of the file - which is how a real unzipper tells it isn't the one.
    const decoyEocd = decoy.length - 22;
    const decoyCdOffset = decoy.readUInt32LE(decoyEocd + 16);
    const decoyLocal = decoy.subarray(0, decoyCdOffset);
    const padding = Buffer.from("pad!");
    const comment = Buffer.concat([decoyLocal, decoy.subarray(decoyCdOffset), padding]);
    const base = evil.length; // where the comment starts in the combined file
    const fakeEocd = comment.length - padding.length - 22;
    const cd = comment.subarray(decoyLocal.length, fakeEocd);
    cd.writeUInt32LE(base, 42); // the decoy entry's local header now lives in the comment
    comment.writeUInt32LE(base + decoyLocal.length, fakeEocd + 16);
    const crafted = Buffer.concat([evil, comment]);
    crafted.writeUInt16LE(comment.length, evil.length - 22 + 20); // the REAL record's comment length
    const craftedPath = path.join(dir, "crafted.mrpack");
    await fsp.writeFile(craftedPath, crafted);

    // The scan must read the same directory the unzipper will: the real one.
    const list = await listOf(craftedPath);
    assert.deepEqual(list.map((e) => e.name), ["modrinth.index.json", "overrides/link"]);
    assert.throws(() => assertNoUnsafeEntries(list), /unsafe archive entries/);

    // A record whose comment doesn't end exactly at the end of the file isn't one at all.
    const trailing = path.join(dir, "trailing.zip");
    await fsp.writeFile(trailing, Buffer.concat([decoy, Buffer.from("junk after the archive")]));
    await assert.rejects(zipread.openZip(trailing, { strict: true }), /Not a zip file/);
    // ...for the pack scan. A mod jar with bytes after its end record is
    // still a jar Java loads, so the default (lenient) reader opens it.
    const lenient = await zipread.openZip(trailing);
    try {
      assert.deepEqual(lenient.names(), ["modrinth.index.json"]);
      assert.equal(String(await lenient.read("modrinth.index.json")), '{"formatVersion":1}');
    } finally {
      await lenient.close();
    }
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test("zipread: two entries with the same name are refused (the first could be a hidden symlink)", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "mrpack-sec-dup-"));
  try {
    const zipPath = path.join(dir, "dup.mrpack");
    await buildRawZip(zipPath, [
      { name: "modrinth.index.json", data: Buffer.from('{"formatVersion":1}') },
      { name: "overrides/config", data: Buffer.from("../../../../"), unixMode: S_IFLNK | 0o777 },
      { name: "overrides/config", data: Buffer.from("looks like a plain file") },
    ]);
    await assert.rejects(zipread.openZip(zipPath, { strict: true }), /two entries named overrides\/config/);
    // The default reader (mod jars, never unpacked) keeps the last of the two.
    const lenient = await zipread.openZip(zipPath);
    try {
      assert.deepEqual(lenient.names(), ["modrinth.index.json", "overrides/config"]);
      assert.equal(String(await lenient.read("overrides/config")), "looks like a plain file");
    } finally {
      await lenient.close();
    }
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test("zipread: zip64 markers and a directory shorter than it claims are refused", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "mrpack-sec-z64-"));
  try {
    const zipPath = path.join(dir, "a.zip");
    await buildRawZip(zipPath, [{ name: "a.txt", data: Buffer.from("a") }]);
    const good = await fsp.readFile(zipPath);
    const eocd = good.length - 22;

    // 0xffff entries = "the real directory is in the zip64 record": a
    // zip64-aware unzipper would read a different directory than we scan.
    const z64 = Buffer.from(good);
    z64.writeUInt16LE(0xffff, eocd + 8);
    z64.writeUInt16LE(0xffff, eocd + 10);
    await fsp.writeFile(zipPath, z64);
    await assert.rejects(zipread.openZip(zipPath, { strict: true }), /Zip64/);
    await assert.rejects(zipread.openZip(zipPath), /Zip64/); // lenient mode refuses zip64 too

    // claims two entries, holds one: stopping early would under-scan
    const short = Buffer.from(good);
    short.writeUInt16LE(2, eocd + 8);
    short.writeUInt16LE(2, eocd + 10);
    await fsp.writeFile(zipPath, short);
    await assert.rejects(zipread.openZip(zipPath, { strict: true }), /central directory is corrupt/);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test("assertReasonableSize: refuses a pack that would unpack to more than the limit", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "mrpack-sec-bomb-"));
  try {
    const zipPath = path.join(dir, "bomb.mrpack");
    await buildRawZip(zipPath, [
      { name: "modrinth.index.json", data: Buffer.from('{"formatVersion":1}') },
      { name: "overrides/a.bin", data: Buffer.from("tiny") },
      { name: "overrides/b.bin", data: Buffer.from("tiny") },
    ]);
    // Declare each override as ~3 GB uncompressed in the central directory
    // (what a deflate bomb does) without actually storing that much.
    const buf = await fsp.readFile(zipPath);
    let p = buf.readUInt32LE(buf.length - 22 + 16);
    for (let n = 0; n < 3; n++) {
      const nameLen = buf.readUInt16LE(p + 28);
      if (n > 0) buf.writeUInt32LE(3 * 1024 * 1024 * 1024, p + 24);
      p += 46 + nameLen;
    }
    await fsp.writeFile(zipPath, buf);

    const list = await listOf(zipPath);
    assert.equal(list.find((e) => e.name === "overrides/a.bin").size, 3 * 1024 * 1024 * 1024);
    assert.throws(() => assertReasonableSize(list), /would unpack to 6\.0 GB/);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }

  assert.doesNotThrow(() => assertReasonableSize([{ name: "a", size: MAX_UNPACKED_BYTES }]));
  assert.throws(() => assertReasonableSize([{ name: "a", size: MAX_UNPACKED_BYTES }, { name: "b", size: 1 }]), /Refusing to unpack/);
  assert.throws(() => assertReasonableSize(Array.from({ length: 200001 }, (_, i) => ({ name: String(i), size: 0 }))), /more than any real modpack/);
});
