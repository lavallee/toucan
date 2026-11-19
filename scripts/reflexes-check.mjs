// Checks for reflexes (lib/reflexes.mjs, server/reflexes.mjs): how the tree decides, what it remembers, the programs it
// sends to a tab, and the server's loop, against a pretend canvas.
//   node scripts/reflexes-check.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReflexError, SETTLE_MS, UNDO_MS, actProgram, addAsk, braked, cleanNode, decide, judgeProgram, mark, observe, placeNode, postOrder, rebase, routineBody, settled, subtree, suggest, tryProgram, withParents } from '../lib/reflexes.mjs'
import { createReflexes } from '../server/reflexes.mjs'
import { kindOf } from '../server/worklog.mjs'

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const compile = (...a) => (a.length > 2 ? new AsyncFunction(...a) : new Function(...a))
const node = (name, extra = {}) => ({ name, about: name, when: 'return true', do: { routine: 'r' }, under: null, status: 'on', ...extra })
const sit = (...on) => ({ id: on.sort().join(','), on })
const step = (m) => console.log(`ok  ${m}`)

// ---- a node as stored --------------------------------------------------------------------------------------------------
{
	const n = cleanNode({ name: 'fits', when: 'return view.findings()', do: { routine: 'fit-text' } }, { compile })
	assert.deepEqual([n.status, n.under, n.about], ['watching', null, 'fits'], 'a node starts watching')
	assert.throws(() => cleanNode({ name: 'Bad Name', when: 'return 1' }, { compile }), ReflexError)
	assert.throws(() => cleanNode({ name: 'x', when: 'return (' }, { compile }), /doesn't compile/, 'a condition that does not parse is refused')
	assert.throws(() => cleanNode({ name: 'x', when: 'return 1', do: { code: 'await (' } }, { compile }), /do.code doesn't compile/)
	assert.throws(() => cleanNode({ name: 'x', when: 'return 1', do: { routine: 'nope' } }, { compile, routineExists: () => false }), /no routine nope/)
	assert.throws(() => cleanNode({ name: 'x', when: 'return 1', do: { routine: 'r', tell: true } }, { compile }), /one of/)
	assert.throws(() => cleanNode({ name: 'x', when: 'return 1', under: 'nobody' }, { compile }), /no node nobody/)
	// A node can't go under one of its own.
	const tree = [node('a'), node('b', { under: 'a' })]
	assert.throws(() => cleanNode({ name: 'a', when: 'return 1', under: 'b' }, { nodes: tree, compile }), /is under a/)
	assert.equal(cleanNode({ name: 'x', when: 'return 1', status: 'paused' }, { compile }).status, 'watching', 'nobody sets paused: the canvas does')
	assert.throws(() => cleanNode({ name: 'wake', when: 'return 1' }, { compile }), /taken/, "names the API uses for its own parts are refused")
	step('a node: checked, compiled, and watching until switched on')
}

// ---- the tree's shape ----------------------------------------------------------------------------------------------------
{
	let t = [node('a'), node('b')]
	t = placeNode(t, node('c', { under: 'a' }))
	t = placeNode(t, node('z'), { before: 'a' })
	assert.deepEqual(t.map((n) => n.name), ['z', 'a', 'b', 'c'])
	assert.throws(() => placeNode(t, node('y', { under: 'a' }), { before: 'b' }), /another place/)
	assert.deepEqual(postOrder(t).map((n) => n.name), ['z', 'c', 'a', 'b'], "a node's own come before it, and the earlier sibling before the later")
	assert.deepEqual(subtree(t, 'a'), ['a', 'c'])
	assert.deepEqual(withParents('text-fits', []).map((s) => s.name), ['diagram-faults', 'text-fits'], 'a starter brings the node it hangs under')
	assert.deepEqual(withParents('text-fits', [{ name: 'diagram-faults' }]).map((s) => s.name), ['text-fits'])
	step('the tree: places, order, subtrees')
}

// ---- deciding ------------------------------------------------------------------------------------------------------------
{
	const t0 = 1_000_000
	// 1. A situation begins: the node acts on it, once.
	const tree = [node('fits')]
	const mem = {}
	let judged = { fits: { held: true, situations: [sit('b1')] } }
	observe(tree, mem, judged, t0)
	let d = decide(tree, mem, judged)
	assert.deepEqual(d.act, { node: 'fits', situations: [sit('b1')] })
	mark(mem, 'fits', d.act.situations, 'acted', t0)
	assert.equal(decide(tree, mem, judged).act, null, 'not twice for the same situation')
	// It's over: settled.
	judged = { fits: { held: false, situations: [] } }
	assert.deepEqual(observe(tree, mem, judged, t0 + 2000).map((e) => e.kind), ['done'])
	assert.equal(mem.fits.stats.done, 1)
	// Back soon after: a person undid it. Left alone.
	judged = { fits: { held: true, situations: [sit('b1')] } }
	assert.deepEqual(observe(tree, mem, judged, t0 + 5000).map((e) => e.kind), ['undone'])
	assert.equal(decide(tree, mem, judged).act, null, 'what people undid stays undone')
	// Back long after it was settled: a new situation.
	const mem2 = { fits: { sits: { b1: { s: 'done', at: t0 } }, stats: {} } }
	observe(tree, mem2, { fits: { held: false, situations: [] } }, t0 + UNDO_MS + 1)
	observe(tree, mem2, judged, t0 + UNDO_MS + 2)
	assert.ok(decide(tree, mem2, judged).act, 'long after, it is new again')
	step('a situation is answered once when it begins; what people undo stays undone')

	// 2. Acted and still there: failed, and with nothing after it, unanswered (the agent is asked).
	const m3 = {}
	observe(tree, m3, { fits: { held: false, situations: [] } }, t0)
	mark(m3, 'fits', [sit('b2')], 'acted', t0)
	assert.deepEqual(observe(tree, m3, { fits: { held: true, situations: [sit('b2')] } }, t0 + 100).map((e) => e.kind), [], 'not judged a failure before its edit can have landed')
	assert.deepEqual(observe(tree, m3, { fits: { held: true, situations: [sit('b2')] } }, t0 + SETTLE_MS).map((e) => e.kind), ['failed'])
	d = decide(tree, m3, { fits: { held: true, situations: [sit('b2')] } })
	assert.deepEqual(d.unanswered, [{ node: 'fits', situation: sit('b2') }])
	mark(m3, 'fits', [sit('b2')], 'told')
	assert.deepEqual(decide(tree, m3, { fits: { held: true, situations: [sit('b2')] } }).unanswered, [], 'asked once')
	step('a reflex that does not settle its situation asks the agent, once')

	// 3. Under and before: a node's own answer first; the earlier sibling first; a failure falls to what comes after.
	const t = [node('faults', { do: { routine: 'fallback' } }), node('fits', { under: 'faults' }), node('frames', { under: 'faults' }), node('later')]
	const m = {}
	for (const n of t) m[n.name] = { sits: {}, stats: {} }
	const j = { faults: { held: true, situations: [sit('b1'), sit('b9')] }, fits: { held: true, situations: [sit('b1')] }, frames: { held: true, situations: [sit('b1')] }, later: { held: true, situations: [sit('b1')] } }
	d = decide(t, m, j)
	assert.deepEqual(d.act, { node: 'fits', situations: [sit('b1')] }, 'the narrower node, the earlier one, takes it')
	mark(m, 'fits', [sit('b1')], 'acted')
	d = decide(t, m, j)
	// fits has b1 (acting), so frames, faults and later don't; faults still has b9, which nothing under it holds.
	assert.deepEqual(d.act, { node: 'faults', situations: [sit('b9')] }, 'the node above answers what nothing under it holds')
	m.fits.sits.b1 = { s: 'failed', at: 0 }
	d = decide(t, m, j)
	assert.deepEqual(d.act, { node: 'frames', situations: [sit('b1')] }, "a failure falls to the next node at its place")
	assert.deepEqual(d.unanswered, [], '…so the agent is not asked')
	step('the narrower node first, the earlier first, and a failure falls to what comes after')

	// 4. A group node (no answer of its own) doesn't claim; a watching node counts; a telling node tells.
	const g = [node('faults', { do: null }), node('fits', { under: 'faults', status: 'watching' }), node('notes', { do: { tell: true } })]
	const gm = {}
	d = decide(g, gm, { faults: { held: true, situations: [{ id: '*', on: [] }] }, fits: { held: true, situations: [sit('b1')] }, notes: { held: true, situations: [sit('n1')] } })
	assert.equal(d.act, null)
	assert.deepEqual(d.would, [{ node: 'fits', situations: [sit('b1')] }])
	assert.deepEqual(d.tells, [{ node: 'notes', situations: [sit('n1')] }], "a group's situation claims nothing")
	// A watching node takes nothing from a node that's on: switching an agent's node in to watch changes nothing that acts.
	const w = [node('new', { status: 'watching', do: { code: 'x' } }), node('live')]
	d = decide(w, {}, { new: { held: true, situations: [{ id: '*', on: [] }] }, live: { held: true, situations: [sit('b1')] } })
	assert.deepEqual([d.act?.node, d.would.length], ['live', 1])
	step('groups, watching and telling nodes; watching takes nothing from what acts')

	// A run that settled its situation, judged straight after in the tab: done at once, so even a quick undo reads as undone.
	const q = {}
	mark(q, 'fits', [sit('b3')], 'acted', t0)
	settled(q, 'fits', ['b3'], t0)
	assert.equal(q.fits.sits.b3.s, 'done')
	assert.deepEqual(observe([node('fits')], q, { fits: { held: true, situations: [sit('b3')] } }, t0 + 300).map((e) => e.kind), ['undone'], 'undone, not failed')
	// Switching a node back on starts the nodes under it from what's there now too.
	const sub = [node('p', { do: null }), node('c', { under: 'p' })]
	const sm = { c: { sits: {}, stats: {} } }
	rebase(sm, 'p', sub)
	assert.ok(sm.c.baseline, 'the node under it starts from what is there')
	step('a quick undo is an undo; switching a node on resets what is under it')

	// 5. Switched on: what is already the case is left as it is.
	const bm = {}
	rebase(bm, 'fits')
	observe(tree, bm, { fits: { held: true, situations: [sit('old')] } }, t0)
	assert.equal(decide(tree, bm, { fits: { held: true, situations: [sit('old'), sit('new')] } }).act.situations[0].id, 'new')
	// A node not judged (the one above doesn't hold) holds nothing; an error isn't "nothing".
	const em = { fits: { sits: { b1: { s: 'known', at: t0 } }, stats: {} } }
	assert.deepEqual(observe(tree, em, { fits: { error: 'TypeError: x' } }, t0).map((e) => e.kind), ['fault'])
	assert.ok(em.fits.sits.b1, 'what it held stays known through an error')
	step('a node switched on leaves what is already there; a failing condition is a fault, not an all-clear')

	assert.equal(braked([1, 2, 3], 10), 0)
	assert.ok(braked(Array.from({ length: 8 }, (_, i) => 1000 + i), 2000) > 2000, 'eight runs in thirty seconds: rest')
	const s = {}
	assert.ok(addAsk(s, { node: 'n', why: 'told', situation: sit('a') }))
	assert.equal(addAsk(s, { node: 'n', why: 'told', situation: sit('a') }), null, 'the same ask, once while it is open')
	assert.deepEqual(suggest({ nodes: [], runs: [{ routine: 'fit-text' }, { routine: 'fit-text' }] }).map((x) => x.starter), ['text-fits'], 'a routine run by hand again and again suggests the reflex that answers it')
	step('the brake, asks, and suggestions from work')
}

// ---- the programs ------------------------------------------------------------------------------------------------------
{
	// A pretend canvas: four shapes, one of them a plan's, and what measure() finds.
	const shapes = [
		{ id: 's1', key: 'b1', kind: 'box', text: 'long' },
		{ id: 's2', key: 'b2', kind: 'box', text: 'ok' },
		{ id: 'p1', key: 'plan:board:item:1', kind: 'box', text: 'card' },
		{ id: 'n1', key: 'note1', kind: 'note', text: 'merge these?' },
	]
	const toucan = {
		engine: 'tldraw',
		scene: { items: () => shapes, arrows: () => [], isPlan: (id) => id === 'p1' },
		measure: () => ({ findings: [{ kind: 'text outgrew its box', on: ['b1'] }, { kind: 'text outgrew its box', on: ['plan:board:item:1'] }, { kind: 'overlap', on: ['b1', 'plan:board:item:1'] }] }),
		notes: () => [{ key: 'note1', text: 'merge these?' }],
		_busyKeys: () => [],
	}
	const nodes = [
		cleanNode({ name: 'faults', when: 'return view.findings().length > 0', status: 'on' }, { compile }),
		cleanNode({ name: 'fits', when: "return view.findings('text outgrew its box').map((f) => ({ on: f.on }))", do: { routine: 'r' }, under: 'faults', status: 'on' }, { compile, nodes: [{ name: 'faults' }] }),
		cleanNode({ name: 'quiet', when: 'return false', do: { routine: 'r' }, status: 'on' }, { compile }),
		cleanNode({ name: 'under-quiet', when: 'throw new Error("never judged")', do: { routine: 'r' }, under: 'quiet', status: 'on' }, { compile, nodes: [{ name: 'quiet' }] }),
		cleanNode({ name: 'broken', when: 'return view.nothing.here', do: { routine: 'r' }, status: 'on' }, { compile }),
		cleanNode({ name: 'notes', when: 'return view.notes().map((n) => ({ on: [n.key], text: n.text }))', do: { tell: true }, status: 'on' }, { compile }),
		cleanNode({ name: 'off', when: 'return true', do: { routine: 'r' }, status: 'off' }, { compile }),
	]
	const { judged } = await new AsyncFunction('editor', 'tl', 'toucan', judgeProgram(nodes))({}, {}, toucan)
	assert.deepEqual(judged.fits.situations, [{ id: 'b1', on: ['b1'] }], "a plan's shapes are the plan's: a situation about only them goes")
	assert.equal(judged.faults.held, true)
	assert.equal(judged.quiet.held, false)
	assert.ok(!('under-quiet' in judged), 'a node is judged only while the one above it holds')
	assert.match(judged.broken.error, /TypeError/, "one node's error is its own")
	assert.deepEqual(judged.notes.situations, [{ id: 'note1', on: ['note1'], text: 'merge these?' }])
	assert.ok(!('off' in judged), 'a node switched off is not judged')
	// The answer runs with its situations in scope, and waits while someone in the tab is mid-edit.
	const act = new AsyncFunction('editor', 'tl', 'toucan', actProgram('return { summary: situations.map((s) => s.id).join() }', [{ id: 'b1', on: ['b1'] }]))
	assert.deepEqual(await act({}, {}, toucan), { _quiet: true, still: null, result: { summary: 'b1' } })
	// With the tree, it judges its node straight after, in the same tab.
	const judgedAct = new AsyncFunction('editor', 'tl', 'toucan', actProgram('return 1', [{ id: 'b1', on: ['b1'] }], nodes, 'fits'))
	assert.deepEqual((await judgedAct({}, {}, toucan)).still, ['b1'], 'still there: nothing changed it')
	// A routine's args come from the situations in scope when it runs.
	const rb = routineBody((args) => `const args = ${JSON.stringify(args)};\nreturn args`, { pad: 4 })
	assert.deepEqual(await new AsyncFunction('situations', rb)([{ id: 'a', on: ['a', 'b'] }]), { pad: 4, situations: [{ id: 'a', on: ['a', 'b'] }], on: ['a', 'b'] })
	assert.deepEqual(await act({}, {}, { ...toucan, _busyKeys: () => ['b2'] }), { _quiet: true, busy: true })
	// A trial on a copy. Here the "copy" is a fresh pretend canvas the answer can change.
	const copyOf = () => {
		const copyShapes = shapes.map((s) => ({ ...s }))
		return { ...toucan, scene: { ...toucan.scene, items: () => copyShapes }, measure: () => ({ findings: copyShapes.filter((s) => s.text === 'long').map((s) => ({ kind: 'text outgrew its box', on: [s.key] })) }) }
	}
	const trial = (body, stage) => new AsyncFunction('editor', 'tl', 'toucan', tryProgram(nodes, 'fits', body, stage))({}, {}, { ...toucan, _copy: async (fn) => fn({}, copyOf()) })
	assert.equal((await trial('for (const s of toucan.scene.items()) s.text = "short"')).verdict, 'passed')
	assert.equal((await trial('return 1')).verdict, 'not-over')
	assert.equal((await trial('return 1', 'for (const s of toucan.scene.items()) s.text = "fine"')).verdict, 'never-held', 'a stage that does not bring the situation about')
	const unavailable = await new AsyncFunction('editor', 'tl', 'toucan', tryProgram(nodes, 'fits', 'return 1'))({}, {}, toucan)
	assert.equal(unavailable.verdict, 'unavailable', 'with no copy (Excalidraw), the trial only judges')
	assert.deepEqual(shapes.map((s) => s.text), ['long', 'ok', 'card', 'merge these?'], 'the canvas itself is untouched')
	step('the judge: gating, plan shapes, errors kept apart; the answer and the trial')
}

// ---- the server's loop ---------------------------------------------------------------------------------------------------
{
	const dir = mkdtempSync(join(tmpdir(), 'toucan-reflexes-'))
	try {
		// A pretend canvas whose boxes overflow until a run fixes them.
		let overflowing = []
		const runs = [], woke = [], sent = []
		let busyNow = false
		const routines = { get: (name) => (name === 'fit-text' ? { name, engines: ['tldraw'], code: 'return { summary: "fitted" }' } : null), program: (r, args) => `/*${r.name}*/ return ${JSON.stringify(args)}` }
		const judgeTree = (nodes) => {
			const out = {}
			for (const n of nodes) out[n.name] = n.name === 'notes' ? { held: false, situations: [] } : { held: overflowing.length > 0, situations: n.under || n.do ? overflowing.map((k) => ({ id: k, on: [k] })) : overflowing.length ? [{ id: '*', on: [] }] : [] }
			return out
		}
		let fixes = true
		const r = createReflexes({
			data: dir,
			engineOf: () => 'tldraw',
			routines,
			exec: async (canvas, code, t, label, who) => {
				runs.push({ label, who })
				if (fixes) overflowing = []
				return { result: { summary: 'fitted' } }
			},
			judge: async (canvas, code) => (sent.push(code), { judged: judgeTree(r.load(canvas).nodes) }),
			busy: () => busyNow,
			agentBusy: () => false,
			live: () => true,
			broadcast: () => {},
			wake: (canvas, ask, text) => woke.push({ ask, text }),
		})
		assert.throws(() => r.add('c', { name: 'x', when: 'return 1', do: { routine: 'nope' } }), /no routine/)
		r.addStarter('c', 'text-fits', { status: 'on', by: 'Ana' })
		assert.deepEqual(r.load('c').nodes.map((n) => [n.name, n.status, n.under]), [['diagram-faults', 'on', null], ['text-fits', 'on', 'diagram-faults']])
		// First judgement: the baseline. A box already overflowing stays as it is.
		overflowing = ['old']
		await r._tick('c')
		assert.equal(runs.length, 0, 'what was there before it was switched on is left')
		overflowing = ['old', 'b1']
		busyNow = true
		await r._tick('c')
		assert.equal(runs.length, 0, 'nothing while someone is mid-edit')
		busyNow = false
		await r._tick('c')
		assert.deepEqual(runs.map((x) => [x.label, x.who.agent]), [['reflex text-fits', 'Reflex']], 'a run is an agent exec named Reflex')
		await new Promise((res) => setTimeout(res, SETTLE_MS + 50))
		await r._tick('c')
		assert.equal(r.load('c').memory['text-fits'].stats.done, 1, 'settled')
		// It acts and the situation stays: the agent is asked, and with wake on, woken.
		r.setWake('c', true)
		fixes = false
		overflowing = ['b7']
		await r._tick('c')
		await new Promise((res) => setTimeout(res, SETTLE_MS + 50))
		await r._tick('c')
		const asks = r.asks('c')
		assert.deepEqual(asks.map((a) => [a.node, a.why, a.on]), [['text-fits', 'failed', ['b7']]])
		assert.equal(woke.length, 1, 'woken for it, in a thread')
		assert.match(woke[0].text, /reflexes add .* --answers 1/, 'told how to teach the canvas')
		// The agent answers by teaching it: the ask closes.
		r.add('c', { name: 'wide-boxes', when: 'return []', do: { code: 'return 1' }, under: 'text-fits', answers: asks[0].id })
		assert.deepEqual([r.asks('c').length, r.load('c').asks[0].learned, r.load('c').nodes.at(-1).status], [0, 'wide-boxes', 'watching'], 'what an agent teaches arrives watching')
		// Persisted beside the canvas, and read back.
		const saved = JSON.parse(readFileSync(join(dir, 'c.reflexes.json'), 'utf8'))
		assert.equal(saved.nodes.length, 3)
		// The tree changes while a judgement is out: what comes back is set aside and the tree judged again.
		let release
		const gate = new Promise((res) => (release = res))
		const r2 = createReflexes({ data: dir, engineOf: () => 'tldraw', routines, exec: async () => ({}), judge: async (canvas) => (await gate, { judged: { late: { held: true, situations: [{ id: 'x', on: ['x'] }] } } }), busy: () => false, agentBusy: () => false, live: () => true, broadcast: () => {} })
		r2.add('d', { name: 'early', when: 'return []', do: { code: 'return 1' }, status: 'on' })
		const pendingTick = r2._tick('d')
		r2.add('d', { name: 'late', when: 'return []', do: { code: 'return 1' }, status: 'on' })
		release()
		await pendingTick
		assert.ok(r2.load('d').memory.late.baseline, 'a node added mid-judgement keeps its baseline for a judgement that includes it')
		r2.forget('d')
		assert.deepEqual(r.remove('c', 'text-fits'), ['text-fits', 'wide-boxes'], 'removing a node removes what is under it')
		assert.match(r.brief('c')[0], /Reflexes: 1 on/)
		assert.equal(kindOf('reflex text-fits'), 'reflex', "the work log knows a reflex's run from code an agent wrote")
		step('the server: baseline, waits for people, acts as Reflex, asks, wakes, learns, persists')
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
}
console.log('ok  reflexes')
