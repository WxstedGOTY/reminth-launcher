"use strict";
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

const minecraft = require("./minecraft");
const msAuth = require("./msAuth");
const store = require("./store");
const paths = require("./paths");

let win;
let cachedAccount = null;

function createWindow() {
  win = new BrowserWindow({
    width: 980,
    height: 640,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: "#090A0F",
    frame: false, // custom title bar drawn in renderer, matches the brand's borderless look
    icon: path.join(__dirname, "..", "..", "assets", "icon.png"), // taskbar/alt-tab icon
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

app.whenReady().then(async () => {
  createWindow();
  cachedAccount = await store.loadAccount();
  if (cachedAccount) {
    win.webContents.once("did-finish-load", () => {
      win.webContents.send("auth:restored", { username: cachedAccount.username });
    });
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---- window chrome (custom title bar) ----
ipcMain.on("window:minimize", () => win.minimize());
ipcMain.on("window:close", () => win.close());

// ---- sign in with Microsoft (device code flow) ----
ipcMain.handle("auth:signIn", async () => {
  const account = await msAuth.signIn({
    onCode: (data) => win.webContents.send("auth:code", data),
    onWaiting: () => win.webContents.send("auth:waiting"),
  });
  cachedAccount = account;
  await store.saveAccount(account);
  return { username: account.username };
});

ipcMain.handle("auth:signOut", async () => {
  cachedAccount = null;
  await store.clearAccount();
  return { ok: true };
});

// ---- download/update (Fabric + Fabric API + WxHUD, into Reminth's own private instance) ----
// Deliberately independent of sign-in: all of this is public, unauthenticated
// downloads (Mojang's version manifest, Fabric's meta API and Maven, WxHUD's
// bundled jar), so there's no reason to gate it behind Microsoft sign-in -
// and it lets players pre-download while a friend walks them through signing
// in, or just keep an instance up to date without opening the game.
ipcMain.handle("debug:paths", () => ({
  MODS_DIR: paths.MODS_DIR,
  GAME_DIR: paths.GAME_DIR,
  ROOT: paths.ROOT,
}));

ipcMain.handle("install:run", async () => {
  const installResult = await minecraft.ensureInstalled((progress) => {
    win.webContents.send("install:progress", progress);
  });
  win.webContents.send("install:done");
  return installResult;
});

// ---- sign in (if needed) + ensure installed + launch ----
ipcMain.handle("play:run", async () => {
  if (!cachedAccount) throw new Error("Not signed in.");

  // A stored MS refresh token can go stale; refresh it silently before
  // launching rather than making the player sign in again every session.
  try {
    cachedAccount = await msAuth.refreshSession(cachedAccount.msRefreshToken);
    await store.saveAccount(cachedAccount);
  } catch {
    // fall through and try with whatever we have cached; ensureInstalled
    // still runs, and launch() will simply fail Mojang's own check if the
    // token really is dead - at which point the UI should prompt sign-in
    // again (see renderer.js).
  }

  const installResult = await minecraft.ensureInstalled((progress) => {
    win.webContents.send("install:progress", progress);
  });
  win.webContents.send("install:done");

  minecraft.launch(installResult, cachedAccount);
  return { launched: true };
});
