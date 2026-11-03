// Formats: named rules for how a kind of canvas behaves. A box stays short and its detail opens on click; a format adds
// how to move through the canvas (`walk`) and what an agent should do on it (`guide`), so the agent needn't guess.
//   walk: 'edges'  ← → follow the arrows; where they branch, the card offers the choices.
//   walk: 'lanes'  ← → move along the box's frame, left to right.

export const FORMATS = {
	story: {
		label: 'Story map',
		description: 'One path to follow, with room beside each stop',
		walk: 'edges',
		guide: 'This canvas is a story map: one path of short-titled stops, with the detail in each stop\'s `meta.detail`. Keep titles short and put quotations and notes in `meta.detail`. Put answers and side-trips as a dashed branch (`proposed: true`) in the space beside the stop they belong to, and don\'t squeeze the path.',
	},
	ideas: {
		label: 'Ideas map',
		description: 'A grid of ideas, where empty cells mean something',
		walk: 'lanes',
		guide: 'This canvas is an ideas map: frames are ideas, position across is sequence, and a gap means that idea is absent there, so never fill gaps just to tidy up. Keep labels short and put passages in `meta.detail`. Show a connection between boxes as a dashed arrow (`proposed: true`), and don\'t move boxes out of their column.',
	},
	process: {
		label: 'Process',
		description: 'Steps and decisions, in order',
		walk: 'edges',
		guide: 'This canvas is a process diagram: steps and decisions that run in one direction. Keep each step to a few words, starting with a verb, and put the rest in `meta.detail`. A decision is a diamond, and each way out of it has a label. Add steps with `import` so they are laid out in the flow, and keep the direction consistent.',
	},
	hierarchy: {
		label: 'Hierarchy',
		description: 'A tree: reports, choices, causes or ideas',
		walk: 'edges',
		guide: 'This canvas is a hierarchy: each box has one parent, and siblings are the same kind of thing at the same level. Keep labels short, put a new child beside its siblings and aligned with them, and don\'t add arrows across branches.',
	},
	timeline: {
		label: 'Timeline',
		description: 'Things in time order, along a scale',
		walk: 'lanes',
		guide: 'This canvas is a timeline: position across means time, so never move something sideways without its date changing. Keep labels short and put the rest in `meta.detail`.',
	},
	board: {
		label: 'Board',
		description: 'A grid of cells: status, sorting, comparison',
		walk: 'lanes',
		guide: 'This canvas is a board: a position means something (a column, a row, a quadrant), so put a new card where it belongs, aligned with its neighbours and the same size, and leave empty cells empty. Keep cards short and put the rest in `meta.detail`.',
	},
	system: {
		label: 'System diagram',
		description: 'Named parts and what connects them',
		walk: 'edges',
		guide: 'This canvas is a system diagram: a box is a named component, a frame is a boundary, and an arrow means something real depends on or flows to something else. Keep box names short and put responsibilities and notes in `meta.detail`. Propose new components and connections dashed (`proposed: true`) beside what they connect to, and don\'t add an arrow you can\'t justify. Keep related parts in a frame with a clear name: zoomed out, people see only frames and the connections between them.',
	},
}

export const formatList = () => Object.entries(FORMATS).map(([id, { label, description, walk }]) => ({ id, label, description, walk }))
