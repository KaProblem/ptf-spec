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
//   PTF_WORKSPACE    where code labs are copied for the learner (default ~/.ptf/workspace)

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import Ajv2020 from "ajv/dist/2020.js";
import * as z from "zod";
import { FIGURE_HTML, PLAYER_HTML, QUESTION_SCHEMA, QUIZ_HTML, TUTOR_GUIDE, VERSION } from "./assets.mjs";
import { checkFigure, hostSvg } from "../../tools/ptf-figure.mjs";
import { LearnerRecord } from "./learner.mjs";
import { Library, onlyLevel, parseSimRef } from "./library.mjs";

const PLAYER_URI = "ui://ptf/player.html";
const QUIZ_URI = "ui://ptf/quiz.html";
const FIGURE_URI = "ui://ptf/figure.html";
const APP_MIME = "text/html;profile=mcp-app";
const DEFAULT_URL = "https://github.com/KaProblem/ptf-library.git";
const LEVEL = z.string().regex(/^[a-z][a-z0-9-]*$/).describe("Level ID: child, highschool, college, expert or a bundle's custom level");

const ptfHome = join(homedir(), ".ptf");
const libraryDir = resolve(process.env.PTF_LIBRARY || join(ptfHome, "library"));
const learnerDir = resolve(process.env.PTF_LEARNER || join(ptfHome, "learner"));
const workspaceDir = resolve(process.env.PTF_WORKSPACE || join(ptfHome, "workspace"));
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
    "read the learner record first, pick a learning path or element, introduce what the learner will be able to do, " +
    "let them try or guess (a question, an example, or a simulator when it helps), talk about what they saw, explain at their level " +
    "and in their preferred way, ask questions, and record progress. Never restart work the learner has completed. Load the `ptf-tutor` prompt for the full teaching method. " +
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

server.registerResource("ptf-figure", FIGURE_URI, {
  title: "PTF figure",
  description: "Shows one PTF figure (SPEC.md §6.8) step by step.",
  mimeType: APP_MIME,
  _meta: { ui: { prefersBorder: false } },
}, async (uri) => ({ contents: [{ uri: uri.href, mimeType: APP_MIME, text: FIGURE_HTML, _meta: { ui: { prefersBorder: false } } }] }));

// ---------- library ----------

server.registerTool("list_library", {
  title: "List the PTF library",
  description: "Bundles, learning paths, learning elements and simulators in the local PTF library.",
  inputSchema: {},
  annotations: { readOnlyHint: true },
}, guarded(async () => ok({ library: libraryDir, source: libraryUrl, commit: libraryVersion(), ...lib().overview() })));

server.registerTool("search_library", {
  title: "Search the PTF library",
  description: "Full-text search over learning elements, paths and simulators. Use it to find material for the learner's goal. " +
    "Elements carry `about` (Wikidata items, first = primary concept): elements from different bundles with the same primary concept are alternatives; pick by level, language, the learner's profile and status.",
  inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(50).optional() },
  annotations: { readOnlyHint: true },
}, guarded(async ({ query, limit }) => ok(lib().search(query, limit))));

server.registerTool("get_element", {
  title: "Read a learning element",
  description: "Returns a learning element (ptf:el/<bundle>/<name>) or learning path (ptf:path/<bundle>/<name>) as Markdown with frontmatter. " +
    "`objectives`, Core, Key facts and Misconceptions are binding: teach towards the objectives and never contradict the rest. " +
    "Level texts, examples, questions, figures (show_figure) and simulators are offers to adapt; `# Tutor notes` are the author's wishes and must be followed. " +
    "Pass `level` to drop the level texts for other levels; every level covers the whole concept at its depth, so the learner never needs another level to complete the element.",
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

// Every kind is shown as a card. The card checks all of them itself, except free_text, which the tutor grades.
const QUIZ_KINDS = ["multiple_choice", "cloze", "ordering", "estimate_number", "guess_next", "calculation_steps", "free_text"];
const validQuestion = new Ajv2020({ allErrors: true, strict: false }).compile(QUESTION_SCHEMA);

function questionErrors(q) {
  if (validQuestion(q)) return [];
  // oneOf reports every branch; keep the errors of the branch for the given kind and the shared fields.
  const kinds = QUESTION_SCHEMA.oneOf.map((b) => b.properties.kind.const);
  const branch = kinds.indexOf(q?.kind);
  if (branch < 0) return [`kind must be one of ${kinds.join(", ")}`];
  return (validQuestion.errors ?? []).filter((e) => e.schemaPath.startsWith(`#/oneOf/${branch}/`) || e.schemaPath.startsWith("#/properties/"))
    .map((e) => `${e.instancePath || "question"} ${e.message}`);
}

/** What a card needs to play a media entry (SPEC.md §6.9); the transcript goes to the card in _meta only. */
function mediaCard(hit, plays) {
  const e = hit.entry;
  return { id: hit.id, kind: e.kind, title: e.title ?? hit.id, mime: hit.mime, url: hit.url, plays: plays ?? null,
    duration_s: e.duration_s ?? null, bytes: e.bytes ?? null, language: e.language ?? null, speakers: e.speakers ?? [] };
}
const mediaLine = (hit, plays) => `${hit.entry.kind === "video" ? "Video" : "Audio"} "${hit.entry.title ?? hit.id}" (${Math.round(hit.entry.duration_s ?? 0)} s` +
  `${hit.entry.speakers?.length ? `, ${hit.entry.speakers.join(", ")}` : ""})` + (plays ? `, the learner may play it ${plays} time(s).` : ".");
const transcriptBlock = (hit) => `Transcript, for you only: do not read it out, quote it or hint at it before the learner has answered. ` +
  `The card shows it to the learner afterwards.\n<<<\n${hit.transcript}\n>>>`;

server.registerTool("show_question", {
  title: "Show a quiz question",
  description: "Shows a question to the learner as an interactive card inline in the chat, instead of asking it in plain text. " +
    "Either take questions from a learning element (`element` + `question_id`, or `question_ids` for several questions in one card, " +
    "e.g. all items of a listening task) or write your own `question` as a PTF question block (SPEC.md §7, schema question-block.schema.json). " +
    "Kinds shown as a card: " + QUIZ_KINDS.join(", ") + ". " +
    "A question with `media` plays its audio or video in the card (as often as `plays` allows) and shows the transcript after the answer. " +
    "Use it for every check, probe, warmup or review question rather than asking in the chat. The card checks every kind itself " +
    "except free_text, which you grade with the rubric. The learner's answer arrives as their next message.",
  inputSchema: {
    element: z.string().regex(/^ptf:el\//).optional().describe("Learning element the question belongs to; answers count towards its mastery"),
    question_id: z.string().optional().describe("ID of a question block in the element"),
    question_ids: z.array(z.string()).min(1).max(15).optional().describe("Several question IDs of the element, shown together in one card (they must share the same media, or have none)"),
    question: z.record(z.string(), z.unknown()).optional().describe("A question block you wrote, e.g. {kind: multiple_choice, id, level, question, options[{text, correct, feedback}], explanation}"),
  },
  _meta: { ui: { resourceUri: QUIZ_URI }, "ui/resourceUri": QUIZ_URI },
}, guarded(async ({ element, question_id, question_ids, question }) => {
  if ([question, question_id, question_ids].filter(Boolean).length !== 1) throw new Error("Pass exactly one of question_id, question_ids (both with element) or question.");
  let qs = question ? [question] : null;
  let lang = null;
  if (element) {
    const d = lib().doc(element);
    if (!d) throw new Error(`Unknown element ${element}.`);
    lang = d.meta.lang ?? null;
  }
  if (!qs) {
    if (!element) throw new Error("question_id and question_ids need element.");
    const all = lib().questions(element);
    qs = (question_ids ?? [question_id]).map((id) => {
      const q = all.find((x) => x.id === id);
      if (!q) throw new Error(`Element ${element} has no question ${id}. Questions: ${all.map((x) => `${x.id} (${x.kind})`).join(", ") || "none"}`);
      return q;
    });
  }
  for (const q of qs) {
    const errors = questionErrors(q);
    if (errors.length) throw new Error(`Not a valid PTF question block${qs.length > 1 ? ` (${q.id})` : ""}: ${errors.join("; ")}`);
  }
  const mediaIds = [...new Set(qs.map((q) => q.media ?? null))];
  if (mediaIds.length > 1) throw new Error(`Questions in one card must share the same media; got ${mediaIds.map((m) => m ?? "none").join(", ")}.`);
  let hit = null;
  let plays = null;
  if (mediaIds[0]) {
    if (!element) throw new Error("A question with media needs element: the media belongs to the element.");
    hit = lib().media(element, mediaIds[0]);
    const p = qs.map((q) => q.plays).filter(Boolean);
    plays = p.length ? Math.min(...p) : null;
  }
  const objects = Object.fromEntries(qs.map((q) => [q.id, element ? `${element}#${q.id}` : null]));
  const many = qs.length > 1;
  const lines = [many ? `Showing ${qs.length} questions (${qs.map((q) => `${q.id} ${q.kind}`).join(", ")}) in one card. Do not give away the answers; wait for the learner's reply.`
    : `Showing question ${qs[0].id} (${qs[0].kind}) to the learner. Do not give away the answer; wait for their reply.`];
  if (hit) lines.push(mediaLine(hit, plays) + " The card plays it; say in one sentence what to listen for, without giving away an answer.");
  const graded = qs.filter((q) => q.kind !== "free_text");
  const own = qs.filter((q) => q.kind === "free_text");
  if (graded.length) {
    lines.push("The card checks the answer" + (many ? "s" : "") + ", shows the right answer and the explanation" + (element ? (many ? ", and records each answer." : `, and records it as ${objects[qs[0].id]}.`) : "."),
      element ? "Then talk about the answer: why it is right or which misconception it shows."
        : "Then record it with record_progress (verb answered, correct, objectives) and talk about the answer.");
    if (many) lines.push("In a card with several questions the learner's message arrives once all of them are answered.");
  }
  for (const q of own) {
    lines.push(`Grade the answer to ${q.id} the learner sends against this rubric, give short feedback, then show or summarise the sample answer if it helps.`);
    if (q.rubric?.length) lines.push(`Rubric:\n${q.rubric.map((r) => `- ${r}`).join("\n")}`);
    if (q.sample_answer) lines.push(`Sample answer: ${q.sample_answer}`);
    if (objects[q.id]) lines.push(`Then call record_progress with verb answered, object ${objects[q.id]} and result.score (0 to 1).`);
  }
  if (hit) lines.push(transcriptBlock(hit));
  const structuredContent = { question: qs[0], questions: qs, element: element ?? null, object: objects[qs[0].id], objects, lang,
    ...(hit ? { media: mediaCard(hit, plays) } : {}) };
  return { content: [text(lines.join("\n"))], structuredContent, ...(hit ? { _meta: { "ptf/transcript": hit.transcript } } : {}) };
}));

// ---------- media (SPEC.md §6.9) ----------

server.registerTool("show_media", {
  title: "Play audio or video",
  description: "Plays an audio or video of a learning element (its `media` list) inline in the chat, without a question, e.g. a dialogue to " +
    "listen to before you talk about it. The learner can open the transcript after listening once. For listening tasks with questions use " +
    "show_question with the questions that name this media instead. You never hear the file: the result gives you its transcript.",
  inputSchema: {
    element: z.string().regex(/^ptf:el\//).describe("Learning element the media belongs to"),
    media: z.string().describe("Media ID from the element's `media` list"),
    plays: z.number().int().min(1).max(9).optional().describe("How often the learner may play it; default unlimited"),
  },
  _meta: { ui: { resourceUri: QUIZ_URI }, "ui/resourceUri": QUIZ_URI },
}, guarded(async ({ element, media, plays }) => {
  const hit = lib().media(element, media);
  const level = hit.entry.levels?.length === 1 ? hit.entry.levels[0] : null;
  const lines = [`Playing ${mediaLine(hit, plays ?? null)}`.replace("Playing Audio", "Playing the audio").replace("Playing Video", "Playing the video"),
    ...(hit.entry.objectives?.length ? [`It supports the objective(s) ${hit.entry.objectives.join(", ")}.`] : []),
    "Say in one sentence what to listen for, then ask what the learner understood before you explain. The learner can open the transcript once they have listened.",
    transcriptBlock(hit)];
  return { content: [text(lines.join("\n"))],
    structuredContent: { media: mediaCard(hit, plays ?? null), element, object: `${element}#media:${hit.id}`, level, lang: hit.entry.language ?? lib().doc(element)?.meta.lang ?? null },
    _meta: { "ptf/transcript": hit.transcript } };
}));

// ---------- figures (SPEC.md §6.8) ----------

/** Reads and checks a figure; refuses one that breaks the format rules. */
function loadFigure(element, figure, lang) {
  const hit = lib().figure(element, figure, lang);
  const raw = readFileSync(hit.file, "utf8");
  const { errors, info } = checkFigure(raw);
  if (errors.length) throw new Error(`Figure ${figure} of ${element} breaks the figure rules, so it is not shown: ${errors.join("; ")}`);
  return { ...hit, info, svg: hostSvg(raw) };
}

server.registerTool("show_figure", {
  title: "Show a figure",
  description: "Shows a figure of a learning element (its `figures` list) inline in the chat as a card that builds up step by step: " +
    "the learner taps Next and sees one part and its caption at a time. Use it when a picture explains better than words " +
    "(see the entry's `use_when`), e.g. before an explanation or to repair a misconception. You never see the picture itself: " +
    "the result gives you its description and the caption of every step. Say first what to look at, let the learner go through the " +
    "steps, and ask what they notice before you explain.",
  inputSchema: {
    element: z.string().regex(/^ptf:el\//).describe("Learning element the figure belongs to"),
    figure: z.string().describe("Figure ID from the element's `figures` list"),
    lang: z.string().optional().describe("Language of the labels; default: the learner's preferred language when a translation exists"),
    step: z.number().int().min(1).optional().describe("Step to start at; default 1"),
  },
  _meta: { ui: { resourceUri: FIGURE_URI }, "ui/resourceUri": FIGURE_URI },
}, guarded(async ({ element, figure, lang, step }) => {
  const f = loadFigure(element, figure, lang ?? learner.profile()?.preferred_lang ?? null);
  const steps = f.info.steps;
  const object = `${element}#figure:${f.id}`;
  const level = f.entry?.levels?.length === 1 ? f.entry.levels[0] : null;
  const lines = [
    `Showing the figure "${f.info.title}" (${f.id}, labels in ${f.lang ?? "the element's language"}) to the learner` +
      (steps.length > 1 ? `, starting at step ${Math.min(step ?? 1, steps.length)} of ${steps.length}.` : "."),
    `What it shows: ${f.info.desc}`,
    ...(steps.length ? ["Steps (the learner taps Next to reveal each one):", ...steps.map((s) => `${s.n}. ${s.caption ?? "(no caption)"}`)] : []),
    ...(f.entry?.objectives?.length ? [`It supports the objective(s) ${f.entry.objectives.join(", ")}.`] : []),
    "Say in a sentence what to look at, let the learner go through the steps, and ask what they notice before you explain. " +
      "Do not describe parts the learner has not revealed yet. You receive the step they are on.",
  ];
  return {
    content: [text(lines.join("\n"))],
    structuredContent: { figure: { id: f.id, element, lang: f.lang, title: f.info.title, desc: f.info.desc, steps, width: f.info.width, height: f.info.height },
      step: step ?? 1, object, level },
    _meta: { "ptf/svg": f.svg },
  };
}));

// ---------- simulators ----------

function simInfo(hit) {
  const m = hit.manifest;
  return { id: m.id, version: m.version, title: m.title, description: m.description, lang: m.lang, levels: m.levels,
    stations: (m.stations ?? []).map((s) => ({ id: s.id, title: s.title, levels: s.levels })), deprecated: m.deprecated ?? undefined };
}

server.registerTool("show_simulator", {
  title: "Show a simulator",
  description: "Opens a PTF simulator for the learner, inline in the chat. Use it when it helps the learner reach the step's objective " +
    "(check the element's `use_when` and the learner's style.explain.simulators); many steps need none. Say first what to look for, " +
    "and talk about what the learner saw afterwards. " +
    "`sim` is an ID with optional semver range, e.g. ptf:sim/next-char-lab@^2.0.0 (take it from the element's `simulators` list). " +
    "While it is open you receive the learner's activity and a description of what they see. To change level or station, call this tool again.",
  inputSchema: {
    sim: z.string().describe("Simulator reference, e.g. ptf:sim/next-char-lab@^2.0.0"),
    level: LEVEL.optional(),
    station: z.string().optional().describe("Station ID to open"),
    focus: z.boolean().optional().describe("Show only that station, one idea at a time, with Back/Next (SIMULATOR-SPEC.md §4.7). Default: true when a station is given"),
    element: z.string().regex(/^ptf:el\//).optional().describe("Learning element this simulator is used for; results count towards its mastery"),
    params: z.record(z.string(), z.unknown()).optional().describe("Parameters valid against the simulator's sim.json params schema"),
  },
  _meta: { ui: { resourceUri: PLAYER_URI }, "ui/resourceUri": PLAYER_URI },
}, guarded(async ({ sim, level, station, focus, element, params }) => {
  const bundle = element?.split("/")[1];
  const hit = lib().resolveSim(sim, bundle);
  const info = simInfo(hit);
  if (station && !info.stations.some((s) => s.id === station)) throw new Error(`Unknown station ${station}. Stations: ${info.stations.map((s) => s.id).join(", ")}`);
  const state = learner.simState(info.id);
  const done = learner.progress().simulators[info.id]?.stations_completed ?? [];
  const prefs = learner.profile()?.accessibility;
  const launch = { sim: info, level: level ?? null, station: station ?? null, focus: station ? (focus ?? true) : false, element: element ?? null, params: params ?? {}, state,
    prefs: prefs ? { reducedMotion: !!prefs.reduced_motion, fontScale: prefs.font_scale ?? 1 } : {} };
  const lines = [
    `Showing ${info.title} (${info.id}@${info.version}) to the learner${level ? ` at level ${level}` : ""}${station ? `, station ${station}${launch.focus ? " (focus mode)" : ""}` : ""}.`,
    `UI language: ${(info.lang ?? []).join(", ")}. Stations: ${info.stations.map((s) => s.id).join(", ") || "none"}.`,
    ...(done.length ? [`The learner already completed station(s) ${done.join(", ")} of this simulator${station && done.includes(station) ? `, including ${station}: offer a short recap or the next station instead of repeating it` : ""}.`] : []),
    "Tell the learner what to look for, then ask what they noticed before you explain. Their activity is recorded in the learner record.",
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

// ---------- code labs (CODE-SPEC.md) ----------

function labInfo(hit) {
  const m = hit.manifest;
  return { id: m.id, version: m.version, title: m.title, description: m.description, language: m.language, levels: m.levels,
    requires: m.requires, setup: m.setup ?? null, data: m.data ?? [],
    steps: m.steps.map((s) => ({ id: s.id, title: s.title, file: s.file, run: s.run, minutes: s.minutes, try: s.try ?? [] })) };
}

server.registerTool("get_code_lab", {
  title: "Read a code lab",
  description: "Returns a code lab (runnable code in steps, CODE-SPEC.md): its steps, run commands, dependencies and README; " +
    "with `step`, also that step's source. Use it to explain the code; give it to the learner with copy_code_lab.",
  inputSchema: {
    lab: z.string().describe("Code lab reference, e.g. ptf:code/gpt-from-scratch@^1.0.0 (take it from the element's `code` list)"),
    step: z.string().optional().describe("Step ID whose source to include"),
  },
  annotations: { readOnlyHint: true },
}, guarded(async ({ lab, step }) => {
  const hit = lib().resolveLab(lab);
  const info = labInfo(hit);
  const out = { ...info, readme: readFileSync(join(hit.dir, "README.md"), "utf8") };
  if (step) {
    const st = hit.manifest.steps.find((s) => s.id === step);
    if (!st) throw new Error(`Unknown step ${step}. Steps: ${info.steps.map((s) => s.id).join(", ")}`);
    out.source = { file: st.file, text: readFileSync(join(hit.dir, st.file), "utf8") };
  }
  return ok(out);
}));

server.registerTool("copy_code_lab", {
  title: "Copy a code lab to the learner's workspace",
  description: "Copies a verified code lab into a folder the learner owns (default ~/.ptf/workspace/<name>), so they can run, change and extend it. " +
    "Never overwrites an existing folder. It does not install or run anything: show the learner the setup and run commands " +
    "and let them run the code themselves, or ask each time before you run it for them (CODE-SPEC.md §5).",
  inputSchema: {
    lab: z.string().describe("Code lab reference, e.g. ptf:code/gpt-from-scratch@^1.0.0"),
    element: z.string().regex(/^ptf:el\//).optional().describe("Learning element it is used for; its bundle's ptf.lock picks the version"),
    path: z.string().optional().describe("Target folder; must not exist or be empty"),
  },
}, guarded(async ({ lab, element, path }) => {
  const hit = lib().resolveLab(lab, element?.split("/")[1]);
  const info = labInfo(hit);
  const target = resolve(path || join(workspaceDir, info.id.split("/").pop()));
  if (existsSync(target) && readdirSync(target).length) {
    throw new Error(`${target} already exists and is not empty; it may hold the learner's changes. Pass another path, or ask the learner whether to keep working there.`);
  }
  mkdirSync(target, { recursive: true });
  cpSync(hit.dir, target, { recursive: true });
  const lines = [
    `Copied ${info.id}@${info.version} to ${target}.`,
    `Needs ${info.requires.runtime}${info.requires.packages?.length ? ` with ${info.requires.packages.join(", ")}` : ""}.`,
    ...(info.setup ? [`Setup (show it to the learner first): cd ${target} && ${info.setup}`] : []),
    "Do not run any step without the learner's go-ahead.",
  ];
  return ok({ message: lines.join("\n"), path: target, ...info });
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

server.registerTool("ptf_figure_source", {
  title: "Figure source (figure card)",
  description: "Used by the figure card: returns the checked SVG of a figure.",
  inputSchema: { element: z.string().regex(/^ptf:el\//), figure: z.string(), lang: z.string().optional() },
  annotations: { readOnlyHint: true },
  _meta: APP_ONLY,
}, guarded(async ({ element, figure, lang }) => {
  const f = loadFigure(element, figure, lang);
  return { content: [text(`${element} figure ${f.id} (${f.lang})`)], structuredContent: { svg: f.svg } };
}));

server.registerTool("ptf_media_source", {
  title: "Media source (quiz card)",
  description: "Used by the quiz card: returns a checked media file of an element as base64.",
  inputSchema: { element: z.string().regex(/^ptf:el\//), media: z.string() },
  annotations: { readOnlyHint: true },
  _meta: APP_ONLY,
}, guarded(async ({ element, media }) => {
  const hit = lib().media(element, media);
  const buf = lib().mediaBytes(hit);
  return { content: [text(`${element} media ${hit.id} (${buf.length} bytes)`)], structuredContent: { mime: hit.mime, data: buf.toString("base64") } };
}));

server.registerTool("ptf_record_event", {
  title: "Record a learning event (player, quiz, figure)",
  description: "Used by the simulator player, the quiz, the figure card and media: appends a learning event to the local learner record.",
  inputSchema: {
    verb: z.string(), object: z.string(), level: LEVEL.optional(), element: z.string().optional(),
    result: z.object({ correct: z.boolean().optional(), score: z.number().min(0).max(1).optional(),
      response: z.string().max(2000).optional(), misconception: z.string().max(100).optional() }).optional(),
    via: z.enum(["simulator", "quiz", "figure", "media"]).optional(),
  },
  _meta: APP_ONLY,
}, guarded(async ({ via, ...args }) => ok(learner.record({ ...args, context: { via: via ?? "simulator" } }, elementInfo))));

server.registerTool("ptf_save_state", {
  title: "Save simulator state (player)",
  description: "Used by the simulator player: stores the simulator's resume state locally.",
  inputSchema: { sim: z.string(), state: z.unknown() },
  _meta: APP_ONLY,
}, guarded(async ({ sim, state }) => { learner.saveSimState(parseSimRef(sim).id, state); return ok("saved"); }));

// ---------- learner record ----------

// Steps and prerequisites of a path, from the library (for courses and the order of reviews).
function pathInfo(id) {
  const d = library ? lib().doc(id) : null;
  if (!d || d.type !== "Learning Path") return null;
  return { steps: (d.meta.steps ?? []).filter((st) => !st.catalog).map((st) => ({ element: st.element, optional: Boolean(st.optional) })) };
}
// Objectives, version and catalog of an element, for answered and completed events (LEARNER-RECORD.md §4, §5).
let catalogId;
function libraryCatalog() {
  if (catalogId !== undefined) return catalogId;
  try { catalogId = JSON.parse(readFileSync(join(libraryDir, "ptf-catalog.json"), "utf8")).id ?? null; } catch { catalogId = null; }
  return catalogId;
}
function elementInfo(id) {
  const d = library ? lib().doc(id) : null;
  if (!d || d.type !== "Learning Element") return null;
  const objectives = (d.meta.objectives ?? []).map((o) => (o && typeof o === "object" ? o.id : null)).filter(Boolean);
  const questions = lib().questions(id);
  return {
    objectives, version: d.meta.version ?? null, catalog: libraryCatalog(),
    questionObjectives: (qid) => [questions.find((q) => q.id === qid)?.objectives ?? []].flat(),
  };
}
const requiresOf = (id) => (library ? lib().doc(id)?.meta.requires ?? [] : []).map((r) => (typeof r === "string" ? r : r.id));

server.registerTool("get_learner", {
  title: "Read the learner record",
  description: "Without `course`: the learner's profile (languages, learning style, explanation preferences, goals, notes), their courses " +
    "(path, status, current step, last activity, last note) and up to 10 reviews due. Read it at the start of every session; if there is no " +
    "profile yet, ask only what you need to begin and save it with update_learner_profile. " +
    "With `course` (a ptf:path/ ID): that course in detail: placement, per step the levels completed, done, skipped, target level, completed simulator stations " +
    "(do not restart them), open misconceptions, the last note and the course's recent events. With a ptf:el/ ID: the same for one element.",
  inputSchema: { course: z.string().regex(/^ptf:(path|el)\//).optional().describe("A ptf:path/ or ptf:el/ ID") },
  annotations: { readOnlyHint: true },
}, guarded(async ({ course }) => {
  if (course?.startsWith("ptf:el/")) return ok(learner.element(course));
  if (course) return ok(learner.course(course, pathInfo(course)));
  const courses = learner.courses(pathInfo);
  const next = courses.filter((c) => c.status === "active" && c.current_step).flatMap((c) => requiresOf(c.current_step));
  return ok({ record: learnerDir, profile: learner.profile(), courses, reviews_due: learner.reviewsDue(next) });
}));

server.registerTool("update_learner_profile", {
  title: "Update the learner profile",
  description: "Records a profile change as an event and merges it into the profile (LEARNER-RECORD.md §3), e.g. preferred_lang, age_band, style {modality, pace, default_level, likes, dislikes, explain {start_with: big_picture|example|question, analogies: often|sometimes|rarely, formulas: avoid|when_useful|always, length: short|medium|detailed, simulators: rarely|when_useful|often, notes}}, interests, goals [{text, paths: [ptf:path/…, in order]}]. Update style.explain whenever the learner says how they want things explained. `notes` replaces the free-text notes for the tutor.",
  inputSchema: {
    display_name: z.string().optional(), languages: z.array(z.string()).optional(), preferred_lang: z.string().optional(),
    age_band: z.enum(["child", "teen", "adult"]).optional(),
    style: z.record(z.string(), z.unknown()).optional(), accessibility: z.record(z.string(), z.unknown()).optional(),
    interests: z.array(z.string()).optional(), goals: z.array(z.object({ text: z.string(), path: z.string().optional(), paths: z.array(z.string()).optional() })).optional(),
    strengths: z.array(z.object({ concept: z.string(), level: z.string().optional(), note: z.string().optional() })).optional(),
    notes: z.string().optional(),
  },
}, guarded(async (fields) => ok(learner.updateProfile(fields))));

server.registerTool("record_progress", {
  title: "Record learning progress",
  description: "Logs what happened in the conversation, with `path` when it belongs to a course (LEARNER-RECORD.md §4). " +
    "answered: every checkable answer with result.correct, result.misconception, result.objectives (the objective IDs it checks; " +
    "filled in from the question block when the object is ptf:el/<…>#<question>) and result.assistance: hint when the learner had a hint, " +
    "solution when the solution was shown before the answer (then it is no evidence and the step needs a new question). " +
    "One wrong answer makes its misconception suspected, a second one open: ask once more before you treat it as the learner's. " +
    "completed: the element's objectives are shown at `level` (required). Pass result.evidence (IDs of the correct answered events) or leave it " +
    "out and the server picks them; the call fails and says which objective lacks a correct answer at that level. A completion holds for that " +
    "level only; going deeper is level_changed or deeper with the new level. Before a course, a step the learner already shows is completed " +
    "with context_reason placement; a step they only want to leave out is skipped (does not count). assessed: a placement score for planning " +
    "and reviews (context_reason placement or recap). started / left: a course (object: the path). consented / withdrew: sharing for a course " +
    "(object: the path, result.with = the concrete recipient, result.areas, result.required); never start a course with required sharing " +
    "without consented. understood, rephrase, deeper, stuck, asked: what the learner said; they never count as evidence. " +
    "`note`: two or three sentences for the next session. `keep`: the learner's own explanation of an element that made it click.",
  inputSchema: {
    verb: z.enum(["answered", "completed", "skipped", "assessed", "started", "left", "consented", "withdrew", "experienced", "attempted",
      "level_changed", "understood", "rephrase", "deeper", "stuck", "asked"]),
    path: z.string().regex(/^ptf:path\//).optional().describe("The course this belongs to"),
    object: z.string().regex(/^ptf:(el|path|sim)\//).describe("e.g. ptf:el/llm-basics/softmax or ptf:el/llm-basics/softmax#q1"),
    level: LEVEL.optional(),
    result: z.object({ correct: z.boolean().optional(), score: z.number().min(0).max(1).optional(), response: z.string().optional(),
      misconception: z.string().optional(), assistance: z.enum(["none", "hint", "solution"]).optional(),
      objectives: z.array(z.string()).optional(), evidence: z.array(z.string()).optional(),
      with: z.string().optional(), areas: z.array(z.enum(["progress", "mastery", "answers"])).optional(), required: z.boolean().optional() }).optional(),
    context_reason: z.enum(["placement", "recap"]).optional(),
    note: z.string().max(1000).optional(),
    keep: z.string().max(2000).optional(),
  },
}, guarded(async ({ context_reason, ...ev }) => {
  const event = learner.record({ ...ev, context: { via: "tutor", ...(context_reason ? { reason: context_reason } : {}) } }, elementInfo);
  const el = ev.object.split("#")[0];
  return ok({ event, mastery: el.startsWith("ptf:el/") ? learner.mastery().concepts[el] ?? null : null });
}));

server.registerTool("sync_learner", {
  title: "Sync the learner record with another copy",
  description: "Merges events from another copy of this learner's record (for example Magister) by event id and returns the events this " +
    "copy received since `since`, with a new cursor to pass next time (LEARNER-RECORD.md §8). Importing an exported events.jsonl is a sync " +
    "with `since` empty.",
  inputSchema: { events: z.array(z.record(z.string(), z.unknown())).max(10000).optional(), since: z.string().optional() },
}, guarded(async ({ events, since }) => ok(learner.sync(events ?? [], since ?? ""))));

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
