#!/usr/bin/env node
// Browser test of audio in the quiz card (SPEC.md §6.9): a fake MCP Apps host embeds the card under
// the default MCP Apps CSP (media only from data:), answers ptf_media_source with the real server's
// result, plays a listening set within its play limit and checks what reaches the chat.
//
//   node test/media.browser.mjs
//   PTF_SCREENSHOT_DIR=dir ... also saves the listening card at phone width, light and dark
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

const client = new Client({ name: "media-test", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [process.env.PTF_MCP_ENTRY || join(here, "../src/server.mjs")],
  stderr: "ignore", env: { ...process.env, PTF_LIBRARY: lib, PTF_LEARNER: mkdtempSync(join(tmpdir(), "ptf-learner-")) } }));
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(r.content[0].text);
  return r;
};
const quiz = (await client.readResource({ uri: "ui://ptf/quiz.html" })).contents[0].text;
const set = await call("show_question", { element: "ptf:el/demo/counting", question_ids: ["q5", "q6"] });
const alone = await call("show_media", { element: "ptf:el/demo/counting", media: "sam-apples" });
const source = await call("ptf_media_source", { element: "ptf:el/demo/counting", media: "sam-apples" });
await client.close();

// The MCP Apps default CSP: no network, media only from the page itself or data: URLs.
const CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "media-src 'self' data:; connect-src 'none'; frame-src 'none'; base-uri 'none'";
const listen = (h) => new Promise((r) => { const s = createServer(h); s.listen(0, "127.0.0.1", () => r(s)); });
const appServer = await listen((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": CSP });
  res.end(quiz);
});
const appUrl = `http://127.0.0.1:${appServer.address().port}/`;
let current = null, theme = "light";
const hostPage = () => `<!doctype html><meta charset="utf-8"><body style="margin:0;background:${theme === "dark" ? "#111" : "#fff"}">
<iframe id="app" sandbox="allow-scripts allow-same-origin" src="${appUrl}" style="width:100%;height:900px;border:0"></iframe>
<script>
window.log = { calls: [], messages: [] };
const RESULT = ${JSON.stringify(current).replace(/</g, "\\u003c")};
const SOURCE = ${JSON.stringify(source).replace(/</g, "\\u003c")};
const app = document.getElementById("app");
const reply = (id, result) => app.contentWindow.postMessage({ jsonrpc: "2.0", id, result }, "*");
window.addEventListener("message", (ev) => {
  if (ev.source !== app.contentWindow) return;
  const m = ev.data;
  switch (m.method) {
    case "ui/initialize": reply(m.id, { protocolVersion: "2026-01-26", hostInfo: { name: "fake", version: "0" },
      hostCapabilities: { serverTools: {}, message: { text: {} } }, hostContext: { theme: "${theme}", locale: "en-GB" } }); break;
    case "ui/notifications/initialized": app.contentWindow.postMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: RESULT }, "*"); break;
    case "tools/call": log.calls.push(m.params); reply(m.id, m.params.name === "ptf_media_source" ? SOURCE : { content: [{ type: "text", text: "ok" }] }); break;
    case "ui/message": log.messages.push(m.params.content[0].text); reply(m.id, {}); break;
  }
});
</script>`;
const hostServer = await listen((req, res) => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(hostPage()); });
const hostUrl = `http://127.0.0.1:${hostServer.address().port}/`;

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
let failed = false;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failed = true; };
const appFrame = () => page.frames().find((f) => f.url() === appUrl);
const open = async (result) => {
  current = result;
  await page.goto(hostUrl);
  await page.waitForTimeout(300);
  await appFrame().waitForSelector(".media button.primary:not([disabled])", { timeout: 5000 });
};
// Plays to the end, four times faster so the test stays short.
const playThrough = async () => {
  await appFrame().locator(".media button.primary").click();
  await appFrame().evaluate(() => { document.querySelector("audio, video").playbackRate = 4; });
  await appFrame().waitForFunction(() => document.querySelector("audio, video").ended, null, { timeout: 15000 });
  await page.waitForTimeout(100);
};
try {
  await open(set);
  const f = appFrame();
  check(/listening/i.test(await f.locator(".badge").innerText()), "badge says Listening");
  check((await f.locator(".item").count()) === 2, "both questions of the set are in one card");
  check(/Answer all 2 questions/.test(await f.locator("#hint").innerText()), "hint asks for all questions");
  check(await f.evaluate(() => document.querySelector("audio").src.startsWith("data:audio/mpeg;base64,")), "audio loaded as a data: URL through ptf_media_source");
  check((await f.locator(".media .hint").innerText()) === "2 plays left", "shows two plays left");
  check((await f.locator("button.ghost", { hasText: "Slower" }).count()) === 0, "no slower button when plays are limited");
  check(!/Sam is hungry/.test(await f.locator("main").innerText()), "transcript hidden before the answers");
  await playThrough();
  check((await f.locator(".media .hint").innerText()) === "1 play left", "one play left after the first");
  await playThrough();
  check((await f.locator(".media .hint").innerText()) === "No plays left" && await f.locator(".media button.primary").isDisabled(), "play button off after two plays");

  await f.locator(".item").nth(0).locator(".opt", { hasText: /^4$/ }).click();
  await f.locator(".item").nth(0).locator("button.primary").click();
  let log = await page.evaluate(() => window.log);
  check(log.messages.length === 0, "no message after the first of two answers");
  check(!/Sam is hungry/.test(await f.locator("main").innerText()), "transcript still hidden after one answer");
  await f.locator(".item").nth(1).locator(".opt", { hasText: "Sam's dad" }).click();
  await f.locator(".item").nth(1).locator("button.primary").click();
  await page.waitForFunction(() => window.log.messages.length > 0, null, { timeout: 3000 }).catch(() => {});
  log = await page.evaluate(() => window.log);
  check(log.messages.length === 1 && /My answers to “Sam's apples” \(2 questions\):\n1\. .*: 4 \(correct\)\n2\. .*: Sam's dad \(wrong\)/.test(log.messages[0]),
    `one message with both answers (${JSON.stringify(log.messages[0])})`);
  const recs = log.calls.filter((c) => c.name === "ptf_record_event").map((c) => `${c.arguments.object} ${c.arguments.result.correct}`);
  check(recs.join() === "ptf:el/demo/counting#q5 true,ptf:el/demo/counting#q6 false", `each answer recorded under its own object (${recs.join()})`);
  check(/Sam is hungry/.test(await f.locator(".transcript").innerText()), "transcript shown once all are answered");

  if (process.env.PTF_SCREENSHOT_DIR) {
    await page.setViewportSize({ width: 390, height: 900 });
    for (const th of ["light", "dark"]) {
      theme = th;
      await open(set);
      await appFrame().locator(".item").nth(0).locator(".opt", { hasText: /^4$/ }).click();
      await appFrame().locator(".item").nth(0).locator("button.primary").click();
      await page.screenshot({ path: join(process.env.PTF_SCREENSHOT_DIR, `listening-${th}.png`) });
    }
    theme = "light";
    await page.setViewportSize({ width: 1280, height: 900 });
  }

  // show_media: no questions, unlimited plays, transcript on request after listening once
  await open(alone);
  const g = appFrame();
  check((await g.locator(".item").count()) === 0 && (await g.locator(".media").count()) === 1, "show_media shows only the player");
  check((await g.locator("button.ghost", { hasText: "Slower" }).count()) === 1, "slower button offered without a play limit");
  check((await g.locator("button.ghost", { hasText: "Show transcript" }).count()) === 0, "no transcript button before listening");
  await playThrough();
  log = await page.evaluate(() => window.log);
  const exp = log.calls.find((c) => c.name === "ptf_record_event");
  check(exp && exp.arguments.verb === "experienced" && exp.arguments.object === "ptf:el/demo/counting#media:sam-apples" && exp.arguments.via === "media",
    "listening once is recorded as experienced");
  check(log.messages.length === 1 && /I have listened to “Sam's apples”/.test(log.messages[0]), "tutor is told the learner listened");
  await g.locator("button.ghost", { hasText: "Show transcript" }).click();
  check(/Sam is hungry/.test(await g.locator(".transcript").innerText()), "transcript shown on request");
  check(!/Media|media/.test(await g.locator(".media .hint").innerText()), "no media error");
  check(errors.length === 0, `no console errors (${errors.join(" | ")})`);
} catch (e) {
  check(false, e.stack);
} finally {
  await browser.close();
  appServer.close();
  hostServer.close();
}
process.exit(failed ? 1 : 0);
