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
   * Home's "Time played": the lifetime counter main.js keeps in settings
   * (totalPlayTimeMs - every instance, deleted ones included). Before it has
   * been seeded (or when it's junk), the sum of the instances' own times.
   */
  function homePlayTime(settings, instances) {
    const t = settings && settings.totalPlayTimeMs;
    if (typeof t === "number" && Number.isFinite(t) && t >= 0) return Math.floor(t);
    return (Array.isArray(instances) ? instances : []).reduce((sum, i) => sum + (i && Number(i.playTimeMs) > 0 ? Number(i.playTimeMs) : 0), 0);
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

  /* ---------------- the instance menu, order, creating ---------------- */

  /**
   * The right-click menu of one instance, in order. facts: { running, busy
   * (installing / stopping), isMain, index, count }. Each item:
   * { id, label, disabled, why, danger, separator }.
   */
  function instanceMenuItems(inst, { running = false, busy = false, isMain = false, index = 0, count = 1 } = {}) {
    const name = (inst && inst.name) || "this instance";
    const closeFirst = "Close the game first.";
    const first = index <= 0;
    const last = index >= count - 1;
    return [
      { id: "play", label: "Play", disabled: running || busy, why: running ? "It's running." : busy ? "It's busy." : null },
      { id: "open", label: "Open", disabled: false, why: null },
      { id: "rename", label: "Rename…", disabled: running, why: running ? closeFirst : null },
      { id: "folder", label: "Open folder", disabled: false, why: null },
      { id: "verify", label: "Verify files", disabled: running || busy, why: running ? closeFirst : null },
      { id: "boost", label: "Boost FPS…", disabled: running, why: running ? closeFirst : null },
      { id: "setup", label: "Set up for a playstyle…", disabled: running, why: running ? closeFirst : null },
      { id: "up", label: "Move up", disabled: first, why: null, separator: true },
      { id: "down", label: "Move down", disabled: last, why: null },
      { id: "top", label: "Move to top", disabled: first, why: null },
      { id: "bottom", label: "Move to bottom", disabled: last, why: null },
      {
        id: "delete",
        label: "Delete…",
        danger: true,
        separator: true,
        disabled: isMain || running,
        why: isMain ? "This is your main instance - it can't be deleted." : running ? closeFirst : null,
        aria: `Delete ${name}`,
      },
    ];
  }

  /** Pure: where "up" / "down" / "top" / "bottom" takes item `index` of `count` (the same index when it can't move). */
  function moveIndex(index, count, how) {
    if (how === "top") return 0;
    if (how === "bottom") return Math.max(0, count - 1);
    if (how === "up") return Math.max(0, index - 1);
    if (how === "down") return Math.min(count - 1, index + 1);
    return index;
  }

  /**
   * Pure: `list` with the item at `from` moved so it ends up at `to` (an index
   * in the result). A drag's drop gap "before item k" is `k` when moving up,
   * `k - 1` when moving down - dropGapToIndex works that out.
   */
  function moveItem(list, from, to) {
    const out = [...(Array.isArray(list) ? list : [])];
    if (from < 0 || from >= out.length) return out;
    const [item] = out.splice(from, 1);
    out.splice(Math.max(0, Math.min(out.length, to)), 0, item);
    return out;
  }

  /** Pure: dropping item `from` into the gap before item `gap` (0…count) -> its new index. */
  function dropGapToIndex(from, gap) {
    return gap > from ? gap - 1 : gap;
  }

  /** "2 worlds, 1.4 GB" / "no worlds, about 830 MB" (the count stopped early) - for the delete question. */
  function summaryText({ worlds = 0, bytes = 0, capped = false } = {}) {
    const w = worlds === 0 ? "no worlds" : worlds === 1 ? "1 world" : `${worlds} worlds`;
    const mb = bytes / (1024 * 1024);
    const size = mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : mb >= 1 ? `${Math.round(mb)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${w}, ${capped ? "about " : ""}${size}`;
  }

  /** The one sentence before Reminth makes an instance by itself. */
  function createSentence({ name, mcVersion, loader }) {
    const names = { fabric: "Fabric", quilt: "Quilt", forge: "Forge", neoforge: "NeoForge", vanilla: "vanilla" };
    return `Reminth will make a new instance: ${name} - Minecraft ${mcVersion} ${names[loader] || loader || ""}`.trim() + ". Your other instances are not changed.";
  }

  /**
   * Pure: `name`, or "name (2)", "name (3)"… when an instance with that name,
   * Minecraft version and loader already exists (case and outer spaces don't
   * count). main/instances.js uses this same rule when it makes one.
   */
  function uniqueInstanceName(name, all, mcVersion, loader) {
    const base = String(name || "Instance").trim().slice(0, 48) || "Instance";
    const taken = new Set((all || []).filter((i) => i && i.mcVersion === mcVersion && i.loader === loader).map((i) => String(i.name).trim().toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let n = 2; n < 1000; n++) {
      const tail = ` (${n})`;
      const candidate = base.slice(0, 48 - tail.length) + tail;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return base;
  }

  /** Pure: an instance already on this version and loader (the first in the player's order), or null. */
  function reusableInstance(instances, { mcVersion, loader, excludeId = null } = {}) {
    return (Array.isArray(instances) ? instances : []).find((i) => i && i.id !== excludeId && i.mcVersion === mcVersion && i.loader === loader) || null;
  }

  /* ---------------- "Pick a Minecraft version for my mods" ---------------- */

  /** Pure: -1 / 0 / 1 for two release versions ("1.21.4", "26.2"); null when either isn't one. */
  function compareMc(a, b) {
    const pa = mcParts(a);
    const pb = mcParts(b);
    if (!pa || !pb) return null;
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
    return 0;
  }

  /**
   * What the player may do with a version, and which choice is recommended:
   *   switch - change THIS instance to it (mods updated, the ones with no
   *            build turned off, worlds stay)
   *   copy   - keep this instance and make a new one on it
   * facts: { from, to, worlds (count), modpack (bool), running (bool) }.
   * Returns { switch: { allowed, why }, copy: { allowed: true, why: null }, recommended }.
   */
  function versionChoices({ from, to, worlds = 0, modpack = false, running = false } = {}) {
    let why = null;
    if (modpack) why = "Its mods belong to the modpack it came from, so Reminth doesn't change them here.";
    else if (running) why = "Close the game first — Windows won't let files in use be replaced.";
    else if (compareMc(to, from) === -1 && worlds > 0) {
      why = `Your worlds were saved in Minecraft ${from}. Opening them in the older ${to} can damage them, so they stay here and a new instance is made instead.`;
    }
    const sw = { allowed: !why, why };
    return { switch: sw, copy: { allowed: true, why: null }, recommended: sw.allowed ? "switch" : "copy" };
  }

  /**
   * The versions to offer, best first: (a server that takes it first, when a
   * server was checked), then the fewest mods without a build for it, then
   * the newest. The version the instance is on stays in the list (marked)
   * but is never "best". Returns { rows, best } - best = the first other row.
   */
  function rankVersionRows(candidates, { server = false } = {}) {
    const rows = (Array.isArray(candidates) ? candidates : []).filter((c) => c && typeof c.version === "string").map((c) => ({ ...c, missing: Array.isArray(c.missing) ? c.missing : [] }));
    rows.sort(
      (a, b) =>
        (server ? Number(b.server === true) - Number(a.server === true) : 0) ||
        a.missing.length - b.missing.length ||
        -(compareMc(a.version, b.version) || 0) ||
        String(b.version).localeCompare(String(a.version))
    );
    const best = rows.find((r) => !r.current && (!server || r.server !== false)) || null;
    return { rows, best };
  }

  /**
   * What the instance's installed FILES look like, from its compatibility
   * result (the one the Mods panel and the yellow button use): null while
   * there is no result yet, else { problems, fixable } - problems = every
   * mod that won't load, may not work or crashed the game; fixable = the
   * ones "Update mods to fit" can still do something about (`fixable` is
   * the button's own count, given in).
   */
  function filesSummary(result, fixable = 0) {
    if (!result || !Array.isArray(result.issues)) return null;
    return { problems: result.issues.filter(Boolean).length, fixable: Math.max(0, Number(fixable) || 0) };
  }

  /**
   * What the version list shows. "The builds exist" and "the files fit" are
   * two different things:
   *  (a) every checked mod has a build for the instance's own version
   *      (Modrinth's data - as before);
   *  (b) the installed files really fit (`files`: filesSummary, null = the
   *      compatibility result isn't there yet).
   * Returns { state, headline, tone, listTitle, rows, best, fixable, problems }:
   *  - "fits"     (a and b): green "Your mods already fit Minecraft X - there
   *               is nothing you need to change."; the other fitting versions
   *               below, no best, nothing picked.
   *  - "files"    (a, not b): amber "Builds exist for Minecraft X for all your
   *               mods, but N of the files in this instance are made for
   *               another version. Press "Update mods to fit" to swap them."
   *               (with `fixable` > 0; else it says to look at the Mods panel);
   *               the same neutral list.
   *  - "checking" (a, no result yet): "Checking your installed mods..." - never
   *               the happy sentence.
   *  - "best"     (not a): today's best-match line and ranked list.
   */
  function pickerView(candidates, { server = false, files = null } = {}) {
    const { rows, best } = rankVersionRows(candidates, { server });
    const current = rows.find((r) => r.current);
    const fits = (r) => r.total > 0 && !r.missing.length && (!server || r.server !== false);
    if (!(current && fits(current))) {
      return { state: "best", currentFits: false, headline: null, tone: null, listTitle: null, rows, best, fixable: 0, problems: 0 };
    }
    const v = current.version;
    const others = rows.filter((r) => !r.current && fits(r));
    const base = { currentFits: true, listTitle: "Other versions that also fit", rows: others, best: null, fixable: 0, problems: 0 };
    if (!files) return { ...base, state: "checking", tone: "neutral", headline: "Checking your installed mods..." };
    if (files.problems > 0) {
      const n = files.problems;
      const headline =
        files.fixable > 0
          ? `Builds exist for Minecraft ${v} for all your mods, but ${files.fixable} of the files in this instance ${files.fixable === 1 ? "is" : "are"} made for another version. Press "Update mods to fit" to swap ${files.fixable === 1 ? "it" : "them"}.`
          : `Builds exist for Minecraft ${v} for all your mods, but ${n} ${n === 1 ? "mod" : "mods"} in this instance won't load or may not work. The Mods tab says which, and what to do.`;
      return { ...base, state: "files", tone: "warn", headline, fixable: files.fixable, problems: n };
    }
    return { ...base, state: "fits", tone: "ok", headline: `Your mods already fit Minecraft ${v} - there is nothing you need to change.` };
  }

  /** The line above the list: "Best match: 1.21.1 - all 29 mods fit" / "Fits most: 1.21.4 - 3 mods have to be turned off". */
  function bestLine(best, action) {
    if (!best) return null;
    const n = best.missing.length;
    if (!n) return `Best match: ${best.version} — ${best.total === 1 ? "your mod fits" : `all ${best.total} mods fit`}`;
    return `Fits most: ${best.version} — ${n} ${n === 1 ? "mod has" : "mods have"} to be ${action === "copy" ? "left out" : "turned off"}`;
  }

  /**
   * Every mod in one of four plain groups for one version and one action,
   * each with the sentence that says exactly what happens to it:
   * [{ key: "works" | "nobuild" | "unknown" | "failed", title, names, sentence }]
   * (empty groups left out). advice: compat.adviseVersions' answer.
   */
  function modGroups(advice, row, action) {
    const a = advice || {};
    const v = row ? row.version : "";
    const missing = new Set(row && Array.isArray(row.missing) ? row.missing : []);
    const known = (Array.isArray(a.mods) ? a.mods : []).map((m) => m.title).filter(Boolean);
    const works = known.filter((t) => !missing.has(t));
    const noBuild = known.filter((t) => missing.has(t));
    const unknown = Array.isArray(a.unknown) ? a.unknown : [];
    const failed = Array.isArray(a.failed) ? a.failed : [];
    const copy = action === "copy";
    const out = [];
    if (works.length) out.push({ key: "works", title: `Will work (${works.length})`, names: works, sentence: copy ? `Downloaded again in their ${v} version.` : `Updated to their ${v} version where needed.` });
    if (noBuild.length) {
      out.push({
        key: "nobuild",
        title: `No build for ${v} (${noBuild.length})`,
        names: noBuild,
        sentence: `They can't work with the rest on ${v}, so they will be ${copy ? "left out of the copy" : "turned off (you can turn them on again)"}.`,
      });
    }
    if (unknown.length) {
      out.push({
        key: "unknown",
        title: `Not in the catalog, Reminth can't check these (${unknown.length})`,
        names: unknown,
        sentence: copy ? "They will be left out of the copy. Add them by hand if they have a version for this Minecraft." : `They will be kept as they are, unless the file itself says it can't run on ${v} — then it is turned off.`,
      });
    }
    if (failed.length) {
      out.push({
        key: "failed",
        title: `Couldn't be checked just now (${failed.length})`,
        names: failed,
        sentence: copy ? "They will be left out of the copy." : "They will be kept as they are.",
      });
    }
    return out;
  }

  /**
   * The confirm step's groups for "Switch this instance", from the exact
   * preview main.js works out (versionSwitch.previewSwitch - the same rules as
   * the switch itself), so the count and names here are what the result
   * screen will show. Same shape as modGroups.
   */
  function previewGroups(preview, version) {
    const p = preview || {};
    const works = [...(p.updated || []), ...(p.kept || [])];
    const off = Array.isArray(p.turnedOff) ? p.turnedOff : [];
    const unknown = Array.isArray(p.unknown) ? p.unknown : [];
    const out = [];
    if (works.length) out.push({ key: "works", title: `Will work (${works.length})`, names: works, sentence: `Updated to their ${version} version where needed.` });
    if (off.length) {
      out.push({
        key: "nobuild",
        title: `Will be turned off (${off.length})`,
        names: off.map((m) => `${m.title} - ${m.why}`),
        sentence: `They can't work with the rest on ${version}, so they will be turned off (you can turn them on again).`,
      });
    }
    if (unknown.length) out.push({ key: "unknown", title: `Not checked (${unknown.length})`, names: unknown, sentence: "Not in the catalog (or it didn't answer) - they will be kept as they are." });
    return out;
  }

  /**
   * The "Update mods to fit (N)" number. The mods a run of the button just
   * couldn't fix (no stable build, not on Modrinth - `leftAlone`, remembered
   * with the switched-on mods' fingerprint it was for) don't count again while
   * the mods are the same: pressing it again can't help them, and a number
   * that never goes down reads as stale. `isCandidate` is the button's rule.
   */
  function syncButtonCount(result, leftAlone, isCandidate) {
    if (!result || !Array.isArray(result.issues)) return 0;
    const skip = leftAlone && leftAlone.modSet && leftAlone.modSet === result.modSet ? new Set(leftAlone.files || []) : new Set();
    return result.issues.filter((i) => i && i.file && isCandidate(i) && !skip.has(i.file)).length;
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

  /**
   * A reminth:// link the main process sent (main/deepLink.js): what the page
   * does with it, checked again here. Only ever a page switch:
   * { page: "skins" | "home" } or { instance: id } for an instance in the
   * list; anything else null. Never a Play, install or anything that acts.
   */
  function deepLinkTarget(link, instanceIds) {
    if (!link || typeof link !== "object") return null;
    if (link.page === "skins" || link.page === "home" || link.page === "discover") return { page: link.page };
    if (link.page === "instance" && typeof link.id === "string" && /^[a-z0-9-]{1,40}$/.test(link.id) && (instanceIds || []).includes(link.id)) return { instance: link.id };
    return null;
  }

  const api = { deepLinkTarget, instanceMenuItems, moveIndex, moveItem, dropGapToIndex, summaryText, createSentence, reusableInstance, uniqueInstanceName, heroInstance, homePlayTime, markPlayed, modWarning, riskyText, compareMc, versionChoices, rankVersionRows, filesSummary, pickerView, bestLine, modGroups, previewGroups, syncButtonCount, parseServerAddress, wantedLoaders, fitsInstance, collapseVersions, buildConfirmText };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ReminthPure = api;
})(typeof window !== "undefined" ? window : globalThis);
