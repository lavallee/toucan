// Checks for server/brief.mjs: the brief stays compact and complete, and only clean messages skip the agent.
//   node scripts/brief-check.mjs
import assert from 'node:assert/strict'
import { formatBrief, parseDirect } from '../server/brief.mjs'

const tg = {
	groups: [{ key: 'core', label: 'Core', box: { x: 0, y: 0, w: 400.4, h: 200 } }],
	nodes: [{ key: 'orders', group: 'core', text: 'Orders\nservice', box: { x: 10, y: 20, w: 100, h: 50 } }],
	edges: [{ from: 'orders', to: 'db', label: 'writes' }],
}
const brief = formatBrief(tg, { selected: ['orders'], openNotes: 2, others: [{ user: 'Ana', shapes: ['db'] }] })
for (const line of ['frame core: Core @0,0 400x200', 'box orders in core: Orders service @10,20 100x50', 'arrow orders -> db: writes', 'Selected now by the person', 'orders', 'Selected by others: Ana: db', '2 open sticky notes']) assert.ok(brief.includes(line), line)
assert.ok(formatBrief({}, { selected: [] }).includes('The canvas is empty.'))
assert.ok(formatBrief({}).includes('Selection unknown'), 'no tab: selection is unknown, not empty')
assert.ok(formatBrief({}, { selected: [] }).includes('Nothing is selected'))
const sketch = formatBrief({ skipped: { 'draw shape': 1, 'image shape': 1 } })
assert.ok(!sketch.includes('The canvas is empty.') && sketch.includes('2 other shapes'), 'shapes TG skips are not an empty canvas')

assert.ok(formatBrief({}, null, ['#3 on orders: "why?"']).includes('Open comment thread #3 on orders: "why?"'), 'open threads are in the brief')

assert.ok(formatBrief({}, null, [], 'This canvas is a story map.').includes('This canvas is a story map.'), 'the format guides the agent')
assert.ok(formatBrief({ nodes: [{ key: 'a', text: 'A', meta: { detail: 'behind the box' } }] }).includes('[detail: behind the box]'), 'the detail behind a box is in the brief')

const many = { nodes: Array.from({ length: 1000 }, (_, i) => ({ key: `n${i}`, text: 'x'.repeat(500) })) }
const big = formatBrief(many)
assert.ok(big.includes('800 more boxes') && big.length < 20000, 'a huge canvas is capped')

assert.deepEqual(parseDirect('/tidy-arrows'), { routine: 'tidy-arrows' })
assert.deepEqual(parseDirect('  /tidy-arrows\n'), { routine: 'tidy-arrows' })
assert.equal(parseDirect('/tidy-arrows please'), null, 'words after it are for the agent')
assert.equal(parseDirect('/home/marc/file.txt'), null, 'a path is not a routine')
assert.deepEqual(parseDirect('flowchart LR\n  a --> b').graph.nodes.map((n) => n.key), ['a', 'b'])
assert.deepEqual(parseDirect('```mermaid\ngraph TD\n  a --> b\n```').graph.nodes.map((n) => n.key), ['a', 'b'])
assert.equal(parseDirect('graph LR is the wrong direction, please switch it to top-down'), null, 'prose that starts like a flowchart')
assert.equal(parseDirect('flowchart LR\n  a --> b\n\nAlso make it blue please'), null, 'a flowchart with a request after it')
assert.equal(parseDirect('here is a sketch:\nflowchart LR\n  a --> b'), null)
assert.equal(parseDirect('graph theory is neat'), null)
assert.equal(parseDirect('add a box'), null)
console.log('ok  brief')
