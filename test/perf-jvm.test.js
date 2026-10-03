"use strict";
/**
 * The JVM flags Reminth starts the game with (per Java version, per PC, per
 * garbage-collector setting), the rule that keeps them from colliding with
 * the player's own arguments, the safe-mode retry decision, the automatic
 * memory amount, and the two settings behind them. The game can't be run in
 * a test, so launch() is checked against a stand-in for spawn().
 * Run with: node --test test/perf-jvm.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");

// paths.js hangs everything off the home folder: point it at a temp one
// BEFORE anything is required.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "reminth-perf-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

// minecraft.js takes spawn out of child_process when it loads, so the
// stand-in has to be in place first.
const childProcess = require("child_process");
const spawned = []; // { file, args, child }
childProcess.spawn = (file, args) => {
  const child = new EventEmitter();
  child.pid = 7000 + spawned.length;
  child.unref = () => {};
  spawned.push({ file, args, child });
  return child;
};

// store.js asks Electron for safeStorage (account encryption) - not used here.
const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return "STUB_ELECTRON_PERF_JVM";
  return originalResolve.call(this, request, ...rest);
};
Module._cache.STUB_ELECTRON_PERF_JVM = { id: "STUB_ELECTRON_PERF_JVM", filename: "STUB_ELECTRON_PERF_JVM", loaded: true, exports: { safeStorage: { isEncryptionAvailable: () => false } } };

const minecraft = require("../src/main/minecraft");
const store = require("../src/main/store");
const java = require("../src/main/java");
const { buildJvmFlags, planSafeModeRetry, defaultMaxMemoryMb, windowsBuildNumber, wantsAboveNormalPriority } = minecraft;

const LOG4J = "-Dlog4j2.formatMsgNoLookups=true";
const GB = 1024;
// A 16 GB, 8-thread Windows 11 PC with the RAM slider at 6 GB.
const PC = { maxMemoryMb: 6 * GB, totalMemMb: 16300, cpuCount: 8, windowsBuild: 22631 };
const flags = (over) => buildJvmFlags({ ...PC, ...over });

const ZGC_25 = ["-XX:+IgnoreUnrecognizedVMOptions", "-Xms2048M", "-Xmx6144M", "-XX:+UseZGC", "-XX:+UseCompactObjectHeaders", "-XX:+AlwaysPreTouch", "-XX:+UseStringDeduplication", LOG4J];
const G1 = (extra = []) => [
  "-XX:+IgnoreUnrecognizedVMOptions",
  "-Xms6144M",
  "-Xmx6144M",
  "-XX:+UnlockExperimentalVMOptions",
  "-XX:+UseG1GC",
  "-XX:G1NewSizePercent=20",
  "-XX:G1ReservePercent=20",
  "-XX:MaxGCPauseMillis=50",
  "-XX:G1HeapRegionSize=32M",
  "-XX:+UseStringDeduplication",
  ...extra,
  LOG4J,
];
const G1_JAVA8 = [
  "-Xms6144M",
  "-Xmx6144M",
  "-XX:+UnlockExperimentalVMOptions",
  "-XX:+UseG1GC",
  "-XX:+ParallelRefProcEnabled",
  "-XX:G1NewSizePercent=20",
  "-XX:G1ReservePercent=20",
  "-XX:MaxGCPauseMillis=50",
  "-XX:G1HeapRegionSize=32M",
  LOG4J,
];

const collectorsOn = (args) => args.filter((a) => /^-XX:\+Use\w*GC$/.test(a));
/** "-XX:+UseZGC" -> "UseZGC", "-XX:MaxGCPauseMillis=50" -> "MaxGCPauseMillis", "-Xmx6144M" -> "-Xmx". */
function flagName(arg) {
  const xx = /^-XX:[+-]?([A-Za-z0-9]+)/.exec(arg);
  if (xx) return xx[1];
  const heap = /^-Xm[xs]/.exec(arg);
  if (heap) return heap[0];
  return arg.split("=")[0];
}
/** Nothing said twice, no flag both on and off, at most one collector, and the things every launch needs. */
function assertSane(args, label) {
  const names = args.map(flagName);
  assert.equal(new Set(names).size, names.length, `${label}: a flag is given twice: ${args.join(" ")}`);
  assert.ok(collectorsOn(args).length <= 1, `${label}: more than one collector: ${args.join(" ")}`);
  assert.ok(args.includes(LOG4J), `${label}: the log4j property is missing`);
  // G1's percentages are experimental flags: refused unless unlocked first.
  const firstG1 = args.findIndex((a) => /^-XX:G1(NewSize|Reserve)Percent/.test(a));
  if (firstG1 !== -1) {
    const unlock = args.indexOf("-XX:+UnlockExperimentalVMOptions");
    assert.ok(unlock !== -1 && unlock < firstG1, `${label}: G1 percentages before the unlock flag`);
  }
}

/* ---------------- the flag sets ---------------- */

test("buildJvmFlags: Java 25 on a capable PC gets Mojang's ZGC set", () => {
  assert.deepEqual(flags({ javaMajor: 25 }), ZGC_25);
  assert.deepEqual(flags({ javaMajor: 25, gc: "auto" }), ZGC_25);
  assert.deepEqual(flags({ javaMajor: 26 }), ZGC_25);
  // exactly at the thresholds: Windows 10 1803, 4 GB heap, 4 threads
  assert.deepEqual(collectorsOn(flags({ javaMajor: 25, windowsBuild: 17134, maxMemoryMb: 4096, cpuCount: 4 })), ["-XX:+UseZGC"]);
});

test("buildJvmFlags: Java 25 that isn't eligible for ZGC gets G1 with compact headers", () => {
  const g1 = G1(["-XX:+UseCompactObjectHeaders"]);
  assert.deepEqual(flags({ javaMajor: 25, windowsBuild: 17133 }), g1, "Windows older than 10 1803");
  assert.deepEqual(flags({ javaMajor: 25, windowsBuild: 9600 }), g1, "Windows 8.1");
  assert.deepEqual(flags({ javaMajor: 25, windowsBuild: undefined }), g1, "unknown Windows build");
  assert.deepEqual(flags({ javaMajor: 25, cpuCount: 2 }), g1, "two CPU threads");
  assert.deepEqual(collectorsOn(flags({ javaMajor: 25, maxMemoryMb: 4095 })), ["-XX:+UseG1GC"], "under 4 GB of heap");
  assert.deepEqual(collectorsOn(flags({ javaMajor: 25, cpuCount: 3 })), ["-XX:+UseG1GC"]);
});

test("buildJvmFlags: Java 17-24 gets the G1 set, without compact headers", () => {
  for (const javaMajor of [17, 18, 21, 22, 23, 24]) {
    assert.deepEqual(flags({ javaMajor }), G1(), `Java ${javaMajor}`);
    assert.deepEqual(flags({ javaMajor, gc: "g1" }), G1(), `Java ${javaMajor}, gc g1`);
  }
});

test("buildJvmFlags: Java 8-16 (and an unknown Java) gets only flags Java 8 has", () => {
  for (const javaMajor of [8, 11, 16, undefined, null, NaN, 0, "x"]) {
    assert.deepEqual(flags({ javaMajor }), G1_JAVA8, `Java ${javaMajor}`);
    assert.deepEqual(flags({ javaMajor, gc: "g1" }), G1_JAVA8);
    // ZGC before Java 21 is the old single-generation kind (or missing): G1 instead.
    assert.deepEqual(flags({ javaMajor, gc: "zgc" }), G1_JAVA8);
  }
  for (const flag of ["-XX:+IgnoreUnrecognizedVMOptions", "-XX:+UseStringDeduplication", "-XX:+UseCompactObjectHeaders", "-XX:+UseZGC", "-XX:+AlwaysPreTouch"]) {
    assert.equal(G1_JAVA8.includes(flag), false);
  }
});

test("buildJvmFlags: gc 'g1' always gives G1, even where auto would pick ZGC", () => {
  assert.deepEqual(flags({ javaMajor: 25, gc: "g1" }), G1(["-XX:+UseCompactObjectHeaders"]));
});

test("buildJvmFlags: gc 'zgc' gives ZGC wherever the Java has the generational kind", () => {
  const zgc21 = ["-XX:+IgnoreUnrecognizedVMOptions", "-Xms2048M", "-Xmx6144M", "-XX:+UseZGC", "-XX:+ZGenerational", "-XX:+AlwaysPreTouch", "-XX:+UseStringDeduplication", LOG4J];
  assert.deepEqual(flags({ javaMajor: 21, gc: "zgc" }), zgc21);
  assert.deepEqual(flags({ javaMajor: 22, gc: "zgc" }), zgc21);
  // 23+: generational is the default, the extra flag is deprecated/gone
  const zgc23 = zgc21.filter((f) => f !== "-XX:+ZGenerational");
  assert.deepEqual(flags({ javaMajor: 23, gc: "zgc" }), zgc23);
  assert.deepEqual(flags({ javaMajor: 24, gc: "zgc" }), zgc23);
  assert.deepEqual(flags({ javaMajor: 25, gc: "zgc" }), ZGC_25);
  // forced: the heap and CPU thresholds of "auto" don't apply...
  assert.deepEqual(collectorsOn(flags({ javaMajor: 25, gc: "zgc", maxMemoryMb: 2048, cpuCount: 2 })), ["-XX:+UseZGC"]);
  // ...but ZGC does not exist for older Windows, or for Java before 21
  assert.deepEqual(flags({ javaMajor: 25, gc: "zgc", windowsBuild: 14393 }), G1(["-XX:+UseCompactObjectHeaders"]));
  assert.deepEqual(flags({ javaMajor: 21, gc: "zgc", windowsBuild: 14393 }), G1());
  assert.deepEqual(flags({ javaMajor: 17, gc: "zgc" }), G1());
  assert.deepEqual(flags({ javaMajor: 20, gc: "zgc" }), G1());
});

test("buildJvmFlags: an unknown gc setting behaves as auto", () => {
  assert.deepEqual(flags({ javaMajor: 25, gc: "shenandoah" }), ZGC_25);
  assert.deepEqual(flags({ javaMajor: 21, gc: 7 }), G1());
});

test("buildJvmFlags: -Xms follows the collector and the size of the PC", () => {
  const xms = (over) => flags(over).find((a) => a.startsWith("-Xms"));
  // ZGC: 2 GB at most, never above -Xmx
  assert.equal(xms({ javaMajor: 25, maxMemoryMb: 8192 }), "-Xms2048M");
  assert.equal(xms({ javaMajor: 25, maxMemoryMb: 4096 }), "-Xms2048M");
  assert.equal(xms({ javaMajor: 25, gc: "zgc", maxMemoryMb: 1536 }), "-Xms1536M");
  // G1 on a PC with 16 GB or more: the whole heap up front
  assert.equal(xms({ javaMajor: 21, maxMemoryMb: 6144, totalMemMb: 16384 }), "-Xms6144M");
  assert.equal(xms({ javaMajor: 21, maxMemoryMb: 6144, totalMemMb: 32600 }), "-Xms6144M");
  assert.equal(xms({ javaMajor: 8, maxMemoryMb: 4096, totalMemMb: 15900 }), "-Xms4096M", "a '16 GB' PC reports a bit less");
  // G1 on a smaller PC: half, but at least 1 GB, and never above -Xmx
  assert.equal(xms({ javaMajor: 21, maxMemoryMb: 6144, totalMemMb: 12200 }), "-Xms3072M");
  assert.equal(xms({ javaMajor: 21, maxMemoryMb: 3072, totalMemMb: 8100 }), "-Xms1536M");
  assert.equal(xms({ javaMajor: 8, maxMemoryMb: 1536, totalMemMb: 8100 }), "-Xms1024M");
  assert.equal(xms({ javaMajor: 8, maxMemoryMb: 512, totalMemMb: 4000 }), "-Xms512M");
  assert.equal(xms({ javaMajor: 17, maxMemoryMb: 2048, totalMemMb: undefined }), "-Xms1024M");
});

/* ---------------- the conflict rule ---------------- */

const GC_TUNING = /^-XX:(\+Use\w*GC|\+ZGenerational|G1\w+=|MaxGCPauseMillis=|\+ParallelRefProcEnabled)/;

test("buildJvmFlags: a collector in the player's arguments means none from Reminth", () => {
  const picks = ["-XX:+UseZGC", "-XX:+UseShenandoahGC", "-XX:+UseParallelGC", "-XX:+UseSerialGC", "-XX:+UseG1GC", "-XX:+UseConcMarkSweepGC", "-XX:-UseG1GC"];
  for (const javaMajor of [8, 16, 17, 21, 25]) {
    for (const gc of ["auto", "g1", "zgc"]) {
      for (const pick of picks) {
        const own = flags({ javaMajor, gc, userArgs: `-Dfoo=bar ${pick}` });
        assert.deepEqual(own.filter((a) => GC_TUNING.test(a)), [], `Java ${javaMajor}, gc ${gc}, player ${pick}: ${own.join(" ")}`);
        assertSane([...own, "-Dfoo=bar", pick], `Java ${javaMajor}, gc ${gc}, player ${pick}`);
        // heap and the rest are kept
        assert.ok(own.includes("-Xmx6144M") && own.some((a) => a.startsWith("-Xms")));
        assert.equal(own.includes("-XX:+UseCompactObjectHeaders"), javaMajor >= 25);
      }
    }
  }
  // The case that used to stop the game: -XX:+UseZGC typed in on Java 21.
  assert.deepEqual(flags({ javaMajor: 21, userArgs: "-XX:+UseZGC -XX:+ZGenerational" }), [
    "-XX:+IgnoreUnrecognizedVMOptions",
    "-Xms2048M", // their ZGC, so ZGC's heap shape
    "-Xmx6144M",
    "-XX:+UnlockExperimentalVMOptions",
    "-XX:+UseStringDeduplication",
    LOG4J,
  ]);
  // an array works as well as the typed string
  assert.deepEqual(collectorsOn(flags({ javaMajor: 25, userArgs: ["-XX:+UseShenandoahGC"] })), []);
  // flags that merely look similar are not collectors
  assert.deepEqual(flags({ javaMajor: 25, userArgs: "-XX:+UseStringDeduplication -XX:-UseGCOverheadLimit -XX:+UseLargePages" }), ZGC_25);
});

test("buildJvmFlags: the player's -Xmx / -Xms replace Reminth's", () => {
  // (settings refuse these today - see the store test below - but a launch must not break if one gets through)
  const d = flags({ javaMajor: 25, userArgs: "-XX:+UseShenandoahGC -Xmx3G" });
  assert.deepEqual(d, ["-XX:+IgnoreUnrecognizedVMOptions", "-Xms3072M", "-XX:+UnlockExperimentalVMOptions", "-XX:+UseCompactObjectHeaders", "-XX:+UseStringDeduplication", LOG4J]);

  // their smaller heap is what the ZGC decision and -Xms are worked out from
  const small = flags({ javaMajor: 25, userArgs: "-Xmx2G" });
  assert.equal(small.some((a) => a.startsWith("-Xmx")), false);
  assert.deepEqual(collectorsOn(small), ["-XX:+UseG1GC"], "2 GB is under ZGC's 4 GB");
  assert.ok(small.includes("-Xms2048M"));
  assert.ok(flags({ javaMajor: 21, totalMemMb: 8100, userArgs: "-Xmx4096m" }).includes("-Xms2048M"));
  assert.ok(flags({ javaMajor: 21, userArgs: "-Xmx1048576k" }).includes("-Xms1024M"));
  assert.ok(flags({ javaMajor: 21, userArgs: "-Xmx2147483648" }).includes("-Xms2048M"));
  // the last -Xmx is the one the JVM uses
  assert.ok(flags({ javaMajor: 21, userArgs: "-Xmx8G -Xmx2G" }).includes("-Xms2048M"));

  // -Xms only: theirs stays, Reminth's -Xmx stays
  const xmsOnly = flags({ javaMajor: 21, userArgs: "-Xms1G" });
  assert.equal(xmsOnly.some((a) => a.startsWith("-Xms")), false);
  assert.ok(xmsOnly.includes("-Xmx6144M"));
  // both
  const both = flags({ javaMajor: 8, userArgs: "-Xms1G -Xmx2G" });
  assert.equal(both.some((a) => /^-Xm[xs]/.test(a)), false);
  // a -Xmx that can't be read: no -Xms from Reminth that might exceed it
  const odd = flags({ javaMajor: 21, userArgs: "-Xmxlots" });
  assert.equal(odd.some((a) => /^-Xm[xs]/.test(a)), false);
});

test("buildJvmFlags: every combination is free of duplicates and has at most one collector", () => {
  const players = ["", "-Dfoo=bar", "-XX:+UseZGC", "-XX:+UseShenandoahGC -Xmx3G", "-XX:+UseG1GC -Xms1G", "-Xmx8G"];
  let checked = 0;
  for (const javaMajor of [undefined, 8, 11, 16, 17, 20, 21, 22, 23, 24, 25, 26]) {
    for (const gc of [undefined, "auto", "g1", "zgc"]) {
      for (const windowsBuild of [0, 9600, 17134, 26100]) {
        for (const maxMemoryMb of [1024, 2048, 4096, 8192]) {
          for (const cpuCount of [2, 4, 16]) {
            for (const totalMemMb of [8100, 32600]) {
              for (const userArgs of players) {
                const label = JSON.stringify({ javaMajor, gc, windowsBuild, maxMemoryMb, cpuCount, totalMemMb, userArgs });
                const own = buildJvmFlags({ javaMajor, gc, windowsBuild, maxMemoryMb, cpuCount, totalMemMb, userArgs });
                assertSane(own, label);
                // the whole command line, the player's arguments last
                const all = [...own, ...minecraft.splitArgs(userArgs)];
                assert.ok(collectorsOn(all).length <= 1, `${label}: ${all.join(" ")}`);
                assert.equal(all.filter((a) => a.startsWith("-Xmx")).length, 1, `${label}: ${all.join(" ")}`);
                assert.ok(all.filter((a) => a.startsWith("-Xms")).length <= 1, label);
                // never a flag the Java in use doesn't have
                const major = Number(javaMajor) || 8;
                if (major < 25) assert.equal(own.includes("-XX:+UseCompactObjectHeaders"), false, label);
                if (major < 21) assert.equal(own.includes("-XX:+UseZGC"), false, label);
                if (major < 21 || major > 22) assert.equal(own.includes("-XX:+ZGenerational"), false, label);
                if (major < 17) assert.equal(own.some((a) => /IgnoreUnrecognized|StringDeduplication|AlwaysPreTouch/.test(a)), false, label);
                // and never the things the plan rules out
                assert.equal(own.some((a) => /DisableExplicitGC|UseLargePages|MaxGCPauseMillis=200/.test(a)), false, label);
                checked++;
              }
            }
          }
        }
      }
    }
  }
  assert.ok(checked > 5000);
});

test("buildJvmFlags: safe mode is the heap limit and the log4j property, nothing else", () => {
  assert.deepEqual(flags({ javaMajor: 25, safeMode: true }), ["-Xmx6144M", LOG4J]);
  assert.deepEqual(flags({ javaMajor: 8, gc: "zgc", safeMode: true, maxMemoryMb: 2048, userArgs: "-XX:+UseZGC -Xmx9G" }), ["-Xmx2048M", LOG4J]);
});

test("windowsBuildNumber: the third part of os.release()", () => {
  assert.equal(windowsBuildNumber("10.0.19045"), 19045);
  assert.equal(windowsBuildNumber("10.0.26100"), 26100);
  assert.equal(windowsBuildNumber("6.3.9600"), 9600);
  assert.equal(windowsBuildNumber("10.0"), 0);
  assert.equal(windowsBuildNumber(""), 0);
  assert.equal(windowsBuildNumber("6.18.44-fc-v51"), 0, "not a Windows release string");
  assert.equal(typeof windowsBuildNumber(), "number");
});

/* ---------------- the safe-mode decision ---------------- */

const REFUSALS = {
  "Could not create the Java Virtual Machine": "Error: Could not create the Java Virtual Machine.\nError: A fatal exception has occurred. Program will exit.\n",
  "Unrecognized VM option": "Unrecognized VM option 'UseCompactObjectHeaders'\nError: Could not create the Java Virtual Machine.\n",
  "Multiple garbage collectors selected": "Error occurred during initialization of VM\nMultiple garbage collectors selected\n",
  "Error occurred during initialization of VM": "Error occurred during initialization of VM\nInitial heap size set to a larger value than the maximum heap size\n",
  "is experimental and must be enabled": "Error: VM option 'G1NewSizePercent' is experimental and must be enabled via -XX:+UnlockExperimentalVMOptions.\nError: Could not create the Java Virtual Machine.\n",
  "Invalid maximum heap size": "Invalid maximum heap size: -Xmx99999M\nThe specified size exceeds the maximum representable size.\nError: Could not create the Java Virtual Machine.\n",
  "Could not reserve enough space": "Error occurred during initialization of VM\r\nCould not reserve enough space for 8388608KB object heap\r\n",
  "Improperly specified VM option": "Improperly specified VM option 'MaxGCPauseMillis=fast'\nError: Could not create the Java Virtual Machine.\n",
};
const refused = (over) => planSafeModeRetry({ code: 1, elapsedMs: 600, logText: REFUSALS["Multiple garbage collectors selected"], alreadyRetried: false, maxMemoryMb: 6144, ...over });

test("planSafeModeRetry: each thing the JVM says when it refuses its arguments triggers one retry", () => {
  assert.deepEqual(Object.keys(REFUSALS).sort(), [...minecraft.JVM_REFUSAL_MARKERS].sort(), "every marker is covered here");
  for (const [marker, logText] of Object.entries(REFUSALS)) {
    const plan = refused({ logText });
    assert.equal(plan.retry, true, marker);
    assert.ok(plan.reason.includes(marker), `${marker}: reason was "${plan.reason}"`);
    assert.ok(plan.reason.length <= 200 && plan.reason === plan.reason.trim() && !/[\r\n]/.test(plan.reason));
  }
  // the line that names the cause, not the generic one above or below it
  assert.equal(refused({}).reason, "Multiple garbage collectors selected");
  assert.equal(refused({ logText: REFUSALS["Unrecognized VM option"] }).reason, "Unrecognized VM option 'UseCompactObjectHeaders'");
  // a very long line is cut to 200 characters
  assert.equal(refused({ logText: `   Unrecognized VM option '${"x".repeat(500)}'` }).reason.length, 200);
});

test("planSafeModeRetry: no retry for a clean exit, a slow exit, a second time, or an ordinary crash", () => {
  assert.equal(refused({ code: 0 }).retry, false, "exit code 0");
  assert.equal(refused({ code: null }).retry, false, "killed / never started: no exit code");
  assert.equal(refused({ code: undefined }).retry, false);
  assert.equal(refused({ elapsedMs: minecraft.SAFE_MODE_WINDOW_MS + 1 }).retry, false, "exited too late to be the JVM refusing to start");
  assert.equal(refused({ elapsedMs: 14000 }).retry, false);
  assert.equal(refused({ elapsedMs: undefined }).retry, false, "no timing - no guess");
  assert.equal(refused({ elapsedMs: minecraft.SAFE_MODE_WINDOW_MS }).retry, true);
  assert.equal(refused({ elapsedMs: 0 }).retry, true);
  assert.equal(refused({ alreadyRetried: true }).retry, false, "one retry per Play");
  assert.equal(refused({ logText: "" }).retry, false);
  assert.equal(refused({ logText: undefined }).retry, false);
  assert.equal(refused({ logText: 'Exception in thread "main" java.lang.NoClassDefFoundError: net/minecraft/client/main/Main\n' }).retry, false);
  assert.equal(refused({ logText: "java.lang.OutOfMemoryError: Java heap space\n" }).retry, false);
  assert.deepEqual(refused({ code: 0 }), { retry: false, reason: null, maxMemoryMb: 6144 });
  assert.equal(minecraft.SAFE_MODE_WINDOW_MS, 8000);
});

test("planSafeModeRetry: a heap the PC couldn't provide is retried with 2 GB at most", () => {
  assert.equal(refused({ logText: REFUSALS["Could not reserve enough space"] }).maxMemoryMb, 2048);
  assert.equal(refused({ logText: REFUSALS["Could not reserve enough space"] }).reason, "Could not reserve enough space for 8388608KB object heap");
  assert.equal(refused({ logText: REFUSALS["Invalid maximum heap size"] }).maxMemoryMb, 2048);
  assert.equal(refused({ logText: REFUSALS["Could not reserve enough space"], maxMemoryMb: 1024 }).maxMemoryMb, 1024, "never raised");
  // any other refusal keeps the player's memory
  assert.equal(refused({}).maxMemoryMb, 6144);
  assert.equal(refused({ logText: REFUSALS["Unrecognized VM option"] }).maxMemoryMb, 6144);
});

/* ---------------- memory default ---------------- */

test("defaultMaxMemoryMb: by PC size and kind of instance, never above the cap", () => {
  const table = [
    // [total MB, options, expected]
    [4 * GB, { capMb: 2048 }, 2048],
    [6 * GB, { capMb: 4096 }, 3072],
    [8100, { capMb: 5632 }, 3072], // what an "8 GB" PC reports
    [8 * GB, { capMb: 6144 }, 3072], // 8 GB or less: 3 GB, not 4
    [8 * GB + 1, { capMb: 6144 }, 4096],
    [12 * GB, { capMb: 10240 }, 6144],
    [16 * GB, { capMb: 14336 }, 6144],
    [64 * GB, { capMb: 16384 }, 6144],
    // modpacks, and instances with more than 60 mods: 8 GB where the PC can spare it
    [16 * GB, { capMb: 14336, modpack: true }, 8192],
    [16 * GB, { capMb: 14336, modCount: 61 }, 8192],
    [16 * GB, { capMb: 14336, modCount: 60 }, 6144],
    [64 * GB, { capMb: 16384, modpack: true, modCount: 300 }, 8192],
    [8 * GB, { capMb: 6144, modpack: true }, 4608], // about 60% of the PC, not all it can spare
    [8 * GB, { capMb: 6144, modCount: 120 }, 4608],
    [4 * GB, { capMb: 2048, modpack: true }, 2048],
    // the cap always wins
    [16 * GB, { capMb: 4096 }, 4096],
    [16 * GB, { capMb: 1024, modpack: true }, 1024],
    // no cap given: still leaves 2 GB for Windows
    [8 * GB, { modpack: true }, 4608],
    [16 * GB, {}, 6144],
    [16 * GB, undefined, 6144],
  ];
  for (const [total, options, expected] of table) {
    assert.equal(defaultMaxMemoryMb(total, options), expected, `${total} MB, ${JSON.stringify(options)}`);
  }
  // the bytes-in wrapper every caller uses
  assert.equal(minecraft.computeDefaultMaxMemoryMb(16 * 1024 ** 3), 6144);
  assert.equal(minecraft.computeDefaultMaxMemoryMb(8 * 1024 ** 3), 3072);
  assert.equal(minecraft.computeDefaultMaxMemoryMb(16 * 1024 ** 3, { modpack: true, capMb: 14336 }), 8192);
});

/* ---------------- settings ---------------- */

test("settings: gc and processPriority have defaults and only take known values", () => {
  assert.equal(store.DEFAULT_SETTINGS.gc, "auto");
  assert.equal(store.DEFAULT_SETTINGS.processPriority, "above-normal");
  for (const gc of ["auto", "g1", "zgc"]) assert.deepEqual(store.sanitizeSettings({ gc }), { gc });
  for (const processPriority of ["above-normal", "normal"]) assert.deepEqual(store.sanitizeSettings({ processPriority }), { processPriority });
  // anything else falls back to the default - never "high" or "realtime"
  for (const bad of ["ZGC", "shenandoah", "", null, 1, {}, ["zgc"], "-XX:+UseZGC"]) {
    assert.deepEqual(store.sanitizeSettings({ gc: bad }), { gc: "auto" }, `gc ${JSON.stringify(bad)}`);
    assert.deepEqual(store.sanitizeSettings({ gc: bad }, { strict: true }), { gc: "auto" });
  }
  for (const bad of ["high", "realtime", "above_normal", "", null, true, 2]) {
    assert.deepEqual(store.sanitizeSettings({ processPriority: bad }), { processPriority: "above-normal" }, `priority ${JSON.stringify(bad)}`);
  }
  // not mentioned -> not touched
  assert.deepEqual(store.sanitizeSettings({ fullscreen: true }), { fullscreen: true });
});

test("settings: gc and processPriority survive a save and a load", async () => {
  assert.equal((await store.loadSettings()).gc, "auto");
  const saved = await store.saveSettings({ gc: "zgc", processPriority: "normal" });
  assert.equal(saved.gc, "zgc");
  assert.equal(saved.processPriority, "normal");
  const loaded = await store.loadSettings();
  assert.equal(loaded.gc, "zgc");
  assert.equal(loaded.processPriority, "normal");
  await store.saveSettings({ gc: "nonsense" });
  assert.equal((await store.loadSettings()).gc, "auto");
  assert.equal((await store.loadSettings()).processPriority, "normal", "an unrelated save leaves it alone");
});

test("settings: -Xmx / -Xms in the extra arguments are still refused, a collector is allowed", () => {
  assert.throws(() => store.sanitizeSettings({ extraJvmArgs: "-XX:+UseShenandoahGC -Xmx3G" }, { strict: true }), /RAM slider/);
  assert.deepEqual(store.sanitizeSettings({ extraJvmArgs: "-XX:+UseZGC" }, { strict: true }), { extraJvmArgs: "-XX:+UseZGC" });
});

test("wantsAboveNormalPriority: only when asked for, and never with streamer mode on", () => {
  assert.equal(wantsAboveNormalPriority(store.DEFAULT_SETTINGS), true);
  assert.equal(wantsAboveNormalPriority({ processPriority: "above-normal", streamerMode: true }), false);
  assert.equal(wantsAboveNormalPriority({ processPriority: "normal" }), false);
  assert.equal(wantsAboveNormalPriority({ processPriority: "high" }), false);
  assert.equal(wantsAboveNormalPriority({}), false);
  assert.equal(wantsAboveNormalPriority(undefined), false);
});

/* ---------------- launch() itself, against the stand-in spawn ---------------- */

const ACCOUNT = { username: "p", uuid: "u", minecraftAccessToken: "t" };
function installResult(over = {}) {
  return {
    profile: {
      id: "26.1",
      mainClass: "net.minecraft.client.main.Main",
      assets: "30",
      arguments: { jvm: ["-Djava.library.path=${natives_directory}", "-cp", "${classpath}"], game: ["--username", "${auth_player_name}"] },
    },
    clientJarPath: "client.jar",
    libraries: [],
    javaPath: "C:\\java\\bin\\javaw.exe",
    javaMajor: 25,
    loggingArg: "-Dlog4j.configurationFile=client.xml",
    ...over,
  };
}
let priorityCalls = [];
const realSetPriority = os.setPriority;
function launch({ result, settings, options, onCrash, id = "perf" } = {}) {
  priorityCalls = [];
  os.setPriority = (pid, priority) => priorityCalls.push([pid, priority]);
  try {
    minecraft.launch(result || installResult(), ACCOUNT, onCrash || null, { maxMemoryMb: 6144, ...settings }, { id, gameDir: path.join(HOME, "game") }, options || {});
  } finally {
    os.setPriority = realSetPriority;
  }
  return spawned[spawned.length - 1];
}
const jvmPart = (run) => run.args.slice(0, run.args.indexOf("net.minecraft.client.main.Main"));

test("launch: Reminth's flags first, then the version's, then the player's - and one collector at most", () => {
  const run = launch({ settings: { extraJvmArgs: '-XX:+UseShenandoahGC -Dnote="a b"', gc: "auto" } });
  const jvm = jvmPart(run);
  assert.equal(run.file, "C:\\java\\bin\\javaw.exe");
  assert.deepEqual(collectorsOn(jvm), ["-XX:+UseShenandoahGC"], jvm.join(" "));
  assert.equal(jvm.some((a) => /G1|MaxGCPauseMillis|ZGenerational/.test(a)), false);
  assert.deepEqual(jvm.slice(-2), ["-XX:+UseShenandoahGC", "-Dnote=a b"], "the player's arguments are last");
  assert.ok(jvm.indexOf(LOG4J) < jvm.indexOf("-Dlog4j.configurationFile=client.xml"));
  assert.ok(jvm.indexOf("-Dlog4j.configurationFile=client.xml") < jvm.indexOf("-cp"));
  assert.ok(jvm.indexOf("-cp") < jvm.indexOf("-XX:+UseShenandoahGC"));
  assert.ok(jvm.includes("-Xmx6144M"));
  assert.ok(jvm.includes("-XX:+UseCompactObjectHeaders"), "the install result's Java 25 reached the builder");
  assert.deepEqual(run.args.slice(run.args.indexOf("net.minecraft.client.main.Main") + 1), ["--username", "p"]);
});

test("launch: the Java version comes from the install result; without one, the Java 8 set", () => {
  const expected = (javaMajor, extra = {}) =>
    buildJvmFlags({ javaMajor, maxMemoryMb: 6144, totalMemMb: Math.floor(os.totalmem() / 1024 ** 2), cpuCount: os.cpus().length, windowsBuild: windowsBuildNumber(), ...extra });
  for (const javaMajor of [8, 17, 21, 25]) {
    const jvm = jvmPart(launch({ result: installResult({ javaMajor }) }));
    assert.deepEqual(jvm.slice(0, expected(javaMajor).length), expected(javaMajor), `Java ${javaMajor}`);
    assert.ok(collectorsOn(jvm).length <= 1);
  }
  const unknown = jvmPart(launch({ result: installResult({ javaMajor: undefined }) }));
  assert.equal(unknown.includes("-XX:+IgnoreUnrecognizedVMOptions"), false);
  assert.ok(unknown.includes("-XX:+ParallelRefProcEnabled"));
  // the gc setting is passed through
  const g1 = jvmPart(launch({ settings: { gc: "g1" } }));
  assert.deepEqual(collectorsOn(g1), ["-XX:+UseG1GC"]);
  assert.deepEqual(g1.slice(0, expected(25, { gc: "g1" }).length), expected(25, { gc: "g1" }));
  // a collector in the version's own arguments counts like one from the player
  const fromProfile = installResult();
  fromProfile.profile.arguments.jvm = ["-XX:+UseZGC", "-cp", "${classpath}"];
  assert.deepEqual(collectorsOn(jvmPart(launch({ result: fromProfile, settings: { gc: "g1" } }))), ["-XX:+UseZGC"]);
});

test("launch: safe mode passes the heap limit, log4j and the version's own arguments - nothing of the player's", () => {
  const run = launch({ settings: { extraJvmArgs: "-XX:+UseZGC -XX:+UseG1GC -Dmine=1", gc: "zgc", maxMemoryMb: 2048 }, options: { safeMode: true } });
  assert.deepEqual(jvmPart(run), ["-Xmx2048M", LOG4J, "-Dlog4j.configurationFile=client.xml", `-Djava.library.path=${require("../src/main/paths").NATIVES_DIR}`, "-cp", "client.jar"]);
  assert.deepEqual(priorityCalls, [], "and normal priority");
});

test("launch: a safe-mode launch adds to the log, so the JVM's refusal stays readable", () => {
  const logPath = path.join(HOME, "AppData", "Roaming", "Reminth", "launch-logs", "keep.txt");
  launch({ id: "keep" });
  fs.writeFileSync(logPath, "Multiple garbage collectors selected\n");
  launch({ id: "keep", options: { safeMode: true } });
  assert.equal(fs.readFileSync(logPath, "utf8"), "Multiple garbage collectors selected\n");
  launch({ id: "keep" });
  assert.equal(fs.readFileSync(logPath, "utf8"), "", "a normal launch starts the log again");
});

test("launch: an early failed exit reports how long the game lived and whether it was safe mode", () => {
  const reports = [];
  const run = launch({ onCrash: (info) => reports.push(info) });
  run.child.emit("exit", 1, null);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].code, 1);
  assert.equal(reports[0].safeMode, false);
  assert.ok(reports[0].elapsedMs >= 0 && reports[0].elapsedMs < 5000);
  assert.ok(fs.existsSync(reports[0].logPath));
  const safe = launch({ onCrash: (info) => reports.push(info), options: { safeMode: true } });
  safe.child.emit("exit", 1, null);
  assert.equal(reports[1].safeMode, true);
  // a clean exit is not a crash
  launch({ onCrash: (info) => reports.push(info) }).child.emit("exit", 0, null);
  assert.equal(reports.length, 2);
});

test("launch: above-normal priority by default, normal when chosen or while streaming - never higher", () => {
  const run = launch({ settings: { processPriority: "above-normal" } });
  assert.deepEqual(priorityCalls, [[run.child.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL]]);
  launch({ settings: { processPriority: "normal" } });
  assert.deepEqual(priorityCalls, []);
  launch({ settings: { processPriority: "above-normal", streamerMode: true } });
  assert.deepEqual(priorityCalls, []);
  launch({ settings: {} });
  assert.deepEqual(priorityCalls, [], "no setting - left alone");
  // Windows refusing must not stop the launch
  os.setPriority = () => {
    throw new Error("EACCES");
  };
  try {
    const before = spawned.length;
    minecraft.launch(installResult(), ACCOUNT, null, { maxMemoryMb: 2048, processPriority: "above-normal" }, { id: "perf", gameDir: path.join(HOME, "game") });
    assert.equal(spawned.length, before + 1);
  } finally {
    os.setPriority = realSetPriority;
  }
});

/* ---------------- java.js ---------------- */

test("java: majorFor reads the version's Java, 8 when it names none", () => {
  assert.equal(java.majorFor({ component: "java-runtime-epsilon", majorVersion: 25 }), 25);
  assert.equal(java.majorFor({ component: "java-runtime-delta", majorVersion: 21 }), 21);
  assert.equal(java.majorFor(undefined), 8);
  assert.equal(java.majorFor({ majorVersion: "x" }), 8);
});

test("java: installedJavawPaths lists Reminth's own runtimes that are really there", async () => {
  const paths = require("../src/main/paths");
  assert.deepEqual(await java.installedJavawPaths(), [], "nothing installed yet");
  const make = (dir) => {
    const file = path.join(dir, "bin", "javaw.exe");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "");
    return file;
  };
  const legacy = make(paths.JAVA_DIR);
  const gamma = make(path.join(paths.RUNTIMES_DIR, "java-runtime-gamma"));
  const ms = make(path.join(paths.RUNTIMES_DIR, "ms-jdk-21"));
  fs.mkdirSync(path.join(paths.RUNTIMES_DIR, "jre-legacy", "bin"), { recursive: true }); // half-installed: no javaw.exe
  fs.writeFileSync(path.join(paths.RUNTIMES_DIR, "stray.txt"), "");
  const found = await java.installedJavawPaths();
  assert.deepEqual([...found].sort(), [legacy, gamma, ms].sort());
  for (const file of found) assert.ok(path.isAbsolute(file));
});
