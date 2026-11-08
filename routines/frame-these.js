// routine: Frame these
// description: The selected shapes go into a new frame drawn round them, with room to spare. Nothing moves on the page.
// engines: tldraw
// kind: layout
// when: A group of boxes belongs together and should be one frame, or a person asks to put these in a section.
// args: name (the frame's title, default "Group"); keys (the shapes, instead of the selection); pad (px, default 40)

const keys = args.keys ?? toucan.selection().here.map((r) => r.key)
const shapes = keys.map((k) => toucan.get(k)).filter((s) => s && s.type !== 'frame')
if (!shapes.length) return { summary: 'Select the shapes to frame first.', changed: 0 }
const pad = args.pad ?? 40
const all = shapes.map((s) => editor.getShapePageBounds(s))
const x = Math.min(...all.map((b) => b.x)) - pad, y = Math.min(...all.map((b) => b.y)) - pad
const w = Math.max(...all.map((b) => b.maxX)) + pad - x, h = Math.max(...all.map((b) => b.maxY)) + pad - y
const name = String(args.name ?? 'Group')
let key = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'group'
for (let i = 2; toucan.get(key); i++) key = `${key.replace(/-\d+$/, '')}-${i}`
toucan.frame(key, { x, y, w, h, name })
// Arrows between the framed shapes go with them; ones that leave the frame stay on the page.
const inside = new Set(shapes.map((s) => s.id))
const arrows = editor.getCurrentPageShapes().filter((a) => a.type === 'arrow' && editor.getBindingsFromShape(a, 'arrow').every((b) => inside.has(b.toId)))
editor.reparentShapes([...shapes, ...arrows].map((s) => s.id), toucan.idFor(key))
return { summary: `${shapes.length} shape${shapes.length === 1 ? '' : 's'} framed as "${name}".`, frame: key, changed: shapes.length }
