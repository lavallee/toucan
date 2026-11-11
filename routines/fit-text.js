// routine: Fit text
// description: Every box becomes tall enough for its text, so nothing spills out and its height is its own rather than grown on top. Widths and positions stay.
// engines: tldraw, excalidraw
// kind: tidy
// when: Text spills out of boxes, or check-diagram says text outgrew its box.

let fitted = 0
if (toucan.engine === 'excalidraw') {
	// A container whose bound text is taller than it: grow it, and centre the text again.
	const all = editor.getSceneElements()
	const byId = new Map(all.map((e) => [e.id, e]))
	const PAD = 10
	const changed = new Map()
	for (const t of all) {
		if (t.type !== 'text' || !t.containerId) continue
		const box = byId.get(t.containerId)
		if (!box || box.type === 'arrow') continue
		const need = t.height + PAD * 2
		if (box.height >= need - 1) continue
		const grown = tl.newElementWith(box, { height: Math.ceil(need) })
		changed.set(box.id, grown)
		changed.set(t.id, tl.newElementWith(t, { y: grown.y + (grown.height - t.height) / 2 }))
		fitted++
	}
	if (changed.size) editor.updateScene({ elements: all.map((e) => changed.get(e.id) ?? e), captureUpdate: tl.CaptureUpdateAction.IMMEDIATELY })
} else {
	// tldraw grows a box with too much text by growY; fold it into the height, so the box is simply that tall.
	const grown = editor.getCurrentPageShapes().filter((s) => s.type === 'geo' && s.props.growY > 0)
	editor.updateShapes(grown.map((s) => ({ id: s.id, type: s.type, props: { h: s.props.h + s.props.growY, growY: 0 } })))
	fitted = grown.length
}
return { summary: fitted ? `${fitted} box${fitted === 1 ? '' : 'es'} now fit their text.` : 'Every box already fits its text.', changed: fitted }
