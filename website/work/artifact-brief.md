# Artifact brief

Private working document. Artoo keeps this file outside `site/`; it is not deployed.

## Reader decision

A developer or agent-tool user who found toucan on GitHub or lyra-forge.com, deciding whether to install
it, and then how to point their agent at a canvas.

## Headline claim

toucan lets a person and their agents edit one live canvas, through a small CLI, on subscriptions they
already have.

## Must not claim

- That it is safe to expose publicly; it is for your own machine or a trusted network.
- That tldraw is free for production use; it needs a licence key behind HTTPS.
- Presence, cursors or image sync on Excalidraw canvases.
- That the Explore page is toucan: it's a static copy, with no editing, comments or agents.

## Examples

`scripts/build-docs.mjs` makes the template catalog and canvas illustrations and the explorer maps, from a running toucan. Agent scenes are real turns, so don't hand-write what an agent said. Edit the canvas guide in `content/tour.md`. The template catalog in `content/gallery.md` is generated. `site/explorer.html` and `site/assets/explore.{js,css}` are hand-written.

`scripts/capture-use-cases.mjs` builds the examples for the landing page and Use cases in a
disposable Toucan instance. Run it after `npm run build`. The figures in `site/assets/use-cases/`
show synthetic projects recorded through the real canvas, plan, and review interfaces.

`scripts/capture-thanksgiving.mjs` records a two-turn Thanksgiving workflow in Toucan’s Codex chat.
The recipe summaries and schedule come from the agent, and the capture verifies both writes.
It also emits the illustrated board and stills. The timings are example equipment reservations.

Show the audience a real problem, the action they take, and the visible change it produces.
Keep the application window as their spatial anchor. Punch in only where the request is too
small to read, then return to the same canvas for the agent’s write. Ease into native details
when they explain how the plan works. Cut idle time and name the person or agent only when
their roles need to be clear. The final view answers why a canvas helps. The recipes stay in
place and the timing, oven changes, and parallel prep become visible below them.

The [Superhuman demo guide](https://blog.superhuman.com/how-to-create-remarkable-product-gifs/)
uses locked framing, tightly cut action, and selective zoom. [tldraw’s Make Real](https://tldraw.dev/blog/make-real-the-story-so-far)
shows the request and result in the canvas where the user continues to work.
[Ink & Switch’s Embark](https://www.inkandswitch.com/embark/) keeps one planning scenario across a series
of increasingly capable views. Apply those moves to the following recipe links and oven schedule.

After building Toucan, run this capture from the repository checkout with Node, FFmpeg, and
Chromium. Set `CODEX_BIN` to a signed-in Codex executable, `MEAL_LICENSE_ENV` to local tldraw
deployment configuration, and `CHROMIUM` if using a system Chromium.

```sh
node scripts/capture-thanksgiving.mjs website/work/thanksgiving-preview/session.mp4 website/work/thanksgiving-preview
node scripts/thanksgiving/feature.mjs website/work/thanksgiving-preview/session.mp4 scripts/thanksgiving/feature-selects.json website/work/thanksgiving-preview
```

The selects are pinned to the reviewed take. For a new take, use the saved cue times as a
starting point and verify the actual frame timestamps, then update the selects. Review the
render at phone and desktop size before copying the MP4, poster, board, and stills into
`site/assets/use-cases/`. The dinner page uses one film master.

The earlier social exports use the original take in commit `1578b4d`. Run
`scripts/thanksgiving/social.mjs` with that take to recreate local exports in
`website/work/thanksgiving-social/`.

## Sources

The repo itself: `AGENTS.md` (mirrored on the agent guide page), `README.md`, `server/`, `lib/tg.mjs`.
Keep the pages in step with them on every behaviour change.

## Homepage explainer study, November 2026

The reader arrives knowing what a whiteboard is. Give them evidence for what changes when someone else can work on the drawing with them. The original arrival view paired that promise with the recorded dinner assignment. The current lead is described below. Each following section answers a different practical question on the same page. Navigation is a shortcut for returning readers.

| Site inspected | What the reader encounters | Decision for Toucan |
| --- | --- | --- |
| [Linear](https://linear.app/) | The opening issue shows a conversation, agent work and a review state. Later sections walk through intake and other jobs with populated interfaces. | Pair each heading with an actual working state. Follow the co-edit film with the pinned review and the source-backed board move. |
| [Screen Studio](https://screen.studio/) | The zoom section starts with a legibility problem. The framing section places a 19-second example beside its layout choices. | Keep clips short and local to a claim. Keep native pause, replay and fullscreen controls so someone can inspect the change. |
| [Ink & Switch, Embark](https://www.inkandswitch.com/embark/) | A trip-planning problem introduces mentions, rich views and formulas. An outline and its map let the reader recognize the same trip as the explanation gets deeper. | Open with a single constraint. In the dinner film, the cards stay in place while the oven schedule appears below them. Offer the actual board alongside the recording. |

Trawler held resource IDs for these pages are respectively `0d09434b854f737445057985b685eda92cdca2f06a653d3d05e57c3917c3d1b8`, `bb0dc81dd5fd229c2004252c0a437dccd5f0bd22f8cadfe16da93e6b61424ae7`, and `17384e41cdc44eda8f6fa64255d8d60672603a42514ad8b42edfe1ca345b3998`. Linear’s held copy dates to July. Page observations above use the live November read.

The co-edit film is the captioned MP4 master from `scripts/capture-duplex.mjs`. The relaunch film uses frames from a real pointer drag in `scripts/capture-use-cases.mjs`; the capture checks the persisted task stage before encoding the final hold. The dinner film and stills retain their sources above.

## Fieldnote Radio and the Lyra identity

The opening now follows a fictional radio episode from a rough 20-minute assembly to an 18-minute air slot. Its three recording locations, interview cut, episode-page feedback and production handoff were written for Toucan. The hero shows a keyed CLI import on a live canvas. The co-edit chapter remains a separate recording of a real Codex turn. The board capture checks the stage in the plan file after the drag. Keep seasonal examples in Use cases.

Use Lyra Forge’s Admiralty colors and locally served Instrument Serif, Source Sans 3 and Fragment Mono across the collection and explorer. The rose review surface extends chart magenta as a light tint. Keep the OFL notices beside the fonts. The full Forging Ahead episode is the creator’s published player and opens on demand. Short demos remain locally served.

New documentation pages include `assets/admiralty.css`. Generated pages keep the same link in their generator. The homepage release number and tag link come from the package version through `npm run docs:version`. Follow RELEASING.md when preparing a release.

The parallel-thread and cleanup clips come from the public Forging Ahead Toucan walkthrough. The threads take starts two independent conversations about the booking system and accelerates the wait for replies. The routine take shows the real-time cleanup and undo. Introduce the episode as a video walkthrough of working in Toucan. The final documentation navigation groups pages by what the visitor wants to do. The shared footer uses the studio’s open-source catalog for related projects and links directly to the project and SDK license terms.

## Documentation content model

Keep existing public routes stable. Use each homepage chapter’s main link for an action a reader can finish. Link to full-size media in figures and offer downloads where the instructions use them.

| Reader’s question | Page responsible |
| --- | --- |
| What does working together look like? | Home shows a concrete change in each chapter and links directly to the related task or project. |
| How do I get a working canvas? | Quick start covers install, connection, first canvas and local server setup. |
| How do I do this on my canvas? | Canvas guide owns repeatable human tasks, their controls and their outcomes. |
| What did someone make? | Worked examples show a specific project, its constraint and its result. |
| Can I explore a finished drawing? | Sample canvases opens read-only, in-browser maps. |
| What can I start my drawing from? | Diagram templates lists editable starting layouts and creation commands. |
| Is this supported in my editor or release? | Feature index lists availability and links to the relevant instructions. |
| What can my agent call? | Agent CLI reference owns commands and conventions for working alongside people. |
| How can I integrate another tool? | Extension reference owns configuration and protocol contracts. |
| Why does the system work this way? | Architecture explains shipped internals. Design notes describe proposals and identify what already ships. |

[Docker Docs](https://docs.docker.com/) separates getting started, guides, manuals and reference. [Astro’s entry page](https://docs.astro.build/en/getting-started/) offers a first tutorial alongside task-oriented routes. [Diátaxis](https://diataxis.fr/) distinguishes a reader doing a task from a reader looking up a fact. For Toucan the practical split is between pinning feedback in Review, seeing how the radio producer used it, and writing an adapter that delivers the reply.
