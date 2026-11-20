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
import { chromium } from 'playwright-core'

const root = fileURLToPath(new URL('../', import.meta.url))
const dest = join(root, 'website/site/assets/use-cases')
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
		// Retain the editor chrome and keep its floating palette clear of the example.
		await page.addStyleTag({ content: '.tlui-style-panel__wrapper { visibility: hidden }' })
	}
	async function shot(name, height = 720) {
		await page.setViewportSize({ width: 1440, height })
		await page.evaluate(() => {
			window.editor.selectNone()
			window.editor.zoomToFit({ animation: { duration: 0 } })
		})
		await page.waitForFunction(() => !document.querySelector('.toucan-pulse, .toucan-pulse-tag, .toucan-agent-status, .toucan-agent-cursor'), null, { timeout: 10000 })
		await page.screenshot({ path: join(dest, name + '.png'), animations: 'disabled' })
	}
	await cli('new', 'radio-map', '--title', 'Community radio system', '--from', fixture('radio.tg.json', system))
	await open('radio-map', 'hosts')
	const mapCheck = await page.evaluate(() => window.toucan.measure())
	assert.equal(mapCheck.findings.length, 0, JSON.stringify(mapCheck.findings))
	await shot('radio-map', 650)

	await cli('new', 'editorial-handoff', '--title', 'Editorial handoff', '--from', fixture('handoff.tg.json', handoff))
	await open('editorial-handoff', 'edit')
	const flowCheck = await page.evaluate(() => window.toucan.measure())
	assert.equal(flowCheck.findings.length, 0, JSON.stringify(flowCheck.findings))
	await shot('editorial-handoff', 650)

	const plan = JSON.parse(readFileSync(join(root, 'examples/website-relaunch.plan.json')))
	const demoItems = ['audit', 'sitemap', 'voice', 'wireframes', 'design-system', 'scaffold', 'analytics', 'redirects']
	plan.items = plan.items.filter((item) => demoItems.includes(item.id))
	for (const item of plan.items) if (item.dependsOn) item.dependsOn = item.dependsOn.filter((id) => demoItems.includes(id))
	await cli('new', 'relaunch-board', '--title', 'Website relaunch', '--plan', 'file', fixture('relaunch.plan.json', plan), '--views', 'board')
	await open('relaunch-board')
	await cli('--canvas', 'relaunch-board', 'plan', 'sync')
	await page.waitForFunction(() => window.toucan.get('plan:board:item:wireframes'), null, { timeout: 30000 })
	await shot('relaunch-board', 690)
	await page.evaluate(() => {
		const card = window.toucan.get('plan:board:item:scaffold')
		const lane = window.toucan.get('plan:board:col:review')
		window.editor.reparentShapes([card.id], lane.id)
	})
	await page.waitForFunction(() => {
		const card = window.toucan.get('plan:board:item:scaffold')
		return card?.meta?.plan?.version === 2 && card.parentId === window.toucan.get('plan:board:col:review')?.id
	}, null, { timeout: 20000 })
	const copied = JSON.parse(readFileSync(join(home, 'data/relaunch-board.files/relaunch.plan.json')))
	assert.equal(copied.items.find((item) => item.id === 'scaffold').stage, 'review')

	// The sample website has fictional copy, but the screenshot review and its reply are real Toucan records.
	const sample = await browser.newPage({ viewport: { width: 720, height: 420 }, deviceScaleFactor: 1 })
	async function captureSample(name, revised) {
		const file = join(home, name + '.png')
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
	console.log(`Captured four local examples. Diagram scores: ${mapCheck.score}, ${flowCheck.score}. Board move verified against its source file.`)
} finally {
	await browser?.close()
	const stopped = once(server, 'exit')
	server.kill()
	await stopped
	rmSync(home, { force: true, recursive: true })
}
