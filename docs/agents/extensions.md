# Profiles, routines, reflexes, and scripts

## Profiles: working with a named agent

A canvas can work with a particular agent rather than toucan's general-purpose one: a CEO agent with its charter, a researcher with
its notebook. That agent is a **profile**: who it is, its own folder, what it reads at the start of a conversation, its skills, and the
folders people may read beside the canvas. Bind a canvas to one with `toucan meta --profile SOURCE/ID`
or the picker in the chat panel's header, and the canvas's chat and comment threads become that agent: its briefing and starting
context are loaded, people see its name on the canvas, and its shared folders appear in References as `agent/…`. Switching starts a new
conversation; each agent's earlier one is kept. `--profile none` goes back to toucan's own agent.

The quickest profile is one made from the agent's folder: `toucan profiles add ID --workdir DIR` writes `<data>/_profiles/ID.json`
(`local/ID`), starting from the folder's `AGENTS.md` or `CLAUDE.md`, and checks it first. Profiles come from sources:
`<data>/_profiles/ID.json` is `local/ID`. Any program on PATH named `toucan-profiles-NAME` is a source too (a plugin: `toucan plugins`
lists the ones found, and says why one was refused):
it answers `list` with `{"profiles": [{"id", "name", "description"}]}` and `get ID` with a profile, so a registry of agents plugs in
without toucan knowing about it. A profile (`toucan.profile/1`):

```json
{ "name": "Kiefer", "description": "Foundation strategy research", "workdir": "/home/me/Projects/kiefer",
  "instructions": "Who you are, how you work, and what you may and may not do.",
  "context": [{ "path": "AGENTS.md" }, { "path": "notebooks/strategy/CHARTER.md", "label": "Charter" }],
  "skills": [{ "path": "skills/board-brief" }],
  "references": ["notebooks/strategy/questions"],
  "budget": 24000 }
```

Paths are relative to `workdir`. Context and shared folders must be inside it and not hidden, and context is read within `budget`
characters, with anything missing reported. A profile grants no writing: the agent writes in the canvas's files folder like any chat
agent, since anyone who can reach the server can bind a profile. Sources are only looked for in PATH folders an agent can't write to.
`toucan profiles` lists every source's profiles, and `toucan --canvas NAME profile` shows what the bound one reads and its skills.

## Routines: chores worth keeping

A **routine** is a chore banked once and run on any canvas, from the person's **Routines** menu or the CLI. A
canvas script is lasting behaviour on one canvas (a button, an overlay, a reaction); a routine runs once, when
asked, anywhere. Each has a **kind**, and `routine list` groups them by it, with when to use each:

- **tidy**: `clean-up` (prefer it when someone says "tidy this": it keeps their arrangement, and never leaves the score lower), `align-boxes`, `distribute-evenly`,
  `match-sizes`, `fix-overlaps`, `fit-frames`, `fit-text`
- **arrows**: `neat-arrows`, `tidy-arrows`, `clear-arrow-labels`, `arrows-to-links` (long arrows become see-also links), `straighten-lines`
- **layout**: `lay-out-again` (rearranges everything, or one frame's contents with `--args '{"within": "KEY"}'`, and keeps arrows
  someone curved or routed by hand), `frame-these`, `stack-frames`, `air-out`
- **style**: `colour-by-frame`; **content**: `open-details` (the reverse of air-out); **check**: `check-diagram` (changes nothing)

All but `clear-arrow-labels` run on both engines (Excalidraw always puts an arrow's label at its middle). Run one rather than writing that code yourself: `routine run NAME --args '{"…": …}'` for those that take arguments
(`routine list` says which). toucan also learns routines from work. Every run that changes a canvas goes into a work log, and
`routine suggest` finds the code agents keep writing by hand, grouped by what it does, with the routines that already do it.
A habit no routine covers is worth banking; people see the same suggestions in their Routines menu, with **Bank it**, which
asks the chat agent to. `routine learn --codex` brings in the chat agent's past sessions, and `routine stats` says which
routines get used, by whom, and how often they fail.

```js
// routine: Colour the blocked boxes
// description: Turn every box mentioning "blocked" red.
// engines: tldraw
// kind: style
// when: Someone wants blocked work to stand out.

const hits = editor.getCurrentPageShapes().filter((s) => s.type === 'geo' && /blocked/i.test(toucan.text(s)))
editor.updateShapes(hits.map((s) => ({ id: s.id, type: s.type, props: { color: 'red' } })))
return { summary: `${hits.length} boxes coloured` }
```

It is the body of an async function with `editor`, `tl`, `toucan` and `args` in scope, and it runs through the
exec path: one undo step, glowing edits, a labelled version. The `summary` it returns is what the person sees.

- **When a person says "bank that", or keeps asking for the same chore:** write it to a file, try it with
  `exec`, then `toucan routine save NAME FILE --title "…" --description "…" --engines tldraw --kind style --when "…"`. Prefer
  `toucan.*` helpers that work on both engines (`graph`, `applyGraph`, `remove`, `selection`), and say `--engines tldraw, excalidraw`
  when it does. It must work
  from what it finds on the canvas, not from this conversation. Banked routines live in `<data>/_routines/`,
  shared by every canvas on the server; banking under a shipped routine's name replaces it there.
- **Before doing a chore by hand:** check `routine list`, then `toucan --canvas NAME routine run NAME`.
- Never remove a routine you didn't bank unless asked.

## Reflexes: what the canvas does by itself

A **reflex** answers something that happens to a canvas, the moment it happens, without calling you: a box whose text
outgrew it is fitted, a frame that cuts off what's in it grows. A canvas has one tree of them, empty at first. Whatever
the tree can't answer it **asks** you about, and what you work out can come back as a new reflex, so the next time the
canvas answers by itself. The idea is Sihan Xu's "growing behavior tree" ([blog](https://sihanxu.me/harnesstree/)) and
the reactive layer of [The Harness](https://github.com/EvolvingLMMs-Lab/the-harness) by LMMs-Lab: the tree handles what
happens to the agent, the model what it sets out to do, and "the bigger the tree, the quieter the model".

A node is `{ name, about, when, do, under, status }`:

- `when` is the body of a function of `view` that returns the situations the canvas is in **now**: nothing, `true`, or a
  list of `{ on: [keys], text }` (one per box with the problem). It is judged a moment after edits go quiet, so it says
  what is the case, not what just happened. It must be quick and change nothing. `view` has `items(kind)`, `get(key)`,
  `arrows()`, `findings(kind)` (from `toucan.measure()`, measured once per judgement), `notes()`, `engine`, and
  `toucan`/`editor` for anything else. A plan's shapes are left out of all of it.
- `do` is the answer: `--routine NAME` (it gets the situation's shapes as `args.on`; fit-text and fit-frames touch only
  those), `--do CODE` (a function body with `situations`, `editor`, `tl` and `toucan` in scope), or `--tell` (ask the
  agent). A node with no answer only groups the ones under it.
- `--under NODE` puts it under another: it is judged only while that one holds, and answers before it. Order is
  priority: among nodes at one place the earlier takes a situation from the later. A new node goes under the narrowest
  node its situation falls in.

How it behaves, because a person is editing the same canvas:

- A reflex answers a situation **when it begins**, once. What was already the case when it was switched on is left.
- It runs as an agent exec named **Reflex**: one undo step, glowing, labelled `reflex NAME` in the history. Nothing runs
  while someone is dragging or typing, while an agent is at work on the canvas, or with no tab open.
- If the situation is still there after it acted, it **failed**: the next node at its place or the node above may take it,
  and if none does, it asks. A situation back soon after a reflex settled it was most likely **undone**: the reflex
  leaves it, and after two it pauses itself and asks. More than eight runs in thirty seconds rests the tree for a minute.

What to do:

- **An ask** is in your brief ("Reflex ask #N"). Handle it like a request. If it will happen again, teach the canvas:
  `reflexes add NAME --when CODE --routine R --answers N`, then `reflexes try NAME`. `--answers` closes the ask.
- **What you add starts watching**: it is judged and counts what it would have done, and does nothing. Tell the person
  it's there; switching it on (`reflexes on NAME`, or **On** in the Reflexes menu) is theirs, unless they asked you to.
- **Try before you hand it over.** `reflexes try NAME --stage CODE` runs CODE on a hidden copy of the canvas to bring the
  situation about, judges, answers, and judges again: `passed` means the situation was over afterwards. The canvas
  itself never changes. Without `--stage` it tries on what's there now. (tldraw only; on Excalidraw it only judges.)
- `reflexes starters` lists ready ones (text-fits, frames-hold, arrows-clear under diagram-faults; new-notes on tldraw),
  and `reflexes suggest` names the ones worth having from work: a routine run by hand again and again on this canvas.
- `reflexes wake on` lets the tree hand an ask to a comment thread's agent by itself, at most one every ten minutes.
  It's off unless a person turns it on. Don't turn it on yourself.

A reflex is for what happens **to** the canvas. Something you set out to do, however often, is a routine.

## Canvas scripts (growing features)

A script is a function body run in the browser with `editor`, `tl`, `toucan` whenever the canvas
loads or scripts change; it may return a cleanup function. Use it for lasting behaviour (a button,
a live overlay, a reaction to edits). Example:

```js
const off = editor.sideEffects.registerAfterChangeHandler('shape', (prev, next) => { /* … */ })
return () => off()
```

For a chore someone runs now and then, like cleaning up arrows, bank a routine instead (above); a script is for behaviour that should always be there.
