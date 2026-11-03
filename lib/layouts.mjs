// Layouts: turn what a diagram says into where everything goes. Each kind takes a plain description and returns a toucan
// graph (lib/tg.mjs) with every box placed, so a template is data and a layout is a rule that can be tested. Boxes hold a short
// title, with anything longer in `detail`, which opens on click.

import ELK from 'elkjs/lib/elk.bundled.js'
import { boxFor, sidesFor, sizedNode, snap, textHeight, SHAPE_ROOM, SIDES } from './boxes.mjs'

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
const graph = () => ({ tg: 1, groups: [], nodes: [], edges: [] })

// ---- flow: ELK's layered layout, for anything shaped like a directed graph ------------------------------------------------
async function flow(spec) {
	const elk = new ELK()
	const direction = spec.direction ?? 'DOWN'
	const sizes = new Map(spec.nodes.map((n) => [n.id, sizedNode(n, spec.boxWidth ?? 200)]))
	// Boxes of a kind match, so a row reads as a row.
	const plain = spec.nodes.filter((n) => !n.shape || n.shape === 'rectangle' || n.shape === 'oval')
	const plainH = Math.max(0, ...plain.map((n) => sizes.get(n.id).h))
	for (const n of plain) sizes.get(n.id).h = plainH
	const leaf = (n) => ({ id: n.id, width: sizes.get(n.id).w, height: sizes.get(n.id).h })
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
			'elk.layered.crossingMinimization.semiInteractive': 'false',
			'elk.separateConnectedComponents': 'false',
		},
		children,
		edges: spec.edges.map((e, i) => ({
			id: `e${i}`,
			sources: [e.from],
			targets: [e.to],
			...(e.label && { labels: [{ text: e.label, width: e.label.length * 9 + 16, height: 24 }] }),
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
	for (const e of spec.edges) tg.edges.push(edge(e.from, e.to, { label: e.label, dash: e.dash, color: e.color, route: spec.route ?? 'straight' }))
	anchorArrows(tg, spec.anchors)
	return tg
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
	const walk = (n, depth, parentId) => {
		n.id ??= n.text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
		const size = sizedNode(n, W)
		const across = horizontal ? 'h' : 'w'
		let centre
		if (n.children?.length) {
			const spots = n.children.map((c) => walk(c, depth + 1, n.id))
			centre = (spots[0] + spots.at(-1)) / 2
		} else {
			centre = cursor + size[across] / 2
			cursor += size[across] + GAP_ACROSS
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
	const leafId = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
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
		const id = n.id ?? `${parent}-${leafId(n.text)}`
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
	const W = spec.cellWidth ?? 210, GAP = spec.gap ?? 18, LABEL_W = spec.labelWidth ?? 170
	const colX = (c) => LABEL_W + GAP + c * (W + GAP)
	spec.columns.forEach((c, i) => tg.nodes.push(node({ id: `col-${i}`, text: c, fill: 'solid', color: spec.headerColor ?? 'black', size: 's' }, { x: colX(i), y: 0, w: W, h: 60 })))
	let y = 60 + GAP
	spec.rows.forEach((row, r) => {
		const cells = row.cells.map((text) => (typeof text === 'string' ? { text } : text))
		const h = Math.max(70, ...cells.map((c) => boxFor(c.text, W).h), boxFor(row.label, LABEL_W).h)
		tg.nodes.push(node({ id: `row-${r}`, text: row.label, fill: 'none', dash: 'none', color: row.color ?? 'black', detail: row.detail }, { x: 0, y, w: LABEL_W, h }))
		cells.forEach((c, i) => {
			if (!c.text) return
			tg.nodes.push(node({ id: `cell-${r}-${i}`, color: c.color ?? row.color ?? 'grey', ...c }, { x: colX(i), y, w: W, h }))
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
	const COL = spec.columnGap ?? 300, W = 190, HEAD = 70, ROW = spec.rowGap ?? 90, DOT = 12
	const col = new Map(spec.participants.map((p, i) => [p.id, i]))
	const bottom = HEAD + 60 + spec.messages.length * ROW
	spec.participants.forEach((p, i) => {
		const x = i * COL
		tg.nodes.push(node({ color: 'blue', ...p }, { x, y: 0, w: W, h: HEAD }))
		tg.nodes.push(node({ id: `life-${p.id}`, text: '', fill: 'solid', color: 'grey' }, { x: x + W / 2 - 2, y: HEAD, w: 4, h: bottom - HEAD }))
	})
	spec.messages.forEach((m, r) => {
		const y = HEAD + 50 + r * ROW
		const dot = (who, tag) => {
			const key = `m${r}-${tag}`
			tg.nodes.push(node({ id: key, text: '', shape: 'ellipse', fill: 'solid', color: 'black' }, { x: col.get(who) * COL + W / 2 - DOT / 2, y: y - DOT / 2, w: DOT, h: DOT }))
			return key
		}
		const from = dot(m.from, 'a')
		// A message to oneself is shown as a note on the lifeline.
		if (m.from === m.to) {
			tg.nodes.push(node({ id: `m${r}-note`, text: m.text, fill: 'none', color: 'grey' }, { x: col.get(m.from) * COL + W / 2 + 30, y: y - 28, w: 220, h: boxFor(m.text, 220, 56).h }))
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
	const fullW = PAD * 2 + widest * W + (widest - 1) * GAP
	let y = 0
	for (const tier of spec.tiers) {
		const h = Math.max(...tier.items.map((i) => sizedNode(i, W).h))
		const rowW = tier.items.length * W + (tier.items.length - 1) * GAP
		tg.groups.push({ key: tier.id, label: tier.label, box: { x: 0, y, w: fullW, h: h + PAD * 2 } })
		tier.items.forEach((it, i) => {
			const size = { ...sizedNode(it, W), h }
			tg.nodes.push(node({ color: tier.color, ...it }, { x: snap((fullW - rowW) / 2 + i * (W + GAP) + (W - size.w) / 2), y: y + PAD, ...size }, tier.id))
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

export const LAYOUTS = { flow, tree, mindmap, lanes, grid, board, quadrant, timeline, gantt, sequence, fishbone, funnel, stack, cycle }

/** Moves a new drawing clear of what's on the canvas. Anything it shares with the canvas is an update, and stays put. */
export function placeBeside(tg, { keys = [], boxes = [] }) {
	const taken = new Set(keys)
	const own = [...tg.nodes, ...tg.groups]
	if (!boxes.length || own.some((n) => taken.has(n.key))) return tg
	const right = Math.max(...boxes.map((b) => b.x + b.w)), top = Math.min(...boxes.map((b) => b.y))
	for (const n of own) (n.box.x += right + 120), (n.box.y += top)
	return tg
}

/** A template or any diagram description, placed. Moves it so its top left is at the origin. */
export async function layOut(spec) {
	const make = LAYOUTS[spec.kind]
	if (!make) throw new Error(`no layout called ${spec.kind}: one of ${Object.keys(LAYOUTS).join(', ')}`)
	const tg = await make(structuredClone(spec))
	const boxes = [...tg.nodes.map((n) => n.box), ...tg.groups.map((g) => g.box)]
	const dx = Math.min(...boxes.map((b) => b.x)), dy = Math.min(...boxes.map((b) => b.y))
	for (const b of boxes) (b.x = Math.round(b.x - dx)), (b.y = Math.round(b.y - dy))
	return tg
}
