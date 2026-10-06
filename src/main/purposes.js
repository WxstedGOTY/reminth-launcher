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
/* the performance tab, the same for every playstyle                   */
/* ------------------------------------------------------------------ */
const PERFORMANCE_NOTE =
  "Sodium, Lithium, FerriteCore, ImmediatelyFast, Entity Culling and ScalableLux come with Reminth's own performance pack (Settings, or the Performance pack switch of the instance). These are on top of that.";

const PERFORMANCE = {
  core: [
    mod("sodium-extra", "Sodium Extra", "More video options for Sodium: turn off animations and particles you don't need, FPS and coordinates overlays."),
    mod("reeses-sodium-options", "Reese's Sodium Options", "Tidier, easier to read video settings screen for Sodium."),
    mod("moreculling", "More Culling", "Skips drawing more hidden things (leaves, signs, item frames) on top of Entity Culling."),
    mod("badoptimizations", "BadOptimizations", "Small speed-ups to lighting, sky and entity code. Nothing looks different."),
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
const GOALS = {
  survival: {
    id: "survival",
    title: "Survival",
    blurb: "Long worlds, hardcore runs and survival servers like DonutSMP.",
    core: [
      mod("appleskin", "AppleSkin", "Shows how much hunger and saturation food gives, right on the hunger bar.", { configs: [CFG.appleskin] }),
      mod("mouse-tweaks", "Mouse Tweaks", "Drag and scroll items around your inventory much faster."),
      mod("shulkerboxtooltip", "Shulker Box Tooltip", "See what is inside a shulker box without opening it."),
      mod("betterf3", "BetterF3", "A cleaner, colour-coded F3 debug screen."),
      mod("zoomify", "Zoomify", "Zoom key and scroll zoom with smooth movement.", { configs: [CFG.zoomify] }),
      mod("jade", "Jade", "Shows what block or mob you are looking at, and what is in it."),
      mod("lambdynamiclights", "LambDynamicLights", "Torches and other lit items light up the area around you while you hold them."),
      mod("ukus-armor-hud", "uku's Armor HUD", "Shows your armor and its durability next to the hotbar.", { configs: [CFG.armorHud] }),
      mod("low-fire-reborn", "Low Fire Reborn", "Lowers the fire on your screen so you can still see.", { configs: [CFG.lowFire] }),
      mod("betterhurtcam", "BetterHurtCam", "Calms the screen shake when you take damage.", { configs: [CFG.betterhurtcam] }),
      mod("modmenu", "Mod Menu", "A button in the game's menu to see and change every mod's settings."),
      pack("clearer-slot-highlight", "Clearer Slot Highlight", "Makes the slot under your mouse easier to see."),
    ],
    more: [
      mod("xaeros-minimap", "Xaero's Minimap", "A minimap in the corner of the screen.", { warning: MINIMAP }),
      mod("xaeros-world-map", "Xaero's World Map", "A full-screen map of everything you have explored. Goes with the minimap.", { warning: MINIMAP }),
      mod("clientsort", "Client Sort", "A button to sort chests and your inventory."),
      mod("simple-voice-chat", "Simple Voice Chat", "Talk to people near you. The server needs the mod too."),
      mod("sound-physics-remastered", "Sound Physics Remastered", "Sound gets muffled behind walls and echoes in caves."),
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
      mod("marlow-crystal-optimizer", "Marlow's Crystal Optimizer", "Crystals blow up the moment you hit them on your screen, without waiting for the server.", {
        warning: `${RULES} ${ONE_OPTIMIZER}`,
      }),
      mod("anchoroptimizer", "Anchor Optimizer", "The same for respawn anchors: they explode right away on your screen.", { warning: RULES, configs: [CFG.anchors] }),
      mod("totemcounter", "TotemCounter", "Shows how many totems you have left and how many each player has popped.", { configs: [CFG.totemCounter] }),
      mod("cpvp", "Totem Tweaks", "A smaller totem pop animation, so you can see during a fight.", { configs: [CFG.totemTweaks] }),
      mod("betterhurtcam", "BetterHurtCam", "Calms the screen shake when you take damage.", { configs: [CFG.betterhurtcam] }),
      mod("low-fire-reborn", "Low Fire Reborn", "Lowers the fire on your screen so you can still see.", { configs: [CFG.lowFire] }),
      mod("ukus-armor-hud", "uku's Armor HUD", "Shows your armor and its durability next to the hotbar.", { configs: [CFG.armorHud] }),
      mod("clean-keystrokes", "Clean Keystrokes", "Shows the keys and mouse buttons you press on screen."),
      mod("cps-plus", "CPS+", "Shows your clicks per second."),
      mod("ping-view", "Ping View", "Shows everyone's ping in the player list."),
      mod("zoomify", "Zoomify", "Zoom key and scroll zoom with smooth movement.", { configs: [CFG.zoomify] }),
      mod("betterf3", "BetterF3", "A cleaner, colour-coded F3 debug screen."),
      mod("appleskin", "AppleSkin", "Shows how much hunger and saturation food gives.", { configs: [CFG.appleskin] }),
      mod("mouse-tweaks", "Mouse Tweaks", "Drag and scroll items around your inventory much faster."),
      mod("modmenu", "Mod Menu", "A button in the game's menu to see and change every mod's settings."),
      pack("crystal-vanilla-tweaks", "Crystal Vanilla Tweaks", "Crystal PvP look: low fire, small totem, clear crystals and more, in the vanilla style."),
      pack("pvp-crosshair", "PvP Crosshair", "A small crosshair that doesn't get in the way."),
      pack("no-explosion-particles", "No Explosion Particles", "Removes the explosion smoke so you can see during crystal fights."),
    ],
    more: [
      mod("clientsidecrystals", "Client Side Crystals", "Crystals show up instantly when you place them.", { warning: `${RULES} ${ONE_OPTIMIZER}`, configs: [CFG.clientCrystals] }),
      mod("kinds-anker-optimizer", "Kind's Anchor Optimizer", "Another anchor optimizer. Only if you don't use Anchor Optimizer.", { warning: RULES }),
      mod("hitcolorx", "HitColor X", "Choose the colour of the red flash when something is hit."),
      mod("shulkerboxtooltip", "Shulker Box Tooltip", "See what is inside a shulker box without opening it."),
      pack("short-pvp-swords", "PvP Swords", "Shorter swords, so they block less of the screen."),
      pack("low-shield-pack", "Low Shield", "Holds the shield lower so you can see over it."),
      pack("small-shield-totem", "Small Shield & Totem", "Smaller shield and totem models, and a small totem pop."),
    ],
  },

  sword: {
    id: "sword",
    title: "Sword & Axe PvP",
    blurb: "Sword, axe, shield and minecart fights.",
    core: [
      mod("betterhurtcam", "BetterHurtCam", "Calms the screen shake when you take damage.", { configs: [CFG.betterhurtcam] }),
      mod("low-fire-reborn", "Low Fire Reborn", "Lowers the fire on your screen so you can still see.", { configs: [CFG.lowFire] }),
      mod("ukus-armor-hud", "uku's Armor HUD", "Shows your armor and its durability next to the hotbar.", { configs: [CFG.armorHud] }),
      mod("clean-keystrokes", "Clean Keystrokes", "Shows the keys and mouse buttons you press on screen."),
      mod("cps-plus", "CPS+", "Shows your clicks per second."),
      mod("ping-view", "Ping View", "Shows everyone's ping in the player list."),
      mod("totemcounter", "TotemCounter", "Shows how many totems you have left and how many each player has popped.", { configs: [CFG.totemCounter] }),
      mod("cpvp", "Totem Tweaks", "A smaller totem pop animation, so you can see during a fight.", { configs: [CFG.totemTweaks] }),
      mod("zoomify", "Zoomify", "Zoom key and scroll zoom with smooth movement.", { configs: [CFG.zoomify] }),
      mod("betterf3", "BetterF3", "A cleaner, colour-coded F3 debug screen."),
      mod("appleskin", "AppleSkin", "Shows how much hunger and saturation food gives.", { configs: [CFG.appleskin] }),
      mod("mouse-tweaks", "Mouse Tweaks", "Drag and scroll items around your inventory much faster."),
      mod("hitcolorx", "HitColor X", "Choose the colour of the red flash when something is hit."),
      mod("modmenu", "Mod Menu", "A button in the game's menu to see and change every mod's settings."),
      pack("short-pvp-swords", "PvP Swords", "Shorter swords, so they block less of the screen."),
      pack("low-shield-pack", "Low Shield", "Holds the shield lower so you can see over it."),
      pack("small-shield-totem", "Small Shield & Totem", "Smaller shield and totem models, and a small totem pop."),
      pack("pvp-crosshair", "PvP Crosshair", "A small crosshair that doesn't get in the way."),
    ],
    more: [
      mod("shulkerboxtooltip", "Shulker Box Tooltip", "See what is inside a shulker box without opening it."),
      mod("jade", "Jade", "Shows what block or mob you are looking at."),
      pack("no-explosion-particles", "No Explosion Particles", "Removes the explosion smoke so you can see during a fight."),
      pack("short-swords-pack", "Short Swords", "A second short sword pack. Use one of the two, not both."),
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
    blurb: "Crystal PvP and sword & axe fights: totems, armor, keystrokes, a clear screen.",
    core,
    more,
  };
})();

const GOAL_IDS = Object.keys(GOALS);
// What the player is offered. crystal and sword stay valid ids (tests, old calls) but are not shown on their own.
const LISTED_GOALS = ["pvp", "survival"];

/* ------------------------------------------------------------------ */
/* pure parts                                                          */
/* ------------------------------------------------------------------ */

/** Pure: what the renderer shows on the first step - [{ id, title, blurb }]. */
function list() {
  return LISTED_GOALS.map((id) => ({ id, title: GOALS[id].title, blurb: GOALS[id].blurb }));
}

/** Pure: can an item go into an instance with this loader? Resource packs fit every loader. */
function fitsLoader(item, loader) {
  return item.loaders.includes(loader);
}

/** Pure: the two tabs for one playstyle on one instance. Items that can't go in this instance (wrong loader) are left out. */
function tabsFor(goalId, instance) {
  const goal = GOALS[goalId];
  if (!goal) return null;
  const loader = (instance && instance.loader) || "vanilla";
  const keep = (items) => items.filter((i) => fitsLoader(i, loader));
  const dedupe = (items, seen) => items.filter((i) => (seen.has(i.slug) ? false : (seen.add(i.slug), true)));
  const seen = new Set();
  const strip = (i) => ({
    slug: i.slug,
    kind: i.kind,
    title: i.title,
    why: i.why,
    warning: i.warning || null,
    experimental: i.experimental === true,
    shadersNote: i.shadersNote === true,
  });
  const gameplay = { id: "goal", title: goal.title, note: null, core: dedupe(keep(goal.core), seen).map(strip), more: dedupe(keep(goal.more), seen).map(strip) };
  const perf = { id: "performance", title: "Performance", note: PERFORMANCE_NOTE, core: dedupe(keep(PERFORMANCE.core), seen).map(strip), more: dedupe(keep(PERFORMANCE.more), seen).map(strip) };
  return [gameplay, perf];
}

/** Pure: the most stable channel in a version list, or null. */
function bestChannel(versions) {
  const types = new Set((Array.isArray(versions) ? versions : []).map((v) => v && v.version_type));
  for (const channel of ["release", "beta", "alpha"]) if (types.has(channel)) return channel;
  return null;
}

/** Pure: every item of a playstyle and the performance tab, by slug (for settings and installs). */
function itemBySlug(goalId) {
  const goal = GOALS[goalId];
  const out = new Map();
  for (const i of [...PERFORMANCE.core, ...PERFORMANCE.more, ...(goal ? [...goal.core, ...goal.more] : [])]) if (!out.has(i.slug)) out.set(i.slug, i);
  return out;
}

/**
 * The tabs for one instance with each item checked against Modrinth for the instance's Minecraft version:
 * available true (a build exists) / false (none, or no such project) / null (couldn't ask), channel, installed.
 * deps: { modrinth, content } (the real ones; tests pass fakes). Never throws; a failed lookup is "unknown".
 */
async function listFor(goalId, instance, deps = {}) {
  const tabs = tabsFor(goalId, instance);
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
  return tabs;
}

/* ------------------------------------------------------------------ */
/* settings and resource pack switch-on (touch disk)                   */
/* ------------------------------------------------------------------ */

/**
 * Writes the ready-made settings of the chosen mods into <gameDir>/config, for every mod whose file is not there
 * yet. Returns the file names written. Never throws, never overwrites.
 */
async function writeConfigs(gameDir, goalId, slugs) {
  const written = [];
  try {
    const items = itemBySlug(goalId);
    const dir = path.join(gameDir, "config");
    await fsp.mkdir(dir, { recursive: true });
    for (const slug of slugs || []) {
      const item = items.get(slug);
      for (const cfg of (item && item.configs) || []) {
        const target = path.join(dir, cfg.file);
        try {
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
