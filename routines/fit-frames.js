// routine: Fit frames
// description: Each frame fits what is in it, with even padding, so nothing is cut off. Nothing inside moves on the page.
// engines: tldraw
// kind: tidy
// when: Frames are too big, too small, or cut off what is in them.
// args: pad (px, default 30)

const n = toucan.tidy.fitFrames(args)
const apart = n ? toucan.tidy.fixOverlaps({ gap: 40, framesOnly: true }) : 0
return { summary: n ? `${n} frame${n === 1 ? "" : "s"} fitted${apart ? ", and moved clear of each other" : ""}` : "Frames already fit", changed: n }
