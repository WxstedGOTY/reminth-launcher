"use strict";
/* ================================================================== *
 * Home's background (owner, 15 Oct 2026: "just dark with clouds and     *
 * those white stars ... without the trees and the plain biome, and the  *
 * blocks ... I want the moon to look exactly like minecraft's one").    *
 *                                                                      *
 * A dark sky with twinkling white stars and slowly drifting blocky      *
 * clouds, and the moon as a plain square with Minecraft's grey patches. *
 * Drawn in code (no game files). A fixed seed draws the same stars      *
 * every time.                                                           *
 *                                                                      *
 *  - the still sky is painted once per window size into an off-screen   *
 *    canvas;                                                             *
 *  - every frame (every frame, only while Home is on screen, the window  *
 *    is in front and no game runs) copies it and adds the twinkling and  *
 *    the clouds;                                                         *
 *  - prefers-reduced-motion: the still sky only.                        *
 * The moon is its own small canvas (#nightMoon) so the other pages      *
 * don't show it.                                                        *
 * ================================================================== */
(function nightScene() {
  const canvas = document.getElementById("nightScene");
  const moonCanvas = document.getElementById("nightMoon");
  if (!canvas) return;

  function random(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const still = document.createElement("canvas");
  let W = 0;
  let H = 0;
  let DPR = 1;
  let stars = [];
  const cloudTile = document.createElement("canvas");
  let cloudCell = 56;
  let cloudW = 1;
  let cloudH = 1;

  function paintStill() {
    W = window.innerWidth;
    H = window.innerHeight;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [canvas, still]) {
      c.width = Math.round(W * DPR);
      c.height = Math.round(H * DPR);
    }
    const g = still.getContext("2d");
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    const rnd = random(1402);

    // the sky: almost black, a little lighter towards the bottom
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#030304");
    sky.addColorStop(0.6, "#08080b");
    sky.addColorStop(1, "#0d0d11");
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);

    // stars over the whole window (drawn every frame, so they can twinkle)
    stars = [];
    const count = Math.round((W * H) / 5200);
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.round(rnd() * W),
        y: Math.round(rnd() * H),
        s: rnd() < 0.15 ? 3 : 2,
        a: 0.25 + rnd() * 0.6,
        tw: rnd() < 0.35 ? 0.6 + rnd() * 1.6 : 0, // speed of the twinkle (0 = steady)
        ph: rnd() * Math.PI * 2,
      });
    }

    // clouds, the way the game has them: one big grid of flat square cells (some filled, some not, in clumps with
    // square edges) that repeats in every direction and drifts steadily one way
    const COLS = 36;
    const ROWS = 24;
    let grid = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => rnd() < 0.44));
    for (let pass = 0; pass < 3; pass++) {
      // clump neighbours together (wrapping round the edges, so the tile joins up)
      grid = grid.map((row, y) =>
        row.map((_, x) => {
          let n = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (grid[(y + dy + ROWS) % ROWS][(x + dx + COLS) % COLS]) n++;
          return n >= 5;
        }),
      );
    }
    cloudCell = 56;
    cloudW = COLS * cloudCell;
    cloudH = ROWS * cloudCell;
    cloudTile.width = Math.round(cloudW * DPR);
    cloudTile.height = Math.round(cloudH * DPR);
    const cg = cloudTile.getContext("2d");
    cg.setTransform(DPR, 0, 0, DPR, 0, 0);
    cg.fillStyle = "rgb(196, 200, 214)"; // the strength is set when it is drawn
    grid.forEach((row, y) => row.forEach((on, x) => on && cg.fillRect(x * cloudCell - 0.5, y * cloudCell - 0.5, cloudCell + 1, cloudCell + 1)));

    paintMoon();
    drawFrame(performance.now());
  }

  /* ---- the moon (its own layer): the game's full moon, a square with grey patches ---- */
  // 8x8 cells, W bright, g grey, d darker grey - the patches of Minecraft's full-moon picture.
  const MOON = [
    "WWWWWWWW",
    "WWWgWWWW",
    "WgggWWdW",
    "WWgWWWWW",
    "WWWWWgWW",
    "WdWWgggW",
    "WWWWWWgW",
    "WWWWWWWW",
  ];
  const MOON_COLORS = { W: "#e9e9e9", g: "#c4c4c4", d: "#a6a6a6" };

  function paintMoon() {
    if (!moonCanvas) return;
    const CW = 440;
    const CH = 360;
    moonCanvas.style.width = CW + "px";
    moonCanvas.style.height = CH + "px";
    moonCanvas.width = Math.round(CW * DPR);
    moonCanvas.height = Math.round(CH * DPR);
    const g = moonCanvas.getContext("2d");
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    const cell = 10; // an 80 px square
    const mx = CW - 236 - (cell * 8) / 2; // centred 236 px from the window's right, over the side cards
    const my = Math.round(Math.max(84, H * 0.11) / 4) * 4;
    // one solid square first (no hairline gaps between cells when the window is zoomed), then the grey patches
    g.fillStyle = MOON_COLORS.W;
    g.fillRect(mx, my, cell * 8, cell * 8);
    MOON.forEach((row, y) => {
      for (let x = 0; x < 8; x++) {
        if (row[x] === "W") continue;
        g.fillStyle = MOON_COLORS[row[x]];
        g.fillRect(mx + x * cell, my + y * cell, cell, cell);
      }
    });
  }

  /* ---- what moves ---- */
  const ctx = canvas.getContext("2d");

  function drawFrame(now) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.drawImage(still, 0, 0, W, H);
    const t = now / 1000;

    for (const s of stars) {
      let a = s.a;
      if (s.tw) a *= 0.55 + 0.45 * Math.sin(t * s.tw + s.ph);
      ctx.fillStyle = `rgba(235, 235, 242, ${a.toFixed(2)})`;
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }

    // clouds: one steady drift (a wrap-around of the tile, so it never jumps), about 12 px a second
    ctx.globalAlpha = 0.085;
    const ox = (t * 12) % cloudW;
    const oy = -cloudH * 0.2; // the tile never starts exactly at the top
    for (let x = -ox; x < W; x += cloudW) for (let y = oy; y < H; y += cloudH) ctx.drawImage(cloudTile, x, y, cloudW, cloudH);
    ctx.globalAlpha = 1;
  }

  /* ---- the loop: only while someone can see Home move ---- */
  const stillOnly = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const moving = () =>
    !stillOnly &&
    document.body.dataset.page === "home" && // Home, and the sign-in screen (it is Home while signed out)
    document.visibilityState === "visible" &&
    !document.body.classList.contains("unfocused") &&
    !document.body.classList.contains("game-running");

  let running = false;
  function loop(now) {
    if (!moving()) {
      running = false;
      return;
    }
    drawFrame(now);
    requestAnimationFrame(loop);
  }
  function wake() {
    if (running || !moving()) return;
    running = true;
    requestAnimationFrame(loop);
  }
  document.addEventListener("reminth:page", () => setTimeout(wake, 0));
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("focus", () => setTimeout(wake, 0));
  // the body's classes (unfocused, game-running) change from renderer.js
  new MutationObserver(wake).observe(document.body, { attributes: true, attributeFilter: ["class", "data-page"] });

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(paintStill, 120);
  });
  paintStill();
  wake();
  // for tests and the hidden preview
  window.reminthScene = { paint: paintStill, moving, frame: () => drawFrame(performance.now()) };
})();
