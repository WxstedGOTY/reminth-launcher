"use strict";
/**
 * Tests for the September 2026 features: instances, logs, content,
 * modpacks, servers, skins, streamer settings, the WebM joiner.
 * Pure logic only - no network, no Electron.
 * Run with: node --test
 */
const test = require("node:test");
const assert = require("node:assert/strict");

// Several modules pull in electron (safeStorage, BrowserWindow...) - stub it.
const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return "STUB_ELECTRON_FEATURES";
  return originalResolve.call(this, request, ...rest);
};
Module._cache.STUB_ELECTRON_FEATURES = {
  id: "STUB_ELECTRON_FEATURES",
  filename: "STUB_ELECTRON_FEATURES",
  loaded: true,
  exports: { safeStorage: { isEncryptionAvailable: () => false } },
};

const logs = require("../src/main/logs");
const instances = require("../src/main/instances");
const content = require("../src/main/content");
const mrpack = require("../src/main/mrpack");
const serverPing = require("../src/main/serverPing");
const nbt = require("../src/main/nbt");
const skin = require("../src/main/skin");
const store = require("../src/main/store");
const minecraft = require("../src/main/minecraft");
const java = require("../src/main/java");
const modrinth = require("../src/main/modrinth");
const webm = require("../src/main/webm");

/* ---------------- logs ---------------- */

test("logs: a ban/kick disconnect line is important", () => {
  const { CAT } = logs;
  assert.equal(logs.classify("[14:58:44] [Render thread/INFO]: Disconnected from server, reason: You are banned from this server."), CAT.important);
  assert.equal(logs.classify("[14:58:44] [Render thread/INFO]: Lost connection: Timed out"), CAT.important);
  assert.equal(logs.classify("[10:00:00] [Render thread/INFO]: [System] [CHAT] You have been muted for 1h"), CAT.important);
});

test("logs: levels and chat are bucketed, stack traces follow their error", () => {
  const { CAT } = logs;
  assert.equal(logs.classify("[1:00:00] [main/WARN]: something odd"), CAT.warn);
  assert.equal(logs.classify("[1:00:00] [main/ERROR]: broke"), CAT.error);
  assert.equal(logs.classify("[1:00:00] [Render thread/INFO]: [System] [CHAT] <Steve> hi"), CAT.chat);
  assert.equal(logs.classify("[1:00:00] [main/INFO]: Loading"), CAT.info);
  assert.equal(logs.classify("\tat net.minecraft.Foo.bar(Foo.java:1)", CAT.error), CAT.error);
  assert.equal(logs.classify("\tat net.minecraft.Foo.bar(Foo.java:1)", CAT.info), CAT.error);
});

test("logs: analyse counts every bucket", () => {
  const r = logs.analyse("[1:00:00] [main/INFO]: a\n[1:00:01] [main/WARN]: b\n[1:00:02] [x/INFO]: [CHAT] c\n");
  assert.equal(r.lines.length, 3);
  assert.deepEqual(r.counts, { info: 1, chat: 1, warn: 1, error: 0, important: 0 });
});

test("logs: dates come out of rolled log and crash report names", () => {
  assert.ok(logs.dateFromName("2026-09-23-2.log.gz") > 0);
  assert.ok(logs.dateFromName("crash-2026-09-19_12.00.00-client.txt") > 0);
  assert.equal(logs.dateFromName("latest.log"), null);
});

/* ---------------- instances ---------------- */

test("instances: valid version ids, including snapshots, betas and alphas", () => {
  for (const v of ["26.2", "1.8.9", "26.4-snapshot-1", "b1.7.3", "a1.0.4", "rd-132211", "1.14 Pre-Release 5"]) {
    assert.ok(instances.isValidVersionId(v), v);
  }
  for (const v of ["", "../x", "a/b", "x".repeat(80), null]) assert.ok(!instances.isValidVersionId(v), String(v));
});

test("instances: sanitize drops unknown fields and bad ids", () => {
  assert.equal(instances.sanitizeInstance({ id: "../evil", mcVersion: "1.20" }), null);
  const inst = instances.sanitizeInstance({ id: "abc-1", mcVersion: "1.20.1", loader: "forge", loaderVersion: "47.4.0", evil: true, name: " My pack " });
  assert.equal(inst.loader, "forge");
  assert.equal(inst.loaderVersion, "47.4.0");
  assert.equal(inst.hud, false);
  assert.equal(instances.sanitizeInstance({ id: "abc-2", mcVersion: "1.20.1", loader: "liteloader" }).loader, "vanilla");
  assert.equal(instances.sanitizeInstance({ id: "abc-3", mcVersion: "1.20.1", loader: "vanilla", loaderVersion: "1.0" }).loaderVersion, null);
  assert.equal(instances.sanitizeInstance({ id: "abc-4", mcVersion: "1.20.1", loader: "neoforge", loaderVersion: "../x" }).loaderVersion, null);
  assert.equal(instances.sanitizeInstance({ id: "reminth", mcVersion: "26.2", loader: "fabric" }).hud, true);
  assert.equal(instances.sanitizeInstance({ id: "reminth", mcVersion: "26.2", loader: "fabric", hud: false }).hud, false);
  assert.equal(inst.name, "My pack");
  assert.equal(inst.evil, undefined);
  assert.equal(inst.managed, false);
  assert.equal(instances.sanitizeInstance({ id: "reminth", mcVersion: "26.2", loader: "fabric" }).managed, true);
});

test("instances: slugify keeps ids to a-z0-9-", () => {
  assert.equal(instances.slugify("Survival 1.21!!"), "survival-1-21");
  assert.equal(instances.slugify("???"), "instance");
});

/* ---------------- content ---------------- */

test("content: file names can't escape their folder", () => {
  assert.equal(content.safeFileName("sodium-0.7.jar"), "sodium-0.7.jar");
  assert.equal(content.safeFileName("../../evil.jar"), "evil.jar");
  assert.throws(() => content.safeFileName(".."));
  assert.throws(() => content.safeFileName("CON"));
  assert.throws(() => content.within("/tmp/inst", "../outside"), /outside/);
});

test("content: loaders per kind and instance", () => {
  assert.deepEqual(content.loadersFor("mod", { loader: "fabric" }), ["fabric"]);
  assert.deepEqual(content.loadersFor("mod", { loader: "vanilla" }), []);
  assert.deepEqual(content.loadersFor("mod", { loader: "quilt" }), ["quilt", "fabric"]);
  assert.deepEqual(content.loadersFor("mod", { loader: "forge" }), ["forge"]);
  assert.deepEqual(content.loadersFor("mod", { loader: "neoforge", mcVersion: "1.21.1" }), ["neoforge"]);
  assert.deepEqual(content.loadersFor("mod", { loader: "neoforge", mcVersion: "1.20.1" }), ["neoforge", "forge"]);
  assert.deepEqual(content.shaderModsFor({ loader: "forge" }), ["GchcoXML"]);
  assert.deepEqual(content.shaderModsFor({ loader: "quilt" }), ["YL57xq9U"]);
  assert.deepEqual(content.shaderModsFor({ loader: "vanilla" }), []);
  assert.deepEqual(content.loadersFor("shader", { loader: "fabric" }), ["iris", "optifine"]);
  assert.deepEqual(content.loadersFor("resourcepack", {}), ["minecraft"]);
  assert.deepEqual(content.loadersFor("datapack", {}), ["datapack"]);
});

test("content: pickVersion prefers a release over a newer beta", () => {
  const v = content.pickVersion([{ id: "b", version_type: "beta" }, { id: "r", version_type: "release" }]);
  assert.equal(v.id, "r");
  assert.equal(content.pickVersion([{ id: "a", version_type: "alpha" }]).id, "a");
  assert.equal(content.pickVersion([]), null);
});

/* ---------------- modpacks ---------------- */

test("mrpack: every loader's packs map to an instance loader", () => {
  assert.deepEqual(mrpack.loaderFromDependencies({ minecraft: "1.21.1", "fabric-loader": "0.16.5" }), { loader: "fabric", loaderVersion: "0.16.5", mcVersion: "1.21.1" });
  assert.equal(mrpack.loaderFromDependencies({ minecraft: "1.20.1" }).loader, "vanilla");
  assert.deepEqual(mrpack.loaderFromDependencies({ minecraft: "1.20.1", forge: "47.2.0" }), { loader: "forge", loaderVersion: "47.2.0", mcVersion: "1.20.1" });
  assert.deepEqual(mrpack.loaderFromDependencies({ minecraft: "1.21.1", neoforge: "21.1.77" }), { loader: "neoforge", loaderVersion: "21.1.77", mcVersion: "1.21.1" });
  assert.deepEqual(mrpack.loaderFromDependencies({ minecraft: "1.21.1", "quilt-loader": "0.26.0" }), { loader: "quilt", loaderVersion: "0.26.0", mcVersion: "1.21.1" });
  assert.ok(mrpack.loaderFromDependencies({}).error);
});

/* ---------------- loaders ---------------- */

const loaders = require("../src/main/loaders");
const forge = require("../src/main/forge");

test("loaders: NeoForge versions map to the Minecraft version they target", () => {
  assert.equal(loaders.neoforgeMcVersion("20.4.237"), "1.20.4");
  assert.equal(loaders.neoforgeMcVersion("20.2.3-beta"), "1.20.2");
  assert.equal(loaders.neoforgeMcVersion("21.0.167"), "1.21");
  assert.equal(loaders.neoforgeMcVersion("21.1.77"), "1.21.1");
  assert.equal(loaders.neoforgeMcVersion("21.10.5-beta"), "1.21.10");
  assert.equal(loaders.neoforgeMcVersion("26.1.0.19-beta"), "26.1");
  assert.equal(loaders.neoforgeMcVersion("26.1.2.40"), "26.1.2");
  assert.equal(loaders.neoforgeMcVersion("26.2.0.88"), "26.2");
  assert.equal(loaders.neoforgeMcVersion("26.1.0.0-alpha.1+snapshot-1"), "26.1-snapshot-1");
  assert.equal(loaders.neoforgeMcVersion("26.1.0.0-alpha.15+pre-3"), "26.1-pre-3");
  assert.equal(loaders.neoforgeMcVersion("0.25w14craftmine.3-beta"), "25w14craftmine");
});

test("loaders: version ordering puts newest first and releases above their pre-releases", () => {
  const sorted = ["0.30.1-beta.4", "0.30.1", "0.29.2", "0.30.1-beta.10", "0.31.0-beta.1"].sort((a, b) => loaders.compareVersions(b, a));
  assert.deepEqual(sorted, ["0.31.0-beta.1", "0.30.1", "0.30.1-beta.10", "0.30.1-beta.4", "0.29.2"]);
  assert.ok(loaders.compareVersions("26.2.0.88", "26.2.0.9") > 0);
  assert.ok(loaders.isStableVersion("0.30.1"));
  assert.ok(!loaders.isStableVersion("26.3.0.16-beta"));
});

test("loaders: Forge maven versions resolve from a pack's short version", () => {
  const all = ["1.20.1-47.4.0", "1.20.1-47.4.10", "1.7.10-10.13.4.1614-1.7.10", "26.2-65.1.3"];
  assert.equal(loaders.matchForgeMavenVersion(all, "1.20.1", "47.4.0"), "1.20.1-47.4.0");
  assert.equal(loaders.matchForgeMavenVersion(all, "1.7.10", "10.13.4.1614"), "1.7.10-10.13.4.1614-1.7.10");
  assert.equal(loaders.matchForgeMavenVersion(all, "26.2", "26.2-65.1.3"), "26.2-65.1.3");
  assert.equal(loaders.matchForgeMavenVersion(all, "1.20.1", "99"), null);
  assert.equal(loaders.forgeShortVersion("1.20.1-47.4.0", "1.20.1"), "47.4.0");
  assert.equal(loaders.forgeMcVersion("1.7.10-10.13.4.1614-1.7.10"), "1.7.10");
  assert.ok(loaders.forgeHasInstaller("1.7.10"));
  assert.ok(loaders.forgeHasInstaller("26.2"));
  assert.ok(!loaders.forgeHasInstaller("1.5.2"));
  assert.ok(!loaders.forgeHasInstaller("1.1"));
});

test("forge: maven paths, library keys and legacy repo urls", () => {
  assert.equal(forge.mavenPath("net.minecraftforge:forge:1.20.1-47.4.0:client"), "net/minecraftforge/forge/1.20.1-47.4.0/forge-1.20.1-47.4.0-client.jar");
  assert.equal(
    forge.mavenPath("de.oceanlabs.mcp:mcp_config:1.20.1-20230612.114412:mappings@txt"),
    "de/oceanlabs/mcp/mcp_config/1.20.1-20230612.114412/mcp_config-1.20.1-20230612.114412-mappings.txt"
  );
  assert.equal(forge.mavenPath("de.oceanlabs.mcp:mcp_config:1.16.5-20210115.111550@zip"), "de/oceanlabs/mcp/mcp_config/1.16.5-20210115.111550/mcp_config-1.16.5-20210115.111550.zip");
  assert.throws(() => forge.mavenPath("nope"));
  assert.equal(forge.libraryKey("org.ow2.asm:asm:9.5"), forge.libraryKey("org.ow2.asm:asm:9.10.1"));
  assert.notEqual(forge.libraryKey("org.lwjgl:lwjgl:3.3.3"), forge.libraryKey("org.lwjgl:lwjgl:3.3.3:natives-windows"));
  assert.equal(forge.normaliseRepoUrl("http://files.minecraftforge.net/maven/"), "https://maven.minecraftforge.net/");
  assert.equal(forge.normaliseRepoUrl(undefined), "https://libraries.minecraft.net/");
});

test("forge: legacy install profiles become a normal version.json", () => {
  const v = forge.legacyVersionJson({
    install: { path: "net.minecraftforge:forge:1.7.10-10.13.4.1614-1.7.10", filePath: "forge-universal.jar" },
    versionInfo: {
      id: "1.7.10-Forge10.13.4.1614-1.7.10",
      inheritsFrom: "1.7.10",
      mainClass: "net.minecraft.launchwrapper.Launch",
      minecraftArguments: "--tweakClass cpw.mods.fml.common.launcher.FMLTweaker",
      libraries: [
        { name: "net.minecraftforge:forge:1.7.10-10.13.4.1614-1.7.10", url: "http://files.minecraftforge.net/maven/" },
        { name: "net.minecraft:launchwrapper:1.12" },
        { name: "jline:jline:2.13", url: "https://maven.minecraftforge.net/", clientreq: false, serverreq: true },
      ],
    },
  });
  assert.equal(v.mainClass, "net.minecraft.launchwrapper.Launch");
  assert.equal(v.libraries.length, 2, "server-only libraries are dropped");
  assert.equal(v.libraries[0].downloads.artifact.url, "", "Forge's own jar comes out of the installer");
  assert.equal(v.libraries[1].downloads.artifact.url, "https://libraries.minecraft.net/net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar");
});

test("forge: processor arguments and data values resolve for the client", () => {
  const libPath = (c) => "/lib/" + forge.mavenPath(c);
  const extracted = (p) => "/work" + p;
  assert.equal(forge.resolveDataValue("[net.minecraft:client:1.20.1:slim]", libPath, extracted), "/lib/net/minecraft/client/1.20.1/client-1.20.1-slim.jar");
  assert.equal(forge.resolveDataValue("'abc123'", libPath, extracted), "abc123");
  assert.equal(forge.resolveDataValue("/data/client.lzma", libPath, extracted), "/work/data/client.lzma");
  const vars = { SIDE: "client", ROOT: "/root", PATCHED: "/p.jar" };
  assert.equal(forge.substituteProcessorArg("{ROOT}/libraries/", vars, libPath), "/root/libraries/");
  assert.equal(forge.substituteProcessorArg("{PATCHED}", vars, libPath), "/p.jar");
  assert.equal(forge.substituteProcessorArg("{UNKNOWN}", vars, libPath), "{UNKNOWN}");
  assert.equal(forge.substituteProcessorArg("[a.b:c:1@zip]", vars, libPath), "/lib/a/b/c/1/c-1.zip");
  assert.ok(forge.runsOnClient({}));
  assert.ok(forge.runsOnClient({ sides: ["client"] }));
  assert.ok(!forge.runsOnClient({ sides: ["server"] }));
  assert.equal(forge.manifestMainClass("Manifest-Version: 1.0\r\nMain-Class: net.minecraftforge.binarypatcher.Con\r\n sole\r\n"), "net.minecraftforge.binarypatcher.Console");
});

test("minecraft: Forge profiles replace vanilla's copy of a library and keep legacy arguments", () => {
  const vanilla = {
    id: "1.12.2",
    minecraftArguments: "--username ${auth_player_name}",
    libraries: [{ name: "org.apache.logging.log4j:log4j-core:2.8.1" }, { name: "com.mojang:realms:1.10.22" }],
    assetIndex: {},
    assets: "1.12",
  };
  const loaderJson = {
    id: "1.12.2-forge-14.23.5.2860",
    mainClass: "net.minecraft.launchwrapper.Launch",
    minecraftArguments: "--username ${auth_player_name} --tweakClass net.minecraftforge.fml.common.launcher.FMLTweaker",
    libraries: [{ name: "org.apache.logging.log4j:log4j-core:2.15.0" }],
  };
  const merged = minecraft.mergeLoaderProfile(vanilla, loaderJson);
  assert.equal(merged.id, "1.12.2-forge-14.23.5.2860");
  assert.deepEqual(merged.libraries.map((l) => l.name), ["org.apache.logging.log4j:log4j-core:2.15.0", "com.mojang:realms:1.10.22"]);
  assert.match(merged.minecraftArguments, /FMLTweaker/);
  assert.equal(merged.arguments, null);

  const modern = minecraft.mergeLoaderProfile(
    { id: "26.2", arguments: { game: ["--version", "${version_name}"], jvm: ["-cp", "${classpath}"] }, libraries: [] },
    { id: "neoforge-26.2.0.88", mainClass: "net.neoforged.fml.startup.Client", arguments: { game: ["--fml.mcVersion", "26.2"], jvm: ["-DlibraryDirectory=${library_directory}"] }, libraries: [] }
  );
  assert.deepEqual(modern.arguments.game, ["--version", "${version_name}", "--fml.mcVersion", "26.2"]);
  assert.deepEqual(modern.arguments.jvm, ["-cp", "${classpath}", "-DlibraryDirectory=${library_directory}"]);
});

test("minecraft: libraries a processor produces aren't downloaded", () => {
  const libs = minecraft.collectLibraries({
    libraries: [{ name: "net.minecraftforge:forge:26.2-65.1.3:client", downloads: { artifact: { path: "net/minecraftforge/forge/26.2-65.1.3/forge-26.2-65.1.3-client.jar", url: "" } } }],
  });
  assert.equal(libs.length, 1);
  assert.equal(libs[0].generated, true);
});

test("minecraft: ReminthHUD builds match the Minecraft versions they declare", () => {
  const ok = minecraft.mcRangeAccepts;
  assert.ok(ok("~26.2", "26.2"));
  assert.ok(ok("~26.2", "26.2.1"));
  assert.ok(!ok("~26.2", "26.3"));
  assert.ok(ok(">=1.21 <1.22", "1.21.4"));
  assert.ok(!ok(">=1.21 <1.22", "1.20.6"));
  assert.ok(ok("1.21.x", "1.21.10"));
  assert.ok(ok(["1.20.1", "1.20.2"], "1.20.2"));
  assert.ok(ok("*", "1.8.9"));
  assert.ok(!ok("~26.2", "26.2-snapshot-3"));
  assert.ok(ok("26.2-snapshot-3", "26.2-snapshot-3"));
  assert.ok(minecraft.reminthHudSupports("26.2", [{ minecraft: "~26.2" }, { minecraft: "~1.21.1" }]));
  assert.ok(minecraft.reminthHudSupports("1.21.1", [{ minecraft: "~26.2" }, { minecraft: "~1.21.1" }]));
});

test("minecraft: loader hosts are on the download allow-list", () => {
  for (const u of [
    "https://maven.minecraftforge.net/net/minecraftforge/forge/x.jar",
    "https://maven.neoforged.net/releases/x.jar",
    "https://maven.quiltmc.org/repository/release/x.jar",
    "https://meta.quiltmc.org/v3/x",
  ]) assert.equal(minecraft.assertDownloadUrl(u), u);
  assert.throws(() => minecraft.assertDownloadUrl("https://evil-minecraftforge.net.example/x.jar"));
});

test("entitlements: RAM is capped by the machine, not a plan", () => {
  const ent = require("../src/main/entitlements");
  const GB = 1024 ** 3;
  assert.equal(ent.ramCapMb(4 * GB), 2048);
  assert.equal(ent.ramCapMb(8 * GB), 6144);
  assert.equal(ent.ramCapMb(16 * GB), 8192, "a big machine is still capped at 8GB");
  assert.equal(ent.ramCapMb(64 * GB), 8192, "no runaway heap on a workstation");
  assert.equal(ent.ramCapMb(2 * GB), 1024);
});

test("content: Forge mods.toml metadata", () => {
  const meta = content.parseModsToml('modLoader="javafml"\nlogoFile="logo.png"\n[[mods]]\nmodId="jei"\nversion="${file.jarVersion}"\ndisplayName="Just Enough Items"\ndescription=\'\'\'\nItem viewer\n\'\'\'\n[[dependencies.jei]]\nmodId="forge"');
  assert.equal(meta.id, "jei");
  assert.equal(meta.name, "Just Enough Items");
  assert.equal(meta.description, "Item viewer");
  assert.equal(meta.icon, "logo.png");
  assert.equal(content.manifestVersion("Implementation-Version: 19.21.0.2\r\n"), "19.21.0.2");
  assert.equal(content.parseModsToml("no mods here"), null);
});

/* ---------------- servers ---------------- */

test("serverPing: addresses parse with and without a port", () => {
  assert.deepEqual(serverPing.parseAddress("donutsmp.net"), { host: "donutsmp.net", port: 25565, explicitPort: false });
  assert.deepEqual(serverPing.parseAddress("play.x.net:25570"), { host: "play.x.net", port: 25570, explicitPort: true });
  assert.deepEqual(serverPing.parseAddress("[::1]:25565"), { host: "::1", port: 25565, explicitPort: true });
});

test("serverPing: varints decode", () => {
  assert.deepEqual(serverPing.readVarint(Buffer.from([0xac, 0x02]), 0), [300, 2]);
  assert.equal(serverPing.readVarint(Buffer.from([0x80]), 0), null); // incomplete
});

test("nbt: servers.dat round-trips through the writer", () => {
  const list = [{ name: "A", ip: "a.net", acceptTextures: 1, icon: "xx" }, { name: "B", ip: "b.net" }];
  assert.deepEqual(nbt.parse(nbt.writeServersDat(list)).servers, list);
  assert.deepEqual(nbt.parse(nbt.writeServersDat([])).servers, []);
});

/* ---------------- skins ---------------- */

function fakePng(w, h) {
  const b = Buffer.alloc(40);
  b.writeUInt32BE(0x89504e47, 0);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

test("skin: only 64x64 and 64x32 PNGs are accepted", () => {
  assert.equal(skin.validateSkinPng(fakePng(64, 64)), null);
  assert.equal(skin.validateSkinPng(fakePng(64, 32)), null);
  assert.match(skin.validateSkinPng(fakePng(128, 128)), /64×64/);
  assert.match(skin.validateSkinPng(Buffer.from("not a png")), /PNG/);
});

/* ---------------- settings ---------------- */

test("settings: -Xmx in extra JVM args is refused (the RAM slider owns memory)", () => {
  assert.throws(() => store.sanitizeSettings({ extraJvmArgs: "-Xmx8G" }, { strict: true }), /RAM slider/);
  assert.equal(store.sanitizeSettings({ extraJvmArgs: "-Xms4G -Dx=y" }).extraJvmArgs, undefined);
  assert.equal(store.sanitizeSettings({ extraJvmArgs: "-Dfoo=bar" }).extraJvmArgs, "-Dfoo=bar");
});

test("settings: streamer options are range-checked", () => {
  const s = store.sanitizeStreamer({ clipSeconds: 45, fps: 144, quality: "ultra", clipKey: "F10", screenshotKey: "rm -rf" });
  assert.equal(s.clipSeconds, 60);
  assert.equal(s.fps, 60);
  assert.equal(s.quality, "high");
  assert.equal(s.clipKey, "F10");
  assert.equal(s.screenshotKey, "F8");
  assert.equal(store.sanitizeStreamer({ clipSeconds: 1800, clipKey: "Control+Shift+F9" }).clipSeconds, 1800);
  assert.equal(store.sanitizeStreamer({ clipKey: "Control+Shift+F9" }).clipKey, "Control+Shift+F9");
  assert.equal(store.sanitizeSettings({ activeInstance: "../x" }).activeInstance, undefined);
});

/* ---------------- launching any version ---------------- */

test("minecraft: 32-bit and ARM native rules don't match this x64 PC", () => {
  assert.equal(minecraft.osMatchesThisMachine({ name: "windows", arch: "x86" }), false);
  assert.equal(minecraft.osMatchesThisMachine({ name: "windows", arch: "arm64" }), false);
  assert.equal(minecraft.osMatchesThisMachine({ name: "windows" }), true);
  assert.equal(minecraft.osMatchesThisMachine({ name: "osx" }), false);
});

test("minecraft: quick-play feature detection + feature-gated args", () => {
  const profile = { arguments: { game: ["--x", { rules: [{ action: "allow", features: { is_quick_play_multiplayer: true } }], value: ["--quickPlayMultiplayer", "${quickPlayMultiplayer}"] }] } };
  assert.equal(minecraft.hasFeature(profile, "is_quick_play_multiplayer"), true);
  assert.equal(minecraft.hasFeature({ minecraftArguments: "a b" }, "is_quick_play_multiplayer"), false);
  const sub = (s) => s.replace("${quickPlayMultiplayer}", "a.net");
  assert.deepEqual(minecraft.resolveArguments(profile.arguments.game, sub, { is_quick_play_multiplayer: true }), ["--x", "--quickPlayMultiplayer", "a.net"]);
  assert.deepEqual(minecraft.resolveArguments(profile.arguments.game, sub), ["--x"]);
});

test("minecraft: ReminthHUD only goes into 26.2.x", () => {
  assert.equal(minecraft.reminthHudSupports("26.2"), true);
  assert.equal(minecraft.reminthHudSupports("26.2.1"), true);
  assert.equal(minecraft.reminthHudSupports("26.3"), false);
  assert.equal(minecraft.reminthHudSupports("1.8.9"), false);
});

test("minecraft: a legacy version keeps its minecraftArguments", () => {
  const p = minecraft.vanillaProfile({ id: "1.8.9", mainClass: "net.minecraft.client.main.Main", minecraftArguments: "--username ${auth_player_name}", libraries: [], assets: "1.8" });
  assert.equal(p.arguments, null);
  assert.equal(p.minecraftArguments, "--username ${auth_player_name}");
});

test("java: the right runtime component per version", () => {
  assert.equal(java.componentFor({ component: "java-runtime-epsilon", majorVersion: 25 }), "java-runtime-epsilon");
  assert.equal(java.componentFor(undefined), "jre-legacy");
  assert.equal(java.componentFor({ component: "../evil" }), "jre-legacy");
  assert.equal(java.majorFor({ majorVersion: 21 }), 21);
  assert.equal(java.majorFor(null), 8);
});

/* ---------------- Modrinth search ---------------- */

test("modrinth: facets only carry plain tokens; categories are AND'd", () => {
  const f = modrinth.buildFacets({ projectType: "mod", loaders: ["fabric"], gameVersions: ["1.21.1", 'x"]]'], categories: ["magic", "quests"], environment: "client", openSource: true });
  assert.deepEqual(f, [
    ["project_type:mod"],
    ["categories:fabric"],
    ["versions:1.21.1"],
    ["categories:magic"],
    ["categories:quests"],
    ["client_side:required", "client_side:optional"],
    ["open_source:true"],
  ]);
});

/* ---------------- WebM ---------------- */

test("webm: EBML size encoding round-trips, including fixed-length placeholders", () => {
  for (const n of [0, 1, 126, 127, 16382, 16383, 2 ** 20, 2 ** 40]) {
    const enc = webm.sizeBytes(n);
    assert.equal(webm.readSize(enc, 0).size, n, String(n));
    const fixed = webm.sizeBytes(n, 8);
    assert.equal(fixed.length, 8);
    assert.equal(webm.readSize(fixed, 0).size, n);
  }
  assert.equal(webm.readSize(Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), 0).size, -1); // unknown size
});
