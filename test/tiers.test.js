"use strict";
/**
 * Home's PvP tiers card (src/main/tiers.js): the three tier lists' answers, merged into one tier per gamemode.
 * No network: fetch is a stand-in. Run with: node --test test/tiers.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const tiers = require("../src/main/tiers");

const UUID = "0123456789abcdef0123456789abcdef";

function fakeFetch(answers, log = []) {
  return async (url, opts) => {
    log.push({ url, opts });
    const site = tiers.SITES.find((s) => url.startsWith(s.url));
    const a = answers[site.title];
    if (a instanceof Error) throw a;
    if (typeof a === "number") return { status: a, json: async () => ({}) };
    return { status: 200, json: async () => a };
  };
}

test("uuidForms: dashed and plain, anything else refused", () => {
  assert.deepEqual(tiers.uuidForms(UUID), { plain: UUID, dashed: "01234567-89ab-cdef-0123-456789abcdef" });
  assert.deepEqual(tiers.uuidForms("01234567-89AB-cdef-0123-456789abcdef"), { plain: UUID, dashed: "01234567-89ab-cdef-0123-456789abcdef" });
  assert.equal(tiers.uuidForms("Steve"), null);
  assert.equal(tiers.uuidForms(""), null);
  assert.equal(tiers.uuidForms("../../etc"), null);
});

test("parseRankings: tier 1-5, pos 0 = high, retired; junk skipped", () => {
  assert.deepEqual(
    tiers.parseRankings({ rankings: { Sword: { tier: 2, pos: 0 }, uhc: { tier: 3, pos: 1, retired: true }, axe: { tier: 9 }, pot: "x", mace: { tier: "2" } } }),
    [
      { mode: "sword", tier: 2, high: true, retired: false },
      { mode: "uhc", tier: 3, high: false, retired: true },
      { mode: "mace", tier: 2, high: false, retired: false },
    ],
  );
  assert.deepEqual(tiers.parseRankings(null), []);
  assert.deepEqual(tiers.parseRankings({ rankings: [] }), []);
});

test("mergeRanks: the best tier per gamemode across lists, best first, with the lists that gave it", () => {
  const merged = tiers.mergeRanks([
    { site: "MCTiers", ranks: [{ mode: "sword", tier: 2, high: true, retired: false }, { mode: "nethop", tier: 3, high: false, retired: false }, { mode: "pot", tier: 4, high: true, retired: true }] },
    { site: "PvPTiers", ranks: [{ mode: "sword", tier: 3, high: true, retired: false }, { mode: "neth_pot", tier: 3, high: false, retired: false }, { mode: "pot", tier: 4, high: true, retired: false }] },
    { site: "SubTiers", ranks: [{ mode: "vanilla", tier: 1, high: false, retired: false }] },
  ]);
  assert.deepEqual(merged.map((r) => `${r.label} ${r.modeName} ${r.sites.join("+")}${r.retired ? " (retired)" : ""}`), [
    "LT1 Vanilla SubTiers",
    "HT2 Sword MCTiers",
    "LT3 NethOP MCTiers+PvPTiers",
    "HT4 Pot PvPTiers", // a current tier beats a retired one of the same height
  ]);
});

test("playerTiers: asks each list once with the right id form, a 404 means 'not on it', a dead list doesn't break the rest", async () => {
  tiers._cache.clear();
  const log = [];
  const res = await tiers.playerTiers(UUID, {
    fetchImpl: fakeFetch({ MCTiers: new Error("offline"), PvPTiers: { rankings: { sword: { tier: 2, pos: 0 } } }, SubTiers: 404 }, log),
  });
  assert.equal(res.reached, true);
  assert.deepEqual(res.ranks.map((r) => r.label + " " + r.modeName), ["HT2 Sword"]);
  assert.equal(log.length, 3);
  assert.ok(log.some((l) => l.url === "https://mctiers.com/api/v2/profile/01234567-89ab-cdef-0123-456789abcdef"));
  assert.ok(log.some((l) => l.url === "https://pvptiers.com/api/profile/" + UUID));
  assert.ok(log.every((l) => /Reminth/.test(l.opts.headers["User-Agent"])), "says who's asking");
  assert.ok(log.every((l) => !JSON.stringify(l.opts).toLowerCase().includes("token")), "no token is sent");
});

test("playerTiers: cached (30 minutes when every list answered), nothing reachable says so, a bad id asks nobody", async () => {
  tiers._cache.clear();
  const log = [];
  const ok = fakeFetch({ MCTiers: 404, PvPTiers: 404, SubTiers: 404 }, log);
  const first = await tiers.playerTiers(UUID, { fetchImpl: ok });
  assert.deepEqual(first, { reached: true, ranks: [] }, "on no list: reached, no ranks");
  await tiers.playerTiers(UUID, { fetchImpl: ok });
  assert.equal(log.length, 3, "the second look-up came from the cache");

  tiers._cache.clear();
  const down = await tiers.playerTiers(UUID, { fetchImpl: fakeFetch({ MCTiers: 503, PvPTiers: new Error("x"), SubTiers: 500 }) });
  assert.equal(down.reached, false);

  const none = [];
  const bad = await tiers.playerTiers("not-an-id", { fetchImpl: fakeFetch({}, none) });
  assert.equal(bad.reached, false);
  assert.equal(none.length, 0);
});
