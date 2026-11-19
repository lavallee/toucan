// routine: Fit frames
// description: Each frame fits what is in it, with even padding, so nothing is cut off. Nothing inside moves on the page.
// engines: tldraw, excalidraw
// kind: tidy
// when: Frames are too big, too small, or cut off what is in them.
// args: pad (px, default 30); on (keys: only the frames these shapes are in, and nothing moved clear)

// Given shapes (a reflex's situation: boxes cut off by their frame), only the frames they're in are fitted.
const on = Array.isArray(args.on) && args.on.length ? new Set(args.on) : null
const only = on ? [...new Set(toucan.scene.items().filter((s) => on.has(s.key)).flatMap((s) => [s.frame, ...toucan.scene.ancestors(s.id)]).filter(Boolean))] : undefined
const n = toucan.tidy.fitFrames({ pad: args.pad, only })
const apart = n && !on ? toucan.tidy.fixOverlaps({ gap: 40, framesOnly: true }) : 0
return { summary: n ? `${n} frame${n === 1 ? "" : "s"} fitted${apart ? ", and moved clear of each other" : ""}` : "Frames already fit", changed: n }
