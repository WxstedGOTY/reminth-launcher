// Reminth panel icons, batch 4 (10 Oct 2026): the Streamer category and batch 4 features. Same look as icons.js.
"use strict";

const SW = (w) => `fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const S = SW(7);
const F = 'fill="#fff"';
const T = (x, y, size, text, color = "#fff") =>
  `<text x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="${size}" text-anchor="middle" fill="${color}">${text}</text>`;
const screen = `<rect x="6" y="14" width="84" height="58" rx="7" ${S}/><path ${SW(6)} d="M34 86h28M48 72v14"/>`;

module.exports = {
  cat_stream: `<rect x="6" y="20" width="62" height="56" rx="9" ${S}/><path ${F} d="M68 40l22-12v40L68 56z"/><circle cx="24" cy="36" r="6" ${F}/>`,
  screentext: `${screen}${T(48, 54, 30, "Aa")}`,
  streamer: `<path ${S} d="M6 48s16-26 42-26 42 26 42 26-16 26-42 26S6 48 6 48z"/><path ${SW(8)} d="M30 40h36M30 56h36"/>`,
  live: `<rect x="4" y="26" width="88" height="44" rx="10" ${F}/><circle cx="20" cy="48" r="7" fill="#111"/>${T(58, 60, 28, "LIVE", "#111")}`,
  stopwatch: `<circle cx="48" cy="54" r="34" ${S}/><path ${SW(7)} d="M48 54V34M40 8h16M48 8v12M74 22l6-6"/>`,
  countdown: `<circle cx="48" cy="48" r="40" ${S}/>${T(48, 62, 40, "3")}`,
  kills: `<circle cx="48" cy="44" r="30" ${S}/><circle cx="36" cy="42" r="7" ${F}/><circle cx="60" cy="42" r="7" ${F}/><path ${SW(6)} d="M36 74v14M48 74v14M60 74v14"/>`,
  brb: `${screen}${T(48, 53, 24, "BRB")}`,
  facecam: `<path ${SW(8)} d="M8 30V10h20M68 10h20v20M88 66v20H68M28 86H8V66"/><circle cx="48" cy="40" r="12" ${F}/><path ${F} d="M26 74c0-14 10-22 22-22s22 8 22 22z"/>`,
  goal: `<path ${S} d="M20 88V10"/><path ${F} d="M24 12h56l-12 16 12 16H24z"/><rect x="8" y="80" width="80" height="10" rx="5" fill="#fff" opacity=".35"/>`,
  ticker: `<rect x="4" y="30" width="88" height="36" rx="6" ${S}/><path ${SW(6)} d="M18 48h28M58 48h22"/><path ${SW(5)} d="M84 22l8 8-8 8"/>`,
  socials: `<circle cx="22" cy="48" r="12" ${F}/><circle cx="74" cy="20" r="12" ${F}/><circle cx="74" cy="76" r="12" ${F}/><path ${SW(6)} d="M32 42l32-16M32 54l32 16"/>`,
  keyboard: `<rect x="4" y="22" width="88" height="52" rx="8" ${S}/><path ${SW(6)} d="M18 38h4M34 38h4M50 38h4M66 38h4M18 52h4M34 52h4M50 52h4M66 52h4M28 64h40"/>`,
  cinema: `<rect x="4" y="10" width="88" height="20" ${F}/><rect x="4" y="66" width="88" height="20" ${F}/><rect x="10" y="34" width="76" height="28" rx="3" fill="#fff" opacity=".35"/>`,
  grid: `<rect x="6" y="10" width="84" height="76" rx="6" ${S}/><path ${SW(4)} d="M34 10v76M62 10v76M6 36h84M6 60h84"/>`,
  border: `<rect x="8" y="12" width="80" height="72" rx="4" ${SW(10)}/>`,
  tps: `<path ${S} d="M10 70a38 38 0 1 1 76 0"/><path ${SW(7)} d="M48 70L68 36"/>${T(48, 94, 18, "TPS")}`,
  vspeed: `<path ${S} d="M30 10v76M18 26l12-16 12 16M18 70l12 16 12-16"/><path ${SW(6)} d="M58 30h28M58 48h20M58 66h28"/>`,
  distance: `<circle cx="18" cy="76" r="10" ${F}/><circle cx="78" cy="20" r="10" ${F}/><path ${SW(5)} d="M26 70C40 60 30 44 46 40s28-6 26-12" stroke-dasharray="2 10"/>`,
  sealevel: `<path ${S} d="M4 60c10-8 18-8 28 0s18 8 28 0 18-8 28 0"/><path ${SW(6)} d="M48 48V8M36 20l12-12 12 12"/>`,
  reach: `<circle cx="20" cy="48" r="12" ${F}/><path ${SW(6)} d="M38 48h46M74 38l10 10-10 10"/>`,
  entity: `<rect x="22" y="8" width="52" height="40" rx="4" ${F}/><rect x="32" y="20" width="10" height="10" fill="#111"/><rect x="54" y="20" width="10" height="10" fill="#111"/><path ${S} d="M30 56h36v32H30z"/>`,
  air: `<circle cx="30" cy="62" r="16" ${S}/><circle cx="62" cy="34" r="12" ${S}/><circle cx="72" cy="72" r="8" ${S}/>`,
  freeze: `<path ${SW(6)} d="M48 6v84M12 27l72 42M84 27L12 69"/><path ${SW(5)} d="M38 14l10 10 10-10M38 82l10-10 10 10"/>`,
  gamemode: `<path ${F} d="M48 8l36 20v40L48 88 12 68V28z" opacity=".35"/><path ${S} d="M48 8l36 20v40L48 88 12 68V28zM12 28l36 20 36-20M48 48v40"/>`,
  difficulty: `<path ${S} d="M48 8l38 76H10z"/><path ${SW(8)} d="M48 36v22"/><circle cx="48" cy="70" r="5" ${F}/>`,
  dimension: `<rect x="22" y="6" width="52" height="84" rx="4" ${S}/><path ${F} d="M32 16h32v64H32z" opacity=".5"/><path ${SW(5)} d="M40 30l16 18-16 18"/>`,
  accuracy: `<circle cx="48" cy="48" r="38" ${S}/><circle cx="48" cy="48" r="22" ${SW(6)}/><circle cx="48" cy="48" r="7" ${F}/>`,
  horse: `<path ${F} d="M22 88V58l-8-6 10-30 20-10 6 14 20 4 10 18-6 6-14-6-6 14v26h-8V64H30v24z"/>`,
  afk: `${T(48, 46, 30, "AFK")}<path ${SW(6)} d="M14 66h68"/>${T(48, 90, 18, "zzz")}`,
  itemcount: `<path ${S} d="M14 34l34-18 34 18v38L48 90 14 72z"/><path ${SW(5)} d="M14 34l34 18 34-18M48 52v38"/>${T(70, 30, 20, "x")}`,
  fpsgraph: `<path ${SW(6)} d="M8 86h80M8 10v76"/><path ${F} d="M18 60h8v24h-8zM32 40h8v44h-8zM46 52h8v32h-8zM60 24h8v60h-8zM74 46h8v38h-8z"/>`,
  pinggraph: `<path ${SW(6)} d="M8 86h80M8 10v76"/><path ${SW(6)} d="M14 66l14-10 14 6 14-30 14 18 14-12"/>`,
  pickup: `<path ${S} d="M14 40l34-18 34 18v36L48 92 14 76z"/><path ${SW(8)} d="M48 4v26M38 20l10 10 10-10"/>`,
  hotbarnum: `<rect x="4" y="34" width="88" height="30" rx="4" ${S}/><path ${SW(4)} d="M34 34v30M62 34v30"/>${T(19, 57, 18, "1")}${T(48, 57, 18, "2")}${T(77, 57, 18, "3")}`,
  lowhpglow: `<rect x="6" y="10" width="84" height="76" rx="8" ${SW(10)} opacity=".5"/><path ${F} d="M48 72L28 52a12 12 0 0 1 20-14 12 12 0 0 1 20 14z"/>`,
  damageflash: `<path ${F} d="M54 4L20 52h22l-8 40 40-52H50z"/>`,
  filter: `<circle cx="36" cy="40" r="26" ${S}/><circle cx="60" cy="40" r="26" ${S}/><circle cx="48" cy="62" r="26" ${S}/>`,
  skin: `<rect x="30" y="6" width="36" height="30" rx="4" ${F}/><path ${S} d="M26 42h44v26H26zM32 68v22M64 68v22M26 44L12 62M70 44l14 18"/>`,
};
