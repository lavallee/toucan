# Quick start

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

An agent with no connection can read the guide: `toucan guide`. It's also the [agent guide](agents.html) here.

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

## Make a canvas

From the index page, from an agent, or from a terminal:

![The index page: a New canvas button, and cards for three canvases (a tldraw diagram of a shop's services, an Excalidraw publishing flow and a tldraw roadmap), each with a preview, description and shape count.](assets/toucan-index.png)


```sh
toucan new sketch --title "Sketch"                   # a tldraw canvas
toucan new board --engine excalidraw --title "Board" # an Excalidraw one
```

Open the link it prints. With the tab open, an agent can work on it:

```sh
toucan --canvas sketch exec -e 'toucan.node("api", { x: 0, y: 0, text: "API" }); toucan.node("db", { x: 300, y: 0, text: "Database" }); toucan.edge("api", "db"); return toucan.summary()'
toucan --canvas sketch screenshot
```

Or describe what you want and import it:

```sh
cat > plan.mmd <<'MMD'
graph LR
  subgraph web [Web tier]
    ui[Browser UI] --> cdn[CDN]
  end
  ui --> api
  api --> cache[(Redis)]
MMD
toucan --canvas sketch import plan.mmd
```

Existing shapes keep their positions; new ones are laid out beside them.

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
