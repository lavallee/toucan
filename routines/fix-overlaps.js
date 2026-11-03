// routine: Fix overlaps
// description: Overlapping boxes and frames are moved apart by the least distance that clears them, and frames grow to hold what moved.
// engines: tldraw

const n = toucan.tidy.fixOverlaps(args)
// A box pushed past its frame's edge would be cut off, and could land on the next frame's boxes.
const frames = n ? toucan.tidy.fitFrames() + toucan.tidy.fixOverlaps({ gap: 40, framesOnly: true }) : 0
return { summary: n ? `${n} shape${n === 1 ? "" : "s"} moved apart` : "Nothing overlaps", changed: n + frames }
