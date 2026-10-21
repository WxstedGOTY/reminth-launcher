// Rename in the in-game mods' Java sources: only string literals players can see. Skipped: lines that log (LOGGER /
// LOG. / getLogger - the test tools read those lines), thread names, system properties, class names (com.wxsted...).
// Also "REMINTH MODS PANEL" -> "SPACEPORT MODS PANEL". node rename-java.js [--dry] files...
const fs = require("fs");
const rules = require("./rename-rules.js");
const args = process.argv.slice(2);
const dry = args[0] === "--dry";
const files = dry ? args.slice(1) : args;
const SKIP_LINE = /LOGGER|\bLOG\.|getLogger|new Thread\(|System\.getProperty|Boolean\.getBoolean|Integer\.getInteger/;
let total = 0;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const lines = src.split("\n");
  let changed = 0;
  const out = lines.map((line) => {
    if (SKIP_LINE.test(line)) return line;
    const code = line.replace(/^\s*\/\/.*$/, "");
    if (!code) return line;
    // string literals on this line (Java strings don't span lines; text blocks aren't used in these mods)
    return line.replace(/"((?:[^"\\]|\\.)*)"/g, (m, inner) => {
      if (/^com\.wxsted\./.test(inner)) return m;
      let next = inner.replace(/REMINTH MODS PANEL/g, "SPACEPORT MODS PANEL");
      if (/Reminth/.test(next)) next = rules.apply(next);
      if (next !== inner) {
        changed++;
        if (dry) console.log(`${f}: ${inner.slice(0, 110)}\n    -> ${next.slice(0, 110)}`);
      }
      return `"${next}"`;
    });
  });
  if (changed && !dry) fs.writeFileSync(f, out.join("\n"));
  total += changed;
}
console.error("strings changed:", total);
