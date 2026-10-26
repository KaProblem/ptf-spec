# PTF Learner Record

**Version 0.1 (draft)** · part of the [Personal Tutor Format](SPEC.md)

The learner record holds who a learner is, how they like to learn, and what
they have learned. It belongs to the learner. It is **local and private by
default** and leaves the device only when the learner shares it with a
platform. Because it is a documented format, a learner can take it to any
platform that supports PTF.

---

## 1. Principles

1. **Local first.** Without a platform, no server ever sees progress. A
   local agent (e.g. Claude Code with the PTF skill) reads and writes the
   record directly.
2. **Consent per area.** Sharing is granted per platform and per area
   (`profile`, `mastery`, `events`, `leaderboard`), and can be revoked.
3. **Pseudonymous.** The record needs no real name. `learner` is a random ID.
4. **Portable.** A folder of plain files; export is a ZIP of that folder.
5. **Anonymous feedback only.** What flows back into a library (SPEC.md
   §10) is aggregated and carries no learner ID.
6. **Children.** For a learner with `age_band: child`, a parent or guardian
   manages the record and every consent.

---

## 2. Layout

```
~/.ptf/learner/            # default location; a host MAY use another
  profile.md               # who I am and how I learn
  mastery.json             # state per concept and level
  events.jsonl             # learning log, one JSON object per line
  consents.json            # what each platform may see
```

A learner MAY keep several records (e.g. one per family member) in
separate folders.

---

## 3. `profile.md`

Markdown with YAML frontmatter, `type: Learner Profile`. The body holds free
notes the tutor should read ("prefers examples from electronics", "gets
frustrated by long derivations").

```yaml
---
type: Learner Profile
ptf_version: "0.1"
learner: anon:7f3c9a
display_name: Stefan             # optional, never sent without consent
languages: [de, en]
preferred_lang: de
age_band: adult                  # child | teen | adult
style:
  modality: [visual, hands-on]   # visual | hands-on | reading | listening | discussion
  pace: fast                     # slow | normal | fast
  default_level: college
  likes: [technical analogies, numbers to calculate]
  dislikes: [long text without interaction]
accessibility:
  reduced_motion: false
  font_scale: 1.0
  screen_reader: false
strengths:
  - concept: ptf:el/physics/nuclear-fusion
    level: expert
    note: very confident
interests: [LLMs, physics, electronics]
goals:
  - text: Understand how an LLM works
    path: ptf:path/llm-basics/gpt-from-scratch
updated: 2026-10-26T11:40:00Z
---

Free-text notes for the tutor.
```

The profile steers both **content** (starting level, examples drawn from
interests, which strengths to build on) and **presentation** (visual
versus text, pace, accessibility). Schema:
[schemas/learner-profile.schema.json](schemas/learner-profile.schema.json).

---

## 4. `events.jsonl`

One event per line, a small subset of xAPI so records can be exported to a
Learning Record Store later.

```json
{"id":"01JB…","at":"2026-10-26T12:03:00Z","verb":"answered","object":"ptf:sim/next-char-lab@2.0.0#softmax","level":"highschool","result":{"correct":false,"misconception":"softmax-makes-zeros"},"context":{"path":"ptf:path/llm-basics/gpt-from-scratch","host":"claude-code"}}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Unique ID (ULID recommended). |
| `at` | yes | ISO 8601 timestamp with offset. |
| `verb` | yes | See below. |
| `object` | yes | Global PTF ID: element, level text, question, simulator station. |
| `level` | no | Level at which it happened. |
| `result` | no | `correct`, `score` (0 to 1), `response`, `misconception`, `duration_s`. |
| `context` | no | `path`, `host`, `session`, free keys. |

Verbs:

| Verb | When |
| --- | --- |
| `experienced` | Saw an explanation or station. |
| `attempted` | Started a question or task. |
| `answered` | Answered; `result` says how. |
| `completed` | Finished an element, station or path. |
| `understood` | Learner said "got it" at a check-in. |
| `rephrase` | Learner asked to explain differently. |
| `deeper` | Learner asked to go deeper (next level). |
| `stuck` | Learner signalled being stuck, or the tutor detected it. |
| `asked` | Learner asked a question; `result.response` holds it. |
| `reported_broken` | Learner pressed "doesn't work" on a simulator. |

Schema: [schemas/learner-event.schema.json](schemas/learner-event.schema.json).

---

## 5. `mastery.json`

Current state per learning element, derived from events (and recomputable
from them).

```json
{
  "ptf_version": "0.1",
  "updated": "2026-10-26T12:30:00Z",
  "concepts": {
    "ptf:el/llm-basics/softmax": {
      "level": "college",
      "mastery": 0.8,
      "last_seen": "2026-10-26T12:30:00Z",
      "next_review": "2026-10-30",
      "interval_days": 4,
      "open_misconceptions": ["softmax-makes-zeros"],
      "versions_seen": { "element": "1.0.0", "ptf:sim/next-char-lab": "2.0.0" }
    }
  }
}
```

- `mastery` is 0 to 1. How a host computes it is not prescribed; it SHOULD
  weigh recent `answered` results higher.
- `next_review` and `interval_days` allow spaced repetition across hosts.
- Hosts MAY add keys and MUST preserve keys they do not know.

Schema: [schemas/mastery.schema.json](schemas/mastery.schema.json).

---

## 6. `consents.json`

```json
{
  "ptf_version": "0.1",
  "platforms": {
    "https://tutor.example.org": {
      "granted": "2026-10-26T12:00:00Z",
      "areas": { "profile": true, "mastery": true, "events": false, "leaderboard": true },
      "expires": null
    }
  }
}
```

A host that syncs a learner record to a platform MUST send only the areas
granted, MUST stop when consent is revoked, and SHOULD let the learner
export and delete everything the platform stored.

---

## 7. Open questions for v0.2

- Sync between devices (e.g. a private Git repository, or encrypted sync).
- Signed exports so a platform can trust imported mastery.
- A standard for leaderboard entries that reveals only a nickname and points.
