---
kicker: Getting started
description: Install Toucan, open your first canvas and connect an agent.
---
# Quick start

::: html
<link rel="stylesheet" href="assets/admiralty.css">
<script src="assets/site-nav.js"></script>
<script defer src="assets/site-footer.js"></script>
:::

## Install

You need [Node 22 or newer](https://nodejs.org). This installs toucan, starts it, connects the agents it finds, and opens a first canvas:

```sh
curl -fsSL https://github.com/lavallee/toucan/releases/latest/download/install.sh | sh
```

To read it first, it's a [short script](https://github.com/lavallee/toucan/blob/main/install.sh). Or do what it does:

```sh
npm install -g https://github.com/lavallee/toucan/releases/latest/download/toucan.tgz
toucan setup
```

Don't run `npm install toucan`: that name on the npm registry is an unrelated package. Update later with `toucan update`.

The canvas works without an agent or an account. The chat panel needs the
[Codex CLI](https://github.com/openai/codex), signed in with `codex login`; other agents work through their own harnesses.

`toucan doctor` checks the install and says what to do about anything wrong.

## Make a canvas

From the index page, from an agent, or from a terminal:

![The index page: a New canvas button, and cards for three canvases (a tldraw diagram of a shop's services, an Excalidraw publishing flow and a tldraw roadmap), each with a preview, description and shape count.](assets/toucan-index.png)


```sh
toucan new sketch --title "Sketch"                   # a tldraw canvas
toucan new board --engine excalidraw --title "Board" # an Excalidraw one
```

Open the link it prints. Draw two boxes and an arrow, then [make your first change with an agent](tour.html#draw-with-an-agent).

## Use it from your agent

An agent can do the install itself: paste *Install toucan from https://github.com/lavallee/toucan and draw how this project fits together.* Agents that read the docs first can start from [llms.txt](llms.txt).

`setup` connected the agents it found (`toucan agents` shows them). In any project, ask:

> Use toucan to draw how this repo fits together, and open it for me.

The agent runs `toucan init`, which finds or makes the canvas for that project, without adding anything to the
repository. After that, commands run anywhere in the project use it, and you watch the drawing arrive in your browser.

| Agent | How it connects | |
|---|---|---|
| Claude Code, Gemini CLI, pi, Cursor, opencode | skill | teaches the agent the `toucan` CLI |
| Codex | skill and MCP | its sandbox blocks the local network the CLI needs by default; MCP servers run outside it |
| Claude Desktop | MCP | it has no shell |

After installing another agent, run `toucan agents install`. Add `--mcp` for MCP everywhere, and undo any of it with
`toucan agents remove`. Anything else that speaks MCP can use this server:

```json
{ "mcpServers": { "toucan": { "command": "toucan", "args": ["mcp"] } } }
```

### The canvas in the chat

`toucan mcp` is also an [MCP App](https://modelcontextprotocol.io/docs/extensions/apps). In a host that shows them, such
as Claude, the canvas appears in the conversation when an agent calls `toucan_open` or `toucan_draw`. The view is live. When
you edit the canvas in toucan, the picture in the chat updates within a couple of seconds, and the agent hears what you
changed with its next tool call. Drag to pan and scroll to zoom. **Edit in toucan** opens the canvas, signed in, in your
browser.

::: html
<figure><video data-demo loop muted playsinline preload="none" width="1600" height="900" poster="assets/demos/mcp-app.poster.png" src="assets/demos/mcp-app.mp4" aria-label="An agent draws a release pipeline with toucan_draw and the canvas appears in the chat; a person renames a step in toucan, the view in the chat updates, and the agent builds on the rename"></video><noscript><a href="assets/demos/mcp-app.mp4">Play demo</a></noscript><figcaption>Every tool call in this demo is real <code>toucan mcp</code>, in a host built on the official MCP Apps SDK. The agent's lines are scripted. <code>npm run test:mcp-app</code> runs it.</figcaption></figure>
:::

The view needs no network access. It gets pictures of the canvas from `toucan mcp` through the host, so it works with the
stdio server and never sees the server's token. In clients without MCP Apps, the same tools answer in text.

An agent with no connection can read the guide: `toucan guide`. It's also the [agent guide](agents.html) here.

## Work with your own agent

To give a canvas the instructions and project files of an existing agent, [configure a named agent profile](agents.html#profiles-working-with-a-named-agent).

## The server

You don't have to manage it: a command that needs a server starts one in the background, and `toucan stop` stops it.
`toucan open` opens the canvas in your browser, signed in. The token that protects it is in
`~/.config/toucan/server.json`, and on another device `toucan url` prints a link that signs you in. Open it once per browser.

## Where things live

Canvases are your documents, so they live outside the install and survive upgrades:

- Linux: `~/.local/share/toucan/canvases`
- macOS: `~/Library/Application Support/toucan/canvases`
- Windows: `%LOCALAPPDATA%\\toucan\\canvases`

Choose another with `toucan setup --data ~/Documents/toucan`, then `toucan restart`. To keep a diagram in a repository, export it:
`toucan graph --format mermaid docs/architecture.mmd`.

## Serve it beyond your machine

The server listens on loopback by default. To reach it from other machines on a network you trust:

```sh
TOUCAN_PUBLIC_HOST=myhost toucan start --host 0.0.0.0
```

It answers to IP addresses, `localhost` and this machine's own name, including names under it like `myhost.local` or a
Tailscale name like `myhost.example.ts.net`. Any other name gets a short refusal saying which setting lets it in, which also keeps
a web page from reaching the server through a name of its own.

### Under a name of your own

If people reach toucan at a name you've given it, behind a reverse proxy or on your own DNS, tell it so:

```sh
TOUCAN_PUBLIC_URL=http://toucan.example toucan start --host 0.0.0.0
```

Links then use that address, so `toucan open` and `toucan url` sign people in where they'll browse. A browser keeps
the sign-in for each address separately. To sign in from a browser `toucan open` can't reach, paste the link `toucan url`
prints into the sign-in page. Add more names with `TOUCAN_HOSTS=toucan.example,.corp.example`.

Over plain `http://`, tldraw runs in development mode. Behind HTTPS it needs a licence key; see
[licences](extending.html#licences).
