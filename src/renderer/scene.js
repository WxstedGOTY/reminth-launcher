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
 *  - every frame (30 a second, only while Home is on screen, the window  *
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
  let clouds = [];

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

    // clouds: flat blocky shapes like the game's, made once and drifting every frame
    clouds = [];
    for (let i = 0; i < 9; i++) {
      const cw = 6 + Math.floor(rnd() * 12);
      const ch = 2 + Math.floor(rnd() * 2);
      const cells = [];
      for (let y = 0; y < ch; y++) {
        const inset = y === 0 ? Math.floor(rnd() * 3) : 0;
        const end = cw - (y === ch - 1 ? Math.floor(rnd() * 3) : 0);
        for (let x = inset; x < end; x++) if (!(y === 0 && rnd() < 0.15)) cells.push([x, y]);
      }
      clouds.push({ cells, x: rnd() * (W + 600) - 300, y: H * (0.04 + rnd() * 0.88), speed: 3 + rnd() * 5, a: 0.1 + rnd() * 0.08 });
    }

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

    const cell = 14;
    for (const c of clouds) {
      const span = W + 700;
      const x = ((((c.x + t * c.speed) % span) + span) % span) - 350;
      ctx.fillStyle = `rgba(150, 156, 175, ${c.a.toFixed(2)})`;
      for (const [cx, cy] of c.cells) ctx.fillRect(Math.round(x + cx * cell), Math.round(c.y + cy * cell), cell, cell);
    }
  }

  /* ---- the loop: only while someone can see Home move ---- */
  const stillOnly = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const moving = () =>
    !stillOnly &&
    document.body.dataset.page === "home" && // Home, and the sign-in screen (it is Home while signed out)
    document.visibilityState === "visible" &&
    !document.body.classList.contains("unfocused") &&
    !document.body.classList.contains("game-running");

  let last = 0;
  let running = false;
  function loop(now) {
    if (!moving()) {
      running = false;
      return;
    }
    if (now - last >= 33) {
      last = now;
      drawFrame(now);
    }
    requestAnimationFrame(loop);
  }
  function wake() {
    if (running || !moving()) return;
    running = true;
    last = performance.now();
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
