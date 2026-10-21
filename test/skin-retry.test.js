"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { servicesFetch, retryWaitMs } = require("../src/main/skin");

const account = { minecraftAccessToken: "x" };
const headers = (h = {}) => ({ get: (k) => (k in h ? h[k] : null) });
const answer = (status, h) => ({ status, ok: status >= 200 && status < 300, headers: headers(h), json: async () => ({}) });

test("retryWaitMs: Retry-After when sent, else 5 s then 10 s; never more than 30 s or less than 1 s", () => {
  assert.equal(retryWaitMs(headers({ "retry-after": "7" }), 0), 7000);
  assert.equal(retryWaitMs(headers({ "retry-after": "120" }), 0), 30000);
  assert.equal(retryWaitMs(headers({ "retry-after": "0" }), 0), 1000);
  assert.equal(retryWaitMs(headers(), 0), 5000);
  assert.equal(retryWaitMs(headers(), 1), 10000);
  assert.equal(retryWaitMs(headers({ "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }), 0), 5000);
});

test("servicesFetch: a 429 waits and tries again - the skin change goes through on the second try", async () => {
  const answers = [answer(429, { "retry-after": "2" }), answer(204)];
  const waits = [];
  const calls = [];
  const out = await servicesFetch(account, "https://example/skins", { method: "POST" }, {
    wait: async (ms) => waits.push(ms),
    fetchFn: async (url, init) => {
      calls.push(init.headers.Authorization);
      return answers.shift();
    },
  });
  assert.equal(out, null);
  assert.deepEqual(waits, [2000]);
  assert.deepEqual(calls, ["Bearer x", "Bearer x"]);
});

test("servicesFetch: still 429 after 3 tries -> a plain message, no endless waiting", async () => {
  let n = 0;
  const waits = [];
  await assert.rejects(
    servicesFetch(account, "https://example/skins", {}, { wait: async (ms) => waits.push(ms), fetchFn: async () => (n++, answer(429)) }),
    /Mojang is busy with skin changes/
  );
  assert.equal(n, 3);
  assert.deepEqual(waits, [5000, 10000]);
});

test("servicesFetch: other errors are not retried", async () => {
  let n = 0;
  await assert.rejects(servicesFetch(account, "u", {}, { wait: async () => {}, fetchFn: async () => (n++, answer(401)) }), /sign-in expired/);
  assert.equal(n, 1);
});
