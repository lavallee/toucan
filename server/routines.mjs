// Routines: chores banked once and run on any canvas, from the app's Routines menu or
// `toucan routine run`. A routine is a .js file: the body of an async function with `editor`, `tl`,
// `toucan` and `args` in scope, which may return a JSON value (its `summary` string is shown to the
// person). A comment header says what it is:
//
//   // routine: Tidy arrows
//   // description: Re-route arrows so fewer cross or run through boxes.
//   // engines: tldraw
//   // kind: arrows
//   // when: Arrows run through boxes or cross each other.
//   // args: maxBend (px) — how far an arrow may curve
//
// `kind` groups routines in the menu and for agents (KINDS below); `when` tells an agent when to reach for it; `args`
// says what `--args` it takes. All three are optional.
// toucan ships some in routines/; people and agents bank their own in <data>/_routines/, which is
// shared by every canvas on the server. A banked routine with a shipped routine's name replaces it.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ENGINES = ['tldraw', 'excalidraw']
const HEADER = /^\/\/ (routine|description|engines|kind|when|args):[ \t]*(.*)$/

/** What routines are for, in the order the menu shows them. */
export const KINDS = [
	{ id: 'tidy', label: 'Tidy', about: 'Neaten what is there, keeping its arrangement' },
	{ id: 'arrows', label: 'Arrows', about: 'Route, straighten and anchor arrows' },
	{ id: 'layout', label: 'Layout', about: 'Rearrange: a new layout, or more room' },
	{ id: 'style', label: 'Style', about: 'Colour, size and look' },
	{ id: 'content', label: 'Content', about: 'Change what boxes say or hold' },
	{ id: 'check', label: 'Check', about: 'Look, measure and report; changes nothing' },
	{ id: 'other', label: 'Other', about: 'Everything else' },
]
const KIND_IDS = KINDS.map((k) => k.id)

/** Splits a routine file into its header fields and code. */
export function parse(name, source) {
	const meta = {}
	for (const line of source.split('\n')) {
		const m = HEADER.exec(line)
		if (!m) {
			if (line.startsWith('//') || !line.trim()) continue
			break
		}
		meta[m[1]] = m[2].trim()
	}
	const engines = meta.engines ? meta.engines.split(/[,\s]+/).filter((e) => ENGINES.includes(e)) : ENGINES
	const kind = KIND_IDS.includes(meta.kind) ? meta.kind : 'other'
	return { name, title: meta.routine || name, description: meta.description ?? '', engines: engines.length ? engines : ENGINES, kind, when: meta.when ?? '', args: meta.args ?? '', code: source }
}

/** A routine file from its parts. The code's own header stays, except for the fields passed. */
export function compose({ title, description, engines, kind, when, args, code }) {
	const lines = code.split('\n')
	let start = 0 // where the code proper begins: the header can only be in the comments above it
	while (start < lines.length && (lines[start].startsWith('//') || !lines[start].trim())) start++
	const kept = parse('', code)
	const named = { routine: title, description, engines: engines?.join(', '), kind, when, args }
	const fields = { routine: named.routine ?? (kept.title || undefined), description: named.description ?? (kept.description || undefined), engines: named.engines ?? headerValue(lines.slice(0, start), 'engines'), ...Object.fromEntries(['kind', 'when', 'args'].map((k) => [k, named[k] ?? headerValue(lines.slice(0, start), k)])) }
	const head = Object.entries(fields).filter(([, v]) => v).map(([k, v]) => `// ${k}: ${oneLine(v)}`)
	const body = [...lines.slice(0, start).filter((l) => !HEADER.test(l)), ...lines.slice(start)].join('\n').replace(/^\n+/, '')
	return `${head.join('\n')}${head.length ? '\n\n' : ''}${body}`
}
const headerValue = (lines, field) => lines.map((l) => HEADER.exec(l)).find((m) => m?.[1] === field)?.[2]
const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim()

// Round a routine's code: the count of the plan's shapes left alone starts at nothing, and afterwards the summary mentions any.
// A routine may return nothing, or something that isn't an object; and `toucan` isn't always there (a routine tried on its own).
const PLAN_NOTE = 'left the plan views as they are'
const PLAN_BEFORE = `const __plan = typeof toucan === 'undefined' ? undefined : toucan?.scene; __plan?.planSkipped?.(true);`
const PLAN_AFTER = `const __left = __plan?.planSkipped?.() || 0;
if (!__left) return __result;
if (__result === undefined || __result === null) return { summary: ${JSON.stringify(PLAN_NOTE[0].toUpperCase() + PLAN_NOTE.slice(1))}, planSkipped: __left };
if (typeof __result !== 'object' || Array.isArray(__result)) return __result;
const __said = typeof __result.summary === 'string' ? __result.summary.trim().replace(/\\.$/, '') : '';
return { ...__result, summary: __said ? __said + ${JSON.stringify(`; ${PLAN_NOTE}`)} : ${JSON.stringify(PLAN_NOTE[0].toUpperCase() + PLAN_NOTE.slice(1))}, planSkipped: __left };`

export function createRoutines({ shipped, data }) {
	const banked = join(data, '_routines')
	const scan = (dir, source) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => ({ ...parse(f.slice(0, -3), readFileSync(join(dir, f), 'utf8')), source })) : [])
	const list = () => {
		const all = new Map([...scan(shipped, 'shipped'), ...scan(banked, 'banked')].map((r) => [r.name, r]))
		return [...all.values()].sort((a, b) => a.title.localeCompare(b.title))
	}
	return {
		list,
		get: (name) => list().find((r) => r.name === name) ?? null,
		save(name, parts) {
			mkdirSync(banked, { recursive: true })
			writeFileSync(join(banked, `${name}.js`), compose(parts))
			return parse(name, readFileSync(join(banked, `${name}.js`), 'utf8'))
		},
		/** Only banked routines can be removed; removing one that shadows a shipped routine restores it. */
		remove(name) {
			const f = join(banked, `${name}.js`)
			if (!existsSync(f)) return false
			rmSync(f)
			return true
		},
		/**
		 * The code to run on a canvas, with its arguments in scope. A canvas showing a plan keeps the plan's shapes as they are
		 * (app/scene.js counts what a run left alone), and the routine's summary says so, whichever routine it was.
		 */
		program: (routine, args) => `const args = ${JSON.stringify(args ?? {})};\n${PLAN_BEFORE}\nconst __result = await (async () => {\n${routine.code}\n})();\n${PLAN_AFTER}`,
	}
}
