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
  logError: false,
  progress: new Map(), // instanceId -> { stage, pct, short }
  progressShown: null, // instance id whose run the progress bar is painting
  lastStage: null, // last stage written to the log, so each is logged once per run
  heroPick: null, // the instance picked under Home's PLAY (this run only; a game starting clears it)
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
    return "Sign-in almost worked, but Microsoft hasn't finished approving Spaceport's app yet. Nothing's wrong with your account — try again later.";
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
  const v = s.version ? `Spaceport Launcher ${s.version}` : "The update";
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
    idle: "Updates download by themselves and install when you restart Spaceport.",
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
  if (state.running.size) return toast("Close Minecraft first — the update needs Spaceport to restart.");
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
  home: ["Spaceport", "Your Minecraft, your way."],
  instance: ["Instance", "Its version, its mods, its worlds."],
  library: ["Library", "Your clips and screenshots."],
  discover: ["Discover", "Modpacks, mods, packs, shaders and servers."],
  skins: ["Appearance", "How you look in game."],
  hosting: ["Host a server", "Your own server, free, with your friends."],
  plus: ["Spaceport+", "Your own server, minus the landlord."],
  streamer: ["Streamer mode", "Hotkeys, replay buffer and privacy."],
  stats: ["Your record", "Everything you've done so far."],
  settings: ["Configuration", "Make Spaceport work the way you want."],
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
  const prevPage = currentPage;
  currentPage = page;
  // The Night look styles the shell per page (Home: the full night scene, a see-through top bar).
  document.body.dataset.page = page;
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
  // Home (the Night design) has its own What's new and Discord at the bottom; the Night look has no sidebar at all
  // (styles-night.css), the old looks keep it on the other pages.
  $("appSide").style.display = page === "discover" || page === "skins" || page === "home" ? "none" : "flex";
  $("topEyebrow").textContent = PAGE_META[page][0];
  $("topTitle").textContent = PAGE_META[page][1];
  $("pages").scrollTop = 0;
  playPageEnter(prevPage, page);
  if (page === "stats") loadStats();
  if (page === "instance") renderInstancePage();
  if (page === "home") {
    loadRecent();
    loadMyTiers();
    buildHomeServers();
    pingHomeServers();
    loadSponsor();
    paintMcStatIcons();
    paintHomeName();
    loadFriends();
  }
  // Announced before the page's own hook runs, so a hook that fails can't swallow it.
  document.dispatchEvent(new CustomEvent("reminth:page", { detail: page }));
  if (pageHooks[page]) pageHooks[page]();
}

/* ---- motion (owner, 15 Oct 2026: "no animation when switching tabs ... take ideas from lunar"; CSS in motion.css) ----
 * A page slides in from the side of the rail you moved towards, its parts one after another; the rail's marker glides
 * to the new tab; the top bar's page name slides in. Classes are taken off again afterwards, so a list that is drawn
 * again later doesn't replay the whole entrance. */
const PAGE_ORDER = ["home", "discover", "library", "skins", "hosting", "plus", "instance", "streamer", "stats", "settings"];
let enterTimer = null;
function playPageEnter(prevPage, page) {
  const node = $(page);
  placeRailInd();
  if (page === "home") $("pages").scrollTop = 0;
  if (!node || prevPage === page) return;
  const down = PAGE_ORDER.indexOf(page) >= PAGE_ORDER.indexOf(prevPage);
  for (const p of document.querySelectorAll(".page.enter-down, .page.enter-up, .page.entering")) p.classList.remove("enter-down", "enter-up", "entering");
  [...node.children].forEach((c, i) => c.style.setProperty("--i", Math.min(i, 8)));
  if (page === "home") {
    node.querySelectorAll(".nh-stats li, .nh-side > *").forEach((c) => c.style.setProperty("--i", Math.min([...c.parentNode.children].indexOf(c), 8)));
  }
  void node.offsetWidth; // start the animation again even when the class was just removed
  node.classList.add(down ? "enter-down" : "enter-up", "entering");
  const title = document.querySelector(".topbar-title");
  if (title) {
    title.classList.remove("swap");
    void title.offsetWidth;
    title.classList.add("swap");
  }
  clearTimeout(enterTimer);
  enterTimer = setTimeout(() => {
    node.classList.remove("enter-down", "enter-up", "entering");
    if (title) title.classList.remove("swap");
  }, 1100); // the 12th server card ends at ~965ms (motion.css)
}

/** The rail's white marker, next to the lit tab (hidden when the page has no tab on the rail, like Statistics). */
function placeRailInd() {
  const rail = document.querySelector(".rail");
  if (!rail) return;
  let ind = $("railInd");
  if (!ind) {
    ind = el("div");
    ind.id = "railInd";
    rail.appendChild(ind);
  }
  const btn = rail.querySelector(".rail-btn.active");
  if (!btn || !btn.offsetParent) {
    if (ind.classList.contains("on")) ind.classList.remove("on");
    return;
  }
  const r = btn.getBoundingClientRect();
  const top = r.top - rail.getBoundingClientRect().top + rail.scrollTop + r.height / 2 - 11;
  const move = `translateY(${Math.round(top)}px)`;
  if (ind.style.transform !== move) ind.style.transform = move;
  if (!ind.classList.contains("on")) ind.classList.add("on");
}
window.addEventListener("resize", () => placeRailInd());
// instance buttons come and go on the rail: keep the marker on the lit one
new MutationObserver((changes) => {
  if (changes.some((c) => c.target.id !== "railInd")) placeRailInd();
}).observe(document.querySelector(".rail"), { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });

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
  // Not <body>: it carries data-page too (the page that is open, for the stylesheets), so every click anywhere
  // matched it and "opened" the current page again - Home's Quick join, servers and cards reloaded and replayed their
  // arrival animation on every click (owner, 16 Oct).
  const target = e.target.closest("[data-page]:not(body)");
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
  // The same sign-in card gates the whole app, not just Home: signed out, the
  // rail, top actions and sidebar are hidden (styles.css, #app.signed-out)
  // and switchPage refuses every page but Home.
  $("app").classList.toggle("signed-out", !signedIn || needRm);
  // Home's PvP tiers are the signed-in player's: looked up again for a new account, gone when signed out.
  $("nhTierList").textContent = "";
  if (signedIn) loadMyTiers();
  // Home's nametag, and the server cards (built once, then live counts)
  paintHomeName();
  if (signedIn) {
    buildHomeServers();
    pingHomeServers();
    loadSponsor();
    paintMcStatIcons();
  }
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
  $("accountBtn").title = "Spaceport account" + (state.signedIn ? ` - Minecraft: ${state.username}` : "");
}

function paintReminthAccount(r) {
  const user = (r && r.user) || null;
  // another account (or none): the old Friends card isn't this one's
  if ((state.rm.user && state.rm.user.id) !== (user && user.id) && typeof friends !== "undefined") {
    friends.card = null;
    friends.error = null;
  }
  state.rm.user = user;
  if (typeof loadFriends === "function") setTimeout(loadFriends, 0);
  if (r && "accounts" in r) {
    state.rm.accounts = Boolean(r.accounts);
    state.rm.providers = r.providers || [];
    state.rm.checked = true;
  }
  if (user) state.rm.checked = true;
  rmAvatarInto($("rmAvatar"), user);
  $("rmName").textContent = user ? user.name : "Spaceport account";
  $("rmSignInBtn").hidden = Boolean(user) || !state.rm.accounts;
  $("rmSignOutBtn").hidden = !user;
  $("rmManageBtn").hidden = !user;
  const via = user && (user.providers || [user.provider]).filter(Boolean).map((p) => RM_NAMES[p] || p).join(" + ");
  if (user) $("rmState").textContent = (via ? `Signed in with ${via}` : "Signed in") + (r && r.offline ? " - offline right now" : "");
  else if (!state.rm.accounts) $("rmState").textContent = r && r.offline ? "Can't reach Spaceport right now" : "Spaceport accounts are coming soon";
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
let rmLastProvider = "discord";
async function rmBrowserSignIn(provider) {
  rmLastProvider = provider;
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
$("rmGateReopen").onclick = () => rmBrowserSignIn(rmLastProvider);
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
      toast(rmMode === "signup" ? `Welcome to Spaceport Launcher, ${r.user.name}!` : `Signed in to Spaceport as ${r.user.name}.`);
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
  toast("Signed out of your Spaceport account.");
  if (rmGateNeeded()) switchPage("home");
};
$("rmManageBtn").onclick = () => window.reminth.reminthAccount.openWebsite().catch(() => {});
window.reminth.reminthAccount.onChanged((r) => {
  rmGateBusy(false);
  if (r && r.user) {
    paintReminthAccount(r);
    toast(`Signed in to Spaceport as ${r.user.name}.`);
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
const heroInstance = () => (state.heroPick && instanceById(state.heroPick)) || window.ReminthPure.heroInstance(state.instances, state.activeId);
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
    $("heroVersion").textContent = "";
    $("heroInstance").textContent = "No instance";
    $("heroMeta").hidden = true;
    $("heroLede").hidden = false;
    $("heroLede").textContent = state.instancesError
      ? "Spaceport couldn't read your instances. Restart Spaceport — your worlds and mods are not touched."
      : "No instance yet. Make one with the + on the left.";
    for (const id of ["playBtn", "instPlayBtn", "heroInstanceBtn"]) $(id).disabled = true;
    return;
  }
  $("heroInstanceBtn").disabled = false;
  $("heroLede").hidden = true;
  $("heroMeta").hidden = false;
  $("heroLoader").textContent = loaderLabel(inst);
  $("heroVersion").textContent = inst.mcVersion;
  $("heroInstance").textContent = inst.name;
  $("heroPick").title = inst.modpack ? `${inst.modpack.title} - pick the instance Play starts` : "Pick the instance Play starts";
  paintHeroStats();
  paintPlayButtons();
}

/**
 * Home's "Last played ... · ... played": Time played is the player's whole time through Reminth (every instance,
 * deleted ones too - main.js keeps the counter); Last played is about the instance PLAY starts.
 */
function paintHeroStats() {
  const inst = heroInstance();
  const total = window.ReminthPure.homePlayTime(state.settings, state.instances);
  $("heroPlaytime").textContent = total ? formatPlaytime(msToTicks(total)) : "0m";
  $("heroPlaytime").title = "All your time in Minecraft through Spaceport, across every instance - including ones you deleted.";
  $("heroLast").textContent = inst && inst.lastPlayed ? formatWhen(inst.lastPlayed) : "never";
}

/** The menu under Home's PLAY: which instance it starts, then that instance's page and a new one. */
function openHeroPicker() {
  const opener = $("heroPick");
  const current = heroInstance();
  const box = el("div", "dd-menu inst-menu hero-menu");
  box.setAttribute("role", "menu");
  box.setAttribute("aria-label", "Pick the instance Play starts");
  box.appendChild(el("div", "inst-menu-title", "Play starts"));
  const buttons = [];
  const add = (label, sub, iconId, onPick, extraClass) => {
    const b = el("button", "dd-item" + (extraClass ? " " + extraClass : ""));
    b.type = "button";
    b.setAttribute("role", "menuitem");
    b.appendChild(icon(iconId));
    const text = el("span", "im-text");
    text.appendChild(el("span", null, label));
    if (sub) text.appendChild(el("small", "im-why", sub));
    b.appendChild(text);
    b.onclick = () => {
      closeInstanceMenu(false);
      onPick();
    };
    box.appendChild(b);
    buttons.push(b);
    return b;
  };
  for (const inst of state.instances) {
    const on = current && inst.id === current.id;
    const b = add(inst.name, `${loaderLabel(inst)} ${inst.mcVersion}`, on ? "#i-check" : "#i-cube", () => {
      state.heroPick = inst.id;
      renderHero();
    }, on ? "picked" : "");
    b.setAttribute("aria-checked", on ? "true" : "false");
    b.setAttribute("role", "menuitemradio");
  }
  if (current) {
    box.appendChild(el("div", "inst-menu-sep"));
    add(`Open ${current.name}`, "Its mods, worlds, servers and logs", "#i-library", () => selectInstance(current.id, true));
  }
  add("New instance", "Any version, any loader", "#i-plus", () => openInstanceModal(null));
  showMenuBox(box, buttons, { anchor: opener, below: true, opener });
}
$("heroPick").onclick = () => (instMenu ? closeInstanceMenu(false) : openHeroPicker());

/**
 * Play buttons double as a progress pill while their instance installs.
 * Home's pair is about the hero's instance (the last played), the instance
 * page's pair about the one open there.
 */
function paintPlayButtons() {
  for (const [playId, inst] of [
    ["playBtn", heroInstance()],
    ["instPlayBtn", activeInstance()],
  ]) {
    if (!inst) continue;
    const busy = state.installing.has(inst.id);
    const stopping = state.stopping.has(inst.id);
    const runningNow = state.running.has(inst.id) || stopping;
    const p = state.progress.get(inst.id);
    const btn = $(playId);
    if (btn) {
      btn.disabled = busy || runningNow;
      // Home's button has a title and a line under it ("LAUNCH GAME" / "Launch Reminth"): only the title changes,
      // and the line hides while the progress text or "Playing" needs the room.
      const label = btn.querySelector(".nh-play-title b") || btn.querySelector("span");
      btn.classList.toggle("progressing", busy);
      btn.classList.toggle("no-sub", busy || runningNow);
      btn.style.setProperty("--p", busy && p && p.pct !== null ? p.pct + "%" : "0%");
      // busy: just "Launching…" (owner, 16 Oct 2026) - how far along shows as the button's fill
      label.textContent = runningNow ? "Playing" : busy ? "Launching…" : playId === "playBtn" ? "Launch game" : "Play";
    }
    // No Stop button (owner, 16 Oct 2026): a game ends by closing Minecraft. main.js sweepRunning and syncRunning
    // below make sure "Playing" goes away when it has.
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
  { id: "balanced", title: "Balanced", description: ["Spaceport's performance pack and Java settings, with Minecraft's own video settings.", "Nothing about how the game looks or plays is changed."] },
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
  if (existing.modpack && existing.performanceMods === false) return "Off for modpacks: the pack's author chose its mods. Switch it on if you want Spaceport's as well.";
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
  hudField.appendChild(el("label", null, "Spaceport HUD"));
  const hudRow = el("div", "toggle-row compact");
  const hudText = el("div");
  const hudTitle = el("b", null, "FPS, graphics card, processor and ping in game");
  const hudSub = el("span", null, "");
  hudText.appendChild(hudTitle);
  hudText.appendChild(hudSub);
  const hudSwitch = el("button", "switch");
  hudSwitch.type = "button";
  hudSwitch.setAttribute("role", "switch");
  hudSwitch.setAttribute("aria-label", "Spaceport HUD");
  hudRow.appendChild(hudText);
  hudRow.appendChild(hudSwitch);
  hudField.appendChild(hudRow);
  extras.appendChild(hudField);
  // The Reminth home screen (the game's own title screen), next to the HUD.
  const homeField = el("div", "field hud-field home-field");
  homeField.appendChild(el("label", null, "Spaceport home screen"));
  const homeRow = el("div", "toggle-row compact");
  const homeText = el("div");
  const homeTitle = el("b", null, "Spaceport's title screen in game");
  const homeSub = el("span", null, "");
  homeText.appendChild(homeTitle);
  homeText.appendChild(homeSub);
  const homeSwitch = el("button", "switch");
  homeSwitch.type = "button";
  homeSwitch.setAttribute("role", "switch");
  homeSwitch.setAttribute("aria-label", "Spaceport home screen");
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
  const perfSub = el("span", null, "Stable builds only. Spaceport leaves a mod out when you have your own copy or one that conflicts.");
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
      ? "A small bar at the top right. H shows or hides it in game. (The Spaceport panel, G, is always there.)"
      : `No Spaceport HUD build for ${pick.version} yet — it's built per version.`;
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
      ? "Spaceport installs it and keeps it updated."
      : `No Spaceport home screen build for ${pick.version} yet — it's built per version.`;
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
              toast(perfOff ? "Performance pack off — Spaceport removes its copies the next time you press Play." : `${name} saved. Anything new downloads next time you press Play.`);
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
  showMenuBox(box, buttons, at);
}

/**
 * Puts a built menu on screen: at: { x, y } (the pointer), { anchor } (beside it, or under it when there's no room),
 * or { anchor, below: true } (centred under it). Never runs off the window; keyboard: arrows, Home/End, Enter, Esc;
 * the opener gets the focus back on Esc. One menu at a time (closeInstanceMenu closes it).
 */
function showMenuBox(box, buttons, at = {}) {
  closeInstanceMenu(false);
  document.body.appendChild(box);
  box.style.display = "flex";
  // Where: at the pointer, beside or under the button; then kept inside the window.
  const r = box.getBoundingClientRect();
  let x = at.x;
  let y = at.y;
  if (at.anchor && at.below) {
    const a = at.anchor.getBoundingClientRect();
    x = a.left + a.width / 2 - r.width / 2;
    y = a.bottom + 8;
    if (y + r.height > window.innerHeight - 8) y = a.top - r.height - 8; // no room below: above it
  } else if (at.anchor) {
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
    // A press on the button that opened it is left to that button (Home's picker closes its menu on a second click).
    if (!box.contains(e.target) && !(at.opener && at.opener.contains(e.target))) closeInstanceMenu(false);
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
    body.appendChild(el("p", null, "Play this instance once first - Spaceport needs the game's files to know which settings it has."));
  } else if (plan && plan.reason === "no-options") {
    body.appendChild(el("p", null, "This instance hasn't saved any video settings yet. Play it once, then come back."));
  } else if (plan && plan.reason === "error") {
    body.appendChild(el("p", null, "Spaceport couldn't read this instance's video settings. Close the game if it's running and try again."));
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
  body.appendChild(el("p", "set-note", "Your saved logs stay in Spaceport's archive."));
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
    // Quiet launch (owner, 8 Oct 2026: the strip that flashed up on Play "becomes ugly"; 16 Oct: no "Preparing" box and
    // line at all, the button just says Launching): the bar and log stay hidden for the whole launch, however long it
    // takes - the button shows it, with its fill. Only an error opens them (appendLog), so a failed start still says why.
    state.quietUntil = Infinity;
    $("progressWrap").hidden = true;
    $("log").hidden = true;
    $("log").textContent = "";
    $("progressDismiss").hidden = true;
    clearTimeout(window._quietReveal);
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

/** Kept for older notes: a launch now stays quiet the whole time (runPlay sets quietUntil to Infinity). */
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
  state.quietUntil = 0; // Verify files was asked for: its bar shows (a launch keeps its own quiet)
  state.progressShown = inst.id;
  $("progressWrap" + suffix).hidden = false;
  $("log" + suffix).hidden = false;
  $("log" + suffix).textContent = "";
  $("progressDismiss" + suffix).hidden = true;
  paintPlayButtons();
  try {
    const result = await window.reminth.install(inst.id);
    if (result && result.removedMods && result.removedMods.length) {
      appendLog("Removed mods Spaceport no longer installs for you: " + result.removedMods.join(", "), false, progressSuffix());
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

const playClick = (which) => () => {
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
  // Home's PLAY goes back to "the last played" - which is this one now.
  state.heroPick = null;
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
  loadInstances();
  loadRecent();
  loadStats();
});
/**
 * "Playing" on the page is only what main.js really has running: checked every 5 s while a game runs and when
 * Reminth comes to the front. A play:exited that never arrived (the page reloading at that moment) can't leave
 * Launch game stuck on "Playing" - there is no Stop button to unstick it (owner, 16 Oct 2026).
 */
async function syncRunning() {
  let ids;
  try {
    ids = await window.reminth.runningIds();
  } catch {
    return;
  }
  if (!Array.isArray(ids)) return;
  const now = new Set(ids);
  let changed = false;
  for (const id of [...state.running]) {
    if (now.has(id)) continue;
    state.running.delete(id);
    changed = true;
  }
  if (!changed) return;
  paintGameRunning();
  paintPlayButtons();
  loadInstances();
}
setInterval(() => state.running.size && syncRunning(), 5000);
window.addEventListener("focus", () => state.running.size && syncRunning());
window.reminth.onPlayCrashed(({ instanceId, code, signal, error, logPath }) => {
  state.running.delete(instanceId);
  paintGameRunning();
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
  // Home's server cards and friends' Join buttons join with the instance Launch game starts
  paintHomeServerButtons();
  paintFriendJoins();
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

/* ---- Home's Quick join: the last worlds and servers, one tile each (the Night design) ---- */
// Dark tints for the server tiles - picked by the name, so a server keeps its colour.
const QUICK_TINTS = ["#1d2742", "#331c3b", "#1b3633", "#1c2a4a", "#3a2a1a", "#2a1d1d", "#1f2f24", "#2c2c38"];

/**
 * Two letters for a server tile: two words -> their first letters ("pvp hub" -> PH); one word (the address without
 * www. and its ending) -> its first letter and the next consonant ("mcpvp.club" -> MC, "donut" -> DN). `taken`: the
 * pairs already used, so two servers that would look the same get the next consonant instead ("mcpvp.com" -> MP).
 */
function quickInitials(name, taken) {
  const clean = String(name || "").toLowerCase().replace(/^www\./, "").replace(/\.[a-z]{2,}(:\d+)?$/, "");
  const words = clean.split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return "?";
  const pairs = [];
  if (words.length > 1) pairs.push(words[0][0] + words[1][0]);
  const w = words.join("");
  for (let i = 1; i < w.length; i++) if (!/[aeiou]/.test(w[i])) pairs.push(w[0] + w[i]);
  pairs.push(w.slice(0, 2));
  const pick = pairs.find((p) => p.length === 2 && !taken.has(p)) || pairs[0];
  taken.add(pick);
  return pick.toUpperCase();
}

function quickTile(entry, taken) {
  const b = el("button", "nh-tile recent-play " + entry.type);
  b.type = "button";
  // the server's own logo (servers.dat) or the world's own picture (its icon.png), when there is one
  const pic = typeof entry.icon === "string" && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(entry.icon) ? entry.icon : null;
  if (pic) {
    const img = el("img", "nh-tile-pic");
    img.src = pic;
    img.alt = "";
    img.draggable = false;
    b.classList.add("has-pic");
    b.appendChild(img);
  } else if (entry.type === "server") {
    b.textContent = quickInitials(entry.name || entry.address, taken);
    let h = 0;
    for (const c of String(entry.name || entry.address)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    b.style.setProperty("--tint", QUICK_TINTS[h % QUICK_TINTS.length]);
  } else {
    b.appendChild(pxIcon("world"));
  }
  const inst = recentTarget(entry);
  if (inst) b.dataset.instance = inst.id;
  const where = entry.type === "server" ? entry.address : `World · ${entry.instanceName || (inst && inst.name) || "Spaceport"}`;
  b.dataset.tip = `${entry.name}${where ? " · " + where : ""}`;
  b.setAttribute("aria-label", `${entry.type === "server" ? "Join" : "Open"} ${entry.name}`);
  bindTip(b);
  b.onclick = () => {
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

/**
 * Quick join: the last servers AND the last worlds (owner, 15 Oct 2026: "must show the last worlds but also last
 * servers you played"). Up to 3 servers (the ones joined most recently first - main/gameData.js reads that from the
 * game's logs - then the rest of the saved list), the newest worlds fill the rest; newest first overall.
 */
function quickJoinEntries(data, max = 6) {
  const servers = (data.servers || []).slice(0, 3);
  const worlds = (data.worlds || []).slice(0, max - servers.length);
  return [...servers, ...worlds].sort((a, b) => {
    if (a.lastPlayed && b.lastPlayed) return b.lastPlayed - a.lastPlayed;
    if (a.lastPlayed) return -1;
    if (b.lastPlayed) return 1;
    return 0;
  });
}

async function loadRecent() {
  let data;
  try {
    data = await window.reminth.recent();
  } catch (err) {
    data = { recent: [], worlds: [], servers: [], worldCount: 0, serverCount: 0, totalPlayTimeTicks: 0, error: err.message };
  }
  state.recent = data;
  const entries = data.error ? [] : disambiguate(quickJoinEntries(data));
  // the same tiles twice: inside the launch panel, and under the picker for windows where the panel is too short
  // (styles.css @container shows one of them)
  for (const id of ["quickJoin", "quickJoinBelow"]) {
    const row = $(id);
    row.textContent = "";
    const taken = new Set();
    entries.forEach((entry) => row.appendChild(quickTile(entry, taken)));
  }
  $("quickJoin").hidden = !entries.length;
  $("nhQuickWrap").hidden = !entries.length;
  paintRecentPlayButtons();

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
 * the Night home page (owner's "Home · Night" design, 14 Oct 2026):   *
 * pixel icons, the PvP tiers card, What's new, the night scene        *
 * ================================================================== */
// Small pixel pictures in the style of Minecraft's own item and block textures (owner, 15 Oct 2026: "make them better and
// to remind more of minecraft"), 16x16, drawn here by hand - not Mojang's files. One string per row, one letter per
// pixel: "." empty, any other letter a colour from PX_PAL. Drawn as SVG rectangles, crisp at any size.
const PX_PAL = { k: "#121214", D: "#0f7d74", d: "#2cc5b6", l: "#9df5e6", L: "#e6fffa", W: "#4a3418", w: "#7a5a2e", v: "#a37c47", J: "#5d5d63", I: "#a9a9b0", i: "#dcdce2", B: "#8f8d82", b: "#c9c6b6", a: "#ecead9", e: "#2b2a27", C: "#2f7a28", c: "#4fa83f", m: "#7fd06a", x: "#0c140c", G: "#3f7f2a", g: "#5ea63b", h: "#86c95a", E: "#5a3a20", f: "#7a5232", F: "#9a6b44", s: "#8c8c8c", P: "#f0a8a4", p: "#e3918e", S: "#e48f8d", n: "#8f4f4f" };
const PX_ICONS = {
  // player kills: a diamond sword
  sword: [
    ".............kkk",
    "............kLlk",
    "...........kldDk",
    "..........kldDk.",
    ".........kldDk..",
    "........kldDk...",
    ".......kldDk....",
    "..kk..kldDk.....",
    "..kdkkldDk......",
    "...kddDDk.......",
    "...kdDDk........",
    "..kwkkdDk.......",
    ".kwvk..kdk......",
    "kwvk....kk......",
    "kWk.............",
    ".k..............",
  ],
  // deaths: a skeleton skull
  skull: [
    "................",
    "..kkkkkkkkkkkk..",
    ".kaaaaaaaaaaaak.",
    ".kaabbaaaabbaak.",
    ".kabbbbbbbbbbak.",
    ".kbbbbbbbbbbbbk.",
    ".kbeeeebbeeeebk.",
    ".kbeeeebbeeeebk.",
    ".kbbbbbeebbbbbk.",
    ".kBbbbbeebbbbBk.",
    ".kBBbbbbbbbbBBk.",
    ".kBbeaeaeaeabBk.",
    ".kBBeBeBeBeBBBk.",
    "..kBBBBBBBBBBk..",
    "...kkkkkkkkkk...",
    "................",
  ],
  // mob kills: a pig's face (owner, 16 Oct 2026: a pig instead of the creeper)
  pig: [
    "kkkkkkkkkkkkkkkk",
    "kPPPpPPPPPPpPPPk",
    "kPpPPPPPPPPPPpPk",
    "kPPPPPPPPPPPPPPk",
    "kPPPPPPPPPPPPPPk",
    "kPaakPPPPPPkaaPk",
    "kPaakPPPPPPkaaPk",
    "kPPPPPPPPPPPPPPk",
    "kPPPPSSSSSSPPPPk",
    "kPPPPSnSSnSPPPPk",
    "kPPPPSnSSnSPPPPk",
    "kPpPPSSSSSSPPpPk",
    "kPPPPPPPPPPPPPPk",
    "kPPpPPPPPPPPPPPk",
    "kPPPPPPPPpPPPPPk",
    "kkkkkkkkkkkkkkkk",
  ],
  // blocks broken: an iron pickaxe
  pickaxe: [
    "................",
    "...kkkkkkkk.....",
    "..kiiiiiiiikk...",
    "..kJJIIIIiiiik..",
    "...kkkkkJIIiiik.",
    "........kwkJIik.",
    ".......kwvkkJIik",
    "......kwvk.kJIik",
    ".....kwvk..kJIik",
    "....kwvk...kJIk.",
    "...kwvk.....kk..",
    "..kwvk..........",
    ".kwvk...........",
    "kwvk............",
    "kWk.............",
    ".k..............",
  ],
  // blocks placed (and worlds in Quick join): a grass block
  block: [
    "kkkkkkkkkkkkkkkk",
    "khghhgghghhghggk",
    "kgGgghgGggggGgGk",
    "kGgGgGGgGgGggGgk",
    "kGfGGEGGfGGGEGfk",
    "kfFfEffFffEfFffk",
    "kffEfFfffFffEfFk",
    "kFffffEfFfffffEk",
    "kfEfFffffEfFfffk",
    "kffffsfEfffffFfk",
    "kfFEfffffFfEfffk",
    "kffffFfEffffsffk",
    "kEfFffffffFfffEk",
    "kffffEfFfEfffFfk",
    "kfFffffffffEfffk",
    "kkkkkkkkkkkkkkkk",
  ],
};
PX_ICONS.world = PX_ICONS.block;

function pxIcon(name) {
  const rows = PX_ICONS[name] || PX_ICONS.block;
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  const w = Math.max(...rows.map((r) => r.length));
  svg.setAttribute("viewBox", `0 0 ${w} ${rows.length}`);
  svg.setAttribute("class", "px");
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("aria-hidden", "true");
  rows.forEach((row, y) => {
    // One rectangle per run of the same colour, not one per pixel.
    for (let x = 0; x < row.length; ) {
      const ch = row[x];
      let end = x;
      while (end < row.length && row[end] === ch) end++;
      if (PX_PAL[ch]) {
        const r = document.createElementNS(NS, "rect");
        r.setAttribute("x", x);
        r.setAttribute("y", y);
        r.setAttribute("width", end - x);
        r.setAttribute("height", 1);
        r.setAttribute("fill", PX_PAL[ch]);
        svg.appendChild(r);
      }
      x = end;
    }
  });
  return svg;
}
document.querySelectorAll("i.px-icon[data-px]").forEach((i) => i.appendChild(pxIcon(i.dataset.px)));

/* ---- Home's stat icons in Minecraft's own pictures (owner, 16 Oct 2026: "exactly how they are in minecraft") ----
 * main.js mc:textures hands over the game's diamond sword and iron pickaxe, the skeleton's and the pig's skins and the
 * grass block, from a client jar already downloaded (never shipped with Reminth). The sword and the pickaxe are drawn
 * flat, pixel for pixel, like in the inventory. The skeleton skull, the pig's head (its snout sticking out) and the
 * grass block are drawn the way the inventory draws heads and blocks: a small cube seen from above, the top fully lit,
 * the left face at 80 %, the right one at 60 %. Until a game is downloaded, the hand-drawn icons above stay. */
const GRASS_ITEM_TINT = [145, 189, 89]; // #91BD59: the green Minecraft gives the grass block item
const MC_SHADE = { top: 1, front: 0.8, side: 0.6 };

function texPixels(img) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const x = c.getContext("2d");
  x.drawImage(img, 0, 0);
  return { w: c.width, h: c.height, d: x.getImageData(0, 0, c.width, c.height).data };
}
/** A rectangle of a texture as rows of [r, g, b, a]; `tint` multiplies the colour (the grey grass top turns green). */
function texRect(tex, x0, y0, w, h, tint) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * tex.w + (x0 + x)) * 4;
      const p = [tex.d[i], tex.d[i + 1], tex.d[i + 2], tex.d[i + 3]];
      row.push(tint ? [(p[0] * tint[0]) / 255, (p[1] * tint[1]) / 255, (p[2] * tint[2]) / 255, p[3]] : p);
    }
    rows.push(row);
  }
  return rows;
}
/** A Minecraft model box's three visible faces from its texture (the usual box layout: u, v, width, height, depth). */
function boxFaces(tex, u, v, w, h, d) {
  return { top: texRect(tex, u + d, v, w, d), front: texRect(tex, u + d, v + d, w, h), side: texRect(tex, u + d + w, v + d, d, h) };
}

/**
 * Cubes seen like in the inventory: +z comes towards the viewer on the left, +x on the right, y is up. `boxes`:
 * [{ x, y, z, w, h, d, faces }], drawn in order (back to front). Each texture pixel is a small filled shape, grown a
 * hair so no seams show between them.
 */
function drawIsoBoxes(canvas, boxes) {
  const C = Math.cos(Math.PI / 6);
  const at = (x, y, z) => [(x - z) * C, (x + z) * 0.5 - y];
  const quads = [];
  for (const b of boxes) {
    const X = b.x + b.w, Y = b.y + b.h, Z = b.z + b.d;
    const { top, front, side } = b.faces;
    // top: u along x, v from the back (z = b.z) to the front
    top.forEach((row, j) => row.forEach((p, i) => quads.push({ p, shade: MC_SHADE.top, pts: [at(b.x + i, Y, b.z + j), at(b.x + i + 1, Y, b.z + j), at(b.x + i + 1, Y, b.z + j + 1), at(b.x + i, Y, b.z + j + 1)] })));
    // front (z = Z): u along x, rows from the top down
    front.forEach((row, j) => row.forEach((p, i) => quads.push({ p, shade: MC_SHADE.front, pts: [at(b.x + i, Y - j, Z), at(b.x + i + 1, Y - j, Z), at(b.x + i + 1, Y - j - 1, Z), at(b.x + i, Y - j - 1, Z)] })));
    // side (x = X): u from the front edge backwards
    side.forEach((row, j) => row.forEach((p, i) => quads.push({ p, shade: MC_SHADE.side, pts: [at(X, Y - j, Z - i), at(X, Y - j, Z - i - 1), at(X, Y - j - 1, Z - i - 1), at(X, Y - j - 1, Z - i)] })));
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const q of quads) for (const [x, y] of q.pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const N = canvas.width;
  const pad = N * 0.03;
  const k = Math.min((N - 2 * pad) / (maxX - minX), (N - 2 * pad) / (maxY - minY));
  const ox = (N - (maxX - minX) * k) / 2 - minX * k;
  const oy = (N - (maxY - minY) * k) / 2 - minY * k;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, N, N);
  const grow = 0.35; // screen pixels
  for (const q of quads) {
    if (q.p[3] < 8) continue;
    const pts = q.pts.map(([x, y]) => [x * k + ox, y * k + oy]);
    const cx = (pts[0][0] + pts[2][0]) / 2, cy = (pts[0][1] + pts[2][1]) / 2;
    ctx.beginPath();
    pts.forEach(([x, y], n) => {
      const dx = x - cx, dy = y - cy, len = Math.hypot(dx, dy) || 1;
      const gx = x + (dx / len) * grow, gy = y + (dy / len) * grow;
      n ? ctx.lineTo(gx, gy) : ctx.moveTo(gx, gy);
    });
    ctx.closePath();
    const [r, g, bl, al] = q.p;
    ctx.fillStyle = `rgba(${Math.round(r * q.shade)}, ${Math.round(g * q.shade)}, ${Math.round(bl * q.shade)}, ${al / 255})`;
    ctx.fill();
  }
}

/** An item drawn flat, one texture pixel = a whole number of screen pixels where it can, never blurred. */
function drawFlatItem(canvas, img) {
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
}

let mcIconsPromise = null;
function loadMcIconTextures() {
  if (!mcIconsPromise) {
    mcIconsPromise = (window.reminth.mcTextures ? window.reminth.mcTextures() : Promise.resolve(null))
      .then(async (urls) => {
        if (!urls) return null;
        const out = {};
        for (const [key, url] of Object.entries(urls)) {
          if (!PNG_DATA_URL.test(url)) return null;
          out[key] = await new Promise((res) => {
            const img = new Image();
            img.onload = () => res(img);
            img.onerror = () => res(null);
            img.src = url;
          });
          if (!out[key]) return null;
        }
        return out;
      })
      .catch(() => null);
    // no game jar yet: ask again next time Home opens (the first game install brings one)
    mcIconsPromise.then((t) => {
      if (!t) mcIconsPromise = null;
    });
  }
  return mcIconsPromise;
}

/** Puts Minecraft's own icons into Home's stat rows (once they can be had). */
let mcIconsPainted = false;
async function paintMcStatIcons() {
  if (mcIconsPainted) return;
  const t = await loadMcIconTextures();
  if (!t || mcIconsPainted) return;
  mcIconsPainted = true;
  const N = Math.max(32, Math.round(32 * (window.devicePixelRatio || 1)));
  const make = (draw) => {
    const c = el("canvas", "px-mc");
    c.width = c.height = N;
    c.setAttribute("aria-hidden", "true");
    draw(c);
    return c;
  };
  const skel = texPixels(t.skeleton);
  const pig = texPixels(t.pig);
  const top = texPixels(t.grassTop);
  const side = texPixels(t.grassSide);
  const head = (tex) => ({ x: 0, y: 0, z: 0, w: 8, h: 8, d: 8, faces: boxFaces(tex, 0, 0, 8, 8, 8) });
  const draw = {
    sword: (c) => drawFlatItem(c, t.sword),
    pickaxe: (c) => drawFlatItem(c, t.pickaxe),
    skull: (c) => drawIsoBoxes(c, [head(skel)]),
    // the pig's head with its snout (a 4x3x1 box in front of the lower half of the face, like the pig model)
    pig: (c) => drawIsoBoxes(c, [head(pig), { x: 2, y: 1, z: 8, w: 4, h: 3, d: 1, faces: boxFaces(pig, 16, 16, 4, 3, 1) }]),
    block: (c) =>
      drawIsoBoxes(c, [{ x: 0, y: 0, z: 0, w: 16, h: 16, d: 16, faces: { top: texRect(top, 0, 0, 16, 16, GRASS_ITEM_TINT), front: texRect(side, 0, 0, 16, 16), side: texRect(side, 0, 0, 16, 16) } }]),
  };
  document.querySelectorAll(".nh-stats i.px-icon[data-px]").forEach((i) => {
    const fn = draw[i.dataset.px];
    if (!fn) return;
    try {
      const c = make(fn);
      i.textContent = "";
      i.appendChild(c);
      i.classList.add("mc");
    } catch {
      // keep the hand-drawn one
    }
  });
}


// Pixel digits for the big numbers on Home: Pixelify Sans' own digits are hard to tell apart (a 5 reads as an 8, a 7
// as a 1), so numbers are drawn from this 5x7 set instead, 3 screen pixels per pixel - always sharp.
const PX_DIGITS = {
  0: [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  1: ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  2: [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  3: ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  4: ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  5: ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  6: ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  7: ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  8: [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  9: [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  ",": ["..", "..", "..", "..", "..", ".#", ".#", "#."],
  ".": [".", ".", ".", ".", ".", ".", "#"],
  // a locale's space between thousands (also the narrow and the no-break one)
  " ": ["..", "..", "..", "..", "..", "..", ".."],
  "\u00a0": ["..", "..", "..", "..", "..", "..", ".."],
  "\u202f": ["..", "..", "..", "..", "..", "..", ".."],
  "—": ["....", "....", "....", "####", "....", "....", "...."],
  "-": ["....", "....", "....", "####", "....", "....", "...."],
};

/** `text` drawn in PX_DIGITS (anything else is left out) as one SVG, `unit` screen pixels per pixel. */
function pxNumber(text, unit = 3) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "px-num");
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("aria-hidden", "true");
  let x = 0;
  for (const ch of String(text)) {
    const rows = PX_DIGITS[ch];
    if (!rows) continue;
    const w = Math.max(...rows.map((r) => r.length));
    rows.forEach((row, y) => {
      for (let i = 0; i < row.length; i++) {
        if (row[i] !== "#") continue;
        let end = i;
        while (end < row.length && row[end] === "#") end++;
        const r = document.createElementNS(NS, "rect");
        r.setAttribute("x", x + i);
        r.setAttribute("y", y);
        r.setAttribute("width", end - i);
        r.setAttribute("height", 1);
        svg.appendChild(r);
        i = end - 1;
      }
    });
    x += w + 1;
  }
  const cols = Math.max(1, x - 1);
  svg.setAttribute("viewBox", `0 0 ${cols} 8`);
  svg.setAttribute("width", cols * unit);
  svg.setAttribute("height", 8 * unit);
  return svg;
}

/** A Home stat: the number in pixel digits, the same text for screen readers and copy. */
function setPxStat(node, text) {
  node.textContent = "";
  node.setAttribute("aria-label", text);
  node.appendChild(pxNumber(text));
}
/* ---- Home's servers (owner, 15 Oct 2026; design "launch game panel/CLAUDE_CODE_HOME_UPDATE.md" section 5) ----
 * 12 cards, 3 a row: a picture made for each server (assets/img/servers/<id>.webp), the server's official icon (bundled
 * copy, then the newest one it sends with its status), its name and address, the live player count when it answers,
 * and Join (the instance Launch game would start). Built once; a ping only changes the icon and the count in place,
 * so the entrance cascade (motion.css) never replays on its own and hover never flickers. */
const HOME_SERVERS = [
  { id: "hypixel", name: "Hypixel", address: "mc.hypixel.net" },
  { id: "donutsmp", name: "DonutSMP", address: "donutsmp.net" },
  { id: "pvphq", name: "PvPHQ", address: "pvphq.com" },
  { id: "pvpclub", name: "PvP Club", address: "mcpvp.club" },
  { id: "pvphub", name: "PvP Hub", address: "play.pvphub.me" },
  { id: "lifesteal", name: "Lifesteal", address: "lifesteal.net" },
  { id: "minemen-club", name: "Minemen Club", address: "minemen.club" },
  { id: "mcpvp", name: "MCPVP", address: "mcpvp.com" },
  { id: "pikanetwork", name: "PikaNetwork", address: "play.pika-network.net" },
  { id: "2b2t", name: "2b2t", address: "2b2t.org" },
  { id: "manacube", name: "ManaCube", address: "play.manacube.com" },
  { id: "jartexnetwork", name: "JartexNetwork", address: "jartexnetwork.com" },
];
const SRV_ICONS_KEY = "reminth.homeServerIcons"; // the newest icon each server sent (data URLs, 4-12 KB each)
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
let homeServersBuilt = false;
let homeServersPingedAt = 0;

function savedServerIcons() {
  try {
    const v = JSON.parse(localStorage.getItem(SRV_ICONS_KEY) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** The card's icon box: the picture, or (no picture at all) the two-letter tile Quick join uses. */
function paintServerIcon(box, src, srv) {
  box.textContent = "";
  box.style.removeProperty("--tint");
  const initials = () => {
    box.textContent = quickInitials(srv.name, new Set());
    let h = 0;
    for (const c of srv.name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    box.style.setProperty("--tint", QUICK_TINTS[h % QUICK_TINTS.length]);
  };
  if (!src) return initials();
  const img = el("img");
  img.alt = "";
  img.draggable = false;
  img.onerror = initials;
  img.src = src;
  box.appendChild(img);
}

function buildHomeServers() {
  if (homeServersBuilt) return;
  const grid = $("nhServers");
  if (!grid) return;
  homeServersBuilt = true;
  const saved = savedServerIcons();
  HOME_SERVERS.forEach((srv, i) => {
    const card = el("article", "nh-srv");
    card.style.setProperty("--i", i);
    card.dataset.address = srv.address;
    const pic = el("div", "nh-srv-pic");
    const img = el("img");
    img.alt = "";
    img.draggable = false;
    img.decoding = "async";
    if (i >= 6) img.loading = "lazy"; // the bottom two rows
    img.src = `../../assets/img/servers/${srv.id}.webp`;
    pic.appendChild(img);
    const info = el("div", "nh-srv-info");
    const ico = el("span", "nh-srv-ico");
    const remembered = typeof saved[srv.address] === "string" && PNG_DATA_URL.test(saved[srv.address]) ? saved[srv.address] : null;
    paintServerIcon(ico, remembered || `../../assets/img/servers/icons/${srv.id}.png`, srv);
    const txt = el("span", "nh-srv-txt");
    txt.appendChild(el("b", "nh-srv-name", srv.name));
    const ip = el("span", "nh-srv-ip", srv.address);
    const online = el("em", "nh-srv-on");
    online.hidden = true;
    ip.appendChild(online);
    txt.appendChild(ip);
    const join = el("button", "nh-srv-join", "Join");
    join.type = "button";
    join.setAttribute("aria-label", `Join ${srv.name}`);
    join.onclick = () => joinHomeServer(srv.address);
    info.append(ico, txt, join);
    card.append(pic, info);
    grid.appendChild(card);
  });
  paintHomeServerButtons();
}

/** Join from a card: the same path as Quick join, with the instance Launch game would start. */
function joinHomeServer(address) {
  const inst = heroInstance();
  const join = window.ReminthPure.parseServerAddress(address);
  if (!inst || !join) return;
  if (state.running.has(inst.id) || state.installing.has(inst.id) || state.stopping.has(inst.id)) return;
  runPlay({ instanceId: inst.id, join: { host: join.host, port: join.port } });
}

/* ---- the sponsored box under Friends (owner, 16 Oct 2026) ----
 * The one server the owner set on the website (main.js sponsor:get - asked at most every 30 minutes, the picture
 * checked there). Always says "Sponsored". With no sponsor the space stays empty: nothing made up, no fake ads.
 * JOIN is the same as on the server cards. Nothing about the player is sent or counted for it. */
let sponsorShown = ""; // what is painted now, so a refresh with the same slot changes nothing
let sponsorPingedAt = 0;
async function loadSponsor() {
  let s = null;
  try {
    s = window.reminth.sponsor ? await window.reminth.sponsor() : null;
  } catch {
    s = null;
  }
  const slot = $("nhAdSlot");
  if (!slot) return;
  if (s && !(typeof s.image === "string" && /^data:image\/(?:png|jpeg|webp);base64,/.test(s.image) && s.name && s.address)) s = null;
  const key = s ? [s.name, s.address, s.image.length, s.until].join("|") : "";
  if (key !== sponsorShown) {
    sponsorShown = key;
    slot.textContent = "";
    slot.classList.toggle("filled", Boolean(s));
    if (!s) {
      slot.setAttribute("aria-hidden", "true");
      return;
    }
    slot.removeAttribute("aria-hidden");
    const head = el("div", "nh-card-head");
    head.appendChild(el("span", "nh-label", "Sponsored"));
    const card = el("article", "nh-srv nh-sponsor");
    const pic = el("div", "nh-srv-pic");
    const img = el("img");
    img.alt = "";
    img.draggable = false;
    img.src = s.image;
    pic.appendChild(img);
    const info = el("div", "nh-srv-info");
    const txt = el("span", "nh-srv-txt");
    txt.appendChild(el("b", "nh-srv-name", s.name));
    const ip = el("span", "nh-srv-ip", s.address);
    const online = el("em", "nh-srv-on");
    online.hidden = true;
    ip.appendChild(online);
    txt.appendChild(ip);
    const join = el("button", "nh-srv-join", "Join");
    join.type = "button";
    join.setAttribute("aria-label", `Join ${s.name}`);
    join.onclick = () => joinHomeServer(s.address);
    info.append(txt, join);
    card.append(pic, info);
    slot.append(head, card);
    sponsorPingedAt = 0;
    paintHomeServerButtons();
  }
  if (!s) return;
  // its live player count, like the server cards: at most once a minute, never while a game runs
  if (state.running.size || Date.now() - sponsorPingedAt < 60 * 1000) return;
  sponsorPingedAt = Date.now();
  let res = null;
  try {
    res = await window.reminth.pingServers([s.address]);
  } catch {
    return;
  }
  const r = res && res[s.address];
  const online = slot.querySelector(".nh-srv-on");
  if (!online) return;
  const count = r && r.online && typeof r.playersOnline === "number" ? r.playersOnline : null;
  online.hidden = count === null;
  if (count !== null) online.textContent = `${count.toLocaleString()} online`;
}

/* Home's character: its top on the same line as the servers' top (owner, 16 Oct 2026: "match exactly the servers").
 * It sits at the bottom of the left column; where that is lower than the servers (big windows), it is lifted (the
 * version line stays at the bottom) until both tops meet. Measured as if Home were scrolled to the top (the side columns don't scroll). A window too
 * short to reach the line keeps it as low as it fits. Runs whenever either column changes size. */
function alignHomeCharacter() {
  const me = $("nhMe");
  const grid = $("nhServers");
  if (!me || !grid) return;
  const before = me.style.marginBottom;
  me.style.marginBottom = "";
  if (me.offsetParent === null) return;
  const gridTop = grid.getBoundingClientRect().top + $("pages").scrollTop;
  const lift = Math.round(me.getBoundingClientRect().top - gridTop);
  const next = lift > 0 ? lift + "px" : "";
  me.style.marginBottom = next; // the version line under it stays at the bottom
  // (setting the same value again doesn't resize anything, so the observer below can't loop)
  return before !== next;
}
if (window.ResizeObserver) {
  const homeAlign = new ResizeObserver(() => alignHomeCharacter());
  for (const sel of ["#homeMain .nh-center", "#homeMain .nh-left", "#nhMe"]) {
    const node = document.querySelector(sel);
    if (node) homeAlign.observe(node);
  }
}
// and once Home is on screen and laid out (the observer can fire while it is still hidden)
document.addEventListener("reminth:page", (e) => {
  if (e.detail === "home") setTimeout(alignHomeCharacter, 30);
});
window.addEventListener("resize", () => setTimeout(alignHomeCharacter, 30));

/* ---- Host a server (the hosting page): free on Aternos, then add it / join it from here ----
 * The instance is the one Home's picker shows (heroInstance), the same one Launch game starts. The last address typed is
 * remembered on this PC only (localStorage) so Join is one click next time. */
const HOST_ADDR_KEY = "reminth.hostAddress";
function hostInstanceLabel(inst) {
  if (!inst) return "your instance";
  const loader = { vanilla: "Vanilla", fabric: "Fabric", quilt: "Quilt", forge: "Forge", neoforge: "NeoForge" }[inst.loader] || inst.loader || "";
  return `${loader} ${inst.mcVersion || ""}`.trim();
}
function paintHostingPage() {
  const inst = heroInstance();
  const match = $("hostMatch");
  match.textContent = inst ? hostInstanceLabel(inst) : "the loader and version of the instance you play";
  if (inst && inst.loader && inst.loader !== "vanilla") match.appendChild(el("small", null, " (mods that only change how the game looks, like Sodium, don't go on the server)"));
  $("hostInst").textContent = inst ? `${inst.name} (${hostInstanceLabel(inst)})` : "your instance";
  if (!$("hostAddr").value) {
    try {
      $("hostAddr").value = localStorage.getItem(HOST_ADDR_KEY) || "";
    } catch {
      // storage off: start empty
    }
  }
  const busy = !inst || state.running.has(inst.id) || state.installing.has(inst.id);
  $("hostJoin").disabled = busy;
}
function hostMessage(text, bad) {
  const m = $("hostMsg");
  m.textContent = text;
  m.classList.toggle("bad", Boolean(bad));
  m.hidden = !text;
}
/** The typed address, checked, or null (with a message). */
function hostAddress() {
  const text = $("hostAddr").value.trim();
  const parsed = text ? window.ReminthPure.parseServerAddress(text) : null;
  if (!parsed) {
    hostMessage(text ? "That isn't a server address. It looks like yourname.aternos.me" : "Paste your server's address first.", true);
    return null;
  }
  try {
    localStorage.setItem(HOST_ADDR_KEY, text);
  } catch {
    // not remembered - fine
  }
  return { text, ...parsed };
}
$("hostAdd").onclick = async () => {
  const inst = heroInstance();
  const addr = hostAddress();
  if (!inst || !addr) return;
  $("hostAdd").disabled = true;
  try {
    const r = await window.reminth.addServer(inst.id, { name: "My server", address: addr.text });
    hostMessage(r && r.added ? `Added to ${inst.name}'s server list as "My server".` : `It's already in ${inst.name}'s server list.`);
  } catch (err) {
    hostMessage(friendlyError(err.message), true);
  } finally {
    $("hostAdd").disabled = false;
  }
};
$("hostJoin").onclick = () => {
  const inst = heroInstance();
  const addr = hostAddress();
  if (!inst || !addr) return;
  if (state.running.has(inst.id) || state.installing.has(inst.id)) return;
  hostMessage(`Starting ${inst.name} and joining ${addr.text}…`);
  runPlay({ instanceId: inst.id, join: { host: addr.host, port: addr.port } });
};
document.addEventListener("reminth:page", (e) => {
  if (e.detail === "hosting") paintHostingPage();
});

function paintHomeServerButtons() {
  const inst = heroInstance();
  const busy = !inst || state.running.has(inst.id) || state.installing.has(inst.id) || state.stopping.has(inst.id);
  document.querySelectorAll(".nh-srv-join").forEach((b) => (b.disabled = busy));
}

/** Live player counts and the newest icons: when Home opens, at most once a minute, never while a game runs. */
async function pingHomeServers() {
  if (!homeServersBuilt || state.running.size || Date.now() - homeServersPingedAt < 60 * 1000) return;
  homeServersPingedAt = Date.now();
  let res;
  try {
    res = await window.reminth.pingServers(HOME_SERVERS.map((s) => s.address));
  } catch {
    return;
  }
  const saved = savedServerIcons();
  for (const card of $("nhServers").children) {
    const srv = HOME_SERVERS.find((s) => s.address === card.dataset.address);
    const r = res && res[card.dataset.address];
    const online = card.querySelector(".nh-srv-on");
    // no answer, no number (Night rule: nothing made up)
    const count = r && r.online && typeof r.playersOnline === "number" ? r.playersOnline : null;
    online.hidden = count === null;
    if (count !== null) online.textContent = `${count.toLocaleString()} online`;
    if (srv && r && typeof r.favicon === "string" && PNG_DATA_URL.test(r.favicon) && r.favicon !== saved[srv.address]) {
      saved[srv.address] = r.favicon;
      paintServerIcon(card.querySelector(".nh-srv-ico"), r.favicon, srv);
    }
  }
  try {
    localStorage.setItem(SRV_ICONS_KEY, JSON.stringify(saved));
  } catch {
    // storage full or off: the bundled icons still show next time
  }
}

/* ---- your name above your character, in Minecraft's own font (design section 3b) ----
 * The font is the game's bitmap (assets/minecraft/textures/font/ascii.png), read by main.js from a client jar Reminth
 * already downloaded - never shipped with Reminth. 16x16 glyphs; a glyph's width is its last column with any pixel + 1,
 * the advance is that + 1, a space is 4. Drawn like the game draws names: a shadow one font pixel right and down in a
 * quarter of the colour (#3F3F3F), then white, 3 screen pixels per font pixel. Before any game jar exists: Inter. */
let mcFontPromise = null;
function loadMcFont() {
  if (!mcFontPromise) {
    mcFontPromise = (window.reminth.mcFontAscii ? window.reminth.mcFontAscii() : Promise.resolve(null))
      .then((url) => (url && PNG_DATA_URL.test(url) ? new Promise((res) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = () => res(null);
        img.src = url;
      }) : null))
      .catch(() => null);
    // no game jar yet: ask again next time (the first game install brings one)
    mcFontPromise.then((img) => {
      if (!img) mcFontPromise = null;
    });
  }
  return mcFontPromise;
}

function mcNameCanvas(text, font) {
  const cell = font.width / 16;
  const sheet = document.createElement("canvas");
  sheet.width = font.width;
  sheet.height = font.height;
  const sg = sheet.getContext("2d", { willReadFrequently: true });
  sg.drawImage(font, 0, 0);
  const px = sg.getImageData(0, 0, sheet.width, sheet.height).data;
  const glyphs = [];
  let w = 0;
  for (const ch of String(text)) {
    let code = ch.charCodeAt(0);
    if (code > 255) code = 63; // "?"
    if (code === 32) {
      glyphs.push({ code, width: 0, advance: 4 });
      w += 4;
      continue;
    }
    const gx = (code % 16) * cell;
    const gy = Math.floor(code / 16) * cell;
    let last = -1;
    for (let x = 0; x < cell; x++) {
      for (let y = 0; y < cell; y++) {
        if (px[((gy + y) * sheet.width + gx + x) * 4 + 3] > 0) last = x;
      }
    }
    const width = last + 1; // font pixels of this sheet
    glyphs.push({ code, gx, gy, width });
    w += Math.round((width * 8) / cell) + 1;
  }
  const UNIT = 3; // screen pixels per font pixel (8 font pixels a line, like the game's)
  const dpr = window.devicePixelRatio || 1;
  const fw = Math.max(1, w + 1); // every advance (the last gap holds the shadow), plus the shadow of a full-width glyph
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(fw * UNIT * dpr);
  canvas.height = Math.round(9 * UNIT * dpr);
  canvas.style.width = fw * UNIT + "px";
  canvas.style.height = 9 * UNIT + "px";
  const g = canvas.getContext("2d");
  g.imageSmoothingEnabled = false;
  const s = UNIT * dpr; // canvas pixels per font pixel
  // the glyphs once in white on a strip, then a #3F3F3F copy for the shadow
  const strip = document.createElement("canvas");
  strip.width = Math.max(1, Math.round((w * cell) / 8));
  strip.height = cell;
  const tg = strip.getContext("2d");
  tg.imageSmoothingEnabled = false;
  let x = 0;
  for (const gl of glyphs) {
    if (gl.code !== 32 && gl.width > 0) tg.drawImage(sheet, gl.gx, gl.gy, gl.width, cell, x, 0, gl.width, cell);
    x += gl.code === 32 ? (4 * cell) / 8 : gl.width + cell / 8;
  }
  const shadow = document.createElement("canvas");
  shadow.width = strip.width;
  shadow.height = strip.height;
  const hg = shadow.getContext("2d");
  hg.drawImage(strip, 0, 0);
  hg.globalCompositeOperation = "source-in";
  hg.fillStyle = "#3f3f3f";
  hg.fillRect(0, 0, shadow.width, shadow.height);
  const dw = (strip.width * 8) / cell;
  g.drawImage(shadow, 0, 0, strip.width, cell, s, s, dw * s, 8 * s);
  g.drawImage(strip, 0, 0, strip.width, cell, 0, 0, dw * s, 8 * s);
  return canvas;
}

async function paintHomeName() {
  const tag = $("nhMeName");
  if (!tag) return;
  const name = state.signedIn && state.username ? String(state.username) : "";
  // streamer mode hides the player's name everywhere else: here too
  tag.hidden = !name || Boolean(state.privacy);
  if (!name) {
    tag.textContent = "";
    delete tag.dataset.name;
    return;
  }
  if (tag.dataset.name === name && tag.dataset.font === "mc") return;
  tag.dataset.name = name;
  const font = await loadMcFont();
  if (tag.dataset.name !== name) return; // the name changed meanwhile
  tag.textContent = "";
  tag.dataset.font = font ? "mc" : "inter";
  tag.setAttribute("aria-label", name);
  if (font) {
    try {
      tag.appendChild(mcNameCanvas(name, font));
      return;
    } catch {
      tag.dataset.font = "inter";
    }
  }
  tag.appendChild(el("span", "nh-me-font", name));
}

/* ---- friends (owner, 15 Oct 2026: "make the friends whole system work") ----
 * Home's Friends card: your friends (playing first, then online, then offline) with where they play and a Join
 * button, requests you got (Accept / Decline) and sent (Cancel), "+" to add someone by their friend code, your own
 * code with Copy, and "Appear offline". Needs a Reminth account; the server is functions/_friends.js, the launcher's
 * presence main/presence.js (it pushes a fresh card every 2 minutes, "friends:update"). Only accepted friends see
 * anything about you; nothing here is made up - an empty list says so. */
// var, not const: paintReminthAccount (higher up) may look at it before this line has run
var friends = { card: null, error: null, loading: false, adding: false };

function friendAvatar(p) {
  const av = el("span", "nh-fr-av");
  const src = typeof p.avatarUrl === "string" && /^https:\/\/(cdn\.discordapp\.com|lh3\.googleusercontent\.com)\//.test(p.avatarUrl) ? p.avatarUrl : null;
  const letter = () => {
    av.textContent = "";
    av.appendChild(el("span", "avatar-letter", (p.name || "?").slice(0, 1).toUpperCase()));
  };
  if (!src) {
    letter();
    return av;
  }
  const img = new Image();
  img.alt = "";
  img.referrerPolicy = "no-referrer";
  img.onerror = letter;
  img.src = src;
  av.appendChild(img);
  return av;
}

function friendSeen(ms) {
  if (!ms) return "Offline";
  const min = Math.max(1, Math.round((Date.now() - ms) / 60000));
  if (min < 60) return `Last seen ${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `Last seen ${h}h ago`;
  return `Last seen ${Math.round(h / 24)}d ago`;
}

function friendRow(p, kind) {
  const row = el("div", "nh-fr-row " + kind + (p.status ? " " + p.status : ""));
  const av = friendAvatar(p);
  if (kind === "friend") av.appendChild(el("i", "nh-fr-dot"));
  row.appendChild(av);
  const txt = el("span", "nh-fr-txt");
  txt.appendChild(el("b", "nh-fr-name", p.name || "Player"));
  let line;
  if (kind === "incoming") line = "Wants to be friends";
  else if (kind === "outgoing") line = "Request sent";
  else if (p.status === "playing") line = p.server ? `Playing on ${p.server}` : "Playing Minecraft";
  else if (p.status === "online") line = "In the launcher";
  else line = friendSeen(p.lastSeen);
  const sub = el("span", "nh-fr-sub", line);
  if (kind === "friend" && p.mcName) sub.title = `Minecraft: ${p.mcName}`;
  txt.appendChild(sub);
  row.appendChild(txt);
  const act = el("span", "nh-fr-act");
  const btn = (label, cls, onClick, tip) => {
    const b = el("button", "nh-fr-btn " + cls, label);
    b.type = "button";
    if (tip) b.setAttribute("aria-label", tip);
    b.onclick = (e) => {
      e.stopPropagation();
      onClick(b);
    };
    act.appendChild(b);
    return b;
  };
  if (kind === "incoming") {
    btn("Accept", "cream", () => friendAction(() => window.reminth.friendRespond(p.id, true)));
    btn("Decline", "ghost", () => friendAction(() => window.reminth.friendRespond(p.id, false)));
  } else if (kind === "outgoing") {
    btn("Cancel", "ghost", () => friendAction(() => window.reminth.friendRemove(p.id)));
  } else {
    if (p.status === "playing" && p.server) {
      const j = btn("Join", "cream join", () => joinHomeServer(p.server), `Join ${p.name} on ${p.server}`);
      j.dataset.server = p.server;
    }
    const x = el("button", "nh-fr-icon nh-fr-remove");
    x.type = "button";
    x.setAttribute("aria-label", `Remove ${p.name}`);
    x.dataset.tip = "Remove friend";
    x.appendChild(icon("#i-x"));
    bindTip(x);
    x.onclick = async (e) => {
      e.stopPropagation();
      if (await confirmModal(`Remove ${p.name}?`, "You stop seeing each other online. You can add each other again with your codes.", "Remove", true)) {
        friendAction(() => window.reminth.friendRemove(p.id));
      }
    };
    act.appendChild(x);
  }
  row.appendChild(act);
  return row;
}

function friendSection(title, list, kind) {
  const wrap = el("div", "nh-fr-sec");
  if (title) wrap.appendChild(el("span", "nh-fr-head", title));
  for (const p of list) wrap.appendChild(friendRow(p, kind));
  return wrap;
}

function paintFriends() {
  const body = $("nhFriendsBody");
  if (!body) return;
  const signedIn = Boolean(state.rm && state.rm.user && !state.rm.user.offline);
  const card = friends.card;
  $("nhFriendAddBtn").hidden = !signedIn || !card;
  $("nhFriendsFoot").hidden = !signedIn || !card;
  if (!signedIn) $("nhFriendAdd").hidden = true;
  body.textContent = "";
  if (!signedIn) {
    body.appendChild(el("p", "nh-empty", state.rm && state.rm.accounts === false ? "Friends need Spaceport accounts, which aren't on right now." : "Sign in to your Spaceport account to add friends."));
    $("nhFriendsCount").textContent = "";
    return;
  }
  if (!card) {
    body.appendChild(el("p", "nh-empty", friends.error ? friends.error : "Loading…"));
    return;
  }
  const online = card.friends.filter((p) => p.status !== "offline").length;
  $("nhFriendsCount").textContent = card.friends.length ? `${online} online` : "";
  $("nhMyCode").textContent = card.code || "—";
  $("nhAppearOffline").checked = Boolean(card.appearOffline);
  if (card.incoming.length) body.appendChild(friendSection(`Requests · ${card.incoming.length}`, card.incoming, "incoming"));
  if (card.friends.length) body.appendChild(friendSection(card.incoming.length || card.outgoing.length ? "Friends" : null, card.friends, "friend"));
  if (card.outgoing.length) body.appendChild(friendSection("Sent", card.outgoing, "outgoing"));
  if (!card.friends.length && !card.incoming.length && !card.outgoing.length) {
    body.appendChild(el("p", "nh-empty", "No friends yet. Send them your code below, or press + and type theirs."));
  }
  paintFriendJoins();
}

/** Join buttons follow Launch game: greyed while that instance installs or runs. */
function paintFriendJoins() {
  const inst = heroInstance();
  const busy = !inst || state.running.has(inst.id) || state.installing.has(inst.id) || state.stopping.has(inst.id);
  document.querySelectorAll(".nh-fr-btn.join").forEach((b) => (b.disabled = busy));
}

function friendsCard(r) {
  if (r && !r.error && Array.isArray(r.friends)) {
    friends.card = { ...r, incoming: r.incoming || [], outgoing: r.outgoing || [] };
    friends.error = null;
  } else if (r && r.error && r.error !== "signed_out") {
    friends.error = r.message || "Can't reach Spaceport right now.";
  }
  paintFriends();
}

async function loadFriends() {
  if (friends.loading || !(state.rm && state.rm.user)) return paintFriends();
  friends.loading = true;
  try {
    friendsCard(await window.reminth.friendsList());
  } catch {
    friendsCard({ error: "offline" });
  } finally {
    friends.loading = false;
  }
}

function friendMessage(text, bad) {
  const m = $("nhFriendMsg");
  m.textContent = text || "";
  m.hidden = !text;
  m.classList.toggle("bad", Boolean(bad));
}

async function friendAction(run) {
  try {
    const r = await run();
    if (r && r.error) friendMessage(r.message || "That didn't work. Try again.", true);
    else friendMessage("");
    friendsCard(r && !r.error ? r : null);
    return r;
  } catch {
    friendMessage("Can't reach Spaceport right now.", true);
    return null;
  }
}

$("nhFriendAddBtn").onclick = () => {
  const form = $("nhFriendAdd");
  form.hidden = !form.hidden;
  friendMessage("");
  if (!form.hidden) $("nhFriendCode").focus();
};
$("nhFriendAdd").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (friends.adding) return;
  const code = $("nhFriendCode").value.trim();
  if (!code) return $("nhFriendCode").focus();
  friends.adding = true;
  const sentBefore = friends.card ? friends.card.outgoing.length : 0;
  const r = await friendAction(() => window.reminth.friendRequest(code));
  friends.adding = false;
  if (r && !r.error) {
    $("nhFriendCode").value = "";
    $("nhFriendAdd").hidden = true;
    // they had already asked you: asking back made you friends at once
    friendMessage(r.outgoing.length > sentBefore ? "Request sent. They'll see it on their Home." : "You're friends now.");
  }
});
$("nhCopyCode").onclick = async () => {
  const code = friends.card && friends.card.code;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    toast("Friend code copied.");
  } catch {
    toast(code);
  }
};
$("nhAppearOffline").addEventListener("change", async (e) => {
  const on = e.target.checked;
  const r = await friendAction(() => window.reminth.friendsAppearOffline(on));
  if (!r || r.error) e.target.checked = !on;
  else toast(on ? "Friends now see you as offline." : "Friends can see you again.");
});
window.reminth.onFriends((card) => friendsCard(card));

/* ---- PvP tiers: the player's own tiers on MCTiers, PvPTiers and SubTiers (main/tiers.js) ---- */
let tiersToken = 0;
async function loadMyTiers() {
  if (!state.signedIn) return;
  // the PvP tiers card is hidden on Home for now (owner, 15 Oct 2026): no point asking three sites for it
  if ($("nhTiers") && $("nhTiers").hidden) return;
  const token = ++tiersToken;
  const list = $("nhTierList");
  if (!list.childElementCount) list.appendChild(el("p", "nh-empty", "Looking up your tiers…"));
  let res;
  try {
    res = await window.reminth.myTiers();
  } catch {
    res = null;
  }
  if (token !== tiersToken) return;
  paintTiers(res);
}

/** res: { reached, ranks, error } from main/tiers.js playerTiers. */
function paintTiers(res) {
  const list = $("nhTierList");
  const note = $("nhTiersNote");
  list.textContent = "";
  note.textContent = "";
  if (!res || res.error || (!res.ranks.length && !res.reached)) {
    list.appendChild(el("p", "nh-empty", "Couldn't reach the tier lists right now."));
    return;
  }
  if (!res.ranks.length) {
    list.appendChild(el("p", "nh-empty", "No tiers yet on MCTiers, PvPTiers or SubTiers."));
    return;
  }
  for (const r of res.ranks.slice(0, 8)) {
    const chip = el("span", "nh-tier" + (r.retired ? " retired" : ""));
    chip.dataset.tier = String(r.tier);
    chip.dataset.high = r.high ? "1" : "0";
    chip.appendChild(el("b", null, r.label));
    chip.appendChild(el("span", null, r.modeName));
    chip.dataset.tip = `${r.modeName}: ${r.high ? "high" : "low"} tier ${r.tier} on ${r.sites.join(", ")}${r.retired ? " (retired)" : ""}`;
    bindTip(chip);
    list.appendChild(chip);
  }
  if (res.ranks.length > 8) note.textContent = `+${res.ranks.length - 8} more`;
}

/* ---- What's new: the bottom-left of Home opens the release's list ---- */
$("nhNews").onclick = () => {
  const body = el("div", "news-body");
  const list = el("ul", "change-list");
  CHANGELOG.forEach((item) => list.appendChild(el("li", null, item)));
  body.appendChild(list);
  openModal({ title: "What's new in " + $("nhVersion").textContent, body });
};


/* ================================================================== *
 * what's new                                                          *
 * ================================================================== */
// A hand-written list for this release; the version beside it comes from the app.
const CHANGELOG = [
  "A new look: Night - black and white under a pixel night sky, with the new Spaceport icon.",
  "A new Home: one big PLAY with the instance it starts right under it, your stats, your own PvP tiers (MCTiers, PvPTiers, SubTiers) and Quick join for your last worlds and servers.",
  "New in the G panel: Tier Tagger - players' PvP tiers (MCTiers, PvPTiers, SubTiers) above their heads and in the tab list, every gamemode. Type /tiers <name> to see all of someone's tiers.",
  "Spaceport accounts: Discord, Google or email - the same account on the website, shown at the top of the launcher.",
  "The Spaceport Mods Panel: press G in game for 140+ of Spaceport's own features - FPS, keystrokes, armor, potion timers, zoom, hit marker, chat timestamps and more. On every version from 1.20.1 to 26.3.",
  "A pointer that never vanishes in full screen, a new title screen, and a heads-up when a server's rules ban one of your mods.",
  "Pick what an instance is for (PvP, survival and more) and get a matching set of mods and packs.",
];

function renderChangelog() {
  $("nhVersion").textContent = "Spaceport " + (state.info ? state.info.appVersion : ""); // the short name: the line must fit next to What's new
  const box = $("changelog");
  box.textContent = "";
  $("changelogVersion").textContent = "Spaceport Launcher " + (state.info ? state.info.appVersion : "");
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
  setPxStat($("statMobKills"), ok ? num(stats.mobKills) : "—");
  setPxStat($("statPlayerKills"), ok ? num(stats.playerKills) : "—");
  setPxStat($("statDeaths"), ok ? num(stats.deaths) : "—");
  $("statDeathsRow").dataset.tip = ok && !stats.deaths ? "Deaths - flawless so far" : "Deaths";
  setPxStat($("statPlaced"), ok ? num(stats.totals && (stats.totals.placed != null ? stats.totals.placed : stats.totals.used)) : "—");
  setPxStat($("statBroken"), ok ? num(stats.totals && stats.totals.mined) : "—");
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
        ? "Server numbers are what each server reports for you, saved by the Spaceport HUD while you play on it (updated about every 90 seconds)."
        : "These numbers come from your own worlds. Servers keep your stats themselves: with the Spaceport HUD on, Spaceport asks the server for yours while you play and adds them here. Servers that don't keep normal Minecraft statistics can't be counted."
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
wireSwitch("toggleLaunchMinimized", "launchMinimized", (on) => (on ? "Spaceport will minimize when the game starts." : "Spaceport will stay open when the game starts."));
$("toggleHardwareAccel").onclick = async () => {
  const on = !$("toggleHardwareAccel").classList.contains("on");
  if (!on) {
    const ok = await confirmModal(
      "Turn off hardware acceleration?",
      ["Spaceport will be drawn by your processor instead of your graphics card, and it will feel slow and laggy when you scroll or change tabs.", "Only do this if the Spaceport window is black or flickering. You can turn it back on here at any time."],
      "Turn it off",
      true
    );
    if (!ok) return;
  }
  setSwitch("toggleHardwareAccel", on);
  paintHwNote();
  const saved = await saveSetting({ hardwareAcceleration: on }, "Restart Spaceport for that to take effect.");
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
  else if (gb >= capGb) note += capGb < spareGb ? ` That's the most Spaceport allows on this PC.` : ` That's the most this PC can spare (${Math.round(totalGb)} GB installed).`;
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
    const previous = document.documentElement.dataset.accent || "night";
    const accent = btn.dataset.accent;
    applyAccent(accent);
    // accentChosen: from now on this is the player's own pick, so the one-time move to the brand orange (store.js) leaves it alone.
    if (!(await saveSetting({ accent, accentChosen: true }))) applyAccent(previous);
  };
});
/** The whole launcher's look (Settings -> Theme): "night" = black and white (the default), "frost" = blue, "ember" = orange. */
const THEME_ACCENT = { night: "night", ember: "ember", frost: "cyan" };
const THEME_FILES = {
  night: ["styles-night.css", "reminth-mark-night.svg"],
  frost: ["styles-frost.css", "reminth-mark-frost.svg"],
  ember: ["styles.css", "reminth-mark.svg"],
};
function applyTheme(theme) {
  theme = THEME_FILES[theme] ? theme : "night";
  document.documentElement.dataset.theme = theme;
  const css = $("themeCss");
  const [href, mark] = THEME_FILES[theme];
  if (css && css.getAttribute("href") !== href) css.setAttribute("href", href);
  document.querySelectorAll('img[src*="reminth-mark"]').forEach((img) => {
    img.src = "../../assets/icons/source/" + mark;
  });
  document.querySelectorAll(".theme-pick").forEach((b) => b.classList.toggle("selected", b.dataset.theme === theme));
}
window.applyTheme = applyTheme;
document.querySelectorAll(".theme-pick").forEach((btn) => {
  btn.onclick = async () => {
    const before = { theme: document.documentElement.dataset.theme || "night", accent: document.documentElement.dataset.accent || "night" };
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
    $("aboutVersion").textContent = "Spaceport Launcher " + state.info.appVersion;
    $("aboutBuild").textContent = `Default instance: Minecraft ${state.info.minecraftVersion} · Fabric ${state.info.fabricLoaderVersion}`;
    renderChangelog();
  } catch {
    toast("Couldn't read launcher info.");
  }

  try {
    state.settings = await window.reminth.getSettings();
    const s = state.settings;
    state.activeId = s.activeInstance || "reminth";
    // Black (Night) is Reminth's look - not changeable for now (owner, 15 Oct 2026). The Blue/Orange code stays for later.
    applyTheme("night");
    applyAccent("night");
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
  if (state.instancesError) toast("Spaceport couldn't read your instances — restart it and try again.");
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
