// Real two-turn Codex recording. Run after building Toucan.
// CODEX_BIN and CODEX_HOME can point to a signed-in Codex. Provide TLDRAW_LICENSE_KEY
// in the environment, or set MEAL_LICENSE_ENV to a local dotenv file. No key is published.
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { parseEnv, promisify } from 'node:util'
import { chromium } from 'playwright-core'
import { recipes, seed } from './thanksgiving/board.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const out = join(root, 'website/site/assets/use-cases')
const temp = mkdtempSync(join(tmpdir(), 'toucan-meal-'))
const data = join(temp, 'data')
const cwd = join(temp, 'app')
mkdirSync(data)
mkdirSync(cwd)
for (const name of ['bin','lib','server','templates','routines','scripts','website','dist','node_modules','package.json','AGENTS.md']) {
	// The server resolves its root relative to its own files. Place the server in a
	// disposable root to isolate the chat's saved thread map.
	if (name === 'server') cpSync(join(root, name), join(cwd, name), { recursive: true })
	else symlinkSync(join(root, name), join(cwd, name))
}
const socket = createServer().listen(0, '127.0.0.1')
await once(socket, 'listening')
const port = socket.address().port
await new Promise((done) => socket.close(done))
const origin = `http://127.0.0.1:${port}`
const keyNames = ['TLDRAW_LICENSE_KEY', 'TLDRAW_LICENSE', 'VITE_TLDRAW_LICENSE_KEY']
const fileEnv = process.env.MEAL_LICENSE_ENV ? parseEnv(readFileSync(process.env.MEAL_LICENSE_ENV, 'utf8')) : {}
const license = [process.env, fileEnv].flatMap((source) => keyNames.map((name) => source[name]?.trim())).find(Boolean)
assert.ok(license, 'Set the deployment license in TLDRAW_LICENSE_KEY or MEAL_LICENSE_ENV')
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('TOUCAN_') && !keyNames.includes(name)))
const codex = process.env.CODEX_BIN
assert.ok(codex && existsSync(codex), 'Set CODEX_BIN to the signed-in Codex executable')
mkdirSync(join(temp, 'bin'))
writeFileSync(join(temp, 'bin/codex'), '#!/bin/sh\nexec "$MEAL_CODEX_BIN" -c sandbox_workspace_write.network_access=true "$@"\n', { mode: 0o700 })
Object.assign(env, {
	HOME: temp, XDG_CONFIG_HOME: join(temp, '.config'), TOUCAN_URL: origin,
	CODEX_HOME: process.env.CODEX_HOME ?? join(homedir(), '.codex'),
	MEAL_CODEX_BIN: codex, PATH: join(temp, 'bin') + ':' + dirname(process.execPath) + ':' + process.env.PATH,
})
const tool = 'scripts/thanksgiving/agent-tool.mjs'
const connection = join(temp, 'connection.json')
const demoInstructions = `This is a demo Thanksgiving board. Recipe facts are captured locally from the five links. Run all shell commands with the tool's structured workdir set to ${cwd}. Use relative command paths only. Read the recipe notes with node ${tool} recipes. Use exactly these two canvas tools for this meal so the menu and schedule share a layout. For the first request, make an array of five objects with id, ingredients (short plain-language list, 16–130 characters), and prep (one short paraphrased line, 16–130 characters). Write it to stdin with node ${tool} menu - using a quoted heredoc. The tool adds the photographs and source links.
For the second request, solve the schedule yourself, then run node ${tool} schedule - with a JSON object on stdin. Shape: {oven:[{id:"turkey",temp:325,start:"HH:MM",end:"HH:MM"},{id:"dressing",temp:350,start:"HH:MM",end:"HH:MM"},{id:"rolls",temp:375,start:"HH:MM",end:"HH:MM"}],salad:{start:"HH:MM",end:"HH:MM"},dayBefore:"22–140 chars",morning:"22–140 chars",serve:"22–140 chars"}. 24-hour times between 10:00 and 18:00. Use only one oven. Reserve 180 minutes for turkey, 65 for dressing, 24 for rolls and at least 8 minutes for each temperature change. Finish the rolls by 17:55 and toss salad late. Include cranberry sauce and bread drying the day before, roll dough/proof in earlier prep, and say to verify turkey doneness before resting and to confirm safe hot-holding equipment outside the oven. These are scheduling reservations, not cooking instructions. Don't browse or use unrelated tools, since the sources were already captured. Keep replies short. The recording harness checks the visual layout, so don't make a separate screenshot.`
const isolatedChat = join(cwd, 'server/codex.mjs')
const chatSource = readFileSync(isolatedChat, 'utf8')
const hook = "const developerInstructions = profile ?"
assert.ok(chatSource.includes(hook), 'Recording hook is missing')
writeFileSync(isolatedChat, chatSource.replace(hook, "const developerInstructions = " + JSON.stringify(demoInstructions + "\n\n") + " + (profile ?").replace(" : withRoutines\n", " : withRoutines)\n"))
const server = spawn(process.execPath, [join(cwd, 'server/index.mjs'), '--port', String(port), '--data', data], { cwd, env: { ...env, TLDRAW_LICENSE_KEY: license }, stdio: ['ignore', 'ignore', 'pipe'] })
server.stderr.on('data', (chunk) => { if (process.env.MEAL_DEBUG) process.stderr.write(chunk) })
const run = promisify(execFile)
const cli = (...args) => run(process.execPath, [join(root, 'bin/toucan.mjs'), ...args], { cwd, env })
let browser, context
try {
	let token
	for (let i = 0; i < 130 && !token; i++) {
		try {
			const config = JSON.parse(readFileSync(join(temp, '.config/toucan/server.json')))
			const res = await fetch(origin + '/api/tldraw-license', { headers: { authorization: 'Bearer ' + config.token } })
			if (res.ok && (await res.json()).licenseKey === license) token = config.token
		} catch {}
		if (!token) await sleep(50)
	}
	assert.ok(token, 'The recording server did not load its license')
	assert.equal((await fetch(origin + '/api/tldraw-license')).status, 401)
	writeFileSync(connection, JSON.stringify({ url: origin, token }), { mode: 0o600 })
	const start = join(temp, 'meal.tg.json')
	writeFileSync(start, JSON.stringify(seed))
	await cli('new', 'thanksgiving', '--title', 'Thanksgiving dinner', '--from', start)

	browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
	const viewport = { width: 1600, height: 1000 }
	context = await browser.newContext({ viewport, recordVideo: { dir: temp, size: viewport } })
	await context.addInitScript(() => {
		localStorage.setItem('toucan.chat', 'open')
		localStorage.setItem('toucan.theme', 'light')
		window.mealTurnEnds = 0
		window.mealTurnStarts = 0
		const Socket = window.WebSocket
		window.WebSocket = class extends Socket {
			constructor(...args) {
				super(...args)
				if (!String(args[0]).includes('/ws/chat')) return
				this.addEventListener('message', ({ data }) => {
					try {
						const event = JSON.parse(data)
						if (event.type === 'turn') {
							if (event.status === 'inProgress') window.mealTurnStarts++
							else window.mealTurnEnds++
						}
					} catch {}
				})
			}
		}
	})
	const page = await context.newPage()
	const video = page.video()
	const tick = Date.now()
	const when = () => (Date.now() - tick) / 1000
	const cuts = []
	let begin = 0
	const end = () => cuts.push([begin, when()])
	const input = page.getByRole('textbox', { name: 'Message', exact: true })
	await page.goto(`${origin}/?canvas=thanksgiving#token=${token}`)
	await page.waitForFunction(() => window.toucan?.get('menu-title'), null, { timeout: 30000 })
	await page.addStyleTag({ content: '.tlui-style-panel__wrapper { visibility:hidden }' })
	await page.evaluate(() => {
		const style = document.createElement('style')
		style.textContent = '.meal-caption{position:fixed;z-index:9999;bottom:66px;left:30px;max-width:560px;padding:14px 21px;border-radius:8px;background:#321e25;color:#fff2eb;font:23px/1.27 system-ui,sans-serif;pointer-events:none}.meal-caption strong{display:block;font-size:15px;color:#ffbb79;margin-bottom:4px}'
		document.head.append(style)
		const note = Object.assign(document.createElement('div'), { className: 'meal-caption' })
		note.append(document.createElement('strong'), document.createElement('span'))
		document.body.append(note)
	})
	const title = (tag, copy) => page.evaluate(([tag, copy]) => {
		const note = document.querySelector('.meal-caption')
		note.firstElementChild.textContent = tag
		note.lastElementChild.textContent = copy
	}, [tag, copy])
	const focus = (keys, inset = 75) => page.evaluate(({keys,inset}) => {
		const { editor, toucan } = window
		const shapes = keys.map((key) => toucan.get(key)).filter(Boolean)
		const bounds = editor.getShapesPageBounds(shapes.map((shape) => shape.id))
		if (bounds) editor.zoomToBounds(bounds, { inset, animation: { duration: 480 } })
	}, {keys,inset})
	const noUpsell = () => page.getByText('Get a license for production', { exact: true }).count().then((count) => assert.equal(count, 0, 'The tldraw SDK still displays the production license prompt'))
	await page.getByTestId('tl-watermark-licensed').waitFor()
	await noUpsell()

	const send = async (prompt) => {
		await input.fill(prompt)
		await sleep(1400)
		await input.press('Enter')
	}
	// Keep the real request and the real canvas write, cutting only idle time between them.
	const waitForAgentEdit = async (key, count) => {
		await page.waitForFunction((n) => window.mealTurnStarts >= n, count, { timeout: 35000 })
		await sleep(1800)
		const idleBegins = when()
		await page.waitForFunction((key) => !!window.toucan?.get(key), key, { timeout: 150000 })
		const edited = when()
		if (edited - idleBegins > 5) {
			cuts.push([begin, idleBegins])
			begin = edited - 2
		}
		await page.waitForFunction((n) => window.mealTurnEnds >= n, count, { timeout: 95000 })
		console.log(`Round ${count} committed by the chat agent.`)
	}
	begin = when()
	await title('Round 1', 'Five recipe links in. An editable dinner board out.')
	const prompt = 'Here are five Thanksgiving recipes. Add them to the canvas with a photo, ingredients, a prep summary, and a link back to each recipe.\n\n' + recipes.map((r) => r.url).join('\n')
	await send(prompt)
	await waitForAgentEdit('cranberry-prep', 1)
	const menuKeys = ['menu-title', 'photo-turkey', 'cranberry-prep']
	await focus(menuKeys)
	await sleep(2700)
	await noUpsell()
	await page.getByRole('button', { name: 'Hide chat', exact: true }).click()
	await focus(menuKeys, 105)
	await title('The menu', 'Five recipe cards the family can browse and edit.')
	await sleep(3000)
	await page.screenshot({ path: join(out, 'thanksgiving-menu.jpg'), quality: 91 })
	await focus(['photo-dressing', 'dressing-prep', 'recipe-dressing'], 180)
	await title('Zoom into a dish', 'Ingredients and prep stay next to the original recipe link.')
	await sleep(3600)
	await page.screenshot({ path: join(out, 'thanksgiving-prep.jpg'), quality: 91 })
	await page.getByRole('button', { name: 'Show chat', exact: true }).click()
	await focus(menuKeys)
	await title('Round 2', 'Dinner at 6. Make the oven schedule.')
	await send('We want to eat at 6:00 p.m. with one oven. Draw the whole schedule from scratch below the recipes. Show what we can prep ahead, what goes in the oven when, and when to turn the temperature up or down.')
	await waitForAgentEdit('schedule-title', 2)
	const scheduleKeys = ['schedule-title', 'schedule-transitions', 'schedule-serve', 'schedule-day-before']
	await focus(scheduleKeys)
	await sleep(3200)
	await page.getByRole('button', { name: 'Hide chat', exact: true }).click()
	await focus(scheduleKeys, 90)
	await title('The oven plan', 'The agent sequenced 325°F, 350°F, and 375°F, with time to change settings.')
	await sleep(4900)
	await page.screenshot({ path: join(out, 'thanksgiving-dinner.jpg'), quality: 91 })
	await noUpsell()
	await focus([...menuKeys, ...scheduleKeys], 95)
	await title('One board for dinner', 'Zoom out to see the recipes and oven plan together.')
	await sleep(3900)
	await page.screenshot({ path: join(out, 'thanksgiving-overview.jpg'), quality: 91 })
	const board = await page.evaluate(() => {
		const store = window.editor.store
		const records = store.allRecords().filter((r) => ['document', 'page', 'shape', 'binding', 'asset'].includes(r.typeName))
		return { tldrawFileFormatVersion: 1, schema: store.schema.serialize(), records }
	})
	assert.equal(board.records.filter((r) => r.type === 'image' && r.typeName === 'shape').length, 5)
	assert.equal(board.records.filter((r) => r.meta?.key === 'schedule-title').length, 1)
	assert.ok(existsSync(join(temp, 'menu.json')) && existsSync(join(temp, 'schedule.json')), 'Both agent tool calls produced receipts')
	writeFileSync(join(out, 'thanksgiving-board.tldr.json'), JSON.stringify(board))
	end()
	await context.close()
	context = null
	const raw = await video.path()
	const segments = []
	for (const [i, [from, to]] of cuts.entries()) {
		const segment = join(temp, 'segment-' + i + '.mp4')
		await run('ffmpeg', ['-hide_banner','-loglevel','error','-y','-ss',String(from),'-i',raw,'-t',String(to-from),'-an','-c:v','libx264','-threads','3','-crf','19','-pix_fmt','yuv420p',segment])
		segments.push(segment)
	}
	const list = join(temp, 'segments.txt')
	writeFileSync(list, segments.map((f) => "file '" + f + "'").join('\n'))
	await run('ffmpeg', ['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',list,'-c','copy','-movflags','+faststart',join(out,'thanksgiving-dinner.mp4')])
	if (process.env.MEAL_DEBUG) {
		copyFileSync(join(temp, 'schedule.json'), '/tmp/toucan-meal-schedule.json')
		copyFileSync(join(temp, 'menu.json'), '/tmp/toucan-meal-menu.json')
	}
	console.log('Verified two real chat rounds, five image cards, the generated schedule, and licensed rendering.')
} catch (error) {
	if (context && process.env.MEAL_DEBUG) await context.pages()[0]?.screenshot({ path: '/tmp/toucan-meal-debug.jpg' }).catch(() => {})
	throw error
} finally {
	await context?.close()
	await browser?.close()
	if (server.exitCode === null && server.signalCode === null) {
		const stopped = once(server, 'exit')
		server.kill()
		await stopped
	}
	rmSync(temp, { recursive: true, force: true })
}
