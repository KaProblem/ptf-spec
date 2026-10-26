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
import * as z from "zod";
import { PLAYER_HTML, TUTOR_GUIDE, VERSION } from "./assets.mjs";
import { LearnerRecord } from "./learner.mjs";
import { Library, onlyLevel, parseSimRef } from "./library.mjs";

const PLAYER_URI = "ui://ptf/player.html";
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
  const prefs = learner.profile()?.accessibility;
  const launch = { sim: info, level: level ?? null, station: station ?? null, focus: station ? (focus ?? true) : false, element: element ?? null, params: params ?? {}, state,
    prefs: prefs ? { reducedMotion: !!prefs.reduced_motion, fontScale: prefs.font_scale ?? 1 } : {} };
  const lines = [
    `Showing ${info.title} (${info.id}@${info.version}) to the learner${level ? ` at level ${level}` : ""}${station ? `, station ${station}${launch.focus ? " (focus mode)" : ""}` : ""}.`,
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

server.registerTool("ptf_record_event", {
  title: "Record a simulator event (player)",
  description: "Used by the simulator player: appends a learning event to the local learner record.",
  inputSchema: {
    verb: z.string(), object: z.string(), level: LEVEL.optional(), element: z.string().optional(),
    result: z.object({ correct: z.boolean().optional(), score: z.number().min(0).max(1).optional(),
      response: z.string().max(2000).optional(), misconception: z.string().max(100).optional() }).optional(),
  },
  _meta: APP_ONLY,
}, guarded(async (args) => ok(learner.record({ ...args, context: { via: "simulator" } }))));

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
