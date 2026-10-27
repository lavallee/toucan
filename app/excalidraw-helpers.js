// The `toucan` helper object on Excalidraw canvases, next to `editor` (the ExcalidrawImperativeAPI)
// and `tl` (the @excalidraw/excalidraw module). Same core as the tldraw helpers — summary, graph,
// applyGraph, screenshot, zoomTo, get, remove — so agents can work engine-neutrally through graphs.
//
// An element's key is customData.key, falling back to its id; toucan-made elements use the key as id.
// Edits go through newElementWith (which bumps version/versionNonce), so they sync to other tabs.

import ELK from 'elkjs/lib/elk.bundled.js'
import { fromExcalidraw, toExcalidrawElements, wrap, layoutMissing } from '../lib/tg.mjs'

const elk = new ELK()

export function makeExcalidrawHelpers(api, ex) {
	const all = () => api.getSceneElementsIncludingDeleted()
	const live = () => api.getSceneElements()
	const keyOf = (e) => e.customData?.key ?? e.id
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
		return {
			engine: 'excalidraw',
			count: els.length,
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

	const graph = () => fromExcalidraw(all())

	/**
	 * Keyed upsert of a toucan graph. Existing elements get only what the graph carries (text, the
	 * style keys present, meta) and keep their geometry unless `move`; new ones take the graph's box,
	 * or a grid spot below the scene for formats without positions. Arrows match by endpoints.
	 * `prune` deletes keyed elements the graph doesn't mention.
	 */
	async function applyGraph(tg, { move = false, prune = false, direction } = {}) {
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

	return { engine: 'excalidraw', get, text, keyOf, summary, graph, applyGraph, remove, zoomTo, screenshot }
}
