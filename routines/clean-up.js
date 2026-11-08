// routine: Clean up
// description: What you mean by "clean this up": boxes match and line up, nothing overlaps, frames fit and arrows are neat. Keeps your arrangement, never leaves it scoring worse, and one undo reverses it.
// engines: tldraw, excalidraw

const before = toucan.measure().score
const mark = toucan.scene.checkpoint()
const counts = toucan.tidy.all()
const after = toucan.measure().score
// Tidying can trade one fault for a worse one. Then nothing is changed at all.
if (after < before) {
	toucan.scene.rollback(mark)
	return { summary: `Left as it was: tidying would have taken the score from ${before} to ${after} of 100.`, before, after: before, changed: 0, reverted: true }
}
return { summary: `Score ${before} → ${after} of 100.`, before, after, ...counts }
