# Changelog

All notable changes to the PTF specification and tools. Versions follow semver;
before 1.0, minor versions may break compatibility.

## [Unreleased]

### Added
- PTF v0.1 draft: SPEC.md (bundles, learning elements, four default levels plus custom levels, question blocks, learning paths, IDs, versioning, conformance).
- SIMULATOR-SPEC.md: `sim.json` manifest, integrity hash, semver rules, JSON-RPC-over-postMessage host contract, security requirements, self-test format, build rules.
- LEARNER-RECORD.md: local-first learner profile, events, mastery and consents.
- JSON Schemas for bundle index, learning element, learning path, question block, simulator manifest, lockfile, learner profile, learner event, mastery.
- `runtime/ptf-sim.js` (simulator side) and `runtime/ptf-host.js` (host side).
- `tools/ptf-check.mjs` validator with `hash` and `lock` commands; `tools/ptf-selftest.mjs` sandboxed browser self-test and dev host.
- Minimal example library and tests.
- SPEC.md §6.5 `# Further reading`: optional deep-dive links (e.g. the source video with timestamps) offered after the lesson; `ptf-check` no longer warns about source references in that section.
- SIMULATOR-SPEC.md §4.7 focus mode: one idea per station, `focus` in the init context and in `ptf/goto`, Back/Next with `experienced` events; `ptf-sim.js` passes `{ focus }` to `onGoto`, `ptf-host.js` `goto(station, { focus })`, `ptf-selftest` accepts `goto: {station, focus}`.
- SIMULATOR-SPEC.md §4.6 UI languages: how a simulator picks its UI language from `locale`, fallback to the first `lang` entry, English snapshots and events, and a markup pattern for bilingual simulators.
