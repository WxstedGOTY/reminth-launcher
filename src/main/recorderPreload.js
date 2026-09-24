"use strict";
// Bridge for the hidden replay-buffer window (src/recorder). It can only
// report segments/chunks/state back to the main process - nothing else.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("recorder", {
  onStart: (cb) => ipcRenderer.on("rec:start", (_e, cfg) => cb(cfg)),
  onStop: (cb) => ipcRenderer.on("rec:stop", () => cb()),
  onRotate: (cb) => ipcRenderer.on("rec:rotate", () => cb()),
  segmentBegin: (seg, startMs) => ipcRenderer.send("rec:segment-begin", { seg, startMs }),
  chunk: (seg, data) => ipcRenderer.send("rec:chunk", { seg, data }),
  segmentEnd: (seg, endMs) => ipcRenderer.send("rec:segment-end", { seg, endMs }),
  state: (running, error) => ipcRenderer.send("rec:state", { running, error: error || null }),
});
