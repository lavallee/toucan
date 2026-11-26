// End-to-end check of agents noticing people (server/activity.mjs): a person has a canvas open and edits it, selects and
// comments while agents work. A terminal agent hears it with its next command, and not its own edits; another agent hears
// the first one's. The chat panel's agent, a stand-in for `codex app-server` here, is told between its commands as a steer
// of the turn in progress, and a message sent mid-turn carries what is selected then. Both engines.
//
//   npm run build && node scripts/activity-e2e.mjs
//
// Needs playwright-core and its Chromium. Throwaway HOME and data directory, like test:presence.

import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir, platform, tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { WebSocket } from 'ws'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (!existsSync(join(ROOT, 'dist/index.html'))) throw new Error('build the app first: npm run build')
const { chromium } = await import('playwright-core')

const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), platform() === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright')
const home = mkdtempSync(join(tmpdir(), 'toucan-home-'))
const data = mkdtempSync(join(tmpdir(), 'toucan-data-'))
const bin = mkdtempSync(join(tmpdir(), 'toucan-bin-'))
const steers = join(bin, 'steers.jsonl')

// A stand-in for `codex app-server`: a turn runs a "command" every 600 ms until it's interrupted, and every turn/start and
// turn/steer is written down.
writeFileSync(
	join(bin, 'codex'),
	`#!${process.execPath}
const { appendFileSync } = require('node:fs')
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n')
let timer, n = 0
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
	const m = JSON.parse(line)
	const p = m.params ?? {}
	if (m.method === 'turn/start' || m.method === 'turn/steer') appendFileSync(${JSON.stringify(steers)}, JSON.stringify({ method: m.method, text: p.input.map((i) => i.text).join('\\n----\\n') }) + '\\n')
	if (m.method === 'initialize') send({ id: m.id, result: {} })
	else if (m.method === 'model/list') send({ id: m.id, result: { data: [] } })
	else if (m.method === 'thread/resume') send({ id: m.id, error: { message: 'no such thread' } })
	else if (m.method === 'thread/start') send({ id: m.id, result: { thread: { id: 'th-' + (++n) } } })
	else if (m.method === 'turn/start') {
		send({ id: m.id, result: { turn: { id: 'tu1', status: 'inProgress' } } })
		send({ method: 'turn/started', params: { threadId: p.threadId, turn: { id: 'tu1' } } })
		clearInterval(timer)
		timer = setInterval(() => send({ method: 'item/completed', params: { threadId: p.threadId, item: { type: 'commandExecution', id: 'c' + (++n), command: 'node bin/toucan.mjs summary', status: 'completed' } } }), 600)
	} else if (m.method === 'turn/steer') send({ id: m.id, result: {} })
	else if (m.method === 'turn/interrupt') {
		clearInterval(timer)
		send({ id: m.id, result: {} })
		send({ method: 'turn/completed', params: { threadId: p.threadId, turn: { id: 'tu1', status: 'interrupted' } } })
	} else if (m.id !== undefined) send({ id: m.id, result: {} })
})
`,
)
chmodSync(join(bin, 'codex'), 0o755)

const port = await new Promise((r) => {
	const s = createServer().listen(0, '127.0.0.1', () => (r(s.address().port), s.close()))
})
const env = { ...process.env, HOME: home, PLAYWRIGHT_BROWSERS_PATH: browsers, PATH: `${bin}${delimiter}${process.env.PATH}` }
for (const k of ['TOUCAN_URL', 'TOUCAN_CANVAS', 'TOUCAN_AGENT', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'TOUCAN_ACTIVITY']) delete env[k]

const server = spawn(process.execPath, [join(ROOT, 'server/index.mjs'), '--port', String(port), '--data', data], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let serverLog = ''
server.stdout.on('data', (d) => (serverLog += d))
server.stderr.on('data', (d) => (serverLog += d))
for (let i = 0; i < 50 && !serverLog.includes('listening'); i++) await new Promise((r) => setTimeout(r, 100))

const run = promisify(execFile)
/** A CLI call: what it printed, and what it said about the canvas on the side. */
const toucan = async (...args) => {
	const r = await run(process.execPath, [join(ROOT, 'bin/toucan.mjs'), ...args], { env, maxBuffer: 32 << 20 })
	return { out: r.stdout.trim(), heard: r.stderr.match(/<canvas_activity[\s\S]*?<\/canvas_activity>/)?.[0] ?? '' }
}
const step = (msg) => console.log(`ok  ${msg}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const told = () => (existsSync(steers) ? readFileSync(steers, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
const until = async (what, test, ms = 8000) => {
	for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) {
		const v = await test()
		if (v) return v
	}
	throw new Error(`timed out waiting for ${what}`)
}

const plan = join(data, 'plan.mmd')
writeFileSync(plan, 'flowchart LR\n  web[Web app] --> sign_in[Sign-in]\n  web --> bookings[Bookings]\n')

let browser
try {
	const token = JSON.parse(readFileSync(join(home, '.config/toucan/server.json'), 'utf8')).token
	browser = await chromium.launch()
	for (const engine of (process.env.ENGINES ?? 'tldraw,excalidraw').split(',')) {
		const name = `activity-${engine}`
		await toucan('new', name, '--engine', engine)
		const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
		await page.addInitScript(() => localStorage.setItem('toucan.name', 'Ana'))
		await page.goto(`http://127.0.0.1:${port}/?canvas=${name}#token=${token}`)
		await page.waitForFunction(() => window.toucan, null, { timeout: 30000 })
		await sleep(1000)

		// ---- a terminal agent ----
		const claude = (...a) => toucan('--canvas', name, '--agent', 'claude', ...a)
		assert.equal((await claude('import', plan)).heard, '', `${engine}: a new agent starts at the present`)
		await sleep(800)
		assert.equal((await claude('summary')).heard, '', `${engine}: its own import isn't news to it`)

		// The person edits by hand: a box's text, a move, and a new box; then selects one.
		await page.evaluate(async () => {
			const t = window.toucan
			await t.applyGraph({ nodes: [{ key: 'sign_in', text: 'Log in' }] })
			await t.applyGraph({ nodes: [{ key: 'todo', text: 'Pricing?' }] })
		})
		await page.evaluate((engine) => {
			const ed = window.editor, t = window.toucan
			if (engine === 'tldraw') {
				const s = ed.getShape(t.idFor('bookings'))
				ed.updateShape({ id: s.id, type: s.type, x: s.x + 300, y: s.y + 200 })
				ed.select(t.idFor('todo'))
			} else {
				const els = ed.getSceneElements()
				const b = els.find((e) => e.customData?.key === 'bookings')
				ed.updateScene({ elements: els.map((e) => (e.id === b.id ? { ...e, x: e.x + 300, y: e.y + 200, version: e.version + 1, versionNonce: e.versionNonce + 1 } : e)) })
				const todo = els.find((e) => e.customData?.key === 'todo')
				ed.updateScene({ appState: { selectedElementIds: { [todo.id]: true } } })
			}
		}, engine)
		await sleep(1500)
		const heard = (await claude('summary')).heard
		for (const want of ['Ana changed box sign_in "Log in": text "Sign-in" → "Log in"', 'Ana added box todo "Pricing?"', /Ana changed box bookings "Bookings": moved to/, 'Ana selected todo']) {
			if (typeof want === 'string') assert.ok(heard.includes(want), `${engine}: ${want}\n${heard}`)
			else assert.match(heard, want, `${engine}: ${heard}`)
		}
		step(`${engine}: a terminal agent hears a person's edits and selection with its next command`)
		assert.equal((await claude('summary')).heard, '', `${engine}: and hears each once`)

		// Another agent hears the first one's work, by name; the first doesn't hear its own.
		const pi = (...a) => toucan('--canvas', name, '--agent', 'pi', ...a)
		await pi('summary')
		await claude('exec', '-e', `return toucan.applyGraph({ nodes: [{ key: 'bookings', text: 'Reservations' }] })`, '--label', 'rename')
		await sleep(1200)
		assert.match((await pi('summary')).heard, /claude \(agent\) changed box bookings "Reservations": text "Bookings" → "Reservations"/, `${engine}: one agent hears another's`)
		assert.equal((await claude('summary')).heard, '', `${engine}: not its own`)
		step(`${engine}: agents hear each other's edits, not their own`)

		// A comment is news too.
		await page.evaluate(async ({ name }) => {
			const token = localStorage.getItem('toucan.token')
			await fetch(`/api/canvases/${name}/threads`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ anchor: { shapes: ['todo'] }, author: { kind: 'person', name: 'Ana' }, text: 'Is this still open?' }) })
		}, { name })
		assert.match((await pi('summary')).heard, /Ana started comment thread #1 \(.*\): "Is this still open\?"/, `${engine}: a comment is news`)
		step(`${engine}: a person's comment reaches agents at work`)

		// ---- the chat panel's agent ----
		rmSync(steers, { force: true })
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/chat?canvas=${name}&token=${token}`)
		await new Promise((r, j) => (ws.once('open', r), ws.once('error', j)))
		const events = []
		ws.on('message', (m) => events.push(JSON.parse(m)))
		ws.send(JSON.stringify({ type: 'send', text: 'tidy this up', mode: 'fast' }))
		await until('the turn to start', () => told().some((t) => t.method === 'turn/start'))
		await page.evaluate(() => window.toucan.applyGraph({ nodes: [{ key: 'todo', text: 'Pricing: decided' }] }))
		const steer = await until('a steer about the edit', () => told().find((t) => t.method === 'turn/steer' && t.text.includes('Pricing: decided')))
		assert.match(steer.text, /^<canvas_activity canvas="activity-/, `${engine}: the steer is the activity block`)
		assert.ok(steer.text.includes('Ana changed box todo "Pricing: decided"'), steer.text)
		await until('the panel to say so', () => events.some((e) => e.type === 'noticed'))
		step(`${engine}: the chat agent is told between its commands, and the panel says so`)

		// A message mid-turn brings what's selected now.
		await page.evaluate((engine) => {
			const ed = window.editor, t = window.toucan
			if (engine === 'tldraw') ed.select(t.idFor('sign_in'))
			else ed.updateScene({ appState: { selectedElementIds: { [ed.getSceneElements().find((e) => e.customData?.key === 'sign_in').id]: true } } })
		}, engine)
		await sleep(700)
		ws.send(JSON.stringify({ type: 'send', text: 'make this green', mode: 'fast' }))
		const mid = await until('the message as a steer', () => told().find((t) => t.method === 'turn/steer' && t.text.includes('make this green')))
		assert.match(mid.text, /Selected now by Ana \("this", "these"\): sign_in/, `${engine}: "this" is what's selected now\n${mid.text}`)
		step(`${engine}: a message sent mid-turn carries the selection at that moment`)
		ws.send(JSON.stringify({ type: 'interrupt' }))
		await until('the turn to stop', () => events.some((e) => e.type === 'turn' && e.status === 'interrupted'))

		// Between turns: the next turn starts with what changed since the last one.
		await page.evaluate(() => window.toucan.applyGraph({ nodes: [{ key: 'web', text: 'Website' }] }))
		await sleep(1200)
		ws.send(JSON.stringify({ type: 'send', text: 'and now?', mode: 'fast' }))
		const next = await until('the next turn', () => told().filter((t) => t.method === 'turn/start').at(1))
		assert.match(next.text, /Since your last turn here[\s\S]*Ana changed box web "Website"/, `${engine}: a new turn hears what happened since the last\n${next.text}`)
		step(`${engine}: a new turn starts with what changed since the last`)
		ws.send(JSON.stringify({ type: 'interrupt' }))
		await until('the turn to stop', () => events.filter((e) => e.type === 'turn' && e.status === 'interrupted').length > 1)
		ws.close()
		await page.context().close()
	}
} catch (e) {
	console.error(serverLog.slice(-3000))
	throw e
} finally {
	await browser?.close()
	server.kill()
	rmSync(home, { recursive: true, force: true })
	rmSync(data, { recursive: true, force: true })
	rmSync(bin, { recursive: true, force: true })
}
