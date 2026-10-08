"use strict";
/**
 * The REAL bundled jars in assets/mods (8 Oct 2026: a quick test build of ReminthHUD that only accepted "1.21.1" was
 * copied over the "1.21-1.21.1" jar, so 1.21 instances got no Reminth panel). Each jar's name says which Minecraft
 * versions it is for ("+1.21-1.21.1", "+1.21.6-1.21.8", "+26.2"); the launcher must pick that jar for both ends.
 * Run with: node --test test/bundled-jar-ranges.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "reminth-jar-ranges-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.APPDATA = path.join(HOME, "AppData", "Roaming");
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return "STUB_ELECTRON_JAR_RANGES";
  return originalResolve.call(this, request, ...rest);
};
Module._cache.STUB_ELECTRON_JAR_RANGES = { id: "STUB_ELECTRON_JAR_RANGES", filename: "STUB_ELECTRON_JAR_RANGES", loaded: true, exports: { safeStorage: { isEncryptionAvailable: () => false } } };

const minecraft = require("../src/main/minecraft");
const ASSETS = path.join(__dirname, "..", "assets", "mods");

for (const mod of ["reminthhud", "reminthhome"]) {
  test(`every bundled ${mod} jar is picked for the Minecraft versions its name says`, async () => {
    const jars = fs.readdirSync(ASSETS).filter((f) => f.startsWith(mod + "-") && f.endsWith(".jar"));
    assert.ok(jars.length >= 10, `${mod}: expected a jar per version line, found ${jars.length}`);
    for (const jar of jars) {
      const span = jar.slice(0, -4).split("+")[1]; // "1.21-1.21.1", "26.2"
      // 26.x jars are named by line ("26.1") and accept its patches ("26.1.2"); 1.x names are exact versions
      const ends = /^26\.\d+$/.test(span) ? [span, span + ".1"] : span.split("-");
      for (const v of ends) {
        const build = await minecraft.findBundledModFor(mod, v);
        assert.ok(build, `${mod} for Minecraft ${v}: no jar picked (expected ${jar})`);
        assert.equal(path.basename(build.file), jar, `${mod} for Minecraft ${v}`);
      }
    }
  });
}
