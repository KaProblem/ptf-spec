#!/usr/bin/env node
// ptf-check: validator for Personal Tutor Format libraries, bundles, simulator packages and code labs.
//
//   ptf-check [dir]              validate everything found under dir (default: .)
//   ptf-check hash <pkg-dir>     print the integrity hash of a simulator package or code lab
//   ptf-check hash --write <pkg-dir>   ... and write it into sim.json / lab.json
//   ptf-check lock <bundle-dir>  write ptf.lock with the highest version matching each range
//   ptf-check catalog [--write] <library-root>   regenerate the packages of ptf-catalog.json (CATALOG.md)
//
// Exit code 1 if any error was found. Warnings do not fail the run.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import semver from "semver";
import YAML from "yaml";
import { COMPUTED_KINDS, runChecks } from "./answer-checks.mjs";
import { checkFigure, figureFiles } from "./ptf-figure.mjs";
import { MAX_MEDIA_BYTES, MEDIA_TYPES, extOf, probeDuration, sha256Hex, sniffMedia, transcriptText, wordCount } from "./ptf-media.mjs";

const SPEC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_LEVELS = ["child", "highschool", "college", "expert"];
const MAX_PACKAGE_BYTES = 5 * 1024 * 1024;
const WARN_PACKAGE_BYTES = 300 * 1024;
const MAX_LAB_BYTES = 20 * 1024 * 1024;
const WARN_LAB_BYTES = 5 * 1024 * 1024;
const ALLOWLIST_FILE = join(SPEC_DIR, "vendor", "allowlist.json");
const ALLOWLIST = existsSync(ALLOWLIST_FILE) ? JSON.parse(readFileSync(ALLOWLIST_FILE, "utf8")).builds : {};

// Patterns forbidden in simulator code (SIMULATOR-SPEC.md §5.2).
const FORBIDDEN = [
  [/\bfetch\s*\(/, "network request (fetch)"],
  [/\bXMLHttpRequest\b/, "network request (XMLHttpRequest)"],
  [/\bnew\s+WebSocket\b/, "network request (WebSocket)"],
  [/\bEventSource\b/, "network request (EventSource)"],
  [/\bsendBeacon\b/, "network request (sendBeacon)"],
  [/\blocalStorage\b/, "storage (localStorage)"],
  [/\bsessionStorage\b/, "storage (sessionStorage)"],
  [/\bindexedDB\b/, "storage (indexedDB)"],
  [/\bdocument\.cookie\b/, "storage (cookies)"],
  [/\beval\s*\(/, "eval"],
  [/\bnew\s+Function\s*\(/, "new Function"],
  [/\bwindow\.open\s*\(/, "window.open"],
  [/\bsrc\s*=\s*["']\s*(?:https?:)?\/\//i, "remote resource (src to another origin)"],
  [/<link\b[^>]*\bhref\s*=\s*["']\s*(?:https?:)?\/\//i, "remote resource (<link href> to another origin)"],
  [/@import\s+url\(\s*["']?(?:https?:)?\/\//i, "remote stylesheet (@import)"],
];

// Allowed, but worth a warning.
const DISCOURAGED = [
  [/<a\b[^>]*\bhref\s*=\s*["']\s*(?:https?:)?\/\//i, "external link: does nothing inside the sandbox, and lessons must be self-contained"],
];

// Patterns forbidden in code labs (CODE-SPEC.md §5). Labs run unsandboxed, so this is a first filter, not a review.
const LAB_FORBIDDEN = [
  [/\.(py)$/i, /^\s*(?:import|from)\s+(?:subprocess|socket|requests|httpx|ftplib|smtplib)\b/, "starting processes or network access"],
  [/\.(py)$/i, /\b(?:urllib\.request|http\.client|urlopen)\b/, "network access"],
  [/\.(py)$/i, /\bos\.(?:system|popen|exec\w*|spawn\w*)\s*\(/, "starting processes"],
  [/\.(py)$/i, /(?<![\w.])(?:eval|exec|__import__)\s*\(/, "evaluating code from strings"],
  [/\.(py)$/i, /\bpickle\.loads?\s*\(/, "loading pickled data (can run code)"],
  [/\.(py)$/i, /\btorch\.load\s*\((?![^)]*weights_only\s*=\s*True)/, "torch.load without weights_only=True (can run code)"],
  [/\.(py)$/i, /\bshutil\.rmtree\s*\(/, "deleting directory trees"],
  [/\.(m?js|ts)$/i, /\b(?:child_process|node:child_process|node:net|node:http|node:https)\b|require\(\s*["'](?:net|http|https)["']\s*\)/, "starting processes or network access"],
  [/\.(m?js|ts)$/i, /\bfetch\s*\(|\bXMLHttpRequest\b|\bnew\s+WebSocket\b/, "network access"],
  [/\.(m?js|ts)$/i, /\beval\s*\(|\bnew\s+Function\s*\(/, "evaluating code from strings"],
];

// ---------- helpers ----------

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const schemas = {};
for (const f of readdirSync(join(SPEC_DIR, "schemas"))) {
  if (!f.endsWith(".schema.json")) continue;
  const s = JSON.parse(readFileSync(join(SPEC_DIR, "schemas", f), "utf8"));
  schemas[f.replace(".schema.json", "")] = ajv.compile(s);
}

const results = { errors: 0, warnings: 0 };
function report(kind, file, msg) {
  results[kind === "error" ? "errors" : "warnings"]++;
  const tag = kind === "error" ? "ERROR" : "warn ";
  console.log(`${tag} ${file}: ${msg}`);
}
const err = (f, m) => report("error", f, m);
const warn = (f, m) => report("warn", f, m);

function schemaErrors(name, data) {
  const validate = schemas[name];
  if (validate(data)) return [];
  return validate.errors.map((e) => `${e.instancePath || "(root)"} ${e.message}${e.params?.allowedValue !== undefined ? ` (${JSON.stringify(e.params.allowedValue)})` : ""}`);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  return { data: YAML.parse(m[1]) ?? {}, body: m[2] };
}

function headings(body) {
  return [...body.matchAll(/^#\s+(.+?)\s*$/gm)].map((m) => m[1]);
}

function sectionText(body, heading) {
  const re = new RegExp(`^#\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$([\\s\\S]*?)(?=^#\\s|(?![\\s\\S]))`, "m");
  const m = body.match(re);
  return m ? m[1] : null;
}

// ---------- integrity ----------

export function integrityOf(simDir, manifestName = existsSync(join(simDir, "lab.json")) ? "lab.json" : "sim.json") {
  const files = walk(simDir)
    .map((p) => relative(simDir, p).split(sep).join("/"))
    .filter((p) => p !== manifestName)
    .sort((a, b) => (Buffer.from(a) < Buffer.from(b) ? -1 : Buffer.from(a) > Buffer.from(b) ? 1 : 0));
  let text = "";
  for (const f of files) {
    const hex = createHash("sha256").update(readFileSync(join(simDir, f))).digest("hex");
    text += `${f}\n${hex}\n`;
  }
  return "sha256-" + createHash("sha256").update(text).digest("base64");
}

/** Tree digest of a whole package directory, manifest included (CATALOG.md §2.1). */
export const digestOf = (dir) => integrityOf(dir, null);

// ---------- simulators ----------

/** Map of package id -> { version -> { dir, manifest } } for every sims/ (or code/) directory given. */
function indexSims(simRoots, manifestName = "sim.json") {
  const index = {};
  for (const root of simRoots) {
    if (!existsSync(root)) continue;
    for (const f of walk(root)) {
      if (!f.endsWith(`${sep}${manifestName}`)) continue;
      const dir = dirname(f);
      let manifest;
      try { manifest = JSON.parse(readFileSync(f, "utf8")); } catch { continue; }
      if (!manifest.id || !manifest.version) continue;
      (index[manifest.id] ??= {})[manifest.version] ??= { dir, manifest };
    }
  }
  return index;
}

function checkSim(dir) {
  const file = join(dir, "sim.json");
  let m;
  try { m = JSON.parse(readFileSync(file, "utf8")); } catch (e) { return err(file, `invalid JSON: ${e.message}`); }
  for (const e of schemaErrors("sim-manifest", m)) err(file, e);

  const dirVersion = dir.split(sep).pop();
  if (m.version && dirVersion !== m.version) err(file, `version ${m.version} does not match directory name ${dirVersion}`);
  const simName = dir.split(sep).slice(-2, -1)[0];
  if (m.id && !m.id.endsWith(`/${simName}`)) warn(file, `id ${m.id} does not end with directory name ${simName}`);

  const entry = join(dir, m.entry || "index.html");
  if (!existsSync(entry)) err(file, `entry file ${m.entry || "index.html"} missing`);
  if (!existsSync(join(dir, "ptf-sim.js"))) err(file, "ptf-sim.js runtime missing (SIMULATOR-SPEC.md §4.4)");
  if (!existsSync(join(dir, "test.json"))) warn(file, "no test.json self-test (SIMULATOR-SPEC.md §6)");

  if (m.integrity) {
    const actual = integrityOf(dir);
    if (actual !== m.integrity) err(file, `integrity mismatch: sim.json has ${m.integrity}, files hash to ${actual} (run: ptf-check hash --write ${dir})`);
  }

  // Vendored libraries (SIMULATOR-SPEC.md §8): allowlisted builds, byte-identical, declared in sim.json.
  const vendored = new Set();
  for (const v of m.vendor ?? []) {
    const p = join(dir, v.path ?? "");
    const allowed = ALLOWLIST[v.build];
    if (!v.path || !existsSync(p)) { err(file, `vendor ${v.build}: file ${v.path} missing`); continue; }
    if (!allowed) { err(file, `vendor ${v.build} is not on the ptf-spec allowlist (SIMULATOR-SPEC.md §8.2)`); continue; }
    const hex = createHash("sha256").update(readFileSync(p)).digest("hex");
    if (hex !== v.sha256) err(file, `vendor ${v.build}: ${v.path} does not match its declared sha256`);
    else if (hex !== allowed.sha256) err(file, `vendor ${v.build}: ${v.path} differs from the allowlisted build (copy it with ptf-vendor add)`);
    else vendored.add(resolve(p));
  }

  let total = 0, own = 0;
  for (const f of walk(dir)) {
    total += statSync(f).size;
    const rel = relative(dir, f).split(sep).join("/");
    if (vendored.has(resolve(f))) continue;   // verified upstream code: not scanned, not counted towards the 300 KB recommendation
    own += statSync(f).size;
    if (rel.startsWith("vendor/") && /\.m?js$/i.test(rel)) err(`${relative(process.cwd(), f)}`, "script in vendor/ that is not a declared, allowlisted build (SIMULATOR-SPEC.md §8)");
    if (!/\.(html?|js|mjs|css|svg)$/i.test(f) || f.endsWith(`${sep}ptf-sim.js`)) continue;
    const src = readFileSync(f, "utf8");
    const lines = src.split("\n");
    for (const [re, what] of FORBIDDEN) {
      const i = lines.findIndex((l) => re.test(l));
      if (i >= 0) err(`${relative(process.cwd(), f)}:${i + 1}`, `forbidden in simulators: ${what}`);
    }
    for (const [re, what] of DISCOURAGED) {
      const i = lines.findIndex((l) => re.test(l));
      if (i >= 0) warn(`${relative(process.cwd(), f)}:${i + 1}`, what);
    }
  }
  if (total > MAX_PACKAGE_BYTES) err(file, `package is ${(total / 1024).toFixed(0)} KB, limit is 5 MB`);
  else if (own > WARN_PACKAGE_BYTES) warn(file, `package is ${(own / 1024).toFixed(0)} KB without vendored libraries, recommended below 300 KB`);

  const html = existsSync(entry) ? readFileSync(entry, "utf8") : "";
  if (html && !/PTF\.connect\s*\(/.test(html)) warn(file, "entry does not call PTF.connect()");
  if (/<script\b[^>]*\btype\s*=\s*["']module["']/i.test(html)) warn(file, "ES module scripts cannot resolve imports when a host inlines the package into srcdoc; use classic scripts and vendored IIFE builds (SIMULATOR-SPEC.md §8.3)");
  for (const st of m.stations ?? []) {
    if (html && !html.includes(`data-station="${st.id}"`)) warn(file, `station ${st.id} has no element with data-station="${st.id}"`);
  }
}

// ---------- code labs ----------

function checkCode(dir) {
  const file = join(dir, "lab.json");
  let m;
  try { m = JSON.parse(readFileSync(file, "utf8")); } catch (e) { return err(file, `invalid JSON: ${e.message}`); }
  for (const e of schemaErrors("code-manifest", m)) err(file, e);

  const dirVersion = dir.split(sep).pop();
  if (m.version && dirVersion !== m.version) err(file, `version ${m.version} does not match directory name ${dirVersion}`);
  const labName = dir.split(sep).slice(-2, -1)[0];
  if (m.id && !m.id.endsWith(`/${labName}`)) warn(file, `id ${m.id} does not end with directory name ${labName}`);
  if (!existsSync(join(dir, "README.md"))) err(file, "README.md missing (CODE-SPEC.md §1)");

  const ids = new Set();
  for (const st of m.steps ?? []) {
    if (st.id && ids.has(st.id)) err(file, `duplicate step id "${st.id}"`);
    ids.add(st.id);
    if (st.file && !existsSync(join(dir, st.file))) err(file, `step ${st.id}: file ${st.file} missing`);
    if (st.expect) { try { new RegExp(st.expect); } catch (e) { err(file, `step ${st.id}: expect is not a valid regular expression: ${e.message}`); } }
  }
  for (const d of m.data ?? []) if (d.path && !existsSync(join(dir, d.path))) err(file, `data file ${d.path} missing`);
  for (const junk of ["out", "__pycache__", "node_modules"]) {
    if (existsSync(join(dir, junk)) || walk(dir).some((f) => f.split(sep).includes(junk))) warn(file, `package contains ${junk}/; remove run outputs before hashing`);
  }

  if (m.integrity) {
    const actual = integrityOf(dir, "lab.json");
    if (actual !== m.integrity) err(file, `integrity mismatch: lab.json has ${m.integrity}, files hash to ${actual} (run: ptf-check hash --write ${dir})`);
  }

  let total = 0;
  for (const f of walk(dir)) {
    total += statSync(f).size;
    const lines = LAB_FORBIDDEN.some(([ext]) => ext.test(f)) ? readFileSync(f, "utf8").split("\n") : [];
    for (const [ext, re, what] of LAB_FORBIDDEN) {
      if (!ext.test(f)) continue;
      const i = lines.findIndex((l) => re.test(l) && !/^\s*(#|\/\/)/.test(l));
      if (i >= 0) err(`${relative(process.cwd(), f)}:${i + 1}`, `forbidden in code labs: ${what}`);
    }
  }
  if (total > MAX_LAB_BYTES) err(file, `lab is ${(total / 1024 / 1024).toFixed(1)} MB, limit is 20 MB`);
  else if (total > WARN_LAB_BYTES) warn(file, `lab is ${(total / 1024 / 1024).toFixed(1)} MB, recommended below 5 MB`);
}

// ---------- bundles ----------

function resolveRef(ref, simIndex) {
  const at = ref.lastIndexOf("@");
  const id = ref.slice(0, at), range = ref.slice(at + 1);
  const versions = Object.keys(simIndex[id] ?? {});
  const best = semver.maxSatisfying(versions, range);
  return { id, range, versions, best };
}

function checkBundle(bundleDir, simIndex, codeIndex = {}) {
  const indexFile = join(bundleDir, "index.md");
  const idx = parseFrontmatter(readFileSync(indexFile, "utf8"));
  const bundleId = idx.data.id;
  for (const e of schemaErrors("bundle-index", idx.data)) err(indexFile, e);
  const levels = new Set([...DEFAULT_LEVELS, ...(idx.data.levels ?? []).map((l) => l.id)]);

  const elementIds = new Set();
  const primaries = new Map();   // primary Wikidata item -> element, within this bundle
  const elements = [];
  const paths = [];

  for (const f of walk(bundleDir)) {
    if (!f.endsWith(".md")) continue;
    const name = f.split(sep).pop();
    if (name === "index.md" || name === "log.md") continue;
    const rel = relative(bundleDir, f);
    if (rel.split(sep)[0] === "media") continue;   // transcripts and media scripts, not documents
    const fm = parseFrontmatter(readFileSync(f, "utf8"));
    if (!fm) { err(f, "no YAML frontmatter (OKF requires it)"); continue; }
    if (!fm.data.type) { err(f, "frontmatter has no type (OKF requires it)"); continue; }
    if (fm.data.type === "Learning Element") elements.push({ f, rel, fm });
    else if (fm.data.type === "Learning Path") paths.push({ f, rel, fm });
  }

  const figures = checkFigures(bundleDir);
  const usedFigures = new Set();
  const usedMedia = new Set();   // files under media/ that an element lists

  for (const { f, rel, fm } of elements) {
    const d = fm.data;
    for (const e of schemaErrors("learning-element", d)) err(f, e);
    const expected = `ptf:el/${bundleId}/${rel.replace(/\.md$/, "").split(sep).pop()}`;
    if (d.id && d.id !== expected) warn(f, `id ${d.id} differs from the expected ${expected}`);
    if (d.id) elementIds.add(d.id);
    const primary = d.about?.[0]?.wikidata;
    if (!primary && (d.status === "reviewed" || d.status === "proven")) warn(f, `status ${d.status} without \`about\` (SPEC.md §6.6)`);
    if (primary && primaries.has(primary)) warn(f, `primary concept ${primary} is also the primary concept of ${primaries.get(primary)} (SPEC.md §6.6)`);
    else if (primary) primaries.set(primary, d.id ?? rel);
    for (const l of d.levels ?? []) if (!levels.has(l)) err(f, `unknown level "${l}" (define it in index.md levels)`);

    const hs = headings(fm.body);
    for (const req of ["Core", "Misconceptions"]) if (!hs.includes(req)) err(f, `missing required heading "# ${req}"`);
    if (!d.objectives?.length) warn(f, "no `objectives`: say what the learner can do after this step (SPEC.md §6.1)");
    const objIds = new Set();
    for (const o of d.objectives ?? []) {
      if (typeof o === "string") continue;
      if (objIds.has(o.id)) err(f, `duplicate objective id "${o.id}"`);
      objIds.add(o.id);
    }
    if ((d.objectives ?? []).some((o) => typeof o === "string")) warn(f, "objectives without `id`: write them as `{ id, text }` so questions and completions can refer to them (SPEC.md §6.1)");
    const textLevels = new Set();
    for (const h of hs) {
      const lm = h.match(/^Level:\s*([a-z0-9-]+)/);
      if (lm) textLevels.add(lm[1]);
      if (lm && !(d.levels ?? []).includes(lm[1])) warn(f, `"# ${h}" is not in the element's levels`);
    }
    if (textLevels.size) {
      for (const l of d.levels ?? []) if (!textLevels.has(l)) warn(f, `no "# Level: ${l}" text while other levels have one; every level covers the whole concept (SPEC.md §5.2)`);
    }
    if (/\b(im Video|in the video|bei \d+:\d\d|at \d+:\d\d)\b/i.test(fm.body.replace(/^# (?:Further reading|Sources)[\s\S]*$/m, ""))) {
      warn(f, "body seems to refer to source material; lessons must be self-contained (SPEC.md §6.2)");
    }

    const misText = sectionText(fm.body, "Misconceptions") ?? "";
    const misIds = new Set([...misText.matchAll(/\*\*([a-z0-9][a-z0-9-]*)\*\*/g)].map((m) => m[1]));
    if (misText && misIds.size === 0) warn(f, "misconceptions have no **id** markers (SPEC.md §6.4)");

    const mediaIds = checkElementMedia(bundleDir, f, d, objIds, usedMedia);

    const qIds = new Set();
    const checkLevels = new Set();
    const covered = new Set();   // "<level> <objective>"
    const questions = new Map();
    for (const m of fm.body.matchAll(/```ptf-question\s*\n([\s\S]*?)```/g)) {
      let q;
      try { q = JSON.parse(m[1]); } catch (e) { err(f, `ptf-question block is not valid JSON: ${e.message}`); continue; }
      const where = `${f}#${q.id ?? "?"}`;
      for (const e of schemaErrors("question-block", q)) err(where, e);
      if (q.id) { if (qIds.has(q.id)) err(where, "duplicate question id"); qIds.add(q.id); questions.set(q.id, q); }
      if (["check", "probe"].includes(q.purpose ?? "check") && q.level) {
        checkLevels.add(q.level);
        for (const o of q.objectives ?? []) covered.add(`${q.level} ${o}`);
        if (objIds.size && !q.objectives?.length) warn(where, "check question without `objectives`: name the objective IDs it checks (SPEC.md §7)");
      }
      for (const o of q.objectives ?? []) if (!objIds.has(o)) err(where, `objective "${o}" is not an objective id of this element`);
      if (q.level && !(d.levels ?? []).includes(q.level)) warn(where, `question level "${q.level}" is not in the element's levels`);
      if (q.misconception && !misIds.has(q.misconception)) err(where, `misconception "${q.misconception}" is not defined under # Misconceptions`);
      if (q.media && !mediaIds.has(q.media)) err(where, `media "${q.media}" is not in the element's \`media\` list (SPEC.md §6.9)`);
      if (q.plays && !q.media) warn(where, "`plays` without `media` has no effect");
      if (q.kind === "cloze" && q.text && q.gaps) {
        const n = (q.text.match(/\{\{\d+\}\}/g) ?? []).length;
        if (n !== q.gaps.length) err(where, `cloze has ${n} gaps in text but ${q.gaps.length} in gaps`);
      }
    }

    checkAnswers(bundleDir, rel, f, questions);

    for (const l of d.levels ?? []) if (!checkLevels.has(l)) warn(f, `level "${l}" has no \`check\` or \`probe\` question; every level tests the whole concept at its depth (SPEC.md §5.2)`);
    if (objIds.size) {
      const gaps = (d.levels ?? []).filter((l) => checkLevels.has(l))
        .map((l) => [l, [...objIds].filter((o) => !covered.has(`${l} ${o}`))]).filter(([, os]) => os.length);
      if (gaps.length) warn(f, `objectives without a check question: ${gaps.map(([l, os]) => `${l}: ${os.join(", ")}`).join("; ")} (SPEC.md §7)`);
    }

    for (const s of d.simulators ?? []) {
      if (!s.ref || !s.ref.includes("@")) continue;
      const r = resolveRef(s.ref, simIndex);
      if (!r.versions.length) { err(f, `simulator ${r.id} not found`); continue; }
      if (!r.best) { err(f, `no version of ${r.id} satisfies ${r.range} (have ${r.versions.join(", ")})`); continue; }
      const m = simIndex[r.id][r.best].manifest;
      if (s.station && !(m.stations ?? []).some((st) => st.id === s.station)) err(f, `simulator ${r.id}@${r.best} has no station "${s.station}"`);
      for (const l of s.levels ?? []) if (!(m.levels ?? []).includes(l)) warn(f, `simulator ${r.id}@${r.best} does not list level "${l}"`);
    }

    for (const fig of d.figures ?? []) {
      if (!fig?.id) continue;
      usedFigures.add(fig.id);
      if (!figures.has(fig.id)) {
        if (!existsSync(join(bundleDir, "figures", `${fig.id}.svg`))) err(f, `figure "${fig.id}" not found: expected figures/${fig.id}.svg (SPEC.md §6.8)`);
        continue;
      }
      for (const o of fig.objectives ?? []) if (objIds.size && !objIds.has(o)) err(f, `figure "${fig.id}" names objective "${o}", which is not an objective id of this element`);
      for (const l of fig.levels ?? []) if (!(d.levels ?? []).includes(l)) warn(f, `figure "${fig.id}" level "${l}" is not in the element's levels`);
    }
    for (const m of fm.body.matchAll(/figures\/([a-z0-9][a-z0-9-]*)(?:\.[a-z-]+)?\.svg/gi)) {
      if (!(d.figures ?? []).some((x) => x?.id === m[1])) warn(f, `body mentions figures/${m[1]}.svg but frontmatter \`figures\` does not list it, so tutors will not find it (SPEC.md §6.8)`);
    }

    for (const c of d.code ?? []) {
      if (!c.ref || !c.ref.includes("@")) continue;
      const r = resolveRef(c.ref, codeIndex);
      if (!r.versions.length) { err(f, `code lab ${r.id} not found`); continue; }
      if (!r.best) { err(f, `no version of ${r.id} satisfies ${r.range} (have ${r.versions.join(", ")})`); continue; }
      const m = codeIndex[r.id][r.best].manifest;
      if (c.step && !(m.steps ?? []).some((st) => st.id === c.step)) err(f, `code lab ${r.id}@${r.best} has no step "${c.step}"`);
      for (const l of c.levels ?? []) if (!(m.levels ?? []).includes(l)) warn(f, `code lab ${r.id}@${r.best} does not list level "${l}"`);
    }
  }

  for (const { f, rel, fm } of [...elements, ...paths]) {
    // Entries with a `catalog` live in another library and are not checked here (SPEC.md §6.1, §8.1).
    const local = (r) => (typeof r === "string" ? r : r && !r.catalog ? r.id ?? r.element : null);
    for (const ref of [...(fm.data.requires ?? []), ...(fm.data.leads_to ?? []), ...(fm.data.steps ?? [])].map(local)) {
      if (ref && ref.startsWith(`ptf:el/${bundleId}/`) && !elementIds.has(ref)) err(f, `reference ${ref} does not exist in this bundle`);
    }
    for (const m of fm.body.matchAll(/\]\(([^)#\s]+\.md)(#[^)]*)?\)/g)) {
      if (/^[a-z]+:/i.test(m[1])) continue;
      const target = m[1].startsWith("/") ? join(bundleDir, m[1]) : join(dirname(f), m[1]);
      if (!existsSync(target)) warn(f, `link ${m[1]} does not resolve`);
    }
    void rel;
  }

  for (const id of figures.keys()) if (!usedFigures.has(id)) warn(join(bundleDir, "figures", `${id}.svg`), "no element lists this figure in `figures`");
  const mediaDir = join(bundleDir, "media");
  if (existsSync(mediaDir)) {
    for (const file of walk(mediaDir)) {
      const r = relative(bundleDir, file).split(sep).join("/");
      if (!r.startsWith("media/src/") && !usedMedia.has(r)) warn(file, "no element lists this file in `media` (as src or transcript)");
    }
  }

  for (const { f, fm } of paths) for (const e of schemaErrors("learning-path", fm.data)) err(f, e);

  const lockFile = join(bundleDir, "ptf.lock");
  if (existsSync(lockFile)) {
    let lock;
    try { lock = JSON.parse(readFileSync(lockFile, "utf8")); } catch (e) { return err(lockFile, `invalid JSON: ${e.message}`); }
    for (const e of schemaErrors("lockfile", lock)) err(lockFile, e);
    for (const [id, entry] of Object.entries(lock.simulators ?? {})) {
      const found = simIndex[id]?.[entry.version];
      if (!found) { err(lockFile, `${id}@${entry.version} not found`); continue; }
      if (found.manifest.integrity !== entry.integrity) err(lockFile, `${id}@${entry.version} integrity differs from its sim.json`);
    }
    for (const [id, entry] of Object.entries(lock.code ?? {})) {
      const found = codeIndex[id]?.[entry.version];
      if (!found) { err(lockFile, `${id}@${entry.version} not found`); continue; }
      if (found.manifest.integrity !== entry.integrity) err(lockFile, `${id}@${entry.version} integrity differs from its lab.json`);
    }
  }
  return elements.length + paths.length;
}

// ---------- media (SPEC.md §6.9) ----------

/** Checks the `media` list of an element; returns the ids of its entries. */
function checkElementMedia(bundleDir, f, d, objIds, usedMedia) {
  const ids = new Set();
  for (const m of d.media ?? []) {
    if (!m?.id) continue;
    const where = `${f}#media:${m.id}`;
    if (ids.has(m.id)) err(where, "duplicate media id");
    ids.add(m.id);
    for (const o of m.objectives ?? []) if (objIds.size && !objIds.has(o)) err(where, `objective "${o}" is not an objective id of this element`);
    for (const l of m.levels ?? []) if (!(d.levels ?? []).includes(l)) warn(where, `level "${l}" is not in the element's levels`);
    const type = m.src ? MEDIA_TYPES[extOf(m.src)] : null;
    if (m.src && !type) err(where, `src must end in ${Object.keys(MEDIA_TYPES).map((e) => "." + e).join(", ")}`);
    else if (type && m.kind && type.kind !== m.kind) err(where, `src is ${type.kind} (.${extOf(m.src)}) but kind is ${m.kind}`);
    if (m.kind === "video" && m.transcript && !m.transcript.endsWith(".vtt")) err(where, "a video needs captions as a .vtt transcript");
    if (m.src?.startsWith("media/")) {
      usedMedia.add(m.src);
      const file = join(bundleDir, m.src);
      if (!existsSync(file)) err(where, `file ${m.src} not found`);
      else {
        const buf = readFileSync(file);
        if (buf.length > MAX_MEDIA_BYTES) err(where, `${m.src} has ${(buf.length / 1048576).toFixed(1)} MiB; files over 10 MiB go to an https URL (SPEC.md §6.9)`);
        if (m.bytes != null && buf.length !== m.bytes) err(where, `bytes is ${m.bytes}, the file has ${buf.length}`);
        if (m.sha256 && sha256Hex(buf) !== m.sha256) err(where, `sha256 does not match ${m.src}; recompute it after changing the file`);
        if (type && !sniffMedia(buf, extOf(m.src))) err(where, `${m.src} is not an ${extOf(m.src).toUpperCase()} file`);
        const dur = probeDuration(file);
        if (dur != null && m.duration_s != null && Math.abs(dur - m.duration_s) > Math.max(1, dur * 0.02)) err(where, `duration_s is ${m.duration_s}, the file plays ${dur.toFixed(1)} s`);
      }
    }
    if (m.transcript) {
      usedMedia.add(m.transcript);
      const tf = join(bundleDir, m.transcript);
      if (!existsSync(tf)) err(where, `transcript ${m.transcript} not found`);
      else {
        const raw = readFileSync(tf, "utf8");
        if (m.transcript.endsWith(".vtt") && !/^\uFEFF?WEBVTT/.test(raw)) err(where, `${m.transcript} does not start with WEBVTT`);
        const words = wordCount(transcriptText(raw, m.transcript));
        if (!words) err(where, `transcript ${m.transcript} is empty`);
        else if (m.duration_s > 0) {
          const wpm = words / (m.duration_s / 60);
          if (wpm < 40 || wpm > 240) warn(where, `transcript has ${words} words for ${m.duration_s} s (${Math.round(wpm)} words per minute); does it match the file?`);
        }
      }
    }
  }
  return ids;
}

// SPEC.md §7.1: checks/<element>.js recomputes the answers of the element's questions.
const isNumeric = (a) => /^\s*[−-]?[\d\s.,]*\d\s*$/.test(String(a ?? ""));
function checkAnswers(bundleDir, rel, f, questions) {
  const name = rel.split(sep).pop().replace(/\.md$/, "");
  const file = join(bundleDir, "checks", `${name}.js`);
  let checked = new Set();
  if (existsSync(file)) {
    const r = runChecks(readFileSync(file, "utf8"), file, questions);
    for (const p of r.problems) err(p.id ? `${file}#${p.id}` : file, p.msg);
    checked = r.checked;
  }
  const missing = [...questions.values()].filter((q) => !checked.has(q.id) && (COMPUTED_KINDS.has(q.kind)
    || (q.kind === "cloze" && (q.gaps ?? []).some((g) => isNumeric(g.answer)))
    || (q.kind === "guess_next" && isNumeric(q.answer))));
  if (missing.length) warn(f, `computed answers without a check in checks/${name}.js: ${missing.map((q) => q.id).join(", ")} (SPEC.md §7.1)`);
}

// ---------- figures (SPEC.md §6.8) ----------

/** Checks figures/ of a bundle; returns the set of figure ids that have a valid canonical file. */
function checkFigures(bundleDir) {
  const dir = join(bundleDir, "figures");
  const ok = new Map();
  if (!existsSync(dir)) return ok;
  const { figures, misnamed } = figureFiles(dir, readdirSync(dir).filter((n) => !n.startsWith(".") && statSync(join(dir, n)).isFile()));
  for (const n of misnamed) err(join(dir, n), "figures/ holds only <id>.svg and translations <id>.<lang>.svg (SPEC.md §6.8)");
  for (const [id, entry] of figures) {
    const results = new Map();
    for (const file of [entry.file, ...entry.langs.values()].filter(Boolean)) {
      const r = checkFigure(readFileSync(file, "utf8"));
      for (const e of r.errors) err(file, e);
      for (const w of r.warnings) warn(file, w);
      results.set(file, r);
    }
    if (!entry.file) { err(join(dir, `${id}.svg`), `translations exist (${[...entry.langs.keys()].join(", ")}) but the canonical figures/${id}.svg is missing`); continue; }
    const canon = results.get(entry.file);
    if (canon.errors.length) continue;
    ok.set(id, canon.info);
    const steps = canon.info.steps.length;
    for (const [lang, file] of entry.langs) {
      const t = results.get(file);
      if (t.info && t.info.steps.length !== steps) err(file, `has ${t.info.steps.length} step(s), the canonical figure ${steps}; a translation changes words only`);
      if (t.info && (t.info.width !== canon.info.width || t.info.height !== canon.info.height)) warn(file, `viewBox differs from the canonical figure (${lang})`);
    }
  }
  return ok;
}

function findBundles(root) {
  const bundles = [];
  for (const f of walk(root)) {
    if (!f.endsWith(`${sep}index.md`) && f !== join(root, "index.md")) continue;
    const fm = parseFrontmatter(readFileSync(f, "utf8"));
    if (fm?.data?.type === "Bundle") bundles.push(dirname(f));
  }
  return bundles;
}

function simRootsFor(bundleDir, libraryRoot, kind = "sims") {
  const roots = [join(bundleDir, kind)];
  let d = bundleDir;
  while (true) {
    roots.push(join(d, kind));
    if (resolve(d) === resolve(libraryRoot) || dirname(d) === d) break;
    d = dirname(d);
  }
  return [...new Set(roots)];
}

// ---------- catalogs ----------

const CATALOG_FILE = "ptf-catalog.json";

/** Every package of a library as catalog entries (CATALOG.md §2), sorted. */
function catalogPackages(root, onError = err) {
  const bundles = findBundles(root);
  const inBundle = (d) => bundles.some((b) => d.startsWith(b + sep));
  const rel = (d) => relative(root, d).split(sep).join("/");
  const out = [];
  for (const b of bundles) {
    const file = join(b, "index.md");
    const fm = parseFrontmatter(readFileSync(file, "utf8"))?.data ?? {};
    if (!fm.version) { onError(file, "a bundle needs a version to be listed in ptf-catalog.json"); continue; }
    out.push({ kind: "bundle", id: fm.id, version: String(fm.version), title: fm.title, ...(fm.description ? { summary: fm.description } : {}), path: rel(b), digest: digestOf(b) });
  }
  for (const [kind, manifestName] of [["sim", "sim.json"], ["code", "lab.json"]]) {
    for (const f of walk(root)) {
      if (!f.endsWith(`${sep}${manifestName}`)) continue;
      const d = dirname(f);
      if (inBundle(d)) continue;
      let m;
      try { m = JSON.parse(readFileSync(f, "utf8")); } catch { continue; }
      if (!m.id || !m.version) continue;
      out.push({ kind, id: m.id, version: m.version, title: m.title ?? m.id, ...(m.description ? { summary: m.description } : {}), path: rel(d), digest: digestOf(d) });
    }
  }
  const order = { bundle: 0, sim: 1, code: 2 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) || semver.compare(a.version, b.version));
}

function buildCatalog(root) {
  const file = join(root, CATALOG_FILE);
  const base = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : { ptf_catalog: "0.1", id: `local.${root.split(sep).pop().toLowerCase().replace(/[^a-z0-9-]+/g, "-")}`, title: root.split(sep).pop(), publisher: "unknown", auth: { type: "none" }, cache: "shared" };
  return { ...base, packages: catalogPackages(root, (f, m) => { console.error(`${f}: ${m}`); process.exitCode = 1; }) };
}

function checkCatalog(root) {
  const file = join(root, CATALOG_FILE);
  let c;
  try { c = JSON.parse(readFileSync(file, "utf8")); } catch (e) { return err(file, `invalid JSON: ${e.message}`); }
  for (const e of schemaErrors("catalog", c)) err(file, e);
  if (!Array.isArray(c.packages)) return;
  const key = (p) => `${p.kind} ${p.id}@${p.version}`;
  const listed = new Map(c.packages.map((p) => [key(p), p]));
  if (listed.size !== c.packages.length) err(file, "a package is listed twice");
  const actual = catalogPackages(root, () => {});
  const found = new Map(actual.map((p) => [key(p), p]));
  for (const [k, p] of listed) {
    if (!p.path) continue;
    const a = found.get(k);
    if (!a) err(file, `${k}: no such package in this library`);
    else if (a.path !== p.path) err(file, `${k}: path is ${a.path}, not ${p.path}`);
    else if (a.digest !== p.digest) err(file, `${k}: digest differs from the files (run: ptf-check catalog --write ${root})`);
  }
  for (const k of found.keys()) if (!listed.has(k)) err(file, `${k} is not listed (run: ptf-check catalog --write ${root})`);
}

// ---------- commands ----------

function cmdCheck(root) {
  root = resolve(root);
  const simDirs = walk(root).filter((f) => f.endsWith(`${sep}sim.json`)).map(dirname);
  for (const d of simDirs) checkSim(d);
  const labDirs = walk(root).filter((f) => f.endsWith(`${sep}lab.json`)).map(dirname);
  for (const d of labDirs) checkCode(d);
  const bundles = findBundles(root);
  let docs = 0;
  for (const b of bundles) docs += checkBundle(b, indexSims(simRootsFor(b, root)), indexSims(simRootsFor(b, root, "code"), "lab.json"));
  if (existsSync(join(root, CATALOG_FILE))) checkCatalog(root);
  const labs = labDirs.length ? `, ${labDirs.length} code lab version(s)` : "";
  console.log(`\nptf-check: ${bundles.length} bundle(s), ${docs} document(s), ${simDirs.length} simulator version(s)${labs} · ${results.errors} error(s), ${results.warnings} warning(s)`);
  process.exit(results.errors ? 1 : 0);
}

function cmdHash(args) {
  const write = args.includes("--write");
  const dir = resolve(args.find((a) => a !== "--write") ?? ".");
  const h = integrityOf(dir);
  if (write) {
    const file = join(dir, existsSync(join(dir, "lab.json")) ? "lab.json" : "sim.json");
    const m = JSON.parse(readFileSync(file, "utf8"));
    m.integrity = h;
    writeFileSync(file, JSON.stringify(m, null, 2) + "\n");
  }
  console.log(h);
}

function cmdLock(dir, libraryRoot) {
  dir = resolve(dir);
  const root = resolve(libraryRoot ?? join(dir, "..", ".."));
  const indexes = { simulators: indexSims(simRootsFor(dir, root)), code: indexSims(simRootsFor(dir, root, "code"), "lab.json") };
  const lock = { simulators: {}, code: {} };
  for (const f of walk(dir)) {
    if (!f.endsWith(".md")) continue;
    const fm = parseFrontmatter(readFileSync(f, "utf8"));
    for (const kind of ["simulators", "code"]) {
      for (const s of fm?.data?.[kind] ?? []) {
        const r = resolveRef(s.ref, indexes[kind]);
        if (!r.best) { console.error(`cannot resolve ${s.ref}`); process.exit(1); }
        const prev = lock[kind][r.id];
        if (prev && prev.version !== r.best) { console.error(`conflicting versions for ${r.id}: ${prev.version} vs ${r.best}`); process.exit(1); }
        lock[kind][r.id] = { version: r.best, integrity: indexes[kind][r.id][r.best].manifest.integrity };
      }
    }
  }
  const out = { lockfileVersion: 1, simulators: Object.fromEntries(Object.entries(lock.simulators).sort()) };
  if (Object.keys(lock.code).length) out.code = Object.fromEntries(Object.entries(lock.code).sort());
  writeFileSync(join(dir, "ptf.lock"), JSON.stringify(out, null, 2) + "\n");
  const labs = out.code ? `, ${Object.keys(out.code).length} code lab(s)` : "";
  console.log(`wrote ${join(dir, "ptf.lock")} (${Object.keys(out.simulators).length} simulator(s)${labs})`);
}

function cmdCatalog(args) {
  const write = args.includes("--write");
  const root = resolve(args.find((a) => a !== "--write") ?? ".");
  const text = JSON.stringify(buildCatalog(root), null, 2) + "\n";
  if (write) {
    writeFileSync(join(root, CATALOG_FILE), text);
    console.log(`wrote ${join(root, CATALOG_FILE)}`);
  } else process.stdout.write(text);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "hash") cmdHash(rest);
else if (cmd === "lock") cmdLock(rest[0] ?? ".", rest[1]);
else if (cmd === "catalog") cmdCatalog(rest);
else if (cmd === "-h" || cmd === "--help") console.log("usage: ptf-check [dir] | hash [--write] <sim-or-lab-dir> | lock <bundle-dir> [library-root] | catalog [--write] <library-root>");
else cmdCheck(cmd ?? ".");
