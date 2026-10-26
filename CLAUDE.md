# CLAUDE.md

This repository holds the **Personal Tutor Format (PTF)** specification, its JSON Schemas,
the simulator/host runtimes and the validator. Content lives in the separate
[ptf-library](https://github.com/KaProblem/ptf-library) repository.

- Everything in this repository is written in **English**.
- PTF is an OKF profile: keep every bundle a valid OKF bundle (Markdown + YAML frontmatter, `type` required).
- When you change the spec, update the matching schema, `tools/ptf-check.mjs`, the minimal example and `CHANGELOG.md` together.
- Simulator security rules (SIMULATOR-SPEC.md §5) are not negotiable: no network, no storage, no eval,
  `sandbox="allow-scripts"` only, CSP as HTTP header.
- Learner-facing content must be self-contained: never assume the learner saw the source material.
- Run before committing: `npm test` and `node tools/ptf-check.mjs examples/minimal-library`.
  `node tools/ptf-selftest.mjs examples/minimal-library/sims/counter/1.0.0` needs Playwright.
