// The trail: what agents changed on a canvas while no person had it open. Edits made in a headless
// page land with nobody watching, so each one is appended to <data>/<name>.log.jsonl (time, source,
// what ran, and the keys added, updated or removed) for `toucan log` and the app's
// "while you were away" notice.

import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const trailPath = (dir, canvas) => join(dir, `${canvas}.log.jsonl`)

/** What ran, in one line: the CLI's label if it sent one, else the start of the code. */
const what = (label, code) => (label ? String(label) : String(code ?? '').replace(/\s+/g, ' ').trim()).slice(0, 200)

// A tab reports `changes: {added, updated, removed}` as rows ({id, key, type, text}); the trail keeps keys.
const keys = (a) => (Array.isArray(a) ? a.map((r) => (typeof r === 'string' ? r : r?.key ?? r?.id)).filter((k) => typeof k === 'string').slice(0, 500) : [])

/** Appends an entry when the exec changed something; returns it (or null). */
export function record(dir, canvas, { source, label, code, changes, ok = true, error }) {
	const entry = { t: new Date().toISOString(), source, what: what(label, code), added: keys(changes?.added), updated: keys(changes?.updated), removed: keys(changes?.removed) }
	if (!ok) entry.error = String(error ?? '').slice(0, 200)
	if (!entry.added.length && !entry.updated.length && !entry.removed.length) return null
	appendFileSync(trailPath(dir, canvas), JSON.stringify(entry) + '\n')
	return entry
}

/** Entries after `since` (an ISO time or epoch ms), oldest first. */
export function read(dir, canvas, since) {
	const f = trailPath(dir, canvas)
	if (!existsSync(f)) return []
	const after = since ? (/^\d+$/.test(since) ? Number(since) : Date.parse(since)) : 0
	if (Number.isNaN(after)) throw new Error('since: an ISO time or epoch milliseconds')
	return readFileSync(f, 'utf8')
		.split('\n')
		.filter(Boolean)
		.map((l) => {
			try {
				return JSON.parse(l)
			} catch {
				return null
			}
		})
		.filter((e) => e && Date.parse(e.t) > after)
}
