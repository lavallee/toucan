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

## Profile sources

A profile source serves agent profiles from somewhere you already keep them: a registry of your agents, a team directory, a
folder of agent repositories. It's any program on PATH named `toucan-profiles-NAME`, and its profiles are `NAME/ID`. toucan
asks it two things and expects JSON on stdout:

```sh
toucan-profiles-acme list       # {"profiles": [{"id": "reviewer", "name": "Reviewer", "description": "…"}]}
toucan-profiles-acme get ID     # one profile: name, workdir, instructions, context, skills, references (see the agent guide)
```

A failure is a non-zero exit with the reason on stderr, which toucan shows. A minimal source, here serving every folder in
`~/agents` that has an `AGENTS.md`:

```js
#!/usr/bin/env node
// toucan-profiles-mine: every agent folder in ~/agents
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const root = join(homedir(), 'agents')
const ids = readdirSync(root).filter((d) => existsSync(join(root, d, 'AGENTS.md')))
const [cmd, id] = process.argv.slice(2)
if (cmd === 'list') console.log(JSON.stringify({ profiles: ids.map((id) => ({ id, name: id })) }))
else if (cmd === 'get' && ids.includes(id)) console.log(JSON.stringify({ name: id, workdir: join(root, id), context: ['AGENTS.md'] }))
else (console.error(`no agent ${id}`), process.exit(1))
```

toucan checks whatever a source returns: context and shared folders must be inside `workdir` and not hidden, `workdir` can't
be a whole disk or a home folder, and a profile grants no writing. It looks for sources only in absolute PATH folders outside
toucan's own folder and its data that nobody else can write to, because it runs them outside any agent's sandbox. Sources
are found again each minute, and a profile is kept for a minute, with the last good one kept if a source falters.

## Deployment notes for agents

An `AGENTS.md` placed in the data directory is handed to the chat agent as extra instructions. Use it
to describe your house canvases and extension commands without forking toucan.

## Configuration

| Setting | Default | |
|---|---|---|
| `--host` / `TOUCAN_HOST` | `127.0.0.1` | interface to listen on |
| `--port` / `TOUCAN_PORT` | `8893` | |
| `--data` / `TOUCAN_DATA` | your data directory ([where things live](quickstart.html#where-things-live)) | where canvases, scripts and previews live |
| `TOUCAN_PUBLIC_HOST` | `127.0.0.1`, or the hostname when bound to all interfaces | host used in printed links |
| `--public-url` / `TOUCAN_PUBLIC_URL` | — | the address people reach the server at, like `http://toucan.example` behind a proxy; links, `toucan open` and `toucan url` use it, and the server answers to its name |
| `--allow-host` / `TOUCAN_HOSTS` | — | more names the server answers to, comma-separated; `.example.com` allows every name under it, `*` turns the check off |
| `TOUCAN_CANVAS` | none | default canvas for the CLI |
| `TOUCAN_URL` | from `~/.config/toucan/server.json` | server the CLI talks to; it won't start one |
| `TOUCAN_TOKEN` | from `~/.config/toucan/server.json` | with `TOUCAN_URL`: for a server on another machine or outside a container |
| `VITE_TLDRAW_LICENSE_KEY` | none | tldraw licence key, read at build time |

## Licences

toucan's own code is MIT. It builds on **tldraw**, which is not: the
[tldraw licence](https://github.com/tldraw/tldraw/blob/main/LICENSE.md) allows development use freely,
but production use (anything served over HTTPS) needs a licence key, including tldraw's free hobby
licence for non-commercial projects. Put the key in `.env` as `VITE_TLDRAW_LICENSE_KEY=…` and rebuild.
Excalidraw (MIT) needs no key.
