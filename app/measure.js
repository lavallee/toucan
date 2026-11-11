// Measures a diagram as the engine actually draws it, and says what's wrong and where. The eval, the Check diagram routine and agents all
// use this, so there's one definition of what makes a diagram sound. Findings name the shapes involved. It reads the canvas through
// the scene (app/scene.js), so it measures tldraw and Excalidraw canvases alike.

export function measureDiagram(scene) {
	const findings = []
	const found = (kind, ...on) => {
		if (findings.length < 60) findings.push({ kind, on: on.map((s) => s.key) })
	}
	const shapes = scene.items()
	const byId = new Map(shapes.map((s) => [s.id, s]))
	const boxes = shapes.filter((s) => s.kind === 'box' || s.kind === 'note' || s.kind === 'text')
	const frames = shapes.filter((s) => s.kind === 'frame')
	const arrows = scene.arrows()
	const bounds = (s) => s
	const labelled = boxes.filter((s) => s.text.trim())
	const isThin = (b) => b.w < 30 || b.h < 30 // markers: lifelines, dots
	const solid = labelled.filter((s) => !isThin(bounds(s)))
	const hit = (a, b, pad = 0) => a.x < b.maxX - pad && b.x < a.maxX - pad && a.y < b.maxY - pad && b.y < a.maxY - pad
	const ancestors = (s) => scene.ancestors(s.id)

	let overlaps = 0, tooClose = 0
	const gaps = []
	solid.forEach((s, i) => {
		const a = bounds(s)
		let nearest = Infinity
		solid.forEach((o, j) => {
			if (i === j) return
			const b = bounds(o)
			if (j > i && hit(a, b)) (overlaps++, found('overlap', s, o))
			const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.maxX, b.maxX)), dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.maxY, b.maxY))
			nearest = Math.min(nearest, Math.hypot(dx, dy))
			if (j > i && !hit(a, b) && Math.hypot(dx, dy) < 12) (tooClose++, found('too close', s, o))
		})
		if (nearest < Infinity) gaps.push(nearest)
	})

	// Text that outgrew the box drawn for it: the layout's estimate was wrong, and it pushed into whatever is below.
	const grown = boxes.filter((s) => s.kind === 'box' && s.grown > 1)
	grown.forEach((s) => found('text outgrew its box', s))
	const outgrew = grown.length
	const spilling = boxes.filter((s) => {
		const p = s.parent && byId.get(s.parent)
		if (p?.kind !== 'frame') return false
		const a = bounds(s), f = bounds(p)
		return a.x < f.x - 1 || a.y < f.y - 1 || a.maxX > f.maxX + 1 || a.maxY > f.maxY + 1
	})
	spilling.forEach((s) => found('cut off by its frame', s))
	const frameOverflow = spilling.length
	let labelClipped = 0
	frames.forEach((f, i) => frames.forEach((g, j) => {
		if (j <= i) return
		const a = bounds(f), b = bounds(g)
		if (hit(a, b) && !ancestors(g).includes(f.id) && !ancestors(f).includes(g.id)) labelClipped++
	}))

	const cross = (p, q, r, s) => {
		const o = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
		return o(p, q, r) * o(p, q, s) < 0 && o(r, s, p) * o(r, s, q) < 0
	}
	const segDist = (p, a, b) => {
		const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy
		const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0
		return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
	}
	const crossesBox = (path, b, pad = 6) => {
		const x0 = b.x + pad, x1 = b.maxX - pad, y0 = b.y + pad, y1 = b.maxY - pad
		if (x1 <= x0 || y1 <= y0) return false
		const c = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]
		for (let i = 1; i < path.length; i++) {
			if (path[i].x > x0 && path[i].x < x1 && path[i].y > y0 && path[i].y < y1) return true
			for (let k = 0; k < 4; k++) if (cross(path[i - 1], path[i], c[k], c[(k + 1) % 4])) return true
		}
		return false
	}
	const info = arrows.map((a) => ({ a, path: scene.arrowPath(a.id), ends: new Set([a.from, a.to].filter(Boolean)) }))
	let throughBoxes = 0, crossings = 0, labelOnBox = 0, labelOnMarker = 0, labelSqueezed = 0, shortArrows = 0, loose = 0, labelOnLabel = 0
	const labels = [] // [arrow, its label's box], to find labels piled on each other (elbows that share a run put theirs together)
	const markers = boxes.filter((s) => !s.text.trim() || isThin(bounds(s)))
	const lengths = []
	let along = 0, against = 0
	const dirs = []
	info.forEach(({ a, path, ends }, i) => {
		if (ends.size < 2) loose++
		const skip = new Set(ends)
		for (const id of ends) for (const anc of scene.ancestors(id)) skip.add(anc)
		for (const s of solid) if (!skip.has(s.id) && crossesBox(path, bounds(s))) (throughBoxes++, found('arrow runs through a box', a, s))
		for (let j = i + 1; j < info.length; j++) {
			if ([...ends].some((x) => info[j].ends.has(x))) continue
			for (let p = 1; p < path.length; p++) for (let q = 1; q < info[j].path.length; q++) if (cross(path[p - 1], path[p], info[j].path[q - 1], info[j].path[q])) (crossings++, found('arrows cross', a, info[j].a))
		}
		const len = path.slice(1).reduce((sum, q, k) => sum + Math.hypot(q.x - path[k].x, q.y - path[k].y), 0)
		lengths.push(len)
		const big = [...ends].every((id) => byId.get(id) && !isThin(byId.get(id)))
		if (len < 24 && big) (shortArrows++, found('arrow too short to read', a))
		const first = path[0], last = path.at(-1)
		dirs.push({ dx: last.x - first.x, dy: last.y - first.y })
		const box = a.text.trim() ? scene.arrowLabelBox(a.id) : null
		if (box) {
			for (const [other, b] of labels) if (hit(box, b, 2)) (labelOnLabel++, found('arrow labels sit on each other', a, other))
			labels.push([a, box])
			for (const s of solid) if (!ends.has(s.id) && hit(box, bounds(s), 2)) (labelOnBox++, found('arrow label sits on a box', a, s))
			for (const s of markers) if (!ends.has(s.id) && hit(box, bounds(s), 0)) (labelOnMarker++, found('arrow label sits on a line', a))
			// A label longer than the line it sits on: it hides its own arrow.
			const horizontal = Math.abs(last.x - first.x) >= Math.abs(last.y - first.y)
			if ((horizontal ? box.maxX - box.x : box.maxY - box.y) > len * 0.8) (labelSqueezed++, found('arrow label hides its arrow', a))
		}
	})
	// A label another arrow runs through: elbows that share a run put one arrow's label on the other's line.
	let labelCrossed = 0
	// Where two arrows share a run (a fork leaving a decision), the other one runs along this one's own line, which reads fine;
	// it counts only where the other arrow, inside the label, is somewhere this arrow isn't.
	const near = (pt, path) => path.some((q, k) => k > 0 && segDist(pt, path[k - 1], q) < 2.5)
	const strays = (other, own, box) => {
		for (let k = 1; k < other.length; k++) {
			const p0 = other[k - 1], p1 = other[k], n = Math.max(2, Math.ceil(Math.hypot(p1.x - p0.x, p1.y - p0.y) / 4))
			for (let t = 0; t <= n; t++) {
				const pt = { x: p0.x + ((p1.x - p0.x) * t) / n, y: p0.y + ((p1.y - p0.y) * t) / n }
				if (pt.x > box.x + 2 && pt.x < box.maxX - 2 && pt.y > box.y + 2 && pt.y < box.maxY - 2 && !near(pt, own)) return true
			}
		}
		return false
	}
	const pathOf = new Map(info.map((x) => [x.a.id, x.path]))
	for (const [a, box] of labels) for (const o of info) if (o.a.id !== a.id && crossesBox(o.path, box, 2) && strays(o.path, pathOf.get(a.id), box)) (labelCrossed++, found('an arrow runs through another arrow\'s label', o.a, a))
	const totals = dirs.reduce((s, d) => ({ r: s.r + Math.max(0, d.dx), l: s.l + Math.max(0, -d.dx), d: s.d + Math.max(0, d.dy), u: s.u + Math.max(0, -d.dy) }), { r: 0, l: 0, d: 0, u: 0 })
	const flow = totals.r + totals.l + totals.d + totals.u ? Math.max(totals.r, totals.l, totals.d, totals.u) / (totals.r + totals.l + totals.d + totals.u) : 1

	// Alignment: how many boxes share an edge or a centre line with another.
	const line = (v) => Math.round(v / 2)
	const seen = (f) => {
		const m = new Map()
		for (const s of solid) m.set(line(f(bounds(s))), (m.get(line(f(bounds(s)))) ?? 0) + 1)
		return m
	}
	const cols = [seen((b) => b.x), seen((b) => b.x + b.w / 2), seen((b) => b.maxX)], rows = [seen((b) => b.y), seen((b) => b.y + b.h / 2), seen((b) => b.maxY)]
	const alignedOn = (maps, f, s) => maps.some((m, i) => m.get(line(f[i](bounds(s)))) > 1)
	const xf = [(b) => b.x, (b) => b.x + b.w / 2, (b) => b.maxX], yf = [(b) => b.y, (b) => b.y + b.h / 2, (b) => b.maxY]
	const aligned = solid.length ? solid.filter((s) => alignedOn(cols, xf, s) || alignedOn(rows, yf, s)).length / solid.length : 1
	// Boxes side by side at different heights make a row look accidental.
	let unevenRows = 0
	solid.forEach((s, i) => solid.forEach((o, j) => {
		if (j <= i) return
		const a = bounds(s), b = bounds(o)
		if (Math.abs(a.y + a.h / 2 - (b.y + b.h / 2)) < 2 && Math.abs(a.h - b.h) > 4 && s.parent === o.parent && s.geo === 'rectangle' && o.geo === 'rectangle') (unevenRows++, found('uneven row', s, o))
	}))
	// The same in a stack of equally wide boxes: a column of cards that differ by a line of text.
	// A table's rows may differ, since each row keeps one height across; text without a border has no visible box to compare.
	let unevenColumns = 0
	const boxed = solid.filter((s) => s.geo === 'rectangle' && s.meta?.borderless !== true && s.dash !== 'none' && s.color !== undefined)
	const inRow = (s) => {
		const a = bounds(s)
		return boxed.some((o) => o !== s && o.parent === s.parent && Math.abs(bounds(o).y - a.y) < 2 && Math.abs(bounds(o).h - a.h) < 2)
	}
	const stackable = boxed.filter((s) => !inRow(s))
	stackable.forEach((s, i) => stackable.forEach((o, j) => {
		if (j <= i) return
		const a = bounds(s), b = bounds(o)
		if (Math.abs(a.x - b.x) < 2 && Math.abs(a.w - b.w) < 2 && Math.abs(a.h - b.h) > 4 && s.parent === o.parent) (unevenColumns++, found('uneven column', s, o))
	}))
	// A few straight arrows among elbows read as a mistake. A deliberate curve doesn't count, nor an elbow rerouted around a box in a straight diagram.
	const elbows = arrows.filter((a) => a.kind === 'elbow'), straight = arrows.filter((a) => a.kind !== 'elbow' && !a.bend)
	const mixedArrows = elbows.length > straight.length ? straight.length : 0
	if (mixedArrows) found('straight arrows among elbows', ...straight.slice(0, 6))
	// Every frame's content starting well in from its left edge: a gutter nothing uses.
	const insets = frames.flatMap((f) => {
		const inside = solid.filter((s) => s.parent === f.id)
		return inside.length ? [Math.min(...inside.map((s) => bounds(s).x)) - bounds(f).x] : []
	})
	const emptyGutter = insets.length > 1 && Math.min(...insets) > 100 ? 1 : 0
	if (emptyGutter) found('empty gutter down the frames', ...frames.slice(0, 3))
	// Within a row or column of three or more, how even the gaps are (0 is perfectly even). A deliberate hole doesn't count.
	const lineSpread = []
	const lines = (centre, start, size) => {
		const byParent = new Map()
		for (const s of solid) (byParent.get(s.parent) ?? byParent.set(s.parent, []).get(s.parent)).push(bounds(s))
		for (const group of byParent.values()) {
			const sorted = [...group].sort((a, b) => centre(a) - centre(b))
			let run = []
			for (const b of [...sorted, null]) {
				if (b && (!run.length || centre(b) - centre(run[0]) <= 20)) run.push(b)
				else {
					if (run.length >= 3) {
						const along = [...run].sort((a, c) => start(a) - start(c))
						const gaps = along.slice(1).map((x, i) => start(x) - (start(along[i]) + size(along[i])))
						const typical = [...gaps].sort((a, c) => a - c)[Math.floor(gaps.length / 2)]
						if (gaps.every((g) => g >= 0) && Math.max(...gaps) <= typical * 2 + 20) lineSpread.push(typical ? (Math.max(...gaps) - Math.min(...gaps)) / typical : 0)
					}
					run = b ? [b] : []
				}
			}
		}
	}
	lines((b) => b.y + b.h / 2, (b) => b.x, (b) => b.w)
	lines((b) => b.x + b.w / 2, (b) => b.y, (b) => b.h)
	const sizes = solid.map((s) => `${Math.round(bounds(s).w)}x${Math.round(bounds(s).h)}`)
	const sizeVariety = solid.length ? new Set(sizes).size / solid.length : 0
	const mean = (l) => l.reduce((a, b) => a + b, 0) / (l.length || 1)
	const cv = (l) => (l.length > 1 && mean(l) ? Math.sqrt(mean(l.map((v) => (v - mean(l)) ** 2))) / mean(l) : 0)

	const page = scene.bounds()
	const view = scene.viewport()
	const padded = 0.92
	const fitZoom = page ? Math.min(1, (view.w * padded) / page.w, (view.h * padded) / page.h) : 1
	const minFont = Math.min(...solid.map((s) => s.fontSize ?? 18), 32)
	// With the whole diagram in view on a screen, is it still legible? A big canvas is read by zooming in, not whole, so there it's
	// only a measure: no finding, and no cost.
	const large = solid.length > 25 || frames.length >= 3
	if (solid.length && fitZoom * minFont < 8 && !large) found('text too small to read with the whole diagram in view')
	return {
		findings,
		boxes: solid.length, arrows: arrows.length, frames: frames.length,
		overlaps, tooClose, outgrew, frameOverflow, framesOverlap: labelClipped, throughBoxes, crossings, labelOnBox, labelOnMarker, unevenRows, unevenColumns, mixedArrows, emptyGutter, labelSqueezed, labelOnLabel, labelCrossed, shortArrows, looseArrows: loose,
		aligned: +aligned.toFixed(2), sizeVariety: +sizeVariety.toFixed(2), gapEvenness: +cv(gaps).toFixed(2), lineEvenness: +mean(lineSpread).toFixed(2), lengthEvenness: +cv(lengths).toFixed(2), flow: +flow.toFixed(2),
		aspect: page ? +(page.w / page.h).toFixed(2) : 1, fitZoom: +fitZoom.toFixed(2), textAtFit: +(fitZoom * minFont).toFixed(1), large,
	}
}

/** One number for a diagram, out of 100. Hard faults cost most; the rest are matters of finish. */
export function scoreDiagram(m) {
	let score = 100
	const fault = (n, each, cap) => (score -= Math.min(cap, n * each))
	fault(m.overlaps, 12, 40); fault(m.frameOverflow, 8, 24); fault(m.framesOverlap, 8, 16); fault(m.outgrew, 3, 15)
	fault(m.throughBoxes, 6, 30); fault(m.crossings, 3, 15); fault(m.labelOnBox, 5, 20); fault(m.labelOnMarker, 3, 15); fault(m.labelOnLabel ?? 0, 5, 20); fault(m.labelCrossed ?? 0, 5, 20); fault(m.unevenRows, 1, 8); fault(m.unevenColumns ?? 0, 1, 8); fault(m.mixedArrows ?? 0, 2, 8); fault(m.emptyGutter ?? 0, 6, 6); fault(m.labelSqueezed, 3, 12); fault(m.tooClose, 2, 10); fault(m.shortArrows, 2, 8)
	score -= (1 - m.aligned) * 12
	if (m.arrows > 1) score -= (1 - m.flow) * 4
	if (m.textAtFit < 11 && !m.large) score -= (11 - m.textAtFit) * 3
	return Math.max(0, Math.round(score))
}
