// End-to-end check of "agent at work": a person has a canvas open; an agent (the CLI, named with --as)
// reads it, says what it is about to do and points at shapes, then imports. The person's tab must show
// the status pill and ring while the agent works, the agent's cursor on the shapes it pointed at and
// then on the ones it changed, and must clear them once the agent goes quiet. Both engines.
//
//   npm run build && node scripts/presence-e2e.mjs [--shots DIR]
//
// Needs playwright-core and its Chromium. Throwaway HOME and data directory, like test:headless.

import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir, platform, tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (!existsSync(join(ROOT, 'dist/index.html'))) throw new Error('build the app first: npm run build')
const { chromium } = await import('playwright-core')
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null
if (shots) mkdirSync(shots, { recursive: true })

const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), platform() === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright')
const home = mkdtempSync(join(tmpdir(), 'toucan-home-'))
const data = mkdtempSync(join(tmpdir(), 'toucan-data-'))
const port = await new Promise((r) => {
	const s = createServer().listen(0, '127.0.0.1', () => (r(s.address().port), s.close()))
})
const env = { ...process.env, HOME: home, PLAYWRIGHT_BROWSERS_PATH: browsers }
for (const k of ['TOUCAN_URL', 'TOUCAN_CANVAS', 'TOUCAN_AGENT']) delete env[k]

const server = spawn(process.execPath, [join(ROOT, 'server/index.mjs'), '--port', String(port), '--data', data], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let serverLog = ''
server.stdout.on('data', (d) => (serverLog += d))
server.stderr.on('data', (d) => (serverLog += d))
for (let i = 0; i < 50 && !serverLog.includes('listening'); i++) await new Promise((r) => setTimeout(r, 100))

const run = promisify(execFile)
const toucan = (...args) => run(process.execPath, [join(ROOT, 'bin/toucan.mjs'), ...args], { env, maxBuffer: 32 << 20 }).then((r) => r.stdout.trim())
const step = (msg) => console.log(`ok  ${msg}`)
// app/pulses.tsx LINGER_MS, kept in step by hand.
const LINGER = 8000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const plan = join(data, 'plan.mmd')
// In a frame: tldraw frames are opaque, so the overlay has to draw in front of them (check the --shots).
writeFileSync(plan, 'flowchart LR\n  subgraph app[Django app]\n    sign_in[Sign-in]\n    login_page[Login page]\n    bookings[Bookings]\n  end\n  web[Web app] --> sign_in\n  web --> login_page\n  web --> bookings\n')
const plan2 = join(data, 'plan2.mmd')
writeFileSync(plan2, 'flowchart LR\n  web[Web app] --> sign_in[Sign-in]\n  web --> bookings[Bookings]\n  bookings --> db[Postgres]\n')

let browser
try {
	const token = JSON.parse(readFileSync(join(home, '.config/toucan/server.json'), 'utf8')).token
	browser = await chromium.launch()
	for (const engine of (process.env.ENGINES ?? 'tldraw,excalidraw').split(',')) {
		const name = `presence-${engine}`
		await toucan('new', name, '--engine', engine)
		const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
		await page.goto(`http://127.0.0.1:${port}/?canvas=${name}#token=${token}`)
		await page.waitForFunction(() => window.toucan, null, { timeout: 30000 })
		await sleep(1500)
		await toucan('--canvas', name, 'import', plan)
		await sleep(LINGER + 1000) // let that import's presence fade
		assert.equal(await page.locator('.toucan-agent-status').count(), 0, `${engine}: nothing shown while no agent is at work`)

		await toucan('--canvas', name, '--agent', 'Claude', 'notes').catch(() => {}) // excalidraw has no notes; still a call
		await toucan('--canvas', name, '--agent', 'Claude', 'say', 'Merging Sign-in and Login page', '--at', 'sign_in,login_page')
		const pill = page.locator('.toucan-agent-status')
		await pill.waitFor({ timeout: 3000 })
		assert.match(await pill.innerText(), /Claude\s+Merging Sign-in and Login page/, `${engine}: the pill names the agent and what it said`)
		assert.equal(await page.locator('.toucan-agent-ring').count(), 1, `${engine}: the ring is up`)
		const cursor = page.locator('.toucan-agent-cursor')
		await cursor.waitFor({ timeout: 3000 })
		assert.match(await cursor.innerText(), /Claude/, `${engine}: the cursor is signed`)
		const at = await cursor.boundingBox()
		step(`${engine}: say --at shows the pill, the ring and a signed cursor`)
		if (shots) await sleep(900), await page.screenshot({ path: join(shots, `${engine}-say.png`) })

		await sleep(600)
		await toucan('--canvas', name, '--agent', 'Claude', 'import', plan2)
		await sleep(700) // the cursor glides to what changed
		const moved = await cursor.boundingBox()
		assert.ok(at && moved && (Math.abs(at.x - moved.x) > 2 || Math.abs(at.y - moved.y) > 2), `${engine}: the cursor moves to the shapes the import changed`)
		step(`${engine}: the cursor follows the agent's edits`)
		if (shots) await page.screenshot({ path: join(shots, `${engine}-edit.png`) })

		await sleep(LINGER + 1500)
		assert.equal(await page.locator('.toucan-agent-status').count(), 0, `${engine}: the pill clears once the agent goes quiet`)
		assert.equal(await page.locator('.toucan-agent-cursor').count(), 0, `${engine}: the cursor clears too`)
		step(`${engine}: presence clears after the agent goes quiet`)
		await page.context().close()
	}
} catch (e) {
	console.error(serverLog)
	throw e
} finally {
	await browser?.close()
	server.kill()
	rmSync(home, { recursive: true, force: true })
	rmSync(data, { recursive: true, force: true })
}
