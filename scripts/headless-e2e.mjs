// End-to-end check of headless mode: a server started with --headless and no browser tab open
// builds a canvas through the CLI (new → exec → summary → import Mermaid → screenshot → log), on
// both engines; then a "person" opens each canvas and must see the edits and the away notice.
//
//   npm run build && node scripts/headless-e2e.mjs
//
// Needs playwright-core and its Chromium (`npx playwright-core install chromium`). Runs against a
// throwaway HOME and data directory, so it never touches ~/.config/toucan or real canvases.

import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir, platform, tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (!existsSync(join(ROOT, 'dist/index.html'))) throw new Error('build the app first: npm run build')
const { chromium } = await import('playwright-core')

// The browsers live under the real home; the server and CLI get a throwaway one.
const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), platform() === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright')
const home = mkdtempSync(join(tmpdir(), 'toucan-home-'))
const data = mkdtempSync(join(tmpdir(), 'toucan-data-'))
const port = await new Promise((r) => {
	const s = createServer().listen(0, '127.0.0.1', () => (r(s.address().port), s.close()))
})
const env = { ...process.env, HOME: home, PLAYWRIGHT_BROWSERS_PATH: browsers, TOUCAN_URL: '', TOUCAN_CANVAS: '' }
delete env.TOUCAN_URL
delete env.TOUCAN_CANVAS

const server = spawn(process.execPath, [join(ROOT, 'server/index.mjs'), '--port', String(port), '--data', data, '--headless'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let serverLog = ''
server.stdout.on('data', (d) => (serverLog += d))
server.stderr.on('data', (d) => (serverLog += d))
for (let i = 0; i < 50 && !serverLog.includes('listening'); i++) await new Promise((r) => setTimeout(r, 100))

const run = promisify(execFile)
const toucan = async (...args) => {
	const t0 = Date.now()
	const { stdout } = await run(process.execPath, [join(ROOT, 'bin/toucan.mjs'), ...args], { env, maxBuffer: 32 << 20 })
	return { out: stdout.trim(), ms: Date.now() - t0 }
}
const json = async (...args) => JSON.parse((await toucan(...args)).out)
const step = (msg) => console.log(`ok  ${msg}`)

/** Resident memory of the headless Chromium processes, in MB. */
async function chromiumRss() {
	const { stdout } = await run('ps', ['-A', '-o', 'rss=,command='])
	return Math.round(stdout.split('\n').filter((l) => /chrome-headless-shell|Chromium/.test(l) && l.includes('ms-playwright')).reduce((sum, l) => sum + Number(l.trim().split(/\s+/)[0]), 0) / 1024)
}

const mermaid = join(home, 'flow.mmd')
writeFileSync(mermaid, 'graph LR\n  a --> c[Gamma]\n  c --> d[Delta]\n')

let human
try {
	for (const engine of ['tldraw', 'excalidraw']) {
		const name = `hl-${engine}`
		await toucan('new', name, '--engine', engine, '--title', `Headless ${engine}`)
		const before = await json('canvases')
		assert.equal(before.find((c) => c.name === name).open, 0, 'no tab open')

		const make = engine === 'tldraw'
			? `toucan.node("a",{x:0,y:0,text:"Alpha"}); toucan.node("b",{x:300,y:0,text:"Beta"}); toucan.edge("a","b"); return toucan.summary().count`
			: `return (await toucan.applyGraph({groups:[],nodes:[{key:"a",text:"Alpha",box:{x:0,y:0,w:180,h:64}},{key:"b",text:"Beta",box:{x:300,y:0,w:180,h:64}}],edges:[{from:"a",to:"b"}]})) && toucan.summary().count`
		const cold = await toucan('--canvas', name, 'exec', '-e', make)
		assert.ok(Number(cold.out) >= 3, `exec made shapes (${cold.out})`)
		step(`${engine}: exec with no tab open (cold start ${cold.ms} ms incl. CLI) → ${cold.out} shapes`)

		const warm = await toucan('--canvas', name, 'summary')
		const keys = JSON.parse(warm.out).shapes.map((s) => s.key)
		assert.ok(keys.includes('a') && keys.includes('b'), 'summary sees the new shapes')
		step(`${engine}: summary (warm ${warm.ms} ms) → keys ${keys.join(', ')}`)

		const imp = await json('--canvas', name, 'import', mermaid)
		step(`${engine}: import flow.mmd → ${JSON.stringify(imp)}`)
		const after = JSON.parse((await toucan('--canvas', name, 'summary')).out).shapes.map((s) => s.key)
		assert.ok(after.includes('c') && after.includes('d'), 'import added c and d')

		const png = join(home, `${name}.png`)
		await toucan('--canvas', name, 'screenshot', png)
		const buf = readFileSync(png)
		assert.equal(buf.subarray(1, 4).toString(), 'PNG')
		step(`${engine}: screenshot → ${buf.length} bytes, ${buf.readUInt32BE(16)}×${buf.readUInt32BE(20)} px`)

		const log = await json('--canvas', name, 'log')
		assert.equal(log.length, 2, 'two edits on the trail (exec, import); reads are not logged')
		assert.ok(log.every((e) => e.source === 'headless'))
		assert.deepEqual(log[1].what, 'import ' + mermaid)
		assert.ok(log[1].added.includes('c') && log[1].added.includes('d'))
		step(`${engine}: log → ${log.map((e) => `[${e.what.slice(0, 40)}… +${e.added.length} ~${e.updated.length} −${e.removed.length}]`).join(' ')}`)
		assert.equal((await json('--canvas', name, 'log', '--since', log[0].t)).length, 1, '--since filters by time')
		assert.equal((await json('--canvas', name, 'log', '--since', '1h')).length, 2, '--since takes an age')
		const listed = (await json('canvases')).find((c) => c.name === name)
		assert.equal(listed.open, 0, 'the headless page is not counted as an open tab')
		assert.equal(listed.headless, true)
		console.log(`    headless Chromium resident memory with ${engine === 'tldraw' ? 1 : 2} canvas page(s): ${await chromiumRss()} MB`)
	}

	// A person opens each canvas through the sign-in link.
	const token = JSON.parse(readFileSync(join(home, '.config/toucan/server.json'), 'utf8')).token
	human = await chromium.launch()
	for (const engine of ['tldraw', 'excalidraw']) {
		const name = `hl-${engine}`
		const page = await (await human.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
		await page.goto(`http://127.0.0.1:${port}/?canvas=${name}#token=${token}`)
		await page.waitForFunction(() => window.toucan?.summary().count >= 6, null, { timeout: 30000 })
		const seen = await page.evaluate(() => window.toucan.summary().shapes.map((s) => s.key).sort())
		step(`${engine}: a person's tab sees ${seen.join(', ')}`)
		const notice = page.getByRole('button', { name: /agent edits? while you were away/ })
		await notice.waitFor({ timeout: 10000 })
		step(`${engine}: notice reads "${await notice.innerText()}"`)
		await notice.click()
		const list = await page.locator('ol li').allInnerTexts()
		assert.equal(list.length, 2)
		await page.screenshot({ path: join(home, `${name}-human.png`) })
		step(`${engine}: notice lists ${list.length} edits: ${list.map((l) => l.replace(/\s+/g, ' ').slice(0, 70)).join(' | ')}`)

		// With a person's tab open, exec goes there, and the trail doesn't grow.
		await toucan('--canvas', name, 'exec', '-e', engine === 'tldraw' ? 'toucan.node("e",{x:0,y:300,text:"Echo"}); return 1' : 'await toucan.applyGraph({groups:[],nodes:[{key:"e",text:"Echo",box:{x:0,y:300,w:180,h:64}}],edges:[]}); return 1')
		await page.waitForFunction(() => window.toucan.get('e'), null, { timeout: 5000 })
		assert.equal((await json('--canvas', name, 'log')).length, 2, 'edits with a person watching are not on the trail')
		step(`${engine}: with a person's tab open, exec lands there and is not logged`)

		await page.getByRole('button', { name: 'Mark seen' }).click()
		await page.reload()
		await page.waitForFunction(() => window.toucan?.summary().count >= 7, null, { timeout: 30000 })
		await page.waitForTimeout(1000)
		assert.equal(await notice.count(), 0, 'no notice once seen')
		step(`${engine}: after "Mark seen" and a reload, no notice`)
		await page.context().close()
	}
	console.log('\nheadless e2e passed')
} catch (e) {
	console.error(serverLog)
	throw e
} finally {
	await human?.close()
	server.kill('SIGTERM')
	await new Promise((r) => server.once('exit', r))
	if (!process.env.KEEP) rmSync(home, { recursive: true, force: true }), rmSync(data, { recursive: true, force: true })
	else console.log(`kept ${home} and ${data}`)
}
console.log(serverLog.split('\n').filter((l) => l.startsWith('headless')).join('\n'))
