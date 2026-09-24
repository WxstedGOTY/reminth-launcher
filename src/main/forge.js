"use strict";
/**
 * Forge and NeoForge installs, done the way their own installers do them -
 * without running the installer GUI and without touching .minecraft.
 *
 * Both ship an "installer jar" containing:
 *   install_profile.json  what to download and which processors to run
 *   version.json          the launch profile (main class, arguments, libraries)
 *   data/*, maven/*       binary patches and jars that aren't on any maven
 *
 * Three generations are handled:
 *   - Legacy (Forge 1.6 - 1.12.1): install_profile.json has "versionInfo"
 *     (the launch profile) and "install" (which bundled jar is Forge itself).
 *     No processors.
 *   - Spec 0/1 (Forge 1.12.2+, all NeoForge): separate version.json plus
 *     "processors" - small Java tools that patch the vanilla client jar into
 *     the one Forge/NeoForge actually loads. They're run here with the same
 *     Java the game uses.
 *
 * Every path that comes out of these files is contained to the libraries
 * folder (or a per-build work folder), and every download is pinned to the
 * hosts in minecraft.js's allow-list, exactly like vanilla's manifests.
 */
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const paths = require("./paths");
const { downloadFile, fetchMavenSha1, fileExists } = require("./downloader");
const { openZip } = require("./zipread");

const WORK_DIR = path.join(paths.ROOT, "cache", "loader-installers");
const PROCESSOR_TIMEOUT_MS = 10 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

/**
 * Pure: maven coordinate -> repository path.
 *   group:artifact:version[:classifier][@ext]
 */
function mavenPath(coord) {
  let [main, ext] = String(coord).split("@");
  ext = ext || "jar";
  const [group, artifact, version, classifier] = main.split(":");
  if (!group || !artifact || !version) throw new Error(`Not a maven coordinate: ${coord}`);
  const file = classifier ? `${artifact}-${version}-${classifier}.${ext}` : `${artifact}-${version}.${ext}`;
  return `${group.replace(/\./g, "/")}/${artifact}/${version}/${file}`;
}

/** Pure: "group:artifact[:classifier]" - a library's identity without its version. */
function libraryKey(name) {
  const [main, ext] = String(name || "").split("@");
  const [group, artifact, , classifier] = main.split(":");
  return [group, artifact, classifier || "", ext || ""].join(":");
}

/**
 * Pure: legacy maven hosts rewritten to where those files live today.
 * Old Forge profiles still point at files.minecraftforge.net/maven over
 * plain HTTP.
 */
function normaliseRepoUrl(url) {
  let u = String(url || "https://libraries.minecraft.net/").trim();
  u = u.replace(/^http:\/\//i, "https://");
  u = u.replace(/^https:\/\/files\.minecraftforge\.net\/maven\/?/i, "https://maven.minecraftforge.net/");
  return u.replace(/\/?$/, "/");
}

/**
 * Pure: a legacy (1.6 - 1.12.1) install_profile.json turned into a normal
 * version.json. Libraries the client doesn't need (clientreq: false) are
 * dropped; Forge's own jar is marked as coming from inside the installer.
 */
function legacyVersionJson(profile) {
  const vi = profile.versionInfo || {};
  const selfCoord = profile.install && profile.install.path;
  const libraries = [];
  for (const lib of vi.libraries || []) {
    if (!lib || typeof lib.name !== "string") continue;
    if (lib.clientreq === false) continue;
    const p = mavenPath(lib.name);
    const isSelf = lib.name === selfCoord;
    libraries.push({
      name: lib.name,
      downloads: { artifact: { path: p, url: isSelf ? "" : normaliseRepoUrl(lib.url) + p, sha1: null } },
    });
  }
  return {
    id: vi.id,
    inheritsFrom: vi.inheritsFrom,
    mainClass: vi.mainClass,
    minecraftArguments: vi.minecraftArguments,
    libraries,
  };
}

/**
 * Pure: resolves one processor data value for the client side.
 *   [maven:coord]  -> path of that library
 *   'literal'      -> literal
 *   /path/in/jar   -> the file extracted from the installer (extracted(path))
 */
function resolveDataValue(raw, libPath, extracted) {
  const v = String(raw);
  if (v.startsWith("[") && v.endsWith("]")) return libPath(v.slice(1, -1));
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  if (v.startsWith("/")) return extracted(v);
  return v;
}

/** Pure: substitutes {KEY} tokens and whole-argument [coord] references in a processor argument. */
function substituteProcessorArg(arg, vars, libPath) {
  const a = String(arg);
  if (a.startsWith("[") && a.endsWith("]")) return libPath(a.slice(1, -1));
  return a.replace(/\{([A-Z0-9_]+)\}/g, (m, key) => (Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : m));
}

/** Pure: does a processor run on the client? (No "sides" means both.) */
function runsOnClient(proc) {
  return !Array.isArray(proc.sides) || proc.sides.includes("client");
}

/** Pure: Main-Class out of a MANIFEST.MF body. */
function manifestMainClass(text) {
  // Manifest lines wrap at 72 bytes with a leading-space continuation.
  const unfolded = String(text).replace(/\r?\n /g, "");
  const m = unfolded.match(/^Main-Class:\s*(.+?)\s*$/m);
  return m ? m[1] : null;
}

/* ------------------------------------------------------------------ */
/* Install                                                             */
/* ------------------------------------------------------------------ */

function contained(base, relative) {
  const b = path.resolve(base);
  const full = path.resolve(b, String(relative || ""));
  if (full !== b && !full.startsWith(b + path.sep)) throw new Error(`Refused a path that escapes ${b}: ${relative}`);
  return full;
}

async function sha1Of(file) {
  try {
    return crypto.createHash("sha1").update(await fsp.readFile(file)).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Downloads the installer and reads it. Returns everything minecraft.js
 * needs: the launch profile (versionJson), the extra libraries processors
 * need (not on the game's classpath), and a finish() to call once
 * libraries and the vanilla client jar are in place.
 *
 * `installer` comes from loaders.installerFor(); `assertUrl` is
 * minecraft.js's host allow-list check.
 */
async function prepare({ installer, assertUrl, report }) {
  const workDir = contained(WORK_DIR, installer.key.replace(/[^\w.+-]/g, "_"));
  await fsp.mkdir(workDir, { recursive: true });
  const installerPath = path.join(workDir, "installer.jar");

  report && report("Downloading loader installer", 0, 1);
  const url = assertUrl(installer.url);
  const sha1 = await fetchMavenSha1(url);
  try {
    await downloadFile(url, installerPath, sha1);
  } catch (err) {
    if (/\(404\)/.test(err.message)) {
      throw new Error("This loader build has no installer to download - pick a different build.");
    }
    throw err;
  }

  const zip = await openZip(installerPath);
  try {
    const profile = JSON.parse(String(await zip.read("install_profile.json")));
    let versionJson;
    let processorLibraries = [];
    let processors = [];
    let data = {};
    const bundled = []; // { entry, relPath } - jars that come from inside the installer

    if (profile.versionInfo) {
      versionJson = legacyVersionJson(profile);
      const selfCoord = profile.install && profile.install.path;
      if (selfCoord && profile.install.filePath) {
        bundled.push({ entry: String(profile.install.filePath), relPath: mavenPath(selfCoord) });
      }
    } else {
      const jsonEntry = String(profile.json || "/version.json").replace(/^\//, "");
      versionJson = JSON.parse(String(await zip.read(jsonEntry)));
      processorLibraries = Array.isArray(profile.libraries) ? profile.libraries : [];
      processors = (Array.isArray(profile.processors) ? profile.processors : []).filter(runsOnClient);
      data = profile.data && typeof profile.data === "object" ? profile.data : {};
      // Any library whose jar ships inside the installer's maven/ folder.
      for (const lib of [...(versionJson.libraries || []), ...processorLibraries]) {
        const p = lib && lib.downloads && lib.downloads.artifact && lib.downloads.artifact.path;
        if (p && zip.has(`maven/${p}`)) bundled.push({ entry: `maven/${p}`, relPath: p });
      }
    }

    // Copy bundled jars into libraries/ now, while the installer is open.
    for (const b of bundled) {
      const dest = contained(paths.LIBRARIES_DIR, b.relPath);
      if (await fileExists(dest)) continue;
      const buf = await zip.read(b.entry);
      if (!buf) continue;
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.writeFile(dest, buf);
    }

    // Data files processors read from inside the installer (binary patches).
    const extractedFiles = {};
    for (const entry of Object.values(data)) {
      const v = entry && entry.client;
      if (typeof v === "string" && v.startsWith("/")) {
        const rel = v.replace(/^\/+/, "");
        const dest = contained(workDir, rel);
        const buf = await zip.read(rel);
        if (!buf) throw new Error(`The installer is missing ${rel}.`);
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.writeFile(dest, buf);
        extractedFiles[v] = dest;
      }
    }

    const bundledPaths = new Set(bundled.map((b) => b.relPath));
    return {
      versionJson,
      // Mark libraries that don't download from anywhere: bundled ones, and
      // ones a processor produces (patched client jars).
      processorLibraries: processorLibraries.map((lib) => markLocal(lib, bundledPaths)),
      bundledPaths,
      async finish({ clientJarPath, javaPath, mcVersion }) {
        // Libraries with no URL come from the installer or from a processor;
        // either way they must exist before the game can start.
        const required = (versionJson.libraries || [])
          .map((l) => l && l.downloads && l.downloads.artifact)
          .filter((a) => a && a.path && !a.url)
          .map((a) => contained(paths.LIBRARIES_DIR, a.path));
        if (processors.length) {
          await runProcessors({ processors, data, extractedFiles, workDir, installerPath, clientJarPath, javaPath, mcVersion, report, required });
        }
        for (const file of required) {
          if (!(await fileExists(file))) {
            throw new Error(`Installing the loader didn't produce ${path.basename(file)}. Try Verify files, or pick another build.`);
          }
        }
      },
    };
  } finally {
    await zip.close();
  }
}

function markLocal(lib, bundledPaths) {
  const a = lib && lib.downloads && lib.downloads.artifact;
  if (a && bundledPaths.has(a.path)) return { ...lib, downloads: { ...lib.downloads, artifact: { ...a, url: "" } } };
  return lib;
}

async function runProcessors({ processors, data, extractedFiles, workDir, installerPath, clientJarPath, javaPath, mcVersion, report, required = [] }) {
  const libPath = (coord) => contained(paths.LIBRARIES_DIR, mavenPath(coord));
  const extracted = (p) => {
    if (!extractedFiles[p]) throw new Error(`Processor wanted ${p}, which the installer doesn't have.`);
    return extractedFiles[p];
  };
  const vars = {
    SIDE: "client",
    MINECRAFT_JAR: clientJarPath,
    MINECRAFT_VERSION: mcVersion,
    ROOT: paths.INSTANCE_DIR, // the folder that holds libraries/
    INSTALLER: installerPath,
    LIBRARY_DIR: paths.LIBRARIES_DIR,
  };
  for (const [key, entry] of Object.entries(data)) {
    if (entry && typeof entry.client === "string") vars[key] = resolveDataValue(entry.client, libPath, extracted);
  }

  const outputsOf = (proc) =>
    Object.entries(proc.outputs || {}).map(([file, hash]) => ({
      file: substituteProcessorArg(file, vars, libPath),
      sha1: substituteProcessorArg(hash, vars, libPath).replace(/^'|'$/g, "").toLowerCase(),
    }));

  // A finished install leaves a stamp. With the stamp, every declared
  // output and every file the game needs still in place, there's nothing
  // to redo on the next launch.
  const stamp = path.join(workDir, "processed.json");
  if (await fileExists(stamp)) {
    let intact = true;
    for (const f of required) if (!(await fileExists(f))) intact = false;
    for (const proc of processors) if (intact && !(await allOutputsValid(outputsOf(proc)))) intact = false;
    if (intact) return;
    await fsp.rm(stamp, { force: true });
  }
  const javaExe = await pickJavaExe(javaPath);

  let n = 0;
  for (const proc of processors) {
    n++;
    report && report(`Patching Minecraft (${n}/${processors.length})`, n - 1, processors.length);
    const outputs = outputsOf(proc);
    if (outputs.length && (await allOutputsValid(outputs))) continue;

    const jar = libPath(proc.jar);
    const zip = await openZip(jar);
    let mainClass;
    try {
      mainClass = manifestMainClass(String((await zip.read("META-INF/MANIFEST.MF")) || ""));
    } finally {
      await zip.close();
    }
    if (!mainClass) throw new Error(`${proc.jar} has no Main-Class - can't run it.`);
    const classpath = [proc.jar, ...(proc.classpath || [])].map(libPath).join(";");
    const args = (proc.args || []).map((a) => substituteProcessorArg(a, vars, libPath));

    await runJava(javaExe, ["-cp", classpath, mainClass, ...args], workDir, proc.jar);

    for (const out of outputs) {
      const actual = await sha1Of(out.file);
      if (!actual) throw new Error(`${proc.jar} finished but didn't create ${path.basename(out.file)}.`);
      if (out.sha1 && actual !== out.sha1) {
        await fsp.rm(out.file, { force: true });
        throw new Error(`${path.basename(out.file)} came out wrong (checksum mismatch) - try again, or pick another build.`);
      }
    }
  }
  await fsp.writeFile(stamp, JSON.stringify({ at: Date.now() }));
  report && report("Patching Minecraft", processors.length, processors.length);
}

async function allOutputsValid(outputs) {
  for (const out of outputs) {
    const actual = await sha1Of(out.file);
    if (!actual || (out.sha1 && actual !== out.sha1)) return false;
  }
  return true;
}

/** Processors print progress to stdout; java.exe beside javaw.exe keeps that capturable. */
async function pickJavaExe(javaPath) {
  const dir = path.dirname(javaPath);
  for (const name of ["java.exe", "java"]) {
    const p = path.join(dir, name);
    if (await fileExists(p)) return p;
  }
  return javaPath;
}

function runJava(javaExe, args, cwd, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(javaExe, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const keep = (chunk) => {
      tail = (tail + chunk.toString()).slice(-4000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${label} took over 10 minutes and was stopped.`));
    }, PROCESSOR_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      const last = tail.trim().split(/\r?\n/).slice(-6).join("\n");
      reject(new Error(`${label} failed (exit ${code}).${last ? "\n" + last : ""}`));
    });
  });
}

module.exports = {
  prepare,
  // pure, for tests
  mavenPath,
  libraryKey,
  normaliseRepoUrl,
  legacyVersionJson,
  resolveDataValue,
  substituteProcessorArg,
  runsOnClient,
  manifestMainClass,
};
