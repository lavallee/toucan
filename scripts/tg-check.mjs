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

// Every format carries a laid-out graph through.
roundTrip('sample', laid)
