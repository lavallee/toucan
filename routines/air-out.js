// routine: Air out
// description: Make a dense diagram readable: long box text moves into the click-open details, leaving a short, larger name, with a little more room. Nothing is lost, and one undo reverses it.
// engines: tldraw
// kind: layout
// when: A diagram is dense, with long text in boxes: moves the text into details and gives the names room. Only when asked.
// args: factor (default 1.25): how much to spread

// Names do more for an overview than space does: spreading everything out just zooms it further away.
const FACTOR = args.factor ?? 1.25
const MAX_TITLE = 42

/** A title from a box's text, and what's left for the details. */
function split(full) {
	const lines = full.split('\n').map((l) => l.trim()).filter(Boolean)
	const first = lines[0] ?? ''
	if (!lines.length || (lines.length === 1 && first.length <= MAX_TITLE)) return null // empty, or already short
	if (first.length <= MAX_TITLE) return { title: first, detail: lines.slice(1).join('\n') }
	// A short opening sentence is the name the writer already gave it.
	const opening = first.match(/^(.{3,42}?)[.:;]\s+(.+)$/)
	if (opening) return { title: opening[1], detail: [opening[2], ...lines.slice(1)].join('\n') }
	// One long line: end the title at a word, and keep all of it in the details.
	const cut = first.slice(0, MAX_TITLE)
	return { title: `${cut.slice(0, cut.lastIndexOf(' ') > 12 ? cut.lastIndexOf(' ') : MAX_TITLE)}…`, detail: lines.join('\n') }
}

const shapes = editor.getCurrentPageShapes()
let shortened = 0
const updates = shapes.flatMap((s) => {
	const move = { id: s.id, type: s.type, x: s.x * FACTOR, y: s.y * FACTOR }
	if (s.type === 'arrow') {
		// A bound end follows what it's bound to, and a free end moves with everything else.
		const bound = editor.getBindingsFromShape(s, 'arrow').map((b) => b.props.terminal)
		if (bound.length === 2) return []
		const free = (end) => (bound.includes(end) ? {} : { [end]: { x: s.props[end].x * FACTOR, y: s.props[end].y * FACTOR } })
		return [{ ...move, props: { ...free('start'), ...free('end') } }]
	}
	if (s.type === 'note') return [move] // keeps its size, and stays where it was relative to what it's about
	if (s.type === 'frame') return [{ ...move, props: { w: s.props.w * FACTOR, h: s.props.h * FACTOR } }]
	if (s.type !== 'geo') return [move]
	const parts = split(toucan.text(s))
	if (!parts) return [{ ...move, props: { size: 'l' } }]
	shortened++
	const detail = [parts.detail, typeof s.meta?.detail === 'string' ? s.meta.detail : ''].filter(Boolean).join('\n')
	return [{ ...move, props: { richText: tl.toRichText(parts.title), size: 'l', w: s.props.w * FACTOR, h: Math.min(s.props.h, 120) }, meta: { ...s.meta, detail } }]
})
editor.updateShapes(updates)
editor.zoomToFit({ animation: { duration: 250 } })
return { summary: `${shortened} box${shortened === 1 ? '' : 'es'} shortened, ${updates.length} spread out. Click a box for its details.`, shortened, moved: updates.length }
