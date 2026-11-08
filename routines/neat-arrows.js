// routine: Neat arrows
// description: Arrows leave and arrive at the middle of a side, instead of aiming at the centre. Arrows someone curved stay curved.
// engines: tldraw, excalidraw
// kind: arrows
// when: Arrows leave or enter boxes at odd points; anchors them to the sides facing each other.

const n = toucan.tidy.neatArrows()
const limit = n && toucan.scene.limits.anchors
return { summary: n ? `${n} arrow${n === 1 ? "" : "s"} tidied.${limit ? ` ${limit}` : ''}` : "Arrows are already neat", changed: n }
