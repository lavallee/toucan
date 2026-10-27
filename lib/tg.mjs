// toucan graph (TG): the engine-neutral form of a canvas, and converters to and from the formats
// other tools speak. Plain JS with no dependencies, shared by the server, the CLI and the browser.
//
//   { tg: 1, groups: [{ key, label, parent, box }], nodes: [{ key, text, group, box, style, meta }],
//     edges: [{ key, from, to, label, style, meta }], skipped: {...} }
//
// Keys are the identity: a tldraw shape's meta.key (its id is shape:<key>), an Excalidraw element's
// customData.key, a JSON Canvas id, a Mermaid/DOT node id. `box` is page coordinates and optional
// (text formats have none). `style` uses tldraw's vocabulary (color, fill, dash, geo, route); other
// formats map to and from it, approximately. A missing field means "unknown — leave it": a Mermaid
// node outside any subgraph has no `group`, a bare reference has no `text`. Imports are keyed upserts — see applyGraph in each
// engine's helpers — so a format that drops something never deletes it.

export const COLORS = {
	black: '#1d1d1d', grey: '#9fa8b2', 'light-violet': '#e085f4', violet: '#ae3ec9', blue: '#4465e9', 'light-blue': '#4ba1f1',
	yellow: '#f1ac4b', orange: '#e16919', green: '#099268', 'light-green': '#4cb05e', 'light-red': '#f87777', red: '#e03131', white: '#ffffff',
}
/** Nearest tldraw colour name for a hex colour. */
export function colorName(hex) {
	if (!hex || typeof hex !== 'string') return undefined
	if (COLORS[hex]) return hex
	const rgb = (h) => {
		const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(h.trim())
		if (!m) return null
		const s = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
		return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16))
	}
	const c = rgb(hex)
	if (!c) return undefined
	let best, dist = Infinity
	for (const [name, h] of Object.entries(COLORS)) {
		const d = rgb(h).reduce((sum, v, i) => sum + (v - c[i]) ** 2, 0)
		if (d < dist) (dist = d), (best = name)
	}
	return best
}

const round = (b) => b && { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) }

// ---- tldraw -------------------------------------------------------------------------------

/** Plain text of a tldraw rich-text (TipTap JSON) value, without needing an editor. */
export function richTextToPlain(rt) {
	if (!rt) return ''
	const walk = (n) => (n.type === 'text' ? n.text ?? '' : n.type === 'hardBreak' ? '\n' : (n.content ?? []).map(walk).join(''))
	return (rt.content ?? []).map(walk).join('\n')
}

/**
 * TG from tldraw records (a room snapshot's documents, or editor.store.allRecords()).
 * opts.page: page name or id (default: the first page). opts.raw: keep each shape's tldraw
 * type/props under extra.tldraw, which makes tldraw → TG → tldraw lossless for styling.
 */
export function fromTldraw(records, { page, raw = false } = {}) {
	const byId = new Map(records.map((r) => [r.id, r]))
	const pages = records.filter((r) => r.typeName === 'page').sort((a, b) => (a.index < b.index ? -1 : 1))
	const pg = pages.find((p) => p.id === page || p.name === page) ?? pages[0]
	const shapes = records.filter((r) => r.typeName === 'shape')
	const keyOf = (s) => s.meta?.key ?? s.id.replace(/^shape:/, '')
	const pageOf = (s) => {
		while (s && s.typeName === 'shape') s = byId.get(s.parentId)
		return s?.id
	}
	const abs = new Map()
	const origin = (s) => {
		if (abs.has(s.id)) return abs.get(s.id)
		const parent = byId.get(s.parentId)
		const o = parent?.typeName === 'shape' ? origin(parent) : { x: 0, y: 0 }
		const p = { x: o.x + s.x, y: o.y + s.y }
		abs.set(s.id, p)
		return p
	}
	const size = (s) => ({
		w: s.props.w ?? (s.type === 'note' ? 200 : 100),
		h: (s.props.h ?? (s.type === 'note' ? 200 : 40)) + (s.props.growY ?? 0),
	})
	const groupKey = (s) => {
		for (let p = byId.get(s.parentId); p?.typeName === 'shape'; p = byId.get(p.parentId)) if (p.type === 'frame') return keyOf(p)
		return null
	}
	const meta = (s) => {
		const { key, from, to, ...rest } = s.meta ?? {}
		return Object.keys(rest).length ? rest : undefined
	}

	const tg = { tg: 1, page: pg?.name, groups: [], nodes: [], edges: [], skipped: {} }
	const extra = {}
	const skip = (why) => (tg.skipped[why] = (tg.skipped[why] ?? 0) + 1)
	const bindings = records.filter((r) => r.typeName === 'binding' && r.type === 'arrow')

	for (const s of shapes) {
		if (pageOf(s) !== pg?.id) continue
		const key = keyOf(s)
		if (raw) extra[key] = { type: s.type, props: s.props }
		if (s.type === 'frame') {
			tg.groups.push({ key, label: s.props.name ?? key, parent: groupKey(s), box: round({ ...origin(s), ...size(s) }), ...(meta(s) && { meta: meta(s) }) })
		} else if (s.type === 'arrow') {
			const ends = Object.fromEntries(bindings.filter((b) => b.fromId === s.id).map((b) => [b.props.terminal, byId.get(b.toId)]))
			if (!ends.start || !ends.end) {
				skip('arrow without both ends bound')
				continue
			}
			tg.edges.push({
				key,
				from: keyOf(ends.start),
				to: keyOf(ends.end),
				label: richTextToPlain(s.props.richText) || undefined,
				style: { color: s.props.color, dash: s.props.dash, route: s.props.kind === 'elbow' ? 'elbow' : s.props.bend ? 'curve' : 'straight' },
				...(meta(s) && { meta: meta(s) }),
			})
		} else if (s.type === 'geo' || s.type === 'note' || s.type === 'text') {
			tg.nodes.push({
				key,
				text: richTextToPlain(s.props.richText),
				group: groupKey(s),
				box: round({ ...origin(s), ...size(s) }),
				style: { color: s.props.color, fill: s.props.fill, dash: s.props.dash, geo: s.type === 'geo' ? s.props.geo : s.type },
				...(meta(s) && { meta: meta(s) }),
			})
		} else skip(`${s.type} shape`)
	}
	if (raw) tg.extra = { tldraw: extra }
	return tg
}

// ---- Excalidraw -----------------------------------------------------------------------------

let seedCounter = 1
const seed = () => (seedCounter = (seedCounter * 48271) % 2147483647)
const exBase = (o) => ({
	angle: 0, strokeWidth: 2, roughness: 0, opacity: 100, groupIds: [], frameId: null, seed: seed(), version: 1, versionNonce: seed(),
	isDeleted: false, boundElements: [], updated: 1, link: null, locked: false, fillStyle: 'solid', strokeStyle: 'solid',
	backgroundColor: 'transparent', strokeColor: COLORS.black, roundness: null, index: null, ...o,
})
const exDash = (d) => (d === 'dashed' ? 'dashed' : d === 'dotted' ? 'dotted' : 'solid')
// Excalidraw stores a bound label twice: `originalText` as typed and `text` wrapped to the container.
// It only re-wraps on edit, so wrap here. Font 3 (Cascadia) is monospaced: ~0.6em per character.
const EX_FONT = 14
export function wrap(text, width) {
	const cols = Math.max(4, Math.floor(width / (EX_FONT * 0.6)))
	return String(text).split('\n').flatMap((line) => {
		const out = []
		let cur = ''
		for (const word of line.split(/(\s+)/)) {
			if ((cur + word).length <= cols) cur += word
			else if (word.trim()) {
				if (cur.trim()) out.push(cur.trimEnd())
				cur = word
				while (cur.length > cols) out.push(cur.slice(0, cols)), (cur = cur.slice(cols))
			}
		}
		out.push(cur.trimEnd())
		return out
	}).join('\n')
}
const exText = (container, text, o = {}) => {
	const width = Math.max(10, container.width - 20)
	const wrapped = wrap(text, width)
	return exBase({
		type: 'text', id: `${container.id}:label`, x: container.x + 10, y: container.y + 10, width, height: wrapped.split('\n').length * EX_FONT * 1.25,
		text: wrapped, originalText: text, fontSize: EX_FONT, fontFamily: 3, textAlign: 'left', verticalAlign: 'top', containerId: container.id,
		autoResize: true, lineHeight: 1.25, strokeColor: container.strokeColor, frameId: container.frameId, ...o,
	})
}

/** Where the line from a's centre to b's centre leaves a's box (plus a small gap). */
function edgePoint(a, b, gap = 6) {
	const cx = a.x + a.width / 2, cy = a.y + a.height / 2
	const dx = b.x + b.width / 2 - cx, dy = b.y + b.height / 2 - cy
	if (!dx && !dy) return [cx, cy]
	const t = Math.min(dx ? (a.width / 2 + gap) / Math.abs(dx) : Infinity, dy ? (a.height / 2 + gap) / Math.abs(dy) : Infinity)
	return [cx + dx * Math.min(t, 1), cy + dy * Math.min(t, 1)]
}

/**
 * TG → complete Excalidraw elements (an .excalidraw file's `elements`). Element ids are the TG keys;
 * customData.key/meta carry identity and metadata back out. Text sizes are rough: Excalidraw's restore
 * (on load) re-measures and wraps them. Keyed merge into a live scene happens in the engine's helpers.
 */
export function toExcalidrawElements(tg) {
	const placed = withBoxes(tg)
	const out = []
	const byKey = new Map()
	for (const g of placed.groups)
		out.push(exBase({ type: 'frame', id: g.key, name: g.label ?? g.key, x: g.box.x, y: g.box.y, width: g.box.w, height: g.box.h, customData: { key: g.key, ...(g.meta && { meta: g.meta }) } }))
	for (const n of placed.nodes) {
		const geo = n.style?.geo
		const fill = n.style?.fill ?? 'semi'
		const color = COLORS[n.style?.color] ?? COLORS.black
		const el = exBase({
			type: geo === 'ellipse' ? 'ellipse' : geo === 'diamond' ? 'diamond' : 'rectangle', id: n.key,
			x: n.box.x, y: n.box.y, width: n.box.w, height: n.box.h, frameId: n.group ?? null,
			strokeColor: color, strokeStyle: exDash(n.style?.dash),
			backgroundColor: fill === 'none' ? 'transparent' : fill === 'solid' ? color : color + '22',
			fillStyle: fill === 'pattern' ? 'hachure' : 'solid',
			roundness: geo === 'ellipse' || geo === 'diamond' ? { type: 2 } : { type: 3 },
			customData: { key: n.key, ...(n.meta && { meta: n.meta }) },
		})
		const label = exText(el, n.text ?? n.key)
		el.boundElements.push({ type: 'text', id: label.id })
		byKey.set(n.key, el)
		out.push(el, label)
	}
	for (const e of placed.edges) {
		const a = byKey.get(e.from), b = byKey.get(e.to)
		if (!a || !b) continue
		// Run between the boxes' edges, along the line joining their centres.
		const [ax, ay] = edgePoint(a, b), [bx, by] = edgePoint(b, a)
		const arrow = exBase({
			type: 'arrow', id: e.key, x: ax, y: ay, width: Math.abs(bx - ax), height: Math.abs(by - ay),
			points: [[0, 0], [bx - ax, by - ay]], lastCommittedPoint: null,
			strokeColor: COLORS[e.style?.color ?? 'grey'] ?? COLORS.grey, strokeStyle: exDash(e.style?.dash), roundness: { type: 2 },
			startBinding: { elementId: a.id, focus: 0, gap: 4 }, endBinding: { elementId: b.id, focus: 0, gap: 4 },
			startArrowhead: null, endArrowhead: 'arrow', elbowed: false,
			customData: { key: e.key, from: e.from, to: e.to, ...(e.meta && { meta: e.meta }) },
		})
		a.boundElements.push({ type: 'arrow', id: arrow.id })
		b.boundElements.push({ type: 'arrow', id: arrow.id })
		out.push(arrow)
		if (e.label) {
			const t = exText({ ...arrow, x: ax, y: ay, width: 120, frameId: null }, e.label, { textAlign: 'center', verticalAlign: 'middle' })
			arrow.boundElements.push({ type: 'text', id: t.id })
			out.push(t)
		}
	}
	return out
}

/** TG from Excalidraw elements (scene.elements). Deleted elements are ignored. */
export function fromExcalidraw(elements) {
	const live = elements.filter((e) => !e.isDeleted)
	const byId = new Map(live.map((e) => [e.id, e]))
	const keyOf = (e) => e.customData?.key ?? e.id
	const textOf = (e) => (e.boundElements ?? []).map((b) => byId.get(b.id)).find((t) => t?.type === 'text')?.originalText ?? ''
	const stroke = (e) => colorName(e.strokeColor)
	const dash = (e) => (e.strokeStyle === 'solid' ? 'solid' : e.strokeStyle)
	const tg = { tg: 1, groups: [], nodes: [], edges: [], skipped: {} }
	const skip = (why) => (tg.skipped[why] = (tg.skipped[why] ?? 0) + 1)
	for (const e of live) {
		const box = round({ x: e.x, y: e.y, w: e.width, h: e.height })
		const meta = e.customData?.meta
		const group = e.frameId && byId.get(e.frameId) ? keyOf(byId.get(e.frameId)) : null
		if (e.type === 'frame' || e.type === 'magicframe') tg.groups.push({ key: keyOf(e), label: e.name ?? keyOf(e), parent: null, box, ...(meta && { meta }) })
		else if (e.type === 'rectangle' || e.type === 'ellipse' || e.type === 'diamond')
			tg.nodes.push({
				key: keyOf(e), text: textOf(e), group, box,
				style: { color: stroke(e), fill: e.backgroundColor === 'transparent' ? 'none' : e.fillStyle === 'solid' ? 'semi' : 'pattern', dash: dash(e), geo: e.type },
				...(meta && { meta }),
			})
		else if (e.type === 'text' && !e.containerId) tg.nodes.push({ key: keyOf(e), text: e.originalText ?? e.text, group, box, style: { color: stroke(e), geo: 'text' }, ...(meta && { meta }) })
		else if (e.type === 'arrow') {
			const a = byId.get(e.startBinding?.elementId), b = byId.get(e.endBinding?.elementId)
			if (!a || !b) {
				skip('arrow without both ends bound')
				continue
			}
			tg.edges.push({
				key: e.customData?.key ?? `edge:${keyOf(a)}->${keyOf(b)}`, from: keyOf(a), to: keyOf(b), label: textOf(e) || undefined,
				style: { color: stroke(e), dash: dash(e), route: e.elbowed ? 'elbow' : 'straight' },
				...(meta && { meta }),
			})
		} else if (e.type === 'text') continue // a container's label, read above
		else skip(`${e.type} element`)
	}
	return tg
}

// ---- JSON Canvas (jsoncanvas.org 1.0, Obsidian) ---------------------------------------------

const JC_PRESET = { red: '1', orange: '2', yellow: '3', green: '4', 'light-blue': '5', violet: '6' }
const JC_FROM_PRESET = Object.fromEntries(Object.entries(JC_PRESET).map(([k, v]) => [v, k]))
const jcColor = (c) => (c ? JC_PRESET[c] ?? COLORS[c] : undefined)

/** TG → JSON Canvas. Positions are integers; style other than colour is dropped; meta rides in `toucan_meta`. */
export function toJsonCanvas(tg) {
	const placed = withBoxes(tg)
	const nodes = [
		...placed.groups.map((g) => ({ id: g.key, type: 'group', label: g.label, x: g.box.x, y: g.box.y, width: g.box.w, height: g.box.h, ...(g.meta && { toucan_meta: g.meta }) })),
		...placed.nodes.map((n) => ({
			id: n.key, type: 'text', text: n.text ?? n.key, x: n.box.x, y: n.box.y, width: n.box.w, height: n.box.h,
			...(jcColor(n.style?.color) && { color: jcColor(n.style.color) }),
			...(n.meta && { toucan_meta: n.meta }),
		})),
	]
	const edges = placed.edges.map((e) => ({
		id: e.key, fromNode: e.from, toNode: e.to, toEnd: 'arrow',
		...(e.label && { label: e.label }),
		...(jcColor(e.style?.color) && { color: jcColor(e.style.color) }),
		...(e.meta && { toucan_meta: e.meta }),
	}))
	return { nodes, edges }
}

/** JSON Canvas → TG. Group membership is inferred from geometry (the smallest group containing a node's centre). */
export function fromJsonCanvas(jc) {
	const color = (c) => (c ? JC_FROM_PRESET[c] ?? colorName(c) : undefined)
	const box = (n) => ({ x: n.x, y: n.y, w: n.width, h: n.height })
	const groups = (jc.nodes ?? []).filter((n) => n.type === 'group').map((n) => ({ key: n.id, label: n.label ?? '', parent: null, box: box(n), ...(n.toucan_meta && { meta: n.toucan_meta }) }))
	const container = (b, self) => {
		const cx = b.x + b.w / 2, cy = b.y + b.h / 2
		return groups.filter((g) => g.key !== self && cx >= g.box.x && cx <= g.box.x + g.box.w && cy >= g.box.y && cy <= g.box.y + g.box.h && g.box.w * g.box.h > b.w * b.h).sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h)[0]?.key ?? null
	}
	for (const g of groups) g.parent = container(g.box, g.key)
	const text = (n) => (n.type === 'text' ? n.text : n.type === 'file' ? n.file : n.type === 'link' ? n.url : '')
	const nodes = (jc.nodes ?? []).filter((n) => n.type !== 'group').map((n) => ({
		key: n.id, text: text(n) ?? '', group: container(box(n), n.id), box: box(n),
		style: { ...(color(n.color) && { color: color(n.color) }) },
		...(n.toucan_meta && { meta: n.toucan_meta }),
		...(n.type !== 'text' && { meta: { ...n.toucan_meta, jsoncanvas_type: n.type } }),
	}))
	const edges = (jc.edges ?? []).map((e) => ({
		key: e.id, from: e.fromNode, to: e.toNode, label: e.label,
		style: { ...(color(e.color) && { color: color(e.color) }) },
		...(e.toucan_meta && { meta: e.toucan_meta }),
	}))
	return { tg: 1, groups, nodes, edges, skipped: {} }
}

// ---- Mermaid flowchart ----------------------------------------------------------------------

const MERMAID_RESERVED = new Set(['end', 'graph', 'flowchart', 'subgraph', 'style', 'class', 'classdef', 'click', 'linkstyle', 'direction'])
function mermaidIds(keys) {
	const ids = new Map(), used = new Set()
	for (const key of keys) {
		let id = key.replace(/[^A-Za-z0-9_]/g, '_')
		if (!/^[A-Za-z]/.test(id) || MERMAID_RESERVED.has(id.toLowerCase())) id = 'n_' + id
		let unique = id
		for (let i = 2; used.has(unique); i++) unique = `${id}_${i}`
		used.add(unique)
		ids.set(key, unique)
	}
	return ids
}
const mmLabel = (s) => `"${String(s).replace(/"/g, '#quot;').replace(/\n/g, '<br>')}"`
const mmUnlabel = (s) => s.replace(/^"|"$/g, '').replace(/#quot;/g, '"').replace(/<br\s*\/?>/gi, '\n')

/**
 * TG → Mermaid flowchart. Keys that aren't valid Mermaid ids get an id plus a `%% toucan-key` comment,
 * so fromMermaid maps them back. Groups become (nested) subgraphs. No positions.
 */
export function toMermaid(tg, { direction = 'LR' } = {}) {
	const ids = mermaidIds([...tg.groups.map((g) => g.key), ...tg.nodes.map((n) => n.key)])
	const lines = [`flowchart ${direction}`]
	for (const [key, id] of ids) if (id !== key) lines.push(`  %% toucan-key ${id} ${JSON.stringify(key)}`)
	const shape = (n) => {
		const l = mmLabel(n.text || n.key)
		return n.style?.geo === 'ellipse' ? `((${l}))` : n.style?.geo === 'diamond' ? `{${l}}` : `[${l}]`
	}
	const emit = (groupKey, indent) => {
		for (const g of tg.groups.filter((g) => (g.parent ?? null) === groupKey)) {
			lines.push(`${indent}subgraph ${ids.get(g.key)} [${mmLabel(g.label ?? g.key)}]`)
			emit(g.key, indent + '  ')
			lines.push(`${indent}end`)
		}
		for (const n of tg.nodes.filter((n) => (n.group ?? null) === groupKey)) lines.push(`${indent}${ids.get(n.key)}${shape(n)}`)
	}
	emit(null, '  ')
	for (const e of tg.edges) {
		const from = ids.get(e.from), to = ids.get(e.to)
		if (!from || !to) continue
		const arrow = e.style?.dash === 'dashed' || e.style?.dash === 'dotted' ? '-.->' : '-->'
		lines.push(`  ${from} ${arrow}${e.label ? `|${mmLabel(e.label)}|` : ''} ${to}`)
	}
	return lines.join('\n') + '\n'
}

/**
 * Mermaid flowchart → TG. A deliberate subset: `flowchart|graph DIR`, nodes `id`, `id[..]`, `id(..)`,
 * `id([..])`, `id((..))`, `id{..}`, chains of edges (`-->`, `---`, `-.->`, `==>`, with `|label|` or
 * `-- label -->`), `A & B --> C`, nested `subgraph id [label]` … `end`, and `%% toucan-key` comments.
 * style/class/click/linkStyle lines are ignored; anything else unparsed is listed in `warnings`.
 */
export function fromMermaid(src) {
	const keyFor = new Map()
	const nodes = new Map(), groups = new Map(), edges = []
	const warnings = []
	const stack = []
	let direction
	const ARROW = /^\s*(?:(<?(?:--|==|-\.)[-.=]*[>ox]?)\s*\|([^|]*)\|\s*|--\s+([^-][^]*?)\s+-->\s*|(<?(?:--|==|-\.)[-.=]*[>ox]?)\s*)/
	const OPENERS = [['((', '))', 'ellipse'], ['([', '])', 'rectangle'], ['[[', ']]', 'rectangle'], ['[(', ')]', 'rectangle'], ['[', ']', 'rectangle'], ['(', ')', 'rectangle'], ['{{', '}}', 'diamond'], ['{', '}', 'diamond'], ['>', ']', 'rectangle']]
	// One node reference at the start of `s`: { id, label?, geo, length } or null. Quote-aware, so a
	// quoted label may contain brackets.
	const parseNode = (s) => {
		const idm = /^([A-Za-z0-9_][\w-]*)/.exec(s)
		if (!idm) return null
		let i = idm[0].length
		const rest = s.slice(i).replace(/^\s+/, (ws) => ((i += ws.length), ''))
		for (const [open, close, geo] of OPENERS) {
			if (!rest.startsWith(open)) continue
			let j = open.length, label
			if (rest[j] === '"') {
				const q = rest.indexOf('"', j + 1)
				if (q < 0 || !rest.startsWith(close, q + 1)) return null
				label = rest.slice(j, q + 1)
				j = q + 1
			} else {
				const c = rest.indexOf(close, j)
				if (c < 0) return null
				label = rest.slice(j, c)
				j = c
			}
			return { id: idm[1], label: label.trim(), geo, length: i + j + close.length }
		}
		return { id: idm[1], geo: 'rectangle', length: idm[0].length }
	}
	const key = (id) => keyFor.get(id) ?? id
	// A bare reference (`a --> b`) carries no label or shape, so it must not overwrite them on import:
	// such nodes get no `text`/`style.geo` (creation falls back to the key).
	const commit = (n) => {
		const k = key(n.id)
		const existing = nodes.get(k)
		const own = n.label !== undefined ? { text: mmUnlabel(n.label), style: { geo: n.geo } } : { style: {} }
		// Membership is only asserted inside a subgraph; outside one, `group` stays undefined ("leave it").
		if (!existing) nodes.set(k, { key: k, ...own, ...(stack.length && { group: stack.at(-1) }) })
		else {
			if (n.label !== undefined) Object.assign(existing, own)
			if (stack.length) existing.group = stack.at(-1)
		}
		return k
	}
	for (let raw of src.split('\n')) {
		const keyNote = /^\s*%%\s*toucan-key\s+(\S+)\s+(".*")\s*$/.exec(raw)
		if (keyNote) {
			keyFor.set(keyNote[1], JSON.parse(keyNote[2]))
			continue
		}
		const line = raw.replace(/%%.*$/, '').trim().replace(/;$/, '')
		if (!line) continue
		let m
		if ((m = /^(?:flowchart|graph)\s*(\w+)?/i.exec(line))) {
			direction = m[1]
			continue
		}
		if ((m = /^subgraph\s+([\w-]+)\s*(?:\[(.*)\])?$/.exec(line)) || (m = /^subgraph\s+(.*)$/.exec(line))) {
			const id = m[1].trim()
			const k = key(id)
			groups.set(k, { key: k, label: mmUnlabel((m[2] ?? id).trim()), parent: stack.at(-1) ?? null })
			stack.push(k)
			continue
		}
		if (/^end$/.test(line)) {
			stack.pop()
			continue
		}
		if (/^(style|classDef|class|click|linkStyle|direction)\b/.test(line)) continue
		// A statement: node groups (A & B) joined by arrows. Parsed whole before anything is kept.
		let rest = line, ok = true
		const steps = [] // [{ nodes: [...], edge?: {label, style} to the next step }]
		while (rest) {
			const group = []
			for (;;) {
				const n = parseNode(rest)
				if (!n) {
					ok = false
					break
				}
				group.push(n)
				rest = rest.slice(n.length).replace(/^\s*:::\w+/, '')
				const amp = /^\s*&\s*/.exec(rest)
				if (!amp) break
				rest = rest.slice(amp[0].length)
			}
			if (!ok) break
			const step = { nodes: group }
			steps.push(step)
			rest = rest.trim()
			if (!rest) break
			const am = ARROW.exec(rest)
			if (!am || !am[0].trim()) {
				ok = false
				break
			}
			const op = am[1] ?? am[4] ?? '-->'
			const label = am[2] ?? am[3]
			step.edge = { label: label ? mmUnlabel(label.trim()) : undefined, style: { dash: op.includes('.') ? 'dashed' : 'solid', ...(op.startsWith('==') && { size: 'l' }) } }
			rest = rest.slice(am[0].length)
			if (!rest.trim()) ok = false // dangling arrow
		}
		if (ok) {
			const keys = steps.map((st) => st.nodes.map(commit))
			steps.forEach((st, i) => st.edge && keys[i + 1] && keys[i].forEach((f) => keys[i + 1].forEach((t) => edges.push({ from: f, to: t, ...st.edge }))))
		}
		if (!ok) warnings.push(raw.trim())
	}
	// Subgraphs referenced as edge endpoints are groups, not nodes.
	for (const k of groups.keys()) nodes.delete(k)
	const seen = new Set()
	return {
		tg: 1,
		direction,
		groups: [...groups.values()],
		nodes: [...nodes.values()],
		edges: edges.filter((e) => !seen.has(`${e.from}->${e.to}`) && seen.add(`${e.from}->${e.to}`)).map((e) => ({ key: `edge:${e.from}->${e.to}`, ...e })),
		skipped: {},
		...(warnings.length && { warnings }),
	}
}

// ---- Graphviz DOT (export only) --------------------------------------------------------------

export function toDot(tg, { rankdir = 'LR' } = {}) {
	const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
	const lines = [`digraph toucan {`, `  rankdir=${rankdir};`, `  node [shape=box, style="rounded,filled", fillcolor="#ffffff", fontname="Helvetica", fontsize=10];`]
	const emit = (groupKey, indent) => {
		for (const g of tg.groups.filter((g) => (g.parent ?? null) === groupKey)) {
			lines.push(`${indent}subgraph ${q('cluster_' + g.key)} {`, `${indent}  label=${q(g.label ?? g.key)};`)
			emit(g.key, indent + '  ')
			lines.push(`${indent}}`)
		}
		for (const n of tg.nodes.filter((n) => (n.group ?? null) === groupKey)) {
			const attrs = [`label=${q(n.text || n.key)}`]
			if (n.style?.color && COLORS[n.style.color]) attrs.push(`color=${q(COLORS[n.style.color])}`)
			if (n.style?.dash === 'dashed' || n.style?.dash === 'dotted') attrs.push(`style="rounded,filled,${n.style.dash}"`)
			if (n.style?.geo === 'ellipse') attrs.push('shape=ellipse')
			if (n.style?.geo === 'diamond') attrs.push('shape=diamond')
			lines.push(`${indent}${q(n.key)} [${attrs.join(', ')}];`)
		}
	}
	emit(null, '  ')
	for (const e of tg.edges) {
		const attrs = []
		if (e.label) attrs.push(`label=${q(e.label)}`)
		if (e.style?.dash === 'dashed' || e.style?.dash === 'dotted') attrs.push(`style=${e.style.dash}`)
		if (e.style?.color && COLORS[e.style.color]) attrs.push(`color=${q(COLORS[e.style.color])}`)
		lines.push(`  ${q(e.from)} -> ${q(e.to)}${attrs.length ? ` [${attrs.join(', ')}]` : ''};`)
	}
	lines.push('}')
	return lines.join('\n') + '\n'
}

// ---- helpers ------------------------------------------------------------------------------

/**
 * A copy of the TG where every node and group has a box: nodes without one are put on a simple grid
 * inside their group, and groups are sized around their members. Used by formats that need positions.
 */
export function withBoxes(tg, { w = 240, h = 120, gap = 40 } = {}) {
	const nodes = tg.nodes.map((n) => ({ ...n })), groups = tg.groups.map((g) => ({ ...g }))
	let gx = 0
	const place = (groupKey, x0, y0) => {
		const members = nodes.filter((n) => (n.group ?? null) === groupKey && !n.box)
		const cols = Math.max(1, Math.ceil(Math.sqrt(members.length)))
		members.forEach((n, i) => (n.box = { x: x0 + (i % cols) * (w + gap), y: y0 + Math.floor(i / cols) * (h + gap), w, h }))
	}
	const bounds = (items) => {
		const bs = items.map((i) => i.box).filter(Boolean)
		if (!bs.length) return null
		const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y))
		return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y }
	}
	const top = bounds([...nodes, ...groups])
	let cursorY = top ? top.y + top.h + 200 : 0
	// Innermost groups first, so a parent can be sized around its child groups.
	const depth = (g) => (g.parent ? 1 + depth(groups.find((p) => p.key === g.parent) ?? {}) : 0)
	for (const g of [...groups].sort((a, b) => depth(b) - depth(a))) {
		if (g.box) {
			place(g.key, g.box.x + gap, g.box.y + 60)
			continue
		}
		place(g.key, gx + gap, cursorY + 60)
		const inner = bounds([...nodes.filter((n) => n.group === g.key), ...groups.filter((c) => c.parent === g.key)])
		g.box = inner ? { x: inner.x - gap, y: inner.y - 60, w: inner.w + 2 * gap, h: inner.h + 60 + gap } : { x: gx, y: cursorY, w: w + 2 * gap, h: h + 100 }
		if (!g.parent) gx = g.box.x + g.box.w + 120
	}
	place(null, gx, cursorY)
	return { ...tg, nodes, groups }
}

/**
 * Give a position to everything in `tg` that has no box and isn't already on the canvas (`existing`,
 * the canvas's current TG). New groups and their new members get one compound ELK layout (groups as
 * containers, edges included), placed to the right of the existing content; new nodes that join an
 * existing group go in rows below that group's members. `elk` is an ELK instance (elkjs), passed in
 * so this module stays dependency-free. Returns a new TG.
 */
const ELK_DIRECTION = { TD: 'DOWN', TB: 'DOWN', BT: 'UP', LR: 'RIGHT', RL: 'LEFT' }
export async function layoutMissing(tg, { existing, elk, direction } = {}) {
	direction ??= ELK_DIRECTION[String(tg.direction ?? '').toUpperCase()] ?? 'RIGHT'
	const have = new Map((existing ? [...existing.groups, ...existing.nodes] : []).map((i) => [i.key, i]))
	const needs = (i) => !i.box && !have.has(i.key)
	const groups = tg.groups.map((g) => ({ ...g })), nodes = tg.nodes.map((n) => ({ ...n }))
	const newGroup = new Map(groups.filter(needs).map((g) => [g.key, g]))
	const size = (n) => {
		const lines = String(n.text || n.key).split('\n')
		return { w: Math.min(320, Math.max(140, Math.max(...lines.map((l) => l.length)) * 9 + 48)), h: Math.max(64, lines.length * 22 + 40) }
	}

	// Joining an existing group: rows under what's already there.
	const joining = new Map()
	for (const n of nodes) if (needs(n) && n.group && have.has(n.group)) joining.set(n.group, [...(joining.get(n.group) ?? []), n])
	for (const [gk, members] of joining) {
		const gb = have.get(gk).box
		const inside = existing.nodes.filter((m) => m.group === gk && m.box)
		let y = inside.length ? Math.max(...inside.map((m) => m.box.y + m.box.h)) + 40 : gb.y + 60
		let x = gb.x + 40
		for (const n of members) {
			const sz = size(n)
			if (x + sz.w > gb.x + Math.max(gb.w, 600) - 40 && x > gb.x + 40) (x = gb.x + 40), (y += 140)
			n.box = { x, y, ...sz }
			x += sz.w + 40
		}
	}

	const loose = nodes.filter((n) => needs(n) && !(n.group && have.has(n.group)))
	if (!loose.length && !newGroup.size) return { ...tg, groups, nodes }
	if (!elk) throw new Error('layoutMissing: pass an ELK instance')
	const elkNode = new Map()
	// ELK reads spacing from each node's own options, so containers repeat them.
	const spacing = { 'elk.spacing.nodeNode': '40', 'elk.layered.spacing.nodeNodeBetweenLayers': '80', 'elk.spacing.edgeNode': '24' }
	for (const g of newGroup.values()) elkNode.set(g.key, { id: g.key, children: [], layoutOptions: { ...spacing, 'elk.padding': '[top=60,left=40,bottom=40,right=40]' }, labels: [{ text: g.label ?? g.key }] })
	for (const n of loose) elkNode.set(n.key, { id: n.key, width: size(n).w, height: size(n).h })
	const root = { id: '__root', children: [] }
	for (const g of newGroup.values()) (newGroup.has(g.parent) ? elkNode.get(g.parent).children : root.children).push(elkNode.get(g.key))
	for (const n of loose) (newGroup.has(n.group) ? elkNode.get(n.group).children : root.children).push(elkNode.get(n.key))
	const edges = tg.edges.filter((e) => elkNode.has(e.from) && elkNode.has(e.to) && !newGroup.has(e.from) && !newGroup.has(e.to)).map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] }))
	const res = await elk.layout({
		...root,
		edges,
		layoutOptions: {
			'elk.algorithm': 'layered', 'elk.direction': direction, 'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
			...spacing, 'elk.spacing.componentComponent': '80',
		},
	})
	const bounds = existing ? [...existing.groups, ...existing.nodes].map((i) => i.box).filter(Boolean) : []
	const ox = bounds.length ? Math.max(...bounds.map((b) => b.x + b.w)) + 200 : 0
	const oy = bounds.length ? Math.min(...bounds.map((b) => b.y)) : 0
	const byKey = new Map([...groups, ...nodes].map((i) => [i.key, i]))
	const walk = (n, px, py) => {
		const x = px + (n.x ?? 0), y = py + (n.y ?? 0)
		if (n.id !== '__root') byKey.get(n.id).box = { x: Math.round(x), y: Math.round(y), w: Math.round(n.width), h: Math.round(n.height) }
		for (const c of n.children ?? []) walk(c, x, y)
	}
	walk(res, ox, oy)
	return { ...tg, groups, nodes }
}

export const FORMATS = {
	tg: { ext: 'tg.json', export: (tg) => JSON.stringify(tg, null, 2) + '\n', import: (s) => JSON.parse(s) },
	jsoncanvas: { ext: 'canvas', export: (tg) => JSON.stringify(toJsonCanvas(tg), null, '\t') + '\n', import: (s) => fromJsonCanvas(JSON.parse(s)) },
	mermaid: { ext: 'mmd', export: (tg, o) => toMermaid(tg, o), import: fromMermaid },
	dot: { ext: 'dot', export: (tg, o) => toDot(tg, o) },
	excalidraw: {
		ext: 'excalidraw',
		export: (tg) => JSON.stringify({ type: 'excalidraw', version: 2, source: 'toucan', elements: toExcalidrawElements(tg), appState: { viewBackgroundColor: '#ffffff' }, files: {} }, null, 2) + '\n',
		import: (s) => fromExcalidraw(JSON.parse(s).elements ?? []),
	},
}
