// Checks for lib/layouts.mjs and templates/: every template lays out the same way twice, with sound geometry. How good each one
// looks is the eval's job (scripts/eval-diagrams.mjs); this catches what's plainly broken, with no browser.
//   node scripts/layouts-check.mjs
import assert from 'node:assert/strict'
import ELK from 'elkjs/lib/elk.bundled.js'
import { layOut, textHeight } from '../lib/layouts.mjs'
import { TEMPLATES } from '../templates/index.mjs'
import { STYLE_VALUES } from '../lib/tg.mjs'
import * as schema from '@tldraw/tlschema'

// What draw checks against is tldraw's own list, so a tldraw upgrade that adds or drops a value shows up here.
const theirs = { geo: schema.GeoShapeGeoStyle, color: schema.DefaultColorStyle, fill: schema.DefaultFillStyle, dash: schema.DefaultDashStyle, size: schema.DefaultSizeStyle }
for (const [field, prop] of Object.entries(theirs)) assert.deepEqual([...STYLE_VALUES[field]].sort(), [...prop.values].sort(), `STYLE_VALUES.${field} matches tldraw's`)
// A shape or colour tldraw doesn't have is refused by name, before it can reach a canvas.
await assert.rejects(layOut({ kind: 'flow', nodes: [{ id: 'db', text: 'Store', shape: 'cylinder' }, { id: 'x', text: 'X', color: 'teal' }], edges: [] }), /db: shape "cylinder" isn't one of cloud, rectangle.*x: color "teal" isn't one of black/)
console.log('ok  layouts: style values are tldraw\'s, and anything else is refused by name')
assert.ok(TEMPLATES.length >= 20, 'a real roster')
assert.equal(new Set(TEMPLATES.map((t) => t.id)).size, TEMPLATES.length, 'ids are unique')
assert.ok(textHeight('a '.repeat(80), 200) > textHeight('a', 200), 'more text is taller')
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
for (const t of TEMPLATES) {
	assert.ok(t.use && t.title && t.format, `${t.id}: says what it's for`)
	const tg = await layOut(t)
	assert.deepEqual(await layOut(t), tg, `${t.id}: deterministic`)
	const keys = [...tg.nodes, ...tg.groups].map((n) => n.key)
	assert.equal(new Set(keys).size, keys.length, `${t.id}: keys are unique: ${keys.filter((k, i) => keys.indexOf(k) !== i)}`)
	for (const e of tg.edges) assert.ok(keys.includes(e.from) && keys.includes(e.to), `${t.id}: ${e.key} joins real boxes`)
	assert.equal(new Set(tg.edges.map((e) => e.key)).size, tg.edges.length, `${t.id}: no arrow defined twice`)
	for (const n of tg.nodes) {
		assert.ok(Number.isFinite(n.box.x + n.box.y + n.box.w + n.box.h), `${t.id}: ${n.key} has a place`)
		if (n.group) {
			const g = tg.groups.find((x) => x.key === n.group), b = n.box
			assert.ok(b.x >= g.box.x && b.y >= g.box.y && b.x + b.w <= g.box.x + g.box.w && b.y + b.h <= g.box.y + g.box.h, `${t.id}: ${n.key} is inside ${g.key}`)
		}
	}
	const solid = tg.nodes.filter((n) => n.text)
	for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) assert.ok(!overlaps(solid[i].box, solid[j].box), `${t.id}: ${solid[i].key} overlaps ${solid[j].key}`)
}
console.log(`ok  layouts: ${TEMPLATES.length} templates`)

// ---- what the review found ---------------------------------------------------------------------------------------------------
{
	const { layOut: draw, placeBeside } = await import('../lib/layouts.mjs')
	const { fromTldraw } = await import('../lib/tg.mjs')
	const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

	// A second drawing of the same kind can't take the first one's keys.
	const funnel = await draw({ kind: 'funnel', stages: [{ text: 'C' }, { text: 'D' }] })
	const first = funnel.nodes.map((n) => n.key)
	const { prefix } = placeBeside(funnel, { keys: first, boxes: [{ x: 0, y: 0, w: 500, h: 100 }] })
	assert.ok(prefix && funnel.nodes.every((n) => !first.includes(n.key) && n.box.x >= 500), 'second funnel overwrote the first')
	for (const e of funnel.edges) assert.ok(funnel.nodes.some((n) => n.key === e.from) && funnel.nodes.some((n) => n.key === e.to), 'renamed drawing lost its arrows')

	// Repeated and non-Latin labels are separate boxes.
	const same = await draw({ kind: 'tree', root: { text: 'q', children: [{ text: 'a', children: [{ text: 'Postgres' }] }, { text: 'b', children: [{ text: 'Postgres' }] }] } })
	assert.equal(new Set(same.nodes.map((n) => n.key)).size, same.nodes.length, 'tree: repeated label collapsed into one box')
	const cjk = await draw({ kind: 'tree', root: { text: '日本語', children: [{ text: '東京' }, { text: '大阪' }] } })
	assert.equal(new Set(cjk.nodes.map((n) => n.key)).size, 3, 'tree: non-Latin labels collapsed')
	assert.equal(cjk.edges.length, 2, 'tree: non-Latin labels lost their arrows')
	const cjkMap = await draw({ kind: 'mindmap', root: { text: '日本', children: [{ text: '東京', children: [{ text: '渋谷' }, { text: '新宿' }] }] } })
	assert.equal(new Set(cjkMap.nodes.map((n) => n.key)).size, 4, 'mindmap: non-Latin labels collapsed')

	// A wide shape doesn't reach into its neighbour.
	const wide = await draw({ kind: 'tree', root: { text: 'r', children: [{ text: 'one', shape: 'diamond', children: [{ text: 'x' }] }, { text: 'two', shape: 'diamond', children: [{ text: 'y' }] }] } })
	for (const a of wide.nodes) for (const b of wide.nodes) if (a !== b) assert.ok(!overlap(a.box, b.box), `tree: ${a.key} overlaps ${b.key}`)
	const tiers = await draw({ kind: 'stack', tiers: [{ id: 't', label: 'T', items: [{ id: 'a', text: 'a', shape: 'diamond' }, { id: 'b', text: 'b', shape: 'diamond' }] }] })
	const [da, db] = tiers.nodes
	assert.ok(!overlap(da.box, db.box), 'stack: wide shapes overlap')

	// Laying out what's already there doesn't resize it, however many times.
	const again = await draw({ kind: 'flow', keepSizes: true, nodes: [{ id: 'a', text: 'a', shape: 'diamond', w: 200, h: 120 }, { id: 'b', text: 'b', w: 200, h: 300 }, { id: 'c', text: 'c', w: 200, h: 64 }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }] })
	assert.deepEqual(again.nodes.map((n) => [n.key, n.box.w, n.box.h]).sort(), [['a', 200, 120], ['b', 200, 300], ['c', 200, 64]])

	// A duplicate keeps its own key; a copied canvas keeps its type size.
	const shape = (id, key) => ({ typeName: 'shape', id, type: 'geo', parentId: 'page:1', x: 0, y: 0, index: 'a1', meta: { key }, props: { w: 10, h: 10, geo: 'rectangle', color: 'black', fill: 'none', dash: 'solid', size: 's', richText: { type: 'doc', content: [] } } })
	const tg = fromTldraw([{ typeName: 'page', id: 'page:1', index: 'a1', name: 'p' }, shape('shape:zzz', 'box'), shape('shape:box', 'box')])
	assert.deepEqual(tg.nodes.map((n) => n.key).sort(), ['box', 'zzz'], 'a duplicate took the original key')
	assert.equal(tg.nodes[0].style.size, 's', 'a copy lost its type size')
	console.log('ok  layouts: keys, wide shapes, sizes')
}

// What an import adds lands under what it connects to, and off to the side when it connects to nothing.
{
	const { layoutMissing } = await import('../lib/tg.mjs')
	const elk = new ELK()
	const existing = { groups: [], nodes: [{ key: 'a', box: { x: 0, y: 0, w: 200, h: 60 } }, { key: 'far', box: { x: 2000, y: 0, w: 200, h: 60 } }], edges: [] }
	const near = await layoutMissing({ groups: [], nodes: [{ key: 'b', text: 'b' }], edges: [{ from: 'a', to: 'b' }] }, { existing, elk })
	const b = near.nodes[0].box
	assert.ok(Math.abs(b.x) <= 20 && b.y >= 160, `connected box landed at ${JSON.stringify(b)}`)
	const apart = await layoutMissing({ groups: [], nodes: [{ key: 'c', text: 'c' }], edges: [] }, { existing, elk })
	assert.ok(apart.nodes[0].box.x > 2200, 'unconnected box should go beside everything')
	console.log('ok  layouts: where an import lands')
}

// A loop back up a flow goes round what's between, not through it: an elbow can only go round its own two ends, so the layout puts
// the loop's ends at the edge of what it passes and sends it out of that side; and where an arrow would still run through a box, the
// shared routing (lib/route.mjs) finds one that doesn't, as each engine draws it.
{
	const { routePath, runsThrough, chooseRoute, routeGraph, sampleCurve } = await import('../lib/route.mjs')
	const { toExcalidrawElements } = await import('../lib/tg.mjs')
	const spec = {
		kind: 'flow', direction: 'DOWN', route: 'elbow',
		nodes: [['ask', 'You ask'], ['read', 'Agent reads the canvas'], ['cli', 'Agent runs a command'], ['open', 'Canvas open in a tab?', 'diamond'], ['tab', 'Runs in your tab'], ['headless', 'Runs in a headless page'], ['others', 'Other tabs update'], ['store', 'Server saves it'], ['check', 'Agent checks the result'], ['review', 'You review it']].map(([id, text, shape]) => ({ id, text, ...(shape && { shape }) })),
		edges: [['ask', 'read'], ['read', 'cli', 'plans'], ['cli', 'open'], ['open', 'tab', 'yes'], ['open', 'headless', 'no'], ['tab', 'others'], ['tab', 'store'], ['headless', 'store'], ['tab', 'check', 'result'], ['headless', 'check', 'result'], ['check', 'read', 'revise'], ['check', 'review', 'done']].map(([from, to, label]) => ({ from, to, ...(label && { label }) })),
	}
	const tg = await layOut(spec)
	const box = (k) => ({ ...tg.nodes.find((n) => n.key === k).box, geo: tg.nodes.find((n) => n.key === k).style.geo })
	const loop = tg.edges.find((e) => e.from === 'check' && e.to === 'read')
	assert.deepEqual(loop.style.anchors, { from: { x: 1, y: 0.5 }, to: { x: 1, y: 0.5 } }, 'a loop down the page leaves and arrives on the right')
	const span = tg.nodes.filter((n) => !['check', 'read'].includes(n.key) && n.box.y > box('read').y && n.box.y < box('check').y)
	const reach = Math.max(box('check').x + box('check').w, box('read').x + box('read').w)
	assert.ok(span.every((n) => n.box.x + n.box.w < reach + 20), `the loop's ends are at the edge of what it passes: ${span.filter((n) => n.box.x + n.box.w >= reach + 20).map((n) => n.key)}`)
	const drawn = routePath(box('check'), box('read'), { kind: 'elbow', anchors: loop.style.anchors })
	const others = tg.nodes.filter((n) => n.key !== 'check' && n.key !== 'read')
	assert.deepEqual(others.filter((n) => runsThrough(drawn.points, n.box)).map((n) => n.key), [], 'the loop goes round, through no box')
	// Running down the page, labels ride on their arrows: no layer of their own stretching the chart.
	const rows = new Set(tg.nodes.map((n) => n.box.y)).size
	assert.ok(rows <= 8, `${rows} rows for 8 steps down`)

	// The routing itself: a loop up a column whose middle sticks out on the right can't go round on the right, and goes up the left.
	const col = [{ x: 0, y: 0, w: 200, h: 100 }, { x: 0, y: 200, w: 400, h: 100 }, { x: 0, y: 400, w: 200, h: 100 }]
	const tryRoute = (route) => {
		const r = routePath(col[2], col[0], route)
		return r.curve ? sampleCurve(r.points) : r.points
	}
	const right = { kind: 'elbow', anchors: { from: { x: 1, y: 0.5 }, to: { x: 1, y: 0.5 } } }
	assert.ok(runsThrough(tryRoute(right), col[1]), 'round the right runs through the wide box')
	const best = chooseRoute({ current: right, tryRoute, obstacles: [col[1]] })
	assert.equal(best?.blocked, 0, 'a route round is found')
	assert.deepEqual([best.route.kind, best.route.anchors.from.x, best.route.anchors.to.x], ['elbow', 0, 0], 'it goes up the left, still an elbow')
	// A clear arrow is left as it is.
	assert.equal(chooseRoute({ current: right, tryRoute, obstacles: [] }), null, 'nothing in the way, nothing changed')

	// Before drawing (an Excalidraw canvas made on the server has no tab to check it in), a graph's arrows are routed the same way,
	// and drawn as routed.
	const graph = { tg: 1, groups: [], nodes: col.map((b, i) => ({ key: `n${i}`, text: `n${i}`, box: b, style: { geo: 'rectangle' } })), edges: [{ key: 'edge:n2->n0', from: 'n2', to: 'n0', style: { route: 'elbow', anchors: right.anchors } }] }
	const els = toExcalidrawElements(graph)
	const arrow = els.find((e) => e.type === 'arrow')
	const pts = arrow.points.map(([x, y]) => ({ x: arrow.x + x, y: arrow.y + y }))
	assert.ok(arrow.elbowed && !runsThrough(pts, col[1]), 'Excalidraw draws the elbow round the wide box')
	assert.equal(graph.edges[0].style.anchors.from.x, 1, 'the graph given is left as it was')
	assert.equal(routeGraph(graph), 1, 'routeGraph reroutes it in place')
	console.log('ok  layouts: a loop goes round what it passes, and arrows go round boxes in their way')
}

// A map: panels of tiles in columns, with states, a key made from what's used, and arrows that go round panels (the form follows
// open-diagram by Luke Deasy, https://github.com/lukendeasy/open-diagram).
{
	const { routePath, runsThrough, routeGraph } = await import('../lib/route.mjs')
	const { STATUSES } = await import('../lib/status.mjs')
	const { toExcalidrawElements } = await import('../lib/tg.mjs')
	const spec = {
		kind: 'map', heading: 'Shop',
		columns: [
			[{ id: 'in', title: 'Orders in', footer: 'Owner: Sales', tiles: ['Web', 'App', { text: 'Phone', status: 'retiring' }] }],
			[{ id: 'core', title: 'Core', step: 1, status: 'building', tiles: [{ id: 'pay', text: 'Payments' }, 'Stock', 'Refunds', 'Fraud checks'] }, { id: 'data', title: 'Data', tiles: ['Ledger'] }],
			[{ id: 'out', title: 'Out', tiles: ['Couriers', { text: 'Lockers', status: 'planned' }] }],
		],
		links: [{ from: 'in', to: 'core' }, { from: 'core', to: 'data' }, { from: 'core', to: 'out', kind: 'planned' }, { from: 'in', to: 'out', label: 'direct' }, { from: 'out', to: 'in', label: 'returns' }],
	}
	const tg = await layOut(spec)
	const group = (k) => tg.groups.find((g) => g.key === k), nodeOf = (k) => tg.nodes.find((n) => n.key === k), edgeOf = (from, to) => tg.edges.find((e) => e.from === from && e.to === to)
	assert.ok(tg.groups.every((g) => g.meta.panel === true), 'every panel says it is one')
	assert.equal(group('core').label, '1 · Core (being built)', 'a panel\'s name carries its step and its state, in words')
	assert.equal(group('core').meta.status, 'building')
	// A state is a colour, a line and a word, and a tile takes its panel's unless it has its own.
	assert.deepEqual([nodeOf('pay').style.color, nodeOf('pay').style.dash, nodeOf('pay').meta.status], ['orange', 'dashed', 'building'], 'a tile in a panel being built is drawn as being built')
	assert.deepEqual([nodeOf('in-phone').style.color, nodeOf('in-phone').meta.status], [STATUSES.retiring.color, 'retiring'])
	assert.equal(nodeOf('in-web').meta?.status, undefined, 'an unmarked tile has no state')
	// The key lists the states the picture uses (and live, which is what unmarked means), and nothing it doesn't.
	assert.deepEqual(tg.nodes.filter((n) => n.key.startsWith('map-key-')).map((n) => n.key), ['map-key-live', 'map-key-building', 'map-key-planned', 'map-key-retiring', 'map-key-dotted'], 'the key is made from what is used')
	assert.equal((await layOut({ kind: 'map', columns: [[{ title: 'A', tiles: ['x'] }], [{ title: 'B', tiles: ['y'] }]], links: [{ from: 'a', to: 'b' }] })).nodes.filter((n) => n.key.startsWith('map-')).length, 0, 'no states, no key')
	// Four tiles pack two across, and a column's panels are one width.
	assert.equal(new Set(tg.nodes.filter((n) => n.group === 'core').map((n) => n.box.x)).size, 2, 'four tiles are packed two across')
	assert.equal(group('core').box.w, group('data').box.w, 'a column\'s panels are one width')
	// Next door joins across the gap, a panel joins the one under it straight down, and anything else goes round the outside.
	assert.deepEqual([edgeOf('in', 'core').style.anchors.from.x, edgeOf('in', 'core').style.anchors.to.x], [1, 0])
	assert.deepEqual([edgeOf('core', 'data').style.anchors.from.y, edgeOf('core', 'data').style.anchors.to.y], [1, 0])
	assert.equal(edgeOf('core', 'out').style.dash, 'dotted', 'a planned link is dotted')
	const lanes = [edgeOf('in', 'out'), edgeOf('out', 'in')].map((e) => [e.style.anchors.from.y, e.style.anchors.to.y])
	assert.ok(lanes.every(([a, b]) => a === b && (a === 0 || a === 1)), `a link past a column, or back, leaves and arrives by the top or the bottom: ${JSON.stringify(lanes)}`)
	assert.notEqual(lanes[0][0], lanes[1][0], 'two lanes take a side each')
	for (const e of tg.edges) {
		const drawn = routePath(group(e.from).box, group(e.to).box, { kind: 'elbow', anchors: e.style.anchors, elbowMid: e.style.elbowMid })
		const others = tg.groups.filter((g) => g.key !== e.from && g.key !== e.to)
		assert.deepEqual(others.filter((g) => runsThrough(drawn.points, g.box)).map((g) => g.key), [], `${e.key} runs through no panel`)
	}
	// Two arrows on one side of a panel don't share a point.
	const ends = tg.edges.flatMap((e) => [`${e.from} ${JSON.stringify(e.style.anchors.from)}`, `${e.to} ${JSON.stringify(e.style.anchors.to)}`])
	assert.equal(new Set(ends).size, ends.length, 'every arrow has its own place on a side')
	assert.equal(routeGraph(structuredClone(tg)), 0, 'drawn clear, so nothing needs rerouting')
	// A panel is in an arrow's way: a graph that sends one through a panel has it sent round, and Excalidraw draws arrows to frames.
	const through = structuredClone(tg)
	through.edges = [{ key: 'edge:in->out', from: 'in', to: 'out', style: { route: 'elbow', anchors: { from: { x: 1, y: 0.2 }, to: { x: 0, y: 0.2 } } } }]
	assert.equal(routeGraph(through), 1, 'an arrow through a panel is rerouted')
	const ex = toExcalidrawElements(tg)
	assert.equal(ex.filter((e) => e.type === 'arrow').length, tg.edges.length, 'Excalidraw draws every arrow between panels')
	// Mistakes are named.
	await assert.rejects(layOut({ kind: 'map', columns: [[{ title: 'A', tiles: [{ text: 'x', status: 'soon' }] }]] }), /the tile "x" has the status "soon", which isn't one of live, building, trial, planned, retiring/)
	await assert.rejects(layOut({ kind: 'map', columns: [[{ title: 'A', tiles: ['x'] }]], links: [{ from: 'a', to: 'zzz' }] }), /nothing has the id "zzz"; panels here: a/)
	await assert.rejects(layOut({ kind: 'map' }), /a map needs columns/)
	console.log('ok  layouts: a map packs tiles, shows states with a key, and sends arrows round panels')
}

// A flow written loosely still draws, and one that can't be drawn says why.
{
	const loose = await layOut({ kind: 'flow', nodes: [{ key: 'a', label: 'A' }, { name: 'The B' }], edges: [{ source: 'a', target: 'the-b' }] })
	assert.deepEqual(loose.nodes.map((n) => [n.key, n.text]), [['a', 'A'], ['the-b', 'The B']])
	assert.equal(loose.edges.length, 1)
	await assert.rejects(layOut({ kind: 'flow', nodes: [{ id: 'a', text: 'A' }], edges: [{ from: 'a', to: 'zzz' }] }), /no node has the id "zzz"/)
	await assert.rejects(layOut({ kind: 'flow' }), /a flow needs nodes/)
	await assert.rejects(layOut({ kind: 'tree' }), /templates show/)
	console.log('ok  layouts: forgiving about form, clear about errors')
}

// Every picture the tour was given made it onto the page: a stray quote in a caption turns an image into text.
{
	const { readFileSync } = await import('node:fs')
	const tour = readFileSync(new URL('../website/content/tour.md', import.meta.url), 'utf8')
	for (const line of tour.split('\n').filter((l) => l.startsWith('!['))) {
		assert.match(line, /^!\[[^\]]*\]\(assets\/tour\/[a-z-]+\.png( "[^"]*")?\)$/, `tour image won't render: ${line.slice(0, 90)}`)
	}
	console.log('ok  docs: tour images')
}

// Starters: several blocks on one canvas, with no key shared between parts and no arrow left loose.
{
	const { compose } = await import('../lib/layouts.mjs')
	const { STARTERS, GROUPS, TEMPLATES: ALL } = await import('../templates/index.mjs')
	assert.ok(ALL.every((t) => GROUPS.some((g) => g.id === t.group)), 'every block is in a group')
	for (const s of STARTERS) {
		const tg = await compose(s)
		const keys = [...tg.nodes, ...tg.groups].map((i) => i.key)
		assert.equal(new Set(keys).size, keys.length, `${s.id}: keys are unique across its parts`)
		for (const e of tg.edges) assert.ok(keys.includes(e.from) && keys.includes(e.to), `${s.id}: ${e.from} -> ${e.to} joins two of its boxes`)
		const boxes = [...tg.nodes, ...tg.groups].filter((i) => !i.group && !i.parent).map((i) => i.box)
		for (const part of s.parts) assert.ok(tg.nodes.some((n) => n.key === `${part.id}-heading` && n.text === part.title), `${s.id}: ${part.id} has its heading`)
		assert.ok(boxes.length, `${s.id} has something to show`)
	}
	console.log(`ok  layouts: ${STARTERS.length} starters, parts kept apart`)
}

// ---- the redesign test: ten architecture diagrams laid out by Toucan and by D2, and what the comparison found ------------------
// scripts/fixtures/redesign/ holds each diagram's structure and word lengths, with the words scrambled.
{
	const { readFileSync } = await import('node:fs')
	const { routePath, crossingsBetween } = await import('../lib/route.mjs')
	const { layOut, placeBeside, placeDrawing, frameDrawing, authoredKeys } = await import('../lib/layouts.mjs')
	const { sizedNode, textHeight: height, wordWidth } = await import('../lib/boxes.mjs')
	const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/redesign/${name}.json`, import.meta.url), 'utf8'))
	const boxesOf = (tg) => new Map([...tg.nodes, ...tg.groups].map((n) => [n.key, n.box]))
	const crossings = (tg) => {
		const box = boxesOf(tg), nodes = new Map(tg.nodes.map((n) => [n.key, n]))
		const paths = tg.edges.map((e) => ({ e, p: routePath({ ...box.get(e.from), geo: nodes.get(e.from)?.style?.geo }, { ...box.get(e.to), geo: nodes.get(e.to)?.style?.geo }, { kind: e.style.route === 'elbow' ? 'elbow' : 'arc', anchors: e.style.anchors, elbowMid: e.style.elbowMid }).points }))
		let n = 0
		for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) if (![paths[i].e.from, paths[i].e.to].some((k) => k === paths[j].e.from || k === paths[j].e.to)) n += crossingsBetween(paths[i].p, paths[j].p)
		return n
	}

	// 1. A cycle between groups breaks on the arrow written last, so groups stay in the order they were written.
	const d01 = await layOut(fixture('d01'))
	const order = d01.groups.map((g) => g.key)
	const xs = order.map((k) => boxesOf(d01).get(k).x)
	assert.deepEqual(xs, [...xs].sort((a, b) => a - b), 'd01: groups run left to right in the order they were written, though the last one feeds the second')
	assert.ok(crossings(d01) <= 2, `d01: at most 2 crossings, got ${crossings(d01)}`)

	// 2. Six groups with no arrows between them come out as rows of a grid, in the order written, not one long row.
	const one = fixture('d04-one')
	const six = await layOut(one)
	const group = (k) => six.groups.find((g) => g.key === k).box
	const keys = one.groups.map((g) => g.id)
	const rows = [...new Set(keys.map((k) => group(k).y))].sort((a, b) => a - b)
	assert.equal(rows.length, 2, 'd04-one: two rows')
	keys.forEach((k, i) => assert.equal(group(k).y, rows[Math.floor(i / 3)], `d04-one: ${k} is in row ${Math.floor(i / 3) + 1}`))
	for (const row of [keys.slice(0, 3), keys.slice(3)]) assert.deepEqual(row.map((k) => group(k).x), [...row.map((k) => group(k).x)].sort((a, b) => a - b), 'd04-one: left to right in the order written')
	const width = Math.max(...six.groups.map((g) => g.box.x + g.box.w))
	assert.ok(width < 3600, `d04-one is ${width} wide, not the 6890 of one row`)
	assert.equal(new Set(six.groups.map((g) => g.box.x)).size, 3, 'd04-one: three columns')
	for (const g of six.groups) for (const o of six.groups) if (g !== o) assert.ok(!overlaps(g.box, o.box), `d04-one: ${g.key} overlaps ${o.key}`)
	// ...and a flow whose boxes are joined stays one picture; `columns` chooses the grid.
	const chain = await layOut({ kind: 'flow', direction: 'RIGHT', nodes: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }] })
	assert.equal(new Set(chain.nodes.map((n) => n.box.y)).size, 1, 'a chain is one row')
	const loose = (columns) => layOut({ kind: 'flow', columns, nodes: ['a', 'b', 'c', 'd'].map((id) => ({ id, text: id.toUpperCase() })), edges: [] })
	assert.deepEqual([...new Set((await loose(2)).nodes.map((n) => n.box.x))].length, 2, 'columns: 2 gives two columns')
	assert.equal(new Set((await loose(4)).nodes.map((n) => n.box.y)).size, 1, 'columns: 4 gives one row')
	// A frame is as wide as its name: no title is cut off.
	for (const g of six.groups) assert.ok(g.box.w >= g.label.length * 8 + 32, `${g.key}: its frame is wide enough for its name`)

	// 3. Map panels have room for their own arrows, and a dashed link isn't "planned".
	const d02 = fixture('d02')
	const links = d02.links.filter((l) => l.color === 'blue')
	assert.ok(links.length >= 3, 'd02 has configuration links')
	d02.links.forEach((l) => l.color === 'blue' && (l.dash = 'dashed'))
	const map = await layOut(d02)
	for (const e of map.edges.filter((e) => e.style.dash === 'dashed')) assert.ok(links.some((l) => `edge:${l.from}->${l.to}` === e.key), `${e.key} is dashed because it was asked to be`)
	assert.equal(map.edges.filter((e) => e.style.dash === 'dashed').length, links.length, 'every dashed link is dashed, not dotted')
	assert.ok(!map.nodes.some((n) => n.text === 'Dotted arrow: still to build') || d02.links.some((l) => l.kind === 'planned' || l.dash === 'dotted'), 'a dashed link does not put "planned" in the key')
	assert.equal(map.edges.filter((e) => e.style.dash === 'dotted').length, d02.links.filter((l) => l.kind === 'planned').length, 'planned links stay dotted')
	{
		const box = boxesOf(map), tileOf = new Map(map.nodes.map((n) => [n.key, n.group]))
		for (const e of map.edges) {
			const a = box.get(e.from), b = box.get(e.to)
			if (!tileOf.get(e.from) || tileOf.get(e.from) !== tileOf.get(e.to) || !a || !b) continue
			// Arrows between tiles of one panel run their gap: long enough to read, and long enough for a label beside them.
			const run = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h))
			assert.ok(run >= 40, `${e.key}: inside its panel, an arrow has room (${run}px)`)
			if (e.label && (b.x >= a.x + a.w || a.x >= b.x + b.w)) assert.ok(run >= e.label.length * 8.5, `${e.key}: its label (${e.label.length} characters) fits along it (${run}px)`)
		}
	}

	// 4. draw: a prefix, only made-up keys renamed on a clash, an update that stays put, and a titled frame.
	const grid = async () => layOut(fixture('d05'))
	const first = await placeDrawing(await grid(), { spec: fixture('d05'), prefix: 'a-' })
	const taken = [...first.tg.nodes, ...first.tg.groups].map((n) => ({ key: n.key, box: n.box }))
	const second = placeDrawing(await grid(), { spec: fixture('d05'), existing: taken, prefix: 'b-' })
	const all = [...second.tg.nodes, ...second.tg.groups].map((n) => n.key)
	assert.ok(all.every((k) => k.startsWith('b-')), 'prefix: every key, generated ones included')
	assert.ok(![...all, ...taken.map((t) => t.key)].some((k) => k.startsWith('d2-')), 'two prefixed grids never fall back to d2-')
	assert.ok(first.tg.nodes.every((n) => n.key.startsWith('a-')) && first.tg.nodes.some((n) => n.key === 'a-col-0'), 'prefix a-')
	const mapSpec = (id) => ({ kind: 'map', heading: 'H', columns: [[{ id, title: 'P', tiles: [{ id: `${id}-t`, text: 'T' }] }]], links: [{ from: `${id}-t`, to: id, kind: 'planned' }] })
	const m1 = await layOut(mapSpec('one')), m2 = await layOut(mapSpec('two'))
	const mine = [...m1.nodes, ...m1.groups].map((n) => ({ key: n.key, box: n.box }))
	const placed = placeDrawing(m2, { spec: mapSpec('two'), existing: mine })
	const keys2 = [...m2.nodes, ...m2.groups].map((n) => n.key)
	assert.ok(keys2.includes('two') && keys2.includes('two-t'), 'a clash leaves the keys the author gave')
	assert.ok(keys2.includes('d2-map-title') && !keys2.includes('map-title'), 'a clash renames the generated keys: map-title')
	assert.equal(placed.prefix, 'd2-')
	assert.ok(m2.edges.every((e) => keys2.includes(e.from) && keys2.includes(e.to)), 'and the arrows follow')
	assert.ok(authoredKeys(mapSpec('two')).has('two-t') && !authoredKeys(mapSpec('two')).has('map-title'))
	// A key the author wrote clashing too means the whole drawing moves aside, as it always did.
	const again = placeDrawing(await layOut(mapSpec('one')), { spec: mapSpec('one'), existing: mine })
	assert.ok([...again.tg.nodes, ...again.tg.groups].every((n) => n.key.startsWith('d2-')), 'the same section drawn twice without --update does not overwrite it')
	// --update: where the section is now, not the origin.
	const moved = mine.map((n) => ({ ...n, box: { ...n.box, x: n.box.x + 700, y: n.box.y + 300 } }))
	const topLeft = (items) => ({ x: Math.min(...items.map((n) => n.box.x)), y: Math.min(...items.map((n) => n.box.y)) })
	const redrawn = placeDrawing(await layOut(mapSpec('one')), { spec: mapSpec('one'), existing: moved, update: true })
	assert.deepEqual(topLeft([...redrawn.tg.nodes, ...redrawn.tg.groups]), topLeft(moved), 'update: the redrawn section stays where it was moved to')
	// --frame / --title.
	const framed = placeDrawing(await layOut(mapSpec('one')), { spec: mapSpec('one'), frame: { key: 'sec-1', title: 'One' } })
	const frame = framed.tg.groups.find((g) => g.key === 'sec-1')
	assert.equal(frame.label, 'One')
	for (const n of [...framed.tg.nodes.filter((n) => !n.group), ...framed.tg.groups.filter((g) => g.key !== 'sec-1' && !g.parent)]) assert.fail(`${n.key} is outside the frame`)
	for (const n of [...framed.tg.nodes, ...framed.tg.groups].filter((n) => n.key !== 'sec-1')) assert.ok(n.box.x >= frame.box.x && n.box.y >= frame.box.y && n.box.x + n.box.w <= frame.box.x + frame.box.w && n.box.y + n.box.h <= frame.box.y + frame.box.h, `${n.key} is inside the frame`)
	assert.throws(() => placeDrawing(framed.tg, { existing: [{ key: 'sec-1', box: frame.box }], frame: { key: 'sec-1' } }), /already on the canvas/)
	const inFrame = placeDrawing(await layOut(mapSpec('one')), { spec: mapSpec('one'), existing: [{ key: 'sec-1', box: { x: 1000, y: 2000, w: 900, h: 900 } }], update: true, frame: { key: 'sec-1', title: 'One' } })
	assert.deepEqual(topLeft([...inFrame.tg.nodes, ...inFrame.tg.groups].filter((n) => n.key !== 'sec-1' && !n.group)).x >= 1000, true, 'update into a frame lands in it')

	// 5. A box is as wide as its longest word, so no word breaks mid-way; a sequence's columns and rows fit what is in them.
	for (const [shape, room] of [['oval', 1.2], ['rectangle', 1], ['diamond', 1.75], ['hexagon', 1.25]]) {
		const text = 'typed_no_body'
		const size = sizedNode({ id: 'x', text, shape }, 150)
		assert.ok(size.w / Math.sqrt(room) >= wordWidth(text) - 10, `${shape}: ${size.w} wide holds "${text}"`)
		assert.equal(height(text, Math.round(size.w / Math.sqrt(room))), height('x', 200), `${shape}: "${text}" is one line at the width chosen`)
	}
	assert.equal(sizedNode({ id: 'x', text: 'typed_no_body', w: 120 }, 150).w, 120, 'a width the author gave is kept')
	const fl = await layOut({ kind: 'flow', direction: 'DOWN', boxWidth: 150, nodes: [{ id: 'a', text: 'typed_no_body', shape: 'oval' }, { id: 'b', text: 'ok', shape: 'oval' }], edges: [{ from: 'a', to: 'b' }] })
	assert.ok(fl.nodes.find((n) => n.key === 'a').box.h === fl.nodes.find((n) => n.key === 'b').box.h && fl.nodes.find((n) => n.key === 'a').box.w >= 190, 'a flow of ovals: the long state name has room')
	const d09 = fixture('d09'), seq = await layOut(d09)
	const part = d09.participants.map((p) => seq.nodes.find((n) => n.key === p.id))
	part.forEach((n, i) => assert.ok(n.box.w >= wordWidth(d09.participants[i].text) - 1, `sequence: ${n.key} holds its longest word`))
	for (let i = 1; i < part.length; i++) assert.ok(part[i].box.x >= part[i - 1].box.x + part[i - 1].box.w + 10, 'sequence: participants do not touch')
	const dots = (r) => seq.nodes.find((n) => n.key === `m${r}-a`).box
	d09.messages.forEach((m, r) => {
		if (m.from !== m.to) return
		const note = seq.nodes.find((n) => n.key === `m${r}-note`).box
		assert.ok(note.h >= textHeight(m.text, 220) - 20, `sequence: the note on row ${r} is as tall as its text`)
		d09.messages.forEach((o, q) => q !== r && assert.ok(dots(q).y < note.y || dots(q).y > note.y + note.h, `sequence: the note on row ${r} sits on message ${q}'s arrow`))
	})
	const ys = d09.messages.map((_, r) => dots(r).y)
	assert.deepEqual(ys, [...ys].sort((a, b) => a - b), 'sequence: messages stay in order down the page')
	console.log('ok  layouts: the redesign test (cycles keep authored order, pieces pack in a grid, map panels have room, draw keeps keys and places, boxes hold their words)')
}
