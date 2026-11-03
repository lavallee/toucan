// Checks for lib/layouts.mjs and templates/: every template lays out the same way twice, with sound geometry. How good each one
// looks is the eval's job (scripts/eval-diagrams.mjs); this catches what's plainly broken, with no browser.
//   node scripts/layouts-check.mjs
import assert from 'node:assert/strict'
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
