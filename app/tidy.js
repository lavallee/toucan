// The geometry behind the tidying routines (routines/*.js call these as toucan.tidy.*). Each works on what a person can see, keeps
// frames and connections as they are, never touches a sticky note, and leaves a tidy diagram alone, so it's safe to run twice.
// It's written against the scene (app/scene.js), so it does the same on tldraw and Excalidraw.

import { LAYOUTS, sidesFor } from '../lib/layouts.mjs'
import { getFormat } from './formats'

export function makeTidy(scene) {
	const GRID = 10
	const snap = (n) => Math.round(n / GRID) * GRID
	const isMarker = (b) => b.w < 30 || b.h < 30 // dots and lifelines belong to a layout, and aren't boxes to rearrange
	const movable = () => scene.items().filter((s) => s.kind === 'box' && !isMarker(s.local))
	// Positions are worked out in each parent's own coordinates, so lining up to the grid means the same inside a frame as outside,
	// and they're written back as they are.
	const local = (s) => s.local
	const LOCAL = { local: true }
	/** The boxes that sit together: those with the same parent. Only they can be meaningfully lined up. */
	const groups = () => {
		const out = new Map()
		for (const s of movable()) (out.get(s.parent) ?? out.set(s.parent, []).get(s.parent)).push(s)
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
	const moved = (s, x, y) => {
		const l = local(s)
		return Math.abs(l.x - x) > 0.5 || Math.abs(l.y - y) > 0.5
	}
	/** Each tidying is one batch: on Excalidraw, one updateScene (or part of the run's, inside an exec). */
	const batched = (fn) => (...a) => scene.batch(() => fn(...a))

	// On a timeline a box's position and width are its dates, so tidying sideways would change what the diagram says.
	const timed = () => getFormat()?.id === 'timeline'

	/** Boxes nearly in line are put in line: rows by their centres, then columns. */
	function align({ tolerance = 40 } = {}) {
		const at = new Map()
		const base = new Map(movable().map((s) => [s.id, local(s)]))
		const pos = (s) => at.get(s.id) ?? base.get(s.id)
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
				for (const col of timed() ? [] : clusters(group, (s) => pos(s).x + local(s).w / 2, tolerance)) {
					if (col.length < 2) continue
					const line = snap(median(col.map((s) => pos(s).x + local(s).w / 2)))
					for (const s of col) set(s, { ...pos(s), x: line - local(s).w / 2 })
				}
			}
		}
		let n = 0
		for (const s of movable()) {
			const p = at.get(s.id)
			if (p && moved(s, p.x, p.y)) (scene.place(s.id, { x: p.x, y: p.y }, LOCAL), n++)
		}
		return n
	}

	/**
	 * Within a row or a column, the gaps become equal. A row with a deliberate hole in it is left alone. Evening out a column can
	 * bring a box into a row, so it runs until nothing moves: a second click changes nothing.
	 */
	function distribute({ tolerance = 20 } = {}) {
		const moved = new Set()
		for (let pass = 0; pass < 4; pass++) {
			const updates = new Map()
			const even = (line, along, size, set) => {
				if (line.length < 3) return
				const sorted = [...line].sort((a, b) => along(a) - along(b))
				const gaps = sorted.slice(1).map((s, i) => along(s) - (along(sorted[i]) + size(sorted[i])))
				if (gaps.some((g) => g < 0) || Math.max(...gaps) > median(gaps) * 2 + 20) return // an overlap, or a hole that means something
				const gap = gaps.reduce((a, b) => a + b, 0) / gaps.length
				let at = along(sorted[0])
				for (const s of sorted) {
					if (Math.abs(along(s) - at) > 0.5) updates.set(s.id, { s, ...updates.get(s.id), ...set(at) })
					at += size(s) + gap
				}
			}
			for (const group of groups()) {
				for (const row of timed() ? [] : clusters(group, (s) => local(s).y + local(s).h / 2, tolerance)) even(row, (s) => local(s).x, (s) => local(s).w, (x) => ({ x }))
				for (const col of clusters(group, (s) => local(s).x + local(s).w / 2, tolerance)) even(col, (s) => local(s).y, (s) => local(s).h, (y) => ({ y }))
			}
			for (const { s, x, y } of updates.values()) {
				const l = local(s)
				scene.place(s.id, { x: x ?? l.x, y: y ?? l.y }, LOCAL)
				moved.add(s.id)
			}
			if (!updates.size) break
		}
		return moved.size
	}

	/** Rectangles in a row become one height, and those in a column one width. Only ever larger, so no text is squeezed. */
	function matchSizes({ tolerance = 40 } = {}) {
		if (timed()) return 0
		const size = new Map()
		const cur = (s) => size.get(s.id) ?? { w: local(s).w, h: local(s).h }
		// Rows and columns are judged by centres, which don't move here, so one pass is enough; a tallest stays tallest.
		for (const group of groups()) {
			const rects = group.filter((s) => s.geo === 'rectangle')
			for (const row of clusters(rects, (s) => local(s).y + local(s).h / 2, tolerance)) {
				if (row.length < 2) continue
				const h = Math.max(...row.map((s) => cur(s).h))
				for (const s of row) size.set(s.id, { ...cur(s), h })
			}
			for (const col of clusters(rects, (s) => local(s).x + local(s).w / 2, tolerance)) {
				if (col.length < 2) continue
				const w = Math.max(...col.map((s) => cur(s).w))
				for (const s of col) size.set(s.id, { ...cur(s), w })
			}
		}
		let n = 0
		for (const s of movable()) {
			const z = size.get(s.id)
			if (!z || (Math.abs(z.w - local(s).w) < 1 && Math.abs(z.h - local(s).h) < 1)) continue
			// Keep it centred where it was, so neighbours in line stay in line.
			scene.place(s.id, { x: s.local.x - (z.w - local(s).w) / 2, y: s.local.y - (z.h - local(s).h) / 2, w: z.w, h: z.h }, LOCAL)
			n++
		}
		return n
	}

	/** Overlapping boxes are moved apart by the least distance that clears them, along whichever axis needs less. */
	function fixOverlaps({ gap = 24, rounds = 400, framesOnly = false } = {}) {
		let changed = 0
		// Frames on the page are kept clear of each other, and of the boxes on the page beside them.
		const frames = () => [...scene.items().filter((s) => s.kind === 'frame' && !s.parent), ...movable().filter((s) => !s.parent)]
		for (let group of framesOnly ? [frames()] : [...groups(), 'frames']) {
			// Read when it's reached, so the boxes on the page are where the pass before put them.
			if (group === 'frames') group = frames()
			const items = group.map((s) => ({ ...local(s), s }))
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
						// On a timeline two things at once stack up, as the layout draws them: sideways would change their dates.
						if (dx <= dy && !timed()) (back.x += dx / 2 + 1, front.x -= dx / 2 + 1)
						else (low.y += dy / 2 + 1, top.y -= dy / 2 + 1)
					}
				}
				for (const p of items) (p.x = moved(p.s, p.x, p.y) && !timed() ? snap(p.x) : p.x), (p.y = moved(p.s, p.x, p.y) ? snap(p.y) : p.y)
				if (!any) break
			}
			// A frame takes what's in it along.
			for (const p of items) if (moved(p.s, p.x, p.y)) (scene.place(p.s.id, { x: p.x, y: p.y }, { carry: true, local: true }), changed++)
		}
		return changed
	}

	/**
	 * Each frame fits what's in it, with even padding (`pad`), and nothing inside moves on the page: the frame's edges move round
	 * its contents. Empty frames are left alone.
	 */
	function fitFrames({ pad = 30 } = {}) {
		let changed = 0
		const frames = scene.items().filter((s) => s.kind === 'frame')
		// Innermost first, so an outer frame fits the inner one's new size.
		const depth = (s) => scene.ancestors(s.id).length
		for (const f of frames.sort((a, b) => depth(b) - depth(a))) {
			const frame = scene.get(f.id)
			const kids = scene.children(frame.id).filter((s) => s.kind !== 'arrow')
			if (!kids.length) continue
			const minX = Math.min(...kids.map((s) => s.x)), minY = Math.min(...kids.map((s) => s.y))
			const maxX = Math.max(...kids.map((s) => s.maxX)), maxY = Math.max(...kids.map((s) => s.maxY))
			const box = { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 }
			if (Math.abs(box.x - frame.x) < 1 && Math.abs(box.y - frame.y) < 1 && Math.abs(box.w - frame.w) < 1 && Math.abs(box.h - frame.h) < 1) continue
			scene.place(frame.id, box)
			changed++
		}
		return changed
	}

	/** Arrows leave and arrive at the middle of a side, and run straight unless they were elbows. Arrows a person curved stay curved. */
	function neatArrows() {
		let changed = 0
		// A diagram drawn in elbows stays in elbows: an arrow added later comes in straight.
		const all = scene.arrows()
		const elbows = all.filter((a) => a.kind === 'elbow'), straight = all.filter((a) => a.kind !== 'elbow' && !a.bend)
		if (elbows.length > straight.length && straight.length) {
			for (const a of straight) scene.setArrow(a.id, { kind: 'elbow' })
			changed += straight.length
		}
		for (const a of scene.arrows()) {
			if (!a.from || !a.to) continue
			const sa = scene.get(a.from), sb = scene.get(a.to)
			if (!sa || !sb || a.bend || sa.geo === 'cloud' || sb.geo === 'cloud') continue
			if (isMarker(sa) || isMarker(sb)) continue
			const sides = sidesFor(sa, sb)
			const same = (at, want) => at && Math.abs(at.x - want.x) < 0.01 && Math.abs(at.y - want.y) < 0.01
			if (same(a.anchors.from, sides.from) && same(a.anchors.to, sides.to)) continue
			scene.setArrow(a.id, { anchors: { from: sides.from, to: sides.to } })
			changed++
		}
		return changed
	}

	// ---- arrows through boxes -------------------------------------------------------------------------------------------
	const seg = (p, q, r, t) => {
		const o = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
		return o(p, q, r) * o(p, q, t) < 0 && o(r, t, p) * o(r, t, q) < 0
	}
	const blocks = (path, b, pad = 6) => {
		const c = [{ x: b.x + pad, y: b.y + pad }, { x: b.maxX - pad, y: b.y + pad }, { x: b.maxX - pad, y: b.maxY - pad }, { x: b.x + pad, y: b.maxY - pad }]
		for (let i = 1; i < path.length; i++) {
			const p = path[i]
			if (p.x > c[0].x && p.x < c[2].x && p.y > c[0].y && p.y < c[2].y) return true
			for (let k = 0; k < 4; k++) if (seg(path[i - 1], p, c[k], c[(k + 1) % 4])) return true
		}
		return false
	}

	/**
	 * Only arrows running through a box are touched: each tries an elbow, then gentle curves, and keeps the first that clears the
	 * boxes it wasn't clearing. Big sweeping arcs are worse than the problem, so past a modest bend it gives up and leaves it.
	 */
	function rerouteBlocked() {
		const OPTIONS = [{ kind: 'elbow', bend: 0 }, ...[40, -40, 80, -80, 140, -140, 220, -220].map((bend) => ({ kind: 'arc', bend }))]
		const solid = scene.items().filter((s) => s.kind === 'box' && !isMarker(s))
		let changed = 0
		for (const a of scene.arrows()) {
			const ends = new Set([a.from, a.to].filter(Boolean))
			if (ends.size < 2) continue
			for (const id of [...ends]) for (const anc of scene.ancestors(id)) ends.add(anc)
			const others = solid.filter((s) => !ends.has(s.id))
			const count = () => {
				const path = scene.arrowPath(a.id)
				// Boxes are read again: on Excalidraw an elbow's route depends on nothing else, but a box may have moved this run.
				return others.filter((s) => blocks(path, scene.get(s.id) ?? s)).length
			}
			if (!count()) continue
			const was = scene.saveArrow(a.id)
			const best = OPTIONS.find((o) => {
				scene.setArrow(a.id, o)
				return count() === 0
			})
			if (best) changed++
			else scene.restoreArrow(a.id, was)
		}
		return changed
	}

	/** Each frame's boxes take one colour, the most common among them, so a boundary reads at a glance. Arrows are left alone. */
	function colourByFrame() {
		const PALETTE = ['blue', 'green', 'orange', 'violet', 'red', 'light-blue', 'light-green', 'grey']
		const used = new Set()
		let n = 0
		for (const f of scene.items().filter((s) => s.kind === 'frame')) {
			const kids = scene.children(f.id).filter((s) => s.kind === 'box')
			if (!kids.length) continue
			const counts = new Map()
			for (const s of kids) if (s.color !== 'black') counts.set(s.color, (counts.get(s.color) ?? 0) + 1)
			const held = [...counts].sort((a, b) => b[1] - a[1]).map(([c]) => c).find((c) => c && !used.has(c))
			const colour = held ?? PALETTE.find((c) => !used.has(c)) ?? 'grey'
			used.add(colour)
			for (const s of kids) if (s.color !== colour) (scene.restyle(s.id, { color: colour }), n++)
		}
		return n
	}

	/**
	 * Lays everything out afresh with the same engine as the templates, frames included, following the arrows. `within` (a
	 * frame's key) lays out only that frame's contents, inside it. Arrows a person routed (curved, or an elbow in a diagram
	 * of straight arrows) keep their route; the rest are made neat.
	 */
	async function layOut(...given) {
		// Once called as layOut(toucan, options).
		const { within, direction, spacing = 50, layerSpacing = 90 } = (given[0]?.tidy ? given[1] : given[0]) ?? {}
		if (timed()) throw new Error('On a timeline, position is the date, so this would change what the diagram says. Set a different format first if that is what you want.')
		const dir = direction ?? mainDirection()
		const everything = scene.items()
		const root = within ? everything.find((s) => s.kind === 'frame' && (s.key === within || s.id === within)) : null
		if (within && !root) throw new Error(`no frame ${within} (keys come from toucan.summary())`)
		const inside = (s) => !root || scene.ancestors(s.id).includes(root.id)
		const boxes = everything.filter((s) => s.kind === 'box' && !isMarker(s.local) && inside(s))
		const known = new Set(boxes.map((s) => s.id))
		const frameOf = (s) => (s.frame && s.frame !== root?.id ? s.frame : undefined)
		const frames = everything.filter((s) => s.kind === 'frame' && s.id !== root?.id && boxes.some((b) => frameOf(b) === s.id))
		const arrows = scene.arrows()
		const edges = arrows.flatMap((a) => (a.from && a.to && known.has(a.from) && known.has(a.to) ? [{ from: a.from, to: a.to, label: a.text }] : []))
		// Routes worth keeping: a curve someone gave it, or an elbow among straight arrows.
		const straightMostly = arrows.filter((a) => a.kind === 'elbow').length <= arrows.filter((a) => a.kind !== 'elbow' && !a.bend).length
		const handRouted = new Map(arrows.filter((a) => a.bend || (a.kind === 'elbow' && straightMostly)).map((a) => [a.id, scene.saveArrow(a.id)]))
		const placed = await LAYOUTS.flow({
			direction: dir,
			route: 'straight',
			keepSizes: true,
			gap: spacing,
			layerGap: layerSpacing,
			groups: frames.map((f) => ({ id: f.id, label: f.text })),
			nodes: boxes.map((s) => ({ id: s.id, text: s.text || ' ', group: frameOf(s), w: s.local.w, h: s.local.h, ...(s.geo !== 'rectangle' && s.geo !== 'oval' && { shape: s.geo }) })),
			edges,
		})
		// Inside a frame, the layout starts at its top left, below its name; otherwise where the diagram was.
		const origin = root ? { x: root.x + 30, y: root.y + 50 } : scene.bounds() ?? { x: 0, y: 0 }
		return scene.batch(() => {
			// Outer frames first: a frame takes what's in it along, and an inner frame is then put where it goes.
			const depth = (id) => scene.ancestors(id).length
			for (const g of [...placed.groups].sort((a, b) => depth(a.key) - depth(b.key))) scene.place(g.key, { x: origin.x + g.box.x, y: origin.y + g.box.y, w: g.box.w, h: g.box.h }, { carry: true })
			for (const n of placed.nodes) scene.place(n.key, { x: origin.x + n.box.x, y: origin.y + n.box.y, w: n.box.w, h: n.box.h })
			neatArrows()
			for (const [id, saved] of handRouted) scene.restoreArrow(id, saved)
			// What wasn't laid out, like a person's sticky note or an inner frame's outer frame, is still inside: frames grow to hold it.
			const holdsMore = scene.items().some((s) => s.kind !== 'arrow' && s.kind !== 'box' && s.parent && scene.get(s.parent)?.kind === 'frame')
			if (root) {
				// Only the frame laid out changes, and only to hold what's in it now: a lane keeps its width, and the others stay as they are.
				const kids = scene.children(root.id).filter((s) => s.kind !== 'arrow')
				const f = scene.get(root.id)
				if (kids.length) {
					const x1 = Math.max(f.maxX, Math.max(...kids.map((s) => s.maxX)) + 30), y1 = Math.max(f.maxY, Math.max(...kids.map((s) => s.maxY)) + 30)
					// A frame that grew can reach the next one: they move apart, as Fit frames does.
					if (x1 > f.maxX + 0.5 || y1 > f.maxY + 0.5) (scene.place(root.id, { w: x1 - f.x, h: y1 - f.y }), fixOverlaps({ gap: 40, framesOnly: true }))
				}
			} else if (holdsMore) fitFrames()
			return placed.nodes.length
		})
	}

	function mainDirection() {
		let across = 0, down = 0
		for (const a of scene.arrows()) {
			if (!a.from || !a.to) continue
			const pa = scene.get(a.from), pb = scene.get(a.to)
			if (!pa || !pb) continue
			across += Math.abs(pb.x + pb.w / 2 - (pa.x + pa.w / 2))
			down += Math.abs(pb.y + pb.h / 2 - (pa.y + pa.h / 2))
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

	return {
		align: batched(align), distribute: batched(distribute), matchSizes: batched(matchSizes), fixOverlaps: batched(fixOverlaps), fitFrames: batched(fitFrames),
		neatArrows: batched(neatArrows), rerouteBlocked: batched(rerouteBlocked), colourByFrame: batched(colourByFrame), all: batched(all), layOut, mainDirection,
	}
}
