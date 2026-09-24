"use strict";
const { app, BrowserWindow, ipcMain, shell, screen } = require("electron");
const path = require("path");
const os = require("os");
const fs = require("fs");

const minecraft = require("./minecraft");
const msAuth = require("./msAuth");
const store = require("./store");
const paths = require("./paths");
const config = require("./config");
const gameData = require("./gameData");
const skin = require("./skin");
const skinLibrary = require("./skinLibrary");
const modrinth = require("./modrinth");
const catalogCache = require("./catalogCache");
const instances = require("./instances");
const content = require("./content");
const mrpack = require("./mrpack");
const logs = require("./logs");
const serverPing = require("./serverPing");
const streamer = require("./streamer");
const entitlements = require("./entitlements");
const loaders = require("./loaders");
const updater = require("./updater");
const { fetchJson } = require("./downloader");

let win;
let cachedAccount = null;
let cachedSettings = store.DEFAULT_SETTINGS;
// instanceId -> { child, startedAt }. One game per instance at a time: two
// copies of the same instance would write the same worlds at once.
const running = new Map();

// Must run before app.whenReady() - Electron ignores this call once the GPU
// process has started. Read synchronously on purpose: an async read can
// resolve after the app is ready, in which case the setting is silently
// ignored and the toggle looks broken forever.
try {
  const raw = fs.readFileSync(paths.SETTINGS_FILE, "utf8");
  if (JSON.parse(raw).hardwareAcceleration === false) app.disableHardwareAcceleration();
} catch {
  // no settings file yet, or unreadable - acceleration stays on (the default)
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  // A frameless (frame:false) window that Windows opens at, or larger than,
  // the monitor's usable work area gets silently treated as maximized - DWM
  // fires the same native "maximized" state change it would for a real
  // maximize() call. The custom title bar then shows the restore icon (two
  // overlapping squares) and the window fills the screen - both read as
  // "opens fullscreen by default". Sizing off the actual work area, capped
  // well under 100% of it, gives a real windowed size to restore down to -
  // the launcher itself opens maximized (see ready-to-show below).
  const { width: waWidth, height: waHeight } = screen.getPrimaryDisplay().workAreaSize;
  const winWidth = Math.max(1000, Math.min(1320, Math.round(waWidth * 0.85)));
  const winHeight = Math.max(660, Math.min(840, Math.round(waHeight * 0.85)));

  win = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    minWidth: 1000,
    minHeight: 660,
    center: true,
    show: false, // shown maximized on ready-to-show, so it never flashes windowed first
    backgroundColor: "#07090f",
    frame: false, // custom title bar drawn in renderer, matches the brand's borderless look
    icon: path.join(__dirname, "..", "..", "assets", "icon.png"), // taskbar/alt-tab icon
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  // The window is frameless: no back button, no address bar. If anything
  // navigated it away from index.html the launcher would be dead until it
  // was killed from Task Manager. Every outbound link opens in the real
  // browser instead, and the window itself is pinned to its own page.
  const openExternally = (url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url === win.webContents.getURL()) return; // an in-place reload is fine
    event.preventDefault();
    openExternally(url);
  });

  // frame:false means Windows' own maximize/restore button doesn't exist -
  // the renderer draws its own and needs to know which icon to show.
  win.on("maximize", () => send("window:maximized", true));
  win.on("unmaximize", () => send("window:maximized", false));

  // Opens maximized; restoring drops back to the windowed size set above.
  // maximize() on a still-hidden window doesn't reliably emit "maximize" on
  // Windows, which left the title bar showing the maximize icon on a
  // maximized window - so send the real state once it's on screen instead
  // of relying on the event. By ready-to-show renderer.js is listening.
  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
    send("window:maximized", win.isMaximized());
  });
}

app.whenReady().then(async () => {
  cachedSettings = await store.loadSettings();
  streamer.init({ notify: send });
  createWindow();
  cachedAccount = await store.loadAccount();
  if (cachedAccount) {
    win.webContents.once("did-finish-load", () => send("auth:restored", { username: cachedAccount.username }));
  }
  win.webContents.once("did-finish-load", async () => {
    streamer.configure(cachedSettings);
    await watchActiveInstance();
    // Pull any new logs into the permanent archive for every instance.
    for (const inst of await instances.list()) logs.importInstanceLogs(inst).catch(() => {});
    warmAllCachesIfStale();
    // After load, so the renderer is listening for "update:status".
    updater.init({ notify: send });
  });
});

ipcMain.on("update:install", () => updater.installNow());

app.on("window-all-closed", () => {
  streamer.shutdown();
  if (process.platform !== "darwin") app.quit();
});

// ---- window chrome (custom title bar) ----
ipcMain.on("window:minimize", () => win.minimize());
ipcMain.on("window:close", () => win.close());
ipcMain.on("window:maximizeToggle", () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
// The renderer asks on load rather than trusting it caught the one-off
// "window:maximized" push - that push is lost on any reload of the page.
ipcMain.handle("window:isMaximized", () => Boolean(win && !win.isDestroyed() && win.isMaximized()));

// ---- sign in with Microsoft (device code flow) ----
ipcMain.handle("auth:signIn", async () => {
  const account = await msAuth.signIn({
    onCode: (data) => send("auth:code", data),
    onWaiting: () => send("auth:waiting"),
  });
  cachedAccount = account;
  await store.saveAccount(account);
  return { username: account.username };
});

/**
 * The renderer asks for this on startup instead of relying only on the
 * auth:restored push - that fires once, so a reloaded page would otherwise
 * claim "Not signed in" while this process still holds a good account.
 */
ipcMain.handle("auth:current", () => (cachedAccount ? { username: cachedAccount.username } : null));

ipcMain.handle("auth:signOut", async () => {
  cachedAccount = null;
  await store.clearAccount();
  return { ok: true };
});

/** A Minecraft token is good for ~24h; refresh before anything that calls Mojang with it. */
async function freshAccount() {
  if (!cachedAccount) throw new Error("Sign in first.");
  try {
    cachedAccount = await msAuth.refreshSession(cachedAccount.msRefreshToken);
    await store.saveAccount(cachedAccount);
  } catch {
    // use what we have; Mojang will say if it's really dead
  }
  return cachedAccount;
}

// ---- skins ----
ipcMain.handle("auth:skin", async () => {
  if (!cachedAccount || !cachedAccount.uuid) return { error: "Not signed in." };
  return skin.getSkin(cachedAccount);
});

ipcMain.handle("skin:profile", async () => skin.getProfile(await freshAccount()));

function pngFromDataUrl(dataUrl) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) throw new Error("That isn't a PNG image.");
  const buf = Buffer.from(m[1], "base64");
  const problem = skin.validateSkinPng(buf);
  if (problem) throw new Error(problem);
  return buf;
}

/**
 * Applies a skin (+ optionally a cape choice) to the account and keeps it
 * in the saved-skins library. capeId: undefined = leave the cape alone,
 * null = hide it, a string = wear that cape.
 */
ipcMain.handle("skin:apply", async (_e, { dataUrl, variant, name, source, capeId }) => {
  const png = pngFromDataUrl(dataUrl);
  const account = await freshAccount();
  await skin.uploadSkin(account, png, variant);
  if (capeId !== undefined) await skin.setCape(account, capeId);
  const entry = await skinLibrary.add({ png, variant, name, source, used: true });
  return { ok: true, entry };
});

ipcMain.handle("skin:setCape", async (_e, capeId) => skin.setCape(await freshAccount(), capeId || null));
ipcMain.handle("skin:library", async () => skinLibrary.list());
ipcMain.handle("skin:librarySave", async (_e, { dataUrl, variant, name, source }) =>
  skinLibrary.add({ png: pngFromDataUrl(dataUrl), variant, name, source, used: false })
);
ipcMain.handle("skin:libraryRename", async (_e, id, name) => skinLibrary.rename(id, name));
ipcMain.handle("skin:libraryRemove", async (_e, id) => skinLibrary.remove(id));
ipcMain.handle("skin:lookup", async (_e, username) => skin.lookupByUsername(username));
ipcMain.handle("skin:defaults", async () => {
  // Read out of whichever client jar is already on this computer.
  const candidates = [config.MINECRAFT_VERSION];
  try {
    for (const d of await fs.promises.readdir(paths.VERSIONS_DIR)) if (!candidates.includes(d)) candidates.push(d);
  } catch {
    // no versions yet
  }
  for (const v of candidates) {
    const jar = path.join(paths.VERSIONS_DIR, v, `${v}.jar`);
    if (!fs.existsSync(jar)) continue;
    try {
      const list = await skin.defaultSkins(jar);
      if (list.length) return { skins: list };
    } catch {
      // try the next jar
    }
  }
  return { skins: [], error: "Play once (or press Verify files) so Minecraft's own files are downloaded - the default skins come from them." };
});

// ---- launcher info ----
ipcMain.handle("debug:paths", () => ({ MODS_DIR: paths.MODS_DIR, GAME_DIR: paths.GAME_DIR, ROOT: paths.ROOT }));

ipcMain.handle("app:info", () => ({
  appVersion: app.getVersion(),
  minecraftVersion: config.MINECRAFT_VERSION,
  fabricLoaderVersion: config.FABRIC_LOADER_VERSION,
  defaultMaxMemoryMb: minecraft.computeDefaultMaxMemoryMb(os.totalmem()),
  totalMemoryMb: Math.round(os.totalmem() / (1024 * 1024)),
  plan: entitlements.summary(),
  capturesDir: paths.CAPTURES_DIR,
  managedMods: [
    { name: "ReminthHUD", tag: "HUD", note: "Reminth's own in-game HUD: FPS, coordinates and facing. Press H in game to toggle it. Switch it on or off per instance in Edit.", required: false },
    { name: "Fabric API", tag: "Library", note: "ReminthHUD can't load without it, so Reminth installs it alongside.", required: true },
  ],
}));

ipcMain.handle("settings:get", async () => {
  cachedSettings = await store.loadSettings();
  return cachedSettings;
});

ipcMain.handle("settings:set", async (_e, partial) => {
  const before = cachedSettings;
  cachedSettings = await store.saveSettings(partial);
  const { hotkeyProblems } = streamer.configure(cachedSettings);
  if (before.activeInstance !== cachedSettings.activeInstance) await watchActiveInstance();
  return { ...cachedSettings, _hotkeyProblems: hotkeyProblems };
});

// ---- instances ----
async function activeInstance() {
  return (await instances.get(cachedSettings.activeInstance)) || (await instances.get(instances.DEFAULT_ID));
}

function withRunning(inst) {
  return { ...inst, running: running.has(inst.id) };
}

ipcMain.handle("instances:list", async () => (await instances.list()).map(withRunning));

/**
 * Checked when the instance is created or changed, not at first launch, so
 * an unsupported version/loader pair is refused with a clear message
 * instead of making an instance that can't start. A pinned build must be one
 * the loader actually publishes for that version; otherwise the
 * recommended one is used.
 */
async function resolveLoaderVersion(loader, mc, wanted) {
  if (loader === "vanilla") return null;
  const list = await loaders.loaderVersions(loader, mc);
  if (!list.length) throw new Error(`${loaders.LOADER_NAMES[loader]} doesn't have a build for Minecraft ${mc} yet.`);
  if (wanted && list.some((e) => e.id === wanted)) return wanted;
  return (list.find((e) => e.recommended) || list[0]).id;
}

ipcMain.handle("instances:create", async (_e, { name, mcVersion, loader, loaderVersion, hud }) => {
  const l = loaders.LOADERS.includes(loader) ? loader : "vanilla";
  const lv = await resolveLoaderVersion(l, mcVersion, loaderVersion);
  const inst = await instances.create({ name, mcVersion, loader: l, loaderVersion: lv, hud: hud === true });
  return withRunning(inst);
});

ipcMain.handle("instances:update", async (_e, id, patch) => {
  if (running.has(id)) throw new Error("Close the game first - that instance is running.");
  const clean = { ...(patch || {}) };
  if ("loader" in clean && !loaders.LOADERS.includes(clean.loader)) delete clean.loader;
  const current = await instances.require(id);
  const loader = clean.loader || current.loader;
  const mc = clean.mcVersion || current.mcVersion;
  const same = loader === current.loader && mc === current.mcVersion;
  const wanted = "loaderVersion" in clean ? clean.loaderVersion : same ? current.loaderVersion : null;
  // Only ask the loader's servers when something about the loader changed,
  // so renaming an instance still works offline.
  if (!same || wanted !== current.loaderVersion) {
    clean.loaderVersion = await resolveLoaderVersion(loader, mc, wanted);
  } else {
    delete clean.loaderVersion;
  }
  return withRunning(await instances.update(id, clean));
});

ipcMain.handle("instances:delete", async (_e, id) => {
  if (running.has(id)) throw new Error("Close the game first - that instance is running.");
  await instances.remove(id);
  if (cachedSettings.activeInstance === id) {
    cachedSettings = await store.saveSettings({ activeInstance: instances.DEFAULT_ID });
    await watchActiveInstance();
  }
  return { ok: true };
});

/**
 * Every Minecraft version Mojang lists, marked with which loaders support
 * it. A loader whose server couldn't be reached is reported in `unknown`
 * rather than marking every version unsupported. Cached 15 minutes.
 */
let versionCache = null;
ipcMain.handle("versions:list", async () => {
  if (versionCache && Date.now() - versionCache.at < 15 * 60 * 1000) return versionCache.data;
  const [manifest, support] = await Promise.all([fetchJson(config.MOJANG_VERSION_MANIFEST_URL), loaders.supportedGameVersions()]);
  const sets = {};
  const unknown = [];
  for (const l of ["fabric", "quilt", "forge", "neoforge"]) {
    if (support[l]) sets[l] = new Set(support[l]);
    else unknown.push(l);
  }
  const data = {
    latest: manifest.latest,
    unknown,
    versions: manifest.versions.map((v) => ({
      id: v.id,
      type: v.type,
      releaseTime: v.releaseTime,
      fabric: sets.fabric ? sets.fabric.has(v.id) : true,
      quilt: sets.quilt ? sets.quilt.has(v.id) : true,
      forge: sets.forge ? sets.forge.has(v.id) : true,
      neoforge: sets.neoforge ? sets.neoforge.has(v.id) : true,
    })),
  };
  versionCache = { at: Date.now(), data };
  return data;
});

/** Builds of one loader for one Minecraft version, newest first (for the build picker). */
ipcMain.handle("loaders:versions", async (_e, loader, mc) => {
  if (!loaders.LOADERS.includes(loader) || loader === "vanilla" || !instances.isValidVersionId(mc)) return [];
  return (await loaders.loaderVersions(loader, mc)).slice(0, 400);
});

/** Which Minecraft versions have a bundled ReminthHUD build. */
ipcMain.handle("hud:builds", async () =>
  (await minecraft.bundledReminthHudBuilds()).map((b) => ({ version: b.version, minecraft: b.minecraft }))
);
ipcMain.handle("hud:supports", async (_e, mc) => Boolean(await minecraft.findReminthHudFor(String(mc))));

// ---- content (mods, packs, shaders, data packs) ----
async function watchActiveInstance() {
  const inst = await activeInstance();
  if (!inst) return;
  await content.watchInstance(inst.gameDir, () => send("content:changed", { instanceId: inst.id }));
}

ipcMain.handle("content:list", async (_e, id) => content.listAll((await instances.require(id)).gameDir));
ipcMain.handle("content:setEnabled", async (_e, id, item, enabled) =>
  content.setEnabled((await instances.require(id)).gameDir, item, Boolean(enabled))
);
ipcMain.handle("content:remove", async (_e, id, item) =>
  content.remove((await instances.require(id)).gameDir, item, (full) => shell.trashItem(full))
);
ipcMain.handle("content:install", async (_e, id, request) => {
  const inst = await instances.require(id);
  return content.install(inst, request, (p) => send("content:progress", { instanceId: id, op: "install", ...p }));
});
ipcMain.handle("content:checkUpdates", async (_e, id) => content.checkUpdates(await instances.require(id)));
ipcMain.handle("content:applyUpdates", async (_e, id, updates) => {
  if (running.has(id)) throw new Error("Close the game first - Windows won't let files in use be replaced.");
  const inst = await instances.require(id);
  return content.applyUpdates(inst, Array.isArray(updates) ? updates.slice(0, 500) : [], (p) =>
    send("content:progress", { instanceId: id, op: "update", ...p })
  );
});

ipcMain.handle("modpack:install", async (_e, request) =>
  withRunning(await mrpack.installModpack(request || {}, (p) => send("modpack:progress", p)))
);

// ---- what the player has actually played (read-only, see gameData.js) ----
ipcMain.handle("game:recent", async () => {
  try {
    return await gameData.recentActivity(cachedAccount && cachedAccount.uuid, 5, await instances.list());
  } catch (err) {
    return { recent: [], worlds: [], servers: [], worldCount: 0, serverCount: 0, totalPlayTimeTicks: 0, totalPlayTimeSeconds: 0, error: err.message };
  }
});

ipcMain.handle("game:instanceData", async (_e, id) => {
  const inst = await instances.require(id);
  try {
    return await gameData.recentActivity(cachedAccount && cachedAccount.uuid, 5, [inst]);
  } catch (err) {
    return { recent: [], worlds: [], servers: [], worldCount: 0, serverCount: 0, totalPlayTimeTicks: 0, error: err.message };
  }
});

ipcMain.handle("game:stats", async () => {
  try {
    return await gameData.playerStats(cachedAccount && cachedAccount.uuid, await instances.list());
  } catch (err) {
    return { found: false, error: err.message };
  }
});

const FOLDERS = { game: "", mods: "mods", resourcepacks: "resourcepacks", shaderpacks: "shaderpacks", screenshots: "screenshots", logs: "logs", saves: "saves" };
ipcMain.handle("instance:openFolder", async (_e, which, id) => {
  const inst = id ? await instances.require(id) : await activeInstance();
  const sub = FOLDERS[which];
  const target = sub === undefined ? inst.gameDir : path.join(inst.gameDir, sub);
  await fs.promises.mkdir(target, { recursive: true });
  const result = await shell.openPath(target);
  if (result) throw new Error(result);
  return { ok: true };
});

ipcMain.handle("captures:openFolder", async () => {
  await fs.promises.mkdir(paths.CAPTURES_DIR, { recursive: true });
  const result = await shell.openPath(paths.CAPTURES_DIR);
  if (result) throw new Error(result);
  return { ok: true };
});

// ---- logs ----
ipcMain.handle("logs:list", async (_e, id) => logs.listLogs(await instances.require(id)));
ipcMain.handle("logs:read", async (_e, id, logId) => logs.readLog(await instances.require(id), logId));

// ---- servers ----
ipcMain.handle("servers:search", async (_e, params) => modrinth.searchServers(params || {}));
ipcMain.handle("servers:ping", async (_e, addresses) => {
  const list = (Array.isArray(addresses) ? addresses : []).slice(0, 40).map(String);
  const out = {};
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const addr = list[i++];
      out[addr] = await serverPing.ping(addr);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, list.length) }, worker));
  return out;
});
ipcMain.handle("servers:add", async (_e, id, server) => gameData.addServer((await instances.require(id)).gameDir, server || {}));

// ---- Modrinth catalog (live browse - see src/main/modrinth.js) ----
// The renderer never talks to api.modrinth.com directly - connect-src stays 'none'.
ipcMain.handle("catalog:search", async (_e, params) => modrinth.searchProjects(params));
ipcMain.handle("catalog:project", async (_e, idOrSlug) => modrinth.getProject(idOrSlug));
ipcMain.handle("catalog:projectVersions", async (_e, idOrSlug, filters) => modrinth.getProjectVersions(idOrSlug, filters));
ipcMain.handle("catalog:dependencies", async (_e, idOrSlug) => modrinth.getProjectDependencies(idOrSlug));
ipcMain.handle("catalog:tags", async (_e, type) => modrinth.getTags(type));
ipcMain.handle("catalog:checkUpdates", async (_e, hashes, filters) => modrinth.checkForUpdates(hashes, filters));

// ---- local catalog cache (top-N by downloads, instant + offline-capable) ----
ipcMain.handle("catalog:browseCached", async (_e, params) => catalogCache.getCached(params));
ipcMain.handle("catalog:bySlugs", async (_e, projectType, slugs) => catalogCache.getBySlugs(projectType, slugs));
ipcMain.handle("catalog:warmStatus", async (_e, projectType) => catalogCache.getWarmStatus(projectType));
ipcMain.handle("catalog:warmStart", async (_e, projectType, targetCount) => {
  // Each 100 of targetCount is one request to Modrinth - clamp it.
  const requested = Number(targetCount);
  const target = Number.isFinite(requested) ? Math.min(20000, Math.max(100, Math.round(requested))) : 1000;
  if (!CATALOG_PROJECT_TYPES.includes(projectType)) throw new Error(`Unknown catalog type: ${projectType}`);
  return catalogCache.warmCatalog(projectType, { targetCount: target, onProgress: (status) => send("catalog:warmProgress", status) });
});

// Every Browse tab's project type, warmed one after another in the
// background once a day (a single paced request stream, never several).
const CATALOG_PROJECT_TYPES = ["mod", "modpack", "resourcepack", "datapack", "shader"];
const CACHE_STALE_MS = 24 * 60 * 60 * 1000;
const CACHE_WARM_TARGET = 10000;
async function warmCacheIfStale(projectType) {
  const status = catalogCache.getWarmStatus(projectType);
  const isStale = status.state !== "done" || Date.now() - status.updated_at > CACHE_STALE_MS;
  if (!isStale || status.state === "running") return;
  try {
    await catalogCache.warmCatalog(projectType, { targetCount: CACHE_WARM_TARGET, onProgress: (s) => send("catalog:warmProgress", s) });
  } catch (err) {
    console.error(`Catalog warm (${projectType}) failed:`, err.message);
  }
}
async function warmAllCachesIfStale() {
  for (const type of CATALOG_PROJECT_TYPES) await warmCacheIfStale(type);
}

// ---- streamer mode ----
ipcMain.handle("streamer:status", () => streamer.status());
ipcMain.handle("streamer:screenshot", () => streamer.takeScreenshot());
ipcMain.handle("streamer:clip", () => streamer.saveClip());
ipcMain.handle("streamer:captures", async () => streamer.listCaptures(await instances.list()));
ipcMain.handle("streamer:open", async (_e, file, how) => streamer.openCapture(file, await instances.list(), how));
ipcMain.handle("streamer:delete", async (_e, file) => streamer.deleteCapture(file, await instances.list()));

// ---- install + play ----
/**
 * Install and Play both call ensureInstalled, and it isn't safe to run
 * twice at once for the same instance (same files, same natives folder).
 * One in-flight run per instance, shared by every caller.
 */
const installsInFlight = new Map();
function ensureInstalledOnce(inst) {
  if (!installsInFlight.has(inst.id)) {
    const run = minecraft
      .ensureInstalled(inst, (progress) => send("install:progress", { instanceId: inst.id, ...progress }))
      .finally(() => installsInFlight.delete(inst.id));
    installsInFlight.set(inst.id, run);
  }
  return installsInFlight.get(inst.id);
}

ipcMain.handle("install:run", async (_e, id) => {
  const inst = id ? await instances.require(id) : await activeInstance();
  const installResult = await ensureInstalledOnce(inst);
  send("install:done", { instanceId: inst.id });
  return { removedMods: installResult.removedMods || [] };
});

ipcMain.handle("play:run", async (_e, options = {}) => {
  if (!cachedAccount) throw new Error("Not signed in.");
  const inst = options.instanceId ? await instances.require(options.instanceId) : await activeInstance();
  if (running.has(inst.id)) throw new Error("Minecraft is already running.");
  // Claimed synchronously, before the first await below, so a second click
  // can't sail past the check and start a second copy on the same worlds.
  running.set(inst.id, { child: null, startedAt: Date.now() });
  try {
    return await startGame(inst, options.join);
  } catch (err) {
    running.delete(inst.id); // never leave Play wedged behind a failed launch
    throw err;
  }
});

async function startGame(inst, join) {
  // A stored refresh token can go stale; refresh silently before launching.
  await freshAccount().catch(() => {});

  const installResult = await ensureInstalledOnce(inst);
  send("install:done", { instanceId: inst.id });

  cachedSettings = await store.loadSettings();
  const defaultMb = minecraft.computeDefaultMaxMemoryMb(os.totalmem());
  // Whatever settings.json says, never above what this machine can spare.
  const maxMemoryMb = Math.min(cachedSettings.maxMemoryMb || defaultMb, entitlements.ramCapMb());
  const safeJoin = join && typeof join.host === "string" && /^[A-Za-z0-9.\-_]{1,255}$/.test(join.host)
    ? { host: join.host, port: Number(join.port) > 0 && Number(join.port) < 65536 ? Number(join.port) : 25565 }
    : null;

  const child = minecraft.launch(
    installResult,
    cachedAccount,
    (crashInfo) => {
      finishSession(inst, false);
      send("play:crashed", { instanceId: inst.id, ...crashInfo });
    },
    { ...cachedSettings, maxMemoryMb, appVersion: app.getVersion() },
    inst,
    { join: safeJoin }
  );

  if (!child) {
    running.delete(inst.id);
    return { launched: false };
  }
  running.set(inst.id, { child, startedAt: Date.now() });
  streamer.gameStarted();
  send("play:started", { instanceId: inst.id });
  child.once("exit", () => finishSession(inst, true));
  child.once("error", () => finishSession(inst, false));

  if (cachedSettings.launchMinimized) win.minimize();
  return { launched: true };
}

function finishSession(inst, played) {
  const session = running.get(inst.id);
  if (!session) return;
  running.delete(inst.id);
  if (session.child) streamer.gameStopped();
  if (played) instances.recordSession(inst.id, session.startedAt, Date.now()).catch(() => {});
  // Crash reports appear right away; the session's log is rolled by the
  // game on its next start and archived then.
  setTimeout(() => logs.importInstanceLogs(inst).catch(() => {}), 1500);
  send("play:exited", { instanceId: inst.id });
}
