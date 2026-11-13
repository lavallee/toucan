// End-to-end check of plans: a canvas bound to the built-in file source, with views that follow the file and write a
// person's edits back to it. A real server, the real CLI, and a browser doing what a person does.
//
//   npm run build && node scripts/plan-e2e.mjs        (npm run test:plan)
//
// Needs playwright-core and its Chromium. Runs against a throwaway HOME, data directory and port, so it never touches
// ~/.config/toucan, real canvases or a server already running. SHOTS=dir keeps screenshots of the views; KEEP=1 the data.

import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir, platform, tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (!existsSync(join(ROOT, 'dist/index.html'))) throw new Error('build the app first: npm run build')
const { chromium } = await import('playwright-core')

const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), platform() === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright')
const home = mkdtempSync(join(tmpdir(), 'toucan-plan-home-'))
const data = mkdtempSync(join(tmpdir(), 'toucan-plan-data-'))
const port = await new Promise((r) => {
	const s = createServer().listen(0, '127.0.0.1', () => (r(s.address().port), s.close()))
})
const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_DATA_HOME: join(home, '.local/share'), XDG_CONFIG_HOME: join(home, '.config'), PLAYWRIGHT_BROWSERS_PATH: browsers, TOUCAN_PORT: String(port), TOUCAN_PLAN_POLL: '700' }
for (const k of ['TOUCAN_URL', 'TOUCAN_CANVAS', 'TOUCAN_DATA', 'TOUCAN_TOKEN', 'TOUCAN_AGENT', 'TOUCAN_HOST', 'TOUCAN_PUBLIC_URL', 'TOUCAN_PUBLIC_HOST']) delete env[k]
// A plan source as a plugin on PATH: the example adapter, as someone would install it.
const bin = join(home, 'bin')
mkdirSync(bin)
copyFileSync(join(ROOT, 'examples/toucan-source-example.mjs'), join(bin, 'toucan-source-example'))
chmodSync(join(bin, 'toucan-source-example'), 0o755)
writeFileSync(join(bin, 'toucan-source-asleep'), '#!/bin/sh\n')
env.PATH = `${bin}${delimiter}${env.PATH}`
env.TOUCAN_SOURCE_EXAMPLE_FILE = join(home, 'example-source.json')
const shots = process.env.SHOTS
if (shots) mkdirSync(shots, { recursive: true })

const server = spawn(process.execPath, [join(ROOT, 'server/index.mjs'), '--port', String(port), '--data', data, '--headless'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let serverLog = ''
server.stdout.on('data', (d) => (serverLog += d))
server.stderr.on('data', (d) => (serverLog += d))
for (let i = 0; i < 50 && !serverLog.includes('listening'); i++) await new Promise((r) => setTimeout(r, 100))

const run = promisify(execFile)
const toucan = async (...args) => (await run(process.execPath, [join(ROOT, 'bin/toucan.mjs'), ...args], { env, maxBuffer: 32 << 20 })).stdout.trim()
const json = async (...args) => JSON.parse(await toucan(...args))
const refused = (...args) => toucan(...args).then(() => assert.fail(`${args.join(' ')} should fail`), (e) => String(e.stderr))
const step = (msg) => console.log(`ok  ${msg}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** Waits for `test()` to hold (it may be async), or fails saying what it was waiting for. */
async function until(what, test, ms = 15000) {
	const t0 = Date.now()
	let last
	for (;;) {
		try {
			last = await test()
			if (last) return last
		} catch (e) {
			last = e.message
		}
		if (Date.now() - t0 > ms) assert.fail(`timed out waiting for ${what} (last: ${JSON.stringify(last)})`)
		await sleep(150)
	}
}

const EXAMPLE = join(ROOT, 'examples/website-relaunch.plan.json')
let human
try {
	for (const engine of ['tldraw', 'excalidraw']) {
		const C = `relaunch-${engine}`
		const t = (...args) => toucan('--canvas', C, ...args)
		const j = (...args) => json('--canvas', C, ...args)
		const planFile = join(data, `${C}.files`, 'website-relaunch.plan.json')
		const upstream = () => JSON.parse(readFileSync(planFile, 'utf8'))
		const item = (id) => upstream().items.find((it) => it.id === id)
		/** Someone changes the plan somewhere else: the file is rewritten, with the item's version moved on. */
		const editUpstream = (id, set) => {
			const plan = upstream()
			const it = plan.items.find((x) => x.id === id)
			Object.assign(it, set, { version: it.version + 1 })
			writeFileSync(planFile, JSON.stringify(plan, null, 2))
		}
		const graph = () => j('exec', '-e', 'return toucan.graph()')
		const nodeOf = async (key) => (await graph()).nodes.find((n) => n.key === key)
		const synced = () => until('the plan to settle', async () => (await j('plan')).state === 'synced')

		// ---- a canvas over a plan, with nobody watching: the server's own page draws it ------------------------------------
		await toucan('new', C, '--engine', engine, '--plan', 'file', EXAMPLE, '--views', 'board,gantt')
		assert.ok(existsSync(planFile), 'the plan was copied into the canvas\'s files')
		let status = await j('plan', 'sync')
		assert.deepEqual([status.source.name, status.source.ref, status.source.title, status.items], ['file', 'files/website-relaunch.plan.json', 'Website relaunch', 25])
		assert.deepEqual(status.views.map((v) => [v.id, v.kind]), [['board', 'board'], ['gantt', 'gantt']])
		let g = await graph()
		const nested = engine === 'tldraw'
		const cols = g.groups.filter((x) => x.key.startsWith('plan:board:col:')).sort((a, b) => a.box.x - b.box.x)
		assert.deepEqual(cols.map((c) => c.label), ['To do (15)', 'In progress (4)', 'In review (2)', 'Done (4)'])
		assert.equal(g.groups.some((x) => x.key === 'plan:board'), nested, 'the view has a frame of its own where frames can hold frames')
		const cards = g.nodes.filter((n) => n.meta?.plan?.view === 'board' && n.meta.plan.item)
		assert.equal(cards.length, 25)
		assert.deepEqual(cards.find((n) => n.key === 'plan:board:sitemap').meta.plan, { item: 'sitemap', view: 'board', version: 1 })
		assert.equal(cards.find((n) => n.key === 'plan:board:sitemap').group, 'plan:board:col:done')
		assert.match(cards.find((n) => n.key === 'plan:board:sitemap').meta.detail, /Top-level sections first[\s\S]*Stage: Done\nOwner: Ada/)
		assert.equal(g.nodes.filter((n) => n.meta?.plan?.view === 'gantt' && n.meta.plan.item).length, 25)
		assert.ok(g.nodes.some((n) => n.key === 'plan:gantt:axis:2026-11-02'))
		step(`${engine}: new --plan file … --views board,gantt drew ${g.nodes.length} boxes in ${g.groups.length} frames with no tab open`)

		// Things of the person's own, beside and on the views: a box, a sticky note (tldraw), an arrow to a card.
		if (engine === 'tldraw') await t('exec', '--label', 'my own things', '-e', `toucan.node('mine', { x: -500, y: 100, text: 'Ask Dana about budget' }); toucan.edge('mine', 'plan:board:audit'); editor.createShape({ id: toucan.idFor('sticky'), type: 'note', x: -500, y: 400, parentId: editor.getCurrentPageId(), props: { richText: tl.toRichText('same thing? merge') }, meta: { key: 'sticky' } }); return 1`)
		else await t('exec', '--label', 'my own things', '-e', `await toucan.applyGraph({ nodes: [{ key: 'mine', text: 'Ask Dana about budget', box: { x: -500, y: 100, w: 220, h: 80 } }], edges: [{ from: 'mine', to: 'plan:board:audit' }] }); return 1`)
		const own = async () => {
			const now = await graph()
			return JSON.stringify([now.nodes.filter((n) => ['mine', 'sticky'].includes(n.key)).map((n) => [n.key, n.text, n.box, n.meta?.plan]), now.edges.filter((e) => e.from === 'mine').map((e) => [e.from, e.to])])
		}
		const mine = await own()
		assert.ok(mine.includes('plan:board:audit'))

		// ---- an agent reshapes the views by writing specs ----------------------------------------------------------------------
		assert.match(await refused('--canvas', C, 'plan', 'view', 'add', 'kanban'), /unknown view kind "kanban"; kinds: board, gantt, timeline, graph, table/)
		assert.match(await refused('--canvas', C, 'plan', 'view', 'set', 'board', '--group-by', 'start'), /groupBy "start" is a date field; groupBy takes an option field: stage, assignee, priority/)
		assert.match(await t('plan', 'catalog'), /board: A kanban board/)
		const table = await j('plan', 'view', 'add', 'table', '--fields', 'stage,assignee', '--filter', 'stage=doing')
		assert.deepEqual(table, { kind: 'table', fields: ['stage', 'assignee'], filter: { field: 'stage', op: 'eq', value: 'doing' }, id: 'table' })
		await synced()
		g = await graph()
		assert.equal(g.nodes.filter((n) => n.meta?.plan?.view === 'table' && n.meta.plan.item && !n.meta.plan.field).length, 4, 'a table of what\'s in progress')
		const boardBox = g.groups.find((x) => x.key === (nested ? 'plan:board' : 'plan:board:col:todo')).box
		await j('plan', 'view', 'set', 'gantt', '--group-by', 'assignee', '--dependencies')
		await synced()
		g = await graph()
		assert.deepEqual(g.groups.filter((x) => x.key.startsWith('plan:gantt:lane:')).sort((a, b) => a.box.y - b.box.y).map((x) => x.label), ['Ada', 'Grace', 'Linus', 'No owner'])
		assert.ok(g.edges.some((e) => e.from === 'plan:gantt:templates' && e.to === 'plan:gantt:migrate-blog'), 'dependency arrows')
		await j('plan', 'view', 'rm', 'table')
		await synced()
		g = await graph()
		assert.equal(g.nodes.filter((n) => n.meta?.plan?.view === 'table').length, 0, 'a removed view takes its shapes with it')
		assert.deepEqual(g.groups.find((x) => x.key === (nested ? 'plan:board' : 'plan:board:col:todo')).box, boardBox, 'and the other views stay where they were')
		await j('plan', 'view', 'set', 'gantt', '--no-dependencies')
		await synced()
		step(`${engine}: plan view add / set / rm reshape the views; a bad spec is refused with what would be right`)

		// ---- an agent changes the work itself, through the same write ------------------------------------------------------------
		const set = await j('plan', 'set', 'analytics', 'stage=In progress', 'assignee=ada')
		assert.deepEqual([set[0].stage, set[0].assignee, set[0].version], ['doing', 'ada', 2])
		assert.deepEqual([item('analytics').stage, item('analytics').version], ['doing', 2])
		assert.match(await refused('--canvas', C, 'plan', 'set', 'analytics', 'stage=shipped'), /stage has no option "shipped"; options: todo \(To do\)/)
		assert.match(await refused('--canvas', C, 'plan', 'set', 'analytics', 'labels=build'), /labels can't be written/)
		const added = await j('plan', 'add', '--title', 'Brief the support team', 'stage=todo', '--after', 'launch')
		assert.equal(upstream().items[upstream().items.findIndex((it) => it.id === 'launch') + 1].id, added[0].id)
		await synced()
		assert.equal((await nodeOf('plan:board:analytics')).group, 'plan:board:col:doing')
		assert.ok(await nodeOf(`plan:board:${added[0].id}`), 'the new item has a card')
		assert.match(await t('plan', 'items'), /analytics v2 {2}Set up analytics {2}stage=doing assignee=ada/)
		step(`${engine}: plan set / plan add write upstream and the views follow`)

		// ---- a person opens the canvas ---------------------------------------------------------------------------------------------
		const token = JSON.parse(readFileSync(join(home, '.config/toucan/server.json'), 'utf8')).token
		human ??= await chromium.launch()
		const context = await human.newContext({ viewport: { width: 1500, height: 950 } })
		await context.addInitScript(() => {
			// What the tests need to edit as a person's tab does, without the app's own modules.
			window.__rich = (text) => ({ type: 'doc', content: String(text).split('\n').map((line) => ({ type: 'paragraph', ...(line && { content: [{ type: 'text', text: line }] }) })) })
			window.__bump = (e, change) => ({ ...e, ...change, version: e.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() })
		})
		const page = await context.newPage()
		page.on('pageerror', (e) => console.error(`page error: ${e.message}`))
		await page.goto(`http://127.0.0.1:${port}/?canvas=${C}#token=${token}`)
		await page.waitForFunction(() => window.toucan?.get('plan:board:sitemap'), null, { timeout: 30000 })
		await synced()
		const measured = await page.evaluate(() => {
			const m = window.toucan.measure()
			const about = (f) => f.on.some((k) => String(k).startsWith('plan:'))
			return { score: m.score, overlaps: m.findings.filter((f) => f.kind === 'overlap' && about(f)), outgrew: m.findings.filter((f) => f.kind === 'text outgrew its box' && about(f)), cut: m.findings.filter((f) => f.kind === 'cut off by its frame' && about(f)) }
		})
		assert.deepEqual([measured.overlaps, measured.outgrew, measured.cut], [[], [], []], 'as drawn: nothing overlapping, no text outgrowing its box, nothing cut off')
		step(`${engine}: with ${cards.length + 1} items on a board and a gantt, measure() finds no overlaps, no outgrown text, nothing cut off (score ${measured.score})`)
		if (shots) {
			await sleep(600)
			const keysOf = (v) => (nested ? `plan:${v}` : g.groups.filter((x) => x.key.startsWith(`plan:${v}:`)).map((x) => x.key).concat(g.nodes.filter((n) => n.meta?.plan?.view === v && !n.group).map((n) => n.key)).join(','))
			await t('screenshot', join(shots, `board-${engine}.png`), '--keys', keysOf('board'), '--max', '2400')
			await t('screenshot', join(shots, `gantt-${engine}.png`), '--keys', keysOf('gantt'), '--max', '2400')
			await page.screenshot({ path: join(shots, `tab-${engine}.png`) })
		}

		// ---- upstream changes, and the canvas follows on its own -----------------------------------------------------------------
		editUpstream('voice', { stage: 'done', title: 'Write the voice and tone guide' })
		await until('the card to follow upstream', async () => {
			const n = await nodeOf('plan:board:voice')
			return n.group === 'plan:board:col:done' && n.text === '✓ Write the voice and tone guide' && n.meta.plan.version === 2
		})
		assert.equal((await nodeOf('plan:gantt:voice')).style.color, 'grey', 'the same item in the other view')
		step(`${engine}: the file changed upstream; board and gantt followed without being asked`)

		// ---- a person's edits, made in their tab as they would make them, are written back ------------------------------------
		const before = item('scaffold')
		if (engine === 'tldraw') {
			await page.evaluate(() => {
				const { editor, toucan } = window
				const card = toucan.get('plan:board:scaffold'), col = toucan.get('plan:board:col:review')
				editor.markHistoryStoppingPoint('drag')
				editor.reparentShapes([card.id], col.id)
				editor.updateShape({ id: card.id, type: 'geo', x: 44, y: 700 })
			})
		} else {
			await page.evaluate(() => {
				const api = window.editor, ex = window.toucan
				const els = api.getSceneElementsIncludingDeleted()
				const card = ex.get('plan:board:scaffold'), col = ex.get('plan:board:col:review')
				const dx = col.x + 44 - card.x, dy = col.y + 700 - card.y
				const move = (e) => window.__bump(e, { x: e.x + dx, y: e.y + dy, frameId: col.id })
				api.updateScene({ elements: els.map((e) => (e.id === card.id || e.containerId === card.id ? move(e) : e)), captureUpdate: 'IMMEDIATELY' })
			})
		}
		await until('the move to reach the file', () => item('scaffold').stage === 'review')
		assert.equal(item('scaffold').version, before.version + 1)
		await synced()
		const snapped = await nodeOf('plan:board:scaffold')
		assert.deepEqual([snapped.group, snapped.meta.plan.version], ['plan:board:col:review', 2])
		const reviewCol = (await graph()).groups.find((x) => x.key === 'plan:board:col:review')
		assert.equal(reviewCol.label, 'In review (2)')
		assert.equal(snapped.box.x, reviewCol.box.x + 30, 'the card snapped into its slot')
		step(`${engine}: a card dragged into another column set stage=review in the file (v${before.version} → v${item('scaffold').version}), then snapped into place`)

		const bar0 = await nodeOf('plan:gantt:templates')
		const dates0 = [item('templates').start, item('templates').end]
		assert.deepEqual(dates0, ['2026-11-30', '2026-12-11'])
		const stretch = (key, dx, dw) =>
			page.evaluate(([key, dx, dw, isTl]) => {
				if (isTl) {
					const s = window.toucan.get(key)
					window.editor.markHistoryStoppingPoint('resize')
					window.editor.updateShape({ id: s.id, type: 'geo', x: s.x + dx, props: { w: s.props.w + dw } })
				} else {
					const api = window.editor, s = window.toucan.get(key)
					api.updateScene({ elements: api.getSceneElementsIncludingDeleted().map((e) => (e.id === s.id ? window.__bump(e, { x: e.x + dx, width: e.width + dw }) : e.containerId === s.id ? window.__bump(e, { x: e.x + dx }) : e)), captureUpdate: 'IMMEDIATELY' })
				}
			}, [key, dx, dw, engine === 'tldraw'])
		await stretch('plan:gantt:templates', 0, 5 * 16)
		await until('the stretch to reach the file', () => item('templates').end === '2026-12-16')
		assert.equal(item('templates').start, '2026-11-30', 'only the end moved')
		await synced()
		await stretch('plan:gantt:templates', -3 * 16, 0)
		await until('the move to reach the file', () => item('templates').start === '2026-11-27')
		assert.equal(item('templates').end, '2026-12-13', 'both dates moved together')
		await synced()
		assert.equal((await nodeOf('plan:gantt:templates')).box.x, bar0.box.x - 3 * 16)
		step(`${engine}: a gantt bar stretched five days, then dragged back three: the file's dates followed, to whole days`)

		// ---- a conflict: upstream moved on while they were typing --------------------------------------------------------------
		if (engine === 'tldraw') {
			await page.evaluate(() => void window.editor.setEditingShape(window.toucan.get('plan:board:cms').id))
			await sleep(400) // the tab says it's busy
			const cursor = (await j('plan')).cursor
			editUpstream('cms', { title: 'Choose the CMS (decided: Kirby)' })
			await until('the server to notice upstream moved', async () => (await j('plan')).cursor !== cursor)
			await sleep(1200)
			assert.equal((await nodeOf('plan:board:cms')).meta.plan.version, 1, 'nothing is redrawn under someone who is typing')
			await page.evaluate(() => {
				const { editor, toucan } = window
				const s = toucan.get('plan:board:cms')
				editor.updateShape({ id: s.id, type: 'geo', props: { richText: window.__rich('✓ Pick the CMS') } })
				editor.setEditingShape(null)
			})
			await until('the conflict to be recorded', async () => (await j('plan')).problems.length === 1)
			status = await j('plan')
			assert.equal(status.problems[0].kind, 'conflict')
			assert.equal(status.problems[0].text, '"Choose the CMS (decided: Kirby)" changed upstream; showing the upstream version.')
			await until('the card to go back to upstream', async () => (await nodeOf('plan:board:cms')).text === '✓ Choose the CMS (decided: Kirby)')
			assert.equal(item('cms').title, 'Choose the CMS (decided: Kirby)', 'upstream kept its own')
			const notice = page.getByRole('alert').filter({ hasText: 'changed upstream; showing the upstream version' })
			await notice.waitFor({ timeout: 5000 })
			if (shots) await page.screenshot({ path: join(shots, `conflict-${engine}.png`) })
			await notice.getByRole('button', { name: 'Dismiss' }).click()
			await until('the problem to be dismissed', async () => (await j('plan')).problems.length === 0)
			step(`${engine}: an edit made on a stale card was refused as a conflict, the card went back to upstream, and the person was told`)

			// A title edited with nothing in the way is written.
			await page.evaluate(() => {
				const s = window.toucan.get('plan:board:redirects')
				window.editor.updateShape({ id: s.id, type: 'geo', props: { richText: window.__rich('Map every redirect') } })
			})
			await until('the title to reach the file', () => item('redirects').title === 'Map every redirect')

			// A box drawn in a column becomes an item, and that box becomes its card.
			const made = await page.evaluate(() => {
				const { editor, toucan } = window
				const col = toucan.get('plan:board:col:doing')
				const id = `shape:drawn${Math.random().toString(36).slice(2, 10)}`
				editor.createShape({ id, type: 'geo', parentId: col.id, x: 40, y: 20, props: { w: 200, h: 80, richText: window.__rich('Book the photographer') } })
				return id.replace(/^shape:/, '')
			})
			await until('the new item to reach the file', () => upstream().items.some((it) => it.title === 'Book the photographer'))
			const created = upstream().items.find((it) => it.title === 'Book the photographer')
			assert.equal(created.stage, 'doing')
			await synced()
			const adopted = await nodeOf(made)
			assert.deepEqual(adopted.meta.plan, { item: created.id, view: 'board', version: created.version }, 'the box they drew is the card now')
			assert.equal((await graph()).nodes.filter((n) => n.meta?.plan?.view === 'board' && n.meta.plan.item === created.id).length, 1, 'and there is only one of it')
			assert.ok(await nodeOf(`plan:gantt:${created.id}`), 'the other view has it too')
			step(`${engine}: a title edit was written; a box drawn in a column became item ${created.id} upstream`)

			// A deleted card isn't a deletion upstream: it comes back.
			const count = upstream().items.length
			await page.evaluate(() => void window.editor.deleteShapes([window.toucan.get('plan:board:goals').id]))
			await until('the card to come back', async () => !!(await nodeOf('plan:board:goals')))
			assert.equal(upstream().items.length, count)

			// Two tabs, one write: the sync is the server's, not the tabs'.
			const second = await context.newPage()
			await second.goto(`http://127.0.0.1:${port}/?canvas=${C}`)
			await second.waitForFunction(() => window.toucan?.get('plan:board:perf'), null, { timeout: 30000 })
			const v0 = item('perf').version
			await second.evaluate(() => {
				const { editor, toucan } = window
				editor.reparentShapes([toucan.get('plan:board:perf').id], toucan.get('plan:board:col:doing').id)
				editor.updateShape({ id: toucan.get('plan:board:perf').id, type: 'geo', x: 40, y: 1500 })
			})
			await until('the second tab\'s move to reach the file', () => item('perf').stage === 'doing')
			await synced()
			await sleep(1500)
			assert.equal(item('perf').version, v0 + 1, 'written once, with two tabs open')
			assert.equal(await page.evaluate(() => window.toucan.keyOf(window.editor.getShape(window.toucan.get('plan:board:perf').parentId))), 'plan:board:col:doing', 'and the first tab sees it')
			await second.close()
			step(`${engine}: a deleted card came back; with two tabs open a move was written exactly once`)

			// Undo in their tab undoes their own move, never the sync's redraw.
			await page.evaluate(() => {
				const { editor, toucan } = window
				editor.markHistoryStoppingPoint('drag')
				editor.reparentShapes([toucan.get('plan:board:legal').id], toucan.get('plan:board:col:review').id)
				editor.updateShape({ id: toucan.get('plan:board:legal').id, type: 'geo', x: 40, y: 900 })
			})
			await until('the move to reach the file', () => item('legal').stage === 'review')
			await synced()
			await page.evaluate(() => void window.editor.undo())
			await until('the undo to reach the file', () => item('legal').stage === 'todo')
			await synced()
			step(`${engine}: Cmd-Z after a synced move put the item back upstream too`)
		}

		// ---- through all of that, what the person drew themselves was never touched ----------------------------------------
		await synced()
		assert.equal(await own(), mine, 'their own box, note and arrow are exactly as they left them')
		step(`${engine}: the person's own box, ${engine === 'tldraw' ? 'sticky note ' : ''}and arrow survived every redraw untouched`)

		// ---- letting go: the shapes stay, as ordinary ones ---------------------------------------------------------------------
		const total = (await graph()).nodes.length
		const let_go = await j('plan', 'unbind')
		assert.ok(let_go.ok && let_go.left > 50, 'unbind says how many shapes it left')
		await sleep(800)
		g = await graph()
		assert.equal(g.nodes.length, total, 'nothing was removed')
		assert.ok(!g.nodes.some((n) => n.meta?.plan) && !g.groups.some((x) => x.meta?.plan), 'and nothing is managed any more')
		assert.deepEqual(await j('plan'), { bound: false })
		editUpstream('audit', { title: 'Changed after unbinding' })
		await sleep(1500)
		assert.equal((await nodeOf('plan:board:audit')).text, '✓ Audit the current site', 'an unbound canvas no longer follows')
		step(`${engine}: plan unbind left ${total} boxes on the canvas as ordinary shapes`)
		await context.close()
	}
	// ---- a source that is a plugin, with fields of its own ---------------------------------------------------------------------
	{
		const found = (await json('plugins')).kinds.find((k) => k.kind === 'source')
		assert.deepEqual(found.plugins.filter((x) => x.path.startsWith(bin)), [{ name: 'example', path: join(bin, 'toucan-source-example'), title: 'Example', description: 'A made-up plan source to copy from: two small projects kept in a JSON file.', version: '1' }])
		assert.match(found.refused.find((r) => r.name === 'asleep').reason, /it isn't executable \(chmod \+x /, 'a plugin that was found but refused says why')
		assert.deepEqual((await json('sources')).find((x) => x.name === 'example').refs.map((r) => r.ref), ['demo/garden', 'demo/archive'])
		const C = 'garden'
		const j = (...args) => json('--canvas', C, ...args)
		await toucan('new', C, '--plan', 'example', 'demo/garden', '--views', 'board')
		// Grouped by a field toucan has never heard of, with another on the cards and added up in the headers.
		await j('plan', 'view', 'set', 'board', '--group-by', 'bed', '--fields', 'hours', '--rollup', 'count,sum:hours')
		const state = () => JSON.parse(readFileSync(env.TOUCAN_SOURCE_EXAMPLE_FILE, 'utf8')).projects['demo/garden']
		const token = JSON.parse(readFileSync(join(home, '.config/toucan/server.json'), 'utf8')).token
		const context = await human.newContext({ viewport: { width: 1500, height: 950 } })
		const page = await context.newPage()
		await page.goto(`http://127.0.0.1:${port}/?canvas=${C}#token=${token}`)
		await page.waitForFunction(() => window.toucan?.get('plan:board:col:south'), null, { timeout: 30000 })
		await until('the plan to settle', async () => (await j('plan')).state === 'synced')
		let g = await j('exec', '-e', 'return toucan.graph()')
		assert.deepEqual(g.groups.filter((x) => x.key.startsWith('plan:board:col:')).sort((a, b) => a.box.x - b.box.x).map((x) => x.label), ['North bed (2, 7 hours)', 'South bed (1, 5 hours)', 'Pots (1, 2 hours)', 'No bed (2, 3 hours)'])
		assert.equal(g.nodes.find((n) => n.key === 'plan:board:g4').text, 'Build the bean frame\n4')
		if (shots) await toucan('--canvas', C, 'screenshot', join(shots, 'board-custom-field.png'), '--keys', 'plan:board')
		await page.evaluate(() => {
			const { editor, toucan } = window
			editor.reparentShapes([toucan.get('plan:board:g4').id], toucan.get('plan:board:col:south').id)
			editor.updateShape({ id: toucan.get('plan:board:g4').id, type: 'geo', x: 40, y: 300 })
		})
		await until('the drag to reach the adapter', () => existsSync(env.TOUCAN_SOURCE_EXAMPLE_FILE) && state().items.find((it) => it.id === 'g4').bed === 'south')
		assert.deepEqual([state().items.find((it) => it.id === 'g4').version, state().items[state().items.findIndex((it) => it.id === 'g4') - 1].id], [2, 'g5'], 'written once, and placed after the card it was dropped under')
		await until('the headers to add up again', async () => (await toucan('--canvas', C, 'exec', '-e', 'return toucan.text(toucan.get("plan:board:col:south"))')) === 'South bed (2, 9 hours)')
		// The read-only project next to it takes nothing.
		await j('plan', 'bind', 'example', 'demo/archive', '--views', 'board')
		assert.match(await refused('--canvas', C, 'plan', 'set', 'a1', 'stage=todo'), /Last year \(read-only\) is read-only/)
		await context.close()
		step('a plugin source: listed by `toucan plugins` (and one refused, with why); a board grouped by its own field, summed, dragged and written back through the adapter')
	}
	console.log('\nplan e2e passed')
} catch (e) {
	console.error(serverLog.split('\n').slice(-30).join('\n'))
	throw e
} finally {
	await human?.close()
	server.kill('SIGTERM')
	await new Promise((r) => server.once('exit', r))
	if (!process.env.KEEP) rmSync(home, { recursive: true, force: true }), rmSync(data, { recursive: true, force: true })
	else console.log(`kept ${home} and ${data}`)
}
