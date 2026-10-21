"use strict";
/**
 * The hosting list for the "Host a server" page (owner, 21 Oct 2026): free hosts in one row, paid hosts in another.
 * Every fact below was read on the host's OWN pages on 2026-10-21 (design/RESEARCH_21_OCT.md, sections 5-6) - nothing
 * is guessed, and the page must say so. Nobody has tested these hosts fairly, so the paid row is ordered by the best
 * processor each host says it uses ("published hardware, not tested by us"); a host that names none is listed last as
 * "not published". The free row publishes almost no processors, so it is ordered by the RAM a free server gets.
 * Hosts change their hardware and limits: re-read the pages before the first release and bump CHECKED.
 *
 * Plain data + two pure functions, loaded by the page (window.SpaceportHosts) and by the tests in Node.
 */
(function (root) {
  const CHECKED = "2026-10-21";

  /**
   * How the processors are ordered (higher = first). By model/generation and the clock the host publishes - a rule of
   * thumb for single-core speed (Minecraft runs mostly on one core), NOT a benchmark. Edit here if the owner disagrees.
   */
  const CHIP_SCORE = {
    "Ryzen 9 9950X3D": 100,
    "Ryzen 9 9950X": 95,
    "Ryzen 9 9900X": 90,
    "EPYC 4465P": 85,
    "Ryzen 9 7950X": 80,
  };

  const HOSTS = [
    // ---- free ----
    {
      id: "falix", name: "Falix", tier: "free", url: "https://falixnodes.net/free-minecraft-server-hosting",
      ramGb: 3, chip: null,
      facts: ["3 GB RAM, 1 CPU core, 10 GB storage", "1 server per account", "Sleeps when nobody is on; players are kicked after 10 idle minutes"],
    },
    {
      id: "aternos", name: "Aternos", tier: "free", url: "https://aternos.org",
      ramGb: null, chip: null,
      facts: ["Unlimited player slots", "Waits in a queue to start; stops when nobody is on", "RAM and processor not published"],
    },
    {
      id: "minehut", name: "Minehut", tier: "free", url: "https://www.minehut.com/server-plans",
      ramGb: 1, chip: null,
      facts: ["1 GB RAM, 10 players at most", "Sleeps when nobody is on, wakes when someone joins", "Made for plugin servers"],
    },
    {
      id: "minefort", name: "Minefort", tier: "free", url: "https://minefort.com/pricing",
      ramGb: 1, chip: null,
      facts: ["1 GB RAM", "Free playtime is limited (their help centre says unlimited free use ended)"],
    },
    // ---- paid ----
    {
      id: "pebblehost", name: "PebbleHost", tier: "paid", url: "https://pebblehost.com/minecraft/premium",
      chip: "Ryzen 9 9950X3D", chipNote: "North America; Europe Ryzen 9 9900X; budget plans use older chips",
      facts: ["Premium plans, DDR5 memory"],
    },
    {
      id: "sparked", name: "Sparked Host", tier: "paid", url: "https://sparkedhost.com/hardware",
      chip: "Ryzen 9 9900X", chipNote: "Extreme plan; chip differs by location; Budget plan uses old Xeon chips",
      facts: ["DDR5 memory on Extreme and Enterprise plans"],
    },
    {
      id: "bisect", name: "BisectHosting", tier: "paid", url: "https://www.bisecthosting.com/hardware-server-performance",
      chip: "Ryzen 9 9900X", mixed: true, chipNote: "Newest servers only; they say about 65-80% of their servers are Ryzen and some old Intel remain; no chip is promised per plan",
      facts: ["Minecraft Java is placed on fast single-core servers automatically"],
    },
    {
      id: "shockbyte", name: "Shockbyte", tier: "paid", url: "https://shockbyte.com/hardware",
      chip: "EPYC 4465P", chipNote: "Up to 5.4 GHz; chip differs by location",
      facts: ["AMD EPYC / Ryzen servers"],
    },
    {
      id: "apex", name: "Apex Hosting", tier: "paid", url: "https://apexminecrafthosting.com/server-specs/",
      chip: "Ryzen 9 7950X", chipNote: "Most locations (4.5 GHz); a few locations still use old chips",
      facts: ["Ryzen 9 5900X on their EX plans"],
    },
  ];

  function chipScore(h) {
    return h && h.chip && Object.prototype.hasOwnProperty.call(CHIP_SCORE, h.chip) ? CHIP_SCORE[h.chip] : -1;
  }

  /** Pure: paid hosts, best published processor first; same chip: one with a promised chip before a "mixed" one; no chip: last; then by name. */
  function orderPaid(list) {
    return list.filter((h) => h.tier === "paid").slice().sort((a, b) => chipScore(b) - chipScore(a) || (a.mixed ? 1 : 0) - (b.mixed ? 1 : 0) || a.name.localeCompare(b.name));
  }

  /** Pure: free hosts, most RAM first (RAM not published: last), then by name. */
  function orderFree(list) {
    const ram = (h) => (typeof h.ramGb === "number" ? h.ramGb : -1);
    return list.filter((h) => h.tier === "free").slice().sort((a, b) => ram(b) - ram(a) || a.name.localeCompare(b.name));
  }

  /** Pure: { free: [...], paid: [...] } in page order, each with a `chipText` ("Ryzen 9 9950X3D" or "Processor not published"). */
  function rows(list = HOSTS) {
    const add = (h) => ({ ...h, chipText: h.chip || "Processor not published" });
    return { free: orderFree(list).map(add), paid: orderPaid(list).map(add) };
  }

  const api = { HOSTS, CHECKED, CHIP_SCORE, chipScore, orderPaid, orderFree, rows };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SpaceportHosts = api;
})(typeof window !== "undefined" ? window : globalThis);
