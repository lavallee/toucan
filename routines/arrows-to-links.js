// routine: Arrows to links
// description: Long arrows that cut across the canvas become two-way links in each box's details card, so the canvas keeps its main path. The arrows you selected, or else those much longer than the rest.
// engines: tldraw, excalidraw
// kind: arrows
// when: Arrows run a long way across the canvas or tangle with others, and they're cross-references rather than the way through.
// args: keys (the arrows to turn into links); ratio (default 2: an arrow this many times the median length counts as long)

const g = toucan.graph()
const nodes = new Map(g.nodes.map((n) => [n.key, n]))
const centre = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
const length = (e) => {
	const a = nodes.get(e.from)?.box, b = nodes.get(e.to)?.box
	if (!a || !b) return 0
	const p = centre(a), q = centre(b)
	return Math.hypot(p.x - q.x, p.y - q.y)
}
const selected = new Set(toucan.selection().here.map((r) => r.key))
let pick = args.keys ? g.edges.filter((e) => args.keys.includes(e.key)) : g.edges.filter((e) => selected.has(e.key))
if (!pick.length && !args.keys) {
	const lengths = g.edges.map(length).filter(Boolean).sort((a, b) => a - b)
	const median = lengths[Math.floor(lengths.length / 2)] ?? 0
	pick = g.edges.filter((e) => median && length(e) > (args.ratio ?? 2) * median)
}
// Proposals are for a person to decide on; and an arrow needs two boxes to link.
pick = pick.filter((e) => !e.meta?.proposed && nodes.has(e.from) && nodes.has(e.to))
if (!pick.length) return { summary: 'No arrows to turn into links: select some, or none is much longer than the rest.', changed: 0 }

const name = (k) => (nodes.get(k).text || k).split('\n')[0]
const see = new Map()
const link = (k, entry) => {
	const list = see.get(k) ?? [...(Array.isArray(nodes.get(k).meta?.see) ? nodes.get(k).meta.see : [])]
	if (!list.some((s) => s.key === entry.key)) list.push(entry)
	see.set(k, list)
}
for (const e of pick) {
	link(e.from, { key: e.to, label: e.label || name(e.to) })
	link(e.to, { key: e.from, label: e.label ? `${e.label} (from ${name(e.from)})` : `from ${name(e.from)}` })
}
await toucan.applyGraph({ tg: 1, groups: [], edges: [], nodes: [...see].map(([key, list]) => ({ key, meta: { ...nodes.get(key).meta, see: list } })) })
toucan.remove(...pick.map((e) => e.key))
return { summary: `${pick.length} arrow${pick.length === 1 ? '' : 's'} became links: select a box to follow one.`, changed: pick.length }
