// End-to-end: start the server over stdio against the example library and call its tools.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = new URL(".", import.meta.url).pathname;
const LIB = resolve(here, "../../examples/minimal-library");
const entry = process.env.PTF_MCP_ENTRY || resolve(here, "../src/server.mjs");
const learnerDir = mkdtempSync(join(tmpdir(), "ptf-learner-"));
const workspaceDir = mkdtempSync(join(tmpdir(), "ptf-workspace-"));
let client;

before(async () => {
  client = new Client({ name: "test", version: "0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [entry], stderr: "ignore",
    env: { ...process.env, PTF_LIBRARY: LIB, PTF_LEARNER: learnerDir, PTF_WORKSPACE: workspaceDir },
  }));
});
after(() => client?.close());

const json = (r) => JSON.parse(r.content[0].text);

test("lists tools with the UI link on show_simulator", async () => {
  const { tools } = await client.listTools();
  const show = tools.find((t) => t.name === "show_simulator");
  assert.equal(show._meta.ui.resourceUri, "ui://ptf/player.html");
  assert.deepEqual(tools.find((t) => t.name === "ptf_record_event")._meta.ui.visibility, ["app"]);
});

test("serves the player as an MCP App resource with the host runtime inlined", async () => {
  const r = await client.readResource({ uri: "ui://ptf/player.html" });
  assert.equal(r.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.match(r.contents[0].text, /PTFHost/);
  assert.doesNotMatch(r.contents[0].text, /PTF_HOST_RUNTIME/);
});

test("lists, searches and reads library content", async () => {
  const o = json(await client.callTool({ name: "list_library", arguments: {} }));
  assert.equal(o.bundles[0].id, "demo");
  assert.ok(o.simulators.some((s) => s.id === "ptf:sim/counter"));
  const hits = json(await client.callTool({ name: "search_library", arguments: { query: "count" } }));
  assert.ok(hits.length > 0);
  const el = o.bundles[0].elements[0].id;
  const md = (await client.callTool({ name: "get_element", arguments: { id: el } })).content[0].text;
  assert.match(md, /# Core/);
});

test("show_simulator returns launch data and inlined, verified HTML", async () => {
  const r = await client.callTool({ name: "show_simulator", arguments: { sim: "counter" } });
  assert.ok(!r.isError, r.content[0].text);
  assert.equal(r.structuredContent.sim.id, "ptf:sim/counter");
  assert.match(r._meta["ptf/html"], /PTF\.connect/);
  assert.doesNotMatch(r._meta["ptf/html"], /src="ptf-sim\.js"/);
  const bad = await client.callTool({ name: "show_simulator", arguments: { sim: "nope" } });
  assert.ok(bad.isError);
});

test("reads code labs and copies them into the workspace without overwriting", async () => {
  const o = json(await client.callTool({ name: "list_library", arguments: {} }));
  assert.ok(o.code_labs.some((l) => l.id === "ptf:code/counting"));
  const lab = json(await client.callTool({ name: "get_code_lab", arguments: { lab: "ptf:code/counting@^1.0.0", step: "count" } }));
  assert.equal(lab.steps.length, 2);
  assert.match(lab.source.text, /counted to/);
  const copied = json(await client.callTool({ name: "copy_code_lab", arguments: { lab: "counting", element: "ptf:el/demo/counting" } }));
  assert.equal(copied.path, join(workspaceDir, "counting"));
  assert.ok(existsSync(join(copied.path, "steps/01_count.py")));
  const again = await client.callTool({ name: "copy_code_lab", arguments: { lab: "counting" } });
  assert.ok(again.isError);
  assert.match(again.content[0].text, /already exists/);
});

test("show_question serves library questions and validates ad-hoc ones", async () => {
  const { tools } = await client.listTools();
  assert.equal(tools.find((t) => t.name === "show_question")._meta.ui.resourceUri, "ui://ptf/quiz.html");
  const quiz = await client.readResource({ uri: "ui://ptf/quiz.html" });
  assert.equal(quiz.contents[0].mimeType, "text/html;profile=mcp-app");

  const r = await client.callTool({ name: "show_question", arguments: { element: "ptf:el/demo/counting", question_id: "q2" } });
  assert.ok(!r.isError, r.content[0].text);
  assert.equal(r.structuredContent.question.kind, "multiple_choice");
  assert.equal(r.structuredContent.object, "ptf:el/demo/counting#q2");

  const unsupported = await client.callTool({ name: "show_question", arguments: { element: "ptf:el/demo/counting", question_id: "q1" } });
  assert.match(unsupported.content[0].text, /cannot be shown as a card yet/);
  const missing = await client.callTool({ name: "show_question", arguments: { element: "ptf:el/demo/counting", question_id: "nope" } });
  assert.match(missing.content[0].text, /q1 \(guess_next\), q2 \(multiple_choice\)/);

  const own = await client.callTool({ name: "show_question", arguments: { question: { kind: "free_text", id: "why", level: "child",
    question: "Why do we count?", rubric: ["Mentions how many"], explanation: "To know how many things there are." } } });
  assert.ok(!own.isError, own.content[0].text);
  assert.match(own.content[0].text, /Rubric:\n- Mentions how many/);
  assert.equal(own.structuredContent.object, null);

  const bad = await client.callTool({ name: "show_question", arguments: { question: { kind: "multiple_choice", id: "x", level: "child",
    question: "?", options: [{ text: "a", correct: false, feedback: "f" }], explanation: "e" } } });
  assert.ok(bad.isError);
  assert.match(bad.content[0].text, /Not a valid PTF question block: \/options/);
});

test("records events and mastery in the learner record", async () => {
  await client.callTool({ name: "update_learner_profile", arguments: { preferred_lang: "de", interests: ["LLMs"] } });
  await client.callTool({ name: "ptf_record_event", arguments: { verb: "answered", object: "ptf:sim/counter@1.0.0#count",
    element: "ptf:el/demo/counting", result: { correct: true } } });
  const r = json(await client.callTool({ name: "record_progress", arguments: { verb: "answered",
    object: "ptf:el/demo/counting#q1", result: { correct: false, misconception: "off-by-one" } } }));
  assert.deepEqual(r.mastery.open_misconceptions, ["off-by-one"]);
  const l = json(await client.callTool({ name: "get_learner", arguments: {} }));
  assert.equal(l.profile.preferred_lang, "de");
  assert.equal(l.recent_events.length, 2);
  assert.ok(existsSync(join(learnerDir, "events.jsonl")));
  assert.match(readFileSync(join(learnerDir, "profile.md"), "utf8"), /^---\ntype: Learner Profile/);
});

test("offers the tutor prompt", async () => {
  const p = await client.getPrompt({ name: "ptf-tutor", arguments: { goal: "Zählen" } });
  assert.match(p.messages[0].content.text, /Experience first/);
});
