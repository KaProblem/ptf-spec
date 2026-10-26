#!/usr/bin/env node
// ptf-check: validator for Personal Tutor Format libraries, bundles, simulator packages and code labs.
//
//   ptf-check [dir]              validate everything found under dir (default: .)
//   ptf-check hash <pkg-dir>     print the integrity hash of a simulator package or code lab
//   ptf-check hash --write <pkg-dir>   ... and write it into sim.json / lab.json
//   ptf-check lock <bundle-dir>  write ptf.lock with the highest version matching each range
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

const SPEC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_LEVELS = ["child", "highschool", "college", "expert"];
const MAX_PACKAGE_BYTES = 5 * 1024 * 1024;
const WARN_PACKAGE_BYTES = 300 * 1024;
const MAX_LAB_BYTES = 20 * 1024 * 1024;
const WARN_LAB_BYTES = 5 * 1024 * 1024;

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

  let total = 0;
  for (const f of walk(dir)) {
    total += statSync(f).size;
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
  else if (total > WARN_PACKAGE_BYTES) warn(file, `package is ${(total / 1024).toFixed(0)} KB, recommended below 300 KB`);

  const html = existsSync(entry) ? readFileSync(entry, "utf8") : "";
  if (html && !/PTF\.connect\s*\(/.test(html)) warn(file, "entry does not call PTF.connect()");
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
  const elements = [];
  const paths = [];

  for (const f of walk(bundleDir)) {
    if (!f.endsWith(".md")) continue;
    const name = f.split(sep).pop();
    if (name === "index.md" || name === "log.md") continue;
    const rel = relative(bundleDir, f);
    const fm = parseFrontmatter(readFileSync(f, "utf8"));
    if (!fm) { err(f, "no YAML frontmatter (OKF requires it)"); continue; }
    if (!fm.data.type) { err(f, "frontmatter has no type (OKF requires it)"); continue; }
    if (fm.data.type === "Learning Element") elements.push({ f, rel, fm });
    else if (fm.data.type === "Learning Path") paths.push({ f, rel, fm });
  }

  for (const { f, rel, fm } of elements) {
    const d = fm.data;
    for (const e of schemaErrors("learning-element", d)) err(f, e);
    const expected = `ptf:el/${bundleId}/${rel.replace(/\.md$/, "").split(sep).pop()}`;
    if (d.id && d.id !== expected) warn(f, `id ${d.id} differs from the expected ${expected}`);
    if (d.id) elementIds.add(d.id);
    for (const l of d.levels ?? []) if (!levels.has(l)) err(f, `unknown level "${l}" (define it in index.md levels)`);

    const hs = headings(fm.body);
    for (const req of ["Core", "Misconceptions"]) if (!hs.includes(req)) err(f, `missing required heading "# ${req}"`);
    for (const h of hs) {
      const lm = h.match(/^Level:\s*([a-z0-9-]+)/);
      if (lm && !(d.levels ?? []).includes(lm[1])) warn(f, `"# ${h}" is not in the element's levels`);
    }
    if (/\b(im Video|in the video|bei \d+:\d\d|at \d+:\d\d)\b/i.test(fm.body.replace(/^# (?:Further reading|Sources)[\s\S]*$/m, ""))) {
      warn(f, "body seems to refer to source material; lessons must be self-contained (SPEC.md §6.2)");
    }

    const misText = sectionText(fm.body, "Misconceptions") ?? "";
    const misIds = new Set([...misText.matchAll(/\*\*([a-z0-9][a-z0-9-]*)\*\*/g)].map((m) => m[1]));
    if (misText && misIds.size === 0) warn(f, "misconceptions have no **id** markers (SPEC.md §6.4)");

    const qIds = new Set();
    for (const m of fm.body.matchAll(/```ptf-question\s*\n([\s\S]*?)```/g)) {
      let q;
      try { q = JSON.parse(m[1]); } catch (e) { err(f, `ptf-question block is not valid JSON: ${e.message}`); continue; }
      const where = `${f}#${q.id ?? "?"}`;
      for (const e of schemaErrors("question-block", q)) err(where, e);
      if (q.id) { if (qIds.has(q.id)) err(where, "duplicate question id"); qIds.add(q.id); }
      if (q.level && !(d.levels ?? []).includes(q.level)) warn(where, `question level "${q.level}" is not in the element's levels`);
      if (q.misconception && !misIds.has(q.misconception)) err(where, `misconception "${q.misconception}" is not defined under # Misconceptions`);
      if (q.kind === "cloze" && q.text && q.gaps) {
        const n = (q.text.match(/\{\{\d+\}\}/g) ?? []).length;
        if (n !== q.gaps.length) err(where, `cloze has ${n} gaps in text but ${q.gaps.length} in gaps`);
      }
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
    for (const ref of [...(fm.data.requires ?? []), ...(fm.data.leads_to ?? []), ...(fm.data.steps ?? []).map((s) => s.element)]) {
      if (ref && ref.startsWith(`ptf:el/${bundleId}/`) && !elementIds.has(ref)) err(f, `reference ${ref} does not exist in this bundle`);
    }
    for (const m of fm.body.matchAll(/\]\(([^)#\s]+\.md)(#[^)]*)?\)/g)) {
      if (/^[a-z]+:/i.test(m[1])) continue;
      const target = m[1].startsWith("/") ? join(bundleDir, m[1]) : join(dirname(f), m[1]);
      if (!existsSync(target)) warn(f, `link ${m[1]} does not resolve`);
    }
    void rel;
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

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "hash") cmdHash(rest);
else if (cmd === "lock") cmdLock(rest[0] ?? ".", rest[1]);
else if (cmd === "-h" || cmd === "--help") console.log("usage: ptf-check [dir] | hash [--write] <sim-or-lab-dir> | lock <bundle-dir> [library-root]");
else cmdCheck(cmd ?? ".");
