// End-to-end check of reflexes on a headless server: a starter switched on answers what happens after (not what was there),
// in one labelled run; what people undo stays undone; a reflex that can't settle its situation asks; a trial runs on a copy
// and leaves the canvas as it was; Excalidraw judges the same tree.
//
//   npm run build && node scripts/reflexes-e2e.mjs
//
// Throwaway HOME and data directory, like the other e2e checks.

import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir, platform, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (!existsSync(join(ROOT, 'dist/index.html'))) throw new Error('build the app first: npm run build')
const home = mkdtempSync(join(tmpdir(), 'toucan-home-')), data = mkdtempSync(join(tmpdir(), 'toucan-data-'))
const port = await new Promise((r) => {
	const s = createServer().listen(0, '127.0.0.1', () => (r(s.address().port), s.close()))
})
const env = { ...process.env, HOME: home, XDG_DATA_HOME: join(home, '.local/share'), TOUCAN_REFLEX_QUIET: '300', PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), platform() === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright') }
for (const k of ['TOUCAN_URL', 'TOUCAN_CANVAS', 'TOUCAN_AGENT']) delete env[k]
const server = spawn(process.execPath, [join(ROOT, 'server/index.mjs'), '--port', String(port), '--data', data, '--headless'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''
server.stdout.on('data', (d) => (log += d))
server.stderr.on('data', (d) => (log += d))
for (let i = 0; i < 50 && !log.includes('listening'); i++) await new Promise((r) => setTimeout(r, 100))
const run = promisify(execFile)
const toucan = (...a) => run(process.execPath, [join(ROOT, 'bin/toucan.mjs'), ...a], { env, maxBuffer: 32 << 20 }).then((r) => r.stdout.trim())
const ex = async (canvas, code) => JSON.parse(await toucan('--canvas', canvas, 'exec', '-e', code))
const fetchStatus = async (canvas) => JSON.parse(await toucan('--canvas', canvas, 'reflexes', '--json'))
const node = async (canvas, name) => (await fetchStatus(canvas)).nodes.find((n) => n.name === name)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(what, test, ms = 20000) {
	const end = Date.now() + ms
	for (;;) {
		const v = await test()
		if (v) return v
		if (Date.now() > end) throw new Error(`timed out waiting for ${what}: ${JSON.stringify((await fetchStatus('tl').catch(() => null))?.nodes?.map((n) => [n.name, n.status, n.stats, n.last]))}`)
		await sleep(250)
	}
}
const step = (m) => console.log(`ok  ${m}`)
const LONG = 'A box whose words go on and on, far longer than the little box drawn for them, so tldraw grows it'

try {
	await toucan('new', 'tl')
	await toucan('new', 'ex', '--engine', 'excalidraw')
	await ex('tl', 'return 1') // the headless page is up
	// Something already wrong before the reflex is switched on.
	await ex('tl', `toucan.node('old', { x: 0, y: 0, w: 120, h: 50, text: ${JSON.stringify(LONG)} }); return 1`)
	assert.ok((await ex('tl', "return toucan.get('old').props.growY")) > 0, 'set up: tldraw grew the box')
	const added = JSON.parse(await toucan('--canvas', 'tl', '--agent', 'e2e', 'reflexes', 'add', '--starter', 'text-fits', '--on'))
	assert.deepEqual(added.added.map((n) => [n.name, n.status]), [['diagram-faults', 'on'], ['text-fits', 'on']])
	await sleep(3500) // the baseline judgement, after the agent's quiet moment
	assert.ok((await ex('tl', "return toucan.get('old').props.growY")) > 0, 'what was wrong before it was switched on is left as it is')
	step('switched on: what was already there is left')

	// Now it happens: a box outgrows its text. The reflex fits it, in a run of its own.
	const was = await ex('tl', `toucan.node('b1', { x: 0, y: 300, w: 120, h: 50, text: ${JSON.stringify(LONG)} }); const s = toucan.get('b1'); return { h: s.props.h, growY: s.props.growY }`)
	await until('the reflex to settle b1', async () => (await node('tl', 'text-fits')).stats.done >= 1)
	assert.equal(await ex('tl', "return toucan.get('b1').props.growY"), 0, 'b1 fits its text')
	assert.ok((await ex('tl', "return toucan.get('old').props.growY")) > 0, '…and old is still as it was')
	const t = await node('tl', 'text-fits')
	assert.deepEqual([t.stats.acted, t.last.ok, t.last.on], [1, true, ['b1']])
	// (A version is saved a moment after a run lands.)
	await until('its run to be a labelled version', async () => /reflex text-fits/.test(await toucan('--canvas', 'tl', 'versions')), 8000)
	step('a box outgrows its text: fitted by the reflex, labelled in the history, nothing else touched')

	// A person puts it back (as undo would): the reflex leaves it.
	await ex('tl', `editor.updateShape({ id: toucan.idFor('b1'), type: 'geo', props: ${JSON.stringify(was)} }); return 1`)
	assert.ok((await ex('tl', "return toucan.get('b1').props.growY")) > 0, 'set up: b1 has outgrown again')
	await until('the undo to be noticed', async () => (await node('tl', 'text-fits')).stats.undone >= 1)
	await sleep(1500)
	assert.equal((await node('tl', 'text-fits')).stats.acted, 1, 'what people undid stays undone')
	step('undone by a person: left alone')

	// A reflex that can't settle what it answers asks the agent.
	await toucan('--canvas', 'tl', 'reflexes', 'add', 'stubborn', '--when', "return view.items('box').filter((s) => /stubborn/.test(s.text)).map((s) => ({ on: [s.key] }))", '--do', 'return { summary: "tried, and did nothing" }', '--about', 'A stubborn box', '--on')
	await sleep(1500)
	await ex('tl', "toucan.node('s1', { x: 400, y: 0, text: 'stubborn' }); return 1")
	const asks = await until('an ask', async () => {
		const a = JSON.parse(await toucan('--canvas', 'tl', 'reflexes', 'asks'))
		return a.length ? a : null
	})
	assert.deepEqual(asks.map((a) => [a.node, a.why, a.on]), [['stubborn', 'failed', ['s1']]])
	assert.match(await toucan('--canvas', 'tl', 'reflexes'), /ask #\d+ from stubborn \(failed\) on s1/)
	step('a reflex that cannot settle its situation asks, with what it is about')

	// What an agent teaches arrives watching. A trial runs on a copy: the canvas doesn't change.
	const taught = JSON.parse(await toucan('--canvas', 'tl', 'reflexes', 'add', 'shorten', '--when', "return view.items('box').filter((s) => /stubborn/.test(s.text)).map((s) => ({ on: [s.key] }))", '--do', "for (const s of situations) toucan.node(s.on[0], { text: 'settled' }); return { summary: 'settled' }", '--answers', String(asks[0].id)))
	assert.equal(taught.added[0].status, 'watching')
	assert.deepEqual(JSON.parse(await toucan('--canvas', 'tl', 'reflexes', 'asks')), [], 'teaching the canvas answers the ask')
	const before = await ex('tl', 'return toucan.summary().shapes.length')
	const trial = JSON.parse(await toucan('--canvas', 'tl', 'reflexes', 'try', 'text-fits', '--stage', `toucan.node('staged', { x: 0, y: 600, w: 120, h: 50, text: ${JSON.stringify(LONG)} })`))
	assert.equal(trial.verdict, 'passed', JSON.stringify(trial))
	assert.equal(await ex('tl', "return !!toucan.get('staged')"), false, 'the staged box was only ever on the copy')
	assert.equal(await ex('tl', 'return toucan.summary().shapes.length'), before)
	assert.equal((await node('tl', 'text-fits')).tried.verdict, 'passed', 'the trial is kept with the node')
	assert.equal(JSON.parse(await toucan('--canvas', 'tl', 'reflexes', 'try', 'shorten')).verdict, 'passed', 'and one taught by the agent, on what is there now')
	assert.equal(await ex('tl', "return toucan.text(toucan.get('s1')) === 'stubborn'"), true, 'still only on the copy')
	step('taught: watching, and tried on a copy of the canvas, which stays as it was')

	// The work log knows a reflex's run from hand-written code, so it doesn't suggest banking it.
	const work = readFileSync(join(data, '_work/log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
	assert.ok(work.some((e) => e.kind === 'reflex' && e.reflex === 'text-fits' && !e.code))
	assert.ok(!JSON.parse(await toucan('routine', 'suggest', '--min', '1')).suggestions.some((s) => s.labels.some((l) => /^reflex /.test(l))))
	step('the work log keeps reflex runs apart from code agents write')

	// Excalidraw judges the same tree, and the same starter fits text there.
	await ex('ex', 'return 1')
	await toucan('--canvas', 'ex', 'reflexes', 'add', '--starter', 'text-fits', '--on')
	await sleep(3500)
	await ex('ex', `return toucan.applyGraph({ tg: 1, nodes: [{ key: 'e1', text: ${JSON.stringify(LONG + ', and on, and on, and on: it keeps going past the bottom of its box')}, box: { x: 0, y: 0, w: 120, h: 40 } }], edges: [] }, { move: true })`)
	const grew = await ex('ex', "const b = editor.getSceneElements().find((e) => e.customData?.key === 'e1'), t = editor.getSceneElements().find((e) => e.containerId === b.id); return t.height + 20 > b.height")
	if (grew) {
		await until('the reflex to fit the Excalidraw box', async () => (await node('ex', 'text-fits')).stats.done >= 1)
		step('Excalidraw: the same starter fits text')
	} else {
		const n = await node('ex', 'text-fits')
		assert.ok(!n.last || n.last.ok, 'judged without errors')
		step('Excalidraw: judged without errors (Excalidraw grew the box itself, so nothing to fit)')
	}
	const unavailable = JSON.parse(await toucan('--canvas', 'ex', 'reflexes', 'try', 'text-fits'))
	assert.equal(unavailable.verdict, 'unavailable', 'no copy to try on there yet: it says so')
	console.log('ok  reflexes e2e')
} catch (e) {
	console.error(log.slice(-3000))
	throw e
} finally {
	server.kill('SIGTERM')
	await sleep(300)
	rmSync(home, { recursive: true, force: true })
	rmSync(data, { recursive: true, force: true })
}
