// End-to-end check of the routines learned from real use: each runs through `toucan routine run` on a headless server, on
// both engines where it says it works, and does what its description promises.
//
//   npm run build && node scripts/routines-e2e.mjs
//
// Throwaway HOME and data directory, like the other e2e checks.

import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
const env = { ...process.env, HOME: home, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), platform() === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright') }
for (const k of ['TOUCAN_URL', 'TOUCAN_CANVAS', 'TOUCAN_AGENT']) delete env[k]
const server = spawn(process.execPath, [join(ROOT, 'server/index.mjs'), '--port', String(port), '--data', data, '--headless'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''
server.stdout.on('data', (d) => (log += d))
server.stderr.on('data', (d) => (log += d))
for (let i = 0; i < 50 && !log.includes('listening'); i++) await new Promise((r) => setTimeout(r, 100))
const run = promisify(execFile)
const toucan = (...a) => run(process.execPath, [join(ROOT, 'bin/toucan.mjs'), ...a], { env, maxBuffer: 32 << 20 }).then((r) => r.stdout.trim())
const ex = async (canvas, code) => JSON.parse(await toucan('--canvas', canvas, 'exec', '-e', code))
const routine = async (canvas, name, args) => JSON.parse(await toucan('--canvas', canvas, '--agent', 'eval', 'routine', 'run', name, ...(args ? ['--args', JSON.stringify(args)] : [])))
const graph = async (canvas) => ex(canvas, 'return toucan.graph()')
const step = (m) => console.log(`ok  ${m}`)

// A small flow, drawn the same way on both engines.
const FLOW = { kind: 'flow', direction: 'RIGHT', nodes: [{ id: 'a', text: 'Ask' }, { id: 'b', text: 'Build' }, { id: 'c', text: 'Check' }, { id: 'd', text: 'Done' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }, { from: 'a', to: 'd', label: 'skip' }] }

try {
	await toucan('new', 'tl')
	await toucan('new', 'ex', '--engine', 'excalidraw')
	writeFileSync(join(home, 'flow.json'), JSON.stringify(FLOW))
	for (const c of ['tl', 'ex']) {
		await ex(c, 'return 1') // the headless page is up before anything is drawn on it
		await toucan('--canvas', c, 'draw', join(home, 'flow.json'))
	}
	await new Promise((r) => setTimeout(r, 800))

	for (const c of ['tl', 'ex']) {
		// Arrows to links: the arrow goes, and each end can reach the other from its card.
		const r = await routine(c, 'arrows-to-links', { keys: ['edge:a->d'] })
		assert.equal(r.changed, 1, JSON.stringify(r))
		const g = await graph(c)
		assert.ok(!g.edges.some((e) => e.from === 'a' && e.to === 'd'), 'the arrow is gone')
		const see = (k) => g.nodes.find((n) => n.key === k).meta?.see ?? []
		assert.deepEqual([see('a').map((s) => [s.key, s.label]), see('d').map((s) => s.key)], [[['d', 'skip']], ['a']])
		assert.equal(g.edges.length, 3, 'the main path stays')
		step(`${c === 'tl' ? 'tldraw' : 'excalidraw'}: arrows to links`)

		// Open out details, and put them away again.
		await ex(c, c === 'tl' ? "toucan.node('b', { meta: { detail: 'Builds the thing, then hands it on.' } }); return 1" : "const g = toucan.graph(); await toucan.applyGraph({ tg: 1, groups: [], edges: [], nodes: [{ key: 'b', meta: { detail: 'Builds the thing, then hands it on.' } }] }); return 1")
		assert.equal((await routine(c, 'open-details')).changed, 1)
		const opened = await graph(c)
		const panel = opened.nodes.find((n) => n.key === 'detail:b')
		assert.ok(panel && /Builds the thing/.test(panel.text), 'the panel holds the detail')
		assert.ok(opened.edges.some((e) => e.from === 'b' && e.to === 'detail:b'), 'linked to its box')
		assert.match((await routine(c, 'open-details')).summary, /put away/)
		assert.ok(!(await graph(c)).nodes.some((n) => n.key === 'detail:b'), 'and put away again')
		step(`${c === 'tl' ? 'tldraw' : 'excalidraw'}: open out details, both ways`)
	}

	// Fit text: a box with more text than room.
	await ex('tl', "toucan.node('c', { text: 'Check every part of it against what was asked for, line by line, and write down what is missing before going on' }); return 1")
	await new Promise((r) => setTimeout(r, 300))
	assert.ok((await ex('tl', "return toucan.get('c').props.growY")) > 0, 'set up: tldraw grew the box')
	assert.equal((await routine('tl', 'fit-text')).changed, 1)
	assert.deepEqual(await ex('tl', "const s = toucan.get('c'); return [s.props.growY, s.props.h > 64]"), [0, true])
	await ex('ex', "const els = editor.getSceneElements(); const box = els.find((e) => e.customData?.key === 'c'); editor.updateScene({ elements: els.map((e) => e.id === box.id ? tl.newElementWith(e, { height: 12 }) : e) }); return 1")
	assert.equal((await routine('ex', 'fit-text')).changed, 1)
	assert.ok(await ex('ex', "const els = editor.getSceneElements(); const box = els.find((e) => e.customData?.key === 'c'); const t = els.find((e) => e.containerId === box.id); return box.height >= t.height + 19 && t.y >= box.y"), 'the container holds its text again')
	step('tldraw and excalidraw: fit text')

	// Frame these, then stack frames, on both engines: nothing moves on the page, and each frame carries what's in it.
	const at = (c, keys) => ex(c, `const items = toucan.scene.items(); return ${JSON.stringify(keys)}.map((k) => { const i = items.find((x) => x.key === k); return [Math.round(i.x), Math.round(i.y)] })`)
	const frameOf = (c, keys) => ex(c, `const items = toucan.scene.items(); const key = (id) => items.find((x) => x.id === id)?.key ?? null; return ${JSON.stringify(keys)}.map((k) => key(items.find((x) => x.key === k).frame))`)
	for (const c of ['tl', 'ex']) {
		const name = c === 'tl' ? 'tldraw' : 'excalidraw'
		const before = await at(c, ['a', 'b'])
		const framed = await routine(c, 'frame-these', { keys: ['a', 'b'], name: 'Start' })
		assert.equal(framed.frame, 'start')
		assert.deepEqual(await frameOf(c, ['a', 'b']), ['start', 'start'], `${name}: both boxes are in the frame`)
		assert.deepEqual(await at(c, ['a', 'b']), before, `${name}: nothing moved on the page`)
		await routine(c, 'frame-these', { keys: ['c', 'd'], name: 'Finish' })
		assert.deepEqual(await frameOf(c, ['c', 'd']), ['finish', 'finish'])
		// Knock the second frame out of line, then stack them.
		await ex(c, "const s = toucan.scene; const [st, fi] = ['start', 'finish'].map((k) => s.items().find((i) => i.key === k)); s.batch(() => s.place(fi.id, { x: st.x + 37, y: st.y + st.h + 500, w: fi.w, h: fi.h }, { carry: true })); return 1")
		const inFinish = await at(c, ['c', 'finish'])
		const stacked = await routine(c, 'stack-frames', { gap: 60 })
		assert.ok(stacked.changed >= 1, JSON.stringify(stacked))
		const [s1, s2] = await ex(c, "const items = toucan.scene.items(); return ['start', 'finish'].map((k) => { const b = items.find((i) => i.key === k); return { x: Math.round(b.x), y: Math.round(b.y), h: Math.round(b.h) } })")
		assert.deepEqual([s1.x === s2.x, s2.y - (s1.y + s1.h)], [true, 60], `${name}: one column, 60px apart`)
		const [c2, f2] = await at(c, ['c', 'finish'])
		assert.deepEqual([c2[0] - f2[0], c2[1] - f2[1]], [inFinish[0][0] - inFinish[1][0], inFinish[0][1] - inFinish[1][1]], `${name}: the frame's boxes moved with it`)
		if (process.env.SHOTS) await toucan('--canvas', c, 'screenshot', join(process.env.SHOTS, `stacked-${name}.png`))
		step(`${name}: frame these, and stack frames`)
	}

	// Clear arrow labels: a box dropped on a labelled arrow's middle.
	await ex('tl', "toucan.node('l1', { x: 0, y: 3200, w: 120, h: 60, text: 'From' }); toucan.node('l2', { x: 700, y: 3200, w: 120, h: 60, text: 'To' }); toucan.edge('l1', 'l2', { text: 'sends a report' }); toucan.node('blocker', { x: 330, y: 3190, w: 140, h: 80, text: 'In the way' }); return 1")
	const onBox = async () => (await ex('tl', 'return toucan.measure().labelOnBox'))
	assert.ok((await onBox()) > 0, 'set up: the label sits on a box')
	const cleared = await routine('tl', 'clear-arrow-labels')
	assert.equal(await onBox(), 0, JSON.stringify(cleared))
	step('tldraw: clear arrow labels')

	// Everything above ran as routines, and the work log knows it.
	const stats = JSON.parse(await toucan('routine', 'stats'))
	for (const n of ['arrows-to-links', 'open-details', 'fit-text', 'frame-these', 'stack-frames', 'clear-arrow-labels']) assert.ok(stats.routines.find((r) => r.name === n)?.runs > 0, `${n} is in the work log`)
	step('the work log counted every run')
} catch (e) {
	console.error(log.slice(-1500))
	throw e
} finally {
	server.kill()
	await new Promise((r) => setTimeout(r, 300))
	rmSync(home, { recursive: true, force: true })
	rmSync(data, { recursive: true, force: true })
}
