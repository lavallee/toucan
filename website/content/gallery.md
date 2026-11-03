# Gallery

Every diagram toucan starts from, as it draws them. Each one is ordinary shapes you can change. These same diagrams are the test set for layout, so a change that makes one worse fails the build.

Start one with `toucan new NAME --template ID`, or from **Start from** on the index page. An agent can read the description behind any of them with `toucan templates show ID`, then draw its own in the same form with `toucan --canvas NAME draw -`. See [See it work](tour.html) for that in action.

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

### Build pipeline

Stages with dependencies: builds, data pipelines, project plans.

![The Build pipeline template, as drawn](assets/gallery/pipeline.png)

`toucan new NAME --template pipeline`

### State machine

The states something moves through, and what moves it.

![The State machine template, as drawn](assets/gallery/state-machine.png)

`toucan new NAME --template state-machine`

### Cycle

A loop that repeats: plan, do, check, act.

![The Cycle template, as drawn](assets/gallery/cycle.png)

`toucan new NAME --template cycle`

### Sequence diagram

Who says what to whom, in order: protocols and integrations.

![The Sequence diagram template, as drawn](assets/gallery/sequence.png)

`toucan new NAME --template sequence`

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

## Work and decisions

Sorting things, comparing them, and working out why.

### Kanban board

Work by status.

![The Kanban board template, as drawn](assets/gallery/kanban.png)

`toucan new NAME --template kanban`

### 2x2 matrix

Sorting options along two dimensions.

![The 2x2 matrix template, as drawn](assets/gallery/quadrant.png)

`toucan new NAME --template quadrant`

### Customer journey

A person’s experience across stages, and where it hurts.

![The Customer journey template, as drawn](assets/gallery/journey-map.png)

`toucan new NAME --template journey-map`

### Responsibility chart

Who is responsible, accountable, consulted and informed.

![The Responsibility chart template, as drawn](assets/gallery/responsibility.png)

`toucan new NAME --template responsibility`

### Comparison table

Weighing options against criteria.

![The Comparison table template, as drawn](assets/gallery/comparison.png)

`toucan new NAME --template comparison`

### Fishbone diagram

Finding the causes behind a problem.

![The Fishbone diagram template, as drawn](assets/gallery/fishbone.png)

`toucan new NAME --template fishbone`

### Funnel

Stages that narrow, and where people drop out.

![The Funnel template, as drawn](assets/gallery/funnel.png)

`toucan new NAME --template funnel`
