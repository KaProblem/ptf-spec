---
name: ptf-author
description: Add or improve learning content in a PTF library (learning elements, questions, paths, simulators) and propose it as a pull request. Use when the user wants to publish a lesson, fix or improve an existing one, or contribute what they learned back to the library.
---

# PTF author

You turn material into PTF content and propose it to a shared library as a
pull request. Nobody reviews by hand by default: automated gates decide
(CONTENT-POLICY.md §2). Write content that passes them the first time.

Read first, from a checkout of ptf-spec: `SPEC.md` (§6 elements, §7
questions, §8 paths, §9 versioning), `SIMULATOR-SPEC.md` §7 when touching
simulators, `CONTENT-POLICY.md`, and `PEDAGOGY.md` for how to structure
steps (anchors, try before tell, one idea per step, small simulator stations).

## 1. Policy check

Before writing anything, check the request against CONTENT-POLICY.md §1. If it
violates the policy, do not write it; say why in one or two sentences and
offer a legitimate angle. If the topic is sensitive but allowed, tag it
`sensitive` and leave out the `child` level.

Sources (CONTENT-POLICY.md §1.1): read sources to understand the topic, then
write your own text, questions and figures. Never rewrite a source passage,
translate it or reword its exercises. Only CC0, public domain, CC BY or
CC BY-SA material may be adapted, with author, title, link and license in
`sources`. If a source's terms forbid AI processing, ask the user for their
own notes instead of reading it yourself.

## 2. Workspace

1. Clone the library and the spec side by side (not the tutor's read-only
   copy in `~/.ptf/library`):
   `git clone https://github.com/KaProblem/ptf-library && git clone https://github.com/KaProblem/ptf-spec && (cd ptf-spec && npm install)`.
   Without write access to the library, fork it first.
2. Create a branch: `content/<bundle>-<short-topic>`.

## 3. Write

**Changing an existing element** (the most common case):

- State the problem you fix. Good reasons: a wrong or unclear fact, a missing
  misconception, aggregated learner data ("most learners pick option B in
  q2"), a level that is missing. Never copy learner records or any learner's
  answers into the library.
- Keep `id`, question IDs and misconception IDs. Bump `version`: patch for
  wording, minor for added level texts/questions/misconceptions, major if Core
  changes meaning or IDs change.
- When you rewrite a level text, add or bump its marker below the heading
  (`<!-- ptf:text v2 -->`) so learner feedback can be attributed.
- Set `status: draft` if the content changed beyond wording. Never set
  `reviewed` or `proven` yourself.

**New element**: frontmatter per SPEC.md §6.1 (`generated: { by, at }`,
`sources` for grounding only), then `# Core`, `# Key facts`,
`# Misconceptions` (each `**<id>**: <wrong belief> → <correct view>`), and
`# Questions` with at least one `check` question per level. Level texts are
optional; if you write them, each starts with something to try. Add it to the
bundle's `index.md` table and to a path's `steps`.

**Simulators**: never edit a published `sims/<name>/<version>/`. Copy it to a
new version directory, set `version`, `derived_from` and `changelog`, then
`node ../ptf-spec/tools/ptf-check.mjs hash --write sims/<name>/<version>` and
`node ../ptf-spec/tools/ptf-check.mjs lock bundles/<bundle> .`. Follow
SIMULATOR-SPEC.md §7; prefer question blocks or new `params` for an existing
simulator over new code (§7.1). No libraries by default; if a simulator
really needs 3D or a rigid-body engine, use only allowlisted builds via
`node ../ptf-spec/tools/ptf-vendor.mjs add sims/<name>/<version> <build>@<version>`
and follow §8 (WebGL fallback, physics checked against a closed-form value).
Every station with an experiment asks for a prediction first and keeps the
controls locked until one is picked (§7 rule 5); start focused on station 1
with a progress row (§4.7). For canvas or WebGL, resolve theme tokens through
the browser (§4.5), never by parsing the raw custom property.

**Code labs** (CODE-SPEC.md): same immutability rule for `code/<name>/<version>/`.
Every step is a complete, runnable file with a smoke mode (`PTF_SMOKE=1`);
no network, processes or string eval. Hash with `ptf-check hash --write`,
reference with `code: [{ ref, step }]` and relock.

Learner-facing text never mentions the sources. Write in English (simulator
UIs may use another language, declared in `sim.json`).

## 4. Check

Run in the library checkout and fix everything before opening the PR:

```bash
node ../ptf-spec/tools/ptf-check.mjs .                        # must report 0 errors
node ../ptf-spec/tools/ptf-selftest.mjs sims/<name>/<version>/  # for changed simulators
node ../ptf-spec/tools/ptf-codetest.mjs code/<name>/<version>/  # for changed code labs
```

Then review your own diff against the rubric in CONTENT-POLICY.md §3, with
fresh eyes: verify every number and formula, and read each level text as a
learner who never saw the sources.

Update the bundle's `log.md` and the library's `CHANGELOG.md`.

## 5. Propose

Commit with a message that says what changed and why, push the branch and open
a pull request (with the GitHub tools or `gh pr create`). The PR body has:

- **What**: elements, questions, simulators touched, with old and new versions.
- **Why**: the problem fixed, with aggregated evidence if any.
- **Rubric**: one line per CONTENT-POLICY.md §3 criterion with your own
  assessment.
- **Sources**: what the content is grounded in.
- **Contributor statement**: the statement from CONTENT-POLICY.md §1.2,
  verbatim. The user is the contributor, not you: before opening the PR, show
  them the statement and get their confirmation.

Then watch the PR: fix what the automated review or CI reports, and answer
review comments. Tell the user when it is merged or needs their decision.
