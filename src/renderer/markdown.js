"use strict";
/**
 * Project descriptions from Modrinth: Markdown with some inline HTML,
 * written by whoever made the project - so treated as hostile.
 *
 * Two parts:
 *  - parse(text) -> a tree of plain objects. Pure: no DOM, no network, so it
 *    runs under `node --test` (test/markdown.test.js).
 *  - toDom(tree, options) -> DOM, built only with createElement and
 *    textContent. Never innerHTML / insertAdjacentHTML / outerHTML /
 *    DOMParser / document.write / eval, never an event attribute or a style
 *    attribute taken from the text.
 *
 * What is understood: headings, paragraphs, bold/italic/strike, inline code,
 * fenced code blocks, block quotes, ordered/unordered/nested lists, task
 * lists, tables, horizontal rules, links, images, line breaks,
 * <details>/<summary>, centred paragraphs, and the inline tags <b> <i>
 * <strong> <em> <code> <kbd> <s> <del> <u> <sup> <sub> <br> <img> <a>.
 * Every other tag is shown as its own text - never dropped silently, never
 * interpreted.
 *
 * Links: only https (relative "/..." links go to modrinth.com), no user name
 * or password in them, length capped. Images: only from cdn.modrinth.com and
 * the avatar host - loading a picture from anywhere else would tell that site
 * the player's IP address; those become a placeholder with a link. Video
 * embeds become a link card. Hostile sizes are capped: the text (200 KB),
 * nesting depth, list/table sizes and the total number of nodes.
 */
(function (root) {
  const MAX_TEXT = 200 * 1024;
  const MAX_DEPTH = 8;
  const MAX_NODES = 20000;
  // However the text is built, parsing stops after this long and the rest is
  // offered on Modrinth - one description can't hold anything up for longer.
  const TIME_BUDGET_MS = 120;
  const MAX_TABLE_ROWS = 200;
  const MAX_TABLE_COLS = 20;
  const MAX_LIST_ITEMS = 1000;
  const MAX_URL = 2048;
  const MAX_IMG_SIZE = 1600; // px, for width/height attributes
  const IMAGE_HOSTS = new Set(["cdn.modrinth.com", "avatars.githubusercontent.com"]);
  const MODRINTH = "https://modrinth.com";

  /* ---------------- address rules ---------------- */

  /**
   * A link that may be opened in the player's browser, as a normalised
   * string, or null. https only; "/path" means a page on modrinth.com; no
   * credentials; no protocol-relative "//host"; length capped.
   */
  function safeLink(raw) {
    if (typeof raw !== "string") return null;
    let s = raw.trim();
    if (!s || s.length > MAX_URL || /[\u0000-\u001f\u007f\s]/.test(s)) return null;
    if (s.startsWith("/") && !s.startsWith("//")) s = MODRINTH + s;
    // Exactly "https://" and then a host: the URL parser would quietly
    // "repair" https:///x or backslashes into some other address.
    if (!/^https:\/\/[^/\\]/i.test(s) || s.includes("\\")) return null;
    let u;
    try {
      u = new URL(s);
    } catch {
      return null;
    }
    if (u.protocol !== "https:" || !u.hostname || u.username || u.password) return null;
    return u.href.length > MAX_URL ? null : u.href;
  }

  /** An image address that may be loaded, or null: https and one of the allowed hosts only. */
  function imageAllowed(raw) {
    const href = safeLink(raw);
    if (!href) return null;
    const u = new URL(href);
    return IMAGE_HOSTS.has(u.hostname.toLowerCase()) && !u.port ? href : null;
  }

  /** "https://www.youtube.com/embed/ID" etc. -> a watch link, or null. */
  function videoLink(raw) {
    const href = safeLink(raw);
    if (!href) return null;
    const u = new URL(href);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const embed = /^\/embed\/([A-Za-z0-9_-]{6,20})/.exec(u.pathname);
    if ((host === "youtube.com" || host === "youtube-nocookie.com") && embed) return `https://www.youtube.com/watch?v=${embed[1]}`;
    if (host === "youtube.com" || host === "youtu.be" || host === "player.vimeo.com" || host === "vimeo.com") return href;
    return null;
  }

  const hostOf = (href) => {
    try {
      return new URL(href).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return null;
    }
  };

  /** Pure: link text that reads like an address but points somewhere else -> the real host, else null. */
  function mismatchedHost(text, href) {
    const t = String(text || "").trim();
    const m = /^(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/?#]\S*)?$/i.exec(t);
    if (!m) return null;
    const shown = m[1].toLowerCase().replace(/^www\./, "");
    const real = hostOf(href);
    return real && real !== shown ? real : null;
  }

  /* ---------------- HTML bits ---------------- */

  const KEEP_ATTRS = new Set(["src", "alt", "href", "title", "width", "height", "align", "open"]);

  /** Attributes of one tag, only the few that are ever used; never style or on*. */
  function parseAttrs(text) {
    const out = {};
    const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let m;
    let n = 0;
    while ((m = re.exec(text)) && n++ < 32) {
      const name = m[1].toLowerCase();
      if (!KEEP_ATTRS.has(name)) continue;
      const value = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : "";
      out[name] = decodeEntities(value).slice(0, MAX_URL);
    }
    return out;
  }

  const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", trade: "™", hellip: "…", mdash: "—", ndash: "–", laquo: "«", raquo: "»", bull: "•", middot: "·", rarr: "→", larr: "←", times: "×" };
  /** Text with &amp; &#169; &#xA9; etc. turned into characters. Only ever lands in textContent. */
  function decodeEntities(s) {
    return String(s).replace(/&(#\d{1,7}|#x[0-9a-fA-F]{1,6}|[a-zA-Z]{2,8});/g, (all, e) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) && code !== 0 ? String.fromCodePoint(code) : all;
      }
      return Object.prototype.hasOwnProperty.call(ENTITIES, e.toLowerCase()) ? ENTITIES[e.toLowerCase()] : all;
    });
  }

  const INLINE_TAGS = { b: "b", strong: "b", i: "i", em: "i", s: "s", del: "s", strike: "s", u: "u", sup: "sup", sub: "sub", kbd: "kbd", code: "code", mark: "span", span: "span", font: "span", small: "span", big: "span", ins: "span", abbr: "span", tt: "code" };
  const CONTAINER_TAGS = new Set(["details", "summary", "p", "div", "center", "blockquote", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "ul", "ol", "li", "pre", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "header", "footer", "figure", "figcaption", "picture"]);

  /* ---------------- the parser ---------------- */

  const now = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

  function parse(input, { budgetMs = TIME_BUDGET_MS } = {}) {
    const state = { nodes: 0, cut: false, deadline: now() + budgetMs, ticks: 0 };
    let text = String(input === undefined || input === null ? "" : input);
    let truncated = false;
    if (text.length > MAX_TEXT) {
      // Cut at a line end near the limit, so a fence or table isn't sliced mid-line.
      const at = text.lastIndexOf("\n", MAX_TEXT);
      text = text.slice(0, at > MAX_TEXT / 2 ? at : MAX_TEXT);
      truncated = true;
    }
    text = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
    // HTML comments are notes for the author, not shown on Modrinth either.
    text = text.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
    const children = parseBlocks(text, 0, state);
    if (truncated || state.cut) children.push({ t: "cut" });
    return { t: "doc", c: children, truncated: truncated || state.cut };
  }

  const count = (state, n = 1) => {
    state.nodes += n;
    if (state.nodes > MAX_NODES) state.cut = true;
    return !state.cut;
  };
  /** Checked as the parser goes: out of time -> stop here (the rest is "Read on Modrinth"). */
  const overTime = (state) => {
    if (state.cut) return true;
    if (++state.ticks % 256 === 0 && now() > state.deadline) state.cut = true;
    return state.cut;
  };

  /**
   * Finds the end of an HTML container that opens at `from` (just after its
   * opening tag): the matching close tag, counting nested ones of the same
   * name. Returns { inner, after } (after = index past the close tag), or the
   * rest of the text when it's never closed.
   */
  function matchClose(text, from, name) {
    const re = new RegExp(`<(/?)${name}\\b[^>]*>`, "gi");
    re.lastIndex = from;
    let depth = 1;
    let m;
    while ((m = re.exec(text))) {
      if (m[1]) depth--;
      else if (!/\/>$/.test(m[0])) depth++;
      if (depth === 0) return { inner: text.slice(from, m.index), after: re.lastIndex };
    }
    return { inner: text.slice(from), after: text.length };
  }

  const isBlank = (l) => /^\s*$/.test(l);
  const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)/;
  const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/;
  const HR = /^ {0,3}((?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
  const QUOTE = /^ {0,3}>\s?/;
  const LIST = /^( *)([-*+]|\d{1,9}[.)])(\s+|$)/;
  const HTML_OPEN = /^ {0,3}<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/;
  const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

  /** Does this line start a block that ends a paragraph? */
  function startsBlock(line) {
    if (FENCE.test(line) || HEADING.test(line) || HR.test(line) || QUOTE.test(line)) return true;
    const h = HTML_OPEN.exec(line);
    if (h && CONTAINER_TAGS.has(h[1].toLowerCase())) return true;
    const l = LIST.exec(line);
    return Boolean(l && l[3]); // a marker followed by a space
  }

  function parseBlocks(text, depth, state) {
    const out = [];
    if (depth > MAX_DEPTH) {
      // Too deep to be a real description: the rest is shown as plain text.
      if (count(state)) out.push({ t: "p", c: [{ t: "text", v: text.trim() }] });
      return out;
    }
    let pos = 0;
    const len = text.length;
    const lineAt = (p) => {
      const e = text.indexOf("\n", p);
      return e < 0 ? [text.slice(p), len] : [text.slice(p, e), e + 1];
    };
    while (pos < len && !overTime(state)) {
      const [line, next] = lineAt(pos);
      if (isBlank(line)) {
        pos = next;
        continue;
      }
      // fenced code
      const fence = FENCE.exec(line);
      if (fence) {
        const mark = fence[1];
        const body = [];
        let p = next;
        let closed = false;
        while (p < len) {
          const [l, n] = lineAt(p);
          p = n;
          if (new RegExp(`^ {0,3}${mark[0] === "`" ? "`" : "~"}{${mark.length},}\\s*$`).test(l)) {
            closed = true;
            break;
          }
          body.push(l);
        }
        void closed; // an unclosed fence runs to the end, like Markdown does
        if (count(state)) out.push({ t: "pre", lang: fence[2] || null, v: body.join("\n") });
        pos = p;
        continue;
      }
      // headings
      const h = HEADING.exec(line);
      if (h) {
        if (count(state)) out.push({ t: "h", level: h[1].length, c: parseInline(h[2] || "", depth, state) });
        pos = next;
        continue;
      }
      if (HR.test(line)) {
        if (count(state)) out.push({ t: "hr" });
        pos = next;
        continue;
      }
      // HTML containers at the start of a line
      const html = HTML_OPEN.exec(line);
      if (html && CONTAINER_TAGS.has(html[1].toLowerCase())) {
        const name = html[1].toLowerCase();
        const attrs = parseAttrs(html[2]);
        const openEnd = pos + html.index + html[0].length;
        const selfClosing = /\/\s*$/.test(html[2]);
        const { inner, after } = selfClosing ? { inner: "", after: openEnd } : matchClose(text, openEnd, name);
        const node = htmlBlock(name, attrs, inner, depth, state);
        if (node && count(state)) out.push(node);
        // Whatever follows the closing tag on its line is read as a new line.
        pos = after;
        continue;
      }
      // block quote
      if (QUOTE.test(line)) {
        const lines = [];
        let p = pos;
        while (p < len) {
          const [l, n] = lineAt(p);
          if (isBlank(l)) break;
          lines.push(l.replace(QUOTE, ""));
          p = n;
        }
        if (count(state)) out.push({ t: "quote", c: parseBlocks(lines.join("\n"), depth + 1, state) });
        pos = p;
        continue;
      }
      // lists
      const lm = LIST.exec(line);
      if (lm && lm[3] !== undefined && (lm[3] || /^\s*$/.test(line.slice(lm[0].length)))) {
        const { node, end } = parseList(text, pos, lineAt, depth, state);
        if (node && count(state)) out.push(node);
        pos = end;
        continue;
      }
      // tables
      if (line.includes("|") && next < len) {
        const [sep] = lineAt(next);
        if (TABLE_SEP.test(sep) && sep.includes("-")) {
          const { node, end } = parseTable(text, pos, lineAt, depth, state);
          if (node && count(state)) out.push(node);
          pos = end;
          continue;
        }
      }
      // paragraph (with setext headings)
      const lines = [line];
      let p = next;
      let setext = 0;
      while (p < len) {
        const [l, n] = lineAt(p);
        if (isBlank(l)) break;
        if (/^ {0,3}=+\s*$/.test(l)) {
          setext = 1;
          p = n;
          break;
        }
        if (/^ {0,3}-+\s*$/.test(l)) {
          setext = 2;
          p = n;
          break;
        }
        if (startsBlock(l)) break;
        lines.push(l);
        p = n;
      }
      if (count(state)) {
        const inline = parseInline(lines.join("\n"), depth, state);
        out.push(setext ? { t: "h", level: setext, c: inline } : { t: "p", c: inline });
      }
      pos = p;
    }
    return out;
  }

  /** One HTML container -> a node (or null for an empty wrapper). */
  function htmlBlock(name, attrs, inner, depth, state) {
    const align = attrs.align && /^(center|left|right)$/i.test(attrs.align) ? attrs.align.toLowerCase() : null;
    if (/^h[1-6]$/.test(name)) return { t: "h", level: Number(name[1]), align, c: parseInline(stripTags(inner, "p"), depth + 1, state) };
    if (name === "details") {
      let summary = [{ t: "text", v: "Details" }];
      let rest = inner;
      const s = /<summary\b[^>]*>([\s\S]*?)(?:<\/summary>|$)/i.exec(inner);
      if (s) {
        summary = parseInline(s[1].trim(), depth + 1, state);
        rest = inner.slice(0, s.index) + inner.slice(s.index + s[0].length);
      }
      return { t: "details", summary, c: parseBlocks(rest, depth + 1, state) };
    }
    if (name === "summary") return { t: "p", c: parseInline(inner, depth + 1, state) };
    if (name === "pre") return { t: "pre", lang: null, v: decodeEntities(inner.replace(/<\/?code\b[^>]*>/gi, "")).replace(/^\n/, "") };
    if (name === "blockquote") return { t: "quote", c: parseBlocks(inner, depth + 1, state) };
    if (name === "table") return htmlTable(inner, depth, state);
    if (name === "ul" || name === "ol") return htmlList(name, inner, depth, state);
    if (["thead", "tbody", "tfoot", "tr", "td", "th", "li"].includes(name)) {
      // Stray table/list pieces outside their parent: just their content.
      return { t: "group", c: parseBlocks(inner, depth + 1, state) };
    }
    // p, div, center, section, figure...: a group, centred if it says so.
    const c = parseBlocks(inner, depth + 1, state);
    if (!c.length) return null;
    if (name === "center" || align === "center") return { t: "center", c };
    return { t: "group", c };
  }

  const stripTags = (s, name) => s.replace(new RegExp(`</?${name}\\b[^>]*>`, "gi"), "");

  function htmlTable(inner, depth, state) {
    const rows = [];
    let head = null;
    const trRe = /<tr\b[^>]*>([\s\S]*?)(?:<\/tr>|(?=<tr\b)|$)/gi;
    let tr;
    while ((tr = trRe.exec(inner)) && rows.length < MAX_TABLE_ROWS) {
      const cells = [];
      let isHead = false;
      const cellRe = /<(td|th)\b[^>]*>([\s\S]*?)(?:<\/\1>|(?=<t[dh]\b)|$)/gi;
      let cell;
      while ((cell = cellRe.exec(tr[1])) && cells.length < MAX_TABLE_COLS) {
        if (cell[1].toLowerCase() === "th") isHead = true;
        cells.push(parseInline(cell[2].trim(), depth + 1, state));
        if (!cell[0]) break;
      }
      if (!cells.length) continue;
      if (isHead && !head && !rows.length) head = cells;
      else rows.push(cells);
      if (!tr[0]) break;
    }
    if (!head && !rows.length) return { t: "p", c: [{ t: "text", v: textOnly(inner) }] };
    return { t: "table", head, rows, align: [] };
  }

  function htmlList(name, inner, depth, state) {
    const items = [];
    const re = /<li\b[^>]*>([\s\S]*?)(?:<\/li>|(?=<li\b)|$)/gi;
    let m;
    while ((m = re.exec(inner)) && items.length < MAX_LIST_ITEMS) {
      items.push({ task: null, c: parseBlocks(m[1], depth + 1, state) });
      if (!m[0]) break;
    }
    return { t: name, start: 1, items };
  }

  /** All tags removed, entities decoded - for showing something as plain text. */
  const textOnly = (s) => decodeEntities(String(s).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

  function parseList(text, start, lineAt, depth, state) {
    const first = LIST.exec(lineAt(start)[0]);
    const ordered = /\d/.test(first[2]);
    const baseIndent = first[1].length;
    const items = [];
    let pos = start;
    let cur = null;
    let blankRun = false;
    const len = text.length;
    while (pos < len) {
      const [line, next] = lineAt(pos);
      if (isBlank(line)) {
        blankRun = true;
        cur && cur.lines.push("");
        pos = next;
        continue;
      }
      const m = LIST.exec(line);
      const indent = line.length - line.trimStart().length;
      if (m && m[1].length <= baseIndent + 1 && /\d/.test(m[2]) === ordered && (m[3] || line.trim() === m[2])) {
        if (items.length >= MAX_LIST_ITEMS) break;
        cur = { lines: [line.slice(m[0].length)], contentIndent: m[0].length };
        items.push(cur);
        blankRun = false;
        pos = next;
        continue;
      }
      if (!cur) break;
      if (indent > baseIndent) {
        // belongs to the current item (a nested list, or more of its text)
        cur.lines.push(line.slice(Math.min(indent, cur.contentIndent)));
        blankRun = false;
        pos = next;
        continue;
      }
      if (!blankRun && !startsBlock(line)) {
        // a lazy continuation line of the item's paragraph
        cur.lines.push(line.trim());
        pos = next;
        continue;
      }
      break;
    }
    const node = {
      t: ordered ? "ol" : "ul",
      start: ordered ? Math.min(Number(first[2].slice(0, -1)) || 1, 1e6) : 1,
      items: items.map((it) => {
        let body = it.lines.join("\n").replace(/\n+$/, "");
        let task = null;
        const tm = /^\[([ xX])\]\s+/.exec(body);
        if (tm) {
          task = tm[1] !== " ";
          body = body.slice(tm[0].length);
        }
        return { task, c: parseBlocks(body, depth + 1, state) };
      }),
    };
    count(state, items.length);
    return { node, end: pos };
  }

  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
    const cells = [];
    let cur = "";
    let code = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === "\\" && s[i + 1] === "|") {
        cur += "|";
        i++;
        continue;
      }
      if (ch === "`") code = !code;
      if (ch === "|" && !code) {
        cells.push(cur.trim());
        cur = "";
        continue;
      }
      cur += ch;
    }
    cells.push(cur.trim());
    return cells.slice(0, MAX_TABLE_COLS);
  }

  function parseTable(text, start, lineAt, depth, state) {
    const [headLine, afterHead] = lineAt(start);
    const [sepLine, afterSep] = lineAt(afterHead);
    const align = splitRow(sepLine).map((c) => (/^:-+:$/.test(c) ? "center" : /^-+:$/.test(c) ? "right" : /^:-+$/.test(c) ? "left" : null));
    const head = splitRow(headLine).map((c) => parseInline(c, depth + 1, state));
    const rows = [];
    let pos = afterSep;
    while (pos < text.length) {
      const [line, next] = lineAt(pos);
      if (isBlank(line) || !line.includes("|")) break;
      if (rows.length < MAX_TABLE_ROWS) rows.push(splitRow(line).map((c) => parseInline(c, depth + 1, state)));
      pos = next;
    }
    count(state, rows.length);
    return { node: { t: "table", head, rows, align }, end: pos };
  }

  /* ---------------- inline ---------------- */

  const DANGEROUS_WITH_BODY = new Set(["script", "style", "iframe", "object", "embed", "svg", "math", "noscript", "template", "textarea", "title", "xmp", "noembed", "noframes", "select", "frameset"]);

  function parseInline(src, depth, state) {
    const out = [];
    let buf = "";
    const flush = () => {
      if (buf) out.push({ t: "text", v: decodeEntities(buf) });
      buf = "";
    };
    const push = (node) => {
      flush();
      if (count(state)) out.push(node);
    };
    const s = String(src);
    if (depth > MAX_DEPTH) return [{ t: "text", v: textOnly(s) }];
    let i = 0;
    // How far ahead an opener looks for its closer. Real emphasis, links and
    // code spans are short; without a bound, text full of lone * or [ made
    // every one of them scan the whole description (seconds of frozen UI).
    const WINDOW = 1000;
    const ahead = (k) => s.slice(k, k + 2200); // never "the rest of the text" - see WINDOW
    while (i < s.length && !overTime(state)) {
      const ch = s[i];
      // escapes
      if (ch === "\\" && i + 1 < s.length) {
        if (s[i + 1] === "\n") {
          push({ t: "br" });
          i += 2;
          continue;
        }
        if (/[!-/:-@[-`{-~]/.test(s[i + 1])) {
          buf += s[i + 1];
          i += 2;
          continue;
        }
      }
      // hard line break: two spaces before a newline
      if (ch === "\n") {
        if (i >= 2 && s[i - 1] === " " && s[i - 2] === " ") {
          buf = buf.replace(/ +$/, "");
          push({ t: "br" });
        } else buf += " ";
        i++;
        continue;
      }
      // code span
      if (ch === "`") {
        const run = /^`+/.exec(ahead(i))[0];
        const close = s.indexOf(run, i + run.length);
        if (close > 0 && close - i < WINDOW * 8) {
          push({ t: "code", v: s.slice(i + run.length, close).replace(/\n/g, " ").replace(/^ (.+) $/, "$1") });
          i = close + run.length;
          continue;
        }
        buf += run;
        i += run.length;
        continue;
      }
      // images and links
      if (ch === "!" && s[i + 1] === "[") {
        const l = linkAt(s, i + 1);
        if (l) {
          push(imageNode(l.dest, textOnly(l.text), l.title));
          i = l.end;
          continue;
        }
      }
      if (ch === "[") {
        const l = linkAt(s, i);
        if (l) {
          push(linkNode(l.dest, parseInline(l.text, depth + 1, state), l.title, l.text));
          i = l.end;
          continue;
        }
      }
      // autolinks <https://...>
      if (ch === "<") {
        const rest = ahead(i);
        const auto = /^<(https?:\/\/[^\s<>]{1,2048})>/i.exec(rest);
        if (auto) {
          push(linkNode(auto[1], [{ t: "text", v: auto[1] }], null, auto[1]));
          i += auto[0].length;
          continue;
        }
        const tag = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^<>]*)>/.exec(rest);
        if (tag) {
          const consumed = inlineTag(s, i, tag, depth, state, push);
          if (consumed) {
            i = consumed;
            continue;
          }
          // not one we understand: shown as its own text, and read on after it
          buf += tag[0];
          i += tag[0].length;
          continue;
        }
      }
      // bare https:// addresses
      if ((ch === "h" || ch === "H") && (i === 0 || /[\s(]/.test(s[i - 1])) && /^https:\/\//i.test(s.slice(i, i + 8))) {
        const m = /^https:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?]/i.exec(ahead(i));
        if (m) {
          push(linkNode(m[0], [{ t: "text", v: m[0] }], null, m[0]));
          i += m[0].length;
          continue;
        }
      }
      // emphasis and strike
      if (ch === "*" || ch === "_" || ch === "~") {
        const em = emphasisAt(s, i, WINDOW);
        if (em) {
          push({ t: em.kind, c: parseInline(em.inner, depth + 1, state) });
          i = em.end;
          continue;
        }
      }
      // Plain text up to the next character that could start something: one
      // slice, not one character at a time.
      SPECIAL.lastIndex = i + 1;
      const nextSpecial = SPECIAL.exec(s);
      const stop = nextSpecial ? nextSpecial.index : s.length;
      buf += s.slice(i, stop);
      i = stop;
    }
    flush();
    return out;
  }
  const SPECIAL = /[\\\n`!\[<hH*_~]/g;

  /** [text](dest "title") starting at the "[" at i -> { text, dest, title, end } or null. */
  function linkAt(s, i) {
    let depthB = 0;
    let j = i;
    for (; j < s.length && j < i + 600; j++) {
      if (s[j] === "\\") {
        j++;
        continue;
      }
      if (s[j] === "[") depthB++;
      else if (s[j] === "]") {
        depthB--;
        if (depthB === 0) break;
      }
    }
    if (s[j] !== "]" || s[j + 1] !== "(") return null;
    const m = /^\(\s*(<[^>\n]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+("[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/.exec(s.slice(j + 1, j + 1 + 2200));
    if (!m) return null;
    return {
      text: s.slice(i + 1, j),
      dest: decodeEntities(m[1].replace(/^<|>$/g, "")),
      title: m[2] ? decodeEntities(m[2].slice(1, -1)) : null,
      end: j + 1 + m[0].length,
    };
  }

  function emphasisAt(s, i, window) {
    const tries = s[i] === "~" ? [["~~", "s"]] : [[s[i].repeat(3), "bi"], [s[i].repeat(2), "b"], [s[i], "i"]];
    for (const [d, kind] of tries) {
      if (!s.startsWith(d, i)) continue;
      const after = s[i + d.length];
      if (!after || /\s/.test(after)) continue;
      // "_" inside a word (snake_case) is not emphasis
      if (s[i] === "_" && i > 0 && /[A-Za-z0-9]/.test(s[i - 1])) return null;
      let k = i + d.length;
      while ((k = s.indexOf(d, k + 1)) > 0 && k - i < window) {
        if (/\s/.test(s[k - 1]) || s[k - 1] === "\\") continue;
        if (s[i] === "_" && /[A-Za-z0-9]/.test(s[k + d.length] || "")) continue;
        const inner = s.slice(i + d.length, k);
        if (!inner) break;
        if (kind === "bi") return { kind: "b", inner: s[i] + inner + s[i], end: k + d.length };
        return { kind, inner, end: k + d.length };
      }
    }
    return null;
  }

  function linkNode(dest, children, title, rawText) {
    const href = safeLink(dest);
    if (!href) return { t: "a", href: null, c: children, refused: String(dest || "").slice(0, 200) };
    const video = videoLink(href);
    return { t: "a", href, c: children, title: title || null, realHost: mismatchedHost(textOnly(rawText), href), video: Boolean(video) };
  }

  function imageNode(src, alt, title, attrs = {}) {
    const ok = imageAllowed(src);
    const dim = (v) => {
      const n = Number(String(v || "").replace(/px$/, ""));
      return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), MAX_IMG_SIZE) : null;
    };
    const altText = String(alt || title || "").slice(0, 300);
    if (!ok) return { t: "imgblocked", alt: altText, link: safeLink(src) };
    return { t: "img", src: ok, alt: altText, title: title || null, width: dim(attrs.width), height: dim(attrs.height) };
  }

  /**
   * An inline HTML tag at s[i] (match `tag`). Returns the index after what
   * it consumed, or 0 when it isn't one we understand.
   */
  function inlineTag(s, i, tag, depth, state, push) {
    const closing = tag[1] === "/";
    const name = tag[2].toLowerCase();
    const attrs = parseAttrs(tag[3]);
    const end = i + tag[0].length;
    if (name === "br" || name === "wbr") {
      if (name === "br") push({ t: "br" });
      return end;
    }
    if (name === "hr" && !closing) {
      push({ t: "text", v: " " });
      return end;
    }
    if (name === "img" && !closing) {
      push(imageNode(attrs.src, attrs.alt, attrs.title, attrs));
      return end;
    }
    if (name === "iframe" && !closing) {
      const { after } = matchClose(s, end, "iframe");
      const video = videoLink(attrs.src);
      if (video) {
        push({ t: "video", url: video, title: attrs.title || null });
        return after;
      }
      return 0; // shown as text
    }
    if (closing) {
      // a stray closing tag of something we understand: nothing to show
      return INLINE_TAGS[name] || name === "a" || CONTAINER_TAGS.has(name) ? end : 0;
    }
    // A block wrapper (<p>, <div>...) met in the middle of a line: the wrapper
    // itself means nothing here, its content is read on as usual.
    if (CONTAINER_TAGS.has(name)) return end;
    if (name === "a") {
      const { inner, after } = matchClose(s, end, "a");
      push(linkNode(attrs.href, parseInline(inner, depth + 1, state), attrs.title, textOnly(inner)));
      return after;
    }
    if (INLINE_TAGS[name]) {
      if (/\/\s*$/.test(tag[3])) return end;
      const { inner, after } = matchClose(s, end, name);
      const kind = INLINE_TAGS[name];
      if (kind === "code" || kind === "kbd") push({ t: kind, v: textOnly(inner) });
      else push({ t: kind, c: parseInline(inner, depth + 1, state) });
      return after;
    }
    void DANGEROUS_WITH_BODY; // these (and anything else) fall through to plain text
    return 0;
  }

  /* ---------------- DOM ---------------- */

  /**
   * The tree as DOM. options:
   *   doc        the document (defaults to the page's)
   *   onLink(href)            a link was clicked (main.js opens the browser)
   * Every element is made with createElement; every word goes in through
   * textContent or createTextNode.
   */
  function toDom(tree, options = {}) {
    const doc = options.doc || (typeof document !== "undefined" ? document : null);
    const onLink = options.onLink || (() => {});
    const make = (tag, cls, text) => {
      const n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined && text !== null) n.textContent = text;
      return n;
    };
    const kids = (parent, list) => {
      for (const node of list || []) {
        const n = build(node);
        if (n) parent.appendChild(n);
      }
      return parent;
    };
    const linkEl = (href, cls, label) => {
      const a = make("a", cls, label);
      a.href = href;
      a.title = href;
      a.rel = "noopener noreferrer";
      a.addEventListener("click", (e) => {
        e.preventDefault();
        onLink(href);
      });
      return a;
    };
    function build(node) {
      switch (node.t) {
        case "text":
          return doc.createTextNode(node.v);
        case "br":
          return make("br");
        case "b":
          return kids(make("strong"), node.c);
        case "i":
          return kids(make("em"), node.c);
        case "s":
          return kids(make("s"), node.c);
        case "u":
          return kids(make("u"), node.c);
        case "sup":
        case "sub":
          return kids(make(node.t), node.c);
        case "span":
          return kids(make("span"), node.c);
        case "code":
          return make("code", "md-code", node.v);
        case "kbd":
          return make("kbd", null, node.v);
        case "a": {
          if (!node.href) {
            const span = kids(make("span", "md-badlink"), node.c);
            span.title = "Not opened: only https links are allowed";
            return span;
          }
          const a = kids(linkEl(node.href, "md-link"), node.c);
          if (!node.realHost) return a;
          const wrap = make("span");
          wrap.appendChild(a);
          wrap.appendChild(make("span", "md-realhost", ` (${node.realHost})`));
          return wrap;
        }
        case "img": {
          const img = make("img", "md-img");
          img.alt = node.alt || "Image from the description";
          img.setAttribute("loading", "lazy");
          img.decoding = "async";
          if (node.width) img.width = node.width;
          if (node.height) img.height = node.height;
          if (node.title) img.title = node.title;
          img.src = node.src;
          return img;
        }
        case "imgblocked": {
          const box = make("span", "md-imgblocked");
          box.appendChild(make("span", "md-imgblocked-t", "Image hosted elsewhere"));
          if (node.alt) box.appendChild(make("span", "md-imgblocked-alt", node.alt));
          if (node.link) box.appendChild(linkEl(node.link, "md-link", "Open in browser"));
          return box;
        }
        case "video": {
          const card = make("span", "md-video");
          card.appendChild(make("span", "md-video-t", node.title ? `Video - ${node.title}` : "Video"));
          card.appendChild(linkEl(node.url, "md-link", "Opens in your browser"));
          return card;
        }
        case "h": {
          // One level down: the page already has its own h1/h2 above the description.
          const level = Math.min(6, Math.max(1, Number(node.level) || 1));
          const h = kids(make(`h${Math.min(6, level + 1)}`, "md-h md-h" + level), node.c);
          if (node.align === "center") h.classList.add("md-center");
          return h;
        }
        case "p":
          return kids(make("p", "md-p"), node.c);
        case "pre": {
          const pre = make("pre", "md-pre");
          pre.appendChild(make("code", null, node.v));
          return pre;
        }
        case "quote":
          return kids(make("blockquote", "md-quote"), node.c);
        case "hr":
          return make("hr", "md-hr");
        case "group":
          return kids(make("div", "md-group"), node.c);
        case "center":
          return kids(make("div", "md-center"), node.c);
        case "details": {
          const d = make("details", "md-details");
          d.appendChild(kids(make("summary"), node.summary));
          return kids(d, node.c);
        }
        case "ul":
        case "ol": {
          const list = make(node.t, "md-list");
          if (node.t === "ol" && node.start > 1) list.start = node.start;
          for (const item of node.items) {
            const li = make("li");
            if (item.task !== null) {
              li.className = "md-task";
              li.appendChild(make("span", "md-check" + (item.task ? " done" : ""), item.task ? "✓" : ""));
            }
            // a one-paragraph item reads better without the paragraph's margins
            if (item.c.length === 1 && item.c[0].t === "p") kids(li, item.c[0].c);
            else kids(li, item.c);
            list.appendChild(li);
          }
          return list;
        }
        case "table": {
          const wrap = make("div", "md-table-wrap");
          const table = make("table", "md-table");
          if (node.head) {
            const tr = make("tr");
            node.head.forEach((cell, i) => {
              const th = kids(make("th"), cell);
              if (node.align[i]) th.className = "md-al-" + node.align[i];
              tr.appendChild(th);
            });
            table.appendChild(make("thead")).appendChild(tr);
          }
          const body = make("tbody");
          for (const row of node.rows) {
            const tr = make("tr");
            row.forEach((cell, i) => {
              const td = kids(make("td"), cell);
              if (node.align[i]) td.className = "md-al-" + node.align[i];
              tr.appendChild(td);
            });
            body.appendChild(tr);
          }
          table.appendChild(body);
          wrap.appendChild(table);
          return wrap;
        }
        case "cut": {
          const p = make("p", "md-cut", "This description is long, so it is cut here. ");
          if (options.fullUrl) p.appendChild(linkEl(options.fullUrl, "md-link", "Read the rest on Modrinth"));
          return p;
        }
        case "doc":
          return kids(make("div", "md"), node.c);
        default:
          return null;
      }
    }
    return build(tree && tree.t ? tree : { t: "doc", c: [] });
  }

  const api = { parse, toDom, safeLink, imageAllowed, videoLink, mismatchedHost, decodeEntities, MAX_TEXT, IMAGE_HOSTS };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ReminthMarkdown = api;
})(typeof window !== "undefined" ? window : globalThis);
