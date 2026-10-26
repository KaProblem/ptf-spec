# PTF Code Lab Specification

**Version 0.1 (draft)** · part of the [Personal Tutor Format](SPEC.md)

A PTF code lab is a small, versioned package of source code that a learner
runs, changes and extends on their own machine. Where a simulator lets the
learner *play* with an idea in a sandbox, a code lab lets them *build* it.

A lab is a sequence of **steps**. Every step is complete and runnable on its
own, so a learner can start at any step instead of from zero, compare two
steps to see exactly what changed, and branch off from any point.

---

## 1. Package layout

```
code/<name>/<version>/
  lab.json          # REQUIRED manifest (§2)
  README.md         # REQUIRED: setup, how to run, what to try
  steps/…           # REQUIRED: one runnable file (or folder) per step
  data/…            # optional: datasets the steps read
  requirements.txt  # optional: dependency list for the lab's language
```

- Libraries keep labs in `code/` next to `sims/`; a stand-alone bundle MAY
  carry them in `<bundle>/code/`. Resolution order is the same as for
  simulators (SPEC.md §3).
- A published version directory is **immutable** (SPEC.md §9). The learner
  never edits it; they edit a copy (§5).
- Everything a step needs MUST be inside the package, apart from the
  dependencies declared in `requires` (§2). Datasets that the license allows
  to be shipped SHOULD be shipped, so the lab works offline.
- Total size SHOULD stay below 5 MB and MUST stay below 20 MB.
- Learner-facing text (README, comments, printed output) follows the
  self-contained rule of SPEC.md §6.2: it never assumes the learner saw the
  source material.

---

## 2. Manifest `lab.json`

```json
{
  "ptf_code": "0.1",
  "id": "ptf:code/gpt-from-scratch",
  "version": "1.0.0",
  "title": "GPT from scratch",
  "description": "From a bigram model to a small GPT, one runnable file per step.",
  "lang": "en",
  "language": "python",
  "requires": { "runtime": "python>=3.10", "packages": ["torch>=2.1"] },
  "setup": "python -m pip install -r requirements.txt",
  "concepts": ["tokenizer", "bigram", "self-attention", "transformer"],
  "levels": ["college", "expert"],
  "steps": [
    {
      "id": "bigram",
      "title": "A bigram model that learns",
      "file": "steps/03_bigram.py",
      "run": "python steps/03_bigram.py",
      "concepts": ["bigram", "training-loop"],
      "minutes": 5,
      "expect": "step\\s+\\d+: train loss",
      "try": [
        "Change the learning rate to 1e-1 and to 1e-4. What happens to the loss?",
        "Train on your own text with --data path/to/file.txt."
      ]
    }
  ],
  "data": [
    { "path": "data/input.txt", "title": "Tiny Shakespeare", "license": "public domain" }
  ],
  "smoke": { "env": { "PTF_SMOKE": "1" }, "timeout_s": 120 },
  "license": "MIT",
  "authors": ["claude/opus"],
  "integrity": "sha256-…"
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `ptf_code` | yes | Version of this spec. |
| `id` | yes | `ptf:code/<name>` or `ptf:code/@<scope>/<name>`. |
| `version` | yes | Semver; MUST equal the directory name. |
| `title`, `description` | yes | Human-readable. |
| `lang` | yes | Language of comments, README and output (BCP 47). |
| `language` | yes | Programming language, e.g. `python`, `javascript`. |
| `requires` | yes | `runtime` (e.g. `python>=3.10`, `node>=20`) and `packages` (third-party dependencies, may be empty). |
| `setup` | no | One command that installs the dependencies, run from the lab directory. |
| `concepts`, `levels` | yes | As for simulators. |
| `steps` | yes | Ordered list, at least one (§3). |
| `data` | no | Shipped datasets with path, title and license. |
| `smoke` | no | How to run the smoke test (§6). |
| `license`, `authors` | yes | SPDX license and authors (OKF actor convention). |
| `derived_from` | no | `ptf:code/<name>@<version>` it was forked from. |
| `changelog`, `deprecated` | no | As for simulators. |
| `integrity` | yes | Hash over all package files except `lab.json`, computed exactly like a simulator's (SIMULATOR-SPEC.md §2.1). |

Schema: [schemas/code-manifest.schema.json](schemas/code-manifest.schema.json).

---

## 3. Steps

Each step object has:

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | `^[a-z0-9][a-z0-9-]*$`, unique in the lab; content refers to it. |
| `title` | yes | What the step builds. |
| `file` | yes | Path of the step's main file inside the package. |
| `run` | yes | Command that runs the step from the lab directory. |
| `concepts` | no | Concept tags this step teaches. |
| `minutes` | no | Rough wall time of a normal (non-smoke) run on a laptop CPU. |
| `expect` | no | Regular expression that the step's standard output matches when it worked. |
| `try` | no | Suggestions for changes the learner can make next. |

Rules:

- A step MUST run on its own: no step imports another step's file. Shared
  helpers are allowed only as files inside `steps/` that every step may
  import; prefer copying the few lines instead, so each step reads top to
  bottom. A step MAY read what an earlier step wrote to `out/` (a trained
  model, for example); if that is missing, it says which step to run first.
  The smoke test runs steps in manifest order in one directory, so this
  works there too.
- Consecutive steps SHOULD differ only in what the step teaches, so that a
  diff of two steps is itself the lesson.
- A step SHOULD print what it did in plain words (shapes, losses, samples)
  and finish on a laptop CPU in a few minutes. Long runs SHOULD be opt-in via
  a flag (for example `--preset gpu`).
- A step MAY write outputs (checkpoints, samples) only below `out/` in the
  directory it is run from, and MAY read files only inside that directory
  or a path the learner passes explicitly.
- Every step SHOULD accept the learner's own data where that makes sense
  (`--data <file>`): building on one's own material is the point of a lab.

---

## 4. Referring to labs from content

Learning elements list labs in their frontmatter, next to `simulators`:

```yaml
code:
  - ref: ptf:code/gpt-from-scratch@^1.0.0   # REQUIRED: ID + semver range
    step: bigram                            # optional: the step that fits
    levels: [college, expert]
    note: Run it, then change the learning rate.
```

- `ref` resolves like a simulator ref; `step` MUST exist in the resolved
  version.
- `ptf.lock` pins labs under `code`, with `version` and `integrity`, exactly
  like `simulators` (SPEC.md §9).
- The element MUST stay complete without the lab: code is an offer for
  learners who want to build, never a prerequisite. Tutors SHOULD offer it
  at `college` level and above, or when the learner asks for code.

Versioning follows SIMULATOR-SPEC.md §3 with steps in place of stations:
removing or renaming a step or a flag is a major change, adding a step or
an option is minor, fixes and wording are patches.

---

## 5. Hosts and tutors

Lab code runs outside any sandbox, with the learner's own rights. That is
the point and the risk.

Hosts and tutors MUST:

1. Never run lab code automatically. They show the command and let the
   learner run it, or ask the learner each time before running it for them.
2. Copy the lab into a learner-owned workspace (for example
   `~/.ptf/workspace/<name>/`) before the learner edits anything, and never
   overwrite changes there without asking. The library copy stays untouched.
3. Verify `integrity` (and the locked version, if any) before copying.
4. Show `requires` and `setup` before installing anything, and install only
   after the learner agrees.

Labs MUST NOT:

- open network connections (no downloads at run time; ship the data);
- start other processes or shells;
- evaluate code built from strings (`eval`, `exec`, `new Function`);
- read or write outside the run directory, apart from files the learner
  names on the command line;
- load serialized code (for example Python `pickle` without a safe mode).

`ptf-check` scans lab source for the most common violations. Review of
third-party labs follows SIMULATOR-SPEC.md §5.4, with extra care, because
nothing sandboxes them.

---

## 6. Smoke test

A lab SHOULD have a smoke mode that runs every step in seconds, so that CI
can prove the steps still work with current dependencies:

- `smoke.env` lists environment variables to set (conventionally
  `PTF_SMOKE=1`); in smoke mode each step shrinks its work (a few training
  iterations, a tiny model) but runs the same code paths.
- `smoke.timeout_s` is the limit per step (default 120).
- `tools/ptf-codetest.mjs <lab-dir>` copies the lab to a temporary directory,
  runs every step's `run` command there with `smoke.env`, and fails if a step
  exits with a non-zero code, exceeds the timeout or does not match `expect`.
  It does not install dependencies; CI does that from `setup`.

---

## 7. Build rules for authors and generators

- Write for reading: one idea per step, plain names, comments that explain
  *why*, printed output that tells the learner what they are seeing.
- Pin nothing you do not need: declare minimum versions in `requires`, and
  keep the dependency list as short as the topic allows.
- Prefer CPU-friendly defaults. A learner on a laptop must see a result.
- Seed random number generators, so the printed numbers in a lesson match
  what the learner sees.
- Keep the README short: setup, the list of steps with their commands, and
  a "build on it" section with bigger ideas than the per-step `try` lists.
