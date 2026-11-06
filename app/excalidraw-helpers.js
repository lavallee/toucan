// The `toucan` helper object on Excalidraw canvases, next to `editor` (the ExcalidrawImperativeAPI)
// and `tl` (the @excalidraw/excalidraw module). Same core as the tldraw helpers — summary, graph,
// applyGraph, screenshot, zoomTo, get, remove — so agents can work engine-neutrally through graphs.
//
// An element's key is customData.key, falling back to its id; toucan-made elements use the key as id.
// Edits go through newElementWith (which bumps version/versionNonce), so they sync to other tabs.

import ELK from 'elkjs/lib/elk.bundled.js'
import { fromExcalidraw, toExcalidrawElements, wrap, layoutMissing } from '../lib/tg.mjs'
import { pulse as glow } from './pulses'
import { refsOfShape } from './reference-links'

const elk = new ELK()

export function makeExcalidrawHelpers(api, ex) {
	const all = () => api.getSceneElementsIncludingDeleted()
	const live = () => api.getSceneElements()
	// A duplicated element keeps its original's customData.key, and the key belongs to the first.
	const keyOf = (e) => {
		const key = e.customData?.key
		return key && shapes().find((o) => o.customData?.key === key)?.id === e.id ? key : e.id
	}
	const shapes = () => live().filter((e) => !(e.type === 'text' && e.containerId))
	const get = (key) => shapes().find((e) => keyOf(e) === key)
	const labelOf = (e, els = live()) => (e.boundElements ?? []).map((b) => els.find((t) => t.id === b.id)).find((t) => t?.type === 'text')
	const text = (e) => (e.type === 'text' ? e.originalText : e.type === 'frame' ? e.name ?? '' : labelOf(e)?.originalText ?? '')
	const commit = (elements) => api.updateScene({ elements, captureUpdate: ex.CaptureUpdateAction.IMMEDIATELY })

	/** Compact, model-friendly view of the scene (or of one frame). */
	function summary({ within, limit = 400 } = {}) {
		let els = shapes()
		if (within) {
			const f = get(within)
			els = els.filter((e) => f && e.frameId === f.id)
		}
		const byId = new Map(live().map((e) => [e.id, e]))
		const selected = selection().here.map((r) => r.key)
		return {
			engine: 'excalidraw',
			count: els.length,
			...(selected.length && { selected }),
			shapes: els.slice(0, limit).map((e) => {
				const row = { id: e.id, key: keyOf(e), type: e.type, x: Math.round(e.x), y: Math.round(e.y), w: Math.round(e.width), h: Math.round(e.height) }
				const t = text(e)
				if (t) row.text = t.slice(0, 120)
				if (e.frameId) row.parent = keyOf(byId.get(e.frameId) ?? { id: e.frameId })
				row.color = e.strokeColor
				if (e.type === 'arrow') {
					if (e.startBinding) row.from = keyOf(byId.get(e.startBinding.elementId) ?? { id: e.startBinding.elementId })
					if (e.endBinding) row.to = keyOf(byId.get(e.endBinding.elementId) ?? { id: e.endBinding.elementId })
				}
				if (e.customData?.meta) row.meta = e.customData.meta
				return row
			}),
		}
	}

	// ---- proposals: dashed = proposed (customData.proposed = { dash }); see the tldraw helpers ----
	const isProposal = (e) => !!e?.customData?.proposed
	const rowOf = (e) => ({ key: keyOf(e), type: e.type, ...(text(e) && { text: text(e).slice(0, 120) }) })

	function propose(...keys) {
		const want = new Set(keys.flat())
		const els = shapes().filter((e) => want.has(keyOf(e)) && e.type !== 'frame' && !isProposal(e))
		const changed = new Map(els.map((e) => [e.id, ex.newElementWith(e, { strokeStyle: 'dashed', customData: { ...e.customData, proposed: { dash: e.strokeStyle } } })]))
		commit(all().map((e) => changed.get(e.id) ?? e))
		return els.map(keyOf)
	}

	const proposals = () => shapes().filter(isProposal).map(rowOf)
	const proposalsFor = (keys) => {
		const want = new Set(keys.flat())
		return shapes().filter((e) => isProposal(e) && (!want.size || want.has(keyOf(e))))
	}

	function accept(...keys) {
		const els = proposalsFor(keys)
		const changed = new Map(els.map((e) => {
			const { proposed, ...customData } = e.customData
			return [e.id, ex.newElementWith(e, { strokeStyle: proposed.dash ?? 'solid', customData })]
		}))
		commit(all().map((e) => changed.get(e.id) ?? e))
		return { accepted: els.map(keyOf) }
	}

	function reject(...keys) {
		const gone = new Set(proposalsFor(keys).map((e) => e.id))
		for (const e of shapes()) if (isProposal(e) && e.type === 'arrow' && (gone.has(e.startBinding?.elementId) || gone.has(e.endBinding?.elementId))) gone.add(e.id)
		const keysGone = shapes().filter((e) => gone.has(e.id)).map(keyOf)
		commit(all().map((e) => (gone.has(e.id) || gone.has(e.containerId) ? ex.newElementWith(e, { isDeleted: true }) : e)))
		return { rejected: keysGone }
	}

	const selectedProposals = () => {
		const ids = api.getAppState().selectedElementIds ?? {}
		return shapes().filter((e) => ids[e.id] && isProposal(e)).map(keyOf)
	}

	/**
	 * What the person selected in the tab running this code (`here`), to resolve "this" and "these".
	 * Excalidraw tabs here share no presence, so other tabs' selections aren't visible (`others` is empty).
	 */
	function selection() {
		const ids = api.getAppState().selectedElementIds ?? {}
		const here = shapes()
			.filter((e) => ids[e.id])
			.map((e) => ({ key: keyOf(e), type: e.type, ...(text(e) && { text: text(e).slice(0, 120) }), x: Math.round(e.x), y: Math.round(e.y), w: Math.round(e.width), h: Math.round(e.height) }))
		return { here, others: [] }
	}

	const graph = () => fromExcalidraw(all())

	/**
	 * Keyed upsert of a toucan graph. Existing elements get only what the graph carries (text, the
	 * style keys present, meta) and keep their geometry unless `move`; new ones take the graph's box,
	 * or a grid spot below the scene for formats without positions. Arrows match by endpoints.
	 * `prune` deletes keyed elements the graph doesn't mention.
	 */
	async function applyGraph(tg, { move = false, prune = false, propose: asProposal = false, direction } = {}) {
		tg = await layoutMissing(tg, { existing: graph(), elk, direction })
		const current = all()
		const byKey = new Map(shapes().map((e) => [keyOf(e), e]))
		const edgeKey = (e) => `edge:${e.from}->${e.to}`
		const box = (e) => ({ x: e.x, y: e.y, w: e.width, h: e.height })
		// Existing geometry wins unless `move`, so new arrows are drawn between where things really are.
		const keep = (item) => (byKey.has(item.key) && (!move || !item.box) ? { ...item, box: box(byKey.get(item.key)) } : item)
		const placed = { ...tg, groups: tg.groups.map(keep), nodes: tg.nodes.map(keep), edges: tg.edges.map((e) => ({ ...e, key: edgeKey(e) })) }
		const target = toExcalidrawElements(placed)
		const tgItem = new Map([...tg.groups, ...tg.nodes].map((i) => [i.key, i]))
		const tgEdge = new Map(tg.edges.map((e) => [edgeKey(e), e]))

		const next = new Map(current.map((e) => [e.id, e]))
		const idOf = (key) => byKey.get(key)?.id ?? key
		const out = { created: 0, updated: 0, pruned: 0 }
		for (const t of target) {
			if (t.type === 'text' && t.containerId) continue // labels are handled with their container
			const key = t.customData?.key ?? t.id
			const existing = byKey.get(key)
			const label = target.find((l) => l.containerId === t.id)
			if (existing) {
				const src = tgItem.get(key) ?? tgEdge.get(key) ?? {}
				const st = src.style ?? {}
				const upd = { customData: { ...existing.customData, ...t.customData, meta: { ...existing.customData?.meta, ...t.customData?.meta } } }
				if (st.color) Object.assign(upd, { strokeColor: t.strokeColor, ...(existing.type !== 'arrow' && { backgroundColor: t.backgroundColor }) })
				if (st.fill) Object.assign(upd, { backgroundColor: t.backgroundColor, fillStyle: t.fillStyle })
				if (st.dash) upd.strokeStyle = t.strokeStyle
				if (t.type === 'frame' && src.label) upd.name = t.name
				if (move && src.box && existing.type !== 'arrow') Object.assign(upd, { x: t.x, y: t.y, width: t.width, height: t.height })
				next.set(existing.id, ex.newElementWith(existing, upd))
				const oldLabel = labelOf(existing, current)
				const newText = src.text ?? src.label
				if (oldLabel && newText !== undefined && existing.type !== 'frame' && oldLabel.originalText !== newText) next.set(oldLabel.id, ex.newElementWith(oldLabel, { text: wrap(newText, oldLabel.width), originalText: newText }))
				out.updated++
				continue
			}
			// New element: point its frame and bindings at the real ids of existing elements.
			const el = { ...t, frameId: t.frameId ? idOf(t.frameId) : null }
			// `propose`: new elements arrive dashed, as a proposal a person accepts or rejects.
			if (asProposal && el.type !== 'frame') Object.assign(el, { strokeStyle: 'dashed', customData: { ...el.customData, proposed: { dash: t.strokeStyle } } })
			if (el.type === 'arrow') {
				for (const end of ['startBinding', 'endBinding']) {
					const targetId = idOf(el[end].elementId)
					el[end] = { ...el[end], elementId: targetId }
					const host = next.get(targetId)
					if (host && byKey.has(keyOf(host))) next.set(targetId, ex.newElementWith(host, { boundElements: [...(host.boundElements ?? []), { type: 'arrow', id: el.id }] }))
				}
			}
			next.set(el.id, el)
			if (label) next.set(label.id, { ...label, frameId: el.frameId })
			out.created++
		}
		if (prune) {
			const keepKeys = new Set([...tg.groups.map((g) => g.key), ...tg.nodes.map((n) => n.key), ...tg.edges.map(edgeKey)])
			for (const e of shapes()) {
				if (!e.customData?.key || keepKeys.has(e.customData.key)) continue
				next.set(e.id, ex.newElementWith(e, { isDeleted: true }))
				const l = labelOf(e, current)
				if (l) next.set(l.id, ex.newElementWith(l, { isDeleted: true }))
				out.pruned++
			}
		}
		commit(ex.restoreElements([...next.values()], null, { refreshDimensions: true, repairBindings: true }))
		return out
	}

	function remove(...keys) {
		const gone = new Set(keys.flat())
		const els = all()
		commit(els.map((e) => (gone.has(keyOf(e)) || (e.containerId && gone.has(keyOf(els.find((c) => c.id === e.containerId) ?? {}))) ? ex.newElementWith(e, { isDeleted: true }) : e)))
	}

	function zoomTo(keys) {
		const els = keys ? [keys].flat().map(get).filter(Boolean) : live()
		if (els.length) api.scrollToContent(els, { fitToContent: true, animate: true })
	}

	/** PNG of the scene (or of some keys) as base64, at most `max` px on its long side. */
	async function screenshot({ keys, max = 1800 } = {}) {
		let els = live()
		if (keys?.length) {
			// A frame brings its contents; a box brings its label.
			const ids = new Set(keys.map(get).filter(Boolean).map((e) => e.id))
			els = els.filter((e) => ids.has(e.id) || ids.has(e.frameId) || ids.has(e.containerId))
			const inner = new Set(els.map((e) => e.id))
			els = live().filter((e) => inner.has(e.id) || inner.has(e.containerId))
		}
		if (!els.length) return null
		const blob = await ex.exportToBlob({ elements: els, appState: { ...api.getAppState(), exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false }, files: api.getFiles(), maxWidthOrHeight: max, mimeType: 'image/png' })
		const buf = new Uint8Array(await blob.arrayBuffer())
		let s = ''
		for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
		return btoa(s)
	}

	/** Make elements (ids or keys) glow for a moment in this tab, as agent edits do in every tab; the agent's cursor moves there. */
	function pulse(idsOrKeys, via) {
		// In the order given (what a run added comes first), so the agent's cursor goes to the right one.
		const els = shapes(), byKey = new Map(els.map((e) => [keyOf(e), e.id])), ids = new Set(els.map((e) => e.id))
		glow([idsOrKeys].flat().map((k) => (ids.has(k) ? k : byKey.get(k))).filter(Boolean), via)
	}

	/**
	 * Internal (the exec relay): note every element's version now; the returned function lists the
	 * shapes (not bound labels) added, changed or deleted since, as { id, key, type, text }.
	 */
	function _track() {
		const before = new Map(all().map((e) => [e.id, e.version]))
		return () => {
			const out = { added: [], updated: [], removed: [] }
			const els = all()
			const byId = new Map(els.map((e) => [e.id, e]))
			const touched = new Set()
			for (const e of els) {
				if ((before.get(e.id) ?? -1) === e.version) continue
				// A changed label counts as a change to its box.
				touched.add(e.type === 'text' && e.containerId && byId.has(e.containerId) ? e.containerId : e.id)
			}
			for (const id of touched) {
				const e = byId.get(id)
				const row = { id, key: keyOf(e), type: e.type, ...(text(e) && { text: text(e).slice(0, 80) }) }
				if (e.isDeleted) before.has(id) && out.removed.push(row)
				else (before.has(id) ? out.updated : out.added).push(row)
			}
			for (const k of ['added', 'updated', 'removed']) out[k] = out[k].slice(0, 200)
			return out
		}
	}

	// ---- the canvas as comment threads see it (app/Threads.tsx): page coordinates, and what's where ------
	const boxOf = (e) => ({ x: Math.min(e.x, e.x + e.width), y: Math.min(e.y, e.y + e.height), w: Math.abs(e.width), h: Math.abs(e.height) })
	const boundsOf = (keys) => {
		const found = keys.map(get).filter(Boolean).map(boxOf)
		if (!found.length) return null
		const x = Math.min(...found.map((b) => b.x)), y = Math.min(...found.map((b) => b.y))
		return { x, y, w: Math.max(...found.map((b) => b.x + b.w)) - x, h: Math.max(...found.map((b) => b.y + b.h)) - y }
	}
	const inside = (b, p) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h
	/** Internal (the exec relay): an edit nobody can see hasn't landed. See the tldraw helpers. */
	function reveal(addedIds) {
		const added = live().filter((e) => addedIds.includes(e.id))
		const state = api.getAppState()
		if (!added.length || state.newElement || state.resizingElement || state.selectedElementsAreBeingDragged || state.editingTextElement) return
		const corner = (x, y) => ex.sceneCoordsToViewportCoords({ sceneX: x, sceneY: y }, state)
		const out = added.some((e) => {
			const b = boxOf(e), a = corner(b.x, b.y), z = corner(b.x + b.w, b.y + b.h)
			return a.x < state.offsetLeft || a.y < state.offsetTop || z.x > state.offsetLeft + state.width || z.y > state.offsetTop + state.height
		})
		if (out) api.scrollToContent(undefined, { fitToContent: true, animate: true })
	}

	// ---- what's behind a box, and how to walk on from it (app/Details.tsx) ------------------------------
	const stepOf = (e) => ({ key: keyOf(e), text: text(e) || keyOf(e) })
	function viaEdges(key) {
		const me = get(key)
		const out = { next: [], prev: [] }
		if (!me) return out
		const byId = new Map(live().map((e) => [e.id, e]))
		for (const a of shapes()) {
			if (a.type !== 'arrow' || a.customData?.proposed || a.strokeStyle === 'dotted') continue
			const from = a.startBinding && byId.get(a.startBinding.elementId), to = a.endBinding && byId.get(a.endBinding.elementId)
			if (from?.id === me.id && to) out.next.push(stepOf(to))
			if (to?.id === me.id && from) out.prev.push(stepOf(from))
		}
		return out
	}
	function viaLanes(key) {
		const me = get(key)
		if (!me) return { next: [], prev: [] }
		const row = shapes().filter((e) => e.type !== 'arrow' && e.type !== 'frame' && e.frameId === me.frameId).sort((a, b) => a.x - b.x || a.y - b.y)
		const i = row.findIndex((e) => e.id === me.id)
		if (i < 0) return { next: [], prev: [] } // a frame or an arrow isn't on the lane
		return { next: row[i + 1] ? [stepOf(row[i + 1])] : [], prev: i > 0 ? [stepOf(row[i - 1])] : [] }
	}
	const walkView = {
		// Meta comes from synced documents and from agents, so its shape can't be taken on trust.
		detailOf: (key) => {
			const detail = get(key)?.customData?.meta?.detail
			return typeof detail === 'string' ? detail : ''
		},
		refsOf: (key) => {
			const e = get(key)
			return e ? refsOfShape({ meta: e.customData?.meta, text: text(e), link: e.link }) : []
		},
		referencesOnCanvas: () =>
			shapes().flatMap((e) => refsOfShape({ meta: e.customData?.meta, text: text(e), link: e.link }).map((r) => ({ ...r, key: keyOf(e), on: (text(e) || '').split('\n')[0].slice(0, 80) }))),
		seeAlsoOf: (key) => {
			const see = get(key)?.customData?.meta?.see
			return (Array.isArray(see) ? see : []).filter((s) => typeof s?.key === 'string' && get(s.key)).map((s) => ({ key: s.key, ...(typeof s.label === 'string' && { label: s.label }), text: text(get(s.key)) || s.key }))
		},
		selectedKey: () => {
			const ids = Object.keys(api.getAppState().selectedElementIds ?? {})
			if (ids.length !== 1) return null
			const e = shapes().find((x) => x.id === ids[0])
			return e ? keyOf(e) : null
		},
		neighbours: (key, walk) => (walk === 'lanes' ? viaLanes(key) : viaEdges(key)),
		isIdle: () => {
			const s = api.getAppState()
			return !s.newElement && !s.resizingElement && !s.selectedElementsAreBeingDragged && !s.editingTextElement
		},
		walkTo: (key) => {
			const e = get(key)
			if (!e) return
			api.updateScene({ appState: { selectedElementIds: { [e.id]: true } }, captureUpdate: ex.CaptureUpdateAction.NEVER })
			api.scrollToContent(e, { fitToContent: false, animate: true })
		},
	}

	const threadView = {
		...walkView,
		boundsOf,
		/** The topmost shape at a point; a frame only counts when nothing's on top of it. */
		shapeAt: (p) => {
			const at = shapes().filter((e) => inside(boxOf(e), p))
			const hit = [...at].reverse().find((e) => e.type !== 'frame') ?? at.at(-1)
			return hit ? keyOf(hit) : null
		},
		shapesIn: (box) => shapes().filter((e) => {
			if (e.type === 'frame' || e.type === 'arrow') return false
			const b = boxOf(e)
			return b.x < box.x + box.w && box.x < b.x + b.w && b.y < box.y + box.h && box.y < b.y + b.h
		}).map(keyOf),
		toViewport: ({ x, y }) => {
			const state = api.getAppState()
			const p = ex.sceneCoordsToViewportCoords({ sceneX: x, sceneY: y }, state)
			return { x: p.x - state.offsetLeft, y: p.y - state.offsetTop }
		},
		fromClient: ({ x, y }) => {
			const p = ex.viewportCoordsToSceneCoords({ clientX: x, clientY: y }, api.getAppState())
			return { x: p.x, y: p.y }
		},
		onCamera: (f) => api.onScrollChange(f),
		showBox: (box) => {
			const state = api.getAppState()
			const a = ex.sceneCoordsToViewportCoords({ sceneX: box.x, sceneY: box.y }, state), z = ex.sceneCoordsToViewportCoords({ sceneX: box.x + box.w, sceneY: box.y + box.h }, state)
			if (a.x >= state.offsetLeft && a.y >= state.offsetTop && z.x <= state.offsetLeft + state.width && z.y <= state.offsetTop + state.height) return
			const near = shapes().filter((e) => {
				const b = boxOf(e)
				return b.x < box.x + box.w && box.x < b.x + b.w && b.y < box.y + box.h && box.y < b.y + b.h
			})
			if (near.length) api.scrollToContent(near, { fitToContent: false, animate: true })
		},
	}

	return { engine: 'excalidraw', get, text, keyOf, summary, graph, applyGraph, remove, zoomTo, screenshot, pulse, selection, propose, proposals, accept, reject, selectedProposals, _track, reveal, ...threadView }
}
