// A canvas bound to a plan: which source it shows, the views drawn of it, and the sync between the two.
//
// The binding lives beside the canvas in <data>/NAME.plan.json:
//   { source: { name, ref }, views: [...], cursor, schema: { source, fields }, items (the last known upstream state),
//     rendered (what was last drawn, as lib/plan.mjs observes it), keys, pages, pending, own, skip, problems: [...], syncedAt }
//
// One sync per canvas runs here, on the server, so several open tabs never multiply writes. It does two things, in order,
// and never at once (everything for a canvas goes through one queue):
//   push: when the canvas no longer matches what was drawn, the difference is read as field changes (lib/plan.mjs
//         changesFrom) and written upstream, each quoting the version that was drawn. Whatever upstream answers, the views
//         are drawn again from upstream's state: a refused or conflicting change goes back, and the person is told.
//   pull: while a person has the canvas open (or when asked), `changes` is polled; when the cursor moves the plan is read
//         again and the views redrawn.
// A redraw touches only shapes carrying meta.plan. What someone is dragging or typing in at that moment is left out of
// both, and caught up with when they let go; everything else carries on.

import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { PlanError, cardKeys, changesFrom, checkPlan, coerceValue, diffObserved, fieldOf, freeViewId, leftovers, observe, originsOf, render, sameObserved, validateView, viewTitle } from '../lib/plan.mjs'
import { writeAtomic } from '../lib/paths.mjs'

const NAME = /^[a-z0-9][a-z0-9-_]{0,63}$/i
export const sidecarPath = (data, canvas) => join(data, `${canvas}.plan.json`)

const POLL_MS = Number(process.env.TOUCAN_PLAN_POLL ?? 4000)
const QUIET_MS = 450 // edits should have paused this long before the canvas is read: a drag changes the document many times a second
const QUIET_MAX = 3000 // …but someone drawing steadily elsewhere on the canvas doesn't hold a sync up for longer than this
const RETRY_MS = 300
const SETTLE_MS = 6000 // how long to wait to see a redraw arrive in the server's copy before taking the canvas as it is
const PAUSE_MS = 60000
const MAX_PROBLEMS = 20
const GAP = 200 // clear room between one view and the next, as `draw` leaves between drawings
// TOUCAN_PLAN_DEBUG=1: say on stderr what each sync saw, to find out why a canvas keeps being redrawn.
const debug = (canvas, what, lines) => process.env.TOUCAN_PLAN_DEBUG && console.error(`plan ${canvas}: ${what}${lines ? `\n  ${lines().slice(0, 12).join('\n  ')}` : ''}`)
const hex = () => randomUUID().replace(/-/g, '')

/** An observation with what people are in the middle of put back as it was drawn: a half-made gesture is nobody's change yet. */
function withoutBusy(now, base, busy) {
	if (!busy.size) return now
	const out = { ...now, frames: { ...now.frames }, nodes: { ...now.nodes }, loose: { ...now.loose } }
	const hold = (part, key) => {
		if (base?.[part]?.[key]) out[part][key] = base[part][key]
		else delete out[part][key]
	}
	for (const key of busy) {
		if (now.frames[key] || base?.frames?.[key]) hold('frames', key)
		if (now.nodes[key] || base?.nodes?.[key]) hold('nodes', key)
		delete out.loose[key]
	}
	// What's inside a frame that is being dragged is carried along with it.
	for (const [key, n] of Object.entries(now.nodes)) if (busy.has(n.g)) hold('nodes', key)
	for (const [key, n] of Object.entries(now.loose)) if (busy.has(n.g)) delete out.loose[key]
	return out
}

/**
 * `deps`: sources (server/sources.mjs); graphOf(canvas) → the whole canvas as a toucan graph; engineOf(canvas);
 * exec(canvas, code, { label, doing }) → runs in a tab or the headless page; people(canvas) → open tabs that are people;
 * canDraw(canvas) → is there, or can there be, a page to draw in; busy(canvas) → the keys of shapes people are dragging or
 * typing in right now; changedAt(canvas) → when the document last changed (ms); broadcast(canvas, msg).
 */
export function createPlans({ data, sources, graphOf, engineOf, exec, people, canDraw, busy = () => [], changedAt, broadcast, pollMs = POLL_MS }) {
	const bound = new Set(existsSync(data) ? readdirSync(data).map((f) => /^(.+)\.plan\.json$/.exec(f)?.[1]).filter((n) => n && NAME.test(n)) : [])
	// A binding that couldn't be read is put aside, and the person is told: canvas -> what to say. (Found again after a restart
	// by the file it was put aside as.)
	const unreadable = new Map()
	const BAD = /^(.+)\.plan\.json\.bad-[\w-]+$/
	const sayUnreadable = (canvas, file) => ({ id: 'binding', kind: 'binding', t: new Date().toISOString(), text: `This canvas's plan binding could not be read, so its plan views are not being kept in step. The file was kept as ${file}. To carry on, bind it again (\`toucan --canvas ${canvas} plan bind SOURCE REF\`, then add its views): the shapes already here are taken up by their keys.` })
	if (existsSync(data)) for (const f of readdirSync(data)) {
		const m = BAD.exec(f)
		if (m && NAME.test(m[1]) && !bound.has(m[1])) unreadable.set(m[1], sayUnreadable(m[1], f))
	}
	const live = new Map() // canvas -> { st, queue, poll, retry, settling, dirty, rev, error, working, churn, pausedUntil, waitingSince, pulledAt }

	const has = (canvas) => bound.has(canvas)
	function load(canvas) {
		if (!bound.has(canvas)) return null
		if (!live.has(canvas)) {
			let st
			try {
				st = JSON.parse(readFileSync(sidecarPath(data, canvas), 'utf8'))
				if (!st || typeof st !== 'object' || !st.source?.name) throw new Error('it has no source')
			} catch (e) {
				// Kept, not deleted: whoever looks into it wants the file. The canvas is no longer bound, and says why.
				const aside = `${canvas}.plan.json.bad-${new Date().toISOString().replace(/[:.]/g, '-')}`
				console.error(`plan of ${canvas}: ${e.message}; kept as ${aside}`)
				try {
					renameSync(sidecarPath(data, canvas), join(data, aside))
				} catch {}
				bound.delete(canvas)
				unreadable.set(canvas, sayUnreadable(canvas, aside))
				return null
			}
			live.set(canvas, { canvas, st: { views: [], problems: [], keys: {}, pages: {}, pending: {}, own: {}, skip: [], ...st }, queue: Promise.resolve(), dirty: true, rev: Date.now() % 1e9, churn: [] })
		}
		return live.get(canvas)
	}
	const save = (rt) => writeAtomic(sidecarPath(data, rt.canvas), JSON.stringify(rt.st, null, '\t') + '\n')
	const planOf = (rt) => (rt.st.items ? { plan: 1, source: rt.st.schema.source, fields: rt.st.schema.fields, items: rt.st.items, cursor: rt.st.cursor } : null)
	const need = (canvas) => {
		const rt = load(canvas)
		if (!rt) throw new PlanError('not_found', `${canvas} isn't bound to a plan: \`toucan --canvas ${canvas} plan bind SOURCE REF\` (see \`toucan sources\`)`)
		return rt
	}
	/** One thing at a time per canvas. */
	const queued = (rt, fn) => {
		const next = rt.queue.then(fn, fn)
		rt.queue = next.catch(() => {})
		return next
	}
	const busyNow = (canvas) => new Set(busy(canvas) ?? [])
	/** Boxes in a column that are never to become items: an agent's, a group that was pasted, one the source refused. */
	const skipping = (rt, keys) => (rt.st.skip = [...new Set([...rt.st.skip, ...keys])].slice(-400))

	// ---- what people are told ---------------------------------------------------------------------------------------------
	function status(canvas) {
		const rt = load(canvas)
		if (!rt) return { bound: false, ...(unreadable.has(canvas) && { problems: [unreadable.get(canvas)] }) }
		const { st } = rt
		const plan = planOf(rt)
		const wrong = st.problems.some((p) => p.kind !== 'created')
		// A redraw that has arrived is done, whoever asks first.
		if (rt.settling && !rt.working && (landed(canvas, rt.settling) || Date.now() - rt.settling.since > SETTLE_MS)) rt.settling = null
		// `state` is about the plan's data: read, and written, or not. Whether the views on the canvas show it yet is `drawn`:
		// with nobody at the canvas and no page to draw in, the data is current and the drawing waits.
		const drawn = !!st.rendered && !rt.dirty && !rt.settling
		const state = rt.working ? 'syncing' : rt.error ? 'problem' : !st.items ? 'waiting' : rt.pausedUntil > Date.now() || wrong ? 'problem' : 'synced'
		// Something is left to draw and there is a page to draw it in: make sure someone is coming to do it.
		if (!drawn && !rt.working && !rt.retrying && st.items && canDraw(canvas) && !(rt.pausedUntil > Date.now())) later(rt, 200)
		return {
			bound: true,
			source: { name: st.source.name, ref: st.source.ref, title: st.schema?.source?.title ?? st.source.ref, readonly: !!st.schema?.source?.readonly },
			state,
			drawn,
			...(rt.error && { error: rt.error }),
			...(!drawn && st.items && !canDraw(canvas) && { waiting: 'the views are drawn when someone opens the canvas' }),
			cursor: st.cursor ?? null,
			syncedAt: st.syncedAt ?? null,
			items: st.items?.length ?? 0,
			views: st.views.map((v) => ({ ...v, ...(plan && { title: viewTitle(v, plan) }) })),
			fields: (st.schema?.fields ?? []).map((f) => ({ id: f.id, label: f.label, type: f.type, writable: !!f.writable, ...(f.options && { options: f.options }) })),
			problems: st.problems,
		}
	}
	const announce = (rt) => broadcast(rt.canvas, { type: 'plan', plan: status(rt.canvas) })
	function problem(rt, p) {
		rt.st.problems = [...rt.st.problems, { id: randomUUID().slice(0, 8), t: new Date().toISOString(), ...p }].slice(-MAX_PROBLEMS)
	}

	// ---- pull -------------------------------------------------------------------------------------------------------------
	async function pull(rt, force = false) {
		const { st } = rt
		rt.pulledAt = Date.now()
		try {
			const source = sources.get(st.source.name)
			if (!force && st.items) {
				const r = await source.changes(st.source.ref, st.cursor ?? '', rt.canvas)
				if (!r.changed) {
					rt.error = null
					st.syncedAt = new Date().toISOString()
					return false
				}
			}
			const plan = await source.read(st.source.ref, rt.canvas)
			const before = JSON.stringify([st.schema, st.items])
			st.schema = { source: plan.source, fields: plan.fields }
			st.items = plan.items
			st.cursor = plan.cursor
			st.syncedAt = new Date().toISOString()
			rt.error = null
			if (JSON.stringify([st.schema, st.items]) !== before) rt.dirty = true
			save(rt)
			return true
		} catch (e) {
			rt.error = `${st.source.name}: ${e.message ?? e}`
			return false
		}
	}

	// ---- push -------------------------------------------------------------------------------------------------------------
	const titleOf = (rt, id) => rt.st.items?.find((it) => it.id === id)?.title ?? id
	/** Did we ourselves take this item from `drawn` to `version`, write by write, with nobody else's change in between? */
	function ownChain(rt, id, drawn, version) {
		const writes = rt.st.own[id] ?? []
		for (let cur = version, n = 0; n < 12; n++) {
			const w = writes.find((x) => String(x.to) === String(cur))
			if (!w) return false
			if (String(w.from) === String(drawn)) return true
			cur = w.from
		}
		return false
	}

	/** The changes between two observations, across every view: one per item, however many views showed the gesture. */
	function collect(rt, base, now, fresh) {
		const plan = planOf(rt)
		const byItem = new Map(), creates = new Map(), order = []
		const skip = new Set(rt.st.skip)
		for (const view of rt.st.views) {
			if (!validateView(view, plan).ok) continue
			for (const c of changesFrom(plan, view, base, now)) {
				if (c.op === 'note') {
					if (!rt.st.problems.some((p) => p.kind === 'unread' && p.text === c.message)) problem(rt, { kind: 'unread', ...(c.id && { item: c.id, title: titleOf(rt, c.id) }), text: c.message })
				} else if (c.op === 'create') {
					if (!skip.has(c.shape) && !creates.has(c.shape)) creates.set(c.shape, { ...c, view: view.id })
				} else {
					const have = byItem.get(c.id)
					if (!have) byItem.set(c.id, { ...c, ...(c.set && { set: { ...c.set } }) })
					else {
						if (c.set) have.set = { ...have.set, ...c.set }
						if (c.place) have.place = c.place
					}
					// Places build on each other in the order a view gave them (lib/plan.mjs): keep that order across views.
					if (c.place) (order.includes(c.id) && order.splice(order.indexOf(c.id), 1), order.push(c.id))
				}
			}
		}
		// Several boxes arriving in columns in one go were pasted or duplicated, not drawn: they stay ordinary boxes.
		if (creates.size > 1) {
			skipping(rt, creates.keys())
			problem(rt, { kind: 'created', text: `${creates.size} boxes arrived in the board at once, so they were left as ordinary boxes. Draw one at a time to add items.` })
			creates.clear()
		}
		const updates = []
		for (const c of byItem.values()) {
			const { drawn, ...change } = c
			// A shape carrying an older version than was drawn has been put back by undo or redo. That is the person's to do when
			// nothing else touched the item since their own edit; when something did, their old value would overwrite it, so it isn't written.
			if (!fresh && drawn !== undefined && String(drawn) !== String(c.version) && !ownChain(rt, c.id, drawn, c.version)) {
				problem(rt, { kind: 'stale', item: c.id, title: titleOf(rt, c.id), text: `"${titleOf(rt, c.id)}" has changed upstream since that edit, so undoing it changed nothing there. Showing the upstream version.` })
				continue
			}
			updates.push({ ...change, version: fresh ? plan.items.find((it) => it.id === c.id)?.version ?? c.version : c.version })
		}
		const at = (c) => (c.place ? order.indexOf(c.id) : -1)
		return [...updates.sort((p, q) => at(p) - at(q)), ...creates.values()]
	}

	const sayRefusal = (title, error, message) =>
		error === 'conflict' ? `"${title}" changed upstream; showing the upstream version.`
		: error === 'not_found' ? `"${title}" is no longer in the plan.`
		: error === 'forbidden' ? `"${title}" can't be changed from here${message ? `: ${message}` : ''}. Put back as it is upstream.`
		: error === 'unavailable' ? `Couldn't reach the plan to save "${title}"${message ? `: ${message}` : ''}. Put back as it is upstream.`
		: `"${title}": ${message || 'the change was refused'}. Put back as it is upstream.`

	/**
	 * A gesture's idempotency key: made once, kept in the binding until the source gives a definite answer, so a write that
	 * timed out is tried again under the same key (after a restart too) and is applied once.
	 */
	function mutationFor(rt, c) {
		const sig = c.op === 'create' ? `create|${c.shape}` : `update|${c.id}|${c.version}|${JSON.stringify([c.set ?? null, c.place ?? null])}`
		const pending = rt.st.pending
		for (const [k, p] of Object.entries(pending)) if (Date.now() - p.t > 7 * 86400000) delete pending[k]
		pending[sig] ??= { mutation: hex(), t: Date.now() }
		return { sig, mutation: pending[sig].mutation }
	}

	/**
	 * Writes changes upstream and takes in what it answers. `gesture`: they were read off the canvas (so their keys are kept
	 * until answered, and what happened is told to the people at it); otherwise someone asked, and the answer is theirs.
	 */
	async function write(rt, changes, { gesture = false } = {}) {
		const { st } = rt
		const sent = changes.map((c) => ({ ...c, ...(gesture ? mutationFor(rt, c) : { mutation: hex() }) }))
		if (gesture) save(rt)
		const wire = sent.map(({ shape, view, sig, ...c }) => c)
		const label = (c) => (c.op === 'create' ? c.set?.title ?? 'New item' : titleOf(rt, c.id))
		let answer
		for (let attempt = 0; ; attempt++) {
			try {
				answer = await sources.get(st.source.name).write(st.source.ref, wire, rt.canvas)
				break
			} catch (e) {
				if (e.code === 'unavailable' && attempt < 2) {
					await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
					continue
				}
				// Nobody knows whether it was applied. The keys stay, so the same gesture made again asks under the same key.
				for (const c of sent) if (!c.shape) problem(rt, { kind: e.code ?? 'unavailable', ...(c.id && { item: c.id }), title: label(c), text: sayRefusal(label(c), e.code ?? 'unavailable', e.message) })
				if (sent.some((c) => c.shape) && !st.problems.some((p) => p.kind === 'unavailable' && p.create)) problem(rt, { kind: 'unavailable', create: true, text: `Couldn't reach the plan to add ${sent.filter((c) => c.shape).map((c) => `"${label(c)}"`).join(', ')}: ${e.message}. It will be tried again.` })
				rt.dirty = true
				return sent.map((c) => ({ mutation: c.mutation, ok: false, error: e.code ?? 'unavailable', message: String(e.message ?? e) }))
			}
		}
		const byMutation = new Map(answer.results.map((r) => [r?.mutation, r]))
		const results = sent.map((c, i) => byMutation.get(c.mutation) ?? answer.results[i] ?? { mutation: c.mutation, ok: false, error: 'unavailable', message: 'the source gave no answer for this change' })
		sent.forEach((c, i) => {
			const r = results[i]
			if (c.sig && !(r.ok === false && r.error === 'unavailable')) delete st.pending[c.sig]
			if (r.ok) {
				if (c.shape && r.item?.id !== undefined) {
					// A box someone drew became an item: from now on it is that item's card.
					;(st.keys[c.view] ??= {})[String(r.item.id)] = c.shape
					skipping(rt, [c.shape]) // whatever happens next, this box is never made into an item a second time
					const where = st.schema?.source?.title ?? st.source.ref
					problem(rt, { kind: 'created', item: String(r.item.id), title: r.item.title, text: `Added "${r.item.title ?? label(c)}" to ${where}. To take it back, remove it in ${where} itself: deleting its card here doesn't.` })
				}
				if (gesture && c.op === 'update' && r.item) st.own[c.id] = [...(st.own[c.id] ?? []), { from: c.version, to: r.item.version }].slice(-12)
			} else {
				problem(rt, { kind: r.error ?? 'invalid', ...(c.id && { item: c.id }), title: r.item?.title ?? label(c), text: sayRefusal(r.item?.title ?? label(c), r.error, r.message) })
				if (c.shape && r.error !== 'unavailable') skipping(rt, [c.shape])
			}
			// Until the plan is read again, this is the best account of upstream there is.
			if (r.item && st.items) {
				const at = st.items.findIndex((it) => it.id === String(r.item.id))
				if (at >= 0) st.items[at] = r.item
				else st.items.push(r.item)
			} else if (!r.ok && r.error === 'not_found' && c.id && st.items) st.items = st.items.filter((it) => it.id !== c.id)
		})
		for (const id of Object.keys(st.own)) if (!st.items?.some((it) => it.id === id)) delete st.own[id]
		if (answer.cursor !== null && answer.cursor !== undefined) st.cursor = answer.cursor
		rt.dirty = true
		// A write can change other items too (a reorder ranks its neighbours), and someone else may have written in between: read it all.
		await pull(rt, true)
		save(rt)
		return results
	}

	// ---- draw -------------------------------------------------------------------------------------------------------------
	async function draw(rt, hold = new Set()) {
		const { st, canvas } = rt
		const plan = planOf(rt)
		if (!plan) return
		const current = graphOf(canvas)
		const now = observe(current)
		const origins = originsOf(now)
		// Which box is each item's card: the canvas says, so a box a person drew that became an item stays that item's card
		// whatever happens to the binding.
		const keys = cardKeys(now, st.keys)
		// …and one that has just become an item, and doesn't carry the item yet, is the one the write remembered.
		const present = new Set((current.nodes ?? []).map((n) => n.key))
		for (const [view, map] of Object.entries(st.keys)) for (const [item, key] of Object.entries(map)) if (present.has(key) && !keys[view]?.[item]) (keys[view] ??= {})[item] = key
		const nest = engineOf(canvas) !== 'excalidraw'
		const full = { tg: 1, groups: [], nodes: [], edges: [] }
		const kept = new Set() // views that can't be drawn just now: their shapes stay as they are
		// Somewhere clear for a view that isn't on the canvas yet: under the plan's other views, else right of everything.
		const boxes = [...(current.groups ?? []), ...(current.nodes ?? [])].map((x) => x.box).filter(Boolean)
		const managed = Object.values(now.frames)
		let fresh = managed.length ? { x: Math.min(...managed.map((f) => f.x)), y: Math.max(...managed.map((f) => f.y + f.h)) + GAP } : boxes.length ? { x: Math.max(...boxes.map((b) => b.x + b.w)) + 240, y: Math.min(...boxes.map((b) => b.y)) } : { x: 0, y: 0 }
		let added = false
		// Views are the plan's own, so one that grows down into another moves that other one down, as long as it is still where
		// it was put: a view a person moved is theirs to place, and then the overlap stands and is said.
		const placed = [] // { id, box } of the views drawn so far, top to bottom
		const boxOf = (tg) => {
			const all = [...tg.groups, ...tg.nodes].map((x) => x.box)
			const x = Math.min(...all.map((b) => b.x)), y = Math.min(...all.map((b) => b.y))
			return { x, y, w: Math.max(...all.map((b) => b.x + b.w)) - x, h: Math.max(...all.map((b) => b.y + b.h)) - y }
		}
		const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
		// (Nothing recorded, as after a binding was made again: taken as where it was put.)
		const whereItWasPut = (id) => !!origins[id] && (!st.placed?.[id] || (Math.abs(st.placed[id].x - origins[id].x) < 2 && Math.abs(st.placed[id].y - origins[id].y) < 2))
		st.placed ??= {}
		for (const view of [...st.views].sort((a, b) => (origins[a.id]?.y ?? Infinity) - (origins[b.id]?.y ?? Infinity))) {
			const check = validateView(view, plan)
			if (!check.ok) {
				kept.add(view.id)
				if (!st.problems.some((p) => p.kind === 'view' && p.view === view.id)) problem(rt, { kind: 'view', view: view.id, text: `The ${view.id} view no longer fits the plan: ${check.errors.join('; ')}` })
				continue
			}
			// (On the 10 px grid the renderer draws on, so where a view is put is exactly where it is found.)
			const grid = (o) => ({ x: Math.round(o.x / 10) * 10, y: Math.round(o.y / 10) * 10 })
			let tg, at = grid(origins[view.id] ?? fresh)
			const isNew = !origins[view.id]
			try {
				tg = await render(plan, view, { origin: at, keys: keys[view.id], nest, titlesInBars: nest })
				const over = placed.filter((p) => hits(boxOf(tg), p.box))
				if (over.length && (isNew || whereItWasPut(view.id))) {
					at = grid({ x: at.x, y: Math.max(...over.map((p) => p.box.y + p.box.h)) + GAP })
					tg = await render(plan, view, { origin: at, keys: keys[view.id], nest, titlesInBars: nest })
					st.problems = st.problems.filter((p) => !(p.kind === 'overlap' && p.view === view.id))
				} else if (over.length) {
					if (!st.problems.some((p) => p.kind === 'overlap' && p.view === view.id)) problem(rt, { kind: 'overlap', view: view.id, text: `The ${over[0].id} view has grown into the ${view.id} view below it. That one was moved by hand, so it is left where it is: move it clear.` })
				} else st.problems = st.problems.filter((p) => !(p.kind === 'overlap' && p.view === view.id))
			} catch (e) {
				kept.add(view.id)
				problem(rt, { kind: 'view', view: view.id, text: `Couldn't draw the ${view.id} view: ${e.message}` })
				continue
			}
			const box = boxOf(tg)
			placed.push({ id: view.id, box })
			if (isNew || whereItWasPut(view.id) || !st.placed[view.id]) {
				// Where the sync itself put it: while it is still there, it is the sync's to move.
				if (isNew || whereItWasPut(view.id)) st.placed[view.id] = { x: at.x, y: at.y }
			}
			if (isNew) {
				added = true
				fresh = { x: fresh.x, y: box.y + box.h + GAP }
			}
			full.groups.push(...tg.groups)
			full.nodes.push(...tg.nodes)
			full.edges.push(...tg.edges)
		}
		const want = observe(full)
		const inKept = (o) => kept.has(o?.plan?.view)
		for (const [key, f] of Object.entries(now.frames)) if (inKept(f)) want.frames[key] = f
		for (const [key, n] of Object.entries(now.nodes)) if (inKept(n)) want.nodes[key] = n
		// What someone has hold of is left as it is, and the record of what was drawn keeps what was drawn for it.
		const held = (o, key) => hold.has(key) || hold.has(o?.g)
		const baseline = () => {
			if (!hold.size) return want
			const out = { ...want, frames: { ...want.frames }, nodes: { ...want.nodes } }
			for (const part of ['frames', 'nodes']) {
				for (const key of new Set([...Object.keys(want[part]), ...Object.keys(st.rendered?.[part] ?? {})])) {
					if (!held(want[part][key] ?? st.rendered[part][key], key)) continue
					if (st.rendered?.[part]?.[key]) out[part][key] = st.rendered[part][key]
					else delete out[part][key]
				}
			}
			return out
		}
		if (sameObserved(withoutBusy(now, want, hold), want, { loose: false })) {
			st.rendered = baseline()
			rt.dirty = hold.size > 0 && !sameObserved(now, want, { loose: false })
			save(rt)
			return
		}
		const found = leftovers(now, want)
		const release = found.release.filter((key) => !hold.has(key))
		// A view that can't be drawn keeps its arrows too.
		const remove = found.remove.filter((key) => !hold.has(key) && ![...kept].some((id) => key.startsWith(`edge:plan:${id}:`)))
		const rev = ++rt.rev
		debug(canvas, `redrawing (${remove.length} to remove, ${release.length} to release${hold.size ? `, ${hold.size} held` : ''})`, () => diffObserved(now, want))
		// Where the server saw each box when it decided this. A tab that finds one of its boxes somewhere else has an edit the
		// server hasn't heard of yet (a drop made a moment ago): it leaves that box alone and says so, and the edit is read first.
		const seen = Object.fromEntries(Object.entries(now.nodes).filter(([, n]) => !n.r).map(([key, n]) => [key, [n.g ?? '', n.x, n.y, n.w].join('|')]))
		const r = await exec(canvas, `return await toucan._planRender(${JSON.stringify({ tg: full, remove, release, rev, reveal: added, skip: [...hold], pages: st.pages, seen })})`, { label: 'Plan sync', doing: `syncing ${plan.source.title}` })
		// The tab knows better than the server what its person has hold of right now.
		for (const key of r?.skipped ?? []) hold.add(key)
		if (r?.pages) st.pages = { ...st.pages, ...r.pages }
		st.rendered = baseline()
		rt.settling = { rev, since: Date.now(), frames: full.groups.length > 0 }
		rt.dirty = hold.size > 0
		save(rt)
	}

	/** Has the redraw numbered `rev` reached the server's copy of the canvas? Its last act was to write that number on a frame. */
	const landed = (canvas, settling) => {
		if (!settling.frames) return Date.now() - settling.since > 1200
		return (graphOf(canvas).groups ?? []).some((g) => g.meta?.planRev === settling.rev)
	}

	// ---- the loop ---------------------------------------------------------------------------------------------------------
	function later(rt, ms = RETRY_MS) {
		clearTimeout(rt.retry)
		rt.retrying = true
		rt.retry = setTimeout(() => ((rt.retrying = false), reconcile(rt.canvas).catch(() => {})), ms)
		rt.retry.unref?.()
	}

	/** Brings canvas and plan together: reads the plan if asked, writes what people changed, redraws what is out of date. */
	function reconcile(canvas, { pull: doPull = false, force = false } = {}) {
		const rt = load(canvas)
		if (!rt) return Promise.resolve()
		return queued(rt, async () => {
			if (!bound.has(canvas)) return
			rt.working = true
			try {
				if (doPull || !rt.st.items) {
					const was = rt.error
					const moved = await pull(rt, force)
					if (moved || was !== rt.error) announce(rt)
				}
				if (!rt.st.items) return
				if (!canDraw(canvas)) return // the views are drawn when someone opens the canvas
				// Paused, after a canvas kept changing with nothing in it to save: the plan is still read, the canvas is left alone.
				if (force) rt.pausedUntil = 0
				if (rt.pausedUntil > Date.now()) return
				// Mid-drag the document changes many times a second: wait for a pause, but not for ever.
				if (Date.now() - changedAt(canvas) < QUIET_MS && Date.now() - (rt.waitingSince ??= Date.now()) < QUIET_MAX) return void later(rt)
				rt.waitingSince = null
				if (rt.settling) {
					if (landed(canvas, rt.settling) || Date.now() - rt.settling.since > SETTLE_MS) rt.settling = null
					else return void later(rt)
				}
				// What people did since the last redraw, as changes upstream. A second look catches a gesture made while the first was being written.
				let hold = busyNow(canvas)
				let base = rt.resetting ? null : rt.st.rendered
				for (let round = 0; base && round < 3; round++) {
					hold = busyNow(canvas)
					const now = withoutBusy(observe(graphOf(canvas)), base, hold)
					const creating = planOf(rt).source.readonly !== true && fieldOf(planOf(rt), 'title')?.writable === true
					if (sameObserved(now, base, { loose: creating, skip: rt.st.skip })) break
					const told = rt.st.problems.length
					const changes = collect(rt, base, now, round > 0)
					debug(canvas, `the canvas differs from what was drawn (${changes.length} change${changes.length === 1 ? '' : 's'} to write)`, () => diffObserved(base, now))
					// A canvas that keeps drifting from what was drawn, with nothing in it to save (a script fighting the sync, a fault
					// here), mustn't be redrawn for ever. It is left alone for a while, what was drawn stays the record, and what kept
					// differing is written down.
					const t = Date.now()
					rt.churn = changes.length || rt.st.problems.length > told ? [] : [...rt.churn.filter((x) => t - x < 20000), t]
					if (rt.churn.length > 12) {
						rt.churn = []
						rt.pausedUntil = t + PAUSE_MS
						problem(rt, { kind: 'churn', text: 'The plan\'s views keep changing on the canvas with nothing in the changes to save, so syncing the canvas is paused for a minute (Sync now starts it again).', detail: diffObserved(base, now).slice(0, 8) })
						save(rt)
						return void later(rt, PAUSE_MS + 100)
					}
					if (changes.length) await write(rt, changes, { gesture: true })
					rt.dirty = true
					base = now
					if (!changes.length) break
					for (let i = 0; i < 10 && Date.now() - changedAt(canvas) < QUIET_MS; i++) await new Promise((r) => setTimeout(r, 150))
				}
				if (rt.dirty || !rt.st.rendered) {
					await draw(rt, busyNow(canvas))
					// Something was left out because someone had hold of it: come back for it.
					if (rt.dirty) later(rt, 700)
				}
			} catch (e) {
				// No page to draw in (no tab, no headless mode) isn't a problem with the plan: it waits for someone to open the canvas.
				if (!/no browser tab|no open tab|headless page/.test(String(e.message))) rt.error = String(e.message ?? e)
			} finally {
				rt.working = false
				announce(rt)
			}
		})
	}

	function startPolling(rt) {
		if (rt.poll || pollMs <= 0) return
		rt.poll = setInterval(() => {
			if (!bound.has(rt.canvas) || !people(rt.canvas)) {
				clearInterval(rt.poll)
				rt.poll = null
				return
			}
			if (!rt.working) reconcile(rt.canvas, { pull: true }).catch(() => {})
		}, pollMs)
		rt.poll.unref?.()
	}

	/** A person opened the canvas: sync it now, and keep polling while they're there. */
	function opened(canvas) {
		const rt = load(canvas)
		if (!rt) return
		startPolling(rt)
		reconcile(canvas, { pull: true }).catch(() => {})
	}
	/** The canvas's document changed: once it's quiet, see whether that was someone editing a view. */
	function touched(canvas) {
		if (!bound.has(canvas)) return
		const rt = load(canvas)
		if (rt) later(rt, QUIET_MS + 30)
	}
	/**
	 * The canvas is about to be put back to an earlier version. What it will hold is old drawings of the plan, not anyone's
	 * edits: nothing of it is written, and the views are drawn again from upstream.
	 */
	function reset(canvas) {
		const rt = load(canvas)
		if (!rt) return
		// From this moment nothing on the canvas is read as an edit; and in the queue, so a sync already under way finishes with
		// what it had before this one's clean slate is laid down.
		rt.resetting = true
		queued(rt, async () => {
			rt.st.rendered = null
			rt.st.own = {}
			rt.settling = null
			rt.dirty = true
			rt.resetting = false
			save(rt)
		})
		later(rt, QUIET_MS + 30)
	}
	/** Shapes an agent's run (an exec, an import, a routine) added: a box among them in a board column is an annotation, not an item. */
	function agentAdded(canvas, keys) {
		if (!bound.has(canvas) || !keys?.length) return
		const rt = load(canvas)
		if (!rt) return
		skipping(rt, keys.filter((k) => typeof k === 'string' && !k.startsWith('plan:')))
		save(rt)
	}

	// ---- what the CLI and the app ask for ---------------------------------------------------------------------------------
	async function bind(canvas, { name, ref, views = [] }) {
		if (typeof ref !== 'string' || !ref) throw new PlanError('invalid', 'plan bind SOURCE REF: name what to show (`toucan sources` lists what each source has)')
		const source = sources.get(name)
		const plan = await source.read(ref, canvas)
		const st = { binding: 1, source: { name, ref }, views: [], cursor: plan.cursor, schema: { source: plan.source, fields: plan.fields }, items: plan.items, rendered: null, keys: {}, pages: {}, pending: {}, own: {}, skip: [], problems: [], syncedAt: new Date().toISOString() }
		const had = load(canvas)
		if (had) {
			// Bound again, to this or another plan: the views stay, as far as they still fit, and so does what is known of the canvas.
			st.views = had.st.views.filter((v) => validateView(v, plan).ok)
			st.pages = had.st.pages
			st.placed = had.st.placed ?? {}
			st.skip = had.st.skip
			if (had.st.source.name === name && had.st.source.ref === ref) Object.assign(st, { keys: had.st.keys, pending: had.st.pending })
			clearTimeout(had.retry)
			clearInterval(had.poll)
			live.delete(canvas)
		}
		for (const spec of views) {
			const v = checked({ id: freeViewId(spec.kind, st.views), ...spec }, plan)
			st.views = [...st.views.filter((x) => x.id !== v.id), v]
		}
		writeAtomic(sidecarPath(data, canvas), JSON.stringify(st, null, '\t') + '\n')
		bound.add(canvas)
		unreadable.delete(canvas)
		const rt = load(canvas)
		if (people(canvas)) startPolling(rt)
		await reconcile(canvas)
		return status(canvas)
	}

	function checked(spec, plan) {
		const { ok, errors, view } = validateView(spec, plan)
		if (!ok) throw new PlanError('invalid', errors.join('\n'))
		return view
	}
	const releasing = (keys, rev = 0) => `return await toucan._planRender(${JSON.stringify({ tg: { groups: [], nodes: [], edges: [] }, remove: [], release: keys, rev })})`
	const managedKeys = (canvas, view) => {
		const tg = graphOf(canvas), now = observe(tg)
		const mine = (o) => view === undefined || o.plan?.view === view
		return [...Object.entries(now.frames).filter(([, f]) => mine(f)).map(([k]) => k), ...Object.entries(now.nodes).filter(([, n]) => mine(n)).map(([k]) => k), ...(tg.edges ?? []).filter((e) => e.meta?.plan?.view && (view === undefined || e.meta.plan.view === view)).map((e) => `edge:${e.from}->${e.to}`)]
	}

	/** Lets go of the plan. What was drawn stays on the canvas, as ordinary shapes. */
	async function unbind(canvas) {
		const rt = need(canvas)
		return queued(rt, async () => {
			const keys = managedKeys(canvas)
			if (keys.length) {
				try {
					await exec(canvas, releasing(keys), { label: 'Plan unbound', doing: 'letting go of the plan' })
				} catch (e) {
					throw new PlanError('unavailable', `the canvas has to be open to unbind it, so its ${keys.length} plan shapes can be left as ordinary ones: ${e.message}`)
				}
			}
			clearTimeout(rt.retry)
			clearInterval(rt.poll)
			live.delete(canvas)
			bound.delete(canvas)
			rmSync(sidecarPath(data, canvas), { force: true })
			broadcast(canvas, { type: 'plan', plan: { bound: false } })
			return { ok: true, left: keys.length }
		})
	}

	/** Adds a view, or replaces the one with its id. */
	async function putView(canvas, spec) {
		const rt = need(canvas)
		const plan = planOf(rt)
		const view = checked({ ...spec, id: spec?.id ?? freeViewId(spec?.kind, rt.st.views) }, plan)
		await queued(rt, async () => {
			const at = rt.st.views.findIndex((v) => v.id === view.id)
			if (at >= 0) rt.st.views[at] = view
			else rt.st.views.push(view)
			rt.st.problems = rt.st.problems.filter((p) => !(p.kind === 'view' && p.view === view.id))
			rt.dirty = true
			save(rt)
		})
		await reconcile(canvas)
		return { view, plan: status(canvas) }
	}
	/** Changes some options of a view; null takes an option away. */
	async function setView(canvas, id, patch) {
		const rt = need(canvas)
		const have = rt.st.views.find((v) => v.id === id)
		if (!have) throw new PlanError('not_found', `no view "${id}"; views: ${rt.st.views.map((v) => v.id).join(', ') || 'none yet'}`)
		const next = { ...have, ...patch, id }
		for (const [k, v] of Object.entries(next)) if (v === null) delete next[k]
		return putView(canvas, next)
	}
	async function removeView(canvas, id, { keep = false } = {}) {
		const rt = need(canvas)
		if (!rt.st.views.some((v) => v.id === id)) throw new PlanError('not_found', `no view "${id}"; views: ${rt.st.views.map((v) => v.id).join(', ') || 'none yet'}`)
		await queued(rt, async () => {
			if (keep) {
				const keys = managedKeys(canvas, id)
				if (keys.length) {
					try {
						await exec(canvas, releasing(keys), { label: `Plan view ${id} kept`, doing: 'leaving a view as ordinary shapes' })
					} catch (e) {
						throw new PlanError('unavailable', `the canvas has to be open to keep the view's shapes: ${e.message}`)
					}
					rt.settling = { rev: -1, since: Date.now(), frames: false }
				}
			}
			rt.st.views = rt.st.views.filter((v) => v.id !== id)
			delete rt.st.pages[id]
			// What the other views were drawn as still stands; this one's shapes are no longer anyone's edits to read.
			if (rt.st.rendered) {
				for (const part of ['frames', 'nodes']) for (const [key, o] of Object.entries(rt.st.rendered[part])) if (o.plan?.view === id) delete rt.st.rendered[part][key]
				rt.st.rendered.edges = rt.st.rendered.edges.filter((key) => !key.startsWith(`edge:plan:${id}:`))
			}
			rt.dirty = true
			save(rt)
		})
		await reconcile(canvas)
		return status(canvas)
	}

	/**
	 * An agent's (or the Details card's) changes, through the same write as a person's gesture: [{ op, id?, set, place? }], where
	 * `set` values may be text as typed (an option by its label). Returns the source's results.
	 */
	async function change(canvas, changes) {
		const rt = need(canvas)
		const results = await queued(rt, async () => {
			await pull(rt, !rt.st.items)
			const plan = planOf(rt)
			if (!plan) throw new PlanError('unavailable', rt.error ?? 'the plan hasn\'t been read yet')
			if (plan.source.readonly) throw new PlanError('forbidden', `${plan.source.title} is read-only`)
			const wire = (Array.isArray(changes) ? changes : []).map((c) => {
				const set = {}
				for (const [k, v] of Object.entries(c.set ?? {})) {
					const field = fieldOf(plan, k)
					if (!field) throw new PlanError('invalid', `no field "${k}"; fields: ${plan.fields.map((f) => f.id).join(', ')}`)
					if (!field.writable) throw new PlanError('invalid', `${k} can't be written; writable fields: ${plan.fields.filter((f) => f.writable).map((f) => f.id).join(', ')}`)
					set[k] = typeof v === 'string' && field.type !== 'text' ? coerceValue(plan, k, v) : v
				}
				if (c.op === 'create') return { op: 'create', set, ...(c.place && { place: c.place }) }
				const item = plan.items.find((it) => it.id === String(c.id))
				if (!item) throw new PlanError('not_found', `no item "${c.id}" in ${plan.source.title}; \`plan items\` lists them`)
				return { op: 'update', id: item.id, version: c.version ?? item.version, ...(Object.keys(set).length && { set }), ...(c.place && { place: c.place }) }
			})
			if (!wire.length) throw new PlanError('invalid', 'nothing to change')
			const before = rt.st.problems.length
			const out = await write(rt, wire)
			// Whoever asked gets the refusal as their answer; it isn't also news for people at the canvas.
			rt.st.problems = rt.st.problems.slice(0, before)
			save(rt)
			return out
		})
		await reconcile(canvas)
		return { results, plan: status(canvas) }
	}

	async function sync(canvas) {
		need(canvas)
		await reconcile(canvas, { pull: true, force: true })
		// A redraw reaches the server's copy a moment after the tab reports it: wait for that, so what's read next is current.
		const rt = live.get(canvas)
		for (let i = 0; rt?.settling && i < 40; i++) {
			await new Promise((r) => setTimeout(r, 100))
			if (landed(canvas, rt.settling)) break
		}
		return status(canvas)
	}
	/**
	 * Before someone reads the plan from here (`plan`, `plan items`): ask the source whether it moved, and read it again if so,
	 * so what they are told is not what was true when a tab was last open. The redraw can wait for a page; the answer doesn't.
	 */
	async function fresh(canvas) {
		const rt = load(canvas)
		if (!rt) return
		// Asked, and waited for: whoever reads next reads what this found. (Two reads at once share one question.)
		rt.asking ??= reconcile(canvas, { pull: true }).finally(() => (rt.asking = null))
		await rt.asking
	}

	function items(canvas) {
		const rt = need(canvas)
		const plan = planOf(rt)
		if (!plan) throw new PlanError('unavailable', rt.error ?? 'the plan hasn\'t been read yet: `plan sync`')
		return checkPlan(plan)
	}

	function dismiss(canvas, ids) {
		if (!bound.has(canvas) && unreadable.has(canvas)) {
			// Seen: the file put aside is renamed so the notice doesn't come back with the next restart.
			for (const f of readdirSync(data)) if (BAD.exec(f)?.[1] === canvas) renameSync(join(data, f), join(data, f.replace('.bad-', '.unreadable-')))
			unreadable.delete(canvas)
			broadcast(canvas, { type: 'plan', plan: { bound: false } })
			return { bound: false }
		}
		const rt = need(canvas)
		rt.st.problems = ids?.length ? rt.st.problems.filter((p) => !ids.includes(p.id)) : []
		save(rt)
		announce(rt)
		return status(canvas)
	}

	/** Lines for the chat agent's brief: what this canvas shows, and how to change it. */
	function brief(canvas) {
		const rt = load(canvas)
		if (!rt) return unreadable.has(canvas) ? [unreadable.get(canvas).text] : []
		const s = status(canvas)
		const views = s.views.map((v) => `${v.id} (${v.kind}${v.groupBy ? ` by ${v.groupBy}` : ''})`).join(', ') || 'none yet'
		const lines = [
			`This canvas shows a plan: "${s.source.title}" from the ${s.source.name} source (${s.source.ref})${s.source.readonly ? ', read-only' : ''}, ${s.items} items. Views: ${views}.`,
			'Shapes keyed plan:… are drawn from the plan and redrawn on every sync: never change them with `exec`, `import` or `draw`. Change the work with `plan set ITEM field=value` and `plan add --title T`, and the views with `plan view add|set|rm` (`plan catalog` has the options; `plan items` the data). Anything else on the canvas is yours and the person\'s as usual.',
		]
		if (!s.drawn) lines.push('The views on the canvas are not yet drawn from the plan as it now is: `plan items` has the current data.')
		if (s.error) lines.push(`The plan can't be reached just now: ${s.error}`)
		for (const p of s.problems.filter((x) => x.kind !== 'created').slice(-5)) lines.push(`Plan problem: ${p.text}`)
		return lines
	}

	/** The canvas is being archived: its binding goes with it. */
	function forget(canvas) {
		const rt = live.get(canvas)
		if (rt) (clearTimeout(rt.retry), clearInterval(rt.poll))
		live.delete(canvas)
		bound.delete(canvas)
		unreadable.delete(canvas)
	}

	/** Stop everything (the server is going down, or a test is done). */
	function close() {
		for (const rt of live.values()) (clearTimeout(rt.retry), clearInterval(rt.poll))
	}

	return { has, status, bind, unbind, sync, fresh, reconcile, putView, setView, removeView, change, items, dismiss, opened, touched, reset, agentAdded, brief, forget, close, sidecarPath: (canvas) => sidecarPath(data, canvas) }
}
