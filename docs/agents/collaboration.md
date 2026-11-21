# Working with people on a canvas

## "This": what people have selected

When a person says "this", "these" or "that box", look at what they selected before guessing:
`toucan --canvas NAME selection` gives `here` (the selection in the tab your code runs in, which is the
person's most recently focused tab) and, on tldraw, `others` (each other person's selection, by name,
from live presence). `summary` also carries `selected` (keys) when anything is. If nothing is selected
and the reference is unclear, ask. In exec code: `toucan.selection()`. Excalidraw tabs share no presence,
so there `others` is always empty.

## Threads: comments on shapes and regions

People attach comments to a shape (or several) or a region of the page, and each one is a **thread**: a
back-and-forth that someone eventually closes. Threads live beside the canvas, not in it, so they work on both engines
and with no tab open, survive undo and version restores, and stay out of exports. The brief at the top of a chat
message lists the open ones.

- `toucan --canvas NAME threads` lists the open ones, each with `attached`: the shapes it's on as they are now, or what's
  inside its region. `threads show N` is one thread; `--all` includes closed ones.
- `threads reply N "what I did or found"` answers. The CLI speaks as the agent unless told `--as NAME`.
- `threads new "worth checking" --on KEY` raises something yourself, on a shape or `--region X,Y,W,H`.
- `threads close N --reply "done"` closes one. **Leave that to people** unless they ask, or it was your own.
- `threads adopt-notes` brings sticky notes in as threads attached to them, once each. The notes stay.

A person chooses who each message is for. **Agent** starts or steers that thread's own agent conversation, whose last
message in a turn becomes its reply there, so several threads can be worked at once. **Main chat** sends it to the chat
panel, where it adjusts the turn in progress if one is running; answer that with `threads reply`. **People** leaves it
for people. A reply in a closed thread reopens it.

## Notes: sticky notes addressed to you

On tldraw, **every sticky note (`note` shape) is addressed to the agent.** People pin one where a problem
is ("same thing? merge", "missing: thumbnail step") instead of describing it in chat, so its position is
part of the message. When asked to handle the notes:

1. `toucan --canvas NAME notes` lists the open ones: key, text, box, the frame it is `inside`, the shapes
   it is `on` (overlaps) and the ones `near` it (gap in px, and which side). Read "these" and "here" from
   that: a note between two boxes is about those two; one in empty space is about a step to add there.
2. Act on each note with your usual tools (`import`, `exec`), one note at a time.
3. `toucan --canvas NAME notes resolve KEY --reply "merged Blog and Cut-down into Publish"` marks it done:
   it turns green and gains your one-line reply. **Never delete or move a note.** If one is unclear, don't
   resolve it: ask the person about it and leave it open.

`notes --all` includes resolved ones; `summary` reports `openNotes` when there are any. In exec code:
`toucan.notes({all})` and `toucan.resolveNote(key, reply)`. Don't use note shapes for your own diagram
content (use `node`); a note is a person's message. Excalidraw has no sticky note, so notes are
tldraw-only for now.

## Proposals: dashed = proposed

When the person asks for an opinion or a broad change ("this isn't really a straight line", "what's
missing?"), answer on the canvas as a **proposal** they can take or leave, not as a finished edit:

- `toucan --canvas NAME import plan.mmd --propose`: what the import adds arrives dashed, as a proposal
  (what it updates is changed as usual).
- In exec code: `toucan.node(key, {..., proposed: true})`, `toucan.edge(a, b, {..., proposed: true})`, or
  `toucan.propose(...keys)` for shapes that already exist.

A proposal is drawn dashed and carries `meta.proposed` (Excalidraw: `customData.proposed`); a shape the
person drew dashed is not one. Frames, notes and text can't be dashed, so they can't be proposed. The
person sees a bar above the canvas with **Accept** (drawn solid again) and **Reject** (removed) for the
selected proposals, or all of them. Leave that choice to them: run `toucan proposals accept|reject
[KEY...]` only when asked. `toucan proposals` lists what is still open.

## What people see: presence and undo

- **New shapes come into view.** On tldraw, a run that adds shapes outside the view fits the canvas in view,
  unless the person is mid-gesture, so don't call `zoomTo` just to show your work.
- **People see you at work.** While you're busy on a canvas, every open tab shows it: a pill above the
  canvas with your name and what your current call does ("reading the notes", "importing plan.mmd", or
  your `--label`), a soft ring round the canvas, and your cursor on the shape you last changed or pointed
  at. It stays up for a few seconds after your last call, so the gaps while you think don't flicker. Name
  yourself with `--agent NAME` or `TOUCAN_AGENT` (the chat panel's agent is "Codex"; the default is "agent").
- **Say what you're about to do.** Before a change of several steps, or one that touches something the
  person is working on, run `toucan say "Merging Sign-in and Login page" --at sign_in,login_page`. Your
  line replaces the call's description in the pill and on your cursor, and `--at` moves your cursor to
  those shapes (and glows them), so the person sees the plan before the edit lands. Keep it short and
  concrete, one line per step, not a running commentary.
- **Your edits glow.** Shapes an exec adds or changes get a short violet halo, tagged with your name, in
  every open tab (both engines). `toucan.pulse(keys)` does the same on demand, to point at something.
- **One exec is one undo step** on tldraw: one Cmd-Z in the tab that ran it undoes the whole run, and it
  never merges with the person's previous action. So make one exec per idea (a feature, a fix) rather
  than many tiny ones, or one large one that mixes unrelated changes. Undo is per tab: another tab's
  Cmd-Z doesn't undo your run. On Excalidraw each `updateScene` call is its own undo step
  (`applyGraph` makes one), so batch your element changes into a single `updateScene`.

## What people do while you work

People keep editing while you work, and toucan tells you what they did, so you don't need to poll:

- **From the terminal or MCP.** Each command's answer comes with what people and other agents did on the canvas since
  your last command under the same `--agent` name: a `<canvas_activity>` block on stderr (with MCP, after the tool's
  result). It lists shapes added, changed (text, moved, resized, restyled, into or out of a frame) or removed, and by whom,
  what people selected, and comments they left. Your own edits aren't in it, and neither is what reflexes and a plan's sync
  do. Your first command on a canvas starts the count, and the server has to hold the canvas open (a tab on it). Agents that
  share a name share what they hear, so give yourself one with `--agent`. `TOUCAN_ACTIVITY=off` turns it off.
- **In the chat panel and comment threads.** The agent hears it between its commands, as a message added to the turn in
  progress, and the panel shows "Saw 2 changes on the canvas". A message sent mid-turn carries what is selected at that
  moment, so "this" means what the person is looking at now. A new turn starts with what changed since the last one,
  beside the brief.
- **What to do with it.** Fold it in and use your judgement. Keep their edits, don't put back what they removed, and
  don't re-import over a box they just rewrote. If it changes your plan, say so in your reply. If you can't tell what they
  want, ask. It needs no acknowledgement.

## Files: what you write for a canvas

Research, notes and helper scripts for a canvas go in `<data>/<name>.files/` (`toucan --canvas NAME files` gives the
path and what's there). Chat and thread agents can write there and not elsewhere in the data directory. Name the file in your reply so people can find it. The folder is
archived with the canvas.

## References: what people read beside the canvas

The **References** panel shows reference material without leaving the canvas: what you've written for it, the project it belongs to, and
pages on the web. A reference is `files/PATH` (this canvas's files folder), `project/PATH` (the project `init` linked the canvas to), or
`https://…`. Markdown renders, with its relative links and images working; so do PDFs, images, CSV tables, code and text. A web page is
fetched by the server and shown without running its scripts. Hidden files, build folders and anything outside those two folders can't be
read, and the server won't fetch pages on this machine or a private network.

- `toucan --canvas NAME show files/research.md` (or a path inside either folder, or a URL) opens it for everyone looking at the canvas. Do
  this after you write research or notes, or to put a source in front of someone. `toucan references` lists what can be shown.
- Point a box at what's behind it with `meta.refs`: `toucan.node(key, {meta: {refs: [{ref: 'project/docs/auth.md', label: 'How sign-in works'}]}})`.
  The box's details card lists them, and web addresses in `meta.detail` open in the panel too. People can also paste links onto the
  canvas: clicking one opens it beside the canvas.

## Versions: the evolution of a canvas

The server keeps a history of every canvas, on both engines, with or without a tab open. A version is saved
after an exec that changed something (runs in quick succession share one), when a person's edits go quiet (30 seconds, or every 5 minutes of
steady editing), when the last tab leaves, and when anyone names one. People step through them read-only in
the **History** panel, where the live canvas keeps running underneath.

- `toucan --canvas NAME versions` lists them, newest first: number, time, label, source, what changed.
- `versions save "before the reorg"`: name this moment before a sweeping change. Named versions are never thinned.
- `versions show N --format mermaid`: read an old version as a graph (any export format), to compare or recover part of it.
- `versions restore N`: put it back, for every open tab (they reconnect). **Only when asked.** What was there is
  saved first and a restore is a version too, so a restore can itself be undone by restoring the one before it.

Give an exec a `--label` ("colour the blocked boxes") so it reads well in the history; `import` and routines
label themselves. Old automatic versions are thinned: all of the last day, hourly for a week, daily after that.
Scripts, titles and chat threads aren't versioned.
