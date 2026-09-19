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
const { downloadFile, fetchJson, runPool, fileExists, fetchMavenSha1 } = require("./downloader");

const DOWNLOAD_CONCURRENCY = 12;

/** Full install pipeline. Calls onProgress({ stage, current, total }) as it works. */
async function ensureInstalled(onProgress) {
  const report = (stage, current, total) => onProgress && onProgress({ stage, current, total });

  report("Checking Java", 0, 1);
  await java.ensureJava((p) => report(p.stage, p.current, p.total));

  report("Resolving Minecraft version", 0, 1);
  const manifest = await fetchJson(config.MOJANG_VERSION_MANIFEST_URL);
  const versionEntry = manifest.versions.find((v) => v.id === config.MINECRAFT_VERSION);
  if (!versionEntry) {
    throw new Error(
      `Minecraft ${config.MINECRAFT_VERSION} isn't in Mojang's version manifest yet/anymore.`
    );
  }
  const vanilla = await fetchJson(versionEntry.url);

  report("Resolving Fabric loader", 0, 1);
  const fabricProfile = await fetchJson(
    `${config.FABRIC_META_URL}/versions/loader/${config.MINECRAFT_VERSION}/${config.FABRIC_LOADER_VERSION}/profile/json`
  );
  const profile = mergeProfiles(vanilla, fabricProfile);

  report("Downloading client jar", 0, 1);
  const clientJarPath = path.join(
    paths.VERSIONS_DIR,
    config.MINECRAFT_VERSION,
    `${config.MINECRAFT_VERSION}.jar`
  );
  await downloadFile(vanilla.downloads.client.url, clientJarPath, vanilla.downloads.client.sha1);

  report("Downloading libraries", 0, 1);
  const libs = collectLibraries(profile);
  await downloadLibraries(libs, (current, total) => report("Downloading libraries", current, total));
  await extractNatives(libs, (current, total) => report("Extracting natives", current, total));

  report("Downloading assets", 0, 1);
  await downloadAssets(profile, (current, total) => report("Downloading assets", current, total));

  report("Installing Fabric API", 0, 1);
  await fsp.mkdir(paths.MODS_DIR, { recursive: true });
  await downloadFabricApi(paths.MODS_DIR);

  report("Installing ReminthHUD", 0, 1);
  await installReminthHud(paths.MODS_DIR);

  report("Installing performance mods", 0, 1);
  const perfMods = await downloadPerformanceMods(paths.MODS_DIR, (msg) =>
    report(msg, 0, 1)
  );

  report("Done", 1, 1);
  return { profile, clientJarPath, libraries: libs, perfMods };
}

/**
 * Spawns the game. `account` comes from msAuth.signIn()/refreshSession().
 * `onCrash({ code, signal, error, logPath })` is called if the game process
 * dies within the first LAUNCH_GRACE_MS of starting - long enough for a real
 * play session to be well past main-menu load, short enough that a crash-on-
 * startup (bad classpath, missing native, corrupt jar, etc.) gets caught and
 * reported instead of silently discarded. Game stdout/stderr are written to
 * latest_log.txt in Reminth's own root so a real in-game crash later on is
 * still diagnosable even though the launcher already reported success.
 */
const LAUNCH_GRACE_MS = 15000;

function launch(installResult, account, onCrash) {
  const { profile, clientJarPath, libraries } = installResult;

  const classpath = [
    ...libraries.filter((l) => !l.natives).map((l) => path.join(paths.LIBRARIES_DIR, l.path)),
    clientJarPath,
  ].join(";"); // Windows classpath separator - Reminth only targets Windows (see osRulesAllow)

  const tokens = {
    "${auth_player_name}": account.username,
    "${version_name}": profile.id,
    "${game_directory}": paths.GAME_DIR,
    "${assets_root}": paths.ASSETS_DIR,
    "${assets_index_name}": profile.assets,
    "${auth_uuid}": account.uuid,
    "${auth_access_token}": account.minecraftAccessToken,
    "${auth_xuid}": account.xuid || "0",
    "${clientid}": config.MS_CLIENT_ID,
    "${user_type}": "msa",
    "${version_type}": "release",
    "${natives_directory}": paths.NATIVES_DIR,
    "${launcher_name}": "Reminth",
    "${launcher_version}": "1.0.0-dev",
    "${classpath}": classpath,
  };
  const sub = (arg) => tokens[arg] !== undefined ? tokens[arg] : arg;

  const maxMemoryMb = config.MAX_MEMORY_MB || computeDefaultMaxMemoryMb(os.totalmem());
  // G1GC tuning: the launcher can't touch actual FPS (that's GPU/CPU and the
  // game's own renderer), but a heap sized to the player's real RAM plus
  // G1's low-pause-time flags meaningfully cuts GC-driven stutter/freezes,
  // which is the one thing under our control here. Client-appropriate
  // subset of the flags most guides recommend (the more aggressive
  // Aikar's-flags set is tuned for dedicated servers, not a single-player
  // client JVM).
  const jvmArgs = [
    `-Xmx${maxMemoryMb}M`,
    "-XX:+UseG1GC",
    "-XX:+ParallelRefProcEnabled",
    "-XX:MaxGCPauseMillis=200",
    "-XX:+UnlockExperimentalVMOptions",
    "-XX:G1NewSizePercent=20",
    "-XX:G1ReservePercent=20",
    "-XX:G1HeapRegionSize=32M",
    ...resolveArguments(profile.arguments.jvm, sub),
  ];
  const gameArgs = resolveArguments(profile.arguments.game, sub);
  const javawPath = path.join(paths.JAVA_DIR, "bin", "javaw.exe");

  // Write the game's own stdout/stderr to a log file instead of discarding
  // it. File descriptors (not pipes) so the child can keep writing after
  // this launcher process unref()'s it - a pipe would need the parent to
  // stay around draining it.
  const logPath = path.join(paths.ROOT, "latest_log.txt");
  fs.mkdirSync(paths.ROOT, { recursive: true });
  const logFd = fs.openSync(logPath, "w");

  const child = spawn(javawPath, [...jvmArgs, profile.mainClass, ...gameArgs], {
    cwd: paths.GAME_DIR,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });

  const startedAt = Date.now();
  child.on("error", (err) => {
    // spawn() itself failed (e.g. javaw.exe missing/corrupt) - this fires
    // async, so without this listener Node treats it as an unhandled
    // 'error' event.
    fs.closeSync(logFd);
    onCrash && onCrash({ code: null, signal: null, error: err.message, logPath });
  });
  child.on("exit", (code, signal) => {
    fs.closeSync(logFd);
    if (Date.now() - startedAt < LAUNCH_GRACE_MS && code !== 0) {
      onCrash && onCrash({ code, signal, error: null, logPath });
    }
  });

  child.unref();
  return child;
}

/**
 * Pure: picks a sane -Xmx from the machine's total RAM instead of one
 * hardcoded value that's too small for a 32GB gaming rig and too big for
 * an 8GB laptop. Half of total RAM, clamped to [2, 6] GB.
 */
function computeDefaultMaxMemoryMb(totalMemBytes) {
  const totalGb = totalMemBytes / 1024 ** 3;
  const gb = Math.max(2, Math.min(6, Math.floor(totalGb / 2)));
  return gb * 1024;
}

function mergeProfiles(vanilla, fabric) {
  return {
    id: "reminth-" + config.MINECRAFT_VERSION,
    mainClass: extractMainClass(fabric.mainClass),
    inheritsFrom: vanilla.id,
    arguments: {
      game: [...(vanilla.arguments?.game || []), ...(fabric.arguments?.game || [])],
      jvm: [...(vanilla.arguments?.jvm || []), ...(fabric.arguments?.jvm || [])],
    },
    libraries: [...(vanilla.libraries || []), ...(fabric.libraries || [])],
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

function osRulesAllow(rules) {
  if (!rules) return true;
  let allowed = false;
  for (const rule of rules) {
    const osMatches = !rule.os || rule.os.name === "windows";
    if (osMatches) allowed = rule.action === "allow";
  }
  return allowed;
}

// Reminth never sets any of Mojang's optional launch features (demo
// accounts, a custom starting resolution, or any quick-play mode), so any
// argument gated behind a "features" rule is always excluded below - that's
// correct, not an oversight: those flags (--demo, --width/--height,
// --quickPlay*) genuinely don't apply to how Reminth launches the game.
const REMINTH_FEATURES = {};

function argRuleConditionMatches(rule) {
  const osOk = !rule.os || rule.os.name === "windows";
  const featuresOk =
    !rule.features ||
    Object.entries(rule.features).every(([key, want]) => Boolean(REMINTH_FEATURES[key]) === want);
  return osOk && featuresOk;
}

function argRuleAllows(rules) {
  if (!rules) return true;
  let allowed = false;
  for (const rule of rules) {
    if (argRuleConditionMatches(rule)) allowed = rule.action === "allow";
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
function resolveArguments(rawArgs, sub) {
  const out = [];
  for (const entry of rawArgs || []) {
    if (typeof entry === "string") {
      out.push(sub(entry));
      continue;
    }
    if (entry && typeof entry === "object" && argRuleAllows(entry.rules)) {
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
      libs.push({
        path: lib.downloads.artifact.path,
        url: lib.downloads.artifact.url,
        sha1: lib.downloads.artifact.sha1,
        natives: false,
      });
    }
    const classifierKey = lib.natives && lib.natives.windows;
    if (classifierKey && lib.downloads && lib.downloads.classifiers) {
      const c = lib.downloads.classifiers[classifierKey.replace("${arch}", "64")];
      if (c) {
        libs.push({ path: c.path, url: c.url, sha1: c.sha1, natives: true, extract: lib.extract });
      }
    }
    if (!lib.downloads && lib.url) {
      // Fabric-style maven coordinate library (no explicit "downloads" block)
      const mavenPath = mavenCoordToPath(lib.name);
      libs.push({
        path: mavenPath,
        url: lib.url.replace(/\/?$/, "/") + mavenPath,
        sha1: null,
        natives: false,
      });
    }
  }
  return libs;
}

function mavenCoordToPath(coord) {
  // group:artifact:version[:classifier] -> group/with/slashes/artifact/version/artifact-version[-classifier].jar
  const [group, artifact, version, classifier] = coord.split(":");
  const groupPath = group.replace(/\./g, "/");
  const file = classifier
    ? `${artifact}-${version}-${classifier}.jar`
    : `${artifact}-${version}.jar`;
  return `${groupPath}/${artifact}/${version}/${file}`;
}

async function downloadLibraries(libs, onProgress) {
  let done = 0;
  await runPool(libs, DOWNLOAD_CONCURRENCY, async (lib) => {
    const dest = path.join(paths.LIBRARIES_DIR, lib.path);
    // Mojang's own libraries carry a sha1 straight from the version JSON.
    // Fabric-style maven-coordinate libraries (see collectLibraries) don't -
    // fetch the standard Maven ".sha1" sidecar instead of downloading
    // unverified just because Mojang's manifest didn't hand us a hash.
    const sha1 = lib.sha1 || (await fetchMavenSha1(lib.url));
    await downloadFile(lib.url, dest, sha1);
    done++;
    onProgress(done, libs.length);
  });
}

async function extractNatives(libs, onProgress) {
  const nativeLibs = libs.filter((l) => l.natives);
  await fsp.mkdir(paths.NATIVES_DIR, { recursive: true });
  let done = 0;
  for (const lib of nativeLibs) {
    const jarPath = path.join(paths.LIBRARIES_DIR, lib.path);
    const extractZip = require("extract-zip");
    await extractZip(jarPath, { dir: paths.NATIVES_DIR });
    const excludes = (lib.extract && lib.extract.exclude) || ["META-INF/"];
    await removeExcluded(paths.NATIVES_DIR, excludes);
    done++;
    onProgress(done, nativeLibs.length);
  }
}

async function removeExcluded(dir, excludes) {
  for (const pattern of excludes) {
    const target = path.join(dir, pattern.replace(/\/$/, ""));
    await fsp.rm(target, { recursive: true, force: true });
  }
}

async function downloadAssets(profile, onProgress) {
  const indexDir = path.join(paths.ASSETS_DIR, "indexes");
  await fsp.mkdir(indexDir, { recursive: true });
  const index = await fetchJson(profile.assetIndex.url);
  await fsp.writeFile(
    path.join(indexDir, `${profile.assets}.json`),
    JSON.stringify(index)
  );

  const objects = Object.values(index.objects || {});
  let done = 0;
  await runPool(objects, DOWNLOAD_CONCURRENCY, async (obj) => {
    const hash = obj.hash;
    const dest = path.join(paths.ASSETS_DIR, "objects", hash.slice(0, 2), hash);
    if (!(await fileExists(dest))) {
      const url = `https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`;
      await downloadFile(url, dest, hash);
    }
    done++;
    if (done % 25 === 0 || done === objects.length) onProgress(done, objects.length);
  });
}

/**
 * Downloads the latest Fabric API build for MINECRAFT_VERSION straight
 * from Fabric's own Maven (maven.fabricmc.net) - the same official
 * channel Fabric loader itself comes from. Fabric API version strings
 * look like "<api-version>+<mc-version>" (e.g. "0.160.0+26.2").
 */
async function downloadFabricApi(modsDir) {
  const metadataUrl = `${config.FABRIC_MAVEN_URL}/net/fabricmc/fabric-api/fabric-api/maven-metadata.xml`;
  const res = await fetch(metadataUrl);
  if (!res.ok) throw new Error(`Failed to fetch Fabric API metadata: ${res.status}`);
  const xml = await res.text();

  const version = latestMatchingMavenVersion(xml, config.MINECRAFT_VERSION);
  if (!version) {
    throw new Error(
      `No Fabric API build published for Minecraft ${config.MINECRAFT_VERSION} on ` +
        `Fabric's Maven yet.`
    );
  }
  const jarUrl = `${config.FABRIC_MAVEN_URL}/net/fabricmc/fabric-api/fabric-api/${version}/fabric-api-${version}.jar`;
  const sha1 = await fetchMavenSha1(jarUrl);
  await downloadFile(jarUrl, path.join(modsDir, `fabric-api-${version}.jar`), sha1);
}

/** Pure: scans a maven-metadata.xml body for <version> entries ending in "+mcVersion". */
function latestMatchingMavenVersion(xml, mcVersion) {
  const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
  const matching = versions.filter((v) => v.endsWith(`+${mcVersion}`));
  return matching.length ? matching[matching.length - 1] : null;
}

/** Copies the bundled ReminthHUD jar (assets/mods/reminthhud-*.jar) into modsDir. */
async function installReminthHud(modsDir) {
  const bundled = await findBundledReminthHud();
  if (bundled) {
    await fsp.copyFile(bundled, path.join(modsDir, path.basename(bundled)));
    return versionFromJarName(path.basename(bundled));
  }
  if (!config.REMINTHHUD_UPDATE_MANIFEST_URL) {
    throw new Error(
      `No ReminthHUD jar found in ${paths.REMINTHHUD_ASSET_DIR} and no ` +
        `REMINTHHUD_UPDATE_MANIFEST_URL is configured. Drop a reminthhud-<version>.jar in ` +
        `assets/mods/, or set REMINTH_HUD_MANIFEST_URL.`
    );
  }
  const manifest = await fetchJson(config.REMINTHHUD_UPDATE_MANIFEST_URL);
  const dest = path.join(modsDir, `reminthhud-${manifest.version}.jar`);
  // Bug fixed here: this used to pass `manifest.sha256 ? null : undefined`,
  // which is falsy either way - a manifest-supplied hash was never actually
  // checked. Now it is, when the manifest provides one.
  if (manifest.sha256) {
    await downloadFile(manifest.url, dest, manifest.sha256, "sha256");
  } else {
    await downloadFile(manifest.url, dest, null);
  }
  return manifest.version;
}

/**
 * Best-effort install of open-source Fabric performance mods (see
 * config.PERFORMANCE_MODS) straight from each project's own GitHub
 * Releases - never Modrinth/CurseForge, Reminth doesn't depend on either.
 * A missing build for the current MINECRAFT_VERSION, or any network/parse
 * failure, is logged via onProgress and skipped rather than failing the
 * whole install: Fabric API and ReminthHUD are required, these are a bonus.
 */
async function downloadPerformanceMods(modsDir, onProgress) {
  if (!config.BUNDLE_PERFORMANCE_MODS) return [];
  const installed = [];
  for (const mod of config.PERFORMANCE_MODS) {
    try {
      const found = await fetchLatestGithubAssetForVersion(
        mod.owner,
        mod.repo,
        config.MINECRAFT_VERSION
      );
      if (!found) {
        onProgress && onProgress(`No ${mod.label} build for ${config.MINECRAFT_VERSION} yet - skipped`);
        continue;
      }
      // GitHub's Releases API doesn't publish a per-asset checksum the way
      // Maven does, so (like the bundled-Java download in java.js) this
      // relies on TLS + the official upstream repo rather than a hash pin.
      await downloadFile(found.url, path.join(modsDir, found.filename), null);
      installed.push(mod.label);
    } catch (err) {
      onProgress && onProgress(`${mod.label} failed to install (${err.message}) - skipped`);
    }
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

/** Pure: does this GitHub release's tag/name reference mcVersion (e.g. "mc26.1.2-0.9.2" contains "26.1.2")? */
function releaseMatchesVersion(release, mcVersion) {
  const tag = release.tag_name || "";
  const name = release.name || "";
  return tag.includes(mcVersion) || name.includes(mcVersion);
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

async function findBundledReminthHud() {
  let files;
  try {
    files = await fsp.readdir(paths.REMINTHHUD_ASSET_DIR);
  } catch {
    return null;
  }
  const jar = files.find((f) => f.startsWith("reminthhud-") && f.endsWith(".jar"));
  return jar ? path.join(paths.REMINTHHUD_ASSET_DIR, jar) : null;
}

function versionFromJarName(filename) {
  const match = filename.match(/^reminthhud-(.+)\.jar$/);
  return match ? match[1] : "unknown";
}

module.exports = {
  ensureInstalled,
  launch,
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
  releaseMatchesVersion,
  pickJarAsset,
};
