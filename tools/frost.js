// The blue ("Frost") theme of Reminth, made from the orange ("Ember") one so the two always match (owner, 9 Oct 2026:
// "make a blue version and style for the app's icon and in settings you pick blue or orange").
//   node tools/frost.js        -> writes src/renderer/styles-frost.css and assets/icons/source/reminth-mark-frost.svg
// Every warm colour (reds, oranges, peach, warm greys and the warm charcoal backgrounds) gets the matching blue: the
// hue moves to cyan/sky (bright ones) or navy (the dark ones), saturation and lightness stay. Status colours keep their
// meaning (green, amber, the pink-red of errors), and lines with data-accent (the accent picker and per-accent colours)
// are copied as they are.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) return [l, l, l].map((v) => Math.round(v * 255));
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255));
}

/** The Frost colour for one Ember colour (r, g, b 0-255), or null when it stays as it is. */
function frost(r, g, b) {
  const [h, s, l] = rgbToHsl(r, g, b);
  const warm = s >= 0.05 && (h <= 40 || h >= 352 || (l < 0.26 && h >= 330));
  if (!warm) return null; // greys, white, black, green, amber, the pink-red, the cube's grey-violet faces
  if (l < 0.26) {
    // the dark warm charcoals -> the navy the launcher used to have
    return hslToRgb(222, Math.min(0.55, Math.max(s, 0.36)), l);
  }
  const hh = h >= 352 ? h - 360 : h; // -8..40
  return hslToRgb(192 + (hh - 12) * 1.2, s, l);
}

const hex2 = (n) => n.toString(16).padStart(2, "0");

/** Every #rrggbb and rgb(a)( r, g, b ...) in a text, made Frost. */
function frostText(text) {
  text = text.replace(/#([0-9a-fA-F]{6})\b/g, (m, h) => {
    const v = frost(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16));
    if (!v) return m;
    const out = "#" + v.map(hex2).join("");
    return h === h.toUpperCase() && /[A-F]/.test(h) ? out.toUpperCase() : out;
  });
  text = text.replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*([,)])/g, (m, r, g, b, end) => {
    const v = frost(Number(r), Number(g), Number(b));
    if (!v) return m;
    return m.slice(0, m.indexOf("(") + 1) + v.join(", ") + end;
  });
  return text;
}

function frostCss(css) {
  return css
    .split(/(\r?\n)/)
    .map((part) => (/data-accent/.test(part) ? part : frostText(part)))
    .join("");
}

function build() {
  const cssIn = path.join(ROOT, "src", "renderer", "styles.css");
  const cssOut = path.join(ROOT, "src", "renderer", "styles-frost.css");
  const head = "/* MADE BY tools/frost.js FROM styles.css - do not edit; edit styles.css and run: node tools/frost.js */\n";
  fs.writeFileSync(cssOut, head + frostCss(fs.readFileSync(cssIn, "utf8")));
  const svgIn = path.join(ROOT, "assets", "icons", "source", "reminth-mark.svg");
  const svgOut = path.join(ROOT, "assets", "icons", "source", "reminth-mark-frost.svg");
  fs.writeFileSync(svgOut, frostText(fs.readFileSync(svgIn, "utf8")));
  return { cssOut, svgOut };
}

module.exports = { frost, frostText, frostCss, build };

if (require.main === module) {
  const out = build();
  console.log("wrote", path.relative(ROOT, out.cssOut), "and", path.relative(ROOT, out.svgOut));
}
