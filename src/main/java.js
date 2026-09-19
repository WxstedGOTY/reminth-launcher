"use strict";
/**
 * Downloads and unpacks a private JDK 25 into paths.JAVA_DIR. Reminth
 * bundles its own Java rather than relying on a system install or another
 * launcher's copy - it's fully standalone, so this has to be self-managed
 * like everything else (see minecraft.js, msAuth.js).
 */
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
// extract-zip required lazily below; fetch is Node's global (18+).

const paths = require("./paths");
const { fileExists } = require("./downloader");

// Microsoft's aka.ms alias always points at the newest build of that
// major version for Windows x64. Verify this still resolves before
// shipping - Microsoft occasionally reshuffles these aliases.
const JDK_URL = "https://aka.ms/download-jdk/microsoft-jdk-25-windows-x64.zip";

async function ensureJava(onProgress) {
  const marker = path.join(paths.JAVA_DIR, "bin", "javaw.exe");
  if (await fileExists(marker)) return;

  onProgress && onProgress({ stage: "Downloading Java 25", current: 0, total: 1 });
  await fsp.mkdir(paths.JAVA_DIR, { recursive: true });
  const zipPath = path.join(paths.JAVA_DIR, "jdk.zip");

  const res = await fetch(JDK_URL, { redirect: "follow" });
  if (!res.ok) throw new Error(`JDK download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fsp.writeFile(zipPath, buf);

  onProgress && onProgress({ stage: "Unpacking Java 25", current: 0, total: 1 });
  const extractZip = require("extract-zip");
  const extractDir = path.join(paths.JAVA_DIR, "_extract");
  await extractZip(zipPath, { dir: extractDir });

  // Microsoft's zip contains one top-level folder like
  // "jdk-25.0.1+9". Flatten it into JAVA_DIR directly. Look specifically
  // for that directory rather than blindly trusting readdir's first
  // result (e.g. a stray README or a differently-cased entry sorting
  // ahead of it would otherwise silently produce a broken install).
  const entries = await fsp.readdir(extractDir, { withFileTypes: true });
  if (!entries.length) {
    throw new Error("Downloaded JDK archive was empty after extraction.");
  }
  const jdkDir = entries.find((e) => e.isDirectory() && e.name.startsWith("jdk-")) || entries.find((e) => e.isDirectory());
  if (!jdkDir) {
    throw new Error("Couldn't find a JDK folder inside the downloaded archive.");
  }
  const topLevel = path.join(extractDir, jdkDir.name);
  await moveContents(topLevel, paths.JAVA_DIR);
  await fsp.rm(extractDir, { recursive: true, force: true });
  await fsp.rm(zipPath, { force: true });
}

async function moveContents(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  for (const entry of await fsp.readdir(src)) {
    await fsp.rename(path.join(src, entry), path.join(dest, entry));
  }
}

module.exports = { ensureJava };
