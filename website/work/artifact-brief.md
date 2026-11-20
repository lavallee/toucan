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
Run `scripts/thanksgiving/social.mjs` afterward to frame the recording for a 4:5 feed.

## Sources

The repo itself: `AGENTS.md` (mirrored on the agent guide page), `README.md`, `server/`, `lib/tg.mjs`.
Keep the pages in step with them on every behaviour change.
