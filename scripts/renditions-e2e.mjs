// End-to-end check of renditions: a server started with --headless and no tab open defines, publishes, lists and removes
// renditions through the CLI on both engines, and registers each in an include catalogue; then a person publishes one from
// the Export menu.
//
//   npm run build && node scripts/renditions-e2e.mjs      (npm run test:renditions)
//
// Needs playwright-core, and its Chromium or a Chrome or Chromium on the machine (as the server's headless mode does). Runs against a throwaway HOME, data
// directory and catalogue (INCLUDES_CATALOGUE), so it never touches ~/.config, real canvases or the real catalogue.

import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir, platform, tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (!existsSync(join(ROOT, 'dist/index.html'))) throw new Error('build the app first: npm run build')
const playwright = await import('playwright-core')
// The person's browser is found the way the server finds its own: Playwright's Chromium, else the machine's.
const { launchBrowser } = await import('../server/headless.mjs')

const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), platform() === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright')
const home = mkdtempSync(join(tmpdir(), 'toucan-home-'))
const data = mkdtempSync(join(tmpdir(), 'toucan-data-'))
const catalogue = join(home, 'includes', 'catalogue.json')
const port = await new Promise((r) => {
	const s = createServer().listen(0, '127.0.0.1', () => (r(s.address().port), s.close()))
})
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), INCLUDES_CATALOGUE: catalogue, PLAYWRIGHT_BROWSERS_PATH: browsers, TOUCAN_HEADLESS_IDLE: '4' } // a short idle, so a canvas can be archived
delete env.TOUCAN_URL
delete env.TOUCAN_CANVAS
delete env.TOUCAN_TOKEN

// Someone else's entry is already in the catalogue: it must come through untouched.
mkdirSync(dirname(catalogue), { recursive: true })
const about = { kind: 'markdown', path: '/somewhere/about.md', title: 'About' }
writeFileSync(catalogue, JSON.stringify({ v: 1, entries: { about } }, null, 2))

const server = spawn(process.execPath, [join(ROOT, 'server/index.mjs'), '--port', String(port), '--data', data, '--headless'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let serverLog = ''
server.stdout.on('data', (d) => (serverLog += d))
server.stderr.on('data', (d) => (serverLog += d))
for (let i = 0; i < 50 && !serverLog.includes('listening'); i++) await new Promise((r) => setTimeout(r, 100))

const run = promisify(execFile)
const toucan = async (...args) => (await run(process.execPath, [join(ROOT, 'bin/toucan.mjs'), ...args], { env, maxBuffer: 32 << 20 })).stdout.trim()
const json = async (...args) => JSON.parse(await toucan(...args))
const fails = async (re, ...args) => {
	const err = await toucan(...args).then(() => null, (e) => e)
	assert.ok(err, `expected ${args.join(' ')} to fail`)
	assert.match(err.stderr, re)
}
const step = (msg) => console.log(`ok  ${msg}`)
const entries = () => JSON.parse(readFileSync(catalogue, 'utf8')).entries
/** Waits for a condition (the server's copy catches up with the page's edit), never for a length of time alone. */
async function until(what, check, ms = 10000) {
	for (const end = Date.now() + ms; ; ) {
		const got = await check()
		if (got) return got
		if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
		await new Promise((r) => setTimeout(r, 200))
	}
}
const rowOf = async (canvas, name) => (await json('--canvas', canvas, 'rendition', 'list', '--json')).find((r) => r.name === name)

let human
try {
	for (const engine of ['tldraw', 'excalidraw']) {
		const canvas = `rd-${engine}`
		await toucan('new', canvas, '--engine', engine, '--title', `Renditions ${engine}`)
		// A frame holding two boxes and an arrow, and a box outside it.
		await toucan('--canvas', canvas, 'exec', '-e', `await toucan.applyGraph(${JSON.stringify({
			groups: [{ key: 'lane', label: 'Lane', box: { x: 0, y: 0, w: 640, h: 260 } }],
			nodes: [
				{ key: 'a', text: 'Alpha', group: 'lane', box: { x: 40, y: 80, w: 180, h: 64 } },
				{ key: 'b', text: 'Beta', group: 'lane', box: { x: 400, y: 80, w: 180, h: 64 } },
				{ key: 'c', text: 'Gamma', box: { x: 0, y: 500, w: 180, h: 64 } },
			],
			edges: [{ key: 'ab', from: 'a', to: 'b' }],
		})}); return 1`)
		const said = async () => toucan('--canvas', canvas, 'describe') // the server's copy, which renditions are judged by
		await until('the edit to reach the server', async () => (await said()).includes('Alpha'))

		// Defining: what it shows is checked against the canvas when it's said.
		await fails(/isn't a frame/, '--canvas', canvas, 'rendition', 'set', 'bad', '--frame', 'a')
		await fails(/not on the canvas: nope/, '--canvas', canvas, 'rendition', 'set', 'bad', '--keys', 'a,nope')
		await fails(/isn't a rendition name/, '--canvas', canvas, 'rendition', 'set', 'Bad')
		await fails(/one of --keys, --frame or --all/, '--canvas', canvas, 'rendition', 'set', 'bad', '--all', '--frame', 'lane')
		const set = await toucan('--canvas', canvas, 'rendition', 'set', 'how-it-works', '--frame', 'lane', '--alt', 'Alpha leads to Beta', '--title', 'How it works')
		assert.match(set, /^defined how-it-works: frame lane, as SVG/)
		assert.equal((await rowOf(canvas, 'how-it-works')).state, 'unpublished')
		step(`${engine}: rendition set checks what it shows; a new one is unpublished`)

		// Publishing: the picture beside the definition, the manifest, and the catalogue entry.
		const out = await toucan('--canvas', canvas, 'rendition', 'publish', 'how-it-works')
		const picture = join(data, `${canvas}.renditions`, 'how-it-works.svg')
		assert.match(out, new RegExp(`^published how-it-works: ${picture.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
		const svg = readFileSync(picture, 'utf8')
		assert.match(svg, /^<svg[^>]*>\s*<title>How it works<\/title><desc>[^<]*Alpha -&gt; Beta/, 'titled, and what it shows in words')
		assert.ok(!/Gamma/.test(svg.match(/<desc>[^<]*<\/desc>/)[0]), 'the words are about what it shows, not the rest of the canvas')
		const manifest = JSON.parse(readFileSync(join(data, `${canvas}.renditions`, 'how-it-works.json'), 'utf8'))
		assert.deepEqual([manifest.name, manifest.canvas, manifest.format, manifest.alt, manifest.title], ['how-it-works', canvas, 'svg', 'Alpha leads to Beta', 'How it works'])
		assert.deepEqual(manifest.select, { frame: 'lane' })
		assert.equal(typeof manifest.version.n, 'number', 'it names the canvas version it was drawn from')
		assert.match(manifest.version.shapes, /^[0-9a-f]{64}$/)
		const { createHash } = await import('node:crypto')
		assert.equal(manifest.hash, createHash('sha256').update(readFileSync(picture)).digest('hex'), 'hash is the picture bytes')
		const name = `toucan:${canvas}/how-it-works`
		assert.deepEqual(entries()[name], { kind: 'picture', path: picture, title: 'How it works', alt: 'Alpha leads to Beta', source: { tool: 'toucan', canvas, rendition: 'how-it-works', version: manifest.version, hash: manifest.hash, published: manifest.published } })
		assert.deepEqual(entries().about, about, "someone else's entry is untouched")
		step(`${engine}: publish wrote ${svg.length} bytes of SVG, its manifest (version ${manifest.version.n}) and ${name}`)

		// Unchanged: the same picture keeps its date.
		const again = await json('--canvas', canvas, 'rendition', 'publish', 'how-it-works', '--json')
		assert.equal(again.unchanged, true)
		assert.equal(again.rendition.published, manifest.published)
		assert.equal(again.rendition.state, 'current')
		step(`${engine}: republishing an unchanged picture keeps published`)

		// Staleness: a change outside what it shows leaves it current; one inside puts it behind. Nothing republishes by itself.
		await toucan('--canvas', canvas, 'exec', '-e', `await toucan.applyGraph({groups:[],nodes:[{key:'c',text:'Gamma two',box:{x:0,y:500,w:180,h:64}}],edges:[]}); return 1`)
		await until('the edit to reach the server', async () => (await said()).includes('Gamma two'))
		assert.equal((await rowOf(canvas, 'how-it-works')).state, 'current', 'an edit elsewhere leaves it current')
		await toucan('--canvas', canvas, 'exec', '-e', `await toucan.applyGraph({groups:[],nodes:[{key:'a',text:'Alpha two',group:'lane',box:{x:40,y:80,w:180,h:64}}],edges:[]}); return 1`)
		const behind = await until('the rendition to be behind', async () => {
			const r = await rowOf(canvas, 'how-it-works')
			return r.state === 'behind' && r
		})
		assert.match(behind.why, /shapes it shows have changed/)
		assert.equal(JSON.parse(readFileSync(join(data, `${canvas}.renditions`, 'how-it-works.json'), 'utf8')).published, manifest.published, 'not republished by itself')
		const list = await toucan('--canvas', canvas, 'rendition', 'list')
		assert.match(list, /^how-it-works {2}behind \(the shapes it shows have changed\) {2}svg {2}frame lane {2}\//)
		const fresh = await json('--canvas', canvas, 'rendition', 'publish', 'how-it-works', '--json')
		assert.equal(fresh.unchanged, false)
		assert.equal(fresh.rendition.state, 'current')
		assert.ok(fresh.rendition.published > manifest.published)
		assert.equal(entries()[name].source.published, fresh.rendition.published, 'the catalogue follows')
		step(`${engine}: list says behind after an edit inside the frame, current after publishing again`)

		// PNG, keys, and the whole canvas; --no-catalogue; remove.
		await toucan('--canvas', canvas, 'rendition', 'set', 'boxes', '--keys', 'a,b', '--format', 'png', '--alt', 'Two boxes')
		await toucan('--canvas', canvas, 'rendition', 'publish', 'boxes')
		const png = readFileSync(join(data, `${canvas}.renditions`, 'boxes.png'))
		assert.equal(png.subarray(1, 4).toString(), 'PNG')
		assert.equal(entries()[`toucan:${canvas}/boxes`].path, join(data, `${canvas}.renditions`, 'boxes.png'))
		await toucan('--canvas', canvas, 'rendition', 'set', 'whole')
		await toucan('--canvas', canvas, 'rendition', 'publish', 'whole', '--no-catalogue')
		assert.ok(existsSync(join(data, `${canvas}.renditions`, 'whole.svg')))
		assert.equal(entries()[`toucan:${canvas}/whole`], undefined, '--no-catalogue leaves the catalogue alone')
		assert.deepEqual((await json('--canvas', canvas, 'rendition', 'list', '--json')).map((r) => [r.name, r.state]), [['boxes', 'current'], ['how-it-works', 'current'], ['whole', 'current']])
		const removed = await toucan('--canvas', canvas, 'rendition', 'remove', 'boxes')
		assert.match(removed, /^removed boxes, and toucan:rd-\w+\/boxes from the include catalogue/)
		assert.ok(!existsSync(join(data, `${canvas}.renditions`, 'boxes.png')) && !existsSync(join(data, `${canvas}.renditions`, 'boxes.json')))
		assert.equal(entries()[`toucan:${canvas}/boxes`], undefined)
		assert.deepEqual(entries().about, about)
		await fails(/no rendition boxes/, '--canvas', canvas, 'rendition', 'publish', 'boxes')
		step(`${engine}: a PNG of some keys, the whole canvas with --no-catalogue, and remove takes the picture and its entry`)
	}

	// A person publishes from the Export menu: the selection, under a new name.
	const token = JSON.parse(readFileSync(join(home, '.config/toucan/server.json'), 'utf8')).token
	human = (await launchBrowser(playwright)).browser
	const page = await (await human.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
	await page.goto(`http://127.0.0.1:${port}/?canvas=rd-tldraw#token=${token}`)
	await page.waitForFunction(() => window.toucan?.summary().count >= 4, null, { timeout: 30000 })
	await page.evaluate(() => void window.editor.select(window.toucan.idFor('c')))
	await page.getByRole('button', { name: 'Export' }).click()
	await page.getByText('how-it-works').first().waitFor()
	await page.getByRole('textbox', { name: 'Rendition name' }).fill('gamma')
	await page.getByRole('button', { name: /Publish as a rendition/ }).click()
	await page.getByRole('status').filter({ hasText: 'toucan:rd-tldraw/gamma' }).waitFor({ timeout: 30000 })
	const made = await rowOf('rd-tldraw', 'gamma')
	assert.deepEqual(made.select, { keys: ['c'] }, 'the menu publishes what is selected')
	assert.equal(made.state, 'current')
	assert.ok(existsSync(join(data, 'rd-tldraw.renditions', 'gamma.svg')))
	assert.equal(entries()['toucan:rd-tldraw/gamma'].path, join(data, 'rd-tldraw.renditions', 'gamma.svg'))
	await page.getByRole('button', { name: 'Publish how-it-works' }).waitFor()
	step('the Export menu lists renditions and publishes the selection as a new one')

	// Archiving a canvas takes its renditions with it, and out of the catalogue.
	await page.context().close()
	assert.ok(entries()['toucan:rd-excalidraw/how-it-works'])
	// The headless page closes once idle; until then the canvas is open and can't be archived.
	await until('the canvas to be archived', () => toucan('--canvas', 'rd-excalidraw', 'archive').then(() => true, (e) => (e.stderr.includes('open in a tab') ? false : Promise.reject(e))), 60000)
	assert.ok(!existsSync(join(data, 'rd-excalidraw.renditions')), 'its renditions moved aside')
	assert.equal(entries()['toucan:rd-excalidraw/how-it-works'], undefined, 'an archived canvas leaves the catalogue')
	assert.ok(entries()['toucan:rd-tldraw/how-it-works'], "another canvas's entries stay")
	step('archiving a canvas moves its renditions aside and takes them out of the catalogue')
	assert.deepEqual(entries().about, about)
	console.log('\nrenditions e2e passed')
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
