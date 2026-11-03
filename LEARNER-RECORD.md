# PTF Learner Record

**Version 0.2 (draft)** · part of the [Personal Tutor Format](SPEC.md)

The learner record holds who a learner is, how they like to learn and what
they have learned. It belongs to the learner. This document fixes what a host
must be able to *do* with it (§2) and how it moves between hosts (§8).

**How a host stores it is up to the host.** A database is RECOMMENDED,
because a record grows for years and the tutor reads only small parts of it:
Magister uses PostgreSQL, a local server can use SQLite. The operations (§2),
the events (§4) and the export format (§8) are normative; tables and files
are not.

---

## 1. Principles

1. **The learner owns it**: they can see, export and delete it at any time.
2. **Read what is needed**: an overview at the start of a session, the
   details of one course while working on it, never the whole history.
3. **Shared only within a course, and only visibly** (§7).
4. **Pseudonymous**: no real name needed.
5. **Portable**: every host exports and imports the same folder (§8).
6. **Children**: for `age_band: child`, a parent or guardian manages the
   record and every consent.

---

## 2. Operations

The names are those of the MCP tools.

| Operation | What it does |
| --- | --- |
| `get_learner()` | Overview: profile (§3), courses in progress or planned (path, status, current step, last activity), up to 10 reviews due. |
| `get_learner({ course })` | One course (a path ID) or one element: placement, per step level, mastery and whether it is done, completed simulator stations, open misconceptions, the last `note`, the course's last 20 events. |
| `record_progress(event)` | Stores one event (§4) and updates mastery (§6) and the course (§5). Optional `note` and `keep`. |
| `update_learner_profile(fields)` | Merges fields into the profile. |
| `sync_learner({ events, since })` | Takes events from another copy and returns this host's events since the cursor (§8). |

- `note`: two or three sentences for the next session; the latest note of a
  course comes back with it.
- `keep`: an explanation in the learner's own terms that made it click; it is
  stored with the element's mastery and comes back with the element.

Reviews due are ordered: first what the next step of an active course
`requires`, then the most overdue.

---

## 3. Profile

Exported as `profile.md` (`type: Learner Profile`, notes for the tutor in the
body). Schema: [schemas/learner-profile.schema.json](schemas/learner-profile.schema.json).

```yaml
---
type: Learner Profile
ptf_version: "0.2"
learner: anon:7f3c9a
languages: [de, en]
preferred_lang: de
age_band: adult                  # child | teen | adult
style:
  modality: [visual, hands-on]   # visual | hands-on | reading | listening | discussion
  pace: fast                     # slow | normal | fast
  default_level: college
  explain: { start_with: example, formulas: when_useful, length: short }   # §3.1
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
courses (§5).

### 3.1 Explanation preferences

`style.explain` says *how* this learner wants things explained, never *what*
has to be understood. All fields are optional.

| Field | Values |
| --- | --- |
| `start_with` | `big_picture`, `example`, `question` |
| `analogies` | `often`, `sometimes`, `rarely` |
| `formulas` | `avoid`, `when_useful`, `always` |
| `length` | `short`, `medium`, `detailed` (one explanation before the next interaction) |
| `simulators` | `rarely`, `when_useful`, `often` |
| `notes` | Anything else, in the learner's words |

The tutor fills these in when the learner says how they want it, rather than
by questionnaire.

---

## 4. Events

Everything that happens is an event, a small subset of xAPI. Events never
change; mastery and courses are derived from them. Schema:
[schemas/learner-event.schema.json](schemas/learner-event.schema.json).

```json
{"id":"01JB…","at":"2026-10-26T12:03:00Z","verb":"answered","object":"ptf:el/llm-basics/softmax#q2","level":"college","result":{"correct":false,"misconception":"softmax-makes-zeros"},"context":{"path":"ptf:path/llm-basics/gpt-from-scratch"}}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Unique and time-sortable (ULID); copies merge by it. |
| `at` | yes | ISO 8601 with offset. |
| `verb` | yes | See below. |
| `object` | yes | Global PTF ID: element, question, path or simulator station. |
| `level` | no | Level at which it happened. |
| `result` | no | `correct`, `score` (0 to 1), `response`, `misconception`, `duration_s`; `consent` on `started` (§7). |
| `note` | no | The tutor's note for the next session (§2). |
| `context` | no | `path` (set when the event belongs to a course), `host`, `reason`, free keys. |

| Verb | When | Evidence? |
| --- | --- | --- |
| `answered` | The learner answered; `result` says how. | yes |
| `assessed` | Placement of an element before a course, or with `context.reason: recap` after a long break; `result.score` is the placement, `level` the deepest level answered securely. | yes |
| `station_completed` | Finished a simulator station. | yes, for that station |
| `completed` | Finished an element (its objectives met) or a path (§5). | yes |
| `started` | Started a course (object: the path); carries the consent (§7). | no |
| `left` | Stopped a course, or withdrew a consent it requires. | no |
| `experienced`, `attempted` | Saw an explanation or station; began a question or task. | no |
| `understood`, `rephrase`, `deeper`, `stuck`, `level_changed`, `asked` | What the learner said or asked for; `asked` keeps the question in `result.response`. | no |
| `reported_broken` | The learner reported a broken simulator. | no |

Only evidence changes mastery. The other verbs are kept so the tutor knows
what happened.

---

## 5. Courses

A course is a path the learner takes. Its state is derived from the events
with that `context.path`:

| Field | From |
| --- | --- |
| `status` | `planned` (in a goal), `active` (`started`), `completed`, `left`; a host MAY add `access_lost`. |
| `start_level`, `placement` | The `assessed` events before the first step. |
| `current_step` | The first step that is neither completed nor placed as secure (§6). |
| `last_note` | The latest `note`. |
| `sharing` | The consent given with `started` (§7). |

When every step that is not `optional` is completed or placed as secure, the
host records `completed` for the path.

---

## 6. Mastery

The current state per element, derived from events and exported as
`mastery.json`. Schema: [schemas/mastery.schema.json](schemas/mastery.schema.json).

```json
{
  "ptf_version": "0.2",
  "updated": "2026-10-26T12:30:00Z",
  "concepts": {
    "ptf:el/llm-basics/softmax": {
      "level": "college", "mastery": 0.8, "completed": true,
      "last_seen": "2026-10-26T12:30:00Z", "next_review": "2026-10-30", "interval_days": 4,
      "open_misconceptions": ["softmax-makes-zeros"],
      "versions_seen": { "element": "1.0.0", "ptf:sim/next-char-lab": "2.0.0" },
      "keep": "Like turning votes into percentages."
    }
  }
}
```

- `mastery` is 0 to 1; the formula is the host's. Recent results weigh
  more.
- **Secure means 0.8 or more**, and it needs evidence for every objective of
  the element. This one number is shared by all hosts, so that courses
  derive the same way everywhere.
- `assessed` sets `mastery` to its score and marks `source: "diagnosis"`; a
  claim without a correct answer never reaches secure. A placement as secure
  gets an early first review. The next other result removes `source`.
- Reviews: `next_review` and `interval_days` grow while answers stay right
  and fall back after a wrong one.
- Hosts MAY add keys and MUST keep keys they do not know.

---

## 7. Sharing

A course may name who sees its learners' progress (SPEC.md §8.2). Nothing
else leaves the host.

1. Before the first step the learner sees, in plain words, with whom, which
   areas, whether it is required and until when.
2. Required sharing: the course starts only with agreement. Optional
   sharing: off until the learner turns it on.
3. The agreement is part of the `started` event:
   `"result": { "consent": [{ "with": "publisher", "areas": ["progress", "mastery"], "required": true }] }`.
4. The learner can see at any time who sees what, and withdraw. Withdrawing
   required sharing ends the course (`left`); the learner keeps their record.
5. Sharing ends with the course or when the content is no longer available.
6. What flows back into a library is aggregated and anonymous (SPEC.md §10).

---

## 8. Export and sync

Every host exports the record as a folder, usually zipped, and imports it:

```
profile.md       # §3
mastery.json     # §6
events.jsonl     # §4, one event per line, sorted by id
```

Courses are derived from events and not exported. Simulator resume state is
host-specific.

A learner may keep copies on several hosts, for example a local server and
Magister. One copy is the **home**; the others call `sync_learner`: a copy
sends the events it created since the last sync and receives the home's
events since its cursor; events merge by `id`; each copy recomputes mastery
and courses; for the profile, the newest `updated` wins per top-level field.
Importing an exported folder is a sync with an empty cursor.

---

## 9. Open questions

- Signed exports, so a host can trust imported mastery.
- Leaderboards that reveal only a nickname and points.
- Sharing outside a course (for example with a coach).
