// Checks for server/trail.mjs: only edits are recorded, and `since` filters by time.
//   node scripts/trail-check.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { record, read } from '../server/trail.mjs'

const dir = mkdtempSync(join(tmpdir(), 'toucan-trail-'))
try {
	assert.equal(record(dir, 'c', { source: 'headless', code: 'return toucan.summary()', changes: { created: [], changed: [], removed: [] } }), null, 'a read is not an edit')
	assert.equal(record(dir, 'c', { source: 'headless', code: 'return 1' }), null, 'no changes reported, nothing recorded')
	const first = record(dir, 'c', { source: 'headless', code: 'toucan.node("a",\n  {x: 0})', changes: { created: ['a'], changed: [], removed: [] } })
	assert.equal(first.what, 'toucan.node("a", {x: 0})', 'code is summarised on one line')
	await new Promise((r) => setTimeout(r, 5))
	const second = record(dir, 'c', { source: 'headless', label: 'import flow.mmd', code: 'x', changes: { created: [], changed: ['a'], removed: ['b'] }, ok: false, error: 'Error: boom' })
	assert.equal(second.what, 'import flow.mmd', 'the label wins over the code')
	assert.equal(second.error, 'Error: boom', 'a failed exec that changed something is recorded with its error')
	assert.deepEqual(read(dir, 'c').map((e) => e.what), [first.what, second.what])
	assert.deepEqual(read(dir, 'c', first.t).map((e) => e.what), [second.what], 'since an ISO time')
	assert.equal(read(dir, 'c', String(Date.parse(second.t))).length, 0, 'since epoch ms')
	assert.deepEqual(read(dir, 'other'), [], 'no trail yet')
	assert.throws(() => read(dir, 'c', 'yesterday-ish'), /since/)
	console.log('ok  trail')
} finally {
	rmSync(dir, { recursive: true, force: true })
}
