// Checks for server/versions.mjs: no-op saves are skipped, steps describe what changed, naming labels
// the current state, and thinning keeps what it promises.
//   node scripts/versions-check.mjs
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diffShapes, isCurrent, list, read, save, versionsDir } from '../server/versions.mjs'

const dir = mkdtempSync(join(tmpdir(), 'toucan-versions-'))
const HOUR = 36e5, DAY = 24 * HOUR
try {
	assert.deepEqual(list(dir, 'c'), [], 'no versions yet')
	assert.deepEqual(diffShapes({ a: '1', b: '1', c: '1' }, { a: '1', b: '2', d: '1' }), { added: ['d'], updated: ['b'], removed: ['c'] })

	assert.deepEqual(diffShapes({}, { a: '1', '~page': '1' }).added, ['a'], 'other content is not reported as a shape')
	assert.equal(save(dir, 'p', { data: {}, shapes: { a: '1', '~page': '1' } }).count, 1)
	assert.equal(save(dir, 'p', { data: {}, shapes: { a: '1', '~page': '2' } }).updated, 0, 'but it does count as a change')

	const one = save(dir, 'c', { data: { doc: 1 }, shapes: { a: '1' } })
	assert.equal(one.n, 1)
	assert.equal(one.added, 1, 'the first version adds everything')
	assert.equal(save(dir, 'c', { data: { doc: 1 }, shapes: { a: '1' } }), null, 'an unchanged canvas saves nothing')
	assert.ok(isCurrent(dir, 'c', { a: '1' }))

	const two = save(dir, 'c', { label: 'import plan.mmd', source: 'agent', data: { doc: 2 }, shapes: { a: '2', b: '1' } })
	assert.deepEqual([two.n, two.added, two.updated, two.removed, two.keys], [2, 1, 1, 0, ['b', 'a']], 'a step says what it changed')
	assert.equal(two.count, 2)
	assert.deepEqual(read(dir, 'c', 1).data, { doc: 1 }, 'each version keeps its own document')
	assert.equal(read(dir, 'c', 99), null)

	const named = save(dir, 'c', { label: 'before the review', named: true, data: { doc: 2 }, shapes: { a: '2', b: '1' } })
	assert.equal(named.n, 2, 'naming the current state labels the latest version')
	assert.deepEqual(list(dir, 'c').map((v) => [v.n, v.label, !!v.named]), [[2, 'before the review', true], [1, undefined, false]], 'newest first')

	// Thinning: 10 days of an edit every 6 hours, with one named version and one restore in the old part.
	const start = Date.parse('2026-01-01T00:00:00Z')
	const at = (h) => start + h * HOUR
	let i = 0
	for (let h = 0; h <= 240; h += 1, i++) {
		const opts = h === 12 ? { named: true, label: 'keep me' } : h === 18 ? { source: 'restore' } : {}
		save(dir, 't', { data: { h }, shapes: { a: String(h) }, now: at(h), ...opts })
	}
	const kept = list(dir, 't')
	const now = at(240)
	const ageOf = (v) => (now - Date.parse(v.t)) / HOUR
	assert.equal(kept.filter((v) => ageOf(v) < 24).length, 24, 'every edit of the last day stays')
	assert.ok(kept.some((v) => v.label === 'keep me'), 'named versions stay')
	assert.ok(kept.some((v) => v.source === 'restore'), 'restores stay')
	const week = kept.filter((v) => ageOf(v) >= 24 && ageOf(v) < 7 * 24)
	assert.equal(new Set(week.map((v) => Math.floor(Date.parse(v.t) / HOUR))).size, week.length, 'at most one an hour in the last week')
	const older = kept.filter((v) => ageOf(v) >= 7 * 24 && !v.named && v.source !== 'restore')
	assert.equal(new Set(older.map((v) => Math.floor(Date.parse(v.t) / DAY))).size, older.length, 'at most one a day before that')
	assert.ok(older.length <= 4 && kept.length < 241, 'old edits are thinned')
	const pruned = 241 - kept.length
	assert.ok(pruned > 0)
	assert.ok(!existsSync(join(versionsDir(dir, 't'), '2.json.gz')) || kept.some((v) => v.n === 2), 'a thinned version loses its file')
	assert.ok(read(dir, 't', kept.at(-1).n), 'kept versions can still be read')
	// The size cap: oldest automatic versions go first; named ones and the newest stay.
	const big = (i) => ({ data: { blob: randomBytes(4000).toString('hex'), i }, shapes: { a: String(i) } })
	save(dir, 'cap', { ...big(0), named: true, label: 'keep', maxBytes: 12000 })
	for (let j = 1; j <= 6; j++) save(dir, 'cap', { ...big(j), maxBytes: 12000 })
	const capped = list(dir, 'cap')
	assert.ok(capped.length < 7, 'over the cap, versions go')
	assert.equal(capped[0].n, 7, 'the newest stays')
	assert.equal(capped.at(-1).label, 'keep', 'a named version stays')
	assert.equal(read(dir, 'cap', 2), null, 'the oldest automatic one went first')
	console.log('ok  versions')
} finally {
	rmSync(dir, { recursive: true, force: true })
}
