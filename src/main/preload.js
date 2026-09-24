"use strict";
const { contextBridge, ipcRenderer } = require("electron");

const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, data) => cb(data));

contextBridge.exposeInMainWorld("reminth", {
  // window chrome
  minimize: () => ipcRenderer.send("window:minimize"),
  maximizeToggle: () => ipcRenderer.send("window:maximizeToggle"),
  close: () => ipcRenderer.send("window:close"),
  onMaximized: on("window:maximized"),

  // account + skins
  currentAccount: () => ipcRenderer.invoke("auth:current"),
  signIn: () => ipcRenderer.invoke("auth:signIn"),
  signOut: () => ipcRenderer.invoke("auth:signOut"),
  skin: () => ipcRenderer.invoke("auth:skin"),
  skinProfile: () => ipcRenderer.invoke("skin:profile"),
  skinApply: (req) => ipcRenderer.invoke("skin:apply", req),
  skinSetCape: (capeId) => ipcRenderer.invoke("skin:setCape", capeId),
  skinLibrary: () => ipcRenderer.invoke("skin:library"),
  skinLibrarySave: (req) => ipcRenderer.invoke("skin:librarySave", req),
  skinLibraryRename: (id, name) => ipcRenderer.invoke("skin:libraryRename", id, name),
  skinLibraryRemove: (id) => ipcRenderer.invoke("skin:libraryRemove", id),
  skinLookup: (username) => ipcRenderer.invoke("skin:lookup", username),
  skinDefaults: () => ipcRenderer.invoke("skin:defaults"),

  // instances
  instances: () => ipcRenderer.invoke("instances:list"),
  createInstance: (req) => ipcRenderer.invoke("instances:create", req),
  updateInstance: (id, patch) => ipcRenderer.invoke("instances:update", id, patch),
  deleteInstance: (id) => ipcRenderer.invoke("instances:delete", id),
  versions: () => ipcRenderer.invoke("versions:list"),
  loaderVersions: (loader, mc) => ipcRenderer.invoke("loaders:versions", loader, mc),
  hudBuilds: () => ipcRenderer.invoke("hud:builds"),
  hudSupports: (mc) => ipcRenderer.invoke("hud:supports", mc),
  installModpack: (req) => ipcRenderer.invoke("modpack:install", req),

  // play / install
  play: (options) => ipcRenderer.invoke("play:run", options || {}),
  install: (instanceId) => ipcRenderer.invoke("install:run", instanceId),

  // launcher + instance info
  appInfo: () => ipcRenderer.invoke("app:info"),
  debugPaths: () => ipcRenderer.invoke("debug:paths"),
  openFolder: (which, instanceId) => ipcRenderer.invoke("instance:openFolder", which, instanceId),
  openCapturesFolder: () => ipcRenderer.invoke("captures:openFolder"),

  // content
  content: (instanceId) => ipcRenderer.invoke("content:list", instanceId),
  setContentEnabled: (instanceId, item, enabled) => ipcRenderer.invoke("content:setEnabled", instanceId, item, enabled),
  removeContent: (instanceId, item) => ipcRenderer.invoke("content:remove", instanceId, item),
  installContent: (instanceId, req) => ipcRenderer.invoke("content:install", instanceId, req),
  checkUpdates: (instanceId) => ipcRenderer.invoke("content:checkUpdates", instanceId),
  applyUpdates: (instanceId, updates) => ipcRenderer.invoke("content:applyUpdates", instanceId, updates),

  // what the player has played (read-only, from their own save files)
  recent: () => ipcRenderer.invoke("game:recent"),
  instanceData: (instanceId) => ipcRenderer.invoke("game:instanceData", instanceId),
  stats: () => ipcRenderer.invoke("game:stats"),

  // logs
  logs: (instanceId) => ipcRenderer.invoke("logs:list", instanceId),
  readLog: (instanceId, logId) => ipcRenderer.invoke("logs:read", instanceId, logId),

  // servers
  searchServers: (params) => ipcRenderer.invoke("servers:search", params),
  pingServers: (addresses) => ipcRenderer.invoke("servers:ping", addresses),
  addServer: (instanceId, server) => ipcRenderer.invoke("servers:add", instanceId, server),

  // settings
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (partial) => ipcRenderer.invoke("settings:set", partial),

  // streamer mode
  streamerStatus: () => ipcRenderer.invoke("streamer:status"),
  screenshot: () => ipcRenderer.invoke("streamer:screenshot"),
  saveClip: () => ipcRenderer.invoke("streamer:clip"),
  captures: () => ipcRenderer.invoke("streamer:captures"),
  openCapture: (file, how) => ipcRenderer.invoke("streamer:open", file, how),
  deleteCapture: (file) => ipcRenderer.invoke("streamer:delete", file),

  // Modrinth catalog - the renderer never reaches api.modrinth.com itself.
  searchCatalog: (params) => ipcRenderer.invoke("catalog:search", params),
  getCatalogProject: (idOrSlug) => ipcRenderer.invoke("catalog:project", idOrSlug),
  getCatalogProjectVersions: (idOrSlug, filters) => ipcRenderer.invoke("catalog:projectVersions", idOrSlug, filters),
  getCatalogDependencies: (idOrSlug) => ipcRenderer.invoke("catalog:dependencies", idOrSlug),
  getCatalogTags: (type) => ipcRenderer.invoke("catalog:tags", type),
  browseCachedCatalog: (params) => ipcRenderer.invoke("catalog:browseCached", params),
  catalogBySlugs: (projectType, slugs) => ipcRenderer.invoke("catalog:bySlugs", projectType, slugs),
  catalogWarmStatus: (projectType) => ipcRenderer.invoke("catalog:warmStatus", projectType),
  catalogWarmStart: (projectType, targetCount) => ipcRenderer.invoke("catalog:warmStart", projectType, targetCount),
  onCatalogWarmProgress: on("catalog:warmProgress"),

  // events
  onAccountRestored: on("auth:restored"),
  onAuthCode: on("auth:code"),
  onAuthWaiting: on("auth:waiting"),
  onInstallProgress: on("install:progress"),
  onInstallDone: on("install:done"),
  onPlayCrashed: on("play:crashed"),
  onPlayStarted: on("play:started"),
  onPlayExited: on("play:exited"),
  onContentChanged: on("content:changed"),
  onContentProgress: on("content:progress"),
  onModpackProgress: on("modpack:progress"),
  onStreamerStatus: on("streamer:status"),
  onStreamerSaved: on("streamer:saved"),
});
