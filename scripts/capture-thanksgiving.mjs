// npm run build && CHROMIUM=/usr/bin/chromium node scripts/capture-thanksgiving.mjs
// Records a real Toucan tab. Requires Playwright Chromium and ffmpeg.
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium } from 'playwright-core'

const root = fileURLToPath(new URL('../', import.meta.url))
const out = join(root, 'website/site/assets/use-cases')
mkdirSync(out, { recursive: true })
const home = mkdtempSync(join(tmpdir(), 'toucan-thanksgiving-'))
const socket = createServer().listen(0, '127.0.0.1')
await once(socket, 'listening')
const port = socket.address().port
await new Promise((done) => socket.close(done))
const origin = `http://127.0.0.1:${port}`
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('TOUCAN_')))
Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), TOUCAN_URL: origin })
const server = spawn(process.execPath, ['server/index.mjs', '--port', String(port), '--data', join(home, 'data')], { cwd: root, env, stdio: 'ignore' })
const run = promisify(execFile)
const canvas = 'thanksgiving'
const cli = (...args) => run(process.execPath, ['bin/toucan.mjs', ...args], { cwd: root, env }).then((res) => res.stdout)
const onCanvas = (...args) => cli('--canvas', canvas, ...args)
const x = (minutes) => 184 + minutes * 9
const label = (key, text, left, y, w, size = 'm', color = 'black') => ({
	key, text, box: { x: left, y, w, h: 40 }, style: { geo: 'text', size, color },
})
const bar = (key, text, start, end, y, color, detail) => ({
	key, text, box: { x: x(start), y, w: (end - start) * 9, h: 62 },
	style: { color, fill: 'semi', dash: 'solid', size: 'm' }, meta: { detail },
})
const graph = {
	groups: [],
	nodes: [
		label('title', 'Thanksgiving, one oven', 0, 0, 1050, 'xl'),
		label('subtitle', 'Eight at the table. Dinner at 5:15.', 0, 67, 1000, 'm'),
		...[['3:30', 0], ['4:00', 30], ['4:30', 60], ['5:00', 90], ['5:15', 105]]
			.map(([time, minute]) => label(`time-${minute}`, time, x(minute), 135, 90, 's')),
		label('main-label', 'Main oven', 0, 191, 170, 'm'),
		label('toaster-label', 'Toaster oven', 0, 375, 175, 'm'),
		label('table-label', 'At the table', 0, 480, 180, 'm'),
		label('hands-note', 'Maya brings dressing · Eli brings rolls and a toaster oven', 0, 103, 1120, 's', 'black'),
		bar('turkey', 'Turkey · final oven block', 0, 60, 188, 'orange', 'The turkey is already roasting when this board starts. This bar reserves the last stretch in the main oven.'),
		bar('dressing', 'Maya’s dressing', 30, 70, 271, 'red', 'Maya brings the dressing. It needs a main-oven slot.'),
		bar('rolls', 'Eli’s rolls', 75, 95, 188, 'yellow', 'Eli brings the rolls and a toaster oven.'),
		bar('table', 'Set out drinks and salad', 36, 88, 477, 'light-blue', 'Sam sets the table while the ovens are busy.'),
		label('serve', 'Serve', x(105), 490, 90, 'm', 'green'),
	],
	edges: [],
}
const fixture = join(out, 'thanksgiving.tg.json')
writeFileSync(fixture, JSON.stringify(graph, null, 2) + '\n')

let browser, context
try {
	let token
	for (let attempt = 0; attempt < 100 && !token; attempt++) {
		try {
			const config = JSON.parse(readFileSync(join(home, '.config/toucan/server.json')))
			if ((await fetch(`${origin}/api/health`, { headers: { authorization: `Bearer ${config.token}` } })).ok) token = config.token
		} catch {}
		if (!token) await sleep(50)
	}
	assert.ok(token, 'local Toucan started')
	await cli('new', canvas, '--title', 'Thanksgiving dinner', '--from', fixture)
	browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
	const viewport = { width: 1440, height: 900 }
	context = await browser.newContext({ viewport, recordVideo: { dir: home, size: viewport } })
	await context.addInitScript(() => {
		localStorage.setItem('toucan.chat', 'closed')
		localStorage.setItem('toucan.theme', 'light')
	})
	const page = await context.newPage()
	const video = page.video()
	await page.goto(`${origin}/?canvas=${canvas}#token=${token}`)
	await page.waitForFunction(() => window.toucan?.get('dressing'), null, { timeout: 30000 })
	await page.addStyleTag({ content: '.tlui-style-panel__wrapper { visibility: hidden }' })
	await page.evaluate(() => {
		const e = window.editor
		e.selectNone()
		const bounds = e.getCurrentPageBounds()
		e.zoomToBounds(bounds, { inset: 105, animation: { duration: 0 } })
		e.centerOnPoint({ x: bounds.center.x, y: bounds.center.y + 35 }, { animation: { duration: 0 } })
		const style = document.createElement('style')
		style.textContent = `
			.film-card{position:fixed;z-index:9999;bottom:62px;left:48px;max-width:520px;padding:15px 22px 17px;border-radius:10px;background:#2f241c;color:#fff5e1;font:22px/1.34 system-ui,sans-serif;pointer-events:none;box-shadow:0 5px 24px #261c2540}
			.film-card strong{display:block;margin-bottom:5px;color:#ffbc69;font-size:15px;letter-spacing:.015em}
			.film-cursor{position:fixed;z-index:9999;width:28px;height:28px;border:3px solid #a23726;border-radius:50%;background:#ffcf7870;pointer-events:none;transform:translate(-50%,-50%);display:none}
			.film-cursor.pressed{background:#ffb44eaa}
			.film-focus{position:fixed;z-index:9998;border:2px dashed #a23726;border-radius:7px;pointer-events:none;box-sizing:border-box;background:#d65b2415}
		`
		document.head.append(style)
		const card = Object.assign(document.createElement('div'), { className: 'film-card' })
		const kicker = document.createElement('strong')
		const words = document.createElement('span')
		card.append(kicker, words)
		const focus = Object.assign(document.createElement('div'), { className: 'film-focus', hidden: true })
		const cursor = Object.assign(document.createElement('div'), { className: 'film-cursor' })
		document.body.append(card, focus, cursor)
		window.film = { kicker, words, focus, cursor }
		window.addEventListener('pointermove', (event) => Object.assign(cursor.style, { display: 'block', left: event.clientX + 'px', top: event.clientY + 'px' }))
		window.addEventListener('pointerdown', () => cursor.classList.add('pressed'))
		window.addEventListener('pointerup', () => cursor.classList.remove('pressed'))
	})
	const caption = (heading, copy, focus = null) => page.evaluate(({ heading, copy, focus }) => {
		const { kicker, words, focus: marker } = window.film
		kicker.textContent = heading
		words.textContent = copy
		marker.hidden = !focus
		if (!focus) return
		const a = window.editor.pageToScreen({ x: focus.x, y: focus.y })
		const b = window.editor.pageToScreen({ x: focus.x + focus.w, y: focus.y + focus.h })
		Object.assign(marker.style, { left: a.x + 'px', top: a.y + 'px', width: b.x - a.x + 'px', height: b.y - a.y + 'px' })
	}, { heading, copy, focus })
	const box = (key) => page.evaluate((key) => {
		const b = window.editor.getShapePageBounds(window.toucan.get(key).id)
		return { x: b.x, y: b.y, w: b.w, h: b.h }
	}, key)
	const overlap = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
	const drag = async (key, dx, dy) => {
		const { x: sx, y: sy, endX, endY } = await page.evaluate(({ key, dx, dy }) => {
			const e = window.editor
			const c = e.getShapePageBounds(window.toucan.get(key).id).center
			const start = e.pageToScreen(c)
			const end = e.pageToScreen({ x: c.x + dx, y: c.y + dy })
			return { x: start.x, y: start.y, endX: end.x, endY: end.y }
		}, { key, dx, dy })
		await page.mouse.move(sx, sy, { steps: 24 })
		await sleep(360)
		await page.mouse.down()
		for (let step = 1; step <= 40; step++) {
			await page.mouse.move(sx + (endX - sx) * step / 40, sy + (endY - sy) * step / 40)
			await sleep(25)
		}
		await page.mouse.up()
		await page.keyboard.press('Escape')
	}
	await caption('Dinner at 5:15', 'Eight people, three hot dishes, one main oven.')
	await sleep(3700)
	const turkey = await box('turkey')
	const before = await box('dressing')
	const rolls = await box('rolls')
	assert.equal(overlap(turkey, before), 270)
	await caption('Spot the clash', 'The turkey and the dressing both need the main oven at 4:00.', { x: x(30), y: 178, w: 270, h: 167 })
	await sleep(5100)
	await page.screenshot({ path: join(out, 'thanksgiving-clash.jpg'), quality: 91 })
	await caption('Make room for the dressing', 'Drag it to the 4:30 slot, right after the turkey.')
	await sleep(2500)
	await drag('dressing', turkey.x + turkey.w - before.x + 1, 0)
	const updated = await box('dressing')
	assert.ok(Math.abs(updated.x - (turkey.x + turkey.w)) < 3)
	assert.ok(overlap(updated, rolls) > 170)
	await sleep(2400)
	await caption('Use the toaster oven', 'The rolls now clash with the dressing. Eli is bringing a toaster oven, so move the rolls down.')
	await sleep(4300)
	await drag('rolls', 0, 183)
	const moved = await box('rolls')
	assert.ok(Math.abs(moved.y - 371) < 3)
	assert.ok(Math.abs(moved.x - rolls.x) < 3)
	assert.ok(updated.x + updated.w < x(105))
	await page.mouse.move(55, 70)
	await page.evaluate(() => { window.film.cursor.style.display = 'none' })
	await caption('Dinner is on', 'Each oven has one job at a time. The dressing finishes with five minutes to spare.')
	await sleep(5200)
	await page.screenshot({ path: join(out, 'thanksgiving-dinner.jpg'), quality: 92 })

	await caption('Save the plan', 'Give the settled schedule a name in History so it’s easy to find later.')
	await page.getByRole('button', { name: 'History', exact: true }).click()
	const history = page.getByRole('region', { name: 'Version history' })
	await history.getByRole('textbox', { name: 'Version name' }).pressSequentially('Dinner schedule with both ovens', { delay: 40 })
	await history.getByRole('button', { name: 'Save', exact: true }).click()
	await history.getByText('Dinner schedule with both ovens', { exact: true }).waitFor()
	await sleep(3100)

	// Verify the saved edit through the server after closing the browser tab.
	await context.close()
	context = null
	const version = JSON.parse(await onCanvas('versions')).find((v) => v.label === 'Dinner schedule with both ovens')
	assert.ok(version, 'named version was saved')
	const saved = JSON.parse(await onCanvas('versions', 'show', String(version.n)))
	assert.ok(Math.abs(saved.nodes.find((n) => n.key === 'rolls').box.y - moved.y) < 2)
	assert.ok(Math.abs(saved.nodes.find((n) => n.key === 'dressing').box.x - updated.x) < 2)
	const raw = await video.path()
	// The first second contains startup frames. Preserve the live drags at their recorded speed.
	await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '1', '-i', raw,
		'-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p',
		'-movflags', '+faststart', '-an', join(out, 'thanksgiving-dinner.mp4')])
	console.log('Recorded two browser drags and verified the saved schedule through the canvas API.')
} finally {
	await context?.close()
	await browser?.close()
	if (server.exitCode === null && server.signalCode === null) {
		const stopped = once(server, 'exit')
		server.kill()
		await stopped
	}
	rmSync(home, { force: true, recursive: true })
}
