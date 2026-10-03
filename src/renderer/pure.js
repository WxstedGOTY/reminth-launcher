"use strict";
/**
 * Small pure rules the renderer uses, kept in one file that also loads in
 * Node so they can be tested (test/home-play.test.js). No DOM, no state:
 * everything comes in as arguments. In the page they are globals
 * (window.ReminthPure); renderer.js and features.js read them from there.
 */
(function (root) {
  /**
   * The instance the Home hero is about: the one played most recently
   * (largest lastPlayed). Never played anything: the one selected in the
   * rail, else the first. A tie keeps the earlier one in the list. Anything
   * that isn't a usable instance is skipped.
   */
  function heroInstance(list, selectedId) {
    const items = (Array.isArray(list) ? list : []).filter((i) => i && typeof i.id === "string");
    let best = null;
    for (const i of items) {
      const t = Number(i.lastPlayed);
      if (!Number.isFinite(t) || t <= 0) continue;
      if (!best || t > Number(best.lastPlayed)) best = i;
    }
    return best || items.find((i) => i.id === selectedId) || items[0] || null;
  }

  /**
   * The instance list with `instanceId` marked as played at `at` (ms), so
   * Home's hero can move to it the moment its game starts, before the list
   * is read again. A newer lastPlayed already there is kept. Returns a new
   * list; the instances in it are copies only where something changed.
   */
  function markPlayed(list, instanceId, at) {
    const items = Array.isArray(list) ? list : [];
    const t = Number(at);
    if (!Number.isFinite(t) || t <= 0) return items.slice();
    return items.map((i) => (i && i.id === instanceId && !(Number(i.lastPlayed) >= t) ? { ...i, lastPlayed: t } : i));
  }

  /**
   * A server address as players write it: "host", "host:port",
   * "[ipv6]" / "[ipv6]:port", or a bare IPv6 address (more than one ":",
   * no brackets - no port can be told apart then). Returns
   * { host, port, ipv6 } or null. The port defaults to 25565 and must be
   * 1-65535.
   */
  function parseServerAddress(text) {
    const s = String(text === undefined || text === null ? "" : text).trim();
    if (!s || s.length > 300 || /\s/.test(s)) return null;
    const port = (p) => {
      if (p === undefined || p === "") return 25565;
      if (!/^\d{1,5}$/.test(p)) return null;
      const n = Number(p);
      return n >= 1 && n <= 65535 ? n : null;
    };
    const bracket = /^\[([0-9A-Fa-f:.]{2,45})\](?::(\d*))?$/.exec(s);
    if (bracket) {
      const p = port(bracket[2]);
      return bracket[1].includes(":") && p !== null ? { host: bracket[1], port: p, ipv6: true } : null;
    }
    if ((s.match(/:/g) || []).length > 1) {
      return /^[0-9A-Fa-f:.]{2,45}$/.test(s) ? { host: s, port: 25565, ipv6: true } : null;
    }
    const m = /^([A-Za-z0-9._-]{1,253})(?::(\d*))?$/.exec(s);
    if (!m) return null;
    const p = port(m[2]);
    return p === null ? null : { host: m[1], port: p, ipv6: false };
  }

  /* ---------------- the Play warning ---------------- */

  /**
   * What Play asks about, from a compatibility answer:
   *  - { kind: "blocked", issues } - mods that stop the game from starting
   *    (always wins when both kinds are there);
   *  - { kind: "risky", issues }   - mods built for (listed for) another
   *    Minecraft version: they load, but can crash the game in play;
   *  - null                        - nothing to ask.
   * `skip` is the instance's "don't ask again" fingerprint: the risky
   * question isn't asked while it equals the answer's modSet (the same
   * switched-on mods). Blocked mods are never skipped by it.
   */
  function modWarning(result, skip) {
    const issues = (result && Array.isArray(result.issues) ? result.issues : []).filter(Boolean);
    const blocked = issues.filter((i) => i.severity === "blocked");
    if (blocked.length) return { kind: "blocked", issues: blocked };
    const risky = issues.filter((i) => i.file && i.reason === "wrong-mc" && i.listedElsewhere === true && i.severity === "warn");
    if (!risky.length) return null;
    if (skip && result.modSet && skip === result.modSet) return null;
    return { kind: "risky", issues: risky };
  }

  /** The risky warning's sentence: "2 mods are built for another Minecraft version and may crash the game: A and B." */
  function riskyText(issues) {
    const names = (issues || []).map((i) => i.title || i.file).filter(Boolean);
    const n = names.length;
    const list = n <= 1 ? names.join("") : n === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, -1).join(", ")} and ${names[n - 1]}`;
    return `${n} ${n === 1 ? "mod is" : "mods are"} built for another Minecraft version and may crash the game: ${list}.`;
  }

  /* ---------------- the project page ---------------- */

  const LOADER_NAMES = { fabric: "Fabric", quilt: "Quilt", forge: "Forge", neoforge: "NeoForge", vanilla: "Vanilla" };

  /**
   * Which Modrinth loader names a build needs to have to work in this
   * instance, per kind of content (the same lists as content.loadersFor).
   * Empty = can't go into this instance at all.
   */
  function wantedLoaders(kind, inst) {
    if (!inst) return [];
    if (kind === "mod") {
      if (inst.loader === "fabric") return ["fabric"];
      if (inst.loader === "quilt") return ["quilt", "fabric"];
      if (inst.loader === "forge") return ["forge"];
      if (inst.loader === "neoforge") return inst.mcVersion === "1.20.1" ? ["neoforge", "forge"] : ["neoforge"];
      return [];
    }
    if (kind === "shader") return inst.loader === "vanilla" ? [] : ["iris", "optifine"];
    if (kind === "resourcepack") return ["minecraft"];
    if (kind === "datapack") return ["datapack"];
    return [];
  }

  /**
   * Does this project have a build for the instance picked in Discover?
   * builds: [{ type, mc: [...], loaders: [...] }] (projectPage.js), or null
   * when the version list couldn't be read. Returns
   * { state: "fits" | "beta-only" | "no-build" | "needs-loader" | "unknown" | "not-for-instance", text }.
   */
  function fitsInstance(projectType, builds, inst) {
    if (projectType === "modpack") return { state: "not-for-instance", text: "Installs as a new instance of its own." };
    if (!inst) return { state: "unknown", text: "" };
    const loaders = wantedLoaders(projectType, inst);
    const where = `${inst.mcVersion}${projectType === "mod" || projectType === "shader" ? " " + (LOADER_NAMES[inst.loader] || inst.loader) : ""}`;
    if (!loaders.length) {
      return { state: "needs-loader", text: `${inst.name} is a vanilla instance - ${projectType === "shader" ? "shaders" : "mods"} need Fabric, Quilt, Forge or NeoForge.` };
    }
    if (!Array.isArray(builds)) return { state: "unknown", text: "Couldn't check which versions it has builds for." };
    const fitting = builds.filter((b) => b && Array.isArray(b.mc) && b.mc.includes(inst.mcVersion) && (b.loaders || []).some((l) => loaders.includes(l)));
    if (!fitting.length) return { state: "no-build", text: `No build for ${where} yet.` };
    if (!fitting.some((b) => b.type === "release")) {
      return { state: "beta-only", text: `Only a ${fitting.some((b) => b.type === "beta") ? "beta" : "alpha"} build fits ${inst.name} (${where}).` };
    }
    return { state: "fits", text: `Fits your instance ${inst.name} (${where}).` };
  }

  const mcParts = (v) => {
    const m = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(String(v || ""));
    return m ? [Number(m[1]), Number(m[2]), m[3] === undefined ? 0 : Number(m[3])] : null;
  };

  /**
   * Many game versions as a few ranges, newest first: releases grouped by
   * their family (1.21, 1.20, 26...) - "1.21-1.21.4", "26.1-26.3" - instead
   * of 300 chips. Snapshots and other odd ids are only counted.
   * Returns { ranges: [text], other: count }.
   */
  function collapseVersions(list) {
    const families = new Map(); // "1.21" -> [[1,21,4], ...]
    let other = 0;
    for (const v of new Set(Array.isArray(list) ? list : [])) {
      const p = mcParts(v);
      if (!p) {
        other++;
        continue;
      }
      // 1.x versions group by their minor (1.20, 1.21...); the year-style
      // ones (26.1, 26.2...) by their year.
      const key = p[0] === 1 ? `${p[0]}.${p[1]}` : `${p[0]}`;
      if (!families.has(key)) families.set(key, []);
      families.get(key).push(p);
    }
    const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    const text = (p) => (p[2] ? `${p[0]}.${p[1]}.${p[2]}` : `${p[0]}.${p[1]}`);
    const ranges = [...families.values()]
      .map((ps) => ps.sort(cmp))
      .sort((a, b) => cmp(b[b.length - 1], a[a.length - 1]))
      .map((ps) => (ps.length === 1 ? text(ps[0]) : `${text(ps[0])}–${text(ps[ps.length - 1])}`));
    return { ranges, other };
  }

  /**
   * "Install this version": a beta or alpha is never installed silently -
   * the player confirms a sentence that names the channel. null = no
   * question needed (a release).
   */
  function buildConfirmText(build) {
    if (!build || build.type === "release" || !["beta", "alpha"].includes(build.type)) return null;
    const what = build.type === "beta" ? "a beta" : "an alpha";
    return `${build.number || build.name || "This version"} is ${what} build - the author says it isn't finished and may have bugs${build.type === "alpha" ? " or break worlds" : ""}. Install it anyway?`;
  }

  const api = { heroInstance, markPlayed, modWarning, riskyText, parseServerAddress, wantedLoaders, fitsInstance, collapseVersions, buildConfirmText };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ReminthPure = api;
})(typeof window !== "undefined" ? window : globalThis);
