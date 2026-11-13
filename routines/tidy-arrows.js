// routine: Tidy arrows
// description: Re-route arrows so fewer cross or run through boxes. No box moves.
// engines: tldraw, excalidraw
// kind: arrows
// when: Arrows run through boxes or cross each other.

// For each arrow bound at both ends it tries a straight line, curves of several bends either way, and
// elbow routes, measures each on the arrow as drawn, and keeps the best:
//   score = 10000 × boxes it runs through + 100 × arrows it crosses + a little for length and curvature.
// Two passes, so later arrows' choices feed back into earlier ones. If that leaves more arrows through
// boxes than it started with, every arrow goes back as it was.

const BENDS = [0, 40, -40, 80, -80, 140, -140, 220, -220, 350, -350, 500, -500, 750, -750, 1100, -1100]
const ELBOW_MIDPOINTS = [0.1, 0.25, 0.5, 0.75, 0.9]
const scene = toucan.scene

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
	const x0 = b.x + pad, x1 = b.maxX - pad, y0 = b.y + pad, y1 = b.maxY - pad
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

// A plan's own arrows keep the route the plan gave them (they still count as arrows to stay clear of).
const arrowsWithEnds = () => scene.arrows().map((a) => ({ id: a.id, ends: new Set([a.from, a.to].filter(Boolean)) })).filter((a) => a.ends.size === 2)
const free = (arrows) => arrows.filter((a) => !scene.skipPlan(a.id))
const solids = () => scene.items().filter((s) => s.kind !== 'arrow' && s.kind !== 'frame').map((s) => ({ id: s.id, b: s }))

/** Boxes an arrow could run through: anything but arrows, frames, and the shapes it connects (and their frames). */
function obstaclesFor(arrow, boxes) {
	const skip = new Set(arrow.ends)
	for (const id of arrow.ends) for (const anc of scene.ancestors(id)) skip.add(anc)
	return boxes.filter((b) => !skip.has(b.id))
}

function measure() {
	const boxes = solids()
	const arrows = arrowsWithEnds()
	const paths = new Map(arrows.map((a) => [a.id, scene.arrowPath(a.id)]))
	let thru = 0, crossed = 0
	arrows.forEach((a, i) => {
		thru += obstaclesFor(a, boxes).filter((o) => through(paths.get(a.id), o.b)).length
		for (const other of arrows.slice(i + 1)) if (![...a.ends].some((e) => other.ends.has(e))) crossed += crossings(paths.get(a.id), paths.get(other.id))
	})
	return { arrows: arrows.length, throughBoxes: thru, crossings: crossed }
}

function tidy() {
	const before = measure()
	const boxes = solids()
	const arrows = arrowsWithEnds()
	const originals = new Map(arrows.map((a) => [a.id, scene.saveArrow(a.id)]))
	const routeOf = (id) => {
		const r = scene.arrows().find((x) => x.id === id)
		return `${r.kind} ${Math.round(r.bend)} ${r.kind === 'elbow' ? r.elbowMid : ''}`
	}
	const was = new Map(arrows.map((a) => [a.id, routeOf(a.id)]))
	const paths = new Map(arrows.map((a) => [a.id, scene.arrowPath(a.id)]))
	const candidates = [...BENDS.map((bend) => ({ kind: 'arc', bend, elbowMid: 0.5 })), ...ELBOW_MIDPOINTS.map((elbowMid) => ({ kind: 'elbow', bend: 0, elbowMid }))]
	for (let pass = 0; pass < 2; pass++) {
		for (const a of free(arrows)) {
			const obstacles = obstaclesFor(a, boxes)
			const others = arrows.filter((o) => o.id !== a.id && ![...a.ends].some((e) => o.ends.has(e)))
			let best = null
			for (const c of candidates) {
				scene.setArrow(a.id, c)
				const path = scene.arrowPath(a.id)
				const thru = obstacles.filter((o) => through(path, o.b)).length
				const crossed = others.reduce((n, o) => n + crossings(path, paths.get(o.id)), 0)
				const score = 10000 * thru + 100 * crossed + 0.02 * length(path) + 0.03 * Math.abs(c.bend) + (c.kind === 'elbow' ? 15 : 0)
				if (!best || score < best.score) best = { ...c, score, path }
			}
			scene.setArrow(a.id, { kind: best.kind, bend: best.bend, elbowMid: best.elbowMid })
			paths.set(a.id, best.path)
		}
	}
	let after = measure()
	if (after.throughBoxes > before.throughBoxes) {
		for (const a of arrows) scene.restoreArrow(a.id, originals.get(a.id))
		after = measure()
		return { before, after, changed: 0 }
	}
	return { before, after, changed: arrows.filter((a) => routeOf(a.id) !== was.get(a.id)).length }
}

const { before, after, changed } = scene.batch(tidy)
const limit = changed && scene.limits.anchors
return { summary: `${before.throughBoxes} → ${after.throughBoxes} through boxes, ${before.crossings} → ${after.crossings} crossings.${limit ? ` ${limit}` : ''}`, before, after, changed }
