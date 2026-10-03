"use strict";
/**
 * Tests for the launcher's own updates (src/main/updater.js): the states the
 * Settings button shows, the quiet automatic checks (first after 10 s, then
 * every 6 hours, with the timers injected), "not packaged", offline errors,
 * and that a running game is never interrupted.
 * electron and electron-updater are fakes; no network.
 * Run with: node --test test/updater.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const os = require("os");
const fs = require("fs");
const path = require("path");

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "reminth-updater-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return "STUB_ELECTRON_UPDATER";
  return originalResolve.call(this, request, ...rest);
};
Module._cache.STUB_ELECTRON_UPDATER = { id: "STUB_ELECTRON_UPDATER", filename: "STUB_ELECTRON_UPDATER", loaded: true, exports: { app: { isPackaged: false, getVersion: () => "1.3.0", on() {} } } };

const updater = require("../src/main/updater");

/** A fake autoUpdater: `script` decides what each checkForUpdates() does. */
class FakeAutoUpdater extends EventEmitter {
  constructor(script) {
    super();
    this.script = script;
    this.checks = 0;
    this.installs = 0;
  }
  async checkForUpdates() {
    this.checks++;
    this.emit("checking-for-update");
    return this.script(this);
  }
  quitAndInstall(isSilent, isForceRunAfter) {
    this.installs++;
    this.installArgs = [isSilent, isForceRunAfter];
  }
}

function fakeTimers() {
  const timeouts = [];
  const intervals = [];
  return {
    timeouts,
    intervals,
    setTimeout: (fn, ms) => (timeouts.push({ fn, ms }), timeouts.length),
    setInterval: (fn, ms) => (intervals.push({ fn, ms }), 1000 + intervals.length),
    clearTimeout() {},
    clearInterval() {},
  };
}

function setup({ script, packaged = true, gameRunning = () => false, loadFails = false } = {}) {
  const sent = [];
  const logs = [];
  const app = new EventEmitter();
  app.isPackaged = packaged;
  app.getVersion = () => "1.3.0";
  const au = new FakeAutoUpdater(script || (async () => null));
  const timers = fakeTimers();
  const u = updater.createUpdater({
    app,
    loadUpdater: () => {
      if (loadFails) throw new Error("no module");
      return au;
    },
    notify: (channel, payload) => sent.push([channel, payload]),
    isGameRunning: gameRunning,
    log: (line) => logs.push(line),
    timers,
  });
  return { u, au, app, timers, sent, logs, states: () => sent.map(([, p]) => p.state) };
}

const upToDate = async (au) => {
  au.emit("update-not-available", { version: "1.3.0" });
  return {};
};
const newVersion = async (au) => {
  au.emit("update-available", { version: "1.4.0" });
  au.emit("download-progress", { percent: 41.7 });
  au.emit("download-progress", { percent: 41.9 }); // same whole percent: not sent again
  au.emit("download-progress", { percent: 100 });
  au.emit("update-downloaded", { version: "1.4.0" });
  return {};
};
const offline = async () => {
  throw new Error("net::ERR_INTERNET_DISCONNECTED");
};

test("manual check, nothing new: Checking -> up to date (1.3.0)", async () => {
  const { u, au, states } = setup({ script: upToDate });
  u.start();
  const r = await u.check();
  assert.equal(r.state, "up-to-date");
  assert.equal(r.version, "1.3.0");
  assert.equal(r.currentVersion, "1.3.0");
  assert.equal(au.checks, 1);
  assert.deepEqual(states(), ["checking", "checking", "up-to-date"]);
});

test("up to date names the RUNNING version: feed equal, feed older, feed missing", async () => {
  for (const [label, info, feedVersion] of [
    ["feed equal", { version: "1.3.0" }, "1.3.0"],
    ["feed older (only an old release published)", { version: "1.1.1" }, "1.1.1"],
    ["feed missing", null, null],
    ["feed without a version", {}, null],
  ]) {
    const { u, sent } = setup({
      script: async (au) => {
        au.emit("update-not-available", info);
        return {};
      },
    });
    u.start();
    const r = await u.check();
    assert.equal(r.state, "up-to-date", label);
    assert.equal(r.version, "1.3.0", label);
    assert.equal(r.currentVersion, "1.3.0", label);
    assert.equal(r.feedVersion, feedVersion, label);
    const told = sent.filter(([, p]) => p.state === "up-to-date").map(([, p]) => p.version);
    assert.deepEqual(told, ["1.3.0"], label);
  }
});

test("feed newer: downloading names the NEW version, the running one stays currentVersion", async () => {
  const { u, sent } = setup({
    script: async (au) => {
      au.emit("update-available", { version: "1.4.0" });
      return {};
    },
  });
  u.start();
  const r = await u.check();
  assert.deepEqual([r.state, r.version, r.currentVersion], ["downloading", "1.4.0", "1.3.0"]);
  assert.ok(!sent.some(([, p]) => p.state === "up-to-date"));
});

test("manual check, new version: downloading with progress, then ready", async () => {
  const { u, sent } = setup({ script: newVersion });
  u.start();
  const r = await u.check();
  assert.equal(r.state, "ready");
  assert.equal(r.version, "1.4.0");
  const progress = sent.filter(([, p]) => p.state === "downloading").map(([, p]) => p.percent);
  assert.deepEqual(progress, [0, 41, 100]);
});

test("manual check offline: a plain message and the manual download link", async () => {
  const { u, logs } = setup({ script: offline });
  u.start();
  const r = await u.check();
  assert.equal(r.state, "error");
  assert.equal(r.message, "Couldn't check for updates - are you online?");
  assert.equal(r.url, "https://github.com/WxstedGOTY/reminth-launcher/releases/latest");
  assert.ok(logs.some((l) => /ERR_INTERNET_DISCONNECTED/.test(l)), "the raw error is logged");
});

test("friendlyUpdateError: offline, rate limit, missing files, anything else", () => {
  const f = updater.friendlyUpdateError;
  for (const m of ["getaddrinfo ENOTFOUND github.com", "connect ETIMEDOUT 1.2.3.4:443", "net::ERR_NAME_NOT_RESOLVED", "socket hang up"]) {
    assert.equal(f(new Error(m)), "Couldn't check for updates - are you online?", m);
  }
  assert.match(f(new Error("HttpError: 403 Forbidden rate limit exceeded")), /limiting requests/);
  assert.match(f(new Error("Cannot find latest.yml in the latest release artifacts: HttpError: 404")), /update files/);
  assert.match(f(new Error("sha512 checksum mismatch")), /didn't check out/);
  assert.match(f(new Error("something odd")), /^Couldn't check for updates - try again later/);
  assert.match(f(undefined), /^Couldn't check/);
});

test("automatic checks: first after 10 s, then every 6 hours, and quiet when nothing is new or offline", async () => {
  let mode = upToDate;
  const { u, au, timers, sent } = setup({ script: (a) => mode(a) });
  u.start();
  u.start(); // twice is harmless
  assert.deepEqual(timers.timeouts.map((t) => t.ms), [10 * 1000]);
  assert.deepEqual(timers.intervals.map((t) => t.ms), [6 * 60 * 60 * 1000]);
  await timers.timeouts[0].fn();
  assert.equal(au.checks, 1);
  assert.deepEqual(sent, [], "nothing new: nothing said");
  mode = offline;
  await timers.intervals[0].fn();
  assert.equal(au.checks, 2);
  assert.deepEqual(sent, [], "offline: nothing said");
  assert.equal(u.getState().state, "idle");
  mode = newVersion;
  await timers.intervals[0].fn();
  assert.equal(u.getState().state, "ready");
  assert.ok(sent.some(([, p]) => p.state === "downloading"), "a download is shown on the bar");
  // once ready, the 6-hour timer doesn't check again
  await timers.intervals[0].fn();
  assert.equal(au.checks, 3);
});

test("an automatic download that fails takes the bar away quietly", async () => {
  const { u, timers, states } = setup({
    script: async (au) => {
      au.emit("update-available", { version: "1.4.0" });
      au.emit("error", new Error("ECONNRESET"));
      return {};
    },
  });
  u.start();
  await timers.timeouts[0].fn();
  assert.deepEqual(states(), ["downloading", "idle"]);
  assert.equal(u.getState().state, "idle");
});

test("not packaged: no timers, no updater, and the button says so", async () => {
  let loaded = false;
  const { u, timers } = setup({ packaged: false });
  const real = setup({ packaged: false, script: async () => (loaded = true) });
  u.start();
  real.u.start();
  assert.equal(timers.timeouts.length + timers.intervals.length, 0);
  assert.deepEqual(await u.check(), { state: "dev", currentVersion: "1.3.0", message: "Updates only work in the installed app." });
  assert.equal(u.getState().state, "dev");
  assert.equal(loaded, false);
  assert.deepEqual(u.installNow(), { ok: false, reason: "No update is ready yet." });
});

test("electron-updater that won't load: start is quiet, check says to download manually", async () => {
  const { u, timers, logs } = setup({ loadFails: true });
  u.start();
  assert.equal(timers.timeouts.length, 0);
  assert.ok(logs.some((l) => /failed to load/.test(l)));
  const r = await u.check();
  assert.equal(r.state, "error");
  assert.match(r.message, /download the new version manually/);
});

test("a running game: no automatic check, no Restart, no install on quit", async () => {
  let playing = true;
  const { u, au, app, timers } = setup({ script: newVersion, gameRunning: () => playing });
  u.start();
  await timers.timeouts[0].fn();
  await timers.intervals[0].fn();
  assert.equal(au.checks, 0, "nothing runs while the game does");
  // the player asks: the check and download may go ahead...
  assert.equal((await u.check()).state, "ready");
  // ...but restarting is refused, and quitting leaves the update for later
  assert.deepEqual(u.installNow(), { ok: false, reason: "Close Minecraft first." });
  assert.equal(au.installs, 0);
  app.emit("before-quit");
  assert.equal(au.autoInstallOnAppQuit, false);
  playing = false;
  app.emit("before-quit");
  assert.equal(au.autoInstallOnAppQuit, true);
  assert.deepEqual(u.installNow(), { ok: true });
  assert.equal(au.installs, 1);
  // silent, and Reminth reopens afterwards
  assert.deepEqual(au.installArgs, [true, true]);
});

test("check while one is already running or downloading: one check, the current state back", async () => {
  let release;
  const { u, au } = setup({
    script: (a) =>
      new Promise((resolve) => {
        release = () => {
          a.emit("update-not-available", { version: "1.3.0" });
          resolve({});
        };
      }),
  });
  u.start();
  const first = u.check();
  const second = u.check();
  await new Promise((r) => setImmediate(r));
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(au.checks, 1);
  assert.equal(a.state, "up-to-date");
  assert.equal(b.state, "up-to-date");
});

test("module wrapper: dev run answers 'installed app only' and never throws", async () => {
  assert.equal((await updater.check()).state, "dev");
  assert.equal(updater.getState().state, "dev");
  assert.equal(updater.installNow().ok, false);
});
