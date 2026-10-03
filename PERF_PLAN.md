# Reminth performance plan

Research date: 2026-10-02. Repo read: `/home/claude/work/r` (read-only, version 1.1.1). Nothing in the repo was changed.

How to read the evidence labels in this document:

- **[V-code]** read in Reminth's source, with file:line.
- **[V-api]** fetched today from a primary machine-readable source (Mojang `piston-meta`, Modrinth API v2). The page was summarised by a small model on the way to me, so individual version strings could have a typo, but the fact pattern (release vs alpha, which loaders) was cross-checked across several calls.
- **[V-run]** I ran it here (OpenJDK 21.0.10 on Linux; not Windows, not JDK 25, not the game).
- **[V-web]** read today on a secondary page (wiki, guide, vendor doc). URL given.
- **[M]** from memory, not re-verified today. Treat as a hypothesis.
- **[NOT VERIFIED]** cannot be known without running the game and measuring frame times on real hardware. Nobody in this research measured FPS. Every "expected benefit" below is a prediction until someone captures frame-time data.

---

## 0. The five findings that matter most

1. **Reminth is behind Mojang's own launcher on JVM flags for 26.x.** Since 26.1, Mojang's version JSON carries an `arguments["default-user-jvm"]` block: `-Xms2G -Xmx4G -XX:+UseCompactObjectHeaders -XX:+AlwaysPreTouch -XX:+UseStringDeduplication` plus `-XX:+UseZGC` on Windows 10 build 17134 or newer (G1 with `MaxGCPauseMillis=50` on older Windows) [V-api]. Reminth ignores that block and passes an Aikar-style *server* G1 set with `MaxGCPauseMillis=200` to every Minecraft version [V-code `minecraft.js:484-502`]. A 200 ms pause target is twelve dropped frames at 60 fps.
2. **A player who types `-XX:+UseZGC` into "extra JVM arguments" today gets a game that will not start.** Reminth always passes `-XX:+UseG1GC`; two collectors abort the JVM with "Multiple garbage collectors selected" [V-run on JDK 21], and `-XX:+IgnoreUnrecognizedVMOptions` does not rescue it [V-run].
3. **The "all stable" claim in `config.js` is no longer true.** On Modrinth, ScalableLux for 26.3 has only alpha builds, and for 26.2 the newest builds are alpha (0.3.0-alpha.x) with one older release (0.2.1) [V-api]. Reminth's GitHub lookup has no pre-release filter [V-code `minecraft.js:1857-1873`], so which one a player gets depends on what GitHub lists first. Same exposure for Sodium: 26.3 has release 0.9.2 and a newer 0.9.3-alpha.1 [V-api].
4. **The pack is three mods; the benchmark packs ship 12-16 performance mods.** FerriteCore, ImmediatelyFast, Entity Culling, ModernFix, Dynamic FPS, BadOptimizations and Ixeris all have *release* builds for 26.3 on Modrinth [V-api] and none change gameplay. Switching the source to Modrinth (which Reminth already talks to) fixes finding 3 and unlocks these.
5. **C2ME is still alpha on every Minecraft version** (1.21.1, 1.21.11, 26.1.2, 26.2, 26.3; one beta for 26.1.2) [V-api]. The decision recorded in `config.js` to pull it was right and should stand. Simply Optimized, Adrenaline and Additive ship it anyway; Fabulously Optimized ships neither C2ME nor ScalableLux [V-api].

---

## PART 1 — What Reminth does today

### 1.1 JVM arguments

Built in `launch()`, `src/main/minecraft.js:425-590`.

| What | Value | Where |
|---|---|---|
| Heap max | `-Xmx{maxMemoryMb}M` | `minecraft.js:485` |
| Heap min | `-Xms{maxMemoryMb}M` (equal to max, deliberately) | `minecraft.js:486`, rationale comment `:473-480` |
| Collector | `-XX:+UseG1GC` | `:487` |
| | `-XX:+ParallelRefProcEnabled` | `:488` |
| | `-XX:MaxGCPauseMillis=200` | `:489` |
| | `-XX:+UnlockExperimentalVMOptions` | `:490` |
| | `-XX:G1NewSizePercent=20` | `:491` |
| | `-XX:G1ReservePercent=20` | `:492` |
| | `-XX:G1HeapRegionSize=32M` | `:493` |
| | `-XX:G1MixedGCCountTarget=4` | `:494` |
| | `-XX:InitiatingHeapOccupancyPercent=15` | `:495` |
| | `-XX:G1MixedGCLiveThresholdPercent=90` | `:496` |
| | `-XX:SurvivorRatio=32` | `:497` |
| Security | `-Dlog4j2.formatMsgNoLookups=true` | `:501` |
| Logging config | Mojang's per-version log4j argument | `:519`, `prepareLoggingConfig` `:608-622` |
| Version's own JVM args | `profile.arguments.jvm` resolved through `resolveArguments` (this is where Mojang's `-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump`, `-XX:StackShadowPages=32`, `--enable-native-access` etc. come from) | `:506-507`, `:833-848` |
| Pre-1.13 | `-Djava.library.path=… -cp …` | `:511` |
| User's extra args | appended last, split by `splitArgs` | `:522`, `:627-654` |

Order on the command line: Reminth's base set, logging, the version's own args, then the user's. The same flag set is passed to every Java version (8, 16, 17, 21, 25). There is no version gating and no `-XX:+IgnoreUnrecognizedVMOptions`.

Not passed at all: ZGC, Shenandoah, `AlwaysPreTouch`, `UseStringDeduplication`, `UseCompactObjectHeaders`, `DisableExplicitGC`, `PerfDisableSharedMem`, large pages, any CDS/AOT flag.

`arguments["default-user-jvm"]` is never read. `mergeProfiles` (`:671-690`), `mergeLoaderProfile` (`:700`) and `vanillaProfile` (`:724`) copy only `game` and `jvm`.

A trap for whoever implements this: `osMatchesThisMachine` (`:760-766`) checks `os.name` and `os.arch` but ignores `os.versionRange`. If `default-user-jvm` were fed through the existing `resolveArguments`, both the ZGC entry (`versionRange.min 10.0.17134`) and the G1 entry (`versionRange.max 10.0.17134`) would match on Windows, and the JVM would abort with two collectors.

### 1.2 Memory

- `computeDefaultMaxMemoryMb(totalMemBytes)`: half of physical RAM, clamped to 2048-6144 MB. `minecraft.js:661-664`.
- Precedence inside `launch`: `settings.maxMemoryMb || config.MAX_MEMORY_MB || computed` (`:468`). `config.MAX_MEMORY_MB` is the `REMINTH_MAX_MEMORY_MB` env override, null by default (`config.js:78-80`).
- Before `launch` is called, `main.js:849-851` clamps to `entitlements.ramCapMb()`.
- `ramCapMb`: total RAM minus 2048 MB reserved, floored to 512 MB steps, min 1024, max 16384 (`entitlements.js:14-34`). RAM is not a paid perk.
- Setting: `maxMemoryMb: null` = auto (`store.js:157`), sanitised to 512-65536 (`store.js:245`).
- `-Xmx`/`-Xms` in the extra-args box are rejected (`store.js:270-272`).

Resulting defaults: 8 GB PC gets 4 GB, 12 GB gets 6 GB, 16 GB and up gets 6 GB, all with `-Xms` equal to `-Xmx`.

### 1.3 Extra JVM args and the denylist

`store.js:167` (default empty), `:266-281` (sanitise: 1024-char cap, memory flags rejected, denylist). `DANGEROUS_JVM_FLAGS` at `store.js:214-221`: `-javaagent`, `-agentpath`, `-agentlib`, `-Xbootclasspath`, `-XX:On…Error=`, `@argfile`. No check for a conflicting collector.

### 1.4 Which Java

`src/main/java.js`. `ensureRuntime(vanilla.javaVersion)` is called from `minecraft.js:103`.

1. Legacy JDK 25 at `paths.JAVA_DIR`, if present and the version wants Java 25 (`java.js:56-57`).
2. Mojang's own runtime for the version's `javaVersion.component` (`jre-legacy`, `java-runtime-gamma`, `-delta`, `-epsilon`…), downloaded file-by-file with sha1 from Mojang's manifest, pinned to `*.mojang.com` (`java.js:60-65`, `:98-146`, `:149-154`).
3. Fallback: Microsoft OpenJDK zip for majors 11/17/21/25, no checksum (`java.js:31`, `:67-71`, `:164-221`).

Major version defaults to 8 when a version JSON has no `javaVersion` (`java.js:42-45`). The major is not returned to `launch`; `ensureInstalled` returns only `javaPath` (`minecraft.js:265-277`).

Verified today from Mojang's JSON [V-api]: 26.1 and 26.3 want `java-runtime-epsilon`, major 25. 1.21.11 wants `java-runtime-delta`, major 21.

### 1.5 Process priority, GPU, window

- Priority: never set. `spawn(javawPath, …, { cwd, detached: true, stdio })` at `minecraft.js:546-550`, then `child.unref()` (`:587`). No `os.setPriority`, no `wmic`/PowerShell anywhere in `src/` (grep).
- GPU: nothing. No registry write, no `UserGpuPreferences`, no `NvOptimusEnablement`. The only GPU-adjacent thing is Mojang's own `HeapDumpPath=MojangTricksIntelDrivers…` argument arriving via the version JSON, and `hardwareAcceleration` in settings, which is for the Electron window only (`main.js:43`).
- Window: `--fullscreen`, or `--width/--height` when both are set (`minecraft.js:529-533`); settings at `store.js:162-164`.

### 1.6 options.txt

Reminth never writes `options.txt`. The only references: the game-dir comment (`paths.js:21`), folder recognition (`instances.js:226`), and copying it when an instance is duplicated to a new version (`migrate.js:23`, `CARRY_FILES`). New instances start with whatever Minecraft generates. No `config/sodium-options.json` either.

### 1.7 The performance pack

- List: `config.js:48-73`. Sodium (`CaffeineMC/sodium`), Lithium (`CaffeineMC/lithium`), ScalableLux (`RelativityMC/ScalableLux`). C2ME removed after a hard hang on "Preparing world" with 0.4.1-beta.1 (comment `:55-65`). FerriteCore removed because it has no GitHub Releases (`:66-73`).
- Who gets it: Fabric and Quilt instances only, on unless `instance.performanceMods === false` (`minecraft.js:154-157`). Forge/NeoForge/vanilla get nothing. The create dialog shows the switch only for Fabric/Quilt (`renderer.js:1174`).
- Modpack instances get it too: `mrpack.js:163` calls `instances.create` without `performanceMods`, so it defaults on, layered over the pack's own mods.
- Source: GitHub Releases API, 30 newest releases, first one whose tag/name/body names the Minecraft version (`minecraft.js:1857-1873`, `releaseMatchesVersion` `:1893-1909`, `pickJarAsset` `:1942-1956`). **No `release.prerelease` check.** No checksum (`:1708-1710`). Unauthenticated limit 60 requests/hour per IP, softened by a 6-hour disk cache (`:1820-1845`).
- Safety that exists and should be kept: jar self-check after download (`verifyDownloadedJar` `:1537`, `compat.jarFitsInstance` `compat.js:1161-1179`); stepping aside for the player's own copies (`planStepAside` `:1418`, `stepAsideForPlayerMods` `:1475`); ownership ledger `.reminth/managed-mods.json` (`:1187-1210`); cleanup on opt-out (`tidyManagedMods` `:1581`); a readable log `reminth-performance-mods.log` (`:1549`, `:1751`).
- Fabric API is fetched from Fabric's Maven whenever the HUD or the pack is on (`:193-213`, `downloadFabricApi` `:1155`).

### 1.8 Modrinth installer already in the codebase

- `content.install(instance, { projectId, kind, world, versionId }, onProgress)` at `content.js:1176-1222`; accepts id or slug; resolves required dependencies through `createInstaller` (`:928`).
- Loader mapping `loadersFor` (`content.js:881-894`): Fabric → fabric; Quilt → quilt+fabric; Forge → forge; NeoForge → neoforge (plus forge on 1.20.1).
- `pickVersion` (`content.js:902-905`) prefers a `release` but **falls back to the newest build of any type**. Fine for a player clicking Install; wrong for a silent default.
- Hash-verified download: `downloadVerified(url, dest, sha1)` (`content.js:720`).
- API client with retry and rate-limit handling: `modrinth.js` (`getProjectVersions` `:337`, `getVersionsFromHashes` `:373`, `checkForUpdates` `:358`).

---

## PART 2 — Research

### 2a. JVM flags for the client

#### What Mojang ships (the strongest evidence available)

From `piston-meta.mojang.com/v1/packages/…/26.3.json` and `…/26.1.json` [V-api]:

```json
"default-user-jvm": [
  {"value": ["-Xms2G","-Xmx4G","-XX:+UseCompactObjectHeaders","-XX:+AlwaysPreTouch","-XX:+UseStringDeduplication"]},
  {"rules":[{"action":"allow","os":{"name":"osx"}},{"action":"allow","os":{"name":"linux"}},
            {"action":"allow","os":{"name":"windows","versionRange":{"min":"10.0.17134"}}}],
   "value":["-XX:+UseZGC"]},
  {"rules":[{"action":"allow","os":{"name":"windows","versionRange":{"max":"10.0.17134"}}}],
   "value":["-XX:+UnlockExperimentalVMOptions","-XX:+UseG1GC","-XX:G1NewSizePercent=20",
            "-XX:G1ReservePercent=20","-XX:MaxGCPauseMillis=50","-XX:G1HeapRegionSize=32M"]}
]
```

1.21.11 (Java 21) has no such block [V-api]. For Java 21 and older the official launcher's long-standing default was `-Xmx2G -XX:+UnlockExperimentalVMOptions -XX:+UseG1GC -XX:G1NewSizePercent=20 -XX:G1ReservePercent=20 -XX:MaxGCPauseMillis=50 -XX:G1HeapRegionSize=32M` [M]; the 26.x fallback branch above is the same set, which supports the memory.

So: Mojang moved the client to ZGC with compact object headers at 26.1, with a 2 GB initial and 4 GB maximum heap, and kept its G1 set only for Windows older than 10 version 1803.

26.1 requires Java 25 and bundles the Microsoft build of OpenJDK 25 [V-web https://minecraft.wiki/w/Java_Edition_26.1-snapshot-1].

#### Java requirements by Minecraft version

| Minecraft | Java | Source |
|---|---|---|
| 1.16.5 and older | 8 | [M]; `java.js` header agrees |
| 1.17 | 16 | [M] |
| 1.18 - 1.20.4 | 17 | [M] |
| 1.20.5 - 1.21.11 | 21 | 1.21.11 [V-api]; boundary [V-web Obydux] |
| 26.1 - 26.3 | 25 | [V-api] |

Reminth reads this per version from Mojang's JSON, which is the right way; the table is only for flag gating.

#### Flag by flag

| Flag | Exists in | Verdict for a client | Evidence |
|---|---|---|---|
| `-XX:+UseZGC` | 15+ (production). Generational: opt-in 21-22 with `-XX:+ZGenerational`, default in 23 (JEP 474), only mode in 24+ (JEP 490) | **Default on Java 25** (follow Mojang). Opt-in on Java 21. Never on 17 (non-generational ZGC costs FPS) | Mojang JSON [V-api]; JEP list [V-web https://openjdk.org/projects/jdk/25/jeps-since-jdk-21]; flags guide says non-generational has "a significant client FPS hit", generational "runs well on clients" [V-web https://github.com/Mukul1127/Minecraft-Performance-Flags-Benchmarks] |
| `-XX:+ZGenerational` | 21-23 meaningful; deprecated 23; ignored/obsolete later | Pass only on 21 and 22 | Accepted on 21 [V-run]; removal [V-web JEP 490] |
| `-XX:+UseCompactObjectHeaders` | Experimental 24, product 25 (JEP 519) | **Default on Java 25** | Mojang [V-api]. Unknown on 21: aborts launch [V-run] |
| `-XX:+AlwaysPreTouch` | all | On Java 25 with Mojang's `Xms` shape. Costs startup time and commits RAM up front, so do not combine with a large `-Xms` on small machines | Mojang [V-api] |
| `-XX:+UseStringDeduplication` | G1 8u20+; ZGC 18+ | On for Java 25 (Mojang). Harmless on G1 17/21; small memory win | Mojang [V-api]; accepted with ZGC on 21 [V-run] |
| `-XX:+ParallelRefProcEnabled` | all | Keep on Java 8-16. Redundant on 17+ (already the default for G1) [M] | |
| `-XX:MaxGCPauseMillis` | G1 | **50, not 200.** 200 is Aikar's server value | Mojang uses 50 [V-api]; client guide uses 37 [V-web Mukul1127] |
| `-XX:G1NewSizePercent=20`, `G1ReservePercent=20`, `G1HeapRegionSize=32M` | G1, experimental-unlocked | Keep (Mojang's set). `UnlockExperimentalVMOptions` must come first or the JVM aborts [V-run] | |
| `G1MixedGCCountTarget=4`, `InitiatingHeapOccupancyPercent=15`, `G1MixedGCLiveThresholdPercent=90`, `SurvivorRatio=32` | G1 | Drop from the default. They are Aikar server tuning; I found no client frame-time measurement supporting them, and Mojang does not use them | Absence of evidence, not proof of harm [NOT VERIFIED] |
| `-XX:+DisableExplicitGC` | all | **Do not pass.** LWJGL/NIO direct buffers rely on an explicit GC when direct memory runs out; disabling it can turn a recoverable situation into an out-of-memory crash [M] | |
| `-XX:+PerfDisableSharedMem` | all | Optional, negligible on Windows. Skip | [M] |
| `-XX:+UseLargePages` | all | **Do not pass.** Windows needs the "Lock pages in memory" privilege and, per the flags guide, running Java and the launcher as administrator [V-web Mukul1127]. Without it the JVM prints a warning and carries on [V-run on Linux], so it is not dangerous, just useless | |
| `-XX:+UseTransparentHugePages` | Linux only | Not applicable; unknown-flag abort on Windows unless ignored | |
| `-XX:+UseShenandoahGC` | Not in Oracle builds; present in Microsoft/Temurin builds. Generational mode is experimental in 21-24, product in 25 (JEP 521). `-XX:ShenandoahGCMode=generational` is rejected by OpenJDK 21.0.10 [V-run] | Do not ship. Whether Mojang's runtime even contains Shenandoah is unverified; nothing suggests it beats generational ZGC | |
| CDS / AppCDS / AOT cache (JEP 483, JDK 24+) | default CDS archive is already used for JDK classes | Skip. Mod loaders load and transform game classes through their own class loaders, which these archives do not cover [M]; a stale archive is a new failure mode | [NOT VERIFIED] |
| `-XX:+IgnoreUnrecognizedVMOptions` | all supported versions | **Pass it as a seatbelt**, and still gate flags by version. It turns an unknown `-XX` flag into a no-op [V-run]. It does not fix conflicting collectors [V-run] or bad values. Cost: a typo in the player's own extra args is silently ignored instead of reported | |
| `-Xms` = `-Xmx` | | Not for the ZGC path (Mojang uses 2G/4G; ZGC grows and shrinks the heap concurrently). Defensible for G1 on machines with RAM to spare | Mojang [V-api]; guide recommends equal values except on low-memory systems [V-web Mukul1127] |

ZGC caveats that drive the gating below:

- ZGC does not use compressed object pointers (`UseCompressedOops=false` under ZGC, `true` under G1 at 2 GB [V-run]). The same game needs more heap. Compact object headers offset part of that.
- ZGC needs headroom: it collects while the game allocates. On a small heap it can stall allocation, which is a frame hitch. Mojang pairs it with a 4 GB maximum.
- ZGC's work is concurrent and uses CPU threads that chunk meshing also wants. One guide warns it "can be demanding" on older CPUs [V-web https://cleanroommc.com/wiki/end-user-guide/args].
- Windows 10 version 1803 (build 17134) or newer is required; Mojang encodes exactly this rule [V-api].

Which collector gives the fewest spikes at 4-8 GB on a client: Mojang's choice for Java 25 is ZGC. The only numbers I found are server-side (Paper 1.21.4, Java 21, 200 players: p99 pause 145 ms for G1 at 8 GB against 0.9 ms for ZGC at 16 GB [V-web https://mineguard.pro/en/blog/zgc-vs-g1gc-minecraft-java-21-benchmark]); that is a hosting company's blog, different heap sizes, not a client. I found no published client frame-time comparison on Java 25. [NOT VERIFIED]

#### What other launchers and guides do

| Who | What | Status |
|---|---|---|
| Mojang launcher, 26.x | ZGC + compact headers + pre-touch + string dedup, 2G/4G | [V-api] |
| Prism Launcher | No default tuning flags documented; "4GB of ram allocated should be more than enough", "more RAM allocated doesn't mean better performance"; auto-downloads Mojang's Java | [V-web https://prismlauncher.org/wiki/help-pages/java-settings] |
| Modrinth App | Uses per-version Java; I did not find its default flags documented | [NOT VERIFIED] |
| ATLauncher, Lunar, Badlion, Feather | Could not verify their defaults today. Lunar ships its own JRE [M] | [NOT VERIFIED] |
| "Minecraft Performance Flags Benchmarks" (brucethemoose, mirrored) | Client G1 set with `MaxGCPauseMillis=37`, `G1HeapRegionSize=16M`, `G1NewSizePercent=23`…; recommends G1 or Shenandoah for clients on Java 17/21, GraalVM or Adoptium 21; written for Java 17/21 and predates Java 25 | [V-web https://github.com/Mukul1127/Minecraft-Performance-Flags-Benchmarks] |
| Obydux "Minecraft startup flags" | Java 25+: `-Xms=-Xmx -XX:+UseZGC -XX:+UseStringDeduplication -XX:+UseCompactObjectHeaders -XX:+AlwaysPreTouch -XX:TrimNativeHeapInterval=5000`; add `-XX:+ZGenerational` on 21-22 | [V-web https://github.com/Obydux/Minecraft-startup-flags] |
| Cleanroom wiki | `-XX:+UseCompactObjectHeaders -XX:+UseZGC` on Java 25, with a warning to test on older CPUs | [V-web] |
| Meowice flags, "noflags", CaffeineMC wiki, Fabulously Optimized docs on JVM flags | Not fetched today. From memory, CaffeineMC and FO both tell users not to add custom flags and not to over-allocate RAM | [M] |

The picture is consistent: on Java 25 the community and Mojang have converged on ZGC with compact headers; on Java 17/21 the conservative answer is still G1 with a short pause target.

### 2b. Mods

All rows [V-api] from `api.modrinth.com/v2` today unless marked. "26.3 status" is the newest build for Minecraft 26.3.

#### Core set (no gameplay or visual change)

| Mod | Slug | Side | Loaders with 26.3 build | 26.3 status | Depends on | Notes |
|---|---|---|---|---|---|---|
| Sodium | `sodium` | client | fabric, neoforge | release `mc26.3-0.9.2`; newer `0.9.3-alpha.1` exists | none | 1.21.1: release for fabric+neoforge. 1.20.1: release, fabric/quilt only. No 1.16.5 build returned. 0.9.x has "early support for Vulkan"; Minecraft's default backend is OpenGL again since 26.2-snapshot-8 [V-web https://feedback.minecraft.net/hc/en-us/articles/45976772290701] |
| Lithium | `lithium` | both, optional | fabric+quilt, neoforge | release 0.26.2 | none | Helps the integrated server (singleplayer). No effect on a remote server's tick rate |
| FerriteCore | `ferrite-core` | both, optional | fabric, neoforge | release 9.0.0 (covers 26.1-26.3) | none | Memory reduction; less heap pressure means fewer collections |
| ImmediatelyFast | `immediatelyfast` | client | fabric+quilt, neoforge | release 1.17.0 | none | Batches HUD/text/entity immediate-mode rendering |
| Entity Culling | `entityculling` | client | fabric, neoforge | release 1.11.2 | Fabric API (fabric) | Skips entities and block entities hidden behind walls. Three releases in three days in September; stable but fast-moving |
| ModernFix | Fabric: `modernfix-mvus`; NeoForge: `modernfix` | both, optional | fabric (fork), neoforge (official) | release on both | | Official ModernFix "will no longer release Fabric builds"; the mVUS fork fills the gap and is what FO, Simply Optimized, Adrenaline and Additive ship. Third-party fork: see risk note in Part 3 |
| Dynamic FPS | `dynamic-fps` | client | fabric+quilt, neoforge | release 3.11.10 | Fabric API | Throttles when unfocused/idle. Does nothing for in-game FPS; saves heat and battery |
| BadOptimizations | `badoptimizations` | client | fabric, neoforge | release 2.4.1 | none | Micro-optimisations. In Simply Optimized; not in FO |
| Ixeris | `ixeris` | client | fabric+quilt, neoforge | release 4.6.8 | none | Moves input polling off the render thread; its page claims large gains with 8000 Hz mice. Touches threading around GLFW, so it is the riskiest of this group. In FO 14.1.0/15 alpha, Adrenaline, Additive |

#### Conditional (stable on some versions only)

| Mod | Slug | 26.3 | 26.2 | Verdict |
|---|---|---|---|---|
| ScalableLux | `scalablelux` | **alpha only** (fabric, neoforge) | release 0.2.1 (June), then alphas 0.3.0-alpha.x | Ship only when a `release` exists for the exact version. Supports 1.21-1.21.11 and 26.x. Lighting engine swap; no light-data format change mentioned on its page. Benefits the integrated server and world generation most |
| More Culling | `moreculling` | **beta** 1.9.0-beta.1 | not checked | Release-only rule excludes it on 26.3. Requires Cloth Config |
| Better Block Entities | `better-block-entities` | release 1.3.9, fabric, requires Sodium | | Replaces Enhanced Block Entities (`ebe` stopped at 1.21.4). **Changes how chests, signs, beds are drawn** (baked models instead of animated block entities) → visual change → opt-in only |
| Krypton | `krypton` | **no build** | release 0.3.1 | Network stack. Fabric only. Client benefit is marginal; skip as a default |

#### High render distance (all opt-in)

| Mod | Slug | Status | What it does | Why not default |
|---|---|---|---|---|
| Distant Horizons | `distanthorizons` | release 3.3.4 for 26.3, fabric + neoforge, no dependencies | Renders simplified LOD terrain beyond the real render distance | Obvious visual change; generating LODs uses CPU and disk; on servers it only shows terrain you have already seen unless the server supports it |
| Bobby | `bobby` | release, fabric only, newest is for 26.2; **no 26.3 build** | Caches chunks from servers on disk and keeps showing them beyond the server's view distance | Writes a cache under `.bobby`; a visual change; multiplayer-only use |
| Voxy | `voxy` | **beta only** (0.2.19-beta for 26.2), fabric, requires Sodium; no 26.3 | LOD renderer | Beta |
| Nvidium | `nvidium` | **beta only** (0.4.4-beta7 for 26.3), fabric, requires Sodium | Mesh-shader terrain renderer for NVIDIA cards | Beta, NVIDIA GTX 16xx/RTX only, historically incompatible with shaders [M] |
| C2ME | `c2me-fabric` | **alpha only** on 1.21.1, 1.21.11, 26.1.2, 26.2, 26.3; one beta for 26.1.2 | Parallel chunk generation and I/O on the integrated server | Alpha everywhere. Its own page says to back up worlds and that worlds "will vary significantly run-to-run even with the same seed". Server-side "required", so it does nothing when playing on someone else's server |

#### Obsolete or unsuitable

| Mod | Finding |
|---|---|
| Starlight (`starlight`) | Last build 1.20.4, December 2023. Unmaintained since March 2024. Replaced by ScalableLux |
| LazyDFU (`lazydfu`) | Last build June 2022, lists up to 1.20.6. Obsolete; Mojang made DFU lazy in 1.19.4 [M] |
| Memory Leak Fix (`memoryleakfix`) | Last build January 2024, up to 1.20.4. Obsolete on current versions |
| Noisium (`noisium`) | Last build 1.21.6, June 2025. Abandoned. Packs now use Fast Noise (`zfastnoise`), which I did not evaluate |
| Enhanced Block Entities (`ebe`) | Last build 1.21.4. Superseded by Better Block Entities |
| ThreadTweak (`threadtweak`) | Newest covers 1.21.9-1.21.11; nothing for 26.x |
| VulkanMod (`vulkanmod`) | Release for 1.21.11 and 26.1.x only; replaces the renderer wholesale and conflicts with Sodium/Iris [M]. Vanilla now has its own experimental Vulkan backend (`preferredGraphicsBackend` in options.txt [V-web https://minecraft.wiki/w/Options.txt]). Do not ship |
| Debugify (`debugify`) | Has a 26.3 build; it is a bug-fix collection, not a performance mod. Some fixes alter behaviour. Skip |
| Very Many Players, ServerCore, Structure Layout Optimizer, Let Me Despawn, Alternate Current | Server-side. ServerCore and Let Me Despawn change gameplay (activation ranges, despawning). Not for a client launcher default |
| Embeddium (`embeddium`) | Last updated January 2025; versions 1.16.5-1.21.4; Forge/NeoForge. Still the only Sodium-family renderer for **Forge 1.20.1**. On NeoForge 1.21.1+ use official Sodium |
| Radium (`radium`) | Lithium fork for Forge/NeoForge; 1.20-1.21.1; last updated September 2024. Only relevant for Forge 1.20.1 |
| Canary (`canary`) | Lithium fork for Forge; 1.18.2-1.20.4; last updated February 2024. Stale; prefer Radium on 1.20.1 |

#### What the benchmark packs ship [V-api]

Performance mods only; libraries and cosmetic mods left out.

| Pack | Version checked | Sodium | Lithium | FerriteCore | ImmediatelyFast | Entity Culling | More Culling | ModernFix-mVUS | Dynamic FPS | BBE | Ixeris | BadOpt | ScalableLux | C2ME | Krypton | Other |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Fabulously Optimized | 14.1.0 for 26.2, release, 2026-09-13 (15.0.0 for 26.3 is alpha.4) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – | – | Sodium Extra, Reese's Sodium Options, FastQuit, Remove Reloading Screen, Debugify, No Chat Reports |
| Simply Optimized | 1.21.11-3.1.2, release, 2026-02-03 (nothing newer) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | ✓ | ✓ | ✓ | – | Fast Noise, VMP, ServerCore, No Chat Reports |
| Adrenaline | 26.4.2 for 26.2, release, 2026-07-28 | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | Fast Noise, VMP, ServerCore, Particle Core, Cull Fewer Leaves, Async Logger, Structure Layout Optimizer |
| Additive | 26.5.1 for 26.2, release, 2026-10-01 (26.3 build is alpha) | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | Adrenaline's set plus cosmetics (Iris, Continuity, zoom…) |

Caveat: dependency ids were matched to names by me; three ids in the Adrenaline list were not resolved. The ✓ columns are the ones I resolved.

Reading: the common core of all four is Sodium, Lithium, FerriteCore, ImmediatelyFast, Entity Culling and ModernFix-mVUS. Three of four ship ScalableLux and C2ME as alphas; FO, the most conservative and most downloaded, ships neither. Reminth's stated rule ("no unstable builds as silent defaults") puts it on FO's side of that line.

### 2c. Chunk-loading stutter at high render distance

Mechanisms, mostly [M] with the options facts [V-web https://minecraft.wiki/w/Options.txt]:

1. **Chunk meshing.** Each newly arrived or changed chunk section is turned into geometry on worker threads, then uploaded to the GPU on the render thread. Vanilla uploads in bursts; Sodium meshes faster, uses more threads and budgets uploads per frame. Sodium is the single biggest lever. A community guide says Sodium's Advanced options "should be left at default in almost every scenario" [V-web https://github-wiki-see.page/m/pajicadvance/sodium-fabric/wiki/Sodium-video-settings]. Do not write `sodium-options.json`.
2. **`prioritizeChunkUpdates`** (vanilla "Chunk Builder"): 0 = Threaded (default), 1 = Semi Blocking, 2 = Fully Blocking. Threaded is the smooth one; the others trade hitches for fewer visual holes when blocks change. Leave at 0.
3. **Lighting** on the integrated server when chunks are generated or first lit. This is what Starlight/ScalableLux speed up. Mojang's own light engine was rewritten in 1.20, so the gap is smaller than it was in 1.17-1.19 [M]. The comment in `config.js:51-53` saying ScalableLux is "the one that actually kills" the stutter overstates it for multiplayer, where the server does the lighting.
4. **World generation and chunk I/O** on the integrated server (singleplayer only). Lithium helps a little; C2ME helps a lot and is alpha.
5. **Garbage collection.** Chunk loading allocates heavily. A stop-the-world G1 pause shows up as a hitch; this is the part JVM flags can actually change.
6. **Simulation distance.** Every chunk inside it ticks entities, block entities and random ticks on the integrated server. Default 12. Lowering it frees server-thread time, which on a busy singleplayer world reduces rubber-banding and tick lag, not render FPS. It changes gameplay: farms and mobs beyond it freeze.
7. **Server view distance.** On multiplayer the server decides how far chunks are sent. Setting the client to 32 on a server that sends 10 gains nothing. Only Bobby (cache) or Distant Horizons (LOD) show more. Since 1.20.2 the server paces chunk sending to what the client reports it can process [M].
8. **Shader/pipeline compilation** on first use of a render type gives one-off hitches in the first minutes. Nothing a launcher can safely do.
9. **Entity and block-entity rendering** scales with render distance in built-up areas. Entity Culling and ImmediatelyFast target this.
10. **Biome blend** is computed during meshing; radius 2 (5x5) is the default, and cost grows with the radius. Sodium has its own fast path [M], so with Sodium the saving from lowering it is small.

What a launcher can honestly influence: 1 (ship Sodium), 5 (flags), 9 (ship the culling mods), and, by offering choices, 4, 6 and 7.

### 2d. Windows-side

| Action | Safe? | What others do | Recommendation |
|---|---|---|---|
| Process priority "Above normal" | Needs no admin. Risk is starving other software, including Reminth's own streamer/clip recorder | The flags guide suggests it manually [V-web Mukul1127]. I found no launcher doing it by default [NOT VERIFIED] | Opt-in |
| Priority "High" / "Realtime" | High can make audio, input and capture stutter; Realtime needs admin and can hang the machine | | Never |
| `NvOptimusEnablement` / `AmdPowerXpressRequestHighPerformance` | Exported symbols of the exe itself; a launcher cannot add them to `javaw.exe` | | Not applicable |
| Per-app GPU preference: `HKCU\Software\Microsoft\DirectX\UserGpuPreferences`, value name = full path of `javaw.exe`, data `GpuPreference=2;` | This is the value the Windows Settings "Graphics" page writes. Per-user, no admin, reversible. It is not a documented API for third parties [M] | Modrinth and ATLauncher do **not** do it automatically; both publish instructions telling the user to add `javaw.exe` in Windows Settings by hand [V-web https://support.modrinth.com/en/articles/9008070-using-the-dedicated-gpu, https://wiki.atlauncher.com/guides/choosing-which-gpu-for-minecraft-to-use/] | Opt-in toggle, scoped to Reminth's own runtime copies. Details in Part 3 |
| Mojang's Intel trick | Already inherited through the version JSON's `HeapDumpPath` argument | | Keep passing the version's JVM args as today |
| Windows Game Mode | System-wide user setting; on by default on Windows 10/11 [M] | | Do not touch |
| Fullscreen optimisations (compat-layer flag on `javaw.exe`) | Changes app-compat settings; unclear benefit for an OpenGL borderless window | | Do not touch |
| Power plan | System-wide, affects battery and heat | | Do not touch. A one-line tip when on battery is fine |
| Defender exclusions | Security setting, needs admin | | Never |

Whether the registry preference actually moves an OpenGL game to the discrete GPU on a given laptop depends on the vendor driver. [NOT VERIFIED]

### 2e. Java distribution

- Mojang's runtime for 26.x is the Microsoft build of OpenJDK 25 [V-web minecraft.wiki 26.1-snapshot-1]. Reminth already uses Mojang's runtime first and Microsoft's as fallback.
- Microsoft OpenJDK, Temurin and Zulu are builds of the same HotSpot source. I found no credible client FPS comparison between them. [NOT VERIFIED], expected difference: none.
- GraalVM: the evidence is server-side only. One small benchmark reports about 15% higher TPS on a contrived server load [V-web https://github.com/tallua/minecraft-graalvm-benchmark]; the flags guide claims 20%+ for chunk generation on servers and recommends GraalVM or Adoptium for clients on Java 21 without client numbers [V-web Mukul1127]. Oracle GraalVM is under Oracle's GFTC licence, whose redistribution terms need a lawyer's reading before bundling [M]. The game's render thread is limited by OpenGL calls, not by JIT quality.
- Recommendation: stay on Mojang's runtime. It is what mod developers test against, it is hash-verified, and it removes licensing questions.

---

## PART 3 — The plan

Ordered by value over risk. Each item says where the code goes.

### Tier 1 — safe defaults for everyone

#### 1.1 Version-gated JVM flag builder

**What.** Replace the fixed `baseJvm` array with a pure function, e.g. `buildJvmFlags({ javaMajor, maxMemoryMb, totalMemMb, cpuCount, windowsBuild, gcChoice, userArgs })`, exported for unit tests.

**Flag sets.**

Java 25+ (Minecraft 26.x), when eligible for ZGC:
```
-XX:+IgnoreUnrecognizedVMOptions
-Xms{min(Xmx, 2048)}M -Xmx{Xmx}M
-XX:+UseZGC
-XX:+UseCompactObjectHeaders
-XX:+AlwaysPreTouch
-XX:+UseStringDeduplication
-Dlog4j2.formatMsgNoLookups=true
```
This is Mojang's set with Reminth's own `-Xmx`.

ZGC eligibility (all must hold, otherwise use the G1 set on the same Java):
- Windows build ≥ 17134 (`os.release()` → third component). Mojang's rule.
- `Xmx` ≥ 4096 MB. Mojang pairs ZGC with 4 GB; below that, allocation stalls are a real risk. My threshold, [NOT VERIFIED].
- `os.cpus().length` ≥ 4. My threshold, based on the "demanding on older CPUs" warning. [NOT VERIFIED]

Java 25+, not eligible for ZGC; and Java 17-24 (Minecraft 1.18-1.21.11):
```
-XX:+IgnoreUnrecognizedVMOptions
-Xms{Xms}M -Xmx{Xmx}M
-XX:+UnlockExperimentalVMOptions
-XX:+UseG1GC
-XX:G1NewSizePercent=20
-XX:G1ReservePercent=20
-XX:MaxGCPauseMillis=50
-XX:G1HeapRegionSize=32M
-XX:+UseStringDeduplication
(+ -XX:+UseCompactObjectHeaders on Java 25 only)
-Dlog4j2.formatMsgNoLookups=true
```
`Xms` = `Xmx` when the PC has 16 GB or more, else half of `Xmx` (min 1024). Mojang's G1 set plus string dedup.

Java 8-16 (Minecraft 1.17 and older):
```
-Xms{Xms}M -Xmx{Xmx}M
-XX:+UnlockExperimentalVMOptions
-XX:+UseG1GC
-XX:+ParallelRefProcEnabled
-XX:G1NewSizePercent=20
-XX:G1ReservePercent=20
-XX:MaxGCPauseMillis=50
-XX:G1HeapRegionSize=32M
-Dlog4j2.formatMsgNoLookups=true
```
No `IgnoreUnrecognizedVMOptions` needed (every flag exists in 8), though passing it is harmless.

**Conflict rule.** If the player's extra args contain any `-XX:+Use…GC`, emit none of Reminth's collector flags (no `UseG1GC`/`UseZGC`, no `G1*`, no `MaxGCPauseMillis`). Keep heap, compact headers and the rest. This fixes finding 2.

**Expected benefit.** Fewer and shorter GC hitches on 26.x, parity with the official launcher; shorter worst-case pauses on older versions (50 ms target instead of 200). Strength of evidence: Mojang ships it to every vanilla player (strong for "safe"), no client frame-time data found (weak for "how much"). [NOT VERIFIED]

**Risk.** ZGC uses more memory per object and more background CPU; a weak dual-core or a 2 GB heap could get worse. Mitigated by the eligibility rules. Heavily modded 26.x packs under ZGC are less travelled than vanilla.

**Making it safe.**
- A setting `gc: "auto" | "g1" | "zgc"` (default auto), global in Settings, shown as "Garbage collector: Automatic (recommended) / Classic (G1) / Low-pause (ZGC)". This is the off switch.
- Unit tests for every Java range and for the conflict rule.
- Launch fallback, item 1.2.

**Where.**
- `minecraft.js:468-502` → call the builder. `:516-523` ordering stays.
- `minecraft.js:265-277`: add `javaMajor: java.majorFor(vanilla.javaVersion)` to the install result (`majorFor` is already exported, `java.js:231`).
- `store.js:156-183` add `gc` to `DEFAULT_SETTINGS`; `store.js:233-283` validate it.
- `renderer.js` near `:2188` / `:2249` for the control.
- Do **not** route `default-user-jvm` through `resolveArguments` without first teaching `osMatchesThisMachine` (`minecraft.js:760-766`) about `versionRange`. Simpler and more predictable: own the flag table as above and treat Mojang's block as the reference it was copied from. Optionally log a warning when a version's `default-user-jvm` differs from the table, so a future Mojang change is noticed.

#### 1.2 Safe-mode relaunch when the JVM refuses its arguments

**What.** If the game exits non-zero within about 5 seconds and the launch log contains `Could not create the Java Virtual Machine`, `Unrecognized VM option`, `Multiple garbage collectors selected`, `Error occurred during initialization of VM` or `is experimental and must be enabled`, relaunch once with only `-Xmx`, the log4j property, and the version's own args; then tell the player which setting was skipped.

**Benefit.** Turns every flag mistake (ours or the player's) from "game won't start" into a notice. This is what makes 1.1 safe to ship.

**Risk.** Low. One extra launch attempt, bounded to once.

**Where.** `minecraft.js:574-585` (the `exit` handler already knows the timing and has `logPath`); the retry decision belongs in `main.js:860-873` where `launch` is called, by passing a `safeMode: true` option through.

#### 1.3 Memory defaults

**What.**
- Keep `computeDefaultMaxMemoryMb` as is for vanilla and light instances (2-6 GB).
- For the ZGC path use `-Xms` = min(`Xmx`, 2 GB) rather than `Xms` = `Xmx` (Mojang's shape). With `AlwaysPreTouch`, an `Xms` of 6 GB would commit 6 GB before the title screen on a 12 GB PC.
- Raise the automatic default for modpack instances (`instance.modpack` set, or more than about 60 mods) to min(8 GB, cap). The current 6 GB ceiling is tight for large packs. Judgement call, [NOT VERIFIED].
- On PCs with 8 GB or less, `Xmx` of 4 GB plus Windows plus a browser can page. Consider 3 GB when total RAM ≤ 8 GB and the instance is not a modpack. [NOT VERIFIED]

**Where.** `minecraft.js:661-664`; `main.js:849-851`.

#### 1.4 Move the performance pack to Modrinth, release builds only

**Recommendation: switch.** Comparison:

| | GitHub Releases (today) | Modrinth |
|---|---|---|
| Version/loader match | Parsed from tag, title and changelog prose (`releaseMatchesVersion`) | Structured `game_versions` and `loaders` per build |
| Stability channel | Not checked | `version_type`: release / beta / alpha |
| Integrity | TLS only | sha1 and sha512 per file |
| Dependencies | None | Declared per build |
| Rate limit | 60/hour per IP unauthenticated | 300/minute per IP [M]; client with back-off already in `modrinth.js` |
| Coverage | Only projects that publish GitHub Releases (FerriteCore does not) | Every mod in Part 2b |
| Other loaders | Fabric assets only (`pickJarAsset` excludes others) | NeoForge and Forge builds are first-class |
| New dependency | None | None; Reminth already depends on Modrinth for the catalog and updates |

The comment at `config.js:30-35` says the pack avoids Modrinth so Reminth "has no runtime dependency on either". That has not been true since the catalog, update checker and modpack installer were added. Keep the GitHub path as a fallback for one release if you want a soft landing; otherwise remove it.

**Rules for the resolver** (a new function beside `downloadPerformanceMods`, `minecraft.js:1665`):
1. For each slug call `modrinth.getProjectVersions(slug, { loaders: content.loadersFor("mod", instance), gameVersions: [mcVersion] })`.
2. Keep only `version_type === "release"`. If none, skip the mod and log "no stable build for {version} yet". Do **not** reuse `content.pickVersion` (`content.js:902`), which falls back to betas.
3. Take the newest. Download with `content.downloadVerified(url, dest, sha1)` (`content.js:720`).
4. Install required dependencies under the same release-only rule; if a dependency has no release, skip the mod.
5. Keep everything that exists today: `verifyDownloadedJar`, the `managed-mods.json` ledger, stepping aside for the player's own copies, `tidyManagedMods`, the log file, the 6-hour cache (cache the chosen version id and hash per slug/version/loader), offline tolerance.
6. Do not auto-upgrade a managed mod mid-session; resolve at launch as today.
7. Optional hardening: a "soak" delay, i.e. only take a release that is at least 48 hours old. Entity Culling shipped 1.11.0, 1.11.1 and 1.11.2 within three days in September [V-api]; a soak window would have skipped the two that needed fixing.

**"Reminth performance pack 2.0"**

Fabric / Quilt (default on, as today):

| Slug | Why | Condition |
|---|---|---|
| `sodium` | renderer | always |
| `lithium` | game logic / integrated server | always |
| `ferrite-core` | memory | always |
| `immediatelyfast` | HUD/text/entity batching | always |
| `entityculling` | hidden entity culling | always (needs Fabric API, already managed) |
| `modernfix-mvus` | startup, memory, fixes | always; see risk below |
| `scalablelux` | lighting | only when a release exists (today: 26.2 yes, 26.3 no) |
| `dynamic-fps` | idle throttling | always; behaviour is visible (game slows when unfocused), so mention it in the pack description |
| `badoptimizations` | micro-optimisations | second wave, after the first six have shipped cleanly |
| `ixeris` | input threading | second wave or opt-in; most invasive of the group |

NeoForge (new; today NeoForge gets nothing):

| Slug | Condition |
|---|---|
| `sodium` | Minecraft 1.21.1+ |
| `lithium` | where a NeoForge release exists |
| `ferrite-core` | always |
| `immediatelyfast` | always |
| `entityculling` | always |
| `modernfix` (official) | always |
| `scalablelux` | release only |
| `dynamic-fps`, `badoptimizations` | second wave |

Forge:

| Minecraft | Set | Status |
|---|---|---|
| 1.20.1 | `embeddium`, `radium`, `modernfix`, `ferrite-core`, `entityculling`, `immediatelyfast` | Slugs and version ranges for Embeddium/Radium [V-api]; Forge 1.20.1 availability of the last four is [M]. The release-only resolver decides at run time, so a wrong guess installs nothing rather than something broken |
| 26.x | Whatever resolves. Sodium has no Forge build [V-api] | Expect little |

Because the resolver asks Modrinth for the exact version and loader, the same slug list works for older Minecraft versions without a per-version table: a mod with no release for that version is skipped.

**Explicitly excluded from the default pack:** `c2me-fabric` (alpha), `moreculling` (beta on 26.3; add automatically once a release exists if you want it), `krypton` (no 26.3 build, marginal for clients), `better-block-entities` (visual change), `nvidium` (beta, NVIDIA-only), `voxy` (beta), `distanthorizons` and `bobby` (visual change; offered in a profile), `debugify`, `no-chat-reports` (changes multiplayer chat behaviour; some servers reject unsigned chat), all server-side mods.

**Risks.**
- `modernfix-mvus` is a community fork maintained by someone other than ModernFix's author. All four benchmark packs ship it [V-api], which is decent social proof, but it is a supply-chain step beyond "official upstream". Options: ship it; or ship official `modernfix` on NeoForge only and leave Fabric without it. My recommendation: ship it in the second wave, after reading its source diff against upstream once.
- More mods means more surface for a bad upstream release. Mitigations: release-only, optional soak, jar self-check, the per-instance switch, and a per-mod switch (below).
- Players' own mods may conflict with a newly added default. `planStepAside` already handles "player has their own copy or an incompatible mod"; extend `performanceModIds` (`minecraft.js:1317`) with each new mod's ids and known replacements (e.g. Embeddium/Rubidium vs Sodium, Radium/Canary vs Lithium, Starlight vs ScalableLux, original ModernFix vs the fork).

**Modpack instances.** `mrpack.js:163` should pass `performanceMods: false`. A pack author chose the mod list; adding Lithium or ScalableLux on top of a curated pack is a silent change. Offer the pack as a visible toggle on the instance page instead.

**Per-mod control.** Change `instance.performanceMods` from boolean to boolean-or-object (`{ exclude: ["scalablelux"] }`) so a player can drop one mod without losing the rest. `instances.js:102` (sanitise), `:454` (update whitelist).

**Where.** `config.js:48-73` (list becomes `[{ slug, label, loaders, wave }]`); `minecraft.js:154-157` (extend `wantsPerfMods` to NeoForge/Forge; note `fabricLike` gates Fabric API and tidy and must stay Fabric-only), `:1312-1320` (keys/ids), `:1665-1755` (resolver); `renderer.js:1174` (`perfEligible`); `compat.js:669` (same eligibility test); `mrpack.js:163`.

**Fix even if you keep GitHub.** Add `if (release.prerelease || release.draft) continue;` at `minecraft.js:1868`. Whether ScalableLux's alphas are marked as pre-releases on GitHub I could not check (GitHub was not reachable from here). [NOT VERIFIED]

#### 1.5 Correct two comments that will mislead the next reader

- `config.js:51-53`: ScalableLux is described as the fix for chunk-loading stutter. It mainly helps the integrated server; on multiplayer the server lights chunks.
- `config.js:62-63`: "Sodium/Lithium/ScalableLux are all stable releases". Not true for ScalableLux on 26.3.
- `minecraft.js:469-483`: the rationale cites Aikar's flags as client tuning.

### Tier 2 — opt-in choices

#### 2.1 Per-instance performance profile

A field `instance.perfProfile`: `"balanced"` (default) | `"max-fps"` | `"far-view"`. Shown at instance creation and on the instance page, each with a two-line description of what changes. Changing the profile later changes mods and JVM settings only; it never rewrites `options.txt` on an instance that has one.

| | Balanced | Max FPS | High render distance |
|---|---|---|---|
| Mods | pack 2.0 | pack 2.0 + `badoptimizations`, `ixeris`; offer `better-block-entities` and `moreculling` (if release) as ticked-by-choice extras | pack 2.0 + offer `distanthorizons`; on Fabric ≤ 26.2 offer `bobby` for multiplayer; offer `c2me-fabric` behind an explicit "experimental, back up your worlds" confirmation |
| GC | auto | auto | auto; default `Xmx` one step higher (min(8 GB, cap)) because DH and long view distances hold more chunk data |
| options.txt for a new instance | none written | see 2.2 | see 2.2 |
| Priority | normal | above normal (if 2.3 is built) | normal |

Where: `instances.js:59-103` (sanitise), `:415-441` (create), `:454` (update whitelist); `main.js:411-420`; `renderer.js` create dialog around `:1051` and `:1174`; mods through `content.install(instance, { projectId: slug, kind: "mod" })` so they are ordinary player-visible mods the player can remove, not managed ones.

C2ME specifically: the reason it was pulled (`config.js:55-65`) still holds, and it is alpha on every version today. Offering it as a labelled experiment in this profile is consistent with "nothing unstable as a *silent* default". If you would rather not carry the support load, leave it to the mod browser as now.

#### 2.2 options.txt for new instances

**Hard rules.**
- Write only when the instance's `options.txt` does not exist, at creation time. Never on launch, never on profile change, never for modpack imports (the pack's overrides own it, `mrpack.js:197-203`), never for migrated instances (`migrate.js:23` carries the old one).
- Write only the keys being changed plus the `version` key. The wiki states that when `version` is missing "the file is replaced with the default settings" [V-web https://minecraft.wiki/w/Options.txt]. The correct value is the data version of that Minecraft release (5023 for 26.3 per the same page); read it from `version.json` → `world_version` inside the client jar (Reminth has `zipread.js`). If it cannot be read, write nothing.
- Key names change between versions (`graphicsMode` became `graphicsPreset`; `chunkSectionFadeInTime`, `cutoutLeaves`, `weatherRadius`, `preferredGraphicsBackend` are recent). Only write keys known to exist for that version family; unknown keys are ignored by the game [M] but should not be relied on.
- **Must be tested per version family** (1.16, 1.20, 1.21, 26.x): create the file, start the game, confirm the values took and nothing else reset. [NOT VERIFIED]

**Which options are safe as silent defaults?** Honest answer: none that are worth setting. Every option that buys meaningful smoothness changes what the player sees or how the world behaves. Vanilla's defaults (`renderDistance:12`, `simulationDistance:12`, `prioritizeChunkUpdates:0`, `enableVsync:true`, `maxFps:120`, `graphicsPreset:fancy`, `biomeBlendRadius:2`, `mipmapLevels:4`, `entityDistanceScaling:1.0`) are already reasonable with Sodium. So Balanced writes no file. The values below apply only when the player picks a profile, which is the choice being offered.

Max FPS (new instance only):
```
version:<world_version>
renderDistance:10
simulationDistance:8
graphicsPreset:fast          (graphicsMode:0 before the preset key existed)
renderClouds:"fast"
particles:1
entityShadows:false
biomeBlendRadius:1
entityDistanceScaling:0.75
enableVsync:false
maxFps:260
```

High render distance (new instance only):
```
version:<world_version>
renderDistance:<16 | 20 | 24 by hardware tier>
simulationDistance:8
biomeBlendRadius:2
entityDistanceScaling:1.0
prioritizeChunkUpdates:0
```
Hardware tier from `os.totalmem()` and `os.cpus().length` only (Reminth does not know the GPU): 16 by default, 20 with 8+ cores and 16+ GB, 24 with 12+ cores and 32+ GB. Thresholds are my judgement. [NOT VERIFIED]

Things deliberately not set anywhere: `mipmapLevels` (visual, negligible cost), `ao` (visual), `fullscreen`/`exclusiveFullscreen` (Reminth already has a fullscreen setting), `preferredGraphicsBackend` (Vulkan is experimental per Mojang), language, controls, accessibility, narrator, `onboardAccessibility`.

`simulationDistance:8` needs a visible sentence in the profile description: "things farther than 8 chunks from you stop growing and moving in singleplayer". It has no effect on servers.

Where: a new `src/main/gameOptions.js` (pure builder + write-if-absent using `atomic.js`), called from `instances.create` (`instances.js:438-440`, after `mkdir`) only when a non-default profile was chosen.

#### 2.3 Process priority

`os.setPriority(child.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL)` right after `spawn` (`minecraft.js:546-550`), in a try/catch, never higher. Setting: `processPriority: "normal" | "above-normal"`, default normal; the Max FPS profile turns it on. Force normal while streamer mode is recording (`settings.streamerMode`), so the game does not starve Reminth's own capture.

Benefit: helps only when something else is competing for CPU. Evidence is anecdotal. [NOT VERIFIED]

#### 2.4 High-performance GPU preference

A toggle in Settings: "Ask Windows to run Minecraft on the high-performance graphics card". Default off; when Reminth can tell there are two GPUs (Electron `app.getGPUInfo("basic")` lists `gpuDevice` entries), show a one-time suggestion.

Implementation rules:
- Value name: the exact path of each `javaw.exe` under Reminth's own `RUNTIMES_DIR` / `JAVA_DIR`. These binaries are used by nothing else, so the preference cannot affect other Java software. Never a system-wide Java.
- `reg.exe add "HKCU\Software\Microsoft\DirectX\UserGpuPreferences" /v "<path>" /t REG_SZ /d "GpuPreference=2;" /f` through `execFile` with an argument array (no shell string).
- Before writing, read the existing value. If the player already has an entry for that path, leave it alone.
- Record what Reminth wrote; turning the toggle off deletes exactly those values. Uninstall should too.
- Re-apply after a new runtime is installed (`java.js:60-71` returns the path).

This is the same value Windows Settings writes, but it is not a documented interface, and the two launchers I could check tell users to do it by hand rather than doing it for them [V-web]. That is why it is opt-in. Fallback if you prefer zero registry writes: a button that opens `ms-settings:display-advancedgraphics` and copies the `javaw.exe` path to the clipboard.

Where: new `src/main/gpuPreference.js`; IPC in `main.js`; `store.js` setting; a line in the privacy/terms docs that Reminth writes this value when asked.

#### 2.5 ZGC on Java 21

For 1.20.5-1.21.11, the `gc: "zgc"` choice passes `-XX:+UseZGC -XX:+ZGenerational` (accepted by JDK 21 [V-run]) with the same eligibility rules. Not the default: Mojang did not ship ZGC on Java 21, and generational ZGC in 21 was its first release.

### Tier 3 — do not do

| Don't | Why |
|---|---|
| Ship C2ME, Nvidium, Voxy, More Culling (26.3) or ScalableLux (26.3) as silent defaults | Alpha/beta today [V-api]. C2ME already produced a hard hang for a Reminth user |
| Install the newest build regardless of channel | That is how an alpha reaches everyone. Release-only, with skip-and-log |
| `-XX:+DisableExplicitGC` | Can convert direct-memory pressure into a crash |
| `-XX:+UseLargePages` | Needs a Windows privilege and admin; silently does nothing otherwise |
| Aikar's flags, or any server flag set, on the client | Tuned for throughput on large server heaps; `MaxGCPauseMillis=200` is the opposite of what a client wants |
| Flag sets from guides with dozens of `-XX` options (code cache sizes, `NmethodSweepActivity`, `UseCriticalJavaThreadPriority`, `ThreadPriorityPolicy=1`, `MaxNodeLimit`…) | Several were removed or changed meaning across JDK 17→25; untested on Java 25; `ThreadPriorityPolicy=1` needs privileges. No measured client benefit found |
| Shenandoah | Not in every JDK build; no evidence it beats generational ZGC; one more configuration to support |
| GraalVM or another JDK by default | No client evidence; licensing review needed; diverges from what mod authors test |
| AppCDS / AOT cache | Does not cover mod-loader class loading; adds a stale-archive failure mode |
| Rewrite an existing `options.txt`, or write `sodium-options.json` | The player's settings are theirs; Sodium's defaults are the recommended ones |
| Set `preferredGraphicsBackend:vulkan`, or ship VulkanMod | Mojang marks Vulkan experimental and reverted the default to OpenGL in 26.2 [V-web] |
| Lower render distance, graphics preset, particles or simulation distance silently | Visual/gameplay changes the player did not ask for |
| Priority High/Realtime, power plan, Game Mode, fullscreen-optimisation flags, Defender exclusions | System-wide or security settings; overreach for a game launcher; some need admin |
| `no-chat-reports`, server-side mods (ServerCore, VMP, Let Me Despawn), Debugify by default | Change multiplayer or gameplay behaviour |
| Add the performance pack silently to imported modpacks | The pack author's mod list is the product the player chose |
| Allocate more RAM by default "for performance" | Larger G1 heaps mean longer pauses; Prism's own guidance says the same [V-web] |

Nothing in Tiers 1-2 can get a player banned: every default mod is a client-side optimisation with no gameplay advantage, of the kind the benchmark packs ship to millions. The items with any multiplayer colour (Bobby, Distant Horizons showing terrain beyond the server's view distance) are opt-in; a few competitive servers have rules about such mods, so say so in the profile text. [M]

### Suggested order of work

1. 1.2 safe-mode relaunch, and the collector-conflict rule from 1.1. Small, fixes a present bug.
2. 1.1 flag builder with tests; ship with `gc: auto`.
3. 1.4 Modrinth resolver with the current three mods first (pure source swap, release-only), then FerriteCore, ImmediatelyFast, Entity Culling; then the second wave; then NeoForge.
4. `mrpack.js` opt-out and per-mod exclusion.
5. 2.1/2.2 profiles, after the options.txt test matrix passes.
6. 2.3, 2.4.

### What cannot be verified without running the game

- Any FPS or frame-time number. No measurement was made. Before and after each of steps 2, 3 and 5, capture frame times on at least a low-end laptop (integrated GPU, 8 GB), a mid-range desktop and a high-end one: same seed, same flight path at render distance 12 and 24, singleplayer and a server, 1% and 0.1% lows plus a count of frames over 50 ms. Sodium's own frame-time graph or PresentMon will do.
- ZGC vs G1 on Java 25 for the client, especially at 4 GB on 4-core CPUs and with large mod lists. My eligibility thresholds (4 GB, 4 cores) are guesses.
- Flag acceptance on Mojang's actual JDK 25 runtime on Windows. I verified behaviour on OpenJDK 21 on Linux only. In particular: that `UseCompactObjectHeaders` + `UseZGC` + `AlwaysPreTouch` start cleanly (Mojang's own JSON implies yes), and that Shenandoah is or is not present in that build.
- `-XX:+IgnoreUnrecognizedVMOptions` on Java 8 with the Java 8 set.
- Partial `options.txt` behaviour per version family, and the `version` key requirement.
- Whether the registry GPU preference moves an OpenGL `javaw.exe` to the discrete GPU on NVIDIA, AMD and Intel hybrid laptops.
- Whether `os.setPriority` on a detached child behaves on Windows as documented, and whether above-normal priority hurts the streamer recorder.
- The combined mod set starting cleanly on each supported Minecraft version and loader. Modrinth metadata says the builds exist; it does not say they work together. A headless launch-to-title-screen check per (version, loader), like the harness described in `REMINTH_STATE.md`, should gate each change to the list.
- GitHub pre-release flags for ScalableLux and Sodium (GitHub was unreachable from this environment), hence which build today's Reminth actually installs on 26.2 and 26.3.
- Defaults of Lunar, Badlion, Feather, ATLauncher and the Modrinth App's JVM flags; Meowice flags; the CaffeineMC and FO documentation on flags. Not fetched.
- Forge 1.20.1 availability of ModernFix, FerriteCore, Entity Culling and ImmediatelyFast (from memory; the resolver makes this self-correcting).

### Sources

Primary:
- Mojang version manifest and version JSONs: https://piston-meta.mojang.com/mc/game/version_manifest_v2.json , `…/v1/packages/4fe1aa1ef8da1cb95c5bad1fb98890ca56dd8ca3/26.3.json` , `…/84d0ff7bd4428695691af5a178edae22c7c83d89/26.1.json` , `…/4f6bd9388f12e9d7adc2ded64acba66212d60521/1.21.11.json`
- Modrinth API v2: `https://api.modrinth.com/v2/project/{slug}` and `/version` for every slug named above; `/v2/search` with `versions:26.3`, `categories:fabric`, `categories:optimization`
- OpenJDK JEP list: https://openjdk.org/projects/jdk/25/jeps-since-jdk-21 (JEP 474, 490, 519, 521, 475, 483)

Secondary:
- https://minecraft.wiki/w/Java_Edition_26.1-snapshot-1
- https://minecraft.wiki/w/Options.txt
- https://feedback.minecraft.net/hc/en-us/articles/45976772290701-Minecraft-Java-Edition-26-2-Snapshot-8
- https://prismlauncher.org/wiki/help-pages/java-settings
- https://support.modrinth.com/en/articles/9008070-using-the-dedicated-gpu
- https://wiki.atlauncher.com/guides/choosing-which-gpu-for-minecraft-to-use/
- https://github.com/Mukul1127/Minecraft-Performance-Flags-Benchmarks (mirror of brucethemoose's guide)
- https://github.com/Obydux/Minecraft-startup-flags
- https://cleanroommc.com/wiki/end-user-guide/args
- https://mineguard.pro/en/blog/zgc-vs-g1gc-minecraft-java-21-benchmark (server-side, vendor blog)
- https://github.com/tallua/minecraft-graalvm-benchmark (server-side)
- https://github-wiki-see.page/m/pajicadvance/sodium-fabric/wiki/Sodium-video-settings
