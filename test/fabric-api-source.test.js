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
