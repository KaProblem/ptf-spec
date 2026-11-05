#!/usr/bin/env node
// ptf-figure: checks PTF figures (SPEC.md §6.8) and renders them for the author's screenshot check.
//
//   ptf-figure check <file.svg>...                 rules of SPEC.md §6.8 (also run by ptf-check)
//   ptf-figure shot <file.svg>... [--out <dir>]    PNGs at phone and desktop width, light and dark (default dir: <tmp>/ptf-figure-shots),
//                                                  every step, plus a layout report (needs Playwright)
//
// As a module: checkFigure(text) returns { errors, warnings, info }, hostSvg(text) the markup a host shows.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_WIDTH = 360;
export const WARN_BYTES = 100 * 1024;
export const MAX_BYTES = 500 * 1024;

/** Elements a figure may use. Everything else is an error; hosts drop it anyway. */
export const ELEMENTS = new Set(["svg", "g", "title", "desc", "defs", "marker", "symbol", "use", "clipPath", "path", "line",
  "polyline", "polygon", "rect", "circle", "ellipse", "text", "tspan", "metadata"]);
/** Attributes a figure may use (besides xmlns:*). Others are dropped by hosts, so they only warn. */
export const ATTRIBUTES = new Set(["id", "class", "viewBox", "xmlns", "role", "aria-labelledby", "aria-label", "aria-hidden",
  "data-ptf-figure", "data-step", "data-caption", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "width", "height",
  "d", "points", "transform", "text-anchor", "dominant-baseline", "dx", "dy", "rotate", "font-weight", "marker-start", "marker-mid",
  "marker-end", "refX", "refY", "markerWidth", "markerHeight", "markerUnits", "orient", "href", "xlink:href", "fill", "stroke",
  "stroke-linecap", "stroke-linejoin", "opacity", "fill-opacity", "stroke-opacity", "clip-path", "preserveAspectRatio",
  "pathLength"]);
/** Classes a figure styles itself with; hosts map them to theme tokens (runtime/ptf-figure.css). */
export const CLASSES = new Set(["s-ink", "s-muted", "s-line", "s-accent", "s-warn", "s-good",
  "f-ink", "f-muted", "f-surface", "f-accent", "f-warn", "f-good", "f-accent-soft", "f-warn-soft", "f-good-soft", "f-none",
  "w1", "w2", "w3", "dash", "t", "t-s", "t-l", "math", "bold"]);
const FORBIDDEN_ATTRS = /^(on.*|style|font-size|font-family|font|color|stop-color)$/i;
const URL_ATTRS = new Set(["marker-start", "marker-mid", "marker-end", "clip-path"]);

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENTITIES[e.toLowerCase()] ?? m;
});

/**
 * A small XML reader for figures: elements, attributes and text. Throws on DOCTYPE, CDATA and
 * unbalanced tags, which a figure never needs.
 */
export function parseXml(text) {
  const root = { name: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[|<!DOCTYPE|<!ENTITY|<\?[\s\S]*?\?>|<\/([A-Za-z_][\w:.-]*)\s*>|<([A-Za-z_][\w:.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)|</g;
  let m;
  let first = true;
  while ((m = re.exec(text))) {
    const tok = m[0];
    if (tok.startsWith("<!--")) continue;
    if (tok === "<![CDATA[") throw new Error("CDATA sections are not allowed");
    if (tok === "<!DOCTYPE" || tok === "<!ENTITY") throw new Error("DOCTYPE and entity declarations are not allowed");
    if (tok.startsWith("<?")) { if (!first || !/^<\?xml\s/.test(tok)) throw new Error("processing instructions are not allowed"); continue; }
    if (tok === "<") throw new Error(`stray "<" at offset ${m.index}`);
    if (m[5] !== undefined) {
      if (stack.length === 1) { if (m[5].trim()) throw new Error("text outside the root element"); continue; }
      stack[stack.length - 1].children.push({ name: "#text", text: decode(m[5]) });
      continue;
    }
    first = false;
    if (m[1]) {
      const top = stack.pop();
      if (!top || top.name !== m[1]) throw new Error(`closing </${m[1]}> does not match <${top?.name}>`);
      continue;
    }
    const attrs = {};
    for (const a of m[3].matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      if (a[1] in attrs) throw new Error(`attribute ${a[1]} repeated on <${m[2]}>`);
      attrs[a[1]] = decode(a[2] ?? a[3]);
    }
    const node = { name: m[2], attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (stack.length === 1 && root.children.filter((c) => c.name !== "#text").length > 1) throw new Error("more than one root element");
    if (!m[4]) stack.push(node);
  }
  if (stack.length > 1) throw new Error(`<${stack[stack.length - 1].name}> is not closed`);
  const top = root.children.find((c) => c.name !== "#text");
  if (!top) throw new Error("no root element");
  return top;
}

const textOf = (n) => (n.name === "#text" ? n.text : (n.children ?? []).map(textOf).join(""));
const elementsOf = (n) => (n.children ?? []).filter((c) => c.name !== "#text");

/** Checks a figure against SPEC.md §6.8. `info` has title, desc, width, height and steps [{ n, caption }]. */
export function checkFigure(text) {
  const errors = [];
  const warnings = [];
  const bytes = Buffer.byteLength(text);
  if (bytes > MAX_BYTES) errors.push(`${Math.round(bytes / 1024)} KB, more than ${MAX_BYTES / 1024} KB`);
  else if (bytes > WARN_BYTES) warnings.push(`${Math.round(bytes / 1024)} KB; a figure rarely needs more than ${WARN_BYTES / 1024} KB`);
  let svg;
  try { svg = parseXml(text); } catch (e) { return { errors: [`not well-formed: ${e.message}`], warnings, info: null }; }
  if (svg.name !== "svg") return { errors: ["the root element must be <svg>"], warnings, info: null };
  if (svg.attrs.xmlns !== "http://www.w3.org/2000/svg") errors.push('<svg> needs xmlns="http://www.w3.org/2000/svg"');
  if (svg.attrs["data-ptf-figure"] !== "1") errors.push('<svg> needs data-ptf-figure="1"');
  if (svg.attrs.role !== "img") warnings.push('<svg> should have role="img"');
  const vb = String(svg.attrs.viewBox ?? "").trim().split(/[\s,]+/).map(Number);
  let width = null, height = null;
  if (vb.length !== 4 || vb.some((x) => !Number.isFinite(x)) || vb[2] <= 0 || vb[3] <= 0) errors.push("<svg> needs a viewBox of four numbers with positive width and height");
  else {
    [width, height] = [vb[2], vb[3]];
    if (width > MAX_WIDTH) errors.push(`viewBox is ${width} units wide; at most ${MAX_WIDTH}, so 14-unit text stays readable on a 320 px phone`);
    if (height > width * 2.2) warnings.push(`viewBox is ${width} × ${height}: very tall figures need scrolling on a phone`);
  }
  if (svg.attrs.width || svg.attrs.height) warnings.push("<svg> width/height are ignored; the host scales the figure to the card");

  const top = elementsOf(svg);
  const title = top.find((c) => c.name === "title");
  const desc = top.find((c) => c.name === "desc");
  if (!title || !textOf(title).trim()) errors.push("needs a non-empty <title> as a child of <svg>");
  if (!desc || !textOf(desc).trim()) errors.push("needs a non-empty <desc> as a child of <svg>: it is all the tutor knows about the figure");
  else if (textOf(desc).trim().length < 40) warnings.push("<desc> is very short; say what is to be seen, including the numbers");

  const ids = new Set();
  const refs = [];
  const steps = new Map();
  const badClasses = new Set();
  const badAttrs = new Set();
  const visit = (n, inStep, inMeta) => {
    if (n.name === "#text") return;
    if (inMeta) return;   // metadata (e.g. C2PA provenance) is inert; hosts drop it
    if (!ELEMENTS.has(n.name)) {
      const why = { script: "scripts", foreignObject: "HTML inside SVG", image: "embedded images", style: "stylesheets (use the classes)",
        a: "links", iframe: "frames", animate: "animations", animateTransform: "animations", animateMotion: "animations", set: "animations" }[n.name];
      errors.push(`<${n.name}> is not allowed${why ? ` (${why})` : ""}`);
      return;
    }
    for (const [k, v] of Object.entries(n.attrs)) {
      if (k.startsWith("xmlns:")) continue;
      if (FORBIDDEN_ATTRS.test(k)) { errors.push(`attribute ${k} on <${n.name}> is not allowed${k === "style" || /^font/.test(k) ? " (use the classes)" : ""}`); continue; }
      if ((k === "fill" || k === "stroke") && v !== "none") { errors.push(`${k}="${v}" on <${n.name}>: colours only through classes (s-*, f-*)`); continue; }
      if (k === "href" || k === "xlink:href") {
        if (!/^#[\w-]+$/.test(v)) errors.push(`${k}="${v}" on <${n.name}>: only local #id references are allowed`);
        else refs.push(v.slice(1));
        continue;
      }
      if (URL_ATTRS.has(k)) {
        const u = v.match(/^url\(\s*#([\w-]+)\s*\)$/);
        if (!u && v !== "none") errors.push(`${k}="${v}" on <${n.name}>: only url(#id) is allowed`);
        else if (u) refs.push(u[1]);
        continue;
      }
      if (/url\s*\(/i.test(v)) { errors.push(`${k} on <${n.name}> uses url(); only marker-* and clip-path may`); continue; }
      if (!ATTRIBUTES.has(k)) badAttrs.add(k);
    }
    if (n.attrs.id) {
      if (ids.has(n.attrs.id)) errors.push(`id "${n.attrs.id}" is used twice`);
      ids.add(n.attrs.id);
    }
    for (const c of String(n.attrs.class ?? "").split(/\s+/).filter(Boolean)) if (!CLASSES.has(c)) badClasses.add(c);
    let here = inStep;
    if ("data-step" in n.attrs) {
      if (n.name !== "g") errors.push(`data-step on <${n.name}>; only <g> may be a step`);
      else if (inStep) errors.push(`step ${n.attrs["data-step"]} is nested in step ${inStep}`);
      else if (!/^[1-9]\d*$/.test(n.attrs["data-step"])) errors.push(`data-step="${n.attrs["data-step"]}" must be a whole number from 1`);
      else {
        here = Number(n.attrs["data-step"]);
        const caption = (n.attrs["data-caption"] ?? "").trim();
        if (!steps.has(here)) steps.set(here, caption);
        else if (caption && !steps.get(here)) steps.set(here, caption);
      }
    } else if ("data-caption" in n.attrs) warnings.push(`data-caption on <${n.name}> without data-step is ignored`);
    for (const c of n.children ?? []) visit(c, here, n.name === "metadata");
  };
  visit(svg, null, false);
  if (badClasses.size) errors.push(`unknown class(es) ${[...badClasses].join(", ")}; use the figure classes (SPEC.md §6.8)`);
  if (badAttrs.size) warnings.push(`attribute(s) ${[...badAttrs].join(", ")} are not part of the figure format and are dropped by hosts`);
  for (const r of new Set(refs)) if (!ids.has(r)) errors.push(`reference #${r} points to no element`);

  const numbers = [...steps.keys()].sort((a, b) => a - b);
  numbers.forEach((n, i) => { if (n !== i + 1) errors.push(`steps must be numbered 1..${numbers.length} without gaps (found ${numbers.join(", ")})`); });
  const missing = numbers.filter((n) => !steps.get(n));
  if (missing.length) warnings.push(`step(s) ${missing.join(", ")} have no data-caption; the card shows the caption while the step appears`);
  if (numbers.length > 8) warnings.push(`${numbers.length} steps; more than about six are hard to follow`);

  const info = {
    title: title ? textOf(title).trim().replace(/\s+/g, " ") : null,
    desc: desc ? textOf(desc).trim().replace(/\s+/g, " ") : null,
    width, height,
    steps: [...new Set(numbers)].map((n) => ({ n, caption: steps.get(n) || null })),
  };
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)], info };
}

/** The markup a host shows: without <metadata>, comments and the XML declaration. Hosts still sanitize it. */
export function hostSvg(text) {
  return String(text)
    .replace(/<\?xml[\s\S]*?\?>/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<metadata\b[\s\S]*?<\/metadata>|<metadata\b[^>]*\/>/g, "")
    .replace(/\s+xmlns:(?!xlink\b)[\w-]+="[^"]*"/g, "")
    .trim();
}

/**
 * Figure files of a bundle: figures/<id>.svg and translations figures/<id>.<lang>.svg.
 * Returns Map(id -> { file, langs: Map(lang -> file) }) and a list of misnamed files.
 */
export function figureFiles(dir, list) {
  const out = new Map();
  const misnamed = [];
  for (const name of list) {
    if (!name.endsWith(".svg")) { misnamed.push(name); continue; }
    const m = name.match(/^([a-z0-9][a-z0-9-]*)(?:\.([a-z]{2,3}(?:-[A-Za-z0-9]+)*))?\.svg$/);
    if (!m) { misnamed.push(name); continue; }
    if (!out.has(m[1])) out.set(m[1], { file: null, langs: new Map() });
    if (m[2]) out.get(m[1]).langs.set(m[2], join(dir, name));
    else out.get(m[1]).file = join(dir, name);
  }
  return { figures: out, misnamed };
}

// ---------- screenshot check ----------

const SPEC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const FIGURE_CSS_FILE = join(SPEC_DIR, "runtime", "ptf-figure.css");

function shotPage(svg, theme, step) {
  const css = readFileSync(FIGURE_CSS_FILE, "utf8");
  return `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light;--bg:#ffffff;--surface:#f4f6f8;--ink:#18212e;--muted:#5b6573;--line:#d5dbe2;--accent:#0e6e68;--warn:#b5560f;--good:#1d7a3a;
--f-body:system-ui,-apple-system,"Segoe UI",sans-serif}
[data-theme="dark"]{color-scheme:dark;--bg:#16191d;--surface:#1f2329;--ink:#e8ebef;--muted:#a3acb8;--line:#343a42;--accent:#4fc1b8;--warn:#f0a35e;--good:#6fcf8a}
html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 var(--f-body)}
.card{border:1px solid var(--line);border-radius:10px;margin:0;overflow:hidden}
${css}
</style></head><body><div class="card"><div class="ptf-figure-stage">${svg}</div></div>
<script>
var n=${step == null ? "Infinity" : step};
document.querySelectorAll("svg [data-step]").forEach(function(g){ if (Number(g.getAttribute("data-step")) > n) g.classList.add("ptf-hidden"); });
</script></body></html>`;
}

/** Text boxes that overlap each other or leave the viewBox, measured in the browser with every step shown. */
function layoutProbe() {
  const svg = document.querySelector("svg");
  const vb = svg.viewBox.baseVal;
  const scale = svg.getBoundingClientRect().width / vb.width;
  const texts = [...svg.querySelectorAll("text")].filter((t) => !t.closest("defs"));
  const boxes = texts.map((t) => ({ text: t.textContent.trim(), b: t.getBBox(), ctm: t.getCTM(), size: parseFloat(getComputedStyle(t).fontSize) }));
  const abs = (x) => {
    const m = x.ctm, sm = svg.getCTM();
    const inv = sm.inverse().multiply(m);
    const p1 = new DOMPoint(x.b.x, x.b.y).matrixTransform(inv), p2 = new DOMPoint(x.b.x + x.b.width, x.b.y + x.b.height).matrixTransform(inv);
    return { x1: Math.min(p1.x, p2.x), y1: Math.min(p1.y, p2.y), x2: Math.max(p1.x, p2.x), y2: Math.max(p1.y, p2.y) };
  };
  const rects = boxes.map((x) => ({ ...x, r: abs(x) }));
  const problems = [];
  for (const x of rects) {
    if (x.r.x1 < vb.x - 0.5 || x.r.y1 < vb.y - 0.5 || x.r.x2 > vb.x + vb.width + 0.5 || x.r.y2 > vb.y + vb.height + 0.5) {
      problems.push(`text "${x.text}" reaches outside the viewBox`);
    }
  }
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i].r, b = rects[j].r;
    const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1), h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
    if (w > 1 && h > 1) problems.push(`text "${rects[i].text}" overlaps "${rects[j].text}"`);
  }
  const smallest = Math.min(...boxes.map((x) => x.size * scale));
  return { problems, smallestPx: Number.isFinite(smallest) ? Math.round(smallest * 10) / 10 : null, scale };
}

async function cmdShot(files, outDir) {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  let chromium;
  try { ({ chromium } = require("playwright")); } catch { console.error("ptf-figure shot needs Playwright (npm i -D playwright)"); process.exit(2); }
  const browser = await chromium.launch();
  let failed = false;
  for (const file of files) {
    const raw = readFileSync(file, "utf8");
    const { errors, info } = checkFigure(raw);
    if (errors.length) { console.error(`${file}: fix the check errors first:\n  ${errors.join("\n  ")}`); failed = true; continue; }
    const svg = hostSvg(raw);
    const dir = resolve(outDir ?? join(tmpdir(), "ptf-figure-shots"));
    mkdirSync(dir, { recursive: true });
    const stem = basename(file, ".svg");
    const shots = [];
    let probe = null;
    for (const [width, theme] of [[320, "light"], [320, "dark"], [640, "light"]]) {
      const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 2 });
      const stepsToShow = width === 320 && theme === "light" ? [...info.steps.map((s) => s.n), null] : [null];
      for (const step of stepsToShow.length > 1 ? stepsToShow : [null]) {
        await page.setContent(shotPage(svg, theme, step));
        const out = join(dir, `${stem}-${width}-${theme}${step == null ? "" : `-step${step}`}.png`);
        await page.locator(".card").screenshot({ path: out });
        shots.push(out);
        if (width === 320 && theme === "light" && step == null) probe = await page.evaluate(layoutProbe);
      }
      await page.close();
    }
    console.log(`${file}: ${info.steps.length} step(s), smallest text ${probe.smallestPx} px at 320 px`);
    if (probe.smallestPx != null && probe.smallestPx < 12) { console.log(`  ✗ text smaller than 12 px on a phone`); failed = true; }
    for (const p of probe.problems) { console.log(`  ✗ ${p}`); failed = true; }
    for (const s of shots) console.log(`  ${s}`);
  }
  await browser.close();
  console.log(failed ? "\nFix the problems above, then look at every PNG yourself." : "\nNo layout problems found. Now look at every PNG yourself: the check cannot see overlapping lines, unclear labels or a wrong picture.");
  process.exit(failed ? 1 : 0);
}

function cmdCheck(files) {
  let errors = 0;
  for (const f of files) {
    if (!existsSync(f)) { console.error(`${f}: not found`); errors++; continue; }
    const r = checkFigure(readFileSync(f, "utf8"));
    for (const e of r.errors) console.log(`error  ${f}: ${e}`);
    for (const w of r.warnings) console.log(`warn   ${f}: ${w}`);
    if (!r.errors.length) console.log(`ok     ${f}: "${r.info.title}", ${r.info.steps.length} step(s), ${r.info.width} × ${r.info.height}`);
    errors += r.errors.length;
  }
  process.exit(errors ? 1 : 0);
}

// Only as a command: bundlers (mcp/build.mjs) inline this module into other entry points.
if (process.argv[1] && basename(process.argv[1]) === "ptf-figure.mjs" && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const outAt = rest.indexOf("--out");
  const out = outAt >= 0 ? rest.splice(outAt, 2)[1] : null;
  if (cmd === "check" && rest.length) cmdCheck(rest);
  else if (cmd === "shot" && rest.length) await cmdShot(rest, out);
  else {
    console.error("usage: ptf-figure check <file.svg>...\n       ptf-figure shot <file.svg>... [--out <dir>]");
    process.exit(2);
  }
}
