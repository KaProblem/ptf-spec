#!/usr/bin/env node
// Browser test of the MCP App player: a fake MCP Apps host on one origin embeds
// the player from a second origin under a strict CSP (frame-src 'none',
// connect-src 'none'), sends it a real show_simulator result, and checks that the
// simulator runs, its events reach tools/call and the model context gets updated.
//
//   node test/player.browser.mjs [library-dir] [sim-ref]
//   PTF_SCREENSHOT=out.png ... also saves a screenshot of the host page
// Needs Playwright with Chromium.

import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = new URL(".", import.meta.url).pathname;
const lib = resolve(process.argv[2] || join(here, "../../examples/minimal-library"));
const simRef = process.argv[3] || "counter";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { console.log("skip: playwright not installed"); process.exit(0); }

const client = new Client({ name: "browser-test", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [process.env.PTF_MCP_ENTRY || join(here, "../src/server.mjs")],
  stderr: "ignore", env: { ...process.env, PTF_LIBRARY: lib, PTF_LEARNER: mkdtempSync(join(tmpdir(), "ptf-learner-")) } }));
const player = (await client.readResource({ uri: "ui://ptf/player.html" })).contents[0].text;
const result = await client.callTool({ name: "show_simulator", arguments: { sim: simRef, level: "highschool" } });
if (result.isError) throw new Error(result.content[0].text);

const CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "media-src 'self' data:; font-src 'self' data:; connect-src 'none'; frame-src 'none'; base-uri 'none'";
const listen = (h) => new Promise((r) => { const s = createServer(h); s.listen(0, "127.0.0.1", () => r(s)); });
const appServer = await listen((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": CSP });
  res.end(player);
});
const appUrl = `http://127.0.0.1:${appServer.address().port}/`;
const hostPage = `<!doctype html><meta charset="utf-8"><body style="margin:0">
<iframe id="app" sandbox="allow-scripts allow-same-origin" src="${appUrl}" style="width:100%;height:600px;border:0"></iframe>
<script>
window.log = { calls: [], context: [], messages: [], sizes: [] };
const RESULT = ${JSON.stringify(result).replace(/</g, "\\u003c")};
const app = document.getElementById("app");
const reply = (id, result) => app.contentWindow.postMessage({ jsonrpc: "2.0", id, result }, "*");
window.addEventListener("message", (ev) => {
  if (ev.source !== app.contentWindow) return;
  const m = ev.data;
  switch (m.method) {
    case "ui/initialize": reply(m.id, { protocolVersion: "2026-01-26", hostInfo: { name: "fake", version: "0" },
      hostCapabilities: { serverTools: {}, updateModelContext: { text: {} }, message: { text: {} } },
      hostContext: { theme: "dark", locale: "de-DE", styles: { variables: { "--color-background-primary": "#101010" } } } }); break;
    case "ui/notifications/initialized": app.contentWindow.postMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: RESULT }, "*"); break;
    case "tools/call": log.calls.push(m.params); reply(m.id, { content: [{ type: "text", text: "ok" }] }); break;
    case "ui/update-model-context": log.context.push(m.params.content[0].text); reply(m.id, {}); break;
    case "ui/message": log.messages.push(m.params.content[0].text); reply(m.id, {}); break;
    case "ui/notifications/size-changed": log.sizes.push(m.params.height); break;
  }
});
</script>`;
const hostServer = await listen((req, res) => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(hostPage); });

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
let failed = false;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failed = true; };
try {
  await page.goto(`http://127.0.0.1:${hostServer.address().port}/`);
  const appFrame = () => page.frames().find((f) => f.url() === appUrl);
  await page.waitForFunction(() => window.log.context.length > 0, null, { timeout: 10000 }).catch(() => {});
  const log = await page.evaluate(() => window.log);
  const simFrame = appFrame()?.childFrames()[0];
  check(!!simFrame, "simulator iframe was created inside the player (srcdoc under frame-src 'none')");
  const simText = simFrame ? await simFrame.evaluate(() => document.body.innerText) : "";
  check(simText.length > 20, `simulator rendered (${simText.slice(0, 60).replace(/\s+/g, " ")}…)`);
  check(log.calls.some((c) => c.name === "ptf_record_event" && c.arguments.verb === "experienced"), "experienced event sent via tools/call");
  check(log.context.some((t) => t.includes("PTF simulator")), "model context updated");
  check(log.context.some((t) => t.includes("Current view:")), "snapshot from the simulator reaches the model context");
  check(log.sizes.length > 0, "size-changed sent");
  const sandbox = await appFrame().evaluate(() => document.querySelector("iframe").getAttribute("sandbox"));
  check(sandbox === "allow-scripts", "simulator sandbox is allow-scripts only");
  await appFrame().click("#stuck");
  await page.waitForFunction(() => window.log.messages.length > 0, null, { timeout: 5000 }).catch(() => {});
  const msgs = await page.evaluate(() => window.log.messages);
  check(msgs.length === 1 && /hänge/.test(msgs[0]), `"stuck" sends a German message to the chat`);
  if (process.env.PTF_SCREENSHOT) await page.screenshot({ path: process.env.PTF_SCREENSHOT });
  check(!errors.some((e) => /Content Security Policy|Refused/.test(e)), `no CSP violations${errors.length ? ": " + errors.join(" | ") : ""}`);
} finally {
  await browser.close(); appServer.close(); hostServer.close(); await client.close();
}
process.exit(failed ? 1 : 0);
