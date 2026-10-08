"use strict";
/**
 * Regression tests for the content / registry / settings / Modrinth fixes:
 * atomic writes and locking, downloads that fail cleanly, the instance
 * registry surviving a corrupt file, install bookkeeping, retries.
 * No network (fetch is stubbed), no Electron, everything in temp folders.
 * Run with: node --test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { EventEmitter } = require("events");

// paths.js works everything out from the home folder when it is first
// loaded - point that at a throwaway folder before anything requires it.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "reminth-fixes-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
test.after(() => fsp.rm(HOME, { recursive: true, force: true }));

// store.js pulls in electron for safeStorage - stub it. The fake
// "encryption" (a marker byte + reversed text) is switched on per test.
const safeStorage = {
  available: false,
  isEncryptionAvailable: () => safeStorage.available,
  encryptString: (text) => Buffer.concat([Buffer.from([0x01]), Buffer.from([...Buffer.from(text, "utf8")].reverse())]),
  decryptString: (buf) => {
    if (buf[0] !== 0x01) throw new Error("not ours");
    return Buffer.from([...buf.subarray(1)].reverse()).toString("utf8");
  },
};
const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return "STUB_ELECTRON_FIXES";
  return originalResolve.call(this, request, ...rest);
};
Module._cache.STUB_ELECTRON_FIXES = { id: "STUB_ELECTRON_FIXES", filename: "STUB_ELECTRON_FIXES", loaded: true, exports: { safeStorage } };

const paths = require("../src/main/paths");
const atomic = require("../src/main/atomic");
const content = require("../src/main/content");
const modrinth = require("../src/main/modrinth");
const store = require("../src/main/store");
const zip = require("../src/main/zip");

assert.ok(paths.ROOT.startsWith(HOME), "tests must never touch the real Reminth folder");

const sha1 = (buf) => crypto.createHash("sha1").update(buf).digest("hex");
const tmpDir = (name) => fsp.mkdtemp(path.join(HOME, `${name}-`));
const exists = (p) => fsp.access(p).then(() => true, () => false);
const leftovers = async (dir) => (await fsp.readdir(dir)).filter((n) => /\.(tmp|part)$/.test(n));

/** Replaces obj[key] for the length of one test (patching the same thing twice still restores the real one). */
const patched = new Map(); // obj -> Map(key -> the real value)
function patch(t, obj, key, value) {
  if (!patched.has(obj)) patched.set(obj, new Map());
  const originals = patched.get(obj);
  if (!originals.has(key)) {
    originals.set(key, obj[key]);
    t.after(() => {
      obj[key] = originals.get(key);
      originals.delete(key);
    });
  }
  obj[key] = value;
}

/** A fetch stub serving fixed bodies by URL; anything else is a 404. */
function serve(t, files) {
  const calls = [];
  patch(t, globalThis, "fetch", async (url) => {
    const href = String(url);
    calls.push(href);
    if (!(href in files)) return new Response("nope", { status: 404 });
    return new Response(files[href], { status: 200, headers: { "content-length": String(files[href].length) } });
  });
  return calls;
}

/* ------------------------------------------------------------------ */
/* atomic.js                                                          */
/* ------------------------------------------------------------------ */

test("atomic: writes land whole, leave no temp file, and can keep a .bak", async () => {
  const dir = await tmpDir("atomic");
  const file = path.join(dir, "deep", "a.json");
  await atomic.writeJsonAtomic(file, { a: 1 }, { space: 2, backup: true });
  assert.deepEqual(JSON.parse(await fsp.readFile(file, "utf8")), { a: 1 });
  assert.deepEqual(JSON.parse(await fsp.readFile(file + ".bak", "utf8")), { a: 1 });
  assert.deepEqual(await leftovers(path.dirname(file)), []);
  // many overlapping writes of one file: none collide on a temp name
  await Promise.all(Array.from({ length: 20 }, (_, i) => atomic.writeJsonAtomic(file, { i })));
  assert.equal(typeof JSON.parse(await fsp.readFile(file, "utf8")).i, "number");
  assert.deepEqual(await leftovers(path.dirname(file)), []);
});

test("atomic: a rename that hits EBUSY/EPERM is retried, and the temp file goes if it never works", async (t) => {
  const dir = await tmpDir("atomic-busy");
  const file = path.join(dir, "a.json");
  const realRename = fsp.rename;
  let failures = 2;
  patch(t, fsp, "rename", async (from, to) => {
    if (failures-- > 0) throw Object.assign(new Error("busy"), { code: failures % 2 ? "EBUSY" : "EPERM" });
    return realRename(from, to);
  });
  await atomic.writeFileAtomic(file, "ok");
  assert.equal(await fsp.readFile(file, "utf8"), "ok");

  fsp.rename = async () => {
    throw Object.assign(new Error("full"), { code: "ENOSPC" });
  };
  await assert.rejects(atomic.writeFileAtomic(file, "new"), /full/);
  assert.equal(await fsp.readFile(file, "utf8"), "ok", "the old file is untouched");
  assert.deepEqual(await leftovers(dir), []);
});

test("atomic: withLock runs one job at a time per key and survives a failing job", async () => {
  const order = [];
  const job = (name, ms, fail) => async () => {
    order.push(`start ${name}`);
    await new Promise((r) => setTimeout(r, ms));
    order.push(`end ${name}`);
    if (fail) throw new Error("boom");
    return name;
  };
  const a = atomic.withLock("k", job("a", 20));
  const b = atomic.withLock("k", job("b", 1, true));
  const c = atomic.withLock("k", job("c", 1));
  const other = atomic.withLock("other", job("x", 1));
  assert.equal(await a, "a");
  await assert.rejects(b, /boom/);
  assert.equal(await c, "c");
  await other;
  assert.deepEqual(order.filter((o) => !o.endsWith("x")), ["start a", "end a", "start b", "end b", "start c", "end c"]);
  assert.ok(order.indexOf("start x") < order.indexOf("end a"), "a different key doesn't wait");
});

test("atomic: quarantine moves a file aside and keeps only the newest two", async () => {
  const dir = await tmpDir("quarantine");
  const file = path.join(dir, "s.json");
  for (const stamp of [1000, 2000, 3000]) await fsp.writeFile(`${file}.corrupt-${stamp}`, "old");
  await fsp.writeFile(file, "{broken");
  const moved = await atomic.quarantine(file);
  assert.ok(moved && (await fsp.readFile(moved, "utf8")) === "{broken");
  assert.equal(await exists(file), false);
  const kept = (await fsp.readdir(dir)).sort();
  assert.equal(kept.length, 2);
  assert.ok(kept.includes(path.basename(moved)) && kept.includes("s.json.corrupt-3000"));
});

/* ------------------------------------------------------------------ */
/* 1. downloadWithHash                                                */
/* ------------------------------------------------------------------ */

test("download: verified file lands; a bad checksum leaves the old file and no temp file", async (t) => {
  const dir = await tmpDir("dl");
  const dest = path.join(dir, "mods", "a.jar");
  const body = Buffer.from("new jar bytes");
  serve(t, { "https://cdn.modrinth.com/a.jar": body });
  await content.downloadWithHash("https://cdn.modrinth.com/a.jar", dest, sha1(body));
  assert.deepEqual(await fsp.readFile(dest), body);

  await assert.rejects(content.downloadWithHash("https://cdn.modrinth.com/a.jar", dest, "0".repeat(40)), /Checksum mismatch/);
  assert.deepEqual(await fsp.readFile(dest), body);
  assert.deepEqual(await leftovers(path.dirname(dest)), []);
});

test("download: two downloads of the same file at once don't share a temp file", async (t) => {
  const dir = await tmpDir("dl-twice");
  const dest = path.join(dir, "fabric-api.jar");
  const body = crypto.randomBytes(300000);
  serve(t, { "https://cdn.modrinth.com/f.jar": body });
  await Promise.all([1, 2, 3].map(() => content.downloadWithHash("https://cdn.modrinth.com/f.jar", dest, sha1(body))));
  assert.deepEqual(await fsp.readFile(dest), body);
  assert.deepEqual(await leftovers(dir), []);
});

test("download: a write error (disk full, folder gone) rejects instead of hanging or crashing", async (t) => {
  const dir = await tmpDir("dl-enospc");
  const dest = path.join(dir, "a.jar");
  serve(t, { "https://cdn.modrinth.com/a.jar": crypto.randomBytes(200000) });
  const realCreate = fs.createWriteStream;
  patch(t, fs, "createWriteStream", (file, options) => {
    const stream = realCreate(file, { ...options, highWaterMark: 16 }); // every write waits for 'drain'
    stream._write = (chunk, enc, cb) => cb(Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" }));
    return stream;
  });
  await assert.rejects(content.downloadWithHash("https://cdn.modrinth.com/a.jar", dest, null), /ENOSPC/);
  assert.equal(await exists(dest), false);
  assert.deepEqual(await leftovers(dir), []);
});

test("download: a server that stops sending is given up on, and the reader is cancelled", async (t) => {
  const dir = await tmpDir("dl-stall");
  const dest = path.join(dir, "a.jar");
  let cancelled = false;
  patch(t, globalThis, "fetch", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3])); // a few bytes, then silence
      },
      cancel() {
        cancelled = true;
      },
    });
    return new Response(body, { status: 200 });
  });
  const started = Date.now();
  await assert.rejects(content.downloadWithHash("https://cdn.modrinth.com/a.jar", dest, null, null, { stallMs: 60 }), /stalled/);
  assert.ok(Date.now() - started < 5000);
  assert.equal(cancelled, true);
  assert.equal(await exists(dest), false);
  assert.deepEqual(await leftovers(dir), []);
});

/* ------------------------------------------------------------------ */
/* 8. safeFileName                                                    */
/* ------------------------------------------------------------------ */

test("safeFileName: trailing dots/spaces, reserved device names, and long names keep their extension", () => {
  assert.equal(content.safeFileName("mod.jar."), "mod.jar");
  assert.equal(content.safeFileName("mod.jar . ."), "mod.jar");
  assert.equal(content.safeFileName("pack "), "pack");
  assert.throws(() => content.safeFileName("..."));
  assert.throws(() => content.safeFileName(" . "));

  assert.equal(content.safeFileName("aux.jar"), "_aux.jar");
  assert.equal(content.safeFileName("CON.zip"), "_CON.zip");
  assert.equal(content.safeFileName("Lpt9.tar.gz"), "_Lpt9.tar.gz");
  assert.equal(content.safeFileName("com1.jar.disabled"), "_com1.jar.disabled");
  assert.equal(content.safeFileName("nul .jar"), "_nul .jar");
  assert.throws(() => content.safeFileName("NUL")); // a bare device name is never a real file
  assert.throws(() => content.safeFileName("com7."));
  assert.equal(content.safeFileName("console.jar"), "console.jar"); // only exact device names
  assert.equal(content.safeFileName("com10.jar"), "com10.jar");

  const long = content.safeFileName("x".repeat(400) + ".jar");
  assert.equal(long.length, 200);
  assert.ok(long.endsWith(".jar"));
  const longDisabled = content.safeFileName("y".repeat(400) + ".zip.disabled");
  assert.equal(longDisabled.length, 200);
  assert.ok(longDisabled.endsWith(".zip.disabled"));
  assert.ok(!/[. ]\.jar$/.test(content.safeFileName("z".repeat(194) + ". .more.jar")));
});

/* ------------------------------------------------------------------ */
/* 5. watching                                                        */
/* ------------------------------------------------------------------ */

test("watch: overlapping watchInstance calls leave only the last one's watchers; errors don't escape", async (t) => {
  const open = new Set();
  patch(t, fs, "watch", (dir, _options, listener) => {
    const w = new EventEmitter();
    w.dir = dir;
    w.listener = listener;
    w.close = () => open.delete(w);
    open.add(w);
    return w;
  });
  const a = await tmpDir("watch-a");
  const b = await tmpDir("watch-b");
  let firedA = 0;
  let firedB = 0;
  // not awaited one after the other - the way two quick IPC calls arrive
  await Promise.all([content.watchInstance(a, () => firedA++), content.watchInstance(b, () => firedB++), content.watchInstance(a, () => firedA++), content.watchInstance(b, () => firedB++)]);
  assert.equal(open.size, 4);
  assert.ok([...open].every((w) => w.dir.startsWith(b)), "only the last target is watched");

  // a watched folder being deleted raises 'error' - it must be handled, and close that watcher
  const [first] = [...open];
  assert.doesNotThrow(() => first.emit("error", new Error("EPERM: watched folder removed")));
  assert.equal(open.size, 3);

  // unwatch closes everything and drops a notification that was still pending
  [...open][0].listener("rename", "x.jar");
  content.unwatch();
  assert.equal(open.size, 0);
  await new Promise((r) => setTimeout(r, 320));
  assert.equal(firedA + firedB, 0);

  // and a watchInstance overtaken by unwatch() while it was starting opens nothing
  const pending = content.watchInstance(a, () => firedA++);
  content.unwatch();
  await pending;
  assert.equal(open.size, 0);
});

/* ------------------------------------------------------------------ */
/* 6 + 7. install / applyUpdates bookkeeping                          */
/* ------------------------------------------------------------------ */

/**
 * A pretend Modrinth: projects { id: { title, versions: [{ id, filename, body, dependencies }] } }
 * (newest version first). Stubs the API functions content.js uses and fetch for the file CDN.
 */
function fakeModrinth(t, projects) {
  const files = {};
  const versions = new Map();
  const state = { getProjectCalls: [], failProject: new Set() };
  for (const [pid, p] of Object.entries(projects)) {
    p.versions = p.versions.map((v) => {
      const body = Buffer.from(v.body || `${pid}:${v.id}`);
      const url = `https://cdn.modrinth.com/data/${pid}/${v.id}/${encodeURIComponent(v.filename)}`;
      files[url] = body;
      const full = {
        id: v.id,
        project_id: pid,
        version_number: v.id,
        version_type: "release",
        dependencies: v.dependencies || [],
        files: [{ primary: true, filename: v.filename, url, size: body.length, hashes: { sha1: sha1(body) } }],
      };
      versions.set(v.id, full);
      return full;
    });
  }
  state.fetches = serve(t, files);
  patch(t, modrinth, "getVersionsFromHashes", async () => ({}));
  patch(t, modrinth, "getProject", async (pid) => {
    state.getProjectCalls.push(pid);
    if (state.failProject.has(pid) || !projects[pid]) throw new Error(`Modrinth API GET /project/${pid} failed: 500`);
    return { id: pid, title: projects[pid].title, icon_url: null };
  });
  patch(t, modrinth, "getProjectVersions", async (pid) => projects[pid].versions);
  patch(t, modrinth, "getVersion", async (vid) => {
    if (!versions.has(vid)) throw new Error(`Modrinth API GET /version/${vid} failed: 404 not found`);
    return versions.get(vid);
  });
  patch(t, modrinth, "getVersions", async (ids) => ids.map((id) => versions.get(id)).filter(Boolean));
  state.version = (vid) => versions.get(vid);
  return state;
}

async function fabricInstance() {
  return { id: "t", loader: "fabric", mcVersion: "1.20.1", gameDir: await tmpDir("game") };
}

const required = (extra) => ({ dependency_type: "required", project_id: null, version_id: null, ...extra });

test("install: the main file is tracked even when a required dependency then fails", async (t) => {
  const inst = await fabricInstance();
  const api = fakeModrinth(t, {
    MAIN: { title: "Main", versions: [{ id: "m1", filename: "main-1.jar", dependencies: [required({ project_id: "DEP" })] }] },
    DEP: { title: "Dep", versions: [{ id: "d1", filename: "dep-1.jar" }] },
  });
  api.failProject.add("DEP");
  await assert.rejects(content.install(inst, { projectId: "MAIN", kind: "mod" }), /failed: 500/);
  assert.equal(await exists(path.join(inst.gameDir, "mods", "main-1.jar")), true);
  const manifest = await content.readManifest(inst.gameDir);
  assert.equal(manifest.files["mods/main-1.jar"].projectId, "MAIN", "the downloaded jar must not be left untracked");

  // trying again finishes the job without a second copy
  api.failProject.clear();
  const result = await content.install(inst, { projectId: "MAIN", kind: "mod" });
  assert.deepEqual(result.installed.map((i) => i.file).sort(), ["dep-1.jar", "main-1.jar"]);
  assert.deepEqual((await fsp.readdir(path.join(inst.gameDir, "mods"))).sort(), ["dep-1.jar", "main-1.jar"]);
});

test("install: two installs running together both end up in the manifest", async (t) => {
  const inst = await fabricInstance();
  fakeModrinth(t, {
    AAA: { title: "A", versions: [{ id: "a1", filename: "a.jar" }] },
    BBB: { title: "B", versions: [{ id: "b1", filename: "b.jar" }] },
    CCC: { title: "C", versions: [{ id: "c1", filename: "c.zip" }] },
  });
  await Promise.all([
    content.install(inst, { projectId: "AAA", kind: "mod" }),
    content.install(inst, { projectId: "BBB", kind: "mod" }),
    content.install(inst, { projectId: "CCC", kind: "resourcepack" }),
  ]);
  const manifest = await content.readManifest(inst.gameDir);
  assert.deepEqual(Object.keys(manifest.files).sort(), ["mods/a.jar", "mods/b.jar", "resourcepacks/c.zip"]);
  assert.deepEqual(await leftovers(path.join(inst.gameDir, ".reminth")), []);
});

test("install: a dependency deleted by hand is put back; a disabled one counts as there", async (t) => {
  const inst = await fabricInstance();
  fakeModrinth(t, {
    MAIN: { title: "Main", versions: [{ id: "m1", filename: "main-1.jar", dependencies: [required({ project_id: "DEP" })] }] },
    OTHER: { title: "Other", versions: [{ id: "o1", filename: "other-1.jar", dependencies: [required({ project_id: "DEP" })] }] },
    DEP: { title: "Dep", versions: [{ id: "d1", filename: "dep-1.jar" }] },
  });
  const mods = path.join(inst.gameDir, "mods");
  await content.install(inst, { projectId: "MAIN", kind: "mod" });
  await fsp.rm(path.join(mods, "dep-1.jar")); // the player deletes it; the manifest still lists it

  const again = await content.install(inst, { projectId: "OTHER", kind: "mod" });
  assert.deepEqual(again.installed.map((i) => i.file).sort(), ["dep-1.jar", "other-1.jar"]);
  assert.equal(await exists(path.join(mods, "dep-1.jar")), true);

  // disabled by the player: still installed, so it's neither re-downloaded nor re-enabled
  await fsp.rename(path.join(mods, "dep-1.jar"), path.join(mods, "dep-1.jar.disabled"));
  await fsp.rm(path.join(mods, "other-1.jar"));
  const third = await content.install(inst, { projectId: "OTHER", kind: "mod" });
  assert.deepEqual(third.installed.map((i) => i.file), ["other-1.jar"]);
  assert.deepEqual(third.skipped, ["DEP"]);
  assert.equal(await exists(path.join(mods, "dep-1.jar")), false);
});

test("install: a dependency given only as a version id is resolved and installed", async (t) => {
  const inst = await fabricInstance();
  fakeModrinth(t, {
    MAIN: {
      title: "Main",
      versions: [{ id: "m1", filename: "main-1.jar", dependencies: [required({ version_id: "lib-old" }), required({ version_id: "deleted-version" })] }],
    },
    LIB: { title: "Lib", versions: [{ id: "lib-new", filename: "lib-2.jar" }, { id: "lib-old", filename: "lib-1.jar" }] },
  });
  const result = await content.install(inst, { projectId: "MAIN", kind: "mod" });
  // the pinned version, not just whatever is newest
  assert.deepEqual(result.installed.map((i) => i.file).sort(), ["lib-1.jar", "main-1.jar"]);
  assert.deepEqual(result.skipped, ["deleted-version"]); // gone from Modrinth: reported, not fatal
  assert.equal((await content.readManifest(inst.gameDir)).files["mods/lib-1.jar"].projectId, "LIB");
});

test("install: a newer version replaces the old file only once it is in place, and no disabled twin is left", async (t) => {
  const inst = await fabricInstance();
  const projects = { MAIN: { title: "Main", versions: [{ id: "m1", filename: "main-1.jar" }] } };
  fakeModrinth(t, projects);
  const mods = path.join(inst.gameDir, "mods");
  await content.install(inst, { projectId: "MAIN", kind: "mod" });

  // a newer version appears, but its download is corrupt: the old one must survive
  const api = fakeModrinth(t, { MAIN: { title: "Main", versions: [{ id: "m2", filename: "main-2.jar" }, { id: "m1", filename: "main-1.jar" }] } });
  api.version("m2").files[0].hashes.sha1 = "0".repeat(40);
  await assert.rejects(content.install(inst, { projectId: "MAIN", kind: "mod" }), /Checksum mismatch/);
  assert.deepEqual(await fsp.readdir(mods), ["main-1.jar"]);
  assert.equal((await content.readManifest(inst.gameDir)).files["mods/main-1.jar"].versionId, "m1");

  // the player disables it, then installs the good new version
  await fsp.rename(path.join(mods, "main-1.jar"), path.join(mods, "main-1.jar.disabled"));
  fakeModrinth(t, { MAIN: { title: "Main", versions: [{ id: "m2", filename: "main-2.jar" }, { id: "m1", filename: "main-1.jar" }] } });
  await content.install(inst, { projectId: "MAIN", kind: "mod" });
  assert.deepEqual(await fsp.readdir(mods), ["main-2.jar"]);
  assert.deepEqual(Object.keys((await content.readManifest(inst.gameDir)).files), ["mods/main-2.jar"]);

  // reinstalling the same file name while a disabled copy of it exists leaves just one
  await fsp.copyFile(path.join(mods, "main-2.jar"), path.join(mods, "main-2.jar.disabled"));
  await content.install(inst, { projectId: "MAIN", kind: "mod", versionId: "m2" });
  assert.deepEqual(await fsp.readdir(mods), ["main-2.jar"]);
});

test("applyUpdates: re-checks the file on disk, keeps it disabled, leaves no duplicate, installs new dependencies", async (t) => {
  const inst = await fabricInstance();
  fakeModrinth(t, {
    MAIN: { title: "Main", versions: [{ id: "m1", filename: "main-1.jar" }] },
    PACK: { title: "Pack", versions: [{ id: "p1", filename: "pack-1.zip" }] },
  });
  const mods = path.join(inst.gameDir, "mods");
  await content.install(inst, { projectId: "MAIN", kind: "mod" });
  await content.install(inst, { projectId: "PACK", kind: "resourcepack" });

  const api = fakeModrinth(t, {
    MAIN: { title: "Main", versions: [{ id: "m2", filename: "main-2.jar", dependencies: [required({ project_id: "NEWLIB" })] }] },
    PACK: { title: "Pack", versions: [{ id: "p2", filename: "pack-2.zip" }] },
    NEWLIB: { title: "New Lib", versions: [{ id: "n1", filename: "newlib-1.jar" }] },
  });
  const next = (vid) => {
    const f = api.version(vid).files[0];
    return { versionId: vid, versionNumber: vid, url: f.url, sha1: f.hashes.sha1, filename: f.filename, size: f.size };
  };
  // The list was made while the mod was enabled; the player has disabled it since.
  await fsp.rename(path.join(mods, "main-1.jar"), path.join(mods, "main-1.jar.disabled"));
  const result = await content.applyUpdates(inst, [
    { kind: "mod", world: null, file: "main-1.jar", enabled: true, projectId: "MAIN", title: "Main", iconUrl: null, next: next("m2") },
    { kind: "resourcepack", world: null, file: "pack-1.zip", enabled: true, projectId: "PACK", title: "Pack", iconUrl: null, next: next("p2") },
    { kind: "mod", world: null, file: "vanished.jar", enabled: true, projectId: "GONE", title: "Gone", iconUrl: null, next: next("m2") },
  ]);
  assert.deepEqual(result.applied, ["Main", "Pack"]);
  assert.deepEqual(result.failed.map((f) => f.title), ["Gone"]);
  assert.deepEqual(result.added, ["New Lib"]);
  assert.deepEqual((await fsp.readdir(mods)).sort(), ["main-2.jar.disabled", "newlib-1.jar"]);
  assert.deepEqual(await fsp.readdir(path.join(inst.gameDir, "resourcepacks")), ["pack-2.zip"]);
  const manifest = await content.readManifest(inst.gameDir);
  assert.deepEqual(Object.keys(manifest.files).sort(), ["mods/main-2.jar", "mods/newlib-1.jar", "resourcepacks/pack-2.zip"]);
  assert.equal(manifest.files["mods/main-2.jar"].versionId, "m2");
});

/* ------------------------------------------------------------------ */
/* 10. creators cache                                                 */
/* ------------------------------------------------------------------ */

test("creators: a failed owner lookup isn't cached as 'no author'", async (t) => {
  const gameDir = await tmpDir("creators");
  await fsp.mkdir(path.join(gameDir, "mods"), { recursive: true });
  const jar = Buffer.from("not really a jar");
  await fsp.writeFile(path.join(gameDir, "mods", "thing.jar"), jar);
  const hash = sha1(jar);
  const cacheFile = path.join(paths.ROOT, "creators-cache.json");

  patch(t, modrinth, "getVersionsFromHashes", async () => ({ [hash]: { project_id: "PROJ", dependencies: [] } }));
  patch(t, modrinth, "getProjects", async () => [{ id: "PROJ", slug: "thing", title: "Thing", team: "TEAM", organization: null, categories: [], icon_url: null }]);
  patch(t, modrinth, "getOrganizations", async () => []);
  let teamCalls = 0;
  patch(t, modrinth, "getTeams", async () => {
    teamCalls++;
    throw new Error("Rate limit hit");
  });

  const first = await content.lookupCreators(gameDir);
  assert.equal(first["mod//thing.jar"].title, "Thing"); // what we did learn is still shown
  assert.equal(first["mod//thing.jar"].author, null);
  const saved = JSON.parse(await fsp.readFile(cacheFile, "utf8"));
  assert.equal(saved[hash], undefined, "a failed lookup must not be written to the week-long cache");
  assert.deepEqual(await leftovers(paths.ROOT), []);

  modrinth.getTeams = async () => {
    teamCalls++;
    return [[{ team_id: "TEAM", is_owner: true, user: { username: "alice", avatar_url: "https://cdn.modrinth.com/a.png" } }]];
  };
  const second = await content.lookupCreators(gameDir);
  assert.equal(teamCalls, 2, "asked again instead of trusting the failure");
  assert.equal(second["mod//thing.jar"].author, "alice");
  assert.equal(JSON.parse(await fsp.readFile(cacheFile, "utf8"))[hash].author, "alice");

  await content.lookupCreators(gameDir);
  assert.equal(teamCalls, 2, "a real answer is cached");
});

/* ------------------------------------------------------------------ */
/* 9. Modrinth retries                                                */
/* ------------------------------------------------------------------ */

/** fetch stub answering from a script of statuses / errors; records the waits between attempts. */
function scripted(t, script) {
  const waits = [];
  const previous = modrinth.setRetryDelay(async (ms) => void waits.push(ms));
  t.after(() => modrinth.setRetryDelay(previous));
  let calls = 0;
  patch(t, globalThis, "fetch", async (_url, init) => {
    assert.ok(init && init.signal instanceof AbortSignal, "every attempt carries a timeout signal");
    const step = script[Math.min(calls++, script.length - 1)];
    if (step instanceof Error) throw step;
    return new Response(JSON.stringify(step.body || { ok: true }), { status: step.status, headers: step.headers || {} });
  });
  return { waits, calls: () => calls };
}

test("modrinth: a 429 waits for Retry-After (capped), then succeeds", async (t) => {
  const s = scripted(t, [{ status: 429, headers: { "retry-after": "2" } }, { status: 429, headers: { "x-ratelimit-reset": "600" } }, { status: 200, body: { id: "P" } }]);
  assert.deepEqual(await modrinth.getProject("P"), { id: "P" });
  assert.equal(s.calls(), 3);
  assert.deepEqual(s.waits, [2000, 10000]);
});

test("modrinth: 5xx and network errors back off 0.5s then 1.5s; three strikes and it throws", async (t) => {
  const s = scripted(t, [{ status: 503 }, new TypeError("fetch failed"), { status: 200, body: [1] }]);
  assert.deepEqual(await modrinth.getProjects(["a"]), [1]);
  assert.deepEqual(s.waits, [500, 1500]);

  const down = scripted(t, [new TypeError("fetch failed")]);
  await assert.rejects(modrinth.getProject("P"), /Couldn't reach the catalog: fetch failed/);
  assert.equal(down.calls(), 3);

  const broken = scripted(t, [{ status: 500 }]);
  await assert.rejects(modrinth.getProject("P"), /failed: 500/);
  assert.equal(broken.calls(), 3);

  const limited = scripted(t, [{ status: 429 }]);
  await assert.rejects(modrinth.getProject("P"), /rate limit/i);
  assert.equal(limited.calls(), 3);
});

test("modrinth: other 4xx answers are not retried", async (t) => {
  const s = scripted(t, [{ status: 404 }]);
  await assert.rejects(modrinth.getProject("nope"), /failed: 404/);
  assert.equal(s.calls(), 1);
  assert.deepEqual(s.waits, []);
});

test("modrinth: rateLimitWaitMs reads seconds or a date, and never waits unreasonably", () => {
  const h = (o) => new Headers(o);
  assert.equal(modrinth.rateLimitWaitMs(h({ "retry-after": "3" })), 3000);
  assert.equal(modrinth.rateLimitWaitMs(h({ "x-ratelimit-reset": "1" })), 1000);
  assert.equal(modrinth.rateLimitWaitMs(h({ "retry-after": "9999" })), 10000);
  assert.equal(modrinth.rateLimitWaitMs(h({ "retry-after": "0" })), 250);
  assert.equal(modrinth.rateLimitWaitMs(h({})), 5000);
  const soon = modrinth.rateLimitWaitMs(h({ "retry-after": new Date(Date.now() + 4000).toUTCString() }));
  assert.ok(soon > 2000 && soon <= 5000, String(soon));
});

/* ------------------------------------------------------------------ */
/* 14 (+9). catalog cache                                             */
/* ------------------------------------------------------------------ */

test("catalogCache: a cache file that isn't a list is treated as empty; warming goes through the retrying client", async (t) => {
  await fsp.mkdir(paths.CATALOG_CACHE_DIR, { recursive: true });
  await fsp.writeFile(path.join(paths.CATALOG_CACHE_DIR, "mod.json"), '{"oops":true}');
  await fsp.writeFile(path.join(paths.CATALOG_CACHE_DIR, "shader.json"), "null");
  await fsp.writeFile(path.join(paths.CATALOG_CACHE_DIR, "status.json"), "[]");
  const catalogCache = require("../src/main/catalogCache");
  assert.deepEqual(catalogCache.getCached({ projectType: "mod", query: "x" }), { hits: [], total: 0 });
  assert.deepEqual(catalogCache.getBySlugs("shader", ["a"]), {});
  assert.equal(catalogCache.getWarmStatus("mod").state, "idle");

  const hit = { project_id: "P1", slug: "p1", title: "P1", downloads: 5 };
  const s = scripted(t, [{ status: 429, headers: { "retry-after": "1" } }, { status: 503 }, { status: 200, body: { hits: [hit], total_hits: 1 } }]);
  const status = await catalogCache.warmCatalog("mod", { targetCount: 100 });
  assert.equal(status.state, "done");
  assert.equal(s.calls(), 3);
  assert.deepEqual(s.waits, [1000, 1500]);
  assert.equal(catalogCache.getCached({ projectType: "mod" }).hits[0].id, "P1");
});

/* ------------------------------------------------------------------ */
/* 2. settings + account                                              */
/* ------------------------------------------------------------------ */

async function clearStore() {
  for (const name of await fsp.readdir(paths.ROOT).catch(() => [])) {
    if (/^(settings|account)\.json/.test(name)) await fsp.rm(path.join(paths.ROOT, name), { force: true });
  }
}
const rootFiles = async (prefix) => (await fsp.readdir(paths.ROOT)).filter((n) => n.startsWith(prefix)).sort();

test("settings: overlapping saves all stick, written atomically", async () => {
  await clearStore();
  await Promise.all([
    store.saveSettings({ accent: "violet" }),
    store.saveSettings({ fullscreen: true }),
    store.saveSettings({ maxMemoryMb: 4096 }),
    store.saveSettings({ streamer: { fps: 30 } }),
  ]);
  const s = await store.loadSettings();
  assert.equal(s.accent, "violet");
  assert.equal(s.fullscreen, true);
  assert.equal(s.maxMemoryMb, 4096);
  assert.equal(s.streamer.fps, 30);
  assert.deepEqual(await rootFiles("settings.json"), ["settings.json", "settings.json.bak"]);
  // a rejected save doesn't jam the queue
  await assert.rejects(store.saveSettings({ extraJvmArgs: "-Xmx8G" }), /RAM slider/);
  assert.equal((await store.saveSettings({ accent: "rose" })).accent, "rose");
});

test("settings: a corrupt file is moved aside and the last good copy used - defaults never overwrite it", async () => {
  await clearStore();
  await store.saveSettings({ accent: "emerald", maxMemoryMb: 6000 });
  await fsp.writeFile(paths.SETTINGS_FILE, '{"accent": "eme'); // truncated mid-write by a crash

  const loaded = await store.loadSettings();
  assert.equal(loaded.accent, "emerald");
  assert.equal(loaded.maxMemoryMb, 6000);
  let files = await rootFiles("settings.json");
  const aside = files.find((n) => n.startsWith("settings.json.corrupt-"));
  assert.ok(aside, "the unreadable file is kept, not overwritten");
  assert.equal(await fsp.readFile(path.join(paths.ROOT, aside), "utf8"), '{"accent": "eme');

  // the next save builds on the recovered settings, not on defaults
  const saved = await store.saveSettings({ fullscreen: true });
  assert.equal(saved.accent, "emerald");
  assert.equal(JSON.parse(await fsp.readFile(paths.SETTINGS_FILE, "utf8")).maxMemoryMb, 6000);

  // corrupt with no backup at all: defaults, but the bad file still survives on disk
  await clearStore();
  await fsp.mkdir(paths.ROOT, { recursive: true });
  await fsp.writeFile(paths.SETTINGS_FILE, "");
  assert.deepEqual(await store.loadSettings(), store.DEFAULT_SETTINGS);
  await store.saveSettings({ accent: "sky" });
  files = await rootFiles("settings.json");
  assert.equal(files.filter((n) => n.includes(".corrupt-")).length, 1);
  assert.equal((await store.loadSettings()).accent, "sky");
});

test("settings: a file that can't be read is never overwritten with defaults", async (t) => {
  await clearStore();
  await store.saveSettings({ accent: "amber" });
  const realRead = fsp.readFile;
  patch(t, fsp, "readFile", async (file, ...rest) => {
    if (file === paths.SETTINGS_FILE) throw Object.assign(new Error("EBUSY: locked"), { code: "EBUSY" });
    return realRead(file, ...rest);
  });
  assert.deepEqual(await store.loadSettings(), store.DEFAULT_SETTINGS); // launch still works
  await assert.rejects(store.saveSettings({ fullscreen: true }), /EBUSY/);
  fsp.readFile = realRead;
  assert.equal((await store.loadSettings()).accent, "amber");
  assert.deepEqual((await rootFiles("settings.json")).filter((n) => n.includes("corrupt")), []);
});

test("account: atomic save, fallback to the backup when damaged, sign-out removes every copy", async () => {
  await clearStore();
  safeStorage.available = true;
  try {
    await store.saveAccount({ name: "Steve", refreshToken: "r1" });
    assert.equal((await fsp.readFile(paths.ACCOUNTS_FILE))[0], 0x01, "stored encrypted");
    assert.deepEqual(await store.loadAccount(), { name: "Steve", refreshToken: "r1" });

    await fsp.writeFile(paths.ACCOUNTS_FILE, Buffer.alloc(0)); // truncated by a crash
    assert.deepEqual(await store.loadAccount(), { name: "Steve", refreshToken: "r1" }, "still signed in, from the backup");
    assert.equal((await rootFiles("account.json.corrupt-")).length, 1);
    assert.deepEqual(await store.loadAccount(), { name: "Steve", refreshToken: "r1" }); // and again, with the main file gone

    // encrypted file but the key store isn't up yet: says nothing about the file - leave it alone
    await store.saveAccount({ name: "Steve", refreshToken: "r2" });
    safeStorage.available = false;
    assert.equal(await store.loadAccount(), null);
    safeStorage.available = true;
    assert.equal((await rootFiles("account.json.corrupt-")).length, 1, "not quarantined");
    assert.equal((await store.loadAccount()).refreshToken, "r2");

    await store.clearAccount();
    assert.deepEqual(await rootFiles("account.json"), [], "no token left behind in a backup or a moved-aside copy");
    assert.equal(await store.loadAccount(), null);
  } finally {
    safeStorage.available = false;
  }
  // No encryption available: the tokens are never written in the clear -
  // the sign-in simply lasts for this session only.
  assert.deepEqual(await store.saveAccount({ name: "Alex", refreshToken: "secret" }), { persisted: false });
  assert.deepEqual(await rootFiles("account.json"), []);
  assert.equal(await store.loadAccount(), null);
  await store.clearAccount();
});

/* ------------------------------------------------------------------ */
/* 3 + 4. instance registry                                           */
/* ------------------------------------------------------------------ */

/** instances.js with nothing cached, on an empty registry - like a fresh app start. */
async function freshInstances({ wipe = true } = {}) {
  if (wipe) {
    await fsp.rm(paths.INSTANCES_DIR, { recursive: true, force: true });
    for (const name of await fsp.readdir(paths.ROOT).catch(() => [])) {
      if (name.startsWith("instances.json")) await fsp.rm(path.join(paths.ROOT, name), { force: true });
    }
  }
  delete require.cache[require.resolve("../src/main/instances")];
  return require("../src/main/instances");
}
const registryOnDisk = async () => JSON.parse(await fsp.readFile(paths.INSTANCES_FILE, "utf8"));

/** A gzipped level.dat holding just Data.Version.Name. */
function levelDat(versionName) {
  const str = (s) => Buffer.concat([Buffer.from([0, Buffer.byteLength(s)]), Buffer.from(s)]);
  const compound = (name) => Buffer.concat([Buffer.from([10]), str(name)]);
  const end = Buffer.from([0]);
  return zlib.gzipSync(Buffer.concat([compound(""), compound("Data"), compound("Version"), Buffer.from([8]), str("Name"), str(versionName), end, end, end]));
}

test("instances: overlapping creates/updates all survive, with a .bak and no temp files", async () => {
  let instances = await freshInstances();
  const made = await Promise.all(Array.from({ length: 8 }, (_, i) => instances.create({ name: `Pack ${i}`, mcVersion: "1.20.1", loader: "fabric" })));
  await Promise.all(made.map((m, i) => instances.update(m.id, { name: `Renamed ${i}` })));
  await Promise.all([instances.recordSession(made[0].id, 0, 1000), instances.recordSession(made[0].id, 0, 500)]);

  const disk = await registryOnDisk();
  assert.equal(disk.length, 9); // + the built-in one
  assert.deepEqual(disk.slice(1).map((i) => i.name).sort(), made.map((_, i) => `Renamed ${i}`));
  assert.equal(disk.find((i) => i.id === made[0].id).playTimeMs, 1500, "both sessions counted");
  assert.deepEqual(JSON.parse(await fsp.readFile(paths.INSTANCES_FILE + ".bak", "utf8")), disk);
  assert.deepEqual(await leftovers(paths.ROOT), []);

  instances = await freshInstances({ wipe: false }); // restart: same list
  assert.equal((await instances.list()).length, 9);
});

test("instances: a failed write doesn't leave the launcher believing in an unsaved registry", async (t) => {
  const instances = await freshInstances();
  await instances.create({ name: "Kept", mcVersion: "1.20.1" });
  const realRename = fsp.rename;
  patch(t, fsp, "rename", async () => {
    throw Object.assign(new Error("ENOSPC: disk full"), { code: "ENOSPC" });
  });
  await assert.rejects(instances.create({ name: "Lost", mcVersion: "1.20.1" }), /ENOSPC/);
  fsp.rename = realRename;
  assert.deepEqual((await instances.list()).map((i) => i.name), ["Reminth", "Kept"]);
  assert.deepEqual((await registryOnDisk()).map((i) => i.name), ["Reminth", "Kept"]);
});

test("instances: a corrupt registry is recovered from its .bak plus the folders on disk, never replaced by defaults", async () => {
  let instances = await freshInstances();
  const a = await instances.create({ name: "Alpha", mcVersion: "1.19.2", loader: "forge", loaderVersion: "43.3.0" });
  const b = await instances.create({ name: "Beta", mcVersion: "1.21.1", loader: "fabric" });
  await instances.update(b.id, { playTimeMs: 4200 });
  await fsp.writeFile(path.join(b.gameDir, "options.txt"), "x");

  // The backup is one write behind (it doesn't know Beta) and the registry is cut short.
  await fsp.writeFile(paths.INSTANCES_FILE + ".bak", JSON.stringify((await registryOnDisk()).filter((i) => i.id !== b.id)));
  await fsp.writeFile(paths.INSTANCES_FILE, '[{"id":"remi');

  instances = await freshInstances({ wipe: false });
  const list = await instances.list();
  assert.deepEqual(list.map((i) => i.id).sort(), ["reminth", a.id, b.id].sort());
  const beta = list.find((i) => i.id === b.id);
  assert.equal(beta.name, "Beta"); // exact, from the copy kept inside its own folder
  assert.equal(beta.mcVersion, "1.21.1");
  assert.equal(beta.playTimeMs, 4200);
  assert.equal(list.find((i) => i.id === a.id).loaderVersion, "43.3.0");

  // repaired on disk straight away, and the broken file kept for a look
  assert.equal((await registryOnDisk()).length, 3);
  const aside = (await fsp.readdir(paths.ROOT)).filter((n) => n.startsWith("instances.json.corrupt-"));
  assert.equal(aside.length, 1);
  assert.equal(await fsp.readFile(path.join(paths.ROOT, aside[0]), "utf8"), '[{"id":"remi');

  // and the next change keeps everyone
  await instances.create({ name: "Gamma", mcVersion: "1.20.1" });
  assert.equal((await registryOnDisk()).length, 4);
});

test("instances: with no registry and no backup, folders are rebuilt conservatively", async () => {
  let instances = await freshInstances();
  const dir = (id) => path.join(paths.INSTANCES_DIR, id);

  // made by an older Reminth: no instance.json inside. Fabric mods + a 1.20.4 world.
  await fsp.mkdir(path.join(dir("old-pack-a1b2"), "mods"), { recursive: true });
  await fsp.mkdir(path.join(dir("old-pack-a1b2"), "saves", "World"), { recursive: true });
  await fsp.writeFile(path.join(dir("old-pack-a1b2"), "saves", "World", "level.dat"), levelDat("1.20.4"));
  const jarSrc = await tmpDir("jar");
  await fsp.writeFile(path.join(jarSrc, "fabric.mod.json"), '{"id":"x"}');
  await zip.buildZip(jarSrc, path.join(dir("old-pack-a1b2"), "mods", "x.jar"));

  // nothing to go on but the game's own options file
  await fsp.mkdir(path.join(dir("plain-00ff"), "config"), { recursive: true });
  await fsp.writeFile(path.join(dir("plain-00ff"), "options.txt"), "x");
  // a folder the player keeps here that isn't a game folder: adopting it
  // would let "delete instance" wipe it
  await fsp.mkdir(path.join(dir("backups-00ff"), "config"), { recursive: true });
  // a damaged instance.json falls back to guessing rather than being skipped
  await fsp.mkdir(path.join(dir("damaged-1234"), ".reminth"), { recursive: true });
  await fsp.writeFile(path.join(dir("damaged-1234"), ".reminth", "instance.json"), "{nope");
  // not instances: empty, a name Reminth never generates, a stray file, the built-in id
  await fsp.mkdir(dir("empty-0000"), { recursive: true });
  await fsp.mkdir(path.join(dir("Not An Instance"), "mods"), { recursive: true });
  await fsp.mkdir(path.join(dir("reminth"), "mods"), { recursive: true });
  await fsp.writeFile(path.join(paths.INSTANCES_DIR, "notes.txt"), "hi");

  for (const corrupt of [null, "{}", "not json"]) {
    for (const name of await fsp.readdir(paths.ROOT)) if (name.startsWith("instances.json")) await fsp.rm(path.join(paths.ROOT, name));
    if (corrupt !== null) await fsp.writeFile(paths.INSTANCES_FILE, corrupt);
    instances = await freshInstances({ wipe: false });
    const list = await instances.list();
    assert.equal(list[0].id, "reminth");
    assert.deepEqual(list.map((i) => i.id).sort(), ["damaged-1234", "old-pack-a1b2", "plain-00ff", "reminth"], `registry was ${corrupt}`);
    const old = list.find((i) => i.id === "old-pack-a1b2");
    assert.equal(old.name, "old pack (recovered)");
    assert.equal(old.mcVersion, "1.20.4");
    assert.equal(old.loader, "fabric");
    assert.equal(old.gameDir, dir("old-pack-a1b2"));
    const plain = list.find((i) => i.id === "plain-00ff");
    assert.equal(plain.loader, "vanilla");
    assert.ok(instances.isValidVersionId(plain.mcVersion));
    assert.equal(list[0].managed, true);
    assert.equal((await registryOnDisk()).length, 4, "the rebuilt registry is saved");
  }
});

test("instances: a first run (nothing on disk) is just the built-in instance and writes nothing", async () => {
  const instances = await freshInstances();
  assert.deepEqual((await instances.list()).map((i) => i.id), ["reminth"]);
  assert.equal(await exists(paths.INSTANCES_FILE), false);
});

test("instances: remove deletes the folder with retries; if it can't, the instance stays listed", async (t) => {
  const instances = await freshInstances();
  const inst = await instances.create({ name: "Doomed", mcVersion: "1.20.1" });
  await fsp.writeFile(path.join(inst.gameDir, "options.txt"), "x");

  const realRm = fsp.rm;
  let options = null;
  patch(t, fsp, "rm", async (target, opts) => {
    if (path.resolve(target) !== path.resolve(inst.gameDir)) return realRm(target, opts);
    options = opts;
    throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
  });
  await assert.rejects(instances.remove(inst.id), /Couldn't delete Doomed — close Minecraft and any open folder windows, then try again\./);
  assert.ok(options.recursive && options.maxRetries >= 5 && options.retryDelay >= 100, "retries ride out short Windows locks");
  assert.ok((await instances.list()).some((i) => i.id === inst.id), "still in the launcher, not orphaned");
  assert.ok((await registryOnDisk()).some((i) => i.id === inst.id));
  assert.equal(await exists(inst.gameDir), true);

  fsp.rm = realRm; // whatever held it lets go
  assert.deepEqual(await instances.remove(inst.id), { ok: true });
  assert.equal(await exists(inst.gameDir), false);
  assert.ok(!(await registryOnDisk()).some((i) => i.id === inst.id));
  assert.deepEqual(await instances.remove(inst.id), { ok: true }); // already gone is fine
  await assert.rejects(instances.remove("reminth"), /can't be deleted/);
});

test("brand accent: old settings (default cyan) show the brand orange once; a pick made after that sticks", async () => {
  const fsp = require("fs").promises;
  const paths = require("../src/main/paths");
  await fsp.mkdir(paths.ROOT, { recursive: true });
  await fsp.writeFile(paths.SETTINGS_FILE, JSON.stringify({ accent: "cyan", maxMemoryMb: 4096 }));
  assert.equal((await store.loadSettings()).accent, "ember");
  // a different old pick is the player's own and stays
  await fsp.writeFile(paths.SETTINGS_FILE, JSON.stringify({ accent: "violet" }));
  assert.equal((await store.loadSettings()).accent, "violet");
  // choosing cyan on purpose (accentChosen) keeps cyan
  await fsp.writeFile(paths.SETTINGS_FILE, JSON.stringify({ accent: "cyan", accentChosen: true }));
  assert.equal((await store.loadSettings()).accent, "cyan");
  const saved = await store.saveSettings({ accent: "cyan", accentChosen: true });
  assert.equal(saved.accent, "cyan");
  assert.equal(saved.accentChosen, true);
  assert.equal((await store.loadSettings()).accent, "cyan");
  // no file at all: the default is the brand orange
  await fsp.rm(paths.SETTINGS_FILE, { force: true });
  await fsp.rm(`${paths.SETTINGS_FILE}.bak`, { force: true });
  assert.equal((await store.loadSettings()).accent, "ember");
});
