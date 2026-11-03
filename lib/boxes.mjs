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
