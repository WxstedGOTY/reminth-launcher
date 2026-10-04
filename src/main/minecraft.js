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
const compat = require("./compat");
const content = require("./content");
const { openZip } = require("./zipread");
const crypto = require("crypto");
const {
  downloadFile,
  fetchJson,
  runPool,
  fileExists,
  fetchMavenSha1,
  withTimeout,
  writeFileAtomic,
} = require("./downloader");

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
  // A starting options.txt for a brand-new instance whose player picked a
  // performance profile. gameOptions decides whether it may write at all
  // (never over an existing file); whatever happens there, Play goes on.
  try {
    await require("./gameOptions").seedIfAbsent({
      gameDir,
      perfProfile: instance.perfProfile,
      clientJar: vanillaJarPath,
      totalMemMb: Math.round(os.totalmem() / (1024 * 1024)),
      cpuCount: os.cpus().length,
    });
  } catch {
    // no starting options - the game makes its own
  }
  const modsDir = path.join(gameDir, "mods");
  let removed = [];
  let performanceModsInstalled = [];
  // ReminthHUD (+ the Fabric API it needs) goes into instances that have it
  // switched on - the original Reminth instance by default - and only when
  // a HUD build for this exact Minecraft version is bundled. Putting a HUD
  // built for another version in would stop the game from starting.
  const wantsHud = config.bundledModWanted(config.bundledMod("reminthhud"), instance);
  // Every bundled mod (config.BUNDLED_MODS: ReminthHUD, the Reminth home
  // screen) this instance wants AND has a build for. None fitting is not an
  // error: nothing is installed, nothing is said.
  const bundled = await bundledModsFor(instance, mcVersion);
  // Fabric API comes with the HUD (as it always has) and the performance
  // pack; another bundled mod brings it only when its jar says it needs it.
  const bundledNeedsApi = bundled.some((b) => b.entry.mod !== "reminthhud" && b.build.needsFabricApi);
  // The performance pack: one rule for the whole app (config.perfPackEnabled) -
  // on by default for Fabric/Quilt, only when switched on for Forge/NeoForge.
  const wantsPerfMods = config.perfPackEnabled(instance);
  const fabricLike = loader === "fabric" || loader === "quilt";
  // Reminth's jars are looked after (held back, stepped aside, removed when
  // they no longer fit, tidied) on every loader that loads mods.
  const managesMods = loader !== "vanilla";
  let packStates = null;
  // What ended up in mods/ this run: { file, mod, own }. `own` is false when
  // a jar with that name was already there and Reminth hadn't put it there -
  // that one is the player's, and must never be deleted as "Reminth's".
  const installedMods = [];
  // Lines for reminth-performance-mods.log that don't come from the
  // performance-pack download itself (Fabric API, stepping aside).
  const modLog = [];
  // An instance last started by a Reminth from before managed-mods.json has
  // Reminth's old jars in mods/ and no record of them. Written down once,
  // here, before anything decides whose jar is whose - otherwise they count
  // as the player's own copies and are never updated again.
  if (fabricLike) {
    const adopted = await adoptLegacyManagedMods(gameDir, { perf: wantsPerfMods, usedBefore: Boolean(instance.lastPlayed) }).catch(() => []);
    if (adopted.length) modLog.push(`Took over ${adopted.length} mod file(s) an older Reminth installed: ${adopted.join(", ")}`);
  }
  if (wantsHud || wantsPerfMods || bundled.length) {
    await fsp.mkdir(modsDir, { recursive: true });
    const managed = await readManagedMods(gameDir);
    const before = new Set((await fsp.readdir(modsDir).catch(() => [])).map((f) => f.toLowerCase()));
    const isManaged = (file) => Object.keys(managed.files).some((f) => f.toLowerCase() === file.toLowerCase());
    // May Reminth delete this jar if it turns out to be the wrong build?
    // Only when Reminth put it there - never a file the player already had.
    const isOurs = (file) => isManaged(file) || !before.has(file.toLowerCase());
    const note = (file, mod, alwaysOwn = false) => {
      if (!file) return;
      installedMods.push({ file, mod, own: alwaysOwn || isOurs(file) });
    };
    // The player's own copies of the mods Reminth would install (their own
    // Sodium, their own Fabric API...). Those win: Reminth doesn't even
    // download its copy, so there is never a second one to clash.
    const ownCopies = await findPackSkips(gameDir, mcVersion).catch(() => new Map());
    // Fabric API is a hard dependency of the performance pack too (Sodium/
    // Lithium/ScalableLux won't load without it), not just ReminthHUD - it
    // used to only be fetched inside the wantsHud branch, which silently
    // broke every perf mod on an instance with the HUD off. Fetch/keep it
    // whenever either wants it installed.
    if (!fabricLike || !(wantsHud || wantsPerfMods || bundledNeedsApi)) {
      // Fabric API is for Fabric/Quilt only, and only when something here needs it.
    } else if (ownCopies.has("fabric-api")) {
      modLog.push(stepAsideLine("fabric-api", "own", ownCopies.get("fabric-api").file));
    } else {
      report("Installing Fabric API", 0, 1);
      // Never allowed to stop the launch: a missing Fabric API is something
      // the game explains itself, a failed launch isn't.
      try {
        const apiJar = await downloadFabricApi(modsDir, mcVersion).catch(() => null);
        if (apiJar) {
          const check = await verifyDownloadedJar(path.join(modsDir, apiJar), { mcVersion, loader }, isOurs(apiJar));
          if (check.ok === false) {
            modLog.push(`Skipped Fabric API: the build Fabric's Maven offered is not for ${mcVersion} (${check.why})`);
          } else {
            note(apiJar, "fabric-api");
          }
        }
      } catch {
        // carry on without it
      }
    }
    for (const e of await installBundledMods(bundled, modsDir, report)) note(e.file, e.mod, true); // Reminth's own, whoever copied it in
    if (wantsPerfMods) {
      report("Installing performance mods", 0, 1);
      const detail = [];
      // Never allowed to stop the launch: the pack is a bonus.
      const run = await downloadPerformancePack(instance, modsDir, { onProgress: (msg) => report(msg, 0, 1), detail, skip: ownCopies, isOurs }).catch((err) => {
        modLog.push(`Performance pack not checked this time (${err && err.message})`);
        return { installed: [], states: null };
      });
      performanceModsInstalled = run.installed;
      packStates = run.states;
      for (const d of detail) note(d.file, d.mod);
    }
  }
  // A newer build of one of Reminth's mods must not replace the copy that
  // is there when one of the player's mods needs exactly the old version
  // (Iris pins its Sodium): the new download is given up instead.
  let heldFiles = [];
  let asideFiles = [];
  if (managesMods) {
    const held = await holdBackForPlayerMods(gameDir, installedMods, { mcVersion }).catch(() => ({ removed: [], lines: [] }));
    modLog.push(...held.lines);
    heldFiles = held.removed;
    if (held.removed.length) {
      const gone = new Set(held.removed.map((f) => f.toLowerCase()));
      performanceModsInstalled = performanceModsInstalled.filter((f) => !gone.has(f.toLowerCase()));
    }
  }
  // Reminth's copies step aside for the player's own mods BEFORE the tidy:
  // a jar Reminth has just given up must not count as "the fresh copy" that
  // lets the tidy delete somebody else's.
  if (managesMods) {
    const aside = await stepAsideForPlayerMods(gameDir, installedMods, { mcVersion }).catch(() => ({ removed: [], lines: [] }));
    modLog.push(...aside.lines);
    asideFiles = aside.removed;
    if (aside.removed.length) {
      const gone = new Set(aside.removed.map((f) => f.toLowerCase()));
      performanceModsInstalled = performanceModsInstalled.filter((f) => !gone.has(f.toLowerCase()));
      report(`Left out ${aside.removed.length} mod(s) that would clash with yours`, 0, 1);
    }
  }
  // One of Reminth's jars that this run did NOT replace (no build for the new
  // Minecraft version yet, GitHub rate-limited, Fabric's Maven unreachable)
  // and that says itself it is for another Minecraft version or loader: the
  // game would refuse to start with it, and nothing else would ever say why.
  let misfits = [];
  if (managesMods) {
    const gone = await removeMisfitManagedMods(gameDir, installedMods, { mcVersion, loader }).catch(() => ({ removed: [], lines: [] }));
    misfits = gone.removed;
    modLog.push(...gone.lines);
    if (misfits.length) report(`Removed ${misfits.length} mod(s) built for another Minecraft version`, 0, 1);
  }
  if (modLog.length) await writePerformanceLog(gameDir, modLog, { append: wantsPerfMods, mcVersion });
  // Tidied on every Fabric/Quilt install, not only when something was just
  // installed: switching both the HUD and the performance pack off used to
  // skip this entirely, so the jars already on disk kept loading.
  if (wantsPerfMods && packStates) {
    await recordPackRun(gameDir, { mcVersion, loader, states: packStates, aside: asideFiles, held: heldFiles, misfits });
  }
  if (managesMods) {
    report("Tidying mods folder", 0, 1);
    removed = await tidyManagedMods(modsDir, installedMods, {
      // Drop the ReminthHUD jar whenever the player doesn't currently want
      // it - not just when they want it but the build lookup failed.
      dropHud: !wantsHud,
      // The other bundled mods the player switched off (or that this loader
      // can't have). Wanted but no build for this version: the copy stays.
      dropBundled: bundledModsToDrop(instance),
      // Same for the performance pack - but only the copies Reminth is known
      // to have installed (see tidyManagedMods).
      dropPerf: !wantsPerfMods,
    });
    if (removed.length) report(`Removed ${removed.length} mod(s) Reminth no longer installs`, 0, 1);
  }
  removed = [...misfits, ...removed];

  report("Done", 1, 1);
  return {
    profile,
    clientJarPath,
    libraries: libs,
    removedMods: removed,
    performanceModsInstalled,
    javaPath,
    // Which Java this version runs on (8, 17, 21, 25...). launch() picks its
    // JVM flags from it: a flag one Java understands stops another starting.
    javaMajor: java.majorFor(vanilla.javaVersion),
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
    await writeFileAtomic(cacheFile, JSON.stringify(json)); // never a half-written cache
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
 * ">=1.20 <1.21", "^1.20", ">=26.2-", and arrays of those (any may match).
 * Snapshots and other odd ids only match an exact entry.
 */
function mcRangeAccepts(range, mcVersion) {
  const mc = String(mcVersion);
  if (range === undefined || range === null) return true;
  // "a || b" inside one string is not something Fabric reads, but older
  // ReminthHUD builds were written that way - treated as alternatives.
  const alternatives = (Array.isArray(range) ? range : [range]).flatMap((r) => String(r).split(/\s*\|\|\s*/)).map((r) => r.trim());
  if (alternatives.some((alt) => !alt || alt === "*")) return true;
  // A snapshot or other odd id: only an entry that names it exactly.
  if (!compat.parseMcVersion(mc)) return alternatives.includes(mc);
  // A release: the same rules the Fabric loader applies (compat.js), so
  // ">=26.2-" and "~1.21.4-" - the trailing dash Fabric's own docs use for
  // "including pre-releases" - are understood. This used to have its own
  // parser, which didn't know the dash and so never installed such a build.
  // Anything that can't be read (null) is a no: never install on a guess.
  return compat.fabricPredicateAllows(alternatives, mc) === true;
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
  return bundledModBuilds("reminthhud");
}

/**
 * Every bundled build of one of Reminth's own mods (config.BUNDLED_MODS),
 * found by its file prefix in assets/mods, with the Minecraft range its
 * fabric.mod.json declares and whether it needs Fabric API.
 */
async function bundledModBuilds(mod) {
  const entry = config.bundledMod(mod);
  if (!entry) return [];
  let files;
  try {
    files = await fsp.readdir(paths.REMINTHHUD_ASSET_DIR);
  } catch {
    return [];
  }
  const prefix = entry.filePrefix.toLowerCase();
  const builds = [];
  for (const f of files.filter((x) => x.toLowerCase().startsWith(prefix) && x.length > prefix.length + 4 && /\.jar$/i.test(x))) {
    const file = path.join(paths.REMINTHHUD_ASSET_DIR, f);
    try {
      // The bundled jars live inside app.asar once packaged. Electron's asar
      // layer supports readFile everywhere but not every fd-based API, so
      // the jar is read whole and opened from a plain copy on disk.
      const buf = await fsp.readFile(file);
      const copy = path.join(paths.ROOT, "cache", mod === "reminthhud" ? "hud" : mod, f);
      if (!(await sameSize(file, copy))) {
        await fsp.mkdir(path.dirname(copy), { recursive: true });
        await fsp.writeFile(copy, buf);
      }
      const zip = await openZip(copy);
      try {
        const meta = JSON.parse(String(await zip.read("fabric.mod.json")));
        const depends = meta.depends || {};
        builds.push({
          file,
          version: meta.version || versionFromJarName(f, entry.filePrefix),
          minecraft: depends.minecraft ?? "*",
          needsFabricApi: Object.keys(depends).some((id) => id === "fabric-api" || id === "fabric"),
        });
      } finally {
        await zip.close();
      }
    } catch {
      // unreadable jar - not offered
    }
  }
  return builds;
}

/**
 * The bundled mods (config.BUNDLED_MODS) this instance wants AND has a build
 * for: [{ entry, build }]. None fitting is not an error: nothing is
 * installed, nothing is said.
 */
async function bundledModsFor(instance, mcVersion) {
  const out = [];
  for (const entry of config.BUNDLED_MODS) {
    if (!config.bundledModWanted(entry, instance)) continue;
    const build = await findBundledModFor(entry.mod, mcVersion).catch(() => null);
    if (build) out.push({ entry, build });
  }
  return out;
}

/** Copies each bundled build into mods/ (installBundledJar). Returns [{ file, mod }]. */
async function installBundledMods(bundled, modsDir, report = () => {}) {
  const out = [];
  for (const { entry, build } of bundled || []) {
    report(`Installing ${entry.label}`, 0, 1);
    const jar = path.basename(build.file);
    const state = await installBundledJar(build.file, path.join(modsDir, jar));
    if (state === "locked") report(`${entry.label} is in use by a running game - keeping the copy that's there`, 0, 1);
    out.push({ file: jar, mod: entry.mod });
  }
  return out;
}

/**
 * Pure: the bundled mods other than ReminthHUD (which has dropHud) that
 * tidyManagedMods takes out of this instance: switched off, or a loader that
 * can't have them. One that is wanted but has no build for this version is
 * NOT in it - the copy that's there stays.
 */
function bundledModsToDrop(instance) {
  return config.BUNDLED_MODS.filter((e) => e.mod !== "reminthhud" && !config.bundledModWanted(e, instance)).map((e) => e.mod);
}

/** The bundled HUD build for this Minecraft version, or null. Newest build wins. */
async function findReminthHudFor(mcVersion) {
  return findBundledModFor("reminthhud", mcVersion);
}

/** The bundled build of one of Reminth's own mods for this Minecraft version, or null. Newest build wins. */
async function findBundledModFor(mod, mcVersion) {
  const matches = (await bundledModBuilds(mod)).filter((b) => mcRangeAccepts(b.minecraft, mcVersion));
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
    await writeFileAtomic(cacheFile, JSON.stringify(json)); // never a half-written cache
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
 * `options.world` = a world folder name (already checked by main.js) opens
 * that world straight away, where the version's own arguments offer quick
 * play for singleplayer (supportsWorldJoin); elsewhere it is ignored.
 */
const LAUNCH_GRACE_MS = 15000;

function launch(installResult, account, onCrash, settings = {}, instance = {}, options = {}) {
  const { profile, clientJarPath, libraries, javaPath, javaMajor, nativesDir, assets, loggingArg, versionType } = installResult;
  // Safe mode: the second try after the JVM refused its arguments (see
  // planSafeModeRetry). Only what the game cannot start without.
  const safeMode = Boolean(options.safeMode);
  const gameDir = instance.gameDir || paths.GAME_DIR;
  fs.mkdirSync(gameDir, { recursive: true });

  const classpath = [
    ...libraries.filter((l) => !l.natives).map((l) => containedPath(paths.LIBRARIES_DIR, l.path)),
    clientJarPath,
  ].join(";"); // Windows classpath separator - Reminth only targets Windows (see osRulesAllow)

  const join = options.join && options.join.host ? options.join : null;
  const joinTarget = join ? `${join.host}${join.port && Number(join.port) !== 25565 ? ":" + join.port : ""}` : "";
  // A world to open directly - only through the version's own quick-play
  // argument, never a flag of Reminth's making; a server join wins.
  const world = !join && typeof options.world === "string" && options.world ? options.world : null;

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
    "${quickPlaySingleplayer}": world || "",
  };
  const sub = (arg) => substituteTokens(arg, tokens);

  // Quick play is a "feature" in Mojang's argument rules (1.20+). Versions
  // without it still understand the older --server/--port flags.
  const modernJoin = Boolean(join) && hasFeature(profile, "is_quick_play_multiplayer");
  const worldJoin = Boolean(world) && supportsWorldJoin(profile);
  const features = { is_quick_play_multiplayer: modernJoin, is_quick_play_singleplayer: worldJoin };

  const maxMemoryMb = settings.maxMemoryMb || config.MAX_MEMORY_MB || computeDefaultMaxMemoryMb(os.totalmem());
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

  // The player's own arguments are left out of a safe-mode launch: they are
  // the likeliest thing the JVM refused.
  const playerArgs = safeMode ? [] : splitArgs(settings.extraJvmArgs);
  // Reminth's flags depend on which Java runs the game, on this PC, and on
  // what is already on the command line - see buildJvmFlags. The version's
  // own arguments are shown to it next to the player's so that a collector
  // named in either place is never joined by a second one from Reminth.
  const baseJvm = buildJvmFlags({
    javaMajor,
    maxMemoryMb,
    totalMemMb: Math.floor(os.totalmem() / 1024 ** 2),
    cpuCount: os.cpus().length,
    windowsBuild: windowsBuildNumber(),
    gc: settings.gc,
    userArgs: [...jvmFromProfile, ...playerArgs],
    safeMode,
  });
  // Order matters: the JVM takes the LAST value of a repeated flag, so the
  // player's arguments go after Reminth's.
  const jvmArgs = [
    ...baseJvm,
    ...(loggingArg ? [loggingArg] : []),
    ...jvmFromProfile,
    ...playerArgs,
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
  // A safe-mode launch adds to the log instead of starting it again, so the
  // JVM's own words about why the first try failed stay at the top.
  const logFd = fs.openSync(logPath, safeMode ? "a" : "w");

  let child;
  try {
    child = spawn(javawPath, [...jvmArgs, profile.mainClass, ...gameArgs], {
      cwd: gameDir,
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
  } catch (err) {
    // spawn() can throw outright (a bad argument, a path with a NUL in it)
    // instead of emitting 'error'. Nothing below runs then, so the log file
    // would stay open - and locked, on Windows - until the launcher quits.
    try {
      fs.closeSync(logFd);
    } catch {
      // already gone
    }
    throw err;
  }

  const startedAt = Date.now();
  // A little more CPU time than the browser and chat apps next to the game.
  // Best effort: Windows may refuse, and a game at normal priority is fine.
  if (!safeMode && child.pid && wantsAboveNormalPriority(settings)) {
    try {
      os.setPriority(child.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL);
    } catch {
      // not allowed, or the process is already gone
    }
  }
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
    onCrash && onCrash({ code: null, signal: null, error: err.message, logPath, elapsedMs: Date.now() - startedAt, safeMode });
  });
  child.on("exit", (code, signal) => {
    closeLog();
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs < LAUNCH_GRACE_MS && code !== 0) {
      // elapsedMs and safeMode are what main.js needs to decide on a
      // safe-mode retry (planSafeModeRetry).
      onCrash && onCrash({ code, signal, error: null, logPath, elapsedMs, safeMode });
    }
  });

  child.unref();
  return child;
}

/** Pure: does any game-argument rule in this profile gate on `feature`? */
/**
 * Pure: can this version open a world straight from the launcher? Read from
 * the version JSON's own arguments (quick play for singleplayer, 1.20 on) -
 * never decided by version number.
 */
function supportsWorldJoin(profile) {
  return Boolean(profile) && hasFeature(profile, "is_quick_play_singleplayer");
}

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
 * Pure: the automatic -Xmx, in MB, for one instance on this PC. The player's
 * own RAM setting always wins over this; `capMb` is the most this PC can
 * spare (entitlements.ramCapMb) and is never exceeded.
 *
 *  - Ordinary instances: half of total RAM, between 2 GB (the official
 *    launcher's floor) and 6 GB (a bigger heap only takes longer to collect).
 *  - A PC with 8 GB or less: 3 GB at most. 4 GB for the game plus Windows
 *    plus a browser is more than 8 GB holds, and a PC that starts paging to
 *    disk stutters far worse than a game with a smaller heap.
 *  - Modpacks (installed as one, or simply more than 60 mods): 8 GB. Big
 *    packs run out of room at 6 GB.
 */
const BIG_MOD_COUNT = 60;
function defaultMaxMemoryMb(totalMemMb, { modpack = false, modCount = 0, capMb } = {}) {
  const total = Number(totalMemMb) > 0 ? Number(totalMemMb) : 0;
  // No cap given: still never more than the PC has, less 2 GB for Windows.
  const cap = Number(capMb) > 0 ? Number(capMb) : Math.max(1024, total - 2048);
  let mb;
  if (modpack || Number(modCount) > BIG_MOD_COUNT) {
    // A big pack wants room, but never more than about 60% of the PC:
    // on an 8 GB machine a 6 GB game leaves Windows swapping to disk, which
    // stutters far worse than a smaller heap does.
    mb = Math.min(8 * 1024, Math.max(3 * 1024, Math.floor((total * 0.6) / 512) * 512));
  } else {
    mb = Math.min(6 * 1024, Math.max(2 * 1024, Math.floor(total / 2)));
    if (total <= 8 * 1024) mb = Math.min(mb, 3 * 1024);
  }
  return Math.min(mb, cap);
}

/** The same, from os.totalmem() (bytes) - the shape every caller already uses. */
function computeDefaultMaxMemoryMb(totalMemBytes, instanceInfo = {}) {
  return defaultMaxMemoryMb(Math.floor(totalMemBytes / 1024 ** 2), instanceInfo);
}

/**
 * Pure: the Windows build number out of os.release() ("10.0.19045" ->
 * 19045), or 0 when there isn't one. ZGC needs build 17134 (Windows 10
 * version 1803) or newer - the same rule Mojang's own launcher applies.
 */
function windowsBuildNumber(release = os.release()) {
  const build = Number(String(release || "").split(".")[2]);
  return Number.isFinite(build) && build > 0 ? Math.floor(build) : 0;
}

/**
 * Pure: should the game get above-normal CPU priority? Never while streamer
 * mode is on - Reminth's own recorder needs the CPU time the game would take
 * from it. Never anything higher than above-normal: "high" lets a game
 * starve the mouse and audio drivers.
 */
function wantsAboveNormalPriority(settings) {
  return Boolean(settings) && settings.processPriority === "above-normal" && !settings.streamerMode;
}

const ZGC_MIN_WINDOWS_BUILD = 17134;
const ZGC_MIN_HEAP_MB = 4096;
const ZGC_MIN_CPUS = 4;
// A PC sold as "16 GB" reports a little under 16384 MB (the firmware and an
// integrated GPU keep some), so "16 GB or more" is tested as 15 GB.
const ROOMY_PC_MB = 15 * 1024;
const LOG4J_FLAG = "-Dlog4j2.formatMsgNoLookups=true";

/** -Xmx6G / -Xmx6144m / -Xmx6442450944 -> megabytes, or null when it can't be read. */
function heapFlagMb(arg) {
  const m = /^-Xm[xs](\d+)([kKmMgG]?)$/.exec(arg);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const mb = unit === "g" ? n * 1024 : unit === "m" ? n : unit === "k" ? n / 1024 : n / 1024 ** 2;
  return mb >= 1 ? Math.floor(mb) : null;
}

/**
 * Pure: Reminth's own JVM flags for one launch (the version's and the
 * player's arguments are added after them by launch()).
 *
 * What a launcher can do about stutter is choose the garbage collector and
 * size the heap; these sets are the ones Mojang's own launcher ships, not
 * server tuning (Aikar's flags aim at a server's throughput and accept
 * 200 ms pauses - twelve dropped frames at 60 fps).
 *
 *  - Java 25+ (Minecraft 26.x): ZGC with compact object headers, as Mojang
 *    ships since 26.1 - pauses under a millisecond. ZGC collects while the
 *    game runs, so it wants spare heap and spare CPU threads: it is only
 *    chosen with Windows 10 1803+, 4 GB of heap and 4 CPU threads. Otherwise
 *    G1, below.
 *  - Java 17-24: Mojang's G1 set with a 50 ms pause target.
 *  - Java 8-16, or a Java version nobody told us: the same G1 set using only
 *    flags Java 8 already has. An unknown flag stops Java 8 starting at all.
 *
 * `gc`: "auto" (the above), "g1" (always G1) or "zgc" (ZGC wherever that
 * Java has the generational kind: 21 and up; Windows 1803+ still required).
 *
 * -Xms (the heap the game starts with): with ZGC at most 2 GB, because that
 * set also touches every page up front and ZGC grows the heap without a
 * pause. With G1, growing the heap IS a pause, so it starts full-size on a
 * PC with 16 GB or more and at half on smaller ones, where taking it all up
 * front would push Windows into paging.
 *
 * Two collectors on one command line stop the JVM ("Multiple garbage
 * collectors selected"). So when `userArgs` already switch a collector on or
 * off, Reminth adds none of its collector flags; and a -Xmx/-Xms in there
 * replaces Reminth's own instead of sitting next to it.
 *
 * `safeMode`: nothing but the heap limit and the log4j property.
 */
function buildJvmFlags({ javaMajor, maxMemoryMb, totalMemMb, cpuCount, windowsBuild, gc, userArgs, safeMode } = {}) {
  const user = (Array.isArray(userArgs) ? userArgs : splitArgs(userArgs)).map(String);
  const major = Number.isFinite(Number(javaMajor)) && Number(javaMajor) > 0 ? Math.floor(Number(javaMajor)) : 8;
  let xmx = Math.max(1, Math.floor(Number(maxMemoryMb) || 2048));

  if (safeMode) return [`-Xmx${xmx}M`, LOG4J_FLAG];

  // Theirs wins. The last -Xmx on the line is the one the JVM uses, so that
  // is the heap everything below is worked out from.
  const userXmx = user.filter((a) => /^-Xmx/.test(a));
  const userHasXms = user.some((a) => /^-Xms/.test(a));
  const userXmxMb = userXmx.length ? heapFlagMb(userXmx[userXmx.length - 1]) : null;
  if (userXmxMb) xmx = userXmxMb;
  // A -Xmx that can't be read: no -Xms from Reminth either, since one bigger
  // than their limit stops the JVM.
  const ownXms = !userHasXms && !(userXmx.length && !userXmxMb);

  const userCollectors = user.filter((a) => /^-XX:[+-]Use\w*GC$/.test(a));
  const userPicksCollector = userCollectors.length > 0;

  const choice = gc === "g1" || gc === "zgc" ? gc : "auto";
  const newEnoughWindows = Number(windowsBuild) >= ZGC_MIN_WINDOWS_BUILD;
  let zgc = false;
  if (choice === "zgc") zgc = major >= 21 && newEnoughWindows;
  else if (choice === "auto") zgc = major >= 25 && newEnoughWindows && xmx >= ZGC_MIN_HEAP_MB && Number(cpuCount) >= ZGC_MIN_CPUS;
  // Their collector decides the heap shape, not the one Reminth would have picked.
  if (userPicksCollector) zgc = userCollectors.includes("-XX:+UseZGC");

  const xms = zgc
    ? Math.min(xmx, 2048)
    : Number(totalMemMb) >= ROOMY_PC_MB
      ? xmx
      : Math.min(xmx, Math.max(1024, Math.floor(xmx / 2)));
  const heap = [...(ownXms ? [`-Xms${xms}M`] : []), ...(userXmx.length ? [] : [`-Xmx${xmx}M`])];
  // Java 25 made compact object headers a normal flag (experimental in 24,
  // unknown before): less memory per object, which every collector likes.
  const compactHeaders = major >= 25 ? ["-XX:+UseCompactObjectHeaders"] : [];

  if (major < 17) {
    return [
      ...heap,
      // Must come before the G1 percentages: they are "experimental" flags
      // and the JVM refuses them until this unlocks them. Kept even when the
      // player picks the collector - their own flags may have relied on it.
      "-XX:+UnlockExperimentalVMOptions",
      ...(userPicksCollector
        ? []
        : [
            "-XX:+UseG1GC",
            "-XX:+ParallelRefProcEnabled", // already the default from Java 17 on
            "-XX:G1NewSizePercent=20",
            "-XX:G1ReservePercent=20",
            "-XX:MaxGCPauseMillis=50",
            "-XX:G1HeapRegionSize=32M",
          ]),
      // Log4Shell. Mojang's patched logging config (loggingArg) covers the
      // affected versions too; this flag is the belt to that pair of braces
      // now that any old version can be launched.
      LOG4J_FLAG,
    ];
  }

  // A seatbelt for Java 17+: a -XX flag this Java doesn't know is skipped
  // instead of stopping the game. It does not rescue two collectors or a bad
  // value - the safe-mode relaunch is there for those.
  const seatbelt = "-XX:+IgnoreUnrecognizedVMOptions";

  if (userPicksCollector) {
    return [seatbelt, ...heap, "-XX:+UnlockExperimentalVMOptions", ...compactHeaders, "-XX:+UseStringDeduplication", LOG4J_FLAG];
  }

  if (zgc) {
    return [
      seatbelt,
      ...heap,
      "-XX:+UseZGC",
      // Java 21 and 22 still default to the old single-generation ZGC, which
      // costs frame rate; from 23 the generational kind is the default (and
      // from 24 the only one), where this flag is no longer wanted.
      ...(major <= 22 ? ["-XX:+ZGenerational"] : []),
      ...compactHeaders,
      "-XX:+AlwaysPreTouch",
      "-XX:+UseStringDeduplication",
      LOG4J_FLAG,
    ];
  }

  return [
    seatbelt,
    ...heap,
    "-XX:+UnlockExperimentalVMOptions", // before the G1 percentages, as above
    "-XX:+UseG1GC",
    "-XX:G1NewSizePercent=20",
    "-XX:G1ReservePercent=20",
    "-XX:MaxGCPauseMillis=50",
    "-XX:G1HeapRegionSize=32M",
    "-XX:+UseStringDeduplication",
    ...compactHeaders,
    LOG4J_FLAG,
  ];
}

/**
 * What the JVM prints when it refuses to start over its arguments. The
 * specific ones come first so the line shown to the player names the cause
 * rather than the generic "could not create" that follows it.
 */
const JVM_REFUSAL_MARKERS = [
  "Multiple garbage collectors selected",
  "Unrecognized VM option",
  "Improperly specified VM option",
  "is experimental and must be enabled",
  "Invalid maximum heap size",
  "Could not reserve enough space",
  "Error occurred during initialization of VM",
  "Could not create the Java Virtual Machine",
];
// The JVM asked Windows for more memory in one piece than it could have.
const HEAP_REFUSALS = ["Could not reserve enough space", "Invalid maximum heap size"];
const SAFE_MODE_WINDOW_MS = 8000;
const SAFE_MODE_HEAP_MB = 2048;

/**
 * Pure: after the game exited, should it be started once more in safe mode
 * (see launch's options.safeMode), and with how much memory?
 *
 * Yes only when all of these hold: it exited with an error code, within a
 * few seconds (a JVM that refuses its arguments never gets as far as the
 * game), the launch log holds one of the JVM's own refusal messages, and
 * this Play has not been retried already - one retry, never a loop.
 *
 * `reason` is the JVM's line, for the notice the player sees. When the
 * refusal was about reserving the heap, the retry asks for 2 GB at most.
 */
function planSafeModeRetry({ code, elapsedMs, logText, alreadyRetried, maxMemoryMb } = {}) {
  const no = { retry: false, reason: null, maxMemoryMb };
  if (alreadyRetried) return no;
  if (typeof code !== "number" || code === 0) return no;
  if (!(Number(elapsedMs) >= 0) || Number(elapsedMs) > SAFE_MODE_WINDOW_MS) return no;
  const lines = String(logText || "").split(/\r?\n/);
  for (const marker of JVM_REFUSAL_MARKERS) {
    const line = lines.find((l) => l.includes(marker));
    if (!line) continue;
    const heapError = HEAP_REFUSALS.some((h) => lines.some((l) => l.includes(h)));
    return {
      retry: true,
      reason: line.trim().slice(0, 200),
      maxMemoryMb: heapError ? Math.min(Number(maxMemoryMb) || SAFE_MODE_HEAP_MB, SAFE_MODE_HEAP_MB) : maxMemoryMb,
    };
  }
  return no;
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

/** Pure: identifies one set of native libraries, so "already extracted" can be recognised. */
function nativesStamp(nativeLibs) {
  const lines = nativeLibs.map((l) => `${l.path}:${l.sha1 || ""}`).sort();
  return crypto.createHash("sha1").update(lines.join("\n")).digest("hex");
}

/**
 * Unpacks the native libraries (old versions only - modern ones load theirs
 * straight from the jar) into the per-version natives folder.
 *
 * That folder is shared by every instance on the same Minecraft version,
 * and a running game keeps its DLLs open. So: a stamp file records which
 * set of libraries is already unpacked and the work is skipped when it
 * matches, and if Windows refuses to overwrite a DLL (EPERM/EBUSY) while
 * the folder already has files, the copy that's there is used rather than
 * failing the second instance's launch.
 */
async function extractNatives(libs, nativesDir, onProgress) {
  const nativeLibs = libs.filter((l) => l.natives);
  await fsp.mkdir(nativesDir, { recursive: true });
  if (!nativeLibs.length) return;
  const stampFile = path.join(nativesDir, NATIVES_STAMP_NAME);
  const stamp = nativesStamp(nativeLibs);
  try {
    if ((await fsp.readFile(stampFile, "utf8")).trim() === stamp) {
      onProgress(nativeLibs.length, nativeLibs.length);
      return;
    }
  } catch {
    // no stamp - extract
  }
  let done = 0;
  let complete = true;
  for (const lib of nativeLibs) {
    const jarPath = containedPath(paths.LIBRARIES_DIR, lib.path);
    try {
      await extractZip(jarPath, { dir: nativesDir });
      const excludes = (lib.extract && lib.extract.exclude) || ["META-INF/"];
      await removeExcluded(nativesDir, excludes);
    } catch (err) {
      const locked = err && ["EPERM", "EBUSY", "EACCES"].includes(err.code);
      const others = locked ? (await fsp.readdir(nativesDir).catch(() => [])).filter((f) => f !== NATIVES_STAMP_NAME) : [];
      if (!others.length) throw err;
      complete = false; // in use by a running game - don't claim a clean extract
    }
    done++;
    onProgress(done, nativeLibs.length);
  }
  if (complete) await writeFileAtomic(stampFile, stamp).catch(() => {});
}

const NATIVES_STAMP_NAME = ".reminth-natives";

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
  const index = await loadAssetIndex(profile, path.join(indexDir, `${profile.assets}.json`));

  const entries = Object.entries(index.objects || {});
  let done = 0;
  await runPool(entries, DOWNLOAD_CONCURRENCY, async ([, obj]) => {
    const hash = String(obj.hash || "");
    if (!/^[0-9a-f]{40}$/.test(hash)) throw new Error("Asset index carried a malformed hash.");
    const dest = path.join(paths.ASSETS_DIR, "objects", hash.slice(0, 2), hash);
    // "It exists" isn't enough - a download cut short by an older build
    // exists too. Hashing thousands of files on every launch is too slow,
    // so compare the size against the index (one stat each); anything that
    // doesn't match goes through downloadFile, which hashes and re-fetches.
    const size = Number.isInteger(obj.size) && obj.size >= 0 ? obj.size : null;
    if (size === null || (await fileSize(dest)) !== size) {
      const url = `https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`;
      await downloadFile(url, dest, hash, "sha1", size === null ? {} : { size });
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
      const source = path.join(paths.ASSETS_DIR, "objects", obj.hash.slice(0, 2), obj.hash);
      if (index.map_to_resources) {
        // The instance's own resources/ folder is the player's to change
        // (replacing sounds there is how pre-1.6 sound packs work), so a
        // file is only written when it's missing or empty - a different
        // size means the player swapped it, not that the copy was cut short.
        if ((await fileSize(dest)) > 0) continue;
      } else if (await sameSize(source, dest)) continue; // same size, not just "exists": a cut-short copy is redone
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.copyFile(source, dest);
    }
  }
  return { gameAssetsDir };
}

/** A file's size in bytes, or -1 if it isn't there. */
async function fileSize(file) {
  try {
    return (await fsp.stat(file)).size;
  } catch {
    return -1;
  }
}

/**
 * The asset index for a profile, from disk when possible. The version JSON
 * carries the index's sha1, so a cached copy that matches is used without
 * touching the network (it used to be re-fetched before anything else, so
 * an installed instance couldn't start offline). If it can't be fetched and
 * any readable copy is cached, that copy is used rather than failing.
 */
async function loadAssetIndex(profile, indexFile) {
  const url = assertDownloadUrl(profile.assetIndex.url);
  const sha1 = profile.assetIndex.sha1;
  const cached = async (err) => {
    try {
      return JSON.parse(await fsp.readFile(indexFile, "utf8"));
    } catch {
      throw err;
    }
  };
  if (typeof sha1 === "string" && /^[0-9a-fA-F]{40}$/.test(sha1)) {
    try {
      await downloadFile(url, indexFile, sha1); // no-op when the cached file already matches
    } catch (err) {
      return cached(err);
    }
    return JSON.parse(await fsp.readFile(indexFile, "utf8"));
  }
  // No hash to pin a cached copy to (index ids are shared between versions),
  // so ask the network first and only fall back to the cache when it fails.
  try {
    const index = await fetchJson(url);
    await writeFileAtomic(indexFile, JSON.stringify(index));
    return index;
  } catch (err) {
    return cached(err);
  }
}

/**
 * Copies a jar bundled with Reminth into a mods folder. Skipped when the
 * copy already there is the same size (it used to be rewritten on every
 * launch), and a destination that's locked because a running game has it
 * open is left as it is instead of failing the launch: returns "locked".
 */
async function installBundledJar(source, dest) {
  if (await sameSize(source, dest)) return "kept";
  try {
    await writeFileAtomic(dest, await fsp.readFile(source));
    return "written";
  } catch (err) {
    if (err && ["EBUSY", "EPERM", "EACCES"].includes(err.code) && (await fileExists(dest))) return "locked";
    throw err;
  }
}

/**
 * Downloads the latest Fabric API build for MINECRAFT_VERSION straight
 * from Fabric's own Maven (maven.fabricmc.net) - the same official
 * channel Fabric loader itself comes from. Fabric API version strings
 * look like "<api-version>+<mc-version>" (e.g. "0.160.0+26.2").
 */
/**
 * Fabric's own Maven only has a usable Fabric API for Minecraft 1.19.2 and newer. For 1.14 to 1.19.1 it has
 * either no build at all or a 5 KB empty shell (no code in it), which made every mod that needs Fabric API
 * crash at start on those versions. Modrinth has the real jar for all of them, so it is the fallback - and
 * a Maven file that is that small is treated as no file.
 */
const MIN_FABRIC_API_BYTES = 100 * 1024;

/** Pure: the newest Modrinth release of Fabric API for this Minecraft version (a packReleaseFrom record), or null. */
function pickFabricApiRelease(versions, mcVersion) {
  const list = (Array.isArray(versions) ? versions : [])
    .map((v) => packReleaseFrom(v, mcVersion, ["fabric"]))
    .filter(Boolean)
    .sort((a, b) => b.publishedAt - a.publishedAt);
  return list.length ? list[0] : null;
}

async function downloadFabricApiFromMaven(modsDir, mcVersion) {
  const metadataUrl = `${config.FABRIC_MAVEN_URL}/net/fabricmc/fabric-api/fabric-api/maven-metadata.xml`;
  const xml = await withTimeout(metadataUrl, async (signal) => {
    const res = await fetch(metadataUrl, { signal });
    if (!res.ok) throw new Error(`Failed to fetch Fabric API metadata: ${res.status}`);
    return res.text();
  });

  const version = latestMatchingMavenVersion(xml, mcVersion);
  if (!version) {
    throw new Error(`No Fabric API build published for Minecraft ${mcVersion} on Fabric's Maven yet.`);
  }
  const jarUrl = `${config.FABRIC_MAVEN_URL}/net/fabricmc/fabric-api/fabric-api/${version}/fabric-api-${version}.jar`;
  const sha1 = await fetchMavenSha1(jarUrl);
  const filename = `fabric-api-${version}.jar`;
  const file = path.join(modsDir, filename);
  await downloadFile(jarUrl, file, sha1);
  const size = (await fsp.stat(file)).size;
  if (size < MIN_FABRIC_API_BYTES) {
    await fsp.rm(file, { force: true });
    throw new Error(`Fabric's Maven has only an empty shell of Fabric API for Minecraft ${mcVersion}.`);
  }
  return filename;
}

async function downloadFabricApiFromModrinth(modsDir, mcVersion) {
  const versions = await require("./modrinth").getProjectVersions(FABRIC_API_PROJECT_ID, { loaders: ["fabric"], gameVersions: [mcVersion] });
  const release = pickFabricApiRelease(versions, mcVersion);
  if (!release) throw new Error(`No Fabric API release for Minecraft ${mcVersion} on Modrinth.`);
  // Modrinth writes some file names with a literal "%2B" for the "+": use the plain name when that is still a safe one.
  let name = release.file.filename;
  try {
    const plain = decodeURIComponent(name);
    if (safeJarName(plain)) name = plain;
  } catch {
    // keep the name as it is
  }
  const file = path.join(modsDir, name);
  await downloadFile(release.file.url, file, release.file.sha1); // already checked: https, cdn.modrinth.com, safe name, sha1
  const size = (await fsp.stat(file)).size;
  if (size < MIN_FABRIC_API_BYTES) {
    await fsp.rm(file, { force: true });
    throw new Error(`The Fabric API file for Minecraft ${mcVersion} is too small to be real.`);
  }
  return name;
}

/** Fabric API for this Minecraft version, from Fabric's Maven when that has a real file, else from Modrinth. */
async function downloadFabricApi(modsDir, mcVersion = config.MINECRAFT_VERSION) {
  let filename;
  try {
    filename = await downloadFabricApiFromMaven(modsDir, mcVersion);
  } catch (mavenErr) {
    try {
      filename = await downloadFabricApiFromModrinth(modsDir, mcVersion);
    } catch {
      throw mavenErr; // neither had it: say what the first source said
    }
  }
  // An empty shell left by an older Reminth (named differently from the real file) would load as a second,
  // useless "fabric-api" and stop the game - remove those.
  try {
    for (const f of await fsp.readdir(modsDir)) {
      if (f !== filename && /^fabric-api-\d.*\.jar$/i.test(f) && (await fsp.stat(path.join(modsDir, f))).size < MIN_FABRIC_API_BYTES) {
        await fsp.rm(path.join(modsDir, f), { force: true });
      }
    }
  } catch {
    // best effort
  }
  return filename;
}

/**
 * Which jars in an instance's mods folder Reminth put there itself:
 * <gameDir>/.reminth/managed-mods.json, { files: { "<jar name>": { mod } } }.
 * This - not the file's name - is what gives Reminth the right to delete a
 * jar later. Unreadable or missing means "nothing is known to be ours".
 *
 * It also remembers which downloads turned out to be pointless, so they
 * aren't repeated on every launch:
 *   skipped: { "<mod>": { asset, reason, because: [{ file, size }] | null, at } }
 * `asset` is the jar GitHub offered, `because` the files in mods/ it couldn't
 * run next to (null when the jar itself was the wrong build). Manifests
 * written before this existed simply have no `skipped`.
 *
 * And what the player decided about Reminth's jars, so it is respected:
 *   optedOut: { "<mod>": { by: "disabled" | "deleted", file, at } }
 * plus the outcome of the last performance-pack run, for the instance page:
 *   lastRun: { at, mcVersion, loader, mods: { "<mod>": { state, file, version, detail } } }
 */
function managedModsFile(gameDir) {
  return path.join(gameDir, ".reminth", "managed-mods.json");
}

const plainObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

async function readManagedMods(gameDir) {
  try {
    const parsed = JSON.parse(await fsp.readFile(managedModsFile(gameDir), "utf8"));
    if (parsed && plainObject(parsed.files)) {
      return {
        version: 1,
        files: parsed.files,
        skipped: plainObject(parsed.skipped) ? parsed.skipped : {},
        optedOut: plainObject(parsed.optedOut) ? parsed.optedOut : {},
        lastRun: plainObject(parsed.lastRun) && plainObject(parsed.lastRun.mods) ? parsed.lastRun : null,
      };
    }
  } catch {
    // none yet
  }
  return { version: 1, files: {}, skipped: {}, optedOut: {}, lastRun: null };
}

async function writeManagedMods(gameDir, managed) {
  const file = managedModsFile(gameDir);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const out = { version: 1, files: managed.files || {} };
  if (managed.skipped && Object.keys(managed.skipped).length) out.skipped = managed.skipped;
  if (managed.optedOut && Object.keys(managed.optedOut).length) out.optedOut = managed.optedOut;
  if (managed.lastRun) out.lastRun = managed.lastRun;
  await writeFileAtomic(file, JSON.stringify(out, null, 2));
}

/**
 * One-time: an instance that has no managed-mods.json yet may still hold
 * jars an older Reminth installed (from before that file existed). Without
 * a record they look like the player's own copies, so Reminth would step
 * aside for them for ever and Fabric API / Sodium / Lithium / ScalableLux
 * would never be updated again. This writes them into the manifest once.
 *
 * Taken over: jars in mods/ named like a mod Reminth installs today
 * (Fabric API, ReminthHUD, and - only while the performance pack is on -
 * the pack's mods), unless .reminth/content.json says the player installed
 * that file through the mod browser.
 *
 * Left alone:
 *  - everything, when content.json exists but can't be read ("can't tell");
 *    nothing is written then, so the next launch tries again.
 *  - everything, when nothing shows this instance was ever installed or
 *    played by Reminth (`usedBefore`, or its reminth-performance-mods.log):
 *    jars in a brand-new instance - a modpack that was just imported, mods
 *    dropped in before the first start - can't be an older Reminth's.
 * c2me / ferritecore / starlight - mods an older Reminth installed and this
 * one doesn't - are taken over on the same terms as the pack's mods. They
 * used to be left alone, which made them "the player's" for ever although
 * the player never chose them; tidyManagedMods then removes them.
 * The manifest is written even when it ends up empty, which is what stops
 * this from ever running a second time. Returns the file names taken over.
 */
async function adoptLegacyManagedMods(gameDir, { perf = true, usedBefore = false } = {}) {
  try {
    await fsp.access(managedModsFile(gameDir));
    return []; // there is a manifest (readable or not): this has been done
  } catch (err) {
    if (!err || err.code !== "ENOENT") return [];
  }
  const tracked = await readUserModNames(gameDir);
  if (tracked === null) return [];
  const files = {};
  const optedOut = {};
  const known = usedBefore || (await fileExists(path.join(gameDir, "reminth-performance-mods.log")));
  if (known) {
    const current = new Set(["fabric-api", ...config.BUNDLED_MODS.map((e) => e.mod), ...(perf ? [...(config.PERFORMANCE_MODS || []).map(performanceModKey), ...LEGACY_PERFORMANCE_NAMES] : [])]);
    const entries = await fsp.readdir(path.join(gameDir, "mods"), { withFileTypes: true }).catch(() => []);
    const names = new Set(entries.map((e) => e.name.toLowerCase()));
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const lower = entry.name.toLowerCase();
      // A pack jar the player switched off (Reminth's Lithium renamed to
      // .jar.disabled): that is a "no thanks", not a missing mod - without
      // this the next launch put a second, enabled copy right next to it.
      if (perf && lower.endsWith(".jar.disabled")) {
        const jar = entry.name.slice(0, -".disabled".length);
        const mod = managedModFromName(jar);
        if (mod && isPerformanceMod(mod) && current.has(mod) && !names.has(jar.toLowerCase()) && !tracked.has(jar.toLowerCase())) {
          optedOut[mod] = { by: "disabled", file: jar, at: new Date().toISOString() };
        }
        continue;
      }
      if (!lower.endsWith(".jar")) continue;
      const mod = managedModFromName(entry.name);
      if (!mod || !current.has(mod) || tracked.has(lower)) continue;
      files[entry.name] = { mod };
    }
    // An enabled copy of the same mod wins over a disabled one.
    for (const info of Object.values(files)) delete optedOut[info.mod];
  }
  await writeManagedMods(gameDir, { version: 1, files, skipped: {}, optedOut });
  return Object.keys(files);
}

/**
 * Lower-cased names of the mods the player installed through Reminth's own
 * content browser (content.js keeps them in .reminth/content.json). Returns
 * null when that list exists but can't be read - "can't tell", which the
 * caller treats as "leave everything alone".
 */
async function readUserModNames(gameDir) {
  let text;
  try {
    text = await fsp.readFile(path.join(gameDir, ".reminth", "content.json"), "utf8");
  } catch (err) {
    return err && err.code === "ENOENT" ? new Set() : null;
  }
  try {
    const files = (JSON.parse(text) || {}).files || {};
    return new Set(
      Object.keys(files)
        .filter((key) => /^mods\//i.test(key.replace(/\\/g, "/")))
        .map((key) => path.posix.basename(key.replace(/\\/g, "/")).toLowerCase())
    );
  } catch {
    return null;
  }
}

/**
 * Pure: which Reminth-managed mod a jar's NAME says it is, or null. Only
 * used for jars from before the manifest existed (see
 * adoptLegacyManagedMods). Deliberately narrow: the
 * prefix has to be followed by a version or loader tag, so "sodium-extra-..."
 * and "fabric-api-base-..." - different mods a player chose - don't match.
 */
function managedModFromName(file) {
  const lower = String(file).toLowerCase();
  if (/^fabric-api-\d/.test(lower)) return "fabric-api";
  if (/^wxhud[-_.]/.test(lower)) return "reminthhud"; // the pre-rename jar
  for (const entry of config.BUNDLED_MODS) if (lower.startsWith(entry.filePrefix)) return entry.mod;
  for (const name of LEGACY_PERFORMANCE_NAMES) {
    if (new RegExp(`^${name}[-_.](fabric|quilt|mc|v?\\d)`).test(lower)) return name;
  }
  return null;
}

/** The name a player knows a Reminth-installed mod by ("sodium" -> "Sodium"). */
function managedModLabel(mod) {
  if (mod === "fabric-api") return "Fabric API";
  const own = config.bundledMod(mod);
  if (own) return own.label;
  const entry = packEntry(mod) || (config.PERFORMANCE_MODS || []).find((m) => performanceModKey(m) === mod);
  return entry ? entry.label : String(mod);
}

/** The performance-pack entry (config.PERFORMANCE_PACK) tracked under `key`, or null. */
function packEntry(key) {
  return (config.PERFORMANCE_PACK || []).find((e) => e.slug === key) || null;
}

/** The pack entries an instance with this loader gets. */
function packEntriesFor(loader) {
  return (config.PERFORMANCE_PACK || []).filter((e) => Array.isArray(e.loaders) && e.loaders.includes(loader));
}

/** Every key the pack can be tracked under today (the GitHub fallback's names are the same slugs). */
function packKeysNow() {
  return new Set([...(config.PERFORMANCE_PACK || []).map((e) => e.slug), ...(config.PERFORMANCE_MODS || []).map(performanceModKey)]);
}

/** The key a performance-pack entry is tracked under in managed-mods.json. */
function performanceModKey(mod) {
  return String(mod.label || mod.repo).toLowerCase();
}

/** Mod ids a performance-pack entry may carry in its fabric.mod.json. */
function performanceModIds(mod) {
  return [...new Set([performanceModKey(mod), String(mod.repo || "").toLowerCase()].filter(Boolean))];
}

/** Pure: one line for reminth-performance-mods.log saying why a mod was left out. */
function stepAsideLine(mod, reason, because, problem = null) {
  const label = managedModLabel(mod);
  if (reason === "own") return `Left ${label} out: you have your own copy (${because})`;
  if (reason === "conflict") return `Left ${label} out: you have ${because}, which can't run next to it`;
  if (reason === "broken-by") return `Left ${label} out: ${because} says it can't run next to it`;
  if (reason === "breaks") return `Left ${label} out: this build says it can't run next to ${because}`;
  if (reason === "depends") {
    const need = problem && problem.need ? ` ${problem.need}` : "";
    const have = problem && problem.have ? `, and ${because} is ${problem.have}` : `, and ${because} isn't that`;
    return `Left ${label} out: this build needs ${problem ? problem.id : "another mod"}${need}${have}`;
  }
  return `Left ${label} out`;
}

const isPerformanceMod = (mod) => Boolean(mod) && mod !== "fabric-api" && !config.bundledMod(mod);

/**
 * Pure: splits the mods the game will load into Reminth's and the player's.
 *  - `mods`    content.listAll(gameDir).mod
 *  - `managed` managed-mods.json's files: { "<jar>": { mod } }
 *  - `tracked` lower-cased jar names from content.json (what the player
 *              installed through the mod browser)
 * A jar in BOTH lists is the player's: they chose that very file themselves.
 * Only enabled, real jars count - a switched-off mod doesn't load, so it
 * can't clash with anything. And a player's copy that says it isn't for
 * this Minecraft version doesn't count as "their own copy" either: it won't
 * load, so stepping aside for it would leave them with no copy at all.
 */
function splitLoadedMods({ mods, managed, tracked, mcVersion = null }) {
  const userFiles = tracked || new Set();
  const ours = new Map(); // lower-cased file -> { file, mod }
  const disown = [];
  for (const [file, info] of Object.entries(managed || {})) {
    if (userFiles.has(file.toLowerCase())) disown.push(file);
    else ours.set(file.toLowerCase(), { file, mod: info && info.mod });
  }
  const loaded = (mods || []).filter((m) => m && m.enabled && m.valid && !m.folder);
  const fits = (m) => !mcVersion || !m.mcDep || compat.fabricPredicateAllows(m.mcDep, mcVersion) !== false;
  return {
    ours,
    disown,
    loaded,
    reminth: loaded.filter((m) => ours.has(String(m.file).toLowerCase())),
    player: loaded.filter((m) => !ours.has(String(m.file).toLowerCase())),
    playerUsable: loaded.filter((m) => !ours.has(String(m.file).toLowerCase()) && fits(m)),
  };
}

/**
 * Pure: the player's jar that is (or stands in for) mod `id`, or null.
 * OptiFine is the one mod looked for by file name too: on Forge its jar
 * carries no mod id Reminth can read, and Sodium/Embeddium next to it is a
 * crash on start.
 */
function playerCopyOf(ids, playerMods) {
  const want = new Set(ids.filter(Boolean).map((i) => String(i).toLowerCase()));
  return (
    playerMods.find((m) => m.modId && want.has(String(m.modId).toLowerCase())) ||
    playerMods.find((m) => (m.provides || []).some((p) => want.has(String(p).toLowerCase()))) ||
    (want.has("optifine") && playerMods.find((m) => !m.modId && /^optifine/i.test(String(m.file)))) ||
    null
  );
}

/**
 * Pure: which of the mods Reminth installs the player already has their own
 * copy of. Returns a Map of Reminth's key for the mod ("sodium",
 * "fabric-api") -> the player's file name. Used BEFORE downloading, so a
 * mod the player brought themselves is never fetched at all.
 */
function planOwnCopies({ mods, managed, tracked, mcVersion = null }) {
  const out = new Map();
  for (const [key, why] of planPackSkips({ mods, managed, tracked, mcVersion })) if (why.reason === "own") out.set(key, why.file);
  return out;
}

/**
 * Pure: what Reminth must leave out before downloading anything, because of
 * what the player has enabled. Map of key -> { file, reason } where reason is
 *  "own"      the player has their own copy (same mod id, any file name)
 *  "conflict" the player has a mod that can't run next to it (their own
 *             Embeddium or OptiFine where Reminth would add Sodium...)
 * Covers Fabric API and every performance-pack entry. Arguments as for
 * splitLoadedMods.
 */
function planPackSkips({ mods, managed, tracked, mcVersion = null }) {
  const out = new Map();
  if (tracked === null) return out; // can't tell whose is whose - change nothing
  const { playerUsable } = splitLoadedMods({ mods, managed, tracked, mcVersion });
  const own = playerCopyOf(["fabric-api"], playerUsable);
  if (own) out.set("fabric-api", { file: own.file, reason: "own" });
  for (const entry of config.PERFORMANCE_PACK || []) {
    const copy = playerCopyOf(entry.ids || [entry.slug], playerUsable);
    if (copy) {
      out.set(entry.slug, { file: copy.file, reason: "own" });
      continue;
    }
    const clash = (entry.conflicts || []).length ? playerCopyOf(entry.conflicts, playerUsable) : null;
    if (clash) out.set(entry.slug, { file: clash.file, reason: "conflict" });
  }
  return out;
}

/**
 * Pure: what Reminth has to take back out of the mods folder so that it is
 * never the reason the game says "Incompatible mods found!".
 * Arguments as for splitLoadedMods (`managed` should already include what
 * this run installed). Returns
 *   { disown: [file],                 in both lists -> the player's from now
 *                                     on; forgotten by Reminth, never deleted
 *     remove: [{ file, mod, reason, because }],   Reminth's own jars only
 *     lines:  [string] }              plain words for the log
 * Rules:
 *  a. The player has their own enabled copy of a mod Reminth installed
 *     (same mod id, any file name) - Reminth's copy goes. Applies to the
 *     performance pack and to Fabric API; never to ReminthHUD.
 *  b. A performance-pack jar of Reminth's that can't run next to what else
 *     is loading goes: one of the player's mods "breaks" it, or it "breaks"
 *     / needs a different version of another mod that is there.
 * Nothing of the player's is ever in `remove`.
 */
function planStepAside({ mods, managed, tracked, mcVersion = null }) {
  const plan = { disown: [], remove: [], lines: [] };
  if (tracked === null) return plan; // can't tell whose is whose - change nothing
  const { ours, disown, loaded, reminth, playerUsable } = splitLoadedMods({ mods, managed, tracked, mcVersion });
  plan.disown = disown;
  for (const file of disown) plan.lines.push(`${file} is yours now: you installed it through the mod browser, so Reminth won't update or remove it`);

  const going = new Set(); // lower-cased files already in plan.remove
  const drop = (item, reason, because, problem = null) => {
    const lower = String(item.file).toLowerCase();
    if (going.has(lower)) return;
    going.add(lower);
    const mod = ours.get(lower).mod;
    plan.remove.push({ file: item.file, mod, reason, because });
    plan.lines.push(stepAsideLine(mod, reason, because, problem));
  };

  // a. the player's own copy wins
  for (const item of reminth) {
    const mod = ours.get(String(item.file).toLowerCase()).mod;
    if (config.bundledMod(mod)) continue; // Reminth's own mods (HUD, home screen) never step aside
    const entry = packEntry(mod);
    const copy = playerCopyOf([item.modId, mod, ...((entry && entry.ids) || [])], playerUsable);
    if (copy) drop(item, "own", copy.file);
  }

  // b. Reminth's performance jars that clash with what else is loading
  const staying = loaded.filter((m) => !going.has(String(m.file).toLowerCase()));
  const byFile = new Map(staying.map((m) => [String(m.file).toLowerCase(), m]));
  const isOurPerf = (file) => {
    const entry = ours.get(String(file).toLowerCase());
    return Boolean(entry) && isPerformanceMod(entry.mod);
  };
  for (const p of compat.findDependencyProblems(staying)) {
    if (p.kind !== "breaks" && p.kind !== "depends") continue;
    if (isOurPerf(p.file)) {
      // Reminth's jar is the one complaining - about anything, the
      // player's mod or another of Reminth's.
      drop(byFile.get(String(p.file).toLowerCase()), p.kind, p.targetFile, p);
    } else if (p.kind === "breaks" && isOurPerf(p.targetFile) && !ours.has(String(p.file).toLowerCase())) {
      drop(byFile.get(String(p.targetFile).toLowerCase()), "broken-by", p.file, p);
    }
  }

  // c. a mod of the player's that the pack entry is known not to run next
  // to (config.PERFORMANCE_PACK conflicts) - for clashes neither jar
  // declares itself, such as OptiFine. Checked last, so a jar that does say
  // it keeps its own, more precise reason in the log.
  for (const item of reminth) {
    if (going.has(String(item.file).toLowerCase())) continue;
    const entry = packEntry(ours.get(String(item.file).toLowerCase()).mod);
    const clash = entry && (entry.conflicts || []).length ? playerCopyOf(entry.conflicts, playerUsable) : null;
    if (clash) drop(item, "conflict", clash.file);
  }
  return plan;
}

/** The player's own copies of mods Reminth installs - see planOwnCopies. Reads the mods folder. */
async function findPlayerCopies(gameDir, mcVersion) {
  const [listed, managed, tracked] = await Promise.all([content.listAll(gameDir), readManagedMods(gameDir), readUserModNames(gameDir)]);
  return planOwnCopies({ mods: listed.mod, managed: managed.files, tracked, mcVersion });
}

/** What to leave out before downloading - see planPackSkips. Reads the mods folder. */
async function findPackSkips(gameDir, mcVersion) {
  const [listed, managed, tracked] = await Promise.all([content.listAll(gameDir), readManagedMods(gameDir), readUserModNames(gameDir)]);
  return planPackSkips({ mods: listed.mod, managed: managed.files, tracked, mcVersion });
}

/**
 * Carries out planStepAside for one instance. `installed` is ensureInstalled's
 * list of what this run put in place ([{ file, mod, own }]); it is updated
 * to match, so tidyManagedMods afterwards sees the truth. Returns
 * { removed: [file], lines: [string] }.
 */
async function stepAsideForPlayerMods(gameDir, installed, { mcVersion = null } = {}) {
  const modsDir = path.join(gameDir, "mods");
  const managed = await readManagedMods(gameDir);
  const beforeJson = JSON.stringify([managed.files, managed.skipped]);
  // What this run installed isn't written down until the tidy; count it now.
  const files = { ...managed.files };
  for (const e of installed || []) if (e && e.own && e.file) files[e.file] = { mod: e.mod };
  if (!Object.keys(files).length) return { removed: [], lines: [] }; // nothing of Reminth's here

  const [listed, tracked] = await Promise.all([content.listAll(gameDir), readUserModNames(gameDir)]);
  const plan = planStepAside({ mods: listed.mod, managed: files, tracked, mcVersion });

  const forget = (file) => {
    const lower = file.toLowerCase();
    for (const key of Object.keys(managed.files)) if (key.toLowerCase() === lower) delete managed.files[key];
  };
  // Taken off this run's list too, so the tidy neither writes the file back
  // into Reminth's manifest nor treats it as a fresh copy that replaces others.
  const unlist = (file) => {
    const lower = file.toLowerCase();
    for (let i = (installed || []).length - 1; i >= 0; i--) {
      if (installed[i] && installed[i].file && installed[i].file.toLowerCase() === lower) installed.splice(i, 1);
    }
  };
  for (const file of plan.disown) {
    forget(file);
    unlist(file);
  }
  const removed = [];
  for (const r of plan.remove) {
    try {
      await fsp.rm(path.join(modsDir, path.basename(r.file)), { force: true });
    } catch {
      continue; // locked by a running game - it stays, and stays Reminth's
    }
    removed.push(r.file);
    forget(r.file);
    unlist(r.file);
    // Remembered together with what it clashed with, so the next launch
    // doesn't download this very jar again only to delete it again (see
    // downloadPerformanceMods). It is tried afresh once GitHub offers a
    // different build or the other file is gone or replaced.
    if (isPerformanceMod(r.mod) && r.because) {
      const blocker = path.basename(String(r.because));
      managed.skipped[r.mod] = {
        asset: path.basename(r.file),
        reason: r.reason,
        because: [{ file: blocker, size: await fileSize(path.join(modsDir, blocker)) }],
        at: new Date().toISOString(),
      };
    }
  }
  if (JSON.stringify([managed.files, managed.skipped]) !== beforeJson) await writeManagedMods(gameDir, managed).catch(() => {});
  return { removed, lines: plan.lines };
}

/**
 * Pure: which of this run's fresh performance-pack downloads must NOT
 * replace the copy Reminth installed earlier, because one of the player's
 * mods needs a version the old copy is and the new one isn't (Iris pins
 * Sodium to an exact version; a newer Sodium breaks a setup that works).
 *  - `installed` ensureInstalled's list for this run: [{ file, mod, own }]
 *  - the rest as for splitLoadedMods (`managed` = the manifest's files, from
 *    BEFORE this run's downloads were written into it)
 * Returns [{ file, mod, keep, blocker, need }]: `file` the new download to
 * give up, `keep` the installed jar that stays, `blocker` the player's mod.
 * Only when it is certain: the new version fails the demand and the old one
 * meets it. Anything unreadable changes nothing.
 */
function planHoldBack({ mods, managed, tracked, installed, mcVersion = null }) {
  const out = [];
  if (tracked === null) return out; // can't tell whose is whose - change nothing
  const fresh = (installed || []).filter((e) => e && e.own && e.file && isPerformanceMod(e.mod));
  if (!fresh.length) return out;
  const files = { ...(managed || {}) };
  for (const e of fresh) files[e.file] = { mod: e.mod };
  const { ours, loaded, playerUsable } = splitLoadedMods({ mods, managed: files, tracked, mcVersion });
  const byFile = new Map(loaded.map((m) => [String(m.file).toLowerCase(), m]));
  for (const e of fresh) {
    const next = byFile.get(e.file.toLowerCase());
    if (!next || !ours.has(e.file.toLowerCase())) continue;
    // The copy of the same mod Reminth installed before, still loading.
    const old = loaded.find((m) => {
      const entry = ours.get(String(m.file).toLowerCase());
      return entry && entry.mod === e.mod && String(m.file).toLowerCase() !== e.file.toLowerCase();
    });
    if (!old) continue;
    const ids = new Set([next.modId, old.modId].filter(Boolean).map((i) => String(i).toLowerCase()));
    for (const p of playerUsable) {
      if (p.environment === "server") continue; // not loaded on the client: it demands nothing
      const hit = Object.entries(p.depends || {}).find(
        ([id, pred]) => ids.has(id.toLowerCase()) && compat.versionSatisfies(pred, next.modVersion) === false && compat.versionSatisfies(pred, old.modVersion) === true
      );
      if (!hit) continue;
      out.push({ file: e.file, mod: e.mod, keep: old.file, blocker: p.file, need: compat.describePredicate(hit[1]) });
      break;
    }
  }
  return out;
}

/**
 * Carries out planHoldBack: deletes the new download, takes it off this
 * run's list (so the tidy keeps the old copy), and remembers it in the
 * manifest's `skipped` so the same file isn't fetched again on every launch -
 * until GitHub offers another build or the player's mod changes.
 * Returns { removed: [file], lines: [string] }.
 */
async function holdBackForPlayerMods(gameDir, installed, { mcVersion = null } = {}) {
  const result = { removed: [], lines: [] };
  if (!(installed || []).some((e) => e && e.own && isPerformanceMod(e.mod))) return result;
  const modsDir = path.join(gameDir, "mods");
  const [listed, managed, tracked] = await Promise.all([content.listAll(gameDir), readManagedMods(gameDir), readUserModNames(gameDir)]);
  const plan = planHoldBack({ mods: listed.mod, managed: managed.files, tracked, installed, mcVersion });
  for (const h of plan) {
    try {
      await fsp.rm(path.join(modsDir, path.basename(h.file)), { force: true });
    } catch {
      continue; // couldn't be taken back out - the tidy treats it as any fresh copy
    }
    for (let i = installed.length - 1; i >= 0; i--) {
      if (installed[i] && installed[i].file && installed[i].file.toLowerCase() === h.file.toLowerCase()) installed.splice(i, 1);
    }
    for (const key of Object.keys(managed.files)) if (key.toLowerCase() === h.file.toLowerCase()) delete managed.files[key];
    const blocker = path.basename(String(h.blocker));
    managed.skipped[h.mod] = {
      asset: path.basename(h.file),
      reason: `held back for ${blocker}`,
      because: [{ file: blocker, size: await fileSize(path.join(modsDir, blocker)) }],
      at: new Date().toISOString(),
    };
    result.removed.push(h.file);
    result.lines.push(`Kept ${managedModLabel(h.mod)} as it is (${h.keep}): ${blocker} needs version ${h.need}, so the newer ${h.file} was not installed`);
  }
  if (result.removed.length) await writeManagedMods(gameDir, managed).catch(() => {});
  return result;
}

/**
 * Removes the jars Reminth installed earlier that this run did not replace
 * and that say themselves they won't load here (built for another Minecraft
 * version, or for another loader). Happens when the player changes an
 * instance's version and there is no build for the new one yet, or the
 * download failed: the old jar used to stay, the compatibility check keeps
 * quiet about Reminth's own jars, and the game then refused to start.
 * Only a plain "no" removes a jar - one that can't be read or doesn't say
 * is kept - and only jars in Reminth's manifest that the player didn't also
 * install through the mod browser. Returns { removed: [file], lines }.
 */
async function removeMisfitManagedMods(gameDir, installed, { mcVersion, loader }) {
  const result = { removed: [], lines: [] };
  const modsDir = path.join(gameDir, "mods");
  const managed = await readManagedMods(gameDir);
  if (!Object.keys(managed.files).length) return result;
  const tracked = await readUserModNames(gameDir);
  if (tracked === null) return result; // can't tell whose is whose - change nothing
  const fresh = new Set((installed || []).filter((e) => e && e.file).map((e) => e.file.toLowerCase()));
  for (const file of Object.keys(managed.files)) {
    const lower = file.toLowerCase();
    if (fresh.has(lower) || tracked.has(lower) || path.basename(file) !== file) continue;
    const full = path.join(modsDir, file);
    let fit;
    try {
      fit = await compat.jarFitsInstance(full, { mcVersion, loader });
    } catch {
      continue;
    }
    if (!fit || fit.ok !== false) continue;
    try {
      await fsp.rm(full, { force: true });
    } catch {
      continue; // locked by a running game - it stays, and stays Reminth's
    }
    delete managed.files[file];
    result.removed.push(file);
    result.lines.push(`Removed ${file}: it is built for another Minecraft version`);
  }
  if (result.removed.length) await writeManagedMods(gameDir, managed).catch(() => {});
  return result;
}

/**
 * Is a jar Reminth just downloaded one the loader will accept? If the jar
 * itself says no, it is deleted - but only when `ours` (Reminth put it
 * there); a file the player already had under that name is left alone.
 * Returns { ok: true | false | null, why }. Never throws.
 */
async function verifyDownloadedJar(full, instance, ours) {
  let fit;
  try {
    fit = await compat.jarFitsInstance(full, instance);
  } catch {
    return { ok: null, why: null };
  }
  if (fit && fit.ok === false && ours) await fsp.rm(full, { force: true }).catch(() => {});
  return fit || { ok: null, why: null };
}

/** Adds to (or starts) <gameDir>/reminth-performance-mods.log. Best-effort. */
async function writePerformanceLog(gameDir, lines, { append = true, mcVersion = "" } = {}) {
  const file = path.join(gameDir, "reminth-performance-mods.log");
  try {
    if (append) await fsp.appendFile(file, lines.join("\n") + "\n");
    else await fsp.writeFile(file, [`=== mods check, ${new Date().toISOString()}, mcVersion=${mcVersion} ===`, ...lines].join("\n") + "\n");
  } catch {
    // a missing log is annoying to debug, not worth failing the install over
  }
}

/**
 * Removes jars Reminth itself put in the mods folder and shouldn't have any
 * more. `installed` is what this run put (or found) in place:
 * [{ file, mod, own }] - see ensureInstalled.
 *
 * Rules, in order of how sure Reminth is that a jar is its own:
 *  - Listed in the manifest (Reminth installed it): removed once a newer
 *    copy of the same mod is in place this run, or the player switched that
 *    mod off (dropHud / dropPerf). If this run's download failed or was
 *    skipped, the old copy stays - a working mod beats no mod. A listed
 *    jar of a mod Reminth has stopped installing altogether (c2me,
 *    ferritecore, starlight) goes too: nothing would ever update it.
 *  - Anything not listed is the player's, whatever it is called. That's
 *    their mods folder, not ours. (Jars from a Reminth older than the
 *    manifest are written into it once by adoptLegacyManagedMods; after
 *    that a name alone never gets a file deleted. This used to also remove
 *    unlisted jars NAMED like a mod Reminth had just installed, which could
 *    take the player's own hand-placed Sodium with it. A leftover copy the
 *    game can't use is pointed out by the compatibility check instead.)
 *
 * This used to delete every jar named sodium-, lithium-, c2me-... that wasn't
 * in the keep list: the player's own mods, and Reminth's own copy whenever a
 * download had failed.
 */
async function tidyManagedMods(modsDir, installed, { dropHud = false, dropPerf = false, dropBundled = [] } = {}) {
  const gameDir = path.dirname(modsDir);
  let files;
  try {
    files = await fsp.readdir(modsDir);
  } catch {
    return [];
  }
  const current = (installed || []).filter((e) => e && e.file && e.mod);
  // Compared lower-cased throughout: Windows file names are case-insensitive,
  // and treating "Sodium-x.jar" and "sodium-x.jar" as two files would delete
  // the one copy there is.
  const wanted = new Set(current.map((e) => e.file.toLowerCase()));
  const freshMods = new Set(current.map((e) => e.mod));
  const onDisk = new Set(files.map((f) => f.toLowerCase()));
  const switchedOff = (mod) => (mod === "reminthhud" ? dropHud : config.bundledMod(mod) ? dropBundled.includes(mod) : mod === "fabric-api" ? false : dropPerf);
  // A mod an older Reminth installed and this one doesn't any more.
  const packNow = packKeysNow();
  const retired = (mod) => LEGACY_PERFORMANCE_NAMES.includes(mod) && !packNow.has(mod);

  const managed = await readManagedMods(gameDir);
  const beforeJson = JSON.stringify(managed.files);
  const removed = [];
  const remove = async (file) => {
    try {
      await fsp.rm(path.join(modsDir, file), { force: true });
      removed.push(file);
      return true;
    } catch {
      return false; // locked (game still running) - it stays, not fatal
    }
  };

  for (const e of current) if (e.own) managed.files[e.file] = { mod: e.mod };

  for (const [file, info] of Object.entries(managed.files)) {
    if (wanted.has(file.toLowerCase())) continue;
    if (!onDisk.has(file.toLowerCase())) {
      delete managed.files[file]; // the player removed it themselves
      continue;
    }
    const mod = info && info.mod;
    if (!freshMods.has(mod) && !switchedOff(mod) && !retired(mod)) continue;
    if (await remove(file)) delete managed.files[file];
  }

  // Switching the pack off and on again is the plain way back from "I
  // switched Reminth's Sodium off": the next run starts from a clean slate.
  const resetChoices = dropPerf && Object.keys(managed.optedOut || {}).length > 0;
  if (resetChoices) managed.optedOut = {};
  if (resetChoices || JSON.stringify(managed.files) !== beforeJson) {
    await writeManagedMods(gameDir, managed).catch(() => {}); // losing it only makes Reminth more cautious
  }
  return removed;
}

// Mods older Reminth builds installed without asking and newer ones still
// may. c2me/ferritecore/starlight are no longer installed: a jar of one of
// those that an older Reminth left behind is taken over once (see
// adoptLegacyManagedMods) and then removed by tidyManagedMods.
const LEGACY_PERFORMANCE_NAMES = ["sodium", "lithium", "scalablelux", "starlight", "c2me", "ferritecore"];

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
 *
 * `options.loader` is the instance's loader: every jar is checked against
 * what it says about itself once it's down, and one that isn't for this
 * Minecraft version / loader is deleted again rather than left for the game
 * to refuse. `options.skip` (Map: mod key -> the player's file) names the
 * mods the player has their own copy of - those aren't looked up at all.
 * `options.isOurs(file)` says whether Reminth may delete a file of that name.
 *
 * A build that was thrown away last time - the jar said it wasn't for this
 * instance, or it couldn't run next to one of the player's mods - is not
 * downloaded again while GitHub still offers that same file and the mod it
 * clashed with is still there (managed-mods.json `skipped`). It used to be
 * fetched and deleted again on every single launch.
 */
async function downloadPerformanceMods(modsDir, mcVersion, onProgress, detail = null, options = {}) {
  if (!config.BUNDLE_PERFORMANCE_MODS) return [];
  const loader = options.loader || "fabric";
  const skip = options.skip || new Map();
  const installed = [];
  const gameDir = path.dirname(modsDir);
  const skipped = (await readManagedMods(gameDir)).skipped;
  let skippedChanged = false;
  // These messages used to only ever exist as a flash of text in the
  // install progress bar - gone the moment the next stage message replaced
  // it, with no way to go back and check "did Sodium actually install, and
  // if not, why" after the fact. Written next to the mods it's about so
  // it's easy to find without knowing this exists.
  // `options.logLines`: the Modrinth pack's log this is a fallback inside -
  // lines go there and the log file is left to it. `options.mods`: which of
  // the GitHub entries to try (default: all of them).
  const logLines = options.logLines || [`=== performance mods install, ${new Date().toISOString()}, mcVersion=${mcVersion} ===`];
  for (const mod of options.mods || config.PERFORMANCE_MODS || []) {
    const key = performanceModKey(mod);
    let found = null;
    try {
      if (skip.has(key)) {
        logLines.push(stepAsideLine(key, "own", skip.get(key)));
        continue;
      }
      const info = {};
      found = await fetchLatestGithubAssetForVersion(mod.owner, mod.repo, mcVersion, info);
      if (!found) {
        // A pre-release is never installed without being asked for - say
        // that there is one, so "nothing yet" doesn't read as a mistake.
        const msg = info.onlyPrerelease ? `No stable ${mod.label} build for ${mcVersion} yet - skipped` : `No ${mod.label} build for ${mcVersion} yet - skipped`;
        onProgress && onProgress(msg);
        logLines.push(msg);
        continue;
      }
      const prior = skipped[key];
      if (prior) {
        if (prior.asset === found.filename && (await blockersUnchanged(modsDir, prior.because))) {
          const msg = skippedAgainLine(mod.label, prior, mcVersion);
          onProgress && onProgress(msg);
          logLines.push(msg);
          continue;
        }
        // A different build is on offer, or what it clashed with is gone.
        delete skipped[key];
        skippedChanged = true;
      }
      // GitHub's Releases API doesn't publish a per-asset checksum the way
      // Maven does, so (like the bundled-Java download in java.js) this
      // relies on TLS + the official upstream repo rather than a hash pin.
      const dest = path.join(modsDir, found.filename);
      const existed = await fileExists(dest);
      await downloadFile(found.url, dest, null);
      // GitHub's release notes said this build is for mcVersion; the jar
      // itself has the final word. A wrong one must not stay in mods/.
      const ours = options.isOurs ? options.isOurs(found.filename) : !existed;
      const check = await verifyDownloadedJar(dest, { mcVersion, loader }, ours);
      if (check.ok === false) {
        const msg = `Skipped ${mod.label}: the build GitHub offered is not for ${mcVersion} (${check.why})`;
        onProgress && onProgress(msg);
        logLines.push(ours ? msg : `${msg} - ${found.filename} was already in your mods folder, so it was left alone`);
        if (ours) {
          // The jar is gone again. Don't fetch this same file next launch.
          skipped[key] = { asset: found.filename, reason: "not-for-version", because: null, at: new Date().toISOString() };
          skippedChanged = true;
        }
        continue;
      }
      onProgress && onProgress(`Installed ${mod.label}`);
      logLines.push(`Installed ${mod.label}: ${found.filename} (release ${found.version})`);
      installed.push(found.filename);
      // Which mod each file is, for tidyManagedMods' "same mod" rule.
      if (detail) detail.push({ file: found.filename, mod: key });
    } catch (err) {
      // The remembered answer may be what's wrong (a release that was
      // pulled): ask GitHub again next time rather than in six hours.
      if (found && found.cached) await fsp.rm(githubCacheFile(mod.owner, mod.repo, mcVersion), { force: true }).catch(() => {});
      const msg = `${mod.label} failed to install (${err.message}) - skipped`;
      onProgress && onProgress(msg);
      logLines.push(msg);
    }
  }
  if (skippedChanged) {
    // Read again rather than reuse the copy from the top: only `skipped` is
    // this function's to change. Losing the note just means one more download.
    const manifest = await readManagedMods(gameDir);
    manifest.skipped = skipped;
    await writeManagedMods(gameDir, manifest).catch(() => {});
  }
  if (!options.logLines) {
    try {
      await fsp.writeFile(path.join(gameDir, "reminth-performance-mods.log"), logLines.join("\n") + "\n");
    } catch {
      // Best-effort - a missing log is annoying to debug, not worth failing the install over.
    }
  }
  return installed;
}

/* ---------------- performance pack from Modrinth ---------------- */

// A release must have been out this long before it is installed without
// asking: Entity Culling shipped three releases in three days in September
// 2026, two of them fixes for the one before.
const PACK_SOAK_MS = 48 * 60 * 60 * 1000;
// Modrinth's answer per slug + Minecraft version + loader is reused this long
// (shared by every instance), and used however old it is when Modrinth is down.
const PACK_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const PACK_CACHE_EMPTY_TTL_MS = 60 * 60 * 1000; // "no build yet" is the answer people wait to see change
const PACK_LOOKUP_CONCURRENCY = 3;
// Launch waits at most this long for Modrinth, then carries on with what's installed.
const PACK_LOOKUP_BUDGET_MS = 12000;
const FABRIC_API_PROJECT_ID = "P7dR8mSH";
const SHA1_HEX = /^[0-9a-f]{40}$/i;

const safeJarName = (name) => typeof name === "string" && /\.jar$/i.test(name) && path.basename(name) === name && !/[\\/]/.test(name) && name.length <= 200;
const modrinthCdnUrl = (url) => {
  try {
    const u = new URL(String(url));
    return u.protocol === "https:" && /^cdn\.modrinth\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
};

/**
 * Pure: the parts of a Modrinth version object the pack needs, or null when
 * it isn't something the pack may install: not a "release", not for this
 * Minecraft version / loader, or without a jar that has a sha1 and lives on
 * Modrinth's own file host.
 */
function packReleaseFrom(v, mcVersion, wantedLoaders = []) {
  if (!v || v.version_type !== "release") return null;
  if (Array.isArray(v.game_versions) && !v.game_versions.includes(mcVersion)) return null;
  if (Array.isArray(v.loaders) && wantedLoaders.length && !v.loaders.some((l) => wantedLoaders.includes(l))) return null;
  const files = Array.isArray(v.files) ? v.files : [];
  const f = files.find((x) => x && x.primary) || files[0];
  const sha1 = f && f.hashes && f.hashes.sha1;
  if (!f || !safeJarName(f.filename) || !modrinthCdnUrl(f.url) || !SHA1_HEX.test(String(sha1 || ""))) return null;
  const at = Date.parse(v.date_published);
  return {
    id: String(v.id || ""),
    projectId: String(v.project_id || ""),
    version: String(v.version_number || ""),
    name: String(v.name || ""),
    publishedAt: Number.isFinite(at) ? at : 0,
    file: { url: f.url, filename: f.filename, sha1: String(sha1).toLowerCase() },
    deps: (Array.isArray(v.dependencies) ? v.dependencies : [])
      .filter((d) => d && d.dependency_type === "required" && (d.project_id || d.version_id))
      .map((d) => ({ projectId: d.project_id ? String(d.project_id) : null, versionId: d.version_id ? String(d.version_id) : null })),
  };
}

/** Pure: is this a release record as packReleaseFrom makes them (read back from the cache)? */
function validPackRelease(r) {
  return Boolean(r) && typeof r.id === "string" && typeof r.version === "string" && Number.isFinite(r.publishedAt) && r.file && safeJarName(r.file.filename) && modrinthCdnUrl(r.file.url) && SHA1_HEX.test(String(r.file.sha1 || "")) && Array.isArray(r.deps);
}

/**
 * Pure: which release to install. Newest first, the newest one that is at
 * least 48 hours old. When every release is newer than that: the oldest of
 * them, but only when no copy of Reminth's is installed (a brand-new
 * instance gets something; one that has a working copy keeps it a while).
 * Returns { pick, why: "soaked" | "only-new" | "too-new" | "none" }.
 */
function pickPackRelease(releases, { now = Date.now(), hasManagedCopy = false } = {}) {
  const sorted = [...(releases || [])].sort((a, b) => b.publishedAt - a.publishedAt);
  if (!sorted.length) return { pick: null, why: "none" };
  const soaked = sorted.find((r) => now - r.publishedAt >= PACK_SOAK_MS);
  if (soaked) return { pick: soaked, why: "soaked" };
  if (hasManagedCopy) return { pick: null, why: "too-new", newest: sorted[0] };
  return { pick: sorted[sorted.length - 1], why: "only-new" };
}

function packCacheFile(project, mcVersion, wantedLoaders, cacheDir) {
  const name = `${project}-${mcVersion}-${wantedLoaders.join("+")}`.replace(/[^\w.+-]/g, "_");
  return containedPath(cacheDir || path.join(paths.ROOT, "cache", "modrinth-pack"), `${name}.json`);
}

async function readPackCache(file) {
  try {
    const parsed = JSON.parse(await fsp.readFile(file, "utf8"));
    if (!parsed || !Number.isFinite(parsed.at) || !Array.isArray(parsed.releases)) return null;
    if (!parsed.releases.every(validPackRelease)) return null;
    return { at: parsed.at, releases: parsed.releases, nonRelease: parsed.nonRelease === true };
  } catch {
    return null;
  }
}

/**
 * The release builds Modrinth has of `project` (slug or id) for this
 * Minecraft version and these Modrinth loaders - one request, or none inside
 * the cache time. Returns { releases, nonRelease, source } where source is
 * "cache" | "modrinth" | "stale-cache" (Modrinth failed, an older answer was
 * used), or { unavailable: true, error } when Modrinth failed and nothing
 * was remembered.
 */
async function lookupPackReleases(project, mcVersion, wantedLoaders, { api, cacheDir, now = Date.now() } = {}) {
  const file = packCacheFile(project, mcVersion, wantedLoaders, cacheDir);
  const cached = await readPackCache(file);
  if (cached) {
    const age = now - cached.at;
    if (age >= 0 && age < (cached.releases.length ? PACK_CACHE_TTL_MS : PACK_CACHE_EMPTY_TTL_MS)) return { ...cached, source: "cache", cacheFile: file };
  }
  let list;
  try {
    list = await api.getProjectVersions(project, { loaders: wantedLoaders, gameVersions: [mcVersion] });
    if (!Array.isArray(list)) throw new Error("Modrinth gave no version list");
  } catch (err) {
    if (cached) return { ...cached, source: "stale-cache", cacheFile: file };
    return { unavailable: true, error: err };
  }
  const releases = list.map((v) => packReleaseFrom(v, mcVersion, wantedLoaders)).filter(Boolean);
  const nonRelease = list.some((v) => v && v.version_type && v.version_type !== "release");
  try {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await writeFileAtomic(file, JSON.stringify({ at: now, releases, nonRelease }));
  } catch {
    // not remembered - the next launch simply asks again
  }
  return { releases, nonRelease, source: "modrinth", cacheFile: file };
}

/**
 * Runs fn over items, `limit` at a time, for at most `budgetMs`. Whatever
 * hasn't answered by then counts as { unavailable: true } - a launch must
 * not sit waiting on Modrinth. Never rejects.
 */
async function settleWithin(items, limit, budgetMs, fn) {
  const results = new Array(items.length).fill(undefined);
  let next = 0;
  let stopped = false;
  const worker = async () => {
    while (!stopped && next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i]);
      } catch (err) {
        results[i] = { unavailable: true, error: err };
      }
    }
  };
  let timer;
  const workers = Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  await Promise.race([workers, new Promise((resolve) => (timer = setTimeout(resolve, budgetMs)))]);
  clearTimeout(timer);
  stopped = true;
  return results.map((r) => (r === undefined ? { unavailable: true, error: new Error("Modrinth took too long to answer") } : r));
}

/**
 * Installs the performance pack (config.PERFORMANCE_PACK) into one instance,
 * from Modrinth, release builds only. Everything the old GitHub-only code
 * guaranteed still holds, and this runs the same safety steps after it in
 * ensureInstalled (hold back, step aside, misfit removal, tidy).
 *
 *  - The player's own copy, or a mod that clashes (`options.skip`, from
 *    planPackSkips): not looked up, not downloaded.
 *  - A Reminth jar the player switched off (renamed to .disabled) or deleted:
 *    remembered in managed-mods.json `optedOut` and left alone - until the
 *    file is switched back on, the pack is switched off and on, or Restore
 *    (resetPerformancePack).
 *  - Release builds only, at least 48 hours old (pickPackRelease), with the
 *    jar's sha1 checked before it replaces anything, then the jar's own
 *    metadata checked against the instance (verifyDownloadedJar).
 *  - Required dependencies under the same rule. Fabric API counts as there
 *    on Fabric/Quilt (Reminth brings it); another pack entry counts when it
 *    is being installed; anything else is looked up; one without a stable
 *    build means the mod that needs it is left out.
 *  - Modrinth down: the remembered answer is used; with none, nothing is
 *    removed, what's installed stays, and Sodium/Lithium/ScalableLux fall
 *    back to their GitHub releases (Fabric/Quilt only).
 *
 * Returns { installed: [file], states: { key: { state, file, version, detail } } }.
 * `options.detail` gets { file, mod } per jar in place, for ensureInstalled.
 * `options.deps` (tests): { api, download, now, cacheDir, budgetMs }.
 */
async function downloadPerformancePack(instance, modsDir, options = {}) {
  const { onProgress = null, detail = null, skip = new Map(), isOurs = null } = options;
  const deps = options.deps || {};
  const api = deps.api || require("./modrinth");
  const download = deps.download || ((url, dest, sha1) => downloadFile(url, dest, sha1));
  const now = Number.isFinite(deps.now) ? deps.now : Date.now();
  const budgetMs = Number.isFinite(deps.budgetMs) ? deps.budgetMs : PACK_LOOKUP_BUDGET_MS;
  const mcVersion = instance.mcVersion;
  const loader = instance.loader || "vanilla";
  const fabricLike = loader === "fabric" || loader === "quilt";
  const wanted = content.loadersFor("mod", instance);
  const gameDir = path.dirname(modsDir);
  const manifest = await readManagedMods(gameDir);
  let manifestChanged = false;
  const installed = [];
  const states = {};
  const logLines = [`=== performance mods install, ${new Date(now).toISOString()}, mcVersion=${mcVersion}, loader=${loader} ===`];
  const say = (line) => {
    logLines.push(line);
    if (onProgress) onProgress(line);
  };
  const exists = (file) => fileExists(path.join(modsDir, file));

  // 1. Decide, without any network, what is left out.
  const queue = []; // { entry, key, hasManagedCopy }
  for (const entry of packEntriesFor(loader)) {
    const key = entry.slug;
    const label = entry.label;
    if (skip.has(key)) {
      const why = skip.get(key);
      const file = typeof why === "string" ? why : why.file;
      const reason = typeof why === "string" ? "own" : why.reason;
      states[key] = { state: "stepped-aside", file: null, version: null, detail: reason === "conflict" ? `You have ${file}, which can't run next to it` : `You have your own copy (${file})` };
      logLines.push(stepAsideLine(key, reason, file));
      continue;
    }
    const managedFiles = Object.entries(manifest.files)
      .filter(([f, info]) => info && info.mod === key && safeJarName(f))
      .map(([f]) => f);
    const present = [];
    for (const f of managedFiles) if (await exists(f)) present.push(f);
    const prior = manifest.optedOut[key];
    if (prior) {
      if (prior.file && safeJarName(prior.file) && (await exists(prior.file))) {
        // Switched back on: it is Reminth's to keep up to date again.
        delete manifest.optedOut[key];
        manifest.files[prior.file] = { mod: key };
        present.push(prior.file);
        manifestChanged = true;
        logLines.push(`${label} is switched on again - Reminth keeps it up to date from now on`);
      } else {
        states[key] = { state: "switched-off-by-you", file: null, version: null, detail: prior.by === "disabled" ? "You switched it off" : "You removed it" };
        logLines.push(`Left ${label} out: you ${prior.by === "disabled" ? "switched it off" : "removed it"}, so Reminth doesn't put it back (Restore on the instance page brings it back)`);
        continue;
      }
    } else if (managedFiles.length && !present.length) {
      // Reminth installed it and Reminth didn't take it out: the player did.
      let disabled = null;
      for (const f of managedFiles) if (!disabled && (await exists(`${f}.disabled`))) disabled = f;
      manifest.optedOut[key] = { by: disabled ? "disabled" : "deleted", file: disabled || managedFiles[0], at: new Date(now).toISOString() };
      manifestChanged = true;
      states[key] = { state: "switched-off-by-you", file: null, version: null, detail: disabled ? "You switched it off" : "You removed it" };
      logLines.push(`Left ${label} out: you ${disabled ? "switched it off" : "removed it"}, so Reminth doesn't put it back (Restore on the instance page brings it back)`);
      continue;
    }
    queue.push({ entry, key, hasManagedCopy: present.length > 0, present });
  }

  // 2. Ask Modrinth (or the cache) - at most one request per mod, three at a
  // time, and no longer than the budget.
  if (queue.length && onProgress) onProgress("Checking performance mods");
  const started = Date.now();
  const answers = await settleWithin(queue, PACK_LOOKUP_CONCURRENCY, budgetMs, (q) => lookupPackReleases(q.entry.slug, mcVersion, wanted, { api, cacheDir: deps.cacheDir, now }));

  const picks = new Map(); // key -> { entry, key, release, label, cacheFile, hasManagedCopy, dependency }
  const fallback = []; // queue items that go to GitHub
  queue.forEach((q, i) => {
    const a = answers[i];
    const label = q.entry.label;
    if (a.unavailable) {
      const why = (a.error && a.error.message) || "Modrinth can't be reached";
      if (q.entry.github && fabricLike) {
        fallback.push(q);
        return;
      }
      states[q.key] = q.hasManagedCopy
        ? { state: "installed", file: q.present[0], version: null, detail: `Modrinth couldn't be reached, so the installed copy was kept (${why})` }
        : { state: "failed", file: null, version: null, detail: `Modrinth couldn't be reached (${why})` };
      logLines.push(q.hasManagedCopy ? `Kept ${label} as it is: Modrinth couldn't be reached (${why})` : `${label} not installed: Modrinth couldn't be reached (${why})`);
      return;
    }
    const choice = pickPackRelease(a.releases, { now, hasManagedCopy: q.hasManagedCopy });
    if (choice.why === "none") {
      const msg = a.nonRelease ? `No stable ${label} build for ${mcVersion} yet (only test builds) - skipped` : `No ${label} build for ${mcVersion} yet - skipped`;
      states[q.key] = q.hasManagedCopy
        ? { state: "installed", file: q.present[0], version: null, detail: msg }
        : { state: "no-build", file: null, version: null, detail: a.nonRelease ? "Only test builds so far" : "No build for this version yet" };
      say(msg);
      return;
    }
    if (choice.why === "too-new") {
      states[q.key] = { state: "installed", file: q.present[0], version: null, detail: `A newer build (${choice.newest.version}) is less than two days old - not installed yet` };
      logLines.push(`Kept ${label} as it is: the newest build (${choice.newest.version}) is less than 48 hours old`);
      return;
    }
    picks.set(q.key, { entry: q.entry, key: q.key, label, release: choice.pick, cacheFile: a.source === "modrinth" ? null : a.cacheFile, hasManagedCopy: q.hasManagedCopy });
  });

  // 3. Required dependencies. Anything not already covered is looked up
  // (within what's left of the budget) under the same release-only rule.
  const byProject = () => new Map([...picks.values()].map((p) => [p.release.projectId, p]));
  const unknown = new Map(); // projectId -> versionId|null
  for (const p of picks.values()) {
    for (const d of p.release.deps) {
      if (!d.projectId) continue;
      if (d.projectId === FABRIC_API_PROJECT_ID || byProject().has(d.projectId)) continue;
      if (!unknown.has(d.projectId)) unknown.set(d.projectId, d.versionId);
    }
  }
  if (unknown.size) {
    const ids = [...unknown.keys()];
    const left = Math.max(2000, budgetMs - (Date.now() - started));
    const found = await settleWithin(ids, PACK_LOOKUP_CONCURRENCY, left, (id) => lookupPackReleases(id, mcVersion, wanted, { api, cacheDir: deps.cacheDir, now }));
    ids.forEach((id, i) => {
      const a = found[i];
      if (a.unavailable) return;
      const key = `dep-${id}`;
      const present = Object.entries(manifest.files).some(([, info]) => info && info.mod === key);
      const pinned = unknown.get(id);
      const release = pinned ? a.releases.find((r) => r.id === pinned) || null : pickPackRelease(a.releases, { now, hasManagedCopy: present }).pick;
      if (release && !release.deps.some((d) => d.projectId && d.projectId !== FABRIC_API_PROJECT_ID)) {
        picks.set(key, { entry: null, key, label: release.name || release.file.filename, release, cacheFile: a.source === "modrinth" ? null : a.cacheFile, hasManagedCopy: present, dependency: true });
      }
    });
  }
  // Drop every mod whose requirements aren't all met, until nothing changes
  // (a dependency that drops takes the mods needing it with it).
  for (let changed = true; changed; ) {
    changed = false;
    const projects = byProject();
    for (const p of [...picks.values()]) {
      const unmet = p.release.deps.find((d) => {
        if (d.projectId === FABRIC_API_PROJECT_ID) return !fabricLike;
        const other = d.projectId ? projects.get(d.projectId) : null;
        if (!other) return true;
        return Boolean(d.versionId) && other.release.id !== d.versionId;
      });
      if (!unmet) continue;
      picks.delete(p.key);
      changed = true;
      const what = unmet.projectId === FABRIC_API_PROJECT_ID ? "Fabric API" : `a mod (${unmet.projectId || unmet.versionId})`;
      if (!p.dependency) {
        states[p.key] = { state: "no-build", file: null, version: null, detail: `Needs ${what}, which has no stable build here` };
        say(`Left ${p.label} out: it needs ${what}, which has no stable build for ${mcVersion}`);
      }
    }
  }
  // Dependencies that ended up needed by nobody aren't installed.
  for (const p of [...picks.values()]) {
    if (p.dependency && ![...picks.values()].some((o) => !o.dependency && o.release.deps.some((d) => d.projectId === p.release.projectId))) picks.delete(p.key);
  }

  // 4. Download what was picked: sha1-checked, then the jar's own word.
  for (const p of picks.values()) {
    const { release, label, key } = p;
    const filename = release.file.filename;
    const prior = manifest.skipped[key];
    if (prior) {
      if (prior.asset === filename && (await blockersUnchanged(modsDir, prior.because))) {
        const msg = skippedAgainLine(label, prior, mcVersion);
        const held = /^held back/.test(String(prior.reason || ""));
        states[key] = { state: held ? "held-back" : prior.because ? "stepped-aside" : "no-build", file: null, version: release.version, detail: msg };
        say(msg);
        continue;
      }
      delete manifest.skipped[key];
      manifestChanged = true;
    }
    const dest = path.join(modsDir, filename);
    const existed = await fileExists(dest);
    const listed = Object.keys(manifest.files).some((f) => f.toLowerCase() === filename.toLowerCase());
    const ours = isOurs ? isOurs(filename) : listed || !existed;
    if (existed && !ours) {
      // A file of that very name that isn't Reminth's is the player's: never overwritten.
      states[key] = { state: "stepped-aside", file: null, version: null, detail: `${filename} is already in your mods folder` };
      logLines.push(`Left ${label} out: ${filename} is already in your mods folder and is yours`);
      continue;
    }
    try {
      if (!modrinthCdnUrl(release.file.url)) throw new Error("not a Modrinth download");
      await download(release.file.url, dest, release.file.sha1);
    } catch (err) {
      // The remembered answer may be what's wrong (a file that was pulled): ask again next time.
      if (p.cacheFile) await fsp.rm(p.cacheFile, { force: true }).catch(() => {});
      states[key] = p.hasManagedCopy ? { state: "installed", file: null, version: null, detail: `The update failed (${err.message})` } : { state: "failed", file: null, version: null, detail: err.message };
      say(`${label} failed to install (${err.message}) - skipped`);
      continue;
    }
    const check = await verifyDownloadedJar(dest, { mcVersion, loader }, ours);
    if (check.ok === false) {
      const msg = `Skipped ${label}: the build Modrinth offered is not for ${mcVersion} (${check.why})`;
      say(msg);
      if (ours) {
        manifest.skipped[key] = { asset: filename, reason: "not-for-version", because: null, at: new Date(now).toISOString() };
        manifestChanged = true;
      }
      states[key] = { state: "no-build", file: null, version: release.version, detail: check.why };
      continue;
    }
    installed.push(filename);
    if (detail) detail.push({ file: filename, mod: key });
    if (!p.dependency || p.entry) states[key] = { state: "installed", file: filename, version: release.version, detail: null };
    say(`${existed ? "Up to date" : "Installed"} ${label}: ${filename} (release ${release.version})`);
  }

  if (manifestChanged) {
    // Read again: only optedOut / skipped / re-enabled files are ours to change here.
    const fresh = await readManagedMods(gameDir);
    fresh.optedOut = manifest.optedOut;
    fresh.skipped = manifest.skipped;
    for (const [f, info] of Object.entries(manifest.files)) if (!fresh.files[f]) fresh.files[f] = info;
    await writeManagedMods(gameDir, fresh).catch(() => {});
  }

  // 5. Modrinth unreachable with nothing remembered: the old GitHub source
  // for the three that publish there.
  if (fallback.length) {
    const mods = (config.PERFORMANCE_MODS || []).filter((m) => fallback.some((q) => q.key === performanceModKey(m)));
    const ghDetail = [];
    logLines.push("Modrinth couldn't be reached - trying GitHub for " + mods.map((m) => m.label).join(", "));
    const got = await downloadPerformanceMods(modsDir, mcVersion, onProgress, ghDetail, { loader, isOurs, mods, logLines }).catch(() => []);
    installed.push(...got);
    if (detail) detail.push(...ghDetail);
    for (const q of fallback) {
      const d = ghDetail.find((x) => x.mod === q.key);
      states[q.key] = d
        ? { state: "installed", file: d.file, version: null, detail: "From GitHub (Modrinth couldn't be reached)" }
        : q.hasManagedCopy
          ? { state: "installed", file: q.present[0], version: null, detail: "Modrinth couldn't be reached, so the installed copy was kept" }
          : { state: "failed", file: null, version: null, detail: "Modrinth couldn't be reached" };
    }
  }

  try {
    await fsp.writeFile(path.join(gameDir, "reminth-performance-mods.log"), logLines.join("\n") + "\n");
  } catch {
    // Best-effort - a missing log is annoying to debug, not worth failing the install over.
  }
  return { installed, states };
}

/**
 * Writes managed-mods.json `lastRun` - what the instance page shows. `states`
 * from downloadPerformancePack, corrected by what the steps after it did:
 * a jar that was stepped aside, held back or removed again is not
 * "installed". Never throws.
 */
async function recordPackRun(gameDir, { mcVersion, loader, states, aside = [], held = [], misfits = [] }) {
  try {
    const modsDir = path.join(gameDir, "mods");
    const lower = (list) => new Set(list.map((f) => String(f).toLowerCase()));
    const [asideSet, heldSet, misfitSet] = [lower(aside), lower(held), lower(misfits)];
    const mods = {};
    for (const [key, s] of Object.entries(states || {})) {
      if (key.startsWith("dep-")) continue;
      const out = { ...s };
      if (out.state === "installed" && out.file) {
        const f = out.file.toLowerCase();
        if (asideSet.has(f)) Object.assign(out, { state: "stepped-aside", file: null, detail: "Left out: one of your mods can't run next to it" });
        else if (heldSet.has(f)) Object.assign(out, { state: "held-back", file: null, detail: "One of your mods needs the version that's installed" });
        else if (misfitSet.has(f)) Object.assign(out, { state: "no-build", file: null, detail: "Removed: it was built for another Minecraft version" });
        else if (!(await fileExists(path.join(modsDir, out.file)))) Object.assign(out, { state: "failed", file: null });
      }
      mods[key] = out;
    }
    const manifest = await readManagedMods(gameDir);
    manifest.lastRun = { at: new Date().toISOString(), mcVersion, loader, mods };
    await writeManagedMods(gameDir, manifest);
  } catch {
    // the instance page then says "pending" - nothing breaks
  }
}

const PACK_STATES = ["installed", "pending", "off", "no-build", "stepped-aside", "held-back", "switched-off-by-you", "failed"];

/**
 * What the performance pack is doing in one instance, for the instance page:
 * { enabled, loader, mods: [{ slug, label, state, file, version, detail }] }.
 * State per mod: "installed" | "pending" (not run since the instance last
 * changed) | "off" | "no-build" | "stepped-aside" | "held-back" |
 * "switched-off-by-you" | "failed". Never throws.
 */
async function performancePackStatus(instance) {
  const loader = (instance && instance.loader) || "vanilla";
  const enabled = config.perfPackEnabled(instance);
  const out = { enabled, loader, mods: [] };
  try {
    const gameDir = instance && instance.gameDir;
    const manifest = gameDir ? await readManagedMods(gameDir) : { files: {}, optedOut: {}, lastRun: null };
    const run = manifest.lastRun && manifest.lastRun.mcVersion === instance.mcVersion && manifest.lastRun.loader === loader ? manifest.lastRun.mods : null;
    for (const entry of packEntriesFor(loader)) {
      const key = entry.slug;
      const row = { slug: key, label: entry.label, state: "pending", file: null, version: null, detail: null };
      const last = run && run[key];
      if (!enabled) row.state = "off";
      else if (manifest.optedOut && manifest.optedOut[key]) {
        row.state = "switched-off-by-you";
        row.detail = manifest.optedOut[key].by === "disabled" ? "You switched it off" : "You removed it";
      } else if (last && PACK_STATES.includes(last.state)) {
        Object.assign(row, { state: last.state, file: last.file || null, version: last.version || null, detail: last.detail || null });
      } else {
        const file = Object.keys(manifest.files || {}).find((f) => manifest.files[f] && manifest.files[f].mod === key);
        if (file && gameDir && (await fileExists(path.join(gameDir, "mods", file)))) Object.assign(row, { state: "installed", file });
      }
      out.mods.push(row);
    }
  } catch {
    // whatever was gathered so far
  }
  return out;
}

/**
 * Restore: forgets what the player switched off or deleted and every build
 * that was set aside, so the next launch installs the whole pack again.
 * Changes only the bookkeeping - no jar is touched here. Never throws;
 * returns true when something was reset.
 */
async function resetPerformancePack(instance) {
  try {
    const manifest = await readManagedMods(instance.gameDir);
    const keys = packKeysNow();
    let changed = Object.keys(manifest.optedOut || {}).length > 0;
    manifest.optedOut = {};
    for (const key of Object.keys(manifest.skipped || {})) {
      if (keys.has(key) || key.startsWith("dep-")) {
        delete manifest.skipped[key];
        changed = true;
      }
    }
    if (manifest.lastRun) {
      manifest.lastRun = null;
      changed = true;
    }
    if (changed) await writeManagedMods(instance.gameDir, manifest);
    return changed;
  } catch {
    return false;
  }
}

/** Are the files a build was set aside for still in mods/, unchanged? `because` is [{ file, size }] or null. */
async function blockersUnchanged(modsDir, because) {
  if (!Array.isArray(because)) return true; // the jar itself was the problem, not a neighbour
  for (const b of because) {
    if (!b || typeof b.file !== "string" || !Number.isInteger(b.size) || b.size < 0) return false;
    if ((await fileSize(path.join(modsDir, path.basename(b.file)))) !== b.size) return false;
  }
  return true;
}

/** Pure: the one log line for a build that isn't downloaded again (see `skipped` in managed-mods.json). */
function skippedAgainLine(label, prior, mcVersion) {
  const names = Array.isArray(prior.because) ? prior.because.map((b) => b.file).join(", ") : "";
  // Held back for a player's mod that needs the version already installed (see holdBackForPlayerMods).
  if (names && /^held back/.test(String(prior.reason || ""))) return `Kept ${label} as it is again without downloading ${prior.asset}: ${names} still needs the version that is installed`;
  return names
    ? `Left ${label} out again without downloading it: ${prior.asset} still can't run next to ${names}`
    : `Skipped ${label} again without downloading it: ${prior.asset} is still the build GitHub offers, and it is not for ${mcVersion}`;
}

// How long an answer from GitHub's release list is reused without asking
// again. "No build yet" is kept for less: that is the answer a player on a
// brand-new Minecraft version is waiting to see change.
const GITHUB_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const GITHUB_CACHE_EMPTY_TTL_MS = 60 * 60 * 1000;

/** Where the remembered answer for one owner/repo + Minecraft version lives (launcher cache, shared by all instances). */
function githubCacheFile(owner, repo, mcVersion) {
  const name = `${owner}-${repo}-${mcVersion}`.replace(/[^\w.+-]/g, "_");
  return containedPath(path.join(paths.ROOT, "cache", "github-releases"), `${name}.json`);
}

/** { at, found } from the cache file, or null when there is none or it isn't one. Never throws. */
async function readGithubCache(file) {
  try {
    const parsed = JSON.parse(await fsp.readFile(file, "utf8"));
    if (!parsed || !Number.isFinite(parsed.at)) return null;
    const f = parsed.found;
    if (f === null) return { at: parsed.at, found: null, onlyPrerelease: parsed.onlyPrerelease === true };
    // The file name ends up as a path inside mods/ - only a bare .jar name will do.
    const fine =
      f &&
      typeof f.filename === "string" &&
      /\.jar$/i.test(f.filename) &&
      path.basename(f.filename) === f.filename &&
      !/[\\/]/.test(f.filename) &&
      typeof f.url === "string" &&
      /^https:\/\//i.test(f.url);
    return fine ? { at: parsed.at, found: { version: String(f.version || ""), url: f.url, filename: f.filename } } : null;
  } catch {
    return null;
  }
}

/**
 * The newest release asset of owner/repo for mcVersion:
 * { version, url, filename } (plus `cached: true` when it came from disk),
 * or null when there is no build for that version.
 *
 * GitHub allows 60 unauthenticated requests an hour per IP address, and
 * this used to spend three of them on every launch of every instance. The
 * answer is now kept on disk for six hours, so a launch inside that time
 * asks GitHub nothing - and with the jar already in mods/ needs no network
 * at all. When GitHub can't be reached or says "rate limit", the last
 * answer is used however old it is: an installed instance keeps its mods.
 *
 * `info` (optional object) gets `onlyPrerelease: true` when the answer is
 * "nothing" only because every build for mcVersion is a pre-release.
 */
async function fetchLatestGithubAssetForVersion(owner, repo, mcVersion, info = null) {
  const cacheFile = githubCacheFile(owner, repo, mcVersion);
  const cached = await readGithubCache(cacheFile);
  const remembered = () => {
    if (info && cached && !cached.found && cached.onlyPrerelease) info.onlyPrerelease = true;
    return cached && cached.found ? { ...cached.found, cached: true } : null;
  };
  if (cached) {
    const age = Date.now() - cached.at;
    if (age >= 0 && age < (cached.found ? GITHUB_CACHE_TTL_MS : GITHUB_CACHE_EMPTY_TTL_MS)) return remembered();
  }
  let found;
  const fresh = {};
  try {
    found = await lookupGithubAsset(owner, repo, mcVersion, fresh);
  } catch (err) {
    if (cached && cached.found) return remembered();
    throw err;
  }
  if (found === undefined) return remembered(); // GitHub answered, but not with a release list
  try {
    await fsp.mkdir(path.dirname(cacheFile), { recursive: true });
    await writeFileAtomic(cacheFile, JSON.stringify(found === null && fresh.onlyPrerelease ? { at: Date.now(), found, onlyPrerelease: true } : { at: Date.now(), found }));
  } catch {
    // not remembered - the next launch simply asks again
  }
  if (info && found === null && fresh.onlyPrerelease) info.onlyPrerelease = true;
  return found;
}

/**
 * Fetches the release list for owner/repo and returns the first one matching
 * mcVersion (null: none does; undefined: GitHub gave no usable list, which
 * is not an answer worth remembering).
 * GitHub's unauthenticated REST API is capped at 60 requests/hour
 * per IP - with 3 performance mods checked per install, that's only ~20
 * installs/hour before every player behind the same IP (a school, office, or
 * NAT'd household) starts getting rate-limited. Surface that specifically
 * (rather than the generic "no build published" message) so it's clear to
 * whoever's debugging a support report that it's transient and IP-wide, not
 * a real missing build - see downloadPerformanceMods's catch.
 *
 * Any other answer that isn't a release list (a 403 without the rate-limit
 * header, a 429, a 5xx) is an error too: it used to come back as "no build
 * yet", which is not what happened.
 *
 * Pre-releases and drafts are passed over (see isPreRelease); when those are
 * all there is for mcVersion, `info.onlyPrerelease` is set.
 */
async function lookupGithubAsset(owner, repo, mcVersion, info = null) {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=30`;
  const releases = await withTimeout(url, async (signal) => {
    const res = await fetch(url, { headers: { Accept: "application/vnd.github+json" }, signal });
    if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
      throw new Error(
        "GitHub API rate limit hit (shared by everyone on this network right now) - try again in a bit"
      );
    }
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    return res.json();
  });
  if (!Array.isArray(releases)) return undefined;
  for (const release of releases) {
    if (!release || !releaseMatchesVersion(release, mcVersion)) continue;
    const asset = pickJarAsset(release.assets, mcVersion);
    if (!asset) continue;
    if (isPreRelease(release, mcVersion)) {
      if (info) info.onlyPrerelease = true;
      continue;
    }
    if (info) info.onlyPrerelease = false;
    return { version: release.tag_name, url: asset.browser_download_url, filename: asset.name };
  }
  return null;
}

/**
 * Pure: is this GitHub release something other than a finished build? Yes
 * when GitHub has it flagged as a pre-release or a draft, or when its tag or
 * title says alpha / beta / rc / pre / snapshot ("0.4.1-beta.1", "v1.0-rc2",
 * "Sodium 0.7 Alpha"). The performance pack goes into every instance without
 * the player asking, so an unfinished build must never be what it installs.
 * The Minecraft version is taken out of the text first: on a "1.21-pre1"
 * instance the "pre" belongs to the game, not to the mod.
 */
function isPreRelease(release, mcVersion = null) {
  if (!release) return false;
  if (release.prerelease === true || release.draft === true) return true;
  const mc = String(mcVersion || "");
  const strip = (text) => (mc ? String(text || "").split(mc).join(" ") : String(text || ""));
  const marked = /(?<![a-z])(?:alpha|beta|rc|pre|pre-?release|preview|snapshot)(?![a-z])/i;
  return marked.test(strip(release.tag_name)) || marked.test(strip(release.name));
}

/**
 * Pure: does this GitHub release reference mcVersion? Checked in three
 * places, in order of how much they should be trusted: the tag (e.g.
 * "mc26.1.2-0.9.2" contains "26.1.2"), the release name/title, and - some
 * projects (ScalableLux confirmed: tags and names are bare mod versions
 * like "0.2.1", the Minecraft version only ever appears in the changelog
 * text, e.g. "ScalableLux 0.2.1 for Minecraft 26.2 is released") - the
 * release body. The body is prose, not a version field, so it is read
 * last and strictly: only a phrase that plainly states the target counts
 * ("for Minecraft 26.2", "Minecraft 26.2", "MC 26.2", "mc26.2", "26.2
 * release") - a changelog that merely mentions the number ("fixes a crash
 * seen since 26.2") doesn't - and never when the tag or name already names
 * a different Minecraft version. A wrong pick here downloads the wrong
 * file; downloadPerformanceMods then catches it, but it shouldn't get that
 * far.
 */
function releaseMatchesVersion(release, mcVersion) {
  const tag = release.tag_name || "";
  const name = release.name || "";
  const body = release.body || "";
  // Whole-version match, not a substring: "1.21.1" is inside "1.21.10" and
  // "1.20" is inside "1.20.4", and a build for the wrong Minecraft version
  // stops the game loading. The version must not continue on either side -
  // no digit (or "digit.") before it, no digit or ".digit" after it. So
  // "mc1.21.1-0.6.0" and "0.6.0+1.21.1" match 1.21.1; "1.21.10" doesn't.
  const whole = wholeVersionPattern(mcVersion);
  if (!whole) return false;
  const re = new RegExp(whole);
  if (re.test(tag) || re.test(name)) return true;
  if (namesMinecraftVersion(tag) || namesMinecraftVersion(name)) return false; // it says which version, and it isn't ours
  const stated = new RegExp(`(?:\\bminecraft\\s+|(?<![a-z])mc[\\s-]?)${whole}|${whole}\\s+release\\b`, "i");
  return stated.test(body);
}

/** Pure: regex source matching mcVersion as a whole version, not part of a longer one. */
function wholeVersionPattern(mcVersion) {
  const escaped = String(mcVersion || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escaped ? `(?<!\\d)(?<!\\d\\.)${escaped}(?!\\d)(?!\\.\\d)` : "";
}

/**
 * Pure: does a release tag or title say which Minecraft version it is for?
 * "mc1.21.1-0.6.0", "0.6.0+1.21.1", "Sodium 0.6 for Minecraft 1.21.1",
 * "Sodium 0.6 for 1.21.1" do; a bare mod version ("0.2.1", "v0.9.2") doesn't.
 */
function namesMinecraftVersion(text) {
  return /(?:(?<![a-z])mc[\s-]?|\bminecraft\s+|\bfor\s+|\+)\d+(?:\.\d+)+/i.test(String(text || ""));
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
 *
 * Some releases attach one fabric jar per Minecraft version. When there is
 * more than one fabric-named jar and `mcVersion` is given, the ones whose
 * name carries that version (whole, not as part of a longer one) win.
 */
function pickJarAsset(assets, mcVersion = null) {
  const candidates = (assets || []).filter(
    (a) => a.name.endsWith(".jar") && !/sources|javadoc|neoforge|forge|quilt/i.test(a.name)
  );
  if (!candidates.length) return null;
  const fabricNamed = candidates.filter((a) => /fabric/i.test(a.name));
  let pool = fabricNamed.length ? fabricNamed : candidates;
  const whole = wholeVersionPattern(mcVersion);
  if (whole && fabricNamed.length > 1) {
    const re = new RegExp(whole);
    const forVersion = fabricNamed.filter((a) => re.test(a.name));
    if (forVersion.length) pool = forVersion;
  }
  return pool.reduce((biggest, a) => (a.size > biggest.size ? a : biggest), pool[0]);
}

function versionFromJarName(filename, prefix = "reminthhud-") {
  const lower = String(filename).toLowerCase();
  if (!lower.startsWith(prefix) || !lower.endsWith(".jar") || lower.length <= prefix.length + 4) return "unknown";
  return filename.slice(prefix.length, -4);
}

module.exports = {
  ensureInstalled,
  launch,
  latestFabricLoader,
  downloadFabricApi,
  pickFabricApiRelease,
  vanillaProfile,
  hasFeature,
  supportsWorldJoin,
  reminthHudSupports,
  mcRangeAccepts,
  bundledReminthHudBuilds,
  findReminthHudFor,
  bundledModBuilds,
  findBundledModFor,
  bundledModsFor,
  installBundledMods,
  bundledModsToDrop,
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
  defaultMaxMemoryMb,
  buildJvmFlags,
  planSafeModeRetry,
  windowsBuildNumber,
  wantsAboveNormalPriority,
  SAFE_MODE_WINDOW_MS,
  JVM_REFUSAL_MARKERS,
  splitArgs,
  substituteTokens,
  releaseMatchesVersion,
  isPreRelease,
  pickJarAsset,
  containedPath,
  assertDownloadUrl,
  planStepAside,
  planOwnCopies,
  stepAsideLine,
  // exported for test/fixes-launch.test.js - these do file I/O
  stepAsideForPlayerMods,
  planHoldBack,
  holdBackForPlayerMods,
  removeMisfitManagedMods,
  findPlayerCopies,
  downloadPerformanceMods,
  // the performance pack from Modrinth (see test/perf-pack.test.js)
  downloadPerformancePack,
  performancePackStatus,
  resetPerformancePack,
  recordPackRun,
  lookupPackReleases,
  planPackSkips,
  findPackSkips,
  pickPackRelease,
  packReleaseFrom,
  readManagedMods,
  PACK_SOAK_MS,
  tidyManagedMods,
  managedModFromName,
  managedModLabel,
  adoptLegacyManagedMods,
  fetchLatestGithubAssetForVersion,
  extractNatives,
  downloadAssets,
  installBundledJar,
};
