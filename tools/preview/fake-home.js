// Preview only: pretend to be signed in with the design's example numbers (nothing is saved).
const bs = document.getElementById("bootSplash"); if (bs) bs.remove();
state.signedIn = true;
state.username = "unpurfectt";
state.rm = { user: { name: "unpurfectt", provider: "discord" }, accounts: true, providers: ["discord"], checked: true };
applyAccountUI();
switchPage("home");
updateHomeStatRow({ mobKills: 3760, playerKills: 2305, deaths: 1854, totals: { placed: 3487, mined: 5186 } });
state.settings = { ...(state.settings || {}), totalPlayTimeMs: (2 * 24 + 2) * 3600e3 };
state.instances = state.instances.map((i) => ({ ...i, lastPlayed: Date.now() - 3600e3 }));
renderHero();
await new Promise((r) => setTimeout(r, 900)); // let the real look-ups finish first
paintTiers({ reached: true, ranks: [
  { label: "HT2", tier: 2, high: true, modeName: "Sword", sites: ["MCTiers"] },
  { label: "LT2", tier: 2, high: false, modeName: "UHC", sites: ["MCTiers"] },
  { label: "HT3", tier: 3, high: true, modeName: "Vanilla", sites: ["MCTiers"] },
  { label: "LT3", tier: 3, high: false, modeName: "NethOP", sites: ["MCTiers"] },
  { label: "LT3", tier: 3, high: false, modeName: "Axe", sites: ["PvPTiers"] },
  { label: "HT4", tier: 4, high: true, modeName: "Pot", sites: ["SubTiers"] },
] });
const row = $("quickJoin");
row.textContent = "";
const taken = new Set();
for (const e of [
  { type: "server", name: "mcpvp.club", address: "mcpvp.club" },
  { type: "server", name: "pvp hub", address: "play.pvphub.me" },
  { type: "server", name: "mcpvp.com", address: "mcpvp.com" },
  { type: "server", name: "donut", address: "donutsmp.net" },
  { type: "world", name: "New World", folder: "New World" },
]) row.appendChild(quickTile(e, taken));
$("nhQuickWrap").hidden = false;
$("topName").textContent = "unpurfectt";
return "ok";
