"use strict";
/*
 * The homepage's fades (owner, 22 Oct 2026: "while you go more down, fade, mid speed"):
 *  - the text in the big picture fades out and drifts up a little as you scroll down past it (follows the scroll);
 *  - every .fade block below fades in (0.6 s, home.css) when it comes into view.
 * Nothing moves for people who asked their system for less motion.
 */
(function () {
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const heroIn = document.getElementById("heroIn");
  const hero = document.getElementById("hero");
  if (heroIn && hero && !reduce) {
    let ticking = false;
    const paint = () => {
      ticking = false;
      const h = hero.offsetHeight || 1;
      const p = Math.max(0, Math.min(1, window.scrollY / (h * 0.55)));
      heroIn.style.opacity = String(1 - p);
      heroIn.style.transform = `translateY(${-p * 40}px)`;
    };
    window.addEventListener("scroll", () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(paint);
      }
    }, { passive: true });
    paint();
  }
  // the menu's Socials list: opens on hover (home.css) and also on click/tap; a click elsewhere or Esc closes it
  const drop = document.getElementById("navSocials");
  if (drop) {
    const btn = drop.querySelector(".nav-drop-btn");
    const set = (open) => {
      drop.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", String(open));
    };
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      set(!drop.classList.contains("open"));
    });
    document.addEventListener("click", (e) => { if (!drop.contains(e.target)) set(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") set(false); });
  }
  const blocks = document.querySelectorAll(".fade");
  if (reduce || !("IntersectionObserver" in window)) {
    blocks.forEach((b) => b.classList.add("in"));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) {
      e.target.classList.add("in");
      io.unobserve(e.target);
    }
  }, { threshold: 0.15 });
  blocks.forEach((b) => io.observe(b));
})();
