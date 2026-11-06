---
name: toucan
description: Draw on and read a live toucan canvas (tldraw or Excalidraw in a browser tab) through the toucan CLI while a person edits it by hand. Use when asked to use toucan, to start or open a canvas for this project, to draw, update, lay out, inspect, screenshot, export or import a diagram on a toucan canvas, to turn data or a Mermaid sketch into one, or to add lasting behaviour to a canvas with a canvas script. Do not use for diagrams that are not meant for a toucan canvas.
---

# toucan

A toucan canvas is a tldraw or Excalidraw document open in someone's browser. You change it by sending
JavaScript to the live editor through the `toucan` CLI. **A person is looking at it and may be editing it
at the same time:** inspect before you change, keep edits small and keyed, and never wipe their work.

## Which way in

Use the `toucan` CLI as below. **If you have tools named `toucan_*`, and especially in Codex, whose sandbox blocks the local
network the CLI needs by default, use those instead:** `toucan_project_canvas`, `toucan_open`, `toucan_guide`, `toucan_summary`,
`toucan_draw`, `toucan_import`, `toucan_exec`, `toucan_screenshot`, and `toucan_cli` for everything else. They do the same things,
and a CLI error about a sandbox isn't a reason to give up.

## Get a canvas

From the project you're working in:

```sh
toucan init --open       # finds or makes this project's canvas, and opens it for the person
```

It adds nothing to the repository. After that, commands run anywhere in the project use that canvas, so
`--canvas NAME` is optional below. The server starts by itself when a command needs it. To work on another
canvas, `toucan canvases` lists them and `toucan new NAME --template ID` makes one.

If `toucan` isn't found, it isn't installed here. Ask before installing it, then:

```sh
curl -fsSL https://github.com/lavallee/toucan/releases/latest/download/install.sh | sh
```

Never `npm install toucan`: that name on the npm registry is an unrelated package. If something's wrong,
`toucan doctor` says what. If the MCP tools are what you need and you don't have them, ask the person to run
`toucan agents install codex` (or `--mcp` for another agent) and start a new session.

`exec`, `summary`, `screenshot` and `import` run in the person's tab if one is open. If not, they run in a
headless browser, and your edits go on the canvas's trail (`toucan log`); if neither is possible, ask the person
to open the canvas with `toucan open`.

## The full guide

Read it before your first edit: `toucan guide`. It covers the commands, the `toucan.*` helpers, the graph
format, both engines and canvas scripts. A deployment may add notes in its data directory's `AGENTS.md`.

## The loop

1. **Look:** `toucan --canvas NAME summary` (JSON of shapes with keys), `screenshot` to see it.
2. **Change structure** with a small Mermaid flowchart and `toucan --canvas NAME import plan.mmd`. It is
   a keyed upsert: existing shapes keep their place, new ones are laid out beside them, and nothing is
   deleted without `--prune`.
3. **Change detail** with `toucan --canvas NAME exec FILE.js` using `toucan.node/frame/edge` (idempotent
   by key; positions are kept unless `move: true`) or the engine's own API.
4. **Check** with another `screenshot`, and say briefly what you changed.

**Be visible.** The person sees your name, what you're doing and your cursor on the canvas. Name
yourself with `--agent NAME` (or `TOUCAN_AGENT`). Before a step of any size, say what you're about to do and
where: `toucan --canvas NAME say "Merging Sign-in and Login page" --at sign_in,login_page`. One short
line per step, not a commentary.

**"This".** When the person says "this" or "these", run `toucan --canvas NAME selection` to see what
they have selected before guessing.

**Proposals.** For broad feedback, propose rather than impose: `toucan --canvas NAME import plan.mmd
--propose` adds shapes dashed; the person accepts or rejects them. Don't accept your own proposals unless asked.

**Notes.** On tldraw, every sticky note is a message to you. When asked to handle them, run
`toucan --canvas NAME notes`, act on each one using what it sits on and near, then
`toucan --canvas NAME notes resolve KEY --reply "what you did"`. Never delete a note.

**Threads.** People leave comments on shapes and regions as threads: `toucan --canvas NAME threads` lists the open
ones with what each is attached to, and `threads reply N "…"` answers. Leave closing them to people unless asked.

**Templates and quality.** Don't place boxes by hand: describe the diagram as data and pipe it to `toucan --canvas NAME draw -`. `toucan templates` lists the kinds and `toucan templates show ID` shows the form. After a layout change, `toucan --canvas NAME routine run check-diagram` scores it and names what's wrong; `clean-up` and `lay-out-again` fix most of it.

**Formats.** Keep boxes short and put the rest in `meta.detail`, which opens on click. `toucan --canvas NAME meta --canvas-format story|ideas|system` sets how a canvas is walked and what's expected of you there; follow the guide in the brief, or see AGENTS.md.

**Files.** Research, notes and helper scripts for a canvas go in its folder: `toucan --canvas NAME files` gives the
path. It is archived with the canvas. Open what you write for the person with `toucan show files/NAME`: it appears in the References panel
beside the canvas, which also shows project files (`project/PATH`) and web pages (`toucan show https://…`). Link a box to what's behind it
with `meta.refs: [{ref, label}]`.

**Profiles.** A canvas can work with a named agent instead of the chat panel's own: `toucan profiles` lists them, `toucan profiles
add ID --workdir DIR` makes one from an agent's folder, and `toucan --canvas NAME meta --profile local/ID` binds it (only when asked).

**Routines.** Before doing a chore by hand, check `toucan routine list` and `toucan --canvas NAME routine run
NAME`. When the person says "bank that", write it as a routine and `toucan routine save NAME FILE --title T
--description D --engines E`; it joins their Routines menu on every canvas.

**History.** Every canvas keeps versions. Name one before a sweeping change (`toucan --canvas NAME versions save
LABEL`), give an exec a `--label`, and `versions restore N` only when asked.

For lasting behaviour (a button, an overlay, a reaction to edits), install a canvas script:
`toucan --canvas NAME script put NAME FILE.js`. Never archive a canvas unless asked.
