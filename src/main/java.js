"use strict";
/**
 * Java for whichever Minecraft version an instance runs.
 *
 * Different Minecraft versions need different Java versions (8 for 1.16
 * and older, 16/17/21 for the versions in between, 25 for 26.x). Each
 * version's own JSON says which one via javaVersion.component - the same
 * field the official launcher reads - and Mojang publishes those runtimes
 * with a per-file sha1 in a manifest on its own servers. That's the primary
 * source here: every file is hash-checked, every download is pinned to
 * mojang.com (see minecraft.js assertDownloadUrl), nothing is unzipped from
 * an unverified archive.
 *
 * Two fallbacks, in order:
 *   1. The JDK 25 older Reminth builds installed at paths.JAVA_DIR is reused
 *      for Java 25 versions, so existing players don't re-download it.
 *   2. If Mojang's runtime can't be fetched, Microsoft's OpenJDK build for
 *      that major version (11/17/21/25 exist) is used, as Reminth did before.
 */
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const paths = require("./paths");
const { downloadFile, fetchJson, fileExists, runPool } = require("./downloader");

const RUNTIME_INDEX_URL =
  "https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";
const PLATFORM = "windows-x64";
const MS_JDK_MAJORS = [11, 17, 21, 25];
const ALLOWED_RUNTIME_HOST = /(^|\.)mojang\.com$/i;

/** Pure: the component name for a version JSON's javaVersion block. Very old versions have none. */
function componentFor(javaVersion) {
  if (javaVersion && typeof javaVersion.component === "string" && /^[a-z0-9-]{1,40}$/.test(javaVersion.component)) {
    return javaVersion.component;
  }
  return "jre-legacy";
}

function majorFor(javaVersion) {
  const n = Number(javaVersion && javaVersion.majorVersion);
  return Number.isFinite(n) && n > 0 ? n : 8;
}

/**
 * Returns the absolute path to a javaw.exe suitable for `javaVersion`
 * (the version JSON's javaVersion block), installing it if needed.
 */
async function ensureRuntime(javaVersion, onProgress) {
  const report = (stage, current, total) => onProgress && onProgress({ stage, current, total });
  const component = componentFor(javaVersion);
  const major = majorFor(javaVersion);

  // 1. The original bundled JDK 25.
  const legacyJdk = path.join(paths.JAVA_DIR, "bin", "javaw.exe");
  if (major === 25 && (await fileExists(legacyJdk))) return legacyJdk;

  // 2. Mojang's runtime for this component.
  const runtimeDir = path.join(paths.RUNTIMES_DIR, component);
  const javaw = path.join(runtimeDir, "bin", "javaw.exe");
  try {
    await installMojangRuntime(component, runtimeDir, report);
    if (await fileExists(javaw)) return javaw;
    throw new Error("the runtime installed but has no javaw.exe");
  } catch (err) {
    // 3. Microsoft's OpenJDK for the same major version.
    if (MS_JDK_MAJORS.includes(major)) {
      report(`Mojang's Java ${major} wasn't available (${err.message}) - using Microsoft's build`, 0, 1);
      return installMicrosoftJdk(major, report);
    }
    throw new Error(`Couldn't install Java ${major} for this version: ${err.message}`);
  }
}

async function installMojangRuntime(component, dir, report) {
  report(`Checking Java (${component})`, 0, 1);
  const index = await fetchJson(RUNTIME_INDEX_URL);
  const entries = (index[PLATFORM] && index[PLATFORM][component]) || [];
  const entry = entries[0];
  if (!entry || !entry.manifest || !entry.manifest.url) throw new Error(`no ${component} runtime for Windows`);
  const versionName = String((entry.version && entry.version.name) || "unknown");

  const marker = path.join(dir, ".reminth-runtime");
  try {
    if ((await fsp.readFile(marker, "utf8")).trim() === versionName && (await fileExists(path.join(dir, "bin", "javaw.exe")))) {
      return; // already installed, same version
    }
  } catch {
    // not installed yet
  }

  assertMojangUrl(entry.manifest.url);
  const manifest = await fetchJson(entry.manifest.url);
  const files = Object.entries(manifest.files || {});
  const base = path.resolve(dir);
  const within = (rel) => {
    const full = path.resolve(base, rel);
    if (full !== base && !full.startsWith(base + path.sep)) throw new Error(`refused runtime path ${rel}`);
    return full;
  };

  for (const [rel, info] of files) {
    if (info && info.type === "directory") await fsp.mkdir(within(rel), { recursive: true });
  }
  const toDownload = files.filter(([, info]) => info && info.type === "file" && info.downloads && info.downloads.raw);
  let done = 0;
  await runPool(toDownload, 8, async ([rel, info]) => {
    const raw = info.downloads.raw;
    assertMojangUrl(raw.url);
    await downloadFile(raw.url, within(rel), raw.sha1);
    done++;
    if (done % 10 === 0 || done === toDownload.length) report(`Downloading Java (${versionName})`, done, toDownload.length);
  });
  // Windows has no use for the manifest's symlink entries (they're for
  // macOS/Linux layouts), so "link" entries are skipped on purpose.
  await fsp.writeFile(marker, versionName, "utf8");
}

function assertMojangUrl(url) {
  const parsed = new URL(String(url));
  if (parsed.protocol !== "https:" || !ALLOWED_RUNTIME_HOST.test(parsed.hostname)) {
    throw new Error(`refused a Java download from ${parsed.hostname}`);
  }
}

/** The pre-runtime-manifest path, generalised from "always JDK 25" to any major Microsoft ships. */
async function installMicrosoftJdk(major, report) {
  const dir = path.join(paths.RUNTIMES_DIR, `ms-jdk-${major}`);
  const javaw = path.join(dir, "bin", "javaw.exe");
  if (await fileExists(javaw)) return javaw;

  report(`Downloading Java ${major}`, 0, 1);
  await fsp.mkdir(dir, { recursive: true });
  const zipPath = path.join(dir, "jdk.zip");
  const res = await fetch(`https://aka.ms/download-jdk/microsoft-jdk-${major}-windows-x64.zip`, { redirect: "follow" });
  if (!res.ok) throw new Error(`Java ${major} download failed: ${res.status}`);
  await fsp.writeFile(zipPath, Buffer.from(await res.arrayBuffer()));

  report(`Unpacking Java ${major}`, 0, 1);
  const extractZip = require("extract-zip");
  const extractDir = path.join(dir, "_extract");
  await fsp.rm(extractDir, { recursive: true, force: true });
  await extractZip(zipPath, { dir: extractDir });
  const entries = await fsp.readdir(extractDir, { withFileTypes: true });
  const jdkDir = entries.find((e) => e.isDirectory() && e.name.startsWith("jdk-")) || entries.find((e) => e.isDirectory());
  if (!jdkDir) throw new Error("Couldn't find a JDK folder inside the downloaded archive.");
  for (const entry of await fsp.readdir(dir)) {
    if (entry === "_extract" || entry === "jdk.zip") continue;
    await fsp.rm(path.join(dir, entry), { recursive: true, force: true });
  }
  const top = path.join(extractDir, jdkDir.name);
  for (const entry of await fsp.readdir(top)) {
    await fsp.rename(path.join(top, entry), path.join(dir, entry));
  }
  await fsp.rm(extractDir, { recursive: true, force: true });
  await fsp.rm(zipPath, { force: true });
  return javaw;
}

module.exports = { ensureRuntime, componentFor, majorFor };
