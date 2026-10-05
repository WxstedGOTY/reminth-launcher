"use strict";
// Not part of the launcher. Checks every slug in src/main/purposes.js against Modrinth for one Minecraft version
// (default 26.2, Fabric): does the project exist, is there a build, which channel. Needs the internet.
//   node tools/overnight/check-purposes.js [mcVersion]
const path = require("path");
const purposes = require(path.join(__dirname, "../../src/main/purposes.js"));
const MC = process.argv[2] || "26.2";
const UA = { headers: { "User-Agent": "reminth-launcher purposes check" } };

async function json(url) {
  const res = await fetch(url, UA);
  return res.ok ? res.json() : { error: res.status };
}

(async () => {
  const seen = new Map();
  for (const id of purposes.GOAL_IDS) {
    for (const tab of purposes.tabsFor(id, { loader: "fabric" })) for (const i of [...tab.core, ...tab.more]) seen.set(i.slug, i);
  }
  let bad = 0;
  for (const [slug, item] of seen) {
    const project = await json(`https://api.modrinth.com/v2/project/${slug}`);
    if (project.error) {
      console.log(`${slug.padEnd(30)} NOT FOUND (${project.error})`);
      bad++;
      continue;
    }
    const loaders = item.kind === "mod" ? '&loaders=["fabric"]' : "";
    const versions = await json(`https://api.modrinth.com/v2/project/${slug}/version?game_versions=["${MC}"]${loaders}`);
    const list = Array.isArray(versions) ? versions : [];
    const channels = [...new Set(list.map((v) => v.version_type))].join("/") || "-";
    if (!list.length) bad++;
    console.log(`${slug.padEnd(30)} ${item.kind.padEnd(13)} builds for ${MC}: ${String(list.length).padStart(2)} ${channels}`);
  }
  console.log(bad ? `${bad} item(s) without a build for ${MC}` : `all ${seen.size} items have a build for ${MC}`);
})();
