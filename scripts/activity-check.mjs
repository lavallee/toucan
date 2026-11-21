// Checks for server/activity.mjs: who changed what is worked out right, each reader hears each thing once, and what it
// reads is short and plain.
//   node scripts/activity-check.mjs
import assert from 'node:assert/strict'
import { createActivity, describe, format, tldrawRows, excalidrawRows, rowChanges } from '../server/activity.mjs'

const rt = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const page = { typeName: 'page', id: 'page:1', name: 'Page 1', index: 'a1' }
const frame = { typeName: 'shape', id: 'shape:core', type: 'frame', parentId: 'page:1', x: 100, y: 100, props: { w: 400, h: 300, name: 'Core' }, meta: { key: 'core' } }
const box = (id, x, y, text, extra = {}) => ({ typeName: 'shape', id: `shape:${id}`, type: 'geo', parentId: 'page:1', x, y, props: { w: 120, h: 60, geo: 'rectangle', color: 'black', fill: 'none', dash: 'draw', size: 'm', richText: rt(text) }, meta: { key: id }, ...extra })

// ---- rows --------------------------------------------------------------------------------------------------------
{
	const inFrame = box('orders', 10, 20, 'Orders', { parentId: 'shape:core' })
	const arrow = { typeName: 'shape', id: 'shape:a1', type: 'arrow', parentId: 'page:1', x: 0, y: 0, props: { richText: rt('writes') }, meta: {} }
	const bindings = [
		{ typeName: 'binding', type: 'arrow', id: 'binding:1', fromId: 'shape:a1', toId: 'shape:orders', props: { terminal: 'start' } },
		{ typeName: 'binding', type: 'arrow', id: 'binding:2', fromId: 'shape:a1', toId: 'shape:db', props: { terminal: 'end' } },
	]
	const rows = tldrawRows([page, frame, inFrame, box('db', 600, 100, 'DB'), arrow, ...bindings])
	const o = rows.get('shape:orders')
	assert.deepEqual([o.key, o.kind, o.text, o.x, o.y, o.frame, o.page], ['orders', 'box', 'Orders', 110, 120, 'core', 'Page 1'], 'a box in a frame is where it looks to be')
	assert.deepEqual([rows.get('shape:a1').from, rows.get('shape:a1').to, rows.get('shape:a1').text], ['orders', 'db', 'writes'])
	assert.equal(rows.get('shape:core').text, 'Core', "a frame's text is its name")

	const ex = excalidrawRows([
		{ id: 'r1', type: 'rectangle', x: 0, y: 0, width: 100, height: 50, boundElements: [{ id: 't1', type: 'text' }], customData: { key: 'login' } },
		{ id: 't1', type: 'text', containerId: 'r1', x: 5, y: 5, width: 90, height: 20, originalText: 'Log in' },
		{ id: 'gone', type: 'rectangle', x: 0, y: 0, width: 1, height: 1, isDeleted: true },
	])
	assert.deepEqual([...ex.keys()], ['r1'], "a container's label is part of it, and deleted elements aren't there")
	assert.deepEqual([ex.get('r1').key, ex.get('r1').text, ex.get('r1').parts], ['login', 'Log in', ['t1']])

	const a = rows.get('shape:orders')
	assert.deepEqual(rowChanges(a, { ...a, x: a.x + 2 }), [], 'a nudge is noise')
	assert.deepEqual(rowChanges(a, { ...a, x: a.x + 40, text: 'Orders v2' }), ['text', 'moved'])
}

// ---- the feed ----------------------------------------------------------------------------------------------------
{
	let records = [page, box('login', 0, 0, 'Login'), box('signup', 200, 0, 'Sign up'), box('old', 400, 0, 'Legacy')]
	let inFlight = false
	const feed = createActivity({ rowsOf: (n) => (n === 'c' ? tldrawRows(records) : null), busy: () => inFlight, quietMs: 10 })
	feed.open('c')

	// A reader starts at the present: what happened before it came isn't news.
	assert.equal(feed.pending('chat:c', 'c').fresh, true)
	assert.equal(feed.pending('chat:c', 'c').events.length, 0)
	const cli = 'cli:c:claude'
	feed.pending(cli, 'c')

	// A person edits two boxes, and moves one twice; an agent's run changes another, and says so.
	records = records.map((r) => (r.id === 'shape:login' ? { ...r, props: { ...r.props, richText: rt('Sign in') } } : r))
	feed.ran('c', { kind: 'agent', name: 'claude' }, { updated: [{ id: 'shape:signup', key: 'signup' }] })
	records = records.map((r) => (r.id === 'shape:signup' ? { ...r, props: { ...r.props, color: 'blue' } } : r))
	feed.settle('c')
	records = records.map((r) => (r.id === 'shape:login' ? { ...r, x: 50 } : r))
	feed.settle('c')
	records = records.map((r) => (r.id === 'shape:login' ? { ...r, x: 90, y: 30 } : r))
	records = records.filter((r) => r.id !== 'shape:old')
	records.push(box('tmp', 0, 300, 'scratch'))
	feed.settle('c')
	records = records.filter((r) => r.id !== 'shape:tmp') // made and removed again
	feed.ran('c', { kind: 'canvas', name: 'Reflex' }, { added: [{ id: 'shape:fit' }] })
	records.push(box('fit', 0, 500, 'refit'))
	feed.selected('c', 1, 'Ana', ['login'])
	feed.note('c', { actor: { kind: 'person', name: 'Ana' }, thread: 3, text: 'started comment thread #3 (on login): "why two?"' })

	const own = feed.pending(cli, 'c', { mine: (a) => a?.kind === 'agent' && a.name === 'claude' })
	assert.ok(!own.events.some((e) => e.id === 'shape:signup'), "a reader isn't told of its own edits")
	assert.ok(!own.events.some((e) => e.id === 'shape:fit'), 'the canvas tending itself is not news')

	const chat = feed.pending('chat:c', 'c')
	const lines = describe(chat.events, { seen: chat.reader.seen })
	assert.ok(lines.some((l) => l === 'claude (agent) changed box signup "Sign up": restyled'), 'an edit a run claimed is the agent\'s')
	assert.ok(lines.some((l) => l === 'someone changed box login "Sign in": text "Login" → "Sign in"; moved to 90,30'), `several edits to one box read as one: ${lines.join('\n')}`)
	assert.ok(lines.some((l) => l === 'someone removed box old "Legacy"'))
	assert.ok(!lines.some((l) => l.includes('tmp')), 'made and removed again: nothing to tell')
	assert.ok(lines.includes('Ana selected login'))
	assert.ok(lines.includes('Ana started comment thread #3 (on login): "why two?"'))
	assert.equal(describe(chat.events, { person: 'Ana' }).filter((l) => l.startsWith('Ana ')).length, 4, 'with one person at the canvas, their edits carry their name')

	// Told once: acked, it's gone; a thread's own conversation doesn't hear its own comments.
	feed.ack('chat:c', chat.upto, chat.events)
	assert.equal(feed.pending('chat:c', 'c').events.length, 0)
	feed.pending('chat:c#3', 'c')
	feed.note('c', { actor: { kind: 'person', name: 'Ana' }, thread: 3, text: 'replied in comment thread #3' })
	assert.equal(feed.pending('chat:c#3', 'c', { skip: (e) => e.thread === 3 }).events.length, 0)

	const main = feed.pending('chat:c', 'c')
	assert.equal(main.events.length, 1, 'the main chat does hear about the thread')
	feed.ack('chat:c', main.upto, main.events)

	// Not acked (the steer didn't land): still there next time.
	feed.selected('c', 1, 'Ana', ['signup'])
	assert.equal(feed.pending('chat:c', 'c').events.length, 1)
	assert.equal(feed.pending('chat:c', 'c').events.length, 1)

	// A selection that went and came back is no news.
	const p = feed.pending('chat:c', 'c')
	feed.ack('chat:c', p.upto, p.events)
	feed.selected('c', 1, 'Ana', [])
	feed.selected('c', 1, 'Ana', ['signup'])
	const back = feed.pending('chat:c', 'c')
	assert.deepEqual(describe(back.events, { seen: back.reader.seen }), [])
	assert.equal(feed.selections('c')[0].keys[0], 'signup')

	// While a run is in flight, a change waits for its report before anyone decides it was a person's.
	inFlight = true
	records = records.map((r) => (r.id === 'shape:signup' ? { ...r, x: 600 } : r))
	feed.touched('c')
	await new Promise((r) => setTimeout(r, 40))
	feed.ran('c', { kind: 'agent', name: 'Codex' }, { updated: [{ id: 'shape:signup' }] })
	inFlight = false
	await new Promise((r) => setTimeout(r, 40))
	const after = feed.pending('chat:c', 'c', { mine: (a) => a?.name === 'Codex' })
	assert.ok(!after.events.some((e) => e.type === 'shape'), `the run's move is the run's: ${JSON.stringify(after.events)}`)
}

// ---- a frame moved: what's in it went along, and isn't news of its own -----------------------------------------------
{
	let records = [page, frame, box('orders', 10, 20, 'Orders', { parentId: 'shape:core' })]
	const feed = createActivity({ rowsOf: () => tldrawRows(records) })
	feed.open('c')
	feed.pending('r', 'c')
	records = records.map((r) => (r.id === 'shape:core' ? { ...r, x: r.x + 200 } : r))
	const { events, reader } = feed.pending('r', 'c')
	assert.deepEqual(describe(events, { seen: reader.seen }), ['someone changed frame core "Core": moved to 300,100'])
}

// ---- the block -----------------------------------------------------------------------------------------------------
{
	assert.equal(format([]), null, 'nothing to say: no block')
	const text = format(['Ana moved box a to 1,2'], { canvas: 'c' })
	assert.ok(text.startsWith('<canvas_activity canvas="c">') && text.endsWith('</canvas_activity>') && text.includes('- Ana moved box a to 1,2'))
	const many = describe(Array.from({ length: 60 }, (_, i) => ({ type: 'note', actor: { kind: 'person', name: 'Ana' }, text: `said ${i}` })))
	assert.equal(many.length, 26, 'a long stretch is capped')
	assert.ok(many.at(-1).includes('35 more changes'))
}

console.log('ok  activity')
