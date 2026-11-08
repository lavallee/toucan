// routine: Open out details
// description: Each box's details appear beside it on the canvas, in a panel linked by a dotted line, for reading or presenting. Run it again to put them away. The boxes you selected, or every box with details.
// engines: tldraw, excalidraw
// kind: content
// when: Someone wants to read or present what's behind the boxes without clicking each one; the reverse of Air out.
// args: keys (the boxes, instead of the selection); width (px, default 280)

const g = toucan.graph()
const panelKey = (k) => `detail:${k}`
const open = new Set(g.nodes.filter((n) => n.key.startsWith('detail:')).map((n) => n.key))
const selected = new Set(toucan.selection().here.map((r) => r.key))
const chosen = (n) => (args.keys ? args.keys.includes(n.key) : !selected.size || selected.has(n.key))
const withDetail = g.nodes.filter((n) => !n.key.startsWith('detail:') && typeof n.meta?.detail === 'string' && n.meta.detail.trim() && n.box && chosen(n))
// Panels already out for these boxes: this run puts them away.
const showing = withDetail.filter((n) => open.has(panelKey(n.key)))
if (showing.length) {
	toucan.remove(...showing.flatMap((n) => [panelKey(n.key), `edge:${n.key}->${panelKey(n.key)}`]).filter((k) => toucan.get(k)))
	return { summary: `${showing.length} detail panel${showing.length === 1 ? '' : 's'} put away.`, changed: showing.length }
}
if (!withDetail.length) return { summary: selected.size ? 'None of the selected boxes has details.' : 'No box has details to open out.', changed: 0 }
const W = args.width ?? 280
const lines = (t) => t.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / Math.floor((W - 30) / 8))), 0)
const nodes = [], edges = []
for (const n of withDetail) {
	const text = n.meta.detail.trim().slice(0, 1200)
	nodes.push({ key: panelKey(n.key), text, ...(n.group && { group: n.group }), box: { x: n.box.x + n.box.w + 50, y: n.box.y, w: W, h: Math.min(600, 30 + lines(text) * 20) }, style: { color: 'grey', fill: 'none', dash: 'dotted', geo: 'rectangle', size: 's' }, meta: { panelFor: n.key } })
	edges.push({ from: n.key, to: panelKey(n.key), style: { color: 'grey', dash: 'dotted', head: 'none' } })
}
// Each box is named too: on Excalidraw an arrow is only drawn between boxes the graph mentions.
await toucan.applyGraph({ tg: 1, groups: [], nodes: [...withDetail.map((n) => ({ key: n.key })), ...nodes], edges })
return { summary: `${nodes.length} detail panel${nodes.length === 1 ? '' : 's'} opened out. If they crowd other boxes, run Fix overlaps; run this again to put them away.`, changed: nodes.length }
