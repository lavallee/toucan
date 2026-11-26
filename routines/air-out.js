// routine: Air out
// description: Make a dense diagram readable: long box text moves into the click-open details, leaving a short, larger name, with a little more room. Nothing is lost, and one undo reverses it.
// engines: tldraw, excalidraw
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

// Everything is spread out from the page's origin, so what's inside a frame keeps its place in it.
const scene = toucan.scene
const out = (p) => ({ x: p.x * FACTOR, y: p.y * FACTOR })
let shortened = 0, moved = 0
scene.batch(() => {
	for (const s of scene.items()) {
		// A plan's views stay exactly as the plan drew them, and so does a frame holding one, with what's in it.
		if (scene.skipPlan(s.id) || scene.skipHolder(s.id) || scene.ancestors(s.id).some((id) => scene.skipHolder(id))) continue
		// An arrow's bound ends follow what they're bound to, and a free end moves with everything else.
		if (s.kind === 'arrow') {
			const a = scene.arrows().find((x) => x.id === s.id)
			if (a.from && a.to) continue
			scene.moveEnds(s.id, out)
			moved++
			continue
		}
		moved++
		// A note keeps its size, and stays where it was relative to what it's about.
		if (s.kind === 'frame') scene.place(s.id, { ...out(s), w: s.w * FACTOR, h: s.h * FACTOR })
		else if (s.kind !== 'box') scene.place(s.id, out(s))
		else {
			const parts = split(s.text)
			if (!parts) {
				scene.place(s.id, out(s))
				scene.restyle(s.id, { size: 'l' })
				continue
			}
			shortened++
			const detail = [parts.detail, typeof s.meta?.detail === 'string' ? s.meta.detail : ''].filter(Boolean).join('\n')
			scene.place(s.id, { ...out(s), w: s.w * FACTOR, h: Math.min(s.base ?? s.h, 120) })
			scene.restyle(s.id, { text: parts.title, size: 'l', meta: { detail } })
		}
	}
})
scene.fit()
return { summary: `${shortened} box${shortened === 1 ? '' : 'es'} shortened, ${moved} spread out. Click a box for its details.`, shortened, moved, changed: moved + shortened }
