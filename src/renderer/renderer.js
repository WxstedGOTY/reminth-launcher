"use strict";
/**
 * Reminth's UI - core: helpers, navigation, account, instances, Play,
 * Home, Library, Statistics and Settings. The bigger features (content
 * lists + updates, Discover, logs, skins, streamer mode) live in
 * features.js, which loads after this file and shares its globals.
 */

const $ = (id) => document.getElementById(id);
const TICKS_PER_SECOND = 20;

const state = {
  signedIn: false,
  username: null,
  settings: null,
  info: null,
  instances: [],
  activeId: "reminth",
  recent: null,
  stats: null,
  installing: new Set(), // instance ids with an install/launch in flight
  running: new Set(), // instance ids whose game is running
  stopping: new Set(), // instance ids asked to stop, until the backend confirms the exit
  stopClickAt: 0, // when a Stop button was last pressed (or went away)
  logError: false,
  progress: new Map(), // instanceId -> { stage, pct, short }
  progressShown: null, // instance id whose run the progress bar is painting
  lastStage: null, // last stage written to the log, so each is logged once per run
};

/* ================================================================== *
 * small helpers                                                       *
 * ================================================================== */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

/** <svg class="i"><use href="#id"/></svg>, built as DOM (never innerHTML with data). */
function icon(id, className = "i") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", className);
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", id);
  svg.appendChild(use);
  return svg;
}

function button(className, label, iconId) {
  const b = el("button", className);
  b.type = "button";
  if (iconId) b.appendChild(icon(iconId));
  if (label) b.appendChild(el("span", null, label));
  return b;
}

function toast(message) {
  $("toastText").textContent = message;
  $("toast").classList.add("show");
  clearTimeout(window._toast);
  // Long messages (an error with its reason) get longer to be read.
  const ms = Math.min(9000, 3600 + Math.max(0, String(message).length - 60) * 45);
  window._toast = setTimeout(() => $("toast").classList.remove("show"), ms);
}

/** Ticks -> "3h 12m". Minecraft counts play time in 20-tick seconds. */
function formatPlaytime(ticks) {
  if (!ticks || ticks < 0) return "0m";
  const totalMinutes = Math.floor(ticks / TICKS_PER_SECOND / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (totalMinutes) return `${totalMinutes}m`;
  return "<1m";
}
const msToTicks = (ms) => Math.round((ms || 0) / 1000) * TICKS_PER_SECOND;

function formatWhen(ms) {
  if (!ms) return null;
  const diff = Date.now() - ms;
  if (diff < 0) return "just now";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(ms).toLocaleDateString();
}

/** Centimetres -> "1.2 km" / "340 m". The stats file counts every distance in cm. */
function formatDistance(cm) {
  if (!cm) return "0 m";
  const metres = cm / 100;
  if (metres >= 1000) return (metres / 1000).toFixed(metres >= 10000 ? 0 : 1) + " km";
  if (metres < 1) return "<1 m";
  return Math.round(metres) + " m";
}

const formatNumber = (n) => (n || 0).toLocaleString();

function formatBytes(n) {
  if (!n && n !== 0) return "";
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(1) + " GB";
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + " MB";
  if (n >= 1024) return Math.round(n / 1024) + " KB";
  return n + " B";
}

/** "minecraft:pink_petals" -> "Pink Petals" */
function prettyId(id) {
  return String(id).replace(/^minecraft:/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Only let an <img> point at Modrinth's CDN, a local file we ship, or a data: image. */
/** Creator profile pictures: Modrinth's CDN, or GitHub for accounts linked to it. */
function safeAvatarUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.protocol === "https:" && /^(cdn\.modrinth\.com|avatars\.githubusercontent\.com)$/.test(parsed.hostname)) return parsed.href;
  } catch {
    return null;
  }
  return null;
}

function safeIconUrl(url) {
  if (typeof url !== "string" || !url) return null;
  if (/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(url)) return url;
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.protocol === "https:" && parsed.hostname === "cdn.modrinth.com") return parsed.href;
    if (parsed.protocol === "file:") return parsed.href;
  } catch {
    return null;
  }
  return null;
}

function formatCount(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

function formatRelativeTime(iso) {
  if (!iso) return "—";
  const then = typeof iso === "number" ? iso : new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 60) return mins <= 1 ? "just now" : `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? "1 day ago" : `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return weeks === 1 ? "last week" : `${weeks} weeks ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? "last month" : `${months} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? "last year" : `${years} years ago`;
}

/** Friendly versions of the errors a player will actually hit. */
function friendlyError(message) {
  const m = String(message || "");
  const clean = m.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
  // Already written for the player - never reworded by the rules below (an
  // instance called "Hypixel Network" would otherwise turn "Couldn't delete
  // Hypixel Network" into a connection error).
  if (/^(Your Microsoft sign-in has expired|Sign-in was cancelled|Couldn't delete |Couldn't read this instance's server list)/.test(clean)) return clean;
  if (/^Skin changed, but the cape couldn't be set/.test(clean)) {
    // The skin DID change; only the reason the cape didn't is tidied up.
    return /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(clean)
      ? "Skin changed, but the cape couldn't be set. Check your internet connection and try again."
      : clean;
  }
  if (/Invalid app registration/i.test(clean)) {
    return "Sign-in almost worked, but Microsoft hasn't finished approving Reminth's app yet. Nothing's wrong with your account — try again later.";
  }
  if (/Checksum mismatch/i.test(clean)) {
    return "A downloaded file didn't match what was expected. Try again — if it keeps happening, something between you and the server (VPN, proxy or firewall) is altering downloads.";
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(clean)) {
    return "Couldn't reach the server. Check your internet connection and try again.";
  }
  // Raw file-system errors ("ENOENT: no such file or directory, rename 'C:\…'"):
  // a plain sentence instead, never the code or the path.
  const fsCode = /\b(ENOENT|EBUSY|EPERM|EACCES|ENOTEMPTY|ENOSPC|EEXIST)\b/.exec(clean);
  if (fsCode) {
    if (fsCode[1] === "EEXIST") return "Something with that name is already there — pick another name.";
    if (fsCode[1] === "ENOENT") return "That file isn't there any more — the list has been refreshed.";
    if (fsCode[1] === "ENOSPC") return "The disk is full — free some space and try again.";
    return "That file is in use — close Minecraft and try again.";
  }
  // Anything else that still carries a Windows path or an error code loses it.
  return clean
    .replace(/'[A-Za-z]:\\[^']*'|"[A-Za-z]:\\[^"]*"|[A-Za-z]:\\[^\s,;]+/g, "the file")
    .replace(/\bE[A-Z]{3,}: /g, "");
}

/** A div that acts as a button: reachable with Tab, pressed with Enter or Space. */
function clickable(node, onClick) {
  node.setAttribute("role", "button");
  node.tabIndex = 0;
  node.onclick = onClick;
  node.addEventListener("keydown", (e) => {
    if (e.target !== node || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    node.click();
  });
  return node;
}

function localGet(key, fallback) {
  try {
    const v = localStorage.getItem("reminth." + key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function localSet(key, value) {
  try {
    localStorage.setItem("reminth." + key, JSON.stringify(value));
  } catch {
    // storage unavailable - preference just isn't remembered
  }
}

function renderEmpty(container, title, note) {
  container.textContent = "";
  const empty = el("div", "empty");
  empty.appendChild(el("b", null, title));
  empty.appendChild(el("span", null, note));
  container.appendChild(empty);
}

/* ================================================================== *
 * modals                                                              *
 * ================================================================== */
let modalStack = [];

/**
 * openModal({ title, body: Node, buttons: [{ label, className, onClick, icon }], wide, onClose, canClose })
 * onClick may return false to keep the modal open (e.g. while validating).
 * focusCancel: focus starts on the first button (Cancel) instead of the last -
 * for answers that can't be undone.
 * canClose: optional () => boolean. While it returns false the player can't
 * dismiss the modal (Esc, backdrop, the x, a plain Cancel) - for work that
 * must not carry on behind a closed dialog. handle.close() always closes.
 */
function openModal({ title, body, buttons = [], wide = false, onClose, canClose, focusCancel = false }) {
  const root = $("modalRoot");
  const modal = el("div", "modal" + (wide ? " wide" : ""));
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.tabIndex = -1;
  const head = el("div", "modal-head");
  const heading = el("h2", null, title);
  heading.id = "modalTitle" + ++modalSeq;
  modal.setAttribute("aria-labelledby", heading.id);
  head.appendChild(heading);
  const x = el("button", "modal-close");
  x.type = "button";
  x.setAttribute("aria-label", "Close");
  x.appendChild(icon("#i-x"));
  head.appendChild(x);
  modal.appendChild(head);
  const bodyWrap = el("div", "modal-body");
  if (body) bodyWrap.appendChild(body);
  modal.appendChild(bodyWrap);
  const foot = el("div", "modal-foot");
  // What had focus goes back to having it when the dialog closes.
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const handle = { modal, bodyWrap, foot, buttons: [], closed: false, openedAt: performance.now() };
  const close = () => {
    if (handle.closed) return;
    handle.closed = true;
    modal.remove();
    modalStack = modalStack.filter((h) => h !== handle);
    const below = modalStack[modalStack.length - 1];
    if (below) below.modal.inert = false;
    else {
      root.hidden = true;
      $("app").inert = false;
    }
    onClose && onClose();
    // Unless closing opened something else, or focus was already put somewhere.
    const top = modalStack[modalStack.length - 1];
    const loose = !document.activeElement || document.activeElement === document.body;
    if (loose && opener && opener.isConnected && (top ? top.modal.contains(opener) : true)) opener.focus();
  };
  handle.close = close;
  // What the player's own "go away" gestures call; close() stays unconditional.
  const dismiss = () => {
    if (canClose && !canClose()) return;
    close();
  };
  handle.dismiss = dismiss;
  for (const spec of buttons) {
    const b = button("btn " + (spec.className || "outline"), spec.label, spec.icon);
    b.addEventListener("click", async () => {
      if (!spec.onClick) return dismiss();
      b.disabled = true;
      try {
        const keep = await spec.onClick(handle);
        if (keep !== false) close();
      } finally {
        b.disabled = false;
      }
    });
    foot.appendChild(b);
    handle.buttons.push(b);
  }
  if (buttons.length) modal.appendChild(foot);
  x.onclick = dismiss;
  // Anything floating over the page (menus, the "which instance?" panel) is put away first.
  document.querySelectorAll(".dd-open").forEach((d) => d.classList.remove("dd-open"));
  if (window.onModalOpen) window.onModalOpen();
  // The page, and any dialog underneath, can't be clicked, tabbed into or read out.
  const below = modalStack[modalStack.length - 1];
  if (below) below.modal.inert = true;
  $("app").inert = true;
  root.appendChild(modal);
  root.hidden = false;
  modalStack.push(handle);
  // Focus moves in: the first field, else the main button (Cancel when asked for).
  const focusIn = () => {
    const field = bodyWrap.querySelector("input:not([type=file]):not([hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled)");
    const main = handle.buttons[focusCancel ? 0 : handle.buttons.length - 1];
    const target = field || (main && !main.disabled ? main : null) || modalFocusables(modal)[0] || modal;
    target.focus();
  };
  focusIn();
  // Callers often fill the body, or switch a button off, right after this returns.
  setTimeout(() => {
    if (handle.closed || modalStack[modalStack.length - 1] !== handle) return;
    const active = document.activeElement;
    if (!modal.contains(active) || active === modal || active.disabled) focusIn();
  }, 0);
  return handle;
}
let modalSeq = 0;

function modalFocusables(modal) {
  return [...modal.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter(
    (n) => !n.disabled && n.type !== "file" && n.getClientRects().length
  );
}

// A double-click on whatever opened the dialog used to land its second click
// on the backdrop and close it again, so a fresh dialog ignores the backdrop.
const BACKDROP_GRACE_MS = 350;
$("modalRoot").addEventListener("mousedown", (e) => {
  if (e.target !== $("modalRoot") || !modalStack.length) return;
  const top = modalStack[modalStack.length - 1];
  if (performance.now() - top.openedAt < BACKDROP_GRACE_MS) return;
  top.dismiss();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    // An open menu closes first; the dialog (and what was typed in it) stays.
    const menus = document.querySelectorAll(".dd-open");
    if (menus.length) {
      menus.forEach((d) => d.classList.remove("dd-open"));
      e.stopImmediatePropagation();
      return;
    }
    if (modalStack.length) {
      modalStack[modalStack.length - 1].dismiss();
      e.stopImmediatePropagation(); // Esc answered the dialog; it doesn't also clear what's behind it
    }
    return;
  }
  if (!modalStack.length) return;
  const modal = modalStack[modalStack.length - 1].modal;
  // A held-down Enter or Space must not answer the dialog it just opened.
  if ((e.key === "Enter" || e.key === " ") && e.repeat) return e.preventDefault();
  if (e.key !== "Tab") return;
  // Tab and Shift+Tab go round inside the top dialog.
  const items = modalFocusables(modal);
  const active = document.activeElement;
  if (!items.length) {
    e.preventDefault();
    modal.focus();
  } else if (!modal.contains(active) || active === modal) {
    e.preventDefault();
    items[e.shiftKey ? items.length - 1 : 0].focus();
  } else if (e.shiftKey && active === items[0]) {
    e.preventDefault();
    items[items.length - 1].focus();
  } else if (!e.shiftKey && active === items[items.length - 1]) {
    e.preventDefault();
    items[0].focus();
  }
});

function confirmModal(title, text, confirmLabel = "Confirm", danger = false) {
  return new Promise((resolve) => {
    let answered = false;
    const body = el("div");
    for (const para of [].concat(text)) body.appendChild(el("p", null, para));
    openModal({
      title,
      body,
      buttons: [
        { label: "Cancel", className: "outline" },
        { label: confirmLabel, className: danger ? "primary danger-fill" : "primary", onClick: () => { answered = true; resolve(true); } },
      ],
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

/* ================================================================== *
 * dropdowns (sort + select)                                           *
 * ================================================================== */
/**
 * makeDropdown(container, { options: [{ value, label, icon }], value, prefix, onChange, align })
 * Returns { set(value), get() }.
 */
/** Opens or closes a dropdown (closing any other), and keeps its menu inside the window. */
function toggleMenu(container) {
  const open = !container.classList.contains("dd-open");
  document.querySelectorAll(".dd-open").forEach((d) => d.classList.remove("dd-open"));
  container.classList.toggle("dd-open", open);
  if (open) placeMenu(container);
}

/** Above the button when there's no room below, never taller than the room there is, never past the right edge. */
function placeMenu(container) {
  const menu = container.querySelector(".dd-menu");
  if (!menu || container.classList.contains("build-dd")) return; // that one always opens upwards (styles.css)
  menu.classList.remove("up");
  menu.style.maxHeight = "";
  menu.style.left = "";
  const edge = 10;
  const box = container.getBoundingClientRect();
  // Menus on a page are cut off by the page's own scroll area, not the window.
  const scroller = container.closest(".pages, .modal-body, .app-side");
  const top = scroller ? scroller.getBoundingClientRect().top : 0;
  const below = window.innerHeight - box.bottom - 6 - edge;
  const above = box.top - top - 6 - edge;
  const wanted = menu.offsetHeight;
  const up = wanted > below && above > below;
  menu.classList.toggle("up", up);
  if (wanted > (up ? above : below)) menu.style.maxHeight = Math.max(96, up ? above : below) + "px";
  const over = menu.getBoundingClientRect().right - (window.innerWidth - edge);
  if (over > 0 && !menu.classList.contains("right")) menu.style.left = -over + "px";
}

function makeDropdown(container, { options, value, prefix, onChange, align }) {
  container.textContent = "";
  let current = value;
  const btn = el("button", "dd-btn");
  btn.type = "button";
  const menu = el("div", "dd-menu" + (align === "right" ? " right" : ""));
  const paint = () => {
    btn.textContent = "";
    const opt = options.find((o) => o.value === current) || options[0];
    if (opt.icon) btn.appendChild(icon(opt.icon));
    if (prefix) btn.appendChild(el("span", "dd-label", prefix));
    btn.appendChild(el("span", null, opt.label));
    btn.appendChild(icon("#i-chevron", "i chev"));
    menu.textContent = "";
    for (const o of options) {
      const item = el("button", "dd-item" + (o.value === current ? " selected" : ""));
      item.type = "button";
      if (o.icon) item.appendChild(icon(o.icon));
      item.appendChild(el("span", null, o.label));
      item.onclick = (e) => {
        e.stopPropagation();
        container.classList.remove("dd-open");
        if (o.value === current) return;
        current = o.value;
        paint();
        onChange && onChange(current);
      };
      menu.appendChild(item);
    }
  };
  btn.setAttribute("aria-haspopup", "true");
  btn.onclick = (e) => {
    e.stopPropagation();
    toggleMenu(container);
  };
  container.appendChild(btn);
  container.appendChild(menu);
  paint();
  return {
    set(v) {
      current = v;
      paint();
    },
    get: () => current,
  };
}
document.addEventListener("click", () => document.querySelectorAll(".dd-open").forEach((d) => d.classList.remove("dd-open")));

const SORT_OPTIONS = [
  { value: "az", label: "Name (A–Z)", icon: "#i-sort-az" },
  { value: "za", label: "Name (Z–A)", icon: "#i-sort-za" },
  { value: "new", label: "Newest first", icon: "#i-clock-new" },
  { value: "old", label: "Oldest first", icon: "#i-clock-old" },
];

function sortItems(items, mode, nameOf, dateOf) {
  const copy = [...items];
  const name = (x) => String(nameOf(x) || "").toLowerCase();
  if (mode === "za") copy.sort((a, b) => name(b).localeCompare(name(a)));
  else if (mode === "new") copy.sort((a, b) => (dateOf(b) || 0) - (dateOf(a) || 0));
  else if (mode === "old") copy.sort((a, b) => (dateOf(a) || 0) - (dateOf(b) || 0));
  else copy.sort((a, b) => name(a).localeCompare(name(b)));
  return copy;
}

/* ================================================================== *
 * window chrome                                                       *
 * ================================================================== */
$("minBtn").onclick = () => window.reminth.minimize();
$("maxBtn").onclick = () => window.reminth.maximizeToggle();
$("closeBtn").onclick = () => window.reminth.close();
document.querySelector(".topbar").addEventListener("dblclick", (e) => {
  if (e.target.closest("button")) return;
  window.reminth.maximizeToggle();
});
// Auto-update (main/updater.js): downloading -> ready, with a Restart button.
window.reminth.onUpdateStatus(({ state: updateState, version }) => {
  $("updateBar").hidden = false;
  const ready = updateState === "ready";
  $("updateText").textContent = ready
    ? `Reminth ${version} is ready. It installs when you restart.`
    : `Update available (Reminth ${version}), downloading…`;
  $("updateRestartBtn").hidden = !ready;
});
$("updateRestartBtn").onclick = () => {
  $("updateRestartBtn").disabled = true;
  window.reminth.installUpdate();
};

function paintMaxButton(isMaximized) {
  $("maxBtn").querySelector("span").className = isMaximized ? "wc-max restore" : "wc-max";
  $("maxBtn").title = isMaximized ? "Restore" : "Maximize";
}
window.reminth.onMaximized(paintMaxButton);
// The window opens maximized before this page may be listening, so ask for
// the real state now instead of waiting for a change event.
window.reminth.isMaximized().then(paintMaxButton).catch(() => {});

/* ================================================================== *
 * navigation                                                          *
 * ================================================================== */
const PAGE_META = {
  home: ["Reminth Launcher", "Your Minecraft, your way."],
  instance: ["Instance", "Its version, its mods, its worlds."],
  library: ["Library", "Instances, worlds and servers."],
  discover: ["Discover", "Modpacks, mods, packs, shaders and servers."],
  skins: ["Appearance", "How you look in game."],
  hosting: ["Servers", "Play together without the setup."],
  plus: ["Reminth+", "Your own server, minus the landlord."],
  captures: ["Streamer mode", "Your clips and screenshots."],
  streamer: ["Streamer mode", "Hotkeys, replay buffer and privacy."],
  stats: ["Your record", "Everything you've done so far."],
  settings: ["Configuration", "Make Reminth work the way you want."],
};
let currentPage = "home";
const pageHooks = {}; // page -> fn run when it opens (features.js adds its own)

function switchPage(page) {
  if (!PAGE_META[page]) return;
  // Signed out, Home is the only page - it shows the sign-in card instead of
  // the player's instances. Every other route (rail, tiles, sidebar, hotkeys)
  // funnels through here, so this one check keeps a shared PC's next user
  // out of the last player's instances, worlds, mods and servers.
  if (!state.signedIn && page !== "home") return;
  currentPage = page;
  document.querySelectorAll(".page").forEach((p) => p.classList.toggle("active", p.id === page));
  document.querySelectorAll(".rail-btn[data-page]").forEach((b) => b.classList.toggle("active", b.dataset.page === page));
  document.querySelectorAll(".rail-btn.instance-btn").forEach((b) => {
    // `selected` used to be set once in renderRail() and never touched again,
    // so the last-opened instance kept its ring lit forever - on Discover,
    // Skins, Plus, Settings, anywhere - instead of only while its own
    // instance page is actually open. Recompute both classes here, every
    // page switch, so leaving to any other tab actually clears it.
    const isActiveInstance = b.dataset.instance === state.activeId;
    b.classList.toggle("active", page === "instance" && isActiveInstance);
    b.classList.toggle("selected", page === "instance" && isActiveInstance);
  });
  $("statsBtn").classList.toggle("active", page === "stats");
  $("hostBtn").classList.toggle("active", page === "hosting");
  // Discover has its own filter column in the space the sidebar uses.
  // The instance page keeps the side column too (news, Reminth+, your
  // profile) - same as Home - instead of stretching the mod list across it.
  $("appSide").style.display = page === "discover" || page === "skins" ? "none" : "flex";
  $("topEyebrow").textContent = PAGE_META[page][0];
  $("topTitle").textContent = PAGE_META[page][1];
  $("pages").scrollTop = 0;
  if (page === "stats") loadStats();
  if (page === "instance") renderInstancePage();
  if (page === "home" || page === "library") loadRecent();
  if (page === "library") renderLibraryInstances();
  // Announced before the page's own hook runs, so a hook that fails can't swallow it.
  document.dispatchEvent(new CustomEvent("reminth:page", { detail: page }));
  if (pageHooks[page]) pageHooks[page]();
}

function wireTabs(navId, onChange) {
  const nav = $(navId);
  if (!nav) return;
  const buttons = [...nav.querySelectorAll(".tab[data-tab]")];
  buttons.forEach((btn) => {
    btn.onclick = () => {
      buttons.forEach((b) => b.classList.toggle("active", b === btn));
      buttons.forEach((b) => {
        const pane = $(b.dataset.tab);
        if (pane) pane.classList.toggle("active", b === btn);
      });
      onChange && onChange(btn.dataset.tab);
    };
  });
}
wireTabs("libraryTabs");

document.addEventListener("click", (e) => {
  const target = e.target.closest("[data-page]");
  if (target && !target.disabled) switchPage(target.dataset.page);
});

/* ---- rail tooltips: fade in only once the cursor has settled ---- */
const tip = $("tip");
let tipTimer = null;
function showTipFor(node) {
  const text = node.dataset.tip;
  if (!text) return;
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => {
    // The rail is rebuilt whenever instances change; a button that's gone
    // can't fire mouseleave, so its tip would never be hidden again.
    if (!node.isConnected) return;
    const box = node.getBoundingClientRect();
    tip.textContent = node.dataset.tip;
    tip.classList.add("show");
    const tipBox = tip.getBoundingClientRect();
    tip.style.left = box.right + 12 + "px";
    tip.style.top = box.top + box.height / 2 - tipBox.height / 2 + "px";
  }, 450);
}
function hideTip() {
  clearTimeout(tipTimer);
  tip.classList.remove("show");
}
function bindTip(node) {
  node.addEventListener("mouseenter", () => showTipFor(node));
  node.addEventListener("mouseleave", hideTip);
  node.addEventListener("click", hideTip);
}
document.querySelectorAll("[data-tip]").forEach(bindTip);

/* ================================================================== *
 * account + avatar                                                    *
 * ================================================================== */
function setAvatar(container, skin, letter) {
  container.textContent = "";
  if (skin && (skin.dataUrl || skin.none)) {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    container.appendChild(canvas);
    if (skin.dataUrl && !(state.privacy)) drawHead(canvas, skin.dataUrl);
    else drawDefaultHead(canvas);
  } else {
    container.appendChild(el("span", "avatar-letter", letter));
  }
}

/* Reminth's own stand-in face for accounts that never uploaded a skin -
   an original figure in the launcher's colours, not Mojang's character. */
const DEFAULT_SKIN = { hair: "#2b3550", face: "#c89b74", eye: "#22d3ee", shirt: "#2f6f8f", sleeve: "#c89b74", legs: "#27324a", legsShade: "#212a3e" };

function drawDefaultHead(canvas) {
  const ctx = canvas.getContext("2d");
  const u = canvas.width / 8;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = DEFAULT_SKIN.face;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = DEFAULT_SKIN.hair;
  ctx.fillRect(0, 0, 8 * u, 2 * u);
  ctx.fillRect(0, 0, u, 4 * u);
  ctx.fillRect(7 * u, 0, u, 4 * u);
  ctx.fillStyle = DEFAULT_SKIN.eye;
  ctx.fillRect(2 * u, 3 * u, u, u);
  ctx.fillRect(5 * u, 3 * u, u, u);
}

let fallbackSkinUrl = null;
function fallbackSkinTexture() {
  if (fallbackSkinUrl) return fallbackSkinUrl;
  const tex = document.createElement("canvas");
  tex.width = 64;
  tex.height = 64;
  const ctx = tex.getContext("2d");
  const fill = (x, y, w, h, colour) => {
    ctx.fillStyle = colour;
    ctx.fillRect(x, y, w, h);
  };
  const part = (x, y, w, h, d, colour) => {
    fill(x, y + d, 2 * (w + d), h, colour); // sides
    fill(x + d, y, 2 * w, d, colour); // top + bottom
  };
  part(0, 0, 8, 8, 8, DEFAULT_SKIN.face);
  fill(8, 0, 8, 8, DEFAULT_SKIN.hair); // top of head
  fill(0, 8, 32, 2, DEFAULT_SKIN.hair); // fringe all the way round
  fill(24, 8, 8, 8, DEFAULT_SKIN.hair); // back of head
  fill(8, 8, 1, 4, DEFAULT_SKIN.hair);
  fill(15, 8, 1, 4, DEFAULT_SKIN.hair);
  fill(10, 11, 1, 1, DEFAULT_SKIN.eye);
  fill(13, 11, 1, 1, DEFAULT_SKIN.eye);
  part(16, 16, 8, 12, 4, DEFAULT_SKIN.shirt);
  part(40, 16, 4, 12, 4, DEFAULT_SKIN.shirt);
  fill(40, 28, 16, 4, DEFAULT_SKIN.sleeve);
  part(32, 48, 4, 12, 4, DEFAULT_SKIN.shirt);
  fill(32, 60, 16, 4, DEFAULT_SKIN.sleeve);
  part(0, 16, 4, 12, 4, DEFAULT_SKIN.legs);
  part(16, 48, 4, 12, 4, DEFAULT_SKIN.legsShade);
  fallbackSkinUrl = tex.toDataURL("image/png");
  return fallbackSkinUrl;
}

function drawHead(canvas, dataUrl) {
  const img = new Image();
  img.onload = () => {
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = img.width / 64;
    ctx.drawImage(img, 8 * scale, 8 * scale, 8 * scale, 8 * scale, 0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 40 * scale, 8 * scale, 8 * scale, 8 * scale, 0, 0, canvas.width, canvas.height);
  };
  img.src = dataUrl;
}

let skinRequestId = 0;
state.accountSkin = null;
async function refreshSkin() {
  const letter = (state.username || "?").slice(0, 1).toUpperCase();
  const requestId = ++skinRequestId;
  let skin = null;
  try {
    skin = state.signedIn ? await window.reminth.skin() : null;
  } catch {
    skin = null;
  }
  if (requestId !== skinRequestId) return;
  state.accountSkin = skin;
  setAvatar($("topAvatar"), skin, letter);
  setAvatar($("settingsAvatar"), skin, letter);
  setAvatar($("sideAvatar"), skin, letter);
  if (window.onAccountSkin) window.onAccountSkin(skin);
}

function applyAccountUI() {
  const signedIn = state.signedIn;
  const name = state.username || "Not signed in";
  $("topName").textContent = name;
  $("topState").textContent = signedIn ? "Online" : "Offline";
  $("topState").classList.toggle("online", signedIn);
  $("settingsName").textContent = name;
  $("settingsState").textContent = signedIn ? "Microsoft account connected" : "Not connected";
  $("settingsAuthBtn").textContent = signedIn ? "Sign out" : "Sign in";
  $("sideName").textContent = name;
  $("sideState").textContent = signedIn ? "Microsoft · online" : "Not connected";
  $("signInHero").hidden = signedIn;
  $("homeMain").hidden = !signedIn;
  const greeting = $("heroGreeting");
  greeting.textContent = signedIn ? "Welcome back, " : "Ready to play?";
  if (signedIn) greeting.appendChild(el("span", "pii", state.username));
  // The same sign-in card gates the whole app, not just Home: signed out, the
  // rail, top actions and sidebar are hidden (styles.css, #app.signed-out)
  // and switchPage refuses every page but Home.
  $("app").classList.toggle("signed-out", !signedIn);
  if (!signedIn && currentPage !== "home") switchPage("home");
  refreshSkin();
}

async function doSignIn(btn) {
  if (btn) btn.disabled = true;
  try {
    const { username } = await window.reminth.signIn();
    state.signedIn = true;
    state.username = username;
    $("codePanel").hidden = true;
    // An earlier "Sign-in failed" line must not still be on the card after signing out again.
    dismissLog("Out");
    applyAccountUI();
    // A download started while signed out carries on in the signed-in bar.
    paintActiveProgress();
    loadRecent();
    toast(state.privacy ? "Signed in." : `Signed in as ${username}`);
  } catch (err) {
    $("codePanel").hidden = true;
    const why = friendlyError(err.message);
    appendLog("Sign-in failed: " + why, true, "Out");
    toast(`Sign-in didn't finish: ${why}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function doSignOut() {
  try {
    await window.reminth.signOut();
  } catch (err) {
    toast(friendlyError(err.message));
    return;
  }
  state.signedIn = false;
  state.username = null;
  applyAccountUI();
  toast("Signed out.");
}

/**
 * "Your Microsoft sign-in has expired": the backend has signed the account
 * out. Shows the sign-in card with the reason on it. Returns true when that
 * was the error (the caller has nothing more to say).
 */
function signedOutByBackend(err) {
  if (!err || !/sign-in has expired/i.test(err.message || "")) return false;
  const why = friendlyError(err.message);
  state.signedIn = false;
  state.username = null;
  while (modalStack.length) modalStack[modalStack.length - 1].close();
  applyAccountUI();
  dismissLog("");
  $("progressStageOut").textContent = "Signed out";
  $("progressPctOut").textContent = "";
  $("progressFillOut").style.width = "0%";
  $("progressFillOut").classList.remove("busy");
  $("logOut").textContent = "";
  appendLog(why, true, "Out");
  toast(why);
  return true;
}

$("signInBtn").onclick = () => doSignIn($("signInBtn"));
$("accountBtn").onclick = () => switchPage("settings");
$("settingsAuthBtn").onclick = () => (state.signedIn ? doSignOut() : doSignIn($("settingsAuthBtn")));

window.reminth.onAccountRestored(({ username }) => {
  state.signedIn = true;
  state.username = username;
  applyAccountUI();
  loadRecent();
});
window.reminth.onAuthCode(({ userCode, verificationUri }) => {
  $("codePanel").hidden = false;
  $("userCode").textContent = userCode;
  $("verificationLink").href = verificationUri;
  $("verificationLink").textContent = verificationUri.replace(/^https?:\/\//, "");
});
window.reminth.onAuthWaiting(() => {
  $("codeHint").textContent = "Waiting for you to finish signing in…";
});

/* ================================================================== *
 * instances                                                           *
 * ================================================================== */
const activeInstance = () => state.instances.find((i) => i.id === state.activeId) || state.instances[0] || null;
const instanceById = (id) => state.instances.find((i) => i.id === id) || null;
const LOADER_LABELS = { vanilla: "Vanilla", fabric: "Fabric", quilt: "Quilt", forge: "Forge", neoforge: "NeoForge" };
const LOADER_TAGS = { vanilla: "emerald", fabric: "cyan", quilt: "violet", forge: "amber", neoforge: "rose" };
const loaderLabel = (inst) => LOADER_LABELS[(inst && inst.loader) || "vanilla"] || "Vanilla";
const loaderTag = (inst) => "tag " + (LOADER_TAGS[(inst && inst.loader) || "vanilla"] || "emerald");

function instanceChip(inst, xl) {
  const chip = el("span", `instance-chip${xl ? " xl" : ""} c-${inst.color || "cyan"}`);
  const iconUrl = inst.modpack && safeIconUrl(inst.modpack.iconUrl);
  if (iconUrl) {
    const img = el("img");
    img.src = iconUrl;
    img.alt = "";
    img.addEventListener("error", () => {
      img.remove();
      chip.textContent = inst.name.slice(0, 1).toUpperCase();
    });
    chip.appendChild(img);
  } else {
    chip.textContent = inst.name.slice(0, 1).toUpperCase();
  }
  return chip;
}

async function loadInstances() {
  try {
    state.instances = await window.reminth.instances();
    state.instancesError = null;
  } catch (err) {
    state.instances = [];
    state.instancesError = friendlyError(err.message) || "unknown error";
  }
  state.running = new Set(state.instances.filter((i) => i.running).map((i) => i.id));
  if (!instanceById(state.activeId)) state.activeId = state.instances[0] ? state.instances[0].id : "reminth";
  renderRail();
  renderHero();
  paintActiveProgress();
  $("sideInstances").textContent = String(state.instances.length || 1);
  if (currentPage === "instance") renderInstancePage();
  if (currentPage === "library") renderLibraryInstances();
  if (window.onInstancesChanged) window.onInstancesChanged();
}

function renderRail() {
  const rail = $("railInstances");
  hideTip(); // the button it belongs to is about to be thrown away
  rail.textContent = "";
  for (const inst of state.instances) {
    // Only start it selected/ringed if we're actually rebuilding the rail
    // while sat on that instance's own page - otherwise this baked a stale
    // ring into every other tab too. The per-switch toggle below (and in
    // switchPage) keeps it correct from here on.
    const startsSelected = currentPage === "instance" && inst.id === state.activeId;
    const btn = el("button", "rail-btn instance-btn" + (startsSelected ? " active selected" : ""));
    btn.type = "button";
    btn.dataset.instance = inst.id;
    btn.dataset.tip = `${inst.name} · ${loaderLabel(inst)} ${inst.mcVersion}`;
    btn.appendChild(instanceChip(inst));
    if (state.running.has(inst.id)) btn.appendChild(el("span", "run-dot"));
    btn.onclick = () => selectInstance(inst.id, true);
    bindTip(btn);
    rail.appendChild(btn);
  }
  document.querySelectorAll(".rail-btn.instance-btn").forEach((b) => {
    const isActiveInstance = b.dataset.instance === state.activeId;
    b.classList.toggle("active", currentPage === "instance" && isActiveInstance);
    b.classList.toggle("selected", currentPage === "instance" && isActiveInstance);
  });
}

async function selectInstance(id, open) {
  if (id !== state.activeId) {
    state.activeId = id;
    renderRail();
    renderHero();
    paintActiveProgress();
    saveSetting({ activeInstance: id });
    if (window.onInstancesChanged) window.onInstancesChanged();
    // Already on the instance page and not asked to (re)open it: the header,
    // worlds, servers and logs would otherwise stay those of the instance
    // that was showing before.
    if (!open && currentPage === "instance") renderInstancePage();
  }
  if (open) switchPage("instance");
}

function renderHero() {
  const inst = activeInstance();
  if (!inst) {
    // The instance list couldn't be read: say so instead of "set up and ready".
    $("heroLoader").textContent = "—";
    $("heroLoader").className = "tag dim";
    $("heroVersion").textContent = "—";
    $("heroInstance").textContent = "—";
    $("heroLede").textContent = state.instancesError
      ? "Reminth couldn't read your instances. Restart Reminth — your worlds and mods are not touched."
      : "No instance yet. Make one with the + on the left.";
    for (const id of ["playBtn", "instPlayBtn"]) $(id).disabled = true;
    return;
  }
  $("heroLoader").textContent = loaderLabel(inst);
  $("heroLoader").className = loaderTag(inst);
  $("heroVersion").textContent = "Minecraft " + inst.mcVersion;
  $("heroInstance").textContent = inst.name;
  $("heroLede").textContent = inst.modpack
    ? `${inst.modpack.title} is installed and ready. One click and you're in.`
    : `Your ${loaderLabel(inst)} ${inst.mcVersion} instance is set up and ready. One click and you're in.`;
  paintPlayButtons();
}

/** Play buttons double as a progress pill while their instance installs. */
function paintPlayButtons() {
  const inst = activeInstance();
  if (!inst) return;
  const busy = state.installing.has(inst.id);
  const stopping = state.stopping.has(inst.id);
  const runningNow = state.running.has(inst.id) || stopping;
  const p = state.progress.get(inst.id);
  for (const id of ["playBtn", "instPlayBtn"]) {
    const btn = $(id);
    if (!btn) continue;
    btn.disabled = busy || runningNow;
    const label = btn.querySelector("span");
    btn.classList.toggle("progressing", busy);
    btn.style.setProperty("--p", busy && p && p.pct !== null ? p.pct + "%" : "0%");
    label.textContent = runningNow ? "Playing" : busy ? (p ? `${p.short}${p.pct !== null ? " " + p.pct + "%" : "…"}` : "Starting…") : "Play";
  }
  // Only shows up once something is actually (or stuck) "running" - lets a
  // player unstick the Play button themselves instead of relaunching
  // Reminth every time a crash or an odd exit leaves it wedged on "Playing".
  for (const id of ["stopBtn", "instStopBtn"]) {
    const btn = $(id);
    if (!btn) continue;
    btn.hidden = !runningNow;
    // Stays in place, busy, until the backend says the game is gone - so
    // nothing else slides under the cursor of someone who double-clicked it.
    btn.disabled = stopping;
    btn.querySelector("span").textContent = stopping ? "Stopping…" : "Stop";
  }
  // "Update mods to fit…" hides while the game runs or installs (features.js).
  if (typeof paintSyncButtons === "function") paintSyncButtons();
}

/* ---- the create / edit instance dialog, with the version picker ---- */
let versionsCache = null;
async function getVersions() {
  if (versionsCache) return versionsCache;
  versionsCache = await window.reminth.versions();
  return versionsCache;
}

const VERSION_TYPES = [
  { key: "release", label: "Releases" },
  { key: "snapshot", label: "Snapshots" },
  { key: "old_beta", label: "Beta" },
  { key: "old_alpha", label: "Alpha" },
];

const LOADER_CHOICES = [
  { key: "vanilla", label: "Vanilla", note: "Plain Minecraft. No mods, just resource packs and data packs." },
  { key: "fabric", label: "Fabric", note: "Light and fast to update. Most performance mods (Sodium, Lithium) live here." },
  { key: "quilt", label: "Quilt", note: "A Fabric fork. Runs Quilt mods and almost every Fabric mod." },
  { key: "forge", label: "Forge", note: "The classic. Huge mod library, especially for 1.12.2 and 1.20.1." },
  { key: "neoforge", label: "NeoForge", note: "Forge's modern successor - where most big mods went from 1.20.2 on." },
];

// Shown until window.reminth.perfProfiles() answers (and if it can't).
const PERF_PROFILES_FALLBACK = [
  { id: "balanced", title: "Balanced", description: ["Reminth's performance pack and Java settings, with Minecraft's own video settings.", "Nothing about how the game looks or plays is changed."] },
  { id: "max-fps", title: "Max FPS", description: ["Lower view and simulation distance, fewer particles, V-Sync off for a brand-new instance.", "Applied to new instances only; your existing settings are never changed."] },
  { id: "far-view", title: "Far view", description: ["A longer render distance picked for this PC, and more memory.", "Applied to new instances only; your existing settings are never changed."] },
];
let perfProfilesCache = null;
async function loadPerfProfiles() {
  if (perfProfilesCache) return perfProfilesCache;
  try {
    const list = await window.reminth.perfProfiles();
    if (Array.isArray(list) && list.length) perfProfilesCache = list;
  } catch {
    // the fallback above says the same thing, shorter
  }
  return perfProfilesCache || PERF_PROFILES_FALLBACK;
}

/** "A, B and C" */
function listInWords(names) {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] || "";
}

/**
 * Is the pack on for this loader when the player hasn't touched the switch?
 * The same rule as config.perfPackEnabled: Fabric/Quilt on unless switched
 * off; Forge/NeoForge only when switched on - except a brand-new instance,
 * where nothing can clash yet, so the dialog starts with it on.
 */
function packOnByDefault(loader, existing) {
  if (loader === "vanilla") return false;
  const sameLoader = existing && existing.loader === loader;
  const stored = sameLoader ? existing.performanceMods : undefined;
  if (loader === "fabric" || loader === "quilt") return stored !== false;
  if (!existing) return true;
  return stored === true;
}

/** Why the pack is off by default here, in one sentence - or "" when it isn't. */
function packOffReason(loader, existing, touched) {
  if (!existing || touched !== null || loader === "vanilla") return "";
  if (existing.modpack && existing.performanceMods === false) return "Off for modpacks: the pack's author chose its mods. Switch it on if you want Reminth's as well.";
  if ((loader === "forge" || loader === "neoforge") && existing.performanceMods !== true) {
    return "Off by default for an instance that already exists: Forge and NeoForge won't start when two mods carry the same id, and this instance's mods were picked without the pack.";
  }
  return "";
}

function openInstanceModal(existing) {
  const editing = Boolean(existing);
  const pick = {
    name: existing ? existing.name : "",
    loader: existing ? existing.loader : "fabric",
    version: existing ? existing.mcVersion : null,
    build: existing ? existing.loaderVersion : null,
    hud: existing ? Boolean(existing.hud) : true,
    // The performance pack switch: null until the player touches it, so the
    // per-loader default (packOnByDefault) follows the loader they pick.
    perf: null,
    profile: (existing && existing.perfProfile) || "balanced",
    types: new Set(["release"]),
    query: "",
  };
  const body = el("div");

  const nameField = el("div", "field");
  nameField.appendChild(el("label", null, "Name"));
  const nameInput = el("input");
  nameInput.type = "text";
  nameInput.placeholder = "e.g. Survival 1.21";
  nameInput.maxLength = 48;
  nameInput.value = pick.name;
  nameField.appendChild(nameInput);
  body.appendChild(nameField);

  const loaderField = el("div", "field");
  loaderField.appendChild(el("label", null, "Loader"));
  const loaderRow = el("div", "radio-row loader-row");
  const loaderBtns = {};
  for (const l of LOADER_CHOICES) {
    const b = el("button", `radio-pill loader-pill l-${l.key}`);
    b.type = "button";
    b.appendChild(el("span", "loader-dot"));
    b.appendChild(el("span", null, l.label));
    b.onclick = () => {
      if (pick.loader === l.key) return;
      pick.loader = l.key;
      pick.build = null;
      const v = versionsCache && versionsCache.versions.find((x) => x.id === pick.version);
      if (v && !supports(v)) {
        pick.version = null;
        versionLabel.textContent = "Minecraft version";
        // The name Reminth filled in was for that version.
        if (nameInput.dataset.auto === "1") nameInput.value = "";
      }
      if (nameInput.dataset.auto === "1" && pick.version) nameInput.value = `${l.label} ${pick.version}`;
      paintLoader();
      paintList();
      paintBuilds();
      paintHud();
      paintPerf();
    };
    loaderBtns[l.key] = b;
    loaderRow.appendChild(b);
  }
  loaderField.appendChild(loaderRow);
  const loaderNote = el("p", "set-note loader-note");
  loaderField.appendChild(loaderNote);
  body.appendChild(loaderField);

  const versionField = el("div", "field");
  const versionLabel = el("label", null, "Minecraft version");
  versionField.appendChild(versionLabel);
  const picker = el("div", "version-picker");
  const top = el("div", "vp-top");
  const search = el("div", "mod-search");
  search.appendChild(icon("#i-search"));
  const searchInput = el("input");
  searchInput.type = "text";
  searchInput.placeholder = "Search versions…";
  search.appendChild(searchInput);
  top.appendChild(search);
  const typeRow = el("div", "vp-types");
  for (const t of VERSION_TYPES) {
    const b = el("button", "vp-type" + (pick.types.has(t.key) ? " on" : ""), t.label);
    b.type = "button";
    b.onclick = () => {
      if (pick.types.has(t.key) && pick.types.size > 1) pick.types.delete(t.key);
      else pick.types.add(t.key);
      b.classList.toggle("on", pick.types.has(t.key));
      paintList();
    };
    typeRow.appendChild(b);
  }
  top.appendChild(typeRow);
  picker.appendChild(top);
  const list = el("div", "vp-list");
  list.appendChild(el("div", "vp-empty", "Loading every Minecraft version…"));
  picker.appendChild(list);
  versionField.appendChild(picker);
  body.appendChild(versionField);

  // Loader build + ReminthHUD, side by side under the version list.
  const extras = el("div", "inst-extras");
  const buildField = el("div", "field build-field");
  const buildLabel = el("label", null, "Loader build");
  buildField.appendChild(buildLabel);
  const buildDd = el("div", "sort-dd build-dd");
  buildField.appendChild(buildDd);
  extras.appendChild(buildField);
  const hudField = el("div", "field hud-field");
  hudField.appendChild(el("label", null, "ReminthHUD"));
  const hudRow = el("div", "toggle-row compact");
  const hudText = el("div");
  const hudTitle = el("b", null, "FPS, coords and facing in game");
  const hudSub = el("span", null, "");
  hudText.appendChild(hudTitle);
  hudText.appendChild(hudSub);
  const hudSwitch = el("button", "switch");
  hudSwitch.type = "button";
  hudSwitch.setAttribute("role", "switch");
  hudSwitch.setAttribute("aria-label", "ReminthHUD");
  hudRow.appendChild(hudText);
  hudRow.appendChild(hudSwitch);
  hudField.appendChild(hudRow);
  extras.appendChild(hudField);
  // The performance pack: per loader, with the mods it has (state.info).
  const perfField = el("div", "field hud-field perf-field");
  perfField.appendChild(el("label", null, "Performance pack"));
  const perfRow = el("div", "toggle-row compact");
  const perfText = el("div");
  const perfTitle = el("b");
  const perfSub = el("span", null, "Stable builds only, from Modrinth. Reminth leaves a mod out when you have your own copy or one that conflicts.");
  perfText.appendChild(perfTitle);
  perfText.appendChild(perfSub);
  const perfSwitch = el("button", "switch");
  perfSwitch.type = "button";
  perfSwitch.setAttribute("role", "switch");
  perfSwitch.setAttribute("aria-label", "Performance pack");
  perfRow.appendChild(perfText);
  perfRow.appendChild(perfSwitch);
  perfField.appendChild(perfRow);
  const perfWhy = el("p", "set-note perf-why");
  perfField.appendChild(perfWhy);
  // What the pack did at this instance's last Play (editing only).
  const packStatus = el("div", "pack-status");
  packStatus.hidden = true;
  perfField.appendChild(packStatus);
  extras.appendChild(perfField);
  body.appendChild(extras);

  // Performance profile: three choices, each described in plain words.
  const profileField = el("div", "field profile-field");
  profileField.appendChild(el("label", null, "Performance profile"));
  const profileRow = el("div", "radio-row");
  profileField.appendChild(profileRow);
  const profileNote = el("div", "profile-note");
  profileField.appendChild(profileNote);
  body.appendChild(profileField);
  let profiles = PERF_PROFILES_FALLBACK;
  function paintProfiles() {
    profileRow.textContent = "";
    for (const p of profiles) {
      const b = el("button", "radio-pill" + (pick.profile === p.id ? " on" : ""), p.title);
      b.type = "button";
      b.setAttribute("aria-pressed", pick.profile === p.id ? "true" : "false");
      b.onclick = () => {
        pick.profile = p.id;
        paintProfiles();
      };
      profileRow.appendChild(b);
    }
    const chosen = profiles.find((p) => p.id === pick.profile) || profiles[0];
    profileNote.textContent = "";
    for (const line of chosen.description || []) profileNote.appendChild(el("p", "set-note", line));
  }
  paintProfiles();
  loadPerfProfiles().then((list) => {
    profiles = list;
    paintProfiles();
  });

  const perfEligible = () => pick.loader !== "vanilla";
  const perfShown = () => (pick.perf === null ? packOnByDefault(pick.loader, existing) : pick.perf);
  function paintPerf() {
    perfField.hidden = !perfEligible();
    if (!perfEligible()) return;
    const on = perfShown();
    perfSwitch.classList.toggle("on", on);
    perfSwitch.setAttribute("aria-checked", on ? "true" : "false");
    const mods = (state.info && state.info.performancePack && state.info.performancePack[pick.loader]) || [];
    perfTitle.textContent = mods.length ? listInWords(mods) : "Performance mods";
    perfWhy.textContent = packOffReason(pick.loader, existing, pick.perf);
    perfWhy.hidden = !perfWhy.textContent;
    // The status list is about the instance as it is now: hidden while the
    // loader is being changed in this dialog.
    packStatus.hidden = !editing || pick.loader !== existing.loader || !packStatus.childNodes.length;
  }
  perfSwitch.onclick = () => {
    pick.perf = !perfShown();
    paintPerf();
  };
  if (editing && existing.loader !== "vanilla" && typeof paintPackStatus === "function") {
    paintPackStatus(packStatus, existing.id, () => paintPerf());
  }

  const note = el("p", "set-note");
  body.appendChild(note);
  if (editing) {
    note.textContent = "Changing the version or loader keeps your mods and worlds - but mods built for another version or loader won't load, and opening a world in an older version than it was saved in can damage it.";
  }

  function supports(v) {
    return pick.loader === "vanilla" || v[pick.loader] !== false;
  }
  function paintLoader() {
    for (const [k, b] of Object.entries(loaderBtns)) b.classList.toggle("on", pick.loader === k);
    const choice = LOADER_CHOICES.find((l) => l.key === pick.loader);
    const down = versionsCache && (versionsCache.unknown || []).includes(pick.loader);
    loaderNote.textContent = choice.note + (down ? ` (Couldn't reach ${choice.label}'s servers - every version is shown, but some may not have a build.)` : "");
  }
  function paintList() {
    if (!versionsCache) return;
    const q = pick.query.trim().toLowerCase();
    const rows = versionsCache.versions.filter((v) => pick.types.has(v.type) && (!q || v.id.toLowerCase().includes(q)));
    // Supported versions first so the list isn't a wall of greyed-out rows.
    rows.sort((a, b) => Number(supports(b)) - Number(supports(a)));
    list.textContent = "";
    if (!rows.length) {
      list.appendChild(el("div", "vp-empty", "No version matches that."));
      return;
    }
    const label = LOADER_LABELS[pick.loader];
    for (const v of rows.slice(0, 500)) {
      const ok = supports(v);
      const item = el("button", "vp-item" + (pick.version === v.id ? " on" : "") + (ok ? "" : " unavailable"));
      item.type = "button";
      item.appendChild(el("b", null, v.id));
      if (v.type !== "release") item.appendChild(el("span", "tag dim", VERSION_TYPES.find((t) => t.key === v.type)?.label.replace(/s$/, "") || v.type));
      if (v.id === versionsCache.latest.release) item.appendChild(el("span", "tag emerald", "Latest"));
      if (!ok) item.appendChild(el("span", "tag dim", `No ${label}`));
      item.appendChild(el("span", "vp-date", new Date(v.releaseTime).toLocaleDateString()));
      item.onclick = () => {
        if (!ok) {
          const others = LOADER_CHOICES.filter((l) => l.key !== "vanilla" && v[l.key] !== false).map((l) => l.label);
          toast(`${label} doesn't have a build for ${v.id}.${others.length ? ` ${others.join(" and ")} ${others.length > 1 ? "do" : "does"}.` : " Pick Vanilla to play it."}`);
          return;
        }
        pick.version = v.id;
        pick.build = null;
        list.querySelectorAll(".vp-item").forEach((n) => n.classList.remove("on"));
        item.classList.add("on");
        versionLabel.textContent = `Minecraft version — ${v.id}`;
        if (!nameInput.value.trim() || nameInput.dataset.auto === "1") {
          nameInput.value = `${label} ${v.id}`;
          nameInput.dataset.auto = "1";
        }
        paintBuilds();
        paintHud();
      };
      list.appendChild(item);
    }
  }

  let buildToken = 0;
  async function paintBuilds() {
    const token = ++buildToken;
    const show = pick.loader !== "vanilla";
    buildField.hidden = !show;
    if (!show) return;
    buildLabel.textContent = `${LOADER_LABELS[pick.loader]} build`;
    if (!pick.version) {
      makeDropdown(buildDd, { options: [{ value: "", label: "Pick a Minecraft version first" }], value: "" });
      return;
    }
    makeDropdown(buildDd, { options: [{ value: "", label: "Loading builds…" }], value: "" });
    let builds = [];
    try {
      builds = await window.reminth.loaderVersions(pick.loader, pick.version);
    } catch {
      builds = [];
    }
    if (token !== buildToken) return;
    const rec = builds.find((b) => b.recommended) || builds[0];
    const options = [{ value: "", label: rec ? `Recommended (${rec.label})` : "Recommended", icon: "#i-check" }];
    for (const b of builds.slice(0, 300)) {
      const tags = [b.recommended ? "recommended" : null, b.latest ? "latest" : null, b.stable ? null : "beta"].filter(Boolean);
      options.push({ value: b.id, label: tags.length ? `${b.label}  ·  ${tags.join(", ")}` : b.label });
    }
    if (pick.build && !builds.some((b) => b.id === pick.build)) pick.build = null;
    makeDropdown(buildDd, { options, value: pick.build || "", onChange: (v) => (pick.build = v || null) });
  }

  let hudToken = 0;
  async function paintHud() {
    const token = ++hudToken;
    const eligible = pick.loader === "fabric" || pick.loader === "quilt";
    hudField.hidden = !eligible;
    if (!eligible) return;
    let available = false;
    if (pick.version) {
      try {
        available = await window.reminth.hudSupports(pick.version);
      } catch {
        available = false;
      }
    }
    if (token !== hudToken) return;
    hudSwitch.disabled = !available;
    hudRow.classList.toggle("disabled", !available);
    const on = available && pick.hud;
    hudSwitch.classList.toggle("on", on);
    hudSwitch.setAttribute("aria-checked", on ? "true" : "false");
    hudSub.textContent = !pick.version
      ? "Pick a version to see if there's a HUD build for it."
      : available
      ? "Reminth installs it (and Fabric API) and keeps it updated. H toggles it in game."
      : `No ReminthHUD build for ${pick.version} yet — it's built per version.`;
  }
  hudSwitch.onclick = () => {
    if (hudSwitch.disabled) return;
    pick.hud = !pick.hud;
    paintHud();
  };

  nameInput.addEventListener("input", () => (nameInput.dataset.auto = "0"));
  searchInput.addEventListener("input", () => {
    pick.query = searchInput.value;
    paintList();
  });
  paintLoader();
  paintBuilds();
  paintHud();
  paintPerf();
  if (pick.version) versionLabel.textContent = `Minecraft version — ${pick.version}`;

  getVersions()
    .then(() => {
      if (pick.version) {
        const v = versionsCache.versions.find((x) => x.id === pick.version);
        if (v) pick.types.add(v.type);
        typeRow.querySelectorAll(".vp-type").forEach((b, i) => b.classList.toggle("on", pick.types.has(VERSION_TYPES[i].key)));
      }
      paintLoader();
      paintList();
    })
    .catch(() => {
      list.textContent = "";
      list.appendChild(el("div", "vp-empty", "Couldn't load Mojang's version list. Check your connection and try again."));
    });

  // Esc, the backdrop and Cancel wait for a save that's running: closing the
  // dialog used to leave it running unseen (and then jump to the new instance).
  let saving = false;
  openModal({
    title: editing ? `Edit ${existing.name}` : "New instance",
    body,
    wide: true,
    canClose: () => !saving,
    buttons: [
      { label: "Cancel", className: "outline" },
      {
        label: editing ? "Save" : "Create instance",
        className: "primary",
        icon: editing ? "#i-check" : "#i-plus",
        onClick: async (handle) => {
          if (saving) return false;
          if (!pick.version) {
            toast("Pick a Minecraft version first.");
            return false;
          }
          const name = nameInput.value.trim() || `${LOADER_LABELS[pick.loader]} ${pick.version}`;
          const hud = (pick.loader === "fabric" || pick.loader === "quilt") && !hudSwitch.disabled && pick.hud;
          // Only instances that load mods say anything about the pack, and
          // only once the switch was touched or the loader changed - an
          // untouched switch keeps whatever the instance had.
          const loaderChanged = !editing || pick.loader !== existing.loader;
          const perf = perfEligible() && (pick.perf !== null || loaderChanged) ? { performanceMods: perfShown() } : {};
          const profile = { perfProfile: pick.profile };
          saving = true;
          handle.buttons[0].disabled = true;
          try {
            if (editing) {
              await window.reminth.updateInstance(existing.id, { name, mcVersion: pick.version, loader: pick.loader, loaderVersion: pick.build, hud, ...perf, ...profile });
              const perfOff = perfEligible() && !perfShown() && packOnByDefault(existing.loader, existing);
              toast(perfOff ? "Performance pack off — Reminth removes its copies the next time you press Play." : `${name} saved. Anything new downloads next time you press Play.`);
              await loadInstances();
              // A different version or loader can leave every mod on the wrong
              // build: look straight away and say so (features.js, section 7).
              if ((pick.version !== existing.mcVersion || pick.loader !== existing.loader) && typeof compatAfterEdit === "function") {
                compatAfterEdit(existing.id, pick.version);
              }
              // A newly picked profile: offer its optional mods (nothing is added unless ticked).
              if (pick.profile !== (existing.perfProfile || "balanced") && typeof offerProfileExtras === "function") {
                offerProfileExtras(existing.id, pick.profile, pick.loader);
              }
            } else {
              const inst = await window.reminth.createInstance({ name, mcVersion: pick.version, loader: pick.loader, loaderVersion: pick.build, hud, ...perf, ...profile });
              await loadInstances();
              await selectInstance(inst.id, true);
              toast(`${inst.name} created. Press Play and it downloads what it needs.`);
              if (typeof offerProfileExtras === "function") offerProfileExtras(inst.id, pick.profile, pick.loader);
            }
            return true;
          } catch (err) {
            toast(friendlyError(err.message));
            return false;
          } finally {
            saving = false;
            handle.buttons[0].disabled = false;
          }
        },
      },
    ],
  });
}

$("railAdd").onclick = () => openInstanceModal(null);
$("instMoreBtn").onclick = (e) => {
  e.stopPropagation();
  toggleMenu($("instMore"));
};
$("instMore").querySelectorAll(".dd-item").forEach((b) => b.addEventListener("click", () => $("instMore").classList.remove("dd-open")));
$("instEditBtn").onclick = () => {
  const inst = activeInstance();
  if (inst) openInstanceModal(inst);
};
$("instDeleteBtn").onclick = async () => {
  const inst = activeInstance();
  if (!inst || inst.id === "reminth") return;
  const body = el("div");
  body.appendChild(el("p", null, "This deletes the instance's whole folder — its mods, packs, worlds and screenshots. There's no undo."));
  body.appendChild(el("p", null, "Your saved logs stay in Reminth's archive."));
  // The delete runs inside the dialog, which can't be closed while it does.
  let deleting = false;
  openModal({
    title: `Delete ${inst.name}?`,
    body,
    focusCancel: true,
    canClose: () => !deleting,
    buttons: [
      { label: "Cancel", className: "outline" },
      {
        label: "Delete forever",
        className: "primary danger-fill",
        onClick: async (handle) => {
          if (deleting) return false;
          deleting = true;
          handle.buttons[0].disabled = true;
          try {
            await window.reminth.deleteInstance(inst.id);
            if (state.activeId === inst.id) state.activeId = "reminth";
            await loadInstances();
            if (currentPage === "instance") switchPage("home");
            toast(`${inst.name} deleted.`);
            return true;
          } catch (err) {
            toast(friendlyError(err.message));
            return false;
          } finally {
            deleting = false;
            handle.buttons[0].disabled = false;
          }
        },
      },
    ],
  });
};

/* ---- instance page (the header; tabs live in features.js) ---- */
async function renderInstancePage() {
  const inst = activeInstance();
  if (!inst) return;
  const art = $("instArt");
  art.textContent = "";
  art.appendChild(instanceChip(inst, true));
  $("instName").textContent = inst.name;
  $("instLoader").textContent = loaderLabel(inst);
  $("instVersion").textContent = inst.mcVersion;
  $("instLastPlayed").textContent = inst.lastPlayed ? "Last played " + formatRelativeTime(inst.lastPlayed) : "Never played";
  $("instPack").hidden = !inst.modpack;
  if (inst.modpack) $("instPack").textContent = `${inst.modpack.title}${inst.modpack.versionNumber ? " " + inst.modpack.versionNumber : ""}`;
  const instStatus = state.running.has(inst.id) ? "Running" : state.installing.has(inst.id) ? "Installing" : "Ready";
  $("instState").textContent = instStatus;
  $("instState").dataset.state = instStatus.toLowerCase();
  $("instDeleteBtn").hidden = inst.id === "reminth";
  $("instPlaytime").textContent = inst.playTimeMs ? formatPlaytime(msToTicks(inst.playTimeMs)) : "—";
  paintPlayButtons();
  if (window.onInstancePageOpen) window.onInstancePageOpen(inst);
}

/* ================================================================== *
 * play / install                                                      *
 * ================================================================== */
function progressSuffix() {
  return state.signedIn ? "" : "Out";
}

async function runPlay(options = {}) {
  const inst = options.instanceId ? instanceById(options.instanceId) : activeInstance();
  if (!inst) return;
  if (!state.signedIn) {
    toast("Sign in first.");
    switchPage("home");
    return;
  }
  if (state.installing.has(inst.id)) return;
  // Marked in flight before anything is awaited, so a second click (or a
  // second Play button) can't start another run while the mods are looked at
  // or the "won't start" question is open.
  state.installing.add(inst.id);
  if (inst.loader !== "vanilla" && typeof compatBeforePlay === "function") {
    state.progress.set(inst.id, { stage: "Checking mods", pct: null, short: "Checking" });
    paintPlayButtons();
    let go = true;
    try {
      go = await compatBeforePlay(inst);
    } catch {
      go = true; // the check is a courtesy - it never stands in the way of Play
    }
    state.progress.delete(inst.id);
    if (!go) {
      state.installing.delete(inst.id);
      paintPlayButtons();
      return;
    }
  }
  const onHome = inst.id === state.activeId;
  state.logError = false;
  // The stage de-dup is for one run: without this, a second run whose first
  // stage matches the last run's final one never gets its first log line.
  state.lastStage = null;
  if (onHome) {
    state.progressShown = inst.id;
    $("progressWrap").hidden = false;
    $("log").hidden = false;
    $("log").textContent = "";
    $("progressDismiss").hidden = true;
  }
  paintPlayButtons();
  try {
    const result = await window.reminth.play({ instanceId: inst.id, join: options.join || null });
    if (result && result.cancelled) {
      // The player backed out of something the backend asked: not a failure.
      if (onHome && !state.logError) {
        $("progressWrap").hidden = true;
        $("log").hidden = true;
      }
      return;
    }
    if (result && result.launched === false) throw new Error("The game didn't start.");
    toast(options.join ? (state.privacy ? "Minecraft is starting — joining the server…" : `Minecraft is starting — joining ${options.join.host}…`) : "Minecraft is starting…");
    scheduleHideProgress();
  } catch (err) {
    // The saved sign-in is no good any more: the sign-in card comes back,
    // with the reason on it, instead of a launch error on a page that can't
    // be used until the player signs in.
    if (signedOutByBackend(err)) return;
    // "Already running" isn't a fault to fix - it goes stale the moment the
    // game closes, so it's shown briefly instead of pinned.
    const alreadyRunning = /already running/i.test(err.message);
    const why = friendlyError(err.message);
    appendLog(`Couldn't launch ${inst.name}: ${why}`, !alreadyRunning);
    // Says it all itself: the player may be on any page.
    toast(alreadyRunning ? `${inst.name} is already running.` : `Couldn't launch ${inst.name}: ${why}`);
    if (alreadyRunning) scheduleHideProgress();
  } finally {
    state.installing.delete(inst.id);
    state.progress.delete(inst.id);
    paintPlayButtons();
    loadRecent();
  }
}

/** Puts the progress bars away a little after a run ends - both, since signing in or out mid-run moves it from one to the other. */
function scheduleHideProgress() {
  clearTimeout(window._hideProgress);
  window._hideProgress = setTimeout(() => {
    if (state.logError || state.installing.has(state.activeId)) return;
    for (const suffix of ["", "Out"]) {
      $("progressWrap" + suffix).hidden = true;
      $("log" + suffix).hidden = true;
    }
  }, 6000);
}

async function runInstall(instanceId) {
  const inst = instanceId ? instanceById(instanceId) : activeInstance();
  if (!inst || state.installing.has(inst.id)) return;
  if (state.running.has(inst.id)) return toast(`Close ${inst.name} first — files in use can't be checked or replaced.`);
  // The bar in use is asked for each time: signing in while this runs moves it.
  const suffix = progressSuffix();
  state.installing.add(inst.id);
  state.logError = false;
  state.lastStage = null; // see runPlay
  state.progressShown = inst.id;
  $("progressWrap" + suffix).hidden = false;
  $("log" + suffix).hidden = false;
  $("log" + suffix).textContent = "";
  $("progressDismiss" + suffix).hidden = true;
  paintPlayButtons();
  try {
    const result = await window.reminth.install(inst.id);
    if (result && result.removedMods && result.removedMods.length) {
      appendLog("Removed mods Reminth no longer installs for you: " + result.removedMods.join(", "), false, progressSuffix());
    }
    toast(`${inst.name} is up to date.`);
    scheduleHideProgress();
  } catch (err) {
    if (signedOutByBackend(err)) return;
    const why = friendlyError(err.message);
    appendLog("Update failed: " + why, true, progressSuffix());
    toast(`Couldn't update ${inst.name}: ${why}`);
  } finally {
    state.installing.delete(inst.id);
    state.progress.delete(inst.id);
    paintPlayButtons();
  }
}

// A click that lands on Play just after Stop was pressed (the second half of
// a double-click, once Stop has gone) must not start the game again.
const STOP_GRACE_MS = 600;
const playClick = () => {
  if (Date.now() - state.stopClickAt < STOP_GRACE_MS) return;
  runPlay();
};
$("playBtn").onclick = playClick;
$("instPlayBtn").onclick = playClick;

/** The game is gone (or never answered): Stop goes away, Play comes back. */
function stopFinished(instanceId) {
  if (!state.stopping.delete(instanceId)) return;
  clearTimeout(stopTimers.get(instanceId));
  stopTimers.delete(instanceId);
  state.running.delete(instanceId);
  state.stopClickAt = Date.now(); // Play is about to appear where Stop was
  paintPlayButtons();
}
const stopTimers = new Map(); // instance id -> fallback timer

async function stopGame() {
  const inst = activeInstance();
  if (!inst || state.stopping.has(inst.id)) return;
  state.stopClickAt = Date.now();
  state.stopping.add(inst.id);
  paintPlayButtons();
  try {
    const result = await window.reminth.stopGame({ instanceId: inst.id });
    toast(`Stopped ${inst.name}.`);
    // Nothing was running after all (a stale "Playing"): no exit will be announced.
    if (result && result.wasRunning === false) return stopFinished(inst.id);
    // play:exited normally follows at once. If it never comes, don't leave
    // the button on "Stopping…" for good.
    if (state.stopping.has(inst.id)) stopTimers.set(inst.id, setTimeout(() => stopFinished(inst.id), 4000));
  } catch (err) {
    state.stopping.delete(inst.id);
    paintPlayButtons();
    toast(friendlyError(err.message));
  }
}
$("stopBtn").onclick = () => stopGame();
$("instStopBtn").onclick = () => stopGame();
$("updateBtnOut").onclick = () => runInstall();
$("repairBtn").onclick = () => {
  switchPage("home");
  runInstall();
};
$("repairBtn2").onclick = () => {
  switchPage("home");
  runInstall();
};

function appendLog(line, isError, suffix) {
  if (isError) state.logError = true;
  const node = $("log" + (suffix || ""));
  $("progressWrap" + (suffix || "")).hidden = false;
  node.hidden = false;
  node.textContent += (isError ? "! " : "") + line.replace(/\n$/, "") + "\n";
  node.scrollTop = node.scrollHeight;
  const dismiss = $("progressDismiss" + (suffix || ""));
  if (dismiss) dismiss.hidden = !isError;
}

/** Clears a pinned progress bar/log - the × next to the percentage. */
function dismissLog(suffix) {
  state.logError = false;
  clearTimeout(window._hideProgress);
  $("progressWrap" + suffix).hidden = true;
  $("log" + suffix).hidden = true;
  $("progressDismiss" + suffix).hidden = true;
}
$("progressDismiss").onclick = () => dismissLog("");
$("progressDismissOut").onclick = () => dismissLog("Out");

window.reminth.onInstallProgress(({ instanceId, stage, current, total }) => {
  const determinate = total > 1;
  const pct = determinate ? Math.round((current / total) * 100) : null;
  const short = /Java/i.test(stage) ? "Java" : /asset/i.test(stage) ? "Assets" : /librar/i.test(stage) ? "Libraries" : /native/i.test(stage) ? "Natives" : /client jar/i.test(stage) ? "Game" : "Installing";
  state.progress.set(instanceId, { stage, pct, short });
  paintPlayButtons();
  if (instanceId !== state.activeId) return;
  paintProgress(instanceId);
  // Only stage changes go in the log - not every tick of the counter.
  if (state.lastStage !== stage) {
    state.lastStage = stage;
    appendLog(stage, false, progressSuffix());
  }
});

/** Paints the bar from the latest progress kept for that instance. */
function paintProgress(instanceId) {
  const p = state.progress.get(instanceId);
  if (!p) return;
  const suffix = progressSuffix();
  const determinate = p.pct !== null;
  state.progressShown = instanceId;
  $("progressWrap" + suffix).hidden = false;
  $("progressStage" + suffix).textContent = p.stage;
  $("progressPct" + suffix).textContent = determinate ? p.pct + "%" : "";
  $("progressFill" + suffix).style.width = determinate ? p.pct + "%" : "100%";
  $("progressFill" + suffix).classList.toggle("busy", !determinate);
}

/**
 * Run when the active instance changes. Progress events for an instance that
 * isn't active are only stored, so without this the bar kept showing the
 * instance you came from until the next event (or for good, if none came).
 */
function paintActiveProgress() {
  const id = state.activeId;
  if (state.installing.has(id) && state.progress.has(id)) return paintProgress(id);
  // The bar is still painting another instance's run: put it away, unless
  // it's pinned open on an error the player hasn't dismissed yet.
  if (state.progressShown && state.progressShown !== id && !state.logError) {
    const suffix = progressSuffix();
    $("progressWrap" + suffix).hidden = true;
    $("log" + suffix).hidden = true;
    state.progressShown = null;
  }
}

window.reminth.onInstallDone(({ instanceId }) => {
  if (instanceId !== state.activeId) return;
  const suffix = progressSuffix();
  $("progressStage" + suffix).textContent = "Ready";
  $("progressPct" + suffix).textContent = "100%";
  $("progressFill" + suffix).style.width = "100%";
  $("progressFill" + suffix).classList.remove("busy");
});

window.reminth.onPlayStarted(({ instanceId }) => {
  state.running.add(instanceId);
  renderRail();
  paintPlayButtons();
  if (currentPage === "instance") renderInstancePage();
});
window.reminth.onPlayExited(({ instanceId }) => {
  state.running.delete(instanceId);
  stopFinished(instanceId);
  loadInstances();
  loadRecent();
  loadStats();
});
window.reminth.onPlayCrashed(({ instanceId, code, signal, error, logPath }) => {
  state.running.delete(instanceId);
  stopFinished(instanceId);
  paintPlayButtons();
  const reason = error ? friendlyError(error) : signal ? `the game process was killed (${signal})` : `the game process exited immediately (code ${code})`;
  const inst = instanceById(instanceId);
  const name = inst ? inst.name : "Minecraft";
  // The message goes in the Home log under the instance's own name; the
  // active instance is left alone (a dialog may be open that is about it).
  // With "Hide personal info" on, the path (it has the Windows user name in it) is left out.
  appendLog(`${name} closed right after launching — ${reason}. Check the Logs tab on the instance${logPath && !state.privacy ? `, or the launch log: ${logPath}` : ""}.`, true);
  toast(`${name} closed right after launching — ${reason}. Its Logs tab has the details.`);
});

/* ================================================================== *
 * home + library: worlds and servers                                  *
 * ================================================================== */
function disambiguate(entries) {
  const counts = new Map();
  entries.forEach((e) => counts.set(e.name, (counts.get(e.name) || 0) + 1));
  entries.forEach((e) => {
    e.subtitle = e.type === "world" && counts.get(e.name) > 1 && e.folder !== e.name ? e.folder : null;
  });
  return entries;
}

function recentCard(entry, { showInstance } = {}) {
  const card = el("div", "card recent");
  const art = el("div", "recent-art " + entry.type);
  art.appendChild(el("span", "recent-kind " + entry.type, entry.type === "world" ? "World" : "Server"));
  const tile = el("div", "icon-tile");
  const glyph = () => {
    tile.classList.add("is-glyph");
    tile.appendChild(icon(entry.type === "world" ? "#i-block" : "#i-server", entry.type === "world" ? "block-mark" : "server-mark"));
  };
  if (entry.icon) {
    const img = el("img");
    img.src = entry.icon;
    img.alt = "";
    // An icon that won't load gets the drawn mark, not a broken-image glyph.
    img.addEventListener("error", () => {
      img.remove();
      glyph();
    });
    tile.appendChild(img);
  } else glyph();
  art.appendChild(tile);
  const body = el("div", "recent-body");
  body.appendChild(el("div", "recent-name", entry.name));
  const meta = el("div", "recent-meta");
  const bits = [];
  if (entry.subtitle) bits.push([entry.subtitle]);
  if (showInstance && entry.instanceName && state.instances.length > 1) bits.push([entry.instanceName]);
  if (entry.type === "world") {
    if (entry.playTimeTicks) bits.push([formatPlaytime(entry.playTimeTicks)]);
    if (entry.gameMode) bits.push([entry.gameMode]);
  } else {
    bits.push([entry.address, "pii"]);
  }
  const when = formatWhen(entry.lastPlayed);
  if (when) bits.push([when]);
  // The "·" between them is drawn by CSS (.sep-list), so a line never starts or ends with one.
  meta.classList.add("sep-list");
  bits.forEach(([text, cls]) => meta.appendChild(el("span", cls || null, text)));
  body.appendChild(meta);
  card.appendChild(art);
  card.appendChild(body);
  return card;
}

function addInstanceTile() {
  const card = el("div", "card recent add-tile");
  const art = el("div", "recent-art");
  const tile = el("div", "icon-tile is-glyph");
  tile.appendChild(icon("#i-plus", "add-mark"));
  art.appendChild(tile);
  card.appendChild(art);
  const body = el("div", "recent-body");
  body.appendChild(el("div", "recent-name", "New instance"));
  const meta = el("div", "recent-meta");
  meta.appendChild(el("span", null, "Any version, any loader"));
  body.appendChild(meta);
  card.appendChild(body);
  clickable(card, () => openInstanceModal(null));
  return card;
}

async function loadRecent() {
  let data;
  try {
    data = await window.reminth.recent();
  } catch (err) {
    data = { recent: [], worlds: [], servers: [], worldCount: 0, serverCount: 0, totalPlayTimeTicks: 0, error: err.message };
  }
  state.recent = data;
  const grid = $("recentGrid");
  if (data.error) {
    renderEmpty(grid, "Couldn't read your saves folder", friendlyError(data.error));
    grid.prepend(addInstanceTile());
    $("recentNote").textContent = "";
  } else if (!data.recent.length) {
    renderEmpty(grid, "Nothing played yet", "Start the game and your worlds and servers will show up here.");
    grid.prepend(addInstanceTile());
    $("recentNote").textContent = "";
  } else {
    grid.textContent = "";
    grid.appendChild(addInstanceTile());
    disambiguate(data.recent).forEach((entry) => grid.appendChild(recentCard(entry, { showInstance: true })));
    $("recentNote").textContent = `${data.worldCount} world${data.worldCount === 1 ? "" : "s"} · ${data.serverCount} saved server${data.serverCount === 1 ? "" : "s"}`;
  }

  const inst = activeInstance();
  // Lifetime total across every instance, not whichever one is active.
  const totalPlayMs = state.instances.reduce((sum, i) => sum + (i.playTimeMs || 0), 0);
  $("heroPlaytime").textContent = totalPlayMs ? formatPlaytime(msToTicks(totalPlayMs)) : formatPlaytime(data.totalPlayTimeTicks);
  const last = inst && inst.lastPlayed ? inst.lastPlayed : data.recent[0] && data.recent[0].lastPlayed;
  $("heroLast").textContent = last ? formatWhen(last) : "Never";

  fillGrid("libWorldGrid", data.worlds || [], "libWorldsNote", {
    emptyTitle: "No worlds yet",
    emptyNote: "Create one in game and it'll show up here.",
    showInstance: true,
  });
  fillGrid("libServerGrid", data.servers || [], "libServersNote", {
    emptyTitle: "No servers saved yet",
    emptyNote: "Add one in game, or from Discover → Servers.",
    showInstance: true,
  });
  $("sideWorlds").textContent = String(data.worldCount || 0);
  $("sideServers").textContent = String(data.serverCount || 0);
}

function fillGrid(gridId, entries, noteId, copy) {
  const grid = $(gridId);
  if (!grid) return;
  const note = noteId ? $(noteId) : null;
  if (!entries.length) {
    renderEmpty(grid, copy.emptyTitle, copy.emptyNote);
    if (note) note.textContent = "";
    return;
  }
  grid.textContent = "";
  disambiguate(entries).forEach((entry) => grid.appendChild(recentCard(entry, copy)));
  if (note) note.textContent = `${entries.length} total · newest first`;
}

/* ---- Library → Instances, with a sort ---- */
let libSort = localGet("sort.library", "new");
const libSortDd = makeDropdown($("libSort"), {
  options: SORT_OPTIONS,
  value: libSort,
  align: "right",
  onChange: (v) => {
    libSort = v;
    localSet("sort.library", v);
    renderLibraryInstances();
  },
});
void libSortDd;

function renderLibraryInstances() {
  const grid = $("libInstanceGrid");
  if (!grid) return;
  grid.textContent = "";
  const sorted = sortItems(state.instances, libSort, (i) => i.name, (i) => i.lastPlayed || i.createdAt || 0);
  for (const inst of sorted) {
    const tile = el("div", "card lib-tile");
    const art = el("div", "lib-art");
    art.appendChild(instanceChip(inst));
    tile.appendChild(art);
    const meta = el("div", "lib-meta");
    meta.appendChild(el("div", "lib-name", inst.name));
    const sub = el("div", "lib-sub sep-list");
    sub.appendChild(el("span", null, `${loaderLabel(inst)} ${inst.mcVersion}`));
    sub.appendChild(el("span", null, inst.lastPlayed ? `played ${formatWhen(inst.lastPlayed)}` : "never played"));
    meta.appendChild(sub);
    tile.appendChild(meta);
    if (state.running.has(inst.id)) tile.appendChild(el("span", "tag emerald", "Running"));
    clickable(tile, () => selectInstance(inst.id, true));
    grid.appendChild(tile);
  }
  const add = el("div", "card lib-tile add");
  const addArt = el("div", "lib-art");
  addArt.appendChild(icon("#i-plus", "add-mark"));
  add.appendChild(addArt);
  const addMeta = el("div", "lib-meta");
  addMeta.appendChild(el("div", "lib-name", "New instance"));
  addMeta.appendChild(el("div", "lib-sub", "Any version or snapshot · Fabric, Quilt, Forge, NeoForge or vanilla"));
  add.appendChild(addMeta);
  clickable(add, () => openInstanceModal(null));
  grid.appendChild(add);
}

/* ================================================================== *
 * what's new                                                          *
 * ================================================================== */
// A hand-written list for this release; the version beside it comes from the app.
const CHANGELOG = [
  "Before Play, Reminth checks your mods and says which ones won't load — and fixes them in one click.",
  "\"Which Minecraft version should I use?\" finds the version all your mods have builds for, and copies your instance to it.",
  "Servers show which versions they take. Play finds, or makes, an instance that fits.",
  "Safer saves: settings, instances and downloads are written so a crash or power cut can't leave a half-written file.",
  "Performance: Java settings chosen for your Java version, a bigger performance pack from Modrinth (stable builds only, now on Forge and NeoForge too), and optional Max FPS and Far view profiles for new instances.",
  "Any Minecraft version, on Fabric, Quilt, Forge or NeoForge. Modpacks install in one click, and one button updates everything in an instance.",
  "Logs kept per instance, 3D skins and capes, and streamer mode with clips and screenshots.",
];

function renderChangelog() {
  const box = $("changelog");
  box.textContent = "";
  $("changelogVersion").textContent = "Reminth " + (state.info ? state.info.appVersion : "");
  const list = el("ul", "change-list");
  CHANGELOG.forEach((item) => list.appendChild(el("li", null, item)));
  const wrap = el("div", "changelog-body");
  wrap.appendChild(list);
  box.appendChild(wrap);
}

/* ================================================================== *
 * player statistics                                                   *
 * ================================================================== */
function bigStat(label, value, note, colour) {
  const card = el("div", "card big-stat");
  card.appendChild(el("span", "k", label));
  const v = el("b", "v", value);
  if (colour) v.style.setProperty("--vc", colour);
  card.appendChild(v);
  if (note) card.appendChild(el("span", "n", note));
  return card;
}

function barList(title, entries, formatValue, rawLabels) {
  const card = el("div", "card bars");
  card.appendChild(el("h2", "bars-title", title));
  const max = entries.reduce((m, e) => Math.max(m, e.count), 0) || 1;
  entries.forEach((entry) => {
    const row = el("div", "bar-row");
    row.appendChild(el("div", "bar-label", rawLabels ? entry.id : prettyId(entry.id)));
    const track = el("div", "bar-track");
    const fill = el("div", "bar-fill");
    fill.style.width = Math.max(4, (entry.count / max) * 100) + "%";
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(el("div", "bar-val", formatValue ? formatValue(entry.count) : formatNumber(entry.count)));
    card.appendChild(row);
  });
  return card;
}

function updateHomeStatRow(stats) {
  const ok = Boolean(stats) && !stats.error;
  const num = (v) => formatNumber(v || 0);
  $("statMobKills").textContent = ok ? num(stats.mobKills) : "—";
  $("statPlayerKills").textContent = ok ? num(stats.playerKills) : "—";
  $("statDeaths").textContent = ok ? num(stats.deaths) : "—";
  $("statDeathsNote").textContent = ok ? (stats.deaths ? "Happens to everyone" : "Flawless so far") : "—";
  $("statPlaced").textContent = ok ? num(stats.totals && stats.totals.used) : "—";
  $("statBroken").textContent = ok ? num(stats.totals && stats.totals.mined) : "—";
}

async function loadStats() {
  const body = $("statsBody");
  let stats;
  try {
    stats = await window.reminth.stats();
  } catch {
    stats = { found: false };
  }
  state.stats = stats;
  updateHomeStatRow(stats);
  body.textContent = "";
  if (stats.error) return renderEmpty(body, "Couldn't read your statistics", friendlyError(stats.error));
  if (!stats.found) {
    return renderEmpty(
      body,
      "No statistics yet",
      state.signedIn ? "Play a world and Minecraft starts recording your stats. They show up here automatically." : "Sign in and play a world — your stats come straight from your own save files."
    );
  }
  // Any part of the answer may be missing (a save with no stats file yet).
  const totals = stats.totals || {};
  const top = stats.top || {};
  const perWorld = stats.perWorld || [];
  const cards = el("div", "stat-cards");
  cards.appendChild(bigStat("Time played", formatPlaytime(stats.playTimeTicks), `Across ${stats.worldCount || 0} world${stats.worldCount === 1 ? "" : "s"}`, "var(--amber)"));
  cards.appendChild(bigStat("Deaths", formatNumber(stats.deaths), stats.deaths ? "Happens to everyone" : "Flawless so far", "var(--rose)"));
  cards.appendChild(bigStat("Mobs killed", formatNumber(stats.mobKills), null, "var(--violet)"));
  cards.appendChild(bigStat("Blocks mined", formatNumber(totals.mined), null, "var(--cyan)"));
  cards.appendChild(bigStat("Jumps", formatNumber(stats.jumps), null, "var(--emerald)"));
  cards.appendChild(bigStat("Damage dealt", formatNumber(Math.round((stats.damageDealt || 0) / 10)), "Damage points", "var(--rose)"));
  body.appendChild(cards);

  // "minecraft:sprint_one_cm" -> "Sprint"
  const distanceEntries = Object.entries(stats.distances || {})
    .filter(([, cm]) => cm > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id, cm]) => ({ id: prettyId(String(id).replace(/_one_cm$/, "")), count: cm }));
  const grid = el("div", "two-col");
  grid.style.marginTop = "14px";
  if (distanceEntries.length) grid.appendChild(barList("Distance travelled", distanceEntries, formatDistance, true));
  if ((top.mined || []).length) grid.appendChild(barList("Most mined", top.mined));
  if ((top.killed || []).length) grid.appendChild(barList("Most killed", top.killed));
  if ((top.used || []).length) grid.appendChild(barList("Most used", top.used));
  if (perWorld.length > 1) {
    grid.appendChild(
      barList(
        "Time by world",
        perWorld.map((w, _i, all) => ({ id: all.filter((o) => o.name === w.name).length > 1 && w.folder !== w.name ? `${w.name} (${w.folder})` : w.name, count: w.playTimeTicks })),
        (ticks) => formatPlaytime(ticks),
        true
      )
    );
  }
  if ((top.killedBy || []).length) grid.appendChild(barList("Killed by", top.killedBy));
  if (grid.children.length) body.appendChild(grid);
}
$("refreshStats").onclick = () => {
  loadStats();
  toast("Statistics refreshed.");
};

/* ================================================================== *
 * settings                                                            *
 * ================================================================== */
function setSwitch(id, on) {
  const btn = $(id);
  btn.classList.toggle("on", !!on);
  btn.setAttribute("aria-checked", on ? "true" : "false");
}

async function saveSetting(partial, note) {
  try {
    const saved = await window.reminth.setSettings(partial);
    const problems = saved._hotkeyProblems || [];
    delete saved._hotkeyProblems;
    state.settings = saved;
    if (window.onSettingsSaved) window.onSettingsSaved(saved, problems);
    if (note) toast(note);
    return true;
  } catch (err) {
    toast(friendlyError(err.message) || "Couldn't save that setting.");
    return false;
  }
}

function wireSwitch(id, key, note) {
  $(id).onclick = async () => {
    const on = !$(id).classList.contains("on");
    setSwitch(id, on);
    const saved = await saveSetting({ [key]: on }, typeof note === "function" ? note(on) : note);
    if (!saved) setSwitch(id, !on);
  };
}
wireSwitch("toggleLaunchMinimized", "launchMinimized", (on) => (on ? "Reminth will minimize when the game starts." : "Reminth will stay open when the game starts."));
wireSwitch("toggleHardwareAccel", "hardwareAcceleration", "Restart Reminth for that to take effect.");

$("toggleFullscreen").onclick = async () => {
  const on = !$("toggleFullscreen").classList.contains("on");
  setSwitch("toggleFullscreen", on);
  setResolutionEnabled(!on);
  const saved = await saveSetting({ fullscreen: on }, on ? "Minecraft will start fullscreen." : "Minecraft will start windowed.");
  if (!saved) {
    setSwitch("toggleFullscreen", !on);
    setResolutionEnabled(on);
  }
};

/* ---- RAM: what this PC can spare, up to Reminth's own ceiling ---- */
function ramLimits() {
  const plan = (state.info && state.info.plan) || {};
  const totalGb = state.info ? state.info.totalMemoryMb / 1024 : 8;
  // What the PC could give once Windows has its 2 GB, in half-GB steps.
  const spareGb = Math.max(1, Math.floor((totalGb - 2) * 2) / 2);
  const capGb = plan.ramCapMb ? plan.ramCapMb / 1024 : Math.min(16, spareGb);
  return { capGb, totalGb, spareGb };
}

function paintRam(gb) {
  const { capGb, totalGb, spareGb } = ramLimits();
  $("ramVal").textContent = (Number.isInteger(gb) ? gb : gb.toFixed(1)) + " GB";
  let note;
  if (gb <= 1) note = "Very tight — Minecraft may stutter or run out of memory.";
  else if (gb <= 2.5) note = "Fine for vanilla and a light mod list.";
  else if (gb <= 4.5) note = "Comfortable for a modded setup with shaders.";
  else if (gb <= 8) note = "Room for heavy modpacks.";
  else note = "More than almost any modpack needs — past ~8 GB, garbage-collection pauses get longer, not shorter.";
  const left = totalGb - gb;
  if (left < 3) note += ` Leaves only ${left.toFixed(1)} GB for Windows and everything else you have open.`;
  // Reminth's ceiling, not the PC, is the limit when the PC could spare more.
  else if (gb >= capGb) note += capGb < spareGb ? ` That's the most Reminth allows on this PC.` : ` That's the most this PC can spare (${Math.round(totalGb)} GB installed).`;
  $("ramNote").textContent = note;
}

function paintRamScale() {
  const { capGb } = ramLimits();
  // The slider never offers more than can be saved (a 3 GB PC stops at 1 GB).
  const max = Math.max(1, capGb);
  $("ramRange").max = String(max);
  $("ramRange").disabled = max <= 1;
  $("ramMaxMark").textContent = `${max} GB`;
  const mid = Math.round(((1 + max) / 2) * 2) / 2;
  $("ramMidMark").textContent = max > 1.5 ? `${Number.isInteger(mid) ? mid : mid.toFixed(1)} GB` : "";
}

$("ramRange").addEventListener("input", () => paintRam(Number($("ramRange").value)));
$("ramRange").addEventListener("change", () => {
  const gb = Math.min(Number($("ramRange").value), ramLimits().capGb);
  saveSetting({ maxMemoryMb: Math.round(gb * 1024) }, `Minecraft will use up to ${gb} GB from your next launch.`);
});

function setResolutionEnabled(enabled) {
  $("resolutionRow").style.opacity = enabled ? "1" : ".45";
  $("gameWidth").disabled = !enabled;
  $("gameHeight").disabled = !enabled;
}

/** Puts the saved size back in the boxes, so they never show something that wasn't saved. */
function paintResolution() {
  const cfg = state.settings || {};
  $("gameWidth").value = cfg.gameWidth || "";
  $("gameHeight").value = cfg.gameHeight || "";
}

async function commitResolution() {
  const note = $("resolutionNote");
  const say = (text) => {
    note.textContent = text || "";
    note.hidden = !text;
  };
  // "" with badInput set = something typed that isn't a number at all.
  const read = (input) => {
    if (input.validity.badInput) return NaN;
    if (!input.value.trim()) return null;
    return Math.round(input.valueAsNumber);
  };
  const boxes = [$("gameWidth"), $("gameHeight")];
  const [w, h] = boxes.map(read);
  if (Number.isNaN(w) || Number.isNaN(h)) return say("That isn't a number — type a size in pixels, like 1280 × 720.");
  if (w === null && h === null) {
    say("");
    if (!(await saveSetting({ gameWidth: null, gameHeight: null }, "Minecraft will use its own window size."))) paintResolution();
    return;
  }
  // Half filled in: nothing is saved yet, and nothing is said to be.
  if (w === null || h === null) return say("Fill in both width and height — or leave both blank to use Minecraft's own size.");
  const clamp = (n, input) => Math.min(Number(input.max), Math.max(Number(input.min), n));
  const width = clamp(w, boxes[0]);
  const height = clamp(h, boxes[1]);
  say(width !== w || height !== h ? `Changed to ${width} × ${height} — sizes go from ${boxes[0].min} × ${boxes[1].min} to ${boxes[0].max} × ${boxes[1].max}.` : "");
  await saveSetting({ gameWidth: width, gameHeight: height }, `Minecraft will open at ${width}×${height}.`);
  paintResolution(); // what was saved - or, if the save failed, what still is
}
$("gameWidth").addEventListener("change", commitResolution);
$("gameHeight").addEventListener("change", commitResolution);
$("saveJvmArgs").onclick = () => saveSetting({ extraJvmArgs: $("extraJvmArgs").value.trim() }, "Saved. Applies on your next launch.");

document.querySelectorAll(".accent").forEach((btn) => {
  btn.onclick = async () => {
    const previous = document.documentElement.dataset.accent || "cyan";
    const accent = btn.dataset.accent;
    applyAccent(accent);
    if (!(await saveSetting({ accent }))) applyAccent(previous);
  };
});
function applyAccent(accent) {
  document.documentElement.dataset.accent = accent;
  document.querySelectorAll(".accent").forEach((b) => b.classList.toggle("selected", b.dataset.accent === accent));
}

async function openFolder(which, instanceId) {
  try {
    await window.reminth.openFolder(which, instanceId || state.activeId);
  } catch {
    toast("Couldn't open that folder.");
  }
}
$("openGameFolder").onclick = () => openFolder("game");
$("openGameFolder2").onclick = () => openFolder("game");
$("openModsFolder").onclick = () => openFolder("mods");

/* ================================================================== *
 * startup                                                             *
 * ================================================================== */
async function boot() {
  $("appSide").style.display = "flex";

  try {
    const account = await window.reminth.currentAccount();
    if (account && account.username) {
      state.signedIn = true;
      state.username = account.username;
    }
  } catch {
    /* stays signed out */
  }

  try {
    state.info = await window.reminth.appInfo();
    $("aboutVersion").textContent = "Reminth " + state.info.appVersion;
    $("aboutBuild").textContent = `Default instance: Minecraft ${state.info.minecraftVersion} · Fabric ${state.info.fabricLoaderVersion}`;
    renderChangelog();
  } catch {
    toast("Couldn't read launcher info.");
  }

  try {
    state.settings = await window.reminth.getSettings();
    const s = state.settings;
    state.activeId = s.activeInstance || "reminth";
    applyAccent(s.accent || "cyan");
    setSwitch("toggleLaunchMinimized", s.launchMinimized);
    setSwitch("toggleHardwareAccel", s.hardwareAcceleration !== false);
    setSwitch("toggleFullscreen", s.fullscreen);
    setResolutionEnabled(!s.fullscreen);
    paintResolution();
    $("extraJvmArgs").value = s.extraJvmArgs || "";
    const defaultGb = (state.info ? state.info.defaultMaxMemoryMb : 2048) / 1024;
    const { capGb } = ramLimits();
    const gb = Math.min(s.maxMemoryMb ? Math.round((s.maxMemoryMb / 1024) * 2) / 2 : defaultGb, capGb);
    paintRamScale();
    $("ramRange").value = String(gb);
    paintRam(Number($("ramRange").value));
  } catch {
    /* defaults already in the markup */
  }

  await loadInstances();
  applyAccountUI();
  if (state.instancesError) toast("Reminth couldn't read your instances — restart it and try again.");
  loadRecent();
  loadStats();
  if (window.bootFeatures) window.bootFeatures();
}

// features.js loads after this file; boot once everything is defined.
document.addEventListener("DOMContentLoaded", boot);
