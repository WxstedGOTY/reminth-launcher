"use strict";
/**
 * Reminth accounts in the launcher: the reminth://auth link and the rule that a sign-in link only counts when this
 * app started a sign-in (so a link on some web page can't sign anyone into a stranger's account).
 * The server side is checked end to end by tools/accounts-e2e.js against `wrangler pages dev`.
 * Run with: node --test test/reminth-account.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "reminth-acct-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return "STUB_ELECTRON_ACCT";
  return originalResolve.call(this, request, ...rest);
};
Module._cache.STUB_ELECTRON_ACCT = { id: "STUB_ELECTRON_ACCT", filename: "STUB_ELECTRON_ACCT", loaded: true, exports: { safeStorage: { isEncryptionAvailable: () => false } } };

const deepLink = require("../src/main/deepLink");
const acct = require("../src/main/reminthAccount");

const CODE = "0123456789abcdef0123456789abcdef";

test("reminth://auth/<32 hex> is a sign-in link; anything else like it is not", () => {
  assert.deepEqual(deepLink.parseDeepLink(["Reminth.exe", "reminth://auth/" + CODE]), { page: "auth", code: CODE });
  assert.deepEqual(deepLink.parseDeepLink("reminth://auth/" + CODE + "/"), { page: "auth", code: CODE });
  for (const bad of ["reminth://auth/" + CODE.slice(1), "reminth://auth/" + CODE + "0", "reminth://auth/" + CODE.toUpperCase(), "reminth://auth/" + CODE + "?x=1", "reminth://auth", "reminth://auth/../skins"]) {
    assert.equal(deepLink.parseDeepLink(bad), null, bad);
  }
  assert.deepEqual(deepLink.parseDeepLink("reminth://skins"), { page: "skins" }, "the old links still work");
});

test("a sign-in link the app didn't start is ignored, and one older than 10 minutes too", async () => {
  assert.deepEqual(await acct.completeSignIn(CODE), { error: "not_started" });
  acct._test.setPending({ nonce: "a".repeat(48), at: Date.now() - 11 * 60 * 1000 });
  assert.deepEqual(await acct.completeSignIn(CODE), { error: "not_started" });
});

test("starting a sign-in makes a fresh random nonce for the app's own address", () => {
  const a = acct.startSignIn();
  const b = acct.startSignIn();
  assert.match(a, /\/api\/auth\/discord\/start\?client=app&nonce=[a-f0-9]{48}$/);
  assert.notEqual(a, b);
});

test("a malformed code is refused without asking the server", async () => {
  acct.startSignIn();
  assert.deepEqual(await acct.completeSignIn("not-a-code"), { error: "bad_code" });
});

test("signed out with nothing saved: no account", async () => {
  assert.deepEqual(await acct.get(), { user: null });
});
