# Changelog

All notable changes to toucan are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and toucan uses [semantic versioning](https://semver.org/).

## [Unreleased]

## [0.12.2] — 2026-11-07

### Fixed

- The one-line install, and `toucan update`, work with npm 12. npm 12 refuses to install a package from a URL by
  default (`allow-remote=none`), so `install.sh` stopped with `EALLOWREMOTE`. Both now download the release first and
  install the local file, which every npm version accepts. `npm run test:install` serves the tarball over HTTP, so CI
  runs the same download path people do, and it reads npm 12's new `npm pack --json` shape.

## [0.12.1] — 2026-11-07

### Added

- **Features** on the docs site: everything toucan does in one list, grouped, with where to find each one in the app
  or as a command and the release it arrived in. The source is `website/work/features.json`, which other tools can
  read; `scripts/build-features.mjs` renders it, and `npm run docs` runs both.

### Changed

- The docs site builds with artoo 0.9.3 (Markdown tables, video figures, page front matter).

### Fixed

- Importing a group whose members are already on the canvas (Mermaid `subgraph lane … end` around an existing box,
  which is how an agent "gives a box its own lane") no longer creates a zero-width frame. tldraw rejects one, the
  import timed out, and in an open tab the canvas crashed to "Something went wrong". The group now wraps its members
  where they are, an empty one gets a default size, and `frame()` and `layout(within)` never write a zero size.

## [0.12.0] — 2026-11-06

Work with your own agent on a canvas.

### Added

- **Profiles: work with a named agent on a canvas.** Bind a canvas to an agent profile (`toucan meta --profile SOURCE/ID`, or the picker in the chat header). Its chat and comment threads then become that agent: its briefing and starting context are loaded, its skills are listed, people see its name on the canvas, and the folders it shares appear in References as `agent/…`. Switching starts a new conversation and keeps each agent's earlier one.
- `toucan profiles add ID --workdir DIR` makes a profile from an agent's folder, starting from its `AGENTS.md` or `CLAUDE.md`: no registry needed.
- Profiles come from `<data>/_profiles/ID.json`, or from any `toucan-profiles-NAME` program on PATH answering `list` and `get ID`, so a registry of agents plugs in without toucan knowing about it. What a profile reads and shares must be inside the agent's own folder and not hidden, and a profile grants no writing: the agent writes in the canvas's files folder like any chat agent. Sources are only found in PATH folders an agent can't write to. `toucan profiles` lists them, and `toucan profile` shows what a canvas's agent reads.

## [0.11.0] — 2026-11-06

Reach toucan at a name of your own.

### Added

- `TOUCAN_PUBLIC_URL` (`--public-url`): the address people reach the server at, such as a name behind a reverse proxy. Links, `toucan open` and `toucan url` use it, so signing in happens at the address people browse.
- `TOUCAN_HOSTS` (`--allow-host`): more names the server answers to. `.example.com` covers every name under it.
- The sign-in page takes a pasted sign-in link or token, checks it with the server, and keeps it for that address. You can now sign in from a browser `toucan open` can't reach.

### Changed

- The server answers only to IP addresses, `localhost`, its own machine's names, its public URL and `TOUCAN_HOSTS`. Any other `Host` header gets a 421 saying which setting lets it in. This closes DNS rebinding for a server bound to every interface. `TOUCAN_HOSTS=*` turns the check off.

## [0.10.0] — 2026-11-06

Read what's behind a diagram without leaving it.

### Added

- **References.** A panel beside the canvas for reading reference material without leaving: the canvas's own files, the project's, and pages on the web. Markdown renders with its relative links and images working, alongside PDFs, images, tables, code and text. Web pages are fetched by the server and shown without running their scripts. Hidden files, build folders and anything outside the canvas's files and its project can't be read, and pages on this machine or a private network aren't fetched (`TOUCAN_FETCH_PRIVATE=1` allows them).
- `toucan show REF|PATH|URL` opens something for everyone looking at the canvas, and `toucan references` lists what can be shown. Agents are told to show what they write. Over MCP it's `toucan_show`.
- A box's `meta.refs` lists what's behind it in its details card, and web addresses in its details open in the panel. A link pasted onto the canvas opens beside it too.
- `npm run test:references`, an end-to-end check of the panel on both engines.
- A callout for agents at the top of the README and the docs, and `llms.txt`: what toucan is for, and how an agent installs and starts it.

## [0.9.0] — 2026-11-06

See who's working on a canvas, and what they're about to do.

### Added

- **Agent at work.** While an agent is busy on a canvas (a CLI call running, a chat or thread turn in progress, or a few seconds after its last call), every open tab shows a status pill with its name and what it is doing, a soft ring round the canvas, and the agent's cursor on the shape it last changed or pointed at. Both engines.
- `toucan say TEXT [--at KEY,KEY]`: the agent says what it is about to do, in the pill and on its cursor; `--at` moves its cursor to those shapes and glows them. `say()` in `toucan/client`.
- `--agent NAME` / `TOUCAN_AGENT` names the agent on the canvas, and the glow's tag carries the name. The chat panel's agent is "Codex".
- `npm run test:presence`, an end-to-end check of the above on both engines.

### Fixed

- `toucan guide` no longer opens with a line about the chat panel that, rewritten for the terminal, made no sense.

## [0.8.0] — 2026-11-04

### Added

- **One-line install.** `curl … install.sh | sh` installs a prebuilt release (about 65 MB, no build), starts the server, connects your agents and opens a first canvas. Each release carries `toucan.tgz` and `install.sh`, and `toucan update` moves to the latest.
- **`toucan setup`, `doctor`, `open`, `start`, `stop`, `restart`, `status`, `guide` and `--version`.** `setup` asks nothing, so an agent can run it. `doctor` says what's wrong and what to do about it.
- **The server looks after itself.** A command that needs a server starts one in the background. One you run yourself (systemd, `npm start`) stays in charge: commands won't start a rival and `toucan stop` won't stop it, unless `toucan start --take-over` hands it over.
- **A canvas per project: `toucan init`.** It finds or makes the canvas for the repository you're in, and commands run anywhere inside it use that canvas without `--canvas`. Nothing is added to the repository.
- **`toucan agents`** connects Claude Code, Codex, Gemini CLI, pi, Cursor, opencode and Claude Desktop, and undoes it. Each gets the skill, or MCP where a skill can't work.
- **`toucan mcp`**: an MCP server for agents that can't run the CLI, including Codex in its default sandbox. It speaks the stateless 2026-07-28 protocol and the earlier handshake.
- A **welcome canvas** on first setup, which shows what to try.
- `TOUCAN_TOKEN`, with `TOUCAN_URL`, for a server on another machine or outside a container.
- The docs show how toucan works: **See it work**, screenshots of real runs and real agent turns, and **Explore**, real canvases you can click through with no server. `scripts/build-docs.mjs` makes them.

### Changed

- **Canvases live in your data directory** (`~/.local/share/toucan/canvases` on Linux, `~/Library/Application Support/toucan/canvases` on macOS), not in the checkout, so upgrades leave them alone. A checkout that already holds canvases keeps using them.
- **Headless mode is on for a server toucan starts**, and uses the Chrome, Chromium, Edge or Brave already on the machine rather than requiring a download. A server you run yourself still opts in.
- `tldraw` and `@tldraw/sync-core` are pinned to one version, since a release ships the built app and the server separately. What only the app's build needs moved to `devDependencies`.

### Fixed

- Stopping a server saves what's still in memory, rather than losing edits from the last second.
- Two commands starting a server at once always end up sharing one token, and a port already in use gets a plain message rather than a stack trace.
- `toucan draw` accepts common spellings of a flow (`key`, `label`, `source`, `target`), and says what's wrong with one it can't draw.
- `toucan screenshot` no longer writes into an install directory; outside a checkout it writes to a temporary directory and prints the path.
- A flowchart with a loop back no longer reads backward: the way in stays first.
- What an import adds lands below what it connects to, not off to the side, and the chat agent is told to connect its proposals.
- Air out uses a short opening sentence as the box's name, rather than cutting the text mid-sentence.

## [0.7.0] — 2026-11-03

Formats that air a canvas out, a roster of diagrams to start from, and a way to tell whether a diagram is any good.

### Added

- 22 templates, from `toucan templates` or **New canvas**: flowchart, swimlane, org chart, decision tree, mind map, sequence, layered architecture, service map, network, entity relationships, state machine, pipeline, roadmap, timeline, kanban, 2x2, customer journey, responsibility chart, comparison, fishbone, funnel and cycle. Each is data for a layout rule in `lib/layouts.mjs`.
- `toucan draw FILE`: describe a diagram as data, in the same form as a template, and the layout engine places it on the canvas. The chat agent is told to draw this way.
- A Mermaid import on a blank canvas now looks like a template: small type, boxes measured for their text, arrows in elbows along the sides.
- `npm run eval:agent`: sends common requests to the chat agent on blank canvases and scores what it draws. It needs a Codex sign-in and spends usage, so it isn't part of `npm test`.
- A gallery of every template in the docs, built from the eval's pictures.
- Tidying respects a timeline: a box's position and width are its dates, so clean-up won't shift them sideways, overlaps stack, and Lay it out again declines.
- Tidying routines: **Clean up**, **Lay it out again**, **Line things up**, **Even out the gaps**, **Match box sizes**, **Fix overlaps**, **Fit frames**, **Neat arrows** and **Colour by frame**. Each keeps boxes, frames and connections, never moves a sticky note, and changes nothing when run again.
- **Check this diagram**, and `toucan.measure()`: a score out of 100 and what's wrong, measured from what's drawn and naming the shapes involved.
- `npm run test:diagrams`: makes every template, scores it, knocks eight of them about and runs every routine on them. Scores can't fall below `evals/baseline.json`.
- Graph arrows can say which side they leave and arrive at (`style.anchors`), bend, label position and whether they have a head.
- Details: a box stays short, and selecting it opens a card with what's behind it (`meta.detail`), its open threads, and jumps to related boxes (`meta.see`). Both engines. A plain canvas with no details behaves as before.
- Formats: **Story map**, **Ideas map** and **System diagram**, chosen in the app bar or with `toucan meta --canvas-format` and `new --canvas-format`. A format moves nothing. It lets ← and → walk the canvas from the card, along arrows or along a frame, and tells agents how to work there.
- Zoomed out on a system diagram (tldraw), you see its frames, how many parts each holds, and how many connections run between them, and a frame opens on click. Zoom in or **Show everything** for the rest. Nothing in the document changes, and agents and exports still see every shape. Index thumbnails wait until it's zoomed back in.
- The **Air out** routine converts a dense diagram: long box text moves into the details, names get larger, and things spread a little. One undo reverses it.

### Changed

- The demo maps are rebuilt on this: short titles, quotations in the card, and cross-references as jumps instead of long arrows.

### Fixed

- The chat's brief no longer calls a canvas empty when it holds only shapes a graph can't represent, such as sketches and images. It was reading their count wrongly.
- Excalidraw labels are centred in their boxes and readable on filled ones, and an arrow's label sits on its line whichever way it runs.
- A copied canvas keeps its type size, and a duplicated box keeps its own key on both engines.

## [0.6.0] — 2026-11-03

A place for what agents write, and two books to try threads on.

### Added

- Each canvas has a folder for what agents write for it, `<data>/<name>.files/`, archived with the canvas. The chat and thread agents are told to use it, and can write there but not elsewhere in the data directory. `toucan files` shows the path and what's there.
- Two demo canvases in `examples/`: *Meditations* as a map of ideas (George Long's translation) and *The Odyssey* as a story map (Samuel Butler's). `scripts/build-maps.mjs` builds them from `examples/maps.json` and refuses to write unless every quotation is found word for word where it's cited.

### Fixed

- `toucan help` shows every command, instead of stopping partway through the list.

## [0.5.0] — 2026-11-03

Comments that are conversations: attach them to a shape or a region, work them with agents and people, and close them out.

### Added

- Threads: comment on a shape, several selected shapes, or a dragged-out region, and go back and forth until someone closes it. Pins follow what they're on, and show whose move it is. Each message goes to the thread's own agent (several threads can be worked at once, and a reply mid-run steers that agent), to the main chat (adjusting its turn in progress), or to people. Both engines, with or without a tab open. `toucan threads` does the same from the CLI, and the chat's brief lists open threads.
- `threads adopt-notes` and a button in the Threads panel bring sticky notes in as threads, keeping their replies and resolutions. The notes stay.
- Your name, under Appearance, shown on your comments.

### Changed

- On Excalidraw too, a run that adds shapes outside the view brings them into view. Neither engine moves the canvas while a thread is open.

### Fixed

- `toucan.frame` on an existing frame changes only what you pass. It used to reset the name and colour you didn't mention.

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
