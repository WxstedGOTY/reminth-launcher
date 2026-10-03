"use strict";
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
// Node 18+ (and Electron's bundled Node) ships a global fetch - no npm package needed.

const METADATA_TIMEOUT_MS = 30000; // version manifests, loader meta, release lists, .sha1 sidecars
const STALL_TIMEOUT_MS = 30000; // a body download is only given up on when no bytes arrive for this long
const DOWNLOAD_RETRIES = 2;
const RETRY_DELAY_MS = 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function hostOf(url) {
  try {
    return new URL(String(url)).hostname;
  } catch {
    return String(url);
  }
}

/** A fetch that was aborted by a timeout, turned into something a player can read. */
function readableFetchError(err, url) {
  if (err && (err.name === "TimeoutError" || err.name === "AbortError")) {
    const out = new Error(`Timed out reaching ${hostOf(url)}`);
    out.code = "ETIMEDOUT";
    return out;
  }
  return err;
}

/**
 * Runs `fn(signal)` - a small metadata request - with a hard time limit, so a
 * server that accepts the connection and then says nothing can't hang an
 * install forever. Only for small responses: a total cap would kill a large
 * download on a slow line, which is what downloadFile's stall timer is for.
 */
async function withTimeout(url, fn, ms = METADATA_TIMEOUT_MS) {
  try {
    return await fn(AbortSignal.timeout(ms));
  } catch (err) {
    throw readableFetchError(err, url);
  }
}

/**
 * Windows refuses to rename onto (or away from) a file another process has
 * open - antivirus scanning a file that was just written is the usual one -
 * and reports it as EBUSY/EPERM/EACCES. Those clear within moments, so try
 * a few times before giving up.
 */
async function renameWithRetry(from, to, attempts = 5) {
  for (let n = 1; ; n++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (err) {
      if (n >= attempts || !["EBUSY", "EPERM", "EACCES"].includes(err && err.code)) throw err;
      await sleep(80 * n);
    }
  }
}

// A leftover is only swept once it's this old. A download that is still
// alive writes at least every STALL_TIMEOUT_MS, so nothing in use is older.
const LEFTOVER_AGE_MS = 10 * 60 * 1000;

/**
 * Removes "<name>.<random>.part" / ".tmp" files next to `filePath` that a
 * launcher killed mid-write left behind. Their names are random, so nothing
 * ever overwrote or deleted them and they piled up for good. Best-effort:
 * never throws, and never touches a file younger than LEFTOVER_AGE_MS.
 */
async function sweepLeftovers(filePath, ext, maxAgeMs = LEFTOVER_AGE_MS) {
  try {
    const dir = path.dirname(filePath);
    const prefix = path.basename(filePath) + ".";
    const tail = new RegExp(`^[0-9a-f]{8,16}\\.${ext}$`);
    for (const name of await fsp.readdir(dir)) {
      if (!name.startsWith(prefix) || !tail.test(name.slice(prefix.length))) continue;
      const full = path.join(dir, name);
      try {
        const stat = await fsp.stat(full);
        if (stat.isFile() && Date.now() - stat.mtimeMs > maxAgeMs) await fsp.unlink(full);
      } catch {
        // gone already, or still held open by something - leave it
      }
    }
  } catch {
    // no such folder yet, or it can't be listed - nothing to sweep
  }
}

/** Writes a small file so that a crash mid-write can't leave half of it behind. */
async function writeFileAtomic(filePath, data) {
  await sweepLeftovers(filePath, "tmp");
  const tmp = `${filePath}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    await fsp.writeFile(tmp, data);
    await renameWithRetry(tmp, filePath);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Download a URL to a file, skipping if it already exists with a matching
 * hash. `algo` defaults to "sha1" (what Mojang's manifest and Maven sidecar
 * files use); pass "sha256" for sources that publish that instead (e.g. a
 * ReminthHUD update manifest). If `expectedHash` is falsy, no verification is
 * done - only use that for sources with no published hash at all.
 *
 * The bytes go to "<dest>.<random>.part" and are renamed into place only
 * once they're complete and verified, so a launcher that's killed mid-way
 * never leaves a half-written file under the real name (which used to pass
 * every later "is it there?" check forever). `options.size` is the expected
 * byte count when the source publishes one; `options.retryDelayMs` and
 * `options.stallMs` exist for the tests.
 */
async function downloadFile(url, destPath, expectedHash, algo = "sha1", options = {}) {
  const expectedSize = Number.isFinite(options.size) && options.size >= 0 ? options.size : null;
  if (await isAlreadyThere(destPath, expectedHash, algo, expectedSize)) return;
  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  await sweepLeftovers(destPath, "part");

  const delay = options.retryDelayMs === undefined ? RETRY_DELAY_MS : options.retryDelayMs;
  for (let attempt = 0; ; attempt++) {
    const part = `${destPath}.${crypto.randomBytes(6).toString("hex")}.part`;
    try {
      await fetchToFile(url, part, expectedHash, algo, expectedSize, options.stallMs || STALL_TIMEOUT_MS);
      try {
        await renameWithRetry(part, destPath);
      } catch (err) {
        // Still locked after the retries. If what's sitting there is already
        // the right file (a second launch fetched it at the same moment),
        // that's a success, not an error.
        if (!(expectedHash && (await matchesHash(destPath, expectedHash, algo)))) throw err;
        await fsp.rm(part, { force: true }).catch(() => {});
      }
      return;
    } catch (err) {
      await fsp.rm(part, { force: true }).catch(() => {});
      if (attempt >= DOWNLOAD_RETRIES || !err || !err.retryable) throw err;
      await sleep(delay * (attempt + 1));
    }
  }
}

async function isAlreadyThere(destPath, expectedHash, algo, expectedSize) {
  if (expectedHash) return matchesHash(destPath, expectedHash, algo);
  // Nothing to hash against. The size (when the source gives one) still
  // catches a truncated file, and an empty file is never a real download.
  try {
    const stat = await fsp.stat(destPath);
    if (!stat.isFile() || stat.size === 0) return false;
    return expectedSize === null || stat.size === expectedSize;
  } catch {
    return false;
  }
}

/** One attempt: stream the response into `part`, hashing as it goes, and verify it. */
async function fetchToFile(url, part, expectedHash, algo, expectedSize, stallMs) {
  const controller = new AbortController();
  let stalled = false;
  let timer = null;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      controller.abort();
    }, stallMs);
  };
  const retryable = (err) => {
    err.retryable = true;
    return err;
  };

  let handle = null;
  try {
    arm();
    let res;
    try {
      res = await fetch(url, { signal: controller.signal });
    } catch (err) {
      throw retryable(stalled ? readableFetchError({ name: "TimeoutError" }, url) : err);
    }
    if (!res.ok) {
      const err = new Error(`Download failed (${res.status}): ${url}`);
      // 5xx and "slow down" are the server having a moment; 4xx is an answer.
      if (res.status >= 500 || res.status === 429 || res.status === 408) err.retryable = true;
      throw err;
    }

    const hash = expectedHash ? crypto.createHash(algo) : null;
    let received = 0;
    handle = await fsp.open(part, "w");
    try {
      if (res.body && typeof res.body.getReader === "function") {
        const reader = res.body.getReader();
        for (;;) {
          arm();
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
          if (hash) hash.update(chunk);
          received += chunk.length;
          await handle.writeFile(chunk);
        }
      } else {
        const buf = Buffer.from(await res.arrayBuffer());
        if (hash) hash.update(buf);
        received = buf.length;
        await handle.writeFile(buf);
      }
    } catch (err) {
      // The connection dropped (or went silent) part-way through the body.
      throw retryable(stalled ? readableFetchError({ name: "TimeoutError" }, url) : err);
    }
    await handle.close();
    handle = null;

    if (expectedSize !== null && received !== expectedSize) {
      throw retryable(new Error(`Incomplete download for ${url}: expected ${expectedSize} bytes, got ${received}`));
    }
    if (hash) {
      const actual = hash.digest("hex");
      if (actual !== String(expectedHash).toLowerCase()) {
        // Almost always a transfer cut short or mangled on the way, so it's
        // worth another go before telling the player.
        throw retryable(new Error(`Checksum mismatch (${algo}) for ${url}: expected ${expectedHash}, got ${actual}`));
      }
    }
  } finally {
    clearTimeout(timer);
    if (handle) {
      // Bailed out part-way (disk full, dropped connection): let go of both
      // the socket and the file so the .part can be deleted.
      controller.abort();
      await handle.close().catch(() => {});
    }
  }
}

async function matchesHash(filePath, expectedHash, algo = "sha1") {
  if (!expectedHash) return fileExists(filePath);
  try {
    return (await hashFile(filePath, algo)) === String(expectedHash).toLowerCase();
  } catch {
    return false;
  }
}

/** Streams the file through the hash rather than reading it whole - client jars and JDK files are big. */
function hashFile(filePath, algo = "sha1") {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algo);
    fs.createReadStream(filePath)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Maven repos (Fabric's maven.fabricmc.net included) conventionally serve a
 * "<artifact>.sha1" sidecar next to every jar - standard Maven checksum
 * layout. Fabric API and Fabric-loader-style maven-coordinate libraries
 * don't get a sha1 from any manifest/profile JSON the way Mojang's own
 * libraries do, so this is how we still verify them instead of trusting
 * TLS alone. Returns null (never throws) if the sidecar is missing/broken -
 * callers should treat that as "can't verify," not a hard failure, since a
 * handful of older Maven layouts don't publish one.
 */
async function fetchMavenSha1(jarUrl) {
  try {
    const text = await withTimeout(jarUrl, async (signal) => {
      const res = await fetch(jarUrl + ".sha1", { signal });
      return res.ok ? (await res.text()).trim() : null;
    });
    if (text === null) return null;
    const match = text.match(/^[0-9a-fA-F]{40}/);
    return match ? match[0].toLowerCase() : null;
  } catch {
    return null;
  }
}

async function fileExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run `items` through `worker` with at most `concurrency` in flight at once.
 *
 * When one fails, no further items are started, but the ones already running
 * are waited for before this rejects (with the first error). It used to
 * reject straight away and leave the rest running in the background, so a
 * retry started a second pool writing the same files as the first.
 */
async function runPool(items, concurrency, worker) {
  let i = 0;
  let active = 0;
  let failed = false;
  let firstError = null;
  return new Promise((resolve, reject) => {
    const next = () => {
      if (failed) {
        if (active === 0) reject(firstError);
        return;
      }
      if (i >= items.length && active === 0) return resolve();
      while (!failed && active < concurrency && i < items.length) {
        const item = items[i++];
        active++;
        // Promise.resolve().then so a worker that throws synchronously is
        // counted as a failure like any other, not an escaped exception.
        Promise.resolve()
          .then(() => worker(item))
          .then(
            () => {
              active--;
              next();
            },
            (err) => {
              active--;
              if (!failed) {
                failed = true;
                firstError = err;
              }
              next();
            }
          );
      }
    };
    next();
  });
}

async function fetchJson(url) {
  return withTimeout(url, async (signal) => {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    return res.json();
  });
}

module.exports = {
  downloadFile,
  runPool,
  fetchJson,
  fileExists,
  fetchMavenSha1,
  withTimeout,
  renameWithRetry,
  writeFileAtomic,
  sweepLeftovers,
  hashFile,
};
