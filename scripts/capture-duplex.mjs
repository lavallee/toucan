// Records agents noticing people (server/activity.mjs) for the docs site and social posts: a real Codex turn in the chat
// panel while a person renames a box under it. Nothing is staged in the agent: it is the chat agent as shipped, told about
// the rename between its commands. The recording is cut and captioned into a GIF for the site and an MP4 for social.
//
//   npm run build && LICENSE_ENV=path/to/.env node scripts/capture-duplex.mjs
//
// Needs a signed-in Codex (CODEX_HOME, default ~/.codex; CODEX_BIN if `codex` on PATH is a shim), ffmpeg, playwright-core's Chromium, and the deployment's tldraw
// licence in the environment or in LICENSE_ENV (a dotenv file; no key is published). Writes
// website/site/assets/features/agents-notice.gif and website/work/agents-notice/ (social exports, not published).
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir, platform, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parseEnv, promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (!existsSync(join(ROOT, 'dist/index.html'))) throw new Error('build the app first: npm run build')
const { chromium } = await import('playwright-core')
const run = promisify(execFile)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const keyNames = ['TLDRAW_LICENSE_KEY', 'TLDRAW_LICENSE', 'VITE_TLDRAW_LICENSE_KEY']
const fileEnv = process.env.LICENSE_ENV ? parseEnv(readFileSync(process.env.LICENSE_ENV, 'utf8')) : {}
const license = keyNames.map((k) => process.env[k]?.trim() || fileEnv[k]?.trim()).find(Boolean)
assert.ok(license, 'Set the tldraw licence in TLDRAW_LICENSE_KEY, or LICENSE_ENV to a dotenv file holding it')

const SITE = join(ROOT, 'website/site/assets/features'), SOCIAL = join(ROOT, 'website/work/agents-notice')
mkdirSync(SITE, { recursive: true })
mkdirSync(SOCIAL, { recursive: true })
const home = mkdtempSync(join(tmpdir(), 'toucan-notice-home-')), data = mkdtempSync(join(tmpdir(), 'toucan-notice-data-')), work = mkdtempSync(join(tmpdir(), 'toucan-notice-'))
const port = await new Promise((r) => {
	const s = createServer().listen(0, '127.0.0.1', () => (r(s.address().port), s.close()))
})
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('TOUCAN_') && !k.startsWith('XDG_')))
Object.assign(env, { HOME: home, CODEX_HOME: process.env.CODEX_HOME ?? join(homedir(), '.codex'), TLDRAW_LICENSE_KEY: license, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), platform() === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright') })
// A version manager's shim may not run under a throwaway HOME: CODEX_BIN names the real binary, whose directory goes first.
if (process.env.CODEX_BIN) env.PATH = `${dirname(process.env.CODEX_BIN)}:${env.PATH}`
const server = spawn(process.execPath, [join(ROOT, 'server/index.mjs'), '--port', String(port), '--data', data], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''
server.stdout.on('data', (d) => (log += d))
server.stderr.on('data', (d) => (log += d))
for (let i = 0; i < 50 && !log.includes('listening'); i++) await sleep(100)
const toucan = (...a) => run(process.execPath, [join(ROOT, 'bin/toucan.mjs'), ...a], { cwd: ROOT, env }).then((r) => r.stdout)

const W = 1280, H = 800
let browser
const marks = {}
try {
	const token = JSON.parse(readFileSync(join(home, '.config/toucan/server.json'), 'utf8')).token
	const name = 'sign-up-flow'
	await toucan('new', name)
	const flow = join(work, 'flow.mmd')
	writeFileSync(flow, 'flowchart LR\n  signup[Sign up] --> verify[Verify email] --> profile[Set up profile] --> dash[Dashboard]\n')

	browser = await chromium.launch()
	const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir: work, size: { width: W, height: H } } })
	await context.addInitScript(() => localStorage.setItem('toucan.name', 'Sam'))
	const page = await context.newPage()
	const born = Date.now()
	const at = (label) => (marks[label] = (Date.now() - born) / 1000)
	await page.goto(`http://127.0.0.1:${port}/?canvas=${name}#token=${token}`)
	await page.waitForFunction(() => window.toucan, null, { timeout: 30000 })
	await page.addStyleTag({ content: '.tlui-style-panel__wrapper { display: none !important }' }) // the colour picker isn't what this shows
	await toucan('--canvas', name, 'import', flow)
	await sleep(1500)
	await page.evaluate(() => window.toucan.zoomTo())
	await sleep(4000) // the import's glow fades
	at('ready')

	// Watch the chat as the panel does.
	const events = []
	const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/chat?canvas=${name}&token=${token}`)
	await new Promise((r, j) => (ws.once('open', r), ws.once('error', j)))
	ws.on('message', (m) => events.push({ t: (Date.now() - born) / 1000, ...JSON.parse(m) }))
	const until = async (what, test, ms = 240000) => {
		for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (test()) return
		throw new Error(`timed out waiting for ${what}`)
	}

	// The person asks.
	const input = page.locator('textarea').last()
	await input.click()
	await input.pressSequentially('Add a forgot-password path from Sign up, and colour the happy path green.', { delay: 28 })
	at('asked')
	await input.press('Enter')
	await until('the turn to start', () => events.some((e) => e.type === 'turn' && e.status === 'inProgress'))
	at('working')
	await sleep(2500)

	// …and goes on editing while it works: renames a box by hand.
	const box = await page.evaluate(() => {
		const ed = window.editor
		const b = ed.getShapePageBounds(window.toucan.idFor('verify'))
		const p = ed.pageToScreen({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
		return { x: p.x, y: p.y }
	})
	at('edit')
	await page.mouse.move(box.x - 120, box.y + 90)
	await page.mouse.move(box.x, box.y, { steps: 12 })
	await page.mouse.dblclick(box.x, box.y)
	await sleep(300)
	await page.keyboard.press('ControlOrMeta+a')
	await page.keyboard.type('Confirm your email', { delay: 45 })
	await page.keyboard.press('Escape')
	await page.mouse.click(W / 2 - 200, H - 90) // off the box
	at('edited')

	await until('the agent to be told', () => events.some((e) => e.type === 'noticed'))
	at('noticed')
	await until('the turn to end', () => events.some((e) => e.type === 'turn' && e.status && e.status !== 'inProgress'))
	at('done')
	await sleep(4500)
	at('end')
	const noticed = events.find((e) => e.type === 'noticed')
	const reply = events.filter((e) => e.type === 'item' && e.item?.type === 'agentMessage').map((e) => e.item.text).at(-1)
	const verify = await page.evaluate(() => window.toucan.get?.('verify')?.text ?? null)
	ws.close()
	const video = page.video()
	await context.close()
	const raw = await video.path()
	writeFileSync(join(SOCIAL, 'take.json'), JSON.stringify({ marks, noticed: noticed?.text, reply, verify }, null, 2))
	console.log(JSON.stringify({ marks, noticed: noticed?.text, reply, verify }, null, 2))
	await cut(raw)
} catch (e) {
	console.error(log.slice(-3000))
	throw e
} finally {
	await browser?.close()
	server.kill()
	rmSync(home, { recursive: true, force: true })
	rmSync(data, { recursive: true, force: true })
}

/**
 * The take as it happened, with the waits sped up and a caption over each part: the ask, the edit, the agent being told,
 * and what it did with it.
 */
async function cut(raw) {
	const m = marks
	const parts = [
		{ from: m.ready - 0.5, to: m.asked + 0.6, speed: 1.6, caption: 'Ask the agent for a change' },
		{ from: m.asked + 0.6, to: m.edit, speed: 2, caption: 'It gets to work' },
		{ from: m.edit, to: m.edited + 0.8, speed: 1.3, caption: 'Keep editing while it works' },
		{ from: m.edited + 0.8, to: Math.max(m.edited + 1, m.noticed - 1), speed: 4, caption: 'Keep editing while it works' },
		{ from: Math.max(m.edited + 1, m.noticed - 1), to: m.noticed + 2.5, speed: 1, caption: 'It notices your edit between steps' },
		{ from: m.noticed + 2.5, to: m.done, speed: 5, caption: 'and builds on it' },
		{ from: m.done, to: m.end, speed: 1, caption: 'and builds on it' },
	].filter((p) => p.to - p.from > 0.2)
	const font = (await run('fc-match', ['-f', '%{file}', 'sans:bold']).catch(() => ({ stdout: '' }))).stdout.trim()
	let t = 0
	const chains = [], labels = []
	parts.forEach((p, i) => {
		const len = (p.to - p.from) / p.speed
		chains.push(`[0:v]trim=start=${p.from.toFixed(2)}:end=${p.to.toFixed(2)},setpts=(PTS-STARTPTS)/${p.speed}[p${i}]`)
		labels.push({ text: p.caption, from: t, to: t + len })
		t += len
	})
	// One caption per run of parts that share it.
	const captions = []
	for (const l of labels) {
		const last = captions.at(-1)
		if (last?.text === l.text) last.to = l.to
		else captions.push({ ...l })
	}
	const esc = (s) => s.replace(/:/g, '\\:').replace(/'/g, "\u2019")
	const draw = captions.map((c) => `drawtext=${font ? `fontfile=${font}:` : ''}text='${esc(c.text)}':fontsize=34:fontcolor=white:box=1:boxcolor=0x111827@0.82:boxborderw=18:x=(w-text_w)/2:y=h-text_h-44:enable='between(t,${c.from.toFixed(2)},${c.to.toFixed(2)})'`).join(',')
	const graph = `${chains.join(';')};${parts.map((_, i) => `[p${i}]`).join('')}concat=n=${parts.length}:v=1:a=0[cat];[cat]${draw}[out]`
	const mp4 = join(SOCIAL, 'agents-notice.mp4')
	await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-filter_complex', graph, '-map', '[out]', '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', mp4], { maxBuffer: 64 << 20 })
	const gif = join(SITE, 'agents-notice.gif')
	await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-filter_complex', 'fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', gif])
	// A poster frame for posts that want a still.
	await run('ffmpeg', ['-y', '-loglevel', 'error', '-sseof', '-1.5', '-i', mp4, '-frames:v', '1', join(SOCIAL, 'agents-notice.jpg')])
	console.log(`wrote ${gif} (${(readFileSync(gif).length / 1e6).toFixed(1)} MB, ${t.toFixed(1)} s) and ${mp4}`)
	for (const f of readdirSync(work)) if (f.endsWith('.webm')) rmSync(join(work, f))
}
