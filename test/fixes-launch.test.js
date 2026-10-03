"use strict";
/**
 * Tests for the download / install / launch robustness fixes: atomic
 * downloads, the worker pool, offline starts, the Java "installed" marker,
 * servers.dat safety, log import de-duplication, and what Reminth is and
 * isn't allowed to delete from a mods folder.
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
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "reminth-fixes-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

// electron and extract-zip aren't installed where the tests run - stub them.
// The extract-zip stub does whatever the current test tells it to.
let extractImpl = async () => {};
const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return "STUB_ELECTRON_FIXES";
  if (request === "extract-zip") return "STUB_EXTRACT_ZIP_FIXES";
  return originalResolve.call(this, request, ...rest);
};
Module._cache.STUB_ELECTRON_FIXES = {
  id: "STUB_ELECTRON_FIXES",
  filename: "STUB_ELECTRON_FIXES",
  loaded: true,
  exports: { safeStorage: { isEncryptionAvailable: () => false } },
};
Module._cache.STUB_EXTRACT_ZIP_FIXES = {
  id: "STUB_EXTRACT_ZIP_FIXES",
  filename: "STUB_EXTRACT_ZIP_FIXES",
  loaded: true,
  exports: (zip, options) => extractImpl(zip, options),
};

const paths = require("../src/main/paths");
const downloader = require("../src/main/downloader");
const minecraft = require("../src/main/minecraft");
const java = require("../src/main/java");
const forge = require("../src/main/forge");
const gameData = require("../src/main/gameData");
const logs = require("../src/main/logs");
const nbt = require("../src/main/nbt");

const sha1 = (buf) => crypto.createHash("sha1").update(buf).digest("hex");
const tmpDir = (name) => fsp.mkdtemp(path.join(HOME, `${name}-`));
const exists = (p) => fsp.access(p).then(() => true, () => false);
const FAST = { retryDelayMs: 1 };

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

/* ---------------- downloader: downloadFile ---------------- */

test("downloadFile: writes the file and leaves no .part behind", async () => {
  const dir = await tmpDir("dl");
  const body = Buffer.from("hello world");
  await withFetch(async () => new Response(body), () =>
    downloader.downloadFile("https://example.com/a.jar", path.join(dir, "a.jar"), sha1(body), "sha1", FAST)
  );
  assert.deepEqual(await fsp.readdir(dir), ["a.jar"]);
  assert.equal(await fsp.readFile(path.join(dir, "a.jar"), "utf8"), "hello world");
});

test("downloadFile: a bad download never appears under the real name, and its .part is removed", async () => {
  const dir = await tmpDir("dl");
  let calls = 0;
  await assert.rejects(
    withFetch(async () => (calls++, new Response("truncat")), () =>
      downloader.downloadFile("https://example.com/a.jar", path.join(dir, "a.jar"), sha1(Buffer.from("the full file")), "sha1", FAST)
    ),
    /Checksum mismatch/
  );
  assert.deepEqual(await fsp.readdir(dir), []);
  assert.equal(calls, 3); // first try + 2 retries
});

test("downloadFile: an existing file with the wrong hash is downloaded again", async () => {
  const dir = await tmpDir("dl");
  const dest = path.join(dir, "client.jar");
  await fsp.writeFile(dest, "half a fi"); // what a killed launcher used to leave
  const good = Buffer.from("the whole file");
  let calls = 0;
  await withFetch(async () => (calls++, new Response(good)), () => downloader.downloadFile("https://example.com/c", dest, sha1(good), "sha1", FAST));
  assert.equal(calls, 1);
  assert.equal(await fsp.readFile(dest, "utf8"), "the whole file");
  // ...and one that matches isn't fetched at all.
  await withFetch(offline, () => downloader.downloadFile("https://example.com/c", dest, sha1(good), "sha1", FAST));
});

test("downloadFile: with no hash, an existing file is kept only if it isn't empty and matches a known size", async () => {
  const dir = await tmpDir("dl");
  const dest = path.join(dir, "mod.jar");
  await fsp.writeFile(dest, "12345");
  await withFetch(offline, () => downloader.downloadFile("https://example.com/m", dest, null, "sha1", FAST)); // kept
  await withFetch(async () => new Response("1234567890"), () =>
    downloader.downloadFile("https://example.com/m", dest, null, "sha1", { ...FAST, size: 10 })
  );
  assert.equal(await fsp.readFile(dest, "utf8"), "1234567890");
  await fsp.writeFile(dest, "");
  await withFetch(async () => new Response("fresh"), () => downloader.downloadFile("https://example.com/m", dest, null, "sha1", FAST));
  assert.equal(await fsp.readFile(dest, "utf8"), "fresh");
});

test("downloadFile: retries a 5xx and a dropped connection, but not a 404", async () => {
  const dir = await tmpDir("dl");
  let calls = 0;
  await withFetch(
    async () => {
      calls++;
      if (calls === 1) return new Response("busy", { status: 503 });
      if (calls === 2) throw new TypeError("fetch failed");
      return new Response("ok");
    },
    () => downloader.downloadFile("https://example.com/r", path.join(dir, "r"), null, "sha1", FAST)
  );
  assert.equal(calls, 3);
  assert.equal(await fsp.readFile(path.join(dir, "r"), "utf8"), "ok");

  calls = 0;
  await assert.rejects(
    withFetch(async () => (calls++, new Response("nope", { status: 404 })), () =>
      downloader.downloadFile("https://example.com/missing", path.join(dir, "x"), null, "sha1", FAST)
    ),
    /Download failed \(404\)/ // forge.js matches on this text
  );
  assert.equal(calls, 1);
  assert.deepEqual(await fsp.readdir(dir), ["r"]);
});

test("downloadFile: a body that stops sending is abandoned with a readable error", async () => {
  const dir = await tmpDir("dl");
  const stalling = async (_url, init) =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3])); // some bytes, then silence
          init.signal.addEventListener("abort", () => controller.error(init.signal.reason));
        },
      })
    );
  await assert.rejects(
    withFetch(stalling, () => downloader.downloadFile("https://cdn.example.com/big.zip", path.join(dir, "big.zip"), null, "sha1", { ...FAST, stallMs: 25 })),
    /Timed out reaching cdn\.example\.com/
  );
  assert.deepEqual(await fsp.readdir(dir), []);
});

test("withTimeout: a metadata request that hangs fails as 'Timed out reaching <host>'", async () => {
  const hang = (signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
  // AbortSignal.timeout's timer doesn't keep the process alive by itself (a
  // real request's socket does) - hold the event loop open for the test.
  const keepAlive = setTimeout(() => {}, 5000);
  test.after(() => clearTimeout(keepAlive));
  await assert.rejects(downloader.withTimeout("https://meta.example.org/v1/x.json", hang, 20), /^Error: Timed out reaching meta\.example\.org$/);
  // Other failures pass through untouched.
  await assert.rejects(downloader.withTimeout("https://meta.example.org/", async () => { throw new Error("boom"); }, 20), /^Error: boom$/);
  clearTimeout(keepAlive);
});

test("fetchJson / fetchMavenSha1 pass an abort signal to fetch", async () => {
  const seen = [];
  await withFetch(
    async (url, init) => {
      seen.push(init && init.signal instanceof AbortSignal);
      return String(url).endsWith(".sha1") ? new Response("a".repeat(40) + "  x.jar\n") : new Response('{"ok":true}');
    },
    async () => {
      assert.deepEqual(await downloader.fetchJson("https://example.com/x.json"), { ok: true });
      assert.equal(await downloader.fetchMavenSha1("https://example.com/x.jar"), "a".repeat(40));
    }
  );
  assert.deepEqual(seen, [true, true]);
});

test("renameWithRetry: retries a Windows-style lock, gives up on anything else", async () => {
  const dir = await tmpDir("rn");
  await fsp.writeFile(path.join(dir, "a"), "x");
  const real = fsp.rename;
  let calls = 0;
  fsp.rename = async (...args) => {
    calls++;
    if (calls < 3) throw Object.assign(new Error("locked"), { code: "EBUSY" });
    return real(...args);
  };
  try {
    await downloader.renameWithRetry(path.join(dir, "a"), path.join(dir, "b"));
    assert.equal(calls, 3);
    assert.equal(await exists(path.join(dir, "b")), true);
    calls = 0;
    fsp.rename = async () => {
      calls++;
      throw Object.assign(new Error("gone"), { code: "ENOENT" });
    };
    await assert.rejects(downloader.renameWithRetry(path.join(dir, "nope"), path.join(dir, "c")), /gone/);
    assert.equal(calls, 1);
  } finally {
    fsp.rename = real;
  }
});

/* ---------------- downloader: runPool ---------------- */

test("runPool: after a failure nothing new starts, and it waits for what's running", async () => {
  const started = [];
  const finished = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const worker = async (n) => {
    started.push(n);
    if (n === 1) {
      await sleep(5);
      throw new Error("first failure");
    }
    await sleep(40);
    if (n === 2) {
      finished.push(n);
      throw new Error("second failure");
    }
    finished.push(n);
  };
  await assert.rejects(downloader.runPool([1, 2, 3, 4, 5, 6], 3, worker), /first failure/);
  assert.deepEqual(started, [1, 2, 3]); // 4-6 never handed out
  assert.deepEqual(finished.sort(), [2, 3]); // the in-flight ones were waited for
});

test("runPool: runs everything, respects the limit, and survives a worker that throws synchronously", async () => {
  let active = 0;
  let peak = 0;
  const seen = [];
  await downloader.runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    peak = Math.max(peak, ++active);
    await new Promise((r) => setTimeout(r, 2));
    seen.push(n);
    active--;
  });
  assert.equal(seen.length, 7);
  assert.equal(peak, 3);
  await downloader.runPool([], 4, async () => assert.fail("no items"));
  await assert.rejects(downloader.runPool([1], 2, () => { throw new Error("sync"); }), /sync/);
});

/* ---------------- minecraft: releaseMatchesVersion ---------------- */

test("releaseMatchesVersion: a version is matched whole, not as a substring", () => {
  const tag = (t, v) => minecraft.releaseMatchesVersion({ tag_name: t }, v);
  assert.equal(tag("mc1.21.1-0.6.0", "1.21.1"), true);
  assert.equal(tag("1.21.1+fabric", "1.21.1"), true);
  assert.equal(tag("mc1.21.10-0.6.0", "1.21.1"), false);
  assert.equal(tag("mc1.21.11-0.6.0", "1.21.1"), false);
  assert.equal(tag("mc1.20.4-0.5.8", "1.20"), false);
  assert.equal(tag("mc1.21.4-0.6.0", "1.21"), false);
  assert.equal(tag("0.6.0+mc1.21", "1.21"), true);
});

/* ---------------- minecraft: tidyManagedMods ---------------- */

async function modsFolder(files) {
  const gameDir = await tmpDir("game");
  const modsDir = path.join(gameDir, "mods");
  await fsp.mkdir(modsDir);
  for (const f of files) await fsp.writeFile(path.join(modsDir, f), f);
  return { gameDir, modsDir, list: async () => (await fsp.readdir(modsDir)).sort() };
}
const managedOf = async (gameDir) => JSON.parse(await fsp.readFile(path.join(gameDir, ".reminth", "managed-mods.json"), "utf8")).files;

test("tidyManagedMods: the player's own mods are never deleted, whatever they're called", async () => {
  const mine = ["sodium-extra-0.6.0.jar", "c2me-fabric-mc1.21-0.3.jar", "ferritecore-7.0.0.jar", "starlight-1.1.3.jar", "lithium-fabric-0.14.jar", "fabric-api-base-0.4.jar", "jei-1.0.jar"];
  const { modsDir, list } = await modsFolder([...mine, "sodium-fabric-0.6.1.jar"]);
  // Sodium was installed fine this run; Lithium's download failed.
  const removed = await minecraft.tidyManagedMods(modsDir, [{ file: "sodium-fabric-0.6.1.jar", mod: "sodium", own: true }]);
  assert.deepEqual(removed, []);
  assert.deepEqual(await list(), [...mine, "sodium-fabric-0.6.1.jar"].sort());
});

test("tidyManagedMods: a failed or skipped download keeps the copy that's already there", async () => {
  const { gameDir, modsDir, list } = await modsFolder(["sodium-fabric-0.6.0.jar", "fabric-api-0.100.0+1.21.jar"]);
  const installed = [
    { file: "sodium-fabric-0.6.0.jar", mod: "sodium", own: true },
    { file: "fabric-api-0.100.0+1.21.jar", mod: "fabric-api", own: true },
  ];
  await minecraft.tidyManagedMods(modsDir, installed);
  assert.deepEqual(Object.keys(await managedOf(gameDir)).sort(), ["fabric-api-0.100.0+1.21.jar", "sodium-fabric-0.6.0.jar"]);
  // Next launch: offline, nothing could be fetched. The old tidy deleted both.
  assert.deepEqual(await minecraft.tidyManagedMods(modsDir, []), []);
  assert.deepEqual(await list(), ["fabric-api-0.100.0+1.21.jar", "sodium-fabric-0.6.0.jar"]);
});

test("tidyManagedMods: a jar Reminth installed is removed once its replacement is in place", async () => {
  const { gameDir, modsDir, list } = await modsFolder(["sodium-fabric-0.6.0.jar", "lithium-fabric-0.14.jar"]);
  await minecraft.tidyManagedMods(modsDir, [
    { file: "sodium-fabric-0.6.0.jar", mod: "sodium", own: true },
    { file: "lithium-fabric-0.14.jar", mod: "lithium", own: true },
  ]);
  await fsp.writeFile(path.join(modsDir, "sodium-fabric-0.6.1.jar"), "new");
  // New Sodium arrived; Lithium wasn't available this time.
  const removed = await minecraft.tidyManagedMods(modsDir, [{ file: "sodium-fabric-0.6.1.jar", mod: "sodium", own: true }]);
  assert.deepEqual(removed, ["sodium-fabric-0.6.0.jar"]);
  assert.deepEqual(await list(), ["lithium-fabric-0.14.jar", "sodium-fabric-0.6.1.jar"]);
  assert.deepEqual(Object.keys(await managedOf(gameDir)).sort(), ["lithium-fabric-0.14.jar", "sodium-fabric-0.6.1.jar"]);
});

test("tidyManagedMods: switching the performance pack or HUD off removes only Reminth's copies", async () => {
  const { modsDir, list } = await modsFolder(["sodium-fabric-0.6.0.jar", "fabric-api-0.100.0+1.21.jar", "reminthhud-1.2.0.jar", "lithium-fabric-0.14.jar"]);
  await minecraft.tidyManagedMods(modsDir, [
    { file: "sodium-fabric-0.6.0.jar", mod: "sodium", own: true },
    { file: "fabric-api-0.100.0+1.21.jar", mod: "fabric-api", own: true },
    { file: "reminthhud-1.2.0.jar", mod: "reminthhud", own: true },
    { file: "lithium-fabric-0.14.jar", mod: "lithium", own: false }, // was already there: the player's
  ]);
  const removed = await minecraft.tidyManagedMods(modsDir, [], { dropHud: true, dropPerf: true });
  assert.deepEqual(removed.sort(), ["reminthhud-1.2.0.jar", "sodium-fabric-0.6.0.jar"]);
  // Fabric API stays (the player's own mods may need it), and so does their Lithium.
  assert.deepEqual(await list(), ["fabric-api-0.100.0+1.21.jar", "lithium-fabric-0.14.jar"]);
});

test("tidyManagedMods: a jar that isn't in the manifest is never deleted because of its name", async () => {
  // Jars from a Reminth older than the manifest are written into it once by
  // adoptLegacyManagedMods (see fixes-launch3.test.js). The tidy itself only
  // ever deletes what the manifest lists - it used to also delete unlisted
  // jars named like a mod that had just been installed.
  const all = [
    "sodium-fabric-0.5.0.jar",
    "sodium-fabric-0.6.1.jar",
    "lithium-fabric-0.13.jar",
    "fabric-api-0.99.0+1.21.jar",
    "fabric-api-0.100.0+1.21.jar",
    "wxhud-1.0.jar",
    "reminthhud-1.2.0.jar",
  ];
  const { gameDir, modsDir, list } = await modsFolder(all);
  const installed = [
    { file: "sodium-fabric-0.6.1.jar", mod: "sodium", own: true },
    { file: "fabric-api-0.100.0+1.21.jar", mod: "fabric-api", own: true },
    { file: "reminthhud-1.2.0.jar", mod: "reminthhud", own: true },
  ];
  assert.deepEqual(await minecraft.tidyManagedMods(modsDir, installed), []);
  assert.deepEqual(await list(), all.slice().sort());
  // Not even with the HUD and the performance pack switched off.
  assert.deepEqual((await minecraft.tidyManagedMods(modsDir, [], { dropHud: true, dropPerf: true })).sort(), ["reminthhud-1.2.0.jar", "sodium-fabric-0.6.1.jar"]);
  assert.deepEqual(await list(), ["fabric-api-0.100.0+1.21.jar", "fabric-api-0.99.0+1.21.jar", "lithium-fabric-0.13.jar", "sodium-fabric-0.5.0.jar", "wxhud-1.0.jar"]);
  assert.deepEqual(Object.keys(await managedOf(gameDir)), ["fabric-api-0.100.0+1.21.jar"]);
});

test("tidyManagedMods: file names are compared case-insensitively (the kept jar is never the one removed)", async () => {
  const { modsDir, list } = await modsFolder(["Sodium-Fabric-0.6.1.jar"]);
  const removed = await minecraft.tidyManagedMods(modsDir, [{ file: "sodium-fabric-0.6.1.jar", mod: "sodium", own: false }]);
  assert.deepEqual(removed, []);
  assert.deepEqual(await list(), ["Sodium-Fabric-0.6.1.jar"]);
});

/* ---------------- minecraft: bundled HUD jar ---------------- */

test("installBundledJar: skips an identical copy, and a locked destination isn't fatal", async () => {
  const dir = await tmpDir("hud");
  const src = path.join(dir, "src.jar");
  const dest = path.join(dir, "mods.jar");
  await fsp.writeFile(src, "jar-bytes");
  assert.equal(await minecraft.installBundledJar(src, dest), "written");
  assert.equal(await fsp.readFile(dest, "utf8"), "jar-bytes");
  assert.equal(await minecraft.installBundledJar(src, dest), "kept");

  // A newer build while the game has the old jar open: Windows refuses the swap.
  await fsp.writeFile(src, "newer-jar-bytes");
  const real = fsp.rename;
  fsp.rename = async () => {
    throw Object.assign(new Error("resource busy or locked"), { code: "EBUSY" });
  };
  try {
    assert.equal(await minecraft.installBundledJar(src, dest), "locked");
  } finally {
    fsp.rename = real;
  }
  assert.equal(await fsp.readFile(dest, "utf8"), "jar-bytes");
  assert.deepEqual((await fsp.readdir(dir)).sort(), ["mods.jar", "src.jar"]); // no temp file left
});

/* ---------------- minecraft: launch log handle ---------------- */

test("launch: the log file is closed again when spawn() throws", () => {
  const opened = [];
  const closed = [];
  const realOpen = fs.openSync;
  const realClose = fs.closeSync;
  fs.openSync = (...args) => {
    const fd = realOpen(...args);
    opened.push(fd);
    return fd;
  };
  fs.closeSync = (fd) => {
    closed.push(fd);
    return realClose(fd);
  };
  try {
    assert.throws(() =>
      minecraft.launch(
        { profile: { id: "x", mainClass: "Main", minecraftArguments: "" }, clientJarPath: "c.jar", libraries: [], javaPath: "bad\0path" },
        { username: "p", uuid: "u", minecraftAccessToken: "t" },
        null,
        { maxMemoryMb: 512 },
        { id: "fd-test", gameDir: path.join(HOME, "fd-game") }
      )
    );
  } finally {
    fs.openSync = realOpen;
    fs.closeSync = realClose;
  }
  assert.equal(opened.length, 1);
  assert.deepEqual(closed, opened);
});

/* ---------------- minecraft: natives ---------------- */

test("extractNatives: skipped once stamped, and a locked DLL doesn't stop a second instance", async () => {
  const nativesDir = await tmpDir("natives");
  const libs = [{ path: "org/lwjgl/lwjgl-natives.jar", sha1: "abc", natives: true }, { path: "not/native.jar", natives: false }];
  let calls = 0;
  extractImpl = async (_zip, { dir }) => {
    calls++;
    await fsp.writeFile(path.join(dir, "lwjgl.dll"), "dll");
  };
  await minecraft.extractNatives(libs, nativesDir, () => {});
  assert.equal(calls, 1);
  await minecraft.extractNatives(libs, nativesDir, () => {});
  assert.equal(calls, 1); // stamp matched - not extracted again

  // A different library set, while another instance's game has the DLLs open.
  const locked = Object.assign(new Error("operation not permitted"), { code: "EPERM" });
  extractImpl = async () => {
    calls++;
    throw locked;
  };
  const changed = [{ ...libs[0], sha1: "def" }];
  await minecraft.extractNatives(changed, nativesDir, () => {}); // continues
  await minecraft.extractNatives(changed, nativesDir, () => {});
  assert.equal(calls, 3); // ...without stamping a set that wasn't fully extracted

  // Nothing there to fall back on, or a real error: still fails.
  const empty = await tmpDir("natives");
  await assert.rejects(minecraft.extractNatives(changed, empty, () => {}), /operation not permitted/);
  extractImpl = async () => {
    throw new Error("corrupt zip");
  };
  await assert.rejects(minecraft.extractNatives(changed, nativesDir, () => {}), /corrupt zip/);
  extractImpl = async () => {};
});

/* ---------------- minecraft: assets ---------------- */

test("downloadAssets: works offline from the cached index, and re-downloads an object with the wrong size", async () => {
  const good = Buffer.from("a sound file");
  const other = Buffer.from("a texture");
  const index = Buffer.from(JSON.stringify({ objects: { "a.ogg": { hash: sha1(good), size: good.length }, "b.png": { hash: sha1(other), size: other.length } } }));
  const profile = { assets: "fixes-test", assetIndex: { url: "https://piston-meta.mojang.com/idx.json", sha1: sha1(index) } };
  const objectPath = (buf) => path.join(paths.ASSETS_DIR, "objects", sha1(buf).slice(0, 2), sha1(buf));

  const served = [];
  const serve = async (url) => {
    served.push(String(url));
    if (String(url).endsWith("idx.json")) return new Response(index);
    return new Response(String(url).endsWith(sha1(good)) ? good : other);
  };
  await withFetch(serve, () => minecraft.downloadAssets(profile, HOME, () => {}));
  assert.equal(served.length, 3);
  assert.deepEqual(await fsp.readFile(objectPath(good)), good);

  // Fully installed: no network needed at all.
  const result = await withFetch(offline, () => minecraft.downloadAssets(profile, HOME, () => {}));
  assert.equal(result.gameAssetsDir, paths.ASSETS_DIR);

  // A truncated object (same name, wrong size) used to be accepted forever.
  await fsp.writeFile(objectPath(good), "a sou");
  served.length = 0;
  await withFetch(serve, () => minecraft.downloadAssets(profile, HOME, () => {}));
  assert.equal(served.length, 1);
  assert.deepEqual(await fsp.readFile(objectPath(good)), good);

  // The index changed upstream but can't be fetched: the cached one is used.
  const moved = { ...profile, assetIndex: { ...profile.assetIndex, sha1: "0".repeat(40) } };
  await withFetch(offline, () => minecraft.downloadAssets(moved, HOME, () => {}));
  // Nothing cached and no network is still an error.
  await assert.rejects(withFetch(offline, () => minecraft.downloadAssets({ ...moved, assets: "never-seen" }, HOME, () => {})), /fetch failed/);
});

/* ---------------- java ---------------- */

test("java: an installed Mojang runtime is used without asking the network", async () => {
  const dir = path.join(paths.RUNTIMES_DIR, "java-runtime-test");
  await fsp.mkdir(path.join(dir, "bin"), { recursive: true });
  await fsp.writeFile(path.join(dir, "bin", "javaw.exe"), "exe");
  await fsp.writeFile(path.join(dir, ".reminth-runtime"), "21.0.3");
  const javaw = await withFetch(offline, () => java.ensureRuntime({ component: "java-runtime-test", majorVersion: 21 }));
  assert.equal(javaw, path.join(dir, "bin", "javaw.exe"));
});

test("java: Microsoft JDK - a complete older install is adopted, a half-moved one is wiped and reinstalled", async () => {
  // Installed by a build from before the .complete marker: bin/ and lib/ both there.
  const jdk17 = path.join(paths.RUNTIMES_DIR, "ms-jdk-17");
  await fsp.mkdir(path.join(jdk17, "bin"), { recursive: true });
  await fsp.mkdir(path.join(jdk17, "lib"), { recursive: true });
  await fsp.writeFile(path.join(jdk17, "bin", "javaw.exe"), "exe");
  await fsp.writeFile(path.join(jdk17, "lib", "modules"), "m");
  const javaw = await withFetch(offline, () => java.ensureRuntime({ component: "none-17", majorVersion: 17 }));
  assert.equal(javaw, path.join(jdk17, "bin", "javaw.exe"));
  assert.equal(await exists(path.join(jdk17, ".complete")), true);

  // bin/ was moved in, then the move failed: javaw.exe exists but it isn't a JDK.
  const jdk21 = path.join(paths.RUNTIMES_DIR, "ms-jdk-21");
  await fsp.mkdir(path.join(jdk21, "bin"), { recursive: true });
  await fsp.writeFile(path.join(jdk21, "bin", "javaw.exe"), "broken");
  await assert.rejects(withFetch(offline, () => java.ensureRuntime({ component: "none-21", majorVersion: 21 })), /Java 21 download failed/);
  assert.equal(await exists(path.join(jdk21, "bin", "javaw.exe")), false); // not left looking installed

  // Now with the download working: the marker is written, and only at the end.
  let markerSeenDuringExtract = null;
  extractImpl = async (zip, { dir }) => {
    markerSeenDuringExtract = await exists(path.join(jdk21, ".complete"));
    const top = path.join(dir, "jdk-21.0.3+9");
    await fsp.mkdir(path.join(top, "bin"), { recursive: true });
    await fsp.mkdir(path.join(top, "lib"), { recursive: true });
    await fsp.writeFile(path.join(top, "bin", "javaw.exe"), "real");
    await fsp.writeFile(path.join(top, "lib", "modules"), "m");
  };
  const serve = async (url) => {
    if (String(url).includes("aka.ms")) return new Response("zip-bytes");
    throw new TypeError("fetch failed"); // Mojang's index stays unreachable
  };
  try {
    const installed = await withFetch(serve, () => java.ensureRuntime({ component: "none-21", majorVersion: 21 }));
    assert.equal(await fsp.readFile(installed, "utf8"), "real");
  } finally {
    extractImpl = async () => {};
  }
  assert.equal(markerSeenDuringExtract, false);
  assert.deepEqual((await fsp.readdir(jdk21)).sort(), [".complete", "bin", "lib"]);
});

/* ---------------- forge ---------------- */

test("forge: an installer that isn't a readable zip is deleted so the next try downloads it again", async () => {
  const installer = { key: "forge-fixes-test-1", url: "https://maven.minecraftforge.net/x/installer.jar" };
  const serve = async (url) => (String(url).endsWith(".sha1") ? new Response("", { status: 404 }) : new Response("this is not a zip file at all"));
  await assert.rejects(withFetch(serve, () => forge.prepare({ installer, assertUrl: (u) => u, report: null })), /damaged and has been removed/);
  const workDir = path.join(paths.ROOT, "cache", "loader-installers", installer.key);
  assert.deepEqual(await fsp.readdir(workDir), []);
});

/* ---------------- gameData: servers.dat ---------------- */

test("addServer: an unreadable servers.dat is never replaced", async () => {
  const gameDir = await tmpDir("servers");
  const file = path.join(gameDir, "servers.dat");
  const junk = Buffer.from([10, 0, 0, 9, 0, 7, 115, 101]); // cut off mid-tag
  await fsp.writeFile(file, junk);
  await assert.rejects(gameData.addServer(gameDir, { name: "New", address: "play.example.com" }), {
    message: "Couldn't read this instance's server list — it wasn't changed.",
  });
  assert.deepEqual(await fsp.readFile(file), junk);
  assert.deepEqual(await fsp.readdir(gameDir), ["servers.dat"]);

  // Same when the file is there but can't be read (here: it's a directory).
  const blocked = await tmpDir("servers");
  await fsp.mkdir(path.join(blocked, "servers.dat"));
  await assert.rejects(gameData.addServer(blocked, { name: "New", address: "play.example.com" }), /wasn't changed/);
});

test("addServer: creates the list when there is none, and keeps a .bak of the one it replaces", async () => {
  const gameDir = await tmpDir("servers");
  const file = path.join(gameDir, "servers.dat");
  assert.deepEqual(await gameData.addServer(gameDir, { name: "One", address: "one.example.com" }), { added: true });
  assert.deepEqual(await fsp.readdir(gameDir), ["servers.dat"]); // nothing to back up yet, no temp file left
  const before = await fsp.readFile(file);

  assert.deepEqual(await gameData.addServer(gameDir, { name: "Two", address: "two.example.com:25570" }), { added: true });
  assert.deepEqual((await fsp.readdir(gameDir)).sort(), ["servers.dat", "servers.dat.bak"]);
  assert.deepEqual(await fsp.readFile(file + ".bak"), before);
  assert.deepEqual(nbt.parse(await fsp.readFile(file)).servers.map((s) => s.ip), ["one.example.com", "two.example.com:25570"]);

  assert.deepEqual(await gameData.addServer(gameDir, { name: "Dup", address: "ONE.example.com" }), { added: false });
});

/* ---------------- logs ---------------- */

test("logs: a log whose name is already taken is archived once, not on every call", async () => {
  const gameDir = await tmpDir("logs");
  const instance = { id: "fixes-logs-" + path.basename(gameDir), gameDir };
  const archive = path.join(paths.LOG_ARCHIVE_DIR, instance.id);
  const logFile = path.join(gameDir, "logs", "2026-09-23-1.log.gz");
  await fsp.mkdir(path.dirname(logFile), { recursive: true });
  const gz = (text) => require("zlib").gzipSync(text);

  await fsp.writeFile(logFile, gz("[1:00:00] [main/INFO]: first\n"));
  assert.equal(await logs.importInstanceLogs(instance), true);
  assert.equal(await logs.importInstanceLogs(instance), false);

  // The game folder was reset: same name, different log.
  await fsp.writeFile(logFile, gz("[1:00:00] [main/INFO]: a second, different and longer log\n"));
  assert.equal(await logs.importInstanceLogs(instance), true);
  const count = async () => (await fsp.readdir(archive)).filter((f) => f.endsWith(".log.gz")).length;
  assert.equal(await count(), 2);
  for (let i = 0; i < 3; i++) assert.equal(await logs.importInstanceLogs(instance), false);
  assert.equal(await count(), 2);

  const index = JSON.parse(await fsp.readFile(path.join(archive, "index.json"), "utf8"));
  assert.deepEqual(Object.values(index.files).map((f) => f.src), ["2026-09-23-1.log.gz", "2026-09-23-1.log.gz"]);

  // An index written before `src` existed is understood too.
  for (const info of Object.values(index.files)) delete info.src;
  await fsp.writeFile(path.join(archive, "index.json"), JSON.stringify(index));
  assert.equal(await logs.importInstanceLogs(instance), false);
  assert.equal(await count(), 2);
});
