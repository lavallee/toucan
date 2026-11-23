# Command reference

## CLI

```
toucan guide [TOPIC]                                     # index, a topic, or the full guide with no arguments
toucan init [NAME] [--title T] [--template ID] [--engine E] [--open]   # find or make the canvas for the project you're in; later commands there use it
toucan open [NAME]                            # open it in the person's browser, signed in
toucan --canvas NAME summary [--within KEY]   # JSON of shapes (key, type, bounds, text, from/to)
toucan --canvas NAME exec -e 'CODE'           # run JS in the editor; `return` a JSON value
toucan --canvas NAME exec FILE.js             # same, from a file (use for anything > 1 line); --label names it in the history
toucan --canvas NAME screenshot [OUT.png]     # look at it (prints where it wrote; <=1800px)
toucan --canvas NAME animate [OUT.gif] [--step MS] [--hold MS] [--max PX]   # a GIF of the diagram building up, box by box along the arrows
toucan --canvas NAME export OUT [--format F] [--keys a,b]   # the canvas as a file, by OUT's ending: .svg .png .gif .mmd .canvas .dot .excalidraw .json .txt
toucan --canvas NAME describe                 # what the diagram says in plain words: frames, boxes, states, arrows; no tab needed
toucan --canvas NAME script list|put NAME FILE|rm NAME   # persistent canvas scripts
toucan canvases                               # every canvas: title, description, shapes, open tabs
toucan new NAME --title T [--engine tldraw|excalidraw] [--from CANVAS|FILE] [--canvas-format F]   # make a canvas
toucan --canvas NAME graph [--format tg|jsoncanvas|mermaid|dot|excalidraw] [OUT]   # export; no tab needed
toucan --canvas NAME import FILE|- [--format F] [--move] [--prune] [--propose] [--label T]   # keyed upsert of a graph file
toucan --canvas NAME meta --title T --description D [--canvas-format F]   # retitle / describe a canvas
toucan --canvas NAME proposals [accept|reject [KEY...]]   # dashed = proposed (see below)
toucan --canvas NAME selection                # what people selected: resolve "this" / "these"
toucan --canvas NAME notes [--all]            # sticky notes left for you, with what they're on/near
toucan --canvas NAME notes resolve KEY --reply TEXT   # mark one handled (green + reply)
toucan --canvas NAME log [--since 2h]           # edits agents made while nobody had it open
toucan --canvas NAME say TEXT [--at KEY,KEY]   # tell people what you're about to do; point at shapes
toucan --canvas NAME versions [save LABEL | show N [--format F] | restore N]   # the canvas's history
toucan routine list [--kind K] | show NAME | save NAME FILE [--title T] [--description D] [--engines E] [--kind K] [--when T] | rm NAME   # the routine bank, by kind
toucan routine suggest [--since 30d] | stats | learn --codex   # chores done by hand worth banking; how routines are used; past chat work
toucan --canvas NAME routine run NAME [--args JSON]   # run a banked routine: one undo step, on the history
toucan --canvas NAME reflexes [--json] | starters | asks [--all] | suggest   # what the canvas does by itself, and what it's asking about
toucan --canvas NAME reflexes add NAME --when CODE (--routine R | --do CODE | --tell) [--under NODE] [--answers ASK]   # teach it one (it starts watching)
toucan --canvas NAME reflexes try NAME [--stage CODE] | on|watch|off NAME | rm NAME | asks dismiss ID | wake on|off
toucan --canvas NAME files                     # where this canvas keeps what agents write for it
toucan --canvas NAME references                # what people can read beside the canvas: its files, its project's, links on it
toucan --canvas NAME show REF|PATH|URL           # open it for people in the References panel
toucan profiles                                   # the named agents a canvas can work with, from every source
toucan profiles add ID --workdir DIR [--context F,F]   # a profile of your own, from the agent's folder (starts from its AGENTS.md)
toucan --canvas NAME meta --profile SOURCE/ID|none   # work on the canvas with one: its knowledge, briefing and skills
toucan --canvas NAME profile                     # the agent the canvas works with: what it reads at the start, and its skills
toucan plugins                                    # every plugin on PATH by kind (agent profiles, plan sources), and any refused, with why
toucan sources                                    # where plans come from: the file source and toucan-source-* plugins, with what each lists
toucan --canvas NAME plan [bind SOURCE REF [--views board,gantt] | unbind | sync | dismiss]   # the plan a canvas shows views of
toucan --canvas NAME plan catalog | views | view add KIND [options] | view set ID [options] | view put FILE|- | view rm ID [--keep]
toucan --canvas NAME plan items [--json] | set ITEM field=value... | add --title T [field=value...]   # the work itself, written upstream
toucan templates                                  # blocks and starters; `new NAME --template ID` makes a canvas from one
toucan --canvas NAME add ID                       # add a block or starter beside what's on the canvas
toucan templates show ID                          # a template's description, to copy the form of
toucan --canvas NAME draw FILE|- [--update] [--move] [--label T]   # lay out a diagram described as data onto a canvas
toucan --canvas NAME threads [--all] | show N | new TEXT --on KEY,KEY | --region X,Y,W,H [--ask] | reply N TEXT [--ask] | close N [--reply T] | reopen N | adopt-notes   # comment threads
```

There can be many canvases, each on one engine (tldraw or Excalidraw); name one with `--canvas` or `TOUCAN_CANVAS`, or be inside a project
that `init` has linked to one. From a terminal agent, start with `toucan init --open` and tell the person what you're drawing. `init` adds
nothing to the repository; to keep a diagram there, write it out with `graph`. The server starts itself when a command needs it. In the chat
panel, work on the canvas the chat belongs to unless the user names another. Never archive a canvas unless asked.

Any other command `X` runs an extension, `toucan-X`, from PATH. Programs named `toucan-profiles-NAME` (agent profiles) and
`toucan-source-NAME` (plan sources) are plugins the server runs: `toucan plugins` lists them. A deployment can add its own agent
notes as `AGENTS.md` in its data directory; the chat agent is told where they are.

`versions` and the routine bank work against the server alone; `routine run` needs a tab like `exec`.

Screenshot review is available through `toucan --canvas NAME review`. Use `review post` to publish an
image, `review inbox PRODUCER` for feedback on that producer's revisions, and `review reply` to answer a note.
Run `toucan help` for arguments. The [review protocol](https://lavallee.github.io/toucan/extending.html#screenshot-review) also supports external adapters.

## Headless mode

A server started by toucan has this on; one a person runs themselves has it only if started with `--headless`. Then `exec`, `summary`, `screenshot` and `import` still work
when nobody has the canvas open: the server opens it in headless Chromium, using the browser already on the machine (the first call takes a
second or two), and closes it when idle. A person's tab is always used first. `toucan canvases` shows
`open` (people's tabs) and `headless` (whether the server's page is up). Without headless mode, those
commands fail with "no browser tab has canvas … open"; open it with `toucan open NAME`, or ask the person to open the link from
`toucan url --canvas NAME`.

Nobody watches a headless edit land, so each one goes on the canvas's trail, and the next person to
open the canvas is told how many there were. Make them easy to read: one purpose per exec, keyed
shapes, and an `import` of a named Mermaid file rather than an opaque blob of code.
