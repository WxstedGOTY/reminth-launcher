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

/** Newest-used first, each with its image as a data URL. */
async function list() {
  const entries = await readIndex();
  const out = [];
  for (const e of entries) {
    try {
      const buf = await fsp.readFile(path.join(paths.SKIN_LIBRARY_DIR, `${e.id}.png`));
      out.push({ ...e, dataUrl: "data:image/png;base64," + buf.toString("base64") });
    } catch {
      // image went missing - drop it from the listing
    }
  }
  return out.sort((a, b) => (b.lastUsed || b.addedAt) - (a.lastUsed || a.addedAt));
}

/**
 * Adds (or refreshes) a skin. `png` is a Buffer. Returns the entry.
 * Adding one that's already saved just bumps it to the front.
 */
async function add({ png, variant, name, source, used }) {
  const problem = validateSkinPng(png);
  if (problem) throw new Error(problem);
  const id = crypto.createHash("sha1").update(png).digest("hex");
  const entries = await readIndex();
  const now = Date.now();
  const existing = entries.find((e) => e.id === id);
  if (existing) {
    if (variant) existing.variant = variant === "slim" ? "slim" : "classic";
    if (used) existing.lastUsed = now;
    if (name && !existing.renamed) existing.name = String(name).slice(0, 40);
  } else {
    await fsp.mkdir(paths.SKIN_LIBRARY_DIR, { recursive: true });
    await fsp.writeFile(path.join(paths.SKIN_LIBRARY_DIR, `${id}.png`), png);
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

async function rename(id, name) {
  const entries = await readIndex();
  const e = entries.find((x) => x.id === id);
  if (!e) throw new Error("That saved skin is gone.");
  e.name = String(name || "Skin").trim().slice(0, 40) || "Skin";
  e.renamed = true;
  await writeIndex(entries);
  return e;
}

async function remove(id) {
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
