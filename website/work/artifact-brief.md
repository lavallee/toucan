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

The site film opens on the rolls and turkey at different temperatures. The conflict makes the
one-oven constraint visible. We compared this opening against one that led with the finished
menu, and kept the finished menu as the poster. The two writes use the original Toucan recording.
Check the opening, the changes to the canvas, and the oven and hosting close-ups at phone size.

The edit uses selects from the original 1600×1000 take. To render and review locally, use Node,
FFmpeg, and Chromium from the repository checkout.

```sh
git show 1578b4d143dbb72f82b56df2ee5dc9353ba7ad6d:website/site/assets/use-cases/thanksgiving-dinner.mp4 > website/work/thanksgiving-capture.mp4
node scripts/thanksgiving/feature.mjs website/work/thanksgiving-capture.mp4 website/work/thanksgiving-preview
```

Set `CHROMIUM` if using system Chromium. Pass `result` as the third argument to compare the
alternate opening. After reviewing the rendered sequence, copy its MP4 and poster to
`site/assets/use-cases/`. Reopen the built page on desktop and phone and verify the single
embedded film. Publish through Artoo.

The previously produced social edits can be recreated with
`node scripts/thanksgiving/social.mjs website/work/thanksgiving-capture.mp4`. They go to the
ignored `website/work/thanksgiving-social/` folder for local handoff. Fresh captures require
new selects because the agent and typing timing varies.

## Sources

The repo itself: `AGENTS.md` (mirrored on the agent guide page), `README.md`, `server/`, `lib/tg.mjs`.
Keep the pages in step with them on every behaviour change.
