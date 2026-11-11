// routine: Colour by frame
// description: Each frame takes one colour, so its boundary reads at a glance. Arrows are left alone.
// engines: tldraw, excalidraw
// kind: style
// when: Boxes in different frames should be told apart by colour.

const n = toucan.tidy.colourByFrame()
return { summary: n ? `${n} box${n === 1 ? "" : "es"} recoloured` : "Each frame is already one colour", changed: n }
