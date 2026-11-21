---
description: Use Toucan to plan a Thanksgiving dinner, map a system, review a screenshot, or run a project board.
---
# Use cases

## Plan Thanksgiving dinner

The rolls bake at 375°F. The turkey roasts at 325°F. With one oven and guests coming for dinner at six, can Codex make the timing work?

::: html
<figure class="article-breakout case-capture">
  <link rel="stylesheet" href="assets/use-cases.css">
  <video controls playsinline preload="none" width="1600" height="900" poster="assets/use-cases/thanksgiving-feature.jpg?v=one-oven" aria-label="Two rounds of Thanksgiving dinner planning with the Toucan chat agent">
    <source src="assets/use-cases/thanksgiving-dinner.mp4?v=one-oven" type="video/mp4">
    <a href="assets/use-cases/thanksgiving-dinner.mp4?v=one-oven">Download the Thanksgiving feature video</a>
  </video>
  <figcaption>Two real Codex turns in Toucan, edited to 17 seconds. Watch five recipe links become an editable menu, then see Codex draw the plan for dinner.</figcaption>
</figure>
:::

In the first round, Codex builds the menu from prepared notes on five linked recipes. The hero photos are generated illustrations. In the second round, Codex works backward from six and draws a timeline below the menu. The timeline gives the oven, prep counter, finishing, and hosting their own lanes. Hatched slots show when the oven needs to change temperature. You can see when the rolls should proof, when to set out drinks, and when to carve and plate. The cranberry sauce goes in the day-before plan. The schedule uses example reservations and assumes the turkey can be held safely outside the oven while the sides bake.

::: html
<p><a href="assets/use-cases/thanksgiving-board.tldr.json?v=dinner-plan" download="thanksgiving.tldr">Download the tldraw board</a> · <a href="assets/use-cases/thanksgiving-menu.jpg">View the menu</a> · <a href="assets/use-cases/thanksgiving-prep.jpg">Zoom into the dressing</a> · <a href="assets/use-cases/thanksgiving-dinner.jpg?v=dinner-plan">View the schedule</a> · <a href="assets/use-cases/thanksgiving-overview.jpg">See the whole canvas</a></p>
:::

The board links to [roast turkey](https://www.butterball.com/recipes/classic-whole-roasted-turkey), [sage dressing](https://www.seriouseats.com/classic-sage-and-sausage-stuffing-or-dressing-recipe), [Parker House rolls](https://www.kingarthurbaking.com/recipes/small-batch-parker-house-rolls-recipe), [radicchio salad](https://smittenkitchen.com/2010/04/radicchio-apple-and-pear-salad/), and [cranberry sauce](https://www.oceanspray.com/recipes/homemade-whole-berry-cranberry-sauce).

## Map a system

Open a project with `toucan init --open` and ask your agent to trace how one real input moves through it. For a community radio station, that could be an audio upload from a show host. Label what each connection carries, such as audio, show notes, or a release time. Keep implementation details in each box’s details card.

When services change, update the map using stable keys. A keyed import can refresh names and connections while preserving positions you arranged. Start from an existing repository or use the [interactive shop map](explorer.html?map=shop) to see how details sit behind the boxes.

::: html
<figure class="article-breakout case-capture">
  <a href="assets/use-cases/radio-map.png"><img src="assets/use-cases/radio-map.png" width="1440" height="650" alt="Community radio system map with labelled connections from show hosts through ingest to the audio archive, episode catalog, scheduler, player, and podcast feed."></a>
  <figcaption>The example traces recordings, metadata, and release timing through a fictional station.</figcaption>
</figure>
:::

## Review a screenshot

Publish a screenshot with `toucan review post`, open **Review**, and pin a note to the part that needs work. The producer checks its inbox, posts an updated screenshot, and replies with the replacement revision. The original note stays attached to the image the reviewer saw. Use **View revised screenshot** to compare that image with the update.

::: html
<figure class="article-breakout case-capture">
  <a href="assets/use-cases/radio-review.png"><img src="assets/use-cases/radio-review.png" width="1440" height="925" loading="lazy" alt="Toucan Review comparing two versions of an episode page. The updated version uses a clearer Play the episode label and shows the duration."></a>
  <figcaption>A real Toucan review of a sample episode page. <a href="assets/use-cases/radio-feedback.png">See the original pin and producer’s reply</a>.</figcaption>
</figure>
:::

This is one of Toucan’s round trips. The stable identifier is a screenshot revision, and the response can point to a new revision. On a plan board, the stable identifier is a task, and the response is an update from the system that owns it. Read the [Rounds credit and design notes](https://github.com/lavallee/toucan#credits) or try the [review commands](extending.html#screenshot-review).

## Run a project board

Bind a canvas to a plan and group its tasks by stage. Move a card to **In review**, and Toucan writes the stage back to the plan. A connected source can also supply the same tasks to a Gantt view. A change at the source appears in the views that use it.

::: html
<figure class="article-breakout case-capture">
  <a href="assets/use-cases/relaunch-board.png"><img src="assets/use-cases/relaunch-board.png" width="1440" height="690" loading="lazy" alt="Website relaunch tasks in four Toucan board columns: To do, In progress, In review, and Done."></a>
  <figcaption>A website relaunch board bound to a local plan file. Moving a card from In progress to In review updates that file.</figcaption>
</figure>
:::

From a Toucan checkout, try the sample plan with the built-in file source.

```sh
toucan new relaunch --plan file examples/website-relaunch.plan.json --views board,gantt
toucan open relaunch
```

For a plan held in a task system, see the [Daymark adapter and plan source protocol](extending.html#plan-sources).

## Work through a handoff

Draw a process around decisions that change what happens next. In this example, a story reaches the editor and either goes on to production or waits for additional evidence. A review thread on the decision box gives the conversation a place to live. When the unresolved question is settled, update the flow or close the thread.

::: html
<figure class="article-breakout case-capture">
  <a href="assets/use-cases/editorial-handoff.png"><img src="assets/use-cases/editorial-handoff.png" width="1440" height="650" loading="lazy" alt="Editorial flow from logging a tip to reporting and editor review, which branches to Hold for evidence or Schedule the story."></a>
  <figcaption>The editorial handoff makes the hold and publish paths visible while the team works through them.</figcaption>
</figure>
:::

Start with a [flowchart or swimlane](gallery.html), then use [threads on shapes and regions](agents.html#threads-comments-on-shapes-and-regions) for the parts that need discussion.

## Walk a story or lesson

Lay out short stops and connect them in reading order. A teacher can keep the full excerpt or a reference behind each stop and talk through the visible map. Readers can also explore a section on their own. Try the [Odyssey story map](explorer.html?map=odyssey) and use the arrow keys to walk through its books.

![A Toucan story map with a selected passage and its reading card open next to the canvas.](assets/tour/story-walk.png "The Odyssey’s story map and one stop’s reading card.")
