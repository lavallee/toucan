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

`scripts/build-docs.mjs` makes the tour and gallery pages and the tour and gallery illustrations and the explorer maps, from a running toucan. Agent scenes are real turns, so don't hand-write what an agent said. Don't edit `content/tour.md` or `content/gallery.md` directly. `site/explorer.html` and `site/assets/explore.{js,css}` are hand-written.

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
`site/assets/use-cases/`. The site publishes one film through Artoo.

The earlier social exports use the original take in commit `1578b4d`. Run
`scripts/thanksgiving/social.mjs` with that take to recreate local exports in
`website/work/thanksgiving-social/`.

## Sources

The repo itself: `AGENTS.md` (mirrored on the agent guide page), `README.md`, `server/`, `lib/tg.mjs`.
Keep the pages in step with them on every behaviour change.
