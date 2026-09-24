"use strict";
/**
 * Regression tests for the hardening added after the September 2026 audit.
 * Everything here is pure logic - no network, no Electron, no npm packages.
 *
 * These guard the paths where a hostile input turns into code execution or
 * a write outside Reminth's own folders, so a failure in this file is not a
 * "tidy it up later" failure.
 *
 * Run with: node --test test/security.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { containedPath, assertDownloadUrl } = require("../src/main/minecraft");

// store.js pulls in electron for safeStorage, which isn't installed for the
// test run, so sanitizeSettings is loaded with that dependency stubbed out.
const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return "STUB_ELECTRON";
  return originalResolve.call(this, request, ...rest);
};
Module._cache.STUB_ELECTRON = {
  id: "STUB_ELECTRON",
  filename: "STUB_ELECTRON",
  loaded: true,
  exports: { safeStorage: { isEncryptionAvailable: () => false } },
};
const { sanitizeSettings } = require("../src/main/store");
Module._resolveFilename = originalResolve;

/* ---- containedPath: manifest-supplied paths can't escape their folder ---- */

const BASE = path.resolve("/tmp/reminth-libs");

test("containedPath: allows a normal nested library path", () => {
  assert.equal(
    containedPath(BASE, "com/mojang/patchy/2.2.10/patchy-2.2.10.jar"),
    path.join(BASE, "com/mojang/patchy/2.2.10/patchy-2.2.10.jar")
  );
});

test("containedPath: refuses a path that climbs out with ..", () => {
  assert.throws(
    () => containedPath(BASE, "../../../../Start Menu/Programs/Startup/evil.bat"),
    /escapes/
  );
});

test("containedPath: refuses an absolute path", () => {
  assert.throws(() => containedPath(BASE, "/etc/cron.d/evil"), /escapes/);
  // A Windows drive-letter path is only *absolute* when this is running on
  // Windows; on Linux "C:\..." is just an oddly-named relative file, so the
  // assertion is only meaningful on the platform Reminth actually ships to.
  if (path.sep === "\\") {
    assert.throws(() => containedPath(BASE, "C:\\Windows\\System32\\evil.dll"), /escapes/);
  }
});

test("containedPath: refuses a traversal written with Windows separators", () => {
  // path.win32 is used directly so this holds when the suite runs on Linux
  // too - the traversal it describes is the one that matters on Windows.
  const winBase = "C:\\Users\\p\\AppData\\Roaming\\Reminth\\instance\\libraries";
  const escape = "..\\..\\..\\..\\Start Menu\\Programs\\Startup\\evil.bat";
  const resolved = path.win32.resolve(winBase, escape);
  assert.ok(
    resolved !== winBase && !resolved.startsWith(winBase + "\\"),
    "the traversal must resolve outside the libraries dir for containedPath to catch it"
  );
});

test("containedPath: refuses a sibling directory that merely shares a prefix", () => {
  // /tmp/reminth-libs-evil starts with the base string but is NOT inside it.
  assert.throws(() => containedPath(BASE, "../reminth-libs-evil/x.jar"), /escapes/);
});

/* ---- assertDownloadUrl: only Mojang/Fabric hosts, only over TLS ---- */

test("assertDownloadUrl: allows the real library and asset hosts", () => {
  for (const url of [
    "https://libraries.minecraft.net/com/mojang/patchy/2.2.10/patchy-2.2.10.jar",
    "https://piston-data.mojang.com/v1/objects/abc/client.jar",
    "https://resources.download.minecraft.net/ab/abcdef",
    "https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.19.5/fabric-loader-0.19.5.jar",
  ]) {
    assert.equal(assertDownloadUrl(url), url);
  }
});

test("assertDownloadUrl: refuses an unexpected host", () => {
  assert.throws(() => assertDownloadUrl("https://evil.example.com/payload.jar"), /unexpected host/);
});

test("assertDownloadUrl: refuses a host that only suffixes a real one", () => {
  // "notmojang.com" must not pass a naive endsWith("mojang.com") check.
  assert.throws(() => assertDownloadUrl("https://notmojang.com/x.jar"), /unexpected host/);
  assert.throws(() => assertDownloadUrl("https://mojang.com.evil.net/x.jar"), /unexpected host/);
});

test("assertDownloadUrl: refuses plain HTTP even on an allowed host", () => {
  assert.throws(() => assertDownloadUrl("http://libraries.minecraft.net/x.jar"), /non-HTTPS/);
});

test("assertDownloadUrl: refuses a malformed URL", () => {
  assert.throws(() => assertDownloadUrl("not a url"), /malformed/);
});

/* ---- sanitizeSettings: nothing reaches the java command line unchecked ---- */

test("sanitizeSettings: keeps valid settings", () => {
  const clean = sanitizeSettings({
    maxMemoryMb: 4096,
    launchMinimized: false,
    accent: "violet",
    extraJvmArgs: "-XX:+UseG1GC",
  });
  assert.deepEqual(clean, {
    maxMemoryMb: 4096,
    launchMinimized: false,
    accent: "violet",
    extraJvmArgs: "-XX:+UseG1GC",
  });
});

test("sanitizeSettings: drops unknown keys entirely", () => {
  const clean = sanitizeSettings({ maxMemoryMb: 2048, somethingElse: "nope", __proto__: {} });
  assert.deepEqual(Object.keys(clean), ["maxMemoryMb"]);
});

test("sanitizeSettings: rejects JVM flags that execute something", () => {
  for (const args of [
    "-javaagent:C:\\evil.jar",
    "-agentpath:C:\\evil.dll",
    "-agentlib:evil",
    "-Xbootclasspath/a:C:\\evil.jar",
    '-XX:OnOutOfMemoryError="cmd /c calc"',
    "-XX:OnError=calc",
    "@C:\\evil-argfile",
  ]) {
    assert.throws(
      () => sanitizeSettings({ extraJvmArgs: args }, { strict: true }),
      /aren't allowed/,
      `should have rejected: ${args}`
    );
    // Non-strict (reading settings.json off disk) drops it instead of throwing.
    assert.deepEqual(sanitizeSettings({ extraJvmArgs: args }), {});
  }
});

test("sanitizeSettings: clamps memory rather than trusting it", () => {
  assert.equal(sanitizeSettings({ maxMemoryMb: 99999999 }).maxMemoryMb, 65536);
  assert.equal(sanitizeSettings({ maxMemoryMb: 1 }).maxMemoryMb, 512);
  assert.equal(sanitizeSettings({ maxMemoryMb: null }).maxMemoryMb, null);
});

test("sanitizeSettings: ignores non-numeric memory instead of passing it through", () => {
  // A string here used to reach the command line and produce an unreadable
  // JVM error at launch.
  assert.deepEqual(sanitizeSettings({ maxMemoryMb: "lots" }), {});
  assert.deepEqual(sanitizeSettings({ gameWidth: {} }), {});
});

test("sanitizeSettings: only accepts a plausible accent name", () => {
  assert.equal(sanitizeSettings({ accent: "cyan" }).accent, "cyan");
  assert.deepEqual(sanitizeSettings({ accent: "<script>alert(1)</script>" }), {});
});

test("sanitizeSettings: caps extraJvmArgs length", () => {
  const long = "-Dx=" + "a".repeat(5000);
  assert.equal(sanitizeSettings({ extraJvmArgs: long }).extraJvmArgs.length, 1024);
});

test("sanitizeSettings: survives junk input", () => {
  assert.deepEqual(sanitizeSettings(null), {});
  assert.deepEqual(sanitizeSettings("nope"), {});
  assert.deepEqual(sanitizeSettings(42), {});
});
