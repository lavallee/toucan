// Routines: chores banked once and run on any canvas, from the app's Routines menu or
// `toucan routine run`. A routine is a .js file: the body of an async function with `editor`, `tl`,
// `toucan` and `args` in scope, which may return a JSON value (its `summary` string is shown to the
// person). A comment header says what it is:
//
//   // routine: Tidy arrows
//   // description: Re-route arrows so fewer cross or run through boxes.
//   // engines: tldraw
//
// toucan ships some in routines/; people and agents bank their own in <data>/_routines/, which is
// shared by every canvas on the server. A banked routine with a shipped routine's name replaces it.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ENGINES = ['tldraw', 'excalidraw']
const HEADER = /^\/\/ (routine|description|engines):[ \t]*(.*)$/

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
	return { name, title: meta.routine || name, description: meta.description ?? '', engines: engines.length ? engines : ENGINES, code: source }
}

/** A routine file from its parts. A header already in the code gives way to the fields passed. */
export function compose({ title, description, engines, code }) {
	const body = code.split('\n').filter((l) => !HEADER.test(l)).join('\n').replace(/^\n+/, '')
	const head = [title && `// routine: ${oneLine(title)}`, description && `// description: ${oneLine(description)}`, engines?.length && `// engines: ${engines.join(', ')}`].filter(Boolean)
	return `${head.join('\n')}${head.length ? '\n\n' : ''}${body}`
}
const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim()

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
		/** The code to run on a canvas, with its arguments in scope. */
		program: (routine, args) => `const args = ${JSON.stringify(args ?? {})};\n${routine.code}`,
	}
}
