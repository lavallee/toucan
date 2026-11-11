// routine: Clear arrow labels
// description: An arrow's label that sits on a box slides along its arrow to the nearest clear spot. One with no clear spot is left, and named.
// engines: tldraw
// kind: arrows
// when: Arrow labels sit on top of boxes, or check-diagram says an arrow label sits on a box.

const boxes = editor.getCurrentPageShapes().filter((s) => s.type === 'geo')
const bounds = (s) => editor.getShapePageBounds(s)
const hit = (a, b) => a.x < b.maxX && b.x < a.maxX && a.y < b.maxY && b.y < a.maxY
const labelBox = (arrow) => {
	const label = editor.getShapeGeometry(arrow).children?.find((c) => c.isLabel)
	if (!label) return null
	const pts = editor.getShapePageTransform(arrow).applyToPoints(label.vertices)
	const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
	return { x: Math.min(...xs), y: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}
const SPOTS = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.12, 0.88]
let moved = 0
const stuck = []
for (const arrow of editor.getCurrentPageShapes().filter((s) => s.type === 'arrow' && toucan.text(s).trim())) {
	const ends = new Set(editor.getBindingsFromShape(arrow, 'arrow').map((b) => b.toId))
	const others = boxes.filter((b) => !ends.has(b.id)).map(bounds)
	const clear = () => {
		const l = labelBox(editor.getShape(arrow.id))
		return !l || !others.some((b) => hit(l, b))
	}
	if (clear()) continue
	const was = arrow.props.labelPosition ?? 0.5
	const spot = SPOTS.find((at) => (editor.updateShape({ id: arrow.id, type: 'arrow', props: { labelPosition: at } }), clear()))
	if (spot === undefined) {
		editor.updateShape({ id: arrow.id, type: 'arrow', props: { labelPosition: was } })
		stuck.push(toucan.text(arrow).split('\n')[0])
	} else if (spot !== was) moved++
}
const left = stuck.length ? ` ${stuck.length} have no clear spot (${stuck.slice(0, 3).map((t) => `"${t}"`).join(', ')}): shorten them, or move a box.` : ''
return { summary: moved || stuck.length ? `${moved} label${moved === 1 ? '' : 's'} moved off boxes.${left}` : 'No arrow label sits on a box.', changed: moved }
