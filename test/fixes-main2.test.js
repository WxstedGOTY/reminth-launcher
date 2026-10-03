"use strict";
/**
 * Regression tests for the second round of main-process fixes: an expired
 * sign-in is forgotten (and only a real rejection counts as one), the
 * server ping reads bare IPv6 addresses, the RAM ceiling, the copy-to-
 * version switch for the performance pack - and main.js itself (the Play /
 * Stop races, start-up order, the instance IPC), loaded against a fake
 * Electron. No Electron, no internet, nothing written outside a temp folder.
 * Run with: node --test test/fixes-main2.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");

// paths.js hangs everything off the home folder: point it at a temp one
// BEFORE anything is required, so main.js's logs land there.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "reminth-main2-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

/* ---------------- a fake Electron, enough for main.js to load ---------------- */

const ipc = new Map(); // channel -> handler
const sent = []; // [channel, payload] pushed to the renderer
let appReady;
const whenReady = new Promise((resolve) => (appReady = resolve));
let lastWindow = null;

class FakeWebContents extends EventEmitter {
  send(channel, payload) {
    sent.push([channel, payload]);
  }
  setWindowOpenHandler() {}
  getURL() {
    return "";
  }
}
class FakeWindow extends EventEmitter {
  constructor() {
    super();
    this.webContents = new FakeWebContents();
    lastWindow = this;
  }
  loadFile() {
    // The page finishes loading straight away - sooner than anything main
    // awaits afterwards.
    setImmediate(() => {
      this.pageLoaded = true;
      this.webContents.emit("did-finish-load");
    });
    return Promise.resolve();
  }
  isDestroyed() {
    return false;
  }
  isMinimized() {
    return false;
  }
  isMaximized() {
    return false;
  }
  maximize() {}
  unmaximize() {}
  minimize() {}
  restore() {}
  show() {}
  focus() {}
  close() {}
}
const noop = () => {};
const fakeElectron = {
  app: { requestSingleInstanceLock: () => true, on: noop, quit: noop, whenReady: () => whenReady, getVersion: () => "0.0.0-test", disableHardwareAcceleration: noop },
  BrowserWindow: FakeWindow,
  ipcMain: { handle: (channel, fn) => ipc.set(channel, fn), on: noop },
  shell: { openExternal: noop, openPath: async () => "", trashItem: async () => {} },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
  safeStorage: { isEncryptionAvailable: () => false },
  desktopCapturer: { getSources: async () => [] },
  globalShortcut: { register: () => true, unregisterAll: noop, unregister: noop },
  Notification: class {
    static isSupported() {
      return false;
    }
    show() {}
  },
};
const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return "STUB_ELECTRON_FIXES_MAIN2";
  return originalResolve.call(this, request, ...rest);
};
Module._cache.STUB_ELECTRON_FIXES_MAIN2 = { id: "STUB_ELECTRON_FIXES_MAIN2", filename: "STUB_ELECTRON_FIXES_MAIN2", loaded: true, exports: fakeElectron };

const msAuth = require("../src/main/msAuth");
const serverPing = require("../src/main/serverPing");
const entitlements = require("../src/main/entitlements");
const migrate = require("../src/main/migrate");
const compat = require("../src/main/compat");
const store = require("../src/main/store");
const instances = require("../src/main/instances");
const minecraft = require("../src/main/minecraft");
const streamer = require("../src/main/streamer");
const updater = require("../src/main/updater");
const content = require("../src/main/content");
const logs = require("../src/main/logs");
const catalogCache = require("../src/main/catalogCache");

const HOUR = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
/** Waits (a moment at a time, 2s at most) for something done off real file reads. */
async function until(condition) {
  for (let i = 0; i < 400 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
}

const account = (over = {}) => ({
  minecraftAccessToken: "mc-token",
  minecraftAccessTokenExpiresAt: NOW + 12 * HOUR,
  msRefreshToken: "refresh-1",
  uuid: "u1",
  username: "Steve",
  ...over,
});

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

/* ---------------- msAuth: an expired sign-in is forgotten ---------------- */

test("session: a sign-in Microsoft rejected is cleared from memory and disk", async () => {
  const { session, calls } = fakeSession({
    refresh: async () => {
      throw Object.assign(new Error("Refresh token expired"), { code: "AUTH_REJECTED" });
    },
  });
  session.restore(account({ minecraftAccessTokenExpiresAt: NOW + 60 * 1000 }));
  await assert.rejects(session.fresh(), (err) => err.code === "AUTH_EXPIRED" && err.message === msAuth.EXPIRED_MESSAGE);
  // It used to stay "signed in" here - and after a restart, from disk.
  assert.equal(session.current(), null);
  await tick();
  assert.equal(calls.cleared, 1);
  assert.deepEqual(calls.saved, []);
  await assert.rejects(session.fresh(), /Sign in first/);
  // signing in again works as usual
  const again = await session.signIn();
  assert.equal(again.username, "Fresh");
  assert.equal(session.current().username, "Fresh");
  assert.equal(calls.saved.length, 1);
});

test("session: a clear that fails after an expired sign-in is logged, not thrown", async () => {
  const { session, calls } = fakeSession({
    refresh: async () => {
      throw Object.assign(new Error("Refresh token expired"), { code: "AUTH_REJECTED" });
    },
    clear: async () => {
      throw new Error("EPERM: account.json is locked");
    },
  });
  session.restore(account({ minecraftAccessToken: null }));
  await assert.rejects(session.fresh(), (err) => err.code === "AUTH_EXPIRED");
  await tick();
  assert.equal(session.current(), null);
  assert.ok(calls.log.some((l) => /clearing the expired session failed: EPERM/.test(l)), calls.log.join(" | "));
});

test("session: a passing failure never wipes a good account", async () => {
  for (const failure of [new Error("fetch failed"), Object.assign(new Error("Microsoft's sign-in service returned 400."), { status: 400 }), Object.assign(new Error("Xbox Live auth failed: 503"), { status: 503 })]) {
    // token expired -> can't be used right now, but the account is kept for the next try
    const { session, calls } = fakeSession({
      refresh: async () => {
        throw failure;
      },
    });
    const saved = account({ minecraftAccessTokenExpiresAt: NOW - HOUR });
    session.restore(saved);
    await assert.rejects(session.fresh(), (err) => err.code === "AUTH_UNREACHABLE");
    await tick();
    assert.equal(session.current(), saved, failure.message);
    assert.equal(calls.cleared, 0, failure.message);
  }
});

test("session: sign-in still succeeds when saving the account fails", async () => {
  const { session, calls } = fakeSession({
    save: async () => {
      throw new Error("ENOSPC: disk full");
    },
  });
  const signedIn = await session.signIn(); // used to reject while main was already signed in
  assert.equal(signedIn.username, "Fresh");
  assert.equal(session.current().username, "Fresh");
  assert.ok(calls.log.some((l) => /saving the new session failed: ENOSPC/.test(l)));
  // and the session carries on working
  assert.equal((await session.fresh()).username, "Fresh");
});

/* ---------------- msAuth.refreshSession against a fake network ---------------- */

/** Runs `fn` with fetch answering from `routes` ({ "host/path fragment": () => Response }). */
async function withFetch(routes, fn) {
  const real = global.fetch;
  const seen = [];
  global.fetch = async (url) => {
    seen.push(String(url));
    for (const [fragment, reply] of Object.entries(routes)) if (String(url).includes(fragment)) return reply();
    throw new Error("unexpected request: " + url);
  };
  try {
    return await fn(seen);
  } finally {
    global.fetch = real;
  }
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const goodChain = {
  "user.auth.xboxlive.com": () => json({ Token: "xbl", DisplayClaims: { xui: [{ uhs: "hash" }] } }),
  "xsts.auth.xboxlive.com": () => json({ Token: "xsts", DisplayClaims: { xui: [{ uhs: "hash" }] } }),
  "login_with_xbox": () => json({ access_token: "mc-new", expires_in: 86400 }),
  "entitlements/mcstore": () => json({ items: [{ name: "game_minecraft" }] }),
  "minecraft/profile": () => json({ id: "u1", name: "Steve" }),
};

test("refreshSession: a reply without a new refresh token keeps the one that was used", async () => {
  const kept = await withFetch({ "oauth2/v2.0/token": () => json({ access_token: "ms" }), ...goodChain }, () => msAuth.refreshSession("refresh-old"));
  assert.equal(kept.msRefreshToken, "refresh-old"); // was undefined: the account read as expired next time
  assert.equal(kept.minecraftAccessToken, "mc-new");
  const rotated = await withFetch({ "oauth2/v2.0/token": () => json({ access_token: "ms", refresh_token: "refresh-new" }), ...goodChain }, () => msAuth.refreshSession("refresh-old"));
  assert.equal(rotated.msRefreshToken, "refresh-new");
});

test("refreshSession: only invalid_grant (or a 401 from Xbox/Minecraft) means 'sign in again'", async () => {
  const codeOf = async (routes) => {
    try {
      await withFetch(routes, () => msAuth.refreshSession("refresh-old"));
    } catch (err) {
      return err.code || null;
    }
    return "no error";
  };
  assert.equal(await codeOf({ "oauth2/v2.0/token": () => json({ error: "invalid_grant" }, 400) }), "AUTH_REJECTED");
  // these used to sign the player out
  assert.equal(await codeOf({ "oauth2/v2.0/token": () => new Response("<html>Bad Request</html>", { status: 400 }) }), null);
  assert.equal(await codeOf({ "oauth2/v2.0/token": () => json({ error: "invalid_request" }, 400) }), null);
  assert.equal(await codeOf({ "oauth2/v2.0/token": () => new Response("", { status: 401 }) }), null);
  assert.equal(await codeOf({ "oauth2/v2.0/token": () => json({ error: "temporarily_unavailable" }, 503) }), null);
  // further down the chain
  const token = { "oauth2/v2.0/token": () => json({ access_token: "ms", refresh_token: "r2" }) };
  assert.equal(await codeOf({ ...token, ...goodChain, "user.auth.xboxlive.com": () => new Response("", { status: 401 }) }), "AUTH_REJECTED");
  assert.equal(await codeOf({ ...token, ...goodChain, "login_with_xbox": () => new Response("nope", { status: 401 }) }), "AUTH_REJECTED");
  assert.equal(await codeOf({ ...token, ...goodChain, "user.auth.xboxlive.com": () => new Response("busy", { status: 503 }) }), null);
  assert.equal(await codeOf({ ...token, ...goodChain, "login_with_xbox": () => new Response("slow down", { status: 429 }) }), null);
  assert.equal(await codeOf({ ...token, ...goodChain, "login_with_xbox": () => new Response("Invalid app registration", { status: 403 }) }), null);
  // the named Xbox problems keep their own message and don't sign anyone out
  assert.equal(await codeOf({ ...token, ...goodChain, "xsts.auth.xboxlive.com": () => json({ XErr: 2148916233 }, 401) }), null);
});

/* ---------------- serverPing / entitlements / migrate ---------------- */

test("serverPing: a bare IPv6 address is an address", () => {
  assert.deepEqual(serverPing.parseAddress("::1"), { host: "::1", port: 25565, explicitPort: false });
  assert.deepEqual(serverPing.parseAddress(" 2001:db8::1 "), { host: "2001:db8::1", port: 25565, explicitPort: false });
  // the bracketed form, names and IPv4 are read as before
  assert.deepEqual(serverPing.parseAddress("[2001:db8::1]:25570"), { host: "2001:db8::1", port: 25570, explicitPort: true });
  assert.deepEqual(serverPing.parseAddress("play.x.net:25570"), { host: "play.x.net", port: 25570, explicitPort: true });
  assert.deepEqual(serverPing.parseAddress("10.0.0.2"), { host: "10.0.0.2", port: 25565, explicitPort: false });
  assert.equal(serverPing.parseAddress("not:an:address"), null);
});

test("entitlements: RAM goes up to 16 GB where the PC can spare it", () => {
  const GB = 1024 ** 3;
  assert.equal(entitlements.MAX_USEFUL_RAM_MB, 16384);
  assert.equal(entitlements.ramCapMb(2 * GB), 1024);
  assert.equal(entitlements.ramCapMb(4 * GB), 2048);
  assert.equal(entitlements.ramCapMb(8 * GB), 6144);
  assert.equal(entitlements.ramCapMb(16 * GB), 14336); // 16 GB minus the 2 GB kept for the system
  assert.equal(entitlements.ramCapMb(32 * GB), 16384);
  assert.equal(entitlements.ramCapMb(64 * GB), 16384);
  assert.equal(entitlements.ramCapMb(12.3 * GB) % 512, 0);
});

test("copyToVersion: a switched-off performance pack stays off in the copy", async () => {
  const made = [];
  const tools = {
    createInstance: async (fields) => {
      made.push(fields);
      return { id: "new" + made.length, ...fields, gameDir: path.join(HOME, "copy" + made.length) };
    },
    listMods: async () => ({ mods: [], unknown: [] }),
    readManifest: async () => ({ files: {} }),
    install: async () => {},
  };
  const source = { id: "s", name: "Mine", loader: "fabric", hud: false, gameDir: path.join(HOME, "nope"), mcVersion: "1.21.4" };
  await migrate.copyToVersion({ ...source, performanceMods: false }, { mcVersion: "1.21.1" }, tools, null);
  assert.equal(made[0].performanceMods, false);
  await migrate.copyToVersion(source, { mcVersion: "1.21.1" }, tools, null);
  assert.equal("performanceMods" in made[1], false, "on is the default - nothing to pass");
  await migrate.copyToVersion({ ...source, performanceMods: true }, { mcVersion: "1.21.1" }, tools, null);
  assert.equal("performanceMods" in made[2], false);
});

/* ---------------- main.js itself, against the fake Electron ---------------- */

// Everything main.js would reach outside this process for, swapped out.
const SAVED = { ...account({ minecraftAccessTokenExpiresAt: Date.now() + 12 * HOUR }) };
const accountRead = deferred();
store.loadAccount = () => accountRead.promise;
const started = { configure: 0, updater: 0, watch: 0, gameStarted: 0, gameStopped: 0 };
streamer.init = noop;
streamer.configure = () => {
  started.configure++;
  return { hotkeyProblems: [] };
};
streamer.gameStarted = () => started.gameStarted++;
streamer.gameStopped = () => started.gameStopped++;
streamer.shutdown = noop;
updater.init = () => started.updater++;
content.watchInstance = async () => {
  started.watch++;
};
logs.importInstanceLogs = async () => {};
catalogCache.getWarmStatus = () => ({ state: "done", updated_at: Date.now() });

const INSTANCE = { id: "i1", name: "Test", gameDir: path.join(HOME, "i1"), mcVersion: "1.21.4", loader: "vanilla", loaderVersion: null };
let updates = [];
let creates = [];
let recorded = 0;
instances.list = async () => [INSTANCE];
instances.get = async () => INSTANCE;
instances.require = async () => INSTANCE;
instances.recordSession = async () => {
  recorded++;
};
instances.update = async (id, patch) => {
  updates.push(patch);
  return { ...INSTANCE, ...patch };
};
instances.create = async (fields) => {
  creates.push(fields);
  return { id: "made", ...fields };
};
let install = deferred();
let installs = 0;
const launched = []; // { child, onCrash }
minecraft.ensureInstalled = () => {
  installs++;
  return install.promise;
};
minecraft.launch = (_result, _account, onCrash, settings, _inst, options) => {
  const child = new EventEmitter();
  child.pid = 4000 + launched.length;
  child.kill = noop;
  launched.push({ child, onCrash, settings, options });
  return child;
};

require("../src/main/main");
const call = (channel, ...args) => ipc.get(channel)({}, ...args);
const isRunning = async () => (await call("instances:list"))[0].running;
const count = (channel) => sent.filter(([c]) => c === channel).length;

test("main: start-up work still runs when the page loads before the account is read", async () => {
  appReady();
  // Let the window be made and its page "finish loading" while the account
  // read is still pending.
  await until(() => lastWindow && lastWindow.pageLoaded);
  assert.ok(lastWindow && lastWindow.pageLoaded, "the window was created and its page loaded");
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(started.configure, 0);
  accountRead.resolve(SAVED);
  await until(() => started.updater);
  // These used to never happen: the listeners were added after the event.
  assert.equal(started.configure, 1, "hotkeys / streamer configured");
  assert.equal(started.watch, 1, "content watcher started");
  assert.equal(started.updater, 1, "updater started");
  assert.deepEqual(sent.find(([c]) => c === "auth:restored"), ["auth:restored", { username: "Steve" }]);
  assert.deepEqual(await call("auth:current"), { username: "Steve" });
});

test("main: Stop while installing cancels that launch - a second Play starts ONE game", async () => {
  const first = call("play:run", { instanceId: "i1" });
  await tick();
  assert.equal(await isRunning(), true);
  await assert.rejects(call("play:run", { instanceId: "i1" }), /already running/);
  assert.deepEqual(await call("play:stop", { instanceId: "i1" }), { stopped: true, wasRunning: true });
  assert.equal(await isRunning(), false);
  const second = call("play:run", { instanceId: "i1" }); // joins the install still in flight
  await tick();
  install.resolve({ removedMods: [] });
  assert.deepEqual(await first, { launched: false, cancelled: true });
  assert.deepEqual(await second, { launched: true });
  assert.equal(launched.length, 1, "the stopped launch must not start the game as well");
  assert.equal(installs, 1);
  assert.equal(await isRunning(), true);
  assert.equal(started.gameStarted, 1);
  // tidy up: the game closes
  launched[0].child.emit("exit", 0, null);
  assert.equal(await isRunning(), false);
  assert.equal(started.gameStopped, 1);
});

test("main: the old game's late exit doesn't end the session of a new Play", async () => {
  install = deferred();
  install.resolve({ removedMods: [] });
  const before = launched.length;
  const recordedBefore = recorded;
  assert.deepEqual(await call("play:run", { instanceId: "i1" }), { launched: true });
  const old = launched[before];
  await call("play:stop", { instanceId: "i1" });
  const exitedAfterStop = count("play:exited");
  const crashedAfterStop = count("play:crashed");
  assert.deepEqual(await call("play:run", { instanceId: "i1" }), { launched: true });
  const fresh = launched[before + 1];
  // The killed process reports in late - as an exit, an error and a "crash".
  old.child.emit("exit", 1, null);
  old.child.emit("error", new Error("late"));
  old.onCrash({ code: 1, signal: null, error: null, logPath: "x" });
  assert.equal(await isRunning(), true, "the new session was deleted by the old game's exit");
  assert.equal(count("play:exited"), exitedAfterStop);
  assert.equal(count("play:crashed"), crashedAfterStop);
  await assert.rejects(call("play:run", { instanceId: "i1" }), /already running/);
  // The new game's own exit still ends it, once.
  fresh.child.emit("exit", 0, null);
  fresh.child.emit("exit", 0, null);
  assert.equal(await isRunning(), false);
  assert.equal(count("play:exited"), exitedAfterStop + 1);
  assert.equal(recorded, recordedBefore + 2, "one play session recorded per game");
});

test("main: a launch that fails after Stop + Play doesn't unclaim the new launch", async () => {
  install = deferred();
  const first = call("play:run", { instanceId: "i1" });
  await tick();
  await call("play:stop", { instanceId: "i1" });
  const second = call("play:run", { instanceId: "i1" });
  await tick();
  install.reject(new Error("download failed"));
  await assert.rejects(first, /download failed/);
  await assert.rejects(second, /download failed/);
  assert.equal(await isRunning(), false);
});

/* ---------------- safe-mode relaunch ---------------- */

/** What the real launch() does when the JVM refuses its arguments: a log, a crash report, then the exit. */
function jvmRefuses(game, logText, over = {}) {
  const logPath = path.join(HOME, `refused-${game.child.pid}.txt`);
  fs.writeFileSync(logPath, logText);
  game.onCrash({ code: 1, signal: null, error: null, logPath, elapsedMs: 400, safeMode: Boolean(game.options.safeMode), ...over });
  game.child.emit("exit", 1, null);
}
const TWO_COLLECTORS = "Error occurred during initialization of VM\nMultiple garbage collectors selected\n";

test("main: a JVM that refuses its arguments is started ONCE more in safe mode, and the player is told", async () => {
  install = deferred();
  install.resolve({ removedMods: [] });
  const before = launched.length;
  const marks = { started: count("play:started"), exited: count("play:exited"), crashed: count("play:crashed"), safe: count("play:safeMode") };
  const streamed = { ...started };
  assert.deepEqual(await call("play:run", { instanceId: "i1" }), { launched: true });
  const first = launched[before];
  assert.equal(first.options.safeMode, false);

  jvmRefuses(first, TWO_COLLECTORS);
  assert.equal(launched.length, before + 2, "exactly one relaunch");
  const second = launched[before + 1];
  assert.equal(second.options.safeMode, true, "relaunched with the minimal flags");
  assert.equal(second.settings.maxMemoryMb, first.settings.maxMemoryMb, "not a heap error - memory unchanged");
  assert.deepEqual(sent.filter(([c]) => c === "play:safeMode").at(-1), ["play:safeMode", { instanceId: "i1", reason: "Multiple garbage collectors selected" }]);
  assert.equal(count("play:safeMode"), marks.safe + 1);
  // Still one session: Play stays claimed, nothing was reported as over.
  assert.equal(await isRunning(), true);
  await assert.rejects(call("play:run", { instanceId: "i1" }), /already running/);
  assert.equal(count("play:crashed"), marks.crashed);
  assert.equal(count("play:exited"), marks.exited);
  assert.equal(count("play:started"), marks.started + 1);
  assert.equal(started.gameStarted, streamed.gameStarted + 1);
  // The refused process reporting in again changes nothing.
  first.child.emit("exit", 1, null);
  first.onCrash({ code: 1, signal: null, error: null, logPath: path.join(HOME, `refused-${first.child.pid}.txt`), elapsedMs: 500 });
  assert.equal(launched.length, before + 2);
  assert.equal(await isRunning(), true);

  // Safe mode refused as well: that is a crash. Never a third start.
  jvmRefuses(second, TWO_COLLECTORS);
  assert.equal(launched.length, before + 2, "one retry per Play");
  assert.equal(count("play:crashed"), marks.crashed + 1);
  assert.equal(count("play:exited"), marks.exited + 1);
  assert.equal(count("play:safeMode"), marks.safe + 1);
  assert.equal(await isRunning(), false, "Play is free again");
  assert.equal(started.gameStopped, streamed.gameStopped + 1);
});

test("main: the safe-mode game is the one Stop stops, and its normal exit ends the session once", async () => {
  const before = launched.length;
  const exited = count("play:exited");
  assert.deepEqual(await call("play:run", { instanceId: "i1" }), { launched: true });
  // Windows could not hand over the heap: the retry asks for 2 GB at most.
  jvmRefuses(launched[before], "Error occurred during initialization of VM\nCould not reserve enough space for 6291456KB object heap\n");
  assert.equal(launched.length, before + 2);
  const safe = launched[before + 1];
  assert.ok(safe.settings.maxMemoryMb <= 2048, `safe mode asked for ${safe.settings.maxMemoryMb} MB`);
  let killed = 0;
  safe.child.kill = () => killed++;
  assert.deepEqual(await call("play:stop", { instanceId: "i1" }), { stopped: true, wasRunning: true });
  assert.equal(killed, 1, "Stop kills the process the session is on now");
  assert.equal(await isRunning(), false);
  safe.child.emit("exit", 1, null);
  assert.equal(count("play:exited"), exited + 1);
  assert.equal(launched.length, before + 2);
});

test("main: Stop before the refused JVM reports in - no relaunch", async () => {
  const before = launched.length;
  const safeBefore = count("play:safeMode");
  assert.deepEqual(await call("play:run", { instanceId: "i1" }), { launched: true });
  await call("play:stop", { instanceId: "i1" });
  jvmRefuses(launched[before], TWO_COLLECTORS);
  assert.equal(launched.length, before + 1, "a stopped game must not come back in safe mode");
  assert.equal(count("play:safeMode"), safeBefore);
  assert.equal(await isRunning(), false);
});

test("main: an ordinary early crash is reported as a crash, not retried", async () => {
  const before = launched.length;
  const crashed = count("play:crashed");
  assert.deepEqual(await call("play:run", { instanceId: "i1" }), { launched: true });
  // a mod blew up; the JVM itself was fine
  jvmRefuses(launched[before], "Exception in thread \"main\" java.lang.RuntimeException: Mixin failed\n");
  assert.equal(launched.length, before + 1);
  assert.equal(count("play:crashed"), crashed + 1);
  assert.equal(await isRunning(), false);
  // ...and neither is a refusal that took too long to be the JVM's start-up
  assert.deepEqual(await call("play:run", { instanceId: "i1" }), { launched: true });
  jvmRefuses(launched[before + 1], TWO_COLLECTORS, { elapsedMs: 12000 });
  assert.equal(launched.length, before + 2);
  assert.equal(await isRunning(), false);
});

test("main: perf:info and perf:gpuHelp", async () => {
  const info = await call("perf:info", "i1");
  assert.equal(info.totalMemMb, Math.floor(os.totalmem() / 1024 ** 2));
  assert.equal(info.cpuCount, os.cpus().length);
  assert.equal(info.ramCapMb, entitlements.ramCapMb());
  assert.equal(typeof info.windowsBuild, "number");
  assert.equal(info.defaultMemoryMb, minecraft.computeDefaultMaxMemoryMb(os.totalmem(), { capMb: entitlements.ramCapMb() }));
  assert.ok(info.defaultMemoryMb <= info.ramCapMb);

  // Only runtimes Reminth installed itself, and only ones that are really there.
  const paths = require("../src/main/paths");
  const real = path.join(paths.RUNTIMES_DIR, "java-runtime-delta", "bin", "javaw.exe");
  fs.mkdirSync(path.dirname(real), { recursive: true });
  fs.writeFileSync(real, "");
  fs.mkdirSync(path.join(paths.RUNTIMES_DIR, "half-installed", "bin"), { recursive: true });
  const openedUrls = [];
  fakeElectron.shell.openExternal = async (url) => openedUrls.push(url);
  try {
    const help = await call("perf:gpuHelp");
    assert.deepEqual(help.javaPaths, [real]);
    assert.deepEqual(openedUrls, ["ms-settings:display-advancedgraphics"]);
  } finally {
    fakeElectron.shell.openExternal = noop;
  }
});

test("main: instances:update / create carry the performance-pack switch and reset the compat cache", async () => {
  const invalidated = [];
  const realInvalidate = compat.invalidate;
  compat.invalidate = (id) => invalidated.push(id);
  try {
    updates = [];
    await call("instances:update", "i1", { performanceMods: false });
    assert.deepEqual(updates[0], { performanceMods: false });
    await call("instances:update", "i1", { performanceMods: true, name: "Renamed" });
    assert.deepEqual(updates[1], { performanceMods: true, name: "Renamed" });
    // only a real true/false gets through
    await call("instances:update", "i1", { performanceMods: "no" });
    assert.deepEqual(updates[2], {});
    assert.deepEqual(invalidated, ["i1", "i1", "i1"]);
    creates = [];
    await call("instances:create", { name: "A", mcVersion: "1.21.4", loader: "vanilla", performanceMods: false });
    assert.equal(creates[0].performanceMods, false);
    await call("instances:create", { name: "B", mcVersion: "1.21.4", loader: "vanilla" });
    assert.equal(creates[1].performanceMods, undefined, "on unless switched off");
  } finally {
    compat.invalidate = realInvalidate;
  }
});
