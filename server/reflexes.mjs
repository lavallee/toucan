// A canvas's reflexes (lib/reflexes.mjs says what they are): where they're kept, and when the tree is judged.
//
// Each canvas keeps its tree beside it, in <data>/<name>.reflexes.json, with what each node remembers, the asks it raised
// and whether the agent may be woken for them. The server judges the tree, so one tree is judged once however many tabs
// are open: when an edit has gone quiet (QUIET_MS), in the tab an agent's exec would use, with a read-only program. A node
// that acts then runs as an ordinary agent exec named "Reflex": one undo step, glowing, labelled in the history, on the
// trail if nobody watched. Nothing is judged while a person is dragging or typing, while an agent is at work on the canvas,
// or with no tab open: a reflex answers what happens while someone is there, or while the server's headless page is up.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ReflexError, SETTLE_MS, STARTERS, routineBody, settled, addAsk, askPrompt, braked, cleanNode, decide, judgeProgram, actProgram, mark, observe, placeNode, rebase, starter, subtree, suggest, treeLines, tryProgram, withParents } from '../lib/reflexes.mjs'

export { ReflexError }
export const reflexesPath = (dir, canvas) => join(dir, `${canvas}.reflexes.json`)

const QUIET_MS = Number(process.env.TOUCAN_REFLEX_QUIET ?? 1200)
const RETRY_MS = 1000
const WAKE_EVERY_MS = 10 * 60 * 1000 // the agent is woken for an ask at most this often per canvas
const SLOW_MS = 250 // a condition this slow, three times running, is set aside
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
// Checks that code parses, without running it.
const compile = (...a) => (a.length > 2 ? new AsyncFunction(...a) : new Function(...a))

export function createReflexes({ data, engineOf, routines, exec, judge, busy, agentBusy, live, broadcast, wake = null, runsOf = () => [] }) {
	const cache = new Map()
	const timers = new Map()
	const ticking = new Set()
	const recent = new Map() // canvas -> times of its last runs, for the brake
	const restUntil = new Map()
	const forgotten = new Set() // archived: nothing of a tick still in flight is written back

	function load(canvas) {
		if (cache.has(canvas)) return cache.get(canvas)
		const f = reflexesPath(data, canvas)
		let state = { nodes: [], memory: {}, asks: [], next: 1, wake: false }
		if (existsSync(f)) {
			try {
				state = { ...state, ...JSON.parse(readFileSync(f, 'utf8')) }
			} catch (e) {
				// A file that can't be read is kept aside, not overwritten: it may be someone's tree.
				renameSync(f, `${f}.unreadable-${Date.now()}`)
				console.error(`reflexes of ${canvas}: ${e.message}; kept aside`)
			}
		}
		cache.set(canvas, state)
		return state
	}
	function save(canvas) {
		if (forgotten.has(canvas)) return
		const f = reflexesPath(data, canvas)
		writeFileSync(`${f}.tmp`, JSON.stringify(load(canvas), null, 1) + '\n')
		renameSync(`${f}.tmp`, f)
		broadcast(canvas, { type: 'reflexes', reflexes: status(canvas) })
	}

	function status(canvas) {
		const s = load(canvas)
		const now = Date.now()
		return {
			nodes: s.nodes.map((n) => ({ ...n, stats: s.memory[n.name]?.stats ?? {}, ...(s.memory[n.name]?.last && { last: s.memory[n.name].last }), ...(s.memory[n.name]?.tried && { tried: s.memory[n.name].tried }) })),
			asks: s.asks.filter((a) => a.status === 'open').map((a) => ({ ...a, prompt: askPrompt(a, s.nodes.find((n) => n.name === a.node)) })),
			wake: !!s.wake,
			...(restUntil.get(canvas) > now && { resting: new Date(restUntil.get(canvas)).toISOString() }),
			starters: STARTERS.filter((x) => !x.engines || x.engines.includes(engineOf(canvas))).map(({ name, about, under, do: d }) => ({ name, about, ...(under && { under }), does: d ? (d.routine ? `runs ${d.routine}` : d.tell ? 'asks the agent' : 'runs its own code') : 'groups the ones under it', added: s.nodes.some((n) => n.name === name) })),
		}
	}

	const routineExists = (canvas) => (name) => {
		const r = routines.get(name)
		return !!r && r.engines.includes(engineOf(canvas))
	}

	/** Adds or replaces a node. People and agents both come here; an agent's starts watching unless it says otherwise. */
	function add(canvas, input, { before } = {}) {
		forgotten.delete(canvas)
		const s = load(canvas)
		const node = cleanNode(input, { nodes: s.nodes.filter((n) => n.name !== input?.name), routineExists: routineExists(canvas), compile })
		s.nodes = placeNode(s.nodes, node, { before })
		rebase(s.memory, node.name, s.nodes)
		s.rev = (s.rev ?? 0) + 1
		// An ask the agent answered by teaching the canvas: the ask is done, and the node says where it came from.
		if (node.answers) {
			const a = s.asks.find((x) => x.id === node.answers)
			if (a) Object.assign(a, { status: 'answered', learned: node.name, closed: new Date().toISOString() })
		}
		save(canvas)
		touched(canvas)
		return node
	}

	/** A starter, with the nodes it hangs under. */
	function addStarter(canvas, name, { status: st = 'watching', by } = {}) {
		const s = load(canvas)
		const st0 = starter(name)
		if (!st0) throw new ReflexError(`no starter ${name}; there are ${STARTERS.map((x) => x.name).join(', ')}`)
		if (st0.engines && !st0.engines.includes(engineOf(canvas))) throw new ReflexError(`${name} works on ${st0.engines.join(', ')}; this canvas is ${engineOf(canvas)}`)
		const added = []
		for (const x of withParents(name, s.nodes)) added.push(add(canvas, { name: x.name, about: x.about, when: x.when, do: x.do, under: x.under, status: x.do ? st : 'on', starter: x.name, by }))
		return added.length ? added : [s.nodes.find((n) => n.name === name)]
	}

	function setStatus(canvas, name, status) {
		const s = load(canvas)
		const n = s.nodes.find((x) => x.name === name)
		if (!n) throw new ReflexError(`no reflex ${name}`)
		if (!['on', 'watching', 'off'].includes(status)) throw new ReflexError('status: on, watching or off')
		n.status = status
		// Switched on or back on: it (and what's under it) answers what happens from now, not what is already there.
		rebase(s.memory, name, s.nodes)
		s.rev = (s.rev ?? 0) + 1
		save(canvas)
		touched(canvas)
		return n
	}

	function remove(canvas, name) {
		const s = load(canvas)
		if (!s.nodes.some((n) => n.name === name)) throw new ReflexError(`no reflex ${name}`)
		const gone = new Set(subtree(s.nodes, name))
		s.nodes = s.nodes.filter((n) => !gone.has(n.name))
		for (const g of gone) delete s.memory[g]
		s.rev = (s.rev ?? 0) + 1
		save(canvas)
		return [...gone]
	}

	function closeAsk(canvas, id, how = 'dismissed') {
		const s = load(canvas)
		const a = s.asks.find((x) => x.id === Number(id))
		if (!a) throw new ReflexError(`no ask ${id}`)
		Object.assign(a, { status: how, closed: new Date().toISOString() })
		save(canvas)
		return a
	}

	function setWake(canvas, on) {
		load(canvas).wake = !!on
		save(canvas)
		return { wake: !!on }
	}

	/** Tries a node on a copy of the canvas. What it shows is kept with the node. */
	async function trial(canvas, name, stage) {
		const s = load(canvas)
		const n = s.nodes.find((x) => x.name === name)
		if (!n) throw new ReflexError(`no reflex ${name}`)
		if (typeof stage === 'string') compile('editor', 'tl', 'toucan', stage)
		const result = await judge(canvas, tryProgram(s.nodes, name, n.do && !n.do.tell ? bodyOf(n) : null, stage), 60000)
		s.memory[name] ??= { sits: {}, stats: {} }
		s.memory[name].tried = { verdict: result?.verdict, t: new Date().toISOString(), ...(stage && { staged: true }) }
		save(canvas)
		return result
	}

	// A routine gets the situations in scope as `args.situations`, and their shapes as `args.on`: the same in a run and a trial.
	const bodyOf = (n) => (n.do.routine ? routineBody((args) => routines.program(routines.get(n.do.routine), args), n.do.args ?? {}) : n.do.code)

	// ---- the tick ------------------------------------------------------------------------------------------------------

	/** Something on the canvas changed (or a tab opened): judge the tree once it has gone quiet. */
	function touched(canvas, delay = QUIET_MS) {
		const s = load(canvas)
		if (!s.nodes.some((n) => n.status === 'on' || n.status === 'watching')) return
		clearTimeout(timers.get(canvas))
		timers.set(canvas, setTimeout(() => tick(canvas).catch((e) => console.error(`reflexes of ${canvas}: ${e.message}`)), delay))
	}

	async function tick(canvas) {
		timers.delete(canvas)
		if (ticking.has(canvas)) return touched(canvas, RETRY_MS)
		if (!live(canvas)) return // judged again when a tab opens
		if (busy(canvas) || agentBusy(canvas)) return touched(canvas, RETRY_MS)
		const rest = restUntil.get(canvas) ?? 0
		if (rest > Date.now()) return touched(canvas, rest - Date.now())
		ticking.add(canvas)
		try {
			await step(canvas)
		} finally {
			ticking.delete(canvas)
		}
	}

	async function step(canvas) {
		const s = load(canvas)
		const rev = s.rev ?? 0
		let judged
		try {
			judged = (await judge(canvas, judgeProgram(s.nodes), 8000))?.judged ?? {}
		} catch (e) {
			// No tab answered, or it closed: try when the canvas next changes.
			return
		}
		// The tree changed while it was being judged: what came back is about another tree. Judge this one.
		if ((s.rev ?? 0) !== rev || forgotten.has(canvas)) return forgotten.has(canvas) ? undefined : touched(canvas, 0)
		const now = Date.now()
		let changed = false
		for (const e of observe(s.nodes, s.memory, judged, now)) {
			changed = true
			const n = s.nodes.find((x) => x.name === e.node)
			const m = s.memory[e.node]
			if (e.kind === 'undone' && m.undoneRun >= 2 && n.status === 'on') {
				n.status = 'paused'
				ask(canvas, { node: n.name, why: 'undone', situation: e.situation, text: 'People undid what it did twice, so it has paused itself.' })
			}
			if (e.kind === 'fault' && m.faults >= 3 && n.status !== 'paused') {
				n.status = 'paused'
				ask(canvas, { node: n.name, why: 'fault', text: e.error })
			}
		}
		for (const [name, j] of Object.entries(judged)) {
			const m = s.memory[name]
			if (!m) continue
			m.slow = j.ms > SLOW_MS ? (m.slow ?? 0) + 1 : 0
			const n = s.nodes.find((x) => x.name === name)
			if (m.slow >= 3 && n && n.status !== 'paused') {
				n.status = 'paused'
				ask(canvas, { node: name, why: 'fault', text: `Its condition took ${j.ms} ms three times running, which holds up everything after it.` })
				changed = true
			}
		}
		const d = decide(s.nodes, s.memory, judged)
		for (const w of d.would) (mark(s.memory, w.node, w.situations, 'would', now), (changed = true))
		for (const t of d.tells) {
			mark(s.memory, t.node, t.situations, 'told', now)
			for (const sit of t.situations) ask(canvas, { node: t.node, why: 'told', situation: sit, text: sit.text })
			changed = true
		}
		for (const u of d.unanswered) {
			mark(s.memory, u.node, [u.situation], 'told', now)
			ask(canvas, { node: u.node, why: 'failed', situation: u.situation, text: s.memory[u.node]?.last?.summary })
			changed = true
		}
		if (d.act) return act(canvas, d.act)
		if (changed) save(canvas)
		// A run waiting to be judged settled or not, which may have changed nothing (and so touches nothing): judge again.
		if (s.nodes.some((n) => Object.values(s.memory[n.name]?.sits ?? {}).some((x) => x.s === 'acted'))) touched(canvas, SETTLE_MS)
	}

	async function act(canvas, { node: name, situations }) {
		const s = load(canvas)
		const n = s.nodes.find((x) => x.name === name)
		const runs = (recent.get(canvas) ?? []).filter((t) => Date.now() - t < 60000)
		const until = braked(runs)
		if (until) {
			restUntil.set(canvas, until)
			recent.set(canvas, [])
			save(canvas)
			return touched(canvas, until - Date.now())
		}
		let out
		try {
			out = await exec(canvas, actProgram(bodyOf(n), situations, s.nodes, name), 60000, `reflex ${name}`, { agent: 'Reflex', doing: n.about })
		} catch (e) {
			if (!s.nodes.some((x) => x.name === name)) return // removed meanwhile
			mark(s.memory, name, situations, 'known')
			const m = s.memory[name]
			m.last = { t: new Date().toISOString(), ok: false, error: String(e.message ?? e).slice(0, 300) }
			ask(canvas, { node: name, why: 'error', situation: situations[0], text: m.last.error })
			save(canvas)
			return
		}
		if (out?.busy) return touched(canvas, RETRY_MS) // someone started an edit just then
		recent.set(canvas, [...runs, Date.now()])
		if (!s.nodes.some((x) => x.name === name)) return save(canvas) // removed while it ran: nothing to remember
		mark(s.memory, name, situations, 'acted')
		// Judged in the tab straight after it ran: what it settled is done now, so an undo, however quick, reads as one.
		if (Array.isArray(out?.still)) settled(s.memory, name, situations.map((x) => x.id).filter((id) => !out.still.includes(id)))
		const summary = typeof out?.result?.summary === 'string' ? out.result.summary : null
		s.memory[name].last = { t: new Date().toISOString(), ok: true, on: [...new Set(situations.flatMap((x) => x.on))].slice(0, 20), ...(summary && { summary: summary.slice(0, 200) }) }
		save(canvas)
		// Judged again once its edit has landed: is the situation over? (Its own edit touches the canvas too, if it made one.)
		touched(canvas, QUIET_MS)
	}

	function ask(canvas, a) {
		const s = load(canvas)
		const made = addAsk(s, a)
		if (!made) return
		const lastWake = s.lastWake ?? 0
		if (s.wake && wake && made.why !== 'undone' && made.on?.length && Date.now() - lastWake > WAKE_EVERY_MS) {
			s.lastWake = Date.now()
			made.woke = true
			try {
				wake(canvas, made, askPrompt(made, s.nodes.find((n) => n.name === made.node)))
			} catch (e) {
				console.error(`reflexes of ${canvas}: couldn't wake the agent: ${e.message}`)
			}
		}
	}

	/** For the agent's brief: the tree in a line or two, and what it's asking. */
	function brief(canvas) {
		const s = load(canvas)
		if (!s.nodes.length) return []
		const on = s.nodes.filter((n) => n.status === 'on').length, watching = s.nodes.filter((n) => n.status === 'watching').length, paused = s.nodes.filter((n) => n.status === 'paused').length
		const lines = [`Reflexes: ${on} on, ${watching} watching${paused ? `, ${paused} paused` : ''} (\`reflexes\` lists them; they fix what they can by themselves, and ask about the rest).`]
		for (const a of s.asks.filter((x) => x.status === 'open').slice(0, 5)) lines.push(`Reflex ask #${a.id}: ${askPrompt(a, s.nodes.find((n) => n.name === a.node))}`)
		return lines
	}

	return {
		load,
		status,
		add,
		addStarter,
		setStatus,
		remove,
		closeAsk,
		setWake,
		trial,
		touched,
		brief,
		tree: (canvas) => treeLines(load(canvas).nodes, load(canvas).memory),
		asks: (canvas, all = false) => load(canvas).asks.filter((a) => all || a.status === 'open'),
		suggest: (canvas) => suggest({ nodes: load(canvas).nodes, asks: load(canvas).asks, runs: runsOf(canvas) }),
		forget: (canvas) => (clearTimeout(timers.get(canvas)), cache.delete(canvas), forgotten.add(canvas)),
		// For tests: judge now.
		_tick: tick,
	}
}
