"use strict";
/**
 * Tests for the third round of launch fixes: taking over the jars an older
 * Reminth installed, never deleting a jar because of its name, remembering
 * downloads that turned out pointless, asking GitHub less, and a handful of
 * smaller ones (legacy resources, leftover .part files, servers.dat, Fabric's
 * trailing-dash version ranges, two instances installing Java at once).
 *
 * No network (global fetch is stubbed per test and restored), no Electron,
 * no npm packages. Everything on disk happens under a throwaway HOME.
 * Run with: node --test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");
const crypto = require("crypto");

// paths.js hangs everything off os.homedir() - point that at a temp folder
// BEFORE anything requires it, so no test can touch a real Reminth install.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "reminth-fixes3-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

// electron and extract-zip aren't installed where the tests run - stub them.
// The extract-zip stub does whatever the current test tells it to.
let extractImpl = async () => {};
const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return "STUB_ELECTRON_FIXES3";
  if (request === "extract-zip") return "STUB_EXTRACT_ZIP_FIXES3";
  return originalResolve.call(this, request, ...rest);
};
Module._cache.STUB_ELECTRON_FIXES3 = {
  id: "STUB_ELECTRON_FIXES3",
  filename: "STUB_ELECTRON_FIXES3",
  loaded: true,
  exports: { safeStorage: { isEncryptionAvailable: () => false } },
};
Module._cache.STUB_EXTRACT_ZIP_FIXES3 = {
  id: "STUB_EXTRACT_ZIP_FIXES3",
  filename: "STUB_EXTRACT_ZIP_FIXES3",
  loaded: true,
  exports: (zipPath, options) => extractImpl(zipPath, options),
};

const paths = require("../src/main/paths");
const config = require("../src/main/config");
const downloader = require("../src/main/downloader");
const minecraft = require("../src/main/minecraft");
const java = require("../src/main/java");
const gameData = require("../src/main/gameData");
const nbt = require("../src/main/nbt");
const zip = require("../src/main/zip");

const sha1 = (buf) => crypto.createHash("sha1").update(buf).digest("hex");
const tmpDir = (name) => fsp.mkdtemp(path.join(HOME, `${name}-`));
const exists = (p) => fsp.access(p).then(() => true, () => false);
const minutesAgo = (n) => new Date(Date.now() - n * 60 * 1000);

/** Replaces global fetch for the duration of `fn`, always restoring it. */
async function withFetch(stub, fn) {
  const real = global.fetch;
  global.fetch = stub;
  try {
    return await fn();
  } finally {
    global.fetch = real;
  }
}
const offline = async () => {
  throw new TypeError("fetch failed");
};

/** The bytes of a Fabric mod jar whose fabric.mod.json is `meta`. */
async function jarBytes(meta) {
  const src = await tmpDir("jarsrc");
  await fsp.writeFile(path.join(src, "fabric.mod.json"), JSON.stringify({ schemaVersion: 1, ...meta }));
  const out = path.join(await tmpDir("jarout"), "out.jar");
  await zip.buildZip(src, out);
  return fsp.readFile(out);
}

/**
 * An instance folder with real jars in mods/: { "<file>": fabric.mod.json fields }.
 * `managed` (an object) writes a manifest; leave it out for an instance from
 * before the manifest existed. `tracked` lists what content.json says the
 * player installed through the mod browser.
 */
async function instanceWith(jars, { managed = null, tracked = null } = {}) {
  const gameDir = await tmpDir("game");
  const modsDir = path.join(gameDir, "mods");
  await fsp.mkdir(modsDir);
  for (const [file, meta] of Object.entries(jars)) await fsp.writeFile(path.join(modsDir, file), await jarBytes(meta));
  await fsp.mkdir(path.join(gameDir, ".reminth"));
  const manifestFile = path.join(gameDir, ".reminth", "managed-mods.json");
  const contentFile = path.join(gameDir, ".reminth", "content.json");
  if (managed) await fsp.writeFile(manifestFile, JSON.stringify({ version: 1, files: managed }));
  if (tracked) {
    const files = {};
    for (const f of tracked) files[`mods/${f}`] = { kind: "mod" };
    await fsp.writeFile(contentFile, JSON.stringify({ version: 1, files }));
  }
  return {
    gameDir,
    modsDir,
    manifestFile,
    contentFile,
    list: async () => (await fsp.readdir(modsDir)).sort(),
    manifest: async () => JSON.parse(await fsp.readFile(manifestFile, "utf8")),
    log: () => fsp.readFile(path.join(gameDir, "reminth-performance-mods.log"), "utf8"),
  };
}

const PERF = config.PERFORMANCE_MODS;
const perfKey = (m) => String(m.label || m.repo).toLowerCase();
const assetName = (m, mcVersion, modVersion = "1.0.0") => `${m.repo.toLowerCase()}-fabric-${modVersion}+mc${mcVersion}.jar`;

/**
 * A fetch that plays GitHub: every repo has one release for `mcVersion`
 * with one jar. `jarFor(repo)` gives that jar's bytes; `modVersion` (may be
 * changed between runs through the returned object) is the build on offer.
 */
function github(mcVersion, jarFor) {
  const state = { api: [], downloads: [], modVersion: "1.0.0" };
  state.fetch = async (url) => {
    url = String(url);
    const api = url.match(/^https:\/\/api\.github\.com\/repos\/[^/]+\/([^/]+)\/releases/);
    if (api) {
      state.api.push(api[1].toLowerCase());
      const name = `${api[1].toLowerCase()}-fabric-${state.modVersion}+mc${mcVersion}.jar`;
      return new Response(
        JSON.stringify([{ tag_name: `mc${mcVersion}-${state.modVersion}`, name: "", body: "", assets: [{ name, size: 1000, browser_download_url: `https://github.com/dl/${name}` }] }]),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    const dl = url.match(/^https:\/\/github\.com\/dl\/(([^-]+)-.+)$/);
    if (dl) {
      state.downloads.push(dl[1]);
      return new Response(await jarFor(dl[2]), { status: 200 });
    }
    return new Response("nope", { status: 404 });
  };
  return state;
}

const githubCacheDir = path.join(paths.ROOT, "cache", "github-releases");
/** Makes every remembered GitHub answer `hours` old. */
async function ageGithubCache(hours) {
  for (const name of await fsp.readdir(githubCacheDir).catch(() => [])) {
    const file = path.join(githubCacheDir, name);
    const json = JSON.parse(await fsp.readFile(file, "utf8"));
    json.at = Date.now() - hours * 60 * 60 * 1000;
    await fsp.writeFile(file, JSON.stringify(json));
  }
}

/* ---------------- 1. taking over an older Reminth's jars ---------------- */

const OLD_JARS = {
  "fabric-api-0.99.0+1.21.1.jar": { id: "fabric-api", version: "0.99.0+1.21.1" },
  "sodium-fabric-0.5.0+mc1.21.1.jar": { id: "sodium", version: "0.5.0" },
  "lithium-fabric-0.13.0+mc1.21.1.jar": { id: "lithium", version: "0.13.0" },
  "wxhud-1.0.jar": { id: "wxhud", version: "1.0" },
  // a mod an older Reminth installed and this one doesn't: taken over too, so the tidy can remove it
  "c2me-fabric-mc1.21.1-0.3.jar": { id: "c2me", version: "0.3" },
  // never taken over: other mods
  "sodium-extra-0.6.0.jar": { id: "sodium-extra", version: "0.6.0" },
  "jei-1.0.jar": { id: "jei", version: "1.0" },
};
const OLD_REMINTH = ["c2me-fabric-mc1.21.1-0.3.jar", "fabric-api-0.99.0+1.21.1.jar", "lithium-fabric-0.13.0+mc1.21.1.jar", "sodium-fabric-0.5.0+mc1.21.1.jar", "wxhud-1.0.jar"];

test("adoption: an instance from before the manifest gets its old Reminth jars written down, so they are updated again", async () => {
  const inst = await instanceWith(OLD_JARS);
  await fsp.writeFile(path.join(inst.modsDir, "sodium-fabric-0.4.0.jar.disabled"), "off"); // switched off: not a jar that loads

  // The bug: with no record, Reminth's own old jars count as the player's copies.
  const before = await minecraft.findPlayerCopies(inst.gameDir, "1.21.1");
  assert.deepEqual([...before.keys()].sort(), ["fabric-api", "lithium", "sodium"]);

  const adopted = await minecraft.adoptLegacyManagedMods(inst.gameDir, { usedBefore: true });
  assert.deepEqual(adopted.sort(), OLD_REMINTH);
  assert.deepEqual((await inst.manifest()).files, {
    "c2me-fabric-mc1.21.1-0.3.jar": { mod: "c2me" },
    "fabric-api-0.99.0+1.21.1.jar": { mod: "fabric-api" },
    "lithium-fabric-0.13.0+mc1.21.1.jar": { mod: "lithium" },
    "sodium-fabric-0.5.0+mc1.21.1.jar": { mod: "sodium" },
    "wxhud-1.0.jar": { mod: "reminthhud" },
  });
  assert.equal((await minecraft.findPlayerCopies(inst.gameDir, "1.21.1")).size, 0, "nothing is 'your own copy' any more");

  // ...so the next install replaces them like any jar Reminth put there.
  await fsp.writeFile(path.join(inst.modsDir, "sodium-fabric-0.6.5+mc1.21.1.jar"), "new");
  await fsp.writeFile(path.join(inst.modsDir, "fabric-api-0.110.0+1.21.1.jar"), "new");
  const removed = await minecraft.tidyManagedMods(inst.modsDir, [
    { file: "sodium-fabric-0.6.5+mc1.21.1.jar", mod: "sodium", own: true },
    { file: "fabric-api-0.110.0+1.21.1.jar", mod: "fabric-api", own: true },
  ]);
  // (c2me goes as well: Reminth stopped installing it, so nothing would ever update that copy)
  assert.deepEqual(removed.sort(), ["c2me-fabric-mc1.21.1-0.3.jar", "fabric-api-0.99.0+1.21.1.jar", "sodium-fabric-0.5.0+mc1.21.1.jar"]);
  const left = await inst.list();
  for (const kept of ["lithium-fabric-0.13.0+mc1.21.1.jar", "sodium-extra-0.6.0.jar", "jei-1.0.jar", "sodium-fabric-0.4.0.jar.disabled"]) {
    assert.ok(left.includes(kept), `${kept} stays`);
  }
});

test("adoption: a jar the player installed through the mod browser is not taken over", async () => {
  const inst = await instanceWith(OLD_JARS, { tracked: ["Sodium-Fabric-0.5.0+mc1.21.1.jar"] }); // any case
  const adopted = await minecraft.adoptLegacyManagedMods(inst.gameDir, { usedBefore: true });
  assert.deepEqual(adopted.sort(), OLD_REMINTH.filter((f) => !f.startsWith("sodium")));
  assert.ok(!("sodium-fabric-0.5.0+mc1.21.1.jar" in (await inst.manifest()).files));
  assert.deepEqual([...(await minecraft.findPlayerCopies(inst.gameDir, "1.21.1")).keys()], ["sodium"]);
});

test("adoption: an unreadable content.json means nothing is taken over - and it is tried again once it can be read", async () => {
  const inst = await instanceWith(OLD_JARS);
  await fsp.writeFile(inst.contentFile, "{ not json");
  assert.deepEqual(await minecraft.adoptLegacyManagedMods(inst.gameDir, { usedBefore: true }), []);
  assert.equal(await exists(inst.manifestFile), false, "nothing written, so it isn't 'done'");
  await fsp.writeFile(inst.contentFile, JSON.stringify({ version: 1, files: {} }));
  assert.deepEqual((await minecraft.adoptLegacyManagedMods(inst.gameDir, { usedBefore: true })).sort(), OLD_REMINTH);
});

test("adoption: runs once - a jar that shows up later is the player's, whatever it's called", async () => {
  const inst = await instanceWith(OLD_JARS);
  await minecraft.adoptLegacyManagedMods(inst.gameDir, { usedBefore: true });
  const first = await fsp.readFile(inst.manifestFile, "utf8");
  await fsp.writeFile(path.join(inst.modsDir, "scalablelux-fabric-0.1.0.jar"), await jarBytes({ id: "scalablelux", version: "0.1.0" }));
  assert.deepEqual(await minecraft.adoptLegacyManagedMods(inst.gameDir, { usedBefore: true }), []);
  assert.equal(await fsp.readFile(inst.manifestFile, "utf8"), first);

  // An instance with nothing to take over still gets its (empty) manifest, for the same reason.
  const empty = await instanceWith({ "jei-1.0.jar": { id: "jei", version: "1.0" } });
  assert.deepEqual(await minecraft.adoptLegacyManagedMods(empty.gameDir, { usedBefore: true }), []);
  assert.deepEqual(await empty.manifest(), { version: 1, files: {} });
  await fsp.writeFile(path.join(empty.modsDir, "sodium-fabric-0.5.0.jar"), "later");
  assert.deepEqual(await minecraft.adoptLegacyManagedMods(empty.gameDir, { usedBefore: true }), []);
});

test("adoption: a brand-new instance's jars are not an older Reminth's; with the pack off its mods aren't taken over", async () => {
  // Never installed or played by Reminth (a modpack that was just imported).
  const fresh = await instanceWith(OLD_JARS);
  assert.deepEqual(await minecraft.adoptLegacyManagedMods(fresh.gameDir, { usedBefore: false }), []);
  assert.deepEqual(await fresh.manifest(), { version: 1, files: {} });

  // The log Reminth writes when it installs the performance pack is proof enough.
  const logged = await instanceWith(OLD_JARS);
  await fsp.writeFile(path.join(logged.gameDir, "reminth-performance-mods.log"), "=== performance mods install ===\n");
  assert.deepEqual((await minecraft.adoptLegacyManagedMods(logged.gameDir)).sort(), OLD_REMINTH);

  // Performance pack switched off: taking Sodium over would get it deleted as "switched off".
  const off = await instanceWith(OLD_JARS);
  assert.deepEqual((await minecraft.adoptLegacyManagedMods(off.gameDir, { perf: false, usedBefore: true })).sort(), ["fabric-api-0.99.0+1.21.1.jar", "wxhud-1.0.jar"]);
  await minecraft.tidyManagedMods(off.modsDir, [], { dropHud: true, dropPerf: true });
  const left = await off.list();
  assert.ok(left.includes("sodium-fabric-0.5.0+mc1.21.1.jar") && left.includes("lithium-fabric-0.13.0+mc1.21.1.jar"));
  assert.ok(left.includes("c2me-fabric-mc1.21.1-0.3.jar"), "nor is a retired mod's jar, with the pack off");
  assert.ok(!left.includes("wxhud-1.0.jar"), "the HUD is Reminth's own mod: switched off, it goes");
});

/* ---------------- 2. no jar is deleted because of its name ---------------- */

test("tidyManagedMods: the player's hand-placed jar survives Reminth installing that same mod", async () => {
  const inst = await instanceWith(
    {
      "sodium-fabric-0.5.0+mc1.20.1.jar": { id: "sodium", version: "0.5.0", depends: { minecraft: "1.20.1" } }, // theirs, wrong version
      "sodium-fabric-0.6.5+mc1.21.1.jar": { id: "sodium", version: "0.6.5" },
      "fabric-api-0.50.0+1.20.1.jar": { id: "fabric-api", version: "0.50.0" },
      "fabric-api-0.110.0+1.21.1.jar": { id: "fabric-api", version: "0.110.0" },
      "reminthhud-0.9.jar": { id: "reminthhud", version: "0.9" },
    },
    { managed: {} }
  );
  const installed = [
    { file: "sodium-fabric-0.6.5+mc1.21.1.jar", mod: "sodium", own: true },
    { file: "fabric-api-0.110.0+1.21.1.jar", mod: "fabric-api", own: true },
  ];
  assert.deepEqual(await minecraft.tidyManagedMods(inst.modsDir, installed, { dropHud: true }), []);
  assert.equal((await inst.list()).length, 5);
  assert.deepEqual(Object.keys((await inst.manifest()).files).sort(), ["fabric-api-0.110.0+1.21.1.jar", "sodium-fabric-0.6.5+mc1.21.1.jar"]);
});

/* ---------------- 3. pointless downloads are remembered ---------------- */

test("skipped: a build that stepped aside is not downloaded again until what it clashed with is gone", async () => {
  const MC = "1.21.3";
  const [first, ...rest] = PERF;
  const firstAsset = assetName(first, MC);
  // An older manifest: no `skipped` in it at all.
  const inst = await instanceWith({ "nope.jar": { id: "nope", version: "1.0.0", breaks: { [first.repo.toLowerCase()]: "*" } } }, { managed: {} });
  const gh = github(MC, (repo) => jarBytes({ id: repo, version: "1.0.0" }));
  const run = async () => {
    const detail = [];
    await withFetch(gh.fetch, () => minecraft.downloadPerformanceMods(inst.modsDir, MC, null, detail, { loader: "fabric" }));
    const installed = detail.map((d) => ({ ...d, own: true }));
    const aside = await minecraft.stepAsideForPlayerMods(inst.gameDir, installed, { mcVersion: MC });
    await minecraft.tidyManagedMods(inst.modsDir, installed);
    return aside;
  };

  // Launch 1: downloaded, then taken back out because nope.jar breaks it.
  const one = await run();
  assert.deepEqual(one.removed, [firstAsset]);
  assert.equal(gh.downloads.length, PERF.length);
  const noted = (await inst.manifest()).skipped;
  assert.deepEqual(Object.keys(noted), [perfKey(first)]);
  const blockerSize = (await fsp.stat(path.join(inst.modsDir, "nope.jar"))).size;
  assert.deepEqual({ ...noted[perfKey(first)], at: null }, { asset: firstAsset, reason: "broken-by", because: [{ file: "nope.jar", size: blockerSize }], at: null });
  assert.ok(!Number.isNaN(Date.parse(noted[perfKey(first)].at)));

  // Launch 2: the same build is still on offer and nope.jar is still there - no download.
  gh.downloads.length = 0;
  const two = await run();
  assert.deepEqual(two.removed, []);
  assert.deepEqual(gh.downloads, [], "nothing fetched: the others are installed, this one is known not to fit");
  assert.ok(!(await inst.list()).includes(firstAsset));
  assert.match(await inst.log(), new RegExp(`Left ${first.label} out again without downloading it: .* still can't run next to nope\\.jar`));
  assert.deepEqual(Object.keys((await inst.manifest()).skipped), [perfKey(first)]);
  assert.deepEqual(Object.keys((await inst.manifest()).files).sort(), rest.map((m) => assetName(m, MC)).sort());

  // Launch 3: the player removed nope.jar - tried again, installed, and forgotten.
  await fsp.rm(path.join(inst.modsDir, "nope.jar"));
  const three = await run();
  assert.deepEqual(three.removed, []);
  assert.deepEqual(gh.downloads, [firstAsset]);
  assert.ok((await inst.list()).includes(firstAsset));
  assert.equal("skipped" in (await inst.manifest()), false);
});

test("skipped: a blocker that was swapped for another file of the same name counts as gone", async () => {
  const MC = "1.21.3"; // GitHub's answers are still remembered from the test above
  const [first] = PERF;
  const inst = await instanceWith({ "nope.jar": { id: "harmless", version: "2.0.0" } }, { managed: {} });
  await fsp.writeFile(
    inst.manifestFile,
    JSON.stringify({ version: 1, files: {}, skipped: { [perfKey(first)]: { asset: assetName(first, MC), reason: "broken-by", because: [{ file: "nope.jar", size: 1 }], at: "2026-01-01T00:00:00.000Z" } } })
  );
  const gh = github(MC, (repo) => jarBytes({ id: repo, version: "1.0.0" }));
  const installed = await withFetch(gh.fetch, () => minecraft.downloadPerformanceMods(inst.modsDir, MC, null, null, { loader: "fabric" }));
  assert.ok(installed.includes(assetName(first, MC)));
  assert.deepEqual(gh.api, [], "and GitHub's API wasn't asked again either");
  assert.equal("skipped" in (await inst.manifest()), false);
});

test("skipped: a jar that isn't for this Minecraft version is fetched once, not on every launch, until GitHub offers another build", async () => {
  const MC = "1.21.4";
  const [bad, ...good] = PERF;
  const inst = await instanceWith({});
  const gh = github(MC, (repo) => jarBytes({ id: repo, version: "1.0.0", depends: { minecraft: repo === bad.repo.toLowerCase() && gh.modVersion === "1.0.0" ? "1.20.1" : ">=1.21" } }));
  const run = () => withFetch(gh.fetch, () => minecraft.downloadPerformanceMods(inst.modsDir, MC, null, null, { loader: "fabric" }));

  assert.deepEqual((await run()).sort(), good.map((m) => assetName(m, MC)).sort());
  assert.equal(gh.downloads.length, PERF.length);
  assert.deepEqual({ ...(await inst.manifest()).skipped[perfKey(bad)], at: null }, { asset: assetName(bad, MC), reason: "not-for-version", because: null, at: null });

  gh.downloads.length = 0;
  gh.api.length = 0;
  assert.deepEqual((await run()).sort(), good.map((m) => assetName(m, MC)).sort());
  assert.deepEqual(gh.downloads, []);
  assert.deepEqual(gh.api, []);
  assert.match(await inst.log(), new RegExp(`Skipped ${bad.label} again without downloading it: .* is not for 1\\.21\\.4`));

  // A new release appears (and the remembered answers have gone stale).
  gh.modVersion = "1.0.1";
  await ageGithubCache(7);
  const after = await run();
  assert.ok(after.includes(assetName(bad, MC, "1.0.1")));
  assert.equal("skipped" in (await inst.manifest()), false);
});

/* ---------------- 3b. asking GitHub less ---------------- */

test("github: an answer is reused for six hours, and used however old it is when GitHub can't be reached", async () => {
  let calls = 0;
  let tag = "1.0.0";
  const ok = async () => {
    calls++;
    const name = `thing-fabric-${tag}+mc1.19.2.jar`;
    return new Response(JSON.stringify([{ tag_name: `mc1.19.2-${tag}`, assets: [{ name, size: 10, browser_download_url: `https://github.com/dl/${name}` }] }]), { status: 200 });
  };
  const limited = async () => {
    calls++;
    return new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } });
  };
  const ask = (stub) => withFetch(stub, () => minecraft.fetchLatestGithubAssetForVersion("Some", "Thing", "1.19.2"));

  // Nothing remembered: a failure is still a failure.
  await assert.rejects(ask(offline), /fetch failed/);
  await assert.rejects(ask(limited), /rate limit/);
  calls = 0;

  const first = await ask(ok);
  assert.deepEqual(first, { version: "mc1.19.2-1.0.0", url: "https://github.com/dl/thing-fabric-1.0.0+mc1.19.2.jar", filename: "thing-fabric-1.0.0+mc1.19.2.jar" });
  assert.equal(calls, 1);
  assert.deepEqual(await fsp.readdir(githubCacheDir).then((l) => l.filter((f) => f.startsWith("Some-Thing-"))), ["Some-Thing-1.19.2.json"]);

  // Inside six hours: no request at all, online or not.
  tag = "1.0.1";
  assert.deepEqual(await ask(ok), { ...first, cached: true });
  assert.deepEqual(await ask(offline), { ...first, cached: true });
  assert.equal(calls, 1);
  // Another Minecraft version is its own answer.
  await assert.rejects(withFetch(offline, () => minecraft.fetchLatestGithubAssetForVersion("Some", "Thing", "1.19.3")), /fetch failed/);

  // Stale and unreachable / rate-limited / erroring: the old answer still serves.
  await ageGithubCache(7);
  assert.deepEqual(await ask(offline), { ...first, cached: true });
  assert.deepEqual(await ask(limited), { ...first, cached: true });
  assert.deepEqual(await ask(async () => new Response("oops", { status: 500 })), { ...first, cached: true });
  // Stale and reachable: asked again, and the new answer replaces the old.
  calls = 0;
  assert.equal((await ask(ok)).filename, "thing-fabric-1.0.1+mc1.19.2.jar");
  assert.equal(calls, 1);
  assert.equal((await ask(offline)).filename, "thing-fabric-1.0.1+mc1.19.2.jar");
});

test("github: 'no build yet' is remembered for an hour; an error page is not remembered at all", async () => {
  let calls = 0;
  const none = async () => {
    calls++;
    return new Response(JSON.stringify([{ tag_name: "mc1.18.2-1.0.0", assets: [] }]), { status: 200 });
  };
  const ask = (stub) => withFetch(stub, () => minecraft.fetchLatestGithubAssetForVersion("No", "Build", "1.19.2"));
  // (and it is an error, not "no build yet")
  await assert.rejects(ask(async () => new Response("oops", { status: 500 })), /GitHub answered 500/);
  assert.equal(await exists(path.join(githubCacheDir, "No-Build-1.19.2.json")), false);
  assert.equal(await ask(none), null);
  assert.equal(await ask(none), null);
  assert.equal(calls, 1);
  await ageGithubCache(2);
  assert.equal(await ask(none), null);
  assert.equal(calls, 2);
  // A damaged cache file is just "nothing remembered".
  await fsp.writeFile(path.join(githubCacheDir, "No-Build-1.19.2.json"), JSON.stringify({ at: Date.now(), found: { version: "x", url: "https://x/y.jar", filename: "../../evil.jar" } }));
  assert.equal(await ask(none), null);
  assert.equal(calls, 3);
});

test("github: an installed performance pack starts with no network at all", async () => {
  const MC = "1.21.5";
  const inst = await instanceWith({});
  const gh = github(MC, (repo) => jarBytes({ id: repo, version: "1.0.0" }));
  const names = PERF.map((m) => assetName(m, MC)).sort();
  assert.deepEqual((await withFetch(gh.fetch, () => minecraft.downloadPerformanceMods(inst.modsDir, MC, null, null, { loader: "fabric" }))).sort(), names);
  assert.deepEqual((await withFetch(offline, () => minecraft.downloadPerformanceMods(inst.modsDir, MC, null, null, { loader: "fabric" }))).sort(), names);
  await ageGithubCache(48);
  assert.deepEqual((await withFetch(offline, () => minecraft.downloadPerformanceMods(inst.modsDir, MC, null, null, { loader: "fabric" }))).sort(), names);
  assert.doesNotMatch(await inst.log(), /failed to install/);
});

/* ---------------- 4. legacy resources ---------------- */

test("downloadAssets: pre-1.6 resources are copied when missing or empty, never over a file the player replaced", async () => {
  const sound = Buffer.from("the original sound");
  const music = Buffer.from("the original music");
  const index = Buffer.from(
    JSON.stringify({ map_to_resources: true, objects: { "sound/a.ogg": { hash: sha1(sound), size: sound.length }, "music/b.ogg": { hash: sha1(music), size: music.length } } })
  );
  const profile = { assets: "fixes3-legacy", assetIndex: { url: "https://piston-meta.mojang.com/legacy.json", sha1: sha1(index) } };
  const gameDir = await tmpDir("legacy");
  const serve = async (url) => {
    if (String(url).endsWith("legacy.json")) return new Response(index);
    return new Response(String(url).endsWith(sha1(sound)) ? sound : music);
  };
  const result = await withFetch(serve, () => minecraft.downloadAssets(profile, gameDir, () => {}));
  const a = path.join(gameDir, "resources", "sound", "a.ogg");
  const b = path.join(gameDir, "resources", "music", "b.ogg");
  assert.equal(result.gameAssetsDir, path.join(gameDir, "resources"));
  assert.deepEqual(await fsp.readFile(a), sound);

  // The player swaps a sound (a different size) and one copy was cut to nothing.
  await fsp.writeFile(a, "my own, much longer, replacement sound");
  await fsp.writeFile(b, "");
  await withFetch(offline, () => minecraft.downloadAssets(profile, gameDir, () => {}));
  assert.equal(await fsp.readFile(a, "utf8"), "my own, much longer, replacement sound");
  assert.deepEqual(await fsp.readFile(b), music);
  await fsp.rm(b);
  await withFetch(offline, () => minecraft.downloadAssets(profile, gameDir, () => {}));
  assert.deepEqual(await fsp.readFile(b), music);

  // "virtual" assets are Reminth's own shared copy: a wrong size there is still repaired.
  const vIndex = Buffer.from(JSON.stringify({ virtual: true, objects: { "sound/a.ogg": { hash: sha1(sound), size: sound.length } } }));
  const vProfile = { assets: "fixes3-virtual", assetIndex: { url: "https://piston-meta.mojang.com/virtual.json", sha1: sha1(vIndex) } };
  const vServe = async (url) => new Response(String(url).endsWith("virtual.json") ? vIndex : sound);
  await withFetch(vServe, () => minecraft.downloadAssets(vProfile, gameDir, () => {}));
  const v = path.join(paths.ASSETS_DIR, "virtual", "fixes3-virtual", "sound", "a.ogg");
  await fsp.writeFile(v, "cut sh");
  await withFetch(offline, () => minecraft.downloadAssets(vProfile, gameDir, () => {}));
  assert.deepEqual(await fsp.readFile(v), sound);
});

/* ---------------- 5. leftover .part / .tmp files ---------------- */

test("downloader: .part and .tmp files left by a killed launcher are swept, recent and unrelated ones are not", async () => {
  const dir = await tmpDir("sweep");
  const dest = path.join(dir, "a.jar");
  const make = async (name, ageMinutes) => {
    await fsp.writeFile(path.join(dir, name), "half");
    await fsp.utimes(path.join(dir, name), minutesAgo(ageMinutes), minutesAgo(ageMinutes));
  };
  await make("a.jar.0123456789ab.part", 11); // dead: swept
  await make("a.jar.aaaaaaaaaaaa.part", 2); // could be a download running right now
  await make("b.jar.0123456789ab.part", 11); // another file's
  await make("a.jar.notes.part", 11); // not one of ours
  await make("a.jar.deadbeef.tmp", 11); // a .tmp is writeFileAtomic's to sweep
  await fsp.mkdir(path.join(dir, "a.jar.ffffffffffff.part")); // a folder, of all things
  await fsp.utimes(path.join(dir, "a.jar.ffffffffffff.part"), minutesAgo(30), minutesAgo(30));

  await withFetch(async () => new Response("jar"), () => downloader.downloadFile("https://example.com/a.jar", dest, null));
  assert.deepEqual((await fsp.readdir(dir)).sort(), ["a.jar", "a.jar.aaaaaaaaaaaa.part", "a.jar.deadbeef.tmp", "a.jar.ffffffffffff.part", "a.jar.notes.part", "b.jar.0123456789ab.part"]);

  await make("state.json.deadbeef.tmp", 11);
  await make("state.json.cafebabe.tmp", 1);
  await downloader.writeFileAtomic(path.join(dir, "state.json"), "{}");
  const after = await fsp.readdir(dir);
  assert.ok(!after.includes("state.json.deadbeef.tmp"));
  assert.ok(after.includes("state.json.cafebabe.tmp") && after.includes("state.json"));

  // Never throws: a folder that isn't there, a file where a folder should be.
  await downloader.sweepLeftovers(path.join(dir, "missing", "x.jar"), "part");
  await downloader.sweepLeftovers(path.join(dest, "x.jar"), "part");
});

/* ---------------- 6 + 7. servers.dat ---------------- */

test("addServer: an empty servers.dat is 'no list yet', not an unreadable one", async () => {
  const gameDir = await tmpDir("servers");
  const file = path.join(gameDir, "servers.dat");
  await fsp.writeFile(file, "");
  assert.deepEqual(await gameData.addServer(gameDir, { name: "One", address: "one.example.com" }), { added: true });
  assert.deepEqual(nbt.parse(await fsp.readFile(file)).servers.map((s) => s.ip), ["one.example.com"]);
  assert.deepEqual(await fsp.readdir(gameDir), ["servers.dat"]); // an empty file isn't worth a .bak
  // Real junk is still refused.
  await fsp.writeFile(file, Buffer.from([10, 0, 0, 9]));
  await assert.rejects(gameData.addServer(gameDir, { name: "Two", address: "two.example.com" }), /wasn't changed/);
});

test("addServer: a backup that can't be made doesn't stop the server being added", async () => {
  const gameDir = await tmpDir("servers");
  const file = path.join(gameDir, "servers.dat");
  await gameData.addServer(gameDir, { name: "One", address: "one.example.com" });
  await fsp.mkdir(file + ".bak"); // copyFile onto a folder fails
  const warned = [];
  const realWarn = console.warn;
  console.warn = (...args) => warned.push(args.join(" "));
  try {
    assert.deepEqual(await gameData.addServer(gameDir, { name: "Two", address: "two.example.com" }), { added: true });
  } finally {
    console.warn = realWarn;
  }
  assert.deepEqual(nbt.parse(await fsp.readFile(file)).servers.map((s) => s.ip), ["one.example.com", "two.example.com"]);
  assert.equal(warned.length, 1);
  assert.match(warned[0], /couldn't back up servers\.dat/);
  assert.deepEqual((await fsp.readdir(gameDir)).sort(), ["servers.dat", "servers.dat.bak"]); // no temp file left
});

/* ---------------- 8. Fabric's trailing-dash ranges ---------------- */

test("mcRangeAccepts: understands the trailing dash Fabric uses for 'pre-releases included'", () => {
  const ok = minecraft.mcRangeAccepts;
  assert.ok(ok(">=26.2-", "26.2"));
  assert.ok(ok(">=26.2-", "26.3"));
  assert.ok(!ok(">=26.2-", "26.1"));
  assert.ok(ok("~1.21.4-", "1.21.4"));
  assert.ok(!ok("~1.21.4-", "1.21.3"));
  assert.ok(!ok("~1.21.4-", "1.22"));
  assert.ok(ok(">=1.21.4- <1.21.5-", "1.21.4"));
  assert.ok(!ok(">=1.21.4- <1.21.5-", "1.21.5"));
  assert.ok(!ok(">=1.21.4- <1.21.5-", "1.21.3"));
  assert.ok(ok([">=1.20.1- <1.20.2-", ">=26.2-"], "26.2"));
  assert.ok(minecraft.reminthHudSupports("26.2", [{ minecraft: ">=26.2-" }]));
  // What already worked still does.
  assert.ok(ok(undefined, "1.8.9") && ok("*", "23w13a") && ok("", "1.8.9"));
  assert.ok(ok("1.21.x", "1.21.10") && !ok("1.21.x", "1.22"));
  assert.ok(ok(">=1.20 <1.21 || 1.19.4", "1.19.4") && !ok(">=1.20 <1.21 || 1.19.4", "1.21"));
  assert.ok(ok("26.2-snapshot-3", "26.2-snapshot-3") && !ok(">=26.2-", "26.2-snapshot-3"));
  // Something that can't be read is a no - a HUD is never installed on a guess.
  assert.ok(!ok("whenever", "1.21.4"));
});

/* ---------------- 9. two instances installing the same Java ---------------- */

test("java: two instances that need the same Java at once share one install", async () => {
  const jdk = path.join(paths.RUNTIMES_DIR, "ms-jdk-11");
  let zipDownloads = 0;
  let indexRequests = 0;
  let extracts = 0;
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  extractImpl = async (zipPath, { dir }) => {
    extracts++;
    await gate; // hold the first install open while the second caller arrives
    const top = path.join(dir, "jdk-11.0.24+8");
    await fsp.mkdir(path.join(top, "bin"), { recursive: true });
    await fsp.mkdir(path.join(top, "lib"), { recursive: true });
    await fsp.writeFile(path.join(top, "bin", "javaw.exe"), "real");
    await fsp.writeFile(path.join(top, "lib", "modules"), "m");
  };
  const serve = async (url) => {
    if (String(url).includes("aka.ms")) {
      zipDownloads++;
      return new Response("zip-bytes");
    }
    indexRequests++;
    throw new TypeError("fetch failed"); // Mojang's runtime index: unreachable
  };
  const wanted = { component: "none-11", majorVersion: 11 };
  try {
    const results = await withFetch(serve, async () => {
      const a = java.ensureRuntime(wanted);
      const b = java.ensureRuntime(wanted);
      const c = new Promise((resolve) => setTimeout(resolve, 30)).then(() => java.ensureRuntime(wanted)); // arrives mid-unpack
      setTimeout(release, 80);
      return Promise.all([a, b, c]);
    });
    assert.deepEqual(results, Array(3).fill(path.join(jdk, "bin", "javaw.exe")));
  } finally {
    release();
    extractImpl = async () => {};
  }
  assert.equal(zipDownloads, 1, "the folder was emptied and filled once, not once per instance");
  assert.equal(extracts, 1);
  assert.ok(indexRequests <= 2, "the callers that arrived together shared one look at Mojang's index");
  assert.equal(await fsp.readFile(path.join(jdk, "bin", "javaw.exe"), "utf8"), "real");
  assert.deepEqual((await fsp.readdir(jdk)).sort(), [".complete", "bin", "lib"]);

  // Nothing is left "in flight": a failed install can be tried again and reports its own error.
  await assert.rejects(withFetch(offline, () => java.ensureRuntime({ component: "none-25", majorVersion: 25 })), /Java 25 download failed/);
  await assert.rejects(withFetch(offline, () => java.ensureRuntime({ component: "none-25", majorVersion: 25 })), /Java 25 download failed/);
});
