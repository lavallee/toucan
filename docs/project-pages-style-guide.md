# Lyra Forge project pages

Use this guide when improving an existing project description or documentation collection on GitHub Pages. Give the visitor enough information to decide whether the project fits their work, see it produce a result, and take the next step. A reader landing directly on a subpage should be able to tell which project they are reading and how to get started.

Keep this guide with the implementation agent's brief. The defaults below are decisions the agent can make. The project's own instructions govern its build, product terminology, established identity, release process, and publication authority.

## 1. Inventory the collection before editing

1. Find the public project URL, its path prefix, the Pages workflow or publishing configuration, the Artoo artifact manifest, and the contributor instructions. Identify the local build and preview commands. Read build scripts before running them. A capture job may invoke a paid service or a signed-in agent.
2. List routes from the manifest, generated navigation, sitemap, and files served by the preview. Include pages absent from the top navigation, standalone interactive views, and URLs linked from the README. Record externally referenced fragments and query parameters. For a one-page site, inventory sections instead.
3. Trace each route to the file that owns its prose, layout, and data. Markdown might produce the HTML. An authored HTML page might load generated JSON. Follow one heading and one example all the way from source to rendered page. Change generated content at its source.
4. Open the current home, one ordinary subpage, and one unusually dense or interactive page at phone and desktop widths. Save enough evidence outside the published tree to compare the result. Note what a reader can already accomplish. Preserve the best example, any hand-edited illustrations, valid inbound links, and established project vocabulary.
5. Write one row per route or section in working notes. Use concrete verbs in the question and next step. Fill gaps by inspecting the product, release, or source. Mark a claim unverified when you cannot reproduce it.

| Current route and fragment | Owning file or generator | Reader and question | Evidence on the page | Decision | Primary next action and destination |
| --- | --- | --- | --- | --- | --- |
| Example: use-cases.html#review-a-screenshot | content/use-cases.md | Producer: what changed on the episode page? | Original button, editor's note, revised button | Keep as a worked example. Move generic instructions to the canvas guide. Retain the old anchor. | Try the review → tour.html#review-a-screenshot |
| Fill in the next existing route | Actual path | Who needs to do what? | Actual screen, output, procedure or reference | Keep, edit, combine or redirect | Specific verb and actual route |

**Decision rule.** If two pages answer the same question with the same evidence, choose the stronger existing destination. Keep the full procedure there and replace the other copy with a short contextual link. Preserve a used URL or fragment with an alias or redirect supported by the current host. If a proposed new page has no independent reader question, improve a section on an existing page.

### Set an observable target for a redesign

Record a baseline and an intended difference before editing. Use this form: “Today the reader clicks **[current label]** and lands at **[current state]**. After this work they can **[specific task]** and inspect **[specific evidence]**.” Beside it, identify one visible design decision and where it belongs in the shared source. When a site already meets either goal, show the evidence, name the existing design decision you will preserve, and describe the improvement you can still make elsewhere. Track existing strengths and new work separately.

For example, a research site might already have a working replay. A chapter promising “See why this claim stayed unverified” can link directly to the relevant exchange. Show the claim, the attempted verification and the actual CLI refusal together. Test that a newcomer can reach the evidence and explain the result without hunting through ten exchanges. Preserve the full replay for readers who want the sequence. The project may already require a proof-first opening; this change can respect that rule.

## 2. Assign one primary job to each destination

Use only the roles that have material in this project. A small CLI can cover its promise, first run, and one worked example on a single page. A specialized reader can keep its own full-screen interface and a visible route back to the collection.

| Role | The visitor is asking | What belongs here | A useful finish |
| --- | --- | --- | --- |
| Project home | Would I use this? | A specific task, the product doing it, the result, several distinct capabilities, routes onward | Try the first task or explore the sample |
| Quick start | How do I get one successful run? | Prerequisites, a tested short path from a fresh install, expected output, recovery from the first likely failure | The visitor can inspect something they made |
| Task guide | How do I do this again on my work? | Starting state, exact controls or commands, inputs, steps, success condition | The visitor can repeat the task independently |
| Worked example | How did someone solve this particular problem? | Named scenario, constraint, decision, before and after, relevant files | Reuse its inputs or follow the general task |
| Sample or template | Can I explore or start from this? | State whether the item is read-only, editable in the browser, or downloadable. Give the opening command where needed. | Open a working sample or create a copy |
| Reference | What does this accept, return, or support? | Parameters, defaults, versions, supported engines, contracts, errors; a stable anchor per topic | Find one answer and resume work |
| Architecture or design note | Why does it work this way? | Components and responsibilities, a traced operation, tradeoffs; clearly date and label proposals | Understand a shipped behavior or evaluate a proposal |

A CLI reference is appropriate for a developer looking up a flag. A homepage inviting someone to try a workflow should land on a human procedure, even if one step uses that same flag. Keep technical details available a link deeper.

## 3. Write the homepage around a demonstrable task

Before drafting copy, complete these sentences in plain language.

- **Reader:** “Someone who ___ currently has to ___.”
- **Opening example:** “They start with ___, use the project to ___, and can see ___ change.”
- **Proof:** “I can show this with ___, produced by ___.”
- **Next step:** “After clicking ___, they can ___.”

If the proof or next step is missing, pick a smaller example that works today. For each additional chapter, identify a **different decision or action**. Two screenshots with different colors and the same outcome are one chapter.

| Position | Write and show | Example from Toucan |
| --- | --- | --- |
| First screen | Name the project, give it a plain-language promise, show recognizable work, and offer one primary action. Place the released version nearby when the software has versioned releases. | “Share a canvas with your agent.” The radio rundown shows a concrete cut. “Install Toucan” takes the reader to setup. |
| Opening proof | Establish the input, constraint and visible result. Use one coherent specimen that will still make sense next month. | Twenty minutes of tape must fit an eighteen-minute slot. The ferry cut changes the final cue while preserving the closing tape. |
| Scrolling chapters | Pair a short action heading with one example, its proof, and a link to the next useful destination. Make the sequence understandable when someone simply scrolls. | “Point to what needs fixing.” Show the feedback and revised button. Link to the guided review. |
| Optional walkthrough | Identify what the viewer will learn and give the runtime. Keep the full narrated video click-to-play. | A 4:45 walkthrough shows editing with an agent, placing images by hand, and exporting the result. The thumbnail can carry the episode artwork. |
| Closing navigation and footer | Group internal destinations by intent. Put project identity, source, license and studio links in the shared footer. | Try a canvas, find a guide, or look up a command. The footer connects the project to other Lyra Forge tools. |

**Choose the homepage action from the visitor’s point of view.** Someone arriving cold should understand the button without reading the demo caption. For a tool they install, link directly to setup. If they can explore a real sample first, offer that as a secondary text link and land on the result. Reserve commands, errors, and individual records for the chapter where their meaning is clear. Test what each visitor encounters on arrival: installation choices, a readable result, or the specific record the chapter promises.

**Write the link before polishing the heading.** “See more” conveys little. “Try a screenshot review” promises a procedure. The destination must supply sample input or explain how to use the visitor's own, show where to leave a note, and let them verify the result. A PNG works for “Enlarge screenshot.” A PDF works for “Download the printable guide.” A download used in a workflow belongs beside the instructions that consume it.

Prefer the product's words for controls and the reader's words for goals. For example, “Open **History**, select *First sketch*, and compare it with the live drawing” gives the reader an action and a result. Cut phrases such as “powerful collaboration,” “seamless workflow,” “learn more,” and “unlock the full potential.” Keep captions complementary. If the image already labels the button, use the caption to explain what changed or what the reader should inspect.

**Use examples that belong to this product.** For a research CLI, follow one source from capture to a claim another researcher can inspect. For a chart library, show how a reader chooses a chart for a comparison and what the resulting chart reveals. These are candidate storylines: check the real commands, data and result before writing them as product claims. Label fictional inputs and accelerated or scripted demonstrations. Keep demos of future behavior in a clearly marked design note.

## 4. Apply the visual system to the whole collection

Start with the project's shared stylesheet, layout or template. Extend its semantic tokens once, then map headings, body, navigation, figures, links, forms, tables, code, and footer to those roles. Check hand-authored pages and generator templates separately. Keep an established product palette where it encodes information, such as the colors of categories in an actual chart. Apply the family identity around the artifact.

**Acceptance for a style rollout across Lyra Forge projects.** Start with the live Toucan homepage and a reading page as the visual reference. A toolkit's default colors and system fonts do not establish a project identity. Use Admiralty for the shared shell, display and reading type, paper, actions and footer unless the owner named a different visual identity. Preserve meaningful colors within the product specimen. Before releasing, compare rendered screenshots of the reference and candidate at 390px and 1440px, including an ordinary subpage and the densest view. Verify the computed colors and that the local font files actually loaded. If the reader journey improves but the family resemblance is missing, record the content gain and hold the visual rollout.

**Default Lyra palette and type.** Use these values when the project lacks an approved identity. They are the Admiralty values used by Toucan. Select foreground and background as a pair and check the rendered contrast, including hover, focus and selected states.

| Role | Default | Where it earns its place |
| --- | --- | --- |
| Ink and shell | Navy `#0f2a4a`, night `#0b1e36` | Body text on light paper, site header, dark closing section |
| Paper and secondary surface | Chart white `#f4f7f8`, shallows `#cfe4ee` | Reading surface, occasional chapter change, active item on navy |
| Supporting text and rules | Slate `#3d5674`, mist `#a9bdd4`, line `#c9d6e0` | Slate text on paper, mist text on navy, quiet separators |
| Action and emphasis | Magenta `#c2266f`, beacon `#f06aa8` | Links on light surfaces, a primary button with dark text on beacon. Add underline, shape or text to communicate state. |
| Project extension | One related tint for a meaningful recurring role | Toucan uses pale rose `#f4e7ef` for review. Reuse the role consistently. |
| Display, reading, code | Instrument Serif, Source Sans 3, Fragment Mono | Display face for editorial headings; sans for prose and every nav control; mono for commands, file paths and data. Supply local licensed fonts, fallback families and notices. |

Use a clearly dominant heading, a short readable text column (roughly 55–75 characters on wide screens), and room for an artifact to occupy more width than its explanation. On a phone, stack heading, explanation, visual and caption in reading order. Favor one wide, legible product surface over a row of thumbnail cards. Give long tables and code their own horizontal scroll area. A wide figure is useful only if a reader can still find the changed detail.

**Illustrate the work.** A chart, typed specimen, annotated timeline, terminal transcript, or bespoke SVG can be a better demonstration than a screenshot. For an SVG, use the project's ink and paper, label real entities, and explain what a connection carries. Design around the subject: a microphone, archive and transmitter can show a radio signal path. Verify that text remains legible when the illustration shrinks. Keep screenshots of the actual product faithful to the captured state.

**Navigation is a shared component.** Use identical route ordering, control height, type size, spacing and active treatment on home and ordinary subpages. Make the current page identifiable. Include the same header and footer in generated pages through their generator. On small screens make the menu keyboard- and touch-operable. If the header sticks, opening a menu after scrolling must keep it in place. Put any chapter navigation below it and give anchor targets enough clearance for both bars. Check a direct deep link. Keep the full-screen tool's local controls where its work needs them and provide a discoverable way back.

### When the design is underspecified

Use these as starting values where the current collection has no comparable component. Adjust when real content breaks at a tested width.

| Component | Default implementation | Check it with real content |
| --- | --- | --- |
| Reading page | Body 17–19px, line height 1.5–1.65, measure near 65ch. Use a single h1 and descriptive h2s. | A paragraph, ordered procedure, warning, code sample and long heading remain easy to scan at 200% zoom. |
| Homepage spread | At wide widths give roughly one third to copy and two thirds to the artifact. Start with 16–24px outer gutters on phones. | Stack before the artifact's critical labels become too small. Inspect an actual phone-sized screenshot. |
| Header and menus | One shared height near 56px, same font and padding for links and disclosure buttons, touch targets near 44px. | Changing pages or opening a menu keeps the other controls in place. Tab, Enter and Escape work. |
| Contrast and focus | Aim for at least 4.5:1 for ordinary text and 3:1 for large text. Use a clearly contrasting focus outline with space around it. | Check text on the actual section background. Tab through links on both navy and paper. |
| Tables and commands | Real text with meaningful headers. Use local scrolling on the code or table wrapper when necessary. | At 390px the reader can reach the last column or copy a whole command while the page itself stays within the viewport. |

## 5. Choose and capture evidence

| Need | Use | Minimum evidence |
| --- | --- | --- |
| See an outcome | A real screenshot or rendered artifact | Enough of the window to identify the tool and context, plus a readable changed detail |
| See an interaction or sequence | A short muted inline clip with a poster | Initial state, visible action, resulting state long enough to inspect |
| Inspect a command-line tool | A tested command and short actual output | Sample input, invocation, output, and an explanation of what success looks like |
| Understand a relationship | Purpose-built SVG, map or diagram | Labeled entities, meaningful connections, a text explanation |
| Learn the complete workflow | A narrated walkthrough | Runtime, topic, intentional play action, descriptive external link or fallback |

Capture from a disposable example with public-safe inputs. A useful screenshot often includes the selected object, its surrounding canvas, and the panel showing the consequence. When the full window makes the evidence tiny on a phone, include one detail crop with an identifying caption or link to enlargement. Write alt text that names the meaningful change. Store the input and capture recipe in the project when practical so future releases can reproduce the example.

For silent loops, use muted inline video, a poster, and an explicit width and height. Start when visible, pause offscreen or when the tab is hidden, respect a manual pause, and honor reduced motion. Put a labeled play/pause button below the picture and offer native player controls on request. Requesting native controls at startup can obscure the opening frames on iOS. Give readers a playable fallback if scripting is unavailable. Check that the first visit, replay, keyboard operation and reduced-motion path all work. Reserve autoplay for short silent demonstrations.

## 6. Migrate in small, verifiable passes

1. **Map.** Complete the inventory. Choose one canonical destination for each promise. Preserve useful old routes, fragment IDs, and sample query parameters.
2. **Prove one path.** Implement a homepage chapter and its destination together. Start at the chapter and follow the instructions as a new reader. Fix missing inputs, filenames, command context and signs of success before repeating the pattern.
3. **Apply the shell.** Style the home, an ordinary task or example, and the densest reference page. Compare at the same viewport. Then propagate the shared component to remaining routes.
4. **Rebuild from source.** Run the repository's documented build. Confirm the generated pages still contain your changes. Verify under the real GitHub Pages path prefix; root-relative asset URLs such as `/assets/demo.mp4` often escape a project mounted at `/project/`.
5. **Align release details.** Read the current released version from the project's release authority. Use a manifest, generator or check to keep visible versions and tag links aligned. Distinguish an unreleased capability demonstrated from a checkout. Do not invent a version for an unversioned project. Derive license wording from the project license and third-party terms. For Toucan, the MIT statement covers its original work and tldraw has its own terms.
6. **Finish the shared footer.** Link the source repository and license, Lyra Forge, Lyra TK, and relevant public sibling projects or the public open-source catalog. Verify destinations from the existing official sites or repository. Keep this module consistent across pages and keep internal navigation in the closing section.
7. **Verify, then report.** Use the checks below. Keep review notes and captures outside the published directory. For authorized publication, use the repository's Artoo artifact and deployment configuration, then verify the public URL. A successful local build proves the preview only.

### Three existing collection patterns

| Repository specimen | Start here | Preserve | First useful change |
| --- | --- | --- | --- |
| Toucan | `website/artifact.toml`, `website/content/`, page generators under `scripts/` | Existing HTML routes and anchors, sample map URLs, generated feature index | Pair a homepage action with its exact task-guide section. Check that regenerating the index keeps its shared header. |
| Flip | `website/artifact.toml`, `website/build.py`, and the authored HTML and scripts under `website/site/` | The split between page markup and generated data, the flipbook, notebook and specification destinations | Trace one homepage promise into the first-run or notebook experience. Edit its owning page and verify the data still loads after the build. |
| Vizier's chart-form reader | `docs/reader/artifact.toml`, `index.html`, `main.js`, exported `data.json` | Its reference-first interaction and its `reader` deployment subpath | Frame the reader's next decision clearly while preserving the chart families, selection controls, and live examples. Test from the mounted URL. |

These are starting points from inspected repositories. Recheck paths, manifests and build commands in the target checkout. Borrow the pattern that fits the job. A CLI with one worked transcript can meet this guide without adding a gallery, a film or a second page.

## 7. Acceptance test and handoff

Run the same checks on the built result that a visitor will use. Record **pass**, **fail**, or **untested** with a route and observation. Fix failures within scope. Identify the specific missing device, credential, or source for anything untested.

| Check | How to test | Pass condition |
| --- | --- | --- |
| First visit | Read the first screen and follow its main action without using the top nav | You can name the reader, task and outcome, and reach an actionable next step |
| Content ownership | Compare each pair of pages that previously overlapped | Each answers its assigned question. Generic steps live in one place and examples link to them. |
| Link promises | Click every primary CTA; inspect internal fragments after the build | Destination answers the link text; its heading is visible below sticky bars; images and downloads open where promised |
| Shared shell | Check every ordinary route at 390px and 1440px, plus just above and below the menu breakpoint | Same header geometry, current location, footer and readable type. Open and dismiss the menu after scrolling; focus returns to a sensible control. |
| Reading and evidence | Inspect the homepage, a guide, the densest reference and a standalone view at phone size | No whole-page horizontal overflow, clipped controls or unreadable key detail. Associated captions and texts explain the evidence. |
| Media | Enter and leave a chapter, return, pause manually, enable reduced motion, navigate by keyboard | Playback follows those choices; controls stay reachable; the poster and first frames show useful work |
| First run | Follow the published steps with the named inputs in a fresh example directory | The command or gesture produces the described result. A reader knows what file, state or output to inspect. |
| Release and rights | Compare the visible version and release link with their authority; follow license and footer links | Version, destination, ownership and dependency wording are accurate |
| Reproducibility and publication | Build from the owning sources; visit a nested route directly under the deployment prefix; check assets and console | No missing assets or broken deep links. If published, verify the actual public pages and record the deployment revision. |

**Before calling a redesign complete**, compare the same home and subpage viewports with the baseline. Name the reader-visible change and where to see it. A shared footer and a working mobile menu count as shell improvements. Assess the content journey and visible product proof separately. A change of palette is optional when the project has an established identity; document which traits should carry across the collection and show how you checked them.

Run the repository's site-specific tests as well as the artifact build. Find them in the workflow or test directory (Flip, for example, has `tests/test_website.py`). Exercise the documented deployment prefix even when an artifact's own subpath is empty. Compare the targets of project-specific footer links before standardizing them; move useful provenance links beside their evidence. For studio identity use [Lyra Forge](https://lyra-forge.com/) and [Lyra TK](https://www.lyra-tk.com/). Label a plugin marketplace as a marketplace.

**Handoff format.** Give the changed routes and what each now helps a reader do. Name redirects, retained anchors and any intentional project-specific departures from these defaults. Include commands run, sample inputs used, viewport sizes, failures or unverified paths, and the preview or verified live URL. Keep “implemented,” “verified in a browser,” and “published” distinct.

### Run an implementation trial

1. Freeze the base commit and the guide used. Before editing, take a screenshot and complete one real visitor task from the homepage. Record the action labels, destinations, and where the reader has to search or guess.
2. Write one sentence defining the improved journey and one visible arrangement that will put the product evidence within reach. Use a real specimen from the project. For a CLI, a short offline transcript or an inspectable output file works.
   Before the first product command, create a disposable project and home. Point configuration, registry and history at that home, clear inherited provider credentials, and confirm the executable, model and endpoint. A local provider can still read a user's settings or register a project. Use an existing public specimen if isolation is unavailable. Publish only the fields needed to demonstrate the result.
3. Implement that path first. Show the result in the opening or its first chapter, give the principal button a specific label, and land on the exact evidence or runnable instructions. Carry the shared design into the destination and another page. Keep existing product claims and inbound URLs accurate.
   Name three distinct routes when the collection has them. For each, state the reader question and one visible change that helps answer it. A homepage fragment counts as part of the homepage. A backlink alone demonstrates navigation only. For a single-page collection, apply this test to three distinct sections when available.
4. Compare the same two viewports and repeat the original task. Record what became easier, which old strengths survived, and whether any old destination disappeared. Run project-specific site tests and interactive checks. A neutral reviewer must be able to see the change and complete the task from the rendered site without your handoff.
5. The reviewer decides separately whether the candidate improves the reader's experience and whether it is safe to release. If only the shell improved, record partial success and keep the proposed redesign in preview. Freeze the agent's result before the reviewer repairs it; keep assisted fixes out of the experiment score.

**Starter assignment to paste into another agent's brief**

> Apply this guide to the existing project description. From the current homepage, find a real task that takes unnecessary searching. Record the baseline path and choose one product result the visitor will be able to inspect or reproduce. Implement a visibly improved homepage-to-result path and extend the visual system to its destination and another page. Compare the before and after at phone and desktop widths. Run the project's own site tests, preserve used links and provide a working prefixed preview. Return the candidate, the path you actually exercised, and outstanding issues. Publish only when the assignment authorizes publication.
