"use strict";
/**
 * Regression tests for the main-process fixes: the account session
 * (sign-in / sign-out / refresh races), the server ping's never-rejects
 * contract, the saved-skins library and the streamer's game-window matcher.
 * No Electron, no internet - the ping tests talk to a server on 127.0.0.1.
 * Run with: node --test test/fixes-main.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");

// streamer.js pulls in electron - stub it (same trick as features.test.js).
const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return "STUB_ELECTRON_FIXES_MAIN";
  return originalResolve.call(this, request, ...rest);
};
Module._cache.STUB_ELECTRON_FIXES_MAIN = {
  id: "STUB_ELECTRON_FIXES_MAIN",
  filename: "STUB_ELECTRON_FIXES_MAIN",
  loaded: true,
  exports: { safeStorage: { isEncryptionAvailable: () => false } },
};

const msAuth = require("../src/main/msAuth");
const serverPing = require("../src/main/serverPing");
const paths = require("../src/main/paths");
const skinLibrary = require("../src/main/skinLibrary");
const streamer = require("../src/main/streamer");

const HOUR = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

/** A promise plus its resolve/reject, for holding a fake request open. */
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const account = (over = {}) => ({
  minecraftAccessToken: "mc-token",
  minecraftAccessTokenExpiresAt: NOW + 12 * HOUR,
  msRefreshToken: "refresh-1",
  uuid: "u1",
  username: "Steve",
  ...over,
});

/** A session wired to fakes that record what was saved/cleared. */
function fakeSession(over = {}) {
  const calls = { refresh: 0, signIn: 0, saved: [], cleared: 0, log: [] };
  const session = msAuth.createSession({
    signIn: async () => {
      calls.signIn++;
      return account({ username: "Fresh" });
    },
    refresh: async () => {
      calls.refresh++;
      return account({ username: "Refreshed", msRefreshToken: "refresh-2" });
    },
    save: async (a) => {
      calls.saved.push(a);
    },
    clear: async () => {
      calls.cleared++;
    },
    log: (line) => calls.log.push(line),
    now: () => NOW,
    ...over,
  });
  return { session, calls };
}

/* ---------------- auth: pure decisions ---------------- */

test("auth: a token with plenty of time left isn't refreshed", () => {
  assert.equal(msAuth.needsRefresh(account(), NOW), false);
});

test("auth: refresh when the token is missing, expired, or within 5 minutes of expiry", () => {
  assert.equal(msAuth.needsRefresh(null, NOW), true);
  assert.equal(msAuth.needsRefresh(account({ minecraftAccessToken: "" }), NOW), true);
  assert.equal(msAuth.needsRefresh(account({ minecraftAccessTokenExpiresAt: NOW - 1 }), NOW), true);
  assert.equal(msAuth.needsRefresh(account({ minecraftAccessTokenExpiresAt: NOW + 4 * 60 * 1000 }), NOW), true);
  assert.equal(msAuth.needsRefresh(account({ minecraftAccessTokenExpiresAt: NOW + 6 * 60 * 1000 }), NOW), false);
});

test("auth: an account saved without an expiry (older build) is refreshed", () => {
  const old = account();
  delete old.minecraftAccessTokenExpiresAt;
  assert.equal(msAuth.needsRefresh(old, NOW), true);
  assert.equal(msAuth.needsRefresh(account({ minecraftAccessTokenExpiresAt: "soon" }), NOW), true);
});

test("auth: a rejected refresh token always means 'sign in again'", () => {
  const rejected = Object.assign(new Error("nope"), { code: "AUTH_REJECTED" });
  // even when the Minecraft token itself still has hours left
  const verdict = msAuth.refreshFailure(account(), rejected, NOW);
  assert.equal(verdict.proceed, false);
  assert.equal(verdict.code, "AUTH_EXPIRED");
  assert.equal(verdict.message, "Your Microsoft sign-in has expired — sign in again.");
});

test("auth: a network failure carries on only while the token is still valid", () => {
  const offline = new TypeError("fetch failed");
  assert.equal(msAuth.refreshFailure(account({ minecraftAccessTokenExpiresAt: NOW + 60 * 1000 }), offline, NOW).proceed, true);
  const dead = msAuth.refreshFailure(account({ minecraftAccessTokenExpiresAt: NOW - 1 }), offline, NOW);
  assert.equal(dead.proceed, false);
  assert.equal(dead.code, "AUTH_UNREACHABLE");
  const noExpiry = account();
  delete noExpiry.minecraftAccessTokenExpiresAt;
  assert.equal(msAuth.refreshFailure(noExpiry, offline, NOW).proceed, false);
});

test("auth: only invalid_grant counts as Microsoft rejecting the refresh token", () => {
  assert.equal(msAuth.isRejectedStatus(400, "invalid_grant"), true);
  // A bare 400/401 (a proxy's error page, a mangled reply) says nothing
  // about the token - it used to sign the player out.
  assert.equal(msAuth.isRejectedStatus(400, ""), false);
  assert.equal(msAuth.isRejectedStatus(401, ""), false);
  assert.equal(msAuth.isRejectedStatus(400, "invalid_request"), false);
  assert.equal(msAuth.isRejectedStatus(500, ""), false);
  assert.equal(msAuth.isRejectedStatus(503, "temporarily_unavailable"), false);
  // The Xbox / Minecraft steps: an outright 401, nothing else.
  assert.equal(msAuth.isRejectedStatus(401, "", "chain"), true);
  assert.equal(msAuth.isRejectedStatus(400, "", "chain"), false);
  assert.equal(msAuth.isRejectedStatus(403, "", "chain"), false);
  assert.equal(msAuth.isRejectedStatus(429, "", "chain"), false);
  assert.equal(msAuth.isRejectedStatus(503, "", "chain"), false);
});

test("auth: the device-code poll deadline follows expires_in, defaulting to 15 minutes", () => {
  assert.equal(msAuth.pollDeadline(1000, 600), 1000 + 600 * 1000);
  assert.equal(msAuth.pollDeadline(1000, undefined), 1000 + 900 * 1000);
  assert.equal(msAuth.pollDeadline(1000, -5), 1000 + 900 * 1000);
});

/* ---------------- auth: the session ---------------- */

test("session: fresh() doesn't touch the network while the token is good", async () => {
  const { session, calls } = fakeSession();
  session.restore(account());
  assert.equal((await session.fresh()).username, "Steve");
  assert.equal(calls.refresh, 0);
});

test("session: fresh() without an account says to sign in", async () => {
  const { session } = fakeSession();
  await assert.rejects(session.fresh(), /Sign in first/);
});

test("session: concurrent fresh() calls share one refresh", async () => {
  const gate = deferred();
  const { session, calls } = fakeSession({
    refresh: async () => {
      calls.refresh++;
      await gate.promise;
      return account({ username: "Refreshed" });
    },
  });
  session.restore(account({ minecraftAccessTokenExpiresAt: NOW - 1 }));
  const both = Promise.all([session.fresh(), session.fresh(), session.fresh()]);
  gate.resolve();
  const results = await both;
  assert.equal(calls.refresh, 1);
  assert.deepEqual(results.map((a) => a.username), ["Refreshed", "Refreshed", "Refreshed"]);
  assert.equal(calls.saved.length, 1);
});

test("session: a refresh that lands after Sign out doesn't sign the player back in", async () => {
  const gate = deferred();
  const { session, calls } = fakeSession({
    refresh: async () => {
      await gate.promise;
      return account({ username: "Refreshed" });
    },
  });
  session.restore(account({ minecraftAccessTokenExpiresAt: NOW - 1 }));
  const pending = session.fresh();
  await session.signOut();
  gate.resolve();
  await assert.rejects(pending, /Sign in first/);
  assert.equal(session.current(), null);
  assert.equal(calls.saved.length, 0, "nothing may be written back to account.json");
  assert.equal(calls.cleared, 1);
});

test("session: a rejected refresh token surfaces a clear error instead of a stale account", async () => {
  const { session } = fakeSession({
    refresh: async () => {
      throw Object.assign(new Error("Refresh token expired"), { code: "AUTH_REJECTED" });
    },
  });
  // The Minecraft token is still inside its 24h, but about to be refreshed.
  session.restore(account({ minecraftAccessTokenExpiresAt: NOW + 60 * 1000 }));
  await assert.rejects(session.fresh(), (err) => {
    assert.equal(err.message, msAuth.EXPIRED_MESSAGE);
    assert.equal(err.code, "AUTH_EXPIRED");
    return true;
  });
});

test("session: offline with a still-valid token carries on; with an expired one it doesn't", async () => {
  const offline = { refresh: async () => Promise.reject(new TypeError("fetch failed")) };
  const a = fakeSession(offline);
  a.session.restore(account({ minecraftAccessTokenExpiresAt: NOW + 60 * 1000 }));
  assert.equal((await a.session.fresh()).username, "Steve");
  assert.equal(a.calls.log.length, 1, "the failure is still logged");

  const b = fakeSession(offline);
  b.session.restore(account({ minecraftAccessTokenExpiresAt: NOW - 1 }));
  await assert.rejects(b.session.fresh(), (err) => err.code === "AUTH_UNREACHABLE");
});

test("session: a failed refresh isn't cached - the next call tries again", async () => {
  let fail = true;
  const { session, calls } = fakeSession({
    refresh: async () => {
      calls.refresh++;
      if (fail) throw new TypeError("fetch failed");
      return account({ username: "Refreshed" });
    },
  });
  session.restore(account({ minecraftAccessTokenExpiresAt: NOW - 1 }));
  await assert.rejects(session.fresh());
  fail = false;
  assert.equal((await session.fresh()).username, "Refreshed");
  assert.equal(calls.refresh, 2);
});

test("session: a double-clicked Sign in runs one device-code flow", async () => {
  const gate = deferred();
  const { session, calls } = fakeSession({
    signIn: async () => {
      calls.signIn++;
      await gate.promise;
      return account({ username: "Fresh" });
    },
  });
  const first = session.signIn();
  const second = session.signIn();
  gate.resolve();
  assert.equal((await first).username, "Fresh");
  assert.equal((await second).username, "Fresh");
  assert.equal(calls.signIn, 1);
  assert.equal(calls.saved.length, 1);
  assert.equal(session.current().username, "Fresh");
});

test("session: signing out while the device code is pending cancels that sign-in", async () => {
  const gate = deferred();
  let cancelled = null;
  const { session, calls } = fakeSession({
    signIn: async ({ isCancelled }) => {
      cancelled = isCancelled;
      await gate.promise;
      return account({ username: "Fresh" });
    },
  });
  const pending = session.signIn();
  await Promise.resolve();
  assert.equal(cancelled(), false);
  await session.signOut();
  assert.equal(cancelled(), true, "the poll loop is told to stop");
  gate.resolve();
  await assert.rejects(pending, /cancelled/);
  assert.equal(session.current(), null);
  assert.equal(calls.saved.length, 0);
});

test("session: a refresh of the old account can't overwrite a new sign-in", async () => {
  const gate = deferred();
  const { session, calls } = fakeSession({
    refresh: async () => {
      await gate.promise;
      return account({ username: "OldRefreshed" });
    },
  });
  session.restore(account({ minecraftAccessTokenExpiresAt: NOW - 1 }));
  const pending = session.fresh();
  await session.signIn();
  gate.resolve();
  assert.equal((await pending).username, "Fresh");
  assert.equal(session.current().username, "Fresh");
  assert.deepEqual(calls.saved.map((a) => a.username), ["Fresh"]);
});

test("session: restore() never replaces an account signed in before the disk read finished", async () => {
  const { session } = fakeSession();
  await session.signIn();
  session.restore(account({ username: "FromDisk" }));
  assert.equal(session.current().username, "Fresh");
});

/* ---------------- server ping ---------------- */

test("serverPing: ports outside 1-65535 aren't addresses", () => {
  assert.equal(serverPing.parseAddress("play.x.net:99999"), null);
  assert.equal(serverPing.parseAddress("play.x.net:0"), null);
  assert.equal(serverPing.parseAddress("[::1]:70000"), null);
  assert.deepEqual(serverPing.parseAddress("play.x.net:65535"), { host: "play.x.net", port: 65535, explicitPort: true });
  assert.equal(serverPing.isValidPort(25565), true);
  assert.equal(serverPing.isValidPort(25565.5), false);
});

test("serverPing: a bad address resolves offline instead of rejecting", async () => {
  assert.deepEqual(await serverPing.ping("play.x.net:99999"), { online: false, error: "Invalid address" });
  assert.deepEqual(await serverPing.ping("not a host!"), { online: false, error: "Invalid address" });
  assert.deepEqual(await serverPing.ping(""), { online: false, error: "Invalid address" });
});

test("serverPing: status JSON exposes the server's version name and protocol", () => {
  const s = serverPing.statusFromJson({ version: { name: "Paper 1.21.4", protocol: 769 }, players: { online: 3, max: 20 } }, 12);
  assert.deepEqual(s, { online: true, latencyMs: 12, playersOnline: 3, playersMax: 20, version: "Paper 1.21.4", versionName: "Paper 1.21.4", protocol: 769 });
  const bare = serverPing.statusFromJson({}, 5);
  assert.equal(bare.versionName, null);
  assert.equal(bare.protocol, null);
  assert.equal(bare.playersOnline, null);
  assert.equal(serverPing.statusFromJson({ version: { name: 7, protocol: "x" } }, 5).protocol, null);
});

function listen(onConnection) {
  return new Promise((resolve) => {
    const server = net.createServer(onConnection);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function varint(n) {
  const out = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return Buffer.from(out);
}

test("serverPing: a real status reply is read end to end", async () => {
  const json = Buffer.from(JSON.stringify({ version: { name: "1.21.4", protocol: 769 }, players: { online: 1, max: 10 } }));
  const server = await listen((socket) => {
    socket.on("error", () => {});
    socket.once("data", () => {
      const body = Buffer.concat([varint(0), varint(json.length), json]);
      socket.write(Buffer.concat([varint(body.length), body]));
    });
  });
  try {
    const r = await serverPing.ping(`127.0.0.1:${server.address().port}`);
    assert.equal(r.online, true);
    assert.equal(r.versionName, "1.21.4");
    assert.equal(r.protocol, 769);
    assert.equal(r.playersOnline, 1);
  } finally {
    server.close();
  }
});

test("serverPing: a server that accepts and hangs up is offline right away, not after the timeout", async () => {
  const server = await listen((socket) => {
    socket.on("error", () => {});
    socket.end();
  });
  try {
    const started = Date.now();
    const r = await serverPing.ping(`127.0.0.1:${server.address().port}`);
    assert.equal(r.online, false);
    assert.ok(Date.now() - started < 2000, "resolved long before the 3.5s timeout");
  } finally {
    server.close();
  }
});

/* ---------------- saved skins ---------------- */

/** The smallest thing validateSkinPng accepts: a PNG header saying 64x64. */
function fakeSkin(seed) {
  const buf = Buffer.alloc(40);
  buf.writeUInt32BE(0x89504e47, 0);
  buf.writeUInt32BE(0x0d0a1a0a, 4);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(64, 16);
  buf.writeUInt32BE(64, 20);
  buf.writeUInt32BE(seed, 32);
  return buf;
}

async function withLibrary(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reminth-skins-"));
  const original = paths.SKIN_LIBRARY_DIR;
  paths.SKIN_LIBRARY_DIR = dir;
  try {
    await fn(dir);
  } finally {
    paths.SKIN_LIBRARY_DIR = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("skinLibrary: re-saving a skin whose PNG was deleted brings the image back", async () => {
  await withLibrary(async (dir) => {
    const png = fakeSkin(1);
    const entry = await skinLibrary.add({ png, name: "One" });
    const file = path.join(dir, `${entry.id}.png`);
    fs.rmSync(file);
    await skinLibrary.add({ png, name: "One" });
    assert.ok(fs.existsSync(file));
    assert.deepEqual(fs.readFileSync(file), png);
    assert.equal((await skinLibrary.list()).length, 1);
  });
});

test("skinLibrary: list() drops entries whose image is gone from the index too", async () => {
  await withLibrary(async (dir) => {
    const a = await skinLibrary.add({ png: fakeSkin(1), name: "A" });
    const b = await skinLibrary.add({ png: fakeSkin(2), name: "B" });
    fs.rmSync(path.join(dir, `${a.id}.png`));
    const listed = await skinLibrary.list();
    assert.deepEqual(listed.map((e) => e.id), [b.id]);
    const index = JSON.parse(fs.readFileSync(path.join(dir, "library.json"), "utf8"));
    assert.deepEqual(index.map((e) => e.id), [b.id]);
  });
});

test("skinLibrary: saves fired at the same time all end up in the index", async () => {
  await withLibrary(async (dir) => {
    const seeds = Array.from({ length: 12 }, (_, i) => i + 1);
    await Promise.all(seeds.map((n) => skinLibrary.add({ png: fakeSkin(n), name: `Skin ${n}` })));
    const index = JSON.parse(fs.readFileSync(path.join(dir, "library.json"), "utf8"));
    assert.equal(index.length, seeds.length);
    assert.equal((await skinLibrary.list()).length, seeds.length);
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")), [], "no temp files left behind");
  });
});

test("skinLibrary: a failed change doesn't block the ones after it", async () => {
  await withLibrary(async () => {
    await assert.rejects(skinLibrary.add({ png: Buffer.from("not a png") }));
    await assert.rejects(skinLibrary.remove("../../etc/passwd"), /Unknown skin/);
    const entry = await skinLibrary.add({ png: fakeSkin(9), name: "Nine" });
    assert.equal((await skinLibrary.rename(entry.id, "Renamed")).name, "Renamed");
    assert.deepEqual(await skinLibrary.remove(entry.id), { ok: true });
    assert.deepEqual(await skinLibrary.list(), []);
  });
});

/* ---------------- streamer: which window is the game ---------------- */

test("streamer: real game window titles are recognised", () => {
  for (const title of [
    "Minecraft 1.21.4",
    "Minecraft* 1.21.4",
    "Minecraft 1.8.9",
    "Minecraft 26.1",
    "Minecraft 24w14a",
    "Minecraft 1.21.4 - Singleplayer",
    "Minecraft* 1.21.4 - Multiplayer",
    "Minecraft* 1.20.1 - Multiplayer (3rd-party Server)",
    "Minecraft 1.21-pre1 - Multiplayer (LAN)",
    // spelled-out pre-releases, release candidates and snapshots
    "Minecraft 1.21 Pre-Release 1",
    "Minecraft 1.21.5 Release Candidate 1",
    "Minecraft 26.1 Snapshot 1",
    "Minecraft 26.1 Snapshot 1 - Singleplayer",
    // Forge and NeoForge put their name in the title
    "Minecraft Forge* 1.20.1",
    "Minecraft NeoForge* 1.21.1 - Multiplayer (3rd-party Server)",
    "Minecraft NeoForge 1.21.1",
    // very old versions say nothing else
    "Minecraft",
  ]) {
    assert.equal(streamer.isGameWindowTitle(title), true, title);
  }
});

test("streamer: browser tabs, folders and launchers that merely say Minecraft are not the game", () => {
  for (const title of [
    "Minecraft Wiki",
    "Minecraft Forge Downloads",
    "Minecraft - File Explorer",
    "Minecraft - Google Chrome",
    "Minecraft 1.21.4 | Minecraft Wiki — Mozilla Firefox",
    "Minecraft 1.21.4 - Minecraft Wiki - Microsoft\u200b Edge", // Edge really does put a zero-width space there
    "Minecraft 1.21 Pre-Release 1 – Minecraft Wiki - Opera GX",
    "Minecraft 1.21 Trailer - YouTube",
    "Minecraft 1.21.4 - Brave",
    "Minecraft 1.21 notes.txt - Notepad",
    "Minecraft Wiki - Google Chrome",
    "Minecraft Wiki – The Ultimate Resource — Mozilla Firefox",
    "Minecraft 1.21.4 - Minecraft Wiki - Google Chrome",
    "Minecraft 1.21 Tricky Trials Update - YouTube - Microsoft Edge",
    "Minecraft 1.21.4 - File Explorer",
    "Minecraft Launcher",
    "Minecraft 2 Launcher",
    "Minecraft: Java Edition",
    "minecraft-server.jar - Notepad",
    "",
    null,
  ]) {
    assert.equal(streamer.isGameWindowTitle(title), false, String(title));
  }
});

test("streamer: a window that names its version is picked before a bare 'Minecraft'", () => {
  const src = (name) => ({ id: name, name });
  const pick = (names) => {
    const got = streamer.pickGameSource(names.map(src));
    return got ? got.name : null;
  };
  // some other window merely called "Minecraft" must not win over the real game
  assert.equal(pick(["Minecraft", "Reminth", "Minecraft* 1.21.4 - Singleplayer"]), "Minecraft* 1.21.4 - Singleplayer");
  assert.equal(pick(["Minecraft", "Minecraft Forge* 1.20.1"]), "Minecraft Forge* 1.20.1");
  // an old version, titled just "Minecraft", is still found when it's all there is
  assert.equal(pick(["Reminth", "Minecraft Launcher", "Minecraft"]), "Minecraft");
  assert.equal(pick(["Minecraft Wiki - Google Chrome", "Minecraft - File Explorer"]), null);
  assert.equal(pick([]), null);
  assert.equal(streamer.pickGameSource(null), null);
});
