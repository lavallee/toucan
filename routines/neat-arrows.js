// routine: Neat arrows
// description: Arrows leave and arrive at the middle of a side, instead of aiming at the centre. Arrows someone curved stay curved.
// engines: tldraw

const n = toucan.tidy.neatArrows()
return { summary: n ? `${n} arrow${n === 1 ? "" : "s"} tidied` : "Arrows are already neat", changed: n }
