// Drawing a plan's views on an Excalidraw canvas (server/plan.mjs sends the graph; lib/plan.mjs made it). The rules are the
// ones app/plan-render.js keeps on tldraw: only elements carrying meta.plan are placed, removed or released; what someone is
// dragging or typing in is left alone and reported; a person's elements inside a managed frame that goes away are moved out
// of it first; and none of it is a step in this tab's undo.

/** The keys of the elements this tab's person has hold of right now: being typed in, or selected mid-drag, with what their frames hold. */
export function planBusy({ api, all, keyOf }) {
	const s = api.getAppState()
	const els = all().filter((e) => !e.isDeleted)
	const ids = new Set()
	if (s.editingTextElement) ids.add(s.editingTextElement.containerId ?? s.editingTextElement.id)
	if (s.selectedElementsAreBeingDragged || s.isResizing || s.isRotating || s.resizingElement) for (const [id, on] of Object.entries(s.selectedElementIds ?? {})) if (on) ids.add(id)
	if (!ids.size) return []
	for (const e of els) if (e.frameId && ids.has(e.frameId)) ids.add(e.containerId ?? e.id)
	return els.filter((e) => ids.has(e.id) && !(e.type === 'text' && e.containerId)).map(keyOf)
}

export async function planRender({ api, ex, all, get, keyOf, applyGraph }, { tg, remove = [], release = [], rev, reveal = false, skip = [], seen = {} }) {
	const held = new Set([...skip, ...planBusy({ api, all, keyOf })])
	// A box that isn't where the server last saw it was moved here a moment ago, and the server hasn't heard (this tab sends its
	// edits a moment after they are made): it is left alone, so the move is read before anything is drawn over it.
	const byId = new Map(all().map((e) => [e.id, e]))
	for (const [key, was] of Object.entries(seen)) {
		const e = get(key)
		if (!e || e.angle) continue
		const frame = e.frameId && byId.get(e.frameId)
		const now = [frame && !frame.isDeleted ? keyOf(frame) : '', Math.round(e.x), Math.round(e.y), Math.round(e.width)].join('|')
		if (now !== was) held.add(key)
	}
	const skipped = new Set()
	const isHeld = (key, group) => (held.has(key) || (group && held.has(group)) ? (skipped.add(key), true) : false)
	const draw = { ...tg, groups: tg.groups.filter((g) => !isHeld(g.key)), nodes: tg.nodes.filter((n) => !isHeld(n.key, n.group)), edges: tg.edges.filter((e) => !get(`edge:${e.from}->${e.to}`)) }
	// An element removed earlier is still in the scene, deleted, at the version it was deleted at. One drawn again under the same
	// id starts at version 1, and every other tab (and the server) would keep the deleted one, since the higher version wins.
	const dead = new Map(all().filter((e) => e.isDeleted).map((e) => [e.id, e.version]))
	const out = draw.groups.length || draw.nodes.length || draw.edges.length ? await applyGraph(draw, { move: true, history: 'ignore', plan: true }) : { created: 0, updated: 0 }

	const gone = new Set(remove.filter((k) => !held.has(k))), freed = new Set(release.filter((k) => !held.has(k)))
	const marker = tg.groups.map((g) => g.key).find((k) => get(k)) // one frame carries the number: enough to know it all arrived
	const els = all()
	const live = els.filter((e) => !e.isDeleted)
	const managed = (e) => !!e.customData?.meta?.plan
	const hostOf = (e) => (e.type === 'text' && e.containerId ? live.find((c) => c.id === e.containerId) : e)
	// applyGraph leaves an element in the frame it was in; a card that changed column or lane belongs to another now.
	const frameOf = new Map(draw.nodes.map((n) => [n.key, n.group ? get(n.group)?.id ?? null : null]))
	const goneFrames = new Set(live.filter((e) => e.type === 'frame' && managed(e) && gone.has(keyOf(e))).map((e) => e.id))
	let removed = 0, released = 0
	const next = els.map((e) => {
		if (e.isDeleted) return e
		if (dead.has(e.id) && e.version <= dead.get(e.id)) e = { ...e, version: dead.get(e.id) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() }
		const host = hostOf(e)
		if (!host) return e
		const key = keyOf(host)
		if (gone.has(key) && managed(host)) return (host === e && removed++, ex.newElementWith(e, { isDeleted: true }))
		// A person's own element in a frame that is going: it stays, where it is, outside any frame.
		if (e.frameId && goneFrames.has(e.frameId) && !managed(host)) return ex.newElementWith(e, { frameId: null })
		// A shape someone turned is stood up again: what the plan draws is upright.
		if (frameOf.has(key) && managed(host) && e.angle) e = ex.newElementWith(e, { angle: 0 })
		if (frameOf.has(key) && managed(host) && (e.frameId ?? null) !== frameOf.get(key)) return ex.newElementWith(e, { frameId: frameOf.get(key) })
		if (host !== e) return e
		if (freed.has(key) && managed(e)) return (released++, ex.newElementWith(e, { customData: { ...e.customData, meta: { ...e.customData.meta, plan: null } } }))
		if (key === marker && e.type === 'frame') return ex.newElementWith(e, { customData: { ...e.customData, meta: { ...e.customData?.meta, planRev: rev } } })
		return e
	})
	api.updateScene({ elements: next, captureUpdate: ex.CaptureUpdateAction.NEVER })
	return { created: out.created, updated: out.updated, removed, released, skipped: [...skipped], _quiet: !reveal }
}
