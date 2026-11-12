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
