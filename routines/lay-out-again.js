// routine: Lay it out again
// description: Rearranges everything from scratch to follow the arrows, frame by frame. Use it when a diagram has lost its shape: positions are not kept, and one undo reverses it.
// engines: tldraw

await toucan.tidy.layOut(toucan, args)
editor.zoomToFit({ animation: { duration: 250 } })
const m = toucan.measure()
return { summary: `Laid out again. Score ${m.score} of 100.`, score: m.score }
