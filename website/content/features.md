---
description: Everything toucan 0.14.0 does, in one list: where to find each feature, and when it arrived.
kicker: Reference
---
# Features

Each row says where you find it: in the app, or as a `toucan` command an agent (or you) runs. Names link to where it's shown or explained, and "(tldraw)" marks what works on the tldraw engine only.

## The canvas

| Feature | What it does | Where | Since |
|---|---|---|---:|
| [Canvas](index.html) | A whiteboard in a browser tab that you edit by hand while agents edit it beside you, synced live across tabs. | **The canvas** | 0.1.0 |
| [Two engines](tour.html#tldraw-or-excalidraw) | Each canvas runs on tldraw or Excalidraw, and converts between them with keys, text, frames and arrows intact. | **New canvas**; CLI: `new NAME --engine tldraw\|excalidraw` | 0.1.0 |
| Canvas index | Every canvas on the server in one page, with thumbnails, to open or start one. | **Index**; CLI: `canvases` | 0.1.0 |
| [Templates](gallery.html) | 33 diagrams (blocks) in six groups, from flowchart and swimlane to SWOT, retro and story map, to start a canvas from or add beside what's there. | **New canvas**; CLI: `templates [show ID]` · `new NAME --template ID` · `add ID` | 0.7.0 |
| [Starters and Add](gallery.html) | Six starters build a canvas on one subject out of several blocks under headings (system design, incident review, product strategy, project kickoff, research plan, team retro); Add puts any block or starter beside what's on a canvas. | **Add · New canvas**; CLI: `add ID` · `new NAME --template ID` | 0.13.0 |
| [Welcome canvas](quickstart.html) | A first canvas on setup that shows what to try. | CLI: `setup` | 0.8.0 |
| Appearance and your name | System, light or dark per browser, and the name shown on your comments. | **Appearance** | 0.3.0 |
| [Example maps](explore.html) | The Odyssey as a story map and Meditations as a map of ideas, with every quotation checked against its source. | **Explore** | 0.6.0 |

## Chat with an agent

| Feature | What it does | Where | Since |
|---|---|---|---:|
| [Chat panel](tour.html#ask-and-it-draws) | Ask in plain words and the agent draws, edits and checks its work on the canvas, using Codex on your own ChatGPT sign-in. | **Chat** | 0.1.0 |
| Fast and Thorough | Pick a quick default model or a slower, more careful one for the chat, per browser. | **Chat: Fast / Thorough** | 0.4.0 |
| Steer a turn in progress | Send a message while the agent works and it adjusts the turn instead of waiting for it to end. | **Chat** | 0.4.0 |
| Slash commands and Mermaid shortcut | Type / to run a routine instantly, or paste a Mermaid flowchart and it lands without a model call. | **Chat: /** | 0.4.0 |
| New chat | Start a fresh conversation with the agent on the same canvas. | **Chat: New chat** |  |
| Dock or float the chat | Dock the chat left, right or along the bottom, or float it over the canvas, and resize it. | **Chat header** | 0.3.0 |
| Sandbox approvals | When the agent wants to go outside its sandbox, it asks you in the chat to accept or decline. | **Chat** | 0.1.0 |
| [Named agents (profiles)](agents.html#profiles-working-with-a-named-agent) | Work with a specific agent on a canvas: its briefing, context and skills load, and people see its name. | **Chat: agent picker**; CLI: `meta --profile SOURCE/ID` · `profiles add ID --workdir DIR` | 0.12.0 |

## Working together

| Feature | What it does | Where | Since |
|---|---|---|---:|
| [Sticky notes for the agent](tour.html#leave-a-sticky-note) (tldraw) | Pin a note where the problem is; the agent acts on each and turns it green with a one-line reply. Notes are never deleted. | **Note tool (N)**; CLI: `notes` · `notes resolve KEY --reply TEXT` | 0.2.0 |
| [Comment threads](tour.html#comment-and-have-it-answered) | Comment on a shape, several shapes or a region and go back and forth until someone closes it. Each thread has its own agent, so several are worked at once. | **Comment · Threads**; CLI: `threads new TEXT --on KEY --ask` · `threads reply N TEXT` | 0.5.0 |
| [Notes into threads](agents.html#threads-comments-on-shapes-and-regions) (tldraw) | Bring sticky notes into threads, keeping their replies and resolutions. | **Threads panel**; CLI: `threads adopt-notes` | 0.5.0 |
| [Proposals](tour.html#take-it-or-leave-it) | An agent's suggestion arrives dashed, with Accept and Reject above the canvas. Nothing is final until you say so. | **Proposal bar: Accept all / Reject all**; CLI: `import --propose` · `proposals accept\|reject` | 0.2.0 |
| [Agent at work](agents.html#what-people-see-presence-and-undo) | While an agent works, every tab shows a status pill with what it's doing, a soft ring round the canvas, and its cursor on the shape it touched. | **On the canvas**; CLI: `say TEXT [--at KEY,KEY]` · `--agent NAME` | 0.9.0 |
| ["This": selection awareness](agents.html#this-what-people-have-selected) | Agents can see what you've selected, so "make this bigger" means this. | **Select**; CLI: `selection` | 0.2.0 |
| Edits glow | Shapes an agent adds or changes glow briefly, tagged with its name, in every open tab. | **On the canvas** | 0.2.0 |
| [Plans: views of a system of record](agents.html#plans-a-canvas-over-a-system-of-record) | Bind a canvas to a project kept elsewhere and see it as a board, gantt, timeline, dependency graph or table that follows upstream changes and writes a person's drags and edits back. | **Plan menu · Details card**; CLI: `plan bind SOURCE REF` · `plan sync` · `new NAME --plan SOURCE REF` | 0.15.0 |
| [Views as specs](agents.html#plans-a-canvas-over-a-system-of-record) | Agents compose and reshape plan views by writing small declarative specs from a catalog: group by any option field, swimlanes, filter, sort, card fields, roll-ups, a real date axis. A spec that doesn't fit is refused with what would. | **Plan menu**; CLI: `plan catalog` · `plan view add KIND` · `plan view set ID` · `plan view put FILE` · `plan view rm ID` | 0.15.0 |
| [Writing the plan from the canvas](agents.html#plans-a-canvas-over-a-system-of-record) | An agent updates the system of record through the same versioned write as a person's gesture; a conflict or refusal puts the canvas back to upstream and tells people. | **Notice above the canvas**; CLI: `plan items` · `plan set ITEM field=value` · `plan add --title T` · `plan dismiss` | 0.15.0 |

## Reading a diagram

| Feature | What it does | Where | Since |
|---|---|---|---:|
| [Details cards](tour.html#short-boxes-with-the-rest-a-click-away) | Boxes stay short; select one and a card opens with what's behind it, its open threads, and jumps to related boxes. | **Select a box** | 0.7.0 |
| [Formats: story, ideas, system](tour.html#short-boxes-with-the-rest-a-click-away) | Give a canvas a format and ← and → walk it from the card, along arrows or a frame. | **Format menu**; CLI: `meta --canvas-format story\|ideas\|system` | 0.7.0 |
| [Zoomed-out system view](tour.html#zoom-out-on-a-system) (tldraw) | Zoom out on a system diagram to see its frames, how many parts each holds, and the connections between them. | **Zoom out** | 0.7.0 |
| [References panel](agents.html#references-what-people-read-beside-the-canvas) | Read files, the project's docs and web pages beside the canvas without leaving it; agents can show you what they wrote. | **References**; CLI: `references` · `show REF\|PATH\|URL` | 0.10.0 |

## Tidying and checking

| Feature | What it does | Where | Since |
|---|---|---|---:|
| [Routines](tour.html#tidy-it-up) | Chores banked once and run from a menu, the chat (/name) or the CLI, each one undoable in a single step; grouped by kind (tidy, arrows, layout, style, content, check), each saying when to use it. | **Routines menu**; CLI: `routine list [--kind K]` · `routine run NAME` | 0.3.0 |
| [Clean up and the tidying set](tour.html#tidy-it-up) | Clean up, Lay it out again, Line things up, Even out the gaps, Match box sizes, Fix overlaps, Fit frames, Neat arrows, Colour by frame, Tidy arrows. All run on Excalidraw too. | **Routines menu**; CLI: `routine run clean-up` | 0.7.0 |
| Routines from real work | Arrows to links, Fit text, Clear arrow labels, Frame these, Stack frames and Open out details: chores agents kept doing by hand. | **Routines menu**; CLI: `routine run NAME` | 0.13.0 |
| [Air out](tour.html#air-out-a-dense-diagram) | Moves long text from crowded boxes into their details, enlarges names and spreads things a little. | **Routines menu**; CLI: `routine run air-out` | 0.7.0 |
| [Check this diagram](tour.html#tidy-it-up) | Scores what's drawn out of 100 and names the shapes at fault (overlaps, arrows through boxes, labels on boxes or crossed by other arrows), so an agent can fix what it finds. | **Routines menu**; CLI: `routine run check-diagram` | 0.7.0 |
| [Bank your own routine](agents.html#routines-chores-worth-keeping) | Ask the chat to make a chore a routine, paste code, or save one from the CLI; it appears in the menu for every canvas. | **Chat · Routines menu**; CLI: `routine save NAME FILE` | 0.3.0 |
| [Routines learned from work](agents.html#routines-chores-worth-keeping) | A work log of what agents do on canvases; toucan suggests the code they keep writing by hand as routines to bank, and shows which routines get used. | **Routines menu: From your work**; CLI: `routine suggest` · `routine stats` · `routine learn --codex` | 0.13.0 |
| [Canvas scripts](agents.html#canvas-scripts-growing-features) | Persistent behaviour stored with a canvas, such as a button that re-routes arrows. | CLI: `script list\|put\|rm` | 0.1.0 |
| Timeline-aware tidying | On a timeline, tidying keeps dates where they are: positions and widths are dates. | — | 0.7.0 |

## History and safety

| Feature | What it does | Where | Since |
|---|---|---|---:|
| [History and restore](tour.html#go-back) | Every canvas keeps versions, whoever made the change. Step through them read-only over the live canvas and restore one; a restore can be undone. | **History**; CLI: `versions` · `versions save LABEL` · `versions restore N` | 0.3.0 |
| [One undo per agent action](agents.html#what-people-see-presence-and-undo) | An agent's run, a routine or an accepted proposal is a single undo step. | **⌘Z** | 0.2.0 |
| [While you were away](agents.html#headless-mode) | Edits agents made with no tab open are logged and announced when you come back. | **Banner**; CLI: `log [--since T]` | 0.2.0 |
| [A folder per canvas](agents.html#files-what-you-write-for-a-canvas) | What agents write for a canvas goes in its own folder, archived with it, and nowhere else in the data directory. | CLI: `files` | 0.6.0 |

## For agents: CLI and MCP

| Feature | What it does | Where | Since |
|---|---|---|---:|
| [The toucan CLI](agents.html#the-cli) | Read a canvas, run JavaScript in the live editor, screenshot it, and merge diagrams in by key, from any terminal agent. | CLI: `summary` · `exec` · `screenshot` · `import` · `graph` | 0.1.0 |
| [Describe it as data](tour.html#describe-it-as-data) | An agent describes a diagram and a layout engine places it, which is why drawing takes seconds. | CLI: `draw FILE [--update]` | 0.7.0 |
| [Connect your agents](quickstart.html) | Teaches Claude Code, Codex, Gemini CLI, pi, Cursor, opencode and Claude Desktop to use toucan, by skill or MCP. | CLI: `agents [install\|remove]` | 0.8.0 |
| [MCP server](quickstart.html) | For agents that can't run the CLI, including Codex in its default sandbox. | CLI: `mcp` | 0.8.0 |
| [A canvas per project](quickstart.html) | toucan init finds or makes the canvas for the repository you're in; commands there use it without --canvas. | CLI: `init [NAME] --open` | 0.8.0 |
| [Headless mode](agents.html#headless-mode) | With no tab open, agents still read and edit: the server runs the canvas in its own headless page. | CLI: `start --headless` | 0.2.0 |
| [Node client and extensions](extending.html) | A Node client for scripts, and toucan X runs toucan-X so extensions live in their own repos. | CLI: `toucan-X` | 0.1.0 |

## Formats in and out

| Feature | What it does | Where | Since |
|---|---|---|---:|
| Animated build | A GIF of the diagram building up box by box, in the order the arrows go, to drop into a doc, a slide or a chat. | **Animate**; CLI: `animate [OUT.gif]` | 0.14.0 |
| [Mermaid in and out](tour.html#or-as-mermaid) | Paste or import Mermaid: on a blank canvas it looks like a template, and on a full one it merges by key. | **Chat: paste**; CLI: `import FILE --format mermaid` · `graph --format mermaid` | 0.1.0 |
| [JSON Canvas, Excalidraw, DOT](tour.html#or-as-mermaid) | Import and export JSON Canvas (Obsidian) and .excalidraw; export DOT. | CLI: `import` · `graph --format jsoncanvas\|excalidraw\|dot` | 0.1.0 |
| [Toucan graph](agents.html#graphs-the-engine-neutral-path) | An engine-neutral graph format, with keyed upsert import and automatic layout. | CLI: `graph` · `import --format tg` | 0.1.0 |
| [A plan as a file](extending.html#plan-sources) | The built-in file source: a plan in one JSON file in the canvas's files or its project, rewritten by edits on the canvas, with nothing else installed. | CLI: `plan bind file files/PATH` · `sources` | 0.15.0 |

## Installing and running

| Feature | What it does | Where | Since |
|---|---|---|---:|
| [One-line install](quickstart.html) | Installs a prebuilt release, starts the server, connects your agents and opens a first canvas. | CLI: `curl … install.sh \| sh` · `update` | 0.8.0 |
| [Setup and doctor](quickstart.html) | setup asks nothing, so an agent can run it; doctor says what's wrong and what to do. | CLI: `setup` · `doctor` · `status` · `open` · `guide` | 0.8.0 |
| [A server that looks after itself](how-it-works.html) | Commands start a background server when needed, and never fight one you run yourself. | CLI: `start` · `stop` · `restart` · `start --take-over` | 0.8.0 |
| [Remote and behind a proxy](how-it-works.html) | Run on another machine or behind a reverse proxy, with the address people browse and the names it answers to. | **Sign-in page**; CLI: `--public-url` · `--allow-host` · `TOUCAN_URL` · `TOUCAN_TOKEN` | 0.11.0 |
| [Plugins](extending.html#plugins) | One mechanism for programs on PATH that connect toucan to your own systems (agent profiles, plan sources), with one trust rule; lists what was found and, for anything refused, why. | CLI: `plugins` · `sources` · `profiles` | 0.15.0 |

*60 features. The list is built from `website/work/features.json`; [the changelog](https://github.com/lavallee/toucan/blob/main/CHANGELOG.md) has the detail.*
