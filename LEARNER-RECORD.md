# PTF Learner Record

**Version 0.2 (draft)** · part of the [Personal Tutor Format](SPEC.md)

The learner record holds who a learner is, how they like to learn, and what
they have learned. It belongs to the learner. This document defines what a
host must be able to do with it (§2) and how it is exported (§8). How a host
stores it is up to the host: Magister uses PostgreSQL, the local MCP server a
small database on the device.

---

## 1. Principles

1. **The learner owns it.** A host keeps the record for the learner and lets
   them export and delete it at any time.
2. **Read what is needed.** A tutor reads the overview at the start of a
   session and the details of one course when it works on it, never the
   whole history. The record may grow for years; what the tutor reads does
   not.
3. **Shared only within a course, and only visibly.** Progress leaves the
   host only to the people a course names, and only after the learner has
   seen what is shared (§7).
4. **Pseudonymous.** The record needs no real name.
5. **Portable.** Every host exports the same files (§8), so a learner can
   move between hosts or keep a local copy in sync.
6. **Children.** For a learner with `age_band: child`, a parent or guardian
   manages the record and every consent.

---

## 2. Operations

A host offers these operations. The names are those of the MCP tools.

| Operation | What it does |
| --- | --- |
| `get_learner()` | The overview: profile (§3), courses in progress or planned (one line each: path, status, current step, last activity), and up to 10 reviews due. |
| `get_learner({ course })` | One course (a path ID) or one element: placement, per step the level, mastery and whether it is done, completed simulator stations, open misconceptions, the last `note`, and the course's last 20 events. |
| `record_progress(event)` | Stores one event (§4) and updates mastery (§6) and the course (§5). Optional `note` and `keep`, see below. |
| `update_learner_profile(fields)` | Merges fields into the profile. |
| `sync_learner({ events, since })` | Takes events from another copy of the record and returns the events this host has received since the cursor `since` (§8). |

Two optional fields of `record_progress` keep the record small:

- `note`: two or three sentences for the next session ("recapped after six
  weeks, causal mask refreshed, started self-attention"). The latest note of
  a course is returned with it.
- `keep`: a short explanation in the learner's own terms that made it click
  ("speed and distance: the area under speed is distance"). It is stored with
  the element's mastery and returned with the element, for this learner only.

Reviews due are ordered: first the elements the next step of an active course
`requires`, then the most overdue.

---

## 3. Profile

Who the learner is and how they learn. Exported as `profile.md`: Markdown
with YAML frontmatter, `type: Learner Profile`, free notes for the tutor in
the body. Schema: [schemas/learner-profile.schema.json](schemas/learner-profile.schema.json).

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
  explain:                       # §3.1
    start_with: example
    formulas: when_useful
    length: short
interests: [LLMs, physics]
goals:
  - text: Understand integral calculus at university level
    paths: [ptf:path/math/integrals, ptf:path/uni-analysis/integrals]
updated: 2026-11-02T18:40:00Z
---

Prefers numbers before formulas.
```

A goal may list several paths in order; the host keeps them as planned
courses (§5). The profile also takes `display_name`, `accessibility`
(`reduced_motion`, `font_scale`, `screen_reader`) and `strengths`.

### 3.1 Explanation preferences

A learning element fixes *what* is taught (SPEC.md §6.7); `style.explain`
says *how* this learner wants it explained. All fields are optional.

| Field | Values | Meaning |
| --- | --- | --- |
| `start_with` | `big_picture`, `example`, `question` | How to open a step. |
| `analogies` | `often`, `sometimes`, `rarely` | How much to lean on analogies. |
| `formulas` | `avoid`, `when_useful`, `always` | Whether to show the maths. |
| `length` | `short`, `medium`, `detailed` | Length of one explanation before the next interaction. |
| `simulators` | `rarely`, `when_useful`, `often` | How readily to open a simulator. |
| `notes` | text | Anything else, in the learner's words. |

The tutor asks about these at the start of the first course and updates them
whenever the learner says how they want it. Binding tutor notes in the
content win.

---

## 4. Events

Everything that happens is an event, a small subset of xAPI. Events are never
changed; mastery and courses are derived from them. Schema:
[schemas/learner-event.schema.json](schemas/learner-event.schema.json).

```json
{"id":"01JB…","at":"2026-10-26T12:03:00Z","verb":"answered","object":"ptf:el/llm-basics/softmax#q2","level":"college","result":{"correct":false,"misconception":"softmax-makes-zeros"},"context":{"path":"ptf:path/llm-basics/gpt-from-scratch"}}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Unique, sortable by time (ULID). Copies of a record merge by `id`. |
| `at` | yes | ISO 8601 timestamp with offset. |
| `verb` | yes | See below. |
| `object` | yes | Global PTF ID: element, question (`#id`), path, or simulator station. |
| `level` | no | Level at which it happened. |
| `result` | no | `correct`, `score` (0 to 1), `response`, `misconception`, `duration_s`; for `started` also `consent` (§7). |
| `note` | no | The tutor's note for the next session (§2). |
| `context` | no | `path` (SHOULD be set when the event belongs to a course), `host`, `reason`, free keys. |

| Verb | When |
| --- | --- |
| `started` | The learner starts a course (object: the path). Carries the consent to share (§7). |
| `assessed` | Placement of an element: before a course (SPEC.md §8.1) or, with `context.reason: recap`, after a long break (§6). `result.score` is the placement, `level` the deepest level answered securely. |
| `experienced` | Saw an explanation or station. |
| `attempted` | Started a question or task. |
| `answered` | Answered; `result` says how. |
| `station_completed` | Finished a simulator station. |
| `completed` | Finished an element, or a path (§5). |
| `left` | Stopped a course, or withdrew a consent the course requires. |
| `level_changed`, `understood`, `rephrase`, `deeper`, `stuck`, `asked` | What the learner said or asked for at a check-in; `asked` keeps the question in `result.response`. |
| `reported_broken` | The learner pressed "doesn't work" on a simulator. |

---

## 5. Courses

A course is a learning path the learner takes. Its state is derived from the
events whose `context.path` is that path:

| Field | From |
| --- | --- |
| `status` | `planned` (in a goal, not started), `active` (`started`), `completed`, `left`. A host MAY add `access_lost` when the learner can no longer open the content. |
| `start_level`, `placement` | The `assessed` events before the first step: what was skipped, shortened, and at which level. |
| `current_step` | The first step that is neither completed nor placed at 0.8 or more. |
| `last_note` | The latest `note`. |
| `sharing` | The consent given with `started` (§7). |

A path is **completed** when every step that is not `optional` is completed or
was placed at 0.8 or more. The host then records `completed` for the path.

---

## 6. Mastery

The current state per learning element, derived from events. Exported as
`mastery.json`. Schema: [schemas/mastery.schema.json](schemas/mastery.schema.json).

```json
{
  "ptf_version": "0.2",
  "updated": "2026-10-26T12:30:00Z",
  "concepts": {
    "ptf:el/llm-basics/softmax": {
      "level": "college",
      "mastery": 0.8,
      "last_seen": "2026-10-26T12:30:00Z",
      "next_review": "2026-10-30",
      "interval_days": 4,
      "open_misconceptions": ["softmax-makes-zeros"],
      "versions_seen": { "element": "1.0.0", "ptf:sim/next-char-lab": "2.0.0" },
      "keep": "Like turning votes into percentages."
    }
  }
}
```

- `mastery` is 0 to 1. Recent results weigh more; the exact formula is the
  host's choice. A review is due on `next_review`; the interval grows while
  answers stay right and falls back to one day after a wrong one.
- `assessed` sets `mastery` to `result.score` instead of averaging it in, and
  sets `source: "diagnosis"`. A claim alone gives at most 0.4; 0.8 or more
  needs a correct answer for every objective. A placement of 0.8 or more is
  reviewed after at most 3 days. The next other result removes `source`.
- **Recap after a break.** When a learner returns to a course after two weeks
  or more, the tutor lets them retell what they remember, asks about what is
  missing, and records `assessed` with `context.reason: recap` for the
  elements of the completed steps. The same score rules apply.
- `keep` is the learner's own explanation (§2).
- Hosts MAY add keys and MUST keep keys they do not know.

---

## 7. Sharing

A course may name who sees the progress of its learners, and whether that is
required (SPEC.md §8.2). Nothing else leaves the host.

1. **Before the first step**, the tutor or the host shows, in plain words:
   with whom, which areas, whether it is required, and until when. Areas are
   `progress` (steps done, current step), `mastery` (values per element) and
   `answers` (single answers and questions).
2. **Required** sharing: the course starts only when the learner agrees. If
   they decline, they do not take the course. **Optional** sharing is off
   until the learner turns it on.
3. The agreement is part of the `started` event:
   `"result": { "consent": [{ "with": "publisher", "areas": ["progress", "mastery"], "required": true }] }`.
4. The learner can see at any time who sees what, and withdraw. Withdrawing
   required sharing ends the course (`left`); the learner keeps their record.
5. Sharing ends when the course ends, is left, or the content is no longer
   available.
6. What flows back into a library (SPEC.md §10) is aggregated and anonymous.

---

## 8. Export and sync

Every host can export the record as a folder, usually zipped:

```
profile.md       # §3
mastery.json     # §6
events.jsonl     # §4, one event per line, sorted by id
```

Courses (§5) are derived from the events and are not exported separately.
Simulator resume state is host-specific and not part of the export.

A learner may keep copies on several hosts, for example the local server on a
laptop and Magister. One copy is the **home**; the others sync with it through
`sync_learner`:

- A copy sends the events it has created since the last sync and receives
  the home's events since its cursor. Events are merged by `id`; an `id` that
  already exists is skipped.
- Each copy then recomputes mastery and courses from its events.
- Profile fields: the newest `updated` wins, per top-level field.
- Importing an exported folder into a host is a sync with `since` empty.

---

## 9. Open questions

- Signed exports, so that a host can trust imported mastery.
- Leaderboards that reveal only a nickname and points.
- Sharing outside a course (for example a profile with a coach).
