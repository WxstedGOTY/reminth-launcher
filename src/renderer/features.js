"use strict";
/**
 * Reminth's bigger UI features. Loaded after renderer.js and uses its
 * helpers ($, el, icon, button, toast, state, openModal, makeDropdown...).
 *
 *   1. Instance content: mods / resource packs / shaders / data packs,
 *      live-updating lists, enable/disable/remove, update everything
 *   2. Home "Discover mods" cards
 *   3. Discover: modpacks, mods, packs, shaders, servers + filters
 *   4. Logs viewer
 *   5. Skins
 *   6. Streamer mode
 *   7. Compatibility help: what won't load, one-click fixes, version advisor
 */

/* ================================================================== *
 * 1. instance content                                                 *
 * ================================================================== */
const CONTENT_TABS = {
  tabMods: { kind: "mod", list: "listMods", count: "countMods", folder: "mods", discover: "mod", label: "mods" },
  tabPacks: { kind: "resourcepack", list: "listPacks", count: "countPacks", folder: "resourcepacks", discover: "resourcepack", label: "resource packs" },
  tabShaders: { kind: "shader", list: "listShaders", count: "countShaders", folder: "shaderpacks", discover: "shader", label: "shaders" },
  tabDatapacks: { kind: "datapack", list: "listDatapacks", count: "countDatapacks", folder: "saves", discover: "datapack", label: "data packs" },
};

const content = {
  instanceId: null,
  data: null, // { mod, resourcepack, shader, datapack, worlds }
  tab: "tabMods",
  search: "",
  sort: localGet("sort.content", "az"),
  updates: null, // null = not checked; [] = none
  updatesFor: null, // instance id `updates` was checked for - never apply them anywhere else
  updating: false, // false | "check" | "apply"
  updatingFor: null, // instance id that check/apply is running for
  selected: new Set(), // itemKey()s ticked in the list
  creators: {}, // itemKey() -> { author, avatar, title, iconUrl } from Modrinth
  creatorsFor: null, // instance id the creators map belongs to
  creatorsBusy: null, // instance id whose lookup is in flight
};

/** Real creator names + profile pictures, looked up on Modrinth in the
 *  background so the list never waits on the network. */
async function loadCreators(id) {
  if (content.creatorsBusy) return;
  content.creatorsBusy = id;
  try {
    const found = await window.reminth.contentCreators(id);
    if (id !== content.instanceId) return;
    content.creators = found || {};
    content.creatorsFor = id;
    if (currentPage === "instance" && CONTENT_TABS[content.tab]) renderContentTab();
  } catch {
    // offline - the names read out of the jars stay
  } finally {
    content.creatorsBusy = null;
    // The instance changed while this was in flight: that request was turned
    // away above and this result was thrown out, so ask again for the one
    // now on screen or it never gets its creators.
    if (content.instanceId && content.instanceId !== id) loadCreators(content.instanceId);
  }
}

const contentSortDd = makeDropdown($("contentSort"), {
  options: SORT_OPTIONS,
  value: content.sort,
  onChange: (v) => {
    content.sort = v;
    localSet("sort.content", v);
    renderContentTab();
  },
});
void contentSortDd;

wireTabs("instanceTabs", (tab) => {
  content.tab = tab;
  content.selected.clear();
  const isContent = Boolean(CONTENT_TABS[tab]);
  $("contentToolbar").hidden = !isContent;
  $("updatePanel").hidden = !isContent || !content.updates || !content.updates.length;
  if (isContent) renderContentTab();
  if (tab === "tabLogs") loadLogSessions();
  veilLogs();
  if (tab === "tabWorlds" || tab === "tabServers") loadInstanceData();
});

$("contentSearch").addEventListener("input", (e) => {
  content.search = e.target.value;
  renderContentTab();
});
$("contentRefresh").onclick = () => loadContent(content.instanceId || state.activeId);
$("openContentFolder").onclick = () => openFolder(CONTENT_TABS[content.tab] ? CONTENT_TABS[content.tab].folder : "game", content.instanceId);
$("addContentBtn").onclick = () => {
  const t = CONTENT_TABS[content.tab];
  if (t && t.kind === "mod" && modsLocked(content.instanceId)) return toast(MODS_LOCKED_LINE);
  switchPage("discover");
  setDiscoverType(t ? t.discover : "mod");
};

let contentSeq = 0;
let contentLatest = null; // the newest loadContent() call's promise

/** Only the newest call paints. An older one that answers late waits for the
 *  newest instead, so `await loadContent(x)` still means "the lists are fresh". */
function loadContent(instanceId) {
  const seq = ++contentSeq;
  contentLatest = loadContentNow(instanceId || state.activeId, seq);
  return contentLatest;
}

async function loadContentNow(id, seq) {
  let data;
  try {
    data = await window.reminth.content(id);
  } catch (err) {
    data = { mod: [], resourcepack: [], shader: [], datapack: [], worlds: [], error: err.message };
  }
  // A slower, older answer must not overwrite a newer one (wrong instance's
  // lists, counts and Installed marks).
  if (seq !== contentSeq) return contentLatest;
  if (id !== content.instanceId) {
    content.updates = null;
    content.updatesFor = null;
    content.selected.clear();
    content.creators = {};
    content.creatorsFor = null;
    $("updatePanel").hidden = true;
  }
  const switched = id !== content.instanceId;
  content.instanceId = id;
  content.data = data;
  // The panel is about one instance: on a switch it shows what's already
  // known about the new one (or nothing) until its own check answers.
  if (switched) renderCompatPanel();
  for (const t of Object.values(CONTENT_TABS)) {
    const n = (data[t.kind] || []).filter((i) => i.valid).length;
    $(t.count).textContent = n ? String(n) : "";
  }
  $("instMods").textContent = String((data.mod || []).filter((i) => i.valid && i.enabled).length);
  if (currentPage === "instance") renderContentTab();
  loadCreators(id);
  refreshPackFiles(id);
  paintUpdateButton();
  refreshInstalledMarks();
  // On every page, not only the instance's own: Play can be pressed from
  // Home, and the first check of a big instance takes longer than Play
  // waits. Run now, the answer is ready (and remembered) by then.
  scheduleCompatCheck(id);
}

/** Installed Modrinth project ids in the active instance - for "Installed" badges in Discover. */
function installedProjectIds() {
  const out = new Set();
  if (!content.data || content.instanceId !== state.activeId) return out;
  for (const kind of ["mod", "resourcepack", "shader", "datapack"]) {
    for (const item of content.data[kind] || []) if (item.projectId) out.add(item.projectId);
  }
  return out;
}

const itemKey = (item) => `${item.kind}/${item.world || ""}/${item.file}`;
const creatorOf = (item) => content.creators[itemKey(item)] || null;

function itemName(item) {
  const c = creatorOf(item);
  return item.title || (c && c.title) || item.name || item.file.replace(/\.(jar|zip)(\.disabled)?$/i, "");
}

function contentIcon(item) {
  const c = creatorOf(item);
  const src = safeIconUrl(item.iconUrl) || safeIconUrl(c && c.iconUrl) || safeIconUrl(item.icon);
  if (src) {
    const img = el("img", "c-ico" + (src.startsWith("data:") ? " pixel" : ""));
    img.src = src;
    img.alt = "";
    img.loading = "lazy";
    img.addEventListener("error", () => img.replaceWith(el("div", "c-ico", itemName(item).slice(0, 1).toUpperCase())));
    return img;
  }
  if (item.folder) {
    const d = el("div", "c-ico");
    d.appendChild(icon("#i-folder"));
    return d;
  }
  return el("div", "c-ico", itemName(item).slice(0, 1).toUpperCase());
}

const itemRef = (item) => ({ kind: item.kind, world: item.world, file: item.file });

/** The creator's real profile picture, or a round letter mark without one. */
function authorMark(name, avatarUrl) {
  const letter = () => {
    const d = el("span", "c-avatar", name.slice(0, 1).toUpperCase());
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
    d.style.setProperty("--ah", String(h));
    return d;
  };
  const src = safeAvatarUrl(avatarUrl);
  if (!src) return letter();
  const img = el("img", "c-avatar");
  img.src = src;
  img.alt = "";
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";
  img.addEventListener("error", () => img.replaceWith(letter()));
  return img;
}

function rowMenu(item) {
  const wrap = el("div", "sort-dd c-more");
  const btn = el("button", "icon-btn");
  btn.type = "button";
  btn.title = "More";
  btn.appendChild(el("span", "kebab"));
  const menu = el("div", "dd-menu right");
  const add = (label, ico, fn) => {
    const it = el("button", "dd-item");
    it.type = "button";
    it.appendChild(icon(ico));
    it.appendChild(el("span", null, label));
    it.onclick = (e) => {
      e.stopPropagation();
      wrap.classList.remove("dd-open");
      fn();
    };
    menu.appendChild(it);
  };
  const t = Object.values(CONTENT_TABS).find((x) => x.kind === item.kind);
  // Known on Modrinth: its page (section 10); Back comes back here.
  const pid = item.projectId || (creatorOf(item) && creatorOf(item).projectId);
  if (pid && item.valid) add("Open project page", "#i-compass", () => openProject(pid, { title: itemName(item) }));
  add("Open folder", "#i-folder", () => openFolder(t ? t.folder : "game", content.instanceId));
  add("Copy file name", "#i-copy", () => {
    navigator.clipboard.writeText(item.file).then(() => toast("File name copied."), () => {});
  });
  btn.setAttribute("aria-label", `More for ${itemName(item)}`);
  btn.onclick = (e) => {
    e.stopPropagation();
    toggleMenu(wrap);
  };
  wrap.appendChild(btn);
  wrap.appendChild(menu);
  return wrap;
}

/* ---- a running game's mods can't change (main.js refuses too) ---- */
const MODS_LOCKED_LINE = "Close Minecraft to change mods.";
/** Pure-ish: are this instance's MODS locked right now? Packs, shaders and data packs never are. */
function modsLocked(id) {
  return Boolean(id) && (state.running.has(id) || state.stopping.has(id));
}

/* ---- grouping: what each mod is for ---- */
const CONTENT_GROUPS = [
  // Files Minecraft ignores (folders and non-.jar files in mods; anything
  // that isn't a .zip or a folder elsewhere) - never a real mod or pack.
  { id: "problem", label: "Safe to delete", color: "var(--amber)" },
  { id: "perf", label: "Performance", color: "var(--emerald)" },
  { id: "pvp", label: "PvP & HUD", color: "var(--rose)" },
  { id: "visual", label: "Visual", color: "#a78bfa" },
  { id: "utility", label: "Utility", color: "var(--cyan)" },
  { id: "gameplay", label: "Gameplay", color: "var(--amber)" },
  { id: "lib", label: "Libraries", color: "#94a3b8" },
  { id: "other", label: "Other", color: "#64748b" },
  { id: "off", label: "Off", color: "#475569" },
];
const PVP_WORDS = /hud|pvp|crystal|totem|combat|hurt ?cam|keystroke|\bcps\b|hit ?box|hit ?colou?r|\bzoom|armou?r ?status|potion ?timer|low ?fire|shield ?status/i;
const PERF_WORDS = /sodium|lithium|ferrite|entity ?culling|modernfix|c2me|scalablelux|immediatelyfast|more ?culling|krypton|lazydfu|starlight|nvidium|optimi[sz]|fps|performance|anchor ?optimizer/i;
const LIB_WORDS = /\bapi\b|\blib\b|library|config|kotlin|\bcore\b|architectury|fabric-api/i;
const SHADER_WORDS = /\biris\b|oculus|shader/i;
const VISUAL_WORDS = /animation|particle|\bskins?\b|\bcapes?\b|texture|cosmetic|visual|lighting/i;

/** Pure-ish: which section a content item sits in. */
function groupOf(item) {
  if (!item.valid) return "problem";
  if (!item.enabled) return "off";
  if (item.kind !== "mod") return "other";
  const c = creatorOf(item);
  const cats = new Set((c && c.categories) || []);
  const text = [itemName(item), c && c.slug, item.file].filter(Boolean).join(" ");
  if (cats.has("library") || (!cats.size && LIB_WORDS.test(text))) return "lib";
  if (SHADER_WORDS.test(text)) return "visual";
  if (cats.has("optimization") || PERF_WORDS.test(text)) return "perf";
  if (PVP_WORDS.test(text)) return "pvp";
  if (cats.has("decoration") || VISUAL_WORDS.test(text)) return "visual";
  if (["utility", "management", "storage", "social", "transportation"].some((x) => cats.has(x))) return "utility";
  if (cats.size) return "gameplay";
  return "other";
}

/** Which mods need this one: project id -> [names of mods that require it]. */
function neededByMap(items) {
  const map = new Map();
  for (const item of items) {
    const c = creatorOf(item);
    if (!c || !item.enabled) continue;
    for (const req of c.requires || []) {
      if (!map.has(req)) map.set(req, []);
      map.get(req).push(itemName(item));
    }
  }
  return map;
}

function contentRow(item, ctx) {
  const key = itemKey(item);
  const group = CONTENT_GROUPS.find((g) => g.id === ctx.group);
  const row = el("div", "content-row" + (item.enabled ? "" : " disabled") + (item.valid ? "" : " invalid") + (content.selected.has(key) ? " picked" : ""));
  row.dataset.key = key;
  row.style.setProperty("--gc", group ? group.color : "var(--line)");
  row.title = [item.file.replace(/\.disabled$/i, ""), item.size ? formatBytes(item.size) : null].filter(Boolean).join(" · ");
  row.addEventListener("click", (e) => {
    if (e.target.closest("button, input, a, .dd-menu")) return;
    pickRow(key, e.shiftKey);
  });

  row.appendChild(contentIcon(item));

  const main = el("div", "c-main");
  const top = el("div", "c-top");
  top.appendChild(el("span", "c-name", itemName(item)));
  const version = item.versionNumber || item.modVersion;
  if (version && item.valid) top.appendChild(el("span", "c-ver", version));
  main.appendChild(top);

  const sub = el("div", "c-author");
  const creator = creatorOf(item);
  const author = (creator && creator.author) || item.author;
  if (author) {
    sub.appendChild(authorMark(author, creator && creator.avatar));
    sub.appendChild(el("span", "c-by", author));
  }
  if (item.problem) sub.appendChild(el("span", "c-note warn", item.problem));
  else if (item.world && item.kind === "datapack") sub.appendChild(el("span", "c-note", item.world));
  if (item.kind === "mod" && ctx.managed && MANAGED_JAR.test(item.file)) sub.appendChild(el("span", "c-badge", "Reminth-managed"));
  else if (item.kind === "mod" && isPackFile(content.instanceId, item.file)) {
    const badge = el("span", "c-badge", "Performance pack");
    badge.title = "Kept up to date by Reminth. Switch it off here and Reminth leaves it off.";
    sub.appendChild(badge);
  }
  const needers = creator && ctx.neededBy.get(creator.projectId);
  if (needers && needers.length) {
    const others = needers.filter((n) => n !== itemName(item));
    if (others.length) sub.appendChild(el("span", "c-note", `Needed by ${others[0]}${others.length > 1 ? ` +${others.length - 1}` : ""}`));
  }
  if (sub.childNodes.length) main.appendChild(sub);
  row.appendChild(main);

  const actions = el("div", "c-actions");
  const up = ctx.updatesByFile.get(item.world + "/" + item.file);
  if (up) {
    const ub = el("button", "c-update");
    ub.type = "button";
    ub.title = "Update just this one";
    ub.appendChild(icon("#i-download"));
    ub.appendChild(el("span", null, `${version || "?"} → ${up.next.versionNumber}`));
    const channel = channelTag(up.next.channel);
    if (channel) {
      ub.appendChild(channel);
      ub.title = `Update just this one — it's a ${up.next.channel} build, not a stable release`;
    }
    if (ctx.locked) {
      ub.disabled = true;
      ub.title = MODS_LOCKED_LINE;
    }
    ub.onclick = async () => {
      const id = content.instanceId;
      if (content.updatesFor !== id) return; // not this instance's update
      if (state.running.has(id)) return toast("Close the game first — Windows won't let files in use be replaced.");
      ub.disabled = true;
      try {
        const result = await window.reminth.applyUpdates(id, [up]);
        const failed = result.failed || [];
        if (failed.length) toast(`Couldn't update ${itemName(item)}: ${friendlyError(failed[0].error)}`);
        else toast(`${itemName(item)} updated to ${up.next.versionNumber}${addedNote(result.added)}.${warningNote(result.warnings)}`);
        // Switched instance meanwhile: the list on screen isn't this one's.
        if (content.instanceId === id && content.updates) {
          content.updates = content.updates.filter((u) => u !== up);
          paintUpdateButton();
          renderUpdatePanel();
        }
      } catch (err) {
        toast(friendlyError(err.message));
      } finally {
        ub.disabled = false;
        if (content.instanceId === id) await loadContent(id);
      }
    };
    actions.appendChild(ub);
  }
  if (item.valid) {
    const sw = el("button", "switch" + (item.enabled ? " on" : ""));
    if (ctx.locked) {
      sw.disabled = true;
      sw.title = MODS_LOCKED_LINE;
    }
    sw.type = "button";
    sw.title = item.enabled ? "Turn off" : "Turn on";
    sw.setAttribute("role", "switch");
    sw.setAttribute("aria-checked", item.enabled ? "true" : "false");
    sw.setAttribute("aria-label", `${itemName(item)} on or off`);
    sw.onclick = async () => {
      // One call at a time: a second click used to rename a file that the
      // first had already renamed, and show the raw error.
      if (sw.disabled) return;
      if (item.kind === "mod" && modsLocked(content.instanceId)) return toast(MODS_LOCKED_LINE);
      sw.disabled = true;
      const id = content.instanceId; // fixed now - the instance on screen can change while this runs
      try {
        await window.reminth.setContentEnabled(id, itemRef(item), !item.enabled);
      } catch (err) {
        toast(friendlyError(err.message));
      } finally {
        // Either way the list is read again (this row is rebuilt with it).
        if (content.instanceId === id) await loadContent(id);
        sw.disabled = false;
      }
    };
    actions.appendChild(sw);
  }
  const del = el("button", "icon-btn danger");
  del.type = "button";
  del.title = ctx.locked ? MODS_LOCKED_LINE : "Move to Recycle Bin";
  del.disabled = Boolean(ctx.locked);
  del.appendChild(icon("#i-trash"));
  del.onclick = async () => {
    const id = content.instanceId; // the instance this row belongs to, whatever is on screen after the question
    if (item.kind === "mod" && modsLocked(id)) return toast(MODS_LOCKED_LINE);
    const ok = await confirmModal(`Remove ${itemName(item)}?`, "It goes to the Recycle Bin, so you can get it back if you change your mind.", "Remove", true);
    if (!ok) return;
    del.disabled = true; // until the list is redrawn without this row
    try {
      await window.reminth.removeContent(id, itemRef(item));
      toast(`${itemName(item)} moved to the Recycle Bin.`);
      content.selected.delete(key);
    } catch (err) {
      toast(friendlyError(err.message));
    }
    if (content.instanceId === id) await loadContent(id);
    del.disabled = false;
  };
  actions.appendChild(del);
  actions.appendChild(rowMenu(item));
  row.appendChild(actions);
  return row;
}

/* ---- picking rows: click to pick, shift-click for a range, then act on them together ---- */
function pickRow(key, range) {
  const order = content.order || [];
  if (range && content.lastPicked && order.includes(content.lastPicked)) {
    const a = order.indexOf(content.lastPicked);
    const b = order.indexOf(key);
    for (const k of order.slice(Math.min(a, b), Math.max(a, b) + 1)) content.selected.add(k);
  } else if (content.selected.has(key)) {
    content.selected.delete(key);
  } else {
    content.selected.add(key);
  }
  content.lastPicked = key;
  document.querySelectorAll(".content-row[data-key]").forEach((r) => r.classList.toggle("picked", content.selected.has(r.dataset.key)));
  paintSelection();
}

function visibleItems() {
  const t = CONTENT_TABS[content.tab];
  if (!t || !content.data) return [];
  const q = content.search.trim().toLowerCase();
  let items = content.data[t.kind] || [];
  if (q) items = items.filter((i) => itemName(i).toLowerCase().includes(q) || i.file.toLowerCase().includes(q));
  return items;
}

function paintSelection() {
  // Every tab has its own bar; the first one in the page is always Mods'.
  const t = CONTENT_TABS[content.tab];
  const bar = t && $(t.list).querySelector(".c-bulk");
  if (!bar) return;
  const picked = visibleItems().filter((i) => content.selected.has(itemKey(i)));
  bar.classList.toggle("show", picked.length > 0);
  const n = bar.querySelector(".c-bulk-n");
  if (n) n.textContent = `${picked.length} selected`;
}

async function bulkApply(op) {
  const id = content.instanceId;
  const t = CONTENT_TABS[content.tab];
  if (t && t.kind === "mod" && modsLocked(id)) return toast(MODS_LOCKED_LINE);
  const picked = visibleItems().filter((i) => content.selected.has(itemKey(i)));
  if (!picked.length) return;
  if (op === "remove") {
    const ok = await confirmModal(`Remove ${picked.length} item${picked.length === 1 ? "" : "s"}?`, "They go to the Recycle Bin, so you can get them back if you change your mind.", "Remove", true);
    if (!ok) return;
  }
  let failed = 0;
  for (const item of picked) {
    try {
      if (op === "remove") await window.reminth.removeContent(id, itemRef(item));
      else if (item.valid && item.enabled !== (op === "on")) await window.reminth.setContentEnabled(id, itemRef(item), op === "on");
    } catch {
      failed++;
    }
  }
  content.selected.clear();
  if (failed) toast(`${failed} couldn't be changed — is the game still running?`);
  await loadContent(id);
}

document.addEventListener("keydown", (e) => {
  // Not while a dialog is open: Esc there answers the dialog, the selection stays.
  if (e.key === "Escape" && content.selected.size && currentPage === "instance" && !modalStack.length) {
    content.selected.clear();
    renderContentTab();
  }
});

function groupSection(group, rows, kind) {
  const collapsed = new Set(localGet("content.collapsed", []));
  const id = kind + ":" + group.id;
  const sec = el("section", "c-group" + (collapsed.has(id) ? " collapsed" : ""));
  sec.style.setProperty("--gc", group.color);
  const head = el("button", "c-group-head");
  head.type = "button";
  head.appendChild(icon("#i-chevron", "i chev"));
  head.appendChild(el("span", "c-group-dot"));
  head.appendChild(el("span", "c-group-name", group.label));
  head.appendChild(el("span", "c-group-count", String(rows.length)));
  head.onclick = () => {
    const now = new Set(localGet("content.collapsed", []));
    if (now.has(id)) now.delete(id);
    else now.add(id);
    localSet("content.collapsed", [...now]);
    sec.classList.toggle("collapsed", now.has(id));
  };
  // The header is a button (it folds the group), so anything else in that
  // line sits next to it, not inside it.
  const top = el("div", "c-group-top");
  top.appendChild(head);
  if (group.id === "problem" && rows.length) top.appendChild(deleteAllInvalidButton(kind));
  sec.appendChild(top);
  const body = el("div", "c-group-body");
  rows.forEach((r) => body.appendChild(r));
  sec.appendChild(body);
  return sec;
}

/* ---- "Safe to delete" -> Delete all ---- */
const invalidBusy = new Set(); // "instanceId|kind" being cleaned up

/** One line per item for the confirmation: name, and its size or how many files a folder holds. */
function invalidDetailLine(d) {
  const what = d.folder ? (d.files === 0 ? "empty folder" : `folder, ${d.more ? `${d.files}+` : d.files} ${d.files === 1 && !d.more ? "file" : "files"}`) : d.size !== null && d.size !== undefined ? formatBytes(d.size) : "file";
  return `${d.world ? d.world + " / " : ""}${d.file} — ${what}`;
}

function deleteAllInvalidButton(kind) {
  const b = button("btn sm danger c-del-all", "Delete all", "#i-trash");
  b.title = "Move everything in this group to the Recycle Bin";
  const id = content.instanceId;
  if (kind === "mod" && modsLocked(id)) {
    b.disabled = true;
    b.title = MODS_LOCKED_LINE;
  }
  b.onclick = async (e) => {
    e.stopPropagation();
    const key = `${id}|${kind}`;
    if (b.disabled || invalidBusy.has(key)) return;
    if (kind === "mod" && modsLocked(id)) return toast(MODS_LOCKED_LINE);
    invalidBusy.add(key);
    b.disabled = true;
    try {
      let details;
      try {
        details = await window.reminth.invalidContentDetails(id, kind);
      } catch (err) {
        return toast(friendlyError(err.message));
      }
      if (!details || !details.length) {
        toast("Nothing to delete here any more.");
        if (content.instanceId === id) await loadContent(id);
        return;
      }
      const body = el("div");
      body.appendChild(el("p", null, "Minecraft ignores these. They go to the Windows Recycle Bin, so you can get them back."));
      if (details.some((d) => d.folder && (d.files > 0 || d.more))) {
        body.appendChild(el("p", "warn-note", "One or more folders contain files - check that none is a backup you want to keep."));
      }
      const list = el("ul", "del-list pii");
      for (const d of details) list.appendChild(el("li", null, invalidDetailLine(d)));
      body.appendChild(list);
      const ok = await new Promise((resolve) => {
        let answered = false;
        openModal({
          title: `Delete ${details.length} ${details.length === 1 ? "item" : "items"}?`,
          body,
          wide: true,
          focusCancel: true,
          buttons: [
            { label: "Cancel", className: "outline" },
            { label: "Move to Recycle Bin", className: "primary danger-fill", icon: "#i-trash", onClick: () => { answered = true; resolve(true); } },
          ],
          onClose: () => { if (!answered) resolve(false); },
        });
      });
      if (!ok) return;
      if (kind === "mod" && modsLocked(id)) return toast(MODS_LOCKED_LINE);
      try {
        const r = await window.reminth.removeInvalidContent(id, kind);
        const failed = r.failed || [];
        if (!failed.length) toast(`Moved ${r.moved.length} to the Recycle Bin.`);
        else {
          const inUse = failed.filter((f) => /EBUSY|EPERM|EACCES|in use/i.test(f.error)).length;
          const why = inUse === failed.length ? `${failed.length} ${failed.length === 1 ? "is" : "are"} in use` : `${failed[0].file}: ${friendlyError(failed[0].error)}`;
          toast(`Moved ${r.moved.length} of ${r.total}; ${why}.`);
        }
      } catch (err) {
        toast(friendlyError(err.message));
      }
      if (content.instanceId === id) await loadContent(id);
    } finally {
      invalidBusy.delete(key);
      if (b.isConnected) b.disabled = kind === "mod" && modsLocked(id);
    }
  };
  return b;
}

const MOD_COLOURS = { HUD: "var(--cyan)", Library: "var(--emerald)" };
function managedModCard(mod) {
  const card = el("div", "card mod");
  const head = el("div", "mod-head");
  const mark = el("div", "mcard-ico", mod.name.slice(0, 1));
  mark.style.setProperty("--mc", MOD_COLOURS[mod.tag] || "var(--accent)");
  if (mod.name === "ReminthHUD") {
    mark.textContent = "";
    const img = el("img", "mcard-ico");
    img.src = "../../assets/icon.png";
    img.alt = "";
    head.appendChild(img);
  } else head.appendChild(mark);
  const names = el("div");
  names.appendChild(el("div", "mod-name", mod.name));
  names.appendChild(el("div", "mcard-cat", mod.tag));
  head.appendChild(names);
  card.appendChild(head);
  card.appendChild(el("p", null, mod.note));
  const foot = el("div", "mod-foot");
  foot.appendChild(el("span", "ok", "Installed and kept up to date by Reminth"));
  foot.appendChild(el("span", "tag dim", mod.required ? "Required" : "Core"));
  card.appendChild(foot);
  return card;
}

/** "Browse content" and the Open folder hint follow the lock (mods tab only). */
function paintModsLockToolbar() {
  const t = CONTENT_TABS[content.tab];
  const locked = Boolean(t && t.kind === "mod" && modsLocked(content.instanceId));
  $("addContentBtn").disabled = locked;
  $("addContentBtn").title = locked ? MODS_LOCKED_LINE : "";
  // Explorer can't be stopped from changing files, so this is only a hint.
  $("openContentFolder").title = locked ? `${MODS_LOCKED_LINE} (Changes made here while it runs only half apply.)` : "";
  $("openContentFolder").classList.toggle("hint-locked", locked);
}

// Repaints when an instance starts or stops running (renderer.js
// paintPlayButtons calls this) - so everything comes back by itself.
const lockPainted = new Map(); // instance id -> locked as last painted
function paintModLock() {
  const id = content.instanceId;
  if (!id) return;
  const now = modsLocked(id);
  paintModsLockToolbar();
  if (lockPainted.get(id) === now) return;
  lockPainted.set(id, now);
  if (currentPage === "instance") renderContentTab();
  if (cardMenu) renderCardMenu();
}

function renderContentTab() {
  const t = CONTENT_TABS[content.tab];
  if (!t || !content.data) return;
  lockPainted.set(content.instanceId, modsLocked(content.instanceId));
  paintModsLockToolbar();
  const list = $(t.list);
  const inst = instanceById(content.instanceId);
  if (t.kind === "mod") {
    // The ReminthHUD/Fabric API "managed mod" cards used to render here,
    // above the player's own mod list. Purely cosmetic clutter - ReminthHUD
    // and Fabric API are still installed and managed exactly as before
    // (see minecraft.js) - this just stops drawing the two boxes for them.
    const grid = $("instManagedMods");
    grid.textContent = "";
  }
  const q = content.search.trim().toLowerCase();
  let items = content.data[t.kind] || [];
  if (q) items = items.filter((i) => itemName(i).toLowerCase().includes(q) || i.file.toLowerCase().includes(q));
  items = sortItems(items, content.sort, itemName, (i) => i.addedAt);
  list.textContent = "";
  if (content.data.error) return renderEmpty(list, "Couldn't read this instance's folders", friendlyError(content.data.error));
  if (!items.length) {
    if (q) return renderEmpty(list, "Nothing matches that", "Try a different name.");
    if (t.kind === "mod" && inst && inst.loader === "vanilla") {
      return renderEmpty(list, "This is a vanilla instance", "Mods need a loader. Edit this instance and pick Fabric, Quilt, Forge or NeoForge — or make a new one with the + on the sidebar.");
    }
    if (t.kind === "datapack" && !(content.data.worlds || []).length) {
      return renderEmpty(list, "No worlds yet", "Data packs live inside a world. Play once, make a world, then add packs to it.");
    }
    return renderEmpty(list, `No ${t.label} yet`, `Find some in Discover, or drop files into the ${t.folder} folder — they show up here the moment they land.`);
  }
  const ctx = {
    updatesByFile: new Map((content.updates || []).map((u) => [u.world + "/" + u.file, u])),
    neededBy: neededByMap(content.data[t.kind] || []),
    managed: Boolean(inst && inst.loader !== "vanilla"),
    // A running game's mods can't change: their controls are off until it closes.
    locked: t.kind === "mod" && modsLocked(content.instanceId),
  };
  if (ctx.locked) list.appendChild(el("p", "mods-locked-note", MODS_LOCKED_LINE));
  const sections = [];
  if (t.kind === "datapack") {
    // Data packs belong to a world - one section per world.
    const worlds = [...new Set(items.map((i) => i.world))];
    for (const world of worlds) {
      sections.push({ group: { id: "w-" + world, label: world, color: "var(--cyan)" }, items: items.filter((i) => i.world === world) });
    }
  } else {
    for (const g of CONTENT_GROUPS) {
      const inGroup = items.filter((i) => groupOf(i) === g.id);
      if (inGroup.length) sections.push({ group: g, items: inGroup });
    }
  }
  content.order = [];
  // Packs and shaders don't have categories - one plain list (plus "Off") reads better than one lone heading.
  // ("Safe to delete" always keeps its heading: its Delete all button lives there.)
  const plain = t.kind !== "mod" && t.kind !== "datapack" && sections.length === 1 && sections[0].group.id !== "problem";
  for (const { group, items: groupItems } of sections) {
    const rows = groupItems.map((item) => {
      content.order.push(itemKey(item));
      return contentRow(item, { ...ctx, group: group.id });
    });
    if (plain) {
      const body = el("div", "c-group-body plain");
      rows.forEach((r) => body.appendChild(r));
      list.appendChild(body);
    } else list.appendChild(groupSection(group, rows, t.kind));
  }

  // Floating bar for picked rows.
  const bulk = el("div", "c-bulk");
  bulk.appendChild(el("span", "c-bulk-n"));
  bulk.appendChild(el("span", "c-bulk-hint", "Shift-click picks a range · Esc clears"));
  for (const [label, op, cls] of [["Turn on", "on", "outline"], ["Turn off", "off", "outline"], ["Remove", "remove", "danger"]]) {
    const b = el("button", "btn sm " + cls, label);
    b.type = "button";
    if (ctx.locked) {
      b.disabled = true;
      b.title = MODS_LOCKED_LINE;
    }
    b.onclick = () => bulkApply(op);
    bulk.appendChild(b);
  }
  const clear = el("button", "btn sm ghost", "Clear");
  clear.type = "button";
  clear.onclick = () => {
    content.selected.clear();
    renderContentTab();
  };
  bulk.appendChild(clear);
  list.appendChild(bulk);
  paintSelection();
  if (t.kind === "mod") paintCompatTags();
}

// Jars Reminth puts in and keeps up to date itself.
const MANAGED_JAR = /^(fabric-api|reminthhud)-/i;

// Live: the main process watches the active instance's folders.
// One event arrives per file, so installing a pack's jars fires dozens in a
// row: wait for them to settle instead of re-reading the folders each time.
const contentChangeTimers = new Map(); // instanceId -> timer
window.reminth.onContentChanged(({ instanceId }) => {
  clearTimeout(contentChangeTimers.get(instanceId));
  contentChangeTimers.set(
    instanceId,
    setTimeout(() => {
      contentChangeTimers.delete(instanceId);
      if (instanceId === state.activeId) loadContent(instanceId);
    }, 250)
  );
});

/** A "Beta" / "Alpha" tag for an update that isn't a stable release, else null. */
function channelTag(channel) {
  if (channel !== "beta" && channel !== "alpha") return null;
  const tag = el("span", "tag " + (channel === "beta" ? "amber" : "rose") + " up-channel", channel === "beta" ? "Beta" : "Alpha");
  tag.title = `Not a stable release - the author marked this build ${channel}.`;
  return tag;
}

/* ---- update everything ---- */
function paintUpdateButton(progressPct) {
  const btn = $("updateAllBtn");
  const text = $("updateAllText");
  btn.classList.remove("ready", "busy", "muted");
  btn.style.setProperty("--p", "0%");
  btn.disabled = false;
  // Busy only for the instance the check or update is running for.
  if (content.updating && content.updatingFor === content.instanceId) {
    btn.classList.add("busy");
    btn.disabled = true;
    btn.style.setProperty("--p", (progressPct || 0) + "%");
    text.textContent = content.updating === "check" ? "Checking for updates…" : `Downloading update${content.updates && content.updates.length > 1 ? "s" : ""} ${progressPct || 0}%`;
    return;
  }
  if (content.updates === null) text.textContent = "Check for updates";
  else if (!content.updates.length) {
    btn.classList.add("muted");
    text.textContent = "Everything's up to date";
  } else {
    btn.classList.add("ready");
    text.textContent = `Update ${content.updates.length}`;
  }
}

function renderUpdatePanel() {
  const panel = $("updatePanel");
  panel.textContent = "";
  if (!content.updates || !content.updates.length) {
    panel.hidden = true;
    return;
  }
  const head = el("div", "up-head");
  head.appendChild(el("b", null, `${content.updates.length} update${content.updates.length === 1 ? "" : "s"} ready`));
  const close = el("button", "icon-btn");
  close.appendChild(icon("#i-x"));
  close.onclick = () => (panel.hidden = true);
  head.appendChild(close);
  panel.appendChild(head);
  const list = el("div", "up-list");
  const kindLabel = { mod: "Mod", resourcepack: "Resource pack", shader: "Shader", datapack: "Data pack" };
  for (const u of content.updates) {
    const row = el("div", "up-row");
    const src = safeIconUrl(u.iconUrl);
    if (src) {
      const img = el("img");
      img.src = src;
      img.alt = "";
      row.appendChild(img);
    } else row.appendChild(el("span", "ph"));
    row.appendChild(el("span", null, `${u.title}`));
    row.appendChild(el("span", "tag dim", kindLabel[u.kind] + (u.world ? ` · ${u.world}` : "")));
    const ver = el("span", "ver");
    ver.appendChild(document.createTextNode(`${u.current || "?"} → `));
    ver.appendChild(el("b", null, u.next.versionNumber));
    row.appendChild(ver);
    const channel = channelTag(u.next.channel);
    if (channel) row.appendChild(channel);
    list.appendChild(row);
  }
  panel.appendChild(list);
  panel.hidden = false;
}

$("updateAllBtn").onclick = async () => {
  if (content.updating) return toast("Another instance is still being checked — try again in a moment.");
  // Fixed at click time: the player can switch instance while this runs.
  const id = content.instanceId || state.activeId;
  if (content.updates && content.updates.length) {
    if (content.updatesFor !== id) {
      // Checked for a different instance - applying them here would put that
      // instance's files into this one. Drop them and ask for a fresh check.
      content.updates = null;
      content.updatesFor = null;
      paintUpdateButton();
      renderUpdatePanel();
      return;
    }
    if (state.running.has(id)) {
      toast("Close the game first — Windows won't let files in use be replaced.");
      return;
    }
    const updates = content.updates;
    content.updating = "apply";
    content.updatingFor = id;
    paintUpdateButton(0);
    try {
      const result = await window.reminth.applyUpdates(id, updates);
      if (content.instanceId === id) {
        content.updates = null;
        content.updatesFor = null;
      }
      const applied = result.applied || [];
      const failed = result.failed || [];
      toast(
        (failed.length
          ? `Updated ${applied.length}${addedNote(result.added)}. ${failed.length} failed — ${failed[0].title}: ${friendlyError(failed[0].error)}`
          : `Updated ${applied.length} item${applied.length === 1 ? "" : "s"}${addedNote(result.added)}.`) + warningNote(result.warnings)
      );
    } catch (err) {
      toast(friendlyError(err.message));
    } finally {
      content.updating = false;
      if (content.instanceId === id) {
        $("updatePanel").hidden = true;
        await loadContent(id);
      } else paintUpdateButton(); // another instance is on screen - leave its lists alone
    }
    return;
  }
  content.updating = "check";
  content.updatingFor = id;
  paintUpdateButton(0);
  let found = null;
  try {
    found = await window.reminth.checkUpdates(id);
  } catch (err) {
    toast("Couldn't check for updates: " + friendlyError(err.message));
  } finally {
    content.updating = false;
    // Only keep the answer if the instance it was asked for is still the one
    // on screen; otherwise it would be offered (and applied) to the wrong one.
    if (content.instanceId === id || (!content.instanceId && state.activeId === id)) {
      content.updates = found;
      content.updatesFor = found ? id : null;
    }
    paintUpdateButton();
    renderUpdatePanel();
    renderContentTab();
  }
};

window.reminth.onContentProgress((p) => {
  if (p.op === "update" && content.updating === "apply" && content.updatingFor === content.instanceId) {
    paintUpdateButton(p.total ? Math.min(100, Math.round((p.current / p.total) * 100)) : 0);
  }
  if (p.op === "install") installProgress(p);
});

async function loadInstanceData() {
  const inst = activeInstance();
  if (!inst) return;
  let data;
  try {
    data = await window.reminth.instanceData(inst.id);
  } catch (err) {
    data = { worlds: [], servers: [], worldCount: 0, error: err.message };
  }
  if (inst.id !== state.activeId) return; // another instance was opened while this was read
  $("instWorlds").textContent = String(data.worldCount || 0);
  // A folder that couldn't be read is not the same as an empty one.
  const failed = data.error ? friendlyError(data.error) : null;
  fillGrid("worldGrid", data.worlds || [], "worldsNote", failed ? { emptyTitle: "Couldn't read this instance's worlds", emptyNote: failed } : { emptyTitle: "No worlds yet", emptyNote: "Any world you create in this instance shows up here." });
  fillGrid("instServerGrid", data.servers || [], "instServersNote", failed ? { emptyTitle: "Couldn't read this instance's server list", emptyNote: failed } : { emptyTitle: "No servers saved here", emptyNote: "Add one in game, or from Discover → Servers." });
}

window.onInstancePageOpen = (inst) => {
  paintSafeModeNotice(inst);
  paintSyncButtons();
  loadContent(inst.id);
  loadInstanceData();
  if (content.tab === "tabLogs") loadLogSessions();
  const isContent = Boolean(CONTENT_TABS[content.tab]);
  $("contentToolbar").hidden = !isContent;
  // Nothing to check without a mod loader.
  $("versionCheckBtn").hidden = inst.loader === "vanilla";
  $("replacedModsBtn").hidden = inst.loader === "vanilla";
};

/* ================================================================== *
 * installing from Discover / Home                                     *
 * ================================================================== */
const pendingInstalls = new Map(); // `${instanceId}:${projectId}` -> { buttons: Set<HTMLElement> }

function installProgress(p) {
  const pct = p.total > 1 ? Math.min(100, Math.round((p.current / p.total) * 100)) : null;
  for (const [key, entry] of pendingInstalls) {
    if (p.instanceId && !key.startsWith(p.instanceId + ":")) continue;
    for (const b of entry.buttons) {
      b.style.setProperty("--p", (pct || 0) + "%");
      const label = b.querySelector("span");
      if (label && (b.classList.contains("pill-btn") || b.classList.contains("pill-like"))) label.textContent = pct !== null ? `Installing ${pct}%` : "Installing…";
    }
  }
}

async function pickWorld(inst) {
  const data = content.instanceId === inst.id && content.data ? content.data : await window.reminth.content(inst.id);
  const worlds = data.worlds || [];
  if (!worlds.length) {
    toast("Data packs go inside a world — make one in game first.");
    return null;
  }
  if (worlds.length === 1) return worlds[0];
  return new Promise((resolve) => {
    let chosen = null;
    const body = el("div", "pick-list");
    const handle = openModal({ title: "Which world?", body, onClose: () => resolve(chosen) });
    for (const w of worlds) {
      const item = el("button", "pick-item");
      item.type = "button";
      item.appendChild(icon("#i-world"));
      item.appendChild(el("b", null, w));
      item.onclick = () => {
        chosen = w;
        handle.close();
      };
      body.appendChild(item);
    }
  });
}

/**
 * Installs a project into an instance. Every caller that can pass
 * `instanceId` does, taken when the player clicked: the active instance can
 * change while a dialog is open, and the install must still go where the
 * screen said it would. `buttons`: elements that show progress / the
 * installed state.
 */
async function installProject({ projectId, projectType, title, versionId, instanceId }, buttons = []) {
  const inst = instanceId ? instanceById(instanceId) : activeInstance();
  if (!inst) return false;
  if (projectType === "modpack") return installModpackFlow({ projectId, title });
  const kind = { mod: "mod", resourcepack: "resourcepack", shader: "shader", datapack: "datapack" }[projectType];
  if (!kind) return false;
  // Per instance: the same mod can go into two instances at once.
  const pendingKey = `${inst.id}:${projectId}`;
  if (pendingInstalls.has(pendingKey)) {
    // A second click landed while the first install for this project was
    // still in flight - the caller's own "done" check can't catch this,
    // since that class isn't set until the first install finishes. Refuse
    // the duplicate instead of sending it to the instance twice.
    toast(`${title || "That"} is already being added to ${inst.name}…`);
    return false;
  }
  // The main process refuses too; this is the plain answer before anything starts.
  if (kind === "mod" && modsLocked(inst.id)) {
    toast(`${inst.name} is running. ${MODS_LOCKED_LINE}`);
    return false;
  }
  if ((kind === "mod" || kind === "shader") && inst.loader === "vanilla") {
    toast(`${inst.name} is a vanilla instance — ${kind === "mod" ? "mods" : "shaders"} need a loader. Edit it and pick Fabric, Quilt, Forge or NeoForge first.`);
    return false;
  }
  // Marked pending before anything is awaited: the "Which world?" dialog
  // below used to leave a gap where a second click started a second install.
  const entry = { buttons: new Set(buttons) };
  pendingInstalls.set(pendingKey, entry);
  for (const b of buttons) {
    b.disabled = true;
    b.classList.add("busy");
  }
  try {
    let world = null;
    if (kind === "datapack") {
      world = await pickWorld(inst);
      if (!world) return false; // cancelled - the finally below un-marks it
    }
    // versionId: set only when the player picked one (chooseModVersion);
    // otherwise content.install picks the best match itself, as before.
    const result = await window.reminth.installContent(inst.id, { projectId, kind, world, ...(versionId ? { versionId } : {}) });
    const installed = result.installed || [];
    const extra = installed.length > 1 ? ` (+${installed.length - 1} it needs)` : "";
    toast(`${title || installed[0]?.title || "Installed"} added to ${inst.name}${extra}.${warningNote(result.warnings)}`);
    // Green check until the player leaves this page, then grey for good.
    freshAdds.add(`${inst.id}:${projectId}`);
    // Keep the open lists pointed at the active instance even when installing elsewhere.
    await loadContent(state.activeId);
    if (window.loadPresence) window.loadPresence();
    return true;
  } catch (err) {
    // No build for this instance: say which versions it does have builds
    // for, and offer the way out, instead of only an error.
    if (kind === "mod" && /has no version for Minecraft/i.test(err.message) && (await explainNoBuild(inst, projectId, title))) return false;
    toast(friendlyError(err.message));
    return false;
  } finally {
    pendingInstalls.delete(pendingKey);
    for (const b of buttons) {
      b.disabled = false;
      b.classList.remove("busy");
      b.style.setProperty("--p", "0%");
    }
    refreshInstalledMarks();
  }
}

async function installModpackFlow({ projectId, versionId, title, then }) {
  const body = el("div");
  body.appendChild(el("p", null, `${title || "This modpack"} becomes a new instance with its own folder, so it can't clash with your other mods or worlds.`));
  const prog = el("div", "progress modal-progress");
  prog.hidden = true;
  const row = el("div", "progress-row");
  const stage = el("span", null, "Preparing…");
  const pct = el("span");
  row.appendChild(stage);
  row.appendChild(pct);
  const track = el("div", "track");
  const fill = el("div", "fill");
  track.appendChild(fill);
  prog.appendChild(row);
  prog.appendChild(track);
  body.appendChild(prog);
  return new Promise((resolve) => {
    let result = null;
    let installing = false;
    const off = (p) => {
      const determinate = p.total > 1;
      stage.textContent = p.stage;
      const v = determinate ? Math.round((p.current / p.total) * 100) : null;
      pct.textContent = v !== null ? v + "%" : "";
      fill.style.width = v !== null ? v + "%" : "100%";
      fill.classList.toggle("busy", !determinate);
    };
    modpackListeners.add(off);
    openModal({
      title: `Install ${title || "modpack"}?`,
      body,
      // Esc or a click on the backdrop used to close this mid-install: the
      // install carried on unseen and could be started a second time.
      canClose: () => !installing,
      onClose: () => {
        modpackListeners.delete(off);
        resolve(result);
      },
      buttons: [
        { label: "Cancel", className: "outline" },
        {
          label: "Install",
          className: "primary",
          icon: "#i-download",
          onClick: async (handle) => {
            if (installing) return false;
            installing = true;
            prog.hidden = false;
            handle.buttons.forEach((b) => (b.disabled = true));
            try {
              const inst = await window.reminth.installModpack({ projectId, versionId });
              result = inst;
              await loadInstances();
              await selectInstance(inst.id, false);
              toast(`${inst.name} is installed. Press Play — the game files download on first launch.`);
              if (then) then(inst);
              return true;
            } catch (err) {
              stage.textContent = friendlyError(err.message);
              fill.style.width = "0%";
              handle.buttons.forEach((b) => (b.disabled = false));
              return false;
            } finally {
              installing = false;
            }
          },
        },
      ],
    });
  });
}
const modpackListeners = new Set();
window.reminth.onModpackProgress((p) => modpackListeners.forEach((fn) => fn(p)));

/* ------------------------------------------------------------------ *
 * "Choose version…": the optional slow path next to a mod's Install   *
 * ------------------------------------------------------------------ */
// Mirrors content.js loadersFor("mod") so the list only offers versions
// content.install would accept for this instance. Empty for vanilla (or no
// instance): nothing can load a mod there.
function modLoadersFor(inst) {
  if (!inst) return [];
  if (inst.loader === "fabric") return ["fabric"];
  if (inst.loader === "quilt") return ["quilt", "fabric"];
  if (inst.loader === "forge") return ["forge"];
  if (inst.loader === "neoforge") return inst.mcVersion === "1.20.1" ? ["neoforge", "forge"] : ["neoforge"];
  return [];
}
// Mirrors content.js pickVersion: newest release, else newest of any kind.
const defaultVersion = (versions) => versions.find((v) => v.version_type === "release") || versions[0] || null;
const DEP_LABELS = { required: "Required", optional: "Optional", incompatible: "Incompatible", embedded: "Bundled inside" };

async function chooseModVersion({ projectId, title, instanceId }, buttons = []) {
  // Fixed when the dialog opens. Everything below - the versions listed, the
  // name shown and the install itself - is for this instance, whichever one
  // is active by the time Install is pressed.
  const inst = instanceId ? instanceById(instanceId) : activeInstance();
  if (!inst) return false;
  const loaders = modLoadersFor(inst);
  if (!loaders.length) return installProject({ projectId, projectType: "mod", title, instanceId: inst.id }, buttons); // shows the vanilla message
  // What this instance already has, for the "Already installed" notes.
  let have = new Set();
  try {
    const data = content.instanceId === inst.id && content.data ? content.data : await window.reminth.content(inst.id);
    for (const kind of PRESENCE_KINDS) for (const item of data[kind] || []) if (item.projectId) have.add(item.projectId);
  } catch {
    have = new Set();
  }

  const body = el("div", "vpick");
  body.appendChild(el("p", "vpick-note", `Versions that work on ${inst.name} (${loaderLabel(inst)} ${inst.mcVersion}). The highlighted one is what Install picks on its own.`));
  const list = el("div", "pick-list vpick-list");
  const depsBox = el("div", "vpick-deps");
  body.appendChild(list);
  body.appendChild(depsBox);
  list.appendChild(el("div", "vpick-empty", "Loading versions…"));

  let chosen = null;
  let installed = false;
  // Resolves with whether anything got installed, however the modal closes.
  let settle;
  const done = new Promise((resolve) => (settle = resolve));
  const handle = openModal({
    title: `Install ${title || "mod"} into ${inst.name}`,
    body,
    wide: true,
    onClose: () => settle(installed),
    buttons: [
      { label: "Cancel", className: "outline" },
      {
        label: "Install",
        className: "primary",
        icon: "#i-download",
        onClick: async () => {
          if (!chosen) return false;
          installed = await installProject({ projectId, projectType: "mod", title, versionId: chosen.id, instanceId: inst.id }, buttons);
          return installed ? true : false;
        },
      },
    ],
  });
  const installBtn = handle.buttons[1];
  installBtn.disabled = true;

  let versions;
  let depProjects = new Map();
  try {
    const [v, deps] = await Promise.all([
      window.reminth.getCatalogProjectVersions(projectId, { loaders, gameVersions: [inst.mcVersion] }),
      window.reminth.getCatalogDependencies(projectId).catch(() => null),
    ]);
    versions = Array.isArray(v) ? v : [];
    for (const p of (deps && deps.projects) || []) depProjects.set(p.id, p);
  } catch (err) {
    list.textContent = "";
    list.appendChild(el("div", "vpick-empty", friendlyError(err.message)));
    return done;
  }
  if (handle.closed) return done;
  list.textContent = "";
  if (!versions.length) {
    list.appendChild(el("div", "vpick-empty", `${title || "This mod"} has no version for Minecraft ${inst.mcVersion} on ${loaderLabel(inst)}.`));
    return done;
  }

  const paintDeps = async (version) => {
    depsBox.textContent = "";
    depsBox.appendChild(el("h4", null, `What ${version.version_number} needs`));
    const deps = (version.dependencies || []).filter((d) => d.project_id);
    if (!deps.length) {
      depsBox.appendChild(el("div", "vpick-empty", "Nothing else. This version stands on its own."));
      return;
    }
    // Names come from the project's dependency list; anything missing
    // from it (rare) is looked up once.
    for (const d of deps) {
      if (depProjects.has(d.project_id)) continue;
      try {
        depProjects.set(d.project_id, await window.reminth.getCatalogProject(d.project_id));
      } catch {
        /* shown by id */
      }
    }
    if (chosen !== version) return; // selection moved on while looking up
    const order = { required: 0, optional: 1, embedded: 2, incompatible: 3 };
    deps.sort((a, b) => (order[a.dependency_type] ?? 9) - (order[b.dependency_type] ?? 9));
    for (const d of deps) {
      const p = depProjects.get(d.project_id);
      const row = el("div", "vpick-dep");
      row.appendChild(el("b", null, (p && p.title) || d.project_id));
      row.appendChild(el("span", "tag " + (d.dependency_type === "required" ? "cyan" : d.dependency_type === "incompatible" ? "rose" : "dim"), DEP_LABELS[d.dependency_type] || d.dependency_type));
      let state;
      if (d.dependency_type === "incompatible") state = have.has(d.project_id) ? "Installed — they clash" : "Not installed";
      else if (d.dependency_type === "embedded") state = "Comes inside the mod";
      else if (have.has(d.project_id)) state = "Already installed";
      else state = d.dependency_type === "required" ? "Will be installed too" : "Not installed (optional)";
      row.appendChild(el("span", "vpick-dep-state" + (state === "Will be installed too" ? " add" : ""), state));
      depsBox.appendChild(row);
    }
  };

  const suggested = defaultVersion(versions);
  const select = (version, item) => {
    chosen = version;
    list.querySelectorAll(".pick-item").forEach((x) => x.classList.toggle("selected", x === item));
    installBtn.disabled = false;
    paintDeps(version);
  };
  for (const v of versions) {
    const item = el("button", "pick-item vpick-item");
    item.type = "button";
    const main = el("div", "vpick-main");
    const name = el("b", null, v.version_number || v.name);
    main.appendChild(name);
    const mc = v.game_versions || [];
    main.appendChild(el("span", null, `MC ${mc.length > 3 ? mc.slice(0, 3).join(", ") + ` +${mc.length - 3}` : mc.join(", ")} · ${(v.loaders || []).map((l) => LOADER_LABELS[l] || l).join(", ")} · ${formatRelativeTime(v.date_published)}`));
    item.appendChild(main);
    const tags = el("div", "vpick-tags");
    if (v === suggested) tags.appendChild(el("span", "tag emerald", "Default"));
    tags.appendChild(el("span", "tag " + ({ release: "cyan", beta: "amber", alpha: "rose" }[v.version_type] || "dim"), v.version_type));
    item.appendChild(tags);
    item.onclick = () => select(v, item);
    list.appendChild(item);
    if (v === suggested) select(v, item);
  }
  return done;
}

/* ================================================================== *
 * 2. home "Discover mods" - flat single-colour icons, box painted     *
 *    in the icon's own colour                                         *
 * ================================================================== */
const DISCOVER_MODS = [
  { name: "Sodium", slug: "sodium", id: "AANobbMI", cat: "Performance", note: "Rewrites the renderer for a big FPS jump." },
  { name: "Lithium", slug: "lithium", id: "gvQqBUqZ", cat: "Performance", note: "Optimises game logic without changing how it plays." },
  { name: "Mod Menu", slug: "modmenu", id: "mOgUt4GM", cat: "Utility", note: "See and configure your mods from the title screen." },
  { name: "Simple Voice Chat", slug: "simple-voice-chat", id: "9eGKb6K1", cat: "Social", note: "Proximity voice chat on servers that run it." },
  { name: "Zoomify", slug: "zoomify", id: "w7ThoJFB", cat: "Utility", note: "A smooth zoom key, like a spyglass you never have to hold." },
  { name: "Reese's Sodium Options", slug: "reeses-sodium-options", id: "Bh37bMuy", cat: "Utility", note: "A cleaner, tabbed video settings screen for Sodium." },
  { name: "Better Statistics Screen", slug: "better-stats", id: "n6PXGAoM", cat: "Utility", note: "Stats you can actually search, sort and read." },
  { name: "Better Mount HUD", slug: "better-mount-hud", id: "kqJFAPU9", cat: "Utility", note: "Your horse's health and jump bar without hiding your own." },
];
const iconColourCache = new Map();

/** Samples an icon's left + right edges into a vertical gradient, so the box around a flat icon is the icon's own colour. */
function iconEdgeGradient(url) {
  if (iconColourCache.has(url)) return iconColourCache.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const N = 32;
        const c = document.createElement("canvas");
        c.width = N;
        c.height = N;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, N, N);
        const d = ctx.getImageData(0, 0, N, N).data;
        const at = (x, y) => [d[(y * N + x) * 4], d[(y * N + x) * 4 + 1], d[(y * N + x) * 4 + 2], d[(y * N + x) * 4 + 3]];
        const stops = [];
        for (let i = 0; i <= 6; i++) {
          const y = Math.min(N - 1, Math.round((i / 6) * (N - 1)));
          const px = [at(0, y), at(1, y), at(N - 1, y), at(N - 2, y)].filter((q) => q[3] > 200);
          if (!px.length) return resolve(null); // transparent edges: not a flat tile, keep the default art
          const avg = [0, 1, 2].map((k) => Math.round(px.reduce((s, q) => s + q[k], 0) / px.length));
          stops.push(`rgb(${avg.join(",")}) ${Math.round((i / 6) * 100)}%`);
        }
        resolve(`linear-gradient(180deg, ${stops.join(", ")})`);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
  iconColourCache.set(url, p);
  return p;
}

function discoverCard(mod) {
  const card = el("div", "card dcard");
  card.style.setProperty("--mc", "var(--accent)");
  const art = el("div", "dcard-art");
  const src = safeIconUrl(mod.icon_url);
  if (src) {
    const img = el("img", "dcard-art-img");
    img.src = src;
    img.alt = "";
    art.appendChild(img);
    iconEdgeGradient(src).then((bg) => {
      if (bg) {
        art.classList.add("has-art");
        art.style.setProperty("--art-bg", bg);
      }
    });
  }
  // Top-right controls: + / check (opens the "which instance?" panel) and a bin
  // to remove it from the active instance.
  const ctl = el("div", "dcard-ctl");
  const add = el("button", "dcard-add");
  add.type = "button";
  add.dataset.project = mod.id;
  add.addEventListener("contextmenu", async (e) => {
    e.preventDefault();
    const inst = activeInstance(); // the instance at this click
    if (!inst) return;
    if (add.classList.contains("done")) return toast(`${mod.name} is already in ${inst.name}.`);
    if (await chooseModVersion({ projectId: mod.id, title: mod.name, instanceId: inst.id }, [add])) paintHomeCards();
  });
  add.onclick = (e) => {
    e.stopPropagation();
    pickInstanceFor({ id: mod.id, name: mod.name, type: "mod" }, add);
  };
  const del = el("button", "dcard-del");
  del.type = "button";
  del.hidden = true;
  del.appendChild(icon("#i-trash"));
  del.onclick = () => removeFromInstance(mod, activeInstance());
  ctl.appendChild(add);
  ctl.appendChild(del);
  homeCards.push({ mod, add, del });
  art.appendChild(ctl);
  card.appendChild(art);
  const body = el("div", "dcard-body");
  const head = el("div", "dcard-head");
  if (src) {
    const ico = el("img", "mcard-ico");
    ico.src = src;
    ico.alt = "";
    head.appendChild(ico);
  } else head.appendChild(el("div", "mcard-ico", mod.name.slice(0, 1)));
  const names = el("div");
  names.appendChild(el("div", "mcard-name", mod.name));
  names.appendChild(el("div", "mcard-cat", mod.cat));
  head.appendChild(names);
  body.appendChild(head);
  body.appendChild(el("p", null, mod.note));
  card.appendChild(body);
  return card;
}

/* ---- Home "Discover mods": which instances each card's mod is in ---- */
const homeCards = []; // { mod, add, del }
const freshAdds = new Set(); // `${instanceId}:${projectId}` added on this visit - green until you leave the page, then grey
let presence = new Map(); // instanceId -> Map(projectId -> content item)
let presenceLoading = null;
let cardMenu = null;

const PRESENCE_KINDS = ["mod", "resourcepack", "shader", "datapack"];

/** The content item (mod, pack, shader or datapack) for project `pid` in instance `instId`, or null. */
function itemFor(instId, pid) {
  if (instId === content.instanceId && content.data) {
    for (const kind of PRESENCE_KINDS) {
      const hit = (content.data[kind] || []).find((i) => i.projectId === pid || (creatorOf(i) && creatorOf(i).projectId === pid));
      if (hit) return hit;
    }
    return null;
  }
  const m = presence.get(instId);
  return (m && m.get(pid)) || null;
}

async function loadPresence() {
  if (presenceLoading) return presenceLoading;
  presenceLoading = (async () => {
    const next = new Map();
    for (const inst of state.instances || []) {
      let data = null;
      if (content.data && content.instanceId === inst.id) data = content.data;
      else {
        try {
          data = await window.reminth.content(inst.id);
        } catch {
          data = null;
        }
      }
      const m = new Map();
      for (const kind of PRESENCE_KINDS) for (const item of (data && data[kind]) || []) if (item.projectId) m.set(item.projectId, item);
      next.set(inst.id, m);
    }
    presence = next;
  })();
  try {
    await presenceLoading;
  } finally {
    presenceLoading = null;
  }
  paintHomeCards();
  if (cardMenu) renderCardMenu();
}
window.loadPresence = loadPresence;

function paintHomeCards() {
  const inst = activeInstance();
  for (const { mod, add, del } of homeCards) {
    const installed = Boolean(inst && itemFor(inst.id, mod.id));
    const fresh = installed && freshAdds.has(`${inst.id}:${mod.id}`);
    if (add.classList.contains("busy")) continue;
    add.classList.toggle("done", installed);
    add.classList.toggle("fresh", fresh);
    add.textContent = "";
    add.appendChild(icon(installed ? "#i-check" : "#i-plus"));
    const only = (state.instances || []).length === 1;
    add.title = installed
      ? only ? `Already in ${inst.name}` : `In ${inst.name} — click to add it to another instance`
      : `${only ? `Add to ${inst.name}` : "Choose which instance to add it to"} (right-click to choose a version)`;
    add.setAttribute("aria-label", `${mod.name}: ${add.title}`);
    del.hidden = !installed;
    del.title = inst ? `Remove from ${inst.name}` : "Remove";
  }
}

async function removeFromInstance(mod, inst) {
  if ((mod.type || "mod") === "mod" && modsLocked(inst.id)) return toast(`${inst.name} is running. ${MODS_LOCKED_LINE}`);
  if (!inst) return;
  closeCardMenu(); // the question that follows must not sit under the panel
  const item = itemFor(inst.id, mod.id);
  if (!item) return toast(`${mod.name} isn't in ${inst.name}.`);
  const ok = await confirmModal(`Remove ${mod.name} from ${inst.name}?`, "It goes to the Recycle Bin, so you can get it back if you change your mind.", "Remove", true);
  if (!ok) return;
  try {
    await window.reminth.removeContent(inst.id, itemRef(item));
    freshAdds.delete(`${inst.id}:${mod.id}`);
    toast(`${mod.name} removed from ${inst.name}.`);
  } catch (err) {
    toast(friendlyError(err.message));
  }
  await loadContent(state.activeId);
  await loadPresence();
}

/* the per-instance menu - a floating panel so the card doesn't clip it */
function closeCardMenu() {
  if (cardMenu) cardMenu.remove();
  cardMenu = null;
}
/**
 * The "which instance?" panel behind every + / Install button. `project`:
 * { id, name, type }. One instance and not installed yet → just installs.
 */
async function pickInstanceFor(project, anchor) {
  if (cardMenu && cardMenu.dataset.project === project.id && cardMenu._anchor === anchor) {
    // The second click of a double-click must not close what the first opened.
    if (performance.now() - cardMenu._openedAt < 350) return;
    return closeCardMenu();
  }
  const list = state.instances || [];
  if (list.length === 1 && !itemFor(list[0].id, project.id)) {
    closeCardMenu();
    const ok = await installProject({ projectId: project.id, projectType: project.type || "mod", title: project.name, instanceId: list[0].id }, [anchor]);
    if (ok) await loadPresence();
    return;
  }
  openCardMenu(project, anchor);
}
function openCardMenu(mod, anchor) {
  closeCardMenu();
  cardMenu = el("div", "dd-menu dcard-pop");
  cardMenu.dataset.project = mod.id;
  cardMenu._mod = mod;
  cardMenu._anchor = anchor;
  cardMenu._openedAt = performance.now();
  cardMenu.setAttribute("role", "dialog");
  cardMenu.setAttribute("aria-label", `Add ${mod.name} to an instance`);
  cardMenu.addEventListener("click", (e) => e.stopPropagation());
  document.body.appendChild(cardMenu);
  renderCardMenu();
  loadPresence();
}
function renderCardMenu() {
  if (!cardMenu) return;
  // The button it hangs off was redrawn (a new search, another page of results).
  if (!cardMenu._anchor.isConnected) return closeCardMenu();
  const mod = cardMenu._mod;
  const scrolled = cardMenu.scrollTop;
  cardMenu.textContent = "";
  const type = mod.type || "mod";
  cardMenu.appendChild(el("div", "dcp-title", `Add ${mod.name} to…`));
  // Instances the mod has a build for come first; the rest stay pickable
  // (the search hit can be out of date) but say why they may not work.
  const misfits = new Map((state.instances || []).map((i) => [i.id, modMisfit(mod, i)]));
  const rank = (i) => (i.loader === "vanilla" && (type === "mod" || type === "shader") ? 2 : misfits.get(i.id) ? 1 : 0);
  const ordered = [...(state.instances || [])].sort((a, b) => rank(a) - rank(b));
  for (const inst of ordered) {
    const row = el("div", "dcp-row" + (inst.id === state.activeId ? " current" : ""));
    const name = el("div", "dcp-name");
    name.appendChild(el("b", null, inst.name));
    name.title = inst.name;
    const sub = el("small", null, `${loaderLabel(inst)} ${inst.mcVersion}`);
    if (misfits.get(inst.id)) sub.appendChild(el("span", "dcp-misfit", ` · ${misfits.get(inst.id)}`));
    name.appendChild(sub);
    row.appendChild(name);
    const item = itemFor(inst.id, mod.id);
    const locked = type === "mod" && modsLocked(inst.id);
    if (locked) {
      // Its game is running: mods can't be added or removed until it closes.
      row.classList.add("locked");
      const na = el("span", "dcp-na", item ? "Installed · game running" : "Game running");
      na.title = MODS_LOCKED_LINE;
      row.appendChild(na);
    } else if (item) {
      const have = el("span", "dcp-have" + (freshAdds.has(`${inst.id}:${mod.id}`) ? " fresh" : ""));
      have.appendChild(icon("#i-check"));
      have.appendChild(document.createTextNode("Installed"));
      row.appendChild(have);
      const bin = el("button", "icon-btn danger dcp-bin");
      bin.type = "button";
      bin.title = `Remove from ${inst.name}`;
      bin.setAttribute("aria-label", bin.title);
      bin.appendChild(icon("#i-trash"));
      bin.onclick = () => removeFromInstance(mod, inst);
      row.appendChild(bin);
    } else if (inst.loader === "vanilla" && (type === "mod" || type === "shader")) {
      row.appendChild(el("span", "dcp-na", "Needs a mod loader"));
    } else {
      const go = el("button", "btn sm outline dcp-install");
      go.type = "button";
      go.appendChild(icon("#i-plus"));
      go.appendChild(el("span", null, "Install"));
      go.setAttribute("aria-label", `Install into ${inst.name}`);
      // Still in flight from a click before the panel was redrawn.
      if (pendingInstalls.has(`${inst.id}:${mod.id}`)) {
        go.disabled = true;
        go.classList.add("busy");
        pendingInstalls.get(`${inst.id}:${mod.id}`).buttons.add(go);
      }
      go.onclick = async () => {
        // `inst` is this row's instance, whichever one is active by now.
        // The button that opened the panel shows progress too when it's for the active instance.
        const btns = inst.id === state.activeId && cardMenu && cardMenu._anchor ? [go, cardMenu._anchor] : [go];
        const ok = await installProject({ projectId: mod.id, projectType: type, title: mod.name, instanceId: inst.id }, btns);
        if (ok) await loadPresence();
      };
      row.appendChild(go);
    }
    cardMenu.appendChild(row);
  }
  cardMenu.style.display = "flex";
  placeCardMenu();
  cardMenu.scrollTop = scrolled;
}

/** Keeps the panel inside the window: below its button, or above it when there's more room there; scrolls inside when long. */
function placeCardMenu() {
  if (!cardMenu) return;
  const gap = 6;
  const edge = 8;
  const r = cardMenu._anchor.getBoundingClientRect();
  // Never over the instance rail on the left.
  const rail = document.querySelector(".rail");
  const minLeft = (rail ? rail.getBoundingClientRect().right : 0) + edge;
  const below = window.innerHeight - r.bottom - gap - edge;
  const above = r.top - gap - edge;
  cardMenu.style.maxHeight = "";
  const wanted = cardMenu.offsetHeight;
  const up = wanted > below && above > below;
  cardMenu.style.maxHeight = Math.max(120, Math.min(wanted, up ? above : below)) + "px";
  const w = cardMenu.offsetWidth;
  const h = cardMenu.offsetHeight;
  cardMenu.style.left = Math.max(minLeft, Math.min(window.innerWidth - w - edge, r.right - w)) + "px";
  cardMenu.style.top = Math.max(edge, Math.min(window.innerHeight - h - edge, up ? r.top - gap - h : r.bottom + gap)) + "px";
}
document.addEventListener("click", closeCardMenu);
$("pages").addEventListener("scroll", () => {
  // A scroll still settling from before the click must not close the panel it just opened.
  if (cardMenu && performance.now() - cardMenu._openedAt < 350) return placeCardMenu();
  closeCardMenu();
}, { passive: true });
window.addEventListener("resize", closeCardMenu);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !cardMenu) return;
  const anchor = cardMenu._anchor;
  closeCardMenu();
  if (anchor && anchor.isConnected) anchor.focus();
});
// A dialog opening puts the panel away, so it never sits on top of it.
window.onModalOpen = closeCardMenu;

// Leaving the page turns this visit's green checks grey for good.
document.addEventListener("reminth:page", (e) => {
  closeCardMenu();
  if (freshAdds.size) {
    freshAdds.clear();
    refreshInstalledMarks();
  }
  if (e.detail === "home") loadPresence();
});

async function buildDiscover() {
  const grid = $("discoverGrid");
  let found = {};
  try {
    found = await window.reminth.catalogBySlugs("mod", DISCOVER_MODS.map((m) => m.slug));
  } catch {
    found = {};
  }
  // Anything the local catalog doesn't have yet is looked up live, once.
  for (const mod of DISCOVER_MODS) {
    if (found[mod.slug] && found[mod.slug].icon_url) continue;
    try {
      const p = await window.reminth.getCatalogProject(mod.slug);
      if (p && p.icon_url) found[mod.slug] = { id: p.id, icon_url: p.icon_url };
    } catch {
      // offline - the card keeps its drawn art
    }
  }
  grid.textContent = "";
  homeCards.length = 0; // cards are rebuilt from scratch below
  for (const mod of DISCOVER_MODS) {
    const hit = found[mod.slug];
    grid.appendChild(discoverCard({ ...mod, id: (hit && hit.id) || mod.id, icon_url: hit && hit.icon_url }));
  }
  refreshInstalledMarks();
}

function refreshInstalledMarks() {
  paintHomeCards();
  const ids = installedProjectIds();
  document.querySelectorAll("[data-project]").forEach((b) => {
    const installed = ids.has(b.dataset.project);
    if (b.classList.contains("dcard-add")) {
      // painted by paintHomeCards() below
    } else if (b.dataset.installable === "1") paintInstallButton(b, installed);
  });
}

/** What an Install button does when pressed: with two or more instances it asks which one. */
function installTip(installed) {
  const list = state.instances || [];
  if (list.length !== 1) return "Choose which instance to add it to";
  return installed ? `Already in ${list[0].name}` : `Add to ${list[0].name}`;
}

/** Install button in a Discover row: + Install → ✓ Installed (green this visit, grey after). */
function paintInstallButton(b, installed) {
  if (b.classList.contains("busy")) return;
  b.classList.toggle("installed", installed);
  b.classList.toggle("fresh", installed && freshAdds.has(`${state.activeId}:${b.dataset.project}`));
  const label = b.querySelector("span");
  if (label) label.textContent = installed ? "Installed" : "Install";
  b.title = installTip(installed);
  const want = installed ? "#i-check" : "#i-plus";
  const svg = b.querySelector("svg");
  if (svg && svg.querySelector("use").getAttribute("href") !== want) svg.replaceWith(icon(want));
}

/* ================================================================== *
 * 3. Discover                                                         *
 * ================================================================== */
const DTYPES = {
  modpack: { label: "modpacks", search: "Search modpacks…", tagType: "modpack" },
  mod: { label: "mods", search: "Search mods…", tagType: "mod" },
  resourcepack: { label: "resource packs", search: "Search resource packs…", tagType: "resourcepack" },
  datapack: { label: "data packs", search: "Search data packs…", tagType: "mod" },
  shader: { label: "shaders", search: "Search shaders…", tagType: "shader" },
  server: { label: "servers", search: "Search servers…", tagType: "minecraft_java_server" },
};
const PROJECT_SORTS = [
  { value: "relevance", label: "Relevance" },
  { value: "downloads", label: "Downloads" },
  { value: "follows", label: "Followers" },
  { value: "newest", label: "Newest" },
  { value: "updated", label: "Recently updated" },
];
const SERVER_SORTS = [
  { value: "popular", label: "Most played" },
  { value: "players", label: "Players online" },
  { value: "newest", label: "Newest" },
  { value: "updated", label: "Recently updated" },
  { value: "follows", label: "Followers" },
];
const VIEW_SIZES = [{ value: 20, label: "20" }, { value: 50, label: "50" }, { value: 100, label: "100" }];

const disc = {
  type: "mod",
  query: "",
  sort: "relevance",
  view: 20,
  page: 1,
  filters: { categories: new Set(), gameVersion: "", environment: "", openSource: false, compatible: true, packLoader: "", onlineOnly: false },
  tags: null,
  total: 0,
  requestId: 0,
  pings: new Map(),
};

let sortDd = null;
const viewDd = makeDropdown($("browseViewDd"), {
  options: VIEW_SIZES,
  value: 20,
  prefix: "View:",
  onChange: (v) => {
    disc.view = v;
    disc.page = 1;
    runBrowse();
  },
});
void viewDd;

function buildSortDd() {
  const options = disc.type === "server" ? SERVER_SORTS : PROJECT_SORTS;
  if (!options.some((o) => o.value === disc.sort)) disc.sort = options[0].value;
  sortDd = makeDropdown($("browseSortDd"), {
    options,
    value: disc.sort,
    prefix: "Sort by:",
    onChange: (v) => {
      disc.sort = v;
      disc.page = 1;
      runBrowse();
    },
  });
}

document.querySelectorAll("#browseTabs .tab").forEach((b) => {
  b.onclick = () => setDiscoverType(b.dataset.type);
});

let browseTimer = null;

function setDiscoverType(type) {
  if (!DTYPES[type]) return;
  // A search still waiting out its typing delay belongs to the tab being
  // left; let it fire and it searches the new tab for text the (now empty)
  // box no longer shows.
  clearTimeout(browseTimer);
  disc.type = type;
  disc.page = 1;
  disc.query = "";
  disc.filters.categories = new Set();
  disc.filters.gameVersion = "";
  disc.filters.environment = "";
  disc.filters.openSource = false;
  disc.filters.onlineOnly = false;
  disc.filters.compatible = type !== "modpack";
  $("browseSearch").value = "";
  $("browseSearch").placeholder = DTYPES[type].search;
  document.querySelectorAll("#browseTabs .tab").forEach((b) => b.classList.toggle("active", b.dataset.type === type));
  buildSortDd();
  renderFilterPanel();
  runBrowse();
}

$("browseSearch").addEventListener("input", (e) => {
  clearTimeout(browseTimer);
  const value = e.target.value;
  browseTimer = setTimeout(() => {
    // Only spaces is not a search.
    const query = value.trim() ? value : "";
    if (query === disc.query) return;
    disc.query = query;
    disc.page = 1;
    // Typing a search switches to "relevance" the way every store does.
    if (value.trim() && disc.type !== "server" && disc.sort === "downloads") {
      disc.sort = "relevance";
      sortDd.set("relevance");
    }
    runBrowse();
  }, 300);
});

async function loadTags() {
  if (disc.tags) return disc.tags;
  try {
    disc.tags = await window.reminth.getCatalogTags("category");
  } catch {
    // Not kept: one failed request (offline at that moment) used to hide the
    // category filters until Reminth was restarted. Asked for again next time.
    return [];
  }
  return disc.tags;
}

const HEADER_LABELS = {
  categories: "Categories",
  features: "Features",
  resolutions: "Resolution",
  "performance impact": "Performance impact",
  minecraft_server_gameplay: "Gameplay",
  minecraft_server_features: "Features",
  minecraft_server_community: "Community",
  minecraft_server_meta: "Server type",
};
const prettyTag = (name) => name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bPvp\b/, "PvP").replace(/\bPve\b/, "PvE").replace(/\bSmp\b/, "SMP").replace(/\bMmo\b/, "MMO").replace(/\bRpg\b/, "RPG").replace(/\bOp\b/, "OP").replace(/\bKitpvp\b/, "Kit PvP");

function fpSection(title, bodyNodes, collapsed) {
  const s = el("div", "fp-section" + (collapsed ? " collapsed" : ""));
  const h = el("button", "fp-head");
  h.type = "button";
  h.appendChild(el("span", null, title));
  h.appendChild(icon("#i-chevron"));
  h.onclick = () => s.classList.toggle("collapsed");
  s.appendChild(h);
  const b = el("div", "fp-body");
  bodyNodes.forEach((n) => b.appendChild(n));
  s.appendChild(b);
  return s;
}

function fpOption(label, on, onClick) {
  const o = el("button", "fp-opt" + (on ? " on" : ""));
  o.type = "button";
  o.appendChild(el("span", "box"));
  o.appendChild(el("span", null, label));
  o.onclick = () => {
    onClick();
    o.classList.toggle("on");
  };
  return o;
}

function fpPills(options, value, onChange) {
  const row = el("div", "fp-pills");
  for (const [v, label] of options) {
    const b = el("button", "vp-type" + (v === value ? " on" : ""), label);
    b.type = "button";
    b.onclick = () => {
      row.querySelectorAll(".vp-type").forEach((n) => n.classList.remove("on"));
      b.classList.add("on");
      onChange(v);
    };
    row.appendChild(b);
  }
  return row;
}

function fpToggle(label, on, onChange) {
  const row = el("div", "fp-toggle");
  row.appendChild(el("span", null, label));
  const sw = el("button", "switch" + (on ? " on" : ""));
  sw.type = "button";
  sw.onclick = () => {
    sw.classList.toggle("on");
    onChange(sw.classList.contains("on"));
  };
  row.appendChild(sw);
  return row;
}

function filtersChanged() {
  disc.page = 1;
  renderActiveFilters();
  runBrowse();
}

let filterPanelToken = 0;
async function renderFilterPanel() {
  // Every call empties the panel and then fills it in across awaits; an
  // older call that is still going must stop, or its sections land in the
  // newer call's panel as duplicates.
  const token = ++filterPanelToken;
  const panel = $("filterPanel");
  panel.textContent = "";
  const type = disc.type;
  const inst = activeInstance();
  const f = disc.filters;

  if (type !== "modpack" && type !== "server" && inst) {
    // The note follows the switch (it used to keep saying "Only showing…"
    // after the switch was turned off, until the panel was next rebuilt).
    const noteText = (on) => (on ? `Only showing ${DTYPES[type].label} for ${loaderLabel(inst)} ${inst.mcVersion}.` : "Showing everything — some of it may not run on this instance.");
    const note = el("div", "fp-note", noteText(f.compatible));
    const nodes = [
      fpToggle(`Works with ${inst.name}`, f.compatible, (on) => {
        f.compatible = on;
        note.textContent = noteText(on);
        filtersChanged();
      }),
      note,
    ];
    panel.appendChild(fpSection("Your instance", nodes));
  }
  if (type === "modpack") {
    panel.appendChild(
      fpSection("Loader", [
        fpPills(
          [["", "Any"], ["fabric", "Fabric"], ["quilt", "Quilt"], ["forge", "Forge"], ["neoforge", "NeoForge"]],
          f.packLoader,
          (v) => {
            f.packLoader = v;
            filtersChanged();
          }
        ),
        el("div", "fp-note", "Reminth installs packs for every loader — each gets its own instance with the right version set up."),
      ])
    );
  }
  if (type === "server") {
    panel.appendChild(
      fpSection("Status", [
        fpToggle("Online right now", f.onlineOnly, (on) => {
          f.onlineOnly = on;
          filtersChanged();
        }),
      ])
    );
  }

  const tags = (await loadTags()).filter((t) => t.project_type === DTYPES[type].tagType);
  if (token !== filterPanelToken) return; // a newer render took over while tags loaded
  const byHeader = new Map();
  for (const t of tags) {
    if (["fabric", "forge", "neoforge", "quilt", "iris", "optifine", "canvas", "vanilla", "datapack", "minecraft", "liteloader", "modloader", "rift"].includes(t.name)) continue;
    if (!byHeader.has(t.header)) byHeader.set(t.header, []);
    byHeader.get(t.header).push(t);
  }
  let first = true;
  for (const [header, list] of byHeader) {
    const opts = list
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) =>
        fpOption(prettyTag(t.name), f.categories.has(t.name), () => {
          if (f.categories.has(t.name)) f.categories.delete(t.name);
          else f.categories.add(t.name);
          filtersChanged();
        })
      );
    panel.appendChild(fpSection(HEADER_LABELS[header] || prettyTag(header), opts, !first && list.length > 12));
    first = false;
  }

  if (type !== "server") {
    const sel = el("select", "fp-select");
    const addOpt = (value, label) => {
      const o = el("option", null, label);
      o.value = value;
      sel.appendChild(o);
    };
    addOpt("", "Any version");
    try {
      const v = await getVersions();
      v.versions.filter((x) => x.type === "release").forEach((x) => addOpt(x.id, x.id));
    } catch {
      // version list unavailable - "Any version" only
    }
    if (token !== filterPanelToken) return;
    sel.value = f.gameVersion;
    sel.onchange = () => {
      f.gameVersion = sel.value;
      filtersChanged();
    };
    panel.appendChild(fpSection("Game version", [sel, el("div", "fp-note", f.compatible && type !== "modpack" ? "Overridden by “Works with your instance” while that's on." : "")], type !== "modpack"));
  }
  if (type === "modpack" || type === "mod") {
    panel.appendChild(
      fpSection(
        "Environment",
        [
          ["client", "Client"],
          ["server", "Server"],
        ].map(([value, label]) =>
          fpOption(label, f.environment === value, () => {
            f.environment = f.environment === value ? "" : value;
            filtersChanged();
            renderFilterPanel();
          })
        )
      )
    );
  }
  if (type !== "server") {
    panel.appendChild(
      fpSection("License", [
        fpOption("Open source", f.openSource, () => {
          f.openSource = !f.openSource;
          filtersChanged();
        }),
      ])
    );
  }
  renderActiveFilters();
}

function renderActiveFilters() {
  const box = $("activeFilters");
  box.textContent = "";
  const f = disc.filters;
  const chip = (label, clear) => {
    const c = el("button", "filter-chip");
    c.type = "button";
    c.appendChild(icon("#i-x"));
    c.appendChild(el("span", null, label));
    c.onclick = () => {
      clear();
      filtersChanged();
      renderFilterPanel();
    };
    box.appendChild(c);
  };
  f.categories.forEach((c) => chip(prettyTag(c), () => f.categories.delete(c)));
  if (f.gameVersion) chip(f.gameVersion, () => (f.gameVersion = ""));
  if (f.environment) chip(f.environment === "client" ? "Client" : "Server", () => (f.environment = ""));
  if (f.openSource) chip("Open source", () => (f.openSource = false));
  if (f.onlineOnly) chip("Online", () => (f.onlineOnly = false));
}

function searchParamsFor() {
  const inst = activeInstance();
  const f = disc.filters;
  const type = disc.type;
  const params = {
    projectType: type,
    query: disc.query,
    index: disc.sort,
    offset: (disc.page - 1) * disc.view,
    limit: disc.view,
    categories: [...f.categories],
    environment: f.environment || undefined,
    openSource: f.openSource || undefined,
  };
  if (type !== "modpack" && f.compatible && inst) {
    params.gameVersions = [inst.mcVersion];
    if (type === "mod") {
      // No loader (vanilla) must match nothing; an empty list would mean
      // "any loader" to the search and show every mod.
      const loaders = modLoadersFor(inst);
      params.loaders = loaders.length ? loaders : ["__none__"];
    }
    if (type === "shader") params.loaders = ["iris", "optifine"];
  } else if (f.gameVersion) {
    params.gameVersions = [f.gameVersion];
  }
  if (type === "modpack" && f.packLoader) params.loaders = [f.packLoader];
  return params;
}

function isDefaultView() {
  const f = disc.filters;
  return (
    !disc.query.trim() &&
    !f.categories.size &&
    !f.gameVersion &&
    !f.environment &&
    !f.openSource &&
    (disc.sort === "downloads" || disc.sort === "relevance") &&
    !(disc.type !== "modpack" && f.compatible) &&
    !(disc.type === "modpack" && f.packLoader)
  );
}

async function runBrowse() {
  const grid = $("browseGrid");
  const reqId = ++disc.requestId;
  grid.classList.add("loading");
  if (disc.type === "server") return runServerBrowse(reqId);
  let hits = [];
  let total = 0;
  let offlineNote = null;
  try {
    if (isDefaultView()) {
      const r = await window.reminth.browseCachedCatalog({ projectType: disc.type, query: "", sort: "downloads", offset: (disc.page - 1) * disc.view, limit: disc.view });
      if (r.hits.length) {
        hits = r.hits.map((h) => ({ ...h, project_id: h.id }));
        total = r.total;
      } else {
        const live = await window.reminth.searchCatalog(searchParamsFor());
        hits = live.hits;
        total = live.total_hits;
      }
    } else {
      const live = await window.reminth.searchCatalog(searchParamsFor());
      hits = live.hits;
      total = live.total_hits;
    }
  } catch (err) {
    // Offline: fall back to the local cache, searched by text only.
    try {
      const r = await window.reminth.browseCachedCatalog({ projectType: disc.type, query: disc.query, sort: "downloads", offset: (disc.page - 1) * disc.view, limit: disc.view });
      hits = r.hits.map((h) => ({ ...h, project_id: h.id }));
      total = r.total;
      offlineNote = "Couldn't reach Modrinth — showing your saved catalog without filters.";
    } catch {
      hits = [];
      offlineNote = friendlyError(err.message);
    }
  }
  if (reqId !== disc.requestId) return;
  // Past the last page (the list got shorter: another instance, another
  // filter): back to page 1 instead of "nothing found" with no way back.
  if (!hits.length && disc.page > 1) {
    disc.page = 1;
    return runBrowse();
  }
  grid.classList.remove("loading");
  disc.total = Math.min(total, 10000);
  renderProjectRows(hits, offlineNote);
  renderPagers();
}

function pingClass(ms) {
  if (ms === null || ms === undefined) return "wait";
  return ms < 80 ? "good" : ms < 160 ? "ok" : "bad";
}

function projectRow(p) {
  const type = disc.type;
  const row = el("div", "card mod-row");
  row.style.setProperty("--mc", "var(--accent)");
  const src = safeIconUrl(p.icon_url);
  if (src) {
    const img = el("img", "mrow-ico");
    img.src = src;
    img.alt = "";
    img.loading = "lazy";
    img.addEventListener("error", () => img.replaceWith(el("div", "mrow-ico", (p.title || "?").slice(0, 1))));
    row.appendChild(img);
  } else row.appendChild(el("div", "mrow-ico", (p.title || "?").slice(0, 1)));

  const main = el("div", "mrow-main");
  const top = el("div", "mrow-top");
  top.appendChild(el("span", "mrow-name", p.title));
  if (p.author) top.appendChild(el("span", "mrow-by", "by " + p.author));
  main.appendChild(top);
  main.appendChild(el("p", "mrow-note", p.description || ""));
  const tags = el("div", "mrow-tags");
  const cats = p.display_categories || p.categories || [];
  const loaders = ["fabric", "forge", "neoforge", "quilt"].filter((l) => (p.categories || []).includes(l));
  if (type === "modpack" || type === "mod") {
    const env = p.client_side && p.server_side ? (p.server_side === "unsupported" ? "Client" : p.client_side === "unsupported" ? "Server" : "Client and server") : null;
    if (env) tags.appendChild(el("span", "tag dim", env));
  }
  cats.filter((c) => !["fabric", "forge", "neoforge", "quilt", "iris", "optifine", "canvas", "vanilla", "datapack", "minecraft"].includes(c)).slice(0, 4).forEach((c) => tags.appendChild(el("span", "tag dim", prettyTag(c))));
  loaders.forEach((l) => {
    const t = el("span", "tag " + ({ fabric: "cyan", quilt: "violet", forge: "amber", neoforge: "rose" }[l] || "dim"));
    t.appendChild(icon("#i-block"));
    t.appendChild(document.createTextNode(prettyTag(l)));
    tags.appendChild(t);
  });
  // From what the search hit already says: this mod won't go into the
  // instance installs are aimed at. (Only seen with "Works with…" off.)
  const fit = { id: p.project_id || p.id, name: p.title, type, versions: Array.isArray(p.versions) ? p.versions : null, loaders };
  const misfit = type === "mod" ? modMisfit(fit, activeInstance()) : null;
  if (misfit) {
    const t = el("span", "tag dim fit-hint", misfit.replace(/^n/, "N"));
    t.title = `${p.title}: ${misfit} — ${activeInstance().name} is ${loaderLabel(activeInstance())} ${activeInstance().mcVersion}`;
    tags.appendChild(t);
  }
  main.appendChild(tags);
  row.appendChild(main);

  const side = el("div", "mrow-side");
  const pid = p.project_id || p.id;
  const installed = installedProjectIds().has(pid);
  const btn = button("btn outline sm pill-like" + (installed ? " installed" : ""), type === "modpack" ? "Install" : installed ? "Installed" : "Install", installed ? "#i-check" : "#i-plus");
  btn.dataset.project = pid;
  if (type !== "modpack") {
    btn.dataset.installable = "1";
    btn.title = installTip(installed);
  }
  if (type === "modpack") {
    btn.onclick = () => installProject({ projectId: pid, projectType: type, title: p.title }, [btn]);
  } else {
    if (installed) paintInstallButton(btn, true);
    // Opens the "which instance?" panel (or installs straight away with only one instance).
    btn.onclick = (e) => {
      e.stopPropagation();
      pickInstanceFor(fit, btn);
    };
  }
  if (type === "mod") {
    // Install stays one click; the chevron is the optional "pick a version" path.
    const pick = el("button", "btn outline sm icon-only vpick-btn");
    pick.type = "button";
    pick.title = "Choose version…";
    pick.setAttribute("aria-label", `Choose a version of ${p.title}`);
    pick.appendChild(icon("#i-chevron"));
    // The instance the list is showing for, as it is at this click.
    pick.onclick = () => chooseModVersion({ projectId: pid, title: p.title, instanceId: state.activeId }, [btn]);
    const group = el("div", "install-group");
    group.appendChild(btn);
    group.appendChild(pick);
    side.appendChild(group);
  } else side.appendChild(btn);
  const stats = el("div", "mrow-stats");
  const stat = (iconId, text) => {
    const span = el("span");
    span.appendChild(icon(iconId));
    span.appendChild(document.createTextNode(text));
    return span;
  };
  if (formatCount(p.downloads)) stats.appendChild(stat("#i-download", formatCount(p.downloads)));
  stats.appendChild(stat("#i-heart", formatCount(p.follows) || "0"));
  stats.appendChild(stat("#i-clock", formatRelativeTime(p.date_modified)));
  side.appendChild(stats);
  row.appendChild(side);
  // The card itself opens the project's page - anywhere but its buttons.
  row.classList.add("openable");
  row.tabIndex = 0;
  row.setAttribute("role", "link");
  row.setAttribute("aria-label", `${p.title} - open its page`);
  const open = () => openProject(pid, { title: p.title, icon: src, author: p.author, summary: p.description, type });
  row.addEventListener("click", (e) => {
    if (e.target.closest("button, a, input, .dd-menu")) return;
    open();
  });
  row.addEventListener("keydown", (e) => {
    if (e.target !== row || e.key !== "Enter") return;
    e.preventDefault();
    open();
  });
  return row;
}

function renderProjectRows(hits, note) {
  const grid = $("browseGrid");
  grid.textContent = "";
  if (note) grid.appendChild(el("div", "notice violet", note));
  if (!hits.length) {
    const inst = activeInstance();
    const empty = el("div", "empty");
    empty.appendChild(el("b", null, disc.query ? "Nothing matches that search" : `No ${DTYPES[disc.type].label} found`));
    empty.appendChild(
      el(
        "span",
        null,
        note
          ? "Try again when you're back online."
          : disc.filters.compatible && disc.type !== "modpack" && inst
          ? `Nothing like that for ${loaderLabel(inst)} ${inst.mcVersion} yet. Turn off “Works with ${inst.name}” to see everything.`
          : "Try fewer filters or a different word."
      )
    );
    grid.appendChild(empty);
    return;
  }
  hits.forEach((h) => grid.appendChild(projectRow(h)));
}

function renderPagers() {
  const totalPages = Math.max(1, Math.ceil(disc.total / disc.view));
  const info = {
    page: disc.page,
    totalPages,
    onGoTo: (p) => {
      disc.page = p;
      runBrowse();
      $("pages").scrollTop = 0;
    },
  };
  buildPager("browsePager", info);
  buildPager("browsePagerTop", info, true);
}

function pageWindow(current, total) {
  const keep = new Set([1, total, current, current - 1, current + 1]);
  const pages = [...keep].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const p of pages) {
    if (prev && p - prev > 1) out.push("…");
    out.push(p);
    prev = p;
  }
  return out;
}

function buildPager(pagerId, info, compact) {
  const bar = $(pagerId);
  if (!bar) return;
  bar.textContent = "";
  if (!info || info.totalPages <= 1) return;
  const { page, totalPages, onGoTo } = info;
  const makeBtn = (label, target, opts = {}) => {
    const btn = el("button", "pager-btn" + (opts.active ? " active" : ""), label);
    btn.type = "button";
    btn.disabled = !!opts.disabled;
    if (!opts.disabled && !opts.active) btn.addEventListener("click", () => onGoTo(target));
    return btn;
  };
  if (!compact) bar.appendChild(makeBtn("‹ Prev", page - 1, { disabled: page <= 1 }));
  for (const p of pageWindow(page, totalPages)) {
    if (p === "…") bar.appendChild(el("span", "pager-gap", "…"));
    else bar.appendChild(makeBtn(String(p), p, { active: p === page }));
  }
  bar.appendChild(makeBtn(compact ? "›" : "Next ›", page + 1, { disabled: page >= totalPages }));
}

/* ---- servers ---- */
const REGION_LABELS = { us_east: "US East", us_west: "US West", us_central: "US Central", europe: "Europe", asia: "Asia", oceania: "Oceania", south_america: "South America", africa: "Africa", middle_east: "Middle East" };

async function runServerBrowse(reqId) {
  const grid = $("browseGrid");
  let result;
  try {
    result = await window.reminth.searchServers({
      query: disc.query,
      categories: [...disc.filters.categories],
      index: disc.sort,
      offset: (disc.page - 1) * disc.view,
      limit: disc.view,
    });
  } catch (err) {
    if (reqId !== disc.requestId) return;
    grid.classList.remove("loading");
    renderEmpty(grid, "Couldn't load servers", friendlyError(err.message));
    return;
  }
  if (reqId !== disc.requestId) return;
  if (!result.hits.length && disc.page > 1) {
    disc.page = 1;
    return runBrowse();
  }
  grid.classList.remove("loading");
  let hits = result.hits;
  if (disc.filters.onlineOnly) hits = hits.filter((h) => h.online);
  disc.total = Math.min(result.total, 10000);
  grid.textContent = "";
  if (!hits.length) {
    renderEmpty(grid, "No servers match that", "Try fewer filters or a different word.");
  } else {
    hits.forEach((h) => grid.appendChild(serverRow(h)));
    pingVisible(hits, reqId);
  }
  renderPagers();
}

async function pingVisible(hits, reqId) {
  const addrs = hits.filter((h) => h.address && !disc.pings.has(h.address)).map((h) => h.address);
  if (!addrs.length) return;
  let res = {};
  try {
    res = await window.reminth.pingServers(addrs);
  } catch {
    return;
  }
  for (const [addr, r] of Object.entries(res)) disc.pings.set(addr, r);
  if (reqId !== disc.requestId) return;
  document.querySelectorAll("[data-ping]").forEach((node) => {
    const r = disc.pings.get(node.dataset.ping);
    if (!r) return;
    paintPing(node, r);
  });
}

function paintPing(node, r) {
  const badge = node.querySelector(".ping-badge");
  const players = node.querySelector(".players");
  const dot = node.querySelector(".online-dot");
  if (r.online) {
    badge.className = "ping-badge " + pingClass(r.latencyMs);
    badge.textContent = `${r.latencyMs} ms`;
    badge.title = "Your ping to this server, measured from this PC";
    if (players && r.playersOnline !== null) players.textContent = formatNumber(r.playersOnline);
    dot.classList.remove("off");
  } else {
    badge.className = "ping-badge bad";
    badge.textContent = "Offline";
    badge.title = r.error || "No answer";
    dot.classList.add("off");
  }
}

function serverRow(s) {
  const row = el("div", "card mod-row");
  const src = safeIconUrl(s.icon_url);
  if (src) {
    const img = el("img", "mrow-ico");
    img.src = src;
    img.alt = "";
    img.loading = "lazy";
    img.addEventListener("error", () => img.replaceWith(el("div", "mrow-ico", (s.title || "?").slice(0, 1))));
    row.appendChild(img);
  } else row.appendChild(el("div", "mrow-ico", (s.title || "?").slice(0, 1)));
  const main = el("div", "mrow-main");
  const top = el("div", "mrow-top");
  top.appendChild(el("span", "mrow-name", s.title));
  main.appendChild(top);
  main.appendChild(el("p", "mrow-note", s.description || ""));
  const stats = el("div", "srv-stats");
  stats.dataset.ping = s.address || "";
  const online = el("span", "srv-stat");
  online.appendChild(el("span", "online-dot" + (s.online ? "" : " off")));
  online.appendChild(el("span", "players", s.playersOnline !== null ? formatNumber(s.playersOnline) : "—"));
  online.title = "Players online";
  stats.appendChild(online);
  const plays = el("span", "srv-stat");
  plays.title = "Plays in the last two weeks";
  plays.appendChild(icon("#i-play"));
  plays.appendChild(document.createTextNode(formatCount(s.plays2w) || "0"));
  stats.appendChild(plays);
  const cached = s.address ? disc.pings.get(s.address) : null;
  const badge = el("span", "ping-badge wait", s.modrinthPingMs !== null ? "…" : "…");
  stats.appendChild(badge);
  if (s.region) stats.appendChild(el("span", "tag dim", REGION_LABELS[s.region] || prettyTag(s.region)));
  // Which versions it takes, and whether the instance in use is one of them.
  const takes = serverTakes(s);
  if (takes.label) {
    const v = el("span", "tag dim srv-ver", takes.label);
    const all = sortedReleases(takes.list).reverse();
    v.title = all.length > 1 ? `Takes Minecraft ${all.join(", ")}` : `Runs Minecraft ${takes.label}`;
    stats.appendChild(v);
    const mine = activeInstance();
    if (s.content.kind !== "modpack" && instanceFitsServer(mine, s) === false) {
      const hint = el("span", "srv-note", `Not ${mine.mcVersion}`);
      hint.title = `${mine.name} is on ${mine.mcVersion} — this server takes ${takes.label}. Play still works: Reminth finds or makes an instance that fits.`;
      stats.appendChild(hint);
    }
  }
  (s.categories || []).slice(0, 3).forEach((c) => stats.appendChild(el("span", "tag dim", prettyTag(c))));
  if ((s.categories || []).length > 3) stats.appendChild(el("span", "tag dim", `+${s.categories.length - 3}`));
  if (s.content.kind === "modpack" && s.content.projectName) {
    const pack = el("span", "mrow-pack");
    pack.appendChild(icon("#i-library"));
    pack.appendChild(document.createTextNode(s.content.projectName));
    stats.appendChild(pack);
  }
  main.appendChild(stats);
  if (cached) paintPing(stats, cached);
  row.appendChild(main);

  const side = el("div", "mrow-side");
  const actions = el("div", "mrow-actions");
  const add = button("btn outline sm square", null, "#i-plus");
  // Named when hovered, so it's right even after the instance was switched.
  const addTip = () => `Add to ${activeInstance() ? activeInstance().name + "'s" : "your"} server list`;
  add.title = addTip();
  add.setAttribute("aria-label", "Add to server list");
  add.addEventListener("mouseenter", () => (add.title = addTip()));
  add.onclick = async () => {
    if (!s.address) return toast("This server hasn't published an address.");
    // The instance at this click; nothing below reads the active one again.
    const inst = activeInstance();
    if (!inst || add.disabled) return;
    add.disabled = true;
    try {
      const r = await window.reminth.addServer(inst.id, { name: s.title, address: s.address });
      // Still added - but say so when this instance can't actually join it.
      const cant = s.content.kind !== "modpack" && instanceFitsServer(inst, s) === false ? ` ${inst.name} is on ${inst.mcVersion} — this server takes ${serverTakes(s).label}.` : "";
      toast(r.added ? (cant ? `${s.title} added.${cant}` : `${s.title} added to ${inst.name}'s server list.`) : `${s.title} is already in that list.${cant}`);
    } catch (err) {
      toast(friendlyError(err.message));
    } finally {
      add.disabled = false;
    }
  };
  const play = button("btn sm play-btn", "Play", "#i-play");
  play.onclick = () => playServer(s, play);
  actions.appendChild(add);
  actions.appendChild(play);
  side.appendChild(actions);
  row.appendChild(side);
  return row;
}

function parseAddress(address) {
  const m = String(address || "").trim().match(/^([^:]+)(?::(\d+))?$/);
  return m ? { host: m[1], port: m[2] ? Number(m[2]) : 25565 } : null;
}

/**
 * Plays a server: finds (or makes) an instance that can join it, then
 * launches straight into it. Modpack servers get their pack installed.
 */
let playServerBusy = false;
async function playServer(s, btn) {
  // One at a time: a double-click used to open two confirm dialogs, make two
  // instances and launch twice. Covers the questions and the set-up; the
  // launch itself isn't waited for (runPlay has its own guard).
  if (playServerBusy) return;
  playServerBusy = true;
  btn.disabled = true;
  try {
    await prepareAndPlayServer(s);
  } finally {
    playServerBusy = false;
    btn.disabled = false;
  }
}

async function prepareAndPlayServer(s) {
  if (!state.signedIn) return toast("Sign in first.");
  const join = parseAddress(s.address);
  if (!join) return toast("This server hasn't published an address.");
  const c = s.content;
  if (c.kind === "modpack") {
    const existing = state.instances.find((i) => i.modpack && i.modpack.projectId === c.projectId);
    if (existing) return void runPlay({ instanceId: existing.id, join });
    await installModpackFlow({
      projectId: c.projectId,
      versionId: c.versionId,
      title: c.projectName || s.title,
      then: (inst) => runPlay({ instanceId: inst.id, join }),
    });
    return;
  }
  const supported = c.supportedVersions || [];
  const fits = (inst) => !supported.length || supported.includes(inst.mcVersion);
  const active = activeInstance();
  if (active && fits(active)) return void runPlay({ instanceId: active.id, join });
  const other = state.instances.find(fits);
  if (other) {
    const ok = await confirmModal(`Play ${s.title} on ${other.name}?`, `${s.title} runs ${supported.slice(0, 3).join(", ")}${supported.length > 3 ? "…" : ""}. ${other.name} (${other.mcVersion}) can join it.`, "Play");
    if (ok) runPlay({ instanceId: other.id, join });
    return;
  }
  const takes = serverTakes(s);
  const version = takes.version;
  if (!version) return toast("This server doesn't say which version it runs.");
  // The instance in use has mods: offer to bring them along instead of only
  // a bare vanilla instance.
  const modCount = active && active.loader !== "vanilla" ? await ownModCount(active) : 0;
  if (modCount > 0) {
    const choice = await chooseServerInstance(s, active, version, takes.label || version, modCount);
    if (!choice) return;
    if (choice === "copy") {
      // The advisor shows how many mods have a build for what the server
      // takes, makes the copy, then joins on it.
      await openVersionAdvisor(active.id, {
        open: false,
        server: { name: s.title, address: s.address, accepts: supported.length ? supported : [version], play: (inst) => runPlay({ instanceId: inst.id, join }) },
      });
      return;
    }
  } else {
    const ok = await confirmModal(
      `Make an instance for ${s.title}?`,
      [`${s.title} runs Minecraft ${version}, and none of your instances are on it. Reminth can make a vanilla ${version} instance and join straight away.`],
      "Create and play"
    );
    if (!ok) return;
  }
  try {
    const inst = await window.reminth.createInstance({ name: `${s.title}`.slice(0, 40), mcVersion: version, loader: "vanilla" });
    await loadInstances();
    await selectInstance(inst.id, false);
    runPlay({ instanceId: inst.id, join });
  } catch (err) {
    toast(friendlyError(err.message));
  }
}

/** "Showing what fits [instance ▾]" on Discover. Picking another instance makes it the
 *  active one, so the compatibility filter and the "Installed" marks follow it.
 *  It is NOT where Install puts things: with more than one instance, Install asks. */
function renderInstallTarget() {
  const box = $("discoverTargetDd");
  if (!box) return;
  const list = state.instances || [];
  if (!list.length) {
    box.textContent = "";
    return;
  }
  makeDropdown(box, {
    options: list.map((i) => {
      const what = `${loaderLabel(i)} ${i.mcVersion}`;
      return { value: i.id, label: i.name.toLowerCase().includes(String(i.mcVersion).toLowerCase()) ? i.name : `${i.name} · ${what}` };
    }),
    value: state.activeId,
    onChange: (id) => {
      selectInstance(id, false);
      const inst = instanceById(id);
      if (inst) toast(`Discover now shows what fits ${inst.name}.`);
    },
  });
}

pageHooks.discover = () => {
  const inst = activeInstance();
  const fit = inst ? `${inst.id}|${inst.name}|${inst.loader}|${inst.mcVersion}` : "";
  // Changed while Discover was closed: what's on screen is another instance's list.
  const stale = Boolean(sortDd) && fit !== disc.fit;
  disc.fit = fit;
  if (stale) {
    disc.page = 1;
    runBrowse();
  }
  renderInstallTarget();
  if (!sortDd) setDiscoverType(disc.type);
  else renderFilterPanel();
};

/* ================================================================== *
 * 4. logs                                                             *
 * ================================================================== */
const logState = { instanceId: null, sessions: [], current: null, data: null, show: new Set([0, 1, 2, 3, 4]), search: "", rows: [], listReq: 0, readReq: 0 };
const ROW_H = 20;

/** Forgets the open log: nothing of it left to scroll, filter or copy. */
function clearLogView(note) {
  logState.readReq++; // a read still in flight is for a log we no longer show
  logState.current = null;
  logState.data = null;
  logState.rows = [];
  for (const id of ["lcImportant", "lcError", "lcWarn", "lcChat", "lcInfo"]) $(id).textContent = "0";
  $("logMeta").textContent = note;
  $("logRows").textContent = "";
  $("logSpacer").style.height = "0px";
}

async function loadLogSessions() {
  const inst = activeInstance();
  if (!inst) return;
  const req = ++logState.listReq;
  const box = $("logSessions");
  // Session ids repeat across instances (every one has a "latest" log), so
  // what's open can't be carried over: it would show the last instance's lines.
  if (logState.instanceId !== inst.id) {
    logState.instanceId = inst.id;
    logState.sessions = [];
    clearLogView("");
  }
  box.textContent = "";
  box.appendChild(el("div", "fp-note", "Reading logs…"));
  let sessions;
  try {
    sessions = await window.reminth.logs(inst.id);
  } catch (err) {
    if (req !== logState.listReq) return;
    logState.sessions = [];
    box.textContent = "";
    box.appendChild(el("div", "fp-note", friendlyError(err.message)));
    return;
  }
  if (req !== logState.listReq) return; // a newer list (maybe another instance's) is on its way
  logState.sessions = sessions;
  box.textContent = "";
  if (!logState.sessions.length) {
    box.appendChild(el("div", "fp-note", "No logs yet. Play once and every session is kept here for good."));
    clearLogView("Nothing to show yet.");
    return;
  }
  for (const s of logState.sessions) {
    const b = el("button", "log-session" + (logState.current === s.id ? " active" : ""));
    b.type = "button";
    const d = new Date(s.date);
    b.appendChild(el("b", null, s.live ? "Latest session" : s.kind === "crash" ? "Crash report" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })));
    const meta = el("span");
    if (s.live) meta.appendChild(el("span", "live", "Live"));
    if (s.kind === "crash") meta.appendChild(el("span", "crash", d.toLocaleString()));
    else meta.appendChild(document.createTextNode(s.live ? d.toLocaleString() : s.name));
    if (s.counts && s.counts.important) meta.appendChild(el("span", "imp", `${s.counts.important} important`));
    b.appendChild(meta);
    b.onclick = () => openLog(s.id);
    box.appendChild(b);
  }
  // Always read it again: the live log has the same id every time but grows
  // while the game runs, so keeping what was read before shows old lines.
  openLog(logState.sessions.some((s) => s.id === logState.current) ? logState.current : logState.sessions[0].id);
}

async function openLog(id) {
  const instanceId = logState.instanceId;
  const req = ++logState.readReq;
  logState.current = id;
  document.querySelectorAll(".log-session").forEach((b, i) => b.classList.toggle("active", logState.sessions[i] && logState.sessions[i].id === id));
  $("logMeta").textContent = "Loading…";
  let data;
  try {
    data = await window.reminth.readLog(instanceId, id);
  } catch (err) {
    if (req !== logState.readReq) return;
    logState.data = null;
    $("logMeta").textContent = friendlyError(err.message);
    return;
  }
  // A slow read of a session picked earlier must not paint over this one.
  if (req !== logState.readReq) return;
  logState.data = data;
  const c = logState.data.counts;
  $("lcImportant").textContent = c.important;
  $("lcError").textContent = c.error;
  $("lcWarn").textContent = c.warn;
  $("lcChat").textContent = c.chat;
  $("lcInfo").textContent = c.info;
  filterLog();
}

function filterLog() {
  const d = logState.data;
  if (!d) return;
  const q = logState.search.trim().toLowerCase();
  const rows = [];
  for (let i = 0; i < d.lines.length; i++) {
    if (!logState.show.has(d.cats[i])) continue;
    if (q && !d.lines[i].toLowerCase().includes(q)) continue;
    rows.push(i);
  }
  logState.rows = rows;
  const session = logState.sessions.find((s) => s.id === logState.current);
  $("logMeta").textContent = `${session ? (session.live ? "latest.log" : session.name) : d.name} · ${rows.length.toLocaleString()} of ${d.lines.length.toLocaleString()} lines shown`;
  $("logSpacer").style.height = rows.length * ROW_H + "px";
  $("logView").scrollTop = 0;
  paintLogRows();
}

function paintLogRows() {
  const d = logState.data;
  const view = $("logView");
  const box = $("logRows");
  if (!d) return;
  const first = Math.max(0, Math.floor(view.scrollTop / ROW_H) - 10);
  const count = Math.ceil(view.clientHeight / ROW_H) + 20;
  box.style.transform = `translateY(${first * ROW_H}px)`;
  box.textContent = "";
  const q = logState.search.trim();
  for (const i of logState.rows.slice(first, first + count)) {
    const line = el("div", "log-line c" + d.cats[i]);
    line.appendChild(el("span", "ln", String(i + 1)));
    const text = d.lines[i];
    if (q) {
      const lower = text.toLowerCase();
      const ql = q.toLowerCase();
      let pos = 0;
      let at;
      while ((at = lower.indexOf(ql, pos)) !== -1) {
        line.appendChild(document.createTextNode(text.slice(pos, at)));
        line.appendChild(el("mark", null, text.slice(at, at + q.length)));
        pos = at + q.length;
      }
      line.appendChild(document.createTextNode(text.slice(pos)));
    } else line.appendChild(document.createTextNode(text));
    line.title = text;
    box.appendChild(line);
  }
}
$("logView").addEventListener("scroll", () => requestAnimationFrame(paintLogRows));
$("logSearch").addEventListener("input", (e) => {
  logState.search = e.target.value;
  clearTimeout(window._logSearch);
  window._logSearch = setTimeout(filterLog, 200);
});
document.querySelectorAll("#logFilters .log-chip").forEach((chip) => {
  chip.onclick = () => {
    const cat = Number(chip.dataset.cat);
    if (logState.show.has(cat)) logState.show.delete(cat);
    else logState.show.add(cat);
    paintLogFilters();
    filterLog();
  };
});
/** The chips and the "Only important" button, from what is actually shown. */
function paintLogFilters() {
  document.querySelectorAll("#logFilters .log-chip").forEach((c) => c.classList.toggle("active", logState.show.has(Number(c.dataset.cat))));
  const only = logState.show.size === 1 && logState.show.has(4);
  $("logOnlyImportant").lastChild.textContent = only ? "Show everything" : "Only important";
}
$("logOnlyImportant").onclick = () => {
  const only = logState.show.size === 1 && logState.show.has(4);
  logState.show = only ? new Set([0, 1, 2, 3, 4]) : new Set([4]);
  paintLogFilters();
  filterLog();
};
// "Hide personal info": the log is blurred until asked for, and again after leaving it.
$("logVeil").onclick = () => $("logVeil").parentElement.classList.add("revealed");
const veilLogs = () => $("logVeil").parentElement.classList.remove("revealed");
document.addEventListener("reminth:page", veilLogs);
$("logCopyBtn").onclick = async () => {
  const d = logState.data;
  if (!d || !logState.rows.length) return toast("Nothing to copy.");
  const session = logState.sessions.find((s) => s.id === logState.current);
  const inst = instanceById(logState.instanceId) || activeInstance();
  const header = [
    `Minecraft log — ${inst.name} (${loaderLabel(inst)} ${inst.mcVersion})`,
    `Session: ${session ? new Date(session.date).toLocaleString() : d.name} · file ${d.name} · fingerprint ${d.sha1}`,
    "",
  ];
  const body = logState.rows.slice(0, 5000).map((i) => d.lines[i]);
  try {
    await navigator.clipboard.writeText(header.concat(body).join("\n"));
    toast(`Copied ${body.length} line${body.length === 1 ? "" : "s"} — paste them into your ticket.`);
  } catch {
    toast("Couldn't reach the clipboard.");
  }
};

/* ================================================================== *
 * 5. skins                                                            *
 * ================================================================== */
const skins = { viewer: null, profile: null, library: [], defaults: null, profileLoaded: false, autoSaved: false, applying: false };

function currentSkinTexture() {
  const s = state.accountSkin;
  if (s && s.dataUrl) return { dataUrl: s.dataUrl, model: s.model || "classic" };
  return { dataUrl: fallbackSkinTexture(), model: (s && s.model) || "classic" };
}

/**
 * performance.mark/measure around one step of the Skins page, named
 * "skins:<name>" - read them in DevTools (Performance panel, or
 * performance.getEntriesByType("measure")). Cheap, and harmless if missing.
 */
async function skinsTimed(name, fn) {
  const has = typeof performance !== "undefined" && performance.mark;
  if (has) performance.mark(`skins:${name}:start`);
  try {
    return await fn();
  } finally {
    if (has) {
      performance.mark(`skins:${name}:end`);
      try {
        performance.measure(`skins:${name}`, `skins:${name}:start`, `skins:${name}:end`);
      } catch {
        // a mark went missing - only the number is lost
      }
    }
  }
}

function ensureViewer() {
  if (!skins.viewer) {
    if (typeof performance !== "undefined" && performance.mark) performance.mark("skins:viewer:start");
    skins.viewer = new SkinViewer($("skinViewport"), { scale: 10.5, yaw: -22 });
    // Built while another page shows (the idle warm-up): no frames until it's seen.
    if (currentPage !== "skins") skins.viewer.pause();
    if (typeof performance !== "undefined" && performance.mark) {
      performance.mark("skins:viewer:end");
      try {
        performance.measure("skins:viewer", "skins:viewer:start", "skins:viewer:end");
      } catch {
        // see skinsTimed
      }
    }
  }
  return skins.viewer;
}

window.onAccountSkin = (skin) => {
  const v = ensureViewer();
  // The model is only rebuilt when the skin really changed: rebuilding the
  // same one on every visit to the page was wasted work.
  const show = (dataUrl, model) => {
    const key = `${model}|${dataUrl}`;
    if (skins.shownKey === key) return;
    skins.shownKey = key;
    v.setSkin(dataUrl, model);
  };
  if (!state.signedIn) {
    $("skinName").textContent = "Not signed in";
    $("skinModel").textContent = "Sign in to change your skin";
    show(fallbackSkinTexture(), "classic");
    return;
  }
  const t = currentSkinTexture();
  show(t.dataUrl, t.model);
  $("skinName").textContent = state.username || "—";
  $("skinModel").textContent = skin && skin.dataUrl ? (skin.model === "slim" ? "Slim arms" : "Wide arms") : skin && skin.none ? "Default skin" : (skin && skin.error) || "—";
  // Keep the skin you're wearing in "Your skins", so changing it never loses it.
  if (skin && skin.dataUrl && !skins.autoSaved) {
    skins.autoSaved = true;
    window.reminth
      .skinLibrarySave({ dataUrl: skin.dataUrl, variant: skin.model, name: `${state.username}'s skin`, source: "account" })
      .then(() => loadSkinLibrary())
      .catch(() => {});
  }
};

async function loadSkinProfile() {
  return skinsTimed("profile", loadSkinProfileNow);
}
async function loadSkinProfileNow() {
  if (!state.signedIn) return;
  try {
    skins.profile = await window.reminth.skinProfile();
    const active = skins.profile.capes.find((c) => c.active && c.dataUrl);
    ensureViewer().setCape(active ? active.dataUrl : null);
  } catch {
    skins.profile = null;
  }
}

function skinTile({ dataUrl, variant, label, current, onClick, onRename, onDelete }) {
  const tile = el("div", "skin-tile" + (current ? " current" : ""));
  const vp = el("div");
  tile.appendChild(vp);
  const viewer = new SkinViewer(vp, { scale: 4.2, animate: false, interactive: false, yaw: -28, pitch: -6 });
  viewer.setSkin(dataUrl, variant);
  if (current) tile.appendChild(el("span", "current-badge", "Wearing"));
  // "<username>'s skin" is blurred with the rest of the personal info.
  tile.appendChild(el("span", "skin-label" + (state.username && String(label).includes(state.username) ? " pii" : ""), label));
  if (onRename || onDelete) {
    const actions = el("div", "tile-actions");
    const action = (title, iconId, fn, cls) => {
      const b = el("button", cls);
      b.type = "button";
      b.title = title;
      b.setAttribute("aria-label", `${title}: ${label}`);
      b.appendChild(icon(iconId));
      b.onclick = (e) => {
        e.stopPropagation();
        fn();
      };
      // Enter on this button is not Enter on the tile around it.
      b.addEventListener("keydown", (e) => e.stopPropagation());
      actions.appendChild(b);
    };
    if (onRename) action("Rename", "#i-edit", onRename);
    if (onDelete) action("Forget this skin", "#i-trash", onDelete, "danger");
    tile.appendChild(actions);
  }
  clickable(tile, onClick);
  tile.setAttribute("aria-label", `${label}${current ? ", wearing" : ""}`);
  return tile;
}

function addSkinTile() {
  const tile = el("div", "skin-tile add");
  tile.appendChild(icon("#i-upload"));
  tile.appendChild(el("b", null, "Add a skin"));
  tile.appendChild(el("span", null, "Drop a PNG here or click"));
  clickable(tile, () => $("skinFile").click());
  tile.addEventListener("dragover", (e) => {
    e.preventDefault();
    tile.classList.add("drag");
  });
  tile.addEventListener("dragleave", () => tile.classList.remove("drag"));
  tile.addEventListener("drop", (e) => {
    e.preventDefault();
    tile.classList.remove("drag");
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) readSkinFile(file);
  });
  return tile;
}

function readSkinFile(file) {
  if (!/png$/i.test(file.type) && !/\.png$/i.test(file.name)) return toast("Skins are PNG files.");
  if (file.size > 256 * 1024) return toast("That image is too big to be a skin.");
  const reader = new FileReader();
  reader.onload = async () => {
    // Checked here, not only when saving: a text file renamed .png, or a
    // picture of the wrong size, never gets as far as the editor.
    const problem = await skinImageProblem(reader.result);
    if (problem) return toast(problem);
    openSkinEditor({ dataUrl: reader.result, variant: "classic", name: file.name.replace(/\.png$/i, ""), source: "upload" });
  };
  reader.onerror = () => toast("Couldn't read that file.");
  reader.readAsDataURL(file);
}

/** Why a picture can't be a skin (Mojang takes 64×64, or the old 64×32), or null when it can. */
function skinImageProblem(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.width === 64 && (img.height === 64 || img.height === 32) ? null : `Skins have to be 64×64 or 64×32 pixels — that one is ${img.width}×${img.height}.`);
    img.onerror = () => resolve("That file isn't a PNG image.");
    img.src = dataUrl;
  });
}
$("skinFile").onchange = (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (file) readSkinFile(file);
};

async function loadSkinLibrary() {
  return skinsTimed("library", loadSkinLibraryNow);
}
async function loadSkinLibraryNow() {
  const grid = $("savedSkins");
  try {
    skins.library = await window.reminth.skinLibrary();
  } catch {
    skins.library = [];
  }
  // Every tile is its own 3D model (dozens of 3D-transformed elements), so
  // rebuilding them all on every visit was most of the cost of opening the
  // page. Only rebuild when something about them changed.
  const signature = JSON.stringify([state.username, state.privacy, skins.library.map((s) => [s.id, s.name, s.variant, s.lastUsed, (s.dataUrl || "").length])]);
  if (signature === skins.librarySig && grid.childNodes.length) return;
  skins.librarySig = signature;
  grid.textContent = "";
  grid.appendChild(addSkinTile());
  const wearingId = skins.library.find((s) => s.lastUsed) ? [...skins.library].sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0))[0].id : null;
  for (const s of skins.library) {
    grid.appendChild(
      skinTile({
        dataUrl: s.dataUrl,
        variant: s.variant,
        label: s.name,
        current: s.id === wearingId,
        onClick: () => openSkinEditor({ dataUrl: s.dataUrl, variant: s.variant, name: s.name, source: s.source }),
        onRename: () => renameSkinModal(s),
        onDelete: async () => {
          if (skins.applying) return toast("Wait for the skin that's being saved to finish first.");
          const wearing = s.id === wearingId;
          const ok = await confirmModal(
            `Forget ${s.name}?`,
            wearing ? "It's removed from Your skins and can't be brought back. You keep wearing it in game until you pick another." : "It's removed from Your skins and can't be brought back.",
            "Forget",
            true
          );
          if (!ok) return;
          if (skins.applying) return toast("Wait for the skin that's being saved to finish first.");
          try {
            await window.reminth.skinLibraryRemove(s.id);
            toast(`${s.name} forgotten.`);
          } catch (err) {
            toast(friendlyError(err.message));
          }
          loadSkinLibrary();
        },
      })
    );
  }
}

/** Rename a saved skin (skinLibrary.rename caps names at 40 characters). */
function renameSkinModal(s) {
  const body = el("div");
  const field = el("div", "field");
  field.appendChild(el("label", null, "Name"));
  const input = el("input");
  input.type = "text";
  input.maxLength = 40;
  input.value = s.name;
  field.appendChild(input);
  body.appendChild(field);
  const save = async () => {
    const name = input.value.trim();
    if (!name) {
      toast("Give it a name first.");
      return false;
    }
    try {
      await window.reminth.skinLibraryRename(s.id, name);
    } catch (err) {
      toast(friendlyError(err.message));
      return false;
    }
    loadSkinLibrary();
  };
  const handle = openModal({
    title: "Rename skin",
    body,
    buttons: [
      { label: "Cancel", className: "outline" },
      { label: "Rename", className: "primary", onClick: save },
    ],
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handle.buttons[1].click();
  });
  input.focus();
  input.select();
}

async function loadDefaultSkins() {
  return skinsTimed("defaults", loadDefaultSkinsNow);
}
async function loadDefaultSkinsNow() {
  const grid = $("defaultSkins");
  if (!skins.defaults) {
    try {
      skins.defaults = await window.reminth.skinDefaults();
    } catch (err) {
      skins.defaults = { skins: [], error: err.message };
    }
  }
  // Drawn once per answer - they never change while Reminth runs.
  if (skins.defaultsPainted === skins.defaults && grid.childNodes.length) return;
  skins.defaultsPainted = skins.defaults;
  grid.textContent = "";
  if (!skins.defaults.skins.length) {
    renderEmpty(grid, "Not available yet", skins.defaults.error || "Couldn't read the default skins.");
    return;
  }
  for (const d of skins.defaults.skins) {
    const variant = d.id === "alex" ? "slim" : "classic";
    grid.appendChild(
      skinTile({
        dataUrl: variant === "slim" ? d.slim || d.wide : d.wide || d.slim,
        variant,
        label: d.name,
        onClick: () => openSkinEditor({ dataUrl: variant === "slim" ? d.slim : d.wide, variant, name: d.name, source: "default", defaultSkin: d }),
      })
    );
  }
}

$("skinFetchBtn").onclick = async () => {
  const name = $("skinUser").value.trim();
  if (!name) return toast("Type a Minecraft username first.");
  $("skinFetchBtn").disabled = true;
  try {
    const r = await window.reminth.skinLookup(name);
    if (r.error) return toast(r.error);
    openSkinEditor({ dataUrl: r.dataUrl, variant: r.model, name: `${r.name || name}'s skin`, source: "username" });
  } catch (err) {
    toast(friendlyError(err.message));
  } finally {
    $("skinFetchBtn").disabled = false;
  }
};
$("skinUser").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("skinFetchBtn").click();
});

$("editSkinBtn").onclick = () => {
  if (!state.signedIn) return toast("Sign in to change your skin.");
  const t = currentSkinTexture();
  openSkinEditor({ dataUrl: t.dataUrl, variant: t.model, name: `${state.username}'s skin`, source: "account", isCurrent: true });
};

/** Draws the outside face of a cape (10×16 at 1,1 in a 64×32 texture) into a canvas. */
function capeCanvas(dataUrl) {
  const c = el("canvas");
  c.width = 10;
  c.height = 16;
  const img = new Image();
  img.onload = () => {
    const s = img.width / 64;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 1 * s, 1 * s, 10 * s, 16 * s, 0, 0, 10, 16);
  };
  img.src = dataUrl;
  return c;
}

/**
 * The "Editing skin" dialog: a live 3D preview on the left, texture, arm
 * style and cape on the right. Save applies it to the account for real.
 */
let skinEditorOpening = false;
async function openSkinEditor({ dataUrl, variant, name, source, defaultSkin, isCurrent }) {
  if (!state.signedIn) return toast("Sign in to change your skin.");
  // The profile is fetched before the dialog opens; a second click in that
  // gap used to open a second editor on top of the first.
  if (skinEditorOpening) return;
  const draft = { dataUrl, variant: variant === "slim" ? "slim" : "classic", name, source, capeId: undefined };
  if (!skins.profileLoaded) {
    skinEditorOpening = true;
    try {
      await loadSkinProfile();
    } finally {
      skinEditorOpening = false;
    }
    skins.profileLoaded = true;
  }
  const capes = (skins.profile && skins.profile.capes) || [];
  const activeCape = capes.find((c) => c.active) || null;

  const body = el("div", "edit-skin");
  const left = el("div");
  const vp = el("div");
  left.appendChild(vp);
  const hint = el("span", "hint-line");
  hint.appendChild(icon("#i-rotate"));
  hint.appendChild(document.createTextNode("Drag to rotate"));
  left.appendChild(hint);
  body.appendChild(left);
  const right = el("div");

  const texSec = el("div", "es-section");
  texSec.appendChild(el("h3", null, "Texture"));
  const replace = button("btn outline sm", "Replace texture", "#i-upload");
  const picker = el("input");
  picker.type = "file";
  picker.accept = "image/png";
  picker.hidden = true;
  replace.onclick = () => picker.click();
  texSec.appendChild(replace);
  texSec.appendChild(picker);
  right.appendChild(texSec);

  const armSec = el("div", "es-section");
  armSec.appendChild(el("h3", null, "Arm style"));
  const armRow = el("div", "radio-row");
  const armBtns = {};
  for (const [key, label] of [["classic", "Wide"], ["slim", "Slim"]]) {
    const b = el("button", "radio-pill" + (draft.variant === key ? " on" : ""), label);
    b.type = "button";
    b.onclick = () => {
      draft.variant = key;
      Object.entries(armBtns).forEach(([k, x]) => x.classList.toggle("on", k === key));
      // Default skins ship a matching texture for each arm style.
      if (defaultSkin) draft.dataUrl = key === "slim" ? defaultSkin.slim || draft.dataUrl : defaultSkin.wide || draft.dataUrl;
      viewer.setSkin(draft.dataUrl, key);
    };
    armBtns[key] = b;
    armRow.appendChild(b);
  }
  armSec.appendChild(armRow);
  right.appendChild(armSec);

  const capeSec = el("div", "es-section");
  capeSec.appendChild(el("h3", null, "Cape"));
  const capeGrid = el("div", "cape-grid");
  const capeBtns = [];
  const selectCape = (id) => {
    draft.capeId = id;
    capeBtns.forEach(([cid, b]) => b.classList.toggle("on", cid === id));
    const cape = capes.find((c) => c.id === id);
    viewer.setCape(cape ? cape.dataUrl : null);
  };
  const none = el("button", "cape-opt none" + (!activeCape ? " on" : ""));
  none.type = "button";
  none.appendChild(icon("#i-x"));
  none.appendChild(el("span", null, "None"));
  none.onclick = () => selectCape(null);
  capeBtns.push([null, none]);
  capeGrid.appendChild(none);
  for (const cape of capes) {
    const b = el("button", "cape-opt" + (cape.active ? " on" : ""));
    b.type = "button";
    b.title = cape.name;
    if (cape.dataUrl) b.appendChild(capeCanvas(cape.dataUrl));
    else b.textContent = cape.name.slice(0, 6);
    b.onclick = () => selectCape(cape.id);
    capeBtns.push([cape.id, b]);
    capeGrid.appendChild(b);
  }
  capeSec.appendChild(capeGrid);
  if (!capes.length) capeSec.appendChild(el("p", "set-note", skins.profile ? "This account doesn't own any capes." : "Couldn't load your capes right now."));
  right.appendChild(capeSec);
  body.appendChild(right);

  const viewer = new SkinViewer(vp, { scale: 8, yaw: -24 });
  viewer.setSkin(draft.dataUrl, draft.variant);
  if (activeCape && activeCape.dataUrl) viewer.setCape(activeCape.dataUrl);

  picker.onchange = () => {
    const file = picker.files && picker.files[0];
    picker.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const problem = await skinImageProblem(reader.result);
      if (problem) return toast(problem);
      draft.dataUrl = reader.result;
      draft.source = "upload";
      draft.name = file.name.replace(/\.png$/i, "");
      viewer.setSkin(draft.dataUrl, draft.variant);
    };
    reader.readAsDataURL(file);
  };

  // Saving talks to Mojang and can take a while: the dialog stays until it's done.
  let saving = false;
  openModal({
    title: "Editing skin",
    body,
    wide: true,
    canClose: () => !saving,
    onClose: () => viewer.destroy(),
    buttons: [
      { label: "Cancel", className: "outline", icon: "#i-x" },
      {
        label: "Save skin",
        className: "primary",
        icon: "#i-check",
        onClick: async (handle) => {
          if (saving) return false;
          if (draft.dataUrl === fallbackSkinTexture()) {
            toast("Pick a skin first — that's Reminth's placeholder figure.");
            return false;
          }
          saving = true;
          skins.applying = true;
          handle.buttons[0].disabled = true;
          try {
            await window.reminth.skinApply({ dataUrl: draft.dataUrl, variant: draft.variant, name: draft.name, source: draft.source, capeId: draft.capeId });
            toast("Skin saved to your account. Servers pick it up next time you join.");
            skins.profileLoaded = false;
            skins.autoSaved = true;
            await refreshSkin();
            await loadSkinProfile();
            skins.profileLoaded = true;
            loadSkinLibrary();
            return true;
          } catch (err) {
            if (signedOutByBackend(err)) return false; // it has closed this dialog and shown the sign-in card
            toast(friendlyError(err.message));
            if (/Skin changed, but the cape couldn't be set/.test(err.message)) {
              // The skin itself DID change - only the cape didn't. Show the
              // new skin everywhere and close, as after any other save.
              skins.profileLoaded = false;
              skins.autoSaved = true;
              await refreshSkin();
              await loadSkinProfile();
              skins.profileLoaded = true;
              loadSkinLibrary();
              return true;
            }
            return false;
          } finally {
            saving = false;
            skins.applying = false;
            handle.buttons[0].disabled = false;
          }
        },
      },
    ],
  });
  void isCurrent;
}

pageHooks.skins = () => {
  if (typeof performance !== "undefined" && performance.mark) performance.mark("skins:open");
  ensureViewer().resume();
  if (window.onAccountSkin) window.onAccountSkin(state.accountSkin); // rebuilds only if the skin changed
  // The lists start after the page's first frame has been drawn, not in the
  // same turn as the page switch.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (currentPage !== "skins") return;
      loadSkinProfile();
      loadSkinLibrary();
      loadDefaultSkins();
    })
  );
};

// Leaving the page: the big viewer stops asking for frames.
document.addEventListener("reminth:page", (e) => {
  if (e.detail !== "skins" && skins.viewer) skins.viewer.pause();
});

/**
 * Warm-up: a few seconds after the window has loaded, when the app is idle
 * and someone is signed in, build the viewer and both skin grids while the
 * page is hidden - so opening Skins mostly just shows them.
 */
function warmSkinsPage() {
  if (skins.warmStarted || !state.signedIn || currentPage === "skins") return;
  skins.warmStarted = true;
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
  idle(
    () =>
      skinsTimed("warm", async () => {
        if (currentPage === "skins") return;
        ensureViewer();
        if (window.onAccountSkin) window.onAccountSkin(state.accountSkin);
        await Promise.all([loadSkinLibrary(), loadDefaultSkins()]);
      }).catch(() => {}),
    { timeout: 5000 }
  );
}

/* ================================================================== *
 * 6. streamer mode                                                    *
 * ================================================================== */
const CLIP_LENGTHS = [
  [30, "30 seconds"],
  [60, "1 minute"],
  [120, "2 minutes"],
  [300, "5 minutes"],
  [600, "10 minutes"],
  [900, "15 minutes"],
  [1800, "30 minutes"],
];
const BITRATE_MBPS = { low: 3.5, medium: 6, high: 10 };
const streamerUi = { status: null, captures: [], filter: "all", listening: null };

function applyStreamerUi(settings, problems) {
  const on = Boolean(settings && settings.streamerMode);
  const cfg = (settings && settings.streamer) || {};
  $("streamerToggle").classList.toggle("on", on);
  $("streamerToggle").setAttribute("aria-pressed", on ? "true" : "false");
  $("streamerToggle").dataset.tip = on ? "Streamer mode: on — click to turn off" : "Streamer mode: off";
  $("railStreamer").hidden = !on;
  $("livePill").hidden = !on;
  const privacy = on && cfg.hidePersonalInfo !== false;
  if (privacy !== Boolean(state.privacy)) {
    state.privacy = privacy;
    document.body.classList.toggle("privacy", privacy);
    veilLogs();
    refreshSkin();
  }
  if (!on && (currentPage === "captures" || currentPage === "streamer")) switchPage("home");
  // settings page controls
  $("keyClip").textContent = cfg.clipKey || "Not set";
  $("keyShot").textContent = cfg.screenshotKey || "Not set";
  setSwitch("toggleAudio", cfg.audio !== false);
  setSwitch("toggleHideInfo", cfg.hidePersonalInfo !== false);
  setSwitch("toggleNotify", cfg.notify !== false);
  paintSeg("clipLengths", CLIP_LENGTHS, cfg.clipSeconds || 60, (v) => saveStreamer({ clipSeconds: v }));
  paintSeg("fpsChoice", [[30, "30 fps"], [60, "60 fps"]], cfg.fps || 60, (v) => saveStreamer({ fps: v }));
  paintSeg("qualityChoice", [["low", "Low"], ["medium", "Medium"], ["high", "High"]], cfg.quality || "high", (v) => saveStreamer({ quality: v }));
  const mb = ((BITRATE_MBPS[cfg.quality || "high"] + (cfg.audio !== false ? 0.16 : 0)) * (cfg.clipSeconds || 60)) / 8;
  $("bufferDisk").textContent = `While the game runs this keeps about ${mb >= 1000 ? (mb / 1024).toFixed(1) + " GB" : Math.round(mb) + " MB"} on disk, and deletes it as it goes. A saved clip is about that size too.`;
  const note = $("hotkeyNote");
  if (problems && problems.length) {
    note.hidden = false;
    note.textContent = problems.join(" · ") + " — pick a different key.";
  } else if (problems) note.hidden = true;
  paintLivePill();
}

function paintSeg(id, options, value, onPick) {
  const box = $(id);
  box.textContent = "";
  for (const [v, label] of options) {
    const b = el("button", v === value ? "on" : "", label);
    b.type = "button";
    b.onclick = () => onPick(v);
    box.appendChild(b);
  }
}

/**
 * One save at a time. Changes made while a save is running are collected and
 * sent together in the next one, on top of what that save returned - each
 * used to be built on the same stale copy, so the last to finish undid the
 * others.
 */
let streamerPatch = null;
let streamerSaves = Promise.resolve(true);
function saveStreamer(patch) {
  streamerPatch = { ...(streamerPatch || {}), ...patch };
  streamerSaves = streamerSaves.then(() => {
    if (!streamerPatch) return true; // already sent along with an earlier change
    const pending = streamerPatch;
    streamerPatch = null;
    const current = (state.settings && state.settings.streamer) || {};
    return saveSetting({ streamer: { ...current, ...pending } });
  });
  return streamerSaves;
}

window.onSettingsSaved = (settings, problems) => {
  applyStreamerUi(settings, problems);
  paintPerfSettings(settings); // streamer mode changes what "priority" can do
  if (currentPage === "settings") paintAutoMemory(); // the slider may have moved, or gone back to automatic
};

$("streamerToggle").onclick = async () => {
  const on = !(state.settings && state.settings.streamerMode);
  const ok = await saveSetting({ streamerMode: on });
  if (ok) {
    toast(on ? `Streamer mode on. ${state.settings.streamer.clipKey || "Your clip key"} saves the last ${CLIP_LENGTHS.find((c) => c[0] === state.settings.streamer.clipSeconds)?.[1] || "minute"}.` : "Streamer mode off.");
    if (on) switchPage("captures");
  }
};

for (const [id, key] of [["toggleAudio", "audio"], ["toggleHideInfo", "hidePersonalInfo"], ["toggleNotify", "notify"]]) {
  $(id).onclick = () => saveStreamer({ [key]: !$(id).classList.contains("on") });
}

/* hotkey capture: click the key button, press a key (Esc cancels, Backspace clears) */
/** Stops listening and puts every key button's own label back. */
function endKeyCapture() {
  streamerUi.listening = null;
  document.querySelectorAll(".key-btn").forEach((b) => b.classList.remove("listening"));
  applyStreamerUi(state.settings);
}
function cancelKeyCapture() {
  if (streamerUi.listening) endKeyCapture();
}
document.querySelectorAll(".key-btn").forEach((btn) => {
  btn.onclick = () => {
    // Ends a capture on the other button first, or it keeps reading "Press a key…".
    cancelKeyCapture();
    streamerUi.listening = btn.dataset.key;
    btn.classList.add("listening");
    btn.textContent = "Press a key…";
  };
});
// Walking away cancels it. Without these the capture stayed armed and ate the
// next key pressed anywhere in the launcher.
document.addEventListener("pointerdown", (e) => {
  if (!streamerUi.listening) return;
  const btn = e.target instanceof Element ? e.target.closest(".key-btn") : null;
  if (btn && btn.dataset.key === streamerUi.listening) return;
  cancelKeyCapture();
}, true);
window.addEventListener("blur", cancelKeyCapture);
document.addEventListener("keydown", (e) => {
  if (!streamerUi.listening) return;
  e.preventDefault();
  e.stopPropagation();
  const key = streamerUi.listening;
  const done = endKeyCapture;
  if (e.key === "Escape") return done();
  if (e.key === "Backspace" || e.key === "Delete") {
    saveStreamer({ [key]: "" });
    return done();
  }
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return; // wait for the real key
  const accel = acceleratorFor(e);
  if (!accel) {
    toast("That key can't be a hotkey — try F1–F12, a letter or a number.");
    return done();
  }
  if (!e.ctrlKey && !e.altKey && !e.shiftKey && /^[A-Z0-9]$/.test(accel)) {
    toast("A plain letter or number would fire while you type in chat — add Ctrl, Alt or Shift.");
    return done();
  }
  const other = key === "clipKey" ? "screenshotKey" : "clipKey";
  if (((state.settings && state.settings.streamer) || {})[other] === accel) {
    toast("That key is already your other hotkey.");
    return done();
  }
  streamerUi.listening = null; // the key is taken - don't swallow more while it saves
  saveStreamer({ [key]: accel }).then(done);
}, true);

function acceleratorFor(e) {
  let k = e.key;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(k)) k = k.toUpperCase();
  else if (/^[a-z0-9]$/i.test(k)) k = k.toUpperCase();
  else {
    const map = { Insert: "Insert", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Pause: "Pause", ScrollLock: "Scrolllock", PrintScreen: "PrintScreen" };
    if (/^Numpad[0-9]$/.test(e.code)) k = "num" + e.code.slice(6);
    else if (map[k]) k = map[k];
    else return null;
  }
  const mods = [];
  if (e.ctrlKey) mods.push("Control");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  return [...mods, k].join("+");
}

function fmtSeconds(s) {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function paintLivePill() {
  const st = streamerUi.status;
  const cfg = (state.settings && state.settings.streamer) || {};
  const pill = $("livePill");
  const rec = st && st.recording;
  pill.classList.toggle("rec", Boolean(rec));
  $("livePillText").textContent = rec ? `REC · ${fmtSeconds(Math.min(st.bufferedSeconds, cfg.clipSeconds || 60))} ready` : "Streamer mode";
  const box = $("bufferStatus");
  if (!box) return;
  box.textContent = "";
  box.classList.toggle("rec", Boolean(rec));
  box.appendChild(el("span", "dot"));
  const text = el("span");
  if (st && st.error) text.textContent = st.error;
  else if (rec) {
    text.appendChild(document.createTextNode("Replay buffer recording — "));
    text.appendChild(el("b", null, fmtSeconds(Math.min(st.bufferedSeconds, cfg.clipSeconds || 60))));
    text.appendChild(document.createTextNode(` of ${CLIP_LENGTHS.find((c) => c[0] === cfg.clipSeconds)?.[1] || "1 minute"} ready to save.`));
  } else if (st && st.gameRunning) text.textContent = "Looking for the Minecraft window…";
  else text.textContent = "The replay buffer starts by itself when Minecraft opens.";
  box.appendChild(text);
  const keys = el("span", "keys");
  if (cfg.clipKey) {
    keys.appendChild(el("kbd", null, cfg.clipKey));
    keys.appendChild(document.createTextNode("clip"));
  }
  if (cfg.screenshotKey) {
    keys.appendChild(el("kbd", null, cfg.screenshotKey));
    keys.appendChild(document.createTextNode("screenshot"));
  }
  box.appendChild(keys);
}

window.reminth.onStreamerStatus((st) => {
  streamerUi.status = st;
  paintLivePill();
});
setInterval(async () => {
  if (!(state.settings && state.settings.streamerMode)) return;
  try {
    streamerUi.status = await window.reminth.streamerStatus();
    paintLivePill();
  } catch {
    // ignore
  }
}, 2000);
window.reminth.onStreamerSaved(({ title, body }) => {
  toast(`${title} — ${body}`);
  if (currentPage === "captures") loadCaptures();
});

$("capShotBtn").onclick = async () => {
  try {
    const r = await window.reminth.screenshot();
    if (r && r.error) toast(r.error);
  } catch (err) {
    toast(friendlyError(err.message));
  }
};
$("capClipBtn").onclick = async () => {
  $("capClipBtn").disabled = true;
  try {
    const r = await window.reminth.saveClip();
    if (r && r.error) toast(r.error);
  } catch (err) {
    toast(friendlyError(err.message));
  } finally {
    $("capClipBtn").disabled = false;
  }
};
$("capFolderBtn").onclick = () => window.reminth.openCapturesFolder().catch(() => toast("Couldn't open that folder."));
$("capFolderBtn2").onclick = () => window.reminth.openCapturesFolder().catch(() => toast("Couldn't open that folder."));

document.querySelectorAll("#captureTabs .tab").forEach((t) => {
  t.onclick = () => {
    streamerUi.filter = t.dataset.filter;
    document.querySelectorAll("#captureTabs .tab").forEach((x) => x.classList.toggle("active", x === t));
    renderCaptures();
  };
});

async function loadCaptures() {
  try {
    streamerUi.captures = await window.reminth.captures();
  } catch {
    streamerUi.captures = [];
  }
  renderCaptures();
}

function renderCaptures() {
  const grid = $("captureGrid");
  const f = streamerUi.filter;
  const items = streamerUi.captures.filter((c) => f === "all" || (f === "clip" && c.type === "clip") || (f === "screenshot" && c.type === "screenshot" && c.source === "reminth") || (f === "game" && c.source === "game"));
  grid.textContent = "";
  if (!items.length) {
    const cfg = (state.settings && state.settings.streamer) || {};
    return renderEmpty(grid, "Nothing here yet", f === "game" ? "Screenshots you take in game with F2 show up here too." : `Start Minecraft, then press ${cfg.clipKey || "your clip key"} to save a clip or ${cfg.screenshotKey || "your screenshot key"} for a screenshot.`);
  }
  for (const c of items.slice(0, 300)) {
    const card = el("div", "card capture");
    const media = el("div", "capture-media");
    if (c.type === "clip") {
      const v = el("video");
      v.src = c.url;
      v.preload = "metadata";
      v.muted = true;
      media.appendChild(v);
      const ov = el("span", "play-ov");
      ov.appendChild(icon("#i-play"));
      media.appendChild(ov);
      media.appendChild(el("span", "kind clip", "Clip"));
    } else {
      const img = el("img");
      img.src = c.url;
      img.alt = "";
      img.loading = "lazy";
      media.appendChild(img);
      media.appendChild(el("span", "kind shot", c.source === "game" ? `In-game · ${c.instanceName}` : "Screenshot"));
    }
    media.onclick = () => window.reminth.openCapture(c.path, "open").catch((err) => toast(friendlyError(err.message)));
    card.appendChild(media);
    const body = el("div", "capture-body");
    const meta = el("div", "meta");
    meta.appendChild(el("b", null, new Date(c.date).toLocaleString()));
    meta.appendChild(el("span", null, formatBytes(c.size)));
    body.appendChild(meta);
    const folder = el("button", "icon-btn");
    folder.title = "Show in folder";
    folder.appendChild(icon("#i-folder"));
    folder.onclick = () => window.reminth.openCapture(c.path, "folder").catch((err) => toast(friendlyError(err.message)));
    const del = el("button", "icon-btn danger");
    del.title = "Move to Recycle Bin";
    del.appendChild(icon("#i-trash"));
    del.onclick = async () => {
      try {
        await window.reminth.deleteCapture(c.path);
      } catch (err) {
        toast(friendlyError(err.message));
      }
      loadCaptures();
    };
    body.appendChild(folder);
    body.appendChild(del);
    card.appendChild(body);
    grid.appendChild(card);
  }
}

pageHooks.captures = () => {
  loadCaptures();
  paintLivePill();
};
pageHooks.streamer = () => {
  if (state.info) $("capturesPath").textContent = state.info.capturesDir;
};

/* ================================================================== *
 * 7. compatibility help                                               *
 *                                                                     *
 * Says which mods won't load BEFORE the game refuses to start, and    *
 * fixes them in one click (main/compat.js does the judging):          *
 *   - the panel above an instance's mod list                          *
 *   - the question in front of Play when the game can't start         *
 *   - "Which Minecraft version should I use?" + the copy it offers    *
 *   - what a server takes, and what to do when no instance fits       *
 * ================================================================== */
const compatUi = {
  results: new Map(), // instance id -> the last compatCheck answer for it
  inflight: new Map(), // instance id -> the one check running for it
  again: new Map(), // instance id -> force flag of a check asked for while one was running
  timers: new Map(), // instance id -> debounce timer
  fixing: null, // instance id a fix from the panel is being applied to
  playAnyway: localGet("compat.playAnyway", {}), // instance id -> the issues the player chose to launch with
};

const plural = (n, one, many) => (n === 1 ? one : many || one + "s");

/** "a, b, c +2 more" */
function nameList(names, max = 3) {
  const list = names || [];
  return list.length > max ? `${list.slice(0, max).join(", ")} +${list.length - max} more` : list.join(", ");
}

/** "a, b and c" */
function sentenceList(names) {
  const list = names || [];
  return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list.join("");
}

const addedNote = (added) => (added && added.length ? `, and added ${sentenceList(added)}` : "");

/** Things the backend wants said although the job went through: " Note: …" for the end of a toast. */
const warningNote = (warnings) => {
  const list = (warnings || []).filter(Boolean).map((w) => friendlyError(w));
  return list.length ? ` Note: ${list[0]}${list.length > 1 ? ` (+${list.length - 1} more)` : ""}` : "";
};

/** A release version as numbers ("1.21.4" -> [1, 21, 4]); null for snapshots and the like. */
function mcParts(v) {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(String(v || "").trim());
  return m ? [Number(m[1]), Number(m[2]), m[3] === undefined ? 0 : Number(m[3])] : null;
}

/** Oldest first; releases only, each once. */
function sortedReleases(list) {
  return [...new Set((list || []).filter((v) => mcParts(v)))].sort((a, b) => {
    const pa = mcParts(a);
    const pb = mcParts(b);
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return 0;
  });
}

/** ["1.21.4"] -> "1.21.4"; a list -> "1.8 – 1.21.4"; nothing usable -> null. */
function versionRangeLabel(list) {
  const releases = sortedReleases(list);
  if (!releases.length) return (list && list[0]) || null;
  return releases.length === 1 ? releases[0] : `${releases[0]} – ${releases[releases.length - 1]}`;
}

/** What a server from Discover takes: { list, label, version } - list empty when it doesn't say. */
function serverTakes(s) {
  const c = (s && s.content) || {};
  const list = Array.isArray(c.supportedVersions) ? c.supportedVersions.filter((v) => typeof v === "string") : [];
  const releases = sortedReleases(list);
  return {
    list,
    label: versionRangeLabel(list) || c.recommendedVersion || null,
    // The one to build an instance on: what the server recommends, else the newest it takes.
    version: c.recommendedVersion || releases[releases.length - 1] || list[0] || null,
  };
}

/** Can this instance join? true / false, or null when the server doesn't say what it takes. */
function instanceFitsServer(inst, s) {
  const { list } = serverTakes(s);
  if (!inst || !list.length) return null;
  return list.includes(inst.mcVersion);
}

/**
 * Why a mod from Discover won't go into this instance, from what the search
 * hit already says (no extra request): "no build for 1.21.9" / "not for
 * Fabric", or null when it fits or can't be told.
 */
function modMisfit(project, inst) {
  if (!project || !inst || (project.type || "mod") !== "mod" || inst.loader === "vanilla") return null;
  const loaders = project.loaders || [];
  const wanted = modLoadersFor(inst);
  if (loaders.length && !loaders.some((l) => wanted.includes(l))) return `not for ${loaderLabel(inst)}`;
  const versions = project.versions;
  if (Array.isArray(versions) && versions.length && !versions.includes(inst.mcVersion)) return `no build for ${inst.mcVersion}`;
  return null;
}

/* ---- checking ---- */

/**
 * The one way a check is run: never two at once for an instance. A request
 * that arrives while one is running makes it run once more when it ends, so
 * the answer is never older than the last thing that changed.
 */
function runCompatCheck(id, force = false) {
  if (compatUi.inflight.has(id)) {
    compatUi.again.set(id, Boolean(compatUi.again.get(id)) || force);
    return compatUi.inflight.get(id);
  }
  const run = (async () => {
    let result = null;
    let forced = force;
    try {
      for (;;) {
        try {
          result = await window.reminth.compatCheck(id, { force: forced });
        } catch {
          result = null; // instance gone, or the folder couldn't be read - nothing to show
        }
        if (!compatUi.again.has(id)) break;
        forced = compatUi.again.get(id);
        compatUi.again.delete(id);
      }
    } finally {
      compatUi.inflight.delete(id);
    }
    if (result) compatUi.results.set(id, result);
    else compatUi.results.delete(id);
    // Only the instance on screen is painted; another one's answer is kept
    // for when it's opened (and for its Play button).
    if (content.instanceId === id) renderCompatPanel();
    paintSyncButtons();
    return result;
  })();
  compatUi.inflight.set(id, run);
  return run;
}

/** After the lists reload: look again, once the changes have settled. */
function scheduleCompatCheck(id) {
  const inst = instanceById(id);
  clearTimeout(compatUi.timers.get(id));
  if (!inst || inst.loader === "vanilla") {
    compatUi.results.delete(id);
    if (content.instanceId === id) renderCompatPanel();
    return;
  }
  compatUi.timers.set(
    id,
    setTimeout(() => {
      compatUi.timers.delete(id);
      runCompatCheck(id);
    }, 350)
  );
}

/* ---- fixing ---- */

/**
 * Applies the fixes of `issues`. Every "update" goes in one applyUpdates
 * call, then the installs one by one, then (only when asked) the switch-offs.
 * Never throws. Returns { fixed: [titles], failed: [{ title, error }],
 * left: [titles not touched], added: [titles the new builds brought in],
 * warnings: [text] }. `id` is the instance the issues were found in - the
 * callers fix it when the player clicks, and nothing here reads the active one.
 */
async function applyCompatFixes(id, issues, { includeDisable = false } = {}) {
  const out = { fixed: [], failed: [], left: [], added: [], warnings: [] };
  const updates = issues.filter((i) => i.fix && i.fix.type === "update" && i.fix.update);
  const installs = issues.filter((i) => i.fix && i.fix.type === "install" && i.fix.projectId);
  const disables = issues.filter((i) => i.fix && i.fix.type === "disable" && i.file);
  for (const i of issues) if (!updates.includes(i) && !installs.includes(i) && !disables.includes(i)) out.left.push(i.title);

  if (updates.length) {
    try {
      const r = await window.reminth.applyUpdates(id, updates.map((i) => i.fix.update));
      // Matched by file: two mods can share a title, a file name can't be shared.
      const failed = r.failed || [];
      const badFile = new Map(failed.filter((f) => f.file).map((f) => [f.file, f.error]));
      const badTitle = new Map(failed.filter((f) => !f.file).map((f) => [f.title, f.error]));
      for (const i of updates) {
        const file = i.fix.update.file || i.file;
        const title = i.fix.update.title || i.title;
        const error = badFile.has(file) ? badFile.get(file) : badTitle.get(title);
        if (error !== undefined) out.failed.push({ title: i.title, error: friendlyError(error) });
        else out.fixed.push(i.title);
      }
      out.added.push(...(r.added || []));
      out.warnings.push(...(r.warnings || []));
    } catch (err) {
      for (const i of updates) out.failed.push({ title: i.title, error: friendlyError(err.message) });
    }
  }
  const asked = new Set();
  for (const i of installs) {
    const key = `${i.fix.projectId}|${i.fix.versionId || ""}`;
    if (asked.has(key)) {
      out.fixed.push(i.title);
      continue;
    }
    asked.add(key);
    try {
      const r = await window.reminth.installContent(id, { projectId: i.fix.projectId, kind: "mod", ...(i.fix.versionId ? { versionId: i.fix.versionId } : {}) });
      out.fixed.push(i.title);
      out.warnings.push(...((r && r.warnings) || []));
    } catch (err) {
      out.failed.push({ title: i.title, error: friendlyError(err.message) });
    }
  }
  for (const i of disables) {
    if (!includeDisable) {
      out.left.push(i.title);
      continue;
    }
    try {
      await window.reminth.setContentEnabled(id, { kind: "mod", world: null, file: i.file }, false);
      out.fixed.push(i.title);
    } catch (err) {
      out.failed.push({ title: i.title, error: friendlyError(err.message) });
    }
  }
  return out;
}

/** Why fixes can't be applied right now, or null when they can. */
function compatFixBlocked(id) {
  if (state.running.has(id)) return "Close the game first — Windows won't let files in use be replaced.";
  if (content.updating) return "Wait for the update that's running to finish first.";
  if (compatUi.fixing) return "A fix is already being applied.";
  return null;
}

/** Runs fixes from the panel: busy state, then fresh lists and a fresh check. */
async function compatFixFromPanel(id, issues, { includeDisable, busyButton, all }) {
  const why = compatFixBlocked(id);
  if (why) return toast(why);
  const inst = instanceById(id);
  compatUi.fixing = id;
  $("compatPanel").querySelectorAll("button").forEach((b) => (b.disabled = true));
  if (busyButton) {
    busyButton.classList.add("busy");
    const label = busyButton.querySelector("span");
    if (label) label.textContent = "Working…";
  }
  try {
    const r = await applyCompatFixes(id, issues, { includeDisable });
    if (all) {
      const parts = [];
      if (r.fixed.length) parts.push(`Fixed ${r.fixed.length} ${plural(r.fixed.length, "mod")}${addedNote(r.added)}.`);
      if (r.failed.length) parts.push(`${r.failed.length} couldn't be fixed — ${r.failed[0].title}: ${r.failed[0].error}`);
      if (r.left.length) parts.push(`Left for you to switch off: ${nameList(r.left)}.`);
      toast((parts.join(" ") || "Nothing to fix.") + warningNote(r.warnings));
    } else if (r.failed.length) {
      toast(`Couldn't fix ${r.failed[0].title}: ${r.failed[0].error}`);
    } else if (r.fixed.length) {
      const issue = issues[0];
      const fix = issue.fix;
      const note = warningNote(r.warnings);
      if (fix.type === "update") toast(`${issue.title} switched to ${fix.update.next.versionNumber}${addedNote(r.added)}.${note}`);
      else if (fix.type === "install") toast(`${fix.title || issue.title} added to ${inst ? inst.name : "the instance"}.${note}`);
      else toast(`${issue.title} switched off.${note}`);
    }
  } finally {
    compatUi.fixing = null;
    // Another instance may be on screen by now: its lists are left alone.
    if (content.instanceId === id) await loadContent(id);
    await runCompatCheck(id, true);
    if (content.instanceId === id) renderCompatPanel();
  }
}

/* ---- the panel above the mod list ---- */

function compatIcon(issue) {
  const item = issue.file && content.data ? (content.data.mod || []).find((m) => m.file === issue.file) : null;
  const c = item ? creatorOf(item) : null;
  const src = safeIconUrl(issue.iconUrl) || (item && (safeIconUrl(item.iconUrl) || safeIconUrl(c && c.iconUrl) || safeIconUrl(item.icon)));
  const letter = () => el("div", "cp-ico", (issue.title || "?").slice(0, 1).toUpperCase());
  if (!src) return letter();
  const img = el("img", "cp-ico");
  img.src = src;
  img.alt = "";
  img.loading = "lazy";
  img.addEventListener("error", () => img.replaceWith(letter()));
  return img;
}

/** One issue: icon, name, the sentence about it, and (optionally) its fix button. */
function compatIssueRow(issue, { onFix, showFixText } = {}) {
  const row = el("div", "cp-row");
  row.appendChild(compatIcon(issue));
  const main = el("div", "cp-main");
  const top = el("div", "cp-top");
  top.appendChild(el("span", "cp-name", issue.title));
  top.appendChild(el("span", "tag " + (issue.severity === "blocked" ? "rose" : "amber"), issue.severity === "blocked" ? "Won't load" : "May not work"));
  main.appendChild(top);
  main.appendChild(el("div", "cp-detail", issue.detail));
  if (showFixText && issue.fix) main.appendChild(el("div", "cp-does", `Fix: ${issue.fix.label}`));
  row.appendChild(main);
  if (onFix && issue.fix) {
    const b = button("btn outline sm cp-fix", issue.fix.label);
    b.title = issue.fix.label;
    b.onclick = () => onFix(issue, b);
    row.appendChild(b);
  }
  return row;
}

function renderCompatPanel() {
  const panel = $("compatPanel");
  if (!panel) return;
  const id = content.instanceId;
  // A fix is running from this very panel: its buttons keep their busy state
  // until it's done, and it repaints then.
  if (compatUi.fixing && compatUi.fixing === id && !panel.hidden) return;
  const result = id ? compatUi.results.get(id) : null;
  const inst = id ? instanceById(id) : null;
  panel.textContent = "";
  if (!result || !inst || inst.loader === "vanilla" || !result.issues || !result.issues.length) {
    panel.hidden = true;
    paintCompatTags();
    return;
  }
  const blocked = result.issues.filter((i) => i.severity === "blocked").length;
  const warned = result.issues.length - blocked;
  panel.className = "compat-panel " + (blocked ? "blocked" : "warn");

  const head = el("div", "cp-head");
  head.appendChild(icon("#i-alert"));
  const title = el("b", "cp-title");
  if (blocked) {
    title.textContent = `${blocked} ${plural(blocked, "mod")} will stop Minecraft from starting`;
    if (warned) title.appendChild(el("small", null, `${warned} more may not work`));
  } else {
    title.textContent = `${warned} ${plural(warned, "mod")} may not work on ${result.mcVersion || inst.mcVersion}`;
  }
  head.appendChild(title);
  const actions = el("div", "cp-actions");
  const auto = result.issues.filter((i) => i.fix && (i.fix.type === "update" || i.fix.type === "install"));
  if (auto.length >= 2) {
    const all = button("btn primary sm pill-like", "Fix all", "#i-check");
    all.title = "Switches every mod that has a matching build to it, and adds what's missing";
    all.onclick = () => compatFixFromPanel(id, result.issues, { includeDisable: false, busyButton: all, all: true });
    actions.appendChild(all);
  }
  const advise = button("btn outline sm", "Find a version that fits everything");
  advise.onclick = () => openVersionAdvisor(id);
  actions.appendChild(advise);
  head.appendChild(actions);
  panel.appendChild(head);
  if (result.online === false) panel.appendChild(el("div", "cp-note", "Couldn't reach Modrinth — only checks that work offline were run."));

  const list = el("div", "cp-list");
  for (const issue of result.issues) {
    list.appendChild(
      compatIssueRow(issue, {
        onFix: (i, b) => compatFixFromPanel(id, [i], { includeDisable: true, busyButton: b, all: false }),
      })
    );
  }
  panel.appendChild(list);
  panel.hidden = false;
  paintCompatTags();
}

/** "Won't load" / "May not work" on the rows of the mod list the panel is about. */
function paintCompatTags() {
  const list = $("listMods");
  if (!list) return;
  list.querySelectorAll(".c-compat").forEach((n) => n.remove());
  const result = content.instanceId ? compatUi.results.get(content.instanceId) : null;
  if (!result || !result.issues || !result.issues.length) return;
  const byKey = new Map();
  for (const issue of result.issues) {
    if (!issue.file) continue;
    const key = `mod//${issue.file}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(issue);
  }
  list.querySelectorAll(".content-row[data-key]").forEach((row) => {
    const issues = byKey.get(row.dataset.key);
    const top = row.querySelector(".c-top");
    if (!issues || !top) return;
    const blocked = issues.some((i) => i.severity === "blocked");
    const tag = el("span", "tag c-compat " + (blocked ? "rose" : "amber"), blocked ? "Won't load" : "May not work");
    tag.title = issues.map((i) => i.detail).join("\n");
    top.appendChild(tag);
  });
}

/* ---- before Play ---- */

const compatSignature = (issues) => issues.map((i) => `${i.file || ""}|${i.reason}|${i.title}`).sort().join("\n");

/**
 * Called by runPlay before a modded instance launches. Resolves true to go
 * ahead, false when the player backed out. Never keeps Play waiting more
 * than a few seconds, and only ever asks about mods that stop the game.
 *
 * The full check (which reads every jar and asks Modrinth) gets about 2.5
 * seconds. If it hasn't answered - a big instance checked for the first
 * time - the quick check decides instead: it only uses what the jars say
 * themselves, which is everything that can stop the game. Giving up after
 * the wait, as this used to, let exactly the big instances start unchecked.
 * The full check carries on by itself and paints the panel when it's done;
 * the quick answer is used here only and never stored.
 */
async function compatBeforePlay(inst) {
  if (!inst || inst.loader === "vanilla" || state.running.has(inst.id)) return true;
  const after = (ms) => new Promise((resolve) => setTimeout(() => resolve(null), ms));
  let result = null;
  try {
    result = await Promise.race([runCompatCheck(inst.id), after(2500)]);
    if (!result) {
      result = await Promise.race([window.reminth.compatCheck(inst.id, { localOnly: true }).catch(() => null), after(2500)]);
    }
  } catch {
    return true;
  }
  if (!result) return true;
  const blocked = (result.issues || []).filter((i) => i.severity === "blocked");
  if (!blocked.length) return true;
  const signature = compatSignature(blocked);
  if (compatUi.playAnyway[inst.id] === signature) return true;

  return new Promise((resolve) => {
    let answer = false;
    let fixing = false;
    const n = blocked.length;
    const body = el("div");
    body.appendChild(
      el("p", null, `${n} ${plural(n, "mod")} in ${inst.name} ${n === 1 ? "stops" : "stop"} the game from starting. Reminth can fix ${n === 1 ? "it" : "them"} now, then start the game.`)
    );
    const list = el("div", "cp-list");
    blocked.forEach((issue) => list.appendChild(compatIssueRow(issue, { showFixText: true })));
    body.appendChild(list);
    const note = el("div", "cp-note");
    note.hidden = true;
    body.appendChild(note);
    openModal({
      title: "Minecraft won't start like this",
      body,
      canClose: () => !fixing,
      onClose: () => resolve(answer),
      buttons: [
        { label: "Cancel", className: "outline" },
        {
          label: "Play anyway",
          className: "outline",
          onClick: () => {
            if (fixing) return false;
            // Not asked again for this instance until its problems change.
            compatUi.playAnyway[inst.id] = signature;
            localSet("compat.playAnyway", compatUi.playAnyway);
            answer = true;
            return true;
          },
        },
        {
          label: "Fix and play",
          className: "primary",
          icon: "#i-check",
          onClick: async (handle) => {
            if (fixing) return false;
            const why = compatFixBlocked(inst.id);
            if (why) {
              toast(why);
              return false;
            }
            fixing = true;
            handle.buttons.forEach((b) => (b.disabled = true));
            note.hidden = false;
            note.textContent = "Fixing…";
            try {
              const r = await applyCompatFixes(inst.id, blocked, { includeDisable: true });
              if (content.instanceId === inst.id) await loadContent(inst.id);
              runCompatCheck(inst.id, true);
              if (r.failed.length || r.left.length) {
                const bits = [];
                if (r.failed.length) bits.push(`Couldn't fix ${r.failed[0].title}: ${r.failed[0].error}`);
                if (r.left.length) bits.push(`No automatic fix for ${nameList(r.left)}.`);
                note.textContent = `${bits.join(" ")} You can still press Play anyway, or cancel and sort it out in the Mods tab.`;
                return false;
              }
              toast(`Fixed ${r.fixed.length} ${plural(r.fixed.length, "mod")}${addedNote(r.added)}.${warningNote(r.warnings)}`);
              answer = true;
              return true;
            } finally {
              fixing = false;
              handle.buttons.forEach((b) => (b.disabled = false));
            }
          },
        },
      ],
    });
  });
}

/* ---- after an install ---- */
// An install swaps Reminth's own jars and the backend forgets its answer:
// look again now, so the answer is there by the time Play is pressed (also
// for an instance that isn't the one on screen).
window.reminth.onInstallDone(({ instanceId }) => {
  if (instanceId && instanceById(instanceId)) scheduleCompatCheck(instanceId);
});

/* ---- after the version or loader of an instance was changed ---- */
async function compatAfterEdit(id, mcVersion) {
  const result = await runCompatCheck(id, true);
  if (!result || !result.issues) return;
  // Mods built for the old version or loader: the one-time notice with the
  // "Update mods to fit" button, on that instance's page.
  const behind = syncCount(result);
  if (behind) {
    syncUi.notice = { id, mcVersion };
    paintSyncButtons();
    const inst = instanceById(id);
    toast(`${behind} ${plural(behind, "mod")} in ${inst ? inst.name : "that instance"} ${behind === 1 ? "is" : "are"} built for another version — "Update mods to fit ${mcVersion}" swaps ${behind === 1 ? "it" : "them"}.`);
    return;
  }
  const n = result.issues.filter((i) => i.fix && i.fix.type === "update").length;
  if (!n) return;
  toast(n === 1 ? `1 mod needs its ${mcVersion} build — open Mods to fix it in one click.` : `${n} mods need their ${mcVersion} builds — open Mods to fix them in one click.`);
}

/* ---- "Which Minecraft version should I use?" ---- */

// The game refused to start and said which mods (main.js noteLaunchReport):
// look again now, so the panel and "Update mods to fit" know them.
window.reminth.onCompatChanged(({ instanceId, refused }) => {
  runCompatCheck(instanceId, true);
  if (refused) {
    const inst = instanceById(instanceId);
    toast(`Minecraft named ${refused} ${plural(refused, "mod")} in ${inst ? inst.name : "that instance"} that ${refused === 1 ? "needs" : "need"} another version — they're marked on the Mods tab.`);
  }
});

const compatProgressListeners = new Set();
window.reminth.onCompatProgress((p) => compatProgressListeners.forEach((fn) => fn(p)));

let advisorOpen = false;

/**
 * The advisor: which Minecraft version the instance's mods (and a server,
 * if one is given) all have builds for, and a copy of the instance on it.
 *   options.server  { name, address, accepts: [versions], play(instance) }
 *   options.open    false = select the copy without leaving the current page
 * Resolves with the new instance when a copy was made, else null.
 */
function openVersionAdvisor(instanceId, options = {}) {
  const inst = instanceById(instanceId);
  if (!inst || advisorOpen) return Promise.resolve(null);
  if (inst.loader === "vanilla") {
    toast(`${inst.name} is a vanilla instance — it has no mods to check.`);
    return Promise.resolve(null);
  }
  advisorOpen = true;
  const server = options.server || null;
  const shortName = inst.name.length > 26 ? inst.name.slice(0, 25) + "…" : inst.name;

  let step = "pick"; // pick -> confirm -> running -> done
  let advice = null;
  let chosen = null;
  let accepts = server && server.accepts && server.accepts.length ? server.accepts : null;
  let token = 0;
  let copying = false;
  let copied = null;
  let playAfter = false;

  const body = el("div", "adv");
  /* step 1: pick */
  const pickView = el("div");
  const context = el("p", "vpick-note");
  pickView.appendChild(context);
  const field = el("div", "field");
  field.appendChild(el("label", null, "Server address (optional)"));
  const fieldRow = el("div", "field-row");
  const addressInput = el("input");
  addressInput.type = "text";
  addressInput.placeholder = "e.g. play.example.net";
  addressInput.maxLength = 260;
  addressInput.spellcheck = false;
  addressInput.className = "pii"; // a server address: blurred by "Hide personal info"
  if (server && server.address) addressInput.value = server.address;
  const checkBtn = button("btn outline", "Check");
  fieldRow.appendChild(addressInput);
  fieldRow.appendChild(checkBtn);
  field.appendChild(fieldRow);
  const serverNote = el("p", "set-note");
  serverNote.textContent = server && accepts ? `${server.name} takes ${versionRangeLabel(accepts) || "the versions below"}.` : "Add a server to see which versions it lets in.";
  field.appendChild(serverNote);
  pickView.appendChild(field);
  const list = el("div", "pick-list vpick-list");
  pickView.appendChild(list);
  body.appendChild(pickView);
  /* steps 2-4: confirm, progress, result */
  const stepView = el("div");
  stepView.hidden = true;
  body.appendChild(stepView);

  const newName = () => {
    if (!chosen) return inst.name;
    const swapped = inst.name.includes(inst.mcVersion) ? inst.name.replace(inst.mcVersion, chosen.version) : `${inst.name} ${chosen.version}`;
    return swapped.slice(0, 48);
  };

  let handle = null;
  const done = new Promise((resolve) => {
    handle = openModal({
      title: "Which Minecraft version should I use?",
      body,
      wide: true,
      // Not while the copy runs: it would carry on behind a closed dialog.
      canClose: () => !copying,
      onClose: () => {
        advisorOpen = false;
        token++;
        compatProgressListeners.delete(onProgress);
        resolve(copied);
        if (copied && playAfter && server && server.play) server.play(copied);
      },
      buttons: [
        {
          label: "Close",
          className: "outline",
          onClick: () => {
            if (copying) return false;
            if (step === "confirm") {
              showPick();
              return false;
            }
            return true;
          },
        },
        {
          label: "Make a copy",
          className: "primary",
          onClick: async () => {
            if (copying) return false;
            if (step === "pick") {
              if (chosen) showConfirm();
              return false;
            }
            if (step === "confirm") return runCopy();
            playAfter = Boolean(server && server.play); // step "done"
            return true;
          },
        },
      ],
    });
  });
  const [secondary, primary] = handle.buttons;
  const setLabel = (b, text) => (b.querySelector("span").textContent = text);

  /** Footer buttons for the step on screen. Deferred: openModal re-enables a button after its own click. */
  function paintButtons() {
    if (handle.closed) return;
    secondary.hidden = false;
    secondary.disabled = copying;
    primary.disabled = copying;
    if (step === "pick") {
      setLabel(secondary, "Close");
      setLabel(primary, chosen ? `Make a ${chosen.version} copy of ${shortName}` : "Pick a version");
      primary.disabled = !chosen;
    } else if (step === "confirm" || step === "running") {
      setLabel(secondary, "Back");
      setLabel(primary, step === "running" ? "Making the copy…" : "Make the copy");
    } else {
      setLabel(secondary, "Not now");
      secondary.hidden = !(server && server.play);
      setLabel(primary, server && server.play ? `Play ${server.name}` : "Done");
    }
  }
  const paintButtonsSoon = () => setTimeout(paintButtons, 0);

  function showPick() {
    step = "pick";
    stepView.hidden = true;
    pickView.hidden = false;
    paintButtonsSoon();
  }

  function modsLine(c) {
    if (!c.total) return "No mods to check";
    if (c.supported === c.total) return c.total === 1 ? "Your mod has a build for it" : `All ${c.total} mods`;
    return `${c.supported} of ${c.total} mods — no build of ${nameList(c.missing)}`;
  }

  function paintList() {
    list.textContent = "";
    const a = advice;
    const bits = [];
    if (a.total) bits.push(`${a.total} of your mods ${a.total === 1 ? "is" : "are"} on Modrinth and ${a.total === 1 ? "was" : "were"} checked.`);
    else bits.push("None of this instance's mods are on Modrinth, so there is nothing to compare.");
    if (a.unknown && a.unknown.length) bits.push(`${a.unknown.length} can't be checked (not from Modrinth): ${nameList(a.unknown)}.`);
    if (a.failed && a.failed.length) bits.push(`${a.failed.length} couldn't be looked up just now: ${nameList(a.failed)}.`);
    context.textContent = bits.join(" ");
    context.title = [...(a.unknown || []), ...(a.failed || [])].join(", ");
    const rows = a.candidates || [];
    if (!rows.length) {
      list.appendChild(el("div", "vpick-empty", "No version to suggest."));
      return;
    }
    if (a.best && a.best.current) {
      list.appendChild(el("div", "vpick-empty", `${inst.name} is already on the best version for its mods${accepts ? " and this server" : ""}.`));
    } else if (!a.best && a.total) {
      list.appendChild(el("div", "vpick-empty", `No version has every mod${accepts ? " and is taken by this server" : ""}. The closest ones are first.`));
    }
    const select = (c, item) => {
      chosen = c;
      list.querySelectorAll(".pick-item").forEach((x) => x.classList.toggle("selected", x === item));
      paintButtons();
    };
    for (const c of rows) {
      const item = el("button", "pick-item vpick-item");
      item.type = "button";
      const main = el("div", "vpick-main");
      main.appendChild(el("b", null, `Minecraft ${c.version}`));
      const line = el("span", null, modsLine(c));
      if (c.missing && c.missing.length) line.title = `No build for ${c.version}: ${c.missing.join(", ")}`;
      main.appendChild(line);
      item.appendChild(main);
      const tags = el("div", "vpick-tags");
      if (a.best && a.best.version === c.version) tags.appendChild(el("span", "tag emerald", "Best fit"));
      if (c.server === true) tags.appendChild(el("span", "tag cyan", "Server ok"));
      else if (c.server === false) tags.appendChild(el("span", "tag rose", "Server won't take it"));
      if (c.current) tags.appendChild(el("span", "tag dim", "Current"));
      item.appendChild(tags);
      if (c.current) {
        // The instance is already on it - there is nothing to copy to.
        item.disabled = true;
        item.title = `${inst.name} is on ${c.version} now`;
      } else item.onclick = () => select(c, item);
      list.appendChild(item);
      if (a.best && a.best.version === c.version && !c.current) select(c, item);
    }
    // Nothing fits everything, but a server was given: start on the closest
    // version it takes (they are ranked first) rather than on nothing.
    if (!chosen && !(a.best && a.best.current) && accepts) {
      const at = rows.findIndex((c) => c.server === true && !c.current);
      const items = list.querySelectorAll(".pick-item");
      if (at >= 0 && items[at]) select(rows[at], items[at]);
    }
  }

  async function load() {
    const mine = ++token;
    advice = null;
    chosen = null;
    paintButtons();
    context.textContent = "";
    list.textContent = "";
    const wait = el("div", "vpick-empty", "Checking each of your mods on Modrinth — this takes a moment…");
    const track = el("div", "track adv-wait");
    const fill = el("div", "fill busy");
    fill.style.width = "100%";
    track.appendChild(fill);
    list.appendChild(wait);
    list.appendChild(track);
    try {
      const a = await window.reminth.compatAdvise(instanceId, accepts ? { accepts } : {});
      if (handle.closed || mine !== token) return; // closed, or a newer check took over
      advice = a;
      paintList();
    } catch (err) {
      if (handle.closed || mine !== token) return;
      list.textContent = "";
      list.appendChild(el("div", "vpick-empty", `Couldn't check your mods: ${friendlyError(err.message)}`));
      const retry = button("btn outline sm", "Try again", "#i-refresh");
      retry.onclick = () => load();
      list.appendChild(retry);
    }
  }

  let checking = false;
  async function checkServer() {
    if (checking || step !== "pick") return;
    const address = addressInput.value.trim();
    if (!address) {
      if (accepts) {
        accepts = null;
        load();
      }
      serverNote.textContent = "Add a server to see which versions it lets in.";
      return;
    }
    checking = true;
    checkBtn.disabled = true;
    serverNote.textContent = "Asking the server…";
    try {
      const r = await window.reminth.compatServerVersions(address);
      if (handle.closed) return;
      if (!r) serverNote.textContent = "Couldn't reach that server. Check the address and try again.";
      else if (!r.online) serverNote.textContent = "That server didn't answer — it may be offline. The list below ignores it.";
      else if (!r.accepts) serverNote.textContent = r.versionName ? `Server says: ${r.versionName} — that doesn't name a Minecraft version, so the list below ignores it.` : "The server didn't say which version it runs.";
      else {
        serverNote.textContent = `Server says: ${r.versionName}`;
        accepts = r.accepts;
        load();
      }
    } catch (err) {
      if (!handle.closed) serverNote.textContent = `Couldn't ask the server: ${friendlyError(err.message)}`;
    } finally {
      checking = false;
      checkBtn.disabled = false;
    }
  }
  checkBtn.onclick = checkServer;
  addressInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") checkServer();
  });

  const facts = (lines) => {
    const ul = el("ul", "change-list adv-facts");
    lines.filter(Boolean).forEach((line) => ul.appendChild(el("li", null, line)));
    return ul;
  };

  /* step 2: say exactly what the copy does */
  const stepNote = el("div", "cp-note");
  function showConfirm(error) {
    step = "confirm";
    pickView.hidden = true;
    stepView.hidden = false;
    stepView.textContent = "";
    const v = chosen.version;
    const loader = loaderLabel(inst);
    const unknown = (advice && advice.unknown) || [];
    stepView.appendChild(el("p", null, `This makes a new instance. ${inst.name} itself is not changed.`));
    stepView.appendChild(
      facts([
        `New instance: ${newName()}, on Minecraft ${v} with ${loader}.`,
        chosen.total ? `${chosen.supported} of ${chosen.total} ${plural(chosen.total, "mod")} ${chosen.supported === 1 ? "is" : "are"} downloaded again in ${chosen.supported === 1 ? "its" : "their"} ${v} ${plural(chosen.supported, "build")}, with anything those builds need.` : null,
        chosen.missing && chosen.missing.length ? `Left out, because there is no ${v} build: ${chosen.missing.join(", ")}.` : null,
        unknown.length ? `Left out, because Reminth can't look ${unknown.length === 1 ? "it" : "them"} up (not from Modrinth): ${unknown.join(", ")}. Add ${unknown.length === 1 ? "it" : "them"} by hand if there is a ${v} build.` : null,
        "Your settings, server list, resource packs, shaders and mod settings are carried over.",
        `Worlds stay in ${inst.name}. Opening a world in a different version can damage it, so they are not copied.`,
        chosen.server === false ? "The server you checked does not take this version." : null,
      ])
    );
    stepView.appendChild(el("p", "set-note", "It can take a few minutes. You can keep using Reminth meanwhile, but this window stays open until it's done."));
    stepNote.textContent = error || "";
    stepNote.hidden = !error;
    stepView.appendChild(stepNote);
    paintButtonsSoon();
  }

  /* step 3: the copy, with its progress */
  const prog = el("div", "progress modal-progress");
  const progRow = el("div", "progress-row");
  const progStage = el("span", null, "Starting…");
  const progPct = el("span");
  progRow.appendChild(progStage);
  progRow.appendChild(progPct);
  const progTrack = el("div", "track");
  const progFill = el("div", "fill busy");
  progTrack.appendChild(progFill);
  prog.appendChild(progRow);
  prog.appendChild(progTrack);
  function onProgress(p) {
    if (!p || p.instanceId !== instanceId || step !== "running") return;
    const determinate = p.total > 1;
    const pct = determinate ? Math.min(100, Math.round((p.current / p.total) * 100)) : null;
    progStage.textContent = p.stage || "Working…";
    progPct.textContent = pct !== null ? `${p.current} of ${p.total}` : "";
    progFill.style.width = pct !== null ? pct + "%" : "100%";
    progFill.classList.toggle("busy", !determinate);
  }
  compatProgressListeners.add(onProgress);

  async function runCopy() {
    if (copying || !chosen) return false;
    copying = true;
    step = "running";
    const target = chosen;
    const name = newName();
    stepNote.hidden = true;
    progStage.textContent = "Starting…";
    progPct.textContent = "";
    progFill.style.width = "100%";
    progFill.classList.add("busy");
    stepView.appendChild(prog);
    secondary.disabled = true;
    paintButtonsSoon();
    try {
      const result = await window.reminth.copyInstanceToVersion(instanceId, { mcVersion: target.version, name });
      copied = result.instance;
      await loadInstances();
      await selectInstance(copied.id, options.open !== false);
      showDone(result, target);
    } catch (err) {
      showConfirm(`The copy wasn't made: ${friendlyError(err.message)}`);
    } finally {
      copying = false;
      paintButtonsSoon();
    }
    return false; // the result (or the error) is shown in this same window
  }

  /* step 4: what happened */
  function showDone(result, target) {
    step = "done";
    stepView.textContent = "";
    const installed = result.installed || [];
    const skipped = result.skipped || [];
    const unknown = result.unknown || [];
    stepView.appendChild(el("p", null, `${result.instance.name} is ready on Minecraft ${target.version}. The game files download the first time you press Play.`));
    stepView.appendChild(
      facts([
        `${installed.length} ${plural(installed.length, "mod")} added.`,
        skipped.length ? `${skipped.length} left out:` : null,
      ])
    );
    if (skipped.length) {
      const box = el("div", "adv-skipped");
      for (const s of skipped) {
        const row = el("div", "vpick-dep");
        row.appendChild(el("b", null, s.title));
        row.appendChild(el("span", "vpick-dep-state", s.why || "Not added"));
        box.appendChild(row);
      }
      stepView.appendChild(box);
    }
    if (unknown.length) stepView.appendChild(el("p", "set-note", `Not from Modrinth, so not copied: ${unknown.join(", ")}.`));
    paintButtonsSoon();
  }

  paintButtons();
  load();
  return done;
}

/* ---- a mod with no build for this instance ---- */

/**
 * Shown instead of a bare "has no version" error: which versions the mod
 * does have builds for, and the way out. Resolves false when nothing could
 * be shown (the caller falls back to its toast).
 */
async function explainNoBuild(inst, projectId, title) {
  let support;
  try {
    support = await window.reminth.compatSupport(inst.id, projectId);
  } catch {
    return false;
  }
  if (!support || !Array.isArray(support.here)) return false;
  const name = title || "This mod";
  const loader = LOADER_LABELS[support.loader] || loaderLabel(inst);
  const mc = support.mcVersion || inst.mcVersion;
  const body = el("div");
  const here = support.here;
  body.appendChild(
    el(
      "p",
      null,
      here.length
        ? `${name} has no ${loader} build for ${mc}. It has builds for ${here.slice(0, 3).join(", ")}${here.length > 3 ? ` (+${here.length - 3} more)` : ""}.`
        : `${name} has no ${loader} build for ${mc}, or for any other version.`
    )
  );
  const others = support.otherLoaders || [];
  if (others.length) body.appendChild(el("p", null, `For ${mc} it only exists for ${sentenceList(others)}.`));
  closeCardMenu(); // the "which instance?" panel this install came from
  if (here.length) body.appendChild(el("p", "set-note", `Reminth can work out which version has builds of everything in ${inst.name}, and make a copy of it on that version.`));
  openModal({
    title: `No ${mc} build of ${name}`,
    body,
    buttons: [
      { label: "Close", className: "outline" },
      {
        label: "Find a version that fits everything",
        className: "primary",
        onClick: () => {
          // After this dialog has closed, so the two never stack.
          setTimeout(() => openVersionAdvisor(inst.id, { open: false }), 0);
          return true;
        },
      },
    ],
  });
  return true;
}

/* ---- servers: no instance fits, and the active one has mods ---- */

/** How many of the player's own mods are switched on in an instance. */
async function ownModCount(inst) {
  try {
    const data = content.instanceId === inst.id && content.data ? content.data : await window.reminth.content(inst.id);
    return (data.mod || []).filter((m) => m.valid && m.enabled && !MANAGED_JAR.test(m.file)).length;
  } catch {
    return 0;
  }
}

/**
 * "Copy my instance with its mods" / "new vanilla instance" / cancel.
 * Resolves "copy", "vanilla" or null.
 */
function chooseServerInstance(s, active, version, takesLabel, modCount) {
  return new Promise((resolve) => {
    let choice = null;
    const body = el("div");
    body.appendChild(el("p", null, `${s.title} takes Minecraft ${takesLabel}, and none of your instances are on it. ${active.name} is on ${active.mcVersion}.`));
    const list = el("div", "pick-list");
    const handle = openModal({
      title: `Play ${s.title}`,
      body,
      onClose: () => resolve(choice),
      buttons: [{ label: "Cancel", className: "outline" }],
    });
    const option = (value, iconId, title, note) => {
      const item = el("button", "pick-item");
      item.type = "button";
      item.appendChild(icon(iconId));
      const main = el("div", "vpick-main");
      main.appendChild(el("b", null, title));
      main.appendChild(el("span", null, note));
      item.appendChild(main);
      item.onclick = () => {
        choice = value;
        handle.close();
      };
      list.appendChild(item);
    };
    option("copy", "#i-copy", `Copy ${active.name} to ${version} with your mods`, `Shows how many of your ${modCount} ${plural(modCount, "mod")} have a ${version} build before anything is made.`);
    option("vanilla", "#i-plus", `New vanilla ${version} instance`, "Plain Minecraft, no mods. Joins straight away.");
    body.appendChild(list);
  });
}

$("versionCheckBtn").onclick = () => openVersionAdvisor(content.instanceId || state.activeId);
$("replacedModsBtn").onclick = () => openFolder("replaced", content.instanceId || state.activeId);

/* ================================================================== *
 * 8. performance: settings, safe mode, profiles, the pack             *
 * ================================================================== */
const perfUi = {
  packFiles: { id: null, files: new Set() }, // the active instance's performance-pack jars (lowercase names)
  packReq: 0,
  memReq: 0,
  safeMode: new Map(), // instanceId -> reason, until the player dismisses it
  gpuBusy: false,
  gcBusy: false,
  priorityBusy: false,
};

/* ---- the Mods tab: which jars are the performance pack's ---- */
const isPackFile = (id, file) => perfUi.packFiles.id === id && perfUi.packFiles.files.has(String(file || "").toLowerCase());

async function refreshPackFiles(id) {
  const req = ++perfUi.packReq;
  let files = new Set();
  try {
    const status = await window.reminth.perfPackStatus(id);
    for (const m of (status && status.mods) || []) if (m.state === "installed" && m.file) files.add(String(m.file).toLowerCase());
  } catch {
    files = new Set(); // no labels is better than wrong ones
  }
  if (req !== perfUi.packReq || content.instanceId !== id) return; // a newer list is on screen
  const before = perfUi.packFiles;
  const same = before.id === id && before.files.size === files.size && [...files].every((f) => before.files.has(f));
  perfUi.packFiles = { id, files };
  if (!same && currentPage === "instance" && CONTENT_TABS[content.tab] && CONTENT_TABS[content.tab].kind === "mod") renderContentTab();
}

/* ---- the pack's status, in the instance dialog ---- */
const PACK_STATE_LABELS = {
  installed: ["Installed", "emerald"],
  pending: ["Next Play", "dim"],
  off: ["Off", "dim"],
  "no-build": ["No stable build yet", "amber"],
  "stepped-aside": ["Left out", "amber"],
  "held-back": ["Kept as is", "amber"],
  "switched-off-by-you": ["Switched off by you", "violet"],
  failed: ["Couldn't install", "rose"],
};
// What these states mean when there's no detail from the last Play.
const PACK_STATE_NOTES = {
  pending: "Checked the next time you press Play.",
  "no-build": "No stable build for this Minecraft version and loader yet.",
  "stepped-aside": "You have your own copy, or a mod it can't run next to.",
  "held-back": "One of your mods needs the version that's installed.",
  "switched-off-by-you": "Reminth leaves it off. Restore puts it back.",
  failed: "Reminth tries again the next time you press Play.",
};

/** Fills `box` with the pack's per-mod state for one instance. onPainted runs after each paint. */
async function paintPackStatus(box, instanceId, onPainted) {
  let status;
  try {
    status = await window.reminth.perfPackStatus(instanceId);
  } catch {
    status = null;
  }
  if (!box.isConnected) return; // the dialog was closed before this answered
  box.textContent = "";
  if (!status || !status.enabled || !(status.mods || []).length) {
    onPainted && onPainted();
    return;
  }
  const head = el("div", "ps-head");
  head.appendChild(el("b", null, "At the last Play"));
  const restore = button("btn outline sm", "Restore", "#i-refresh");
  restore.title = "Put back the pack mods you switched off or removed, and look again for builds that were left out. Applies the next time you press Play.";
  const needsRestore = status.mods.some((m) => !["installed", "pending", "off"].includes(m.state));
  restore.hidden = !needsRestore;
  restore.onclick = async () => {
    if (restore.disabled) return;
    if (state.running.has(instanceId)) return toast("Close the game first — that instance is running.");
    restore.disabled = true;
    try {
      const result = await window.reminth.perfRestorePack(instanceId);
      toast(result && result.reset ? "Restored — the whole pack goes back in the next time you press Play." : "Nothing to restore — the pack is already complete.");
      await paintPackStatus(box, instanceId, onPainted);
      if (instanceId === content.instanceId) refreshPackFiles(instanceId);
    } catch (err) {
      toast(friendlyError(err.message));
    } finally {
      restore.disabled = false;
    }
  };
  head.appendChild(restore);
  box.appendChild(head);
  const list = el("div", "ps-list");
  for (const m of status.mods) {
    const row = el("div", "ps-row");
    row.appendChild(el("span", "ps-name", m.label));
    const [label, colour] = PACK_STATE_LABELS[m.state] || [m.state, "dim"];
    row.appendChild(el("span", "tag " + colour, label));
    const note = m.detail || PACK_STATE_NOTES[m.state] || (m.version ? m.version : "");
    if (note) row.appendChild(el("span", "ps-note", note));
    list.appendChild(row);
  }
  box.appendChild(list);
  onPainted && onPainted();
}

/* ---- optional mods a profile suggests ---- */
const PROFILE_TITLES = { "max-fps": "Max FPS", "far-view": "Far view" };

/** After a profile was picked (new instance or a change): offer its extras, if it has any here. */
function offerProfileExtras(instanceId, profile, loader) {
  if (!PROFILE_TITLES[profile] || !loader || loader === "vanilla") return;
  openProfileExtras(instanceId, profile);
}

function openProfileExtras(instanceId, profile) {
  const inst = instanceById(instanceId);
  if (!inst) return;
  const body = el("div", "extras");
  body.appendChild(el("p", null, "Optional mods that fit this profile. Nothing is added unless you tick it, and each one becomes an ordinary mod you can switch off or remove."));
  const list = el("div", "pick-list extras-list");
  list.appendChild(el("p", "set-note", "Checking which ones have a build for " + inst.mcVersion + "…"));
  body.appendChild(list);
  const picked = new Set();
  let rows = [];
  const handle = openModal({
    title: `Suggested for ${PROFILE_TITLES[profile] || "this profile"}`,
    body,
    wide: true,
    buttons: [
      { label: "Not now", className: "outline" },
      {
        label: "Add selected",
        className: "primary",
        icon: "#i-plus",
        onClick: async () => {
          const chosen = rows.filter((r) => picked.has(r.slug));
          if (!chosen.length) {
            toast("Tick the mods you want first — or press Not now.");
            return false;
          }
          // Anything that isn't a plain stable build gets a second, explicit yes.
          const risky = chosen.filter((r) => r.experimental || (r.channel && r.channel !== "release"));
          if (risky.length) {
            const lines = risky.map((r) => `${r.title}: ${r.warning || `only a ${r.channel} build exists for ${inst.mcVersion}.`}`);
            const ok = await confirmModal("Add experimental mods?", [...lines, "Back up your worlds before you play with these."], "Add anyway", true);
            if (!ok) return false;
          }
          // One at a time, into the instance chosen when this opened - whatever is on screen now.
          for (const r of chosen) await installProject({ projectId: r.slug, projectType: "mod", title: r.title, instanceId });
          return true;
        },
      },
    ],
  });
  const addBtn = handle.buttons[1];
  addBtn.disabled = true;
  window.reminth
    .perfProfileExtras(instanceId)
    .then((answer) => {
      if (handle.closed) return;
      rows = Array.isArray(answer) ? answer : [];
      list.textContent = "";
      if (!rows.length) {
        list.appendChild(el("p", "set-note", "Nothing extra to suggest for this instance."));
        return;
      }
      for (const r of rows) list.appendChild(extraRow(r));
    })
    .catch((err) => {
      if (handle.closed) return;
      list.textContent = "";
      list.appendChild(el("p", "set-note warn-note", friendlyError(err.message)));
    });

  function extraRow(r) {
    const usable = r.available !== false && r.installed !== true;
    const item = el("button", "pick-item extra-item");
    item.type = "button";
    item.setAttribute("role", "checkbox");
    item.setAttribute("aria-checked", "false");
    item.disabled = !usable;
    item.appendChild(el("span", "chk"));
    const main = el("div", "extra-main");
    const top = el("div", "extra-top");
    top.appendChild(el("b", null, r.title));
    if (r.installed) top.appendChild(el("span", "tag emerald", "Already added"));
    else if (r.available === false) top.appendChild(el("span", "tag dim", `No build for ${inst.mcVersion}`));
    else if (r.available === null) top.appendChild(el("span", "tag dim", "Couldn't check"));
    if (r.experimental) top.appendChild(el("span", "tag rose", "Experimental"));
    else if (r.channel && r.channel !== "release") top.appendChild(el("span", "tag amber", r.channel === "beta" ? "Beta build" : "Alpha build"));
    main.appendChild(top);
    main.appendChild(el("span", "extra-why", r.why));
    if (r.warning) main.appendChild(el("span", "extra-warn", r.warning));
    item.appendChild(main);
    item.onclick = () => {
      if (item.disabled) return;
      const on = !picked.has(r.slug);
      if (on) picked.add(r.slug);
      else picked.delete(r.slug);
      item.classList.toggle("selected", on);
      item.setAttribute("aria-checked", on ? "true" : "false");
      addBtn.disabled = picked.size === 0;
    };
    return item;
  }
}

/* ---- safe mode: the JVM refused Reminth's settings, so it ran on basic ones ---- */
window.reminth.onSafeMode(({ instanceId, reason }) => {
  perfUi.safeMode.set(instanceId, String(reason || "").slice(0, 200));
  const inst = instanceById(instanceId);
  toast(`${inst ? inst.name : "Minecraft"}: Minecraft refused the Java settings, so Reminth started it with basic ones. The instance page says why.`);
  if (currentPage === "instance" && state.activeId === instanceId && inst) paintSafeModeNotice(inst);
});

function paintSafeModeNotice(inst) {
  const box = $("instSafeNotice");
  const reason = inst && perfUi.safeMode.get(inst.id);
  box.textContent = "";
  box.hidden = reason === undefined;
  if (reason === undefined) return;
  const text = el("div", "sn-text");
  text.appendChild(el("b", null, "Minecraft refused the Java settings, so Reminth started it with basic ones."));
  if (reason) {
    const why = el("span", null, "Reason: ");
    why.appendChild(el("span", "mono pii", reason));
    text.appendChild(why);
  }
  text.appendChild(el("span", null, "Check Settings → Advanced (extra JVM arguments)."));
  box.appendChild(text);
  const x = el("button", "icon-btn");
  x.type = "button";
  x.title = "Dismiss";
  x.setAttribute("aria-label", "Dismiss");
  x.appendChild(icon("#i-x"));
  x.onclick = () => {
    perfUi.safeMode.delete(inst.id);
    box.hidden = true;
  };
  box.appendChild(x);
}

/* ---- Settings → Performance ---- */
const GC_CHOICES = [
  ["auto", "Automatic (recommended)"],
  ["g1", "Classic (G1)"],
  ["zgc", "Low-pause (ZGC)"],
];
const GC_NOTES = {
  auto: "Reminth picks per Java version: low-pause ZGC on Java 25 and newer when this PC has the memory and cores for it, otherwise G1.",
  g1: "G1 on every version. Pick this if the game stutters or won't start with Automatic.",
  zgc: "ZGC where Java 21 or newer runs the game (Minecraft 1.20.5 and up) on Windows 10 1803 or newer; older versions stay on G1.",
};

function paintPerfSettings(settings) {
  const s = settings || state.settings || {};
  const gc = ["auto", "g1", "zgc"].includes(s.gc) ? s.gc : "auto";
  paintSeg("gcChoice", GC_CHOICES, gc, async (v) => {
    if (perfUi.gcBusy || v === ((state.settings || {}).gc || "auto")) return;
    perfUi.gcBusy = true;
    try {
      await saveSetting({ gc: v }, "Saved. Applies the next time you press Play.");
    } finally {
      perfUi.gcBusy = false;
      paintPerfSettings(state.settings);
    }
  });
  $("gcNote").textContent = GC_NOTES[gc];
  const on = s.processPriority !== "normal";
  setSwitch("togglePriority", on);
  $("priorityNote").textContent = s.streamerMode
    ? "Streamer mode is on, so Minecraft runs at normal priority until you turn it off — the recording needs that CPU time."
    : "Asks Windows to put Minecraft a step above other programs (\"above normal\", never higher). Helps when something else is busy at the same time.";
}

$("togglePriority").onclick = async () => {
  if (perfUi.priorityBusy) return;
  perfUi.priorityBusy = true;
  const on = !$("togglePriority").classList.contains("on");
  setSwitch("togglePriority", on);
  try {
    const saved = await saveSetting({ processPriority: on ? "above-normal" : "normal" }, on ? "Minecraft gets priority from your next launch." : "Minecraft runs at normal priority from your next launch.");
    if (!saved) setSwitch("togglePriority", !on);
  } finally {
    perfUi.priorityBusy = false;
  }
};

$("gpuHelpBtn").onclick = async () => {
  if (perfUi.gpuBusy) return;
  perfUi.gpuBusy = true;
  $("gpuHelpBtn").disabled = true;
  let help;
  try {
    help = await window.reminth.perfGpuHelp();
  } catch (err) {
    toast(friendlyError(err.message));
    return;
  } finally {
    perfUi.gpuBusy = false;
    $("gpuHelpBtn").disabled = false;
  }
  const body = el("div", "gpu-help");
  body.appendChild(
    el(
      "p",
      null,
      help.opened
        ? "Windows decides which graphics card runs each program. Reminth doesn't change that setting itself — it opened Windows' graphics settings for you."
        : "Windows decides which graphics card runs each program. Reminth doesn't change that setting itself. Open Settings → System → Display → Graphics."
    )
  );
  const steps = el("ol", "gpu-steps");
  steps.appendChild(el("li", null, "In Graphics, add a desktop app (Browse) and pick a javaw.exe from the list below."));
  steps.appendChild(el("li", null, "Click it in the list, then Options."));
  steps.appendChild(el("li", null, "Choose High performance and Save. It applies the next time Minecraft starts."));
  body.appendChild(steps);
  const paths = (help && help.javaPaths) || [];
  if (!paths.length) body.appendChild(el("p", "set-note", "Reminth hasn't installed Java yet — press Play once, then come back here."));
  else {
    body.appendChild(el("p", "set-note", paths.length > 1 ? "Reminth's Java programs (different Minecraft versions use different ones — add each):" : "Reminth's Java program:"));
    const list = el("div", "gpu-paths");
    for (const p of paths) {
      const row = el("div", "gpu-path");
      row.appendChild(el("span", "mono pii", p));
      const copy = button("btn outline sm", "Copy", "#i-copy");
      copy.onclick = () => navigator.clipboard.writeText(p).then(() => toast("Path copied."), () => toast("Couldn't reach the clipboard."));
      row.appendChild(copy);
      list.appendChild(row);
    }
    body.appendChild(list);
  }
  openModal({ title: "Choose graphics card", body, wide: true, buttons: [{ label: "Done", className: "primary" }] });
};

/* ---- the memory helper: what "automatic" means for the active instance ---- */
async function paintAutoMemory() {
  const req = ++perfUi.memReq;
  const id = state.activeId;
  let info;
  try {
    info = await window.reminth.perfInfo(id);
  } catch {
    info = null;
  }
  if (req !== perfUi.memReq) return;
  const note = $("ramAuto");
  const useAuto = $("ramAutoBtn");
  if (!info || !info.defaultMemoryMb) {
    note.hidden = true;
    useAuto.hidden = true;
    return;
  }
  const gb = (mb) => {
    const v = Math.round((mb / 1024) * 2) / 2;
    return (Number.isInteger(v) ? v : v.toFixed(1)) + " GB";
  };
  const inst = instanceById(id);
  const name = inst ? inst.name : "this instance";
  const chosen = state.settings && state.settings.maxMemoryMb;
  note.hidden = false;
  if (chosen) {
    note.textContent = `You picked ${gb(chosen)}. Automatic would give ${name} ${gb(info.defaultMemoryMb)}.`;
    useAuto.hidden = false;
  } else {
    note.textContent = `Automatic: ${gb(info.defaultMemoryMb)} for ${name}, from this PC's ${gb(info.totalMemMb)} and the instance (modpacks and Far view get more). Move the slider to choose yourself.`;
    useAuto.hidden = true;
    const capGb = ramLimits().capGb;
    const v = Math.min(Math.round((info.defaultMemoryMb / 1024) * 2) / 2, capGb);
    $("ramRange").value = String(v);
    paintRam(Number($("ramRange").value));
  }
}
$("ramAutoBtn").onclick = async () => {
  const btn = $("ramAutoBtn");
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    if (await saveSetting({ maxMemoryMb: null }, "Memory is automatic again from your next launch.")) await paintAutoMemory();
  } finally {
    btn.disabled = false;
  }
};
pageHooks.settings = () => {
  paintPerfSettings(state.settings);
  paintAutoMemory();
  refreshUpdateState();
};

/* ================================================================== *
 * 9. "Update mods to fit <version>"                                   *
 *                                                                     *
 * A button next to Play (instance page and Home) whenever enabled     *
 * mods are built for another Minecraft version or loader. One click   *
 * swaps them to their newest STABLE build for this version (main/     *
 * modsSync.js); mods with no stable build are listed and left alone   *
 * until the player picks what to do with them.                        *
 * ================================================================== */
const syncUi = {
  busy: null, // instance id being updated
  notice: null, // { id, mcVersion } - the one-time notice after an edit
};

/** How many mods the button is about, from a compat answer. Mirrors modsSync.syncCandidates. */
function syncCount(result) {
  if (!result || !Array.isArray(result.issues)) return 0;
  return result.issues.filter((i) => i && i.file && ((i.reason === "wrong-mc" && (i.severity === "blocked" || i.listedElsewhere === true)) || i.reason === "wrong-loader")).length;
}

/** Why the button can't run for an instance right now, or null. */
function syncBlocked(id) {
  if (state.running.has(id) || state.stopping.has(id)) return "Close the game first — Windows won't let files in use be replaced.";
  if (state.installing.has(id)) return "Wait for the game to finish installing first.";
  if (content.updating && content.updatingFor === id) return "Wait for the update that's running to finish first.";
  if (compatUi.fixing === id) return "A fix is already being applied.";
  if (syncUi.busy) return "Mods are already being updated — wait for that to finish.";
  return null;
}

function paintSyncButtons() {
  const inst = activeInstance();
  const id = inst && inst.id;
  const modded = Boolean(inst && inst.loader !== "vanilla");
  const n = modded ? syncCount(compatUi.results.get(id)) : 0;
  const busyHere = modded && syncUi.busy === id;
  // Hidden while the game runs or installs, or another change is under way.
  // The instance page's button is about the open instance; Home's about the
  // hero's (the last played one).
  for (const [btnId, who] of [
    ["instSyncBtn", inst],
    ["heroSyncBtn", heroInstance()],
  ]) {
    const btn = $(btnId);
    if (!btn) continue;
    const wid = who && who.id;
    const wModded = Boolean(who && who.loader !== "vanilla");
    const wn = wModded ? syncCount(compatUi.results.get(wid)) : 0;
    const wBusy = wModded && syncUi.busy === wid;
    btn.hidden = !(wBusy || (wn > 0 && !syncBlocked(wid)));
    btn.disabled = wBusy;
    btn.dataset.instance = wid || "";
    btn.classList.toggle("busy", wBusy);
    btn.querySelector("span").textContent = wBusy ? "Updating mods…" : `Update mods to fit ${who ? who.mcVersion : ""} (${wn})`;
    btn.title = wBusy ? "" : `${wn} ${plural(wn, "mod is", "mods are")} built for another Minecraft version or loader. Swaps ${wn === 1 ? "it" : "them"} to the newest stable build for ${who ? who.mcVersion : "this version"}.`;
  }
  // The one-time notice after an edit, on that instance's page only.
  const box = $("instSyncNotice");
  const notice = syncUi.notice;
  // Nothing left to update (and that's an answer, not "not checked yet"): the notice has done its job.
  if (notice && notice.id === id && !n && compatUi.results.has(id)) syncUi.notice = null;
  const showNotice = Boolean(syncUi.notice && syncUi.notice.id === id && n > 0 && !busyHere);
  box.hidden = !showNotice;
  box.textContent = "";
  if (!showNotice) return;
  const text = el("div", "sn-text");
  text.appendChild(el("b", null, `${n} ${plural(n, "mod")} ${n === 1 ? "is" : "are"} built for another Minecraft version.`));
  text.appendChild(el("span", null, `They won't load on ${inst.mcVersion}, or may crash it. Reminth can swap them to their newest stable ${inst.mcVersion} builds; anything without one is listed, not removed.`));
  box.appendChild(text);
  const go = button("btn sync-btn sm", `Update mods to fit ${inst.mcVersion}`, "#i-refresh");
  go.disabled = Boolean(syncBlocked(id));
  go.onclick = () => runModsSync(id);
  box.appendChild(go);
  const x = el("button", "icon-btn");
  x.type = "button";
  x.title = "Dismiss";
  x.setAttribute("aria-label", "Dismiss");
  x.appendChild(icon("#i-x"));
  x.onclick = () => {
    syncUi.notice = null;
    paintSyncButtons();
  };
  box.appendChild(x);
}

async function runModsSync(id) {
  if (!id) return;
  const why = syncBlocked(id);
  if (why) return toast(why);
  const inst = instanceById(id);
  if (!inst || inst.loader === "vanilla") return;
  const mcVersion = inst.mcVersion;
  syncUi.busy = id;
  syncUi.notice = null;
  paintSyncButtons();
  let r = null;
  try {
    r = await window.reminth.syncMods(id);
  } catch (err) {
    toast(friendlyError(err.message));
  } finally {
    syncUi.busy = null;
    // Fresh lists for the instance on screen; the check for the one updated.
    if (content.instanceId === id) await loadContent(id);
    await runCompatCheck(id, true);
    paintSyncButtons();
  }
  if (!r) return;
  const applied = r.applied || [];
  const failed = r.failed || [];
  const noBuild = r.noBuild || [];
  const unchecked = r.unchecked || [];
  const parts = [];
  if (applied.length) parts.push(`Updated ${applied.length} ${plural(applied.length, "mod")} in ${inst.name}${addedNote(r.added)}.`);
  if (failed.length) parts.push(`${failed.length} couldn't be updated — ${failed[0].title}: ${friendlyError(failed[0].error)}`);
  if (unchecked.length) parts.push(`Couldn't reach Modrinth for ${unchecked.length} — try again in a moment.`);
  if (noBuild.length) parts.push(`${noBuild.length} ${plural(noBuild.length, "has", "have")} no stable build for ${mcVersion} yet.`);
  toast((parts.join(" ") || "Nothing needed updating.") + warningNote(r.warnings));
  // The "no build" choice is about this instance: only asked while it's the one open.
  if (noBuild.length && state.activeId === id) askAboutNoBuild(id, mcVersion, noBuild, applied.length);
}

/** Mods with no stable build: nothing happens to them until the player picks. */
function askAboutNoBuild(id, mcVersion, noBuild, appliedCount) {
  const body = el("div");
  body.appendChild(
    el("p", null, `${noBuild.length === 1 ? "This mod has" : `These ${noBuild.length} mods have`} no stable build for ${mcVersion} yet. Left as ${noBuild.length === 1 ? "it is" : "they are"}, Minecraft may not start. Nothing is deleted either way.`)
  );
  const list = el("div", "pick-list nb-list");
  for (const m of noBuild) {
    const row = el("div", "pick-item nb-item");
    const main = el("div");
    main.appendChild(el("b", null, m.title));
    main.appendChild(el("span", null, m.why));
    row.appendChild(main);
    list.appendChild(row);
  }
  body.appendChild(list);
  openModal({
    title: `No ${mcVersion} build yet`,
    body,
    wide: true,
    focusCancel: true,
    buttons: [
      { label: noBuild.length === 1 ? "Leave it" : "Leave them", className: "outline" },
      {
        label: "Find a version that fits everything",
        className: "outline",
        onClick: () => {
          setTimeout(() => openVersionAdvisor(id), 0);
          return true;
        },
      },
      {
        label: noBuild.length === 1 ? "Switch it off" : "Switch them off",
        className: "primary",
        onClick: async () => {
          if (state.running.has(id)) {
            toast("Close the game first — Windows won't let files in use be renamed.");
            return false;
          }
          let off = 0;
          const failed = [];
          for (const m of noBuild) {
            try {
              await window.reminth.setContentEnabled(id, { kind: "mod", world: null, file: m.file }, false);
              off++;
            } catch (err) {
              failed.push(`${m.title}: ${friendlyError(err.message)}`);
            }
          }
          toast(
            [appliedCount ? `Updated ${appliedCount} ${plural(appliedCount, "mod")}` : null, off ? `${off} switched off` : null].filter(Boolean).join(", ") +
              (failed.length ? `. Couldn't switch off ${failed[0]}` : ".") +
              (off ? " Switch them back on in the Mods tab whenever a build comes out." : "")
          );
          if (content.instanceId === id) await loadContent(id);
          await runCompatCheck(id, true);
          return true;
        },
      },
    ],
  });
}

$("instSyncBtn").onclick = () => runModsSync(state.activeId);
$("heroSyncBtn").onclick = () => {
  const inst = heroInstance();
  if (inst) runModsSync(inst.id);
};

/* ================================================================== *
 * 10. the project page in Discover                                    *
 *                                                                     *
 * A click on a result opens the whole project: description, gallery,  *
 * versions, links - from catalog:projectPage (main/projectPage.js,    *
 * which also parses the description with markdown.js). The result list *
 * stays in place underneath, so Back finds the search, filters, page  *
 * and scroll position exactly as they were.                           *
 * ================================================================== */
const projUi = { open: false, id: null, req: 0, scroll: 0, data: null, tab: "description", hint: null, versionsShown: 30 };
const PV_TABS = [
  ["description", "Description"],
  ["gallery", "Gallery"],
  ["versions", "Versions"],
  ["links", "Links"],
];
const CHANNEL_TAGS = { release: ["Release", "emerald"], beta: ["Beta", "amber"], alpha: ["Alpha", "rose"] };

/** Opens a link from a project page in the default browser (main.js checks it again). */
function openProjectLink(href) {
  window.reminth.openLink(href).catch((err) => toast(friendlyError(err.message)));
}

/**
 * Opens a project's page. `hint` (from the search result, if there is one)
 * fills the header straight away while the rest loads.
 */
function openProject(projectId, hint = {}) {
  if (!projectId) return;
  // Opened from somewhere else (an installed mod's menu): Back goes there.
  if (!projUi.open) projUi.from = currentPage !== "discover" ? { page: currentPage, scroll: $("pages").scrollTop } : null;
  if (currentPage !== "discover") switchPage("discover");
  if (!projUi.open) projUi.scroll = $("pages").scrollTop;
  projUi.open = true;
  projUi.id = projectId;
  projUi.hint = hint;
  projUi.data = null;
  projUi.tab = "description";
  projUi.versionsShown = 30;
  $("discover").classList.add("showing-project");
  $("projectView").hidden = false;
  $("pages").scrollTop = 0;
  renderProjectView();
  loadProjectPage(projectId);
}

async function loadProjectPage(projectId) {
  const req = ++projUi.req;
  projUi.error = null;
  try {
    const data = await window.reminth.projectPage(projectId);
    // Gone back, or another project opened meanwhile: this answer is old.
    if (req !== projUi.req || !projUi.open || projUi.id !== projectId) return;
    projUi.data = data;
  } catch (err) {
    if (req !== projUi.req || !projUi.open || projUi.id !== projectId) return;
    projUi.error = friendlyError(err.message);
  }
  renderProjectView();
}

/** Back to the results, exactly as they were. */
function closeProject() {
  if (!projUi.open) return;
  projUi.open = false;
  projUi.req++; // whatever is still loading is now stale
  $("discover").classList.remove("showing-project");
  $("projectView").hidden = true;
  $("projectView").textContent = "";
  if (projUi.from && PAGE_META[projUi.from.page]) {
    const from = projUi.from;
    projUi.from = null;
    switchPage(from.page);
    $("pages").scrollTop = from.scroll;
    return;
  }
  $("pages").scrollTop = projUi.scroll;
  // the card that was opened gets the focus back
  const card = [...document.querySelectorAll("#browseGrid .mod-row.openable")].find((r) => r.querySelector(`[data-project="${CSS.escape(String(projUi.id))}"]`));
  if (card) card.focus({ preventScroll: true });
}

// Esc and the mouse's own Back button go back too (a dialog or menu open on top answers Esc first).
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !projUi.open || currentPage !== "discover") return;
  if (modalStack.length || document.querySelector(".dd-open") || cardMenu) return;
  closeProject();
});
window.addEventListener("mouseup", (e) => {
  if (e.button !== 3 || !projUi.open || currentPage !== "discover" || modalStack.length) return;
  e.preventDefault();
  closeProject();
});

function pvAvatar(person) {
  if (person.avatar) {
    const img = el("img", "pv-avatar");
    img.src = person.avatar;
    img.alt = "";
    img.loading = "lazy";
    img.addEventListener("error", () => img.replaceWith(el("span", "pv-avatar", (person.name || "?").slice(0, 1).toUpperCase())));
    return img;
  }
  return el("span", "pv-avatar", (person.name || "?").slice(0, 1).toUpperCase());
}

/** The Install controls: the same paths (and guards) as the result cards. */
function pvInstallControls(project) {
  const type = project.type;
  const box = el("div", "pv-install");
  if (type === "plugin" || !DTYPES[type] || type === "server") return box;
  const fit = { id: project.id, name: project.title, type, versions: project.gameVersions, loaders: project.loaders };
  const installed = installedProjectIds().has(project.id);
  const btn = button("btn primary pill-like" + (installed ? " installed" : ""), type === "modpack" ? "Install" : installed ? "Installed" : "Install", installed ? "#i-check" : "#i-plus");
  btn.dataset.project = project.id;
  if (type === "modpack") btn.onclick = () => installModpackFlow({ projectId: project.id, title: project.title });
  else {
    btn.dataset.installable = "1";
    btn.title = installTip(installed);
    if (installed) paintInstallButton(btn, true);
    btn.onclick = (e) => {
      e.stopPropagation();
      pickInstanceFor(fit, btn);
    };
  }
  if (type === "mod") {
    const pick = el("button", "btn outline icon-only vpick-btn");
    pick.type = "button";
    pick.title = "Choose version…";
    pick.setAttribute("aria-label", `Choose a version of ${project.title}`);
    pick.appendChild(icon("#i-chevron"));
    pick.onclick = () => chooseModVersion({ projectId: project.id, title: project.title, instanceId: state.activeId }, [btn]);
    const group = el("div", "install-group");
    group.appendChild(btn);
    group.appendChild(pick);
    box.appendChild(group);
  } else box.appendChild(btn);
  return box;
}

function renderProjectView() {
  const view = $("projectView");
  if (!projUi.open) return;
  const scroll = $("pages").scrollTop;
  view.textContent = "";
  const top = el("div", "pv-top");
  const backTo = projUi.from ? (projUi.from.page === "instance" && activeInstance() ? activeInstance().name : (PAGE_META[projUi.from.page] || ["the last page"])[0]) : "results";
  const back = button("btn outline sm pv-back", `Back to ${backTo}`, "#i-chevron");
  back.onclick = () => closeProject();
  top.appendChild(back);
  view.appendChild(top);

  const data = projUi.data;
  const hint = projUi.hint || {};
  const p = data ? data.project : null;

  // ---- header
  const head = el("div", "card pv-head");
  const iconSrc = (p && p.icon) || hint.icon;
  if (iconSrc) {
    const img = el("img", "pv-icon");
    img.src = iconSrc;
    img.alt = "";
    head.appendChild(img);
  } else head.appendChild(el("div", "pv-icon", ((p && p.title) || hint.title || "?").slice(0, 1)));
  const info = el("div", "pv-info");
  info.appendChild(el("h2", "pv-title", (p && p.title) || hint.title || "Loading…"));
  const summary = (p && p.summary) || hint.summary;
  if (summary) info.appendChild(el("p", "pv-summary", summary));
  const by = el("div", "pv-by");
  if (data && data.people.length) {
    by.appendChild(el("span", "pv-by-k", "By"));
    for (const person of data.people.slice(0, 5)) {
      const chip = el("a", "pv-person");
      chip.href = person.url || "#";
      chip.title = person.role ? `${person.name} - ${person.role}` : person.name;
      chip.addEventListener("click", (e) => {
        e.preventDefault();
        if (person.url) openProjectLink(person.url);
      });
      chip.appendChild(pvAvatar(person));
      chip.appendChild(el("span", null, person.name));
      by.appendChild(chip);
    }
  } else if (hint.author) by.appendChild(el("span", "pv-by-k", `By ${hint.author}`));
  info.appendChild(by);
  if (p) {
    const facts = el("div", "pv-facts sep-list");
    const fact = (iconId, text) => {
      const span = el("span", "pv-fact");
      span.appendChild(icon(iconId));
      span.appendChild(document.createTextNode(text));
      return span;
    };
    facts.appendChild(fact("#i-download", `${formatCount(p.downloads) || 0} downloads`));
    facts.appendChild(fact("#i-heart", `${formatCount(p.followers) || 0} followers`));
    if (p.updated) facts.appendChild(fact("#i-clock", `Updated ${formatRelativeTime(p.updated)}`));
    info.appendChild(facts);
    const tags = el("div", "pv-tags");
    const side = p.clientSide && p.serverSide ? (p.serverSide === "unsupported" ? "Client" : p.clientSide === "unsupported" ? "Server" : "Client and server") : null;
    if (side) tags.appendChild(el("span", "tag dim", side));
    for (const c of p.categories.filter((c) => !["fabric", "forge", "neoforge", "quilt", "iris", "optifine", "canvas", "vanilla", "datapack", "minecraft"].includes(c)).slice(0, 8)) tags.appendChild(el("span", "tag dim", prettyTag(c)));
    if (p.license && (p.license.name || p.license.id)) {
      const lic = el("span", "tag dim pv-license", `License: ${p.license.name || p.license.id}`);
      if (p.license.url) {
        lic.title = p.license.url;
        lic.classList.add("is-link");
        clickable(lic, () => openProjectLink(p.license.url));
      }
      tags.appendChild(lic);
    }
    info.appendChild(tags);
  }
  head.appendChild(info);
  const right = el("div", "pv-right");
  if (p) right.appendChild(pvInstallControls(p));
  head.appendChild(right);
  view.appendChild(head);

  if (projUi.error) {
    const err = el("div", "card pv-error");
    err.appendChild(el("b", null, "Couldn't load this project"));
    err.appendChild(el("p", null, projUi.error));
    const retry = button("btn primary sm", "Retry", "#i-refresh");
    retry.onclick = () => {
      projUi.error = null;
      renderProjectView();
      loadProjectPage(projUi.id);
    };
    err.appendChild(retry);
    view.appendChild(err);
    return;
  }
  if (!data) {
    // skeleton while it loads (Back works the whole time)
    const sk = el("div", "pv-skeleton");
    for (const w of [70, 92, 85, 40, 88, 76]) {
      const line = el("div", "pv-sk-line");
      line.style.width = w + "%";
      sk.appendChild(line);
    }
    view.appendChild(sk);
    return;
  }

  // ---- fits / support
  const support = el("div", "card pv-support");
  const inst = activeInstance();
  const fitState = window.ReminthPure.fitsInstance(p.type, data.builds, inst);
  if (fitState.text) {
    const line = el("div", "pv-fit " + fitState.state);
    line.appendChild(icon(fitState.state === "fits" ? "#i-check" : "#i-alert"));
    line.appendChild(el("span", null, fitState.text));
    support.appendChild(line);
  }
  const loaders = p.loaders.filter((l) => !["minecraft", "datapack"].includes(l));
  if (loaders.length) {
    const row = el("div", "pv-sup-row");
    row.appendChild(el("span", "pv-sup-k", "Loaders"));
    for (const l of loaders) row.appendChild(el("span", "tag " + ({ fabric: "cyan", quilt: "violet", forge: "amber", neoforge: "rose" }[l] || "dim"), prettyTag(l)));
    support.appendChild(row);
  }
  const versions = window.ReminthPure.collapseVersions(p.gameVersions);
  if (versions.ranges.length || versions.other) {
    const row = el("div", "pv-sup-row");
    row.appendChild(el("span", "pv-sup-k", "Minecraft"));
    for (const r of versions.ranges.slice(0, 14)) row.appendChild(el("span", "tag dim", r));
    if (versions.ranges.length > 14) row.appendChild(el("span", "pv-sup-more", `+${versions.ranges.length - 14} older`));
    if (versions.other) row.appendChild(el("span", "pv-sup-more", `+ ${versions.other} snapshot${versions.other === 1 ? "" : "s"}`));
    support.appendChild(row);
  }
  view.appendChild(support);

  // ---- tabs
  const counts = { gallery: p.gallery.length, versions: data.builds ? data.builds.length : 0, links: p.links.length + (p.modrinthUrl ? 1 : 0) };
  const tabs = el("nav", "tabs pv-tabs");
  for (const [id, label] of PV_TABS) {
    const t = el("button", "tab" + (projUi.tab === id ? " active" : ""));
    t.type = "button";
    t.appendChild(document.createTextNode(label));
    if (counts[id]) t.appendChild(el("span", "tab-count", String(counts[id])));
    t.onclick = () => {
      projUi.tab = id;
      renderProjectView();
    };
    tabs.appendChild(t);
  }
  view.appendChild(tabs);
  const body = el("div", "pv-body");
  if (projUi.tab === "description") body.appendChild(pvDescription(data));
  else if (projUi.tab === "gallery") body.appendChild(pvGallery(p));
  else if (projUi.tab === "versions") body.appendChild(pvVersions(p, data.builds));
  else body.appendChild(pvLinks(p));
  view.appendChild(body);
  $("pages").scrollTop = scroll;
}

function pvDescription(data) {
  const box = el("div", "card pv-desc");
  box.appendChild(el("p", "pv-credit", "Description by the project's author, shown from Modrinth."));
  const tree = data.body;
  if (!tree || !tree.c || !tree.c.length) {
    box.appendChild(el("p", "set-note", "The author hasn't written a description."));
    return box;
  }
  box.appendChild(window.ReminthMarkdown.toDom(tree, { onLink: openProjectLink, fullUrl: data.project.modrinthUrl }));
  return box;
}

function pvGallery(p) {
  const box = el("div", "pv-gallery");
  if (!p.gallery.length) {
    box.appendChild(el("p", "set-note", "No pictures in this project's gallery."));
    return box;
  }
  for (const g of p.gallery) {
    const fig = el("figure", "card pv-shot");
    if (g.url) {
      const img = el("img");
      img.src = g.url;
      img.alt = g.title || "Gallery picture";
      img.loading = "lazy";
      img.decoding = "async";
      if (g.full) {
        img.title = "Open full size in your browser";
        clickable(img, () => g.link && openProjectLink(g.link));
      }
      fig.appendChild(img);
    } else {
      const ph = el("div", "md-imgblocked pv-shot-ph");
      ph.appendChild(el("span", "md-imgblocked-t", "Image hosted elsewhere"));
      if (g.link) {
        const a = button("btn outline sm", "Open in browser", "#i-external");
        a.onclick = () => openProjectLink(g.link);
        ph.appendChild(a);
      }
      fig.appendChild(ph);
    }
    if (g.title || g.description) {
      const cap = el("figcaption");
      if (g.title) cap.appendChild(el("b", null, g.title));
      if (g.description) cap.appendChild(el("span", null, g.description));
      fig.appendChild(cap);
    }
    box.appendChild(fig);
  }
  return box;
}

function pvVersions(p, builds) {
  const box = el("div", "card pv-versions");
  if (!builds) {
    box.appendChild(el("p", "set-note", "Couldn't read the list of versions - try again in a moment."));
    return box;
  }
  if (!builds.length) {
    box.appendChild(el("p", "set-note", "No versions published yet."));
    return box;
  }
  const inst = activeInstance();
  const kind = p.type;
  for (const b of builds.slice(0, projUi.versionsShown)) box.appendChild(pvVersionRow(p, b, kind, inst));
  if (builds.length > projUi.versionsShown) {
    const more = button("btn outline sm pv-more", `Show more (${builds.length - projUi.versionsShown} older)`);
    more.onclick = () => {
      projUi.versionsShown += 50;
      renderProjectView();
    };
    box.appendChild(more);
  }
  return box;
}

function pvVersionRow(p, b, kind, inst) {
  const row = el("details", "pv-ver");
  const sum = el("summary", "pv-ver-sum");
  const name = el("div", "pv-ver-name");
  name.appendChild(el("b", null, b.number || b.name || "?"));
  if (b.name && b.name !== b.number) name.appendChild(el("span", null, b.name));
  sum.appendChild(name);
  const [label, colour] = CHANNEL_TAGS[b.type] || CHANNEL_TAGS.release;
  sum.appendChild(el("span", "tag " + colour, label));
  const mc = window.ReminthPure.collapseVersions(b.mc);
  sum.appendChild(el("span", "pv-ver-mc", mc.ranges.slice(0, 3).join(", ") + (mc.ranges.length > 3 ? ` +${mc.ranges.length - 3}` : "") || "—"));
  sum.appendChild(el("span", "pv-ver-ld", b.loaders.map(prettyTag).join(", ")));
  sum.appendChild(el("span", "pv-ver-date", b.date ? formatRelativeTime(b.date) : ""));
  sum.appendChild(el("span", "pv-ver-dl", formatCount(b.downloads) || "0"));
  // "Install this version" into the instance Discover is showing (fixed at the click)
  if (kind !== "plugin" && DTYPES[kind]) {
    const go = button("btn outline sm pv-ver-install", "Install", "#i-download");
    const fitsHere = kind === "modpack" || (inst && window.ReminthPure.fitsInstance(kind, [{ ...b, type: "release" }], inst).state === "fits");
    if (!fitsHere) {
      go.disabled = true;
      go.title = inst ? `Not for ${inst.name} (${loaderLabel(inst)} ${inst.mcVersion})` : "";
    } else go.title = kind === "modpack" ? "Install as a new instance" : `Install this version into ${inst.name}`;
    go.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const target = activeInstance();
      const question = window.ReminthPure.buildConfirmText(b);
      // Never a beta or alpha without an explicit yes that names it.
      if (question && !(await confirmModal(`Install ${b.type === "alpha" ? "an" : "a"} ${b.type} build?`, question, `Install the ${b.type}`, true))) return;
      if (kind === "modpack") return installModpackFlow({ projectId: p.id, versionId: b.id, title: p.title });
      if (!target) return;
      installProject({ projectId: p.id, projectType: kind, title: p.title, versionId: b.id, instanceId: target.id }, [go]);
    };
    sum.appendChild(go);
  }
  row.appendChild(sum);
  // The changelog is only read when the row is opened.
  row.addEventListener(
    "toggle",
    () => {
      if (!row.open || row.dataset.filled) return;
      row.dataset.filled = "1";
      const body = el("div", "pv-ver-body");
      if (typeof b.changelog === "string" && b.changelog.trim()) {
        body.appendChild(window.ReminthMarkdown.toDom(window.ReminthMarkdown.parse(b.changelog), { onLink: openProjectLink }));
        if (b.changelogCut) body.appendChild(el("p", "set-note", "The rest of this changelog is on Modrinth."));
      } else body.appendChild(el("p", "set-note", b.changelog === undefined ? "Changelogs are shown for the newest 50 versions." : "No changelog for this version."));
      row.appendChild(body);
    },
    { passive: true }
  );
  return row;
}

function pvLinks(p) {
  const box = el("div", "card pv-links");
  const all = [...p.links];
  if (p.modrinthUrl) all.push({ kind: "modrinth", label: "View on Modrinth", href: p.modrinthUrl });
  if (!all.length) {
    box.appendChild(el("p", "set-note", "No links."));
    return box;
  }
  for (const l of all) {
    const row = el("button", "pv-link");
    row.type = "button";
    row.title = l.href;
    row.appendChild(icon(l.kind === "modrinth" ? "#i-compass" : "#i-link"));
    const text = el("span", "pv-link-text");
    text.appendChild(el("b", null, l.label));
    text.appendChild(el("span", "pv-link-href", l.href));
    row.appendChild(text);
    row.appendChild(icon("#i-external", "i pv-link-ext"));
    row.onclick = () => openProjectLink(l.href);
    box.appendChild(row);
  }
  return box;
}

/* ================================================================== *
 * wiring that depends on instances                                    *
 * ================================================================== */
window.onInstancesChanged = () => {
  const inst = activeInstance();
  if (!inst) return;
  // Home's hero can be another instance than the selected one: check its
  // mods too, so Home's "Update mods to fit" knows about them.
  const hero = heroInstance();
  if (hero && hero.id !== inst.id && hero.loader !== "vanilla" && !compatUi.results.has(hero.id)) scheduleCompatCheck(hero.id);
  paintSyncButtons();
  renderInstallTarget();
  paintHomeCards();
  loadPresence();
  $("gameDirPath").textContent = inst.gameDir || "—";
  loadContent(inst.id);
  // Discover lists what fits this instance. Only when THAT changed (another
  // instance, or its version/loader/name) is the list fetched again - from
  // page 1, since page 3 of the old list may not exist in the new one. A game
  // closing also lands here and must not throw the player back to the top.
  const fit = `${inst.id}|${inst.name}|${inst.loader}|${inst.mcVersion}`;
  const changed = fit !== disc.fit;
  disc.fit = fit;
  // An open project page's "Fits your instance" line is about this instance.
  if (changed && projUi.open && projUi.data) renderProjectView();
  if (changed && currentPage === "discover") {
    disc.page = 1;
    renderFilterPanel().then(() => runBrowse());
  }
};

window.bootFeatures = () => {
  setTimeout(warmSkinsPage, 4000);
  buildDiscover();
  applyStreamerUi(state.settings);
  paintPerfSettings(state.settings);
  window.reminth.onCatalogWarmProgress((status) => {
    if (status.project_type === "mod" && status.state === "done") buildDiscover();
    if (currentPage === "discover" && status.project_type === disc.type && isDefaultView()) runBrowse();
  });
};
