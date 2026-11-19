// Reflexes: what a canvas does by itself when something happens to it, without calling a model.
//
// The idea comes from Sihan Xu's "How to Control an Agent with a Growing Behavior Tree" (https://sihanxu.me/harnesstree/)
// and The Harness by LMMs-Lab (https://github.com/EvolvingLMMs-Lab/the-harness, MIT), whose reactive layer is one tree of
// reflexes. What an agent does falls into two kinds: what happens to it, which a tree that is always judged answers at once,
// and what it sets out to do, which is the model's. Whatever the tree can't answer goes to the model, and what the model
// works out can come back as a new node: "the bigger the tree, the quieter the model". This is toucan's version, written
// from those ideas (no code of The Harness is used): the agent is a canvas, what happens to it is people's edits, and the
// model is the chat agent.
//
// A canvas has one tree, empty at first. A node is a situation and its answer:
//
//   { name, about, when, do, under, status }
//
// - `when` is the body of a function of the view (below) that says which situations the canvas is in now: nothing (none),
//   `true` (one), or a list of `{ on: [keys], text, id }` (each box with too much text, say). It is judged whenever the canvas
//   has been quiet for a moment after an edit, so it says what is the case, not what just happened.
// - `do` is the answer: `{ routine: NAME, args }` (a banked routine), `{ code }` (a function body with `situations`, `editor`,
//   `tl` and `toucan` in scope), `{ tell: true }` (ask the agent), or nothing: a node that only groups the ones under it.
// - `under` puts it under another node: it is judged only while that one holds, and answers before it.
// - `status`: `on` (it acts), `watching` (judged and counted, never acts: what an agent writes starts here) or `off`. A
//   node is `paused` by the canvas when people undo it, or its condition keeps failing.
//
// How the tree decides, after the rules of The Harness's tree:
//
//   1. A node under another answers first. A situation one of them holds is theirs: the node above answers only what is in
//      none of them, and what one of them failed to settle.
//   2. Among nodes at one place, the earlier takes a situation from the later. Order is priority.
//   3. A node has done its work when the situation it answered is over. If it is still there after the node acted, the node
//      failed, and what comes after it may take it (a later node, then the node above). If nothing does, the agent is asked.
//   4. A node that tells asks only about what nothing before it or under it is answering.
//
// And what's toucan's own, because a person is editing the same canvas:
//
// - A reflex answers a situation when it begins, once. What was already the case when a node was switched on is left as it
//   is, and so is a situation the node has answered, until it ends.
// - People win. A situation that comes back soon after a reflex settled it was most likely undone; the reflex leaves it, and
//   after two of those it pauses itself and says so. Nothing runs while someone is dragging or typing, or while an agent is
//   at work on the canvas, and every run is one undo step with a label in the history, like any agent's.
// - A brake: more than a few runs in a short time stops the tree for a minute.

export const STATUSES = ['on', 'watching', 'off', 'paused']
export const UNDO_MS = 2 * 60 * 1000 // a situation back this soon after a reflex settled it: undone, most likely
export const SETTLE_MS = 1000 // a run's edits reach every tab within this; judging sooner may see the canvas from before it
export const BRAKE = { runs: 8, withinMs: 30000, restMs: 60000 }
const MAX_SITUATIONS = 300 // per node, kept in memory
const MAX_ASKS = 50
const NAME = /^[a-z0-9][a-z0-9-_]{0,63}$/

export class ReflexError extends Error {}

const clip = (s, n = 200) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

// ---- the tree ------------------------------------------------------------------------------------------------------------

/** A node as it may be stored: checked, with only the fields a node has. `compile` checks code without running it. */
export function cleanNode(input, { nodes = [], routineExists = () => true, compile = () => {} } = {}) {
	const n = input ?? {}
	if (typeof n.name !== 'string' || !NAME.test(n.name)) throw new ReflexError('name: lower-case letters, digits, - and _, up to 64')
	if (typeof n.when !== 'string' || !n.when.trim()) throw new ReflexError('when: the body of a function of `view` that returns the situations the canvas is in')
	if (n.when.length > 20000) throw new ReflexError('when: at most 20000 characters')
	try {
		compile('view', n.when)
	} catch (e) {
		throw new ReflexError(`when doesn't compile: ${e.message}`)
	}
	let does = null
	const d = n.do
	if (d && typeof d === 'object') {
		const kinds = ['routine', 'code', 'tell'].filter((k) => d[k] !== undefined && d[k] !== false)
		if (kinds.length > 1) throw new ReflexError('do: one of routine, code or tell')
		if (kinds[0] === 'routine') {
			if (typeof d.routine !== 'string' || !routineExists(d.routine)) throw new ReflexError(`do: no routine ${d.routine} (\`toucan routine list\` has them)`)
			does = { routine: d.routine, ...(d.args && typeof d.args === 'object' && !Array.isArray(d.args) && { args: d.args }) }
		} else if (kinds[0] === 'code') {
			if (typeof d.code !== 'string' || !d.code.trim() || d.code.length > 20000) throw new ReflexError('do.code: a function body, at most 20000 characters')
			try {
				compile('situations', 'editor', 'tl', 'toucan', d.code)
			} catch (e) {
				throw new ReflexError(`do.code doesn't compile: ${e.message}`)
			}
			does = { code: d.code }
		} else if (kinds[0] === 'tell') does = { tell: true }
	} else if (d !== undefined && d !== null) throw new ReflexError('do: { routine, args } | { code } | { tell: true }, or nothing for a node that only groups others')
	const under = n.under ?? null
	if (under !== null) {
		if (under === n.name) throw new ReflexError('under: not itself')
		if (!nodes.some((x) => x.name === under)) throw new ReflexError(`under: no node ${under}`)
		// A node can't go under one of its own: the tree would have a loop.
		for (let at = under; at; at = nodes.find((x) => x.name === at)?.under ?? null) if (at === n.name) throw new ReflexError(`under: ${under} is under ${n.name}`)
	}
	const status = STATUSES.includes(n.status) ? n.status : 'watching'
	return {
		name: n.name,
		about: clip(n.about || n.name, 200),
		when: n.when,
		do: does,
		under,
		status: status === 'paused' ? 'watching' : status,
		...(n.by && { by: clip(n.by, 40) }),
		...(n.starter && { starter: clip(n.starter, 64) }),
		...(n.answers && { answers: Number(n.answers) || undefined }),
	}
}

/**
 * Puts a node in the tree: in the place of one of that name (whose nodes under it stay under it), or at the end of its place,
 * or before a sibling. Returns the new list.
 */
export function placeNode(nodes, node, { before } = {}) {
	const at = nodes.findIndex((x) => x.name === node.name)
	const rest = nodes.filter((x) => x.name !== node.name)
	if (before) {
		const i = rest.findIndex((x) => x.name === before)
		if (i < 0) throw new ReflexError(`before: no node ${before}`)
		if ((rest[i].under ?? null) !== (node.under ?? null)) throw new ReflexError(`before: ${before} is in another place in the tree`)
		return [...rest.slice(0, i), node, ...rest.slice(i)]
	}
	if (at >= 0) return [...nodes.slice(0, at), node, ...nodes.slice(at + 1)]
	return [...rest, node]
}

/** A node and every node under it, by name. */
export function subtree(nodes, name) {
	const out = [name]
	for (let i = 0; i < out.length; i++) for (const n of nodes) if (n.under === out[i]) out.push(n.name)
	return out
}

/** The nodes in the order the tree decides in: for each place, a node's own nodes before it, then its later siblings. */
export function postOrder(nodes) {
	const out = []
	const walk = (under) => {
		for (const n of nodes.filter((x) => (x.under ?? null) === under)) {
			walk(n.name)
			out.push(n)
		}
	}
	walk(null)
	return out
}

/** Nodes that are judged: those not switched off or paused, under ones that are too. */
export function judgedNodes(nodes) {
	const live = new Set()
	const walk = (under) => {
		for (const n of nodes.filter((x) => (x.under ?? null) === under)) {
			if (n.status === 'off' || n.status === 'paused') continue
			live.add(n.name)
			walk(n.name)
		}
	}
	walk(null)
	return nodes.filter((n) => live.has(n.name))
}

/** The tree as indented lines, for the CLI and the agent's brief. */
export function treeLines(nodes, memory = {}) {
	const lines = []
	const walk = (under, depth) => {
		for (const n of nodes.filter((x) => (x.under ?? null) === under)) {
			const s = memory[n.name]?.stats ?? {}
			const did = [s.acted && `acted ${s.acted}`, s.done && `settled ${s.done}`, s.failed && `failed ${s.failed}`, s.undone && `undone ${s.undone}`, s.would && `would have acted ${s.would}`, s.told && `asked ${s.told}`].filter(Boolean).join(', ')
			lines.push(`${'  '.repeat(depth)}${n.name} [${n.status}] ${n.about}: ${doesLine(n.do)}${did ? ` (${did})` : ''}`)
			walk(n.name, depth + 1)
		}
	}
	walk(null, 0)
	return lines
}
export const doesLine = (d) => (!d ? 'groups the nodes under it' : d.routine ? `runs ${d.routine}` : d.tell ? 'asks the agent' : 'runs its own code')

// ---- deciding ------------------------------------------------------------------------------------------------------------

const overlaps = (a, b) => !a.on?.length || !b.on?.length || a.on.some((k) => b.on.includes(k))
const acts = (n) => !!n.do && (n.status === 'on' || n.status === 'watching')
const freshMemory = () => ({ sits: {}, stats: {} })
const bump = (m, k, by = 1) => (m.stats[k] = (m.stats[k] ?? 0) + by)

/**
 * Brings the memory up to date with what the canvas holds now. `judged` is { [name]: { held, situations, error, ms } } for
 * the nodes that were judged; a node that wasn't (one above it doesn't hold) holds nothing. Changes `memory` and returns
 * what happened: [{ kind: 'done' | 'failed' | 'undone' | 'fault', node, situation }].
 */
export function observe(nodes, memory, judged, now = Date.now()) {
	const events = []
	for (const n of nodes) {
		const m = (memory[n.name] ??= freshMemory())
		const j = judged[n.name]
		if (j?.error) {
			m.faults = (m.faults ?? 0) + 1
			events.push({ kind: 'fault', node: n.name, error: j.error })
			continue // what it held is as unknown as before
		}
		m.faults = 0
		const held = new Map((j?.situations ?? []).map((s) => [s.id, s]))
		// The first judgement after a node was switched on: what is already the case isn't news.
		if (m.baseline) {
			for (const id of held.keys()) m.sits[id] = { s: 'known', at: now }
			delete m.baseline
			continue
		}
		for (const [id, sit] of Object.entries(m.sits)) {
			if (held.has(id)) continue
			if (sit.s === 'acted') {
				m.sits[id] = { s: 'done', at: now }
				bump(m, 'done')
				events.push({ kind: 'done', node: n.name, situation: { id } })
			} else if (sit.s === 'done' && now - sit.at < UNDO_MS) continue
			else delete m.sits[id]
		}
		for (const [id, s] of held) {
			const sit = m.sits[id]
			if (!sit) continue
			if (sit.s === 'done') {
				// Back so soon after the reflex settled it: a person undid it, most likely. Leave it to them.
				m.sits[id] = { s: 'known', at: now }
				bump(m, 'undone')
				m.undoneRun = (m.undoneRun ?? 0) + 1
				events.push({ kind: 'undone', node: n.name, situation: s })
			} else if (sit.s === 'acted' && now - sit.at >= SETTLE_MS) {
				m.sits[id] = { s: 'failed', at: now }
				bump(m, 'failed')
				events.push({ kind: 'failed', node: n.name, situation: s })
			}
		}
		// Memory stays small: the oldest of what's over goes first.
		const ids = Object.keys(m.sits)
		if (ids.length > MAX_SITUATIONS) for (const id of ids.sort((a, b) => m.sits[a].at - m.sits[b].at).slice(0, ids.length - MAX_SITUATIONS)) delete m.sits[id]
	}
	return events
}

/**
 * What the tree does now, from what it holds (`judged`) and remembers. Returns `{ act, tells, unanswered, would }`:
 * - `act`: the one node that acts this time, with the situations it answers (one run at a time: the canvas changes, and the
 *   tree is judged again before anything else acts);
 * - `tells`: situations a telling node asks the agent about;
 * - `unanswered`: situations a node failed to settle that nothing after it took;
 * - `would`: what watching nodes would have done.
 * Pure: the caller marks what it did with `mark`.
 */
export function decide(nodes, memory, judged) {
	const order = postOrder(judgedNodes(nodes))
	const held = (n) => judged[n.name]?.situations ?? []
	const stateOf = (n, id) => memory[n.name]?.sits?.[id]?.s
	const claimed = [] // situations already somebody's: held by a node earlier in the order that answers, and not failed there
	let act = null
	const tells = [], would = [], unanswered = []
	for (const [i, n] of order.entries()) {
		const mine = held(n)
		const fresh = mine.filter((s) => !stateOf(n, s.id) && !claimed.some((c) => overlaps(c, s)))
		if (acts(n) && fresh.length) {
			if (n.status === 'watching') would.push({ node: n.name, situations: fresh })
			else if (n.do.tell) tells.push({ node: n.name, situations: fresh })
			else if (!act) act = { node: n.name, situations: fresh }
		}
		// What it failed to settle and hasn't asked about: does anything after it (a later node at its place, a node above) take it?
		for (const s of mine.filter((s) => stateOf(n, s.id) === 'failed' && !memory[n.name].sits[s.id].told)) {
			const later = order.slice(i + 1).some((o) => o.status === 'on' && acts(o) && held(o).some((x) => overlaps(x, s) && !['failed', 'known'].includes(stateOf(o, x.id))))
			if (!later) unanswered.push({ node: n.name, situation: s })
		}
		if (acts(n)) claimed.push(...mine.filter((s) => stateOf(n, s.id) !== 'failed'))
	}
	return { act, tells, unanswered, would }
}

/** Records what was done about a decision. `what`: 'acted' | 'known' | 'told' | 'would' (a watching node's). */
export function mark(memory, node, situations, what, now = Date.now()) {
	const m = (memory[node] ??= freshMemory())
	for (const s of situations) {
		if (what === 'told' && m.sits[s.id]) m.sits[s.id].told = true
		else m.sits[s.id] = { s: what === 'acted' ? 'acted' : 'known', at: now, ...(what === 'told' && { told: true }) }
	}
	if (what === 'acted') bump(m, 'acted')
	if (what === 'told') bump(m, 'told', situations.length)
	if (what === 'would') bump(m, 'would', situations.length)
}

/** A node switched on (or set again): what's already the case is left as it is, and its record of undos starts over. */
export function rebase(memory, name) {
	memory[name] = { ...(memory[name] ?? freshMemory()), sits: {}, baseline: true, undoneRun: 0, faults: 0 }
}

/** The brake: too many runs too close together. Returns when the tree may act again, or 0. */
export function braked(runs, now = Date.now()) {
	const recent = runs.filter((t) => now - t < BRAKE.withinMs)
	return recent.length >= BRAKE.runs ? recent.at(-1) + BRAKE.restMs : 0
}

// ---- asks: what the tree couldn't answer -------------------------------------------------------------------------------

/** Adds an ask, unless the same one is open. Returns it, or null if it was already there. */
export function addAsk(state, { node, why, situation, text, now = Date.now() }) {
	state.asks ??= []
	const sid = situation?.id ?? '*'
	if (state.asks.some((a) => a.status === 'open' && a.node === node && a.sid === sid && a.why === why)) return null
	state.next = (state.next ?? 1)
	const ask = { id: state.next++, node, why, sid, ...(situation?.on?.length && { on: situation.on }), text: clip(text, 600), status: 'open', t: new Date(now).toISOString() }
	state.asks.push(ask)
	// Old answered ones go first, then the oldest open ones.
	while (state.asks.length > MAX_ASKS) {
		const i = state.asks.findIndex((a) => a.status !== 'open')
		state.asks.splice(i >= 0 ? i : 0, 1)
	}
	return ask
}

/** What the agent reads about an ask: the situation, and what to do about it. */
export function askPrompt(ask, node) {
	const what = { told: 'asks the agent about this', failed: 'acted, and the situation is still there', undone: 'was undone by people twice, and has paused itself', fault: 'has a condition that keeps failing, and has paused itself', error: 'failed when it ran' }[ask.why] ?? ask.why
	return [
		`The canvas's reflex "${ask.node}" (${node?.about ?? ask.node}) ${what}.`,
		ask.on?.length ? `It is about ${ask.on.join(', ')}.` : '',
		ask.text ? `It said: ${ask.text}` : '',
		`Handle it as you would a request. If it will happen again, teach the canvas: \`toucan reflexes add NAME --when CODE --routine R | --do CODE --answers ${ask.id}\` (it starts watching), \`toucan reflexes try NAME\`, and tell the person it is there to switch on.${ask.why === 'undone' ? ' People undid it: ask what they want rather than doing it again.' : ''}`,
	].filter(Boolean).join(' ')
}

// ---- starters: reflexes worth having on most canvases --------------------------------------------------------------------

/**
 * A few to switch on, each an answer to something toucan.measure() finds, from a routine toucan ships. They hang under one
 * node, "diagram-faults", which holds while the diagram has anything wrong with it: so measuring is done once, and nothing
 * under it is judged while the diagram is sound.
 */
export const STARTERS = [
	{
		name: 'diagram-faults',
		about: 'Something is wrong with the diagram as drawn',
		when: 'return view.findings().length > 0',
		do: null,
	},
	{
		name: 'text-fits',
		under: 'diagram-faults',
		about: "A box's text outgrew it",
		when: "return view.findings('text outgrew its box').map((f) => ({ on: f.on }))",
		do: { routine: 'fit-text' },
		engines: ['tldraw', 'excalidraw'],
		answers: 'fit-text',
	},
	{
		name: 'frames-hold',
		under: 'diagram-faults',
		about: 'A frame cuts off what is in it',
		when: "return view.findings('cut off by its frame').map((f) => ({ on: f.on }))",
		do: { routine: 'fit-frames' },
		engines: ['tldraw', 'excalidraw'],
		answers: 'fit-frames',
	},
	{
		name: 'arrows-clear',
		under: 'diagram-faults',
		about: 'An arrow runs through a box',
		when: "return view.findings('arrow runs through a box').map((f) => ({ on: f.on }))",
		// Only the arrows in the situation: arrows people shaped elsewhere stay as they are.
		do: {
			code: "const keys = new Set(situations.flatMap((s) => s.on))\nconst only = toucan.scene.arrows().filter((a) => keys.has(a.key)).map((a) => a.id)\nconst n = only.length ? toucan.tidy.rerouteBlocked({ only }) : 0\nreturn { summary: n ? `Rerouted ${n} arrow${n === 1 ? '' : 's'} round the boxes in the way.` : 'No arrow could go round.' }",
		},
		engines: ['tldraw', 'excalidraw'],
		answers: 'tidy-arrows',
	},
	{
		name: 'new-notes',
		about: 'Someone pinned a sticky note',
		when: 'return view.notes().map((n) => ({ on: [n.key], text: n.text }))',
		do: { tell: true },
		engines: ['tldraw'],
	},
]
export const starter = (name) => STARTERS.find((s) => s.name === name) ?? null
/** A starter and the nodes above it that aren't in the tree yet, top first. */
export function withParents(name, nodes) {
	const out = []
	for (let s = starter(name); s && !nodes.some((n) => n.name === s.name); s = s.under ? starter(s.under) : null) out.unshift(s)
	return out
}

/**
 * Reflexes worth having, from work: a routine people or agents keep running by hand on this canvas that a starter answers
 * (thinking that could be reacting), and situations the tree keeps asking about that nobody taught it.
 */
export function suggest({ nodes, asks = [], runs = [], min = 2 }) {
	const out = []
	for (const s of STARTERS.filter((s) => s.answers && !nodes.some((n) => n.name === s.name))) {
		const by = runs.filter((r) => r.routine === s.answers)
		if (by.length >= min) out.push({ starter: s.name, about: s.about, why: `${s.answers} was run by hand ${by.length} times here`, runs: by.length })
	}
	const counts = new Map()
	for (const a of asks) if (a.why !== 'undone' && !a.learned) counts.set(a.node, (counts.get(a.node) ?? 0) + 1)
	for (const [node, n] of counts) if (n >= min) out.push({ node, why: `asked the agent ${n} times without a reflex learned from it`, asks: n })
	return out
}

// ---- programs: what runs in the tab --------------------------------------------------------------------------------------

/**
 * The judge, as source: `__judge(toucan, nodes)` gives each node's situations, judging a node only while the one above it
 * holds. The view a condition reads is built lazily, once per judgement. A plan's shapes are the plan's: a situation about
 * only them is dropped, and their keys are taken out of the rest.
 */
const JUDGE = `
function __judge(toucan, editor, nodes) {
	const scene = toucan.scene
	const isPlan = (id) => !!scene?.isPlan?.(id)
	let items, byKey, findings, arrows, notes
	const all = () => (items ??= scene.items())
	const keyed = () => (byKey ??= new Map(all().map((s) => [s.key, s])))
	const planKey = (k) => { const s = keyed().get(k); return !!s && isPlan(s.id) }
	const view = {
		engine: toucan.engine,
		items: (kind) => all().filter((s) => !isPlan(s.id) && (!kind || s.kind === kind)),
		get: (key) => { const s = keyed().get(key); return s && !isPlan(s.id) ? s : null },
		arrows: () => (arrows ??= scene.arrows().filter((a) => !isPlan(a.id))),
		findings: (kind) => {
			findings ??= toucan.measure().findings.map((f) => ({ ...f, on: f.on.filter((k) => !planKey(k)) })).filter((f) => f.on.length)
			return kind === undefined ? findings : findings.filter((f) => (kind instanceof RegExp ? kind.test(f.kind) : f.kind === kind))
		},
		notes: () => (notes ??= typeof toucan.notes === 'function' ? toucan.notes().filter((n) => !planKey(n.key)) : []),
		toucan,
		editor,
	}
	const norm = (r) => {
		if (r === undefined || r === null || r === false || r === 0 || r === '') return []
		if (r === true) return [{ id: '*', on: [] }]
		return (Array.isArray(r) ? r : [r]).flatMap((s) => {
			if (typeof s === 'string') s = { on: [s] }
			if (!s || typeof s !== 'object') return []
			const asked = Array.isArray(s.on) ? s.on.filter((k) => typeof k === 'string') : []
			const on = asked.filter((k) => !planKey(k)).slice(0, 50)
			if (asked.length && !on.length) return [] // only the plan's shapes
			const text = s.text === undefined ? undefined : String(s.text).slice(0, 200)
			const id = String(s.id ?? (on.length ? [...on].sort().join(',') : text ?? '*')).slice(0, 200)
			return [{ id, on, ...(text && { text }) }]
		})
	}
	const out = {}
	const walk = (under) => {
		for (const n of nodes.filter((x) => (x.under ?? null) === under)) {
			const t0 = performance.now()
			try {
				const situations = norm(new Function('view', n.when)(view))
				const seen = new Set()
				out[n.name] = { held: situations.length > 0, situations: situations.filter((s) => !seen.has(s.id) && seen.add(s.id)), ms: Math.round(performance.now() - t0) }
			} catch (e) {
				out[n.name] = { held: false, situations: [], error: (e && e.name ? e.name + ': ' : '') + String(e && e.message || e).slice(0, 300), ms: Math.round(performance.now() - t0) }
			}
			if (out[n.name].held) walk(n.name)
		}
	}
	walk(null)
	return out
}`

const nodeList = (nodes) => JSON.stringify(nodes.map(({ name, under, when }) => ({ name, under: under ?? null, when })))

/** Judges the tree on the canvas, changing nothing. */
export function judgeProgram(nodes) {
	return `${JUDGE}\nreturn { judged: __judge(toucan, editor, ${nodeList(judgedNodes(nodes))}), _quiet: true }`
}

/** The body that answers `situations`: a routine's program (routines.program), or the node's own code. */
export const answerBody = (node, routineProgram) => (node.do.routine ? routineProgram : node.do.code)

/**
 * A node acting: nothing while someone in this tab is dragging or typing (the server checks every tab, this is the last
 * word), then its answer with `situations` in scope. Quiet: a reflex never moves the camera.
 */
export function actProgram(body, situations) {
	return `if (toucan._busyKeys?.().length) return { _quiet: true, busy: true }
const situations = ${JSON.stringify(situations)};
const __result = await (async () => {\n${body}\n})();
return { _quiet: true, result: __result === undefined ? null : __result }`
}

/**
 * A trial: on a copy of the canvas (toucan._copy, on tldraw), bring the node's situation about with `stage` if given, judge,
 * answer what it holds, and judge again. The live canvas never changes. Passed: the node held, acted, and its situations
 * were over afterwards.
 */
export function tryProgram(nodes, name, body, stage) {
	const path = []
	for (let at = nodes.find((n) => n.name === name); at; at = at.under ? nodes.find((n) => n.name === at.under) : null) path.unshift(at)
	return `${JUDGE}
if (typeof toucan._copy !== 'function') return { verdict: 'unavailable', why: 'A trial needs a copy of the canvas, which only tldraw canvases have so far. The node was judged on the canvas as it is instead.', judged: __judge(toucan, editor, ${nodeList(path)})[${JSON.stringify(name)}] ?? { held: false, situations: [] } }
return await toucan._copy(async (editor, toucan) => {
	${stage ? `try { await (async () => {\n${stage}\n})() } catch (e) { return { verdict: 'stage-failed', error: String(e && e.message || e) } }` : ''}
	const nodes = ${nodeList(path)}
	const before = __judge(toucan, editor, nodes)[${JSON.stringify(name)}]
	if (!before) return { verdict: ${stage ? "'never-held'" : "'not-judged'"}, why: 'a node above it does not hold' }
	if (before.error) return { verdict: 'condition-failed', error: before.error }
	if (!before.held) return { verdict: ${stage ? "'never-held'" : "'nothing-to-try'"}, why: ${stage ? "'the staged canvas is not in its situation'" : "'the canvas is not in its situation now: give a --stage that brings it about'"} }
	const situations = before.situations
	${body ? `let result
	try { result = await (async () => {\n${body}\n})() } catch (e) { return { verdict: 'answer-failed', held: situations, error: String(e && e.message || e) } }
	const after = __judge(toucan, editor, nodes)[${JSON.stringify(name)}] ?? { held: false, situations: [] }
	const left = situations.filter((s) => after.situations.some((x) => x.id === s.id))
	return { verdict: left.length ? 'not-over' : 'passed', held: situations, left, result: result === undefined ? null : JSON.parse(JSON.stringify(result)) }` : `return { verdict: 'held', held: situations }`}
})`
}
