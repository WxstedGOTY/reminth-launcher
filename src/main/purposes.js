"use strict";
/**
 * "What is this instance for?" - ready-made, researched mod and resource pack lists for a playstyle.
 *
 * Nothing here is installed by itself. After a new instance is made, the player picks a playstyle, sees a list
 * (the important ones ticked, a second list of less important ones unticked), unticks what they don't want,
 * ticks more, and Reminth installs the ticked ones like any other mod (renderer: openPurposeSetup).
 *
 * The lists were researched on 5 Oct 2026 against Modrinth's own data for Minecraft 26.2 on Fabric: each slug
 * exists, has a build for 26.2 and is client side. Every slug is asked again for the player's own Minecraft
 * version before it is offered, so a mod with no build for that version shows "No build for ..." instead of
 * failing an install.
 *
 * What is NOT here, on purpose: anything servers treat as cheating. That means no fullbright, no x-ray, no
 * freecam, no auto-totem, no macros or click bots (ClickCrystals, CPvP Macros, Autototem), no hitbox or reach
 * helpers, no radar. Crystal optimizers are allowed on the big crystal PvP servers but not on every server, so they
 * carry a warning. A minimap is allowed on most survival servers and banned on some, so it carries one too.
 *
 * Settings: a mod listed with `configs` gets a ready-made config file when it is installed - only when the
 * instance has no config file for it yet (a player's own settings are never overwritten). The values are the
 * mod's own defaults changed to what a player of that playstyle wants.
 */

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const FABRIC_LIKE = ["fabric", "quilt"];
const ALL_LOADERS = ["fabric", "quilt", "forge", "neoforge", "vanilla"];

const RULES = "Most servers allow it, a few don't - check the rules of the server you play on.";
const MINIMAP = "Allowed on most survival servers, banned on a few. Check the rules of your server.";
const ONE_OPTIMIZER = "Use one crystal optimizer, not two - two of them can fight each other.";

// Ready-made settings (the mod's own file format, as the mods write it themselves).
const CFG = {
  betterhurtcam: {
    file: "betterhurtcam.toml",
    content: 'enabled = true\nmultiplier = 0.25\nheartBlink = false\ntype = "YAW_BASED"\n',
  },
  lowFire: {
    file: "low_fire_reborn.json5",
    content:
      '{\n\t"enableLowFire": true,\n\t"shouldRenderFire": true,\n\t"fireOffset": -0.3,\n\t"fireOffsetCycleUpperKeyLimit": 0.0,\n\t"fireOffsetCycleLowerKeyLimit": -0.5,\n\t"fireOffsetChange": 0.1\n}\n',
  },
  armorHud: {
    file: "ukus-armor-hud.toml",
    content:
      'enabled = true\nanchor = "HOTBAR"\nside = "LEFT"\noffsetX = 0\noffsetY = 0\nstyle = "HOTBAR"\norientation = "HORIZONTAL"\nwidgetShown = "NOT_EMPTY"\noffhandSlotBehavior = "ADHERE"\ndurabilityDisplay = "BAR"\npushBossbars = true\npushStatusEffectIcons = true\npushSubtitles = true\nreversed = false\niconsShown = true\nwarningShown = true\nplayBreakSound = true\nminDurabilityValue = 20\nminDurabilityPercentage = 0.1\nwarningBobIntensity = 3\n',
  },
  totemCounter: {
    file: "totemcounter.toml",
    content:
      "displayEnabled = true\nx = -1\ny = -1\nuseDefaultTotem = false\ndisplayColors = true\ncoloredXpBar = false\nalwaysShowBar = false\nshowPopCounter = true\ncounterEnabled = true\nseparator = true\ncounterColors = true\nshowInTab = false\n",
  },
  totemTweaks: {
    file: "totemtweaks.json",
    content:
      '{\n  "totemSize": 1.0,\n  "popSize": 0.3,\n  "disableEquipAnimation": false,\n  "TotemPopAnimation": true,\n  "animationSpeed": 40,\n  "lockRotationPosition": false,\n  "disableRotations": false,\n  "staticSize": false,\n  "enableTotemSizeChange": false,\n  "totemSizeChangeSpeed": 1.0,\n  "minTotemSize": 0.5,\n  "maxTotemSize": 1.0\n}\n',
  },
  clientCrystals: {
    file: "clientsidecrystals.json",
    content:
      '{\n  "instantEnabled": true,\n  "seamlessEnabled": true,\n  "instantArmSwing": false,\n  "predictionTimeoutTicks": 12,\n  "colorFakeCrystal": false,\n  "fakeCrystalColor": -43521\n}\n',
  },
  anchors: {
    file: "client_side_anchors.json",
    content:
      '{\n  "enabled": true,\n  "instantExplosion": true,\n  "removeOutline": false,\n  "introShown": true,\n  "autoUpdate": false,\n  "autoUpdateFirstRunComplete": true,\n  "autoUpdateTouched": false\n}\n',
  },
  zoomify: {
    file: "zoomify.json",
    content:
      '{\n  "initialZoom": 4,\n  "zoomInTime": 1.0,\n  "zoomOutTime": 0.5,\n  "zoomInTransition": "ease_out_exp",\n  "zoomOutTransition": "ease_out_exp",\n  "affectHandFov": true,\n  "retainZoomSteps": false,\n  "scrollZoom": true,\n  "scrollStepCount": 10,\n  "zoomPerStep": 150,\n  "scrollZoomSmoothness": 70,\n  "zoomKeyBehaviour": "hold",\n  "_keybindScrolling": false,\n  "relativeSensitivity": 100,\n  "relativeViewBobbing": true,\n  "cinematicCamera": 0,\n  "spyglassBehaviour": "combine",\n  "spyglassOverlayVisibility": "holding",\n  "spyglassSoundBehaviour": "with_overlay",\n  "secondaryZoomAmount": 4,\n  "secondaryZoomInTime": 10.0,\n  "secondaryZoomOutTime": 1.0,\n  "secondaryHideHUDOnZoom": true,\n  "_firstLaunch": false\n}\n',
  },
  // Inventory Profiles Next draws its auto-refill icon on every hotbar slot by default; this keeps it to the inventory
  // (auto refill itself stays on). Format checked in the game, 7 Oct 2026: the icons were gone.
  ipn: {
    file: "inventoryprofilesnext/inventoryprofiles.json",
    content:
      '{\n    "ModSettings": {\n        "first_run": false\n    },\n    "AutoRefillSettings": {\n        "auto_refill_enable_horbar_indicator_icons": false\n    }\n}\n',
  },
  appleskin: {
    file: "appleskin.json5",
    content:
      '{\n\t"showFoodValuesInTooltip": true,\n\t"showFoodValuesInTooltipAlways": true,\n\t"showSaturationHudOverlay": true,\n\t"showFoodValuesHudOverlay": true,\n\t"showFoodValuesHudOverlayWhenOffhand": true,\n\t"showFoodExhaustionHudUnderlay": true,\n\t"showFoodHealthHudOverlay": true,\n\t"showVanillaAnimationsOverlay": true,\n\t"maxHudOverlayFlashAlpha": 0.65\n}\n',
  },
};

/** A mod or a resource pack in a list. tier: "core" = ticked, "more" = less important, not ticked. */
function mod(slug, title, why, extra = {}) {
  return { slug, kind: "mod", title, why, loaders: FABRIC_LIKE, ...extra };
}
function pack(slug, title, why, extra = {}) {
  return { slug, kind: "resourcepack", title, why, loaders: ALL_LOADERS, ...extra };
}

/* ------------------------------------------------------------------ */
/* Performance: its own card (it used to be a tab under every playstyle) */
/* ------------------------------------------------------------------ */
const PERFORMANCE_NOTE =
  "Sodium, Lithium, FerriteCore, ImmediatelyFast, Entity Culling and ScalableLux come with Reminth's own performance pack (Settings, or the Performance pack switch of the instance). These are on top of that.";

const PERFORMANCE = {
  core: [
    mod("sodium-extra", "Sodium Extra", "More video options for Sodium: turn off animations and particles you don't need, FPS and coordinates overlays."),
    mod("reeses-sodium-options", "Reese's Sodium Options", "Tidier, easier to read video settings screen for Sodium."),
    mod("moreculling", "More Culling", "Skips drawing hidden things (leaves, signs, item frames, inside of blocks) on top of Entity Culling."),
    mod("badoptimizations", "BadOptimizations", "Small speed-ups to lighting, sky and entity code. Nothing looks different."),
    mod("krypton", "Krypton", "A faster, lighter network stack: less work per packet on busy servers."),
    mod("debugify", "Debugify", "Fixes dozens of known Minecraft bugs, a few of them slowdowns."),
    mod("dynamic-fps", "Dynamic FPS", "Slows the game down while it's in the background, so your PC stays cool and other apps stay quick."),
    mod("fastquit", "FastQuit", "Lets you leave a world right away while it saves in the background."),
  ],
  more: [
    mod("ksyxis", "Ksyxis", "Opens worlds faster by not pre-loading the spawn area."),
    mod("no-chat-reports", "No Chat Reports", "Stops the game from signing your chat messages."),
    mod("iris", "Iris Shaders", "Shader support. Only if you want shaders: they cost a lot of FPS.", { shadersNote: true }),
    mod("c2me-fabric", "C2ME", "Loads singleplayer chunks on several CPU cores.", {
      experimental: true,
      warning: "Experimental (alpha/beta). It can freeze world creation or damage a world. Back up your worlds first.",
    }),
  ],
};

/* ------------------------------------------------------------------ */
/* the playstyles                                                      */
/* ------------------------------------------------------------------ */
// Researched again 6-7 Oct 2026 (Modrinth, builds for 26.2). Rules the owner set:
//  - what a player of that style really needs is RECOMMENDED (ticked), even when a few servers ban it (those carry a
//    "check the server rules" warning): crystal and anchor optimizers, Client Side Crystals, Xaero's maps;
//  - one mod or pack per job (no two small-totem packs, no two optimizers doing the same thing, no two sorters);
//  - nothing that plays for you (no macros, auto-totem, auto-clicker, fullbright, x-ray, freecam, hitbox helpers).
// Marlow's Crystal Optimizer (a crystal breaks the moment you hit it) and Client Side Crystals (a crystal shows the moment
// you place it) do different jobs and are made to work together.
const GOALS = {
  survival: {
    id: "survival",
    title: "Survival",
    blurb: "Long worlds, hardcore runs and survival servers like DonutSMP.",
    core: [
      mod("xaeros-minimap", "Xaero's Minimap", "A minimap in the corner of the screen, with waypoints.", { warning: MINIMAP }),
      mod("xaeros-world-map", "Xaero's World Map", "A full-screen map of everything you have explored. Goes with the minimap.", { warning: MINIMAP }),
      mod("appleskin", "AppleSkin", "Shows how much hunger and saturation food gives, right on the hunger bar.", { configs: [CFG.appleskin] }),
      mod("jade", "Jade", "Shows what block or mob you are looking at, and what is in it."),
      mod("inventory-profiles-next", "Inventory Profiles Next", "Sort chests and your inventory with one key, refill tools and blocks as they run out.", { configs: [CFG.ipn] }),
      mod("mouse-tweaks", "Mouse Tweaks", "Drag and scroll items around your inventory much faster."),
      mod("shulkerboxtooltip", "Shulker Box Tooltip", "See what is inside a shulker box without opening it."),
      mod("status-effect-bars", "Status Effect Bars", "A small bar under each potion effect shows how long it has left."),
      mod("enchantment-descriptions", "Enchantment Descriptions", "Says what every enchantment does, right in the tooltip."),
      mod("zoomify", "Zoomify", "Zoom key and scroll zoom with smooth movement.", { configs: [CFG.zoomify] }),
      mod("lambdynamiclights", "LambDynamicLights", "Torches and other lit items light up the area around you while you hold them."),
      mod("ukus-armor-hud", "uku's Armor HUD", "Shows your armor and its durability next to the hotbar.", { configs: [CFG.armorHud] }),
      mod("low-fire-reborn", "Low Fire Reborn", "Lowers the fire on your screen so you can still see.", { configs: [CFG.lowFire] }),
      mod("betterhurtcam", "BetterHurtCam", "Calms the screen shake when you take damage.", { configs: [CFG.betterhurtcam] }),
      mod("betterf3", "BetterF3", "A cleaner, colour-coded F3 debug screen."),
      mod("controlling", "Controlling", "A search box in Controls, and a button that shows keys bound twice."),
      mod("modmenu", "Mod Menu", "A button in the game's menu to see and change every mod's settings."),
      pack("clearer-slot-highlight", "Clearer Slot Highlight", "Makes the slot under your mouse easier to see."),
    ],
    more: [
      mod("jei", "Just Enough Items", "Look up any item's recipe and uses. Reminth starts it early, so the first inventory open doesn't freeze."),
      mod("continuity", "Continuity", "Connected glass and bookshelves, like in the trailers."),
      mod("ambientsounds", "AmbientSounds", "Wind, birds, water and caves sound alive."),
      mod("sound-physics-remastered", "Sound Physics Remastered", "Sound gets muffled behind walls and echoes in caves."),
      mod("not-enough-animations", "Not Enough Animations", "Eating, maps and climbing look right in third person."),
      mod("simple-voice-chat", "Simple Voice Chat", "Talk to people near you. The server needs the mod too."),
      mod("chat-heads", "Chat Heads", "Shows the sender's head next to chat messages."),
      pack("default-dark-mode", "Default Dark Mode", "Dark menus and inventory screens. Easy on the eyes at night."),
      pack("no-block-break-particles", "No Block Break Particles", "Removes the particles when you break blocks - clearer view, smoother game."),
      pack("unobtrusive-weather", "Unobtrusive Weather", "Smaller rain and snow particles."),
    ],
  },

  crystal: {
    id: "crystal",
    title: "Crystal PvP",
    blurb: "End crystals, anchors and totems on crystal PvP servers.",
    core: [
      mod("marlow-crystal-optimizer", "Marlow's Crystal Optimizer", "The most used crystal optimizer: a crystal breaks the moment you hit it, without waiting for the server.", { warning: RULES }),
      mod("clientsidecrystals", "Client Side Crystals", "A crystal shows the moment you place it. Made to work together with Marlow's optimizer.", { warning: RULES, configs: [CFG.clientCrystals] }),
      mod("anchoroptimizer", "Anchor Optimizer", "The most used anchor optimizer: respawn anchors explode right away on your screen.", { warning: RULES, configs: [CFG.anchors] }),
      mod("totemcounter", "TotemCounter", "Shows how many totems you have left and how many each player has popped.", { configs: [CFG.totemCounter] }),
      mod("status-effect-bars", "Status Effect Bars", "See how long strength, speed and fire resistance have left at a glance."),
      mod("low-fire-reborn", "Low Fire Reborn", "Lowers the fire on your screen so you can still see.", { configs: [CFG.lowFire] }),
      mod("betterhurtcam", "BetterHurtCam", "Calms the screen shake when you take damage.", { configs: [CFG.betterhurtcam] }),
      mod("ukus-armor-hud", "uku's Armor HUD", "Shows your armor and its durability next to the hotbar.", { configs: [CFG.armorHud] }),
      mod("ping-view", "Ping View", "Shows everyone's ping in the player list."),
      mod("zoomify", "Zoomify", "Zoom key and scroll zoom with smooth movement.", { configs: [CFG.zoomify] }),
      mod("appleskin", "AppleSkin", "Shows how much hunger and saturation food gives.", { configs: [CFG.appleskin] }),
      mod("mouse-tweaks", "Mouse Tweaks", "Drag and scroll items around your inventory much faster - restock between fights."),
      mod("modmenu", "Mod Menu", "A button in the game's menu to see and change every mod's settings."),
      pack("small-shield-totem", "Small Shield & Totem", "Smaller shield and totem in your hand, a small totem pop and small pop particles."),
      pack("small-tools-", "Small Tools", "Smaller swords, axes, pickaxes and shovels in your hand: more of the screen to see."),
      pack("no-explosion-particles", "No Explosion Particles", "Removes the explosion smoke so you can see during crystal fights."),
      pack("pvp-crosshair", "PvP Crosshair", "A small crosshair that doesn't get in the way."),
    ],
    more: [
      mod("crittweaks", "CritTweaks", "More and clearer critical-hit particles, so you see every crit land."),
      mod("hitcolorx", "HitColor X", "Choose the colour of the red flash when something is hit."),
      mod("clean-keystrokes", "Clean Keystrokes", "Shows the keys and mouse buttons you press on screen, with your clicks per second."),
      mod("shulkerboxtooltip", "Shulker Box Tooltip", "See what is inside a shulker box without opening it - handy for restocking kits."),
      mod("betterf3", "BetterF3", "A cleaner, colour-coded F3 debug screen."),
    ],
  },

  sword: {
    id: "sword",
    title: "Sword & Axe PvP",
    blurb: "Sword, axe, shield and minecart fights.",
    core: [
      mod("crittweaks", "CritTweaks", "More and clearer critical-hit particles, so you see every crit land."),
      mod("hitcolorx", "HitColor X", "Choose the colour of the red flash when something is hit."),
      mod("clean-keystrokes", "Clean Keystrokes", "Shows the keys and mouse buttons you press on screen, with your clicks per second."),
      mod("totemcounter", "TotemCounter", "Shows how many totems you have left and how many each player has popped.", { configs: [CFG.totemCounter] }),
      mod("status-effect-bars", "Status Effect Bars", "See how long strength, speed and fire resistance have left at a glance."),
      mod("low-fire-reborn", "Low Fire Reborn", "Lowers the fire on your screen so you can still see.", { configs: [CFG.lowFire] }),
      mod("betterhurtcam", "BetterHurtCam", "Calms the screen shake when you take damage.", { configs: [CFG.betterhurtcam] }),
      mod("ukus-armor-hud", "uku's Armor HUD", "Shows your armor and its durability next to the hotbar.", { configs: [CFG.armorHud] }),
      mod("ping-view", "Ping View", "Shows everyone's ping in the player list."),
      mod("zoomify", "Zoomify", "Zoom key and scroll zoom with smooth movement.", { configs: [CFG.zoomify] }),
      mod("appleskin", "AppleSkin", "Shows how much hunger and saturation food gives.", { configs: [CFG.appleskin] }),
      mod("mouse-tweaks", "Mouse Tweaks", "Drag and scroll items around your inventory much faster."),
      mod("modmenu", "Mod Menu", "A button in the game's menu to see and change every mod's settings."),
      pack("small-shield-totem", "Small Shield & Totem", "Smaller shield and totem in your hand, a small totem pop and small pop particles."),
      pack("small-tools-", "Small Tools", "Smaller swords, axes, pickaxes and shovels in your hand: more of the screen to see."),
      pack("pvp-crosshair", "PvP Crosshair", "A small crosshair that doesn't get in the way."),
    ],
    more: [
      pack("no-explosion-particles", "No Explosion Particles", "Removes the explosion smoke so you can see during a fight."),
      mod("betterf3", "BetterF3", "A cleaner, colour-coded F3 debug screen."),
      mod("shulkerboxtooltip", "Shulker Box Tooltip", "See what is inside a shulker box without opening it."),
      mod("jade", "Jade", "Shows what block or mob you are looking at."),
      pack("clearer-slot-highlight", "Clearer Slot Highlight", "Makes the slot under your mouse easier to see."),
      pack("default-dark-mode", "Default Dark Mode", "Dark menus and inventory screens."),
    ],
  },
};

// "PvP" is what the player picks: crystal and sword/axe fights share almost every mod, so one list
// (crystal's first, then whatever only the sword list has). The two separate lists stay as the source.
// An item that is recommended in either list stays recommended; the rest go to "More".
(function mergePvp() {
  const seen = new Set();
  const take = (items) => items.filter((i) => (seen.has(i.slug) ? false : (seen.add(i.slug), true)));
  const core = take([...GOALS.crystal.core, ...GOALS.sword.core]);
  const more = take([...GOALS.crystal.more, ...GOALS.sword.more]);
  GOALS.pvp = {
    id: "pvp",
    title: "PvP",
    blurb: "Crystal PvP and sword & axe fights: optimizers, totems, armor, a clear screen.",
    core,
    more,
  };
})();

const GOAL_IDS = Object.keys(GOALS);
// What the player is offered (any of them, together): four cards. "pvp" (crystal + sword merged) stays a valid id for
// old calls; "performance" is its own card.
const LISTED_GOALS = ["crystal", "sword", "survival", "performance"];
const PERFORMANCE_CARD = { id: "performance", title: "Performance", blurb: "More FPS and smoother frames." };

/* ------------------------------------------------------------------ */
/* pure parts                                                          */
/* ------------------------------------------------------------------ */

/** Pure: what the renderer shows on the first step - [{ id, title, blurb }]. */
function list() {
  return LISTED_GOALS.map((id) => (id === "performance" ? { ...PERFORMANCE_CARD } : { id, title: GOALS[id].title, blurb: GOALS[id].blurb }));
}

/** Pure: can an item go into an instance with this loader? Resource packs fit every loader. */
function fitsLoader(item, loader) {
  return item.loaders.includes(loader);
}

const strip = (i) => ({
  slug: i.slug,
  kind: i.kind,
  title: i.title,
  why: i.why,
  warning: i.warning || null,
  experimental: i.experimental === true,
  shadersNote: i.shadersNote === true,
});

/**
 * Pure: the tabs of the mod list for one instance. Items that can't go in this instance (wrong loader) are left out,
 * and an item shows once (in the first tab that has it).
 *  - one playstyle id (string): [that playstyle, Performance] - the original shape;
 *  - several (array, what the player ticked): one tab per playstyle, plus Performance only if it was ticked.
 */
function tabsFor(goalIds, instance) {
  const many = Array.isArray(goalIds);
  const ids = many ? goalIds.filter((id) => id === "performance" || GOALS[id]) : [goalIds];
  if (!many && !GOALS[goalIds]) return null;
  if (!ids.length) return null;
  const loader = (instance && instance.loader) || "vanilla";
  const keep = (items) => items.filter((i) => fitsLoader(i, loader));
  const seen = new Set();
  const dedupe = (items) => items.filter((i) => (seen.has(i.slug) ? false : (seen.add(i.slug), true)));
  // Recommended in ANY picked playstyle wins: such an item is never shown (unticked) under another one's "More".
  const withPerf = !many || ids.includes("performance");
  const recommended = new Set();
  for (const id of ids) if (GOALS[id]) for (const i of GOALS[id].core) recommended.add(i.slug);
  if (withPerf) for (const i of PERFORMANCE.core) recommended.add(i.slug);
  const notRecommended = (items) => items.filter((i) => !recommended.has(i.slug));
  const tabs = [];
  for (const id of ids) {
    if (id === "performance") continue;
    const goal = GOALS[id];
    tabs.push({ id: many ? id : "goal", title: goal.title, note: null, core: dedupe(keep(goal.core)).map(strip), more: dedupe(notRecommended(keep(goal.more))).map(strip) });
  }
  if (withPerf) {
    tabs.push({ id: "performance", title: "Performance", note: PERFORMANCE_NOTE, core: dedupe(keep(PERFORMANCE.core)).map(strip), more: dedupe(notRecommended(keep(PERFORMANCE.more))).map(strip) });
  }
  return tabs;
}

/** Pure: the most stable channel in a version list, or null. */
function bestChannel(versions) {
  const types = new Set((Array.isArray(versions) ? versions : []).map((v) => v && v.version_type));
  for (const channel of ["release", "beta", "alpha"]) if (types.has(channel)) return channel;
  return null;
}

/** Pure: every item of one or more playstyles and the performance list, by slug (for settings and installs). */
function itemBySlug(goalIds) {
  const ids = Array.isArray(goalIds) ? goalIds : [goalIds];
  const out = new Map();
  const items = [...PERFORMANCE.core, ...PERFORMANCE.more];
  for (const id of ids) if (GOALS[id]) items.push(...GOALS[id].core, ...GOALS[id].more);
  for (const i of items) if (!out.has(i.slug)) out.set(i.slug, i);
  return out;
}

/**
 * The tabs for one instance with each item checked against Modrinth for the instance's Minecraft version:
 * available true (a build exists) / false (none, or no such project) / null (couldn't ask), channel, installed.
 * deps: { modrinth, content } (the real ones; tests pass fakes). Never throws; a failed lookup is "unknown".
 */
async function listFor(goalIds, instance, deps = {}) {
  const tabs = tabsFor(goalIds, instance);
  if (!tabs) return null;
  const modrinth = deps.modrinth || require("./modrinth");
  const content = deps.content || require("./content");
  let projectIds = new Set();
  try {
    const manifest = await content.readManifest(instance.gameDir);
    projectIds = new Set(
      Object.values((manifest && manifest.files) || {})
        .filter((f) => f && f.projectId)
        .map((f) => f.projectId)
    );
  } catch {
    // nothing known installed
  }
  const check = async (item) => {
    const row = { ...item, available: null, channel: null, installed: null };
    try {
      const loaders = content.loadersFor(item.kind, instance);
      const versions = await modrinth.getProjectVersions(item.slug, { loaders, gameVersions: [instance.mcVersion] });
      const found = Array.isArray(versions) ? versions : [];
      row.available = found.length > 0;
      row.channel = bestChannel(found);
      row.installed = found.length ? projectIds.has(found[0].project_id) : false;
    } catch (err) {
      if (/\b404\b/.test(String((err && err.message) || ""))) {
        row.available = false;
        row.installed = false;
      }
    }
    return row;
  };
  for (const tab of tabs) {
    tab.core = await Promise.all(tab.core.map(check));
    tab.more = await Promise.all(tab.more.map(check));
  }
  // Each project's icon (one batch call; Modrinth takes slugs there too), shown next to its name like in Discover.
  try {
    const slugs = [...new Set(tabs.flatMap((t) => [...t.core, ...t.more]).map((r) => r.slug))];
    const projects = typeof modrinth.getProjects === "function" ? await modrinth.getProjects(slugs) : [];
    const icons = new Map();
    for (const p of Array.isArray(projects) ? projects : []) {
      if (p && p.icon_url) {
        if (p.slug) icons.set(p.slug, p.icon_url);
        if (p.id) icons.set(p.id, p.icon_url);
      }
    }
    for (const t of tabs) for (const r of [...t.core, ...t.more]) r.iconUrl = icons.get(r.slug) || null;
  } catch {
    // no icons: the names still show
  }
  return tabs;
}

/* ------------------------------------------------------------------ */
/* settings and resource pack switch-on (touch disk)                   */
/* ------------------------------------------------------------------ */

/**
 * Writes the ready-made settings of the chosen mods into <gameDir>/config, for every mod whose file is not there
 * yet. Returns the file names written. Never throws, never overwrites.
 */
async function writeConfigs(gameDir, goalIds, slugs) {
  const written = [];
  try {
    const items = itemBySlug(goalIds);
    const dir = path.join(gameDir, "config");
    await fsp.mkdir(dir, { recursive: true });
    for (const slug of slugs || []) {
      const item = items.get(slug);
      for (const cfg of (item && item.configs) || []) {
        const target = path.join(dir, cfg.file);
        try {
          await fsp.mkdir(path.dirname(target), { recursive: true });
          await fsp.writeFile(target, cfg.content, { encoding: "utf8", flag: "wx" });
          written.push(cfg.file);
        } catch (err) {
          if (!err || err.code !== "EEXIST") throw err;
        }
      }
    }
  } catch {
    // settings are a nicety: the mods still work with their own defaults
  }
  return written;
}

const PENDING_PACKS = path.join(".reminth", "pending-packs.json");

/** Pure: one list line ("key:[...]") of an options.txt with `ids` added at the end; the line is made when missing. */
function addToListLine(lines, key, ids, startWith) {
  let at = -1;
  let current = [...startWith];
  lines.forEach((l, i) => {
    if (l.startsWith(key + ":")) {
      at = i;
      try {
        const parsed = JSON.parse(l.slice(key.length + 1));
        if (Array.isArray(parsed)) current = parsed.filter((x) => typeof x === "string");
      } catch {
        // an unreadable line is replaced
      }
    }
  });
  for (const id of ids) if (!current.includes(id)) current.push(id); // later = on top
  const line = `${key}:${JSON.stringify(current)}`;
  if (at >= 0) lines[at] = line;
  else lines.push(line);
}

/**
 * Pure: an options.txt with `files` switched on as resource packs (on top of what is already on).
 * `old` names the files among them the game will call incompatible (they declare an old pack format although
 * many work fine): those are also listed as incompatibleResourcePacks, which is what "enable anyway" in the pack
 * screen does. A pack that IS compatible must not be listed there - the game then drops it from the selection.
 */
function withPacks(optionsText, files, old = []) {
  const text = typeof optionsText === "string" ? optionsText : "";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.length ? text.split(/\r?\n/) : [];
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  addToListLine(lines, "resourcePacks", files.map((f) => `file/${f}`), ["vanilla"]);
  const oldIds = old.map((f) => `file/${f}`);
  if (oldIds.length) addToListLine(lines, "incompatibleResourcePacks", oldIds, []);
  return lines.join(eol) + eol;
}

/** Pure: the pack format numbers a pack.mcmeta declares, as { min, max } (inclusive, major numbers), or null. */
function declaredFormats(meta) {
  const pack = meta && typeof meta === "object" ? meta.pack : null;
  if (!pack || typeof pack !== "object") return null;
  const major = (v) => (Array.isArray(v) ? Number(v[0]) : Number(v));
  if (pack.min_format !== undefined && pack.max_format !== undefined) {
    const min = major(pack.min_format);
    const max = major(pack.max_format);
    if (Number.isFinite(min) && Number.isFinite(max)) return { min, max, explicit: true };
  }
  const sf = pack.supported_formats;
  if (Array.isArray(sf) && sf.length >= 2) return { min: Number(sf[0]), max: Number(sf[1]) };
  if (typeof sf === "number") return { min: sf, max: sf };
  if (sf && typeof sf === "object" && sf.min_inclusive !== undefined) return { min: Number(sf.min_inclusive), max: Number(sf.max_inclusive) };
  if (Number.isFinite(Number(pack.pack_format))) return { min: Number(pack.pack_format), max: Number(pack.pack_format) };
  return null;
}

/** Pure: does a pack declaring `formats` count as compatible with a game whose resource pack format is `v`? null = can't tell. */
function formatsFit(formats, v) {
  if (!formats || !Number.isFinite(v)) return null;
  // Since pack format 65 the game wants min_format and max_format: a pack that only says "supported_formats up
  // to 255" for a newer game is refused ("declares support for version newer than 64 but is missing ...").
  if (v >= 65 && !formats.explicit && formats.max > 64) return false;
  return v >= formats.min && v <= formats.max;
}

/** The resource pack format of a client jar (version.json), or null. */
async function resourceFormatOf(clientJar) {
  try {
    const { "version.json": raw } = await require("./zipread").readEntries(clientJar, ["version.json"]);
    if (!raw) return null;
    const pv = JSON.parse(raw.toString("utf8").replace(/^\uFEFF/, "")).pack_version;
    if (typeof pv === "number") return pv;
    if (pv && typeof pv === "object") {
      const v = pv.resource_major !== undefined ? pv.resource_major : pv.resource;
      return Number.isFinite(Number(v)) ? Number(v) : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Does this pack file (a .zip) fit the game format v? true / false / null (unknown). */
async function packFits(zipFile, v) {
  try {
    const { "pack.mcmeta": raw } = await require("./zipread").readEntries(zipFile, ["pack.mcmeta"]);
    if (!raw) return null;
    return formatsFit(declaredFormats(JSON.parse(raw.toString("utf8").replace(/^\uFEFF/, ""))), v);
  } catch {
    return null;
  }
}

/**
 * Remembers resource pack files to switch on. They are applied by applyPendingPacks right before the next launch,
 * after the starting options.txt (if any) is written - so a brand-new instance gets both.
 */
async function queuePacks(gameDir, files) {
  try {
    const clean = (files || []).filter((f) => typeof f === "string" && f && !/[\\/]/.test(f));
    if (!clean.length) return false;
    const file = path.join(gameDir, PENDING_PACKS);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    let have = [];
    try {
      const parsed = JSON.parse(await fsp.readFile(file, "utf8"));
      if (Array.isArray(parsed)) have = parsed.filter((x) => typeof x === "string");
    } catch {
      // none yet
    }
    await fsp.writeFile(file, JSON.stringify([...new Set([...have, ...clean])]), "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Switches on the queued resource packs in options.txt (creating it if there is none). With the client jar
 * (its version.json says which pack format the game wants) the packs that declare an older format are also
 * accepted as "incompatible but wanted". Never throws.
 */
async function applyPendingPacks(gameDir, { clientJar } = {}) {
  try {
    const file = path.join(gameDir, PENDING_PACKS);
    let queued;
    try {
      queued = JSON.parse(await fsp.readFile(file, "utf8"));
    } catch {
      return false;
    }
    if (!Array.isArray(queued) || !queued.length) return false;
    // Only packs that are still there.
    const present = [];
    for (const f of queued) {
      try {
        await fsp.access(path.join(gameDir, "resourcepacks", f));
        present.push(f);
      } catch {
        // deleted since: nothing to switch on
      }
    }
    const v = clientJar ? await resourceFormatOf(clientJar) : null;
    const old = [];
    for (const f of present) {
      if (v !== null && (await packFits(path.join(gameDir, "resourcepacks", f), v)) === false) old.push(f);
    }
    const options = path.join(gameDir, "options.txt");
    let text = "";
    try {
      text = await fsp.readFile(options, "utf8");
    } catch {
      text = "";
    }
    if (present.length) await fsp.writeFile(options, withPacks(text, present, old), "utf8");
    await fsp.rm(file, { force: true });
    return present.length > 0;
  } catch {
    return false;
  }
}

module.exports = {
  GOALS,
  GOAL_IDS,
  LISTED_GOALS,
  PERFORMANCE_CARD,
  PERFORMANCE,
  PERFORMANCE_NOTE,
  CFG,
  list,
  tabsFor,
  itemBySlug,
  bestChannel,
  listFor,
  writeConfigs,
  withPacks,
  declaredFormats,
  formatsFit,
  resourceFormatOf,
  packFits,
  queuePacks,
  applyPendingPacks,
};
