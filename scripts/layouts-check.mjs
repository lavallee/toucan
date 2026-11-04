// Checks for lib/layouts.mjs and templates/: every template lays out the same way twice, with sound geometry. How good each one
// looks is the eval's job (scripts/eval-diagrams.mjs); this catches what's plainly broken, with no browser.
//   node scripts/layouts-check.mjs
import assert from 'node:assert/strict'
import ELK from 'elkjs/lib/elk.bundled.js'
import { layOut, textHeight } from '../lib/layouts.mjs'
import { TEMPLATES } from '../templates/index.mjs'

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
