"use strict";
/**
 * "Skins you've worn before." Every skin applied through Reminth - and the
 * skin the account is wearing when the Skin page first loads - is kept
 * here, so switching skins never means losing the old one.
 *
 * Stored as plain PNGs + one JSON index under paths.SKIN_LIBRARY_DIR. The
 * same image is never stored twice (keyed by its sha1).
 */
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");

const paths = require("./paths");
const { validateSkinPng } = require("./skin");

const INDEX = () => path.join(paths.SKIN_LIBRARY_DIR, "library.json");
const MAX_SKINS = 200;

async function readIndex() {
  try {
    const parsed = JSON.parse(await fsp.readFile(INDEX(), "utf8"));
    return Array.isArray(parsed) ? parsed.filter((e) => e && /^[0-9a-f]{40}$/.test(e.id)) : [];
  } catch {
    return [];
  }
}

async function writeIndex(list) {
  await fsp.mkdir(paths.SKIN_LIBRARY_DIR, { recursive: true });
  await fsp.writeFile(INDEX() + ".tmp", JSON.stringify(list, null, 2));
  await fsp.rename(INDEX() + ".tmp", INDEX());
}

const pngPath = (id) => path.join(paths.SKIN_LIBRARY_DIR, `${id}.png`);

async function pngExists(id) {
  try {
    await fsp.access(pngPath(id));
    return true;
  } catch {
    return false;
  }
}

/**
 * Every change to the index is read-modify-write, and the skin page fires
 * several at once (auto-save of the current skin while the player saves
 * another). Run one at a time or the later write drops the earlier entry.
 */
let queue = Promise.resolve();
function mutate(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

/** Newest-used first, each with its image as a data URL. */
async function list() {
  const entries = await readIndex();
  const out = [];
  const missing = [];
  for (const e of entries) {
    try {
      const buf = await fsp.readFile(pngPath(e.id));
      out.push({ ...e, dataUrl: "data:image/png;base64," + buf.toString("base64") });
    } catch (err) {
      // Only "the file is gone" means the entry is dead; a file that's
      // merely locked right now is left alone and shows up next time.
      if (err && err.code === "ENOENT") missing.push(e.id);
    }
  }
  if (missing.length) {
    // Drop them from the index too, or they sit there forever counting
    // towards MAX_SKINS. Re-checked inside the queue: an add() running
    // alongside may have just put the image back.
    await mutate(async () => {
      const gone = new Set();
      for (const id of missing) if (!(await pngExists(id))) gone.add(id);
      if (!gone.size) return;
      const current = await readIndex();
      const kept = current.filter((e) => !gone.has(e.id));
      if (kept.length !== current.length) await writeIndex(kept);
    }).catch(() => {
      // listing still works; the index gets tidied on a later call
    });
  }
  return out.sort((a, b) => (b.lastUsed || b.addedAt) - (a.lastUsed || a.addedAt));
}

/**
 * Adds (or refreshes) a skin. `png` is a Buffer. Returns the entry.
 * Adding one that's already saved just bumps it to the front.
 */
function add(skin) {
  return mutate(() => addNow(skin));
}

async function addNow({ png, variant, name, source, used }) {
  const problem = validateSkinPng(png);
  if (problem) throw new Error(problem);
  const id = crypto.createHash("sha1").update(png).digest("hex");
  // Written whenever it isn't on disk, not only for a new entry - saving a
  // skin whose image was deleted has to bring the image back. Temp file +
  // rename so a half-written PNG is never taken for a complete one.
  if (!(await pngExists(id))) {
    await fsp.mkdir(paths.SKIN_LIBRARY_DIR, { recursive: true });
    await fsp.writeFile(pngPath(id) + ".tmp", png);
    await fsp.rename(pngPath(id) + ".tmp", pngPath(id));
  }
  const entries = await readIndex();
  const now = Date.now();
  const existing = entries.find((e) => e.id === id);
  if (existing) {
    if (variant) existing.variant = variant === "slim" ? "slim" : "classic";
    if (used) existing.lastUsed = now;
    if (name && !existing.renamed) existing.name = String(name).slice(0, 40);
  } else {
    entries.push({
      id,
      name: String(name || "Skin").slice(0, 40),
      variant: variant === "slim" ? "slim" : "classic",
      source: ["upload", "account", "default", "username"].includes(source) ? source : "upload",
      addedAt: now,
      lastUsed: used ? now : null,
    });
  }
  // Keep the newest MAX_SKINS - a history, not an unbounded pile.
  entries.sort((a, b) => (b.lastUsed || b.addedAt) - (a.lastUsed || a.addedAt));
  for (const dropped of entries.splice(MAX_SKINS)) {
    await fsp.rm(path.join(paths.SKIN_LIBRARY_DIR, `${dropped.id}.png`), { force: true });
  }
  await writeIndex(entries);
  return entries.find((e) => e.id === id);
}

function rename(id, name) {
  return mutate(() => renameNow(id, name));
}

async function renameNow(id, name) {
  const entries = await readIndex();
  const e = entries.find((x) => x.id === id);
  if (!e) throw new Error("That saved skin is gone.");
  e.name = String(name || "Skin").trim().slice(0, 40) || "Skin";
  e.renamed = true;
  await writeIndex(entries);
  return e;
}

function remove(id) {
  return mutate(() => removeNow(id));
}

async function removeNow(id) {
  if (!/^[0-9a-f]{40}$/.test(String(id))) throw new Error("Unknown skin.");
  const entries = (await readIndex()).filter((e) => e.id !== id);
  await fsp.rm(path.join(paths.SKIN_LIBRARY_DIR, `${id}.png`), { force: true });
  await writeIndex(entries);
  return { ok: true };
}

async function getPng(id) {
  if (!/^[0-9a-f]{40}$/.test(String(id))) throw new Error("Unknown skin.");
  return fsp.readFile(path.join(paths.SKIN_LIBRARY_DIR, `${id}.png`));
}

module.exports = { list, add, rename, remove, getPng };
