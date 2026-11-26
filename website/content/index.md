---
label: Home
description: Watch a radio producer fit a field recording into an 18-minute slot, review the episode page, and hand off the mix.
image: https://lavallee.github.io/toucan/assets/use-cases/river-rundown.png
image_alt: An illustrated broadcast rundown for Sounds from the river.
---
# Share a canvas with your agent.

::: html
<link rel="stylesheet" href="assets/admiralty.css">
<script src="assets/site-nav.js"></script>
<script defer src="assets/demo-playback.js"></script>
<script defer src="assets/site-footer.js"></script>
:::

::: html
<div class="article-full toucan-home">
  <link rel="stylesheet" href="assets/use-cases.css">
  <div class="opening-copy">
    <p>Give your agent a job. Watch it draw in your browser. Pick up any piece and keep working together.</p>
    <a class="install" href="quickstart.html">Install Toucan <span aria-hidden="true">↗</span></a>
    <p class="platform"><a data-release href="https://github.com/lavallee/toucan/releases/tag/v0.22.1">Toucan v0.22.1</a> · Runs on your machine</p>
  </div>
  <figure class="opening-film" id="rundown">
    <video data-demo loop muted playsinline preload="none" width="1280" height="800" poster="assets/use-cases/river-rundown.png" aria-label="The ferry interview gets a shorter cut and the episode fits its broadcast slot" src="assets/use-cases/river-rundown.mp4"></video><noscript><a href="assets/use-cases/river-rundown.mp4">Play demo</a></noscript>
    <figcaption><strong>Twenty minutes of tape. Eighteen minutes on air.</strong> A two-minute cut to the ferry interview brings the radio show in on time. <a href="use-cases.html#cut-a-radio-episode">See the edit ↗</a></figcaption>
  </figure>
  <div class="walkthrough">
    <nav class="story-nav" aria-label="Demo chapters">
      <a href="#rundown">Rundown</a><a href="#edit">Co-edit</a><a href="#agents">Parallel agents</a><a href="#chat">In the chat</a><a href="#review">Review</a><a href="#plan">Move a task</a><a href="#history">History</a><a href="#routines">Routines</a><a href="#illustrate">Illustrate</a><a href="#episode">Forging Ahead</a>
    </nav>
    <section id="edit" class="spread edit">
      <div class="copy">
        <h2>Keep editing while it draws.</h2>
        <p>Sam asks for a password-reset path. While Codex works, Sam changes “Verify email” to “Confirm your email.” Watch the green path at the end. It includes Sam’s wording.</p>
        <a href="tour.html#draw-with-an-agent">Make a change together ↗</a>
      </div>
      <figure><video data-demo loop muted playsinline preload="none" width="1280" height="800" poster="assets/demos/agents-notice.jpg" src="assets/demos/agents-notice.mp4" aria-label="Sam renames a step while Codex adds a branch to the same sign-up diagram"></video><noscript><a href="assets/demos/agents-notice.mp4">Play demo</a></noscript></figure>
    </section>
    <section id="agents" class="spread parallel">
      <div class="copy">
        <h2>Give each question its own agent.</h2>
        <p>Alex selects two sign-in boxes and asks whether the app needs both. Sam asks what happens to bookings if the database goes down. Two agents work at once, each answering in the thread attached to its part of the diagram.</p>
        <a href="tour.html#start-parallel-comment-threads">Start a thread on a shape or region ↗</a>
      </div>
      <figure><video data-demo loop muted playsinline preload="none" width="1600" height="900" poster="assets/demos/threads.poster.png" src="assets/demos/threads.mp4" aria-label="Two questions enter separate threads on a booking system canvas and two agents reply"></video><noscript><a href="assets/demos/threads.mp4">Play demo</a></noscript><figcaption>The wait for the replies plays at 6× speed.</figcaption></figure>
    </section>
    <section id="chat" class="spread chat">
      <div class="copy">
        <h2>See the canvas in your chat.</h2>
        <p>An agent draws a release pipeline over MCP, and the canvas appears in the conversation. Rename a step in toucan, and the picture in the chat updates. The agent's next call hears what you did, and it builds on your wording.</p>
        <a href="quickstart.html#the-canvas-in-the-chat">Put the canvas in your chat ↗</a>
      </div>
      <figure><video data-demo loop muted playsinline preload="none" width="1600" height="900" poster="assets/demos/mcp-app.poster.png" src="assets/demos/mcp-app.mp4" aria-label="An agent draws a release pipeline and the canvas appears in the chat; a person renames a step in toucan and the chat's view keeps up"></video><noscript><a href="assets/demos/mcp-app.mp4">Play demo</a></noscript><figcaption>Real <code>toucan mcp</code> calls in a host built on the MCP Apps SDK. The agent's lines are scripted.</figcaption></figure>
    </section>
    <section id="review" class="spread review">
      <div class="copy">
        <h2>Point to what needs fixing.</h2>
        <p>The listening button on this radio page leaves two questions open. What will play? How long is it? The reviewer pins a note to the button. The producer replies with a revised page.</p>
        <a href="tour.html#review-a-screenshot">Try the screenshot review ↗</a>
      </div>
      <figure><a href="tour.html#review-a-screenshot"><img width="1440" height="925" loading="lazy" src="assets/use-cases/radio-review.png" alt="Toucan Review shows the original Listen button beside the revision, now labelled Play the episode with an 18-minute duration."></a><figcaption>Both revisions stay attached to the conversation.</figcaption></figure>
    </section>
    <section id="plan" class="spread plan">
      <div class="copy">
        <h2>Move a card. Update the plan.</h2>
        <p>The ferry interview is mixed. Drag it from In progress to In review so the producer knows what to listen to next. The stage changes in the episode plan, too.</p>
        <a href="use-cases.html#send-the-mix-to-review">Try the episode board ↗</a>
      </div>
      <figure><video data-demo loop muted playsinline preload="none" width="1440" height="900" poster="assets/use-cases/episode-board.png" src="assets/use-cases/river-move.mp4" aria-label="The ferry interview mix moves from In progress to In review"></video><noscript><a href="assets/use-cases/river-move.mp4">Play demo</a></noscript><figcaption>The file-backed task moved from <code>doing</code> to <code>review</code>.</figcaption></figure>
    </section>
    <section id="history" class="spread history">
      <div class="copy">
        <h2>Revisit the first sketch.</h2>
        <p>Open History and select a saved revision to see how checkout worked before the flow changed. You can inspect it read-only, return to the live canvas, or restore that version. A restore can itself be undone.</p>
        <a href="tour.html#save-and-revisit-a-version">Save and restore versions ↗</a>
      </div>
      <figure><a href="assets/tour/history.png"><img src="assets/tour/history.png" width="2100" height="1290" loading="lazy" alt="The History panel beside the checkout flow, with the named revision First sketch open in a read-only preview."></a></figure>
    </section>
    <section id="routines" class="spread routines">
      <div class="copy">
        <h2>Keep the cleanup that worked.</h2>
        <p>Run <strong>Clean up</strong> from the Routines menu and watch the diagram settle into place. One undo brings the old layout back. When your agent finds a useful cleanup of its own, save it to the menu for the next canvas.</p>
        <a href="tour.html#run-a-cleanup-routine">Run a cleanup routine ↗</a>
      </div>
      <figure><video data-demo loop muted playsinline preload="none" width="1600" height="900" poster="assets/demos/routines-menu.poster.png" src="assets/demos/routines-menu.mp4" aria-label="Running the Clean up routine on a diagram and undoing the layout change"></video><noscript><a href="assets/demos/routines-menu.mp4">Play demo</a></noscript></figure>
    </section>
    <section id="illustrate" class="spread illustrate">
      <div class="copy">
        <h2>Take the drawing off the canvas.</h2>
        <p>A radio station needs a handbook. Arrange a microphone, a tape deck and a transmitter on the canvas. Set the captions in type, choose the Letterpress palette, and export the whole spread as an SVG.</p>
        <a href="use-cases.html#illustrate-the-signal-path">Make a field guide for the station ↗</a>
      </div>
      <figure><a href="assets/use-cases/radio-field-guide.png"><img src="assets/use-cases/radio-field-guide.png" width="1440" height="900" loading="lazy" alt="Three illustrated stages of a radio broadcast with editable headings and captions inside the Toucan editor."></a></figure>
    </section>
    <section id="episode" class="spread episode">
      <div class="copy">
        <h2>Watch the Toucan walkthrough.</h2>
        <p>Follow Marc Lavallee through a canvas session, from asking an agent to expand a timeline to placing images by hand and exporting the finished page.</p>
        <a href="https://lyra-forge.com/notes/working-with-agents-on-a-canvas/">Read the illustrated walkthrough ↗</a>
      </div>
      <figure><a class="episode-player" href="https://www.youtube.com/watch?v=LEYJvdjm1U4"><img src="assets/demos/forging-ahead.jpg" width="1280" height="720" loading="lazy" alt="Working with agents on a canvas, Forging Ahead episode one"><span>▶ Watch the episode · 4:45</span></a></figure>
    </section>
    <section class="closing">
      <h2>Find your way into Toucan.</h2>
      <nav class="next-pages" aria-label="Explore the documentation">
        <div><h3>Try a canvas</h3><a href="quickstart.html">Install and open your first canvas</a><a href="explore.html">Explore the sample canvases</a><a href="gallery.html">Browse diagram templates</a></div>
        <div><h3>See what it can do</h3><a href="tour.html">Follow the canvas guide</a><a href="use-cases.html">Browse worked examples</a><a href="features.html">Look up a feature</a></div>
        <div><h3>Technical documentation</h3><a href="agents.html">Look up agent commands</a><a href="how-it-works.html">Understand the architecture</a><a href="extending.html">Add routines and integrations</a></div>
      </nav>
    </section>
  </div>
  <script defer src="assets/home-demos.js"></script>
</div>
:::
