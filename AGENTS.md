# toucan — agent guide

toucan is a tldraw canvas in a browser tab. You change it by sending JavaScript to the live editor
through the toucan CLI. A human is looking at it and editing it by hand at the same time: inspect
before you change, keep edits small, and never wipe their work.

## CLI

In the chat panel you run it as `node bin/toucan.mjs` from the install directory. Anywhere else it's `toucan`.

```
node bin/toucan.mjs init [NAME] [--title T] [--template ID] [--engine E] [--open]   # find or make the canvas for the project you're in; later commands there use it
node bin/toucan.mjs open [NAME]                            # open it in the person's browser, signed in
node bin/toucan.mjs --canvas NAME summary [--within KEY]   # JSON of shapes (key, type, bounds, text, from/to)
node bin/toucan.mjs --canvas NAME exec -e 'CODE'           # run JS in the editor; `return` a JSON value
node bin/toucan.mjs --canvas NAME exec FILE.js             # same, from a file (use for anything > 1 line); --label names it in the history
node bin/toucan.mjs --canvas NAME screenshot [OUT.png]     # look at it (prints where it wrote; <=1800px)
node bin/toucan.mjs --canvas NAME script list|put NAME FILE|rm NAME   # persistent canvas scripts
node bin/toucan.mjs canvases                               # every canvas: title, description, shapes, open tabs
node bin/toucan.mjs new NAME --title T [--engine tldraw|excalidraw] [--from CANVAS|FILE] [--canvas-format F]   # make a canvas
node bin/toucan.mjs --canvas NAME graph [--format tg|jsoncanvas|mermaid|dot|excalidraw] [OUT]   # export; no tab needed
node bin/toucan.mjs --canvas NAME import FILE|- [--format F] [--move] [--prune] [--propose] [--label T]   # keyed upsert of a graph file
node bin/toucan.mjs --canvas NAME meta --title T --description D [--canvas-format F]   # retitle / describe a canvas
node bin/toucan.mjs --canvas NAME proposals [accept|reject [KEY...]]   # dashed = proposed (see below)
node bin/toucan.mjs --canvas NAME selection                # what people selected: resolve "this" / "these"
node bin/toucan.mjs --canvas NAME notes [--all]            # sticky notes left for you, with what they're on/near
node bin/toucan.mjs --canvas NAME notes resolve KEY --reply TEXT   # mark one handled (green + reply)
node bin/toucan.mjs --canvas NAME log [--since 2h]           # edits agents made while nobody had it open
node bin/toucan.mjs --canvas NAME say TEXT [--at KEY,KEY]   # tell people what you're about to do; point at shapes
node bin/toucan.mjs --canvas NAME versions [save LABEL | show N [--format F] | restore N]   # the canvas's history
node bin/toucan.mjs routine list | show NAME | save NAME FILE [--title T] [--description D] [--engines E] | rm NAME   # the routine bank
node bin/toucan.mjs --canvas NAME routine run NAME [--args JSON]   # run a banked routine: one undo step, on the history
node bin/toucan.mjs --canvas NAME files                     # where this canvas keeps what agents write for it
node bin/toucan.mjs --canvas NAME references                # what people can read beside the canvas: its files, its project's, links on it
node bin/toucan.mjs --canvas NAME show REF|PATH|URL           # open it for people in the References panel
node bin/toucan.mjs profiles                                   # the named agents a canvas can work with, from every source
node bin/toucan.mjs --canvas NAME meta --profile SOURCE/ID|none   # work on the canvas with one: its knowledge, briefing and skills
node bin/toucan.mjs --canvas NAME profile                     # the agent the canvas works with: what it reads at the start, and its skills
node bin/toucan.mjs templates                                  # diagrams to start from; `new NAME --template ID` makes one
node bin/toucan.mjs templates show ID                          # a template's description, to copy the form of
node bin/toucan.mjs --canvas NAME draw FILE|- [--update] [--move] [--label T]   # lay out a diagram described as data onto a canvas
node bin/toucan.mjs --canvas NAME threads [--all] | show N | new TEXT --on KEY,KEY | --region X,Y,W,H [--ask] | reply N TEXT [--ask] | close N [--reply T] | reopen N | adopt-notes   # comment threads
```

There can be many canvases, each on one engine (tldraw or Excalidraw); name one with `--canvas` or `TOUCAN_CANVAS`, or be inside a project
that `init` has linked to one. From a terminal agent, start with `toucan init --open` and tell the person what you're drawing. `init` adds
nothing to the repository; to keep a diagram there, write it out with `graph`. The server starts itself when a command needs it. In the chat
panel, work on the canvas the chat belongs to unless the user names another. Never archive a canvas unless asked.

Any other command `X` runs an extension, `toucan-X`, from PATH. A deployment can add its own agent notes as `AGENTS.md`
in its data directory; the chat agent is told where they are.

`versions` and the routine bank work against the server alone; `routine run` needs a tab like `exec`.

Exec code is the body of an async function with `editor` (tldraw Editor), `tl` (the tldraw module)
and `toucan` (helpers below) in scope. It needs an open browser tab on that canvas, unless the server
runs in headless mode.

## Headless mode

A server started by toucan has this on; one a person runs themselves has it only if started with `--headless`. Then `exec`, `summary`, `screenshot` and `import` still work
when nobody has the canvas open: the server opens it in headless Chromium, using the browser already on the machine (the first call takes a
second or two), and closes it when idle. A person's tab is always used first. `toucan canvases` shows
`open` (people's tabs) and `headless` (whether the server's page is up). Without headless mode, those
commands fail with "no browser tab has canvas … open"; open it with `toucan open NAME`, or ask the person to open the link from
`toucan url --canvas NAME`.

Nobody watches a headless edit land, so each one goes on the canvas's trail, and the next person to
open the canvas is told how many there were. Make them easy to read: one purpose per exec, keyed
shapes, and an `import` of a named Mermaid file rather than an opaque blob of code.

## "This": what people have selected

When a person says "this", "these" or "that box", look at what they selected before guessing:
`toucan --canvas NAME selection` gives `here` (the selection in the tab your code runs in, which is the
person's most recently focused tab) and, on tldraw, `others` (each other person's selection, by name,
from live presence). `summary` also carries `selected` (keys) when anything is. If nothing is selected
and the reference is unclear, ask. In exec code: `toucan.selection()`. Excalidraw tabs share no presence,
so there `others` is always empty.

## Threads: comments on shapes and regions

People attach comments to a shape (or several) or a region of the page, and each one is a **thread**: a
back-and-forth that someone eventually closes. Threads live beside the canvas, not in it, so they work on both engines
and with no tab open, survive undo and version restores, and stay out of exports. The brief at the top of a chat
message lists the open ones.

- `toucan --canvas NAME threads` lists the open ones, each with `attached`: the shapes it's on as they are now, or what's
  inside its region. `threads show N` is one thread; `--all` includes closed ones.
- `threads reply N "what I did or found"` answers. The CLI speaks as the agent unless told `--as NAME`.
- `threads new "worth checking" --on KEY` raises something yourself, on a shape or `--region X,Y,W,H`.
- `threads close N --reply "done"` closes one. **Leave that to people** unless they ask, or it was your own.
- `threads adopt-notes` brings sticky notes in as threads attached to them, once each. The notes stay.

A person chooses who each message is for. **Agent** starts or steers that thread's own agent conversation, whose last
message in a turn becomes its reply there, so several threads can be worked at once. **Main chat** sends it to the chat
panel, where it adjusts the turn in progress if one is running; answer that with `threads reply`. **People** leaves it
for people. A reply in a closed thread reopens it.

## Notes: sticky notes addressed to you

On tldraw, **every sticky note (`note` shape) is addressed to the agent.** People pin one where a problem
is ("same thing? merge", "missing: thumbnail step") instead of describing it in chat, so its position is
part of the message. When asked to handle the notes:

1. `toucan --canvas NAME notes` lists the open ones: key, text, box, the frame it is `inside`, the shapes
   it is `on` (overlaps) and the ones `near` it (gap in px, and which side). Read "these" and "here" from
   that: a note between two boxes is about those two; one in empty space is about a step to add there.
2. Act on each note with your usual tools (`import`, `exec`), one note at a time.
3. `toucan --canvas NAME notes resolve KEY --reply "merged Blog and Cut-down into Publish"` marks it done:
   it turns green and gains your one-line reply. **Never delete or move a note.** If one is unclear, don't
   resolve it: ask the person about it and leave it open.

`notes --all` includes resolved ones; `summary` reports `openNotes` when there are any. In exec code:
`toucan.notes({all})` and `toucan.resolveNote(key, reply)`. Don't use note shapes for your own diagram
content (use `node`); a note is a person's message. Excalidraw has no sticky note, so notes are
tldraw-only for now.

## Proposals: dashed = proposed

When the person asks for an opinion or a broad change ("this isn't really a straight line", "what's
missing?"), answer on the canvas as a **proposal** they can take or leave, not as a finished edit:

- `toucan --canvas NAME import plan.mmd --propose`: what the import adds arrives dashed, as a proposal
  (what it updates is changed as usual).
- In exec code: `toucan.node(key, {..., proposed: true})`, `toucan.edge(a, b, {..., proposed: true})`, or
  `toucan.propose(...keys)` for shapes that already exist.

A proposal is drawn dashed and carries `meta.proposed` (Excalidraw: `customData.proposed`); a shape the
person drew dashed is not one. Frames, notes and text can't be dashed, so they can't be proposed. The
person sees a bar above the canvas with **Accept** (drawn solid again) and **Reject** (removed) for the
selected proposals, or all of them. Leave that choice to them: run `toucan proposals accept|reject
[KEY...]` only when asked. `toucan proposals` lists what is still open.

## What people see: presence and undo

- **New shapes come into view.** On tldraw, a run that adds shapes outside the view fits the canvas in view,
  unless the person is mid-gesture, so don't call `zoomTo` just to show your work.
- **People see you at work.** While you're busy on a canvas, every open tab shows it: a pill above the
  canvas with your name and what your current call does ("reading the notes", "importing plan.mmd", or
  your `--label`), a soft ring round the canvas, and your cursor on the shape you last changed or pointed
  at. It stays up for a few seconds after your last call, so the gaps while you think don't flicker. Name
  yourself with `--agent NAME` or `TOUCAN_AGENT` (the chat panel's agent is "Codex"; the default is "agent").
- **Say what you're about to do.** Before a change of several steps, or one that touches something the
  person is working on, run `toucan say "Merging Sign-in and Login page" --at sign_in,login_page`. Your
  line replaces the call's description in the pill and on your cursor, and `--at` moves your cursor to
  those shapes (and glows them), so the person sees the plan before the edit lands. Keep it short and
  concrete, one line per step, not a running commentary.
- **Your edits glow.** Shapes an exec adds or changes get a short violet halo, tagged with your name, in
  every open tab (both engines). `toucan.pulse(keys)` does the same on demand, to point at something.
- **One exec is one undo step** on tldraw: one Cmd-Z in the tab that ran it undoes the whole run, and it
  never merges with the person's previous action. So make one exec per idea (a feature, a fix) rather
  than many tiny ones, or one large one that mixes unrelated changes. Undo is per tab: another tab's
  Cmd-Z doesn't undo your run. On Excalidraw each `updateScene` call is its own undo step
  (`applyGraph` makes one), so batch your element changes into a single `updateScene`.

## Graphs: the engine-neutral path

A canvas reads and writes as a *toucan graph* (TG, `lib/tg.mjs`): `groups` (frames), `nodes` (boxes) and
`edges` (arrows), each with a stable `key`, optional `box` (page coordinates), `style` (tldraw's
vocabulary: color, fill, dash, geo) and `meta`. Every engine's `toucan` has `graph()` and
`await applyGraph(tg, {move, prune})`, and the CLI's `graph`/`import` speak TG, JSON Canvas (Obsidian),
Mermaid flowcharts, DOT (export only) and `.excalidraw`.

- **Import is a keyed upsert.** Existing shapes get only the fields the file carries and keep their
  position unless `--move`; a missing field means "leave it" (a bare Mermaid reference `a --> b` doesn't
  relabel `a`; a node outside any subgraph keeps its frame). New shapes without a position are laid out
  with ELK beside the existing content, or below what they connect to. Arrows match by endpoints (`edge:<from>-><to>`). Nothing is
  deleted without `--prune`.
- **Mermaid is a good edit language** for structure: write a small flowchart of what to add or relabel
  and `import` it. Use `exec` with the engine's own API for styling or anything TG can't say.
- `graph` reads the server's copy, which can trail an edit a tab made a moment ago.

## Engines

- **tldraw** (default): `editor` is the tldraw Editor, `tl` the tldraw module; full helpers below.
- **Excalidraw**: `editor` is the ExcalidrawImperativeAPI (`getSceneElements()`, `updateScene({elements,
  captureUpdate})`, …), `tl` the `@excalidraw/excalidraw` module. `toucan` has the core only: `summary`,
  `graph`, `applyGraph`, `screenshot`, `zoomTo`, `get`, `remove`, `text`, `keyOf`. A shape's key is its
  `customData.key` (falling back to its id). Change elements with `tl.newElementWith(el, {...})`, which
  bumps the version so the edit syncs to other tabs; prefer `applyGraph` for structure. Import doesn't move an existing element into a different frame there (it does on tldraw); reparent it with `frameId` yourself.
- Converting a canvas between engines is `new NAME --engine E --from CANVAS` (through TG: keys, text,
  grouping, arrows, meta and positions survive; engine-specific styling is approximated).

## Helpers (`toucan.*`) — prefer these; they are idempotent by key

- `node(key, {x,y,w,h,text,geo,color,fill,dash,size,parent,meta,move,proposed})` — create/update a box. An existing
  box changes only in what you pass, and keeps its position unless `move: true`. A new box with no position goes
  somewhere free. `parent` is a frame key; x/y are then frame-relative.
- A frame, like a box, changes only in what you pass.
- `frame(key, {x,y,w,h,name,color})`, `edge(fromKey, toKey, {text,color,dash,kind,bend,proposed})` — bound arrow.
- `propose(...keys)`, `proposals()`, `accept(...keys)`, `reject(...keys)` — see Proposals.
- `get(key)`, `idFor(key)`, `text(shape)`, `find(q)`, `summary({within})`, `remove(...keys)`, `zoomTo(keys?)`, `pulse(keys)`
- `await layout(keys | null, {within: frameKey, direction: 'RIGHT'|'DOWN', spacing, layerSpacing})` — ELK.

Colours: black grey light-violet violet blue light-blue yellow orange green light-green light-red red white.
Fill: none semi solid pattern. Dash: draw solid dashed dotted. Size: s m l xl.

Plain tldraw also works: `editor.updateShapes([...])`, `editor.createShape({...})` — but always pass
`parentId` (a frame id or `editor.getCurrentPageId()`), or tldraw drops new shapes into whatever frame
is under them. Text uses rich text: `props.richText = tl.toRichText('…')`.

## Templates and layout: don't place boxes by hand

Most diagrams are a known shape. `toucan templates` lists the roster, each a realistic sample you can edit: flowchart, swimlane, org chart, decision
tree, mind map, sequence, layered architecture, service map, network, entity relationships, state machine, build pipeline, roadmap, timeline, kanban,
2x2, customer journey, responsibility chart, comparison table, fishbone, funnel and cycle. `toucan new NAME --template ID` makes one with the right
format; then change its boxes with `toucan.node`, or `import` more.

To draw on a canvas you're already on, describe the diagram as data and let the engine place it: `toucan templates show flowchart` shows the form,
and `toucan --canvas NAME draw plan.json` lays it out beside what's there. Each `kind` (flow, tree, mindmap, lanes, grid, board, quadrant, timeline, gantt,
sequence, fishbone, funnel, stack, cycle) has its own fields, and a box's `detail` is what opens on click. A new drawing never overwrites what's there: if its keys clash it takes a prefix, which the command reports. To change an earlier drawing, draw it again with `--update`, and `--move` to reposition its boxes too.

`toucan.measure()` measures the diagram as drawn and returns a `score` out of 100 and `findings`, each naming the shapes involved: overlaps, text that
outgrew its box, arrows through boxes, crossings, labels on boxes, boxes cut off by a frame. `routine run check-diagram` reports the same and points at
the shapes. Use it after a layout change: it's faster than a screenshot and says exactly what to fix. What a good diagram has, roughly in order: nothing
overlapping or cut off; arrows that don't run through boxes; boxes of a kind that match and line up; one direction of flow; short titles, with the rest in
`meta.detail`; and text you can read when the whole diagram fits on screen.

## Formats and details: short boxes, with the rest a click away

A box should be short: a name or a title. What's behind it goes in `meta.detail` (`toucan.node(key, {meta: {detail: '…'}})`), which
opens in a card when someone selects the box. `meta.see` is a list of `{key, label}` cross-references, shown as jumps in that card, which
keeps long arrows off the canvas. A thread on a box tells its agent the box's detail.

A canvas can have a **format**, set with `toucan meta --canvas-format story|ideas|process|hierarchy|timeline|board|system|none` or `new --canvas-format`. It moves nothing. It says how to
move through the canvas with ← and → in that card, and tells agents how to behave there, through the brief:

- **story**: one path; ← → follow the arrows. Answers go as dashed branches beside the stop.
- **ideas**: frames are ideas and a gap means something; ← → move along a frame. Don't fill gaps.
- **process**, **hierarchy**: steps and decisions, or a tree; ← → follow arrows.
- **timeline**, **board**: a position means something; ← → move along a frame or row.
- **system**: named parts and real connections; ← → follow arrows, and the card lists the choices where they branch. Zoomed out on tldraw, people see frames and
  how many connections run between them, and a frame opens on click. That's only what they see: `summary`, `graph`, `screenshot` and exports still have every shape.

Solid arrows are the way through, so proposals and dotted arrows are skipped when walking. The **Air out** routine (`routine run air-out`, tldraw)
converts a dense diagram: long text moves to `meta.detail`, names get larger, and things spread a little. Run it only when asked. Region threads keep their position, so they may need re-anchoring afterwards.

## Files: what you write for a canvas

Research, notes and helper scripts for a canvas go in `<data>/<name>.files/` (`toucan --canvas NAME files` gives the
path and what's there). Chat and thread agents can write there and not elsewhere in the data directory. Name the file in your reply so people can find it. The folder is
archived with the canvas.

## References: what people read beside the canvas

The **References** panel shows reference material without leaving the canvas: what you've written for it, the project it belongs to, and
pages on the web. A reference is `files/PATH` (this canvas's files folder), `project/PATH` (the project `init` linked the canvas to), or
`https://…`. Markdown renders, with its relative links and images working; so do PDFs, images, CSV tables, code and text. A web page is
fetched by the server and shown without running its scripts. Hidden files, build folders and anything outside those two folders can't be
read, and the server won't fetch pages on this machine or a private network.

- `toucan --canvas NAME show files/research.md` (or a path inside either folder, or a URL) opens it for everyone looking at the canvas. Do
  this after you write research or notes, or to put a source in front of someone. `toucan references` lists what can be shown.
- Point a box at what's behind it with `meta.refs`: `toucan.node(key, {meta: {refs: [{ref: 'project/docs/auth.md', label: 'How sign-in works'}]}})`.
  The box's details card lists them, and web addresses in `meta.detail` open in the panel too. People can also paste links onto the
  canvas: clicking one opens it beside the canvas.

## Profiles: working with a named agent

A canvas can work with a particular agent rather than toucan's general-purpose one: a CEO agent with its charter, a researcher with
its notebook. That agent is a **profile**: who it is, its own folder, what it reads at the start of a conversation, its skills, and the
folders people may read beside the canvas. Bind a canvas to one with `toucan meta --profile SOURCE/ID`
or the picker in the chat panel's header, and the canvas's chat and comment threads become that agent: its briefing and starting
context are loaded, people see its name on the canvas, and its shared folders appear in References as `agent/…`. Switching starts a new
conversation; each agent's earlier one is kept. `--profile none` goes back to toucan's own agent.

Profiles come from sources. `<data>/_profiles/ID.json` is `local/ID`. Any program on PATH named `toucan-profiles-NAME` is a source too:
it answers `list` with `{"profiles": [{"id", "name", "description"}]}` and `get ID` with a profile, so a registry of agents plugs in
without toucan knowing about it. A profile (`toucan.profile/1`):

```json
{ "name": "Kiefer", "description": "Foundation strategy research", "workdir": "/home/me/Projects/kiefer",
  "instructions": "Who you are, how you work, and what you may and may not do.",
  "context": [{ "path": "AGENTS.md" }, { "path": "notebooks/strategy/CHARTER.md", "label": "Charter" }],
  "skills": [{ "path": "skills/board-brief" }],
  "references": ["notebooks/strategy/questions"],
  "budget": 24000 }
```

Paths are relative to `workdir`. Context and shared folders must be inside it and not hidden, and context is read within `budget`
characters, with anything missing reported. A profile grants no writing: the agent writes in the canvas's files folder like any chat
agent, since anyone who can reach the server can bind a profile. Sources are only looked for in PATH folders an agent can't write to.
`toucan profiles` lists every source's profiles, and `toucan --canvas NAME profile` shows what the bound one reads and its skills.

## Versions: the evolution of a canvas

The server keeps a history of every canvas, on both engines, with or without a tab open. A version is saved
after an exec that changed something (runs in quick succession share one), when a person's edits go quiet (30 seconds, or every 5 minutes of
steady editing), when the last tab leaves, and when anyone names one. People step through them read-only in
the **History** panel, where the live canvas keeps running underneath.

- `toucan --canvas NAME versions` lists them, newest first: number, time, label, source, what changed.
- `versions save "before the reorg"`: name this moment before a sweeping change. Named versions are never thinned.
- `versions show N --format mermaid`: read an old version as a graph (any export format), to compare or recover part of it.
- `versions restore N`: put it back, for every open tab (they reconnect). **Only when asked.** What was there is
  saved first and a restore is a version too, so a restore can itself be undone by restoring the one before it.

Give an exec a `--label` ("colour the blocked boxes") so it reads well in the history; `import` and routines
label themselves. Old automatic versions are thinned: all of the last day, hourly for a week, daily after that.
Scripts, titles and chat threads aren't versioned.

## Routines: chores worth keeping

A **routine** is a chore banked once and run on any canvas, from the person's **Routines** menu or the CLI. A
canvas script is lasting behaviour on one canvas (a button, an overlay, a reaction); a routine runs once, when
asked, anywhere. toucan ships a set for tidying (`clean-up`, `lay-out-again`, `align-boxes`, `distribute-evenly`, `match-sizes`, `fix-overlaps`, `fit-frames`, `neat-arrows`, `tidy-arrows`, `straighten-lines`, `colour-by-frame`, `air-out`) and one for checking (`check-diagram`). `routine list` has what each does. Prefer `clean-up` when someone says "tidy this": it keeps their arrangement; `lay-out-again` rearranges everything.

```js
// routine: Colour the blocked boxes
// description: Turn every box mentioning "blocked" red.
// engines: tldraw

const hits = editor.getCurrentPageShapes().filter((s) => s.type === 'geo' && /blocked/i.test(toucan.text(s)))
editor.updateShapes(hits.map((s) => ({ id: s.id, type: s.type, props: { color: 'red' } })))
return { summary: `${hits.length} boxes coloured` }
```

It is the body of an async function with `editor`, `tl`, `toucan` and `args` in scope, and it runs through the
exec path: one undo step, glowing edits, a labelled version. The `summary` it returns is what the person sees.

- **When a person says "bank that", or keeps asking for the same chore:** write it to a file, try it with
  `exec`, then `toucan routine save NAME FILE --title "…" --description "…" --engines tldraw`. It must work
  from what it finds on the canvas, not from this conversation. Banked routines live in `<data>/_routines/`,
  shared by every canvas on the server; banking under a shipped routine's name replaces it there.
- **Before doing a chore by hand:** check `routine list`, then `toucan --canvas NAME routine run NAME`.
- Never remove a routine you didn't bank unless asked.

## Canvas scripts (growing features)

A script is a function body run in the browser with `editor`, `tl`, `toucan` whenever the canvas
loads or scripts change; it may return a cleanup function. Use it for lasting behaviour (a button,
a live overlay, a reaction to edits). Example:

```js
const off = editor.sideEffects.registerAfterChangeHandler('shape', (prev, next) => { /* … */ })
return () => off()
```

For a chore someone runs now and then, like cleaning up arrows, bank a routine instead (above); a script is for behaviour that should always be there.
