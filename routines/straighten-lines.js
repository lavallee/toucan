// routine: Straighten sketchy lines
// description: Replace hand-drawn outlines and arrows with clean ones, and handwritten Excalidraw text with a plain font. Nothing moves.
// engines: tldraw, excalidraw
// kind: arrows
// when: Hand-drawn lines and arrows are wobbly.

if (toucan.engine === 'excalidraw') {
	const HANDWRITTEN = new Set([tl.FONT_FAMILY.Virgil, tl.FONT_FAMILY.Excalifont, tl.FONT_FAMILY['Comic Shanns']])
	const els = editor.getSceneElements()
	// A plan's shapes are drawn by the plan, and stay as it drew them.
	const sketchy = (e) => (e.roughness > 0 || (e.type === 'text' && HANDWRITTEN.has(e.fontFamily))) && !toucan.scene.skipPlan(e.id)
	const changed = new Map(els.filter(sketchy).map((e) => [e.id, tl.newElementWith(e, { roughness: 0, ...(e.type === 'text' && HANDWRITTEN.has(e.fontFamily) && { fontFamily: tl.FONT_FAMILY.Helvetica }) })]))
	const next = els.map((e) => changed.get(e.id) ?? e)
	// Text is re-measured in its new font, keeping each element's bumped version so the edit syncs.
	editor.updateScene({ elements: tl.restoreElements(next, null, { refreshDimensions: true, repairBindings: true }), captureUpdate: tl.CaptureUpdateAction.IMMEDIATELY })
	return { summary: changed.size ? `${changed.size} element${changed.size === 1 ? '' : 's'} cleaned up` : 'Nothing sketchy here', changed: changed.size }
}

// A proposal keeps the dash it will get back when accepted, so that is cleaned up too.
const LINES = new Set(['geo', 'arrow', 'line'])
const clean = editor.getCurrentPageShapes().filter((s) => LINES.has(s.type) && (s.props.dash === 'draw' || s.meta?.proposed?.dash === 'draw') && !toucan.scene.skipPlan(s.id))
editor.updateShapes(clean.map((s) => ({
	id: s.id,
	type: s.type,
	props: { dash: s.props.dash === 'draw' ? 'solid' : s.props.dash },
	...(s.meta?.proposed?.dash === 'draw' && { meta: { ...s.meta, proposed: { dash: 'solid' } } }),
})))
return { summary: clean.length ? `${clean.length} shape${clean.length === 1 ? '' : 's'} cleaned up` : 'Nothing sketchy here', changed: clean.length }
