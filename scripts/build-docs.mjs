// Builds the docs site's examples from a running toucan, so what the site shows is what toucan does. Nothing is mocked: pictures
// come from real canvases on a throwaway server, and the scenes marked `agent` are real turns of the chat agent, which need a Codex
// sign-in and spend usage. What each scene found is kept in website/work/tour.json, so one scene can be redone alone.
//
//   npm run build && node scripts/build-docs.mjs [--only a,b] [--no-agents] [--list]
//
// Writes website/site/assets/{tour,explore}/ and website/content/{tour,gallery}.md. Then `artoo build website`.
import { execFile, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir, platform, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { GROUPS as TEMPLATE_GROUPS, STARTERS, TEMPLATES } from '../templates/index.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null
const noAgents = args.includes('--no-agents')
const SITE = join(ROOT, 'website/site/assets'), TOUR = join(SITE, 'tour'), EXPLORE = join(SITE, 'explore'), GALLERY = join(SITE, 'gallery')
for (const d of [TOUR, EXPLORE, GALLERY]) mkdirSync(d, { recursive: true })
const FACTS = join(ROOT, 'website/work/tour.json')
const facts = existsSync(FACTS) ? JSON.parse(readFileSync(FACTS, 'utf8')) : {}

const { chromium } = await import('playwright-core')
const home = mkdtempSync(join(tmpdir(), 'toucan-docs-home-')), data = mkdtempSync(join(tmpdir(), 'toucan-docs-data-'))
const port = await new Promise((r) => {
	const s = createServer().listen(0, '127.0.0.1', () => (r(s.address().port), s.close()))
})
const env = { ...process.env, HOME: home, CODEX_HOME: process.env.CODEX_HOME ?? join(homedir(), '.codex'), PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), platform() === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright') }
// Never the real server: the CLI must find this throwaway one.
delete env.TOUCAN_URL
delete env.TOUCAN_CANVAS
const server = spawn(process.execPath, [join(ROOT, 'server/index.mjs'), '--port', String(port), '--data', data], { cwd: ROOT, env, stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 1200))
const run = promisify(execFile)
const cli = async (...a) => (await run(process.execPath, [join(ROOT, 'bin/toucan.mjs'), ...a], { env, cwd: ROOT, maxBuffer: 64 << 20 })).stdout
const token = JSON.parse(readFileSync(join(home, '.config/toucan/server.json'), 'utf8')).token
const browser = await chromium.launch({ env })
const page = await browser.newPage({ viewport: { width: 1400, height: 860 }, deviceScaleFactor: 1.5 })
await page.goto(`http://127.0.0.1:${port}/#token=${token}`)
await page.waitForTimeout(400)

const tmp = (name, text) => {
	const p = join(home, name)
	writeFileSync(p, text)
	return p
}
const sleep = (ms) => page.waitForTimeout(ms)
async function open(canvas) {
	await page.goto(`http://127.0.0.1:${port}/?canvas=${canvas}`)
	await page.waitForFunction(() => window.editor && window.toucan, null, { timeout: 30000 })
	await sleep(900)
	await tidyView()
}
// The canvas is the subject, so the chat stays shut until a scene uses it, and tldraw's style panel stays out of the way.
async function tidyView({ keepChat = false } = {}) {
	await page.addStyleTag({ content: '.tlui-style-panel__wrapper, .tlui-layout__top__right > *:not(.toucan-ui) { visibility: hidden !important }' }).catch(() => {})
	if (keepChat) return
	const hide = page.getByRole('button', { name: 'Hide chat' })
	if (await hide.isVisible().catch(() => false)) await hide.click()
	await sleep(250)
}
const opened = (canvas) => open(canvas).then(() => page.waitForFunction(() => window.editor.getCurrentPageShapes().length > 0, null, { timeout: 20000 })).then(() => sleep(700))
const fit = async () => {
	await page.evaluate(() => {
		const e = window.editor
		e.selectNone()
		e.zoomToFit({ animation: { duration: 0 } })
		// A small diagram shouldn't be blown up to fill the page.
		if (e.getZoomLevel() > 1) {
			e.setCamera({ ...e.getCamera(), z: 1 }, { immediate: true })
			e.centerOnPoint(e.getCurrentPageBounds().center, { animation: { duration: 0 } })
		}
	})
	await sleep(400)
}
// The violet glow on an agent's edits is short, and shows nothing in a still.
const shot = async (name) => {
	await page.waitForFunction(() => !document.querySelector('.toucan-pulse, .toucan-pulse-tag'), null, { timeout: 8000 }).catch(() => {})
	await page.screenshot({ path: join(TOUR, `${name}.png`) })
}
const measure = () => page.evaluate(() => {
	const { score, findings } = window.toucan.measure()
	return { score, findings: [...new Set(findings.map((f) => f.kind))] }
})
const draw = (canvas, spec, ...more) => cli('--canvas', canvas, 'draw', tmp(`${canvas}.json`, JSON.stringify(spec)), ...more)

/** One real turn of the chat agent, typed into the chat panel as a person would. */
async function ask(text, { timeout = 240000 } = {}) {
	const message = page.getByLabel('Message')
	if (!(await message.isVisible().catch(() => false))) await page.getByRole('button', { name: 'Show chat' }).click()
	await sleep(300)
	await message.fill(text)
	await message.press('Enter')
	await page.getByRole('button', { name: 'Stop' }).first().waitFor({ timeout: 30000 }).catch(() => {})
	await page.getByRole('button', { name: 'Stop' }).first().waitFor({ state: 'detached', timeout })
	await sleep(1200)
}

// A system big enough for zooming out to mean something.
const SHOP = {
	kind: 'flow', direction: 'RIGHT', gap: 40, layerGap: 110,
	groups: [{ id: 'clients', label: 'Clients' }, { id: 'edge', label: 'Edge' }, { id: 'buying', label: 'Buying' }, { id: 'running', label: 'Running the shop' }, { id: 'data', label: 'Data' }],
	nodes: [
		{ id: 'web', group: 'clients', text: 'Web shop', color: 'blue', detail: 'The storefront. Server-rendered pages, so product pages load fast and can be indexed.' },
		{ id: 'app', group: 'clients', text: 'Mobile app', color: 'blue', detail: 'Uses the same API as the web shop, and adds push notifications for delivery.' },
		{ id: 'staff', group: 'clients', text: 'Staff console', color: 'blue', detail: 'Where the warehouse and support teams work. Signed in through the company directory.' },
		{ id: 'cdn', group: 'edge', text: 'CDN', color: 'violet', detail: 'Serves images and static files, and absorbs traffic spikes during sales.' },
		{ id: 'gateway', group: 'edge', text: 'API gateway', color: 'violet', detail: 'One way in for every client. Handles sign-in tokens and rate limits.' },
		{ id: 'catalog', group: 'buying', text: 'Catalog', color: 'green', detail: 'Products, prices and search. Read far more than it is written, so it leans on the cache.' },
		{ id: 'cart', group: 'buying', text: 'Cart', color: 'green', detail: 'Lives in the cache for guests, and is saved to the account after sign-in.' },
		{ id: 'checkout', group: 'buying', text: 'Checkout', color: 'green', detail: 'Reserves stock, takes payment, then creates the order. Each step can be undone if a later one fails.' },
		{ id: 'payments', group: 'buying', text: 'Payments', color: 'green', detail: 'Talks to the card processor. Stores tokens, never card numbers.' },
		{ id: 'orders', group: 'running', text: 'Orders', color: 'orange', detail: 'The record of what was bought. Publishes an event each time an order changes state.' },
		{ id: 'stock', group: 'running', text: 'Inventory', color: 'orange', detail: 'What is on the shelf and what is reserved. Checkout asks it before taking payment.' },
		{ id: 'fulfil', group: 'running', text: 'Fulfilment', color: 'orange', detail: 'Turns paid orders into pick lists, and books the courier.' },
		{ id: 'notify', group: 'running', text: 'Notifications', color: 'orange', detail: 'Sends email and push messages when an order event arrives.' },
		{ id: 'db', group: 'data', text: 'Postgres', color: 'grey', detail: 'The system of record for accounts, orders and stock.' },
		{ id: 'cache', group: 'data', text: 'Redis', color: 'grey', detail: 'Carts, sessions and hot catalog reads.' },
		{ id: 'queue', group: 'running', text: 'Event queue', color: 'orange', detail: 'Carries order events, so fulfilment and notifications can fall behind without holding up checkout.' },
		{ id: 'search', group: 'data', text: 'Search index', color: 'grey', detail: 'Rebuilt from the catalog. Can be thrown away and made again.' },
	],
	edges: [
		{ from: 'web', to: 'cdn' }, { from: 'web', to: 'gateway' }, { from: 'app', to: 'gateway' }, { from: 'staff', to: 'gateway' },
		{ from: 'gateway', to: 'catalog' }, { from: 'gateway', to: 'cart' }, { from: 'gateway', to: 'checkout' }, { from: 'gateway', to: 'orders' },
		{ from: 'checkout', to: 'payments' }, { from: 'checkout', to: 'stock' }, { from: 'checkout', to: 'orders' },
		{ from: 'catalog', to: 'search' }, { from: 'catalog', to: 'cache' }, { from: 'cart', to: 'cache' },
		{ from: 'orders', to: 'db' }, { from: 'orders', to: 'queue' }, { from: 'stock', to: 'db' },
		{ from: 'queue', to: 'fulfil' }, { from: 'queue', to: 'notify' },
	],
}

const CHECKOUT = {
	kind: 'flow', direction: 'RIGHT', title: 'Checkout',
	nodes: [
		{ id: 'cart', text: 'Review cart', shape: 'oval', color: 'green' },
		{ id: 'address', text: 'Enter address' },
		{ id: 'pay', text: 'Take payment' },
		{ id: 'ok', text: 'Approved?', shape: 'diamond', color: 'orange' },
		{ id: 'confirm', text: 'Confirm order', color: 'blue' },
		{ id: 'retry', text: 'Show the error' },
		{ id: 'done', text: 'Ship it', shape: 'oval', color: 'green' },
	],
	edges: [{ from: 'cart', to: 'address' }, { from: 'address', to: 'pay' }, { from: 'pay', to: 'ok' }, { from: 'ok', to: 'confirm', label: 'yes' }, { from: 'ok', to: 'retry', label: 'no' }, { from: 'retry', to: 'pay' }, { from: 'confirm', to: 'done' }],
}
const MERMAID = `flowchart LR
  idea[Idea] --> draft[Draft]
  draft --> review{Reviewed?}
  review -->|yes| publish[Publish]
  review -->|no| draft
`
// The same knocking-about as the diagram eval: boxes nudged and resized, two dropped on their neighbours.
const MESS = () => {
	const e = window.editor
	let seed = 7
	const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
	const jitter = (n) => (rnd() - 0.5) * 2 * n
	const boxes = e.getCurrentPageShapes().filter((s) => s.type === 'geo' && s.props.w >= 30 && s.props.h >= 30)
	e.updateShapes(boxes.map((s) => ({ id: s.id, type: s.type, x: s.x + jitter(26), y: s.y + jitter(26), props: { w: s.props.w * (0.95 + rnd() * 0.15) } })))
	const [a, b, c, d] = boxes.filter((s, i) => i % 2 === 0)
	if (a && b) e.updateShape({ id: b.id, type: b.type, x: e.getShape(a.id).x + 30, y: e.getShape(a.id).y + 20, parentId: a.parentId })
	if (c && d && c.parentId === d.parentId) e.updateShape({ id: d.id, type: d.type, x: e.getShape(c.id).x + 40, y: e.getShape(c.id).y + 10 })
}

// ---- the scenes ------------------------------------------------------------------------------------------------------------
const SCENES = {
	// Static copies of real canvases, for the Explore page: tldraw's own SVG, and what its details card would show.
	async explore() {
		const maps = [
			{ id: 'odyssey', file: 'examples/odyssey.tg.json', format: 'story', walk: 'edges', title: 'The Odyssey', blurb: 'A story map. One path through the poem, in Samuel Butler\'s public-domain translation.' },
			{ id: 'meditations', file: 'examples/meditations.tg.json', format: 'ideas', walk: 'lanes', title: 'Meditations', blurb: 'A map of ideas. Marcus Aurelius\'s notes by theme, in George Long\'s public-domain translation.' },
			{ id: 'shop', spec: SHOP, format: 'system', walk: 'edges', title: 'An online shop', blurb: 'A system diagram. Named parts, what each one does, and the real connections between them.' },
		]
		for (const m of maps) {
			const canvas = `x-${m.id}`
			if (m.spec) {
				await cli('new', canvas, '--title', m.title, '--canvas-format', m.format)
				await open(canvas)
				await draw(canvas, m.spec)
				await sleep(900)
				await cli('--canvas', canvas, 'routine', 'run', 'clean-up')
				await sleep(900)
			} else {
				await cli('new', canvas, '--from', m.file, '--canvas-format', m.format)
				await opened(canvas)
			}
			await sleep(800)
			const out = await page.evaluate(async ({ walk }) => {
				const e = window.editor, t = window.toucan
				const shapes = e.getCurrentPageShapes()
				const { svg } = await e.getSvgString(shapes, { background: false, padding: 40 })
				const boxes = shapes.filter((s) => s.type === 'geo' && e.getShapePageBounds(s).w >= 30)
				const nodes = boxes.map((s) => {
					const key = t.keyOf(s), b = e.getShapePageBounds(s), steps = t.neighbours(key, walk)
					const pick = (list) => list.map((x) => ({ key: x.key, text: x.text }))
					return { key, text: t.text(s), x: b.x, y: b.y, w: b.w, h: b.h, detail: t.detailOf(key), see: t.seeAlsoOf(key), next: pick(steps.next), prev: pick(steps.prev) }
				})
				const frames = shapes.filter((s) => s.type === 'frame').map((s) => {
					const b = e.getShapePageBounds(s)
					return { name: s.props.name, x: b.x, y: b.y, w: b.w, h: b.h }
				})
				return { svg, nodes, frames }
			}, { walk: m.walk })
			const { file, spec, ...about } = m
			// A script, not JSON, so the page works opened straight from disk too.
			writeFileSync(join(EXPLORE, `${m.id}.js`), `(window.TOUCAN_MAPS ??= {})[${JSON.stringify(m.id)}] = ${JSON.stringify({ ...about, ...out })}\n`)
			console.log(`  ${m.id}: ${out.nodes.length} boxes, ${Math.round(out.svg.length / 1024)} KB of SVG`)
		}
	},

	async draw() {
		const c = 'd-draw'
		await cli('new', c, '--title', 'Checkout')
		await open(c)
		await draw(c, CHECKOUT)
		await sleep(900)
		await fit()
		await shot('draw')
		facts.draw = { ...(await measure()), spec: CHECKOUT }
	},

	async mermaid() {
		const c = 'd-mermaid'
		await cli('new', c, '--title', 'Publishing')
		await open(c)
		await cli('--canvas', c, 'import', tmp('m.mmd', MERMAID))
		await sleep(900)
		await fit()
		await shot('mermaid')
		facts.mermaid = { ...(await measure()), source: MERMAID, jsoncanvas: JSON.parse(await cli('--canvas', c, 'graph', '--format', 'jsoncanvas')).nodes.length, dot: (await cli('--canvas', c, 'graph', '--format', 'dot')).trim() }
	},

	async engines() {
		await cli('new', 'd-tl', '--template', 'architecture')
		await opened('d-tl')
		await fit()
		await shot('engine-tldraw')
		await sleep(1500)
		await cli('new', 'd-ex', '--engine', 'excalidraw', '--from', 'd-tl')
		await page.goto(`http://127.0.0.1:${port}/?canvas=d-ex`)
		await page.waitForFunction(() => window.toucan?.engine === 'excalidraw', null, { timeout: 30000 })
		await sleep(2500)
		await page.evaluate(() => window.toucan.zoomTo())
		await sleep(600)
		await shot('engine-excalidraw')
	},

	async cleanup() {
		const c = 'd-clean'
		await cli('new', c, '--template', 'services')
		await opened(c)
		await fit()
		const clean = await measure()
		await page.evaluate(MESS)
		await sleep(600)
		await fit()
		const before = await measure()
		await shot('cleanup-before')
		await page.getByRole('button', { name: 'Routines' }).click()
		await sleep(500)
		await shot('routines-menu')
		await page.keyboard.press('Escape')
		await cli('--canvas', c, 'routine', 'run', 'clean-up')
		await sleep(900)
		await fit()
		const after = await measure()
		await shot('cleanup-after')
		const check = JSON.parse(await cli('--canvas', c, 'routine', 'run', 'check-diagram'))
		facts.cleanup = { clean: clean.score, before, after, check: check.result?.summary ?? check.summary }
	},

	async details() {
		const c = 'd-story'
		await cli('new', c, '--from', 'examples/odyssey.tg.json', '--canvas-format', 'story')
		await opened(c)
		await fit()
		await shot('story-whole')
		const key = await page.evaluate(() => {
			const t = window.toucan, e = window.editor
			const s = e.getCurrentPageShapes().find((x) => x.type === 'geo' && t.detailOf(t.keyOf(x)) && t.neighbours(t.keyOf(x), 'edges').next.length && t.neighbours(t.keyOf(x), 'edges').prev.length)
			e.select(s.id)
			e.zoomToSelection({ animation: { duration: 0 } })
			e.setCamera({ ...e.getCamera(), z: 0.75 }, { immediate: true })
			e.centerOnPoint(e.getShapePageBounds(s).center, { animation: { duration: 0 } })
			return t.keyOf(s)
		})
		await sleep(800)
		await shot('story-card')
		await page.keyboard.press('ArrowRight')
		await sleep(1000)
		await shot('story-walk')
		facts.details = { key }
	},

	async system() {
		const c = 'd-system'
		await cli('new', c, '--title', 'An online shop', '--canvas-format', 'system')
		await open(c)
		await draw(c, SHOP)
		await sleep(900)
		await cli('--canvas', c, 'routine', 'run', 'clean-up')
		await sleep(900)
		await fit()
		await shot('system-close')
		facts.system = await measure()
		await page.evaluate(() => {
			const e = window.editor, b = e.getCurrentPageBounds()
			e.setCamera({ ...e.getCamera(), z: 0.34 }, { immediate: true })
			e.centerOnPoint(b.center, { animation: { duration: 0 } })
		})
		await sleep(1000)
		await shot('system-overview')
	},

	async airout() {
		const c = 'd-air'
		await cli('new', c, '--title', 'Sign-in')
		await open(c)
		const words = (t) => `${t}. The browser sends the address and password to the app server, which looks the account up and compares a hash of the password with the one on file.`
		await draw(c, {
			kind: 'flow', direction: 'RIGHT',
			nodes: [{ id: 'a', text: words('Sign-in form') }, { id: 'b', text: words('App server') }, { id: 'c', text: words('Account store') }, { id: 'd', text: words('Session') }],
			edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }],
		})
		await sleep(900)
		await fit()
		await shot('airout-before')
		await cli('--canvas', c, 'routine', 'run', 'air-out')
		await sleep(1000)
		await fit()
		await shot('airout-after')
	},

	async history() {
		const c = 'd-history'
		await cli('new', c, '--title', 'Checkout')
		await open(c)
		await draw(c, CHECKOUT)
		await sleep(900)
		await fit()
		await cli('--canvas', c, 'versions', 'save', 'First sketch')
		await cli('--canvas', c, 'import', tmp('h.mmd', 'flowchart LR\n  confirm --> receipt[Send a receipt]\n  receipt --> done\n'), '--label', 'add a receipt')
		await sleep(600)
		await fit()
		await cli('--canvas', c, 'versions', 'save', 'With a receipt')
		await page.getByRole('button', { name: /history/i }).first().click()
		await sleep(700)
		await page.getByRole('button', { name: /First sketch/ }).first().click()
		await sleep(1200)
		await shot('history')
	},

	// ---- real agent turns ---------------------------------------------------------------------------------------------------
	async chat() {
		const c = 'd-chat'
		await cli('new', c, '--title', 'Password reset')
		await open(c)
		const request = 'A sequence diagram of a user resetting their password by email.'
		await ask(request)
		await sleep(3000)
		await shot('chat')
		facts.chat = { request, ...(await measure()) }
	},

	async notes() {
		const c = 'd-notes'
		await cli('new', c, '--title', 'Checkout')
		await open(c)
		await draw(c, CHECKOUT)
		await sleep(900)
		await cli('--canvas', c, 'exec', '-e', `const b = editor.getShapePageBounds(toucan.get('pay')); editor.createShape({ type: 'note', parentId: editor.getCurrentPageId(), x: b.x - 20, y: b.y - 240, props: { richText: tl.toRichText('missing: what if an item went out of stock?'), size: 's' } }); return 1`, '--label', 'a person leaves a note')
		await sleep(500)
		await fit()
		await shot('notes-before')
		await ask('Please handle the notes.')
		await tidyView()
		await sleep(600)
		await fit()
		await shot('notes-after')
		facts.notes = JSON.parse(await cli('--canvas', c, 'notes', '--all')).map((n) => ({ text: n.text, reply: n.reply, resolved: n.resolved }))
	},

	async proposal() {
		const c = 'd-propose'
		await cli('new', c, '--title', 'Checkout')
		await open(c)
		await draw(c, CHECKOUT)
		await sleep(900)
		const request = 'What is missing from this flow? Answer on the canvas as a proposal.'
		await ask(request)
		await tidyView()
		await sleep(600)
		await fit()
		await shot('proposal')
		facts.proposal = { request, open: JSON.parse(await cli('--canvas', c, 'proposals')).length }
	},

	async thread() {
		const c = 'd-thread'
		await cli('new', c, '--title', 'Checkout')
		await open(c)
		await draw(c, CHECKOUT)
		await sleep(900)
		await fit()
		const comment = 'Should we retry the card automatically before showing an error?'
		await cli('--canvas', c, 'threads', 'new', comment, '--on', 'retry', '--as', 'Alex', '--ask')
		let thread
		for (let i = 0; i < 80; i++) {
			await sleep(3000)
			thread = JSON.parse(await cli('--canvas', c, 'threads', 'show', '1'))
			if ((thread.messages?.length ?? 0) >= 2) break
		}
		await sleep(1500)
		await page.getByRole('button', { name: /^Thread 1/ }).first().click()
		await sleep(900)
		await shot('thread')
		facts.thread = { comment, messages: thread.messages?.length }
	},
}

const AGENT_SCENES = new Set(['chat', 'notes', 'proposal', 'thread'])

// ---- the pages ---------------------------------------------------------------------------------------------------------------
function agentRequests() {
	const file = join(ROOT, 'evals/out/agent.json')
	if (!existsSync(file)) return null
	const all = JSON.parse(readFileSync(file, 'utf8'))
	const pick = ['web-stack', 'org', 'moving', 'ticket'].map((id) => all.find((r) => r.id === id)).filter(Boolean)
	for (const r of pick) copyFileSync(join(ROOT, 'evals/out', `ask-${r.id}.png`), join(TOUR, `ask-${r.id}.png`))
	return { pick, count: all.length, mean: Math.round(all.reduce((s, r) => s + r.score, 0) / all.length), seconds: Math.round(all.reduce((s, r) => s + r.seconds, 0) / all.length) }
}

// One box or arrow to a line, which is how a person would write it. Colours are left out to fit the column.
function specText(spec) {
	if (!spec) return ''
	const list = (items) => items.map((i) => {
		const { color, ...rest } = i
		return `    ${JSON.stringify(rest)}`
	}).join(',\n')
	return `{\n  "kind": "${spec.kind}",\n  "direction": "${spec.direction}",\n  "nodes": [\n${list(spec.nodes)}\n  ],\n  "edges": [\n${list(spec.edges)}\n  ]\n}`
}

function writeTour() {
	const asked = agentRequests() ?? facts.asked
	if (asked) facts.asked = asked
	// A straight quote would end the Markdown title early, and the image would come out as text.
	const curly = (t) => t.replace(/"([^"]*)"/g, '“$1”').replace(/"/g, '”')
	const pic = (name, alt, caption) => `![${alt}](assets/tour/${name}.png${caption ? ` "${curly(caption)}"` : ''})`
	const f = facts
	const spec = f.draw?.spec && { ...f.draw.spec, nodes: f.draw.spec.nodes.slice(0, 4), edges: f.draw.spec.edges.slice(0, 3) }
	const lines = [
		'# See it work',
		'',
		'Every picture here is a screenshot of toucan running, made by a script against a real server. Where it says an agent did something, that is a real turn of the chat agent on Codex, unedited. There is no public server to try, because toucan is built for your own machine or a trusted network, but the [Explore](explore.html) page lets you click through some of these canvases.',
		'',
		'## Ask, and it draws',
		'',
		`The chat panel sits beside the canvas. Asked for "${f.chat?.request}", the agent drew this and checked its own work.`,
		'',
		pic('chat', 'The canvas with the chat panel open. The agent has drawn a sequence diagram of a password reset, with four participants and a column of messages between them.', `Measured at ${f.chat?.score} of 100 by the same check the agent runs.`),
		'',
		asked && `Agents don't place boxes by hand. They describe the diagram and a layout engine places it, which is why this takes seconds. Here are four more requests, from the set toucan is tested against: across ${asked.count} requests the average score is ${asked.mean} of 100, in about ${asked.seconds} seconds each.`,
		'',
		...(asked?.pick ?? []).flatMap((r) => [`**"${r.ask}"**`, '', pic(`ask-${r.id}`, `What the agent drew for: ${r.ask}`, `Scored ${r.score} of 100, in ${r.seconds} seconds.`), '']),
		'## Describe it as data',
		'',
		'Any agent, or any script of yours, can do the same from a terminal. A diagram is a small description, in the same form as the [templates](gallery.html), and `toucan draw` places it. This one is shortened; the full version has seven boxes.',
		'',
		'```json',
		specText(spec),
		'```',
		'',
		'```sh',
		'toucan --canvas checkout draw checkout.json',
		'```',
		'',
		pic('draw', 'A left-to-right checkout flow: review cart, enter address, take payment, a decision on whether it was approved, then confirm order and ship, or show the error and go back to payment.'),
		'',
		'A second drawing lands beside the first and never over it. `--update` changes an earlier one.',
		'',
		'## Or as Mermaid',
		'',
		'Mermaid works as an edit language too. On a blank canvas it comes out looking like a template, and it merges by key on a full one, so importing it again changes only what differs.',
		'',
		'```',
		(f.mermaid?.source ?? '').trim(),
		'```',
		'',
		pic('mermaid', 'The Mermaid flowchart as boxes on a canvas: idea, draft, a reviewed decision, publish, with a loop back to draft.'),
		'',
		'What goes in comes back out. The same canvas as DOT:',
		'',
		'```',
		f.mermaid?.dot ?? '',
		'```',
		'',
		'It also exports JSON Canvas (for Obsidian), `.excalidraw` and toucan\'s own graph format.',
		'',
		'## Tldraw or Excalidraw',
		'',
		'A canvas runs on either engine, and converts between them with its keys, text, frames and arrows intact. Some styling is approximated: Excalidraw draws these arrows straight, for one.',
		'',
		pic('engine-tldraw', 'A layered architecture diagram on tldraw, with clients, edge, services and data in four frames.', 'On tldraw.'),
		'',
		pic('engine-excalidraw', 'The same architecture diagram on Excalidraw, with the same boxes and frames in Excalidraw\'s style.', 'The same canvas, converted to Excalidraw.'),
		'',
		'## Tidy it up',
		'',
		`Diagrams get knocked about. **Routines** are chores banked once and run from a menu or the CLI, each one undoable in a single step, and they keep your arrangement rather than starting over. Here a service map scored ${f.cleanup?.clean} when clean and ${f.cleanup?.before?.score} after being knocked about.`,
		'',
		pic('cleanup-before', 'A service map with boxes out of line, different sizes, and two dropped on top of their neighbours.', `Before: ${f.cleanup?.before?.score} of 100.`),
		'',
		pic('cleanup-after', 'The same service map with the boxes lined up, matching in size and clear of each other.', `After Clean up: ${f.cleanup?.after?.score} of 100.`),
		'',
		pic('routines-menu', 'The Routines menu open over a canvas, listing Clean up, Lay it out again, Check this diagram and other chores, each with a description.', 'The routines menu. Ask an agent to bank a new one and it appears here.'),
		'',
		'**Check this diagram** scores what\'s drawn and names the shapes at fault, so an agent can fix what it finds instead of squinting at a screenshot.',
		'',
		'## Short boxes, with the rest a click away',
		'',
		'A box holds a name. What\'s behind it opens in a card when you select it, and on a canvas with a **format**, ← and → walk you through. This is the Odyssey as a story map.',
		'',
		pic('story-whole', 'The Odyssey as a story map: a long path of short titled stops with branches.', 'The whole map.'),
		'',
		pic('story-card', 'One stop selected, with a card beside it holding a quotation from the poem and buttons to walk to the previous and next stops.', 'Select a stop, and the quotation opens beside it.'),
		'',
		pic('story-walk', 'The canvas has moved to the next stop along the path, with its own card open.', 'Press → and the canvas moves along the path.'),
		'',
		'[Try this one yourself](explorer.html?map=odyssey), no install needed.',
		'',
		'## Zoom out on a system',
		'',
		'On a system diagram, zooming out swaps the details for what matters at that height: the frames, how many parts each holds, and how many connections run between them. It only changes what you see; agents and exports still get every shape.',
		'',
		pic('system-close', 'A layered architecture diagram with every box and arrow visible.', 'Up close.'),
		'',
		pic('system-overview', 'The same diagram zoomed out: four labelled frames with part counts, joined by arrows with connection counts.', 'Zoomed out.'),
		'',
		'## Air out a dense diagram',
		'',
		'Long text in boxes makes a canvas hard to read and hard to talk about. The **Air out** routine moves it into the details, makes the names larger, and spreads things a little.',
		'',
		pic('airout-before', 'Four boxes crowded with paragraphs of text, joined by arrows.', 'Before.'),
		'',
		pic('airout-after', 'The same four boxes with short names only.', 'After. The text is one click away, in the card.'),
		'',
		'## Comment, and have it answered',
		'',
		'A comment on a box or a region is a **thread**: a back-and-forth that someone eventually closes. Send a message to the agent and it works that thread on its own, so several can run at once.',
		'',
		pic('thread', 'A thread open on the Show the error box. A person asks whether to retry the card automatically, and the agent answers in the thread.', `Asked: "${f.thread?.comment}" The answer is the agent's, unedited.`),
		'',
		'## Leave a sticky note',
		'',
		'Pin a note where the problem is instead of describing it in chat. Its position is part of the message. Asked to handle the notes, the agent acts on each one, and the note turns green with a one-line reply.',
		'',
		pic('notes-before', 'The checkout flow with a yellow sticky note above the Take payment box: missing, what if an item went out of stock?', 'A note left on the canvas.'),
		'',
		pic('notes-after', 'The flow now has a step for the out-of-stock case, and the note has turned green with the agent\'s reply.', f.notes?.[0]?.reply ? `The agent's reply: "${f.notes[0].reply}"` : undefined),
		'',
		'## Take it or leave it',
		'',
		'Ask for an opinion and the answer arrives as a **proposal**: drawn dashed, with Accept and Reject above the canvas. Nothing is final until you say so.',
		'',
		pic('proposal', 'The checkout flow with new dashed boxes and arrows the agent proposes, and a bar above the canvas with Accept and Reject.', `Asked: "${f.proposal?.request}"`),
		'',
		'## Go back',
		'',
		'Every canvas keeps its history, whoever made the change. Step through versions read-only, with the live canvas still running underneath, and restore one if you want it. A restore can itself be undone.',
		'',
		pic('history', 'The History panel open beside the checkout flow, with a version named First sketch selected and shown read-only.', 'An earlier version, named First sketch, shown over the live canvas.'),
		'',
		'## Where to go next',
		'',
		'- [Explore](explore.html): click through real canvases in your browser.',
		'- [Gallery](gallery.html): every diagram toucan starts from.',
		'- [Quick start](quickstart.html): run it yourself.',
		'- [Agent guide](agents.html): what agents can do, in full.',
		'',
	]
	writeFileSync(join(ROOT, 'website/content/tour.md'), lines.filter((l) => l !== null && l !== undefined && l !== false).join('\n'))
}

// The gallery's sections are the templates' own groups, so a new block lands in the right one without editing this.
const GROUPS = TEMPLATE_GROUPS.map((g) => [g.label, `${g.about}.`, TEMPLATES.filter((t) => t.group === g.id).map((t) => t.id)])
function writeGallery() {
	const seen = new Set()
	const page = [
		'# Gallery',
		'',
		'Every diagram toucan starts from, as it draws them. Each one is ordinary shapes you can change. These same diagrams are the test set for layout, so a change that makes one worse fails the build.',
		'',
		'A canvas *has* diagrams rather than *being* one. Each diagram below is a **block**: start a canvas with one (`toucan new NAME --template ID`, or **Start from** on the index page), or add it beside what is already on a canvas (`toucan --canvas NAME add ID`, or **Add** above the canvas). An agent can read the description behind any of them with `toucan templates show ID`, then draw its own in the same form with `toucan --canvas NAME draw -`. See [See it work](tour.html) for that in action.',
		'',
		'## Starters',
		'',
		'A **starter** is a whole canvas on one subject, made of several blocks laid out under their own headings. Start one the same way: `toucan new NAME --template ID`.',
		'',
		...STARTERS.map((s) => `- **${s.title}** (\`${s.id}\`): ${s.use} It has: ${s.parts.map((p) => p.title).join(', ')}.`),
		'',
	]
	for (const [name, about, ids] of [...GROUPS, ['Others', '', TEMPLATES.map((t) => t.id).filter((id) => !GROUPS.some((g) => g[2].includes(id)))]]) {
		if (!ids.length) continue
		page.push(`## ${name}`, '', ...(about ? [about, ''] : []))
		for (const id of ids) {
			const t = TEMPLATES.find((x) => x.id === id)
			if (!t) throw new Error(`gallery names no such template: ${id}`)
			seen.add(id)
			const png = join(ROOT, 'evals/out', `${id}.png`)
			if (!existsSync(png)) throw new Error(`no picture for ${id}: run scripts/eval-diagrams.mjs first`)
			copyFileSync(png, join(GALLERY, `${id}.png`))
			page.push(`### ${t.title}`, '', t.use, '', `![The ${t.title} template, as drawn](assets/gallery/${id}.png)`, '', `\`toucan new NAME --template ${id}\``, '')
		}
	}
	writeFileSync(join(ROOT, 'website/content/gallery.md'), page.join('\n'))
	console.log(`gallery: ${seen.size} templates`)
}

// ---- run -------------------------------------------------------------------------------------------------------------------
let failed = 0
try {
	for (const [name, scene] of Object.entries(SCENES)) {
		if (only ? !only.includes(name) : noAgents && AGENT_SCENES.has(name)) continue
		console.log(`scene: ${name}`)
		try {
			await scene()
		} catch (e) {
			failed++
			console.log(`  FAILED ${name}: ${e.stderr?.trim() || String(e.message).split('\n')[0]}`)
			await page.screenshot({ path: join(home, 'x.png') }).then(() => copyFileSync(join(home, 'x.png'), join(tmpdir(), `docs-fail-${name}.png`))).catch(() => {})
		}
	}
	writeFileSync(FACTS, JSON.stringify(facts, null, 1) + '\n')
	writeTour()
	writeGallery()
} finally {
	await browser.close()
	server.kill()
	await new Promise((r) => setTimeout(r, 300))
	rmSync(home, { recursive: true, force: true })
	rmSync(data, { recursive: true, force: true })
}
if (failed) {
	console.log(`${failed} scene(s) failed`)
	process.exitCode = 1
}
