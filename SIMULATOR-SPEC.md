# PTF Simulator Specification

**Version 0.1 (draft)** · part of the [Personal Tutor Format](SPEC.md)

A PTF simulator is a small, self-contained web package that lets a learner
explore one or more concepts hands-on. It runs inside a sandboxed iframe and
talks to its host only through a fixed message contract. A host (an MCP
client, a web app, a local viewer) needs to know nothing about its insides.

---

## 1. Package layout

```
sims/<name>/<version>/
  sim.json        # REQUIRED manifest (§2)
  index.html      # REQUIRED entry point (name configurable via "entry")
  ptf-sim.js      # REQUIRED runtime, copied from ptf-spec/runtime/ (§4.4)
  test.json       # RECOMMENDED self-test (§6)
  vendor/…        # optional: allowlisted third-party builds, byte-identical copies (§8)
  assets/…        # optional: images, fonts
```

- Everything the simulator needs MUST be inside the package. No CDN, no
  external fonts, no remote images (§5).
- Total size SHOULD stay below 300 KB without media and MUST stay below 5 MB.
- A published version directory is **immutable**.

---

## 2. Manifest `sim.json`

```json
{
  "ptf_sim": "0.1",
  "id": "ptf:sim/next-char-lab",
  "version": "2.0.0",
  "title": "Next-character lab",
  "description": "A bigram language model to play with: counting, softmax, loss, sampling.",
  "lang": ["de"],
  "concepts": ["tokenizer", "bigram", "softmax", "cross-entropy", "sampling", "temperature"],
  "levels": ["highschool", "college", "expert"],
  "stations": [
    { "id": "guess", "title": "Guess the next character" },
    { "id": "softmax", "title": "Softmax" },
    { "id": "logits-derivation", "title": "Why e^x: the derivation", "levels": ["expert"] }
  ],
  "entry": "index.html",
  "params": {
    "type": "object",
    "properties": {
      "corpus": { "type": "string", "maxLength": 20000, "description": "Training text" }
    }
  },
  "events": ["station_completed", "answered", "level_changed"],
  "capabilities": [],
  "license": "MIT",
  "authors": ["human:stefan", "claude/opus"],
  "derived_from": null,
  "changelog": "Standalone version without video references; station 0 (guess yourself).",
  "integrity": "sha256-…"
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `ptf_sim` | yes | Version of this spec. |
| `id` | yes | `ptf:sim/<name>` or `ptf:sim/@<scope>/<name>`. |
| `version` | yes | Semver; MUST equal the directory name. |
| `title`, `description` | yes | Human-readable. |
| `lang` | yes | UI languages (BCP 47); the first entry is the fallback (§4.6). |
| `concepts` | yes | Free-form concept tags, used for search. |
| `levels` | yes | Levels the simulator supports (SPEC.md §5). |
| `stations` | no | Independently addressable parts. Each has `id`, `title`, optional `levels` (default: all of the simulator's levels; see below). |
| `entry` | no | Entry file, default `index.html`. |
| `params` | no | JSON Schema for parameters the host may pass at init (H5P principle: code vs. content). |
| `events` | no | Event verbs the simulator emits (§4.3). |
| `capabilities` | yes | Extra powers it needs; empty for most simulators (§5.3). |
| `vendor` | no | Third-party builds in the package: `{ build, path, sha256, license }` per library (§8.3). |
| `license`, `authors` | yes | License (SPDX) and authors (OKF actor convention). |
| `derived_from` | no | `ptf:sim/<name>@<version>` it was forked from. |
| `changelog` | no | What changed in this version. |
| `integrity` | yes | Hash over all package files except `sim.json` (§2.1). |

**Station levels are depths, not parts** (SPEC.md §5.2). A station that
teaches part of a concept is shown at every level of the elements that use
it and changes its depth inside (§7 rule 4). Restrict a station's `levels`
only for optional deepening the concept is complete without (a derivation,
a variant), or when the elements using it do not offer the lower levels.

Schema: [schemas/sim-manifest.schema.json](schemas/sim-manifest.schema.json).

### 2.1 Integrity

`integrity` is `sha256-` followed by the base64 SHA-256 of a text built from
every file in the package except `sim.json`, sorted by relative path (POSIX
separators, byte order), each contributing:

```
<relative path>\n<hex sha256 of file bytes>\n
```

`ptf-check hash <dir>` computes it; `ptf-check` verifies it.

---

## 3. Versioning rules

| Change | Bump |
| --- | --- |
| Remove or rename a station, parameter, event or supported level; change message semantics | major |
| Add a station, optional parameter, event, level or UI language; offer a station at more levels | minor |
| Bug fix, wording, design, performance | patch |

Old versions stay available. A deprecated version keeps working and is
marked in the registry index, not deleted.

---

## 4. Host contract

Simulator and host exchange [JSON-RPC 2.0](https://www.jsonrpc.org/specification)
messages via `window.postMessage`. The design follows MCP Apps
(`ui/initialize` handshake) and the PhET-iO feature set (state, events,
external control).

### 4.1 Transport rules

- The simulator posts only to `window.parent`. Because it runs with an
  opaque origin (§5), it uses target origin `"*"`; it MUST NOT send anything
  sensitive.
- The host MUST accept messages only where `event.source` is the
  simulator's iframe `contentWindow`, and MUST treat every message as
  untrusted input.
- Every message has `"jsonrpc": "2.0"`. Methods are prefixed `ptf/`.
- Unknown methods: requests get error `-32601`; notifications are ignored.

### 4.2 Lifecycle

```
Simulator                                  Host
   | -- request ptf/initialize ----------->  |   { sim: {id, version}, protocol: "0.1" }
   | <------------- result ----------------  |   { level, station, params, locale, theme, state, standalone: false }
   | -- notification ptf/ready ----------->  |   rendered and interactive
   |        ... learner interacts ...        |
   | -- ptf/event, ptf/state, ptf/resize --> |
   | <-- ptf/setLevel, ptf/goto, ptf/theme - |
   | <-- request ptf/snapshot ------------   |
   | -- result { text } ------------------>  |
   | <-- request ptf/ping ----------------   |   heartbeat
   | -- result {} ------------------------>  |
```

If no host answers `ptf/initialize` within 500 ms (the file was opened
directly), the runtime continues in **standalone mode** with defaults and
`standalone: true`. Simulators MUST work standalone.

### 4.3 Methods

**Simulator → host**

| Method | Kind | Params | Purpose |
| --- | --- | --- | --- |
| `ptf/initialize` | request | `{ sim: {id, version}, protocol }` | Handshake; result is the init context below. |
| `ptf/ready` | notification | `{}` | First render done. |
| `ptf/event` | notification | `{ verb, station?, level?, result?, data? }` | Learning event (verbs below). |
| `ptf/state` | notification | `{ state }` | Serializable state for resume (max 64 KB JSON). |
| `ptf/resize` | notification | `{ height }` | Content height in CSS pixels. |
| `ptf/error` | notification | `{ message, source?, line?, stack? }` | Runtime error; basis for the "doesn't work" button and auto-repair. |

Init context (result of `ptf/initialize`):

| Field | Meaning |
| --- | --- |
| `level` | Level ID to start at. |
| `station` | Station ID to open, or `null`. |
| `focus` | `true`: show only `station`, one idea at a time (§4.7). Default `false`. |
| `params` | Object valid against `sim.json` `params`. |
| `locale` | Preferred UI language (BCP 47), see §4.6. |
| `theme` | `{ mode: "light" \| "dark", tokens: { "--bg": "#fff", … } }` (§4.5). |
| `state` | State previously sent via `ptf/state`, or `null`. |
| `prefs` | `{ reducedMotion, fontScale }` from the learner record, if shared. |

**Host → simulator**

| Method | Kind | Params | Purpose |
| --- | --- | --- | --- |
| `ptf/setLevel` | notification | `{ level }` | Switch level (tutor says "go deeper"). |
| `ptf/goto` | notification | `{ station, focus? }` | Scroll to / open a station; with `focus: true` show only that station, with `focus: false` show all again (§4.7). |
| `ptf/theme` | notification | `{ mode, tokens }` | Theme changed. |
| `ptf/snapshot` | request | `{}` | Result `{ text }`: a short plain-text description of what the learner currently sees and has done, so the tutor can talk about it. |
| `ptf/ping` | request | `{}` | Heartbeat. Result `{}`. |

**Event verbs** (subset of xAPI, see LEARNER-RECORD.md §4): `experienced`,
`attempted`, `answered`, `completed`, `station_completed`, `level_changed`,
`stuck`, `asked`, `reported_broken`. `result` MAY contain `correct`
(boolean), `score` (0 to 1), `response` and `misconception` (ID from the
learning element).

### 4.4 Runtime library `ptf-sim.js`

`runtime/ptf-sim.js` in this repository implements the simulator side of
the contract (about 3 KB, no dependencies). Packages copy it next to
`index.html`:

```html
<script src="ptf-sim.js"></script>
<script>
  const ptf = PTF.connect({
    id: "ptf:sim/next-char-lab", version: "2.0.0",
    onInit(ctx)     { setLevel(ctx.level); if (ctx.station) goto(ctx.station); },
    onSetLevel(lvl) { setLevel(lvl); },
    onGoto(station) { goto(station); },
    snapshot()      { return "Station 3 open, corpus: Shakespeare, temperature 0.8"; }
  });
  // later
  ptf.event("answered", { station: "guess", result: { correct: false } });
  ptf.saveState({ corpus: myText });
</script>
```

The runtime also reports uncaught errors and unhandled promise rejections as
`ptf/error`, sends `ptf/resize` via `ResizeObserver`, answers `ptf/ping`, and
applies theme tokens as CSS custom properties on `:root`.

### 4.5 Theme tokens

Hosts SHOULD send these tokens; simulators SHOULD use them with their own
fallbacks: `--bg`, `--surface`, `--ink`, `--muted`, `--line`, `--accent`,
`--accent-soft`, `--warn`, `--f-body`, `--f-display`, `--f-mono`. The
runtime also sets `data-theme="light|dark"` on `<html>`.

A token may hold any CSS value a host uses, such as `light-dark(…)`,
`var(…)` or `color-mix(…)`. A 2D canvas or WebGL context cannot parse those
and silently falls back to black. A simulator that draws with tokens MUST
therefore resolve them through the browser first, for example by setting
`color: var(--ink)` on a hidden element and reading its computed `color`.
Hosts SHOULD send plain colour values where they can.

### 4.6 UI languages

PTF content is canonical in one language (English is RECOMMENDED, SPEC.md
§6.3); the tutor adapts its own explanations to the learner. Simulator UIs
cannot be rewritten on the fly, so a package declares the languages it ships
in `sim.json` `lang` and picks one at runtime:

1. The host SHOULD send `locale` in the init context, taken from the
   learner record (`languages`, LEARNER-RECORD.md) or the host's UI.
2. The simulator MUST choose the first entry of its `lang` list that
   matches `locale` by primary language subtag (`de-AT` matches `de`). In
   standalone mode it uses `navigator.language` instead.
3. If nothing matches, it MUST fall back to the first entry of `lang`, which
   SHOULD be the library's canonical language.
4. The `lang` attribute of `<html>` SHOULD reflect the chosen language, and
   number formatting SHOULD follow it (decimal comma in German).
5. Snapshot texts (`ptf/snapshot`) and event payloads stay in English,
   whatever the UI language, so tutors and analytics read one vocabulary.

Adding a UI language to an existing simulator is a minor version (§3). A
simple pattern for small simulators is to put both texts in the markup and
hide the inactive one with CSS (`<i-en>…</i-en><i-de>…</i-de>` plus
`html:not([lang="de"]) i-de, html[lang="de"] i-en { display: none }`), and to
build dynamic strings with a helper such as `L(en, de)`.

### 4.7 Focus mode

Learners take in one idea at a time, so a tutor walks through a simulator
station by station:

- In focus mode the simulator shows only the focused station and the level
  switch, with **Back** and **Next** to the neighbouring stations visible at
  the current level. Moving emits `experienced` with
  `data: { focus: "<station>" }`.
- Focus is entered via the init context (`station` plus `focus: true`) or
  `ptf/goto { station, focus: true }`, and left via `ptf/goto { focus: false }`.
- A simulator SHOULD start focused on its first station, also standalone,
  show progress (one step per station, done ones marked, each opening its
  station) and offer **Show all** for review.
- Content SHOULD refer to single stations (`simulators[].station`).

---

## 5. Security

Simulator code is untrusted, whether a model generated it or a stranger
wrote it. The rules below keep it from reaching the host application, the
learner's data or the network.

### 5.1 Hosts MUST

1. Serve simulator files from a **dedicated origin** that hosts nothing
   else (e.g. `sims.example.org`), never from the host app's origin.
2. Send this **Content-Security-Policy as an HTTP header** with every
   simulator file (a `<meta>` CSP inside the package is not enough: the
   author controls it):

   ```
   default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
   img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:;
   connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors <host origins>
   ```

3. Embed with `<iframe sandbox="allow-scripts">`: **never** add
   `allow-same-origin`, `allow-forms`, `allow-popups`,
   `allow-top-navigation` or `allow-modals`.
4. Verify `integrity` against `ptf.lock` or the registry before serving.
5. Pass only what the simulator needs in `ptf/initialize`: no names, email
   addresses, tokens or learner IDs.
6. Show a visible frame or label so a simulator cannot pass itself off as
   the host UI.
7. Treat `ptf/ping` timeouts (no answer within 5 s) as a hang: reload the
   iframe and log a `ptf/error`.

When a dedicated origin is not available (local prototypes), a host MAY
use `srcdoc` with `sandbox="allow-scripts"`; this blocks access to the host
but not network requests. Such hosts MUST NOT run simulators from untrusted
authors.

### 5.2 Simulators MUST NOT

- make network requests (`fetch`, `XMLHttpRequest`, `WebSocket`,
  `EventSource`, `navigator.sendBeacon`) or load remote resources;
- use storage (`localStorage`, `sessionStorage`, `indexedDB`, cookies);
  state goes to the host via `ptf/state`;
- use `eval` or `new Function`;
- open windows, navigate the top frame, or use forms to submit anywhere;
- collect personal data.

`ptf-check` flags these patterns statically. The sandbox enforces most of
them at runtime anyway; the static check catches mistakes early.

### 5.3 Capabilities

`capabilities` lists extra powers a simulator needs. Hosts MUST ask the
learner before granting any of them. v0.1 defines:

| Capability | Meaning |
| --- | --- |
| `microphone`, `camera` | Media input via `getUserMedia` (host adds `allow` attribute). |
| `llm` | Ask the tutor model a question through the host (`ptf/ask` request, defined in a later version). Never a direct API call. |

### 5.4 Review for third-party simulators

A public library SHOULD only accept simulators that passed: `ptf-check`
(schema, integrity, forbidden APIs, size), the self-test (§6), a content
review (age-appropriate, correct), and SHOULD sign release indexes
(e.g. minisign or Sigstore).

---

## 6. Self-test `test.json`

A list of steps a headless browser (Playwright) runs against the package in
the sandbox:

```json
{
  "steps": [
    { "init": { "level": "highschool" } },
    { "expectText": "Guess the next character" },
    { "click": "[data-level='2']" },
    { "expectEvent": "level_changed" },
    { "expectNoError": true }
  ]
}
```

Step types: `init`, `click` (CSS selector), `type` (`{selector, text}`),
`setLevel` (level ID), `goto` (station ID, or `{station, focus}`),
`expectText`, `expectEvent` (verb, or `{verb, station}`), `expectStations`
(the exact list of station IDs that must be visible, e.g. after a focused
`goto`), `expectNoError`, `snapshot` (`true` expects a non-empty text;
`{contains: [...]}` also expects each string in it, so a test can check that
the snapshot reports what the learner just did) and `reload` (resume round
trip: the runner remounts the simulator with the last `ptf/state` in the init
context and fails unless the snapshot is the same as before). A library's CI
runs every package's test before publishing.

Besides the listed steps, the runner checks the contract for every package:

- `sim.json` declares at least one event verb (§7 rule 10); a declared verb
  that the steps never trigger is reported as a warning.
- For every station in `sim.json`, `ptf/goto { station, focus: true }` at the
  station's first level shows exactly that station (§4.7).

Published versions are immutable (§3), so contract gaps in a version that a
newer version of the same simulator supersedes are reported as notes, not
failures.

---

## 7. Build rules for authors and generators

These rules apply to human authors and to models alike; generator prompts
SHOULD include this section. A simulator is an aid the tutor opens when it
helps (PEDAGOGY.md §5), so it is small, focused and honest.

1. **One `index.html`** with inline CSS and JS, plus `ptf-sim.js` and, only
   where §8 allows it, vendored builds. Vanilla JS or Web Components, ES2022,
   classic `<script>` tags, no build step.
2. **No network, no storage, no eval** (§5.2). System fonts or a font file
   in the package.
3. **Small stations.** Each `<section data-station="<id>">` teaches **one
   idea**, works on its own, opens via `ptf/goto` (also focused), has a small
   task and emits `station_completed` when it is done. Rule of thumb: at most
   about three controls and one to three minutes per station, at most about
   seven stations per simulator; beyond that, split. In focus mode a station
   fits one phone screen in portrait: question, controls and result visible
   together. Long explanations belong to the tutor.
4. **Levels change depth, not ideas.** Mark content with
   `data-levels="highschool college"`; `ptf/setLevel` shows and hides it
   without a reload. A lower level gets the same idea with plainer words and
   an easier task, a higher level adds the formula and a harder task. No
   "beginner stations" and "advanced stations" (§2).
5. **Predict, then reveal.** A station starts from something familiar and
   asks for a guess. Where it runs an experiment, the controls that start it
   stay disabled until a prediction is chosen; choosing gives no hint; the
   prediction is judged after the result and reported as `answered` (with
   `result.misconception` when wrong). Explanations that give the answer away
   stay hidden until then. A station ends with a one-line takeaway, so it is
   framed even without a tutor. The prediction is for learners who have
   something to predict with; a station that teaches a procedure to novices
   MAY show one worked case first and ask for the prediction on the next.
6. **Self-contained.** No references to external videos or texts.
7. **Theme tokens** from §4.5 with fallbacks; light and dark mode.
8. **Mobile first.** Usable from 320 px, touch targets at least 44 px, no
   hover-only interactions.
9. **Accessible.** Keyboard operable, labelled controls, respects
   `prefers-reduced-motion`, contrast at least 4.5:1.
10. **Report what matters.** The tutor never sees the simulator, only events
    and the snapshot. Emit `answered` with `result.correct` (and
    `misconception`) for every checkable interaction, and make `snapshot`
    describe the learner's choices and results in words a tutor can talk
    about ("predicted 'e', model chose 'e' with 41 %").
11. **Small.** Below 300 KB without media and vendored builds.
12. **Correct.** Anything that models the real world follows §8.5.

### 7.1 The ladder: from catalog to free code

Generate the simplest thing that teaches the concept: question blocks when a
quiz is enough; an existing reviewed simulator with new `params`; only then
a new simulator, which needs the review in §5.4 before it is shared.

---

## 8. Libraries and vendoring (proposal)

> Status: proposal for v0.2, piloted by `ptf:sim/newton-einstein@1.0.0`.

Most simulators need no library: a canvas, some drawing code and, for
physics, a small integrator are smaller, easier to review and more correct
than an engine. A simulator MAY use only libraries from one shared
allowlist, in byte-identical builds, declared in its manifest.

### 8.1 Choose the smallest tool

| Need | Use |
| --- | --- |
| Charts, diagrams, 2D drawing, simple animation | Canvas 2D or SVG |
| Motion with known equations (fall, drag, slopes, pendulums, orbits, springs) | Own integrator: closed form, RK4 or semi-implicit Euler, fixed step |
| Many bodies that collide, stack or are joined | `planck` (2D rigid bodies) |
| 3D scenes | `three-core` (WebGL) |
| Board games with chess rules (legal moves, check, mate, FEN) | `chess.js` (rules only, no engine) |

An engine is not automatically more physical: game engines trade accuracy
for stability (damping, contact slop; a 2D "ball" is a disc and rolls 7 %
too slowly down a ramp). Use one when the interaction is the point, and say
what it simplifies.

### 8.2 The allowlist

[`vendor/allowlist.json`](vendor/allowlist.json) lists the permitted builds
(npm package and version, license, global, file, SHA-256); each has a
reproducible recipe in `vendor/<package>/<version>/`.

| Build | Global | Size | Purpose |
| --- | --- | --- | --- |
| `three-core@0.170.0` | `THREE` | 511 KB (128 KB gzip) | Tree-shaken three.js: scene, cameras, lights, basic geometry and materials, raycasting; no loaders or addons |
| `planck@1.4.2` | `planck` | 209 KB | 2D rigid-body physics (Box2D port) |
| `chess.js@1.4.0` | `ChessJS` | 37 KB | Chess rules: legal moves, check, checkmate, FEN, SAN and UCI moves; no engine (`ChessJS.Chess`) |

Not on the list: WebAssembly engines such as Rapier (the CSP has no
`'wasm-unsafe-eval'`), full three.js with loaders and addons (network code,
ES modules), matter.js (overlaps planck, less accurate), chart libraries
(teaching charts are small enough to draw). A new entry is a pull request to
this repository with recipe and build (`ptf-vendor build <build>@<version> --write`)
that shows: a permissive license (MIT, BSD, ISC, Apache-2.0) kept in the
build; one classic IIFE or UMD file with one global (hosts inline packages
into `srcdoc`, where module imports cannot resolve); no network, storage,
eval, URL workers or WebAssembly on the paths a simulator uses; a concrete
simulator that needs it; a tree-shaken size within the 5 MB limit; an active
upstream. Versions are pinned and old entries stay.

### 8.3 Vendoring a build into a package

```bash
node ../ptf-spec/tools/ptf-vendor.mjs list
node ../ptf-spec/tools/ptf-vendor.mjs add sims/<name>/<version> three-core@0.170.0
```

`add` copies the file to `vendor/` and declares it in `sim.json`:

```json
"vendor": [{ "build": "three-core@0.170.0", "path": "vendor/three-core-0.170.0.min.js", "sha256": "b3c33d2a…", "license": "MIT" }]
```

The page loads it with a classic `<script src="vendor/…">` after
`ptf-sim.js` and uses the global. The copy MUST be byte-identical (never
edited, re-minified or concatenated); only declared, allowlisted builds live
in `vendor/`; no CDN, URL imports or module scripts. Vendored files count
towards the 5 MB limit and the integrity hash, not towards the 300 KB
recommendation. `ptf-check` verifies each declaration against the
allowlist, reports undeclared files in `vendor/` and skips its pattern scan
for verified builds.

### 8.4 Using WebGL and engines

- **Degrade gracefully**: if WebGL is missing, show a text or 2D picture of
  the same idea; the station and its test still work.
- **Render on demand**, and stop loops when the station is hidden.
- **Touch**: rotate by horizontal drag with `touch-action: pan-y`; offer
  buttons as an alternative.
- **Theme**: read colours from the tokens (§4.5), update on `data-theme`.
- **State**: save what recreates the scene, not engine internals.

### 8.5 Physics that is right

1. **SI units inside**, converted only for display; state the constants on
   screen.
2. **Fixed time step** (e.g. 1/240 s), independent of the frame rate.
3. **Closed form** where it exists, else RK4 or semi-implicit Euler;
   explicit Euler only to show why it drifts.
4. **Name the model's limits** in an expert-level note.
5. **Check a number**: `test.json` SHOULD assert at least one computed value
   with a closed-form answer, so a refactoring that breaks the physics fails.
6. **Exaggerate honestly**: a scaled-up effect says so on screen next to the
   real value.
