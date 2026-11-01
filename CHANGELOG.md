# Changelog

All notable changes to toucan are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and toucan uses [semantic versioning](https://semver.org/).

## [Unreleased]

### Added

- Headless mode (`--headless` / `TOUCAN_HEADLESS=1`): with no browser tab on a canvas, `exec`, `summary`, `screenshot` and `import` run in a headless Chromium page the server opens itself (Playwright, via the optional `playwright-core` dependency), on both engines. People's tabs always come first; pages close when idle (`TOUCAN_HEADLESS_IDLE`) and are capped (`TOUCAN_HEADLESS_MAX`).
- The trail: edits made in a headless page are recorded in `<data>/<name>.log.jsonl`, shown by `toucan log [--since T]`, and announced in the app as "N agent edits while you were away".
- `npm run test:headless`, an end-to-end check of headless mode.

### Changed

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
