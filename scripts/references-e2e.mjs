// End-to-end check of the References panel: a person opens a project's README beside the canvas, follows a relative link,
// sees its image, a table and a PDF, and reads a web page whose scripts don't run; an agent shows its research with
// `toucan show`; a box's references open from its details card. Both engines.
//
//   npm run build && node scripts/references-e2e.mjs [--shots DIR]
//
// Throwaway HOME and data directory, like the other e2e checks. The "web" is a server on 127.0.0.1, which toucan only fetches
// because this test sets TOUCAN_FETCH_PRIVATE=1.

import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { createServer } from 'node:net'
import { homedir, platform, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (!existsSync(join(ROOT, 'dist/index.html'))) throw new Error('build the app first: npm run build')
const { chromium } = await import('playwright-core')
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null
if (shots) mkdirSync(shots, { recursive: true })

const freePort = () => new Promise((r) => {
	const s = createServer().listen(0, '127.0.0.1', () => (r(s.address().port), s.close()))
})
const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), platform() === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright')
const home = mkdtempSync(join(tmpdir(), 'toucan-home-')), data = mkdtempSync(join(tmpdir(), 'toucan-data-')), project = mkdtempSync(join(tmpdir(), 'toucan-project-'))
const port = await freePort()
const env = { ...process.env, HOME: home, PLAYWRIGHT_BROWSERS_PATH: browsers, TOUCAN_FETCH_PRIVATE: '1', TOUCAN_PORT: String(port) }
for (const k of ['TOUCAN_URL', 'TOUCAN_CANVAS', 'TOUCAN_AGENT']) delete env[k]

// A project: a README that links to a guide and shows a picture, a table, a PDF, and a secret that must stay unseen.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8Dwn4GBgYGJgQEKAB4RAgEOBQLmAAAAAElFTkSuQmCC', 'base64')
const PDF = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
mkdirSync(join(project, '.git'))
mkdirSync(join(project, 'docs'))
writeFileSync(join(project, 'README.md'), '# The project\n\nSee [the guide](docs/guide.md) and the [table](docs/data.csv).\n\n![a picture](docs/pic.png)\n')
writeFileSync(join(project, 'docs/guide.md'), '# The guide\n\n[Back to the readme](../README.md)\n')
writeFileSync(join(project, 'docs/data.csv'), 'service,owner\n"Checkout, v2",payments\nSearch,discovery\n')
writeFileSync(join(project, 'docs/pic.png'), PNG)
writeFileSync(join(project, 'docs/spec.pdf'), PDF)
writeFileSync(join(project, '.env'), 'SECRET=hunter2\n')

// The web: a page whose script would call home if it ran.
let scriptRan = 0
const web = http.createServer((req, res) => {
	if (req.url === '/ran') return scriptRan++, res.end()
	if (req.url === '/page.html') return res.writeHead(200, { 'content-type': 'text/html' }), res.end(`<html><head><title>A page</title></head><body><h1>Field notes</h1><p>From the web.</p><script>fetch('/ran')</script></body></html>`)
	if (req.url === '/moved') return res.writeHead(302, { location: '/page.html' }), res.end()
	res.writeHead(404), res.end()
})
const webPort = await freePort()
await new Promise((r) => web.listen(webPort, '127.0.0.1', r))
const site = `http://127.0.0.1:${webPort}`

const server = spawn(process.execPath, [join(ROOT, 'server/index.mjs'), '--port', String(port), '--data', data], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let serverLog = ''
server.stdout.on('data', (d) => (serverLog += d))
server.stderr.on('data', (d) => (serverLog += d))
for (let i = 0; i < 50 && !serverLog.includes('listening'); i++) await new Promise((r) => setTimeout(r, 100))

const run = promisify(execFile)
const toucan = (args, opts = {}) => run(process.execPath, [join(ROOT, 'bin/toucan.mjs'), ...args], { env, maxBuffer: 32 << 20, ...opts }).then((r) => r.stdout.trim())
const step = (msg) => console.log(`ok  ${msg}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let browser
try {
	const token = JSON.parse(readFileSync(join(home, '.config/toucan/server.json'), 'utf8')).token
	const api = (path) => fetch(`http://127.0.0.1:${port}${path}`, { headers: { authorization: `Bearer ${token}` } })

	// The project's canvas, and research an agent wrote for it.
	const canvas = JSON.parse(await toucan(['init', 'refs'], { cwd: project })).canvas
	assert.equal(canvas, 'refs')
	mkdirSync(join(data, 'refs.files'), { recursive: true })
	writeFileSync(join(data, 'refs.files/research.md'), '# Research\n\nWhat the agent found, with a [source](' + site + '/page.html).\n')

	const listing = await (await api('/api/canvases/refs/references')).json()
	const refs = listing.files.map((f) => f.ref)
	assert.ok(refs.includes('project/README.md') && refs.includes('files/research.md') && refs.includes('project/docs/spec.pdf'), JSON.stringify(refs))
	assert.ok(!refs.some((r) => r.includes('.env') || r.includes('.git')), 'hidden files stay hidden')
	assert.equal((await api('/api/canvases/refs/reference?ref=project/.env')).status, 404)
	assert.equal((await api(`/api/canvases/refs/reference?ref=${encodeURIComponent('project/../../etc/passwd')}`)).status, 404)
	assert.equal((await fetch(`http://127.0.0.1:${port}/api/canvases/refs/reference?ref=project/README.md`)).status, 401, 'needs the token')
	const readme = await api('/api/canvases/refs/reference?ref=project/README.md')
	assert.match(readme.headers.get('content-security-policy') ?? '', /sandbox/)
	const moved = await api(`/api/canvases/refs/reference?ref=${encodeURIComponent(site + '/moved')}`)
	assert.equal(decodeURI(moved.headers.get('x-toucan-url')), `${site}/page.html`, 'redirects are followed, and say where they ended')
	step('references: the project and canvas files are listed, secrets and escapes refused, the token required')

	browser = await chromium.launch()
	for (const engine of ['tldraw', 'excalidraw']) {
		const name = engine === 'tldraw' ? 'refs' : 'refs-ex'
		if (engine === 'excalidraw') {
			await toucan(['new', name, '--engine', 'excalidraw'])
			mkdirSync(join(data, `${name}.files`), { recursive: true })
			writeFileSync(join(data, `${name}.files/research.md`), '# Research\n')
		}
		const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
		const errors = []
		page.on('pageerror', (e) => errors.push(String(e)))
		await page.goto(`http://127.0.0.1:${port}/#token=${token}`)
		await page.goto(`http://127.0.0.1:${port}/?canvas=${name}`)
		await page.waitForFunction(() => window.toucan, null, { timeout: 30000 })
		await sleep(800)
		const panel = page.getByRole('region', { name: 'References' })
		const heading = () => panel.locator('header h2').textContent()

		if (engine === 'tldraw') {
			await page.getByRole('button', { name: 'References' }).click()
			await panel.getByRole('button', { name: /README\.md/ }).click()
			await panel.getByRole('heading', { name: 'The project', exact: true }).waitFor()
			await page.waitForFunction(() => [...document.querySelectorAll('section[aria-label=References] img')].some((i) => i.naturalWidth === 2), null, { timeout: 10000 })
			if (shots) await page.screenshot({ path: join(shots, 'readme.png') })
			await panel.getByRole('link', { name: 'the guide' }).click()
			await panel.getByRole('heading', { name: 'The guide', exact: true }).waitFor()
			await panel.getByRole('button', { name: 'Back' }).click()
			await panel.getByRole('heading', { name: 'The project', exact: true }).waitFor()
			await panel.getByRole('link', { name: 'table' }).click()
			await panel.getByRole('cell', { name: 'Checkout, v2' }).waitFor()
			step(`${engine}: a README beside the canvas, with its link, its picture, a table, and back`)

			await panel.getByRole('button', { name: 'Back' }).click()
			await panel.getByRole('button', { name: 'Back' }).click()
			await panel.getByRole('button', { name: /spec\.pdf/ }).click()
			const pdf = panel.locator('iframe[title="spec.pdf"]')
			await pdf.waitFor()
			assert.match(await pdf.getAttribute('src'), /^blob:/, 'the PDF comes as a blob, with no token in its address')

			await panel.getByRole('button', { name: 'Back' }).click()
			const find = panel.getByLabel('Find a file or open a link')
			await find.fill(`${site}/page.html`)
			await find.press('Enter')
			const frame = panel.locator('iframe[sandbox]')
			await frame.waitFor()
			assert.equal(await frame.getAttribute('sandbox'), 'allow-popups allow-popups-to-escape-sandbox')
			await page.frameLocator('section[aria-label=References] iframe').getByRole('heading', { name: 'Field notes' }).waitFor()
			await sleep(800)
			assert.equal(scriptRan, 0, "a page's scripts don't run")
			if (shots) await page.screenshot({ path: join(shots, 'web.png') })
			step(`${engine}: a PDF, and a web page read without running its scripts`)

			// A box that points at the guide, and mentions a page.
			await toucan(['--canvas', name, 'exec', '-e', `toucan.node('svc', { text: 'Checkout', meta: { refs: [{ ref: 'project/docs/guide.md', label: 'How checkout works' }], detail: 'Background: ${site}/page.html' } }); return 1`])
			await page.getByRole('button', { name: 'Close references' }).click()
			await page.evaluate(() => window.editor.select(window.toucan.idFor('svc')))
			const card = page.getByRole('region', { name: 'Details' })
			await card.getByRole('button', { name: /How checkout works/ }).click()
			await panel.getByRole('heading', { name: 'The guide', exact: true }).waitFor()
			await page.getByRole('button', { name: 'Close references' }).click()
			await page.evaluate(() => window.editor.select(window.toucan.idFor('svc')))
			await card.getByRole('link', { name: `${site}/page.html` }).click()
			await page.frameLocator('section[aria-label=References] iframe').getByRole('heading', { name: 'Field notes' }).waitFor()
			step(`${engine}: a box's references and the link in its details open beside the canvas`)
			await page.getByRole('button', { name: 'Close references' }).click()
		}

		// An agent shows what it wrote, by reference and by path.
		const shown = JSON.parse(await toucan(['--canvas', name, '--agent', 'Claude', 'show', 'files/research.md']))
		assert.equal(shown.tabs, 1)
		await panel.getByRole('heading', { name: 'Research', exact: true }).waitFor()
		assert.equal(await heading(), 'research.md')
		assert.match(await panel.textContent(), /from Claude/)
		if (engine === 'tldraw') {
			JSON.parse(await toucan(['show', join(project, 'docs/guide.md')], { cwd: project }))
			await panel.getByRole('heading', { name: 'The guide', exact: true }).waitFor()
			await assert.rejects(toucan(['--canvas', name, 'show', '/etc/hostname']), /isn't in this canvas's files or its project/)
			if (shots) await page.screenshot({ path: join(shots, 'shown.png') })
		}
		step(`${engine}: \`toucan show\` opens what an agent wrote, and refuses what's outside`)
		assert.deepEqual(errors, [], `page errors: ${errors}`)
		await page.close()
	}
} catch (e) {
	console.error(serverLog.slice(-2000))
	throw e
} finally {
	await browser?.close()
	server.kill()
	web.close()
	await new Promise((r) => setTimeout(r, 300))
	for (const d of [home, data, project]) rmSync(d, { recursive: true, force: true })
}
