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
const runningGames = require("./runningGames");
const perfProfiles = require("./perfProfiles");
const purposes = require("./purposes");
const serverRules = require("./serverRules");
const gameOptions = require("./gameOptions");
const modsSync = require("./modsSync");
const atomic = require("./atomic");
const projectPage = require("./projectPage");
const windowRestore = require("./windowRestore");
const crashReport = require("./crashReport");
const versionSwitch = require("./versionSwitch");
const deepLink = require("./deepLink");
const markdown = require("../renderer/markdown");
const { fetchJson } = require("./downloader");

let win;
let cachedSettings = store.DEFAULT_SETTINGS;
// instanceId -> { child, startedAt }. One game per instance at a time: two
// copies of the same instance would write the same worlds at once.
const running = new Map();
// Resolves once the games an earlier Reminth started have been found again.
let adoptionDone = Promise.resolve();
// The window as it was when the first of the running games was launched
// ({ wasMaximized, minimizedByUs }), until it has been put back after them.
let windowBeforeGame = null;

// ---- reminth:// links (deepLink.js): they only ever switch the page ----
let pageReady = false;
let pendingLink = null; // a link that came before the page could listen
const linkIds = async () => (await instances.list()).map((i) => i.id);
const showLinkPage = (link) => {
  if (pageReady) send("deeplink:open", link);
  else pendingLink = link;
};
const handleDeepLink = deepLink.createDeepLinkHandler({
  listIds: linkIds,
  // To the front - but never over a running game (the same rule as the
  // window after a game): then the taskbar button only flashes.
  bringForward: () => {
    if (!win || win.isDestroyed()) return;
    if (running.size > 0) {
      win.flashFrame(true);
      return;
    }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  },
  showPage: showLinkPage,
});

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
  app.on("second-instance", (_event, argv) => {
    if (!win || win.isDestroyed()) return;
    // Started again by a reminth:// link (the game's Skins button, a web
    // page): handled on its own - it never takes the screen from a game.
    if (Array.isArray(argv) && argv.some((a) => typeof a === "string" && /^reminth:/i.test(a))) {
      handleDeepLink(argv);
      return;
    }
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
  // On a screen smaller than 1000x660 after scaling, never bigger than it.
  const size = windowRestore.windowSizes(screen.getPrimaryDisplay().workAreaSize);

  win = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: size.minWidth,
    minHeight: size.minHeight,
    center: true,
    show: false, // shown maximized on ready-to-show, so it never flashes windowed first
    backgroundColor: "#07090f",
    frame: false, // custom title bar drawn in renderer, matches the brand's borderless look
    // Taskbar / alt-tab icon: the .ico carries the hand-tuned 16/24/32 px pictures, so Windows picks the right size
    // itself (a single big PNG would be scaled down by Windows and look soft).
    icon: path.join(__dirname, "..", "..", "assets", "icons", "reminth.ico"),
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
  // A smaller window shows the same layout as the maximized one, scaled down (windowRestore.uiZoom).
  const fitZoom = () => {
    try {
      if (!win || win.isDestroyed()) return;
      const [width, height] = win.getContentSize();
      const z = windowRestore.uiZoom({ width, height }, screen.getDisplayMatching(win.getBounds()).workAreaSize);
      if (Math.abs(win.webContents.getZoomFactor() - z) > 0.002) win.webContents.setZoomFactor(z);
    } catch {
      // cosmetic: the page stays at its normal size
    }
  };
  win.on("resize", fitZoom);
  win.webContents.on("did-finish-load", fitZoom);
  // After a game: put the window back as it was (see restoreWindowAfterGame).
  win.on("focus", () => restoreWindowAfterGame());
  win.on("restore", () => restoreWindowAfterGame());

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

// Windows groups taskbar buttons and picks the taskbar icon by this id. The installer's shortcuts carry the same
// id (electron-builder uses appId), so setting it here makes a dev run (npm start) show the Reminth icon too,
// not Electron's. Must be set before the first window.
if (process.platform === "win32") app.setAppUserModelId("com.reminth.launcher");

app.whenReady().then(async () => {
  // The copy that lost the lock is already quitting - no window, no hotkeys,
  // no updater, nothing written.
  if (!gotInstanceLock) return;
  // Home's lifetime "Time played" starts from what the instances recorded so
  // far - once, before the page can show it (store.seedPlayTime never seeds twice).
  try {
    await store.seedPlayTime(sumOfInstancePlayTime);
  } catch (err) {
    logCrash("seedPlayTime", err); // shown as the instances' sum until it works
  }
  // The FPS | GPU | CPU | LAT bar is on for every Fabric/Quilt instance (once).
  await require("./hudDefault").turnOnOnce({ dir: paths.ROOT, list: instances.list, update: instances.update }).catch(() => 0);
  cachedSettings = await store.loadSettings();
  streamer.init({ notify: send });
  // reminth:// opens Reminth. The installer registers it too (package.json
  // build.protocols); a dev run never claims it.
  if (app.isPackaged) {
    try {
      app.setAsDefaultProtocolClient("reminth");
    } catch {
      // the installer's registration still works
    }
  }
  createWindow();
  // Started by a reminth:// link: the page is switched once it has loaded
  // (the window is about to open by itself, so nothing is brought forward).
  deepLink.createDeepLinkHandler({ listIds: linkIds, bringForward: () => {}, showPage: showLinkPage })(process.argv);
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
    pageReady = true;
    if (pendingLink) send("deeplink:open", pendingLink);
    pendingLink = null;
    if (restored) send("auth:restored", { username: restored.username });
    streamer.configure(cachedSettings);
    // A game started before Reminth was closed, restarted or updated is still running.
    adoptionDone = adoptRunningGames().catch(() => {});
    await watchActiveInstance();
    // Pull any new logs into the permanent archive for every instance.
    for (const inst of await instances.list()) logs.importInstanceLogs(inst).catch(() => {});
    warmAllCachesIfStale();
    // After load, so the renderer is listening for "update:status".
    updater.init({ notify: send, isGameRunning: () => running.size > 0 });
  });
});

// Settings -> "Check for updates", and what to show when that card opens.
// Both always answer with a state; nothing here throws into the renderer.
ipcMain.handle("update:check", () => updater.check());
ipcMain.handle("update:state", () => updater.getState());
// "Restart and update": refused while a game runs (updater.installNow).
ipcMain.handle("update:install", () => updater.installNow());

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

ipcMain.handle("auth:signIn", async (_e, restart) => {
  // "Get a new code": drop a sign-in that is still waiting (nobody is signed in then) and start again.
  if (restart === true && !auth.current()) await auth.signOut();
  const account = await auth.signIn({
    onCode: (data) => {
      send("auth:code", data);
      // The Microsoft page opens by itself; a link in the window that would not open was the common complaint.
      const href = markdown.safeLink(data && data.verificationUri);
      if (href) shell.openExternal(href).catch(() => {});
    },
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
  // The performance pack's mods per loader, for the instance dialog. Which
  // ones really go in is decided per instance at Play (stable builds only).
  performancePack: Object.fromEntries(
    ["fabric", "quilt", "forge", "neoforge"].map((l) => [l, (config.PERFORMANCE_PACK || []).filter((e) => (e.loaders || []).includes(l)).map((e) => e.label)])
  ),
  managedMods: [
    { name: "ReminthHUD", tag: "HUD", note: "Reminth's own in-game bar: FPS, GPU, CPU and latency. Press H in game to toggle it. Switch it on or off per instance in Edit.", required: false },
    { name: "Reminth home screen", tag: "Home", note: "Reminth's own title screen for the game. Switch it on or off per instance in Edit.", required: false },
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
    // "Far view" holds many more chunks in memory, so it gets what a
    // modpack gets (still capped at 8 GB and 60 % of the PC).
    modpack: Boolean(inst && (inst.modpack || inst.perfProfile === "far-view")),
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

// ---- "what is this instance for?": researched mod and resource pack lists (purposes.js) ----
ipcMain.handle("purpose:list", () => purposes.list());
// One playstyle id, or the list the player ticked (["pvp", "survival", "performance"]).
const goalIdsArg = (g) => (Array.isArray(g) ? g.map(String).slice(0, 8) : String(g));
ipcMain.handle("purpose:items", async (_e, id, goalIds) => purposes.listFor(goalIdsArg(goalIds), await instances.require(id)));
// After the chosen ones were installed (the ordinary content install, from the renderer): their ready-made
// settings go into config/ (never over an existing file) and the resource packs are switched on for the next start.
ipcMain.handle("purpose:finish", async (_e, id, goalIds, slugs, startedAt) => {
  const inst = await instances.require(id);
  const chosen = (Array.isArray(slugs) ? slugs : []).filter((s) => typeof s === "string").slice(0, 80);
  const configs = await purposes.writeConfigs(inst.gameDir, goalIdsArg(goalIds), chosen);
  const items = purposes.itemBySlug(goalIdsArg(goalIds));
  const packSlugs = chosen.filter((s) => items.get(s) && items.get(s).kind === "resourcepack");
  const files = [];
  if (packSlugs.length) {
    try {
      const manifest = await content.readManifest(inst.gameDir);
      const ids = new Set();
      for (const slug of packSlugs) {
        try {
          const project = await modrinth.getProject(slug);
          if (project && project.id) ids.add(project.id);
        } catch {
          // a pack that can't be looked up just isn't switched on
        }
      }
      for (const [key, entry] of Object.entries((manifest && manifest.files) || {})) {
        if (entry && entry.kind === "resourcepack" && ids.has(entry.projectId) && key.startsWith("resourcepacks/")) files.push(key.slice("resourcepacks/".length));
      }
    } catch {
      // nothing to switch on
    }
  }
  const queued = files.length ? await purposes.queuePacks(inst.gameDir, files) : false;
  const since = Number.isFinite(startedAt) && startedAt > 0 ? startedAt : null;
  const fixed = await turnOffWhatWontLoad(inst, chosen, since).catch(() => ({ off: [], added: [] }));
  return { configs, packsQueued: queued ? files.length : 0, turnedOff: fixed.off, added: fixed.added };
});

// After a playstyle install: a mod from the list that the compatibility check says would stop the game (a build that
// is tagged for this version on Modrinth but whose jar asks for another one) is switched off - never deleted - with
// the reason kept, so the instance starts. Only files this install added are touched: the list's own mods, and the
// libraries they pulled in (put in since `since`). Switching a library off makes the mods that need it "won't load"
// too (they are switched off with it), so it checks again, up to four times.
// A library one of them requires that is missing altogether (Status Effect Bars needs Cloth Config, which its page
// doesn't list) is installed first. Returns { off: [{ file, title }], added: [title] }.
async function turnOffWhatWontLoad(inst, slugs, since) {
  const added = [];
  if (!slugs.length) return { off: [], added };
  const projects = await modrinth.getProjects(slugs).catch(() => []);
  const ids = new Set((projects || []).map((p) => p && p.id).filter(Boolean));
  if (!ids.size) return { off: [], added };
  const manifest = await content.readManifest(inst.gameDir);
  const ours = new Map(); // file -> title from the list or the manifest
  for (const [key, entry] of Object.entries((manifest && manifest.files) || {})) {
    if (!entry || entry.kind !== "mod" || !key.startsWith("mods/")) continue;
    const fresh = since && Number(entry.installedAt) >= since;
    if (ids.has(entry.projectId) || fresh) ours.set(key.slice("mods/".length), entry.title || null);
  }
  const out = [];
  const off = async (file, title, why) => {
    try {
      const r = await content.setEnabled(inst.gameDir, { kind: "mod", world: null, file }, false);
      await content.setOffReason(inst.gameDir, { kind: "mod", world: null, file: (r && r.file) || file + ".disabled" }, why);
      out.push({ file, title });
      return true;
    } catch {
      return false; // left on; the instance page shows it as "won't load" with its fix
    }
  };
  const tried = new Set();
  for (let round = 0; round < 4; round++) {
    compat.invalidate(inst.id);
    const report = await compat.checkInstance(inst, { force: true });
    let changed = false;
    // missing libraries our mods need: put them in (once each)
    for (const issue of report.issues || []) {
      if (issue.severity !== "blocked" || issue.reason !== "missing-dep" || !issue.fix || issue.fix.type !== "install") continue;
      if (!(issue.neededByFiles || []).some((f) => ours.has(f)) || tried.has(issue.fix.projectId)) continue;
      tried.add(issue.fix.projectId);
      try {
        await content.install(inst, { projectId: issue.fix.projectId, kind: "mod" }, () => {});
        added.push(issue.title);
        changed = true;
      } catch {
        // not installable: the mods that need it are switched off below on the next check
      }
    }
    if (changed) continue;
    const hits = (report.issues || []).filter((i) => i.severity === "blocked" && ours.has(i.file) && !out.some((o) => o.file === i.file));
    for (const issue of hits) {
      if (await off(issue.file, ours.get(issue.file) || issue.title || issue.file, issue.detail || "It wouldn't let the game start.")) changed = true;
    }
    // a library that couldn't be put in: the mods from this install that need it go off
    for (const issue of report.issues || []) {
      if (issue.severity !== "blocked" || issue.reason !== "missing-dep") continue;
      for (const f of issue.neededByFiles || []) {
        if (!ours.has(f) || out.some((o) => o.file === f)) continue;
        if (await off(f, ours.get(f) || f, issue.detail || "A library it needs is missing.")) changed = true;
      }
    }
    // A mod from this install that requires one that is now off (and nothing else switched on gives that id) can't
    // start either: off too, with the reason.
    const mods = ((await content.listAll(inst.gameDir)) || {}).mod || [];
    const ids = (m) => [m.modId, ...(m.provides || [])].filter(Boolean).map((x) => String(x).toLowerCase());
    const onIds = new Set(mods.filter((m) => m.enabled).flatMap(ids));
    const offById = new Map();
    for (const m of mods) if (!m.enabled && out.some((o) => o.file === m.file.replace(/\.disabled$/i, ""))) for (const id of ids(m)) offById.set(id, m);
    for (const m of mods) {
      if (!m.enabled || !ours.has(m.file) || out.some((o) => o.file === m.file)) continue;
      const lost = Object.keys(m.depends || {}).map((d) => d.toLowerCase()).find((d) => offById.has(d) && !onIds.has(d));
      if (!lost) continue;
      const lib = offById.get(lost);
      const libTitle = ours.get(lib.file.replace(/\.disabled$/i, "")) || lib.title || lost;
      if (await off(m.file, ours.get(m.file) || m.title || m.file, `It needs ${libTitle}, which was turned off because it wouldn't let the game start.`)) changed = true;
    }
    if (!changed) break;
  }
  compat.invalidate(inst.id);
  return { off: out, added };
}

// ---- performance profiles and the performance pack (instance page) ----
ipcMain.handle("perf:profiles", () => perfProfiles.list());

// The extra mods a profile suggests, checked against Modrinth for this
// instance. Only a list - installing one is the ordinary content install.
ipcMain.handle("perf:profileExtras", async (_e, id) => perfProfiles.listExtras(await instances.require(id)));

ipcMain.handle("perf:packStatus", async (_e, id) => minecraft.performancePackStatus(await instances.require(id)));

// "Boost FPS": the measured Max FPS video settings for an instance that
// already has its own (gameOptions.js planBoost). Only on the player's
// confirmed click, never while the game runs (it rewrites options.txt when it
// closes), old values saved first, and "put back" undoes it.
const boostTarget = (inst) => ({
  gameDir: inst.gameDir,
  clientJar: /^[A-Za-z0-9._-]+$/.test(String(inst.mcVersion)) && !String(inst.mcVersion).includes("..") ? path.join(paths.VERSIONS_DIR, inst.mcVersion, `${inst.mcVersion}.jar`) : null,
});
ipcMain.handle("perf:boostPlan", async (_e, id) => gameOptions.boostPlan(boostTarget(await instances.require(id))));
ipcMain.handle("perf:boostApply", async (_e, id) => {
  if (running.has(id)) throw new Error("Close the game first - that instance is running.");
  const inst = await instances.require(id);
  return atomic.withLock(`options:${id}`, () => gameOptions.applyBoost(boostTarget(inst)));
});
ipcMain.handle("perf:boostUndo", async (_e, id) => {
  if (running.has(id)) throw new Error("Close the game first - that instance is running.");
  const inst = await instances.require(id);
  return atomic.withLock(`options:${id}`, () => gameOptions.undoBoost(boostTarget(inst)));
});

// Restore: forget which pack mods the player switched off or removed, so the
// next Play installs the whole pack again. Only bookkeeping changes, but not
// while the game runs - that launch already decided what's in mods/.
ipcMain.handle("perf:restorePack", async (_e, id) => {
  if (running.has(id)) throw new Error("Close the game first - that instance is running.");
  const inst = await instances.require(id);
  const reset = await minecraft.resetPerformancePack(inst);
  compat.invalidate(id);
  return { reset, status: await minecraft.performancePackStatus(inst) };
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

ipcMain.handle("instances:create", async (_e, { name, mcVersion, loader, loaderVersion, hud, homeScreen, performanceMods, perfProfile, madeFor }) => {
  // Checked before it's used to ask the loader's servers anything -
  // instances.create validates it too, but only after that lookup.
  if (!instances.isValidVersionId(mcVersion)) throw new Error("Pick a Minecraft version first.");
  const l = loaders.LOADERS.includes(loader) ? loader : "vanilla";
  const lv = await resolveLoaderVersion(l, mcVersion, loaderVersion);
  // The performance-pack switch from the create dialog, if it sent one
  // (instances.create applies config.perfPackEnabled's per-loader default).
  const inst = await instances.create({ name, mcVersion, loader: l, loaderVersion: lv, hud: hud === true, homeScreen: homeScreen === false ? false : undefined, performanceMods: typeof performanceMods === "boolean" ? performanceMods : undefined, perfProfile: perfProfiles.normaliseProfile(perfProfile), madeFor: instances.cleanMadeFor(madeFor) });
  return withRunning(inst);
});

ipcMain.handle("instances:update", async (_e, id, patch) => {
  if (running.has(id)) throw new Error("Close the game first - that instance is running.");
  const clean = { ...(patch || {}) };
  // A version or loader change while its mods are being updated (which picked
  // builds for the version it was on) would leave mods for the old one.
  if (("mcVersion" in clean || "loader" in clean) && syncing.has(id)) {
    throw new Error("Its mods are being updated - wait a moment for that to finish, then change the version.");
  }
  if ("loader" in clean && !loaders.LOADERS.includes(clean.loader)) delete clean.loader;
  if ("mcVersion" in clean && !instances.isValidVersionId(clean.mcVersion)) throw new Error("That change isn't valid.");
  // The performance-pack switch: a real true/false or nothing at all.
  if ("performanceMods" in clean && typeof clean.performanceMods !== "boolean") delete clean.performanceMods;
  if ("homeScreen" in clean && typeof clean.homeScreen !== "boolean") delete clean.homeScreen;
  // The performance profile: one of the known ids, anything else is ignored
  // rather than quietly turned into "balanced".
  if ("perfProfile" in clean && !perfProfiles.PROFILE_IDS.includes(clean.perfProfile)) delete clean.perfProfile;
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

ipcMain.handle("instances:delete", async (_e, id) => deleteInstanceNow(id));

/** Deletes an instance's folder and entry (the running guard and the content watcher handled). */
async function deleteInstanceNow(id) {
  if (running.has(id)) throw new Error("Close the game first - that instance is running.");
  // Not while something is still writing into its folder: an update, a
  // version switch, its game files being installed, or a copy made from it.
  if (syncing.has(id) || installsInFlight.has(id) || copySourceId === id) {
    throw new Error("That instance is busy (installing or updating) - wait for it to finish, then delete it.");
  }
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
}

// The rail's order (instances.reorder checks it is exactly the instances there are).
ipcMain.handle("instances:reorder", async (_e, ids) => instances.reorder(ids));

// For the delete question: worlds and size on disk (links never followed, ~1.5 s at most).
ipcMain.handle("instances:summary", async (_e, id) => instances.summary(id));

// "Undo" on the toast after Reminth made an instance by itself: only while it
// was never played and holds no world (checked here again, whatever the page thought).
ipcMain.handle("instances:undoCreate", async (_e, id) => {
  const inst = await instances.require(id);
  if (inst.id === instances.DEFAULT_ID) throw new Error("The main Reminth instance can't be deleted.");
  if (running.has(id)) throw new Error("Close the game first - that instance is running.");
  let worldNames = [];
  try {
    for (const e of await fs.promises.readdir(path.join(inst.gameDir, "saves"), { withFileTypes: true })) worldNames.push(e.name);
  } catch {
    worldNames = [];
  }
  if (!instances.undoAllowed({ lastPlayed: inst.lastPlayed, worldNames, carried: [] })) {
    throw new Error(`${inst.name} has been played or has a world in it now - delete it from its menu if you're sure.`);
  }
  return deleteInstanceNow(id);
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
// The same question for any of Reminth's bundled mods (config.BUNDLED_MODS), by its key.
ipcMain.handle("bundled:supports", async (_e, mod, mc) => {
  if (typeof mod !== "string" || !config.bundledMod(mod) || !instances.isValidVersionId(mc)) return false;
  return Boolean(await minecraft.findBundledModFor(mod, mc));
});

// ---- content (mods, packs, shaders, data packs) ----
async function watchActiveInstance() {
  const inst = await activeInstance();
  if (!inst) return;
  await content.watchInstance(inst.gameDir, () => send("content:changed", { instanceId: inst.id }));
}

ipcMain.handle("content:list", async (_e, id) => content.listAll((await instances.require(id)).gameDir));
// Mods can't change under a running game: its jars are open, and a change
// would only half apply. The folder an action touches follows from its kind
// (content.folderFor), so checking the kind here is the real guard - a page
// that calls a mod something else can only ever reach the pack folders.
// Resource packs, shaders and data packs stay allowed: Minecraft reloads them.
const MODS_LOCKED = "Close the game first - that instance is running.";
function refuseModChangeWhileRunning(id, kind) {
  if (running.has(id) && content.touchesMods(kind)) throw new Error(MODS_LOCKED);
}
// Mods a big server bans, switched on in this instance (serverRules.js). join: the address Play is about to join.
ipcMain.handle("serverRules:check", async (_e, id, join) => serverRules.checkInstance(await instances.require(id), { join: typeof join === "string" ? join : null }));
// Switches those mods off (never deletes them), with the reason. Works out the list again itself: no file names from the page.
ipcMain.handle("serverRules:turnOff", async (_e, id, join) => {
  refuseModChangeWhileRunning(id, "mod");
  const inst = await instances.require(id);
  const found = await serverRules.checkInstance(inst, { join: typeof join === "string" ? join : null });
  const done = [];
  const failed = [];
  const seen = new Set();
  for (const hit of found) {
    for (const m of hit.mods) {
      if (seen.has(m.file)) continue;
      seen.add(m.file);
      try {
        const r = await content.setEnabled(inst.gameDir, { kind: "mod", world: null, file: m.file }, false);
        await content.setOffReason(inst.gameDir, { kind: "mod", world: null, file: (r && r.file) || m.file + ".disabled" }, `Banned on ${hit.server.name} (${m.categories.join(", ")}). Switch it back on for other servers.`);
        done.push(m.title);
      } catch (err) {
        failed.push(`${m.title}: ${err.message}`);
      }
    }
  }
  compat.invalidate(inst.id);
  return { done, failed };
});
ipcMain.handle("content:setEnabled", async (_e, id, item, enabled) => {
  refuseModChangeWhileRunning(id, item && item.kind);
  return content.setEnabled((await instances.require(id)).gameDir, item, Boolean(enabled));
});
ipcMain.handle("content:remove", async (_e, id, item) => {
  refuseModChangeWhileRunning(id, item && item.kind);
  return content.remove((await instances.require(id)).gameDir, item, (full) => shell.trashItem(full));
});
ipcMain.handle("content:install", async (_e, id, request) => {
  const kind = request && request.kind;
  refuseModChangeWhileRunning(id, kind);
  const inst = await instances.require(id);
  // A shader pack may go into a running instance, but not the Iris it may need.
  return content.install(inst, request, (p) => send("content:progress", { instanceId: id, op: "install", ...p }), { noModChanges: running.has(id) });
});
// "Safe to delete" -> Delete all. The main process works out what is invalid
// itself (content.removeInvalid) - it never takes file names from the page.
ipcMain.handle("content:invalidDetails", async (_e, id, kind) => content.invalidDetails((await instances.require(id)).gameDir, kind));
ipcMain.handle("content:removeInvalid", async (_e, id, kind) => {
  refuseModChangeWhileRunning(id, kind);
  return content.removeInvalid((await instances.require(id)).gameDir, kind, (full) => shell.trashItem(full));
});
// "Update mods to fit <version>": every enabled mod built for another
// version or loader goes to its newest stable build for this one (see
// modsSync.js). One run per instance, never while its game is starting or
// running.
const syncing = new Set();
// options.files: only these mod files (plain names) - the Play warning and a crash notice fix one or a few.
ipcMain.handle("mods:sync", async (_e, id, options) => {
  if (running.has(id)) throw new Error("Close the game first - that instance is running.");
  if (syncing.has(id)) throw new Error("That instance's mods are already being updated.");
  const inst = await instances.require(id);
  if (inst.loader === "vanilla") throw new Error("A vanilla instance has no mods to update.");
  syncing.add(id);
  try {
    const files = options && Array.isArray(options.files) ? options.files.filter((f) => typeof f === "string" && f && f === path.basename(f)).slice(0, 500) : null;
    return await modsSync.applySync(inst, (p) => send("content:progress", { instanceId: id, op: "update", ...p }), {}, files ? { files } : {});
  } finally {
    syncing.delete(id);
  }
});
ipcMain.handle("content:creators", async (_e, id) => content.lookupCreators((await instances.require(id)).gameDir));
ipcMain.handle("content:checkUpdates", async (_e, id) => content.checkUpdates(await instances.require(id)));
ipcMain.handle("content:applyUpdates", async (_e, id, updates) => {
  if (running.has(id)) throw new Error("Close the game first - Windows won't let files in use be replaced.");
  // The same guard as "Update mods to fit": Play (which writes Reminth's own
  // jars into mods/) and a second update can't start while jars are swapped.
  if (syncing.has(id)) throw new Error("That instance's mods are already being updated.");
  // Marked busy BEFORE the first await: a second click that arrives while the
  // instance is still being read must not slip past the check above.
  syncing.add(id);
  try {
    const inst = await instances.require(id);
    return await content.applyUpdates(inst, Array.isArray(updates) ? updates.slice(0, 500) : [], (p) =>
      send("content:progress", { instanceId: id, op: "update", ...p })
    );
  } finally {
    syncing.delete(id);
  }
});

// ---- compatibility help (compat.js) ----
// Which mods won't load on this instance, why, and what fixes each.
ipcMain.handle("compat:check", async (_e, id, options) => {
  const inst = await instances.require(id);
  // localOnly: the quick answer for the Play button (no hashing, no network).
  const result = await compat.checkInstance(inst, { force: Boolean(options && options.force), localOnly: Boolean(options && options.localOnly) });
  // "Don't ask again" on the Play warning was for another set of mods: it's gone.
  if (inst.skipModWarning && result && result.modSet && result.modSet !== inst.skipModWarning) {
    instances.update(id, { skipModWarning: null }).catch(() => {});
  }
  return result;
});
// Play's "may crash the game" warning: "Don't ask again for this instance",
// for exactly this set of switched-on mods (compat's modSet). null forgets it.
ipcMain.handle("compat:skipModWarning", async (_e, id, modSet) => {
  if (modSet !== null && !(typeof modSet === "string" && /^[0-9a-f]{40}$/.test(modSet))) throw new Error("That change isn't valid.");
  await instances.update(id, { skipModWarning: modSet });
  return { ok: true };
});

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
let copySourceId = null; // the instance a copy is being made from (not deleted meanwhile)
ipcMain.handle("compat:copyToVersion", async (_e, id, request) => {
  const source = await instances.require(id);
  const r = request && typeof request === "object" ? request : {};
  if (!instances.isValidVersionId(r.mcVersion)) throw new Error("Pick a Minecraft version first.");
  if (copyInFlight) throw new Error("A copy is already being made - wait for it to finish.");
  copyInFlight = true;
  copySourceId = id;
  try {
    const result = await migrate.copyToVersion(
      source,
      { mcVersion: r.mcVersion, name: typeof r.name === "string" ? r.name : null },
      {
        createInstance: async (fields) => {
          const lv = await resolveLoaderVersion(fields.loader, fields.mcVersion, null);
          // The copy keeps the source's profile, and a Forge/NeoForge pack
          // switched on stays on (migrate only passes "off").
          const created = await instances.create({
            ...fields,
            madeFor: instances.cleanMadeFor(`Copy of ${source.name}`),
            loaderVersion: lv,
            perfProfile: source.perfProfile,
            ...(source.performanceMods === true ? { performanceMods: true } : {}),
          });
          // Its settings came over from the original (or deliberately
          // didn't): never write a starting options.txt into a copy.
          await gameOptions.markNoSeed(created.gameDir, "copied");
          return created;
        },
      },
      (p) => send("compat:progress", { instanceId: id, ...p })
    );
    return { ...result, instance: withRunning(result.instance) };
  } finally {
    copyInFlight = false;
    copySourceId = null;
  }
});

// "Switch this instance to <version>" (versionSwitch.js): the instance
// itself moves, its mods are swapped to stable builds, the rest switched off.
ipcMain.handle("compat:switchVersion", async (_e, id, request) => {
  const r = request && typeof request === "object" ? request : {};
  if (!instances.isValidVersionId(r.mcVersion)) throw new Error("Pick a Minecraft version first.");
  if (running.has(id)) throw new Error("Close the game first - that instance is running.");
  if (copyInFlight || syncing.has(id)) throw new Error("Something is already changing that instance's mods - wait for it to finish.");
  syncing.add(id);
  try {
    const result = await versionSwitch.switchVersion(id, r.mcVersion, {
      isRunning: (iid) => running.has(iid),
      resolveLoaderVersion,
      onProgress: (p) => send("compat:progress", { instanceId: id, ...p }),
    });
    return { ...result, instance: withRunning(result.instance) };
  } finally {
    syncing.delete(id);
  }
});

// The confirm step's exact preview of a switch (nothing is changed).
ipcMain.handle("compat:previewSwitch", async (_e, id, request) => {
  const r = request && typeof request === "object" ? request : {};
  if (!instances.isValidVersionId(r.mcVersion)) throw new Error("Pick a Minecraft version first.");
  return versionSwitch.previewSwitch(id, r.mcVersion);
});

// Modpack installs in progress, by the token the renderer chose, so its Cancel button can stop one.
const modpackInstalls = new Map(); // token -> AbortController
ipcMain.handle("modpack:install", async (_e, request) => {
  const r = request && typeof request === "object" ? request : {};
  const token = typeof r.token === "string" && r.token.length <= 64 ? r.token : null;
  const controller = new AbortController();
  if (token) modpackInstalls.set(token, controller);
  const progress = (p) => send("modpack:progress", p);
  try {
    if (r.intoInstanceId) {
      // Into an instance the player already has: same Minecraft version and loader only, never while it runs or
      // while its mods are being changed (the same lock Play and the mod updates use).
      const inst = await instances.require(String(r.intoInstanceId));
      if (running.has(inst.id)) throw new Error("Close the game first - that instance is running.");
      if (syncing.has(inst.id)) throw new Error("That instance's mods are already being updated.");
      syncing.add(inst.id);
      try {
        const result = await mrpack.installModpackInto(inst, { projectId: r.projectId, versionId: r.versionId }, progress, { signal: controller.signal });
        return { ...result, instance: withRunning(inst) };
      } finally {
        syncing.delete(inst.id);
      }
    }
    const inst = await mrpack.installModpack(r, progress, { signal: controller.signal });
    // The pack's own files own its settings: no starting options.txt from a
    // profile picked later, ever.
    await gameOptions.markNoSeed(inst && inst.gameDir, "modpack");
    return withRunning(inst);
  } finally {
    if (token) modpackInstalls.delete(token);
  }
});
ipcMain.handle("modpack:cancel", (_e, token) => {
  const controller = modpackInstalls.get(String(token || ""));
  if (controller) controller.abort();
  return Boolean(controller);
});
// What a pack version is for (from its listing), so instances it can't go into can be greyed out with a reason.
ipcMain.handle("modpack:target", async (_e, projectId, versionId) => {
  const target = await mrpack.packTarget(String(projectId || ""), versionId ? String(versionId) : undefined);
  const list = await instances.list();
  return {
    ...target,
    instances: list.map((inst) => {
      const fit = mrpack.packFitsInstance(target, inst);
      const why = running.has(inst.id) ? "Close the game first - it is running." : fit.why;
      return { id: inst.id, name: inst.name, loader: inst.loader, mcVersion: inst.mcVersion, ok: fit.ok && !running.has(inst.id), why };
    }),
  };
});

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

// "replaced": where every update keeps a copy of the mod jars it replaced
// (content.applyUpdates) - opened so the player can copy one back.
const FOLDERS = { game: "", mods: "mods", resourcepacks: "resourcepacks", shaderpacks: "shaderpacks", screenshots: "screenshots", logs: "logs", saves: "saves", replaced: path.join(".reminth", "replaced-mods") };
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
// The project page in Discover: project + people + builds + the description
// already parsed (projectPage.js), cached for a few minutes.
ipcMain.handle("catalog:projectPage", async (_e, idOrSlug) => projectPage.getProjectPage(idOrSlug));
// A link from a project page: always the player's default browser, never
// this window. Checked again here whatever the page said - https only, no
// user name or password in it, length capped (markdown.safeLink).
ipcMain.handle("link:open", async (_e, url) => {
  const href = markdown.safeLink(url);
  if (!href) throw new Error("Only https links can be opened.");
  await shell.openExternal(href);
  return { ok: true };
});
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

// Can this instance's Minecraft version open a world straight from Home?
// From its own version file when it's downloaded; null when it isn't yet.
ipcMain.handle("play:worldJoinSupport", async (_e, id) => {
  const inst = await instances.require(id);
  try {
    const file = path.join(paths.VERSIONS_DIR, inst.mcVersion, `${inst.mcVersion}.json`);
    return minecraft.supportsWorldJoin(JSON.parse(await fs.promises.readFile(file, "utf8")));
  } catch {
    return null;
  }
});

ipcMain.handle("play:run", async (_e, options = {}) => {
  if (!auth.current()) throw new Error("Not signed in.");
  const inst = options.instanceId ? await instances.require(options.instanceId) : await activeInstance();
  if (running.has(inst.id)) throw new Error("Minecraft is already running.");
  if (syncing.has(inst.id)) throw new Error("Its mods are being updated - wait a moment for that to finish.");
  // Claimed synchronously, before the first await below, so a second click
  // can't sail past the check and start a second copy on the same worlds.
  const claim = { child: null, startedAt: Date.now() };
  running.set(inst.id, claim);
  try {
    // A game that outlived an earlier Reminth is picked up at start-up
    // (adoptRunningGames, which then replaces this claim); a Play pressed in
    // the first second waits for that scan instead of starting a second copy.
    await adoptionDone;
    const current = running.get(inst.id);
    if (current && current !== claim && current.adopted) {
      throw new Error("Minecraft is already running for this instance - Reminth found it and is keeping track of it again.");
    }
    const accepted = Array.isArray(options.serverRulesAccepted) ? options.serverRulesAccepted.filter((x) => typeof x === "string").slice(0, 20) : [];
    return await startGame(inst, options.join, claim, options.world, accepted);
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
async function startGame(inst, join, claim, worldRequest, rulesAccepted = []) {
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
  // The list the home-screen mod checks before joining a server (serverRules.js); a failure never stops the launch.
  await serverRules.writeGameFile(inst, { accepted: rulesAccepted }).catch(() => {});
  // The player's own RAM setting wins; without one, the automatic amount
  // depends on the instance (a modpack gets more).
  const defaultMb = cachedSettings.maxMemoryMb ? 0 : await defaultMemoryFor(inst);
  if (stopped()) return cancelled;
  // Whatever settings.json says, never above what this machine can spare.
  const maxMemoryMb = Math.min(cachedSettings.maxMemoryMb || defaultMb, entitlements.ramCapMb());
  // A host name, or an IPv6 address - which the game wants in brackets
  // ("[::1]:25565") so its own colons aren't read as the port.
  const joinHost =
    join && typeof join.host === "string"
      ? /^[A-Za-z0-9.\-_]{1,255}$/.test(join.host)
        ? join.host
        : /^[0-9A-Fa-f:.]{2,45}$/.test(join.host) && join.host.includes(":")
          ? `[${join.host}]`
          : null
      : null;
  const safeJoin = joinHost ? { host: joinHost, port: Number(join.port) > 0 && Number(join.port) < 65536 ? Number(join.port) : 25565 } : null;
  // A world to open directly (Home "Jump back in"): only a plain folder name
  // that really is a world folder of THIS instance; otherwise it just starts.
  const worldAsked = typeof worldRequest === "string" && worldRequest.length > 0;
  const world = !safeJoin && worldAsked ? await gameData.worldFolderToOpen(inst.gameDir, worldRequest) : null;
  if (stopped()) return cancelled;

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
        // A native crash in the first seconds (an access violation right after a fresh install):
        // start the same game once more, quietly - it nearly always works the second time.
        if (!retried && !safe && minecraft.isEarlyNativeCrash(crashInfo)) {
          retried = true;
          try {
            if (spawnGame(null)) return;
          } catch {
            // the second start failed outright - report the first failure below
          }
        }
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
        noteLaunchReport(inst, claim.startedAt);
      },
      { ...cachedSettings, maxMemoryMb: safe ? safe.maxMemoryMb : maxMemoryMb, appVersion: app.getVersion() },
      inst,
      { join: safeJoin, world, safeMode: Boolean(safe) }
    );
    if (!child) return null;
    // The same object, filled in - so the checks here (and Stop) can tell
    // this session from one a later Play starts for the same instance.
    claim.child = child;
    // Only the process the session is on ends it: the refused first try
    // also "exits", a moment after its replacement has been started.
    child.once("exit", (code) => {
      if (claim.child !== child) return;
      finishSession(inst, true, claim);
      // Fabric's "incompatible mods" window keeps the game open until it is
      // closed, so the refusal can end up here rather than in onCrash.
      noteLaunchReport(inst, claim.startedAt);
      // A crash in play (after the start-up window onCrash watches) too.
      noteCrashReport(inst, claim.startedAt, code);
    });
    child.once("error", () => claim.child === child && finishSession(inst, false, claim));
    return child;
  };

  if (!spawnGame(null)) {
    if (!stopped()) running.delete(inst.id);
    return { launched: false };
  }
  claim.startedAt = Date.now();
  streamer.gameStarted();
  // How the window is now, before a fullscreen game (or "launch minimized")
  // changes it. A second game keeps what the first one found.
  if (!windowBeforeGame && win && !win.isDestroyed()) windowBeforeGame = { wasMaximized: win.isMaximized(), minimizedByUs: false };
  // "Last played" is now, not only when the game closes - Home shows the
  // instance being played straight away. Saved BEFORE "play:started" goes
  // out: the page reloads the list on that event and must see the new value.
  try {
    await instances.update(inst.id, { lastPlayed: claim.startedAt });
  } catch {
    // a failed save never stops the game
  }
  // The game can have ended during the save; "play:exited" has gone out then.
  if (running.get(inst.id) === claim) {
    send("play:started", { instanceId: inst.id, startedAt: claim.startedAt });
    if (cachedSettings.launchMinimized && win && !win.isDestroyed() && !win.isMinimized()) {
      win.minimize();
      if (windowBeforeGame) windowBeforeGame.minimizedByUs = true;
    }
  }
  // When a world was asked for: did the game get told to open it?
  return worldAsked ? { launched: true, worldJoin: Boolean(world) && minecraft.supportsWorldJoin(installResult.profile) } : { launched: true };
}

/**
 * After a game that ended: if Fabric refused to start because of mods that
 * need another Minecraft version, remember which files it named
 * (<instance>/.reminth/launch-report.json) so the compatibility check, and
 * "Update mods to fit", treat them as "won't load" until the file changes.
 * A start that got past loading mods clears the old report.
 * Only the instance's own logs/latest.log is read, only if it was written by
 * this launch, never through a link, and at most its last 512 KB.
 */
const LAUNCH_REPORT_TAIL_BYTES = 512 * 1024;
const LAUNCH_REPORT_WINDOW_MS = 30 * 60 * 1000; // a session longer than this got well past loading
async function noteLaunchReport(inst, startedAt) {
  try {
    if (!inst || !inst.gameDir || inst.loader === "vanilla") return;
    if (Date.now() - (startedAt || 0) > LAUNCH_REPORT_WINDOW_MS) return;
    const gameDir = await fs.promises.realpath(inst.gameDir);
    const logFile = path.join(gameDir, "logs", "latest.log");
    const st = await fs.promises.lstat(logFile);
    if (!st.isFile() || st.mtimeMs < (startedAt || 0) - 2000) return; // a link, or an older game's log
    const real = await fs.promises.realpath(logFile);
    if (!real.startsWith(path.join(gameDir, "logs") + path.sep)) return;
    const len = Math.min(st.size, LAUNCH_REPORT_TAIL_BYTES);
    const fh = await fs.promises.open(real, "r");
    let text = "";
    try {
      const buf = Buffer.alloc(len);
      const { bytesRead } = await fh.read(buf, 0, len, Math.max(0, st.size - len));
      text = buf.toString("utf8", 0, bytesRead);
    } finally {
      await fh.close();
    }
    const reportFile = path.join(gameDir, compat.LAUNCH_REPORT_FILE);
    const found = compat.minecraftMismatches(compat.parseIncompatibleMods(text));
    if (!found.length) {
      // Got past the mod check this time: last time's report no longer says anything.
      // ("Loading Minecraft" is no proof: Fabric prints it before it checks the mods.)
      if (/Setting user:|Sound engine started|Backend library: LWJGL/.test(text)) {
        await fs.promises.rm(reportFile, { force: true });
        compat.invalidate(inst.id);
      }
      return;
    }
    const mods = compat.mapReportToFiles(found, (await content.listAll(gameDir)).mod);
    if (!mods.length) return;
    await atomic.writeJsonAtomic(reportFile, { at: new Date().toISOString(), mcVersion: inst.mcVersion, loader: inst.loader, mods }, { space: 2 });
    compat.invalidate(inst.id);
    send("compat:changed", { instanceId: inst.id, refused: mods.length });
  } catch {
    // no log, a locked file - the next look just doesn't know more
  }
}

/**
 * After a game ended: if it left a crash report and that report points at
 * exactly one of the instance's own mods (crashReport.findCulprit - never a
 * guess), remember it in <instance>/.reminth/crash-finding.json, so the
 * compatibility panel shows that mod as "Crashed the game" (until the file
 * changes), and tell the window, which says which mod it was and offers the
 * fix. A clean exit (code 0, no new report) forgets the last finding.
 */
async function noteCrashReport(inst, startedAt, exitCode) {
  try {
    if (!inst || !inst.gameDir || inst.loader === "vanilla") return;
    const gameDir = await fs.promises.realpath(inst.gameDir);
    const findingFile = path.join(gameDir, crashReport.FINDING_FILE);
    const before = await crashReport.readFinding(gameDir);
    let report = await crashReport.latestReport(gameDir, startedAt);
    if (report && before && before.report === report.name) report = null; // that one was already told
    if (!report) {
      if (exitCode === 0 && before) {
        await fs.promises.rm(findingFile, { force: true });
        compat.invalidate(inst.id);
      }
      return;
    }
    const parsed = crashReport.parseCrashReport(report.text);
    const items = (await content.listAll(gameDir)).mod || [];
    const culprit = crashReport.findCulprit(parsed, items, { skipFiles: await compat.managedNames(gameDir) });
    if (!culprit) return;
    const it = culprit.item;
    const name = it.title || it.name || it.file;
    await atomic.writeJsonAtomic(
      findingFile,
      {
        at: new Date().toISOString(),
        report: report.name,
        mcVersion: inst.mcVersion,
        loader: inst.loader,
        how: culprit.how,
        description: parsed.description,
        error: parsed.error,
        mod: { file: it.file, size: it.size, mtimeMs: it.modifiedAt, modId: it.modId || null, name },
      },
      { space: 2 }
    );
    compat.invalidate(inst.id);
    send("play:crashCulprit", { instanceId: inst.id, file: it.file, name });
  } catch {
    // no report, a locked file - nothing is said then
  }
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

/** The time every instance has recorded (what the lifetime counter starts from). */
async function sumOfInstancePlayTime() {
  return (await instances.list()).reduce((sum, i) => sum + (Number(i.playTimeMs) || 0), 0);
}

/**
 * A game this Reminth did not start itself - started by an earlier run of
 * Reminth that has since been closed, restarted or updated - is still
 * running. Puts it back in `running` (so Play, Stop, the lock on mods and
 * the play time all work for it) and watches for it to end.
 */
function adoptProcess(inst, proc) {
  const pid = proc.pid;
  const claim = {
    child: {
      pid,
      kill: () => {
        try {
          process.kill(pid);
        } catch {
          // already gone
        }
      },
    },
    // When the process started: all the time it ran counts once, when it ends.
    startedAt: proc.startedAt || Date.now(),
    adopted: true,
    stopWatching: null,
  };
  running.set(inst.id, claim);
  streamer.gameStarted();
  claim.stopWatching = runningGames.watchUntilGone(pid, () => finishSession(inst, true, claim));
  send("play:started", { instanceId: inst.id, startedAt: claim.startedAt });
  return claim;
}

/** Looks for games already running for any instance and adopts them. */
async function adoptRunningGames() {
  const list = await instances.list();
  const found = runningGames.matchInstances(await runningGames.listGameProcesses(), list);
  for (const inst of list) {
    const proc = found.get(inst.id);
    if (!proc) continue;
    // A Play that is only just starting (a claim with no process yet) gives way to the real game.
    const existing = running.get(inst.id);
    if (!existing || (existing.child === null && !existing.adopted)) adoptProcess(inst, proc);
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
  if (session.stopWatching) session.stopWatching();
  if (session.child) streamer.gameStopped();
  if (played) {
    const endedAt = Date.now();
    const ms = Math.max(0, endedAt - (session.startedAt || endedAt));
    // The instance's own time, then the lifetime counter - in that order, so
    // a counter that still has to be seeded counts this session once. A
    // failed write here never gets in the way of the exit handling.
    instances
      .recordSession(inst.id, session.startedAt, endedAt)
      .catch(() => {})
      .then(() => store.addPlayTime(ms, sumOfInstancePlayTime))
      .then((total) => {
        if (total !== null && total !== undefined) {
          cachedSettings = { ...cachedSettings, totalPlayTimeMs: total };
          send("play:totalTime", { totalPlayTimeMs: total });
        }
      })
      .catch(() => {});
  }
  // Crash reports appear right away; the session's log is rolled by the
  // game on its next start and archived then.
  setTimeout(() => logs.importInstanceLogs(inst).catch(() => {}), 1500);
  send("play:exited", { instanceId: inst.id });
  restoreWindowAfterGame();
}

/**
 * Once no game runs any more: the window back the way it was when the game
 * was launched (Windows un-maximizes it for a fullscreen game, or leaves it
 * flagged maximized but shrunk to 800x552; "launch minimized" minimized
 * it). Never while a game runs; never a window that wasn't maximized made
 * maximized; at most once per game end. Decided by windowRestore.afterGame.
 */
function windowNow() {
  let boundsFillWorkArea = true; // can't tell: change nothing on a guess
  try {
    const bounds = win.getBounds();
    boundsFillWorkArea = windowRestore.fillsWorkArea(bounds, screen.getDisplayMatching(bounds).workArea);
  } catch {
    // no display information - leave the size alone
  }
  return { isMaximized: win.isMaximized(), isMinimized: win.isMinimized(), anyGameRunning: running.size > 0, boundsFillWorkArea };
}

function restoreWindowAfterGame() {
  if (!windowBeforeGame || !win || win.isDestroyed()) return;
  const before = windowBeforeGame;
  let action = windowRestore.afterGame(before, windowNow());
  if (action === "wait") return;
  windowBeforeGame = null; // done for this game end, whatever happens below
  if (action === "none") return;
  if (action === "restore" || action === "restore-maximize") win.restore();
  if (action === "maximize" || action === "restore-maximize") win.maximize();
  // Brought back, but Windows' "maximized" window is still the small one: that needs the repair too.
  if (action !== "repair") action = windowRestore.afterGame({ ...before, minimizedByUs: false }, windowNow());
  if (action === "repair") {
    const small = win.getBounds();
    win.unmaximize();
    win.maximize();
    before.repaired = true;
    const now = win.getBounds();
    logCrash("window", `After a game the window said maximized but was ${small.width}x${small.height}; repaired to ${now.width}x${now.height}.`);
  }
  send("window:maximized", win.isMaximized());
}
