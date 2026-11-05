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
const guessNext = await show({ element: "ptf:el/demo/counting", question_id: "q1" });
const estimate = await show({ element: "ptf:el/demo/counting", question_id: "q3" });
const cloze = await show({ element: "ptf:el/demo/counting", question: { kind: "cloze", id: "c1", level: "child",
  text: "After 3 comes {{1}}, after 9 comes {{2}}.", gaps: [{ answer: "4", accepted: ["four"] }, { answer: "10", accepted: ["ten"] }],
  explanation: "Always one more." } });
const ordering = await show({ question: { kind: "ordering", id: "o1", level: "child", instruction: "Smallest first.",
  items: ["one", "two", "three", "four"], explanation: "Counting order." } });
const steps = await show({ question: { kind: "calculation_steps", id: "s1", level: "highschool", title: "Apples", intro: "3 bags with 4 apples, then 2 more.",
  columns: ["Step", "Expression", "Value"], rows: [["Bags", "3 · 4", "12"], ["Plus two", "12 + 2", "14 apples"]],
  result: { label: "Apples", value: "14" }, explanation: "Multiply, then add." } });
const estimateLog = await show({ question: { kind: "estimate_number", id: "e2", level: "highschool", question: "Parameters of GPT-3?",
  answer: 175000000000, tolerance: 25000000000, unit: "parameters", scale: "log", explanation: "175 billion." } });

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
  const open = async (result, selector) => {
    current = result;
    await page.goto(hostUrl);
    await page.waitForTimeout(300);
    await appFrame().waitForSelector(selector, { timeout: 5000 });
  };
  const answered = async () => {
    await waitFor(() => window.log.messages.length > 0);
    const l = await page.evaluate(() => window.log);
    return { log: l, ev: l.calls.find((c) => c.name === "ptf_record_event") };
  };
  let ev;

  // guess_next: hint, then the right answer in another case
  await open(guessNext, ".prefix input");
  await appFrame().click("button.ghost");
  check(/Add one apple/.test(await appFrame().locator(".explain").innerText()), "guess_next shows the hint on request");
  await appFrame().fill(".prefix input", " 4 ");
  await appFrame().click("button.primary");
  ({ log, ev } = await answered());
  check(ev && ev.arguments.object === "ptf:el/demo/counting#q1" && ev.arguments.result.correct === true, "guess_next checked and recorded");
  check(/4 \(Hinweis\) \(richtig\)/.test(log.messages[0]), `guess_next tells the tutor about the hint (${log.messages[0]})`);

  // estimate_number: a wrong guess with tolerance 0 keeps the misconception
  await open(estimate, "input.field");
  await appFrame().fill("input.field", "25");
  await appFrame().click("button.primary");
  ({ log, ev } = await answered());
  check(ev && ev.arguments.result.correct === false && ev.arguments.result.misconception === "counting-skips", "estimate outside the tolerance is wrong");
  check((await appFrame().locator(".scale .pin").count()) === 2, "estimate shows guess and answer on a number line");
  check(/Lösung: 26/.test(await appFrame().locator("main .hint").innerText()), "estimate shows the answer");

  // estimate_number on a log scale, German number format
  await open(estimateLog, "input.field");
  await appFrame().fill("input.field", "1,6e11");
  await appFrame().click("button.primary");
  ({ log, ev } = await answered());
  check(/\(richtig\)$/.test(log.messages[0]), `estimate reads 1,6e11 and accepts it within the tolerance (${log.messages[0]})`);
  check((await appFrame().locator(".scale .band").count()) === 1, "tolerance band drawn");

  // cloze: one accepted word, one wrong number
  await open(cloze, ".cloze input");
  const gaps = appFrame().locator(".cloze input");
  check((await gaps.count()) === 2, "cloze shows two gaps");
  await gaps.nth(0).fill("Four");
  await gaps.nth(1).fill("11");
  await appFrame().click("button.primary");
  ({ log, ev } = await answered());
  check(ev && ev.arguments.object === "ptf:el/demo/counting#c1" && ev.arguments.result.correct === false &&
    ev.arguments.result.response === "Four | 11", "cloze checks each gap and records the answers");
  check((await appFrame().locator(".cloze input.right").count()) === 1 && /10/.test(await appFrame().locator(".fix").innerText()), "cloze marks gaps and shows the right word");

  // ordering: shuffled, then moved into the right order
  await open(ordering, ".order li");
  const texts = async () => appFrame().locator(".order li .txt").allInnerTexts();
  check((await texts()).join() !== "one,two,three,four", "ordering starts shuffled");
  for (let target = 0; target < 4; target++) {
    let at = (await texts()).indexOf(["one", "two", "three", "four"][target]);
    while (at > target) { await appFrame().locator(".order li").nth(at).locator("button.move").first().click(); at--; }
  }
  await appFrame().click("button.primary");
  ({ log, ev } = await answered());
  check(ev === undefined && log.messages.length === 1 && /one → two → three → four \(richtig\)/.test(log.messages[0]),
    `ordering checked; own question without element is not recorded by the card (${log.messages[0]})`);
  check((await appFrame().locator(".order li.right").count()) === 4, "ordering marks every position");

  // calculation_steps: first step right, second shown
  await open(steps, ".step input");
  await appFrame().fill(".step input", "12");
  await appFrame().locator(".step button.primary").click();
  await appFrame().waitForSelector(".step:nth-child(2) input", { timeout: 2000 });
  await appFrame().locator(".step").nth(1).locator("button.ghost").click();
  ({ log, ev } = await answered());
  check(/1 von 2 Schritten richtig/.test(log.messages[0]), `calculation_steps counts the steps (${log.messages[0]})`);
  check(/Apples: 14/.test(await appFrame().locator(".total").innerText()), "calculation_steps shows the result");
  // PTF_SCREENSHOT_DIR=dir saves each new card answered, at phone width
  if (process.env.PTF_SCREENSHOT_DIR) {
    await page.setViewportSize({ width: 390, height: 640 });
    for (const [name, r, sel, answer] of [["cloze", cloze, ".cloze input", "4"], ["ordering", ordering, ".order li", null],
      ["estimate", estimateLog, "input.field", "3e11"], ["steps", steps, ".step input", "12"], ["guess", guessNext, ".prefix input", "5"]]) {
      await open(r, sel);
      if (answer) await appFrame().locator(sel).first().fill(answer);
      await appFrame().locator("button.primary").first().click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${process.env.PTF_SCREENSHOT_DIR}/${name}.png` });
    }
  }

  check(!errors.some((e) => /Content Security Policy|Refused/.test(e)), `no CSP violations${errors.length ? ": " + errors.join(" | ") : ""}`);
} finally {
  await browser.close(); appServer.close(); hostServer.close(); await client.close();
}
process.exit(failed ? 1 : 0);
