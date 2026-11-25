---
description: See how a radio producer cuts two minutes, an editor handles a reporting gap, and a teacher maps a poem. Each project includes a canvas, a recording, or a plan to try.
---
# Worked examples

::: html
<link rel="stylesheet" href="assets/admiralty.css">
<script src="assets/site-nav.js"></script>
<script defer src="assets/demo-playback.js"></script>
<script defer src="assets/site-footer.js"></script>
:::

## Cut a radio episode

*Sounds from the river* opens with four minutes of birdsong and closes with seven minutes on the ferry deck. That leaves seven minutes for the pilot in an eighteen-minute broadcast. The rough interview runs nine.

::: html
<figure class="article-breakout case-capture">
  <link rel="stylesheet" href="assets/use-cases.css">
  <video data-demo loop controls muted playsinline preload="none" width="1280" height="800" poster="assets/use-cases/river-rundown.png" src="assets/use-cases/river-rundown.mp4" aria-label="A two-minute interview cut brings a radio rundown to eighteen minutes"></video>
  <figcaption>A scripted CLI edit to a real Toucan canvas. The revised rundown moves the final cue from 13:00 to 11:00 and keeps all seven minutes of the closing tape.</figcaption>
</figure>
:::

### Send the mix to review

Once the cut is ready, send the mix to the producer. This board writes the task’s stage back to the same file used to open it. [Download the sample episode plan](assets/use-cases/episode.plan.json) and run these commands from the download directory.

```sh
toucan new river-production --plan file episode.plan.json --views board
toucan open river-production
```

Drag the ferry mix from **In progress** to **In review**. Open the downloaded plan again and look for the mix task. Its stage is now `review`.

::: html
<span id="map-a-system"></span>
:::

## Trace a radio upload to the player

One audio upload takes two routes through Fieldnote Radio. The archive keeps the recording. The catalog sends the title and release time on to the player and podcast feed. Following a single upload gives the station engineer a way to check what would break if the catalog stopped updating.

::: html
<figure class="article-breakout case-capture">
  <a href="assets/use-cases/radio-map.png"><img src="assets/use-cases/radio-map.png" width="1440" height="900" alt="Community radio system map with labelled connections from show hosts through ingest to the audio archive, episode catalog, scheduler, player, and podcast feed."></a>
  <figcaption>The example traces recordings, metadata, and release timing through a fictional station.</figcaption>
</figure>
:::

### Illustrate the signal path

For a station handbook, the same subject needs only three stops. Place an SVG illustration at each stop and keep the headings and captions as editable canvas text. Choose **Appearance → Canvas palette → Letterpress** on a tldraw canvas to switch the paper and ink colors in your browser. With the editor open, run `toucan --canvas NAME export field-guide.svg` using your canvas name. Open the exported file to check the captions at print size.

::: html
<figure class="article-breakout case-capture">
  <a href="assets/use-cases/radio-field-guide.png"><img src="assets/use-cases/radio-field-guide.png" width="1440" height="900" loading="lazy" alt="The live editor showing three illustrated stages of a radio episode, from microphone to tape archive to transmitter."></a>
  <figcaption><a href="assets/use-cases/radio-field-guide.svg">Open the SVG exported from this canvas</a></figcaption>
</figure>
:::

::: html
<span id="review-a-screenshot"></span>
:::

## Revise the episode’s listening button

On the episode page, the button says “Listen.” The editor wants the listener to know what will play and how long it lasts. The revision puts “Play the episode” on the button and the eighteen-minute running time underneath.

::: html
<figure class="article-breakout case-capture">
  <a href="assets/use-cases/radio-review.png"><img src="assets/use-cases/radio-review.png" width="1440" height="925" loading="lazy" alt="Toucan Review comparing two versions of an episode page. The updated version uses a clearer Play the episode label and shows the duration."></a>
  <figcaption>A real Toucan review of a sample episode page. <a href="assets/use-cases/radio-feedback.png">See the original pin and producer’s reply</a>.</figcaption>
</figure>
:::

[Try the same screenshot review](tour.html#review-a-screenshot) to follow the pin, inspect the revision, and repeat it on your own canvas.

::: html
<span id="run-a-project-board"></span>
:::

## Track a website relaunch

Bind a canvas to a plan and group its tasks by stage. Move a card to **In review**, and Toucan writes the stage back to the plan. A connected source can also supply the same tasks to a Gantt view. A change at the source appears in the views that use it.

::: html
<figure class="article-breakout case-capture">
  <a href="assets/use-cases/relaunch-board.png"><img src="assets/use-cases/relaunch-board.png" width="1440" height="900" loading="lazy" alt="Website relaunch tasks in four Toucan board columns: To do, In progress, In review, and Done."></a>
  <figcaption>A website relaunch board bound to a local plan file. Moving a card from In progress to In review updates that file.</figcaption>
</figure>
:::

From a Toucan checkout, try the sample plan with the built-in file source.

```sh
toucan new relaunch --plan file examples/website-relaunch.plan.json --views board,gantt
toucan open relaunch
```

For a plan held in a task system, see the [Daymark adapter and plan source protocol](extending.html#plan-sources).

::: html
<span id="work-through-a-handoff"></span>
:::

## Decide whether a story is ready to publish

Draw a process around decisions that change what happens next. In this example, a story reaches the editor and either goes on to production or waits for additional evidence. A review thread on the decision box gives the conversation a place to live. When the unresolved question is settled, update the flow or close the thread.

::: html
<figure class="article-breakout case-capture">
  <a href="assets/use-cases/editorial-handoff.png"><img src="assets/use-cases/editorial-handoff.png" width="1440" height="900" loading="lazy" alt="Editorial flow from logging a tip to reporting and editor review, which branches to Hold for evidence or Schedule the story."></a>
  <figcaption>The editorial handoff makes the hold and publish paths visible while the team works through them.</figcaption>
</figure>
:::

Start with a [flowchart or swimlane](gallery.html), then use [threads on shapes and regions](tour.html#start-parallel-comment-threads) for the parts that need discussion.

::: html
<span id="walk-a-story-or-lesson"></span>
:::

## Follow the Odyssey book by book

Lay out short stops and connect them in reading order. A teacher can keep the full excerpt or a reference behind each stop and talk through the visible map. Readers can also explore a section on their own. Try the [Odyssey story map](explorer.html?map=odyssey) and use the arrow keys to walk through its books.

![A Toucan story map with a selected passage and its reading card open next to the canvas.](assets/tour/story-walk.png "The Odyssey’s story map and one stop’s reading card.")

## Plan Thanksgiving dinner

Dinner for eight at six, five recipes, and one oven. Give Codex the recipe links in Toucan, then ask it to plan around the menu it just made. With both on the same canvas, you can see when the oven is free and what can happen alongside it.

::: html
<figure class="article-breakout case-capture">
  <video controls playsinline preload="none" width="1600" height="1100" poster="assets/use-cases/thanksgiving-feature.jpg?v=shared-canvas" aria-label="Two rounds of Thanksgiving dinner planning with the Toucan chat agent">
    <source src="assets/use-cases/thanksgiving-dinner.mp4?v=shared-canvas" type="video/mp4">
    <a href="assets/use-cases/thanksgiving-dinner.mp4?v=shared-canvas">Download the Thanksgiving feature video</a>
  </video>
  <figcaption>Two real Codex turns in Toucan, edited for time. The first builds the menu. The second draws the oven, prep, and hosting schedule below it.</figcaption>
</figure>
:::

In the first round, Codex builds the menu from prepared notes on five linked recipes. The hero photos are generated illustrations. In the second round, Codex works backward from six and draws a timeline below the menu. The timeline gives the oven, prep counter, finishing, and hosting their own lanes. Hatched slots show when the oven needs to change temperature. You can see when the rolls should proof, when to set out drinks, and when to carve and plate. The cranberry sauce goes in the day-before plan. The schedule uses example reservations and assumes the turkey can be held safely outside the oven while the sides bake.

::: html
<p><a href="assets/use-cases/thanksgiving-board.tldr.json?v=shared-canvas" download="thanksgiving.tldr">Download the tldraw board</a> · <a href="assets/use-cases/thanksgiving-menu.jpg?v=shared-canvas">View the menu</a> · <a href="assets/use-cases/thanksgiving-prep.jpg?v=shared-canvas">Zoom into the dressing</a> · <a href="assets/use-cases/thanksgiving-dinner.jpg?v=shared-canvas">View the schedule</a> · <a href="assets/use-cases/thanksgiving-overview.jpg?v=shared-canvas">See the whole canvas</a></p>
:::

The board links to [roast turkey](https://www.butterball.com/recipes/classic-whole-roasted-turkey), [sage dressing](https://www.seriouseats.com/classic-sage-and-sausage-stuffing-or-dressing-recipe), [Parker House rolls](https://www.kingarthurbaking.com/recipes/small-batch-parker-house-rolls-recipe), [radicchio salad](https://smittenkitchen.com/2010/04/radicchio-apple-and-pear-salad/), and [cranberry sauce](https://www.oceanspray.com/recipes/homemade-whole-berry-cranberry-sauce).
