# toucan

[![CI](https://github.com/lavallee/toucan/actions/workflows/ci.yml/badge.svg)](https://github.com/lavallee/toucan/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

An infinite canvas in the browser that you edit by hand while agents edit it beside you.

**[Read the docs →](https://lavallee.github.io/toucan/)** · **[See it work →](https://lavallee.github.io/toucan/tour.html)**

> [!TIP]
> **If you're an agent reading this:** toucan gives you a canvas your person can see. Draw diagrams of their code,
> systems and plans in a browser tab while they watch; they edit by hand, pin sticky notes and comment, and you read
> all of it back. Use it when a picture would explain something better than prose, or when you want them to point at
> what's wrong.
>
> 1. **Install** (Node 22+): `curl -fsSL https://github.com/lavallee/toucan/releases/latest/download/install.sh | sh`. Not `npm install toucan`: that's an unrelated package.
> 2. **Start** in their project: `toucan init --open`, then tell them what you're drawing.
> 3. **Learn the rest** with `toucan guide`. Don't place boxes by hand: describe the diagram as data and pipe it to
>    `toucan draw -` (`toucan templates` lists the kinds).
>
> No shell? `toucan mcp` is an MCP server. As a plugin: `/plugin install toucan@lyra-forge` in Claude Code, or
> `codex plugin add toucan@lyra-forge` in Codex, after adding the `lyra-forge/marketplace` marketplace. A
> one-page brief for agents is at [llms.txt](https://lavallee.github.io/toucan/llms.txt).
>
> **If you're a person:** paste this to your agent: *Install toucan from https://github.com/lavallee/toucan and draw how
> this project fits together.*

![A tldraw canvas of a shop's services with the History panel open, showing an earlier version read-only, beside the Codex chat panel.](website/site/assets/toucan-history.png)

Each canvas runs on [tldraw](https://tldraw.dev) or [Excalidraw](https://excalidraw.com). A small Node
server keeps every open tab in sync, a chat panel drives [Codex](https://github.com/openai/codex) on your
own ChatGPT sign-in, and any terminal agent (Claude Code, Codex, pi, …) can do the same through the
`toucan` CLI: read the canvas, send JavaScript to the live editor, take a screenshot, or merge in a
Mermaid / JSON Canvas / Excalidraw file by key. Agents that can't run a CLI use the same commands over MCP.

```
 browser ──── http://HOST:8893/?canvas=NAME
   ├─ tldraw or Excalidraw canvas  ◀── exec relay (WebSocket) ──┐
   └─ chat panel                   ◀── chat relay (WebSocket) ──┤
                                                                │ server/index.mjs
                                                                ├─ codex app-server (stdio; your ChatGPT login)
                                                                │     └─ runs `toucan …` to read/change the canvas
                                                                ├─ one sync room per canvas → <data>/<name>.json | .excalidraw
                                                                └─ canvas scripts → <data>/<name>.scripts/*.js
 terminal agents ── toucan … (same path)
```

## Quick start

You need [Node 22+](https://nodejs.org). Then one command installs toucan, starts it, connects the agents it finds and opens a first canvas:

```sh
curl -fsSL https://github.com/lavallee/toucan/releases/latest/download/install.sh | sh
```

Or, if you'd rather read it first: `npm install -g https://github.com/lavallee/toucan/releases/latest/download/toucan.tgz && toucan setup`.
(Not `npm install toucan`: that name on the npm registry is an unrelated package.)

Then, in any project, ask your agent:

> Use toucan to draw how this repo fits together, and open it for me.

Or do it by hand:

```sh
cd my-project
toucan init --open     # this project's canvas; commands run anywhere in the project now use it
toucan draw plan.json  # or: toucan import flow.mmd, toucan exec -e '…', or just draw in the browser
```

<img src="website/site/assets/toucan-index.png" alt="The index page, with previews of three canvases" width="720">

You don't manage a server. A command that needs one starts it in the background, and `toucan stop` stops it. If you already run one yourself (with systemd, or `npm start`), toucan leaves it to you; `toucan start --take-over` hands it over. If anything seems off, `toucan doctor` checks the install and says what to do.

The canvas works without any agent or account. The built-in chat panel needs the [Codex CLI](https://github.com/openai/codex), signed in with `codex login`; every other agent works through its own harness.

### Where things live

Canvases are your documents, so they live outside the install, and an upgrade or uninstall leaves them alone:

| | |
|---|---|
| Linux | `~/.local/share/toucan/canvases` (or `$XDG_DATA_HOME/toucan/canvases`) |
| macOS | `~/Library/Application Support/toucan/canvases` |
| Windows | `%LOCALAPPDATA%\\toucan\\canvases` |

Choose another with `toucan setup --data ~/Documents/toucan`, then `toucan restart`. (That's for the server toucan runs; for your own, pass `--data` or `TOUCAN_DATA`.) A project's canvas lives there too: `toucan init` remembers the link in `~/.config/toucan/projects.json` and adds nothing to your repository. To keep a diagram in the repo, export it: `toucan graph --format mermaid docs/architecture.mmd`.

A checkout that already has canvases in `canvases/` keeps using them. To move them, stop the server, move the folder, and use `--data`.

## Connect your agents

`toucan setup` does this for the agents it finds. To do it again after installing one, or to choose:

```sh
toucan agents                  # what's here, and what's connected
toucan agents install          # connect every agent found here
toucan agents install codex    # or the ones you name
toucan agents install --mcp    # add MCP as well as the skill
toucan agents remove           # undo: only removes what toucan installed
```

| Agent | How it connects | |
|---|---|---|
| Claude Code, Gemini CLI, pi, Cursor, opencode | skill | teaches the agent the `toucan` CLI |
| Codex | skill and MCP | its sandbox blocks the local network the CLI needs by default; MCP servers run outside it |
| Claude Desktop | MCP | it has no shell |

For anything else that speaks [MCP](https://modelcontextprotocol.io), add this server, which needs no other setup:

```json
{ "mcpServers": { "toucan": { "command": "toucan", "args": ["mcp"] } } }
```

An agent with no connection at all can still follow [AGENTS.md](AGENTS.md) (`toucan guide` prints it). In a container or on another machine, set `TOUCAN_URL` and `TOUCAN_TOKEN` to use a server elsewhere; the token is in `~/.config/toucan/server.json` on the server's machine.

Claude Code and Codex can also use the plugin from the Lyra Forge marketplace, which stays up to date with the marketplace rather than with your install:

```
/plugin marketplace add lyra-forge/marketplace      # Claude Code
/plugin install toucan@lyra-forge

codex plugin marketplace add lyra-forge/marketplace # Codex
codex plugin add toucan@lyra-forge
```

## Install from source

```sh
git clone https://github.com/lavallee/toucan && cd toucan
npm install
node bin/toucan.mjs setup      # builds the app, puts `toucan` on your PATH, and carries on as above
```

## What it does

- **Hand edits and agent edits on one document.** Tabs on any machine share a live document; agents
  change it through an exec relay into the most recently focused tab, so you see every edit land.
- **Chat.** A panel talks to Codex; dock it left, right or along the bottom, or float it over the canvas. Fast
  (the default) acts right away, and Thorough thinks longer. Add to a request while it's running. `/routine-name`
  or a pasted Mermaid flowchart lands at once, with no agent. It inspects the canvas, makes edits, and can install
  *canvas scripts* — persistent behaviour (a button, a live overlay, a reaction to edits) that runs
  whenever the canvas loads. Anything outside Codex's sandbox asks you first.
- **Two engines.** Each canvas is tldraw (default) or Excalidraw. Copying a canvas converts it between them.
- **Interchange.** `toucan graph --format tg|jsoncanvas|mermaid|dot|excalidraw` exports without a tab;
  `toucan import FILE` merges JSON Canvas, Mermaid, `.excalidraw` or TG into the open canvas *by key*:
  existing shapes keep their position, new ones are laid out with ELK, nothing is deleted without `--prune`.
  The converters are in [`lib/tg.mjs`](lib/tg.mjs).
- **Threads.** Comment on a shape or drag out a region. Each comment is a thread you go back and forth in and close
  out: give it to its own agent (several can work at once, and you can steer each one), send it into the main chat, or
  leave it for people. They work on both engines and with no tab open, and `toucan threads` does the same from the CLI.
- **Templates.** 22 diagrams to start from: flowchart, swimlane, org chart, sequence, architecture, roadmap, kanban, journey map and more, laid out by rule and scored against what's actually drawn. **Check this diagram** scores any canvas and points at what's wrong, and **Clean up** and **Lay it out again** fix most of it.
- **Formats and details.** Boxes stay short, and selecting one opens its detail in a card. A story map, ideas map or system diagram
  lets you walk the canvas with ← and →, following arrows or frames, and tells agents how to work on it. **Air out** converts a dense diagram.
- **Notes for the agent.** On tldraw, a sticky note is addressed to the agent: pin one where the problem
  is, and `toucan notes` gives the agent its text and the shapes it sits on and near. A handled note turns
  green with a one-line reply; notes are never deleted.
- **Proposals.** An agent can answer on the canvas with a proposal: dashed shapes (`import --propose`)
  that you accept (made solid) or reject (removed) from a bar above the canvas.
- **History.** Every canvas keeps its own versions: after each agent run, when your edits go quiet, and whenever
  you name one. Step back and forward through them read-only, and restore any of them for everyone; what was
  there is saved first, so a restore can be undone too. `toucan versions` does the same from the CLI.
- **Routines.** Bank a chore once and run it on any canvas from the Routines menu or `toucan routine run`, as
  one undo step. Ask the chat to "bank that", or paste code. Tidy arrows and Straighten sketchy lines ship with toucan.
- **Your look.** A light/dark/system override, and clean lettering by default in place of tldraw's handwritten
  font (switch back under Appearance). It's per browser, and it doesn't change the canvases.
- **An index of canvases** at `/`, with previews, titles, descriptions and which ones are open.
- **Headless mode (opt-in).** Start the server with `--headless` and an agent can build or tend a canvas
  nobody has open: the server opens it in headless Chromium, runs the code in the real editor there, and
  closes it when idle. Those edits go on the canvas's trail (`toucan log`), and the next person to open
  the canvas sees "N agent edits while you were away".

## CLI

```
Getting going:
  setup [--data DIR] [--browser] [--no-agents] [--no-open]   get this machine ready
  init [NAME] [--title T] [--template ID] [--engine E] [--open]   the canvas for the project you're in
  open [NAME]                 open a canvas (or the index) in your browser, signed in
  agents [install [ID...] [--mcp] [--force] | remove [ID...]]   connect the agents on this machine
  mcp                         run as an MCP server on stdio
  guide                       the full guide for agents
  status | doctor             is the server running; check the whole install
  start [--port P] [--host H] [--data DIR] [--no-headless] [--take-over] | stop | restart   the background server
  update                      install the latest release

toucan [--canvas NAME] <command>
  url                         sign-in link for the browser
  canvases                    list canvases
  new NAME [--engine tldraw|excalidraw] [--from CANVAS|FILE] [--title T] [--description D]
  graph [--format tg|jsoncanvas|mermaid|dot|excalidraw] [OUT]
  import FILE|- [--format F] [--move] [--prune] [--propose] [--label T]
  meta [--title T] [--description D]
  archive                     move a canvas aside (nothing is deleted)
  summary [--within KEY]      compact JSON of shapes
  exec -e CODE | FILE | - [--label T]   run JS in the live editor; `return` a JSON value
  screenshot [OUT.png]        PNG of the page
  script list | put NAME FILE | rm NAME
  proposals [accept|reject [KEY...]]   dashed = proposed: list, accept or reject
  selection                   what people have selected, to resolve "this"
  notes [--all]               sticky notes left for the agent, with the shapes they're on and near
  notes resolve KEY --reply T mark a note handled: green, plus a one-line reply
  log [--since T]             edits agents made with no tab open (T: ISO time, or an age: 30m, 2h, 7d)
  versions [save LABEL | show N [--format F] | restore N]   the canvas's history
  threads [--all] | show N | new TEXT --on KEY,KEY | --region X,Y,W,H [--ask] | reply N TEXT [--ask] | close N [--reply T] | reopen N | adopt-notes
  templates [show ID]         diagrams to start from (new NAME --template ID)
  draw FILE|- [--update]      lay out a diagram described as data onto the canvas
  files                       where this canvas keeps what agents write for it
  routine list | show NAME | run NAME [--args JSON] | save NAME FILE [--title T] [--description D] [--engines E] | rm NAME
  say TEXT [--at KEY,KEY]     tell people what you're about to do; --at points your cursor at those shapes
```

`--agent NAME` (or `TOUCAN_AGENT`) names the agent on the canvas. While an agent works, every open tab shows a
status pill with its name and what it is doing, a ring round the canvas, and its cursor on the shape it last
changed or pointed at.

The canvas comes from `--canvas`, then `TOUCAN_CANVAS`, then the project you're in (`toucan init`). `exec`, `summary`,
`screenshot` and `import` run in a browser tab on the canvas; with no tab they use headless mode, or fail if it's off.

## Headless mode

A server started by toucan has this on: it costs nothing until an agent runs code with no tab open. It uses the Chrome, Chromium, Edge or Brave already on your machine. If there's none, `toucan setup --browser` downloads Chromium (about 150 MB). `toucan start --no-headless` turns it off.

A server you run yourself has it off unless you ask:

```sh
npm start -- --headless                # or TOUCAN_HEADLESS=1 npm start
```

When an `exec` (and so `summary`, `screenshot` or `import`) finds no tab on the canvas, or no tab
answers, the server opens the canvas itself in headless Chromium and runs the code there. It is the
normal app, so edits go through the real editor and sync like anyone's. People's tabs always come
first. There is at most one headless page per canvas and `TOUCAN_HEADLESS_MAX` in all; a page closes
after `TOUCAN_HEADLESS_IDLE` seconds without an exec, and Chromium closes with the last page. Expect
about half a second to two seconds for the first exec on a cold canvas and a few hundred MB of memory
per open page.

Edits made there are recorded in `<data>/<name>.log.jsonl`: time, source, what ran, and the keys
added, updated or removed. `toucan log` prints them; the app shows "N agent edits while you were
away" until you mark them seen (per browser).

## Extending

- **Canvas scripts** grow a single canvas, and **routines** are chores for every canvas; see [AGENTS.md](AGENTS.md).
- **Extension commands.** `toucan X …` runs `toucan-X …` from your PATH, with `TOUCAN_CANVAS` set, so
  domain-specific tooling (a diagram generated from your own data, say) lives in its own repo. From
  Node, use the same client the CLI does:

  ```js
  import { connect } from 'toucan/client'   // or the path to toucan's lib/client.mjs
  const t = connect({ canvas: process.env.TOUCAN_CANVAS })
  await t.exec('return toucan.summary()')
  ```

- **Deployment notes for agents.** An `AGENTS.md` in the data directory is passed to the chat agent as
  extra instructions, so your house canvases and extensions are documented without forking.

## Try it on a book

Two ready-made canvases, each built from a public-domain text:

```sh
toucan new meditations --from examples/meditations.tg.json --canvas-format ideas --title "Meditations: a map of ideas" \
  --description "Marcus Aurelius in George Long's translation. Every passage is his wording, with book and section."
toucan new odyssey --from examples/odyssey.tg.json --canvas-format story --title "The Odyssey: a story map" \
  --description "Homer in Samuel Butler's translation, which uses Roman names. Every line is Butler's, with its book."
```

Open one, click a box to read it, and walk with ← and →. Then click **Comment**, drag around a cluster, and ask something: "what's the argument here?" or "where does he
disagree with himself?". Every quotation was checked word for word against its source by `scripts/build-maps.mjs`.

## Configuration

| Setting | Default | |
|---|---|---|
| `--host` / `TOUCAN_HOST` | `127.0.0.1` | interface to listen on |
| `--port` / `TOUCAN_PORT` | `8893` | |
| `--data` / `TOUCAN_DATA` | see [Where things live](#where-things-live) | where canvases, scripts and previews live |
| `--headless` / `TOUCAN_HEADLESS=1` | on with `toucan start`, off with `npm start` | run exec in headless Chromium when no tab has the canvas open |
| `TOUCAN_CHAT_FAST_MODEL`, `TOUCAN_CHAT_THOROUGH_MODEL` | Codex's default | model for each chat speed |
| `TOUCAN_CHAT_FAST_EFFORT`, `TOUCAN_CHAT_THOROUGH_EFFORT` | `low`, `medium` | reasoning effort for each chat speed |
| `TOUCAN_HEADLESS_IDLE` | `120` | seconds a headless page stays open after its last exec |
| `TOUCAN_HEADLESS_MAX` | `2` | headless pages open at once (the least recently used idle one makes room) |
| `TOUCAN_PUBLIC_HOST` | `127.0.0.1`, or the hostname when bound to all interfaces | host used in printed links |
| `TOUCAN_CANVAS` | — | default canvas for the CLI |
| `TOUCAN_URL` | from `~/.config/toucan/server.json` | server the CLI talks to; it won't start one |
| `TOUCAN_TOKEN` | from `~/.config/toucan/server.json` | with `TOUCAN_URL`: for a server on another machine or outside a container |
| `TOUCAN_NO_AUTOSTART` | — | never start a server from a command |
| `TOUCAN_BROWSER` | the system's | program `toucan open` launches |
| `VITE_TLDRAW_LICENSE_KEY` | — | tldraw licence key, read at build time (see below) |

## Security

The exec relay runs arbitrary JavaScript in your browser tab, and the chat drives an agent with a shell.
Every HTTP and WebSocket request therefore needs the token in `~/.config/toucan/server.json` (created
on first start, mode 0600; delete its `token` field and restart to rotate). The server listens on
loopback by default; only bind it wider (`--host 0.0.0.0`) on a network you trust, and put it behind
HTTPS if it leaves your machine. Codex runs with `workspace-write` rooted at the install directory and
`on-request` approval. `toucan open` passes the token to your browser in the link's fragment, which isn't sent to the
server, but it is on the opener's command line while that runs; on a machine shared with people you don't trust, use `toucan url`.
`toucan agents install` writes only the skill folders and MCP entries it reports, keeps a `.before-toucan`
copy of any config file it changes, and `toucan agents remove` undoes them.

**Connecting an agent gives it the canvas, including outside its sandbox.** MCP servers run outside an agent's sandbox, and
`toucan_exec`, like `toucan exec`, runs JavaScript in your signed-in browser tab or the server's headless page, where it can reach
the network and the toucan server. The MCP tools don't run other programs or take file paths, but treat them as trusting
that agent with toucan, and check the chat's and your harness's approval settings accordingly.

Headless mode adds no new way in: the headless page is a local Chromium the server starts itself. It
gets the token through a script that puts it in the page's (in-memory, throwaway) local storage, never
in a URL, and then authenticates like any tab.

## Licences

toucan's own code is [MIT](LICENSE). It builds on **tldraw**, which is *not* MIT: the
[tldraw licence](https://github.com/tldraw/tldraw/blob/main/LICENSE.md) allows development use freely,
but production use (anything served over HTTPS) needs a licence key, including tldraw's free hobby
licence for non-commercial projects. The key is read at build time, so [install from source](#install-from-source), put it
in `.env` as `VITE_TLDRAW_LICENSE_KEY=…` and rebuild. A release served from your own machine doesn't need one.
Excalidraw canvases need no key (MIT).

## Develop

```sh
npm run dev           # server + vite with hot reload
npm run typecheck
npm test              # round-trip checks for the graph converters, the trail, setup and connecting agents
npm run test:install  # end to end: pack the release, install it in a throwaway home, use it through the CLI and MCP
npm run test:headless # end to end: a headless server builds canvases on both engines with no tab open
npm run css:preflight # regenerate app/preflight.css after upgrading tailwindcss
```

React 19 + TypeScript under `app/` (Vite), tldraw 5 / Excalidraw 0.18 for the canvas, Tailwind v4 and
shadcn/ui for toucan's own UI; the chat panel follows shadcn's AI Elements patterns. Tailwind's preflight
is scoped to `.toucan-ui` and layered beneath tldraw's CSS, so it never touches the canvas. More detail
on sync, exec routing and the chat relay is in [How it works](https://lavallee.github.io/toucan/how-it-works.html).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and [RELEASING.md](RELEASING.md). Changes are in [CHANGELOG.md](CHANGELOG.md).
