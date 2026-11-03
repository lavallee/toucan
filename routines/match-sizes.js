// routine: Match box sizes
// description: Rectangles in a row become one height, and in a column one width. Only ever larger, so no text is squeezed.
// engines: tldraw

const n = toucan.tidy.matchSizes(args)
return { summary: n ? `${n} box${n === 1 ? "" : "es"} resized` : "Sizes already match", changed: n }
