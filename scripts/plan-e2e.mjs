// End-to-end check of plans: a canvas bound to the built-in file source, with views that follow the file and write a
// person's edits back to it. A real server, the real CLI, and a browser doing what a person does.
//
//   npm run build && node scripts/plan-e2e.mjs        (npm run test:plan)
//
// Needs playwright-core and its Chromium. Runs against a throwaway HOME, data directory and port, so it never touches
// ~/.config/toucan, real canvases or a server already running. SHOTS=dir keeps screenshots of the views; KEEP=1 the data.

import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
	for (const engine of (process.env.ENGINES ?? 'tldraw,excalidraw').split(',')) {
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
		assert.deepEqual(cards.find((n) => n.key === 'plan:board:item:sitemap').meta.plan, { item: 'sitemap', view: 'board', version: 1 })
		assert.equal(cards.find((n) => n.key === 'plan:board:item:sitemap').group, 'plan:board:col:done')
		assert.match(cards.find((n) => n.key === 'plan:board:item:sitemap').meta.detail, /Top-level sections first[\s\S]*Stage: Done\nOwner: Ada/)
		assert.equal(g.nodes.filter((n) => n.meta?.plan?.view === 'gantt' && n.meta.plan.item && !n.meta.plan.label).length, 25)
		assert.ok(g.nodes.some((n) => n.key === 'plan:gantt:axis:2026-11-02'))
		step(`${engine}: new --plan file … --views board,gantt drew ${g.nodes.length} boxes in ${g.groups.length} frames with no tab open`)

		// Things of the person's own, beside and on the views: a box, a sticky note (tldraw), an arrow to a card.
		if (engine === 'tldraw') await t('exec', '--label', 'my own things', '-e', `toucan.node('mine', { x: -500, y: 100, text: 'Ask Dana about budget' }); toucan.edge('mine', 'plan:board:item:audit'); editor.createShape({ id: toucan.idFor('sticky'), type: 'note', x: -500, y: 400, parentId: editor.getCurrentPageId(), props: { richText: tl.toRichText('same thing? merge') }, meta: { key: 'sticky' } }); return 1`)
		else await t('exec', '--label', 'my own things', '-e', `await toucan.applyGraph({ nodes: [{ key: 'mine', text: 'Ask Dana about budget', box: { x: -500, y: 100, w: 220, h: 80 } }], edges: [{ from: 'mine', to: 'plan:board:item:audit' }] }); return 1`)
		const own = async () => {
			const now = await graph()
			return JSON.stringify([now.nodes.filter((n) => ['mine', 'sticky'].includes(n.key)).map((n) => [n.key, n.text, n.box, n.meta?.plan]), now.edges.filter((e) => e.from === 'mine').map((e) => [e.from, e.to])])
		}
		const mine = await own()
		assert.ok(mine.includes('plan:board:item:audit'))

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
		assert.ok(g.edges.some((e) => e.from === 'plan:gantt:item:templates' && e.to === 'plan:gantt:item:migrate-blog'), 'dependency arrows')
		await j('plan', 'view', 'rm', 'table')
		await synced()
		g = await graph()
		assert.equal(g.nodes.filter((n) => n.meta?.plan?.view === 'table').length, 0, 'a removed view takes its shapes with it')
		assert.deepEqual(g.groups.find((x) => x.key === (nested ? 'plan:board' : 'plan:board:col:todo')).box, boardBox, 'and the other views stay where they were')
		await j('plan', 'view', 'set', 'gantt', '--no-dependencies', '--scale', 'week')
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
		assert.equal((await nodeOf('plan:board:item:analytics')).group, 'plan:board:col:doing')
		assert.ok(await nodeOf(`plan:board:item:${added[0].id}`), 'the new item has a card')
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
		await page.waitForFunction(() => window.toucan?.get('plan:board:item:sitemap'), null, { timeout: 30000 })
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
			// The same chart at a month's scale and a week's: bars exactly as long as their items, titles beside the ones too short to hold them.
			for (const scale of ['month', 'week']) {
				await j('plan', 'view', 'set', 'gantt', '--scale', scale)
				await synced()
				await sleep(600)
				await t('screenshot', join(shots, `gantt-${scale}-${engine}.png`), '--keys', keysOf('gantt'), '--max', '2400')
			}
		}

		// ---- upstream changes, and the canvas follows on its own -----------------------------------------------------------------
		editUpstream('voice', { stage: 'done', title: 'Write the voice and tone guide' })
		await until('the card to follow upstream', async () => {
			const n = await nodeOf('plan:board:item:voice')
			return n.group === 'plan:board:col:done' && n.text === '✓ Write the voice and tone guide' && n.meta.plan.version === 2
		})
		assert.equal((await nodeOf('plan:gantt:item:voice')).style.color, 'grey', 'the same item in the other view')
		step(`${engine}: the file changed upstream; board and gantt followed without being asked`)

		// ---- a person's edits, made in their tab as they would make them, are written back ------------------------------------
		const before = item('scaffold')
		if (engine === 'tldraw') {
			await page.evaluate(() => {
				const { editor, toucan } = window
				const card = toucan.get('plan:board:item:scaffold'), col = toucan.get('plan:board:col:review')
				editor.markHistoryStoppingPoint('drag')
				editor.reparentShapes([card.id], col.id)
				editor.updateShape({ id: card.id, type: 'geo', x: 44, y: 700 })
			})
		} else {
			await page.evaluate(() => {
				const api = window.editor, ex = window.toucan
				const els = api.getSceneElementsIncludingDeleted()
				const card = ex.get('plan:board:item:scaffold'), col = ex.get('plan:board:col:review')
				const dx = col.x + 44 - card.x, dy = col.y + 700 - card.y
				const move = (e) => window.__bump(e, { x: e.x + dx, y: e.y + dy, frameId: col.id })
				api.updateScene({ elements: els.map((e) => (e.id === card.id || e.containerId === card.id ? move(e) : e)), captureUpdate: 'IMMEDIATELY' })
			})
		}
		await until('the move to reach the file', () => item('scaffold').stage === 'review')
		assert.equal(item('scaffold').version, before.version + 1)
		await synced()
		const snapped = await nodeOf('plan:board:item:scaffold')
		assert.deepEqual([snapped.group, snapped.meta.plan.version], ['plan:board:col:review', 2])
		const reviewCol = (await graph()).groups.find((x) => x.key === 'plan:board:col:review')
		assert.equal(reviewCol.label, 'In review (2)')
		assert.equal(snapped.box.x, reviewCol.box.x + 30, 'the card snapped into its slot')
		step(`${engine}: a card dragged into another column set stage=review in the file (v${before.version} → v${item('scaffold').version}), then snapped into place`)

		const bar0 = await nodeOf('plan:gantt:item:templates')
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
		await stretch('plan:gantt:item:templates', 0, 5 * 16)
		await until('the stretch to reach the file', () => item('templates').end === '2026-12-16')
		assert.equal(item('templates').start, '2026-11-30', 'only the end moved')
		await synced()
		await stretch('plan:gantt:item:templates', -3 * 16, 0)
		await until('the move to reach the file', () => item('templates').start === '2026-11-27')
		assert.equal(item('templates').end, '2026-12-13', 'both dates moved together')
		await synced()
		assert.equal((await nodeOf('plan:gantt:item:templates')).box.x, bar0.box.x - 3 * 16)
		step(`${engine}: a gantt bar stretched five days, then dragged back three: the file's dates followed, to whole days`)

		// ---- a conflict: upstream moved on while they were typing --------------------------------------------------------------
		if (engine === 'tldraw') {
			await page.evaluate(() => void window.editor.setEditingShape(window.toucan.get('plan:board:item:cms').id))
			await sleep(400) // the tab says it's busy
			const cursor = (await j('plan')).cursor
			editUpstream('cms', { title: 'Choose the CMS (decided: Kirby)' })
			await until('the server to notice upstream moved', async () => (await j('plan')).cursor !== cursor)
			await sleep(1200)
			assert.equal((await nodeOf('plan:board:item:cms')).meta.plan.version, 1, 'nothing is redrawn under someone who is typing')
			await page.evaluate(() => {
				const { editor, toucan } = window
				const s = toucan.get('plan:board:item:cms')
				editor.updateShape({ id: s.id, type: 'geo', props: { richText: window.__rich('✓ Pick the CMS') } })
				editor.setEditingShape(null)
			})
			await until('the conflict to be recorded', async () => (await j('plan')).problems.length === 1)
			status = await j('plan')
			assert.equal(status.problems[0].kind, 'conflict')
			assert.equal(status.problems[0].text, '"Choose the CMS (decided: Kirby)" changed upstream; showing the upstream version.')
			await until('the card to go back to upstream', async () => (await nodeOf('plan:board:item:cms')).text === '✓ Choose the CMS (decided: Kirby)')
			assert.equal(item('cms').title, 'Choose the CMS (decided: Kirby)', 'upstream kept its own')
			const notice = page.getByRole('alert').filter({ hasText: 'changed upstream; showing the upstream version' })
			await notice.waitFor({ timeout: 5000 })
			if (shots) await page.screenshot({ path: join(shots, `conflict-${engine}.png`) })
			await notice.getByRole('button', { name: 'Dismiss' }).click()
			await until('the problem to be dismissed', async () => (await j('plan')).problems.length === 0)
			step(`${engine}: an edit made on a stale card was refused as a conflict, the card went back to upstream, and the person was told`)

			// A title edited with nothing in the way is written.
			await page.evaluate(() => {
				const s = window.toucan.get('plan:board:item:redirects')
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
			assert.ok(await nodeOf(`plan:gantt:item:${created.id}`), 'the other view has it too')
			step(`${engine}: a title edit was written; a box drawn in a column became item ${created.id} upstream`)

			// A deleted card isn't a deletion upstream: it comes back.
			const count = upstream().items.length
			await page.evaluate(() => void window.editor.deleteShapes([window.toucan.get('plan:board:item:goals').id]))
			await until('the card to come back', async () => !!(await nodeOf('plan:board:item:goals')))
			assert.equal(upstream().items.length, count)

			// Two tabs, one write: the sync is the server's, not the tabs'.
			const second = await context.newPage()
			await second.goto(`http://127.0.0.1:${port}/?canvas=${C}`)
			await second.waitForFunction(() => window.toucan?.get('plan:board:item:perf'), null, { timeout: 30000 })
			const v0 = item('perf').version
			await second.evaluate(() => {
				const { editor, toucan } = window
				editor.reparentShapes([toucan.get('plan:board:item:perf').id], toucan.get('plan:board:col:doing').id)
				editor.updateShape({ id: toucan.get('plan:board:item:perf').id, type: 'geo', x: 40, y: 1500 })
			})
			await until('the second tab\'s move to reach the file', () => item('perf').stage === 'doing')
			await synced()
			await sleep(1500)
			assert.equal(item('perf').version, v0 + 1, 'written once, with two tabs open')
			assert.equal(await page.evaluate(() => window.toucan.keyOf(window.editor.getShape(window.toucan.get('plan:board:item:perf').parentId))), 'plan:board:col:doing', 'and the first tab sees it')
			await second.close()
			step(`${engine}: a deleted card came back; with two tabs open a move was written exactly once`)

			// Undo in their tab undoes their own move, never the sync's redraw.
			await page.evaluate(() => {
				const { editor, toucan } = window
				editor.markHistoryStoppingPoint('drag')
				editor.reparentShapes([toucan.get('plan:board:item:legal').id], toucan.get('plan:board:col:review').id)
				editor.updateShape({ id: toucan.get('plan:board:item:legal').id, type: 'geo', x: 40, y: 900 })
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

		// ==== what must never be read as someone's edit ==========================================================================
		// Everything below either moves, redraws or rearranges the views without a person changing the work, or is something an
		// agent did. After each, the plan upstream is exactly as it was.
		await j('plan', 'dismiss')
		const isTl = engine === 'tldraw'
		const snap = (ids) => JSON.stringify(upstream().items.filter((it) => !ids || ids.includes(it.id)).map(({ id, version, title, stage, assignee, start, end }) => [id, version, title, stage, assignee, start, end]))
		const quiet = async () => {
			await sleep(1300)
			await synced()
			await sleep(800)
			await synced()
		}
		const unchanged = async (what, act) => {
			const before = snap()
			await act()
			await quiet()
			assert.equal(snap(), before, `${what}: nothing was written upstream`)
			assert.deepEqual((await j('plan')).problems.filter((p) => p.kind !== 'created'), [], `${what}: and nothing went wrong`)
		}
		/** Moves a frame with all that's in it, as a person dragging it does. */
		const moveFrame = (key, dx, dy) =>
			page.evaluate(([key, dx, dy, isTl]) => {
				if (isTl) {
					const s = window.toucan.get(key)
					window.editor.updateShape({ id: s.id, type: s.type, x: s.x + dx, y: s.y + dy })
				} else {
					const api = window.editor, f = window.toucan.get(key)
					const els = api.getSceneElementsIncludingDeleted()
					const inside = new Set(els.filter((e) => e.id === f.id || e.frameId === f.id).map((e) => e.id))
					api.updateScene({ elements: els.map((e) => (inside.has(e.id) || inside.has(e.containerId) ? window.__bump(e, { x: e.x + dx, y: e.y + dy }) : e)), captureUpdate: 'IMMEDIATELY' })
				}
			}, [key, dx, dy, isTl])
		const openTab = async () => {
			const p = await context.newPage()
			await p.goto(`http://127.0.0.1:${port}/?canvas=${C}`)
			await p.waitForFunction(() => window.toucan?.get('plan:board:item:perf'), null, { timeout: 30000 })
			return p
		}

		await unchanged('a second tab connecting', async () => (await openTab()).close())
		await unchanged('a lane dragged', () => moveFrame('plan:gantt:lane:linus', 90, 0))
		await unchanged('the Unscheduled strip dragged', () => moveFrame('plan:gantt:frame:unscheduled', 160, 60))
		await unchanged('a column dragged', () => moveFrame('plan:board:col:doing', 0, 140))
		if (isTl) {
			await unchanged('the whole gantt dragged', () => moveFrame('plan:gantt', 300, -200))
			await unchanged('the gantt\'s frame resized from the left with its contents left where they are (cmd-resize)', () =>
				page.evaluate(() => {
					const { editor, toucan } = window
					const f = toucan.get('plan:gantt')
					const kids = editor.getSortedChildIdsForParent(f.id).map((id) => editor.getShape(id))
					editor.updateShape({ id: f.id, type: 'frame', x: f.x - 160, props: { w: f.props.w + 160 } })
					editor.updateShapes(kids.map((c) => ({ id: c.id, type: c.type, x: c.x + 160 })))
				}))
		} else {
			// A gantt with no lanes has no frame at all here: its bars are read against its axis, so the one frame it does have can go anywhere.
			await j('plan', 'view', 'set', 'gantt', '--group-by', 'none')
			await quiet()
			await unchanged('the Unscheduled strip dragged, on a gantt with no frame of its own', () => moveFrame('plan:gantt:frame:unscheduled', 160, 200))
			await j('plan', 'view', 'set', 'gantt', '--group-by', 'assignee')
			await quiet()
		}
		step(`${engine}: a second tab, and lanes, columns, the Unscheduled strip${isTl ? ', the whole view dragged or resized around its contents' : ' (also with no frame round the gantt)'}: nothing written`)

		// One dated item added upstream, and one far past the end of the axis: every other item stays exactly as it was.
		{
			const ids = upstream().items.map((it) => it.id), before = snap(ids)
			await j('plan', 'add', '--title', 'One more task', 'stage=todo', 'assignee=ada', 'start=2026-11-18', 'end=2026-11-20')
			await quiet()
			await j('plan', 'add', '--title', 'Much later', 'stage=todo', 'start=2027-03-01', 'end=2027-03-05')
			await quiet()
			assert.equal(snap(ids), before, 'adding items, and a longer axis, moved no other item')
			assert.ok((await graph()).nodes.some((n) => n.key === 'plan:gantt:axis:2027-03-01'), 'the axis grew to hold it')
			step(`${engine}: an item added, and the axis made longer: no other item written`)
		}

		// A gantt bar dropped into Unscheduled keeps its dates and goes back; a card dragged out of it onto the chart starts that day.
		if (isTl) {
			const dates = [item('home-build').start, item('home-build').end]
			await unchanged('a bar dropped into Unscheduled', () =>
				page.evaluate(() => {
					const { editor, toucan } = window
					editor.reparentShapes([toucan.get('plan:gantt:item:home-build').id], toucan.get('plan:gantt:frame:unscheduled').id)
					editor.updateShape({ id: toucan.get('plan:gantt:item:home-build').id, type: 'geo', x: 40, y: 40 })
				}))
			assert.deepEqual([item('home-build').start, item('home-build').end], dates)
			assert.equal((await nodeOf('plan:gantt:item:home-build')).group, 'plan:gantt:lane:linus', 'and it is back in its lane')
			await page.evaluate(() => {
				const { editor, toucan } = window
				const lane = toucan.get('plan:gantt:lane:grace'), head = editor.getShapePageBounds(toucan.get('plan:gantt:axis:2026-12-07')), at = editor.getShapePageBounds(lane)
				const card = toucan.get('plan:gantt:item:press')
				editor.reparentShapes([card.id], lane.id)
				editor.updateShape({ id: card.id, type: 'geo', x: head.x + 2 * 16 + 3 - at.x, y: 30 })
			})
			await until('the drop to reach the file', () => item('press').start === '2026-12-09')
			assert.deepEqual([item('press').end, item('press').assignee], ['2026-12-09', 'grace'], 'a day long, in the lane it was dropped in')
			await quiet()
			step(`${engine}: a bar dropped into Unscheduled kept its dates; a card dragged out of it started on the day it was dropped on`)
		}

		// The view put inside a frame of the person's own stays there; on another page, it stays on its page.
		if (isTl) {
			await unchanged('the board put inside a frame of their own', () =>
				page.evaluate(() => {
					const { editor, toucan } = window
					const b = editor.getShapePageBounds(toucan.get('plan:board'))
					toucan.frame('theirs', { x: b.x - 100, y: b.y - 100, w: b.w + 200, h: b.h + 200, name: 'Q4 workstream' })
					editor.sendToBack([toucan.get('theirs').id])
					editor.reparentShapes([toucan.get('plan:board').id], toucan.get('theirs').id)
				}))
			editUpstream('perf', { title: 'Performance budget v2' })
			await until('the redraw', async () => (await nodeOf('plan:board:item:perf')).text.includes('v2'))
			await quiet()
			assert.equal(await page.evaluate(() => window.toucan.keyOf(window.editor.getShape(window.toucan.get('plan:board').parentId))), 'theirs', 'a redraw leaves the view in the frame they put it in')
			const home = await page.evaluate(() => {
				const { editor } = window
				const first = editor.getCurrentPageId()
				editor.createPage({ name: 'Notes' })
				editor.setCurrentPage(editor.getPages().find((p) => p.name === 'Notes').id)
				return first
			})
			const made = (await j('plan', 'add', '--title', 'Added while on another page', 'stage=doing'))[0].id
			await until('the card to be drawn', () => page.evaluate((key) => !!window.editor.getShape(window.toucan.idFor(key)), `plan:board:item:${made}`))
			await sleep(1500)
			const where = await page.evaluate((key) => ({ card: window.editor.getAncestorPageId(window.editor.getShape(window.toucan.idFor(key))), board: window.editor.getAncestorPageId(window.editor.getShape(window.toucan.idFor('plan:board'))), gantt: window.editor.getAncestorPageId(window.editor.getShape(window.toucan.idFor('plan:gantt'))) }), `plan:board:item:${made}`)
			assert.deepEqual(where, { card: home, board: home, gantt: home }, 'a redraw while they look at another page draws on the views\' own page')
			await unchanged('looking at another page, and coming back', () => page.evaluate((id) => void window.editor.setCurrentPage(id), home))
			step(`${engine}: a view stays in the frame, and on the page, a person left it`)
		}

		// A box an agent puts in a column is an annotation, not an item; a graph re-imported with --move moves no plan shape.
		{
			const n = upstream().items.length
			await unchanged('an agent\'s box in a column', () => (isTl
				? t('exec', '-e', `toucan.node('agent-note', { parent: 'plan:board:col:review', x: 30, y: 900, w: 220, h: 64, text: 'Waiting on legal sign-off' }); return 1`)
				: t('exec', '-e', `await toucan.applyGraph({ nodes: [{ key: 'agent-note', text: 'Waiting on legal sign-off', group: 'plan:board:col:review', box: { x: toucan.get('plan:board:col:review').x + 30, y: toucan.get('plan:board:col:review').y + 900, w: 220, h: 64 } }] }); return 1`)))
			assert.equal(upstream().items.length, n)
			const file = join(home, `${C}.tg.json`)
			await t('graph', file)
			const tg = JSON.parse(readFileSync(file, 'utf8'))
			for (const x of [...tg.nodes, ...tg.groups]) if (x.box) x.box.x += 500
			writeFileSync(file, JSON.stringify(tg))
			let kept
			await unchanged('the canvas\'s own graph imported back with --move, everything shifted', async () => (kept = await j('import', file, '--move')))
			assert.ok(kept.planKept > 50, `import says what it left alone (${kept.planKept} plan shapes)`)
			assert.equal(upstream().items.length, n)
			step(`${engine}: an agent's box in a column made no item; import --move left ${kept.planKept} plan shapes where they were`)
		}

		// A copy of a card is an ordinary box: not a second item, wherever it is put.
		if (isTl) {
			const n = upstream().items.length
			await unchanged('a card duplicated', () => page.evaluate(() => void window.editor.duplicateShapes([window.toucan.get('plan:board:item:goals').id], { x: 0, y: 120 })))
			await unchanged('the copy dragged into another column', () =>
				page.evaluate(() => {
					const { editor, toucan } = window
					const copy = editor.getCurrentPageShapes().find((s) => s.type === 'geo' && toucan.text(s).includes('Agree goals') && s.meta?.plan === null)
					editor.reparentShapes([copy.id], toucan.get('plan:board:col:doing').id)
					editor.updateShape({ id: copy.id, type: 'geo', x: 40, y: 1500 })
				}))
			assert.equal(upstream().items.length, n)
			// Several boxes arriving at once (a paste) aren't items either.
			await page.evaluate(() => {
				const { editor, toucan } = window
				const col = toucan.get('plan:board:col:review')
				editor.createShapes([1, 2].map((i) => ({ id: `shape:pasted${i}`, type: 'geo', parentId: col.id, x: 40, y: 1100 + i * 100, props: { w: 200, h: 80, richText: window.__rich(`Pasted ${i}`) } })))
			})
			await quiet()
			assert.equal(upstream().items.length, n, 'two boxes arriving together are not items')
			await j('plan', 'dismiss')
			// Bound again, the box a person drew that became an item is still that item's one card.
			const adopted = (await graph()).nodes.find((x) => x.key.startsWith('drawn') && x.meta?.plan?.item)
			await j('plan', 'bind', 'file', 'files/website-relaunch.plan.json')
			await quiet()
			assert.deepEqual((await graph()).nodes.filter((x) => x.meta?.plan?.view === 'board' && x.meta.plan.item === adopted.meta.plan.item).map((x) => x.key), [adopted.key], 'binding again draws no second card for it')
			step(`${engine}: a duplicated card, its copy moved, two pasted boxes: no items; binding again made no second card for a box that became one`)
		}

		// A version restored: the old drawings are not edits. Upstream keeps what it has, and the views are drawn from it.
		{
			const saved = (await j('versions', 'save', 'before the change')).n
			await j('plan', 'set', 'retire', 'stage=In review')
			await quiet()
			await sleep(2000) // a version lands just after the run it records
			const after = snap()
			await j('versions', 'restore', String(saved))
			await page.waitForFunction(() => window.toucan?.get('plan:board:item:retire'), null, { timeout: 30000 })
			await until('the views to be drawn from upstream again', async () => (await nodeOf('plan:board:item:retire'))?.group === 'plan:board:col:review')
			await quiet()
			assert.equal(snap(), after, 'restoring a version wrote nothing upstream')
			assert.deepEqual((await j('plan')).problems.filter((p) => p.kind !== 'created'), [])
			step(`${engine}: versions restore wrote nothing upstream, and the views were drawn again from it`)
		}

		// Someone leaves a text box of their own open: everyone else's sync carries on.
		if (isTl) {
			await page.evaluate(() => void window.editor.setEditingShape(window.toucan.get('mine').id))
			await sleep(700)
			editUpstream('legal', { stage: 'done' })
			await until('the upstream change to be drawn while a text box is open', async () => (await page.evaluate(() => window.toucan.keyOf(window.editor.getShape(window.toucan.get('plan:board:item:legal').parentId)))) === 'plan:board:col:done', 8000)
			const other = await openTab()
			await other.evaluate(() => {
				const { editor, toucan } = window
				editor.reparentShapes([toucan.get('plan:board:item:a11y').id], toucan.get('plan:board:col:review').id)
				editor.updateShape({ id: toucan.get('plan:board:item:a11y').id, type: 'geo', x: 40, y: 1300 })
			})
			await until('another tab\'s drag to be written meanwhile', () => item('a11y').stage === 'review', 8000)
			await other.close()
			await page.evaluate(() => void window.editor.setEditingShape(null))
			await quiet()
			step(`${engine}: with a text box left open in one tab, upstream changes were still drawn and another tab's drag still written`)
		}

		// Swimlanes: a card dragged across both a column and a row sets both fields.
		if (isTl) {
			await j('plan', 'view', 'add', 'board', '--id', 'lanes', '--lanes', 'assignee', '--filter', 'stage!=done')
			await quiet()
			const fine = await page.evaluate(() => window.toucan.measure().findings.filter((f) => ['overlap', 'text outgrew its box', 'cut off by its frame'].includes(f.kind) && f.on.some((k) => String(k).startsWith('plan:lanes'))))
			assert.deepEqual(fine, [], 'swimlanes as drawn: nothing overlapping or cut off')
			if (shots) await t('screenshot', join(shots, 'swimlanes.png'), '--keys', 'plan:lanes', '--max', '2400')
			const was = item('analytics')
			await page.evaluate(() => {
				const { editor, toucan } = window
				const col = toucan.get('plan:lanes:col:review'), row = editor.getShapePageBounds(toucan.get('plan:lanes:row:linus')), at = editor.getShapePageBounds(col)
				const card = toucan.get('plan:lanes:item:analytics')
				editor.reparentShapes([card.id], col.id)
				editor.updateShape({ id: card.id, type: 'geo', x: 30, y: row.y - at.y + 12 })
			})
			await until('the drag across a column and a row to reach the file', () => item('analytics').stage === 'review' && item('analytics').assignee === 'linus')
			assert.equal(item('analytics').version, was.version + 1, 'one write for both fields')
			await quiet()
			await unchanged('a whole row of names nudged', () => page.evaluate(() => {
				const { editor, toucan } = window
				for (const k of ['ada', 'grace', 'linus']) editor.updateShape({ id: toucan.get(`plan:lanes:row:${k}`).id, type: 'geo', y: toucan.get(`plan:lanes:row:${k}`).y + 30 })
			}))
			step(`${engine}: swimlanes drawn soundly; a card dragged to another column and row set stage and owner in one write (was ${was.stage}/${was.assignee})`)
		}

		// A person's own things inside a view that goes away are theirs: they stay, where they were.
		{
			await j('plan', 'view', 'add', 'board', '--id', 'b2', '--group-by', 'priority')
			await quiet()
			if (isTl) await page.evaluate(() => {
				const { editor, toucan } = window
				const note = (key, frameKey, text, x, y) => editor.createShape({ id: toucan.idFor(key), type: 'note', parentId: toucan.get(frameKey).id, x, y, props: { richText: window.__rich(text) }, meta: { key } })
				note('note-in-column', 'plan:b2:col:high', 'Ask Dana which of these slip', 40, 900)
				note('note-in-board', 'plan:b2', 'Board review on Friday', 20, 4)
				note('note-in-unscheduled', 'plan:gantt:frame:unscheduled', 'Nobody owns these yet', 500, 10)
			})
			else await page.evaluate(async () => {
				const col = window.toucan.get('plan:b2:col:high')
				await window.toucan.applyGraph({ nodes: [{ key: 'note-in-column', text: '', group: 'plan:b2:col:high', style: { color: 'yellow', geo: 'ellipse' }, box: { x: col.x + 40, y: col.y + 900, w: 200, h: 120 } }] })
			})
			await quiet()
			const notes = isTl ? ['note-in-column', 'note-in-board', 'note-in-unscheduled'] : ['note-in-column']
			const at = () => page.evaluate(([keys, isTl]) => keys.map((k) => {
				const s = window.toucan.get(k)
				if (!s) return null
				const b = isTl ? window.editor.getShapePageBounds(s) : s
				return [Math.round(b.x), Math.round(b.y)]
			}), [notes, isTl])
			const before = await at()
			assert.ok(before.every(Boolean))
			await j('plan', 'view', 'rm', 'b2')
			if (isTl) for (const it of upstream().items.filter((x) => !x.start && !x.end)) await j('plan', 'set', it.id, 'start=2026-12-01', 'end=2026-12-02')
			await quiet()
			assert.ok(!(await graph()).groups.some((g) => g.key === 'plan:b2' || g.key === 'plan:gantt:frame:unscheduled' && isTl), 'the frames are gone')
			// (The note in the Unscheduled strip rode down the page with the strip as the lanes above it grew, until the strip went.)
			const now = await at()
			assert.deepEqual(now.slice(0, isTl ? 2 : 1), before.slice(0, isTl ? 2 : 1), 'their notes are where they left them')
			assert.ok(now.every(Boolean), 'and every one of them is still there')
			step(`${engine}: ${notes.length} of the person's own notes inside a removed view${isTl ? ' and an emptied Unscheduled strip' : ''} stayed exactly where they were`)
		}

		// Every shipped routine, run as from the Routines menu: the plan's views are left as they are, and nothing is written.
		{
			const routines = readdirSync(join(ROOT, 'routines')).filter((f) => f.endsWith('.js')).map((f) => ({ name: f.slice(0, -3), engines: /^\/\/ engines: (.*)$/m.exec(readFileSync(join(ROOT, 'routines', f), 'utf8'))?.[1] ?? 'tldraw' })).filter((r) => r.engines.includes(engine))
			assert.ok(routines.length >= 15, `routines to run (${routines.length})`)
			const before = snap(), drawn = JSON.stringify((await graph()).nodes.filter((n) => n.meta?.plan).map((n) => [n.key, n.box.x, n.box.y, n.box.w, n.text]).sort())
			const said = {}
			for (const r of routines) said[r.name] = await t('routine', 'run', r.name).then((out) => JSON.parse(out).summary, (e) => `failed: ${String(e.stderr).trim().split('\n').at(-1)}`)
			await quiet()
			assert.equal(snap(), before, `after ${routines.length} routines, nothing was written upstream`)
			assert.equal(JSON.stringify((await graph()).nodes.filter((n) => n.meta?.plan).map((n) => [n.key, n.box.x, n.box.y, n.box.w, n.text]).sort()), drawn, 'and no plan shape moved or changed')
			assert.match(said['clean-up'], /left the plan views as they are/, 'a routine says what it left alone')
			assert.match(said['lay-out-again'], /left the plan views as they are/i)
			assert.deepEqual((await j('plan')).problems.filter((p) => p.kind !== 'created'), [])
			step(`${engine}: ${routines.length} shipped routines run on a bound canvas: no plan shape moved, nothing written ("${said['clean-up']}")`)
		}

		// The plan control and the Details card, clicked through as a person does.
		if (isTl) {
			await page.getByRole('button', { name: /^Plan: Website relaunch/ }).click()
			await page.getByRole('button', { name: 'Sync now' }).click()
			await page.getByRole('button', { name: 'Table', exact: true }).click()
			await until('the Table button to add a view', async () => (await j('plan', 'views')).some((v) => v.kind === 'table'))
			await page.getByLabel(/^Group .*Board.* by$/).first().selectOption('priority')
			await until('the picker to regroup the board', async () => (await j('plan', 'views')).find((v) => v.id === 'board').groupBy === 'priority')
			await quiet()
			assert.ok((await graph()).groups.some((g) => g.key === 'plan:board:col:high'), 'and the board is drawn by priority')
			await page.getByLabel(/^Group .*Board.* by$/).first().selectOption('stage')
			await until('the picker to put it back', async () => (await j('plan', 'views')).find((v) => v.id === 'board').groupBy === 'stage')
			await page.getByRole('button', { name: /^Remove .*Table/ }).click()
			await page.getByRole('button', { name: 'Remove?' }).click()
			await until('the view to be removed', async () => !(await j('plan', 'views')).some((v) => v.kind === 'table'))
			if (shots) await page.screenshot({ path: join(shots, 'plan-menu.png') })
			await page.keyboard.press('Escape')
			await quiet()
			await page.evaluate(() => {
				window.editor.setCurrentTool('select')
				window.editor.select(window.toucan.get('plan:board:item:copy-product').id)
			})
			const fields = page.getByLabel('Plan fields')
			await fields.waitFor({ timeout: 8000 })
			await fields.getByLabel('Stage').selectOption('doing')
			await until('the card\'s Stage to reach the file', () => item('copy-product').stage === 'doing')
			await quiet()
			await page.evaluate(() => void window.editor.select(window.toucan.get('plan:board:item:copy-product').id))
			await fields.getByLabel('End', { exact: true }).fill('2026-12-23')
			await until('the card\'s End to reach the file', () => item('copy-product').end === '2026-12-23')
			await quiet()
			await page.evaluate(() => void window.editor.select(window.toucan.get('plan:board:item:copy-product').id))
			if (shots) await page.screenshot({ path: join(shots, 'details-fields.png') })
			await fields.getByRole('button', { name: 'Clear End' }).click()
			await until('the cleared date to reach the file', () => item('copy-product').end === undefined)
			await page.evaluate(() => void window.editor.selectNone())
			await quiet()
			step(`${engine}: the plan control synced, added, regrouped and removed a view; the Details card set a stage and a date, and cleared the date`)
		}

		// Excalidraw: a conflict, a drawn box, two tabs, and undo.
		if (!isTl) {
			// Upstream changes a card, and before the canvas has caught up someone drops it in another column: their drop was made on
			// what they saw, so it is refused, whichever of the two the server hears of first.
			editUpstream('cms', { title: 'Choose the CMS (decided: Kirby)' })
			await page.evaluate(() => {
				const api = window.editor, card = window.toucan.get('plan:board:item:cms'), col = window.toucan.get('plan:board:col:review')
				const dx = col.x + 44 - card.x, dy = col.y + 900 - card.y
				api.updateScene({ elements: api.getSceneElementsIncludingDeleted().map((e) => (e.id === card.id || e.containerId === card.id ? window.__bump(e, { x: e.x + dx, y: e.y + dy, frameId: col.id }) : e)), captureUpdate: 'IMMEDIATELY' })
			})
			await until('the conflict to be recorded', async () => (await j('plan')).problems.some((p) => p.kind === 'conflict'))
			await until('the card to go back to upstream', async () => {
				const n = await nodeOf('plan:board:item:cms')
				return n.text === '✓ Choose the CMS (decided: Kirby)' && n.group === 'plan:board:col:done'
			})
			assert.equal(item('cms').stage, 'done', 'upstream kept its own')
			await page.getByRole('alert').filter({ hasText: 'changed upstream; showing the upstream version' }).getByRole('button', { name: 'Dismiss' }).click()
			await quiet()
			// A box drawn in a column becomes an item, and is its card.
			const n = upstream().items.length
			await page.evaluate(async () => {
				const col = window.toucan.get('plan:board:col:doing')
				await window.toucan.applyGraph({ nodes: [{ key: 'drawnByHand', text: 'Book the photographer', group: 'plan:board:col:doing', box: { x: col.x + 40, y: col.y + 20, w: 200, h: 80 } }] })
			})
			await until('the new item to reach the file', () => upstream().items.some((it) => it.title === 'Book the photographer'))
			await quiet()
			const made = upstream().items.find((it) => it.title === 'Book the photographer')
			assert.deepEqual([upstream().items.length, made.stage, (await nodeOf('drawnByHand')).meta.plan.item], [n + 1, 'doing', made.id])
			assert.equal((await graph()).nodes.filter((x) => x.meta?.plan?.view === 'board' && x.meta.plan.item === made.id).length, 1)
			await page.getByRole('status').filter({ hasText: 'Added "Book the photographer" to Website relaunch' }).waitFor({ timeout: 5000 })
			await j('plan', 'dismiss')
			// Two tabs, one write.
			const second = await openTab()
			const v0 = item('perf').version
			const drag = (p, key, col, y) => p.evaluate(([key, colKey, y]) => {
				const api = window.editor, card = window.toucan.get(key), col = window.toucan.get(colKey)
				const dx = col.x + 44 - card.x, dy = col.y + y - card.y
				api.updateScene({ elements: api.getSceneElementsIncludingDeleted().map((e) => (e.id === card.id || e.containerId === card.id ? window.__bump(e, { x: e.x + dx, y: e.y + dy, frameId: col.id }) : e)), captureUpdate: 'IMMEDIATELY' })
			}, [key, col, y])
			await drag(second, 'plan:board:item:perf', 'plan:board:col:doing', 1500)
			await until('the second tab\'s move to reach the file', () => item('perf').stage === 'doing')
			await quiet()
			assert.equal(item('perf').version, v0 + 1, 'written once, with two tabs open')
			assert.equal(await page.evaluate(() => window.editor.getSceneElements().filter((e) => e.customData?.key?.startsWith('plan:board:item:') && !(e.boundElements ?? []).some((b) => b.type === 'text')).length), 0, 'a redraw made in one tab leaves every card its text in the other')
			await second.close()
			step(`${engine}: a drop on a stale card was refused and put back; a drawn box became item ${made.id}; two tabs wrote once`)
		}

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
		assert.equal((await nodeOf('plan:board:item:audit')).text, '✓ Audit the current site', 'an unbound canvas no longer follows')
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
		assert.equal(g.nodes.find((n) => n.key === 'plan:board:item:g4').text, 'Build the bean frame\n4')
		if (shots) await toucan('--canvas', C, 'screenshot', join(shots, 'board-custom-field.png'), '--keys', 'plan:board')
		await page.evaluate(() => {
			const { editor, toucan } = window
			editor.reparentShapes([toucan.get('plan:board:item:g4').id], toucan.get('plan:board:col:south').id)
			editor.updateShape({ id: toucan.get('plan:board:item:g4').id, type: 'geo', x: 40, y: 300 })
		})
		await until('the drag to reach the adapter', () => existsSync(env.TOUCAN_SOURCE_EXAMPLE_FILE) && state().items.find((it) => it.id === 'g4').bed === 'south')
		assert.deepEqual([state().items.find((it) => it.id === 'g4').version, state().items[state().items.findIndex((it) => it.id === 'g4') - 1].id], [2, 'g5'], 'written once, and placed after the card it was dropped under')
		await until('the headers to add up again', async () => (await toucan('--canvas', C, 'exec', '-e', 'return toucan.text(toucan.get("plan:board:col:south"))')) === 'South bed (2, 9 hours)')
		// The read-only project next to it takes nothing.
		await j('plan', 'bind', 'example', 'demo/archive', '--views', 'board')
		assert.match(await refused('--canvas', C, 'plan', 'set', 'a1', 'stage=todo'), /Last year \(read-only\) is read-only/)
		await context.close()
		// With nobody at the canvas, an agent asking for the plan is told what upstream says now, without being asked to sync first.
		await sleep(1600)
		const elsewhere = JSON.parse(readFileSync(env.TOUCAN_SOURCE_EXAMPLE_FILE, 'utf8'))
		elsewhere.rev++
		Object.assign(elsewhere.projects['demo/archive'].items[0], { title: 'Harvest, weighed', version: 2 })
		writeFileSync(env.TOUCAN_SOURCE_EXAMPLE_FILE, JSON.stringify(elsewhere))
		assert.match(await toucan('--canvas', C, 'plan', 'items'), /a1 v2 {2}Harvest, weighed/, '`plan items` reads the source again when it has moved')
		step('a plugin source: listed by `toucan plugins` (and one refused, with why); a board grouped by its own field, summed, dragged and written back through the adapter')
	}
	// ---- a hierarchy: a gantt grouped by a field whose options are the plan's own items --------------------------------------
	{
		const C = 'orchard'
		const j = (...args) => json('--canvas', C, ...args)
		const file = join(home, 'orchard.plan.json')
		writeFileSync(file, JSON.stringify({
			plan: 1,
			source: { title: 'Orchard' },
			fields: [
				{ id: 'title', label: 'Title', type: 'text', writable: true },
				{ id: 'ripeness', label: 'Ripeness', type: 'option', writable: true, options: [{ id: 'green', label: 'Green', color: 'light-green' }, { id: 'ripe', label: 'Ripe', color: 'red' }, { id: 'picked', label: 'Picked', color: 'grey', done: true }] },
				{ id: 'crates', label: 'Crates', type: 'number', writable: true },
				{ id: 'epic', label: 'Epic', type: 'option', writable: true, items: true },
				{ id: 'start', label: 'Start', type: 'date', writable: true },
				{ id: 'end', label: 'End', type: 'date', writable: true },
			],
			items: [
				{ id: 'e1', title: 'Autumn harvest' },
				{ id: 'e2', title: 'Winter pruning' },
				{ id: 'a', title: 'Pick the Bramleys', ripeness: 'green', crates: 4, epic: 'e1', start: '2027-09-01', end: '2027-09-05' },
				{ id: 'b', title: 'Pick the Cox', ripeness: 'ripe', crates: 2.5, epic: 'e1', start: '2027-09-08', end: '2027-09-10' },
				{ id: 'c', title: 'Press for juice', ripeness: 'ripe', crates: 3, epic: 'e1', start: '2027-09-13', end: '2027-09-28' },
				{ id: 'd', title: 'Sharpen the saws', epic: 'e2', start: '2027-11-02', end: '2027-11-03' },
				{ id: 'f', title: 'Prune the old row', epic: 'e2', start: '2027-11-08', end: '2027-11-30' },
				{ id: 'm', title: 'Cider day', epic: 'e1', end: '2027-10-02', milestone: true },
			],
		}))
		await toucan('new', C, '--plan', 'file', file, '--views', 'gantt')
		await j('plan', 'view', 'set', 'gantt', '--group-by', 'epic', '--rollup', 'count,sum:crates')
		const token = JSON.parse(readFileSync(join(home, '.config/toucan/server.json'), 'utf8')).token
		const context = await human.newContext({ viewport: { width: 1500, height: 950 } })
		const page = await context.newPage()
		await page.goto(`http://127.0.0.1:${port}/?canvas=${C}#token=${token}`)
		await page.waitForFunction(() => window.toucan?.get('plan:gantt:summary:e1'), null, { timeout: 30000 })
		const synced = () => until('the plan to settle', async () => (await j('plan')).state === 'synced')
		await synced()
		const seen = await page.evaluate(() => {
			const { editor, toucan } = window
			const b = (k) => editor.getShapePageBounds(toucan.get(k))
			const bad = toucan.measure().findings.filter((f) => ['overlap', 'text outgrew its box', 'cut off by its frame'].includes(f.kind))
			return { lanes: ['e1', 'e2'].map((e) => toucan.text(toucan.get(`plan:gantt:lane:${e}`))), summary: [b('plan:gantt:summary:e1').x, b('plan:gantt:summary:e1').maxX], first: b('plan:gantt:item:a').x, last: b('plan:gantt:item:c').maxX, milestone: toucan.get('plan:gantt:item:m').props.geo, bad }
		})
		assert.deepEqual(seen.lanes, ['Autumn harvest (4, 9.5 crates)', 'Winter pruning (2, 0 crates)'], 'a lane per parent, with what its children add up to')
		assert.ok(seen.summary[0] === seen.first && seen.summary[1] >= seen.last, 'the summary bar spans its children')
		assert.deepEqual([seen.milestone, seen.bad], ['diamond', []])
		if (shots) await toucan('--canvas', C, 'screenshot', join(shots, 'gantt-by-parent.png'), '--keys', 'plan:gantt', '--max', '2400')
		const before = readFileSync(join(data, `${C}.files`, 'orchard.plan.json'), 'utf8')
		await page.evaluate(() => {
			const s = window.toucan.get('plan:gantt:summary:e1')
			window.editor.updateShape({ id: s.id, type: 'geo', x: s.x + 200 })
		})
		await sleep(1500)
		await synced()
		assert.equal(readFileSync(join(data, `${C}.files`, 'orchard.plan.json'), 'utf8'), before, 'the summary bar is not a handle: dragging it writes nothing')
		assert.equal(await page.evaluate(() => window.editor.getShapePageBounds(window.toucan.get('plan:gantt:summary:e1')).x), seen.summary[0], 'and it goes back')
		await context.close()
		// A file plan copied in never lands on one that's already there; and the plan routes answer a body that isn't JSON with why.
		const kept = readFileSync(join(data, `${C}.files`, 'orchard.plan.json'), 'utf8')
		await toucan('--canvas', C, 'plan', 'bind', 'file', file, '--copy')
		assert.equal(readFileSync(join(data, `${C}.files`, 'orchard.plan.json'), 'utf8'), kept, 'the plan already there is untouched')
		assert.equal((await j('plan')).source.ref, 'files/orchard-2.plan.json')
		const bad = await fetch(`http://127.0.0.1:${port}/api/canvases/${C}/plan/views`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: '{"kind": "board"' })
		assert.deepEqual([bad.status, /isn't JSON/.test((await bad.json()).error)], [400, true])
		step('a gantt grouped by parent: a lane per parent with a roll-up, headed by a bar spanning its children, drawn soundly; the bar is not a handle')
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
