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

Each run is made visible and reversible. The tab that runs it records which shapes it added, changed
or removed (from its own store changes). Those shapes glow for a moment, tagged "agent", in that tab, and
the server forwards their ids to the canvas's other tabs, which glow them too. On tldraw the run starts
with a history stopping point, so one Cmd-Z in the tab that ran it undoes the whole run, and two runs in a
row are two steps. (Before, back-to-back runs merged into one undo step.) tldraw's undo is per tab, so
other tabs can't undo it. On Excalidraw each `updateScene` call is an undo step, and an import makes one.

The cost is that `exec` needs a tab open on the canvas, unless the server runs in headless mode (below).
Reads that don't, such as `graph`, use the server's copy, which can trail a tab's edit by a moment.

## Headless mode and the trail

With `--headless` (or `TOUCAN_HEADLESS=1`), the server can be its own tab. When an exec finds no tab on
the canvas, or none acknowledges, the server starts Chromium through Playwright (`playwright-core`, an
optional dependency), opens the ordinary app on that canvas in a fresh in-memory browser context, and
waits for the page's relay socket. The page then syncs, renders and runs agent code exactly like a
person's tab, so edits still go through the real editor, and `screenshot` is a real render.

- **Authentication.** The page gets the token from an init script that writes it to the context's
  local storage, the same place a person's sign-in link puts it; it never appears in a URL. The script
  also sets a random nonce that the page's relay socket presents, so the server knows which socket is
  the page it launched.
- **Priority.** People's tabs are always tried first, most recently focused first; the headless page is
  last. It isn't counted as an open tab in `toucan canvases`, and it doesn't load the chat.
- **Lifetime.** One page per canvas, at most `TOUCAN_HEADLESS_MAX` (default 2) in all; when the cap is
  reached, the least recently used idle page makes room. A page closes `TOUCAN_HEADLESS_IDLE` seconds
  (default 120) after its last exec, and Chromium closes with the last page.
- **Excalidraw** works the same way. A tab, headless or not, now takes agent code only after the
  scene has arrived, so code never runs against an empty canvas.

Headless edits land with nobody watching, which weakens "you watch them land". So the headless page reports
the shapes each exec added, updated and removed (the same record that drives the agent glow, above); the server appends an entry (time, `headless`, what ran, those keys) to
`<data>/<name>.log.jsonl` whenever something changed. `toucan log [--since T]` prints the trail, and a
person opening the canvas sees "N agent edits while you were away" with the list, until they mark it
seen in that browser. Edits made while a person's tab took the exec aren't recorded: they watched.

## Threads

Comment threads are a small file beside each canvas (`<name>.threads.json`), and the server pushes the whole list to
every tab when one changes. Pins and thread cards are drawn in a layer over the canvas, placed through each engine's
coordinates, so they follow shapes and the camera on both engines without touching the document. An anchor is a list of
shape keys or a page region; a shape's last known box is kept, so a thread outlives it. Each thread can have its own
Codex conversation, keyed by canvas and thread, and that conversation's last message in a turn becomes its reply.

## Versions

Each canvas has a directory of gzipped full snapshots beside it (`<name>.versions/`), with an index saying what
each one changed. The server saves one when an exec reports changes, when edits go quiet, when the last tab
leaves, and when someone names one; a save with no change to the shapes is skipped. A person previews a version
in a second, read-only editor instance over the live canvas, so stepping back never touches the shared document.
Restoring saves the present first, then loads the snapshot: on tldraw through the sync room, which reconnects every
tab; on Excalidraw by re-issuing each element at a higher version, so tabs' normal merge accepts it.

## The graph layer

`lib/tg.mjs` defines the *toucan graph* (TG): groups, nodes and edges, each with a stable key, an
optional box, style and meta. Every engine can produce one (`toucan.graph()`) and apply one
(`toucan.applyGraph(tg, { move, prune })`). Converters to and from JSON Canvas, Mermaid flowcharts,
DOT (export only) and `.excalidraw` sit on top, so interchange and engine conversion share one path.

Applying a graph is a keyed upsert. A field the file doesn't carry is left alone. Existing shapes keep
their positions unless asked to move. New shapes without a position are laid out with
[ELK](https://eclipse.dev/elk/) beside the existing content. Nothing is deleted without `prune`.

## The chat

Speed comes first, because someone is watching the canvas. Each message carries a compact brief of the canvas
(built from the server's copy, plus the person's selection and open notes), so the agent's first move can be the
edit rather than a read. Messages that need no judgement skip the model: `/routine-name` and a message that is
only a Mermaid flowchart are applied directly. A message sent mid-turn steers the turn in progress.

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
