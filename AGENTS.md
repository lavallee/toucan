# toucan — agent guide

toucan is a tldraw canvas in a browser tab. You change it by sending JavaScript to the live editor
through the toucan CLI. A human is looking at it and editing it by hand at the same time: inspect
before you change, keep edits small, and never wipe their work.

## CLI

```
node bin/toucan.mjs --canvas NAME summary [--within KEY]   # JSON of shapes (key, type, bounds, text, from/to)
node bin/toucan.mjs --canvas NAME exec -e 'CODE'           # run JS in the editor; `return` a JSON value
node bin/toucan.mjs --canvas NAME exec FILE.js             # same, from a file (use for anything > 1 line)
node bin/toucan.mjs --canvas NAME screenshot [OUT.png]     # look at it (default .toucan/NAME.png, <=1800px)
node bin/toucan.mjs --canvas NAME script list|put NAME FILE|rm NAME   # persistent canvas scripts
node bin/toucan.mjs canvases                               # every canvas: title, description, shapes, open tabs
node bin/toucan.mjs new NAME --title T [--engine tldraw|excalidraw] [--from CANVAS|FILE]   # make a canvas
node bin/toucan.mjs --canvas NAME graph [--format tg|jsoncanvas|mermaid|dot|excalidraw] [OUT]   # export; no tab needed
node bin/toucan.mjs --canvas NAME import FILE [--format F] [--move] [--prune]   # keyed upsert of a graph file
node bin/toucan.mjs --canvas NAME meta --title T --description D   # retitle / describe a canvas
```

There can be many canvases, each on one engine (tldraw or Excalidraw); name one with `--canvas` or `TOUCAN_CANVAS`. In the chat
panel, work on the canvas the chat belongs to unless the user names another. Never archive a canvas unless asked.

Any other command `X` runs an extension, `toucan-X`, from PATH. A deployment can add its own agent notes as `AGENTS.md`
in its data directory; the chat agent is told where they are.

Exec code is the body of an async function with `editor` (tldraw Editor), `tl` (the tldraw module)
and `toucan` (helpers below) in scope. It needs an open browser tab on that canvas.

## Graphs: the engine-neutral path

A canvas reads and writes as a *toucan graph* (TG, `lib/tg.mjs`): `groups` (frames), `nodes` (boxes) and
`edges` (arrows), each with a stable `key`, optional `box` (page coordinates), `style` (tldraw's
vocabulary: color, fill, dash, geo) and `meta`. Every engine's `toucan` has `graph()` and
`await applyGraph(tg, {move, prune})`, and the CLI's `graph`/`import` speak TG, JSON Canvas (Obsidian),
Mermaid flowcharts, DOT (export only) and `.excalidraw`.

- **Import is a keyed upsert.** Existing shapes get only the fields the file carries and keep their
  position unless `--move`; a missing field means "leave it" (a bare Mermaid reference `a --> b` doesn't
  relabel `a`; a node outside any subgraph keeps its frame). New shapes without a position are laid out
  with ELK beside the existing content. Arrows match by endpoints (`edge:<from>-><to>`). Nothing is
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

- `node(key, {x,y,w,h,text,geo,color,fill,dash,size,parent,meta,move})` — create/update a box. Existing
  boxes keep their position unless `move: true`. `parent` is a frame key; x/y are then frame-relative.
- `frame(key, {x,y,w,h,name,color})`, `edge(fromKey, toKey, {text,color,dash,kind,bend})` — bound arrow.
- `get(key)`, `idFor(key)`, `text(shape)`, `find(q)`, `summary({within})`, `remove(...keys)`, `zoomTo(keys?)`
- `await layout(keys | null, {within: frameKey, direction: 'RIGHT'|'DOWN', spacing, layerSpacing})` — ELK.

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
