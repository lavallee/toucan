// The work log (server/worklog.mjs): what's kept, how repeated hand-written work is found, and what it says about routines.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { read, record, shapeOf, stats, suggest } from '../server/worklog.mjs'

const data = mkdtempSync(join(tmpdir(), 'toucan-worklog-'))
try {
	const changed = { updated: [{ key: 'a' }] }
	// Kept: a change, a failure, any routine run. Not kept: a read that changed nothing.
	assert.ok(record(data, { canvas: 'c', engine: 'tldraw', agent: 'Codex', label: 'recolour', code: 'x', changes: changed }))
	assert.equal(record(data, { canvas: 'c', agent: 'Codex', code: 'return toucan.summary()' }), null)
	assert.equal(record(data, { canvas: 'c', agent: 'Codex', code: 'boom()', ok: false, error: 'boom is not defined' }).ok, false)
	const routine = record(data, { canvas: 'c', agent: 'toucan', label: 'routine clean-up', code: 'const args = {};\n…' })
	assert.deepEqual([routine.kind, routine.routine, routine.code], ['routine', 'clean-up', undefined], "a routine's code is in the bank, not the log")
	assert.equal(read(data).length, 3)
	assert.equal(read(data, '1h').length, 3)
	assert.equal(read(data, new Date(Date.now() + 60000).toISOString()).length, 0)
	console.log("ok  worklog: changes, failures and routine runs are kept; reads aren't")

	// The same chore with different boxes, colours and distances is one habit.
	const recolour = (key, colour, n) => `// make the ${key} boxes stand out\nconst hits = editor.getCurrentPageShapes().filter((s) => s.type === 'geo' && /${key}/i.test(toucan.text(s)))\neditor.updateShapes(hits.map((s) => ({ id: s.id, type: s.type, props: { color: '${colour}' }, x: s.x + ${n} })))\nreturn hits.length`
	assert.equal(shapeOf(recolour('blocked', 'red', 10)), shapeOf(recolour('done', 'green', 40)))
	const entries = [
		...['plan', 'plan', 'roadmap', 'board'].map((canvas, i) => ({ t: new Date(Date.now() - (5 - i) * 1000).toISOString(), canvas, engine: 'tldraw', agent: 'Codex', kind: 'exec', ok: true, label: `colour ${i}`, code: recolour(`k${i}`, 'red', i) })),
		{ t: new Date().toISOString(), canvas: 'plan', engine: 'tldraw', agent: 'Codex', kind: 'exec', ok: true, code: 'toucan.node("a", { text: "A" })' },
		...[1, 2, 3].map((i) => ({ t: new Date().toISOString(), canvas: `c${i}`, engine: 'tldraw', agent: 'Codex', kind: 'exec', ok: true, code: `const n = toucan.tidy.align({ tolerance: ${i * 10} })\nconst m = toucan.tidy.distribute()\nreturn { lined: n, spaced: m }` })),
		{ t: new Date().toISOString(), canvas: 'x', engine: 'tldraw', agent: 'Codex', kind: 'exec', ok: false, code: recolour('x', 'red', 1) },
	]
	const s = suggest(entries, { routines: [{ name: 'align-boxes', code: 'const n = toucan.tidy.align(args)\nreturn { summary: `${n}` }' }] })
	assert.equal(s.length, 2, 'two habits; a one-liner and a failure are not habits')
	const [top, tidy] = s
	assert.deepEqual([top.runs, top.canvases.length, top.coveredBy], [4, 3, []], 'the recolouring: 4 runs on 3 canvases, no routine does it')
	assert.match(top.example, /k3/, 'the latest run is the example')
	assert.deepEqual(tidy.coveredBy.sort(), ['align-boxes', 'distribute-evenly'], 'hand-written tidying names the routines that already do it')
	assert.equal(suggest(entries, { min: 5 }).length, 2, 'several canvases make a habit even below the run count')
	assert.equal(suggest(entries.slice(0, 2), { min: 3 }).length, 0, 'twice on one canvas is not yet a habit')
	console.log('ok  worklog: repeated hand-written work is found, grouped by what it does, with routines that already do it')

	const st = stats([...read(data), { t: new Date().toISOString(), canvas: 'd', engine: 'excalidraw', agent: 'Codex', kind: 'routine', routine: 'clean-up', ok: false, error: 'nope' }], [{ name: 'clean-up', title: 'Clean up', kind: 'tidy' }, { name: 'air-out', title: 'Air out', kind: 'layout' }])
	const cu = st.routines.find((r) => r.name === 'clean-up')
	assert.deepEqual([cu.runs, cu.byPeople, cu.byAgents, cu.failed, cu.canvases, cu.errors], [2, 1, 1, 1, 2, ['nope']])
	assert.ok(cu.engines.includes('excalidraw'), 'and on which engines')
	assert.equal(st.routines.find((r) => r.name === 'air-out').runs, 0, 'unused routines are listed too')
	assert.equal(st.handWritten, 2)
	assert.ok(readFileSync(join(data, '_work/log.jsonl'), 'utf8').includes('"routine":"clean-up"'))
	console.log('ok  worklog: which routines are used, by people or agents, and how often they fail')
} finally {
	rmSync(data, { recursive: true, force: true })
}
