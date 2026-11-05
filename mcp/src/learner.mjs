// The learner record (LEARNER-RECORD.md 0.3). events.jsonl is the record; everything
// else (profile, completions, consents, courses, the mastery estimate) is derived from it
// by `derive`, and profile.md and mastery.json are written as views for people.
// A later version stores the log in SQLite.
//
//   <dir>/events.jsonl    the record
//   <dir>/profile.md      view of the profile
//   <dir>/mastery.json    view of the elements
//   <dir>/state/*.json    simulator resume state (host extension, not part of the spec)

import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { parseFrontmatter } from "./library.mjs";

const PTF_VERSION = "0.3";
const MAX_STATE_BYTES = 64 * 1024;
const MAX_STABILITY_DAYS = 180;
export const VERBS = new Set(["answered", "assessed", "completed", "skipped", "started", "left", "consented", "withdrew", "profile_updated",
  "experienced", "attempted", "station_completed", "level_changed", "understood", "rephrase", "deeper", "stuck", "asked", "reported_broken"]);
const AREAS = ["progress", "mastery", "answers"];

// Crockford base32 ULID: sortable by time, no dependency.
let lastTime = 0, lastRand = null;
export function ulid(now = Date.now()) {
  const A = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let t = "", n = now;
  for (let i = 0; i < 10; i++) { t = A[n % 32] + t; n = Math.floor(n / 32); }
  // Monotonic within one millisecond, so the order of events recorded in a row is kept.
  let r;
  if (now === lastTime && lastRand) {
    r = [...lastRand];
    for (let i = 15; i >= 0; i--) { if (r[i] < 31) { r[i]++; break; } r[i] = 0; }
  } else r = [...randomBytes(16)].map((b) => b % 32);
  lastTime = now; lastRand = r;
  return t + r.map((x) => A[x]).join("");
}

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

const day = (d) => d.toISOString().slice(0, 10);
const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);
const elementOf = (ev) => {
  const o = String(ev.object ?? "");
  if (o.startsWith("ptf:el/")) return o.split("#")[0];
  const e = ev.context?.element;
  return typeof e === "string" && e.startsWith("ptf:el/") ? e : null;
};

/** Merges nested objects (style.explain) so a partial update keeps the other fields; arrays and values replace. */
export function merge(old, v) {
  if (!isObject(v) || !isObject(old)) return v;
  const out = { ...old };
  for (const [k, x] of Object.entries(v)) out[k] = merge(old[k], x);
  return out;
}

/** A correct answer not given after the solution was shown (LEARNER-RECORD.md §5). */
const isEvidence = (e) => Boolean(e) && e.verb === "answered" && e.result?.correct === true && e.result?.assistance !== "solution";

/**
 * Checks a completed event against the log (LEARNER-RECORD.md §5). Evidence is a correct
 * `answered` event of the same element, earlier in the log, at the completion's level when
 * it has one. Every listed objective needs evidence; without objectives, one piece is enough.
 * A completed event without `result.evidence` is a 0.2 completion: it counts, unverified.
 */
export function checkCompletion(ev, byId) {
  const r = ev.result ?? {};
  if (!("evidence" in r)) return { ok: true, verified: false };
  const el = elementOf(ev);
  const good = (r.evidence ?? []).map((id) => byId.get(id)).filter((e) => isEvidence(e) && elementOf(e) === el && e.id < ev.id
    && (!ev.level || !e.level || e.level === ev.level));
  if (!good.length) return { ok: false, missing: r.objectives ?? [], reason: "no correct answer of this element at this level, given without the solution shown first, among the evidence" };
  const shown = new Set(good.flatMap((e) => e.result?.objectives ?? []));
  const missing = (r.objectives ?? []).filter((o) => !shown.has(o));
  return missing.length ? { ok: false, missing, reason: `no evidence for objective(s) ${missing.join(", ")}` } : { ok: true, verified: true };
}

/**
 * Derives the learner's state from events. Everything except `estimate` fields is
 * normative: two hosts with the same events derive the same state (conformance/learner-record).
 */
export function derive(events) {
  const sorted = [...events].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const byId = new Map(sorted.map((e) => [e.id, e]));
  let profile = null;
  const elements = {};
  const consents = {};
  const courses = {};
  const rejected = [];
  const el = (id) => (elements[id] ??= { completed: [], skipped: false, open_misconceptions: [], suspected_misconceptions: [], estimate: {} });

  for (const ev of sorted) {
    const r = ev.result ?? {};
    const path = ev.context?.path ?? (String(ev.object).startsWith("ptf:path/") ? String(ev.object).split("#")[0] : null);

    if (ev.verb === "profile_updated") {
      const fields = isObject(r.fields) ? r.fields : {};
      profile = profile ?? { type: "Learner Profile", ptf_version: PTF_VERSION };
      for (const [k, v] of Object.entries(fields)) if (!["type", "ptf_version"].includes(k)) profile[k] = merge(profile[k], v);
      profile.updated = ev.at;
      continue;
    }
    if (path) {
      const c = (courses[path] ??= { status: "active", started: null, last_activity: null, last_note: null });
      if (ev.verb === "started" && ev.object === path) { c.status = "active"; c.started ??= ev.at; }
      if (ev.verb === "left" && ev.object === path) c.status = "left";
      if (ev.verb === "completed" && ev.object === path) c.status = "completed";
      c.last_activity = ev.at;
      if (ev.note) c.last_note = ev.note;
    }
    // Consent (§7): consented sets areas for one recipient, withdrew removes them. 0.2 started.result.consent counts as consented.
    const grants = ev.verb === "consented" ? [{ with: r.with, areas: r.areas, required: r.required }]
      : ev.verb === "started" && Array.isArray(r.consent) ? r.consent : [];
    if (path && grants.length) {
      const list = (consents[path] ??= []);
      for (const g of grants) {
        if (!g?.with) continue;
        const i = list.findIndex((x) => x.with === g.with);
        const entry = { with: g.with, areas: (g.areas ?? []).filter((a) => AREAS.includes(a)), required: Boolean(g.required), at: ev.at };
        if (i >= 0) list[i] = entry; else list.push(entry);
      }
    }
    if (ev.verb === "withdrew" && path && consents[path]) {
      consents[path] = consents[path].map((x) => (x.with !== r.with ? x
        : { ...x, areas: r.areas ? x.areas.filter((a) => !r.areas.includes(a)) : [], at: ev.at })).filter((x) => x.areas.length);
    }

    const id = elementOf(ev);
    if (!id) continue;
    const e = el(id);
    e.last_seen = ev.at;
    if (ev.keep) e.keep = ev.keep;
    if (ev.context?.version && !String(ev.object).includes("#")) (e.versions_seen ??= {}).element = ev.context.version;
    if ((ev.verb === "level_changed" || ev.verb === "deeper") && ev.level) e.target_level = ev.level;
    if (ev.verb === "skipped") e.skipped = true;
    if (ev.verb === "completed" && String(ev.object).startsWith("ptf:el/")) {
      const check = checkCompletion(ev, byId);
      if (!check.ok) { rejected.push(ev.id); continue; }
      const level = ev.level ?? "unknown";
      e.completed = e.completed.filter((x) => x.level !== level);
      e.completed.push({ level, at: ev.at, ...(ev.context?.version ? { version: ev.context.version } : {}),
        ...(ev.context?.catalog ? { catalog: ev.context.catalog } : {}), objectives: r.objectives ?? [],
        ...(ev.context?.reason ? { reason: ev.context.reason } : {}), verified: check.verified });
      e.skipped = false;
    }
    // Misconceptions (§6): one wrong answer makes it suspected, a second one open; a correct answer on it clears both.
    if (r.misconception && typeof r.correct === "boolean") {
      const open = new Set(e.open_misconceptions), suspected = new Set(e.suspected_misconceptions);
      if (r.correct) { open.delete(r.misconception); suspected.delete(r.misconception); }
      else if (suspected.has(r.misconception) || open.has(r.misconception)) { suspected.delete(r.misconception); open.add(r.misconception); }
      else suspected.add(r.misconception);
      e.open_misconceptions = [...open];
      e.suspected_misconceptions = [...suspected];
    }
    // The estimate (§6): the reference formula, only for scheduling reviews. Stability in days follows the answer history.
    const s = e.estimate;
    const at = new Date(ev.at).getTime();
    const schedule = (stability) => {
      s.stability_days = Math.round(Math.min(MAX_STABILITY_DAYS, stability) * 100) / 100;
      s.last_answer = ev.at;
      s.next_review = day(new Date(at + s.stability_days * 86400000));
      s.interval_days = Math.max(1, Math.round(s.stability_days));
    };
    if (ev.verb === "assessed") {
      const score = typeof r.score === "number" ? r.score : r.correct === true ? 1 : 0;
      schedule(score >= 0.8 ? 3 : 1);
      continue;
    }
    const answer = ev.verb === "answered" || ev.verb === "station_completed";
    const correct = typeof r.correct === "boolean" ? r.correct : typeof r.score === "number" ? r.score >= 0.8 : null;
    if (!answer || correct === null || r.assistance === "solution") continue;
    if (!correct) schedule(1);
    else schedule(!s.stability_days ? 1 : s.stability_days * (r.assistance === "hint" ? 1.5 : 2.5));
  }
  return { profile, elements, consents, courses, rejected };
}

/** The estimated chance of a correct answer now: 0.9 ^ (days since the last answer / stability); 0 without a correct answer (§6). */
export function retrievability(estimate, now = Date.now()) {
  if (!estimate?.stability_days || !estimate.last_answer) return 0;
  const days = Math.max(0, (now - new Date(estimate.last_answer).getTime()) / 86400000);
  return Math.round(Math.pow(0.9, days / estimate.stability_days) * 100) / 100;
}

/** The normative part of `derive`, without the host's estimate (for conformance tests). */
export function normative(state) {
  const elements = {};
  for (const [id, e] of Object.entries(state.elements)) { const { estimate, last_seen, ...rest } = e; elements[id] = rest; }
  return { ...state, elements };
}

export class LearnerRecord {
  constructor(dir) {
    this.dir = dir;
  }

  #ensure() { mkdirSync(join(this.dir, "state"), { recursive: true }); }
  #file(name) { return join(this.dir, name); }

  #all() {
    const f = this.#file("events.jsonl");
    const events = !existsSync(f) ? [] : readFileSync(f, "utf8").split("\n").filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    // 0.2 records kept the profile only in profile.md: turn it into one profile_updated event once.
    if (!events.some((e) => e.verb === "profile_updated") && existsSync(this.#file("profile.md"))) {
      const fm = parseFrontmatter(readFileSync(this.#file("profile.md"), "utf8"));
      if (fm) {
        const { type, ptf_version, updated, ...fields } = fm.data;
        if (fm.body.trim()) fields.notes = fm.body.trim();
        const ev = { id: ulid(), at: new Date().toISOString(), verb: "profile_updated", object: "ptf:learner", result: { fields }, context: { host: "ptf-mcp", reason: "import" } };
        this.#ensure();
        appendFileSync(f, JSON.stringify(ev) + "\n");
        events.push(ev);
      }
    }
    return events;
  }

  state() { return derive(this.#all()); }

  #writeViews(state = this.state()) {
    this.#ensure();
    if (state.profile) {
      const { notes, ...data } = state.profile;
      writeAtomic(this.#file("profile.md"), `---\n${YAML.stringify(data)}---\n\n${(notes ?? "").trim()}\n`);
    }
    writeAtomic(this.#file("mastery.json"), JSON.stringify({ ptf_version: PTF_VERSION, updated: new Date().toISOString(), concepts: this.#concepts(state) }, null, 2) + "\n");
  }

  #concepts(state, now = Date.now()) {
    const out = {};
    for (const [id, e] of Object.entries(state.elements)) {
      const { estimate, ...rest } = e;
      out[id] = { ...rest, mastery: retrievability(estimate, now),
        ...(estimate.next_review ? { next_review: estimate.next_review, interval_days: estimate.interval_days, stability_days: estimate.stability_days } : {}) };
    }
    return out;
  }

  profile() {
    const p = this.state().profile;
    return p ? { notes: "", ...p } : null;
  }

  /** Records the change as a profile_updated event; `notes` replaces the free-text notes when given. */
  updateProfile(fields) {
    const changes = Object.fromEntries(Object.entries(fields).filter(([k, v]) => v !== undefined && !["type", "ptf_version", "updated"].includes(k)));
    const hasLearner = this.state().profile?.learner;
    if (!hasLearner) changes.learner = `anon:${randomBytes(3).toString("hex")}`;
    this.#append({ verb: "profile_updated", object: "ptf:learner", result: { fields: changes } });
    this.#writeViews();
    return this.profile();
  }

  mastery() { return { ptf_version: PTF_VERSION, concepts: this.#concepts(this.state()) }; }

  events(limit = 20, filter = () => true) {
    return this.#all().filter(filter).slice(-limit);
  }

  #append(fields, now = new Date()) {
    this.#ensure();
    const ev = { id: ulid(now.getTime()), at: now.toISOString(), ...fields };
    appendFileSync(this.#file("events.jsonl"), JSON.stringify(ev) + "\n");
    return ev;
  }

  /**
   * Appends an event. `element` attributes simulator and question results to the learning element they
   * were used for. `info(elementId)` returns { objectives: [ids], version, catalog, questionObjectives(qid) }
   * from the library, or null. A completed event for an element is checked before it is stored: it names
   * the objectives and the correct answers that show them; missing evidence is picked from the log.
   */
  record({ verb, object, level, result, context, element, path, note, keep }, info = () => null) {
    if (!VERBS.has(verb)) throw new Error(`Unknown verb ${verb}`);
    if (!/^ptf:(el|path|sim)\//.test(object ?? "")) throw new Error(`object must be a ptf:el/, ptf:path/ or ptf:sim/ ID, got ${object}`);
    const elId = object.startsWith("ptf:el/") ? object.split("#")[0] : element?.startsWith("ptf:el/") ? element : null;
    const meta = elId ? info(elId) : null;
    const res = result && Object.keys(result).length ? { ...result } : undefined;
    if (verb === "answered" && res && !res.objectives && meta && object.includes("#")) {
      const objs = meta.questionObjectives?.(object.split("#")[1]);
      if (objs?.length) res.objectives = objs;
    }
    const coursePath = path ?? (["started", "left", "consented", "withdrew"].includes(verb) || object.startsWith("ptf:path/") ? object.split("#")[0] : undefined);
    const ctx = { host: "ptf-mcp", ...(context ?? {}), ...(element ? { element } : {}), ...(coursePath ? { path: coursePath } : {}),
      ...(meta?.version && !object.includes("#") ? { version: meta.version } : {}), ...(meta?.catalog ? { catalog: meta.catalog } : {}) };

    const ev = { id: ulid(), at: new Date().toISOString(), verb, object };
    if (level) ev.level = level;
    if (note) ev.note = String(note).slice(0, 1000);
    if (keep) ev.keep = String(keep).slice(0, 2000);
    ev.context = ctx;

    if (verb === "completed" && object.startsWith("ptf:el/") && !object.includes("#")) {
      if (!level) throw new Error("completed needs the level at which the element was completed.");
      const all = this.#all();
      const objectives = res?.objectives ?? meta?.objectives ?? [];
      let evidence = res?.evidence;
      if (!evidence) {
        // Pick the latest correct answer at this level per objective (or any one without objectives); answers after the solution do not count.
        const answers = all.filter((e) => isEvidence(e) && elementOf(e) === elId && (!e.level || e.level === level));
        evidence = objectives.length
          ? [...new Set(objectives.map((o) => answers.filter((a) => a.result?.objectives?.includes(o)).at(-1)?.id).filter(Boolean))]
          : answers.slice(-1).map((a) => a.id);
      }
      ev.result = { ...(res ?? {}), objectives, evidence };
      const check = checkCompletion(ev, new Map(all.map((e) => [e.id, e])));
      if (!check.ok) {
        throw new Error(`Not completed: ${check.reason}. Ask a check question for each missing objective at level ${level} (a new one if the solution was shown) and record the ` +
          "answer with record_progress (verb answered, result.correct, result.objectives), then record completed again. " +
          "If the learner wants to leave the step out, record verb skipped instead.");
      }
    } else if (res) ev.result = res;

    this.#ensure();
    appendFileSync(this.#file("events.jsonl"), JSON.stringify(ev) + "\n");
    this.#writeViews();
    return ev;
  }

  /**
   * Sync (LEARNER-RECORD.md §8): merges events from another copy by id and returns the events this copy
   * had received since `since` (a cursor from an earlier call), plus the new cursor.
   */
  sync(events = [], since = "") {
    const all = this.#all();
    const start = Math.max(0, Number.parseInt(since || "0", 10) || 0);
    const outgoing = all.slice(start);
    const known = new Set(all.map((e) => e.id));
    const incoming = [];
    for (const e of events) {
      if (!e || typeof e.id !== "string" || !e.at || !VERBS.has(e.verb) || typeof e.object !== "string" || known.has(e.id)) continue;
      known.add(e.id);
      incoming.push(e);
    }
    if (incoming.length) {
      this.#ensure();
      appendFileSync(this.#file("events.jsonl"), incoming.map((e) => JSON.stringify(e)).join("\n") + "\n");
    }
    this.#writeViews();
    return { received: incoming.length, events: outgoing, cursor: String(all.length + incoming.length) };
  }

  /** Completed elements and, per simulator, the stations completed, from the whole log. */
  progress() {
    const s = this.state();
    return { elements_completed: Object.entries(s.elements).filter(([, e]) => e.completed.length).map(([id]) => id), simulators: this.#stations(this.#all()) };
  }

  /**
   * Courses (LEARNER-RECORD.md §5). `pathInfo(id)` returns { steps: [{ element, optional }] } from the library, or null.
   * A step is done when the element has a completion at any level; a skipped step is passed over but does not count.
   */
  courses(pathInfo = () => null, state = this.state()) {
    const out = new Map(Object.entries(state.courses).map(([path, c]) => [path, { path, ...c }]));
    for (const g of state.profile?.goals ?? []) {
      for (const path of [...(g.paths ?? []), ...(g.path ? [g.path] : [])]) {
        if (!out.has(path)) out.set(path, { path, status: "planned", goal: g.text, last_activity: null, last_note: null });
      }
    }
    for (const c of out.values()) {
      const info = pathInfo(c.path);
      if (!info) continue;
      const done = (s) => Boolean(state.elements[s.element]?.completed.length);
      const skipped = (s) => Boolean(state.elements[s.element]?.skipped);
      c.current_step = info.steps.find((s) => !done(s) && !skipped(s))?.element ?? null;
      c.steps_done = info.steps.filter(done).length;
      c.steps_skipped = info.steps.filter((s) => !done(s) && skipped(s)).length;
      c.steps_total = info.steps.length;
      if (c.status === "active" && info.steps.length && info.steps.every((s) => s.optional || done(s))) c.status = "completed";
    }
    return [...out.values()];
  }

  /** One course in detail (LEARNER-RECORD.md §2, get_learner({ course })). */
  course(pathId, info) {
    const state = this.state();
    const elements = new Set((info?.steps ?? []).map((s) => s.element));
    const events = this.#all().filter((ev) => ev.context?.path === pathId || elements.has(elementOf(ev)));
    const summary = this.courses(() => info, state).find((c) => c.path === pathId) ?? { path: pathId, status: "not started" };
    const placement = events.filter((e) => e.verb === "assessed")
      .map((e) => ({ element: e.object.split("#")[0], score: e.result?.score ?? null, level: e.level ?? null, reason: e.context?.reason ?? "placement" }));
    return {
      ...summary,
      sharing: (state.consents[pathId] ?? []).map(({ at, ...c }) => c),
      placement,
      steps: (info?.steps ?? []).map((s) => {
        const e = state.elements[s.element];
        return { element: s.element, optional: Boolean(s.optional), completed: e?.completed.map((c) => c.level) ?? [],
          done: Boolean(e?.completed.length), skipped: Boolean(e?.skipped && !e.completed.length), target_level: e?.target_level ?? null,
          mastery: e ? retrievability(e.estimate) : null, ...(e?.keep ? { keep: e.keep } : {}) };
      }),
      open_misconceptions: [...new Set([...elements].flatMap((e) => state.elements[e]?.open_misconceptions ?? []))],
      suspected_misconceptions: [...new Set([...elements].flatMap((e) => state.elements[e]?.suspected_misconceptions ?? []))],
      simulators: this.#stations(events),
      recent_events: events.slice(-20),
    };
  }

  /** One element in detail. */
  element(elementId) {
    const events = this.#all().filter((ev) => elementOf(ev) === elementId);
    return { element: elementId, mastery: this.#concepts(this.state())[elementId] ?? null, simulators: this.#stations(events), recent_events: events.slice(-20) };
  }

  /** Reviews due, at most `limit`: first what the next steps of active courses require, then the most overdue. */
  reviewsDue(firstIds = [], limit = 10, today = new Date().toISOString().slice(0, 10)) {
    const due = Object.entries(this.state().elements).filter(([, e]) => e.estimate.next_review && e.estimate.next_review <= today)
      .map(([id, e]) => ({ element: id, next_review: e.estimate.next_review, mastery: retrievability(e.estimate),
        open_misconceptions: e.open_misconceptions, suspected_misconceptions: e.suspected_misconceptions }));
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
