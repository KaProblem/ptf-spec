// Read-only access to a PTF library on disk (SPEC.md §3): bundles, learning
// elements, learning paths and simulator packages.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import semver from "semver";
import YAML from "yaml";

const DATA_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".svg": "image/svg+xml", ".webp": "image/webp", ".woff2": "font/woff2", ".woff": "font/woff", ".mp3": "audio/mpeg" };

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

export function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  return { data: YAML.parse(m[1]) ?? {}, body: m[2] };
}

/** SIMULATOR-SPEC.md §2.1, same algorithm as tools/ptf-check.mjs. */
export function integrityOf(simDir) {
  const files = walk(simDir)
    .map((p) => relative(simDir, p).split(sep).join("/"))
    .filter((p) => p !== "sim.json")
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  let text = "";
  for (const f of files) text += `${f}\n${createHash("sha256").update(readFileSync(join(simDir, f))).digest("hex")}\n`;
  return "sha256-" + createHash("sha256").update(text).digest("base64");
}

/** Splits "ptf:sim/name@range" (or "name", "name@1.0.0") into id and range. */
export function parseSimRef(ref) {
  let s = String(ref).trim();
  if (!s.startsWith("ptf:sim/")) s = "ptf:sim/" + s;
  const at = s.indexOf("@", "ptf:sim/".length + 1); // scoped names start with "@"
  return at < 0 ? { id: s, range: null } : { id: s.slice(0, at), range: s.slice(at + 1) };
}

/** Removes `# Level: x` sections for other levels, so the tutor gets less to read. */
export function onlyLevel(body, level) {
  const parts = body.split(/^(?=#\s)/m);
  return parts.filter((p) => {
    const m = p.match(/^#\s+Level:\s*([a-z0-9-]+)/);
    return !m || m[1] === level;
  }).join("");
}

export class Library {
  constructor(root) {
    this.root = resolve(root);
    this.reload();
  }

  reload() {
    this.bundles = new Map();   // bundle id -> { id, dir, meta, body, lock }
    this.docs = new Map();      // global id -> { id, type, bundle, file, meta, body }
    this.sims = new Map();      // sim id -> Map(version -> { dir, manifest })
    for (const f of walk(this.root)) {
      if (f.endsWith(`${sep}sim.json`)) this.#addSim(dirname(f));
    }
    for (const f of walk(this.root)) {
      if (!f.endsWith(".md") || f.includes(`${sep}sims${sep}`)) continue;
      let fm;
      try { fm = parseFrontmatter(readFileSync(f, "utf8")); } catch { continue; }
      if (!fm) continue;
      if (fm.data.type === "Bundle" && f.endsWith(`${sep}index.md`)) {
        const dir = dirname(f);
        const lockFile = join(dir, "ptf.lock");
        let lock = null;
        try { if (existsSync(lockFile)) lock = JSON.parse(readFileSync(lockFile, "utf8")); } catch { /* ignore broken lock */ }
        this.bundles.set(fm.data.id, { id: fm.data.id, dir, meta: fm.data, body: fm.body, lock });
      } else if ((fm.data.type === "Learning Element" || fm.data.type === "Learning Path") && fm.data.id) {
        this.docs.set(fm.data.id, { id: fm.data.id, type: fm.data.type, file: f, meta: fm.data, body: fm.body,
          bundle: String(fm.data.id).split("/")[1] });
      }
    }
  }

  #addSim(dir) {
    let manifest;
    try { manifest = JSON.parse(readFileSync(join(dir, "sim.json"), "utf8")); } catch { return; }
    if (!manifest.id || !manifest.version) return;
    if (!this.sims.has(manifest.id)) this.sims.set(manifest.id, new Map());
    const versions = this.sims.get(manifest.id);
    if (!versions.has(manifest.version)) versions.set(manifest.version, { dir, manifest });
  }

  elements() { return [...this.docs.values()].filter((d) => d.type === "Learning Element"); }
  paths() { return [...this.docs.values()].filter((d) => d.type === "Learning Path"); }

  overview() {
    const bundles = [...this.bundles.values()].map((b) => ({
      id: b.id, title: b.meta.title, description: b.meta.description, version: b.meta.version,
      paths: this.paths().filter((p) => p.bundle === b.id).map(summary),
      elements: this.elements().filter((e) => e.bundle === b.id).map(summary),
    }));
    const sims = [...this.sims.entries()].map(([id, versions]) => {
      const latest = this.#pick(id, null);
      const m = latest?.manifest ?? {};
      return { id, title: m.title, description: m.description, lang: m.lang, concepts: m.concepts, levels: m.levels,
        versions: [...versions.keys()].sort(semver.rcompare),
        latest: m.version, stations: (m.stations ?? []).map((s) => ({ id: s.id, title: s.title, levels: s.levels })) };
    });
    return { bundles, simulators: sims };
  }

  search(query, limit = 10) {
    const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const hits = [];
    const score = (fields) => {
      const hay = fields.filter(Boolean).join(" ").toLowerCase();
      return terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
    };
    for (const d of this.docs.values()) {
      const m = d.meta;
      const s = score([m.id, m.title, m.description, (m.tags ?? []).join(" ")]) * 2 + score([d.body]);
      if (s) hits.push({ kind: d.type === "Learning Path" ? "path" : "element", score: s, ...summary(d) });
    }
    for (const [id] of this.sims) {
      const m = this.#pick(id, null)?.manifest ?? {};
      const s = score([id, m.title, m.description, (m.concepts ?? []).join(" "), (m.stations ?? []).map((x) => x.title).join(" ")]) * 2;
      if (s) hits.push({ kind: "simulator", score: s, id, title: m.title, description: m.description, latest: m.version });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  doc(id) { return this.docs.get(id) ?? null; }

  /** Question blocks of an element (SPEC.md §7): `ptf-question` fences in the body, then questions/<name>.json of its bundle. */
  questions(id) {
    const d = this.doc(id);
    if (!d || d.type !== "Learning Element") return [];
    const out = [];
    for (const m of d.body.matchAll(/```ptf-question\s*\n([\s\S]*?)```/g)) {
      try { out.push(JSON.parse(m[1])); } catch { /* ptf-check reports broken blocks */ }
    }
    const dir = this.bundles.get(d.bundle)?.dir;
    const file = dir && join(dir, "questions", `${String(id).split("/").pop()}.json`);
    if (file && existsSync(file)) {
      try { const extra = JSON.parse(readFileSync(file, "utf8")); if (Array.isArray(extra)) out.push(...extra); } catch { /* ignore */ }
    }
    return out;
  }

  /** Picks the version for a simulator: lockfile of the given bundle, else highest match (non-deprecated first). */
  #pick(id, range, bundleId) {
    const versions = this.sims.get(id);
    if (!versions) return null;
    const pinned = bundleId ? this.bundles.get(bundleId)?.lock?.simulators?.[id]?.version : null;
    if (pinned && versions.has(pinned) && (!range || semver.satisfies(pinned, range))) return versions.get(pinned);
    const all = [...versions.keys()].filter((v) => !range || semver.satisfies(v, range)).sort(semver.rcompare);
    const live = all.filter((v) => !versions.get(v).manifest.deprecated);
    const v = (live.length && !range?.match(/^\d+\.\d+\.\d+$/) ? live : all)[0];
    return v ? versions.get(v) : null;
  }

  /** Resolves and verifies a simulator package. Throws with a readable message on failure. */
  resolveSim(ref, bundleId) {
    const { id, range } = parseSimRef(ref);
    if (!this.sims.has(id)) throw new Error(`Unknown simulator ${id}. Known: ${[...this.sims.keys()].join(", ") || "none"}`);
    const hit = this.#pick(id, range, bundleId);
    if (!hit) throw new Error(`No version of ${id} matches ${range}. Available: ${[...this.sims.get(id).keys()].join(", ")}`);
    const actual = integrityOf(hit.dir);
    if (hit.manifest.integrity !== actual) {
      throw new Error(`Integrity check failed for ${id}@${hit.manifest.version}: package files do not match sim.json. Refusing to run it.`);
    }
    const locked = bundleId ? this.bundles.get(bundleId)?.lock?.simulators?.[id] : null;
    if (locked && locked.version === hit.manifest.version && locked.integrity !== actual) {
      throw new Error(`Integrity check failed for ${id}@${hit.manifest.version}: does not match ptf.lock of bundle ${bundleId}.`);
    }
    return hit;
  }

  /**
   * The simulator's entry HTML with local scripts, stylesheets and media inlined,
   * so it runs from a srcdoc iframe or as a single standalone file.
   */
  inlineSim(hit) {
    const { dir, manifest } = hit;
    const entry = join(dir, manifest.entry || "index.html");
    const local = (ref) => {
      if (/^(?:[a-z]+:|\/\/|#)/i.test(ref)) return null;
      const p = resolve(dirname(entry), ref.split(/[?#]/)[0]);
      return p.startsWith(resolve(dir) + sep) && existsSync(p) ? p : null;
    };
    const text = (p) => readFileSync(p, "utf8");
    let html = text(entry);
    html = html.replace(/<script\b([^>]*?)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (all, a, src, b) => {
      const p = local(src);
      return p ? `<script${a}${b}>${text(p).replace(/<\/script/gi, "<\\/script")}</script>` : all;
    });
    html = html.replace(/<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*>/gi, (all) => {
      const href = all.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
      const p = href && local(href);
      return p ? `<style>${text(p)}</style>` : all;
    });
    html = html.replace(/\b(src|href)\s*=\s*["']([^"']+)["']/gi, (all, attr, ref) => {
      const p = local(ref);
      const type = p && DATA_TYPES[extname(p).toLowerCase()];
      return type ? `${attr}="data:${type};base64,${readFileSync(p).toString("base64")}"` : all;
    });
    return html;
  }
}

function summary(d) {
  const m = d.meta;
  return { id: m.id, title: m.title, description: m.description, levels: m.levels ?? m.audience, status: m.status,
    ...(m.steps ? { steps: m.steps.map((s) => s.element) } : {}),
    ...(m.simulators ? { simulators: m.simulators.map((s) => ({ ref: s.ref, station: s.station, levels: s.levels, role: s.role })) } : {}) };
}
