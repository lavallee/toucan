# Plan-backed canvases

## Plans: a canvas over a system of record

A canvas can show a **plan**: a project kept somewhere else (a file, or a project-management system reached through a plan source),
drawn as views that stay in step with it both ways. The plan is the system of record and the canvas holds views of it. When it
changes upstream the views are redrawn; when a person drags a card to another column, stretches a bar or retitles a box, that edit
is written upstream. A canvas has one plan and any number of views of it, beside whatever else is on it.

- `toucan sources` lists where plans can come from: the built-in `file` source (a plan as a JSON file, `files/PATH` in the canvas's
  files folder or `project/PATH` in its project; `examples/website-relaunch.plan.json` is one to try) and any `toucan-source-NAME`
  plugin, with the plans each lists. `toucan plugins` says which plugins were found, and why one wasn't trusted.
- `toucan --canvas NAME plan bind SOURCE REF [--views board,gantt]` binds the canvas (`--copy` copies a file plan given by path into
  the canvas's files, under a free name); `toucan new NAME --plan SOURCE REF --views board,gantt` makes a canvas that way. `plan`
  shows the source, when it last synced, the views and any problems; `plan sync` pulls now; `plan unbind` lets go, leaving the shapes
  as ordinary ones. `plan`, `plan items` and `plan views` ask the source whether it has moved and wait for the answer, so what they
  say is current with no tab open. `state` is about the data (`synced`: read and written); `drawn` says whether the views on the
  canvas show it yet, which with nobody there and no headless mode waits for the canvas to be opened.
- **You compose views by writing small specs, never by placing shapes.** The kinds are `board` (columns by an option field,
  optionally rows by another with `--lanes`), `gantt` (bars on a date axis, optionally lanes), `timeline` (dated items in order),
  `graph` (boxes and `dependsOn` arrows) and `table` (a row per item, a column per field). `plan view add KIND --group-by FIELD
  --filter 'stage!=done' --sort priority,-end --fields assignee,end --rollup count,sum:estimate`, `plan view set ID …` to change
  one, `plan view put FILE|-` for a whole spec as JSON, `plan view rm ID` (`--keep` leaves its shapes). **`plan catalog` lists every
  option of every kind**, and a spec that doesn't fit is refused with what would: an unknown field, a group-by that isn't an option
  field, a value that isn't one of the options. Fields are whatever the plan declares, including ones of its own: group, filter,
  sort and show any of them.
- **Change the work with `plan`, not with `exec`.** `plan items` lists the fields and items; `plan set ITEM stage=done end=2026-12-03`
  writes upstream (an option by its id or label; an empty value clears, as in `start= end=`; `--after ID` or `--first` places it)
  and `plan add --title T stage=todo` makes an item. They go through the same write as a person's drag, and the views follow. A
  refusal (`conflict`, `invalid`, `forbidden`) is the command's error: read it, and don't retry blindly.
- **Shapes keyed `plan:…` belong to the sync.** A view's frame is `plan:<view>`, and everything in it is `plan:<view>:<what>:<id>`
  (`item`, `col`, `lane`, `row`, `axis`, `label`, `cell`…). Each card carries `meta.plan = { item, view, version }`, and its Details
  card shows the record, with the fields a person can change there (a date is cleared there too). Don't move, restyle, relabel or
  delete them with `exec`: a move that means something is written upstream as if a person made it, and anything else is undone by
  the next sync. `import`, `draw --update`, `toucan.layout()`, `toucan.tidy.*` and every routine leave them, and whatever is inside
  a view's frames, exactly as they are (an import says how many under `planKept`; a routine's summary ends "left the plan views
  as they are"); `measure()` still measures them. That holds while the canvas is bound: after `plan unbind`, shapes that still
  carry `meta.plan` (from a restored version, say) are ordinary shapes.
- Views are placed clear of each other and of what's on the canvas, and each view's frame holds everything drawn in it. A view
  that grows into the one below moves that one down, unless a person has moved it: then it stays, and a notice says they overlap.
- **What a sync never touches:** anything that doesn't carry `meta.plan`. Arrows, notes and boxes drawn around or inside a view are
  the person's. When a view, a column, a lane or the Unscheduled strip goes away, what a person put inside it is moved out to
  where it stood, not removed with it. A view stays on the page, and inside any frame, a person put it.
- What a person's edit means, by kind, is in `plan catalog`. In short: a card into another column or row sets the grouped field; up
  or down a column places it after the card above; a gantt bar is exactly as long as start to end, and moving or stretching it
  sets those dates in whole days; a card dragged out of Unscheduled onto the chart starts on that day (for a day, or a day per 8
  hours of its `estimate`); text sets the title (in a table, a cell's text sets its field). A bar's title stands beside it when it
  doesn't fit inside, and is edited there. Dates are read against the view's own axis, and a card's column is the frame it is in,
  so moving or resizing a view, its frames or its axis is never an edit. A bar moves once it has gone a third of a day (and 4 px),
  and then by at least a day in that direction, so a nudge with the arrow keys counts at any scale. Several cards moved together
  end in the order they were dropped in. A shape that has been rotated is not an edit: it is stood up again.
- **A box a person draws in a board column becomes a new item** when it is a plain rectangle about the size of a card, with text,
  and a notice says so. There is no undo for that from the canvas (the protocol has no delete): the item is removed in the system
  of record. Anything else there is an annotation and stays one: an ellipse, a sticky note, a banner, a box an agent's run adds
  (`exec`, `import`, a routine), a copy of a card, boxes pasted several at once. To make an item, use `plan add`. A copy of a
  whole view (its frame duplicated) is the person's own ordinary shapes, frames and all.
- Not edits upstream: a deleted card (it comes back); a bar dropped into Unscheduled (it goes back: clear dates in the Details card
  or with `plan set ITEM start= end=`); a restored version (`versions restore` redraws the views from upstream and writes nothing).
  A person's undo of their own drag writes the previous value back; if the item has changed upstream since, the undo writes
  nothing and a notice says so. Bars dragged together with the date boxes above them change no dates: they go back, with a notice.
- A write quotes the version the card showed. If upstream had moved on, or refuses the value, the canvas goes back to what
  upstream says and people see a notice; `plan` lists these under `problems` and `plan dismiss` clears them.
- The server syncs, one sync per canvas however many tabs are open: it asks the source for changes every few seconds while a person
  has the canvas open, and redraws when something moved. A shape someone is dragging or typing in is left alone until they let go
  (their edit is then read against what they saw); everything else carries on meanwhile. With nobody there and no headless
  mode, the views are drawn when the canvas is next opened. Two safeguards: if the views keep differing from what was drawn with
  nothing in the difference to save, more than twelve times in twenty seconds, the canvas is left alone for a minute and a notice
  says which shapes kept changing (`plan sync` starts it again; something that changes them more slowly is simply drawn over each
  time); and a binding file that can't be read is kept aside, the canvas says so, and `plan bind` again takes up the shapes
  already there by their keys.
- On Excalidraw: a view with columns or lanes has no frame of its own (frames don't nest there), so a gantt without lanes has
  only its axis, bars and Unscheduled strip; a gantt's titles always stand beside their bars; and a view is always drawn on the
  one scene (there are no pages). Everything above is otherwise the same there and is tested there, except undo, which has no
  API to drive and is untested on that engine.
