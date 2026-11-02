# Habits: from a repeated request to a button

*A design note, not a feature. Banking a chore is built (routines); noticing one isn't. This records how
toucan could notice a chore and offer to bank it, so the idea can be argued with before it is coded.*

## Where things stand

A routine is a chore banked once for every canvas on a server, listed in the Routines menu and run with a
click or `toucan routine run`. [`routines/tidy-arrows.js`](https://github.com/lavallee/toucan/blob/main/routines/tidy-arrows.js)
is one: it re-routes arrows (straight, curved either way, or elbow) to run through fewer boxes and cross
fewer arrows, without moving a box, and reports the before and after counts.

Today a person notices the pattern ("I keep asking for this; bank it") and asks an agent to write the routine. The aim is for the system to notice the pattern and **offer**. It should never install
anything on its own.

## Noticing

The raw material already exists or nearly does:

- **Chat turns** on a canvas (the Codex thread per canvas), each with the request text and what the
  agent then did.
- **What each run changed.** The exec relay records each run's added, changed and removed shapes (that
  record drives the agent halos). Kept per canvas, it becomes a history of *kinds* of edit.

A repeated chore shows up as requests that are similar in words *and* in effect. "Clean up the arrows",
"the lines are a mess" and "tidy the connectors" read differently but each produced a run that touched
only arrows and changed only `bend`/`kind`. Matching on the effect (shape types touched, properties
changed, nothing created or deleted) is sturdier than matching on the words, and needs no model call.
Matching on the words (a cheap embedding, or asking the agent) catches the ones that differ in effect.

A reasonable trigger is **three similar requests on one canvas, or across canvases within a few weeks**.
Twice is a coincidence, and anything more than three times means the offer came late.

## Offering

The offer belongs in the place the request was made, after the third run succeeds and not before:

> That's the third time you've asked me to tidy the arrows. Want a **Tidy arrows** button on this
> canvas? [Make it a button] [Not now] [Don't ask again]

- *Make it a button* has the agent write a canvas script from what its runs actually did, install it as
  a **proposal** (the same accept/reject idea as dashed shapes: a script that runs only after the person
  accepts it), and say how to remove it.
- *Not now* resets the count; *Don't ask again* stores a per-canvas (or global) opt-out for that
  pattern.
- The offer must say what it noticed ("three requests: …", with links to those turns), so the person
  can judge whether the pattern is real.

## Where it lives

- **Pattern memory:** a small per-canvas file beside the canvas (`<data>/<name>.habits.json`): pattern
  signature, example requests, count, last offered, opt-out. It is readable and deletable, like the
  canvas itself.
- **Detection:** in the server, after a chat turn completes, since it sees both the request and the exec
  results. Terminal agents could report requests through a CLI hook (`toucan habit note "…"`), or the
  check could stay chat-only at first.
- **Promotion:** already answered by the routine bank, which every canvas on a server shares.

## Open questions

- Is the effect signature (types touched × properties changed) enough to group requests, or does it
  need the words too? Test it on logged sessions before building anything.
- Should a habit be a button, or a reaction that runs on its own (after every import, tidy the
  arrows)? Automatic is cheaper but invisible; start with buttons.
- Generated scripts run arbitrary code in people's tabs. Installing one as a proposal that a person
  must accept is the minimum; a diff view of the script is better.
- How do we measure "gets cheaper the more you do it"? Count chat turns per canvas per week for chores
  that became buttons, before and after.
