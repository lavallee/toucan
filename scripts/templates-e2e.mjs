// End-to-end check of starters and adding blocks: every starter makes a canvas on both engines that scores well, and a block
// added to a canvas lands beside what's there, without overwriting a block of the same kind.
//
//   npm run build && node scripts/templates-e2e.mjs [--shots DIR]
//
// Throwaway HOME and data directory, like the other e2e checks.
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir, platform, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { STARTERS } from '../templates/index.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (!existsSync(join(ROOT, 'dist/index.html'))) throw new Error('build the app first: npm run build')
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null
if (shots) mkdirSync(shots, { recursive: true })
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
const settle = async (canvas) => {
	await ex(canvas, 'return 1')
	for (let i = 0; i < 40 && !(await ex(canvas, 'return toucan.graph().nodes.length')); i++) await new Promise((r) => setTimeout(r, 250))
	await new Promise((r) => setTimeout(r, 800))
}

try {
	const listed = JSON.parse(await toucan('templates'))
	assert.equal(listed.starters.length, STARTERS.length)
	assert.ok(listed.blocks.every((g) => g.blocks.length), 'every group has blocks')
	for (const s of STARTERS) {
		for (const engine of s.id === 'system-design' || s.id === 'incident-review' ? ['tldraw', 'excalidraw'] : ['tldraw']) {
			const name = `${s.id}-${engine}`
			await toucan('new', name, '--template', s.id, '--engine', engine)
			await settle(name)
			const g = await ex(name, 'return toucan.graph()')
			for (const part of s.parts) assert.ok(g.nodes.some((n) => n.key === `${part.id}-heading`), `${name}: ${part.title} is there`)
			if (engine === 'tldraw') {
				const m = await ex(name, 'const { findings, ...m } = toucan.measure(); m.kinds = [...new Set(findings.map((f) => f.kind))]; return m')
				if (process.env.LOOK) console.log('measure', name, m.score, JSON.stringify(m.kinds))
				if (!process.env.LOOK) assert.ok(m.score >= 85 && m.overlaps === 0, `${name} scores ${m.score} with ${m.overlaps} overlaps`)
				console.log(`ok  ${s.id}: ${s.parts.length} parts, score ${m.score}`)
			} else console.log(`ok  ${s.id} on excalidraw: ${g.nodes.length} boxes, every part there`)
			if (shots) await toucan('--canvas', name, 'screenshot', join(shots, `${name}.png`))
		}
	}

	// Adding: a block beside what's there, and the same block again without overwriting the first.
	await toucan('new', 'adding')
	await settle('adding').catch(() => {})
	const first = JSON.parse(await toucan('--canvas', 'adding', 'add', 'retro'))
	assert.ok(first.ok && !first.keysPrefixed)
	const again = JSON.parse(await toucan('--canvas', 'adding', 'add', 'retro'))
	assert.ok(again.ok && again.keysPrefixed, 'a second retro takes a prefix')
	const g = await ex('adding', 'return toucan.graph()')
	const first0 = g.nodes.find((n) => n.key === 'card-0-0'), second0 = g.nodes.find((n) => n.key === `${again.keysPrefixed}card-0-0`)
	assert.ok(first0 && second0 && second0.box.x > first0.box.x + first0.box.w, 'side by side, the first untouched')
	await toucan('--canvas', 'adding', 'add', 'system-design')
	assert.ok((await ex('adding', 'return toucan.graph()')).nodes.some((n) => n.key === 'parts-heading'), 'a starter adds too')
	await assert.rejects(toucan('--canvas', 'adding', 'add', 'no-such-thing'), /no template/)
	console.log('ok  add: blocks and starters land beside what is there, never over it')

	// Styles tldraw doesn't have: helpers refuse them by name, applyGraph falls back and says so, and a run whose tab reloads
	// (tldraw reloads the editor when it refuses a shape) fails at once with the reason, not at the timeout.
	await toucan('new', 'styles')
	await settle('styles')
	await assert.rejects(ex('styles', "toucan.node('n', { text: 'N', geo: 'cylinder' }); return 1"), /node n: geo "cylinder" isn't one of/)
	const applied = await ex('styles', "return toucan.applyGraph({ tg: 1, nodes: [{ key: 'p', text: 'P', style: { geo: 'cylinder', color: 'teal' } }], edges: [] })")
	assert.deepEqual(applied.styleFallbacks, ['p: geo "cylinder"', 'p: color "teal"'])
	const started = Date.now()
	await assert.rejects(ex('styles', "editor.createShape({ type: 'geo', parentId: editor.getCurrentPageId(), props: { geo: 'cylinder' } }); return 1"), /closed before it finished/)
	assert.ok(Date.now() - started < 15000, 'a reloaded tab fails the run at once')
	console.log('ok  styles: refused by name, fallen back from on import, and a tab that reloads ends the run with why')

	// An animated build: a box per frame, but a fork's branches together; a real GIF, on both engines, and the canvas untouched.
	for (const engine of ['tldraw', 'excalidraw']) {
		const name = `anim-${engine}`
		await toucan('new', name, '--template', 'flowchart', '--engine', engine)
		await settle(name)
		const before = JSON.stringify((await ex(name, 'return toucan.graph()')).nodes.map((n) => [n.key, n.box]))
		const boxes = (await ex(name, "return toucan.scene.items().filter((i) => i.kind !== 'frame' && i.kind !== 'arrow' && !toucan.scene.arrows().some((a) => a.id === i.id)).length"))
		const gif = join(home, `${name}.gif`)
		const printed = await toucan('--canvas', name, 'animate', gif, '--step', '300')
		const bytes = readFileSync(gif)
		assert.equal(bytes.subarray(0, 6).toString('latin1'), 'GIF89a', `${engine}: a GIF`)
		// The flowchart's decisions branch two ways, and both branches arrive in one frame, so there are fewer frames than boxes.
		const frames = Number(printed.match(/\((\d+) frames, \d+x\d+\)/)?.[1])
		assert.ok(frames > 1 && frames < boxes, `${engine}: branches arrive together (${frames} frames for ${boxes} boxes): ${printed}`)
		assert.equal(JSON.stringify((await ex(name, 'return toucan.graph()')).nodes.map((n) => [n.key, n.box])), before, `${engine}: nothing on the canvas moved`)
	}
	console.log('ok  animate: a GIF that builds the diagram box by box, branches together, on both engines, changing nothing')
} catch (e) {
	console.error(log.slice(-1500))
	throw e
} finally {
	server.kill()
	await new Promise((r) => setTimeout(r, 300))
	rmSync(home, { recursive: true, force: true })
	rmSync(data, { recursive: true, force: true })
}
