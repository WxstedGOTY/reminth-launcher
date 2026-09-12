"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("reminth", {
  minimize: () => ipcRenderer.send("window:minimize"),
  close: () => ipcRenderer.send("window:close"),

  signIn: () => ipcRenderer.invoke("auth:signIn"),
  signOut: () => ipcRenderer.invoke("auth:signOut"),
  play: () => ipcRenderer.invoke("play:run"),
  install: () => ipcRenderer.invoke("install:run"),
  debugPaths: () => ipcRenderer.invoke("debug:paths"),

  onAccountRestored: (cb) => ipcRenderer.on("auth:restored", (_e, data) => cb(data)),
  onAuthCode: (cb) => ipcRenderer.on("auth:code", (_e, data) => cb(data)),
  onAuthWaiting: (cb) => ipcRenderer.on("auth:waiting", () => cb()),

  onInstallProgress: (cb) => ipcRenderer.on("install:progress", (_e, data) => cb(data)),
  onInstallDone: (cb) => ipcRenderer.on("install:done", () => cb()),
});
