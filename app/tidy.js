// The geometry behind the tidying routines (routines/*.js call these as toucan.tidy.*). Each works on what a person can see, keeps
// frames and connections as they are, never touches a sticky note, and leaves a tidy diagram alone, so it's safe to run twice.

import { renderPlaintextFromRichText } from 'tldraw'
import { LAYOUTS, sidesFor } from '../lib/layouts.mjs'

export function makeTidy(editor, keyOf) {
	const GRID = 10
	const snap = (n) => Math.round(n / GRID) * GRID
	const isMarker = (b) => b.w < 30 || b.h < 30 // dots and lifelines belong to a layout, and aren't boxes to rearrange
	const pageShapes = () => editor.getCurrentPageShapes()
	const movable = () => pageShapes().filter((s) => s.type === 'geo' && !isMarker(s.props.w !== undefined ? { w: s.props.w, h: s.props.h + (s.props.growY ?? 0) } : { w: 99, h: 99 }))
	const local = (s) => ({ x: s.x, y: s.y, w: s.props.w, h: s.props.h + (s.props.growY ?? 0) })
	/** The boxes that sit together: those with the same parent. Only they can be meaningfully lined up. */
	const groups = () => {
		const out = new Map()
		for (const s of movable()) (out.get(s.parentId) ?? out.set(s.parentId, []).get(s.parentId)).push(s)
		return [...out.values()]
	}
	const median = (list) => {
		const sorted = [...list].sort((a, b) => a - b)
		return sorted[Math.floor(sorted.length / 2)]
	}
	/** Runs of items whose value is within `tol` of the run's start. */
	const clusters = (items, value, tol) => {
		const sorted = [...items].sort((a, b) => value(a) - value(b))
		const runs = []
		for (const it of sorted) {
			const run = runs.at(-1)
			if (run && value(it) - value(run[0]) <= tol) run.push(it)
			else runs.push([it])
		}
		return runs
	}
	const apply = (updates) => {
		if (updates.length) editor.updateShapes(updates)
		return updates.length
	}
	const moved = (s, x, y) => Math.abs(s.x - x) > 0.5 || Math.abs(s.y - y) > 0.5

	/** Boxes nearly in line are put in line: rows by their centres, then columns. */
	function align({ tolerance = 40 } = {}) {
		const at = new Map()
		const pos = (s) => at.get(s.id) ?? { x: s.x, y: s.y }
		// Lining up one row can bring another within reach, so it runs until nothing moves: a second click changes nothing.
		for (let pass = 0, moving = true; moving && pass < 8; pass++) {
			moving = false
			const set = (s, next) => {
				const was = pos(s)
				if (Math.abs(was.x - next.x) > 0.5 || Math.abs(was.y - next.y) > 0.5) moving = true
				at.set(s.id, next)
			}
			for (const group of groups()) {
				for (const row of clusters(group, (s) => pos(s).y + local(s).h / 2, tolerance)) {
					if (row.length < 2) continue
					const line = snap(median(row.map((s) => pos(s).y + local(s).h / 2)))
					for (const s of row) set(s, { ...pos(s), y: line - local(s).h / 2 })
				}
				for (const col of clusters(group, (s) => pos(s).x + local(s).w / 2, tolerance)) {
					if (col.length < 2) continue
					const line = snap(median(col.map((s) => pos(s).x + local(s).w / 2)))
					for (const s of col) set(s, { ...pos(s), x: line - local(s).w / 2 })
				}
			}
		}
		return apply(movable().flatMap((s) => {
			const p = at.get(s.id)
			return p && moved(s, p.x, p.y) ? [{ id: s.id, type: s.type, x: p.x, y: p.y }] : []
		}))
	}

	/** Within a row or a column, the gaps become equal. A row with a deliberate hole in it is left alone. */
	function distribute({ tolerance = 20 } = {}) {
		const updates = new Map()
		const even = (line, along, size, set) => {
			if (line.length < 3) return
			const sorted = [...line].sort((a, b) => along(a) - along(b))
			const gaps = sorted.slice(1).map((s, i) => along(s) - (along(sorted[i]) + size(sorted[i])))
			if (gaps.some((g) => g < 0) || Math.max(...gaps) > median(gaps) * 2 + 20) return // an overlap, or a hole that means something
			const gap = gaps.reduce((a, b) => a + b, 0) / gaps.length
			let at = along(sorted[0])
			for (const s of sorted) {
				if (Math.abs(along(s) - at) > 0.5) updates.set(s.id, { ...updates.get(s.id), id: s.id, type: s.type, ...set(at) })
				at += size(s) + gap
			}
		}
		for (const group of groups()) {
			for (const row of clusters(group, (s) => s.y + local(s).h / 2, tolerance)) even(row, (s) => s.x, (s) => local(s).w, (x) => ({ x }))
			for (const col of clusters(group, (s) => s.x + local(s).w / 2, tolerance)) even(col, (s) => s.y, (s) => local(s).h, (y) => ({ y }))
		}
		return apply([...updates.values()])
	}

	/** Rectangles in a row become one height, and those in a column one width. Only ever larger, so no text is squeezed. */
	function matchSizes({ tolerance = 40 } = {}) {
		const size = new Map()
		const cur = (s) => size.get(s.id) ?? { w: s.props.w, h: local(s).h }
		// Rows and columns are judged by centres, which don't move here, so one pass is enough; a tallest stays tallest.
		for (const group of groups()) {
			const rects = group.filter((s) => s.props.geo === 'rectangle')
			for (const row of clusters(rects, (s) => s.y + local(s).h / 2, tolerance)) {
				if (row.length < 2) continue
				const h = Math.max(...row.map((s) => cur(s).h))
				for (const s of row) size.set(s.id, { ...cur(s), h })
			}
			for (const col of clusters(rects, (s) => s.x + s.props.w / 2, tolerance)) {
				if (col.length < 2) continue
				const w = Math.max(...col.map((s) => cur(s).w))
				for (const s of col) size.set(s.id, { ...cur(s), w })
			}
		}
		return apply(movable().flatMap((s) => {
			const z = size.get(s.id)
			if (!z || (Math.abs(z.w - s.props.w) < 1 && Math.abs(z.h - local(s).h) < 1)) return []
			// Keep it centred where it was, so neighbours in line stay in line.
			return [{ id: s.id, type: s.type, x: s.x - (z.w - s.props.w) / 2, y: s.y - (z.h - local(s).h) / 2, props: { w: z.w, h: z.h, growY: 0 } }]
		}))
	}

	/** Overlapping boxes are moved apart by the least distance that clears them, along whichever axis needs less. */
	function fixOverlaps({ gap = 24, rounds = 400, framesOnly = false } = {}) {
		let changed = 0
		const frames = pageShapes().filter((s) => s.type === 'frame' && !s.parentId.startsWith('shape:'))
		for (const group of framesOnly ? [frames] : [...groups(), frames]) {
			const at = new Map(group.map((s) => [s.id, { ...local(s), s }]))
			const items = [...at.values()]
			// Moving one pair apart can crowd a third, and rounding to the grid can too, so it runs until nothing is within reach.
			for (let round = 0; round < rounds; round++) {
				let any = false
				for (let i = 0; i < items.length; i++) {
					for (let j = i + 1; j < items.length; j++) {
						const a = items[i], b = items[j]
						const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + gap, dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + gap
						// Push apart to the full gap, but only when they're within half of it, so rounding can't set it off again.
						if (dx <= gap / 2 || dy <= gap / 2) continue
						any = true
						const [front, back] = a.x + a.w / 2 <= b.x + b.w / 2 ? [a, b] : [b, a]
						const [top, low] = a.y + a.h / 2 <= b.y + b.h / 2 ? [a, b] : [b, a]
						if (dx <= dy) (back.x += dx / 2 + 1, front.x -= dx / 2 + 1)
						else (low.y += dy / 2 + 1, top.y -= dy / 2 + 1)
					}
				}
				for (const p of items) (p.x = moved(p.s, p.x, p.y) ? snap(p.x) : p.x), (p.y = moved(p.s, p.x, p.y) ? snap(p.y) : p.y)
				if (!any) break
			}
			changed += apply(items.flatMap((p) => (moved(p.s, p.x, p.y) ? [{ id: p.s.id, type: p.s.type, x: p.x, y: p.y }] : [])))
		}
		return changed
	}

	/** Each frame fits what's in it, with even padding, and nothing inside moves on the page. Empty frames are left alone. */
	function fitFrames({ pad = 30 } = {}) {
		let changed = 0
		const frames = pageShapes().filter((s) => s.type === 'frame')
		// Innermost first, so an outer frame fits the inner one's new size.
		const depth = (s) => editor.getShapeAncestors(s).length
		for (const f of frames.sort((a, b) => depth(b) - depth(a))) {
			const frame = editor.getShape(f.id)
			const kids = editor.getSortedChildIdsForParent(frame.id).map((id) => editor.getShape(id)).filter((s) => s && s.type !== 'arrow')
			if (!kids.length) continue
			const box = (s) => editor.getShapeGeometry(s).bounds
			const minX = Math.min(...kids.map((s) => s.x)), minY = Math.min(...kids.map((s) => s.y))
			const maxX = Math.max(...kids.map((s) => s.x + box(s).w)), maxY = Math.max(...kids.map((s) => s.y + box(s).h))
			const dx = pad - minX, dy = pad - minY
			const w = maxX - minX + pad * 2, h = maxY - minY + pad * 2
			if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(w - frame.props.w) < 1 && Math.abs(h - frame.props.h) < 1) continue
			editor.updateShapes([{ id: frame.id, type: 'frame', x: frame.x - dx, y: frame.y - dy, props: { w, h } }, ...kids.map((s) => ({ id: s.id, type: s.type, x: s.x + dx, y: s.y + dy }))])
			changed++
		}
		return changed
	}

	/** Arrows leave and arrive at the middle of a side, and run straight unless they were elbows. Arrows a person curved stay curved. */
	function neatArrows() {
		let changed = 0
		// A diagram drawn in elbows stays in elbows: an arrow added later comes in straight.
		const all = pageShapes().filter((s) => s.type === 'arrow')
		const elbows = all.filter((a) => a.props.kind === 'elbow'), straight = all.filter((a) => a.props.kind !== 'elbow' && !a.props.bend)
		if (elbows.length > straight.length && straight.length) {
			editor.updateShapes(straight.map((a) => ({ id: a.id, type: 'arrow', props: { kind: 'elbow' } })))
			changed += straight.length
		}
		for (const a of pageShapes().filter((s) => s.type === 'arrow')) {
			const ends = editor.getBindingsFromShape(a, 'arrow')
			const from = ends.find((b) => b.props.terminal === 'start'), to = ends.find((b) => b.props.terminal === 'end')
			if (!from || !to) continue
			const sa = editor.getShape(from.toId), sb = editor.getShape(to.toId)
			if (!sa || !sb || a.props.bend || sa.props?.geo === 'cloud' || sb.props?.geo === 'cloud') continue
			const ba = editor.getShapePageBounds(sa), bb = editor.getShapePageBounds(sb)
			if (isMarker(ba) || isMarker(bb)) continue
			const sides = sidesFor(ba, bb)
			const same = (b, at) => b.props.isPrecise && Math.abs(b.props.normalizedAnchor.x - at.x) < 0.01 && Math.abs(b.props.normalizedAnchor.y - at.y) < 0.01
			if (same(from, sides.from) && same(to, sides.to)) continue
			editor.updateBindings([
				{ id: from.id, type: 'arrow', props: { ...from.props, normalizedAnchor: sides.from, isPrecise: true, isExact: false } },
				{ id: to.id, type: 'arrow', props: { ...to.props, normalizedAnchor: sides.to, isPrecise: true, isExact: false } },
			])
			changed++
		}
		return changed
	}

	/**
	 * Only arrows running through a box are touched: each tries an elbow, then gentle curves, and keeps the first that clears the
	 * boxes it wasn't clearing. Big sweeping arcs are worse than the problem, so past a modest bend it gives up and leaves it.
	 */
	function rerouteBlocked() {
		const OPTIONS = [{ kind: 'elbow', bend: 0 }, ...[40, -40, 80, -80, 140, -140, 220, -220].map((bend) => ({ kind: 'arc', bend }))]
		const solid = pageShapes().filter((s) => s.type === 'geo' && !isMarker(editor.getShapePageBounds(s)))
		const seg = (p, q, r, t) => {
			const o = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
			return o(p, q, r) * o(p, q, t) < 0 && o(r, t, p) * o(r, t, q) < 0
		}
		const blocks = (path, s) => {
			const b = editor.getShapePageBounds(s), pad = 6
			const c = [{ x: b.x + pad, y: b.y + pad }, { x: b.maxX - pad, y: b.y + pad }, { x: b.maxX - pad, y: b.maxY - pad }, { x: b.x + pad, y: b.maxY - pad }]
			for (let i = 1; i < path.length; i++) {
				const p = path[i]
				if (p.x > c[0].x && p.x < c[2].x && p.y > c[0].y && p.y < c[2].y) return true
				for (let k = 0; k < 4; k++) if (seg(path[i - 1], p, c[k], c[(k + 1) % 4])) return true
			}
			return false
		}
		let changed = 0
		for (const a of pageShapes().filter((s) => s.type === 'arrow')) {
			const ends = new Set(editor.getBindingsFromShape(a, 'arrow').map((b) => b.toId))
			if (ends.size < 2) continue
			for (const id of [...ends]) for (const anc of editor.getShapeAncestors(id)) ends.add(anc.id)
			const others = solid.filter((s) => !ends.has(s.id))
			const count = () => {
				const now = editor.getShape(a.id)
				const path = editor.getShapePageTransform(now).applyToPoints(editor.getShapeGeometry(now).vertices)
				return others.filter((s) => blocks(path, s)).length
			}
			const start = count()
			if (!start) continue
			const was = { kind: a.props.kind, bend: a.props.bend }
			const best = OPTIONS.find((o) => {
				editor.updateShape({ id: a.id, type: 'arrow', props: o })
				return count() === 0
			})
			if (best) changed++
			else editor.updateShape({ id: a.id, type: 'arrow', props: was })
		}
		return changed
	}

	/** Each frame's boxes take one colour, the most common among them, so a boundary reads at a glance. Arrows are left alone. */
	function colourByFrame() {
		const PALETTE = ['blue', 'green', 'orange', 'violet', 'red', 'light-blue', 'light-green', 'grey']
		const used = new Set()
		const updates = []
		for (const f of pageShapes().filter((s) => s.type === 'frame')) {
			const kids = editor.getSortedChildIdsForParent(f.id).map((id) => editor.getShape(id)).filter((s) => s?.type === 'geo')
			if (!kids.length) continue
			const counts = new Map()
			for (const s of kids) if (s.props.color !== 'black') counts.set(s.props.color, (counts.get(s.props.color) ?? 0) + 1)
			const held = [...counts].sort((a, b) => b[1] - a[1]).map(([c]) => c).find((c) => !used.has(c))
			const colour = held ?? PALETTE.find((c) => !used.has(c)) ?? 'grey'
			used.add(colour)
			for (const s of kids) if (s.props.color !== colour) updates.push({ id: s.id, type: s.type, props: { color: colour } })
		}
		return apply(updates)
	}

	/** Lays everything out afresh with the same engine as the templates, frames included, following the arrows. */
	async function layOut(toucan, { direction } = {}) {
		const dir = direction ?? mainDirection()
		const frameOf = (s) => editor.getShapeAncestors(s).find((a) => a.type === 'frame')
		const boxes = pageShapes().filter((s) => s.type === 'geo' && !isMarker({ w: s.props.w, h: s.props.h + (s.props.growY ?? 0) }))
		const known = new Set(boxes.map((s) => s.id))
		const frames = pageShapes().filter((s) => s.type === 'frame' && boxes.some((b) => frameOf(b)?.id === s.id))
		const edges = pageShapes().filter((s) => s.type === 'arrow').flatMap((a) => {
			const ends = editor.getBindingsFromShape(a, 'arrow')
			const from = ends.find((b) => b.props.terminal === 'start')?.toId, to = ends.find((b) => b.props.terminal === 'end')?.toId
			return from && to && known.has(from) && known.has(to) ? [{ from, to, label: toucanText(a) }] : []
		})
		const placed = await LAYOUTS.flow({
			direction: dir,
			route: 'straight',
			gap: 50,
			layerGap: 90,
			groups: frames.map((f) => ({ id: f.id, label: f.props.name })),
			nodes: boxes.map((s) => ({ id: s.id, text: toucanText(s) || ' ', group: frameOf(s)?.id, w: s.props.w, h: s.props.h + (s.props.growY ?? 0), ...(s.props.geo !== 'rectangle' && s.props.geo !== 'oval' && { shape: s.props.geo }) })),
			edges,
		})
		const origin = editor.getCurrentPageBounds() ?? { x: 0, y: 0 }
		const frameBox = new Map(placed.groups.map((g) => [g.key, g.box]))
		editor.updateShapes([
			...placed.groups.map((g) => ({ id: g.key, type: 'frame', x: origin.x + g.box.x, y: origin.y + g.box.y, props: { w: g.box.w, h: g.box.h } })),
			...placed.nodes.map((n) => {
				const f = n.group && frameBox.get(n.group)
				const s = editor.getShape(n.key)
				return { id: n.key, type: s.type, x: (f ? 0 : origin.x) + n.box.x - (f ? f.x : 0), y: (f ? 0 : origin.y) + n.box.y - (f ? f.y : 0), props: { w: n.box.w, h: n.box.h, growY: 0 } }
			}),
		])
		neatArrows()
		return placed.nodes.length
	}
	const toucanText = (s) => (s.props.richText ? renderPlaintextFromRichText(editor, s.props.richText) : '')
	function mainDirection() {
		let across = 0, down = 0
		for (const a of pageShapes().filter((s) => s.type === 'arrow')) {
			const ends = editor.getBindingsFromShape(a, 'arrow')
			const from = ends.find((b) => b.props.terminal === 'start'), to = ends.find((b) => b.props.terminal === 'end')
			if (!from || !to) continue
			const pa = editor.getShapePageBounds(from.toId), pb = editor.getShapePageBounds(to.toId)
			if (!pa || !pb) continue
			across += Math.abs(pb.midX - pa.midX)
			down += Math.abs(pb.midY - pa.midY)
		}
		return across >= down ? 'RIGHT' : 'DOWN'
	}

	/** All of it, gently: what a person means by "clean this up". Keeps the arrangement, and doesn't re-lay anything out. */
	function all() {
		const counts = { sizes: matchSizes(), aligned: align(), spaced: distribute() }
		counts.aligned += align()
		// Last, because lining things up can bring them back together.
		counts.apart = fixOverlaps()
		counts.frames = fitFrames()
		counts.apart += fixOverlaps({ gap: 40, framesOnly: true })
		counts.arrows = neatArrows() + rerouteBlocked()
		return counts
	}

	return { rerouteBlocked, align, distribute, matchSizes, fixOverlaps, fitFrames, neatArrows, colourByFrame, layOut, all, mainDirection }
}
