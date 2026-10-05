"use strict";
/**
 * The description renderer (src/renderer/markdown.js): Markdown + the inline
 * HTML Modrinth descriptions use, the address rules (links https only,
 * images only from Modrinth's CDN), and what hostile input turns into.
 * The DOM half runs against a tiny fake document whose elements refuse
 * innerHTML/outerHTML/insertAdjacentHTML, so building with anything but
 * createElement/textContent fails the test.
 * Run with: node --test test/markdown.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const md = require("../src/renderer/markdown");

/* ---------------- a tiny fake DOM ---------------- */

class FakeNode {
  constructor(tag, text) {
    this.tagName = tag;
    this.childNodes = [];
    this.attrs = {};
    this.listeners = {};
    this._text = text === undefined ? null : String(text);
    this.className = "";
    const self = this;
    this.classList = { add: (c) => (self.className = (self.className + " " + c).trim()), contains: (c) => self.className.split(/\s+/).includes(c) };
  }
  appendChild(n) {
    this.childNodes.push(n);
    return n;
  }
  set textContent(v) {
    this.childNodes = [];
    this._text = String(v);
  }
  get textContent() {
    return (this._text || "") + this.childNodes.map((c) => c.textContent).join("");
  }
  setAttribute(k, v) {
    if (/^on/i.test(k) || k === "style") throw new Error("event/style attribute set: " + k);
    this.attrs[k] = String(v);
  }
  addEventListener(type, fn) {
    this.listeners[type] = fn;
  }
  set innerHTML(_v) {
    throw new Error("innerHTML used");
  }
  set outerHTML(_v) {
    throw new Error("outerHTML used");
  }
  insertAdjacentHTML() {
    throw new Error("insertAdjacentHTML used");
  }
  /** Every element below this one (and itself), in order. */
  all() {
    return [this, ...this.childNodes.flatMap((c) => (c.all ? c.all() : []))];
  }
}
for (const prop of ["href", "src", "alt", "title", "rel", "decoding", "width", "height", "start"]) {
  Object.defineProperty(FakeNode.prototype, prop, {
    get() {
      return this.attrs[prop];
    },
    set(v) {
      this.attrs[prop] = String(v);
    },
  });
}
const fakeDoc = {
  createElement: (tag) => new FakeNode(String(tag).toLowerCase()),
  createTextNode: (text) => new FakeNode("#text", text),
};
const dom = (text, options = {}) => md.toDom(md.parse(text), { doc: fakeDoc, ...options });
const tags = (root) => root.all().map((n) => n.tagName);
const find = (root, tag) => root.all().filter((n) => n.tagName === tag);

/** Flattens a tree into a list of nodes, for "does it contain" checks. */
function flat(node) {
  const out = [node];
  for (const k of ["c", "summary"]) for (const x of node[k] || []) out.push(...flat(x));
  for (const it of node.items || []) for (const x of it.c) out.push(...flat(x));
  for (const row of [node.head || [], ...(node.rows || [])]) for (const cell of row) for (const x of cell) out.push(...flat(x));
  return out;
}
const nodesOf = (text) => flat(md.parse(text));
const allText = (text) => nodesOf(text).filter((n) => n.t === "text").map((n) => n.v).join("");

/* ---------------- syntax ---------------- */

test("headings, paragraphs, emphasis, strike, code", () => {
  const t = md.parse("# One\n## Two\n\nPlain **bold** *it* ***both*** ~~gone~~ `x < y`\nsame paragraph");
  assert.deepEqual(t.c.map((n) => [n.t, n.level]), [["h", 1], ["h", 2], ["p", undefined]]);
  const p = t.c[2].c;
  assert.deepEqual(p.map((n) => n.t), ["text", "b", "text", "i", "text", "b", "text", "s", "text", "code", "text"]);
  assert.equal(p[5].c[0].t, "i", "***x*** is bold italic");
  assert.equal(p[9].v, "x < y");
  assert.equal(p[10].v, " same paragraph", "a single newline is a space");
  assert.equal(md.parse("Title\n=====\n\nSub\n---").c.map((n) => `${n.t}${n.level}`).join(), "h1,h2");
  assert.equal(allText("snake_case_name stays"), "snake_case_name stays");
});

test("fenced code keeps its text as-is (no Markdown or HTML inside)", () => {
  const t = md.parse("```js\nconst a = '<b>**x**</b>';\n```\nafter");
  assert.deepEqual(t.c[0], { t: "pre", lang: "js", v: "const a = '<b>**x**</b>';" });
  assert.equal(t.c[1].t, "p");
  assert.equal(md.parse("~~~\nunclosed").c[0].v, "unclosed", "an unclosed fence runs to the end");
});

test("block quotes, lists, nested lists, ordered start, task lists", () => {
  const t = md.parse("> quoted **text**\n> more\n\n3. three\n4. four\n\n- a\n- b\n    - b1\n    - b2\n- [ ] todo\n- [x] done");
  assert.equal(t.c[0].t, "quote");
  assert.equal(t.c[1].t, "ol");
  assert.equal(t.c[1].start, 3);
  const ul = t.c[2];
  assert.equal(ul.items.length, 4);
  assert.equal(ul.items[1].c[1].t, "ul", "nested list inside item b");
  assert.equal(ul.items[1].c[1].items.length, 2);
  assert.deepEqual(ul.items.map((i) => i.task), [null, null, false, true]);
});

test("tables with alignment; pipes in code don't split cells", () => {
  const t = md.parse("| Mod | Works |\n|:----|:----:|\n| `a|b` | yes |\n| c | **no** |");
  const tb = t.c[0];
  assert.equal(tb.t, "table");
  assert.deepEqual(tb.align, ["left", "center"]);
  assert.equal(tb.rows.length, 2);
  assert.equal(tb.rows[0][0][0].v, "a|b");
  assert.equal(tb.rows[1][1][0].t, "b");
});

test("horizontal rules, line breaks, autolinks and bare https addresses", () => {
  const t = md.parse("a  \nb\\\nc\n\n---\n\nsee <https://modrinth.com> or https://github.com/x/y.");
  assert.deepEqual(t.c[0].c.map((n) => n.t), ["text", "br", "text", "br", "text"]);
  assert.equal(t.c[1].t, "hr");
  const links = flat(t.c[2]).filter((n) => n.t === "a");
  assert.deepEqual(links.map((l) => l.href), ["https://modrinth.com/", "https://github.com/x/y"]);
});

test("Modrinth's inline HTML: centred paragraphs, details/summary, h tags, b/i/kbd/code/br/a/img, HTML tables and lists", () => {
  const t = md.parse(
    [
      '<p align="center"><img src="https://cdn.modrinth.com/data/x/logo.png" alt="Logo" width="400"></p>',
      "<h2>Features</h2>",
      "<details>",
      "<summary>Click <b>me</b></summary>",
      "",
      "- hidden item",
      "</details>",
      "Press <kbd>F3</kbd> + <code>B</code>, <i>then</i><br>wait. <a href=\"https://modrinth.com/mod/sodium\">Sodium</a>",
      "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>",
      "<ul><li>one</li><li>two</li></ul>",
    ].join("\n")
  );
  assert.deepEqual(t.c.map((n) => n.t), ["center", "h", "details", "p", "table", "ul"]);
  const img = flat(t.c[0]).find((n) => n.t === "img");
  assert.deepEqual([img.src, img.alt, img.width], ["https://cdn.modrinth.com/data/x/logo.png", "Logo", 400]);
  assert.equal(t.c[1].level, 2);
  assert.equal(t.c[2].summary[1].t, "b");
  assert.equal(t.c[2].c[0].t, "ul");
  assert.deepEqual(t.c[3].c.filter((n) => n.t !== "text").map((n) => n.t), ["kbd", "code", "i", "br", "a"]);
  assert.deepEqual(t.c[4].head.map((c) => c[0].v), ["A", "B"]);
  assert.equal(t.c[4].rows.length, 1);
  assert.equal(t.c[5].items.length, 2);
});

test("entities are decoded into text (and only ever into text)", () => {
  assert.equal(allText("Tom &amp; Jerry &copy; &#169; &#x41; &lt;b&gt;"), "Tom & Jerry © © A <b>");
  assert.equal(allText("&bogus; &#0; &#xD800;"), "&bogus; &#0; &#xD800;");
});

/* ---------------- address rules ---------------- */

test("safeLink: https only, no credentials, no protocol-relative, relative paths go to modrinth.com", () => {
  assert.equal(md.safeLink("https://modrinth.com/mod/sodium"), "https://modrinth.com/mod/sodium");
  assert.equal(md.safeLink("/mod/sodium"), "https://modrinth.com/mod/sodium");
  for (const bad of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///C:/Windows/system.ini",
    "http://example.com",
    "mailto:a@b.c",
    "//evil.example/x",
    "https://user:pass@evil.example/",
    "https://user@evil.example/",
    "https:///nohost",
    "https:\\\\evil.example",
    "https://evil.example\\@modrinth.com",
    "https://exa mple.com",
    "https://e.com/\u0000",
    "https://e.com/" + "a".repeat(3000),
    "",
    null,
    42,
  ]) {
    assert.equal(md.safeLink(bad), null, String(bad));
  }
});

test("imageAllowed: only Modrinth's CDN and the avatar host", () => {
  assert.equal(md.imageAllowed("https://cdn.modrinth.com/data/a/b.png"), "https://cdn.modrinth.com/data/a/b.png");
  assert.equal(md.imageAllowed("https://avatars.githubusercontent.com/u/1"), "https://avatars.githubusercontent.com/u/1");
  for (const bad of ["https://i.imgur.com/a.png", "https://cdn.modrinth.com.evil.example/a.png", "https://evil.example/cdn.modrinth.com/a.png", "http://cdn.modrinth.com/a.png", "https://cdn.modrinth.com:8443/a.png", "data:image/png;base64,AAAA", "https://user@cdn.modrinth.com/a.png", "//cdn.modrinth.com/a.png", "/a.png"]) {
    assert.equal(md.imageAllowed(bad), null, bad);
  }
});

test("link text that reads like another address shows the real host", () => {
  const a = nodesOf("[modrinth.com](https://evil.example/login)").find((n) => n.t === "a");
  assert.equal(a.realHost, "evil.example");
  const ok = nodesOf("[www.modrinth.com/mod/x](https://modrinth.com/mod/x)").find((n) => n.t === "a");
  assert.equal(ok.realHost, null);
  assert.equal(nodesOf("[Download here](https://evil.example)").find((n) => n.t === "a").realHost, null, "plain words are not an address");
  const el = dom("[modrinth.com](https://evil.example/login)");
  assert.match(el.textContent, /modrinth\.com \(evil\.example\)/);
});

/* ---------------- hostile input ---------------- */

test("script, style, iframe, object, embed, svg tags are shown as text, never as elements", () => {
  const src = "<script>alert(1)</script>\n<style>body{display:none}</style>\n<iframe src=\"https://evil.example\"></iframe>\n<object data=\"x.swf\"></object><embed src=\"x\"><svg onload=alert(1)></svg>";
  const nodes = nodesOf(src);
  assert.ok(!nodes.some((n) => !["doc", "p", "text", "group", "center"].includes(n.t)), JSON.stringify([...new Set(nodes.map((n) => n.t))]));
  const text = allText(src);
  for (const piece of ["<script>", "alert(1)", "<style>", "<iframe", "<object", "<embed", "<svg"]) assert.ok(text.includes(piece), piece);
  const el = dom(src);
  for (const bad of ["script", "style", "iframe", "object", "embed", "svg"]) assert.equal(find(el, bad).length, 0, bad);
});

test("event and style attributes never survive (onerror, onclick, style)", () => {
  const src = '<img src="https://cdn.modrinth.com/a.png" onerror="alert(1)" style="position:fixed" alt="x"> <a href="https://modrinth.com" onclick="alert(1)" style="color:red">hi</a> <b onmouseover="x()">b</b>';
  const nodes = nodesOf(src);
  for (const n of nodes) for (const k of Object.keys(n)) assert.ok(!/^on|^style$/i.test(k), k);
  const el = dom(src); // the fake DOM throws if an on*/style attribute is ever set
  for (const n of el.all()) for (const k of Object.keys(n.attrs)) assert.ok(!/^on|^style$/i.test(k), k);
  assert.equal(find(el, "img")[0].src, "https://cdn.modrinth.com/a.png");
});

test("javascript:, data:, file:, protocol-relative and credential links are not links", () => {
  for (const href of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "//evil.example", "https://a:b@evil.example"]) {
    for (const src of [`[click](${href})`, `<a href="${href}">click</a>`]) {
      const a = nodesOf(src).find((n) => n.t === "a");
      assert.equal(a.href, null, src);
      const el = dom(src);
      assert.equal(find(el, "a").length, 0, src);
      assert.equal(el.textContent, "click");
    }
  }
});

test("images from anywhere else are not loaded - a placeholder with a link instead", () => {
  const src = "![shot](https://i.imgur.com/x.png) <img src=\"http://cdn.modrinth.com/y.png\" alt=\"y\"> ![d](data:image/png;base64,AAAA)";
  const nodes = nodesOf(src);
  assert.equal(nodes.filter((n) => n.t === "img").length, 0);
  const blocked = nodes.filter((n) => n.t === "imgblocked");
  assert.deepEqual(blocked.map((b) => [b.alt, b.link]), [["shot", "https://i.imgur.com/x.png"], ["y", null], ["d", null]]);
  const el = dom(src);
  assert.equal(find(el, "img").length, 0);
  assert.match(el.textContent, /Image hosted elsewhere/);
  assert.equal(find(el, "a")[0].href, "https://i.imgur.com/x.png");
});

test("YouTube embeds become a link card, never a player", () => {
  const nodes = nodesOf('<iframe width="560" src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>');
  const v = nodes.find((n) => n.t === "video");
  assert.equal(v.url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  const el = dom('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>');
  assert.equal(find(el, "iframe").length, 0);
  assert.match(el.textContent, /Video/);
  assert.match(el.textContent, /Opens in your browser/);
});

test("unclosed tags don't swallow the page or throw", () => {
  const t = md.parse("<details>\n<summary>Open\n\nsome text\n\n<b>bold never closed\n\n# Heading");
  assert.equal(t.c[0].t, "details");
  assert.ok(allText("<b>bold never closed and <i>more").includes("bold never closed"));
  assert.ok(nodesOf("<p align=center>no end\n\nnext").length > 2);
  dom("<div><p><b><i>nothing closes");
});

test("a huge nested list is capped in depth, and still shown as text", () => {
  let src = "";
  for (let i = 0; i < 400; i++) src += " ".repeat(i * 2) + "- level " + i + "\n";
  const t = md.parse(src);
  const depthOf = (node, d = 0) => Math.max(d, ...(node.items || []).flatMap((it) => it.c.map((c) => depthOf(c, d + 1))), ...(node.c || []).map((c) => depthOf(c, d)));
  assert.ok(depthOf(t) <= 10, "nesting stays shallow");
  dom(src);
  let quotes = "";
  for (let i = 0; i < 300; i++) quotes += ">";
  dom(quotes + " deep");
});

test("a 5 MB body is cut at 200 KB with a 'Read the rest' note, quickly", () => {
  const para = "Lorem **ipsum** dolor [sit](https://modrinth.com) amet, ![x](https://cdn.modrinth.com/a.png) consectetur.\n\n";
  const big = para.repeat(Math.ceil((5 * 1024 * 1024) / para.length));
  const started = process.hrtime.bigint();
  const t = md.parse(big);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.equal(t.truncated, true);
  assert.equal(t.c[t.c.length - 1].t, "cut");
  assert.ok(ms < 1500, `parse took ${ms} ms`);
  const el = md.toDom(t, { doc: fakeDoc, fullUrl: "https://modrinth.com/mod/x" });
  assert.match(el.textContent, /Read the rest online/);
});

test("huge tables are capped", () => {
  const head = "|" + Array.from({ length: 60 }, (_, i) => ` c${i} `).join("|") + "|\n";
  const sep = "|" + Array.from({ length: 60 }, () => "---").join("|") + "|\n";
  const rows = Array.from({ length: 900 }, (_, r) => "|" + Array.from({ length: 60 }, () => ` ${r} `).join("|") + "|").join("\n");
  const tb = md.parse(head + sep + rows).c[0];
  assert.equal(tb.head.length, 20);
  assert.equal(tb.rows.length, 200);
});

/* ---------------- DOM ---------------- */

test("toDom: elements only, links call onLink with the checked address", () => {
  const opened = [];
  const el = dom("Hi [Sodium](https://modrinth.com/mod/sodium) ![l](https://cdn.modrinth.com/l.png)\n\n| a |\n|---|\n| b |\n\n- [x] done\n\n<details><summary>S</summary>\n\nin\n</details>", { onLink: (h) => opened.push(h) });
  assert.deepEqual([...new Set(tags(el))].sort(), ["#text", "a", "details", "div", "img", "li", "p", "span", "summary", "table", "tbody", "td", "th", "thead", "tr", "ul"].sort());
  const a = find(el, "a")[0];
  assert.equal(a.title, "https://modrinth.com/mod/sodium", "the real address shows on hover");
  let prevented = false;
  a.listeners.click({ preventDefault: () => (prevented = true) });
  assert.equal(prevented, true, "the page itself never navigates");
  assert.deepEqual(opened, ["https://modrinth.com/mod/sodium"]);
  const img = find(el, "img")[0];
  assert.equal(img.attrs.loading, "lazy");
  assert.equal(img.alt, "l");
});

test("toDom: headings sit one level below the page's own", () => {
  const el = dom("# Big\n###### Small");
  assert.deepEqual(find(el, "h2").length + find(el, "h6").length, 2);
});

test("hostile text built to be slow (lone * _ ~ [ ` <, endless lines) finishes within the time budget", () => {
  for (const [name, text] of [
    ["stars", "*a ".repeat(65000)],
    ["underscores", "_a ".repeat(65000)],
    ["tildes", "~~a ".repeat(50000)],
    ["brackets", "[a ".repeat(65000)],
    ["ticks", "`a ".repeat(65000)],
    ["tags", "<b>".repeat(65000)],
    ["lines", "a\n".repeat(100000)],
    ["quotes", "> a\n".repeat(50000)],
  ]) {
    const started = process.hrtime.bigint();
    const t = md.parse(text);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(ms < 600, `${name}: ${ms} ms`); // budget is 120 ms; slack for a slow test machine
    assert.ok(Array.isArray(t.c), name);
  }
});
