// Routing an arrow round the boxes in its way. One routine, used wherever arrows are drawn: the layouts (`draw`, templates), an
// import onto a blank canvas, and the tidying routines in a tab. It tries the routes an engine can draw (an elbow out of any side, its
// middle run anywhere across the gap, or a gentle curve), asks how each one is actually drawn, and keeps the one that clears the most.
//
// An elbow can't be told to run anywhere: tldraw routes it round its own two ends, a little out from the union of their boxes, with
// the middle run free only where the two boxes have a gap between them. So the way round a box is often a different pair of sides: a
// loop back up a column whose middle sticks out on the right goes up the left, which is clear. The choosing is engine-neutral; what
// it needs from an engine is the path a route is drawn along (`tryRoute`), which in a tab is the engine's own drawing, and outside
// one is `routePath` below: Excalidraw's elbows as app/scene.js draws them, and tldraw's closely enough to start from.

export const SIDES = { top: { x: 0.5, y: 0 }, right: { x: 1, y: 0.5 }, bottom: { x: 0.5, y: 1 }, left: { x: 0, y: 0.5 } }
const SIDE_LIST = Object.values(SIDES)
export const GAP = 6 // how far an arrow stops short of what it's bound to
export const STUB = 20 // how far an elbow runs out of a side before it turns

// ---- drawing a route between two boxes (Excalidraw draws exactly this; app/scene.js uses it) -------------------------------------
const centre = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
/** Where a line from a box's centre toward `to` leaves its outline, `gap` further on. `b.geo` is ellipse, diamond or anything else. */
export function outline(b, to, gap = GAP) {
	const c = centre(b)
	const dx = to.x - c.x, dy = to.y - c.y
	if (!dx && !dy) return c
	const rx = b.w / 2, ry = b.h / 2
	const t = b.geo === 'ellipse' ? 1 / Math.hypot(dx / rx, dy / ry) : b.geo === 'diamond' ? 1 / (Math.abs(dx) / rx + Math.abs(dy) / ry) : Math.min(dx ? rx / Math.abs(dx) : Infinity, dy ? ry / Math.abs(dy) : Infinity)
	const len = Math.hypot(dx, dy)
	return { x: c.x + dx * t + (dx / len) * gap, y: c.y + dy * t + (dy / len) * gap }
}
export const onEdge = (at) => !!at && (at.x < 0.01 || at.x > 0.99 || at.y < 0.01 || at.y > 0.99)
export const normal = (at) => (at.x < 0.01 ? { x: -1, y: 0 } : at.x > 0.99 ? { x: 1, y: 0 } : at.y < 0.01 ? { x: 0, y: -1 } : { x: 0, y: 1 })
/** Where an arrow's end sits on a box: at the anchor if it's on an edge, else where a line toward `toward` leaves it. */
export function endAt(b, at, toward) {
	if (!onEdge(at)) return outline(b, toward)
	const n = normal(at)
	return { x: b.x + b.w * at.x + n.x * GAP, y: b.y + b.h * at.y + n.y * GAP }
}
export const anchorPoint = (b, at) => (onEdge(at) ? { x: b.x + b.w * at.x, y: b.y + b.h * at.y } : centre(b))

/** An orthogonal route from p0 (leaving along n0) to p1 (arriving along -n1), turning at `mid` of the way across. */
export function elbowPath(p0, n0, p1, n1, mid = 0.5) {
	const a = { x: p0.x + n0.x * STUB, y: p0.y + n0.y * STUB }, b = { x: p1.x + n1.x * STUB, y: p1.y + n1.y * STUB }
	const across = (u, v, along) => (along === 'x' ? u.x + (v.x - u.x) * mid : u.y + (v.y - u.y) * mid)
	const h0 = n0.y === 0, h1 = n1.y === 0
	let pts
	if (h0 && h1) {
		const mx = across(p0, p1, 'x')
		if ((mx - p0.x) * n0.x >= STUB && (mx - p1.x) * n1.x >= STUB) pts = [p0, { x: mx, y: p0.y }, { x: mx, y: p1.y }, p1]
		// Both out of the same side (a loop): one run beyond whichever end sticks out further, as tldraw draws it.
		else if (n0.x === n1.x) {
			const x = n0.x > 0 ? Math.max(a.x, b.x) : Math.min(a.x, b.x)
			pts = [p0, { x, y: p0.y }, { x, y: p1.y }, p1]
		} else pts = [p0, a, { x: a.x, y: across(a, b, 'y') }, { x: b.x, y: across(a, b, 'y') }, b, p1]
	} else if (!h0 && !h1) {
		const my = across(p0, p1, 'y')
		if ((my - p0.y) * n0.y >= STUB && (my - p1.y) * n1.y >= STUB) pts = [p0, { x: p0.x, y: my }, { x: p1.x, y: my }, p1]
		else if (n0.y === n1.y) {
			const y = n0.y > 0 ? Math.max(a.y, b.y) : Math.min(a.y, b.y)
			pts = [p0, { x: p0.x, y }, { x: p1.x, y }, p1]
		} else pts = [p0, a, { x: across(a, b, 'x'), y: a.y }, { x: across(a, b, 'x'), y: b.y }, b, p1]
	} else if (h0) {
		const corner = { x: p1.x, y: p0.y }
		pts = (corner.x - p0.x) * n0.x > 0 && (corner.y - p1.y) * n1.y > 0 ? [p0, corner, p1] : [p0, a, { x: a.x, y: b.y }, b, p1]
	} else {
		const corner = { x: p0.x, y: p1.y }
		pts = (corner.y - p0.y) * n0.y > 0 && (corner.x - p1.x) * n1.x > 0 ? [p0, corner, p1] : [p0, a, { x: b.x, y: a.y }, b, p1]
	}
	// Drop repeated points and points in the middle of a straight run.
	const out = []
	for (const p of pts) {
		if (out.length && Math.abs(out.at(-1).x - p.x) < 0.5 && Math.abs(out.at(-1).y - p.y) < 0.5) continue
		const q = out.at(-1), r = out.at(-2)
		if (r && ((Math.abs(r.x - q.x) < 0.5 && Math.abs(q.x - p.x) < 0.5) || (Math.abs(r.y - q.y) < 0.5 && Math.abs(q.y - p.y) < 0.5))) out.pop()
		out.push(p)
	}
	return out
}

/** The sides an elbow joins when it wasn't told: facing each other, as tldraw picks them. */
export function facing(ba, bb) {
	const overlapX = ba.x < bb.x + bb.w && bb.x < ba.x + ba.w, overlapY = ba.y < bb.y + bb.h && bb.y < ba.y + ba.h
	const dx = bb.x + bb.w / 2 - (ba.x + ba.w / 2), dy = bb.y + bb.h / 2 - (ba.y + ba.h / 2)
	const vertical = overlapX || (!overlapY && Math.abs(dy) > Math.abs(dx))
	return vertical ? { from: dy > 0 ? SIDES.bottom : SIDES.top, to: dy > 0 ? SIDES.top : SIDES.bottom } : { from: dx > 0 ? SIDES.right : SIDES.left, to: dx > 0 ? SIDES.left : SIDES.right }
}

/**
 * The points an arrow runs through from box `a` to box `b` ({x, y, w, h, geo}), for a route { kind: 'elbow' | 'arc', anchors: { from,
 * to }, elbowMid, bend, free }. An elbow's sides are its anchors where they're on an edge, else the sides that face each other; a
 * straight or curved arrow aims at its anchors, or at the middle. A curve is its three defining points (start, middle, end).
 */
export function routePath(a, b, route) {
	const anchors = route.anchors ?? {}
	if (route.kind === 'elbow') {
		const sides = facing(a, b)
		const at0 = onEdge(anchors.from) ? anchors.from : sides.from, at1 = onEdge(anchors.to) ? anchors.to : sides.to
		return { points: elbowPath(endAt(a, at0), normal(at0), endAt(b, at1), normal(at1), route.elbowMid ?? 0.5), at: [at0, at1] }
	}
	if (route.free?.length) {
		const inner = route.free
		return { points: [endAt(a, anchors.from, inner[0]), ...inner, endAt(b, anchors.to, inner.at(-1))] }
	}
	const aim0 = anchorPoint(a, anchors.from), aim1 = anchorPoint(b, anchors.to)
	if (!route.bend) return { points: [endAt(a, anchors.from, aim1), endAt(b, anchors.to, aim0)] }
	// The bend is how far the curve's middle stands off the straight line, as tldraw measures it.
	const control = (u, v) => {
		const dx = v.x - u.x, dy = v.y - u.y, len = Math.hypot(dx, dy) || 1
		return { x: (u.x + v.x) / 2 - (dy / len) * route.bend, y: (u.y + v.y) / 2 + (dx / len) * route.bend }
	}
	const c = control(aim0, aim1)
	const p0 = endAt(a, anchors.from, c), p1 = endAt(b, anchors.to, c)
	return { points: [p0, control(p0, p1), p1], curve: true }
}

/** A curve through three points sampled as a polyline: the arc tldraw draws, near enough to see what it runs through. */
export function sampleCurve([p0, m, p1], n = 16) {
	// The circle through the three points; if they're in line, it's straight.
	const ax = p0.x, ay = p0.y, bx = m.x, by = m.y, cx = p1.x, cy = p1.y
	const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
	if (Math.abs(d) < 1e-6) return [p0, p1]
	const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d
	const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d
	const r = Math.hypot(ax - ux, ay - uy)
	const ang = (p) => Math.atan2(p.y - uy, p.x - ux)
	const a0 = ang(p0), a1 = ang(p1), am = ang(m)
	// Go from a0 to a1 the way that passes am.
	const norm = (t) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
	let sweep = norm(a1 - a0)
	if (norm(am - a0) > sweep) sweep -= 2 * Math.PI
	return Array.from({ length: n + 1 }, (_, i) => ({ x: ux + r * Math.cos(a0 + (sweep * i) / n), y: uy + r * Math.sin(a0 + (sweep * i) / n) }))
}

// ---- judging a path ---------------------------------------------------------------------------------------------------------------
export const segmentsCross = (p, q, r, s) => {
	const o = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
	return o(p, q, r) * o(p, q, s) < 0 && o(r, s, p) * o(r, s, q) < 0
}
/** Does a polyline run through a box ({x, y, w, h}), shrunk by `pad` so grazing an edge doesn't count? As toucan.measure() judges it. */
export function runsThrough(path, b, pad = 6) {
	const x0 = b.x + pad, x1 = b.x + b.w - pad, y0 = b.y + pad, y1 = b.y + b.h - pad
	if (x1 <= x0 || y1 <= y0) return false
	const c = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]
	for (let i = 1; i < path.length; i++) {
		const p = path[i]
		if (p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1) return true
		for (let k = 0; k < 4; k++) if (segmentsCross(path[i - 1], p, c[k], c[(k + 1) % 4])) return true
	}
	return false
}
export function crossingsBetween(p, q) {
	let n = 0
	for (let i = 1; i < p.length; i++) for (let j = 1; j < q.length; j++) if (segmentsCross(p[i - 1], p[i], q[j - 1], q[j])) n++
	return n
}
/** How far two paths run alongside each other, closer than `near`: two arrows on one line read as one. */
function alongside(p, q, near = 12) {
	let run = 0
	for (let i = 1; i < p.length; i++) {
		const a = p[i - 1], b = p[i]
		const vertical = Math.abs(a.x - b.x) < 0.5, horizontal = Math.abs(a.y - b.y) < 0.5
		if (!vertical && !horizontal) continue
		for (let j = 1; j < q.length; j++) {
			const c = q[j - 1], d = q[j]
			if (vertical && Math.abs(c.x - d.x) < 0.5 && Math.abs(a.x - c.x) < near) run += Math.max(0, Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)))
			if (horizontal && Math.abs(c.y - d.y) < 0.5 && Math.abs(a.y - c.y) < near) run += Math.max(0, Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)))
		}
	}
	return run
}
const lengthOf = (p) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q.x - p[i].x, q.y - p[i].y), 0)

// ---- choosing ----------------------------------------------------------------------------------------------------------------------
const BENDS = [40, -40, 80, -80, 140, -140, 220, -220]
export const MIDS = [0.5, 0.15, 0.85, 0.3, 0.7, 0.05, 0.95]
/** The routes worth trying for an arrow: elbows out of every pair of sides with the middle run at several places, and gentle curves. */
export function routeCandidates() {
	const out = []
	for (const elbowMid of MIDS) for (const from of SIDE_LIST) for (const to of SIDE_LIST) out.push({ kind: 'elbow', bend: 0, elbowMid, anchors: { from, to } })
	for (const bend of BENDS) out.push({ kind: 'arc', bend, elbowMid: 0.5, anchors: { from: null, to: null } })
	return out
}
const sameAt = (p, q) => (!p && !q) || (p && q && Math.abs(p.x - q.x) < 0.01 && Math.abs(p.y - q.y) < 0.01)

/**
 * The best way round for one arrow, or null if nothing clears more boxes than it does now. `current` is how it runs now ({ kind, bend,
 * elbowMid, anchors }); `tryRoute(route)` returns the path the engine draws for a route (and may leave the arrow drawn that way);
 * `currentPath` is the path it's drawn along now, if known; `obstacles` are boxes it mustn't run through (not its own ends); `others`
 * are other arrows' paths not to cross (those that share an end with it meet it there, so they don't count), and `beside` those not
 * to run along (by default the same: an arrow back up the line others come down by reads as one of them).
 * A diagram drawn in elbows keeps to elbows where one clears; otherwise the least change that clears wins: the sides it had, the
 * middle of the gap, the shortest way. Boxes it runs through count far more than anything else, then arrows it crosses.
 * `extra(route, path)` adds a cost of the caller's (where its label would go, say); with `better: true` the best route is taken
 * whenever it costs less than the current one, not only when it runs through fewer boxes. `candidates` are the routes to try
 * (routeCandidates() unless given).
 */
export function chooseRoute({ current, currentPath, tryRoute, obstacles, others = [], beside = others, extra, better = false, candidates = routeCandidates() }) {
	const judge = (route, path) => {
		const blocked = obstacles.filter((b) => runsThrough(path, b)).length
		const crossed = others.reduce((n, o) => n + crossingsBetween(path, o), 0)
		const along = beside.reduce((n, o) => n + alongside(path, o), 0)
		// A long way round reads worse than sharing a line with another arrow for a stretch, and every turn is one more thing to follow.
		let cost = 10000 * blocked + 100 * crossed + 0.25 * along + 0.2 * lengthOf(path) + 20 * (route.kind === 'elbow' ? Math.max(0, path.length - 2) : 1)
		// In a diagram of elbows a curve is the last resort; among straight arrows a gentle curve is the lesser change.
		if (route.kind !== (current.kind === 'elbow' ? 'elbow' : 'arc')) cost += current.kind === 'elbow' ? 120 : 20
		if (route.kind === 'elbow') {
			if (current.kind === 'elbow' && current.anchors) cost += (sameAt(route.anchors.from, current.anchors.from) ? 0 : 15) + (sameAt(route.anchors.to, current.anchors.to) ? 0 : 15)
			cost += Math.abs((route.elbowMid ?? 0.5) - 0.5) * 20
		} else cost += 0.05 * Math.abs(route.bend)
		if (extra) cost += extra(route, path)
		return { route, path, blocked, crossed, cost }
	}
	const now = judge({ ...current, kind: current.kind === 'elbow' ? 'elbow' : 'arc' }, currentPath ?? tryRoute(current))
	if (!better && !now.blocked) return null
	let best = null
	for (const route of candidates) {
		// A curve isn't a fix for a label: it's for getting round a box.
		if (better && route.kind !== (current.kind === 'elbow' ? 'elbow' : 'arc')) continue
		const path = tryRoute(route)
		if (!path) continue
		const j = judge(route, path)
		if (!best || j.cost < best.cost) best = j
	}
	if (!best) return null
	return better ? (best.blocked <= now.blocked && best.cost < now.cost - 1 ? best : null) : best.blocked < now.blocked ? best : null
}

/**
 * Routes a laid-out graph's arrows round the boxes in their way, before it's drawn: each arrow that would run through a box takes the
 * best route `chooseRoute` finds, as `routePath` draws it. Changes the edges' styles in place (route, anchors, elbowMid, bend) and returns
 * how many it changed. Frames aren't in the way; dots and lifelines (under 30px) aren't either.
 */
export function routeGraph(tg) {
	const boxes = new Map(tg.nodes.filter((n) => n.box).map((n) => [n.key, { ...n.box, geo: n.style?.geo }]))
	const solid = tg.nodes.filter((n) => n.box && n.box.w >= 30 && n.box.h >= 30 && n.style?.geo !== 'text' && n.style?.geo !== 'note')
	const routeOf = (e) => ({ kind: e.style?.route === 'elbow' ? 'elbow' : 'arc', bend: e.style?.route === 'curve' || e.style?.bend ? e.style?.bend ?? 0 : 0, elbowMid: e.style?.elbowMid ?? 0.5, anchors: e.style?.anchors ?? { from: null, to: null } })
	const pathOf = (e, route) => {
		const a = boxes.get(e.from), b = boxes.get(e.to)
		if (!a || !b) return null
		const r = routePath(a, b, route)
		return r.curve ? sampleCurve(r.points) : r.points
	}
	const edges = tg.edges.filter((e) => boxes.has(e.from) && boxes.has(e.to) && e.from !== e.to && boxes.get(e.from).w >= 30 && boxes.get(e.to).w >= 30 && boxes.get(e.from).geo !== 'cloud' && boxes.get(e.to).geo !== 'cloud')
	const paths = new Map(edges.map((e) => [e, pathOf(e, routeOf(e))]))
	let changed = 0
	for (const e of edges) {
		const shares = (o) => o.from === e.from || o.from === e.to || o.to === e.from || o.to === e.to
		const best = chooseRoute({
			current: routeOf(e),
			tryRoute: (route) => pathOf(e, route),
			obstacles: solid.filter((n) => n.key !== e.from && n.key !== e.to).map((n) => n.box),
			others: edges.filter((o) => o !== e && !shares(o)).map((o) => paths.get(o)),
		})
		if (!best) continue
		const { kind, bend, elbowMid, anchors } = best.route
		const { bend: _b, elbowMid: _m, anchors: _a, ...rest } = e.style ?? {}
		e.style = kind === 'elbow' ? { ...rest, route: 'elbow', anchors, ...(elbowMid !== 0.5 && { elbowMid }) } : { ...rest, route: 'curve', bend }
		paths.set(e, best.path)
		changed++
	}
	return changed
}

// ---- labels -------------------------------------------------------------------------------------------------------------------------
const segDist = (p, a, b) => {
	const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy
	const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0
	return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}
/**
 * Does another arrow's path run through a label's box ({x, y, w, h}) somewhere its own arrow (`own`) doesn't? Two arrows sharing a run
 * read as one line, so running along the label's own arrow doesn't count. As toucan.measure() judges it.
 */
export function straysThrough(other, own, box) {
	const near = (pt) => own.some((q, k) => k > 0 && segDist(pt, own[k - 1], q) < 2.5)
	for (let k = 1; k < other.length; k++) {
		const p0 = other[k - 1], p1 = other[k], n = Math.max(2, Math.ceil(Math.hypot(p1.x - p0.x, p1.y - p0.y) / 4))
		for (let t = 0; t <= n; t++) {
			const pt = { x: p0.x + ((p1.x - p0.x) * t) / n, y: p0.y + ((p1.y - p0.y) * t) / n }
			if (pt.x > box.x + 2 && pt.x < box.x + box.w - 2 && pt.y > box.y + 2 && pt.y < box.y + box.h - 2 && !near(pt)) return true
		}
	}
	return false
}
const LABEL_AT = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9, 0.05, 0.95]
/**
 * Where along its arrow a label reads clear: not crossed by another arrow, not on a box or another label. `tryAt(t)` puts the label at
 * `t` (0..1 along the arrow) and returns its box; `own` is the arrow's path, `others` other arrows' paths, `boxes` and `labels` what it
 * mustn't sit on. Returns { t, trouble } for the best place: `trouble` counts what's still wrong there (0 is clear).
 */
export function chooseLabelAt({ tryAt, own, others = [], boxes = [], labels = [] }) {
	const hit = (a, b, pad = 2) => a.x < b.x + b.w - pad && b.x < a.x + a.w - pad && a.y < b.y + b.h - pad && b.y < a.y + a.h - pad
	const trouble = (box) => others.filter((o) => straysThrough(o, own, box)).length + boxes.filter((b) => hit(box, b)).length + labels.filter((l) => hit(box, l)).length
	let best = null
	for (const t of LABEL_AT) {
		const box = tryAt(t)
		if (!box) continue
		const n = trouble(box)
		if (!best || n < best.n) best = { t, n }
		if (!n) break
	}
	return best ? { t: best.t, trouble: best.n } : { t: 0.5, trouble: 0 }
}
