# Changelog

All notable changes to toucan are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and toucan uses [semantic versioning](https://semver.org/).

## [Unreleased]

## [0.4.0] — 2026-11-03

Instructions reach the canvas much sooner.

### Added

- **Fast** and **Thorough** in the chat panel, kept per browser. Fast is the default: Codex's default model at low effort. `TOUCAN_CHAT_FAST_MODEL`, `TOUCAN_CHAT_FAST_EFFORT`, `TOUCAN_CHAT_THOROUGH_MODEL` and `TOUCAN_CHAT_THOROUGH_EFFORT` override them.
- Send a message while the agent is working: it adjusts the turn in progress rather than waiting for it to end.
- Some messages skip the agent and land at once: `/routine-name` (typing `/` lists them) and a message that is only a Mermaid flowchart.
- `toucan import -` reads a graph from stdin, and `import --label` names it in the history.

### Changed

- The chat agent gets a brief of the canvas with each message, and is told to put the edit on the canvas first and refine after, instead of reading the guide and the canvas before it starts.
- The chat starts Codex when a panel opens, not on the first message.
- On tldraw, a run that adds shapes outside the view, or starts an empty canvas, brings them into view, unless the person is mid-gesture.

### Fixed

- `toucan.node` on an existing box changes only what you pass. It used to reset the text, size, colour and fill you didn't mention, so `toucan.node('a', {color: 'blue'})` relabelled the box "a". Code relying on the reset must now pass those fields.
- `toucan.node` with no position puts a new box somewhere free, growing its frame if it needs to, rather than at 0,0 on top of whatever is there.

## [0.3.0] — 2026-11-02

Creature comforts: move through a canvas's past, keep your chores, and make the room your own.

### Added

- History: every canvas keeps versions, on both engines, with or without a tab open. One is saved after each agent run that changed something, when edits go quiet (`TOUCAN_VERSION_QUIET`, default 30s; `TOUCAN_VERSION_MAX_WAIT`, default 300s, during steady editing), when the last tab leaves, and when someone names one. The **History** panel steps through them read-only over the live canvas (← and →) and restores any of them for everyone. What was there is saved first, so a restore can be undone. Old automatic versions are thinned; named ones are kept. `toucan versions [save LABEL | show N [--format F] | restore N]` does the same from the CLI.
- Routines: chores banked once for every canvas on a server, in `<data>/_routines/`, and run from the **Routines** menu or `toucan routine run NAME`, as one undo step. Bank one by asking the chat, pasting code, or `toucan routine save`. **Tidy arrows** and **Straighten sketchy lines** ship in `routines/`.
- Theme override: system, light or dark, under **Appearance** in the app bar and on the index, per browser. tldraw's and Excalidraw's menus follow it.
- The chat panel moves: dock it left, right or along the bottom, or float it over the canvas, with the buttons in its header or by dragging the header to an edge. Drag its edge to resize. Per browser.
- `toucan exec --label TEXT` names a run in the history and on the trail.

### Changed

- Clean lettering by default. tldraw's handwritten font is drawn in Geist in this browser, without changing any shape; **Appearance → Canvas lettering → Handwritten** brings it back. New shapes get solid outlines rather than hand-drawn ones, including `toucan.node`'s default, and new Excalidraw text starts in a plain font. The **Straighten sketchy lines** routine converts what's already on a canvas.
- An app bar replaces the floating badge, so toucan's controls no longer sit on the canvas. It shows the canvas's title rather than its name.
- A tldraw canvas opens fitted to its content rather than at the page origin.
- The index sorts by most recently edited, and new-canvas details are behind a **New canvas** button.
- `examples/tidy-arrows.js` is now the routine `routines/tidy-arrows.js`, with a wider search (bigger bends, several elbow positions) that never leaves more arrows through boxes than it found. It has no button of its own. A canvas that installed the old script keeps it until `toucan script rm tidy-arrows`; `toucan.tidyArrows()` works only there.

## [0.2.0] — 2026-11-01

Collaboration channels beyond chat, and agents that can work with no tab open.

### Added

- `examples/tidy-arrows.js`, a canvas script that adds a **Tidy arrows** button (tldraw): it re-routes connected arrows (straight, curved or elbow) so fewer run through boxes or cross, without moving a box, as one undo step. Also `toucan.tidyArrows()` for agents.
- A design note, "Habits" (`website/content/habits.md`), on how toucan could notice a repeated request and offer to make it a button.
- Proposals, "dashed = proposed": `import --propose` and `proposed: true` / `toucan.propose()` add shapes dashed with a proposal flag; a bar above the canvas lets the person accept (solid) or reject (remove) the selected or all proposals, as one undo step; `toucan proposals [accept|reject]` does the same from the CLI. Both engines.
- Selection awareness: `toucan selection` (and `toucan.selection()`) shows what the person selected in their tab and, on tldraw, what other people have selected, so an agent can resolve "this". `summary` carries `selected`. The chat agent is told to check it.
- Notes: on tldraw, every sticky note is addressed to the agent. `toucan notes` lists open ones with the shapes each sits on and near; `toucan notes resolve KEY --reply TEXT` turns one green with a one-line reply. Notes are never deleted. The chat agent is told about them. Excalidraw has no sticky note, so notes are tldraw-only.
- Agent presence: shapes an exec adds or changes glow briefly, tagged "agent", in every open tab, on tldraw and Excalidraw. `toucan.pulse(keys)` does it on demand.
- Headless mode (`--headless` / `TOUCAN_HEADLESS=1`): with no browser tab on a canvas, `exec`, `summary`, `screenshot` and `import` run in a headless Chromium page the server opens itself (Playwright, via the optional `playwright-core` dependency), on both engines. People's tabs always come first; pages close when idle (`TOUCAN_HEADLESS_IDLE`) and are capped (`TOUCAN_HEADLESS_MAX`).
- The trail: edits made in a headless page are recorded in `<data>/<name>.log.jsonl`, shown by `toucan log [--since T]`, and announced in the app as "N agent edits while you were away".
- `npm run test:headless`, an end-to-end check of headless mode.

### Changed

- On tldraw, each exec is one undo step in the tab that ran it. Back-to-back execs used to merge into a single Cmd-Z.
- An Excalidraw tab accepts agent code only once its scene has loaded.
- `toucan canvases` counts only people's tabs as `open`, and reports `headless`.

## [0.1.0] — 2026-10-27

First public release.

### Added

- A browser canvas on tldraw or Excalidraw, synced live across tabs by a small Node server, with an index of canvases.
- The `toucan` CLI for agents: `summary`, `exec`, `screenshot`, `script`, `new`, `meta`, `archive`, `graph` and `import`.
- A chat panel that drives Codex on the user's own ChatGPT sign-in, with sandbox approvals in the browser.
- Canvas scripts: persistent JavaScript behaviour stored with a canvas.
- The toucan graph (TG) and converters for JSON Canvas, Mermaid, DOT (export) and `.excalidraw`; keyed upsert import with ELK layout.
- Extension commands (`toucan X` runs `toucan-X`), a Node client (`toucan/client`), deployment agent notes, and a configurable data directory.
- An agent skill and plugin manifests for Claude Code and Codex.
