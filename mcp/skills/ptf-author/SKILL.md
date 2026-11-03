---
name: ptf-author
description: Add or improve learning content in a PTF library (learning elements, questions, paths, simulators) and propose it as a pull request. Use when the user wants to publish a lesson, fix or improve an existing one, or contribute what they learned back to the library.
---

# PTF author

You turn material into PTF content and propose it to a library as a pull
request. Automated gates review it (CONTENT-POLICY.md §2), so write content
that passes them the first time. Read in ptf-spec: SPEC.md, PEDAGOGY.md §7,
CONTENT-POLICY.md, and SIMULATOR-SPEC.md §7 or CODE-SPEC.md when you touch
packages.

## 1. Policy and sources

Check the request against CONTENT-POLICY.md §1 first. If it violates the
policy, say why and offer a legitimate angle; if it is sensitive but allowed,
tag it `sensitive` and leave out `child`. Read sources to understand, then
write your own text, questions and figures: never rewrite, translate or
reword a source's passages or exercises. Only CC0, public domain, CC BY or
CC BY-SA material may be adapted, with attribution in `sources`. If a
source's terms forbid AI processing, work from the user's notes.

## 2. Workspace

Clone the library and ptf-spec side by side
(`git clone https://github.com/KaProblem/ptf-library && git clone https://github.com/KaProblem/ptf-spec && (cd ptf-spec && npm install)`),
fork first without write access, and branch `content/<bundle>-<topic>`.

## 3. Write

What matters is that a tutor can teach from it (SPEC.md §6.7):

- **Objectives**: two to four things the learner can do afterwards, each
  `{ id, text }` with a stable ID.
- **Core and Key facts**: short and correct; verify every number.
- **Misconceptions**: real wrong beliefs, `**<id>**: wrong → right`.
- **Questions**: a few good ones; every `check` and `probe` question names
  the `objectives` it checks, and every objective has one at every level
  (`ptf-check` lists the gaps); wrong
  options are misconceptions with feedback; one `probe` question that sorts
  "knows it" from "sounds familiar".
- **Levels are depths** (SPEC.md §5.2): every level covers every objective.
  Level texts are optional; each stands alone and starts with something to
  try.
- **Frontmatter**: `about` from `tools/ptf-wikidata.mjs` (never guessed),
  `use_when` on each simulator entry, `generated`, `sources`, `status:
  draft`.
- **Paths**: `objectives`, an `# Introduction` for the course, steps in
  `requires` order, `# Prior knowledge` when learners often bring part of
  it. Add new elements to the bundle's `index.md`.
- **Anything the tutor must do a certain way** goes in `# Tutor notes`.
- **Changes** keep all IDs, say what problem they fix, bump `version`
  (patch wording, minor additions, major when Core changes meaning or IDs
  change) and the level text marker (`<!-- ptf:text v2 -->`). Never set
  `reviewed` or `proven` yourself; never copy learner data.
- **Simulators and code labs**: never edit a published version; copy to a
  new version with `derived_from` and `changelog`, then
  `node ../ptf-spec/tools/ptf-check.mjs hash --write <dir>` and
  `node ../ptf-spec/tools/ptf-check.mjs lock bundles/<bundle> .`. Prefer
  questions or new `params` over new code (SIMULATOR-SPEC.md §7.1). Vendor
  libraries only from the allowlist (`ptf-vendor add`, §8).

Learner-facing text never mentions sources. Write in English.

## 4. Check

```bash
node ../ptf-spec/tools/ptf-check.mjs .                          # 0 errors
node ../ptf-spec/tools/ptf-selftest.mjs sims/<name>/<version>/  # changed simulators
node ../ptf-spec/tools/ptf-codetest.mjs code/<name>/<version>/  # changed code labs
node ../ptf-spec/tools/ptf-check.mjs catalog --write .          # refresh digests
```

Review your diff against CONTENT-POLICY.md §3 with fresh eyes, reading each
level text as a learner who never saw the sources. Update `log.md` and
`CHANGELOG.md`.

## 5. Propose

Commit, push and open a pull request with: **What** (with old and new
versions), **Why**, **Rubric** (one line per CONTENT-POLICY.md §3
criterion), **Sources**, and the **contributor statement** from
CONTENT-POLICY.md §1.2 verbatim. The user is the contributor: show them the
statement and get their confirmation before opening the PR. Then fix what CI
and the automated review report.
