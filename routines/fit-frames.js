// routine: Fit frames
// description: Each frame fits what is in it, with even padding, so nothing is cut off. Nothing inside moves on the page.
// engines: tldraw

const n = toucan.tidy.fitFrames(args)
const apart = n ? toucan.tidy.fixOverlaps({ gap: 40, framesOnly: true }) : 0
return { summary: n ? `${n} frame${n === 1 ? "" : "s"} fitted${apart ? ", and moved clear of each other" : ""}` : "Frames already fit", changed: n }
