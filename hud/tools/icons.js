// Reminth panel icons: drawn here as vectors (our own, simple white pictograms), rendered to 128x128 PNGs by
// render-icons.js (Chromium, anti-aliased). One look for all: white, 7 px rounded strokes on a 96x96 grid.
// Every icon shows what the feature does.
"use strict";

const SW = (w) => `fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const S = SW(7);
const F = 'fill="#fff"';
const T = (x, y, size, text, color = "#fff") =>
  `<text x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="${size}" text-anchor="middle" fill="${color}">${text}</text>`;

module.exports = {
  // ---- features ----
  fps: `<path ${S} d="M14 62a34 34 0 0 1 68 0"/><path ${S} d="M48 62l17-19"/><circle cx="48" cy="62" r="6" ${F}/>
    <path ${SW(5)} d="M22 44l5 4M48 28v6M74 44l-5 4"/>${T(48, 88, 20, "FPS")}`,
  ping: `<rect x="12" y="62" width="13" height="20" rx="3" ${F}/><rect x="31" y="48" width="13" height="34" rx="3" ${F}/>
    <rect x="50" y="32" width="13" height="50" rx="3" ${F}/><rect x="69" y="14" width="13" height="68" rx="3" ${F} opacity=".45"/>`,
  cps: `<rect x="28" y="22" width="40" height="62" rx="20" ${S}/><path ${S} d="M48 22v24M28 46h40"/>
    <path fill="#fff" d="M30 44V42a18 18 0 0 1 16-18v20z"/><path ${SW(5)} d="M16 18l-6-6M24 10l-2-7M10 26l-8-2"/>`,
  keystrokes: `<rect x="34" y="8" width="28" height="26" rx="6" ${SW(5)}/>${T(48, 28, 16, "W")}
    <rect x="4" y="42" width="27" height="26" rx="6" ${SW(5)}/>${T(17.5, 62, 16, "A")}
    <rect x="34.5" y="42" width="27" height="26" rx="6" ${F}/>${T(48, 62, 16, "S", "#111")}
    <rect x="65" y="42" width="27" height="26" rx="6" ${SW(5)}/>${T(78.5, 62, 16, "D")}
    <rect x="4" y="74" width="88" height="14" rx="5" ${SW(5)}/>`,
  coordinates: `<path ${S} d="M48 88s26-26 26-46a26 26 0 0 0-52 0c0 20 26 46 26 46z"/><circle cx="48" cy="42" r="9" ${F}/>`,
  clock: `<circle cx="48" cy="48" r="38" ${S}/><path ${S} d="M48 24v24l16 10"/>
    <circle cx="48" cy="48" r="4" ${F}/>`,
  armor: `<path ${S} d="M14 18h20l14 10 14-10h20l6 30H72v38H24V48H8z"/><path ${SW(5)} d="M48 28v58M34 58h28"/>`,
  durability: `<path ${SW(9)} d="M80 12L40 52"/><path ${SW(8)} d="M28 44l20 20"/><path ${SW(7)} d="M38 54L20 72"/><circle cx="16" cy="76" r="6" fill="#fff"/>
    <rect x="8" y="86" width="80" height="7" rx="3.5" fill="#fff" opacity=".3"/><rect x="8" y="86" width="50" height="7" rx="3.5" fill="#fff"/>`,
  potion: `<path ${S} d="M38 10h20M41 10v20L20 66a12 12 0 0 0 10 18h36a12 12 0 0 0 10-18L55 30V10"/>
    <path fill="#fff" d="M26 62h44l5 9a8 8 0 0 1-7 11H28a8 8 0 0 1-7-11z"/><circle cx="44" cy="50" r="4" ${F}/><circle cx="54" cy="42" r="3" ${F}/>`,
  totem: `<rect x="32" y="8" width="32" height="28" rx="5" ${S}/><rect x="39" y="18" width="6" height="7" ${F}/><rect x="51" y="18" width="6" height="7" ${F}/>
    <path ${S} d="M36 40h24v28H36zM36 46H14v12h22M60 46h22v12H60M40 68v18h16V68"/>`,
  hurtcam: `<rect x="14" y="30" width="58" height="44" rx="8" ${S}/><circle cx="43" cy="52" r="12" ${SW(6)}/>
    <path ${S} d="M28 30l5-9h20l5 9"/><path ${SW(5)} d="M80 34l8-4M82 52h10M80 70l8 4"/>`,
  lowfire: `<path fill="#fff" d="M38 88c-16 0-24-11-24-24 0-14 12-22 14-34 9 6 12 14 12 20 3-4 4-9 4-14 10 8 18 18 18 28 0 13-8 24-24 24z"/>
    <path ${S} d="M80 22v52M68 62l12 12 12-12"/>`,
  sprint: `<circle cx="60" cy="14" r="9" ${F}/><path ${S} d="M28 40l16-10 18 6 10 16M44 30l-6 28 18 10-4 22M38 58L20 74"/>
    <path ${SW(5)} d="M6 40h12M2 54h12"/>`,
  sneak: `<circle cx="38" cy="22" r="9" ${F}/><path ${S} d="M42 34l12 18-8 14 14 18M54 52l18-6M46 66H26l-6 18"/>
    <path ${SW(5)} d="M10 92h76"/>`,
  zoom: `<circle cx="40" cy="40" r="28" ${S}/><path ${S} d="M60 60l26 26M28 40h24M40 28v24"/>`,

  // ---- categories (left tabs) ----
  cat_all: `<rect x="10" y="10" width="32" height="32" rx="7" ${F}/><rect x="54" y="10" width="32" height="32" rx="7" ${F}/>
    <rect x="10" y="54" width="32" height="32" rx="7" ${F}/><rect x="54" y="54" width="32" height="32" rx="7" ${F}/>`,
  cat_hud: `<rect x="8" y="14" width="80" height="68" rx="9" ${S}/><rect x="18" y="24" width="22" height="12" rx="3" ${F}/>
    <rect x="58" y="24" width="20" height="8" rx="3" ${F}/><rect x="28" y="64" width="40" height="8" rx="3" ${F}/>`,
  cat_visual: `<path ${S} d="M6 48s16-28 42-28 42 28 42 28-16 28-42 28S6 48 6 48z"/><circle cx="48" cy="48" r="12" ${F}/>`,
  cat_mechanic: `<rect x="8" y="30" width="80" height="44" rx="22" ${S}/><path ${S} d="M28 44v16M20 52h16"/>
    <circle cx="64" cy="46" r="5" ${F}/><circle cx="74" cy="58" r="5" ${F}/>`,
  cat_chat: `<path ${S} d="M14 16h68a6 6 0 0 1 6 6v40a6 6 0 0 1-6 6H44L24 84V68H14a6 6 0 0 1-6-6V22a6 6 0 0 1 6-6z"/>
    <path ${SW(5)} d="M26 36h44M26 50h28"/>`,
  cat_utility: `<path ${S} d="M62 10a22 22 0 0 0-20 30L12 70l14 14 30-30a22 22 0 0 0 30-20l-14 8-12-12z"/>`,

  // ---- interface ----
  gear: `<circle cx="48" cy="48" r="26" fill="none" stroke="#fff" stroke-width="12"/><rect x="42" y="6" width="12" height="18" rx="3" fill="#fff" transform="rotate(0 48 48)"/><rect x="42" y="6" width="12" height="18" rx="3" fill="#fff" transform="rotate(45 48 48)"/><rect x="42" y="6" width="12" height="18" rx="3" fill="#fff" transform="rotate(90 48 48)"/><rect x="42" y="6" width="12" height="18" rx="3" fill="#fff" transform="rotate(135 48 48)"/><rect x="42" y="6" width="12" height="18" rx="3" fill="#fff" transform="rotate(180 48 48)"/><rect x="42" y="6" width="12" height="18" rx="3" fill="#fff" transform="rotate(225 48 48)"/><rect x="42" y="6" width="12" height="18" rx="3" fill="#fff" transform="rotate(270 48 48)"/><rect x="42" y="6" width="12" height="18" rx="3" fill="#fff" transform="rotate(315 48 48)"/><circle cx="48" cy="48" r="9" fill="none" stroke="#fff" stroke-width="6"/>`,
  search: `<circle cx="40" cy="40" r="26" ${S}/><path ${S} d="M60 60l26 26"/>`,
  pencil: `<path ${S} d="M62 14l20 20-48 48H14V62zM52 24l20 20"/>`,
  close: `<path ${SW(9)} d="M20 20l56 56M76 20L20 76"/>`,
  plus: `<path ${SW(9)} d="M48 16v64M16 48h64"/>`,
  profile: `<circle cx="48" cy="32" r="18" ${S}/><path ${S} d="M14 88c4-18 18-28 34-28s30 10 34 28"/>`,
  layout: `<rect x="8" y="8" width="34" height="26" rx="5" ${SW(5)}/><rect x="54" y="62" width="34" height="26" rx="5" ${SW(5)}/>
    <path ${SW(5)} d="M48 40v16M40 48h16M48 40l-5 5M48 40l5 5"/>`,
  logo: `<rect x="6" y="6" width="84" height="84" rx="20" fill="none" stroke="#fff" stroke-width="7"/>
    <path ${SW(9)} d="M34 72V26h18a12 12 0 0 1 0 24H34M50 50l14 22"/>`,
};
