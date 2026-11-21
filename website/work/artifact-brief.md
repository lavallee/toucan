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

The feature edit starts with the finished recipe cards, then cuts from each prompt directly to the
agent’s canvas change. Use a tight crop for proof and large type for the beat to remember. Keep the
baked caption out of the new crop, credit tldraw, and label the real session as edited for time.
Check the first frame, both before-and-after cuts, and the oven and hosting close-ups at phone size
with sound off. The original score has no narration.

The cut list is pinned to the original 1600×1000 take. To re-export all three formats, use Node,
FFmpeg, and Chromium from the repository checkout.

```sh
git show 1578b4d143dbb72f82b56df2ee5dc9353ba7ad6d:website/site/assets/use-cases/thanksgiving-dinner.mp4 > website/work/thanksgiving-capture.mp4
node scripts/thanksgiving/social.mjs website/work/thanksgiving-capture.mp4
```

Set `CHROMIUM` if using a system Chromium. The project site uses the single landscape film at every viewport. The 4:5 and 9:16 social
exports go to the ignored `website/work/thanksgiving-social/` directory for channel-specific
handoff. Only the project-site film and its poster go in `site/`.

Fresh recordings write to the same ignored capture path.
They require new selects in `scripts/thanksgiving/social.mjs` because prompt and agent timing varies.

## Sources

The repo itself: `AGENTS.md` (mirrored on the agent guide page), `README.md`, `server/`, `lib/tg.mjs`.
Keep the pages in step with them on every behaviour change.
