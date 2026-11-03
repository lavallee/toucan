// Checks for server/threads.mjs: the life of a thread, what it says it's attached to, and bringing notes in.
//   node scripts/threads-check.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as threads from '../server/threads.mjs'

const dir = mkdtempSync(join(tmpdir(), 'toucan-threads-'))
const marc = { kind: 'person', name: 'Marc' }
const tg = {
	groups: [{ key: 'core', label: 'Core', box: { x: 0, y: 0, w: 500, h: 300 } }],
	nodes: [
		{ key: 'orders', text: 'Orders', box: { x: 10, y: 10, w: 100, h: 50 } },
		{ key: 'db', text: 'Postgres', box: { x: 400, y: 10, w: 100, h: 50 } },
	],
	edges: [{ key: 'edge:orders->db', from: 'orders', to: 'db' }],
}
try {
	assert.deepEqual(threads.list(dir, 'c'), [], 'no threads yet')
	assert.throws(() => threads.create(dir, 'c', { anchor: {}, author: marc, text: 'hi' }), threads.Invalid)
	assert.throws(() => threads.create(dir, 'c', { anchor: { region: { x: 0, y: 0, w: 'big', h: 1 } }, author: marc, text: 'hi' }), threads.Invalid)
	assert.throws(() => threads.create(dir, 'c', { anchor: { shapes: ['a'] }, author: marc, text: '  ' }), threads.Invalid, 'something must be said')

	const one = threads.create(dir, 'c', { anchor: { shapes: ['orders'], box: { x: 10, y: 10, w: 100, h: 50 } }, author: marc, text: 'why this?' })
	assert.deepEqual([one.id, one.status, one.messages[0].author.name], [1, 'open', 'Marc'])
	const back = threads.reply(dir, 'c', 1, { author: { kind: 'agent' }, text: 'Because.' })
	assert.deepEqual(back.messages.map((m) => m.author.kind), ['person', 'agent'])
	assert.equal(back.messages[1].author.name, 'Agent')

	const closed = threads.close(dir, 'c', 1, { by: marc })
	assert.deepEqual([closed.status, closed.closed.by.name], ['closed', 'Marc'])
	const again = threads.reply(dir, 'c', 1, { author: marc, text: 'one more thing' })
	assert.equal(again.status, 'open', 'saying something in a closed thread opens it again')
	assert.equal(again.closed, undefined)
	assert.equal(threads.close(dir, 'c', 1, { by: { kind: 'agent' }, reply: 'Done.' }).messages.at(-1).text, 'Done.', 'a closing word')
	assert.equal(threads.reopen(dir, 'c', 1).status, 'open')
	assert.throws(() => threads.reply(dir, 'c', 99, { author: marc, text: 'x' }), threads.NotFound)

	// What it's attached to.
	assert.equal(threads.anchorLine(one, tg), 'on orders ("Orders")')
	assert.match(threads.anchorLine({ anchor: { shapes: ['img'], box: { x: 5, y: 6, w: 1, h: 1 } } }, tg), /it was at 5,6/)
	assert.equal(threads.anchorLine({ anchor: { shapes: ['gone', 'edge:orders->db'] } }, tg), 'on gone (not listed: a drawing or image, or since removed), the arrow orders -> db')
	const region = threads.create(dir, 'c', { anchor: { region: { x: 380, y: 0, w: 200, h: 100 } }, author: marc, text: 'too crowded' })
	assert.equal(region.id, 2)
	const d = threads.describeAnchor(region, tg)
	assert.deepEqual(d.inside.map((s) => s.key), ['db'], 'a region knows what is in it, and not the frame around it')
	assert.match(threads.anchorLine(region, tg), /^on the region 380,0 200x100, around db \("Postgres"\)$/)
	assert.match(threads.anchorLine({ anchor: { region: { x: 900, y: 900, w: 10, h: 10 } } }, tg), /nothing in it yet/)

	// A thread's conversation is told only what it hasn't been told, whoever said it.
	const fresh = threads.create(dir, 'p', { anchor: { shapes: ['orders'] }, author: marc, text: 'first' })
	assert.ok(threads.promptFor(fresh, tg).includes('Marc: first'))
	threads.markSeen(dir, 'p', fresh.id)
	const steer = threads.reply(dir, 'p', fresh.id, { author: marc, text: 'and also' })
	const steered = threads.promptFor(steer, tg)
	assert.ok(steered.includes('Marc: and also') && !steered.includes('first'), 'a steer does not repeat what it already has')
	threads.markSeen(dir, 'p', fresh.id)
	assert.ok(threads.promptFor(threads.agentAnswered(dir, 'p', fresh.id, 'Done it.'), tg).includes('Nothing new'), 'its own words count as seen')
	const fromChat = threads.reply(dir, 'p', fresh.id, { author: { kind: 'agent' }, text: 'The main chat renamed it.' })
	assert.ok(threads.promptFor(threads.reply(dir, 'p', fresh.id, { author: marc, text: 'yes, do that' }), tg).includes('Agent: The main chat renamed it.\nMarc: yes'), 'what another agent said in the thread reaches it')
	assert.ok(threads.promptFor(fromChat, tg).includes('The main chat renamed it'))
	const cliAsk = threads.create(dir, 'p', { anchor: { shapes: ['orders'] }, author: { kind: 'agent' }, text: 'check this' })
	assert.ok(threads.promptFor(cliAsk, tg).includes('Agent: check this'), 'a request from an agent is still a request')

	// A turn ending doesn't reopen what was closed while it ran.
	const during = threads.create(dir, 'p', { anchor: { shapes: ['orders'] }, author: marc, text: 'fix and close' })
	threads.close(dir, 'p', during.id, { by: { kind: 'agent' } })
	assert.equal(threads.agentAnswered(dir, 'p', during.id, 'Fixed.').status, 'closed')

	// Notes come in once: open ones open, resolved ones closed with their reply.
	const withNotes = {
		nodes: [
			...tg.nodes,
			{ key: 'n1', text: 'look here', style: { geo: 'note' }, box: { x: 0, y: 0, w: 200, h: 200 } },
			{ key: 'n2', text: 'old\n↳ done', style: { geo: 'note' }, box: { x: 300, y: 0, w: 200, h: 200 }, meta: { noteText: 'old', reply: 'done', resolved: '2026-11-02T00:00:00Z' } },
		],
	}
	assert.deepEqual(threads.adoptableNotes(dir, 'n', withNotes).map((n) => n.key), ['n1', 'n2'])
	const adopted = threads.adoptNotes(dir, 'n', withNotes)
	assert.deepEqual(adopted.map((t) => t.status), ['open', 'closed'])
	assert.deepEqual(adopted[1].messages.map((m) => m.author.kind), ['person', 'agent'], 'a person wrote the note, the agent replied')
	assert.deepEqual(adopted[1].messages.map((m) => m.text), ['old', 'done'], 'the note text without its reply, then the reply')
	assert.deepEqual(threads.adoptNotes(dir, 'n', withNotes), [], 'only once')
	assert.equal(threads.transcript(adopted[1]), 'Sticky note: old\nAgent: done')
	console.log('ok  threads')
} finally {
	rmSync(dir, { recursive: true, force: true })
}
