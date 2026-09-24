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
  updating: false,
};

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
  const isContent = Boolean(CONTENT_TABS[tab]);
  $("contentToolbar").hidden = !isContent;
  $("updatePanel").hidden = !isContent || !content.updates || !content.updates.length;
  if (isContent) renderContentTab();
  if (tab === "tabLogs") loadLogSessions();
  if (tab === "tabWorlds" || tab === "tabServers") loadInstanceData();
});

$("contentSearch").addEventListener("input", (e) => {
  content.search = e.target.value;
  renderContentTab();
});
$("openContentFolder").onclick = () => openFolder(CONTENT_TABS[content.tab] ? CONTENT_TABS[content.tab].folder : "game");
$("addContentBtn").onclick = () => {
  const t = CONTENT_TABS[content.tab];
  switchPage("discover");
  setDiscoverType(t ? t.discover : "mod");
};

async function loadContent(instanceId) {
  const id = instanceId || state.activeId;
  let data;
  try {
    data = await window.reminth.content(id);
  } catch (err) {
    data = { mod: [], resourcepack: [], shader: [], datapack: [], worlds: [], error: err.message };
  }
  if (id !== content.instanceId) {
    content.updates = null;
    $("updatePanel").hidden = true;
  }
  content.instanceId = id;
  content.data = data;
  for (const t of Object.values(CONTENT_TABS)) {
    const n = (data[t.kind] || []).filter((i) => i.valid).length;
    $(t.count).textContent = n ? String(n) : "";
  }
  $("instMods").textContent = String((data.mod || []).filter((i) => i.valid && i.enabled).length);
  if (currentPage === "instance") renderContentTab();
  if (id === state.activeId) renderHeadMods(data.mod || []);
  paintUpdateButton();
  refreshInstalledMarks();
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

function itemName(item) {
  return item.title || item.name || item.file.replace(/\.(jar|zip)(\.disabled)?$/i, "");
}

function contentIcon(item) {
  const src = safeIconUrl(item.iconUrl) || safeIconUrl(item.icon);
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

function contentRow(item, updatesByFile) {
  const row = el("div", "content-row" + (item.enabled ? "" : " disabled") + (item.valid ? "" : " invalid"));
  row.appendChild(contentIcon(item));
  const main = el("div", "c-main");
  main.appendChild(el("div", "c-name", itemName(item)));
  const sub = el("div", "c-sub");
  if (item.problem) {
    sub.appendChild(el("span", "warn", item.problem));
    sub.appendChild(document.createTextNode(" · " + item.file));
  } else {
    const version = item.versionNumber || item.modVersion;
    sub.textContent = [item.file, version && !item.file.includes(version) ? version : null, item.size ? formatBytes(item.size) : null].filter(Boolean).join(" · ");
  }
  main.appendChild(sub);
  row.appendChild(main);

  const actions = el("div", "c-actions");
  const up = updatesByFile.get(item.world + "/" + item.file);
  if (up) actions.appendChild(el("span", "update-chip", `Update → ${up.next.versionNumber}`));
  if (item.valid) {
    const sw = el("button", "switch" + (item.enabled ? " on" : ""));
    sw.type = "button";
    sw.title = item.enabled ? "Turn off" : "Turn on";
    sw.onclick = async () => {
      try {
        await window.reminth.setContentEnabled(content.instanceId, { kind: item.kind, world: item.world, file: item.file }, !item.enabled);
        await loadContent(content.instanceId);
      } catch (err) {
        toast(friendlyError(err.message));
      }
    };
    actions.appendChild(sw);
  }
  const del = el("button", "icon-btn danger");
  del.type = "button";
  del.title = "Move to Recycle Bin";
  del.appendChild(icon("#i-trash"));
  del.onclick = async () => {
    const ok = await confirmModal(`Remove ${itemName(item)}?`, "It goes to the Recycle Bin, so you can get it back if you change your mind.", "Remove", true);
    if (!ok) return;
    try {
      await window.reminth.removeContent(content.instanceId, { kind: item.kind, world: item.world, file: item.file });
      toast(`${itemName(item)} moved to the Recycle Bin.`);
      await loadContent(content.instanceId);
    } catch (err) {
      toast(friendlyError(err.message));
    }
  };
  actions.appendChild(del);
  row.appendChild(actions);
  return row;
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

function renderContentTab() {
  const t = CONTENT_TABS[content.tab];
  if (!t || !content.data) return;
  const list = $(t.list);
  const inst = instanceById(content.instanceId);
  if (t.kind === "mod") {
    const grid = $("instManagedMods");
    grid.textContent = "";
    if (inst && inst.hud && (inst.loader === "fabric" || inst.loader === "quilt") && state.info) {
      state.info.managedMods.forEach((m) => grid.appendChild(managedModCard(m)));
      grid.style.marginBottom = "14px";
    }
  }
  const q = content.search.trim().toLowerCase();
  let items = content.data[t.kind] || [];
  if (q) items = items.filter((i) => itemName(i).toLowerCase().includes(q) || i.file.toLowerCase().includes(q));
  items = sortItems(items, content.sort, itemName, (i) => i.addedAt);
  list.textContent = "";
  if (content.data.error) return renderEmpty(list, "Couldn't read this instance's folders", content.data.error);
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
  const updatesByFile = new Map((content.updates || []).map((u) => [u.world + "/" + u.file, u]));
  if (t.kind === "datapack") {
    let lastWorld = null;
    for (const item of sortItems(items, content.sort, (i) => i.world + " " + itemName(i), (i) => i.addedAt)) {
      if (item.world !== lastWorld) {
        lastWorld = item.world;
        list.appendChild(el("div", "world-group", item.world));
      }
      list.appendChild(contentRow(item, updatesByFile));
    }
  } else {
    items.forEach((item) => list.appendChild(contentRow(item, updatesByFile)));
  }
}

/* ---- the "Head" panel on Discover: what's in the active instance's mods folder ---- */
const MANAGED_JAR = /^(fabric-api|reminthhud)-/i;
function renderHeadMods(mods) {
  const list = $("installedMods");
  const valid = mods.filter((m) => m.valid);
  const other = mods.length - valid.length;
  $("modsFolderNote").textContent = `${valid.length} mod${valid.length === 1 ? "" : "s"}` + (other ? ` · ${other} other file${other === 1 ? "" : "s"}` : "");
  list.textContent = "";
  if (!mods.length) {
    const inst = activeInstance();
    renderEmpty(list, "Empty", inst && inst.loader === "vanilla" ? "This instance is vanilla — no mods folder in use." : "Drop .jar files in and they appear here instantly.");
    return;
  }
  const sorted = sortItems(mods, "az", (m) => (m.valid ? "0" : "1") + itemName(m), () => 0);
  for (const m of sorted) {
    const row = el("div", "mod-row" + (m.valid ? "" : " invalid"));
    row.title = m.problem || m.file;
    row.appendChild(el("span", "jar", m.file));
    if (!m.valid) row.appendChild(el("span", "tag amber", m.folder ? "Folder" : "Not a mod"));
    else if (!m.enabled) row.appendChild(el("span", "tag dim", "Off"));
    else if (MANAGED_JAR.test(m.file) && activeInstance() && activeInstance().hud) row.appendChild(el("span", "tag cyan", "Reminth"));
    else row.appendChild(el("span", "tag dim", "Yours"));
    list.appendChild(row);
  }
}

// Live: the main process watches the active instance's folders.
window.reminth.onContentChanged(({ instanceId }) => {
  if (instanceId === state.activeId) loadContent(instanceId);
});

/* ---- update everything ---- */
function paintUpdateButton(progressPct) {
  const btn = $("updateAllBtn");
  const text = $("updateAllText");
  btn.classList.remove("ready", "busy", "muted");
  btn.style.setProperty("--p", "0%");
  btn.disabled = false;
  if (content.updating) {
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
    list.appendChild(row);
  }
  panel.appendChild(list);
  panel.hidden = false;
}

$("updateAllBtn").onclick = async () => {
  if (content.updating) return;
  const id = content.instanceId || state.activeId;
  if (content.updates && content.updates.length) {
    if (state.running.has(id)) {
      toast("Close the game first — Windows won't let files in use be replaced.");
      return;
    }
    content.updating = "apply";
    paintUpdateButton(0);
    try {
      const result = await window.reminth.applyUpdates(id, content.updates);
      content.updates = null;
      toast(result.failed.length ? `Updated ${result.applied.length}, ${result.failed.length} failed: ${result.failed[0].error}` : `Updated ${result.applied.length} item${result.applied.length === 1 ? "" : "s"}.`);
    } catch (err) {
      toast(friendlyError(err.message));
    } finally {
      content.updating = false;
      $("updatePanel").hidden = true;
      await loadContent(id);
    }
    return;
  }
  content.updating = "check";
  paintUpdateButton(0);
  try {
    content.updates = await window.reminth.checkUpdates(id);
  } catch (err) {
    content.updates = null;
    toast("Couldn't check for updates: " + friendlyError(err.message));
  } finally {
    content.updating = false;
    paintUpdateButton();
    renderUpdatePanel();
    renderContentTab();
  }
};

window.reminth.onContentProgress((p) => {
  if (p.op === "update" && content.updating === "apply") {
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
  $("instWorlds").textContent = String(data.worldCount || 0);
  fillGrid("worldGrid", data.worlds || [], "worldsNote", { emptyTitle: "No worlds yet", emptyNote: "Any world you create in this instance shows up here." });
  fillGrid("instServerGrid", data.servers || [], "instServersNote", { emptyTitle: "No servers saved here", emptyNote: "Add one in game, or from Discover → Servers." });
}

window.onInstancePageOpen = (inst) => {
  loadContent(inst.id);
  loadInstanceData();
  if (content.tab === "tabLogs") loadLogSessions();
  const isContent = Boolean(CONTENT_TABS[content.tab]);
  $("contentToolbar").hidden = !isContent;
};

/* ================================================================== *
 * installing from Discover / Home                                     *
 * ================================================================== */
const pendingInstalls = new Map(); // projectId -> { buttons: Set<HTMLElement> }

function installProgress(p) {
  const pct = p.total > 1 ? Math.min(100, Math.round((p.current / p.total) * 100)) : null;
  for (const [, entry] of pendingInstalls) {
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
 * Installs a project into the active instance. `buttons`: elements that
 * should show progress / the installed state.
 */
async function installProject({ projectId, projectType, title, versionId }, buttons = []) {
  const inst = activeInstance();
  if (!inst) return false;
  if (projectType === "modpack") return installModpackFlow({ projectId, title });
  const kind = { mod: "mod", resourcepack: "resourcepack", shader: "shader", datapack: "datapack" }[projectType];
  if (!kind) return false;
  if ((kind === "mod" || kind === "shader") && inst.loader === "vanilla") {
    toast(`${inst.name} is a vanilla instance — ${kind === "mod" ? "mods" : "shaders"} need a loader. Edit it and pick Fabric, Quilt, Forge or NeoForge first.`);
    return false;
  }
  let world = null;
  if (kind === "datapack") {
    world = await pickWorld(inst);
    if (!world) return false;
  }
  const entry = { buttons: new Set(buttons) };
  pendingInstalls.set(projectId, entry);
  for (const b of buttons) {
    b.disabled = true;
    b.classList.add("busy");
  }
  try {
    // versionId: set only when the player picked one (chooseModVersion);
    // otherwise content.install picks the best match itself, as before.
    const result = await window.reminth.installContent(inst.id, { projectId, kind, world, ...(versionId ? { versionId } : {}) });
    const extra = result.installed.length > 1 ? ` (+${result.installed.length - 1} it needs)` : "";
    toast(`${title || result.installed[0]?.title || "Installed"} added to ${inst.name}${extra}.`);
    await loadContent(inst.id);
    return true;
  } catch (err) {
    toast(friendlyError(err.message));
    return false;
  } finally {
    pendingInstalls.delete(projectId);
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
// content.install would accept for this instance.
function modLoadersFor(inst) {
  if (inst.loader === "fabric") return ["fabric"];
  if (inst.loader === "quilt") return ["quilt", "fabric"];
  if (inst.loader === "forge") return ["forge"];
  if (inst.loader === "neoforge") return inst.mcVersion === "1.20.1" ? ["neoforge", "forge"] : ["neoforge"];
  return [];
}
// Mirrors content.js pickVersion: newest release, else newest of any kind.
const defaultVersion = (versions) => versions.find((v) => v.version_type === "release") || versions[0] || null;
const DEP_LABELS = { required: "Required", optional: "Optional", incompatible: "Incompatible", embedded: "Bundled inside" };

async function chooseModVersion({ projectId, title }, buttons = []) {
  const inst = activeInstance();
  if (!inst) return false;
  const loaders = modLoadersFor(inst);
  if (!loaders.length) return installProject({ projectId, projectType: "mod", title }, buttons); // shows the vanilla message
  if (content.instanceId !== inst.id || !content.data) await loadContent(inst.id);

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
    title: `Install ${title || "mod"}`,
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
          installed = await installProject({ projectId, projectType: "mod", title, versionId: chosen.id }, buttons);
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

  const have = installedProjectIds();
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
  const add = el("button", "dcard-add");
  add.type = "button";
  add.title = "Add to your instance (right-click to choose a version)";
  add.appendChild(icon("#i-plus"));
  add.dataset.project = mod.id;
  add.addEventListener("contextmenu", async (e) => {
    e.preventDefault();
    if (add.classList.contains("done")) return toast(`${mod.name} is already in ${activeInstance().name}.`);
    if (await chooseModVersion({ projectId: mod.id, title: mod.name }, [add])) markAdded(add);
  });
  add.onclick = async () => {
    if (add.classList.contains("done")) return toast(`${mod.name} is already in ${activeInstance().name}.`);
    add.classList.add("busy");
    const ok = await installProject({ projectId: mod.id, projectType: "mod", title: mod.name }, [add]);
    add.classList.remove("busy");
    if (ok) markAdded(add);
  };
  art.appendChild(add);
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

function markAdded(btn) {
  btn.classList.add("done");
  btn.textContent = "";
  btn.appendChild(icon("#i-check"));
  btn.title = "In your instance";
}

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
  for (const mod of DISCOVER_MODS) {
    const hit = found[mod.slug];
    grid.appendChild(discoverCard({ ...mod, id: (hit && hit.id) || mod.id, icon_url: hit && hit.icon_url }));
  }
  refreshInstalledMarks();
}

function refreshInstalledMarks() {
  const ids = installedProjectIds();
  document.querySelectorAll("[data-project]").forEach((b) => {
    const installed = ids.has(b.dataset.project);
    if (b.classList.contains("dcard-add")) {
      if (installed && !b.classList.contains("done")) markAdded(b);
    } else if (b.dataset.installable === "1") {
      b.classList.toggle("installed", installed);
      const label = b.querySelector("span");
      if (label && !b.classList.contains("busy")) label.textContent = installed ? "Installed" : "Install";
    }
  });
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

function setDiscoverType(type) {
  if (!DTYPES[type]) return;
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

let browseTimer = null;
$("browseSearch").addEventListener("input", (e) => {
  clearTimeout(browseTimer);
  const value = e.target.value;
  browseTimer = setTimeout(() => {
    disc.query = value;
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
    disc.tags = [];
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

/** Pure-ish: the Modrinth loaders whose mods can run on this instance. */
function modLoadersFor(inst) {
  if (!inst) return ["__none__"];
  if (inst.loader === "fabric") return ["fabric"];
  if (inst.loader === "quilt") return ["quilt", "fabric"];
  if (inst.loader === "forge") return ["forge"];
  if (inst.loader === "neoforge") return inst.mcVersion === "1.20.1" ? ["neoforge", "forge"] : ["neoforge"];
  return ["__none__"];
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

async function renderFilterPanel() {
  const panel = $("filterPanel");
  panel.textContent = "";
  const type = disc.type;
  const inst = activeInstance();
  const f = disc.filters;

  if (type !== "modpack" && type !== "server" && inst) {
    const nodes = [
      fpToggle(`Works with ${inst.name}`, f.compatible, (on) => {
        f.compatible = on;
        filtersChanged();
      }),
      el("div", "fp-note", f.compatible ? `Only showing ${DTYPES[type].label} for ${loaderLabel(inst)} ${inst.mcVersion}.` : "Showing everything - some of it may not run on this instance."),
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
  if (disc.type !== type) return; // switched tabs while tags loaded
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
    if (type === "mod") params.loaders = modLoadersFor(inst);
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
  main.appendChild(tags);
  row.appendChild(main);

  const side = el("div", "mrow-side");
  const pid = p.project_id || p.id;
  const installed = installedProjectIds().has(pid);
  const btn = button("btn outline sm pill-like" + (installed ? " installed" : ""), type === "modpack" ? "Install" : installed ? "Installed" : "Install", installed ? "#i-check" : "#i-plus");
  btn.dataset.project = pid;
  if (type !== "modpack") btn.dataset.installable = "1";
  btn.onclick = async () => {
    if (btn.classList.contains("installed")) return toast(`${p.title} is already in ${activeInstance().name}.`);
    const ok = await installProject({ projectId: pid, projectType: type, title: p.title }, [btn]);
    if (ok && type !== "modpack") {
      btn.classList.add("installed");
      btn.querySelector("span").textContent = "Installed";
    }
  };
  if (type === "mod") {
    // Install stays one click; the chevron is the optional "pick a version" path.
    const pick = el("button", "btn outline sm icon-only vpick-btn");
    pick.type = "button";
    pick.title = "Choose version…";
    pick.setAttribute("aria-label", `Choose a version of ${p.title}`);
    pick.appendChild(icon("#i-chevron"));
    pick.onclick = async () => {
      const ok = await chooseModVersion({ projectId: pid, title: p.title }, [btn]);
      if (ok) {
        btn.classList.add("installed");
        btn.querySelector("span").textContent = "Installed";
      }
    };
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
        disc.filters.compatible && disc.type !== "modpack" && inst
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
  add.title = `Add to ${activeInstance() ? activeInstance().name : "your"} server list`;
  add.onclick = async () => {
    if (!s.address) return toast("This server hasn't published an address.");
    try {
      const r = await window.reminth.addServer(state.activeId, { name: s.title, address: s.address });
      toast(r.added ? `${s.title} added to ${activeInstance().name}'s server list.` : `${s.title} is already in that list.`);
    } catch (err) {
      toast(friendlyError(err.message));
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
async function playServer(s, btn) {
  if (!state.signedIn) return toast("Sign in first.");
  const join = parseAddress(s.address);
  if (!join) return toast("This server hasn't published an address.");
  const c = s.content;
  if (c.kind === "modpack") {
    const existing = state.instances.find((i) => i.modpack && i.modpack.projectId === c.projectId);
    if (existing) return runPlay({ instanceId: existing.id, join });
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
  if (active && fits(active)) return runPlay({ instanceId: active.id, join });
  const other = state.instances.find(fits);
  if (other) {
    const ok = await confirmModal(`Play ${s.title} on ${other.name}?`, `${s.title} runs ${supported.slice(0, 3).join(", ")}${supported.length > 3 ? "…" : ""}. ${other.name} (${other.mcVersion}) can join it.`, "Play");
    if (ok) runPlay({ instanceId: other.id, join });
    return;
  }
  const version = c.recommendedVersion || supported[0];
  if (!version) return toast("This server doesn't say which version it runs.");
  const ok = await confirmModal(
    `Make an instance for ${s.title}?`,
    [`${s.title} runs Minecraft ${version}, and none of your instances are on it. Reminth can make a vanilla ${version} instance and join straight away.`],
    "Create and play"
  );
  if (!ok) return;
  btn.disabled = true;
  try {
    const inst = await window.reminth.createInstance({ name: `${s.title}`.slice(0, 40), mcVersion: version, loader: "vanilla" });
    await loadInstances();
    await selectInstance(inst.id, false);
    runPlay({ instanceId: inst.id, join });
  } catch (err) {
    toast(friendlyError(err.message));
  } finally {
    btn.disabled = false;
  }
}

pageHooks.discover = () => {
  if (!sortDd) setDiscoverType(disc.type);
  else renderFilterPanel();
};

/* ================================================================== *
 * 4. logs                                                             *
 * ================================================================== */
const logState = { sessions: [], current: null, data: null, show: new Set([0, 1, 2, 3, 4]), search: "", rows: [] };
const ROW_H = 20;

async function loadLogSessions() {
  const inst = activeInstance();
  const box = $("logSessions");
  box.textContent = "";
  box.appendChild(el("div", "fp-note", "Reading logs…"));
  try {
    logState.sessions = await window.reminth.logs(inst.id);
  } catch (err) {
    logState.sessions = [];
    box.textContent = "";
    box.appendChild(el("div", "fp-note", friendlyError(err.message)));
    return;
  }
  box.textContent = "";
  if (!logState.sessions.length) {
    box.appendChild(el("div", "fp-note", "No logs yet. Play once and every session is kept here for good."));
    $("logMeta").textContent = "Nothing to show yet.";
    $("logRows").textContent = "";
    $("logSpacer").style.height = "0px";
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
  if (!logState.current || !logState.sessions.some((s) => s.id === logState.current)) openLog(logState.sessions[0].id);
}

async function openLog(id) {
  const inst = activeInstance();
  logState.current = id;
  document.querySelectorAll(".log-session").forEach((b, i) => b.classList.toggle("active", logState.sessions[i] && logState.sessions[i].id === id));
  $("logMeta").textContent = "Loading…";
  try {
    logState.data = await window.reminth.readLog(inst.id, id);
  } catch (err) {
    logState.data = null;
    $("logMeta").textContent = friendlyError(err.message);
    return;
  }
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
    chip.classList.toggle("active", logState.show.has(cat));
    filterLog();
  };
});
$("logOnlyImportant").onclick = () => {
  const only = logState.show.size === 1 && logState.show.has(4);
  logState.show = only ? new Set([0, 1, 2, 3, 4]) : new Set([4]);
  document.querySelectorAll("#logFilters .log-chip").forEach((c) => c.classList.toggle("active", logState.show.has(Number(c.dataset.cat))));
  $("logOnlyImportant").lastChild.textContent = only ? "Only important" : "Show everything";
  filterLog();
};
$("logCopyBtn").onclick = async () => {
  const d = logState.data;
  if (!d || !logState.rows.length) return toast("Nothing to copy.");
  const session = logState.sessions.find((s) => s.id === logState.current);
  const inst = activeInstance();
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
const skins = { viewer: null, profile: null, library: [], defaults: null, profileLoaded: false, autoSaved: false };

function currentSkinTexture() {
  const s = state.accountSkin;
  if (s && s.dataUrl) return { dataUrl: s.dataUrl, model: s.model || "classic" };
  return { dataUrl: fallbackSkinTexture(), model: (s && s.model) || "classic" };
}

function ensureViewer() {
  if (!skins.viewer) skins.viewer = new SkinViewer($("skinViewport"), { scale: 10.5, yaw: -22 });
  return skins.viewer;
}

window.onAccountSkin = (skin) => {
  const v = ensureViewer();
  if (!state.signedIn) {
    $("skinName").textContent = "Not signed in";
    $("skinModel").textContent = "Sign in to change your skin";
    v.setSkin(fallbackSkinTexture(), "classic");
    return;
  }
  const t = currentSkinTexture();
  v.setSkin(t.dataUrl, t.model);
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
  tile.appendChild(el("span", "skin-label", label));
  if (onRename || onDelete) {
    const actions = el("div", "tile-actions");
    const action = (title, iconId, fn, cls) => {
      const b = el("button", cls);
      b.type = "button";
      b.title = title;
      b.appendChild(icon(iconId));
      b.onclick = (e) => {
        e.stopPropagation();
        fn();
      };
      actions.appendChild(b);
    };
    if (onRename) action("Rename", "#i-edit", onRename);
    if (onDelete) action("Forget this skin", "#i-trash", onDelete, "danger");
    tile.appendChild(actions);
  }
  tile.onclick = onClick;
  return tile;
}

function addSkinTile() {
  const tile = el("div", "skin-tile add");
  tile.appendChild(icon("#i-upload"));
  tile.appendChild(el("b", null, "Add a skin"));
  tile.appendChild(el("span", null, "Drop a PNG here or click"));
  tile.onclick = () => $("skinFile").click();
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
  reader.onload = () => openSkinEditor({ dataUrl: reader.result, variant: "classic", name: file.name.replace(/\.png$/i, ""), source: "upload" });
  reader.readAsDataURL(file);
}
$("skinFile").onchange = (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (file) readSkinFile(file);
};

async function loadSkinLibrary() {
  const grid = $("savedSkins");
  try {
    skins.library = await window.reminth.skinLibrary();
  } catch {
    skins.library = [];
  }
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
          await window.reminth.skinLibraryRemove(s.id);
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
  const grid = $("defaultSkins");
  if (!skins.defaults) {
    try {
      skins.defaults = await window.reminth.skinDefaults();
    } catch (err) {
      skins.defaults = { skins: [], error: err.message };
    }
  }
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
async function openSkinEditor({ dataUrl, variant, name, source, defaultSkin, isCurrent }) {
  if (!state.signedIn) return toast("Sign in to change your skin.");
  const draft = { dataUrl, variant: variant === "slim" ? "slim" : "classic", name, source, capeId: undefined };
  if (!skins.profileLoaded) {
    await loadSkinProfile();
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
    reader.onload = () => {
      draft.dataUrl = reader.result;
      draft.source = "upload";
      draft.name = file.name.replace(/\.png$/i, "");
      viewer.setSkin(draft.dataUrl, draft.variant);
    };
    reader.readAsDataURL(file);
  };

  openModal({
    title: "Editing skin",
    body,
    wide: true,
    onClose: () => viewer.destroy(),
    buttons: [
      { label: "Cancel", className: "outline", icon: "#i-x" },
      {
        label: "Save skin",
        className: "primary",
        icon: "#i-check",
        onClick: async () => {
          if (draft.dataUrl === fallbackSkinTexture()) {
            toast("Pick a skin first — that's Reminth's placeholder figure.");
            return false;
          }
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
            toast(friendlyError(err.message));
            return false;
          }
        },
      },
    ],
  });
  void isCurrent;
}

pageHooks.skins = () => {
  ensureViewer();
  if (window.onAccountSkin) window.onAccountSkin(state.accountSkin);
  loadSkinProfile();
  loadSkinLibrary();
  loadDefaultSkins();
};

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

function saveStreamer(patch) {
  const current = (state.settings && state.settings.streamer) || {};
  return saveSetting({ streamer: { ...current, ...patch } });
}

window.onSettingsSaved = (settings, problems) => applyStreamerUi(settings, problems);

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
document.querySelectorAll(".key-btn").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll(".key-btn").forEach((b) => b.classList.remove("listening"));
    streamerUi.listening = btn.dataset.key;
    btn.classList.add("listening");
    btn.textContent = "Press a key…";
  };
});
document.addEventListener("keydown", (e) => {
  if (!streamerUi.listening) return;
  e.preventDefault();
  e.stopPropagation();
  const key = streamerUi.listening;
  const done = () => {
    streamerUi.listening = null;
    document.querySelectorAll(".key-btn").forEach((b) => b.classList.remove("listening"));
    applyStreamerUi(state.settings);
  };
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
  if (state.settings.streamer[other] === accel) {
    toast("That key is already your other hotkey.");
    return done();
  }
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
  const r = await window.reminth.screenshot();
  if (r && r.error) toast(r.error);
};
$("capClipBtn").onclick = async () => {
  $("capClipBtn").disabled = true;
  try {
    const r = await window.reminth.saveClip();
    if (r && r.error) toast(r.error);
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
    folder.onclick = () => window.reminth.openCapture(c.path, "folder");
    const del = el("button", "icon-btn danger");
    del.title = "Move to Recycle Bin";
    del.appendChild(icon("#i-trash"));
    del.onclick = async () => {
      await window.reminth.deleteCapture(c.path);
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
 * wiring that depends on instances                                    *
 * ================================================================== */
window.onInstancesChanged = () => {
  const inst = activeInstance();
  if (!inst) return;
  $("gameDirPath").textContent = inst.gameDir || "—";
  loadContent(inst.id);
  if (currentPage === "discover") renderFilterPanel().then(() => runBrowse());
};

window.bootFeatures = () => {
  buildDiscover();
  applyStreamerUi(state.settings);
  window.reminth.onCatalogWarmProgress((status) => {
    if (status.project_type === "mod" && status.state === "done") buildDiscover();
    if (currentPage === "discover" && status.project_type === disc.type && isDefaultView()) runBrowse();
  });
};
