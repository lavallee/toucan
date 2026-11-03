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
	'check-diagram': (a, b) => b.score === a.score,
}
const STEADY = new Set(['distribute-evenly', 'align-boxes', 'fix-overlaps', 'fit-frames', 'neat-arrows', 'colour-by-frame', 'match-sizes'])
const FIXTURES = ['flowchart', 'swimlane', 'org-chart', 'architecture', 'services', 'kanban', 'journey-map', 'quadrant']

/** Excalidraw has no measure yet, so this checks every template makes it there whole, and leaves pictures to look at. */
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
		const row = { id, clean: clean.score, messy: messy.score, routines: {} }
		for (const routine of Object.keys(CLAIMS)) {
			const out = await run(canvas, routine)
			const after = await measure()
			const state = await snapshot()
			assert.deepEqual(state.texts.length, base.texts.length, `${routine} on ${id}: boxes kept`)
			if (routine !== 'check-diagram') assert.deepEqual(state.parents, base.parents, `${routine} on ${id}: frames kept`)
			assert.deepEqual(state.arrows, base.arrows, `${routine} on ${id}: connections kept`)
			assert.deepEqual(state.note, base.note, `${routine} on ${id}: the note stayed put`)
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
	for (const t of TEMPLATES) {
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
	if (!only) {
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
	if (!args.includes('--no-routines')) await evalRoutines()
	if (!args.includes('--no-excalidraw')) await evalExcalidraw()
} finally {
	await browser.close()
	server.kill()
	rmSync(home, { recursive: true, force: true })
	rmSync(data, { recursive: true, force: true })
}
writeFileSync(join(OUT, 'report.json'), JSON.stringify(results, null, 1) + '\n')
writeFileSync(join(OUT, 'routines.json'), JSON.stringify(routineResults, null, 1) + '\n')
const mean = Math.round(results.reduce((s, r) => s + r.score, 0) / results.length)
console.log(`\nmean score ${mean} over ${results.length} templates; page errors: ${errors.length ? errors.join(' | ') : 'none'}`)
assert.deepEqual(errors, [], 'no page errors')

const BASE = join(ROOT, 'evals/baseline.json')
if (args.includes('--update')) {
	writeFileSync(BASE, JSON.stringify(Object.fromEntries(results.map((r) => [r.id, r.score])), null, 1) + '\n')
	console.log('baseline updated')
} else if (existsSync(BASE)) {
	const baseline = JSON.parse(readFileSync(BASE, 'utf8'))
	const worse = results.filter((r) => baseline[r.id] !== undefined && r.score < baseline[r.id])
	assert.deepEqual(worse.map((r) => `${r.id}: ${r.score} < ${baseline[r.id]}`), [], 'no template got worse')
	console.log('ok  no template scored below its baseline')
}
