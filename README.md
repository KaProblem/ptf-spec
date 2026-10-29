# Personal Tutor Format (PTF)

An open format for learning content that an AI tutor can teach from:
concepts explained at four difficulty levels (child, high school, college,
expert), question blocks, learning paths and versioned, sandboxed interactive
simulators. The content is open and shareable; the explanation is always
tailored to the learner. That is the "Personal" in the name.

PTF is a profile of Google's [Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md):
every PTF bundle is a plain directory of Markdown files with YAML frontmatter.

**Status:** v0.1 draft. Expect breaking changes until 1.0.

## Documents

| File | What it specifies |
| --- | --- |
| [SPEC.md](SPEC.md) | Bundles, learning elements, levels, question blocks, learning paths, IDs, versioning, conformance |
| [SIMULATOR-SPEC.md](SIMULATOR-SPEC.md) | Simulator packages, `sim.json`, the postMessage host contract, security, build rules |
| [CODE-SPEC.md](CODE-SPEC.md) | Code labs: runnable code in steps (`lab.json`), how hosts hand it to learners, smoke tests |
| [CATALOG.md](CATALOG.md) | Catalogs: how a library publishes its packages (`ptf-catalog.json`), access keys, what hosts may store |
| [LEARNER-RECORD.md](LEARNER-RECORD.md) | The portable, private learner profile, progress and consent format |
| [PEDAGOGY.md](PEDAGOGY.md) | Recommended course design: anchors, small steps, try before tell, retrieval and spacing, simulator granularity |
| [CONTENT-POLICY.md](CONTENT-POLICY.md) | What shared libraries accept, the automated review gates and the quality rubric |
| [schemas/](schemas/) | JSON Schemas (2020-12) for everything machine-checkable |

## Tools

| Path | Purpose |
| --- | --- |
| [runtime/ptf-sim.js](runtime/ptf-sim.js) | Simulator-side runtime; copy it into every simulator package |
| [runtime/ptf-host.js](runtime/ptf-host.js) | Host-side runtime: embeds a simulator in a sandboxed iframe and speaks the contract |
| [tools/ptf-check.mjs](tools/ptf-check.mjs) | Validator for libraries, bundles, simulator packages and code labs |
| [tools/ptf-codetest.mjs](tools/ptf-codetest.mjs) | Runs every step of a code lab in smoke mode in a temporary copy |
| [tools/ptf-vendor.mjs](tools/ptf-vendor.mjs) | Lists the allowlisted libraries, vendors one into a simulator package, reproduces a build ([SIMULATOR-SPEC.md §8](SIMULATOR-SPEC.md)) |
| [tools/ptf-selftest.mjs](tools/ptf-selftest.mjs) | Runs a simulator's `test.json` in Chromium under the production sandbox and CSP; `--serve` opens a dev host |
| [tools/ptf-wikidata.mjs](tools/ptf-wikidata.mjs) | Finds Wikidata items for `about` (`search`) and checks every `about` ID in a library (`verify`); needs network |
| [mcp/](mcp/) | Local MCP server: serves a library, shows simulators as MCP Apps, keeps the learner record on the device; tutor and author skills; Claude Code plugin |
| [examples/minimal-library/](examples/minimal-library/) | The smallest valid library (one bundle, one simulator, one code lab) |

```bash
npm install
node tools/ptf-check.mjs path/to/library          # validate
node tools/ptf-check.mjs hash --write path/to/sims/<name>/<version>   # set integrity
node tools/ptf-check.mjs lock path/to/library/bundles/<bundle> path/to/library   # write ptf.lock
node tools/ptf-selftest.mjs path/to/sims/<name>/<version>              # needs Playwright
node tools/ptf-selftest.mjs --serve path/to/sims/<name>/<version>      # try it by hand
node tools/ptf-codetest.mjs path/to/code/<name>/<version>              # smoke-test a code lab
npm test
```

## Learn with it

To learn from the library with Claude Desktop or Claude Code, see
[mcp/README.md](mcp/README.md). Short version for Claude Code:

```
/plugin marketplace add KaProblem/ptf-spec
/plugin install ptf@ptf
```

## Related

- [ptf-library](https://github.com/KaProblem/ptf-library): the content library (bundles and simulators).

## License

Specification text (`*.md`): [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Code and schemas: MIT, see [LICENSE](LICENSE).
