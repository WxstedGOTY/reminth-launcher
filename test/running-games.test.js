"use strict";
// Games started by an earlier Reminth keep running; a restarted Reminth must
// find them again instead of letting Play start a second copy.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const rg = require("../src/main/runningGames");

test("parseGameDir: quoted, unquoted, with spaces, missing", () => {
  assert.equal(rg.parseGameDir('javaw -Xmx4G --gameDir "C:\Users\a b\Reminth\game" --username x'), "C:\Users\a b\Reminth\game");
  assert.equal(rg.parseGameDir("javaw --gameDir C:\Reminth\game --assetsDir x"), "C:\Reminth\game");
  assert.equal(rg.parseGameDir("javaw --gameDir=C:\Reminth\game"), "C:\Reminth\game");
  assert.equal(rg.parseGameDir("javaw -jar something.jar"), null);
  assert.equal(rg.parseGameDir(null), null);
});

test("matchInstances: same folder in any case or with a trailing slash; the oldest process wins; others ignored", () => {
  const instances = [
    { id: "reminth", gameDir: "C:\Users\k\AppData\Roaming\Reminth\instance\game" },
    { id: "two", gameDir: "C:\Users\k\AppData\Roaming\Reminth\instances\two" },
  ];
  const procs = [
    { pid: 50, gameDir: "c:/users/k/appdata/roaming/reminth/instance/game/", startedAt: 2000 },
    { pid: 40, gameDir: "C:\Users\k\AppData\Roaming\Reminth\instance\game", startedAt: 1000 },
    { pid: 60, gameDir: "C:\Somewhere\Else", startedAt: 1 },
    { pid: 0, gameDir: "C:\Users\k\AppData\Roaming\Reminth\instances\two", startedAt: 1 }, // bad pid
  ];
  const m = rg.matchInstances(procs, instances);
  assert.deepEqual([...m.keys()], ["reminth"]);
  assert.deepEqual(m.get("reminth"), { pid: 40, startedAt: 1000 });
  assert.equal(rg.matchInstances(null, null).size, 0);
});

test("listGameProcesses: reads PowerShell's answer (one process or many), keeps only pid/gameDir/time - never the command line", async () => {
  if (process.platform !== "win32") return;
  const answer = (json) => (cmd, args, opts, cb) => cb(null, json);
  const one = JSON.stringify({ ProcessId: 1234, CommandLine: 'javaw --accessToken SECRET --gameDir "C:\g\game"', Started: 1700000000000 });
  const r1 = await rg.listGameProcesses({ run: answer(one) });
  assert.deepEqual(r1, [{ pid: 1234, gameDir: "C:\g\game", startedAt: 1700000000000 }]);
  assert.ok(!JSON.stringify(r1).includes("SECRET"));
  const many = JSON.stringify([{ ProcessId: 1, CommandLine: "javaw -version", Started: 1 }, { ProcessId: 2, CommandLine: "javaw --gameDir C:/x", Started: 2 }]);
  assert.deepEqual((await rg.listGameProcesses({ run: answer(many) })).map((p) => p.pid), [2]);
});

test("listGameProcesses: any failure is 'nothing running', never a throw", async () => {
  if (process.platform !== "win32") return;
  assert.deepEqual(await rg.listGameProcesses({ run: (c, a, o, cb) => cb(new Error("no powershell")) }), []);
  assert.deepEqual(await rg.listGameProcesses({ run: (c, a, o, cb) => cb(null, "not json") }), []);
  assert.deepEqual(await rg.listGameProcesses({ run: (c, a, o, cb) => cb(null, "") }), []);
  assert.deepEqual(await rg.listGameProcesses({ run: () => { throw new Error("spawn"); } }), []);
});

test("watchUntilGone: calls back once when the process is gone, and can be stopped", () => {
  let tick = null;
  let cleared = false;
  const timers = { setInterval: (fn) => ((tick = fn), 1), clearInterval: () => (cleared = true) };
  let alive = true;
  let gone = 0;
  rg.watchUntilGone(7, () => gone++, { alive: () => alive, timers });
  tick();
  assert.equal(gone, 0);
  alive = false;
  tick();
  tick();
  assert.equal(gone, 1);
  assert.equal(cleared, true);
  // stopped before it ends: never calls back
  let n = 0;
  const stop = rg.watchUntilGone(8, () => n++, { alive: () => false, timers });
  stop();
  tick();
  assert.equal(n, 0);
});

test("a real Java process with --gameDir is found by its folder, and its token is not exposed", async () => {
  if (process.platform !== "win32") return;
  const { spawn } = require("child_process");
  const fs = require("fs");
  const os = require("os");
  const javaw = path.join(os.homedir(), "AppData", "Roaming", "Reminth", "java", "bin", "javaw.exe");
  if (!fs.existsSync(javaw)) return; // no Java installed by Reminth on this PC
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reminth-rg-"));
  fs.writeFileSync(path.join(dir, "Sleeper.java"), "public class Sleeper { public static void main(String[] a) throws Exception { Thread.sleep(60000); } }");
  const child = spawn(javaw, [path.join(dir, "Sleeper.java"), "--accessToken", "TOP-SECRET-TOKEN", "--gameDir", path.join(dir, "my game")], { stdio: "ignore", windowsHide: true });
  try {
    let found = null;
    for (let i = 0; i < 20 && !found; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const list = await rg.listGameProcesses();
      assert.ok(!JSON.stringify(list).includes("TOP-SECRET-TOKEN"));
      found = rg.matchInstances(list, [{ id: "x", gameDir: path.join(dir, "my game") }]).get("x");
    }
    assert.ok(found, "the running process was found by its game folder");
    assert.equal(found.pid, child.pid);
    assert.ok(rg.isAlive(child.pid));
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(rg.isAlive(child.pid), false);
});

test("Audit 16: PowerShell is told to answer in UTF-8, so Greek and accented user names still match", async () => {
  // Without this, Windows PowerShell answers in the old console code page and
  // "C:\Users\Γιώργος\..." arrives garbled - the running game is never found.
  const rg = require("../src/main/runningGames");
  assert.match(rg.SCRIPT, /^\[Console\]::OutputEncoding = \[System\.Text\.Encoding\]::UTF8; Get-CimInstance/);
  // what PowerShell then sends, as Node reads it (UTF-8)
  const answer = JSON.stringify([{ ProcessId: 4242, CommandLine: 'javaw.exe -cp x net.minecraft.client.main.Main --gameDir "C:\\Users\\Γιώργος Ζωή\\AppData\\Roaming\\Reminth\\instances\\survival-ab12" --accessToken SECRET', Started: 1700000000000 }]);
  const run = (_cmd, _args, _opts, cb) => cb(null, answer);
  const realPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "win32" });
  try {
    const procs = await rg.listGameProcesses({ run });
    const found = rg.matchInstances(procs, [{ id: "survival-ab12", gameDir: "C:\\Users\\Γιώργος Ζωή\\AppData\\Roaming\\Reminth\\instances\\survival-ab12" }]);
    assert.equal(found.get("survival-ab12").pid, 4242);
  } finally {
    Object.defineProperty(process, "platform", realPlatform);
  }
});

test("parseTasklistTitle: a window title, no window (N/A), another process, junk", () => {
  const row = (pid, title) => `"javaw.exe","${pid}","Console","1","1,204,532 K","Running","PC\k","0:12:01","${title}"\r\n`;
  assert.equal(rg.parseTasklistTitle(row(4242, "Minecraft* 26.2 - Multiplayer (3rd-party Server)"), 4242), "Minecraft* 26.2 - Multiplayer (3rd-party Server)");
  assert.equal(rg.parseTasklistTitle(row(4242, "N/A"), 4242), "");
  assert.equal(rg.parseTasklistTitle(row(4243, "Minecraft"), 4242), null);
  assert.equal(rg.parseTasklistTitle(row(4242, 'a","b'), 4242), 'a","b');
  assert.equal(rg.parseTasklistTitle("INFO: No tasks are running which match the specified criteria.", 4242), null);
  assert.equal(rg.parseTasklistTitle("", 4242), null);
});

test("checkGame: loading is left alone, a closed window with Java still there is 'hung', a vanished process is 'gone'", () => {
  // still loading mods: no window yet, for as long as it takes
  let w = {};
  for (let i = 0; i < 20; i++) assert.equal(rg.checkGame(w, true, ""), "ok");
  // the window appears, then the player closes Minecraft but Java hangs: hung on the third check without a window
  assert.equal(rg.checkGame(w, true, "Minecraft* 26.2"), "ok");
  assert.equal(rg.checkGame(w, true, ""), "ok");
  assert.equal(rg.checkGame(w, true, ""), "ok");
  assert.equal(rg.checkGame(w, true, ""), "hung");
  // a window that only flickers away (F11, a crash screen opening) doesn't count
  w = {};
  rg.checkGame(w, true, "Minecraft");
  rg.checkGame(w, true, "");
  rg.checkGame(w, true, "");
  assert.equal(rg.checkGame(w, true, "Minecraft"), "ok");
  assert.equal(rg.checkGame(w, true, ""), "ok");
  // couldn't tell (tasklist failed): never a reason to end anything
  w = { sawWindow: true };
  for (let i = 0; i < 10; i++) assert.equal(rg.checkGame(w, true, null), "ok");
  // the process is gone: two checks in a row
  w = {};
  assert.equal(rg.checkGame(w, false, null), "ok");
  assert.equal(rg.checkGame(w, false, null), "gone");
  w = {};
  rg.checkGame(w, false, null);
  rg.checkGame(w, true, "Minecraft");
  assert.equal(rg.checkGame(w, false, null), "ok", "one missed check alone isn't gone");
});

test("closeGameWindow (Refresh, owner 23 Oct 2026): taskkill WITHOUT /f - the game closes like its X button, nothing is killed", async () => {
  const calls = [];
  const ok = (cmd, args, _opts, cb) => { calls.push([cmd, args]); cb(null, "SUCCESS"); };
  const fail = (_cmd, _args, _opts, cb) => cb(new Error("no window"));
  if (process.platform === "win32") {
    assert.equal(await rg.closeGameWindow(4242, { run: ok }), true);
    assert.deepEqual(calls, [["taskkill.exe", ["/pid", "4242"]]]);
    assert.ok(!calls[0][1].includes("/f") && !calls[0][1].includes("/t"));
    assert.equal(await rg.closeGameWindow(4242, { run: fail }), false);
  }
  assert.equal(await rg.closeGameWindow("4242", { run: ok }), false); // not a pid number
});
