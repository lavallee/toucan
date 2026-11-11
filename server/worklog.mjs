// The work log: what agents and routines actually do to canvases, so toucan can learn its routines from real work.
//
// Every run through the exec path that changed something, failed, or was a routine goes into <data>/_work/log.jsonl: when,
// which canvas and engine, who (the agent's name, or "toucan" for the person's Routines menu), its label, the code, and how
// much it changed. Reads that change nothing (summary, notes, selection) aren't kept.
//
// From that, `suggest` finds code that agents keep writing by hand: the same work, give or take the names and numbers in
// it, run several times or on several canvases. Each suggestion is a chore worth banking as a routine, with an example to
// start from, and a note when an existing routine already does it (a missed routine, not a new one). `stats` says which
// routines are used, by whom, and how often they fail.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const MAX_LOG = 8 << 20 // one rotation is kept beside it, as log.1.jsonl
const MAX_CODE = 20000

export const logPath = (data) => join(data, '_work', 'log.jsonl')

/** What a run was, from its label: a routine, an import or a drawing, or code an agent wrote. */
export function kindOf(label = '') {
	if (/^routine /.test(label)) return 'routine'
	if (/^import\b/.test(label)) return 'import'
	if (/^draw\b/.test(label)) return 'draw'
	return 'exec'
}

const count = (a) => (Array.isArray(a) ? a.length : 0)

/** Appends a run, if it's worth learning from; returns the entry or null. */
export function record(data, { canvas, engine, agent, label, code, changes, ok = true, error, ms }) {
	const kind = kindOf(label)
	const changed = { added: count(changes?.added), updated: count(changes?.updated), removed: count(changes?.removed) }
	const touched = changed.added + changed.updated + changed.removed
	if (ok && !touched && kind !== 'routine') return null
	const entry = {
		t: new Date().toISOString(),
		canvas,
		engine,
		agent: String(agent || 'agent').slice(0, 40),
		kind,
		...(kind === 'routine' && { routine: label.slice('routine '.length) }),
		...(label && { label: String(label).slice(0, 200) }),
		// A routine's code is in the bank already; keep the code of everything else.
		...(kind !== 'routine' && { code: String(code ?? '').slice(0, MAX_CODE) }),
		changed,
		ok,
		...(!ok && { error: String(error ?? '').slice(0, 300) }),
		...(ms && { ms }),
	}
	const file = logPath(data)
	mkdirSync(join(data, '_work'), { recursive: true })
	if (existsSync(file) && statSync(file).size > MAX_LOG) renameSync(file, join(data, '_work', 'log.1.jsonl'))
	appendFileSync(file, JSON.stringify(entry) + '\n')
	return entry
}

/**
 * Past work brought in from elsewhere (an agent's session logs: lib/learn-codex.mjs), each entry once by its id. Returns
 * how many were new. Entries are checked like any other: a canvas name, code, a time.
 */
export function importEntries(data, entries, { engineOf = () => 'tldraw', exists = () => true } = {}) {
	const known = new Set(read(data).map((e) => e.id).filter(Boolean))
	const fresh = []
	for (const e of Array.isArray(entries) ? entries : []) {
		// Work on canvases this server doesn't have (a test server's, say) isn't this server's to learn from.
		if (!e || typeof e.id !== 'string' || known.has(e.id) || typeof e.code !== 'string' || !/^[a-z0-9][a-z0-9-_]{0,63}$/i.test(String(e.canvas)) || !exists(e.canvas)) continue
		known.add(e.id)
		fresh.push({ id: e.id.slice(0, 120), t: Number.isNaN(Date.parse(e.t)) ? new Date(0).toISOString() : new Date(e.t).toISOString(), canvas: e.canvas, engine: engineOf(e.canvas), agent: String(e.agent || 'agent').slice(0, 40), kind: 'exec', ...(e.label && { label: String(e.label).slice(0, 200) }), code: e.code.slice(0, MAX_CODE), changed: {}, ok: true, source: String(e.source || 'import').slice(0, 20) })
	}
	if (fresh.length) {
		mkdirSync(join(data, '_work'), { recursive: true })
		appendFileSync(logPath(data), fresh.map((e) => JSON.stringify(e)).join('\n') + '\n')
	}
	return fresh.length
}

/** Entries since a time (ISO, epoch ms, or a span like 30d / 12h), oldest first, from the log and its rotation. */
export function read(data, since) {
	const after = sinceMs(since)
	const out = []
	for (const f of [join(data, '_work', 'log.1.jsonl'), logPath(data)]) {
		if (!existsSync(f)) continue
		for (const line of readFileSync(f, 'utf8').split('\n')) {
			if (!line) continue
			try {
				const e = JSON.parse(line)
				if (Date.parse(e.t) >= after) out.push(e)
			} catch {}
		}
	}
	return out
}

export function sinceMs(since) {
	if (!since) return 0
	const span = String(since).match(/^(\d+)\s*(m|h|d|w)$/)
	if (span) return Date.now() - Number(span[1]) * { m: 60e3, h: 3600e3, d: 86400e3, w: 604800e3 }[span[2]]
	return /^\d+$/.test(since) ? Number(since) : Date.parse(since) || 0
}

// ---- learning ------------------------------------------------------------------------------------------------------------

/**
 * Code reduced to what it does: comments, the text in strings, numbers and whitespace go, so two runs that differ only in
 * which box, which colour or how far still match. A routine's `const args = …` prefix goes too.
 */
export function shapeOf(code) {
	return String(code)
		.replace(/^const args = .*;\n/, '')
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/(^|[^:])\/\/.*$/gm, '$1')
		.replace(/`(?:\\[\s\S]|[^`\\])*`/g, '`T`')
		.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, 'S')
		// A regular expression where a value can start (after ( , = : and the like): its pattern is names too.
		.replace(/([(,=:[!&|?{;]\s*|\breturn\s+)\/(?![*/])(?:\\.|\[(?:\\.|[^\]])*\]|[^/\n\\])+\/[dgimsuy]*/g, '$1R')
		.replace(/\b\d+(\.\d+)?\b/g, '0')
		.replace(/\s+/g, ' ')
		.trim()
}
const tokens = (shape) => new Set(shape.match(/[A-Za-z_$][\w$]*|[^\s\w]/g) ?? [])
/**
 * What code touches, whatever its form: the toucan and editor calls it makes and the properties it sets. Two scripts that
 * both set growY and h through updateShapes are the same chore, written differently.
 */
export const touches = (code) =>
	new Set([...String(code).matchAll(/\b(?:toucan|editor)\.(?:tidy\.)?(\w+)/g)].map((m) => `call:${m[1]}`).concat([...String(code).matchAll(/[{,]\s*(\w+)\s*:/g)].map((m) => `set:${m[1]}`)).filter((t) => !/^call:(get|text|idFor|keyOf|graph|summary|getShape|getCurrentPageShapes|getCurrentPageId|getShapePageBounds)$|^set:(id|type)$/.test(t)))
const jaccard = (a, b) => {
	let n = 0
	for (const t of a) if (b.has(t)) n++
	return n / (a.size + b.size - n || 1)
}

// toucan.tidy calls that are routines already: code an agent wrote around them was a routine it could have run.
const COVERED = { align: 'align-boxes', distribute: 'distribute-evenly', matchSizes: 'match-sizes', fixOverlaps: 'fix-overlaps', fitFrames: 'fit-frames', neatArrows: 'neat-arrows', colourByFrame: 'colour-by-frame', layOut: 'lay-out-again', all: 'clean-up', rerouteBlocked: 'tidy-arrows' }

// Hand-written code that does what a routine does, by what it sets: the habits behind the routines toucan learned from use.
const DOES = [
	{ routine: 'arrows-to-links', test: (c) => /\bremove\s*\(/.test(c) && /\bsee\s*:/.test(c) },
	{ routine: 'fit-text', test: (c) => /\bgrowY\b/.test(c) },
	{ routine: 'clear-arrow-labels', test: (c) => /\blabelPosition\b/.test(c) },
	{ routine: 'frame-these', test: (c) => /reparentShapes|\bparent\s*:/.test(c) && /\bframe\s*\(/.test(c) },
	{ routine: 'open-details', test: (c) => /detail:/.test(c) && /dotted/.test(c) },
]

/** Routines that already do what this code does: it calls their helpers, sets what they set, or it is their code. */
function coveredBy(code, shape, banked) {
	const hits = new Set()
	for (const d of DOES) if (d.test(String(code))) hits.add(d.routine)
	for (const m of String(code).matchAll(/toucan\.tidy\.(\w+)\s*\(/g)) if (COVERED[m[1]]) hits.add(COVERED[m[1]])
	if (/toucan\.measure\s*\(/.test(code) && !/update|create|delete|node\(|edge\(/.test(code)) hits.add('check-diagram')
	for (const r of banked) if (r.shape === shape || jaccard(tokens(r.shape), tokens(shape)) > 0.9) hits.add(r.name)
	return [...hits]
}

/**
 * Chores worth banking: hand-written runs that repeat, grouped by what they do. `min` is how many runs make a habit;
 * something done on several canvases counts for more than the same canvas over and over.
 */
export function suggest(entries, { routines = [], min = 3, limit = 20 } = {}) {
	const banked = routines.map((r) => ({ name: r.name, shape: shapeOf(r.code) }))
	const groups = []
	for (const e of entries) {
		if (e.kind !== 'exec' || !e.ok || !e.code) continue
		const shape = shapeOf(e.code)
		if (shape.length < 40) continue // a one-liner isn't a chore
		const toks = tokens(shape), touched = touches(e.code)
		// The same code give or take names and numbers; or, for scripts of a few lines, the same calls and properties.
		const g = groups.find((x) => x.shape === shape || jaccard(x.tokens, toks) >= 0.85 || (shape.length < 1500 && x.shape.length < 1500 && touched.size >= 2 && jaccard(x.touched, touched) >= 0.75))
		if (g) g.runs.push(e)
		else groups.push({ shape, tokens: toks, touched, runs: [e] })
	}
	return groups
		.map((g) => {
			const canvases = [...new Set(g.runs.map((r) => r.canvas))]
			const latest = g.runs.at(-1)
			return {
				id: createHash('sha256').update(g.shape).digest('hex').slice(0, 10),
				runs: g.runs.length,
				canvases,
				engines: [...new Set(g.runs.map((r) => r.engine))],
				agents: [...new Set(g.runs.map((r) => r.agent))],
				labels: [...new Set(g.runs.map((r) => r.label).filter(Boolean))].slice(0, 5),
				first: g.runs[0].t,
				last: latest.t,
				coveredBy: coveredBy(latest.code, g.shape, banked),
				example: latest.code,
				score: g.runs.length + 2 * (canvases.length - 1),
			}
		})
		// A habit: done `min` times, or done on more than one canvas, which says it isn't about one diagram.
		.filter((s) => s.runs >= min || s.canvases.length >= 2)
		.sort((a, b) => b.score - a.score || Date.parse(b.last) - Date.parse(a.last))
		.slice(0, limit)
		.map(({ score, ...s }) => s)
}

/** How each routine is used: runs, by people or agents, failures, where, and when last. */
export function stats(entries, routines = []) {
	const by = new Map(routines.map((r) => [r.name, { name: r.name, title: r.title, kind: r.kind, runs: 0, byPeople: 0, byAgents: 0, failed: 0, canvases: new Set(), engines: new Set(), last: null, errors: [] }]))
	let handWritten = 0
	for (const e of entries) {
		if (e.kind !== 'routine') {
			if (e.kind === 'exec') handWritten++
			continue
		}
		const s = by.get(e.routine) ?? by.set(e.routine, { name: e.routine, title: e.routine, kind: 'unknown', runs: 0, byPeople: 0, byAgents: 0, failed: 0, canvases: new Set(), engines: new Set(), last: null, errors: [] }).get(e.routine)
		s.runs++
		e.agent === 'toucan' ? s.byPeople++ : s.byAgents++
		if (!e.ok) (s.failed++, s.errors.length < 3 && s.errors.push(e.error))
		s.canvases.add(e.canvas)
		s.engines.add(e.engine)
		s.last = e.t
	}
	return {
		routines: [...by.values()].map((s) => ({ ...s, canvases: s.canvases.size, engines: [...s.engines] })).sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name)),
		handWritten,
	}
}
