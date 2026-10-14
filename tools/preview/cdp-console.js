// node cdp-console.js <port> <seconds> ["<js to run after reload>"] - reloads the page and prints errors/warnings/console output
const [, , port, secs, after] = process.argv;
(async () => {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.method === "Runtime.exceptionThrown") console.log("EXCEPTION", JSON.stringify(d.params.exceptionDetails).slice(0, 800));
    if (d.method === "Runtime.consoleAPICalled") console.log("CONSOLE." + d.params.type, d.params.args.map((a) => a.value || a.description).join(" ").slice(0, 400));
    if (d.method === "Log.entryAdded") console.log("LOG." + d.params.entry.level, d.params.entry.text.slice(0, 400), d.params.entry.url || "");
  };
  send("Runtime.enable");
  send("Log.enable");
  send("Page.reload", {});
  if (after) setTimeout(() => send("Runtime.evaluate", { expression: `(async () => { ${after} })()`, awaitPromise: true }), 5000);
  setTimeout(() => process.exit(0), Number(secs) * 1000);
})();
