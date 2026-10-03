"use strict";
/**
 * The project page in Discover: what main/projectPage.js hands the page
 * (links checked, pictures limited, people, builds, the parsed description,
 * the cache), and the page's own rules in renderer/pure.js ("fits your
 * instance", version ranges, the beta/alpha confirmation).
 * Modrinth is a fake. No network, no Electron.
 * Run with: node --test test/project-page.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const page = require("../src/main/projectPage");
const pure = require("../src/renderer/pure");

const PROJECT = {
  id: "AANobbMI",
  slug: "sodium",
  project_type: "mod",
  title: "Sodium",
  description: "The fastest rendering optimization mod.",
  body: "# Sodium\n\n![shot](https://cdn.modrinth.com/data/AANobbMI/images/x.png) ![tracker](https://evil.example/pixel.gif)\n\n[Discord](javascript:alert(1)) [Wiki](https://github.com/CaffeineMC/sodium/wiki)",
  icon_url: "https://cdn.modrinth.com/data/AANobbMI/icon.png",
  downloads: 12345678,
  followers: 54321,
  updated: "2026-09-30T10:00:00Z",
  categories: ["optimization"],
  client_side: "required",
  server_side: "unsupported",
  loaders: ["fabric", "neoforge"],
  game_versions: ["1.21.4", "1.21.5", "26.3"],
  license: { id: "LicenseRef-Polyform-Shield-1.0.0", name: "Polyform Shield", url: "https://polyformproject.org/licenses/shield/1.0.0" },
  source_url: "https://github.com/CaffeineMC/sodium",
  issues_url: "javascript:alert(1)",
  wiki_url: null,
  discord_url: "https://user:pw@discord.gg/x",
  donation_urls: [{ platform: "Ko-fi", url: "https://ko-fi.com/x" }, { platform: "Evil", url: "file:///C:/x" }],
  gallery: [
    { url: "https://cdn.modrinth.com/g1.png", raw_url: "https://cdn.modrinth.com/g1raw.png", title: "One", featured: false, ordering: 1 },
    { url: "https://i.imgur.com/g2.png", title: "Two", featured: true, ordering: 2 },
  ],
  team: "team1",
  organization: null,
};

function fakeModrinth({ fail = {}, versions } = {}) {
  const calls = { project: 0, versions: 0, teams: 0, orgs: 0 };
  return {
    calls,
    async getProject(id) {
      calls.project++;
      if (fail.project) throw new Error("Modrinth couldn't be reached");
      return { ...PROJECT, slug: id === "AANobbMI" ? "sodium" : id };
    },
    async getProjectVersions() {
      calls.versions++;
      if (fail.versions) throw new Error("fetch failed");
      return (
        versions || [
          { id: "v1", name: "Sodium 0.6.0", version_number: "0.6.0", version_type: "release", game_versions: ["1.21.4"], loaders: ["fabric"], date_published: "2026-08-01", downloads: 10, changelog: "Fixes" },
          { id: "v2", name: "Sodium 0.7.0-beta", version_number: "0.7.0-beta.1", version_type: "beta", game_versions: ["26.3"], loaders: ["fabric", "neoforge"], date_published: "2026-09-01", downloads: 5, changelog: "x".repeat(30000) },
        ]
      );
    },
    async getTeams() {
      calls.teams++;
      if (fail.teams) throw new Error("nope");
      return [
        [
          { role: "Member", accepted: true, is_owner: false, ordering: 1, user: { username: "helper", avatar_url: "https://evil.example/a.png" } },
          { role: "Lead", accepted: true, is_owner: true, ordering: 0, user: { username: "jellysquid3", avatar_url: "https://cdn.modrinth.com/user/a.png" } },
          { role: "Pending", accepted: false, user: { username: "invited" } },
        ],
      ];
    },
    async getOrganizations() {
      calls.orgs++;
      return [{ name: "CaffeineMC", slug: "caffeinemc", icon_url: "https://cdn.modrinth.com/org.png" }];
    },
  };
}

test("shapeProject: only https links that check out, pictures only from Modrinth's CDN", () => {
  const p = page.shapeProject(PROJECT);
  assert.deepEqual(
    p.links.map((l) => [l.kind, l.href]),
    [
      ["source", "https://github.com/CaffeineMC/sodium"],
      ["donate", "https://ko-fi.com/x"],
    ]
  );
  assert.equal(p.icon, "https://cdn.modrinth.com/data/AANobbMI/icon.png");
  assert.equal(p.modrinthUrl, "https://modrinth.com/mod/sodium");
  assert.equal(p.license.name, "Polyform Shield");
  // featured first; the imgur one has no picture, only a link to open it
  assert.deepEqual(
    p.gallery.map((g) => [g.title, g.url, g.link]),
    [
      ["Two", null, "https://i.imgur.com/g2.png"],
      ["One", "https://cdn.modrinth.com/g1.png", "https://cdn.modrinth.com/g1raw.png"],
    ]
  );
  assert.equal(page.shapeProject({ icon_url: "https://evil.example/i.png" }).icon, null);
});

test("shapePeople: owner first, invited people left out, avatars only from allowed hosts; organisations win", () => {
  const team = [
    { role: "Member", is_owner: false, ordering: 1, user: { username: "b", avatar_url: "https://evil.example/a.png" } },
    { role: "Owner", is_owner: true, ordering: 5, user: { username: "a", avatar_url: "https://avatars.githubusercontent.com/u/1" } },
    { role: "x", accepted: false, user: { username: "c" } },
  ];
  assert.deepEqual(
    page.shapePeople(team, null).map((m) => [m.name, m.owner, m.avatar]),
    [
      ["a", true, "https://avatars.githubusercontent.com/u/1"],
      ["b", false, null],
    ]
  );
  const org = page.shapePeople(team, { name: "CaffeineMC", slug: "caffeinemc", icon_url: "https://cdn.modrinth.com/o.png" });
  assert.deepEqual([org.length, org[0].name, org[0].role, org[0].url], [1, "CaffeineMC", "Organisation", "https://modrinth.com/organization/caffeinemc"]);
});

test("getProjectPage: one answer with the parsed description, people and builds (newest first, changelogs capped)", async () => {
  page.clearCache();
  const api = fakeModrinth();
  const r = await page.getProjectPage("sodium", { modrinth: api });
  assert.equal(r.project.title, "Sodium");
  assert.deepEqual(r.people.map((p) => p.name), ["jellysquid3", "helper"]);
  assert.deepEqual(r.builds.map((b) => [b.number, b.type]), [["0.7.0-beta.1", "beta"], ["0.6.0", "release"]]);
  assert.equal(r.builds[0].changelog.length, 20000);
  assert.equal(r.builds[0].changelogCut, true);
  // the description tree: the CDN picture loads, the tracker doesn't, the javascript: link isn't a link
  const flat = JSON.stringify(r.body);
  assert.match(flat, /"t":"img","src":"https:\/\/cdn\.modrinth\.com\/data\/AANobbMI\/images\/x\.png"/);
  assert.match(flat, /"t":"imgblocked"/);
  const discord = r.body.c[2].c[0];
  assert.deepEqual([discord.t, discord.href, discord.refused], ["a", null, "javascript:alert(1)"]);
});

test("getProjectPage: cached for a few minutes (by slug and id), then asked again; failures never cached", async () => {
  page.clearCache();
  let t = 1_000_000;
  const api = fakeModrinth();
  await page.getProjectPage("sodium", { modrinth: api, now: () => t });
  await page.getProjectPage("SODIUM", { modrinth: api, now: () => t + 1000 });
  await page.getProjectPage("AANobbMI", { modrinth: api, now: () => t + 2000 });
  assert.equal(api.calls.project, 1);
  t += page.CACHE_MS + 1;
  await page.getProjectPage("sodium", { modrinth: api, now: () => t });
  assert.equal(api.calls.project, 2);
  page.clearCache();
  const down = fakeModrinth({ fail: { project: true } });
  await assert.rejects(page.getProjectPage("sodium", { modrinth: down }), /couldn't be reached/);
  await assert.rejects(page.getProjectPage("sodium", { modrinth: down }), /couldn't be reached/);
  assert.equal(down.calls.project, 2);
});

test("getProjectPage: no version list or team still gives a page; organisations are credited; bad ids refused", async () => {
  page.clearCache();
  const r = await page.getProjectPage("sodium", { modrinth: fakeModrinth({ fail: { versions: true, teams: true } }) });
  assert.equal(r.builds, null);
  assert.deepEqual(r.people, []);
  page.clearCache();
  const api = fakeModrinth();
  const orgProject = await page.getProjectPage("org-mod", {
    modrinth: { ...api, getProject: async () => ({ ...PROJECT, slug: "org-mod", organization: "org1" }) },
  });
  assert.deepEqual(orgProject.people.map((p) => p.name), ["CaffeineMC"]);
  for (const bad of ["../etc", "a b", "", "x".repeat(65), null]) await assert.rejects(page.getProjectPage(bad, { modrinth: api }), /isn't valid/);
});

test("getProjectPage: Modrinth is asked with the id's own case (ids are case-sensitive), the cache ignores case", async () => {
  page.clearCache();
  const asked = [];
  const api = fakeModrinth();
  const spy = { ...api, getProject: async (id) => (asked.push(id), api.getProject(id)), getProjectVersions: async (id) => (asked.push(id), api.getProjectVersions(id)) };
  await page.getProjectPage("AANobbMI", { modrinth: spy });
  assert.deepEqual(asked, ["AANobbMI", "AANobbMI"]);
  await page.getProjectPage("aanobbmi", { modrinth: spy });
  assert.equal(asked.length, 2, "second ask came from the cache");
});

/* ---------------- the page's own rules ---------------- */

const fab = { id: "f", name: "Survival", loader: "fabric", mcVersion: "1.21.4" };

test("fitsInstance: fits / beta only / no build / needs a loader / modpacks / unknown", () => {
  const builds = [
    { type: "release", mc: ["1.21.4"], loaders: ["fabric"] },
    { type: "beta", mc: ["26.3"], loaders: ["fabric"] },
    { type: "release", mc: ["1.21.4"], loaders: ["neoforge"] },
  ];
  assert.equal(pure.fitsInstance("mod", builds, fab).state, "fits");
  assert.equal(pure.fitsInstance("mod", builds, fab).text, "Fits your instance Survival (1.21.4 Fabric).");
  assert.equal(pure.fitsInstance("mod", builds, { ...fab, mcVersion: "26.3" }).state, "beta-only");
  const none = pure.fitsInstance("mod", builds, { ...fab, loader: "forge" });
  assert.deepEqual([none.state, none.text], ["no-build", "No build for 1.21.4 Forge yet."]);
  assert.equal(pure.fitsInstance("mod", builds, { ...fab, loader: "quilt" }).state, "fits", "Quilt takes Fabric builds");
  assert.equal(pure.fitsInstance("mod", builds, { ...fab, loader: "vanilla" }).state, "needs-loader");
  assert.equal(pure.fitsInstance("modpack", builds, fab).state, "not-for-instance");
  assert.equal(pure.fitsInstance("mod", null, fab).state, "unknown");
  assert.equal(pure.fitsInstance("resourcepack", [{ type: "release", mc: ["1.21.4"], loaders: ["minecraft"] }], { ...fab, loader: "vanilla" }).state, "fits");
  assert.equal(pure.fitsInstance("shader", [{ type: "release", mc: ["1.21.4"], loaders: ["iris"] }], fab).state, "fits");
  assert.equal(pure.fitsInstance("shader", [{ type: "release", mc: ["1.21.4"], loaders: ["iris"] }], { ...fab, loader: "vanilla" }).state, "needs-loader");
});

test("collapseVersions: families as ranges, newest first; snapshots only counted", () => {
  const many = [];
  for (let i = 0; i <= 11; i++) many.push(i ? `1.21.${i}` : "1.21");
  many.push("1.20.1", "1.20.4", "1.16.5", "26.1", "26.2", "26.3", "24w14a", "1.21-pre1", "26.3-snapshot-1");
  assert.deepEqual(pure.collapseVersions(many), { ranges: ["26.1–26.3", "1.21–1.21.11", "1.20.1–1.20.4", "1.16.5"], other: 3 });
  assert.deepEqual(pure.collapseVersions(null), { ranges: [], other: 0 });
});

test("buildConfirmText: releases need no question; beta and alpha name their channel", () => {
  assert.equal(pure.buildConfirmText({ type: "release", number: "1.0" }), null);
  assert.match(pure.buildConfirmText({ type: "beta", number: "0.7.0-beta.1" }), /^0\.7\.0-beta\.1 is a beta build/);
  assert.match(pure.buildConfirmText({ type: "alpha", number: "2.0-a1" }), /is an alpha build.*break worlds/);
  assert.equal(pure.buildConfirmText(null), null);
});
