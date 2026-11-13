// A canvas bound to a plan: which source it shows, the views drawn of it, and the sync between the two.
//
// The binding lives beside the canvas in <data>/NAME.plan.json:
//   { source: { name, ref }, views: [...], cursor, schema: { source, fields }, items (the last known upstream state),
//     rendered (what was last drawn, as lib/plan.mjs observes it), keys, problems: [...], syncedAt }
//
// One sync per canvas runs here, on the server, so several open tabs never multiply writes. It does two things, in order,
// and never at once (everything for a canvas goes through one queue):
//   push: when the canvas no longer matches what was drawn, the difference is read as field changes (lib/plan.mjs
//         changesFrom) and written upstream, each quoting the version its shape showed. Whatever upstream answers, the views
//         are drawn again from upstream's state: a refused or conflicting change goes back, and the person is told.
//   pull: while a person has the canvas open (or when asked), `changes` is polled; when the cursor moves the plan is read
//         again and the views redrawn.
// A redraw touches only shapes carrying meta.plan, and waits while anyone is dragging or typing.

import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { PlanError, changesFrom, checkPlan, diffObserved, coerceValue, fieldOf, freeViewId, leftovers, observe, originsOf, render, resolveView, sameObserved, validateView, viewTitle, KINDS } from '../lib/plan.mjs'
import { writeAtomic } from '../lib/paths.mjs'

const NAME = /^[a-z0-9][a-z0-9-_]{0,63}$/i
export const sidecarPath = (data, canvas) => join(data, `${canvas}.plan.json`)

const POLL_MS = Number(process.env.TOUCAN_PLAN_POLL ?? 4000)
const QUIET_MS = 450 // edits must have paused this long before the canvas is read: a drag changes the document many times a second
const RETRY_MS = 300
const SETTLE_MS = 6000 // how long to wait to see a redraw arrive in the server's copy before taking the canvas as it is
const MAX_PROBLEMS = 20
// TOUCAN_PLAN_DEBUG=1: say on stderr what each sync saw, to find out why a canvas keeps being redrawn.
const debug = (canvas, what, lines) => process.env.TOUCAN_PLAN_DEBUG && console.error(`plan ${canvas}: ${what}${lines ? `\n  ${lines().slice(0, 12).join('\n  ')}` : ''}`)

/**
 * `deps`: sources (server/sources.mjs); graphOf(canvas) → the whole canvas as a toucan graph; engineOf(canvas);
 * exec(canvas, code, { label, doing }) → runs in a tab or the headless page; people(canvas) → open tabs that are people;
 * canDraw(canvas) → is there, or can there be, a page to draw in; busy(canvas) → is anyone mid-gesture; changedAt(canvas) →
 * when the document last changed (ms); broadcast(canvas, msg).
 */
export function createPlans({ data, sources, graphOf, engineOf, exec, people, canDraw, busy, changedAt, broadcast, pollMs = POLL_MS }) {
	const bound = new Set(existsSync(data) ? readdirSync(data).map((f) => /^(.+)\.plan\.json$/.exec(f)?.[1]).filter((n) => n && NAME.test(n)) : [])
	const live = new Map() // canvas -> { st, queue, poll, retry, settling, dirty, rev, error, skip, working }

	const has = (canvas) => bound.has(canvas)
	function load(canvas) {
		if (!bound.has(canvas)) return null
		if (!live.has(canvas)) {
			let st
			try {
				st = JSON.parse(readFileSync(sidecarPath(data, canvas), 'utf8'))
			} catch (e) {
				console.error(`plan of ${canvas}: ${e.message}`)
				return null
			}
			live.set(canvas, { canvas, st: { views: [], problems: [], keys: {}, ...st }, queue: Promise.resolve(), dirty: true, rev: Date.now() % 1e9, skip: new Set(), churn: [] })
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

	// ---- what people are told ---------------------------------------------------------------------------------------------
	function status(canvas) {
		const rt = load(canvas)
		if (!rt) return { bound: false }
		const { st } = rt
		const plan = planOf(rt)
		const state = rt.working ? 'syncing' : rt.error ? 'problem' : !st.items ? 'waiting' : rt.dirty || rt.settling ? (canDraw(canvas) ? 'syncing' : 'waiting') : st.problems.length ? 'problem' : 'synced'
		return {
			bound: true,
			source: { name: st.source.name, ref: st.source.ref, title: st.schema?.source?.title ?? st.source.ref, readonly: !!st.schema?.source?.readonly },
			state,
			...(rt.error && { error: rt.error }),
			...(state === 'waiting' && st.items && { waiting: 'the views are drawn when someone opens the canvas' }),
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
	/** The changes between two observations, across every view: one per item, however many views showed the gesture. */
	function collect(rt, base, now, fresh) {
		const plan = planOf(rt)
		const byItem = new Map(), creates = new Map()
		for (const view of rt.st.views) {
			if (!validateView(view, plan).ok) continue
			for (const c of changesFrom(plan, view, base, now)) {
				if (c.op === 'create') {
					if (!rt.skip.has(c.shape) && !creates.has(c.shape)) creates.set(c.shape, { ...c, view: view.id })
					continue
				}
				const have = byItem.get(c.id)
				if (!have) byItem.set(c.id, { ...c, ...(c.set && { set: { ...c.set } }) })
				else {
					if (c.set) have.set = { ...have.set, ...c.set }
					if (c.place) have.place = c.place
				}
			}
		}
		const version = (c) => (fresh ? plan.items.find((it) => it.id === c.id)?.version ?? c.version : c.version)
		return [...[...byItem.values()].map((c) => ({ ...c, version: version(c) })), ...creates.values()]
	}

	const titleOf = (rt, id) => rt.st.items?.find((it) => it.id === id)?.title ?? id
	const sayRefusal = (title, error, message) =>
		error === 'conflict' ? `"${title}" changed upstream; showing the upstream version.`
		: error === 'not_found' ? `"${title}" is no longer in the plan.`
		: error === 'forbidden' ? `"${title}" can't be changed from here${message ? `: ${message}` : ''}. Put back as it is upstream.`
		: error === 'unavailable' ? `Couldn't reach the plan to save "${title}"${message ? `: ${message}` : ''}. Put back as it is upstream.`
		: `"${title}": ${message || 'the change was refused'}. Put back as it is upstream.`

	/** Writes changes upstream and takes in what it answers. Each change has its own idempotency key, so a retry writes once. */
	async function write(rt, changes) {
		const { st } = rt
		const sent = changes.map((c) => ({ ...c, mutation: randomUUID().replace(/-/g, '') }))
		const wire = sent.map(({ shape, view, ...c }) => c)
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
				for (const c of sent) {
					problem(rt, { kind: e.code ?? 'unavailable', ...(c.id && { item: c.id }), title: label(c), text: sayRefusal(label(c), e.code ?? 'unavailable', e.message) })
					if (c.shape) rt.skip.add(c.shape)
				}
				return sent.map((c) => ({ mutation: c.mutation, ok: false, error: e.code ?? 'unavailable', message: String(e.message ?? e) }))
			}
		}
		const byMutation = new Map(answer.results.map((r) => [r?.mutation, r]))
		const results = sent.map((c, i) => byMutation.get(c.mutation) ?? answer.results[i] ?? { mutation: c.mutation, ok: false, error: 'unavailable', message: 'the source gave no answer for this change' })
		sent.forEach((c, i) => {
			const r = results[i]
			if (r.ok) {
				// A box someone drew became an item: from now on it is that item's card.
				if (c.shape && r.item?.id !== undefined) ((st.keys[c.view] ??= {})[String(r.item.id)] = c.shape)
			} else {
				problem(rt, { kind: r.error ?? 'invalid', ...(c.id && { item: c.id }), title: r.item?.title ?? label(c), text: sayRefusal(r.item?.title ?? label(c), r.error, r.message) })
				if (c.shape) rt.skip.add(c.shape)
			}
			// Until the plan is read again, this is the best account of upstream there is.
			if (r.item && st.items) {
				const at = st.items.findIndex((it) => it.id === String(r.item.id))
				if (at >= 0) st.items[at] = r.item
				else st.items.push(r.item)
			} else if (!r.ok && r.error === 'not_found' && c.id && st.items) st.items = st.items.filter((it) => it.id !== c.id)
		})
		if (answer.cursor !== null && answer.cursor !== undefined) st.cursor = answer.cursor
		rt.dirty = true
		// Someone else may have written between our last read and this write, and the new cursor is past that: read it all.
		await pull(rt, true)
		save(rt)
		return results
	}

	// ---- draw -------------------------------------------------------------------------------------------------------------
	async function draw(rt) {
		const { st, canvas } = rt
		const plan = planOf(rt)
		if (!plan) return
		const current = graphOf(canvas)
		const now = observe(current)
		const origins = originsOf(now)
		const nest = engineOf(canvas) !== 'excalidraw'
		const full = { tg: 1, groups: [], nodes: [], edges: [] }
		const kept = new Set() // views that can't be drawn just now: their shapes stay as they are
		// Somewhere clear for a view that isn't on the canvas yet: under the plan's other views, else right of everything.
		const boxes = [...(current.groups ?? []), ...(current.nodes ?? [])].map((x) => x.box).filter(Boolean)
		const managed = Object.values(now.frames)
		let fresh = managed.length ? { x: Math.min(...managed.map((f) => f.x)), y: Math.max(...managed.map((f) => f.y + f.h)) + 160 } : boxes.length ? { x: Math.max(...boxes.map((b) => b.x + b.w)) + 240, y: Math.min(...boxes.map((b) => b.y)) } : { x: 0, y: 0 }
		let added = false
		for (const view of st.views) {
			const check = validateView(view, plan)
			if (!check.ok) {
				kept.add(view.id)
				if (!st.problems.some((p) => p.kind === 'view' && p.view === view.id)) problem(rt, { kind: 'view', view: view.id, text: `The ${view.id} view no longer fits the plan: ${check.errors.join('; ')}` })
				continue
			}
			let tg
			try {
				tg = await render(plan, view, { origin: origins[view.id] ?? fresh, keys: st.keys[view.id], nest })
			} catch (e) {
				kept.add(view.id)
				problem(rt, { kind: 'view', view: view.id, text: `Couldn't draw the ${view.id} view: ${e.message}` })
				continue
			}
			if (!origins[view.id]) {
				added = true
				const bottoms = [...tg.groups, ...tg.nodes].map((x) => x.box.y + x.box.h)
				fresh = { x: fresh.x, y: Math.max(...bottoms) + 160 }
			}
			full.groups.push(...tg.groups)
			full.nodes.push(...tg.nodes)
			full.edges.push(...tg.edges)
		}
		const want = observe(full)
		const inKept = (o) => kept.has(o?.plan?.view)
		for (const [key, f] of Object.entries(now.frames)) if (inKept(f)) want.frames[key] = f
		for (const [key, n] of Object.entries(now.nodes)) if (inKept(n)) want.nodes[key] = n
		if (sameObserved(now, want, { loose: false })) {
			st.rendered = want
			rt.dirty = false
			save(rt)
			return
		}
		const found = leftovers(now, want)
		const release = found.release
		// A view that can't be drawn keeps its arrows too.
		const remove = found.remove.filter((key) => ![...kept].some((id) => key.startsWith(`edge:plan:${id}:`)))
		const rev = ++rt.rev
		debug(canvas, `redrawing (${remove.length} to remove, ${release.length} to release)`, () => diffObserved(now, want))
		const r = await exec(canvas, `return await toucan._planRender(${JSON.stringify({ tg: full, remove, release, rev, reveal: added })})`, { label: 'Plan sync', doing: `syncing ${plan.source.title}` })
		if (r?.busy) return 'busy'
		st.rendered = want
		rt.settling = { rev, since: Date.now(), frames: full.groups.length > 0 }
		rt.dirty = false
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
		rt.retry = setTimeout(() => reconcile(rt.canvas).catch(() => {}), ms)
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
				if (busy(canvas) || Date.now() - changedAt(canvas) < QUIET_MS) return void later(rt)
				if (rt.settling) {
					if (landed(canvas, rt.settling) || Date.now() - rt.settling.since > SETTLE_MS) rt.settling = null
					else return void later(rt)
				}
				// What people did since the last redraw, as changes upstream. A second look catches a gesture made while the first was being written.
				let base = rt.st.rendered
				for (let round = 0; base && round < 3; round++) {
					const now = observe(graphOf(canvas))
					const creating = planOf(rt).source.readonly !== true && fieldOf(planOf(rt), 'title')?.writable === true
					if (sameObserved(now, base, { loose: creating, skip: [...rt.skip] })) break
					const changes = collect(rt, base, now, round > 0)
					debug(canvas, `the canvas differs from what was drawn (${changes.length} change${changes.length === 1 ? '' : 's'} to write)`, () => diffObserved(base, now))
					// A canvas that keeps drifting from what was drawn, with nothing in it to save (an engine quirk, a script fighting the
					// sync), mustn't be redrawn forever.
					const t = Date.now()
					rt.churn = changes.length ? [] : [...rt.churn.filter((x) => t - x < 20000), t]
					if (rt.churn.length > 12) {
						if (!rt.st.problems.some((p) => p.kind === 'churn')) problem(rt, { kind: 'churn', text: 'The plan\'s views keep changing on the canvas faster than they can be synced; syncing is paused for a minute.' })
						rt.churn = []
						rt.st.rendered = now
						rt.dirty = false
						save(rt)
						announce(rt)
						return void later(rt, 60000)
					}
					if (changes.length) await write(rt, changes)
					rt.dirty = true
					base = now
					if (!changes.length) break
					for (let i = 0; i < 20 && (busy(canvas) || Date.now() - changedAt(canvas) < QUIET_MS); i++) await new Promise((r) => setTimeout(r, 150))
				}
				if (rt.dirty || !rt.st.rendered) {
					if ((await draw(rt)) === 'busy') return void later(rt)
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

	// ---- what the CLI and the app ask for ---------------------------------------------------------------------------------
	async function bind(canvas, { name, ref, views = [] }) {
		if (typeof ref !== 'string' || !ref) throw new PlanError('invalid', 'plan bind SOURCE REF: name what to show (`toucan sources` lists what each source has)')
		const source = sources.get(name)
		const plan = await source.read(ref, canvas)
		const st = { binding: 1, source: { name, ref }, views: [], cursor: plan.cursor, schema: { source: plan.source, fields: plan.fields }, items: plan.items, rendered: null, keys: {}, problems: [], syncedAt: new Date().toISOString() }
		const had = load(canvas)
		if (had) {
			// Bound again, to this or another plan: the views stay, as far as they still fit.
			st.views = had.st.views.filter((v) => validateView(v, plan).ok)
			st.rendered = had.st.rendered
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

	/** Lets go of the plan. What was drawn stays on the canvas, as ordinary shapes. */
	async function unbind(canvas) {
		const rt = need(canvas)
		return queued(rt, async () => {
			const now = observe(graphOf(canvas))
			const keys = [...Object.keys(now.frames), ...Object.keys(now.nodes), ...now.edges]
			if (keys.length) {
				try {
					await exec(canvas, `return await toucan._planRender(${JSON.stringify({ tg: { groups: [], nodes: [], edges: [] }, remove: [], release: keys, rev: 0 })})`, { label: 'Plan unbound', doing: 'letting go of the plan' })
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
				const now = observe(graphOf(canvas))
				const mine = (o) => o.plan?.view === id
				const keys = [...Object.entries(now.frames).filter(([, f]) => mine(f)).map(([k]) => k), ...Object.entries(now.nodes).filter(([, n]) => mine(n)).map(([k]) => k), ...(graphOf(canvas).edges ?? []).filter((e) => e.meta?.plan?.view === id).map((e) => `edge:${e.from}->${e.to}`)]
				if (keys.length) {
					try {
						await exec(canvas, `return await toucan._planRender(${JSON.stringify({ tg: { groups: [], nodes: [], edges: [] }, remove: [], release: keys, rev: 0 })})`, { label: `Plan view ${id} kept`, doing: 'leaving a view as ordinary shapes' })
					} catch (e) {
						throw new PlanError('unavailable', `the canvas has to be open to keep the view's shapes: ${e.message}`)
					}
					rt.settling = { rev: -1, since: Date.now(), frames: false }
				}
			}
			rt.st.views = rt.st.views.filter((v) => v.id !== id)
			delete rt.st.keys[id]
			rt.st.rendered = null // what's on the canvas is no baseline for anything now
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
			if (!rt.st.items) await pull(rt, true)
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

	function items(canvas) {
		const rt = need(canvas)
		const plan = planOf(rt)
		if (!plan) throw new PlanError('unavailable', rt.error ?? 'the plan hasn\'t been read yet: `plan sync`')
		return checkPlan(plan)
	}

	function dismiss(canvas, ids) {
		const rt = need(canvas)
		rt.st.problems = ids?.length ? rt.st.problems.filter((p) => !ids.includes(p.id)) : []
		save(rt)
		announce(rt)
		return status(canvas)
	}

	/** Lines for the chat agent's brief: what this canvas shows, and how to change it. */
	function brief(canvas) {
		const rt = load(canvas)
		if (!rt) return []
		const s = status(canvas)
		const views = s.views.map((v) => `${v.id} (${v.kind}${v.groupBy ? ` by ${v.groupBy}` : ''})`).join(', ') || 'none yet'
		const lines = [
			`This canvas shows a plan: "${s.source.title}" from the ${s.source.name} source (${s.source.ref})${s.source.readonly ? ', read-only' : ''}, ${s.items} items. Views: ${views}.`,
			'Shapes keyed plan:… are drawn from the plan and redrawn on every sync: never change them with `exec`, `import` or `draw`. Change the work with `plan set ITEM field=value` and `plan add --title T`, and the views with `plan view add|set|rm` (`plan catalog` has the options; `plan items` the data). Anything else on the canvas is yours and the person\'s as usual.',
		]
		if (s.error) lines.push(`The plan can't be reached just now: ${s.error}`)
		for (const p of s.problems.slice(-5)) lines.push(`Plan problem: ${p.text}`)
		return lines
	}

	/** The canvas is being archived: its binding goes with it. */
	function forget(canvas) {
		const rt = live.get(canvas)
		if (rt) (clearTimeout(rt.retry), clearInterval(rt.poll))
		live.delete(canvas)
		bound.delete(canvas)
	}

	/** Stop everything (the server is going down, or a test is done). */
	function close() {
		for (const rt of live.values()) (clearTimeout(rt.retry), clearInterval(rt.poll))
	}

	void resolveView
	void KINDS
	return { has, status, bind, unbind, sync, putView, setView, removeView, change, items, dismiss, opened, touched, brief, forget, close, sidecarPath: (canvas) => sidecarPath(data, canvas) }
}
