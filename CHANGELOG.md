# Changelog

All notable changes to toucan are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and toucan uses [semantic versioning](https://semver.org/).

## [Unreleased]

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
