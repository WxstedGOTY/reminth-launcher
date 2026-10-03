"use strict";
// The ping shown for a server is the Ping/Pong round trip (what Minecraft's
// own server list shows), not the time the server took to build its status
// answer. These tests run a fake Minecraft server on a local port.
const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const serverPing = require("../src/main/serverPing");

function varint(n) {
  const out = [];
  let v = n >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return Buffer.from(out);
}
function packet(id, payload) {
  const body = Buffer.concat([varint(id), payload]);
  return Buffer.concat([varint(body.length), body]);
}
function statusPacket() {
  const json = Buffer.from(JSON.stringify({ version: { name: "Paper 26.2", protocol: 800 }, players: { online: 4, max: 50 } }));
  return packet(0x00, Buffer.concat([varint(json.length), json]));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A fake server. `opts.statusDelay` before the status answer; `opts.pong(i, payload)`
 * returns { delay, payload } for ping number i, or null to never answer it;
 * `opts.closeAfterPong` hangs up after the first pong (what vanilla does).
 */
async function fakeServer(opts) {
  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    let pings = 0;
    let gotStatusRequest = false;
    sock.on("error", () => {});
    sock.on("data", async (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const len = serverPing.readVarint(buf, 0);
        if (!len || buf.length < len[0] + len[1]) return;
        const body = buf.subarray(len[1], len[1] + len[0]);
        buf = buf.subarray(len[1] + len[0]);
        const id = body[0];
        if (id === 0x00 && body.length === 1 && !gotStatusRequest) {
          gotStatusRequest = true;
          await sleep(opts.statusDelay || 0);
          if (opts.closeBeforeStatus) return sock.destroy();
          sock.write(statusPacket());
        } else if (id === 0x01) {
          const i = pings++;
          const answer = opts.pong ? opts.pong(i, body.subarray(1)) : { delay: 0, payload: body.subarray(1) };
          if (!answer) continue;
          await sleep(answer.delay);
          if (sock.destroyed) return;
          sock.write(packet(0x01, answer.payload));
          if (opts.closeAfterPong) sock.end();
        }
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { address: `127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

test("serverPing: latency is the pong time, not the slow status answer", async () => {
  const srv = await fakeServer({ statusDelay: 120 });
  try {
    const r = await serverPing.ping(srv.address);
    assert.equal(r.online, true);
    assert.equal(r.latencyKind, "ping");
    assert.ok(r.latencyMs >= 1 && r.latencyMs < 60, `latency ${r.latencyMs}`);
    assert.equal(r.playersOnline, 4);
    assert.equal(r.versionName, "Paper 26.2");
  } finally {
    await srv.close();
  }
});

test("serverPing: a server that never answers pings falls back to the status time", async () => {
  const srv = await fakeServer({ statusDelay: 60, pong: () => null });
  try {
    const t0 = Date.now();
    const r = await serverPing.ping(srv.address);
    assert.equal(r.online, true);
    assert.equal(r.latencyKind, "status");
    assert.ok(r.latencyMs >= 50, `latency ${r.latencyMs}`);
    // It doesn't sit out the whole 3.5 s timeout.
    assert.ok(Date.now() - t0 < 3000);
  } finally {
    await srv.close();
  }
});

test("serverPing: pongs with the wrong payload are ignored", async () => {
  const srv = await fakeServer({
    pong: (i, payload) => (i === 0 ? { delay: 0, payload: Buffer.alloc(8, 7) } : { delay: 0, payload }),
  });
  try {
    const r = await serverPing.ping(srv.address);
    // The wrong pong didn't count; the client is still waiting for it, so the
    // ping phase ends with no good pong -> status time.
    assert.equal(r.online, true);
    assert.equal(r.latencyKind, "status");
  } finally {
    await srv.close();
  }
});

test("serverPing: a vanilla server hanging up after the first pong still counts that pong", async () => {
  const srv = await fakeServer({ statusDelay: 80, closeAfterPong: true });
  try {
    const r = await serverPing.ping(srv.address);
    assert.equal(r.online, true);
    assert.equal(r.latencyKind, "ping");
    assert.ok(r.latencyMs < 60, `latency ${r.latencyMs}`);
  } finally {
    await srv.close();
  }
});

test("serverPing: closing before the status answer is offline, finished once", async () => {
  const srv = await fakeServer({ closeBeforeStatus: true });
  try {
    const r = await serverPing.ping(srv.address);
    assert.equal(r.online, false);
  } finally {
    await srv.close();
  }
});

test("serverPing: three pings -> the median", async () => {
  const delays = [10, 80, 35];
  const srv = await fakeServer({ pong: (i, payload) => ({ delay: delays[i], payload }) });
  try {
    const r = await serverPing.ping(srv.address);
    assert.equal(r.latencyKind, "ping");
    assert.ok(r.latencyMs >= 30 && r.latencyMs < 70, `latency ${r.latencyMs}`);
  } finally {
    await srv.close();
  }
});

test("serverPing: median helper", () => {
  assert.equal(serverPing.medianMs([]), null);
  assert.equal(serverPing.medianMs([20.4]), 20);
  assert.equal(serverPing.medianMs([10, 40, 20]), 20);
  assert.equal(serverPing.medianMs([10, 30]), 20);
  assert.equal(serverPing.medianMs([0.2]), 1);
  assert.equal(serverPing.medianMs([NaN, 5]), 5);
});

test("serverPing: packets split even when two arrive in one chunk", () => {
  const two = Buffer.concat([packet(0x00, Buffer.from([1, 2])), packet(0x01, Buffer.alloc(8, 3)), Buffer.from([5])]);
  const { packets, rest } = serverPing.splitPackets(two);
  assert.equal(packets.length, 2);
  assert.equal(packets[0].id, 0);
  assert.equal(packets[1].id, 1);
  assert.equal(packets[1].body.length, 8);
  assert.deepEqual([...rest], [5]);
});
