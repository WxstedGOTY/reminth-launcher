"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const Module = require("module");
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { if (r === "electron") return "FA_ELECTRON"; return orig.call(this, r, ...a); };
Module._cache.FA_ELECTRON = { id: "FA_ELECTRON", filename: "FA_ELECTRON", loaded: true, exports: { app: { getPath: () => os.tmpdir(), isPackaged: false, getVersion: () => "1.4.8" }, safeStorage: { isEncryptionAvailable: () => false } } };
const minecraft = require("C:/Users/kolijos/Downloads/reminth-launcher/src/main/minecraft");
(async () => {
  const base = path.join(__dirname, "fa-check", String(Date.now()));
  for (const mc of ["1.14", "1.14.4", "1.15.2", "1.16.5", "1.17.1", "1.18.1", "1.18.2", "1.19", "1.19.1", "1.19.2", "1.21.1", "26.2"]) {
    const dir = path.join(base, mc);
    fs.mkdirSync(dir, { recursive: true });
    try {
      // a stub like the old Reminth left behind, named differently
      fs.writeFileSync(path.join(dir, "fabric-api-0.0.1+old.jar"), Buffer.alloc(4000));
      const f = await minecraft.downloadFabricApi(dir, mc);
      const files = fs.readdirSync(dir).map((n) => `${n}=${fs.statSync(path.join(dir, n)).size}`);
      console.log(mc.padEnd(7), "OK  ", f, fs.statSync(path.join(dir, f)).size, "bytes; folder:", files.join(", "));
    } catch (e) {
      console.log(mc.padEnd(7), "FAIL", String(e.message).slice(0, 120));
    }
  }
})();
