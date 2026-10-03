"use strict";
// No network, no Electron, no npm packages needed - buildZip/readZipEntries
// are pure Node fs + a hand-rolled STORE-only zip codec (see src/main/zip.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");

const { buildZip, readZipEntries, crc32 } = require("../src/main/zip");

test("crc32: known value for 'hello world'", () => {
  // Well-known reference CRC-32 for this exact string.
  assert.equal(crc32(Buffer.from("hello world")).toString(16), "d4a1185");
});

test("buildZip + readZipEntries: round-trips nested files byte-for-byte", async () => {
  const srcDir = await fsp.mkdtemp(path.join(os.tmpdir(), "zip-test-src-"));
  const outDir = await fsp.mkdtemp(path.join(os.tmpdir(), "zip-test-out-"));
  const outPath = path.join(outDir, "test.mrpack");

  try {
    await fsp.writeFile(path.join(srcDir, "modrinth.index.json"), '{"formatVersion":1}');
    await fsp.mkdir(path.join(srcDir, "overrides", "mods"), { recursive: true });
    await fsp.writeFile(
      path.join(srcDir, "overrides", "mods", "wxhud-1.0.0.jar"),
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]) // fake binary content
    );

    const { fileCount } = await buildZip(srcDir, outPath);
    assert.equal(fileCount, 2);

    // The output must itself start with a valid local-file-header signature.
    const outBuf = await fsp.readFile(outPath);
    assert.equal(outBuf.readUInt32LE(0), 0x04034b50);

    const entries = await readZipEntries(outPath);
    const names = entries.map((e) => e.name).sort();
    assert.deepEqual(names, ["modrinth.index.json", "overrides/mods/wxhud-1.0.0.jar"]);

    const index = entries.find((e) => e.name === "modrinth.index.json");
    assert.equal(index.data.toString("utf8"), '{"formatVersion":1}');

    const jar = entries.find((e) => e.name === "overrides/mods/wxhud-1.0.0.jar");
    assert.deepEqual([...jar.data], [0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
  } finally {
    await fsp.rm(srcDir, { recursive: true, force: true });
    await fsp.rm(outDir, { recursive: true, force: true });
  }
});

test("buildZip: names are flagged UTF-8, so non-ASCII file names survive", async () => {
  const srcDir = await fsp.mkdtemp(path.join(os.tmpdir(), "zip-test-utf8-"));
  const outDir = await fsp.mkdtemp(path.join(os.tmpdir(), "zip-test-utf8-out-"));
  const outPath = path.join(outDir, "pack.mrpack");
  const name = "overrides/resourcepacks/Schöne Blöcke ブロック.zip";
  try {
    await fsp.mkdir(path.join(srcDir, "overrides", "resourcepacks"), { recursive: true });
    await fsp.writeFile(path.join(srcDir, name), "pack");
    await buildZip(srcDir, outPath);

    const buf = await fsp.readFile(outPath);
    const FLAG_UTF8 = 0x0800;
    assert.equal(buf.readUInt16LE(6) & FLAG_UTF8, FLAG_UTF8, "local header flag");
    const centralStart = buf.readUInt32LE(buf.length - 22 + 16);
    assert.equal(buf.readUInt32LE(centralStart), 0x02014b50);
    assert.equal(buf.readUInt16LE(centralStart + 8) & FLAG_UTF8, FLAG_UTF8, "central directory flag");

    assert.deepEqual((await readZipEntries(outPath)).map((e) => e.name), [name]);
    // and the launcher's own reader agrees
    const zip = await require("../src/main/zipread").openZip(outPath);
    try {
      assert.deepEqual(zip.names(), [name]);
      assert.equal((await zip.read(name)).toString("utf8"), "pack");
    } finally {
      await zip.close();
    }
  } finally {
    await fsp.rm(srcDir, { recursive: true, force: true });
    await fsp.rm(outDir, { recursive: true, force: true });
  }
});

test("buildZip: more files than a zip can count is a clear error, not a silently truncated pack", async (t) => {
  const { MAX_ENTRIES } = require("../src/main/zip");
  const outDir = await fsp.mkdtemp(path.join(os.tmpdir(), "zip-test-many-"));
  const outPath = path.join(outDir, "huge.mrpack");
  // Pretend the folder holds one file too many (making 65,535 real files would only slow the suite down).
  const realReaddir = fsp.readdir;
  fsp.readdir = async () =>
    Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => ({ name: `f${i}.txt`, isDirectory: () => false, isFile: () => true }));
  t.after(() => {
    fsp.readdir = realReaddir;
  });
  try {
    await assert.rejects(buildZip(path.join(outDir, "src"), outPath), /Too many files to pack \(65535\)/);
    fsp.readdir = realReaddir;
    await assert.rejects(fsp.access(outPath), /ENOENT/, "nothing was written");
  } finally {
    fsp.readdir = realReaddir;
    await fsp.rm(outDir, { recursive: true, force: true });
  }
});
