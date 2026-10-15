const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const load = () => import(pathToFileURL(path.join(__dirname, "..", "functions", "_texts.js")).href);

test("channel texts: what happens to each saved message (never an edit)", async () => {
  const { savedPlan } = await load();
  const rules = { job: "rules" };
  const updates = { job: "updates", keep: true };
  const ann = { job: "announcements", keep: true, release: "1.8.0" };
  // never posted
  assert.equal(savedPlan(null, rules, "fA").action, "post");
  assert.equal(savedPlan("", ann, "fA").action, "post");
  // rules, faq...: delete the old one and post again, changed or not
  assert.deepEqual(savedPlan("h1:m1:fA", rules, "fA"), { action: "replace", hookId: "h1", msgId: "m1" });
  assert.deepEqual(savedPlan("h1:m1", rules, "fA"), { action: "replace", hookId: "h1", msgId: "m1" });
  // announcements / updates: unchanged -> nothing; changed -> a new post, the old one stays
  assert.equal(savedPlan("h1:m1:fA", updates, "fA").action, "skip");
  assert.equal(savedPlan("h1:m1:fA", updates, "fB").action, "post");
  assert.equal(savedPlan("h1:m1:fA", ann, "fB").action, "post");
  // saved before fingerprints (14 Oct): the updates intro is taken as it is; the announcement only for a new release
  assert.deepEqual(savedPlan("h1:m1", updates, "fA"), { action: "adopt", hookId: "h1", msgId: "m1" });
  assert.equal(savedPlan("h1:m1:1.8.0", ann, "fA").action, "adopt");
  assert.equal(savedPlan("h1:m1:1.7.2", ann, "fA").action, "post");
  assert.equal(savedPlan("h1:m1", ann, "fA").action, "post");
});

test("channel texts: the announcement carries the release it is about", async () => {
  const { messages, RELEASE } = await load();
  const list = messages({});
  const ann = list.find((m) => m.job === "announcements");
  assert.equal(ann.release, RELEASE);
  assert.match(ann.embeds[0].description, new RegExp(`Reminth ${RELEASE.replace(/\./g, "\\.")} is out`));
  assert.deepEqual(list.filter((m) => m.keep).map((m) => m.job).sort(), ["announcements", "updates"]);
  // the announced release is never newer than the app (between releases package.json is already the next one)
  const num = (v) => v.split(".").map(Number).reduce((t, x) => t * 1000 + x, 0);
  assert.ok(num(RELEASE) <= num(require("../package.json").version));
});

test("channel texts: a whole run against a stand-in Discord - deletes and reposts, never PATCHes", async () => {
  const { postMessages } = await load();
  const config = new Map();
  const DB = {
    prepare(sql) {
      let args = [];
      const stmt = {
        bind: (...a) => ((args = a), stmt),
        first: async () => (/SELECT value FROM bot_config/.test(sql) && config.has(args[0]) ? { value: config.get(args[0]) } : null),
        run: async () => {
          if (/INSERT OR REPLACE INTO bot_config/.test(sql)) config.set(args[0], args[1]);
          return {};
        },
        all: async () => ({ results: [] }),
      };
      return stmt;
    },
    batch: async () => [],
    exec: async () => ({}),
  };
  const channels = ["rules", "announcements", "updates", "socials", "faq", "read-first", "commands", "support"].map((name, i) => ({ id: String(100 + i), name, type: 0 }));
  const calls = [];
  let nextId = 1;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const method = opts.method || "GET";
    calls.push(`${method} ${u.pathname}`);
    const reply = (status, data) => new Response(data === null ? null : JSON.stringify(data), { status });
    if (method === "GET" && /\/guilds\/\w+\/channels$/.test(u.pathname)) return reply(200, channels);
    if (method === "GET" && /\/channels\/\d+\/webhooks$/.test(u.pathname)) return reply(200, [{ id: "hook", name: "Reminth", token: "tok" }]);
    if (method === "POST" && /\/webhooks\/hook\/tok$/.test(u.pathname)) return reply(200, { id: "m" + nextId++ });
    if (method === "DELETE") return reply(204, null);
    return reply(404, { message: "unexpected" });
  };
  const env = { DISCORD_API: "https://discord.test/api", DISCORD_GUILD_ID: "1", DISCORD_BOT_TOKEN: "x", DB };
  const run = async () => {
    const log = [];
    for (let i = 0, guard = 0; i !== null && i !== undefined && guard < 20; guard++) {
      const r = await postMessages(env, i);
      log.push(...r.log);
      assert.ok(!r.problem, r.problem);
      if (r.done) break;
      i = r.next;
    }
    return log;
  };
  try {
    // first run: everything posted
    let log = await run();
    assert.equal(log.filter((l) => /message posted/.test(l)).length, 6);
    // second run, nothing changed: rules/faq/socials/read-first deleted and posted again, announcements/updates left
    calls.length = 0;
    log = await run();
    assert.equal(log.filter((l) => /old message deleted/.test(l)).length, 4);
    assert.equal(log.filter((l) => /no change/.test(l)).length, 2);
    assert.equal(calls.filter((c) => c.startsWith("DELETE")).length, 4);
    assert.ok(!calls.some((c) => c.startsWith("PATCH")));
    // the announcement's old message was never deleted
    assert.ok(!calls.some((c) => c === `DELETE /api/webhooks/hook/tok/messages/${config.get("msg:announcements").split(":")[1]}`));
  } finally {
    globalThis.fetch = realFetch;
  }
});
