// routine: Line things up
// description: Boxes that are nearly in line are put in line, in rows and columns. Boxes stay in their frames.
// engines: tldraw, excalidraw
// kind: tidy
// when: Boxes are nearly in rows or columns but not quite.
// args: tolerance (px, default 40): how far off a box can be and still join a row

const n = toucan.tidy.align(args)
return { summary: n ? `${n} box${n === 1 ? "" : "es"} lined up` : "Everything is already in line", changed: n }
