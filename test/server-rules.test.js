"use strict";
// Mods big servers ban (main/serverRules.js): the warning before Play. Written 7 Oct 2026, after the owner was nearly
// banned on DonutSMP for Inventory Profiles Next.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const rules = require("../src/main/serverRules");
const purposes = require("../src/main/purposes");

test("serverFor: an address, a sub-domain, a port, any case - and nothing for other servers", () => {
  assert.equal(rules.serverFor("donutsmp.net").id, "donutsmp");
  assert.equal(rules.serverFor("Play.DonutSMP.net:25565").id, "donutsmp");
  assert.equal(rules.serverFor("mc.hypixel.net").id, "hypixel");
  assert.equal(rules.serverFor("play.mccisland.net").id, "mccisland");
  assert.equal(rules.serverFor("notdonutsmp.net"), null, "a look-alike domain is not DonutSMP");
  assert.equal(rules.serverFor("donutsmp.net.evil.com"), null);
  assert.equal(rules.serverFor("localhost"), null);
  assert.equal(rules.serverFor(""), null);
});

test("every server names its source, and only known categories", () => {
  for (const s of rules.SERVERS) {
    assert.ok(s.source && /^https:\/\//.test(s.url), s.id);
    for (const c of s.banned) assert.ok(rules.CATEGORIES[c], `${s.id}: ${c}`);
  }
  for (const [id, cats] of Object.entries(rules.MOD_CATEGORIES)) {
    assert.equal(id, id.toLowerCase());
    for (const c of cats) assert.ok(c === "radarIfOn" || rules.CATEGORIES[c], `${id}: ${c}`);
  }
});

test("findBanned: DonutSMP bans Inventory Profiles Next, Mouse Tweaks and Jade; Hypixel also the minimap", () => {
  const mods = [
    { file: "ipn.jar", title: "Inventory Profiles Next", modId: "inventoryprofilesnext", enabled: true },
    { file: "mt.jar", title: "Mouse Tweaks", modId: "mousetweaks", enabled: true },
    { file: "jade.jar", title: "Jade", modId: "jade", enabled: true },
    { file: "xm.jar", title: "Xaero's Minimap", modId: "xaerominimap", enabled: true },
    { file: "sodium.jar", title: "Sodium", modId: "sodium", enabled: true },
    { file: "off.jar", title: "Freecam", modId: "freecam", enabled: false },
  ];
  // radar off (Reminth's setting): DonutSMP has nothing against the minimap
  const d = rules.findBanned(mods, [{ address: "donutsmp.net", why: "list" }], { radarOn: false });
  assert.equal(d.length, 1);
  assert.equal(d[0].server.name, "DonutSMP");
  assert.deepEqual(d[0].mods.map((m) => m.file), ["ipn.jar", "mt.jar", "jade.jar"]);
  assert.match(d[0].mods[0].categories[0], /inventory/);
  // radar on: the minimap is "radar" there
  assert.ok(rules.findBanned(mods, [{ address: "donutsmp.net", why: "list" }], { radarOn: true })[0].mods.some((m) => m.file === "xm.jar"));
  // Hypixel bans every minimap, radar or not
  const h = rules.findBanned(mods, [{ address: "mc.hypixel.net", why: "join" }], { radarOn: false });
  assert.ok(h[0].mods.some((m) => m.file === "xm.jar"));
  assert.equal(h[0].why, "join");
  // a switched-off mod is never reported; an unknown server gives nothing
  assert.ok(!d[0].mods.some((m) => m.file === "off.jar"));
  assert.deepEqual(rules.findBanned(mods, [{ address: "example.org", why: "list" }]), []);
  // one entry per server, the strongest reason kept (joining beats listing)
  const both = rules.findBanned(mods, [{ address: "donutsmp.net", why: "list" }, { address: "play.donutsmp.net", why: "join" }]);
  assert.equal(both.length, 1);
  assert.equal(both[0].why, "join");
});

test("checkInstance: reads the join address, the server list and the joined servers; Xaero's radar from its settings", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reminth-rules-"));
  try {
    const content = {
      listAll: async () => ({
        mod: [
          { file: "xaerominimap.jar", modId: "xaerominimap", title: "Xaero's Minimap", enabled: true },
          { file: "mousetweaks.jar", modId: "mousetweaks", title: "Mouse Tweaks", enabled: true },
        ],
      }),
    };
    const gameData = (servers, joined) => ({ listServers: async () => servers.map((a) => ({ address: a })), readServerJoinTimes: async () => new Map(joined.map((h) => [h, 1])) });
    const inst = { id: "x", loader: "fabric", gameDir: dir };
    // nothing listed: nothing to say (and the mods aren't even read)
    assert.deepEqual(await rules.checkInstance(inst, {}, { content: { listAll: async () => assert.fail("read") }, gameData: gameData(["example.org"], []) }), []);
    // DonutSMP only in the logs
    const played = await rules.checkInstance(inst, {}, { content, gameData: gameData([], ["donutsmp.net"]) });
    assert.equal(played[0].why, "played");
    assert.deepEqual(played[0].mods.map((m) => m.title).sort(), ["Mouse Tweaks", "Xaero's Minimap"], "radar is on by default");
    // with Reminth's setting the minimap is fine on DonutSMP
    fs.mkdirSync(path.join(dir, "config", "xaero", "minimap", "profiles"), { recursive: true });
    fs.writeFileSync(path.join(dir, "config", "xaero", "minimap", "profiles", "default.cfg"), "display_radar = false\nminimap_cave_mode_allowed = false\n");
    const listed = await rules.checkInstance(inst, { join: "play.donutsmp.net" }, { content, gameData: gameData([], []) });
    assert.equal(listed[0].why, "join");
    assert.deepEqual(listed[0].mods.map((m) => m.title), ["Mouse Tweaks"]);
    // vanilla: never
    assert.deepEqual(await rules.checkInstance({ ...inst, loader: "vanilla" }, { join: "donutsmp.net" }, { content, gameData: gameData([], []) }), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("playstyle lists: nothing a big server bans is ticked; those that are listed say so", () => {
  for (const id of ["crystal", "sword", "survival", "performance"]) {
    const tabs = purposes.tabsFor([id], { loader: "fabric" });
    for (const t of tabs) {
      for (const item of t.core) {
        assert.ok(!["mouse-tweaks", "inventory-profiles-next", "jade"].includes(item.slug), `${id}: ${item.slug} is ticked`);
      }
      for (const item of t.more) {
        if (["mouse-tweaks", "inventory-profiles-next", "jade"].includes(item.slug)) assert.match(item.warning || "", /ban/i, `${id}: ${item.slug}`);
      }
    }
  }
  // Xaero's Minimap comes with its radar and cave view off
  const xm = purposes.itemBySlug(["survival"]).get("xaeros-minimap");
  assert.ok(xm.configs.some((c) => /display_radar = false/.test(c.content) && /minimap_cave_mode_allowed = false/.test(c.content)));
});
