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
  assets/…        # optional: images, fonts, vendored libraries
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
| `lang` | yes | UI languages (BCP 47). |
| `concepts` | yes | Free-form concept tags, used for search. |
| `levels` | yes | Levels the simulator supports (SPEC.md §5). |
| `stations` | no | Independently addressable parts. Each has `id`, `title`, optional `levels`. |
| `entry` | no | Entry file, default `index.html`. |
| `params` | no | JSON Schema for parameters the host may pass at init (H5P principle: code vs. content). |
| `events` | no | Event verbs the simulator emits (§4.3). |
| `capabilities` | yes | Extra powers it needs; empty for most simulators (§5.3). |
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
| `params` | Object valid against `sim.json` `params`. |
| `locale` | Preferred UI language. |
| `theme` | `{ mode: "light" \| "dark", tokens: { "--bg": "#fff", … } }` (§4.5). |
| `state` | State previously sent via `ptf/state`, or `null`. |
| `prefs` | `{ reducedMotion, fontScale }` from the learner record, if shared. |

**Host → simulator**

| Method | Kind | Params | Purpose |
| --- | --- | --- | --- |
| `ptf/setLevel` | notification | `{ level }` | Switch level (tutor says "go deeper"). |
| `ptf/goto` | notification | `{ station }` | Scroll to / open a station. |
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
`expectText`, `expectEvent` (verb), `expectNoError`, `snapshot` (expects a
non-empty text). A library's CI runs every package's test before publishing.

---

## 7. Build rules for authors and generators

These rules apply equally to human authors and to models generating
simulators. Generator prompts SHOULD include this section.

1. **One `index.html`** with inline CSS and JS, plus `ptf-sim.js`. Vanilla
   JS or Web Components, ES2022. No build step required.
2. **No network, no storage, no eval** (§5.2). Fonts: system font stacks,
   or a font file inside the package.
3. **Stations.** Split the simulator into stations, each a
   `<section data-station="<id>">`. Each station works on its own, can be
   opened via `ptf/goto` and emits `station_completed` when its task is
   done.
4. **Levels.** Mark content per level (`data-levels="highschool college"`);
   switching level via `ptf/setLevel` shows and hides content without a
   reload.
5. **Start with an experience.** A station begins with something to try or
   guess, then explains.
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
11. **Small.** Below 300 KB without media.

### 7.1 The ladder: from catalog to free code

Generate the simplest thing that teaches the concept:

1. **Question blocks** (SPEC.md §7) when a quiz is enough. No code.
2. **Template simulator**: an existing, reviewed simulator with new
   `params` (e.g. a different corpus). No new code.
3. **Free simulator**: new code, following this spec. Needs the full review
   in §5.4 before it is shared.
