// routine: Clean up
// description: What you mean by "clean this up": boxes match and line up, nothing overlaps, frames fit and arrows are neat. Keeps your arrangement, and one undo reverses it.
// engines: tldraw
// kind: tidy
// when: Someone says tidy this up, or after many edits: fixes overlaps, lines things up, evens gaps and fits frames, keeping the arrangement.

const before = toucan.measure().score
const counts = toucan.tidy.all()
const after = toucan.measure().score
return { summary: `Score ${before} → ${after} of 100.`, before, after, ...counts }
