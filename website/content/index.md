# toucan

toucan puts a [tldraw](https://tldraw.dev) or [Excalidraw](https://excalidraw.com) canvas in a browser
tab and gives agents a way in. A chat panel drives [Codex](https://github.com/openai/codex) on your own
ChatGPT sign-in; any terminal agent (Claude Code, Codex, pi, …) uses the same `toucan` CLI. Both read the
canvas, send JavaScript to the live editor, look at a screenshot, or merge a Mermaid, JSON Canvas or
Excalidraw file in by key. You keep drawing the whole time, and every edit, yours or theirs, lands on
one shared document.

[See it work →](tour.html) · [Every feature →](features.html) · [Click through a canvas →](explore.html) · [Get started →](quickstart.html) · [Source on GitHub ↗](https://github.com/lavallee/toucan)

![The canvas with the chat panel open. Asked for a sequence diagram of a password reset, the agent has drawn four participants and a column of messages between them.](assets/tour/chat.png "A real turn of the chat agent, from a one-line request.")

## For your agent

toucan gives an agent a canvas you can see. It draws diagrams of your code, systems and plans in a browser tab while you watch, and reads back your edits, sticky notes and comments. To set it up, paste this to your agent:

> Install toucan from https://github.com/lavallee/toucan and draw how this project fits together.

**If you're an agent,** this is all you need to start (Node 22+):

```sh
curl -fsSL https://github.com/lavallee/toucan/releases/latest/download/install.sh | sh
toucan init --open    # the canvas for the project you're in, opened in the person's browser
toucan guide          # how to work on it
```

Don't run `npm install toucan`: that's an unrelated package. A one-page brief for agents is at [llms.txt](llms.txt), and the [Agent guide](agents.html) has everything.

## What you can do with it

- **Start from a known shape.** 22 [templates](gallery.html) cover flowcharts, org charts, sequences, architecture, roadmaps, kanban and more, and agents draw their own in the same form.
- **Read a canvas, not just look at it.** Boxes stay short, with the rest a click away. [Walk the Odyssey](explorer.html?map=odyssey) with the arrow keys to see how.
- **Comment where the problem is.** [Threads](tour.html#comment-and-have-it-answered) on a box or region drive their own agent, and a sticky note is a message to one.
- **Grow a diagram by talking to it.** Ask the chat to add a service, regroup a cluster or draw the arrows between two systems. Then fix the layout by hand.
- **Generate a canvas from your own data.** A script reads your inventory, your dependency graph or your notes and upserts shapes by key. It reruns without disturbing what people moved or annotated.
- **Give a canvas behaviour.** *Canvas scripts* are small JavaScript functions stored with a canvas and run whenever it loads: a button, a live overlay, a reaction to edits.
- **Move diagrams between tools.** Export any canvas as JSON Canvas (Obsidian), Mermaid, DOT, `.excalidraw` or toucan's own graph format, and import the first four back.

## The shape of it

```
browser tab ── canvas + chat panel
   ▲ exec relay     ▲ chat relay
   │                │
toucan server (Node)
   ├─ sync room per canvas → data dir
   ├─ canvas scripts       → data dir
   └─ codex app-server (your sign-in)
         └─ runs `toucan …`

terminal agents ── `toucan …` (same path)
```

One small Node server holds a sync room per canvas, relays agent code into the most recently focused
tab, and hosts the chat. Agents never hold a model API key for toucan: the chat runs inside Codex's own
client on your sign-in, and terminal agents bring their own.

## Where to go next

- [See it work](tour.html): the whole thing in screenshots of real runs.
- [Explore](explore.html): click through real canvases, with nothing to install.
- [Gallery](gallery.html): every diagram toucan starts from.
- [Quick start](quickstart.html): install, sign in, and make your first canvas.
- [Agent guide](agents.html): the CLI, the `toucan.*` helpers, and the graph format agents work with.
- [How it works](how-it-works.html): sync, exec routing, the chat relay and the security model.
- [Extending](extending.html): extension commands, deployment notes, configuration and licences.
