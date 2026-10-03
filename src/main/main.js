"use strict";
const { app, BrowserWindow, ipcMain, shell, screen } = require("electron");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { spawn: spawnProcess } = require("child_process");

const minecraft = require("./minecraft");
const java = require("./java");
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
const compat = require("./compat");
const migrate = require("./migrate");
const { fetchJson } = require("./downloader");

let win;
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

// One Reminth at a time. A second process has its own `running` map (so the
// same instance could be launched twice onto the same worlds), and the two
// race each other writing account.json / settings.json and registering the
// global hotkeys. The second copy quits and the first comes to the front.
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}

// A stray rejection or throw in the main process otherwise ends up as an
// Electron error dialog or a silent exit with nothing to go on. Logging
// only: nothing is swallowed that wasn't already unhandled, and in a dev
// run the full stack still goes to the console.
process.on("unhandledRejection", (reason) => logCrash("unhandledRejection", reason));
process.on("uncaughtExceptionMonitor", (err) => logCrash("uncaughtException", err));

function logCrash(kind, err) {
  // Everything inside the try, console included: writing to a closed
  // stdout (EPIPE) or stringifying an odd value can throw too, and a throw
  // from the crash logger is a second crash.
  try {
    const text = err && err.stack ? err.stack : String(err);
    console.error(`[main] ${kind}:`, text);
    const file = path.join(paths.ROOT, "main-errors.log");
    // Keep it small: start over past 256 KB rather than growing forever.
    if (fs.existsSync(file) && fs.statSync(file).size > 256 * 1024) fs.rmSync(file, { force: true });
    fs.mkdirSync(paths.ROOT, { recursive: true });
    fs.appendFileSync(file, `${new Date().toISOString()} ${kind}: ${scrubSecrets(text).slice(0, 4000)}\n`);
  } catch {
    // logging must never be the thing that crashes
  }
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
  // Closing the main window must quit the whole app. Streamer mode keeps a
  // hidden recorder BrowserWindow alive, so "window-all-closed" never fired
  // and Reminth.exe kept running invisibly - which is what made the
  // installer loop on "Reminth cannot be closed".
  win.on("closed", () => {
    streamer.shutdown();
    app.quit();
  });

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
  // The copy that lost the lock is already quitting - no window, no hotkeys,
  // no updater, nothing written.
  if (!gotInstanceLock) return;
  cachedSettings = await store.loadSettings();
  streamer.init({ notify: send });
  createWindow();
  // Listened for BEFORE anything is awaited: the page is already loading,
  // and if it finished while the account was still being read, a handler
  // added afterwards never ran - no hotkeys, no content watcher, no updater.
  const pageLoaded = new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
  let restored = null;
  try {
    restored = auth.restore(await store.loadAccount());
  } catch (err) {
    logCrash("loadAccount", err); // start signed out rather than not start
  }
  pageLoaded.then(async () => {
    if (restored) send("auth:restored", { username: restored.username });
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
// The account lives in one session object (msAuth.createSession) so that
// sign-in, sign-out and token refresh can't trip over each other: a double
// click shares one device-code flow, and anything still in flight when the
// player signs out is thrown away instead of signing them back in.
const auth = msAuth.createSession({
  signIn: msAuth.signIn,
  refresh: msAuth.refreshSession,
  save: store.saveAccount,
  clear: store.clearAccount,
  log: logAuth,
});

ipcMain.handle("auth:signIn", async () => {
  const account = await auth.signIn({
    onCode: (data) => send("auth:code", data),
    onWaiting: () => send("auth:waiting"),
  });
  return { username: account.username };
});

/**
 * The renderer asks for this on startup instead of relying only on the
 * auth:restored push - that fires once, so a reloaded page would otherwise
 * claim "Not signed in" while this process still holds a good account.
 */
ipcMain.handle("auth:current", () => {
  const account = auth.current();
  return account ? { username: account.username } : null;
});

ipcMain.handle("auth:signOut", async () => {
  await auth.signOut();
  return { ok: true };
});

/**
 * A Minecraft token is good for ~24h. This hands back the account with a
 * token that's usable now, refreshing only when it's missing or about to run
 * out (a refresh is ~6 requests in a row - not something to do on every
 * click). Throws when Microsoft has rejected the saved sign-in, rather than
 * returning a dead token for the game to fail with later.
 */
function freshAccount() {
  return auth.fresh();
}

/**
 * One timestamped line to %APPDATA%\Reminth\auth.log (same pattern as
 * updater.log). Anything token-shaped is scrubbed first - an error from the
 * auth chain can echo a response body, and this file must never hold a
 * credential.
 */
const AUTH_LOG = path.join(paths.ROOT, "auth.log");
function scrubSecrets(text) {
  return String(text)
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "<REDACTED>") // JWTs (Xbox/Minecraft tokens)
    .replace(/\b(M\.C\d+_[\w.!*$-]+|[\w+/=-]{40,})/g, "<REDACTED>"); // MS refresh tokens, long opaque blobs
}
function logAuth(line) {
  const clean = scrubSecrets(String(line).split("\n")[0]).slice(0, 500);
  try {
    // Keep it small: start over past 256 KB rather than growing forever.
    if (fs.existsSync(AUTH_LOG) && fs.statSync(AUTH_LOG).size > 256 * 1024) fs.rmSync(AUTH_LOG, { force: true });
    fs.mkdirSync(paths.ROOT, { recursive: true });
    fs.appendFileSync(AUTH_LOG, `${new Date().toISOString()} ${clean}\n`);
  } catch {
    // logging must never break a launch
  }
}

// ---- skins ----
ipcMain.handle("auth:skin", async () => {
  const account = auth.current();
  if (!account || !account.uuid) return { error: "Not signed in." };
  return skin.getSkin(account);
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
  // From here on the skin HAS changed on the account. Record it first, and
  // don't let either follow-up step make the whole thing look like it failed.
  let entry = null;
  try {
    entry = await skinLibrary.add({ png, variant, name, source, used: true });
  } catch (err) {
    console.error("Saving the applied skin to the library failed:", err && err.message);
  }
  if (capeId !== undefined) {
    try {
      await skin.setCape(account, capeId);
    } catch (err) {
      // The renderer only tells success from failure by whether this throws,
      // so say exactly what did and didn't happen.
      throw new Error(`Skin changed, but the cape couldn't be set: ${err && err.message ? err.message : String(err)}`);
    }
  }
  return { ok: true, entry };
});

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

// ---- performance help ----
/** How many mod jars an instance has - a big mod list needs a bigger heap. */
async function countModJars(inst) {
  try {
    const names = await fs.promises.readdir(path.join(inst.gameDir || paths.GAME_DIR, "mods"));
    return names.filter((name) => /\.jar$/i.test(name)).length;
  } catch {
    return 0; // no mods folder
  }
}

/** The automatic memory for one instance (used when the player hasn't set the RAM slider). */
async function defaultMemoryFor(inst) {
  return minecraft.computeDefaultMaxMemoryMb(os.totalmem(), {
    modpack: Boolean(inst && inst.modpack),
    modCount: inst ? await countModJars(inst) : 0,
    capMb: entitlements.ramCapMb(),
  });
}

// What the Settings page needs to explain Reminth's choices on this PC.
// defaultMemoryMb is for the given instance (the active one when none is
// named), since modpacks get more than ordinary instances.
ipcMain.handle("perf:info", async (_e, instanceId) => {
  const inst = typeof instanceId === "string" && instanceId ? await instances.get(instanceId) : await activeInstance();
  return {
    totalMemMb: Math.floor(os.totalmem() / (1024 * 1024)),
    cpuCount: os.cpus().length,
    windowsBuild: minecraft.windowsBuildNumber(),
    ramCapMb: entitlements.ramCapMb(),
    defaultMemoryMb: await defaultMemoryFor(inst),
  };
});

// "Run Minecraft on the fast graphics card": Reminth changes nothing itself
// (no registry writes). It opens Windows' own graphics settings page and
// hands back the Java programs to add there. The address is fixed, written
// here and nowhere else - never anything the renderer supplied - which is
// why it doesn't go through the http(s)-only openExternally in createWindow.
ipcMain.handle("perf:gpuHelp", async () => {
  let opened = true;
  try {
    await shell.openExternal("ms-settings:display-advancedgraphics");
  } catch {
    opened = false; // not Windows 10/11 - the paths are still worth showing
  }
  return { javaPaths: await java.installedJavawPaths(), opened };
});

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

ipcMain.handle("instances:create", async (_e, { name, mcVersion, loader, loaderVersion, hud, performanceMods }) => {
  // Checked before it's used to ask the loader's servers anything -
  // instances.create validates it too, but only after that lookup.
  if (!instances.isValidVersionId(mcVersion)) throw new Error("Pick a Minecraft version first.");
  const l = loaders.LOADERS.includes(loader) ? loader : "vanilla";
  const lv = await resolveLoaderVersion(l, mcVersion, loaderVersion);
  // The performance-pack switch from the create dialog, if it sent one
  // (instances.create applies config.perfPackEnabled's per-loader default).
  const inst = await instances.create({ name, mcVersion, loader: l, loaderVersion: lv, hud: hud === true, performanceMods: typeof performanceMods === "boolean" ? performanceMods : undefined });
  return withRunning(inst);
});

ipcMain.handle("instances:update", async (_e, id, patch) => {
  if (running.has(id)) throw new Error("Close the game first - that instance is running.");
  const clean = { ...(patch || {}) };
  if ("loader" in clean && !loaders.LOADERS.includes(clean.loader)) delete clean.loader;
  if ("mcVersion" in clean && !instances.isValidVersionId(clean.mcVersion)) throw new Error("That change isn't valid.");
  // The performance-pack switch: a real true/false or nothing at all.
  if ("performanceMods" in clean && typeof clean.performanceMods !== "boolean") delete clean.performanceMods;
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
  const updated = await instances.update(id, clean);
  // Version, loader, HUD and the performance pack all change what the
  // compatibility check should say - never answer from before the change.
  compat.invalidate(id);
  return withRunning(updated);
});

ipcMain.handle("instances:delete", async (_e, id) => {
  if (running.has(id)) throw new Error("Close the game first - that instance is running.");
  // The content watcher holds handles inside the active instance's folder;
  // on Windows the folder can't be removed while they're open.
  const wasActive = cachedSettings.activeInstance === id;
  if (wasActive && typeof content.unwatch === "function") content.unwatch();
  let failure = null;
  try {
    await instances.remove(id);
  } catch (err) {
    failure = err;
  }
  if (wasActive) {
    // Whether or not the remove worked, something has to be watched again:
    // the default instance if this one is gone, this one if it's still here.
    try {
      if (!(await instances.get(id))) cachedSettings = await store.saveSettings({ activeInstance: instances.DEFAULT_ID });
      await watchActiveInstance();
    } catch (err) {
      if (!failure) failure = err;
    }
  }
  if (failure) throw failure;
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
ipcMain.handle("content:creators", async (_e, id) => content.lookupCreators((await instances.require(id)).gameDir));
ipcMain.handle("content:checkUpdates", async (_e, id) => content.checkUpdates(await instances.require(id)));
ipcMain.handle("content:applyUpdates", async (_e, id, updates) => {
  if (running.has(id)) throw new Error("Close the game first - Windows won't let files in use be replaced.");
  const inst = await instances.require(id);
  return content.applyUpdates(inst, Array.isArray(updates) ? updates.slice(0, 500) : [], (p) =>
    send("content:progress", { instanceId: id, op: "update", ...p })
  );
});

// ---- compatibility help (compat.js) ----
// Which mods won't load on this instance, why, and what fixes each.
ipcMain.handle("compat:check", async (_e, id, options) =>
  // localOnly: the quick answer for the Play button (no hashing, no network).
  compat.checkInstance(await instances.require(id), { force: Boolean(options && options.force), localOnly: Boolean(options && options.localOnly) })
);

/** What a server says it accepts, read from its own status reply. Never throws. */
async function serverAcceptsFromAddress(address) {
  if (typeof address !== "string" || !address.trim() || address.length > 260) return null;
  try {
    const r = await serverPing.ping(address.trim());
    if (!r || !r.online) return { online: false, versionName: null, accepts: null };
    const versionName = typeof r.versionName === "string" ? r.versionName.slice(0, 80) : null;
    return { online: true, versionName, accepts: compat.versionsFromServerText(versionName) };
  } catch {
    return null;
  }
}
ipcMain.handle("compat:serverVersions", async (_e, address) => serverAcceptsFromAddress(address));

// Which Minecraft version fits this instance's mods (and a server, if given).
ipcMain.handle("compat:advise", async (_e, id, options) => {
  const inst = await instances.require(id);
  const o = options && typeof options === "object" ? options : {};
  let accepts = null;
  if (Array.isArray(o.accepts)) accepts = o.accepts.filter((v) => instances.isValidVersionId(v)).slice(0, 400);
  else if (o.accepts && typeof o.accepts === "object") {
    const a = o.accepts;
    accepts = {
      list: Array.isArray(a.list) ? a.list.filter((v) => instances.isValidVersionId(v)).slice(0, 400) : null,
      min: instances.isValidVersionId(a.min) ? a.min : null,
      max: typeof a.max === "string" && /^[\d.]{1,16}$/.test(a.max) ? a.max : null,
    };
  }
  // Only versions this loader actually has a build for are worth suggesting.
  let loaderVersions = null;
  if (inst.loader !== "vanilla") {
    try {
      loaderVersions = (await loaders.supportedGameVersions())[inst.loader] || null;
    } catch {
      loaderVersions = null;
    }
  }
  return compat.adviseVersions(inst, { accepts, loaderVersions });
});

// Which versions one project has builds for - shown when an install can't find one.
ipcMain.handle("compat:support", async (_e, id, projectId) => {
  if (typeof projectId !== "string" || !/^[\w-]{1,64}$/.test(projectId)) throw new Error("That project isn't valid.");
  return compat.projectSupport(await instances.require(id), projectId);
});

// A copy of an instance on another Minecraft version, mods re-fetched to match.
let copyInFlight = false;
ipcMain.handle("compat:copyToVersion", async (_e, id, request) => {
  const source = await instances.require(id);
  const r = request && typeof request === "object" ? request : {};
  if (!instances.isValidVersionId(r.mcVersion)) throw new Error("Pick a Minecraft version first.");
  if (copyInFlight) throw new Error("A copy is already being made - wait for it to finish.");
  copyInFlight = true;
  try {
    const result = await migrate.copyToVersion(
      source,
      { mcVersion: r.mcVersion, name: typeof r.name === "string" ? r.name : null },
      {
        createInstance: async (fields) => {
          const lv = await resolveLoaderVersion(fields.loader, fields.mcVersion, null);
          return instances.create({ ...fields, loaderVersion: lv });
        },
      },
      (p) => send("compat:progress", { instanceId: id, ...p })
    );
    return { ...result, instance: withRunning(result.instance) };
  } finally {
    copyInFlight = false;
  }
});

ipcMain.handle("modpack:install", async (_e, request) =>
  withRunning(await mrpack.installModpack(request || {}, (p) => send("modpack:progress", p)))
);

// ---- what the player has actually played (read-only, see gameData.js) ----
const accountUuid = () => {
  const account = auth.current();
  return account && account.uuid;
};

ipcMain.handle("game:recent", async () => {
  try {
    return await gameData.recentActivity(accountUuid(), 5, await instances.list());
  } catch (err) {
    return { recent: [], worlds: [], servers: [], worldCount: 0, serverCount: 0, totalPlayTimeTicks: 0, totalPlayTimeSeconds: 0, error: err.message };
  }
});

ipcMain.handle("game:instanceData", async (_e, id) => {
  const inst = await instances.require(id);
  try {
    return await gameData.recentActivity(accountUuid(), 5, [inst]);
  } catch (err) {
    return { recent: [], worlds: [], servers: [], worldCount: 0, serverCount: 0, totalPlayTimeTicks: 0, error: err.message };
  }
});

ipcMain.handle("game:stats", async () => {
  try {
    return await gameData.playerStats(accountUuid(), await instances.list());
  } catch (err) {
    return { found: false, error: err.message };
  }
});

const FOLDERS = { game: "", mods: "mods", resourcepacks: "resourcepacks", shaderpacks: "shaderpacks", screenshots: "screenshots", logs: "logs", saves: "saves" };
ipcMain.handle("instance:openFolder", async (_e, which, id) => {
  const inst = id ? await instances.require(id) : await activeInstance();
  // Own keys only: "constructor" / "__proto__" would otherwise look up
  // something off Object.prototype and hand a non-string to path.join.
  const sub = Object.prototype.hasOwnProperty.call(FOLDERS, which) ? FOLDERS[which] : undefined;
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
      // ping() is meant never to reject, but one listing that somehow does
      // must not take the other 39 down with it.
      try {
        out[addr] = await serverPing.ping(addr);
      } catch (err) {
        out[addr] = { online: false, error: err && err.message ? err.message : "ping failed" };
      }
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

// ---- local catalog cache (top-N by downloads, instant + offline-capable) ----
ipcMain.handle("catalog:browseCached", async (_e, params) => catalogCache.getCached(params));
ipcMain.handle("catalog:bySlugs", async (_e, projectType, slugs) => catalogCache.getBySlugs(projectType, slugs));
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
      .finally(() => {
        installsInFlight.delete(inst.id);
        // An install adds, swaps and removes Reminth's own jars: whatever the
        // compatibility check worked out before it is no longer the answer.
        compat.invalidate(inst.id);
      });
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
  if (!auth.current()) throw new Error("Not signed in.");
  const inst = options.instanceId ? await instances.require(options.instanceId) : await activeInstance();
  if (running.has(inst.id)) throw new Error("Minecraft is already running.");
  // Claimed synchronously, before the first await below, so a second click
  // can't sail past the check and start a second copy on the same worlds.
  const claim = { child: null, startedAt: Date.now() };
  running.set(inst.id, claim);
  try {
    return await startGame(inst, options.join, claim);
  } catch (err) {
    // Never leave Play wedged behind a failed launch - but only this
    // launch's own claim: after a Stop, the entry may be a newer Play's.
    if (running.get(inst.id) === claim) running.delete(inst.id);
    throw err;
  }
});

/**
 * Force-stops whatever Reminth thinks is running for an instance - both the
 * normal case (a real java process, killed outright) and the stuck case
 * (the bookkeeping in `running` says an instance is playing but the process
 * behind it is already gone - a crash dialog dismissed in an unexpected way,
 * a process killed from Task Manager, anything that skipped the child's own
 * "exit"/"error" listeners). Either way the Play button has to unstick, so
 * this always clears the entry and tells the renderer, even when there was
 * nothing left alive to actually kill.
 */
ipcMain.handle("play:stop", async (_e, options = {}) => {
  const inst = options.instanceId ? await instances.require(options.instanceId) : await activeInstance();
  const session = running.get(inst.id);
  if (!session) return { stopped: false, wasRunning: false };

  let killedReal = false;
  if (session.child && session.child.pid) {
    killedReal = true;
    try {
      session.child.kill();
    } catch {
      // already gone - fine, still cleaned up below
    }
    // spawn() with detached:true on Windows starts its own process group;
    // a plain .kill() doesn't reliably reach that whole tree. taskkill /t
    // does, and this is best-effort - if the process is already dead this
    // just fails quietly.
    if (process.platform === "win32") {
      spawnProcess("taskkill", ["/pid", String(session.child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      }).on("error", () => {});
    }
  }

  finishSession(inst, killedReal, session);
  return { stopped: true, wasRunning: true };
});

/**
 * `claim` is the entry play:run put in `running` for this launch. Stop
 * removes it (and a later Play puts in its own), so after every wait this
 * checks the entry is still the same object: a launch that was stopped while
 * installing must not start the game anyway, least of all next to a second
 * launch on the same worlds.
 */
async function startGame(inst, join, claim) {
  const stopped = () => running.get(inst.id) !== claim;
  const cancelled = { launched: false, cancelled: true };
  // Make sure the Minecraft token is usable before launching. If Microsoft
  // has rejected the saved sign-in, stop here and say so - launching anyway
  // gave a game that started fine and then couldn't join any server, with
  // no hint why. Being unable to reach Microsoft at all is different: that's
  // an offline player, and singleplayer still works, so the launch goes on.
  try {
    await freshAccount();
  } catch (err) {
    if (!err || err.code !== "AUTH_UNREACHABLE") throw err;
  }
  if (stopped()) return cancelled;

  const installResult = await ensureInstalledOnce(inst);
  if (stopped()) return cancelled;
  send("install:done", { instanceId: inst.id });

  cachedSettings = await store.loadSettings();
  if (stopped()) return cancelled;
  // The player's own RAM setting wins; without one, the automatic amount
  // depends on the instance (a modpack gets more).
  const defaultMb = cachedSettings.maxMemoryMb ? 0 : await defaultMemoryFor(inst);
  if (stopped()) return cancelled;
  // Whatever settings.json says, never above what this machine can spare.
  const maxMemoryMb = Math.min(cachedSettings.maxMemoryMb || defaultMb, entitlements.ramCapMb());
  const safeJoin = join && typeof join.host === "string" && /^[A-Za-z0-9.\-_]{1,255}$/.test(join.host)
    ? { host: join.host, port: Number(join.port) > 0 && Number(join.port) < 65536 ? Number(join.port) : 25565 }
    : null;

  // Signed out while the install was running: there's nobody to launch as.
  const account = auth.current();
  if (!account) throw new Error("Not signed in.");

  // One Play is one session (`claim`) but can be two processes: when the JVM
  // refuses its arguments, the game is started once more in safe mode.
  // claim.child is always the process the session is on NOW, so Stop kills
  // the right one, and everything a process reports is ignored unless it is
  // still that one.
  let retried = false; // one retry per Play, never a loop
  const spawnGame = (safe) => {
    const child = minecraft.launch(
      installResult,
      account,
      (crashInfo) => {
        // A game that was stopped (or has since been replaced by a newer
        // launch) isn't this session any more - nothing to report or undo.
        if (stopped() || claim.child !== child) return;
        const plan = minecraft.planSafeModeRetry({
          code: crashInfo.code,
          elapsedMs: crashInfo.elapsedMs,
          logText: safe ? "" : readLogStart(crashInfo.logPath),
          alreadyRetried: retried,
          maxMemoryMb,
        });
        if (plan.retry) {
          retried = true;
          try {
            // Straight away, with no wait in between: there is never a
            // moment when the session has no process for Stop to kill.
            if (spawnGame({ maxMemoryMb: plan.maxMemoryMb })) {
              send("play:safeMode", { instanceId: inst.id, reason: plan.reason });
              return;
            }
          } catch {
            // the second start failed outright - report the first failure below
          }
        }
        finishSession(inst, false, claim);
        send("play:crashed", { instanceId: inst.id, ...crashInfo });
      },
      { ...cachedSettings, maxMemoryMb: safe ? safe.maxMemoryMb : maxMemoryMb, appVersion: app.getVersion() },
      inst,
      { join: safeJoin, safeMode: Boolean(safe) }
    );
    if (!child) return null;
    // The same object, filled in - so the checks here (and Stop) can tell
    // this session from one a later Play starts for the same instance.
    claim.child = child;
    // Only the process the session is on ends it: the refused first try
    // also "exits", a moment after its replacement has been started.
    child.once("exit", () => claim.child === child && finishSession(inst, true, claim));
    child.once("error", () => claim.child === child && finishSession(inst, false, claim));
    return child;
  };

  if (!spawnGame(null)) {
    if (!stopped()) running.delete(inst.id);
    return { launched: false };
  }
  claim.startedAt = Date.now();
  streamer.gameStarted();
  send("play:started", { instanceId: inst.id });

  if (cachedSettings.launchMinimized) win.minimize();
  return { launched: true };
}

/**
 * The first part of a launch log, where the JVM says why it won't start.
 * Read in one go, on the spot: the retry decision is made inside the game's
 * "exit" event so nothing else can happen to the session in between.
 */
function readLogStart(logPath) {
  let fd = null;
  try {
    fd = fs.openSync(logPath, "r");
    const buf = Buffer.alloc(16 * 1024);
    return buf.toString("utf8", 0, fs.readSync(fd, buf, 0, buf.length, 0));
  } catch {
    return ""; // no log to read - then there is no reason to retry either
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // already closed
      }
    }
  }
}

/**
 * Ends `session` - and only that one. The old game's "exit" can arrive
 * after Stop and a quick new Play; without the check it deleted the NEW
 * session, leaving a running game the launcher thought was closed.
 */
function finishSession(inst, played, session) {
  if (!session || running.get(inst.id) !== session) return;
  running.delete(inst.id);
  if (session.child) streamer.gameStopped();
  if (played) instances.recordSession(inst.id, session.startedAt, Date.now()).catch(() => {});
  // Crash reports appear right away; the session's log is rolled by the
  // game on its next start and archived then.
  setTimeout(() => logs.importInstanceLogs(inst).catch(() => {}), 1500);
  send("play:exited", { instanceId: inst.id });
}
