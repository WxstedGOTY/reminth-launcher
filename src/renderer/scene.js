"use strict";
/* ================================================================== *
 * Home's background: a Minecraft night (owner, 15 Oct 2026: "make the  *
 * leaves look more like minecraft and wood on the tree, the blocks,    *
 * the grass, make it also slightly animated").                         *
 *                                                                      *
 * Everything is drawn here in code, block by block, with 16x16-texel   *
 * textures made from random numbers in the style of Minecraft's grass  *
 * block, dirt, stone, oak log and oak leaves - no file is taken from    *
 * the game. A fixed seed draws the same world every time.              *
 *                                                                      *
 * Two layers:                                                          *
 *  - the still world (sky, hills, blocks, trees) is painted once per    *
 *    window size into an off-screen canvas;                             *
 *  - every frame (30 a second, only while Home is on screen, the window  *
 *    is in front and no game runs) copies it and adds what moves:       *
 *    twinkling stars, drifting blocky clouds, a few falling leaves.     *
 * prefers-reduced-motion: the still world only.                        *
 * The moon is its own small canvas (#nightMoon) so the other pages      *
 * don't show it.                                                        *
 * ================================================================== */
(function nightScene() {
  const canvas = document.getElementById("nightScene");
  const moonCanvas = document.getElementById("nightMoon");
  if (!canvas) return;

  const B = 32; // one block, in screen px
  const TX = 16; // texels per block side (like the game)

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
  const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];

  /* ---- block textures (16x16 texels each, a few variants of every block) ---- */
  function texture(paint) {
    const c = document.createElement("canvas");
    c.width = TX;
    c.height = TX;
    const g = c.getContext("2d");
    paint((x, y, color) => {
      g.fillStyle = color;
      g.fillRect(x, y, 1, 1);
    });
    // night: the moon's cold light over every texel (only where there is one - leaf gaps stay see-through)
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = "rgba(12, 16, 34, 0.5)";
    g.fillRect(0, 0, TX, TX);
    return c;
  }

  const DIRT = ["#866043", "#866043", "#79553a", "#96694a", "#5e4130", "#9a7150"];
  const STONE = ["#7f7f7f", "#7f7f7f", "#747474", "#8a8a8a", "#686868", "#999999"];
  const GRASS = ["#5d9a33", "#6aab3c", "#558d2e", "#4a7d28", "#79b847"];
  const LOG = ["#6b5133", "#5b442a", "#7a5d3b", "#4b3820"];
  const LEAF = ["#3f7a24", "#4a8a2b", "#356a1e", "#2c5a18", "#5a9a35"];

  function dirtTex(rnd) {
    return texture((set) => {
      for (let y = 0; y < TX; y++) for (let x = 0; x < TX; x++) set(x, y, pick(rnd, DIRT));
    });
  }
  function stoneTex(rnd) {
    return texture((set) => {
      for (let y = 0; y < TX; y++) for (let x = 0; x < TX; x++) set(x, y, pick(rnd, STONE));
      // the darker streaks stone has
      for (let i = 0; i < 5; i++) {
        const x = Math.floor(rnd() * 14);
        const y = Math.floor(rnd() * 16);
        set(x, y, "#5f5f5f");
        set(x + 1, y, "#5f5f5f");
      }
    });
  }
  // the side of a grass block: dirt with a ragged green top
  function grassSideTex(rnd) {
    return texture((set) => {
      for (let y = 0; y < TX; y++) for (let x = 0; x < TX; x++) set(x, y, pick(rnd, DIRT));
      for (let x = 0; x < TX; x++) {
        let depth = 3 + (rnd() < 0.5 ? 1 : 0) + (rnd() < 0.25 ? 1 : 0);
        if (rnd() < 0.12) depth += 2; // the odd longer drip
        for (let y = 0; y < depth; y++) set(x, y, pick(rnd, GRASS));
      }
    });
  }
  // the side of an oak log: brown bark in up-and-down streaks
  function logTex(rnd) {
    return texture((set) => {
      const cols = [];
      for (let x = 0; x < TX; x++) cols.push(pick(rnd, LOG));
      for (let y = 0; y < TX; y++) {
        for (let x = 0; x < TX; x++) {
          let c = cols[x];
          if (rnd() < 0.12) c = pick(rnd, LOG);
          if (x % 4 === 0 && rnd() < 0.7) c = "#3f2e1a"; // the dark grooves
          set(x, y, c);
        }
      }
    });
  }
  // oak leaves: speckled greens with see-through gaps
  function leavesTex(rnd) {
    return texture((set) => {
      for (let y = 0; y < TX; y++) {
        for (let x = 0; x < TX; x++) {
          if (rnd() < 0.14) continue; // a gap: the sky shows through
          set(x, y, pick(rnd, LEAF));
        }
      }
    });
  }
  // the little plants on top: tall grass, a poppy, a dandelion
  function grassPlantTex(rnd) {
    return texture((set) => {
      for (let i = 0; i < 7; i++) {
        const x = 1 + Math.floor(rnd() * 14);
        const h = 5 + Math.floor(rnd() * 9);
        for (let y = TX - h; y < TX; y++) set(x, y, pick(rnd, GRASS));
        if (rnd() < 0.5) set(x + (rnd() < 0.5 ? 1 : -1), TX - h + 1, pick(rnd, GRASS));
      }
    });
  }
  function flowerTex(color, dark) {
    return texture((set) => {
      for (let y = 9; y < TX; y++) set(7, y, "#3f7a24");
      set(6, 12, "#4a8a2b");
      set(8, 11, "#4a8a2b");
      for (const [x, y] of [[6, 6], [7, 6], [8, 6], [6, 7], [7, 7], [8, 7], [7, 5], [7, 8]]) set(x, y, color);
      set(7, 7, dark);
    });
  }

  let textures = null;
  function makeTextures() {
    const rnd = random(77);
    const many = (fn, n) => Array.from({ length: n }, () => fn(rnd));
    textures = {
      dirt: many(dirtTex, 6),
      stone: many(stoneTex, 6),
      grass: many(grassSideTex, 6),
      log: many(logTex, 3),
      leaves: many(leavesTex, 6),
      plant: many(grassPlantTex, 4),
      poppy: flowerTex("#c8302c", "#7a1a18"),
      dandelion: flowerTex("#f0d43a", "#b8941c"),
    };
  }

  /* ---- the still world ---- */
  const still = document.createElement("canvas");
  let W = 0;
  let H = 0;
  let DPR = 1;
  let groundTop = 0; // the highest grass line, for the falling leaves
  let canopy = null; // { x, y, w, h } of the big oak's leaves
  let stars = [];
  let clouds = [];

  function drawBlock(g, tex, x, y) {
    g.drawImage(tex, x, y, B, B);
  }

  function paintStill() {
    if (!textures) makeTextures();
    W = window.innerWidth;
    H = window.innerHeight;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [canvas, still]) {
      c.width = Math.round(W * DPR);
      c.height = Math.round(H * DPR);
    }
    const g = still.getContext("2d");
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.imageSmoothingEnabled = false;
    const rnd = random(1402);

    // sky: almost black, a touch of night blue near the horizon
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#040406");
    sky.addColorStop(0.5, "#08090e");
    sky.addColorStop(0.8, "#0e1018");
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);

    // stars (drawn every frame, so they can twinkle)
    stars = [];
    const count = Math.round((W * H) / 6000);
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.round(rnd() * W),
        y: Math.round(Math.pow(rnd(), 1.25) * H * 0.62),
        s: rnd() < 0.15 ? 3 : 2,
        a: 0.25 + rnd() * 0.6,
        tw: rnd() < 0.35 ? 0.6 + rnd() * 1.6 : 0, // speed of the twinkle (0 = steady)
        ph: rnd() * Math.PI * 2,
      });
    }

    // clouds: flat blocky shapes, made once and drifting every frame
    clouds = [];
    for (let i = 0; i < 6; i++) {
      const cw = 6 + Math.floor(rnd() * 10);
      const ch = 2 + Math.floor(rnd() * 2);
      const cells = [];
      for (let y = 0; y < ch; y++) {
        const inset = y === 0 ? Math.floor(rnd() * 3) : 0;
        const end = cw - (y === ch - 1 ? Math.floor(rnd() * 3) : 0);
        for (let x = inset; x < end; x++) if (!(y === 0 && rnd() < 0.15)) cells.push([x, y]);
      }
      clouds.push({ cells, x: rnd() * (W + 400) - 200, y: H * (0.06 + rnd() * 0.22), speed: 3 + rnd() * 4, a: 0.1 + rnd() * 0.08 });
    }

    // far hills, then nearer ones: blocky silhouettes, only their top edges catch the moon
    const hills = (size, base, amp, len, color, edge) => {
      const phase = rnd() * Math.PI * 2;
      const phase2 = rnd() * Math.PI * 2;
      for (let x = -size; x < W + size; x += size) {
        const top = base + Math.sin(x / len + phase) * amp + Math.sin(x / (len * 0.37) + phase2) * amp * 0.35;
        const y0 = Math.round(top / size) * size;
        g.fillStyle = color;
        g.fillRect(x, y0, size, H - y0);
        g.fillStyle = edge; // the moonlit top edge of each step, like far terrain in the fog
        g.fillRect(x, y0, size, 2);
      }
    };
    hills(16, H * 0.6, H * 0.06, 260, "#1a1b21", "rgba(200, 210, 235, 0.07)");
    hills(16, H * 0.68, H * 0.035, 180, "#121317", "rgba(200, 210, 235, 0.05)");

    // small far-off oaks on the nearer hills: dark leaf blocks on a dark log
    for (let x = 80 + rnd() * 90; x < W; x += 110 + rnd() * 190) {
      const s = 10;
      const bx = Math.round(x / s) * s;
      const top = Math.round((H * (0.66 + rnd() * 0.05)) / s) * s;
      g.fillStyle = "#14110e";
      g.fillRect(bx + s, top, s, s * 3);
      g.fillStyle = "#1a2a1a";
      g.fillRect(bx, top - s * 2, s * 3, s * 2);
      g.fillRect(bx + s, top - s * 3, s, s);
      g.fillStyle = "#223422";
      g.fillRect(bx + (rnd() < 0.5 ? 0 : s * 2), top - s * 2, s, s);
    }

    // the ground: columns of blocks - grass on top, dirt under it, stone deeper down
    const cols = Math.ceil(W / B) + 1;
    const baseRow = Math.round((H * 0.8) / B);
    const heights = [];
    let level = 0;
    for (let c = 0; c < cols; c++) {
      // flat stretches with one-block steps, like the game's plains
      if (c > 0 && rnd() < 0.22) level += rnd() < 0.5 ? -1 : 1;
      level = Math.max(-2, Math.min(1, level));
      heights.push(baseRow + level);
    }
    groundTop = Math.min(...heights) * B;
    for (let c = 0; c < cols; c++) {
      const x = c * B;
      const top = heights[c] * B;
      drawBlock(g, pick(rnd, textures.grass), x, top);
      for (let y = top + B, row = 1; y < H; y += B, row++) {
        const stone = row > 3 || (row === 3 && rnd() < 0.5);
        drawBlock(g, pick(rnd, stone ? textures.stone : textures.dirt), x, y);
      }
    }

    // oaks: a log trunk and leaf blocks in the game's oak shape
    const oak = (col, trunk) => {
      const x = col * B;
      const ground = heights[Math.max(0, Math.min(cols - 1, col))] * B;
      for (let i = 1; i <= trunk; i++) drawBlock(g, pick(rnd, textures.log), x, ground - i * B);
      const top = ground - (trunk + 2) * B;
      const rows = [
        [-1, 1], // the top: three blocks
        [-1, 1],
        [-2, 2], // the two wide layers
        [-2, 2],
      ];
      rows.forEach(([from, to], r) => {
        for (let dx = from; dx <= to; dx++) {
          const corner = (dx === from || dx === to) && (r === 0 || r === 3);
          if (corner && rnd() < 0.6) continue; // the game leaves some corners off
          if (r >= 2 && dx === 0 && r === 3) continue; // the trunk shows under the leaves
          drawBlock(g, pick(rnd, textures.leaves), x + dx * B, top + r * B);
        }
      });
      // the top layer is a plus: one block above the middle
      drawBlock(g, pick(rnd, textures.leaves), x, top - B);
      return { x: x - 2 * B, y: top - B, w: 5 * B, h: 5 * B };
    };
    const bigCol = Math.max(4, Math.round(Math.max(110, W * 0.07) / B) + 2);
    canopy = oak(bigCol, 4);
    const rightCol = Math.round((W - 150) / B);
    if (rightCol > bigCol + 12) oak(rightCol, 3);

    // the little plants on the grass
    for (let c = 0; c < cols; c++) {
      if (c >= bigCol - 2 && c <= bigCol + 2) continue;
      const r = rnd();
      const top = heights[c] * B - B;
      if (r < 0.28) drawBlock(g, pick(rnd, textures.plant), c * B, top);
      else if (r < 0.33) drawBlock(g, textures.poppy, c * B, top);
      else if (r < 0.37) drawBlock(g, textures.dandelion, c * B, top);
    }

    // darker towards the bottom, so Quick join and the buttons read
    const shade = g.createLinearGradient(0, H * 0.72, 0, H);
    shade.addColorStop(0, "rgba(0, 0, 0, 0)");
    shade.addColorStop(1, "rgba(0, 0, 0, 0.45)");
    g.fillStyle = shade;
    g.fillRect(0, H * 0.72, W, H * 0.28);

    paintMoon();
    leaves.length = 0;
    drawFrame(performance.now());
  }

  /* ---- the moon (its own layer) ---- */
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
    const M = 64;
    const mx = CW - 236 - M / 2; // 268 px from the window's right, over the side cards
    const my = Math.round(Math.max(84, H * 0.11) / 4) * 4;
    for (const [pad, a] of [[90, 0.03], [56, 0.035], [26, 0.045]]) {
      g.fillStyle = `rgba(160, 160, 168, ${a})`;
      g.fillRect(mx - pad, my - pad, M + pad * 2, M + pad * 2);
    }
    g.fillStyle = "#cfcfc6";
    g.fillRect(mx, my, M, M);
    const craters = [[1, 1, "#b5b5ac"], [2, 1, "#a9a9a0"], [5, 2, "#b5b5ac"], [3, 3, "#a3a39a"], [4, 3, "#b0b0a7"], [1, 5, "#a9a9a0"], [5, 5, "#b5b5ac"], [6, 5, "#a3a39a"], [3, 6, "#b5b5ac"]];
    for (const [cx, cy, c] of craters) {
      g.fillStyle = c;
      g.fillRect(mx + cx * 8, my + cy * 8, 8, 8);
    }
    g.fillStyle = "#dedcd4";
    g.fillRect(mx, my, M, 4);
  }

  /* ---- what moves ---- */
  const leaves = []; // falling leaf bits from the big oak
  let lastLeaf = 0;
  const ctx = canvas.getContext("2d");

  function drawFrame(now) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(still, 0, 0, W, H);
    const t = now / 1000;

    for (const s of stars) {
      let a = s.a;
      if (s.tw) a *= 0.55 + 0.45 * Math.sin(t * s.tw + s.ph);
      ctx.fillStyle = `rgba(235, 235, 242, ${a.toFixed(2)})`;
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }

    const cell = 12;
    for (const c of clouds) {
      const span = W + 600;
      const x = ((((c.x + t * c.speed) % span) + span) % span) - 300;
      ctx.fillStyle = `rgba(150, 156, 175, ${c.a.toFixed(2)})`;
      for (const [cx, cy] of c.cells) ctx.fillRect(Math.round(x + cx * cell), Math.round(c.y + cy * cell), cell, cell);
    }

    for (const l of leaves) {
      ctx.fillStyle = l.color;
      ctx.globalAlpha = Math.max(0, Math.min(1, l.life));
      ctx.fillRect(Math.round(l.x), Math.round(l.y), 4, 4);
    }
    ctx.globalAlpha = 1;
  }

  function stepLeaves(now, dt) {
    if (canopy && now - lastLeaf > 1400 && leaves.length < 6) {
      lastLeaf = now + Math.random() * 1600;
      leaves.push({
        x: canopy.x + Math.random() * canopy.w,
        y: canopy.y + canopy.h * (0.5 + Math.random() * 0.5),
        vx: 0,
        ph: Math.random() * Math.PI * 2,
        life: 1,
        color: ["#2f5a1c", "#3a6a22", "#28501a"][Math.floor(Math.random() * 3)],
      });
    }
    for (const l of leaves) {
      l.y += dt * 14;
      l.x += Math.sin(now / 600 + l.ph) * dt * 10;
      if (l.y > groundTop + B) l.life -= dt * 0.8;
    }
    for (let i = leaves.length - 1; i >= 0; i--) if (leaves[i].life <= 0 || leaves[i].y > H) leaves.splice(i, 1);
  }

  /* ---- the loop: only while someone can see Home move ---- */
  const still_only = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const moving = () =>
    !still_only &&
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
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      stepLeaves(now, dt);
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
  new MutationObserver(wake).observe(document.getElementById("app"), { attributes: true, attributeFilter: ["class"] });

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
