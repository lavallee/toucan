---
name: toucan
description: Read and change a live toucan canvas (tldraw or Excalidraw in a browser tab) through the toucan CLI while a person edits it by hand. Use when asked to draw, update, lay out, inspect, screenshot, export or import a diagram on a toucan canvas, to turn data or a Mermaid sketch into one, or to add lasting behaviour to a canvas with a canvas script. Do not use for diagrams that are not on a toucan canvas.
---

# toucan

A toucan canvas is a tldraw or Excalidraw document open in someone's browser. You change it by sending
JavaScript to the live editor through the `toucan` CLI. **A person is looking at it and may be editing it
at the same time:** inspect before you change, keep edits small and keyed, and never wipe their work.

## Check the setup

```sh
toucan canvases          # lists canvases and how many tabs have each open
```

If `toucan` is missing, toucan is not installed here (see https://lavallee.github.io/toucan/quickstart.html);
say so rather than editing files by hand. `exec`, `summary`, `screenshot` and `import` need a tab open on
the canvas, unless the server runs in headless mode (then it opens the canvas itself, and your edits go
on the canvas's trail, `toucan log`); if they fail with "no browser tab", ask the person to open the
link from `toucan url --canvas NAME`.

## The full guide

The authoritative guide is `AGENTS.md` in the toucan checkout, beside the CLI:

```sh
cat "$(dirname "$(readlink -f "$(command -v toucan)")")/../AGENTS.md"
```

Read it before your first edit. It covers the commands, the `toucan.*` helpers, the graph format, both
engines and canvas scripts. A deployment may add notes in its data directory's `AGENTS.md`.

## The loop

1. **Look:** `toucan --canvas NAME summary` (JSON of shapes with keys), `screenshot` to see it.
2. **Change structure** with a small Mermaid flowchart and `toucan --canvas NAME import plan.mmd`. It is
   a keyed upsert: existing shapes keep their place, new ones are laid out beside them, and nothing is
   deleted without `--prune`.
3. **Change detail** with `toucan --canvas NAME exec FILE.js` using `toucan.node/frame/edge` (idempotent
   by key; positions are kept unless `move: true`) or the engine's own API.
4. **Check** with another `screenshot`, and say briefly what you changed.

**"This".** When the person says "this" or "these", run `toucan --canvas NAME selection` to see what
they have selected before guessing.

**Proposals.** For broad feedback, propose rather than impose: `toucan --canvas NAME import plan.mmd
--propose` adds shapes dashed; the person accepts or rejects them. Don't accept your own proposals unless asked.

**Notes.** On tldraw, every sticky note is a message to you. When asked to handle them, run
`toucan --canvas NAME notes`, act on each one using what it sits on and near, then
`toucan --canvas NAME notes resolve KEY --reply "what you did"`. Never delete a note.

**Threads.** People leave comments on shapes and regions as threads: `toucan --canvas NAME threads` lists the open
ones with what each is attached to, and `threads reply N "…"` answers. Leave closing them to people unless asked.

**Routines.** Before doing a chore by hand, check `toucan routine list` and `toucan --canvas NAME routine run
NAME`. When the person says "bank that", write it as a routine and `toucan routine save NAME FILE --title T
--description D --engines E`; it joins their Routines menu on every canvas.

**History.** Every canvas keeps versions. Name one before a sweeping change (`toucan --canvas NAME versions save
LABEL`), give an exec a `--label`, and `versions restore N` only when asked.

For lasting behaviour (a button, an overlay, a reaction to edits), install a canvas script:
`toucan --canvas NAME script put NAME FILE.js`. Never archive a canvas unless asked.
