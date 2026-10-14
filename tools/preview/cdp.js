// Tiny CDP client for the preview window: node cdp.js <port> eval "<js>"  |  node cdp.js <port> shot <out.png> ["<js before>"]
const [, , port, cmd, a1, a2] = process.argv;

async function target() {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url));
  if (!page) throw new Error("no page: " + JSON.stringify(list.map((t) => t.url)));
  return page.webSocketDebuggerUrl;
}

async function main() {
  const ws = new WebSocket(await target());
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d);
      pending.delete(d.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const evaluate = async (expr) => {
    const res = await send("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
    if (res.result && res.result.exceptionDetails) return "EXCEPTION: " + JSON.stringify(res.result.exceptionDetails).slice(0, 1500);
    return res.result && res.result.result ? res.result.result.value : res;
  };
  if (cmd === "eval") {
    console.log(JSON.stringify(await evaluate(a1), null, 1));
  } else if (cmd === "size") {
    // node cdp.js <port> size <w> <h>  (0 0 = back to the window's own size)
    if (Number(a1)) await send("Emulation.setDeviceMetricsOverride", { width: Number(a1), height: Number(a2), deviceScaleFactor: 1, mobile: false });
    else await send("Emulation.clearDeviceMetricsOverride");
    console.log("size", a1, a2);
  } else if (cmd === "shot") {
    if (a2) console.log(JSON.stringify(await evaluate(a2)));
    await new Promise((r) => setTimeout(r, 700));
    const res = await send("Page.captureScreenshot", { format: "png" });
    require("fs").writeFileSync(a1, Buffer.from(res.result.data, "base64"));
    console.log("saved", a1);
  }
  ws.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
