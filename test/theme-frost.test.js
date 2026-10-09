"use strict";
/**
 * The blue theme (styles-frost.css, reminth-mark-frost.svg) is made from the orange one by tools/frost.js. If someone
 * edits styles.css and forgets to run it, the two themes drift apart - this fails then.
 * Run with: node --test test/theme-frost.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const frost = require("../tools/frost");

// store.js needs "electron"; CI installs without Electron's binary, so a stand-in like the other tests use
const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return "STUB_ELECTRON_THEME";
  return originalResolve.call(this, request, ...rest);
};
Module._cache.STUB_ELECTRON_THEME = { id: "STUB_ELECTRON_THEME", filename: "STUB_ELECTRON_THEME", loaded: true, exports: { safeStorage: { isEncryptionAvailable: () => false } } };

const ROOT = path.join(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

test("styles-frost.css is styles.css made blue (run: node tools/frost.js)", () => {
  const made = frost.frostCss(read("src", "renderer", "styles.css"));
  const file = read("src", "renderer", "styles-frost.css").replace(/^\/\*.*?\*\/\n/, "");
  assert.equal(file, made);
});

test("the blue cube is the orange one made blue", () => {
  assert.equal(read("assets", "icons", "source", "reminth-mark-frost.svg"), frost.frostText(read("assets", "icons", "source", "reminth-mark.svg")));
});

test("frost: oranges become blue, status colours and greys stay", () => {
  const hex = (c) => { const n = parseInt(c.slice(1), 16); const v = frost.frost(n >> 16, (n >> 8) & 255, n & 255); return v && "#" + v.map((x) => x.toString(16).padStart(2, "0")).join(""); };
  const [r, g, b] = frost.frost(255, 74, 28);
  assert.ok(b > r && g > r, "brand orange becomes a cyan/blue");
  for (const keep of ["#fbbf24", "#ff5c8a", "#34d399", "#ffffff", "#000000", "#5c5a6a"]) assert.equal(hex(keep), null, keep);
  const [nr, ng, nb] = frost.frost(12, 9, 9);
  assert.ok(nb > nr, "the charcoal background becomes navy");
});

test("the theme setting only takes ember or frost", () => {
  const store = require("../src/main/store");
  assert.equal(store.DEFAULT_SETTINGS.theme, "ember");
  assert.equal(store.sanitizeSettings({ theme: "frost" }).theme, "frost");
  assert.equal(store.sanitizeSettings({ theme: "pink" }).theme, "ember");
});
