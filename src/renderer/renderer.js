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

/** A toast with one button (e.g. "Undo") that stays up `ms` (about 10 s); the button works once. */
function toastWithAction(message, label, onAction, ms = 10000) {
  toast(message);
  const b = $("toastAction");
  b.textContent = label;
  b.hidden = false;
  b.disabled = false;
  b.onclick = async () => {
    if (b.disabled) return;
    b.disabled = true;
    $("toast").classList.remove("show");
    try {
      await onAction();
    } catch (err) {
      toast(friendlyError(err.message));
    }
  };
  clearTimeout(window._toast);
  window._toast = setTimeout(() => {
    $("toast").classList.remove("show");
    b.hidden = true;
  }, ms);
}

/**
 * Before Reminth makes an instance the player didn't ask for in the New
 * instance dialog: ONE question, the same everywhere. When an instance is
 * already on that version and loader it is offered first. Resolves
 * { action: "create", name } | { action: "use", instance } | null (cancel).
 */
function confirmNewInstance({ name, mcVersion, loader, title }) {
  const finalName = window.ReminthPure.uniqueInstanceName(name, state.instances, mcVersion, loader);
  const existing = window.ReminthPure.reusableInstance(state.instances, { mcVersion, loader });
  return new Promise((resolve) => {
    let answer = null;
    const body = el("div");
    body.appendChild(el("p", null, window.ReminthPure.createSentence({ name: finalName, mcVersion, loader })));
    if (finalName !== String(name || "").trim().slice(0, 48)) body.appendChild(el("p", "set-note", `You already have one called ${String(name).trim()}, so this one is ${finalName}.`));
    if (existing) body.appendChild(el("p", "set-note", `${existing.name} is already on Minecraft ${mcVersion}${loader === "vanilla" ? "" : " with " + (LOADER_LABELS[loader] || loader)} - you can use it instead.`));
    const buttons = [{ label: "Cancel", className: "outline" }];
    if (existing) {
      buttons.push({ label: "Make a new one", className: "outline", onClick: () => ((answer = { action: "create", name: finalName }), true) });
      buttons.push({ label: `Use ${existing.name}`, className: "primary", onClick: () => ((answer = { action: "use", instance: existing }), true) });
    } else {
      buttons.push({ label: "Create", className: "primary", onClick: () => ((answer = { action: "create", name: finalName }), true) });
    }
    openModal({ title: title || "Make a new instance?", body, onClose: () => resolve(answer), buttons });
  });
}

/**
 * "Undo" after Reminth made an instance by itself: offered only while it was
 * never played and holds no world (main.js checks it again).
 */
function offerUndoCreate(inst, message) {
  if (!inst || inst.lastPlayed) return toast(message);
  toastWithAction(message, "Undo", async () => {
    await window.reminth.undoCreateInstance(inst.id);
    await loadInstances();
    if (!instanceById(state.activeId)) {
      const next = heroInstance();
      if (next) await selectInstance(next.id, false);
      if (currentPage === "instance") switchPage("home");
    }
    toast(`${inst.name} removed.`);
  });
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
  $("toastAction").hidden = true;
  $("toastAction").onclick = null;
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
// The launcher's own updates (main/updater.js). The top bar shows a download
// and a ready update; Settings shows every state of a check the player asked for.
const upd = { last: null, checking: false, installing: false };

/** Paints both places from the last state main sent (or answered). */
function paintUpdate(next) {
  if (next) upd.last = next;
  const s = upd.last || { state: "idle" };
  const v = s.version ? `Reminth ${s.version}` : "The update";
  const playing = state.running.size > 0;
  // top bar: only a download and a ready update
  const bar = s.state === "downloading" || s.state === "ready";
  $("updateBar").hidden = !bar;
  if (bar) {
    $("updateText").textContent =
      s.state === "ready"
        ? playing
          ? `${v} is ready. Close Minecraft first, then restart to install it.`
          : `${v} is ready. It installs when you restart.`
        : `Downloading ${v}… ${Number.isFinite(s.percent) ? s.percent + "%" : ""}`.trim();
  }
  $("updateRestartBtn").hidden = s.state !== "ready";
  // Settings
  const text = {
    idle: "Updates download by themselves and install when you restart Reminth.",
    dev: s.message || "Updates only work in the installed app.",
    checking: "Checking…",
    "up-to-date": `You're on the latest version (${s.currentVersion || s.version || (state.info && state.info.appVersion) || ""}).`,
    downloading: `Downloading ${v}… ${Number.isFinite(s.percent) ? s.percent + "%" : ""}`.trim(),
    ready: playing ? `${v} is ready. Close Minecraft first.` : `${v} is ready.`,
    error: s.message || "Couldn't check for updates.",
  }[s.state] || "";
  $("updState").textContent = text;
  $("updState").classList.toggle("warn-note", s.state === "error");
  $("updManual").hidden = s.state !== "error";
  $("updRestartBtn").hidden = s.state !== "ready";
  for (const id of ["updRestartBtn", "updateRestartBtn"]) {
    $(id).disabled = upd.installing || playing;
    $(id).title = playing ? "Close Minecraft first" : "";
  }
  $("updCheckBtn").disabled = upd.checking || s.state === "checking" || s.state === "downloading";
  $("updCheckBtn").hidden = s.state === "ready";
}

window.reminth.onUpdateStatus((s) => paintUpdate(s));

$("updCheckBtn").onclick = async () => {
  if (upd.checking) return;
  upd.checking = true;
  paintUpdate({ ...(upd.last || {}), state: "checking" });
  try {
    paintUpdate(await window.reminth.checkForUpdates());
  } catch {
    paintUpdate({ state: "error", message: "Couldn't check for updates - try again later, or download it manually." });
  } finally {
    upd.checking = false;
    paintUpdate();
  }
};

async function installLauncherUpdate() {
  if (upd.installing) return;
  if (state.running.size) return toast("Close Minecraft first — the update needs Reminth to restart.");
  upd.installing = true;
  paintUpdate();
  try {
    const r = await window.reminth.installUpdate();
    if (r && r.ok === false) toast(r.reason || "Couldn't start the update.");
  } catch {
    toast("Couldn't start the update — download it manually from Settings.");
  } finally {
    upd.installing = false;
    paintUpdate();
  }
}
$("updateRestartBtn").onclick = installLauncherUpdate;
$("updRestartBtn").onclick = installLauncherUpdate;

/** What the Settings card should say when it opens. */
async function refreshUpdateState() {
  if (upd.checking) return;
  try {
    paintUpdate(await window.reminth.updateState());
  } catch {
    paintUpdate();
  }
}

function paintMaxButton(isMaximized) {
  // Always one square (the owner's call, 7 Oct 2026: like most apps he uses), whether maximized or not; the
  // tooltip still says what a click does.
  $("maxBtn").querySelector("span").className = "wc-max";
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
  library: ["Library", "Your clips and screenshots."],
  discover: ["Discover", "Modpacks, mods, packs, shaders and servers."],
  skins: ["Appearance", "How you look in game."],
  hosting: ["Servers", "Play together without the setup."],
  plus: ["Reminth+", "Your own server, minus the landlord."],
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
  if ((!state.signedIn || rmGateNeeded()) && page !== "home") return;
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
  if (page === "home") loadRecent();
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
  paintTopChip();
  setAvatar($("settingsAvatar"), skin, letter);
  setAvatar($("sideAvatar"), skin, letter);
  if (window.onAccountSkin) window.onAccountSkin(skin);
}

function applyAccountUI() {
  const signedIn = state.signedIn;
  const name = state.username || "Not signed in";
  $("settingsName").textContent = name;
  $("settingsState").textContent = signedIn ? "Microsoft account connected" : "Not connected";
  $("settingsAuthBtn").textContent = signedIn ? "Sign out" : "Sign in";
  $("sideName").textContent = name;
  $("sideState").textContent = signedIn ? "Microsoft · online" : "Not connected";
  // step 1 the Reminth account (when switched on), step 2 Minecraft
  const needRm = rmGateNeeded();
  $("rmGate").hidden = !needRm;
  $("signInHero").hidden = signedIn || needRm;
  $("mcSteps").hidden = !(state.rm && state.rm.user && state.rm.accounts);
  $("homeMain").hidden = !signedIn || needRm;
  const greeting = $("heroGreeting");
  greeting.textContent = signedIn ? "Welcome back, " : "Ready to play?";
  if (signedIn) greeting.appendChild(el("span", "pii", state.username));
  // The same sign-in card gates the whole app, not just Home: signed out, the
  // rail, top actions and sidebar are hidden (styles.css, #app.signed-out)
  // and switchPage refuses every page but Home.
  $("app").classList.toggle("signed-out", !signedIn || needRm);
  if ((!signedIn || needRm) && currentPage !== "home") switchPage("home");
  paintTopChip();
  refreshSkin();
}

/* ---- Reminth account (Discord / Google / email) - main/reminthAccount.js ----
 * When accounts are switched on on the server, a Reminth account is step 1 (the #rmGate card on Home, the whole app
 * waits behind it like it does for the Microsoft sign-in), Minecraft is step 2. Accounts off, or the server can't be
 * reached: no gate, the launcher works as before. The top bar chip shows the Reminth account. */
state.rm = { user: null, accounts: false, providers: [], checked: false };
const RM_NAMES = { discord: "Discord", google: "Google", email: "email" };

function rmGateNeeded() {
  return Boolean(state.rm && state.rm.checked && state.rm.accounts && !state.rm.user);
}

function rmAvatarInto(av, user) {
  av.textContent = "";
  if (user && user.avatarUrl && !user.offline) {
    const img = new Image();
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.src = user.avatarUrl;
    img.onerror = () => {
      av.textContent = "";
      av.appendChild(el("span", "avatar-letter", (user.name || "R").slice(0, 1).toUpperCase()));
    };
    av.appendChild(img);
  } else {
    av.appendChild(el("span", "avatar-letter", user ? (user.name || "R").slice(0, 1).toUpperCase() : "R"));
  }
}

/** The top bar chip: the Reminth account when there is one, the Microsoft account otherwise. */
function paintTopChip() {
  const user = state.rm && state.rm.user;
  if (!user) {
    $("topName").textContent = state.username || "Not signed in";
    $("topState").textContent = state.signedIn ? "Online" : "Offline";
    $("topState").classList.toggle("online", state.signedIn);
    setAvatar($("topAvatar"), state.accountSkin, (state.username || "?").slice(0, 1).toUpperCase());
    return;
  }
  $("topName").textContent = user.name;
  $("topState").textContent = state.signedIn ? `Playing as ${state.username}` : "Minecraft not connected";
  $("topState").classList.toggle("online", state.signedIn);
  rmAvatarInto($("topAvatar"), user);
  $("accountBtn").title = "Reminth account" + (state.signedIn ? ` - Minecraft: ${state.username}` : "");
}

function paintReminthAccount(r) {
  const user = (r && r.user) || null;
  state.rm.user = user;
  if (r && "accounts" in r) {
    state.rm.accounts = Boolean(r.accounts);
    state.rm.providers = r.providers || [];
    state.rm.checked = true;
  }
  if (user) state.rm.checked = true;
  rmAvatarInto($("rmAvatar"), user);
  $("rmName").textContent = user ? user.name : "Reminth account";
  $("rmSignInBtn").hidden = Boolean(user) || !state.rm.accounts;
  $("rmSignOutBtn").hidden = !user;
  $("rmManageBtn").hidden = !user;
  const via = user && (user.providers || [user.provider]).filter(Boolean).map((p) => RM_NAMES[p] || p).join(" + ");
  if (user) $("rmState").textContent = (via ? `Signed in with ${via}` : "Signed in") + (r && r.offline ? " - offline right now" : "");
  else if (!state.rm.accounts) $("rmState").textContent = r && r.offline ? "Can't reach Reminth right now" : "Reminth accounts are coming soon";
  else $("rmState").textContent = "One account for the launcher and the website.";
  // the gate's buttons follow what the server has switched on
  $("rmGateDiscord").hidden = !state.rm.providers.includes("discord");
  $("rmGateGoogle").hidden = !state.rm.providers.includes("google");
  $("rmGateEmail").hidden = !state.rm.providers.includes("email");
  applyAccountUI();
}

async function loadReminthAccount(fresh) {
  try {
    const r = await window.reminth.reminthAccount.get({ fresh });
    const st = await window.reminth.reminthAccount.status();
    // offline with a kept account: keep it; offline without one: no gate
    paintReminthAccount({ ...st, user: r.user || null, offline: r.offline || st.offline, ...(r.user && st.offline ? { accounts: true } : {}) });
  } catch {
    paintReminthAccount({ user: null, accounts: false, providers: [], offline: true });
  }
}

/** The step-1 card shows one of: the ways to sign in, the email panel, or "finish in your browser". */
function rmGateView(view) {
  $("rmGateChoices").hidden = view !== "choices";
  $("rmEmailPanel").hidden = view !== "email";
  $("rmGateWait").hidden = view !== "wait";
}
function rmGateBusy(waiting) {
  rmGateView(waiting ? "wait" : "choices");
}
function rmGateMessage(text) {
  $("rmGateMsg").textContent = text || "";
  $("rmGateMsg").hidden = !text;
}
async function rmBrowserSignIn(provider) {
  rmGateMessage("");
  rmGateBusy(true);
  try {
    await window.reminth.reminthAccount.signIn(provider);
  } catch {
    rmGateBusy(false);
    rmGateMessage("Couldn't open your browser.");
  }
}
$("rmGateDiscord").onclick = () => rmBrowserSignIn("discord");
$("rmGateGoogle").onclick = () => rmBrowserSignIn("google");
$("rmGateCancel").onclick = () => rmGateBusy(false);
$("rmGateEmail").onclick = () => {
  rmGateMessage("");
  rmGateView("email");
  $(rmMode === "signup" ? "rmFName" : "rmFEmail").focus();
};
$("rmEmailBack").onclick = () => {
  rmGateMessage("");
  rmGateView("choices");
};
$("rmGatePrivacy").onclick = (e) => {
  e.preventDefault();
  window.reminth.openLink("https://reminth.pages.dev/privacy.html").catch(() => {});
};
let rmMode = "signup";
document.querySelectorAll(".rm-tabs button").forEach((b) => {
  b.onclick = () => {
    rmMode = b.dataset.rmmode;
    document.querySelectorAll(".rm-tabs button").forEach((x) => x.classList.toggle("on", x === b));
    $("rmFName").hidden = rmMode !== "signup";
    $("rmFPass").autocomplete = rmMode === "signup" ? "new-password" : "current-password";
    $("rmEmailBtn").textContent = rmMode === "signup" ? "Create account" : "Sign in";
    rmGateMessage("");
  };
});
$("rmEmailForm").onsubmit = async (e) => {
  e.preventDefault();
  const btn = $("rmEmailBtn");
  btn.disabled = true;
  rmGateMessage("");
  try {
    const r = await window.reminth.reminthAccount.email({ mode: rmMode, name: $("rmFName").value, email: $("rmFEmail").value, password: $("rmFPass").value });
    if (r && r.user) {
      $("rmFPass").value = "";
      paintReminthAccount({ user: r.user });
      toast(rmMode === "signup" ? `Welcome to Reminth, ${r.user.name}!` : `Signed in to Reminth as ${r.user.name}.`);
    } else {
      rmGateMessage((r && r.message) || "That didn't work. Try again.");
    }
  } catch {
    rmGateMessage("That didn't work. Try again.");
  } finally {
    btn.disabled = false;
  }
};

$("rmSignInBtn").onclick = () => {
  rmGateBusy(false);
  switchPage("home");
};
$("rmSignOutBtn").onclick = async () => {
  const r = await window.reminth.reminthAccount.signOut().catch(() => ({ user: null }));
  paintReminthAccount(r);
  toast("Signed out of your Reminth account.");
  if (rmGateNeeded()) switchPage("home");
};
$("rmManageBtn").onclick = () => window.reminth.reminthAccount.openWebsite().catch(() => {});
window.reminth.reminthAccount.onChanged((r) => {
  rmGateBusy(false);
  if (r && r.user) {
    paintReminthAccount(r);
    toast(`Signed in to Reminth as ${r.user.name}.`);
  } else {
    const why = (r && r.message) || "That sign-in didn't work. Try again.";
    rmGateMessage(why);
    toast(why);
    loadReminthAccount();
  }
});
loadReminthAccount();

let signInSeq = 0;
let signInCode = null; // { userCode, verificationUri } of the sign-in waiting right now
async function doSignIn(btn, restart) {
  const mine = ++signInSeq;
  // Stays pressable while it waits: pressing it again gets a new code (a closed tab or an expired code
  // used to leave the button dead until Microsoft's 15 minutes were up).
  const paintWaiting = (waiting) => {
    for (const b of [$("signInBtn"), $("settingsAuthBtn")]) {
      b.textContent = waiting ? "Get a new code" : b === $("signInBtn") ? "Sign in with Microsoft" : "Sign in";
    }
  };
  try {
    paintWaiting(true);
    const { username } = await window.reminth.signIn(restart);
    if (mine !== signInSeq) return;
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
    if (mine !== signInSeq) return; // a newer press owns the card now
    $("codePanel").hidden = true;
    const why = friendlyError(err.message);
    appendLog("Sign-in failed: " + why, true, "Out");
    toast(`Sign-in didn't finish: ${why}`);
  } finally {
    if (mine === signInSeq) paintWaiting(false);
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

$("signInBtn").onclick = () => doSignIn($("signInBtn"), true);
$("accountBtn").onclick = () => (rmGateNeeded() ? switchPage("home") : switchPage("settings"));
$("settingsAuthBtn").onclick = () => (state.signedIn ? doSignOut() : doSignIn($("settingsAuthBtn"), true));

window.reminth.onAccountRestored(({ username }) => {
  state.signedIn = true;
  state.username = username;
  applyAccountUI();
  loadRecent();
});
window.reminth.onAuthCode(({ userCode, verificationUri }) => {
  signInCode = { userCode, verificationUri };
  $("codePanel").hidden = false;
  $("userCode").textContent = userCode;
  $("codeHint").textContent = "The Microsoft page opens in your browser. Enter this code there.";
});
$("codeOpenBtn").onclick = () => {
  if (signInCode) window.reminth.openLink(signInCode.verificationUri).catch(() => toast("Couldn't open your browser. Go to microsoft.com/link and enter the code."));
};
$("codeCopyBtn").onclick = async () => {
  if (!signInCode) return;
  try {
    await navigator.clipboard.writeText(signInCode.userCode);
    toast("Code copied.");
  } catch {
    toast("Couldn't copy it. Select the code and press Ctrl+C.");
  }
};
window.reminth.onAuthWaiting(() => {
  $("codeHint").textContent = "Waiting for you to finish signing in…";
});

/* ================================================================== *
 * instances                                                           *
 * ================================================================== */
const activeInstance = () => state.instances.find((i) => i.id === state.activeId) || state.instances[0] || null;
/**
 * The instance the Home hero is about: the one played last (pure.js), not
 * whatever was last clicked in the rail - looking at another instance's
 * mods doesn't change Home.
 */
const heroInstance = () => window.ReminthPure.heroInstance(state.instances, state.activeId);
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
  paintGameRunning();
  if (!instanceById(state.activeId)) state.activeId = state.instances[0] ? state.instances[0].id : "reminth";
  renderRail();
  renderHero();
  paintActiveProgress();
  $("sideInstances").textContent = String(state.instances.length || 1);
  if (currentPage === "instance") renderInstancePage();
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
    btn.onclick = () => {
      // The click that ends a drag isn't a click on the instance.
      if (railDrag.justDropped) return;
      selectInstance(inst.id, true);
    };
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openInstanceMenu(inst.id, { x: e.clientX, y: e.clientY, opener: btn });
    });
    btn.addEventListener("keydown", (e) => {
      if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
        e.preventDefault();
        openInstanceMenu(inst.id, { anchor: btn, opener: btn });
      }
    });
    btn.addEventListener("pointerdown", (e) => railDragStart(e, inst.id, btn));
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
  const inst = heroInstance();
  if (!inst) {
    // The instance list couldn't be read: say so instead of "set up and ready".
    $("heroLoader").textContent = "—";
    $("heroLoader").className = "tag dim";
    $("heroVersion").textContent = "—";
    $("heroInstance").textContent = "—";
    $("heroLede").textContent = state.instancesError
      ? "Reminth couldn't read your instances. Restart Reminth — your worlds and mods are not touched."
      : "No instance yet. Make one with the + on the left.";
    for (const id of ["playBtn", "instPlayBtn", "heroInstanceBtn"]) $(id).disabled = true;
    return;
  }
  $("heroInstanceBtn").disabled = false;
  $("heroLoader").textContent = loaderLabel(inst);
  $("heroLoader").className = loaderTag(inst);
  $("heroVersion").textContent = "Minecraft " + inst.mcVersion;
  $("heroInstance").textContent = inst.name;
  $("heroLede").textContent = inst.modpack
    ? `${inst.modpack.title} is installed and ready. One click and you're in.`
    : `Your ${loaderLabel(inst)} ${inst.mcVersion} instance is set up and ready. One click and you're in.`;
  paintHeroStats();
  paintPlayButtons();
}

/**
 * The hero's Time played is the player's whole time through Reminth (every
 * instance, deleted ones too - main.js keeps the counter); Last played is
 * about the hero instance, like the rest of the hero.
 */
function paintHeroStats() {
  const inst = heroInstance();
  const total = window.ReminthPure.homePlayTime(state.settings, state.instances);
  $("heroPlaytime").textContent = total ? formatPlaytime(msToTicks(total)) : "—";
  $("heroPlaytime").title = "All your time in Minecraft through Reminth, across every instance - including ones you deleted.";
  $("heroLast").textContent = inst && inst.lastPlayed ? formatWhen(inst.lastPlayed) : "Never";
}

/**
 * Play buttons double as a progress pill while their instance installs.
 * Home's pair is about the hero's instance (the last played), the instance
 * page's pair about the one open there.
 */
function paintPlayButtons() {
  for (const [playId, stopId, inst] of [
    ["playBtn", "stopBtn", heroInstance()],
    ["instPlayBtn", "instStopBtn", activeInstance()],
  ]) {
    if (!inst) continue;
    const busy = state.installing.has(inst.id);
    const stopping = state.stopping.has(inst.id);
    const runningNow = state.running.has(inst.id) || stopping;
    const p = state.progress.get(inst.id);
    const btn = $(playId);
    if (btn) {
      btn.disabled = busy || runningNow;
      const label = btn.querySelector("span");
      btn.classList.toggle("progressing", busy);
      btn.style.setProperty("--p", busy && p && p.pct !== null ? p.pct + "%" : "0%");
      label.textContent = runningNow ? "Playing" : busy ? (p ? `${p.short}${p.pct !== null ? " " + p.pct + "%" : "…"}` : "Starting…") : "Play";
    }
    // Only shows up once something is actually (or stuck) "running" - lets a
    // player unstick the Play button themselves instead of relaunching
    // Reminth every time a crash or an odd exit leaves it wedged on "Playing".
    const stop = $(stopId);
    if (stop) {
      stop.hidden = !runningNow;
      // Stays in place, busy, until the backend says the game is gone - so
      // nothing else slides under the cursor of someone who double-clicked it.
      stop.disabled = stopping;
      stop.querySelector("span").textContent = stopping ? "Stopping…" : "Stop";
    }
  }
  // The Play buttons on Home's "Jump back in" cards.
  paintRecentPlayButtons();
  // "Update mods to fit…" hides while the game runs or installs (features.js).
  if (typeof paintSyncButtons === "function") paintSyncButtons();
  // A running game's mods are locked on screen; this unlocks them on exit.
  if (typeof paintModLock === "function") paintModLock();
  // "Restart and update" waits for the game to close.
  paintUpdate();
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
  { key: "vanilla", label: "Vanilla", note: "Plain Minecraft, just like the original game. No mods (resource packs and data packs still work)." },
  { key: "fabric", label: "Fabric", note: "The best choice for most people who want mods. Fast, and it has the popular FPS mods (Sodium, Lithium). Not sure? Pick this." },
  { key: "quilt", label: "Quilt", note: "A cousin of Fabric. Runs Quilt mods and almost every Fabric mod. Only pick it if a mod asks for it." },
  { key: "forge", label: "Forge", note: "The oldest mod loader, with a huge mod library - especially for 1.12.2 and 1.20.1. Pick it if your mods say \"Forge\"." },
  { key: "neoforge", label: "NeoForge", note: "Forge's newer version - where most big mods moved from 1.20.2 on. Pick it if your mods say \"NeoForge\"." },
];

// Shown until window.reminth.perfProfiles() answers (and if it can't).
const PERF_PROFILES_FALLBACK = [
  { id: "balanced", title: "Balanced", description: ["Reminth's performance pack and Java settings, with Minecraft's own video settings.", "Nothing about how the game looks or plays is changed."] },
  { id: "max-fps", title: "Max FPS", description: ["Lower view and simulation distance, fewer particles, V-Sync off for a brand-new instance.", "Applied to new instances only; for one you already play, use \"Boost FPS…\" in its menu."] },
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
  let dialog = null; // the open dialog (its Create button says "Continue" for Fabric/Quilt)
  const editing = Boolean(existing);
  const pick = {
    name: existing ? existing.name : "",
    loader: existing ? existing.loader : "fabric",
    version: existing ? existing.mcVersion : null,
    build: existing ? existing.loaderVersion : null,
    hud: existing ? Boolean(existing.hud) : true,
    // The Reminth home screen: on unless switched off (a missing value is on).
    home: existing ? existing.homeScreen !== false : true,
    homeTouched: false,
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
  loaderField.appendChild(el("label", null, "Mods: pick a loader"));
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
      paintHome();
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
  const buildLabel = el("label", null, "Loader version (leave on the newest)");
  buildField.appendChild(buildLabel);
  const buildDd = el("div", "sort-dd build-dd");
  buildField.appendChild(buildDd);
  extras.appendChild(buildField);
  const hudField = el("div", "field hud-field");
  hudField.appendChild(el("label", null, "ReminthHUD"));
  const hudRow = el("div", "toggle-row compact");
  const hudText = el("div");
  const hudTitle = el("b", null, "FPS, graphics card, processor and ping in game");
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
  // The Reminth home screen (the game's own title screen), next to the HUD.
  const homeField = el("div", "field hud-field home-field");
  homeField.appendChild(el("label", null, "Reminth home screen"));
  const homeRow = el("div", "toggle-row compact");
  const homeText = el("div");
  const homeTitle = el("b", null, "Reminth's title screen in game");
  const homeSub = el("span", null, "");
  homeText.appendChild(homeTitle);
  homeText.appendChild(homeSub);
  const homeSwitch = el("button", "switch");
  homeSwitch.type = "button";
  homeSwitch.setAttribute("role", "switch");
  homeSwitch.setAttribute("aria-label", "Reminth home screen");
  homeRow.appendChild(homeText);
  homeRow.appendChild(homeSwitch);
  homeField.appendChild(homeRow);
  extras.appendChild(homeField);
  // The performance pack: per loader, with the mods it has (state.info).
  const perfField = el("div", "field hud-field perf-field");
  perfField.appendChild(el("label", null, "Performance pack"));
  const perfRow = el("div", "toggle-row compact");
  const perfText = el("div");
  const perfTitle = el("b");
  const perfSub = el("span", null, "Stable builds only. Reminth leaves a mod out when you have your own copy or one that conflicts.");
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
  // New Fabric/Quilt instances ask "what will you play?" next, so the button says Continue there.
  function paintCreateLabel() {
    if (editing || !dialog) return;
    const label = dialog.buttons[1] && dialog.buttons[1].querySelector("span");
    if (label) label.textContent = pick.loader === "fabric" || pick.loader === "quilt" ? "Continue" : "Create instance";
  }
  function paintLoader() {
    paintCreateLabel();
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
        paintHome();
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
      ? "A small bar at the top right. H shows or hides it in game. (The Reminth panel, G, is always there.)"
      : `No ReminthHUD build for ${pick.version} yet — it's built per version.`;
  }
  hudSwitch.onclick = () => {
    if (hudSwitch.disabled) return;
    pick.hud = !pick.hud;
    paintHud();
  };

  let homeToken = 0;
  async function paintHome() {
    const token = ++homeToken;
    // Not a choice any more: Reminth's title screen is always installed on Fabric and Quilt instances.
    homeField.hidden = true;
    return;
    // eslint-disable-next-line no-unreachable
    const eligible = pick.loader === "fabric" || pick.loader === "quilt";
    let available = false;
    if (pick.version) {
      try {
        available = await window.reminth.bundledSupports("reminthhome", pick.version);
      } catch {
        available = false;
      }
    }
    if (token !== homeToken) return;
    homeSwitch.disabled = !available;
    homeRow.classList.toggle("disabled", !available);
    const on = available && pick.home;
    homeSwitch.classList.toggle("on", on);
    homeSwitch.setAttribute("aria-checked", on ? "true" : "false");
    homeSub.textContent = !pick.version
      ? "Pick a version to see if there's a home screen build for it."
      : available
      ? "Reminth installs it and keeps it updated."
      : `No Reminth home screen build for ${pick.version} yet — it's built per version.`;
  }
  homeSwitch.onclick = () => {
    if (homeSwitch.disabled) return;
    pick.home = !pick.home;
    pick.homeTouched = true;
    paintHome();
  };

  nameInput.addEventListener("input", () => (nameInput.dataset.auto = "0"));
  searchInput.addEventListener("input", () => {
    pick.query = searchInput.value;
    paintList();
  });
  paintLoader();
  paintBuilds();
  paintHud();
  paintHome();
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
  dialog = openModal({
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
          // The home screen: only what the player set with the switch. With no
          // build for this version the switch can't be used, and the stored
          // choice (a missing value = on) is left as it is.
          const home = (pick.loader === "fabric" || pick.loader === "quilt") && pick.homeTouched && !homeSwitch.disabled ? { homeScreen: pick.home } : {};
          // A new Fabric/Quilt instance: the playstyle cards next. This dialog steps out of the way meanwhile and
          // comes back if the cards are closed with the X (nothing is created then); Skip makes a plain instance.
          let playstyle = null;
          if (!editing && (pick.loader === "fabric" || pick.loader === "quilt") && typeof choosePlaystyle === "function") {
            dialog.modal.style.display = "none";
            playstyle = await choosePlaystyle({ instanceName: name });
            if (!playstyle) {
              dialog.modal.style.display = "";
              return false;
            }
          }
          saving = true;
          handle.buttons[0].disabled = true;
          try {
            if (editing) {
              await window.reminth.updateInstance(existing.id, { name, mcVersion: pick.version, loader: pick.loader, loaderVersion: pick.build, hud, ...home, ...perf, ...profile });
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
              const inst = await window.reminth.createInstance({ name, mcVersion: pick.version, loader: pick.loader, loaderVersion: pick.build, hud, ...home, ...perf, ...profile });
              await loadInstances();
              await selectInstance(inst.id, true);
              toast(`${inst.name} created. Press Play and it downloads what it needs.`);
              // The mod list for the playstyle picked before (None: nothing), then the profile's own suggestions.
              if (playstyle && playstyle.action === "finish" && typeof openPurposeSetup === "function") {
                openPurposeSetup(inst.id, playstyle.goals).then(() => {
                  if (typeof offerProfileExtras === "function") offerProfileExtras(inst.id, pick.profile, pick.loader);
                });
              } else if (typeof offerProfileExtras === "function") offerProfileExtras(inst.id, pick.profile, pick.loader);
            }
            return true;
          } catch (err) {
            toast(friendlyError(err.message));
            return false;
          } finally {
            saving = false;
            handle.buttons[0].disabled = false;
            if (dialog) dialog.modal.style.display = ""; // back if the create failed (closed anyway when it worked)
          }
        },
      },
    ],
  });
  paintCreateLabel();
}

$("railAdd").onclick = () => openInstanceModal(null);
$("instMoreBtn").onclick = (e) => {
  e.stopPropagation();
  const inst = activeInstance();
  if (inst) openInstanceMenu(inst.id, { anchor: $("instMoreBtn"), opener: $("instMoreBtn") });
};
$("instEditBtn").onclick = () => {
  const inst = activeInstance();
  if (inst) openInstanceModal(inst);
};
/* ================================================================== *
 * the instance menu: right-click (or the Menu key / Shift+F10) on a   *
 * rail button or a Library card, and the instance page's ⋮ button -   *
 * one menu, one implementation. Plus moving instances around.         *
 * ================================================================== */
let instMenu = null; // { box, opener, close }

function closeInstanceMenu(refocus) {
  if (!instMenu) return;
  const { box, opener, cleanup } = instMenu;
  instMenu = null;
  cleanup();
  box.remove();
  if (refocus && opener && opener.isConnected) opener.focus();
}

/**
 * at: { x, y } (the pointer) or { anchor: element }; opener gets the focus
 * back on Esc. Never runs off the window; keyboard: arrows, Home/End, Enter, Esc.
 */
function openInstanceMenu(id, at = {}) {
  closeInstanceMenu(false);
  const inst = instanceById(id);
  if (!inst) return;
  const index = state.instances.findIndex((i) => i.id === id);
  const items = window.ReminthPure.instanceMenuItems(inst, {
    running: state.running.has(id) || state.stopping.has(id),
    busy: state.installing.has(id),
    isMain: id === "reminth",
    index,
    count: state.instances.length,
  });
  const icons = { play: "#i-play", open: "#i-cube", rename: "#i-edit", folder: "#i-folder", verify: "#i-refresh", boost: "#i-bolt", setup: "#i-sliders", up: "#i-chevron", down: "#i-chevron", top: "#i-chevron", bottom: "#i-chevron", delete: "#i-trash" };
  const box = el("div", "dd-menu inst-menu");
  box.setAttribute("role", "menu");
  box.setAttribute("aria-label", `${inst.name}: menu`);
  box.appendChild(el("div", "inst-menu-title", inst.name));
  const buttons = [];
  for (const item of items) {
    if (item.separator) box.appendChild(el("div", "inst-menu-sep"));
    const b = el("button", "dd-item" + (item.danger ? " danger" : "") + " im-" + item.id);
    b.type = "button";
    b.setAttribute("role", "menuitem");
    b.appendChild(icon(icons[item.id] || "#i-cube"));
    const text = el("span", "im-text");
    text.appendChild(el("span", null, item.label));
    // The main instance's Delete is shown, off, WITH the reason - hiding it confused people.
    if (item.disabled && item.why && item.id === "delete") text.appendChild(el("small", "im-why", item.why));
    b.appendChild(text);
    if (item.disabled) {
      b.disabled = true;
      b.setAttribute("aria-disabled", "true");
      if (item.why) b.title = item.why;
    }
    b.onclick = () => {
      closeInstanceMenu(false);
      runInstanceMenuItem(id, item.id);
    };
    box.appendChild(b);
    buttons.push(b);
  }
  document.body.appendChild(box);
  box.style.display = "flex";
  // Where: at the pointer, or under the button; then kept inside the window.
  const r = box.getBoundingClientRect();
  let x = at.x;
  let y = at.y;
  if (at.anchor) {
    const a = at.anchor.getBoundingClientRect();
    x = a.right + 6;
    y = a.top;
    if (x + r.width > window.innerWidth - 8) x = a.right - r.width; // no room on the right: under it, right-aligned
    if (x === a.right - r.width) y = a.bottom + 6;
  }
  x = Math.max(8, Math.min(Number(x) || 8, window.innerWidth - r.width - 8));
  y = Math.max(8, Math.min(Number(y) || 8, window.innerHeight - r.height - 8));
  box.style.left = x + "px";
  box.style.top = y + "px";

  const enabled = () => buttons.filter((b) => !b.disabled);
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeInstanceMenu(true);
      return;
    }
    if (e.key === "Tab") return closeInstanceMenu(false);
    const list = enabled();
    if (!list.length) return;
    const at_ = list.indexOf(document.activeElement);
    let next = null;
    if (e.key === "ArrowDown") next = list[(at_ + 1) % list.length];
    else if (e.key === "ArrowUp") next = list[(at_ - 1 + list.length) % list.length];
    else if (e.key === "Home") next = list[0];
    else if (e.key === "End") next = list[list.length - 1];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };
  const onOutside = (e) => {
    if (!box.contains(e.target)) closeInstanceMenu(false);
  };
  const onAway = () => closeInstanceMenu(false);
  document.addEventListener("keydown", onKey, true);
  // Not the very press that opened it.
  setTimeout(() => document.addEventListener("mousedown", onOutside, true), 0);
  window.addEventListener("blur", onAway);
  window.addEventListener("resize", onAway);
  document.addEventListener("scroll", onAway, true);
  instMenu = {
    box,
    opener: at.opener || null,
    cleanup: () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onOutside, true);
      window.removeEventListener("blur", onAway);
      window.removeEventListener("resize", onAway);
      document.removeEventListener("scroll", onAway, true);
    },
  };
  const first = enabled()[0];
  if (first) first.focus({ preventScroll: true });
}

async function runInstanceMenuItem(id, what) {
  const inst = instanceById(id);
  if (!inst) return;
  if (what === "play") return runPlay({ instanceId: id });
  if (what === "open") return selectInstance(id, true);
  if (what === "rename") return renameInstanceFlow(id);
  if (what === "folder") return openFolder("game", id);
  if (what === "boost") return boostFpsFlow(id);
  if (what === "setup") return typeof openPurposeSetup === "function" ? openPurposeSetup(id) : undefined;
  if (what === "verify") {
    await selectInstance(id, false);
    switchPage("home");
    return runInstall();
  }
  if (["up", "down", "top", "bottom"].includes(what)) return moveInstance(id, what);
  if (what === "delete") return deleteInstanceFlow(id);
}

/**
 * Boost FPS…: shows exactly which video settings change (from -> to), and
 * changes them only on "Change them". The old values are kept, so the same
 * dialog offers "Put my old settings back" afterwards. Never while the game
 * runs - it rewrites options.txt when it closes.
 */
async function boostFpsFlow(id) {
  const inst = instanceById(id);
  if (!inst) return;
  if (state.running.has(id)) return toast("Close the game first.");
  let plan;
  try {
    plan = await window.reminth.perfBoostPlan(id);
  } catch (err) {
    return toast(friendlyError(err.message));
  }
  const changes = (plan && Array.isArray(plan.changes) && plan.changes) || [];
  const canUndo = Boolean(plan && plan.canUndo);
  const body = el("div", "boost-body");
  if (changes.length) {
    body.appendChild(el("p", null, `These video settings of ${inst.name} change to the ones that gave the biggest FPS gain in our tests:`));
    const list = el("ul", "boost-list");
    for (const c of changes) {
      const li = el("li");
      li.appendChild(el("b", null, c.label));
      li.appendChild(el("span", "boost-from", c.fromText));
      li.appendChild(icon("#i-chevron", "i boost-arrow"));
      li.appendChild(el("span", "boost-to", c.toText));
      list.appendChild(li);
    }
    body.appendChild(list);
    body.appendChild(el("p", "set-note", "Nothing else in your settings is touched. Your current values are saved - this menu can put them back any time."));
  } else if (plan && plan.reason === "not-installed") {
    body.appendChild(el("p", null, "Play this instance once first - Reminth needs the game's files to know which settings it has."));
  } else if (plan && plan.reason === "no-options") {
    body.appendChild(el("p", null, "This instance hasn't saved any video settings yet. Play it once, then come back."));
  } else if (plan && plan.reason === "error") {
    body.appendChild(el("p", null, "Reminth couldn't read this instance's video settings. Close the game if it's running and try again."));
  } else {
    body.appendChild(el("p", null, `${inst.name} already has the fast settings.`));
  }
  const buttons = [{ label: changes.length ? "Cancel" : "Close", className: "outline" }];
  let busy = false;
  const act = async (call, done) => {
    if (busy) return false;
    if (state.running.has(id)) {
      toast("Close the game first.");
      return false;
    }
    busy = true;
    try {
      const r = await call(id);
      toast(done(r || {}));
      return true;
    } catch (err) {
      toast(friendlyError(err.message));
      return false;
    } finally {
      busy = false;
    }
  };
  if (canUndo) {
    buttons.push({
      label: "Put my old settings back",
      className: "outline",
      icon: "#i-rotate",
      onClick: () => act(window.reminth.perfBoostUndo, (r) => (r.restored ? `${inst.name}: your old video settings are back.` : `${inst.name}: nothing to put back - you had changed those settings since.`)),
    });
  }
  if (changes.length) {
    buttons.push({
      label: "Change them",
      className: "primary",
      icon: "#i-bolt",
      onClick: () => act(window.reminth.perfBoostApply, (r) => (r.changed ? `${inst.name}: faster settings saved. They apply the next time you play.` : `${inst.name} already has the fast settings.`)),
    });
  }
  openModal({ title: `Boost FPS — ${inst.name}`, body, buttons });
}

/** Rename…: one name field, the normal instances:update path, never while the game runs. */
function renameInstanceFlow(id) {
  const inst = instanceById(id);
  if (!inst) return;
  if (state.running.has(id)) return toast("Close the game first.");
  const body = el("div", "field");
  body.appendChild(el("label", null, "Name"));
  const input = el("input");
  input.type = "text";
  input.maxLength = 48;
  input.value = inst.name;
  body.appendChild(input);
  let saving = false;
  const save = async (handle) => {
    if (saving) return false;
    const name = input.value.trim();
    if (!name) {
      input.focus();
      return false;
    }
    if (name === inst.name) return true;
    if (state.running.has(id)) {
      toast("Close the game first.");
      return false;
    }
    saving = true;
    try {
      await window.reminth.updateInstance(id, { name });
      await loadInstances();
      toast(`Renamed to ${name}.`);
      return true;
    } catch (err) {
      toast(friendlyError(err.message));
      return false;
    } finally {
      saving = false;
      if (handle && handle.buttons[1]) handle.buttons[1].disabled = false;
    }
  };
  const handle = openModal({
    title: `Rename ${inst.name}`,
    body,
    canClose: () => !saving,
    buttons: [
      { label: "Cancel", className: "outline" },
      { label: "Save", className: "primary", onClick: (h) => save(h) },
    ],
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handle.buttons[1].click();
    }
  });
  setTimeout(() => {
    input.focus();
    input.select();
  }, 0);
}

/**
 * Delete…: says WHAT goes (worlds, size - counted in the main process) and
 * that the other instances aren't touched. Then a sensible instance is
 * selected and every list redrawn.
 */
function deleteInstanceFlow(id) {
  const inst = instanceById(id);
  if (!inst) return;
  if (id === "reminth") return toast("This is your main instance - it can't be deleted.");
  if (state.running.has(id)) return toast("Close the game first.");
  const body = el("div");
  const what = el("p", "del-what", `${inst.name} - counting what's in it…`);
  body.appendChild(what);
  body.appendChild(el("p", null, "Everything inside it is deleted for good (worlds, mods, screenshots). There's no undo. Your other instances are not touched."));
  body.appendChild(el("p", "set-note", "Your saved logs stay in Reminth's archive."));
  let deleting = false;
  const handle = openModal({
    title: `Delete ${inst.name}?`,
    body,
    focusCancel: true,
    canClose: () => !deleting,
    buttons: [
      { label: "Cancel", className: "outline" },
      {
        label: "Delete forever",
        className: "primary danger-fill",
        onClick: async (h) => {
          if (deleting) return false;
          deleting = true;
          h.buttons[0].disabled = true;
          try {
            await window.reminth.deleteInstance(id);
            const wasActive = state.activeId === id;
            await loadInstances();
            // The hero (last played) is the sensible one to land on.
            if (wasActive || !instanceById(state.activeId)) {
              const next = heroInstance();
              if (next) await selectInstance(next.id, false);
              if (currentPage === "instance") switchPage("home");
            }
            if (currentPage === "home") loadRecent();
            toast(`${inst.name} deleted.`);
            return true;
          } catch (err) {
            toast(friendlyError(err.message));
            return false;
          } finally {
            deleting = false;
            h.buttons[0].disabled = false;
          }
        },
      },
    ],
  });
  window.reminth
    .instanceSummary(id)
    .then((sum) => {
      if (!handle.closed) what.textContent = `${inst.name} - ${window.ReminthPure.summaryText(sum)}.`;
    })
    .catch(() => {
      if (!handle.closed) what.textContent = `${inst.name}.`;
    });
}

/** Saves a new order (all ids): shown at once, put back if main.js refuses it. */
async function saveInstanceOrder(ids) {
  const byId = new Map(state.instances.map((i) => [i.id, i]));
  const before = state.instances;
  state.instances = ids.map((x) => byId.get(x)).filter(Boolean);
  renderRail();
  try {
    await window.reminth.reorderInstances(ids);
  } catch (err) {
    state.instances = before;
    renderRail();
    toast(friendlyError(err.message));
  }
}

function moveInstance(id, how) {
  const ids = state.instances.map((i) => i.id);
  const from = ids.indexOf(id);
  if (from < 0) return;
  const to = window.ReminthPure.moveIndex(from, ids.length, how);
  if (to === from) return;
  saveInstanceOrder(window.ReminthPure.moveItem(ids, from, to));
}

/* ---- drag and drop in the rail: a thin line shows where it lands ---- */
const railDrag = { id: null, btn: null, startY: 0, active: false, gap: -1, line: null, scrollTimer: null, justDropped: false };

function railDragStart(e, id, btn) {
  if (e.button !== 0 || state.instances.length < 2) return;
  railDrag.id = id;
  railDrag.btn = btn;
  railDrag.startY = e.clientY;
  railDrag.active = false;
  railDrag.gap = -1;
  window.addEventListener("pointermove", railDragMove);
  window.addEventListener("pointerup", railDragEnd);
  window.addEventListener("keydown", railDragKey, true);
}

function railDragGap(y) {
  const btns = [...$("railInstances").querySelectorAll(".instance-btn")];
  for (let i = 0; i < btns.length; i++) {
    const r = btns[i].getBoundingClientRect();
    if (y < r.top + r.height / 2) return i;
  }
  return btns.length;
}

function railDragMove(e) {
  if (!railDrag.id) return;
  if (!railDrag.active) {
    if (Math.abs(e.clientY - railDrag.startY) < 6) return;
    railDrag.active = true;
    hideTip();
    railDrag.btn.classList.add("dragging");
    railDrag.line = el("div", "rail-drop-line");
    $("railInstances").appendChild(railDrag.line);
  }
  const rail = $("railInstances");
  const box = rail.getBoundingClientRect();
  // Near the top or bottom edge of a long rail: it scrolls by itself.
  clearInterval(railDrag.scrollTimer);
  const edge = e.clientY < box.top + 24 ? -1 : e.clientY > box.bottom - 24 ? 1 : 0;
  if (edge) railDrag.scrollTimer = setInterval(() => (rail.scrollTop += edge * 8), 16);
  const inside = e.clientX >= box.left - 20 && e.clientX <= box.right + 20;
  railDrag.gap = inside ? railDragGap(e.clientY) : -1;
  const btns = [...rail.querySelectorAll(".instance-btn")];
  if (railDrag.gap < 0) {
    railDrag.line.hidden = true;
    return;
  }
  railDrag.line.hidden = false;
  const ref = btns[Math.min(railDrag.gap, btns.length - 1)].getBoundingClientRect();
  const y = railDrag.gap < btns.length ? ref.top - 3 : ref.bottom + 3;
  railDrag.line.style.top = y - box.top + rail.scrollTop + "px";
}

function railDragStop() {
  window.removeEventListener("pointermove", railDragMove);
  window.removeEventListener("pointerup", railDragEnd);
  window.removeEventListener("keydown", railDragKey, true);
  clearInterval(railDrag.scrollTimer);
  if (railDrag.btn) railDrag.btn.classList.remove("dragging");
  if (railDrag.line) railDrag.line.remove();
  const was = railDrag.active;
  railDrag.id = null;
  railDrag.btn = null;
  railDrag.line = null;
  railDrag.active = false;
  if (was) {
    // Swallow the click the browser sends after the drop.
    railDrag.justDropped = true;
    setTimeout(() => (railDrag.justDropped = false), 0);
  }
}

function railDragEnd() {
  const { id, gap, active } = railDrag;
  railDragStop();
  if (!active || gap < 0) return; // a plain click, or dropped outside the rail: nothing moves
  const ids = state.instances.map((i) => i.id);
  const from = ids.indexOf(id);
  const to = window.ReminthPure.dropGapToIndex(from, gap);
  if (from < 0 || to === from) return;
  saveInstanceOrder(window.ReminthPure.moveItem(ids, from, to));
}

function railDragKey(e) {
  if (e.key === "Escape" && railDrag.active) {
    e.preventDefault();
    e.stopPropagation();
    railDrag.gap = -1;
    railDragStop();
  }
}

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
  // Why Reminth made it by itself: "Made for Hypixel" (a server) or "Copy of Survival".
  $("instMadeFor").hidden = !inst.madeFor;
  $("instMadeFor").textContent = !inst.madeFor ? "" : /^Copy of /.test(inst.madeFor) ? inst.madeFor : `Made for ${inst.madeFor}`;
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
  // Mods a big server bans (DonutSMP, Hypixel, MCC Island), when this instance joins or lists that server.
  let rulesAccepted = [];
  if (inst.loader !== "vanilla" && typeof serverRulesBeforePlay === "function") {
    let go = true;
    try {
      const r = await serverRulesBeforePlay(inst, options.join ? String(options.join.host || options.join.address || "") || null : null);
      go = r !== false;
      if (r && Array.isArray(r.accepted)) rulesAccepted = r.accepted;
    } catch {
      go = true; // a courtesy, like the check above
    }
    if (!go) {
      state.installing.delete(inst.id);
      paintPlayButtons();
      return;
    }
  }
  // The Home bar shows this run (Home's hero becomes this instance as soon as it starts).
  const onHome = true;
  state.logError = false;
  // The stage de-dup is for one run: without this, a second run whose first
  // stage matches the last run's final one never gets its first log line.
  state.lastStage = null;
  if (onHome) {
    state.progressShown = inst.id;
    // Quiet start (owner, 8 Oct 2026: the strip that flashed up for a moment on Play "becomes ugly"): the bar and log
    // stay hidden; only a launch still busy after QUIET_START_MS (downloading a version, Java...) shows them. Errors
    // always show at once (appendLog).
    state.quietUntil = Date.now() + QUIET_START_MS;
    $("progressWrap").hidden = true;
    $("log").hidden = true;
    $("log").textContent = "";
    $("progressDismiss").hidden = true;
    clearTimeout(window._quietReveal);
    window._quietReveal = setTimeout(() => {
      state.quietUntil = 0;
      if (state.installing.has(inst.id) && state.progressShown === inst.id) {
        $("progressWrap").hidden = false;
        $("log").hidden = !$("log").textContent;
        paintProgress(inst.id);
      }
    }, QUIET_START_MS);
  }
  paintPlayButtons();
  try {
    const result = await window.reminth.play({
      instanceId: inst.id,
      join: options.join || null,
      ...(options.world ? { world: options.world } : {}),
      ...(rulesAccepted.length ? { serverRulesAccepted: rulesAccepted } : {}),
    });
    if (result && result.cancelled) {
      // The player backed out of something the backend asked: not a failure.
      if (onHome && !state.logError) {
        $("progressWrap").hidden = true;
        $("log").hidden = true;
      }
      return;
    }
    if (result && result.launched === false) throw new Error("The game didn't start.");
    if (options.world) {
      toast(
        result && result.worldJoin
          ? `Minecraft is starting — opening ${options.worldName || "your world"}…`
          : "Starts this instance - this Minecraft version can't open a world directly."
      );
    } else {
      toast(options.join ? (state.privacy ? "Minecraft is starting — joining the server…" : `Minecraft is starting — joining ${options.join.host}…`) : "Minecraft is starting…");
    }
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

/** How long a Play stays quiet before its progress bar shows (a normal launch is done by then). */
const QUIET_START_MS = 3000;

/** A Play started less than QUIET_START_MS ago: its bar and log stay hidden (errors still show). */
function quiet() {
  return state.quietUntil && Date.now() < state.quietUntil;
}

/** Puts the progress bars away a little after a run ends - both, since signing in or out mid-run moves it from one to the other. */
function scheduleHideProgress() {
  clearTimeout(window._hideProgress);
  window._hideProgress = setTimeout(() => {
    if (state.logError || state.installing.has(state.progressShown)) return;
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
const playClick = (which) => () => {
  if (Date.now() - state.stopClickAt < STOP_GRACE_MS) return;
  // Each button starts the instance it shows, fixed at the click.
  const inst = which();
  if (inst) runPlay({ instanceId: inst.id });
};
$("playBtn").onclick = playClick(heroInstance);
$("instPlayBtn").onclick = playClick(activeInstance);
$("heroInstanceBtn").onclick = () => {
  const inst = heroInstance();
  if (inst) selectInstance(inst.id, true);
};

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

async function stopGame(instanceId) {
  const inst = instanceId ? instanceById(instanceId) : activeInstance();
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
$("stopBtn").onclick = () => {
  const inst = heroInstance();
  if (inst) stopGame(inst.id);
};
$("instStopBtn").onclick = () => {
  const inst = activeInstance();
  if (inst) stopGame(inst.id);
};
$("repairBtn2").onclick = () => {
  switchPage("home");
  runInstall();
};

function appendLog(line, isError, suffix) {
  if (isError) state.logError = true;
  const node = $("log" + (suffix || ""));
  if (isError) state.quietUntil = 0;
  if (!quiet()) {
    $("progressWrap" + (suffix || "")).hidden = false;
    node.hidden = false;
  }
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
  // The bar shows the run that put it up, whichever instance is selected.
  if (instanceId !== state.progressShown) return;
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
  if (!quiet()) $("progressWrap" + suffix).hidden = false;
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
  // The bar belongs to the run that put it up (not to the rail selection):
  // repaint it if that run is still going.
  const id = state.progressShown;
  if (id && state.installing.has(id) && state.progress.has(id)) paintProgress(id);
}

window.reminth.onInstallDone(({ instanceId }) => {
  if (instanceId !== state.progressShown) return;
  const suffix = progressSuffix();
  $("progressStage" + suffix).textContent = "Ready";
  $("progressPct" + suffix).textContent = "100%";
  $("progressFill" + suffix).style.width = "100%";
  $("progressFill" + suffix).classList.remove("busy");
});

/**
 * While a game runs nothing in the launcher animates (styles.css,
 * body.game-running): a launcher window left visible next to a windowed
 * game, or on a second screen, must not take frames from the game.
 */
function paintGameRunning() {
  document.body.classList.toggle("game-running", state.running.size > 0);
}

window.reminth.onPlayStarted(({ instanceId, startedAt }) => {
  state.running.add(instanceId);
  paintGameRunning();
  // Home's hero moves to this instance now, not after the list is read
  // again (main.js has saved "last played" by the time this arrives).
  state.instances = window.ReminthPure.markPlayed(state.instances, instanceId, startedAt || Date.now());
  renderRail();
  renderHero();
  paintPlayButtons();
  if (currentPage === "instance") renderInstancePage();
  loadInstances();
});
// A game ended: the lifetime Time played on Home grew.
window.reminth.onTotalPlayTime(({ totalPlayTimeMs }) => {
  state.settings = { ...(state.settings || {}), totalPlayTimeMs };
  paintHeroStats();
});
window.reminth.onPlayExited(({ instanceId }) => {
  state.running.delete(instanceId);
  paintGameRunning();
  stopFinished(instanceId);
  loadInstances();
  loadRecent();
  loadStats();
});
window.reminth.onPlayCrashed(({ instanceId, code, signal, error, logPath }) => {
  state.running.delete(instanceId);
  paintGameRunning();
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
  // The text strip: the words on the left (they shrink and wrap), Play on the right.
  const body = el("div", "recent-body has-play");
  const text = el("div", "recent-text");
  text.appendChild(el("div", "recent-name", entry.name));
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
  bits.forEach(([words, cls]) => meta.appendChild(el("span", cls || null, words)));
  text.appendChild(meta);
  body.appendChild(text);
  body.appendChild(recentPlayButton(entry));
  card.appendChild(art);
  card.appendChild(body);
  return card;
}

/* ---- "Play" on a Jump back in card ---- */
const worldJoinSupport = new Map(); // "instanceId|mcVersion" -> true | false | null (not downloaded yet)

/** The instance a card plays: the one it was last played in, else the selected one. */
function recentTarget(entry) {
  return (entry.instanceId && instanceById(entry.instanceId)) || activeInstance();
}

function recentPlayButton(entry) {
  const b = button("btn primary sm recent-play", "Play", "#i-play");
  const inst = recentTarget(entry);
  if (inst) b.dataset.instance = inst.id;
  const name = inst ? inst.name : "this instance";
  if (entry.type === "server") {
    b.title = `Starts ${name} and joins this server`;
  } else {
    b.title = `Starts ${name} and opens this world`;
    // Whether this Minecraft version can open a world straight away comes
    // from its own version file (main.js) - asked once per instance.
    if (inst) {
      const key = `${inst.id}|${inst.mcVersion}`;
      const paint = (ok) => {
        if (ok === false) b.title = "Starts this instance - this Minecraft version can't open a world directly";
      };
      if (worldJoinSupport.has(key)) paint(worldJoinSupport.get(key));
      else
        window.reminth
          .worldJoinSupport(inst.id)
          .then((ok) => {
            worldJoinSupport.set(key, ok);
            paint(ok);
          })
          .catch(() => {});
    }
  }
  b.onclick = (e) => {
    e.stopPropagation();
    // Fixed at the click: the card's own instance, whatever is selected.
    const target = recentTarget(entry);
    if (!target || b.disabled) return;
    if (state.running.has(target.id) || state.installing.has(target.id)) return;
    if (entry.type === "server") {
      const join = window.ReminthPure.parseServerAddress(entry.address);
      if (!join) return toast("That server address can't be read.");
      runPlay({ instanceId: target.id, join: { host: join.host, port: join.port } });
    } else {
      runPlay({ instanceId: target.id, world: entry.folder, worldName: entry.name });
    }
  };
  return b;
}

/** Off while the card's instance is running or installing (runPlay is busy-proof too). */
function paintRecentPlayButtons() {
  document.querySelectorAll(".recent-play[data-instance]").forEach((b) => {
    const id = b.dataset.instance;
    b.disabled = state.running.has(id) || state.installing.has(id) || state.stopping.has(id);
  });
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

  paintHeroStats();

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

/* Not the window in front: no decorative animation (styles.css body.unfocused), no skin-viewer frames. */
function paintFocus() {
  document.body.classList.toggle("unfocused", !document.hasFocus());
}
window.addEventListener("focus", paintFocus);
window.addEventListener("blur", paintFocus);
document.addEventListener("visibilitychange", paintFocus);
paintFocus();

/* ================================================================== *
 * what's new                                                          *
 * ================================================================== */
// A hand-written list for this release; the version beside it comes from the app.
const CHANGELOG = [
  "Reminth accounts: Discord, Google or email - the same account on the website, shown at the top of the launcher.",
  "Pick your look: the whole launcher in blue (new default) or orange, the icon included - on the first screen or in Settings.",
  "Fixed: clicking Reminth on the taskbar could open a second taskbar button.",
  "The Reminth Mods Panel: press G in game for 140+ of Reminth's own features - FPS, keystrokes, armor, potion timers, zoom, hit marker, chat timestamps and more. On every version from 1.20.1 to 26.3.",
  "A pointer that never vanishes in full screen, a new title screen, and a heads-up when a server's rules ban one of your mods.",
  "Pick what an instance is for (PvP, survival and more) and get a matching set of mods and packs.",
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
  $("statPlaced").textContent = ok ? num(stats.totals && (stats.totals.placed != null ? stats.totals.placed : stats.totals.used)) : "—";
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
  cards.appendChild(bigStat("Time played", formatPlaytime(stats.playTimeTicks), `Across ${stats.worldCount || 0} world${stats.worldCount === 1 ? "" : "s"}${stats.serverCount ? ` and ${stats.serverCount} server${stats.serverCount === 1 ? "" : "s"}` : ""}`, "var(--amber)"));
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
  body.appendChild(
    el(
      "p",
      "set-note",
      stats.serverCount
        ? "Server numbers are what each server reports for you, saved by the Reminth HUD while you play on it (updated about every 90 seconds)."
        : "These numbers come from your own worlds. Servers keep your stats themselves: with the Reminth HUD on, Reminth asks the server for yours while you play and adds them here. Servers that don't keep normal Minecraft statistics can't be counted."
    )
  );
}
// While a game runs, the numbers on Home and on the statistics page follow it (the HUD asks the server every 30 seconds).
setInterval(() => {
  if (state.signedIn && state.running.size > 0 && !document.hidden) loadStats();
}, 20000);
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
$("toggleHardwareAccel").onclick = async () => {
  const on = !$("toggleHardwareAccel").classList.contains("on");
  if (!on) {
    const ok = await confirmModal(
      "Turn off hardware acceleration?",
      ["Reminth will be drawn by your processor instead of your graphics card, and it will feel slow and laggy when you scroll or change tabs.", "Only do this if the Reminth window is black or flickering. You can turn it back on here at any time."],
      "Turn it off",
      true
    );
    if (!ok) return;
  }
  setSwitch("toggleHardwareAccel", on);
  paintHwNote();
  const saved = await saveSetting({ hardwareAcceleration: on }, "Restart Reminth for that to take effect.");
  if (!saved) {
    setSwitch("toggleHardwareAccel", !on);
    paintHwNote();
  }
};
function paintHwNote() {
  const note = $("hwOffNote");
  if (note) note.hidden = $("toggleHardwareAccel").classList.contains("on");
}

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
    const previous = document.documentElement.dataset.accent || "ember";
    const accent = btn.dataset.accent;
    applyAccent(accent);
    // accentChosen: from now on this is the player's own pick, so the one-time move to the brand orange (store.js) leaves it alone.
    if (!(await saveSetting({ accent, accentChosen: true }))) applyAccent(previous);
  };
});
/** The whole launcher's look (Settings -> Theme): "ember" = orange, "frost" = blue. */
const THEME_ACCENT = { ember: "ember", frost: "cyan" };
function applyTheme(theme) {
  theme = theme === "frost" ? "frost" : "ember";
  document.documentElement.dataset.theme = theme;
  const css = $("themeCss");
  const href = theme === "frost" ? "styles-frost.css" : "styles.css";
  if (css && css.getAttribute("href") !== href) css.setAttribute("href", href);
  document.querySelectorAll('img[src*="reminth-mark"]').forEach((img) => {
    img.src = "../../assets/icons/source/" + (theme === "frost" ? "reminth-mark-frost.svg" : "reminth-mark.svg");
  });
  document.querySelectorAll(".theme-pick").forEach((b) => b.classList.toggle("selected", b.dataset.theme === theme));
}
window.applyTheme = applyTheme;
document.querySelectorAll(".theme-pick").forEach((btn) => {
  btn.onclick = async () => {
    const before = { theme: document.documentElement.dataset.theme || "ember", accent: document.documentElement.dataset.accent || "ember" };
    const theme = btn.dataset.theme;
    applyTheme(theme);
    applyAccent(THEME_ACCENT[theme]);
    // accentChosen: the theme's own accent must not be moved back to orange at the next start (store.js)
    if (!(await saveSetting({ theme, accent: THEME_ACCENT[theme], accentChosen: true }))) {
      applyTheme(before.theme);
      applyAccent(before.accent);
    }
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
    applyTheme(s.theme);
    applyAccent(s.accent || "ember");
    setSwitch("toggleLaunchMinimized", s.launchMinimized);
    setSwitch("toggleHardwareAccel", s.hardwareAcceleration !== false);
    paintHwNote();
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
let bootDone;
const booted = new Promise((resolve) => (bootDone = resolve));
document.addEventListener("DOMContentLoaded", () => boot().finally(bootDone));

// Loading screen: shown over the app for about 2-3 seconds while the app builds its heavy pages (the skin viewer and
// both skin grids) in the background, so the first click on a tab finds it ready. Never longer than 3 seconds,
// and never blocks the app if something fails. The bar moves every frame (it eases towards 90% while it waits and
// runs on to 100% when the pages are ready), so it never jumps.
(function loadingScreen() {
  const splash = document.getElementById("bootSplash");
  const fill = document.getElementById("bootFill");
  if (!splash || !fill) return;
  const MIN_MS = 1800;
  const MAX_MS = 3000;
  const start = performance.now();
  let readyAt = null; // when the pages were ready (and the bar's value then)
  let readyFrom = 0;
  let shown = 0;
  let finished = false;
  const frame = (now) => {
    const t = now - start;
    let target;
    if (readyAt === null) target = 0.9 * (1 - Math.exp(-t / 900));
    else target = readyFrom + (1 - readyFrom) * Math.min(1, (now - readyAt) / 350);
    shown = Math.max(shown, target); // never backwards
    fill.style.transform = `scaleX(${shown.toFixed(4)})`;
    if (readyAt !== null && now - readyAt >= 350) {
      if (finished) return;
      finished = true;
      // Whatever page the warm-up is on goes back before the splash fades.
      if (window.reminthPrewarmStop) window.reminthPrewarmStop();
      splash.classList.add("done");
      setTimeout(() => splash.remove(), 260);
      return;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // Signed in: every heavy page is shown once under the splash (features.js prewarmPages); otherwise only the
  // skin data is prepared.
  const ready = booted
    .then(() => (window.reminthPrewarmPages ? window.reminthPrewarmPages() : window.reminthWarm ? window.reminthWarm() : null))
    .catch(() => {});
  Promise.race([Promise.all([ready, wait(MIN_MS)]), wait(MAX_MS)]).then(() => {
    readyFrom = shown;
    readyAt = performance.now();
  });
})();

// A reminth:// link (the game's Skins button): only ever a page switch,
// after startup has read the instances (a link can be what started Reminth).
// Signed out, switchPage keeps Home, as for every other route.
window.reminth.onDeepLink(async (link) => {
  await booted;
  const target = window.ReminthPure.deepLinkTarget(link, state.instances.map((i) => i.id));
  if (!target) return;
  if (target.instance) selectInstance(target.instance, true);
  else switchPage(target.page);
});
