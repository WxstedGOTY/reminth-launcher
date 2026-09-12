"use strict";
// Pure-logic unit tests - no network, no Electron, no npm packages needed.
// Run with: node --test test/minecraft.test.js
//
// ensureInstalled/launch do real network/file/process I/O and are
// exercised by hand rather than here.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  mergeProfiles,
  osRulesAllow,
  collectLibraries,
  mavenCoordToPath,
  latestMatchingMavenVersion,
  versionFromJarName,
} = require("../src/main/minecraft");

test("mavenCoordToPath: plain coordinate", () => {
  assert.equal(
    mavenCoordToPath("net.fabricmc:fabric-loader:0.19.5"),
    "net/fabricmc/fabric-loader/0.19.5/fabric-loader-0.19.5.jar"
  );
});

test("mavenCoordToPath: coordinate with classifier", () => {
  assert.equal(
    mavenCoordToPath("org.lwjgl:lwjgl:3.3.3:natives-windows"),
    "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar"
  );
});

test("osRulesAllow: no rules means always allowed", () => {
  assert.equal(osRulesAllow(undefined), true);
});

test("osRulesAllow: windows-only allow rule permits windows", () => {
  assert.equal(osRulesAllow([{ action: "allow", os: { name: "windows" } }]), true);
});

test("osRulesAllow: osx-only allow rule rejects (we're windows-only)", () => {
  assert.equal(osRulesAllow([{ action: "allow", os: { name: "osx" } }]), false);
});

test("osRulesAllow: disallow-then-allow-windows overrides correctly (last match wins)", () => {
  assert.equal(
    osRulesAllow([
      { action: "disallow" }, // no os key => matches everything
      { action: "allow", os: { name: "windows" } },
    ]),
    true
  );
});

test("mergeProfiles: combines game/jvm args and libraries, uses Fabric's mainClass", () => {
  const vanilla = {
    id: "26.2",
    arguments: { game: ["--username", "${auth_player_name}"], jvm: ["-Djava.library.path=${natives_directory}"] },
    libraries: [{ name: "vanilla:lib:1.0", downloads: { artifact: { path: "a.jar", url: "https://x/a.jar", sha1: "x" } } }],
    assetIndex: { id: "26", url: "https://x/26.json" },
    assets: "26",
    javaVersion: { majorVersion: 25 },
  };
  const fabric = {
    mainClass: "net.fabricmc.loader.impl.launch.knot.KnotClient",
    arguments: { game: [], jvm: ["-DFabricMcEmu=net.minecraft.client.main.Main"] },
    libraries: [{ name: "net.fabricmc:fabric-loader:0.19.5", url: "https://maven.fabricmc.net/" }],
  };

  const merged = mergeProfiles(vanilla, fabric);

  assert.equal(merged.mainClass, "net.fabricmc.loader.impl.launch.knot.KnotClient");
  assert.equal(merged.inheritsFrom, "26.2");
  assert.deepEqual(merged.arguments.game, ["--username", "${auth_player_name}"]);
  assert.deepEqual(merged.arguments.jvm, [
    "-Djava.library.path=${natives_directory}",
    "-DFabricMcEmu=net.minecraft.client.main.Main",
  ]);
  assert.equal(merged.libraries.length, 2);
  assert.equal(merged.assets, "26");
});

test("collectLibraries: resolves normal artifact, windows natives, and fabric maven-style lib; skips non-windows-only libs", () => {
  const profile = {
    libraries: [
      {
        name: "normal:lib:1.0",
        downloads: { artifact: { path: "n.jar", url: "https://x/n.jar", sha1: "sha-n" } },
      },
      {
        name: "org.lwjgl:lwjgl:3.3.3",
        natives: { windows: "natives-windows" },
        downloads: {
          classifiers: {
            "natives-windows": { path: "lwjgl-natives-windows.jar", url: "https://x/nw.jar", sha1: "sha-w" },
          },
        },
      },
      {
        // Fabric-style: no "downloads" block, just a maven repo url + coordinate
        name: "net.fabricmc:fabric-loader:0.19.5",
        url: "https://maven.fabricmc.net/",
      },
      {
        // Mac-only lib, must be skipped since Reminth only targets Windows
        name: "mac:only:1.0",
        rules: [{ action: "allow", os: { name: "osx" } }],
        downloads: { artifact: { path: "mac.jar", url: "https://x/mac.jar", sha1: "sha-m" } },
      },
    ],
  };

  const libs = collectLibraries(profile);

  assert.equal(libs.length, 3, "the osx-only library must be excluded");
  assert.ok(libs.some((l) => l.path === "n.jar" && !l.natives));
  assert.ok(libs.some((l) => l.path === "lwjgl-natives-windows.jar" && l.natives === true));
  assert.ok(
    libs.some(
      (l) => l.path === "net/fabricmc/fabric-loader/0.19.5/fabric-loader-0.19.5.jar" && !l.natives
    )
  );
});

test("latestMatchingMavenVersion: picks the last version matching +mcVersion suffix", () => {
  const xml = `<metadata>
    <versioning>
      <versions>
        <version>0.150.0+26.1</version>
        <version>0.160.0+26.2</version>
        <version>0.160.1+26.2</version>
        <version>0.161.0+26.3</version>
      </versions>
    </versioning>
  </metadata>`;
  assert.equal(latestMatchingMavenVersion(xml, "26.2"), "0.160.1+26.2");
});

test("latestMatchingMavenVersion: returns null when nothing matches", () => {
  const xml = `<metadata><versioning><versions><version>0.150.0+26.1</version></versions></versioning></metadata>`;
  assert.equal(latestMatchingMavenVersion(xml, "99.9"), null);
});

test("versionFromJarName: extracts version from a bundled jar filename", () => {
  assert.equal(versionFromJarName("wxhud-1.0.0.jar"), "1.0.0");
});

test("versionFromJarName: handles multi-segment versions", () => {
  assert.equal(versionFromJarName("wxhud-1.2.3-beta.4.jar"), "1.2.3-beta.4");
});

test("versionFromJarName: falls back to 'unknown' for a name that doesn't match", () => {
  assert.equal(versionFromJarName("not-a-wxhud-jar.jar"), "unknown");
});
