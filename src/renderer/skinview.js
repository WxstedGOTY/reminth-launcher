"use strict";
/**
 * Reminth's 3D skin viewer - written from scratch for this app with plain
 * CSS 3D transforms (no WebGL, no third-party viewer library).
 *
 * The player is six boxes (head, body, two arms, two legs) plus an outer
 * "overlay" box for each (hat, jacket, sleeves, trousers) and an optional
 * cape. Every box face is a div whose background is the skin texture,
 * offset to that face's spot in Minecraft's skin layout and drawn with
 * nearest-neighbour scaling so pixels stay sharp.
 *
 * Idle animation: breathing, the head glancing around (and following the
 * cursor while it's over the viewer), arms and legs shifting their weight,
 * the cape swaying, and every so often a small wave. Drag to spin it.
 */
(function () {
  const TAU = Math.PI * 2;

  /** Face UVs of a Minecraft cube at (u, v) with size w×h×d. */
  function faceUVs(u, v, w, h, d) {
    return {
      top: [u + d, v, w, d],
      bottom: [u + d + w, v, w, d],
      right: [u, v + d, d, h], // the model's right side (viewer's left from the front)
      front: [u + d, v + d, w, h],
      left: [u + d + w, v + d, d, h],
      back: [u + 2 * d + w, v + d, w, h],
    };
  }

  /** Legacy 64×32 skins have no left arm/leg; mirror the right ones like the game does. */
  function upgradeLegacySkin(img) {
    const c = document.createElement("canvas");
    const s = img.width / 64;
    c.width = 64 * s;
    c.height = 64 * s;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0);
    const copy = (sx, sy, w, h, dx, dy) => {
      ctx.save();
      ctx.translate((dx + w) * s, dy * s);
      ctx.scale(-1, 1);
      ctx.drawImage(img, sx * s, sy * s, w * s, h * s, 0, 0, w * s, h * s);
      ctx.restore();
    };
    copy(4, 16, 4, 4, 20, 48); copy(8, 16, 4, 4, 24, 48);
    copy(0, 20, 4, 12, 24, 52); copy(4, 20, 4, 12, 20, 52); copy(8, 20, 4, 12, 16, 52); copy(12, 20, 4, 12, 28, 52);
    copy(44, 16, 4, 4, 36, 48); copy(48, 16, 4, 4, 40, 48);
    copy(40, 20, 4, 12, 40, 52); copy(44, 20, 4, 12, 36, 52); copy(48, 20, 4, 12, 32, 52); copy(52, 20, 4, 12, 44, 52);
    return c.toDataURL("image/png");
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Couldn't read that skin image."));
      img.src = src;
    });
  }

  function div(className) {
    const d = document.createElement("div");
    if (className) d.className = className;
    return d;
  }

  class SkinViewer {
    /**
     * opts: { scale (px per skin pixel), animate, interactive, yaw (deg), pitch (deg) }
     */
    constructor(container, opts = {}) {
      this.container = container;
      this.S = opts.scale || 9;
      this.animate = opts.animate !== false;
      this.interactive = opts.interactive !== false;
      this.baseYaw = opts.yaw !== undefined ? opts.yaw : -24;
      this.basePitch = opts.pitch !== undefined ? opts.pitch : -8;
      this.yaw = this.baseYaw;
      this.pitch = this.basePitch;
      this.velocity = 0;
      this.dragging = false;
      this.lookTarget = null;
      this.started = performance.now();
      this.nextWave = this.started + 7000 + Math.random() * 6000;
      this.waveStart = null;
      this.skinUrl = null;
      this.capeUrl = null;
      this.model = "classic";
      this.frame = null;

      container.textContent = "";
      container.classList.add("sv-viewport");
      this.scene = div("sv-scene");
      this.player = div("sv-player");
      this.scene.appendChild(this.player);
      container.appendChild(this.scene);
      this.shadow = div("sv-shadow");
      container.appendChild(this.shadow);

      if (this.interactive) this.bindPointer();
      this.applyScene();
    }

    bindPointer() {
      const c = this.container;
      let lastX = 0;
      let lastT = 0;
      c.addEventListener("pointerdown", (e) => {
        this.dragging = true;
        this.velocity = 0;
        lastX = e.clientX;
        lastT = performance.now();
        c.setPointerCapture(e.pointerId);
        c.classList.add("grabbing");
      });
      c.addEventListener("pointermove", (e) => {
        const box = c.getBoundingClientRect();
        // head follows the cursor a little while it's over the viewer
        this.lookTarget = {
          x: ((e.clientX - box.left) / box.width - 0.5) * 2,
          y: ((e.clientY - box.top) / box.height - 0.35) * 2,
        };
        if (!this.dragging) return;
        const now = performance.now();
        const dx = e.clientX - lastX;
        this.yaw += dx * 0.6;
        this.velocity = (dx * 0.6) / Math.max(8, now - lastT);
        lastX = e.clientX;
        lastT = now;
        if (!this.animate) this.render(now);
      });
      const end = (e) => {
        if (!this.dragging) return;
        this.dragging = false;
        c.classList.remove("grabbing");
        try {
          c.releasePointerCapture(e.pointerId);
        } catch {
          // already released
        }
      };
      c.addEventListener("pointerup", end);
      c.addEventListener("pointercancel", end);
      c.addEventListener("pointerleave", () => {
        this.lookTarget = null;
      });
    }

    async setSkin(dataUrl, model) {
      this.model = model === "slim" ? "slim" : "classic";
      let url = dataUrl;
      try {
        const img = await loadImage(dataUrl);
        if (img.height * 2 === img.width) url = upgradeLegacySkin(img);
      } catch {
        return;
      }
      this.skinUrl = url;
      this.build();
    }

    setModel(model) {
      this.model = model === "slim" ? "slim" : "classic";
      if (this.skinUrl) this.build();
    }

    setCape(dataUrl) {
      this.capeUrl = dataUrl || null;
      if (this.skinUrl) this.build();
    }

    /** One textured box. center: [x,y,z] in skin pixels relative to its parent pivot. */
    box(parent, tex, texSize, uv, size, center, inflate, extraClass) {
      const S = this.S;
      const [w, h, d] = size;
      const [W, H, D] = [w + inflate * 2, h + inflate * 2, d + inflate * 2];
      const el = div("sv-box" + (extraClass ? " " + extraClass : ""));
      el.style.transform = `translate3d(${center[0] * S}px, ${center[1] * S}px, ${center[2] * S}px)`;
      const uvs = faceUVs(uv[0], uv[1], w, h, d);
      const faces = {
        front: [W, H, `translateZ(${(D * S) / 2}px)`],
        back: [W, H, `rotateY(180deg) translateZ(${(D * S) / 2}px)`],
        right: [D, H, `rotateY(-90deg) translateZ(${(W * S) / 2}px)`],
        left: [D, H, `rotateY(90deg) translateZ(${(W * S) / 2}px)`],
        top: [W, D, `rotateX(90deg) translateZ(${(H * S) / 2}px)`],
        bottom: [W, D, `rotateX(-90deg) translateZ(${(H * S) / 2}px)`],
      };
      const sx = W / w;
      const sy = H / h;
      for (const [name, [fw, fh, transform]] of Object.entries(faces)) {
        const f = div("sv-face");
        const [fu, fv, uw, uh] = uvs[name];
        const kx = fw / uw; // inflated faces stretch their texture to the bigger face
        const ky = fh / uh;
        f.style.width = `${fw * S}px`;
        f.style.height = `${fh * S}px`;
        f.style.left = `${(-fw * S) / 2}px`;
        f.style.top = `${(-fh * S) / 2}px`;
        f.style.transform = transform;
        f.style.backgroundImage = `url("${tex}")`;
        f.style.backgroundSize = `${texSize[0] * S * kx}px ${texSize[1] * S * ky}px`;
        f.style.backgroundPosition = `${-fu * S * kx}px ${-fv * S * ky}px`;
        if (name === "bottom") f.classList.add("flip-y");
        el.appendChild(f);
      }
      void sx;
      void sy;
      parent.appendChild(el);
      return el;
    }

    pivot(parent, at) {
      const p = div("sv-pivot");
      p.dataset.at = at.join(",");
      p._at = at;
      parent.appendChild(p);
      return p;
    }

    build() {
      const tex = this.skinUrl;
      const T = [64, 64];
      const aw = this.model === "slim" ? 3 : 4;
      this.player.textContent = "";
      const legs = div("sv-group");
      const upper = div("sv-group");
      this.player.appendChild(legs);
      this.player.appendChild(upper);
      this.upper = upper;

      // Origin: the hips, centre of the body. y grows downward (CSS).
      this.parts = {};
      const legR = this.pivot(legs, [-2, 0, 0]);
      this.box(legR, tex, T, [0, 16], [4, 12, 4], [0, 6, 0], 0);
      this.box(legR, tex, T, [0, 32], [4, 12, 4], [0, 6, 0], 0.25, "overlay");
      const legL = this.pivot(legs, [2, 0, 0]);
      this.box(legL, tex, T, [16, 48], [4, 12, 4], [0, 6, 0], 0);
      this.box(legL, tex, T, [0, 48], [4, 12, 4], [0, 6, 0], 0.25, "overlay");

      const body = this.pivot(upper, [0, 0, 0]);
      this.box(body, tex, T, [16, 16], [8, 12, 4], [0, -6, 0], 0);
      this.box(body, tex, T, [16, 32], [8, 12, 4], [0, -6, 0], 0.25, "overlay");

      const armR = this.pivot(upper, [-(4 + aw / 2), -10, 0]);
      this.box(armR, tex, T, [40, 16], [aw, 12, 4], [0, 4, 0], 0);
      this.box(armR, tex, T, [40, 32], [aw, 12, 4], [0, 4, 0], 0.25, "overlay");
      const armL = this.pivot(upper, [4 + aw / 2, -10, 0]);
      this.box(armL, tex, T, [32, 48], [aw, 12, 4], [0, 4, 0], 0);
      this.box(armL, tex, T, [48, 48], [aw, 12, 4], [0, 4, 0], 0.25, "overlay");

      const head = this.pivot(upper, [0, -12, 0]);
      this.box(head, tex, T, [0, 0], [8, 8, 8], [0, -4, 0], 0);
      this.box(head, tex, T, [32, 0], [8, 8, 8], [0, -4, 0], 0.5, "overlay");

      let cape = null;
      if (this.capeUrl) {
        cape = this.pivot(upper, [0, -12, -2]);
        // Cape textures are 64×32 (sometimes HD multiples of it).
        this.box(cape, this.capeUrl, [64, 32], [0, 0], [10, 16, 1], [0, 8, -0.5], 0, "cape");
      }
      this.parts = { legR, legL, body, armR, armL, head, cape };
      this.render(performance.now());
      if (this.animate && !this.frame) this.loop();
    }

    applyScene() {
      const S = this.S;
      // Centre the 32-pixel-tall figure: hips sit 4 skin pixels below the middle.
      this.scene.style.transform = `translateY(${4 * S}px) rotateX(${this.pitch}deg) rotateY(${this.yaw}deg)`;
      this.shadow.style.width = `${18 * S}px`;
      this.shadow.style.height = `${5 * S}px`;
      this.shadow.style.marginLeft = `${-9 * S}px`;
      this.shadow.style.top = `calc(50% + ${15.5 * S}px)`;
    }

    setPose(part, rx, ry, rz) {
      const p = this.parts[part];
      if (!p) return;
      const [x, y, z] = p._at;
      const S = this.S;
      p.style.transform = `translate3d(${x * S}px, ${y * S}px, ${z * S}px) rotateY(${ry}deg) rotateX(${rx}deg) rotateZ(${rz}deg)`;
    }

    render(now) {
      if (!this.parts || !this.parts.body) return;
      const t = (now - this.started) / 1000;
      const a = this.animate;

      // Spin: drag inertia, then a gentle sway around wherever it was left.
      if (!this.dragging && Math.abs(this.velocity) > 0.001) {
        this.yaw += this.velocity * 16;
        this.velocity *= 0.92;
      }
      const sway = a && !this.dragging ? Math.sin(t * 0.35) * 0.08 : 0;
      this.yaw += sway;
      this.applyScene();

      const breath = a ? Math.sin(t * 1.7) * 0.22 : 0;
      this.upper.style.transform = `translateY(${breath * this.S}px)`;

      // Head: an idle glance around, or towards the cursor while it's near.
      let headYaw = a ? Math.sin(t * 0.47) * 16 + Math.sin(t * 1.21) * 5 : 0;
      let headPitch = a ? Math.sin(t * 0.73) * 5 - 2 : 0;
      if (a && this.lookTarget && !this.dragging) {
        headYaw = Math.max(-45, Math.min(45, this.lookTarget.x * 40));
        headPitch = Math.max(-25, Math.min(25, this.lookTarget.y * 22));
      }
      this.headYaw = this.headYaw === undefined ? headYaw : this.headYaw + (headYaw - this.headYaw) * 0.08;
      this.headPitch = this.headPitch === undefined ? headPitch : this.headPitch + (headPitch - this.headPitch) * 0.08;
      this.setPose("head", -this.headPitch, this.headYaw, 0);

      const swing = a ? Math.sin(t * 1.25) : 0;
      let rArmX = swing * 6;
      let rArmZ = 4 + (a ? Math.sin(t * 1.7) * 1.5 : 0);
      // Every 15-25 seconds: a short, small wave with the right arm.
      if (a) {
        if (!this.waveStart && now > this.nextWave) this.waveStart = now;
        if (this.waveStart) {
          const p = (now - this.waveStart) / 2600;
          if (p >= 1) {
            this.waveStart = null;
            this.nextWave = now + 15000 + Math.random() * 10000;
          } else {
            const lift = Math.sin(Math.min(1, p * 1.25) * Math.PI); // up then down
            rArmZ = 4 + lift * 128 + Math.sin(p * TAU * 3) * 14 * lift;
            rArmX = rArmX * (1 - lift);
          }
        }
      }
      this.setPose("armR", rArmX, 0, rArmZ);
      this.setPose("armL", -swing * 6, 0, -(4 + (a ? Math.sin(t * 1.7 + 1) * 1.5 : 0)));
      const shift = a ? Math.sin(t * 0.9) * 2 : 0;
      this.setPose("legR", -shift, 0, 0);
      this.setPose("legL", shift, 0, 0);
      this.setPose("body", 0, 0, 0);
      if (this.parts.cape) this.setPose("cape", 8 + (a ? Math.sin(t * 1.4) * 3 + Math.abs(this.velocity) * 20 : 0), 0, 0);
    }

    loop() {
      const tick = (now) => {
        this.frame = requestAnimationFrame(tick);
        // Nothing to draw while the page it's on is hidden.
        if (document.hidden || !this.container.isConnected || this.container.offsetParent === null) return;
        this.render(now);
      };
      this.frame = requestAnimationFrame(tick);
    }

    destroy() {
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = null;
      this.container.textContent = "";
    }
  }

  window.SkinViewer = SkinViewer;
})();
