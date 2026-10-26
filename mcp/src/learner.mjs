// The learner record (LEARNER-RECORD.md): local, private, plain files.
//
//   <dir>/profile.md      who the learner is and how they learn
//   <dir>/mastery.json    state per learning element
//   <dir>/events.jsonl    learning log
//   <dir>/state/*.json    simulator resume state (host extension, not part of the spec)

import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { parseFrontmatter } from "./library.mjs";

const PTF_VERSION = "0.1";
const MAX_STATE_BYTES = 64 * 1024;
const VERBS = new Set(["experienced", "attempted", "answered", "completed", "station_completed", "level_changed",
  "understood", "rephrase", "deeper", "stuck", "asked", "reported_broken"]);

// Crockford base32 ULID: sortable by time, no dependency.
function ulid(now = Date.now()) {
  const A = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let t = "", n = now;
  for (let i = 0; i < 10; i++) { t = A[n % 32] + t; n = Math.floor(n / 32); }
  const r = randomBytes(16);
  let s = "";
  for (let i = 0; i < 16; i++) s += A[r[i] % 32];
  return t + s;
}

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

const day = (d) => d.toISOString().slice(0, 10);

export class LearnerRecord {
  constructor(dir) {
    this.dir = dir;
  }

  #ensure() { mkdirSync(join(this.dir, "state"), { recursive: true }); }
  #file(name) { return join(this.dir, name); }

  profile() {
    const f = this.#file("profile.md");
    if (!existsSync(f)) return null;
    const fm = parseFrontmatter(readFileSync(f, "utf8"));
    return fm ? { ...fm.data, notes: fm.body.trim() } : null;
  }

  /** Merges fields into profile.md; `notes` replaces the free-text body when given. */
  updateProfile(fields) {
    this.#ensure();
    const { notes, ...rest } = fields;
    const current = this.profile() ?? { type: "Learner Profile", ptf_version: PTF_VERSION, learner: `anon:${randomBytes(3).toString("hex")}` };
    const { notes: oldNotes, ...data } = current;
    for (const [k, v] of Object.entries(rest)) {
      if (["type", "ptf_version", "learner"].includes(k)) continue;
      data[k] = v && typeof v === "object" && !Array.isArray(v) && data[k] && typeof data[k] === "object" ? { ...data[k], ...v } : v;
    }
    data.updated = new Date().toISOString();
    const body = (notes ?? oldNotes ?? "").trim();
    writeAtomic(this.#file("profile.md"), `---\n${YAML.stringify(data)}---\n\n${body}\n`);
    return this.profile();
  }

  mastery() {
    const f = this.#file("mastery.json");
    if (!existsSync(f)) return { ptf_version: PTF_VERSION, concepts: {} };
    try { return JSON.parse(readFileSync(f, "utf8")); } catch { return { ptf_version: PTF_VERSION, concepts: {} }; }
  }

  #saveMastery(m) {
    this.#ensure();
    m.updated = new Date().toISOString();
    writeAtomic(this.#file("mastery.json"), JSON.stringify(m, null, 2) + "\n");
  }

  events(limit = 20) {
    const f = this.#file("events.jsonl");
    if (!existsSync(f)) return [];
    const lines = readFileSync(f, "utf8").trim().split("\n").filter(Boolean);
    return lines.slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }

  /**
   * Appends an event and updates mastery.json. `element` (a ptf:el/ ID) attributes
   * simulator and question results to the learning element they were used for.
   */
  record({ verb, object, level, result, context, element }) {
    if (!VERBS.has(verb)) throw new Error(`Unknown verb ${verb}`);
    if (!/^ptf:(el|path|sim)\//.test(object ?? "")) throw new Error(`object must be a ptf:el/, ptf:path/ or ptf:sim/ ID, got ${object}`);
    this.#ensure();
    const now = new Date();
    const ev = { id: ulid(now.getTime()), at: now.toISOString(), verb, object };
    if (level) ev.level = level;
    if (result && Object.keys(result).length) ev.result = result;
    const ctx = { host: "ptf-mcp", ...(context ?? {}), ...(element ? { element } : {}) };
    ev.context = ctx;
    appendFileSync(this.#file("events.jsonl"), JSON.stringify(ev) + "\n");

    const target = object.startsWith("ptf:el/") ? object.split("#")[0] : element;
    if (target?.startsWith("ptf:el/")) this.#updateMastery(target, ev, now);
    return ev;
  }

  #updateMastery(elementId, ev, now) {
    const m = this.mastery();
    const c = m.concepts[elementId] ?? { mastery: 0, open_misconceptions: [] };
    c.last_seen = now.toISOString();
    if (ev.level) c.level = ev.level;
    const r = ev.result ?? {};
    const outcome = typeof r.score === "number" ? r.score : typeof r.correct === "boolean" ? (r.correct ? 1 : 0)
      : ev.verb === "understood" || ev.verb === "completed" ? 0.8 : null;
    if (outcome !== null) {
      // Recent results weigh more (LEARNER-RECORD.md §5).
      c.mastery = Math.round((0.6 * (c.mastery ?? 0) + 0.4 * outcome) * 100) / 100;
      c.interval_days = c.mastery >= 0.8 ? Math.min(60, Math.max(1, (c.interval_days ?? 1) * 2)) : 1;
      c.next_review = day(new Date(now.getTime() + c.interval_days * 86400000));
    }
    const mis = new Set(c.open_misconceptions ?? []);
    if (r.misconception) (r.correct === false ? mis.add(r.misconception) : r.correct === true && mis.delete(r.misconception));
    c.open_misconceptions = [...mis];
    m.concepts[elementId] = c;
    this.#saveMastery(m);
  }

  /** Lets the tutor set mastery directly, e.g. after a conversation-based check. */
  setMastery(elementId, fields) {
    const m = this.mastery();
    m.concepts[elementId] = { ...(m.concepts[elementId] ?? {}), ...fields, last_seen: new Date().toISOString() };
    this.#saveMastery(m);
    return m.concepts[elementId];
  }

  #stateFile(simId) { return join(this.dir, "state", simId.replace(/[^a-z0-9@._-]+/gi, "_") + ".json"); }

  simState(simId) {
    const f = this.#stateFile(simId);
    if (!existsSync(f)) return null;
    try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; }
  }

  saveSimState(simId, state) {
    const text = JSON.stringify(state ?? null);
    if (text.length > MAX_STATE_BYTES) throw new Error("state larger than 64 KB");
    this.#ensure();
    writeAtomic(this.#stateFile(simId), text);
  }
}
