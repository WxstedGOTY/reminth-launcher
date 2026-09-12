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
