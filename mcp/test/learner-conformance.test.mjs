// Conformance for the learner record (LEARNER-RECORD.md §9): two copies changed independently
// must derive the same state after a sync, in whatever order the events arrive.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { derive, LearnerRecord, normative } from "../src/learner.mjs";

const here = new URL(".", import.meta.url).pathname;
const fixture = JSON.parse(readFileSync(resolve(here, "../../conformance/learner-record/two-devices.json"), "utf8"));
const { device_a: a, device_b: b, expected } = fixture;
const unique = (events) => [...new Map(events.map((e) => [e.id, e])).values()];
const comparable = (s) => { const n = normative(s); delete n.profile?.ptf_version; return JSON.parse(JSON.stringify(n)); };
const exp = comparable(expected);

test("the merged events derive the expected state in any order", () => {
  assert.deepEqual(comparable(derive(unique([...a, ...b]))), exp);
  assert.deepEqual(comparable(derive(unique([...b, ...a]))), exp);
  assert.deepEqual(comparable(derive(unique([...a, ...b]).reverse())), exp);
});

test("two local copies converge through sync_learner", () => {
  const ra = new LearnerRecord(mkdtempSync(join(tmpdir(), "ptf-a-")));
  const rb = new LearnerRecord(mkdtempSync(join(tmpdir(), "ptf-b-")));
  ra.sync(a, ""); rb.sync(b, "");
  const toB = ra.sync([], "");                  // everything A has
  const back = rb.sync(toB.events, "");         // B merges A and returns what it had
  assert.equal(back.received, a.length - 1, "the shared event is merged once");
  ra.sync(back.events, toB.cursor);
  assert.deepEqual(comparable(ra.state()), exp);
  assert.deepEqual(comparable(rb.state()), exp);
});

test("a completion holds for its level only; a correct review keeps it", () => {
  const s = derive(unique([...a, ...b]));
  const c = s.elements["ptf:el/demo/counting"];
  assert.deepEqual(c.completed.map((x) => x.level), ["child"]);
  assert.equal(c.target_level, "highschool");
  assert.ok(s.rejected.includes(b.find((e) => e.verb === "completed").id), "child-level evidence does not complete highschool");
  const review = { id: "01JC0000000000000000000099", at: "2026-11-09T08:00:00Z", verb: "answered", object: "ptf:el/demo/counting#q2",
    level: "child", result: { correct: true, objectives: ["count"] } };
  assert.deepEqual(derive([...unique([...a, ...b]), review]).elements["ptf:el/demo/counting"].completed.map((x) => x.level), ["child"]);
});
