# How it works

## One server, many tabs

`server/index.mjs` is a single Node process. It serves the built app, keeps one authoritative document
per canvas, relays agent code into a tab, persists canvases and their scripts, and hosts the chat.

- **tldraw canvases** are [tldraw sync](https://tldraw.dev/docs/sync) rooms held by the server. Every open tab, on any machine, edits the same document live. The server persists it, debounced, to `<data>/<name>.json`.
- **Excalidraw canvases** sync over `/ws/excalidraw`. Tabs send the elements they changed. The server keeps the higher `version` of each element (Excalidraw's own rule, with ties broken by `versionNonce`), persists `<data>/<name>.excalidraw`, and relays to the other tabs, which merge with `reconcileElements`. There are no presence cursors, and images are not synced.
- **The index** at `/` lists every canvas with a preview. A visible tab uploads the preview a few seconds after the canvas changes. Titles and descriptions live in `<data>/_index.json`. Archiving moves a canvas's files into `<data>/.archive/`; nothing is deleted.

## The exec relay

Agents don't touch the document directly. `toucan exec` posts JavaScript to the server, which sends it
to the most recently focused tab on that canvas. The tab runs it against the live editor and returns
the result. A tab that doesn't acknowledge within 2.5 seconds (asleep, crashed, stale build) is skipped
for the next one. Because edits go through a real editor, agent changes obey the same constraints, undo
history and sync as yours, and you watch them land.

The cost is that `exec` needs a tab open on the canvas. Reads that don't, such as `graph`, use the
server's copy, which can trail a tab's edit by a moment.

## The graph layer

`lib/tg.mjs` defines the *toucan graph* (TG): groups, nodes and edges, each with a stable key, an
optional box, style and meta. Every engine can produce one (`toucan.graph()`) and apply one
(`toucan.applyGraph(tg, { move, prune })`). Converters to and from JSON Canvas, Mermaid flowcharts,
DOT (export only) and `.excalidraw` sit on top, so interchange and engine conversion share one path.

Applying a graph is a keyed upsert. A field the file doesn't carry is left alone. Existing shapes keep
their positions unless asked to move. New shapes without a position are laid out with
[ELK](https://eclipse.dev/elk/) beside the existing content. Nothing is deleted without `prune`.

## The chat

The chat panel talks to one `codex app-server` child process over stdio JSON-RPC, with one Codex thread
per canvas. Codex runs on the machine's ChatGPT sign-in (`codex login`); toucan never holds a model key.
It edits the canvas the same way a terminal agent does, by running the CLI, so both share one path.
Codex runs with `workspace-write` rooted at the checkout, network access for the loopback CLI, and
`on-request` approval. Anything outside its sandbox shows up as allow/deny buttons in the panel.

The UI is React 19 with shadcn/ui; the chat follows shadcn's AI Elements patterns. Tailwind's preflight
is scoped to `.toucan-ui` and layered beneath tldraw's CSS, so toucan's own styling never reaches the
canvas.

## Security model

The exec relay runs arbitrary JavaScript in your browser, and the chat drives an agent that has a
shell. So every HTTP request and WebSocket needs the server's token, which is created on first start in
`~/.config/toucan/server.json` (mode 0600) and compared in constant time. The server listens on
loopback by default. Bind it wider only on a network you trust, and put it behind HTTPS if it leaves
your machine. To rotate the token, delete its `token` field and restart.
