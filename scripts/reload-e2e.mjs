// An upgrade with a tab open: the tab says it's out of date, an agent's error from it says why, and `toucan reload` brings it
// up to date. The upgrade is a restart with another TOUCAN_BUILD_ID, which stands in for a new dist/index.html.
//
//   npm run build && node scripts/reload-e2e.mjs
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
const { chromium } = await import('playwright-core')
const home = mkdtempSync(join(tmpdir(), 'toucan-home-')), data = mkdtempSync(join(tmpdir(), 'toucan-data-'))
const port = await new Promise((r) => {
	const s = createServer().listen(0, '127.0.0.1', () => (r(s.address().port), s.close()))
})
const env = { ...process.env, HOME: home, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), platform() === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright') }
for (const k of ['TOUCAN_URL', 'TOUCAN_CANVAS', 'TOUCAN_AGENT']) delete env[k]
let server
const start = async (build) => {
	server = spawn(process.execPath, [join(ROOT, 'server/index.mjs'), '--port', String(port), '--data', data], { env: { ...env, TOUCAN_BUILD_ID: build }, stdio: ['ignore', 'pipe', 'pipe'] })
	let log = ''
	server.stdout.on('data', (d) => (log += d))
	for (let i = 0; i < 50 && !log.includes('listening'); i++) await new Promise((r) => setTimeout(r, 100))
}
const stop = async () => (server.kill(), await new Promise((r) => server.once('exit', r)))
const toucan = (...a) => promisify(execFile)(process.execPath, [join(ROOT, 'bin/toucan.mjs'), ...a], { env }).then((r) => r.stdout.trim())
const browser = await chromium.launch({ env })
try {
	await start('build-one')
	await toucan('new', 'up')
	const token = JSON.parse(readFileSync(join(home, '.config/toucan/server.json'), 'utf8')).token
	const page = await browser.newPage()
	await page.goto(`http://127.0.0.1:${port}/#token=${token}`)
	await page.goto(`http://127.0.0.1:${port}/?canvas=up`)
	await page.waitForFunction(() => window.toucan)
	await page.waitForTimeout(500)
	const notice = page.getByRole('button', { name: /toucan was updated/ })
	assert.equal(await notice.count(), 0, 'no notice while the tab and server agree')

	// The upgrade: the server comes back serving another build, and the open tab reconnects to it.
	await stop()
	await start('build-two')
	await notice.waitFor({ timeout: 15000 })
	if (process.env.SHOTS) await page.screenshot({ path: join(process.env.SHOTS, 'update-notice.png'), clip: { x: 0, y: 0, width: 900, height: 60 } })
	await assert.rejects(toucan('--canvas', 'up', 'exec', '-e', 'return toucan.notThere()'), /older toucan page than the server: reload it, or run `toucan reload`/)
	console.log('ok  reload: a tab open across an upgrade says so, and an agent error from it says why')

	const reloaded = page.waitForEvent('load')
	assert.deepEqual(JSON.parse(await toucan('reload', '--all')), { reloaded: 1 })
	await reloaded
	await page.waitForFunction(() => window.toucan)
	await page.waitForTimeout(500)
	assert.equal(await notice.count(), 0, 'up to date after reloading')
	assert.equal(await toucan('--canvas', 'up', 'exec', '-e', 'return 2'), '2')
	assert.deepEqual(JSON.parse(await toucan('--canvas', 'up', 'reload')), { reloaded: 1, canvas: 'up' })
	console.log('ok  reload: `toucan reload` reloads every open tab, or one canvas\'s, and they run the new page')
} finally {
	await browser.close()
	await stop().catch(() => {})
	rmSync(home, { recursive: true, force: true })
	rmSync(data, { recursive: true, force: true })
}
