// Tidy arrows: a canvas script (tldraw) that adds a "Tidy arrows" button. It re-routes arrows so fewer
// of them run through boxes or cross each other, without moving any box: the arrangement stays yours.
//
//   toucan --canvas NAME script put tidy-arrows examples/tidy-arrows.js
//
// For each arrow bound at both ends it tries a straight line, curves of several bends either way, and
// an elbow route, measures each on the real arrow geometry, and keeps the best:
//   score = 1000 × boxes it runs through + 100 × arrows it crosses + a little for length and curvature.
// Two passes, so later arrows' choices feed back into earlier ones. One click is one undo step.
// Agents can run it too: `toucan --canvas NAME exec -e 'return toucan.tidyArrows()'` returns the
// before and after counts.

const BENDS = [0, 40, -40, 80, -80, 140, -140, 220, -220, 350, -350, 500, -500, 750, -750, 1100, -1100]
const ELBOW_MIDPOINTS = [0.1, 0.25, 0.5, 0.75, 0.9]

/** Page-space polyline of a shape's geometry (arrows: the drawn path). */
const pathOf = (shape) => {
	const g = editor.getShapeGeometry(shape)
	return editor.getShapePageTransform(shape).applyToPoints(g.vertices)
}

const cross = (a, b, c, d) => {
	const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x))
	return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0
}
const crossings = (p, q) => {
	let n = 0
	for (let i = 1; i < p.length; i++) for (let j = 1; j < q.length; j++) if (cross(p[i - 1], p[i], q[j - 1], q[j])) n++
	return n
}
/** Does a polyline pass through a box (shrunk a little, so grazing an edge doesn't count)? */
const through = (path, b, pad = 6) => {
	const x0 = b.minX + pad, x1 = b.maxX - pad, y0 = b.minY + pad, y1 = b.maxY - pad
	if (x1 <= x0 || y1 <= y0) return false
	const inside = (p) => p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1
	const corners = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]
	for (let i = 1; i < path.length; i++) {
		if (inside(path[i])) return true
		for (let k = 0; k < 4; k++) if (cross(path[i - 1], path[i], corners[k], corners[(k + 1) % 4])) return true
	}
	return false
}
const length = (p) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q.x - p[i].x, q.y - p[i].y), 0)

function arrowsWithEnds() {
	return editor
		.getCurrentPageShapes()
		.filter((s) => s.type === 'arrow')
		.map((a) => {
			const ends = editor.getBindingsFromShape(a, 'arrow').map((b) => b.toId)
			return { id: a.id, ends: new Set(ends) }
		})
		.filter((a) => a.ends.size === 2)
}

/** Boxes an arrow could run through: anything but arrows, frames, and the shapes it connects (and their frames). */
function obstaclesFor(arrow, boxes) {
	const skip = new Set(arrow.ends)
	for (const id of arrow.ends) for (const anc of editor.getShapeAncestors(id)) skip.add(anc.id)
	return boxes.filter((b) => !skip.has(b.id))
}

function measure() {
	const boxes = editor.getCurrentPageShapes().filter((s) => s.type !== 'arrow' && s.type !== 'frame').map((s) => ({ id: s.id, b: editor.getShapePageBounds(s) }))
	const arrows = arrowsWithEnds()
	const paths = new Map(arrows.map((a) => [a.id, pathOf(editor.getShape(a.id))]))
	let thru = 0, crossed = 0
	arrows.forEach((a, i) => {
		thru += obstaclesFor(a, boxes).filter((o) => through(paths.get(a.id), o.b)).length
		for (const other of arrows.slice(i + 1)) if (![...a.ends].some((e) => other.ends.has(e))) crossed += crossings(paths.get(a.id), paths.get(other.id))
	})
	return { arrows: arrows.length, throughBoxes: thru, crossings: crossed }
}

function tidy() {
	const before = measure()
	editor.markHistoryStoppingPoint('tidy arrows')
	const boxes = editor.getCurrentPageShapes().filter((s) => s.type !== 'arrow' && s.type !== 'frame').map((s) => ({ id: s.id, b: editor.getShapePageBounds(s) }))
	const arrows = arrowsWithEnds()
	const originals = new Map(arrows.map((a) => {
		const { kind, bend, elbowMidPoint } = editor.getShape(a.id).props
		return [a.id, { kind, bend, elbowMidPoint }]
	}))
	const paths = new Map(arrows.map((a) => [a.id, pathOf(editor.getShape(a.id))]))
	const candidates = [...BENDS.map((bend) => ({ kind: 'arc', bend, elbowMidPoint: 0.5 })),
		...ELBOW_MIDPOINTS.map((elbowMidPoint) => ({ kind: 'elbow', bend: 0, elbowMidPoint }))]
	for (let pass = 0; pass < 2; pass++) {
		for (const a of arrows) {
			const obstacles = obstaclesFor(a, boxes)
			const others = arrows.filter((o) => o.id !== a.id && ![...a.ends].some((e) => o.ends.has(e)))
			let best = null
			for (const c of candidates) {
				editor.updateShape({ id: a.id, type: 'arrow', props: { kind: c.kind, bend: c.bend, elbowMidPoint: c.elbowMidPoint } })
				const path = pathOf(editor.getShape(a.id))
				const thru = obstacles.filter((o) => through(path, o.b)).length
				const crossed = others.reduce((n, o) => n + crossings(path, paths.get(o.id)), 0)
				const score = 10000 * thru + 100 * crossed + 0.02 * length(path) + 0.03 * Math.abs(c.bend) + (c.kind === 'elbow' ? 15 : 0)
				if (!best || score < best.score) best = { ...c, score, path }
			}
			editor.updateShape({ id: a.id, type: 'arrow', props: { kind: best.kind, bend: best.bend, elbowMidPoint: best.elbowMidPoint } })
			paths.set(a.id, best.path)
		}
	}
	let after = measure()
	if (after.throughBoxes > before.throughBoxes) {
		for (const a of arrows) editor.updateShape({ id: a.id, type: 'arrow', props: originals.get(a.id) })
		after = measure()
	}
	return { before, after }
}

// The button, in the canvas's top-left corner under tldraw's menu.
const button = document.createElement('button')
button.textContent = 'Tidy arrows'
button.title = 'Re-route arrows to cross less and avoid boxes (boxes stay put)'
Object.assign(button.style, {
	position: 'absolute', top: '52px', left: '8px', zIndex: 300, padding: '4px 10px', font: '500 12px system-ui, sans-serif',
	background: 'var(--color-panel, white)', color: 'var(--color-text, #1d1d1d)', border: '1px solid var(--color-muted-2, #ddd)',
	borderRadius: '6px', boxShadow: '0 1px 3px rgb(0 0 0 / 0.12)', cursor: 'pointer',
})
let reset
button.onclick = () => {
	const { before, after } = tidy()
	button.textContent = `Tidy arrows: ${before.throughBoxes}→${after.throughBoxes} through boxes, ${before.crossings}→${after.crossings} crossings`
	clearTimeout(reset)
	reset = setTimeout(() => (button.textContent = 'Tidy arrows'), 4000)
}
editor.getContainer().appendChild(button)
toucan.tidyArrows = tidy
toucan.arrowStats = measure

return () => {
	clearTimeout(reset)
	button.remove()
	delete toucan.tidyArrows
	delete toucan.arrowStats
}
