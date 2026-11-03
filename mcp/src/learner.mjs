// The learner record (LEARNER-RECORD.md), kept in its export format: plain files.
// Courses (§5) are derived from the events. A later version stores this in SQLite.
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

const PTF_VERSION = "0.2";
const MAX_STATE_BYTES = 64 * 1024;
const VERBS = new Set(["started", "left", "experienced", "attempted", "answered", "completed", "assessed", "station_completed", "level_changed",
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
const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);

/** Merges nested objects (style.explain) so a partial update keeps the other fields; arrays and values replace. */
function merge(old, v) {
  if (!isObject(v) || !isObject(old)) return v;
  const out = { ...old };
  for (const [k, x] of Object.entries(v)) out[k] = merge(old[k], x);
  return out;
}

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
      data[k] = merge(data[k], v);
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

  #all() {
    const f = this.#file("events.jsonl");
    if (!existsSync(f)) return [];
    return readFileSync(f, "utf8").split("\n").filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }

  events(limit = 20, filter = () => true) {
    return this.#all().filter(filter).slice(-limit);
  }

  /**
   * Appends an event and updates mastery.json. `element` (a ptf:el/ ID) attributes
   * simulator and question results to the learning element they were used for.
   */
  record({ verb, object, level, result, context, element, path, note, keep }) {
    if (!VERBS.has(verb)) throw new Error(`Unknown verb ${verb}`);
    if (!/^ptf:(el|path|sim)\//.test(object ?? "")) throw new Error(`object must be a ptf:el/, ptf:path/ or ptf:sim/ ID, got ${object}`);
    this.#ensure();
    const now = new Date();
    const ev = { id: ulid(now.getTime()), at: now.toISOString(), verb, object };
    if (level) ev.level = level;
    if (result && Object.keys(result).length) ev.result = result;
    if (note) ev.note = String(note).slice(0, 1000);
    const coursePath = path ?? (verb === "started" || verb === "left" || object.startsWith("ptf:path/") ? object.split("#")[0] : undefined);
    const ctx = { host: "ptf-mcp", ...(context ?? {}), ...(element ? { element } : {}), ...(coursePath ? { path: coursePath } : {}) };
    ev.context = ctx;
    appendFileSync(this.#file("events.jsonl"), JSON.stringify(ev) + "\n");

    const target = object.startsWith("ptf:el/") ? object.split("#")[0] : element;
    if (target?.startsWith("ptf:el/")) this.#updateMastery(target, ev, now);
    if (keep && target?.startsWith("ptf:el/")) this.setMastery(target, { keep: String(keep).slice(0, 2000) });
    return ev;
  }

  #updateMastery(elementId, ev, now) {
    const m = this.mastery();
    const c = m.concepts[elementId] ?? { mastery: 0, open_misconceptions: [] };
    c.last_seen = now.toISOString();
    if (ev.level) c.level = ev.level;
    const r = ev.result ?? {};
    if (ev.verb === "assessed") {
      // Prior-knowledge placement (LEARNER-RECORD.md §5): replaces mastery, early first review.
      const score = typeof r.score === "number" ? r.score : r.correct === true ? 0.8 : 0;
      c.mastery = Math.round(score * 100) / 100;
      c.source = "diagnosis";
      c.interval_days = c.mastery >= 0.8 ? 3 : 1;
      c.next_review = day(new Date(now.getTime() + c.interval_days * 86400000));
      if (r.misconception) c.open_misconceptions = [...new Set([...(c.open_misconceptions ?? []), r.misconception])];
      m.concepts[elementId] = c;
      this.#saveMastery(m);
      return;
    }
    if (ev.verb === "completed") c.completed = true;
    const outcome = typeof r.score === "number" ? r.score : typeof r.correct === "boolean" ? (r.correct ? 1 : 0)
      : ev.verb === "understood" || ev.verb === "completed" ? 0.8 : null;
    if (outcome !== null) {
      delete c.source;
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

  /**
   * What the learner has done so far, from the whole event log: completed
   * elements and, per simulator, the stations completed. The tutor uses it
   * to avoid restarting finished work.
   */
  progress() {
    const f = this.#file("events.jsonl");
    const out = { elements_completed: [], simulators: {} };
    if (!existsSync(f)) return out;
    const done = new Set();
    for (const line of readFileSync(f, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      const object = String(ev.object ?? "");
      if (ev.verb === "completed" && object.startsWith("ptf:el/")) done.add(object.split("#")[0]);
      if (!object.startsWith("ptf:sim/")) continue;
      const [ref, station] = object.split("#");
      const id = ref.replace(/(.)@[^@/]+$/, "$1");
      const sim = out.simulators[id] ??= { stations_completed: [], last_used: null };
      sim.last_used = ev.at ?? sim.last_used;
      if (ev.verb === "station_completed" && station && !sim.stations_completed.includes(station)) sim.stations_completed.push(station);
    }
    out.elements_completed = [...done];
    return out;
  }

  /**
   * Courses (LEARNER-RECORD.md §5), derived from events with context.path.
   * `pathInfo(id)` returns { steps: [{ element, optional }], requires(elementId) } from the library, or null.
   */
  courses(pathInfo = () => null) {
    const out = new Map();
    for (const ev of this.#all()) {
      const path = ev.context?.path;
      if (!path) continue;
      const c = out.get(path) ?? { path, status: "active", last_activity: null, last_note: null };
      if (ev.verb === "started") c.status = "active";
      if (ev.verb === "left" && ev.object === path) c.status = "left";
      if (ev.verb === "completed" && ev.object === path) c.status = "completed";
      c.last_activity = ev.at;
      if (ev.note) c.last_note = ev.note;
      out.set(path, c);
    }
    for (const g of this.profile()?.goals ?? []) {
      for (const path of [...(g.paths ?? []), ...(g.path ? [g.path] : [])]) {
        if (!out.has(path)) out.set(path, { path, status: "planned", goal: g.text, last_activity: null, last_note: null });
      }
    }
    const concepts = this.mastery().concepts;
    for (const c of out.values()) {
      const info = pathInfo(c.path);
      if (!info) continue;
      const open = info.steps.find((s) => !this.#stepDone(s.element, concepts));
      c.current_step = open?.element ?? null;
      c.steps_done = info.steps.filter((s) => this.#stepDone(s.element, concepts)).length;
      c.steps_total = info.steps.length;
    }
    return [...out.values()];
  }

  #stepDone(elementId, concepts) {
    const c = concepts[elementId];
    return Boolean(c && (c.completed || (c.source === "diagnosis" && c.mastery >= 0.8)));
  }

  /** One course in detail (LEARNER-RECORD.md §2, get_learner({ course })). */
  course(pathId, info) {
    const concepts = this.mastery().concepts;
    const elements = new Set((info?.steps ?? []).map((s) => s.element));
    const inCourse = (ev) => ev.context?.path === pathId || elements.has(String(ev.object).split("#")[0]) || elements.has(ev.context?.element);
    const events = this.#all().filter(inCourse);
    const summary = this.courses(() => info).find((c) => c.path === pathId) ?? { path: pathId, status: "not started" };
    const placement = events.filter((e) => e.verb === "assessed")
      .map((e) => ({ element: e.object.split("#")[0], score: e.result?.score ?? null, level: e.level ?? null, reason: e.context?.reason ?? "placement" }));
    const consent = [...events].reverse().find((e) => e.verb === "started")?.result?.consent ?? [];
    return {
      ...summary,
      sharing: consent,
      placement,
      steps: (info?.steps ?? []).map((s) => {
        const c = concepts[s.element];
        return { element: s.element, optional: Boolean(s.optional), level: c?.level ?? null, mastery: c?.mastery ?? null,
          done: this.#stepDone(s.element, concepts), ...(c?.keep ? { keep: c.keep } : {}) };
      }),
      open_misconceptions: [...new Set([...elements].flatMap((e) => concepts[e]?.open_misconceptions ?? []))],
      simulators: this.#stations(events),
      recent_events: events.slice(-20),
    };
  }

  /** One element in detail. */
  element(elementId) {
    const events = this.#all().filter((ev) => String(ev.object).split("#")[0] === elementId || ev.context?.element === elementId);
    return { element: elementId, mastery: this.mastery().concepts[elementId] ?? null, simulators: this.#stations(events), recent_events: events.slice(-20) };
  }

  /** Reviews due, at most `limit`: first what the next steps of active courses require, then the most overdue. */
  reviewsDue(firstIds = [], limit = 10, today = new Date().toISOString().slice(0, 10)) {
    const due = Object.entries(this.mastery().concepts).filter(([, c]) => c.next_review && c.next_review <= today)
      .map(([id, c]) => ({ element: id, next_review: c.next_review, mastery: c.mastery }));
    const first = new Set(firstIds);
    due.sort((a, b) => (first.has(b.element) - first.has(a.element)) || a.next_review.localeCompare(b.next_review));
    return due.slice(0, limit);
  }

  #stations(events) {
    const sims = {};
    for (const ev of events) {
      const object = String(ev.object ?? "");
      if (!object.startsWith("ptf:sim/")) continue;
      const [ref, station] = object.split("#");
      const id = ref.replace(/(.)@[^@/]+$/, "$1");
      const sim = sims[id] ??= { stations_completed: [], last_used: null };
      sim.last_used = ev.at ?? sim.last_used;
      if (ev.verb === "station_completed" && station && !sim.stations_completed.includes(station)) sim.stations_completed.push(station);
    }
    return sims;
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
