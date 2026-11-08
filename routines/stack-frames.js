// routine: Stack frames
// description: The frames on the page go in one column (or row), in reading order, with even gaps between them and lined up on one edge. What's in each frame moves with it.
// engines: tldraw
// kind: layout
// when: A canvas has several sections and they've drifted apart or overlap; or a person asks for the sections in order.
// args: direction (DOWN or RIGHT, default DOWN); gap (px, default 80)

const frames = editor.getCurrentPageShapes().filter((s) => s.type === 'frame' && s.parentId === editor.getCurrentPageId())
if (frames.length < 2) return { summary: 'Fewer than two frames on this page: nothing to stack.', changed: 0 }
const down = (args.direction ?? 'DOWN').toUpperCase() !== 'RIGHT'
const gap = args.gap ?? 80
const box = (s) => editor.getShapePageBounds(s)
// Reading order: top to bottom, then left to right, with frames whose tops are close counted as one row.
const ordered = [...frames].sort((a, b) => (Math.abs(box(a).y - box(b).y) < 60 ? box(a).x - box(b).x : box(a).y - box(b).y))
const startX = Math.min(...frames.map((f) => box(f).x)), startY = Math.min(...frames.map((f) => box(f).y))
let at = down ? startY : startX
const updates = []
for (const f of ordered) {
	const b = box(f)
	const x = down ? startX : at, y = down ? at : startY
	if (Math.abs(x - f.x) > 0.5 || Math.abs(y - f.y) > 0.5) updates.push({ id: f.id, type: 'frame', x, y })
	at += (down ? b.h : b.w) + gap
}
editor.updateShapes(updates)
return { summary: updates.length ? `${frames.length} frames stacked ${down ? 'top to bottom' : 'left to right'}, ${gap}px apart.` : 'The frames are already stacked.', changed: updates.length }
