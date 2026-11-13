# Agent guide

This page mirrors [`AGENTS.md`](https://github.com/lavallee/toucan/blob/main/AGENTS.md), the guide
agents read in the repo. The ground rule: a person is looking at the canvas and editing it by hand at the
same time. Inspect before you change, keep edits small, and never wipe their work.

## The CLI

```
toucan --canvas NAME summary [--within KEY]     # JSON of shapes (key, type, bounds, text, from/to)
toucan --canvas NAME exec -e 'CODE'             # run JS in the editor; `return` a JSON value
toucan --canvas NAME exec FILE.js               # same, from a file (use for anything > 1 line)
toucan --canvas NAME screenshot [OUT.png]       # look at it (<=1800px)
toucan --canvas NAME animate [OUT.gif]          # a GIF of the diagram building up, box by box along the arrows
toucan --canvas NAME script list|put NAME FILE|rm NAME   # persistent canvas scripts
toucan canvases                                 # every canvas: title, description, shapes, open tabs
toucan new NAME --title T [--engine tldraw|excalidraw] [--from CANVAS|FILE] [--canvas-format F]
toucan --canvas NAME graph [--format tg|jsoncanvas|mermaid|dot|excalidraw] [OUT]   # no tab needed
toucan --canvas NAME import FILE|- [--format F] [--move] [--prune] [--propose] [--label T]   # keyed upsert of a graph file
toucan --canvas NAME meta --title T --description D [--canvas-format F]
toucan --canvas NAME proposals [accept|reject [KEY...]]   # dashed = proposed
toucan --canvas NAME selection                  # what people selected: resolve "this" / "these"
toucan --canvas NAME notes [--all]              # sticky notes left for you, with what they're on/near
toucan --canvas NAME notes resolve KEY --reply TEXT   # mark one handled (green + reply)
toucan --canvas NAME log [--since 2h]           # edits agents made while nobody had it open
toucan --canvas NAME say TEXT [--at KEY,KEY]   # tell people what you're about to do; point at shapes
toucan --canvas NAME versions [save LABEL | show N [--format F] | restore N]   # the canvas's history
toucan routine list [--kind K] | show NAME | save NAME FILE [--title T] [--description D] [--engines E] [--kind K] [--when T] | rm NAME   # the routine bank, by kind
toucan routine suggest [--since 30d] | stats | learn --codex   # chores done by hand worth banking; how routines are used; past chat work
toucan --canvas NAME routine run NAME [--args JSON]   # run a banked routine: one undo step, on the history
toucan --canvas NAME files                     # where this canvas keeps what agents write for it
toucan --canvas NAME references                # what people can read beside the canvas: its files, its project's, links on it
toucan --canvas NAME show REF|PATH|URL           # open it for people in the References panel
toucan profiles                                   # the named agents a canvas can work with, from every source
toucan profiles add ID --workdir DIR [--context F,F]   # a profile of your own, from the agent's folder (starts from its AGENTS.md)
toucan --canvas NAME meta --profile SOURCE/ID|none   # work on the canvas with one: its knowledge, briefing and skills
toucan --canvas NAME profile                     # the agent the canvas works with: what it reads at the start, and its skills
toucan plugins                                    # every plugin on PATH by kind (agent profiles, plan sources), and any refused, with why
toucan sources                                    # where plans come from: the file source and toucan-source-* plugins, with what each lists
toucan --canvas NAME plan [bind SOURCE REF [--views board,gantt] | unbind | sync | dismiss]   # the plan a canvas shows views of
toucan --canvas NAME plan catalog | views | view add KIND [options] | view set ID [options] | view put FILE|- | view rm ID [--keep]
toucan --canvas NAME plan items [--json] | set ITEM field=value... | add --title T [field=value...]   # the work itself, written upstream
toucan templates                                  # blocks and starters; `new NAME --template ID` makes a canvas from one
toucan --canvas NAME add ID                       # add a block or starter beside what's on the canvas
toucan templates show ID                          # a template's description, to copy the form of
toucan --canvas NAME draw FILE|- [--update] [--move] [--label T]   # lay out a diagram described as data onto a canvas
toucan --canvas NAME threads [--all] | show N | new TEXT --on KEY,KEY | --region X,Y,W,H [--ask] | reply N TEXT [--ask] | close N [--reply T] | reopen N | adopt-notes   # comment threads
```

`--canvas` can also come from `TOUCAN_CANVAS`. `exec`, `summary`, `screenshot` and `import` need a
browser tab open on the canvas, unless the server runs in headless mode; `graph`, `canvases`, `new`,
`meta`, `log`, `versions` and the routine bank work against the server alone; `routine run` needs a tab like `exec`.

## Headless mode

If the server was started with `--headless`, `exec`, `summary`, `screenshot` and `import` still work
when nobody has the canvas open: the server opens it in headless Chromium (the first call takes a
second or two) and closes it when idle. A person's tab is always used first. `toucan canvases` shows
`open` (people's tabs) and `headless` (whether the server's page is up). Without headless mode, those
commands fail with "no browser tab has canvas … open"; ask the person to open the link from
`toucan url --canvas NAME`.

Nobody watches a headless edit land, so each one goes on the canvas's trail, and the next person to
open the canvas is told how many there were. Make them easy to read: one purpose per exec, keyed
shapes, and an `import` of a named Mermaid file rather than an opaque blob of code.

Exec code is the body of an async function with `editor` (the engine's editor API), `tl` (the engine's
module) and `toucan` (the helpers below) in scope.

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
vocabulary: color, fill, dash, geo; an arrow's also route, anchors, bend, elbowMid) and `meta`. Every engine's `toucan` has `graph()` and
`await applyGraph(tg, {move, prune})`, and the CLI's `graph`/`import` speak TG, JSON Canvas (Obsidian),
Mermaid flowcharts, DOT (export only) and `.excalidraw`.

- **Import is a keyed upsert.** Existing shapes get only the fields the file carries and keep their position unless `--move`; a missing field means "leave it" (a bare Mermaid reference `a --> b` doesn't relabel `a`; a node outside any subgraph keeps its frame). New shapes without a position are laid out with ELK beside the existing content, or below what they connect to. Arrows match by endpoints (`edge:<from>-><to>`). Nothing is deleted without `--prune`.
- **Mermaid is a good edit language** for structure: write a small flowchart of what to add or relabel and `import` it. Use `exec` with the engine's own API for styling or anything TG can't say.
- `graph` reads the server's copy, which can trail an edit a tab made a moment ago.
- **Arrows go round boxes.** An arrow an import or a `draw` adds that would run through a box is routed round it, as the engine draws it (`lib/route.mjs`): an elbow out of other sides, or with its middle run (`elbowMid`, 0..1 across the gap) moved, or a gentle curve; a label another arrow crosses slides along its own arrow (tldraw). An elbow only goes round the outside of its own two ends, so in a `draw` flow a loop back against the flow leaves and arrives on the right (running down) or the bottom (running across), with its ends put at the edge of what it passes. Arrows already on the canvas are left alone; `routine run tidy-arrows` or `clean-up` reroutes those.

## Engines

- **tldraw** (default): `editor` is the tldraw Editor, `tl` the tldraw module; full helpers below.
- **Excalidraw**: `editor` is the ExcalidrawImperativeAPI (`getSceneElements()`, `updateScene({elements, captureUpdate})`, …), `tl` the `@excalidraw/excalidraw` module. `toucan` has the core: `summary`, `graph`, `applyGraph`, `screenshot`, `zoomTo`, `get`, `remove`, `text`, `keyOf`, and the same `measure()`, `tidy` and `scene` as tldraw (so every shipped routine runs there too). A shape's key is its `customData.key` (falling back to its id). Change elements with `tl.newElementWith(el, {...})`, which bumps the version so the edit syncs to other tabs; prefer `applyGraph` for structure. Import doesn't move an existing element into a different frame there (it does on tldraw); reparent it with `frameId` yourself.
- Converting a canvas between engines is `new NAME --engine E --from CANVAS` (through TG: keys, text, grouping, arrows, meta and positions survive; engine-specific styling is approximated).

## Helpers

The `toucan.*` helpers are idempotent by key; prefer them to raw editor calls.

- `node(key, {x, y, w, h, text, geo, color, fill, dash, size, parent, meta, move, proposed})` — create/update a box. An existing box changes only in what you pass, and keeps its position unless `move: true`. A new box with no position goes somewhere free. `parent` is a frame key; x/y are then frame-relative.
- A frame, like a box, changes only in what you pass.
- `frame(key, {x, y, w, h, name, color})`, `edge(fromKey, toKey, {text, color, dash, kind, bend, proposed})` — bound arrow.
- `propose(...keys)`, `proposals()`, `accept(...keys)`, `reject(...keys)` — see Proposals.
- `get(key)`, `idFor(key)`, `text(shape)`, `find(q)`, `summary({within})`, `remove(...keys)`, `zoomTo(keys?)`, `pulse(keys)`
- `await layout(keys | null, {within: frameKey, direction: 'RIGHT' | 'DOWN', spacing, layerSpacing})` — ELK.

Colours: black grey light-violet violet blue light-blue yellow orange green light-green light-red red white.
Only these (and tldraw's geo shapes: rectangle, ellipse, diamond, oval, cloud, hexagon…) work: `node` and `edge` refuse anything else by name,
`draw` refuses it before drawing, and `applyGraph`/`import` use the default instead and list what they changed in `styleFallbacks`.
Fill: none semi solid pattern. Dash: draw solid dashed dotted. Size: s m l xl.

Plain tldraw also works: `editor.updateShapes([...])`, `editor.createShape({...})` — but always pass
`parentId` (a frame id or `editor.getCurrentPageId()`), or tldraw drops new shapes into whatever frame
is under them. Text uses rich text: `props.richText = tl.toRichText('…')`.

## Templates and layout: don't place boxes by hand

Most diagrams are a known shape, and a canvas *has* diagrams rather than *being* one. `toucan templates` lists two sorts, each a realistic
sample you can edit:

- **Blocks**, one diagram each, in groups: processes (flowchart, swimlane, sequence, state machine, build pipeline, funnel, cycle, SIPOC),
  structures (org chart, decision tree, mind map, OKR tree), systems (layered architecture, service map, network, entity relationships), time
  (roadmap, timeline), work (kanban, customer journey, responsibility chart, retro, empathy map, story map) and decisions (2x2, comparison table,
  fishbone, pros and cons, SWOT, stakeholder map, Eisenhower, five whys, decision log).
- **Starters**, a whole canvas on one subject made of several blocks under their own headings: system design, incident review, product strategy,
  project kickoff, research plan, team retro.

`toucan new NAME --template ID` makes a canvas from either, with the right format. `toucan --canvas NAME add ID` puts one beside what's already on a
canvas, on either engine, and never over it: if its keys clash it takes a prefix, which the command reports. People do the same from **Add** above
the canvas. Then change its boxes with `toucan.node`, or `import` more.

To draw on a canvas you're already on, describe the diagram as data and let the engine place it: `toucan templates show flowchart` shows the form,
and `toucan --canvas NAME draw plan.json` lays it out beside what's there. Each `kind` (flow, tree, mindmap, lanes, grid, board, quadrant, timeline, gantt,
sequence, fishbone, funnel, stack, cycle) has its own fields, and a box's `detail` is what opens on click. A new drawing never overwrites what's there: if its keys clash it takes a prefix, which the command reports. To change an earlier drawing, draw it again with `--update`, and `--move` to reposition its boxes too.

`toucan.measure()` measures the diagram as drawn and returns a `score` out of 100 and `findings`, each naming the shapes involved: overlaps, text that
outgrew its box, arrows through boxes, crossings, labels on boxes or on each other, arrows through other arrows' labels, boxes cut off by a frame. `routine run check-diagram` reports the same and points at
the shapes. Use it after a layout change: it's faster than a screenshot and says exactly what to fix. What a good diagram has, roughly in order: nothing
overlapping or cut off; arrows that don't run through boxes; boxes of a kind that match and line up; one direction of flow; short titles, with the rest in
`meta.detail`; and text you can read when the whole diagram fits on screen (on a big canvas, over 25 boxes or three or more frames, that
last one is only a measure: it's read by zooming in).

`toucan.measure()` and `toucan.tidy.*` read the canvas through `toucan.scene` (app/scene.js), the same on both engines: `scene.items()` gives every
shape in page coordinates with its `kind` (box, frame, text, note, arrow), `scene.arrows()` what each arrow joins and how it runs, and `place`,
`restyle`, `setArrow`, `checkpoint` and `rollback` change them. Use it for a routine that should run on either engine. On Excalidraw its changes
land together in one `updateScene` when the exec ends (one undo step), moving a box moves its label, and the arrows bound to it are drawn again.

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

Solid arrows are the way through, so proposals and dotted arrows are skipped when walking. `animate` (and **Animate** above the canvas) builds
the diagram up in that same order as a GIF: from where it starts, each box with the arrows that join it to what's already there, a fork's
branches together, lanes and frames first; nothing on the canvas changes. The **Air out** routine (`routine run air-out`, tldraw)
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

The quickest profile is one made from the agent's folder: `toucan profiles add ID --workdir DIR` writes `<data>/_profiles/ID.json`
(`local/ID`), starting from the folder's `AGENTS.md` or `CLAUDE.md`, and checks it first. Profiles come from sources:
`<data>/_profiles/ID.json` is `local/ID`. Any program on PATH named `toucan-profiles-NAME` is a source too:
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

## Plans: a canvas over a system of record

A canvas can show a **plan**: a project kept somewhere else (a file, or a project-management system reached through a plan source),
drawn as views that stay in step with it both ways. The plan is the system of record and the canvas holds views of it. When it
changes upstream the views are redrawn; when a person drags a card to another column, stretches a bar or retitles a box, that edit
is written upstream. A canvas has one plan and any number of views of it, beside whatever else is on it.

- `toucan sources` lists where plans can come from: the built-in `file` source (a plan as a JSON file, `files/PATH` in the canvas's
  files folder or `project/PATH` in its project; `examples/website-relaunch.plan.json` is one to try) and any `toucan-source-NAME`
  plugin, with the plans each lists. `toucan plugins` says which plugins were found, and why one wasn't trusted.
- `toucan --canvas NAME plan bind SOURCE REF [--views board,gantt]` binds the canvas (`--copy` copies a file plan given by path into
  the canvas's files, under a free name); `toucan new NAME --plan SOURCE REF --views board,gantt` makes a canvas that way. `plan`
  shows the source, when it last synced, the views and any problems; `plan sync` pulls now; `plan unbind` lets go, leaving the shapes
  as ordinary ones. `plan`, `plan items` and `plan views` ask the source whether it has moved and wait for the answer, so what they
  say is current with no tab open. `state` is about the data (`synced`: read and written); `drawn` says whether the views on the
  canvas show it yet, which with nobody there and no headless mode waits for the canvas to be opened.
- **You compose views by writing small specs, never by placing shapes.** The kinds are `board` (columns by an option field,
  optionally rows by another with `--lanes`), `gantt` (bars on a date axis, optionally lanes), `timeline` (dated items in order),
  `graph` (boxes and `dependsOn` arrows) and `table` (a row per item, a column per field). `plan view add KIND --group-by FIELD
  --filter 'stage!=done' --sort priority,-end --fields assignee,end --rollup count,sum:estimate`, `plan view set ID …` to change
  one, `plan view put FILE|-` for a whole spec as JSON, `plan view rm ID` (`--keep` leaves its shapes). **`plan catalog` lists every
  option of every kind**, and a spec that doesn't fit is refused with what would: an unknown field, a group-by that isn't an option
  field, a value that isn't one of the options. Fields are whatever the plan declares, including ones of its own: group, filter,
  sort and show any of them.
- **Change the work with `plan`, not with `exec`.** `plan items` lists the fields and items; `plan set ITEM stage=done end=2026-12-03`
  writes upstream (an option by its id or label; an empty value clears, as in `start= end=`; `--after ID` or `--first` places it)
  and `plan add --title T stage=todo` makes an item. They go through the same write as a person's drag, and the views follow. A
  refusal (`conflict`, `invalid`, `forbidden`) is the command's error: read it, and don't retry blindly.
- **Shapes keyed `plan:…` belong to the sync.** A view's frame is `plan:<view>`, and everything in it is `plan:<view>:<what>:<id>`
  (`item`, `col`, `lane`, `row`, `axis`, `label`, `cell`…). Each card carries `meta.plan = { item, view, version }`, and its Details
  card shows the record, with the fields a person can change there (a date is cleared there too). Don't move, restyle, relabel or
  delete them with `exec`: a move that means something is written upstream as if a person made it, and anything else is undone by
  the next sync. `import`, `draw --update`, `toucan.layout()`, `toucan.tidy.*` and every routine leave them, and whatever is inside
  a view's frames, exactly as they are (an import says how many under `planKept`; a routine's summary ends "left the plan views
  as they are"); `measure()` still measures them. That holds while the canvas is bound: after `plan unbind`, shapes that still
  carry `meta.plan` (from a restored version, say) are ordinary shapes.
- Views are placed clear of each other and of what's on the canvas, and each view's frame holds everything drawn in it. A view
  that grows into the one below moves that one down, unless a person has moved it: then it stays, and a notice says they overlap.
- **What a sync never touches:** anything that doesn't carry `meta.plan`. Arrows, notes and boxes drawn around or inside a view are
  the person's. When a view, a column, a lane or the Unscheduled strip goes away, what a person put inside it is moved out to
  where it stood, not removed with it. A view stays on the page, and inside any frame, a person put it.
- What a person's edit means, by kind, is in `plan catalog`. In short: a card into another column or row sets the grouped field; up
  or down a column places it after the card above; a gantt bar is exactly as long as start to end, and moving or stretching it
  sets those dates in whole days; a card dragged out of Unscheduled onto the chart starts on that day (for a day, or a day per 8
  hours of its `estimate`); text sets the title (in a table, a cell's text sets its field). A bar's title stands beside it when it
  doesn't fit inside, and is edited there. Dates are read against the view's own axis, and a card's column is the frame it is in,
  so moving or resizing a view, its frames or its axis is never an edit. A bar moves once it has gone a third of a day (and 4 px),
  and then by at least a day in that direction, so a nudge with the arrow keys counts at any scale. Several cards moved together
  end in the order they were dropped in. A shape that has been rotated is not an edit: it is stood up again.
- **A box a person draws in a board column becomes a new item** when it is a plain rectangle about the size of a card, with text,
  and a notice says so. There is no undo for that from the canvas (the protocol has no delete): the item is removed in the system
  of record. Anything else there is an annotation and stays one: an ellipse, a sticky note, a banner, a box an agent's run adds
  (`exec`, `import`, a routine), a copy of a card, boxes pasted several at once. To make an item, use `plan add`. A copy of a
  whole view (its frame duplicated) is the person's own ordinary shapes, frames and all.
- Not edits upstream: a deleted card (it comes back); a bar dropped into Unscheduled (it goes back: clear dates in the Details card
  or with `plan set ITEM start= end=`); a restored version (`versions restore` redraws the views from upstream and writes nothing).
  A person's undo of their own drag writes the previous value back; if the item has changed upstream since, the undo writes
  nothing and a notice says so. Bars dragged together with the date boxes above them change no dates: they go back, with a notice.
- A write quotes the version the card showed. If upstream had moved on, or refuses the value, the canvas goes back to what
  upstream says and people see a notice; `plan` lists these under `problems` and `plan dismiss` clears them.
- The server syncs, one sync per canvas however many tabs are open: it asks the source for changes every few seconds while a person
  has the canvas open, and redraws when something moved. A shape someone is dragging or typing in is left alone until they let go
  (their edit is then read against what they saw); everything else carries on meanwhile. With nobody there and no headless
  mode, the views are drawn when the canvas is next opened. Two safeguards: if the views keep differing from what was drawn with
  nothing in the difference to save, more than twelve times in twenty seconds, the canvas is left alone for a minute and a notice
  says which shapes kept changing (`plan sync` starts it again; something that changes them more slowly is simply drawn over each
  time); and a binding file that can't be read is kept aside, the canvas says so, and `plan bind` again takes up the shapes
  already there by their keys.
- On Excalidraw: a view with columns or lanes has no frame of its own (frames don't nest there), so a gantt without lanes has
  only its axis, bars and Unscheduled strip; a gantt's titles always stand beside their bars; and a view is always drawn on the
  one scene (there are no pages). Everything above is otherwise the same there and is tested there, except undo, which has no
  API to drive and is untested on that engine.

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
asked, anywhere. Each has a **kind**, and `routine list` groups them by it, with when to use each:

- **tidy**: `clean-up` (prefer it when someone says "tidy this": it keeps their arrangement, and never leaves the score lower), `align-boxes`, `distribute-evenly`,
  `match-sizes`, `fix-overlaps`, `fit-frames`, `fit-text`
- **arrows**: `neat-arrows`, `tidy-arrows`, `clear-arrow-labels`, `arrows-to-links` (long arrows become see-also links), `straighten-lines`
- **layout**: `lay-out-again` (rearranges everything, or one frame's contents with `--args '{"within": "KEY"}'`, and keeps arrows
  someone curved or routed by hand), `frame-these`, `stack-frames`, `air-out`
- **style**: `colour-by-frame`; **content**: `open-details` (the reverse of air-out); **check**: `check-diagram` (changes nothing)

All but `clear-arrow-labels` run on both engines (Excalidraw always puts an arrow's label at its middle). Run one rather than writing that code yourself: `routine run NAME --args '{"…": …}'` for those that take arguments
(`routine list` says which). toucan also learns routines from work. Every run that changes a canvas goes into a work log, and
`routine suggest` finds the code agents keep writing by hand, grouped by what it does, with the routines that already do it.
A habit no routine covers is worth banking; people see the same suggestions in their Routines menu, with **Bank it**, which
asks the chat agent to. `routine learn --codex` brings in the chat agent's past sessions, and `routine stats` says which
routines get used, by whom, and how often they fail.

```js
// routine: Colour the blocked boxes
// description: Turn every box mentioning "blocked" red.
// engines: tldraw
// kind: style
// when: Someone wants blocked work to stand out.

const hits = editor.getCurrentPageShapes().filter((s) => s.type === 'geo' && /blocked/i.test(toucan.text(s)))
editor.updateShapes(hits.map((s) => ({ id: s.id, type: s.type, props: { color: 'red' } })))
return { summary: `${hits.length} boxes coloured` }
```

It is the body of an async function with `editor`, `tl`, `toucan` and `args` in scope, and it runs through the
exec path: one undo step, glowing edits, a labelled version. The `summary` it returns is what the person sees.

- **When a person says "bank that", or keeps asking for the same chore:** write it to a file, try it with
  `exec`, then `toucan routine save NAME FILE --title "…" --description "…" --engines tldraw --kind style --when "…"`. Prefer
  `toucan.*` helpers that work on both engines (`graph`, `applyGraph`, `remove`, `selection`), and say `--engines tldraw, excalidraw`
  when it does. It must work
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
