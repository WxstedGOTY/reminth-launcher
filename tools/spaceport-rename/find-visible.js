// Lists "Reminth" inside JS string/template literals (not comments) for each file given, or with --rewrite applies the
// replacement rules to string literals only. Usage: node find-visible.js [--rewrite] files...
const fs = require("fs");
const args = process.argv.slice(2);
const rewrite = args[0] === "--rewrite";
const files = rewrite ? args.slice(1) : args;

// Splits JS source into segments {kind: "code"|"comment"|"string", text}. Handles '', "", `` (with ${} nesting), //, /* */,
// and regex literals roughly (a / after an operator or at line start begins a regex).
function segments(src) {
  const out = [];
  let i = 0, start = 0;
  const push = (kind, end) => { if (end > start) out.push({ kind, text: src.slice(start, end) }); start = end; };
  const prevSignificant = () => { for (let k = i - 1; k >= 0; k--) { const ch = src[k]; if (!/\s/.test(ch)) return ch; } return ""; };
  const tplStack = [];
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === "/" && n === "/") { push("code", i); let j = src.indexOf("\n", i); if (j < 0) j = src.length; i = j; push("comment", i); continue; }
    if (c === "/" && n === "*") { push("code", i); let j = src.indexOf("*/", i + 2); j = j < 0 ? src.length : j + 2; i = j; push("comment", i); continue; }
    if (c === "'" || c === '"') {
      push("code", i); let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === "\\") j++; if (src[j] === "\n") break; j++; }
      i = j + 1; push("string", i); continue;
    }
    if (c === "`" || (c === "}" && tplStack.length && tplStack[tplStack.length - 1] === 0)) {
      if (c === "}") tplStack.pop();
      push("code", i); let j = i + 1;
      while (j < src.length) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "`") { j++; break; }
        if (src[j] === "$" && src[j + 1] === "{") { j += 2; tplStack.push(0); break; }
        j++;
      }
      i = j; push("string", i); continue;
    }
    if (tplStack.length) { if (c === "{") tplStack[tplStack.length - 1]++; else if (c === "}") tplStack[tplStack.length - 1]--; }
    if (c === "/" && /[=(,:;!&|?{}\[\]+\-*%<>~^]|^$/.test(prevSignificant())) {
      // regex literal
      push("code", i); let j = i + 1, cls = false;
      while (j < src.length && src[j] !== "\n") { if (src[j] === "\\") { j += 2; continue; } if (src[j] === "[") cls = true; else if (src[j] === "]") cls = false; else if (src[j] === "/" && !cls) break; j++; }
      i = j + 1; push("code", i); continue;
    }
    i++;
  }
  push("code", i);
  return out;
}

const RULES = require(process.env.RULES || "./rename-rules.js");
let total = 0;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const segs = segments(src);
  if (segs.map((s) => s.text).join("") !== src) throw new Error("segmenting lost text in " + f);
  if (!rewrite) {
    let line = 1;
    for (const s of segs) {
      if (s.kind === "string" && /Reminth/.test(s.text)) {
        total++;
        console.log(`${f}:${line}: ${s.text.replace(/\s+/g, " ").slice(0, 160)}`);
      }
      line += (s.text.match(/\n/g) || []).length;
    }
  } else {
    let changed = 0;
    const next = segs.map((s) => {
      if (s.kind !== "string" || !/Reminth/.test(s.text)) return s.text;
      const t = RULES.apply(s.text);
      if (t !== s.text) changed++;
      return t;
    }).join("");
    if (next !== src) fs.writeFileSync(f, next);
    total += changed;
    if (changed) console.log(f, changed);
  }
}
console.error("total", total);
