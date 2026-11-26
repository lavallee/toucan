// routine: Stack frames
// description: The frames on the page go in one column (or row), in reading order, with even gaps between them and lined up on one edge. What's in each frame moves with it.
// engines: tldraw, excalidraw
// kind: layout
// when: A canvas has several sections and they've drifted apart or overlap; or a person asks for the sections in order.
// args: direction (DOWN or RIGHT, default DOWN); gap (px, default 80)

const scene = toucan.scene
// A plan's frames, and frames holding its shapes, stay where they are; the others are stacked clear of them.
const every = scene.items().filter((i) => i.kind === 'frame' && !i.parent)
const stays = every.filter((f) => scene.skipPlan(f.id) || scene.skipHolder(f.id))
const frames = every.filter((f) => !stays.includes(f))
if (frames.length < 2) return { summary: 'Fewer than two frames on this page: nothing to stack.', changed: 0 }
const down = (args.direction ?? 'DOWN').toUpperCase() !== 'RIGHT'
const gap = args.gap ?? 80
// Reading order: top to bottom, then left to right, with frames whose tops are close counted as one row.
const ordered = [...frames].sort((a, b) => (Math.abs(a.y - b.y) < 60 ? a.x - b.x : a.y - b.y))
const startX = Math.min(...frames.map((f) => f.x)), startY = Math.min(...frames.map((f) => f.y))
let at = down ? startY : startX, changed = 0
scene.batch(() => {
	for (const f of ordered) {
		let x = down ? startX : at, y = down ? at : startY
		for (let hit; (hit = stays.find((s) => x < s.maxX + gap && s.x < x + f.w + gap && y < s.maxY + gap && s.y < y + f.h + gap)); ) {
			at = (down ? hit.maxY : hit.maxX) + gap
			if (down) y = at
			else x = at
		}
		if (Math.abs(x - f.x) > 0.5 || Math.abs(y - f.y) > 0.5) scene.place(f.id, { x, y, w: f.w, h: f.h }, { carry: true }), changed++
		at += (down ? f.h : f.w) + gap
	}
})
return { summary: changed ? `${frames.length} frames stacked ${down ? 'top to bottom' : 'left to right'}, ${gap}px apart.` : 'The frames are already stacked.', changed }
