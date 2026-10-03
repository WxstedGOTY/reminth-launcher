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

  const api = { heroInstance, parseServerAddress };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ReminthPure = api;
})(typeof window !== "undefined" ? window : globalThis);
