# Personal Tutor Format (PTF)

**Version 0.1 (draft)**

PTF is an open format for **learning content that an AI tutor teaches from**.
The content says what a learner should be able to do and gives the tutor the
facts, misconceptions, questions and simulators to get there. The tutor turns
it into a conversation for one learner. The content is open, the explanation
is personal: that is the "Personal" in the name.

PTF is a **profile of the [Open Knowledge Format (OKF) v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)**:
every PTF bundle is a valid OKF bundle, a directory of Markdown files with
YAML frontmatter. PTF fixes a few `type` values, fields and headings, and adds
question blocks, simulators and code labs.

| Document | Defines |
| --- | --- |
| SPEC.md (this file) | Bundles, learning elements, levels, questions, paths, IDs, versioning |
| [PEDAGOGY.md](PEDAGOGY.md) | How a tutor teaches: the learning atmosphere PTF is built for |
| [SIMULATOR-SPEC.md](SIMULATOR-SPEC.md) | Simulator packages, the host contract, security |
| [CODE-SPEC.md](CODE-SPEC.md) | Code labs: runnable code the learner builds on locally |
| [LEARNER-RECORD.md](LEARNER-RECORD.md) | What a host does with a learner's profile and progress |
| [CATALOG.md](CATALOG.md) | How a library publishes its packages to hosts |
| [CONTENT-POLICY.md](CONTENT-POLICY.md) | What shared libraries accept and how contributions are reviewed |
| [schemas/](schemas/) | JSON Schemas for everything machine-checkable |

MUST, SHOULD and MAY are used as in RFC 2119.

---

## 1. Design goals

1. **Goals and material, not a script.** Content fixes *what* is learned;
   the tutor decides *how* for each learner (§6.7). Ready-made texts,
   questions and simulators are offers.
2. **Plain files.** Readable without tools, diffable in Git, portable.
3. **Agent-written, human-reviewed.** Provenance and review status are part
   of every file (from OKF).
4. **Self-contained.** Learner-facing content never assumes the learner has
   seen its sources (a video, a paper). Sources are grounding only.
5. **Reproducible interactivity.** Simulators and code labs are immutable,
   versioned packages referred to by ID and version range.
6. **The learner owns their data.** Progress stays with the learner's host
   unless a course says otherwise and the learner agrees (LEARNER-RECORD.md).

PTF is not a runtime or an LMS, and it does not replace assessment standards
such as IMS QTI; its question blocks are small and convertible.

---

## 2. Terminology

| Term | Meaning |
| --- | --- |
| Library | A collection of bundles, simulators and code labs, usually one Git repository. |
| Bundle | A topic area (e.g. "How LLMs work"). An OKF bundle. |
| Learning element | One concept, one Markdown file. |
| Learning path (course) | An ordered sequence of elements towards a goal. |
| Question block | One quiz item of a known kind, as JSON. |
| Simulator | A versioned, sandboxed HTML package to explore a concept. |
| Code lab | A versioned package of runnable code in steps (CODE-SPEC.md). |
| Level | How deep a concept is taught (§5). |
| Host | Software that presents PTF content: an MCP server, a web app. |
| Tutor | The model (or person) teaching from PTF content. |
| Learner record | A learner's profile and progress (LEARNER-RECORD.md). |

---

## 3. Library and bundle layout

```
library/
  ptf-catalog.json        # optional: catalog for hosts (CATALOG.md)
  sims/<name>/<version>/  # simulators, immutable once published
  code/<name>/<version>/  # code labs, immutable once published
  bundles/<bundle>/
    index.md              # REQUIRED: bundle metadata
    log.md                # optional: OKF update history
    ptf.lock              # optional: pinned simulator and lab versions (§9)
    elements/<name>.md    # type: Learning Element
    paths/<name>.md       # type: Learning Path
    sims/, code/          # optional: bundle-local packages
```

A simulator or lab is resolved first in the bundle, then in the library,
then in a configured registry. `index.md` and `log.md` are reserved names
(OKF §3.1).

### 3.1 Bundle `index.md`

```yaml
---
type: Bundle
okf_version: "0.2"
ptf_version: "0.1"
id: llm-basics
title: How large language models work
description: From next-character prediction to self-attention, step by step.
lang: en
license: CC-BY-SA-4.0
version: 0.1.0
levels:                 # optional custom levels (§5.3)
  - { id: practitioner, rank: 2.5, description: Developers without a math background. }
---
```

The body lists the bundle's paths and elements (OKF §8).

---

## 4. Identifiers

| Thing | Global ID |
| --- | --- |
| Learning element | `ptf:el/<bundle>/<name>` |
| Learning path | `ptf:path/<bundle>/<name>` |
| Question block | `ptf:el/<bundle>/<name>#<question-id>` |
| Level text | `ptf:el/<bundle>/<name>#level/<level>`, optionally `@v<n>` (§6.3) |
| Simulator, version, station | `ptf:sim/<name>`, `ptf:sim/<name>@<semver>`, `…#<station>` |
| Code lab, version, step | `ptf:code/<name>`, `ptf:code/<name>@<semver>`, `…#<step>` |

Names match `^[a-z0-9][a-z0-9-]*$`. Personal forks MAY use a scope:
`ptf:sim/@<scope>/<name>`.

---

## 5. Levels

### 5.1 Default levels

| Rank | ID | Audience | Style |
| --- | --- | --- | --- |
| 1 | `child` | About 7 to 10 years | Pictures, everyday analogies, no formulas |
| 2 | `highschool` | Secondary school | Intuition, simple numbers, school math |
| 3 | `college` | Undergraduates, practitioners | Formulas, code, derivations |
| 4 | `expert` | Graduate students, professionals | Limits, variants, current research |

An element lists in `levels` the levels its texts and questions were written
and checked for; at least one, SHOULD be two adjacent ones. A tutor MAY teach
an element at another level from its Core, Key facts and Misconceptions.

### 5.2 Levels are depths, not parts

A level says **how deep** a concept is taught, never **which part** of it.
A learner who completes an element at one level has the whole concept at
that depth and never needs another level to finish it.

- Every level covers the Core, every objective and the central
  misconceptions. Higher levels add terms, formulas, limits and harder
  tasks; they MUST NOT carry a piece of the concept the lower levels lack.
- Each level text and each simulator station stands on its own at its level
  (§6.3, SIMULATOR-SPEC.md §2).
- Concepts that build on each other are separate elements joined by
  `requires`, not levels of one element.

"Go deeper" means the same concept one level up. It is an offer, not the
next part of the lesson.

### 5.3 Custom levels

A bundle MAY define more levels in `index.md` with an `id` and a numeric
`rank`. Consumers order unknown levels by rank and MUST NOT reject them.

---

## 6. Learning element

One concept per file, `type: Learning Element`.

### 6.1 Frontmatter

```yaml
---
type: Learning Element
ptf_version: "0.1"
id: ptf:el/llm-basics/softmax           # REQUIRED
title: Softmax                           # REQUIRED
description: Turns arbitrary numbers into a probability distribution.   # REQUIRED
lang: en                                 # REQUIRED, BCP 47
levels: [highschool, college]            # REQUIRED (§5.1)
objectives:                              # RECOMMENDED: what the learner can do afterwards
  - id: probabilities
    text: Turn a list of scores into probabilities and explain why they sum to 1.
  - id: larger-score
    text: Predict how a larger score changes the distribution.
about:                                   # RECOMMENDED: Wikidata items (§6.6)
  - { wikidata: Q7554146, label: softmax function }
requires:                                # prerequisites
  - ptf:el/llm-basics/logits
  - { id: ptf:el/math/probability, catalog: https://example.org/ptf-catalog.json }
leads_to: [ptf:el/llm-basics/cross-entropy]
tags: [llm, probability]
duration_min: { highschool: 10, college: 20 }
simulators:
  - ref: ptf:sim/next-char-lab@^2.0.0    # REQUIRED in each entry: ID + semver range
    station: counted-probabilities       # optional entry point
    levels: [highschool, college]
    use_when: the learner wants to see probabilities change, not read about them
code:                                    # CODE-SPEC.md §4
  - { ref: ptf:code/gpt-from-scratch@^1.0.0, step: bigram, levels: [college] }
sources:                                 # provenance only, never cited to the learner
  - { id: karpathy-gpt, resource: https://www.youtube.com/watch?v=kCc8FmEb1nY, title: "Let's build GPT" }
generated: { by: claude/opus, at: 2026-10-26T12:00:00Z }
verified: { by: "human:stefan", at: 2026-10-26T13:00:00Z }
status: draft                            # draft | reviewed | proven | deprecated
version: 1.0.0
license: CC-BY-SA-4.0
---
```

- `objectives`: two to four things the learner can *do* afterwards, written
  so a question can check them ("explain why…", "predict…", "compute…"),
  each with a stable `id`. They are the target of the step: questions name
  the objectives they check (§7), and a completion names the objectives the
  learner has shown (LEARNER-RECORD.md §5). Keep IDs stable; removing or
  renaming one is a major version. Plain strings without an ID are still
  accepted; `ptf-check` warns about them and about missing objectives.
- `requires`: what the learner should know first. An entry from another
  library carries the URL of that library's catalog, so a host can offer to
  connect it.
- `use_when`: one line on when a simulator helps, so the tutor can decide
  whether to open it at all. `role` (`explore`, `practice`, `check`) MAY add
  how it is meant to be used.
- `status`: `draft` (not reviewed), `reviewed` (a human checked it),
  `proven` (reserved: learner data shows it works, §10), `deprecated` (kept
  for reproducibility; `superseded_by` SHOULD name the replacement).

The schema is [schemas/learning-element.schema.json](schemas/learning-element.schema.json).
Unknown keys MUST be preserved and MUST NOT cause rejection (OKF).

### 6.2 Body headings

Level-1 headings, in this order. Only `# Core` and `# Misconceptions` are
required.

| Heading | Content |
| --- | --- |
| `# Introduction` | What the step is about, why it matters, what comes out of it. |
| `# Core` | One to five sentences that are true at every level. |
| `# Key facts` | Numbers, definitions, formulas the tutor must get right. |
| `# Level: <id>` | An optional ready-made explanation for that level (§6.3). |
| `# Misconceptions` | `**<id>**: <wrong belief> → <correct view>`, one per line (§6.4). |
| `# Questions` | Question blocks (§7). |
| `# Examples` | Anchors, analogies (each with where it breaks down), worked examples. |
| `# Tutor notes` | How the author wants the step taught (§6.7). |
| `# Further reading` | Optional material for after the step (§6.5). |
| `# Sources` | Footnotes keyed to `sources` (OKF §5.1). |

Learner-facing text above `# Further reading` MUST NOT refer to the sources
("as shown in the video").

### 6.3 Level texts

Level texts are optional; without them the tutor explains from Core, Key
facts and Misconceptions. A level text:

- MUST be complete on its own: it reaches every objective at its depth and
  never builds on another level's text (a tutor usually gets only one);
- SHOULD start with something to try or picture, not with a definition;
- MAY carry a version marker below the heading, `<!-- ptf:text v2 -->`, so
  learner outcomes can be attributed to the exact text (§10);
- MAY be translated as `# Level: highschool (de)`. The canonical language is
  `lang`; English is RECOMMENDED for shared libraries.

### 6.4 Misconceptions

Each misconception has a short ID (`softmax-makes-zeros`). Questions,
simulators and learner events refer to it, so wrong answers become data
about where learners stumble.

### 6.5 Further reading

`# Further reading` lists links a learner MAY explore after the step, such as
the video the element was grounded in: one list item per link, with a line
on what the learner gets from it and optionally a section and a level. The
element MUST be complete without it.

### 6.6 Subject anchors (`about`)

PTF has no taxonomy of its own. `about` names the concepts an element teaches
as **Wikidata items**, the first entry being the primary concept, so that
elements on the same concept can be found across bundles and languages.
Use the most specific item that fits, or none. IDs MUST be looked up, not
guessed (`tools/ptf-wikidata.mjs search`, `verify`). `ptf-check` warns when a
`reviewed` element has no `about` and when two elements of one bundle share a
primary concept. Order of learning still comes from `requires`.

### 6.7 What is binding

| Part | Who decides |
| --- | --- |
| `objectives`, `# Core`, `# Key facts`, the correct views in `# Misconceptions` | **Binding.** The tutor teaches towards the objectives and never contradicts these. |
| `# Tutor notes`, a path's `# Prior knowledge` | **Binding wishes of the author**, in plain words ("use this level text as written", "start with station `guess`"). |
| Level texts, `# Introduction`, `# Examples`, questions, simulators, code | **Offers.** The tutor uses, adapts or replaces them for this learner. |
| Everything else: order, words, pace, medium, which questions | **The tutor's judgment**, guided by PEDAGOGY.md and the learner's profile. |

When these meet, this order wins: the content policy and the learner's
safety; then the binding content; then the learner's explicit choices (they
may always stop, skip ahead or decline an activity); then tutor notes; then
the learner's profile; then PEDAGOGY.md. A host SHOULD pass `# Tutor notes`
to the tutor unchanged.

---

## 7. Question blocks

A question block is a JSON object in a fenced code block with the info string
`ptf-question` under `# Questions`, or an entry in `questions/<element>.json`.
Library questions are reviewed examples; a tutor MAY ask its own.

| Field | Required | Meaning |
| --- | --- | --- |
| `kind` | yes | One of the kinds below. |
| `id` | yes | Unique within the element. |
| `level` | yes | Level ID. |
| `purpose` | no | `warmup` (guess before learning), `check` (default: tests an objective), `transfer` (apply in a new situation), `probe` (sorts "knows it" from "sounds familiar" before a course; also counts as a `check`). |
| `objectives` | for `check`, `probe` | IDs of the element's objectives the question checks. |
| `misconception` | no | The misconception ID it targets. |
| `explanation` | yes | Why the answer is right, shown afterwards. |

| Kind | Learner does | Specific fields |
| --- | --- | --- |
| `multiple_choice` | Picks one or more options | `question`, `options[{text, correct, feedback}]` (3 to 5) |
| `guess_next` | Guesses the next character, word or number | `intro`, `prefix`, `answer`, `accepted[]`, `hint` |
| `cloze` | Fills 2 to 5 gaps `{{1}}` … | `text`, `gaps[{answer, accepted[]}]` |
| `estimate_number` | Estimates a value | `question`, `answer`, `tolerance`, `unit` |
| `ordering` | Puts 3 to 7 items in order | `instruction`, `items[]` (correct order) |
| `calculation_steps` | Completes a worked table | `title`, `intro`, `columns[]`, `rows[][]`, `result{label, value}` |
| `free_text` | Answers in their own words | `question`, `rubric[]`, `sample_answer` |

Details: [schemas/question-block.schema.json](schemas/question-block.schema.json).
Every objective SHOULD have a `check` or `probe` question at every level
of the element; `ptf-check` lists the gaps. A tutor's own questions name
objectives the same way when it records the answer. Wrong options SHOULD be
real misconceptions with `feedback`.

```ptf-question
{
  "kind": "multiple_choice", "id": "q1", "level": "highschool", "purpose": "check",
  "objectives": ["probabilities"], "misconception": "softmax-makes-zeros",
  "question": "The scores are [2, 1, 0]. What is true after softmax?",
  "options": [
    { "text": "The values add up to 1", "correct": true, "feedback": "Yes, softmax normalises." },
    { "text": "The smallest value becomes 0", "correct": false, "feedback": "No: e^0 = 1, so it stays positive." },
    { "text": "The order of the values can change", "correct": false, "feedback": "No: softmax keeps the order." }
  ],
  "explanation": "Softmax computes e^x for each score and divides by the sum."
}
```

The kinds are a catalog, as in generative-UI systems: a model fills in a
known component instead of inventing UI, and each host renders the kinds
with its own components.

---

## 8. Learning path

`type: Learning Path`, one file per path. A learner taking a path is taking a
**course**.

```yaml
---
type: Learning Path
ptf_version: "0.1"
id: ptf:path/llm-basics/gpt-from-scratch
title: How GPT works, from scratch
description: Eight steps from "predict the next character" to a transformer.
lang: en
goal: Understand how a GPT-style model is trained and generates text.
objectives:
  - Explain how a model turns text into numbers and predicts the next token.
  - Describe what changes in the model during training and why.
audience: [highschool, college]
steps:
  - element: ptf:el/llm-basics/tokenizer
  - element: ptf:el/llm-basics/softmax
  - { element: ptf:el/math/probability, catalog: https://example.org/ptf-catalog.json, optional: true }
sharing: { with: publisher, areas: [progress], mode: optional }   # optional, §8.2
status: draft
version: 0.1.0
---
```

Optional body headings:

| Heading | Content |
| --- | --- |
| `# Introduction` | What the course is about, why it is worth it, what the learner can do at the end, how it is built, what it needs, how long it takes. |
| `# Steps` | The steps in prose, including planned ones without an element yet. |
| `# Prior knowledge` | What learners usually bring, which misconceptions to probe, which steps experienced learners can often skip (binding like tutor notes). |
| `# Tutor notes` | Pace, where learners need a break, anything binding (§6.7). |

### 8.1 Prior knowledge

Before the first step of a new course the tutor finds out what the learner
already knows and proposes where to start (PEDAGOGY.md §3). The rule that
matters for the format is the difference between two kinds of leaving a step
out:

- **Already shown**: the learner answered correctly for every objective.
  This is recorded as a completion (`completed` with `context.reason:
  placement`) and counts for the course.
- **Skipped**: the learner chose to leave it out, or only claims to know it.
  This is recorded as `skipped`, moves the course on, and does not count.

A placement score (`assessed`) helps plan levels and reviews but decides
nothing (LEARNER-RECORD.md §5).

### 8.2 Sharing

A path MAY say who sees its learners' progress, for a school, a university or
a teacher.

| Field | Values |
| --- | --- |
| `with` | The concrete recipient: `publisher` (the publisher of the catalog the path comes from; the host records it as that catalog's ID) or a URL. |
| `areas` | `progress` (steps done), `mastery` (values per element), `answers` (single answers and questions). |
| `mode` | `required` (the course needs consent) or `optional` (off until the learner turns it on). |

The learner sees exactly what is shared, with whom and whether it is
required, before the first step, and decides (LEARNER-RECORD.md §7). Without
`sharing`, nothing is shared.

### 8.3 What a path requires and reaches

Tools derive both from the steps; authors do not write them.
**requires** is every `requires` entry of the steps that is not itself a
step; **reaches** is every step element at the deepest level of `audience`
it offers. Hosts use them to show prerequisites, to place a learner and to
suggest a route of courses to a goal.

### 8.4 Completion

A course is completed when every step that is not `optional` has a
completion at some level; skipped steps do not count (LEARNER-RECORD.md §5).

---

## 9. Versioning

- Elements, paths, bundles, simulators and code labs carry a semver
  `version`. Simulator and lab versions are **immutable**: a published
  `sims/<name>/<version>/` never changes; a fix is a new version.
- Content refers to simulators and labs by **range** (`^2.0.0`).
- `ptf.lock` MAY pin exact versions with their integrity. Hosts SHOULD use
  the locked version, so a repeated lesson shows the same simulator; they
  MAY offer a newer minor or patch version and MUST ask before a new major.

```json
{
  "lockfileVersion": 1,
  "simulators": { "ptf:sim/next-char-lab": { "version": "2.0.0", "integrity": "sha256-…" } },
  "code": { "ptf:code/gpt-from-scratch": { "version": "1.0.0", "integrity": "sha256-…" } }
}
```

Bump rules for packages: SIMULATOR-SPEC.md §3.

---

## 10. Feedback into the library

Learner records stay private. What MAY flow back into a library is
**aggregated and anonymous**: how often each misconception occurred, how
learners did on `check` questions after each level text version, and error
reports per simulator version. A library MAY keep this under `stats` or in a
separate file. It is the basis for `proven` and for replacing weak texts.
Self-reports ("understood") are not evidence that a text works.

---

## 11. Conformance

A PTF v0.1 bundle is conformant if:

1. It is a conformant OKF v0.2 bundle.
2. `index.md` has `type: Bundle` and `ptf_version`.
3. Every learning element validates against its schema and has `# Core` and
   `# Misconceptions`.
4. Every `ptf-question` block validates against its schema.
5. Every `simulators[].ref` and `code[].ref` resolves to an existing version,
   every `code[].step` exists, and every package validates against
   SIMULATOR-SPEC.md §2 or CODE-SPEC.md §2 with matching `integrity`.

`tools/ptf-check` checks all of this. Consumers MUST tolerate unknown types,
keys and levels and missing optional sections.

---

## 12. Prior art

OKF (bundles, frontmatter, provenance, tolerance), SCORM and cmi5 (packaged
content that reports progress), xAPI (actor–verb–object events), H5P (content
type separate from content), IMS QTI (question kinds), OpenStax (small modules
composed into paths), PhET-iO (a host API for simulations), MCP Apps
(sandboxed HTML over postMessage), json-render and OpenUI (typed component
catalogs instead of free UI), npm (names, ranges, lockfiles, integrity).

Changes: [CHANGELOG.md](CHANGELOG.md).
