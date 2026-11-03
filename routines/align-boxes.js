// routine: Line things up
// description: Boxes that are nearly in line are put in line, in rows and columns. Boxes stay in their frames.
// engines: tldraw

const n = toucan.tidy.align(args)
return { summary: n ? `${n} box${n === 1 ? "" : "es"} lined up` : "Everything is already in line", changed: n }
