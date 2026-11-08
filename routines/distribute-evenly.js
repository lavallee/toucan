// routine: Even out the gaps
// description: Within each row and column the gaps become equal. A row with a deliberate hole in it is left alone.
// engines: tldraw, excalidraw

const n = toucan.tidy.distribute(args)
return { summary: n ? `${n} box${n === 1 ? "" : "es"} spaced evenly` : "The gaps are already even", changed: n }
