// How big a box must be for its text, and which sides an arrow should leave and enter by. Shared by the layouts and by import,
// so a diagram looks the same however it arrived.

const GRID = 10
export const snap = (n) => Math.round(n / GRID) * GRID

// Measured against tldraw's rendering at size s, with room to spare: a box that outgrows its estimate pushes into its neighbours.
const CHAR_W = 10.5, LINE_H = 26, PAD_X = 44, PAD_Y = 40
export function textHeight(text, w) {
	const perLine = Math.max(6, Math.floor((w - PAD_X) / CHAR_W))
	const lines = String(text).split('\n').reduce((n, line) => n + Math.max(1, wrapCount(line, perLine)), 0)
	return lines * LINE_H + PAD_Y
}
function wrapCount(line, perLine) {
	let n = 1, at = 0
	for (const word of line.split(/\s+/)) {
		const len = word.length
		if (at && at + 1 + len > perLine) (n++, (at = len))
		else at += (at ? 1 : 0) + len
		while (at > perLine) (n++, (at -= perLine))
	}
	return n
}
export const boxFor = (text, w = 200, min = 64) => ({ w, h: Math.max(min, snap(textHeight(text, w) + 5)) })
// A diamond or an ellipse has far less room for text than its bounding box suggests.
export const SHAPE_ROOM = { diamond: 1.75, ellipse: 1.35, oval: 1.2, hexagon: 1.25, cloud: 1.5 }
export function sizedNode(n, w = 200) {
	const room = SHAPE_ROOM[n.shape] ?? 1
	const wide = snap((n.w ?? w) * Math.sqrt(room))
	const { h } = boxFor(n.text, Math.round((n.w ?? w) * (n.shape && room > 1 ? 0.95 : 1)))
	return { w: wide, h: snap(n.h ?? h * Math.sqrt(room)) }
}

export const SIDES = { top: { x: 0.5, y: 0 }, bottom: { x: 0.5, y: 1 }, left: { x: 0, y: 0.5 }, right: { x: 1, y: 0.5 } }
/** The sides an arrow between two boxes should use. Shared with the Neat arrows routine. */
export function sidesFor(a, b, mode = 'auto') {
	const overlapX = a.x < b.x + b.w && b.x < a.x + a.w, overlapY = a.y < b.y + b.h && b.y < a.y + a.h
	const dx = b.x + b.w / 2 - (a.x + a.w / 2), dy = b.y + b.h / 2 - (a.y + a.h / 2)
	const vertical = mode === 'vertical' ? dy !== 0 : mode === 'horizontal' ? dx === 0 : overlapX || (!overlapY && Math.abs(dy) > Math.abs(dx))
	return vertical ? { from: dy > 0 ? SIDES.bottom : SIDES.top, to: dy > 0 ? SIDES.top : SIDES.bottom } : { from: dx > 0 ? SIDES.right : SIDES.left, to: dx > 0 ? SIDES.left : SIDES.right }
}

/**
 * Sides for every arrow of a diagram that flows one way (DOWN or RIGHT; left out, the way most arrows go). Like sidesFor, plus
 * two things a single arrow can't know: a labelled fork (yes / no) sends a branch that goes off to one side out of that side, so its label sits on
 * its own line rather than on a trunk the branches share; and an arrow back against the flow (a loop) goes out of the far side
 * and round, rather than straight back through whatever is between. `arrows` are [{ from, to }] with boxes from `boxOf(key)`;
 * returns one { from, to } (or null where a box is missing) per arrow, in order. Used by import, and by Neat arrows with
 * `loops: false`: on a diagram a person arranged, sending an arrow round the outside can cross what they put there. With `along`, an
 * arrow ahead in the flow leaves and arrives along it, as on a layered chart, however far it goes across.
 */
export function flowSides(arrows, boxOf, direction, { loops = true, along = false } = {}) {
	const pairs = arrows.map((e) => [boxOf(e.from), boxOf(e.to)])
	if (!direction) {
		let across = 0, along = 0
		for (const [a, b] of pairs) if (a && b) Math.abs(b.y + b.h / 2 - a.y - a.h / 2) > Math.abs(b.x + b.w / 2 - a.x - a.w / 2) ? along++ : across++
		direction = along >= across ? 'DOWN' : 'RIGHT'
	}
	const down = direction === 'DOWN' || direction === 'UP'
	const mid = (b) => (down ? b.x + b.w / 2 : b.y + b.h / 2)
	const ahead = (a, b) => (down ? b.y >= a.y + a.h : b.x >= a.x + a.w)
	const behind = (a, b) => (down ? b.y + b.h <= a.y : b.x + b.w <= a.x)
	// Only a fork whose branches are labelled (yes / no) needs them apart: unlabelled ones read fine down a shared trunk, and so does
	// a fork with one labelled branch among others, which isn't a choice between them.
	const forks = new Map(), labelled = new Map()
	arrows.forEach((e, i) => {
		const [a, b] = pairs[i]
		if (!a || !b || !ahead(a, b)) return
		forks.set(e.from, (forks.get(e.from) ?? 0) + 1)
		if (String(e.label ?? e.text ?? '').trim()) labelled.set(e.from, (labelled.get(e.from) ?? 0) + 1)
	})
	return arrows.map((e, i) => {
		const [a, b] = pairs[i]
		if (!a || !b) return null
		if (loops && behind(a, b)) return down ? { from: SIDES.right, to: SIDES.right } : { from: SIDES.bottom, to: SIDES.bottom }
		if (ahead(a, b) && forks.get(e.from) > 1 && labelled.get(e.from) > 1) {
			const off = mid(b) - mid(a), reach = (down ? a.w : a.h) / 4
			if (off < -reach) return { from: down ? SIDES.left : SIDES.top, to: down ? SIDES.top : SIDES.left }
			if (off > reach) return { from: down ? SIDES.right : SIDES.bottom, to: down ? SIDES.top : SIDES.left }
		}
		// `along`: on a layered chart, an arrow to a later layer leaves and arrives along the flow even when it goes well across.
		if (along && ahead(a, b)) return sidesFor(a, b, down ? 'vertical' : 'horizontal')
		return sidesFor(a, b)
	})
}
