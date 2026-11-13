// routine: Frame these
// description: The selected shapes go into a new frame drawn round them, with room to spare. Nothing moves on the page.
// engines: tldraw, excalidraw
// kind: layout
// when: A group of boxes belongs together and should be one frame, or a person asks to put these in a section.
// args: name (the frame's title, default "Group"); keys (the shapes, instead of the selection); pad (px, default 40)

const scene = toucan.scene
const items = scene.items()
const byKey = new Map(items.map((i) => [i.key, i]))
const keys = args.keys ?? toucan.selection().here.map((r) => r.key)
// A plan's shapes stay in the plan's own frames.
const picked = keys.map((k) => byKey.get(k)).filter((i) => i && i.kind !== 'frame' && i.kind !== 'arrow' && !scene.skipPlan(i.id))
if (!picked.length) return { summary: 'Select the shapes to frame first.', changed: 0 }
const pad = args.pad ?? 40
const x = Math.min(...picked.map((b) => b.x)) - pad, y = Math.min(...picked.map((b) => b.y)) - pad
const w = Math.max(...picked.map((b) => b.maxX)) + pad - x, h = Math.max(...picked.map((b) => b.maxY)) + pad - y
const name = String(args.name ?? 'Group')
let key = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'group'
for (let i = 2; byKey.has(key); i++) key = `${key.replace(/-\d+$/, '')}-${i}`
// Arrows between the framed shapes go with them; ones that leave the frame stay on the page.
const inside = new Set(picked.map((i) => i.id))
const arrows = scene.arrows().filter((a) => a.from && a.to && inside.has(a.from) && inside.has(a.to) && !scene.skipPlan(a.id)).map((a) => a.id)
if (scene.engine === 'tldraw') {
	toucan.frame(key, { x, y, w, h, name })
	editor.reparentShapes([...inside, ...arrows], toucan.idFor(key))
} else {
	await toucan.applyGraph({ tg: 1, groups: [{ key, label: name, box: { x, y, w, h } }], nodes: [], edges: [] })
	const frame = editor.getSceneElements().find((e) => e.type === 'frame' && (e.customData?.key ?? e.id) === key)
	// A box's label goes into the frame with it.
	const move = new Set([...inside, ...arrows])
	editor.updateScene({ elements: editor.getSceneElementsIncludingDeleted().map((e) => (move.has(e.id) || move.has(e.containerId) ? tl.newElementWith(e, { frameId: frame.id }) : e)) })
}
return { summary: `${picked.length} shape${picked.length === 1 ? '' : 's'} framed as "${name}".`, frame: key, changed: picked.length }
