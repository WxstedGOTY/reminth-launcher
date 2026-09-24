"use strict";
/**
 * Reminth's UI layer.
 *
 * What's wired to something real: sign-in, Play/install, the RAM and window
 * settings, folder shortcuts, and every number on Home / Instance / Player
 * Statistics (all read out of the player's own save files by gameData.js).
 *
 * What isn't yet, and says so on screen: browsing/installing mods, uploading
 * a skin, multiple instances, hosting a server. Those are labelled "Soon"
 * rather than faked.
 */

const $ = (id) => document.getElementById(id);
const TICKS_PER_SECOND = 20;

const state = {
  signedIn: false,
  logError: false,
  username: null,
  settings: null,
  info: null,
  recent: null,
  stats: null,
  installing: false,
};

/* ================================================================== *
 * window chrome                                                       *
 * ================================================================== */
$("minBtn").onclick = () => window.reminth.minimize();
$("maxBtn").onclick = () => window.reminth.maximizeToggle();
$("closeBtn").onclick = () => window.reminth.close();

// Double-clicking the title bar maximizes, like any normal Windows window -
// -webkit-app-region:drag doesn't give you that on a frameless window.
document.querySelector(".topbar").addEventListener("dblclick", (e) => {
  if (e.target.closest("button")) return;
  window.reminth.maximizeToggle();
});

window.reminth.onMaximized((isMaximized) => {
  $("maxBtn").querySelector("span").className = isMaximized ? "wc-max restore" : "wc-max";
  $("maxBtn").title = isMaximized ? "Restore" : "Maximize";
});

/* ================================================================== *
 * navigation                                                          *
 * ================================================================== */
const PAGE_META = {
  home: ["Reminth Launcher", "Your Minecraft, your way."],
  instance: ["Instance", "The mods, packs and version you play on."],
  library: ["Library", "Instances, worlds, servers and realms."],
  mods: ["Content", "What's loaded in your game."],
  skins: ["Appearance", "How you look in game."],
  hosting: ["Servers", "Play together without the setup."],
  stats: ["Your record", "Everything you've done so far."],
  settings: ["Configuration", "Make Reminth work the way you want."],
};

function switchPage(page) {
  if (!PAGE_META[page]) return;
  // Signed out, Home is the only page - it shows the sign-in card instead of
  // the player's instances. Every other route (rail, tiles, sidebar, hotkeys)
  // funnels through here, so this one check keeps a shared PC's next user
  // out of the last player's instances, worlds, mods and servers.
  if (!state.signedIn && page !== "home") return;
  document.querySelectorAll(".page").forEach((p) => p.classList.toggle("active", p.id === page));
  document.querySelectorAll(".rail-btn[data-page]").forEach((b) =>
    b.classList.toggle("active", b.dataset.page === page)
  );
  $("statsBtn").classList.toggle("active", page === "stats");
  $("hostBtn").classList.toggle("active", page === "hosting");
  // Reminth+ / Host a server / Rules only make sense while browsing mods -
  // the sidebar itself (Playing as / What's new) stays up on every page.
  $("appSideMods").style.display = page === "mods" ? "flex" : "none";
  $("topEyebrow").textContent = PAGE_META[page][0];
  $("topTitle").textContent = PAGE_META[page][1];
  $("pages").scrollTop = 0;

  // Pages that read from disk refresh when you open them, so they're never
  // showing numbers from before your last play session.
  if (page === "stats") loadStats();
  if (page === "mods") loadInstalledMods();
  if (page === "instance") {
    loadInstalledMods();
    loadPacks();
  }
  if (page === "instance" || page === "home" || page === "library") loadRecent();
}

/**
 * Tab strips (Instance, Library). Each button names the pane it shows; a
 * button with no data-tab (the Instance page's "Files") is an action, not a
 * pane, so it never takes the active state.
 */
function wireTabs(navId) {
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
    };
  });
}
wireTabs("instanceTabs");
wireTabs("libraryTabs");
wireTabs("browseTabs");

document.addEventListener("click", (e) => {
  const target = e.target.closest("[data-page]");
  if (target && !target.disabled) switchPage(target.dataset.page);
});

/* ================================================================== *
 * rail tooltips - fade in only once the cursor has settled            *
 * ================================================================== */
const tip = $("tip");
let tipTimer = null;

function showTipFor(el) {
  const text = el.dataset.tip;
  if (!text) return;
  tipTimer = setTimeout(() => {
    const box = el.getBoundingClientRect();
    tip.textContent = text;
    tip.classList.add("show");
    // Measure after the text is in so the vertical centring is right.
    const tipBox = tip.getBoundingClientRect();
    tip.style.left = box.right + 12 + "px";
    tip.style.top = box.top + box.height / 2 - tipBox.height / 2 + "px";
  }, 500);
}

function hideTip() {
  clearTimeout(tipTimer);
  tip.classList.remove("show");
}

// Exposed (not just run once at load) so tiles built later - e.g. the "+"
// add-tile, which doesn't exist until loadRecent() first runs - still get
// the same hover-tooltip behaviour as everything wired up at startup.
function bindTip(el) {
  el.addEventListener("mouseenter", () => showTipFor(el));
  el.addEventListener("mouseleave", hideTip);
  el.addEventListener("click", hideTip);
}

document.querySelectorAll("[data-tip]").forEach(bindTip);

/* ================================================================== *
 * small helpers                                                       *
 * ================================================================== */
function toast(message) {
  $("toastText").textContent = message;
  $("toast").classList.add("show");
  clearTimeout(window._toast);
  window._toast = setTimeout(() => $("toast").classList.remove("show"), 3200);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Ticks -> "3h 12m". Minecraft counts play time in 20-tick seconds. */
function formatPlaytime(ticks) {
  if (!ticks || ticks < 0) return "0m";
  const totalMinutes = Math.floor(ticks / TICKS_PER_SECOND / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours) return `${hours}h ${minutes}m`;
  if (totalMinutes) return `${totalMinutes}m`;
  return "<1m";
}

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
  // Anything under a metre would otherwise round to a flat "0 m", which looks
  // like the number failed to load rather than "you barely moved".
  if (metres < 1) return "<1 m";
  return Math.round(metres) + " m";
}

function formatNumber(n) {
  return (n || 0).toLocaleString();
}

/** "minecraft:pink_petals" -> "Pink Petals" */
function prettyId(id) {
  return String(id)
    .replace(/^minecraft:/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ================================================================== *
 * account + skin                                                      *
 * ================================================================== */
function setAvatar(container, skin, letter) {
  container.textContent = "";
  if (skin && (skin.dataUrl || skin.none)) {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    container.appendChild(canvas);
    if (skin.dataUrl) drawHead(canvas, skin.dataUrl);
    else drawDefaultHead(canvas);
  } else {
    container.appendChild(el("span", "avatar-letter", letter));
  }
}

/* Reminth's own stand-in face, drawn in code, for accounts that have never
   uploaded a skin. Deliberately not Mojang's default character - this is an
   original blocky figure in the launcher's own colours. */
const DEFAULT_SKIN = {
  hair: "#2b3550",
  face: "#c89b74",
  eye: "#22d3ee",
  shirt: "#2f6f8f",
  sleeve: "#c89b74",
  legs: "#27324a",
  legsShade: "#212a3e", // see fallbackSkinTexture - keeps the two legs apart
};

function drawDefaultHead(canvas) {
  const ctx = canvas.getContext("2d");
  const u = canvas.width / 8; // the face is 8x8 skin pixels
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

/**
 * Paints Reminth's own stand-in figure as a real 64x64 skin *texture*
 * rather than as a drawing of a body. That means the no-skin case goes
 * through exactly the same renderer as a real skin - same proportions,
 * same idle animation - instead of being a second, worse drawing path
 * that visibly doesn't match. Still deliberately not Mojang's Steve/Alex:
 * this is an original figure in the launcher's own colours.
 */
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
  // Each limb needs all four sides filled or the edges read as holes; the
  // front face is the only one this view actually shows, so the rest just
  // gets the same base colour.
  const part = (x, y, w, h, d, colour) => fill(x, y, 2 * (w + d), h, colour);

  part(0, 8, 8, 8, 8, DEFAULT_SKIN.face); // head, all faces
  fill(8, 8, 8, 8, DEFAULT_SKIN.face); // front of head
  fill(8, 8, 8, 2, DEFAULT_SKIN.hair); // fringe
  fill(8, 8, 1, 4, DEFAULT_SKIN.hair);
  fill(15, 8, 1, 4, DEFAULT_SKIN.hair);
  fill(0, 8, 8, 2, DEFAULT_SKIN.hair); // wrap the fringe round the sides
  fill(16, 8, 16, 2, DEFAULT_SKIN.hair);
  fill(10, 11, 1, 1, DEFAULT_SKIN.eye); // eyes
  fill(13, 11, 1, 1, DEFAULT_SKIN.eye);

  part(16, 20, 8, 12, 4, DEFAULT_SKIN.shirt); // torso
  fill(20, 20, 8, 12, DEFAULT_SKIN.shirt); // front of torso
  part(40, 20, 4, 12, 4, DEFAULT_SKIN.shirt); // right arm
  fill(44, 20, 4, 8, DEFAULT_SKIN.shirt); // sleeve
  fill(44, 28, 4, 4, DEFAULT_SKIN.sleeve); // hand
  part(32, 52, 4, 12, 4, DEFAULT_SKIN.shirt); // left arm
  fill(36, 52, 4, 8, DEFAULT_SKIN.shirt);
  fill(36, 60, 4, 4, DEFAULT_SKIN.sleeve);
  // The two legs sit flush against each other, so an identical colour on
  // both reads as one solid block rather than a pair of legs. A slightly
  // darker left leg gives the seam something to be.
  part(0, 20, 4, 12, 4, DEFAULT_SKIN.legs); // right leg
  part(16, 52, 4, 12, 4, DEFAULT_SKIN.legsShade); // left leg

  fallbackSkinUrl = tex.toDataURL("image/png");
  return fallbackSkinUrl;
}

/* ---- animated skin render ------------------------------------------- *
 * The Skin page used to paint one static front-on frame. This draws each
 * body part separately and rotates the limbs around their own joints on a
 * slow idle loop - arms swaying, legs shifting, the whole figure breathing
 * - so it reads as a character standing there rather than a sprite pasted
 * onto the page. Still a flat front view, not a 3D model: that would mean
 * shipping a renderer, and this is a preview, not a viewport.
 * ---------------------------------------------------------------------- */

const SKIN_PX = 10; // canvas pixels per skin pixel; the figure is 16x32 of them
let skinAnimationFrame = null;

function stopSkinAnimation() {
  if (skinAnimationFrame !== null) cancelAnimationFrame(skinAnimationFrame);
  skinAnimationFrame = null;
}

function animateBody(canvas, dataUrl, model) {
  stopSkinAnimation();
  const img = new Image();
  img.onload = () => {
    const ctx = canvas.getContext("2d");
    const s = img.width / 64; // scales HD (128x128, 256x256…) skins too
    const arm = model === "slim" ? 3 : 4;
    const legacy = img.height / img.width < 0.9; // 64x32, no left limbs or overlay
    // Centred, with room either side for the limbs to swing into without
    // being clipped at the canvas edge.
    const originX = (canvas.width - 16 * SKIN_PX) / 2;
    const originY = (canvas.height - 32 * SKIN_PX) / 2;
    const started = performance.now();

    const piece = (src, dst, mirror) => {
      const [sx, sy, sw, sh] = src;
      const [dx, dy, dw, dh] = dst;
      const px = originX + dx * SKIN_PX;
      const py = originY + dy * SKIN_PX;
      if (!mirror) {
        ctx.drawImage(img, sx * s, sy * s, sw * s, sh * s, px, py, dw * SKIN_PX, dh * SKIN_PX);
        return;
      }
      ctx.save();
      ctx.translate(px + dw * SKIN_PX, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, sx * s, sy * s, sw * s, sh * s, 0, py, dw * SKIN_PX, dh * SKIN_PX);
      ctx.restore();
    };

    /** Draws parts rotated about a joint given in skin pixels. */
    const jointed = (angle, [jx, jy], draw) => {
      ctx.save();
      ctx.translate(originX + jx * SKIN_PX, originY + jy * SKIN_PX);
      ctx.rotate(angle);
      ctx.translate(-(originX + jx * SKIN_PX), -(originY + jy * SKIN_PX));
      draw();
      ctx.restore();
    };

    const rightArmSrc = [44, 20, arm, 12];
    const rightLegSrc = [4, 20, 4, 12];

    const frame = (now) => {
      skinAnimationFrame = requestAnimationFrame(frame);
      // requestAnimationFrame is already throttled to nothing while the
      // window is hidden, so this only guards the case where the player is
      // looking at a different page of the launcher.
      if (document.hidden || !canvas.isConnected || canvas.offsetParent === null) return;

      const t = (now - started) / 1000;
      // Deliberately small numbers. This is an idle, not a dance: a couple
      // of degrees on the limbs and a fraction of a pixel of breathing.
      const breath = Math.sin(t * 1.5) * 0.16; // skin px, vertical
      const armAngle = Math.sin(t * 1.05) * 0.055; // radians
      const legAngle = Math.sin(t * 1.05 + 0.7) * 0.022;
      const headTilt = Math.sin(t * 0.7) * 0.018;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;

      // Soft contact shadow, tightening as the figure settles downward.
      const shadowY = originY + 32 * SKIN_PX + 6;
      const shadowScale = 1 - breath * 0.35;
      ctx.save();
      ctx.fillStyle = "rgba(0, 0, 0, .34)";
      ctx.beginPath();
      ctx.ellipse(canvas.width / 2, shadowY, 46 * shadowScale, 8 * shadowScale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Legs stay planted; everything above them rides the breath offset.
      jointed(legAngle, [6, 20], () => piece(rightLegSrc, [4, 20, 4, 12]));
      jointed(-legAngle, [10, 20], () =>
        legacy ? piece(rightLegSrc, [8, 20, 4, 12], true) : piece([20, 52, 4, 12], [8, 20, 4, 12])
      );
      if (!legacy) {
        jointed(legAngle, [6, 20], () => piece([4, 36, 4, 12], [4, 20, 4, 12]));
        jointed(-legAngle, [10, 20], () => piece([4, 52, 4, 12], [8, 20, 4, 12]));
      }

      ctx.save();
      ctx.translate(0, breath * SKIN_PX);

      piece([20, 20, 8, 12], [4, 8, 8, 12]); // torso
      if (!legacy) piece([20, 36, 8, 12], [4, 8, 8, 12]); // jacket

      jointed(-armAngle, [4, 9], () => {
        piece(rightArmSrc, [4 - arm, 8, arm, 12]);
        if (!legacy) piece([44, 36, arm, 12], [4 - arm, 8, arm, 12]);
      });
      jointed(armAngle, [12, 9], () => {
        if (legacy) piece(rightArmSrc, [12, 8, arm, 12], true);
        else {
          piece([36, 52, arm, 12], [12, 8, arm, 12]);
          piece([52, 52, arm, 12], [12, 8, arm, 12]);
        }
      });

      jointed(headTilt, [8, 8], () => {
        piece([8, 8, 8, 8], [4, 0, 8, 8]); // head
        if (!legacy) piece([40, 8, 8, 8], [4, 0, 8, 8]); // hat layer
      });

      ctx.restore();
    };

    skinAnimationFrame = requestAnimationFrame(frame);
  };
  img.src = dataUrl;
}

/**
 * Crops the 8x8 face out of a Minecraft skin and paints it (plus the hat
 * layer, which most skins use) into a canvas. Skins are 64x64 (or legacy
 * 64x32); the head is at 8,8 and the hat overlay at 40,8 in both.
 */
function drawHead(canvas, dataUrl) {
  const img = new Image();
  img.onload = () => {
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = img.width / 64; // handles HD skins (128x128 etc.) too
    ctx.drawImage(img, 8 * scale, 8 * scale, 8 * scale, 8 * scale, 0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 40 * scale, 8 * scale, 8 * scale, 8 * scale, 0, 0, canvas.width, canvas.height);
  };
  img.src = dataUrl;
}

let skinRequestId = 0;

async function refreshSkin() {
  const letter = (state.username || "?").slice(0, 1).toUpperCase();
  // Skin lookups go over the network, so a sign-out can land while one is
  // still in flight. Without this the previous player's face painted back
  // over "Not signed in" a few seconds later.
  const requestId = ++skinRequestId;
  let skin = null;
  try {
    skin = state.signedIn ? await window.reminth.skin() : null;
  } catch {
    skin = null;
  }
  if (requestId !== skinRequestId) return;

  setAvatar($("topAvatar"), skin, letter);
  setAvatar($("settingsAvatar"), skin, letter);
  setAvatar($("sideAvatar"), skin, letter);

  const bodyCanvas = $("skinBody");
  stopSkinAnimation();
  const ctx = bodyCanvas.getContext("2d");
  ctx.clearRect(0, 0, bodyCanvas.width, bodyCanvas.height);

  if (!state.signedIn) {
    $("skinName").textContent = "Not signed in";
    $("skinModel").textContent = "Sign in to see your skin";
    return;
  }
  if (skin && skin.dataUrl) {
    // The real texture off the player's own account, animated.
    animateBody(bodyCanvas, skin.dataUrl, skin.model);
    $("skinName").textContent = state.username || skin.name || "—";
    $("skinModel").textContent =
      (skin.model === "slim" ? "Slim model" : "Classic model") + " · your Minecraft skin";
  } else if (skin && skin.none) {
    // Mojang serves no texture at all for a default-skin account, so there
    // is no "real skin" to show here - this is Reminth's own stand-in,
    // rendered through the same path so it at least moves like one.
    animateBody(bodyCanvas, fallbackSkinTexture(), skin.model);
    $("skinName").textContent = state.username || "—";
    $("skinModel").textContent = "No custom skin set on your account yet";
  } else {
    $("skinName").textContent = state.username || "—";
    $("skinModel").textContent = (skin && skin.error) || "Couldn't load your skin right now";
  }
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
  $("sideState").textContent = signedIn ? "Microsoft account · online" : "Not connected";

  $("signInHero").hidden = signedIn;
  $("homeMain").hidden = !signedIn;
  $("heroGreeting").textContent = signedIn ? `Welcome back, ${state.username}` : "Ready to play?";

  // The same sign-in card gates the whole app, not just Home: signed out, the
  // rail, top actions and sidebar are hidden (styles.css, #app.signed-out)
  // and switchPage refuses every page but Home.
  $("app").classList.toggle("signed-out", !signedIn);
  if (!signedIn) switchPage("home");

  refreshSkin();
}

async function doSignIn(btn) {
  if (btn) btn.disabled = true;
  try {
    const { username } = await window.reminth.signIn();
    state.signedIn = true;
    state.username = username;
    $("codePanel").hidden = true;
    applyAccountUI();
    loadRecent();
    toast(`Signed in as ${username}`);
  } catch (err) {
    $("codePanel").hidden = true;
    appendLog("Sign-in failed: " + friendlyError(err.message), true, "Out");
    toast("Sign-in didn't finish — see the message below.");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function doSignOut() {
  await window.reminth.signOut();
  state.signedIn = false;
  state.username = null;
  applyAccountUI();
  toast("Signed out.");
}

$("signInBtn").onclick = () => doSignIn($("signInBtn"));
$("accountBtn").onclick = () => switchPage("settings");
$("settingsAuthBtn").onclick = () =>
  state.signedIn ? doSignOut() : doSignIn($("settingsAuthBtn"));

/**
 * Turns the handful of errors a non-technical player will actually hit into
 * plain language. Anything else passes through unchanged rather than being
 * guessed at.
 */
function friendlyError(message) {
  if (/Invalid app registration/i.test(message)) {
    return (
      "Sign-in almost worked, but Microsoft hasn't finished approving Reminth's app yet " +
      "(a one-time review on their side). Nothing's wrong with your account — try again later."
    );
  }
  if (/Checksum mismatch/i.test(message)) {
    return (
      "A downloaded file didn't match what was expected. Try again — if it keeps happening, " +
      "something between you and the server (VPN, proxy or firewall) is altering downloads."
    );
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(message)) {
    return "Couldn't reach Microsoft/Mojang's servers. Check your internet connection and try again.";
  }
  return message;
}

/* ================================================================== *
 * play / install                                                      *
 * ================================================================== */
async function runPlay() {
  if (state.installing) return;
  state.installing = true;
  state.logError = false;
  setPlayButtons(true);
  $("progressWrap").hidden = false;
  $("log").hidden = false;
  $("log").textContent = "";
  $("progressDismiss").hidden = true;
  try {
    await window.reminth.play();
    toast("Minecraft is starting…");
    scheduleHideProgress("");
  } catch (err) {
    // "Already running" isn't a fault the player needs to fix - it just
    // means they clicked Play while a previous session was still open, and
    // it goes stale the moment that session closes. Pinning it like a real
    // error (see appendLog/scheduleHideProgress) left it stuck on screen
    // forever with no way to clear it, long after it stopped being true.
    const alreadyRunning = /already running/i.test(err.message);
    appendLog("Couldn't launch: " + friendlyError(err.message), !alreadyRunning);
    toast(alreadyRunning ? "Minecraft is already running." : "Launch failed — see the message on Home.");
    if (alreadyRunning) scheduleHideProgress("");
  } finally {
    state.installing = false;
    setPlayButtons(false);
    loadRecent();
    loadInstalledMods();
  }
}

/**
 * Tidies the progress bar and log away a few seconds after a clean run, so
 * the home screen doesn't keep a finished "Ready 100%" bar (and the log it
 * pushed down) on screen forever. Anything that logged an error stays put -
 * that's the one case where the player needs to read it.
 */
function scheduleHideProgress(suffix) {
  clearTimeout(window._hideProgress);
  window._hideProgress = setTimeout(() => {
    if (state.logError || state.installing) return;
    $("progressWrap" + suffix).hidden = true;
    $("log" + suffix).hidden = true;
  }, 6000);
}

/**
 * Which progress panel is visible. The home screen has two: one inside the
 * signed-in hero, one inside the sign-in card. Deciding this in three
 * different places meant "Verify files" while signed out unhid one panel,
 * wrote progress into the other, and then hid neither - leaving a bare log
 * under the sign-in card with no bar and no way to dismiss it.
 */
function progressSuffix() {
  return state.signedIn ? "" : "Out";
}

function setPlayButtons(disabled) {
  ["playBtn", "instPlayBtn", "repairBtn", "repairBtn2"].forEach((id) => {
    const btn = $(id);
    if (btn) btn.disabled = disabled;
  });
}

async function runInstall() {
  if (state.installing) return;
  const suffix = progressSuffix();
  state.installing = true;
  state.logError = false;
  setPlayButtons(true);
  $("progressWrap" + suffix).hidden = false;
  $("log" + suffix).hidden = false;
  $("log" + suffix).textContent = "";
  $("progressDismiss" + suffix).hidden = true;
  try {
    const result = await window.reminth.install();
    if (result && result.removedMods && result.removedMods.length) {
      appendLog(
        "Removed mods Reminth no longer installs for you: " + result.removedMods.join(", "),
        false,
        suffix
      );
    }
    toast("Game files are up to date.");
    scheduleHideProgress(suffix);
  } catch (err) {
    appendLog("Update failed: " + friendlyError(err.message), true, suffix);
    toast("Couldn't finish updating — see the message.");
  } finally {
    state.installing = false;
    setPlayButtons(false);
    loadInstalledMods();
  }
}

$("playBtn").onclick = runPlay;
$("instPlayBtn").onclick = runPlay;
$("updateBtnOut").onclick = () => runInstall();
$("repairBtn").onclick = () => { switchPage("home"); runInstall(); };
$("repairBtn2").onclick = () => { switchPage("home"); runInstall(); };

function appendLog(line, isError, suffix) {
  if (isError) state.logError = true;
  const node = $("log" + (suffix || ""));
  node.hidden = false;
  node.textContent += (isError ? "! " : "") + line.replace(/\n$/, "") + "\n";
  node.scrollTop = node.scrollHeight;
  const dismiss = $("progressDismiss" + (suffix || ""));
  if (dismiss) dismiss.hidden = !isError;
}

/**
 * Manually clears a pinned progress bar/log - the counterpart to the
 * dismiss (×) button that appears next to the percentage once a run ends in
 * an error. Errors are pinned on purpose so the player has time to read
 * them, but that means they'd otherwise never go away without another
 * Play/Update run - this gives the player their own way to close it.
 */
function dismissLog(suffix) {
  state.logError = false;
  clearTimeout(window._hideProgress);
  $("progressWrap" + suffix).hidden = true;
  $("log" + suffix).hidden = true;
  $("progressDismiss" + suffix).hidden = true;
}
$("progressDismiss").onclick = () => dismissLog("");
$("progressDismissOut").onclick = () => dismissLog("Out");

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

window.reminth.onInstallProgress(({ stage, current, total }) => {
  const suffix = progressSuffix();
  // Stages that report no total (downloading Java, resolving versions…) are
  // genuinely indeterminate. Filling the bar to 100% for those made the very
  // first install - a ~180MB JDK download - look finished for minutes and
  // then jump backwards. Show a moving stripe instead.
  const determinate = total > 1;
  const pct = determinate ? Math.round((current / total) * 100) : 0;
  $("progressStage" + suffix).textContent = stage;
  $("progressPct" + suffix).textContent = determinate ? pct + "%" : "";
  $("progressFill" + suffix).style.width = determinate ? pct + "%" : "100%";
  $("progressFill" + suffix).classList.toggle("busy", !determinate);
  appendLog(`${stage}${total > 1 ? ` (${current}/${total})` : ""}`, false, suffix);
});

window.reminth.onInstallDone(() => {
  const suffix = progressSuffix();
  $("progressStage" + suffix).textContent = "Ready";
  $("progressPct" + suffix).textContent = "100%";
  $("progressFill" + suffix).style.width = "100%";
  $("progressFill" + suffix).classList.remove("busy");
});

// Fires when the game process dies right after launch - without this a
// crash-on-startup was invisible, because the launcher already said "launched".
window.reminth.onPlayCrashed(({ code, signal, error, logPath }) => {
  const reason = error
    ? error
    : signal
    ? `the game process was killed (${signal})`
    : `the game process exited immediately (code ${code})`;
  appendLog(`Minecraft closed right after launching — ${reason}. Full log: ${logPath}`, true);
  toast("Minecraft closed right after launching — see the message on Home.");
});

/* ================================================================== *
 * home: recently played                                               *
 * ================================================================== */
/**
 * Minecraft happily lets two worlds share a name ("New World" and
 * "New World (1)" both report LevelName "New World"), which rendered as two
 * identical cards. When that happens, show the folder so they can be told
 * apart.
 */
function disambiguate(entries) {
  const counts = new Map();
  entries.forEach((e) => counts.set(e.name, (counts.get(e.name) || 0) + 1));
  entries.forEach((e) => {
    e.subtitle = e.type === "world" && counts.get(e.name) > 1 && e.folder !== e.name ? e.folder : null;
  });
  return entries;
}

function recentCard(entry) {
  const card = el("div", "card recent");

  const art = el("div", "recent-art " + entry.type);
  const kind = el("span", "recent-kind " + entry.type, entry.type === "world" ? "World" : "Server");
  art.appendChild(kind);

  // World and server icons are 64x64 PNGs. They're drawn in a 64px tile at
  // 1:1 with nearest-neighbour scaling - stretching them across the whole
  // card was what made them look like blurry random photos.
  const tile = el("div", "icon-tile");
  if (entry.icon) {
    const img = document.createElement("img");
    img.src = entry.icon;
    img.alt = "";
    tile.appendChild(img);
  } else {
    tile.classList.add("is-glyph");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", entry.type === "world" ? "block-mark" : "server-mark");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", entry.type === "world" ? "#i-block" : "#i-server");
    svg.appendChild(use);
    tile.appendChild(svg);
  }
  art.appendChild(tile);

  const body = el("div", "recent-body");
  body.appendChild(el("div", "recent-name", entry.name));

  const meta = el("div", "recent-meta");
  const bits = [];
  if (entry.subtitle) bits.push(entry.subtitle);
  if (entry.type === "world") {
    if (entry.playTimeTicks) bits.push(formatPlaytime(entry.playTimeTicks));
    if (entry.gameMode) bits.push(entry.gameMode);
  } else {
    bits.push(entry.address);
  }
  const when = formatWhen(entry.lastPlayed);
  if (when) bits.push(when);

  bits.forEach((text, i) => {
    if (i) meta.appendChild(el("span", "dot", "·"));
    meta.appendChild(el("span", null, text));
  });
  body.appendChild(meta);

  card.appendChild(art);
  card.appendChild(body);
  return card;
}

/*
 * "+" tile for the top of a card grid - Modrinth-style add affordance, but
 * UI only: no click handler, no backing feature yet. Same "Soon" pattern as
 * the rail's own add button and every other placeholder in this app.
 */
function addTile(label) {
  const card = el("div", "card recent add-tile");
  card.dataset.tip = "Soon";

  const art = el("div", "recent-art");
  const tile = el("div", "icon-tile is-glyph");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "add-mark");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", "#i-plus");
  svg.appendChild(use);
  tile.appendChild(svg);
  art.appendChild(tile);
  card.appendChild(art);

  const body = el("div", "recent-body");
  body.appendChild(el("div", "recent-name", label));
  const meta = el("div", "recent-meta");
  meta.appendChild(el("span", null, "Soon"));
  body.appendChild(meta);
  card.appendChild(body);

  bindTip(card);
  return card;
}

function renderEmpty(container, title, note) {
  container.textContent = "";
  const empty = el("div", "empty");
  empty.appendChild(el("b", null, title));
  empty.appendChild(el("span", null, note));
  container.appendChild(empty);
}

async function loadRecent() {
  let data;
  try {
    data = await window.reminth.recent();
  } catch (err) {
    data = { recent: [], worlds: [], worldCount: 0, serverCount: 0, totalPlayTimeTicks: 0, error: err.message };
  }
  state.recent = data;

  const grid = $("recentGrid");
  if (data.error) {
    // A folder we couldn't read is not the same as a folder with nothing in
    // it, and the player deserves to know which one happened.
    renderEmpty(grid, "Couldn't read your saves folder", data.error);
    grid.prepend(addTile("Add instance"));
    $("recentNote").textContent = "";
  } else if (!data.recent.length) {
    renderEmpty(
      grid,
      "Nothing played yet",
      "Start the game and your worlds and servers will show up here."
    );
    grid.prepend(addTile("Add instance"));
    $("recentNote").textContent = "";
  } else {
    grid.textContent = "";
    grid.appendChild(addTile("Add instance"));
    disambiguate(data.recent).forEach((entry) => grid.appendChild(recentCard(entry)));
    $("recentNote").textContent =
      `${data.worldCount} world${data.worldCount === 1 ? "" : "s"} · ` +
      `${data.serverCount} saved server${data.serverCount === 1 ? "" : "s"}`;
  }

  // Home stats + hero
  const playtime = formatPlaytime(data.totalPlayTimeTicks);
  $("heroPlaytime").textContent = playtime;
  const mostRecent = data.recent[0];
  $("heroLast").textContent = mostRecent && mostRecent.lastPlayed ? formatWhen(mostRecent.lastPlayed) : "Never";

  // Instance page
  $("instPlaytime").textContent = playtime;
  $("instWorlds").textContent = String(data.worldCount);

  // Every world, not just whichever of them made the recent top five.
  const worlds = data.worlds || data.recent.filter((r) => r.type === "world");
  const servers = data.servers || data.recent.filter((r) => r.type === "server");

  // The same worlds appear on the Instance page and in the Library, because
  // that's the truth of it: a world isn't owned by an instance. Servers are
  // the other way round - they're saved per instance - so both lists show the
  // same thing today only because there's one instance to show.
  fillGrid("worldGrid", worlds, "worldsNote", {
    emptyTitle: "No worlds yet",
    emptyNote: "Any world you create shows up here automatically.",
  });
  fillGrid("libWorldGrid", worlds, "libWorldsNote", {
    emptyTitle: "No worlds yet",
    emptyNote: "Create one in game and it'll be here — and in every instance.",
  });
  fillGrid("instServerGrid", servers, "instServersNote", {
    emptyTitle: "No servers saved here",
    emptyNote: "Servers you add from the in-game multiplayer list show up here.",
  });
  fillGrid("libServerGrid", servers, "libServersNote", {
    emptyTitle: "No servers saved yet",
    emptyNote: "Add one in game and it lands in the instance you added it from.",
  });

  $("sideWorlds").textContent = String(data.worldCount || 0);
  $("sideServers").textContent = String(data.serverCount || 0);

  renderLibraryInstances(data);
}

/** Paints one of the card grids, with a real empty state and a count note. */
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
  disambiguate(entries).forEach((entry) => grid.appendChild(recentCard(entry)));
  if (note) note.textContent = `${entries.length} total · newest first`;
}

/**
 * The Library's instance list. There is exactly one instance today, so this
 * shows one real tile rather than inventing a list - the "+" beside it is the
 * same inert placeholder used everywhere else.
 */
function renderLibraryInstances(data) {
  const grid = $("libInstanceGrid");
  if (!grid) return;
  const info = state.info;
  grid.textContent = "";

  const tile = el("div", "card lib-tile");
  const art = el("div", "lib-art");
  art.appendChild(el("span", "instance-chip", "R"));
  tile.appendChild(art);
  const meta = el("div", "lib-meta");
  meta.appendChild(el("div", "lib-name", "Reminth · Fabric"));
  const sub = el("div", "lib-sub");
  sub.appendChild(el("span", null, info ? `Fabric ${info.minecraftVersion}` : "Fabric"));
  sub.appendChild(el("span", "dot", "·"));
  sub.appendChild(el("span", null, `${data.worldCount || 0} world${data.worldCount === 1 ? "" : "s"}`));
  meta.appendChild(sub);
  tile.appendChild(meta);
  tile.onclick = () => switchPage("instance");
  grid.appendChild(tile);

  const add = el("div", "card lib-tile add");
  add.dataset.tip = "Soon";
  const addArt = el("div", "lib-art");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "add-mark");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", "#i-plus");
  svg.appendChild(use);
  addArt.appendChild(svg);
  add.appendChild(addArt);
  const addMeta = el("div", "lib-meta");
  addMeta.appendChild(el("div", "lib-name", "Add instance"));
  addMeta.appendChild(el("div", "lib-sub", "A second version or mod set — soon"));
  add.appendChild(addMeta);
  bindTip(add);
  grid.appendChild(add);
}

/* ================================================================== *
 * mods                                                                *
 * ================================================================== */
const MOD_COLOURS = { HUD: "var(--cyan)", Library: "var(--emerald)" };

/* Jars an older Reminth build installed on the player's behalf. Calling these
   "Yours" would be a lie - they're cleared out on the next verify or launch
   (see minecraft.js:tidyManagedMods). */
const LEFTOVER_JAR = /^(sodium|lithium|scalablelux|starlight|wxhud)[-_.]/i;
const MANAGED_JAR = /^(fabric-api|reminthhud)-/i;

/**
 * The real artwork for the two mods Reminth manages: ReminthHUD is ours, so
 * it gets the Reminth logo that ships with the app; Fabric API's own icon
 * comes out of the Modrinth cache (see MANAGED_MOD_SLUGS below), because
 * that's the project's own icon served from the API we already read.
 * Anything without a match keeps the letter mark.
 */
const BUNDLED_ICONS = { ReminthHUD: "../../assets/icon.png" };
const MANAGED_MOD_SLUGS = { "Fabric API": "fabric-api" };
const managedIconUrls = new Map(); // mod name -> resolved icon URL

/** Builds the icon node for a card: real image where we have one, letter
 *  mark where we don't, with the image falling back to the letter mark if
 *  it fails to load. Attached via addEventListener, never an inline
 *  onerror attribute - the CSP drops those silently. */
function cardIcon(name, className, colour, iconUrl) {
  const src = safeIconUrl(iconUrl);
  const letterMark = () => {
    const mark = el("div", className, String(name).slice(0, 1));
    mark.style.setProperty("--mc", colour);
    return mark;
  };
  if (!src) return letterMark();
  const img = el("img", className);
  img.src = src;
  img.alt = "";
  img.loading = "lazy";
  img.style.setProperty("--mc", colour);
  img.addEventListener("error", () => img.replaceWith(letterMark()));
  return img;
}

function managedModCard(mod) {
  const card = el("div", "card mod");
  const head = el("div", "mod-head");
  const colour = MOD_COLOURS[mod.tag] || "var(--accent)";
  const ico = cardIcon(mod.name, "mcard-ico", colour, managedIconUrls.get(mod.name));
  head.appendChild(ico);
  const names = el("div");
  names.appendChild(el("div", "mod-name", mod.name));
  names.appendChild(el("div", "mcard-cat", mod.tag));
  head.appendChild(names);
  card.appendChild(head);
  card.appendChild(el("p", null, mod.note));

  const foot = el("div", "mod-foot");
  foot.appendChild(el("span", "ok", "Installed and kept up to date"));
  foot.appendChild(el("span", "tag dim", mod.required ? "Required" : "Core"));
  card.appendChild(foot);
  return card;
}

/* The Mods page and the Instance page's Mods tab are the same list, so they
   share one render - a DOM node can only live in one place, hence the
   per-target rebuild rather than cloning. */
/**
 * Resolve the managed cards' icons once, then redraw. Bundled icons are
 * immediate; the Modrinth-sourced ones depend on the local catalog cache
 * being warm, so this is safe to call again later (boot calls it once, and
 * the catalog warm-up calls it again when mods finish caching).
 */
async function resolveManagedIcons() {
  let changed = false;
  for (const [name, file] of Object.entries(BUNDLED_ICONS)) {
    if (managedIconUrls.get(name) !== file) {
      managedIconUrls.set(name, file);
      changed = true;
    }
  }
  const slugs = Object.values(MANAGED_MOD_SLUGS);
  if (slugs.length && window.reminth.catalogBySlugs) {
    try {
      const found = await window.reminth.catalogBySlugs("mod", slugs);
      for (const [name, slug] of Object.entries(MANAGED_MOD_SLUGS)) {
        const url = found[slug] && found[slug].icon_url;
        if (url && managedIconUrls.get(name) !== url) {
          managedIconUrls.set(name, url);
          changed = true;
        }
      }
    } catch {
      // no cache yet - the letter mark is a fine stand-in until there is one
    }
  }
  if (changed) renderManagedMods();
}

function renderManagedMods() {
  ["managedMods", "instManagedMods"].forEach((id) => {
    const grid = $(id);
    if (!grid) return;
    grid.textContent = "";
    (state.info ? state.info.managedMods : []).forEach((mod) => grid.appendChild(managedModCard(mod)));
  });
}

function modRow(jar) {
  const row = el("div", "mod-row");
  const managed = MANAGED_JAR.test(jar);
  const leftover = LEFTOVER_JAR.test(jar);
  row.appendChild(el("span", "jar", jar));
  row.appendChild(
    el(
      "span",
      managed ? "tag cyan" : leftover ? "tag amber" : "tag dim",
      managed ? "Reminth" : leftover ? "Leftover" : "Yours"
    )
  );
  return row;
}

async function loadInstalledMods() {
  let result = { jars: [] };
  try {
    result = (await window.reminth.installedMods()) || { jars: [] };
  } catch (err) {
    result = { jars: [], error: err.message };
  }
  const jars = result.jars || [];

  $("instMods").textContent = result.error ? "—" : String(jars.length);

  const leftovers = jars.filter((j) => LEFTOVER_JAR.test(j)).length;
  const note =
    result.error || !jars.length
      ? ""
      : `${jars.length} jar${jars.length === 1 ? "" : "s"}` +
        (leftovers
          ? ` · ${leftovers} left by an older Reminth build, removed next time you play or verify`
          : "");

  [
    ["installedMods", "modsFolderNote"],
    ["instInstalledMods", "instModsNote"],
  ].forEach(([listId, noteId]) => {
    const list = $(listId);
    if (!list) return;
    if (result.error) {
      // Don't claim the folder is empty when we simply couldn't read it.
      renderEmpty(list, "Couldn't read your mods folder", result.error);
    } else if (!jars.length) {
      renderEmpty(list, "No mods installed yet", "Reminth adds ReminthHUD and Fabric API the first time you play.");
    } else {
      list.textContent = "";
      jars.forEach((jar) => list.appendChild(modRow(jar)));
    }
    const noteEl = $(noteId);
    if (noteEl) noteEl.textContent = note;
  });
}

/** Resource packs sitting in this instance's resourcepacks folder. */
async function loadPacks() {
  const list = $("instPacks");
  if (!list) return;
  let result = { packs: [] };
  try {
    result = (await window.reminth.installedPacks()) || { packs: [] };
  } catch (err) {
    result = { packs: [], error: err.message };
  }

  if (result.error) {
    renderEmpty(list, "Couldn't read your resource packs folder", result.error);
    return;
  }
  if (!result.packs.length) {
    renderEmpty(
      list,
      "No resource packs yet",
      "Drop a pack .zip into the resourcepacks folder and it'll be in the game's pack list next launch."
    );
    return;
  }

  list.textContent = "";
  result.packs.forEach((pack) => {
    const row = el("div", "mod-row");
    row.appendChild(el("span", "jar", pack.name));
    row.appendChild(el("span", pack.folder ? "tag dim" : "tag cyan", pack.folder ? "Folder" : "Zip"));
    list.appendChild(row);
  });
}

/* The Discover grid on Home. Names only - nothing here installs anything yet.
 * Each entry carries the project's real Modrinth slug so buildDiscover can
 * put that project's own icon on the card instead of a letter mark. */
const DISCOVER_MODS = [
  { name: "Sodium", slug: "sodium", cat: "Performance", note: "Rewrites the renderer for a big FPS jump.", c: "var(--cyan)" },
  { name: "Iris", slug: "iris", cat: "Visual", note: "Shader support that plays nicely with Sodium.", c: "var(--violet)" },
  { name: "Lithium", slug: "lithium", cat: "Performance", note: "Optimises game logic without changing behaviour.", c: "var(--cyan)" },
  { name: "Mod Menu", slug: "modmenu", cat: "Utility", note: "See and configure your mods from the title screen.", c: "var(--amber)" },
  { name: "JEI", slug: "jei", cat: "Utility", note: "Look up any recipe without leaving the game.", c: "var(--amber)" },
  { name: "Xaero's Minimap", slug: "xaeros-minimap", cat: "Navigation", note: "A minimap and waypoints that stay out of the way.", c: "var(--emerald)" },
  { name: "Simple Voice Chat", slug: "simple-voice-chat", cat: "Social", note: "Proximity voice chat on servers that run it.", c: "var(--rose)" },
  { name: "Distant Horizons", slug: "distanthorizons", cat: "Visual", note: "See far past your normal render distance.", c: "var(--violet)" },
];

/*
 * A plain grid, not the sliding strip this used to be: a card that moves
 * while you're reading it is a card you can't read. The art on each one is
 * drawn from a colour rather than a screenshot, because we don't have real
 * cover images for these and faking one would be worse than not having one.
 * Shared by Home's "Discover mods" teaser and the Mods & Addons Browse tabs
 * below - one card builder, different lists.
 */
function buildCardGrid(gridId, items) {
  const grid = $(gridId);
  if (!grid) return;
  grid.textContent = "";
  items.forEach((mod) => {
    const card = el("div", "card dcard");
    card.style.setProperty("--mc", mod.c);

    // Card art: the project's own icon, blown up and blurred behind the
    // drawn gradient, so the tile reads as that mod rather than as a
    // generic coloured rectangle. Falls back to the gradient alone when
    // the catalog hasn't cached that project yet.
    const art = el("div", "dcard-art");
    const artUrl = safeIconUrl(mod.icon_url);
    if (artUrl) {
      art.classList.add("has-art");
      art.style.backgroundImage = `url("${encodeURI(artUrl)}")`;
    }
    card.appendChild(art);

    const body = el("div", "dcard-body");
    const head = el("div", "dcard-head");
    const ico = cardIcon(mod.name, "mcard-ico", mod.c, mod.icon_url);
    head.appendChild(ico);
    const names = el("div");
    names.appendChild(el("div", "mcard-name", mod.name));
    names.appendChild(el("div", "mcard-cat", mod.cat));
    head.appendChild(names);
    body.appendChild(head);
    body.appendChild(el("p", null, mod.note));
    card.appendChild(body);
    grid.appendChild(card);
  });
}
/**
 * Draws the Discover grid immediately from the static list, then fills in
 * each project's real icon from the local catalog cache once that's read.
 * Drawn twice on purpose: Home shouldn't sit empty waiting on a cache read,
 * and on a cold install there may be no cache to read yet.
 */
async function buildDiscover() {
  buildCardGrid("discoverGrid", DISCOVER_MODS);
  if (!window.reminth.catalogBySlugs) return;
  let found = {};
  try {
    found = await window.reminth.catalogBySlugs("mod", DISCOVER_MODS.map((m) => m.slug));
  } catch {
    return; // no cache yet - the letter marks stand
  }
  const withIcons = DISCOVER_MODS.map((mod) => {
    const hit = found[mod.slug];
    return hit && hit.icon_url ? { ...mod, icon_url: hit.icon_url } : mod;
  });
  if (withIcons.some((m) => m.icon_url)) buildCardGrid("discoverGrid", withIcons);
}

/*
 * Browse tabs on Mods & Addons - Mods / Resource Packs / Data Packs /
 * Shaders, each its own category, never mixed together. Rows are real
 * Modrinth listings pulled live and cached locally (see catalogCache.js /
 * modrinth.js in the main process) - nothing here is hand-typed or
 * invented, and nothing is copied from Modrinth's own UI, just the same
 * kind of information their own listing rows show.
 */
const PALETTE = ["var(--cyan)", "var(--violet)", "var(--emerald)", "var(--amber)", "var(--rose)"];
function withColours(rows) {
  return rows.map((r, i) => ({ ...r, c: PALETTE[i % PALETTE.length] }));
}

/* Modrinth's own loader-as-a-category convention (confirmed via the live
 * /tag/loader endpoint - 29 entries mixing true mod loaders, plugin
 * platforms, proxies and shader loaders into one list). Reminth is a
 * Fabric-only launcher, so the only one that gets its own tag here is
 * "fabric" - everything else in this set is filtered OUT of the plain
 * topic tag so a loader name never gets shown as if it were a category. */
const LOADER_CATEGORY_NAMES = new Set([
  "babric", "bta-babric", "bukkit", "bungeecord", "canvas", "datapack", "fabric", "folia",
  "forge", "geyser", "iris", "java-agent", "legacy-fabric", "liteloader", "minecraft",
  "modloader", "neoforge", "nilloader", "optifine", "ornithe", "paper", "purpur", "quilt",
  "rift", "spigot", "sponge", "vanilla", "velocity", "waterfall",
]);
function primaryCategoryTag(categories) {
  const topic = (categories || []).find((c) => !LOADER_CATEGORY_NAMES.has(c));
  return topic ? topic.charAt(0).toUpperCase() + topic.slice(1) : null;
}
function hasFabricLoader(categories) {
  return (categories || []).includes("fabric");
}

/**
 * Only ever let an <img> point at Modrinth's own CDN (the one remote host
 * the CSP allows for images) or a local file we ship. A URL out of an API
 * response is not a URL to hand a DOM node unchecked.
 */
function safeIconUrl(url) {
  if (typeof url !== "string" || !url) return null;
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.protocol === "https:" && parsed.hostname === "cdn.modrinth.com") return parsed.href;
    if (parsed.protocol === "file:") return parsed.href;
  } catch {
    return null;
  }
  return null;
}

/* Cached rows carry raw numbers/ISO dates (see catalogCache.js), not the
 * pre-formatted strings a hand-typed list would - format at render time. */
function formatCount(value) {
  // Coerced and range-checked rather than trusted: these numbers come from
  // the catalog cache, which is filled from an API response. A non-numeric
  // value used to fall through to String(value) and get written into the
  // page - see the stats row in buildModRows, which is built from DOM nodes
  // now for the same reason.
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
  const then = new Date(iso).getTime();
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

/*
 * Modrinth's own search-results rows are the reference the user asked to
 * match - icon, name + author, description, tag pills, stats and an
 * install action on the right. This is our own markup/CSS built to fit
 * that shape, not copied from Modrinth's source. No install state is
 * faked: nothing here is actually installed through Browse yet, so every
 * row gets the same disabled "Install · Soon" action as the rest of this
 * page, rather than a mix of real and pretend "Installed" badges.
 */
function buildModRows(gridId, items, opts) {
  const { emptyHint = "a name or a keyword", emptyTitle = "Nothing matches that search" } = opts || {};
  const grid = $(gridId);
  if (!grid) return;
  grid.textContent = "";
  if (!items.length) {
    const empty = el("div", "empty");
    empty.appendChild(el("b", null, emptyTitle));
    empty.appendChild(el("span", null, `Try ${emptyHint}.`));
    grid.appendChild(empty);
    return;
  }
  items.forEach((mod) => {
    const row = el("div", "card mod-row");
    row.style.setProperty("--mc", mod.c);

    // Real icon from cdn.modrinth.com (img-src allows that one host - see
    // index.html's CSP) with a same-letter-mark fallback if it fails to
    // load. The fallback is wired via addEventListener, never an inline
    // onerror="" attribute - CSP's script-src 'self' silently drops inline
    // event-handler attributes the same way it drops inline style="".
    let ico;
    const iconSrc = safeIconUrl(mod.icon_url);
    if (iconSrc) {
      ico = el("img", "mrow-ico");
      ico.src = iconSrc;
      ico.alt = "";
      ico.loading = "lazy";
      ico.addEventListener("error", () => {
        const fallback = el("div", "mrow-ico", mod.title.slice(0, 1));
        fallback.style.setProperty("--mc", mod.c);
        ico.replaceWith(fallback);
      });
    } else {
      ico = el("div", "mrow-ico", mod.title.slice(0, 1));
    }
    row.appendChild(ico);

    const main = el("div", "mrow-main");
    const top = el("div", "mrow-top");
    top.appendChild(el("span", "mrow-name", mod.title));
    if (mod.author) top.appendChild(el("span", "mrow-by", "by " + mod.author));
    main.appendChild(top);
    main.appendChild(el("p", "mrow-note", mod.description || ""));
    const tags = el("div", "mrow-tags");
    const topicTag = primaryCategoryTag(mod.categories);
    if (topicTag) tags.appendChild(el("span", "tag dim", topicTag));
    if (hasFabricLoader(mod.categories)) {
      const fabricTag = el("span", "tag amber");
      fabricTag.innerHTML = `<svg class="i"><use href="#i-block"/></svg>Fabric`;
      tags.appendChild(fabricTag);
    }
    main.appendChild(tags);
    row.appendChild(main);

    const side = el("div", "mrow-side");
    const installBtn = el("button", "btn outline sm is-soon");
    installBtn.disabled = true;
    installBtn.innerHTML = `<svg class="i"><use href="#i-plus"/></svg>Install<em class="soon">Soon</em>`;
    side.appendChild(installBtn);
    const dl = formatCount(mod.downloads);
    if (dl) {
      // Built as DOM nodes, not an innerHTML template. The icon markup is a
      // fixed string, but the values beside it come from the catalog cache,
      // and interpolating those into innerHTML is an injection straight into
      // a page that holds the IPC bridge. textContent can't be markup.
      const stats = el("div", "mrow-stats");
      const stat = (iconId, text) => {
        const span = el("span");
        const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        icon.setAttribute("class", "i");
        const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
        use.setAttribute("href", iconId);
        icon.appendChild(use);
        span.appendChild(icon);
        span.appendChild(document.createTextNode(text));
        return span;
      };
      stats.appendChild(stat("#i-download", dl));
      stats.appendChild(stat("#i-heart", formatCount(mod.follows) || "0"));
      stats.appendChild(stat("#i-clock", formatRelativeTime(mod.date_modified)));
      side.appendChild(stats);
    }
    row.appendChild(side);

    grid.appendChild(row);
  });
}

/*
 * One search box per Browse tab. `projectType` is Modrinth's own project
 * type string (confirmed live: mod / modpack / resourcepack / shader /
 * plugin / datapack / minecraft_java_server) - the same value the main
 * process's catalogCache.js warms and searches by.
 */
const BROWSE_CATEGORIES = [
  { projectType: "mod", gridId: "browseModsGrid", searchId: "browseModsSearch", pagerId: "browseModsPager", emptyHint: "a mod's name, its author, or a keyword like \"performance\" or \"shader\"" },
  { projectType: "resourcepack", gridId: "browsePacksGrid", searchId: "browsePacksSearch", pagerId: "browsePacksPager", emptyHint: "a pack's name or a keyword" },
  { projectType: "datapack", gridId: "browseDatapacksGrid", searchId: "browseDatapacksSearch", pagerId: "browseDatapacksPager", emptyHint: "a pack's name or a keyword" },
  { projectType: "shader", gridId: "browseShadersGrid", searchId: "browseShadersSearch", pagerId: "browseShadersPager", emptyHint: "a shader pack's name or a keyword" },
];

// Rows per Browse page. The cache can hold up to 10,000 per category (see
// catalogCache.js) - showing them all in one unpaginated list would mean
// scrolling through a very long column of full-width rows, so the grid
// shows one page's worth at a time and buildPager() below drives moving
// between pages.
const PAGE_SIZE = 20;
// projectType -> the page currently being viewed, so a background cache
// refresh (see onCatalogWarmProgress in boot()) can redraw the page the
// player is actually looking at instead of yanking them back to page 1.
const browsePage = new Map();

/**
 * Which page numbers to actually draw for a Prev/Next pager with up to
 * ~500 possible pages: always the first and last page, the current page
 * and its immediate neighbours, with "…" filling any gap in between -
 * never every single page number.
 */
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

/** Numbered pagination for a Browse grid. Hidden entirely (empty container)
 *  when there's nothing to page through - a fresh/small cache, or a search
 *  that narrowed the result set down to one page's worth. */
function buildPager(pagerId, info) {
  const bar = $(pagerId);
  if (!bar) return;
  bar.textContent = "";
  if (!info || info.totalPages <= 1) return;
  const { page, totalPages, onGoTo } = info;

  const makeBtn = (label, target, opts = {}) => {
    const btn = el("button", "pager-btn" + (opts.active ? " active" : ""));
    btn.type = "button";
    btn.textContent = label;
    if (opts.active) btn.setAttribute("aria-current", "page");
    btn.disabled = !!opts.disabled;
    if (!opts.disabled && !opts.active) btn.addEventListener("click", () => onGoTo(target));
    return btn;
  };

  bar.appendChild(makeBtn("‹ Prev", page - 1, { disabled: page <= 1 }));
  for (const p of pageWindow(page, totalPages)) {
    if (p === "…") bar.appendChild(el("span", "pager-gap", "…"));
    else bar.appendChild(makeBtn(String(p), p, { active: p === page }));
  }
  bar.appendChild(makeBtn("Next ›", page + 1, { disabled: page >= totalPages }));
}

/*
 * Reads from the local cache (instant, no network - see catalogCache.js)
 * rather than a static array. An empty result gets two different messages
 * depending on why it's empty: a search with no matches vs. a catalog that
 * hasn't finished its first background warm-up yet (see main.js's
 * warmCacheIfStale). Showing the same "nothing matches" message for both
 * would make a brand-new install look broken instead of just still loading.
 */
async function renderBrowseCategory(cat, query, page = 1) {
  const grid = $(cat.gridId);
  if (!grid) return;
  let result;
  try {
    result = await window.reminth.browseCachedCatalog({
      projectType: cat.projectType,
      query: query || "",
      sort: "downloads",
      offset: (page - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
    });
  } catch {
    result = { hits: [], total: 0 };
  }
  const totalPages = Math.max(1, Math.ceil((result.total || 0) / PAGE_SIZE));
  if (page > totalPages) {
    // Out-of-range page (e.g. a search just narrowed the result set out
    // from under the page the player was on) - snap back to the last real
    // page instead of rendering a blank one.
    return renderBrowseCategory(cat, query, totalPages);
  }
  browsePage.set(cat.projectType, page);

  if (!result.hits.length && page === 1 && !(query || "").trim()) {
    let status = null;
    try {
      status = await window.reminth.catalogWarmStatus(cat.projectType);
    } catch {
      // leave status null - treated the same as "still building" below
    }
    const building = !status || status.state === "running" || status.state === "idle";
    buildModRows(cat.gridId, [], {
      emptyTitle: building ? "Still building your catalog" : "Nothing matches that search",
      emptyHint: building
        ? "give it a minute - it's pulling real listings from Modrinth in the background"
        : cat.emptyHint,
    });
    buildPager(cat.pagerId, null);
    return;
  }
  buildModRows(cat.gridId, withColours(result.hits), { emptyHint: cat.emptyHint });
  buildPager(cat.pagerId, { page, totalPages, onGoTo: (p) => renderBrowseCategory(cat, query, p) });
}

/* Decorative tile wall on the Hosting page - drawn marks only, no game art. */
function buildHostTiles() {
  const wrap = $("hostTiles");
  if (!wrap) return;
  const marks = [
    ["#i-block", "var(--emerald)"], ["#i-cube", "var(--cyan)"], ["#i-pack", "var(--violet)"],
    ["#i-people", "var(--amber)"], ["#i-server", "var(--cyan)"], ["#i-bolt", "var(--rose)"],
    ["#i-world", "var(--emerald)"], ["#i-hosting", "var(--violet)"], ["#i-link", "var(--cyan)"],
  ];
  wrap.textContent = "";
  marks.forEach(([href, colour]) => {
    const tile = el("div", "host-tile");
    tile.style.setProperty("--ht", colour);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    if (href === "#i-block") svg.setAttribute("class", "block-mark");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", href);
    svg.appendChild(use);
    tile.appendChild(svg);
    wrap.appendChild(tile);
  });
}

/* ================================================================== *
 * what's new                                                          *
 * ================================================================== */
const CHANGELOG = [
  {
    version: "1.0.0-dev",
    items: [
      "New launcher layout: icon sidebar, Home, Instance, Mods, Skin and Player Statistics.",
      "Player Statistics reads your real save files — playtime, deaths, blocks mined, distance travelled.",
      "Home now shows the worlds and servers you actually played last.",
      "Reminth no longer installs mods you didn't ask for. Only ReminthHUD and the Fabric API it needs.",
      "Fixed the natives path bug that made Minecraft unpack its libraries into a junk folder.",
      "Fixed duplicate mod jars piling up in the mods folder after updates.",
      "Default memory is now 2 GB, the same as the official launcher.",
    ],
  },
];

function renderChangelog() {
  const box = $("changelog");
  box.textContent = "";
  const entry = CHANGELOG[0];
  $("changelogVersion").textContent = "Reminth " + (state.info ? state.info.appVersion : entry.version);

  const list = el("ul", "change-list");
  entry.items.forEach((item) => list.appendChild(el("li", null, item)));
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
    // rawLabels: world names are the player's own text and must not be run
    // through the item-id prettifier (it would turn "my_world" into "My World").
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

/*
 * The Home stat row (mob kills / player kills / deaths / blocks placed /
 * blocks broken) reads from the same real stats.json data as the full
 * Stats page - "placed" is the "used" count on block items (that's what
 * Minecraft itself increments when you place one), "broken" is "mined".
 * A read error shows "—" (unknown), a fresh save with no stats file yet
 * shows real zeroes rather than a dash, same distinction the Stats page
 * empty state makes.
 */
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

  if (stats.error) {
    renderEmpty(body, "Couldn't read your statistics", stats.error);
    return;
  }
  if (!stats.found) {
    renderEmpty(
      body,
      "No statistics yet",
      state.signedIn
        ? "Play a world and Minecraft will start recording your stats. They show up here automatically."
        : "Sign in and play a world — your stats come straight from your own save files."
    );
    return;
  }

  const cards = el("div", "stat-cards");
  cards.appendChild(bigStat("Time played", formatPlaytime(stats.playTimeTicks), `Across ${stats.worldCount} world${stats.worldCount === 1 ? "" : "s"}`, "var(--amber)"));
  cards.appendChild(bigStat("Deaths", formatNumber(stats.deaths), stats.deaths ? "Happens to everyone" : "Flawless so far", "var(--rose)"));
  cards.appendChild(bigStat("Mobs killed", formatNumber(stats.mobKills), null, "var(--violet)"));
  cards.appendChild(bigStat("Blocks mined", formatNumber(stats.totals.mined), null, "var(--cyan)"));
  cards.appendChild(bigStat("Jumps", formatNumber(stats.jumps), null, "var(--emerald)"));
  cards.appendChild(bigStat("Damage dealt", formatNumber(Math.round(stats.damageDealt / 10)), "Damage points", "var(--rose)"));
  body.appendChild(cards);

  // distance travelled
  const distanceEntries = Object.entries(stats.distances)
    .filter(([, cm]) => cm > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id, cm]) => ({ id, count: cm }));

  const grid = el("div", "two-col");
  grid.style.marginTop = "14px";
  if (distanceEntries.length) {
    grid.appendChild(barList("Distance travelled", distanceEntries, formatDistance));
  }
  if (stats.top.mined.length) {
    grid.appendChild(barList("Most mined", stats.top.mined));
  }
  if (stats.top.killed.length) {
    grid.appendChild(barList("Most killed", stats.top.killed));
  }
  if (stats.top.used.length) {
    grid.appendChild(barList("Most used", stats.top.used));
  }
  if (stats.perWorld.length > 1) {
    grid.appendChild(
      barList(
        "Time by world",
        stats.perWorld.map((w, _i, all) => ({
          id: all.filter((o) => o.name === w.name).length > 1 && w.folder !== w.name
            ? `${w.name} (${w.folder})`
            : w.name,
          count: w.playTimeTicks,
        })),
        (ticks) => formatPlaytime(ticks),
        true
      )
    );
  }
  if (stats.top.killedBy.length) {
    grid.appendChild(barList("Killed by", stats.top.killedBy));
  }
  // A brand-new player can have every breakdown empty; appending the grid
  // anyway left a stray gap under the cards.
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
    state.settings = await window.reminth.setSettings(partial);
    if (note) toast(note);
    return true;
  } catch {
    toast("Couldn't save that setting.");
    return false;
  }
}

function wireSwitch(id, key, note) {
  $(id).onclick = async () => {
    const on = !$(id).classList.contains("on");
    setSwitch(id, on);
    // Put the switch back if the save failed, rather than leaving the UI
    // showing a state that never reached disk.
    const saved = await saveSetting({ [key]: on }, typeof note === "function" ? note(on) : note);
    if (!saved) setSwitch(id, !on);
  };
}

wireSwitch("toggleLaunchMinimized", "launchMinimized", (on) =>
  on ? "Reminth will minimize when the game starts." : "Reminth will stay open when the game starts."
);
wireSwitch("toggleHardwareAccel", "hardwareAcceleration", "Restart Reminth for that to take effect.");

$("toggleFullscreen").onclick = async () => {
  const on = !$("toggleFullscreen").classList.contains("on");
  setSwitch("toggleFullscreen", on);
  setResolutionEnabled(!on);
  const saved = await saveSetting(
    { fullscreen: on },
    on ? "Minecraft will start fullscreen." : "Minecraft will start windowed."
  );
  if (!saved) {
    setSwitch("toggleFullscreen", !on);
    setResolutionEnabled(on);
  }
};

$("ramRange").addEventListener("input", () => {
  const gb = Number($("ramRange").value);
  $("ramVal").textContent = gb + " GB";
  updateRamNote(gb);
});
$("ramRange").addEventListener("change", () => {
  const gb = Number($("ramRange").value);
  saveSetting({ maxMemoryMb: gb * 1024 }, `Minecraft will use up to ${gb} GB from your next launch.`);
});

function updateRamNote(gb) {
  const totalGb = state.info ? Math.round(state.info.totalMemoryMb / 1024) : null;
  let note = "";
  if (gb <= 1) note = "Very tight — Minecraft may stutter or run out of memory.";
  else if (gb === 2) note = "The standard default. Fine for vanilla and a few light mods.";
  else if (gb <= 6) note = "Comfortable for a modded setup.";
  else note = "More than most setups need — extra memory doesn't add FPS on its own.";
  if (totalGb && gb > totalGb - 2) {
    note += ` Careful: this machine has ${totalGb} GB total, and Windows needs some too.`;
  }
  $("ramNote").textContent = note;
}

function setResolutionEnabled(enabled) {
  $("resolutionRow").style.opacity = enabled ? "1" : ".45";
  $("gameWidth").disabled = !enabled;
  $("gameHeight").disabled = !enabled;
}

function commitResolution() {
  const width = parseInt($("gameWidth").value, 10);
  const height = parseInt($("gameHeight").value, 10);
  const valid = width > 0 && height > 0;
  saveSetting(
    { gameWidth: valid ? width : null, gameHeight: valid ? height : null },
    valid ? `Minecraft will open at ${width}×${height}.` : "Minecraft will use its own window size."
  );
}
$("gameWidth").addEventListener("change", commitResolution);
$("gameHeight").addEventListener("change", commitResolution);

$("saveJvmArgs").onclick = () =>
  saveSetting({ extraJvmArgs: $("extraJvmArgs").value.trim() }, "Saved. Applies on your next launch.");

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

$("openGameFolder").onclick = () => openFolder("game");
$("openGameFolder2").onclick = () => openFolder("game");
$("openModsFolder").onclick = () => openFolder("mods");
$("openModsFolder2").onclick = () => openFolder("mods");
$("openPacksFolder").onclick = () => openFolder("resourcepacks");
// "Files" sits in the tab strip but behaves like the button it really is:
// it opens the instance folder rather than switching to a pane.
$("tabFilesBtn").onclick = () => openFolder("game");

async function openFolder(which) {
  try {
    await window.reminth.openFolder(which);
  } catch {
    toast("Couldn't open that folder.");
  }
}

/* placeholders - labelled "Soon" in the UI, so they stay honest and quiet */
$("railAdd").onclick = () => toast("Multiple instances are coming in a future update.");
$("newServerBtn").onclick = () => {};
$("linkServerBtn").onclick = () => {};
$("skinFetchBtn").onclick = () => toast("Skin previews by username land with the skin update.");
$("skinFile").onchange = (event) => {
  toast("Uploading skins needs Mojang's skin service — not wired up yet.");
  event.target.value = ""; // so picking the same file again still fires
};

/* ================================================================== *
 * startup                                                             *
 * ================================================================== */
async function boot() {
  // Matches the page that's active by default in the static HTML (home) -
  // can't use a style="" attribute here, the CSP (style-src 'self', no
  // unsafe-inline) silently drops inline style attributes, so this has to
  // be set from script instead, same as switchPage() already does it.
  $("appSideMods").style.display = "none";

  buildDiscover();
  resolveManagedIcons();
  buildHostTiles();
  // Debounced (250ms after the player stops typing) - each keystroke would
  // otherwise fire its own IPC round trip to the main process's cache read.
  // A newer keystroke's search always wins: the timer is just reset, so an
  // in-flight older query can never land after a more recent one.
  BROWSE_CATEGORIES.forEach((cat) => {
    renderBrowseCategory(cat, "");
    let debounceTimer;
    $(cat.searchId).addEventListener("input", (e) => {
      clearTimeout(debounceTimer);
      const value = e.target.value;
      debounceTimer = setTimeout(() => renderBrowseCategory(cat, value), 250);
    });
  });
  // The background catalog warm-up (main.js, on launch) pushes progress as
  // it runs - live-refresh whichever Browse tab that category belongs to,
  // with an empty search, so a player sitting on Mods & Addons watches real
  // rows appear rather than staring at "Still building your catalog" until
  // they happen to switch tabs and back.
  window.reminth.onCatalogWarmProgress?.((status) => {
    const cat = BROWSE_CATEGORIES.find((c) => c.projectType === status.project_type);
    if (!cat) return;
    const input = $(cat.searchId);
    if (!input || !input.value.trim()) {
      renderBrowseCategory(cat, "", browsePage.get(cat.projectType) || 1);
    }
    // The Discover cards and the Fabric API card read their icons out of
    // this same cache, so a cold install that had nothing to show gets its
    // real artwork as soon as mods finish caching.
    if (status.project_type === "mod" && status.state === "done") {
      buildDiscover();
      resolveManagedIcons();
    }
  });

  // Ask who's signed in rather than waiting for the auth:restored push - that
  // event only fires once, so a reloaded page would otherwise show "Not
  // signed in" while the main process still has the account.
  try {
    const account = await window.reminth.currentAccount();
    if (account && account.username) {
      state.signedIn = true;
      state.username = account.username;
    }
  } catch {
    /* stays signed out */
  }
  applyAccountUI();

  try {
    state.info = await window.reminth.appInfo();
    const info = state.info;
    $("heroVersion").textContent = "Minecraft " + info.minecraftVersion;
    $("heroMods").textContent = "Loader " + info.fabricLoaderVersion;
    $("instVersion").textContent = "Minecraft " + info.minecraftVersion;
    $("aboutVersion").textContent = "Reminth " + info.appVersion;
    $("aboutBuild").textContent = `Minecraft ${info.minecraftVersion} · Fabric ${info.fabricLoaderVersion}`;

    const maxGb = Math.max(4, Math.min(32, Math.floor(info.totalMemoryMb / 1024)));
    $("ramRange").max = String(maxGb);
    $("ramMax").textContent = maxGb + " GB";

    renderManagedMods();
    renderChangelog();
  } catch {
    toast("Couldn't read launcher info.");
  }

  try {
    const paths = await window.reminth.debugPaths();
    $("gameDirPath").textContent = paths.GAME_DIR;
  } catch {
    /* non-fatal */
  }

  try {
    state.settings = await window.reminth.getSettings();
    const s = state.settings;
    applyAccent(s.accent || "cyan");
    setSwitch("toggleLaunchMinimized", s.launchMinimized);
    setSwitch("toggleHardwareAccel", s.hardwareAcceleration !== false);
    setSwitch("toggleFullscreen", s.fullscreen);
    setResolutionEnabled(!s.fullscreen);
    if (s.gameWidth) $("gameWidth").value = s.gameWidth;
    if (s.gameHeight) $("gameHeight").value = s.gameHeight;
    $("extraJvmArgs").value = s.extraJvmArgs || "";

    const defaultGb = Math.round((state.info ? state.info.defaultMaxMemoryMb : 2048) / 1024);
    const gb = s.maxMemoryMb ? Math.round(s.maxMemoryMb / 1024) : defaultGb;
    $("ramRange").value = String(gb);
    // Read it back: the browser clamps to the slider's max, so the label has
    // to follow the control rather than the number we asked for.
    const applied = Number($("ramRange").value);
    $("ramVal").textContent = applied + " GB";
    updateRamNote(applied);
  } catch {
    /* defaults already in the markup */
  }

  loadInstalledMods();
  loadPacks();
  loadRecent();
  loadStats();
}

boot();
