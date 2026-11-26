# toucan — agent guide

Toucan is a shared browser canvas, with tldraw or Excalidraw as its editor. A person may be editing the same canvas while you work. Inspect it first, use stable keys, and make small, reversible edits.

## Everyday canvas work

- In the chat panel, work on the canvas named in the brief and run `node bin/toucan.mjs` from the install directory. From a terminal, use `toucan --canvas NAME` for an existing canvas or `toucan init --open` to find or create the project's canvas. Use the brief or `summary` to inspect it and `selection` to resolve “this” or “these”. Ask if the target is still unclear.
- Use `templates show ID` and `draw` for a new diagram, a keyed `import` for structural edits, and a small labelled `exec` for targeted changes. Keep box labels short and put longer explanations in `meta.detail`. Imports keep positions unless you pass `--move` and remove shapes only with `--prune`. Preserve people's work when using either flag.
- Use `say` before a multi-step edit or one that touches something a person is working on. Check layout changes with `routine run check-diagram` and a screenshot. Save a named version before a sweeping change. Restore a version or archive a canvas only when asked.
- People keep working while you do. A `<canvas_activity>` block with a command's answer, or between steps in the chat, says what they changed, selected or commented on. Build on their edits rather than undo them, and adjust your plan when it bears on it.
- For broad feedback, add dashed proposals and leave acceptance to the person. When asked to handle sticky notes, use their placement as context and mark them resolved with `notes resolve`. Leave notes in place. Reply to comment threads and leave closing them to people unless asked or you opened the thread.
- For a bound plan, use `plan` for records and view specs. Treat shapes keyed `plan:…` as owned by the sync.
- Put research and helper files in the canvas's folder from `files`, and use `show files/PATH` to open them beside the canvas. Chat and thread agents write only in that folder within the data directory. Follow the deployment notes in its own `AGENTS.md` when the chat agent points to them.

## Where to look

Read the topic that matches the task. Use `toucan guide index` for this page, `toucan guide TOPIC` for a topic, or `toucan guide` for the full reference. With MCP, pass the topic to `toucan_guide`.

| Topic | Read for |
| --- | --- |
| [`cli`](docs/agents/cli.md) | Commands, canvas selection, server-only operations, and headless mode |
| [`editing`](docs/agents/editing.md) | Graph imports, engine APIs, helpers, layout, templates, and canvas formats |
| [`collaboration`](docs/agents/collaboration.md) | Selection, notes, threads, proposals, presence, what people do while you work, undo, files, references, and versions |
| [`plans`](docs/agents/plans.md) | Plan sources, view specs, upstream writes, and sync behavior |
| [`extensions`](docs/agents/extensions.md) | Agent profiles, reusable routines, reflexes, and persistent canvas scripts |

For repository changes, see [CONTRIBUTING.md](CONTRIBUTING.md).
