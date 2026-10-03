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
  extractMainClass,
  osRulesAllow,
  argRuleAllows,
  resolveArguments,
  collectLibraries,
  mavenCoordToPath,
  latestMatchingMavenVersion,
  versionFromJarName,
  computeDefaultMaxMemoryMb,
  releaseMatchesVersion,
  pickJarAsset,
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

// Regression test for a real launch bug: newer Fabric loader profile builds
// return mainClass as { client, server } instead of a plain string. Passing
// that object straight through to mergeProfiles (and from there to
// child_process.spawn's args) used to silently stringify it to
// "[object Object]", which made the game crash on startup with "Could not
// find or load main class [object Object]" - a real error with a totally
// misleading message, since Reminth reported "launched" regardless (see
// minecraft.js's launch() - fixed alongside this to actually report crashes).
test("extractMainClass: plain string passes through unchanged", () => {
  assert.equal(
    extractMainClass("net.fabricmc.loader.impl.launch.knot.KnotClient"),
    "net.fabricmc.loader.impl.launch.knot.KnotClient"
  );
});

test("extractMainClass: { client, server } object - uses the client class", () => {
  assert.equal(
    extractMainClass({
      client: "net.fabricmc.loader.impl.launch.knot.KnotClient",
      server: "net.fabricmc.loader.impl.launch.knot.KnotServer",
    }),
    "net.fabricmc.loader.impl.launch.knot.KnotClient"
  );
});

test("extractMainClass: unrecognized shape throws instead of silently stringifying", () => {
  assert.throws(() => extractMainClass({ weird: true }));
  assert.throws(() => extractMainClass(null));
  assert.throws(() => extractMainClass(undefined));
});

test("mergeProfiles: uses extractMainClass, so an object-shaped Fabric mainClass still works", () => {
  const vanilla = { id: "26.2", arguments: {}, libraries: [], assetIndex: {}, assets: "26" };
  const fabric = {
    mainClass: { client: "net.fabricmc.loader.impl.launch.knot.KnotClient", server: "...KnotServer" },
    arguments: {},
    libraries: [],
  };
  const merged = mergeProfiles(vanilla, fabric);
  assert.equal(merged.mainClass, "net.fabricmc.loader.impl.launch.knot.KnotClient");
});

// Regression test for the actual real-world launch bug: Mojang's version
// JSON "arguments.jvm"/"arguments.game" arrays mix plain strings with
// conditional objects like { rules: [...], value: "..." }. Concatenating
// those raw (the old behavior) let a conditional object reach
// child_process.spawn()'s args array, where it silently stringified to
// "[object Object]" - and since it landed among the JVM args (right before
// the real main class), javaw.exe read THAT as the main class to load:
// "Could not find or load main class [object Object]". This was the actual
// cause of the "Play does nothing" bug, not a mainClass shape mismatch.
const identitySub = (s) => s;

test("resolveArguments: plain strings pass through with sub applied", () => {
  const sub = (s) => (s === "${auth_player_name}" ? "Steve" : s);
  assert.deepEqual(resolveArguments(["--username", "${auth_player_name}"], sub), [
    "--username",
    "Steve",
  ]);
});

test("resolveArguments: windows-only conditional object is included and expanded", () => {
  const entry = { rules: [{ action: "allow", os: { name: "windows" } }], value: "-Dos.name=Windows 10" };
  assert.deepEqual(resolveArguments([entry], identitySub), ["-Dos.name=Windows 10"]);
});

test("resolveArguments: macOS-only conditional object is dropped, never stringified to [object Object]", () => {
  const entry = { rules: [{ action: "allow", os: { name: "osx" } }], value: "-XstartOnFirstThread" };
  assert.deepEqual(resolveArguments([entry], identitySub), []);
});

test("resolveArguments: features-gated entry (e.g. --demo) is dropped since Reminth enables no features", () => {
  const entry = { rules: [{ action: "allow", features: { is_demo_user: true } }], value: "--demo" };
  assert.deepEqual(resolveArguments([entry], identitySub), []);
});

test("resolveArguments: array-valued entry expands each element in order", () => {
  const entry = {
    rules: [{ action: "allow", os: { name: "windows" } }],
    value: ["--width", "${resolution_width}"],
  };
  const sub = (s) => (s === "${resolution_width}" ? "1280" : s);
  assert.deepEqual(resolveArguments([entry], sub), ["--width", "1280"]);
});

test("resolveArguments: a real Mojang-shaped mixed array never leaks a raw object into the result", () => {
  const raw = [
    "--username",
    "${auth_player_name}",
    { rules: [{ action: "allow", os: { name: "osx" } }], value: "-XstartOnFirstThread" },
    { rules: [{ action: "allow", features: { is_demo_user: true } }], value: "--demo" },
    "--version",
    "${version_name}",
  ];
  const sub = (s) => (s.startsWith("${") ? "RESOLVED" : s);
  const resolved = resolveArguments(raw, sub);
  assert.ok(resolved.every((v) => typeof v === "string"), "every resolved arg must be a string");
  assert.deepEqual(resolved, ["--username", "RESOLVED", "--version", "RESOLVED"]);
});

test("argRuleAllows: last matching rule wins (disallow-all then allow-windows)", () => {
  assert.equal(
    argRuleAllows([{ action: "disallow" }, { action: "allow", os: { name: "windows" } }]),
    true
  );
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
  assert.equal(versionFromJarName("reminthhud-1.0.0.jar"), "1.0.0");
});

test("versionFromJarName: handles multi-segment versions", () => {
  assert.equal(versionFromJarName("reminthhud-1.2.3-beta.4.jar"), "1.2.3-beta.4");
});

test("versionFromJarName: falls back to 'unknown' for a name that doesn't match", () => {
  assert.equal(versionFromJarName("not-a-reminthhud-jar.jar"), "unknown");
});

test("computeDefaultMaxMemoryMb: halves total RAM, clamped to [2,6]GB (3GB on a PC with 8GB or less)", () => {
  assert.equal(computeDefaultMaxMemoryMb(4 * 1024 ** 3), 2 * 1024, "2GB machine floors at 2GB, not 1GB");
  assert.equal(computeDefaultMaxMemoryMb(16 * 1024 ** 3), 6 * 1024, "half of 16GB is 8GB, capped at 6GB");
  // Was 4GB. On an 8GB PC that plus Windows plus a browser is more than the
  // PC holds, so the automatic amount there is now 3GB (see test/perf-jvm.test.js).
  assert.equal(computeDefaultMaxMemoryMb(8 * 1024 ** 3), 3 * 1024, "an 8GB PC gets 3GB");
  assert.equal(computeDefaultMaxMemoryMb(12 * 1024 ** 3), 6 * 1024, "half of 12GB is 6GB, within range");
});

test("releaseMatchesVersion: matches on tag_name", () => {
  assert.equal(releaseMatchesVersion({ tag_name: "mc26.1.2-0.9.2", name: "" }, "26.1.2"), true);
});

test("releaseMatchesVersion: matches on name when tag doesn't contain it", () => {
  assert.equal(releaseMatchesVersion({ tag_name: "v0.9.2", name: "Sodium 0.9.2 for 26.2" }, "26.2"), true);
});

test("releaseMatchesVersion: no match", () => {
  assert.equal(releaseMatchesVersion({ tag_name: "mc26.1.2-0.9.2", name: "" }, "26.2"), false);
});

test("releaseMatchesVersion: a longer version that merely starts with mcVersion is not a match", () => {
  // 1.21.1 is a substring of 1.21.10 and 1.21.11; 1.20 of 1.20.4.
  assert.equal(releaseMatchesVersion({ tag_name: "mc1.21.10-0.6.0", name: "Sodium 0.6.0 for 1.21.11" }, "1.21.1"), false);
  assert.equal(releaseMatchesVersion({ tag_name: "mc1.20.4-0.5.8", name: "" }, "1.20"), false);
  assert.equal(releaseMatchesVersion({ tag_name: "1.21.4", name: "" }, "1.21"), false);
  // ...and it isn't the tail of a longer one either.
  assert.equal(releaseMatchesVersion({ tag_name: "v11.21.1", name: "" }, "1.21.1"), false);
  assert.equal(releaseMatchesVersion({ tag_name: "0.1.21.1", name: "" }, "1.21.1"), false);
});

test("releaseMatchesVersion: the usual tag shapes still match", () => {
  assert.equal(releaseMatchesVersion({ tag_name: "mc1.21.1-0.6.0", name: "" }, "1.21.1"), true);
  assert.equal(releaseMatchesVersion({ tag_name: "1.21.1+fabric", name: "" }, "1.21.1"), true);
  assert.equal(releaseMatchesVersion({ tag_name: "0.6.0+mc1.21", name: "" }, "1.21"), true);
  assert.equal(releaseMatchesVersion({ tag_name: "0.2.1", name: "0.2.1", body: "ScalableLux 0.2.1 for Minecraft 26.2 is released." }, "26.2"), true);
});

test("pickJarAsset: picks the plain jar over sources/javadoc jars", () => {
  const assets = [
    { name: "sodium-fabric-mc26.2-0.9.2-sources.jar", size: 50000 },
    { name: "sodium-fabric-mc26.2-0.9.2.jar", size: 900000 },
    { name: "sodium-fabric-mc26.2-0.9.2-javadoc.jar", size: 80000 },
  ];
  assert.equal(pickJarAsset(assets).name, "sodium-fabric-mc26.2-0.9.2.jar");
});

test("pickJarAsset: returns null when only sources/javadoc jars are present", () => {
  const assets = [
    { name: "x-sources.jar", size: 1000 },
    { name: "x-javadoc.jar", size: 1000 },
  ];
  assert.equal(pickJarAsset(assets), null);
});

test("pickJarAsset: returns null for an empty/missing asset list", () => {
  assert.equal(pickJarAsset([]), null);
  assert.equal(pickJarAsset(undefined), null);
});

test("pickJarAsset: real-world Lithium release - skips the tiny -api.jar stub and the neoforge build", () => {
  // Actual asset list from CaffeineMC/lithium's mc26.2-0.25.3 GitHub release.
  const assets = [
    { name: "lithium-0.25.3+mc26.2-api.jar", size: 3119 },
    { name: "lithium-fabric-0.25.3+mc26.2.jar", size: 912850 },
    { name: "lithium-neoforge-0.25.3+mc26.2.jar", size: 904073 },
  ];
  const picked = pickJarAsset(assets);
  assert.equal(picked.name, "lithium-fabric-0.25.3+mc26.2.jar");
  assert.equal(picked.size, 912850);
});

test("pickJarAsset: no 'fabric'-named jar - falls back to the largest remaining candidate", () => {
  const assets = [
    { name: "mymod-api.jar", size: 2000 },
    { name: "mymod.jar", size: 500000 },
  ];
  assert.equal(pickJarAsset(assets).name, "mymod.jar");
});

test("releaseMatchesVersion: the release notes only count when they plainly state the target", () => {
  const body = (text, v, extra = {}) => releaseMatchesVersion({ tag_name: "0.2.1", name: "0.2.1", body: text, ...extra }, v);
  assert.equal(body("ScalableLux 0.2.1 for Minecraft 26.2 is released.", "26.2"), true);
  assert.equal(body("Built against MC 1.21.1", "1.21.1"), true);
  assert.equal(body("Artifacts: scalablelux-0.2.1+mc1.21.1.jar", "1.21.1"), true);
  assert.equal(body("The 1.21.1 release of this mod.", "1.21.1"), true);
  // a number that merely turns up in the changelog is not a statement of the target
  assert.equal(body("Fixes a crash seen since 26.2 with some shaders.", "26.2"), false);
  assert.equal(body("Bumped dependency foo to 1.21.1", "1.21.1"), false);
  assert.equal(body("See issue #1.21.1", "1.21.1"), false);
  // whole versions only, same as in the tag
  assert.equal(body("for Minecraft 1.21.10", "1.21.1"), false);
  assert.equal(body("for Minecraft 1.21.1", "1.21"), false);
  assert.equal(body("", "1.21.1"), false);
});

test("releaseMatchesVersion: notes never override a tag or title that names another Minecraft version", () => {
  const notes = "Also works on Minecraft 1.21.1 if you are lucky.";
  assert.equal(releaseMatchesVersion({ tag_name: "mc1.21.4-0.6.0", name: "", body: notes }, "1.21.1"), false);
  assert.equal(releaseMatchesVersion({ tag_name: "0.6.0+1.21.4", name: "", body: notes }, "1.21.1"), false);
  assert.equal(releaseMatchesVersion({ tag_name: "v0.6.0", name: "Sodium 0.6.0 for Minecraft 1.21.4", body: notes }, "1.21.1"), false);
  assert.equal(releaseMatchesVersion({ tag_name: "v0.6.0", name: "Sodium 0.6.0 for 1.21.4", body: notes }, "1.21.1"), false);
  // a bare mod version in the tag/title says nothing about Minecraft - the notes decide
  assert.equal(releaseMatchesVersion({ tag_name: "v0.6.0", name: "Sodium 0.6.0", body: notes }, "1.21.1"), true);
});

test("pickJarAsset: with several fabric jars, the one named for this Minecraft version wins", () => {
  const assets = [
    { name: "mod-fabric-0.5.0+mc1.21.10.jar", size: 990000 },
    { name: "mod-fabric-0.5.0+mc1.21.1.jar", size: 900000 },
    { name: "mod-fabric-0.5.0+mc1.20.1.jar", size: 950000 },
    { name: "mod-neoforge-0.5.0+mc1.21.1.jar", size: 999999 },
  ];
  assert.equal(pickJarAsset(assets, "1.21.1").name, "mod-fabric-0.5.0+mc1.21.1.jar");
  assert.equal(pickJarAsset(assets, "1.21.10").name, "mod-fabric-0.5.0+mc1.21.10.jar");
  // no jar names this version: unchanged behaviour, the largest fabric jar
  assert.equal(pickJarAsset(assets, "1.19.2").name, "mod-fabric-0.5.0+mc1.21.10.jar");
  // and the old one-argument call still works
  assert.equal(pickJarAsset(assets).name, "mod-fabric-0.5.0+mc1.21.10.jar");
});

test("pickJarAsset: the version only breaks ties between fabric-named jars", () => {
  // One fabric jar: taken as before, whatever its name says.
  assert.equal(pickJarAsset([{ name: "mod-fabric-0.5.0.jar", size: 10 }], "1.21.1").name, "mod-fabric-0.5.0.jar");
  // No fabric-named jar: the -api stub carries the version, the real mod is still the largest.
  const assets = [
    { name: "lithium-0.25.3+mc26.2-api.jar", size: 3119 },
    { name: "lithium-0.25.3.jar", size: 912850 },
  ];
  assert.equal(pickJarAsset(assets, "26.2").name, "lithium-0.25.3.jar");
});
