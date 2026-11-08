// The diagram eval: makes every template on a throwaway server, measures it as tldraw draws it, and scores it. Pictures and a
// report land in evals/out/. Scores can't fall below evals/baseline.json, so layout work only moves forward.
//
//   npm run build && node scripts/eval-diagrams.mjs [--update] [--only a,b]
//
// Needs playwright-core and its Chromium. Never touches ~/.config/toucan or real canvases.
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir, platform, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { TEMPLATES } from '../templates/index.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (!existsSync(join(ROOT, 'dist/index.html'))) throw new Error('build the app first: npm run build')
const { chromium } = await import('playwright-core')
const args = process.argv.slice(2)
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null
// --engine excalidraw runs only the Excalidraw part (and --engine tldraw only the tldraw part), for working on one of them.
const engine = args.includes('--engine') ? args[args.indexOf('--engine') + 1] : null
const onTldraw = engine !== 'excalidraw', onExcalidraw = engine !== 'tldraw' && !args.includes('--no-excalidraw')
const OUT = join(ROOT, 'evals/out')
mkdirSync(OUT, { recursive: true })

const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), platform() === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright')
const home = mkdtempSync(join(tmpdir(), 'toucan-eval-home-')), data = mkdtempSync(join(tmpdir(), 'toucan-eval-data-'))
const port = await new Promise((r) => {
	const s = createServer().listen(0, '127.0.0.1', () => (r(s.address().port), s.close()))
})
const env = { ...process.env, HOME: home, PLAYWRIGHT_BROWSERS_PATH: browsers }
delete env.TOUCAN_URL
delete env.TOUCAN_CANVAS
const server = spawn(process.execPath, [join(ROOT, 'server/index.mjs'), '--port', String(port), '--data', data], { env, stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 900))
const cli = promisify(execFile)
const toucan = async (...a) => (await cli(process.execPath, [join(ROOT, 'bin/toucan.mjs'), ...a], { env, maxBuffer: 64 << 20 })).stdout
const token = JSON.parse(readFileSync(join(home, '.config/toucan/server.json'), 'utf8')).token

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
await page.goto(`http://127.0.0.1:${port}/#token=${token}`)
await page.evaluate(() => localStorage.setItem('toucan.chat', 'closed'))

const results = []
const routineResults = []
const excalidrawResults = []

/** A tidy diagram knocked about the way real ones get: repeatable, so a result can be compared with the last. */
const MESS = `
	const e = window.editor
	let seed = 7
	const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
	const jitter = (n) => (rnd() - 0.5) * 2 * n
	const shapes = e.getCurrentPageShapes()
	const boxes = shapes.filter((s) => s.type === 'geo' && s.props.w >= 30 && s.props.h >= 30)
	e.updateShapes(boxes.map((s) => ({ id: s.id, type: s.type, x: s.x + jitter(26), y: s.y + jitter(26), props: { w: s.props.w * (0.95 + rnd() * 0.3), h: s.props.h * (1 + rnd() * 0.3) } })))
	// Two boxes dropped on their neighbours, within the same parent.
	const byParent = new Map()
	for (const s of boxes) (byParent.get(s.parentId) ?? byParent.set(s.parentId, []).get(s.parentId)).push(s.id)
	let dropped = 0
	for (const ids of byParent.values()) {
		if (ids.length < 2 || dropped >= 2) continue
		const a = e.getShape(ids[0]), b = e.getShape(ids[1])
		e.updateShape({ id: b.id, type: b.type, x: a.x + 40, y: a.y + 20 })
		dropped++
	}
	// Frames too small for what's in them.
	const frames = shapes.filter((s) => s.type === 'frame')
	if (frames[0]) e.updateShape({ id: frames[0].id, type: 'frame', props: { w: frames[0].props.w * 0.8, h: frames[0].props.h * 0.75 } })
	// Arrows that aim at centres again.
	for (const a of shapes.filter((s) => s.type === 'arrow')) for (const b of e.getBindingsFromShape(a, 'arrow')) {
		const size = e.getShape(b.toId)?.props
		if (size?.w >= 30 && size?.h >= 30) e.updateBinding({ id: b.id, type: 'arrow', props: { ...b.props, normalizedAnchor: { x: 0.5, y: 0.5 }, isPrecise: false } })
	}
	// And a person's note, which nothing may move.
	e.createShape({ id: 'shape:eval-note', type: 'note', parentId: e.getCurrentPageId(), x: 40, y: -240, props: { richText: window.toucan.editorRichText?.('x') } })
	return 1
`
const SNAPSHOT = `
	const e = window.editor, t = window.toucan
	const shapes = e.getCurrentPageShapes()
	return {
		texts: shapes.filter((s) => s.type === 'geo').map((s) => t.text(s)).sort(),
		parents: shapes.filter((s) => s.type === 'geo').map((s) => s.id + '>' + s.parentId).sort(),
		arrows: shapes.filter((s) => s.type === 'arrow').map((a) => e.getBindingsFromShape(a, 'arrow').map((b) => b.props.terminal + b.toId).sort().join()).sort(),
		note: (({ x, y }) => [x, y])(e.getShape('shape:eval-note')),
	}
`
const CLAIMS = {
	'align-boxes': (a, b) => b.aligned >= a.aligned,
	'distribute-evenly': (a, b) => b.lineEvenness <= a.lineEvenness + 0.02,
	'match-sizes': (a, b) => b.unevenRows <= a.unevenRows && b.sizeVariety <= a.sizeVariety,
	'fix-overlaps': (a, b) => b.overlaps === 0,
	'fit-frames': (a, b) => b.frameOverflow === 0,
	// On a diagram that's still jumbled, side-to-side routing can look no better. What it promises is that no box moves.
	'neat-arrows': (a, b) => b.overlaps === a.overlaps && b.aligned === a.aligned,
	'colour-by-frame': () => true,
	'clean-up': (a, b) => b.score > a.score && b.overlaps === 0 && b.frameOverflow === 0,
	'lay-out-again': (a, b) => b.overlaps === 0 && b.frameOverflow === 0,
	// It moves no box, so what it can promise is fewer arrows through boxes, never more.
	'tidy-arrows': (a, b) => b.throughBoxes <= a.throughBoxes && b.overlaps === a.overlaps,
	// Spread out and shortened: every box still there, and nothing newly on top of anything.
	'air-out': (a, b) => b.boxes === a.boxes && b.overlaps <= a.overlaps,
	'check-diagram': (a, b) => b.score === a.score,
}
const STEADY = new Set(['distribute-evenly', 'align-boxes', 'fix-overlaps', 'fit-frames', 'neat-arrows', 'colour-by-frame', 'match-sizes'])
const FIXTURES = ['flowchart', 'swimlane', 'org-chart', 'architecture', 'services', 'kanban', 'journey-map', 'quadrant']

/** The same knocking about on an Excalidraw canvas, made with raw element edits so the scene model isn't marking its own work. */
const MESS_EX = `
	const api = window.editor
	let seed = 7
	const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
	const jitter = (n) => (rnd() - 0.5) * 2 * n
	const els = api.getSceneElementsIncludingDeleted().map((e) => ({ ...e }))
	const byId = new Map(els.map((e) => [e.id, e]))
	const live = els.filter((e) => !e.isDeleted)
	const bump = (e) => Object.assign(e, { version: e.version + 1, versionNonce: Math.floor(rnd() * 2 ** 31), updated: Date.now() })
	const labelOf = (e) => byId.get((e.boundElements ?? []).find((b) => b.type === 'text')?.id)
	const boxes = live.filter((e) => ['rectangle', 'ellipse', 'diamond'].includes(e.type) && e.width >= 30 && e.height >= 30)
	const set = (e, o) => {
		Object.assign(e, o)
		bump(e)
		const l = labelOf(e)
		if (l) bump(Object.assign(l, { x: e.x + (e.width - l.width) / 2, y: e.y + (e.height - l.height) / 2 }))
	}
	for (const b of boxes) set(b, { x: b.x + jitter(26), y: b.y + jitter(26), width: b.width * (0.95 + rnd() * 0.3), height: b.height * (1 + rnd() * 0.3) })
	// Two boxes dropped on their neighbours, within the same frame.
	const byFrame = new Map()
	for (const b of boxes) (byFrame.get(b.frameId) ?? byFrame.set(b.frameId, []).get(b.frameId)).push(b)
	let dropped = 0
	for (const list of byFrame.values()) {
		if (list.length < 2 || dropped >= 2) continue
		set(list[1], { x: list[0].x + 40, y: list[0].y + 20 })
		dropped++
	}
	// Frames too small for what's in them.
	const frame = live.find((e) => e.type === 'frame')
	if (frame) set(frame, { width: frame.width * 0.8, height: frame.height * 0.75 })
	// Arrows that aim at centres again.
	const edge = (a, b) => {
		const cx = a.x + a.width / 2, cy = a.y + a.height / 2, dx = b.x + b.width / 2 - cx, dy = b.y + b.height / 2 - cy
		const t = Math.min(dx ? (a.width / 2 + 6) / Math.abs(dx) : Infinity, dy ? (a.height / 2 + 6) / Math.abs(dy) : Infinity)
		return [cx + dx * Math.min(t, 1), cy + dy * Math.min(t, 1)]
	}
	for (const a of live.filter((e) => e.type === 'arrow' && e.startBinding && e.endBinding)) {
		const from = byId.get(a.startBinding.elementId), to = byId.get(a.endBinding.elementId)
		if (!from || !to) continue
		const [ax, ay] = edge(from, to), [bx, by] = edge(to, from)
		const { route, ...customData } = a.customData ?? {}
		set(a, { x: ax, y: ay, points: [[0, 0], [bx - ax, by - ay]], width: Math.abs(bx - ax), height: Math.abs(by - ay), elbowed: false, roundness: { type: 2 }, customData })
		const l = labelOf(a)
		if (l) bump(Object.assign(l, { x: (ax + bx) / 2 - l.width / 2, y: (ay + by) / 2 - l.height / 2 }))
	}
	// And a person's free text, which nothing may move (Excalidraw has no sticky notes).
	const like = live.find((e) => e.type === 'text')
	if (like) els.push({ ...like, id: 'eval-note', containerId: null, frameId: null, x: 40, y: -240, text: 'x', originalText: 'x', width: 12, height: 20, boundElements: [], customData: { key: 'eval-note' }, version: 1, versionNonce: 1, index: null })
	api.updateScene({ elements: els, captureUpdate: 'IMMEDIATELY' })
	api.scrollToContent(undefined, { fitToContent: true })
	return 1
`
/** What must survive a routine on Excalidraw: boxes, frames, bindings both ways, labels in their boxes, and the person's text. */
const SNAPSHOT_EX = `
	const api = window.editor, t = window.toucan
	const els = api.getSceneElements()
	const byId = new Map(els.map((e) => [e.id, e]))
	const boxes = els.filter((e) => ['rectangle', 'ellipse', 'diamond'].includes(e.type))
	const arrows = els.filter((e) => e.type === 'arrow')
	const problems = []
	const dist = (p, b) => Math.hypot(Math.max(b.x - p.x, 0, p.x - (b.x + b.width)), Math.max(b.y - p.y, 0, p.y - (b.y + b.height)))
	for (const a of arrows) {
		const ends = [a.startBinding, a.endBinding].map((b) => b && byId.get(b.elementId))
		const pts = a.points.map(([x, y]) => ({ x: a.x + x, y: a.y + y }))
		ends.forEach((box, i) => {
			if (!box) return
			if (!(box.boundElements ?? []).some((b) => b.id === a.id)) problems.push(a.id + ': ' + box.id + " doesn't list it")
			const p = i ? pts.at(-1) : pts[0]
			if (dist(p, box) > 14) problems.push(a.id + ': ' + (i ? 'end' : 'start') + ' is ' + Math.round(dist(p, box)) + 'px from ' + box.id)
		})
		if (a.elbowed && pts.slice(1).some((p, i) => Math.abs(p.x - pts[i].x) > 1 && Math.abs(p.y - pts[i].y) > 1)) problems.push(a.id + ': an elbow with a slanted segment')
	}
	for (const b of boxes) {
		const l = byId.get((b.boundElements ?? []).find((x) => x.type === 'text')?.id)
		if (!l) continue
		const cx = l.x + l.width / 2, cy = l.y + l.height / 2
		if (l.containerId !== b.id || cx < b.x || cx > b.x + b.width || cy < b.y || cy > b.y + b.height) problems.push(b.id + ': its label is outside it')
	}
	const note = byId.get('eval-note')
	return {
		texts: boxes.map((b) => t.text(b)).sort(),
		parents: boxes.map((b) => b.id + '>' + b.frameId).sort(),
		frames: els.filter((e) => e.type === 'frame').length,
		arrows: arrows.map((a) => 'start' + a.startBinding?.elementId + ',end' + a.endBinding?.elementId).sort(),
		note: note ? [note.x, note.y] : null,
		at: els.filter((e) => e.type !== 'arrow' && !(e.type === 'text' && e.containerId)).map((e) => [e.id, Math.round(e.x), Math.round(e.y), Math.round(e.width), Math.round(e.height)].join(' ')).sort(),
		problems,
	}
`

/** Every routine on knocked-about diagrams on Excalidraw: what it claims, nothing lost, and one updateScene (one undo step). */
async function evalRoutinesExcalidraw() {
	const run = async (canvas, routine) => {
		await page.evaluate(() => {
			const api = window.editor
			window.__scenes = 0
			window.__stacks = []
			if (api.__counted !== api.updateScene) {
				const own = api.updateScene
				api.updateScene = (o, ...rest) => ((o?.captureUpdate === 'IMMEDIATELY' && (window.__scenes++, window.__stacks = [...(window.__stacks ?? []), new Error().stack.split('\n').slice(1, 6).join(' / ')])), own(o, ...rest))
				api.__counted = api.updateScene
			}
			return 1
		})
		const r = await fetch(`http://127.0.0.1:${port}/api/canvases/${canvas}/routines/${routine}/run`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: '{}' })
		const out = await r.json()
		if (!out.ok) throw new Error(`${routine} on ${canvas}: ${out.error}`)
		await page.waitForTimeout(250)
		const left = await page.evaluate(() => ({ scenes: window.__scenes, pending: window.toucan.scene.pending }))
		assert.equal(left.pending, false, `${routine} on ${canvas}: changes were left waiting after the run`)
		return { ...out.result, scenes: left.scenes }
	}
	const measure = () => page.evaluate(() => {
		const { findings, ...m } = window.toucan.measure()
		return m
	})
	const snapshot = () => page.evaluate(new Function(SNAPSHOT_EX))
	const undo = () => page.evaluate(() => {
		const target = document.querySelector('.excalidraw canvas.interactive') ?? document.querySelector('.excalidraw canvas')
		target.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true }))
		return 1
	})
	// A graph naming only what's new still joins what's there, and one that leaves out a list still applies.
	await toucan('new', 'x-apply', '--engine', 'excalidraw')
	await page.goto(`http://127.0.0.1:${port}/?canvas=x-apply`)
	await page.waitForSelector('.excalidraw')
	await page.waitForFunction(() => window.toucan?.applyGraph)
	await page.waitForTimeout(600)
	const applied = await page.evaluate(async () => {
		const t = window.toucan
		await t.applyGraph({ tg: 1, nodes: [{ key: 'b', text: 'B', box: { x: 0, y: 0, w: 160, h: 80 } }] })
		const r = await t.applyGraph({ tg: 1, groups: [], nodes: [{ key: 'p', text: 'P', box: { x: 400, y: 0, w: 160, h: 80 } }], edges: [{ from: 'b', to: 'p' }, { from: 'nowhere', to: 'p' }] })
		const els = window.editor.getSceneElements()
		const arrow = els.find((e) => e.type === 'arrow')
		return { skipped: r.skippedEdges, arrows: els.filter((e) => e.type === 'arrow').length, from: arrow && t.keyOf(els.find((e) => e.id === arrow.startBinding?.elementId)), boxes: els.filter((e) => e.type === 'rectangle').length, b: (({ x, y, width }) => [x, y, width])(t.get('b')) }
	})
	assert.deepEqual(applied, { skipped: ['nowhere->p'], arrows: 1, from: 'b', boxes: 2, b: [0, 0, 160] }, 'applyGraph on Excalidraw joins an existing box it is not given')
	console.log('ok  Excalidraw applyGraph: arrows to what is already there, and lists left out')

	console.log('\nroutines on knocked-about diagrams on Excalidraw: score before → after')
	for (const id of FIXTURES) {
		if (only && !only.includes(id)) continue
		const canvas = `xmess-${id}`
		await toucan('new', canvas, '--template', id, '--engine', 'excalidraw')
		await page.goto(`http://127.0.0.1:${port}/?canvas=${canvas}`)
		await page.waitForSelector('.excalidraw')
		await page.waitForFunction(() => window.toucan?.measure && window.editor?.getSceneElements().length > 0, null, { timeout: 15000 })
		await page.waitForTimeout(1200)
		const clean = await measure()
		const fresh = await snapshot()
		assert.deepEqual(fresh.problems, [], `${id} on Excalidraw as made`)
		await page.evaluate(new Function(MESS_EX))
		await page.waitForTimeout(400)
		const messy = await measure()
		const base = await snapshot()
		assert.deepEqual(base.problems, [], `${id} on Excalidraw, knocked about`)
		const row = { id, engine: 'excalidraw', clean: clean.score, messy: messy.score, routines: {} }
		for (const routine of Object.keys(CLAIMS)) {
			// Undoing on Excalidraw redraws arrows its own way, so a check that changes nothing is held to the canvas as it is now.
			const prior = routine === 'check-diagram' ? await measure() : messy
			const out = await run(canvas, routine)
			const after = await measure()
			const state = await snapshot()
			const what = `${routine} on ${id} (Excalidraw)`
			assert.deepEqual(state.problems, [], `${what}: bindings and labels`)
			assert.deepEqual(state.texts.length, base.texts.length, `${what}: boxes kept`)
			if (routine !== 'air-out') assert.deepEqual(state.texts, base.texts, `${what}: texts kept`)
			assert.equal(state.frames, base.frames, `${what}: frames kept`)
			assert.deepEqual(state.parents, base.parents, `${what}: frames kept`)
			assert.deepEqual(state.arrows, base.arrows, `${what}: connections kept`)
			if (routine !== 'air-out') assert.deepEqual(state.note, base.note, `${what}: the person's text stayed put`)
			assert.ok(CLAIMS[routine](prior, after), `${what} didn't do what it says: ${JSON.stringify({ before: prior, after, moved: state.at.filter((x) => !base.at.includes(x)), findings: await page.evaluate(() => window.toucan.measure().findings) })}`)
			assert.ok(out.scenes <= 1, `${what}: made ${out.scenes} updateScene calls, so ${out.scenes} undo steps: ${await page.evaluate(() => JSON.stringify(window.__stacks))}`)
			if (out.changed) assert.equal(out.scenes, 1, `${what}: changed ${out.changed} but made ${out.scenes} undo steps`)
			if (STEADY.has(routine)) {
				const again = await run(canvas, routine)
				assert.equal(again.changed, 0, `${what}: a second run should change nothing, but changed ${again.changed}`)
				assert.equal(again.scenes, 0, `${what}: a second run that changed nothing still made ${again.scenes} undo steps`)
			}
			row.routines[routine] = after.score
			if (routine === 'clean-up' && process.env.EVAL_VERBOSE) console.log('   left after clean-up:', JSON.stringify(await page.evaluate(() => [...new Set(window.toucan.measure().findings.map((f) => f.kind + ': ' + f.on.join(' ')))].slice(0, 12))))
			// EVAL_SHOTS=flowchart:clean-up,… leaves a picture of a routine's result to look at.
			if (process.env.EVAL_SHOTS?.split(',').includes(`${id}:${routine}`)) await toucan('--canvas', canvas, 'screenshot', join(OUT, `xmess-${id}-${routine}.png`), '--max', '1400')
			// One run is one undo step: Cmd-Z once, and it's as knocked about as before.
			if (routine !== 'check-diagram' && out.scenes) {
				await undo()
				await page.waitForTimeout(250)
				const back = await measure()
				const was = new Set(base.at), now = (await snapshot()).at
				assert.deepEqual(now.filter((x) => !was.has(x)), [], `${what}: one undo should put everything back`)
				// Excalidraw redraws the arrows bound to what an undo moves back, its own way, so arrow measures can drift (their
				// bindings are checked by the snapshot): every box and frame must be exactly as it was.
				const BOXES = ['boxes', 'frames', 'overlaps', 'tooClose', 'outgrew', 'frameOverflow', 'framesOverlap', 'unevenRows', 'unevenColumns', 'emptyGutter', 'aligned', 'sizeVariety', 'gapEvenness', 'lineEvenness']
				const pick = (m) => Object.fromEntries(BOXES.map((k) => [k, m[k]]))
				assert.deepEqual(pick(back), pick(messy), `${what}: one undo should reverse it`)
				assert.deepEqual((await snapshot()).problems, [], `${what}: undone, with bindings and labels intact`)
				// …and it stays undone once the tab and the server have caught up with each other.
				await page.waitForTimeout(1500)
				assert.deepEqual((await snapshot()).at.filter((x) => !was.has(x)), [], `${what}: and it stays undone`)
			}
		}
		routineResults.push(row)
		console.log(`${id.padEnd(14)} clean ${row.clean}, knocked about ${row.messy}, clean-up → ${row.routines['clean-up']}, lay out again → ${row.routines['lay-out-again']}, tidy arrows → ${row.routines['tidy-arrows']}`)
	}
}

/** Every template makes it to Excalidraw whole, and leaves pictures to look at. */
async function evalExcalidraw() {
	console.log('\ntemplates on Excalidraw:')
	const { layOut } = await import('../lib/layouts.mjs')
	for (const t of TEMPLATES) {
		if (only && !only.includes(t.id)) continue
		const canvas = `x-${t.id}`
		await toucan('new', canvas, '--template', t.id, '--engine', 'excalidraw')
		await page.goto(`http://127.0.0.1:${port}/?canvas=${canvas}`)
		await page.waitForSelector('.excalidraw')
		await page.waitForFunction(() => window.toucan && window.editor?.getSceneElements().length > 0, null, { timeout: 15000 })
		await page.waitForTimeout(900)
		const want = await layOut(t)
		const got = await page.evaluate(() => {
			const shapes = window.editor.getSceneElements().filter((e) => !(e.type === 'text' && e.containerId))
			return { boxes: shapes.filter((e) => !['arrow', 'frame'].includes(e.type)).length, arrows: shapes.filter((e) => e.type === 'arrow').length, frames: shapes.filter((e) => e.type === 'frame').length }
		})
		assert.deepEqual(got, { boxes: want.nodes.length, arrows: want.edges.length, frames: want.groups.length }, `${t.id} on Excalidraw`)
		// Every label readable: not the colour of what's behind it, and not wrapped mid-word.
		const labels = await page.evaluate(() => {
			const els = window.editor.getSceneElements()
			const byId = new Map(els.map((e) => [e.id, e]))
			return els.filter((e) => e.type === 'text' && e.containerId).map((e) => {
				const box = byId.get(e.containerId)
				const words = e.originalText.split(/\s+/)
				return { text: e.originalText, sameColour: box?.fillStyle === 'solid' && box.backgroundColor?.toLowerCase() === e.strokeColor?.toLowerCase(), broken: e.text.split('\n').some((line) => line.trim() && !e.originalText.includes(line.trim())) || words.some((w) => w.length && !e.text.includes(w)) }
			})
		})
		assert.deepEqual(labels.filter((l) => l.sameColour).map((l) => l.text), [], `${t.id} on Excalidraw: labels the colour of their box`)
		assert.deepEqual(labels.filter((l) => l.broken).map((l) => l.text), [], `${t.id} on Excalidraw: labels wrapped mid-word`)
		await toucan('--canvas', canvas, 'screenshot', join(OUT, `x-${t.id}.png`), '--max', '1400')
		// Measured as Excalidraw draws it, by the same rules as on tldraw. Reported, not held to tldraw's baseline.
		const { score, findings, ...m } = await page.evaluate(() => window.toucan.measure())
		excalidrawResults.push({ id: t.id, score, ...m })
		console.log(`${String(score).padStart(3)}  ${t.id.padEnd(16)} over ${m.overlaps} grew ${m.outgrew} frame ${m.frameOverflow} thru ${m.throughBoxes} cross ${m.crossings} labelOn ${m.labelOnBox} uneven ${m.unevenRows} squeezed ${m.labelSqueezed} close ${m.tooClose} aligned ${m.aligned} text ${m.textAtFit}${findings.length ? '  ' + [...new Set(findings.map((f) => f.kind))].join(', ') : ''}`)
	}
	console.log(`ok  all whole, with pictures in evals/out/`)
}

async function evalRoutines() {
	const run = async (canvas, routine) => {
		const r = await fetch(`http://127.0.0.1:${port}/api/canvases/${canvas}/routines/${routine}/run`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: '{}' })
		const out = await r.json()
		if (!out.ok) throw new Error(`${routine} on ${canvas}: ${out.error}`)
		await page.waitForTimeout(250)
		return out.result
	}
	const measure = () => page.evaluate(() => {
		const { findings, ...m } = window.toucan.measure()
		return m
	})
	const snapshot = () => page.evaluate(new Function(SNAPSHOT))
	console.log('\nroutines on knocked-about diagrams: score before → after')
	for (const id of FIXTURES) {
		if (only && !only.includes(id)) continue
		const canvas = `mess-${id}`
		await toucan('new', canvas, '--template', id)
		await page.goto(`http://127.0.0.1:${port}/?canvas=${canvas}`)
		await page.waitForSelector('.tl-canvas')
		await page.waitForFunction(() => window.editor?.getCurrentPageShapes().length > 0, null, { timeout: 15000 })
		await page.waitForTimeout(1200)
		const clean = await measure()
		await page.evaluate(new Function(MESS.replace("props: { richText: window.toucan.editorRichText?.('x') }", 'props: {}')))
		await page.evaluate(() => {
			window.editor.markHistoryStoppingPoint('after mess')
			window.editor.zoomToFit({ animation: { duration: 0 } })
			return 1
		})
		await page.waitForTimeout(300)
		const messy = await measure()
		const base = await snapshot()
		const row = { id, engine: 'tldraw', clean: clean.score, messy: messy.score, routines: {} }
		for (const routine of Object.keys(CLAIMS)) {
			const out = await run(canvas, routine)
			const after = await measure()
			const state = await snapshot()
			assert.deepEqual(state.texts.length, base.texts.length, `${routine} on ${id}: boxes kept`)
			if (routine !== 'check-diagram') assert.deepEqual(state.parents, base.parents, `${routine} on ${id}: frames kept`)
			assert.deepEqual(state.arrows, base.arrows, `${routine} on ${id}: connections kept`)
			// Air out spreads everything, notes included, so each stays by what it's about.
			if (routine !== 'air-out') assert.deepEqual(state.note, base.note, `${routine} on ${id}: the note stayed put`)
			assert.ok(CLAIMS[routine](messy, after), `${routine} on ${id} didn't do what it says: ${JSON.stringify({ before: messy, after })}`)
			if (STEADY.has(routine)) {
				const again = await run(canvas, routine)
				assert.equal(again.changed, 0, `${routine} on ${id}: a second run should change nothing, but changed ${again.changed}`)
			}
			row.routines[routine] = after.score
			if (routine === 'clean-up' && process.env.EVAL_VERBOSE) console.log('   left after clean-up:', JSON.stringify(await page.evaluate(() => [...new Set(window.toucan.measure().findings.map((f) => f.kind + ': ' + f.on.join(' ')))].slice(0, 12))), JSON.stringify({ aligned: after.aligned, textAtFit: after.textAtFit }))
			// One run is one undo step. A routine that changed nothing made none to undo.
			if (routine !== 'check-diagram' && out.changed !== 0) {
				await page.evaluate(() => {
					window.editor.undo()
					return 1
				})
				await page.waitForTimeout(150)
				const back = await measure()
				assert.equal(back.score, messy.score, `${routine} on ${id}: one undo should reverse it`)
			}
		}
		routineResults.push(row)
		console.log(`${id.padEnd(14)} clean ${row.clean}, knocked about ${row.messy}, clean-up → ${row.routines['clean-up']}, lay out again → ${row.routines['lay-out-again']}`)
	}
}

try {
	for (const t of onTldraw ? TEMPLATES : []) {
		if (only && !only.includes(t.id)) continue
		await toucan('new', `t-${t.id}`, '--template', t.id)
		await page.goto(`http://127.0.0.1:${port}/?canvas=t-${t.id}`)
		await page.waitForSelector('.tl-canvas')
		await page.waitForFunction(() => window.editor?.getCurrentPageShapes().length > 0, null, { timeout: 15000 })
		// Fonts and auto-sizing settle over a moment.
		await page.waitForTimeout(1600)
		const { score, findings, ...m } = await page.evaluate(() => window.toucan.measure())
		const png = (await toucan('--canvas', `t-${t.id}`, 'screenshot', join(OUT, `${t.id}.png`), '--max', '1400')).trim()
		results.push({ id: t.id, title: t.title, score, ...m, png })
		console.log(`${String(score).padStart(3)}  ${t.id.padEnd(16)} over ${m.overlaps} grew ${m.outgrew} frame ${m.frameOverflow} thru ${m.throughBoxes} cross ${m.crossings} labelOn ${m.labelOnBox} marker ${m.labelOnMarker} uneven ${m.unevenRows} squeezed ${m.labelSqueezed} close ${m.tooClose} short ${m.shortArrows} aligned ${m.aligned} flow ${m.flow} fit ${m.fitZoom} text ${m.textAtFit}`)
	}
	// A Mermaid import on a blank canvas should look like a template, however it got there.
	if (!only && onTldraw) {
		const mmd = join(tmpdir(), `toucan-eval-${process.pid}.mmd`)
		writeFileSync(mmd, 'flowchart TD\n a[Review the cart] --> b[Enter the delivery address]\n b --> c{Payment approved?}\n c -->|yes| d[Confirm the order and send a receipt]\n c -->|no| e[Show the error and keep the cart]\n e --> b\n')
		await toucan('new', 'import-mermaid')
		await page.goto(`http://127.0.0.1:${port}/?canvas=import-mermaid`)
		await page.waitForSelector('.tl-canvas')
		await page.waitForFunction(() => window.toucan)
		await toucan('--canvas', 'import-mermaid', 'import', mmd)
		await page.waitForTimeout(500)
		const m = await page.evaluate(() => window.toucan.measure())
		rmSync(mmd)
		assert.equal(m.outgrew, 0, `imported text outgrew its box: ${JSON.stringify(m.findings)}`)
		assert.ok(m.score >= 85, `a Mermaid import scored ${m.score}: ${JSON.stringify(m.findings)}`)
		console.log(`\nMermaid import on a blank canvas: ${m.score}`)
	}
	// Tidying can't change a timeline's dates: a bar moved sideways stays where it was put.
	if (!only && onTldraw) {
		await toucan('new', 'dated', '--template', 'roadmap')
		await page.goto(`http://127.0.0.1:${port}/?canvas=dated`)
		await page.waitForFunction(() => window.editor?.getCurrentPageShapes().length > 0, null, { timeout: 15000 })
		await page.waitForTimeout(800)
		const bar = await page.evaluate(() => {
			const s = window.editor.getCurrentPageShapes().find((x) => x.meta?.key?.startsWith('bar-'))
			window.editor.updateShape({ id: s.id, type: s.type, x: s.x + 30 })
			return { id: s.id, x: window.editor.getShapePageBounds(s.id).x, w: s.props.w }
		})
		await toucan('--canvas', 'dated', 'routine', 'run', 'clean-up')
		await page.waitForTimeout(300)
		const after = await page.evaluate((id) => ({ x: window.editor.getShapePageBounds(id).x, w: window.editor.getShape(id).props.w }), bar.id)
		assert.deepEqual([Math.abs(after.x - bar.x) < 1, after.w], [true, bar.w], `clean-up changed a date on a timeline: ${JSON.stringify({ bar, after })}`)
		console.log('ok  clean-up leaves a timeline\'s dates alone')
	}
	if (!args.includes('--no-routines') && onTldraw) await evalRoutines()
	if (onExcalidraw) await evalExcalidraw()
	if (onExcalidraw && !args.includes('--no-routines')) await evalRoutinesExcalidraw()
} finally {
	await browser.close()
	server.kill()
	rmSync(home, { recursive: true, force: true })
	rmSync(data, { recursive: true, force: true })
}
writeFileSync(join(OUT, 'report.json'), JSON.stringify(results, null, 1) + '\n')
writeFileSync(join(OUT, 'report-excalidraw.json'), JSON.stringify(excalidrawResults, null, 1) + '\n')
writeFileSync(join(OUT, 'routines.json'), JSON.stringify(routineResults, null, 1) + '\n')
const mean = (list) => Math.round(list.reduce((s, r) => s + r.score, 0) / (list.length || 1))
if (excalidrawResults.length) console.log(`\nmean score on Excalidraw ${mean(excalidrawResults)} over ${excalidrawResults.length} templates`)
console.log(`\nmean score ${mean(results)} over ${results.length} templates; page errors: ${errors.length ? errors.join(' | ') : 'none'}`)
assert.deepEqual(errors, [], 'no page errors')

const BASE = join(ROOT, 'evals/baseline.json')
if (args.includes('--update') && onTldraw && !only) {
	writeFileSync(BASE, JSON.stringify(Object.fromEntries(results.map((r) => [r.id, r.score])), null, 1) + '\n')
	console.log('baseline updated')
} else if (existsSync(BASE)) {
	const baseline = JSON.parse(readFileSync(BASE, 'utf8'))
	const worse = results.filter((r) => baseline[r.id] !== undefined && r.score < baseline[r.id])
	assert.deepEqual(worse.map((r) => `${r.id}: ${r.score} < ${baseline[r.id]}`), [], 'no template got worse')
	console.log('ok  no template scored below its baseline')
}
