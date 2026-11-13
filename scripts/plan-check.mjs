// Plans (lib/plan.mjs, server/sources.mjs): the catalog of views and what it refuses, a render that is the same every
// time and sound for every kind, the inverse that reads a person's gestures back as field changes, the built-in file
// source, and an adapter on PATH speaking the protocol. No browser and no server: scripts/plan-e2e.mjs has those.
//   node scripts/plan-check.mjs
import assert from 'node:assert/strict'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as P from '../lib/plan.mjs'
import { createSources } from '../server/sources.mjs'
import { ask, createPlugins, scan } from '../server/plugins.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ok = (msg) => console.log(`ok  ${msg}`)
const example = () => P.checkPlan(JSON.parse(readFileSync(join(ROOT, 'examples/website-relaunch.plan.json'), 'utf8')))
const plan = example()
const TODAY = '2026-11-20'
const draw = (view, opts = {}) => P.render(plan, view, { origin: { x: 100, y: 60 }, today: TODAY, ...opts })
const clone = (x) => structuredClone(x)

// ---- the catalog ----------------------------------------------------------------------------------------------------------
{
	const errors = (spec, p = plan) => P.validateView(spec, p).errors
	assert.match(errors({ kind: 'kanban' })[0], /unknown view kind "kanban"; kinds: board, gantt, timeline, graph, table/)
	assert.match(errors({ kind: 'board', group: 'stage' })[0], /a board view has no option "group"; options: .*groupBy/)
	assert.match(errors({ kind: 'board', groupBy: 'start' })[0], /groupBy "start" is a date field; groupBy takes an option field: stage, assignee, priority/)
	assert.match(errors({ kind: 'board', groupBy: 'owner' })[0], /doesn't have; option fields: stage, assignee, priority/)
	assert.match(errors({ kind: 'board', fields: ['owner'] })[0], /fields names the field "owner".*fields: title, stage/)
	assert.match(errors({ kind: 'gantt', scale: 'year' })[0], /scale "year" isn't one of auto, day, week, month/)
	assert.match(errors({ kind: 'gantt', from: '12/01/2026' })[0], /from takes a date as YYYY-MM-DD/)
	assert.match(errors({ kind: 'gantt', from: '2026-12-10', to: '2026-12-01' })[0], /is after/)
	assert.match(errors({ kind: 'gantt', dependencies: 'yes' })[0], /dependencies takes true or false/)
	assert.match(errors({ kind: 'board', filter: { stage: 'nope' } })[0], /stage has no option "nope"; options: todo \(To do\)/)
	assert.match(errors({ kind: 'board', filter: { field: 'stage', op: 'like', value: 'x' } })[0], /filter op "like" isn't one of eq, ne, in, contains, lt, gt, exists/)
	assert.match(errors({ kind: 'board', sort: ['-nope'] })[0], /sort names the field "nope"/)
	assert.match(errors({ kind: 'board', id: 'my view' })[0], /id "my view": letters, digits/)
	assert.match(errors({ kind: 'timeline' }, P.checkPlan({ plan: 1, items: [] }))[0], /a timeline view needs date, and this plan has no date field/)
	assert.match(errors({ kind: 'board' }, P.checkPlan({ plan: 1, items: [] }))[0], /a board view needs groupBy/)
	assert.deepEqual(errors({ kind: 'gantt', groupBy: 'none' }), [], '"none" is a lane choice')
	const good = P.validateView({ kind: 'board', id: 'b', groupBy: 'assignee', filter: 'stage!=done and title~page', sort: 'priority,-end', fields: 'assignee,end' }, plan)
	assert.ok(good.ok, good.errors.join('; '))
	assert.deepEqual(good.view, { kind: 'board', id: 'b', groupBy: 'assignee', filter: { and: [{ field: 'stage', op: 'ne', value: 'done' }, { field: 'title', op: 'contains', value: 'page' }] }, sort: ['priority', '-end'], fields: ['assignee', 'end'] })
	// The text agents read comes from the same schema, so it can't name something the validator refuses.
	const text = P.catalogText()
	for (const [kind, k] of Object.entries(P.KINDS)) {
		assert.ok(text.includes(`${kind}: `), `the catalog describes ${kind}`)
		for (const option of Object.keys(k.options)) assert.ok(text.includes(`  ${option} (`), `the catalog describes ${kind}.${option}`)
	}
	assert.equal(P.freeViewId('board', [{ id: 'board' }, { id: 'board-2' }]), 'board-3')
	ok('catalog: unknown kinds, options, fields and values are refused with what would be right')
}

// ---- filter and sort ------------------------------------------------------------------------------------------------------
{
	const ids = (view) => P.select(plan, view).map((it) => it.id)
	assert.equal(ids({}).join(), plan.items.map((it) => it.id).join(), 'no sort: the source\'s own order')
	assert.ok(ids({ filter: { done: false } }).every((id) => plan.items.find((it) => it.id === id).stage !== 'done'))
	assert.deepEqual(ids({ filter: 'stage=review' }), ['voice', 'wireframes'])
	assert.deepEqual(ids({ filter: 'stage in review,doing and assignee=ada' }), ['voice', 'copy-home'])
	assert.deepEqual(ids({ filter: { or: [{ field: 'title', op: 'contains', value: 'launch' }, { field: 'end', op: 'lt', value: '2026-11-05' }] } }), ['goals', 'rehearsal', 'launch'])
	assert.deepEqual(ids({ filter: '!assignee' }), ['legal', 'press', 'retire'])
	assert.deepEqual(ids({ filter: 'labels~design and start>2026-12-01' }), ['pricing-design', 'a11y'])
	assert.deepEqual(ids({ filter: 'stage=doing', sort: ['-end'] }), ['home-design', 'design-system', 'copy-home', 'scaffold'])
	assert.deepEqual(ids({ filter: 'stage=doing', sort: 'priority,assignee' }), ['copy-home', 'home-design', 'design-system', 'scaffold'], 'options sort in option order, then the next key')
	assert.throws(() => P.parseFilter('a=1 and b=2 or c=3'), /not both/)
	ok('filter and sort: shorthand, the full form, text on the command line, option order')
}

// ---- render ---------------------------------------------------------------------------------------------------------------
const VIEWS = [
	{ id: 'b', kind: 'board', fields: ['assignee', 'end'] },
	{ id: 'b2', kind: 'board', groupBy: 'assignee', color: 'priority', filter: { done: false } },
	{ id: 'g', kind: 'gantt', groupBy: 'assignee', dependencies: true },
	{ id: 'g2', kind: 'gantt', scale: 'day', from: '2026-11-02', to: '2026-12-06' },
	{ id: 'g3', kind: 'gantt', scale: 'month' },
	{ id: 't', kind: 'timeline' },
	{ id: 'd', kind: 'graph' },
	{ id: 'tb', kind: 'table' },
]
{
	for (const view of VIEWS) {
		assert.deepEqual(P.validateView(view, plan).errors, [])
		const tg = await draw(view)
		assert.deepEqual(await draw(view), tg, `${view.id}: the same plan and view give the same graph`)
		const groups = new Map(tg.groups.map((g) => [g.key, g]))
		const root = groups.get(`plan:${view.id}`)
		assert.ok(root && root.box.x === 100 && root.box.y === 60, `${view.id}: one frame, at the origin`)
		const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h
		for (const g of tg.groups) {
			assert.ok(g.meta.plan.view === view.id, 'every frame is managed')
			if (g !== root) assert.ok(g.parent === root.key && inside(g.box, root.box), `${view.id}: ${g.key} is inside the view`)
		}
		const keys = new Set()
		for (const n of tg.nodes) {
			assert.ok(!keys.has(n.key), `${view.id}: ${n.key} once`)
			keys.add(n.key)
			assert.ok(n.key.startsWith(`plan:${view.id}:`) && n.meta.plan.view === view.id, `${view.id}: ${n.key} is managed`)
			assert.ok(inside(n.box, groups.get(n.group).box), `${view.id}: ${n.key} is inside ${n.group}`)
			assert.ok(n.box.w > 0 && n.box.h > 0)
		}
		// Nothing with text overlaps or crowds anything else with text (what toucan.measure() checks on the canvas).
		const solid = tg.nodes.filter((n) => n.text.trim() && n.box.w >= 30 && n.box.h >= 30)
		for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) {
			const a = solid[i].box, b = solid[j].box
			const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w)), dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h))
			assert.ok(Math.hypot(dx, dy) >= 12, `${view.id}: ${solid[i].key} and ${solid[j].key} are apart`)
		}
		const cards = tg.nodes.filter((n) => n.meta.plan.item && !n.meta.plan.field)
		const shown = P.select(plan, P.resolveView(view, plan)).filter((it) => view.kind !== 'timeline' || it.end)
		assert.equal(cards.length, shown.length, `${view.id}: a card per item shown`)
		for (const c of cards) {
			const item = plan.items.find((it) => it.id === c.meta.plan.item)
			assert.deepEqual(c.meta.plan, { item: item.id, view: view.id, version: item.version })
			assert.ok(c.text.split('\n').length <= 2, 'a title and at most one more line')
			assert.ok(c.meta.detail.includes('Stage: '), 'the record is in the detail')
		}
		for (const e of tg.edges) assert.ok(keys.has(e.from) && keys.has(e.to) && e.meta.plan.view === view.id)
	}
	const board = await draw(VIEWS[0])
	assert.deepEqual(board.groups.slice(1).map((g) => [g.key, g.label]), [['plan:b:col:todo', 'To do (15)'], ['plan:b:col:doing', 'In progress (4)'], ['plan:b:col:review', 'In review (2)'], ['plan:b:col:done', 'Done (4)']], 'a column per option, in option order')
	const sitemap = board.nodes.find((n) => n.key === 'plan:b:sitemap')
	assert.equal(sitemap.text, '✓ Draft the sitemap\nAda · Nov 13')
	assert.deepEqual([sitemap.style.color, sitemap.style.fill, sitemap.group], ['grey', 'none', 'plan:b:col:done'], 'a finished item is muted')
	assert.equal(board.nodes.find((n) => n.key === 'plan:b:scaffold').style.color, 'blue', 'colour from the stage')
	const byOwner = await draw(VIEWS[1])
	assert.equal(byOwner.groups.at(-1).label, 'No owner (3)', 'unset values get a column only when there are some')
	assert.equal(byOwner.nodes.find((n) => n.key === 'plan:b2:home-design').style.color, 'red', 'colour from another field')

	const gantt = await draw(VIEWS[2])
	const axis = gantt.groups[0].meta.plan.axis
	assert.deepEqual(axis, { from: '2026-11-02', ppd: 16, x0: 40 }, 'the axis starts on a Monday; what inverts it is on the frame')
	assert.ok(gantt.nodes.some((n) => n.key === 'plan:g:axis:2026-11-16' && n.text === 'Nov 16'), 'header boxes keyed by date')
	assert.ok(gantt.nodes.some((n) => n.key === 'plan:g:today' && n.text === 'Today'), 'a today marker')
	const bar = gantt.nodes.find((n) => n.key === 'plan:g:migrate-blog')
	assert.equal(bar.box.x, 100 + 40 + 42 * 16, 'a bar starts at its start date')
	assert.equal(bar.group, 'plan:g:lane:linus')
	assert.equal(gantt.nodes.find((n) => n.key === 'plan:g:launch').style.geo, 'diamond', 'a milestone is a diamond')
	assert.equal(gantt.nodes.find((n) => n.key === 'plan:g:press').group, 'plan:g:unscheduled', 'no dates: unscheduled')
	assert.ok(gantt.edges.some((e) => e.from === 'plan:g:templates' && e.to === 'plan:g:migrate-blog'), 'dependency arrows')
	assert.equal((await draw(VIEWS[3])).groups[0].meta.plan.axis.ppd, 40)
	assert.ok((await draw(VIEWS[4])).nodes.some((n) => n.text === 'Nov 2026'))
	const dates = (await draw(VIEWS[5])).nodes.map((n) => plan.items.find((it) => it.id === n.meta.plan.item).end)
	assert.deepEqual(dates, [...dates].sort(), 'a timeline is in date order')
	const table = await draw(VIEWS[7])
	assert.equal(table.nodes.find((n) => n.key === 'plan:tb:legal:f:assignee').text, '—')
	assert.equal(table.nodes.find((n) => n.key === 'plan:tb:legal:f:start').text, 'Jan 4, 2027')
	// An engine without frames in frames: columns stand on their own.
	const flat = await draw(VIEWS[0], { nest: false })
	assert.ok(!flat.groups.some((g) => g.key === 'plan:b') && flat.groups.every((g) => !g.parent) && flat.nodes.every((n) => n.group?.startsWith('plan:b:col:')))
	assert.deepEqual(P.originsOf(flat).b, { x: 100, y: 60 }, 'the view\'s origin is still known from any of its frames')
	ok('render: every kind is deterministic, keyed, inside its frames, and nothing overlaps')
}

// ---- the inverse: gestures as field changes -------------------------------------------------------------------------------
{
	const node = (tg, key) => tg.nodes.find((n) => n.key === key)
	const group = (tg, key) => tg.groups.find((g) => g.key === key)
	const view = { id: 'b', kind: 'board' }
	const before = await draw(view)
	const moved = (f) => {
		const after = clone(before)
		f(after)
		return P.changesFrom(plan, view, before, after)
	}
	assert.deepEqual(moved(() => {}), [], 'nothing moved, nothing to write')
	// A card dropped into another column, between two cards there.
	const into = (after, key, col, y) => Object.assign(node(after, key), { group: col }, { box: { ...node(after, key).box, x: group(after, col).box.x + 30, y } })
	const review = before.nodes.filter((n) => n.group === 'plan:b:col:review')
	assert.deepEqual(moved((a) => into(a, 'plan:b:scaffold', 'plan:b:col:review', review[0].box.y + 20)), [{ op: 'update', id: 'scaffold', version: 1, set: { stage: 'review' }, place: { after: 'voice' } }])
	// …or at the end, where the source's order would put it anyway: just the field.
	assert.deepEqual(moved((a) => into(a, 'plan:b:redirects', 'plan:b:col:done', 5000)), [{ op: 'update', id: 'redirects', version: 1, set: { stage: 'done' } }])
	// Dropped on a column without the engine reparenting it: its position says where it is.
	assert.deepEqual(moved((a) => Object.assign(node(a, 'plan:b:voice'), { group: 'plan:b', box: { ...node(a, 'plan:b:voice').box, x: group(a, 'plan:b:col:doing').box.x + 40, y: group(a, 'plan:b:col:doing').box.y + 900 } }))[0].set, { stage: 'doing' })
	// Up its own column: placed after the card now above it; to the top: before the card now below it.
	const doing = before.nodes.filter((n) => n.group === 'plan:b:col:doing')
	assert.deepEqual(doing.map((n) => n.meta.plan.item), ['design-system', 'home-design', 'scaffold', 'copy-home'])
	assert.deepEqual(moved((a) => (node(a, 'plan:b:copy-home').box.y = doing[0].box.y + 10)), [{ op: 'update', id: 'copy-home', version: 1, place: { after: 'design-system' } }])
	assert.deepEqual(moved((a) => (node(a, 'plan:b:copy-home').box.y = doing[0].box.y - 10)), [{ op: 'update', id: 'copy-home', version: 1, place: { after: 'wireframes' } }], 'top of the column: just before what was first there')
	assert.deepEqual(moved((a) => (node(a, 'plan:b:copy-home').box.y += 3)), [], 'a nudge is not a move')
	assert.deepEqual(P.changesFrom(plan, { ...view, sort: ['end'] }, await draw({ ...view, sort: ['end'] }), (() => {
		const a = clone(before)
		node(a, 'plan:b:copy-home').box.y = doing[0].box.y - 10
		return a
	})()).filter((c) => c.place), [], 'a sorted view has no order to change')
	// Text.
	assert.deepEqual(moved((a) => (node(a, 'plan:b:sitemap').text = '✓ Draft the site map')), [{ op: 'update', id: 'sitemap', version: 1, set: { title: 'Draft the site map' } }])
	const withFields = { id: 'b', kind: 'board', fields: ['assignee'] }
	const drawn = await draw(withFields)
	const edited = clone(drawn)
	node(edited, 'plan:b:voice').text = 'Write the tone guide\nAda'
	assert.deepEqual(P.changesFrom(plan, withFields, drawn, edited), [{ op: 'update', id: 'voice', version: 1, set: { title: 'Write the tone guide' } }], 'the second line is not part of the title')
	// A box someone drew in a column.
	const made = moved((a) => a.nodes.push({ key: 'xYz12', text: 'Book the photographer', group: 'plan:b:col:todo', box: { x: group(a, 'plan:b:col:todo').box.x + 30, y: 5000, w: 200, h: 80 }, style: { geo: 'rectangle' } }))
	assert.deepEqual(made, [{ op: 'create', set: { title: 'Book the photographer', stage: 'todo' }, place: { after: 'retire' }, shape: 'xYz12' }])
	assert.deepEqual(moved((a) => a.nodes.push({ key: 'n1', text: 'a sticky', group: 'plan:b:col:todo', box: { x: 0, y: 0, w: 200, h: 200 }, style: { geo: 'note' } })), [], 'a sticky note is a message, not an item')
	assert.deepEqual(moved((a) => a.nodes.push({ key: 'c1', text: 'a copy', group: 'plan:b:col:todo', box: { x: 0, y: 0, w: 200, h: 80 }, style: { geo: 'rectangle' }, meta: { plan: null } })), [], 'a released copy of a card is not a new item')
	// What changes nothing upstream.
	assert.deepEqual(moved((a) => a.nodes.splice(a.nodes.findIndex((n) => n.key === 'plan:b:sitemap'), 1)), [], 'a deleted card is not a change')
	assert.deepEqual(moved((a) => {
		for (const x of [...a.groups, ...a.nodes]) (x.box.x += 700), (x.box.y -= 300)
	}), [], 'moving the whole view moves nothing in it')
	assert.deepEqual(moved((a) => (node(a, 'plan:b:sitemap').style.color = 'red')), [])
	const readonly = { ...plan, source: { ...plan.source, readonly: true } }
	const drop = clone(before)
	into(drop, 'plan:b:scaffold', 'plan:b:col:review', 5000)
	assert.deepEqual(P.changesFrom(readonly, view, before, drop), [], 'nothing is written to a read-only source')
	const locked = { ...plan, fields: plan.fields.map((f) => (f.id === 'stage' ? { ...f, writable: false } : f)) }
	assert.deepEqual(P.changesFrom(locked, view, before, drop).filter((c) => c.set), [], 'nor to a field that can\'t be written')
	ok('inverse, board: column, order, title, a drawn box; and what means nothing')

	const gv = { id: 'g', kind: 'gantt', groupBy: 'assignee' }
	const g0 = await draw(gv)
	const ppd = g0.groups[0].meta.plan.axis.ppd
	const gm = (f) => {
		const after = clone(g0)
		f(after)
		return P.changesFrom(plan, gv, g0, after)
	}
	assert.deepEqual(gm((a) => (node(a, 'plan:g:templates').box.x += 3 * ppd + 5)), [{ op: 'update', id: 'templates', version: 1, set: { start: '2026-12-03', end: '2026-12-14' } }], 'a bar moved shifts both dates, to whole days')
	assert.deepEqual(gm((a) => (node(a, 'plan:g:templates').box.w += 4 * ppd)), [{ op: 'update', id: 'templates', version: 1, set: { end: '2026-12-15' } }], 'stretched on the right: the end')
	assert.deepEqual(gm((a) => {
		const b = node(a, 'plan:g:templates').box
		b.x -= 2 * ppd
		b.w += 2 * ppd
	}), [{ op: 'update', id: 'templates', version: 1, set: { start: '2026-11-28' } }], 'stretched on the left: the start')
	assert.deepEqual(gm((a) => (node(a, 'plan:g:templates').box.y += 30)), [], 'up or down within its lane means nothing')
	assert.deepEqual(gm((a) => Object.assign(node(a, 'plan:g:templates'), { group: 'plan:g:lane:ada' }).box.y -= 400), [{ op: 'update', id: 'templates', version: 1, set: { assignee: 'ada' } }], 'another lane: the grouped field')
	assert.deepEqual(gm((a) => (node(a, 'plan:g:launch').box.x += 2 * ppd)), [{ op: 'update', id: 'launch', version: 1, set: { end: '2027-01-16' } }], 'a milestone moves its one date')
	// The whole chart moved, and one lane moved inside it: bars are read relative to their own frame.
	assert.deepEqual(gm((a) => {
		for (const x of [...a.groups, ...a.nodes]) x.box.x += 333
		for (const x of [group(a, 'plan:g:lane:linus'), ...a.nodes.filter((n) => n.group === 'plan:g:lane:linus')]) x.box.x += 50
	}), [])
	const lane = group(g0, 'plan:g:lane:grace').box
	const dropped = gm((a) => Object.assign(node(a, 'plan:g:press'), { group: 'plan:g:lane:grace', box: { x: 100 + 40 + 20 * ppd + 3, y: lane.y + 20, w: 220, h: 70 } }))
	assert.deepEqual(dropped, [{ op: 'update', id: 'press', version: 1, set: { start: '2026-11-22', end: '2026-11-22', assignee: 'grace' } }], 'out of Unscheduled onto the chart: that day, that lane')
	assert.deepEqual(gm((a) => Object.assign(node(a, 'plan:g:templates'), { group: 'plan:g:unscheduled' })), [{ op: 'update', id: 'templates', version: 1, set: { start: null, end: null } }], 'back to Unscheduled: no dates')
	assert.deepEqual(gm((a) => (node(a, 'plan:g:axis:2026-11-16').box.x += 90)), [], 'the axis is not an item')
	ok('inverse, gantt: move, stretch, lane, milestone, unscheduled; frames moved change nothing')

	const tv = { id: 'tb', kind: 'table' }
	const t0 = await draw(tv)
	const tm = (f) => {
		const after = clone(t0)
		f(after)
		return P.changesFrom(plan, tv, t0, after)
	}
	assert.deepEqual(tm((a) => (node(a, 'plan:tb:legal:f:assignee').text = 'grace')), [{ op: 'update', id: 'legal', version: 1, set: { assignee: 'grace' } }])
	assert.deepEqual(tm((a) => {
		node(a, 'plan:tb:legal:f:stage').text = 'In review'
		node(a, 'plan:tb:legal:f:end').text = '2027-01-09'
		node(a, 'plan:tb:legal').text = 'Legal review'
	}), [{ op: 'update', id: 'legal', version: 1, set: { title: 'Legal review', stage: 'review', end: '2027-01-09' } }], 'one change per item, however many cells')
	assert.deepEqual(tm((a) => (node(a, 'plan:tb:legal:f:stage').text = 'whenever')), [], 'text that isn\'t a value of the field changes nothing')
	assert.deepEqual(tm((a) => (node(a, 'plan:tb:audit:f:assignee').text = '')), [{ op: 'update', id: 'audit', version: 1, set: { assignee: null } }], 'an emptied cell clears the field')
	ok('inverse, table: a cell\'s text is its field\'s value')

	// What to take away: an item that left the view goes; a copy someone made of a card stays, as an ordinary box.
	const now = clone(before)
	now.nodes.push({ ...clone(node(before, 'plan:b:voice')), key: 'copyOfVoice' })
	const fewer = await P.render({ ...plan, items: plan.items.filter((it) => it.id !== 'audit') }, view, { origin: { x: 100, y: 60 }, today: TODAY })
	assert.deepEqual(P.leftovers(now, fewer), { remove: ['plan:b:audit'], release: ['copyOfVoice'] })
	assert.ok(P.sameObserved(before, clone(before)) && !P.sameObserved(before, fewer))
	const taller = clone(before)
	taller.nodes[3].box.h += 40
	assert.ok(P.sameObserved(before, taller), 'a box grown to fit its text is not an edit')
	ok('leftovers: only managed shapes, and a person\'s copy is released, not removed')
}

// ---- a plan with fields of its own: nothing in the machinery knows a fixed list --------------------------------------------
{
	const custom = P.checkPlan({
		plan: 1,
		source: { title: 'Orchard', managedBy: 'someone else' },
		fields: [
			{ id: 'title', label: 'Title', type: 'text', writable: true },
			{ id: 'ripeness', label: 'Ripeness', type: 'option', writable: true, extra: 'ignored', options: [{ id: 'green', label: 'Green', color: 'light-green' }, { id: 'ripe', label: 'Ripe', color: 'red' }, { id: 'picked', label: 'Picked', color: 'grey', done: true }] },
			{ id: 'row', label: 'Row', type: 'option', writable: true, options: [{ id: 'r1', label: 'Row one' }, { id: 'r2', label: 'Row two' }] },
			{ id: 'crates', label: 'Crates', type: 'number', writable: true },
			{ id: 'epic', label: 'Epic', type: 'option', writable: true, items: true },
			{ id: 'from', label: 'From', type: 'date', writable: true },
		],
		items: [
			{ id: 'e1', title: 'Autumn harvest', status: 'open' },
			{ id: 'a', title: 'Bramley', ripeness: 'green', row: 'r1', crates: 4, epic: 'e1', start: '2027-09-01', end: '2027-09-05', status: 'open' },
			{ id: 'b', title: 'Cox', ripeness: 'ripe', row: 'r1', crates: 2.5, epic: 'e1', start: '2027-09-08', end: '2027-09-10' },
			{ id: 'c', title: 'Russet', ripeness: 'ripe', row: 'r2', crates: 3, epic: 'e1', start: '2027-09-04', end: '2027-09-12' },
			{ id: 'd', title: 'Pippin', ripeness: 'picked', row: 'r2', crates: 6 },
		],
	})
	assert.deepEqual(P.fieldOf(custom, 'epic').options, [{ id: 'e1', label: 'Autumn harvest' }], 'a field whose options are items lists the items pointed at')
	assert.equal(custom.items[1].status, 'open', 'what a source adds to an item is kept')
	const view = { id: 'o', kind: 'board', groupBy: 'ripeness', lanes: 'row', fields: ['crates'], rollup: ['count', 'sum:crates', 'done'], filter: 'epic=e1 or ripeness=picked' }
	assert.deepEqual(P.validateView(view, custom).errors, [])
	assert.match(P.validateView({ kind: 'board', rollup: 'sum:row' }, custom).errors[0], /rollup "sum:row": row is a option field; number fields: crates/)
	const tg = await P.render(custom, view, { today: '2027-09-02' })
	const node = (g, key) => g.nodes.find((n) => n.key === key)
	assert.deepEqual(tg.groups.slice(1).map((g) => g.label), ['Green (1, 4 crates, 0% done)', 'Ripe (2, 5.5 crates, 0% done)', 'Picked (1, 6 crates, 100% done)'], 'columns from a field never seen before, each with what it adds up to')
	assert.deepEqual(tg.nodes.filter((n) => n.meta.plan.lane !== undefined).map((n) => n.text), ['Row one (2, 6.5 crates, 0% done)', 'Row two (2, 9 crates, 50% done)'], 'and rows from another')
	assert.equal(node(tg, 'plan:o:b').text, 'Cox\n2.5', 'a number field on the card')
	assert.equal(node(tg, 'plan:o:b').style.color, 'black', 'no stage to colour by, so none')
	assert.ok(node(tg, 'plan:o:c').box.y > node(tg, 'plan:o:b').box.y + 60 && node(tg, 'plan:o:c').group === node(tg, 'plan:o:b').group, 'same column, the row below')
	// Dragged to another column, in the other row: both fields.
	const after = clone(tg)
	const picked = after.groups.find((g) => g.key === 'plan:o:col:picked')
	Object.assign(node(after, 'plan:o:a'), { group: picked.key, box: { ...node(after, 'plan:o:a').box, x: picked.box.x + 30, y: node(tg, 'plan:o:d').box.y + 100 } })
	const changes = P.changesFrom(custom, view, tg, after)
	assert.deepEqual(changes, [{ op: 'update', id: 'a', version: 1, set: { ripeness: 'picked', row: 'r2' }, place: { after: 'd' } }])
	// Down its own column into the other row: only the row.
	const down = clone(tg)
	node(down, 'plan:o:b').box.y = node(tg, 'plan:o:c').box.y + 100
	assert.deepEqual(P.changesFrom(custom, view, tg, down), [{ op: 'update', id: 'b', version: 1, set: { row: 'r2' }, place: { after: 'c' } }])
	// …and the file source's rules take the change, for fields it has never heard of either.
	const wrote = P.applyChanges(custom, [{ ...changes[0], mutation: 'm' }, { op: 'update', id: 'd', version: 1, mutation: 'n', set: { crates: 7, epic: 'a' }, place: { before: 'a' } }, { op: 'update', id: 'b', version: 1, mutation: 'o', set: { crates: 'many' } }])
	assert.deepEqual(wrote.results.map((r) => [r.ok, r.error ?? null]), [[true, null], [true, null], [false, 'invalid']])
	assert.deepEqual(wrote.plan.items.map((it) => it.id), ['e1', 'b', 'c', 'd', 'a'], 'placed after d, then d placed before a')
	assert.deepEqual([wrote.plan.items[4].ripeness, wrote.plan.items[4].row, wrote.plan.items[3].epic], ['picked', 'r2', 'a'], 'an item-valued field takes any item')
	// A gantt grouped by the item-valued field: a lane per parent, headed by a bar over its children, with a roll-up.
	const gv = { id: 'h', kind: 'gantt', groupBy: 'epic', rollup: ['sum:crates'] }
	const g = await P.render(custom, gv, { today: '2027-09-02' })
	const lane = g.groups.find((x) => x.key === 'plan:h:lane:e1')
	assert.equal(lane.label, 'Autumn harvest (9.5 crates)')
	const summary = g.nodes.find((n) => n.key === 'plan:h:summary:e1'), ppd = lane.meta.plan.axis.ppd
	assert.deepEqual([summary.box.x, summary.box.w], [node(g, 'plan:h:a').box.x, 12 * ppd], 'the summary bar runs from the first child\'s start to the last one\'s end')
	assert.deepEqual(P.select(custom, { sort: ['-crates'] }).map((it) => it.id), ['d', 'a', 'c', 'b', 'e1'], 'sorted by a number field, unset last')
	ok('custom fields: grouped on, laned, shown, summed, dragged and written back, with nothing knowing their names')
}

// ---- writing: the rules a source applies, and the file source -------------------------------------------------------------
const tmp = mkdtempSync(join(tmpdir(), 'toucan-plan-'))
try {
	const files = join(tmp, 'files'), bin = join(tmp, 'bin'), data = join(tmp, 'data')
	for (const d of [files, bin, data]) mkdirSync(d)
	const file = join(files, 'relaunch.plan.json')
	writeFileSync(file, readFileSync(join(ROOT, 'examples/website-relaunch.plan.json')))
	const src = createSources({ data, roots: () => [{ id: 'files', label: 'files', dir: files }], path: '' }).get('file')
	const REF = 'files/relaunch.plan.json'

	assert.deepEqual((await src.list('c')).map((s) => [s.ref, s.title]), [[REF, 'Website relaunch']])
	const first = await src.read(REF, 'c')
	assert.equal(first.items.length, 25)
	assert.equal(first.source.ref, REF)
	assert.deepEqual(await src.changes(REF, first.cursor, 'c'), { cursor: first.cursor, changed: false })
	await assert.rejects(src.read('files/nope.json', 'c'), (e) => e.code === 'not_found')
	await assert.rejects(src.read('files/../../etc/passwd', 'c'), (e) => e.code === 'invalid')
	await assert.rejects(src.read('elsewhere/x.json', 'c'), (e) => e.code === 'invalid')

	const w1 = await src.write(REF, [
		{ op: 'update', id: 'sitemap', version: 1, mutation: 'm1', set: { stage: 'review', end: '2026-11-17' }, place: { after: 'voice' } },
		{ op: 'create', mutation: 'm2', set: { title: 'Book the photographer', stage: 'todo' }, place: { after: null } },
		{ op: 'update', id: 'voice', version: 7, mutation: 'm3', set: { stage: 'done' } },
		{ op: 'update', id: 'audit', version: 1, mutation: 'm4', set: { stage: 'shipped' } },
		{ op: 'update', id: 'audit', version: 1, mutation: 'm5', set: { labels: ['content'] } },
		{ op: 'update', id: 'gone', version: 1, mutation: 'm6', set: { stage: 'done' } },
		{ op: 'update', id: 'legal', version: 1, mutation: 'm7', set: { assignee: null } },
	], 'c')
	assert.deepEqual(w1.results.map((r) => [r.mutation, r.ok, r.error ?? null]), [['m1', true, null], ['m2', true, null], ['m3', false, 'conflict'], ['m4', false, 'invalid'], ['m5', false, 'invalid'], ['m6', false, 'not_found'], ['m7', true, null]], 'each change stands alone')
	assert.deepEqual([w1.results[0].item.stage, w1.results[0].item.end, w1.results[0].item.version], ['review', '2026-11-17', 2])
	assert.equal(w1.results[2].item.version, 1, 'a conflict answers with the item as it stands')
	assert.match(w1.results[3].message, /stage has no option "shipped"; options: todo/)
	assert.match(w1.results[4].message, /labels can't be written/)
	assert.equal(w1.results[5].item, undefined)
	assert.notEqual(w1.cursor, first.cursor)
	assert.equal((await src.changes(REF, first.cursor, 'c')).changed, true)
	const second = await src.read(REF, 'c')
	assert.equal(second.cursor, w1.cursor)
	assert.equal(second.items[0].title, 'Book the photographer', 'placed first')
	assert.equal(second.items[second.items.findIndex((it) => it.id === 'voice') + 1].id, 'sitemap', 'placed after voice')
	assert.ok(!('assignee' in second.items.find((it) => it.id === 'legal')), 'null clears')
	// The same change again: the same answer, and nothing written twice.
	const w2 = await src.write(REF, [{ op: 'update', id: 'sitemap', version: 1, mutation: 'm1', set: { stage: 'review', end: '2026-11-17' } }, { op: 'create', mutation: 'm2', set: { title: 'Book the photographer' } }, { op: 'update', id: 'voice', version: 7, mutation: 'm3', set: { stage: 'done' } }], 'c')
	assert.deepEqual(w2.results.map((r) => [r.ok, r.error ?? null, r.item?.version]), [[true, null, 2], [true, null, 1], [false, 'conflict', 1]])
	assert.equal(w2.cursor, w1.cursor, 'a replay leaves the file as it was')
	assert.equal((await src.read(REF, 'c')).items.length, 26)
	const onDisk = JSON.parse(readFileSync(file, 'utf8'))
	assert.equal(onDisk.source.description.slice(0, 9), 'A made-up', 'what the file said stays')
	// A read-only file refuses everything.
	writeFileSync(file, JSON.stringify({ ...onDisk, source: { ...onDisk.source, readonly: true } }))
	assert.deepEqual((await src.write(REF, [{ op: 'update', id: 'audit', version: 1, mutation: 'm9', set: { stage: 'todo' } }], 'c')).results.map((r) => r.error), ['forbidden'])
	writeFileSync(file, '{"plan": 2, "items": []}')
	await assert.rejects(src.read(REF, 'c'), /"plan" is 2; this toucan reads "plan": 1/)
	ok('file source: read, cursor, write per change, conflict, invalid, idempotent on mutation, read-only')

	// ---- plugins: an adapter on PATH (the example people copy), and ones that aren't trusted --------------------------------
	const state = join(tmp, 'example-state.json')
	process.env.TOUCAN_SOURCE_EXAMPLE_FILE = state
	copyFileSync(join(ROOT, 'examples/toucan-source-example.mjs'), join(bin, 'toucan-source-example'))
	chmodSync(join(bin, 'toucan-source-example'), 0o755)
	// One that answers badly, to see every way of failing.
	writeFileSync(join(bin, 'toucan-source-broken'), `#!/usr/bin/env node
const [verb, ref] = process.argv.slice(2)
if (verb === 'describe') process.exit(3)
if (ref === 'down') { console.error('connection refused'); process.exit(2) }
if (ref === 'slow') setTimeout(() => {}, 60000)
else console.log('<html>')
`)
	chmodSync(join(bin, 'toucan-source-broken'), 0o755)
	writeFileSync(join(bin, 'toucan-source-noexec'), '')
	writeFileSync(join(bin, 'toucan-source-file'), '#!/bin/sh\n')
	chmodSync(join(bin, 'toucan-source-file'), 0o755)
	// Somewhere an agent could have put one, and a folder anyone can write to: found, and refused.
	const open = join(tmp, 'open'), later = join(tmp, 'later')
	for (const d of [join(data, 'bin'), open, later]) {
		mkdirSync(d)
		writeFileSync(join(d, d === later ? 'toucan-source-example' : 'toucan-source-planted'), '#!/bin/sh\necho {}\n')
		chmodSync(join(d, d === later ? 'toucan-source-example' : 'toucan-source-planted'), 0o755)
	}
	chmodSync(open, 0o777)
	const path = [bin, join(data, 'bin'), open, later, 'relative/bin', '/nonexistent'].join(delimiter)
	const plugins = createPlugins({ data, path, ttl: 0 })
	const found = await plugins.list()
	assert.deepEqual(found.kinds.map((k) => [k.kind, k.prefix]), [['profiles', 'toucan-profiles-'], ['source', 'toucan-source-']], 'every kind, whether or not it has plugins')
	const sourceKind = found.kinds.find((k) => k.kind === 'source')
	assert.deepEqual(sourceKind.plugins, [{ name: 'broken', path: join(bin, 'toucan-source-broken') }, { name: 'example', path: join(bin, 'toucan-source-example'), title: 'Example', description: 'A made-up plan source to copy from: two small projects kept in a JSON file.', version: '1' }], 'a plugin is listed with what it says of itself, or without')
	assert.deepEqual(sourceKind.refused.map((r) => [r.name, r.path.slice(tmp.length + 1), r.reason.replace(/ \(.*/, '').replace(tmp, '')]).sort(), [
		['example', 'later/toucan-source-example', '/bin/toucan-source-example comes first on PATH'],
		['file', 'bin/toucan-source-file', '"file" is the name of toucan\'s built-in one'],
		['noexec', 'bin/toucan-source-noexec', 'it isn\'t executable'],
		['planted', 'data/bin/toucan-source-planted', 'its folder is inside toucan\'s own folder or its data, where agents can write'],
		['planted', 'open/toucan-source-planted', 'its folder can be written to by other users'],
	], 'what was found but refused, and why')
	assert.deepEqual(scan({ data, path, kinds: ['profiles'] }), { found: [], refused: [] })

	const sources = createSources({ plugins, roots: () => [{ id: 'files', label: 'files', dir: files }] })
	writeFileSync(file, readFileSync(join(ROOT, 'examples/website-relaunch.plan.json')))
	const listed = await sources.list('c')
	assert.deepEqual(listed.map((s) => [s.name, s.kind, s.refs.map((r) => r.ref), !!s.error]), [['file', 'builtin', [REF], false], ['broken', 'command', [], true], ['example', 'command', ['demo/garden', 'demo/archive'], false]], 'the file source, and adapters; one that fails is reported without hiding the rest')
	assert.throws(() => sources.get('planted'), (e) => e.code === 'not_found' && /toucan-source-planted was found but not trusted: its folder/.test(e.message) && /toucan plugins/.test(e.message))
	assert.throws(() => sources.get('nowhere'), (e) => e.code === 'not_found' && /toucan looks for toucan-source-nowhere on PATH/.test(e.message))
	assert.throws(() => sources.get('../x'), (e) => e.code === 'invalid')
	const t = sources.get('example')
	const read = await t.read('demo/garden')
	assert.deepEqual([read.cursor, read.items.length, read.source.title], ['1', 6, 'Spring garden'])
	assert.deepEqual(await t.changes('demo/garden', '1'), { cursor: '1', changed: false })
	const wrote = await t.write('demo/garden', [{ op: 'update', id: 'g4', version: 1, mutation: 'a', set: { stage: 'doing' }, place: { after: null } }, { op: 'update', id: 'g5', version: 9, mutation: 'b', set: { stage: 'doing' } }, { op: 'create', mutation: 'c', set: { title: 'Water daily', bed: 'pots' } }])
	assert.deepEqual([wrote.cursor, wrote.results.map((r) => r.ok), wrote.results[0].item.stage, wrote.results[1].error, wrote.results[1].item.version, wrote.results[2].item.bed], ['2', [true, false, true], 'doing', 'conflict', 1, 'pots'])
	assert.deepEqual(await t.changes('demo/garden', '1'), { cursor: '2', changed: true })
	const again = await t.write('demo/garden', [{ op: 'update', id: 'g4', version: 1, mutation: 'a', set: { stage: 'doing' } }])
	assert.deepEqual([again.results[0].ok, again.results[0].item.version], [true, 2], 'the same mutation again is answered as before and written once')
	assert.equal((await t.read('demo/garden')).items[0].id, 'g4', 'placed first')
	assert.deepEqual((await t.write('demo/archive', [{ op: 'update', id: 'a1', version: 1, mutation: 'd', set: { stage: 'todo' } }])).results.map((r) => r.error), ['forbidden'])
	await assert.rejects(t.read('demo/nope'), (e) => e.code === 'not_found' && /no project demo\/nope/.test(e.message), 'its own code and words')
	const broken = sources.get('broken')
	await assert.rejects(broken.read('down'), (e) => e.code === 'unavailable' && /connection refused/.test(e.message), 'plain text on stderr is tolerated')
	await assert.rejects(broken.read('x'), (e) => e.code === 'invalid' && /didn't answer with JSON/.test(e.message))
	await assert.rejects(ask(join(bin, 'toucan-source-broken'), ['read', 'slow'], { timeout: 300 }), (e) => e.code === 'unavailable' && e.why === 'took too long')
	ok('plugins: found by kind under one trust rule, refusals with reasons, describe; the example adapter speaks the whole protocol')

	// The docs name what the catalog has.
	const guide = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8')
	for (const kind of Object.keys(P.KINDS)) assert.ok(new RegExp(`\\b${kind}\\b`).test(guide.slice(guide.indexOf('## Plans'))), `AGENTS.md describes the ${kind} view`)
	ok('AGENTS.md describes every kind of view')
} finally {
	rmSync(tmp, { recursive: true, force: true })
}
console.log('\nplan checks passed')
