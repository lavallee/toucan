// toucan's MCP App, end to end, in a host built on the official MCP Apps SDK (@modelcontextprotocol/ext-apps' AppBridge): the
// host runs `toucan mcp` over stdio, a scripted agent calls its tools, and the canvas view appears in the conversation. A person
// edits the same canvas in toucan beside it; the view in the chat keeps up, and the agent's next call hears what they did.
//
//   npm run build && npm run test:mcp-app                     checks it, in a throwaway HOME and data directory
//   LICENSE_ENV=path/to/.env node scripts/mcp-app-demo.mjs --record
//                                                             also records website/site/assets/demos/mcp-app.mp4 and its poster
//
// The agent is a script, not a model: what it says is written here, and every tool call is real. The host is a page this script
// serves; it renders the view in a sandboxed iframe under the MCP Apps default CSP (no network), as a real host does.
// Needs playwright-core's Chromium; --record also needs ffmpeg, and the tldraw licence (TLDRAW_LICENSE_KEY, or LICENSE_ENV).

import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createServer as createHttp } from 'node:http'
import { createServer } from 'node:net'
import { homedir, platform, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { parseEnv, promisify } from 'node:util'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (!existsSync(join(ROOT, 'dist/index.html'))) throw new Error('build the app first: npm run build')
const RECORD = process.argv.includes('--record')
const { chromium } = await import('playwright-core')
const run = promisify(execFile)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const step = (msg) => console.log(`ok  ${msg}`)
const freePort = () => new Promise((r) => {
	const s = createServer().listen(0, '127.0.0.1', () => (r(s.address().port), s.close()))
})

const keyNames = ['TLDRAW_LICENSE_KEY', 'TLDRAW_LICENSE', 'VITE_TLDRAW_LICENSE_KEY']
const fileEnv = process.env.LICENSE_ENV ? parseEnv(readFileSync(process.env.LICENSE_ENV, 'utf8')) : {}
const license = keyNames.map((k) => process.env[k]?.trim() || fileEnv[k]?.trim()).find(Boolean)
if (RECORD) assert.ok(license, 'to record, set the tldraw licence in TLDRAW_LICENSE_KEY, or LICENSE_ENV to a dotenv file holding it')

// ---- the host's own code: the official AppBridge, bundled for the page ----------------------------------------------------
const work = mkdtempSync(join(tmpdir(), 'toucan-mcp-app-'))
const { build } = await import('vite')
await build({
	configFile: false,
	logLevel: 'warn',
	root: work,
	build: { outDir: join(work, 'host'), emptyOutDir: true, lib: { entry: join(ROOT, 'node_modules/@modelcontextprotocol/ext-apps/dist/src/app-bridge.js'), formats: ['es'], fileName: () => 'bridge.js' }, minify: false },
})
const bridgeJs = readFileSync(join(work, 'host/bridge.js'), 'utf8')

// ---- toucan, in a throwaway home --------------------------------------------------------------------------------------------
const home = mkdtempSync(join(tmpdir(), 'toucan-mcp-home-')), data = mkdtempSync(join(tmpdir(), 'toucan-mcp-data-')), project = mkdtempSync(join(tmpdir(), 'release-'))
const port = await freePort()
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('TOUCAN_') && !k.startsWith('XDG_')))
Object.assign(env, { HOME: home, TOUCAN_PORT: String(port), TOUCAN_BROWSER: 'true', PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), platform() === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright'), ...(license && { TLDRAW_LICENSE_KEY: license }) })
const server = spawn(process.execPath, [join(ROOT, 'server/index.mjs'), '--port', String(port), '--data', data], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
let serverLog = ''
server.stdout.on('data', (d) => (serverLog += d))
server.stderr.on('data', (d) => (serverLog += d))
for (let i = 0; i < 80 && !serverLog.includes('listening'); i++) await sleep(100)
const toucan = (...a) => run(process.execPath, [join(ROOT, 'bin/toucan.mjs'), ...a], { cwd: project, env }).then((r) => r.stdout.trim())
const CANVAS = 'release'
await toucan('new', CANVAS, '--title', 'Release pipeline')
const token = JSON.parse(readFileSync(join(home, '.config/toucan/server.json'), 'utf8')).token

// ---- `toucan mcp`, as the host's MCP client starts it ------------------------------------------------------------------------
const mcp = spawn(process.execPath, [join(ROOT, 'bin/toucan.mjs'), 'mcp'], { cwd: project, env, stdio: ['pipe', 'pipe', 'pipe'] })
let mcpErr = ''
mcp.stderr.on('data', (d) => (mcpErr += d))
const answers = new Map()
let rpcId = 0
createInterface({ input: mcp.stdout }).on('line', (line) => {
	const m = JSON.parse(line)
	answers.get(m.id)?.(m)
	answers.delete(m.id)
})
const rpc = (method, params) => new Promise((r) => {
	const id = ++rpcId
	answers.set(id, r)
	mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
})
const init = await rpc('initialize', { protocolVersion: '2025-11-25', clientInfo: { name: 'toucan-demo-host', version: '1' }, capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } } })
assert.ok(init.result.capabilities.extensions['io.modelcontextprotocol/ui'], 'the server says it has apps')
const tools = (await rpc('tools/list', {})).result.tools
const byName = Object.fromEntries(tools.map((t) => [t.name, t]))
assert.equal(byName.toucan_draw._meta.ui.resourceUri, 'ui://toucan/canvas.html', 'toucan_draw shows the canvas')
assert.equal(byName.toucan_open._meta.ui.resourceUri, 'ui://toucan/canvas.html', 'so does toucan_open')
assert.deepEqual(byName.toucan_canvas_picture._meta.ui.visibility, ['app'], 'the picture tool is for the view only')
const view = (await rpc('resources/read', { uri: 'ui://toucan/canvas.html' })).result.contents[0]
assert.equal(view.mimeType, 'text/html;profile=mcp-app')
step('tools/list carries the view; resources/read serves it')

// ---- the host page ----------------------------------------------------------------------------------------------------------
// A conversation on the left, toucan in the person's browser on the right. The host's page calls back here (/rpc) for MCP.
const hostPort = await freePort()
const toucanUrl = `http://127.0.0.1:${port}/?canvas=${CANVAS}#token=${token}`
const HOST = `<!doctype html><html><head><meta charset="utf-8"><title>An MCP Apps host</title><style>
	* { box-sizing: border-box } body { margin: 0; height: 100vh; display: grid; grid-template-columns: 560px 1fr; font: 14px/1.45 ui-sans-serif, system-ui, sans-serif; color: #1f1f1f; background: #f6f5f2 }
	#chat { overflow-y: auto; padding: 18px 18px 40px; border-right: 1px solid #ddd9d0; scroll-behavior: smooth }
	.bar { font-size: 12px; color: #7a766d; margin-bottom: 14px; display: flex; justify-content: space-between }
	.msg { margin: 0 0 12px; padding: 10px 13px; border-radius: 12px; max-width: 94% }
	.user { background: #e9e5dc; margin-left: auto; width: fit-content }
	.agent { background: transparent; padding-left: 2px }
	.tool { font: 12px/1.4 ui-monospace, monospace; color: #5d5a52; background: #fff; border: 1px solid #e3dfd6; border-radius: 8px; padding: 7px 10px; margin: 0 0 10px; white-space: pre-wrap; max-height: 9.5em; overflow: hidden }
	.tool b { color: #b4501b; font-weight: 600 } .tool .act { color: #2f6f3e }
	iframe.app { width: 100%; height: 360px; border: 1px solid #e3dfd6; border-radius: 10px; background: #fff; margin: 0 0 14px; display: block; transition: height .25s }
	#side { display: grid; grid-template-rows: auto 1fr; min-width: 0 }
	#side .bar { margin: 0; padding: 10px 14px; border-bottom: 1px solid #ddd9d0; background: #fbfaf7 }
	#side iframe { width: 100%; height: 100%; border: 0 }
	.heard { font-size: 13px; background: #eef6ef; border: 1px solid #cfe3d3; color: #24502f; border-radius: 8px; padding: 8px 11px; margin: 0 0 10px; white-space: pre-wrap }
	.heard b { font-weight: 600 }
	#caption { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%); background: rgba(24,24,27,.92); color: #fff; font-size: 19px; padding: 12px 22px; border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.25); opacity: 0; transition: opacity .35s; z-index: 10; max-width: 1100px; text-align: center }
	#caption.on { opacity: 1 }
	#caption small { display: block; font-size: 13px; color: #c9c6bf; margin-top: 3px }
	#cursor { position: fixed; width: 22px; height: 22px; margin: -3px 0 0 -3px; pointer-events: none; z-index: 9; display: none }
</style></head><body>
<section id="chat"><div class="bar"><span>Chat · an MCP Apps host · scripted agent</span><span>toucan mcp</span></div></section>
<section id="side"><div class="bar"><span>toucan in the person's browser</span><span>release</span></div><iframe id="toucan" src="${toucanUrl}"></iframe></section>
<div id="caption"></div>
<svg id="cursor" viewBox="0 0 24 24"><path d="M4 2l16 9-7 2-3 7z" fill="#1f1f1f" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>
<script type="module">
import { AppBridge, PostMessageTransport } from '/bridge.js'
const chat = document.getElementById('chat')
const rpc = (method, params) => fetch('/rpc', { method: 'POST', body: JSON.stringify({ method, params }) }).then((r) => r.json())
const tools = (await rpc('tools/list', {})).result.tools
const el = (cls, html) => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; chat.append(d); chat.scrollTop = chat.scrollHeight; return d }
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
// The MCP Apps default policy: the view may not reach the network.
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; connect-src 'none'; frame-src 'none'"
window.demo = {
	caption(t, sub) {
		const c = document.getElementById('caption')
		c.innerHTML = t ? esc(t) + (sub ? '<small>' + esc(sub) + '</small>' : '') : ''
		c.className = t ? 'on' : ''
	},
	cursor(x, y) {
		const c = document.getElementById('cursor')
		c.style.display = x == null ? 'none' : 'block'
		c.style.left = x + 'px'
		c.style.top = y + 'px'
	},
	user: (t) => el('msg user', esc(t)),
	agent: (t) => el('msg agent', esc(t)),
	async call(name, args, brief) {
		const card = el('tool', '<b>' + name + '</b> ' + esc(brief ?? ''))
		const tool = tools.find((t) => t.name === name)
		const res = (await rpc('tools/call', { name, arguments: args })).result
		const text = res.content.filter((c) => c.type === 'text').map((c) => c.text).join('\\n')
		const act = text.match(/<canvas_activity[\\s\\S]*?<\\/canvas_activity>/)?.[0]
		const answer = text.replace(/<canvas_activity[\\s\\S]*?<\\/canvas_activity>/g, '').trim()
		card.innerHTML += '\\n→ ' + esc(answer.split('\\n').slice(0, 3).join('\\n').slice(0, 220))
		// What toucan told the agent about the person, as the agent reads it.
		if (act) el('heard', '<b>toucan told the agent what changed:</b>\\n' + esc(act.split('\\n').filter((l) => l.startsWith('- ')).join('\\n')))
		const uri = tool?._meta?.ui?.resourceUri
		if (uri) await this.mount(uri, tool, args, res)
		chat.scrollTop = chat.scrollHeight
		return { text, activity: act ?? '' }
	},
	async mount(uri, tool, args, result) {
		const html = (await rpc('resources/read', { uri })).result.contents[0].text.replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="' + CSP + '">')
		const frame = document.createElement('iframe')
		frame.className = 'app'
		frame.sandbox = 'allow-scripts'
		chat.append(frame)
		const hostContext = { theme: 'light', platform: 'web', displayMode: 'inline', availableDisplayModes: ['inline'], containerDimensions: { maxHeight: 640, width: 520 } }
		const bridge = new AppBridge(null, { name: 'toucan demo host', version: '1' }, { serverTools: {}, openLinks: {} }, { hostContext })
		// A view may call only tools marked for it (visibility includes "app"), on its own server.
		bridge.oncalltool = async (p) => {
			const t = tools.find((x) => x.name === p.name)
			const vis = t?._meta?.ui?.visibility ?? ['model', 'app']
			if (!vis.includes('app')) throw new Error(p.name + ' is not for apps')
			window.viewCalls = (window.viewCalls ?? 0) + 1
			if (p.name === 'toucan_open') window.opened = (window.opened ?? 0) + 1
			return (await rpc('tools/call', p)).result
		}
		bridge.onsizechange = ({ height }) => { if (height) frame.style.height = Math.min(640, height) + 'px' }
		bridge.onopenlink = async () => ({})
		bridge.oninitialized = async () => {
			await bridge.sendToolInput({ arguments: args })
			await bridge.sendToolResult(result)
		}
		await bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow))
		frame.srcdoc = html
		window.views = (window.views ?? 0) + 1
	},
}
window.ready = true
</script></body></html>`

const http = createHttp(async (req, res) => {
	if (req.url === '/') return res.writeHead(200, { 'content-type': 'text/html' }), res.end(HOST)
	if (req.url === '/bridge.js') return res.writeHead(200, { 'content-type': 'text/javascript' }), res.end(bridgeJs)
	if (req.url === '/rpc' && req.method === 'POST') {
		let body = ''
		for await (const c of req) body += c
		const { method, params } = JSON.parse(body)
		return res.writeHead(200, { 'content-type': 'application/json' }), res.end(JSON.stringify(await rpc(method, params)))
	}
	res.writeHead(404).end()
}).listen(hostPort, '127.0.0.1')

// ---- the conversation -------------------------------------------------------------------------------------------------------
const W = 1600, H = 900
let browser, failed = false
try {
	browser = await chromium.launch()
	const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, ...(RECORD && { recordVideo: { dir: work, size: { width: W, height: H } } }) })
	await context.addInitScript(() => {
		try {
			localStorage.setItem('toucan.name', 'Sam')
			localStorage.setItem('toucan.chat', 'closed') // toucan's own chat panel isn't what this shows
		} catch {} // the sandboxed view has no storage
	})
	const page = await context.newPage()
	const born = Date.now() // the recording starts with the page; it's cut to start at the first caption
	let start = 0
	page.on('pageerror', (e) => console.error('page error:', e.message))
	await page.goto(`http://127.0.0.1:${hostPort}/`)
	await page.waitForFunction(() => window.ready)
	const personFrame = page.frame({ url: /canvas=release/ })
	await personFrame.waitForFunction(() => window.toucan, null, { timeout: 30000 })
	await personFrame.addStyleTag({ content: '.tlui-style-panel__wrapper { display: none !important }' })
	await sleep(RECORD ? 1500 : 200)

	const pause = (ms) => sleep(RECORD ? ms : 50)
	const say = async (who, text, ms = 900) => {
		await page.evaluate(([w, t]) => window.demo[w](t), [who, text])
		await pause(ms)
	}
	const caption = (t, sub) => page.evaluate(([a, b]) => window.demo.caption(a, b), [t, sub])
	const call = (name, args, brief) => page.evaluate(([n, a, b]) => window.demo.call(n, a, b), [name, args, brief])
	const app = () => page.frames().find((f) => f.parentFrame() === page.mainFrame() && f !== personFrame && f.url() !== page.url())
	const pictureSrc = () => app().evaluate(() => document.getElementById('pic').getAttribute('src') ?? '')
	// Until the picture in the chat says this (the view polls every 1.5 s, so it may catch a label half typed first).
	const pictureSays = (text) => app().waitForFunction((t) => decodeURIComponent(document.getElementById('pic').getAttribute('src') ?? '').includes(t), text, { timeout: 20000 })
	// The person's pointer, drawn by the host page (a recording doesn't show the real one).
	let mouse = { x: W - 300, y: H - 200 }
	const glide = async (x, y, steps = 16) => {
		const from = mouse
		for (let i = 1; i <= (RECORD ? steps : 1); i++) {
			const t = i / (RECORD ? steps : 1), e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
			mouse = { x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e }
			await page.mouse.move(mouse.x, mouse.y)
			await page.evaluate(([cx, cy]) => window.demo.cursor(cx, cy), [mouse.x, mouse.y])
			if (RECORD) await sleep(16)
		}
	}

	await caption('An agent draws with toucan over MCP, and the canvas appears in the chat', 'Left: a chat in an MCP Apps host. Right: the same canvas, open in toucan.')
	start = (Date.now() - born) / 1000
	await pause(3200)
	await say('user', 'Sketch our release pipeline on the canvas: build, test, then staging.', 1400)
	await say('agent', "I'll draw it on the release canvas.", 600)
	const spec = { kind: 'flow', direction: 'RIGHT', nodes: [{ id: 'build', text: 'Build' }, { id: 'test', text: 'Test' }, { id: 'staging', text: 'Deploy to staging' }], edges: [{ from: 'build', to: 'test' }, { from: 'test', to: 'staging' }] }
	await call('toucan_draw', { canvas: CANVAS, spec, label: 'release pipeline' }, 'a flow: Build → Test → Deploy to staging')
	await page.waitForFunction(() => window.views === 1)
	await app().waitForFunction(() => !document.getElementById('pic').hidden && document.getElementById('pic').naturalWidth > 0, null, { timeout: 20000 })
	assert.match(await app().evaluate(() => document.getElementById('title').textContent), /Release pipeline/)
	assert.match(await app().evaluate(() => document.getElementById('meta').textContent), /shapes/)
	step('toucan_draw: the view appears in the chat, under the MCP Apps CSP, with the drawing in it')
	await caption('1. toucan_draw returns the canvas as an MCP App: a live view, inside the conversation')
	await say('agent', 'Here it is. The view stays live: edit the canvas in toucan and it keeps up.', 3800)

	// The person renames a box in toucan, by hand.
	await caption('2. A person edits the same canvas in toucan', 'They rename “Deploy to staging”.')
	const box = await personFrame.evaluate(() => {
		const ed = window.editor
		const b = ed.getShapePageBounds(window.toucan.idFor('staging'))
		const p = ed.pageToScreen({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
		return { x: p.x, y: p.y }
	})
	const off = await page.locator('#toucan').boundingBox()
	const at = { x: off.x + box.x, y: off.y + box.y }
	await glide(at.x, at.y, 40)
	await page.mouse.dblclick(at.x, at.y)
	await pause(300)
	await page.keyboard.press('ControlOrMeta+a')
	await page.keyboard.type('Deploy to staging + smoke test', { delay: RECORD ? 55 : 5 })
	await page.keyboard.press('Escape')
	await glide(off.x + off.width / 2, off.y + off.height - 140, 24)
	await page.mouse.click(mouse.x, mouse.y)
	await pictureSays('Deploy to staging + smoke test')
	step("the person's edit in toucan reaches the view in the chat")
	await caption('3. The view in the chat keeps up with their edit', 'It asks the host for a fresh picture every 1.5 s. It needs no network of its own.')
	await pause(3600)

	await caption('4. The agent hears what they did, with its next tool call')
	await say('user', 'Now add the production step.', 1200)
	const looked = await call('toucan_describe', { canvas: CANVAS }, 'what the diagram says')
	assert.match(looked.activity, /smoke test/, 'and the agent hears it with its next call')
	step('the agent hears the edit in <canvas_activity>')
	await pause(1800)
	await say('agent', 'You renamed staging to “Deploy to staging + smoke test”, so production goes after that, and your wording stays.', 1600)
	await call('toucan_import', { canvas: CANVAS, content: 'flowchart LR\n  staging --> prod[Deploy to production]', label: 'production step' }, 'staging → Deploy to production')
	await pictureSays('Deploy to production')
	assert.ok(decodeURIComponent(await pictureSrc()).includes('smoke test'), "the person's wording stays")
	step("the agent's next edit shows up in the same view")
	await caption('5. Both edits are in one canvas, in toucan and in the chat')
	await say('agent', 'Done: build → test → staging + smoke test → production.', 4200)

	// The view's own button: opens the canvas in the person's browser through toucan_open (a view-callable tool).
	await caption('“Edit in toucan” in the view opens the canvas in the person’s browser, signed in')
	await app().click('#open')
	await page.waitForFunction(() => window.opened === 1, null, { timeout: 15000 })
	await app().waitForFunction(() => /Opened|opened/.test(document.getElementById('status').textContent))
	step('"Edit in toucan" opens the canvas through toucan_open')
	await pause(3000)
	const calls = await page.evaluate(() => window.viewCalls)
	assert.ok(calls >= 3, `the view polled through the host (${calls} calls)`)


	if (RECORD) {
		const video = page.video()
		await context.close()
		const raw = await video.path()
		const out = join(ROOT, 'website/site/assets/demos')
		mkdirSync(out, { recursive: true })
		await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', start.toFixed(2), '-i', raw, '-an', '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-movflags', '+faststart', join(out, 'mcp-app.mp4')])
		await run('ffmpeg', ['-y', '-loglevel', 'error', '-sseof', '-7', '-i', join(out, 'mcp-app.mp4'), '-frames:v', '1', join(out, 'mcp-app.poster.png')])
		step(`recorded ${join(out, 'mcp-app.mp4')}`)
	}
	console.log('\nthe MCP App works end to end')
} catch (e) {
	failed = true
	console.error(e)
	console.error('--- server log ---\n' + serverLog.slice(-3000))
	if (mcpErr) console.error('--- mcp stderr ---\n' + mcpErr.slice(-2000))
} finally {
	await browser?.close().catch(() => {})
	http.close()
	mcp.kill()
	server.kill()
	for (const d of [home, data, project, work]) rmSync(d, { recursive: true, force: true })
	process.exit(failed ? 1 : 0)
}
