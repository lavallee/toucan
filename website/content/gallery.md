# Diagram templates

::: html
<link rel="stylesheet" href="assets/admiralty.css">
<script src="assets/site-nav.js"></script>
<script defer src="assets/site-footer.js"></script>
:::

Choose a starting layout for your own canvas. Each preview includes the command to create an editable copy.

A canvas *has* diagrams rather than *being* one. Each diagram below is a **block**: start a canvas with one (`toucan new NAME --template ID`, or **Start from** on the index page), or add it beside what is already on a canvas (`toucan --canvas NAME add ID`, or **Add** above the canvas). An agent can read the description behind any of them with `toucan templates show ID`, then draw its own in the same form with `toucan --canvas NAME draw -`.

## Starters

A **starter** is a whole canvas on one subject, made of several blocks laid out under their own headings. Start one the same way: `toucan new NAME --template ID`.

- **System design** (`system-design`): One system from four sides: its parts, a key request through it, its data, and the decisions behind it. It has: The parts, Checkout, step by step, The data, Decisions.
- **Incident review** (`incident-review`): What happened, why, and what changes: a blameless review on one page. It has: What happened, Why, What changes.
- **Product strategy** (`product-strategy`): Where a product is going: the goal, the bets, the plan and the risks. It has: The goal, The bets, The plan, The risks.
- **Project kickoff** (`project-kickoff`): Starting a project together: what it is for, who does what, the plan and who to keep close. It has: What it is for, Who does what, The plan, Who to keep close.
- **Research plan** (`research-plan`): A question worth answering: what to ask, where to look, and what has turned up. It has: What we want to know, Where to look, What has turned up.
- **Team retrospective** (`team-retro`): A retrospective that goes past the sticky notes: what happened, why the big one happened, and what to try. It has: How it went, Why the tests were flaky, What we will try.

## Processes

What happens, in what order, and who does it.

### Flowchart

A process with decisions: how something gets done, and what happens when it goes wrong.

![The Flowchart template, as drawn](assets/gallery/flowchart.png)

`toucan new NAME --template flowchart`

### Swimlane process

A process across several people or teams, so handoffs show.

![The Swimlane process template, as drawn](assets/gallery/swimlane.png)

`toucan new NAME --template swimlane`

### Sequence diagram

Who says what to whom, in order: protocols and integrations.

![The Sequence diagram template, as drawn](assets/gallery/sequence.png)

`toucan new NAME --template sequence`

### State machine

The states something moves through, and what moves it.

![The State machine template, as drawn](assets/gallery/state-machine.png)

`toucan new NAME --template state-machine`

### Build pipeline

Stages with dependencies: builds, data pipelines, project plans.

![The Build pipeline template, as drawn](assets/gallery/pipeline.png)

`toucan new NAME --template pipeline`

### Funnel

Stages that narrow, and where people drop out.

![The Funnel template, as drawn](assets/gallery/funnel.png)

`toucan new NAME --template funnel`

### Cycle

A loop that repeats: plan, do, check, act.

![The Cycle template, as drawn](assets/gallery/cycle.png)

`toucan new NAME --template cycle`

### SIPOC

A process at a glance: suppliers, inputs, steps, outputs and customers.

![The SIPOC template, as drawn](assets/gallery/sipoc.png)

`toucan new NAME --template sipoc`

## Structures

What belongs under what.

### Org chart

Who reports to whom.

![The Org chart template, as drawn](assets/gallery/org-chart.png)

`toucan new NAME --template org-chart`

### Decision tree

Choosing between outcomes, one question at a time.

![The Decision tree template, as drawn](assets/gallery/decision-tree.png)

`toucan new NAME --template decision-tree`

### Mind map

Getting ideas out and grouping them, around one central topic.

![The Mind map template, as drawn](assets/gallery/mind-map.png)

`toucan new NAME --template mind-map`

### Goals and key results

An objective, the results that show it was met, and the work to get there.

![The Goals and key results template, as drawn](assets/gallery/okr-tree.png)

`toucan new NAME --template okr-tree`

## Systems

Named parts and the real connections between them.

### Layered architecture

How a system is layered, and what talks to what.

![The Layered architecture template, as drawn](assets/gallery/architecture.png)

`toucan new NAME --template architecture`

### Service map

Services and their dependencies, grouped by boundary.

![The Service map template, as drawn](assets/gallery/services.png)

`toucan new NAME --template services`

### Systems map

Many named parts in a few systems: what there is, what state each part is in, who owns it, and what feeds what.

![The Systems map template, as drawn](assets/gallery/systems-map.png)

`toucan new NAME --template systems-map`

### Network topology

How machines and networks connect.

![The Network topology template, as drawn](assets/gallery/network.png)

`toucan new NAME --template network`

### Entity relationships

A data model: what is stored, and how it relates.

![The Entity relationships template, as drawn](assets/gallery/er-diagram.png)

`toucan new NAME --template er-diagram`

## Time

Where position means a date.

### Roadmap

What happens when, by team or workstream.

![The Roadmap template, as drawn](assets/gallery/roadmap.png)

`toucan new NAME --template roadmap`

### Timeline

Events in order: a history, an incident, a project.

![The Timeline template, as drawn](assets/gallery/timeline.png)

`toucan new NAME --template timeline`

## Work

Tasks, people and experiences.

### Kanban board

Work by status.

![The Kanban board template, as drawn](assets/gallery/kanban.png)

`toucan new NAME --template kanban`

### Customer journey

A person’s experience across stages, and where it hurts.

![The Customer journey template, as drawn](assets/gallery/journey-map.png)

`toucan new NAME --template journey-map`

### Responsibility chart

Who is responsible, accountable, consulted and informed.

![The Responsibility chart template, as drawn](assets/gallery/responsibility.png)

`toucan new NAME --template responsibility`

### Retrospective

Looking back on a stretch of work: what to keep, what to change, what to try.

![The Retrospective template, as drawn](assets/gallery/retro.png)

`toucan new NAME --template retro`

### Empathy map

What someone says, thinks, does and feels, to design from their side.

![The Empathy map template, as drawn](assets/gallery/empathy-map.png)

`toucan new NAME --template empathy-map`

### User story map

What people do, in order, and what each release lets them do.

![The User story map template, as drawn](assets/gallery/story-map.png)

`toucan new NAME --template story-map`

## Decisions

Weighing options and finding causes.

### 2x2 matrix

Sorting options along two dimensions.

![The 2x2 matrix template, as drawn](assets/gallery/quadrant.png)

`toucan new NAME --template quadrant`

### Comparison table

Weighing options against criteria.

![The Comparison table template, as drawn](assets/gallery/comparison.png)

`toucan new NAME --template comparison`

### Fishbone diagram

Finding the causes behind a problem.

![The Fishbone diagram template, as drawn](assets/gallery/fishbone.png)

`toucan new NAME --template fishbone`

### Pros and cons

One choice, weighed: what speaks for it, what against, and what you still need to know.

![The Pros and cons template, as drawn](assets/gallery/pros-cons.png)

`toucan new NAME --template pros-cons`

### SWOT

Strengths, weaknesses, opportunities and threats: where you stand before a plan.

![The SWOT template, as drawn](assets/gallery/swot.png)

`toucan new NAME --template swot`

### Stakeholder map

Who has a stake, and how closely to involve them, by influence and interest.

![The Stakeholder map template, as drawn](assets/gallery/stakeholder-map.png)

`toucan new NAME --template stakeholder-map`

### Urgent and important

Sorting a to-do list: do now, schedule, delegate or drop.

![The Urgent and important template, as drawn](assets/gallery/eisenhower.png)

`toucan new NAME --template eisenhower`

### Five whys

Asking why until you reach a cause you can act on.

![The Five whys template, as drawn](assets/gallery/five-whys.png)

`toucan new NAME --template five-whys`

### Decision log

What was decided, why, instead of what, and when to look again.

![The Decision log template, as drawn](assets/gallery/decision-log.png)

`toucan new NAME --template decision-log`
