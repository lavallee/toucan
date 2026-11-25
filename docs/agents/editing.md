# Editing diagrams

## Graphs: the engine-neutral path

A canvas reads and writes as a *toucan graph* (TG, `lib/tg.mjs`): `groups` (frames), `nodes` (boxes) and
`edges` (arrows), each with a stable `key`, optional `box` (page coordinates), `style` (tldraw's
vocabulary: color, fill, dash, geo; an arrow's also route, anchors, bend, elbowMid) and `meta`. Every engine's `toucan` has `graph()` and
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
- **Arrows go round boxes.** An arrow an import or a `draw` adds that would run through a box is routed round it, as the engine
  draws it (`lib/route.mjs`): an elbow out of other sides, or with its middle run (`elbowMid`, 0..1 across the gap) moved, or
  a gentle curve; a label another arrow crosses slides along its own arrow (tldraw). An elbow only goes round the outside of its
  own two ends, so in a `draw` flow a loop back against the flow leaves and arrives on the right (running down) or the bottom
  (running across), with its ends put at the edge of what it passes. Arrows already on the canvas are left alone; `routine run
  tidy-arrows` or `clean-up` reroutes those.

## Engines

- **tldraw** (default): `editor` is the tldraw Editor, `tl` the tldraw module; full helpers below.
- **Excalidraw**: `editor` is the ExcalidrawImperativeAPI (`getSceneElements()`, `updateScene({elements,
  captureUpdate})`, …), `tl` the `@excalidraw/excalidraw` module. `toucan` has the core: `summary`,
  `graph`, `applyGraph`, `screenshot`, `zoomTo`, `get`, `remove`, `text`, `keyOf`, and the same `measure()`, `tidy` and
  `scene` as tldraw (so every shipped routine runs there too). A shape's key is its
  `customData.key` (falling back to its id). Change elements with `tl.newElementWith(el, {...})`, which
  bumps the version so the edit syncs to other tabs; prefer `applyGraph` for structure. Import doesn't move an existing element into a different frame there (it does on tldraw); reparent it with `frameId` yourself.
- Converting a canvas between engines is `new NAME --engine E --from CANVAS` (through TG: keys, text,
  grouping, arrows, meta and positions survive; engine-specific styling is approximated).

## Helpers (`toucan.*`) — prefer these; they are idempotent by key
Exec evaluates the body of an async function with `editor`, `tl`, and `toucan` in scope. Return a JSON value to report the result.


- `node(key, {x,y,w,h,text,geo,color,fill,dash,size,parent,meta,move,proposed})` — create/update a box. An existing
  box changes only in what you pass, and keeps its position unless `move: true`. A new box with no position goes
  somewhere free. `parent` is a frame key; x/y are then frame-relative.
- A frame, like a box, changes only in what you pass.
- `frame(key, {x,y,w,h,name,color})`, `edge(fromKey, toKey, {text,color,dash,kind,bend,proposed})` — bound arrow.
- `propose(...keys)`, `proposals()`, `accept(...keys)`, `reject(...keys)` — see Proposals.
- `get(key)`, `idFor(key)`, `text(shape)`, `find(q)`, `summary({within})`, `remove(...keys)`, `zoomTo(keys?)`, `pulse(keys)`
- `await layout(keys | null, {within: frameKey, direction: 'RIGHT'|'DOWN', spacing, layerSpacing})` — ELK.

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
  structures (org chart, decision tree, mind map, OKR tree), systems (layered architecture, service map, systems map, network, entity relationships), time
  (roadmap, timeline), work (kanban, customer journey, responsibility chart, retro, empathy map, story map) and decisions (2x2, comparison table,
  fishbone, pros and cons, SWOT, stakeholder map, Eisenhower, five whys, decision log).
- **Starters**, a whole canvas on one subject made of several blocks under their own headings: system design, incident review, product strategy,
  project kickoff, research plan, team retro.

`toucan new NAME --template ID` makes a canvas from either, with the right format. `toucan --canvas NAME add ID` puts one beside what's already on a
canvas, on either engine, and never over it: if its keys clash it takes a prefix, which the command reports. People do the same from **Add** above
the canvas. Then change its boxes with `toucan.node`, or `import` more.

To draw on a canvas you're already on, describe the diagram as data and let the engine place it: `toucan templates show flowchart` shows the form,
and `toucan --canvas NAME draw plan.json` lays it out beside what's there. Each `kind` (flow, tree, mindmap, lanes, grid, board, quadrant, timeline, gantt,
sequence, fishbone, funnel, stack, cycle, map) has its own fields, and a box's `detail` is what opens on click. A new drawing never overwrites what's there: if its keys clash, the keys the layout made up (`col-0`, `map-title`) take a `d2-` prefix, the ones you wrote stay as you wrote them, and the command reports the prefix. (If a key you wrote clashes too, the whole drawing takes the prefix: drawing a section twice must not overwrite it.) `--prefix P` puts `P` on every key, yours included, so two grids or maps of one kind on one canvas never meet and stay stable. To change an earlier drawing, draw it again with `--update`, and `--move` to reposition its boxes too: the redrawn layout is moved to where the section is now (the top left of the shapes it replaces), not to the origin. `--frame KEY --title T` wraps the drawing in a titled frame (marked `meta.section`, so `measure()` scores it as a section); with `--update` and a frame already on the canvas, a drawing with nothing to replace goes into that frame. The frame's key is as given, never prefixed.

A **flow** keeps the order you wrote its boxes and groups in when it has to break a cycle (a group that feeds an earlier one runs backward, as a loop, rather than reordering the picture). A flow whose groups or boxes have no arrows between them (six state machines, each in a group) is laid out piece by piece and packed in rows in the order written, three to a row for six, rather than one long row: `columns` sets how many to a row, `aspect` (default 1.4) the shape of the whole. A box is as wide as its longest word needs (`typed_no_body` doesn't break in the middle), unless you gave it a `w`; a **sequence** sizes each participant by its longest word, makes each gap wide enough for the label of the message across it, and each row as tall as its label or self-message note.

For many named parts in a few systems, draw a **map** (`toucan templates show systems-map`): `columns` of panels, each with `tiles` packed in a grid,
and `links` between panels. A tile or a panel can have a `status` (live, building, trial, planned, retiring), shown by colour, line and word and kept
in `meta.status`; the key at the top lists only the states the picture uses. A panel takes a `step` number, a `sub` line and a `footer` such as
"Owner: Data team". A link with `"kind": "planned"` (or `"dash": "dotted"`) is dotted and puts "Dotted arrow: still to build" in the key; `"dash": "dashed"` is dashed and means nothing about plans (configuration, feedback). Tiles in a panel that have arrows between them are spaced to hold them, by the longest label across and a label's height down. A link past a column, or back against the reading direction, travels in a lane above
or below the picture (`"lane": "top"` or `"bottom"` to choose), and no arrow runs through a panel it doesn't end in. Never invent an owner, a step or
a state: leave out what the person didn't give you. In a Mermaid import, a class named like a state (`a:::planned`, or `class a,b building`) sets it.
(The form follows [open-diagram](https://github.com/lukendeasy/open-diagram) by Luke Deasy.)

`toucan describe` says what a diagram says, in plain words: each frame and what it holds, the state of each part, and every arrow with its
label. Read it against the request before you answer: every part the person named should be there, and nothing they didn't. `toucan export OUT`
writes the canvas as a file, by the ending of `OUT`: `.svg` (sharp at any size, with its title and that description inside it, for a document
or a pull request), `.png`, `.gif` (the animated build), or the graph as `.mmd`, `.canvas`, `.dot`, `.excalidraw`, `.json` or `.txt`. People
get the same from **Export** above the canvas.

In a tldraw workspace, **Appearance → Canvas palette → Letterpress** switches the local editor to paper and ink colors. **Admiralty** uses Lyra Forge chart white, navy and magenta. The choice persists in that browser. SVG exported by that editor uses its current palette.

**Renditions** are for a picture a document keeps: a named, published picture of part of a canvas that other documents include by
name, and that says whether the canvas has moved on since. `toucan rendition set NAME --frame KEY` (or `--keys a,b`, or `--all`,
the default; `--format svg|png`, `--alt TEXT`, `--title TEXT`) says what it shows; set it again to change it, and what you leave out
stays as it was. `toucan rendition publish NAME` draws it now, the way `export` does, into the canvas's data folder
(`<data>/CANVAS.renditions/NAME.svg`, with `NAME.json` beside it: what it shows, the canvas version and a hash of the shapes it was
drawn from, a hash of the picture, and when it was published; an unchanged picture keeps its date). It also lists the picture in the
include catalogue shared by this machine's tools (`$INCLUDES_CATALOGUE`, else `~/.config/includes/catalogue.json`) as
`toucan:CANVAS/NAME`, which a document names as `<!-- include: toucan:CANVAS/NAME -->`; `--no-catalogue` leaves it out.
`toucan rendition list` says which are `current` and which are `behind`, and `rendition remove NAME` takes one away, with its entry.
A rendition is drawn only when asked, never when the canvas is saved: publish again when the person wants the documents that include
it to change, and give it `--alt` words for people who can't see it. People publish one from **Export**, under Rendition.

`toucan.measure({ within: FRAME_KEY })` judges one frame and what is in it as if it were the canvas, and `toucan.tidy.all({ within })` (and every other tidy pass) arranges only that frame, moving nothing outside it. Without `within`, a canvas of several sections (top-level frames marked `meta.section`, as `draw --frame` makes; or, with none marked, two or more top-level frames that each hold frames of their own) gets a score for each in `sections` and `score` is their mean (`wholeScore` is the one-number score, which falls toward 0 as sections are added).

`toucan.measure()` measures the diagram as drawn and returns a `score` out of 100 and `findings`, each naming the shapes involved: overlaps, text that
outgrew its box, arrows through boxes, crossings, labels on boxes or on each other, arrows through other arrows' labels, arrows through a map's panels, boxes cut off by a frame, frame names cut off at the frame's width, two arrows running along one line, a word longer than the box it is in (so it breaks mid-word), a label half under a box (its own end too), and a frame of more than ten boxes that is mostly empty. Cells of a `grid` aren't compared for uneven columns: a table's rows differ. `routine run check-diagram` reports the same, points at
the shapes, and gives a `fixes` line for each kind of finding: what to run or change to clear it. Use it after a layout change: it's faster than a screenshot and says exactly what to fix. What a good diagram has, roughly in order: nothing
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

Solid arrows are the way through, so proposals and dotted arrows are skipped when walking. `animate` (and **Export** above the canvas) builds
the diagram up in that same order as a GIF: from where it starts, each box with the arrows that join it to what's already there, a fork's
branches together, lanes and frames first; nothing on the canvas changes. The **Air out** routine (`routine run air-out`)
converts a dense diagram: long text moves to `meta.detail`, names get larger, and things spread a little. Run it only when asked. Region threads keep their position, so they may need re-anchoring afterwards.
