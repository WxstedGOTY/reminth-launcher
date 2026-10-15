"use strict";
/**
 * The Night look (styles-night.css) is made by tools/night.js from styles.css + night-extra.css. If someone edits
 * either and forgets to run it, the looks drift apart - this fails then. Also: the Night colour rule, the pieces the
 * Night look needs (the icon, the window icon, the theme in the renderer), and the Night home page's markup.
 * Run with: node --test test/theme-night.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const night = require("../tools/night");

const ROOT = path.join(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

test("styles-night.css is styles.css made Night plus night-extra.css (run: node tools/night.js)", () => {
  const made = night.nightCss(read("src", "renderer", "styles.css"), read("src", "renderer", "night-extra.css"));
  const file = read("src", "renderer", "styles-night.css");
  assert.ok(file.startsWith(night.HEAD), "has the do-not-edit line");
  assert.equal(file.slice(night.HEAD.length), made);
});

test("night: brand orange and the old blues/violets go grey; status colours, greys and Discord stay", () => {
  const hex = (c) => {
    const n = parseInt(c.slice(1), 16);
    const v = night.night(n >> 16, (n >> 8) & 255, n & 255);
    return v && "#" + v.map((x) => x.toString(16).padStart(2, "0")).join("");
  };
  for (const grey of ["#ff4a1c", "#ff7445", "#0c0909", "#22d3ee", "#818cf8", "#a78bfa"]) {
    const [r, g, b] = night.night(...[1, 3, 5].map((i) => parseInt(grey.slice(i, i + 2), 16)));
    assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 18 && b >= r, `${grey} becomes a grey (with the faintest cool tint)`);
  }
  for (const keep of ["#fbbf24", "#ff5c8a", "#34d399", "#ffffff", "#000000", "#2a2a2a"]) assert.equal(hex(keep), null, keep);
  const css = night.nightCss(".a { color: #ff4a1c; }\n.rm-discord { background: #5865f2; }\n.t { --tc: #7fc8ff; } /* keep-colour */\n", "");
  assert.ok(!css.includes("#ff4a1c"), "the orange is gone");
  assert.ok(css.includes("#5865f2"), "Discord keeps its blurple");
  assert.ok(css.includes("#7fc8ff"), "keep-colour lines are copied as they are");
});

test("the Night pieces exist: icon, mark, window icon, packaged icon", () => {
  for (const f of ["assets/icons/reminth-night.ico", "assets/icons/source/reminth-mark-night.svg", "design/icon/reminth-moonrise-master.svg", "design/home-night.png"]) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), f);
  }
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.build.win.icon, "assets/icons/reminth-night.ico", "the .exe uses the Moonrise icon");
  assert.equal(pkg.build.nsis.installerIcon, "assets/icons/reminth-night.ico");
  const main = read("src", "main", "main.js");
  assert.match(main, /reminth-night\.ico/, "the window icon in the Night look");
  const renderer = read("src", "renderer", "renderer.js");
  assert.match(renderer, /night: \["styles-night\.css", "reminth-mark-night\.svg"\]/);
  const html = read("src", "renderer", "index.html");
  assert.match(html, /href="styles-night\.css" id="themeCss"/, "the page starts in the Night look (no flash of another look)");
  // Black is Reminth's look, not changeable for now (owner, 15 Oct 2026): no theme or accent pickers anywhere, Night forced.
  assert.ok(!/data-theme=|class="theme-pick|id="accentPicker"/.test(html), "no Blue/Orange/accent pickers on the page");
  assert.match(renderer, /applyTheme\("night"\);\s*applyAccent\("night"\);/, "the page always starts in Night");
  assert.match(main, /const LOOK = "night";/, "the window icon is always the Night one");
});

test("the Night home page has everything the code paints", () => {
  const html = read("src", "renderer", "index.html");
  const ids = ["homeMain", "playBtn", "stopBtn", "heroPick", "heroLoader", "heroVersion", "heroInstance", "heroMeta", "heroLast", "heroPlaytime", "heroLede", "heroSyncBtn", "heroInstanceBtn",
    "progressWrap", "progressStage", "progressPct", "progressFill", "progressDismiss", "log", "statPlayerKills", "statDeaths", "statDeathsRow", "statMobKills", "statBroken", "statPlaced",
    "nhTierList", "nhTiersNote", "quickJoin", "nhQuickWrap", "nhVersion", "nhNews", "livePill"];
  for (const id of ids) assert.equal((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1, `#${id} exactly once`);
  // the old Home's pieces are gone and no code still reaches for them
  const code = read("src", "renderer", "renderer.js") + read("src", "renderer", "features.js");
  for (const gone of ["heroGreeting", "recentGrid", "recentNote", "statDeathsNote"]) {
    assert.ok(!html.includes(`id="${gone}"`), `#${gone} is gone`);
    assert.ok(!code.includes(`$("${gone}")`), `nothing uses #${gone}`);
  }
  assert.match(code, /if \(!grid\) return; \/\/ Home's Discover mods row/, "Discover's home row is skipped, not crashed on");
  // no fake friends: the card says it's coming
  assert.match(html, /Friends aren't in Reminth yet\./);
});
