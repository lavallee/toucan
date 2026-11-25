// After npm run build, run node scripts/capture-use-cases.mjs.
// CHROMIUM can name a local Chromium executable. All canvases use disposable data.
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { captureRundown } from './radio-rundown.mjs'
import { chromium } from 'playwright-core'

const root = fileURLToPath(new URL('../', import.meta.url))
const dest = process.env.CAPTURE_DIR ?? join(root, 'website/site/assets/use-cases')
mkdirSync(dest, { recursive: true })
const home = mkdtempSync(join(tmpdir(), 'toucan-use-cases-'))
const socket = createServer().listen(0, '127.0.0.1')
await once(socket, 'listening')
const port = socket.address().port
await new Promise((done) => socket.close(done))
const origin = `http://127.0.0.1:${port}`
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('TOUCAN_')))
Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), TOUCAN_URL: origin })
const server = spawn(process.execPath, ['server/index.mjs', '--port', String(port), '--data', join(home, 'data')], { cwd: root, env, stdio: 'ignore' })
const run = promisify(execFile)
const cli = (...args) => run(process.execPath, ['bin/toucan.mjs', ...args], { cwd: root, env }).then((res) => res.stdout)
const fixture = (name, data) => {
	const file = join(home, name)
	writeFileSync(file, JSON.stringify(data))
	return file
}
const node = (key, text, x, y, color, detail) => ({
	key, text, box: { x, y, w: 224, h: 86 }, style: { color, fill: 'semi' }, meta: { detail },
})
const edge = (from, to, label) => ({ from, to, label })
const system = {
	groups: [],
	nodes: [
		node('hosts', 'Show hosts', 0, 160, 'blue', 'Producers submit audio and show notes.'),
		node('ingest', 'Audio ingest', 375, 160, 'blue', 'Checks file headers and queues accepted uploads.'),
		node('archive', 'Audio archive', 750, 38, 'violet', 'Keeps the original recording and the listening copy.'),
		node('catalog', 'Episode catalog', 750, 160, 'violet', 'Stores release dates, captions, and credits.'),
		node('scheduler', 'Scheduler', 750, 282, 'violet', 'Reads the queue and prepares episodes for broadcast.'),
		node('player', 'Web player', 1125, 99, 'green', 'Loads the episode card and streams the listening copy.'),
		node('feed', 'Podcast feed', 1125, 232, 'green', 'Publishes the latest episode and its audio link.'),
	],
	edges: [
		edge('hosts', 'ingest', 'upload'),
		edge('ingest', 'archive', 'audio'),
		edge('ingest', 'catalog', 'record'),
		edge('ingest', 'scheduler', 'queue'),
		edge('archive', 'player', 'stream'),
		edge('catalog', 'player', 'details'),
		edge('catalog', 'feed', 'notes'),
		edge('scheduler', 'feed', 'timing'),
	],
}
const handoff = {
	groups: [],
	nodes: [
		node('pitch', 'Log a tip', 0, 150, 'blue', 'Record the claim and the lead for the reporter.'),
		node('report', 'Report the story', 375, 150, 'blue', 'Gather the primary documents and seek comment.'),
		node('edit', 'Editor review', 750, 150, 'violet', 'Check attribution, framing, and any unanswered factual questions.'),
		node('hold', 'Hold for evidence', 1125, 20, 'orange', 'Write the missing evidence on the review thread.'),
		node('publish', 'Schedule the story', 1125, 250, 'green', 'Hand the cleared copy and publish time to production.'),
	],
	edges: [edge('pitch', 'report', 'assign'), edge('report', 'edit', 'draft'), edge('edit', 'hold', 'hold'), edge('edit', 'publish', 'cleared')],
}
let browser, token
try {
	for (let n = 0; n < 100 && !token; n++) {
		try {
			const config = JSON.parse(readFileSync(join(home, '.config/toucan/server.json')))
			if ((await fetch(`${origin}/api/health`, { headers: { authorization: `Bearer ${config.token}` } })).ok) token = config.token
		} catch {}
		if (!token) await sleep(50)
	}
	assert.ok(token, 'local Toucan started')
	browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
	const page = await browser.newPage({ viewport: { width: 1440, height: 800 }, deviceScaleFactor: 1 })
	await page.addInitScript(() => localStorage.setItem('toucan.chat', 'closed'))

	async function open(name, key) {
		await page.goto(`${origin}/?canvas=${name}#token=${token}`)
		await page.waitForFunction((key) => window.toucan && (!key || window.toucan.get(key)), key, { timeout: 30000 })
	}
	async function shot(name, height = 720) {
		await page.setViewportSize({ width: 1440, height })
		await page.evaluate(() => {
			window.editor.selectNone()
			window.editor.zoomToBounds(window.editor.getCurrentPageBounds(), { inset: 150, animation: { duration: 0 } })
		})
		await page.waitForFunction(() => !document.querySelector('.toucan-pulse, .toucan-pulse-tag, .toucan-agent-status, .toucan-agent-cursor'), null, { timeout: 10000 })
		await page.screenshot({ path: join(dest, name + '.png'), animations: 'disabled' })
	}
	// Editable captions sit beside three original vector illustrations on the same canvas.
	const label = (key, text, x, y, w, size) => ({
		key, text, box: { x, y, w, h: 42 }, style: { geo: 'text', size },
	})
	const scenes = [
		['studio', 'Record', 'Hosts record the show and send audio with their notes.'],
		['archive', 'Archive', 'The station keeps a master tape and catalogs the episode.'],
		['air', 'Broadcast', 'The scheduler puts the episode on air at its release time.'],
	]
	const labels = [
		label('title', 'From studio to air', 0, 0, 1000, 'xl'),
		label('subtitle', 'How a community station gets a recording to its listeners', 0, 60, 1040, 'm'),
	]
	for (const [i, [id, title, caption]] of scenes.entries()) {
		const x = i * 352
		labels.push(label(id + '-title', title, x, 323, 320, 'l'))
		labels.push(label(id + '-caption', caption, x, 375, 320, 's'))
	}
	await cli('new', 'radio-field-guide', '--title', 'Community radio field guide', '--from', fixture('guide.tg.json', { groups: [], nodes: labels, edges: [] }))
	await open('radio-field-guide', 'title')
	const plates = scenes.map(([id]) => ({ id, src: 'data:image/svg+xml;base64,' + readFileSync(join(root, 'examples/radio', id + '.svg')).toString('base64') }))
	await page.evaluate((plates) => {
		for (const shape of window.editor.getCurrentPageShapes().filter((s) => s.type === 'text')) {
			const heading = shape.meta.key === 'title' || shape.meta.key.endsWith('-title')
			window.editor.updateShape({ id: shape.id, type: 'text', props: { font: heading ? 'serif' : 'sans' } })
		}
		for (const [i, { id, src }] of plates.entries()) {
			const assetId = 'asset:' + id
			window.editor.createAssets([{ id: assetId, type: 'image', typeName: 'asset', meta: {}, props: { name: id + '.svg', src, w: 320, h: 180, mimeType: 'image/svg+xml', isAnimated: false } }])
			window.editor.createShape({ id: window.toucan.idFor(id), type: 'image', x: i * 352, y: 126, props: { assetId, w: 320, h: 180 }, meta: { key: id } })
		}
	}, plates)
	await page.getByRole('button', { name: /^Appearance:/ }).click()
	await page.getByRole('radio', { name: 'Letterpress' }).click()
	await page.waitForFunction(() => window.editor.getCurrentThemeId() === 'press')
	await page.getByRole('radio', { name: 'Dark', exact: true }).click()
	await page.waitForFunction(() => getComputedStyle(document.querySelector('.tl-background')).backgroundColor === 'rgb(32, 37, 34)')
	await page.getByRole('radio', { name: 'Light', exact: true }).click()
	await page.waitForFunction(() => getComputedStyle(document.querySelector('.tl-background')).backgroundColor === 'rgb(247, 242, 230)')
	await page.keyboard.press('Escape')
	await page.setViewportSize({ width: 1440, height: 900 })
	await page.evaluate(() => {
		window.editor.setCamera({ x: 140, y: 200, z: 1 })
	})
	await page.evaluate(async () => { await document.fonts.ready })
	await page.screenshot({ path: join(dest, 'radio-field-guide.png'), animations: 'disabled' })
	const illustration = await page.evaluate(() => window.toucan.svg({ title: 'From studio to air', desc: 'Hosts record the show, the station archives the master, and the scheduler puts the episode on air.' }))
	writeFileSync(join(dest, 'radio-field-guide.svg'), illustration.svg)
	await page.reload()
	await page.waitForFunction(() => window.editor?.getCurrentThemeId() === 'press')
	await captureRundown({ cli, open, page, root, dest, home, fixture, run })
	await cli('new', 'radio-map', '--title', 'Community radio system', '--from', fixture('radio.tg.json', system))
	await open('radio-map', 'hosts')
	const mapCheck = await page.evaluate(() => window.toucan.measure())
	assert.equal(mapCheck.findings.length, 0, JSON.stringify(mapCheck.findings))
	await shot('radio-map', 900)

	await cli('new', 'editorial-handoff', '--title', 'Editorial handoff', '--from', fixture('handoff.tg.json', handoff))
	await open('editorial-handoff', 'edit')
	const flowCheck = await page.evaluate(() => window.toucan.measure())
	assert.equal(flowCheck.findings.length, 0, JSON.stringify(flowCheck.findings))
	await shot('editorial-handoff', 900)

	const plan = JSON.parse(readFileSync(join(root, 'examples/website-relaunch.plan.json')))
	const demoItems = ['audit', 'sitemap', 'voice', 'wireframes', 'design-system', 'scaffold', 'analytics', 'redirects']
	plan.items = plan.items.filter((item) => demoItems.includes(item.id))
	for (const item of plan.items) if (item.dependsOn) item.dependsOn = item.dependsOn.filter((id) => demoItems.includes(id))
	async function filmBoard(boardName, title, source, filmName, taskKey) {
		await cli('new', boardName, '--title', title, '--plan', 'file', fixture('board.plan.json', source), '--views', 'board')
		await open(boardName)
		await cli('--canvas', boardName, 'plan', 'sync')
		await page.waitForFunction((key) => window.toucan.get('plan:board:item:' + key), taskKey, { timeout: 30000 })
		await shot(boardName, 900)
		// Film a real pointer drag, then check that the file-backed plan received it.
		const { start, end } = await page.evaluate((key) => {
			const bounds = (key) => window.editor.getShapePageBounds(window.toucan.get(key))
			const card = bounds('plan:board:item:' + key)
			const lane = bounds('plan:board:col:review')
			return {
				start: window.editor.pageToScreen(card.center),
				end: window.editor.pageToScreen({ x: lane.center.x, y: card.center.y }),
			}
		}, taskKey)
		const frameDir = join(home, boardName + '-frames')
		mkdirSync(frameDir)
		let frame = 0
		async function recordFrame() {
			await page.screenshot({ path: join(frameDir, String(frame++).padStart(3, '0') + '.png') })
		}
		await page.mouse.move(start.x, start.y)
		await recordFrame()
		await page.mouse.down()
		for (let step = 1; step <= 24; step++) {
			const t = step / 24
			const position = t * t * (3 - 2 * t)
			await page.mouse.move(start.x + (end.x - start.x) * position, start.y + (end.y - start.y) * position)
			await recordFrame()
		}
		await page.mouse.up()
		await page.waitForFunction((key) => {
			const card = window.toucan.get('plan:board:item:' + key)
			return card?.meta?.plan?.version === 2 && card.parentId === window.toucan.get('plan:board:col:review')?.id
		}, taskKey, { timeout: 20000 })
		const copied = JSON.parse(readFileSync(join(home, 'data', boardName + '.files', 'board.plan.json')))
		assert.equal(copied.items.find((item) => item.id === taskKey).stage, 'review')

		// Let the sync feedback clear before holding on the settled board.
		await page.waitForFunction(() => !document.querySelector('.toucan-pulse, .toucan-pulse-tag, .toucan-agent-status, .toucan-agent-cursor'), null, { timeout: 10000 })
		await page.evaluate(() => { window.editor.selectNone() })
		await recordFrame()
		await run('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '12', '-i', join(frameDir, '%03d.png'), '-vf', 'tpad=start_mode=clone:start_duration=1:stop_mode=clone:stop_duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(dest, filmName)])
	}
	await filmBoard('relaunch-board', 'Website relaunch', plan, 'relaunch-move.mp4', 'scaffold')
	const episodeFile = readFileSync(join(root, 'examples/radio/episode.plan.json'))
	writeFileSync(join(dest, 'episode.plan.json'), episodeFile)
	const episodePlan = JSON.parse(episodeFile)
	await filmBoard('episode-board', 'Fieldnote Radio · Sounds from the river', episodePlan, 'river-move.mp4', 'mix')

	// The sample website has fictional copy, but the screenshot review and its reply are real Toucan records.
	const sample = await browser.newPage({ viewport: { width: 720, height: 420 }, deviceScaleFactor: 1 })
	async function captureSample(name, revised) {
		const file = join(dest, 'episode-' + name + '.png')
		await sample.setContent(`<!doctype html><html lang="en"><style>
body{margin:0;background:#edf2ec;color:#1c3129;font:18px system-ui,sans-serif}
main{max-width:540px;margin:0 auto;padding:35px}
header{display:flex;justify-content:space-between;padding-bottom:18px;border-bottom:1px solid #adbeaf;font-size:15px}
h1{font:600 46px Georgia,serif;line-height:1;margin:26px 0 15px}
p{line-height:1.5;max-width:28em} button{background:#154a36;color:white;border:0;padding:12px 20px;border-radius:5px;font:600 16px system-ui}
aside{font-size:15px;margin-top:16px;color:#39554a}
</style><main><header><strong>Fieldnote Radio</strong><span>Weekend listening</span></header>
<h1>Sounds from the river</h1><p>Follow a spring morning downstream, from the first birdsong to the boats coming home.</p>
<button>${revised ? 'Play the episode' : 'Listen'}</button>${revised ? '<aside>18 min · Includes a transcript</aside>' : ''}
</main></html>`)
		await sample.screenshot({ path: file })
		return file
	}
	await cli('new', 'radio-review', '--title', 'Fieldnote Radio review')
	const post = async (file, ...more) => JSON.parse(await cli('--canvas', 'radio-review', 'review', 'post', 'episode-page', file, '--title', 'Episode page', '--producer', 'web-session', ...more)).revision
	const first = await post(await captureSample('before', false))
	await page.setViewportSize({ width: 1440, height: 1200 })
	await open('radio-review', null)
	await page.getByRole('button', { name: 'Review', exact: true }).click()
	const dialog = page.getByRole('dialog', { name: 'Screenshot review' })
	const imageButton = dialog.getByRole('button', { name: 'Place feedback pin on screenshot' })
	await imageButton.locator('img').evaluate((img) => img.decode())
	const bounds = await imageButton.boundingBox()
	await imageButton.click({ position: { x: bounds.width * 0.19, y: bounds.height * 0.62 } })
	await dialog.getByLabel('Feedback', { exact: true }).fill('Give the button a clearer label and show the episode length.')
	await dialog.getByRole('button', { name: 'Post feedback' }).click()
	await dialog.getByText('Awaiting reply', { exact: false }).waitFor()
	const { inbox: [{ note }] } = JSON.parse(await cli('--canvas', 'radio-review', 'review', 'inbox', 'web-session'))
	const next = await post(await captureSample('after', true), '--previous', first.id)
	await cli('--canvas', 'radio-review', 'review', 'reply', note.id, 'Updated the button label and added the duration and transcript note.', '--producer', 'web-session', '--replacement', next.id)
	const revised = dialog.getByRole('button', { name: 'View revised screenshot' })
	await revised.waitFor()
	await dialog.getByRole('button', { name: 'Show note 1' }).click()
	await page.screenshot({ path: join(dest, 'radio-feedback.png'), animations: 'disabled' })
	await page.setViewportSize({ width: 1440, height: 925 })
	await revised.click()
	await dialog.getByText('Before · v1', { exact: true }).waitFor()
	await dialog.getByText('After · v2', { exact: true }).waitFor()
	await dialog.locator('figure img').first().evaluate((img) => img.decode())
	await dialog.locator('figure img').last().evaluate((img) => img.decode())
	await page.screenshot({ path: resolve(dest, 'radio-review.png'), animations: 'disabled' })
	console.log(`Captured the field guide, system map, handoff, board and screenshot review. Diagram scores: ${mapCheck.score}, ${flowCheck.score}. Board move verified against its source file.`)
} finally {
	await browser?.close()
	const stopped = once(server, 'exit')
	server.kill()
	await stopped
	rmSync(home, { force: true, recursive: true })
}
