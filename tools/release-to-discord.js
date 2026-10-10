// Turns a GitHub release (JSON from the API, file in argv[2]) into the Discord webhook message (printed as JSON).
// Used by .github/workflows/discord-release.yml.
"use strict";
const rel = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
const notes = String(rel.body || "")
  .replace(/\r\n/g, "\n")
  .replace(/^\s*#*\s*Reminth\s+v?[\d.]+\s*\n+/i, "") // a "## Reminth x.y.z" first line - the title already says it
  .trim()
  .slice(0, 3500);
process.stdout.write(
  JSON.stringify({
    username: "Reminth",
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: `Reminth ${rel.tag_name} is out`,
        url: "https://reminth.pages.dev",
        color: 0xff4a1c,
        description: `${notes}\n\n**Download:** https://reminth.pages.dev\nAlready have Reminth? It updates by itself.`.trim(),
        footer: { text: "Reminth" },
        timestamp: rel.published_at || undefined,
      },
    ],
  })
);
