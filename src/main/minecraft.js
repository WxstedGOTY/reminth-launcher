"use strict";
/**
 * Reminth's own download + launch pipeline. Fully standalone: downloads
 * vanilla Minecraft, the Fabric loader, Fabric API, and ReminthHUD itself into
 * a private %APPDATA%\Reminth\instance folder (see paths.js), then spawns
 * the Java process directly with the signed-in player's real account
 * (see msAuth.js). No official Minecraft Launcher, no Modrinth App, no
 * other third-party launcher involved at any point.
 *
 * This is the same job MultiMC/Prism Launcher/HeliosLauncher do for
 * themselves: resolve version JSON + Fabric profile, download the client
 * jar/libraries/natives/assets, then build a java command line from the
 * merged arguments template.
 */
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const paths = require("./paths");
const config = require("./config");
const java = require("./java");
const loaders = require("./loaders");
const forge = require("./forge");
const { openZip } = require("./zipread");
const { downloadFile, fetchJson, runPool, fileExists, fetchMavenSha1 } = require("./downloader");

const DOWNLOAD_CONCURRENCY = 12;

/**
 * Resolved on first use rather than at the top of the file, deliberately:
 * the unit tests exercise this module's pure functions without installing
 * Electron's whole dependency tree, and a top-level require here makes the
 * entire suite unrunnable. Cached after the first call so it isn't resolved
 * once per native library like it used to be.
 */
let extractZipFn = null;
function extractZip(zipPath, options) {
  if (!extractZipFn) extractZipFn = require("extract-zip");
  return extractZipFn(zipPath, options);
}

/**
 * Full install pipeline for one instance (see instances.js): its Minecraft
 * version, its loader (Fabric or vanilla), and the Java that version needs.
 * Calls onProgress({ stage, current, total }) as it works.
 *
 * Shared across instances, so a second instance on the same version
 * downloads nothing new: versions/, libraries/, assets/ and the Java
 * runtimes. Per instance: the game folder, and the natives folder is per
 * *version* (two versions' natives can't share one folder).
 */
async function ensureInstalled(instance, onProgress) {
  const report = (stage, current, total) => onProgress && onProgress({ stage, current, total });
  const mcVersion = instance.mcVersion;
  const gameDir = instance.gameDir;
  const loader = instance.loader || "vanilla";
  const loaderName = loaders.LOADER_NAMES[loader] || loader;

  report("Resolving Minecraft version", 0, 1);
  const vanilla = await loadVersionJson(mcVersion);

  // The loader's own profile. Fabric and Quilt publish one ready-made; Forge
  // and NeoForge ship theirs inside an installer jar (see forge.js).
  let profile;
  let forgeInstall = null;
  if (loader === "vanilla") {
    profile = vanillaProfile(vanilla);
  } else {
    report(`Resolving ${loaderName}`, 0, 1);
    const loaderVersion = instance.loaderVersion || (await loaders.defaultLoaderVersion(loader, mcVersion));
    if (loader === "fabric" || loader === "quilt") {
      const base = loader === "fabric" ? config.FABRIC_META_URL : loaders.QUILT_META;
      const loaderProfile = await loadLoaderProfile(
        `${base}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`,
        `${loader}-${mcVersion}-${loaderVersion}`
      );
      profile = mergeProfiles(vanilla, loaderProfile);
    } else if (loader === "forge" || loader === "neoforge") {
      const installer = await loaders.installerFor(loader, mcVersion, loaderVersion);
      forgeInstall = await forge.prepare({ installer, assertUrl: assertDownloadUrl, report });
      profile = mergeLoaderProfile(vanilla, forgeInstall.versionJson);
    } else {
      throw new Error(`Reminth doesn't know the ${loader} loader.`);
    }
    profile.loader = loader;
    profile.loaderVersion = loaderVersion;
  }

  report("Checking Java", 0, 1);
  const javaPath = await java.ensureRuntime(vanilla.javaVersion, (p) => report(p.stage, p.current, p.total));

  report("Downloading client jar", 0, 1);
  const vanillaJarPath = containedPath(paths.VERSIONS_DIR, path.join(mcVersion, `${mcVersion}.jar`));
  if (!vanilla.downloads || !vanilla.downloads.client) {
    throw new Error(`Minecraft ${mcVersion} has no client download.`);
  }
  await downloadFile(assertDownloadUrl(vanilla.downloads.client.url), vanillaJarPath, vanilla.downloads.client.sha1);

  report("Downloading libraries", 0, 1);
  const libs = collectLibraries(profile);
  // Processor-only libraries (Forge/NeoForge) are downloaded but never go
  // on the game's classpath.
  const toolLibs = forgeInstall ? collectLibraries({ libraries: forgeInstall.processorLibraries }) : [];
  const seen = new Set();
  const downloads = [...libs, ...toolLibs].filter((l) => !l.generated && !seen.has(l.path) && seen.add(l.path));
  await downloadLibraries(downloads, (current, total) => report("Downloading libraries", current, total));

  let clientJarPath = vanillaJarPath;
  if (forgeInstall) {
    await forgeInstall.finish({ clientJarPath: vanillaJarPath, javaPath, mcVersion });
    // Forge's module-path launch ignores "<version_name>.jar" by name; the
    // vanilla jar has to sit on the classpath under the Forge profile's id
    // or it gets loaded a second time as a module and the game won't start.
    clientJarPath = containedPath(paths.VERSIONS_DIR, path.join(profile.id, `${profile.id}.jar`));
    if (!(await sameSize(vanillaJarPath, clientJarPath))) {
      await fsp.mkdir(path.dirname(clientJarPath), { recursive: true });
      await fsp.copyFile(vanillaJarPath, clientJarPath);
    }
  }

  const nativesDir = containedPath(paths.NATIVES_DIR, mcVersion);
  await extractNatives(libs, nativesDir, (current, total) => report("Extracting natives", current, total));

  report("Downloading assets", 0, 1);
  const assets = await downloadAssets(profile, gameDir, (current, total) => report("Downloading assets", current, total));

  const loggingArg = await prepareLoggingConfig(profile);

  await fsp.mkdir(gameDir, { recursive: true });
  const modsDir = path.join(gameDir, "mods");
  let removed = [];
  let performanceModsInstalled = [];
  // ReminthHUD (+ the Fabric API it needs) goes into instances that have it
  // switched on - the original Reminth instance by default - and only when
  // a HUD build for this exact Minecraft version is bundled. Putting a HUD
  // built for another version in would stop the game from starting.
  const wantsHud = instance.hud === true && (loader === "fabric" || loader === "quilt");
  // The performance pack (Sodium/Lithium/ScalableLux/C2ME/FerriteCore) is
  // on by default for every Fabric/Quilt instance - a player has to
  // explicitly opt out (instance.performanceMods === false), not opt in.
  const wantsPerfMods =
    config.BUNDLE_PERFORMANCE_MODS &&
    instance.performanceMods !== false &&
    (loader === "fabric" || loader === "quilt");
  if (wantsHud || wantsPerfMods) {
    await fsp.mkdir(modsDir, { recursive: true });
    let fabricApiJar = null;
    let hudJar = null;
    if (wantsHud) {
      const hudBuild = await findReminthHudFor(mcVersion);
      if (hudBuild) {
        report("Installing Fabric API", 0, 1);
        fabricApiJar = await downloadFabricApi(modsDir, mcVersion).catch(() => null);
        report("Installing ReminthHUD", 0, 1);
        hudJar = path.basename(hudBuild.file);
        await fsp.writeFile(path.join(modsDir, hudJar), await fsp.readFile(hudBuild.file));
      }
    }
    if (wantsPerfMods) {
      report("Installing performance mods", 0, 1);
      performanceModsInstalled = await downloadPerformanceMods(modsDir, mcVersion, (msg) => report(msg, 0, 1));
    }
    report("Tidying mods folder", 0, 1);
    removed = await tidyManagedMods(modsDir, [fabricApiJar, hudJar, ...performanceModsInstalled], {
      dropHud: wantsHud && !hudJar,
    });
    if (removed.length) report(`Removed ${removed.length} mod(s) Reminth no longer installs`, 0, 1);
  }

  report("Done", 1, 1);
  return {
    profile,
    clientJarPath,
    libraries: libs,
    removedMods: removed,
    performanceModsInstalled,
    javaPath,
    nativesDir,
    assets,
    loggingArg,
    versionType: vanilla.type || "release",
  };
}

async function sameSize(a, b) {
  try {
    const [x, y] = await Promise.all([fsp.stat(a), fsp.stat(b)]);
    return x.size === y.size;
  } catch {
    return false;
  }
}

/** A loader profile JSON, cached on disk so an installed instance still starts offline. */
async function loadLoaderProfile(url, cacheKey) {
  const cacheFile = containedPath(path.join(paths.VERSIONS_DIR, "_loader-profiles"), `${cacheKey.replace(/[^\w.+-]/g, "_")}.json`);
  try {
    const json = await fetchJson(url);
    await fsp.mkdir(path.dirname(cacheFile), { recursive: true });
    await fsp.writeFile(cacheFile, JSON.stringify(json));
    return json;
  } catch (err) {
    try {
      return JSON.parse(await fsp.readFile(cacheFile, "utf8"));
    } catch {
      throw err;
    }
  }
}

/**
 * Pure: does a fabric.mod.json "minecraft" dependency accept this version?
 * Handles what mod authors actually write: "*", "26.2", "~26.2", "1.21.x",
 * ">=1.20 <1.21", "^1.20", and arrays of those (any may match). Snapshots
 * and other odd ids only match an exact entry.
 */
function mcRangeAccepts(range, mcVersion) {
  const mc = String(mcVersion);
  if (Array.isArray(range)) return range.some((r) => mcRangeAccepts(r, mc));
  if (range === undefined || range === null) return true;
  const text = String(range).trim();
  if (!text || text === "*") return true;
  const release = /^\d+(\.\d+)*$/.test(mc);
  const nums = (v) => String(v).split(".").map((n) => parseInt(n, 10) || 0);
  const cmp = (a, b) => {
    const x = nums(a);
    const y = nums(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (x[i] || 0) - (y[i] || 0);
      if (d) return d;
    }
    return 0;
  };
  return text.split(/\s*\|\|\s*/).some((alt) =>
    alt.split(/\s+/).filter(Boolean).every((part) => {
      if (part === mc) return true;
      if (!release) return false;
      let m;
      if ((m = part.match(/^(>=|<=|>|<|=)?(\d+(?:\.\d+)*)$/))) {
        const c = cmp(mc, m[2]);
        switch (m[1]) {
          case ">=": return c >= 0;
          case "<=": return c <= 0;
          case ">": return c > 0;
          case "<": return c < 0;
          default: return c === 0;
        }
      }
      if ((m = part.match(/^~(\d+)\.(\d+)(?:\.(\d+))?$/))) {
        const [maj, min] = [Number(m[1]), Number(m[2])];
        const v = nums(mc);
        return v[0] === maj && v[1] === min && (v[2] || 0) >= Number(m[3] || 0);
      }
      if ((m = part.match(/^\^(\d+)\.(\d+)(?:\.(\d+))?$/))) {
        // Minecraft's "major" is effectively the second number (1.20 -> 1.21 breaks mods).
        const v = nums(mc);
        return v[0] === Number(m[1]) && v[1] === Number(m[2]) && (v[2] || 0) >= Number(m[3] || 0);
      }
      if ((m = part.match(/^(\d+(?:\.\d+)*)\.[xX*]$/))) {
        return mc === m[1] || mc.startsWith(m[1] + ".");
      }
      return false;
    })
  );
}

/** Pure, kept for callers that only need a yes/no for the bundled build list. */
function reminthHudSupports(mcVersion, builds = [{ minecraft: "~26.2" }]) {
  return builds.some((b) => mcRangeAccepts(b.minecraft, mcVersion));
}

/**
 * Every ReminthHUD build bundled in assets/mods, with the Minecraft range
 * its fabric.mod.json declares. One jar per Minecraft version line - a mod
 * is compiled against one version's code, so each port is its own build.
 */
async function bundledReminthHudBuilds() {
  let files;
  try {
    files = await fsp.readdir(paths.REMINTHHUD_ASSET_DIR);
  } catch {
    return [];
  }
  const builds = [];
  for (const f of files.filter((x) => /^reminthhud-.+\.jar$/i.test(x))) {
    const file = path.join(paths.REMINTHHUD_ASSET_DIR, f);
    try {
      // The bundled jars live inside app.asar once packaged. Electron's asar
      // layer supports readFile everywhere but not every fd-based API, so
      // the jar is read whole and opened from a plain copy on disk.
      const buf = await fsp.readFile(file);
      const copy = path.join(paths.ROOT, "cache", "hud", f);
      if (!(await sameSize(file, copy))) {
        await fsp.mkdir(path.dirname(copy), { recursive: true });
        await fsp.writeFile(copy, buf);
      }
      const zip = await openZip(copy);
      try {
        const meta = JSON.parse(String(await zip.read("fabric.mod.json")));
        builds.push({ file, version: meta.version || versionFromJarName(f), minecraft: (meta.depends || {}).minecraft ?? "*" });
      } finally {
        await zip.close();
      }
    } catch {
      // unreadable jar - not offered
    }
  }
  return builds;
}

/** The bundled HUD build for this Minecraft version, or null. Newest build wins. */
async function findReminthHudFor(mcVersion) {
  const matches = (await bundledReminthHudBuilds()).filter((b) => mcRangeAccepts(b.minecraft, mcVersion));
  matches.sort((a, b) => loaders.compareVersions(b.version, a.version));
  return matches[0] || null;
}

/**
 * The version JSON, cached next to the client jar so an instance that was
 * installed once still resolves when Mojang's manifest is unreachable.
 */
async function loadVersionJson(mcVersion) {
  const cacheFile = containedPath(paths.VERSIONS_DIR, path.join(mcVersion, `${mcVersion}.json`));
  try {
    const manifest = await fetchJson(config.MOJANG_VERSION_MANIFEST_URL);
    const entry = manifest.versions.find((v) => v.id === mcVersion);
    if (!entry) throw new Error(`Minecraft ${mcVersion} isn't in Mojang's version list.`);
    const json = await fetchJson(assertDownloadUrl(entry.url));
    await fsp.mkdir(path.dirname(cacheFile), { recursive: true });
    await fsp.writeFile(cacheFile, JSON.stringify(json));
    return json;
  } catch (err) {
    try {
      return JSON.parse(await fsp.readFile(cacheFile, "utf8"));
    } catch {
      throw err;
    }
  }
}

/** The newest stable Fabric loader for a Minecraft version (falls back to the newest of any kind). */
async function latestFabricLoader(mcVersion) {
  const list = await fetchJson(`${config.FABRIC_META_URL}/versions/loader/${encodeURIComponent(mcVersion)}`);
  if (!Array.isArray(list) || !list.length) {
    throw new Error(`Fabric doesn't support Minecraft ${mcVersion}.`);
  }
  const stable = list.find((e) => e.loader && e.loader.stable) || list[0];
  return stable.loader.version;
}

/**
 * Spawns the game for one instance. `account` comes from msAuth.
 * `onCrash({ code, signal, error, logPath })` fires if the process dies
 * within LAUNCH_GRACE_MS - long enough to be well past the main menu, short
 * enough that a crash-on-startup is caught and reported. Game stdout/stderr
 * go to a per-instance file under ROOT/launch-logs.
 *
 * `options.join` = { host, port } makes the game connect to that server as
 * soon as it's loaded (quick play on 1.20+, --server/--port before that).
 */
const LAUNCH_GRACE_MS = 15000;

function launch(installResult, account, onCrash, settings = {}, instance = {}, options = {}) {
  const { profile, clientJarPath, libraries, javaPath, nativesDir, assets, loggingArg, versionType } = installResult;
  const gameDir = instance.gameDir || paths.GAME_DIR;
  fs.mkdirSync(gameDir, { recursive: true });

  const classpath = [
    ...libraries.filter((l) => !l.natives).map((l) => containedPath(paths.LIBRARIES_DIR, l.path)),
    clientJarPath,
  ].join(";"); // Windows classpath separator - Reminth only targets Windows (see osRulesAllow)

  const join = options.join && options.join.host ? options.join : null;
  const joinTarget = join ? `${join.host}${join.port && Number(join.port) !== 25565 ? ":" + join.port : ""}` : "";

  const tokens = {
    "${auth_player_name}": account.username,
    "${version_name}": profile.id,
    "${game_directory}": gameDir,
    "${assets_root}": paths.ASSETS_DIR,
    "${assets_index_name}": profile.assets,
    "${game_assets}": (assets && assets.gameAssetsDir) || paths.ASSETS_DIR,
    "${auth_uuid}": account.uuid,
    "${auth_access_token}": account.minecraftAccessToken,
    "${auth_session}": `token:${account.minecraftAccessToken}:${account.uuid}`,
    "${user_properties}": "{}",
    "${auth_xuid}": account.xuid || "0",
    "${clientid}": config.MS_CLIENT_ID,
    "${user_type}": "msa",
    "${version_type}": versionType || "release",
    "${natives_directory}": nativesDir || paths.NATIVES_DIR,
    "${launcher_name}": "Reminth",
    "${launcher_version}": settings.appVersion || "1.0.0",
    "${classpath}": classpath,
    "${classpath_separator}": ";",
    "${library_directory}": paths.LIBRARIES_DIR,
    "${quickPlayMultiplayer}": joinTarget,
  };
  const sub = (arg) => substituteTokens(arg, tokens);

  // Quick play is a "feature" in Mojang's argument rules (1.20+). Versions
  // without it still understand the older --server/--port flags.
  const modernJoin = Boolean(join) && hasFeature(profile, "is_quick_play_multiplayer");
  const features = { is_quick_play_multiplayer: modernJoin };

  const maxMemoryMb = settings.maxMemoryMb || config.MAX_MEMORY_MB || computeDefaultMaxMemoryMb(os.totalmem());
  // G1GC tuning: the launcher can't touch actual FPS, but a heap sized to
  // the player's real RAM plus G1's low-pause flags cuts GC-driven stutter,
  // which is the one thing under our control here.
  const baseJvm = [
    `-Xmx${maxMemoryMb}M`,
    "-XX:+UseG1GC",
    "-XX:+ParallelRefProcEnabled",
    "-XX:MaxGCPauseMillis=200",
    "-XX:+UnlockExperimentalVMOptions",
    "-XX:G1NewSizePercent=20",
    "-XX:G1ReservePercent=20",
    "-XX:G1HeapRegionSize=32M",
    // Log4Shell. Mojang's patched logging config (loggingArg) covers the
    // affected versions too; this flag is the belt to that pair of braces
    // now that any old version can be launched.
    "-Dlog4j2.formatMsgNoLookups=true",
  ];

  let jvmFromProfile;
  let gameArgs;
  if (profile.arguments && (profile.arguments.jvm || profile.arguments.game)) {
    jvmFromProfile = resolveArguments(profile.arguments.jvm, sub, features);
    gameArgs = resolveArguments(profile.arguments.game, sub, features);
  } else {
    // 1.12.2 and older: one space-separated string, and no JVM template at all.
    jvmFromProfile = [`-Djava.library.path=${tokens["${natives_directory}"]}`, "-cp", classpath];
    gameArgs = String(profile.minecraftArguments || "")
      .split(" ")
      .filter(Boolean)
      .map(sub);
  }

  const jvmArgs = [
    ...baseJvm,
    ...(loggingArg ? [loggingArg] : []),
    ...jvmFromProfile,
    ...splitArgs(settings.extraJvmArgs),
  ];

  if (join && !modernJoin) {
    gameArgs.push("--server", String(join.host), "--port", String(join.port || 25565));
  }
  // Vanilla client flags - Minecraft itself understands these.
  if (settings.fullscreen) {
    gameArgs.push("--fullscreen");
  } else if (settings.gameWidth > 0 && settings.gameHeight > 0) {
    gameArgs.push("--width", String(settings.gameWidth), "--height", String(settings.gameHeight));
  }

  const javawPath = javaPath || path.join(paths.JAVA_DIR, "bin", "javaw.exe");

  // The game's stdout/stderr go to a file, not a pipe: a pipe would need
  // this process to stay around draining it.
  const logDir = path.join(paths.ROOT, "launch-logs");
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `${instance.id || "reminth"}.txt`);
  const logFd = fs.openSync(logPath, "w");

  const child = spawn(javawPath, [...jvmArgs, profile.mainClass, ...gameArgs], {
    cwd: gameDir,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });

  const startedAt = Date.now();
  // Node can emit 'exit' after 'error' for the same child; closing an
  // already-closed fd throws EBADF from inside a listener. Close once.
  let logClosed = false;
  const closeLog = () => {
    if (logClosed) return;
    logClosed = true;
    try {
      fs.closeSync(logFd);
    } catch {
      // already gone
    }
  };
  child.on("error", (err) => {
    closeLog();
    onCrash && onCrash({ code: null, signal: null, error: err.message, logPath });
  });
  child.on("exit", (code, signal) => {
    closeLog();
    if (Date.now() - startedAt < LAUNCH_GRACE_MS && code !== 0) {
      onCrash && onCrash({ code, signal, error: null, logPath });
    }
  });

  child.unref();
  return child;
}

/** Pure: does any game-argument rule in this profile gate on `feature`? */
function hasFeature(profile, feature) {
  const game = (profile.arguments && profile.arguments.game) || [];
  return game.some(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      Array.isArray(entry.rules) &&
      entry.rules.some((r) => r && r.features && Object.prototype.hasOwnProperty.call(r.features, feature))
  );
}

/**
 * Mojang ships a log4j config per version (for the Log4Shell-affected ones
 * it's the patched one). Downloading it and passing it the way the official
 * launcher does keeps logs/latest.log in the format every version expects.
 */
async function prepareLoggingConfig(profile) {
  const client = profile.logging && profile.logging.client;
  if (!client || !client.file || !client.file.url || typeof client.argument !== "string") return null;
  try {
    const id = String(client.file.id || "client.xml");
    if (!/^[\w.-]{1,80}$/.test(id)) return null;
    const dest = containedPath(path.join(paths.ASSETS_DIR, "log_configs"), id);
    await downloadFile(assertDownloadUrl(client.file.url), dest, client.file.sha1);
    return client.argument.replace("${path}", dest);
  } catch {
    return null; // cosmetic - the game still logs with its built-in default
  }
}

/**
 * Pure: splits a user-typed JVM argument string into argv entries, keeping
 * quoted runs together so a path with spaces survives
 * (-Dsomething="C:\Program Files\x" stays one argument).
 */
function splitArgs(text) {
  if (typeof text !== "string" || !text.trim()) return [];
  const out = [];
  let current = "";
  let quote = null;
  let quoted = false; // so an explicitly empty "" still counts as an argument

  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      quoted = true;
    } else if (/\s/.test(ch)) {
      if (current || quoted) {
        out.push(current);
        current = "";
        quoted = false;
      }
    } else {
      current += ch;
    }
  }
  if (current || quoted) out.push(current);
  return out;
}

/**
 * Pure: the default -Xmx, in MB. Half of total RAM, clamped to [2GB, 6GB] -
 * never below the official launcher's 2GB, and capped so a big machine
 * doesn't hand the JVM a heap it will only spend longer collecting. The
 * Settings slider overrides it.
 */
function computeDefaultMaxMemoryMb(totalMemBytes) {
  const halfMb = Math.floor(totalMemBytes / 1024 ** 2 / 2);
  return Math.min(6 * 1024, Math.max(2 * 1024, halfMb));
}

/**
 * Pure: vanilla + a Fabric/Quilt loader profile. Libraries the loader ships
 * its own version of (asm, most often) replace vanilla's copy instead of
 * both landing on the classpath.
 */
function mergeProfiles(vanilla, fabric) {
  const loaderKeys = new Set((fabric.libraries || []).map((l) => forge.libraryKey(l.name)));
  return {
    id: "reminth-" + (vanilla.id || config.MINECRAFT_VERSION),
    mainClass: extractMainClass(fabric.mainClass),
    inheritsFrom: vanilla.id,
    arguments: {
      game: [...(vanilla.arguments?.game || []), ...(fabric.arguments?.game || [])],
      jvm: [...(vanilla.arguments?.jvm || []), ...(fabric.arguments?.jvm || [])],
    },
    minecraftArguments: vanilla.arguments ? null : vanilla.minecraftArguments || null,
    libraries: [
      ...(vanilla.libraries || []).filter((l) => !l.name || !loaderKeys.has(forge.libraryKey(l.name))),
      ...(fabric.libraries || []),
    ],
    assetIndex: vanilla.assetIndex,
    assets: vanilla.assets,
    logging: vanilla.logging,
    javaVersion: vanilla.javaVersion,
  };
}

/**
 * Pure: vanilla + a Forge/NeoForge version.json, the way the official
 * launcher resolves "inheritsFrom": the loader's libraries first (and
 * replacing vanilla's copy of the same library - Forge 1.12.2 swaps log4j
 * 2.8 for 2.15, for example), its arguments appended to vanilla's, and a
 * legacy "minecraftArguments" string replacing vanilla's outright.
 */
function mergeLoaderProfile(vanilla, loaderJson) {
  const loaderLibs = loaderJson.libraries || [];
  const loaderKeys = new Set(loaderLibs.map((l) => forge.libraryKey(l.name)));
  const legacy = typeof loaderJson.minecraftArguments === "string" && loaderJson.minecraftArguments;
  return {
    id: String(loaderJson.id || `${vanilla.id}-loader`),
    mainClass: extractMainClass(loaderJson.mainClass),
    inheritsFrom: vanilla.id,
    arguments: legacy
      ? null
      : {
          game: [...(vanilla.arguments?.game || []), ...(loaderJson.arguments?.game || [])],
          jvm: [...(vanilla.arguments?.jvm || []), ...(loaderJson.arguments?.jvm || [])],
        },
    minecraftArguments: legacy || null,
    libraries: [...loaderLibs, ...(vanilla.libraries || []).filter((l) => !l.name || !loaderKeys.has(forge.libraryKey(l.name)))],
    assetIndex: vanilla.assetIndex,
    assets: vanilla.assets,
    logging: vanilla.logging,
    javaVersion: vanilla.javaVersion,
  };
}

/** Pure: a plain vanilla version as a launch profile - both argument styles carried through. */
function vanillaProfile(vanilla) {
  return {
    id: vanilla.id,
    mainClass: vanilla.mainClass,
    arguments: vanilla.arguments || null,
    minecraftArguments: vanilla.minecraftArguments || null,
    libraries: vanilla.libraries || [],
    assetIndex: vanilla.assetIndex,
    assets: vanilla.assets,
    logging: vanilla.logging,
    javaVersion: vanilla.javaVersion,
  };
}

/**
 * Pure: Fabric's loader profile JSON has shipped "mainClass" as a plain
 * string historically, but newer profile builds return
 * { client: "...", server: "..." } instead (Reminth only ever launches the
 * client). Passing that object straight to child_process.spawn() as an arg
 * silently stringifies it to the literal text "[object Object]" - Java then
 * fails with "Could not find or load main class [object Object]", a launch
 * crash with zero indication it was ever a JS type mismatch rather than a
 * real missing class. Handle both shapes so a future Fabric loader release
 * doesn't quietly break launch again.
 */
function extractMainClass(mainClass) {
  if (typeof mainClass === "string") return mainClass;
  if (mainClass && typeof mainClass === "object" && typeof mainClass.client === "string") {
    return mainClass.client;
  }
  throw new Error(
    `Fabric profile's mainClass is in an unexpected shape: ${JSON.stringify(mainClass)}`
  );
}

/** Pure: does a library/argument rule's "os" block describe this machine (64-bit Windows)? */
function osMatchesThisMachine(os) {
  if (!os) return true;
  if (os.name && os.name !== "windows") return false;
  // Mojang tags 32-bit and ARM-only natives with an arch; this is x64.
  if (os.arch && !/^(x86_64|x64|amd64)$/i.test(os.arch)) return false;
  return true;
}

function osRulesAllow(rules) {
  if (!rules) return true;
  let allowed = false;
  for (const rule of rules) {
    if (osMatchesThisMachine(rule.os)) allowed = rule.action === "allow";
  }
  return allowed;
}

// Mojang gates some game arguments behind "features" (demo accounts, custom
// resolution, quick play...). Only the ones a caller explicitly turns on
// are enabled - by default none are, so --demo and friends never appear.
function argRuleConditionMatches(rule, features = {}) {
  const osOk = osMatchesThisMachine(rule.os);
  const featuresOk =
    !rule.features ||
    Object.entries(rule.features).every(([key, want]) => Boolean(features[key]) === want);
  return osOk && featuresOk;
}

function argRuleAllows(rules, features = {}) {
  if (!rules) return true;
  let allowed = false;
  for (const rule of rules) {
    if (argRuleConditionMatches(rule, features)) allowed = rule.action === "allow";
  }
  return allowed;
}

/**
 * Pure: Mojang's version JSON "arguments.jvm"/"arguments.game" arrays are
 * NOT plain string arrays - each entry is either a plain string, or a
 * conditional object like { rules: [...], value: "..." | ["...", "..."] }
 * gating an OS-specific or opt-in-feature-specific flag (macOS's
 * -XstartOnFirstThread, --demo, --width/--height, --quickPlay*, etc).
 * These used to be concatenated completely unresolved, so a conditional-
 * object entry got passed straight through into child_process.spawn()'s
 * args array, where Node silently stringifies any non-string arg to the
 * literal text "[object Object]". Since that landed among the JVM args -
 * which come right before the actual main class name on the command line -
 * and doesn't start with "-", javaw.exe treated THAT as the main class to
 * load: "Could not find or load main class [object Object]" (the real
 * mainClass string was still further down the array, now misread as a game
 * argument instead). This resolves every entry to zero or more plain
 * strings, with `sub` applied to each, before any of it reaches spawn().
 */
/**
 * Pure: expands Mojang's ${placeholder} tokens anywhere inside an argument.
 *
 * Bug fixed here: this used to be an exact-match lookup (tokens[arg] ?? arg),
 * which only substituted arguments that were *entirely* one placeholder.
 * Mojang's template also embeds placeholders inside larger strings - most
 * importantly "-Djava.library.path=${natives_directory}" - so those reached
 * Java verbatim and the game ended up creating and loading its LWJGL natives
 * from a literal folder named "${natives_directory}" inside the game
 * directory. Unknown placeholders are left alone rather than blanked, so a
 * future Mojang token can't silently turn into an empty path.
 */
function substituteTokens(arg, tokens) {
  if (typeof arg !== "string") return arg;
  return arg.replace(/\$\{[^}]+\}/g, (match) =>
    tokens[match] !== undefined ? tokens[match] : match
  );
}

function resolveArguments(rawArgs, sub, features = {}) {
  const out = [];
  for (const entry of rawArgs || []) {
    if (typeof entry === "string") {
      out.push(sub(entry));
      continue;
    }
    if (entry && typeof entry === "object" && argRuleAllows(entry.rules, features)) {
      const values = Array.isArray(entry.value) ? entry.value : [entry.value];
      for (const v of values) out.push(sub(v));
    }
    // Disallowed conditional entries (non-windows flags, or features Reminth
    // never enables) are intentionally dropped here, not stringified.
  }
  return out;
}

function collectLibraries(profile) {
  const libs = [];
  for (const lib of profile.libraries) {
    if (!osRulesAllow(lib.rules)) continue;
    if (lib.downloads && lib.downloads.artifact) {
      const a = lib.downloads.artifact;
      libs.push({
        path: a.path || (lib.name ? forge.mavenPath(lib.name) : ""),
        url: a.url || null,
        sha1: a.sha1 || null,
        natives: false,
        // No URL: the jar comes out of a loader installer or is produced by
        // one of its processors - nothing to download (see forge.js).
        generated: !a.url,
      });
    }
    const classifierKey = lib.natives && lib.natives.windows;
    if (classifierKey && lib.downloads && lib.downloads.classifiers) {
      const c = lib.downloads.classifiers[classifierKey.replace("${arch}", "64")];
      if (c) {
        libs.push({ path: c.path, url: c.url, sha1: c.sha1, natives: true, extract: lib.extract });
      }
    }
    if (!lib.downloads && lib.name && !lib.natives) {
      // Maven-coordinate library with no "downloads" block: Fabric/Quilt
      // profiles (with a repo "url"), or old profiles that meant Mojang's.
      const mavenPath = mavenCoordToPath(lib.name);
      libs.push({
        path: mavenPath,
        url: forge.normaliseRepoUrl(lib.url || "https://libraries.minecraft.net/") + mavenPath,
        sha1: lib.sha1 || null,
        natives: false,
      });
    }
  }
  return libs;
}

/**
 * Every library path and every download URL below is read out of a version
 * manifest fetched over the network - Mojang's or Fabric's. That makes them
 * attacker-controlled the moment one of those hosts is spoofed or
 * compromised, and a library path of "../../../Start Menu/Programs/Startup/x"
 * would otherwise be written exactly where it asked to go. Resolve the path
 * and refuse anything that climbs out of the directory it belongs in.
 */
function containedPath(baseDir, relative) {
  const base = path.resolve(baseDir);
  const full = path.resolve(base, String(relative || ""));
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error(`Refused a manifest path that escapes ${base}: ${relative}`);
  }
  return full;
}

/**
 * The sha1 for a library comes out of the same manifest as its URL, so a
 * hostile manifest supplies both and the hash check alone proves nothing.
 * Pin the download to the domains these files legitimately come from -
 * matched on suffix, because Mojang does move files between CDN hostnames
 * (piston-data, libraries.minecraft.net, resources.download...) and pinning
 * exact hosts would break installs the next time they do.
 */
const ALLOWED_DOWNLOAD_DOMAINS = [
  /(^|\.)mojang\.com$/i,
  /(^|\.)minecraft\.net$/i,
  /(^|\.)fabricmc\.net$/i,
  /(^|\.)quiltmc\.org$/i,
  /(^|\.)minecraftforge\.net$/i,
  /(^|\.)neoforged\.net$/i,
];

function assertDownloadUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    throw new Error(`Refused a malformed download URL from the version manifest: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Refused a non-HTTPS download: ${parsed.href}`);
  }
  if (!ALLOWED_DOWNLOAD_DOMAINS.some((re) => re.test(parsed.hostname))) {
    throw new Error(`Refused a download from an unexpected host: ${parsed.hostname}`);
  }
  return parsed.href;
}

function mavenCoordToPath(coord) {
  return forge.mavenPath(coord);
}

async function downloadLibraries(libs, onProgress) {
  let done = 0;
  await runPool(libs, DOWNLOAD_CONCURRENCY, async (lib) => {
    const dest = containedPath(paths.LIBRARIES_DIR, lib.path);
    const url = assertDownloadUrl(lib.url);
    // Mojang's own libraries carry a sha1 straight from the version JSON.
    // Fabric-style maven-coordinate libraries (see collectLibraries) don't -
    // fetch the standard Maven ".sha1" sidecar instead of downloading
    // unverified just because Mojang's manifest didn't hand us a hash.
    const sha1 = lib.sha1 || (await fetchMavenSha1(url));
    await downloadFile(url, dest, sha1);
    done++;
    onProgress(done, libs.length);
  });
}

async function extractNatives(libs, nativesDir, onProgress) {
  const nativeLibs = libs.filter((l) => l.natives);
  await fsp.mkdir(nativesDir, { recursive: true });
  let done = 0;
  for (const lib of nativeLibs) {
    const jarPath = containedPath(paths.LIBRARIES_DIR, lib.path);
    await extractZip(jarPath, { dir: nativesDir });
    const excludes = (lib.extract && lib.extract.exclude) || ["META-INF/"];
    await removeExcluded(nativesDir, excludes);
    done++;
    onProgress(done, nativeLibs.length);
  }
}

async function removeExcluded(dir, excludes) {
  for (const pattern of excludes) {
    // This is a recursive delete driven by a list out of the version
    // manifest, so an exclude of "../../../Documents" would wipe a folder
    // that has nothing to do with natives. Skip anything that doesn't
    // resolve inside the natives dir rather than failing the whole install:
    // these excludes are housekeeping (META-INF/), not load-bearing.
    let target;
    try {
      target = containedPath(dir, String(pattern).replace(/\/$/, ""));
    } catch {
      continue;
    }
    await fsp.rm(target, { recursive: true, force: true });
  }
}

/**
 * Downloads the asset objects for a version. Two legacy layouts are also
 * handled, because any old version can be picked now:
 *  - "virtual" indexes (1.6-1.7.2): objects are also copied by name into
 *    assets/virtual/<index>/, which that game reads directly.
 *  - "map_to_resources" (pre-1.6, alphas and betas): copied into the
 *    instance's own resources/ folder.
 * Returns { gameAssetsDir } - what ${game_assets} resolves to at launch.
 */
async function downloadAssets(profile, gameDir, onProgress) {
  const indexDir = path.join(paths.ASSETS_DIR, "indexes");
  await fsp.mkdir(indexDir, { recursive: true });
  if (!/^[\w.-]{1,64}$/.test(String(profile.assets))) throw new Error("Unexpected asset index name.");
  const index = await fetchJson(assertDownloadUrl(profile.assetIndex.url));
  await fsp.writeFile(path.join(indexDir, `${profile.assets}.json`), JSON.stringify(index));

  const entries = Object.entries(index.objects || {});
  let done = 0;
  await runPool(entries, DOWNLOAD_CONCURRENCY, async ([, obj]) => {
    const hash = String(obj.hash || "");
    if (!/^[0-9a-f]{40}$/.test(hash)) throw new Error("Asset index carried a malformed hash.");
    const dest = path.join(paths.ASSETS_DIR, "objects", hash.slice(0, 2), hash);
    if (!(await fileExists(dest))) {
      const url = `https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`;
      await downloadFile(url, dest, hash);
    }
    done++;
    if (done % 25 === 0 || done === entries.length) onProgress(done, entries.length);
  });

  let gameAssetsDir = paths.ASSETS_DIR;
  const legacyTarget = index.map_to_resources
    ? path.join(gameDir, "resources")
    : index.virtual
    ? path.join(paths.ASSETS_DIR, "virtual", profile.assets)
    : null;
  if (legacyTarget) {
    gameAssetsDir = legacyTarget;
    for (const [name, obj] of entries) {
      const dest = containedPath(legacyTarget, name); // names come from the index - keep them inside
      if (await fileExists(dest)) continue;
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.copyFile(path.join(paths.ASSETS_DIR, "objects", obj.hash.slice(0, 2), obj.hash), dest);
    }
  }
  return { gameAssetsDir };
}

/**
 * Downloads the latest Fabric API build for MINECRAFT_VERSION straight
 * from Fabric's own Maven (maven.fabricmc.net) - the same official
 * channel Fabric loader itself comes from. Fabric API version strings
 * look like "<api-version>+<mc-version>" (e.g. "0.160.0+26.2").
 */
async function downloadFabricApi(modsDir, mcVersion = config.MINECRAFT_VERSION) {
  const metadataUrl = `${config.FABRIC_MAVEN_URL}/net/fabricmc/fabric-api/fabric-api/maven-metadata.xml`;
  const res = await fetch(metadataUrl);
  if (!res.ok) throw new Error(`Failed to fetch Fabric API metadata: ${res.status}`);
  const xml = await res.text();

  const version = latestMatchingMavenVersion(xml, mcVersion);
  if (!version) {
    throw new Error(`No Fabric API build published for Minecraft ${mcVersion} on Fabric's Maven yet.`);
  }
  const jarUrl = `${config.FABRIC_MAVEN_URL}/net/fabricmc/fabric-api/fabric-api/${version}/fabric-api-${version}.jar`;
  const sha1 = await fetchMavenSha1(jarUrl);
  const filename = `fabric-api-${version}.jar`;
  await downloadFile(jarUrl, path.join(modsDir, filename), sha1);
  return filename;
}

/**
 * Removes only the jars Reminth itself put in the mods folder and shouldn't
 * have (or no longer should): superseded copies of the two mods Reminth
 * manages, and the performance mods older builds auto-installed.
 *
 * Anything else the player dropped in here is left strictly alone - that's
 * their mods folder, not ours. `keep` is the set of filenames just installed.
 */
async function tidyManagedMods(modsDir, keep, { dropHud = false } = {}) {
  const keepSet = new Set(keep.filter(Boolean));
  let files;
  try {
    files = await fsp.readdir(modsDir);
  } catch {
    return [];
  }

  const removed = [];
  for (const file of files) {
    if (!file.toLowerCase().endsWith(".jar") || keepSet.has(file)) continue;

    // An older/duplicate copy of a mod Reminth manages. Leaving these behind
    // is what put two Fabric API versions in the folder at once, which Fabric
    // loader complains about and resolves unpredictably.
    // (When the kept list has no Fabric API jar - it couldn't be fetched this
    // time - the one already on disk is left alone rather than deleted.)
    const lower = file.toLowerCase();
    const isStaleManaged =
      (lower.startsWith("fabric-api-") && keep[0]) ||
      (lower.startsWith("reminthhud-") && (keep[1] || dropHud));
    // A mod an older Reminth build installed without asking (the bundled
    // performance pack), or the pre-rename ReminthHUD jar - which would
    // otherwise load alongside the current one as a duplicate mod id.
    const isUnwantedLegacy = LEGACY_AUTO_INSTALLED.some((re) => re.test(file));

    if (!isStaleManaged && !isUnwantedLegacy) continue;
    try {
      await fsp.rm(path.join(modsDir, file), { force: true });
      removed.push(file);
    } catch {
      // A jar that's locked (game still running) just stays - not fatal.
    }
  }
  return removed;
}

const MANAGED_MOD_PREFIXES = ["fabric-api-", "reminthhud-"];
const LEGACY_AUTO_INSTALLED = [
  /^sodium[-_.]/i,
  /^lithium[-_.]/i,
  /^scalablelux[-_.]/i,
  /^starlight[-_.]/i,
  /^c2me[-_.]/i,
  /^ferritecore[-_.]/i,
  /^wxhud[-_.]/i, // ReminthHUD's pre-rename filename
];

/** Pure: scans a maven-metadata.xml body for <version> entries ending in "+mcVersion". */
function latestMatchingMavenVersion(xml, mcVersion) {
  const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
  const matching = versions.filter((v) => v.endsWith(`+${mcVersion}`));
  return matching.length ? matching[matching.length - 1] : null;
}

/**
 * Best-effort install of open-source Fabric performance mods (see
 * config.PERFORMANCE_MODS) straight from each project's own GitHub
 * Releases - never Modrinth/CurseForge, Reminth doesn't depend on either.
 * A missing build for mcVersion, or any network/parse failure, is logged
 * via onProgress and skipped rather than failing the whole install: Fabric
 * API and ReminthHUD are required, these are a bonus. Returns the filenames
 * actually written, for tidyManagedMods' keep list - not the labels, which
 * wouldn't match anything on disk.
 */
async function downloadPerformanceMods(modsDir, mcVersion, onProgress) {
  if (!config.BUNDLE_PERFORMANCE_MODS) return [];
  const installed = [];
  // These messages used to only ever exist as a flash of text in the
  // install progress bar - gone the moment the next stage message replaced
  // it, with no way to go back and check "did Sodium actually install, and
  // if not, why" after the fact. Written next to the mods it's about so
  // it's easy to find without knowing this exists.
  const logLines = [`=== performance mods install, ${new Date().toISOString()}, mcVersion=${mcVersion} ===`];
  for (const mod of config.PERFORMANCE_MODS || []) {
    try {
      const found = await fetchLatestGithubAssetForVersion(mod.owner, mod.repo, mcVersion);
      if (!found) {
        const msg = `No ${mod.label} build for ${mcVersion} yet - skipped`;
        onProgress && onProgress(msg);
        logLines.push(msg);
        continue;
      }
      // GitHub's Releases API doesn't publish a per-asset checksum the way
      // Maven does, so (like the bundled-Java download in java.js) this
      // relies on TLS + the official upstream repo rather than a hash pin.
      await downloadFile(found.url, path.join(modsDir, found.filename), null);
      onProgress && onProgress(`Installed ${mod.label}`);
      logLines.push(`Installed ${mod.label}: ${found.filename} (release ${found.version})`);
      installed.push(found.filename);
    } catch (err) {
      const msg = `${mod.label} failed to install (${err.message}) - skipped`;
      onProgress && onProgress(msg);
      logLines.push(msg);
    }
  }
  try {
    await fsp.writeFile(path.join(path.dirname(modsDir), "reminth-performance-mods.log"), logLines.join("\n") + "\n");
  } catch {
    // Best-effort - a missing log is annoying to debug, not worth failing the install over.
  }
  return installed;
}

/**
 * Fetches the release list for owner/repo and returns the first one matching
 * mcVersion. GitHub's unauthenticated REST API is capped at 60 requests/hour
 * per IP - with 3 performance mods checked per install, that's only ~20
 * installs/hour before every player behind the same IP (a school, office, or
 * NAT'd household) starts getting rate-limited. Surface that specifically
 * (rather than the generic "no build published" message) so it's clear to
 * whoever's debugging a support report that it's transient and IP-wide, not
 * a real missing build - see downloadPerformanceMods's catch.
 */
async function fetchLatestGithubAssetForVersion(owner, repo, mcVersion) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=30`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
    throw new Error(
      "GitHub API rate limit hit (shared by everyone on this network right now) - try again in a bit"
    );
  }
  if (!res.ok) return null;
  const releases = await res.json();
  for (const release of releases) {
    if (!releaseMatchesVersion(release, mcVersion)) continue;
    const asset = pickJarAsset(release.assets);
    if (asset) return { version: release.tag_name, url: asset.browser_download_url, filename: asset.name };
  }
  return null;
}

/**
 * Pure: does this GitHub release reference mcVersion? Checked in three
 * places, in order of how much they should be trusted: the tag (e.g.
 * "mc26.1.2-0.9.2" contains "26.1.2"), the release name/title, and - some
 * projects (ScalableLux confirmed: tags and names are bare mod versions
 * like "0.2.1", the Minecraft version only ever appears in the changelog
 * text, e.g. "ScalableLux 0.2.1 for Minecraft 26.2 is released") - the
 * release body. The body check is last and loosest on purpose: it's prose,
 * not a version field, so it only kicks in once the two structured fields
 * have already said no.
 */
function releaseMatchesVersion(release, mcVersion) {
  const tag = release.tag_name || "";
  const name = release.name || "";
  const body = release.body || "";
  return tag.includes(mcVersion) || name.includes(mcVersion) || body.includes(mcVersion);
}

/**
 * Pure: picks the real mod jar out of a release's assets. A release commonly
 * ships several jars - Lithium 0.25.3+mc26.2, for example, attaches
 * lithium-0.25.3+mc26.2-api.jar (3KB, a slim API stub), lithium-fabric-...jar
 * (913KB, the actual mod) and lithium-neoforge-...jar (a different loader
 * entirely). Grabbing the first ".jar" match (the original version of this
 * function) picked the 3KB stub here - a silently-broken "install" that
 * would report success while doing nothing in-game. Filter out sources/
 * javadoc/other-loader builds, prefer a name that says "fabric", and among
 * whatever's left take the largest file - the slim/API jar is reliably far
 * smaller than the real mod.
 */
function pickJarAsset(assets) {
  const candidates = (assets || []).filter(
    (a) => a.name.endsWith(".jar") && !/sources|javadoc|neoforge|forge|quilt/i.test(a.name)
  );
  if (!candidates.length) return null;
  const fabricNamed = candidates.filter((a) => /fabric/i.test(a.name));
  const pool = fabricNamed.length ? fabricNamed : candidates;
  return pool.reduce((biggest, a) => (a.size > biggest.size ? a : biggest), pool[0]);
}

function versionFromJarName(filename) {
  const match = filename.match(/^reminthhud-(.+)\.jar$/);
  return match ? match[1] : "unknown";
}

module.exports = {
  ensureInstalled,
  launch,
  latestFabricLoader,
  downloadFabricApi,
  vanillaProfile,
  hasFeature,
  reminthHudSupports,
  mcRangeAccepts,
  bundledReminthHudBuilds,
  findReminthHudFor,
  mergeLoaderProfile,
  osMatchesThisMachine,
  // exported for unit testing (see test/minecraft.test.js) - pure, no I/O
  mergeProfiles,
  extractMainClass,
  osRulesAllow,
  argRuleAllows,
  resolveArguments,
  collectLibraries,
  mavenCoordToPath,
  latestMatchingMavenVersion,
  versionFromJarName,
  computeDefaultMaxMemoryMb,
  splitArgs,
  substituteTokens,
  releaseMatchesVersion,
  pickJarAsset,
  containedPath,
  assertDownloadUrl,
};
