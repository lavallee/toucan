# toucan

[![CI](https://github.com/lavallee/toucan/actions/workflows/ci.yml/badge.svg)](https://github.com/lavallee/toucan/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

An infinite canvas in the browser that you edit by hand while agents edit it beside you.

**[Read the docs →](https://lavallee.github.io/toucan/)**

Each canvas runs on [tldraw](https://tldraw.dev) or [Excalidraw](https://excalidraw.com). A small Node
server keeps every open tab in sync, a chat panel drives [Codex](https://github.com/openai/codex) on your
own ChatGPT sign-in, and any terminal agent (Claude Code, Codex, pi, …) can do the same through the
`toucan` CLI: read the canvas, send JavaScript to the live editor, take a screenshot, or merge in a
Mermaid / JSON Canvas / Excalidraw file by key.

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

Needs Node 22+, and the [Codex CLI](https://github.com/openai/codex) signed in (`codex login`) if you want
the chat panel.

```sh
git clone https://github.com/lavallee/toucan && cd toucan
npm install
npm run build
npm start                          # http://127.0.0.1:8893
node bin/toucan.mjs url            # prints the sign-in link (with its token); open it once per browser
```

Then make a canvas from the index page, or from the terminal:

```sh
node bin/toucan.mjs new sketch --title "Sketch"
node bin/toucan.mjs --canvas sketch summary
node bin/toucan.mjs --canvas sketch exec -e 'toucan.node("hello", { x: 0, y: 0, text: "Hello" }); return toucan.summary()'
```

Put `bin/toucan.mjs` on your PATH as `toucan` (e.g. `ln -s "$PWD/bin/toucan.mjs" ~/.local/bin/toucan`) and
point your agent at [AGENTS.md](AGENTS.md); it is the guide every agent works from.

## What it does

- **Hand edits and agent edits on one document.** Tabs on any machine share a live document; agents
  change it through an exec relay into the most recently focused tab, so you see every edit land.
- **Chat.** The right-hand panel talks to Codex. It inspects the canvas, makes edits, and can install
  *canvas scripts* — persistent behaviour (a button, a live overlay, a reaction to edits) that runs
  whenever the canvas loads. Anything outside Codex's sandbox asks you first.
- **Two engines.** Each canvas is tldraw (default) or Excalidraw. Copying a canvas converts it between them.
- **Interchange.** `toucan graph --format tg|jsoncanvas|mermaid|dot|excalidraw` exports without a tab;
  `toucan import FILE` merges JSON Canvas, Mermaid, `.excalidraw` or TG into the open canvas *by key*:
  existing shapes keep their position, new ones are laid out with ELK, nothing is deleted without `--prune`.
  The converters are in [`lib/tg.mjs`](lib/tg.mjs).
- **An index of canvases** at `/`, with previews, titles, descriptions and which ones are open.

## CLI

```
toucan [--canvas NAME] <command>
  url                         sign-in link for the browser
  canvases                    list canvases
  new NAME [--engine tldraw|excalidraw] [--from CANVAS|FILE] [--title T] [--description D]
  graph [--format tg|jsoncanvas|mermaid|dot|excalidraw] [OUT]
  import FILE [--format F] [--move] [--prune]
  meta [--title T] [--description D]
  archive                     move a canvas aside (nothing is deleted)
  summary [--within KEY]      compact JSON of shapes
  exec -e CODE | FILE | -     run JS in the live editor; `return` a JSON value
  screenshot [OUT.png]        PNG of the page
  script list | put NAME FILE | rm NAME
```

`--canvas` can also come from `TOUCAN_CANVAS`.

## Extending

- **Canvas scripts** grow a single canvas; see [AGENTS.md](AGENTS.md).
- **Extension commands.** `toucan X …` runs `toucan-X …` from your PATH, with `TOUCAN_CANVAS` set, so
  domain-specific tooling (a diagram generated from your own data, say) lives in its own repo. From
  Node, use the same client the CLI does:

  ```js
  import { connect } from 'toucan/client'   // or ../toucan/lib/client.mjs
  const t = connect({ canvas: process.env.TOUCAN_CANVAS })
  await t.exec('return toucan.summary()')
  ```

- **Deployment notes for agents.** An `AGENTS.md` in the data directory is passed to the chat agent as
  extra instructions, so your house canvases and extensions are documented without forking.

## Agent plugin

The `toucan` skill teaches Claude Code and Codex to drive a canvas. Install it from the Lyra Forge marketplace:

```
/plugin marketplace add lyra-forge/marketplace      # Claude Code
/plugin install toucan@lyra-forge

codex plugin marketplace add lyra-forge/marketplace # Codex
codex plugin add toucan@lyra-forge
```

## Configuration

| Setting | Default | |
|---|---|---|
| `--host` / `TOUCAN_HOST` | `127.0.0.1` | interface to listen on |
| `--port` / `TOUCAN_PORT` | `8893` | |
| `--data` / `TOUCAN_DATA` | `canvases/` in the checkout | where canvases, scripts and previews live |
| `TOUCAN_PUBLIC_HOST` | `127.0.0.1`, or the hostname when bound to all interfaces | host used in printed links |
| `TOUCAN_CANVAS` | — | default canvas for the CLI |
| `TOUCAN_URL` | from `~/.config/toucan/server.json` | server the CLI talks to |
| `VITE_TLDRAW_LICENSE_KEY` | — | tldraw licence key, read at build time (see below) |

## Security

The exec relay runs arbitrary JavaScript in your browser tab, and the chat drives an agent with a shell.
Every HTTP and WebSocket request therefore needs the token in `~/.config/toucan/server.json` (created
on first start, mode 0600; delete its `token` field and restart to rotate). The server listens on
loopback by default; only bind it wider (`--host 0.0.0.0`) on a network you trust, and put it behind
HTTPS if it leaves your machine. Codex runs with `workspace-write` rooted at this checkout and
`on-request` approval.

## Licences

toucan's own code is [MIT](LICENSE). It builds on **tldraw**, which is *not* MIT: the
[tldraw licence](https://github.com/tldraw/tldraw/blob/main/LICENSE.md) allows development use freely,
but production use (anything served over HTTPS) needs a licence key, including tldraw's free hobby
licence for non-commercial projects. Put the key in `.env` as `VITE_TLDRAW_LICENSE_KEY=…` and rebuild.
Excalidraw canvases need no key (MIT).

## Develop

```sh
npm run dev           # server + vite with hot reload
npm run typecheck
npm test              # round-trip checks for the graph converters
npm run css:preflight # regenerate app/preflight.css after upgrading tailwindcss
```

React 19 + TypeScript under `app/` (Vite), tldraw 5 / Excalidraw 0.18 for the canvas, Tailwind v4 and
shadcn/ui for toucan's own UI; the chat panel follows shadcn's AI Elements patterns. Tailwind's preflight
is scoped to `.toucan-ui` and layered beneath tldraw's CSS, so it never touches the canvas. More detail
on sync, exec routing and the chat relay is in [How it works](https://lavallee.github.io/toucan/how-it-works.html).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and [RELEASING.md](RELEASING.md). Changes are in [CHANGELOG.md](CHANGELOG.md).
