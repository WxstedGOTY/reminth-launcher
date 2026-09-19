"use strict";
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
// Node 18+ (and Electron's bundled Node) ships a global fetch - no npm package needed.

/**
 * Download a URL to a file, skipping if it already exists with a matching
 * hash. `algo` defaults to "sha1" (what Mojang's manifest and Maven sidecar
 * files use); pass "sha256" for sources that publish that instead (e.g. a
 * ReminthHUD update manifest). If `expectedHash` is falsy, no verification is
 * done - only use that for sources with no published hash at all.
 */
async function downloadFile(url, destPath, expectedHash, algo = "sha1") {
  if (await matchesHash(destPath, expectedHash, algo)) return;
  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (expectedHash) {
    const actual = crypto.createHash(algo).update(buf).digest("hex");
    if (actual !== expectedHash.toLowerCase()) {
      throw new Error(
        `Checksum mismatch (${algo}) for ${url}: expected ${expectedHash}, got ${actual}`
      );
    }
  }
  await fsp.writeFile(destPath, buf);
}

async function matchesHash(filePath, expectedHash, algo = "sha1") {
  if (!expectedHash) return fileExists(filePath);
  try {
    const buf = await fsp.readFile(filePath);
    const actual = crypto.createHash(algo).update(buf).digest("hex");
    return actual === expectedHash.toLowerCase();
  } catch {
    return false;
  }
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
    const res = await fetch(jarUrl + ".sha1");
    if (!res.ok) return null;
    const text = (await res.text()).trim();
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

/** Run `items` through `worker` with at most `concurrency` in flight at once. */
async function runPool(items, concurrency, worker) {
  let i = 0;
  let active = 0;
  let rejected = null;
  return new Promise((resolve, reject) => {
    const next = () => {
      if (rejected) return;
      if (i >= items.length && active === 0) return resolve();
      while (active < concurrency && i < items.length) {
        const item = items[i++];
        active++;
        worker(item)
          .then(() => {
            active--;
            next();
          })
          .catch((err) => {
            rejected = err;
            reject(err);
          });
      }
    };
    next();
  });
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

module.exports = { downloadFile, runPool, fetchJson, fileExists, fetchMavenSha1 };
