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
    { "id": "guess", "title": "Guess the next character", "levels": ["highschool"] },
    { "id": "softmax", "title": "Softmax", "levels": ["highschool", "college"] }
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
| `stations` | no | Independently addressable parts. Each has `id`, `title`, optional `levels`. |
| `entry` | no | Entry file, default `index.html`. |
| `params` | no | JSON Schema for parameters the host may pass at init (H5P principle: code vs. content). |
| `events` | no | Event verbs the simulator emits (§4.3). |
| `capabilities` | yes | Extra powers it needs; empty for most simulators (§5.3). |
| `vendor` | no | Third-party builds in the package: `{ build, path, sha256, license }` per library (§8.3). |
| `license`, `authors` | yes | License (SPDX) and authors (OKF actor convention). |
| `derived_from` | no | `ptf:sim/<name>@<version>` it was forked from. |
| `changelog` | no | What changed in this version. |
| `integrity` | yes | Hash over all package files except `sim.json` (§2.1). |

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
| Add a station, optional parameter, event, level or UI language | minor |
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

Learners take in one idea at a time best. A simulator therefore keeps each
station to **one idea** and supports a focus mode, so that a tutor can walk
through it card by card instead of showing all stations at once:

- In focus mode the simulator shows only the focused station (and the level
  switch), hides the other stations and its intro text, and offers
  **Back** and **Next** controls that move focus to the previous or next
  station visible at the current level.
- Focus is entered via the init context (`station` plus `focus: true`) or
  `ptf/goto { station, focus: true }`, and left via `ptf/goto { focus: false }`
  (with or without a station).
- When the learner moves with Back or Next, the simulator emits
  `experienced` with `data: { focus: "<station>" }`, so the tutor can follow.
- Learning paths and learning elements SHOULD refer to single stations
  (`simulators[].station`) rather than to a whole simulator.
- A simulator SHOULD start focused on its first station, also standalone,
  and offer **Show all** to see every station at once for review.
- A simulator SHOULD show progress: one step per station visible at the
  current level, done stations marked, and each step opening its station
  directly (go-to).

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

These rules apply equally to human authors and to models generating
simulators. Generator prompts SHOULD include this section.
PEDAGOGY.md §5 adds recommendations on how large a station and a
simulator should be.

1. **One `index.html`** with inline CSS and JS, plus `ptf-sim.js` and, only
   where §8 allows it, vendored library builds. Vanilla JS or Web Components,
   ES2022, classic `<script>` tags (no ES modules). No build step required.
2. **No network, no storage, no eval** (§5.2). Fonts: system font stacks,
   or a font file inside the package.
3. **Stations.** Split the simulator into stations, each a
   `<section data-station="<id>">` that teaches **one idea**. Each station
   works on its own, can be opened via `ptf/goto` (also in focus mode,
   §4.7) and emits `station_completed` when its task is done.
4. **Levels.** Mark content per level (`data-levels="highschool college"`);
   switching level via `ptf/setLevel` shows and hides content without a
   reload.
5. **Predict, observe, explain.** A station begins with something to try or
   guess, then explains. Where a station runs an experiment, the learner
   first commits to a prediction: the controls that start or change the
   experiment stay disabled until a prediction is chosen, picking one gives
   no hint whether it is right, and the prediction is judged only after the
   result is shown, then reported as `answered` (with `result.misconception`
   for a wrong one). Explanations that give the answer away stay hidden until
   then.
6. **Self-contained.** No references to external videos or texts in the UI;
   the learner may never have seen them.
7. **Theme tokens.** Use the CSS custom properties from §4.5 with fallbacks,
   and support light and dark mode.
8. **Mobile first.** Usable from 320 px wide, touch targets at least 44 px,
   no hover-only interactions.
9. **Accessible.** Keyboard operable, labelled controls, respects
   `prefers-reduced-motion`, text contrast at least 4.5:1.
10. **Report.** Emit `answered` with `result.correct` and, where it applies,
    `result.misconception` for every checkable interaction. Implement
    `snapshot`.
11. **Small.** Below 300 KB without media and vendored libraries.
12. **Correct.** For anything that claims to model the real world, follow
    §8.5: SI units, a fixed time step, stated assumptions, and at least one
    computed value checked against a closed-form result in `test.json`.

### 7.1 The ladder: from catalog to free code

Generate the simplest thing that teaches the concept:

1. **Question blocks** (SPEC.md §7) when a quiz is enough. No code.
2. **Template simulator**: an existing, reviewed simulator with new
   `params` (e.g. a different corpus). No new code.
3. **Free simulator**: new code, following this spec. Needs the full review
   in §5.4 before it is shared.

---

## 8. Libraries and vendoring (proposal)

> Status: proposal for v0.2, piloted by `ptf:sim/newton-einstein@1.0.0` in
> ptf-library. Feedback welcome before it becomes normative.

Most simulators need no library: a canvas, a few dozen lines of drawing code
and, for physics, a small integrator are smaller, easier to review and more
correct than a general engine. Libraries are for the cases where writing it
yourself would be large and error-prone: 3D rendering and many interacting
rigid bodies. To keep the library from growing wild, a simulator MAY use only
libraries from one shared allowlist, in byte-identical builds, declared in its
manifest.

### 8.1 Choose the smallest tool

| Need | Use |
| --- | --- |
| Charts, diagrams, 2D drawing, simple animation | Canvas 2D or SVG, no library. |
| Motion with known equations (free fall, drag, inclined plane, pendulum, orbits, springs) | Own integrator in the page: semi-implicit Euler or RK4 with a fixed step, or the closed-form solution. |
| Many bodies that collide, stack, slide or are joined | `planck` (2D rigid bodies). |
| 3D scenes (surfaces, orbits in space, molecules, solids) | `three-core` (WebGL). |

A physics engine is not automatically "more physical". Game engines trade
accuracy for stability: they use fixed-step semi-implicit integration,
damping, sleeping bodies, contact slop and restitution thresholds, and a 2D
engine models a ball as a disc (moment of inertia ½ m r² instead of
⅖ m r² for a sphere, so a "ball" rolls 7 % too slowly down a ramp). Use an
engine when the interaction is the point, and say what it simplifies.

### 8.2 The allowlist

[`vendor/allowlist.json`](vendor/allowlist.json) in this repository lists the
permitted builds. Each entry names the npm package and version, the license,
the global it defines, the file name and its SHA-256. The recipe for each
build lives next to it (`vendor/<package>/<version>/entry.js` and
`build.json`), so anyone can rebuild it and get the same bytes.

| Build | Global | Size (min) | Purpose |
| --- | --- | --- | --- |
| `three-core@0.170.0` | `THREE` | 511 KB (128 KB gzip) | 3D with WebGL: scene, cameras, lights, basic geometries and materials, lines, raycasting. No loaders, no addons. |
| `planck@1.4.2` | `planck` | 209 KB | 2D rigid-body physics (Box2D port): shapes, contacts, friction, joints. |

Considered and not on the list (yet):

| Library | Why not |
| --- | --- |
| Rapier, other WebAssembly engines | Instantiating WebAssembly needs `'wasm-unsafe-eval'` in `script-src`, which the simulator CSP (§5.1) does not grant. Revisit only together with a CSP change. |
| matter.js | Overlaps with planck; its position-based solver is less accurate for textbook mechanics. |
| cannon-es, Ammo.js | 3D rigid bodies are rarely needed for teaching; Ammo is WebAssembly. Add when a simulator needs them. |
| Full three.js with addons, loaders | Loaders contain network code (`fetch`), and addons are ES modules. `three-core` is tree-shaken to what simulators need. |
| D3, Chart.js, Plotly | Charts for teaching are small enough to draw directly; revisit if a family of data simulators appears. |

A new library or version is added by a pull request to this repository that
adds the recipe and the build (`ptf-vendor build <build>@<version> --write`)
and argues these criteria:

1. **License** MIT, BSD, ISC or Apache-2.0; the build keeps the license
   comment.
2. **Classic script.** It builds into one IIFE or UMD file with one global
   (`esbuild --format=iife`), because hosts inline packages into `srcdoc`
   iframes where ES module imports cannot be resolved.
3. **Inside the sandbox.** No network, storage, `eval`, workers from URLs or
   WebAssembly on the code paths a simulator uses; `ptf-check`'s
   forbidden-pattern scan passes on the build.
4. **Needed.** A concrete simulator needs it, and drawing or integrating by
   hand would be much larger or less correct.
5. **Small enough.** Tree-shaken to what simulators use; the whole package
   stays below the 5 MB limit.
6. **Maintained.** An active upstream with a stable API. Versions are pinned;
   a newer version is a new allowlist entry, old entries stay so published
   simulators keep working.

### 8.3 Vendoring a build into a package

```bash
node ../ptf-spec/tools/ptf-vendor.mjs list
node ../ptf-spec/tools/ptf-vendor.mjs add sims/<name>/<version> three-core@0.170.0
```

`add` copies the file to `vendor/<file>` and declares it in `sim.json`:

```json
"vendor": [
  { "build": "three-core@0.170.0", "path": "vendor/three-core-0.170.0.min.js",
    "sha256": "b3c33d2a…", "license": "MIT" }
]
```

The page loads it with a classic script tag before its own code and uses the
global:

```html
<script src="ptf-sim.js"></script>
<script src="vendor/three-core-0.170.0.min.js"></script>
<script> /* uses THREE */ </script>
```

Rules:

- The copy MUST be byte-identical to the allowlisted build. Never edit,
  re-minify or concatenate it; a different build is a different allowlist
  entry.
- Only declared, allowlisted builds may live in `vendor/`.
- No CDN, no `import` from URLs, no `<script type="module">`.
- Vendored files count towards the 5 MB package limit and the integrity hash,
  but not towards the 300 KB recommendation (§1, §7).

`ptf-check` verifies each declaration (file present, SHA-256 matches the
manifest and the allowlist), reports undeclared scripts in `vendor/`, skips
its forbidden-pattern scan for verified builds (they were scanned when they
were allowlisted; the sandbox and CSP still apply at runtime) and warns about
module scripts.

### 8.4 Using WebGL and engines

- **Degrade gracefully.** WebGL can be missing (old devices, some remote
  desktops, policy). Check the context, and if it fails show a short text or
  a 2D picture of the same idea instead of throwing. The station must still
  be usable and its test must still pass.
- **Render on demand.** Render when something changes or while an animation
  runs, not in an endless loop; stop animation loops when the station is
  hidden.
- **Touch.** Rotate by horizontal drag with `touch-action: pan-y`, so the page
  still scrolls; offer buttons as an alternative to dragging.
- **Theme.** Read colours from the theme tokens (§4.5) and update materials
  when `data-theme` changes.
- **Engine state is not learner state.** Save only what is needed to
  recreate a scene (`ptf/state`), not engine internals.

### 8.5 Physics that is right

A simulator that claims to show how the world behaves is held to the same
standard as a textbook:

1. **SI units inside**, converted only for display. State the constants used
   (g, air density, radii) in the UI.
2. **Fixed time step** (for example 1/240 s), independent of the frame rate,
   with interpolation for drawing. Never integrate with the frame time.
3. **Prefer the closed form** where one exists; otherwise RK4 or semi-implicit
   Euler. Explicit Euler only to teach why it drifts.
4. **Name the model's limits** in an expert-level note (constant drag
   coefficient, discs instead of spheres, first-order corrections).
5. **Check a number.** `test.json` SHOULD contain at least one `expectText`
   on a computed value that has a closed-form answer (a fall time, a period,
   a GPS clock offset), so a refactoring that breaks the physics fails CI.
6. **Exaggerate honestly.** If an effect is scaled up to be visible (e.g.
   relativistic precession × 100 000), say so on screen and show the real
   value next to it.
