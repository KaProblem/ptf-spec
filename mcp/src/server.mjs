#!/usr/bin/env node
// ptf-mcp: a local MCP server (stdio) for the Personal Tutor Format.
//
// Serves a PTF library from disk, shows simulators as MCP Apps and keeps the
// learner record on this device. Nothing leaves the machine except the git
// fetch of the public library.
//
// Environment:
//   PTF_LIBRARY      library directory (default ~/.ptf/library, cloned on first start)
//   PTF_LIBRARY_URL  git URL to clone from (default https://github.com/KaProblem/ptf-library.git)
//   PTF_LEARNER      learner record directory (default ~/.ptf/learner)

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import Ajv2020 from "ajv/dist/2020.js";
import * as z from "zod";
import { PLAYER_HTML, QUESTION_SCHEMA, QUIZ_HTML, TUTOR_GUIDE, VERSION } from "./assets.mjs";
import { LearnerRecord } from "./learner.mjs";
import { Library, onlyLevel, parseSimRef } from "./library.mjs";

const PLAYER_URI = "ui://ptf/player.html";
const QUIZ_URI = "ui://ptf/quiz.html";
const APP_MIME = "text/html;profile=mcp-app";
const DEFAULT_URL = "https://github.com/KaProblem/ptf-library.git";
const LEVEL = z.string().regex(/^[a-z][a-z0-9-]*$/).describe("Level ID: child, highschool, college, expert or a bundle's custom level");

const ptfHome = join(homedir(), ".ptf");
const libraryDir = resolve(process.env.PTF_LIBRARY || join(ptfHome, "library"));
const learnerDir = resolve(process.env.PTF_LEARNER || join(ptfHome, "learner"));
const libraryUrl = process.env.PTF_LIBRARY_URL || DEFAULT_URL;

const log = (...a) => console.error("[ptf-mcp]", ...a);   // stdout belongs to the protocol

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000 }).trim();
}

function ensureLibrary() {
  if (existsSync(libraryDir)) return;
  if (process.env.PTF_LIBRARY) throw new Error(`PTF_LIBRARY points to ${libraryDir}, which does not exist.`);
  mkdirSync(dirname(libraryDir), { recursive: true });
  log(`cloning ${libraryUrl} into ${libraryDir}`);
  git(["clone", "--depth", "1", libraryUrl, libraryDir]);
}

function libraryVersion() {
  try { return git(["rev-parse", "--short", "HEAD"], libraryDir); } catch { return null; }
}

let library = null;
let libraryError = null;
try { ensureLibrary(); library = new Library(libraryDir); }
catch (e) { libraryError = e.message; log(e.message); }
const learner = new LearnerRecord(learnerDir);

function lib() {
  if (!library) throw new Error(`No PTF library available (${libraryError}). Install git, or set PTF_LIBRARY to a local checkout of ptf-library.`);
  return library;
}

const text = (t) => ({ type: "text", text: typeof t === "string" ? t : JSON.stringify(t, null, 2) });
const ok = (data, extra = {}) => ({ content: [text(data)], ...extra });
function guarded(fn) {
  return async (args) => {
    try { return await fn(args ?? {}); }
    catch (e) { return { isError: true, content: [text(e.message)] }; }
  };
}

const server = new McpServer({ name: "ptf", version: VERSION }, {
  instructions: "Personal Tutor Format (PTF) tutor tools. Use them to teach the learner from the local PTF library: " +
    "read the learner record first, pick a learning path or element, start each step with something to try (show_simulator), " +
    "explain at the learner's level, ask questions, and record progress. Load the `ptf-tutor` prompt for the full teaching method. " +
    "Never teach goals that would harm people (e.g. becoming an extremist), even if asked.",
});

// ---------- UI resource ----------

server.registerResource("ptf-player", PLAYER_URI, {
  title: "PTF simulator player",
  description: "Hosts a PTF simulator in a sandboxed iframe and speaks the PTF host contract.",
  mimeType: APP_MIME,
  _meta: { ui: { prefersBorder: false } },
}, async (uri) => ({ contents: [{ uri: uri.href, mimeType: APP_MIME, text: PLAYER_HTML, _meta: { ui: { prefersBorder: false } } }] }));

server.registerResource("ptf-quiz", QUIZ_URI, {
  title: "PTF quiz",
  description: "Renders one PTF question block (SPEC.md §7) and checks the learner's answer.",
  mimeType: APP_MIME,
  _meta: { ui: { prefersBorder: false } },
}, async (uri) => ({ contents: [{ uri: uri.href, mimeType: APP_MIME, text: QUIZ_HTML, _meta: { ui: { prefersBorder: false } } }] }));

// ---------- library ----------

server.registerTool("list_library", {
  title: "List the PTF library",
  description: "Bundles, learning paths, learning elements and simulators in the local PTF library.",
  inputSchema: {},
  annotations: { readOnlyHint: true },
}, guarded(async () => ok({ library: libraryDir, source: libraryUrl, commit: libraryVersion(), ...lib().overview() })));

server.registerTool("search_library", {
  title: "Search the PTF library",
  description: "Full-text search over learning elements, paths and simulators. Use it to find material for the learner's goal.",
  inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(50).optional() },
  annotations: { readOnlyHint: true },
}, guarded(async ({ query, limit }) => ok(lib().search(query, limit))));

server.registerTool("get_element", {
  title: "Read a learning element",
  description: "Returns a learning element (ptf:el/<bundle>/<name>) or learning path (ptf:path/<bundle>/<name>) as Markdown with frontmatter. " +
    "Core, Key facts and Misconceptions are the ground truth for teaching; level texts are optional starting points. " +
    "Pass `level` to drop the level texts for other levels.",
  inputSchema: { id: z.string().regex(/^ptf:(el|path)\//), level: LEVEL.optional() },
  annotations: { readOnlyHint: true },
}, guarded(async ({ id, level }) => {
  const d = lib().doc(id);
  if (!d) throw new Error(`Unknown ID ${id}. Use search_library or list_library.`);
  const raw = readFileSync(d.file, "utf8");
  const head = raw.slice(0, raw.length - d.body.length);
  return ok(head + (level ? onlyLevel(d.body, level) : d.body));
}));

server.registerTool("sync_library", {
  title: "Update the PTF library",
  description: "Pulls the latest version of the library from its git remote.",
  inputSchema: {},
}, guarded(async () => {
  const before = libraryVersion();
  git(["pull", "--ff-only"], libraryDir);
  lib().reload();
  return ok({ before, after: libraryVersion() });
}));

// ---------- questions ----------

// Kinds the quiz UI can render. The others are valid PTF but are asked in the chat for now.
const QUIZ_KINDS = ["multiple_choice", "free_text"];
const validQuestion = new Ajv2020({ allErrors: true, strict: false }).compile(QUESTION_SCHEMA);

function questionErrors(q) {
  if (validQuestion(q)) return [];
  // oneOf reports every branch; keep the errors of the branch for the given kind.
  const kinds = QUESTION_SCHEMA.oneOf.map((b) => b.properties.kind.const);
  const branch = kinds.indexOf(q?.kind);
  if (branch < 0) return [`kind must be one of ${kinds.join(", ")}`];
  return (validQuestion.errors ?? []).filter((e) => e.schemaPath.startsWith(`#/oneOf/${branch}/`))
    .map((e) => `${e.instancePath || "question"} ${e.message}`);
}

server.registerTool("show_question", {
  title: "Show a quiz question",
  description: "Shows one question to the learner as an interactive card inline in the chat, instead of asking it in plain text. " +
    "Either take a question from a learning element (`element` + `question_id`, from its # Questions section) or write your own " +
    "`question` as a PTF question block (SPEC.md §7, schema question-block.schema.json). Kinds shown as a card: " + QUIZ_KINDS.join(", ") + ". " +
    "The card checks multiple_choice itself; for free_text you grade the answer with the rubric. The learner's answer arrives as their next message.",
  inputSchema: {
    element: z.string().regex(/^ptf:el\//).optional().describe("Learning element the question belongs to; answers count towards its mastery"),
    question_id: z.string().optional().describe("ID of a question block in the element"),
    question: z.record(z.string(), z.unknown()).optional().describe("A question block you wrote, e.g. {kind: multiple_choice, id, level, question, options[{text, correct, feedback}], explanation}"),
  },
  _meta: { ui: { resourceUri: QUIZ_URI }, "ui/resourceUri": QUIZ_URI },
}, guarded(async ({ element, question_id, question }) => {
  if (!question === !question_id) throw new Error("Pass either question_id (with element) or question.");
  let q = question;
  let lang = null;
  if (element) {
    const d = lib().doc(element);
    if (!d) throw new Error(`Unknown element ${element}.`);
    lang = d.meta.lang ?? null;
  }
  if (question_id) {
    if (!element) throw new Error("question_id needs element.");
    const all = lib().questions(element);
    q = all.find((x) => x.id === question_id);
    if (!q) throw new Error(`Element ${element} has no question ${question_id}. Questions: ${all.map((x) => `${x.id} (${x.kind})`).join(", ") || "none"}`);
  }
  const errors = questionErrors(q);
  if (errors.length) throw new Error(`Not a valid PTF question block: ${errors.join("; ")}`);
  if (!QUIZ_KINDS.includes(q.kind)) throw new Error(`Kind ${q.kind} cannot be shown as a card yet (${QUIZ_KINDS.join(", ")}). Ask it in the chat.`);
  const object = element ? `${element}#${q.id}` : null;
  const lines = [`Showing question ${q.id} (${q.kind}) to the learner. Do not give away the answer; wait for their reply.`];
  if (q.kind === "multiple_choice") {
    lines.push("The card checks the answer, shows the feedback and the explanation" + (object ? `, and records it as ${object}.` : "."),
      "Then talk about the answer: why it is right or which misconception it shows.");
  } else {
    lines.push("Grade the answer the learner sends against this rubric, give short feedback, then show or summarise the sample answer if it helps.");
    if (q.rubric?.length) lines.push(`Rubric:\n${q.rubric.map((r) => `- ${r}`).join("\n")}`);
    if (q.sample_answer) lines.push(`Sample answer: ${q.sample_answer}`);
    if (object) lines.push(`Then call record_progress with verb answered, object ${object} and result.score (0 to 1).`);
  }
  return { content: [text(lines.join("\n"))], structuredContent: { question: q, element: element ?? null, object, lang } };
}));

// ---------- simulators ----------

function simInfo(hit) {
  const m = hit.manifest;
  return { id: m.id, version: m.version, title: m.title, description: m.description, lang: m.lang, levels: m.levels,
    stations: (m.stations ?? []).map((s) => ({ id: s.id, title: s.title, levels: s.levels })), deprecated: m.deprecated ?? undefined };
}

server.registerTool("show_simulator", {
  title: "Show a simulator",
  description: "Opens a PTF simulator for the learner, inline in the chat. Use it at the start of a step: let the learner try or guess first, then explain. " +
    "`sim` is an ID with optional semver range, e.g. ptf:sim/next-char-lab@^2.0.0 (take it from the element's `simulators` list). " +
    "While it is open you receive the learner's activity and a description of what they see. To change level or station, call this tool again.",
  inputSchema: {
    sim: z.string().describe("Simulator reference, e.g. ptf:sim/next-char-lab@^2.0.0"),
    level: LEVEL.optional(),
    station: z.string().optional().describe("Station ID to open"),
    element: z.string().regex(/^ptf:el\//).optional().describe("Learning element this simulator is used for; results count towards its mastery"),
    params: z.record(z.string(), z.unknown()).optional().describe("Parameters valid against the simulator's sim.json params schema"),
  },
  _meta: { ui: { resourceUri: PLAYER_URI }, "ui/resourceUri": PLAYER_URI },
}, guarded(async ({ sim, level, station, element, params }) => {
  const bundle = element?.split("/")[1];
  const hit = lib().resolveSim(sim, bundle);
  const info = simInfo(hit);
  if (station && !info.stations.some((s) => s.id === station)) throw new Error(`Unknown station ${station}. Stations: ${info.stations.map((s) => s.id).join(", ")}`);
  const state = learner.simState(info.id);
  const prefs = learner.profile()?.accessibility;
  const launch = { sim: info, level: level ?? null, station: station ?? null, element: element ?? null, params: params ?? {}, state,
    prefs: prefs ? { reducedMotion: !!prefs.reduced_motion, fontScale: prefs.font_scale ?? 1 } : {} };
  const lines = [
    `Showing ${info.title} (${info.id}@${info.version}) to the learner${level ? ` at level ${level}` : ""}${station ? `, station ${station}` : ""}.`,
    `UI language: ${(info.lang ?? []).join(", ")}. Stations: ${info.stations.map((s) => s.id).join(", ") || "none"}.`,
    "Ask the learner what they notice before you explain. Their activity is recorded in the learner record.",
    "If the learner cannot see the simulator (host without MCP Apps support), call export_simulator and give them the file.",
  ];
  return { content: [text(lines.join("\n"))], structuredContent: launch, _meta: { "ptf/html": lib().inlineSim(hit) } };
}));

server.registerTool("export_simulator", {
  title: "Export a simulator as a file",
  description: "Writes a simulator as one standalone HTML file that opens in any browser (no network needed). For hosts that cannot show MCP Apps.",
  inputSchema: { sim: z.string(), path: z.string().optional().describe("Output file; default ~/.ptf/exports/<name>-<version>.html") },
}, guarded(async ({ sim, path }) => {
  const hit = lib().resolveSim(sim);
  const m = hit.manifest;
  const out = resolve(path || join(ptfHome, "exports", `${parseSimRef(m.id).id.split("/").pop()}-${m.version}.html`));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, lib().inlineSim(hit));
  return ok({ file: out, sim: `${m.id}@${m.version}`, note: "Runs standalone with default level; it cannot report progress back." });
}));

// App-only tools: called by the player, hidden from the model where the host supports visibility.
const APP_ONLY = { ui: { visibility: ["app"] } };

server.registerTool("ptf_sim_source", {
  title: "Simulator source (player)",
  description: "Used by the simulator player: returns the verified, inlined simulator HTML.",
  inputSchema: { sim: z.string() },
  annotations: { readOnlyHint: true },
  _meta: APP_ONLY,
}, guarded(async ({ sim }) => {
  const hit = lib().resolveSim(sim);
  return { content: [text(`${hit.manifest.id}@${hit.manifest.version}`)], structuredContent: { html: lib().inlineSim(hit) } };
}));

server.registerTool("ptf_record_event", {
  title: "Record a learning event (player, quiz)",
  description: "Used by the simulator player and the quiz: appends a learning event to the local learner record.",
  inputSchema: {
    verb: z.string(), object: z.string(), level: LEVEL.optional(), element: z.string().optional(),
    result: z.object({ correct: z.boolean().optional(), score: z.number().min(0).max(1).optional(),
      response: z.string().max(2000).optional(), misconception: z.string().max(100).optional() }).optional(),
    via: z.enum(["simulator", "quiz"]).optional(),
  },
  _meta: APP_ONLY,
}, guarded(async ({ via, ...args }) => ok(learner.record({ ...args, context: { via: via ?? "simulator" } }))));

server.registerTool("ptf_save_state", {
  title: "Save simulator state (player)",
  description: "Used by the simulator player: stores the simulator's resume state locally.",
  inputSchema: { sim: z.string(), state: z.unknown() },
  _meta: APP_ONLY,
}, guarded(async ({ sim, state }) => { learner.saveSimState(parseSimRef(sim).id, state); return ok("saved"); }));

// ---------- learner record ----------

server.registerTool("get_learner", {
  title: "Read the learner record",
  description: "The learner's profile (languages, level, learning style, goals, notes), mastery per element, reviews due and recent events. " +
    "Read it at the start of every session. If there is no profile yet, ask a few intake questions and save them with update_learner_profile.",
  inputSchema: { events: z.number().int().min(0).max(200).optional().describe("How many recent events to include (default 20)") },
  annotations: { readOnlyHint: true },
}, guarded(async ({ events }) => {
  const mastery = learner.mastery();
  const today = new Date().toISOString().slice(0, 10);
  const due = Object.entries(mastery.concepts).filter(([, c]) => c.next_review && c.next_review <= today).map(([id]) => id);
  return ok({ record: learnerDir, profile: learner.profile(), mastery, reviews_due: due, recent_events: learner.events(events ?? 20) });
}));

server.registerTool("update_learner_profile", {
  title: "Update the learner profile",
  description: "Merges fields into the learner's local profile.md (LEARNER-RECORD.md §3), e.g. preferred_lang, age_band, style {modality, pace, default_level, likes, dislikes}, interests, goals [{text, path}]. `notes` replaces the free-text notes for the tutor.",
  inputSchema: {
    display_name: z.string().optional(), languages: z.array(z.string()).optional(), preferred_lang: z.string().optional(),
    age_band: z.enum(["child", "teen", "adult"]).optional(),
    style: z.record(z.string(), z.unknown()).optional(), accessibility: z.record(z.string(), z.unknown()).optional(),
    interests: z.array(z.string()).optional(), goals: z.array(z.object({ text: z.string(), path: z.string().optional() })).optional(),
    strengths: z.array(z.object({ concept: z.string(), level: z.string().optional(), note: z.string().optional() })).optional(),
    notes: z.string().optional(),
  },
}, guarded(async (fields) => ok(learner.updateProfile(fields))));

server.registerTool("record_progress", {
  title: "Record learning progress",
  description: "Logs what happened in the conversation: an answer to a question (verb answered with result.correct and result.misconception), " +
    "the learner saying they understood, asking to go deeper or to have it explained differently, or being stuck. Updates mastery for ptf:el/ objects. " +
    "Optionally sets `mastery` (0 to 1) directly after a conversational check.",
  inputSchema: {
    verb: z.enum(["experienced", "attempted", "answered", "completed", "understood", "rephrase", "deeper", "stuck", "asked"]),
    object: z.string().regex(/^ptf:(el|path|sim)\//).describe("e.g. ptf:el/llm-basics/softmax or ptf:el/llm-basics/softmax#q1"),
    level: LEVEL.optional(),
    result: z.object({ correct: z.boolean().optional(), score: z.number().min(0).max(1).optional(), response: z.string().optional(),
      misconception: z.string().optional() }).optional(),
    mastery: z.number().min(0).max(1).optional(),
  },
}, guarded(async ({ mastery, ...ev }) => {
  const event = learner.record({ ...ev, context: { via: "tutor" } });
  const el = ev.object.split("#")[0];
  const state = mastery !== undefined && el.startsWith("ptf:el/") ? learner.setMastery(el, { mastery }) : learner.mastery().concepts[el];
  return ok({ event, mastery: state ?? null });
}));

// ---------- prompt ----------

server.registerPrompt("ptf-tutor", {
  title: "Learn with the PTF tutor",
  description: "Start a tutoring session: the tutor reads your learner record and teaches from the PTF library.",
  argsSchema: { goal: z.string().optional().describe("What do you want to learn?") },
}, ({ goal }) => ({
  messages: [{ role: "user", content: { type: "text", text: `${TUTOR_GUIDE}\n\n---\n\n${goal ? `My learning goal: ${goal}` : "Ask me what I want to learn."}` } }],
}));

await server.connect(new StdioServerTransport());
log(`ready · library ${library ? libraryDir : "unavailable"} · learner ${learnerDir}`);
