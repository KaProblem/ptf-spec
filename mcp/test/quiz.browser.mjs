#!/usr/bin/env node
// Browser test of the MCP App quiz: a fake MCP Apps host embeds the quiz page
// from a second origin under a strict CSP, sends it real show_question results,
// answers them and checks what reaches tools/call and the chat.
//
//   node test/quiz.browser.mjs
//   PTF_SCREENSHOT=out.png ... also saves a screenshot of the multiple-choice card
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

const client = new Client({ name: "quiz-test", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [process.env.PTF_MCP_ENTRY || join(here, "../src/server.mjs")],
  stderr: "ignore", env: { ...process.env, PTF_LIBRARY: lib, PTF_LEARNER: mkdtempSync(join(tmpdir(), "ptf-learner-")) } }));
const quiz = (await client.readResource({ uri: "ui://ptf/quiz.html" })).contents[0].text;
const show = async (args) => {
  const r = await client.callTool({ name: "show_question", arguments: args });
  if (r.isError) throw new Error(r.content[0].text);
  return r;
};
const choice = await show({ element: "ptf:el/demo/counting", question_id: "q2" });
const freeText = await show({ question: { kind: "free_text", id: "why", level: "child", question: "Why do we count?", explanation: "To know how many." } });

const CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "connect-src 'none'; frame-src 'none'; base-uri 'none'";
const listen = (h) => new Promise((r) => { const s = createServer(h); s.listen(0, "127.0.0.1", () => r(s)); });
const appServer = await listen((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": CSP });
  res.end(quiz);
});
const appUrl = `http://127.0.0.1:${appServer.address().port}/`;
const hostPage = (result) => `<!doctype html><meta charset="utf-8"><body style="margin:0">
<iframe id="app" sandbox="allow-scripts allow-same-origin" src="${appUrl}" style="width:100%;height:600px;border:0"></iframe>
<script>
window.log = { calls: [], messages: [], sizes: [] };
const RESULT = ${JSON.stringify(result).replace(/</g, "\\u003c")};
const app = document.getElementById("app");
const reply = (id, result) => app.contentWindow.postMessage({ jsonrpc: "2.0", id, result }, "*");
window.addEventListener("message", (ev) => {
  if (ev.source !== app.contentWindow) return;
  const m = ev.data;
  switch (m.method) {
    case "ui/initialize": reply(m.id, { protocolVersion: "2026-01-26", hostInfo: { name: "fake", version: "0" },
      hostCapabilities: { serverTools: {}, message: { text: {} } }, hostContext: { theme: "light", locale: "de-DE" } }); break;
    case "ui/notifications/initialized": app.contentWindow.postMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: RESULT }, "*"); break;
    case "tools/call": log.calls.push(m.params); reply(m.id, { content: [{ type: "text", text: "ok" }] }); break;
    case "ui/message": log.messages.push(m.params.content[0].text); reply(m.id, {}); break;
    case "ui/notifications/size-changed": log.sizes.push(m.params.height); break;
  }
});
</script>`;
let current = null;
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
try {
  // multiple choice: pick the wrong answer "8"
  current = choice;
  await page.goto(hostUrl);
  await page.waitForTimeout(300);
  await appFrame().waitForSelector(".opt", { timeout: 5000 });
  check((await appFrame().locator(".opt").count()) === 3, "multiple choice shows three options");
  check(/Wähle eine Antwort/.test(await appFrame().locator("#hint").innerText()), "chrome texts follow the German host locale");
  await appFrame().locator(".opt", { hasText: /^8$/ }).click();
  await appFrame().click("button.primary");
  await waitFor(() => window.log.messages.length > 0);
  let log = await page.evaluate(() => window.log);
  const rec = log.calls.find((c) => c.name === "ptf_record_event");
  check(rec && rec.arguments.object === "ptf:el/demo/counting#q2" && rec.arguments.result.correct === false &&
    rec.arguments.result.misconception === "counting-skips" && rec.arguments.via === "quiz", "wrong answer recorded with its misconception");
  check(log.messages.length === 1 && /Meine Antwort .*: 8 \(falsch\)/.test(log.messages[0]), `answer sent to the chat (${log.messages[0]})`);
  check(/every number comes exactly once/i.test(await appFrame().locator(".opt.wrong").innerText()), "feedback of the picked option is shown");
  check((await appFrame().locator(".opt.right").count()) === 1, "correct option is marked");
  check(/always one more/.test(await appFrame().locator(".explain").innerText()), "explanation is shown");
  check(log.sizes.length > 0, "size-changed sent");
  if (process.env.PTF_SCREENSHOT) await page.screenshot({ path: process.env.PTF_SCREENSHOT });

  // free text: answer goes to the chat, nothing is recorded by the card
  current = freeText;
  await page.goto(hostUrl);
  await page.waitForTimeout(300);
  await appFrame().waitForSelector("textarea", { timeout: 5000 });
  check(await appFrame().locator("button.primary").isDisabled(), "send is disabled while the answer is empty");
  await appFrame().fill("textarea", "Damit wir wissen, wie viele es sind.");
  await appFrame().click("button.primary");
  await waitFor(() => window.log.messages.length > 0);
  log = await page.evaluate(() => window.log);
  check(log.messages.length === 1 && /wie viele es sind/.test(log.messages[0]), "free-text answer sent to the chat");
  check(!log.calls.some((c) => c.name === "ptf_record_event"), "free text is graded by the tutor, not recorded by the card");
  check(!errors.some((e) => /Content Security Policy|Refused/.test(e)), `no CSP violations${errors.length ? ": " + errors.join(" | ") : ""}`);
} finally {
  await browser.close(); appServer.close(); hostServer.close(); await client.close();
}
process.exit(failed ? 1 : 0);
