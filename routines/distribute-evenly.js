// routine: Even out the gaps
// description: Within each row and column the gaps become equal. A row with a deliberate hole in it is left alone.
// engines: tldraw, excalidraw
// kind: tidy
// when: A row or column has uneven gaps.
// args: tolerance (px, default 20)

const n = toucan.tidy.distribute(args)
return { summary: n ? `${n} box${n === 1 ? "" : "es"} spaced evenly` : "The gaps are already even", changed: n }
