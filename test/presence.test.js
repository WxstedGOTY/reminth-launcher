"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { serverFromLog, serverOfGame, createPresence } = require("../src/main/presence");

test("presence: the server comes from the game's own 'Connecting to' lines, the last one wins", () => {
  const log = [
    "[12:00:01] [Render thread/INFO]: Connecting to mcpvp.club, 25565",
    "[12:00:05] [VoiceChatClientThread/INFO]: [voicechat] Connecting to voice chat server: '1.2.3.4:30001'",
    "[12:10:00] [Render thread/INFO]: Connecting to DonutSMP.net, 25565",
  ].join("\n");
  assert.equal(serverFromLog(log), "donutsmp.net");
  assert.equal(serverFromLog("[1] Connecting to play.example.org, 25570"), "play.example.org:25570");
  assert.equal(serverFromLog("[1] Connecting to voice chat server: '1.2.3.4:30001'"), null);
  assert.equal(serverFromLog("nothing here"), null);
  assert.equal(serverFromLog(""), null);
  assert.equal(serverFromLog("Connecting to bad<host>, 25565"), null);
});

test("presence: an old log (from before this game started) says nothing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "presence-"));
  fs.mkdirSync(path.join(dir, "logs"));
  const file = path.join(dir, "logs", "latest.log");
  fs.writeFileSync(file, "[1] Connecting to mcpvp.club, 25565\n");
  assert.equal(await serverOfGame(dir, Date.now() - 1000), "mcpvp.club");
  const old = new Date(Date.now() - 10 * 60 * 1000);
  fs.utimesSync(file, old, old);
  assert.equal(await serverOfGame(dir, Date.now()), null);
  assert.equal(await serverOfGame(path.join(dir, "missing"), Date.now()), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("presence: reports playing + server, nothing about the server in streamer privacy, offline on quit", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "presence-"));
  fs.mkdirSync(path.join(dir, "logs"));
  fs.writeFileSync(path.join(dir, "logs", "latest.log"), "[1] Connecting to pvp.land, 25565\n");
  const sent = [];
  const lists = [];
  let games = [{ gameDir: dir, startedAt: Date.now() - 1000 }];
  let privacy = false;
  const p = createPresence({
    account: { friendsPresence: async (b) => (sent.push(b), { friends: [], incoming: [], outgoing: [] }) },
    games: () => games,
    mcName: () => "Wxsted",
    privacy: () => privacy,
    onList: (c) => lists.push(c),
  });
  p.start();
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(sent[0], { state: "playing", server: "pvp.land", mcName: "Wxsted" });
  assert.equal(lists.length, 1);
  privacy = true;
  p.poke();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(sent[1].server, null);
  games = [];
  privacy = false;
  p.poke();
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(sent[2], { state: "online", server: null, mcName: "Wxsted" });
  await p.stop();
  assert.deepEqual(sent[3], { state: "offline", list: false });
  fs.rmSync(dir, { recursive: true, force: true });
});
