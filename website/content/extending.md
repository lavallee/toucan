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

## Plugins

A plugin is a program on your PATH that toucan runs to reach something of yours: your agents, your project-management system.
toucan knows nothing about either. It knows *kinds* of plugin, and each kind is a name prefix and a few verbs:

| Kind | Program | What it gives toucan | Verbs |
|---|---|---|---|
| Agent profiles | `toucan-profiles-NAME` | named agents a canvas can work with | `list`, `get ID` |
| Plan sources | `toucan-source-NAME` | plans a canvas shows views of, and writes to | `list`, `read -- REF`, `changes --after CURSOR -- REF`, `write -- REF` |

Every kind works the same way, so one written for either looks like the other:

- **A verb is an argument; the answer is JSON on stdout, exit 0.** Anything a verb needs beyond its arguments comes on stdin, as JSON.
- **A failure is a non-zero exit, with the reason on stderr**: one JSON object `{"error": CODE, "message": TEXT}`, where `CODE` is
  `not_found`, `invalid`, `conflict`, `forbidden` or `unavailable`. Plain text is tolerated and treated as `unavailable`.
- **`describe` is optional**: `{"name": "…", "description": "…", "version": "…"}`, shown by `toucan plugins`. A plugin that doesn't
  answer it is listed all the same.
- **Arguments are the verb, then options, then `--`, then what the verb is about.** Whatever follows `--` is never an option,
  however it looks, and a plugin must read it that way: a plan's `REF` comes from whoever bound the canvas. toucan also
  refuses a `REF`, or a plugin name, that starts with `-`.
- **Every call has a time limit**: `describe` 4 seconds; for plan sources `list` 15, `read` 30, `changes` 8 and `write` 30; for
  profile sources 15. A plugin runs in a process group of its own, and one that runs out of time is killed with everything
  it started (the whole group), and the call fails as `unavailable`.
- **The environment says which protocol is spoken**: `TOUCAN_SOURCE_PROTOCOL=1` for a plan source, `TOUCAN_PROFILES_PROTOCOL=1`
  for a profile source, on top of the server's own environment.
- toucan never runs a plugin through a shell, and checks whatever comes back. What `describe` said is kept until the
  program's file changes.
- A plugin can be written in anything. `NAME` is letters, digits, `-` and `_`; an extension (`.mjs`, `.py`, `.sh`) is ignored.

**Where toucan looks.** The server runs plugins outside any agent's sandbox, so it only trusts ones an agent, or another user,
couldn't have put there. The folder must be on PATH as an absolute path, and:

- outside toucan's own folder and its data directory;
- not a `node_modules` folder or anywhere inside one (`node_modules/.bin` included): that is where installing a package puts
  programs;
- owned by you or by root, and not writable by your group or by everyone;
- under folders of which the same is true, every one up to the root. A folder above that anyone can write to is accepted
  only if it is sticky, as `/tmp` is, since nobody can replace another user's folder there.

The program itself, once links are followed, must be a file under the same rule, in a folder under the same rule. So a
program that is a link into a `node_modules` (what a package manager's global install leaves in its `bin`) is refused: put a
copy, or a two-line wrapper script, in a folder of your own such as `~/.local/bin`. The first of a name on PATH wins. The
server reads PATH as it was when the server started, so put the folder on PATH for the server, not just your shell
(`toucan restart` from a shell that has it).

**When one isn't found.** `toucan plugins` lists every kind, the plugins found for it (with what each says of itself), and
any that were on PATH but refused, with the reason and usually the fix:

```sh
$ toucan plugins
…
  "refused": [{ "name": "acme", "path": "/opt/tools/toucan-source-acme",
                "reason": "its folder can be written to by other users (chmod go-w /opt/tools)" }]
```

The reasons are: the folder is a relative PATH entry, is inside toucan's folder or data, is or is inside a `node_modules`,
belongs to another user, is writable by others, or is under a folder that is one of the last two (the reason names that
folder); the program isn't executable, isn't a file, belongs to another user, or links to somewhere not trusted; another of the
same name comes first on PATH; or the name is taken by a built-in (`local` for profiles, `file` for plan sources).
`toucan plugins` also lists extension commands, below.

A new kind of plugin is an entry in `server/plugins.mjs` and the code that calls it; finding, trusting, running and listing
come with the entry. Plugins are published with the systems they speak for, not with toucan.

### Extension commands

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

An extension command is the simplest sort of plugin: the CLI runs it as you, with your terminal, so it follows no protocol and
needs no trust rule.

### Profile sources

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
be a whole disk or a home folder, and a profile grants no writing. Sources are found again each minute, and a profile
is kept for a minute, with the last good one kept if a source falters.

### Plan sources

A plan source lets a canvas show views of a project kept somewhere else (a board, a gantt, a timeline, a dependency graph, a
table) and writes a person's edits to those views back. The principles: the source is the system of record and the canvas
holds views of it; a view is a small declarative spec, never values; a gesture on the canvas is a named field change, not
geometry; a write quotes the version it was made against, and when the source refuses, the canvas goes back to what the
source says. The [agent guide](agents.html) covers views and the `plan` commands. This is the contract a source keeps.

`toucan-source-NAME` answers four verbs. `REF` names one plan in your system and is opaque to toucan (a project id, a path).

```sh
toucan-source-NAME list                           # {"sources": [{"ref": "…", "title": "…", "description": "…"}]}
toucan-source-NAME read -- REF                    # a plan (below)
toucan-source-NAME changes --after CURSOR -- REF  # {"cursor": "…", "changed": true}
toucan-source-NAME write -- REF  < changes.json   # {"cursor": "…", "results": […]}
```

These are the arguments exactly as toucan sends them. `REF` is always the one argument after `--`: take it from there and
never read it as an option, since it is typed by whoever binds a canvas. toucan refuses a `REF` that starts with `-` before
your program runs. `CURSOR` is the value of `--after`; one that starts with `-` is sent as a single argument,
`--after=CURSOR`, so accept both forms. The first `changes` after a bind may carry an empty cursor.

`cursor` is any string that changes when the plan does. toucan calls `changes` every few seconds while someone has the canvas
open, so make it cheap: it only says whether anything in this plan changed after `CURSOR`. When it has, toucan calls `read`.

**A plan** (`"plan": 1`):

```json
{
  "plan": 1,
  "source": { "ref": "acme/relaunch", "title": "Website relaunch", "description": "", "readonly": false },
  "cursor": "184",
  "fields": [
    { "id": "title",    "label": "Title",    "type": "text",   "writable": true },
    { "id": "stage",    "label": "Stage",    "type": "option", "writable": true,
      "options": [ { "id": "todo", "label": "To do", "color": "grey" },
                   { "id": "doing", "label": "In progress", "color": "blue" },
                   { "id": "done", "label": "Done", "color": "green", "done": true } ] },
    { "id": "assignee", "label": "Owner",    "type": "option", "writable": true, "options": [ { "id": "p1", "label": "Ada" } ] },
    { "id": "start",    "label": "Start",    "type": "date",   "writable": true },
    { "id": "end",      "label": "End",      "type": "date",   "writable": true },
    { "id": "points",   "label": "Points",   "type": "number", "writable": true },
    { "id": "epic",     "label": "Epic",     "type": "option", "writable": true, "items": true },
    { "id": "labels",   "label": "Labels",   "type": "options", "writable": false, "options": [ { "id": "l1", "label": "Content" } ] }
  ],
  "items": [
    { "id": "ab12", "version": 3, "title": "Draft the sitemap", "detail": "long text",
      "stage": "doing", "assignee": "p1", "start": "2026-11-20", "end": "2026-12-01", "points": 5, "epic": "zz01",
      "labels": ["l1"], "dependsOn": ["zz01"], "milestone": false, "done": false, "url": null }
  ]
}
```

- `items` come in the source's own manual order. `id` is stable. `version` changes on every write upstream, and is what a
  write must quote.
- **`fields` declares everything toucan may show, group by, filter, sort or write**, including fields only your system has:
  nothing in toucan knows a fixed list. A field's `type` is `text`, `option` (one of `options`), `options` (several), `date`
  (`YYYY-MM-DD`; a system that keeps instants gives the civil date in its own zone), `number` or `bool`. `writable: false`
  means toucan never offers or tries to write it. An option's `color` is one of toucan's colour names, and `done: true`
  marks an option that means finished. `"items": true` on an option field means its options are the plan's own items (a
  parent, an epic, a milestone): `options` can then be left out, and a gantt grouped by it heads each lane with a bar
  spanning the children.
- Item keys toucan gives meaning to without a declaration: `title`, `detail` (shown in the Details card), `dependsOn` (item
  ids; the arrows of a `graph` view and of a gantt with `dependencies`), `milestone` (exactly `true` draws a diamond, as does an
  item with a single date; any other value is ignored), `done`, `start` and `end` (a gantt's bars, exactly as long as the two
  are apart), `estimate` (minutes of work; an item dragged out of Unscheduled gets a day per 480 of them), `url`. Others (`stage`,
  `assignee`, `priority`, `labels`, `parent`) are conventions, used as defaults when declared. Anything else on an item, a field
  or `source` is kept and ignored.
- `null` or a missing value is "unset". Unset values group under their own column or lane.
- `source.readonly: true` means no writes at all.

**A write** arrives on stdin:

```json
{ "changes": [
  { "op": "update", "id": "ab12", "version": 3, "mutation": "c0ffee…",
    "set": { "stage": "done", "end": "2026-12-03" }, "place": { "after": "zz01" } },
  { "op": "create", "mutation": "…", "set": { "title": "New card", "stage": "todo" }, "place": { "after": null } }
] }
```

and is answered with:

```json
{ "cursor": "187", "results": [
  { "mutation": "c0ffee…", "ok": true,  "item": { "id": "ab12", "version": 4, "…": "the whole item, as it now stands" } },
  { "mutation": "…",       "ok": false, "error": "conflict", "message": "changed upstream", "item": { "…": "as it stands" } }
] }
```

- `set` carries only the fields that changed, in the plan's own ids and value forms; `null` clears one.
- `place` is optional: put the item directly after `after` in the source's order (`null`: first). A source may also accept
  `{"before": ID}` (`null`: last); toucan sends `after`. How rank is kept is the source's business.
- `version` is the one the person's card showed. If the item has moved on, answer `conflict` with the item as it stands.
- `mutation` is an idempotency key: toucan retries a write it couldn't complete with the same key, and the same change
  again must get the same answer and be applied once.
  A key is reused in exactly one case: a write toucan made for a person's gesture got no definite answer (the call failed or
  timed out, so nobody knows whether it was applied). toucan keeps that change's key in the canvas's binding, across restarts,
  and sends the same change under the same key when it tries again. A definite answer, success or refusal, retires the key.
- Changes stand alone: one failing doesn't stop the others.
- `item` is the item as it now is upstream, left out only when it no longer exists. There is no delete: removing work is
  decided in the system of record, and a shape deleted from a canvas simply comes back.
- After a write toucan reads the plan again, so a write that changes other items too (a reorder that re-ranks its
  neighbours) needs nothing special.

**The file source** needs no plugin: `toucan --canvas NAME plan bind file files/roadmap.plan.json` (or `project/PATH`) takes a
plan as a JSON file like the one above, without `cursor`. Edits on the canvas rewrite the file: versions are integers it
bumps, the cursor is a hash of the file, and the last 200 idempotency keys are kept in it under `"mutations"`. It is the
quickest way to try plans, and a fair way to keep a small project in a repository:

```sh
toucan new relaunch --plan file examples/website-relaunch.plan.json --views board,gantt
```

**An example to copy.** [`examples/toucan-source-example.mjs`](https://github.com/lavallee/toucan/blob/main/examples/toucan-source-example.mjs)
is a whole source in one file with no dependencies: two made-up projects kept in a JSON file, with fields of its own. It
answers every verb, checks versions, honours `mutation` and `place`, and fails with the codes above; toucan's own tests run
against it. Copy it somewhere on PATH as `toucan-source-NAME`, replace the part marked "your system", and check it with
`toucan plugins` and `toucan sources`:

```sh
cp examples/toucan-source-example.mjs ~/.local/bin/toucan-source-example && chmod +x ~/.local/bin/toucan-source-example
toucan plugins && toucan sources
toucan new garden --plan example demo/garden --views board,gantt
```

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
| `TOUCAN_PLAN_POLL` | `4000` | how often, in ms, a canvas someone has open asks its plan source whether anything changed; `0` turns polling off (`plan sync` still works) |
| `TOUCAN_PLAN_DEBUG` | none | `1` logs what each plan sync saw on the canvas and why it redrew |
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
