// Applies rename-rules.js to an HTML file's text outside <!-- comments -->, <script> and <style>, and outside
// attribute values that are links/paths (src, href). Real folder paths given with --keep stay as they are.
// node rename-html.js file.html [--keep "text"]...
const fs = require("fs");
const rules = require("./rename-rules.js");
const [file, ...rest] = process.argv.slice(2);
const keep = [];
for (let i = 0; i < rest.length; i++) if (rest[i] === "--keep") keep.push(rest[++i]);
let src = fs.readFileSync(file, "utf8");
const crlf = src.includes("\r\n");
// protect
const slots = [];
const protect = (re) => {
  src = src.replace(re, (m) => {
    slots.push(m);
    return `\u0000${slots.length - 1}\u0000`;
  });
};
protect(/<!--[\s\S]*?-->/g);
protect(/<script[\s\S]*?<\/script>/gi);
protect(/<style[\s\S]*?<\/style>/gi);
// content= (meta tags) is renamed too when TOUCH_CONTENT is set (the website's link previews); its urls are lowercase
protect(process.env.TOUCH_CONTENT ? /\b(?:src|href)="[^"]*"/gi : /\b(?:src|href|content)="[^"]*"/gi);
for (const k of keep) protect(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"));
const before = src;
src = rules.apply(src);
src = src.replace(/\u0000(\d+)\u0000/g, (_, n) => slots[Number(n)]);
if (crlf && !src.includes("\r\n")) throw new Error("line endings");
fs.writeFileSync(file, src);
console.log(file, before === src ? "no change" : "changed");
