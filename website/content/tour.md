---
description: Make a change with an agent, review a screenshot, clean up a drawing, or recover an earlier version.
kicker: Working on a canvas
---
# Canvas guide

::: html
<link rel="stylesheet" href="assets/admiralty.css">
<script src="assets/site-nav.js"></script>
<script defer src="assets/site-footer.js"></script>
:::

::: html
<span id="ask-and-it-draws"></span>
:::

## Draw with an agent

Open a canvas and its chat panel. Try “Draw the steps from requesting a password reset to signing in again.” While the agent draws, select a box and edit its label. The agent sees your change as it works. If you need help connecting your first agent, follow the [quick start](quickstart.html#install).

![The chat panel alongside a password-reset diagram with four participants and a sequence of messages.](assets/tour/chat.png)

::: html
<span id="comment-and-have-it-answered"></span>
:::

## Start parallel comment threads

Select the shapes you want to discuss and start a comment. Choose **Agent** and ask a question about those shapes. Start a second thread on a different part of the drawing while the first is running. Each agent replies beside the shapes it was asked about.

Choose **People** for a teammate or **Main chat** to steer the conversation already open in the chat panel. Close the thread when its question is settled.

![A thread attached to Show the error, discussing whether the system should retry payment.](assets/tour/thread.png)

## Review a screenshot

A listener sees “Listen” on the episode page. Can they tell what will play or how long it lasts? Follow the editor’s pin through a recorded review, then try the same steps on your canvas.

::: html
<div class="review-sequence">
<img src="assets/use-cases/episode-before.png" width="720" height="420" loading="lazy" alt="Original Fieldnote Radio page with a button labelled Listen and no running time.">
<details><summary>Read the feedback pinned to “Listen”</summary>
<blockquote>Give the button a clearer label and show the episode length.</blockquote>
<details><summary>See the producer’s revision</summary><img src="assets/use-cases/episode-after.png" width="720" height="420" loading="lazy" alt="Revised page with a Play the episode button and an 18-minute duration."><p>The producer linked this revision in the reply. The pin stays on the original image.</p></details>
</details>
</div>
:::

### Try it on your canvas

[Install Toucan](quickstart.html#install) and download both sample screenshots to the same directory.

::: html
<p><a href="assets/use-cases/episode-before.png" download>Download the original screenshot</a> · <a href="assets/use-cases/episode-after.png" download>Download the revised screenshot</a></p>
:::

From that directory, create a canvas and post the original image.

```sh
toucan new radio-review-demo
toucan --canvas radio-review-demo review post episode episode-before.png --title "Episode page" --producer radio-editor
toucan open radio-review-demo
```

1. In the editor, open **Review**, click the listening button in the screenshot, type your feedback, and choose **Post feedback**.
2. In your terminal, run `toucan --canvas radio-review-demo review inbox radio-editor`. The producer sees the note and the exact revision you reviewed.
3. In the commands below, replace `FIRST_REV` with the original post’s `revision.id` and `NOTE` with the inbox entry’s `note.id`. Run the first command, then use the new `revision.id` for `AFTER_REV` in the reply.

```sh
toucan --canvas radio-review-demo review post episode episode-after.png --title "Episode page" --producer radio-editor --previous FIRST_REV
toucan --canvas radio-review-demo review reply NOTE "Added the play label and running time." --producer radio-editor --replacement AFTER_REV
```

Back in **Review**, open the note and choose **View revised screenshot**. Compare the two versions and close the note when the change answers it.

::: html
<span id="tidy-it-up"></span>
:::

## Run a cleanup routine

Open **Routines** on a diagram and choose **Clean up**. Compare the spacing and alignment. A single undo returns the drawing to its previous arrangement. **Check this diagram** reports remaining layout problems. If a chore keeps recurring, look for suggestions in the Routines menu. **Bank it** asks an agent to turn the suggestion into a reusable routine.

![The open Routines menu lists Clean up, Lay it out again and Check this diagram.](assets/tour/routines-menu.png)

::: html
<span id="go-back"></span>
:::

## Save and revisit a version

Before a major edit, give the current version a name with `toucan --canvas NAME versions save "First sketch"`. Replace `NAME` with the name of your canvas. In **History**, select that version to inspect the earlier drawing. Leave the preview to continue editing the live canvas. Choose **Restore** when everyone should return to the saved drawing. Toucan saves the current state before restoring.

![History showing the read-only First sketch revision beside the checkout diagram.](assets/tour/history.png)

## More canvas tasks

### Leave a sticky note

Put a note beside the step that needs attention. Ask the agent to address it. A resolved note stays on the canvas with its reply, so you can see what changed.

### Take it or leave it

Ask “What’s missing from this flow? Show your suggestions as a proposal.” The agent draws its proposed additions with dashed outlines. Review the changes on the canvas, then accept or reject them.

### Short boxes, with the rest a click away

Keep the visible label short and put a quotation or explanation in the box’s details. Click the box to open its reading card. [Try the Odyssey sample](explorer.html?map=odyssey) and use the arrow keys to follow the stops.

### Air out a dense diagram

Run **Air out** from **Routines** to move long text out of diagram boxes and into their details. Select a shortened box to read the original text.

### Zoom out on a system

On a layered system map, zoom out until the frames show component counts and the links between groups. Zoom back in to inspect a component. [Explore the shop map](explorer.html?map=shop).

### Describe it as data

If the drawing starts as structured data, use the [graph and import reference](agents.html#graphs-the-engine-neutral-path) for input formats and stable keys. To start from a prepared layout, [choose a template](gallery.html).

### Or as Mermaid

Save a Mermaid flowchart as `flow.mmd`, then run `toucan --canvas NAME import flow.mmd`. The boxes and arrows are editable. Use `toucan --canvas NAME export revised.mmd` to take the edited flow back to text.

### Tldraw or Excalidraw

To make an Excalidraw canvas, run `toucan new sketch --engine excalidraw`. New canvases use tldraw by default. The [feature index](features.html) identifies tools specific to tldraw.
