"use strict";
/*
 * "Select your host" (owner, 21-22 Oct 2026; plan: design/HOSTING_PLAN.md in the launcher repo).
 * Four steps: pick a host -> server settings -> create it on the host -> add it to Spaceport.
 *
 * Every host fact was read on the host's OWN pages on 2026-10-21/22 (launcher repo: design/RESEARCH_21_OCT.md sections 6-8).
 * Nothing is guessed: a processor a host doesn't publish says "not published". "Full control" = the host has a player
 * API (start/stop/commands with a key the player makes). `checked: false` = the API was found in old or thin docs and
 * must be re-confirmed BEFORE THE FIRST RELEASE (the badge then says "Checking full control"). Spaceport earns nothing
 * from these links. No innerHTML: everything is built as DOM. Choices are kept in this browser only (localStorage).
 */
(function () {
  const CHECKED = "22 October 2026";

  // Higher = first. By model/generation (Minecraft runs mostly on one core) - a rule of thumb, NOT a benchmark.
  const CHIP_SCORE = { "Ryzen 9 9950X3D": 100, "Ryzen 9 9950X": 95, "Ryzen 9 9900X": 90 };

  const HOSTS = [
    {
      id: "pebblehost", name: "PebbleHost", control: "full", checked: false, price: "Paid",
      url: "https://pebblehost.com/minecraft/premium",
      chip: "Ryzen 9 9950X3D", chipNote: "North America. Europe: Ryzen 9 9900X. Budget plans use older chips.",
      facts: ["Premium plans with DDR5 memory", "Its own API, for the account owner"],
      key: "In your PebbleHost account settings - see PebbleHost's API guide.",
      keyUrl: "https://help.pebblehost.com/en/article/using-the-pebblehost-game-panel-api-mv0hk4/",
    },
    {
      id: "exaroton", name: "exaroton", control: "full", checked: true, price: "Pay per hour",
      url: "https://exaroton.com/",
      chip: "Ryzen 9 9950X", chipNote: "Their main servers. CPU is shared: 0.5 core per GB of RAM.",
      facts: ["1 credit per GB of RAM per hour, only while it runs", "5 free trial credits to test it", "Turns itself off and on when players come and go"],
      key: "On your exaroton account page: API token.",
      keyUrl: "https://exaroton.com/",
    },
    {
      id: "sparked", name: "Sparked Host", control: "full", checked: false, price: "Paid",
      url: "https://sparkedhost.com/minecraft-server-hosting",
      chip: "Ryzen 9 9900X", chipNote: "Extreme plan. The chip differs by location; the Budget plan uses old Xeon chips.",
      facts: ["DDR5 memory on Extreme and Enterprise", "Pterodactyl panel with an API"],
      key: "In the panel's left bar: API Credentials.",
      keyUrl: "https://help.sparkedhost.com/en/article/how-to-use-the-pterodactyl-api-using-python-1qgp6n6/",
    },
    {
      id: "bisect", name: "BisectHosting", control: "full", checked: true, price: "Paid", mixed: true,
      url: "https://www.bisecthosting.com/",
      chip: "Ryzen 9 9900X", chipNote: "Their newest servers. They say 65-80% of their servers are Ryzen; some old Intel remain.",
      facts: ["Minecraft goes on fast single-core servers automatically", "Documented API: start, stop, commands, live console"],
      key: "Account > API Credentials > Create. It is shown only once - copy it.",
      keyUrl: "https://www.bisecthosting.com/docs/server-spawn",
    },
    {
      id: "falix", name: "Falix", control: "limited", price: "Free", ramGb: 3,
      url: "https://falixnodes.net/free-minecraft-server-hosting",
      chip: null,
      facts: ["3 GB RAM, 1 CPU core, 10 GB storage", "1 free server per account", "Sleeps when nobody is on; idle players kicked after 10 minutes"],
    },
    {
      id: "minehut", name: "Minehut", control: "limited", price: "Free", ramGb: 1,
      url: "https://www.minehut.com/",
      chip: null,
      facts: ["1 GB RAM, 10 players at most", "Sleeps when nobody is on, wakes when someone joins", "Made for plugin servers"],
    },
    {
      id: "aternos", name: "Aternos", control: "limited", price: "Free", ramGb: null,
      url: "https://aternos.org/",
      chip: null,
      facts: ["Unlimited player slots", "Waits in a queue to start; stops when nobody is on", "RAM and processor not published"],
    },
  ];

  const score = (h) => (h.chip && CHIP_SCORE[h.chip]) || -1;
  const ram = (h) => (typeof h.ramGb === "number" ? h.ramGb : -1);
  const fullHosts = HOSTS.filter((h) => h.control === "full").sort((a, b) => score(b) - score(a) || (a.mixed ? 1 : 0) - (b.mixed ? 1 : 0) || a.name.localeCompare(b.name));
  const limitedHosts = HOSTS.filter((h) => h.control === "limited").sort((a, b) => ram(b) - ram(a) || a.name.localeCompare(b.name));

  /* ---------- tiny DOM helper (no innerHTML) ---------- */
  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : String(v));
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k.nodeType ? k : String(k));
    return n;
  }
  const $ = (id) => document.getElementById(id);

  /* ---------- state (this browser only) ---------- */
  const KEY = "spaceport.selectHost";
  const DEFAULTS = { step: 1, host: null, name: "", version: "", software: "paper", join: "whitelist", motd: "", pvp: "on", difficulty: "normal", players: 10 };
  let s = { ...DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved && typeof saved === "object") s = { ...DEFAULTS, ...saved };
  } catch {
    // private window / storage off: start fresh
  }
  if (!HOSTS.some((x) => x.id === s.host)) s.host = null;
  if (s.step > 1 && !s.host) s.step = 1;
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      // not saved - the page still works
    }
  }
  const host = () => HOSTS.find((x) => x.id === s.host) || null;
  const SOFTWARE = { paper: "Paper (plugins)", fabric: "Fabric (mods)", vanilla: "Vanilla" };
  const validVersion = (v) => /^\d{1,2}\.\d{1,2}(\.\d{1,2})?$/.test(String(v).trim());

  /* ---------- steps ---------- */
  const STEPS = ["Host", "Settings", "Create it", "Add to Spaceport"];
  function go(n) {
    s.step = n;
    save();
    render();
    window.scrollTo({ top: $("steps").offsetTop - 80, behavior: "smooth" });
  }

  function stepper() {
    const ol = h("ol", { class: "stepper" });
    STEPS.forEach((label, i) => {
      const n = i + 1;
      const state = n < s.step ? "done" : n === s.step ? "now" : "next";
      const canGo = n < s.step;
      ol.append(h("li", { class: state, "aria-current": n === s.step ? "step" : null },
        h(canGo ? "button" : "span", { class: "st", type: canGo ? "button" : null, onclick: canGo ? () => go(n) : null },
          h("b", { text: String(n) }), h("span", { text: label }))));
    });
    return ol;
  }

  function hostCard(x) {
    const picked = s.host === x.id;
    const badge = x.control === "full" ? (x.checked ? "Full control" : "Full control · checking") : "Limited control";
    return h("button", {
      class: "host" + (picked ? " picked" : ""), type: "button", "aria-pressed": picked ? "true" : "false",
      onclick: () => { s.host = x.id; save(); render(); },
    },
      h("span", { class: "host-top" }, h("b", { class: "host-name", text: x.name }), h("span", { class: "price", text: x.price })),
      h("span", { class: "badge " + x.control + (x.checked === false ? " pending" : ""), text: badge }),
      h("span", { class: "chip" + (x.chip ? "" : " none") }, h("span", { text: x.chip || "Processor not published" }), x.chip && x.chipNote ? h("small", { text: x.chipNote }) : null),
      h("ul", { class: "facts" }, x.facts.map((f) => h("li", { text: f }))),
      h("span", { class: "pick", text: picked ? "Selected" : "Select" }));
  }

  function step1() {
    const sel = host();
    return h("section", { class: "panel" },
      h("h2", { text: "Pick a host" }),
      h("div", { class: "group" },
        h("div", { class: "group-head" }, h("b", { text: "Full control" }), h("span", { text: "Paid. Start, stop, whitelist, ban list and settings right from Spaceport." })),
        h("div", { class: "grid" }, fullHosts.map(hostCard))),
      h("div", { class: "group" },
        h("div", { class: "group-head" }, h("b", { text: "Limited control" }), h("span", { text: "Free. You manage the server on the host's own site; Spaceport adds it to your list and joins it." })),
        h("div", { class: "grid" }, limitedHosts.map(hostCard))),
      h("p", { class: "fine", text: `Paid hosts are ordered by the best processor each company says it uses on its own website, free hosts by the RAM they give - read on ${CHECKED}, not tested by us. Minecraft runs mostly on one processor core, so a faster chip helps. Spaceport earns nothing from these links. Prices and limits change: check the host's page.` }),
      h("div", { class: "actions" },
        h("button", { class: "btn primary", type: "button", disabled: !sel, onclick: () => go(2) }, sel ? `Continue with ${sel.name}` : "Pick a host to continue")));
  }

  function field(label, input, hint) {
    return h("label", { class: "field" }, h("span", { class: "lbl", text: label }), input, hint ? h("small", { text: hint }) : null);
  }
  function seg(name, options, value, onPick) {
    return h("div", { class: "seg", role: "radiogroup", "aria-label": name },
      options.map(([v, label]) => h("button", { type: "button", role: "radio", "aria-checked": v === value ? "true" : "false", class: v === value ? "on" : "", onclick: () => onPick(v) }, label)));
  }

  function step2() {
    const x = host();
    const set = (k) => (v) => { s[k] = v; save(); render(); };
    const name = h("input", { type: "text", maxlength: 40, value: s.name, placeholder: "My PvP server", oninput: (e) => { s.name = e.target.value; save(); } });
    const version = h("input", { type: "text", maxlength: 8, value: s.version, placeholder: "e.g. 1.21.11", inputmode: "decimal",
      oninput: (e) => { s.version = e.target.value.trim(); save(); next.disabled = !validVersion(s.version); } });
    const motd = h("input", { type: "text", maxlength: 59, value: s.motd, placeholder: "Shown under the name in the server list", oninput: (e) => { s.motd = e.target.value; save(); } });
    const players = h("input", { type: "number", min: 2, max: 100, value: s.players, oninput: (e) => { s.players = Math.max(2, Math.min(100, Number(e.target.value) || 10)); save(); } });
    const next = h("button", { class: "btn primary", type: "button", disabled: !validVersion(s.version), onclick: () => go(3) }, "Continue");
    return h("section", { class: "panel" },
      h("h2", { text: "Settings" }),
      h("p", { class: "sub", text: x.control === "full" ? `Spaceport sets these on your ${x.name} server for you once it's linked (step 4).` : `You'll set these in ${x.name}'s own panel - step 3 shows exactly what to type.` }),
      h("div", { class: "card-set" },
        h("h3", { text: "Important" }),
        field("Server name", name),
        field("Minecraft version", version, "The same version as the Spaceport instance you play with your friends."),
        field("Server software", seg("Server software", Object.entries(SOFTWARE), s.software, set("software")), "Paper for plugins (most PvP servers), Fabric for mods, Vanilla for plain Minecraft."),
        field("Who can join", seg("Who can join", [["whitelist", "Only people I add (whitelist)"], ["anyone", "Anyone with the address"]], s.join, set("join")), "A whitelist keeps strangers out - recommended.")),
      h("details", { class: "card-set optional" },
        h("summary", { text: "Optional settings" }),
        h("div", { class: "fields" },
          field("Message of the day", motd),
          field("PvP", seg("PvP", [["on", "On"], ["off", "Off"]], s.pvp, set("pvp"))),
          field("Difficulty", seg("Difficulty", [["easy", "Easy"], ["normal", "Normal"], ["hard", "Hard"]], s.difficulty, set("difficulty"))),
          field("Max players", players))),
      h("div", { class: "actions" }, h("button", { class: "btn", type: "button", onclick: () => go(1) }, "Back"), next));
  }

  function properties() {
    return [
      ["motd", s.motd || s.name || "A Minecraft Server"],
      ["pvp", s.pvp === "on" ? "true" : "false"],
      ["difficulty", s.difficulty],
      ["max-players", String(s.players)],
      ["white-list", s.join === "whitelist" ? "true" : "false"],
      ["enforce-whitelist", s.join === "whitelist" ? "true" : "false"],
    ];
  }

  function copyBtn(text) {
    const b = h("button", { class: "btn sm", type: "button" }, "Copy");
    b.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text);
        b.textContent = "Copied";
      } catch {
        b.textContent = "Select and copy it";
      }
      setTimeout(() => (b.textContent = "Copy"), 1600);
    });
    return b;
  }

  function step3() {
    const x = host();
    const soft = SOFTWARE[s.software];
    const props = properties().map(([k, v]) => `${k}=${v}`).join("\n");
    const list = [
      h("li", {}, h("b", { text: `Open ${x.name}` }), " and make an account. ", h("a", { href: x.url, target: "_blank", rel: "noopener", text: `Open ${x.name} ↗` })),
      h("li", {}, h("b", { text: "Create a Minecraft server" }), ` and name it "${s.name || "My PvP server"}".`),
      h("li", {}, h("b", { text: "Pick the software and version: " }), h("code", { text: `${soft} · ${s.version}` })),
    ];
    if (x.control === "full") {
      list.push(h("li", {}, h("b", { text: "Make an API key " }), "so Spaceport can control the server: ", x.key, " ", h("a", { href: x.keyUrl, target: "_blank", rel: "noopener", text: "How ↗" }),
        h("small", { class: "warn", text: "The key works like a password for your server. Only paste it into Spaceport - never share it." })));
    } else {
      list.push(h("li", {}, h("b", { text: "Set your settings " }), `in ${x.name}'s panel (Options or server.properties):`,
        h("div", { class: "props" }, h("pre", { text: props }), copyBtn(props))));
    }
    list.push(h("li", {}, h("b", { text: "Start it" }), ", wait until it says Online, and copy its address."));
    return h("section", { class: "panel" },
      h("h2", { text: `Create it on ${x.name}` }),
      h("ol", { class: "todo" }, list),
      h("div", { class: "actions" }, h("button", { class: "btn", type: "button", onclick: () => go(2) }, "Back"), h("button", { class: "btn primary", type: "button", onclick: () => go(4) }, "I copied the address")));
  }

  function step4() {
    const x = host();
    const list = [
      h("li", {}, h("b", { text: "Open Spaceport" }), " and go to ", h("b", { text: "Host a server" }), "."),
      h("li", {}, h("b", { text: "Paste the address" }), " into the Address box."),
      h("li", {}, "Press ", h("b", { text: "Add to my servers" }), " - it goes into your Minecraft server list - or ", h("b", { text: "Join" }), " to play right away."),
    ];
    if (x.control === "full") {
      list.push(h("li", {}, h("b", { text: `Link ${x.name}` }), ": paste your API key. Spaceport keeps it encrypted on your PC (never sent to us) and then shows your server with Start, Stop, Whitelist, Ban list and your settings."));
    }
    if (s.join === "whitelist") list.push(h("li", {}, h("b", { text: "Add your friends to the whitelist" }), x.control === "full" ? " in Spaceport." : ` in ${x.name}'s panel (or type /whitelist add <name> in its console).`));
    return h("section", { class: "panel" },
      h("h2", { text: "Add it to Spaceport" }),
      h("ol", { class: "todo" }, list),
      h("div", { class: "summary" },
        h("span", { class: "lbl", text: "Your server" }),
        h("b", { text: s.name || "My PvP server" }),
        h("span", { text: `${x.name} · ${SOFTWARE[s.software]} ${s.version} · ${s.join === "whitelist" ? "Whitelist" : "Open to anyone"} · PvP ${s.pvp}` })),
      h("div", { class: "actions" },
        h("button", { class: "btn", type: "button", onclick: () => go(3) }, "Back"),
        h("button", { class: "btn", type: "button", onclick: () => { s = { ...DEFAULTS }; save(); render(); } }, "Start over")));
  }

  function render() {
    const root = $("steps");
    root.replaceChildren(stepper(), [step1, step2, step3, step4][s.step - 1]());
  }

  render();
})();
