"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { pickFabricApiRelease } = require("../src/main/minecraft");

const v = (over = {}) => ({
  id: "id1",
  project_id: "P7dR8mSH",
  version_number: "0.77.0+1.18.2",
  name: "[1.18.2] Fabric API 0.77.0",
  version_type: "release",
  game_versions: ["1.18.2"],
  loaders: ["fabric"],
  date_published: "2022-12-01T00:00:00Z",
  files: [{ primary: true, filename: "fabric-api-0.77.0+1.18.2.jar", url: "https://cdn.modrinth.com/data/P7dR8mSH/versions/x/fabric-api-0.77.0%2B1.18.2.jar", hashes: { sha1: "a".repeat(40) } }],
  dependencies: [],
  ...over,
});

test("pickFabricApiRelease: the newest release for that Minecraft version", () => {
  const older = v({ id: "o", version_number: "0.76.0+1.18.2", date_published: "2022-10-01T00:00:00Z" });
  const got = pickFabricApiRelease([older, v()], "1.18.2");
  assert.equal(got.id, "id1");
  assert.equal(got.file.filename, "fabric-api-0.77.0+1.18.2.jar");
});

test("pickFabricApiRelease: betas, other Minecraft versions, other loaders and foreign hosts never count", () => {
  assert.equal(pickFabricApiRelease([v({ version_type: "beta" })], "1.18.2"), null);
  assert.equal(pickFabricApiRelease([v({ game_versions: ["1.19"] })], "1.18.2"), null);
  assert.equal(pickFabricApiRelease([v({ loaders: ["forge"] })], "1.18.2"), null);
  assert.equal(pickFabricApiRelease([v({ files: [{ primary: true, filename: "x.jar", url: "https://evil.example/x.jar", hashes: { sha1: "a".repeat(40) } }] })], "1.18.2"), null);
  assert.equal(pickFabricApiRelease([], "1.18.2"), null);
  assert.equal(pickFabricApiRelease(null, "1.18.2"), null);
});

test("uniquePaths: a jar on the classpath twice (NeoForge 1.20.6) is kept once, in order, whatever the letter case", () => {
  const { uniquePaths } = require("../src/main/minecraft");
  assert.deepEqual(uniquePaths(["C:\a.jar", "C:\b.jar", "c:\A.JAR", "C:\b.jar", "C:\c.jar"]), ["C:\a.jar", "C:\b.jar", "C:\c.jar"]);
  assert.deepEqual(uniquePaths([]), []);
  assert.deepEqual(uniquePaths(null), []);
});

test("libraryKey: an @jar suffix does not make it another library (NeoForge 1.20.6 duplicated log4j and slf4j)", () => {
  const forge = require("../src/main/forge");
  assert.equal(forge.libraryKey("org.slf4j:slf4j-api:2.0.9@jar"), forge.libraryKey("org.slf4j:slf4j-api:2.0.9"));
  assert.equal(forge.libraryKey("org.slf4j:slf4j-api:2.0.9@jar"), forge.libraryKey("org.slf4j:slf4j-api:2.0.16"));
  assert.notEqual(forge.libraryKey("a:b:1@zip"), forge.libraryKey("a:b:1"));
  assert.notEqual(forge.libraryKey("org.lwjgl:lwjgl:3.3.3"), forge.libraryKey("org.lwjgl:lwjgl:3.3.3:natives-windows"));
});

test("acceptsWindowSize: the 2013 snapshots 13w16a to 13w23a refuse --width/--height", () => {
  const { acceptsWindowSize } = require("../src/main/minecraft");
  assert.equal(acceptsWindowSize("13w16a"), false);
  assert.equal(acceptsWindowSize("13w16b"), false);
  for (const id of ["13w17a", "13w18c", "13w19a", "13w21b", "13w23a"]) assert.equal(acceptsWindowSize(id), false, id);
  assert.equal(acceptsWindowSize("13w24a"), true);
  assert.equal(acceptsWindowSize("13w15a"), true);
  assert.equal(acceptsWindowSize("1.5.2"), true);
  assert.equal(acceptsWindowSize("26.3"), true);
  assert.equal(acceptsWindowSize(undefined), true);
});

test("isEarlyNativeCrash: only a Windows access violation in the first seconds counts", () => {
  const { isEarlyNativeCrash } = require("../src/main/minecraft");
  assert.equal(isEarlyNativeCrash({ code: 3221225477, elapsedMs: 5337 }), true);
  assert.equal(isEarlyNativeCrash({ code: -1073741819, elapsedMs: 900 }), true);
  assert.equal(isEarlyNativeCrash({ code: 3221225477, elapsedMs: 60000 }), false); // a crash in play
  assert.equal(isEarlyNativeCrash({ code: 1, elapsedMs: 2000 }), false); // an ordinary error exit
  assert.equal(isEarlyNativeCrash({ code: 0, elapsedMs: 2000 }), false);
  assert.equal(isEarlyNativeCrash({}), false);
  assert.equal(isEarlyNativeCrash(), false);
});
