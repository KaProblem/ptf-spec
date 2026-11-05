# PTF Learner Record

**Version 0.3 (draft)** · part of the [Personal Tutor Format](SPEC.md)

The learner record holds who a learner is, how they like to learn and what
they have shown they can do. It belongs to the learner.

**The record is its events.** Everything else (the profile, completions,
consents, courses, the estimate used for reviews) is derived from them, so two
hosts with the same events derive the same state, and a sync that merges
events loses nothing (§8). How a host stores events and derived state is up to
the host; a database is RECOMMENDED, because a record grows for years and the
tutor reads only small parts of it. Magister uses PostgreSQL; a local server can
use SQLite. Normative are the operations (§2), the events (§4), the derivation
rules (§3, §5 to §7) and the export (§8).

---

## 1. Principles

1. **The learner owns it**: they can see, export and delete it at any time.
2. **Evidence decides**: what counts as learned is a completion backed by
   correct answers (§5). A self-report or an estimate never does.
3. **Read what is needed**: an overview at the start of a session, the
   details of one course while working on it, never the whole history.
4. **Shared only within a course, and only visibly** (§7).
5. **Pseudonymous**: no real name needed.
6. **Children**: for `age_band: child`, a parent or guardian manages the
   record and every consent.

---

## 2. Operations

The names are those of the MCP tools.

| Operation | What it does |
| --- | --- |
| `get_learner()` | Overview: profile (§3), courses in progress or planned (path, status, current step, last activity), up to 10 reviews due. |
| `get_learner({ course })` | One course (a path ID) or one element: per step the levels completed, done, skipped, target level, completed simulator stations, consents, placement, open misconceptions, the last `note`, the last 20 events. |
| `record_progress(event)` | Stores one event (§4). A host MUST check a `completed` event before storing it (§5) and say what is missing. |
| `update_learner_profile(fields)` | Stores a `profile_updated` event (§3). |
| `sync_learner({ events, since })` | Merges events from another copy and returns this host's events received since the cursor `since`, with a new cursor (§8). |

`note` (two or three sentences for the next session) and `keep` (an
explanation in the learner's own words that made it click) are fields of any
event. The latest `note` of a course and the latest `keep` of an element come
back with them.

---

## 3. Profile

Who the learner is and how they learn, derived from `profile_updated` events:
their `result.fields` are merged in event order (nested objects such as
`style.explain` field by field, values and arrays replaced), so the later
change wins per field. `updated` is the time of the last change. Exported as
`profile.md` for people (`type: Learner Profile`, `notes` in the body).
Schema: [schemas/learner-profile.schema.json](schemas/learner-profile.schema.json).

```yaml
---
type: Learner Profile
ptf_version: "0.3"
learner: anon:7f3c9a
languages: [de, en]
preferred_lang: de
age_band: adult                  # child | teen | adult
style:
  modality: [visual, hands-on]   # visual | hands-on | reading | listening | discussion
  pace: fast                     # slow | normal | fast
  default_level: college
  explain: { start_with: example, formulas: when_useful, length: short }
interests: [LLMs, physics]
goals:
  - text: Understand integral calculus at university level
    paths: [ptf:path/math/integrals, ptf:path/uni-analysis/integrals]
updated: 2026-11-02T18:40:00Z
---

Prefers numbers before formulas.
```

The profile also takes `display_name`, `accessibility` (`reduced_motion`,
`font_scale`, `screen_reader`) and `strengths`. A goal's paths become planned
courses.

`style.explain` says *how* this learner wants things explained, never *what*
has to be understood: `start_with` (`big_picture`, `example`, `question`),
`analogies` (`often`, `sometimes`, `rarely`), `formulas` (`avoid`,
`when_useful`, `always`), `length` (`short`, `medium`, `detailed`),
`simulators` (`rarely`, `when_useful`, `often`), `notes`. The tutor fills
these in when the learner says how they want it, rather than by questionnaire.

---

## 4. Events

A small subset of xAPI. Events never change. Schema:
[schemas/learner-event.schema.json](schemas/learner-event.schema.json).

```json
{"id":"01JB…","at":"2026-10-26T12:03:00Z","verb":"answered","object":"ptf:el/llm-basics/softmax#q2","level":"college","result":{"correct":true,"objectives":["probabilities"]},"context":{"path":"ptf:path/llm-basics/gpt-from-scratch","catalog":"io.github.kaproblem.ptf-library","version":"1.0.0"}}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Unique and time-sortable (ULID). Copies merge by it; derivation runs in `id` order. |
| `at` | yes | ISO 8601 with offset. |
| `verb` | yes | See below. |
| `object` | yes | Global PTF ID (element, question, path, simulator station), or `ptf:learner` for `profile_updated`. |
| `level` | for `completed` | Level at which it happened. |
| `result` | no | Verb-specific, see below. Also `score` (0 to 1), `response`, `misconception`, `duration_s`. |
| `note`, `keep` | no | See §2. |
| `context` | no | `path` (the course), `catalog` (ID of the catalog the object came from), `version` (of the element or path), `element` (for a simulator or question used for an element), `reason`, `host`, free keys. |

| Verb | When | `result` |
| --- | --- | --- |
| `answered` | The learner answered a question, in a card or in the conversation. | `correct`, `objectives` (the objective IDs it checks), `misconception`, `assistance` (`none` default, `hint`: after a hint, `solution`: after the solution was shown; §5) |
| `completed` | The learner has shown the element's objectives at `level` (§5); with `context.reason: placement` before teaching it. Object a path: the course is done. | `objectives`, `evidence` (IDs of `answered` events) |
| `skipped` | The learner chose to leave the element out. Does not count as done. | |
| `assessed` | A placement score before a course, or with `context.reason: recap` after a long break. For planning and reviews only. | `score` |
| `started`, `left` | A course starts or stops (object: the path). | |
| `consented`, `withdrew` | Sharing for a course is granted or taken back (§7). | `with`, `areas`, `required` |
| `profile_updated` | The profile changed (§3). | `fields` |
| `station_completed` | A simulator station's task is done. | |
| `experienced`, `attempted` | Saw an explanation or station; began a task. | |
| `understood`, `rephrase`, `deeper`, `stuck`, `level_changed`, `asked` | What the learner said or asked for. `deeper` and `level_changed` set the element's target level. | `response` for `asked` |
| `reported_broken` | A simulator did not work. | |

Hosts set `context.catalog` and `context.version` when they know them. An ID
is interpreted in the catalog its event names, never by which catalog a host
happens to have connected first (CATALOG.md §2.3).

---

## 5. Completion

A **completion** is a `completed` event for an element at one level. It is
valid when:

1. it names the level, and in `result.objectives` every objective ID of the
   element (SPEC.md §6.1), or none when the element has no objective IDs;
2. `result.evidence` lists earlier `answered` events of the same element with
   `correct: true`, at the same level when they carry one, not given after
   the solution was shown (`result.assistance` is not `solution`), whose
   `result.objectives` together cover every listed objective (at least one
   such answer when no objectives are listed).

A host MUST reject an invalid completion when it is recorded and tell the
tutor which objective lacks evidence. When deriving, a host ignores invalid
completions it receives through sync. A `completed` event without
`result.evidence` comes from version 0.2: it counts, marked
`verified: false`.

Completions are per level. Going deeper changes the target level, never an
existing completion; a correct or wrong review answer changes neither. An
element is **done** when it has a completion at any level.

**Courses** are derived from the events with `context.path`:

| Field | From |
| --- | --- |
| `status` | `planned` (a path in a goal), `active` (`started`), `left`, `completed` (every non-optional step done, or a `completed` event for the path); a host MAY add `access_lost`. |
| `current_step` | The first step that is neither done nor skipped. |
| `steps` | Per step: levels completed, done, skipped, target level. |
| `placement` | The `assessed` events. |
| `last_note`, `sharing` | The latest `note`; the consents (§7). |

A skipped step stays open for completion: a course with skipped
non-optional steps is not completed.

---

## 6. Misconceptions and the estimate

**Misconceptions.** A wrong answer that names a misconception makes it
*suspected* for that element; a second wrong answer naming it, with no
correct answer on it in between, makes it *open*. A correct answer that names
it clears both. One wrong option is a hint, not a diagnosis: the tutor asks
once more before it treats the misconception as the learner's. Both lists are
derived from the events and are normative (§9).

**The estimate.** For scheduling reviews a host keeps, per element, an
estimate of how secure the learner is (`mastery`, 0 to 1), `next_review` and
`interval_days`. **No decision depends on the estimate**: completion,
skipping and course state come from §5 only. The formula is the host's; the
reference host uses this one, which follows the answer history rather than a
fixed schedule:

- A *stability* in days grows with every correct answer given without the
  solution: from 0 to 1 day at the first, then × 2.5 (× 1.5 after a hint), at
  most 180 days. A wrong answer sets it to 1 day. An answer given after the
  solution was shown changes nothing. A placement (`assessed`) sets it to 3
  days when the score is 0.8 or more, else 1.
- `next_review` is the last such answer plus the stability; `interval_days`
  is the stability, rounded.
- `mastery` is the estimated chance of a correct answer now,
  0.9 ^ (days since the last answer ÷ stability), so it falls while the
  learner stays away and is 0 before the first correct answer. Self-reports
  (`understood`) and `experienced` never change it.

Growing intervals are a default, not a finding: evidence favours spaced
retrieval, not any particular schedule, so a host MAY use another formula
(FSRS, a fixed interval) as long as a wrong answer brings the element back
soon and a correct one without help pushes it further out.

`mastery.json` exports the per-element view for people. Schema:
[schemas/mastery.schema.json](schemas/mastery.schema.json).

```json
{
  "ptf_version": "0.3",
  "concepts": {
    "ptf:el/llm-basics/softmax": {
      "completed": [{ "level": "highschool", "at": "2026-10-26T12:30:00Z", "version": "1.0.0",
                      "catalog": "io.github.kaproblem.ptf-library", "objectives": ["probabilities", "larger-score"], "verified": true }],
      "target_level": "college",
      "mastery": 0.8, "next_review": "2026-10-30", "interval_days": 4, "stability_days": 3.75,
      "open_misconceptions": ["softmax-makes-zeros"], "suspected_misconceptions": [],
      "keep": "Like turning votes into percentages."
    }
  }
}
```

---

## 7. Sharing

A course may name who sees its learners' progress (SPEC.md §8.2). Nothing
else leaves the host.

1. Before the first step the learner sees, in plain words, the concrete
   recipient, the areas (`progress`: steps done; `mastery`: completions and
   estimates per element; `answers`: single answers and questions), whether it
   is required and until when.
2. Agreement is a `consented` event per recipient: object the path,
   `result.with` the concrete recipient (the catalog ID of the publisher, or a
   URL), `result.areas`, `result.required`. A later `consented` for the same
   recipient replaces it.
3. `withdrew` takes areas back (`result.areas`), or everything for that
   recipient without `areas`. Withdrawing required sharing ends the course
   (`left`); the learner keeps their record.
4. The current consents are derived from these events. A host MUST check them
   before it shares anything, and shares only those areas with that recipient
   for that course. A course with required sharing starts only after
   `consented`.
5. Sharing ends with the course or when its content is no longer available.
6. What flows back into a library is aggregated and anonymous (SPEC.md §10).

Version 0.2 carried consent in `started` (`result.consent`); hosts read it as
`consented`.

---

## 8. Export and sync

The export is `events.jsonl`: one event per line, sorted by `id`. It is
lossless. A host MAY add `profile.md` and `mastery.json` as views for people;
importing ignores them, except that a 0.2 `profile.md` without any
`profile_updated` event is imported as one. Simulator resume state is
host-specific.

A learner may keep copies on several hosts, for example a local server and
Magister. The others sync with one **home** copy through `sync_learner`: a
copy sends the events it has not sent yet and receives the home's events since
its cursor; events merge by `id` (an existing `id` is skipped); both derive
their state again. The cursor is opaque to the caller. Importing an export is a
sync with an empty cursor.

---

## 9. Conformance

[conformance/learner-record/](conformance/learner-record/) holds shared test
cases: the events of two copies changed independently and the state every host
must derive after merging them, in any order (profile per field, completions
per level with version and catalog, a completion rejected for evidence at the
wrong level or given after the solution was shown, suspected and open
misconceptions, `keep`, consent and withdrawal, a skipped step, a 0.2
completion).
The estimate is not compared. A host passes when its derived state equals
`expected`.

---

## 10. Open questions

- Signed exports, so a host can trust imported completions.
- Leaderboards that reveal only a nickname and points.
- Sharing outside a course (for example with a coach).
