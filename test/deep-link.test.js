"use strict";
/**
 * Prompt 17, job 2: reminth:// links (main/deepLink.js and the page's
 * deepLinkTarget in renderer/pure.js). A link may come from a web page or a
 * chat message: only an allow-listed page switch may ever come out of one.
 * Run with: node --test test/deep-link.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { parseDeepLink, createDeepLinkHandler } = require("../src/main/deepLink");
const pure = require("../src/renderer/pure");

const IDS = ["reminth", "survival-1a2b", "fabric-26-2-9f00"];
const parse = (x) => parseDeepLink(x, { knownIds: IDS });

test("deep links: the allow-listed pages", () => {
  assert.deepEqual(parse("reminth://skins"), { page: "skins" });
  assert.deepEqual(parse("reminth://skins/"), { page: "skins" }, "the trailing slash Windows/browsers add");
  assert.deepEqual(parse("reminth://home"), { page: "home" });
  assert.deepEqual(parse("reminth://home/"), { page: "home" });
  assert.deepEqual(parse("reminth://instance/survival-1a2b"), { page: "instance", id: "survival-1a2b" });
  assert.deepEqual(parse("reminth://instance/reminth/"), { page: "instance", id: "reminth" });
});

test("deep links: every bad kind is null", () => {
  const bad = [
    // other schemes, and case tricks
    "https://skins",
    "reminth:skins",
    "reminth:/skins",
    "Reminth://skins",
    "REMINTH://skins",
    "reminth://Skins",
    "reminth://SKINS",
    "reminth://instance/Reminth",
    "reminthx://skins",
    "file:///C:/Windows",
    "javascript:alert(1)",
    // unknown pages, and the ones that would act
    "reminth://",
    "reminth:///",
    "reminth://play/anything",
    "reminth://play",
    "reminth://install/sodium",
    "reminth://delete/reminth",
    "reminth://signout",
    "reminth://settings",
    "reminth://instance",
    "reminth://instance/",
    // extra path, queries, fragments
    "reminth://skins/extra",
    "reminth://skins//",
    "reminth://home/play",
    "reminth://instance/reminth/play",
    "reminth://instance/reminth/delete",
    "reminth://skins?play=1",
    "reminth://skins?",
    "reminth://skins#x",
    "reminth://instance/reminth?launch=true",
    // instance ids: unknown, malformed, too long
    "reminth://instance/nope-0000",
    "reminth://instance/-reminth",
    "reminth://instance/" + "a".repeat(41),
    // traversal, escapes, separators, user info, ports
    "reminth://../../x",
    "reminth://skins/../home",
    "reminth://instance/../reminth",
    "reminth://%73kins",
    "reminth://instance/rem%69nth",
    "reminth://skins\\..\\x",
    "reminth://user@skins",
    "reminth://skins:80",
    "reminth://skins.",
    // whitespace and control characters
    " reminth://skins",
    "reminth://skins ",
    "reminth://sk ins",
    "reminth://skins\n",
    "reminth://skins\u0000",
    "reminth://skins\t",
    "reminth://ski\u200bns",
    // huge input
    "reminth://skins/" + "/".repeat(5000),
    "reminth://" + "a".repeat(100000),
    // not a string
    "",
  ];
  for (const link of bad) assert.equal(parse(link), null, JSON.stringify(link.slice(0, 80)));
  for (const odd of [null, undefined, 42, {}, { href: "reminth://skins" }, [42], [["reminth://skins"]]]) assert.equal(parse(odd), null, String(odd));
});

test("deep links: argv noise around the link is ignored", () => {
  const exe = "C:\\Users\\Γιώργος\\AppData\\Local\\Programs\\Reminth\\Reminth.exe";
  assert.deepEqual(parse([exe, "reminth://skins/"]), { page: "skins" });
  assert.deepEqual(parse([exe, "--allow-file-access-from-files", "--user-data-dir=C:\\x\\y", "--some-flag", "reminth://skins"]), { page: "skins" });
  assert.deepEqual(parse(["electron.exe", ".", "--inspect=9229", "reminth://instance/survival-1a2b"]), { page: "instance", id: "survival-1a2b" });
  // no link at all (a normal start, or a second start from the shortcut)
  assert.equal(parse([exe]), null);
  assert.equal(parse([exe, "--some-flag", "--user-data-dir=C:\\reminth:\\x"]), null);
  assert.equal(parse([]), null);
  // two links: nothing to guess
  assert.equal(parse([exe, "reminth://skins", "reminth://home"]), null);
  // one good and one bad: still nothing
  assert.equal(parse([exe, "reminth://skins", "REMINTH://play/x"]), null);
  // a bad one among flags
  assert.equal(parse([exe, "--flag", "reminth://play/anything"]), null);
  // a flag that only contains the scheme further in isn't a link
  assert.equal(parse([exe, "--open=reminth://skins"]), null);
  // an absurd command line
  assert.equal(parse(Array.from({ length: 100 }, () => "--x").concat("reminth://skins")), null);
});

test("deep links: an instance link needs an instance that exists", () => {
  assert.equal(parseDeepLink("reminth://instance/survival-1a2b", { knownIds: [] }), null);
  assert.equal(parseDeepLink("reminth://instance/survival-1a2b"), null);
  assert.deepEqual(parseDeepLink("reminth://instance/survival-1a2b", { knownIds: new Set(["survival-1a2b"]) }), { page: "instance", id: "survival-1a2b" });
});

test("deep links: the handler does nothing but bring the window forward and switch the page", async () => {
  const did = [];
  const handle = createDeepLinkHandler({
    listIds: async () => {
      did.push("listIds");
      return IDS;
    },
    bringForward: () => did.push("bringForward"),
    showPage: (link) => did.push(["showPage", link]),
  });
  assert.deepEqual(await handle(["Reminth.exe", "reminth://skins/"]), { page: "skins" });
  assert.deepEqual(did, ["listIds", "bringForward", ["showPage", { page: "skins" }]]);

  // bad links, and no link: nothing happens at all (not even the window)
  did.length = 0;
  for (const argv of [["Reminth.exe"], ["Reminth.exe", "reminth://play/anything"], ["Reminth.exe", "reminth://../../x"], ["Reminth.exe", "--flag"], "reminth://install/x"]) {
    assert.equal(await handle(argv), null);
  }
  assert.deepEqual(did.filter((d) => d !== "listIds"), []);
  // the instance list isn't even read when there is no link
  did.length = 0;
  await handle(["Reminth.exe", "--flag"]);
  assert.deepEqual(did, []);

  // a failure anywhere is swallowed: never a crash from a link
  const broken = createDeepLinkHandler({
    listIds: async () => {
      throw new Error("registry unreadable");
    },
    bringForward: () => assert.fail("not reached"),
    showPage: () => assert.fail("not reached"),
  });
  assert.equal(await broken(["x", "reminth://skins"]), null);
});

test("deep links: the page only switches pages, and only to allow-listed ones", () => {
  assert.deepEqual(pure.deepLinkTarget({ page: "skins" }, IDS), { page: "skins" });
  assert.deepEqual(pure.deepLinkTarget({ page: "home" }, IDS), { page: "home" });
  assert.deepEqual(pure.deepLinkTarget({ page: "instance", id: "reminth" }, IDS), { instance: "reminth" });
  // the instance isn't in the list (deleted meanwhile, or not loaded): nothing
  assert.equal(pure.deepLinkTarget({ page: "instance", id: "gone-0000" }, IDS), null);
  assert.equal(pure.deepLinkTarget({ page: "instance", id: "reminth" }, []), null);
  for (const bad of [null, undefined, "skins", { page: "settings" }, { page: "play", id: "reminth" }, { page: "discover" }, { page: "instance" }, { page: "instance", id: "../x" }, { page: "__proto__" }]) {
    assert.equal(pure.deepLinkTarget(bad, IDS), null, JSON.stringify(bad));
  }
});

test("deep links: the installer registers reminth:// for the current user (no admin prompt)", () => {
  const build = require("../package.json").build;
  assert.deepEqual(build.protocols, [{ name: "Reminth", schemes: ["reminth"] }]);
  assert.equal(build.nsis.perMachine, false, "a per-user install writes the scheme under HKCU");
});
