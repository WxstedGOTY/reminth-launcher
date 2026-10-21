// Compares every new jar with the bundled one it replaces: same depends (Minecraft range, Java, Fabric API), new
// version, new display name, and the in-game texts renamed.
const fs = require("fs");
const path = require("path");
const zr = require("C:/Users/kolijos/Downloads/reminth-launcher/src/main/zipread");
const OLD = "C:/Users/kolijos/Downloads/reminth-launcher/assets/mods";
const NEW = process.argv[2];
(async () => {
  let bad = 0;
  for (const f of fs.readdirSync(NEW).sort()) {
    const suffix = f.replace(/^reminth(hud|home)-[0-9.]+\+/, "");
    const kind = f.startsWith("reminthhud") ? "reminthhud" : "reminthhome";
    const old = fs.readdirSync(OLD).find((o) => o.startsWith(kind + "-") && o.endsWith("+" + suffix));
    const read = async (file) => {
      const z = await zr.openZip(file);
      try {
        const meta = JSON.parse(String(await z.read("fabric.mod.json")));
        const names = z.entries ? [...z.entries.keys()] : [];
        return { meta, names, z };
      } finally {
        // keep open for lang reads below
      }
    };
    const a = await zr.readEntries(path.join(OLD, old), ["fabric.mod.json"]);
    const b = await zr.readEntries(path.join(NEW, f), ["fabric.mod.json", `assets/${kind}/lang/en_us.json`]);
    const ma = JSON.parse(String(a["fabric.mod.json"]));
    const mb = JSON.parse(String(b["fabric.mod.json"]));
    const sameDeps = JSON.stringify(ma.depends) === JSON.stringify(mb.depends);
    const lang = b[`assets/${kind}/lang/en_us.json`] ? String(b[`assets/${kind}/lang/en_us.json`]) : "";
    const ok = sameDeps && mb.name.startsWith("Spaceport") && !/Reminth/.test(lang) && mb.version !== ma.version;
    if (!ok) bad++;
    console.log(`${ok ? "ok " : "BAD"} ${f}  replaces ${old}  ${mb.version}  "${mb.name}"  deps ${sameDeps ? "same" : JSON.stringify(ma.depends) + " -> " + JSON.stringify(mb.depends)}`);
  }
  console.log(bad ? `${bad} BAD` : "all match");
})();
