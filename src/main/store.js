"use strict";
/**
 * Persists the signed-in account (mainly the MS refresh token) to disk
 * so players don't have to sign in every single launch. Encrypted with
 * Electron's OS-backed safeStorage (DPAPI on Windows) when available.
 */
const fs = require("fs");
const fsp = fs.promises;
const { safeStorage } = require("electron");
const paths = require("./paths");

async function saveAccount(account) {
  await fsp.mkdir(paths.ROOT, { recursive: true });
  const json = JSON.stringify(account);
  if (safeStorage.isEncryptionAvailable()) {
    const enc = safeStorage.encryptString(json);
    await fsp.writeFile(paths.ACCOUNTS_FILE, enc);
  } else {
    await fsp.writeFile(paths.ACCOUNTS_FILE, json, "utf8");
  }
}

async function loadAccount() {
  try {
    const raw = await fsp.readFile(paths.ACCOUNTS_FILE);
    if (safeStorage.isEncryptionAvailable() && isLikelyEncrypted(raw)) {
      return JSON.parse(safeStorage.decryptString(raw));
    }
    return JSON.parse(raw.toString("utf8"));
  } catch {
    return null;
  }
}

function isLikelyEncrypted(buf) {
  // Plain JSON always starts with "{" (0x7b); DPAPI/keychain blobs don't.
  return buf.length > 0 && buf[0] !== 0x7b;
}

async function clearAccount() {
  await fsp.rm(paths.ACCOUNTS_FILE, { force: true });
}

module.exports = { saveAccount, loadAccount, clearAccount };
