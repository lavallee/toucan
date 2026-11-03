// routine: Air out
// description: Make a dense diagram readable: long box text moves into the click-open details, leaving a short, larger name, with a little more room. Nothing is lost, and one undo reverses it.
// engines: tldraw

// Names do more for an overview than space does: spreading everything out just zooms it further away.
const FACTOR = args.factor ?? 1.25
const MAX_TITLE = 42

/** A title from a box's text, and what's left for the details. */
function split(full) {
	const lines = full.split('\n').map((l) => l.trim()).filter(Boolean)
	const first = lines[0] ?? ''
	if (lines.length === 1 && first.length <= MAX_TITLE) return null // already short
	if (first.length <= MAX_TITLE) return { title: first, detail: lines.slice(1).join('\n') }
	// One long line: end the title at a word, and keep all of it in the details.
	const cut = first.slice(0, MAX_TITLE)
	return { title: `${cut.slice(0, cut.lastIndexOf(' ') > 12 ? cut.lastIndexOf(' ') : MAX_TITLE)}…`, detail: lines.join('\n') }
}

const shapes = editor.getCurrentPageShapes()
let shortened = 0
const updates = shapes.flatMap((s) => {
	if (s.type === 'arrow' || s.type === 'note') return [] // an arrow follows its ends, and a note is a person's message
	const move = { id: s.id, type: s.type, x: s.x * FACTOR, y: s.y * FACTOR }
	if (s.type === 'frame') return [{ ...move, props: { w: s.props.w * FACTOR, h: s.props.h * FACTOR } }]
	if (s.type !== 'geo') return [move]
	const parts = split(toucan.text(s))
	if (!parts) return [{ ...move, props: { size: 'l' } }]
	shortened++
	const detail = s.meta?.detail ? `${parts.detail}\n${s.meta.detail}` : parts.detail
	return [{ ...move, props: { richText: tl.toRichText(parts.title), size: 'l', w: s.props.w * FACTOR, h: Math.min(s.props.h, 120) }, meta: { ...s.meta, detail } }]
})
editor.updateShapes(updates)
editor.zoomToFit({ animation: { duration: 250 } })
return { summary: `${shortened} box${shortened === 1 ? '' : 'es'} shortened, ${updates.length} spread out. Click a box for its details.`, shortened, moved: updates.length }
