// Reminth panel icons, batch 3 (8 Oct 2026): features picked from the owner's ChatGPT list. Same look as icons.js.
"use strict";

const SW = (w) => `fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const S = SW(7);
const F = 'fill="#fff"';
const T = (x, y, size, text, color = "#fff") =>
  `<text x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="${size}" text-anchor="middle" fill="${color}">${text}</text>`;
const speaker = `<path ${F} d="M6 36h14l20-16v56L20 60H6z"/>`;
const sword = `<path ${SW(8)} d="M80 10L44 46"/><path ${SW(7)} d="M34 38l18 18"/><path ${SW(6)} d="M42 48L26 64"/>`;

module.exports = {
  attackcd: `${sword}<rect x="8" y="80" width="80" height="9" rx="4.5" fill="#fff" opacity=".3"/><rect x="8" y="80" width="56" height="9" rx="4.5" ${F}/>`,
  bowdraw: `<path ${S} d="M26 10c30 10 44 34 40 76"/><path ${SW(4)} d="M26 10L66 86"/><path ${SW(5)} d="M14 70L66 18M66 18H52M66 18v14"/>`,
  crossbow: `<path ${S} d="M12 30c18-14 54-14 72 0"/><path ${S} d="M48 22v66"/><path ${SW(4)} d="M14 30l34 24 34-24"/><circle cx="48" cy="54" r="6" ${F}/>`,
  shieldup: `<path ${S} d="M48 22l30 10v20c0 18-13 30-30 36-17-6-30-18-30-36V32z"/><path ${SW(6)} d="M48 6v14M40 12l8-8 8 8"/>`,
  offhand: `<rect x="50" y="30" width="38" height="38" rx="6" ${S}/><path ${F} d="M60 40h18v18H60z" opacity=".8"/><path ${S} d="M10 66c0-14 6-24 18-24h12M30 34l10 8-10 8"/>`,
  falldist: `<path ${S} d="M40 8v68M24 60l16 18 16-18"/><path ${SW(5)} d="M70 10v80M64 20h12M64 40h12M64 60h12M64 80h12"/>`,
  heldfood: `<path ${F} d="M48 26c-6-10-16-12-24-6-12 10-8 34 4 50 6 8 14 12 20 8 6 4 14 0 20-8 12-16 16-40 4-50-8-6-18-4-24 6z"/><path ${S} d="M48 26c0-8 4-14 12-18"/>`,
  righttool: `<path ${S} d="M16 26c20-14 44-14 64 0M48 20v56"/><path ${SW(7)} d="M56 78l10 10 20-24"/>`,
  lowesthp: `<path ${F} d="M48 80L18 50a17 17 0 0 1 30-24 17 17 0 0 1 30 24z" opacity=".55"/><path ${SW(6)} d="M8 70h80"/><path ${SW(5)} d="M48 56v26M40 74l8 8 8-8"/>`,
  alert: `<path ${F} d="M48 84L16 52a19 19 0 0 1 32-26 19 19 0 0 1 32 26z"/><path stroke="#111" stroke-width="8" stroke-linecap="round" d="M48 38v16"/><circle cx="48" cy="66" r="5" fill="#111"/>`,
  foodstock: `<path ${S} d="M14 46c0-16 14-26 34-26s34 10 34 26v26H14z"/><path ${SW(5)} d="M28 46v14M48 46v14M68 46v14"/>${T(48, 92, 20, "x12")}`,
  daynight: `<circle cx="34" cy="38" r="16" ${F}/><path ${SW(5)} d="M34 8v8M34 60v8M4 38h8M8 12l6 6M8 64l6-6"/><path ${F} d="M74 44a24 24 0 1 0 14 40 20 20 0 0 1-14-40z"/>`,
  bedcue: `<path ${S} d="M8 76V30M8 58h80v18M88 58V48a10 10 0 0 0-10-10H40v20"/><circle cx="24" cy="46" r="8" ${F}/>${T(70, 28, 20, "z")}`,
  nethercoords: `<rect x="22" y="8" width="52" height="80" rx="4" ${S}/><rect x="32" y="18" width="32" height="60" fill="#fff" opacity=".45"/><path ${SW(5)} d="M40 36l16 8-16 8 16 8"/>`,
  frametime: `<path ${SW(6)} d="M8 70h80"/><path ${SW(6)} d="M10 56l12-6 10 4 10-30 8 34 12-6 10 4 14-8"/>`,
  damagetaken: `<path ${F} d="M48 84L16 52a19 19 0 0 1 32-26 19 19 0 0 1 32 26z"/><path stroke="#111" stroke-width="8" stroke-linecap="round" d="M34 50h28"/>`,
  combo: `<path ${F} d="M48 6l9 22 24-6-14 20 18 16-24 2 2 24-15-18-15 18 2-24-24-2 18-16-14-20 24 6z"/>${T(48, 58, 22, "x3", "#111")}`,
  hitmarker: `<path ${SW(8)} d="M18 18l18 18M78 18L60 36M18 78l18-18M78 78L60 60"/><circle cx="48" cy="48" r="5" ${F}/>`,
  hidehud: `<path ${S} d="M6 48s16-26 42-26 42 26 42 26-16 26-42 26S6 48 6 48z"/><circle cx="48" cy="48" r="10" ${F}/><path ${SW(8)} d="M14 82L82 14"/>`,
  breakrem: `<path ${S} d="M14 40h56v20a24 24 0 0 1-24 24h-8a24 24 0 0 1-24-24z"/><path ${S} d="M70 46h6a10 10 0 0 1 0 20h-8"/><path ${SW(5)} d="M32 12c-4 6 4 10 0 18M48 12c-4 6 4 10 0 18"/>`,
  tooltipdur: `<rect x="6" y="14" width="84" height="64" rx="8" ${S}/><path ${SW(5)} d="M20 34h40"/><rect x="20" y="52" width="56" height="10" rx="5" fill="#fff" opacity=".3"/><rect x="20" y="52" width="36" height="10" rx="5" ${F}/>`,
  tooltipfood: `<rect x="6" y="14" width="84" height="64" rx="8" ${S}/><path ${SW(5)} d="M20 34h40"/><path ${F} d="M56 46c8 0 12 5 12 11 0 8-8 12-15 13l-9 9a5 5 0 1 1-6-3 5 5 0 1 1 3-6l9-9c1-9 2-15 6-15z"/>`,
  chattime: `<path ${S} d="M14 14h68a6 6 0 0 1 6 6v38a6 6 0 0 1-6 6H44L24 82V64H14a6 6 0 0 1-6-6V20a6 6 0 0 1 6-6z"/>${T(48, 48, 18, "12:30")}`,
  vol_master: `${speaker}<path ${S} d="M54 34a18 18 0 0 1 0 28M64 22a34 34 0 0 1 0 52M74 12a48 48 0 0 1 0 72"/>`,
  vol_music: `${speaker}<path ${SW(5)} d="M62 70V30l26-6v38"/><circle cx="56" cy="72" r="7" ${F}/><circle cx="82" cy="64" r="7" ${F}/>`,
  vol_records: `${speaker}<circle cx="70" cy="48" r="22" ${SW(5)}/><circle cx="70" cy="48" r="6" ${F}/>`,
  vol_weather: `${speaker}<path ${SW(5)} d="M56 50a10 10 0 0 1 2-20 14 14 0 0 1 26 4 9 9 0 0 1-2 16z"/><path ${SW(5)} d="M60 62l-4 10M72 62l-4 10M84 62l-4 10"/>`,
  vol_blocks: `${speaker}<path ${SW(5)} d="M70 26l18 10v22L70 68 52 58V36z"/><path ${SW(4)} d="M52 36l18 10 18-10M70 46v22"/>`,
  vol_hostile: `${speaker}<rect x="52" y="26" width="38" height="44" rx="4" ${SW(5)}/><path ${F} d="M58 34h8v8h-8zM76 34h8v8h-8zM66 44h10v6h4v12h-4v-4H66v4h-4V50h4z"/>`,
  vol_neutral: `${speaker}<rect x="52" y="30" width="38" height="34" rx="6" ${SW(5)}/><circle cx="62" cy="42" r="3" ${F}/><circle cx="80" cy="42" r="3" ${F}/><rect x="63" y="50" width="16" height="10" rx="3" ${F}/>`,
  vol_players: `${speaker}<circle cx="72" cy="34" r="9" ${F}/><path ${F} d="M56 74c0-14 6-24 16-24s16 10 16 24z"/>`,
  vol_ambient: `${speaker}<path ${SW(5)} d="M52 40c6-6 12 6 18 0s12 6 18 0M52 56c6-6 12 6 18 0s12 6 18 0"/>`,
  vol_voice: `${speaker}<rect x="62" y="20" width="18" height="34" rx="9" ${F}/><path ${SW(5)} d="M54 46a17 17 0 0 0 34 0M71 64v12M62 78h18"/>`,
  brightness: `<circle cx="48" cy="48" r="16" ${S}/><path ${S} d="M48 8v10M48 78v10M8 48h10M78 48h10M20 20l7 7M69 69l7 7M20 76l7-7M69 27l7-7"/><path ${F} d="M48 32a16 16 0 0 1 0 32z"/>`,
  guiscale: `<rect x="8" y="16" width="80" height="64" rx="8" ${S}/><path ${SW(5)} d="M28 64l40-32M28 64h14M28 64V50M68 32H54M68 32v14"/>`,
};
