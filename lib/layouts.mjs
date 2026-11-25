// Layouts: turn what a diagram says into where everything goes. Each kind takes a plain description and returns a toucan
// graph (lib/tg.mjs) with every box placed, so a template is data and a layout is a rule that can be tested. Boxes hold a short
// title, with anything longer in `detail`, which opens on click.

import ELK from 'elkjs/lib/elk.bundled.js'
import { boxFor, flowSides, sidesFor, sizedNode, snap, textHeight, fitWidth, SHAPE_ROOM, SIDES } from './boxes.mjs'
import { alongside, crossingsBetween, routePath } from './route.mjs'
import { STATUSES } from './status.mjs'
import { styleProblems } from './tg.mjs'

export { boxFor, sidesFor, textHeight }

const node = (n, box, group, extra = {}) => ({
	key: n.id,
	text: n.text,
	...(group && { group }),
	box,
	style: { color: n.color ?? 'black', fill: n.fill ?? 'semi', dash: n.dash ?? 'solid', geo: n.shape ?? 'rectangle', size: n.size ?? 's', ...extra },
	...((n.detail || n.meta) && { meta: { ...(n.detail && { detail: n.detail }), ...n.meta } }),
})
const edge = (from, to, { label, color = 'grey', dash = 'solid', route = 'straight', size, head, bend, labelAt, anchors } = {}) => ({
	key: `edge:${from}->${to}`,
	from,
	to,
	...(label && { label }),
	style: { color, dash, route, ...(size && { size }), ...(head && { head }), ...(bend && { bend }), ...(labelAt && { labelAt }), ...(anchors && { anchors }) },
})

// Where an arrow meets a box. Left to the engine, arrows aim at the centre and enter at odd angles; a diagram reads better
// when they leave and arrive at the middle of a side.
function anchorArrows(tg, mode = 'auto') {
	const boxes = new Map(tg.nodes.map((n) => [n.key, n.box]))
	const shapes = new Map(tg.nodes.map((n) => [n.key, n.style?.geo]))
	for (const e of tg.edges) {
		if (e.style.anchors) continue
		const a = boxes.get(e.from), b = boxes.get(e.to)
		if (!a || !b || a.w < 30 || b.w < 30) continue // dots and lifelines are too small to have sides
		// A cloud's outline isn't at its bounding box, so an arrow anchored there hangs in space.
		if (shapes.get(e.from) === 'cloud' || shapes.get(e.to) === 'cloud') continue
		e.style.anchors = sidesFor(a, b, mode)
	}
}
/** A key from a box's text: readable where it can be, and never empty or already taken. */
function uniqueId(text, taken) {
	const base = String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'box'
	let id = base
	for (let i = 2; taken.has(id); i++) id = `${base}-${i}`
	taken.add(id)
	return id
}

const graph = () => ({ tg: 1, groups: [], nodes: [], edges: [] })

// ---- flow: ELK's layered layout, for anything shaped like a directed graph ------------------------------------------------
/** Boxes and arrows as people and agents tend to write them, or a message saying what's wrong: ELK's own is no help. */
function normalizeFlow(spec) {
	if (!Array.isArray(spec.nodes) || !spec.nodes.length) throw new Error('a flow needs nodes, like { "kind": "flow", "nodes": [{ "id": "a", "text": "A" }, { "id": "b", "text": "B" }], "edges": [{ "from": "a", "to": "b" }] }')
	const taken = new Set(spec.nodes.flatMap((n) => [n.id, n.key]).filter((id) => id != null).map(String))
	for (const n of spec.nodes) {
		n.text ??= n.label ?? n.name ?? n.title
		n.id ??= n.key ?? uniqueId(n.text ?? 'box', taken)
		n.id = String(n.id)
	}
	const ids = new Set(spec.nodes.map((n) => n.id))
	for (const e of (spec.edges ??= [])) {
		e.from = String(e.from ?? e.source ?? '')
		e.to = String(e.to ?? e.target ?? '')
		for (const end of [e.from, e.to]) if (!ids.has(end) && !(spec.groups ?? []).some((g) => g.id === end)) throw new Error(`an edge goes from "${e.from}" to "${e.to}", but no node has the id "${end}"; ids here: ${[...ids].join(', ')}`)
	}
}

/** How wide a frame must be to show its whole name: tldraw sets it in a 12px label, with room either side. */
const frameNameWidth = (label) => (label ? String(label).length * 8 + 32 : 0)

/** A frame is at least as wide as its name, or the name is cut off: it widens round its boxes, and what lies to its right moves over. */
function widenForNames(tg) {
	for (const g of [...tg.groups].sort((a, b) => a.box.x - b.box.x)) {
		const extra = snap(frameNameWidth(g.label) - g.box.w)
		if (extra <= 0) continue
		const edge = g.box.x + g.box.w
		for (const item of [...tg.nodes, ...tg.groups]) {
			if (item === g) continue
			if (item.box.x >= edge) item.box.x += extra
			else if (item.group === g.key) item.box.x += snap(extra / 2)
		}
		g.box.w += extra
	}
}

/**
 * A flow of pieces with nothing between them (six state machines, each in a group) is laid out piece by piece and packed into rows
 * in the order they were written, like text, rather than left as the one long row ELK makes of them. A piece is a connected set of
 * top-level groups and loose boxes. `spec.columns` sets how many to a row; left out, the count that makes the whole closest to
 * `spec.aspect` (1.4) wide, and a single row stays a single row where that is already about right.
 */
async function flow(spec) {
	normalizeFlow(spec)
	const groupIds = new Set((spec.groups ?? []).map((g) => g.id))
	const unitOf = (id) => (groupIds.has(id) ? id : (spec.nodes.find((n) => n.id === id)?.group ?? id))
	const units = [...(spec.groups ?? []).map((g) => g.id), ...spec.nodes.filter((n) => !n.group).map((n) => n.id)]
	const parent = new Map(units.map((u) => [u, u]))
	const root = (u) => (parent.get(u) === u ? u : (parent.set(u, root(parent.get(u))), parent.get(u)))
	for (const e of spec.edges) parent.set(root(unitOf(e.from)), root(unitOf(e.to)))
	const pieces = [...new Set(units.map(root))].map((r) => units.filter((u) => root(u) === r))
	if (pieces.length < 2 || spec.keepSizes) return flowOne(spec)
	// A piece in the order of its first unit: groups and boxes were written in some order, and that is the reading order.
	const order = new Map(units.map((u, i) => [u, i]))
	pieces.sort((a, b) => order.get(a[0]) - order.get(b[0]))
	const laid = []
	for (const piece of pieces) {
		const inPiece = new Set(piece)
		const sub = {
			...spec,
			groups: (spec.groups ?? []).filter((g) => inPiece.has(g.id)),
			nodes: spec.nodes.filter((n) => inPiece.has(n.group ?? n.id)),
			edges: spec.edges.filter((e) => inPiece.has(unitOf(e.from))),
		}
		const tg = await flowOne(sub)
		const all = [...tg.nodes, ...tg.groups].map((x) => x.box)
		const x0 = Math.min(...all.map((b) => b.x)), y0 = Math.min(...all.map((b) => b.y))
		laid.push({ tg, x0, y0, w: Math.max(...all.map((b) => b.x + b.w)) - x0, h: Math.max(...all.map((b) => b.y + b.h)) - y0 })
	}
	const GAP = spec.pieceGap ?? 120
	const arrange = (cols) => {
		const rows = []
		laid.forEach((p, i) => (i % cols ? rows.at(-1).push(p) : rows.push([p])))
		const widths = Array.from({ length: cols }, (_, c) => Math.max(0, ...rows.map((r) => r[c]?.w ?? 0)))
		const heights = rows.map((r) => Math.max(...r.map((p) => p.h)))
		const width = widths.reduce((a, b) => a + b + GAP, -GAP), height = heights.reduce((a, b) => a + b + GAP, -GAP)
		return { rows, widths, heights, width, height }
	}
	const target = spec.aspect ?? 1.4
	let cols = Number.isInteger(spec.columns) && spec.columns > 0 ? Math.min(spec.columns, laid.length) : 0
	if (!cols) {
		let best = Infinity
		// Only counts that fill their rows evenly (six pieces: 6, 3, 2, 1 to a row), so the last row isn't a stray one or two.
		for (const c of new Set(Array.from({ length: laid.length }, (_, r) => Math.ceil(laid.length / (r + 1))))) {
			const a = arrange(c), miss = Math.abs(Math.log(a.width / a.height / target))
			if (miss < best - 1e-9) (best = miss), (cols = c)
		}
	}
	const { rows, widths, heights } = arrange(cols)
	const out = graph()
	let y = 0
	rows.forEach((row, r) => {
		let x = 0
		row.forEach((p, c) => {
			const dx = snap(x - p.x0), dy = snap(y - p.y0)
			const move = (item) => ({ ...item, box: { ...item.box, x: item.box.x + dx, y: item.box.y + dy } })
			out.groups.push(...p.tg.groups.map(move))
			out.nodes.push(...p.tg.nodes.map(move))
			out.edges.push(...p.tg.edges)
			x += widths[c] + GAP
		})
		y += heights[r] + GAP
	})
	const at = new Map(spec.edges.map((e, i) => [`edge:${e.from}->${e.to}`, i]))
	out.edges.sort((a, b) => (at.get(a.key) ?? 0) - (at.get(b.key) ?? 0))
	return out
}

async function flowOne(spec) {
	const elk = new ELK()
	const direction = spec.direction ?? 'DOWN'
	// `keepSizes`: the boxes already exist, at the sizes people gave them.
	const sizes = new Map(spec.nodes.map((n) => [n.id, spec.keepSizes ? { w: n.w, h: n.h } : sizedNode(n, spec.boxWidth ?? 200)]))
	// Boxes of a kind match, so a row reads as a row.
	const plain = spec.keepSizes ? [] : spec.nodes.filter((n) => !n.shape || n.shape === 'rectangle' || n.shape === 'oval')
	const plainH = Math.max(0, ...plain.map((n) => sizes.get(n.id).h))
	for (const n of plain) sizes.get(n.id).h = plainH
	// ...and in width too, when one needed only a little more for its longest word; a state with a very long name keeps its own.
	const plainW = Math.max(0, ...plain.map((n) => sizes.get(n.id).w))
	for (const n of plain) if (plainW - sizes.get(n.id).w <= 40) sizes.get(n.id).w = plainW
	// A loop back against the flow needs a lane to go round in, and an elbow can only go round the outside of its own two ends. So
	// it leaves and arrives on one side (the right, running down; the bottom, running across), and ELK keeps that side's lane clear and
	// puts the loop's ends at the edge of what the loop passes, where an elbow round them clears the rest.
	const vertical = direction === 'DOWN' || direction === 'UP'
	// (Not inside frames: there ELK can turn the chart round the loop instead, and the sides are then read from where things land.)
	const loops = spec.route === 'elbow' && !spec.groups?.length ? backEdges(spec) : new Set()
	const portSide = vertical ? 'EAST' : 'SOUTH'
	const portsOf = (id) => spec.edges.flatMap((e, i) => (loops.has(i) && (e.from === id || e.to === id) ? [{ id: `${id}~${i}`, layoutOptions: { 'elk.port.side': portSide } }] : []))
	const leaf = (n) => {
		const ports = portsOf(n.id)
		return { id: n.id, width: sizes.get(n.id).w, height: sizes.get(n.id).h, ...(ports.length && { ports, layoutOptions: { 'elk.portConstraints': 'FIXED_SIDE' } }) }
	}
	const groups = spec.groups ?? []
	const children = [
		...groups.map((g) => ({
			id: g.id,
			layoutOptions: { 'elk.padding': '[top=60,left=30,bottom=30,right=30]', 'elk.layered.spacing.nodeNodeBetweenLayers': String(spec.layerGap ?? 90), 'elk.spacing.nodeNode': String(spec.gap ?? 60) },
			children: spec.nodes.filter((n) => n.group === g.id).map(leaf),
		})),
		...spec.nodes.filter((n) => !n.group).map(leaf),
	]
	const result = await elk.layout({
		id: 'root',
		layoutOptions: {
			'elk.algorithm': 'layered',
			'elk.direction': direction,
			'elk.spacing.nodeNode': String(spec.gap ?? 60),
			'elk.layered.spacing.nodeNodeBetweenLayers': String(spec.layerGap ?? 90),
			'elk.spacing.edgeNode': '30',
			'elk.spacing.edgeLabel': '6',
			'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
			'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
			// A loop back shouldn't turn the chart around: the way in stays first, and the arrow that closes the loop runs backward.
			// "First" is the order the author wrote the boxes and groups in, so a cycle between groups breaks on the arrow written last
			// rather than on whichever the search happened to meet. (Only the cycle breaking follows the order: also asking ELK to keep nodes and edges
			// in model order within layers left d01 at 85 against 90, with twice the crossings, and made d03 no better.)
			'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
			'elk.layered.crossingMinimization.semiInteractive': 'false',
			'elk.separateConnectedComponents': 'false',
		},
		children,
		edges: spec.edges.map((e, i) => ({
			id: `e${i}`,
			sources: [loops.has(i) ? `${e.from}~${i}` : e.from],
			targets: [loops.has(i) ? `${e.to}~${i}` : e.to],
			// Across the page a label needs its width between the layers. Down it, it sits on its arrow in an ordinary gap: given to ELK,
			// it takes a layer of its own and stretches the chart until its text can't be read whole (roomForLabels makes the room
			// instead, on a chart without frames).
			...(e.label && !vertical && { labels: [{ text: e.label, width: e.label.length * 9 + 16, height: 24 }] }),
		})),
	})
	const tg = graph()
	const byId = new Map(spec.nodes.map((n) => [n.id, n]))
	const place = (item, dx, dy, group) => {
		const x = snap(dx + item.x), y = snap(dy + item.y)
		if (byId.has(item.id)) tg.nodes.push(node(byId.get(item.id), { x, y, w: item.width, h: item.height }, group))
		else {
			const g = groups.find((x2) => x2.id === item.id)
			tg.groups.push({ key: item.id, label: g.label, box: { x, y, w: snap(item.width), h: snap(item.height) } })
			for (const child of item.children ?? []) place(child, dx + item.x, dy + item.y, item.id)
		}
	}
	for (const item of result.children) place(item, 0, 0)
	if (vertical) {
		const before = new Map(tg.nodes.map((n) => [n.key, n.box.y]))
		roomForLabels(tg.nodes, spec.edges.filter((e) => e.label), spec.layerGap ?? 90)
		// A frame grows with what moved in it.
		for (const g of tg.groups) {
			const kids = tg.nodes.filter((n) => n.group === g.key)
			if (!kids.length) continue
			const top = Math.min(...kids.map((n) => n.box.y)) - 60, bottom = Math.max(...kids.map((n) => n.box.y + n.box.h)) + 30
			if (kids.some((n) => n.box.y !== before.get(n.key))) {
				g.box.y = snap(top)
				g.box.h = snap(bottom) - g.box.y
			}
		}
	}
	widenForNames(tg)
	const side = vertical ? SIDES.right : SIDES.bottom
	spec.edges.forEach((e, i) => tg.edges.push(edge(e.from, e.to, { label: e.label, dash: e.dash, color: e.color, route: spec.route ?? 'straight', ...(loops.has(i) && { anchors: { from: side, to: side } }) })))
	// Elbows go with the flow, out of the side it runs to, and a labelled fork's branches leave by their own sides (lib/boxes.mjs).
	if (spec.route === 'elbow' && !spec.anchors) {
		const boxes = new Map(tg.nodes.map((n) => [n.key, n.box]))
		const sides = flowSides(tg.edges, (k) => boxes.get(k), direction, { along: true })
		tg.edges.forEach((e, i) => {
			if (!e.style.anchors && sides[i] && boxes.get(e.from).w >= 30 && boxes.get(e.to).w >= 30) e.style.anchors = sides[i]
		})
	}
	anchorArrows(tg, spec.anchors)
	return tg
}

/**
 * Running down the page, a labelled arrow that turns on its way to the next row puts its label on the run it shares with the other
 * arrows there, where they cross it. Such a gap gets room for two runs, so the routing can give the label a run of its own
 * (app/tidy.js clearLabels), and a gap a label crosses is at least MIN_LABELLED_GAP. Rows of boxes are found by where they sit,
 * and everything below a gap that grows moves down with it.
 */
const MIN_LABELLED_GAP = 80
function roomForLabels(nodes, labelled, gap) {
	const bands = []
	for (const n of [...nodes].sort((a, b) => a.box.y - b.box.y)) {
		const last = bands.at(-1)
		if (last && n.box.y < last.y1) (last.y1 = Math.max(last.y1, n.box.y + n.box.h)), last.keys.add(n.key)
		else bands.push({ y1: n.box.y + n.box.h, keys: new Set([n.key]), nodes: [] })
		bands.at(-1).nodes.push(n)
	}
	const box = new Map(nodes.map((n) => [n.key, n.box]))
	const bandOf = (k) => bands.findIndex((b) => b.keys.has(k))
	let shift = 0
	bands.forEach((b, i) => {
		const across = labelled.filter((e) => Math.min(bandOf(e.from), bandOf(e.to)) === i - 1 && Math.max(bandOf(e.from), bandOf(e.to)) === i)
		const turns = across.some((e) => {
			const a = box.get(e.from), c = box.get(e.to)
			return Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x) < 40
		})
		if (turns) shift += Math.round(gap / 2 / 10) * 10
		// A label needs a line longer than itself to sit on: a tight chart's gaps open up where they carry one.
		else if (across.length && gap < MIN_LABELLED_GAP) shift += MIN_LABELLED_GAP - gap
		for (const n of b.nodes) n.box.y += shift
	})
}

/** The arrows that close a loop (as indexes into spec.edges): those back to a box still being followed, from the first box on. */
function backEdges(spec) {
	const out = new Set(), state = new Map()
	const visit = (id) => {
		state.set(id, 'open')
		spec.edges.forEach((e, i) => {
			if (e.from !== id || e.from === e.to) return
			if (state.get(e.to) === 'open') out.add(i)
			else if (!state.has(e.to)) visit(e.to)
		})
		state.set(id, 'done')
	}
	for (const n of spec.nodes) if (!state.has(n.id)) visit(n.id)
	return out
}

// ---- tree: a tidy top-down or left-right tree, where each parent centres over its children ----------------------------------
function tree(spec) {
	const horizontal = spec.direction === 'RIGHT'
	const W = spec.boxWidth ?? 180, GAP_ACROSS = spec.gap ?? 30, GAP_DOWN = spec.layerGap ?? 90
	const tg = graph()
	let cursor = 0
	// One height for every plain box, so a label that wraps doesn't make its box the odd one out.
	const plain = []
	const collect = (n) => {
		if (!SHAPE_ROOM[n.shape]) plain.push(n)
		n.children?.forEach(collect)
	}
	collect(spec.root)
	const tallest = Math.max(0, ...plain.map((n) => sizedNode(n, W).h))
	for (const n of plain) n.h ??= tallest
	// Two branches can each end in "Postgres", and those are two boxes.
	const ids = new Set()
	const claim = (n) => {
		if (n.id) ids.add(n.id)
		n.children?.forEach(claim)
	}
	claim(spec.root)
	const across = horizontal ? 'h' : 'w'
	// Leaves take the widest box's slot, so a wide diamond above a single leaf can't reach into its neighbour.
	const widest = (n) => Math.max(sizedNode(n, W)[across], ...(n.children ?? []).map(widest))
	const slot = widest(spec.root)
	const walk = (n, depth, parentId) => {
		n.id ??= uniqueId(n.text, ids)
		const size = sizedNode(n, W)
		let centre
		if (n.children?.length) {
			const spots = n.children.map((c) => walk(c, depth + 1, n.id))
			centre = (spots[0] + spots.at(-1)) / 2
		} else {
			centre = cursor + slot / 2
			cursor += slot + GAP_ACROSS
		}
		n._size = size
		n._centre = centre
		n._depth = depth
		if (parentId) tg.edges.push(edge(parentId, n.id, { label: n.edge, route: spec.route ?? 'straight', color: spec.edgeColor ?? 'grey', head: spec.head }))
		return centre
	}
	walk(spec.root, 0)
	const depths = []
	const scan = (n) => {
		depths[n._depth] = Math.max(depths[n._depth] ?? 0, horizontal ? n._size.w : n._size.h)
		n.children?.forEach(scan)
	}
	scan(spec.root)
	const offset = depths.reduce((list, d, i) => [...list, list[i] + d + GAP_DOWN], [0])
	const place = (n) => {
		const along = offset[n._depth]
		// A level's boxes match, so a generation reads as one.
		const size = horizontal ? { ...n._size, w: depths[n._depth] } : { ...n._size, h: depths[n._depth] }
		const box = horizontal
			? { x: along, y: snap(n._centre - size.h / 2), ...size }
			: { x: snap(n._centre - size.w / 2), y: along, ...size }
		tg.nodes.push(node({ color: spec.levelColors?.[n._depth], ...n }, box))
		n.children?.forEach(place)
	}
	place(spec.root)
	anchorArrows(tg, horizontal ? 'horizontal' : 'vertical')
	return tg
}

// ---- mindmap: a central idea, with branches balanced left and right ---------------------------------------------------------
function mindmap(spec) {
	const tg = graph()
	const W = 230, GAP = 22, LAYER = 300
	const ids = new Set([spec.root.id ?? 'root'])
	const colors = spec.colors ?? ['blue', 'orange', 'green', 'violet', 'red', 'light-blue', 'yellow', 'grey']
	// Every box at a depth is one height, so a label that wraps doesn't make its box the odd one out.
	const boxH = []
	const scan = (n, depth) => {
		boxH[depth] = Math.max(boxH[depth] ?? 0, boxFor(n.text, W).h)
		n.children?.forEach((c) => scan(c, depth + 1))
	}
	spec.root.children.forEach((b) => scan(b, 1))
	const height = (n, depth = 1) => (n.children?.length ? Math.max(boxH[depth], n.children.reduce((sum, c) => sum + height(c, depth + 1) + GAP, -GAP)) : boxH[depth])
	const branches = spec.root.children.map((b, i) => ({ ...b, color: b.color ?? colors[i % colors.length] }))
	// Balance by how tall each side gets.
	const sides = [[], []], totals = [0, 0]
	for (const b of [...branches].sort((a, c) => height(c) - height(a))) {
		const s = totals[0] <= totals[1] ? 0 : 1
		sides[s].push(b)
		totals[s] += height(b) + GAP * 2
	}
	const rootId = spec.root.id ?? 'root'
	const rootBox = { w: 280, h: 130 }
	tg.nodes.push(node({ id: rootId, text: spec.root.text, shape: 'ellipse', color: 'black', fill: 'none', size: 'l', detail: spec.root.detail }, { x: -rootBox.w / 2, y: -rootBox.h / 2, ...rootBox }))
	const lay = (n, depth, top, dir, parent, color) => {
		const id = n.id ?? uniqueId(`${parent} ${n.text}`, ids)
		const h = height(n, depth)
		const y = top + h / 2 - boxH[depth] / 2
		const x = dir > 0 ? rootBox.w / 2 + LAYER * depth - 120 : -rootBox.w / 2 - LAYER * depth + 120 - W
		tg.nodes.push(node({ ...n, id, color, fill: depth === 1 ? 'semi' : 'none' }, { x: snap(x), y: snap(y), w: W, h: boxH[depth] }))
		tg.edges.push(edge(parent, id, { color, head: 'none' }))
		let cy = top
		for (const c of n.children ?? []) {
			lay(c, depth + 1, cy, dir, id, color)
			cy += height(c, depth + 1) + GAP
		}
	}
	sides.forEach((list, s) => {
		const total = list.reduce((sum, b) => sum + height(b) + GAP * 2, -GAP * 2)
		let top = -total / 2
		for (const b of list) {
			lay(b, 1, top, s === 0 ? 1 : -1, rootId, b.color)
			top += height(b) + GAP * 2
		}
	})
	anchorArrows(tg, 'horizontal')
	return tg
}

// ---- lanes: swimlanes, with steps placed by lane and column ------------------------------------------------------------------
function lanes(spec) {
	const tg = graph()
	const W = spec.boxWidth ?? 180, COL = W + (spec.gap ?? 90), PAD = 40
	const cols = Math.max(...spec.steps.map((s) => s.col)) + 1
	let y = 0
	for (const lane of spec.lanes) {
		const steps = spec.steps.filter((s) => s.lane === lane.id)
		const tallest = Math.max(90, ...steps.filter((s) => !s.shape).map((s) => sizedNode(s, W).h))
		const roomy = Math.max(tallest, ...steps.map((s) => sizedNode(s, W).h))
		const h = roomy + 100
		tg.groups.push({ key: lane.id, label: lane.label, box: { x: 0, y, w: PAD * 2 + cols * COL - (COL - W), h } })
		for (const s of steps) {
			// Steps in a lane match, and a decision keeps its own shape.
			const size = s.shape ? sizedNode(s, W) : { w: W, h: tallest }
			tg.nodes.push(node({ color: lane.color, ...s }, { x: snap(PAD + s.col * COL + (W - size.w) / 2), y: snap(y + 60 + (roomy - size.h) / 2), ...size }, lane.id))
		}
		y += h + 60
	}
	for (const e of spec.edges) tg.edges.push(edge(e.from, e.to, { label: e.label, route: 'elbow', dash: e.dash }))
	anchorArrows(tg)
	return tg
}

// ---- grid: a table of cells, for journey maps, comparisons, responsibility charts ----------------------------------------------
function grid(spec) {
	const tg = graph()
	// A cell is as wide as the longest word in any of them needs, so none breaks inside its box.
	const wordsOf = (cells) => cells.map((c) => (typeof c === 'string' ? c : c?.text ?? ''))
	const W = spec.cellWidth ?? Math.max(210, ...wordsOf(spec.rows.flatMap((r) => r.cells)).map(fitWidth), ...wordsOf(spec.columns).map(fitWidth))
	const GAP = spec.gap ?? 18, LABEL_W = spec.labelWidth ?? Math.max(170, ...spec.rows.map((r) => fitWidth(r.label)))
	const colX = (c) => LABEL_W + GAP + c * (W + GAP)
	spec.columns.forEach((c, i) => tg.nodes.push(node({ id: `col-${i}`, text: c, fill: 'solid', color: spec.headerColor ?? 'black', size: 's', meta: { grid: true } }, { x: colX(i), y: 0, w: W, h: 60 })))
	let y = 60 + GAP
	spec.rows.forEach((row, r) => {
		const cells = row.cells.map((text) => (typeof text === 'string' ? { text } : text))
		const h = Math.max(70, ...cells.map((c) => boxFor(c.text, W).h), boxFor(row.label, LABEL_W).h)
		tg.nodes.push(node({ id: `row-${r}`, text: row.label, fill: 'none', dash: 'none', color: row.color ?? 'black', detail: row.detail, meta: { grid: true } }, { x: 0, y, w: LABEL_W, h }))
		cells.forEach((c, i) => {
			if (!c.text) return
			tg.nodes.push(node({ id: `cell-${r}-${i}`, color: c.color ?? row.color ?? 'grey', ...c, meta: { ...c.meta, grid: true } }, { x: colX(i), y, w: W, h }))
		})
		y += h + GAP
	})
	return tg
}

// ---- board: columns of cards ---------------------------------------------------------------------------------------------------
function board(spec) {
	const tg = graph()
	const W = 220, COL = W + 100, PAD = 30, GAP = 20
	// One card height across the board, so a title that wraps doesn't stand out.
	const cardH = Math.max(0, ...spec.columns.flatMap((c) => c.cards.map((card) => boxFor(card.text, W).h)))
	const tallest = Math.max(160, ...spec.columns.map((c) => c.cards.length * (cardH + GAP)))
	spec.columns.forEach((c, i) => {
		const key = `column-${i}`
		const x = i * COL
		tg.groups.push({ key, label: c.label, box: { x, y: 0, w: W + PAD * 2, h: tallest + 50 } })
		let y = PAD
		c.cards.forEach((card, n) => {
			tg.nodes.push(node({ id: `card-${i}-${n}`, color: c.color, ...card }, { x: x + PAD, y, w: W, h: cardH }, key))
			y += cardH + GAP
		})
	})
	return tg
}

// ---- quadrant: a 2x2 ---------------------------------------------------------------------------------------------------------------
function quadrant(spec) {
	const tg = graph()
	const CELL_W = 620, GAP = 40, ITEM = 200, PAD = 30, HEAD = 40
	const rowsOf = (q) => Math.ceil(q.items.length / 2)
	const itemH = (q) => Math.max(70, ...q.items.map((t) => boxFor(t.text ?? t, ITEM + 60).h))
	const cellH = (q) => HEAD + rowsOf(q) * (itemH(q) + 20) + PAD
	const rowH = [Math.max(cellH(spec.quadrants[0]), cellH(spec.quadrants[1])), Math.max(cellH(spec.quadrants[2]), cellH(spec.quadrants[3]))]
	spec.quadrants.forEach((q, i) => {
		const cx = i % 2, cy = i < 2 ? 0 : 1
		const x = 90 + cx * (CELL_W + GAP), y = cy * (rowH[0] + GAP + 30)
		const key = `quadrant-${i}`
		tg.groups.push({ key, label: q.label, box: { x, y, w: CELL_W, h: rowH[cy] } })
		q.items.forEach((item, n) => {
			const it = typeof item === 'string' ? { text: item } : item
			const col = n % 2, row = Math.floor(n / 2)
			tg.nodes.push(node({ id: `item-${i}-${n}`, color: q.color, ...it }, { x: x + PAD + col * (ITEM + 60 + 20), y: y + PAD + row * (itemH(q) + 20), w: ITEM + 60, h: itemH(q) }, key))
		})
	})
	const h = rowH[0] + rowH[1] + GAP + 30
	const width = CELL_W * 2 + GAP + 90
	tg.nodes.push(node({ id: 'axis-y', text: spec.yAxis, fill: 'none', dash: 'none', color: 'grey' }, { x: -150, y: snap(h / 2 - 90), w: 210, h: 180 }))
	tg.nodes.push(node({ id: 'axis-x', text: spec.xAxis, fill: 'none', dash: 'none', color: 'grey' }, { x: snap(width / 2 + 45 - 280), y: h + 30, w: 560, h: 64 }))
	return tg
}

// ---- timeline: dated stops along one line, with cards alternating above and below ----------------------------------------------
function timeline(spec) {
	const tg = graph()
	const W = 240, COL = 170, DOT = 40, ARM = 70
	const ids = spec.items.map((_, i) => `t${i}`)
	const heights = spec.items.map((it) => boxFor(`${it.when}\n${it.text}`, W).h)
	const tallest = Math.max(...heights)
	spec.items.forEach((it, i) => {
		const x = i * COL
		const above = i % 2 === 0
		tg.nodes.push(node({ id: `dot-${i}`, text: '', shape: 'ellipse', fill: 'solid', color: it.color ?? spec.color ?? 'blue' }, { x: x + W / 2 - DOT / 2, y: 0, w: DOT, h: DOT }))
		const h = heights[i]
		tg.nodes.push(node({ id: ids[i], text: `${it.when}\n${it.text}`, color: it.color ?? spec.color ?? 'blue', detail: it.detail }, { x, y: above ? -ARM - tallest + (tallest - h) : DOT + ARM, w: W, h }))
		tg.edges.push(edge(`dot-${i}`, ids[i], { color: it.color ?? spec.color ?? 'blue' }))
		if (i) tg.edges.push(edge(`dot-${i - 1}`, `dot-${i}`, { color: 'black' }))
	})
	return tg
}

// ---- gantt: bars along a scale, by lane -------------------------------------------------------------------------------------------
function gantt(spec) {
	const tg = graph()
	const UNIT = spec.unitWidth ?? 160, INSET = 20, BAR_H = 76, GAP = 14
	const units = spec.units
	units.forEach((u, i) => tg.nodes.push(node({ id: `unit-${i}`, text: u, fill: 'solid', color: 'black' }, { x: INSET + i * UNIT, y: 0, w: UNIT - 16, h: 56 })))
	let y = 100
	spec.lanes.forEach((lane, l) => {
		// Bars that overlap in time get their own row, packed greedily.
		const rows = []
		for (const bar of lane.bars) {
			const row = rows.find((r) => r.at(-1).end <= bar.start)
			if (row) row.push(bar)
			else rows.push([bar])
		}
		const h = Math.max(1, rows.length) * (BAR_H + GAP) + 70
		const key = `lane-${l}`
		tg.groups.push({ key, label: lane.label, box: { x: 0, y, w: INSET + units.length * UNIT + 4, h } })
		rows.forEach((row, r) =>
			row.forEach((bar, b) => {
				tg.nodes.push(node({ id: `bar-${l}-${r}-${b}`, color: lane.color, fill: 'solid', ...bar }, { x: INSET + bar.start * UNIT, y: y + 50 + r * (BAR_H + GAP), w: (bar.end - bar.start) * UNIT - 16, h: BAR_H }, key))
			}),
		)
		y += h + 60
	})
	return tg
}

// ---- sequence: who says what to whom, in order ----------------------------------------------------------------------------------
function sequence(spec) {
	const tg = graph()
	const COL = spec.columnGap ?? 300, ROW = spec.rowGap ?? 90, DOT = 12, LINE = 24
	const n = spec.participants.length
	const col = new Map(spec.participants.map((p, i) => [p.id, i]))
	// A participant is as wide as its longest word needs (a path or an id doesn't wrap), and its head as tall as its name.
	const W = spec.participants.map((p) => Math.max(spec.participantWidth ?? 190, fitWidth(p.text)))
	const HEAD = Math.max(70, ...spec.participants.map((p, i) => boxFor(p.text ?? '', W[i]).h))
	// The first gap a message crosses is where its label sits, so that gap is wide enough for the label on one line, up to a limit
	// (past it the label is longer than its arrow, and the row grows to hold the lines it would take if it wrapped).
	const labelW = (m) => String(m.text ?? '').length * 8.5 + 8 // tldraw sets an arrow's label on one line
	const gap = Array.from({ length: Math.max(0, n - 1) }, (_, i) => Math.max(COL, snap((W[i] + W[i + 1]) / 2 + 50)))
	for (const m of spec.messages) if (m.from !== m.to) gap[Math.min(col.get(m.from), col.get(m.to))] = Math.max(gap[Math.min(col.get(m.from), col.get(m.to))], snap(Math.min(labelW(m) / 0.8 + 20, 760)))
	const cx = [W[0] / 2]
	for (let i = 1; i < n; i++) cx.push(cx[i - 1] + gap[i - 1])
	// Rows are as tall as what is in them: a label that wraps, or a note beside a lifeline.
	const NOTE_W = 220
	const extent = spec.messages.map((m) => {
		if (m.from === m.to) return boxFor(m.text, NOTE_W, 56).h
		const room = gap[Math.min(col.get(m.from), col.get(m.to))] * 0.8
		return Math.ceil(labelW(m) / Math.max(60, room)) * LINE
	})
	const ys = []
	let y = HEAD + 50
	spec.messages.forEach((m, r) => {
		ys.push(y)
		y += Math.max(ROW, snap((extent[r] + (extent[r + 1] ?? extent[r])) / 2 + 36))
	})
	const bottom = (ys.at(-1) ?? HEAD + 50) + 60
	spec.participants.forEach((p, i) => {
		tg.nodes.push(node({ color: 'blue', ...p }, { x: snap(cx[i] - W[i] / 2), y: 0, w: W[i], h: HEAD }))
		tg.nodes.push(node({ id: `life-${p.id}`, text: '', fill: 'solid', color: 'grey' }, { x: snap(cx[i]) - 2, y: HEAD, w: 4, h: bottom - HEAD }))
	})
	spec.messages.forEach((m, r) => {
		const y = ys[r]
		const dot = (who, tag) => {
			const key = `m${r}-${tag}`
			tg.nodes.push(node({ id: key, text: '', shape: 'ellipse', fill: 'solid', color: 'black' }, { x: snap(cx[col.get(who)]) - DOT / 2, y: y - DOT / 2, w: DOT, h: DOT }))
			return key
		}
		const from = dot(m.from, 'a')
		// A message to oneself is shown as a note on the lifeline, centred on its row.
		if (m.from === m.to) {
			tg.nodes.push(node({ id: `m${r}-note`, text: m.text, fill: 'none', color: 'grey' }, { x: snap(cx[col.get(m.from)]) + 30, y: snap(y - extent[r] / 2), w: NOTE_W, h: extent[r] }))
			tg.edges.push(edge(from, `m${r}-note`, { color: 'grey', dash: 'dotted' }))
		} else {
			const to = dot(m.to, 'b')
			// On a long arrow, the label's middle would land on a lifeline in between: it sits in the first gap instead.
			const span = Math.abs(col.get(m.to) - col.get(m.from))
			tg.edges.push(edge(from, to, { label: m.text, color: 'black', dash: m.reply ? 'dashed' : 'solid', ...(span > 1 && { labelAt: +(0.5 / span).toFixed(3) }) }))
		}
	})
	return tg
}

// ---- fishbone: causes hanging off a spine, each with its items beside the bone rather than across it ------------------------
function fishbone(spec) {
	const tg = graph()
	const W = 200, BONE_GAP = 40, COL = W + BONE_GAP * 2 + 40, CAT_H = 64, ITEM_GAP = 14, ARM = 50
	const n = Math.ceil(spec.causes.length / 2)
	const itemH = (t) => boxFor(t, W).h
	const stackH = (c) => c.items.reduce((sum, t) => sum + itemH(t) + ITEM_GAP, 0)
	const reach = Math.max(...spec.causes.map(stackH)) + ARM
	const SPINE_Y = CAT_H + reach
	// One joint per column of bones: the bone runs straight down to it, with its items to the left.
	const jointX = (col) => col * COL + W + BONE_GAP
	for (let col = 0; col < n; col++) {
		tg.nodes.push(node({ id: `joint-${col}`, text: '', shape: 'ellipse', fill: 'solid', color: 'black' }, { x: jointX(col) - 8, y: SPINE_Y - 8, w: 16, h: 16 }))
		if (col) tg.edges.push(edge(`joint-${col - 1}`, `joint-${col}`, { color: 'black', size: 'm', head: 'none' }))
	}
	tg.nodes.push(node({ id: 'effect', text: spec.effect, fill: 'solid', color: 'red', detail: spec.detail }, { x: jointX(n - 1) + BONE_GAP + 40, y: SPINE_Y - 60, w: 260, h: 120 }))
	tg.edges.push(edge(`joint-${n - 1}`, 'effect', { color: 'black', size: 'm', anchors: { from: { x: 0.5, y: 0.5 }, to: SIDES.left } }))
	spec.causes.forEach((c, i) => {
		const col = Math.floor(i / 2), top = i % 2 === 0
		const color = c.color ?? 'blue'
		const key = `cause-${i}`
		const catY = top ? 0 : SPINE_Y * 2 - CAT_H
		tg.nodes.push(node({ id: key, text: c.label, fill: 'solid', color }, { x: jointX(col) - W / 2, y: catY, w: W, h: CAT_H }))
		tg.edges.push(edge(key, `joint-${col}`, { color, anchors: { from: top ? SIDES.bottom : SIDES.top, to: { x: 0.5, y: 0.5 } } }))
		let y = top ? CAT_H + ITEM_GAP + 6 : catY - stackH(c) - 6
		c.items.forEach((t, j) => {
			tg.nodes.push(node({ id: `item-${i}-${j}`, text: t, fill: 'none', dash: 'none', color }, { x: jointX(col) - W - 14, y, w: W, h: itemH(t) }))
			y += itemH(t) + ITEM_GAP
		})
	})
	return tg
}

// ---- funnel: stages narrowing downward -------------------------------------------------------------------------------------------
function funnel(spec) {
	const tg = graph()
	const WIDEST = 720, NARROWEST = 260, GAP = 84
	let y = 0
	const n = spec.stages.length
	spec.stages.forEach((s, i) => {
		const w = snap(WIDEST - (i * (WIDEST - NARROWEST)) / Math.max(1, n - 1))
		const h = Math.max(80, boxFor(s.text, w).h)
		tg.nodes.push(node({ id: `stage-${i}`, color: spec.color ?? 'blue', fill: 'semi', ...s }, { x: (WIDEST - w) / 2, y, w, h }))
		if (i) tg.edges.push(edge(`stage-${i - 1}`, `stage-${i}`, { color: 'grey', label: s.drop }))
		y += h + GAP
	})
	anchorArrows(tg, 'vertical')
	return tg
}

// ---- stack: horizontal tiers, for layered architectures ---------------------------------------------------------------------------
function stack(spec) {
	const tg = graph()
	const W = spec.boxWidth ?? 200, GAP = spec.gap ?? 40, PAD = 30, TIER_GAP = spec.tierGap ?? 90
	const widest = Math.max(...spec.tiers.map((t) => t.items.length))
	// A wide shape needs a wider slot than a plain box.
	const SLOT = Math.max(W, ...spec.tiers.flatMap((t) => t.items.map((i) => sizedNode(i, W).w)))
	const fullW = PAD * 2 + widest * SLOT + (widest - 1) * GAP
	let y = 0
	for (const tier of spec.tiers) {
		const h = Math.max(...tier.items.map((i) => sizedNode(i, W).h))
		const rowW = tier.items.length * SLOT + (tier.items.length - 1) * GAP
		tg.groups.push({ key: tier.id, label: tier.label, box: { x: 0, y, w: fullW, h: h + PAD * 2 } })
		tier.items.forEach((it, i) => {
			const size = { ...sizedNode(it, W), h }
			tg.nodes.push(node({ color: tier.color, ...it }, { x: snap((fullW - rowW) / 2 + i * (SLOT + GAP) + (SLOT - size.w) / 2), y: y + PAD, ...size }, tier.id))
		})
		y += h + PAD * 2 + TIER_GAP
	}
	for (const e of spec.edges ?? []) tg.edges.push(edge(e.from, e.to, { label: e.label, dash: e.dash }))
	anchorArrows(tg, 'vertical')
	return tg
}

// ---- cycle: stages around a ring ----------------------------------------------------------------------------------------------------
function cycle(spec) {
	const tg = graph()
	const n = spec.stages.length
	const W = 220, R = Math.max(240, (n * (W + 80)) / (2 * Math.PI))
	spec.stages.forEach((s, i) => {
		const a = (i / n) * 2 * Math.PI - Math.PI / 2
		const { h } = boxFor(s.text, W, 90)
		tg.nodes.push(node({ id: `stage-${i}`, color: spec.colors?.[i] ?? spec.color ?? 'blue', ...s }, { x: snap(R * Math.cos(a) * 1.25 - W / 2), y: snap(R * Math.sin(a) - h / 2), w: W, h }))
		tg.edges.push(edge(`stage-${i}`, `stage-${(i + 1) % n}`, { color: 'grey', bend: spec.bend ?? -70 }))
	})
	if (spec.centre) tg.nodes.push(node({ id: 'centre', text: spec.centre, fill: 'none', color: 'black', shape: 'ellipse' }, { x: -110, y: -60, w: 220, h: 120 }))
	return tg
}

// ---- map: a systems map. Columns of panels, each a frame of tiles, with states, a key, and arrows that go round panels --------
//
// For a picture of many named parts in a few systems: what there is, what state each part is in, and what feeds what. A panel is
// one system or team, and its tiles are packed in a grid so twenty parts fit where a flow chart would hold six. Arrows join
// panels (or tiles); one that skips a column or runs back travels in a lane above or below the picture, never through a panel in
// between, and the arrows on one side of a panel spread along it in the order of where they go, so they don't share a line.
//
// The form (panels of tiles in columns, a state on any part, a key made from what the picture uses, lanes round the outside)
// follows open-diagram by Luke Deasy (https://github.com/lukendeasy/open-diagram, MIT). No code of open-diagram is used.
function map(spec) {
	if (!Array.isArray(spec.columns) || !spec.columns.length || !spec.columns.every((c) => Array.isArray(c) && c.length)) throw new Error('a map needs columns, each a list of panels, like { "kind": "map", "columns": [[{ "id": "app", "title": "App", "tiles": ["Sign in", "Search"] }], [{ "id": "api", "title": "API", "tiles": ["Accounts"] }]], "links": [{ "from": "app", "to": "api" }] }')
	const tg = graph()
	const TILE_GAP = 14, PAD = 26, MIN_W = 150, MAX_W = 250, NOTE_H = 60, NOTE_GAP = 14
	const words = (text) => snap(String(text).length * 10.5 + 50) // a line of small text, with room to spare
	const ROW_GAP = spec.rowGap ?? 90
	const statuses = { ...STATUSES, ...spec.statuses }
	const used = new Set()
	const look = (status, where) => {
		if (status == null) return {}
		const s = statuses[status]
		if (!s) throw new Error(`${where} has the status "${status}", which isn't one of ${Object.keys(statuses).join(', ')}`)
		used.add(status)
		return { color: s.color, dash: s.dash, meta: { status } }
	}
	const taken = new Set(spec.columns.flat().flatMap((p) => [p.id, ...(p.tiles ?? []).map((t) => t?.id)]).filter((id) => id != null).map(String))
	// Measure every panel: its tiles share one size, wide enough for the longest name on a line where it can be.
	const panels = spec.columns.map((col, c) => col.map((p) => {
		if (!p || typeof p !== 'object' || !(p.title ?? p.label)) throw new Error(`a panel in column ${c + 1} has no title`)
		const title = String(p.title ?? p.label)
		const id = String(p.id ?? uniqueId(title, taken))
		const tiles = (p.tiles ?? []).map((t) => (typeof t === 'string' ? { text: t } : { ...t, text: t.text ?? t.label ?? t.name })).map((t) => {
			if (!t.text) throw new Error(`a tile in "${title}" has no text`)
			return { ...t, id: String(t.id ?? uniqueId(`${id} ${t.text}`, taken)) }
		})
		const cols = Math.max(1, Math.min(tiles.length || 1, p.cols ?? (tiles.length > 3 ? 2 : 1)))
		const longest = Math.max(0, ...tiles.map((t) => t.text.length))
		const tileW = Math.min(MAX_W, Math.max(MIN_W, snap(longest * 10.5 + 60)))
		return { ...p, id, title, tiles, cols, tileW, column: c }
	}))
	const flat = panels.flat()
	// Tiles are a gap apart, and where a panel has arrows between its own tiles the gap grows to hold them: across, as wide as the
	// longest label on one (or a stub long enough to read as an arrow); down, high enough for a label beside the arrow.
	const tileOwner = new Map(flat.flatMap((p) => p.tiles.map((t) => [t.id, p])))
	for (const p of flat) {
		p.gapX = TILE_GAP
		p.gapY = TILE_GAP
		const own = (spec.links ?? spec.edges ?? []).filter((l) => tileOwner.get(String(l.from ?? l.source)) === p && tileOwner.get(String(l.to ?? l.target)) === p)
		const index = new Map(p.tiles.map((t, i) => [t.id, i]))
		for (const l of own) {
			const a = index.get(String(l.from ?? l.source)), b = index.get(String(l.to ?? l.target))
			const label = String(l.label ?? '').length
			if (a % p.cols !== b % p.cols) p.gapX = Math.max(p.gapX, snap(Math.max(60, label * 9.5 + 40)))
			if (Math.floor(a / p.cols) !== Math.floor(b / p.cols)) p.gapY = Math.max(p.gapY, label ? 70 : 50)
		}
	}
	// The gap between columns holds the arrows across it and their labels: wide enough for the longest label on an arrow between
	// next-door columns to sit on one line. (A label on a lane has the whole width of the picture.)
	const columnOf = new Map(flat.flatMap((p) => [[p.id, p.column], ...p.tiles.map((t) => [t.id, p.column])]))
	const across = (spec.links ?? spec.edges ?? []).filter((l) => !l.lane && columnOf.get(String(l.to ?? l.target)) - columnOf.get(String(l.from ?? l.source)) === 1)
	const GAP = spec.gap ?? Math.max(150, Math.min(300, snap(Math.max(0, ...across.map((l) => String(l.label ?? '').length)) * 11 + 100)))
	if (new Set(flat.map((p) => p.id)).size !== flat.length) throw new Error(`two panels share an id: ${flat.map((p) => p.id).filter((id, i, all) => all.indexOf(id) !== i).join(', ')}`)
	// A column's panels are one width, and a narrower panel's tiles widen to fill it.
	const colW = panels.map((col) => Math.max(...col.map((p) => PAD * 2 + p.cols * p.tileW + (p.cols - 1) * p.gapX), ...col.map((p) => (p.sub || p.footer ? Math.min(560, Math.max(words(p.sub ?? ''), words(p.footer ?? ''))) + PAD * 2 : 0))))
	for (const p of flat) {
		p.w = colW[p.column]
		p.tileW = Math.floor((p.w - PAD * 2 - (p.cols - 1) * p.gapX) / p.cols)
		p.tileH = Math.max(0, ...p.tiles.map((t) => boxFor(t.text, p.tileW).h))
		const rows = Math.ceil(p.tiles.length / p.cols)
		const noteH = (text) => (text ? Math.max(NOTE_H, boxFor(String(text), p.w - PAD * 2, NOTE_H).h - 10) + NOTE_GAP : 0)
		p.subH = noteH(p.sub)
		p.footH = noteH(p.footer)
		p.bodyH = rows ? rows * p.tileH + (rows - 1) * p.gapY : 0
		p.h = PAD + p.subH + p.bodyH + p.footH + PAD
	}
	const colH = panels.map((col) => col.reduce((sum, p) => sum + p.h, 0) + ROW_GAP * (col.length - 1))
	const tallest = Math.max(...colH)
	const valign = spec.valign ?? 'top'
	if (!['top', 'center', 'bottom'].includes(valign)) throw new Error(`valign "${valign}" isn't one of top, center, bottom`)
	// The header: a title, the states the picture uses (each shown as it is drawn, with its word), and the steps.
	let headY = 0
	const head = (id, text, w, h, style, x = 0) => tg.nodes.push({ key: id, text, box: { x, y: headY, w, h }, style: { color: 'black', fill: 'none', dash: 'solid', geo: 'rectangle', size: 's', ...style }, meta: { heading: true } })
	if (spec.heading) {
		head('map-title', String(spec.heading), Math.max(200, snap(String(spec.heading).length * 12.5 + 50)), 80, { size: 'l', dash: 'none' })
		headY += 100
	}
	const body = () => {
		let x = 0
		panels.forEach((col, c) => {
			let y = headY + (valign === 'top' ? 0 : valign === 'center' ? (tallest - colH[c]) / 2 : tallest - colH[c])
			for (const p of col) {
				p.x = snap(x)
				p.y = snap(y)
				y += p.h + ROW_GAP
			}
			x += colW[c] + GAP
		})
	}
	// Panels and tiles are styled first, so the key knows which states are in use.
	const panelLooks = new Map(flat.map((p) => [p.id, look(p.status, `the panel "${p.title}"`)]))
	const tileLooks = new Map(flat.flatMap((p) => p.tiles.map((t) => [t.id, look(t.status, `the tile "${t.text}"`)])))
	const links = (spec.links ?? spec.edges ?? []).map((l) => ({ ...l, from: String(l.from ?? l.source ?? ''), to: String(l.to ?? l.target ?? ''), planned: l.kind === 'planned' || l.dash === 'dotted' }))
	const legend = spec.legend !== false && (used.size > 0 || links.some((l) => l.planned))
	if (legend) {
		let x = 0
		// "Live" is in the key only when another state is: it's what an unmarked part means.
		const shown = Object.keys(statuses).filter((k) => used.has(k) || (k === 'live' && used.size))
		for (const k of shown) {
			const w = words(statuses[k].label)
			head(`map-key-${k}`, statuses[k].label, w, 60, { color: statuses[k].color, dash: statuses[k].dash, fill: 'semi' }, x)
			x += w + 16
		}
		if (links.some((l) => l.planned)) {
			const text = 'Dotted arrow: still to build'
			head('map-key-dotted', text, words(text), 60, { dash: 'none', color: 'grey' }, x)
		}
		headY += 80
	}
	if (spec.steps?.length) {
		const text = `${spec.stepsLabel ?? 'Steps'}: ${spec.steps.map((s) => (Array.isArray(s) ? `${s[0]}. ${s[1]}` : `${s.n ?? s.step}. ${s.text}`)).join('   ')}`
		head('map-steps', text, words(text), 60, { dash: 'none' })
		headY += 80
	}
	if (headY) headY += 40
	body()
	for (const p of flat) {
		const pl = panelLooks.get(p.id)
		const word = p.status && p.status !== 'live' ? ` (${statuses[p.status].label.toLowerCase()})` : ''
		tg.groups.push({ key: p.id, label: `${p.step != null ? `${p.step} · ` : ''}${p.title}${word}`, box: { x: p.x, y: p.y, w: p.w, h: p.h }, meta: { panel: true, ...pl.meta, ...(p.detail && { detail: p.detail }) } })
		const note = (key, text, y, h) => tg.nodes.push({ key, text: String(text), group: p.id, box: { x: p.x + PAD, y, w: p.w - PAD * 2, h }, style: { color: 'grey', fill: 'none', dash: 'none', geo: 'rectangle', size: 's' }, meta: { borderless: true } })
		if (p.sub) note(`${p.id}-sub`, p.sub, p.y + PAD, p.subH - NOTE_GAP)
		p.tiles.forEach((t, i) => {
			const tl = tileLooks.get(t.id)
			const { id, text, status, label, name, ...rest } = t
			const base = { color: pl.color ?? 'black', dash: pl.dash ?? 'solid', ...(tl.color && { color: tl.color, dash: tl.dash }) }
			tg.nodes.push(node({ ...base, fill: base.color === 'black' ? 'none' : 'semi', ...rest, id, text, meta: { ...rest.meta, ...pl.meta, ...tl.meta } }, { x: p.x + PAD + (i % p.cols) * (p.tileW + p.gapX), y: p.y + PAD + p.subH + Math.floor(i / p.cols) * (p.tileH + p.gapY), w: p.tileW, h: p.tileH }, p.id))
		})
		if (p.footer) note(`${p.id}-footer`, p.footer, p.y + p.h - PAD - (p.footH - NOTE_GAP), p.footH - NOTE_GAP)
	}
	mapLinks(tg, flat, links)
	return tg
}

/**
 * A map's arrows. Next-door columns join across the gap between them, and a panel joins the one under it straight down. Anything else
 * (a column skipped, or back against the reading direction) goes round the outside: out of the top of both ends or the bottom of
 * both, whichever is clear, so it never runs through a panel between. Arrows on one side of a panel spread along it, in the order
 * of where they go, and those crossing one gap turn at different places across it, in the order that crosses least.
 */
function mapLinks(tg, panels, links) {
	const panelOf = new Map(panels.map((p) => [p.id, p]))
	for (const p of panels) for (const t of p.tiles) panelOf.set(t.id, p)
	const boxOf = new Map([...tg.groups, ...tg.nodes].map((n) => [n.key, n.box]))
	const cy = (b) => b.y + b.h / 2, cx = (b) => b.x + b.w / 2
	const top = Math.min(...panels.map((p) => p.y)), bottom = Math.max(...panels.map((p) => p.y + p.h))
	const middle = (top + bottom) / 2
	const lanes = { top: 0, bottom: 0 }
	const plan = links.map((l) => {
		for (const end of [l.from, l.to]) if (!panelOf.has(end)) throw new Error(`a link goes from "${l.from}" to "${l.to}", but nothing has the id "${end}"; panels here: ${panels.map((p) => p.id).join(', ')}`)
		const a = boxOf.get(l.from), b = boxOf.get(l.to), pa = panelOf.get(l.from), pb = panelOf.get(l.to)
		const step = pb.column - pa.column
		let sides
		if (l.lane && !['top', 'bottom'].includes(l.lane)) throw new Error(`a link's lane is "${l.lane}", which isn't top or bottom`)
		if (!l.lane && step === 1) sides = ['right', 'left']
		else if (!l.lane && step === 0 && pa !== pb) sides = cy(b) > cy(a) ? ['bottom', 'top'] : ['top', 'bottom']
		else if (!l.lane && pa === pb) sides = cx(b) > cx(a) ? ['right', 'left'] : cx(b) < cx(a) ? ['left', 'right'] : cy(b) > cy(a) ? ['bottom', 'top'] : ['top', 'bottom']
		else {
			// A lane is clear when nothing between the two ends reaches further out than they do.
			const lo = Math.min(a.x, b.x), hi = Math.max(a.x + a.w, b.x + b.w)
			const between = panels.filter((p) => p !== pa && p !== pb && p.x < hi && p.x + p.w > lo)
			const clear = { top: !between.some((p) => p.y < Math.min(a.y, b.y) - 1) && !panels.some((p) => (p.column === pa.column && p.y < a.y - 1) || (p.column === pb.column && p.y < b.y - 1)), bottom: !between.some((p) => p.y + p.h > Math.max(a.y + a.h, b.y + b.h) + 1) && !panels.some((p) => (p.column === pa.column && p.y > a.y + 1) || (p.column === pb.column && p.y > b.y + 1)) }
			const near = (cy(a) + cy(b)) / 2 > middle ? 'bottom' : 'top', far = near === 'top' ? 'bottom' : 'top'
			// Two arrows can't share a lane (they'd be one line). When the top is taken and only a taller column between keeps the bottom
			// from being clear, the two end panels grow down to that column's foot, and the bottom lane opens.
			const foot = Math.max(a.y + a.h, b.y + b.h, ...between.map((p) => p.y + p.h))
			const last = (p, box) => box === boxOf.get(p.id) && !panels.some((q) => q.column === p.column && q.y > p.y + 1)
			if (!l.lane && !clear.bottom && lanes.top && clear.top && last(pa, a) && last(pb, b)) {
				for (const [p, box] of [[pa, a], [pb, b]]) {
					const more = foot - (box.y + box.h)
					if (more <= 0) continue
					box.h += more
					p.h += more
					const footer = boxOf.get(`${p.id}-footer`)
					if (footer) footer.y += more
				}
				clear.bottom = true
			}
			// Where it's asked to go; else the side its ends are nearer, unless only the other is clear or this one is already in use.
			const lane = l.lane ?? (clear[near] && (!lanes[near] || !clear[far] || lanes[far]) ? near : clear[far] ? far : clear[near] ? near : null)
			if (lane) (lanes[lane]++, (sides = [lane, lane]))
			else sides = step > 0 ? ['right', 'left'] : ['left', 'right'] // routed round what's in its way when it's drawn (lib/route.mjs)
		}
		return { l, a, b, sides, at: [null, null], gap: !l.lane && step === 1 ? pa.column : null }
	})
	// Spread the ends that share a side of a box, in the order of where they go, so two arrows never leave or arrive on one line.
	const ends = new Map()
	plan.forEach((p, i) => [0, 1].forEach((e) => {
		const key = `${e ? p.l.to : p.l.from}|${p.sides[e]}`
		;(ends.get(key) ?? ends.set(key, []).get(key)).push({ i, e })
	}))
	for (const [key, list] of ends) {
		const side = key.slice(key.lastIndexOf('|') + 1), across = side === 'left' || side === 'right'
		const own = (x) => (x.e ? plan[x.i].b : plan[x.i].a), other = (x) => (x.e ? plan[x.i].a : plan[x.i].b)
		list.sort((p, q) => (across ? cy(other(p)) - cy(other(q)) : cx(other(p)) - cx(other(q))) || p.i - q.i)
		const box = own(list[0]), length = across ? box.h : box.w
		const step = Math.min(length / (list.length + 1), 44)
		list.forEach((x, k) => {
			const t = +(0.5 + ((k - (list.length - 1) / 2) * step) / length).toFixed(3)
			plan[x.i].at[x.e] = side === 'left' ? { x: 0, y: t } : side === 'right' ? { x: 1, y: t } : side === 'top' ? { x: t, y: 0 } : { x: t, y: 1 }
		})
	}
	// Arrows across one gap turn at different places, in whichever order crosses least (every order is tried while there are few).
	const path = (p, elbowMid) => routePath(p.a, p.b, { kind: 'elbow', anchors: { from: p.at[0], to: p.at[1] }, elbowMid }).points
	const mids = plan.map(() => 0.5)
	for (const gap of new Set(plan.map((p) => p.gap).filter((g) => g != null))) {
		const here = plan.map((p, i) => i).filter((i) => plan[i].gap === gap && Math.abs(plan[i].a.y + plan[i].a.h * plan[i].at[0].y - (plan[i].b.y + plan[i].b.h * plan[i].at[1].y)) > 1)
		if (here.length < 2) continue
		const slots = here.map((_, k) => +((k + 1) / (here.length + 1)).toFixed(3))
		const orders = here.length <= 5 ? permutations(here) : [[...here].sort((p, q) => cy(plan[p].a) - cy(plan[q].a))]
		let best = null
		for (const order of orders) {
			const paths = order.map((i, k) => path(plan[i], slots[k]))
			let cost = 0
			// A crossing costs most; two arrows running along one line for a stretch read as one, so that costs too.
			for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) cost += 1000 * crossingsBetween(paths[i], paths[j]) + alongside(paths[i], paths[j], 4)
			if (!best || cost < best.cost) best = { cost, order }
		}
		best.order.forEach((i, k) => (mids[i] = slots[k]))
	}
	// A label on a lane over the top sits clear of the panels' names, which are just under it: past a name, or over a gap.
	const names = new Map(tg.groups.map((g) => [g.key, String(g.label ?? '').length * 7 + 16]))
	const labelAt = (p) => {
		if (!p.l.label || p.sides[0] !== 'top' || p.sides[1] !== 'top') return undefined
		const pts = path(p, 0.5), x0 = pts[0].x, x1 = pts.at(-1).x, run = Math.abs(x1 - x0), rise = Math.abs(pts[1].y - pts[0].y)
		const half = (String(p.l.label).length * 9.5 + 24) / 2
		const under = panels.filter((q) => q.y < Math.min(p.a.y, p.b.y) + 60).sort((q, r) => q.x - r.x)
		const free = under.map((q, k) => [q.x + names.get(q.id), (under[k + 1]?.x ?? Infinity) - 8]).map(([lo, hi]) => [Math.max(lo, Math.min(x0, x1) + 20) + half, Math.min(hi, Math.max(x0, x1) - 20) - half]).filter(([lo, hi]) => hi >= lo)
		if (!free.length || run < 1) return undefined
		const mid = (x0 + x1) / 2
		const spot = free.map(([lo, hi]) => Math.max(lo, Math.min(hi, mid))).sort((u, v) => Math.abs(u - mid) - Math.abs(v - mid))[0]
		return +Math.max(0.05, Math.min(0.95, (rise + Math.abs(spot - x0)) / (run + rise * 2))).toFixed(3)
	}
	plan.forEach((p) => tg.edges.push(edge(p.l.from, p.l.to, { label: p.l.label, color: p.l.color ?? 'grey', dash: p.l.planned ? 'dotted' : p.l.dash === 'dashed' ? 'dashed' : 'solid', route: 'elbow', anchors: { from: p.at[0], to: p.at[1] }, labelAt: labelAt(p) })))
	plan.forEach((p, i) => mids[i] !== 0.5 && (tg.edges[tg.edges.length - plan.length + i].style.elbowMid = mids[i]))
}
const permutations = (list) => (list.length <= 1 ? [list] : list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [x, ...rest])))

export const LAYOUTS = { flow, tree, mindmap, lanes, grid, board, quadrant, timeline, gantt, sequence, fishbone, funnel, stack, cycle, map }

/** Every id the author gave in a spec: a key a layout generates (col-0, map-title) is not among them. */
export function authoredKeys(spec) {
	const out = new Set()
	const walk = (v) => {
		if (Array.isArray(v)) v.forEach(walk)
		else if (v && typeof v === 'object') {
			for (const [k, x] of Object.entries(v)) {
				if ((k === 'id' || k === 'key') && (typeof x === 'string' || typeof x === 'number')) out.add(String(x))
				else walk(x)
			}
		}
	}
	walk(spec)
	return out
}

/** Gives keys new names, and every reference to them (a box's frame, an arrow's ends) follows. `rename` maps old key to new. */
function renameKeys(tg, rename) {
	const to = (k) => rename.get(k) ?? k
	for (const n of [...tg.nodes, ...tg.groups]) {
		n.key = to(n.key)
		if (n.group) n.group = to(n.group)
		if (n.parent) n.parent = to(n.parent)
	}
	for (const e of tg.edges) {
		e.from = to(e.from)
		e.to = to(e.to)
		if (e.key) e.key = `edge:${e.from}->${e.to}`
	}
}

/**
 * Puts a new drawing clear of what's on the canvas, and with keys that don't take anyone's place. Layouts number the boxes they
 * name themselves (stage-0, col-0, map-title), so a second funnel has the same keys as the first, and it must not overwrite it.
 *   - `prefix`: every key takes it, the author's included, so two grids or maps on one canvas never meet.
 *   - On a clash, only the keys the layout made up (not among `authored`) take a `dN-` prefix, so a section's own ids stay
 *     stable. If a key the author gave clashes too, the drawing can't be told from a new version of what's there, and the whole
 *     drawing takes the prefix instead. `draw --update` doesn't come here.
 * The prefix applied is returned, so the caller can say so.
 */
export function placeBeside(tg, { keys = [], boxes = [], prefix: given, authored } = {}) {
	const taken = new Set(keys)
	const own = () => [...tg.nodes, ...tg.groups]
	if (given) renameKeys(tg, new Map(own().map((n) => [n.key, given + n.key])))
	let prefix = given || null
	const clash = own().filter((n) => taken.has(n.key))
	if (clash.length) {
		// Whether the author wrote a key (not knowing means they did: the whole drawing is moved aside, as it always was).
		const wrote = (n) => !authored || authored.has(given ? n.key.slice(given.length) : n.key)
		const onlyMade = !clash.some(wrote)
		let p
		for (let i = 2; !p; i++) if (!own().some((n) => taken.has(`d${i}-${n.key}`))) p = `d${i}-`
		renameKeys(tg, new Map((onlyMade ? clash : own()).map((n) => [n.key, p + n.key])))
		prefix = p
	}
	if (boxes.length) {
		const right = Math.max(...boxes.map((b) => b.x + b.w)), top = Math.min(...boxes.map((b) => b.y))
		for (const n of own()) (n.box.x += right + 120), (n.box.y += top)
	}
	return { tg, prefix }
}

/** Moves a whole drawing by (dx, dy). */
export function shift(tg, dx, dy) {
	for (const n of [...tg.nodes, ...tg.groups]) (n.box.x += dx), (n.box.y += dy)
	return tg
}

/** Moves a drawing so its top left is at (x, y). */
export function moveTo(tg, x, y) {
	const all = [...tg.nodes, ...tg.groups].map((n) => n.box)
	return shift(tg, x - Math.min(...all.map((b) => b.x)), y - Math.min(...all.map((b) => b.y)))
}

/**
 * Wraps a drawing in one titled frame named `key`. What had no frame goes inside it, and so do the frames it had. The title
 * is the frame's name (tldraw shows it above the frame), widened to hold it whole.
 */
export function frameDrawing(tg, { key, title }) {
	const all = [...tg.nodes, ...tg.groups].map((n) => n.box)
	const PAD = 40, TOP = 70
	const x = Math.min(...all.map((b) => b.x)) - PAD, y = Math.min(...all.map((b) => b.y)) - TOP
	const w = Math.max(Math.max(...all.map((b) => b.x + b.w)) + PAD - x, frameNameWidth(title ?? key))
	const h = Math.max(...all.map((b) => b.y + b.h)) + PAD - y
	if ([...tg.nodes, ...tg.groups].some((n) => n.key === key)) throw new Error(`"${key}" names a box in this drawing, so it can't also be the frame round it`)
	for (const n of tg.nodes) n.group ??= key
	for (const g of tg.groups) g.parent ??= key
	tg.groups.unshift({ key, label: title ?? key, box: { x, y, w, h }, meta: { section: true } })
	return tg
}

/**
 * What `toucan draw` does with a laid-out drawing before it goes on the canvas. `existing` is what's there ([{ key, box }]).
 *   - A new drawing goes beside what's there, with keys that take nobody's place (see placeBeside). A `frame` that is already
 *     there is an error: that would be a redraw.
 *   - An `update` is a new version of what's there, and stays where it is: moved so its top left is where the shapes it replaces
 *     have theirs, or into the frame that holds the section. A drawing with none of the old one's keys goes beside it instead.
 *   - A `frame` ({ key, title }) wraps the result in a titled frame, and its key is exactly what was asked for.
 * Returns the drawing and the prefix that was put on keys, if any.
 */
export function placeDrawing(tg, { spec, existing = [], update = false, prefix, frame } = {}) {
	const at = new Map(existing.filter((n) => n.box).map((n) => [n.key, n.box]))
	const keys = [...at.keys()], boxes = [...at.values()]
	let placed
	if (update) {
		placed = placeBeside(tg, { prefix })
		const mine = [...tg.nodes, ...tg.groups].filter((n) => at.has(n.key))
		if (mine.length) shift(tg, Math.min(...mine.map((n) => at.get(n.key).x)) - Math.min(...mine.map((n) => n.box.x)), Math.min(...mine.map((n) => at.get(n.key).y)) - Math.min(...mine.map((n) => n.box.y)))
		else if (frame && at.has(frame.key)) moveTo(tg, at.get(frame.key).x + 40, at.get(frame.key).y + 70)
		else placed = placeBeside(tg, { keys, boxes })
	} else {
		if (frame && at.has(frame.key)) throw new Error(`"${frame.key}" is already on the canvas: use --update to redraw it there, or pick another --frame`)
		placed = placeBeside(tg, { keys, boxes, prefix, authored: spec && authoredKeys(spec) })
	}
	if (frame) frameDrawing(tg, { key: frame.key, title: frame.title ?? spec?.title })
	return placed
}

/** A template or any diagram description, placed. Moves it so its top left is at the origin. */
export async function layOut(spec) {
	const make = LAYOUTS[spec.kind]
	if (!make) throw new Error(`no layout called ${spec.kind}: one of ${Object.keys(LAYOUTS).join(', ')}`)
	let tg
	try {
		tg = await make(structuredClone(spec))
	} catch (e) {
		throw new Error(`can't lay out this ${spec.kind}: ${e.message}. To see the form, run \`toucan templates\`, then \`toucan templates show ID\` for one of kind ${spec.kind}.`)
	}
	// tldraw refuses a shape with a style it doesn't have (and reloads the editor when it does), so say so here, by name.
	const bad = [...tg.nodes, ...tg.edges].flatMap((x) => styleProblems(x.style).map((p) => ({ ...p, key: x.key })))
	if (bad.length) {
		const field = (f) => (f === 'geo' ? 'shape' : f)
		const lines = bad.map((p) => `${p.key}: ${field(p.field)} "${p.value}" isn't one of ${p.allowed.join(', ')}`)
		throw new Error(`can't draw this ${spec.kind}: ${[...new Set(lines)].join('; ')}`)
	}
	const boxes = [...tg.nodes.map((n) => n.box), ...tg.groups.map((g) => g.box)]
	const dx = Math.min(...boxes.map((b) => b.x)), dy = Math.min(...boxes.map((b) => b.y))
	for (const b of boxes) (b.x = Math.round(b.x - dx)), (b.y = Math.round(b.y - dy))
	return tg
}

/**
 * A starter (templates/index.mjs STARTERS): several blocks on one canvas, each under its own heading. Every part is laid out
 * by its own rule, its keys take the part's id as a prefix so parts can't collide, and the parts go in rows, left to right
 * in reading order, wrapping when a row would get too wide. Headings are borderless boxes, which both engines draw.
 */
export async function compose(starter, { rowWidth = 3000, gap = 200 } = {}) {
	const out = { tg: 1, groups: [], nodes: [], edges: [] }
	let x = 0, y = 0, rowH = 0
	for (const part of starter.parts) {
		const tg = await layOut(part.spec)
		const p = (k) => `${part.id}-${k}`
		const items = [...tg.groups, ...tg.nodes]
		const minX = Math.min(...items.map((i) => i.box.x)), minY = Math.min(...items.map((i) => i.box.y))
		const w = Math.max(...items.map((i) => i.box.x + i.box.w)) - minX, h = Math.max(...items.map((i) => i.box.y + i.box.h)) - minY
		const span = Math.max(w, Math.max(160, part.title.length * 17 + 60))
		if (x > 0 && x + span > rowWidth) (x = 0), (y += rowH + gap), (rowH = 0)
		// A heading on one line, sized to its words, with room below it for any frame names in the part.
		const HEAD = 130
		const dx = x - minX, dy = y + HEAD - minY
		// Snug to its words, so its centred text sits at the part's left edge; tall enough for large type and its padding.
		const headW = Math.max(160, part.title.length * 17 + 60)
		out.nodes.push({ key: p('heading'), text: part.title, box: { x, y, w: headW, h: 80 }, style: { color: 'black', fill: 'none', dash: 'none', geo: 'rectangle', size: 'l' }, meta: { heading: true } })
		for (const g of tg.groups) out.groups.push({ ...g, key: p(g.key), ...(g.parent && { parent: p(g.parent) }), box: { ...g.box, x: g.box.x + dx, y: g.box.y + dy } })
		for (const n of tg.nodes) out.nodes.push({ ...n, key: p(n.key), ...(n.group && { group: p(n.group) }), box: { ...n.box, x: n.box.x + dx, y: n.box.y + dy } })
		for (const e of tg.edges) out.edges.push({ ...e, from: p(e.from), to: p(e.to), ...(e.key && { key: `edge:${p(e.from)}->${p(e.to)}` }) })
		// A heading can be wider than a narrow part: the next part clears both.
		x += Math.max(w, headW) + gap
		rowH = Math.max(rowH, h + HEAD)
	}
	return out
}
