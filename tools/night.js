// The Night theme of Reminth (owner, 14 Oct 2026: "this is my new icon and logo generally for the whole app ... design
// the whole app again ... following the home screen type/color/vibe"; the design is design/home-night.png and the
// icon design/icon/). Made from the orange ("Ember") stylesheet so all three looks keep the same layout:
//   node tools/night.js   -> writes src/renderer/styles-night.css
// 1. Every colour of styles.css that isn't a status colour (the orange brand, the warm charcoals, the blues and
//    violets) becomes a neutral grey of the same lightness. Status colours keep their meaning (green, amber, the
//    pink-red of errors); lines with data-accent (the accent picker and per-accent colours), "discord" (its blurple)
//    or a keep-colour comment (the PvP tier colours) are copied as they are.
// 2. src/renderer/night-extra.css (the Night look itself: near-black, cream buttons, pixel headings, the night sky
//    behind every page, no sidebar) is added at the end, so it wins over what it changes.
"use strict";
const fs = require("fs");
const path = require("path");
const { rgbToHsl, hslToRgb } = require("./frost");

const ROOT = path.join(__dirname, "..");

/**
 * The Night colour for one Ember colour (r, g, b 0-255), or null when it stays as it is. Night is black and white:
 * warm colours (the orange brand) and cool ones (the blues and violets the old looks used for tags, links and
 * highlights) both become grey. Only the status colours keep their colour: amber/yellow and green (hue 41-169) and the
 * pink-red of errors (330-351).
 */
function night(r, g, b) {
  const [h, s, l] = rgbToHsl(r, g, b);
  const status = (h > 40 && h < 170) || (h >= 330 && h < 352 && l >= 0.26);
  if (s < 0.05 || status) return null;
  // a grey with the faintest cool tint, the same lightness (the icon's greys are #45464E-like)
  return hslToRgb(235, Math.min(0.07, s * 0.1 + 0.03), l);
}

const hex2 = (n) => n.toString(16).padStart(2, "0");

function nightText(text) {
  text = text.replace(/#([0-9a-fA-F]{6})\b/g, (m, h) => {
    const v = night(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16));
    if (!v) return m;
    const out = "#" + v.map(hex2).join("");
    return h === h.toUpperCase() && /[A-F]/.test(h) ? out.toUpperCase() : out;
  });
  text = text.replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*([,)])/g, (m, r, g, b, end) => {
    const v = night(Number(r), Number(g), Number(b));
    if (!v) return m;
    return m.slice(0, m.indexOf("(") + 1) + v.join(", ") + end;
  });
  return text;
}

function nightCss(css, extra) {
  const body = css
    .split(/(\r?\n)/)
    // Discord's own blurple stays (its buttons and cards say "discord" in the selector), so do lines marked keep-colour.
    .map((part) => (/data-accent|discord|keep-colour/i.test(part) ? part : nightText(part)))
    .join("");
  return body + "\n/* ===== night-extra.css ===== */\n" + extra;
}

const HEAD = "/* MADE BY tools/night.js FROM styles.css + night-extra.css - do not edit; edit those and run: node tools/night.js */\n";

function build() {
  const dir = path.join(ROOT, "src", "renderer");
  const out = path.join(dir, "styles-night.css");
  const css = fs.readFileSync(path.join(dir, "styles.css"), "utf8").replace(/\r\n/g, "\n");
  const extra = fs.readFileSync(path.join(dir, "night-extra.css"), "utf8").replace(/\r\n/g, "\n");
  fs.writeFileSync(out, HEAD + nightCss(css, extra));
  return { out };
}

module.exports = { night, nightText, nightCss, build, HEAD };

if (require.main === module) {
  const { out } = build();
  console.log("wrote", path.relative(ROOT, out));
}
