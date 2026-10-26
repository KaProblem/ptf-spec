# ptf-mcp: learn with PTF on your own machine

A local [MCP](https://modelcontextprotocol.io) server that lets Claude (or any
MCP client) teach you from a PTF library:

- it **clones the public [ptf-library](https://github.com/KaProblem/ptf-library)**
  to `~/.ptf/library` on first start (or uses a checkout you point it to);
- it **shows simulators inline in the chat** as an [MCP App](https://github.com/modelcontextprotocol/ext-apps);
- it **keeps your learner record on this device** in `~/.ptf/learner/`
  (LEARNER-RECORD.md). Nothing is uploaded; the only network access is the
  `git clone`/`git pull` of the library.

It comes with two skills: **ptf-tutor** (how to teach from the library) and
**ptf-author** (how to improve lessons and propose them as pull requests).

## Requirements

- Node.js 20 or newer
- git (to fetch the library)

`dist/ptf-mcp.mjs` is a single bundled file; you do not need `npm install` to
run it.

## Claude Desktop

1. Clone this repository: `git clone https://github.com/KaProblem/ptf-spec`
2. Open *Settings → Developer → Edit Config* and add the server to
   `claude_desktop_config.json` (use absolute paths; on macOS, `which node`
   tells you where node is if Desktop cannot find it):

   ```json
   {
     "mcpServers": {
       "ptf": {
         "command": "node",
         "args": ["/absolute/path/to/ptf-spec/mcp/dist/ptf-mcp.mjs"]
       }
     }
   }
   ```

3. Restart Claude Desktop. The first start clones the library (a few seconds).
4. In a new chat, pick the **ptf-tutor** prompt from the "+" menu (it loads the
   teaching method) and say what you want to learn, e.g. *"Ich möchte
   verstehen, wie ein LLM funktioniert."* Optionally, also upload
   `skills/ptf-tutor` as a skill under *Settings → Capabilities*.

When the tutor calls `show_simulator`, the simulator appears in the chat. Its
toolbar lets you change level and station, and has two buttons that write to
the tutor for you: **I'm stuck** and **Doesn't work**. What you do in the
simulator is logged to your learner record, and the tutor sees a short
description of your current view.

## Claude Code

As a plugin (server and both skills):

```
/plugin marketplace add KaProblem/ptf-spec
/plugin install ptf@ptf
```

Or just the server: `claude mcp add ptf -- node /absolute/path/to/ptf-spec/mcp/dist/ptf-mcp.mjs`.

The Claude Code terminal does not render MCP Apps. The tutor then calls
`export_simulator`, which writes a standalone HTML file you open in a browser.
The simulator works, but it cannot report progress back in that mode.

## Cloud sessions

In a cloud session (claude.ai/code) the server runs inside the session's
container. It clones the public library the same way, so no central server is
needed. The learner record then lives in that container and is lost when the
container is reclaimed. Point `PTF_LEARNER` into a repository you commit, or
use the desktop setup for lasting progress. Whether simulators render inline
depends on the client: the Claude chat apps (desktop, web) render MCP Apps,
the Claude Code terminal does not (see above).

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PTF_LIBRARY` | `~/.ptf/library` | Library directory. When set, it must exist and is never cloned. Use it for your own checkout while writing content. |
| `PTF_LIBRARY_URL` | `https://github.com/KaProblem/ptf-library.git` | Where to clone from on first start. Only use libraries you trust (CONTENT-POLICY.md §4). |
| `PTF_LEARNER` | `~/.ptf/learner` | Learner record directory. Use one per person, e.g. a second server entry for your child. |

## Tools

| Tool | For | Purpose |
| --- | --- | --- |
| `get_learner` | model | Profile, mastery, reviews due, recent events |
| `update_learner_profile` | model | Save intake answers, goals, notes |
| `list_library`, `search_library` | model | Find bundles, paths, elements, simulators |
| `get_element` | model | Read an element or path (optionally one level only) |
| `show_simulator` | model | Open a simulator in the chat (MCP App) |
| `export_simulator` | model | Standalone HTML file for clients without MCP Apps |
| `record_progress` | model | Log answers, "understood", "deeper", "stuck"; set mastery |
| `sync_library` | model | `git pull` the library |
| `ptf_sim_source`, `ptf_record_event`, `ptf_save_state` | player | Called by the simulator player; hidden from the model where the client supports it |

Prompt: `ptf-tutor` (the tutor skill, for clients without skill support).

## How the simulator player works

```
Claude Desktop ──MCP Apps postMessage──> player (ui://ptf/player.html, sandboxed by the client)
                                           │  ptf-host.js
                                           └──PTF contract──> simulator (srcdoc iframe, sandbox="allow-scripts")
```

The client renders the player in its own sandbox with a strict CSP (no
network). The player embeds the unmodified simulator package, inlined into a
`srcdoc` iframe with `sandbox="allow-scripts"`, and speaks the PTF host contract
(SIMULATOR-SPEC.md §4) with it through `runtime/ptf-host.js`. Before serving a
simulator, the server checks its `integrity` against `sim.json` and the
bundle's `ptf.lock`. Events become `ptf_record_event` tool calls; snapshots
become `ui/update-model-context`; the two buttons send `ui/message`.

## Development

```bash
npm install
npm test                                  # stdio end-to-end tests against examples/minimal-library
node test/player.browser.mjs              # player in Chromium under a strict CSP (needs Playwright)
node test/player.browser.mjs ../../ptf-library next-char-lab
npm run build                             # regenerate dist/ptf-mcp.mjs; commit it with src changes
```

Inspect it interactively with `npx @modelcontextprotocol/inspector node src/server.mjs`.
