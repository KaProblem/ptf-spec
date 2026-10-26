# Changelog

All notable changes to the PTF specification and tools. Versions follow semver;
before 1.0, minor versions may break compatibility.

## [Unreleased]

### Added
- CODE-SPEC.md: code labs, versioned packages of runnable code in steps (`code/<name>/<version>/` with `lab.json`, README and one complete file per step) that learners copy into their own workspace, run and extend. Elements refer to them with `code: [{ ref, step }]`; `ptf.lock` pins them under `code`. Safety rules for hosts (never run automatically, copy before editing, show dependencies first) and for labs (no network, processes, string eval or unsafe deserialization).
- `schemas/code-manifest.schema.json`; `learning-element` and `lockfile` schemas accept `code`.
- `ptf-check` validates code labs (manifest, step files, data files, integrity, forbidden APIs) and code refs; `hash` and `lock` handle labs. New `tools/ptf-codetest.mjs` runs every step in smoke mode in a temporary copy.
- Example library: `code/counting/1.0.0`, referenced from `counting.md`.
- MCP server: `get_code_lab` and `copy_code_lab` (verified copy into `~/.ptf/workspace/`, never overwrites, never runs code; `PTF_WORKSPACE`); `list_library` and `search_library` include code labs; tutor skill offers a lab step after an element, author skill covers labs.
- `mcp/`: `show_question` tool and quiz card (MCP App) for `multiple_choice` and `free_text` question blocks, from a learning element or written by the model and validated against the question-block schema; the card checks multiple-choice answers, records them and sends them to the chat; free-text answers go to the chat for grading.
- Minimal example: `multiple_choice` question in `demo/counting`.
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
