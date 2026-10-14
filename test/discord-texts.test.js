const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const load = () => import(pathToFileURL(path.join(__dirname, "..", "functions", "_texts.js")).href);

test("channel texts: a new release is posted as a new message, not an edit", async () => {
  const { savedPlan } = await load();
  // never posted
  assert.equal(savedPlan(null, "h1", "1.7.2").edit, false);
  // saved before releases were tracked -> new post for this release
  assert.deepEqual(savedPlan("h1:m1", "h1", "1.7.2"), { msgId: "m1", newRelease: true, edit: false });
  // same release again (a fixed typo) -> edit
  assert.deepEqual(savedPlan("h1:m1:1.7.2", "h1", "1.7.2"), { msgId: "m1", newRelease: false, edit: true });
  // next release -> new post
  assert.equal(savedPlan("h1:m1:1.7.2", "h1", "1.7.3").edit, false);
  // texts without a release keep editing
  assert.equal(savedPlan("h1:m1", "h1", undefined).edit, true);
  // webhook was remade -> post again
  assert.equal(savedPlan("h1:m1", "h2", undefined).edit, false);
});

test("channel texts: the announcement carries the release it is about", async () => {
  const { messages, RELEASE } = await load();
  const list = messages({});
  const ann = list.find((m) => m.job === "announcements");
  assert.equal(ann.release, RELEASE);
  assert.match(ann.embeds[0].description, new RegExp(`Reminth ${RELEASE.replace(/\./g, "\\.")} is out`));
  assert.equal(list.filter((m) => m.release).length, 1);
  // the announced release is never newer than the app (between releases package.json is already the next one)
  const num = (v) => v.split(".").map(Number).reduce((t, x) => t * 1000 + x, 0);
  assert.ok(num(RELEASE) <= num(require("../package.json").version));
});
