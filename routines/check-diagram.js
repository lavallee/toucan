// routine: Check this diagram
// description: Measures the diagram as drawn, scores it, and points at what is wrong. Changes nothing.
// engines: tldraw, excalidraw
// kind: check
// when: After any layout change, or to see what's wrong: scores the diagram and points at the faults. Changes nothing.

const m = toucan.measure()
// What to do about each kind of finding found (app/measure.js FIXES), so the next step doesn't need a look at the picture.
const kinds = {}
for (const f of m.findings) (kinds[f.kind] ??= []).push(...f.on)
const words = Object.entries(kinds).map(([kind, on]) => (on.length ? `${kind} (${new Set(on).size})` : kind))
toucan.pulse([...new Set(m.findings.flatMap((f) => f.on))])
return {
	summary: words.length ? `Score ${m.score} of 100: ${words.join(", ")}` : `Score ${m.score} of 100, with nothing wrong.`,
	score: m.score,
	findings: m.findings,
	...(Object.keys(kinds).length && { fixes: Object.fromEntries(Object.keys(kinds).filter((k) => toucan.fixes?.[k]).map((k) => [k, toucan.fixes[k]])) }),
	...(kinds['text too small to read with the whole diagram in view'] && { hint: `Tighten the gaps, shorten the longest chain, or draw it in the other direction (text is ${m.textAtFit}px at fit).` }),
	measures: { aligned: m.aligned, flow: m.flow, textAtFit: m.textAtFit, fitZoom: m.fitZoom },
}
