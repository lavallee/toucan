# Extending

toucan stays small; the things specific to your work live outside it.

## Canvas scripts

A canvas script is a function body stored with one canvas and run in the browser whenever the canvas
loads or its scripts change. It may return a cleanup function. Ask the chat to "add a button that…" and
it will usually write one. Install one yourself with:

```sh
toucan --canvas NAME script put highlight-new highlight-new.js
```

## Routines

A script is behaviour one canvas always has. A chore you run now and then, on any canvas, is a **routine**:
a file banked once on the server, listed in the **Routines** menu of every canvas, and run with a click or
`toucan --canvas NAME routine run NAME` as one undo step. toucan ships **Tidy arrows**, which re-routes every
connected arrow (straight, curved or elbow, whichever is best) so fewer run through boxes or cross, without
moving a box; and **Straighten sketchy lines**. Bank your own by asking the chat to "bank that", by pasting
code into the menu, or with:

```sh
toucan routine save count-open count-open.js --title "Count open items" --description "How many boxes aren't green"
```

The file format is in the [agent guide](agents.html). Banked routines live in `<data>/_routines/`. How toucan
could notice a repeated chore and *offer* to bank it is sketched in [Habits](habits.html).

## Extension commands

`toucan X …` runs `toucan-X …` from your PATH, with `TOUCAN_CANVAS` (and `TOUCAN_URL`, if given) set.
That is how a domain-specific canvas, say a diagram generated from your own inventory, lives in its own
repo and still reads as part of toucan to agents. From Node, use the same client the CLI uses:

```js
import { connect } from 'toucan/client'   // or <toucan checkout>/lib/client.mjs
const t = connect({ canvas: process.env.TOUCAN_CANVAS })
await t.exec(`
  toucan.frame('cluster:web', { x: 0, y: 0, w: 800, h: 400, name: 'Web' })
  toucan.node('api', { parent: 'cluster:web', x: 40, y: 60, text: 'API' })
  return toucan.summary()
`)
```

Key every shape you generate, and let existing shapes keep their position (`toucan.node` does this
unless you pass `move: true`). A regenerated canvas then keeps whatever people rearranged or annotated.

## Deployment notes for agents

An `AGENTS.md` placed in the data directory is handed to the chat agent as extra instructions. Use it
to describe your house canvases and extension commands without forking toucan.

## Configuration

| Setting | Default | |
|---|---|---|
| `--host` / `TOUCAN_HOST` | `127.0.0.1` | interface to listen on |
| `--port` / `TOUCAN_PORT` | `8893` | |
| `--data` / `TOUCAN_DATA` | `canvases/` in the checkout | where canvases, scripts and previews live |
| `TOUCAN_PUBLIC_HOST` | `127.0.0.1`, or the hostname when bound to all interfaces | host used in printed links |
| `TOUCAN_CANVAS` | none | default canvas for the CLI |
| `TOUCAN_URL` | from `~/.config/toucan/server.json` | server the CLI talks to |
| `VITE_TLDRAW_LICENSE_KEY` | none | tldraw licence key, read at build time |

## Licences

toucan's own code is MIT. It builds on **tldraw**, which is not: the
[tldraw licence](https://github.com/tldraw/tldraw/blob/main/LICENSE.md) allows development use freely,
but production use (anything served over HTTPS) needs a licence key, including tldraw's free hobby
licence for non-commercial projects. Put the key in `.env` as `VITE_TLDRAW_LICENSE_KEY=…` and rebuild.
Excalidraw (MIT) needs no key.
