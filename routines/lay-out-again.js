// routine: Lay it out again
// description: Rearranges everything from scratch to follow the arrows, frame by frame, or only one frame's contents (within). Use it when a diagram has lost its shape: positions are not kept, arrows someone routed by hand are, and one undo reverses it.
// engines: tldraw, excalidraw

// Takes { within: a frame's key, direction: 'RIGHT' or 'DOWN', spacing, layerSpacing }, all optional.
const n = await toucan.tidy.layOut(args)
toucan.scene.fit()
const m = toucan.measure()
return { summary: `Laid out ${n} box${n === 1 ? '' : 'es'} again${args.within ? ` in ${args.within}` : ''}. Score ${m.score} of 100.`, score: m.score, changed: n }
