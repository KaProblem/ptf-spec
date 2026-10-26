# Changelog

All notable changes to the PTF specification and tools. Versions follow semver;
before 1.0, minor versions may break compatibility.

## [Unreleased]

### Added
- SIMULATOR-SPEC.md §7 rule 5 "Predict, observe, explain": a station that runs an experiment keeps its controls locked until the learner picks a prediction, gives no hint while picking, judges the prediction only after the result and reports it as `answered`.
- SIMULATOR-SPEC.md §4.7: simulators start focused on their first station, also standalone, and show progress with direct go-to per station.
- SIMULATOR-SPEC.md §4.5: canvas and WebGL simulators resolve theme tokens through the browser, because host values such as `light-dark()` turn canvas drawings black.

### Fixed
- MCP player: host colour tokens are resolved to plain `rgb()` before they reach a simulator.
- CONTENT-POLICY.md §1.2 "Contributor responsibility and license": contributors are responsible for their content and its legal compliance, license each contribution under the library's licenses by submitting it, and are the human behind any agent; maintainers remove infringing content on notice. `ptf-author` adds the contributor statement to every PR.
- CONTENT-POLICY.md §1.1 "Sources and original work": any material may be a source; content is written fresh (no copied or closely paraphrased text, no translated text, no reproduced exercises or figures); CC0/BY/BY-SA material may be adapted with attribution, NC/ND material only in private libraries; agents must not rewrite sources and must respect terms that forbid AI processing.
- CODE-SPEC.md: code labs, versioned packages of runnable code in steps (`code/<name>/<version>/` with `lab.json`, README and one complete file per step) that learners copy into their own workspace, run and extend. Elements refer to them with `code: [{ ref, step }]`; `ptf.lock` pins them under `code`. Safety rules for hosts (never run automatically, copy before editing, show dependencies first) and for labs (no network, processes, string eval or unsafe deserialization).
- `schemas/code-manifest.schema.json`; `learning-element` and `lockfile` schemas accept `code`.
- `ptf-check` validates code labs (manifest, step files, data files, integrity, forbidden APIs) and code refs; `hash` and `lock` handle labs. New `tools/ptf-codetest.mjs` runs every step in smoke mode in a temporary copy.
- Example library: `code/counting/1.0.0`, referenced from `counting.md`.
- MCP server: `get_code_lab` and `copy_code_lab` (verified copy into `~/.ptf/workspace/`, never overwrites, never runs code; `PTF_WORKSPACE`); `list_library` and `search_library` include code labs; tutor skill offers a lab step after an element, author skill covers labs.
- `mcp/`: `show_question` tool and quiz card (MCP App) for `multiple_choice` and `free_text` question blocks, from a learning element or written by the model and validated against the question-block schema; the card checks multiple-choice answers, records them and sends them to the chat; free-text answers go to the chat for grading.
- Minimal example: `multiple_choice` question in `demo/counting`.
- SIMULATOR-SPEC.md §8 (proposal) libraries and vendoring: when to use no library, an own integrator, `planck` or `three-core`; the allowlist (`vendor/allowlist.json`) with reproducible build recipes; rules for vendoring byte-identical classic-script builds into `vendor/`; WebGL fallbacks; physics correctness rules (SI units, fixed time step, closed-form checks in `test.json`, honest exaggeration). §7 build rules 1, 11 and new 12 refer to it.
- `tools/ptf-vendor.mjs`: `list`, `add <sim-dir> <build>@<version>` (copies the build and declares it in `sim.json`), `build <build>@<version> [--write]` (reproduces a build from its recipe).
- `vendor/`: allowlisted builds `three-core@0.170.0` (tree-shaken three.js, global `THREE`) and `planck@1.4.2` (global `planck`) with recipes and licenses.
- `sim.json` field `vendor` (schema). `ptf-check` verifies vendored builds against the manifest and the allowlist, rejects undeclared scripts in `vendor/`, skips the forbidden-pattern scan for verified builds, leaves them out of the 300 KB recommendation, and warns about `<script type="module">`.
- `mcp/`: local MCP server (stdio, `dist/ptf-mcp.mjs` single file) that clones and serves a PTF library, shows simulators inline as MCP Apps (player page embeds the unmodified package via `ptf-host.js` in a `sandbox="allow-scripts"` srcdoc iframe, after an integrity check), and keeps the learner record in `~/.ptf/learner/` (events, mastery with spaced-review dates, profile, simulator resume state).
- `ptf-tutor` skill and MCP prompt (teaching method, learning-goal check) and `ptf-author` skill (change or add content, run checks, open a pull request); Claude Code plugin and marketplace entry.
- CONTENT-POLICY.md: what shared libraries accept, automated review gates and quality rubric for contributions without manual review.
- PTF v0.1 draft: SPEC.md (bundles, learning elements, four default levels plus custom levels, question blocks, learning paths, IDs, versioning, conformance).
- SIMULATOR-SPEC.md: `sim.json` manifest, integrity hash, semver rules, JSON-RPC-over-postMessage host contract, security requirements, self-test format, build rules.
- LEARNER-RECORD.md: local-first learner profile, events, mastery and consents.
- JSON Schemas for bundle index, learning element, learning path, question block, simulator manifest, lockfile, learner profile, learner event, mastery.
- `runtime/ptf-sim.js` (simulator side) and `runtime/ptf-host.js` (host side).
- `tools/ptf-check.mjs` validator with `hash` and `lock` commands; `tools/ptf-selftest.mjs` sandboxed browser self-test and dev host.
- Minimal example library and tests.
- SPEC.md §6.5 `# Further reading`: optional deep-dive links (e.g. the source video with timestamps) offered after the lesson; `ptf-check` no longer warns about source references in that section.
- SIMULATOR-SPEC.md §4.7 focus mode: one idea per station, `focus` in the init context and in `ptf/goto`, Back/Next with `experienced` events; `ptf-sim.js` passes `{ focus }` to `onGoto`, `ptf-host.js` `goto(station, { focus })`, `ptf-selftest` accepts `goto: {station, focus}`; MCP `show_simulator` takes `focus` (default on when a station is given) and the tutor skill walks station by station and offers `# Further reading` after a step.
- SIMULATOR-SPEC.md §4.6 UI languages: how a simulator picks its UI language from `locale`, fallback to the first `lang` entry, English snapshots and events, and a markup pattern for bilingual simulators.
