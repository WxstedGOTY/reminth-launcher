"use strict";
// The sponsored box (owner, 16 Oct 2026): the website's checks (functions/_sponsor.js) and the launcher's
// (src/main/sponsor.js) - only a real server address, a real picture, from Reminth's own website, never past its end.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const sponsor = require("../src/main/sponsor");

const load = () => import(pathToFileURL(path.join(__dirname, "..", "functions", "_sponsor.js")).href);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(200, 2)]);
const dataUrl = (type, buf) => `data:${type};base64,${buf.toString("base64")}`;
const DAY = 86400;

test("website: server addresses - host, host:port, [v6]:port; junk refused", async () => {
  const { parseAddress } = await load();
  assert.deepEqual(parseAddress("Play.Example.net"), { host: "play.example.net", port: 25565 });
  assert.deepEqual(parseAddress(" play.example.net:25570 "), { host: "play.example.net", port: 25570 });
  assert.deepEqual(parseAddress("[2001:db8::1]:25566"), { host: "2001:db8::1", port: 25566 });
  for (const bad of ["", "play example.net", "http://x.net", "x.net:0", "x.net:70000", ".x.net", "x..net", "a.net/b", "<b>", "x.net:"]) {
    assert.equal(parseAddress(bad), null, bad);
  }
});

test("website: days and pictures are checked", async () => {
  const { parseDay, parseImage } = await load();
  assert.equal(parseDay("2026-10-20"), Date.UTC(2026, 9, 20) / 1000);
  assert.equal(parseDay("2026-02-30"), null);
  assert.equal(parseDay("20-10-2026"), null);
  assert.equal(parseImage(dataUrl("image/png", PNG)).type, "image/png");
  assert.equal(parseImage(dataUrl("image/webp", WEBP)).type, "image/webp");
  assert.equal(parseImage(dataUrl("image/png", WEBP)), null, "says png but isn't");
  assert.equal(parseImage(dataUrl("image/svg+xml", PNG)), null, "no svg");
  assert.equal(parseImage(dataUrl("image/png", Buffer.concat([PNG, Buffer.alloc(460 * 1024)]))), null, "too big");
  assert.equal(parseImage("https://example.com/a.png"), null);
});

test("website: what the owner page sends -> a row; the last day counts; bad input gets a plain message", async () => {
  const { checkSponsorInput, isLive, publicSponsor } = await load();
  const now = Date.UTC(2026, 9, 16, 12) / 1000;
  const ok = { name: "  Example   SMP ", address: "play.example.net", startDay: "2026-10-16", endDay: "2026-10-22", image: dataUrl("image/webp", WEBP) };
  const { row } = checkSponsorInput(ok, now);
  assert.equal(row.name, "Example SMP");
  assert.equal(row.starts_at, Date.UTC(2026, 9, 16) / 1000);
  assert.equal(row.ends_at, Date.UTC(2026, 9, 23) / 1000, "shows all of the last day");
  assert.ok(isLive(row, now));
  assert.ok(!isLive(row, row.ends_at));
  assert.ok(!isLive(row, row.starts_at - 1));
  assert.deepEqual(publicSponsor(row), { name: "Example SMP", host: "play.example.net", port: 25565, image: `/api/sponsor/image?v=${now}`, until: row.ends_at });
  assert.equal(checkSponsorInput({ ...ok, name: "" }, now).error, "name");
  assert.equal(checkSponsorInput({ ...ok, address: "not a server" }, now).error, "address");
  assert.equal(checkSponsorInput({ ...ok, endDay: "2026-10-10" }, now).error, "days");
  assert.equal(checkSponsorInput({ ...ok, startDay: "2026-10-01", endDay: "2026-10-10" }, now).error, "days", "already over");
  assert.equal(checkSponsorInput({ ...ok, endDay: "2028-10-10" }, now).error, "days", "more than a year");
  assert.equal(checkSponsorInput({ ...ok, image: undefined }, now).error, "image");
  assert.equal(checkSponsorInput({ ...ok, image: undefined }, now, { type: "image/png", base64: "x" }).row.image, "x", "no new picture keeps the saved one");
  assert.match(checkSponsorInput({ ...ok, image: "data:text/html;base64,PGI+" }, now).message, /PNG, JPG or WebP/);
});

test("launcher: only a clean answer from the website is shown", () => {
  const now = Date.UTC(2026, 9, 16) ;
  const good = { sponsor: { name: "Example SMP", host: "play.example.net", port: 25565, image: "/api/sponsor/image?v=123", until: now / 1000 + DAY } };
  assert.equal(sponsor.cleanSponsor(good, now).name, "Example SMP");
  assert.equal(sponsor.cleanSponsor({ sponsor: null }, now), null);
  assert.equal(sponsor.cleanSponsor({ sponsor: { ...good.sponsor, image: "https://evil.example/x.png" } }, now), null, "picture only from Reminth's site");
  assert.equal(sponsor.cleanSponsor({ sponsor: { ...good.sponsor, host: "a b" } }, now), null);
  assert.equal(sponsor.cleanSponsor({ sponsor: { ...good.sponsor, port: 0 } }, now), null);
  assert.equal(sponsor.cleanSponsor({ sponsor: { ...good.sponsor, until: now / 1000 - 1 } }, now), null, "over");
  assert.equal(sponsor.cleanSponsor({ sponsor: { ...good.sponsor, name: "x".repeat(41) } }, now), null);
  assert.equal(sponsor.imageType(PNG), "image/png");
  assert.equal(sponsor.imageType(WEBP), "image/webp");
  assert.equal(sponsor.imageType(Buffer.from("<svg></svg> not a picture")), null);
  assert.equal(sponsor.addressOf({ host: "a.net", port: 25565 }), "a.net");
  assert.equal(sponsor.addressOf({ host: "a.net", port: 25570 }), "a.net:25570");
  assert.equal(sponsor.addressOf({ host: "::1", port: 25565 }), "[::1]");
});

test("launcher: fetches once per 30 minutes, keeps the last slot offline, hides it after its end, refuses a fake picture", async () => {
  const until = Math.floor(Date.now() / 1000) + DAY;
  let calls = [];
  let picture = PNG;
  let online = true;
  const fakeFetch = async (url) => {
    calls.push(url.replace(/^https?:\/\/[^/]+/, ""));
    if (!online) throw new Error("offline");
    if (url.endsWith("/api/sponsor")) return { ok: true, json: async () => ({ sponsor: { name: "Example SMP", host: "play.example.net", port: 25570, image: "/api/sponsor/image?v=7", until } }) };
    return { ok: true, arrayBuffer: async () => picture.buffer.slice(picture.byteOffset, picture.byteOffset + picture.length) };
  };
  sponsor._reset();
  const t0 = Date.now();
  let s = await sponsor.get({ fetchImpl: fakeFetch, nowMs: t0 });
  assert.equal(s.address, "play.example.net:25570");
  assert.match(s.image, /^data:image\/png;base64,/);
  assert.deepEqual(calls, ["/api/sponsor", "/api/sponsor/image?v=7"]);
  await sponsor.get({ fetchImpl: fakeFetch, nowMs: t0 + 60 * 1000 });
  assert.equal(calls.length, 2, "asked again only after 30 minutes");
  // 30 minutes later, offline: still shown
  online = false;
  s = await sponsor.get({ fetchImpl: fakeFetch, nowMs: Date.now() + sponsor.REFRESH_MS + 1000 });
  assert.equal(s && s.name, "Example SMP");
  // past its end: gone even without the website
  assert.equal(await sponsor.get({ fetchImpl: fakeFetch, nowMs: (until + 1) * 1000 }), null);
  // a picture that isn't one: nothing shown
  sponsor._reset();
  online = true;
  calls = [];
  picture = Buffer.from("<html>not a picture</html>");
  assert.equal(await sponsor.get({ fetchImpl: fakeFetch }), null);
  sponsor._reset();
});

test("Home: the space starts empty (no fake ads) and the box always says Sponsored", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "index.html"), "utf8");
  assert.ok(html.includes('<div class="nh-ad-slot" id="nhAdSlot" aria-hidden="true"></div>'));
  const js = fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "renderer.js"), "utf8");
  const fn = js.slice(js.indexOf("async function loadSponsor()"), js.indexOf("function paintHomeServerButtons()"));
  assert.ok(fn.includes('el("span", "nh-label", "Sponsored")'));
  assert.ok(!/innerHTML/.test(fn));
});
