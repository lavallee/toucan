// Round-trip checks for lib/tg.mjs: every format must carry keys, text, membership and edges through.
//   node scripts/tg-check.mjs [canvases/NAME.json]   (also round-trips a real tldraw canvas file when given)
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import ELK from 'elkjs/lib/elk.bundled.js'
import * as T from '../lib/tg.mjs'

const same = (label, a, b) => {
	const norm = (tg) => ({
		groups: tg.groups.map((g) => g.key).sort(),
		nodes: tg.nodes.map((n) => [n.key, n.text ?? n.key, n.group ?? null]).sort((x, y) => (x[0] < y[0] ? -1 : 1)),
		edges: tg.edges.map((e) => `${e.from}->${e.to}`).sort(),
	})
	assert.deepEqual(norm(b), norm(a), label)
	console.log(`ok  ${label}: ${b.groups.length} groups, ${b.nodes.length} nodes, ${b.edges.length} edges`)
}

const roundTrip = (name, tg) => {
	same(`${name} json canvas`, tg, T.fromJsonCanvas(T.toJsonCanvas(tg)))
	same(`${name} mermaid`, tg, T.fromMermaid(T.toMermaid(tg)))
	same(`${name} excalidraw`, tg, T.fromExcalidraw(T.toExcalidrawElements(tg)))
	assert.ok(T.toDot(tg).startsWith('digraph'))
}
const file = process.argv[2]
if (file && existsSync(file)) roundTrip(file, T.fromTldraw(JSON.parse(readFileSync(file, 'utf8')).room.documents.map((d) => d.state)))
else if (file) console.log(`skip ${file} (not found)`)

// Mermaid subset, and the "missing means leave it" rules.
const m = T.fromMermaid(`graph TD
  A[Start] --> B{Is it?}
  B -->|Yes| C["OK [quoted]"] & D
  C -.-> D((round))
  subgraph S1 [Group one]
    E -- maybe --> F
  end
  bogus line ~~
`)
assert.deepEqual(m.warnings, ['bogus line ~~'])
assert.equal(m.nodes.find((n) => n.key === 'C').text, 'OK [quoted]')
assert.equal(m.nodes.find((n) => n.key === 'D').style.geo, 'ellipse')
assert.equal(m.nodes.find((n) => n.key === 'A').group, undefined, 'outside a subgraph: membership unknown')
assert.equal(m.nodes.find((n) => n.key === 'E').group, 'S1')
assert.ok(!m.nodes.some((n) => n.key === 'bogus'), 'an unparsed line adds nothing')
assert.equal(T.fromMermaid('graph LR\n  a --> b').nodes[0].text, undefined, 'bare reference carries no text')
assert.equal(m.edges.find((e) => e.from === 'C' && e.to === 'D').style.dash, 'dashed')
console.log('ok  mermaid subset')

// Layout of new items lands beside existing content and gives every new item a box.
const laid = await T.layoutMissing(m, { existing: { groups: [], nodes: [{ key: 'x', box: { x: 0, y: 0, w: 100, h: 100 } }] }, elk: new ELK() })
assert.ok([...laid.groups, ...laid.nodes].every((i) => i.box && i.box.x >= 300), 'new items placed right of existing content')
console.log('ok  layoutMissing')

// A new group whose only member is already on the canvas used to come back 0x0 from ELK; as a frame that fails
// tldraw's validation and crashes the tab (an agent's "give it its own lane" import did exactly this).
{
	const lane = T.fromMermaid('flowchart LR\n  subgraph lane[Waitlist]\n    waitlist[Waitlist]\n  end\n  bookings --> waitlist')
	const existing = { groups: [], nodes: [{ key: 'waitlist', box: { x: 500, y: 300, w: 160, h: 60 } }, { key: 'bookings', box: { x: 100, y: 300, w: 160, h: 60 } }] }
	const out = await T.layoutMissing(lane, { existing, elk: new ELK() })
	const g = out.groups.find((x) => x.key === 'lane')
	assert.ok(g.box.w > 0 && g.box.h > 0, 'a group of existing members gets a size')
	assert.ok(g.box.x < 500 && g.box.x + g.box.w > 660 && g.box.y < 300 && g.box.y + g.box.h > 360, 'and wraps them where they are')
	const empty = await T.layoutMissing({ groups: [{ key: 'nothing', label: 'Empty' }], nodes: [], edges: [] }, { existing, elk: new ELK() })
	assert.ok(empty.groups[0].box.w > 0 && empty.groups[0].box.h > 0, 'an empty group gets a default size')
}
console.log('ok  layoutMissing: a group with no new members still has a size')

// Every format carries a laid-out graph through.
roundTrip('sample', laid)
