#!/usr/bin/env node
// Browser test of the MCP App figure card: a fake MCP Apps host embeds the card from a second
// origin under a strict CSP, sends it real show_figure results, steps through them and checks
// what reaches tools/call and the model context, and that the sanitizer drops anything active.
//
//   node test/figure.browser.mjs
//   PTF_SCREENSHOT_DIR=dir ... also saves the card at phone width, light and dark
// Needs Playwright with Chromium.

import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = new URL(".", import.meta.url).pathname;
const lib = resolve(join(here, "../../examples/minimal-library"));
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { console.log("skip: playwright not installed"); process.exit(0); }

const client = new Client({ name: "figure-test", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [process.env.PTF_MCP_ENTRY || join(here, "../src/server.mjs")],
  stderr: "ignore", env: { ...process.env, PTF_LIBRARY: lib, PTF_LEARNER: mkdtempSync(join(tmpdir(), "ptf-learner-")) } }));
const card = (await client.readResource({ uri: "ui://ptf/figure.html" })).contents[0].text;
const show = async (args) => {
  const r = await client.callTool({ name: "show_figure", arguments: args });
  if (r.isError) throw new Error(r.content[0].text);
  return r;
};
const de = await show({ element: "ptf:el/demo/counting", figure: "count-apples", lang: "de" });
const en = await show({ element: "ptf:el/demo/counting", figure: "count-apples", lang: "en" });
const SOURCE = en._meta["ptf/svg"];
const noMeta = { content: en.content, structuredContent: en.structuredContent };
const evil = { ...en, _meta: { "ptf/svg": SOURCE
  .replace('<g data-step="1"', '<script>window.parent.pwned = 1</script><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">html</div></foreignObject>' +
    '<image href="https://example.org/x.png" width="10" height="10"/><a href="https://example.org"><text>link</text></a><g data-step="1"')
  .replace('<circle class="s-warn f-warn-soft w2"', '<circle onload="window.parent.pwned = 2" style="fill:red" fill="url(https://example.org/x)" class="s-warn f-warn-soft w2"') } };

const CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "connect-src 'none'; frame-src 'none'; base-uri 'none'";
const listen = (h) => new Promise((r) => { const s = createServer(h); s.listen(0, "127.0.0.1", () => r(s)); });
const appServer = await listen((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": CSP });
  res.end(card);
});
const appUrl = `http://127.0.0.1:${appServer.address().port}/`;
let current = null;
let theme = "light";
const hostPage = (result) => `<!doctype html><meta charset="utf-8"><body style="margin:0">
<iframe id="app" sandbox="allow-scripts allow-same-origin" src="${appUrl}" style="width:100%;height:640px;border:0"></iframe>
<script>
window.log = { calls: [], context: [], sizes: [] };
const RESULT = ${JSON.stringify(result).replace(/</g, "\\u003c")};
const SOURCE = ${JSON.stringify(SOURCE).replace(/</g, "\\u003c")};
const app = document.getElementById("app");
const reply = (id, result) => app.contentWindow.postMessage({ jsonrpc: "2.0", id, result }, "*");
window.addEventListener("message", (ev) => {
  if (ev.source !== app.contentWindow) return;
  const m = ev.data;
  switch (m.method) {
    case "ui/initialize": reply(m.id, { protocolVersion: "2026-01-26", hostInfo: { name: "fake", version: "0" },
      hostCapabilities: { serverTools: {}, updateModelContext: { text: {} } }, hostContext: { theme: "${theme}", locale: "de-DE" } }); break;
    case "ui/notifications/initialized": app.contentWindow.postMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: RESULT }, "*"); break;
    case "tools/call": log.calls.push(m.params);
      reply(m.id, m.params.name === "ptf_figure_source" ? { content: [{ type: "text", text: "ok" }], structuredContent: { svg: SOURCE } }
        : { content: [{ type: "text", text: "ok" }] }); break;
    case "ui/update-model-context": log.context.push(m.params.content[0].text); reply(m.id, {}); break;
    case "ui/notifications/size-changed": log.sizes.push(m.params.height); break;
  }
});
</script>`;
const hostServer = await listen((req, res) => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(hostPage(current)); });
const hostUrl = `http://127.0.0.1:${hostServer.address().port}/`;

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
let failed = false;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failed = true; };
const appFrame = () => page.frames().find((f) => f.url() === appUrl);
const waitFor = (fn) => page.waitForFunction(fn, null, { timeout: 5000 }).catch(() => {});
const open = async (result) => {
  current = result;
  await page.goto(hostUrl);
  await page.waitForTimeout(300);
  await appFrame().waitForSelector("#stage svg", { timeout: 5000 });
};
const hidden = () => appFrame().evaluate(() => [...document.querySelectorAll("g[data-step]")].map((g) => g.classList.contains("ptf-hidden")));
try {
  // German labels, stepping through
  await open(de);
  check(/Äpfel zählen/.test(await appFrame().locator("#title").innerText()), "title from the German translation");
  check(await appFrame().locator("#back").innerText() === "Zurück", "chrome texts follow the German host locale");
  check(/Drei Äpfel/.test(await appFrame().locator("#caption").innerText()), "caption of step 1");
  check(JSON.stringify(await hidden()) === "[false,true,true]", "only step 1 visible");
  check(await appFrame().locator("#back").isDisabled(), "back is disabled at step 1");
  await appFrame().click("#next");
  check(JSON.stringify(await hidden()) === "[false,false,true]", "next reveals step 2");
  check((await appFrame().locator("#count").innerText()) === "2 / 3", "counter shows 2 / 3");
  await appFrame().click("#all");
  await waitFor(() => window.log.calls.length > 0);
  let log = await page.evaluate(() => window.log);
  check(JSON.stringify(await hidden()) === "[false,false,false]", "show all reveals every step");
  const rec = log.calls.find((c) => c.name === "ptf_record_event");
  check(rec && rec.arguments.verb === "experienced" && rec.arguments.object === "ptf:el/demo/counting#figure:count-apples" &&
    rec.arguments.via === "figure", "seeing every step is recorded once as experienced");
  check(log.context.some((c) => /step 2 of 3/.test(c)) && log.context.some((c) => /seen all 3 steps/.test(c)), "the tutor learns the step the learner is on");
  await appFrame().click("#back");
  await page.waitForTimeout(100);
  log = await page.evaluate(() => window.log);
  check(log.calls.filter((c) => c.name === "ptf_record_event").length === 1, "going back does not record again");
  check(/Äpfel/.test(await appFrame().locator("#desc").textContent()), "description available under the figure");
  check(log.sizes.length > 0, "size-changed sent");

  // no _meta: the card fetches the SVG with the app-only tool
  await open(noMeta);
  log = await page.evaluate(() => window.log);
  check(log.calls.some((c) => c.name === "ptf_figure_source" && c.arguments.figure === "count-apples"), "fetches the SVG when the host drops _meta");

  // the sanitizer keeps only the figure format
  await open(evil);
  await page.waitForTimeout(200);
  const leftovers = await appFrame().evaluate(() => ({
    script: document.querySelectorAll("#stage script, #stage foreignObject, #stage image, #stage a").length,
    attrs: document.querySelectorAll("#stage [onload], #stage [style]").length,
    url: [...document.querySelectorAll("#stage [fill]")].filter((e) => /url/.test(e.getAttribute("fill"))).length,
    circles: document.querySelectorAll("#stage circle").length,
  }));
  check(leftovers.script === 0 && leftovers.attrs === 0 && leftovers.url === 0, `scripts, HTML, images, links, handlers and styles are dropped (${JSON.stringify(leftovers)})`);
  check(leftovers.circles === 4, "the figure itself survives");
  check(await page.evaluate(() => window.pwned === undefined), "nothing from the figure ran");

  if (process.env.PTF_SCREENSHOT_DIR) {
    await page.setViewportSize({ width: 360, height: 640 });
    for (const th of ["light", "dark"]) {
      theme = th;
      await open(de);
      await appFrame().click("#next");
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${process.env.PTF_SCREENSHOT_DIR}/figure-card-${th}.png` });
    }
  }

  check(!errors.some((e) => /Content Security Policy|Refused/.test(e)), `no CSP violations${errors.length ? ": " + errors.join(" | ") : ""}`);
} finally {
  await browser.close(); appServer.close(); hostServer.close(); await client.close();
}
process.exit(failed ? 1 : 0);
