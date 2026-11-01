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
toucan --canvas NAME script list|put NAME FILE|rm NAME   # persistent canvas scripts
toucan canvases                                 # every canvas: title, description, shapes, open tabs
toucan new NAME --title T [--engine tldraw|excalidraw] [--from CANVAS|FILE]
toucan --canvas NAME graph [--format tg|jsoncanvas|mermaid|dot|excalidraw] [OUT]   # no tab needed
toucan --canvas NAME import FILE [--format F] [--move] [--prune] [--propose]   # keyed upsert of a graph file
toucan --canvas NAME meta --title T --description D
toucan --canvas NAME proposals [accept|reject [KEY...]]   # dashed = proposed
toucan --canvas NAME selection                  # what people selected: resolve "this" / "these"
toucan --canvas NAME notes [--all]              # sticky notes left for you, with what they're on/near
toucan --canvas NAME notes resolve KEY --reply TEXT   # mark one handled (green + reply)
toucan --canvas NAME log [--since 2h]           # edits agents made while nobody had it open
```

`--canvas` can also come from `TOUCAN_CANVAS`. `exec`, `summary`, `screenshot` and `import` need a
browser tab open on the canvas, unless the server runs in headless mode; `graph`, `canvases`, `new`,
`meta` and `log` work against the server alone.

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

- **Your edits glow.** Shapes an exec adds or changes get a short violet halo, tagged "agent", in every
  open tab (both engines). `toucan.pulse(keys)` does the same on demand, to point at something.
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

- **Import is a keyed upsert.** Existing shapes get only the fields the file carries and keep their position unless `--move`; a missing field means "leave it" (a bare Mermaid reference `a --> b` doesn't relabel `a`; a node outside any subgraph keeps its frame). New shapes without a position are laid out with ELK beside the existing content. Arrows match by endpoints (`edge:<from>-><to>`). Nothing is deleted without `--prune`.
- **Mermaid is a good edit language** for structure: write a small flowchart of what to add or relabel and `import` it. Use `exec` with the engine's own API for styling or anything TG can't say.
- `graph` reads the server's copy, which can trail an edit a tab made a moment ago.

## Engines

- **tldraw** (default): `editor` is the tldraw Editor, `tl` the tldraw module; full helpers below.
- **Excalidraw**: `editor` is the ExcalidrawImperativeAPI (`getSceneElements()`, `updateScene({elements, captureUpdate})`, …), `tl` the `@excalidraw/excalidraw` module. `toucan` has the core only: `summary`, `graph`, `applyGraph`, `screenshot`, `zoomTo`, `get`, `remove`, `text`, `keyOf`. A shape's key is its `customData.key` (falling back to its id). Change elements with `tl.newElementWith(el, {...})`, which bumps the version so the edit syncs to other tabs; prefer `applyGraph` for structure. Import doesn't move an existing element into a different frame there (it does on tldraw); reparent it with `frameId` yourself.
- Converting a canvas between engines is `new NAME --engine E --from CANVAS` (through TG: keys, text, grouping, arrows, meta and positions survive; engine-specific styling is approximated).

## Helpers

The `toucan.*` helpers are idempotent by key; prefer them to raw editor calls.

- `node(key, {x, y, w, h, text, geo, color, fill, dash, size, parent, meta, move, proposed})` — create/update a box. Existing boxes keep their position unless `move: true`. `parent` is a frame key; x/y are then frame-relative.
- `frame(key, {x, y, w, h, name, color})`, `edge(fromKey, toKey, {text, color, dash, kind, bend, proposed})` — bound arrow.
- `propose(...keys)`, `proposals()`, `accept(...keys)`, `reject(...keys)` — see Proposals.
- `get(key)`, `idFor(key)`, `text(shape)`, `find(q)`, `summary({within})`, `remove(...keys)`, `zoomTo(keys?)`, `pulse(keys)`
- `await layout(keys | null, {within: frameKey, direction: 'RIGHT' | 'DOWN', spacing, layerSpacing})` — ELK.

Colours: black grey light-violet violet blue light-blue yellow orange green light-green light-red red white.
Fill: none semi solid pattern. Dash: draw solid dashed dotted. Size: s m l xl.

Plain tldraw also works: `editor.updateShapes([...])`, `editor.createShape({...})` — but always pass
`parentId` (a frame id or `editor.getCurrentPageId()`), or tldraw drops new shapes into whatever frame
is under them. Text uses rich text: `props.richText = tl.toRichText('…')`.

## Canvas scripts (growing features)

A script is a function body run in the browser with `editor`, `tl`, `toucan` whenever the canvas
loads or scripts change; it may return a cleanup function. Use it for lasting behaviour (a button,
a live overlay, a reaction to edits). Example:

```js
const off = editor.sideEffects.registerAfterChangeHandler('shape', (prev, next) => { /* … */ })
return () => off()
```

Example: `examples/tidy-arrows.js` adds a **Tidy arrows** button (tldraw) that re-routes connected arrows
to run through fewer boxes and cross fewer arrows, without moving any box. When a person asks you to
clean up arrows, or keeps asking for the same chore, offer to install it (`script put tidy-arrows
examples/tidy-arrows.js`); once installed, `toucan.tidyArrows()` runs it and returns before/after counts.
