// An animated build of a diagram, as a GIF: the boxes appear one at a time in the order the arrows take you through them, each
// with the arrows that join it to what's already there, the way someone would draw it for you on a whiteboard. Used by
// `toucan animate` and the canvas menu, on both engines; each engine supplies how to draw a set of its shapes (helpers.js,
// excalidraw-helpers.js), and this file decides the order and makes the GIF. Nothing on the canvas changes.

import { GIFEncoder, applyPalette, quantize } from 'gifenc'

/**
 * The steps a diagram builds in, read from the scene (app/scene.js): each step a list of ids that appear together. A step is one
 * box, any frame it sits in that hasn't appeared yet (first), and the arrows that join it to boxes already shown. Boxes are
 * reached by following solid arrows from where the diagram starts (boxes nothing points to, in reading order), a branch at a
 * time; whatever no arrow reaches comes after, in reading order. Dotted arrows and proposals don't lead anywhere, as when walking
 * the diagram with ← and →, but they still appear once both their ends have.
 */
export function buildOrder(scene) {
	const items = scene.items()
	const byId = new Map(items.map((i) => [i.id, i]))
	const arrows = scene.arrows()
	const arrowIds = new Set(arrows.map((a) => a.id))
	const boxes = items.filter((i) => i.kind !== 'frame' && !arrowIds.has(i.id))
	const isBox = new Set(boxes.map((b) => b.id))
	const reading = (a, b) => (Math.abs(a.y - b.y) < 40 ? a.x - b.x : a.y - b.y)
	const leads = (a) => a.from && a.to && isBox.has(a.from) && isBox.has(a.to) && byId.get(a.id)?.dash !== 'dotted' && !byId.get(a.id)?.meta?.proposed
	const out = new Map(), into = new Map()
	for (const a of arrows.filter(leads)) {
		;(out.get(a.from) ?? out.set(a.from, []).get(a.from)).push(a.to)
		into.set(a.to, (into.get(a.to) ?? 0) + 1)
	}
	const shown = new Set(), steps = [], arrowShown = new Set()
	const reveal = (box) => {
		const step = []
		for (const id of scene.ancestors(box.id).filter((id) => byId.get(id)?.kind === 'frame' && !shown.has(id)).reverse()) shown.add(id), step.push(id)
		shown.add(box.id)
		step.push(box.id)
		for (const a of arrows) {
			if (arrowShown.has(a.id)) continue
			const ends = [a.from, a.to].filter(Boolean)
			if (ends.includes(box.id) && ends.every((id) => shown.has(id) || !isBox.has(id))) arrowShown.add(a.id), shown.add(a.id), step.push(a.id)
		}
		steps.push(step)
	}
	const queue = boxes.filter((b) => !into.get(b.id)).sort(reading)
	const rest = [...boxes].sort(reading)
	while (shown.size < items.length) {
		let next = queue.shift()
		if (!next) next = rest.find((b) => !shown.has(b.id))
		if (!next) break
		if (shown.has(next.id)) continue
		reveal(next)
		for (const to of (out.get(next.id) ?? []).map((id) => byId.get(id)).sort(reading)) if (!shown.has(to.id) && !queue.includes(to)) queue.push(to)
	}
	// Anything left (an empty frame, an arrow loose at one end) arrives with the last step.
	const left = items.filter((i) => !shown.has(i.id)).map((i) => i.id)
	if (left.length) steps.length ? steps.at(-1).push(...left) : steps.push(left)
	return steps
}

/**
 * The GIF: `render(ids)` draws the shapes with those ids and resolves to an image (anything drawImage takes) of `size`, the
 * same for every frame. One frame per step, `step` ms apart, and the whole diagram held for `hold` ms at the end. Base64.
 */
export async function makeGif(steps, render, { width, height, step = 700, hold = 2500, background = '#ffffff' }) {
	const canvas = document.createElement('canvas')
	canvas.width = width
	canvas.height = height
	const ctx = canvas.getContext('2d', { willReadFrequently: true })
	const frames = []
	const visible = []
	for (const ids of steps) {
		visible.push(...ids)
		ctx.fillStyle = background
		ctx.fillRect(0, 0, width, height)
		await render(visible, ctx)
		frames.push(ctx.getImageData(0, 0, width, height).data)
	}
	// One palette for every frame, from the finished diagram, which has every colour any frame has.
	const palette = quantize(frames.at(-1), 256)
	const gif = GIFEncoder()
	frames.forEach((rgba, i) => gif.writeFrame(applyPalette(rgba, palette), width, height, { palette: i === 0 ? palette : undefined, delay: i === frames.length - 1 ? hold : step, repeat: 0 }))
	gif.finish()
	const bytes = gif.bytes()
	let s = ''
	for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
	return { gif: btoa(s), frames: frames.length, width, height }
}
