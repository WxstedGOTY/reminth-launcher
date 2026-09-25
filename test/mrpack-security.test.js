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

    const zip = await zipread.openZip(zipPath);
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

    const zip = await zipread.openZip(zipPath);
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
