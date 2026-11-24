// Checks for server/renditions.mjs: names, what a selection covers, staleness, the manifest (an unchanged picture keeps
// its `published`), and the include catalogue (only toucan's own entry changes, written by rename, private when new).
// Uses a temporary data directory and a temporary catalogue, never the real ones.
//   node scripts/renditions-check.mjs
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as r from '../server/renditions.mjs'

const tmp = mkdtempSync(join(tmpdir(), 'toucan-renditions-'))
const dir = join(tmp, 'data')
mkdirSync(dir)
const file = join(tmp, 'config', 'includes', 'catalogue.json')
const throwsStatus = (fn, status, match) => assert.throws(fn, (e) => e instanceof r.RenditionError && e.status === status && (!match || match.test(e.message)))
try {
	// Names: lower case, a letter or digit first, then . _ -, up to 64.
	for (const ok of ['how-it-works', 'a', 'v1.2_final', '0', 'a'.repeat(64)]) assert.equal(r.checkName(ok), ok)
	for (const no of ['', 'How', '-a', '.a', 'a/b', 'a b', 'a'.repeat(65), '../x', undefined]) throwsStatus(() => r.checkName(no), 400)

	// What it shows: exactly one of all, a frame, or keys.
	assert.deepEqual(r.checkSelect({ all: true }), { all: true })
	assert.deepEqual(r.checkSelect({ keys: ['a', 'b', 'a', ' '] }), { keys: ['a', 'b'] })
	throwsStatus(() => r.checkSelect({ all: true, frame: 'f' }), 400)
	throwsStatus(() => r.checkSelect({ keys: [] }), 400)
	throwsStatus(() => r.checkSelect(null), 400)

	// tldraw: a frame takes in what it holds; shapes on another page are not on the canvas's first page.
	const shape = (id, parentId, extra = {}) => ({ typeName: 'shape', id: `shape:${id}`, parentId, type: 'geo', x: 0, y: 0, props: {}, meta: {}, ...extra })
	const records = [
		{ typeName: 'page', id: 'page:1', index: 'a1' },
		{ typeName: 'page', id: 'page:2', index: 'a2' },
		shape('f', 'page:1', { type: 'frame', meta: { key: 'lane' } }),
		shape('a', 'shape:f', { meta: { key: 'alpha' } }),
		shape('b', 'shape:f'),
		shape('c', 'page:1', { meta: { key: 'gamma' } }),
		shape('d', 'page:2', { meta: { key: 'elsewhere' } }),
	]
	const tree = r.treeFromTldraw(records)
	assert.deepEqual(tree.map((s) => [s.key, s.parent, s.frame]), [['lane', null, true], ['alpha', 'lane', false], ['b', 'lane', false], ['gamma', null, false]])
	assert.deepEqual([...r.pick(tree, { frame: 'lane' })].sort(), ['alpha', 'b', 'lane'], 'a frame brings its contents')
	assert.deepEqual([...r.pick(tree, { keys: ['gamma'] })], ['gamma'])
	assert.equal(r.pick(tree, { all: true }).size, 4)
	throwsStatus(() => r.pick(tree, { frame: 'gamma' }), 400, /isn't a frame/)
	throwsStatus(() => r.pick(tree, { keys: ['gamma', 'nope'] }), 400, /nope/)

	// Staleness: the hash changes when a picked shape changes, or one is added inside, and not for a shape elsewhere.
	const lane = r.shapesHash(tree, r.pick(tree, { frame: 'lane' }))
	const moved = r.treeFromTldraw(records.map((x) => (x.id === 'shape:c' ? { ...x, x: 500 } : x)))
	assert.equal(r.shapesHash(moved, r.pick(moved, { frame: 'lane' })), lane, 'a shape outside the frame changes nothing')
	const edited = r.treeFromTldraw(records.map((x) => (x.id === 'shape:a' ? { ...x, props: { text: 'new' } } : x)))
	assert.notEqual(r.shapesHash(edited, r.pick(edited, { frame: 'lane' })), lane, 'a shape inside it changes the hash')
	const added = r.treeFromTldraw([...records, shape('e', 'shape:f')])
	assert.notEqual(r.shapesHash(added, r.pick(added, { frame: 'lane' })), lane, 'so does a new one inside it')
	assert.match(lane, /^[0-9a-f]{64}$/)

	// Excalidraw: a label is part of its box, bookkeeping isn't a change, a frame's children are its contents.
	const els = [
		{ id: 'F', type: 'frame', customData: { key: 'lane' }, version: 1 },
		{ id: 'A', type: 'rectangle', frameId: 'F', customData: { key: 'alpha' }, version: 1 },
		{ id: 'T', type: 'text', containerId: 'A', text: 'Alpha', version: 1 },
		{ id: 'Z', type: 'rectangle', version: 1 },
		{ id: 'X', type: 'rectangle', isDeleted: true },
	]
	const ex = r.treeFromExcalidraw(els)
	assert.deepEqual(ex.map((s) => [s.key, s.parent]), [['lane', null], ['alpha', 'lane'], ['Z', null]])
	const exHash = r.shapesHash(ex, r.pick(ex, { frame: 'lane' }))
	const bumped = r.treeFromExcalidraw(els.map((e) => ({ ...e, version: 9, versionNonce: 3 })))
	assert.equal(r.shapesHash(bumped, r.pick(bumped, { frame: 'lane' })), exHash, 'bookkeeping is not a change')
	const relabelled = r.treeFromExcalidraw(els.map((e) => (e.id === 'T' ? { ...e, text: 'Beta' } : e)))
	assert.notEqual(r.shapesHash(relabelled, r.pick(relabelled, { frame: 'lane' })), exHash, 'a label is part of its box')

	// Words for part of a graph: its boxes, frames and the arrows among them.
	const sub = r.subGraph({ nodes: [{ key: 'a' }, { key: 'b' }, { key: 'c' }], groups: [{ key: 'g' }], edges: [{ key: 'e1', from: 'a', to: 'b' }, { key: 'e2', from: 'b', to: 'c' }] }, new Set(['a', 'b']))
	assert.deepEqual([sub.nodes.length, sub.groups.length, sub.edges.map((e) => e.key)], [2, 0, ['e1']])

	// The same drawing gives the same bytes: tldraw's per-export ids become the rendition's own.
	const draw = (n) => `<svg><clipPath id="_export_${n}_r_3i__shape_a"/><g clip-path="url(#_export_${n}_r_3i__shape_a)"/><path id="_export_${n}_r_3j__edge"/></svg>`
	assert.equal(r.stableIds(draw(1), 'how-it.works'), r.stableIds(draw(7), 'how-it.works'))
	assert.equal(r.stableIds(draw(1), 'x'), '<svg><clipPath id="_rendition_x_0__shape_a"/><g clip-path="url(#_rendition_x_0__shape_a)"/><path id="_rendition_x_1__edge"/></svg>')

	// Definitions: defaults, keeping what isn't given, and "changed" once published.
	const made = r.define(dir, 'demo', 'how-it-works', { select: { frame: 'lane' }, title: 'How it works' }, { now: Date.parse('2026-11-24T10:00:00Z') })
	assert.equal(made.created, true)
	assert.deepEqual([made.rendition.format, made.rendition.select, made.rendition.alt, made.rendition.published], ['svg', { frame: 'lane' }, null, null])
	assert.equal(r.status(made.rendition, lane).state, 'unpublished')
	throwsStatus(() => r.define(dir, 'demo', 'x', { format: 'gif' }), 400)
	assert.equal(r.define(dir, 'demo', 'how-it-works', { alt: 'Three steps' }).rendition.select.frame, 'lane', 'what is not given is kept')

	// Publishing: the picture beside its definition, and the manifest in it.
	const t1 = Date.parse('2026-11-24T11:00:00Z')
	const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><title>How it works</title></svg>')
	const one = r.publish(dir, 'demo', 'how-it-works', { bytes: svg, version: { n: 7, shapes: lane }, now: t1 })
	assert.equal(one.picture, join(dir, 'demo.renditions', 'how-it-works.svg'))
	assert.deepEqual(readFileSync(one.picture), svg)
	const m = JSON.parse(readFileSync(join(dir, 'demo.renditions', 'how-it-works.json'), 'utf8'))
	for (const k of ['name', 'canvas', 'select', 'format', 'alt', 'title', 'version', 'hash', 'published']) assert.ok(k in m, `the manifest has ${k}`)
	assert.deepEqual([m.name, m.canvas, m.format, m.alt, m.title], ['how-it-works', 'demo', 'svg', 'Three steps', 'How it works'])
	assert.deepEqual(m.version, { n: 7, shapes: lane })
	assert.match(m.hash, /^[0-9a-f]{64}$/)
	assert.equal(m.published, new Date(t1).toISOString())
	assert.equal(r.status(m, lane).state, 'current')
	assert.equal(r.status(m, r.shapesHash(edited, r.pick(edited, { frame: 'lane' }))).state, 'behind', 'behind once what it shows changes')
	assert.equal(r.status(m, null).state, 'behind', 'behind when what it shows is gone')

	const again = r.publish(dir, 'demo', 'how-it-works', { bytes: svg, version: { n: 8, shapes: lane }, now: t1 + 60000 })
	assert.equal(again.unchanged, true)
	assert.equal(again.rendition.published, m.published, 'an unchanged picture keeps published')
	assert.equal(again.rendition.version.n, 8)
	const newer = r.publish(dir, 'demo', 'how-it-works', { bytes: Buffer.from('<svg>2</svg>'), version: { n: 9, shapes: lane }, now: t1 + 120000 })
	assert.equal(newer.rendition.published, new Date(t1 + 120000).toISOString(), 'a new picture is a new publication')

	// Changing a published definition marks it behind until it is drawn again; changing format replaces the picture.
	const changed = r.define(dir, 'demo', 'how-it-works', { format: 'png' }).rendition
	assert.equal(changed.changed, true)
	assert.equal(r.status(changed, lane).state, 'behind')
	const png = r.publish(dir, 'demo', 'how-it-works', { bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]), version: { n: 9, shapes: lane } })
	assert.ok(existsSync(join(dir, 'demo.renditions', 'how-it-works.png')) && !existsSync(join(dir, 'demo.renditions', 'how-it-works.svg')), 'one picture, in its format')
	assert.equal(png.rendition.changed, undefined)
	assert.equal(r.status(png.rendition, lane).state, 'current')
	assert.deepEqual(r.list(dir, 'demo').map((x) => x.name), ['how-it-works'])
	throwsStatus(() => r.publish(dir, 'demo', 'missing', { bytes: svg, version: null }), 404)

	// The catalogue: where it is.
	assert.equal(r.cataloguePath({ INCLUDES_CATALOGUE: '/x/c.json', XDG_CONFIG_HOME: '/y' }), '/x/c.json')
	assert.equal(r.cataloguePath({ XDG_CONFIG_HOME: '/y', HOME: '/h' }), '/y/includes/catalogue.json')
	assert.equal(r.cataloguePath({ HOME: '/h' }), '/h/.config/includes/catalogue.json')
	assert.equal(r.entryName('Game_Seven', 'how-it-works'), 'toucan:game-seven/how-it-works', 'lower case, no underscore')

	// Registering creates the file and its folder, private to their owner.
	const def = png.rendition
	const reg = r.register(def, png.picture, { file })
	assert.deepEqual(reg, { file, name: 'toucan:demo/how-it-works' })
	assert.equal(statSync(file).mode & 0o777, 0o600)
	assert.equal(statSync(join(tmp, 'config', 'includes')).mode & 0o777, 0o700)
	const cat = JSON.parse(readFileSync(file, 'utf8'))
	assert.equal(cat.v, 1)
	assert.deepEqual(cat.entries['toucan:demo/how-it-works'], {
		kind: 'picture',
		path: png.picture,
		title: 'How it works',
		alt: 'Three steps',
		source: { tool: 'toucan', canvas: 'demo', rendition: 'how-it-works', version: def.version, hash: def.hash, published: def.published },
	})

	// Everything else in it stays exactly as it was; nothing is left beside it.
	const theirs = { about: { kind: 'markdown', path: '/docs/about.md', title: 'About' }, 'toucan:other/x': { kind: 'picture', path: '/p.svg', source: { tool: 'toucan', canvas: 'other', rendition: 'x' } } }
	writeFileSync(file, JSON.stringify({ v: 1, entries: { ...theirs, ...cat.entries }, note: 'kept' }))
	r.register({ ...def, alt: 'Four steps' }, png.picture, { file })
	const after = JSON.parse(readFileSync(file, 'utf8'))
	assert.deepEqual(after.entries.about, theirs.about)
	assert.deepEqual(after.entries['toucan:other/x'], theirs['toucan:other/x'])
	assert.equal(after.note, 'kept', 'what the file says beyond entries is kept')
	assert.equal(after.entries['toucan:demo/how-it-works'].alt, 'Four steps')
	assert.deepEqual(readdirSync(join(tmp, 'config', 'includes')), ['catalogue.json'], 'the temporary file was renamed into place')

	// A name that is someone else's, or a catalogue it can't read, is left alone and said.
	writeFileSync(file, JSON.stringify({ v: 1, entries: { ...after.entries, 'toucan:demo/taken': { kind: 'picture', path: '/q.svg' } } }))
	throwsStatus(() => r.register({ ...def, name: 'taken' }, '/z.svg', { file }), 409, /already has/)
	throwsStatus(() => r.register({ ...def, canvas: 'Demo' }, '/z.svg', { file }), 409, /canvas demo/)
	const broken = join(tmp, 'broken.json')
	writeFileSync(broken, '{not json')
	throwsStatus(() => r.register(def, '/z.svg', { file: broken }), 409, /isn't JSON/)
	assert.equal(readFileSync(broken, 'utf8'), '{not json', 'a catalogue it cannot read is not overwritten')
	writeFileSync(broken, JSON.stringify({ v: 2, entries: {} }))
	throwsStatus(() => r.register(def, '/z.svg', { file: broken }), 409, /version 1/)

	// Unregistering takes out toucan's entry for that canvas only.
	assert.equal(r.unregister('demo', 'taken', { file }).removed, false, 'not ours: left')
	assert.equal(r.unregister('demo', 'how-it-works', { file }).removed, true)
	const left = JSON.parse(readFileSync(file, 'utf8')).entries
	assert.deepEqual(Object.keys(left).sort(), ['about', 'toucan:demo/taken', 'toucan:other/x'])
	assert.equal(r.unregister('demo', 'how-it-works', { file }).removed, false, 'twice is harmless')
	assert.equal(r.unregister('demo', 'x', { file: join(tmp, 'none.json') }).removed, false, 'no catalogue, nothing to do')
	assert.ok(!existsSync(join(tmp, 'none.json')))

	// Removing a rendition takes its definition and picture.
	assert.equal(r.remove(dir, 'demo', 'how-it-works').name, 'how-it-works')
	assert.deepEqual(readdirSync(join(dir, 'demo.renditions')), [])
	assert.equal(r.remove(dir, 'demo', 'how-it-works'), null)
	console.log('renditions check passed')
} finally {
	rmSync(tmp, { recursive: true, force: true })
}
