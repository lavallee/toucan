# See it work

Every picture here is a screenshot of toucan running, made by a script against a real server. Where it says an agent did something, that is a real turn of the chat agent on Codex, unedited. There is no public server to try, because toucan is built for your own machine or a trusted network, but the [Explore](explore.html) page lets you click through some of these canvases.

## Ask, and it draws

The chat panel sits beside the canvas. Asked for "A sequence diagram of a user resetting their password by email.", the agent drew this and checked its own work.

![The canvas with the chat panel open. The agent has drawn a sequence diagram of a password reset, with four participants and a column of messages between them.](assets/tour/chat.png "Measured at 98 of 100 by the same check the agent runs.")

Agents don't place boxes by hand. They describe the diagram and a layout engine places it, which is why this takes seconds. Here are four more requests, from the set toucan is tested against: across 8 requests the average score is 95 of 100, in about 18 seconds each.

**"Diagram a web app's architecture with a CDN, load balancer, two app servers, a database and a cache."**

![What the agent drew for: Diagram a web app's architecture with a CDN, load balancer, two app servers, a database and a cache.](assets/tour/ask-web-stack.png "Scored 95 of 100, in 18.6 seconds.")

**"Make an org chart: a CEO, with VPs of sales, product and engineering, each with two teams under them."**

![What the agent drew for: Make an org chart: a CEO, with VPs of sales, product and engineering, each with two teams under them.](assets/tour/ask-org.png "Scored 97 of 100, in 15.8 seconds.")

**"A mind map of things to think about when moving house."**

![What the agent drew for: A mind map of things to think about when moving house.](assets/tour/ask-moving.png "Scored 89 of 100, in 20.9 seconds.")

**"The states a support ticket moves through, and what moves it between them."**

![What the agent drew for: The states a support ticket moves through, and what moves it between them.](assets/tour/ask-ticket.png "Scored 98 of 100, in 15.6 seconds.")

## Describe it as data

Any agent, or any script of yours, can do the same from a terminal. A diagram is a small description, in the same form as the [templates](gallery.html), and `toucan draw` places it. This one is shortened; the full version has seven boxes.

```json
{
  "kind": "flow",
  "direction": "RIGHT",
  "nodes": [
    {"id":"cart","text":"Review cart","shape":"oval"},
    {"id":"address","text":"Enter address"},
    {"id":"pay","text":"Take payment"},
    {"id":"ok","text":"Approved?","shape":"diamond"}
  ],
  "edges": [
    {"from":"cart","to":"address"},
    {"from":"address","to":"pay"},
    {"from":"pay","to":"ok"}
  ]
}
```

```sh
toucan --canvas checkout draw checkout.json
```

![A left-to-right checkout flow: review cart, enter address, take payment, a decision on whether it was approved, then confirm order and ship, or show the error and go back to payment.](assets/tour/draw.png)

A second drawing lands beside the first and never over it. `--update` changes an earlier one.

## Or as Mermaid

Mermaid works as an edit language too. On a blank canvas it comes out looking like a template, and it merges by key on a full one, so importing it again changes only what differs.

```
flowchart LR
  idea[Idea] --> draft[Draft]
  draft --> review{Reviewed?}
  review -->|yes| publish[Publish]
  review -->|no| draft
```

![The Mermaid flowchart as boxes on a canvas: idea, draft, a reviewed decision, publish, with a loop back to draft.](assets/tour/mermaid.png)

What goes in comes back out. The same canvas as DOT:

```
digraph toucan {
  rankdir=LR;
  node [shape=box, style="rounded,filled", fillcolor="#ffffff", fontname="Helvetica", fontsize=10];
  "draft" [label="Draft", color="#1d1d1d"];
  "idea" [label="Idea", color="#1d1d1d"];
  "review" [label="Reviewed?", color="#1d1d1d", shape=diamond];
  "publish" [label="Publish", color="#1d1d1d"];
  "review" -> "publish" [label="yes", color="#9fa8b2"];
  "draft" -> "review" [color="#9fa8b2"];
  "review" -> "draft" [label="no", color="#9fa8b2"];
  "idea" -> "draft" [color="#9fa8b2"];
}
```

It also exports JSON Canvas (for Obsidian), `.excalidraw` and toucan's own graph format.

## Tldraw or Excalidraw

A canvas runs on either engine, and converts between them with its keys, text, frames and arrows intact. Some styling is approximated: Excalidraw draws these arrows straight, for one.

![A layered architecture diagram on tldraw, with clients, edge, services and data in four frames.](assets/tour/engine-tldraw.png "On tldraw.")

![The same architecture diagram on Excalidraw, with the same boxes and frames in Excalidraw's style.](assets/tour/engine-excalidraw.png "The same canvas, converted to Excalidraw.")

## Tidy it up

Diagrams get knocked about. **Routines** are chores banked once and run from a menu or the CLI, each one undoable in a single step, and they keep your arrangement rather than starting over. Here a service map scored 99 when clean and 58 after being knocked about.

![A service map with boxes out of line, different sizes, and two dropped on top of their neighbours.](assets/tour/cleanup-before.png "Before: 58 of 100.")

![The same service map with the boxes lined up, matching in size and clear of each other.](assets/tour/cleanup-after.png "After Clean up: 98 of 100.")

![The Routines menu open over a canvas, listing Clean up, Lay it out again, Check this diagram and other chores, each with a description.](assets/tour/routines-menu.png "The routines menu. Ask an agent to bank a new one and it appears here.")

**Check this diagram** scores what's drawn and names the shapes at fault, so an agent can fix what it finds instead of squinting at a screenshot.

## Short boxes, with the rest a click away

A box holds a name. What's behind it opens in a card when you select it, and on a canvas with a **format**, ← and → walk you through. This is the Odyssey as a story map.

![The Odyssey as a story map: a long path of short titled stops with branches.](assets/tour/story-whole.png "The whole map.")

![One stop selected, with a card beside it holding a quotation from the poem and buttons to walk to the previous and next stops.](assets/tour/story-card.png "Select a stop, and the quotation opens beside it.")

![The canvas has moved to the next stop along the path, with its own card open.](assets/tour/story-walk.png "Press → and the canvas moves along the path.")

[Try this one yourself](explorer.html?map=odyssey), no install needed.

## Zoom out on a system

On a system diagram, zooming out swaps the details for what matters at that height: the frames, how many parts each holds, and how many connections run between them. It only changes what you see; agents and exports still get every shape.

![A layered architecture diagram with every box and arrow visible.](assets/tour/system-close.png "Up close.")

![The same diagram zoomed out: four labelled frames with part counts, joined by arrows with connection counts.](assets/tour/system-overview.png "Zoomed out.")

## Air out a dense diagram

Long text in boxes makes a canvas hard to read and hard to talk about. The **Air out** routine moves it into the details, makes the names larger, and spreads things a little.

![Four boxes crowded with paragraphs of text, joined by arrows.](assets/tour/airout-before.png "Before.")

![The same four boxes with short names only.](assets/tour/airout-after.png "After. The text is one click away, in the card.")

## Comment, and have it answered

A comment on a box or a region is a **thread**: a back-and-forth that someone eventually closes. Send a message to the agent and it works that thread on its own, so several can run at once.

![A thread open on the Show the error box. A person asks whether to retry the card automatically, and the agent answers in the thread.](assets/tour/thread.png "Asked: "Should we retry the card automatically before showing an error?" The answer is the agent's, unedited.")

## Leave a sticky note

Pin a note where the problem is instead of describing it in chat. Its position is part of the message. Asked to handle the notes, the agent acts on each one, and the note turns green with a one-line reply.

![The checkout flow with a yellow sticky note above the Take payment box: missing, what if an item went out of stock?](assets/tour/notes-before.png "A note left on the canvas.")

![The flow now has a step for the out-of-stock case, and the note has turned green with the agent's reply.](assets/tour/notes-after.png "The agent's reply: "Added stock check before payment. Out-of-stock items lead to showing unavailable items and updating the cart."")

## Take it or leave it

Ask for an opinion and the answer arrives as a **proposal**: drawn dashed, with Accept and Reject above the canvas. Nothing is final until you say so.

![The checkout flow with new dashed boxes and arrows the agent proposes, and a bar above the canvas with Accept and Reject.](assets/tour/proposal.png "Asked: "What is missing from this flow? Answer on the canvas as a proposal."")

## Go back

Every canvas keeps its history, whoever made the change. Step through versions read-only, with the live canvas still running underneath, and restore one if you want it. A restore can itself be undone.

![The History panel open beside the checkout flow, with a version named First sketch selected and shown read-only.](assets/tour/history.png "An earlier version, named First sketch, shown over the live canvas.")

## Where to go next

- [Explore](explore.html): click through real canvases in your browser.
- [Gallery](gallery.html): every diagram toucan starts from.
- [Quick start](quickstart.html): run it yourself.
- [Agent guide](agents.html): what agents can do, in full.
