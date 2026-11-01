# Changelog

All notable changes to toucan are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and toucan uses [semantic versioning](https://semver.org/).

## [Unreleased]

### Added

- Notes: on tldraw, every sticky note is addressed to the agent. `toucan notes` lists open ones with the shapes each sits on and near; `toucan notes resolve KEY --reply TEXT` turns one green with a one-line reply. Notes are never deleted. The chat agent is told about them. Excalidraw has no sticky note, so notes are tldraw-only.
- Agent presence: shapes an exec adds or changes glow briefly, tagged "agent", in every open tab, on tldraw and Excalidraw. `toucan.pulse(keys)` does it on demand.

### Changed

- On tldraw, each exec is one undo step in the tab that ran it. Back-to-back execs used to merge into a single Cmd-Z.

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
