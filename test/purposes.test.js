"use strict";
/**
 * Tests for the playstyle lists (purposes.js): the data is sane (no duplicates, nothing a server would call
 * cheating), the lists fit the loader, the ready-made settings never overwrite a player's own, and resource packs
 * are switched on in options.txt without losing what was there. No network, no Electron.
 * Run with: node --test test/purposes.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const purposes = require("../src/main/purposes");

// Things servers treat as cheating or that automate play: never offered.
const FORBIDDEN = [
  "clickcrystals", "cpvp-macros", "autototem", "sillys-auto-totem", "inventory-totem", "freecam", "gamma-utils",
  "bactromod", "fullbright+lowfire+lowshield", "bettercrosshairindicator", "xray", "meteor-client", "wurst",
];

test("every playstyle has recommended and less important items, and none is on the forbidden list", () => {
  for (const id of purposes.GOAL_IDS) {
    const tabs = purposes.tabsFor(id, { loader: "fabric" });
    assert.equal(tabs.length, 2, id);
    assert.equal(tabs[0].id, "goal");
    assert.equal(tabs[1].id, "performance");
    assert.ok(tabs[0].core.length >= 8, `${id} has too few recommended items`);
    assert.ok(tabs[0].more.length >= 4, `${id} has too few "more" items`);
    const total = tabs.reduce((n, t) => n + t.core.length + t.more.length, 0);
    assert.ok(total >= 20 && total <= 60, `${id}: ${total} items`);
    for (const t of tabs) for (const i of [...t.core, ...t.more]) assert.ok(!FORBIDDEN.includes(i.slug), `${id}: ${i.slug} is on the forbidden list`);
  }
});

test("a slug appears once per playstyle, in one tab only", () => {
  for (const id of purposes.GOAL_IDS) {
    const seen = new Set();
    for (const t of purposes.tabsFor(id, { loader: "fabric" })) {
      for (const i of [...t.core, ...t.more]) {
        assert.ok(!seen.has(i.slug), `${id}: ${i.slug} twice`);
        seen.add(i.slug);
      }
    }
  }
});

test("a Forge instance is offered resource packs only; a vanilla instance too; Quilt gets the Fabric mods", () => {
  const forge = purposes.tabsFor("crystal", { loader: "forge" });
  for (const t of forge) for (const i of [...t.core, ...t.more]) assert.equal(i.kind, "resourcepack");
  const quilt = purposes.tabsFor("crystal", { loader: "quilt" });
  assert.ok(quilt[0].core.some((i) => i.kind === "mod"));
  assert.equal(purposes.tabsFor("nope", { loader: "fabric" }), null);
});

test("the owner's rules: important ones ticked even when a few servers ban them, one mod per job, no automation", () => {
  const core = (id) => purposes.tabsFor(id, { loader: "fabric" })[0].core.map((i) => i.slug);
  const all = (id) => purposes.tabsFor(id, { loader: "fabric" }).flatMap((t) => [...t.core, ...t.more]).map((i) => i.slug);
  // crystal: both crystal mods (they do different jobs and work together) and the anchor optimizer are ticked
  for (const s of ["marlow-crystal-optimizer", "clientsidecrystals", "anchoroptimizer", "small-shield-totem", "small-tools-", "no-explosion-particles", "low-fire-reborn"]) {
    assert.ok(core("crystal").includes(s), `crystal: ${s}`);
  }
  for (const s of ["small-shield-totem", "small-tools-", "low-fire-reborn", "crittweaks"]) assert.ok(core("sword").includes(s), `sword: ${s}`);
  // survival: Xaero's maps are ticked
  for (const s of ["xaeros-minimap", "xaeros-world-map"]) assert.ok(core("survival").includes(s), `survival: ${s}`);
  // one per job: these doubles are gone everywhere
  for (const id of ["crystal", "sword", "survival", "pvp"]) {
    for (const s of ["kinds-crystal-optimizer", "kinds-anker-optimizer", "mini-totem", "small-totem-pop-animation", "small-low-totem", "short-pvp-swords", "short-swords-pack", "low-shield-pack", "crystal-vanilla-tweaks", "cull-leaves", "clientsort", "mouse-wheelie", "cpvp", "cps-plus"]) {
      assert.ok(!all(id).includes(s), `${id}: ${s} is a second mod for the same job`);
    }
  }
  // the server-rules warning stays on the ones some servers ban
  const crystalItems = purposes.tabsFor("crystal", { loader: "fabric" })[0].core;
  for (const s of ["marlow-crystal-optimizer", "clientsidecrystals", "anchoroptimizer"]) assert.match(crystalItems.find((i) => i.slug === s).warning, /check the rules/i);
});

test("listFor marks availability, channel and installed from Modrinth and the manifest; a 404 is 'not available', other failures 'unknown'", async () => {
  const modrinth = {
    async getProjectVersions(slug) {
      if (slug === "sodium-extra") return [{ project_id: "P1", version_type: "release" }];
      if (slug === "dynamic-fps") return [{ project_id: "P2", version_type: "beta" }];
      if (slug === "fastquit") throw new Error("Modrinth API failed: 404 not found");
      if (slug === "moreculling") throw new Error("offline");
      return [{ project_id: "X" + slug, version_type: "release" }];
    },
  };
  const content = {
    readManifest: async () => ({ files: { "mods/a.jar": { projectId: "P1" } } }),
    loadersFor: () => ["fabric"],
  };
  const tabs = await purposes.listFor("survival", { loader: "fabric", mcVersion: "26.2", gameDir: "x" }, { modrinth, content });
  const perf = tabs.find((t) => t.id === "performance");
  const get = (slug) => perf.core.find((i) => i.slug === slug);
  assert.deepEqual([get("sodium-extra").available, get("sodium-extra").installed, get("sodium-extra").channel], [true, true, "release"]);
  assert.equal(get("dynamic-fps").channel, "beta");
  assert.deepEqual([get("fastquit").available, get("fastquit").installed], [false, false]);
  assert.deepEqual([get("moreculling").available, get("moreculling").installed], [null, null]);
});

test("ready-made settings are written only when the file is missing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reminth-purpose-"));
  try {
    await fs.promises.mkdir(path.join(dir, "config"), { recursive: true });
    fs.writeFileSync(path.join(dir, "config", "zoomify.json"), '{"mine":true}');
    const written = await purposes.writeConfigs(dir, "crystal", ["zoomify", "betterhurtcam", "totemcounter", "not-a-mod"]);
    assert.ok(written.includes("betterhurtcam.toml") && written.includes("totemcounter.toml"));
    assert.ok(!written.includes("zoomify.json"));
    assert.equal(fs.readFileSync(path.join(dir, "config", "zoomify.json"), "utf8"), '{"mine":true}');
    assert.match(fs.readFileSync(path.join(dir, "config", "betterhurtcam.toml"), "utf8"), /enabled = true/);
    // a second run changes nothing
    assert.deepEqual(await purposes.writeConfigs(dir, "crystal", ["betterhurtcam"]), []);
    // one in a sub-folder (Inventory Profiles Next): the folder is made; the hotbar icons are off
    assert.deepEqual(await purposes.writeConfigs(dir, "survival", ["inventory-profiles-next"]), ["inventoryprofilesnext/inventoryprofiles.json"]);
    const ipn = JSON.parse(fs.readFileSync(path.join(dir, "config", "inventoryprofilesnext", "inventoryprofiles.json"), "utf8"));
    assert.equal(ipn.AutoRefillSettings.auto_refill_enable_horbar_indicator_icons, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("every config template is non-empty and its JSON ones parse", () => {
  for (const cfg of Object.values(purposes.CFG)) {
    assert.ok(cfg.file && cfg.content.length > 10, cfg.file);
    if (cfg.file.endsWith(".json")) JSON.parse(cfg.content);
  }
});

test("withPacks adds packs on top, lists only the old ones as accepted, keeps the rest, never doubles", () => {
  assert.equal(purposes.withPacks("", ["A.zip"]), 'resourcePacks:["vanilla","file/A.zip"]\n');
  assert.equal(purposes.withPacks("", ["A.zip"], ["A.zip"]), 'resourcePacks:["vanilla","file/A.zip"]\nincompatibleResourcePacks:["file/A.zip"]\n');
  const text = 'version:4000\nresourcePacks:["vanilla","file/Old.zip"]\nincompatibleResourcePacks:["file/X.zip"]\nfov:0.5\n';
  const out = purposes.withPacks(text, ["A.zip", "Old.zip"], ["A.zip"]);
  assert.equal(out, 'version:4000\nresourcePacks:["vanilla","file/Old.zip","file/A.zip"]\nincompatibleResourcePacks:["file/X.zip","file/A.zip"]\nfov:0.5\n');
  assert.equal(purposes.withPacks("version:1\r\n", ["B.zip"]), 'version:1\r\nresourcePacks:["vanilla","file/B.zip"]\r\n');
  // an unreadable line is replaced, not crashed on
  assert.match(purposes.withPacks("resourcePacks:{broken\n", ["C.zip"]), /resourcePacks:\["vanilla","file\/C\.zip"\]/);
});

test("pack format rules: min/max (also as [major, minor]), supported_formats, plain pack_format; unknown stays unknown", () => {
  const fits = (pack, v) => purposes.formatsFit(purposes.declaredFormats({ pack }), v);
  assert.equal(fits({ min_format: 88, max_format: 88 }, 88), true);
  assert.equal(fits({ min_format: [84, 0], max_format: [88, 0] }, 88), true);
  assert.equal(fits({ min_format: [34, 0], max_format: [87, 0] }, 88), false);
  assert.equal(fits({ pack_format: 15 }, 88), false);
  assert.equal(fits({ pack_format: 88 }, 88), false); // from format 65 on the game wants min_format and max_format
  assert.equal(fits({ pack_format: 64 }, 64), true);
  assert.equal(fits({ pack_format: 46, supported_formats: { min_inclusive: 46, max_inclusive: 255 }, min_format: 46, max_format: 255 }, 88), true);
  assert.equal(fits({ pack_format: 34, supported_formats: [34, 71] }, 88), false);
  assert.equal(fits({ pack_format: 18, supported_formats: { min_inclusive: 18, max_inclusive: 690 } }, 88), false); // no min_format/max_format: the game refuses it
  assert.equal(fits({ description: "no formats" }, 88), null);
  assert.equal(purposes.formatsFit({ min: 1, max: 99 }, NaN), null);
  assert.equal(purposes.declaredFormats(null), null);
});

test("queued packs are switched on once, only if the file still exists, and the queue is cleared", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reminth-packs-"));
  try {
    await fs.promises.mkdir(path.join(dir, "resourcepacks"), { recursive: true });
    fs.writeFileSync(path.join(dir, "resourcepacks", "Here.zip"), "x");
    assert.equal(await purposes.queuePacks(dir, ["Here.zip", "Gone.zip", "../evil.zip"]), true);
    assert.equal(await purposes.applyPendingPacks(dir), true);
    const options = fs.readFileSync(path.join(dir, "options.txt"), "utf8");
    assert.match(options, /resourcePacks:\["vanilla","file\/Here\.zip"\]/);
    assert.ok(!/Gone|evil/.test(options));
    assert.equal(fs.existsSync(path.join(dir, ".reminth", "pending-packs.json")), false);
    assert.equal(await purposes.applyPendingPacks(dir), false); // nothing left to do
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the player is offered PvP and Survival only; PvP holds the crystal and the sword/axe items; no Creative", () => {
  assert.deepEqual(purposes.list().map((g) => g.id), ["crystal", "sword", "survival", "performance"]);
  assert.ok(!purposes.GOAL_IDS.includes("creative"));
  const [goal] = purposes.tabsFor("pvp", { loader: "fabric" });
  const slugs = new Set([...goal.core, ...goal.more].map((i) => i.slug));
  for (const id of ["marlow-crystal-optimizer", "anchoroptimizer", "small-tools-", "hitcolorx", "totemcounter"]) assert.ok(slugs.has(id), id);
  // both crystal mods are recommended (they do different jobs)
  assert.ok(goal.core.some((i) => i.slug === "marlow-crystal-optimizer"));
  assert.ok(goal.core.some((i) => i.slug === "clientsidecrystals"));
});

test("several playstyles at once: one tab each, Performance only when it was ticked, every item once", () => {
  const tabs = purposes.tabsFor(["pvp", "survival", "performance"], { loader: "fabric" });
  assert.deepEqual(tabs.map((t) => t.id), ["pvp", "survival", "performance"]);
  const all = tabs.flatMap((t) => [...t.core, ...t.more].map((i) => i.slug));
  assert.equal(all.length, new Set(all).size, "no item twice");
  assert.deepEqual(purposes.tabsFor(["survival"], { loader: "fabric" }).map((t) => t.id), ["survival"]);
  assert.deepEqual(purposes.tabsFor(["performance"], { loader: "fabric" }).map((t) => t.id), ["performance"]);
  assert.equal(purposes.tabsFor([], { loader: "fabric" }), null);
  // PvP recommends the small shield/totem and small tools packs and the crystal and anchor optimizers
  const pvp = tabs[0].core.map((i) => i.slug);
  for (const s of ["small-shield-totem", "small-tools-", "marlow-crystal-optimizer", "anchoroptimizer"]) assert.ok(pvp.includes(s), s);
});

test("crystal and sword picked together: everything sword recommends is still recommended (not hidden under crystal's More)", () => {
  const tabs = purposes.tabsFor(["crystal", "sword"], { loader: "fabric" });
  const ticked = new Set(tabs.flatMap((t) => t.core.map((i) => i.slug)));
  const unticked = new Set(tabs.flatMap((t) => t.more.map((i) => i.slug)));
  for (const s of ["crittweaks", "hitcolorx", "clean-keystrokes"]) {
    assert.ok(ticked.has(s), s);
    assert.ok(!unticked.has(s), s);
  }
  // and for all four: no item is both in a Recommended and a More list
  const four = purposes.tabsFor(["crystal", "sword", "survival", "performance"], { loader: "fabric" });
  const rec = new Set(four.flatMap((t) => t.core.map((i) => i.slug)));
  for (const i of four.flatMap((t) => t.more)) assert.ok(!rec.has(i.slug), i.slug);
});
